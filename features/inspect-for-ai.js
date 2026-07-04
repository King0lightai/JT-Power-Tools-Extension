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

  // Tags that mean "this element is a structural container worth showing in
  // a structural-block dump." Used by findStableAncestor.
  const STRUCTURAL_TAGS = new Set([
    'main', 'section', 'nav', 'header', 'footer', 'article', 'aside',
    'table', 'tbody', 'thead', 'tfoot', 'tr',
    'ul', 'ol', 'dl', 'form', 'dialog'
  ]);
  // Tailwind/CSS classes that strongly imply a structural / layout role —
  // sticky bars, scroll containers, grid/flex layouts, etc. The whole point
  // of including the structural block is to disambiguate sibling containers
  // that share class names (e.g. JT's documents page header vs body), so
  // these are exactly the kinds of class signatures we want to pivot on.
  const STRUCTURAL_CLASS_RE = /^(sticky|fixed|absolute|grid$|grid-|flex$|flex-row|flex-col|overflow-|scroll-|table$|table-|min-w-max|max-h-)/;
  const MAX_STRUCTURAL_BLOCK_BYTES = 2048;
  const STRUCTURAL_MAX_DEPTH_UP = 4;
  const TARGET_MARKER_ATTR = 'data-jt-tools-target-marker';

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
      if (message && message.type === 'INSPECT_PICK_FOR_BUILDER') {
        enterPickerMode({ multi: false, forBuilder: true });
        sendResponse({ ok: true });
        return false;
      }
      if (message && message.type === 'TWEAK_OPEN_REPAIR') {
        // Repair flow (C2): arm the builder picker carrying the broken tweak.
        // buildCaptureContext on the re-picked element flows into jt-tweak-build
        // with this tweak so the builder saves an update (same id).
        pendingRepairTweak = (message.tweak && typeof message.tweak === 'object') ? message.tweak : null;
        enterPickerMode({ multi: false, forBuilder: true });
        sendResponse({ ok: true });
        return false;
      }
      if (message && message.type === 'JT_TWEAK_CANCEL') {
        // Sent by the popup when it's pinned as a side panel: keyboard focus
        // stays in the side panel, so this page never sees the Escape keydown.
        // Cancel the crosshair (if active) and tell the builder panel to close.
        if (pickerActive) {
          exitPickerMode();
          showToast('Cancelled');
        }
        window.dispatchEvent(new CustomEvent('jt-tweak-build-cancel'));
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
  let pickerForBuilder = false;
  // Set when the popup asks to repair an auto-disabled tweak: the picked
  // element's context is forwarded to the builder alongside this tweak so it
  // reopens pre-loaded and saves as an update (same id). Cleared on exit.
  let pendingRepairTweak = null;
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
    pickerForBuilder = !!opts.forBuilder;
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
    pickerForBuilder = false;
    // Clear repair state — the dispatch above already copied it onto the ctx.
    // If the picker was cancelled (Esc) it's simply discarded, as intended.
    pendingRepairTweak = null;
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
    const el = document.elementFromPoint(e.clientX, e.clientY);
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
      if (pickerForBuilder) {
        const ctx = buildCaptureContext(el);
        // Repair flow (C2): carry the broken tweak so the builder reopens
        // pre-loaded and saves as an update (same id) instead of a new tweak.
        if (pendingRepairTweak) ctx.repairTweak = pendingRepairTweak;
        window.dispatchEvent(new CustomEvent('jt-tweak-build', { detail: ctx }));
        exitPickerMode();
      } else {
        captureAndCopy(el);
        exitPickerMode();
      }
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
    const structuralBlock = safeBuildStructuralBlock(el);
    const siblingContext = describeSiblingContext(el);
    return {
      selector,
      selectorCandidates: buildSelectorCandidates(el, selector),
      snippet: '<' + tag + (classes.length ? ' class="' + classes.join(' ') + '"' : '') + (dataAttrs ? ' ' + dataAttrs : '') + '>',
      ancestors,
      descendants,
      stateIndicators,
      structuralBlock,
      siblingContext,
      path: window.location.pathname,
      // Capture the URL search/hash too — JT uses them for view switches
      // (e.g. ?view=gantt). The AI may need both to scope onEvent properly.
      pathWithQuery: window.location.pathname + window.location.search + window.location.hash
    };
  }

  // Generate up to 3 fallback selectors for the same element via alternate
  // finder profiles, so a builder-authored tweak is resilient by default: if
  // JobTread's next release breaks the primary selector, the engine falls
  // back to a candidate instead of the tweak silently dying (spec C1). The
  // structural profile (no classes → tag + nth-child path) survives class
  // renames; the class-heavy profile survives DOM reparenting. Deduped
  // against the primary and each other. finder can throw when it can't find a
  // unique selector — each profile is guarded and simply skipped on failure.
  // The validator (client + server) re-checks every candidate on save; these
  // profiles only ever emit ordinary element selectors, so they pass.
  function buildSelectorCandidates(el, primary) {
    const profiles = [
      // Structural: ignore all classes, lean on tag names + nth-child.
      { className: () => false, tagName: () => true, seedMinLength: 1, optimizedMinLength: 2 },
      // Class-aware but more anchored (longer optimized path) than the primary.
      { className: (n) => !TAILWIND_PREFIX_RE.test(n), tagName: () => true, seedMinLength: 2, optimizedMinLength: 3 },
    ];
    const out = [];
    for (const opts of profiles) {
      let sel;
      try {
        sel = window.JTFinder(el, opts);
      } catch (err) {
        continue;
      }
      if (!sel || sel === primary || out.includes(sel)) continue;
      if (sel.length > 500 || sel.includes('.jt-tools-') || sel.includes('.jt-popup-')) continue;
      out.push(sel);
      if (out.length >= 3) break;
    }
    return out;
  }

  // Wraps buildStructuralBlock with a try/catch so a serialization failure
  // (e.g. shadow DOM weirdness) never breaks the rest of the capture.
  function safeBuildStructuralBlock(el) {
    try {
      return buildStructuralBlock(el);
    } catch (err) {
      console.warn('InspectForAi: structural-block build failed', err);
      return null;
    }
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
      if (cap.siblingContext) {
        lines.push('**Sibling context:** parent has ' + cap.siblingContext.total + ' children, '
          + cap.siblingContext.sameSignature + ' match the target\'s tag+class signature.'
          + (cap.siblingContext.sameSignature > 1
            ? ' (Look-alike siblings exist — selector must disambiguate.)'
            : ''));
        lines.push('');
      }
      if (cap.structuralBlock) {
        lines.push('**Structural parent block** (target marked with `data-jt-target=""`):');
        lines.push('');
        lines.push('```html');
        lines.push(cap.structuralBlock);
        lines.push('```');
        lines.push('');
      }
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
    lines.push('4. **Use the Structural parent block in each capture to verify your selector is unique within that view.** The target element is marked with `data-jt-target=""`. If you see other elements inside the block that would match your candidate selector, qualify with a unique ancestor or `:nth-child(N)`. The **Sibling context** line tells you up front whether the target is one of N look-alike siblings.');
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
    lines.push('Allowed action verbs: addClass, removeClass, setStyle, hide, show, setText, onEvent, confirmBeforeAction, moveBefore, moveAfter, sortChildren.');
    lines.push('confirmBeforeAction { type: "confirmBeforeAction", selector, event: "click|dblclick|submit", confirm: "Are you sure?" } gates a destructive click/submit — it shows a confirm() BEFORE the app\'s handler runs (Cancel blocks, OK proceeds untouched). It is the only verb that can conditionally let the original action through; prefer it over onEvent for "warn before X".');
    lines.push('onEvent supports an optional `then: [ <Action>, ... ]` array (V1.7) — chained DOM-mutation actions that run after preventDefault/alert. Use this for "click triggers state change" patterns (sortable headers, toggleable rows). Nested onEvent inside then[] is forbidden. Max 20 then-steps.');
    lines.push('Every action also accepts an optional `match: "<substring>"` (≤200 chars) — a per-element guard. The engine fires the action only on elements whose textContent contains that substring. Use it when a selector is broader than you want (e.g. setText "Vendor" → "Trade Partner" only on cells whose current text contains "Vendor").');
    lines.push('Every action also accepts an optional `matchDate: { min?, max?, attr?, selector? }` — a per-element date guard (inclusive day offsets from today: 0 = today, -1 = yesterday, 2 = in two days; attr defaults to "datetime"). Pair with addClass + a css rule to shade rows by due date.');
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
    const structuralBlock = safeBuildStructuralBlock(el);
    const siblingContext = describeSiblingContext(el);
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
      '**Sibling context:** target\'s parent has ' + siblingContext.total + ' children, '
        + siblingContext.sameSignature + ' of which match the target\'s tag+class signature. '
        + (siblingContext.sameSignature === 1
          ? 'The target is unique within its parent — a class-only selector should be safe.'
          : 'There are ' + siblingContext.sameSignature + ' look-alike siblings — your selector must use `:nth-child` or a unique data-attribute to disambiguate.'),
      '',
      structuralBlock
        ? '**Structural parent block** (the closest stable enclosing container — use this to verify your selector is unique within the visible structure. The target element is marked with `data-jt-target=""`. Tailwind atomic classes are stripped from non-target elements; long text is truncated for privacy):\n\n```html\n' + structuralBlock + '\n```\n'
        : '',
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
      '                           "alert": { "title": "...", "body": "...", "confirmLabel": "OK" },',
      '                           "then": [ <Action>, <Action>, ... ]   // V1.7: chained DOM-mutation actions run after preventDefault/alert',
      '                         }',
      '  { "type": "confirmBeforeAction", "selector": "...", "event": "click|dblclick|submit",',
      '                           "confirm": "Are you sure?" }   // gate a destructive click/submit — shows a confirm() in the capture phase BEFORE the app\'s React handler runs; Cancel blocks it, OK lets the original action proceed untouched',
      '  { "type": "moveBefore",  "selector": "...", "referenceSelector": "..." }   // move target to be the previous sibling of reference',
      '  { "type": "moveAfter",   "selector": "...", "referenceSelector": "..." }   // move target to be the next sibling of reference',
      '  { "type": "sortChildren", "selector": "<parent>", "childSelector": "<row>",',
      '                            "keySelector": "<inside row>", "key": "text|number|date",',
      '                            "direction": "asc|desc" }   // bulk-sort children of <parent>',
      '',
      'BEFORE writing the selector: scan the **Structural parent block** above. If you see multiple elements that would match your candidate selector inside that block, your selector is ambiguous — qualify it with a unique ancestor (e.g. `.sticky.z-30 ...` to scope to the header row, not the body row), or use `:nth-child(N)` for positional disambiguation. The **Sibling context** line tells you up front whether the target is unique within its parent.',
      'For "warn before action" patterns use onEvent with preventDefault: true + an alert.',
      'For "click triggers state change" patterns (e.g. clickable headers that mutate cells, sortable columns) use onEvent + then[]: the then array runs DOM-mutation actions (addClass, removeClass, setStyle, setText, hide, show, moveBefore, moveAfter, sortChildren) after the click pre-effects fire. Each then-step has its OWN selector and runs against all matches. Nested onEvent inside then[] is forbidden (validator rejects). Max 20 then-steps per onEvent.',
      'For "JT table has no sort" use sortChildren on the tbody — keySelector picks the column to sort by. To make headers clickable: combine onEvent + then[sortChildren] so each click toggles the sort.',
      'Every action also accepts optional `"match": "<substring>"` (≤200 chars) — a per-element guard. The engine fires the action only on elements whose textContent contains that substring. Use it when a selector is broader than you want (e.g. setText "Vendor" → "Trade Partner" only on cells whose current text contains "Vendor").',
      'Every action also accepts optional `"matchDate": { "min": <int>, "max": <int>, "attr": "datetime", "selector": "<descendant>" }` — a per-element DATE guard. It fires the action only when the element\'s date attribute is within an inclusive range of whole days from today (0 = today, -1 = yesterday, 2 = in two days; at least one of min/max is required; attr defaults to "datetime", and selector optionally reads the date from a descendant). Pair it with addClass + a css rule to shade rows by due date.',
      'For "warn before a destructive click" prefer confirmBeforeAction over onEvent: it is the ONLY verb that can conditionally let the original click/submit proceed (onEvent side effects are unconditional — they can block but never proceed-after-confirm). Use onEvent + alert only for a notice that does not need to let the action through.',
      'setText cannot relabel primary-action buttons (Approve / Delete / Pay / Submit / Send / Sign / etc.) — engine refuses as anti-clickjacking guard.',
      'Do NOT use innerHTML, insertHTML, insertElement, or any verb not on the list above.',
      'Selectors must NOT contain .jt-tools-, .jt-popup-, or .jt-tweak-edit- prefixes.',
      'CSS values via setStyle must be simple (alphanumeric + space + - % .). For complex',
      'values like rgb(), calc(), or shorthand, put them in the css field instead.',
      '',
      'Selector robustness (JobTread is a React SPA): prefer the Structural parent block above, semantic structure, data-* attributes, :has(), and :nth-child(). Treat atomic Tailwind classes (p-2, flex, text-sm, gap-1) as UNSTABLE — they change between builds and across views. The css field is auto-scoped to this tweak, so style freely there.',
      '',
      'Common recipes:',
      '  • Warn before a destructive click → confirmBeforeAction { event: "click", confirm: "..." } on the button.',
      '  • Rename a label everywhere → setText with a match guard (e.g. "Vendor" → "Trade Partner").',
      '  • Shade overdue rows → addClass { matchDate: { max: -1 } } + a css rule for that class (today: { min: 0, max: 0 }; next 7 days: { min: 0, max: 7 }).',
      '  • Make a column header sortable → onEvent { event: "click", then: [ { type: "sortChildren", ... } ] } on the header.',
      '  • Reorder elements → moveBefore / moveAfter against a referenceSelector.',
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

  // ============================================================
  // Structural-block capture (V2 picker upgrade)
  // ============================================================
  //
  // The V1 capture format gave the AI a 2-deep ancestor chain of (tag +
  // classes), which was not enough to disambiguate siblings sharing the
  // same class names (the JT documents page is exactly this — sticky
  // header row and body rows live in separate sibling scroll containers
  // with identical class names). The AI couldn't tell whether
  // `.flex.min-w-max` matched one element or several until runtime, and
  // wrote ambiguous selectors as a result.
  //
  // V2 adds two new pieces to every capture:
  //   1. A serialized outerHTML chunk of the closest "stable" ancestor
  //      (sticky/grid/flex container, semantic structural tag, or list-
  //      pattern container), capped at 4 levels up and 2KB serialized,
  //      with Tailwind atomic classes stripped from non-target descendants
  //      and long text truncated to keep PII out of AI prompts.
  //   2. A sibling-context line: "the target's parent has N children, M
  //      of which match the same tag+class signature."
  //
  // The schema instructions in the markdown output are also updated to
  // tell the AI to USE the structural block to verify selector uniqueness.

  /**
   * Build a tag+stable-class signature for an element. Two elements with
   * the same signature are visually-similar siblings (think JT table rows).
   * Tailwind atomic classes are stripped (they're noise) and the remaining
   * stable classes are sorted so order doesn't matter — `.foo.bar` and
   * `.bar.foo` produce the same signature.
   */
  function tagClassSig(el) {
    const tag = el.tagName.toLowerCase();
    const stable = (el.className && typeof el.className === 'string')
      ? el.className.split(/\s+/).filter(c => c && !TAILWIND_PREFIX_RE.test(c)).sort().slice(0, 3).join('.')
      : '';
    return tag + (stable ? '.' + stable : '');
  }

  /**
   * Decide whether `el` is "structural" — worth using as the root of a
   * structural-block dump. Returns true if it's a semantic structural tag,
   * has a layout-role class, or has 2+ same-signature children (the
   * list/grid heuristic).
   */
  function isStructural(el) {
    if (STRUCTURAL_TAGS.has(el.tagName.toLowerCase())) return true;
    const cls = (el.className && typeof el.className === 'string') ? el.className.split(/\s+/) : [];
    for (const c of cls) {
      if (c && STRUCTURAL_CLASS_RE.test(c)) return true;
    }
    // List/grid heuristic: a parent with 2+ children sharing the same
    // tag+class signature is almost certainly a list or grid container.
    const children = el.children;
    if (children.length >= 2) {
      const seen = new Map();
      for (let i = 0; i < children.length; i++) {
        const sig = tagClassSig(children[i]);
        const count = (seen.get(sig) || 0) + 1;
        if (count >= 2) return true;
        seen.set(sig, count);
      }
    }
    return false;
  }

  /**
   * Walk up from `target` looking for an ancestor that gives the AI useful
   * structural context. Caps at STRUCTURAL_MAX_DEPTH_UP levels. Falls back
   * to the deepest non-structural ancestor we walked past so the AI always
   * gets something more than the existing 2-deep ancestor chain.
   */
  function findStableAncestor(target) {
    let el = target.parentElement;
    let depth = 0;
    let fallback = null;
    while (el && depth < STRUCTURAL_MAX_DEPTH_UP) {
      if (el === document.body || el === document.documentElement) {
        return fallback || el;
      }
      if (isStructural(el)) return el;
      fallback = el;
      el = el.parentElement;
      depth++;
    }
    return fallback;
  }

  /**
   * Serialize a stable-ancestor subtree as outerHTML, with the target
   * element marked (`data-jt-target=""`), Tailwind atomic classes stripped
   * from non-target descendants, and long text truncated. Caps total
   * output at MAX_STRUCTURAL_BLOCK_BYTES so a giant container (e.g. a JT
   * table with hundreds of rows) doesn't blow up the AI prompt.
   *
   * Returns null if no useful parent exists. The original DOM is NOT
   * permanently mutated — we add a marker attribute, clone, then remove
   * the marker. The engine's MutationObserver is debounced 100ms so it
   * doesn't fire on the brief attribute add/remove.
   */
  function buildStructuralBlock(target) {
    const stable = findStableAncestor(target);
    if (!stable) return null;

    target.setAttribute(TARGET_MARKER_ATTR, '1');
    let clone;
    try {
      clone = stable.cloneNode(true);
    } finally {
      target.removeAttribute(TARGET_MARKER_ATTR);
    }

    const targetClone = clone.querySelector('[' + TARGET_MARKER_ATTR + ']');
    if (!targetClone) return null;

    sanitizeStructuralBlock(clone, targetClone);
    targetClone.removeAttribute(TARGET_MARKER_ATTR);
    targetClone.setAttribute('data-jt-target', '');

    let html = clone.outerHTML;
    if (html.length > MAX_STRUCTURAL_BLOCK_BYTES) {
      html = html.substring(0, MAX_STRUCTURAL_BLOCK_BYTES) + '…[truncated]';
    }
    return html;
  }

  /**
   * Walk a cloned subtree and:
   *   - Strip Tailwind atomic classes from non-target elements (cap at 4
   *     stable classes per element). The target keeps its FULL class list
   *     so the AI sees exactly what makes the target unique.
   *   - Truncate text nodes longer than 40 chars (keeps customer names,
   *     addresses, invoice numbers out of AI prompts — these end up in
   *     chat logs, so this is a basic privacy hygiene step).
   *   - Strip `style` attributes on non-target elements (visual noise).
   */
  function sanitizeStructuralBlock(root, targetClone) {
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT, null);
    let node;
    while ((node = walker.nextNode())) {
      if (node.nodeType === Node.TEXT_NODE) {
        const txt = node.textContent || '';
        if (txt.length > 40) {
          node.textContent = txt.substring(0, 35) + '…';
        }
        continue;
      }
      if (node === targetClone) continue;
      const cls = (node.className && typeof node.className === 'string') ? node.className : '';
      if (cls) {
        const stable = cls.split(/\s+/)
          .filter(c => c && !TAILWIND_PREFIX_RE.test(c))
          .slice(0, 4);
        if (stable.length) {
          node.setAttribute('class', stable.join(' '));
        } else {
          node.removeAttribute('class');
        }
      }
      if (node.hasAttribute && node.hasAttribute('style')) {
        node.removeAttribute('style');
      }
    }
  }

  /**
   * Count how many of the target's siblings share its tag+class signature.
   * Returns `{ total, sameSignature }`. The AI uses this to decide whether
   * a class-only selector is unique within the parent or needs nth-child
   * disambiguation.
   */
  function describeSiblingContext(target) {
    const parent = target.parentElement;
    if (!parent) return { total: 0, sameSignature: 0 };
    const targetSig = tagClassSig(target);
    let same = 0;
    for (let i = 0; i < parent.children.length; i++) {
      if (tagClassSig(parent.children[i]) === targetSig) same++;
    }
    return { total: parent.children.length, sameSignature: same };
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
