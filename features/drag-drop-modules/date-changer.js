// Date Changer Module
// Orchestrates the process of changing a task's date by manipulating the sidebar

const DateChanger = (() => {
  /**
   * Main function to attempt changing a task's date
   * @param {HTMLElement} element - The dragged element
   * @param {string} newDateNumber - The new day number
   * @param {HTMLElement} targetCell - The target cell that was dropped on
   * @param {Object} providedDateInfo - The full date info {day, month, year}
   * @param {Object} sourceDateInfo - The source date info from drag start
   * @param {Function} onDateChangeComplete - Callback when date change is complete
   * @param {boolean} changeEndDate - If true, change End date instead of Start date (Alt key)
   * @returns {Promise} Resolves when date change is complete
   */
  function attemptDateChange(element, newDateNumber, targetCell, providedDateInfo, sourceDateInfo, onDateChangeComplete, changeEndDate = false) {
    try {
      const dateInfo = providedDateInfo || (window.DateUtils && window.DateUtils.extractFullDateInfo(targetCell, sourceDateInfo));

      if (!dateInfo) {
        if (window.UIUtils) {
          window.UIUtils.showNotification('Error: Could not extract date information');
        }
        return;
      }

      // Close any open sidebar first to prevent conflicts
      if (window.SidebarManager) {
        const hadOpenSidebar = window.SidebarManager.closeAnySidebar();
        if (hadOpenSidebar) {
          // Wait a bit for the sidebar to close
          setTimeout(() => continueWithDateChange(), 300);
          return;
        }
      }

      continueWithDateChange();

      function continueWithDateChange() {
        // Inject CSS to hide sidebar
        const hideStyle = window.SidebarManager ? window.SidebarManager.injectHideSidebarCSS() : null;

        // Failsafe: Remove CSS after 5 seconds no matter what
        const failsafeTimeout = setTimeout(() => {
          if (window.SidebarManager) {
            window.SidebarManager.removeSidebarCSS();
          }
        }, 5000);

        // Click to open sidebar
        if (window.SidebarManager) {
          window.SidebarManager.openSidebar(element);
        } else {
          element.click();
        }

        // Wait for sidebar and process
        setTimeout(() => {
          const sidebar = document.querySelector('div.overflow-y-auto.overscroll-contain.sticky');

          if (sidebar) {
            // Determine which field to change based on context
            let fieldType;
            if (window.ToDoDragDrop && window.ToDoDragDrop.shouldUseToDoDragDrop(sidebar)) {
              fieldType = 'Due';
            } else {
              fieldType = changeEndDate ? 'End' : 'Start';
            }

            // Find date field (Start, End, or Due for ToDos)
            const fieldResult = window.SidebarManager
              ? window.SidebarManager.findDateField(sidebar, sourceDateInfo, fieldType)
              : { startDateParent: null, sidebarSourceYear: null, sidebarSourceMonth: null, fieldTexts: [] };

            const { startDateParent, sidebarSourceYear, sidebarSourceMonth, fieldTexts } = fieldResult;

            // Show notification about which date is being changed
            if (window.UIUtils) {
              const formattedNewDate = `${dateInfo.month} ${dateInfo.day}, ${dateInfo.year}`;
              window.UIUtils.showNotification(`Changing ${fieldType} date to ${formattedNewDate}`);
            }

            // If we found year and month in sidebar, recalculate target year
            if (sidebarSourceYear && sidebarSourceMonth && providedDateInfo && window.DateUtils) {
              const monthMap = window.DateUtils.MONTH_MAP;
              const sourceMonthIndex = monthMap[sidebarSourceMonth];
              const targetMonthIndex = monthMap[dateInfo.month];

              // Apply year boundary logic using ACTUAL source year from sidebar
              if (sourceMonthIndex === targetMonthIndex) {
                // Same month - use source year
                dateInfo.year = sidebarSourceYear;
              } else if (sourceMonthIndex === 11 && targetMonthIndex === 0) {
                // Dec → Jan: next year
                dateInfo.year = sidebarSourceYear + 1;
              } else if (sourceMonthIndex === 0 && targetMonthIndex === 11) {
                // Jan → Dec: previous year
                dateInfo.year = sidebarSourceYear - 1;
              } else {
                // Other month change - use source year
                dateInfo.year = sidebarSourceYear;
              }
            }

            if (startDateParent) {
              const formattedDate = window.DateUtils
                ? window.DateUtils.formatDateForInput(dateInfo, sidebarSourceMonth)
                : `${dateInfo.month} ${dateInfo.day} ${dateInfo.year}`;

              // Check update checkboxes
              if (window.SidebarManager) {
                window.SidebarManager.checkUpdateCheckboxes(sidebar);
              }

              startDateParent.click();

              setTimeout(() => {
                // PRIORITY 1: Try to find a date input field to type into
                const inputField = window.SidebarManager
                  ? window.SidebarManager.findInputField(sidebar)
                  : null;

                // If we found an input field, use the typing method (most reliable)
                if (inputField) {
                  typeIntoDateField(inputField, formattedDate, dateInfo, failsafeTimeout, onDateChangeComplete);
                } else {
                  // PRIORITY 2: Fallback to calendar dropdown manipulation
                  useCalendarPicker(dateInfo, failsafeTimeout, onDateChangeComplete);
                }
              }, 400);
            } else {
              if (window.UIUtils) {
                window.UIUtils.showNotification('Could not find date field. Check console for details.');
              }
              if (window.SidebarManager) {
                window.SidebarManager.closeSidebar(failsafeTimeout, onDateChangeComplete);
              }
            }
          } else {
            if (window.UIUtils) {
              window.UIUtils.showNotification('Sidebar did not open. Please try manually.');
            }
            if (window.SidebarManager) {
              window.SidebarManager.closeSidebar(failsafeTimeout, onDateChangeComplete);
            }
          }
        }, 500);
      }  // End of continueWithDateChange function

    } catch (error) {
      console.error('DateChanger: Error:', error.message);
      if (window.UIUtils) {
        window.UIUtils.showNotification('Error during date change. Check console for details.');
      }

      // Notify completion even on error
      if (onDateChangeComplete) {
        onDateChangeComplete();
      }

      // Try to clean up CSS even on error
      if (window.SidebarManager) {
        window.SidebarManager.removeSidebarCSS();
      }
    }
  }

  /**
   * Click Save button if in availability view
   * In availability view, date changes must be saved explicitly
   * The Save button is on the main page, not in the sidebar
   * This should be called AFTER the sidebar closes
   * @returns {Promise} Resolves when save is complete (or immediately if not needed)
   */
  function clickSaveButtonIfNeeded() {
    return new Promise((resolve) => {
      // Check if we're in availability view
      const isAvailabilityView = window.ViewDetector && window.ViewDetector.isAvailabilityView();

      if (!isAvailabilityView) {
        resolve();
        return;
      }

      // Look for the Save button on the main page (not in sidebar)
      const buttons = document.querySelectorAll('div[role="button"]');
      let saveButton = null;

      for (const button of buttons) {
        const text = button.textContent.trim();
        const classes = button.className || '';

        // Check if this is the blue Save button
        if (text.includes('Save') &&
            (classes.includes('bg-blue-500') || classes.includes('bg-blue-600'))) {
          saveButton = button;
          break;
        }
      }

      if (saveButton) {
        saveButton.click();

        // Wait a bit for the save to complete
        setTimeout(() => {
          resolve();
        }, 300);
      } else {
        resolve();
      }
    });
  }

  /**
   * Type the date into an input field (most reliable method)
   */
  function typeIntoDateField(inputField, formattedDate, dateInfo, failsafeTimeout, onDateChangeComplete) {
    inputField.value = '';
    inputField.focus();
    inputField.value = formattedDate;

    // Dispatch input event
    inputField.dispatchEvent(new Event('input', { bubbles: true }));

    // Simulate pressing Enter key to trigger the full update
    const enterEvent = new KeyboardEvent('keydown', {
      key: 'Enter',
      code: 'Enter',
      keyCode: 13,
      which: 13,
      bubbles: true,
      cancelable: true
    });
    inputField.dispatchEvent(enterEvent);

    // Also dispatch keyup for Enter
    const enterUpEvent = new KeyboardEvent('keyup', {
      key: 'Enter',
      code: 'Enter',
      keyCode: 13,
      which: 13,
      bubbles: true,
      cancelable: true
    });
    inputField.dispatchEvent(enterUpEvent);

    // Dispatch change and blur events
    inputField.dispatchEvent(new Event('change', { bubbles: true }));
    inputField.dispatchEvent(new Event('blur', { bubbles: true }));

    setTimeout(() => {
      // Close the sidebar first
      if (window.SidebarManager) {
        window.SidebarManager.closeSidebar(failsafeTimeout, async () => {
          // After sidebar closes, click Save button if in availability view
          await clickSaveButtonIfNeeded();

          // Then notify completion
          if (onDateChangeComplete) {
            onDateChangeComplete();
          }
        });
      }
    }, 500);
  }

  /**
   * Use calendar dropdown method (fallback when no input field found)
   */
  function useCalendarPicker(dateInfo, failsafeTimeout, onDateChangeComplete) {
    const sidebar = document.querySelector('div.overflow-y-auto.overscroll-contain.sticky');
    let monthSelect = null;
    let yearSelect = null;

    // Strategy 1: Look for selects inside a popup container
    const popups = document.querySelectorAll('div.block, div[style*="position"], div.absolute, div.fixed');
    for (const popup of popups) {
      const popupMonthSelect = popup.querySelector('select option[value="1"]')?.closest('select');
      const popupYearSelect = popup.querySelector('select option[value="2026"]')?.closest('select');

      if (popupMonthSelect && popupYearSelect) {
        // Verify this is a date picker (has 12 month options)
        const monthOptions = popupMonthSelect.querySelectorAll('option');
        if (monthOptions.length === 12) {
          monthSelect = popupMonthSelect;
          yearSelect = popupYearSelect;
          break;
        }
      }
    }

    // Strategy 2: Look inside the sidebar itself
    if (!monthSelect || !yearSelect) {
      const sidebarMonthSelect = sidebar?.querySelector('select option[value="1"]')?.closest('select');
      const sidebarYearSelect = sidebar?.querySelector('select option[value="2026"]')?.closest('select');

      if (sidebarMonthSelect && sidebarYearSelect) {
        const monthOptions = sidebarMonthSelect.querySelectorAll('option');
        if (monthOptions.length === 12) {
          monthSelect = sidebarMonthSelect;
          yearSelect = sidebarYearSelect;
        }
      }
    }

    if (monthSelect && yearSelect) {
      setDatePickerAndClickDay(monthSelect, yearSelect, dateInfo, failsafeTimeout, onDateChangeComplete);
    } else {
      if (window.UIUtils) {
        window.UIUtils.showNotification('Could not find date input method. Please try manually.');
      }
      setTimeout(() => {
        if (window.SidebarManager) {
          window.SidebarManager.closeSidebar(failsafeTimeout, onDateChangeComplete);
        }
      }, 500);
    }
  }

  /**
   * Set the date picker dropdowns and click the day
   */
  function setDatePickerAndClickDay(monthSelect, yearSelect, dateInfo, failsafeTimeout, onDateChangeComplete) {
    // Map month names to select values (1-12, JobTread's select format)
    const monthMap = {
      'Jan': '1', 'Feb': '2', 'Mar': '3', 'Apr': '4', 'May': '5', 'Jun': '6',
      'Jul': '7', 'Aug': '8', 'Sep': '9', 'Oct': '10', 'Nov': '11', 'Dec': '12'
    };

    const targetMonthValue = monthMap[dateInfo.month];
    const targetYearValue = dateInfo.year.toString();

    // Set year AND month rapidly in succession
    yearSelect.value = targetYearValue;
    yearSelect.dispatchEvent(new Event('change', { bubbles: true }));
    yearSelect.dispatchEvent(new Event('input', { bubbles: true }));

    monthSelect.value = targetMonthValue;
    monthSelect.dispatchEvent(new Event('change', { bubbles: true }));
    monthSelect.dispatchEvent(new Event('input', { bubbles: true }));

    // Retry mechanism to ensure dropdowns stay set correctly
    let retryCount = 0;
    const maxRetries = 5;

    function verifyAndRetry() {
      setTimeout(() => {
        retryCount++;

        try {
          if (monthSelect && yearSelect) {
            if (monthSelect.value !== targetMonthValue || yearSelect.value !== targetYearValue) {
              if (retryCount < maxRetries) {
                // Re-set both rapidly
                yearSelect.value = targetYearValue;
                yearSelect.dispatchEvent(new Event('change', { bubbles: true }));
                yearSelect.dispatchEvent(new Event('input', { bubbles: true }));
                monthSelect.value = targetMonthValue;
                monthSelect.dispatchEvent(new Event('change', { bubbles: true }));
                monthSelect.dispatchEvent(new Event('input', { bubbles: true }));
                // Try again
                verifyAndRetry();
                return;
              } else {
                if (window.UIUtils) {
                  window.UIUtils.showNotification('Date picker not responding correctly. Please try manually.');
                }
                if (window.SidebarManager) {
                  window.SidebarManager.closeSidebar(failsafeTimeout, onDateChangeComplete);
                }
                return;
              }
            }
          }

          // Dropdowns are correct, proceed with clicking
          clickDayInCalendar(dateInfo, failsafeTimeout, onDateChangeComplete);

        } catch (error) {
          if (window.UIUtils) {
            window.UIUtils.showNotification('Error during date picker verification: ' + error.message);
          }
          if (window.SidebarManager) {
            window.SidebarManager.closeSidebar(failsafeTimeout, onDateChangeComplete);
          }
        }
      }, retryCount === 0 ? 400 : 300);
    }

    // Start verification process
    verifyAndRetry();
  }

  /**
   * Find and click the day in the calendar
   */
  function clickDayInCalendar(dateInfo, failsafeTimeout, onDateChangeComplete) {
    try {
      // Find calendar table
      let calendarTable = null;

      // Strategy 1: Look for table in the date picker popup
      const popupTables = document.querySelectorAll('div.p-1 table');

      if (popupTables.length > 0) {
        calendarTable = popupTables[popupTables.length - 1];
      }

      // Strategy 2: Find by the thead with S M T W T F S header
      if (!calendarTable) {
        const allTables = document.querySelectorAll('table');
        for (const table of allTables) {
          const headers = table.querySelectorAll('thead th');
          if (headers.length === 7 && headers[0].textContent.trim() === 'S') {
            calendarTable = table;
            break;
          }
        }
      }

      if (calendarTable) {
        const dayCells = calendarTable.querySelectorAll('td');
        let targetDayCell = null;
        const candidateCells = [];

        // Find ALL cells matching the day number
        for (const cell of dayCells) {
          const cellText = cell.textContent.trim();
          if (cellText === dateInfo.day) {
            const classes = cell.className;
            const computedStyle = window.getComputedStyle(cell);
            const opacity = computedStyle.opacity;

            candidateCells.push({
              cell,
              isGrayed: classes.includes('text-gray') || parseFloat(opacity) < 1
            });
          }
        }

        // Select the FIRST non-grayed cell
        for (const candidate of candidateCells) {
          if (!candidate.isGrayed) {
            targetDayCell = candidate.cell;
            break;
          }
        }

        // Fallback if all are grayed
        if (!targetDayCell && candidateCells.length > 0) {
          targetDayCell = candidateCells[0].cell;
        }

        if (targetDayCell) {
          targetDayCell.click();

          setTimeout(() => {
            // Close the sidebar first
            if (window.SidebarManager) {
              window.SidebarManager.closeSidebar(failsafeTimeout, async () => {
                // After sidebar closes, click Save button if in availability view
                await clickSaveButtonIfNeeded();

                // Then notify completion
                if (onDateChangeComplete) {
                  onDateChangeComplete();
                }
              });
            }
          }, 500);
        } else {
          if (window.UIUtils) {
            window.UIUtils.showNotification('Could not find target day in calendar');
          }
          if (window.SidebarManager) {
            window.SidebarManager.closeSidebar(failsafeTimeout, onDateChangeComplete);
          }
        }
      } else {
        if (window.UIUtils) {
          window.UIUtils.showNotification('Could not find calendar');
        }
        if (window.SidebarManager) {
          window.SidebarManager.closeSidebar(failsafeTimeout, onDateChangeComplete);
        }
      }

    } catch (error) {
      console.error('DateChanger: Error in clickDayInCalendar:', error.message);
      if (window.UIUtils) {
        window.UIUtils.showNotification('Error during day selection. Check console.');
      }
      if (window.SidebarManager) {
        window.SidebarManager.closeSidebar(failsafeTimeout, onDateChangeComplete);
      }
    }
  }

  // Public API
  return {
    attemptDateChange
  };
})();

// Export for use in other modules
if (typeof window !== 'undefined') {
  window.DateChanger = DateChanger;
}
