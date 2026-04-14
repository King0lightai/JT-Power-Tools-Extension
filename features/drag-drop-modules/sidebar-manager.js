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
   * Close any currently open sidebar (without callbacks)
   * This is called before opening a new sidebar to prevent conflicts
   */
  function closeAnySidebar() {
    const sidebar = document.querySelector('div.overflow-y-auto.overscroll-contain.sticky');

    if (sidebar) {
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

          return true;
        }
      }

      return false;
    }

    return false;
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

  /**
   * Find the date field in the sidebar (Start, End, or Due)
   * @param {HTMLElement} sidebar - The sidebar element
   * @param {Object} sourceDateInfo - The source date info for year inference
   * @param {string} fieldType - "Start", "End", or "Due" - which date field to find
   *                             For ToDos, use "Due" (ToDos only have a due date)
   * @returns {Object} {startDateParent, sidebarSourceYear, sidebarSourceMonth, fieldTexts}
   */
  function findDateField(sidebar, sourceDateInfo, fieldType = 'Start') {
    // For ToDos, use the ToDoDragDrop module if available for better detection
    if (fieldType === 'Due' && window.ToDoDragDrop) {
      const result = window.ToDoDragDrop.findDueDateField(sidebar, sourceDateInfo);
      // Map the result to expected format (dueDateParent -> startDateParent for compatibility)
      return {
        startDateParent: result.dueDateParent,
        sidebarSourceYear: result.sidebarSourceYear,
        sidebarSourceMonth: result.sidebarSourceMonth,
        fieldTexts: result.fieldTexts
      };
    }

    // Find the label (Start or End)
    const allLabels = Array.from(sidebar.querySelectorAll('span.font-bold'));
    const targetLabel = allLabels.find(span => span.textContent.trim() === fieldType);

    if (!targetLabel) {
      console.error(`SidebarManager: Could not find "${fieldType}" label in sidebar`);
      return { startDateParent: null, sidebarSourceYear: null, sidebarSourceMonth: null, fieldTexts: [] };
    }

    // Find the container for this label (it's in a div.flex-1)
    const labelContainer = targetLabel.closest('div.flex-1');
    if (!labelContainer) {
      console.error(`SidebarManager: Could not find container for "${fieldType}" label`);
      return { startDateParent: null, sidebarSourceYear: null, sidebarSourceMonth: null, fieldTexts: [] };
    }

    // Find date fields within this container only
    const allDateFields = labelContainer.querySelectorAll('div.text-gray-700.truncate.leading-tight');

    let startDateParent = null;
    let sidebarSourceYear = null;
    let sidebarSourceMonth = null;
    const fieldTexts = [];

    for (const field of allDateFields) {
      const text = field.textContent.trim();
      fieldTexts.push(text);

      // Match formats:
      // 1. "Jan 1, 2026" (Month Day, Year)
      // 2. "Wed, Dec 31" (DayOfWeek, Month Day) - NEW format without year
      // 3. "Mon, January 15" (DayOfWeek, FullMonth Day) - legacy format
      // 4. "Today", "Tomorrow", "Yesterday"
      if (/^[A-Z][a-z]{2}\s+\d{1,2},\s+\d{4}$/.test(text)) {
        // Extract year and month from "Jan 1, 2026" format
        const match = text.match(/^([A-Z][a-z]{2})\s+\d{1,2},\s+(20\d{2})$/);
        if (match) {
          sidebarSourceMonth = match[1];
          sidebarSourceYear = parseInt(match[2]);
        }
        startDateParent = field.closest('div.group.items-center');
        break;
      } else if (/^[A-Z][a-z]{2},\s+[A-Z][a-z]{2,}\s+\d{1,2}$/.test(text)) {
        // "Wed, Dec 31" or "Mon, January 15" format - extract month, get year from drag source
        const match = text.match(/^[A-Z][a-z]{2},\s+([A-Z][a-z]{2,})\s+\d{1,2}$/);
        if (match) {
          const fullOrShortMonth = match[1];
          // Convert full month names to 3-letter abbreviations
          const monthNameMap = {
            'January': 'Jan', 'February': 'Feb', 'March': 'Mar', 'April': 'Apr',
            'May': 'May', 'June': 'Jun', 'July': 'Jul', 'August': 'Aug',
            'September': 'Sep', 'October': 'Oct', 'November': 'Nov', 'December': 'Dec'
          };
          sidebarSourceMonth = monthNameMap[fullOrShortMonth] || fullOrShortMonth;

          // CRITICAL: Infer year intelligently based on sidebar month vs source calendar month
          if (sourceDateInfo && sourceDateInfo.year && sourceDateInfo.month && window.DateUtils) {
            const monthIndexMap = window.DateUtils.MONTH_MAP;
            const sidebarMonthIndex = monthIndexMap[sidebarSourceMonth];
            const sourceCalendarMonthIndex = monthIndexMap[sourceDateInfo.month];

            // If sidebar shows Dec (11) and source calendar shows Jan (0), sidebar is from previous year
            if (sidebarMonthIndex === 11 && sourceCalendarMonthIndex === 0) {
              sidebarSourceYear = sourceDateInfo.year - 1;
            }
            // If sidebar shows Jan (0) and source calendar shows Dec (11), sidebar is from next year
            else if (sidebarMonthIndex === 0 && sourceCalendarMonthIndex === 11) {
              sidebarSourceYear = sourceDateInfo.year + 1;
            }
            // Otherwise, use source year
            else {
              sidebarSourceYear = sourceDateInfo.year;
            }
          } else {
            // Fallback: use current year
            sidebarSourceYear = new Date().getFullYear();
          }
        }
        startDateParent = field.closest('div.group.items-center');
        break;
      } else if (/^(Today|Tomorrow|Yesterday)$/.test(text)) {
        startDateParent = field.closest('div.group.items-center');
        break;
      }
    }

    return {
      startDateParent,
      sidebarSourceYear,
      sidebarSourceMonth,
      fieldTexts
    };
  }

  /**
   * Find date input field in sidebar or date picker popup
   * @param {HTMLElement} sidebar - The sidebar element
   * @returns {HTMLElement|null} The input field or null
   */
  function findInputField(sidebar) {
    let inputField = null;
    const sidebarInputs = sidebar.querySelectorAll('input[type="text"], input:not([type])');

    for (const input of sidebarInputs) {
      const placeholder = input.placeholder || '';
      const style = window.getComputedStyle(input);

      // We're looking for any input that looks like a date field
      if (placeholder && (
          /^[A-Z][a-z]{2},\s+[A-Z][a-z]{2,}\s+\d{1,2}$/.test(placeholder) ||  // "Mon, January 15"
          /^[A-Z][a-z]{2}\s+\d{1,2},\s+\d{4}$/.test(placeholder) ||           // "Jan 1, 2026"
          /^[A-Z][a-z]{2}\s+\d{1,2}$/.test(placeholder)                       // "Jan 1"
      )) {
        if (style.display !== 'none' && style.opacity !== '0') {
          inputField = input;
          break;
        }
      }
    }

    if (!inputField) {
      const datePickerPopup = document.querySelector('div.block.relative input[placeholder]');
      if (datePickerPopup) {
        inputField = datePickerPopup;
      }
    }

    return inputField;
  }

  /**
   * Check and toggle checkboxes related to date updates (notify, linked items, etc.)
   * @param {HTMLElement} sidebar - The sidebar element
   */
  function checkUpdateCheckboxes(sidebar) {
    const checkboxes = sidebar.querySelectorAll('input[type="checkbox"]');

    checkboxes.forEach((checkbox) => {
      // Look for labels or nearby text to identify the checkbox
      const label = checkbox.closest('label') || checkbox.parentElement;
      const labelText = label ? label.textContent.toLowerCase() : '';

      // Check for keywords that suggest this checkbox should be checked
      const shouldCheck = labelText.includes('notify') ||
                         labelText.includes('linked') ||
                         labelText.includes('dependent') ||
                         labelText.includes('update') ||
                         labelText.includes('push') ||
                         labelText.includes('move');

      if (shouldCheck && !checkbox.checked) {
        checkbox.click();
      }
    });
  }

  // Public API
  return {
    injectHideSidebarCSS,
    removeSidebarCSS,
    openSidebar,
    closeAnySidebar,
    closeSidebar,
    findDateField,
    findInputField,
    checkUpdateCheckboxes
  };
})();

// Export for use in other modules
if (typeof window !== 'undefined') {
  window.SidebarManager = SidebarManager;
}
