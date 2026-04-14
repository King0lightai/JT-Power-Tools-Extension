# Job Switcher & Budget Changelog Improvements — Design

**Date**: 2026-04-03
**Status**: Approved

---

## Part 1: Job Switcher Improvements

### 1.1 Infinite Scroll Pagination

**Current**: Fetches up to 100 jobs, renders all at once.

**New**:
- Render first 50 jobs on initial load
- IntersectionObserver sentinel element at bottom of job list
- Pre-fetch next page when user scrolls to 80% (feels instant)
- Subtle spinner at list bottom during fetch
- Reset scroll position and results on filter/search change
- Pave API: offset/limit pagination, 50 per page

### 1.2 Alphabetical Sorting

- Sort control below search input / adjacent to filters
- Three options: **Recent** (default) | **A→Z** | **Z→A**
- Server-side via Pave `sortBy: [['name', 'asc']]` or `[['name', 'desc']]`
- Recent = current behavior (API default, typically by createdAt desc)
- Sort preference persisted in chrome.storage.sync
- Changing sort resets infinite scroll and re-fetches

### 1.3 Location Entity Filtering

- New "Location" filter dropdown in custom-field-filter UI
- Fetch via Pave: `organization.locations` → (id, name)
- Cache alongside custom fields (1 hour TTL)
- Multi-select dropdown (same UX as existing custom field value picker)
- Server-side filter: Pave `with` clause on job's `locations` connection
- Combine with existing custom field filters (AND logic)

---

## Part 2: Budget Changelog — Interactive Report

### 2.1 Architecture

- **Sidebar** unchanged: backup selection + compare button
- **Report** opens in new tab as self-contained interactive HTML app
- All diff data serialized as JSON into the HTML at generation time
- No external dependencies — works offline, printable
- Virtual rendering for 1000+ line items

### 2.2 Toolbar / Controls Bar

- **Search box**: filter items by name, cost code, description (200ms debounce)
- **Change type chips**: All | Added | Removed | Modified | Unchanged (toggleable, multi-select)
- **Cost group filter**: multi-select dropdown
- **Threshold filter**: "Show changes > $___" input (applies to absolute cost or price delta)
- **Field visibility toggles**: show/hide columns (description, formulas, cost codes, custom fields, taxable, selected, unit)
- **View toggle**: Delta View (default) | Side-by-Side View
- **Export dropdown**: CSV | Copy to Clipboard | Print
- **Expand All / Collapse All** buttons

### 2.3 Summary Dashboard

- Top of report, always visible (sticky)
- Cards: Added (green) | Removed (red) | Modified (yellow) | Unchanged (grey)
- Each card shows count + total cost/price impact
- Cards are clickable — filters the table to that change type
- Overall cost delta and price delta prominently displayed

### 2.4 Main Data Table

**Collapsible Cost Group Sections**:
- Each cost group = collapsible header row
- Click to expand/collapse children
- Shows group-level subtotals (cost, price, delta)
- Nested groups supported (hierarchy from CSV)

**Sortable Columns**:
- Click header to sort: Name, Qty, Unit Cost, Ext Cost, Unit Price, Ext Price, Cost Δ, Price Δ
- Sort indicator arrows in headers
- Sort within groups (items re-order inside their group)

**Side-by-Side View**:
- Toggle between Delta View and Side-by-Side
- Delta View: current values + colored +/- deltas
- Side-by-Side: Old | New columns for each numeric field
- Text fields (description, formulas): inline word-level diff highlighting

**Full Description Changes**:
- Expandable row detail (click row or expand icon)
- Shows old vs new description with word-level diff (additions highlighted green, removals red)
- Same treatment for formula changes

**Row Styling**:
- Green tint: added items
- Red tint: removed items
- Yellow tint: modified items
- No tint: unchanged items

### 2.5 Virtual Scrolling

- Only render visible rows + 20-row buffer above/below viewport
- Maintains scroll position on filter/sort changes when possible
- Pre-computed indexes at hydration: name index, group index, type index
- CSS `display: none` for collapsed groups (no DOM removal)

### 2.6 Group Navigation

- "Jump to group" dropdown for quick navigation in large budgets
- "Showing X of Y items" counter in toolbar
- Keyboard: Ctrl+F focuses search box

### 2.7 Exports

- **CSV**: Exports currently visible/filtered items with all columns
- **Copy**: Formatted text summary to clipboard
- **Print**: Print-optimized CSS, expands all groups, removes interactive controls

### 2.8 Performance Targets

- 1000 line items: < 500ms initial render
- Filter/sort: < 100ms response time
- Smooth scrolling at 60fps with virtual rendering

---

## Files to Modify

### Job Switcher
- `JT-Tools-Master/features/job-switcher.js` — infinite scroll, sort controls, render changes
- `JT-Tools-Master/features/custom-field-filter.js` — location filter, sort UI integration
- `JT-Tools-Master/utils/jobtread-api.js` — location fetching, sort params, pagination params

### Budget Changelog
- `JT-Tools-Master/features/budget-changelog-modules/ui.js` — complete rewrite of report generation
- `JT-Tools-Master/features/budget-changelog-modules/diff-engine.js` — add unchanged items tracking, enhance grouping
- `JT-Tools-Master/features/budget-changelog-modules/csv-parser.js` — no changes expected
- `JT-Tools-Master/features/budget-changelog.js` — minimal changes (sidebar logic stays)
