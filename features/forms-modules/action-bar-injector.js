/**
 * FormsActionBarInjector
 *
 * Finds JT's job action bar (the row of Edit Job / Message / Document /
 * Task / overflow-dots buttons) and injects a "Worksheets" button into it.
 * The button uses JT's exact Tailwind utility classes so it matches the
 * surrounding chrome pixel-for-pixel.
 *
 * The bar is identified by the class combo `.absolute.inset-0.flex.justify-end`
 * AND the presence of a `[role="button"][tabindex="0"]` child — the
 * role+tabindex check disambiguates from any unrelated container that
 * happens to share the outer Tailwind classes.
 *
 * The button is inserted BEFORE the overflow-dots button (the last
 * `[role="button"]` child without an `index` attribute), so it sits
 * inline with the named action buttons. A MutationObserver re-injects on
 * every relevant DOM change so JT's React re-renders don't drop our
 * button.
 *
 * Mobile / collapsed mode:
 *   On narrow viewports (<~432px) JT collapses the action bar — the named
 *   action buttons are removed from the bar and only the hamburger remains.
 *   Tapping the hamburger opens a Popper-positioned dropdown menu with
 *   the actions (Edit Job, Message, Document, Task, To-Do, Daily Log,
 *   Time Entry). In that mode we DON'T inject inline; instead we detect
 *   the open popover and append a "Worksheets" entry there. Popper.js destroys
 *   the popover on close, so the observer re-injects every time it opens.
 *
 * Public API:
 *   start(onClick) — begin watching + injecting
 *   stop()         — disconnect + remove our button
 *   tryInject()    — manually nudge a re-inject attempt
 *   isInjected()   — boolean
 */
const FormsActionBarInjector = (() => {
  const DEBUG = false;

  /**
   * Selector for the JT action bar container. JT uses Tailwind utility
   * classes; the container is identifiable by the combo "absolute inset-0
   * flex justify-end" plus presence of role="button" children.
   */
  const BAR_SEL = '.absolute.inset-0.flex.justify-end';

  let observer = null;
  let injected = null;          // current injected button element (or null)
  let onClickHandler = null;
  let active = false;

  function log(...args) {
    if (DEBUG) console.log('FormsActionBarInjector:', ...args);
  }

  /**
   * Gate injection on whether we're currently on a `/jobs/{jobId}` route.
   * The action-bar shape (`.absolute.inset-0.flex.justify-end` + a
   * `[role="button"][tabindex="0"]` child) is not unique to job pages —
   * JT renders similar bars on the org dashboard, contacts, etc. — so we
   * defer to FormsJobDetector for the authoritative check.
   *
   * FormsJobDetector should always be loaded before this module per the
   * manifest content_scripts order, but be defensive — return false if
   * unavailable so we never inject without confirmation.
   *
   * @returns {boolean}
   */
  function isOnJobPage() {
    if (!window.FormsJobDetector || typeof window.FormsJobDetector.getCurrentJob !== 'function') {
      return false;
    }
    return window.FormsJobDetector.getCurrentJob() != null;
  }

  /**
   * Find the action bar on the current page. Returns the container element
   * or null. We require at least one `[role="button"][tabindex="0"]` child
   * to defend against false positives in case JT uses the same outer
   * classes elsewhere.
   */
  function findBar() {
    const candidates = document.querySelectorAll(BAR_SEL);
    for (const c of candidates) {
      const hasActionButton = c.querySelector('[role="button"][tabindex="0"]');
      if (hasActionButton) return c;
    }
    return null;
  }

  /**
   * The bar is "collapsed" (mobile/narrow viewport) when JT has moved its
   * named action buttons out into a Popper dropdown. JT marks each named
   * action button with an `index` attribute; in collapsed mode the bar
   * contains zero `[index]` children — only the hamburger remains. We
   * use that signal because it's the most reliable: it's directly tied
   * to JT's own behavior of relocating the actions, not to a viewport
   * width or media query that we'd have to guess at.
   *
   * @param {Element} bar - the action bar container (from findBar())
   * @returns {boolean}
   */
  function isBarCollapsed(bar) {
    return !!bar && bar.querySelectorAll('[index]').length === 0;
  }

  /**
   * Find the open Popper-positioned job-action overflow dropdown menu, if
   * any. Identified by the wrapper class signature
   *   "z-50 overflow-auto overscroll-contain bg-white rounded-sm shadow-sm"
   * plus a `data-popper-placement` attribute, AND at least one menu-item
   * child styled with JT's action-menu hover class `hover:bg-blue-500`.
   * That hover class is the distinguishing signal: other JT popovers
   * (Add Cost Item's "From Budget / From Bills & Time", etc.) share the
   * wrapper classes and use `block w-full` items too, but style hover with
   * `hover:bg-gray-50`.
   *
   * On top of that we require a JOB-route anchor (`a[href*="/jobs/"]`) — the
   * relocated job actions always include Time Entry / Task / To-Do, which
   * link to `/jobs/{id}/…` sub-routes. Plenty of unrelated selection
   * dropdowns (assignee, status, cost-code pickers, etc.) reuse the same
   * blue-hover item styling but never link to job sub-routes, so this extra
   * check keeps us locked to the job-action menu and stops Forms from
   * leaking into every other dropdown.
   *
   * @returns {Element|null}
   */
  function findOverflowMenu() {
    const candidates = document.querySelectorAll(
      '[data-popper-placement][class*="overflow-auto"][class*="bg-white"][class*="rounded-sm"][class*="shadow-sm"]'
    );
    for (const el of candidates) {
      const looksLikeActionMenu = el.querySelector('[role="button"][class*="block"][class*="w-full"][class*="hover:bg-blue-500"]')
                               || el.querySelector('a[class*="block"][class*="w-full"][class*="hover:bg-blue-500"]');
      const hasJobActionLink = el.querySelector('a[href*="/jobs/"]');
      if (looksLikeActionMenu && hasJobActionLink) return el;
    }
    return null;
  }

  /**
   * Build the Forms button DOM with the EXACT same Tailwind class string
   * as JT's other action buttons, plus a clipboard-with-lines stroke icon
   * matching JT's stroke-icon style.
   *
   * @param {Function} onClick - click + keyboard activation handler
   * @returns {HTMLElement}
   */
  // Clipboard-with-lines stroke icon (matches JT's stroke-icon style) plus
  // the "Worksheets" label — shared verbatim by the inline and menu buttons.
  const FORMS_ICON_HTML = '<svg xmlns="http://www.w3.org/2000/svg" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2" class="inline-block overflow-visible h-[1em] w-[1em] align-[-0.125em]" viewBox="0 0 24 24"><rect x="8" y="2" width="8" height="4" rx="1"></rect><path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2"></path><path d="M9 12h6M9 16h6"></path></svg> Worksheets';

  /**
   * Build the shared Forms trigger element: a role="button" div carrying the
   * Forms icon/label and click + keyboard activation. The caller supplies the
   * Tailwind class string so the inline and menu variants can style
   * themselves while sharing identical behavior.
   *
   * @param {string} className - Tailwind class string for the variant
   * @param {Function} onClick - click + keyboard activation handler
   * @returns {HTMLElement}
   */
  function buildTriggerEl(className, onClick) {
    const btn = document.createElement('div');
    btn.setAttribute('role', 'button');
    btn.setAttribute('tabindex', '0');
    btn.setAttribute('data-jt-forms-trigger', 'true');
    btn.className = className;
    btn.innerHTML = FORMS_ICON_HTML;
    btn.addEventListener('click', (e) => {
      if (typeof onClick === 'function') onClick(e);
    });
    // Keyboard activation (matches role="button" pattern)
    btn.addEventListener('keydown', (e) => {
      if ((e.key === 'Enter' || e.key === ' ') && typeof onClick === 'function') {
        e.preventDefault();
        onClick(e);
      }
    });
    return btn;
  }

  function buildButton(onClick) {
    const btn = buildTriggerEl('inline-block align-bottom relative cursor-pointer select-none truncate py-2 px-4 shadow-xs active:shadow-inner text-gray-600 bg-white hover:bg-gray-50 first:rounded-l-sm last:rounded-r-sm border-y border-l last:border-r text-center shrink-0', onClick);
    // Mount hidden, then reveal on the next stable frame (see revealButton).
    // visibility:hidden — NOT display:none — so the button still reserves its
    // flex slot: siblings settle around it while hidden and the reveal causes
    // no layout shift. This kills the load-time flash where the button popped
    // in mid-hydration as JT re-rendered the action bar.
    btn.style.visibility = 'hidden';
    return btn;
  }

  /**
   * Build a Forms entry styled to match a JT overflow-menu item. Uses
   * the same Tailwind class string as the surrounding entries
   * ("block w-full ... px-4 py-2 hover:bg-blue-500 hover:text-white")
   * with the same clipboard-with-lines stroke icon as the inline button.
   *
   * @param {Function} onClick - click + keyboard activation handler
   * @returns {HTMLElement}
   */
  function buildMenuButton(onClick) {
    return buildTriggerEl('block w-full relative cursor-pointer px-4 py-2 hover:bg-blue-500 hover:text-white', onClick);
  }

  /**
   * Inject (or re-inject) the button into the bar. The button goes BEFORE
   * the overflow-dots button (the last `[role="button"]` child without an
   * `index` attribute). If the bar can't be found, no-op (the SPA observer
   * will retry when the DOM mutates). If the button is already in place,
   * no-op.
   *
   * In collapsed mode (JT moved its named actions to a popover), this
   * skips inline injection — removing the inline button if we placed one
   * earlier — and delegates to tryInjectMenu() so Forms shows up in the
   * dropdown alongside the relocated actions.
   *
   * @returns {boolean} true if the button is in the bar after this call
   */
  function tryInject() {
    if (!isOnJobPage()) {
      // Off a job page — pull the button if we left one behind on the
      // previous route. The MutationObserver keeps running so we'll
      // re-evaluate on the next route change. Also sweep any menu entry,
      // since the observer no longer calls tryInjectMenu() unconditionally.
      if (injected && injected.parentElement) {
        injected.parentElement.removeChild(injected);
        injected = null;
      }
      removeMenuInjected();
      return false;
    }

    const bar = findBar();
    if (!bar) return false;

    // Collapsed mode: clean up the inline button (if any) and delegate
    // to the popover-injection path. Always returns true — the bar
    // exists, just doesn't want our inline entry.
    if (isBarCollapsed(bar)) {
      if (injected && bar.contains(injected)) {
        injected.parentElement.removeChild(injected);
        injected = null;
      }
      tryInjectMenu();
      return true;
    }

    // Already injected and still in the same bar?
    if (injected && bar.contains(injected)) return true;

    // Find the overflow-dots button — it's the role="button" child
    // without an `index` attribute. Falls back to appendChild if absent.
    const candidates = Array.from(bar.children);
    const overflow = candidates.find(el =>
      el.getAttribute && el.getAttribute('role') === 'button' && !el.hasAttribute('index')
    );

    const btn = buildButton(onClickHandler);
    if (overflow) {
      bar.insertBefore(btn, overflow);
    } else {
      bar.appendChild(btn);
    }
    injected = btn;
    revealButton(btn);
    log('injected');
    return true;
  }

  /**
   * Reveal a freshly-injected inline button once layout has settled. Two
   * rAFs guarantee a style/layout pass after insertion (a single rAF can
   * share the same paint frame as the append on some engines). The
   * isConnected guard means a button JT's React wiped before the reveal —
   * common during initial hydration churn — simply never shows; the
   * observer's re-inject builds a fresh hidden one. Net effect: no flash,
   * regardless of how many times the bar re-renders on load.
   *
   * @param {HTMLElement} btn
   */
  function revealButton(btn) {
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        if (btn && btn.isConnected) btn.style.visibility = '';
      });
    });
  }

  /**
   * Inject the Forms entry into the open overflow dropdown menu, if it's
   * currently mounted. Cheap and safe to call on every mutation: returns
   * fast when the popover isn't open. The entry is appended last (after
   * Time Entry) to match the position of less-frequent actions in the
   * stock JT menu.
   *
   * @returns {boolean} true if our entry is in the menu after this call
   */
  function tryInjectMenu() {
    if (!isOnJobPage()) {
      // Off a job page — pull our menu button if it's still attached to a
      // recreated dropdown (rare race, but defensive).
      removeMenuInjected();
      return false;
    }

    const menu = findOverflowMenu();
    if (!menu) return false;
    if (menu.querySelector('[data-jt-forms-trigger="true"]')) return true;
    const btn = buildMenuButton(onClickHandler);
    menu.appendChild(btn);
    log('injected into overflow menu');
    return true;
  }

  /**
   * Remove our injected button from wherever it is.
   */
  function removeInjected() {
    if (injected && injected.parentElement) {
      injected.parentElement.removeChild(injected);
    }
    injected = null;
  }

  /**
   * Remove any Forms entries we may have injected into an open overflow
   * menu. Won't touch the inline button (removeInjected() handles that)
   * — the inline ref is excluded explicitly.
   */
  function removeMenuInjected() {
    document.querySelectorAll('[data-jt-forms-trigger="true"]').forEach((el) => {
      if (el !== injected && el.parentElement) {
        el.parentElement.removeChild(el);
      }
    });
  }

  /**
   * Start watching the DOM. Re-injects on every relevant mutation by
   * checking whether the button is still in a bar that exists; cheap,
   * since findBar() / contains() are both O(small).
   *
   * @param {Function} onClick - handler invoked when the button is clicked
   */
  function start(onClick) {
    if (active) stop();
    onClickHandler = onClick;
    active = true;
    // tryInject() places the inline button when the bar has room, OR
    // delegates to the overflow menu when the bar is collapsed. We never
    // call tryInjectMenu() directly — menu injection must only happen in
    // collapsed mode, otherwise Forms ends up in BOTH the toolbar and the
    // "⋯" dropdown (and leaks into other open selection dropdowns).
    tryInject();
    observer = new MutationObserver(() => {
      if (!active) return;
      const bar = findBar();
      // Case 1 — our inline button is missing or detached from the bar
      // (a React re-render), or we're in collapsed mode where `injected` is
      // null (so this is always true, letting tryInject()'s collapsed branch
      // catch the Popper.js popover mount when the hamburger is tapped).
      const inlineStale = !injected || !document.body.contains(injected) || (bar && !bar.contains(injected));
      // Case 2 — the button is still sitting inline, but JT has SINCE
      // collapsed the bar (the viewport narrowed and Forms would be the only
      // action left in the toolbar). Re-run so tryInject()'s collapsed branch
      // relocates it into the dropdown. Don't null `injected` here — that
      // branch needs the live reference to pull the inline button first.
      const shouldRelocate = bar && injected && bar.contains(injected) && isBarCollapsed(bar);
      if (inlineStale) {
        injected = null;
        tryInject();
      } else if (shouldRelocate) {
        tryInject();
      }
    });
    observer.observe(document.body, { childList: true, subtree: true });
  }

  /**
   * Stop watching and remove the injected button. Safe to call when not
   * started.
   */
  function stop() {
    if (observer) {
      observer.disconnect();
      observer = null;
    }
    removeInjected();
    removeMenuInjected();
    onClickHandler = null;
    active = false;
  }

  function isInjected() {
    return !!injected && document.body.contains(injected);
  }

  return { start, stop, tryInject, isInjected };
})();

window.FormsActionBarInjector = FormsActionBarInjector;
