# v4.8.2 Theme Tab Layout Tightening — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Tighten the Theme tab so the toggle-to-apply path is one linear scroll: master toggle on top, Apply button immediately under the WCAG meter, Saved Themes adjacent to the controls that produce them, v4.9 placeholders folded into a collapsed accordion, and the Live JobTread Preview pane removed entirely.

**Architecture:** Five commits on `claude/v4.8.2-theme-tightening` (off `main` at v4.8.1). All work scoped to popup.html, popup.css, popup.js, manifests, CHANGELOG. Carry-forward IDs (`primaryColorPicker`, `applyThemeBtn`, `themeName0/1/2`, `slot0Primary` etc.) preserved so popup.js wiring continues unchanged. Smoke test via Claude_Preview MCP at the end.

**Tech Stack:** Plain CSS custom properties, Phosphor Icons, vanilla JS, native `<details>` for the accordion. Same stack as v4.8/v4.8.1.

**Design reference:** [docs/plans/2026-05-02-theme-tab-tightening-design.md](2026-05-02-theme-tab-tightening-design.md)

---

## Task 1: Pre-flight — locate dead references

**Files:** none modified.

**Step 1: Grep for `themeNotice` and `rgbThemeFeature` consumers**

Run:
```bash
grep -n "themeNotice\|rgbThemeFeature" JT-Tools-Master/popup/popup.js JT-Tools-Master/popup/popup.html
```

Expected: at least one popup.js reference to `getElementById('themeNotice')` and at least one popup.html match for `id="rgbThemeFeature"`. Note the line numbers — Tasks 2 and 3 will use them.

**Step 2: Grep for `colorBlindPreviewBtn` consumers**

Run:
```bash
grep -n "colorBlindPreviewBtn\|cbToggleOn" JT-Tools-Master/popup/popup.js JT-Tools-Master/popup/popup.html
```

Expected: one popup.html match (the pill button), one popup.js handler block. Note the line numbers.

**Step 3: Grep for the three Active-card button IDs**

Run:
```bash
grep -n "themeSwitchBtn\|themeSaveAsBtn\|themeShareBtn" JT-Tools-Master/popup/popup.js JT-Tools-Master/popup/popup.html
```

Expected: one popup.html match per button, one popup.js handler block per button.

**Step 4: Grep for `refreshJtPreview` consumers**

Run:
```bash
grep -n "refreshJtPreview\|jtPreview" JT-Tools-Master/popup/popup.js JT-Tools-Master/popup/popup.html
```

Expected: function definition + one call site in popup.js, one `id="jtPreview"` markup ref in popup.html, plus the `.jt-preview-pane` and `.jt-themed` rules in popup.css.

**Step 5: Grep for `data-tab="appearance"` block boundaries**

Run:
```bash
grep -n 'tab-content.*id="tab-appearance"\|theme-rebuild' JT-Tools-Master/popup/popup.html
```

Note the opening line of `#tab-appearance` and the wrapping `.theme-rebuild` div. These are the Theme tab boundaries you'll be working inside in subsequent tasks.

**No commit** — this task gathers line numbers only.

---

## Task 2: Features tab — remove `rgbTheme` entry + fix count

**Files:**
- Modify: `JT-Tools-Master/popup/popup.html`

**Step 1: Read the Appearance category in the Features tab**

Use Read on popup.html to view the lines around the `<div class="feature-category">` block whose `data-category="appearance-features"`. The block ends with the closing `</div>` of `.category-features`. Inside it are 4 feature-items: contrastFix, budgetHierarchy, darkMode, and rgbThemeFeature.

**Step 2: Remove the rgbTheme feature-item**

Use Edit to delete the entire `<div class="feature-item premium" id="rgbThemeFeature">…</div>` block (it spans ~7 lines). The block looks roughly like:

```html
              <div class="feature-item premium" id="rgbThemeFeature">
                <div class="feature-info">
                  <h3>Custom Theme <i class="ph ph-question feature-help" data-guide="custom-theme" title="Learn more"></i><i class="ph ph-device-mobile feature-mobile" title="Mobile friendly"></i> <span class="badge pro">Pro</span></h3>
                  <p>Create your own custom color theme</p>
                </div>
                <label class="toggle">
                  <input type="checkbox" id="rgbTheme" data-feature="rgbTheme">
                  <span class="slider"></span>
                </label>
              </div>
```

After the edit, that block is gone but the surrounding 3 feature-items (contrastFix, budgetHierarchy, darkMode) remain.

**Step 3: Fix the category count**

Find the `data-category="appearance-features"` header. It contains `<span class="category-count">4</span>`. Change to `3`.

Use Edit:
- old: `<span class="category-count">4</span>` (NOTE: this string also appears for other categories — narrow the match by including more surrounding context, e.g. include the preceding `<span class="category-title">Appearance</span>` line)
- new: `<span class="category-count">3</span>`

**Step 4: Verify**

Run:
```bash
grep -c "feature-item" JT-Tools-Master/popup/popup.html
```
Compare to before. Should be one less than before this task.

Run:
```bash
grep -n "rgbThemeFeature\|id=\"rgbTheme\"" JT-Tools-Master/popup/popup.html
```
Expected: ZERO matches in this commit (the rgbTheme `<input>` will be re-added in Task 3 in a different location).

Run:
```bash
grep -n 'data-category="appearance-features"' JT-Tools-Master/popup/popup.html
```
Read the line range around the match and confirm the count is `3`.

**Step 5: Don't commit yet.** Task 3 adds the master toggle to the Theme tab. Both go in the same commit because they're a single logical move — removing from Features and adding to Theme.

---

## Task 3: Theme tab — add master toggle card at top

**Files:**
- Modify: `JT-Tools-Master/popup/popup.html`

**Step 1: Locate the Theme tab body**

Find the `<div class="tab-content" id="tab-appearance">` opening tag. Inside it is `<div class="tab-panel-content">`, then `<div class="panel-header">…</div>` (the Theme heading + subtitle), then `<div class="theme-rebuild">` which wraps everything else.

**Step 2: Insert master-toggle card immediately after the panel header**

Use Edit. Find the closing `</div>` of `.panel-header` block — the one right before `<div class="theme-rebuild">` opens. Add the master-toggle card between them:

old:
```html
            <div class="panel-info">
              <h2 class="panel-title">Theme</h2>
              <p class="panel-desc">OKLCH palettes, presets, WCAG checks</p>
            </div>
          </div>

          <div class="theme-rebuild">
```

new:
```html
            <div class="panel-info">
              <h2 class="panel-title">Theme</h2>
              <p class="panel-desc">OKLCH palettes, presets, WCAG checks</p>
            </div>
          </div>

          <!-- v4.8.2 — master toggle moved here from Features tab -->
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

          <div class="theme-rebuild">
```

(Match the indentation of the surrounding `.panel-header` block — looks like 10-space indent based on prior lines.)

**Step 3: Verify**

Run:
```bash
grep -n 'id="rgbTheme"' JT-Tools-Master/popup/popup.html
```
Expected: exactly ONE match — the new location at the top of the Theme tab.

Run:
```bash
grep -n 'master-toggle-label">Custom Theme' JT-Tools-Master/popup/popup.html
```
Expected: exactly one match.

**Step 4: Commit (Tasks 2 + 3 together)**

```bash
git add JT-Tools-Master/popup/popup.html
git commit -m "feat(popup): move Custom Theme master toggle from Features to Theme tab

Pro users opening the Theme tab no longer have to backtrack to Features
to enable the feature. The toggle now lives at the top of the Theme tab
itself, using the same .master-toggle-bar styling as the Features tab's
'All Features' master strip for visual consistency. Appearance category
on Features tab drops from 4 to 3 (count badge updated). The rgbTheme
checkbox keeps the same id+data-feature so popup.js wiring is unchanged.

See docs/plans/2026-05-02-theme-tab-tightening-design.md §A.2"
```

---

## Task 4: Theme tab — simplify Active card + relocate Apply + promote Saved Themes + delete dead sections

**Files:**
- Modify: `JT-Tools-Master/popup/popup.html`

This is the largest single edit in the plan — multiple deletions + relocations all inside the `.theme-rebuild` block. Doing it in one Edit avoids intermediate broken states.

**Step 1: Read the current `.theme-rebuild` block**

Use Read on popup.html to view the entire `.theme-rebuild` block. It currently runs roughly: active-card → ac-row (3 buttons) → §01 Presets → §02 Custom Builder → extras pills (with color-blind) → §03 Contrast Check → WCAG panel → auto-fix banner → §04 Per-Context (faded) → §05 Org Rollout (faded) → §06 Live JT Preview → Apply button → Saved Themes → theme-notice.

Note the boundaries of the elements you're moving/deleting. Sketch the target order on paper before editing:
- Keep: active-card (simplified, no ac-row)
- Keep: §01 Presets
- Keep: §02 Custom Builder (drop color-blind pill from extras)
- Keep: §03 Contrast Check + WCAG + auto-fix
- **Insert here**: Apply button (relocated)
- **Insert here**: §04 Saved Themes title (new) + existing saved-themes block
- **Insert here**: `<details>` accordion wrapping §04 Per-Context + §05 Org Rollout
- Delete: §06 Live JT Preview + .jt-preview-pane block
- Delete: ac-row block
- Delete: color-blind pill button
- Delete: theme-notice block

**Step 2: Apply the multi-element edit**

Make the changes via Edit, in this order so you can use precise old_strings:

**(a)** Delete the `<div class="ac-row">…</div>` block (3 buttons: Switch, Save as, Share). Use Edit:
- old: the entire `<div class="ac-row">` block + its closing `</div>` (~10 lines)
- new: empty (delete)

**(b)** Delete the `<button type="button" class="pill-btn" id="colorBlindPreviewBtn">…</button>` from the extras pills row. Use Edit:
- old: just that single button block (~3 lines including the icon)
- new: empty (delete). The two surrounding pill buttons (sampleFromLogoBtn, randomHarmonizedBtn) remain.

**(c)** Move `<button id="applyThemeBtn" class="apply-cta">…</button>` to be immediately after the auto-fix banner. Use TWO Edits:
- First, delete it from its current location (after Saved Themes block).
- Then, insert it after the `<button type="button" class="auto-fix" id="autoFixBtn" hidden>…</button>` block.

The new placement should look like:
```html
            <button type="button" class="auto-fix" id="autoFixBtn" hidden>
              <i class="ph-fill ph-magic-wand"></i>
              <span><strong>Auto-nudge to AA</strong> — gently darkens the offending color without touching the brand</span>
            </button>

            <!-- Apply CTA — sits adjacent to the controls that drive it -->
            <button id="applyThemeBtn" class="apply-cta" type="button">
              <i class="ph-fill ph-check-circle"></i> Apply theme
            </button>
```

**(d)** Add a numbered `§04` section title above the existing `<div class="saved-themes">…</div>` block. Use Edit:
- old: `            <!-- Saved theme slots (kept for slot 0/1/2 storage compatibility) -->\n            <div class="saved-themes">`
- new:
```html
            <!-- §04 Saved Themes — promoted to numbered section adjacent to Apply -->
            <div class="sec-title">
              <span class="num">04</span>
              <h3>Saved Themes</h3>
              <span class="right">3 slots</span>
            </div>
            <div class="saved-themes">
```

**(e)** Wrap the `§04 Per-Context` + `§05 Org Rollout` blocks (currently rendered as faded `.coming-soon` placeholders) in a single `<details>` accordion. Use Edit:
- old: the `<div class="sec-title"><span class="num">04</span><h3>Per-Context</h3>…</div>` line all the way through the closing `</div>` of `<div class="org-card coming-soon">`
- new: same content wrapped in `<details class="theme-coming-soon"><summary>Coming v4.9 — Per-Context &amp; Org Rollout</summary>…content…</details>`

Important: the section numbering inside the accordion stays as `04` and `05` (the design doc accepts this minor inconsistency since the accordion frame disclaims the contents).

**(f)** Delete the entire Live JT Preview block — the `<div class="sec-title">…06…LIVE JT PREVIEW…</div>` title plus the `<div class="jt-preview-pane">…</div>` body (everything from the `06` sec-title down through the `</div>` of `.jt-preview-pane`). Roughly 30+ lines.

**(g)** Delete `<div class="theme-notice" id="themeNotice">…</div>` block (3 lines).

**Step 3: Verify**

Run these greps; each should match the expected count:

```bash
grep -c 'class="ac-row"' JT-Tools-Master/popup/popup.html        # 0
grep -c 'colorBlindPreviewBtn' JT-Tools-Master/popup/popup.html  # 0
grep -c 'class="jt-preview-pane"' JT-Tools-Master/popup/popup.html # 0
grep -c 'jt-themed' JT-Tools-Master/popup/popup.html             # 0
grep -c 'id="themeNotice"' JT-Tools-Master/popup/popup.html      # 0
grep -c 'class="theme-coming-soon"' JT-Tools-Master/popup/popup.html # 1
grep -c 'class="apply-cta"' JT-Tools-Master/popup/popup.html      # 1
grep -c '<h3>Saved Themes</h3>' JT-Tools-Master/popup/popup.html  # 1
```

Read the relevant sections to visually confirm Apply now sits between auto-fix and Saved Themes, and the accordion sits between Saved Themes and the end of `.theme-rebuild`.

**Step 4: Smoke-syntax popup.js**

Run:
```bash
node --check JT-Tools-Master/popup/popup.js && echo "popup.js: syntax OK"
```

Expected: `popup.js: syntax OK`. (popup.js wasn't changed, but popup.js will lookup elements that no longer exist in popup.html. Those lookups are guarded by `if (el)` checks per existing code, so they fall through silently. We'll clean those up in Task 5.)

**Step 5: Commit**

```bash
git add JT-Tools-Master/popup/popup.html
git commit -m "feat(popup): theme tab layout tightening — markup pass

Restructures the Theme tab body to remove vertical fragmentation:
- Drops the Active card's redundant action row (Switch/Save as/Share);
  Presets and Saved Themes already cover those actions.
- Removes the Color-blind Preview pill (its only target was the deleted
  Live JT Preview pane).
- Moves the Apply Theme button up to sit directly under the WCAG meter
  + auto-nudge banner — adjacent to the controls that drive it.
- Promotes Saved Themes to a numbered §04 section right under Apply,
  pairing the slots with the Custom Builder output they capture.
- Wraps the v4.9 Per-Context + Org Rollout placeholders in a single
  <details> accordion (collapsed by default) so they stay discoverable
  without forcing every visit to scroll past them.
- Deletes the Live JT Preview pane + its sec-title (§06) entirely.
- Deletes the 'Enable Custom Theme in Features tab' notice — the master
  toggle added in the prior commit replaces it.

All carry-forward IDs preserved: applyThemeBtn, themeName0/1/2, slot0/1/2
Primary/Background/Text — popup.js wiring continues unchanged.

See docs/plans/2026-05-02-theme-tab-tightening-design.md §A and §C"
```

---

## Task 5: popup.js cleanup

**Files:**
- Modify: `JT-Tools-Master/popup/popup.js`

**Step 1: Remove `refreshJtPreview` function definition**

Find the function block:
```js
function refreshJtPreview(colors, palette) {
  const pane = document.getElementById('jtPreview');
  if (!pane) return;
  pane.style.setProperty('--tp', colors.primary);
  // ...remaining lines...
}
```

Use Edit to delete the entire function (function name `refreshJtPreview`, ~14 lines).

**Step 2: Remove the call site inside `refreshThemeRebuildUI`**

Inside `refreshThemeRebuildUI(colorsArg)` there's a line:
```js
  // Live JT preview
  refreshJtPreview(colors, palette);
```

Delete those two lines (the comment + the call).

**Step 3: Remove the three Active-card button handlers**

Find the v4.8 wiring block (in the DOM-ready handler) that contains:
```js
  // Active-card "Switch" button → focus the preset gallery
  const switchBtn = document.getElementById('themeSwitchBtn');
  if (switchBtn) {
    switchBtn.addEventListener('click', () => {
      const grid = document.getElementById('presetGrid');
      if (grid) grid.scrollIntoView({ behavior: 'smooth', block: 'center' });
    });
  }

  // Active-card "Save as" → push current colors into next empty saved slot
  const saveAsBtn = document.getElementById('themeSaveAsBtn');
  if (saveAsBtn) {
    saveAsBtn.addEventListener('click', async () => {
      const result = await chrome.storage.sync.get(['savedThemes']);
      const slots = result.savedThemes || [null, null, null];
      const empty = slots.findIndex(s => !s);
      if (empty < 0) {
        showStatus('All saved theme slots are full', 'error');
        return;
      }
      saveThemeToSlot(empty);
    });
  }
```

Delete both blocks (~25 lines total). The `themeShareBtn` was not actually wired in popup.js — verify with grep first; if a handler exists, delete it too.

**Step 4: Remove `colorBlindPreviewBtn` handler + `cbToggleOn` state**

Find the block:
```js
  let cbToggleOn = false;
  const cbBtn = document.getElementById('colorBlindPreviewBtn');
  if (cbBtn) {
    cbBtn.addEventListener('click', () => {
      cbToggleOn = !cbToggleOn;
      const pane = document.getElementById('jtPreview');
      if (pane) pane.style.filter = cbToggleOn ? 'grayscale(0.6) saturate(0.7)' : '';
      cbBtn.classList.toggle('is-active', cbToggleOn);
    });
  }
```

Delete the entire block (~10 lines).

**Step 5: Remove dead `themeNotice` lookup if present**

Run:
```bash
grep -n "themeNotice" JT-Tools-Master/popup/popup.js
```

If matches found: read the surrounding context. Likely a `getElementById('themeNotice')` followed by `.style.display = 'block'/'none'` based on rgbTheme state. Delete the entire block — the master toggle replaces this UX.

**Step 6: Verify**

Run:
```bash
grep -n "refreshJtPreview\|jtPreview\|themeSwitchBtn\|themeSaveAsBtn\|themeShareBtn\|colorBlindPreviewBtn\|cbToggleOn\|themeNotice" JT-Tools-Master/popup/popup.js
```

Expected: ZERO matches.

Run:
```bash
node --check JT-Tools-Master/popup/popup.js && echo "popup.js: syntax OK"
```

Expected: `popup.js: syntax OK`.

**Step 7: Commit**

```bash
git add JT-Tools-Master/popup/popup.js
git commit -m "chore(popup): drop dead Theme-tab handlers (Live preview + ac-row)

Removes wiring for elements that no longer exist after the Theme tab
markup tightening:
- refreshJtPreview() function + its call from refreshThemeRebuildUI
- themeSwitchBtn / themeSaveAsBtn / themeShareBtn click handlers
- colorBlindPreviewBtn click handler + cbToggleOn state
- themeNotice visibility toggle (master toggle now handles the UX)

The rgbTheme checkbox itself keeps the same id+data-feature attribute
so the master-feature iteration loop continues to bind it correctly
in its new location at the top of the Theme tab.

See docs/plans/2026-05-02-theme-tab-tightening-design.md §C"
```

---

## Task 6: popup.css cleanup + accordion styling

**Files:**
- Modify: `JT-Tools-Master/popup/popup.css`

**Step 1: Locate the dead selector blocks**

Run:
```bash
grep -n '\.jt-preview-pane\|\.jt-preview-bar\|\.jt-themed\|\.ac-row\|\.theme-notice' JT-Tools-Master/popup/popup.css
```

Note the line ranges. The Live-preview rules cluster in one section of the file (introduced together in v4.8). The `.ac-row` rules are nearby. The `.theme-notice` rules may be elsewhere — note the line.

**Step 2: Delete the Live JT Preview rules**

Read the contiguous block of rules starting with `.jt-preview-pane` and ending after the last `.jt-themed` rule (`.jt-themed .a-red`). It's roughly 100+ lines. Use Edit to delete the entire block (replace with empty/no content).

If the block is preceded or followed by a section comment that's now orphaned, adjust the comment too — leave only meaningful comments.

**Step 3: Delete the `.ac-row` rules**

Find the rules:
```css
.ac-row { ... }
.ac-row button { ... }
.ac-row button:hover { ... }
```

Delete all three. ~15 lines.

**Step 4: Delete the `.theme-notice` rules**

Find:
```css
.theme-notice { ... }
.theme-notice strong { ... }
.theme-notice i { ... }
```

Delete all three. ~12 lines.

**Step 5: Add `<details>` accordion styling**

Append (or place near the end of the v4.8 Theme tab redesign section) this CSS:

```css
/* ── v4.8.2 — v4.9 placeholder accordion ──────────────────────── */
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
.theme-coming-soon > summary::before {
  content: "▸";
  margin-right: 6px;
  display: inline-block;
  transition: transform 150ms var(--ease);
}
.theme-coming-soon[open] > summary::before { transform: rotate(90deg); }
.theme-coming-soon > summary:hover { background: var(--bg-surface); }
.theme-coming-soon[open] > summary { margin-bottom: 8px; }
.theme-coming-soon[open] > .sec-title:first-of-type { margin-top: 4px; }
```

**Step 6: Verify**

Run:
```bash
grep -c '\.jt-preview-pane\|\.jt-preview-bar\|\.jt-themed\|\.ac-row\|\.theme-notice' JT-Tools-Master/popup/popup.css
```
Expected: 0.

Run:
```bash
grep -c '\.theme-coming-soon' JT-Tools-Master/popup/popup.css
```
Expected: ~5 (one per rule that targets the class).

Visually confirm CSS file is well-formed (no orphan closing braces) by reading the area around the deletion points.

**Step 7: Commit**

```bash
git add JT-Tools-Master/popup/popup.css
git commit -m "chore(popup): drop dead CSS for Live preview + ac-row + theme-notice

Removes ~130 lines of selectors that no longer match any markup after
the Theme tab tightening:
- .jt-preview-pane, .jt-preview-bar (+ children), .jt-themed (+ all
  child rules including .stats, .stat, .alerts, .alert variants)
- .ac-row (+ button + hover)
- .theme-notice (+ strong + i)

Adds ~25 lines of <details>/<summary> styling for the v4.9 placeholder
accordion: uppercase mono summary text in accent-ink, bg-raised pill
shape, animated caret rotation on [open], hover state.

See docs/plans/2026-05-02-theme-tab-tightening-design.md §C and §D"
```

---

## Task 7: Release commit — version bump + CHANGELOG

**Files:**
- Modify: `JT-Tools-Master/manifest.json:4`
- Modify: `JT-Tools-Master/manifest.firefox.json:4`
- Modify: `JT-Tools-Master/popup/popup.html` (version chip)
- Modify: `CHANGELOG.md` (new sub-header under `### Changed`)

**Step 1: Bump manifest versions**

Use Edit on both manifests:
- `JT-Tools-Master/manifest.json:4` — `"version": "4.8.1",` → `"version": "4.8.2",`
- `JT-Tools-Master/manifest.firefox.json:4` — same change.

**Step 2: Bump popup version chip**

Use Edit on `JT-Tools-Master/popup/popup.html`:
- old: `<span class="version">v4.8.1</span>`
- new: `<span class="version">v4.8.2</span>`

**Step 3: Add CHANGELOG sub-header**

Read the current `## [Unreleased]` section in `CHANGELOG.md` to find the existing `### Changed` block (added in v4.8.1's reclassification commit `4dd5ee7d`). Insert a new sub-header AT END of that `### Changed` block:

```markdown

#### v4.8.2 — Theme tab layout tightening
- **Custom Theme master toggle moved from Features → Theme tab.** Pro users opening the Theme tab no longer have to backtrack to Features and toggle the feature on before they can use it. Master toggle lives at the top of `#tab-appearance` using the existing `.master-toggle-bar` styling for visual parity with the Features tab "All Features" master strip. Appearance category on Features tab drops from 4 to 3.
- **Live JobTread Preview pane removed.** The faux-JT mock at popup width was overkill — Custom Builder cells already convey color choices, and the preview added vertical scroll without informing the decision. Deletes ~130 lines of CSS and ~25 lines of popup.js (`refreshJtPreview` + color-blind toggle).
- **Apply Theme button moved adjacent to its controls.** Now sits directly under the WCAG meter + auto-nudge banner instead of at the very bottom of the tab — the natural eye flow becomes "build colors → see contrast feedback → apply" with no scrollback.
- **Saved Themes promoted to numbered §04 section.** Three-slot picker is now first-class, sitting immediately under Apply with the same per-slot Save/Load buttons.
- **v4.9 placeholders folded into a `<details>` accordion** ("Coming v4.9 — Per-Context & Org Rollout"). Collapsed by default; native `<summary>` keyboard + screen-reader accessibility. Discoverability preserved without forcing every Theme-tab visit to scroll past them.
- **Active card simplified.** Drop the redundant Switch / Save as / Share action row — those flows are covered by Presets, Saved Themes, and (Share was never wired) deferred indefinitely. Card height drops from 88px → 56px.
- **"Enable Custom Theme in Features tab" notice removed** — the inline master toggle replaces the pre-flight friction.
```

**Step 4: Verify**

Run:
```bash
grep -nE '4\\.8\\.[12]' JT-Tools-Master/manifest.json JT-Tools-Master/manifest.firefox.json JT-Tools-Master/popup/popup.html
```
Expected: zero `4.8.1` matches; three `4.8.2` matches (one per file).

Run:
```bash
python -c "import json; json.load(open('JT-Tools-Master/manifest.json')); json.load(open('JT-Tools-Master/manifest.firefox.json')); print('manifests parse: ok')"
```
Expected: `manifests parse: ok`.

Run:
```bash
head -50 CHANGELOG.md | grep -n 'v4.8.2'
```
Expected: at least one match in the `### Changed` block.

**Step 5: Commit**

```bash
git add CHANGELOG.md JT-Tools-Master/manifest.json JT-Tools-Master/manifest.firefox.json JT-Tools-Master/popup/popup.html
git commit -m "chore(release): v4.8.2

Theme tab layout tightening — master toggle moved from Features to top
of Theme tab, Live JobTread Preview removed, Apply button relocated
adjacent to WCAG meter, Saved Themes promoted to numbered §04 section,
v4.9 placeholders folded into <details> accordion, Active card
simplified.

See docs/plans/2026-05-02-theme-tab-tightening-design.md
Updated CHANGELOG.md."
```

---

## Task 8: Smoke test in preview server

**Files:** none modified.

**Step 1: Start preview server**

Use `mcp__Claude_Preview__preview_start` with `name: "popup"`. Note the returned `serverId`.

**Step 2: Navigate to popup with cache-buster**

Use `mcp__Claude_Preview__preview_eval`:
```js
window.location.href = 'http://localhost:8082/popup.html?nocache=' + Date.now()
```

Wait briefly (the v4.8.1 smoke test learned that python http.server may serve cached responses without a cache-buster query string). After load, force-refresh the popup.css link:
```js
(() => {
  const link = document.querySelector('link[href^="popup.css"]');
  if (link) link.href = 'popup.css?nocache=' + Date.now();
  return 'css link refreshed';
})()
```

Wait ~500ms for the new stylesheet to apply.

**Step 3: Click into the Theme tab**

Use `mcp__Claude_Preview__preview_eval`:
```js
document.querySelector('[data-tab="appearance"]').click(); 'opened'
```

**Step 4: Verify acceptance criteria 1-9**

Use `mcp__Claude_Preview__preview_eval`:
```js
(async () => {
  await new Promise(r => setTimeout(r, 300));
  return JSON.stringify({
    // Master toggle present at top of Theme tab
    masterToggleExists: !!document.querySelector('#tab-appearance .master-toggle-bar #rgbTheme'),
    // rgbTheme NOT in Features tab
    rgbThemeInFeaturesTab: !!document.querySelector('#tab-features #rgbThemeFeature'),
    // Active card simplified (no ac-row)
    acRowExists: !!document.querySelector('.ac-row'),
    // Apply button position: should come BEFORE saved-themes in DOM order
    applyBeforeSaved: (() => {
      const apply = document.getElementById('applyThemeBtn');
      const saved = document.querySelector('.saved-themes');
      if (!apply || !saved) return 'missing element';
      return apply.compareDocumentPosition(saved) & Node.DOCUMENT_POSITION_FOLLOWING ? 'yes' : 'no';
    })(),
    // Saved Themes is now §04 (has a sec-title preceding it)
    savedThemesIsSection: !!document.querySelector('.saved-themes')?.previousElementSibling?.matches?.('.sec-title'),
    // v4.9 accordion exists and is collapsed by default
    accordionExists: !!document.querySelector('details.theme-coming-soon'),
    accordionClosed: !document.querySelector('details.theme-coming-soon')?.open,
    // No Live JT Preview
    livePreviewExists: !!document.querySelector('.jt-preview-pane'),
    // No theme-notice
    themeNoticeExists: !!document.getElementById('themeNotice'),
    // No color-blind pill
    cbBtnExists: !!document.getElementById('colorBlindPreviewBtn'),
    // Appearance category count is 3
    appearanceCount: document.querySelector('[data-category="appearance-features"] .category-count')?.textContent,
    // Version chip
    versionChip: document.querySelector('.version')?.textContent
  });
})()
```

Expected output (every key must match):
```json
{
  "masterToggleExists": true,
  "rgbThemeInFeaturesTab": false,
  "acRowExists": false,
  "applyBeforeSaved": "yes",
  "savedThemesIsSection": true,
  "accordionExists": true,
  "accordionClosed": true,
  "livePreviewExists": false,
  "themeNoticeExists": false,
  "cbBtnExists": false,
  "appearanceCount": "3",
  "versionChip": "v4.8.2"
}
```

If any value is wrong, identify which task left it broken and re-investigate.

**Step 5: Visual confirmation**

Use `mcp__Claude_Preview__preview_screenshot` to capture the Theme tab. Verify visually:
- Master toggle strip at the very top with "Custom Theme [PRO]" + working toggle.
- Compact active card directly below.
- Presets gallery (10 cards) in 3-col grid.
- Custom Builder + extras pills (2 pills now: Sample from logo + Random harmonized — no Color-blind).
- WCAG meter with 4 ratios.
- Apply theme button in orange directly below WCAG.
- Numbered "§04 SAVED THEMES" section with 3 slot rows.
- "▸ Coming v4.9 — Per-Context & Org Rollout" accordion at the bottom, collapsed.
- No Live JT Preview pane visible.
- No "Enable Custom Theme" notice anywhere.

**Step 6: Test the master toggle**

Use `mcp__Claude_Preview__preview_eval`:
```js
(() => {
  const toggle = document.getElementById('rgbTheme');
  const initial = toggle.checked;
  toggle.click();
  const afterClick = toggle.checked;
  toggle.click(); // restore
  return JSON.stringify({ initial, afterClick, restored: toggle.checked });
})()
```

Expected: `afterClick` is the opposite of `initial`, `restored` equals `initial`. Confirms the toggle is interactive (chrome.* errors in this preview context don't prevent the click event from firing).

**Step 7: Test the accordion expand**

Use `mcp__Claude_Preview__preview_eval`:
```js
(() => {
  const acc = document.querySelector('details.theme-coming-soon');
  acc.open = true;
  // Verify children become visible
  const ctxList = acc.querySelector('.ctx-list');
  const orgCard = acc.querySelector('.org-card');
  return JSON.stringify({
    accordionOpen: acc.open,
    ctxListVisible: !!ctxList && ctxList.offsetHeight > 0,
    orgCardVisible: !!orgCard && orgCard.offsetHeight > 0
  });
})()
```

Expected: all three `true`.

**Step 8: Stop preview server**

Use `mcp__Claude_Preview__preview_stop` with the `serverId`.

**Step 9: Push the branch**

```bash
git push -u origin claude/v4.8.2-theme-tightening
```

**Step 10: Confirm branch state on origin**

Run:
```bash
git log --oneline -7
```

Expected (top to bottom):
1. release: v4.8.2
2. css cleanup
3. js cleanup
4. theme tab markup tightening
5. master toggle move
6. design doc commit (4a56612f)
7. v4.8.1 reclassification (or earlier baseline)

---

## Done

All acceptance criteria from `docs/plans/2026-05-02-theme-tab-tightening-design.md` are verified. Local main is still at v4.8.1 — fast-forward merge `claude/v4.8.2-theme-tightening` into main when ready.
