# Auto Sum — Number Custom Fields Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use `superpowers:executing-plans` to implement this plan task-by-task.

**Goal:** Extend the existing Auto Sum (MASS BUDGET ACTIONS selection-totals panel) to also sum number-type custom field columns when budget line items are selected.

**Architecture:** Single-file change to `JT-Tools-Master/features/budget-tools.js`. Adds (1) a detection helper that classifies non-built-in columns as number-typed using a `text-right` + `parseFloat` voting heuristic, (2) extends the existing `selectionMap` entry shape with a `custom: { fieldName: value }` object, (3) adds a new "Custom Fields" subsection to the panel renderer that appears only when at least one detected number field has data across the selection.

**Tech Stack:** Plain JavaScript (no bundler), Chrome Extension Manifest V3, IIFE module pattern. No new dependencies. No test framework — extension feature modules are manually tested by reloading at `chrome://extensions` and exercising the UI on app.jobtread.com.

**Design doc:** `docs/plans/2026-04-17-auto-sum-custom-fields-design.md`

**Pre-flight:**
- Worktree is optional but recommended. The skill `superpowers:using-git-worktrees` covers setup. For this small single-file change, a feature branch on the current repo is also fine.
- Load the unpacked extension from `JT-Tools-Master/` at `chrome://extensions` before starting. Turn on Auto Sum in the popup.
- Open a budget in JobTread that has at least one number-type custom field column (create a temporary one named "Internal Estimate" on cost items if needed, then populate 3–5 rows with numeric values).
- Keep the Chrome DevTools console open on `app.jobtread.com` to catch errors as each step lands.

**TDD adaptation:** This codebase has no unit test harness for feature modules. Per-step verification uses the manual testing rhythm: reload extension → repro the scenario → observe console + DOM → commit.

---

### Task 1: Add blacklist constant and detection cache state

**Files:**
- Modify: `JT-Tools-Master/features/budget-tools.js:6-20` (top of IIFE, alongside existing state vars)

**Step 1: Add the blacklist set and detection cache**

Open `JT-Tools-Master/features/budget-tools.js`. Find the IIFE state section around line 10-20 where `selectionMap` is declared. Immediately below it, add:

```javascript
  // Columns we already sum elsewhere (Cost/Price in the main panel) or that
  // aren't number-typed. Detection skips these — anything NOT in this set is
  // a candidate for number-custom-field classification.
  const BUILTIN_COLUMN_LABELS = new Set([
    'Line Item',
    'Name',
    'Description',
    'Cost Code',
    'Cost Type',
    'Quantity',
    'Unit',
    'Unit Cost',
    'Unit Price',
    'Cost',
    'Price',
    'Extended Cost',
    'Extended Price',
    'Profit',
    'Margin',
    'Retainage',
    'Tax',
    'Status',
  ]);

  // Cached number-custom-field classification. Invalidates when the set of
  // header labels changes (user adds/removes/renames a column).
  // Shape: { signature: string, fields: [{ name: string, colIndex: number }] }
  let numberCustomFieldsCache = { signature: null, fields: [] };
```

**Step 2: Verify the file still loads**

Reload the extension at `chrome://extensions`. Navigate to any JobTread page. Open DevTools console.

Expected: no errors. The feature hasn't been wired in yet, so there's no visible change. The BudgetTools module should still log `BudgetTools: Initialized` if Auto Sum is enabled.

**Step 3: Commit**

```bash
git add JT-Tools-Master/features/budget-tools.js
git commit -m "$(cat <<'EOF'
refactor(budget-tools): add BUILTIN_COLUMN_LABELS + detection cache

Groundwork for extending Auto Sum to cover number custom fields.
No behavior change yet.
EOF
)"
```

---

### Task 2: Implement the `detectNumberCustomFields()` helper

**Files:**
- Modify: `JT-Tools-Master/features/budget-tools.js` — add a new function right after `getColumnIndices()` (currently ends around line 60)

**Step 1: Add the detection function**

Find the closing brace of `getColumnIndices()`. Immediately below it, add:

```javascript
  /**
   * Detect which non-built-in columns are number-typed custom fields.
   *
   * Heuristic: for each header label NOT in BUILTIN_COLUMN_LABELS,
   * sample up to the first 3 loaded non-group rows. A column is classified
   * as "number" when:
   *   - ≥1 sample row has an <input> with class `text-right` whose value
   *     parses as a finite number, AND
   *   - no sample row has a non-empty input that fails the above check
   *
   * Results are cached by header-signature so repeated sync cycles don't
   * re-scan the DOM.
   *
   * @param {Record<string, number>} colIndices - label → column-child-index map
   * @returns {Array<{name: string, colIndex: number}>}
   */
  function detectNumberCustomFields(colIndices) {
    const labels = Object.keys(colIndices).sort();
    const signature = labels.join('|');
    if (numberCustomFieldsCache.signature === signature) {
      return numberCustomFieldsCache.fields;
    }

    const candidates = labels.filter(l => !BUILTIN_COLUMN_LABELS.has(l));
    if (candidates.length === 0) {
      numberCustomFieldsCache = { signature, fields: [] };
      return [];
    }

    // Collect first 3 loaded, non-group rows for sampling
    const allRows = Array.from(document.querySelectorAll('.flex.min-w-max'));
    const sampleRows = [];
    for (const row of allRows) {
      if (sampleRows.length >= 3) break;
      if (getRowKey(row) && !isGroupRow(row)) sampleRows.push(row);
    }

    const fields = [];
    for (const name of candidates) {
      const colIndex = colIndices[name];
      if (colIndex === undefined) continue;

      let voteYes = 0;
      let disqualified = false;

      for (const row of sampleRows) {
        const cell = row.children[colIndex];
        if (!cell) continue;
        const input = cell.querySelector('input');
        if (!input) continue; // abstain — cell has no input
        const raw = input.value;
        if (raw === '' || raw == null) continue; // empty — abstain
        const hasTextRight = input.classList.contains('text-right');
        const parsed = parseFloat(raw);
        if (hasTextRight && Number.isFinite(parsed)) {
          voteYes++;
        } else {
          disqualified = true;
          break;
        }
      }

      if (!disqualified && voteYes >= 1) {
        fields.push({ name, colIndex });
      }
    }

    numberCustomFieldsCache = { signature, fields };
    return fields;
  }
```

**Step 2: Verify syntax by reloading the extension**

Reload the extension. Open any budget in JT with at least one number custom field visible. Open DevTools console.

In the console, manually invoke detection (replace `<colIndices>` with a real call):

```javascript
// Paste in the DevTools console while on a budget page:
(() => {
  const headerRow = Array.from(document.querySelectorAll('.flex.min-w-max')).find(r =>
    !r.querySelector('textarea') && r.textContent.includes('Extended Cost')
  );
  const colIndices = {};
  Array.from(headerRow.children).forEach((cell, i) => {
    const t = cell.innerText?.trim();
    if (t) colIndices[t] = i;
  });
  console.table(colIndices);
})();
```

Expected: see the label → index table in the console, including your custom field label. Note the names of built-in columns that appear — if any differ from BUILTIN_COLUMN_LABELS in Task 1 (e.g. the column is called "Cost Codes" plural, not "Cost Code"), update BUILTIN_COLUMN_LABELS before continuing.

**Step 3: Dry-run the detection function**

The function isn't wired up yet, but we can invoke it manually from the console to verify it works. In DevTools console:

```javascript
// Paste this to test the detector directly. Replace the custom field name with your real one.
(() => {
  const allVisibleRows = document.querySelectorAll('.flex.min-w-max');
  console.log('Visible rows:', allVisibleRows.length);
  // Module-internal detector isn't exposed; for now we just verify the page
  // has the expected DOM shape.
})();
```

Expected: "Visible rows" logs a positive number. We'll verify actual detection in Task 3 once it's wired in.

**Step 4: Commit**

```bash
git add JT-Tools-Master/features/budget-tools.js
git commit -m "$(cat <<'EOF'
feat(budget-tools): detectNumberCustomFields() helper

Heuristic detector: skips BUILTIN_COLUMN_LABELS, votes yes on columns
whose sample rows have text-right inputs with finite parsed values,
disqualifies on any non-empty input that fails. Cached by header
signature. Not yet wired into the sync cycle.
EOF
)"
```

---

### Task 3: Wire detection into sync + extend selectionMap with `custom` values

**Files:**
- Modify: `JT-Tools-Master/features/budget-tools.js` — `syncSelectionMap()` function (currently lines 94-133)

**Step 1: Update `syncSelectionMap` to run detection and populate entries**

Locate the `syncSelectionMap` function. Replace its body with the version below. The diff is:
1. Call `detectNumberCustomFields(colIndices)` once at the top and reuse for all rows.
2. When building the entry for a selected row, add a `custom: {}` object and populate it with parsed values for each detected field.

Replace the existing function with:

```javascript
  function syncSelectionMap(colIndices) {
    const numberCustomFields = detectNumberCustomFields(colIndices);
    const allVisibleRows = document.querySelectorAll('.flex.min-w-max');

    for (const row of allVisibleRows) {
      const key = getRowKey(row);
      if (!key) continue;

      // Always remove groups from the map — they're aggregate rows
      if (isGroupRow(row)) {
        selectionMap.delete(key);
        continue;
      }

      const isSelected = Array.from(row.children).some(c => c.className?.includes?.('bg-blue-100'));

      if (isSelected) {
        const costRaw = getCellValue(row.children[colIndices['Extended Cost']]);
        const priceRaw = getCellValue(row.children[colIndices['Extended Price']]);

        const custom = {};
        for (const { name, colIndex } of numberCustomFields) {
          const raw = getCellValue(row.children[colIndex]);
          if (raw === '') continue;
          const parsed = parseFloat(raw);
          if (Number.isFinite(parsed)) custom[name] = parsed;
        }

        selectionMap.set(key, {
          cost: parseCurrency(costRaw),
          price: parseCurrency(priceRaw),
          isTbd: costRaw === 'TBD',
          custom,
        });
      } else {
        // Visible but not selected — user deselected, not a lazy unload
        selectionMap.delete(key);
      }
    }
  }
```

**Step 2: Reload the extension and verify sync state**

Reload at `chrome://extensions`. Open a budget. Select 2–3 line items that have values in your number custom field.

In DevTools console, inspect what got captured. Since `selectionMap` is module-local, we'll check via a probe:

```javascript
// In DevTools console on the budget page:
(() => {
  // Trigger a sync cycle, then probe the internal map via the already-rendered panel
  // or by inspecting a known side-effect. The easiest check: the panel shows cost/price,
  // which confirms the selection pipeline is working. For custom values we'll verify
  // in Task 4 once they render. For now, just confirm no errors.
  console.log('Console should show no red errors. If clean, sync is working.');
})();
```

Expected: zero errors in console. The MASS BUDGET ACTIONS panel still shows Extended Cost and Extended Price totals as it did before. No visible "Custom Fields" section yet — that arrives in Task 4.

**Step 3: Commit**

```bash
git add JT-Tools-Master/features/budget-tools.js
git commit -m "$(cat <<'EOF'
feat(budget-tools): extend selectionMap entries with custom field values

syncSelectionMap now runs detectNumberCustomFields once per cycle and
populates entry.custom = { fieldName: parsedValue } for each detected
number field on each selected row. Renderer still ignores these — the
panel looks unchanged. Next commit adds the Custom Fields subsection.
EOF
)"
```

---

### Task 4: Render the Custom Fields subsection in the panel

**Files:**
- Modify: `JT-Tools-Master/features/budget-tools.js` — `renderTotals()` function (currently lines 210-295)

**Step 1: Add a number-formatting helper**

Find the `formatCurrency` function (around line 147). Immediately below it, add:

```javascript
  /**
   * Format a number for display in custom-field rows. Uses locale thousands
   * separators and caps fractional digits at 4 to avoid floating-point noise
   * (0.1 + 0.2 = 0.30000000000000004 → "0.3").
   */
  function formatNumber(n) {
    if (!Number.isFinite(n)) return String(n);
    return n.toLocaleString('en-US', { maximumFractionDigits: 4 });
  }
```

**Step 2: Add custom-field summing + rendering at the end of `renderTotals`**

Find the end of `renderTotals`, right before `el.appendChild(grid);` on what is currently line 294. Keep `el.appendChild(grid);` in place. BELOW it, inside the function (before the closing `}`), add:

```javascript

    // ─── Custom Fields section ──────────────────────────────────────────
    // Aggregate every number custom field across the persisted selection.
    // A field shows up only when at least one selected row had a value.
    const customSums = Object.create(null);
    for (const entry of selectionMap.values()) {
      if (!entry.custom) continue;
      for (const [name, val] of Object.entries(entry.custom)) {
        customSums[name] = (customSums[name] ?? 0) + val;
      }
    }
    const customNames = Object.keys(customSums);

    if (customNames.length > 0) {
      const section = document.createElement('div');
      section.style.cssText =
        `margin-top:10px;padding-top:8px;border-top:1px solid ${t.border};`;

      const subheader = document.createElement('div');
      subheader.style.cssText =
        `font-size:11px;font-weight:700;color:${t.heading};` +
        `text-transform:uppercase;letter-spacing:0.05em;margin-bottom:6px;`;
      subheader.textContent = 'Custom Fields';
      section.appendChild(subheader);

      const customGrid = document.createElement('div');
      customGrid.style.cssText = 'display:flex;flex-direction:column;gap:4px;';

      // Sort alphabetically for stable display order across cycles
      for (const name of customNames.sort()) {
        const rowEl = document.createElement('div');
        rowEl.style.cssText = 'display:flex;justify-content:space-between;align-items:baseline;';

        const label = document.createElement('span');
        label.style.cssText = `font-size:12px;color:${t.heading};`;
        label.textContent = name;

        const value = document.createElement('span');
        value.style.cssText = `font-size:12px;font-weight:600;color:${t.text};`;
        value.textContent = formatNumber(customSums[name]);

        rowEl.appendChild(label);
        rowEl.appendChild(value);
        customGrid.appendChild(rowEl);
      }

      section.appendChild(customGrid);
      el.appendChild(section);
    }
```

**Step 3: Reload the extension and verify rendering**

Reload at `chrome://extensions`. Open a budget page with at least one number custom field. Select 3 line items that have known values in that field.

Expected:
- MASS BUDGET ACTIONS panel shows Extended Cost / Extended Price / Profit as before
- Below Profit there is a horizontal divider and a "CUSTOM FIELDS" subheader
- Each detected number custom field is listed on its own row with the sum across the selected rows
- Summed value has locale thousands separators (e.g. `1,428`) and no trailing floating-point noise
- Zero console errors

Now test the "no data" cases:
- Deselect all rows. Panel empties out. No orphan "Custom Fields" section.
- Select rows where the custom field is entirely blank on those rows. Panel shows Cost/Price but no "Custom Fields" section.
- Select rows where some have the field filled and some don't. Panel sums only the filled rows.

**Step 4: Commit**

```bash
git add JT-Tools-Master/features/budget-tools.js
git commit -m "$(cat <<'EOF'
feat(budget-tools): render Custom Fields subsection in selection panel

Aggregates entry.custom across selectionMap and renders one line per
field under a Custom Fields subheader. Section only appears when at
least one detected number field has data in the selection. Uses
formatNumber() for locale thousands separators and float-noise trim.
EOF
)"
```

---

### Task 5: Edge cases, cleanup reset, CHANGELOG, final verification

**Files:**
- Modify: `JT-Tools-Master/features/budget-tools.js` — `cleanup()` function (currently lines 383-397)
- Modify: `CHANGELOG.md` — under `[Unreleased]` → `Improved`

**Step 1: Reset detection cache in `cleanup()`**

Find the `cleanup()` function. Add a single line to reset the cache so that disabling then re-enabling the feature starts fresh:

```javascript
  function cleanup() {
    if (!isActive) return;
    console.log('BudgetTools: Cleaning up...');

    if (observer) { observer.disconnect(); observer = null; }
    if (clickHandler) { document.removeEventListener('click', clickHandler, true); clickHandler = null; }
    clearTimeout(debounceTimer);

    if (injectedPanel && injectedPanel.parentElement) injectedPanel.remove();
    injectedPanel = null;
    selectionMap.clear();
    numberCustomFieldsCache = { signature: null, fields: [] };
    isActive = false;

    console.log('BudgetTools: Cleaned up');
  }
```

**Step 2: Run the full manual test matrix**

Reload the extension. Work through each case from the design doc's Testing section in order. Record which ones pass. Fix any that fail before continuing.

1. **Happy path** — 3 rows selected with field values 100, 200, 50 → panel shows `Internal Estimate  350`
2. **Empty values** — select rows where some have the field blank → sum reflects only filled cells, no console error
3. **No custom fields** — open a budget with zero number custom fields → panel looks identical to before this change (no empty subheader)
4. **Lazy scroll** — select 5 rows, scroll until they unload, scroll back → sums persist
5. **Edit a value** — change a field value 100 → 150 while row is selected → sum updates within ~500ms
6. **Feature toggle** — disable Auto Sum in popup → panel and totals disappear → re-enable → sums reappear
7. **Column reorder** — drag a custom field column to a different position while rows selected → sum stays correct (field name unchanged, colIndex refreshes on next cycle)
8. **Multiple custom fields** — 3 number custom fields simultaneously → all three listed, alphabetical order
9. **Dark mode + custom theme** — toggle each → panel colors update, no visual bugs
10. **Console noise** — zero errors / warnings throughout

**Step 3: Update CHANGELOG.md**

Open `CHANGELOG.md`. Find the `## [Unreleased]` section. Under `### Improved` (add the subsection if it doesn't exist), append:

```markdown
#### Auto Sum — Number Custom Fields
- Auto Sum (MASS BUDGET ACTIONS panel) now sums number-type custom field columns whenever line items are selected, not just the built-in Cost/Price columns.
- Fields are auto-detected by heuristic (`text-right` input + finite numeric value on sampled rows). Only columns classified as number-typed are summed — text/date/yes-no custom fields are ignored.
- A new "Custom Fields" subsection appears below Cost/Price/Profit whenever at least one detected field has values in the selection. Each field is summed on its own line with the actual field name. Sums format with locale thousands separators and trim floating-point noise.
- Built-in columns (Cost, Price, Quantity, Unit, etc.) are blacklisted from detection so they never appear twice in the panel.
- Values from lazy-unloaded rows persist across scroll, same mechanism the existing Cost/Price totals use.
- Enables workflows like "internal estimate vs. actual" comparison that previously required exporting the budget to a spreadsheet — see the design doc at `docs/plans/2026-04-17-auto-sum-custom-fields-design.md`.
```

**Step 4: Final commit with CHANGELOG + cleanup reset**

```bash
git add JT-Tools-Master/features/budget-tools.js CHANGELOG.md
git commit -m "$(cat <<'EOF'
feat(budget-tools): custom field sums — cleanup reset + CHANGELOG

- cleanup() clears numberCustomFieldsCache so disable/enable starts fresh
- CHANGELOG entry under Improved with full feature description

Closes the final loose end on the Auto Sum number-custom-fields feature.
Manual test matrix passed 10/10 per design doc.
EOF
)"
```

**Step 5: Verification**

Final sanity check before handoff:

```bash
# Ensure no uncommitted changes
git status
# Should show: working tree clean

# Review the feature commits
git log --oneline -6
# Expect 5 commits from Tasks 1–5 plus any preceding
```

The feature is now ready to ship.

---

## Notes for the implementer

- This plan writes directly to the existing `budget-tools.js` — do NOT create a new file, new module, or new feature toggle. The feature rides under the existing `budgetTools` toggle in the popup.
- If BUILTIN_COLUMN_LABELS doesn't match the real JT labels on a particular budget (e.g. JT has relabeled "Cost Code" to "Code"), detection will misclassify that column as a custom field. Test Task 2's DevTools probe against a real header before shipping.
- `formatNumber` uses `'en-US'` locale explicitly. This matches the rest of the codebase's formatting. If we ever support i18n, revisit.
- The sort for display order (`.sort()` on customNames) is lexicographic. That's deliberate — field names don't carry an inherent order from JT, so alphabetical is the most predictable stable order.
- If the user reports a false-positive detection (e.g. a phone-number field that's `text-right` and parses), adding that specific field name to BUILTIN_COLUMN_LABELS is the quick mitigation. The longer-term fix would be an Approach 3 per-field UI, but we're deliberately deferring that until we see real failure modes.
