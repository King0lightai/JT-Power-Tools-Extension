// Event Handlers Module
// Handles all drag and drop DOM events

const DragDropEventHandlers = (() => {
  /**
   * Create event handlers with access to shared state
   * @param {Object} state - Shared state object containing draggedElement, draggedItemData, etc.
   * @param {Function} attemptDateChangeFn - The date change function to call on drop
   * @returns {Object} Event handler functions
   */
  function createHandlers(state, attemptDateChangeFn) {
    console.log('EventHandlers: Activated');

    function handleDragStart(e) {
      state.draggedElement = this;
      this.style.cursor = 'grabbing';
      this.style.opacity = '0.5';

      // Capture Shift and Alt key states at drag start
      state.shiftKeyAtDragStart = e.shiftKey;
      state.altKeyAtDragStart = e.altKey;

      // Find the source cell - could be td or th in availability view
      const sourceCell = this.closest('td') || this.closest('th');
      state.sourceDateInfo = window.DateUtils ? window.DateUtils.extractFullDateInfo(sourceCell) : null;

      // Store source row for availability view restriction
      state.sourceRow = sourceCell ? sourceCell.parentElement : null;

      state.draggedItemData = {
        element: this,
        html: this.innerHTML,
        originalParent: sourceCell
      };

      e.dataTransfer.effectAllowed = 'move';
      e.dataTransfer.setData('text/html', this.innerHTML);
    }

    function handleDragEnd(e) {
      this.style.opacity = '1';
      this.style.cursor = 'grab';

      // Reset source row state
      state.sourceRow = null;

      document.querySelectorAll('.jt-drop-zone').forEach(cell => {
        cell.classList.remove('jt-drop-zone');
        cell.style.backgroundColor = '';
        cell.style.border = '';
      });
    }

    function handleDragOver(e) {
      if (e.preventDefault) {
        e.preventDefault();
      }
      e.dataTransfer.dropEffect = 'move';
      return false;
    }

    function handleDragEnter(e) {
      if (!this.classList.contains('jt-drop-zone')) {
        this.classList.add('jt-drop-zone');
        this.style.border = '2px dashed rgb(59, 130, 246)';
        this.style.backgroundColor = 'rgba(59, 130, 246, 0.1)';
      }
    }

    function handleDragLeave(e) {
      if (this.classList.contains('jt-drop-zone')) {
        this.classList.remove('jt-drop-zone');
        this.style.border = '';
        this.style.backgroundColor = '';
      }
    }

    function handleDrop(e) {
      try {
        if (e.stopPropagation) {
          e.stopPropagation();
        }
        e.preventDefault();

        this.classList.remove('jt-drop-zone');
        this.style.border = '';
        this.style.backgroundColor = '';

        if (state.draggedElement && state.draggedItemData) {
          const targetCell = this;
          const originalCell = state.draggedItemData.originalParent;

          if (targetCell === originalCell) {
            return false;
          }

          // In availability view, prevent dropping on different rows (different users)
          const isAvailabilityView = window.ViewDetector && window.ViewDetector.isAvailabilityView();
          if (isAvailabilityView) {
            const targetRow = targetCell.parentElement;

            if (state.sourceRow && targetRow && state.sourceRow !== targetRow) {
              if (window.UIUtils) {
                window.UIUtils.showNotification('Cannot change assignee - drop on same row only');
              }
              return false;
            }
          }

          let dateInfo = window.DateUtils ? window.DateUtils.extractFullDateInfo(targetCell, state.sourceDateInfo) : null;
          const sourceDateInfo = window.DateUtils ? window.DateUtils.extractFullDateInfo(originalCell, state.sourceDateInfo) : null;

          if (dateInfo) {
            // Handle year transitions when dragging between months
            if (sourceDateInfo && sourceDateInfo.month && dateInfo.month && window.DateUtils) {
              const monthMap = window.DateUtils.MONTH_MAP;
              const sourceMonth = monthMap[sourceDateInfo.month];
              const targetMonth = monthMap[dateInfo.month];

              // If source and target are the same month, use source year as baseline
              if (sourceMonth === targetMonth) {
                dateInfo.year = sourceDateInfo.year;
              }
              // If dragging from December to January, increment year
              else if (sourceMonth === 11 && targetMonth === 0) {
                dateInfo.year = sourceDateInfo.year + 1;
                if (window.UIUtils) {
                  window.UIUtils.showNotification(`Year transition: Moving to Jan ${dateInfo.year}`);
                }
              }
              // If dragging from January to December, decrement year
              else if (sourceMonth === 0 && targetMonth === 11) {
                dateInfo.year = sourceDateInfo.year - 1;
                if (window.UIUtils) {
                  window.UIUtils.showNotification(`Year transition: Moving to Dec ${dateInfo.year}`);
                }
              }
              // For other month changes, use source year as baseline
              else {
                dateInfo.year = sourceDateInfo.year;
              }
            }

            // Check Shift and Alt keys at drop time (OR the states captured at drag start)
            const isShiftPressed = e.shiftKey || state.shiftKeyAtDragStart;
            const isAltPressed = e.altKey || state.altKeyAtDragStart;

            // Check if dropping on weekend and Shift is NOT pressed
            if (!isShiftPressed && window.WeekendUtils && window.WeekendUtils.isWeekendCell(targetCell, dateInfo)) {
              dateInfo = window.WeekendUtils.adjustDateToSkipWeekend(dateInfo);
              if (window.UIUtils) {
                window.UIUtils.showNotification('Weekend detected - moved to Monday');
              }
            }

            if (attemptDateChangeFn) {
              // Pass Alt key state to change End date instead of Start date
              attemptDateChangeFn(state.draggedElement, dateInfo.day, targetCell, dateInfo, state.sourceDateInfo, null, isAltPressed);
            }
          } else {
            console.error('EventHandlers: Could not determine target date');
            if (window.UIUtils) {
              window.UIUtils.showNotification('Could not determine target date. Please try manually.');
            }
          }
        } else {
          console.error('EventHandlers: Drop handler called but draggedElement or draggedItemData is missing');
        }

        // Reset key states
        state.shiftKeyAtDragStart = false;
        state.altKeyAtDragStart = false;

        return false;

      } catch (error) {
        console.error('EventHandlers: Exception in handleDrop:', error.message);
        if (window.UIUtils) {
          window.UIUtils.showNotification('Error during drag & drop. Check console for details.');
        }
        return false;
      }
    }

    return {
      onDragStart: handleDragStart,
      onDragEnd: handleDragEnd,
      onDragOver: handleDragOver,
      onDragEnter: handleDragEnter,
      onDragLeave: handleDragLeave,
      onDrop: handleDrop
    };
  }

  function cleanup() {
    console.log('EventHandlers: Deactivated');
  }

  // Public API
  return {
    createHandlers,
    cleanup
  };
})();

// Export for use in other modules
if (typeof window !== 'undefined') {
  window.DragDropEventHandlers = DragDropEventHandlers;
}
