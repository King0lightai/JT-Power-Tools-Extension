# Expand/Collapse All Budget Groups Button

**Date:** 2026-03-14
**Feature:** Text Formatter (enhancement)
**Status:** Approved

## Summary

Add a single smart toggle button to the budget table Name header that expands or collapses all group levels with one click. The button auto-detects the current state (mostly expanded vs mostly collapsed) and shows the appropriate action.

## Button Placement

Injected into the Name header cell (`sticky z-10`, `width: 300px`), positioned between the existing collapse-one-level button and the visibility (eye) toggle. Matches native button styling exactly.

### Header button order (after injection):
1. "Name" text
2. Expand one level (native)
3. Collapse one level (native)
4. **Expand/Collapse All (ours)**
5. Visibility toggle (native, eye icon)

## State Detection

- Find all group chevron elements in the budget table (triangle/arrow SVGs on group rows)
- Count expanded (has `rotate-90` or equivalent rotation) vs collapsed
- Majority expanded -> show "collapse all" icon
- Majority collapsed or equal -> show "expand all" icon
- No groups found -> hide the button entirely

## Toggle Action

1. Determine target action (expand or collapse) from detected state
2. Find the corresponding native header button (expand-one-level or collapse-one-level)
3. Click it 5 times with ~150ms delays between clicks (covers max 5 nesting levels)
4. Disable button during operation to prevent double-clicks
5. After completion, re-detect state and update icon

## Re-detection Triggers

- After our own expand/collapse all completes
- When user clicks the native expand/collapse one-level buttons
- When user clicks individual group chevrons

## Icon Design

- Uses SVG with `stroke="currentColor"` to inherit theme colors (dark mode free)
- Expand all: double outward arrows
- Collapse all: double inward arrows
- Same size as native buttons: `h-[1em] w-[1em]`
- Tooltip: "Expand All Groups" / "Collapse All Groups"

## Integration

- Lives in `formatter-modules/toolbar.js` alongside existing budget table logic
- Injected when formatter detects a budget page Name header
- Removed on cleanup
- Re-injected on SPA navigation via existing MutationObserver
- Budget Hierarchy Shading re-applies automatically (existing click listener)

## Styling

Native button classes: `inline-block align-bottom relative cursor-pointer p-2 hover:backdrop-brightness-95`

Disabled state during operation: `opacity-50 pointer-events-none`
