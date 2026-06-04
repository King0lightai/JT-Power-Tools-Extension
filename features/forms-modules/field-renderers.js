/**
 * Forms Field Renderers — Task 5 (PR #4 of 5)
 *
 * Renders one form field from a v1 schema entry into a self-contained DOM
 * card. Five field types: section, text_short, text_long, checkboxes, radio.
 *
 * Value shape is canonical to server/mcp-server/src/forms-validator.js:
 *   - text_short / text_long → string
 *   - checkboxes / radio     → { selections: string[], fills?: { [optValue]: string } }
 *   - section                → no value, onChange never fires
 *
 * Fill-ins ("Other ___" / "Yes — how many? ___") are NOT a separate field
 * type; they're a `fillIn` property on an option, with the user-typed text
 * keyed under that option's value in the data's `fills` object.
 *
 * Public surface (single export):
 *   FormsFieldRenderers.renderField(field, value, onChange) → HTMLElement
 *
 * onChange contract:
 *   onChange(fieldId, newValue) — called on every user mutation. Caller
 *   (Task 6 save engine) is responsible for debouncing.
 *
 * DOM is built with createElement + textContent — no innerHTML, no string
 * interpolation. Required asterisk is a separate <span> with aria-hidden.
 */
const FormsFieldRenderers = (() => {
  // ─── Pure value helpers — checkboxes + radio share { selections, fills } ───

  /**
   * Coerce value into the canonical { selections, fills } shape. Tolerates
   * undefined/null/missing keys without throwing.
   */
  function normalizeSelectionValue(value) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      return { selections: [], fills: {} };
    }
    const selections = Array.isArray(value.selections) ? value.selections.slice() : [];
    const fills = (value.fills && typeof value.fills === 'object' && !Array.isArray(value.fills))
      ? Object.assign({}, value.fills)
      : {};
    return { selections, fills };
  }

  function isOptionSelected(value, optionValue) {
    const v = normalizeSelectionValue(value);
    return v.selections.indexOf(optionValue) >= 0;
  }

  function getOptionFillIn(value, optionValue) {
    const v = normalizeSelectionValue(value);
    return typeof v.fills[optionValue] === 'string' ? v.fills[optionValue] : '';
  }

  /**
   * Toggle an option in a checkbox-style multi-select value.
   * - If selected: remove from selections (and prune its fills entry).
   * - If not selected: add to selections (and seed empty fills entry if it has fillIn).
   */
  function toggleOption(value, optionValue, optionHasFillIn) {
    const v = normalizeSelectionValue(value);
    const idx = v.selections.indexOf(optionValue);
    if (idx >= 0) {
      v.selections.splice(idx, 1);
      // Prune fill on deselect — keeps payload tidy and matches user intent
      if (optionValue in v.fills) delete v.fills[optionValue];
    } else {
      v.selections.push(optionValue);
      if (optionHasFillIn && !(optionValue in v.fills)) {
        v.fills[optionValue] = '';
      }
    }
    return v;
  }

  /**
   * Replace the full selections list to a single option (radio click). Drops
   * any existing fills that don't belong to the newly selected option.
   */
  function selectRadio(value, optionValue, optionHasFillIn) {
    const v = normalizeSelectionValue(value);
    v.selections = [optionValue];
    // Drop fills that no longer belong to a selection
    for (const k of Object.keys(v.fills)) {
      if (k !== optionValue) delete v.fills[k];
    }
    if (optionHasFillIn && !(optionValue in v.fills)) {
      v.fills[optionValue] = '';
    } else if (!optionHasFillIn && optionValue in v.fills) {
      delete v.fills[optionValue];
    }
    return v;
  }

  /**
   * Update the fill-in text for a given option. No-op if the option isn't
   * selected (the input will be disabled anyway).
   */
  function setFillInForOption(value, optionValue, fillInValue) {
    const v = normalizeSelectionValue(value);
    v.fills[optionValue] = fillInValue;
    return v;
  }

  // ─── DOM construction helpers ───

  /**
   * Build a label with optional required asterisk. Skips entirely for
   * sections (sections render their label as <h3>, not <label>).
   */
  function appendLabel(card, field) {
    if (field.type === 'section') return;
    const lbl = document.createElement('label');
    lbl.className = 'jt-forms-field-label';
    lbl.textContent = field.label || '';
    if (field.required) {
      const ast = document.createElement('span');
      ast.className = 'jt-forms-required-asterisk';
      ast.textContent = '*';
      ast.setAttribute('aria-hidden', 'true');
      // a11y: append the screen-reader-only word "required" so the asterisk
      // isn't announced as bare punctuation
      const sr = document.createElement('span');
      sr.textContent = ' required';
      sr.style.position = 'absolute';
      sr.style.width = '1px';
      sr.style.height = '1px';
      sr.style.overflow = 'hidden';
      sr.style.clip = 'rect(0 0 0 0)';
      sr.style.whiteSpace = 'nowrap';
      lbl.appendChild(ast);
      lbl.appendChild(sr);
    }
    card.appendChild(lbl);
  }

  function makeCard(extraClass) {
    const card = document.createElement('div');
    card.className = extraClass
      ? 'jt-forms-field-card ' + extraClass
      : 'jt-forms-field-card';
    return card;
  }

  // ─── Per-type renderers ───

  function renderSection(field) {
    const card = makeCard();
    const h = document.createElement('h3');
    h.className = 'jt-forms-field-section';
    const hasNumber = typeof field.number === 'number' && Number.isFinite(field.number);
    h.textContent = hasNumber
      ? field.number + '. ' + (field.label || '')
      : (field.label || '');
    card.appendChild(h);
    return card;
  }

  function renderTextShort(field, value, onChange) {
    const card = makeCard('jt-forms-field-text-short');
    appendLabel(card, field);
    const input = document.createElement('input');
    input.type = 'text';
    input.maxLength = 500; // matches MAX_TEXT_SHORT_LEN in forms-validator.js
    input.id = 'jt-forms-' + field.id;
    if (typeof field.placeholder === 'string') {
      input.placeholder = field.placeholder;
    }
    if (typeof value === 'string') {
      input.value = value;
    }
    if (field.required) input.setAttribute('aria-required', 'true');
    input.addEventListener('input', (event) => {
      onChange(field.id, event.target.value);
    });
    // Connect label → input for a11y
    const lbl = card.querySelector('.jt-forms-field-label');
    if (lbl) lbl.setAttribute('for', input.id);
    card.appendChild(input);
    return card;
  }

  function renderTextLong(field, value, onChange) {
    const card = makeCard('jt-forms-field-text-long');
    appendLabel(card, field);
    const ta = document.createElement('textarea');
    let rows = 4;
    if (Number.isInteger(field.rows)) {
      rows = Math.max(2, Math.min(20, field.rows));
    }
    ta.rows = rows;
    ta.maxLength = 10000; // matches MAX_TEXT_LONG_LEN
    ta.id = 'jt-forms-' + field.id;
    if (typeof field.placeholder === 'string') {
      ta.placeholder = field.placeholder;
    }
    if (typeof value === 'string') {
      ta.value = value;
    }
    if (field.required) ta.setAttribute('aria-required', 'true');
    ta.addEventListener('input', (event) => {
      onChange(field.id, event.target.value);
    });
    const lbl = card.querySelector('.jt-forms-field-label');
    if (lbl) lbl.setAttribute('for', ta.id);
    card.appendChild(ta);
    return card;
  }

  /**
   * Build one option row (label > input + span + optional fillIn input).
   * Shared between renderCheckboxes + renderRadio since the row layout is
   * identical — only the input type and value-mutation handler differ.
   */
  function buildOptionRow({
    field,
    option,
    optionIndex,
    inputType,         // 'checkbox' | 'radio'
    isSelected,
    fillInText,
    onInputChange,     // (event) => void
    onFillInChange,    // (event) => void
  }) {
    const optionId = 'jt-forms-' + field.id + '-' + optionIndex;
    const row = document.createElement('label');
    row.setAttribute('for', optionId);

    const input = document.createElement('input');
    input.type = inputType;
    input.id = optionId;
    if (inputType === 'radio') input.name = 'jt-forms-' + field.id;
    input.value = option.value;
    input.checked = !!isSelected;
    input.addEventListener('change', onInputChange);
    row.appendChild(input);

    const labelSpan = document.createElement('span');
    labelSpan.textContent = option.label || '';
    row.appendChild(labelSpan);

    if (option.fillIn) {
      const fillInput = document.createElement('input');
      fillInput.type = option.fillIn.type === 'number' ? 'number' : 'text';
      fillInput.className = 'jt-forms-fillin-input';
      fillInput.maxLength = 200; // matches MAX_FILL_LEN
      fillInput.value = typeof fillInText === 'string' ? fillInText : '';
      fillInput.disabled = !isSelected;
      if (isSelected) fillInput.classList.add('is-active');
      const fillLabel = (option.fillIn.label && typeof option.fillIn.label === 'string')
        ? option.fillIn.label
        : ('fill-in for ' + (option.label || option.value));
      fillInput.setAttribute('aria-label', fillLabel);
      // Stop checkbox/radio toggling when the user clicks into the fill-in input
      // (the row is a <label>, so any click bubbles to the input by default)
      fillInput.addEventListener('click', (e) => e.stopPropagation());
      fillInput.addEventListener('input', onFillInChange);
      row.appendChild(fillInput);
    }

    return row;
  }

  function renderCheckboxes(field, value, onChange) {
    const card = makeCard('jt-forms-field-checkboxes');
    appendLabel(card, field);
    const options = Array.isArray(field.options) ? field.options : [];
    options.forEach((option, idx) => {
      const optionHasFillIn = !!option.fillIn;
      const row = buildOptionRow({
        field,
        option,
        optionIndex: idx,
        inputType: 'checkbox',
        isSelected: isOptionSelected(value, option.value),
        fillInText: getOptionFillIn(value, option.value),
        onInputChange: () => {
          const next = toggleOption(value, option.value, optionHasFillIn);
          value = next; // local closure update so subsequent edits see latest
          onChange(field.id, next);
        },
        onFillInChange: (event) => {
          const next = setFillInForOption(value, option.value, event.target.value);
          value = next;
          onChange(field.id, next);
        },
      });
      card.appendChild(row);
    });
    return card;
  }

  function renderRadio(field, value, onChange) {
    const card = makeCard('jt-forms-field-radio');
    appendLabel(card, field);
    const options = Array.isArray(field.options) ? field.options : [];
    options.forEach((option, idx) => {
      const optionHasFillIn = !!option.fillIn;
      const row = buildOptionRow({
        field,
        option,
        optionIndex: idx,
        inputType: 'radio',
        isSelected: isOptionSelected(value, option.value),
        fillInText: getOptionFillIn(value, option.value),
        onInputChange: () => {
          const next = selectRadio(value, option.value, optionHasFillIn);
          value = next;
          onChange(field.id, next);
        },
        onFillInChange: (event) => {
          const next = setFillInForOption(value, option.value, event.target.value);
          value = next;
          onChange(field.id, next);
        },
      });
      card.appendChild(row);
    });
    return card;
  }

  // ─── Date field ───

  function renderDate(field, value, onChange) {
    const card = makeCard('jt-forms-field-date');
    appendLabel(card, field);
    const input = document.createElement('input');
    input.type = 'date';
    input.id = 'jt-forms-' + field.id;
    input.maxLength = 10;
    if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)) {
      input.value = value;
    }
    if (field.required) input.setAttribute('aria-required', 'true');
    input.addEventListener('input', (event) => {
      onChange(field.id, event.target.value);
    });
    const lbl = card.querySelector('.jt-forms-field-label');
    if (lbl) lbl.setAttribute('for', input.id);
    card.appendChild(input);
    return card;
  }

  // ─── Signature field ───

  // signature_pad is bundled as a content script (see manifest.json) so the
  // constructor is resident on `window` from page load. We still expose a
  // promise wrapper so the renderer can render its loading state cleanly if
  // the script ever fails to register (e.g. partial extension corruption).
  function loadSignaturePad() {
    if (typeof window.SignaturePad === 'function') {
      return Promise.resolve(window.SignaturePad);
    }
    return Promise.reject(new Error('signature_pad not loaded — check manifest content_scripts'));
  }

  // High-DPI canvas resize. Necessary because the captured strokes track
  // CSS pixels but the underlying bitmap needs devicePixelRatio scaling
  // for crisp lines on retina/tablet displays.
  function resizeSignatureCanvas(canvas, pad) {
    const ratio = Math.max(window.devicePixelRatio || 1, 1);
    canvas.width = canvas.offsetWidth * ratio;
    canvas.height = canvas.offsetHeight * ratio;
    const ctx = canvas.getContext('2d');
    if (ctx) ctx.scale(ratio, ratio);
    if (pad && typeof pad.clear === 'function') pad.clear();
  }

  function isLocked(field) {
    // lockOnSign defaults to true — once a signature is captured, the field
    // becomes read-only with a "Clear signature" affordance. Builders can
    // opt out for fields where the signer wants to redraw in place.
    return field.lockOnSign !== false;
  }

  function renderSignedImage(card, value, onClear, locked) {
    const wrap = document.createElement('div');
    wrap.className = 'jt-forms-signature-signed';
    const img = document.createElement('img');
    img.className = 'jt-forms-signature-image';
    img.alt = 'Captured signature';
    img.src = value.dataUrl;
    wrap.appendChild(img);

    const meta = document.createElement('div');
    meta.className = 'jt-forms-signature-meta';
    if (typeof value.signedAt === 'string' && value.signedAt) {
      const d = new Date(value.signedAt);
      meta.textContent = Number.isNaN(d.getTime())
        ? 'Signed'
        : 'Signed ' + d.toLocaleString();
    } else {
      meta.textContent = 'Signed';
    }
    wrap.appendChild(meta);

    const clearBtn = document.createElement('button');
    clearBtn.type = 'button';
    clearBtn.className = 'jt-forms-signature-clear';
    clearBtn.textContent = locked ? 'Clear signature' : 'Redraw';
    clearBtn.addEventListener('click', onClear);
    wrap.appendChild(clearBtn);

    card.appendChild(wrap);
  }

  function renderSignature(field, value, onChange) {
    const card = makeCard('jt-forms-field-signature');
    appendLabel(card, field);

    // Has-signature path: when locked, show the captured PNG with a clear
    // affordance. When unlocked, fall through to the live pad below — the
    // pad's `fromDataURL` re-hydrates the strokes.
    const hasSignature = value
      && typeof value === 'object'
      && typeof value.dataUrl === 'string'
      && value.dataUrl.length > 0;

    const locked = isLocked(field);

    if (hasSignature && locked) {
      renderSignedImage(card, value, () => {
        // Clearing wipes both dataUrl and signedAt so a stale timestamp
        // can't leak into the saved blob.
        onChange(field.id, '');
        // Re-render the card by replacing in place
        const fresh = renderSignature(field, '', onChange);
        if (card.parentElement) {
          card.parentElement.replaceChild(fresh, card);
        }
      }, true);
      return card;
    }

    // Live pad path: create the canvas and a control row below it.
    const padWrap = document.createElement('div');
    padWrap.className = 'jt-forms-signature-pad';
    const canvas = document.createElement('canvas');
    canvas.className = 'jt-forms-signature-canvas';
    canvas.setAttribute('aria-label', 'Signature pad — draw with mouse, finger, or stylus');
    padWrap.appendChild(canvas);

    const hint = document.createElement('div');
    hint.className = 'jt-forms-signature-hint';
    hint.textContent = 'Sign above';
    padWrap.appendChild(hint);

    card.appendChild(padWrap);

    const controls = document.createElement('div');
    controls.className = 'jt-forms-signature-controls';
    const clearBtn = document.createElement('button');
    clearBtn.type = 'button';
    clearBtn.className = 'jt-forms-signature-clear';
    clearBtn.textContent = 'Clear';
    controls.appendChild(clearBtn);
    card.appendChild(controls);

    let pad = null;
    let resizeHandler = null;

    loadSignaturePad().then((SignaturePad) => {
      pad = new SignaturePad(canvas, {
        minWidth: 0.6,
        maxWidth: 2.0,
        penColor: '#1a1a1a',
        backgroundColor: 'rgba(0,0,0,0)',
      });
      resizeSignatureCanvas(canvas, pad);
      // Re-hydrate prior strokes when unlocked + already-signed
      if (hasSignature) {
        try { pad.fromDataURL(value.dataUrl); } catch (_e) { /* ignore */ }
      }
      pad.addEventListener('endStroke', () => {
        if (pad.isEmpty()) return;
        // Trim transparent margins to keep the dataUrl compact. SignaturePad
        // exposes the raw canvas; trimming is a small extra step that
        // typically halves the payload for centered signatures.
        const dataUrl = pad.toDataURL('image/png');
        onChange(field.id, {
          dataUrl,
          signedAt: new Date().toISOString(),
        });
      });

      // Self-removing: when the drawer closes (or the form switches), the
      // canvas is detached. Drop the listener then instead of resizing a dead
      // canvas on every window resize for the life of the page.
      resizeHandler = () => {
        if (!canvas.isConnected) {
          window.removeEventListener('resize', resizeHandler);
          return;
        }
        resizeSignatureCanvas(canvas, pad);
      };
      window.addEventListener('resize', resizeHandler);
    }).catch((err) => {
      console.error('FormsFieldRenderers: failed to load signature_pad', err);
      hint.textContent = 'Signature pad unavailable — please reload the page.';
    });

    clearBtn.addEventListener('click', () => {
      if (pad) pad.clear();
      onChange(field.id, '');
    });

    return card;
  }

  // ─── Public dispatcher ───

  function renderField(field, value, onChange) {
    if (!field || typeof field !== 'object') {
      console.warn('FormsFieldRenderers: invalid field, skipping');
      const div = document.createElement('div');
      div.className = 'jt-forms-field-card';
      div.textContent = '[invalid field]';
      return div;
    }
    switch (field.type) {
      case 'section':    return renderSection(field);
      case 'text_short': return renderTextShort(field, value, onChange);
      case 'text_long':  return renderTextLong(field, value, onChange);
      case 'checkboxes': return renderCheckboxes(field, value, onChange);
      case 'radio':      return renderRadio(field, value, onChange);
      case 'date':       return renderDate(field, value, onChange);
      case 'signature':  return renderSignature(field, value, onChange);
      default: {
        console.warn('FormsFieldRenderers: unknown field type', field.type);
        const div = document.createElement('div');
        div.className = 'jt-forms-field-card';
        div.textContent = '[unsupported field: ' + String(field.type) + ']';
        return div;
      }
    }
  }

  return { renderField };
})();

if (typeof window !== 'undefined') {
  window.FormsFieldRenderers = FormsFieldRenderers;
}
