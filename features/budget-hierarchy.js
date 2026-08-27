// JobTread Budget Group Hierarchy Shading Feature Module
// Applies progressive shading to nested budget groups (up to 5 levels)
// Level 1 (top) = Lightest, Level 5 (deepest) = Darkest
//
// Dependencies: utils/color-utils.js (ColorUtils)

const BudgetHierarchyFeature = (() => {
  let isActive = false;
  let styleElement = null;
  let observer = null;
  let clickController = null; // AbortController for click listener
  // Guards the observer against reacting to its own mutations. applyGroupShading
  // mutates classes on budget rows — those mutations would otherwise trigger
  // the body-subtree observer and queue another apply, creating a reflow loop.
  let isApplyingShading = false;

  // Use shared ColorUtils module
  const {
    hexToHsl,
    adjustLightness,
    generateShades
  } = window.ColorUtils || {};

  // The page is dark if OUR theme is painting it or JobTread's own dark mode is
  // on. NativeDarkBridge knows both; the stylesheet check is the fallback for
  // when it hasn't loaded.
  function isDarkModeActive() {
    const bridge = window.NativeDarkBridge;
    if (bridge && typeof bridge.isPageDark === 'function') return bridge.isPageDark();
    return document.getElementById('jt-dark-mode-styles') !== null;
  }

  // Check if custom theme styles are injected in DOM
  function isCustomThemeActive() {
    return document.getElementById('jt-custom-theme-styles') !== null;
  }

  // Is JobTread's OWN dark mode painting the page, with our Dark level NOT
  // repainting it in the JT Power Tools greys? Same split the stylesheets make
  // with `body.jt-native-dark:not(.jt-dark-standard)`; NativeDarkBridge owns
  // jt-native-dark and DarkModeFeature owns jt-dark-standard.
  function isNativeDarkGround() {
    const body = document.body;
    return !!body && body.classList.contains('jt-native-dark') &&
      !body.classList.contains('jt-dark-standard');
  }

  // JobTread's dark palette is a cooler, bluer grey than ours, and this feature
  // paints its shades with !important — so seeding from the JT Power Tools
  // #424242 on their budget page lays a warm block a long way lighter than
  // every row around it. Their --color-gray-100 is the surface those rows sit
  // on. Measured on the live app 2026-08-25: their scale is INVERTED under
  // jt-dark, so a LOW number is a surface and a high one is text.
  const NATIVE_DARK_SEED = '#1e2128';

  // Double Dark mixes every JobTread surface 66% toward black via --jtd2-keep.
  // That is a CSS-only mechanism and these shades are computed in JS, so
  // without this the rows would sit above a page that had moved without them.
  const DOUBLE_DARK_DROP = 0.34;

  function nativeDarkBaseColor() {
    let seed = NATIVE_DARK_SEED;
    try {
      const declared = getComputedStyle(document.documentElement)
        .getPropertyValue('--color-gray-100').trim();
      // Only a plain hex: Tailwind may publish the token as oklch() or rgb(),
      // and the measured value is a better answer than a failed parse.
      if (/^#[0-9a-fA-F]{6}$/.test(declared)) seed = declared;
    } catch (_error) {
      // Computed styles can be unavailable very early in a page's life.
    }

    if (!document.body || !document.body.classList.contains('jt-dark-double')) return seed;
    if (typeof hexToHsl !== 'function' || typeof adjustLightness !== 'function') return seed;

    const hsl = hexToHsl(seed);
    if (!hsl) return seed;
    return adjustLightness(seed, -Math.round(hsl.l * DOUBLE_DARK_DROP));
  }

  // Detect which theme is active by checking DOM, not feature state
  function getActiveTheme() {
    // Check if custom theme CSS is actually injected in DOM
    if (isCustomThemeActive()) {
      // Try to get colors from feature if available
      if (window.CustomThemeFeature && typeof window.CustomThemeFeature.getColors === 'function') {
        const colors = window.CustomThemeFeature.getColors();
        return {
          type: 'custom',
          baseColor: colors.background
        };
      }
      // Fallback if feature not available but CSS is present
      return {
        type: 'custom',
        baseColor: '#F3E8FF' // Default custom theme background
      };
    }

    // JobTread's own dark mode is the ground: take their surface, not ours.
    // Still type 'dark' — that is what picks the 2% shade step and the
    // lighten-upward direction, both of which are right on either ground.
    if (isNativeDarkGround()) {
      return {
        type: 'dark',
        baseColor: nativeDarkBaseColor()
      };
    }

    // Check if dark mode CSS is actually injected in DOM
    if (isDarkModeActive()) {
      return {
        type: 'dark',
        baseColor: '#424242' // Neutral dark gray (less blue)
      };
    }

    // Default to light mode
    return {
      type: 'light',
      baseColor: '#F9FAFB' // gray-50 as base for light mode
    };
  }

  // Initialize the feature
  function init() {
    if (isActive) return;

    isActive = true;

    // Delay initialization slightly to ensure dark mode/custom theme CSS is loaded
    // This prevents white shading when navigating back to budget pages
    setTimeout(() => {
      if (!isActive) return; // Check if cleanup was called during delay

      // Inject shading CSS with current theme
      injectShadingCSS();

      // Apply shading to existing groups
      applyGroupShading();

      // Start observing for new groups
      startObserver();

      console.log('BudgetHierarchy: Activated');
    }, 100); // 100ms delay to let dark mode/theme CSS inject
  }

  // Cleanup the feature
  function cleanup() {
    if (!isActive) return;

    isActive = false;

    // Disconnect observer
    if (observer) {
      observer.disconnect();
      observer = null;
    }

    // Remove click event listener
    if (clickController) {
      clickController.abort();
      clickController = null;
    }

    // Remove shading classes
    removeAllShading();

    // Remove injected CSS
    if (styleElement) {
      styleElement.remove();
      styleElement = null;
    }

    console.log('BudgetHierarchy: Deactivated');
  }

  // Inject CSS for shading
  function injectShadingCSS() {
    // Remove old style if exists
    if (styleElement) {
      styleElement.remove();
    }

    // Get active theme and generate shades
    const theme = getActiveTheme();
    const isDarkMode = theme.type === 'dark';
    const shades = generateShades(theme.baseColor, isDarkMode);

    // Generate hover shades (slightly darker than base using HSL)
    const hoverShades = shades.map(shade => {
      const hsl = hexToHsl(shade);
      if (!hsl) return shade;

      // Darken by reducing lightness in HSL
      return adjustLightness(shade, hsl.l < 50 ? -3 : -4);
    });

    // Line items should match their parent group shades exactly
    const itemShades = [...shades];

    const itemHoverShades = [...hoverShades];

    styleElement = document.createElement('style');
    styleElement.id = 'jt-budget-hierarchy-styles';
    styleElement.textContent = `
      /* Budget Group Hierarchy Shading */
      /* Generated for ${theme.type} theme */
      /* Level 1 = Lightest (Top level groups) */
      /* Level 5 = Darkest (Deepest nested groups) */

      .jt-group-level-1 { background-color: ${shades[0]} !important; }
      .jt-group-level-2 { background-color: ${shades[1]} !important; }
      .jt-group-level-3 { background-color: ${shades[2]} !important; }
      .jt-group-level-4 { background-color: ${shades[3]} !important; }
      .jt-group-level-5 { background-color: ${shades[4]} !important; }

      /* Hover states for groups */
      .jt-group-level-1:hover { background-color: ${hoverShades[0]} !important; }
      .jt-group-level-2:hover { background-color: ${hoverShades[1]} !important; }
      .jt-group-level-3:hover { background-color: ${hoverShades[2]} !important; }
      .jt-group-level-4:hover { background-color: ${hoverShades[3]} !important; }
      .jt-group-level-5:hover { background-color: ${hoverShades[4]} !important; }

      /* Line items under groups (slightly lighter) */
      .jt-item-under-level-1 { background-color: ${itemShades[0]} !important; }
      .jt-item-under-level-2 { background-color: ${itemShades[1]} !important; }
      .jt-item-under-level-3 { background-color: ${itemShades[2]} !important; }
      .jt-item-under-level-4 { background-color: ${itemShades[3]} !important; }
      .jt-item-under-level-5 { background-color: ${itemShades[4]} !important; }

      /* Hover states for items */
      .jt-item-under-level-1:hover { background-color: ${itemHoverShades[0]} !important; }
      .jt-item-under-level-2:hover { background-color: ${itemHoverShades[1]} !important; }
      .jt-item-under-level-3:hover { background-color: ${itemHoverShades[2]} !important; }
      .jt-item-under-level-4:hover { background-color: ${itemHoverShades[3]} !important; }
      .jt-item-under-level-5:hover { background-color: ${itemHoverShades[4]} !important; }

      /* Apply shading to all cells in the group row */
      /* BUT preserve yellow highlighting for unsaved changes and blue for selection */
      /* Exclude resize handles (.cursor-col-resize) from inheriting background */
      .jt-group-level-1 > div:not([class*="bg-yellow"]):not([class*="bg-blue"]):not(.cursor-col-resize),
      .jt-group-level-2 > div:not([class*="bg-yellow"]):not([class*="bg-blue"]):not(.cursor-col-resize),
      .jt-group-level-3 > div:not([class*="bg-yellow"]):not([class*="bg-blue"]):not(.cursor-col-resize),
      .jt-group-level-4 > div:not([class*="bg-yellow"]):not([class*="bg-blue"]):not(.cursor-col-resize),
      .jt-group-level-5 > div:not([class*="bg-yellow"]):not([class*="bg-blue"]):not(.cursor-col-resize) {
        background-color: inherit !important;
      }

      /* Apply shading to indent spacer divs (nested inside first cell) */
      /* Only if parent cell doesn't have yellow or blue background */
      .jt-group-level-1 > div:not([class*="bg-yellow"]):not([class*="bg-blue"]) div.pl-3\\.5.border-r-2,
      .jt-group-level-2 > div:not([class*="bg-yellow"]):not([class*="bg-blue"]) div.pl-3\\.5.border-r-2,
      .jt-group-level-3 > div:not([class*="bg-yellow"]):not([class*="bg-blue"]) div.pl-3\\.5.border-r-2,
      .jt-group-level-4 > div:not([class*="bg-yellow"]):not([class*="bg-blue"]) div.pl-3\\.5.border-r-2,
      .jt-group-level-5 > div:not([class*="bg-yellow"]):not([class*="bg-blue"]) div.pl-3\\.5.border-r-2 {
        background-color: inherit !important;
      }

      /* Override specific background classes on spacers */
      /* Only if parent cell doesn't have yellow or blue background */
      /* Note: We exclude bg-blue-50 spacers to preserve selection highlighting */
      .jt-group-level-1 > div:not([class*="bg-yellow"]):not([class*="bg-blue"]) div.pl-3\\.5.bg-white,
      .jt-group-level-2 > div:not([class*="bg-yellow"]):not([class*="bg-blue"]) div.pl-3\\.5.bg-white,
      .jt-group-level-3 > div:not([class*="bg-yellow"]):not([class*="bg-blue"]) div.pl-3\\.5.bg-white,
      .jt-group-level-4 > div:not([class*="bg-yellow"]):not([class*="bg-blue"]) div.pl-3\\.5.bg-white,
      .jt-group-level-5 > div:not([class*="bg-yellow"]):not([class*="bg-blue"]) div.pl-3\\.5.bg-white {
        background-color: inherit !important;
      }

      /* Apply shading to all cells in line item rows */
      /* BUT preserve yellow highlighting for unsaved changes and blue for selection */
      /* Exclude resize handles (.cursor-col-resize) from inheriting background */
      .jt-item-under-level-1 > div:not([class*="bg-yellow"]):not([class*="bg-blue"]):not(.cursor-col-resize),
      .jt-item-under-level-2 > div:not([class*="bg-yellow"]):not([class*="bg-blue"]):not(.cursor-col-resize),
      .jt-item-under-level-3 > div:not([class*="bg-yellow"]):not([class*="bg-blue"]):not(.cursor-col-resize),
      .jt-item-under-level-4 > div:not([class*="bg-yellow"]):not([class*="bg-blue"]):not(.cursor-col-resize),
      .jt-item-under-level-5 > div:not([class*="bg-yellow"]):not([class*="bg-blue"]):not(.cursor-col-resize) {
        background-color: inherit !important;
      }

      /* Apply shading to indent spacer divs in line items */
      /* Only if parent cell doesn't have yellow or blue background */
      .jt-item-under-level-1 > div:not([class*="bg-yellow"]):not([class*="bg-blue"]) div.pl-3\\.5.border-r-2,
      .jt-item-under-level-2 > div:not([class*="bg-yellow"]):not([class*="bg-blue"]) div.pl-3\\.5.border-r-2,
      .jt-item-under-level-3 > div:not([class*="bg-yellow"]):not([class*="bg-blue"]) div.pl-3\\.5.border-r-2,
      .jt-item-under-level-4 > div:not([class*="bg-yellow"]):not([class*="bg-blue"]) div.pl-3\\.5.border-r-2,
      .jt-item-under-level-5 > div:not([class*="bg-yellow"]):not([class*="bg-blue"]) div.pl-3\\.5.border-r-2 {
        background-color: inherit !important;
      }

      /* Override specific background classes on spacers in line items */
      /* Only if parent cell doesn't have yellow or blue background */
      /* Note: We exclude bg-blue-50 spacers to preserve selection highlighting */
      .jt-item-under-level-1 > div:not([class*="bg-yellow"]):not([class*="bg-blue"]) div.pl-3\\.5.bg-white,
      .jt-item-under-level-2 > div:not([class*="bg-yellow"]):not([class*="bg-blue"]) div.pl-3\\.5.bg-white,
      .jt-item-under-level-3 > div:not([class*="bg-yellow"]):not([class*="bg-blue"]) div.pl-3\\.5.bg-white,
      .jt-item-under-level-4 > div:not([class*="bg-yellow"]):not([class*="bg-blue"]) div.pl-3\\.5.bg-white,
      .jt-item-under-level-5 > div:not([class*="bg-yellow"]):not([class*="bg-blue"]) div.pl-3\\.5.bg-white {
        background-color: inherit !important;
      }

      /* Column resize handles */
      /* Keep resize handles transparent - don't inherit shading */
      .absolute.z-10.cursor-col-resize,
      [class*="jt-group-level"] .cursor-col-resize,
      [class*="jt-item-under-level"] .cursor-col-resize {
        background-color: transparent !important;
        z-index: 1 !important;
      }

      /* Document view indents: pl-2 (display view) / pl-2.5 (edit panel) / pr-2 right indents */
      /* These have bg-white on the spacer itself, which hides the parent row's shading */
      [class*="jt-group-level-"] > div:not([class*="bg-yellow"]):not([class*="bg-blue"]) div.pl-2.border-r-2,
      [class*="jt-group-level-"] > div:not([class*="bg-yellow"]):not([class*="bg-blue"]) div.pl-2\\.5.border-r-2,
      [class*="jt-group-level-"] > div:not([class*="bg-yellow"]):not([class*="bg-blue"]) div.pr-2.border-l-2,
      [class*="jt-item-under-level-"] > div:not([class*="bg-yellow"]):not([class*="bg-blue"]) div.pl-2.border-r-2,
      [class*="jt-item-under-level-"] > div:not([class*="bg-yellow"]):not([class*="bg-blue"]) div.pl-2\\.5.border-r-2,
      [class*="jt-item-under-level-"] > div:not([class*="bg-yellow"]):not([class*="bg-blue"]) div.pr-2.border-l-2 {
        background-color: inherit !important;
      }
    `;

    document.head.appendChild(styleElement);
  }

  // Refresh shading when theme changes
  function refreshShading() {
    if (!isActive) return;

    injectShadingCSS();
    applyGroupShading();
  }

  // Get nesting level of a group element
  function getGroupNestingLevel(groupCell) {
    // Count the number of indent divs (pl-3.5 border-r-2)
    const indentDivs = groupCell.querySelectorAll(':scope > div.pl-3\\.5.border-r-2');
    const level = indentDivs.length + 1; // 0 indents = level 1, 1 indent = level 2, etc.

    return Math.min(level, 5); // Cap at level 5
  }

  // Get nesting level of any row (group or line item)
  function getRowNestingLevel(row) {
    // First try to find a group cell (font-bold)
    const groupCell = row.querySelector('div.font-bold.flex[style*="width: 300px"]');
    if (groupCell) {
      return getGroupNestingLevel(groupCell);
    }

    // For line items, check the first cell for indent divs
    const firstCell = row.querySelector(':scope > div');
    if (firstCell) {
      const indentDivs = firstCell.querySelectorAll(':scope > div.pl-3\\.5.border-r-2');
      const level = indentDivs.length + 1;
      return Math.min(level, 5);
    }

    return 1; // Default to level 1 if we can't determine
  }

  // Find all group cells (first cell with font-bold class)
  function findAllGroupCells() {
    // Group cells have font-bold class and contain the expand/collapse button
    return document.querySelectorAll('div.font-bold.flex[style*="width: 300px"]');
  }

  // Find the parent row element
  function findParentRow(groupCell) {
    // The row is typically the parent or grandparent element
    // Look for element that contains multiple cells (border-r elements)
    let current = groupCell.parentElement;
    let depth = 0;
    const maxDepth = 5;

    while (current && depth < maxDepth) {
      // Check if this element looks like a row (has multiple child cells)
      const cells = current.querySelectorAll(':scope > div.border-r');
      if (cells.length > 1) {
        return current;
      }
      current = current.parentElement;
      depth++;
    }

    // If we can't find a row, return the group cell itself
    return groupCell;
  }

  // Apply shading to a single group
  function applyShading(groupCell) {
    const level = getGroupNestingLevel(groupCell);
    const row = findParentRow(groupCell);

    // Remove any existing level classes
    for (let i = 1; i <= 5; i++) {
      row.classList.remove(`jt-group-level-${i}`);
    }

    // Add the appropriate level class
    row.classList.add(`jt-group-level-${level}`);
  }


  // Remove all item shading
  function removeAllItemShading() {
    for (let i = 1; i <= 5; i++) {
      const shadedItems = document.querySelectorAll(`.jt-item-under-level-${i}`);
      shadedItems.forEach(el => {
        el.classList.remove(`jt-item-under-level-${i}`);
      });
    }
  }

  // Find the parent group for a line item by looking backwards
  function findParentGroupForItem(itemRow) {
    if (!itemRow) return null;

    const itemLevel = getRowNestingLevel(itemRow);
    let currentRow = itemRow.previousElementSibling;

    // Look backwards to find the nearest group at a shallower level
    while (currentRow) {
      const groupCell = currentRow.querySelector('div.font-bold.flex[style*="width: 300px"]');
      if (groupCell) {
        const groupLevel = getGroupNestingLevel(groupCell);
        // If this group is at a shallower level, it's the parent
        if (groupLevel < itemLevel) {
          return { row: currentRow, level: groupLevel };
        }
      }
      currentRow = currentRow.previousElementSibling;
    }

    return null; // No parent group found
  }

  // Check if we're on a budget page or in a budget context
  function isInBudgetContext() {
    const path = window.location.pathname.toLowerCase();

    // Explicitly exclude these pages first
    const excludedPaths = ['/tasks', '/task', '/schedule', '/todos', '/to-dos', '/assignments'];
    for (const excludePath of excludedPaths) {
      if (path.includes(excludePath)) {
        return false;
      }
    }

    // Check if URL contains budget (singular or plural)
    if (path.includes('/budget')) {
      return true;
    }

    // Document pages can contain budget tables (PDA, HIA, Change Orders, etc.)
    if (path.includes('/documents/') || path.includes('/document/')) {
      return true;
    }

    return false;
  }

  // Shade groups only. Items keep their default background so groups stay
  // visually distinct — otherwise every row under a group looks identical to
  // the group itself, collapsing the hierarchy into a single flat block.
  function applyGroupLevelClasses(rowInfo) {
    rowInfo.forEach(info => {
      for (let i = 1; i <= 5; i++) {
        info.row.classList.remove(`jt-group-level-${i}`, `jt-item-under-level-${i}`);
      }
      if (info.isGroup) {
        info.row.classList.add(`jt-group-level-${info.level}`);
      }
    });
  }

  // Apply shading to document display budget tables (PDA/HIA/Change Order PDFs)
  // Structure differs from the budget page: rows are `div.flex.min-w-max` inside
  // `div.border-b`, main cell is 175px wide, groups are marked by `bg-gray-100`
  // on the outer cell with a `font-bold` inner content div. Indents use
  // `pl-2 border-r-2` (left) and `pr-2 border-l-2` (right) instead of pl-3.5.
  function applyDocumentDisplayShading() {
    const rows = document.querySelectorAll('div.flex.min-w-max');
    const rowInfo = [];

    rows.forEach(row => {
      // Skip edit items panel rows — they use `select-none group` and have a
      // different structure; the main budget-page pass handles 300px groups.
      if (row.classList.contains('select-none')) return;

      const firstCell = row.querySelector(':scope > div.shrink-0');
      if (!firstCell) return;
      const style = firstCell.getAttribute('style') || '';
      if (!style.includes('width: 175px')) return;

      // Count left indents — direct children with border-r-2 (pl-2 or ml-2)
      const indentCount = firstCell.querySelectorAll(':scope > div.border-r-2').length;
      const level = Math.min(indentCount + 1, 5);

      // Group marker: outer cell has bg-gray-100 AND content cell contains font-bold
      const contentCell = firstCell.querySelector(':scope > div.min-w-0.p-2');
      const hasFontBold = contentCell ? contentCell.querySelector('.font-bold') !== null : false;
      const isGroup = firstCell.classList.contains('bg-gray-100') && hasFontBold;

      rowInfo.push({ row, depth: indentCount, level, isGroup });
    });

    // Shade groups only. Items keep their default background so groups stay
    // visually distinct — otherwise every row under a group looks identical to
    // the group itself, collapsing the hierarchy into a single flat block.
    applyGroupLevelClasses(rowInfo);
  }

  // Apply shading to the Add/Edit Items sidebar on document pages.
  // Row marker: `div.flex.min-w-max.select-none.group`. The 350px name cell is
  // the second child and carries `font-bold` on group rows. Indents are
  // `pl-2.5 border-r-2` direct children of the name cell (the chevron button
  // has its own nested pl-2.5 border-r-2 but we only count direct children).
  function applyEditPanelShading() {
    const rows = document.querySelectorAll('div.flex.min-w-max.select-none.group');
    const rowInfo = [];

    rows.forEach(row => {
      // Find the 350px name cell — second direct child (after the 30px row-number cell)
      const nameCell = row.querySelector(':scope > div.shrink-0[style*="width: 350px"]');
      if (!nameCell) return;

      const indentCount = nameCell.querySelectorAll(':scope > div.border-r-2').length;
      const level = Math.min(indentCount + 1, 5);
      const isGroup = nameCell.classList.contains('font-bold');

      rowInfo.push({ row, depth: indentCount, level, isGroup });
    });

    // Shade groups only; items keep their default bg-white so the hierarchy
    // is visible. See applyDocumentDisplayShading for rationale.
    applyGroupLevelClasses(rowInfo);
  }

  // Apply shading to all groups
  function applyGroupShading() {
    // Only apply shading if we're in a budget context
    if (!isInBudgetContext()) {
      return;
    }

    isApplyingShading = true;
    try {
      const groupCells = findAllGroupCells();

      // First, remove all existing shading from items
      removeAllItemShading();

      // Apply shading to all groups
      groupCells.forEach(groupCell => {
        applyShading(groupCell);
      });

      // Now shade all line items by finding their parent groups
      let allRows = document.querySelectorAll('[class*="group/row"]');

      if (allRows.length === 0) {
        allRows = document.querySelectorAll('.group\\/row');
      }

      allRows.forEach(row => {
        // Skip if it's a group row
        const isGroup = row.querySelector('div.font-bold.flex[style*="width: 300px"]');
        if (isGroup) return;

        // This is a line item, find its parent group
        const parentGroup = findParentGroupForItem(row);
        if (parentGroup) {
          // Remove any existing item-level classes
          for (let i = 1; i <= 5; i++) {
            row.classList.remove(`jt-item-under-level-${i}`);
          }
          // Add the parent group's level
          row.classList.add(`jt-item-under-level-${parentGroup.level}`);
        }
      });

      // Also handle document display views (PDA/HIA tables rendered on /documents/ pages)
      applyDocumentDisplayShading();

      // Also handle the Add/Edit Items sidebar on document pages (editable budget table)
      applyEditPanelShading();
    } finally {
      // Drain any mutation records our own class changes just queued so the
      // observer callback doesn't see them and schedule another apply.
      if (observer) observer.takeRecords();
      isApplyingShading = false;
    }
  }

  // Remove all shading classes
  function removeAllShading() {
    // Remove group shading
    for (let i = 1; i <= 5; i++) {
      const shadedElements = document.querySelectorAll(`.jt-group-level-${i}`);
      shadedElements.forEach(el => {
        el.classList.remove(`jt-group-level-${i}`);
      });
    }

    // Remove item shading
    removeAllItemShading();
  }

  // Start observing for new groups
  function startObserver() {
    if (observer) return;

    let reapplyTimeout = null;
    let themeRefreshTimeout = null;

    observer = new MutationObserver((mutations) => {
      if (!isActive) return;
      // Ignore mutations we caused ourselves to avoid a reflow loop.
      if (isApplyingShading) return;

      // Check if any changes warrant reapplying shading
      let shouldReapply = false;
      let shouldRefreshTheme = false;

      for (const mutation of mutations) {
        if (mutation.type === 'childList') {
          // Check if theme styles were added/removed (dark mode or custom theme toggled)
          mutation.addedNodes.forEach(node => {
            if (node.nodeType === 1) { // Element node
              // Check if dark mode or custom theme CSS was injected
              if (node.id === 'jt-dark-mode-styles' || node.id === 'jt-custom-theme-styles') {
                shouldRefreshTheme = true;
              }

              // Check if budget rows were added
              if (node.classList?.contains('font-bold') ||
                  node.classList?.contains('group/row') ||
                  node.querySelector?.('div.font-bold.flex[style*="width: 300px"]') ||
                  node.querySelector?.('.group\\/row') ||
                  // Document display budget tables (PDA/HIA rendered on /documents/ pages)
                  node.querySelector?.('div.flex.min-w-max > div.shrink-0[style*="width: 175px"]') ||
                  // Document Add/Edit Items sidebar rows
                  node.classList?.contains('select-none') ||
                  node.querySelector?.('div.flex.min-w-max.select-none.group')) {
                shouldReapply = true;
              }
            }
          });

          // Check if theme styles were removed
          mutation.removedNodes.forEach(node => {
            if (node.nodeType === 1) {
              // Check if dark mode or custom theme CSS was removed
              if (node.id === 'jt-dark-mode-styles' || node.id === 'jt-custom-theme-styles') {
                shouldRefreshTheme = true;
              }

              // Check if rows were removed (collapse scenario)
              if (node.classList?.contains('group/row')) {
                shouldReapply = true;
              }
            }
          });
        }

        // Watch for attribute changes (like style or class changes on expand/collapse)
        if (mutation.type === 'attributes') {
          const target = mutation.target;

          // A class change on <body> is how the theme now announces itself:
          // NativeDarkBridge toggles jt-dark-mode there when JobTread's own dark
          // mode is switched on or off. Without this, flipping JobTread's theme
          // picker left the shading derived from the previous theme's colors
          // until the next reload — the style-injection check below only fires
          // when OUR stylesheet is added or removed.
          if (target === document.body) {
            shouldRefreshTheme = true;
          } else if (target.classList?.contains('group/row') ||
              target.querySelector?.('.group\\/row')) {
            shouldReapply = true;
          }
        }
      }

      // If theme changed, refresh everything with new colors
      if (shouldRefreshTheme) {
        if (themeRefreshTimeout) clearTimeout(themeRefreshTimeout);
        themeRefreshTimeout = setTimeout(() => {
          refreshShading();
        }, 50);
      }
      // Otherwise just reapply shading if needed
      else if (shouldReapply) {
        // Debounce reapply to avoid excessive calls
        if (reapplyTimeout) clearTimeout(reapplyTimeout);
        reapplyTimeout = setTimeout(() => {
          applyGroupShading();
        }, 50); // 50ms debounce
      }
    });

    // Observe the entire document for changes with more aggressive options
    observer.observe(document.body, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ['class', 'style']
    });

    // Also observe head for style injection (dark mode, custom theme)
    observer.observe(document.head, {
      childList: true,
      subtree: false
    });

    // Add click listener for expand/collapse buttons to force immediate reapply
    clickController = new AbortController();
    document.body.addEventListener('click', (e) => {
      if (!isActive) return;

      // Check if the click was on or near a collapse/expand button
      const target = e.target;
      const isExpandCollapseButton = target.closest('button')?.querySelector('svg') ||
                                     target.closest('svg')?.closest('button');

      if (isExpandCollapseButton) {
        // Force reapply after a short delay to let DOM update
        setTimeout(() => {
          applyGroupShading();
        }, 100);
      }
    }, { signal: clickController.signal });
  }

  return {
    init,
    cleanup,
    refreshShading,
    isActive: () => isActive
  };
})();

// Make available globally
window.BudgetHierarchyFeature = BudgetHierarchyFeature;
