// Auto-Collapse Full Groups Feature Module
// Automatically collapses groups that are 100% complete on initial page load
// Works for both Gantt/Schedule views and List views

const AutoCollapseGroupsFeature = (() => {
  let isActive = false;
  let observer = null;
  let initialCollapseApplied = false;
  let collapseTimeout = null;
  let urlCheckInterval = null;
  let popstateHandler = null;

  // Detect if we're in Gantt/Schedule view or List view
  function detectViewType() {
    // Gantt/Schedule view - rows with font-bold groups and percentage inputs
    // Structure: div.relative.min-w-max.select-none > div.flex.min-w-max containing:
    // - font-bold group name cell with chevron toggle
    // - separate cell with input[value*="%"]
    const ganttRow = document.querySelector('div.relative.min-w-max.select-none div.flex.min-w-max');
    if (ganttRow) {
      // Verify it has the schedule structure (% input and font-bold groups)
      const hasPercentInput = document.querySelector('div.relative.min-w-max.select-none input[value*="%"]');
      const hasFontBoldGroup = document.querySelector('div.relative.min-w-max.select-none .font-bold');
      if (hasPercentInput && hasFontBoldGroup) {
        return 'gantt';
      }
    }

    // List view has group/row elements with different structure
    const listRow = document.querySelector('div.group\\/row, [class*="group/row"]');
    if (listRow) {
      return 'list';
    }

    return null;
  }

  // Check if we're on a schedule/tasks page
  function isOnSchedulePage() {
    const path = window.location.pathname.toLowerCase();
    return path.includes('/schedule') ||
           path.includes('/tasks') ||
           path.includes('/to-dos') ||
           path.includes('/todos');
  }

  // Get all group rows in Gantt/Schedule view
  function getGanttGroupRows() {
    const rows = [];

    // Find all row containers
    const rowContainers = document.querySelectorAll('div.relative.min-w-max.select-none');

    rowContainers.forEach(container => {
      const row = container.querySelector('div.flex.min-w-max');
      if (!row || rows.includes(row)) return;

      // Check if this is a GROUP row (has font-bold and chevron toggle)
      const hasFontBold = row.querySelector('.font-bold');
      const hasToggle = row.querySelector('svg path[d="m6 9 6 6 6-6"]');

      if (hasFontBold && hasToggle) {
        rows.push(row);
      }
    });

    return rows;
  }

  // Get all group rows in List view
  function getListGroupRows() {
    const rows = [];

    // List view groups have font-bold styling and specific structure
    const allRows = document.querySelectorAll('div.group\\/row, [class*="group/row"]');

    allRows.forEach(row => {
      // Check if this is a group row (has font-bold cells)
      const fontBoldCell = row.querySelector('div.font-bold');
      if (fontBoldCell) {
        rows.push(row);
      }
    });

    return rows;
  }

  // Check if a Gantt group is 100% complete
  function isGanttGroupComplete(row) {
    // Look for the progress input with "100%" value in this row
    const progressInput = row.querySelector('input[value="100%"]');
    return !!progressInput;
  }

  // Check if a List group is 100% complete
  function isListGroupComplete(row) {
    // Method 1: Check for checkmark SVG (child groups with complete status)
    // The checkmark has paths: "M21.801 10A10 10 0 1 1 17 3.335" and "m9 11 3 3L22 4"
    const checkmarkPath = row.querySelector('path[d="m9 11 3 3L22 4"]');
    if (checkmarkPath) {
      // Make sure it's in the status column (blue circle with check)
      const parentSvg = checkmarkPath.closest('svg');
      if (parentSvg && parentSvg.classList.contains('text-blue-500')) {
        return true;
      }
    }

    // Method 2: Check for "100%" text (parent groups show percentage)
    // Look in the name cell area for percentage text
    const nameCells = row.querySelectorAll('div.font-bold');
    for (const cell of nameCells) {
      const percentText = cell.querySelector('div.text-gray-400');
      if (percentText && percentText.textContent.trim() === '100%') {
        return true;
      }
    }

    return false;
  }

  // Check if a Gantt group is currently expanded
  function isGanttGroupExpanded(row) {
    // Gantt view uses chevron path d="m6 9 6 6 6-6"
    // When expanded: chevron points down (no rotation)
    // When collapsed: chevron rotated (-rotate-90)
    const chevronPath = row.querySelector('svg path[d="m6 9 6 6 6-6"]');
    if (chevronPath) {
      const svg = chevronPath.closest('svg');
      // If SVG has -rotate-90, the group is collapsed
      if (svg && svg.classList.contains('-rotate-90')) {
        return false;
      }
      return true; // Expanded (no rotation)
    }
    return true; // Assume expanded if we can't determine
  }

  // Collapse a Gantt group by clicking its toggle button
  function collapseGanttGroup(row) {
    // Find the chevron toggle button with path d="m6 9 6 6 6-6"
    const chevronPath = row.querySelector('svg path[d="m6 9 6 6 6-6"]');
    if (!chevronPath) {
      return false;
    }

    // Find the toggle button (role="button" parent or tabindex="-1" parent)
    const toggleButton = chevronPath.closest('[role="button"]') ||
                         chevronPath.closest('[tabindex="-1"]');
    if (!toggleButton) {
      return false;
    }

    // Check if the group is expanded (no -rotate-90 class)
    const svg = chevronPath.closest('svg');
    if (svg && svg.classList.contains('-rotate-90')) {
      return false; // Already collapsed
    }

    // Click to collapse
    toggleButton.click();
    return true;
  }

  // Check if a List group is currently expanded
  function isGroupExpanded(row) {
    // Look for the expand/collapse chevron button
    // Expanded: has rotate-90 class
    // Collapsed: no rotation
    const chevron = row.querySelector('svg path[d="m9 18 6-6-6-6"]');
    if (chevron) {
      const svg = chevron.closest('svg');
      return svg && svg.classList.contains('rotate-90');
    }
    return true; // Assume expanded if we can't determine
  }

  // Collapse a List group by clicking its toggle button
  function collapseGroup(row) {
    // Find the expand/collapse button for list view
    const toggleButton = row.querySelector('div[role="button"] svg path[d="m9 18 6-6-6-6"]')?.closest('[role="button"]') ||
                         row.querySelector('button svg path[d="m9 18 6-6-6-6"]')?.closest('button') ||
                         row.querySelector('[tabindex="-1"][role="button"]:has(svg path[d="m9 18 6-6-6-6"])') ||
                         row.querySelector('div[tabindex="-1"][role="button"] svg.transition')?.closest('[role="button"]');

    if (!toggleButton) {
      return false;
    }

    // Only collapse if currently expanded
    const svg = toggleButton.querySelector('svg');
    if (svg && svg.classList.contains('rotate-90')) {
      toggleButton.click();
      return true;
    }

    return false;
  }

  // Process all groups and collapse complete ones
  function processGroups() {
    if (!isActive) return;

    const viewType = detectViewType();
    if (!viewType) {
      // Not in a supported view, try again later
      return;
    }

    let collapsedCount = 0;

    if (viewType === 'gantt') {
      const groups = getGanttGroupRows();
      groups.forEach(row => {
        if (isGanttGroupComplete(row) && isGanttGroupExpanded(row)) {
          if (collapseGanttGroup(row)) {
            collapsedCount++;
          }
        }
      });
    } else if (viewType === 'list') {
      const groups = getListGroupRows();
      groups.forEach(row => {
        if (isListGroupComplete(row) && isGroupExpanded(row)) {
          if (collapseGroup(row)) {
            collapsedCount++;
          }
        }
      });
    }

  }

  // Wait for groups to be rendered then apply collapse
  function applyInitialCollapse() {
    if (!isActive || initialCollapseApplied) return;

    // Clear any pending timeout
    if (collapseTimeout) {
      clearTimeout(collapseTimeout);
    }

    // Wait for DOM to settle after page load
    collapseTimeout = setTimeout(() => {
      const viewType = detectViewType();
      if (viewType) {
        initialCollapseApplied = true;
        processGroups();
      } else {
        // View not ready yet, try again
        collapseTimeout = setTimeout(() => applyInitialCollapse(), 500);
      }
    }, 800); // Give time for groups to render
  }

  // Start observing for page navigation (SPA)
  function startObserver() {
    if (observer) return;

    let navigationTimeout = null;

    observer = new MutationObserver((mutations) => {
      if (!isActive) return;

      // Check for significant DOM changes that might indicate navigation
      let significantChange = false;

      for (const mutation of mutations) {
        if (mutation.type === 'childList' && mutation.addedNodes.length > 0) {
          for (const node of mutation.addedNodes) {
            if (node.nodeType === 1) {
              // Check if schedule/group content was added
              if (node.classList?.contains('group/row') ||
                  node.querySelector?.('.group\\/row') ||
                  node.querySelector?.('[class*="group/row"]') ||
                  node.querySelector?.('input[value*="%"]') ||
                  // Gantt view: relative min-w-max containers with font-bold groups
                  (node.classList?.contains('relative') && node.classList?.contains('min-w-max')) ||
                  node.querySelector?.('div.relative.min-w-max.select-none')) {
                significantChange = true;
                break;
              }
            }
          }
        }
        if (significantChange) break;
      }

      if (significantChange && !initialCollapseApplied) {
        // Debounce to avoid multiple triggers
        if (navigationTimeout) {
          clearTimeout(navigationTimeout);
        }
        navigationTimeout = setTimeout(() => {
          applyInitialCollapse();
        }, 300);
      }
    });

    observer.observe(document.body, {
      childList: true,
      subtree: true
    });
  }

  // Listen for URL changes (for SPA navigation)
  function setupNavigationListener() {
    // Only track pathname changes, not query params or hash
    // This prevents re-collapse when clicking on tasks (which adds task ID to URL)
    let lastPathname = window.location.pathname;

    const checkUrl = () => {
      const currentPathname = window.location.pathname;
      if (currentPathname !== lastPathname) {
        lastPathname = currentPathname;
        initialCollapseApplied = false;

        // Only apply collapse on schedule pages
        if (isOnSchedulePage()) {
          applyInitialCollapse();
        }
      }
    };

    // Check periodically for URL changes (handles pushState)
    urlCheckInterval = setInterval(checkUrl, 500);

    // Also listen for popstate (browser back/forward)
    popstateHandler = () => {
      const currentPathname = window.location.pathname;
      if (currentPathname !== lastPathname) {
        lastPathname = currentPathname;
        initialCollapseApplied = false;
        if (isOnSchedulePage()) {
          applyInitialCollapse();
        }
      }
    };
    window.addEventListener('popstate', popstateHandler);
  }

  // Initialize the feature
  function init() {
    if (isActive) return;

    isActive = true;
    initialCollapseApplied = false;

    console.log('AutoCollapseGroups: Activated');

    // Set up navigation listener for SPA
    setupNavigationListener();

    // Start DOM observer
    startObserver();

    // Apply initial collapse if on schedule page
    if (isOnSchedulePage()) {
      applyInitialCollapse();
    }
  }

  // Cleanup the feature
  function cleanup() {
    if (!isActive) return;

    isActive = false;
    initialCollapseApplied = false;

    if (collapseTimeout) {
      clearTimeout(collapseTimeout);
      collapseTimeout = null;
    }

    if (urlCheckInterval) {
      clearInterval(urlCheckInterval);
      urlCheckInterval = null;
    }

    if (popstateHandler) {
      window.removeEventListener('popstate', popstateHandler);
      popstateHandler = null;
    }

    if (observer) {
      observer.disconnect();
      observer = null;
    }

    console.log('AutoCollapseGroups: Deactivated');
  }

  return {
    init,
    cleanup,
    isActive: () => isActive,
    // Expose for manual triggering if needed
    processGroups
  };
})();

// Make available globally
window.AutoCollapseGroupsFeature = AutoCollapseGroupsFeature;
