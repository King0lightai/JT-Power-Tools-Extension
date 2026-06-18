# Budget Row Highlight — Design Spec

**Date:** 2026-06-17
**Status:** Approved (brainstorm) — ready for implementation plan
**Tier:** Essential (paid) — off by default

## Summary

A new budget feature: when a budget row contains one of the nine circle emojis,
the whole row is tinted that color. Users put the emoji in a custom field (or
anywhere in the row) and get a readable, color-coded highlight — a workaround for
JobTread's lack of native row highlighting.

Detected emojis: 🔴 🟠 🟡 🟢 🔵 🟣 🟤 ⚫ ⚪

## Motivation

JobTread budgets have no way to visually flag/categorize rows. Users already
improvise with emojis in fields; this turns that into an at-a-glance color band
across the row. It sits alongside the existing **Budget Hierarchy Shading**
feature (same row-tinting, theme-aware machinery).

## Behavior

### Detection
- Scope: **anywhere in the row**. Scan each budget row's cell values — both text
  content and `<input>` values — for any of the 9 circle emojis.
- Circle emojis effectively never occur in budget data by accident, so a
  whole-row scan is safe (no dedicated/“magic” field required).
- **Precedence within a row:** if multiple circle emojis are present, the first
  by this fixed order wins: 🔴 🟠 🟡 🟢 🔵 🟣 🟤 ⚫ ⚪.
- The emoji character stays visible in its cell — it is the user's control.

### Appearance
- A **soft, semi-transparent tint** fills the entire row (a highlighter wash),
  chosen so text stays readable.
- **Theme-adaptive** (reusing Budget Hierarchy's active-theme detection):
  - Light mode → pale pastel wash.
  - Dark Mode / Custom Theme → muted, darker wash over the dark background.
- Emoji → hue map: 🔴 red · 🟠 orange · 🟡 amber · 🟢 green · 🔵 blue ·
  🟣 purple · 🟤 brown · ⚫ dark-grey · ⚪ light-grey. (⚫/⚪ are neutral greys —
  distinguishable washes, not pure black/white.)
- The tint covers **all** cells of the row, including the sticky number/name
  columns (otherwise those stay white/unthemed).

### Scope
- Budget pages only (`/jobs/<id>/budget`), matching Budget Hierarchy Shading.

## Architecture

New self-contained feature module `features/budget-row-highlight.js`
(IIFE with `init()` / `cleanup()` / `isActive()`), following the established
pattern.

- **`detectRowColor(text)`** — pure function: given a string, return the winning
  color key (or `null`). Unit-tested in isolation; exposed for tests like
  `BudgetTools._computeLeafSelections`.
- **Theme detection** — reuse the same approach as Budget Hierarchy
  (`getActiveTheme()` by checking for injected dark/custom theme `<style>` IDs).
- **Tint stylesheet** — inject one `<style>` defining 9 classes
  (e.g. `.jt-rowhl-red` … `.jt-rowhl-white`) whose colors are computed for the
  active theme. Rebuild the stylesheet if the theme changes.
- **Apply loop** — scan visible rows; for each row with a detected color, add the
  matching class to every cell. A `MutationObserver` (with the
  disconnect/reconnect or `isApplying` guard the other budget features use)
  re-applies after React re-renders, cell edits, scroll, and lazy-load. Debounced.
- **Cleanup** — remove the stylesheet, strip the classes, disconnect the observer
  and any listeners (full init/cleanup symmetry).

### Precedence / conflicts
- **Budget Hierarchy Shading:** emoji tint overrides hierarchy shading for that
  row (explicit user intent). Achieved via class specificity / apply order.
- **Selection:** JobTread's blue `bg-blue-50` selection highlight still wins
  while a row is selected — do not fight selection styling.
- Both Budget Hierarchy and this feature may be enabled simultaneously.

### Edge cases
- Collapsed groups / off-screen rows: tinted when they load (observer-driven).
- Group rows: tinted the same way if they carry an emoji (no special-casing).
- Removing/changing the emoji: re-scan clears or updates the tint.

## Tier & wiring

**Essential** paid feature, **off by default**. Full toggle wiring (the
checklist that prevents silent no-ops):
1. `features/budget-row-highlight.js` + `manifest.json` (`content_scripts.js[]`
   and, if a CSS file is used, `web_accessible_resources`).
2. `content.js` — `featureModules` entry + inline-fallback defaults line.
3. `utils/defaults.js` — `DEFAULT_SETTINGS` + `FEATURE_CATEGORIES`
   (`appearanceThemes`) + bump the popup category count.
4. `services/license.js` — add to **`ESSENTIAL_FEATURES`**.
5. `popup/popup.html` — `.feature-item` toggle + category count.
6. `popup/popup.js` — `loadSettings` `setCheckbox`, `getCurrentSettings`
   `getCheckboxValue`, `FEATURE_TOGGLE_IDS`, inline defaults fallback.
7. `tests/features/lifecycle.test.js` — add a row.

## Testing
- Unit: `detectRowColor()` — each emoji maps correctly, precedence order, no-match
  returns null, ignores non-circle emojis.
- Lifecycle: init → active → cleanup → no orphaned listeners/observers/intervals.
- Live: Martinez budget — tint a row via a custom field in light, Dark, and
  Custom theme; verify sticky cells tint, readability, re-tint on edit, and that
  it overrides hierarchy shading but yields to selection.
- `npm run eval` gates stay green.

## Non-goals (YAGNI)
- No configurable/custom color palette — the 9 fixed circle emojis only.
- No non-budget pages (schedule, tables) in this pass.
- No persistence/storage of highlights — purely derived from the live emoji.
- No legend/UI beyond the tint itself.
