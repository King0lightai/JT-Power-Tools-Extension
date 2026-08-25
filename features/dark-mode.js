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
  //   double — "Double Dark". Layers on top of JobTread's own dark mode. Loads
  //            the normal theme (which still covers everything JobTread's dark
  //            mode can't reach — inline task colours, our own injected UI)
  //            plus a reconciliation layer that forces one neutral palette and
  //            takes it a step darker.
  const LEVELS = {
    soft: {
      styles: ['styles/dark-mode-soft.css'],
      bodyClasses: ['jt-dark-soft'],
      highlightDate: false,
      requiresNativeDark: false
    },
    dark: {
      styles: ['styles/dark-mode.css'],
      bodyClasses: ['jt-dark-mode'],
      highlightDate: true,
      requiresNativeDark: false
    },
    double: {
      styles: ['styles/dark-mode.css', 'styles/dark-mode-double.css'],
      bodyClasses: ['jt-dark-mode', 'jt-dark-double'],
      highlightDate: true,
      requiresNativeDark: true
    }
  };

  const DEFAULT_LEVEL = 'dark';

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

    if (config.requiresNativeDark && !isNativeDarkModeOn()) {
      console.warn(
        'DarkMode: Double Dark layers on top of JobTread\'s own dark mode, which ' +
        'is currently off. Turn on Dark in JobTread\'s theme picker, or pick the ' +
        '"Dark" level in JT Power Tools instead.'
      );
    }

    config.bodyClasses.forEach(cls => document.body.classList.add(cls));
    config.styles.forEach(injectStylesheet);

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
    const id = `jt-dark-mode-styles-${path.replace(/[^a-z0-9]+/gi, '-')}`;
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
