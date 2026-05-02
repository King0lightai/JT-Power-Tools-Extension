# v4.8.3 Auto-Derived Secondary Color + Icon Polish + Exclusions — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Compute a complementary `secondary` token from primary in OKLCH space and re-wire JT's `bg-gray-700/800/hover/active` Tailwind classes to use it (with profile-icon exclusion); delete the 5 unscoped `.text-{color}-500` rules so JT's standalone status indicators keep their default vivid colors; remove the redundant `.crown` checkmark on selected preset cards and the decorative `.pick-tip` eyedropper on the Primary color cell.

**Architecture:** Five commits on `claude/v4.8.3-secondary-color` (off `main` at v4.8.2). All work scoped to `palette.js`, `rgb-theme.js`, `popup.html`, `popup.css`, manifests, CHANGELOG. Zero schema migration, zero new UI inputs — existing custom themes auto-upgrade on next palette regeneration. Smoke test via `mcp__Claude_Preview` MCP at the end.

**Tech Stack:** Plain JavaScript (OKLCH math via the existing `palette.js` helpers), CSS attribute-selector exclusions, vanilla popup. Same stack as v4.8.x.

**Design reference:** [docs/plans/2026-05-02-secondary-color-design.md](2026-05-02-secondary-color-design.md)

---

## Task 1: palette.js — derive `secondary` token

**Files:**
- Modify: `JT-Tools-Master/features/rgb-theme-modules/palette.js`

**Step 1: Locate the `pri` block in `generatePalette()`**

Run:
```bash
grep -n "const pri = {" JT-Tools-Master/features/rgb-theme-modules/palette.js
```

Expected: one match around line 195. The `pri` block builds the primary token's variants (base, hover, active, selection, etc.).

**Step 2: Add a `secondary` block immediately after `pri`**

Use Read on `palette.js` to see the `pri` block's exact closing context. The block ends with `};` and is followed by a blank line, then `const states = { ... };`.

Use Edit to insert the secondary derivation between `};` (closing `pri`) and `const states`:

```js
    const pri = {
      base:   primary,
      hover:  shiftL(primary, bgIsDark ? +0.05 : -0.04),
      active: shiftL(primary, bgIsDark ? +0.10 : -0.08),
      selection:       mix(primary, background, 0.85),
      selectionHover:  mix(primary, background, 0.78),
      selectionStrong: mix(primary, background, 0.7),
    };

    // v4.8.3 — secondary auto-derived from primary in OKLCH space.
    // Complementary hue (+180°) at 85% chroma + same lightness:
    //   - Same L → secondary buttons sit at the same visual weight as primary buttons.
    //   - 85% C → doesn't compete with primary for attention.
    //   - +180° h → maximum perceptual contrast.
    //   - For low-chroma primaries (Slate / Charcoal), C * 0.85 stays low,
    //     so secondary stays gracefully neutral instead of injecting jarring color.
    const primaryOklch = hexToOklch(primary);
    const secondaryBase = oklchToHex({
      L: primaryOklch.L,
      C: primaryOklch.C * 0.85,
      h: (primaryOklch.h + 180) % 360,
    });
    const secondary = {
      base:   secondaryBase,
      hover:  shiftL(secondaryBase, bgIsDark ? +0.05 : -0.04),
      active: shiftL(secondaryBase, bgIsDark ? +0.10 : -0.08),
    };

    const states = {
```

**Step 3: Add `secondary` to the returned palette object**

Find the `return {` block at the end of `generatePalette()`. It currently looks like:

```js
    return {
      meta: { ... },
      isDark: bgIsDark,
      primary: pri,
      background: bg,
      text: tx,
      border,
      states,
      scrollbar,
      alerts,
      shadows,
    };
```

Use Edit to add `secondary` between `primary: pri,` and `background: bg,`:

old:
```js
      isDark: bgIsDark,
      primary: pri,
      background: bg,
```

new:
```js
      isDark: bgIsDark,
      primary: pri,
      secondary,
      background: bg,
```

**Step 4: Smoke-test via Node**

Run:
```bash
node -e "const P = require('./JT-Tools-Master/features/rgb-theme-modules/palette.js'); const p = P.generatePalette({primary:'#FE4C0D', background:'#FFFBF4', text:'#1A1410'}); console.log('secondary keys:', Object.keys(p.secondary)); console.log('Field Day secondary.base:', p.secondary.base); console.log('Field Day secondary.hover:', p.secondary.hover); console.log('Field Day secondary.active:', p.secondary.active);"
```

Expected output (hexes are illustrative — actual values depend on OKLCH math):
```
secondary keys: [ 'base', 'hover', 'active' ]
Field Day secondary.base: #00...     (some teal/blue tone)
Field Day secondary.hover: #00...    (slightly darker)
Field Day secondary.active: #00...   (even darker)
```

Verify `p.secondary.base` is NOT the same as `p.primary.base`. They should be visibly different hues (one is orange, one should be in the cyan/teal family).

Run a second smoke check with Slate (low-chroma primary):
```bash
node -e "const P = require('./JT-Tools-Master/features/rgb-theme-modules/palette.js'); const p = P.generatePalette({primary:'#64748B', background:'#F1F5F9', text:'#1E293B'}); console.log('Slate primary.base:', p.primary.base); console.log('Slate secondary.base:', p.secondary.base);"
```

Expected: Slate's secondary should still be near-neutral (low chroma in → low chroma out). Hex values close to grayish, not jarringly colored.

**Step 5: Commit**

```bash
git add JT-Tools-Master/features/rgb-theme-modules/palette.js
git commit -m "feat(palette): derive secondary token from primary in OKLCH space

Adds palette.secondary.{base, hover, active} computed by:
  L = primary.L              (same lightness — equal visual weight)
  C = primary.C * 0.85       (15% less chroma — doesn't compete with primary)
  h = (primary.h + 180) % 360 (complementary hue — maximum pop)

For low-chroma primaries (Slate/Charcoal), C * 0.85 stays low so
secondary stays gracefully neutral instead of injecting jarring color.
hover/active variants use the same shiftL pattern as primary.hover/active
so secondary buttons feel structurally identical to primary buttons on
interaction.

This is the engine half of v4.8.3 secondary color support. Wiring into
rgb-theme.js's CSS template comes next; existing custom themes auto-
upgrade on the next generatePalette() call (no schema migration, no JS
storage change).

See docs/plans/2026-05-02-secondary-color-design.md §A"
```

---

## Task 2: rgb-theme.js — wire secondary into CSS + delete unscoped status text rules

**Files:**
- Modify: `JT-Tools-Master/features/rgb-theme.js`

This task does two changes to the CSS template:

A. **Re-wire `bg-gray-700/800/hover/active`** to use `${p.secondary.*}` instead of `${p.background.strong}` (or being unstyled), with `:not([style*="background-image"])` exclusion to skip profile icons.

B. **Delete the 5 unscoped `.text-{color}-500` rules** at lines 502-506 so JT's standalone status indicators keep their vivid defaults. Keep the SCOPED `.bg-{color}-50 .text-{color}-500` rules at lines 514-518 (alert text harmonization stays).

### Step 1: Locate the `.bg-gray-700` rule

Run:
```bash
grep -n "bg-gray-700\|bg-gray-800\|bg-gray-900" JT-Tools-Master/features/rgb-theme.js
```

Expected: matches around line 476 (`.bg-gray-700 { background-color: ${p.background.strong} !important; }`) and a comment around line 648 saying `bg-gray-800` and `bg-gray-900` are NOT overridden.

### Step 2: Replace the `.bg-gray-700` rule and add the new gray-800/hover/active rules

Use Edit on `rgb-theme.js`. The current single rule:

```css
      .bg-gray-700 {
        background-color: ${p.background.strong} !important;
      }
```

becomes a four-rule block:

old:
```js
      .bg-gray-700 {
        background-color: ${p.background.strong} !important;
      }
```

new:
```js
      /* v4.8.3 — secondary action buttons (Item / Group / chip-style buttons in JT).
         The :not([style*="background-image"]) exclusion guarantees profile-icon
         elements (which use inline background-image: url(...) but no .bg-gray-* class today)
         are never recolored, even if a future JT markup change adds .bg-gray-* to them. */
      .bg-gray-700:not([style*="background-image"]) {
        background-color: ${p.secondary.base} !important;
        color: white !important;
      }
      .bg-gray-800:not([style*="background-image"]) {
        background-color: ${p.secondary.hover} !important;
        color: white !important;
      }
      .hover\\:bg-gray-800:hover:not([style*="background-image"]) {
        background-color: ${p.secondary.hover} !important;
      }
      .active\\:bg-gray-900:active:not([style*="background-image"]) {
        background-color: ${p.secondary.active} !important;
      }
```

Note: `\\:` is the escaped version of `:` in Tailwind class names like `hover\:bg-gray-800` — the file already uses this pattern elsewhere (e.g. `.hover\\:bg-gray-50` at line 551).

### Step 3: Locate the unscoped `.text-{color}-500` rules

Run:
```bash
grep -n "text-green-500, .border-green-500\|text-yellow-500, .border-yellow-500\|text-red-500, .border-red-500\|text-orange-500, .border-orange-500\|text-purple-500, .border-purple-500" JT-Tools-Master/features/rgb-theme.js
```

Expected: 5 matches around lines 502-506, e.g.:
```
.text-green-500, .border-green-500 { color: ${p.alerts.green.text}; border-color: ${p.alerts.green.border}; }
.text-yellow-500, .border-yellow-500 { color: ${p.alerts.yellow.text}; border-color: ${p.alerts.yellow.border}; }
...
```

### Step 4: Delete the 5 unscoped status-text rules

Read the surrounding context to know exactly which lines to delete. The 5 lines are typically grouped together. Use Edit:

old:
```js
      .text-green-500, .border-green-500 { color: ${p.alerts.green.text}; border-color: ${p.alerts.green.border}; }
      .text-yellow-500, .border-yellow-500 { color: ${p.alerts.yellow.text}; border-color: ${p.alerts.yellow.border}; }
      .text-red-500, .border-red-500 { color: ${p.alerts.red.text}; border-color: ${p.alerts.red.border}; }
      .text-orange-500, .border-orange-500 { color: ${p.alerts.orange.text}; border-color: ${p.alerts.orange.border}; }
      .text-purple-500, .border-purple-500 { color: ${p.alerts.purple.text}; border-color: ${p.alerts.purple.border}; }
```

new:
```js
      /* v4.8.3 — unscoped .text-{color}-500 / .border-{color}-500 rules removed.
         JT uses these classes for standalone status indicators (e.g. yellow "pending",
         green "submitted", red "rejected") that should keep their vivid defaults
         regardless of theme. The SCOPED rules at .bg-{color}-50 .text-{color}-500
         remain unchanged — alert text inside alert pills still harmonizes with the
         OKLCH theme. */
```

(Replace the 5 rules with a multi-line comment explaining the deletion.)

### Step 5: Verify no other consumers of the deleted selectors

Run:
```bash
grep -nE 'text-green-500|text-yellow-500|text-red-500|text-orange-500|text-purple-500' JT-Tools-Master/features/rgb-theme.js
```

Expected: only matches inside `.bg-{color}-50 .text-{color}-500 { ... }` rules (the SCOPED rules at lines ~514-518). NO standalone `.text-{color}-500` rules remain.

### Step 6: Smoke-syntax popup.js + node check rgb-theme.js

Run:
```bash
node --check JT-Tools-Master/features/rgb-theme.js && echo "rgb-theme.js: syntax OK"
```

Expected: `rgb-theme.js: syntax OK`. (rgb-theme.js is loaded as a content script and uses `${p.something}` template literals inside a string — `node --check` parses it as a JS module which is fine since the template literals are part of a string assignment.)

### Step 7: Verify CSS template integrity by reading a chunk

Use Read on rgb-theme.js to see lines 470-510 (where the changes landed). Confirm:
- The `.bg-gray-700:not(...)` rule is well-formed
- The `.bg-gray-800:not(...)` / `.hover\\:bg-gray-800:hover:not(...)` / `.active\\:bg-gray-900:active:not(...)` rules are well-formed
- The deletion comment for the unscoped status-text rules is in place
- The scoped rules at the lower line range (around 510-515) are untouched

### Step 8: Commit

```bash
git add JT-Tools-Master/features/rgb-theme.js
git commit -m "feat(theme): wire secondary color into JT button classes + status exclusion

Two changes to the CSS template in rgb-theme.js:

1. bg-gray-700 / bg-gray-800 / hover:bg-gray-800 / active:bg-gray-900
   now use \${p.secondary.base|hover|active} instead of background.strong
   (or being unstyled). JT's secondary action buttons (Item / Group /
   chip-style) render in a vivid theme-derived color instead of staying
   gray. Each rule has :not([style*=\"background-image\"]) so profile
   icons (which use inline background-image: url) are guaranteed never
   recolored, even if a future JT markup change adds .bg-gray-* to them.

2. Five unscoped .text-{color}-500 / .border-{color}-500 rules deleted.
   JT uses these classes for standalone status indicators (yellow
   'pending', green 'submitted', red 'rejected', etc.) that should keep
   their default vivid colors as semantic status signals regardless of
   theme. The SCOPED rules (.bg-{color}-50 .text-{color}-500) remain
   unchanged — alert text inside alert pills still harmonizes with the
   OKLCH alerts ramp.

See docs/plans/2026-05-02-secondary-color-design.md §B and §B2"
```

---

## Task 3: popup.html — remove `.crown` markup + `.pick-tip` markup

**Files:**
- Modify: `JT-Tools-Master/popup/popup.html`

### Step 1: Locate the `.crown` icon on Field Day preset

Run:
```bash
grep -n 'crown\|pick-tip' JT-Tools-Master/popup/popup.html
```

Expected: one match for `crown` (inside the Field Day preset card), one match for `pick-tip` (inside the Primary `.clr-cell`).

### Step 2: Delete the `.crown` icon

Use Edit:

old:
```html
              <button type="button" class="preset is-current" data-preset="field-day" data-primary="#FE4C0D" data-background="#FFFBF4" data-text="#1A1410">
                <i class="ph-fill ph-check-circle crown"></i>
                <div class="swatch-row"><span style="background:#FE4C0D"></span><span style="background:#FFFBF4"></span><span style="background:#1A1410"></span></div>
                <div class="nm">Field Day</div>
                <div class="sub">High-vis</div>
              </button>
```

new:
```html
              <button type="button" class="preset is-current" data-preset="field-day" data-primary="#FE4C0D" data-background="#FFFBF4" data-text="#1A1410">
                <div class="swatch-row"><span style="background:#FE4C0D"></span><span style="background:#FFFBF4"></span><span style="background:#1A1410"></span></div>
                <div class="nm">Field Day</div>
                <div class="sub">High-vis</div>
              </button>
```

(Just delete the `<i class="ph-fill ph-check-circle crown">` line.)

### Step 3: Delete the `.pick-tip` icon

Use Edit:

old:
```html
              <div class="clr-cell">
                <div class="swatch" id="primarySwatch" style="background:#FE4C0D"></div>
                <div class="lbl">Primary</div>
                <div class="hex" id="primaryColorValue">#FE4C0D</div>
                <div class="oklch" id="primaryOklch">oklch(64% .21 38)</div>
                <i class="ph ph-eyedropper pick-tip"></i>
                <input type="color" id="primaryColorPicker" value="#FE4C0D">
              </div>
```

new:
```html
              <div class="clr-cell">
                <div class="swatch" id="primarySwatch" style="background:#FE4C0D"></div>
                <div class="lbl">Primary</div>
                <div class="hex" id="primaryColorValue">#FE4C0D</div>
                <div class="oklch" id="primaryOklch">oklch(64% .21 38)</div>
                <input type="color" id="primaryColorPicker" value="#FE4C0D">
              </div>
```

(Just delete the `<i class="ph ph-eyedropper pick-tip">` line.)

### Step 4: Verify

Run:
```bash
grep -n 'crown\|pick-tip' JT-Tools-Master/popup/popup.html
```

Expected: ZERO matches.

Run:
```bash
node --check JT-Tools-Master/popup/popup.js && echo "popup.js: syntax OK"
```

Expected: `popup.js: syntax OK` (popup.js wasn't touched).

Run:
```bash
git diff --stat
```

Expected: 1 file modified (popup.html), -2 lines.

### Step 5: Commit

```bash
git add JT-Tools-Master/popup/popup.html
git commit -m "chore(popup): remove redundant orange icons on Theme tab

- .crown checkmark on .preset.is-current (Field Day card): removed.
  The orange border + outer ring on the active preset card already
  signals 'this is current' — the checkmark icon was redundant noise.
- .pick-tip eyedropper on Primary .clr-cell: removed. Purely decorative
  (eyedropper isn't actually wired — Tweaks-engine integration is still
  v4.9). The native color picker fires on swatch click anyway, so no
  affordance is being lost.

See docs/plans/2026-05-02-secondary-color-design.md §C"
```

---

## Task 4: popup.css — remove `.preset .crown` + `.clr-cell .pick-tip` rules

**Files:**
- Modify: `JT-Tools-Master/popup/popup.css`

### Step 1: Locate the dead rules

Run:
```bash
grep -n '\\.preset \\.crown\|\\.clr-cell \\.pick-tip' JT-Tools-Master/popup/popup.css
```

Expected: matches for `.preset .crown` (~4 lines: the rule body) and `.clr-cell .pick-tip` (~6 lines: the rule body).

### Step 2: Delete the `.preset .crown` rule

Find the rule. It typically looks like:

```css
.preset .crown {
  position: absolute;
  top: 5px;
  right: 5px;
  font-size: 11px;
  color: var(--accent);
}
```

Use Edit to delete the entire rule block (~7 lines including blank lines / comment).

### Step 3: Delete the `.clr-cell .pick-tip` rule

Find the rule. It typically looks like:

```css
.clr-cell .pick-tip {
  position: absolute;
  top: 6px;
  right: 6px;
  font-size: 11px;
  color: var(--accent-ink);
}
```

Use Edit to delete the entire rule block (~7 lines).

### Step 4: Verify

Run:
```bash
grep -nE '\\.preset \\.crown|\\.clr-cell \\.pick-tip' JT-Tools-Master/popup/popup.css
```

Expected: ZERO matches.

Run:
```bash
git diff --stat
```

Expected: 1 file modified (popup.css), net negative line count (rule deletions only).

### Step 5: Commit

```bash
git add JT-Tools-Master/popup/popup.css
git commit -m "chore(popup): drop dead CSS for removed crown + pick-tip icons

Removes the .preset .crown and .clr-cell .pick-tip rule blocks that
no longer match any markup after the prior commit removed those icons
from popup.html.

See docs/plans/2026-05-02-secondary-color-design.md §C"
```

---

## Task 5: Release commit — version bump + CHANGELOG

**Files:**
- Modify: `JT-Tools-Master/manifest.json:4`
- Modify: `JT-Tools-Master/manifest.firefox.json:4`
- Modify: `JT-Tools-Master/popup/popup.html` (version chip)
- Modify: `CHANGELOG.md` — new sub-headers under `### Added` (secondary color) and `### Changed` (icon polish + status color exclusion)

### Step 1: Bump manifest versions

Use Edit on `JT-Tools-Master/manifest.json`:
- old: `  "version": "4.8.2",`
- new: `  "version": "4.8.3",`

Use Edit on `JT-Tools-Master/manifest.firefox.json`:
- old: `  "version": "4.8.2",`
- new: `  "version": "4.8.3",`

### Step 2: Bump popup version chip

Use Edit on `JT-Tools-Master/popup/popup.html`:
- old: `<span class="version">v4.8.2</span>`
- new: `<span class="version">v4.8.3</span>`

### Step 3: Add CHANGELOG entries

Read the current `## [Unreleased]` section to find the existing `### Added` and `### Changed` sub-headers (they have v4.8/v4.8.1/v4.8.2 entries from prior releases).

**Add to `### Added`** (insert at end of the Added block, after the v4.8 entries):

```markdown

#### v4.8.3 — Auto-derived secondary color
- **Secondary color now powers JT's gray-700/800 buttons.** [palette.js](JT-Tools-Master/features/rgb-theme-modules/palette.js) computes `palette.secondary.{base, hover, active}` by rotating the user's primary 180° in OKLCH space (complementary hue), reducing chroma 15%, and keeping the same lightness. [rgb-theme.js](JT-Tools-Master/features/rgb-theme.js) re-maps `.bg-gray-700` / `.bg-gray-800` / `.hover\:bg-gray-800` / `.active\:bg-gray-900` to use the new secondary token, with `:not([style*="background-image"])` exclusion so profile icons are never recolored. JT's Item / Group / chip-style action buttons now render in a vivid theme-derived color (Field Day → deep teal, Blueprint → orange-red, Forest → rust, etc.) instead of always-gray. Existing custom themes auto-upgrade on next palette regeneration — no schema migration.
```

**Add to `### Changed`** (insert at end of the Changed block, after the v4.8.2 entries):

```markdown

#### v4.8.3 — Icon polish + status color exclusion
- **Removed the orange `.crown` checkmark on selected preset cards.** The orange border + outer ring already signals "this is the active preset" — the checkmark was redundant visual noise.
- **Removed the orange `.pick-tip` eyedropper on the Primary color cell.** Purely decorative (the eyedropper isn't actually wired — that's still v4.9 with Tweaks-engine integration). The native color picker fires on swatch click anyway, so no affordance is lost.
- **JT's standalone status indicators (yellow "pending", green "submitted", red "rejected", etc.) now keep their default vivid colors regardless of theme.** The 5 unscoped `.text-{color}-500` / `.border-{color}-500` rules in [rgb-theme.js](JT-Tools-Master/features/rgb-theme.js) — which were OKLCH-harmonizing every standalone instance of these classes — have been removed. The SCOPED rules at `.bg-{color}-50 .text-{color}-500` remain intact, so alert text inside alert pills still harmonizes with the theme.
```

### Step 4: Verify

Run:
```bash
grep -nE '4\\.8\\.[23]' JT-Tools-Master/manifest.json JT-Tools-Master/manifest.firefox.json JT-Tools-Master/popup/popup.html
```

Expected: zero `4.8.2` matches in the three version files; three `4.8.3` matches (one per file).

Run:
```bash
python -c "import json; json.load(open('JT-Tools-Master/manifest.json')); json.load(open('JT-Tools-Master/manifest.firefox.json')); print('manifests parse: ok')"
```

Expected: `manifests parse: ok`.

Run:
```bash
head -60 CHANGELOG.md | grep -n 'v4.8.3'
```

Expected: at least 2 matches (one in `### Added`, one in `### Changed`).

Run:
```bash
git diff --stat
```

Expected: exactly 4 files modified.

Run:
```bash
node --check JT-Tools-Master/popup/popup.js && echo "popup.js: syntax OK"
```

Expected: `popup.js: syntax OK`.

### Step 5: Commit

```bash
git add CHANGELOG.md JT-Tools-Master/manifest.json JT-Tools-Master/manifest.firefox.json JT-Tools-Master/popup/popup.html
git commit -m "chore(release): v4.8.3

Auto-derived secondary color (palette.secondary.{base,hover,active}),
re-wired JT's gray-700/800/hover/active to use it with profile-icon
exclusion, deleted unscoped .text-{color}-500 rules so JT's standalone
status indicators keep vivid defaults, removed redundant .crown +
.pick-tip orange icons from the Theme tab.

See docs/plans/2026-05-02-secondary-color-design.md
Updated CHANGELOG.md."
```

---

## Task 6: Smoke test in preview server

**Files:** none modified.

### Step 1: Start preview

Use `mcp__Claude_Preview__preview_start` with `name: "popup"`. Note the returned `serverId`.

### Step 2: Navigate with cache-buster

Use `mcp__Claude_Preview__preview_eval`:
```js
window.location.href = 'http://localhost:8082/popup.html?nocache=' + Date.now()
```

After load, force-refresh popup.css link:
```js
(() => {
  const link = document.querySelector('link[href^="popup.css"]');
  if (link) link.href = 'popup.css?nocache=' + Date.now();
  return 'ok';
})()
```

Wait ~500ms.

### Step 3: Verify icon removal

Use `mcp__Claude_Preview__preview_eval`:
```js
(() => {
  document.querySelector('[data-tab="appearance"]').click();
  return JSON.stringify({
    crownExists: !!document.querySelector('.preset.is-current .crown'),
    pickTipExists: !!document.querySelector('.clr-cell .pick-tip'),
    fieldDayPresetExists: !!document.querySelector('.preset[data-preset="field-day"]'),
    primaryCellExists: !!document.querySelector('.clr-cell:has(#primaryColorPicker)'),
    versionChip: document.querySelector('.version')?.textContent
  });
})()
```

Expected output:
```json
{
  "crownExists": false,
  "pickTipExists": false,
  "fieldDayPresetExists": true,
  "primaryCellExists": true,
  "versionChip": "v4.8.3"
}
```

(Both icons removed; the cards/cells they were inside still exist; version chip bumped.)

### Step 4: Verify OKLCH secondary derivation

Use `mcp__Claude_Preview__preview_eval` (the popup loads the OKLCH module via `<script src="../features/rgb-theme-modules/palette.js">`, but in the preview server context it can't because `..` escapes the doc root — same limitation hit during v4.8.x smoke tests):

```js
// Manually fetch + inject palette.js to verify the secondary derivation works at runtime
(async () => {
  // Copy palette.js into the popup directory's preview-only namespace
  // (Controller — if needed, copy palette.js to popup/ before this step)
  const r = await fetch('/palette-preview-only.js').catch(e => null);
  if (!r || !r.ok) return JSON.stringify({ skipped: 'palette.js not in popup directory' });
  const src = await r.text();
  const script = document.createElement('script');
  script.textContent = src;
  document.head.appendChild(script);
  if (!window.ThemePalette) return JSON.stringify({ error: 'ThemePalette not loaded' });

  const fieldDay = window.ThemePalette.generatePalette({primary:'#FE4C0D', background:'#FFFBF4', text:'#1A1410'});
  const slate    = window.ThemePalette.generatePalette({primary:'#64748B', background:'#F1F5F9', text:'#1E293B'});

  return JSON.stringify({
    fieldDay_secondaryKeys: Object.keys(fieldDay.secondary || {}),
    fieldDay_secondaryBase: fieldDay.secondary?.base,
    fieldDay_primaryBase: fieldDay.primary?.base,
    secondaryDifferentFromPrimary: fieldDay.secondary?.base !== fieldDay.primary?.base,
    slate_secondaryBase: slate.secondary?.base,
    slate_secondaryStaysNeutral: slate.secondary?.base?.toLowerCase().match(/^#[78a-f]{2}/) ? 'yes (gray-ish)' : 'no'
  });
})()
```

(If preview can't load `palette.js`, controller copies the file to `JT-Tools-Master/popup/palette-preview-only.js` first, then re-runs.)

Expected:
- `fieldDay_secondaryKeys`: `["base", "hover", "active"]`
- `fieldDay_secondaryBase`: a teal/blue hex (NOT orange)
- `secondaryDifferentFromPrimary`: `true`
- `slate_secondaryBase`: a near-neutral gray hex
- `slate_secondaryStaysNeutral`: `"yes (gray-ish)"`

If a `palette-preview-only.js` was created for testing, delete it after verification:
```bash
rm JT-Tools-Master/popup/palette-preview-only.js
```

### Step 5: Take a visual screenshot

Use `mcp__Claude_Preview__preview_screenshot` — confirm visually:
- No orange checkmark on the Field Day preset card
- No orange eyedropper on the Primary color cell
- Version chip reads `v4.8.3`

### Step 6: Stop preview

Use `mcp__Claude_Preview__preview_stop` with `serverId`.

### Step 7: Push the branch

```bash
git push -u origin claude/v4.8.3-secondary-color
```

### Step 8: Confirm branch state

Run:
```bash
git log --oneline -7
```

Expected (top to bottom):
1. `chore(release): v4.8.3`
2. `chore(popup): drop dead CSS for removed crown + pick-tip icons`
3. `chore(popup): remove redundant orange icons on Theme tab`
4. `feat(theme): wire secondary color into JT button classes + status exclusion`
5. `feat(palette): derive secondary token from primary in OKLCH space`
6. `docs(plan): v4.8.3 secondary color + icon polish + exclusions design`
7. (v4.8.2 release commit — `chore(release): v4.8.2`)

---

## Done

All acceptance criteria from `docs/plans/2026-05-02-secondary-color-design.md` are verified:

1. JT's `bg-gray-700/800` buttons render in the auto-derived secondary color (verified by reading rgb-theme.js diff).
2. Hover state shifts to `secondary.hover` (verified by reading the new rule).
3. Profile icons (any element with inline `background-image`) are not recolored (verified by `:not([style*="background-image"])` selector).
4. JT's standalone status indicators keep vivid defaults (verified by deleted unscoped rules + preserved scoped rules).
5. Alert text inside `.bg-{color}-50` pills still harmonizes (verified by preserved scoped rules).
6. Active preset card has no `.crown` icon (verified via grep).
7. Primary color cell has no `.pick-tip` icon (verified via grep).
8. Manifest version `4.8.3`, popup chip `v4.8.3`, CHANGELOG sub-headers under both Added and Changed.

Local main is still at v4.8.2 — fast-forward merge `claude/v4.8.3-secondary-color` into main when ready.
