# Compact Budget Rows — Feature Design

- **Date:** 2026-06-13
- **Status:** Design approved — pending implementation plan
- **Branch:** `claude/compact-budget-rows` (off `main`; independent of the tweaks-authoring work)

## Origin

Promotes a proven org tweak into a built-in feature. The Titus Contracting Inc `org_required` tweak **"Compact budget + hover reveal"** (id `e2c4b7a1-…`, scope `/budget`) is pure CSS, no DOM actions — a clean candidate for a first-class toggle.

## What it does

On the budget page, collapse every row to a single line (clip overflow + `nowrap`), truncate group-header rows with an ellipsis, and **expand a row to its full content height on hover**.

## Decisions (approved)

- **Free** — not added to `PRO_FEATURES` in `services/license.js`. Consistent with the other budget-table CSS features (Budget Hierarchy Shading, Freeze Header).
- **Off by default** — it's a noticeable layout change, so opt-in (`defaults.js` → `compactBudgetRows: false`).
- **Zero-match warning** — since a built-in feature has no auto-disable safety net (unlike the tweak engine), when active on a budget page the module checks for `.group\/row` elements and `console.warn`s if none match, so a future JobTread markup change surfaces in the console/support instead of silently no-op'ing.

## Architecture

Standard CSS-feature pattern (same shape as `budget-hierarchy.js` / `freeze-header.js`):

- **`features/compact-budget-rows.js`** — IIFE `CompactBudgetRowsFeature` with `init()` / `cleanup()` / `isActive()`.
  - `init()` injects a `<link>` to `styles/compact-budget-rows.css`, wires SPA gating, and evaluates the current page.
  - **SPA-safe `/budget` gating:** rather than gate on URL once at load (breaks on SPA nav — see the project's known SPA pattern), the module toggles `documentElement.classList` `jt-compact-budget-rows` on when `location.pathname` includes `/budget` and off otherwise, re-evaluating on `pushState`/`replaceState`/`popstate` (monkey-patch + restore on cleanup, exactly as the tweak engine does). The CSS hangs off `html.jt-compact-budget-rows` so it can never bleed onto other views that reuse `.group/row`.
  - **Zero-match warning:** on first activation per budget page, if `document.querySelectorAll('.group\\/row').length === 0`, log `console.warn('CompactBudgetRows: no budget rows matched — JobTread may have changed its markup')`. One-shot per activation, no user-facing UI.
  - `cleanup()` removes the `<link>`, removes the html class, restores the `history` patches, and removes all listeners — full reversal of `init()`.
- **`styles/compact-budget-rows.css`** — the tweak's CSS with the `.jt-tweak-{id}` auto-scope prefix stripped and re-scoped under `html.jt-compact-budget-rows`:

```css
html.jt-compact-budget-rows .group\/row .shrink-0 {
  overflow: hidden !important;
  white-space: nowrap !important;
}
html.jt-compact-budget-rows .group\/row .shrink-0 .overflow-hidden {
  white-space: nowrap !important;
  overflow: hidden !important;
}
html.jt-compact-budget-rows .bg-gray-100.font-bold .grow .inline-block {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  max-width: 100%;
}
html.jt-compact-budget-rows .group\/row:hover .shrink-0 .overflow-hidden {
  white-space: pre-wrap !important;
  overflow: visible !important;
}
```

## Wiring (the project's documented 5-step feature-add)

1. `features/compact-budget-rows.js` (above).
2. `manifest.json` — add the script to `content_scripts[0].js[]` (with the other feature modules) and `styles/compact-budget-rows.css` to `web_accessible_resources[0].resources[]`. Permissions untouched.
3. `content.js` — register `compactBudgetRows` in `featureModules` (init/cleanup on its setting), following the existing entries.
4. `popup/popup.html` — a toggle in the Features list: **"Compact Budget Rows"** — *"Collapse budget rows to one line; hover a row to expand it to full height. Budget pages only."* (free — no premium badge).
5. `utils/defaults.js` (+ `background/service-worker.js` defaults if separate) — `compactBudgetRows: false`.

## Testing

- `tests/features/lifecycle.test.js` — add a `CompactBudgetRowsFeature` row (init → `isActive()` true → cleanup → false), using a fixture with `document.body`.
- `npm run eval:full` — all gates stay green (off by default → no visual-regression change; banned-colors unaffected; lint clean).

## Out of scope (mature later — per "I want to mature this feature")

- Configurable modes (compact-only, or hover-expand without compacting).
- Selector hardening / resilience to JobTread Tailwind class renames beyond the zero-match warning.
- Applying outside `/budget`.
- A CHANGELOG entry will be added at implementation time (user-visible feature → `[Unreleased] → Added`).
