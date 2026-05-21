// JT Power Tools - Freeze Header Feature
// Makes job header and navigation tabs sticky when scrolling on job pages

const FreezeHeaderFeature = (() => {
  let isActiveState = false;
  let observer = null;
  let styleElement = null;
  let debounceTimer = null;
  let resizeHandler = null;
  let popupObserver = null;
  let jobContextObserver = null;
  let urlCheckInterval = null;
  let sidebarStyleObservers = [];

  // CSS for sticky header - targets the specific JobTread structure
  const STICKY_STYLES = `
    /* Freeze Header Styles */

    /* Top header bar - already sticky in JobTread by default (z-[41], top: 0) */
    /* We only mark it with .jt-top-header to measure its height for positioning other elements */
    /* No CSS overrides needed - leave it as JobTread styled it */

    /* Tab navigation bar - stick below the top header */
    .jt-freeze-header-active .jt-job-tabs-container {
      position: sticky !important;
      top: var(--jt-header-height, 50px) !important;
      z-index: 40 !important;
      background-color: white !important;
      box-shadow: 0 1px 0 0 white !important;
    }

    /* Action toolbar bar - stick below the tabs (filters, search, view controls) */
    .jt-freeze-header-active .jt-action-toolbar {
      position: sticky !important;
      top: var(--jt-tabs-bottom, 90px) !important;
      z-index: 39 !important;
      background-color: white !important;
      box-shadow: 0 1px 0 0 white !important;
    }

    /* Budget table header container - JobTread already makes this sticky,
       but we need to override its top position to account for our frozen headers */
    .jt-freeze-header-active .jt-budget-header-container {
      top: var(--jt-toolbar-bottom, 138px) !important;
    }

    /* Ensure budget header children have white background */
    .jt-freeze-header-active .jt-budget-header-container .flex.min-w-max > div {
      background-color: white !important;
    }

    /* Schedule header container - same approach as budget header */
    .jt-freeze-header-active .jt-schedule-header-container {
      position: sticky !important;
      top: var(--jt-toolbar-bottom, 138px) !important;
      z-index: 30 !important;
      background-color: white !important;
    }

    /* Ensure schedule/task list header children have white background */
    .jt-freeze-header-active .jt-schedule-header-container > div {
      background-color: white !important;
    }

    /* Files page folder navigation bar (All Files breadcrumb) */
    .jt-freeze-header-active .jt-files-folder-bar {
      position: sticky !important;
      top: var(--jt-toolbar-bottom, 138px) !important;
      z-index: 38 !important;
      background-color: white !important;
    }

    /* Files page list header (Name, Related To, Tags, etc.) */
    .jt-freeze-header-active .jt-files-list-header {
      position: sticky !important;
      top: var(--jt-files-folder-bottom, 170px) !important;
      z-index: 37 !important;
      background-color: white !important;
    }

    /* Ensure files list header children have white background */
    .jt-freeze-header-active .jt-files-list-header > div {
      background-color: white !important;
    }

    /* Files page left sidebar (Documents, Daily Logs, Tasks, Tags, Type filters) */
    .jt-freeze-header-active .jt-files-sidebar {
      top: var(--jt-toolbar-bottom, 138px) !important;
    }

    /* Files page left sidebar - direct selector for sidebars using overflow-auto (not overflow-y-auto) */
    /* This catches the filter sidebar that has inline top: 48px and overflow-auto */
    /* Also set max-height to prevent sidebar from extending past viewport when top is adjusted */
    .jt-freeze-header-active div.sticky.border-r.w-64.overflow-auto.overscroll-contain {
      top: var(--jt-toolbar-bottom, 138px) !important;
      max-height: calc(100vh - var(--jt-toolbar-bottom, 138px)) !important;
    }

    /* Right-side sidebars (Daily Log, Task Details, Job Switcher, etc.) */
    /* All sidebars get z-index 41 to appear above frozen tabs (40) and toolbar (39) */
    .jt-freeze-header-active [data-is-drag-scroll-boundary="true"] {
      z-index: 41 !important;
    }

    /* COST ITEM DETAILS sidebar on Documents page - override Tailwind's z-30 class */
    /* This sidebar has class="z-30 absolute..." which gives it z-index: 30 */
    /* We need higher specificity to override it and ensure it appears above frozen headers */
    /* Use multiple selectors for maximum specificity against Tailwind's utility classes */
    .jt-freeze-header-active .z-30.absolute[data-is-drag-scroll-boundary="true"],
    .jt-freeze-header-active .z-30[data-is-drag-scroll-boundary="true"],
    .jt-freeze-header-active [data-is-drag-scroll-boundary="true"].z-30 {
      z-index: 42 !important;
    }

    /* Global sidebars (Time Clock, Time Entry, Daily Log, Notifications, Job Switcher, Help, Files) */
    /* These are full-page overlays that sit just below the main header (~48px). */
    /* They are NOT inside [data-is-drag-scroll-boundary] so they are not affected */
    /* by the drag-boundary sidebar rules. No broad catch-all rule is needed here — */
    /* job-specific sidebars are all inside drag-scroll-boundary containers and are */
    /* handled by their own CSS + JS (adjustDragBoundarySidebars). */
    /* We only set z-index here so global sidebars appear above frozen tabs/toolbar. */
    .jt-freeze-header-active .jt-global-sidebar {
      z-index: 42 !important;
    }

    /* Sidebar scroll containers INSIDE data-is-drag-scroll-boundary are handled by JS */
    /* (adjustDragBoundarySidebars + MutationObserver) because JobTread's JS continuously */
    /* overwrites inline top/max-height on scroll. CSS !important cannot be used here as */
    /* it would override the JS-computed values that account for actual viewport position. */
    /* Only z-index is set via CSS since JT doesn't dynamically change it. */
    .jt-freeze-header-active [data-is-drag-scroll-boundary="true"] .overflow-y-auto.overscroll-contain.sticky:not(.jt-global-sidebar):not(.jt-edit-items-panel),
    .jt-freeze-header-active [data-is-drag-scroll-boundary="true"] .sticky.overflow-y-auto.overscroll-contain:not(.jt-global-sidebar):not(.jt-edit-items-panel) {
      z-index: 1 !important;
    }

    /* ADD / EDIT ITEMS table panel on Documents page */
    /* This panel appears when clicking "Edit Item Details" on a document */
    /* It contains the line items table AND the COST ITEM DETAILS sidebar when an item is clicked */
    /* CRITICAL: This panel is a sibling to the main content area and needs position: fixed behavior */
    /* to appear above frozen headers. The panel structure is: */
    /* div.sticky.overflow-y-auto.overscroll-contain[style="top: 48px"] */

    /* ADD/EDIT ITEMS panel - no z-index boosting needed */
    /* Instead, we lower the frozen header z-index when the panel is open (see above) */
    /* The panel keeps its native positioning and stacking context */

    /* When the ADD/EDIT ITEMS panel is open, lower the frozen tabs z-index */
    /* This allows the panel (which has its own stacking context) to appear above */
    /* The panel is detected by JS and body gets .jt-edit-panel-open class */
    .jt-freeze-header-active.jt-edit-panel-open .jt-job-tabs-container {
      z-index: 30 !important;
    }

    .jt-freeze-header-active.jt-edit-panel-open .jt-action-toolbar {
      z-index: 29 !important;
    }

    /* CRITICAL: The ADD/EDIT ITEMS panel needs its top position adjusted to account for frozen headers */
    /* The panel has sticky positioning with top: 48px, but frozen headers take more space */
    /* Adjust the panel's top to be below the frozen toolbar so it doesn't slide under */
    /* HIGH SPECIFICITY: Use multiple selectors to win over other rules */
    .jt-freeze-header-active .jt-edit-items-panel,
    .jt-freeze-header-active.jt-edit-panel-open .jt-edit-items-panel,
    body.jt-freeze-header-active .jt-edit-items-panel {
      top: var(--jt-toolbar-bottom, 138px) !important;
      max-height: calc(100vh - var(--jt-toolbar-bottom, 138px)) !important;
      z-index: 35 !important;
    }

    /* Fallback: Target edit panel via inline style when body has jt-edit-panel-open */
    /* This catches the panel before it gets marked with the class */
    /* Match both "top: 48" (with space) and "top:48" (without space) */
    body.jt-freeze-header-active.jt-edit-panel-open div.sticky.overflow-y-auto.overscroll-contain[style*="top: 48"]:not(.jt-global-sidebar),
    body.jt-freeze-header-active.jt-edit-panel-open div.sticky.overflow-y-auto.overscroll-contain[style*="top:48"]:not(.jt-global-sidebar) {
      top: var(--jt-toolbar-bottom, 138px) !important;
      max-height: calc(100vh - var(--jt-toolbar-bottom, 138px)) !important;
      z-index: 35 !important;
    }

    /* Sticky elements INSIDE the edit panel should keep their natural top: 0 positioning */
    /* relative to the panel's scroll container — NOT get pushed down by freeze header rules */
    /* EXCLUDE .z-10 sticky columns (e.g., the frozen Name column in the line items table) */
    /* KEEP original z-index so headers (z-30) stay above scrolling data rows */
    .jt-freeze-header-active .jt-edit-items-panel .sticky:not(.z-10) {
      top: 0px !important;
    }

    /* Nested edit-items-panels (e.g., Cost Item Details INSIDE the Add/Edit Items panel) */
    /* These are inside the outer panel's scroll container, so top should be 0 (relative to */
    /* the scroll container), NOT toolbarBottom. Higher specificity overrides line 173 rule. */
    .jt-freeze-header-active .jt-edit-items-panel .jt-edit-items-panel,
    .jt-freeze-header-active .jt-edit-items-panel [data-is-drag-scroll-boundary] .jt-edit-items-panel {
      top: 0px !important;
      max-height: none !important;
    }

    /* Nested drag-boundary elements (Cost Item Details inside edit panel) keep natural positioning */
    .jt-freeze-header-active .jt-edit-items-panel [data-is-drag-scroll-boundary="true"] {
      top: 0px !important;
      z-index: auto !important;
    }

    /* Sticky bottom action bar inside edit panel (Item, Group, Discard, Save buttons) */
    /* Give it a higher z-index so it appears above the Cost Item Details sidebar */
    .jt-freeze-header-active .jt-edit-items-panel > .sticky[style*="bottom: 0"],
    .jt-freeze-header-active .jt-edit-items-panel > .sticky[style*="bottom:0"] {
      z-index: 36 !important;
    }

    /* Footer sticky elements inside edit panel should keep bottom positioning */
    .jt-freeze-header-active .jt-edit-items-panel .sticky[style*="bottom"] {
      top: unset !important;
    }

    /* But preserve the sticky header inside COST ITEM DETAILS if it exists */
    .jt-freeze-header-active .jt-edit-items-panel .sticky .sticky {
      top: 0px !important;
    }

    /* Main content area should have lower z-index than sidebars */
    /* Target the container that holds both content and sidebars */
    .jt-freeze-header-active .relative.grow.min-w-0.flex.flex-col {
      z-index: 0;
    }

    /* Ensure sidebars within this container still have high z-index */
    .jt-freeze-header-active .relative.grow.min-w-0.flex.flex-col > [data-is-drag-scroll-boundary="true"],
    .jt-freeze-header-active .relative.grow.min-w-0.flex.flex-col > .z-30.absolute {
      z-index: 41 !important;
    }

    /* Sidebar inner sticky elements - position below frozen toolbar */
    /* Only apply to job-page sidebars, NOT global overlays like Time Clock */
    /* Global sidebars have top: ~48px (just below header), job sidebars have top: ~100px+ (below tabs) */
    /* We exclude sidebars with top: 48-50px as these are global overlays that should stay at header level */
    /* We also exclude sidebar headers with top: 0 (e.g., "COST ITEM DETAILS", "Update Task") */
    /* We also exclude popups/modals (identified by shadow-lg, max-w-lg, m-auto, rounded-sm patterns) */
    /* We also exclude thead elements and z-10 elements (internal table headers like Availability view) */
    /* These excluded elements keep their native JobTread positioning */
    .jt-freeze-header-active [data-is-drag-scroll-boundary="true"] .sticky:not(.jt-global-sidebar):not(.jt-global-sidebar *):not([style*="top: 0"]):not([style*="top: 45"]):not([style*="top: 46"]):not([style*="top: 47"]):not([style*="top: 48"]):not([style*="top: 49"]):not([style*="top: 50"]):not([style*="bottom"]):not(.jt-popup-sticky):not(thead):not(.z-10):not(.jt-fullpage-sidebar):not(.jt-fullpage-sidebar *) {
      top: var(--jt-toolbar-bottom, 138px) !important;
      /* Also fix max-height so sidebar scrollbar reaches viewport bottom */
      max-height: calc(100vh - var(--jt-toolbar-bottom, 138px)) !important;
    }

    /* Exclude popup/modal sticky elements from freeze header positioning */
    /* Popups have characteristic classes: shadow-lg, max-w-*, m-auto, rounded-sm, border-t-jtOrange */
    .jt-freeze-header-active .shadow-lg.rounded-sm .sticky,
    .jt-freeze-header-active .max-w-lg .sticky,
    .jt-freeze-header-active .max-w-screen-lg .sticky,
    .jt-freeze-header-active .max-w-screen-xl .sticky,
    .jt-freeze-header-active .max-w-screen-2xl .sticky,
    .jt-freeze-header-active [class*="m-auto"][class*="shadow-lg"] .sticky,
    .jt-freeze-header-active .border-t-jtOrange ~ * .sticky,
    .jt-freeze-header-active .jt-popup-container .sticky,
    .jt-freeze-header-active .divide-y.overflow-hidden .sticky {
      top: 0px !important;
    }

    /* Popup sticky elements with bottom positioning should also be preserved */
    .jt-freeze-header-active .shadow-lg.rounded-sm .sticky[style*="bottom"],
    .jt-freeze-header-active [class*="max-w-"] .sticky[style*="bottom"] {
      bottom: 0px !important;
      top: unset !important;
    }

    /* When a popup is in fullscreen mode, ensure its sticky elements stay at top: 0 */
    .jt-fullscreen-popup .sticky {
      top: 0px !important;
    }

    /* Reset nested sticky headers inside sidebar scroll containers to top: 0 */
    /* These are headers like "Update Task" that should stick at the top of their scrollable parent */
    /* Note: Repeated attribute selector boosts specificity to beat the :not() selectors above */
    .jt-freeze-header-active [data-is-drag-scroll-boundary="true"][data-is-drag-scroll-boundary="true"][data-is-drag-scroll-boundary="true"] .sticky .sticky {
      top: 0px !important;
    }

    /* Reset sticky headers inside overscroll-contain sidebar panels (Cost Item Details header) */
    /* The inner sticky header should stay at top: 0 relative to its scroll container */
    .jt-freeze-header-active div.sticky.overflow-y-auto.overscroll-contain > .sticky {
      top: 0px !important;
    }

    /* The inner flex container with the actual tabs */
    .jt-freeze-header-active .jt-job-tabs-container > .flex.overflow-auto.border-b {
      background-color: white !important;
    }

    /* Ensure the tabs have proper background */
    .jt-freeze-header-active .jt-job-tabs-container a {
      background-color: inherit;
    }

    /* Active tab styling preserved */
    .jt-freeze-header-active .jt-job-tabs-container a.bg-gray-50 {
      background-color: rgb(249, 250, 251) !important;
    }

    /* Job context label - shows job name in top header bar when scrolled past job header */
    .jt-freeze-header-active .jt-job-context-label {
      display: none;
      align-items: center;
      padding: 0 10px;
      font-size: 13px;
      font-weight: 600;
      color: #1f2937;
      white-space: nowrap;
      max-width: 200px;
      overflow: hidden;
      text-overflow: ellipsis;
      border-left: 1px solid #e5e7eb;
      flex-shrink: 0;
      cursor: pointer;
    }

    .jt-freeze-header-active .jt-job-context-label.jt-visible {
      display: flex;
    }

    .jt-freeze-header-active .jt-job-context-label:hover {
      color: #111827;
    }

    /* Dark mode compatibility - uses body.jt-dark-mode class added by dark-mode.js */
    /* Note: Both classes are on body, so use body.class1.class2 (no space) */
    /* Note: .jt-top-header excluded - dark mode feature handles it directly */
    body.jt-dark-mode.jt-freeze-header-active .jt-job-tabs-container,
    body.jt-dark-mode.jt-freeze-header-active .jt-job-tabs-container > .flex.overflow-auto.border-b,
    body.jt-dark-mode.jt-freeze-header-active .jt-action-toolbar,
    body.jt-dark-mode.jt-freeze-header-active .jt-budget-header-container .flex.min-w-max > div,
    body.jt-dark-mode.jt-freeze-header-active .jt-schedule-header-container,
    body.jt-dark-mode.jt-freeze-header-active .jt-schedule-header-container > div,
    body.jt-dark-mode.jt-freeze-header-active .jt-files-folder-bar,
    body.jt-dark-mode.jt-freeze-header-active .jt-files-list-header,
    body.jt-dark-mode.jt-freeze-header-active .jt-files-list-header > div,
    body.jt-dark-mode.jt-freeze-header-active .jt-files-sidebar,
    body.jt-dark-mode.jt-freeze-header-active div.sticky.border-r.w-64.overflow-auto.overscroll-contain {
      background-color: #2c2c2c !important;
      border-color: #464646 !important;
    }

    /* Dark mode box-shadow for gap coverage */
    body.jt-dark-mode.jt-freeze-header-active .jt-job-tabs-container,
    body.jt-dark-mode.jt-freeze-header-active .jt-action-toolbar {
      box-shadow: 0 1px 0 0 #2c2c2c !important;
    }

    body.jt-dark-mode.jt-freeze-header-active .jt-job-tabs-container a {
      color: #e5e7eb !important;
    }

    /* Active tab in dark mode */
    body.jt-dark-mode.jt-freeze-header-active .jt-job-tabs-container a.bg-gray-50 {
      background-color: #353535 !important;
    }

    /* Job context label in dark mode */
    body.jt-dark-mode.jt-freeze-header-active .jt-job-context-label {
      color: #e0e0e0;
      border-left-color: #464646;
    }

    body.jt-dark-mode.jt-freeze-header-active .jt-job-context-label:hover {
      color: #ffffff;
    }

    /* Custom theme compatibility - uses body.jt-custom-theme class added by rgb-theme.js */
    /* Note: Both classes are on body, so use body.class1.class2 (no space) */
    /* Note: .jt-top-header excluded - custom theme feature handles it directly */
    body.jt-custom-theme.jt-freeze-header-active .jt-job-tabs-container,
    body.jt-custom-theme.jt-freeze-header-active .jt-job-tabs-container > .flex.overflow-auto.border-b,
    body.jt-custom-theme.jt-freeze-header-active .jt-action-toolbar,
    body.jt-custom-theme.jt-freeze-header-active .jt-budget-header-container .flex.min-w-max > div,
    body.jt-custom-theme.jt-freeze-header-active .jt-schedule-header-container,
    body.jt-custom-theme.jt-freeze-header-active .jt-schedule-header-container > div,
    body.jt-custom-theme.jt-freeze-header-active .jt-files-folder-bar,
    body.jt-custom-theme.jt-freeze-header-active .jt-files-list-header,
    body.jt-custom-theme.jt-freeze-header-active .jt-files-list-header > div,
    body.jt-custom-theme.jt-freeze-header-active .jt-files-sidebar,
    body.jt-custom-theme.jt-freeze-header-active div.sticky.border-r.w-64.overflow-auto.overscroll-contain {
      background-color: var(--jt-theme-background, white) !important;
    }

    /* Custom theme box-shadow for gap coverage */
    body.jt-custom-theme.jt-freeze-header-active .jt-job-tabs-container,
    body.jt-custom-theme.jt-freeze-header-active .jt-action-toolbar {
      box-shadow: 0 1px 0 0 var(--jt-theme-background, white) !important;
    }

    /* Active tab in custom theme */
    body.jt-custom-theme.jt-freeze-header-active .jt-job-tabs-container a.bg-gray-50 {
      background-color: var(--jt-theme-background, white) !important;
      filter: brightness(0.95);
    }

    /* Job context label in custom theme */
    body.jt-custom-theme.jt-freeze-header-active .jt-job-context-label {
      color: var(--jt-theme-text-secondary, #6b7280);
      border-left-color: var(--jt-theme-border, #e5e7eb);
    }

    /* ========== POPUP EXCLUSIONS (HIGH SPECIFICITY) ========== */
    /* These rules MUST come last to override earlier freeze header rules */
    /* File picker popup and similar popups should NOT have freeze header applied */

    /* Reset ALL freeze header marker class elements inside shadow-lg popups */
    .jt-freeze-header-active .shadow-lg .jt-action-toolbar,
    .jt-freeze-header-active .shadow-lg .jt-files-folder-bar,
    .jt-freeze-header-active .shadow-lg .jt-files-list-header,
    .jt-freeze-header-active .shadow-lg .jt-files-sidebar,
    .jt-freeze-header-active .shadow-lg .jt-schedule-header-container,
    .jt-freeze-header-active .shadow-lg .jt-budget-header-container {
      position: static !important;
      top: unset !important;
      z-index: unset !important;
      box-shadow: none !important;
    }

    /* Reset sticky elements inside shadow-lg popups to their native positioning */
    .jt-freeze-header-active .shadow-lg .sticky,
    .jt-freeze-header-active .shadow-lg.rounded-sm .sticky,
    .jt-freeze-header-active .rounded-sm.shadow-lg .sticky {
      top: 0px !important;
      max-height: unset !important;
    }

    /* Ensure popup internal sticky elements with inline top: 0 stay at 0 */
    .jt-freeze-header-active .shadow-lg .sticky[style*="top: 0"],
    .jt-freeze-header-active .shadow-lg .sticky[style*="top:0"] {
      top: 0px !important;
    }
  `;

  /**
   * Inject CSS styles for sticky header
   */
  function injectStyles() {
    if (styleElement) return;

    styleElement = document.createElement('style');
    styleElement.id = 'jt-freeze-header-styles';
    styleElement.textContent = STICKY_STYLES;
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
   * Check if we're on a job page (exclude catalog pages)
   */
  function isJobPage() {
    if (isCatalogPage()) return false;
    return window.location.pathname.match(/^\/jobs\/[^/]+/);
  }

  /**
   * Check if we're on the catalog page — freeze header should NOT activate here
   */
  function isCatalogPage() {
    return window.location.pathname.startsWith('/catalog');
  }

  /**
   * Check if we're on any files page (job-level or top-level)
   */
  function isFilesPage() {
    return window.location.pathname.match(/\/files/) ||
           window.location.pathname.match(/^\/jobs\/[^/]+\/files/);
  }

  /**
   * Check if we're on the budget page
   */
  function isBudgetPage() {
    return window.location.pathname.match(/^\/jobs\/[^/]+\/budget/);
  }

  /**
   * Check if we're on the schedule page
   */
  function isSchedulePage() {
    return window.location.pathname.match(/^\/jobs\/[^/]+\/schedule/);
  }

  /**
   * Check if an element is inside a popup container
   * Popups are identified by shadow-lg class on a container element
   * This is used to prevent marking elements inside popups with freeze header classes
   */
  function isInsidePopup(element) {
    // Check if element is inside a popup container
    // Popups typically have shadow-lg class combined with other styling
    const popupContainer = element.closest('.shadow-lg');
    if (!popupContainer) return false;

    // Make sure it's not the main content area (shadow-lg is also used elsewhere)
    // Popup containers typically have: shadow-lg + (rounded-sm or overflow-hidden) + (bg-white or border)
    // Also check if it's in a fixed/absolute positioned container (modal overlay)
    const hasPopupStyling = popupContainer.classList.contains('rounded-sm') ||
                           popupContainer.classList.contains('overflow-hidden') ||
                           popupContainer.closest('.fixed') ||
                           popupContainer.closest('[class*="m-auto"]');

    return hasPopupStyling;
  }

  /**
   * Find and mark the top header bar
   * Looking for: div.shrink-0.sticky with JobTread logo and search
   */
  function findAndMarkTopHeader() {
    // Already marked?
    if (document.querySelector('.jt-top-header')) {
      return true;
    }

    // Find the top header: div.shrink-0.sticky containing the JobTread logo SVG
    const stickyDivs = document.querySelectorAll('div.shrink-0.sticky');

    for (const div of stickyDivs) {
      // Check if it contains the JobTread logo (viewBox="0 0 120 18" is the text logo)
      const hasLogo = div.querySelector('svg[viewBox="0 0 120 18"]') ||
                      div.querySelector('svg[viewBox="0 0 8 8"]');
      // Also check for the search input with company name placeholder
      const hasSearch = div.querySelector('input[placeholder*="Search"]');

      if (hasLogo && hasSearch) {
        div.classList.add('jt-top-header');
        return true;
      }
    }

    // Fallback: look for the header with z-[41] class (JobTread's main header)
    const headerWithZ41 = document.querySelector('div.shrink-0.sticky.z-\\[41\\]');
    if (headerWithZ41) {
      headerWithZ41.classList.add('jt-top-header');
      return true;
    }

    return false;
  }

  /**
   * Find and mark the job tabs container
   * Looking for: div.shrink-0 > div.flex.overflow-auto.border-b containing links to /jobs/
   */
  function findAndMarkTabs() {
    if (!isJobPage()) {
      return false;
    }

    // Already marked?
    if (document.querySelector('.jt-job-tabs-container')) {
      return true;
    }

    // Find the tab bar: look for div.shrink-0 containing div.flex.overflow-auto.border-b with job links
    const shrinkDivs = document.querySelectorAll('div.shrink-0');

    for (const div of shrinkDivs) {
      // Skip if this is already marked as something else
      if (div.classList.contains('jt-top-header')) continue;
      if (div.classList.contains('jt-action-toolbar')) continue;
      if (div.classList.contains('jt-budget-header-container')) continue;

      const tabContainer = div.querySelector('div.flex.overflow-auto.border-b');
      if (tabContainer) {
        // Verify it contains job navigation links
        const jobLinks = tabContainer.querySelectorAll('a[href^="/jobs/"]');
        if (jobLinks.length > 0) {
          // Check for typical tab names like Dashboard, Budget, Schedule
          const linkTexts = Array.from(jobLinks).map(a => a.textContent.trim().toLowerCase());
          const hasTypicalTabs = linkTexts.some(text =>
            ['dashboard', 'budget', 'schedule', 'messages', 'documents', 'to-dos'].includes(text)
          );

          if (hasTypicalTabs) {
            div.classList.add('jt-job-tabs-container');
            return true;
          }
        }
      }
    }

    return false;
  }

  /**
   * Find and mark the action toolbar (filters, search, view controls)
   * Looking for: div.shrink-0.sticky with z-30 and shadow-line-bottom, containing filters/search
   * Also handles Daily Logs and Files page action bars with different structure
   */
  function findAndMarkActionToolbar() {
    if (!isJobPage()) {
      return false;
    }

    // Already marked?
    if (document.querySelector('.jt-action-toolbar')) {
      return true;
    }

    // Find action toolbars: div.shrink-0.sticky with z-30 class
    const toolbars = document.querySelectorAll('div.shrink-0.sticky.z-30, div.shrink-0.sticky.z-\\[30\\]');

    for (const toolbar of toolbars) {
      // Skip if already marked as something else
      if (toolbar.classList.contains('jt-top-header')) continue;
      if (toolbar.classList.contains('jt-job-tabs-container')) continue;
      if (toolbar.classList.contains('jt-budget-header-container')) continue;

      // Check if it contains typical toolbar elements (search, filters, view buttons)
      const hasSearch = toolbar.querySelector('input[placeholder="Search"]');
      const hasFilters = toolbar.querySelector('svg') && toolbar.querySelectorAll('[role="button"]').length > 2;

      if (hasSearch || hasFilters) {
        toolbar.classList.add('jt-action-toolbar');
        return true;
      }
    }

    // Fallback: look for any sticky div with shadow-line-bottom and p-2 that has filter controls
    const shadowToolbars = document.querySelectorAll('div.shrink-0.sticky.shadow-line-bottom.p-2');
    for (const toolbar of shadowToolbars) {
      if (toolbar.classList.contains('jt-top-header')) continue;
      if (toolbar.classList.contains('jt-job-tabs-container')) continue;
      if (toolbar.classList.contains('jt-budget-header-container')) continue;

      // Verify it has multiple buttons (typical of action toolbar)
      const buttons = toolbar.querySelectorAll('[role="button"]');
      if (buttons.length >= 3) {
        toolbar.classList.add('jt-action-toolbar');
        return true;
      }
    }

    // Check for Daily Logs / Files page action bars
    // These use div.p-2 > div.relative > div.absolute.inset-0.flex structure
    const p2Containers = document.querySelectorAll('div.p-2');
    for (const container of p2Containers) {
      // Skip if already marked
      if (container.classList.contains('jt-action-toolbar')) continue;

      // Check for the specific structure: div.relative > div.absolute.inset-0.flex
      const relativeDiv = container.querySelector(':scope > div.relative');
      if (!relativeDiv) continue;

      const absoluteToolbar = relativeDiv.querySelector(':scope > div.absolute.inset-0.flex');
      if (!absoluteToolbar) continue;

      // Verify it's an action bar by checking for:
      // - Daily logs: links to /daily-logs with Details/Calendar tabs
      // - Files: Upload button, List/Grid toggles
      const hasDailyLogsLinks = absoluteToolbar.querySelector('a[href*="/daily-logs"]');
      const hasUploadButton = absoluteToolbar.textContent.includes('Upload');
      const hasListGridToggle = absoluteToolbar.textContent.includes('List') && absoluteToolbar.textContent.includes('Grid');
      const hasSearchInput = absoluteToolbar.querySelector('input[placeholder="Search"]');

      if (hasDailyLogsLinks || hasUploadButton || hasListGridToggle || hasSearchInput) {
        container.classList.add('jt-action-toolbar');
        return true;
      }
    }

    // Check for Documents page action bar
    // Uses div.bg-white.p-2.flex with Documents/Payments/Cost Inbox links
    const docToolbars = document.querySelectorAll('div.bg-white.p-2.flex');
    for (const toolbar of docToolbars) {
      // Skip if already marked
      if (toolbar.classList.contains('jt-action-toolbar')) continue;

      // Check for Documents tab links
      const hasDocumentsLink = toolbar.querySelector('a[href*="/documents"]');
      const hasPaymentsLink = toolbar.querySelector('a[href*="/payments"]');
      const hasCostInboxLink = toolbar.querySelector('a[href*="/cost-inbox"]');
      const hasSearchInput = toolbar.querySelector('input[placeholder="Search"]');

      if ((hasDocumentsLink || hasPaymentsLink || hasCostInboxLink) && hasSearchInput) {
        toolbar.classList.add('jt-action-toolbar');
        return true;
      }
    }

    return false;
  }

  /**
   * Find and mark the budget table header container
   * Looking for: div.sticky.z-30.break-inside-avoid that contains the budget header rows
   * JobTread already makes this sticky but with a hardcoded top value we need to override
   */
  function findAndMarkBudgetTableHeader() {
    if (!isBudgetPage()) {
      return false;
    }

    // Already marked?
    if (document.querySelector('.jt-budget-header-container')) {
      return true;
    }

    // Find the sticky container that holds the budget header
    // It's div.sticky.z-30.break-inside-avoid containing div.flex.min-w-max with border-b-4
    const stickyContainers = document.querySelectorAll('div.sticky.z-30.break-inside-avoid');

    for (const container of stickyContainers) {
      // Skip if already marked as something else
      if (container.classList.contains('jt-top-header')) continue;
      if (container.classList.contains('jt-job-tabs-container')) continue;
      if (container.classList.contains('jt-action-toolbar')) continue;

      // Check if it contains the budget header structure (flex.min-w-max with border-b-4 children)
      const flexContainer = container.querySelector('div.flex.min-w-max');
      if (flexContainer) {
        const borderChildren = flexContainer.querySelectorAll(':scope > div.border-b-4');
        if (borderChildren.length > 0) {
          // Check for typical header text like "Details", "Estimating"
          const headerText = container.textContent.toLowerCase();
          if (headerText.includes('details') || headerText.includes('estimating') || headerText.includes('name')) {
            container.classList.add('jt-budget-header-container');
            return true;
          }
        }
      }
    }

    return false;
  }

  /**
   * Find and mark the schedule header container (Gantt view only)
   * Looking for: div.sticky.z-30 with bg-gray-700 dark header cells and month names
   * JobTread already makes this sticky but with a hardcoded top value we need to override
   */
  function findAndMarkScheduleHeader() {
    if (!isSchedulePage()) {
      return false;
    }

    // Already marked?
    if (document.querySelector('.jt-schedule-header-container')) {
      return true;
    }

    // Find sticky z-30 containers that contain the schedule header
    const stickyContainers = document.querySelectorAll('div.sticky.z-30');

    for (const container of stickyContainers) {
      // Skip if already marked as something else
      if (container.classList.contains('jt-top-header')) continue;
      if (container.classList.contains('jt-job-tabs-container')) continue;
      if (container.classList.contains('jt-action-toolbar')) continue;
      if (container.classList.contains('jt-budget-header-container')) continue;

      const headerText = container.textContent;

      // Check for GANTT VIEW: bg-gray-700 header cells with "Name" column and month names
      const darkHeaderCells = container.querySelectorAll('.bg-gray-700');
      if (darkHeaderCells.length > 0) {
        // Verify it has schedule-like content (month names or year)
        const hasGanttContent = headerText.includes('Name') &&
          (headerText.includes('2025') || headerText.includes('2026') || headerText.includes('2027') ||
           /\b(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\b/.test(headerText));

        if (hasGanttContent) {
          container.classList.add('jt-schedule-header-container');
          return true;
        }
      }

      // Check for WEEK/MONTH VIEW: contains <time datetime="..."> elements
      // (calendar day/week column headers like "Sun, Mar 22", "Mon, Mar 23", etc.)
      // Gantt uses bg-gray-700 cells; week/month uses time[datetime] cells with bg-slate-50.
      const timeElements = container.querySelectorAll('time[datetime]');
      if (timeElements.length > 0) {
        container.classList.add('jt-schedule-header-container');
        return true;
      }
    }

    return false;
  }

  /**
   * Find and mark generic list headers (To-Do, Schedule list view, etc.)
   * Looking for: div.sticky.z-30 with div.flex.min-w-max containing Name + Due/Start/End columns
   * Works on any job page
   */
  function findAndMarkListHeader() {
    if (!isJobPage()) {
      return false;
    }

    // Already marked?
    if (document.querySelector('.jt-schedule-header-container')) {
      return true;
    }

    // Find sticky z-30 containers that could be list headers
    const stickyContainers = document.querySelectorAll('div.sticky.z-30');

    for (const container of stickyContainers) {
      // Skip if already marked as something else
      if (container.classList.contains('jt-top-header')) continue;
      if (container.classList.contains('jt-job-tabs-container')) continue;
      if (container.classList.contains('jt-action-toolbar')) continue;
      if (container.classList.contains('jt-budget-header-container')) continue;
      if (container.classList.contains('jt-schedule-header-container')) continue;

      const headerText = container.textContent;

      // Look for a flex container with min-w-max that has list column headers
      const flexContainer = container.querySelector('div.flex.min-w-max');
      if (flexContainer) {
        // Check for LIST VIEW: has Name + Start/End columns (schedule list)
        const hasScheduleListColumns = headerText.includes('Name') &&
          headerText.includes('Start') &&
          headerText.includes('End') &&
          (headerText.includes('Type') || headerText.includes('Assignees'));

        // Check for TASK/TODO LIST VIEW: has Name + Due columns
        const hasTaskListColumns = headerText.includes('Name') &&
          headerText.includes('Due') &&
          (headerText.includes('Type') || headerText.includes('Assignees'));

        if (hasScheduleListColumns || hasTaskListColumns) {
          container.classList.add('jt-schedule-header-container');
          return true;
        }
      }
    }

    // Check for standalone flex.min-w-max headers with sticky columns
    // These are headers where the container itself may not be sticky.z-30
    const flexHeaders = document.querySelectorAll('div.flex.min-w-max');
    for (const flexHeader of flexHeaders) {
      // Check if it has sticky z-10 children (typical of list headers)
      const stickyColumns = flexHeader.querySelectorAll(':scope > div.sticky.z-10');
      if (stickyColumns.length === 0) continue;

      // Skip if already marked or inside a marked container
      if (flexHeader.closest('.jt-schedule-header-container')) continue;
      if (flexHeader.closest('.jt-budget-header-container')) continue;

      const headerText = flexHeader.textContent;

      // Check for task/todo list headers with Name + Due or Name + Start/End
      const hasTaskColumns = headerText.includes('Name') &&
        (headerText.includes('Due') || (headerText.includes('Start') && headerText.includes('End')));

      if (hasTaskColumns) {
        // Find the parent sticky container or create marking on the flex header's parent
        let targetContainer = flexHeader.closest('div.sticky');
        if (!targetContainer) {
          // The flex header itself needs to be made sticky
          targetContainer = flexHeader;
        }

        if (!targetContainer.classList.contains('jt-schedule-header-container')) {
          targetContainer.classList.add('jt-schedule-header-container');
          return true;
        }
      }
    }

    return false;
  }

  /**
   * Find and mark the Files page folder navigation bar (All Files breadcrumb)
   * Looking for: div.sticky.z-30.flex.items-center with "All Files" or folder icon
   */
  function findAndMarkFilesFolderBar() {
    if (!isJobPage() && !isFilesPage()) {
      return false;
    }

    // Already marked?
    if (document.querySelector('.jt-files-folder-bar')) {
      return true;
    }

    // Find sticky z-30 elements that look like folder navigation
    const stickyContainers = document.querySelectorAll('div.sticky.z-30.flex.items-center');

    for (const container of stickyContainers) {
      // Skip if already marked as something else
      if (container.classList.contains('jt-top-header')) continue;
      if (container.classList.contains('jt-job-tabs-container')) continue;
      if (container.classList.contains('jt-action-toolbar')) continue;
      if (container.classList.contains('jt-schedule-header-container')) continue;

      // Skip if inside a popup (e.g., files popup from budget view)
      if (isInsidePopup(container)) continue;

      const text = container.textContent;

      // Check for folder navigation indicators
      const hasFolderText = text.includes('All Files') || text.includes('Edit') && text.includes('Files');
      const hasFolderIcon = container.querySelector('svg path[d*="M20 20a2 2 0 0 0 2-2V8"]'); // Folder icon path

      if (hasFolderText || hasFolderIcon) {
        container.classList.add('jt-files-folder-bar');
        return true;
      }
    }

    return false;
  }

  /**
   * Find and mark the Files page list header container (Name, Related To, Tags, etc.)
   * Looking for: div.sticky.z-30.shadow-line-bottom containing file list columns
   * Need to mark the outer sticky container, not the inner flex header
   */
  function findAndMarkFilesListHeader() {
    if (!isJobPage() && !isFilesPage()) {
      return false;
    }

    // Already marked?
    if (document.querySelector('.jt-files-list-header')) {
      return true;
    }

    // Find sticky containers with z-30 and shadow-line-bottom (typical of file list header containers)
    const stickyContainers = document.querySelectorAll('div.sticky.z-30.shadow-line-bottom');

    for (const container of stickyContainers) {
      // Skip if already marked as something else
      if (container.classList.contains('jt-top-header')) continue;
      if (container.classList.contains('jt-job-tabs-container')) continue;
      if (container.classList.contains('jt-action-toolbar')) continue;
      if (container.classList.contains('jt-schedule-header-container')) continue;

      // Skip if inside a popup (e.g., files popup from budget view)
      if (isInsidePopup(container)) continue;

      const headerText = container.textContent;

      // Check for file list column headers
      const hasFileColumns = headerText.includes('Name') &&
        (headerText.includes('Related To') || headerText.includes('Tags') ||
         headerText.includes('Uploaded By') || headerText.includes('Uploaded At') ||
         headerText.includes('Folder') || headerText.includes('Type'));

      if (hasFileColumns) {
        container.classList.add('jt-files-list-header');
        return true;
      }
    }

    // Fallback: Find flex headers and mark their sticky parent
    const flexHeaders = document.querySelectorAll('div.flex.min-w-max.text-xs.font-semibold');

    for (const flexHeader of flexHeaders) {
      // Skip if already inside a marked container
      if (flexHeader.closest('.jt-files-list-header')) continue;
      if (flexHeader.closest('.jt-schedule-header-container')) continue;
      if (flexHeader.closest('.jt-budget-header-container')) continue;

      // Skip if inside a popup (e.g., files popup from budget view)
      if (isInsidePopup(flexHeader)) continue;

      const headerText = flexHeader.textContent;

      // Check for file list column headers
      const hasFileColumns = headerText.includes('Name') &&
        (headerText.includes('Related To') || headerText.includes('Tags') ||
         headerText.includes('Uploaded By') || headerText.includes('Uploaded At'));

      if (hasFileColumns) {
        // Try to find the sticky parent container
        const stickyParent = flexHeader.closest('div.sticky');
        if (stickyParent && !stickyParent.classList.contains('jt-files-list-header')) {
          stickyParent.classList.add('jt-files-list-header');
          return true;
        }
        // Fallback to marking the flex header itself
        flexHeader.classList.add('jt-files-list-header');
        return true;
      }
    }

    return false;
  }

  /**
   * Find and mark the Files page left sidebar (Documents, Daily Logs, Tasks, Tags, Type filters)
   * Looking for: div.sticky.border-r.w-64 with filter sections (Tags, Type)
   */
  function findAndMarkFilesSidebar() {
    if (!isJobPage() && !isFilesPage()) {
      return false;
    }

    // Already marked?
    if (document.querySelector('.jt-files-sidebar')) {
      return true;
    }

    // Find sticky sidebars with border-r and w-64 class (files page structure)
    const sidebars = document.querySelectorAll('div.sticky.border-r.w-64');

    for (const sidebar of sidebars) {
      // Skip if already marked as something else
      if (sidebar.classList.contains('jt-top-header')) continue;
      if (sidebar.classList.contains('jt-job-tabs-container')) continue;

      // Skip if inside a popup (e.g., files popup from budget view)
      if (isInsidePopup(sidebar)) continue;

      const text = sidebar.textContent;

      // Check for files sidebar indicators (Tags, Type sections with file type options)
      const hasTagsSection = text.includes('Tags');
      const hasTypeSection = text.includes('Type') && (
        text.includes('Image') || text.includes('Video') ||
        text.includes('PDF') || text.includes('Excel') ||
        text.includes('Word') || text.includes('Other')
      );
      // Also check for Documents, Daily Logs, Tasks navigation items
      const hasNavItems = text.includes('Documents') && text.includes('Daily Logs');

      if ((hasTagsSection && hasTypeSection) || hasNavItems) {
        sidebar.classList.add('jt-files-sidebar');
        return true;
      }
    }

    return false;
  }

  /**
   * Find and mark full-page overlay sidebars (History, Selection Details, etc.)
   * These are inside absolute inset-0 containers and should keep native positioning.
   */
  function findAndMarkFullpageSidebars() {
    const overlays = document.querySelectorAll('.absolute.inset-0 .overflow-y-auto.overscroll-contain.sticky');
    for (const el of overlays) {
      // Skip sidebars inside drag-scroll-boundary containers — these are job-specific
      // sidebars (Update Task, Cost Item Details, etc.) that need freeze-header positioning,
      // not fullpage overlays like History or Selection Details
      if (el.closest('[data-is-drag-scroll-boundary="true"]')) continue;

      if (!el.classList.contains('jt-fullpage-sidebar')) {
        el.classList.add('jt-fullpage-sidebar');
        // Clear any freeze-header positioning that may have been applied
        if (el.style.getPropertyPriority('top') === 'important') {
          el.style.removeProperty('top');
          el.style.removeProperty('max-height');
        }
      }
    }
  }

  /**
   * Find and mark global sidebars (Time Clock, Time Entry, Daily Log, Notifications) that should NOT be affected by freeze header
   * These sidebars are global overlays that appear on any page and should stay at their native
   * position just below the main header (~48px), not pushed down below frozen tabs/toolbar
   */
  function findAndMarkGlobalSidebars() {
    // Find all sticky sidebars with overflow-y-auto and overscroll-contain
    const sidebars = document.querySelectorAll('div.sticky.overflow-y-auto.overscroll-contain');

    for (const sidebar of sidebars) {
      // Skip if already marked
      if (sidebar.classList.contains('jt-global-sidebar')) continue;

      // Skip if this is a job-specific sidebar (Cost Item Details, Task Details, etc.)
      // Job-specific sidebars are typically inside the main content area
      if (sidebar.closest('.jt-job-tabs-container') ||
          sidebar.closest('.jt-action-toolbar') ||
          sidebar.closest('.jt-budget-header-container')) {
        continue;
      }

      // Check if inside a data-is-drag-scroll-boundary container
      // Most sidebars inside these are job-specific (Cost Item Details, Task Details)
      // BUT global sidebars (Notifications, Daily Log, Time Clock, Time Entry) can also be inside them
      // We'll check content below and only skip non-global ones
      const isInsideDragBoundary = !!sidebar.closest('[data-is-drag-scroll-boundary="true"]');

      const text = sidebar.textContent || '';
      const textUpper = text.toUpperCase();

      // CRITICAL: Skip the ADD / EDIT ITEMS panel on Documents page
      // This panel has "Add / Edit Items" header and should NOT be marked as global sidebar
      // It needs to stay above frozen headers with z-index 43 (see CSS rules)
      if (textUpper.includes('ADD / EDIT ITEMS')) {
        // Mark it with a special class instead for proper z-index handling
        sidebar.classList.add('jt-edit-items-panel');

        // Also mark the parent container (div.absolute.top-0.bottom-0.right-0) for z-index stacking
        const parentContainer = sidebar.closest('div.absolute.top-0.bottom-0.right-0') ||
                                sidebar.closest('div.absolute.right-0');
        if (parentContainer && !parentContainer.classList.contains('jt-edit-items-panel-container')) {
          parentContainer.classList.add('jt-edit-items-panel-container');
        }
        continue;
      }

      // Detect global sidebars by their characteristic content
      // CRITICAL: Use textUpper for ALL checks because CSS "uppercase" class
      // makes text DISPLAY as uppercase but textContent returns original case.
      // e.g. "New Daily Log" displays as "NEW DAILY LOG" but textContent is "New Daily Log"
      const isTimeClock = textUpper.includes('TIME CLOCK') ||
                          textUpper.includes('CLOCKED OUT') ||
                          textUpper.includes('CLOCKED IN') ||
                          textUpper.includes('CLOCK IN') ||
                          textUpper.includes('CLOCK OUT');

      const isTimeEntry = textUpper.includes('TIME ENTRY') ||
                          textUpper.includes('ADD TIME') ||
                          textUpper.includes('TIME ENTRIES');

      const isDailyLog = textUpper.includes('NEW DAILY LOG') ||
                         textUpper.includes('DAILY LOG') ||
                         (textUpper.includes('WEATHER') && textUpper.includes('NOTES') && textUpper.includes('UNPLANNED TASKS'));

      const isNotifications = textUpper.includes('NOTIFICATIONS') &&
                              (textUpper.includes('UNREAD') || textUpper.includes('MARK ALL AS READ') || textUpper.includes('RSVPS'));

      const isJobSwitcher = textUpper.includes('SEARCH JOBS') ||
                            sidebar.querySelector('input[placeholder*="Search Jobs"], input[placeholder*="Search jobs"]');

      const isHelpSidebar = textUpper.includes('HELP DESK') ||
                            textUpper.includes('KNOWLEDGE BASE') ||
                            textUpper.includes('SUBMIT A TICKET');

      const isUpdateFolder = textUpper.includes('UPDATE FOLDER') &&
                             (textUpper.includes('RENAME') || textUpper.includes('MOVE') || textUpper.includes('ROLE VISIBILITY'));

      // Check the orange sidebar header specifically — full-content matching is too broad
      // because job-specific sidebars (Update Task, etc.) also contain "Files", "Close",
      // and "Delete" text from their sections and buttons.
      const isFilesSidebar = (() => {
        // Header text can be "FILES" (global files sidebar) or "30 FILES" (multi-select sidebar)
        const header = sidebar.querySelector('div.font-bold.text-jtOrange.uppercase');
        if (!header) return false;
        const headerText = header.textContent.trim().toUpperCase();
        return headerText === 'FILES' || headerText.endsWith(' FILES') || /^\d+\s+FILES$/.test(headerText);
      })();

      // Also check computed top position - global sidebars have top ~48-52px
      const computedStyle = window.getComputedStyle(sidebar);
      const topValue = parseInt(computedStyle.top, 10);
      const isNearHeaderLevel = !isNaN(topValue) && topValue >= 40 && topValue <= 60;

      // CRITICAL: Don't mark as global sidebar if it's inside an edit-items-panel
      // This handles the COST ITEM DETAILS sidebar that appears inside the ADD/EDIT ITEMS panel
      if (sidebar.closest('.jt-edit-items-panel') || sidebar.closest('.jt-edit-items-panel-container')) {
        continue;
      }

      // Also check if this is a COST ITEM DETAILS sidebar (content-based detection)
      // This sidebar contains item details and should be positioned below frozen headers
      if (textUpper.includes('COST ITEM DETAILS') || textUpper.includes('ITEM DETAILS')) {
        // Mark the scroll container so freeze header CSS positions it correctly
        if (!sidebar.classList.contains('jt-edit-items-panel')) {
          sidebar.classList.add('jt-edit-items-panel');
          console.log('FreezeHeader: Marked COST ITEM DETAILS panel for positioning');
        }
        // Mark the parent container for z-index stacking
        const editItemsPanel = sidebar.closest('div.absolute.right-0');
        if (editItemsPanel) {
          editItemsPanel.classList.add('jt-edit-items-panel-container');
        }
        continue;
      }

      // Content-based detection is definitive - always mark as global
      const isGlobalByContent = isTimeClock || isTimeEntry || isDailyLog || isNotifications || isJobSwitcher || isHelpSidebar || isFilesSidebar || isUpdateFolder;

      if (isGlobalByContent || (!isInsideDragBoundary && isNearHeaderLevel)) {
        sidebar.classList.add('jt-global-sidebar');
        // Clear any freeze-header positioning that adjustDragBoundarySidebars()
        // may have already applied before we could detect this as global.
        // This removes our inline overrides and lets JT's native positioning take over.
        if (sidebar.style.getPropertyPriority('top') === 'important') {
          sidebar.style.removeProperty('top');
          sidebar.style.removeProperty('max-height');
        }
      }
    }
  }

  /**
   * Find and mark the ADD/EDIT ITEMS panel on Documents page
   * When the panel is open, we add a class to body to lower frozen header z-index
   * This allows the panel to appear above the frozen headers without breaking layout
   */
  function findAndMarkEditItemsPanel() {
    // Only run on Documents pages
    if (!window.location.pathname.includes('/documents/')) {
      // Remove the class if we're not on a Documents page
      document.body.classList.remove('jt-edit-panel-open');
      return;
    }

    // Find the ADD/EDIT ITEMS panel by looking for sticky panels with "Add / Edit Items" text
    const sidebars = document.querySelectorAll('div.sticky.overflow-y-auto.overscroll-contain');
    let panelFound = false;

    for (const sidebar of sidebars) {
      // Skip if already marked as global sidebar
      if (sidebar.classList.contains('jt-global-sidebar')) continue;

      const text = sidebar.textContent || '';

      // Check if this is the ADD/EDIT ITEMS panel or COST ITEM DETAILS sidebar
      const isEditPanel = text.includes('Add / Edit Items') || text.includes('ADD / EDIT ITEMS');
      const isCostDetails = text.includes('COST ITEM DETAILS') || text.includes('Cost Item Details');

      if (isEditPanel || isCostDetails) {
        if (isEditPanel) panelFound = true;

        // Mark the panel itself for CSS targeting (positioning below frozen toolbar)
        if (!sidebar.classList.contains('jt-edit-items-panel')) {
          sidebar.classList.add('jt-edit-items-panel');
          console.log(`FreezeHeader: Marked ${isEditPanel ? 'ADD/EDIT ITEMS' : 'COST ITEM DETAILS'} panel for positioning`);
        }
        if (isEditPanel) break;
      }
    }

    // Add or remove class from body based on whether panel is open
    if (panelFound) {
      if (!document.body.classList.contains('jt-edit-panel-open')) {
        document.body.classList.add('jt-edit-panel-open');
      }
    } else {
      document.body.classList.remove('jt-edit-panel-open');
    }
  }

  /**
   * Adjust sidebar scroll containers inside data-is-drag-scroll-boundary.
   * JobTread dynamically sets top and max-height via JS on scroll, so CSS !important
   * alone cannot reliably override these values. We use JS + MutationObserver to
   * continuously correct the positioning when freeze header pushes content down.
   */
  function adjustDragBoundarySidebars() {
    // Clean up existing sidebar style observers
    cleanupSidebarStyleObservers();

    const toolbarBottomStr = getComputedStyle(document.documentElement)
      .getPropertyValue('--jt-toolbar-bottom').trim();
    const toolbarBottom = parseInt(toolbarBottomStr, 10) || 138;

    // --- 1) Top-level sidebars: push below the frozen toolbar ---
    // These are sidebars inside drag-scroll-boundary containers that are NOT
    // nested inside an edit-items-panel scroll container (i.e., top-level page sidebars).
    const dragBoundarySidebars = document.querySelectorAll(
      '[data-is-drag-scroll-boundary="true"] .overflow-y-auto.overscroll-contain.sticky'
    );

    for (const sidebar of dragBoundarySidebars) {
      if (sidebar.classList.contains('jt-global-sidebar')) continue;
      // Skip sidebars nested inside an edit-items-panel — handled separately below
      if (sidebar.closest('.jt-edit-items-panel')) continue;
      // Skip full-page overlay sidebars (History, Selection Details, etc.)
      // These are marked by findAndMarkFullpageSidebars() and should keep native positioning.
      // NOTE: We check the class, NOT the .absolute.inset-0 DOM structure, because
      // job-specific sidebars (Update Task, etc.) also live inside .absolute.inset-0
      // wrappers within their drag-scroll-boundary containers.
      if (sidebar.classList.contains('jt-fullpage-sidebar')) continue;

      // Detect a sticky bottom action bar inside this sidebar (Save /
      // Cancel / Discard buttons that JT pins to the bottom with
      // inline style="bottom: 0px"). When present, reserve space for
      // it in the max-height calc so the scrollable table area can't
      // bleed over the bar and cover the buttons. Same probe + offset
      // math used by the edit-items-panel branch below — hoisting it
      // here fixes the Selection Group editor and any other drag-
      // boundary sidebar with a sticky footer. No-ops (bottomBarHeight = 0)
      // for sidebars without a sticky bottom bar — preserves the existing
      // behavior for Cost Item Details, Task Details, Update Task, etc.
      const bottomBar = sidebar.querySelector('.sticky[style*="bottom: 0"], .sticky[style*="bottom:0"]');
      const bottomBarHeight = bottomBar ? bottomBar.offsetHeight : 0;

      applySidebarPosition(sidebar, toolbarBottom, bottomBarHeight);
      observeSidebarStyle(sidebar, bottomBarHeight);
    }

    // --- 2) Top-level edit-items-panels (Documents page Add/Edit Items) ---
    // These are the OUTER scroll containers that need top: toolbarBottom.
    // CRITICAL: Only process top-level panels, NOT nested ones (Cost Item Details
    // is inside the outer panel's scroll area and should keep top: 0).
    const editPanels = document.querySelectorAll('.jt-edit-items-panel');

    for (const panel of editPanels) {
      if (panel.classList.contains('jt-global-sidebar')) continue;

      // Skip if this panel is NESTED inside another .jt-edit-items-panel
      const parentPanel = panel.parentElement?.closest('.jt-edit-items-panel');
      if (parentPanel) continue;

      // Skip if inside a drag boundary that's inside another edit panel
      const parentDragBoundary = panel.closest('[data-is-drag-scroll-boundary="true"]');
      if (parentDragBoundary && parentDragBoundary.closest('.jt-edit-items-panel')) continue;

      // Detect sticky bottom action bar (Item, Group, Discard, Save)
      // inside this panel and account for its height in max-height
      const bottomBar = panel.querySelector('.sticky[style*="bottom: 0"], .sticky[style*="bottom:0"]');
      const bottomBarHeight = bottomBar ? bottomBar.offsetHeight : 0;

      applySidebarPosition(panel, toolbarBottom, bottomBarHeight);
      observeSidebarStyle(panel, bottomBarHeight);
    }
  }

  /**
   * Set up a MutationObserver on a sidebar to re-apply positioning when JT resets styles.
   * @param {HTMLElement} sidebar - The sidebar element to observe
   * @param {number} [bottomBarHeight=0] - Height of bottom bar to subtract from max-height
   */
  function observeSidebarStyle(sidebar, bottomBarHeight = 0) {
    const obs = new MutationObserver(() => {
      // Stop adjusting if this sidebar was later marked as global
      if (sidebar.classList.contains('jt-global-sidebar')) {
        obs.disconnect();
        return;
      }
      const currentToolbarBottom = parseInt(
        getComputedStyle(document.documentElement)
          .getPropertyValue('--jt-toolbar-bottom').trim(), 10
      ) || 138;
      applySidebarPosition(sidebar, currentToolbarBottom, bottomBarHeight);
    });

    obs.observe(sidebar, { attributes: true, attributeFilter: ['style'] });
    sidebarStyleObservers.push(obs);
  }

  /**
   * Apply correct top and max-height to a sidebar scroll container.
   * Uses getBoundingClientRect() to compute max-height based on the sidebar's
   * ACTUAL viewport position, not just the sticky top value. This handles the case
   * where the page isn't scrolled yet and the sidebar is at its natural position
   * (below header+tabs+toolbar) rather than its sticky position.
   * @param {HTMLElement} sidebar - The sidebar scroll container element
   * @param {number} toolbarBottom - Bottom edge of the frozen toolbar (--jt-toolbar-bottom)
   * @param {number} [bottomBarHeight=0] - Height of a sticky bottom bar to reserve space for
   */
  function applySidebarPosition(sidebar, toolbarBottom, bottomBarHeight = 0) {
    const currentTop = parseInt(sidebar.style.top, 10);
    const rect = sidebar.getBoundingClientRect();
    // Use the larger of actual position vs sticky top — when not scrolled,
    // the sidebar is at its natural position which is below toolbarBottom
    const effectiveTop = Math.max(rect.top, toolbarBottom);
    const maxHeight = Math.floor(window.innerHeight - effectiveTop - bottomBarHeight);
    const currentMaxHeight = parseInt(sidebar.style.maxHeight, 10);

    // Check if !important priority is present — JT's JS strips it by setting
    // style.maxHeight = 'Xpx' directly, which removes the !important flag.
    // Without !important, our value loses to the stylesheet !important rule.
    const topPriority = sidebar.style.getPropertyPriority('top');
    const maxHeightPriority = sidebar.style.getPropertyPriority('max-height');
    const needsImportant = topPriority !== 'important' || maxHeightPriority !== 'important';

    if (needsImportant || currentTop !== toolbarBottom || Math.abs(currentMaxHeight - maxHeight) > 2) {
      // CRITICAL: Use setProperty with 'important' — there's a stylesheet rule
      // that sets top/max-height with !important on sticky elements inside drag-scroll-boundary.
      // Normal inline styles lose to stylesheet !important. Inline !important beats stylesheet !important.
      sidebar.style.setProperty('top', `${toolbarBottom}px`, 'important');
      sidebar.style.setProperty('max-height', `${maxHeight}px`, 'important');
    }
  }

  /**
   * Clean up sidebar style MutationObservers
   */
  function cleanupSidebarStyleObservers() {
    sidebarStyleObservers.forEach(obs => obs.disconnect());
    sidebarStyleObservers = [];
  }

  /**
   * Calculate and set the correct top positions based on actual element heights
   */
  function updatePositions() {
    const topHeader = document.querySelector('.jt-top-header');
    const tabsContainer = document.querySelector('.jt-job-tabs-container');
    const actionToolbar = document.querySelector('.jt-action-toolbar');
    const filesFolderBar = document.querySelector('.jt-files-folder-bar');

    if (!topHeader) return;

    const headerHeight = topHeader.offsetHeight;
    let tabsBottom = headerHeight;
    let toolbarBottom = tabsBottom;
    let filesFolderBottom = toolbarBottom;

    if (tabsContainer) {
      tabsBottom = headerHeight + tabsContainer.offsetHeight;
      toolbarBottom = tabsBottom;
    }

    if (actionToolbar) {
      toolbarBottom = tabsBottom + actionToolbar.offsetHeight;
      filesFolderBottom = toolbarBottom;
    }

    if (filesFolderBar) {
      filesFolderBottom = toolbarBottom + filesFolderBar.offsetHeight;
    }

    // Set CSS custom properties for positioning
    document.documentElement.style.setProperty('--jt-header-height', `${headerHeight}px`);
    document.documentElement.style.setProperty('--jt-tabs-bottom', `${tabsBottom}px`);
    document.documentElement.style.setProperty('--jt-toolbar-bottom', `${toolbarBottom}px`);
    document.documentElement.style.setProperty('--jt-files-folder-bottom', `${filesFolderBottom}px`);
  }

  /**
   * Check if freeze header should be temporarily disabled
   * Disable when: Preview Document popup is open OR any popup is in fullscreen mode
   * This allows JobTread's native fullscreen behavior to work properly
   */
  let freezeHeaderSuspended = false;

  function checkAndSuspendFreezeHeader() {
    // Check for Preview Document popup (uses max-w-screen-lg class)
    const previewPopup = document.querySelector('.max-w-screen-lg.shadow-lg.rounded-sm');

    // Check for "Exit Fullscreen" button to detect fullscreen mode
    // The exit fullscreen SVG has path: M8 3v3a2 2 0 0 1-2 2H3...
    let isInFullscreenMode = false;

    const allButtons = document.querySelectorAll('[role="button"]');
    for (const button of allButtons) {
      const svg = button.querySelector('svg');
      if (!svg) continue;

      const pathData = svg.querySelector('path')?.getAttribute('d') || '';
      // Exit fullscreen icon path (arrows pointing inward)
      if (pathData.includes('M8 3v3a2 2 0 0 1-2 2H3')) {
        isInFullscreenMode = true;
        break;
      }
    }

    const shouldSuspend = previewPopup !== null || isInFullscreenMode;

    if (shouldSuspend && !freezeHeaderSuspended) {
      // Suspend freeze header to allow JobTread's native fullscreen to work
      document.body.classList.remove('jt-freeze-header-active');
      freezeHeaderSuspended = true;
    } else if (!shouldSuspend && freezeHeaderSuspended) {
      // Resume freeze header
      document.body.classList.add('jt-freeze-header-active');
      freezeHeaderSuspended = false;
    }
  }

  /**
   * Handle clicks on fullscreen/expand buttons in popups
   * Fullscreen buttons are identified by their expand icon SVG paths
   */
  function handleFullscreenButtonClick(event) {
    const button = event.target.closest('[role="button"]');
    if (!button) return;

    // Check if this button contains a fullscreen/expand icon
    const svg = button.querySelector('svg');
    if (!svg) return;

    const pathData = svg.querySelector('path')?.getAttribute('d') || '';

    // Enter fullscreen icon (arrows pointing outward from corners)
    const isEnterFullscreenIcon = pathData.includes('M8 3H5') || pathData.includes('M 8 3') ||
                                   pathData.includes('m14 10') || pathData.includes('M15 3h6');

    // Exit fullscreen icon (arrows pointing inward to corners)
    const isExitFullscreenIcon = pathData.includes('M8 3v3a2 2 0 0 1-2 2H3');

    if (!isEnterFullscreenIcon && !isExitFullscreenIcon) return;

    // Check freeze header suspension after popup resizes
    // Use longer delay for fullscreen transitions
    setTimeout(checkAndSuspendFreezeHeader, 200);
  }

  /**
   * Set up observer to watch for popup containers and suspend freeze header when needed
   */
  function setupPopupObserver() {
    if (popupObserver) {
      popupObserver.disconnect();
    }

    // Initial check for popups
    checkAndSuspendFreezeHeader();

    // Listen for fullscreen button clicks
    document.addEventListener('click', handleFullscreenButtonClick, true);

    // Watch for popups being added/removed from the DOM
    popupObserver = new MutationObserver((mutations) => {
      let shouldCheck = false;

      for (const mutation of mutations) {
        // Check added nodes for popups
        for (const node of mutation.addedNodes) {
          if (node.nodeType === Node.ELEMENT_NODE) {
            if (node.classList?.contains('shadow-lg') ||
                node.classList?.contains('rounded-sm') ||
                node.classList?.contains('max-w-screen-lg') ||
                node.querySelector?.('.shadow-lg.rounded-sm') ||
                node.querySelector?.('.max-w-screen-lg')) {
              shouldCheck = true;
              break;
            }
          }
        }
        // Check removed nodes (popup closed)
        for (const node of mutation.removedNodes) {
          if (node.nodeType === Node.ELEMENT_NODE) {
            if (node.classList?.contains('shadow-lg') ||
                node.classList?.contains('rounded-sm') ||
                node.classList?.contains('max-w-screen-lg')) {
              shouldCheck = true;
              break;
            }
          }
        }
        if (shouldCheck) break;
      }

      if (shouldCheck) {
        // Debounce popup detection
        setTimeout(checkAndSuspendFreezeHeader, 50);
      }
    });

    popupObserver.observe(document.body, {
      childList: true,
      subtree: true
    });
  }

  /**
   * Clean up popup observer
   */
  function cleanupPopupObserver() {
    if (popupObserver) {
      popupObserver.disconnect();
      popupObserver = null;
    }
    document.removeEventListener('click', handleFullscreenButtonClick, true);

    // Reset suspension state
    freezeHeaderSuspended = false;
  }

  // ========== JOB CONTEXT LABEL ==========
  // Shows job name/number in the frozen tab bar when scrolled past the native header

  /**
   * Ensure the job context label element exists in the header.
   * Creates it once; subsequent calls are no-ops. Returns the label element or null.
   */
  function ensureJobContextLabel() {
    const existing = document.querySelector('.jt-job-context-label');
    if (existing) return existing;

    // Get job name text
    const jobNameEl = document.querySelector('.font-bold.text-2xl div[role="button"]');
    if (!jobNameEl) return null;

    const jobText = jobNameEl.textContent.trim();
    if (!jobText) return null;

    // Find the top header's inner flex container
    const topHeader = document.querySelector('.jt-top-header');
    if (!topHeader) return null;

    const headerRow = topHeader.querySelector('.flex.items-center');
    if (!headerRow) return null;

    // Find the search bar container (div.grow.min-w-0) to insert before it
    const searchBar = headerRow.querySelector(':scope > .grow.min-w-0');
    if (!searchBar) return null;

    // Create the label (hidden by default — CSS starts with opacity:0, visibility:hidden)
    const label = document.createElement('span');
    label.className = 'jt-job-context-label';
    label.textContent = jobText;
    label.title = jobText; // Full text on hover for truncated names

    // Click to open job switcher (clicks the native job name button)
    label.addEventListener('click', () => {
      const btn = document.querySelector('.font-bold.text-2xl div[role="button"]');
      if (btn) btn.click();
    });

    headerRow.insertBefore(label, searchBar);
    return label;
  }

  /**
   * Show the job context label (add .jt-visible class)
   */
  function showJobContextLabel() {
    const label = ensureJobContextLabel();
    if (label) label.classList.add('jt-visible');
  }

  /**
   * Hide the job context label (remove .jt-visible class)
   */
  function hideJobContextLabel() {
    const label = document.querySelector('.jt-job-context-label');
    if (label) label.classList.remove('jt-visible');
  }

  /**
   * Remove the job context label from the DOM entirely (for cleanup)
   */
  function removeJobContextLabel() {
    const label = document.querySelector('.jt-job-context-label');
    if (label) label.remove();
  }

  /**
   * Set up IntersectionObserver to detect when the job header scrolls out of view.
   * Toggles visibility of the label via CSS class — no DOM creation/removal on scroll.
   */
  function setupJobContextObserver() {
    // Clean up any existing observer
    cleanupJobContextObserver();

    if (!isJobPage()) return;

    // Find the job name container (the .font-bold.text-2xl parent)
    const jobNameContainer = document.querySelector('.font-bold.text-2xl');
    if (!jobNameContainer) return;

    // Get the frozen header height for rootMargin
    const topHeader = document.querySelector('.jt-top-header');
    const headerHeight = topHeader ? topHeader.offsetHeight : 50;

    // Create IntersectionObserver with negative top margin to account for frozen header
    jobContextObserver = new IntersectionObserver((entries) => {
      for (const entry of entries) {
        if (!entry.isIntersecting) {
          // Job header scrolled out of view — show label
          showJobContextLabel();
        } else {
          // Job header visible — hide label
          hideJobContextLabel();
        }
      }
    }, {
      rootMargin: `-${headerHeight}px 0px 0px 0px`,
      threshold: 0
    });

    jobContextObserver.observe(jobNameContainer);
  }

  /**
   * Clean up job context observer and remove label
   */
  function cleanupJobContextObserver() {
    if (jobContextObserver) {
      jobContextObserver.disconnect();
      jobContextObserver = null;
    }
    removeJobContextLabel();
  }

  /**
   * Apply sticky behavior to the page
   */
  function applyFreezeHeader() {
    document.body.classList.add('jt-freeze-header-active');
    findAndMarkTopHeader();
    findAndMarkTabs();
    findAndMarkActionToolbar();
    findAndMarkBudgetTableHeader();
    findAndMarkScheduleHeader();
    findAndMarkListHeader();
    findAndMarkFilesFolderBar();
    findAndMarkFilesListHeader();
    findAndMarkFilesSidebar();
    findAndMarkGlobalSidebars();
    findAndMarkFullpageSidebars();
    findAndMarkEditItemsPanel();
    // Small delay to ensure elements are rendered before measuring
    setTimeout(() => {
      updatePositions();
      adjustDragBoundarySidebars();
      setupJobContextObserver();
    }, 100);
  }

  /**
   * Remove sticky behavior
   */
  function removeFreezeHeader() {
    document.body.classList.remove('jt-freeze-header-active');

    // Remove marker classes
    document.querySelectorAll('.jt-top-header').forEach(el => {
      el.classList.remove('jt-top-header');
    });
    document.querySelectorAll('.jt-job-tabs-container').forEach(el => {
      el.classList.remove('jt-job-tabs-container');
    });
    document.querySelectorAll('.jt-action-toolbar').forEach(el => {
      el.classList.remove('jt-action-toolbar');
    });
    document.querySelectorAll('.jt-budget-header-container').forEach(el => {
      el.classList.remove('jt-budget-header-container');
    });
    document.querySelectorAll('.jt-schedule-header-container').forEach(el => {
      el.classList.remove('jt-schedule-header-container');
    });
    document.querySelectorAll('.jt-files-folder-bar').forEach(el => {
      el.classList.remove('jt-files-folder-bar');
    });
    document.querySelectorAll('.jt-files-list-header').forEach(el => {
      el.classList.remove('jt-files-list-header');
    });
    document.querySelectorAll('.jt-files-sidebar').forEach(el => {
      el.classList.remove('jt-files-sidebar');
    });
    document.querySelectorAll('.jt-global-sidebar').forEach(el => {
      el.classList.remove('jt-global-sidebar');
    });
    document.querySelectorAll('.jt-fullpage-sidebar').forEach(el => {
      el.classList.remove('jt-fullpage-sidebar');
    });
    document.querySelectorAll('.jt-edit-items-panel').forEach(el => {
      el.classList.remove('jt-edit-items-panel');
    });
    document.querySelectorAll('.jt-edit-items-panel-container').forEach(el => {
      el.classList.remove('jt-edit-items-panel-container');
    });
    document.body.classList.remove('jt-edit-panel-open');

    // Clean up job context observer
    cleanupJobContextObserver();

    // Clean up sidebar style observers
    cleanupSidebarStyleObservers();

    // Remove CSS custom properties
    document.documentElement.style.removeProperty('--jt-header-height');
    document.documentElement.style.removeProperty('--jt-tabs-bottom');
    document.documentElement.style.removeProperty('--jt-toolbar-bottom');
    document.documentElement.style.removeProperty('--jt-files-folder-bottom');
  }

  /**
   * Initialize the feature
   */
  function init() {
    if (isActiveState) {
      return;
    }

    isActiveState = true;
    console.log('FreezeHeader: Activated');

    // Inject styles
    injectStyles();

    // Only apply sticky header on job pages
    if (isJobPage()) {
      applyFreezeHeader();
    }

    // Set up popup detection to exclude popups from freeze header effects
    setupPopupObserver();

    // Watch for DOM changes (SPA navigation)
    observer = new MutationObserver((mutations) => {
      let shouldUpdate = false;

      for (const mutation of mutations) {
        if (mutation.addedNodes.length > 0) {
          for (const node of mutation.addedNodes) {
            if (node.nodeType === Node.ELEMENT_NODE) {
              // Check if new content might be a header, tab, toolbar, or budget area
              if (node.classList && (
                node.classList.contains('shrink-0') ||
                node.classList.contains('sticky') ||
                node.classList.contains('min-w-max')
              )) {
                shouldUpdate = true;
                break;
              }
              if (node.querySelector && (
                node.querySelector('div.shrink-0') ||
                node.querySelector('a[href^="/jobs/"]') ||
                node.querySelector('div.sticky') ||
                node.querySelector('div.border-b-4')
              )) {
                shouldUpdate = true;
                break;
              }
            }
          }
        }
        if (shouldUpdate) break;
      }

      if (shouldUpdate) {
        // Skip all freeze header logic on catalog pages
        if (isCatalogPage()) return;

        // Mark global sidebars IMMEDIATELY (no debounce) so CSS :not(.jt-global-sidebar)
        // exclusions are in place before the browser applies broad positioning rules.
        // This prevents the flash where global sidebars get pushed down by freeze header CSS.
        findAndMarkGlobalSidebars();
    findAndMarkFullpageSidebars();

        // Debounce the rest of the updates (heavier operations)
        if (debounceTimer) clearTimeout(debounceTimer);
        debounceTimer = setTimeout(() => {
          findAndMarkTopHeader();
          findAndMarkTabs();
          findAndMarkActionToolbar();
          findAndMarkBudgetTableHeader();
          findAndMarkScheduleHeader();
          findAndMarkListHeader();
          findAndMarkFilesFolderBar();
          findAndMarkFilesListHeader();
          findAndMarkFilesSidebar();
          findAndMarkGlobalSidebars();
    findAndMarkFullpageSidebars();
          findAndMarkEditItemsPanel();
          updatePositions();
          adjustDragBoundarySidebars();
          setupJobContextObserver();
        }, 200);
      }
    });

    observer.observe(document.body, {
      childList: true,
      subtree: true
    });

    // Watch for URL changes (SPA navigation)
    let lastUrl = location.href;
    let wasOnJobPage = isJobPage();
    urlCheckInterval = setInterval(() => {
      if (!isActiveState) return;
      if (location.href !== lastUrl) {
        lastUrl = location.href;
        const nowOnJobPage = isJobPage();

        // Remove old markings
        document.querySelectorAll('.jt-top-header, .jt-job-tabs-container, .jt-action-toolbar, .jt-budget-header-container, .jt-schedule-header-container, .jt-files-folder-bar, .jt-files-list-header, .jt-files-sidebar, .jt-global-sidebar, .jt-fullpage-sidebar').forEach(el => {
          el.classList.remove('jt-top-header', 'jt-job-tabs-container', 'jt-action-toolbar', 'jt-budget-header-container', 'jt-schedule-header-container', 'jt-files-folder-bar', 'jt-files-list-header', 'jt-files-sidebar', 'jt-global-sidebar', 'jt-fullpage-sidebar');
        });

        // Always remove freeze header on catalog pages
        if (isCatalogPage()) {
          removeFreezeHeader();
          wasOnJobPage = false;
          return;
        }

        if (nowOnJobPage) {
          // Navigated to a job page - apply freeze header
          if (!wasOnJobPage) {
            applyFreezeHeader();
          }
          setTimeout(() => {
            findAndMarkTopHeader();
            findAndMarkTabs();
            findAndMarkActionToolbar();
            findAndMarkBudgetTableHeader();
            findAndMarkScheduleHeader();
            findAndMarkListHeader();
            findAndMarkFilesFolderBar();
            findAndMarkFilesListHeader();
            findAndMarkFilesSidebar();
            findAndMarkGlobalSidebars();
    findAndMarkFullpageSidebars();
            findAndMarkEditItemsPanel();
            updatePositions();
            adjustDragBoundarySidebars();
            setupJobContextObserver();
          }, 300);
        } else if (wasOnJobPage) {
          // Navigated away from job page - remove freeze header
          removeFreezeHeader();
        }

        wasOnJobPage = nowOnJobPage;
      }
    }, 500);

    // Update position on window resize. Track the handler so cleanup() can
    // remove it — otherwise hot-toggling the feature leaks one resize
    // listener per cycle and the orphan keeps firing updatePositions() on a
    // deactivated feature.
    resizeHandler = () => {
      if (debounceTimer) clearTimeout(debounceTimer);
      debounceTimer = setTimeout(() => {
        updatePositions();
        adjustDragBoundarySidebars();
      }, 100);
    };
    window.addEventListener('resize', resizeHandler);
  }

  /**
   * Cleanup the feature
   */
  function cleanup() {
    if (!isActiveState) {
      return;
    }

    isActiveState = false;
    console.log('FreezeHeader: Deactivated');

    // Disconnect observer
    if (observer) {
      observer.disconnect();
      observer = null;
    }

    // Clear debounce timer
    if (debounceTimer) {
      clearTimeout(debounceTimer);
      debounceTimer = null;
    }

    // Clear URL check interval
    if (urlCheckInterval) {
      clearInterval(urlCheckInterval);
      urlCheckInterval = null;
    }

    // Remove window resize listener (fix memory leak on hot-toggle)
    if (resizeHandler) {
      window.removeEventListener('resize', resizeHandler);
      resizeHandler = null;
    }

    // Clean up popup observer
    cleanupPopupObserver();

    // Clean up job context observer
    cleanupJobContextObserver();

    // Clean up sidebar style observers
    cleanupSidebarStyleObservers();

    // Remove styles and applied classes
    removeStyles();
    removeFreezeHeader();
  }

  // Public API
  return {
    init,
    cleanup,
    isActive: () => isActiveState
  };
})();

// Export for use in main content script
if (typeof window !== 'undefined') {
  window.FreezeHeaderFeature = FreezeHeaderFeature;
}
