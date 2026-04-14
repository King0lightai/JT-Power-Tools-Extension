// JobTread Dark Mode Feature Module
// Applies dark theme to JobTread interface

const DarkModeFeature = (() => {
  let isActive = false;
  let styleElement = null;
  let observer = null;

  // Initialize the feature
  function init() {
    if (isActive) return;

    isActive = true;
    console.log('DarkMode: Activated');

    // Add dark mode class to body for other features to detect
    document.body.classList.add('jt-dark-mode');

    // Inject dark mode CSS
    injectDarkModeCSS();

    // Highlight current date
    highlightCurrentDate();

    // Watch for DOM changes to highlight new date cells
    startObserver();
  }

  // Cleanup the feature
  function cleanup() {
    if (!isActive) return;

    isActive = false;
    console.log('DarkMode: Deactivated');

    // Remove dark mode class from body
    document.body.classList.remove('jt-dark-mode');

    // Disconnect observer
    if (observer) {
      observer.disconnect();
      observer = null;
    }

    // Remove injected CSS
    if (styleElement) {
      styleElement.remove();
      styleElement = null;
    }
  }

  // Inject dark mode CSS
  function injectDarkModeCSS() {
    if (styleElement) return;

    styleElement = document.createElement('link');
    styleElement.rel = 'stylesheet';
    styleElement.href = chrome.runtime.getURL('styles/dark-mode.css');
    styleElement.id = 'jt-dark-mode-styles';
    document.head.appendChild(styleElement);
  }

  // Watch for DOM changes
  function startObserver() {
    observer = new MutationObserver((mutations) => {
      const hasNewNodes = mutations.some(m => m.addedNodes.length > 0);
      if (hasNewNodes) {
        highlightCurrentDate();
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

  // Public API
  return {
    init,
    cleanup,
    isActive: () => isActive
  };
})();

// Export for use in main content script
if (typeof window !== 'undefined') {
  window.DarkModeFeature = DarkModeFeature;
}
