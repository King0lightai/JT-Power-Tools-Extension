/**
 * JT Power Tools - Reverse Thread Order
 *
 * Reverses message thread order so newest messages appear at the top
 * and moves the reply button/editor above the messages for immediate
 * access. Works across all message thread locations in JobTread.
 *
 * DOM layout:
 *
 *   div (no class)                          ← containerWrapper
 *     ├── div.rounded-sm.border.divide-y    ← messageList
 *     │   ├── div.flex.rounded-t-sm         ← header (participants bar)
 *     │   ├── div … group/wrapper           ← message 1 (oldest)
 *     │   ├── div … group/wrapper           ← message N (newest)
 *     │   └── [editor: div … group/wrapper] ← appears here when Reply clicked
 *     └── div.text-right.p-1               ← REPLY button
 *
 * Strategy — pure CSS visual reordering (zero DOM moves):
 *
 *   containerWrapper  → flex column-reverse
 *     → reply button (DOM-last) renders at visual TOP
 *     → messageList (DOM-first) renders below
 *
 *   messageList → flex column-reverse
 *     → header (DOM-first) renders at visual BOTTOM → fix with order: -1
 *     → messages naturally reverse (newest at top)
 *     → editor (DOM-last, added by React) renders at visual TOP
 *
 * No DOM nodes are moved, so React's virtual DOM stays in sync.
 * Cancel, navigation, and all React state management works normally.
 *
 * @module ReverseThreadOrderFeature
 * @author JT Power Tools Team
 */

const ReverseThreadOrderFeature = (() => {
  let active = false;
  let bodyObserver = null;
  let styleEl = null;
  const processedContainers = new WeakSet();
  const DEBOUNCE_MS = 400;
  let debounceTimer = null;

  // CSS class names
  const CLS_WRAPPER = 'jt-rto-wrapper';
  const CLS_MSGLIST = 'jt-rto-msglist';
  const CLS_HEADER = 'jt-rto-header';

  // ─── Injected stylesheet ──────────────────────────────────────────

  function injectStyles() {
    if (styleEl) return;
    styleEl = document.createElement('style');
    styleEl.id = 'jt-reverse-thread-order-styles';
    styleEl.textContent = `
      /* containerWrapper: column-reverse puts reply button (DOM-last) at visual top.
         position: relative provides positioning context for the Reply button. */
      .${CLS_WRAPPER} {
        display: flex !important;
        flex-direction: column-reverse !important;
        position: relative !important;
      }

      /* messageList: column-reverse so last-child (editor) renders at visual top */
      .${CLS_MSGLIST} {
        display: flex !important;
        flex-direction: column-reverse !important;
      }

      /* Header pinned to visual top: in column-reverse, highest order = top */
      .${CLS_HEADER} {
        order: 999 !important;
      }

      /* Reply button stays in flex flow at visual top (column-reverse).
         No absolute positioning — avoids overlapping the "..." menu. */
      .${CLS_WRAPPER} > :not(.${CLS_MSGLIST}) {
        z-index: 2 !important;
      }
    `;
    document.head.appendChild(styleEl);
  }

  function removeStyles() {
    if (styleEl) {
      styleEl.remove();
      styleEl = null;
    }
  }

  // ─── Child classification ───────────────────────────────────────────

  function isMessageItem(el) {
    if (!el || el.nodeType !== 1) return false;
    const cls = el.className || '';
    if (typeof cls === 'string' && cls.includes('group/wrapper')) return true;
    const kids = el.children;
    for (let i = 0; i < kids.length; i++) {
      const c = kids[i].className || '';
      if (typeof c === 'string' && c.includes('group/wrapper')) return true;
    }
    return false;
  }

  function isMessageContainer(el) {
    if (!el || el.nodeType !== 1) return false;
    if (!el.matches || !el.matches('div.rounded-sm.border')) return false;
    if (!el.classList.contains('divide-y')) return false;
    const kids = el.children;
    for (let i = 0; i < kids.length; i++) {
      if (isMessageItem(kids[i])) return true;
    }
    return false;
  }

  // ─── Apply / remove CSS classes ────────────────────────────────────

  function applyToContainer(messageList) {
    if (processedContainers.has(messageList)) return;
    if (messageList.hasAttribute('data-jt-reversed')) return;

    const containerWrapper = messageList.parentElement;
    if (!containerWrapper) return;

    // Verify there is at least 1 message
    let msgCount = 0;
    const kids = messageList.children;
    for (let i = 0; i < kids.length; i++) {
      if (isMessageItem(kids[i])) msgCount++;
      if (msgCount >= 1) break;
    }
    if (msgCount < 1) return;

    // Find the header bar (first child that is NOT a message)
    const header = messageList.children[0];
    const isHeader = header && !isMessageItem(header);

    console.log(
      `ReverseThreadOrder: Applying to container with ${msgCount}+ messages`
    );

    // Apply CSS classes — no DOM reordering needed
    containerWrapper.classList.add(CLS_WRAPPER);
    messageList.classList.add(CLS_MSGLIST);
    if (isHeader) {
      header.classList.add(CLS_HEADER);
    }

    messageList.setAttribute('data-jt-reversed', 'true');
    processedContainers.add(messageList);
  }

  function removeFromContainer(messageList) {
    console.log('ReverseThreadOrder: Removing from container');

    const containerWrapper = messageList.parentElement;
    if (containerWrapper) {
      containerWrapper.classList.remove(CLS_WRAPPER);
    }
    messageList.classList.remove(CLS_MSGLIST);

    // Remove header class
    const headerEl = messageList.querySelector('.' + CLS_HEADER);
    if (headerEl) headerEl.classList.remove(CLS_HEADER);

    messageList.removeAttribute('data-jt-reversed');
    processedContainers.delete(messageList);
  }

  // ─── Scanning ───────────────────────────────────────────────────────

  function scanAndApply() {
    const candidates = document.querySelectorAll(
      'div.rounded-sm.border.divide-y:not([data-jt-reversed])'
    );
    candidates.forEach(c => {
      if (!processedContainers.has(c) && isMessageContainer(c)) {
        applyToContainer(c);
      }
    });
  }

  function debouncedScan() {
    if (debounceTimer) clearTimeout(debounceTimer);
    debounceTimer = setTimeout(scanAndApply, DEBOUNCE_MS);
  }

  // ─── Body observer — only finds NEW containers ─────────────────────

  function handleBodyMutations(mutations) {
    let needsScan = false;

    for (const mutation of mutations) {
      if (mutation.type !== 'childList' || mutation.addedNodes.length === 0) continue;
      if (mutation.target.hasAttribute && mutation.target.hasAttribute('data-jt-reversed')) continue;

      for (let i = 0; i < mutation.addedNodes.length; i++) {
        const node = mutation.addedNodes[i];
        if (node.nodeType !== 1) continue;
        if (node.matches && node.matches('div.rounded-sm.border.divide-y')) {
          needsScan = true; break;
        }
        if (node.querySelector && node.querySelector('div.rounded-sm.border.divide-y')) {
          needsScan = true; break;
        }
      }
      if (needsScan) break;
    }

    if (needsScan) debouncedScan();
  }

  // ─── Lifecycle ──────────────────────────────────────────────────────

  function init() {
    if (active) return;
    active = true;
    console.log('ReverseThreadOrder: Initializing...');

    injectStyles();
    scanAndApply();

    bodyObserver = new MutationObserver(handleBodyMutations);
    bodyObserver.observe(document.body, { childList: true, subtree: true });

    console.log('ReverseThreadOrder: Initialized');
  }

  function cleanup() {
    if (!active) return;
    console.log('ReverseThreadOrder: Cleaning up...');

    if (debounceTimer) { clearTimeout(debounceTimer); debounceTimer = null; }
    if (bodyObserver) { bodyObserver.disconnect(); bodyObserver = null; }

    document.querySelectorAll('[data-jt-reversed]').forEach(c => removeFromContainer(c));
    removeStyles();

    active = false;
    console.log('ReverseThreadOrder: Cleaned up');
  }

  return { init, cleanup, isActive: () => active };
})();

window.ReverseThreadOrderFeature = ReverseThreadOrderFeature;
