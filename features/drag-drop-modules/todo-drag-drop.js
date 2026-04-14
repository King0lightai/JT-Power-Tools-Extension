// ToDo Drag & Drop Module
// Handles drag and drop for ToDos in the month view calendar
// ToDos only have a Due date (no Start/End dates)

const ToDoDragDrop = (() => {
  /**
   * Check if the current URL indicates we're on the ToDos page
   * @returns {boolean} True if URL contains "to-dos"
   */
  function isToDosPage() {
    return window.location.href.includes('to-dos');
  }

  /**
   * Check if a dragged element is a ToDo item
   * This can be determined by the sidebar content when opened
   * @param {HTMLElement} sidebar - The sidebar element
   * @returns {boolean} True if the sidebar shows a ToDo item
   */
  function isToDoItem(sidebar) {
    if (!sidebar) return false;

    // Look for "Due" label without Start/End labels (ToDo-specific pattern)
    const allLabels = Array.from(sidebar.querySelectorAll('span.font-bold'));
    const labelTexts = allLabels.map(l => l.textContent.trim());

    // ToDos have "Due" but typically don't have "Start" or "End"
    const hasDue = labelTexts.includes('Due');
    const hasStart = labelTexts.includes('Start');
    const hasEnd = labelTexts.includes('End');

    // If we have Due but not Start AND not End, this is likely a ToDo
    // (Some task types may have Due + Start/End, but pure ToDos only have Due)
    return hasDue && !hasStart && !hasEnd;
  }

  /**
   * Determine if we should use ToDo mode for a date change
   * Combines URL check and sidebar check
   * @param {HTMLElement} sidebar - The sidebar element (optional, for verification)
   * @returns {boolean} True if we should use ToDo mode
   */
  function shouldUseToDoDragDrop(sidebar = null) {
    // Primary check: URL contains "to-dos"
    if (isToDosPage()) {
      return true;
    }

    // Secondary check: Verify by sidebar content if provided
    if (sidebar && isToDoItem(sidebar)) {
      return true;
    }

    return false;
  }

  /**
   * Get the field type to use based on current context
   * For ToDos, always returns 'Due'
   * For other items, returns 'Start' or 'End' based on Alt key
   * @param {boolean} altKeyPressed - Whether Alt key was pressed (for End date)
   * @param {HTMLElement} sidebar - The sidebar element (optional)
   * @returns {string} The field type: 'Due', 'Start', or 'End'
   */
  function getFieldTypeForContext(altKeyPressed = false, sidebar = null) {
    if (shouldUseToDoDragDrop(sidebar)) {
      // ToDos only have Due date - Alt key doesn't change this
      return 'Due';
    }

    // Default behavior for non-ToDo items
    return altKeyPressed ? 'End' : 'Start';
  }

  /**
   * Find the Due date field in the ToDo sidebar
   * @param {HTMLElement} sidebar - The sidebar element
   * @param {Object} sourceDateInfo - The source date info for year inference
   * @returns {Object} {dueDateParent, sidebarSourceYear, sidebarSourceMonth, fieldTexts}
   */
  function findDueDateField(sidebar, sourceDateInfo) {
    // Find the label "Due"
    const allLabels = Array.from(sidebar.querySelectorAll('span.font-bold'));
    const dueLabel = allLabels.find(span => span.textContent.trim() === 'Due');

    if (!dueLabel) {
      console.error('ToDoDragDrop: Could not find "Due" label in sidebar');
      return { dueDateParent: null, sidebarSourceYear: null, sidebarSourceMonth: null, fieldTexts: [] };
    }

    // Find the container for the Due label
    // The structure is: div.flex-1 > div.flex > span.font-bold "Due"
    // And the date field is in div.block.relative within the same flex-1 container
    const labelContainer = dueLabel.closest('div.flex-1');
    if (!labelContainer) {
      console.error('ToDoDragDrop: Could not find container for "Due" label');
      return { dueDateParent: null, sidebarSourceYear: null, sidebarSourceMonth: null, fieldTexts: [] };
    }

    // Find date fields within this container
    const allDateFields = labelContainer.querySelectorAll('div.text-gray-700.truncate.leading-tight');

    let dueDateParent = null;
    let sidebarSourceYear = null;
    let sidebarSourceMonth = null;
    const fieldTexts = [];

    for (const field of allDateFields) {
      const text = field.textContent.trim();
      fieldTexts.push(text);

      // Match date formats:
      // 1. "Jan 1, 2026" (Month Day, Year)
      // 2. "Wed, Dec 31" (DayOfWeek, Month Day)
      // 3. "Today", "Tomorrow", "Yesterday"
      if (/^[A-Z][a-z]{2}\s+\d{1,2},\s+\d{4}$/.test(text)) {
        // Extract year and month from "Jan 1, 2026" format
        const match = text.match(/^([A-Z][a-z]{2})\s+\d{1,2},\s+(20\d{2})$/);
        if (match) {
          sidebarSourceMonth = match[1];
          sidebarSourceYear = parseInt(match[2]);
        }
        dueDateParent = field.closest('div.group.items-center');
        break;
      } else if (/^[A-Z][a-z]{2},\s+[A-Z][a-z]{2,}\s+\d{1,2}$/.test(text)) {
        // "Wed, Dec 31" format - extract month, infer year
        const match = text.match(/^[A-Z][a-z]{2},\s+([A-Z][a-z]{2,})\s+\d{1,2}$/);
        if (match) {
          const fullOrShortMonth = match[1];
          const monthNameMap = {
            'January': 'Jan', 'February': 'Feb', 'March': 'Mar', 'April': 'Apr',
            'May': 'May', 'June': 'Jun', 'July': 'Jul', 'August': 'Aug',
            'September': 'Sep', 'October': 'Oct', 'November': 'Nov', 'December': 'Dec'
          };
          sidebarSourceMonth = monthNameMap[fullOrShortMonth] || fullOrShortMonth;

          // Infer year from drag source with year boundary logic
          if (sourceDateInfo && sourceDateInfo.year && sourceDateInfo.month && window.DateUtils) {
            const monthIndexMap = window.DateUtils.MONTH_MAP;
            const sidebarMonthIndex = monthIndexMap[sidebarSourceMonth];
            const sourceCalendarMonthIndex = monthIndexMap[sourceDateInfo.month];

            // Apply year boundary logic
            if (sidebarMonthIndex === 11 && sourceCalendarMonthIndex === 0) {
              sidebarSourceYear = sourceDateInfo.year - 1;
            } else if (sidebarMonthIndex === 0 && sourceCalendarMonthIndex === 11) {
              sidebarSourceYear = sourceDateInfo.year + 1;
            } else {
              sidebarSourceYear = sourceDateInfo.year;
            }
          } else {
            sidebarSourceYear = new Date().getFullYear();
          }
        }
        dueDateParent = field.closest('div.group.items-center');
        break;
      } else if (/^(Today|Tomorrow|Yesterday)$/.test(text)) {
        dueDateParent = field.closest('div.group.items-center');
        break;
      }
    }

    return {
      dueDateParent,
      sidebarSourceYear,
      sidebarSourceMonth,
      fieldTexts
    };
  }

  // Public API
  return {
    isToDosPage,
    isToDoItem,
    shouldUseToDoDragDrop,
    getFieldTypeForContext,
    findDueDateField
  };
})();

// Export for use in other modules
if (typeof window !== 'undefined') {
  window.ToDoDragDrop = ToDoDragDrop;
}
