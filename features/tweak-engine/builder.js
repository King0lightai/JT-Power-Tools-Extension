/**
 * TweakBuilderFeature — in-page docked panel for point-and-click tweak
 * authoring. Listens for `jt-tweak-build` (capture from the picker),
 * renders intent -> form -> live preview (engine message) -> save.
 *
 * SAFETY: All DOM is built with document.createElement + textContent.
 * No innerHTML anywhere — selectors, names, and user text never touch
 * an HTML parser. Mirrors the construction style of system-banner.js.
 */
const TweakBuilderFeature = (() => {
  const PREVIEW_PLACEHOLDER_ID = '00000000-0000-4000-8000-000000000000';
  const INTENTS = [
    { id: 'rename', label: 'Rename text' },
    { id: 'hide', label: 'Hide element' },
    { id: 'restyle', label: 'Restyle' },
    { id: 'warn', label: 'Warn before click' },
    { id: 'sort', label: 'Sort list' },
    { id: 'move', label: 'Move element' }
  ];

  let isActive = false;
  let panel = null;
  let capture = null;
  let intent = null;
  const values = {};

  // Listeners that live for the whole feature lifetime (drained in cleanup()).
  const persistentListeners = [];
  // Listeners tied to the current open panel (drained in close()).
  let panelListeners = [];

  // Live references into the rendered panel, refreshed on each open().
  let formContainer = null;
  let safeLine = null;
  let nameInput = null;
  let summaryEl = null;
  let saveBtn = null;
  const intentButtons = [];

  // Registers a listener that survives close() — only removed in cleanup().
  function on(target, event, handler) {
    target.addEventListener(event, handler);
    persistentListeners.push({ target, event, handler });
  }

  // Registers a listener scoped to the current panel — removed in close().
  function onPanel(target, event, handler, useCapture) {
    const capture = useCapture || false;
    target.addEventListener(event, handler, capture);
    panelListeners.push({ target, event, handler, useCapture: capture });
  }

  function init() {
    if (isActive) return;
    isActive = true;
    injectStyles();
    on(window, 'jt-tweak-build', (e) => open(e.detail));
    // Side-panel Escape can't reach the panel's own keydown handler (focus is
    // in the side panel); inspect-for-ai relays a cancel here. close() no-ops
    // when no panel is open.
    on(window, 'jt-tweak-build-cancel', () => { if (panel) close(); });
    console.log('TweakBuilder: Initialized');
  }

  function injectStyles() {
    for (const file of ['styles/jt-tools-tokens.css', 'styles/tweak-builder.css']) {
      const id = 'jt-tweak-builder-' + file.replace(/\W/g, '-');
      if (document.getElementById(id)) continue;
      const link = document.createElement('link');
      link.id = id;
      link.rel = 'stylesheet';
      link.href = chrome.runtime.getURL(file);
      document.head.appendChild(link);
    }
  }

  function removeStyles() {
    for (const file of ['styles/jt-tools-tokens.css', 'styles/tweak-builder.css']) {
      const id = 'jt-tweak-builder-' + file.replace(/\W/g, '-');
      const el = document.getElementById(id);
      if (el) el.parentNode.removeChild(el);
    }
  }

  function open(ctx) {
    capture = ctx || {};
    intent = null;
    Object.keys(values).forEach((k) => delete values[k]);
    if (panel) close();
    panel = renderPanel();
    document.body.appendChild(panel);
    // Esc closes the builder. Capture phase at document so it fires even when
    // focus is in a form field and before JobTread handles the key. Tracked as
    // a panel listener so close() removes it.
    onPanel(document, 'keydown', onPanelKeyDown, true);
  }

  function onPanelKeyDown(e) {
    if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      close();
    }
  }

  function close() {
    // Drain panel listeners before touching the DOM so removeEventListener
    // still has a valid target reference (detached nodes work too, but
    // draining first is the cleanest order).
    panelListeners.forEach(({ target, event, handler, useCapture }) =>
      target.removeEventListener(event, handler, useCapture)
    );
    panelListeners = [];

    sendPreviewClear();
    if (panel && panel.parentNode) panel.parentNode.removeChild(panel);
    panel = null;
    capture = null;
    intent = null;
    formContainer = null;
    safeLine = null;
    nameInput = null;
    summaryEl = null;
    saveBtn = null;
    intentButtons.length = 0;
  }

  function cleanup() {
    if (!isActive) return;
    close(); // drains panelListeners
    persistentListeners.forEach(({ target, event, handler }) =>
      target.removeEventListener(event, handler)
    );
    persistentListeners.length = 0;
    removeStyles();
    isActive = false;
    console.log('TweakBuilder: Cleaned up');
  }

  // ─── Panel construction (Task 9) ────────────────────────────────────

  function renderPanel() {
    intentButtons.length = 0;

    const root = document.createElement('div');
    root.className = 'jt-tweak-builder jt-tools-surface';

    // Header: title + close button
    const header = document.createElement('div');
    header.className = 'jt-tweak-builder-header';

    const title = document.createElement('h2');
    title.className = 'jt-tweak-builder-title';
    title.textContent = 'Build a tweak';
    header.appendChild(title);

    const closeBtn = document.createElement('button');
    closeBtn.type = 'button';
    closeBtn.className = 'jt-tweak-builder-close';
    closeBtn.textContent = '×';
    closeBtn.setAttribute('aria-label', 'Close tweak builder');
    onPanel(closeBtn, 'click', close);
    header.appendChild(closeBtn);

    root.appendChild(header);

    // Body (scrollable)
    const body = document.createElement('div');
    body.className = 'jt-tweak-builder-body';

    // "You picked" chip
    const chip = document.createElement('div');
    chip.className = 'jt-tweak-builder-chip';
    const chipLabel = document.createElement('span');
    chipLabel.className = 'jt-tweak-builder-chip-label';
    chipLabel.textContent = 'You picked';
    const chipSelector = document.createElement('span');
    chipSelector.className = 'jt-tweak-builder-chip-selector';
    chipSelector.textContent = (capture && capture.selector) || '(no element)';
    chip.appendChild(chipLabel);
    chip.appendChild(chipSelector);
    body.appendChild(chip);

    // Active-org / scope line — always visible so the author knows which org
    // (and page) the tweak will apply to before saving.
    const scope = document.createElement('div');
    scope.className = 'jt-tweak-builder-scope';
    const activeOrg = window.OrgDetector ? window.OrgDetector.getActiveOrg() : null;
    const orgRow = document.createElement('div');
    orgRow.className = 'jt-tweak-builder-scope-org';
    const orgLabel = document.createElement('span');
    orgLabel.className = 'jt-tweak-builder-scope-label';
    orgLabel.textContent = 'Org';
    const orgValue = document.createElement('span');
    orgValue.className = 'jt-tweak-builder-scope-value';
    if (activeOrg) {
      orgValue.textContent = activeOrg;
    } else {
      orgValue.textContent = 'No active org — open a JobTread page';
      orgRow.classList.add('jt-tweak-builder-scope-warn');
    }
    orgRow.appendChild(orgLabel);
    orgRow.appendChild(orgValue);
    scope.appendChild(orgRow);
    const pageRow = document.createElement('div');
    pageRow.className = 'jt-tweak-builder-scope-page';
    pageRow.textContent = 'This page only (' + location.pathname + ')';
    scope.appendChild(pageRow);
    body.appendChild(scope);

    // Intent grid
    const intents = document.createElement('div');
    intents.className = 'jt-tweak-builder-intents';
    for (const def of INTENTS) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'jt-tweak-builder-intent';
      btn.textContent = def.label;
      btn.setAttribute('aria-pressed', 'false');
      btn.dataset.intent = def.id;
      onPanel(btn, 'click', () => selectIntent(def.id));
      intentButtons.push(btn);
      intents.appendChild(btn);
    }
    body.appendChild(intents);

    // Per-verb form container
    formContainer = document.createElement('div');
    formContainer.className = 'jt-tweak-builder-form';
    body.appendChild(formContainer);

    // Safe line (rename only)
    safeLine = document.createElement('div');
    safeLine.className = 'jt-tweak-builder-safe';
    safeLine.textContent = "Safe — won't relabel action/financial buttons";
    safeLine.style.display = 'none';
    body.appendChild(safeLine);

    // Name field
    const nameField = document.createElement('div');
    nameField.className = 'jt-tweak-builder-field';
    const nameLbl = document.createElement('label');
    nameLbl.className = 'jtt-label';
    nameLbl.textContent = 'Name';
    nameInput = document.createElement('input');
    nameInput.type = 'text';
    nameInput.className = 'jtt-input';
    nameInput.placeholder = 'Optional — a name is generated if blank';
    nameLbl.setAttribute('for', 'jt-tweak-builder-name');
    nameInput.id = 'jt-tweak-builder-name';
    nameField.appendChild(nameLbl);
    nameField.appendChild(nameInput);
    body.appendChild(nameField);

    // Live preview summary
    summaryEl = document.createElement('div');
    summaryEl.className = 'jt-tweak-builder-summary';
    renderSummary([], { ok: true });
    body.appendChild(summaryEl);

    root.appendChild(body);

    // Footer: Cancel + Save
    const footer = document.createElement('div');
    footer.className = 'jt-tweak-builder-footer';

    const cancelBtn = document.createElement('button');
    cancelBtn.type = 'button';
    cancelBtn.className = 'jtt-btn';
    cancelBtn.textContent = 'Cancel';
    onPanel(cancelBtn, 'click', close);
    footer.appendChild(cancelBtn);

    saveBtn = document.createElement('button');
    saveBtn.type = 'button';
    saveBtn.className = 'jtt-btn jtt-btn-primary';
    saveBtn.textContent = 'Save';
    saveBtn.disabled = true;
    onPanel(saveBtn, 'click', save);
    footer.appendChild(saveBtn);

    root.appendChild(footer);

    return root;
  }

  function selectIntent(id) {
    intent = id;
    Object.keys(values).forEach((k) => delete values[k]);
    for (const btn of intentButtons) {
      btn.setAttribute('aria-pressed', btn.dataset.intent === id ? 'true' : 'false');
    }
    if (safeLine) safeLine.style.display = id === 'rename' ? 'flex' : 'none';
    renderForm();
    updatePreview();
  }

  // ─── Per-verb forms (Task 9) ─────────────────────────────────────────

  function clearForm() {
    if (!formContainer) return;
    while (formContainer.firstChild) formContainer.removeChild(formContainer.firstChild);
  }

  function makeField(labelText) {
    const field = document.createElement('div');
    field.className = 'jt-tweak-builder-field';
    if (labelText) {
      const label = document.createElement('label');
      label.className = 'jtt-label';
      label.textContent = labelText;
      field.appendChild(label);
    }
    return field;
  }

  function makeTextInput(placeholder, key, initial) {
    const input = document.createElement('input');
    input.type = 'text';
    input.className = 'jtt-input';
    if (placeholder) input.placeholder = placeholder;
    if (initial !== undefined) {
      input.value = initial;
      values[key] = initial;
    }
    onPanel(input, 'input', () => {
      values[key] = input.value;
      updatePreview();
    });
    return input;
  }

  function makeSelect(options, key, initial) {
    const select = document.createElement('select');
    select.className = 'jtt-input';
    for (const opt of options) {
      const o = document.createElement('option');
      o.value = opt.value;
      o.textContent = opt.label;
      select.appendChild(o);
    }
    select.value = initial;
    values[key] = initial;
    onPanel(select, 'change', () => {
      values[key] = select.value;
      updatePreview();
    });
    return select;
  }

  function renderForm() {
    clearForm();
    if (!intent) return;

    if (intent === 'rename') {
      const field = makeField('New text');
      field.appendChild(makeTextInput('Trade Partner', 'text'));
      formContainer.appendChild(field);
    } else if (intent === 'hide') {
      const note = makeField('');
      const p = document.createElement('div');
      p.className = 'jtt-label';
      p.textContent = 'Hides the picked element.';
      note.appendChild(p);
      formContainer.appendChild(note);
    } else if (intent === 'restyle') {
      const colorField = makeField('Text color');
      colorField.appendChild(makeTextInput('#2c2c2c', 'color'));
      formContainer.appendChild(colorField);

      const sizeField = makeField('Font size');
      sizeField.appendChild(makeTextInput('14px', 'fontSize'));
      formContainer.appendChild(sizeField);

      const boldField = makeField('');
      const wrap = document.createElement('label');
      wrap.className = 'jt-tweak-builder-checkbox';
      const cb = document.createElement('input');
      cb.type = 'checkbox';
      onPanel(cb, 'change', () => {
        values.bold = cb.checked;
        updatePreview();
      });
      const cbLabel = document.createElement('span');
      cbLabel.textContent = 'Bold';
      wrap.appendChild(cb);
      wrap.appendChild(cbLabel);
      boldField.appendChild(wrap);
      formContainer.appendChild(boldField);
    } else if (intent === 'warn') {
      const field = makeField('Confirmation message');
      field.appendChild(makeTextInput('Are you sure?', 'confirm', 'Are you sure?'));
      formContainer.appendChild(field);
    } else if (intent === 'sort') {
      const keyField = makeField('Sort by');
      keyField.appendChild(makeSelect([
        { value: 'text', label: 'Text' },
        { value: 'number', label: 'Number' },
        { value: 'date', label: 'Date' }
      ], 'key', 'text'));
      formContainer.appendChild(keyField);

      const dirField = makeField('Direction');
      dirField.appendChild(makeSelect([
        { value: 'asc', label: 'Ascending' },
        { value: 'desc', label: 'Descending' }
      ], 'direction', 'asc'));
      formContainer.appendChild(dirField);
    } else if (intent === 'move') {
      const posField = makeField('Position');
      posField.appendChild(makeSelect([
        { value: 'before', label: 'Before reference' },
        { value: 'after', label: 'After reference' }
      ], 'position', 'before'));
      formContainer.appendChild(posField);

      const refField = makeField('Reference element selector');
      refField.appendChild(makeTextInput('.budget th:first-child', 'referenceSelector'));
      formContainer.appendChild(refField);
    }
  }

  // ─── Live preview (Task 10) ──────────────────────────────────────────

  function currentTweak() {
    if (!intent) return null;
    return window.TweakBuilderEmit.buildTweak({
      intent,
      values,
      capture,
      org: window.OrgDetector ? window.OrgDetector.getActiveOrg() : '',
      urlMatch: location.pathname,
      id: PREVIEW_PLACEHOLDER_ID,
      name: nameInput ? nameInput.value : ''
    });
  }

  function updatePreview() {
    const t = currentTweak();
    if (!t) {
      renderSummary([], { ok: true });
      if (saveBtn) saveBtn.disabled = true;
      sendPreviewClear();
      return;
    }
    const v = window.TweakValidator.validate(t);
    renderSummary(window.TweakDescribe.describe(t), v);
    if (v.ok) {
      // Use a window CustomEvent so the engine's listener in the same content
      // script isolated world receives it directly.  chrome.runtime.sendMessage
      // only reaches the background service worker, not sibling content scripts.
      window.dispatchEvent(new CustomEvent('jt-tweak-preview-apply', { detail: { tweak: t } }));
    } else {
      sendPreviewClear();
    }
  }

  function renderSummary(lines, validation) {
    if (!summaryEl) return;
    while (summaryEl.firstChild) summaryEl.removeChild(summaryEl.firstChild);

    if (!lines || lines.length === 0) {
      const empty = document.createElement('div');
      empty.className = 'jt-tweak-builder-summary-empty';
      empty.textContent = 'Pick what this tweak should do.';
      summaryEl.appendChild(empty);
    } else {
      for (const line of lines) {
        const row = document.createElement('div');
        row.className = 'jt-tweak-builder-summary-line';
        row.textContent = line;
        summaryEl.appendChild(row);
      }
    }

    const ok = !validation || validation.ok;
    if (!ok && validation.errors && validation.errors.length) {
      const err = document.createElement('div');
      err.className = 'jt-tweak-builder-error';
      err.textContent = validation.errors[0].reason;
      summaryEl.appendChild(err);
    }
    if (saveBtn) saveBtn.disabled = !ok || !intent;
  }

  function sendPreviewClear() {
    try {
      // Same isolated-world IPC path as apply: CustomEvent on window.
      window.dispatchEvent(new CustomEvent('jt-tweak-preview-clear'));
    } catch (_) {
      // best-effort — engine may not be listening (e.g. mid-teardown)
    }
  }

  // ─── Save (Task 11) ──────────────────────────────────────────────────

  function showError(reason) {
    renderSummary(intent ? window.TweakDescribe.describe(currentTweak() || {}) : [], {
      ok: false,
      errors: [{ field: '', reason }]
    });
  }

  // Server-first (best effort): returns the server's canonical tweak when
  // available, else the input tweak unchanged. Never throws.
  async function saveToServer(tweak) {
    if (!(window.TweaksApi && window.TweaksApi.isAvailable())) return tweak;
    try {
      const result = await window.TweaksApi.create(tweak);
      if (result && result.tweak) return result.tweak;
    } catch (err) {
      console.warn('TweakBuilder: server save failed, saving locally only:', err && err.message);
    }
    return tweak;
  }

  // Write-through to the local cache so the engine's storage-change listener
  // applies the real (non-preview) tweak.
  async function saveToLocal(tweak) {
    const stored = await chrome.storage.local.get(['jtTweaks']);
    const list = Array.isArray(stored.jtTweaks) ? stored.jtTweaks : [];
    list.push(tweak);
    await chrome.storage.local.set({ jtTweaks: list });
  }

  async function save() {
    const org = window.OrgDetector ? window.OrgDetector.getActiveOrg() : '';
    if (!org) {
      showError('No active JobTread org detected — open a JobTread page first.');
      return;
    }
    const id = (typeof crypto !== 'undefined' && crypto.randomUUID) ? crypto.randomUUID() : null;
    if (!id) {
      showError('Could not generate a tweak id on this browser.');
      return;
    }
    const tweak = window.TweakBuilderEmit.buildTweak({
      intent,
      values,
      capture,
      org,
      urlMatch: location.pathname,
      id,
      name: (nameInput && nameInput.value.trim()) || undefined
    });
    const v = window.TweakValidator.validate(tweak);
    if (!v.ok) {
      showError(v.errors[0].reason);
      return;
    }

    const canonical = await saveToServer(tweak);
    try {
      await saveToLocal(canonical);
    } catch (err) {
      console.error('TweakBuilder: failed to write tweak to local storage:', err);
      showError('Could not save the tweak locally.');
      return;
    }

    sendPreviewClear();
    close();
  }

  return {
    init,
    cleanup,
    isActive: () => isActive,
    _internals: { open, close }
  };
})();

if (typeof window !== 'undefined') window.TweakBuilderFeature = TweakBuilderFeature;
