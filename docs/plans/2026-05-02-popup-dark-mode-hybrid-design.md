# v4.8.1 — Popup dark-mode hybrid + polish (design)

**Date:** 2026-05-02
**Branch:** `claude/v4.8-theme-rebuild` (continuing from v4.8 commit `402a66aa`)
**Target version:** 4.8.1
**Status:** approved 2026-05-02

## Context

v4.8 shipped the Theme tab rebuild + popup v5 skin + OKLCH palette engine. In review, four polish items surfaced that didn't make the v4.8 cut:

1. The popup's `body.dark-theme` palette is **two steps darker** than either the JobTread app dark mode (per [CLAUDE.md](../../CLAUDE.md) canonical palette) or the marketing website ([docs/tokens.css](../../docs/tokens.css)). Side-by-side it reads as a different surface.
2. **Tweaks-tab cards render white in dark mode.** Bug, not a styling oversight — see Section B below.
3. **"PRO" pill on the Tweaks panel header is redundant** with the per-toggle PRO badges underneath.
4. **"Manage Team" link appears twice** on the Account tab when the user is an owner/admin with a license.

The user also requested **Account move to the far right** of the tab nav, swapping with Tweaks.

The **Theme tab layout** needs a separate iteration — flagged here as out-of-scope for v4.8.1 and deferred to a fresh brainstorm pass.

## Goals

- Popup dark mode reads as the same brand surface as JobTread when both are open in the user's browser, and as the same brand as the marketing site for typography continuity.
- Carry-forward Tweaks-tab + Account-tab markup keeps working — no class-name churn, no JS rewrites for v4.8.1.
- Ship as a quick follow-up patch on the existing v4.8 branch.

## Non-goals

- Theme tab layout iteration (separate brainstorm).
- App `dark-mode.css` and website `tokens.css` are not modified — they're already correct; the popup is the outlier.
- Per-Context routing or Org Rollout backend — still v4.9.

---

## A. Hybrid dark-mode palette (popup tokens only)

Replace the very-dark coal ramp in `body.dark-theme` with the canonical app neutrals (per CLAUDE.md), and bump foreground text up to the website's warm cream so the popup still reads as JT Power Tools branding.

### Token map

| Token | v4.8 (current) | v4.8.1 (new) | Source |
|---|---|---|---|
| `--bg` | `#141414` | `#252525` | App secondary bg (headers/footers) |
| `--bg-surface` | `#1a1a1a` | `#2c2c2c` | App primary container bg |
| `--bg-raised` | `#222222` | `#333333` | App elevated bg (also website `--bg`) |
| `--bg-sunken` | `#0d0d0d` | `#1f1f1f` | One step below `--bg` |
| `--rule` | `#2a2a2a` | `#404040` | App primary border |
| `--rule-soft` | `#222222` | `#353535` | Subtle rule, between bg and rule |
| `--rule-strong` | `#3a3a3a` | `#505050` | App secondary border |
| `--fg-strong` | `#f5f5f5` (cool) | `#F2EDE3` (**warm**) | Website `--ink` |
| `--fg` | `#d5d5d5` (cool) | `#e0d8c8` (warm) | Slight warm tint |
| `--fg-muted` | `#8a8a8a` | `#b0b0b0` | App secondary text |
| `--fg-subtle` | `#606060` | `#909090` | App muted/icons |

### Why hybrid

Two surfaces the popup sits next to:

- **JobTread tab** in the same browser — uses cool neutral grays (`#2c2c2c` family, per CLAUDE.md and app `dark-mode.css`).
- **Marketing site** at jtpowertools.com — uses warm-tinted neutrals (`#333333` bg + warm cream `#F2EDE3` text).

The cool neutrals belong on **backgrounds** (so the popup feels at home next to JobTread). The warm cream belongs on **text** (so the popup reads as the same brand as the marketing site). Orange accent already bridges both. Single edit, no new aliases.

### Net diff

~13 lines changed in the `body.dark-theme` block of [JT-Tools-Master/popup/popup.css](../../JT-Tools-Master/popup/popup.css). The light-mode `:root` block is untouched.

---

## B. Bug — legacy aliases freeze at `:root` and never see the dark-mode override

### Symptom

In dark mode, `.jt-tweaks-action` ("Blank" button), `.jt-tweaks-list .tweak-card` cards, and a few other carry-forward Tweaks-tab elements render with **white backgrounds + dark text** — totally broken contrast. Live computed value of `--bg-elevated` is `#ffffff` even on `body.dark-theme`.

### Root cause

CSS custom properties resolve at the element where they're declared, not at the use-site. The legacy v4.7→v4.8 aliases live in `:root`:

```css
:root {
  --bg-elevated: var(--bg-surface);  /* baked to #ffffff at root, then inherited */
  --text-primary: var(--fg-strong);
  --border-default: var(--rule);
  /* …13 aliases total… */
}
```

When the browser resolves `--bg-elevated` at `:root`, `var(--bg-surface)` evaluates against `:root`'s own `--bg-surface` — which is `#ffffff` (the light-mode value). That **frozen** `#ffffff` is then inherited down through `<html>` → `<body>` → descendants, regardless of whether `body.dark-theme` overrides `--bg-surface` later. The alias never re-evaluates.

### Fix

Re-declare the legacy aliases inside `body.dark-theme` so they recompute against the dark `--bg-surface` / `--fg-strong` / `--rule` etc.:

```css
body.dark-theme {
  /* ...new dark token block from Section A... */

  /* Legacy aliases redeclared so they recompute against dark v5 tokens.
     Without this, --bg-elevated etc. are frozen to their light-root values. */
  --bg-primary:    var(--bg-surface);
  --bg-secondary:  var(--bg);
  --bg-tertiary:   var(--bg-raised);
  --bg-elevated:   var(--bg-surface);
  --text-primary:  var(--fg-strong);
  --text-secondary:var(--fg);
  --text-tertiary: var(--fg-muted);
  --border-subtle: var(--rule-soft);
  --border-default:var(--rule);
  --border-strong: var(--rule-strong);
  --brand-orange-glow: var(--accent-wash);
  /* (--brand-orange and --r-* don't change per-theme; skip those) */
}
```

13 lines. No class renames, no markup changes — the entire carry-forward Tweaks-tab CSS, Account-tab forms, and modal styles inherit correct dark colors automatically.

### Verification

After fix: `getComputedStyle(blankBtn).getPropertyValue('--bg-elevated')` should return `#2c2c2c` (the new dark `--bg-surface`), not `#ffffff`.

---

## C. Markup polish

### C1. Remove "PRO" pill from Tweaks panel header

[JT-Tools-Master/popup/popup.html](../../JT-Tools-Master/popup/popup.html) line 897:

```html
<!-- before -->
<h2 class="panel-title">Tweaks <span class="badge pro">Pro</span></h2>

<!-- after -->
<h2 class="panel-title">Tweaks</h2>
```

Per-toggle PRO badges underneath ("User Tweaks Engine [PRO]", "Inspect for AI [PRO]") already communicate the gating. The header pill is redundant.

### C2. Remove duplicate "Manage Team" link

[JT-Tools-Master/popup/popup.html](../../JT-Tools-Master/popup/popup.html) lines 756–759 — the standalone link inside `.account-logged-in`:

```html
<!-- delete this block -->
<a href="https://app.jtpowertools.com/dashboard.html" target="_blank"
   id="manageTeamLink" class="manage-team-link" style="display: none;">
  <i class="ph ph-users-three"></i> Manage Team <i class="ph ph-arrow-square-out"></i>
</a>
```

The `.portal-links` section's "Manage Team" entry (line 853) covers this for everyone with a license. Owners/admins were seeing both because popup.js shows the standalone link conditionally on top of the always-present portal entry.

Also remove the now-orphaned popup.js block at lines 2906–2914 that toggles its visibility:

```js
// delete: now-orphaned, the element is gone
const manageLink = document.getElementById('manageTeamLink');
if (manageLink) {
  if (user && user.role && (user.role === 'owner' || user.role === 'admin')) {
    manageLink.style.display = '';
  } else {
    manageLink.style.display = 'none';
  }
}
```

---

## D. Tab order — Account moves to far right

[JT-Tools-Master/popup/popup.html](../../JT-Tools-Master/popup/popup.html) `.tab-list` (lines ~36-50): swap the Tweaks and Account `<button class="tab-item">` blocks so the rendered order becomes:

> **Features · Theme · Tweaks · Account**

Also swap the corresponding `.tab-content` blocks (around lines 511-693 vs 696-770) so keyboard-tab traversal order matches visual order.

No popup.js changes needed — tab switching is wired by `data-tab` attribute, not DOM position.

### Why

Account sits on the far right where settings/profile tabs conventionally live across desktop apps. Productivity flows live on the left (Features → Theme → Tweaks).

---

## Implementation order

Single commit on `claude/v4.8-theme-rebuild`:

1. Edit `body.dark-theme` block in [popup.css](../../JT-Tools-Master/popup/popup.css) — replace 11 token values + add 11 legacy alias redeclarations.
2. Remove "Pro" pill from Tweaks panel-header in [popup.html](../../JT-Tools-Master/popup/popup.html).
3. Remove standalone "Manage Team" link block + corresponding popup.js toggle.
4. Swap Tweaks ↔ Account `.tab-item` and `.tab-content` blocks.
5. Bump manifest + popup version chip to **4.8.1**.
6. Add Improved + Fixed entries under `## [Unreleased]` in CHANGELOG.
7. Smoke test: re-spin preview, toggle dark mode, verify Tweaks "Blank" button + cards now use dark backgrounds; verify duplicate Manage Team gone; verify tab order correct.

## Risks

- **None obvious.** All carry-forward markup is untouched; alias-redeclaration is the smallest possible fix for the inheritance bug; tab swap is order-only with no JS hooks bound to DOM position.
- **Possible regression:** if any third file outside the popup uses `--bg-elevated` etc. and relied on the buggy `#ffffff` value in dark mode, this fix surfaces correct dark color and could change visual appearance. Search confirmed: those tokens are only consumed inside [popup.css](../../JT-Tools-Master/popup/popup.css).

## Out of scope (deferred)

- **Theme tab layout iteration** — separate brainstorm pass after v4.8.1 ships.
- **Per-Context routing wiring** — v4.9 (needs new storage schema).
- **Org Rollout backend** — v4.9 (needs `/api/themes/push` on the license proxy).
- **Tweaks-tab class refresh to popup (2).html's new `tweak-card` markup** — v4.9 (popup.js Tweaks-engine wiring would need to be rewritten end-to-end; the v4.8.1 carry-forward + alias fix gives a working dark-mode Tweaks tab today without that rewrite).

## Acceptance

Loaded into Chrome as the unpacked extension and toggled to dark mode, all of the following are true:

1. Popup `--bg` is `#252525` (mid-dark cool gray), not `#141414` (near-black).
2. `.jt-tweaks-list .tweak-card` and `.jt-tweaks-action` ("Blank" button) read with dark `#2c2c2c` background, not white.
3. "Tweaks" panel header has no "PRO" pill next to it.
4. Account tab shows exactly one "Manage Team" entry (the one in Manage on Portal).
5. Tab order is Features · Theme · Tweaks · Account, with Account on the far right.
6. Header chip reads `v4.8.1`. Manifest reports `4.8.1`. CHANGELOG has matching Improved + Fixed entries under `## [Unreleased]`.
