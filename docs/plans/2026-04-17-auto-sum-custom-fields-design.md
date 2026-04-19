# Auto Sum — Number Custom Fields (Design)

**Date:** 2026-04-17
**Feature:** Extend the existing Auto Sum (selection totals) feature to also sum number-type custom field columns.

## Motivation

JobTread's budget table supports custom fields on cost items, but only the built-in money columns (Cost, Price, Extended Cost, Extended Price) roll up on group rows or sum in any UI. A number-type custom field named, for example, "Internal Estimate" shows a value per line item but provides no aggregation anywhere — so workflows that compare an internal budget estimate against actual cost/price are not possible without exporting to a spreadsheet.

Our extension's Auto Sum already shows Cost/Price/Profit totals in the MASS BUDGET ACTIONS panel when line items are selected. Extending that panel to also show sums for every detected number custom field closes the comparison gap with no new UI surface — users select rows the same way they do today and simply see more totals.

## Scope

- **In scope:** sum plain number-type custom fields when line items are selected in the budget table.
- **Out of scope:** group/header row rollups (the native-rollup style) — rejected because JT lazy-loads collapsed groups and the DOM isn't reliably available. Also out: currency custom fields (JT doesn't support that type), percentage custom fields (summing percentages is usually wrong), min/max/average stats.

## Architecture

Single-file change: `JT-Tools-Master/features/budget-tools.js`. No new files, no module restructure. The feature extends the existing `syncSelectionMap` → `renderTotals` pipeline.

## Detection

Approach: heuristic auto-detection — blacklist + per-column voting on sampled rows.

**Built-in blacklist.** Column header labels that are either already summed elsewhere or are not number-typed:

```
Line Item, Name, Description, Cost Code, Cost Type, Quantity, Unit,
Unit Cost, Unit Price, Cost, Price, Extended Cost, Extended Price,
Profit, Margin, Retainage, Tax, Status
```

Exact list to be confirmed from a live header inspection during implementation; easy to edit if labels differ in any org.

**Number classifier.** For each non-blacklisted header, sample up to the first 3 loaded line-item rows and apply:

1. Get that column's cell in the row.
2. If the cell contains an `<input>` AND the input has class `text-right` AND `parseFloat(input.value)` is finite → vote "number".
3. If the cell is empty or has no input → abstain.
4. A column needs ≥1 "number" vote and zero disqualifying votes to classify as number-typed.

**Caching.** Detection runs when the MutationObserver re-fires the sync cycle. Results cached in a local `numberCustomFields` array of `{ name, colIndex }` entries. Cache invalidates when the set of header labels changes (columns added/removed/renamed).

**Null case.** Zero detected number custom fields → panel renders exactly like today. No empty subheader, no visual churn.

## Data flow

Extend `selectionMap` entry shape:

```js
selectionMap.set(key, {
  cost: 2392.40,
  price: 3100.00,
  isTbd: false,
  custom: { 'Internal Estimate': 142, 'Crew Days': 3 }
});
```

Only fields with a finite parsed value appear in `custom`. Empty cells are absent (not set to 0 or null).

**Sync (`syncSelectionMap`).** After reading cost/price for a selected row, walk `numberCustomFields` and for each field read the column's input value via the existing `getCellValue` helper. If `parseFloat` yields a finite number, add it to the entry's `custom` object.

**Sum (`renderTotals`).** After the existing Cost/Price/Profit rows:

1. For each detected field, sum `entry.custom[fieldName]` across all selection-map values where the field is present.
2. Skip fields where no selected row had data (the field has no section contribution).
3. Render one line per non-empty field under a "Custom Fields" subheader.

**Lazy unload.** `selectionMap` already persists entries across lazy scroll unloads keyed by row number. The new `custom` object rides along — no extra persistence work.

**Live updates.** Existing MutationObserver on the budget table re-runs sync on DOM churn with ~500ms debounce. Cell edits to custom fields trigger the same re-sync as Cost edits today.

## Rendering

Panel layout:

```
┌─ Selection Totals ─────────────────┐
│  Cost           $34,581.20         │
│  Price          $48,230.00         │
│  Profit         $13,648.80 (28.3%) │
│  Rows           12                 │
├─ Custom Fields ────────────────────┤
│  Internal Estimate   1,428         │
│  Crew Days           87            │
└────────────────────────────────────┘
```

- "Custom Fields" subheader renders only when ≥1 detected field has data across the selection.
- Divider style matches the existing section using the same CSS variables; respects custom theme via the `jt-custom-theme-styles` check that's already in the renderer.
- Values formatted with `toLocaleString('en-US')` for thousands separators. Original decimal places preserved (type "1.5", see "1.5"; not "1.50"). No rounding.

## Edge cases

| Case | Behavior |
|---|---|
| No rows selected | Section doesn't render (unchanged) |
| Rows selected but all custom fields empty | No "Custom Fields" subheader |
| Only some rows have a field's value | Sum what's present; rows without contribute nothing |
| Value is `0` | Included in the sum |
| Value is negative | Summed normally |
| Non-numeric string | `parseFloat` returns NaN, row does not contribute |
| Header row not yet rendered | `getColumnIndices()` returns `{}`, detection returns `[]`, feature silently waits |
| Lazy-unloaded selected row | Values persist in `selectionMap` (existing mechanism) |
| User edits a cell while selected | MutationObserver → re-sync → updated sum within ~500ms |
| User reorders columns | Detection re-runs on next cycle; field names stable, colIndex refreshes |
| User adds/removes custom field | Next cycle picks up new label; stale entries fall out |
| False-positive detection | Displays a wrong sum line. Mitigation: report, add to local blacklist |
| Custom theme active | Section uses same theme variables as existing panel |

## Testing

Manual only. No new test harness — none exists for extension feature modules today and this feature isn't the right vehicle to introduce one.

1. **Happy path.** Budget with one number custom field ("Internal Estimate"). Select 3 line items with values 100, 200, 50. Confirm panel shows `Internal Estimate: 350`.
2. **Empty values.** Select rows where some have the field blank. Confirm sum reflects only filled cells; no console error.
3. **No custom fields.** Budget with zero custom fields. Confirm panel looks identical to current behavior.
4. **Lazy scroll.** Select 5 rows, scroll away until they unload, scroll back. Sum persists.
5. **Edit a value.** Change a custom field value from 100 → 150 while selected. Sum updates within ~500ms.
6. **Feature toggle.** Disable Auto Sum in popup, verify cleanup. Re-enable, verify sums return.
7. **Column reorder.** Drag a custom field column while rows are selected. Values still sum correctly.
8. **Multiple custom fields.** 3 number custom fields simultaneously. All three listed.
9. **Dark mode + custom theme.** Panel renders correctly under each theme variant.
10. **Console noise.** Zero errors/warnings across all cases above.

## Rollout

- Ships under the existing `budgetTools` feature toggle — no new popup entry.
- Ships enabled for anyone who already has Auto Sum on (no separate opt-in).
- CHANGELOG.md entry under `[Unreleased]` → `Improved` → "Auto Sum now sums number-type custom fields when rows are selected."

## Open questions for implementation

- Confirm the exact built-in blacklist labels against a real JT header row before shipping; one typo in "Extended Cost" would cause double-counting.
- Confirm `text-right` is the only class signal for number inputs. If JT introduces a new number column variant that uses a different class, detection needs to widen.
- Decide whether to log detected field names to console (behind a debug flag) for easier user support when false positives surface.
