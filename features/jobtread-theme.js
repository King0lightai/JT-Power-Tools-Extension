// JobTread Theme Reader
//
// Two of Dark Mode's four steps only work against a particular JobTread theme:
//
//   - Kinda Dark ('soft')   is a dimmed LIGHT theme. Its stylesheet is scoped
//                           to html:not(.jt-dark), so it self-disables when
//                           JobTread's own dark mode is on.
//   - Double Dark ('double') darkens JobTread's dark mode in place. Its
//                           stylesheet is scoped to .jt-dark, so it does
//                           nothing when JobTread's own dark mode is off.
//
// The mismatch is reported by a console.warn in dark-mode.js — which no real
// user ever sees. The popup can do better and tell the user which way to set
// JobTread's own Appearance, but only a content script can see the page's
// <html> element, so the read lives here and the popup asks for it over
// chrome.runtime messaging.
//
// ── WE DO NOT WRITE JOBTREAD'S THEME. DO NOT REINSTATE IT. ──
//
// An earlier build of this module wrote localStorage.theme (JSON-encoded
// "light"/"dark") and toggled `jt-dark` on <html>, and the popup offered it as
// a "Switch JobTread to Dark" button. That was built on a premise that turned
// out to be wrong, and it shipped a user-visible regression: the class flip
// made it LOOK like it worked, then JobTread overruled it on the next load.
//
// MEASURED on the live app (2026-08-25):
//   - Wrote localStorage.theme = "light", then reloaded app.jobtread.com.
//   - After the reload: localStorage.theme was STILL "light" (our write
//     persisted untouched) but <html> carried `jt-dark` and the body rendered
//     rgb(27,30,36) — dark.
//   - So JobTread neither READS that key on boot nor REWRITES it.
//   - A full localStorage dump showed no other theme-related key at all:
//     GDPR_REMOVAL_FLAG, currentOrganizationId, grantKey, id,
//     isMainNavExpanded, jt-action-item-completed, jt-sidebar-job-switcher,
//     jtToolsQuickNotesWidth, paveExplorer, states, theme (plus a Dark Reader
//     flag).
//
// Conclusion: `theme` is VESTIGIAL in JobTread's current build. The real
// preference lives elsewhere — very likely server-side on the user record —
// and we have no supported way to set it. Writing into another product's
// storage with no effect is pure downside, so we don't. The stored value is
// not read either: it demonstrably disagrees with what the page is painted as,
// which makes it worse than no signal at all.
//
// The live `jt-dark` class on <html> is the ONLY reliable statement of
// JobTread's current theme, and it is what this module reports.
//
// VERIFIED against the live app (2026-08-25):
//   - JobTread is a Tailwind v4 app with a CUSTOM dark variant: `dark:`
//     utilities compile to :where(.jt-dark, .jt-dark *), so the class their
//     theme picker sets is `jt-dark` on <html>, NOT Tailwind's default `dark`.
//   - Their Appearance picker lives at Settings → Appearance, on a card headed
//     "Appearance — Choose how JobTread looks on this device", offering
//     System / Light / Dark. That is where the user changes it; the popup says
//     so instead of pretending it can do it for them.
const JobTreadTheme = (() => {
  let isActive = false;
  let messageHandler = null;

  // `dark` is a fallback only, in case a future JobTread deploy runs on the
  // stock Tailwind variant. Same list the native-dark bridge keeps.
  const NATIVE_DARK_CLASSES = ['jt-dark', 'dark'];

  // Is JobTread itself painted dark right now? Delegates to the native-dark
  // bridge when it is loaded so there is one definition of the class list.
  function isNativeDark() {
    const bridge = window.NativeDarkBridge;
    if (bridge && typeof bridge.isNativeDark === 'function') return bridge.isNativeDark();
    return NATIVE_DARK_CLASSES.some(cls =>
      document.documentElement.classList.contains(cls) ||
      (document.body && document.body.classList.contains(cls)));
  }

  /**
   * Read JobTread's theme.
   *
   * The live class is the whole answer: it is what JobTread rendered, and it
   * has already resolved their System option against the OS for us.
   *
   * @returns {{effective: ('dark'|'light')}}
   */
  function readTheme() {
    return { effective: isNativeDark() ? 'dark' : 'light' };
  }

  /**
   * Answer only the message type this module owns.
   *
   * Anything else returns false WITHOUT calling sendResponse, so the other
   * listeners on this page (content.js, tweak-engine, formatter) still get a
   * turn — Chrome's first synchronous sendResponse wins the channel.
   */
  function handleMessage(message, sender, sendResponse) {
    if (!message || !message.type) return false;

    if (message.type === 'GET_JOBTREAD_THEME') {
      sendResponse(readTheme());
    }
    return false;
  }

  function init() {
    if (isActive) return;
    isActive = true;

    messageHandler = handleMessage;
    chrome.runtime.onMessage.addListener(messageHandler);

    console.log('JobTreadTheme: Initialized');
  }

  function cleanup() {
    if (!isActive) return;
    isActive = false;

    if (messageHandler) {
      chrome.runtime.onMessage.removeListener(messageHandler);
      messageHandler = null;
    }

    console.log('JobTreadTheme: Cleaned up');
  }

  return {
    init,
    cleanup,
    isActive: () => isActive,
    readTheme
  };
})();

if (typeof window !== 'undefined') {
  window.JobTreadTheme = JobTreadTheme;
}
