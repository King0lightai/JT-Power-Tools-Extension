// JobTread Dark Mode Feature Module
// Applies one of three darkness levels to the JobTread interface.

const DarkModeFeature = (() => {
  let isActive = false;
  let currentLevel = null;
  let styleElements = [];
  let observer = null;

  // The three levels the popup's 4-step toggle can land on ("Off" is simply
  // the feature being disabled, so it has no entry here).
  //
  //   soft   — "Kinda Dark". Still a LIGHT theme; it only knocks JobTread's
  //            white surfaces down to a soft grey to cut glare. Deliberately
  //            does NOT set body.jt-dark-mode: that class is how every other
  //            feature decides to render dark chrome, and dark chrome on a
  //            light page is worse than either.
  //   dark   — "Dark". The original JT Power Tools dark theme, unchanged.
  //   double — "Double Dark". Takes JobTread's own dark mode and darkens it in
  //            place, hue and all, rather than re-colouring it. Requires their
  //            theme to be set to Dark.
  // `nativeDark` records how a level relates to JobTread's own dark mode:
  //   'required'   — the level only makes sense on top of it (Double Dark)
  //   'conflicts'  — the level is a light theme and cannot coexist with it (soft)
  //   null         — independent of it (the standard dark theme)
  // Both stylesheets enforce this themselves, via a .dark / html:not(.dark)
  // scope, so a mismatch self-disables rather than half-lighting the page. The
  // warning exists so the reason shows up somewhere when it does.
  const LEVELS = {
    soft: {
      styles: ['styles/dark-mode-soft.css'],
      bodyClasses: ['jt-dark-soft'],
      highlightDate: false,
      nativeDark: 'conflicts'
    },
    dark: {
      styles: ['styles/dark-mode.css'],
      bodyClasses: ['jt-dark-mode'],
      highlightDate: true,
      nativeDark: null
    },
    double: {
      // Only the double layer. Loading styles/dark-mode.css here would repaint
      // the whole app in the JT Power Tools greys, which is the standard Dark
      // level's job and the opposite of what this level is for — it darkens
      // JobTread's own dark mode in place rather than replacing it. JT Power
      // Tools' own injected UI is already themed for their dark mode by the
      // `.dark` blocks in its individual feature stylesheets.
      styles: ['styles/dark-mode-double.css'],
      bodyClasses: ['jt-dark-mode', 'jt-dark-double'],
      highlightDate: true,
      nativeDark: 'required'
    }
  };

  const DEFAULT_LEVEL = 'dark';

  // Stable element ids for the injected stylesheets, keyed by path.
  //
  // `styles/dark-mode.css` MUST keep the id `jt-dark-mode-styles`. Four features
  // — Budget Hierarchy, Budget Row Highlight, Budget Tools and the Gantt Auto
  // Sequencer — decide whether the page is dark by asking
  // `getElementById('jt-dark-mode-styles')`, so a derived or renamed id silently
  // tells all of them that dark mode is off while it is plainly on.
  const STYLE_IDS = {
    'styles/dark-mode.css': 'jt-dark-mode-styles',
    'styles/dark-mode-soft.css': 'jt-dark-mode-soft-styles',
    'styles/dark-mode-double.css': 'jt-dark-mode-double-styles'
  };

  function normalizeLevel(level) {
    return Object.prototype.hasOwnProperty.call(LEVELS, level) ? level : DEFAULT_LEVEL;
  }

  // Is JobTread itself in dark mode? Their theme picker sets Tailwind's `dark`
  // class. Double Dark is a layer on top of that, so without it the user would
  // get our theme fighting a light page.
  function isNativeDarkModeOn() {
    return document.documentElement.classList.contains('dark') ||
      document.body.classList.contains('dark');
  }

  // Initialize the feature
  function init(level) {
    if (isActive) return;

    isActive = true;
    currentLevel = normalizeLevel(level);
    console.log(`DarkMode: Activated (level: ${currentLevel})`);

    applyLevel(currentLevel);

    // Watch for DOM changes to highlight new date cells
    startObserver();
  }

  // Switch levels without a full teardown, so the popup's 4-step toggle applies
  // live the way the other appearance settings do.
  function setLevel(level) {
    const next = normalizeLevel(level);
    if (!isActive || next === currentLevel) return;

    console.log(`DarkMode: Switching level ${currentLevel} -> ${next}`);
    removeLevel();
    currentLevel = next;
    applyLevel(currentLevel);
  }

  // Apply everything a level owns: body classes, stylesheets, date highlight.
  function applyLevel(level) {
    const config = LEVELS[level];

    const nativeDark = isNativeDarkModeOn();
    if (config.nativeDark === 'required' && !nativeDark) {
      console.warn(
        'DarkMode: Double Dark layers on top of JobTread\'s own dark mode, which ' +
        'is currently off. Turn on Dark in JobTread\'s theme picker, or pick the ' +
        '"Dark" level in JT Power Tools instead.'
      );
    } else if (config.nativeDark === 'conflicts' && nativeDark) {
      console.warn(
        'DarkMode: Kinda Dark is a light theme and JobTread\'s own dark mode is on, ' +
        'so it has nothing to dim and stays out of the way. Set JobTread\'s theme to ' +
        'Light, or pick the "Dark" or "Double" level instead.'
      );
    }

    config.bodyClasses.forEach(cls => document.body.classList.add(cls));
    config.styles.forEach(injectStylesheet);

    // jt-dark-mode now means "this page is dark", which is true for JobTread's
    // own dark mode as well as ours, so NativeDarkBridge owns it — see that
    // module. Ours is set above for the case where the bridge has not loaded;
    // the refresh reconciles both inputs when it has.
    refreshThemeBridge();

    if (config.highlightDate) highlightCurrentDate();
  }

  // Reverse applyLevel. Split out from cleanup() so setLevel can swap levels
  // without tearing down the observer.
  function removeLevel() {
    const config = LEVELS[currentLevel];
    if (!config) return;

    config.bodyClasses.forEach(cls => document.body.classList.remove(cls));

    styleElements.forEach(el => el.remove());
    styleElements = [];

    clearDateHighlight();

    // Removing our own body classes above also strips jt-dark-mode, which the
    // bridge may still want set because JobTread's own dark mode is on. Let it
    // decide rather than leaving our panels light on a dark page.
    refreshThemeBridge();
  }

  // Ask NativeDarkBridge to recompute the shared jt-dark-mode class. Silently
  // does nothing if the bridge isn't loaded (older manifest, script blocked) —
  // the class our own level set stays as-is, which is the previous behaviour.
  function refreshThemeBridge() {
    const bridge = window.NativeDarkBridge;
    if (bridge && typeof bridge.refresh === 'function') bridge.refresh();
  }

  // Cleanup the feature
  function cleanup() {
    if (!isActive) return;

    isActive = false;
    console.log('DarkMode: Deactivated');

    // Disconnect observer
    if (observer) {
      observer.disconnect();
      observer = null;
    }

    removeLevel();
    currentLevel = null;
  }

  // Inject a stylesheet, tracked so cleanup can remove it. Keyed by href so a
  // level swap that keeps a shared sheet (dark -> double both load
  // dark-mode.css) can't end up with it in the page twice.
  function injectStylesheet(path) {
    const id = STYLE_IDS[path];
    if (!id) {
      console.error(`DarkMode: no stylesheet id registered for ${path}`);
      return;
    }
    if (document.getElementById(id)) return;

    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = chrome.runtime.getURL(path);
    link.id = id;
    document.head.appendChild(link);
    styleElements.push(link);
  }

  // Watch for DOM changes. Debounced because highlightCurrentDate scans the
  // whole document with querySelectorAll on every mutation batch — without
  // debouncing, a busy page (typing, scrolling, React re-renders) pegs the
  // main thread.
  function startObserver() {
    const runHighlight = () => {
      const config = LEVELS[currentLevel];
      if (config && config.highlightDate) highlightCurrentDate();
    };

    const debouncedHighlight = (typeof TimingUtils !== 'undefined' && TimingUtils.debounce)
      ? TimingUtils.debounce(runHighlight, 150)
      : runHighlight;

    observer = new MutationObserver((mutations) => {
      const hasNewNodes = mutations.some(m => m.addedNodes.length > 0);
      if (hasNewNodes) {
        debouncedHighlight();
      }
    });

    observer.observe(document.body, {
      childList: true,
      subtree: true
    });
  }

  // Highlight current date with blue background
  function highlightCurrentDate() {
    const currentDateDivs = document.querySelectorAll('div.bg-blue-500.text-white');

    currentDateDivs.forEach(dateDiv => {
      const tdCell = dateDiv.closest('td');

      if (tdCell && !tdCell.classList.contains('jt-dark-mode-date-enhanced')) {
        tdCell.classList.add('jt-dark-mode-date-enhanced');
        tdCell.style.backgroundColor = 'rgb(59, 130, 246)';
      }
    });
  }

  // Revert the current-date highlight: remove the marker class AND the inline
  // backgroundColor we set in highlightCurrentDate. Without this the date cell
  // stays blue after dark mode is toggled off, and the marker class blocks
  // re-highlighting on re-enable.
  function clearDateHighlight() {
    document.querySelectorAll('.jt-dark-mode-date-enhanced').forEach(td => {
      td.classList.remove('jt-dark-mode-date-enhanced');
      td.style.backgroundColor = '';
    });
  }

  // Public API
  return {
    init,
    cleanup,
    setLevel,
    isActive: () => isActive,
    getLevel: () => currentLevel
  };
})();

// Export for use in main content script
if (typeof window !== 'undefined') {
  window.DarkModeFeature = DarkModeFeature;
}
