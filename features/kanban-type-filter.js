// JT Power Tools - Kanban Type Filter Feature
// Hides empty columns (0 items) in Kanban view when grouped by type
// Dependencies: utils/debounce.js (TimingUtils)

const KanbanTypeFilterFeature = (() => {
  let isActiveState = false;
  let observer = null;
  let styleElement = null;
  let debouncedApplyFiltering = null;
  let urlCheckInterval = null;

  // CSS for hiding empty Kanban columns
  const KANBAN_FILTER_STYLES = `
    /* Hide empty Kanban columns - collapsed vertical style with 0 count */
    .jt-kanban-filter-active .jt-kanban-column-empty {
      display: none !important;
    }
  `;

  /**
   * Inject CSS styles
   */
  function injectStyles() {
    if (styleElement) return;

    styleElement = document.createElement('style');
    styleElement.id = 'jt-kanban-type-filter-styles';
    styleElement.textContent = KANBAN_FILTER_STYLES;
    document.head.appendChild(styleElement);
  }

  /**
   * Remove injected styles
   */
  function removeStyles() {
    if (styleElement) {
      styleElement.remove();
      styleElement = null;
    }
  }

  /**
   * Check if we're on a schedule page (where Kanban view exists)
   */
  function isSchedulePage() {
    return window.location.pathname.match(/\/schedule/);
  }

  /**
   * Check if we're on a tasks/to-dos page (where Kanban view exists)
   */
  function isTasksPage() {
    return window.location.pathname.match(/\/to-dos/) ||
           window.location.pathname.match(/\/tasks/);
  }

  /**
   * Check if we're on a page that could have Kanban view
   */
  function isKanbanCapablePage() {
    return isSchedulePage() || isTasksPage();
  }

  /**
   * Find all Kanban column containers
   * Kanban columns are identified by their structure:
   * - Collapsed (empty): div.shrink-0.flex.px-1 > div with vertical text (writing-mode: vertical-rl)
   * - Expanded (with items): div.shrink-0.px-1.flex or similar with horizontal layout
   */
  function findKanbanColumns() {
    const columns = [];

    // Find the Kanban container - it's a flex container with multiple column children
    // Look for containers with multiple shrink-0 children that have either vertical text or card content
    const potentialContainers = document.querySelectorAll('div.flex');

    for (const container of potentialContainers) {
      // Check if this is a Kanban row (horizontal scroll container with columns)
      const children = container.children;
      let kanbanColumnCount = 0;

      for (const child of children) {
        if (isKanbanColumn(child)) {
          kanbanColumnCount++;
        }
      }

      // If we found multiple Kanban columns, this is likely a Kanban container
      if (kanbanColumnCount >= 2) {
        for (const child of children) {
          if (isKanbanColumn(child)) {
            columns.push(child);
          }
        }
      }
    }

    return columns;
  }

  /**
   * Check if an element is a Kanban column
   */
  function isKanbanColumn(element) {
    if (!element || element.nodeType !== Node.ELEMENT_NODE) return false;

    // Check for shrink-0 class (common to all Kanban columns)
    if (!element.classList.contains('shrink-0')) return false;
    if (!element.classList.contains('flex') && !element.classList.contains('px-1')) return false;

    // Check for column structure - either collapsed (vertical text) or expanded (with cards)
    const innerDiv = element.querySelector(':scope > div');
    if (!innerDiv) return false;

    // Collapsed columns have flex-col and vertical text
    const hasVerticalText = innerDiv.querySelector('[style*="writing-mode: vertical"]') ||
                           innerDiv.querySelector('[style*="writing-mode:vertical"]');

    // Expanded columns have a header with count and scrollable card area
    const hasColumnHeader = innerDiv.querySelector('.shadow-line-bottom') ||
                           innerDiv.querySelector('.border-b-4');

    return hasVerticalText || hasColumnHeader;
  }

  /**
   * Get the item count from a Kanban column
   */
  function getColumnCount(column) {
    // Look for the count display - it's in a div with text content that's a number
    // For collapsed columns: the count is in a div with border-b-4
    // For expanded columns: the count is in the header area

    const innerDiv = column.querySelector(':scope > div');
    if (!innerDiv) return -1;

    // Try to find the count element
    // Collapsed: div.shrink-0.bg-white.p-2.shadow-line-bottom.border-b-4 with number text
    // Expanded: header div with a div containing just the number

    const countCandidates = innerDiv.querySelectorAll('div.border-b-4, div.shadow-line-bottom');

    for (const candidate of countCandidates) {
      // For collapsed columns, the count is directly in the border-b-4 div
      if (candidate.classList.contains('border-b-4') && candidate.classList.contains('p-2')) {
        const text = candidate.textContent.trim();
        if (/^\d+$/.test(text)) {
          return parseInt(text, 10);
        }
      }

      // For expanded columns, look for a child div with just the count
      const headerChildren = candidate.querySelectorAll(':scope > div');
      for (const headerChild of headerChildren) {
        const text = headerChild.textContent.trim();
        if (/^\d+$/.test(text)) {
          return parseInt(text, 10);
        }
      }
    }

    // Also check for expanded header structure: flex with title and count
    const headerDiv = innerDiv.querySelector('.shrink-0.flex.p-2');
    if (headerDiv) {
      const countDiv = headerDiv.querySelector(':scope > div:last-child');
      if (countDiv) {
        const text = countDiv.textContent.trim();
        if (/^\d+$/.test(text)) {
          return parseInt(text, 10);
        }
      }
    }

    return -1; // Could not determine count
  }

  /**
   * Apply filtering to hide empty columns
   */
  function applyFiltering() {
    if (!isActiveState) return;

    const columns = findKanbanColumns();

    if (columns.length === 0) {
      return;
    }

    let hiddenCount = 0;
    let shownCount = 0;

    for (const column of columns) {
      const count = getColumnCount(column);

      if (count === 0) {
        // Mark column as empty to be hidden
        column.classList.add('jt-kanban-column-empty');
        hiddenCount++;
      } else {
        // Ensure column is visible
        column.classList.remove('jt-kanban-column-empty');
        shownCount++;
      }
    }
  }

  /**
   * Remove all filtering markers
   */
  function removeFiltering() {
    document.querySelectorAll('.jt-kanban-column-empty').forEach(el => {
      el.classList.remove('jt-kanban-column-empty');
    });
  }

  /**
   * Initialize the feature
   */
  function init() {
    if (isActiveState) {
      return;
    }

    isActiveState = true;
    console.log('KanbanTypeFilter: Activated');

    // Create debounced filtering function using TimingUtils
    debouncedApplyFiltering = window.TimingUtils.debounce(applyFiltering, 150);

    // Inject styles
    injectStyles();

    // Add active class to body
    document.body.classList.add('jt-kanban-filter-active');

    // Initial application
    applyFiltering();

    // Watch for DOM changes (content loading, filtering, etc.)
    observer = new MutationObserver((mutations) => {
      let shouldUpdate = false;

      for (const mutation of mutations) {
        // Check for added/removed nodes that might be Kanban-related
        if (mutation.addedNodes.length > 0 || mutation.removedNodes.length > 0) {
          for (const node of [...mutation.addedNodes, ...mutation.removedNodes]) {
            if (node.nodeType === Node.ELEMENT_NODE) {
              // Check if the change is in a potential Kanban area
              if (node.classList && (
                node.classList.contains('shrink-0') ||
                node.classList.contains('flex') ||
                node.classList.contains('px-1') ||
                node.classList.contains('border-b-4')
              )) {
                shouldUpdate = true;
                break;
              }
              // Also check for changes inside column content
              if (node.closest && (
                node.closest('.shrink-0.flex') ||
                node.closest('.shrink-0.px-1')
              )) {
                shouldUpdate = true;
                break;
              }
            }
          }
        }

        // Check for class changes that might indicate filter changes
        if (mutation.type === 'attributes' && mutation.attributeName === 'class') {
          shouldUpdate = true;
        }

        // Check for text content changes (count updates)
        if (mutation.type === 'characterData' ||
            (mutation.type === 'childList' && mutation.target.closest && mutation.target.closest('.border-b-4'))) {
          shouldUpdate = true;
        }

        if (shouldUpdate) break;
      }

      if (shouldUpdate) {
        debouncedApplyFiltering();
      }
    });

    observer.observe(document.body, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ['class', 'style'],
      characterData: true
    });

    // Watch for URL changes (SPA navigation)
    let lastUrl = location.href;
    urlCheckInterval = setInterval(() => {
      if (!isActiveState) {
        clearInterval(urlCheckInterval);
        return;
      }
      if (location.href !== lastUrl) {
        lastUrl = location.href;
        // Small delay to let page content load
        setTimeout(() => {
          removeFiltering();
          applyFiltering();
        }, 500);
      }
    }, 500);
  }

  /**
   * Cleanup the feature
   */
  function cleanup() {
    if (!isActiveState) {
      return;
    }

    isActiveState = false;

    // Clear URL check interval
    if (urlCheckInterval) {
      clearInterval(urlCheckInterval);
      urlCheckInterval = null;
    }

    // Disconnect observer
    if (observer) {
      observer.disconnect();
      observer = null;
    }

    // Cancel debounced function
    if (debouncedApplyFiltering) {
      debouncedApplyFiltering.cancel();
      debouncedApplyFiltering = null;
    }

    // Remove styles and applied classes
    removeStyles();
    removeFiltering();
    document.body.classList.remove('jt-kanban-filter-active');

    console.log('KanbanTypeFilter: Deactivated');
  }

  // Public API
  return {
    init,
    cleanup,
    isActive: () => isActiveState,
    // Expose for manual refresh if needed
    refresh: applyFiltering
  };
})();

// Export for use in main content script
if (typeof window !== 'undefined') {
  window.KanbanTypeFilterFeature = KanbanTypeFilterFeature;
}
