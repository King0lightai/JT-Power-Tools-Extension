// View Detector Module
// Detects which schedule view mode is active (normal or availability)

const ViewDetector = (() => {
  /**
   * Check if the availability view is currently active
   * @returns {boolean} True if availability view is active
   */
  function isAvailabilityView() {
    // ONLY method: Check if table has user rows with avatars in first column
    // This is unique to availability view - normal views don't have user avatars in cells

    // Look for tbody rows that have user info cells
    const tables = document.querySelectorAll('table');
    let hasUserRows = false;

    for (const table of tables) {
      const tbody = table.querySelector('tbody');
      if (!tbody) continue;

      const rows = tbody.querySelectorAll('tr');
      if (rows.length === 0) continue;

      // Check first few rows for user info pattern
      let userRowCount = 0;
      for (let i = 0; i < Math.min(3, rows.length); i++) {
        const row = rows[i];
        const firstCell = row.querySelector('td');
        if (!firstCell) continue;

        // Availability view has user avatars (bg-cover bg-center) and names in first column
        const hasAvatar = firstCell.querySelector('div.relative.bg-cover.bg-center');
        const hasUserName = firstCell.querySelector('div.font-bold.truncate');

        if (hasAvatar || hasUserName) {
          userRowCount++;
        }
      }

      // If we found user info in multiple rows, this is availability view
      if (userRowCount >= 2) {
        hasUserRows = true;
        break;
      }
    }

    // Additionally check for thead with 2 rows (weekday + date number rows)
    // This confirms availability view structure
    let hasAvailabilityHeader = false;
    for (const table of tables) {
      const thead = table.querySelector('thead');
      if (!thead) continue;

      const headerRows = thead.querySelectorAll('tr');
      if (headerRows.length >= 2) {
        // Check if second row has date numbers in <th> elements
        const secondRow = headerRows[1];
        const cells = secondRow.querySelectorAll('th');
        let hasDateNumbers = false;

        for (const cell of cells) {
          const div = cell.querySelector('div.font-bold');
          if (div) {
            const text = div.textContent.trim();
            // Check if it's a number between 1-31 (date)
            const num = parseInt(text);
            if (!isNaN(num) && num >= 1 && num <= 31) {
              hasDateNumbers = true;
              break;
            }
          }
        }

        if (hasDateNumbers) {
          hasAvailabilityHeader = true;
          break;
        }
      }
    }

    const isAvailability = hasUserRows && hasAvailabilityHeader;

    return isAvailability;
  }

  /**
   * Get the current view type
   * @returns {string} 'availability' or 'normal'
   */
  function getViewType() {
    return isAvailabilityView() ? 'availability' : 'normal';
  }

  /**
   * Get appropriate selectors based on current view
   * @returns {Object} Object with scheduleItems and dateCells selectors
   */
  function getSelectorsForCurrentView() {
    const viewType = getViewType();

    if (viewType === 'availability') {
      return {
        // In availability view, schedule items are still divs with background colors
        // but they may be in different cell types (td or th)
        scheduleItems: 'div.cursor-pointer[style*="background-color"], div[style*="background-color"]:not(.jt-weekend-cell)',

        // Date cells in availability view are table headers for the week columns
        // They could be th or td elements
        dateCells: 'td, th',

        viewType: 'availability'
      };
    } else {
      return {
        // Normal schedule view selectors (existing behavior)
        scheduleItems: 'div.cursor-pointer[style*="background-color"]',
        dateCells: 'td.group.text-xs',
        viewType: 'normal'
      };
    }
  }

  /**
   * Check if we're in a popup/modal availability view (vs main schedule page)
   * @returns {boolean} True if in popup, false if on main schedule page
   */
  function isInPopup() {
    // Look for common popup/modal container indicators
    const tables = document.querySelectorAll('table');

    for (const table of tables) {
      // Check if this table has availability view structure
      const tbody = table.querySelector('tbody');
      if (!tbody) continue;

      const hasUserRows = Array.from(tbody.querySelectorAll('tr')).some(row => {
        const firstCell = row.querySelector('td');
        if (!firstCell) return false;
        return firstCell.querySelector('div.relative.bg-cover.bg-center') ||
               firstCell.querySelector('div.font-bold.truncate');
      });

      if (hasUserRows) {
        // This is an availability view table, now check if it's in a popup
        // Look for parent elements that indicate a popup/modal
        let element = table;
        while (element && element !== document.body) {
          const style = window.getComputedStyle(element);

          // Check for fixed positioning (common in popups/modals)
          if (style.position === 'fixed') {
            return true;
          }

          // Check for high z-index (popups typically have high z-index)
          const zIndex = parseInt(style.zIndex);
          if (!isNaN(zIndex) && zIndex > 40) {
            return true;
          }

          // Check for common modal/dialog class patterns
          const className = element.className || '';
          if (typeof className === 'string' && (
              className.includes('modal') ||
              className.includes('dialog') ||
              className.includes('popup') ||
              className.includes('overlay')
          )) {
            return true;
          }

          element = element.parentElement;
        }

        return false;
      }
    }

    return false;
  }

  // Public API
  return {
    isAvailabilityView,
    getViewType,
    getSelectorsForCurrentView,
    isInPopup
  };
})();

// Export for use in other modules
if (typeof window !== 'undefined') {
  window.ViewDetector = ViewDetector;
}
