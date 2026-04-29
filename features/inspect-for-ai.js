/**
 * Inspect-for-AI — when active, alt-clicking any element on app.jobtread.com
 * captures DOM context (selector + ancestors + descendants + URL + org)
 * formatted as markdown and copies it to the clipboard. The user pastes
 * this into any AI chat (Claude.ai, ChatGPT, Cursor, etc.) so the AI has
 * enough context to author a working tweak.
 *
 * Selector generation uses @medv/finder (vendored as window.JTFinder).
 * Tailwind atomic classes are explicitly blocklisted via finder's tagFilter
 * so we get stable structural selectors instead of fragile utility chains.
 */
const InspectForAiFeature = (() => {
  let isActive = false;
  let eventListeners = [];

  // Tailwind atomic prefixes finder should ignore — these change every release.
  // Borrowed from the user-supplied design doc.
  const TAILWIND_PREFIX_RE = /^(text-|bg-|flex-|grid-|p-|m-|w-|h-|gap-|rounded|shadow|border-|cursor-|opacity-|z-|inset-|top-|right-|bottom-|left-|max-|min-|space-|divide-|order-|col-|row-|leading-|tracking-|uppercase|lowercase|whitespace-|truncate|overflow-|object-|select-|pointer-|appearance-|outline-|ring-|fill-|stroke-)/;

  function init() {
    if (isActive) return;
    isActive = true;
    console.log('InspectForAi: Initializing...');
    const handler = (e) => {
      if (!e.altKey) return;
      // Don't interfere with extension UI itself
      if (e.target.closest('.jt-tools-popup, .jt-tweak-edit-')) return;
      e.preventDefault();
      e.stopPropagation();
      captureAndCopy(e.target);
    };
    document.addEventListener('click', handler, true);  // capture phase to fire before JT handlers
    eventListeners.push({ target: document, event: 'click', handler, useCapture: true });

    // Listen for "start picker mode" messages from the popup. Picker mode is
    // the contractor-friendly path: a button in the popup (no Alt-key needed),
    // with a live highlight overlay so the user can see exactly what they're
    // about to capture before clicking.
    const msgHandler = (message, sender, sendResponse) => {
      if (message && message.type === 'INSPECT_START_PICKER') {
        enterPickerMode({ multi: false });
        sendResponse({ ok: true });
        return false;
      }
      if (message && message.type === 'INSPECT_START_MULTI_PICKER') {
        enterPickerMode({ multi: true });
        sendResponse({ ok: true });
        return false;
      }
      return false;
    };
    chrome.runtime.onMessage.addListener(msgHandler);
    eventListeners.push({ target: chrome.runtime.onMessage, event: 'message', handler: msgHandler, isChromeListener: true });

    // Global keyboard shortcuts on the JT page:
    //   Alt+Shift+P → start single-pick picker
    //   Alt+Shift+M → start multi-view picker
    // Skip when picker is already active (Esc/Done/Cancel handle exit) or
    // when the user is typing in an editable field (avoid hijacking text input).
    const keyHandler = (e) => {
      if (!e.altKey || !e.shiftKey || pickerActive) return;
      const t = e.target;
      // If the user is editing text in JT (input, textarea, contenteditable),
      // don't steal the keystroke — they probably want their letter typed.
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || (t.isContentEditable))) return;
      const key = (e.key || '').toLowerCase();
      if (key === 'p') {
        e.preventDefault();
        e.stopPropagation();
        enterPickerMode({ multi: false });
      } else if (key === 'm') {
        e.preventDefault();
        e.stopPropagation();
        enterPickerMode({ multi: true });
      }
    };
    document.addEventListener('keydown', keyHandler, true);
    eventListeners.push({ target: document, event: 'keydown', handler: keyHandler, useCapture: true });

    console.log('InspectForAi: Initialized — Alt+click | Alt+Shift+P (pick) | Alt+Shift+M (multi-pick)');
  }

  // ============================================================
  // Picker mode — DevTools-style element selection with live highlight
  // ============================================================

  let pickerActive = false;
  let highlightEl = null;
  let infoEl = null;
  let lastHighlighted = null;
  let pickerStylesInjected = false;
  // Multi-pick session — captures contexts across view switches into one
  // combined markdown. null when single-pick (current behavior).
  let multiSession = null; // { captures: [{ ... }], paused: boolean, chipEl: HTMLElement }

  function injectPickerStyles() {
    if (pickerStylesInjected) return;
    const style = document.createElement('style');
    style.id = 'jt-tools-picker-styles';
    style.textContent = `
      .jt-tools-picker-outline {
        position: fixed;
        pointer-events: none;
        border: 2px solid #f08c00;
        background: rgba(240, 140, 0, 0.12);
        z-index: 2147483646;
        transition: all 60ms ease-out;
        box-sizing: border-box;
        box-shadow: 0 0 0 1px rgba(255, 255, 255, 0.6);
      }
      .jt-tools-picker-info {
        position: fixed;
        pointer-events: none;
        background: #2c2c2c;
        color: #e0e0e0;
        padding: 6px 10px;
        border: 1px solid #404040;
        border-radius: 4px;
        font: 11px ui-monospace, "Cascadia Code", Consolas, monospace;
        z-index: 2147483647;
        max-width: 360px;
        line-height: 1.45;
        box-shadow: 0 4px 12px rgba(0, 0, 0, 0.3);
      }
      .jt-tools-picker-info .jt-tools-picker-target {
        color: #f08c00;
        font-weight: 600;
      }
      .jt-tools-picker-info .jt-tools-picker-meta {
        color: #a0a0a0;
        margin-top: 2px;
        font-family: system-ui, sans-serif;
        font-size: 10px;
      }
      .jt-tools-picker-info .jt-tools-picker-hint {
        color: #b0b0b0;
        margin-top: 4px;
        padding-top: 4px;
        border-top: 1px solid #404040;
        font-family: system-ui, sans-serif;
        font-size: 10px;
      }
      html.jt-tools-picker-active,
      html.jt-tools-picker-active * {
        cursor: crosshair !important;
      }
      html.jt-tools-picker-paused,
      html.jt-tools-picker-paused * {
        cursor: auto !important;
      }
      .jt-tools-multi-chip {
        position: fixed;
        bottom: 20px;
        right: 20px;
        background: #2c2c2c;
        color: #e0e0e0;
        border: 1px solid #404040;
        border-radius: 8px;
        padding: 10px 12px;
        font: 12px system-ui, -apple-system, sans-serif;
        z-index: 2147483647;
        display: flex;
        flex-direction: column;
        gap: 8px;
        box-shadow: 0 8px 24px rgba(0, 0, 0, 0.4);
        min-width: 240px;
      }
      .jt-tools-multi-chip-header {
        font-weight: 600;
        color: #f08c00;
      }
      .jt-tools-multi-chip-meta {
        color: #b0b0b0;
        font-size: 11px;
        line-height: 1.4;
      }
      .jt-tools-multi-chip-actions {
        display: flex;
        gap: 6px;
      }
      .jt-tools-multi-chip button {
        flex: 1;
        background: #333333;
        color: #e0e0e0;
        border: 1px solid #505050;
        border-radius: 4px;
        padding: 6px 10px;
        font: inherit;
        cursor: pointer;
      }
      .jt-tools-multi-chip button:hover { background: #3a3a3a; }
      .jt-tools-multi-chip button.primary {
        background: #f08c00;
        color: #fff;
        border-color: #f08c00;
      }
      .jt-tools-multi-chip button.primary:hover { background: #d97706; }
      .jt-tools-multi-chip button:disabled {
        opacity: 0.4;
        cursor: not-allowed;
      }
    `;
    document.head.appendChild(style);
    pickerStylesInjected = true;
  }

  function enterPickerMode(opts) {
    opts = opts || {};
    if (pickerActive) return;
    if (!window.JTFinder) {
      showToast('Selector library not loaded', true);
      return;
    }
    pickerActive = true;
    injectPickerStyles();

    highlightEl = document.createElement('div');
    highlightEl.className = 'jt-tools-picker-outline';
    document.body.appendChild(highlightEl);

    infoEl = document.createElement('div');
    infoEl.className = 'jt-tools-picker-info';
    infoEl.textContent = opts.multi
      ? 'Multi-view mode: click an element, switch JT views, click another. Done when finished.'
      : 'Move your mouse over an element. Click to capture, Esc to cancel.';
    document.body.appendChild(infoEl);

    document.documentElement.classList.add('jt-tools-picker-active');

    // mousemove updates highlight; capture-phase click commits; keydown handles Esc
    document.addEventListener('mousemove', onPickerMouseMove, true);
    document.addEventListener('click', onPickerClick, true);
    document.addEventListener('keydown', onPickerKeyDown, true);
    // Reposition highlight on scroll/resize so it stays glued to the target
    window.addEventListener('scroll', onPickerScrollOrResize, true);
    window.addEventListener('resize', onPickerScrollOrResize, true);

    if (opts.multi) {
      multiSession = { captures: [], paused: false, chipEl: null };
      renderMultiChip();
    }

    console.log('InspectForAi: Picker mode active', opts.multi ? '(multi)' : '');
  }

  // ---------- Multi-pick: floating chip with Pause / Done / Cancel ----------

  function renderMultiChip() {
    if (!multiSession || multiSession.chipEl) return;
    const chip = document.createElement('div');
    chip.className = 'jt-tools-multi-chip';

    const header = document.createElement('div');
    header.className = 'jt-tools-multi-chip-header';
    header.textContent = 'Pick across views';
    chip.appendChild(header);

    const meta = document.createElement('div');
    meta.className = 'jt-tools-multi-chip-meta';
    chip.appendChild(meta);

    const actions = document.createElement('div');
    actions.className = 'jt-tools-multi-chip-actions';

    const pauseBtn = document.createElement('button');
    pauseBtn.textContent = 'Pause';
    pauseBtn.title = 'Pause picking so you can click JobTread normally (e.g. switch views)';
    pauseBtn.addEventListener('click', toggleMultiPause);
    actions.appendChild(pauseBtn);

    const doneBtn = document.createElement('button');
    doneBtn.textContent = 'Done';
    doneBtn.className = 'primary';
    doneBtn.disabled = true;
    doneBtn.addEventListener('click', finalizeMultiSession);
    actions.appendChild(doneBtn);

    const cancelBtn = document.createElement('button');
    cancelBtn.textContent = 'Cancel';
    cancelBtn.addEventListener('click', () => {
      showToast('Multi-pick cancelled');
      exitPickerMode();
    });
    actions.appendChild(cancelBtn);

    chip.appendChild(actions);
    document.body.appendChild(chip);
    multiSession.chipEl = chip;
    multiSession.metaEl = meta;
    multiSession.pauseBtn = pauseBtn;
    multiSession.doneBtn = doneBtn;
    updateMultiChip();
  }

  function updateMultiChip() {
    if (!multiSession || !multiSession.chipEl) return;
    const n = multiSession.captures.length;
    const paths = Array.from(new Set(multiSession.captures.map(c => c.path))).slice(0, 3);
    const pathHint = paths.length ? ' across ' + paths.length + ' path' + (paths.length === 1 ? '' : 's') : '';
    if (multiSession.paused) {
      multiSession.metaEl.textContent = 'Paused — click anywhere on JT (switch views, scroll, etc). Resume to keep picking. ' + n + ' captured' + pathHint + '.';
      multiSession.pauseBtn.textContent = 'Resume';
    } else {
      multiSession.metaEl.textContent = n === 0
        ? 'Click an element to capture. Switch JT views between captures.'
        : n + ' captured' + pathHint + '. Pick another, or press Done.';
      multiSession.pauseBtn.textContent = 'Pause';
    }
    multiSession.doneBtn.disabled = n === 0;
  }

  function toggleMultiPause() {
    if (!multiSession) return;
    multiSession.paused = !multiSession.paused;
    if (multiSession.paused) {
      // Hide the highlight + info card, drop the crosshair cursor, and stop
      // intercepting clicks so the user can navigate JT freely.
      if (highlightEl) highlightEl.style.display = 'none';
      if (infoEl) infoEl.style.display = 'none';
      document.documentElement.classList.remove('jt-tools-picker-active');
      document.documentElement.classList.add('jt-tools-picker-paused');
    } else {
      if (highlightEl) highlightEl.style.display = '';
      if (infoEl) infoEl.style.display = '';
      document.documentElement.classList.add('jt-tools-picker-active');
      document.documentElement.classList.remove('jt-tools-picker-paused');
    }
    updateMultiChip();
  }

  function finalizeMultiSession() {
    if (!multiSession || !multiSession.captures.length) return;
    const md = formatMultiViewMarkdown(multiSession.captures);
    const count = multiSession.captures.length;
    navigator.clipboard.writeText(md)
      .then(() => showToast('Copied ' + count + '-capture multi-view context for AI'))
      .catch(() => showToast('Clipboard write failed', true));
    exitPickerMode();
  }

  function exitPickerMode() {
    if (!pickerActive) return;
    pickerActive = false;
    document.removeEventListener('mousemove', onPickerMouseMove, true);
    document.removeEventListener('click', onPickerClick, true);
    document.removeEventListener('keydown', onPickerKeyDown, true);
    window.removeEventListener('scroll', onPickerScrollOrResize, true);
    window.removeEventListener('resize', onPickerScrollOrResize, true);
    if (highlightEl && highlightEl.parentNode) highlightEl.parentNode.removeChild(highlightEl);
    if (infoEl && infoEl.parentNode) infoEl.parentNode.removeChild(infoEl);
    highlightEl = null;
    infoEl = null;
    lastHighlighted = null;
    document.documentElement.classList.remove('jt-tools-picker-active');
    document.documentElement.classList.remove('jt-tools-picker-paused');
    if (multiSession) {
      if (multiSession.chipEl && multiSession.chipEl.parentNode) {
        multiSession.chipEl.parentNode.removeChild(multiSession.chipEl);
      }
      multiSession = null;
    }
    console.log('InspectForAi: Picker mode exited');
  }

  function onPickerMouseMove(e) {
    if (!pickerActive) return;
    if (multiSession && multiSession.paused) return; // paused: let JT receive hover events normally
    // Find the real element under the cursor (excluding our own overlay nodes)
    let el = document.elementFromPoint(e.clientX, e.clientY);
    if (!el) return;
    if (el === highlightEl || el === infoEl) return;
    // Don't highlight extension chrome (alert modals, editor pages, multi-pick chip, etc.)
    if (el.closest && el.closest('.jt-tools-popup, .jt-tools-picker-info, .jt-tools-picker-outline, .jt-tools-multi-chip, .jt-tweak-edit-, .jt-tweak-alert-overlay, .jt-tools-inspect-toast')) {
      return;
    }
    if (el === lastHighlighted) {
      // Same target — only update info card position (cursor moved within the box)
      positionInfoCard(e.clientX, e.clientY);
      return;
    }
    lastHighlighted = el;
    positionHighlight(el);
    renderInfoCard(el);
    positionInfoCard(e.clientX, e.clientY);
  }

  function onPickerScrollOrResize() {
    if (lastHighlighted && pickerActive) positionHighlight(lastHighlighted);
  }

  function positionHighlight(el) {
    if (!highlightEl) return;
    const rect = el.getBoundingClientRect();
    highlightEl.style.left = rect.left + 'px';
    highlightEl.style.top = rect.top + 'px';
    highlightEl.style.width = rect.width + 'px';
    highlightEl.style.height = rect.height + 'px';
  }

  function renderInfoCard(el) {
    if (!infoEl) return;
    // Build a compact element label: <tag.class1.class2>
    const tag = el.tagName.toLowerCase();
    const classes = (el.className && typeof el.className === 'string')
      ? el.className.split(/\s+/).filter(c => c && !TAILWIND_PREFIX_RE.test(c)).slice(0, 3)
      : [];
    const label = '<' + tag + (classes.length ? '.' + classes.join('.') : '') + '>';
    // Count what the capture will include so the user knows the full context scope
    let ancestorCount = 0;
    let cur = el.parentElement;
    while (cur && ancestorCount < 2) { ancestorCount++; cur = cur.parentElement; }
    const descCount = el.firstElementChild ? Math.min(2, depthCount(el, 2)) : 0;

    // Use textContent on a single child span to avoid innerHTML — build separately
    while (infoEl.firstChild) infoEl.removeChild(infoEl.firstChild);
    const target = document.createElement('div');
    target.className = 'jt-tools-picker-target';
    target.textContent = label;
    infoEl.appendChild(target);

    const meta = document.createElement('div');
    meta.className = 'jt-tools-picker-meta';
    meta.textContent = 'Will include: ' + ancestorCount + ' ancestor' + (ancestorCount === 1 ? '' : 's')
      + ', up to ' + descCount + ' descendant' + (descCount === 1 ? '' : 's');
    infoEl.appendChild(meta);

    const hint = document.createElement('div');
    hint.className = 'jt-tools-picker-hint';
    hint.textContent = 'Click to capture · Esc to cancel';
    infoEl.appendChild(hint);
  }

  // Counts depth of descendants up to maxDepth, following firstElementChild
  function depthCount(el, maxDepth) {
    let d = 0;
    let cur = el.firstElementChild;
    while (cur && d < maxDepth) { d++; cur = cur.firstElementChild; }
    return d;
  }

  function positionInfoCard(mouseX, mouseY) {
    if (!infoEl) return;
    const cardRect = infoEl.getBoundingClientRect();
    const cardW = cardRect.width || 280;
    const cardH = cardRect.height || 60;
    const margin = 14;
    let x = mouseX + margin;
    let y = mouseY + margin;
    if (x + cardW > window.innerWidth - 8) x = mouseX - cardW - margin;
    if (y + cardH > window.innerHeight - 8) y = mouseY - cardH - margin;
    if (x < 8) x = 8;
    if (y < 8) y = 8;
    infoEl.style.left = x + 'px';
    infoEl.style.top = y + 'px';
  }

  function onPickerClick(e) {
    if (!pickerActive) return;
    if (multiSession && multiSession.paused) return; // pass through — user is navigating JT
    // Don't intercept clicks on the multi-pick chip (Pause/Done/Cancel buttons)
    if (e.target && e.target.closest && e.target.closest('.jt-tools-multi-chip')) return;
    e.preventDefault();
    e.stopPropagation();
    if (typeof e.stopImmediatePropagation === 'function') e.stopImmediatePropagation();
    const el = lastHighlighted || document.elementFromPoint(e.clientX, e.clientY);
    if (!el) return;
    if (multiSession) {
      // Add to session, don't exit picker — let user switch JT views and pick again
      multiSession.captures.push(buildCaptureContext(el));
      lastHighlighted = null;
      updateMultiChip();
    } else {
      captureAndCopy(el);
      exitPickerMode();
    }
  }

  function onPickerKeyDown(e) {
    if (!pickerActive) return;
    if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      exitPickerMode();
      showToast('Picker cancelled');
    }
  }

  function captureAndCopy(el) {
    if (!window.JTFinder) {
      showToast('Selector library not loaded', true);
      return;
    }
    let selector;
    try {
      selector = window.JTFinder(el, {
        className: (n) => !TAILWIND_PREFIX_RE.test(n),
        tagName: () => true,
        seedMinLength: 1,
        optimizedMinLength: 2
      });
    } catch (err) {
      console.error('InspectForAi: finder failed', err);
      showToast('Could not generate selector', true);
      return;
    }

    const md = formatMarkdown(el, selector);
    navigator.clipboard.writeText(md)
      .then(() => showToast('Copied AI-ready tweak request — paste into any AI chat'))
      .catch((err) => {
        console.error('InspectForAi: clipboard write failed', err);
        showToast('Clipboard write failed', true);
      });
  }

  /**
   * Build a structured capture context for one element. Used by multi-pick:
   * each captured element produces one of these, and they're combined into
   * a single markdown payload at session end.
   */
  function buildCaptureContext(el) {
    let selector = '';
    try {
      selector = window.JTFinder(el, {
        className: (n) => !TAILWIND_PREFIX_RE.test(n),
        tagName: () => true,
        seedMinLength: 1,
        optimizedMinLength: 2
      });
    } catch (err) {
      selector = el.tagName.toLowerCase();
    }
    const tag = el.tagName.toLowerCase();
    const classes = el.className && typeof el.className === 'string' ? el.className.split(/\s+/).filter(Boolean) : [];
    const dataAttrs = collectDataAttrs(el);
    const ancestors = collectAncestors(el, 2);
    const descendants = collectDescendants(el, 3);
    const stateIndicators = findStateIndicators(el);
    return {
      selector,
      snippet: '<' + tag + (classes.length ? ' class="' + classes.join(' ') + '"' : '') + (dataAttrs ? ' ' + dataAttrs : '') + '>',
      ancestors,
      descendants,
      stateIndicators,
      path: window.location.pathname,
      // Capture the URL search/hash too — JT uses them for view switches
      // (e.g. ?view=gantt). The AI may need both to scope onEvent properly.
      pathWithQuery: window.location.pathname + window.location.search + window.location.hash
    };
  }

  /**
   * Format N captures (from multi-pick mode) into a single markdown payload.
   * Tells the AI: produce ONE JSON tweak that works across all captures —
   * either with a single broad selector or with multiple action entries.
   */
  function formatMultiViewMarkdown(captures) {
    const orgName = window.OrgDetector ? window.OrgDetector.getActiveOrg() : '(unknown)';
    const lines = [
      '## JT Power Tools — Multi-view Tweak request for AI',
      '',
      '**Context:** I am a JobTread user (no coding experience). I want a SINGLE tweak that works across multiple JobTread views (e.g. table, Gantt, month). Below are ' + captures.length + ' captures from different views/pages. Reply with ONE JSON object I can paste into the JT Power Tools popup\'s "Paste from AI" dialog. JSON only, no prose.',
      '',
      '**What I want:** _<replace this with a plain-English description — e.g. "warn me before I drag a completed task in any schedule view">_',
      '',
      '**Active org (use this exact string in scope.jtOrg):** ' + orgName,
      '',
      '---',
      ''
    ];

    captures.forEach((cap, i) => {
      lines.push('### Capture ' + (i + 1) + ' — `' + cap.pathWithQuery + '`');
      lines.push('');
      lines.push('**Target selector:** `' + cap.selector + '`');
      lines.push('');
      lines.push('**Target element:** `' + cap.snippet + '`');
      lines.push('');
      lines.push('**Ancestor chain (closest first):**');
      lines.push(cap.ancestors.map((a, j) => `${j + 1}. \`${a}\``).join('\n') || '(none)');
      lines.push('');
      lines.push('**Descendants (breadth-first, depth 3, full classes):**');
      lines.push(cap.descendants.length ? cap.descendants.map(d => `- \`${d}\``).join('\n') : '(none)');
      if (cap.stateIndicators.length) {
        lines.push('');
        lines.push('**Visual state indicators in this subtree:**');
        lines.push(cap.stateIndicators.map(s => `- \`${s.selector}\` — \`${s.snippet}\``).join('\n'));
      }
      lines.push('');
      lines.push('---');
      lines.push('');
    });

    lines.push('**How to combine these into one tweak:**');
    lines.push('');
    lines.push('1. Look for shared state indicators across captures (e.g. `opacity-40`, `line-through`). If they all use the same indicator, ONE selector with `:has(.indicator)` may catch every view.');
    lines.push('2. If the views truly differ, emit MULTIPLE action entries in the `actions` array — one per view. The engine applies all of them; non-matching ones are no-ops.');
    lines.push('3. Set `scope.urlMatch` to the broadest substring shared by every captured path (e.g. `/schedule` if all captures are under that). Selectors do the per-view discrimination.');
    lines.push('');
    lines.push('**Schema (use these fields):**');
    lines.push('');
    lines.push('```');
    lines.push('{');
    lines.push('  "id": "<a fresh uuid v4 — generate one, e.g. ' + (typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : '00000000-0000-4000-8000-000000000000') + '>",');
    lines.push('  "name": "<short name>",');
    lines.push('  "description": "<one-line description>",');
    lines.push('  "version": 1,');
    lines.push('  "enabled": true,');
    lines.push('  "scope": { "jtOrg": "' + orgName + '", "urlMatch": "<broadest shared path substring>" },');
    lines.push('  "actions": [');
    lines.push('    { "type": "onEvent", "selector": "...", "event": "click|dblclick|mousedown|dragstart",');
    lines.push('      "preventDefault": true, "stopPropagation": false,');
    lines.push('      "alert": { "title": "...", "body": "...", "confirmLabel": "OK" } }');
    lines.push('    // ... add one entry per view if needed');
    lines.push('  ]');
    lines.push('}');
    lines.push('');
    lines.push('Allowed action verbs: addClass, removeClass, setStyle, hide, show, setText, onEvent, moveBefore, moveAfter, sortChildren.');
    lines.push('Do NOT use innerHTML, insertHTML, insertElement, or any verb not in that list.');
    lines.push('Selectors must NOT contain .jt-tools-, .jt-popup-, or .jt-tweak-edit- prefixes.');
    lines.push('setText cannot relabel primary-action buttons (Approve / Delete / Pay / Submit / Send / Sign / etc.) — engine refuses as anti-clickjacking guard.');
    lines.push('```');
    lines.push('');
    lines.push('_Copied by JT Power Tools — Inspect for AI (multi-view)_');

    return lines.join('\n');
  }

  function formatMarkdown(el, selector) {
    const tag = el.tagName.toLowerCase();
    const classes = el.className && typeof el.className === 'string' ? el.className.split(/\s+/).filter(Boolean) : [];
    const dataAttrs = collectDataAttrs(el);
    const ancestors = collectAncestors(el, 2);
    const descendants = collectDescendants(el, 3);
    const stateIndicators = findStateIndicators(el);
    const orgName = window.OrgDetector ? window.OrgDetector.getActiveOrg() : '(unknown)';
    const path = window.location.pathname;

    return [
      '## JT Power Tools — Tweak request for AI',
      '',
      '**Context:** I am a JobTread user (no coding experience). I use the JT Power Tools Chrome extension. I want to author a tweak for the page below. After the DOM context I paste my request in plain English. Reply with a single JSON object that I can paste into the JT Power Tools popup\'s "Paste from AI" dialog. Do NOT include any prose, code fences, or surrounding text — JSON only.',
      '',
      '**What I want:** _<replace this with a plain-English description of what should happen — e.g. "warn me when I try to drag a completed task">_',
      '',
      '---',
      '',
      '**Active org (use this exact string in scope.jtOrg):** ' + orgName,
      '**Path:** ' + path,
      '',
      '**Target selector (recommended):** `' + selector + '`',
      '',
      '**Target element:** `<' + tag + (classes.length ? ' class="' + classes.join(' ') + '"' : '') + (dataAttrs ? ' ' + dataAttrs : '') + '>`',
      '',
      '**Ancestor chain (closest first):**',
      ancestors.map((a, i) => `${i + 1}. \`${a}\``).join('\n'),
      '',
      '**Descendants (breadth-first, depth 3, full classes):**',
      descendants.length ? descendants.map(d => `- \`${d}\``).join('\n') : '(none)',
      '',
      stateIndicators.length
        ? '**Visual state indicators detected in this subtree** (use these to write `:has(...)` selectors that target a specific state — e.g. completed, disabled, faded):\n' + stateIndicators.map(s => `- \`${s.selector}\` — element: \`${s.snippet}\``).join('\n') + '\n'
        : '',
      '---',
      '',
      '**Schema instructions for the AI:**',
      '',
      'Respond with a JSON object matching this schema:',
      '',
      '```',
      '{',
      '  "id": "<a fresh uuid v4 — generate one, e.g. ' + (typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : '00000000-0000-4000-8000-000000000000') + '>",',
      '  "name": "<short name for the tweak>",',
      '  "enabled": true,',
      '  "description": "<one-line description>",',
      '  "version": 1,',
      '  "scope": { "jtOrg": "' + orgName + '", "urlMatch": "<URL substring like /schedule>" },',
      '  "css": "<optional CSS — every selector is auto-scoped to the tweak\'s elements>",',
      '  "actions": [ <optional array of action objects, see verbs below> ]',
      '}',
      '',
      'Allowed action verbs (closed list):',
      '  { "type": "addClass",    "selector": "...", "class": "..." }',
      '  { "type": "removeClass", "selector": "...", "class": "..." }',
      '  { "type": "setStyle",    "selector": "...", "style": { "property": "value" } }   // simple values only',
      '  { "type": "hide",        "selector": "..." }',
      '  { "type": "show",        "selector": "..." }',
      '  { "type": "setText",     "selector": "...", "text": "..." }',
      '  { "type": "onEvent",     "selector": "...", "event": "click|dblclick|mousedown|dragstart",',
      '                           "preventDefault": true, "stopPropagation": false,',
      '                           "alert": { "title": "...", "body": "...", "confirmLabel": "OK" } }',
      '  { "type": "moveBefore",  "selector": "...", "referenceSelector": "..." }   // move target to be the previous sibling of reference',
      '  { "type": "moveAfter",   "selector": "...", "referenceSelector": "..." }   // move target to be the next sibling of reference',
      '  { "type": "sortChildren", "selector": "<parent>", "childSelector": "<row>",',
      '                            "keySelector": "<inside row>", "key": "text|number|date",',
      '                            "direction": "asc|desc" }   // bulk-sort children of <parent>',
      '',
      'For "warn before action" patterns use onEvent with preventDefault: true + an alert.',
      'For "JT table has no sort" use sortChildren on the tbody — keySelector picks the column to sort by.',
      'setText cannot relabel primary-action buttons (Approve / Delete / Pay / Submit / Send / Sign / etc.) — engine refuses as anti-clickjacking guard.',
      'Do NOT use innerHTML, insertHTML, insertElement, or any verb not on the list above.',
      'Selectors must NOT contain .jt-tools-, .jt-popup-, or .jt-tweak-edit- prefixes.',
      'CSS values via setStyle must be simple (alphanumeric + space + - % .). For complex',
      'values like rgb(), calc(), or shorthand, put them in the css field instead.',
      '```',
      '',
      '_Copied by JT Power Tools — Inspect for AI_'
    ].join('\n');
  }

  function collectDataAttrs(el) {
    const attrs = [];
    for (const a of el.attributes || []) {
      if (a.name.startsWith('data-')) attrs.push(a.name + '="' + a.value + '"');
    }
    return attrs.join(' ');
  }

  function collectAncestors(el, depth) {
    const out = [];
    let cur = el.parentElement;
    let d = 0;
    while (cur && d < depth) {
      out.push(formatTagSnippet(cur));
      cur = cur.parentElement;
      d++;
    }
    return out;
  }

  /**
   * Breadth-first walk so the AI sees siblings, not just the first-child chain.
   * Capped at 15 elements to keep the markdown digestible. For descendants we
   * preserve FULL class lists (no Tailwind filtering) — the state classes the
   * AI needs to disambiguate UI states (opacity-40, line-through, etc.) live
   * in those classes, and dropping them robs the AI of the answer.
   */
  function collectDescendants(el, maxDepth) {
    const out = [];
    const queue = [{ node: el, depth: 0 }];
    const MAX_ELEMENTS = 15;
    while (queue.length && out.length < MAX_ELEMENTS) {
      const { node, depth } = queue.shift();
      if (depth >= maxDepth) continue;
      const children = node.children || [];
      for (const child of children) {
        if (out.length >= MAX_ELEMENTS) break;
        out.push(formatTagSnippet(child, /* preserveAllClasses */ true));
        queue.push({ node: child, depth: depth + 1 });
      }
    }
    return out;
  }

  /**
   * Scan the subtree for elements with classes that commonly indicate UI
   * state (opacity-*, line-through, disabled/completed/done/active markers).
   * Surface these as a dedicated section so the AI can immediately see what
   * pattern to target with `:has(...)`. JobTread, for example, marks a
   * completed task by setting `opacity-40` on the task-name input — without
   * this section the AI would have no way to know that.
   */
  function findStateIndicators(el) {
    const indicators = [];
    const STATE_CLASS_RE = /^(opacity-(?!1?00$)\d+|line-through|disabled|completed|done|complete|active|selected|inactive|striked?)$/i;
    const STATE_CLASS_CONTAINS = /(disabled|completed|done|inactive|striked?)/i;
    const all = el.querySelectorAll('*');
    const seenClasses = new Set();
    for (const node of all) {
      if (indicators.length >= 5) break;
      const cls = node.className && typeof node.className === 'string' ? node.className : '';
      if (!cls) continue;
      const tokens = cls.split(/\s+/);
      for (const t of tokens) {
        if (!t) continue;
        if (seenClasses.has(t)) continue;
        if (STATE_CLASS_RE.test(t) || STATE_CLASS_CONTAINS.test(t)) {
          seenClasses.add(t);
          indicators.push({
            selector: node.tagName.toLowerCase() + '.' + cssEscape(t),
            snippet: formatTagSnippet(node, true)
          });
          break;
        }
      }
    }
    return indicators;
  }

  // Minimal CSS.escape polyfill for the contexts we care about — escapes the
  // `/` in Tailwind group names like `group/row` and other selector-unsafe chars
  function cssEscape(ident) {
    if (window.CSS && typeof window.CSS.escape === 'function') return window.CSS.escape(ident);
    return ident.replace(/([!"#$%&'()*+,./:;<=>?@\[\\\]^`{|}~])/g, '\\$1');
  }

  function formatTagSnippet(el, preserveAllClasses) {
    const tag = el.tagName.toLowerCase();
    const allClasses = el.className && typeof el.className === 'string'
      ? el.className.split(/\s+/).filter(Boolean)
      : [];
    let cls;
    if (preserveAllClasses) {
      // Cap at 8 to keep the snippet readable
      cls = allClasses.slice(0, 8);
    } else {
      cls = allClasses.filter(c => !TAILWIND_PREFIX_RE.test(c)).slice(0, 4);
    }
    const dataAttrs = collectDataAttrs(el);
    return '<' + tag + (cls.length ? ' class="' + cls.join(' ') + '"' : '') + (dataAttrs ? ' ' + dataAttrs : '') + '>';
  }

  let toastEl = null;
  let toastTimer = null;
  function showToast(msg, isError = false) {
    if (!toastEl) {
      toastEl = document.createElement('div');
      toastEl.className = 'jt-tools-inspect-toast';
      toastEl.style.cssText = 'position:fixed;bottom:20px;right:20px;padding:10px 16px;background:#252525;color:#e0e0e0;border-radius:4px;border:1px solid #404040;font:13px system-ui;z-index:99999;box-shadow:0 4px 12px rgba(0,0,0,0.3);transition:opacity 200ms';
      document.body.appendChild(toastEl);
    }
    toastEl.textContent = msg;
    toastEl.style.borderColor = isError ? '#a02020' : '#404040';
    toastEl.style.opacity = '1';
    if (toastTimer) clearTimeout(toastTimer);
    toastTimer = setTimeout(() => {
      if (toastEl) toastEl.style.opacity = '0';
    }, 2000);
  }

  function cleanup() {
    if (!isActive) return;
    console.log('InspectForAi: Cleaning up...');
    // Exit picker mode first (it may have its own listeners + DOM nodes)
    if (pickerActive) exitPickerMode();
    eventListeners.forEach(({ target, event, handler, useCapture, isChromeListener }) => {
      if (isChromeListener) {
        target.removeListener(handler);
      } else {
        target.removeEventListener(event, handler, useCapture);
      }
    });
    eventListeners = [];
    if (toastEl && toastEl.parentNode) toastEl.parentNode.removeChild(toastEl);
    toastEl = null;
    if (toastTimer) clearTimeout(toastTimer);
    // Picker styles stay injected — they're inert without the active class.
    // Removing them on cleanup would just re-inject on next init().
    isActive = false;
    console.log('InspectForAi: Cleaned up');
  }

  return { init, cleanup, isActive: () => isActive };
})();

window.InspectForAiFeature = InspectForAiFeature;
