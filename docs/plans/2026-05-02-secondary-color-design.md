# v4.8.3 — Auto-derived secondary color + icon polish + profile-icon exclusion (design)

**Date:** 2026-05-02
**Branch:** `claude/v4.8.3-secondary-color` (off `main` at v4.8.2)
**Target version:** 4.8.3
**Status:** approved 2026-05-02

## Context

In v4.8.2 dogfood testing the user surfaced three interrelated complaints:

1. **JobTread's secondary action buttons read as gray when Custom Theme is active.** [features/rgb-theme.js](../../JT-Tools-Master/features/rgb-theme.js) currently maps `.bg-gray-700` (Item / Group / chip-style buttons in JT) to `${p.background.strong}` — a darkened *background* shade. `.bg-gray-800` and `.bg-gray-900` aren't overridden at all. Result: secondary action buttons stay gray regardless of which preset the user picks. The user said "I think we need a secondary color picker for it to pop!" — they want secondary action buttons to render in a vivid, themed color.

2. **Two redundant orange icons** on the Theme tab clutter the UI: a `.crown` checkmark on `.preset.is-current` (the active preset card) and a `.pick-tip` eyedropper on the Primary `.clr-cell`. The active preset is already signaled by an orange ring + outer box-shadow, and the pick-tip eyedropper is purely decorative — the eyedropper isn't actually wired (Tweaks-engine integration is still v4.9), and the native color picker fires on swatch click anyway. Both icons are noise.

3. **Profile icons in JT must not be tinted by the new secondary rule.** JobTread renders profile photos as `<div>` elements with `bg-cover bg-center` Tailwind utilities + an inline `style="background-image: url(...); background-color: rgb(255, 255, 255);"`. They don't carry `.bg-gray-*` classes today, so the new secondary rule wouldn't catch them. But the user wants explicit defensive exclusion to guarantee the photo surface is never recolored — `:not([style*="background-image"])` on the new rules.

4. **Status indicator text (e.g. "pending" yellow, "submitted" green) is being re-hued by the existing alert palette rules.** [rgb-theme.js](../../JT-Tools-Master/features/rgb-theme.js) lines 502-506 currently recolor `.text-yellow-500` / `.text-green-500` / `.text-red-500` / `.text-orange-500` / `.text-purple-500` via `${p.alerts.{color}.text}` — an OKLCH-harmonized variant for the active theme. That's correct *inside* alert pills (`.bg-yellow-50 .text-yellow-500`), but it also catches standalone status indicators like `<div class="font-bold uppercase text-yellow-500">pending</div>` that the user wants to keep JT's default vivid colors. Fix: delete the five unscoped `.text-{color}-500` rules; keep the scoped `.bg-{color}-50 .text-{color}-500` rules intact (alerts inside alert pills still harmonize).

## Goals

- Secondary action buttons render in a vivid, themed color that "pops" against background — automatic upgrade for every existing custom theme + preset, no schema migration.
- Two purely-decorative orange icons gone from the Theme tab.
- Profile icons in JT remain visually correct under any theme.
- Backward compatible: any user with a v4.7/v4.8/v4.8.1/v4.8.2 saved theme gets the secondary upgrade automatically the moment v4.8.3 ships.

## Non-goals

- **Manual secondary override picker.** Auto-derive covers the "it pops" goal for every existing preset. If a power user wants explicit secondary control independently of primary, that's a clean v4.9 addition (4th cell behind an "Advanced" expander).
- **Tertiary / quaternary tokens.** YAGNI — JT's UI surface really only has two interactive button levels (primary actions = orange Save/Submit, secondary actions = Item/Group/chip).
- **Wired eyedropper.** Still v4.9 (Tweaks-engine element picker integration).

---

## A. Auto-derive secondary in OKLCH space

In [features/rgb-theme-modules/palette.js](../../JT-Tools-Master/features/rgb-theme-modules/palette.js), inside `generatePalette({ primary, background, text })`:

```js
// Secondary = complementary hue (+180°), 85% chroma, same lightness.
// Same L → buttons sit at the same visual weight as primary buttons.
// 85% C → secondary doesn't compete with primary for attention.
// +180° h → maximum perceptual contrast with primary.
// For low-chroma primaries (Slate / Charcoal), C * 0.85 stays low —
// secondary stays gracefully neutral instead of injecting jarring color.
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

// In the returned palette object, alongside primary/background/text/border/etc:
return { ..., secondary, ... };
```

### Worked examples for the 10 v4.8.x presets

| Preset | Primary | Secondary (auto) | Vibe |
|---|---|---|---|
| Field Day | `#FE4C0D` orange | ≈`#0086a5` deep teal | Orange + teal (classic safety palette) |
| Blueprint | `#0EA5E9` cyan | ≈`#e8470c` orange-red | Blue + orange (engineering-print classic) |
| Carbon | `#FFB000` amber | ≈`#0083ce` cyan-blue | Warm amber + cool blue |
| Paper | `#3B5898` indigo | ≈`#9b7e2a` warm gold | Cool blue + warm gold (newsprint feel) |
| Forest | `#16A34A` green | ≈`#a35a16` rust-orange | Green + rust (autumn) |
| Owner Demo | `#7C3AED` purple | ≈`#7cad36` chartreuse | Purple + green-yellow |
| Sunset | `#EA580C` orange | ≈`#0c93ea` sky-blue | Sunset + sky |
| Berry | `#7C3AED` purple | ≈`#7cad36` chartreuse | Same family as Owner Demo |
| Slate | `#64748B` gray | ≈`#8b7e64` warm-gray | Stays neutral (low chroma → low chroma) |
| Charcoal | `#A1A1AA` gray | ≈`#aaaaa1` warm-gray | Stays neutral |

(Hex values approximate — actual values come from `oklchToHex()` at runtime.)

## B. CSS template wiring

In [features/rgb-theme.js](../../JT-Tools-Master/features/rgb-theme.js):

```css
/* Currently: */
.bg-gray-700 { background-color: ${p.background.strong} !important; }
/* (bg-gray-800 + hover:bg-gray-800 not overridden — stay JT default gray) */

/* New (with profile-icon exclusion): */
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

### Why each detail

- **`color: white !important`** on the base + hover rules. JT's button markup couples `bg-gray-700` with `text-white` in the same element — when we recolor the background to a vivid hue, text legibility stays guaranteed even if the markup ever omits the `text-white` class or some sibling rule wins specificity for color.
- **`:not([style*="background-image"])`** on every rule. JT renders profile photos as `<div>` elements with inline `background-image: url(...)`. Even though current profile-icon markup doesn't carry `.bg-gray-*` classes, the defensive `:not()` guarantees that any element using inline `background-image` is excluded from secondary recoloring — futureproof against a JT markup change that adds a `.bg-gray-*` to a photo container.
- **Hover + active states** map to `secondary.hover` / `secondary.active` — same OKLCH-shifted variants the primary token gets, so secondary buttons feel structurally identical to primary buttons on interaction.

## B2. Status color exclusion (delete unscoped `.text-{color}-500` rules)

In [features/rgb-theme.js](../../JT-Tools-Master/features/rgb-theme.js), lines 502-506 currently read:

```css
/* Currently — these recolor every standalone status indicator: */
.text-green-500,  .border-green-500  { color: ${p.alerts.green.text};  border-color: ${p.alerts.green.border}; }
.text-yellow-500, .border-yellow-500 { color: ${p.alerts.yellow.text}; border-color: ${p.alerts.yellow.border}; }
.text-red-500,    .border-red-500    { color: ${p.alerts.red.text};    border-color: ${p.alerts.red.border}; }
.text-orange-500, .border-orange-500 { color: ${p.alerts.orange.text}; border-color: ${p.alerts.orange.border}; }
.text-purple-500, .border-purple-500 { color: ${p.alerts.purple.text}; border-color: ${p.alerts.purple.border}; }
```

Delete all five. JT's standalone status indicators (`text-yellow-500` "pending", `text-green-500` "submitted", `text-red-500` "rejected", etc.) revert to JT's default vivid colors — which is what the user wants to convey "status" semantics regardless of theme.

Keep the SCOPED variants at lines ~514-518 intact:

```css
/* Keep — these harmonize alert text INSIDE alert pills with the theme's OKLCH alerts ramp: */
.bg-green-50 .text-green-500   { color: ${p.alerts.green.text}  !important; }
.bg-yellow-50 .text-yellow-500 { color: ${p.alerts.yellow.text} !important; }
.bg-red-50 .text-red-500       { color: ${p.alerts.red.text}    !important; }
.bg-orange-50 .text-orange-500 { color: ${p.alerts.orange.text} !important; }
.bg-purple-50 .text-purple-500 { color: ${p.alerts.purple.text} !important; }
```

These only fire on text that's inside an explicit alert container, where harmonization is the right call. Standalone status text gets JT's vivid defaults.

### Border colors

The deleted rules ALSO had a `.border-{color}-500` half — `border-color: ${p.alerts.{color}.border}`. Those are also gone. JT's themed alert borders inside alert pills still harmonize via the unchanged `.alert.a-{color}` rules in popup.css (which are popup-internal and don't touch JT's surface).

## C. Icon polish

Two pure deletions:

### C1. Remove `.crown` from active preset cards

[popup/popup.html](../../JT-Tools-Master/popup/popup.html) — find the Field Day preset card with `class="preset is-current"`:

```html
<!-- before -->
<button type="button" class="preset is-current" data-preset="field-day" ...>
  <i class="ph-fill ph-check-circle crown"></i>
  <div class="swatch-row">...</div>
  <div class="nm">Field Day</div>
  <div class="sub">High-vis</div>
</button>

<!-- after -->
<button type="button" class="preset is-current" data-preset="field-day" ...>
  <div class="swatch-row">...</div>
  <div class="nm">Field Day</div>
  <div class="sub">High-vis</div>
</button>
```

[popup/popup.css](../../JT-Tools-Master/popup/popup.css) — delete the `.preset .crown` rule (4 lines).

### C2. Remove `.pick-tip` from Primary `.clr-cell`

[popup/popup.html](../../JT-Tools-Master/popup/popup.html) — find the Primary cell in Custom Builder:

```html
<!-- before -->
<div class="clr-cell">
  <div class="swatch" id="primarySwatch" style="background:#FE4C0D"></div>
  <div class="lbl">Primary</div>
  <div class="hex" id="primaryColorValue">#FE4C0D</div>
  <div class="oklch" id="primaryOklch">oklch(64% .21 38)</div>
  <i class="ph ph-eyedropper pick-tip"></i>
  <input type="color" id="primaryColorPicker" value="#FE4C0D">
</div>

<!-- after -->
<div class="clr-cell">
  <div class="swatch" id="primarySwatch" style="background:#FE4C0D"></div>
  <div class="lbl">Primary</div>
  <div class="hex" id="primaryColorValue">#FE4C0D</div>
  <div class="oklch" id="primaryOklch">oklch(64% .21 38)</div>
  <input type="color" id="primaryColorPicker" value="#FE4C0D">
</div>
```

[popup/popup.css](../../JT-Tools-Master/popup/popup.css) — delete the `.clr-cell .pick-tip` rule (6 lines).

## D. What the user sees after v4.8.3 ships

- Open JobTread, click an Item/Group/chip-style button — it's now in a vivid secondary color (theme-derived) instead of gray.
- Profile photos render correctly in any theme — never tinted, never recolored.
- Theme tab's selected preset card no longer has a redundant orange checkmark icon (the orange ring already signals it).
- Theme tab's Primary color cell no longer has a decorative orange eyedropper icon.
- No popup behavior change. No storage migration. No schema change.

## Implementation order (single feature branch, ~5 commits)

1. **palette.js — secondary derivation** (~15 lines added). Single commit.
2. **rgb-theme.js — CSS template re-wiring** (~16 lines changed: secondary mapping for bg-gray-700/800 with profile-icon exclusion + delete 5 unscoped `.text-{color}-500` rules). Single commit.
3. **popup.html — remove `.crown` + `.pick-tip` markup** (2 lines deleted). Single commit.
4. **popup.css — remove `.preset .crown` + `.clr-cell .pick-tip` rules** (10 lines deleted). Single commit.
5. **Release commit** — manifest + popup chip → 4.8.3, CHANGELOG entries. Single commit.

Smoke test in `mcp__Claude_Preview` after all 5 commits: confirm popup renders without the two icons, confirm OKLCH math produces expected secondary hexes per preset.

## Risks

1. **`color: white` may regress some buttons that already have `text-{not-white}` classes.** Low risk — JT's `bg-gray-700/800` Tailwind pattern is consistently coupled with `text-white` in the buttons we've inspected. If a future audit finds counter-examples, the `color` declaration can be scoped or removed; the secondary recolor itself stays.
2. **Complementary hue may clash with the theme's dominant hue.** The 85% chroma reduction softens this. For the 10 official presets, the worked-examples table above shows reasonable pairings. Worst case: a future custom theme with a primary the user really doesn't want a complementary of. Resolution: v4.9 manual override picker (already in non-goals).
3. **`:not([style*="background-image"])` selector specificity.** Adds a small specificity bump but stays at attribute-selector level (a=1) — same level as the original `.bg-gray-700` (a=1, since class). Same specificity, source order tiebreaks. No regression.
4. **Older saved themes in `chrome.storage.sync.themeColors` only have `{primary, background, text}`** — no `secondary` key. The OKLCH module computes `secondary` from `primary` at every `generatePalette()` call, so it never reads `colors.secondary`. Backward compat is automatic; no migration code needed.

## Acceptance

After loading the unpacked extension at v4.8.3 and applying any preset:

1. JobTread's Item / Group / chip-style buttons (originally `.bg-gray-700`) render in the auto-derived secondary color, not gray.
2. Hovering those buttons shifts to `secondary.hover` (slightly lightened/darkened per `bgIsDark`).
3. Profile icons (any element with inline `background-image: url(...)`) are not recolored.
4. JT's standalone status indicators (`<div class="text-yellow-500">pending</div>`, `<div class="text-green-500">submitted</div>`, etc.) render in JT's default vivid status colors — yellow stays yellow, green stays green, red stays red, regardless of which theme is active.
5. Alert text *inside* alert pills (`.bg-yellow-50 .text-yellow-500` and friends) still harmonizes with the OKLCH theme — that scoped behavior is preserved.
6. The selected Theme-tab preset card has no orange `.crown` icon — only the orange border + outer ring.
7. The Primary color cell has no decorative `.pick-tip` eyedropper icon.
8. Manifest version is `4.8.3`. Popup chip reads `v4.8.3`. CHANGELOG has matching `### Added` (secondary) + `### Changed` (icon removal + status color exclusion) sub-headers.
