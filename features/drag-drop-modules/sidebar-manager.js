// Sidebar Manager Module
// Handles sidebar visibility, opening, closing, and finding date fields

const SidebarManager = (() => {
  /**
   * Inject CSS to hide the sidebar during date change operations
   * @returns {HTMLElement} The style element that was injected
   */
  function injectHideSidebarCSS() {
    const hideStyle = document.createElement('style');
    hideStyle.id = 'jt-hide-sidebar-temp';
    hideStyle.textContent = `
        /* Hide the outer sidebar container (the one with z-30) */
        div.z-30.absolute.top-0.bottom-0.right-0 {
            opacity: 0 !important;
            position: fixed !important;
            top: -9999px !important;
            left: -9999px !important;
            width: 1px !important;
            height: 1px !important;
            overflow: hidden !important;
            clip: rect(0, 0, 0, 0) !important;
            pointer-events: none !important;
        }
        /* Hide the white background layer */
        div.absolute.inset-0.bg-white.shadow-line-left {
            opacity: 0 !important;
            background: transparent !important;
        }
        /* Hide the inner sticky sidebar */
        div.overflow-y-auto.overscroll-contain.sticky {
            opacity: 0 !important;
        }
        /* Hide sidebar-related fixed overlays and backdrops (but not help modals) */
        /* Only hide elements that are part of the sidebar (z-30) or backdrop (not dialogs/modals) */
        body > div.fixed.inset-0:not(.jt-formatter-toolbar):not([role="dialog"]):not([role="alertdialog"]),
        div.z-30[style*="position: fixed"][style*="inset"],
        div[class*="backdrop"]:not([role="dialog"]):not([role="alertdialog"]) {
            opacity: 0 !important;
            position: fixed !important;
            top: -9999px !important;
            left: -9999px !important;
            width: 1px !important;
            height: 1px !important;
            overflow: hidden !important;
        }
    `;
    document.head.appendChild(hideStyle);
    return hideStyle;
  }

  /**
   * Remove the sidebar hiding CSS
   */
  function removeSidebarCSS() {
    const style = document.getElementById('jt-hide-sidebar-temp');
    if (style) {
      style.remove();
    }
  }

  /**
   * Open the sidebar by clicking on an element
   * Uses conditional click behavior based on view type and popup status:
   * - Availability view in popup: non-bubbling click to prevent popup closure
   * - All other cases: regular click to allow proper sidebar opening
   * @param {HTMLElement} element - The element to click
   */
  function openSidebar(element) {
    // Only use non-bubbling click if we're in availability view AND in a popup
    const isAvailabilityView = window.ViewDetector && window.ViewDetector.isAvailabilityView();
    const isInPopup = window.ViewDetector && window.ViewDetector.isInPopup();

    if (isAvailabilityView && isInPopup) {
      // Create a synthetic click event that doesn't bubble
      // This prevents the click from propagating up and closing the popup
      const clickEvent = new MouseEvent('click', {
        bubbles: false,  // Don't bubble up to parent elements
        cancelable: true,
        view: window
      });
      element.dispatchEvent(clickEvent);
    } else {
      // Use regular click for main schedule page (both normal and availability views)
      element.click();
    }
  }

  /**
   * Close the sidebar and cleanup hiding CSS
   * @param {number} failsafeTimeout - The timeout ID to clear
   * @param {Function} onDateChangeComplete - Callback when date change is complete (called AFTER sidebar closes)
   */
  function closeSidebar(failsafeTimeout, onDateChangeComplete) {
    // Clear the failsafe timeout since we're handling cleanup now
    if (failsafeTimeout) {
      clearTimeout(failsafeTimeout);
    }

    const sidebar = document.querySelector('div.overflow-y-auto.overscroll-contain.sticky');

    if (sidebar) {
      // Find and click Close button (clicking day in calendar already saved the change)
      const closeButtons = sidebar.querySelectorAll('div[role="button"]');

      for (const button of closeButtons) {
        const text = button.textContent.trim();
        if (text.includes('Close')) {
          // Only use non-bubbling click if we're in availability view AND in a popup
          const isAvailabilityView = window.ViewDetector && window.ViewDetector.isAvailabilityView();
          const isInPopup = window.ViewDetector && window.ViewDetector.isInPopup();

          if (isAvailabilityView && isInPopup) {
            // Use synthetic click that doesn't bubble to prevent closing popups
            const clickEvent = new MouseEvent('click', {
              bubbles: false,
              cancelable: true,
              view: window
            });
            button.dispatchEvent(clickEvent);
          } else {
            // Use regular click for main schedule page
            button.click();
          }

          // Wait for sidebar to close BEFORE removing hiding CSS and calling callback
          setTimeout(() => {
            removeSidebarCSS();

            // Notify that date change is complete (AFTER sidebar closes)
            if (onDateChangeComplete) {
              onDateChangeComplete();
            }
          }, 800);

          return;
        }
      }

      // Still remove CSS even if close failed
      setTimeout(() => {
        removeSidebarCSS();

        // Call callback even if close failed
        if (onDateChangeComplete) {
          onDateChangeComplete();
        }
      }, 800);
    } else {
      // Remove CSS anyway
      removeSidebarCSS();

      // Call callback even if sidebar not found
      if (onDateChangeComplete) {
        onDateChangeComplete();
      }
    }
  }

  // Public API
  return {
    injectHideSidebarCSS,
    removeSidebarCSS,
    openSidebar,
    closeSidebar
  };
})();

// Export for use in other modules
if (typeof window !== 'undefined') {
  window.SidebarManager = SidebarManager;
}
