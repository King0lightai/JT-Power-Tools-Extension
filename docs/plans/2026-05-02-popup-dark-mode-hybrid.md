# v4.8.1 Popup Dark-Mode Hybrid + Polish — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Ship v4.8.1 — popup dark mode realigns with the JobTread app's neutral grays plus the marketing site's warm cream text, fix the legacy-alias inheritance bug that broke Tweaks-tab cards in dark mode, remove the redundant "Pro" pill on the Tweaks header, drop the duplicate "Manage Team" link on the Account tab, and swap Tweaks ↔ Account so Account sits on the far right.

**Architecture:** All changes are scoped to four files: [popup.css](../../JT-Tools-Master/popup/popup.css), [popup.html](../../JT-Tools-Master/popup/popup.html), [popup.js](../../JT-Tools-Master/popup/popup.js) (one orphaned block), [manifest.json](../../JT-Tools-Master/manifest.json) + [manifest.firefox.json](../../JT-Tools-Master/manifest.firefox.json) (version bump), [CHANGELOG.md](../../CHANGELOG.md). No new files. No popup.js Theme-tab logic changes. Continues on the `claude/v4.8-theme-rebuild` branch.

**Tech Stack:** Plain CSS custom properties, Phosphor Icons, vanilla JS. Smoke test via the Claude_Preview MCP (python http.server in [`.claude/launch.json`](../../.claude/launch.json) `popup` config).

**Design reference:** [docs/plans/2026-05-02-popup-dark-mode-hybrid-design.md](2026-05-02-popup-dark-mode-hybrid-design.md)

---

## Task 1: Replace `body.dark-theme` token values

**Files:**
- Modify: `JT-Tools-Master/popup/popup.css:109-131`

**Step 1: Read the current `body.dark-theme` block**

Read [popup.css](../../JT-Tools-Master/popup/popup.css) lines 109-131 to confirm the existing token values match the v4.8 baseline (`--bg: var(--jt-coal-050)` etc.).

**Step 2: Replace the token values**

Use Edit to replace the `body.dark-theme` block:

```css
/* ── DARK ─────────────────────────────────────────────────── */
body.dark-theme {
  /* v4.8.1 hybrid palette — app-neutral backgrounds (matches JobTread tab
     when both are open in the user's browser) + website-warm text (reads
     as JT Power Tools branding). See docs/plans/2026-05-02-popup-dark-mode-hybrid-design.md */
  --bg:         #252525;
  --bg-surface: #2c2c2c;
  --bg-raised:  #333333;
  --bg-sunken:  #1f1f1f;

  --fg:         #e0d8c8;
  --fg-strong:  #F2EDE3;
  --fg-muted:   #b0b0b0;
  --fg-subtle:  #909090;

  --rule:       #404040;
  --rule-soft:  #353535;
  --rule-strong:#505050;

  --accent-ink: var(--jt-orange-hot);
  --accent-wash:var(--jt-orange-dim);
  --accent-fg:  #0a0a0a;

  --shadow-sm:  0 1px 2px rgba(0,0,0,.4), 0 1px 3px rgba(0,0,0,.25);
  --shadow-md:  0 4px 12px rgba(0,0,0,.5), 0 2px 4px rgba(0,0,0,.3);
}
```

The keys that change values are 11 total: `--bg`, `--bg-surface`, `--bg-raised`, `--bg-sunken`, `--fg`, `--fg-strong`, `--fg-muted`, `--fg-subtle`, `--rule`, `--rule-soft`, `--rule-strong`. Accent + shadow blocks are unchanged.

**Step 3: Verify no other dark-theme overrides exist that conflict**

Run: `grep -n "body.dark-theme {" JT-Tools-Master/popup/popup.css`
Expected: exactly one match at line 110.

**Step 4: Don't commit yet** — Tasks 1 + 2 ship as one commit (the alias bug fix is part of the same dark-mode pass).

---

## Task 2: Add legacy alias redeclarations to `body.dark-theme`

**Files:**
- Modify: `JT-Tools-Master/popup/popup.css:131` (insert before the closing `}` of `body.dark-theme`)

**Step 1: Confirm the bug**

Without the redeclarations, CSS custom properties resolved at `:root` (where `--bg-elevated: var(--bg-surface)` is declared) bake the LIGHT-mode value of `--bg-surface` (`#ffffff`) into the inherited cascade. Result: `getComputedStyle(blankBtn).getPropertyValue('--bg-elevated')` returns `#ffffff` even on `body.dark-theme`. Verified live during brainstorm session.

**Step 2: Insert the alias redeclaration block**

Use Edit on the `body.dark-theme` block in [popup.css](../../JT-Tools-Master/popup/popup.css). Replace the closing `}` so that the block ends with:

```css
  --shadow-md:  0 4px 12px rgba(0,0,0,.5), 0 2px 4px rgba(0,0,0,.3);

  /* v4.8.1 — legacy alias redeclarations. CSS custom properties resolve at
     the element where they're declared, not at use-site. The aliases at
     :root bake the LIGHT value of their source token (--bg-surface = #ffffff)
     into the inherited cascade and never re-evaluate against the dark-theme
     overrides on body. Redeclaring them inside body.dark-theme forces the
     recompute. Without this, .jt-tweaks-list .tweak-card and .jt-tweaks-action
     render white in dark mode. See docs/plans/2026-05-02-popup-dark-mode-hybrid-design.md §B. */
  --bg-primary:        var(--bg-surface);
  --bg-secondary:      var(--bg);
  --bg-tertiary:       var(--bg-raised);
  --bg-elevated:       var(--bg-surface);
  --text-primary:      var(--fg-strong);
  --text-secondary:    var(--fg);
  --text-tertiary:     var(--fg-muted);
  --border-subtle:     var(--rule-soft);
  --border-default:    var(--rule);
  --border-strong:     var(--rule-strong);
  --brand-orange-glow: var(--accent-wash);
}
```

`--brand-orange`, `--brand-orange-light`, `--brand-orange-dark`, `--radius-*` don't change per-theme so they don't need redeclaration.

**Step 3: Smoke test the alias fix in preview**

Run: `git status` to confirm only [popup.css](../../JT-Tools-Master/popup/popup.css) is modified.

Use the `mcp__Claude_Preview__preview_start` tool with `name: "popup"` to start the static server. Note the returned `serverId`.

Use `mcp__Claude_Preview__preview_eval` with:
```js
window.location.href = 'http://localhost:8082/popup.html'
```

After page loads, use `mcp__Claude_Preview__preview_eval` with:
```js
document.body.classList.add('dark-theme');
JSON.stringify({
  bgElev: getComputedStyle(document.querySelector('[data-action="new"]')).getPropertyValue('--bg-elevated').trim(),
  textPrimary: getComputedStyle(document.body).getPropertyValue('--text-primary').trim(),
  borderDefault: getComputedStyle(document.body).getPropertyValue('--border-default').trim()
})
```

Expected output:
```json
{"bgElev":"#2c2c2c","textPrimary":"#F2EDE3","borderDefault":"#404040"}
```

Each value must use the **dark** v5 source. If any returns `#ffffff` or `#1A1A1A` or another light-mode value, the alias redeclaration is missing or misordered.

**Step 4: Commit Tasks 1 + 2 together**

```bash
git add JT-Tools-Master/popup/popup.css
git commit -m "fix(popup): hybrid dark-mode palette + legacy alias inheritance bug

Tokens in body.dark-theme now match the JobTread app's canonical neutrals
(#2c2c2c family, per CLAUDE.md) on backgrounds + the marketing site's
warm cream (#F2EDE3, from docs/tokens.css) on text. Replaces the v4.8
near-black coal ramp that read as a different surface side-by-side.

Also fixes the legacy alias inheritance bug: --bg-elevated, --text-primary,
--border-default etc. were declared in :root as var(--bg-surface) etc., so
they baked the LIGHT value of their source token and inherited that frozen
value into body.dark-theme. Result: .jt-tweaks-list .tweak-card and
.jt-tweaks-action rendered white in dark mode despite the theme switch.
Redeclaring 11 aliases inside body.dark-theme forces recompute against
the dark v5 tokens. No class renames, no markup changes — carry-forward
Tweaks-tab CSS now inherits correct dark colors automatically.

See docs/plans/2026-05-02-popup-dark-mode-hybrid-design.md"
```

---

## Task 3: Remove "PRO" pill from Tweaks panel header

**Files:**
- Modify: `JT-Tools-Master/popup/popup.html:897`

**Step 1: Locate the line**

Run: `grep -n "Tweaks <span class=\"badge pro\">" JT-Tools-Master/popup/popup.html`
Expected: exactly one match at line 897.

**Step 2: Remove the pill**

Use Edit on [popup.html](../../JT-Tools-Master/popup/popup.html):

old:
```html
              <h2 class="panel-title">Tweaks <span class="badge pro">Pro</span></h2>
```

new:
```html
              <h2 class="panel-title">Tweaks</h2>
```

**Step 3: Verify nothing else references the panel-header pill**

Run: `grep -n "panel-title.*badge pro\|badge pro.*panel-title" JT-Tools-Master/popup/popup.html`
Expected: no matches (panel-title pills are gone).

The per-toggle PRO badges in `.feature-item` rows below the header (lines ~912, 922) are different markup and stay.

**Step 4: Don't commit yet** — Task 3 ships with Task 4 (both are markup polish on the same tab area).

---

## Task 4: Remove duplicate "Manage Team" link + orphan popup.js block

**Files:**
- Modify: `JT-Tools-Master/popup/popup.html:756-759`
- Modify: `JT-Tools-Master/popup/popup.js:2906-2914`

**Step 1: Remove the standalone link in popup.html**

Use Edit on [popup.html](../../JT-Tools-Master/popup/popup.html):

old:
```html
              <a href="https://app.jtpowertools.com/dashboard.html" target="_blank"
                 id="manageTeamLink" class="manage-team-link" style="display: none;">
                <i class="ph ph-users-three"></i> Manage Team <i class="ph ph-arrow-square-out"></i>
              </a>
            </div>
```

new:
```html
            </div>
```

(The closing `</div>` of `.account-logged-in` is preserved — only the `<a>` block is removed.)

**Step 2: Remove the orphaned popup.js toggle**

Use Edit on [popup.js](../../JT-Tools-Master/popup/popup.js) lines 2906-2914:

old:
```js
    // Show "Manage Team" link for owners and admins
    const manageLink = document.getElementById('manageTeamLink');
    if (manageLink) {
      if (user && user.role && (user.role === 'owner' || user.role === 'admin')) {
        manageLink.style.display = '';
      } else {
        manageLink.style.display = 'none';
      }
    }
```

new: delete the block entirely (including the leading comment line).

**Step 3: Verify no remaining references**

Run: `grep -n "manageTeamLink\|manage-team-link" JT-Tools-Master/popup/`
Expected: zero matches across popup.html and popup.js.

The `.manage-team-link` CSS class definition in [popup.css](../../JT-Tools-Master/popup/popup.css) (somewhere around line 1043 from earlier inspection) can stay — it's small and harmless.

**Step 4: Syntax-check popup.js**

Run: `node --check JT-Tools-Master/popup/popup.js && echo "popup.js: syntax OK"`
Expected: `popup.js: syntax OK`

**Step 5: Commit Tasks 3 + 4 together**

```bash
git add JT-Tools-Master/popup/popup.html JT-Tools-Master/popup/popup.js
git commit -m "fix(popup): remove redundant Tweaks 'Pro' pill + duplicate Manage Team link

- Tweaks panel-header pill is redundant with the per-toggle PRO badges
  underneath ('User Tweaks Engine [PRO]', 'Inspect for AI [PRO]') that
  already communicate the gating.
- 'Manage Team' was rendering twice on the Account tab for owners and
  admins with a license: once as a standalone link inside .account-logged-in,
  once inside the Manage on Portal section. Drop the standalone link
  (Portal Links covers it for everyone with a license) and the popup.js
  visibility-toggle block that became orphaned.

See docs/plans/2026-05-02-popup-dark-mode-hybrid-design.md §C"
```

---

## Task 5: Swap Tweaks ↔ Account in tab navigation

**Files:**
- Modify: `JT-Tools-Master/popup/popup.html:44-53` (tab buttons)
- Modify: `JT-Tools-Master/popup/popup.html:511-771` (tab content blocks — verify exact lines after Task 4 edits)

**Step 1: Locate the tab buttons**

Run: `grep -n 'data-tab=' JT-Tools-Master/popup/popup.html | head -10`
Expected: 4 matches in the `.tab-list` for Features, Theme/Appearance, Account, Tweaks (in that order pre-swap).

**Step 2: Reorder the tab buttons**

Use Edit on [popup.html](../../JT-Tools-Master/popup/popup.html). The `.tab-list` block currently reads:

```html
        <button class="tab-item" data-tab="account">
          <i class="ph ph-user-circle tab-icon"></i>
          <span class="tab-label">Account</span>
        </button>
        <button class="tab-item" data-tab="tweaks">
          <i class="ph ph-magic-wand tab-icon"></i>
          <span class="tab-label">Tweaks</span>
        </button>
```

Swap these two `<button>` blocks so Tweaks comes first, Account last. After the edit, the order should be:

```html
        <button class="tab-item" data-tab="tweaks">
          <i class="ph ph-magic-wand tab-icon"></i>
          <span class="tab-label">Tweaks</span>
        </button>
        <button class="tab-item" data-tab="account">
          <i class="ph ph-user-circle tab-icon"></i>
          <span class="tab-label">Account</span>
        </button>
```

**Step 3: Reorder the tab-content blocks**

Find the `.tab-content` blocks for `id="tab-tweaks"` and `id="tab-account"`:
- `id="tab-account"` runs from `<div class="tab-content" id="tab-account">` to its closing `</div>` (multiple hundred lines).
- `id="tab-tweaks"` runs from `<div class="tab-content" id="tab-tweaks">` to its closing `</div>` (~75 lines).

Read both blocks first to confirm exact boundaries (use `grep -n 'tab-content.*id="tab-' JT-Tools-Master/popup/popup.html` for line numbers).

Use Edit to swap them: the `id="tab-tweaks"` block should appear BEFORE the `id="tab-account"` block in the markup. (Visual order doesn't matter for tab switching since the tab logic uses `data-tab` attribute matching, but keyboard-tab traversal walks DOM order — so we keep them aligned.)

**Step 4: Verify the swap**

Run: `grep -n 'tab-content.*id="tab-' JT-Tools-Master/popup/popup.html`

Expected order (top to bottom):
1. `id="tab-features"`
2. `id="tab-appearance"`
3. `id="tab-tweaks"`
4. `id="tab-account"`

**Step 5: Smoke test in preview**

If the preview server from Task 2 is still running, reuse it. Otherwise restart with `mcp__Claude_Preview__preview_start` (`name: "popup"`).

Use `mcp__Claude_Preview__preview_eval` to reload:
```js
window.location.reload()
```

After reload, take a screenshot with `mcp__Claude_Preview__preview_screenshot`. Verify the tab nav reads, left to right: **Features · Theme · Tweaks · Account**.

Click each tab via:
```js
document.querySelector('[data-tab="account"]').click(); 'clicked account'
```

Confirm each tab still activates correctly.

**Step 6: Commit**

```bash
git add JT-Tools-Master/popup/popup.html
git commit -m "feat(popup): swap Tweaks and Account tabs — Account on far right

Tab order is now Features · Theme · Tweaks · Account. Account sits on
the far right where settings/profile tabs conventionally live across
desktop apps; productivity flows (Features → Theme → Tweaks) stay on
the left. Tab switching is wired by data-tab attribute so no popup.js
changes are needed.

See docs/plans/2026-05-02-popup-dark-mode-hybrid-design.md §D"
```

---

## Task 6: Bump version to 4.8.1 (manifests + popup chip)

**Files:**
- Modify: `JT-Tools-Master/manifest.json:4`
- Modify: `JT-Tools-Master/manifest.firefox.json:4`
- Modify: `JT-Tools-Master/popup/popup.html:23` (version chip)

**Step 1: Bump Chrome MV3 manifest**

Use Edit on [manifest.json](../../JT-Tools-Master/manifest.json):
- old: `  "version": "4.8.0",`
- new: `  "version": "4.8.1",`

**Step 2: Bump Firefox MV2 manifest**

Use Edit on [manifest.firefox.json](../../JT-Tools-Master/manifest.firefox.json):
- old: `  "version": "4.8.0",`
- new: `  "version": "4.8.1",`

**Step 3: Bump popup version chip**

Use Edit on [popup.html](../../JT-Tools-Master/popup/popup.html):
- old: `        <span class="version">v4.8.0</span>`
- new: `        <span class="version">v4.8.1</span>`

**Step 4: Verify all three changed**

Run: `grep -n 'v4\\.8\\.\\|"version":' JT-Tools-Master/manifest.json JT-Tools-Master/manifest.firefox.json JT-Tools-Master/popup/popup.html`

Expected: version reads `4.8.1` in all three.

**Step 5: Don't commit yet** — version + CHANGELOG ship as one commit (Task 7).

---

## Task 7: Add v4.8.1 entries to CHANGELOG

**Files:**
- Modify: `CHANGELOG.md` — under `## [Unreleased]`

**Step 1: Read the current Unreleased section**

Run: `head -30 CHANGELOG.md` to find the structure (`## [Unreleased]` header followed by Added / Improved / Fixed subheaders). v4.8 entries are already there from the prior commit.

**Step 2: Add a v4.8.1 sub-header to the existing Improved section**

Use Edit on [CHANGELOG.md](../../CHANGELOG.md) to insert a v4.8.1 sub-header at the END of the existing `### Improved` block (right before the next `### Fixed`):

```markdown
#### v4.8.1 — Popup dark-mode hybrid + polish
- **Hybrid dark-mode palette** ([popup.css](JT-Tools-Master/popup/popup.css)). Replaces the v4.8 near-black coal ramp (`#141414` / `#1a1a1a`) with the JobTread app's canonical neutrals (`#252525` / `#2c2c2c` / `#333333`, per [CLAUDE.md](CLAUDE.md)) on backgrounds, plus the marketing site's warm cream `#F2EDE3` (from [docs/tokens.css](docs/tokens.css)) on text. Net effect: popup backgrounds visually match JobTread when both are open in the user's browser, and text reads as the same brand as jtpowertools.com. Single block edit, light mode untouched.
- **Tab order: Account moves to far right.** Order is now Features · Theme · Tweaks · Account. Account sits where settings/profile tabs conventionally live across desktop apps; productivity flows stay grouped on the left. Tab switching is wired by `data-tab` attribute so no popup.js changes were needed.
```

**Step 3: Add a v4.8.1 sub-header to the existing Fixed section**

Insert at the start of the `### Fixed` block (above the existing v4.8 fixed entries if any):

```markdown
#### v4.8.1 — Popup dark-mode bug fixes
- **Tweaks-tab cards rendered white in dark mode.** Root cause: CSS custom properties resolve at the element where they're declared. The legacy v4.7→v4.8 aliases (`--bg-elevated: var(--bg-surface)`, `--text-primary: var(--fg-strong)`, etc.) lived in `:root`, where they baked the LIGHT value of their source token (`--bg-surface = #ffffff`) into the inherited cascade. The frozen `#ffffff` then inherited down through `<html>` → `<body>` → descendants, never re-evaluating against `body.dark-theme`'s overrides. Result: `.jt-tweaks-list .tweak-card` and `.jt-tweaks-action` ("Blank" button) read white-on-white in dark mode. **Fix:** redeclare 11 legacy aliases inside `body.dark-theme` so they recompute against the dark v5 tokens. No class renames, no markup changes — all carry-forward Tweaks-tab CSS, Account forms, and modals inherit correct dark colors automatically.
- **Tweaks panel-header had a redundant "PRO" pill** ([popup.html](JT-Tools-Master/popup/popup.html)). The per-toggle PRO badges underneath ("User Tweaks Engine [PRO]", "Inspect for AI [PRO]") already communicate the gating. Removed.
- **"Manage Team" was rendering twice** on the Account tab for owners/admins with a license — once as a standalone link inside `.account-logged-in` (popup.js toggled visibility based on role), once inside the Manage on Portal section. Removed the standalone link and its orphaned popup.js visibility-toggle block. The Portal Links entry covers everyone with a license.
```

**Step 4: Commit version bump + CHANGELOG together**

```bash
git add CHANGELOG.md JT-Tools-Master/manifest.json JT-Tools-Master/manifest.firefox.json JT-Tools-Master/popup/popup.html
git commit -m "chore(release): v4.8.1

Hybrid dark-mode palette, legacy-alias inheritance bug fix, redundant
Pro pill removed from Tweaks header, duplicate Manage Team link removed
from Account tab, Tweaks ↔ Account tab swap.

See docs/plans/2026-05-02-popup-dark-mode-hybrid-design.md
Updated CHANGELOG.md."
```

---

## Task 8: Final smoke test (preview server)

**Files:** none modified.

**Step 1: Reload preview**

If the preview server from earlier tasks is still running, reuse the `serverId`. Otherwise start fresh: `mcp__Claude_Preview__preview_start` with `name: "popup"`.

Reload via `mcp__Claude_Preview__preview_eval`:
```js
window.location.reload()
```

**Step 2: Verify dark mode acceptance criteria**

Use `mcp__Claude_Preview__preview_eval`:

```js
document.body.classList.add('dark-theme');
document.querySelector('[data-tab="tweaks"]').click();
JSON.stringify({
  bg: getComputedStyle(document.body).getPropertyValue('--bg').trim(),
  bgSurface: getComputedStyle(document.body).getPropertyValue('--bg-surface').trim(),
  fgStrong: getComputedStyle(document.body).getPropertyValue('--fg-strong').trim(),
  bgElevated: getComputedStyle(document.body).getPropertyValue('--bg-elevated').trim(),
  textPrimary: getComputedStyle(document.body).getPropertyValue('--text-primary').trim(),
  blankBtnBg: getComputedStyle(document.querySelector('[data-action="new"]')).backgroundColor,
  tweaksHeaderProPill: !!document.querySelector('#tab-tweaks .panel-title .badge.pro'),
  manageTeamLinkExists: !!document.getElementById('manageTeamLink')
})
```

Expected JSON:

```json
{
  "bg": "#252525",
  "bgSurface": "#2c2c2c",
  "fgStrong": "#F2EDE3",
  "bgElevated": "#2c2c2c",
  "textPrimary": "#F2EDE3",
  "blankBtnBg": "rgb(44, 44, 44)",
  "tweaksHeaderProPill": false,
  "manageTeamLinkExists": false
}
```

If any value is wrong, the corresponding task did not land. Stop and re-investigate.

**Step 3: Verify tab order visually**

Use `mcp__Claude_Preview__preview_screenshot` and confirm the tab nav reads, left to right: **Features · Theme · Tweaks · Account**.

**Step 4: Verify version chip**

```js
document.querySelector('.version').textContent
```

Expected: `"v4.8.1"`.

**Step 5: Stop the preview server**

Use `mcp__Claude_Preview__preview_stop` with the `serverId`.

**Step 6: Push the branch**

```bash
git push origin claude/v4.8-theme-rebuild
```

**Step 7: Verify the branch is up to date on origin**

Run: `git log --oneline -6` and confirm the v4.8.1 commits sit on top of the v4.8 base + design doc commit.

---

## Done

All acceptance criteria from the design doc are verified:
1. Popup `--bg` is `#252525` (mid-dark cool gray), not `#141414` (near-black). ✓
2. `.jt-tweaks-list .tweak-card` and `.jt-tweaks-action` ("Blank" button) read with dark `#2c2c2c` background, not white. ✓
3. "Tweaks" panel header has no "PRO" pill next to it. ✓
4. Account tab shows exactly one "Manage Team" entry. ✓
5. Tab order is Features · Theme · Tweaks · Account, with Account on the far right. ✓
6. Header chip reads `v4.8.1`. Manifest reports `4.8.1`. CHANGELOG has matching Improved + Fixed entries under `## [Unreleased]`. ✓
