// Weekend Utilities Module
// Handles weekend detection, adjustment, and styling

const WeekendUtils = (() => {
  const MONTH_MAP = {
    'Jan': 0, 'Feb': 1, 'Mar': 2, 'Apr': 3, 'May': 4, 'Jun': 5,
    'Jul': 6, 'Aug': 7, 'Sep': 8, 'Oct': 9, 'Nov': 10, 'Dec': 11
  };

  const MONTH_ABBREV = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
                        'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

  /**
   * Check if a cell represents a weekend date
   * @param {HTMLElement} cell - The table cell to check
   * @param {Object} providedDateInfo - Optional pre-extracted date info {day, month, year}
   * @returns {boolean} True if the date is a Saturday or Sunday
   */
  function isWeekendCell(cell, providedDateInfo = null) {
    // If date info is provided, use it; otherwise extract from cell
    const dateInfo = providedDateInfo || (window.DateUtils && window.DateUtils.extractFullDateInfo(cell));

    if (!dateInfo || !dateInfo.day || !dateInfo.month) return false;

    // Use the year from dateInfo (which now includes year from extraction)
    const year = dateInfo.year || new Date().getFullYear();

    const monthIndex = MONTH_MAP[dateInfo.month];
    if (monthIndex === undefined) return false;

    const date = new Date(year, monthIndex, parseInt(dateInfo.day));
    const dayOfWeek = date.getDay(); // 0 = Sunday, 6 = Saturday

    return dayOfWeek === 0 || dayOfWeek === 6;
  }

  /**
   * Adjust date to skip weekends (move to next Monday)
   * @param {Object} dateInfo - {day, month, year}
   * @returns {Object} Adjusted date info {day, month, year, fullDisplay}
   */
  function adjustDateToSkipWeekend(dateInfo) {
    const year = dateInfo.year || new Date().getFullYear();
    const monthIndex = MONTH_MAP[dateInfo.month];
    const date = new Date(year, monthIndex, parseInt(dateInfo.day));
    const dayOfWeek = date.getDay();

    // If Saturday (6), add 2 days to get to Monday
    // If Sunday (0), add 1 day to get to Monday
    if (dayOfWeek === 6) {
      date.setDate(date.getDate() + 2);
    } else if (dayOfWeek === 0) {
      date.setDate(date.getDate() + 1);
    }

    return {
      day: date.getDate().toString(),
      month: MONTH_ABBREV[date.getMonth()],
      year: date.getFullYear(),
      fullDisplay: `${MONTH_ABBREV[date.getMonth()]} ${date.getDate()}, ${date.getFullYear()}`
    };
  }

  /**
   * Inject CSS to grey out weekend columns
   * Idempotent - safe to call multiple times
   */
  function injectWeekendCSS() {
    if (document.getElementById('jt-weekend-styling')) return;

    const style = document.createElement('style');
    style.id = 'jt-weekend-styling';
    style.textContent = `
      /* Grey out weekend columns */
      td.jt-weekend-cell {
        background-color: rgba(0, 0, 0, 0.03) !important;
        opacity: 0.6;
      }

      /* Slightly darker on hover to show it's still interactive with Shift */
      td.jt-weekend-cell:hover {
        background-color: rgba(0, 0, 0, 0.05) !important;
      }
    `;
    document.head.appendChild(style);
  }

  /**
   * Remove weekend CSS styling
   */
  function removeWeekendCSS() {
    const weekendStyle = document.getElementById('jt-weekend-styling');
    if (weekendStyle) {
      weekendStyle.remove();
    }
  }

  // Public API
  return {
    isWeekendCell,
    adjustDateToSkipWeekend,
    injectWeekendCSS,
    removeWeekendCSS
  };
})();

// Export for use in other modules
if (typeof window !== 'undefined') {
  window.WeekendUtils = WeekendUtils;
}
