// JobTread Native Dark Mode Bridge
//
// JobTread ships a dark mode of its own, toggled from their theme picker, which
// sets Tailwind's `dark` class on the document element. JT Power Tools' injected
// UI does not see that: every one of its dark rules is keyed on
// `body.jt-dark-mode`, a class only Dark Mode's own feature module sets. So a
// user running JobTread's dark theme with our Dark Mode off gets a dark page
// with our panels, toolbars and tabs still painted for a light one — the
// Worksheets tab, the assistant panel, the formatter toolbar, the frozen
// header, month shading and the budget shading all render white-on-dark.
//
// This module closes that gap by making `body.jt-dark-mode` mean what its name
// says — "this page is dark" — rather than "our Dark Mode feature is on". It is
// the SINGLE OWNER of that class: DarkModeFeature no longer adds or removes it
// directly, it asks this module to re-evaluate. That matters because the class
// now has two independent inputs, and two writers toggling one class is how you
// get a page that is dark until you touch an unrelated setting.
//
// Always on, no setting. There is no version of "our own UI should be
// unreadable" worth exposing a toggle for.
const NativeDarkBridge = (() => {
  let isActive = false;
  let observer = null;

  // Is JobTread itself in dark mode?
  //
  // Their theme picker sets `jt-dark`, NOT Tailwind's default `dark`. JobTread
  // is a Tailwind v4 app with a CUSTOM dark variant: their compiled bundle emits
  //
  //     .dark\:h-16:where(.jt-dark, .jt-dark *)
  //
  // so `dark:` utilities in their markup resolve against `.jt-dark`. Verified
  // against the live app: `html.jt-dark`, with `--color-gray-50` flipping from
  // `oklch(98.5% …)` to `#15171c`.
  //
  // This checked `dark` until 2026-08-25, which meant it never fired once — the
  // whole bridge was inert in production and our injected UI stayed painted for
  // a light page whenever JobTread's own dark mode was on. `dark` is kept as a
  // fallback only so a future Tailwind-default deployment still works.
  const NATIVE_DARK_CLASSES = ['jt-dark', 'dark'];

  function isNativeDark() {
    return NATIVE_DARK_CLASSES.some(cls =>
      document.documentElement.classList.contains(cls) ||
      document.body.classList.contains(cls));
  }

  // Is JT Power Tools' own dark theme painting the page? Levels 'dark' and
  // 'double' are dark; 'soft' is a dimmed LIGHT theme and must not count, or our
  // panels would go dark on a light page — the exact bug in reverse.
  function isOurDarkTheme() {
    const feature = window.DarkModeFeature;
    if (!feature || typeof feature.isActive !== 'function' || !feature.isActive()) return false;
    const level = typeof feature.getLevel === 'function' ? feature.getLevel() : null;
    return level === 'dark' || level === 'double';
  }

  // Recompute both classes from scratch. Idempotent, so it is safe to call from
  // the observer, from DarkModeFeature, and on init without tracking who last
  // set what.
  function refresh() {
    if (!document.body) return;
    const native = isNativeDark();
    document.body.classList.toggle('jt-native-dark', native);
    document.body.classList.toggle('jt-dark-mode', native || isOurDarkTheme());
  }

  function init() {
    if (isActive) return;
    isActive = true;

    refresh();

    // JobTread's theme picker flips the class at runtime, and their SPA can
    // re-render the shell, so watch rather than reading once. Scoped to the
    // class attribute on the two elements that carry it — a subtree observer
    // here would fire on every render in the app.
    observer = new MutationObserver(refresh);
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] });
    observer.observe(document.body, { attributes: true, attributeFilter: ['class'] });

    console.log(`NativeDarkBridge: Initialized (JobTread dark mode: ${isNativeDark() ? 'on' : 'off'})`);
  }

  function cleanup() {
    if (!isActive) return;
    isActive = false;

    if (observer) {
      observer.disconnect();
      observer = null;
    }

    // Drop the native marker, then let DarkModeFeature's own state decide
    // whether jt-dark-mode stays — tearing the bridge down must not un-dark a
    // page whose darkness our own theme is responsible for.
    document.body.classList.remove('jt-native-dark');
    document.body.classList.toggle('jt-dark-mode', isOurDarkTheme());

    console.log('NativeDarkBridge: Cleaned up');
  }

  return {
    init,
    cleanup,
    refresh,
    isActive: () => isActive,
    isNativeDark,
    // Whether the page is dark by either route. The shared answer for features
    // that need it in JS rather than CSS.
    isPageDark: () => isNativeDark() || isOurDarkTheme()
  };
})();

if (typeof window !== 'undefined') {
  window.NativeDarkBridge = NativeDarkBridge;
}
