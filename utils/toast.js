/**
 * JT Power Tools - Shared Toast Notification
 *
 * One toast element reused by every feature that needs a transient
 * confirmation or warning. Styled like the Editable Tables save toast (the
 * reference implementation this was lifted from): fixed bottom-right, a 4px
 * left border carrying the success/error accent, --jt-theme-* tokens with
 * light-palette fallbacks, and a neutral-grey dark mode block.
 *
 * Two callers toasting in quick succession replace, not stack — there is
 * only ever one DOM node. `dismiss()` hides it immediately (element stays,
 * ready for reuse); `destroy()` removes it and its injected stylesheet
 * entirely, for tests or a full extension teardown.
 *
 * @module JTToast
 */
const JTToast = (() => {
  const TOAST_ID = 'jt-tools-toast';
  const STYLE_ID = 'jt-tools-toast-styles';

  // Error needs longer to read than a save confirmation does.
  const DEFAULT_DURATION = {
    success: 2500,
    info: 4000,
    error: 6000
  };

  let toastEl = null;
  let timer = null;
  let dismissBtnEl = null;

  function normalizeKind(kind) {
    return kind === 'success' || kind === 'error' ? kind : 'info';
  }

  /**
   * Detach the current dismiss button's click listener, if any. Called
   * before wiping the toast's children (beginShow) and on full teardown
   * (destroy) so the listener never outlives the node it was bound to.
   */
  function clearDismissButton() {
    if (dismissBtnEl) {
      dismissBtnEl.removeEventListener('click', dismiss);
      dismissBtnEl = null;
    }
  }

  function ensureStyles() {
    if (document.getElementById(STYLE_ID)) return;
    if (typeof chrome === 'undefined' || !chrome.runtime || !chrome.runtime.getURL) return;
    const link = document.createElement('link');
    link.id = STYLE_ID;
    link.rel = 'stylesheet';
    link.href = chrome.runtime.getURL('styles/jt-tools-toast.css');
    document.head.appendChild(link);
  }

  function ensureElement() {
    if (toastEl) return toastEl;
    ensureStyles();
    toastEl = document.createElement('div');
    toastEl.id = TOAST_ID;
    toastEl.className = 'jt-tools-toast';
    document.body.appendChild(toastEl);
    return toastEl;
  }

  function beginShow(kind) {
    const el = ensureElement();
    clearDismissButton();
    el.classList.remove(
      'jt-tools-toast-success',
      'jt-tools-toast-error',
      'jt-tools-toast-info',
      'jt-tools-toast-structured',
      'jt-tools-toast-interactive'
    );
    while (el.firstChild) el.removeChild(el.firstChild);
    el.classList.add(`jt-tools-toast-${kind}`);
    return el;
  }

  /**
   * @param {string} kind
   * @param {Object} options
   * @returns {{persistent: true} | {persistent: false, duration: number}}
   */
  function resolveTiming(kind, options) {
    if (options.persistent) return { persistent: true };
    const duration = typeof options.duration === 'number' ? options.duration : DEFAULT_DURATION[kind];
    return { persistent: false, duration };
  }

  function reveal(el, timing) {
    // Force a reflow so back-to-back calls always replay the transition,
    // even when the toast was already visible.
    void el.offsetWidth;
    el.classList.add('jt-tools-toast-visible');
    if (timer) { clearTimeout(timer); timer = null; }
    // Persistent toasts (e.g. the missing-grant-key link) stay until the
    // user dismisses them — no timer to race against a reach for the link.
    if (timing.persistent) return;
    timer = setTimeout(() => {
      timer = null;
      el.classList.remove('jt-tools-toast-visible');
    }, timing.duration);
  }

  /**
   * @param {string} message
   * @param {Object} [options]
   * @param {string} [options.kind='info'] - 'success' | 'error' | 'info'
   * @param {number} [options.duration] - overrides the kind's default duration
   * @param {boolean} [options.persistent] - never auto-hide; caller must dismiss()
   */
  function show(message, options = {}) {
    const kind = normalizeKind(options.kind);
    const el = beginShow(kind);
    el.textContent = message;
    reveal(el, resolveTiming(kind, options));
  }

  /**
   * Structured variant for messages that need more than one line — a title,
   * a body, and one optional link. Built entirely with createElement /
   * textContent; never innerHTML.
   *
   * @param {Object} spec
   * @param {string} [spec.title]
   * @param {string} [spec.body]
   * @param {Object} [spec.link] - { text, href }
   * @param {Object} [options] - same shape as show(), plus:
   * @param {boolean} [options.persistent] - never auto-hide; caller must dismiss()
   * @param {boolean} [options.dismissible] - render a keyboard-reachable close button
   */
  function showStructured(spec = {}, options = {}) {
    const kind = normalizeKind(options.kind);
    const el = beginShow(kind);
    el.classList.add('jt-tools-toast-structured');

    if (spec.title) {
      const titleEl = document.createElement('div');
      titleEl.className = 'jt-tools-toast-title';
      titleEl.textContent = spec.title;
      el.appendChild(titleEl);
    }

    if (spec.body) {
      const bodyEl = document.createElement('div');
      bodyEl.className = 'jt-tools-toast-body';
      bodyEl.textContent = spec.body;
      el.appendChild(bodyEl);
    }

    if (spec.link && spec.link.href) {
      const linkEl = document.createElement('a');
      linkEl.className = 'jt-tools-toast-link';
      linkEl.href = spec.link.href;
      linkEl.target = '_blank';
      linkEl.rel = 'noopener noreferrer';
      linkEl.textContent = spec.link.text || spec.link.href;
      el.appendChild(linkEl);
      // Only an interactive toast should intercept clicks on the page
      // beneath it — see .jt-tools-toast-interactive in the stylesheet.
      el.classList.add('jt-tools-toast-interactive');
    }

    if (options.dismissible) {
      const dismissBtn = document.createElement('button');
      dismissBtn.type = 'button';
      dismissBtn.className = 'jt-tools-toast-dismiss';
      dismissBtn.setAttribute('aria-label', 'Dismiss notification');
      dismissBtn.textContent = '×';
      dismissBtn.addEventListener('click', dismiss);
      el.appendChild(dismissBtn);
      dismissBtnEl = dismissBtn;
      el.classList.add('jt-tools-toast-interactive');
    }

    reveal(el, resolveTiming(kind, options));
  }

  /**
   * Hide the toast immediately. The element stays in the DOM, ready for the
   * next show()/showStructured() call.
   */
  function dismiss() {
    if (timer) { clearTimeout(timer); timer = null; }
    if (!toastEl) return;
    toastEl.classList.remove('jt-tools-toast-visible');
    // Belt-and-braces with the CSS (.jt-tools-toast-interactive is scoped to
    // -visible there): a dismissed toast must stop being a click target even
    // if the stylesheet never loaded. It gets re-added by the next
    // showStructured() that builds a link or a dismiss button.
    toastEl.classList.remove('jt-tools-toast-interactive');
  }

  /**
   * Full teardown: clear any pending timer, remove the toast element and its
   * injected stylesheet. For tests and full extension cleanup — no single
   * feature owns this shared element, so no feature's cleanup() calls it.
   */
  function destroy() {
    if (timer) { clearTimeout(timer); timer = null; }
    clearDismissButton();
    if (toastEl && toastEl.parentNode) toastEl.parentNode.removeChild(toastEl);
    toastEl = null;
    const style = document.getElementById(STYLE_ID);
    if (style && style.parentNode) style.parentNode.removeChild(style);
  }

  return { show, showStructured, dismiss, destroy };
})();

if (typeof window !== 'undefined') {
  window.JTToast = JTToast;
}
