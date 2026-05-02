# v4.8.2 — Theme tab layout tightening (design)

**Date:** 2026-05-02
**Branch:** `claude/v4.8.2-theme-tightening` (off `main` at v4.8.1)
**Target version:** 4.8.2
**Status:** approved 2026-05-02

## Context

v4.8 shipped the Theme tab redesign with eleven distinct vertical sections; v4.8.1 polished the dark-mode palette but didn't touch layout. In dogfood testing the user surfaced four interrelated complaints:

1. The Live JobTread Preview pane is **overkill** for the popup — the Custom Builder cells already convey the colors, and a faux JobTread rendering at popup-width adds visual noise without informing the choice.
2. The **Custom Theme master toggle lives on the Features tab**, so a user landing on the Theme tab to change colors first has to backtrack to Features, flip a toggle, then return. The "Enable Custom Theme in Features tab" notice at the bottom of Theme is a workaround that confirms the friction.
3. The **Apply Theme button sits at the very bottom**, after Saved Themes and the v4.9 placeholders. Users finishing a custom build in the middle of the tab have to scroll past three sections to commit.
4. **Saved Themes is buried below Apply** — disconnected from the Custom Builder it captures the output of.

Net effect: too many vertical chunks, too much scrolling between related controls, and a flow that requires users to leave the tab before they can use it.

## Goals

- Make the toggle-to-apply path linear with no backtracking.
- Put Apply directly under the controls that drive it (Custom Builder + WCAG meter).
- Co-locate Saved Themes with the controls whose output it captures (Custom Builder).
- Hide v4.9 placeholders behind a collapsed accordion so they stay discoverable without consuming primary screen real estate.
- Keep all carry-forward IDs (`primaryColorPicker`, `applyThemeBtn`, `themeName0/1/2`, `slot0Primary`, etc.) so popup.js wiring continues working unchanged.

## Non-goals

- Tweaks-tab layout (separate concern).
- Per-Context routing or Org Rollout backend wiring (still v4.9).
- Visual restyling beyond what the layout move requires.
- Removing existing functionality beyond Live Preview + redundant Active-card action row.

---

## A. Final Theme tab order (top to bottom)

1. **Panel header** — `Theme` title + `OKLCH palettes, presets, WCAG checks` subtitle (unchanged).
2. **Master toggle card** — *moved from Features tab.* Same `id="rgbTheme"` checkbox; lives in a `.master-toggle-bar`-style strip at the top of `#tab-appearance`.
3. **Active card** — *simplified.* 3-swatch overlap + name + ACTIVE pill only. The previous Switch / Save as / Share action row is removed.
4. **§01 Presets** — 10-card grid (unchanged).
5. **§02 Custom Builder** — 3 OKLCH cells + extras pills (unchanged content; "Color-blind preview" pill removed since its only target was the deleted JT preview).
6. **§03 Contrast Check** — WCAG meter + auto-nudge banner (unchanged).
7. **Apply Theme button** — *moved up here, immediately after the WCAG/auto-nudge block.*
8. **§04 Saved Themes** — *promoted from buried-bottom to numbered section.* Three slots, same per-slot Save / Load buttons.
9. **`<details>` accordion: "Coming v4.9 — Per-Context & Org Rollout"** — both placeholder sections wrapped in a single collapsed expander.
10. ~~**§06 Live JT Preview**~~ — removed entirely.
11. ~~**Theme notice ("Enable Custom Theme in Features tab")**~~ — removed; master toggle replaces it.

## B. Component-level decisions

### Master toggle card (new)

Markup:
```html
<div class="master-toggle-bar theme-master-toggle">
  <div class="master-toggle-info">
    <i class="ph ph-palette category-icon"></i>
    <span class="master-toggle-label">Custom Theme</span>
    <span class="badge pro">Pro</span>
  </div>
  <label class="toggle">
    <input type="checkbox" id="rgbTheme" data-feature="rgbTheme">
    <span class="slider"></span>
  </label>
</div>
```

Reuses `.master-toggle-bar` / `.master-toggle-info` / `.master-toggle-label` styles already present in popup.css for the Features tab's "All Features" master strip — visual parity for free. The optional `.theme-master-toggle` modifier class is reserved for future tab-specific styling but currently doesn't need any rules.

### Active card simplification

Drop the `.ac-row` action row entirely. The three buttons (Switch / Save as / Share) had overlapping intent with Presets (=Switch), Saved Themes (=Save as), and a Share flow that was never wired. Single-source-of-truth for those actions: the Presets gallery, Saved Themes slots, and... nothing for Share (deferred indefinitely).

After: Active card is a single 56px-tall row instead of an 88px card.

### Apply Theme button — relocation

Move `<button id="applyThemeBtn" class="apply-cta">` from "after Saved Themes" to "immediately after the auto-nudge banner under §03 Contrast Check". Same markup, same `id`, same handler. The visual rhythm becomes:

```
[Custom Builder cells]
[Extras pills]
§03 Contrast Check
[WCAG ratios]
[Auto-nudge banner — only when ratios fail]
[Apply theme] ← here
§04 Saved Themes
```

### Saved Themes promotion

Wrap the existing `.saved-themes` block in a numbered `.sec-title`:
```html
<div class="sec-title">
  <span class="num">04</span>
  <h3>Saved Themes</h3>
  <span class="right">3 slots</span>
</div>
<div class="saved-themes">
  ...existing 3 slot rows unchanged...
</div>
```

Keeps slot 0/1/2 IDs and the per-slot Save/Load buttons exactly as they are. popup.js wiring is untouched.

### v4.9 accordion

Wrap `<div class="sec-title">…04 PER-CONTEXT…</div>` + `<div class="ctx-list coming-soon">…</div>` + `<div class="sec-title">…05 ORG ROLLOUT…</div>` + `<div class="org-card coming-soon">…</div>` in a single `<details>` element:

```html
<details class="theme-coming-soon">
  <summary>Coming v4.9 — Per-Context & Org Rollout</summary>
  <!-- existing per-context + org-rollout markup, untouched -->
</details>
```

Closed by default. Native `<summary>` keyboard focus + screen-reader announce. Section numbering inside the accordion stays as `04` and `05` (now stylistically out of sequence with the outer `04 Saved Themes`, but that's the price of two parallel numbering namespaces — fine since the inner content is gated by an explicit "Coming v4.9" frame).

## C. What gets deleted

### Markup

- `<div class="ac-row">…</div>` block (3 buttons, ~10 lines).
- `<div class="sec-title">…06 LIVE JT PREVIEW…</div>` (3 lines).
- `<div class="jt-preview-pane">…</div>` block including `.jt-preview-bar` and `.jt-themed` mock content (~30 lines).
- `<div class="theme-notice" id="themeNotice">…</div>` (3 lines).
- `<div class="feature-item premium" id="rgbThemeFeature">…</div>` block in Features tab Appearance category (~7 lines).
- `<button class="pill-btn" id="colorBlindPreviewBtn">` from the extras pills row (its only target was the deleted JT preview).
- Hardcoded `<span class="category-count">4</span>` for Features tab Appearance category becomes `3`.

### CSS (~240 lines of dead selectors)

- `.jt-preview-pane`, `.jt-preview-bar`, `.jt-preview-bar .lights`, `.jt-preview-bar .url`, `.jt-preview-bar .which`
- `.jt-themed`, `.jt-themed .jt-bar`, `.jt-themed .stats`, `.jt-themed .stat`, `.jt-themed .stat.hot`, `.jt-themed .alerts`, `.jt-themed .alert`, `.jt-themed .a-green`, `.jt-themed .a-yellow`, `.jt-themed .a-red`
- `.ac-row`, `.ac-row button`, `.ac-row button:hover`
- `.theme-notice`, `.theme-notice strong`, `.theme-notice i`

### popup.js (~80 lines)

- `function refreshJtPreview(colors, palette)` definition + the call from `refreshThemeRebuildUI()`.
- `themeSwitchBtn`, `themeSaveAsBtn`, `themeShareBtn` getElementById + addEventListener blocks.
- `colorBlindPreviewBtn` handler + `cbToggleOn` mutable state.
- (kept) `refreshWcagPanel` and the rest of `refreshThemeRebuildUI` are unchanged — only the JT-preview-specific branch is removed.

## D. CSS additions (~10 lines)

```css
/* §04 Saved Themes section title spacing */
.theme-rebuild .saved-themes { margin-top: 0; padding-top: 0; border-top: none; }

/* v4.9 accordion */
.theme-coming-soon { margin-top: 8px; }
.theme-coming-soon > summary {
  font-family: var(--ff-mono);
  font-size: 10px;
  font-weight: 700;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: var(--accent-ink);
  padding: 8px 12px;
  background: var(--bg-raised);
  border: 1px solid var(--rule);
  border-radius: var(--r-md);
  cursor: pointer;
  list-style: none;
}
.theme-coming-soon > summary::-webkit-details-marker { display: none; }
.theme-coming-soon > summary::before { content: "▸ "; transition: transform 150ms; display: inline-block; }
.theme-coming-soon[open] > summary::before { transform: rotate(90deg); }
.theme-coming-soon > summary:hover { background: var(--bg-surface); }
.theme-coming-soon[open] > summary { margin-bottom: 8px; }
```

## Implementation order

Single feature branch (`claude/v4.8.2-theme-tightening`), three commits:

1. **Markup move** — popup.html: remove rgbTheme from Features tab + count fix; add master-toggle card to Theme tab top; simplify Active card; relocate Apply button; promote Saved Themes; wrap v4.9 sections in `<details>`; delete Live Preview, theme-notice, color-blind pill, action row.
2. **JS cleanup** — popup.js: delete `refreshJtPreview`, the three Active-card button handlers, the color-blind toggle. Verify `rgbTheme` toggle still binds via `data-feature` iteration.
3. **CSS cleanup + accordion styling** — popup.css: delete the dead JT-preview / ac-row / theme-notice rules; add the ~10 lines of `<details>` summary styling.
4. **Release commit** — manifest.json + manifest.firefox.json + popup.html version chip → 4.8.2; CHANGELOG `### Changed` v4.8.2 sub-header.
5. **Smoke test** in preview server: master toggle visible at top, Active card simplified, Apply directly under WCAG, Saved Themes a numbered §04, v4.9 accordion collapsed by default and expandable, no Live Preview, no theme-notice.

## Risks

1. **`rgbTheme` toggle wiring after move** — popup.js's master-features iteration uses `[data-feature]` attribute selectors, not DOM position or category context. Verify by reading the wiring loop. If it filters by `category` ancestor, that would break — needs a tiny adjustment.
2. **`themeNotice` ID lookup in popup.js** — the existing visibility-conditional code `document.getElementById('themeNotice')` may exist. Grep + remove dead lookup as part of step 2.
3. **`<details>` initial state on first popup open** — `<details>` without `open` attribute is collapsed by default. No JS state needed.
4. **Section numbering inside accordion vs outside** — outer section §04 becomes Saved Themes; inner §04+§05 remain Per-Context+Org-Rollout inside the accordion. Briefly inconsistent but acceptable since the accordion frame ("Coming v4.9") explicitly disclaims its contents are forward-looking.

## Out of scope

- Tweaks-tab class refresh (still v4.9).
- Per-Context routing wiring (still v4.9).
- Org Rollout backend (still v4.9).
- Color-blind preview returning as a body-wide filter (defer indefinitely; reintroduce only if a Pro user actually requests it).
- Active card "Switch" or "Share" button replacements (functionality covered by Presets and not implemented respectively).

## Acceptance

After loading the unpacked extension and opening the popup:

1. Theme tab top: master-toggle strip with `Custom Theme [PRO]` label and a working toggle. Toggling it ON enables the Custom Theme feature; toggling OFF disables it. `rgbTheme` is no longer in the Features tab.
2. Active card directly below master toggle, single row, no action buttons.
3. Presets gallery (10 cards) — clicking a preset still applies + sets `.is-current`.
4. Custom Builder + WCAG meter + Apply button, in that order, all visually adjacent. Apply commits the current builder values to JobTread.
5. Saved Themes is a numbered `§04` section directly below Apply. Save/Load buttons work as before.
6. `<details>` accordion below Saved Themes labeled "Coming v4.9 — Per-Context & Org Rollout". Collapsed by default; expanding shows the existing faded placeholders.
7. No Live JobTread Preview pane visible anywhere on the tab.
8. No "Enable Custom Theme in Features tab" notice anywhere.
9. Features tab Appearance category shows 3 features (was 4); count badge reads `3`.
10. Manifest version is `4.8.2`. Popup chip reads `v4.8.2`. CHANGELOG has a v4.8.2 sub-header under `### Changed`.
