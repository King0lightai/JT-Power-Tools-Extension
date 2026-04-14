// JobTread Schedule Contrast Fix Feature Module
// Automatically adjusts text color for better readability
// Dependencies: utils/debounce.js (TimingUtils)

const ContrastFixFeature = (() => {
  let observer = null;
  let debouncedUpdate = null;
  let isActive = false;

  // Initialize the feature
  function init() {
    if (isActive) return;

    isActive = true;
    console.log('ContrastFix: Activated');

    // Run initial fix
    fixAllScheduleItems();

    // Create debounced update function using TimingUtils
    debouncedUpdate = window.TimingUtils.debounce(() => {
      fixAllScheduleItems();
    }, 150);

    // Watch for DOM changes
    observer = new MutationObserver((mutations) => {
      const shouldUpdate = mutations.some(mutation => mutation.addedNodes.length > 0);

      if (shouldUpdate) {
        debouncedUpdate();
      }
    });

    // Start observing
    observer.observe(document.body, {
      childList: true,
      subtree: true
    });
  }

  // Cleanup the feature
  function cleanup() {
    if (!isActive) return;

    isActive = false;
    console.log('ContrastFix: Deactivated');

    // Disconnect observer
    if (observer) {
      observer.disconnect();
      observer = null;
    }

    // Cancel debounced function
    if (debouncedUpdate) {
      debouncedUpdate.cancel();
      debouncedUpdate = null;
    }
  }

  // Parse RGB string to values
  function parseRgb(rgbString) {
    const match = rgbString.match(/rgb\((\d+),\s*(\d+),\s*(\d+)\)/);
    if (!match) return null;
    return { r: parseInt(match[1]), g: parseInt(match[2]), b: parseInt(match[3]) };
  }

  // Calculate relative luminance (WCAG formula)
  function getLuminance(r, g, b) {
    const [rNorm, gNorm, bNorm] = [r, g, b].map(val => {
      val = val / 255;
      return val <= 0.03928 ? val / 12.92 : Math.pow((val + 0.055) / 1.055, 2.4);
    });
    return 0.2126 * rNorm + 0.7152 * gNorm + 0.0722 * bNorm;
  }

  // Get appropriate text color based on background luminance
  function getContrastColor(rgbString) {
    const rgb = parseRgb(rgbString);
    if (!rgb) return null;

    const luminance = getLuminance(rgb.r, rgb.g, rgb.b);

    // Return white for dark backgrounds, black for light backgrounds
    return luminance > 0.5 ? 'rgb(0, 0, 0)' : 'rgb(255, 255, 255)';
  }

  // Check if dark mode or custom theme is active
  function isDarkOrCustomTheme() {
    return document.body.classList.contains('jt-dark-mode') ||
           document.body.classList.contains('jt-custom-theme');
  }

  // Fix text contrast for a single element
  // Only adjusts text color for readability in light mode
  // Dark mode/custom theme styling is handled by CSS
  function fixTextContrast(element) {
    // Skip if dark mode or custom theme - CSS handles styling
    if (isDarkOrCustomTheme()) {
      return;
    }

    const style = element.getAttribute('style');
    if (!style) return;

    // Skip tags - they should keep their original colors
    if (element.classList.contains('rounded-sm') &&
        (element.classList.contains('px-2') || element.classList.contains('py-1'))) {
      return;
    }

    // Check if element has both background-color and color in inline styles
    const bgColorMatch = style.match(/background-color:\s*(rgb\([^)]+\))/);
    const textColorMatch = style.match(/color:\s*rgb\([^)]+\)/);

    if (bgColorMatch && textColorMatch) {
      const backgroundColor = bgColorMatch[1];
      const contrastColor = getContrastColor(backgroundColor);

      if (contrastColor) {
        const currentColor = window.getComputedStyle(element).color;

        // Only update if the color is different
        if (currentColor !== contrastColor) {
          const newStyle = style.replace(/(^|[^-])color:\s*rgb\([^)]+\)/, `$1color: ${contrastColor}`);
          element.setAttribute('style', newStyle);
        }
      }
    }
  }

  // Highlight current date with blue background
  function highlightCurrentDate() {
    const currentDateDivs = document.querySelectorAll('div.bg-blue-500.text-white');

    currentDateDivs.forEach(dateDiv => {
      let tdCell = dateDiv.closest('td');

      if (tdCell && !tdCell.classList.contains('jt-current-date-enhanced')) {
        tdCell.classList.add('jt-current-date-enhanced');
        tdCell.style.backgroundColor = 'rgb(59, 130, 246)';
      }
    });
  }

  // Process all schedule items
  function fixAllScheduleItems() {
    // Target schedule items with inline background-color and color
    const scheduleItems = document.querySelectorAll('div[style*="background-color"][style*="color"]');

    scheduleItems.forEach(item => {
      // Only target calendar/schedule items (they have cursor-pointer class)
      if (item.classList.contains('cursor-pointer')) {
        fixTextContrast(item);
      }
    });

    // Also highlight current date
    highlightCurrentDate();
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
  window.ContrastFixFeature = ContrastFixFeature;
}
