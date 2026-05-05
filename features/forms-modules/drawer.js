/**
 * FormsDrawer
 *
 * DOM skeleton for the Forms drawer: right-side slide-in panel with
 * header / content / footer regions, resize handle, and open/close
 * lifecycle. No form data or save logic — the caller renders content into
 * the exposed `content` and `footer` elements via the accessors below.
 *
 * The trigger that opens the drawer lives in a separate module
 * (action-bar-injector.js) which injects a button into JT's job action
 * bar. This module only owns the panel itself.
 *
 * Public API:
 *   mount() / unmount()
 *   open()  / close() / isOpen()
 *   setOnClose(fn) / setOnBackClick(fn) / setOnPrint(fn)
 *   getContentEl() / getFooterEl() / getStatusPillEl()
 *   setTitle(text) / setBackVisible(bool) / setStatusPill(state, text)
 */
const FormsDrawer = (() => {
  const DEBUG = false;
  const MIN_W = 320;
  const MAX_W = 1200;
  const DEFAULT_W = 480;
  const STORAGE_KEY = 'jtToolsFormsWidth';
  const VALID_PILL_STATES = ['saved', 'saving', 'unsaved', 'conflict', 'offline'];

  let mounted = false;
  let openState = false;
  let resizing = false;
  let storedWidth = DEFAULT_W;

  let elements = {
    drawer: null,
    header: null,
    title: null,
    back: null,
    statusPill: null,
    print: null,
    close: null,
    content: null,
    footer: null,
    resizeHandle: null
  };

  let listeners = [];
  let resizeMoveHandler = null;
  let resizeUpHandler = null;

  let onClose = null;
  let onBackClick = null;
  let onPrint = null;

  function log(...args) {
    if (DEBUG) console.log('FormsDrawer:', ...args);
  }

  /**
   * Track an event listener and attach it. Use this for every listener so
   * removeAllListeners() can fully reverse the effect on unmount.
   */
  function addListener(target, event, handler, options) {
    if (!target || typeof target.addEventListener !== 'function') return;
    target.addEventListener(event, handler, options);
    listeners.push({ target, event, handler, options });
  }

  function removeAllListeners() {
    listeners.forEach(({ target, event, handler, options }) => {
      try {
        target.removeEventListener(event, handler, options);
      } catch (e) {
        // best-effort — ignore detach errors
      }
    });
    listeners = [];
  }

  /**
   * Read the persisted drawer width from chrome.storage.local. Falls back
   * to DEFAULT_W when the API is unavailable or the value is out of range.
   */
  async function loadStoredWidth() {
    try {
      if (typeof chrome === 'undefined' || !chrome.storage || !chrome.storage.local) {
        return DEFAULT_W;
      }
      const data = await chrome.storage.local.get(STORAGE_KEY);
      const w = Number(data && data[STORAGE_KEY]);
      return (Number.isFinite(w) && w >= MIN_W && w <= MAX_W) ? w : DEFAULT_W;
    } catch (e) {
      return DEFAULT_W;
    }
  }

  function saveWidth(w) {
    try {
      if (typeof chrome === 'undefined' || !chrome.storage || !chrome.storage.local) return;
      chrome.storage.local.set({ [STORAGE_KEY]: w });
    } catch (e) {
      // ignore storage errors — width is non-critical state
    }
  }

  function clampWidth(w) {
    return Math.max(MIN_W, Math.min(MAX_W, w));
  }

  /**
   * Build the drawer aside with header, content, footer, and resize handle.
   */
  function buildDrawer() {
    const drawer = document.createElement('aside');
    drawer.className = 'jt-forms-drawer';
    drawer.setAttribute('role', 'dialog');
    drawer.setAttribute('aria-label', 'Job Forms');
    drawer.setAttribute('aria-modal', 'false');

    const resizeHandle = document.createElement('div');
    resizeHandle.className = 'jt-forms-resize-handle';
    resizeHandle.setAttribute('role', 'separator');
    resizeHandle.setAttribute('aria-orientation', 'vertical');
    resizeHandle.setAttribute('aria-label', 'Resize panel');

    const header = document.createElement('header');
    header.className = 'jt-forms-header';

    const back = document.createElement('button');
    back.type = 'button';
    back.className = 'jt-forms-back';
    back.hidden = true;
    back.textContent = '← All forms';

    const title = document.createElement('h2');
    title.className = 'jt-forms-title';
    title.textContent = 'Forms';

    const statusPill = document.createElement('span');
    statusPill.className = 'jt-forms-status-pill';

    const printBtn = document.createElement('button');
    printBtn.type = 'button';
    printBtn.className = 'jt-forms-print';
    printBtn.setAttribute('aria-label', 'Print form');
    // Lucide-style "printer" SVG (stroke icon, matches JT visual weight)
    printBtn.innerHTML = ''
      + '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" '
      + 'viewBox="0 0 24 24" fill="none" stroke="currentColor" '
      + 'stroke-width="2" stroke-linecap="round" stroke-linejoin="round" '
      + 'aria-hidden="true" focusable="false">'
      + '<polyline points="6 9 6 2 18 2 18 9"></polyline>'
      + '<path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2"></path>'
      + '<rect x="6" y="14" width="12" height="8"></rect>'
      + '</svg>';

    const closeBtn = document.createElement('button');
    closeBtn.type = 'button';
    closeBtn.className = 'jt-forms-close';
    closeBtn.setAttribute('aria-label', 'Close');
    closeBtn.textContent = '×';

    header.appendChild(back);
    header.appendChild(title);
    header.appendChild(statusPill);
    header.appendChild(printBtn);
    header.appendChild(closeBtn);

    const content = document.createElement('div');
    content.className = 'jt-forms-content';
    content.tabIndex = 0;

    const footer = document.createElement('div');
    footer.className = 'jt-forms-footer';

    drawer.appendChild(resizeHandle);
    drawer.appendChild(header);
    drawer.appendChild(content);
    drawer.appendChild(footer);

    return {
      drawer,
      resizeHandle,
      header,
      back,
      title,
      statusPill,
      print: printBtn,
      close: closeBtn,
      content,
      footer
    };
  }

  function handleCloseClick(event) {
    event.preventDefault();
    close();
  }

  function handleBackClick(event) {
    event.preventDefault();
    if (typeof onBackClick === 'function') {
      onBackClick();
    }
  }

  function handlePrintClick(event) {
    event.preventDefault();
    if (typeof onPrint === 'function') {
      onPrint();
    }
  }

  function handleKeyDown(event) {
    if (!openState) return;
    if (event.key !== 'Escape') return;
    // Don't preventDefault — let JT modals/textareas also see ESC.
    close();
  }

  function handleResizeMove(event) {
    if (!resizing) return;
    const computed = window.innerWidth - event.clientX;
    const w = clampWidth(computed);
    if (elements.drawer) {
      elements.drawer.style.width = w + 'px';
    }
  }

  function handleResizeUp() {
    if (!resizing) return;
    resizing = false;
    if (elements.drawer) {
      elements.drawer.classList.remove('is-resizing');
      const finalW = parseFloat(elements.drawer.style.width);
      if (Number.isFinite(finalW)) {
        storedWidth = finalW;
        saveWidth(finalW);
      }
    }
    detachResizeListeners();
  }

  function attachResizeListeners() {
    resizeMoveHandler = handleResizeMove;
    resizeUpHandler = handleResizeUp;
    document.addEventListener('mousemove', resizeMoveHandler);
    document.addEventListener('mouseup', resizeUpHandler);
  }

  function detachResizeListeners() {
    if (resizeMoveHandler) {
      document.removeEventListener('mousemove', resizeMoveHandler);
      resizeMoveHandler = null;
    }
    if (resizeUpHandler) {
      document.removeEventListener('mouseup', resizeUpHandler);
      resizeUpHandler = null;
    }
  }

  function handleResizeDown(event) {
    event.preventDefault();
    if (!elements.drawer) return;
    resizing = true;
    elements.drawer.classList.add('is-resizing');
    attachResizeListeners();
  }

  /**
   * Build the drawer DOM and attach it to document.body. Idempotent —
   * repeated calls are no-ops if already mounted.
   */
  async function mount() {
    if (mounted) return;
    log('mount');

    storedWidth = await loadStoredWidth();

    const built = buildDrawer();

    elements = {
      drawer: built.drawer,
      header: built.header,
      title: built.title,
      back: built.back,
      statusPill: built.statusPill,
      print: built.print,
      close: built.close,
      content: built.content,
      footer: built.footer,
      resizeHandle: built.resizeHandle
    };

    // Apply persisted width before insertion so the first paint is correct.
    elements.drawer.style.width = storedWidth + 'px';

    document.body.appendChild(elements.drawer);

    addListener(elements.close, 'click', handleCloseClick);
    addListener(elements.back, 'click', handleBackClick);
    addListener(elements.print, 'click', handlePrintClick);
    addListener(elements.resizeHandle, 'mousedown', handleResizeDown);
    addListener(document, 'keydown', handleKeyDown);

    mounted = true;
  }

  /**
   * Tear down all DOM, listeners, observers. Safe to call multiple times.
   */
  function unmount() {
    if (!mounted) return;
    log('unmount');

    // Defensive: if a drag is in flight, drop the document-level listeners.
    detachResizeListeners();
    resizing = false;

    removeAllListeners();

    if (elements.drawer) elements.drawer.remove();

    elements = {
      drawer: null,
      header: null,
      title: null,
      back: null,
      statusPill: null,
      print: null,
      close: null,
      content: null,
      footer: null,
      resizeHandle: null
    };

    onClose = null;
    onBackClick = null;
    onPrint = null;

    openState = false;
    storedWidth = DEFAULT_W;
    mounted = false;
  }

  /**
   * Slide the drawer into view. No-op if already open or unmounted.
   */
  function open() {
    if (!mounted || openState) return;
    log('open');
    openState = true;
    if (elements.drawer) {
      elements.drawer.classList.add('is-open');
    }
  }

  /**
   * Slide the drawer out of view. No-op if already closed or unmounted.
   * Does NOT unmount — the DOM stays in place for the next open().
   */
  function close() {
    if (!mounted || !openState) return;
    log('close');
    openState = false;
    if (elements.drawer) {
      elements.drawer.classList.remove('is-open');
    }
    if (typeof onClose === 'function') {
      onClose();
    }
  }

  function isOpen() {
    return openState;
  }

  /** Register a handler fired when the drawer closes (ESC, ×, or programmatic close). */
  function setOnClose(fn) {
    onClose = (typeof fn === 'function') ? fn : null;
  }

  /** Register a handler fired when the ← All forms button is clicked. */
  function setOnBackClick(fn) {
    onBackClick = (typeof fn === 'function') ? fn : null;
  }

  /** Register a handler fired when the Print button is clicked. */
  function setOnPrint(fn) {
    onPrint = (typeof fn === 'function') ? fn : null;
  }

  /** Live ref to the .jt-forms-content element, or null if unmounted. */
  function getContentEl() {
    return elements.content;
  }

  /** Live ref to the .jt-forms-footer element, or null if unmounted. */
  function getFooterEl() {
    return elements.footer;
  }

  /** Live ref to the .jt-forms-status-pill element, or null if unmounted. */
  function getStatusPillEl() {
    return elements.statusPill;
  }

  /** Update the drawer header title text. */
  function setTitle(text) {
    if (!elements.title) return;
    elements.title.textContent = (text == null) ? '' : String(text);
  }

  /** Toggle the [hidden] attribute on the back button. */
  function setBackVisible(visible) {
    if (!elements.back) return;
    elements.back.hidden = !visible;
  }

  /**
   * Update the status pill state class and label.
   * @param {('saved'|'saving'|'unsaved'|'conflict'|'offline'|null)} state
   * @param {string} [text]
   */
  function setStatusPill(state, text) {
    const pill = elements.statusPill;
    if (!pill) return;

    pill.classList.remove(
      'is-saved',
      'is-saving',
      'is-unsaved',
      'is-conflict',
      'is-offline'
    );

    if (state != null) {
      if (VALID_PILL_STATES.indexOf(state) === -1) {
        console.warn('FormsDrawer: unknown status pill state:', state);
      } else {
        pill.classList.add('is-' + state);
      }
    }

    pill.textContent = (text == null) ? '' : String(text);
  }

  return {
    mount,
    unmount,
    open,
    close,
    isOpen,
    setOnClose,
    setOnBackClick,
    setOnPrint,
    getContentEl,
    getFooterEl,
    getStatusPillEl,
    setTitle,
    setBackVisible,
    setStatusPill
  };
})();

window.FormsDrawer = FormsDrawer;
