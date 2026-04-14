# Expand/Collapse All Budget Groups Button — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add a single smart toggle button to the budget table Name header that expands or collapses all group levels with one click.

**Architecture:** Self-contained logic added to `formatter-modules/toolbar.js`. The button is injected into the Name header cell when the formatter detects a budget page. It auto-detects current expand/collapse state by inspecting group chevrons, then clicks the native expand/collapse-one-level header button 5 times with delays. A MutationObserver on the header cell handles re-injection after SPA navigations.

**Tech Stack:** Vanilla JS, Chrome Extension Manifest V3, DOM manipulation, MutationObserver

---

### Task 1: Add the Expand/Collapse All Button Creation Function

**Files:**
- Modify: `JT-Tools-Master/features/formatter-modules/toolbar.js`

**Step 1: Add module state for the button at the top of the IIFE (after line 15)**

Add these state variables inside the `FormatterToolbar` IIFE, after `let budgetScrollCleanup = null;`:

```javascript
let expandCollapseAllBtn = null;       // The injected button element
let expandCollapseAllCleanup = null;   // Cleanup function for button listeners
```

**Step 2: Add the SVG icon constants and button creation function**

Add before the `return {` block (before line 1780):

```javascript
// ─── Expand/Collapse All Button ─────────────────────────────────────

const EXPAND_ALL_SVG = `<svg xmlns="http://www.w3.org/2000/svg" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2" class="inline-block overflow-visible h-[1em] w-[1em] align-[-0.125em]" viewBox="0 0 24 24"><path d="M7 4v16M17 4v16M11 8l-4 4 4 4M13 8l4 4-4 4"/></svg>`;

const COLLAPSE_ALL_SVG = `<svg xmlns="http://www.w3.org/2000/svg" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2" class="inline-block overflow-visible h-[1em] w-[1em] align-[-0.125em]" viewBox="0 0 24 24"><path d="M7 4v16M17 4v16M13 8l-4 4 4 4M11 8l4 4-4 4"/></svg>`;
```

The expand icon shows arrows pointing outward (away from center bars), collapse shows arrows pointing inward (toward center bars). Both match the native button's SVG sizing classes exactly.

**Step 3: Commit**

```bash
git add JT-Tools-Master/features/formatter-modules/toolbar.js
git commit -m "feat: add expand/collapse all button state and SVG icons"
```

---

### Task 2: Add State Detection Logic

**Files:**
- Modify: `JT-Tools-Master/features/formatter-modules/toolbar.js`

**Step 1: Add the detectGroupState function**

Add after the SVG constants from Task 1:

```javascript
/**
 * Detect whether budget groups are mostly expanded or collapsed.
 * Looks at group row chevrons — expanded groups have a rotated SVG.
 * @returns {'expanded'|'collapsed'|'none'} Current majority state, or 'none' if no groups
 */
function detectGroupState() {
  // Find the budget scroll container
  const scrollContainer = document.querySelector('.overflow-auto .flex.min-w-max')?.closest('.overflow-auto');
  if (!scrollContainer) return 'none';

  // Group rows have font-bold Name cells with width: 300px
  const groupCells = scrollContainer.querySelectorAll('div.font-bold.flex[style*="width: 300px"]');
  if (groupCells.length === 0) return 'none';

  let expanded = 0;
  let collapsed = 0;

  groupCells.forEach(cell => {
    // Each group cell has a clickable chevron button.
    // When expanded, the chevron SVG (or its container) has a rotation transform.
    const btn = cell.querySelector('div[role="button"], button');
    if (!btn) return;

    const svg = btn.querySelector('svg');
    if (!svg) return;

    // Check for rotation — JobTread applies rotate-90 class or transform style
    const hasRotation = btn.classList.contains('rotate-90') ||
                        svg.classList.contains('rotate-90') ||
                        btn.style.transform?.includes('rotate') ||
                        svg.style.transform?.includes('rotate');

    if (hasRotation) {
      expanded++;
    } else {
      collapsed++;
    }
  });

  if (expanded === 0 && collapsed === 0) return 'none';
  return expanded > collapsed ? 'expanded' : 'collapsed';
}
```

**Step 2: Commit**

```bash
git add JT-Tools-Master/features/formatter-modules/toolbar.js
git commit -m "feat: add budget group state detection for expand/collapse all"
```

---

### Task 3: Add the Toggle Action Logic

**Files:**
- Modify: `JT-Tools-Master/features/formatter-modules/toolbar.js`

**Step 1: Add the findHeaderExpandCollapseButtons helper**

Add after `detectGroupState()`:

```javascript
/**
 * Find the native expand-one-level and collapse-one-level buttons in the Name header.
 * Identifies them by their SVG path data:
 * - Expand: path contains "M3 21l7-7" (outward arrows)
 * - Collapse: path contains "M15 3h6v6" (inward arrows)
 * @returns {{ expandBtn: HTMLElement|null, collapseBtn: HTMLElement|null }}
 */
function findHeaderExpandCollapseButtons() {
  // Find the Name header cell: sticky, width 300px, font-bold, with "Name" text
  const headerCells = document.querySelectorAll('div.sticky.font-bold[style*="width: 300px"]');
  let nameHeader = null;

  for (const cell of headerCells) {
    const textDiv = cell.querySelector(':scope > div.p-2.grow');
    if (textDiv && textDiv.textContent.trim() === 'Name') {
      nameHeader = cell;
      break;
    }
  }

  if (!nameHeader) return { expandBtn: null, collapseBtn: null };

  let expandBtn = null;
  let collapseBtn = null;

  const buttons = nameHeader.querySelectorAll('div[role="button"]');
  buttons.forEach(btn => {
    const paths = btn.querySelectorAll('svg path');
    const pathData = Array.from(paths).map(p => p.getAttribute('d')).join(' ');

    // Expand one level: has outward arrows (M3 21l7-7 ... m14 10)
    if (pathData.includes('M3 21') && pathData.includes('m14 10')) {
      expandBtn = btn;
    }
    // Collapse one level: has inward arrows (M15 3h6v6 ... M3 21l7-7 ... M9 21H3v-6)
    if (pathData.includes('M15 3h6v6') && pathData.includes('M9 21H3v-6')) {
      collapseBtn = btn;
    }
  });

  return { expandBtn, collapseBtn };
}
```

**Step 2: Add the performExpandCollapseAll function**

```javascript
/**
 * Click the native expand or collapse button repeatedly to expand/collapse all levels.
 * Disables the toggle button during operation and re-detects state afterward.
 * @param {'expand'|'collapse'} action - Which action to perform
 */
async function performExpandCollapseAll(action) {
  if (!expandCollapseAllBtn) return;

  const { expandBtn, collapseBtn } = findHeaderExpandCollapseButtons();
  const targetBtn = action === 'expand' ? expandBtn : collapseBtn;

  if (!targetBtn) {
    console.log('Formatter: Could not find native ' + action + ' button');
    return;
  }

  // Disable our button during operation
  expandCollapseAllBtn.style.opacity = '0.5';
  expandCollapseAllBtn.style.pointerEvents = 'none';

  // Click 5 times with delays (max 5 nesting levels)
  for (let i = 0; i < 5; i++) {
    targetBtn.click();
    await new Promise(resolve => setTimeout(resolve, 150));
  }

  // Re-detect state and update icon after DOM settles
  setTimeout(() => {
    if (expandCollapseAllBtn) {
      updateExpandCollapseAllIcon();
      expandCollapseAllBtn.style.opacity = '';
      expandCollapseAllBtn.style.pointerEvents = '';
    }
  }, 300);
}
```

**Step 3: Add the icon update function**

```javascript
/**
 * Update the expand/collapse all button icon based on current group state.
 */
function updateExpandCollapseAllIcon() {
  if (!expandCollapseAllBtn) return;

  const state = detectGroupState();

  if (state === 'none') {
    // No groups — hide the button
    expandCollapseAllBtn.style.display = 'none';
    return;
  }

  expandCollapseAllBtn.style.display = '';

  if (state === 'expanded') {
    expandCollapseAllBtn.innerHTML = COLLAPSE_ALL_SVG;
    expandCollapseAllBtn.title = 'Collapse All Groups';
  } else {
    expandCollapseAllBtn.innerHTML = EXPAND_ALL_SVG;
    expandCollapseAllBtn.title = 'Expand All Groups';
  }
}
```

**Step 4: Commit**

```bash
git add JT-Tools-Master/features/formatter-modules/toolbar.js
git commit -m "feat: add expand/collapse all toggle action and icon update logic"
```

---

### Task 4: Add Button Injection and Cleanup

**Files:**
- Modify: `JT-Tools-Master/features/formatter-modules/toolbar.js`

**Step 1: Add the injection function**

```javascript
/**
 * Inject the Expand/Collapse All button into the budget Name header cell.
 * Places it after the native collapse-one-level button, before the eye/visibility button.
 */
function injectExpandCollapseAllButton() {
  // Don't double-inject
  if (expandCollapseAllBtn && document.body.contains(expandCollapseAllBtn)) return;

  // Only on budget pages
  if (!window.location.pathname.endsWith('/budget')) return;

  const { expandBtn, collapseBtn } = findHeaderExpandCollapseButtons();
  if (!collapseBtn) return; // No header found

  const nameHeader = collapseBtn.closest('div.sticky.font-bold[style*="width: 300px"]');
  if (!nameHeader) return;

  // Create button matching native styling exactly
  const btn = document.createElement('div');
  btn.setAttribute('role', 'button');
  btn.setAttribute('tabindex', '0');
  btn.className = 'inline-block align-bottom relative cursor-pointer p-2 hover:backdrop-brightness-95';
  btn.dataset.jtExpandCollapseAll = 'true';

  expandCollapseAllBtn = btn;
  updateExpandCollapseAllIcon();

  // Click handler
  const handleClick = () => {
    const state = detectGroupState();
    if (state === 'expanded') {
      performExpandCollapseAll('collapse');
    } else {
      performExpandCollapseAll('expand');
    }
  };

  btn.addEventListener('click', handleClick);

  // Listen for clicks on native expand/collapse buttons to update our icon
  const handleNativeClick = (e) => {
    const target = e.target.closest('div[role="button"]');
    if (target && target !== btn && nameHeader.contains(target)) {
      // Native button was clicked — update our icon after DOM settles
      setTimeout(updateExpandCollapseAllIcon, 300);
    }
  };
  nameHeader.addEventListener('click', handleNativeClick);

  // Listen for individual group chevron clicks anywhere in the budget table
  const scrollContainer = document.querySelector('.overflow-auto .flex.min-w-max')?.closest('.overflow-auto');
  const handleGroupChevronClick = (e) => {
    const target = e.target.closest('div[role="button"]');
    if (target) {
      setTimeout(updateExpandCollapseAllIcon, 300);
    }
  };
  if (scrollContainer) {
    scrollContainer.addEventListener('click', handleGroupChevronClick);
  }

  // Insert after the collapse button (before the eye/visibility button)
  collapseBtn.after(btn);

  // Store cleanup
  expandCollapseAllCleanup = () => {
    btn.removeEventListener('click', handleClick);
    nameHeader.removeEventListener('click', handleNativeClick);
    if (scrollContainer) {
      scrollContainer.removeEventListener('click', handleGroupChevronClick);
    }
    btn.remove();
    expandCollapseAllBtn = null;
    expandCollapseAllCleanup = null;
  };

  console.log('Formatter: Expand/Collapse All button injected');
}

/**
 * Remove the Expand/Collapse All button and clean up listeners.
 */
function removeExpandCollapseAllButton() {
  if (expandCollapseAllCleanup) {
    expandCollapseAllCleanup();
  }
}
```

**Step 2: Commit**

```bash
git add JT-Tools-Master/features/formatter-modules/toolbar.js
git commit -m "feat: add expand/collapse all button injection and cleanup"
```

---

### Task 5: Wire Into Formatter Lifecycle

**Files:**
- Modify: `JT-Tools-Master/features/formatter-modules/toolbar.js` (public API)
- Modify: `JT-Tools-Master/features/formatter.js` (call injection)

**Step 1: Export new functions from toolbar.js**

Update the `return {` block (around line 1780) to include:

```javascript
return {
    getActiveToolbar,
    getActiveField,
    setActiveField,
    clearHideTimeout,
    positionToolbar,
    updateToolbarState,
    createToolbar,
    showToolbar,
    hideToolbar,
    scheduleHide,
    embedToolbarForField,
    injectExpandCollapseAllButton,
    removeExpandCollapseAllButton
  };
```

**Step 2: Call injection from formatter.js init()**

In `formatter.js`, inside the `init()` function, after `initializeFields();` (line 39), add:

```javascript
      // Inject expand/collapse all button on budget pages
      Toolbar().injectExpandCollapseAllButton();
```

**Step 3: Call injection from formatter.js MutationObserver callback**

In the MutationObserver callback (line 42-48), after `initializeFields();`, add:

```javascript
          // Re-inject expand/collapse all button if budget header re-renders
          Toolbar().injectExpandCollapseAllButton();
```

**Step 4: Call cleanup from formatter.js cleanup()**

In `formatter.js`, inside the `cleanup()` function, after `Toolbar().hideToolbar();` (line 79), add:

```javascript
    // Remove expand/collapse all button
    Toolbar().removeExpandCollapseAllButton();
```

**Step 5: Commit**

```bash
git add JT-Tools-Master/features/formatter-modules/toolbar.js JT-Tools-Master/features/formatter.js
git commit -m "feat: wire expand/collapse all button into formatter lifecycle"
```

---

### Task 6: Update CHANGELOG.md

**Files:**
- Modify: `CHANGELOG.md`

**Step 1: Add entry under [Unreleased]**

```markdown
### Added
- Added Expand/Collapse All Groups button to budget table Name header
  - Single smart toggle button auto-detects current group state
  - Shows expand icon when groups are collapsed, collapse icon when expanded
  - Clicks native expand/collapse buttons 5 times to cover all nesting levels
  - Updates icon when native expand/collapse buttons or group chevrons are clicked
  - Styled to match native JobTread header buttons exactly
```

**Step 2: Commit**

```bash
git add CHANGELOG.md
git commit -m "docs: add expand/collapse all button to CHANGELOG"
```

---

### Task 7: Manual Testing & Polish

**No files to modify — verification only.**

**Step 1: Load extension and navigate to a budget page**
- Verify the button appears in the Name header between collapse-one-level and the eye icon
- Verify it matches native button styling

**Step 2: Test expand all**
- Collapse some groups manually
- Click the toggle button → should expand all groups
- Icon should flip to collapse icon afterward

**Step 3: Test collapse all**
- Click again → should collapse all groups
- Icon should flip to expand icon afterward

**Step 4: Test state detection**
- Manually expand/collapse individual groups
- Verify the button icon updates after ~300ms

**Step 5: Test edge cases**
- Budget with no groups (flat) → button should be hidden
- Navigate away and back (SPA) → button should re-inject
- Toggle formatter feature off → button should be removed
- Dark mode → button should inherit theme colors

**Step 6: Fix any issues found, commit, and finalize**
