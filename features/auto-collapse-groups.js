// Auto-Collapse Full Groups Feature Module
// Automatically collapses groups that are 100% complete on initial page load
// Works for both Gantt/Schedule views and List views

const AutoCollapseGroupsFeature = (() => {
  let isActive = false;
  let observer = null;
  let initialCollapseApplied = false;
  let collapseTimeout = null;
  let navigationTimeout = null;
  let urlCheckInterval = null;
  let popstateHandler = null;
  // Schedule "Expand/Collapse All Groups" toggle button (see section below).
  let scheduleExpandBtn = null;
  let scheduleExpandCleanup = null;

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

  // ─── Schedule "Expand/Collapse All Groups" control ──────────────────
  // JobTread's Schedule Name header carries native ONE-LEVEL expand
  // (maximize-2) and collapse (minimize-2) buttons. We inject a single toggle
  // that drives ALL nesting levels at once. In GANTT view those native buttons
  // are enabled, so we click them repeatedly — virtualization-safe and fast,
  // since they act on JobTread's data model. In LIST view JobTread renders the
  // same buttons but DISABLES them (opacity-50 + cursor-default), so we fall
  // back to clicking each group's chevron in a re-querying loop. The injected
  // button clones whichever header hosts it (Gantt dark / List light).

  const SCHED_EXPAND_ALL_SVG = '<svg xmlns="http://www.w3.org/2000/svg" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2" class="inline-block overflow-visible h-[1em] w-[1em] align-[-0.125em]" viewBox="0 0 24 24"><path d="m7 6 5 5 5-5"></path><path d="m7 13 5 5 5-5"></path></svg>';
  const SCHED_COLLAPSE_ALL_SVG = '<svg xmlns="http://www.w3.org/2000/svg" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2" class="inline-block overflow-visible h-[1em] w-[1em] align-[-0.125em]" viewBox="0 0 24 24"><path d="m17 11-5-5-5 5"></path><path d="m17 18-5-5-5 5"></path></svg>';

  // The Name-column header that holds the native one-level expand/collapse
  // buttons. Found by the button pair (not class/colour) so it works for BOTH
  // schedule views: Gantt (sticky, dark bg-gray-700) and List (light bg-white).
  function findScheduleHeader() {
    const buttons = document.querySelectorAll('div[role="button"]');
    for (const b of buttons) {
      if (b === scheduleExpandBtn) continue;
      const d = Array.from(b.querySelectorAll('svg path')).map(p => p.getAttribute('d')).join(' ');
      if (d.includes('M15 3h6v6') && d.includes('M9 21H3v-6')) {        // maximize-2 (expand one level)
        const header = b.parentElement;
        if (header && findScheduleNativeButtons(header).collapseBtn) return header;
      }
    }
    return null;
  }

  // Locate the native one-level expand (maximize-2) and collapse (minimize-2)
  // buttons inside the header by icon path — same matcher the Budget uses.
  function findScheduleNativeButtons(header) {
    let expandBtn = null;
    let collapseBtn = null;
    if (!header) return { expandBtn, collapseBtn };
    header.querySelectorAll('div[role="button"]').forEach(btn => {
      if (btn === scheduleExpandBtn) return; // skip our own injected button
      const d = Array.from(btn.querySelectorAll('svg path'))
        .map(p => p.getAttribute('d'))
        .join(' ');
      if (d.includes('M15 3h6v6') && d.includes('M9 21H3v-6')) expandBtn = btn;   // arrows to corners
      if (d.includes('m14 10') && d.includes('M3 21')) collapseBtn = btn;          // arrows to center
    });
    return { expandBtn, collapseBtn };
  }

  // Best-effort overall state from the group rows currently rendered. Under
  // virtualization only visible rows are seen, but the icon is just a hint and
  // an extra native click is a harmless no-op when already fully expanded.
  function detectScheduleGroupState() {
    const viewType = detectViewType();
    let rows = [];
    let isExpanded = null;
    if (viewType === 'gantt') { rows = getGanttGroupRows(); isExpanded = isGanttGroupExpanded; }
    else if (viewType === 'list') { rows = getListGroupRows(); isExpanded = isGroupExpanded; }
    if (!rows.length) return 'none';
    return rows.some(r => !isExpanded(r)) ? 'collapsed' : 'expanded';
  }

  function updateScheduleExpandIcon() {
    if (!scheduleExpandBtn) return;
    const state = detectScheduleGroupState();
    const next = state === 'expanded' ? 'expanded' : 'collapsed'; // default to Expand on 'none'
    if (scheduleExpandBtn.dataset.jtState === next) return; // guard: only touch innerHTML on change
    scheduleExpandBtn.dataset.jtState = next;
    if (next === 'expanded') {
      scheduleExpandBtn.innerHTML = SCHED_COLLAPSE_ALL_SVG;
      scheduleExpandBtn.title = 'Collapse All Groups';
    } else {
      scheduleExpandBtn.innerHTML = SCHED_EXPAND_ALL_SVG;
      scheduleExpandBtn.title = 'Expand All Groups';
    }
  }

  // Is a native one-level button actually usable? List view renders the same
  // maximize-2 / minimize-2 buttons but DISABLES them (opacity-50 +
  // cursor-default); only Gantt view leaves them clickable.
  function isNativeButtonEnabled(btn) {
    return !!btn && !btn.classList.contains('cursor-default') && !btn.classList.contains('opacity-50');
  }

  // Click a group row's own chevron toggle (per-group fallback for List view).
  function clickGanttToggle(row) {
    const path = row.querySelector('svg path[d="m6 9 6 6 6-6"]');
    const btn = path && (path.closest('[role="button"]') || path.closest('[tabindex="-1"]'));
    if (btn) { btn.click(); return true; }
    return false;
  }
  function clickListToggle(row) {
    const path = row.querySelector('svg path[d="m9 18 6-6-6-6"]');
    const btn = path && path.closest('[role="button"]');
    if (btn) { btn.click(); return true; }
    return false;
  }

  // Fallback: expand/collapse every group by clicking its own chevron, looping
  // (re-query after each settle) to reach nested + newly-revealed groups. Used
  // in List view where the native buttons are disabled. Rows virtualize, so
  // far-off-screen groups that never render can't be reached — this covers
  // what's visible plus whatever expanding reveals. Capped at 50 passes.
  async function perGroupExpandCollapseAll(action) {
    const wantExpand = action === 'expand';
    for (let i = 0; i < 50; i++) {
      if (!scheduleExpandBtn) return;
      const viewType = detectViewType();
      let rows = [], isExpanded = null, clickToggle = null;
      if (viewType === 'gantt') { rows = getGanttGroupRows(); isExpanded = isGanttGroupExpanded; clickToggle = clickGanttToggle; }
      else if (viewType === 'list') { rows = getListGroupRows(); isExpanded = isGroupExpanded; clickToggle = clickListToggle; }
      else return;
      let acted = 0;
      for (const row of rows) {
        if (isExpanded(row) !== wantExpand && clickToggle(row)) acted++;
      }
      if (!acted) return;                          // nothing left in the current DOM
      await new Promise(r => setTimeout(r, 120));  // settle + let revealed rows render
    }
  }

  // Drive all nesting levels at once. Prefer the native one-level button
  // (Gantt — acts on JobTread's data model, so it reaches off-screen groups);
  // fall back to per-group chevron clicks when it's disabled (List).
  async function performScheduleExpandCollapseAll(action) {
    if (!scheduleExpandBtn) return;
    const { expandBtn, collapseBtn } = findScheduleNativeButtons(findScheduleHeader());
    const native = action === 'expand' ? expandBtn : collapseBtn;
    scheduleExpandBtn.style.opacity = '0.5';
    scheduleExpandBtn.style.pointerEvents = 'none';
    if (isNativeButtonEnabled(native)) {
      for (let i = 0; i < 6; i++) {        // Budget uses 5; +1 buffer for deep nesting. Extra clicks no-op.
        if (!scheduleExpandBtn) return;    // feature cleaned up mid-flight
        native.click();
        await new Promise(r => setTimeout(r, 150));
      }
    } else {
      await perGroupExpandCollapseAll(action);
    }
    setTimeout(() => {
      if (!scheduleExpandBtn) return;
      scheduleExpandBtn.style.opacity = '';
      scheduleExpandBtn.style.pointerEvents = '';
      updateScheduleExpandIcon();
    }, 300);
  }

  function injectScheduleExpandButton() {
    if (!isActive || !isOnSchedulePage()) return;
    if (scheduleExpandBtn && document.body.contains(scheduleExpandBtn)) {
      updateScheduleExpandIcon(); // already mounted — just refresh state
      return;
    }
    if (scheduleExpandBtn) removeScheduleExpandButton(); // stale (header re-rendered)

    const header = findScheduleHeader();
    if (!header) return;
    const { expandBtn, collapseBtn } = findScheduleNativeButtons(header);
    if (!expandBtn || !collapseBtn) return; // no native controls in this view — nothing to drive

    const btn = document.createElement('div');
    btn.setAttribute('role', 'button');
    btn.setAttribute('tabindex', '0');
    // Clone a sibling native button's classes so we match the host header's
    // styling (Gantt dark hover / List light hover), minus any disabled state.
    let cls = (expandBtn.className || '')
      .replace(/\bopacity-50\b/g, '')
      .replace(/\bcursor-default\b/g, '')
      .replace(/\s+/g, ' ')
      .trim();
    if (!/\bcursor-pointer\b/.test(cls)) cls += ' cursor-pointer';
    btn.className = cls || 'relative cursor-pointer h-full p-2 flex items-center justify-center hover:bg-gray-800';
    btn.dataset.jtScheduleExpandAll = 'true';
    scheduleExpandBtn = btn;
    updateScheduleExpandIcon();

    const handleClick = () => {
      const state = detectScheduleGroupState();
      performScheduleExpandCollapseAll(state === 'expanded' ? 'collapse' : 'expand');
    };
    btn.addEventListener('click', handleClick);

    // Keep the icon in sync when the native one-level buttons are used directly.
    const handleHeaderClick = (e) => {
      const t = e.target.closest('div[role="button"]');
      if (t && t !== btn) setTimeout(updateScheduleExpandIcon, 300);
    };
    header.addEventListener('click', handleHeaderClick);

    // Place it right after the native collapse (minimize-2) button so our
    // "all levels" toggle sits with JobTread's one-level expand/collapse pair.
    collapseBtn.after(btn);

    scheduleExpandCleanup = () => {
      btn.removeEventListener('click', handleClick);
      header.removeEventListener('click', handleHeaderClick);
      btn.remove();
      scheduleExpandBtn = null;
      scheduleExpandCleanup = null;
    };
  }

  function removeScheduleExpandButton() {
    if (scheduleExpandCleanup) scheduleExpandCleanup();
  }

  // Process all groups and collapse complete ones
  function processGroups() {
    if (!isActive) return;

    const viewType = detectViewType();
    if (!viewType) {
      // Not in a supported view, try again later
      return;
    }

    if (viewType === 'gantt') {
      const groups = getGanttGroupRows();
      groups.forEach(row => {
        if (isGanttGroupComplete(row) && isGanttGroupExpanded(row)) {
          collapseGanttGroup(row);
        }
      });
    } else if (viewType === 'list') {
      const groups = getListGroupRows();
      groups.forEach(row => {
        if (isListGroupComplete(row) && isGroupExpanded(row)) {
          collapseGroup(row);
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

    // navigationTimeout is module-scoped so cleanup() can cancel it —
    // otherwise a pending timeout could fire applyInitialCollapse() after
    // the feature is disabled.

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

      if (significantChange) {
        // Schedule content (re)rendered — (re)inject the Expand/Collapse All
        // button. Idempotent, and our button doesn't match the significantChange
        // selectors above, so this can't feed the observer.
        injectScheduleExpandButton();
        if (!initialCollapseApplied) {
          // Debounce to avoid multiple triggers
          if (navigationTimeout) {
            clearTimeout(navigationTimeout);
          }
          navigationTimeout = setTimeout(() => {
            applyInitialCollapse();
          }, 300);
        }
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

    const onPathnameChange = () => {
      const currentPathname = window.location.pathname;
      if (currentPathname !== lastPathname) {
        lastPathname = currentPathname;
        initialCollapseApplied = false;

        // Only apply collapse on schedule pages
        if (isOnSchedulePage()) {
          applyInitialCollapse();
          injectScheduleExpandButton();
        } else {
          removeScheduleExpandButton();
        }
      }
    };

    // Check periodically for URL changes (handles pushState)
    urlCheckInterval = setInterval(onPathnameChange, 500);

    // Also listen for popstate (browser back/forward)
    popstateHandler = onPathnameChange;
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

    // Apply initial collapse + inject the Expand/Collapse All button if on a
    // schedule page (best-effort now; the observer re-injects once the header
    // renders and after SPA navigation).
    if (isOnSchedulePage()) {
      applyInitialCollapse();
      injectScheduleExpandButton();
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

    if (navigationTimeout) {
      clearTimeout(navigationTimeout);
      navigationTimeout = null;
    }

    if (urlCheckInterval) {
      clearInterval(urlCheckInterval);
      urlCheckInterval = null;
    }

    if (popstateHandler) {
      window.removeEventListener('popstate', popstateHandler);
      popstateHandler = null;
    }

    removeScheduleExpandButton();

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
