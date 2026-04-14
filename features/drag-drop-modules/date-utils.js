// Date Utilities Module
// Handles all date extraction, parsing, and formatting operations

const DateUtils = (() => {
  // Constants
  const MONTH_ABBREV = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
                        'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

  const MONTH_NAMES = ['January', 'February', 'March', 'April', 'May', 'June',
                       'July', 'August', 'September', 'October', 'November', 'December'];

  const MONTH_MAP = {
    'Jan': 0, 'Feb': 1, 'Mar': 2, 'Apr': 3, 'May': 4, 'Jun': 5,
    'Jul': 6, 'Aug': 7, 'Sep': 8, 'Oct': 9, 'Nov': 10, 'Dec': 11
  };

  /**
   * Extract the day number from a date cell
   * @param {HTMLElement} cell - The table cell to extract from
   * @returns {string|null} The day number as a string, or null if not found
   */
  function extractDateFromCell(cell) {
    if (!cell) return null;

    // Check if we're in availability view
    const isAvailabilityView = window.ViewDetector && window.ViewDetector.isAvailabilityView();

    if (isAvailabilityView) {
      // In availability view, dates are in column headers
      return extractDateFromColumnHeader(cell);
    } else {
      // In normal view, dates are in the cell itself
      const dateDiv = cell.querySelector('div.font-bold');
      if (dateDiv) {
        return dateDiv.textContent.trim();
      }
    }
    return null;
  }

  /**
   * Extract date from column header in availability view
   * @param {HTMLElement} cell - The table cell (td) to get column index from
   * @returns {string|null} The day number as a string, or null if not found
   */
  function extractDateFromColumnHeader(cell) {
    if (!cell) return null;

    // Get the table
    const table = cell.closest('table');
    if (!table) {
      console.error('DateUtils: extractDateFromColumnHeader - no table found');
      return null;
    }

    // Find the column index of this cell
    const row = cell.parentElement;
    const cellIndex = Array.from(row.children).indexOf(cell);

    // Find the thead element
    const thead = table.querySelector('thead');
    if (!thead) {
      console.error('DateUtils: extractDateFromColumnHeader - no thead found');
      return null;
    }

    // Get the second row of the header (which contains the date numbers)
    const headerRows = thead.querySelectorAll('tr');
    if (headerRows.length < 2) {
      console.error('DateUtils: extractDateFromColumnHeader - thead has less than 2 rows');
      return null;
    }

    const dateRow = headerRows[1]; // Second row contains dates
    const headerCells = dateRow.querySelectorAll('th');

    // Get the header cell at the same column index
    if (cellIndex < headerCells.length) {
      const headerCell = headerCells[cellIndex];
      const dateDiv = headerCell.querySelector('div.font-bold');
      if (dateDiv) {
        const dateNumber = dateDiv.textContent.trim();
        return dateNumber;
      }
    }

    console.error(`DateUtils: extractDateFromColumnHeader - could not find header for column ${cellIndex}`);
    return null;
  }

  /**
   * Extract full date information (day, month, year) from a cell
   * Uses intelligent year inference when year is not explicitly found
   * @param {HTMLElement} cell - The table cell to extract from
   * @param {Object} sourceDateInfo - Optional source date for year inference (from drag start)
   * @returns {Object|null} {day, month, year, monthYear, fullDisplay} or null
   */
  function extractFullDateInfo(cell, sourceDateInfo = null) {
    if (!cell) {
      console.error('DateUtils: extractFullDateInfo - cell is null');
      return null;
    }

    // Check if we're in availability view
    const isAvailabilityView = window.ViewDetector && window.ViewDetector.isAvailabilityView();

    let dateNumber;
    if (isAvailabilityView) {
      // In availability view, dates are in column headers
      dateNumber = extractDateFromColumnHeader(cell);
      if (!dateNumber) {
        console.error('DateUtils: extractFullDateInfo - failed to extract date from column header');
        return null;
      }
    } else {
      // In normal view, dates are in the cell itself
      const dateDiv = cell.querySelector('div.font-bold');
      if (!dateDiv) {
        console.error('DateUtils: extractFullDateInfo - no font-bold div found in cell');
        return null;
      }
      dateNumber = dateDiv.textContent.trim();
    }

    let month = null;
    let year = null;

    // Search for month marker in table
    const table = cell.closest('table');
    if (table) {
      const allCells = table.querySelectorAll('td');
      const cellArray = Array.from(allCells);
      const currentCellIndex = cellArray.indexOf(cell);

      for (let i = currentCellIndex; i >= 0; i--) {
        const cellToCheck = cellArray[i];
        const boldDivs = cellToCheck.querySelectorAll('div.font-bold');

        for (const div of boldDivs) {
          const text = div.textContent.trim();

          // Check for year (4 digits)
          const yearMatch = text.match(/\b(20\d{2})\b/);
          if (yearMatch && !year) {
            year = parseInt(yearMatch[1]);
          }

          // Check for month name
          if (!month) {
            for (let m = 0; m < MONTH_NAMES.length; m++) {
              if (text === MONTH_NAMES[m]) {
                month = MONTH_ABBREV[m];
                break;
              }
            }
          }
        }
        // Continue searching until we have both month AND year, or reach the beginning
        if (month && year) break;
      }
    }

    // If month or year not found in table, search the entire page
    if (!month || !year) {
      // Strategy 1: Look for calendar navigation/header elements with specific selectors
      const calendarHeaders = document.querySelectorAll('h1, h2, h3, h4, button, div[class*="header"], div[class*="nav"]');
      for (const header of calendarHeaders) {
        const text = header.textContent.trim();
        const match = text.match(/\b([A-Z][a-z]+)\s+(20\d{2})\b/);
        if (match) {
          const foundMonth = match[1];
          const foundYear = parseInt(match[2]);
          const monthIndex = MONTH_NAMES.indexOf(foundMonth);

          if (monthIndex >= 0) {
            if (!month) {
              month = MONTH_ABBREV[monthIndex];
            }
            if (!year) {
              year = foundYear;
            }
            if (month && year) break;
          }
        }
      }
    }

    // Strategy 2: Search all bold text on page for month/year patterns
    let pageFoundMonth = null; // Track which month the year came from
    if (!month || !year) {
      const allBoldElements = document.querySelectorAll('div.font-bold, strong, b, [class*="bold"]');
      for (const elem of allBoldElements) {
        const text = elem.textContent.trim();
        const match = text.match(/\b([A-Z][a-z]+)\s+(20\d{2})\b/);
        if (match) {
          const foundMonth = match[1];
          const foundYear = parseInt(match[2]);
          const monthIndex = MONTH_NAMES.indexOf(foundMonth);

          if (monthIndex >= 0) {
            if (!month) {
              month = MONTH_ABBREV[monthIndex];
            }
            if (!year) {
              year = foundYear;
              pageFoundMonth = MONTH_ABBREV[monthIndex];
            }
            if (month && year) break;
          }
        }
      }
    }

    // Strategy 3: General page text search (last resort)
    if (!month || !year) {
      const pageText = document.body.innerText;
      const monthYearMatches = pageText.match(/\b([A-Z][a-z]+)\s+(20\d{2})\b/g);

      if (monthYearMatches && monthYearMatches.length > 0) {
        // Try each match to see if it's a valid month
        for (const match of monthYearMatches) {
          const parts = match.match(/\b([A-Z][a-z]+)\s+(20\d{2})\b/);
          if (parts && parts.length >= 3) {
            const foundMonth = parts[1];
            const foundYear = parseInt(parts[2]);

            // Check if it's a valid month name
            const monthIndex = MONTH_NAMES.indexOf(foundMonth);
            if (monthIndex >= 0) {
              if (!month) {
                month = MONTH_ABBREV[monthIndex];
              }
              if (!year) {
                year = foundYear;
                pageFoundMonth = MONTH_ABBREV[monthIndex];
              }
              if (month && year) break;
            }
          }
        }
      }
    }

    // CRITICAL: Validate year if it came from a different month
    // If we found "Dec 2025" on page but extracting a Jan cell, that Jan is likely 2026
    if (year && month && pageFoundMonth && pageFoundMonth !== month) {
      const pageMonthIndex = MONTH_MAP[pageFoundMonth];
      const targetMonthIndex = MONTH_MAP[month];

      // If page shows Nov/Dec with year X, but cell is Jan/Feb, cell is likely year X+1
      if (pageMonthIndex >= 10 && targetMonthIndex <= 1) {
        year = year + 1;
      }
      // If page shows Jan/Feb with year X, but cell is Nov/Dec, cell is likely year X-1
      else if (pageMonthIndex <= 1 && targetMonthIndex >= 10) {
        year = year - 1;
      }
    }

    // Fallback to smart year inference using source date or current date
    if (!month || !year) {
      // Try to use the source date info (from drag start) as baseline
      let baselineMonth, baselineYear;

      if (sourceDateInfo && sourceDateInfo.month && sourceDateInfo.year) {
        baselineMonth = MONTH_MAP[sourceDateInfo.month];
        baselineYear = sourceDateInfo.year;
      } else {
        // Fall back to real-world current date
        const now = new Date();
        baselineMonth = now.getMonth();
        baselineYear = now.getFullYear();
      }

      if (!month) {
        month = MONTH_ABBREV[baselineMonth];
      }

      if (!year && month) {
        // Smart year inference based on baseline date
        const targetMonthIndex = MONTH_ABBREV.indexOf(month);

        // If baseline is Nov/Dec and target is Jan/Feb, likely next year
        if (baselineMonth >= 10 && targetMonthIndex <= 1) {
          year = baselineYear + 1;
        }
        // If baseline is Jan/Feb and target is Nov/Dec, likely previous year
        else if (baselineMonth <= 1 && targetMonthIndex >= 10) {
          year = baselineYear - 1;
        }
        // Otherwise, assume baseline year
        else {
          year = baselineYear;
        }
      }
    }

    const result = {
      day: dateNumber,
      month: month,
      year: year,
      monthYear: month,
      fullDisplay: `${month} ${dateNumber}, ${year}`
    };

    return result;
  }

  /**
   * Format date information for JobTread input field
   * Always includes year if available for unambiguous date specification
   * @param {Object} dateInfo - {day, month, year}
   * @param {string} sourceMonth - Optional source month (unused, kept for API compatibility)
   * @returns {string} Formatted date string (e.g., "Jan 15 2026")
   */
  function formatDateForInput(dateInfo, sourceMonth = null) {
    if (!dateInfo) {
      console.error('DateUtils: formatDateForInput - dateInfo is null/undefined');
      return '';
    }

    if (!dateInfo.day) {
      console.error('DateUtils: formatDateForInput - day is missing from dateInfo');
      return '';
    }

    let month = dateInfo.month || '';

    if (!month) {
      const now = new Date();
      month = MONTH_ABBREV[now.getMonth()];
    }

    // Always include the year if available - no ambiguity, no inference needed
    // Format: "Jan 15 2026" (no comma, matches what JobTread accepts)
    let formattedDate;
    if (dateInfo.year) {
      formattedDate = `${month} ${dateInfo.day} ${dateInfo.year}`;
    } else {
      formattedDate = `${month} ${dateInfo.day}`;
    }

    return formattedDate;
  }

  // Public API
  return {
    extractDateFromCell,
    extractFullDateInfo,
    formatDateForInput,
    // Export constants for use by other modules
    MONTH_ABBREV,
    MONTH_NAMES,
    MONTH_MAP
  };
})();

// Export for use in other modules
if (typeof window !== 'undefined') {
  window.DateUtils = DateUtils;
}
