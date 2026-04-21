# Portal Redesign v4 Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Rewrite the 5-page portal at `app.jtpowertools.com` (`portal/`) using the new warm editorial design system — same tokens, type stack, and dark-mode toggle as the public site rewrite in PR #[current].

**Architecture:** Vanilla HTML/CSS/JS, no build step. Import `tokens.css` from the public site (copy into `portal/css/`). One rewritten `portal.css`, one new `portal.js` for gating + section switching. `auth.js` and `api.js` untouched. Deploy stays identical (Cloudflare Workers static assets via `wrangler.jsonc`).

**Tech Stack:** HTML5, CSS3 (custom properties, grid, clamp()), vanilla JS, Google Fonts (Anton/Oswald/Inter/Instrument Serif/JetBrains Mono), Phosphor Icons via CDN.

**Design reference:** [docs/plans/2026-04-20-portal-redesign-v4-design.md](./2026-04-20-portal-redesign-v4-design.md). Copy, tokens, and section specs live there.

**Working dir:** `portal/`. All changes scoped to that folder plus `CHANGELOG.md` at repo root.

---

## Phase 0 — Preparation

### Task 0.1: Archive the current stylesheet

**Files:**
- Rename: `portal/css/portal.css` → `portal/css/portal.v3.css`

**Steps:**

1. Run: `git mv portal/css/portal.css portal/css/portal.v3.css`
2. DO NOT update any HTML pages to reference `portal.v3.css` — every HTML page in `portal/` will be rewritten in later tasks and will reference a NEW `portal.css`. The `.v3.css` file is kept only as a reference during the rewrite; remove it once the redesign ships.
3. Commit:
   ```bash
   git add portal/
   git commit -m "chore: archive portal/css/portal.css to portal.v3.css before v4 rewrite"
   ```

**Verify:** `ls portal/css/` shows only `portal.v3.css`. The 4 existing HTML pages temporarily have broken `<link rel="stylesheet" href="css/portal.css">` references — that's fine, they'll be rewritten in Phase 3+.

---

## Phase 1 — Foundation (tokens, base CSS, JS helpers, assets)

### Task 1.1: Copy `tokens.css` from the site

**Files:**
- Create: `portal/css/tokens.css`

**Steps:**

1. `cp docs/tokens.css portal/css/tokens.css`
2. Verify contents are identical to `docs/tokens.css`.
3. Commit:
   ```bash
   git add portal/css/tokens.css
   git commit -m "feat: add design tokens to portal (copy of docs/tokens.css)"
   ```

**Verify:** `diff docs/tokens.css portal/css/tokens.css` returns nothing.

---

### Task 1.2: Copy brand mark images

**Files:**
- Create: `portal/jt-symbol-black.png`
- Create: `portal/jt-symbol-white.png`

**Steps:**

1. `cp docs/jt-symbol-black.png portal/jt-symbol-black.png`
2. `cp docs/jt-symbol-white.png portal/jt-symbol-white.png`
3. Commit:
   ```bash
   git add portal/jt-symbol-black.png portal/jt-symbol-white.png
   git commit -m "feat: add JT brand marks to portal (copy from docs/)"
   ```

---

### Task 1.3: Create the new `portal/css/portal.css` — base, typography, utilities

**Files:**
- Create: `portal/css/portal.css`

**Steps:**

1. Write the file. It has the same structure as `docs/styles.css` but scoped for the portal's needs. Sections 1–5 cover foundation; 6 and up cover portal-specific layouts (added in later tasks).

   Write sections 1–5 now with the following content:

   ```css
   /* =========================================================
      1. Imports
      ========================================================= */
   @import url('tokens.css');

   /* =========================================================
      2. Resets + base
      ========================================================= */
   *, *::before, *::after { box-sizing: border-box; }
   html { scroll-behavior: smooth; -webkit-text-size-adjust: 100%; }
   body {
     margin: 0;
     font-family: var(--font-body);
     font-size: 16px;
     line-height: 1.55;
     color: var(--ink);
     background: var(--bg);
     transition: background var(--dur) var(--ease), color var(--dur) var(--ease);
     -webkit-font-smoothing: antialiased;
     text-rendering: optimizeLegibility;
   }
   img, svg { display: block; max-width: 100%; }
   a { color: inherit; text-decoration: none; }
   button { font: inherit; cursor: pointer; border: 0; background: transparent; color: inherit; }
   ul { list-style: none; padding: 0; margin: 0; }

   :focus-visible {
     outline: 2px solid var(--orange);
     outline-offset: 2px;
     border-radius: var(--r-sm);
   }

   /* =========================================================
      3. Typography utilities
      ========================================================= */
   .t-display {
     font-family: var(--font-display);
     font-size: clamp(40px, 5vw, 72px);
     line-height: 0.95;
     letter-spacing: 0.005em;
     text-transform: uppercase;
     color: var(--ink);
     margin: 0;
   }
   .t-display .accent { color: var(--orange); }
   .t-display .serif { font-family: var(--font-serif); font-style: italic; color: var(--ink-italic); text-transform: none; letter-spacing: 0; }

   .t-label {
     font-family: var(--font-sub);
     font-weight: 600;
     font-size: 12px;
     letter-spacing: 0.12em;
     text-transform: uppercase;
     color: var(--orange);
   }
   .t-lede {
     font-family: var(--font-body);
     font-weight: 500;
     font-size: clamp(16px, 1.2vw, 18px);
     line-height: 1.5;
     color: var(--ink-muted);
     max-width: 60ch;
   }

   /* =========================================================
      4. Layout utilities
      ========================================================= */
   .container {
     width: 100%;
     max-width: 1280px;
     margin: 0 auto;
     padding: 0 clamp(20px, 4vw, 48px);
   }

   /* =========================================================
      5. Components
      ========================================================= */
   .btn {
     display: inline-flex;
     align-items: center;
     justify-content: center;
     gap: 8px;
     padding: 12px 20px;
     font-family: var(--font-body);
     font-weight: 600;
     font-size: 15px;
     border-radius: var(--r-pill);
     transition: transform var(--dur) var(--ease), background var(--dur) var(--ease), color var(--dur) var(--ease), border-color var(--dur) var(--ease);
     border: 1px solid transparent;
     white-space: nowrap;
   }
   .btn:hover { transform: translateY(-1px); }
   .btn--primary { background: var(--orange); color: #fff; }
   .btn--primary:hover { background: var(--orange-dark); }
   .btn--ghost { background: transparent; color: var(--ink); border-color: var(--ink); }
   .btn--ghost:hover { background: var(--ink); color: var(--bg); }
   .btn--danger-ghost { background: transparent; color: #c0392b; border-color: #c0392b; }
   .btn--danger-ghost:hover { background: #c0392b; color: #fff; }
   .btn--block { display: flex; width: 100%; }

   .pill {
     display: inline-flex;
     align-items: center;
     gap: 6px;
     padding: 5px 10px;
     border-radius: var(--r-pill);
     font-family: var(--font-sub);
     font-weight: 600;
     font-size: 11px;
     letter-spacing: 0.12em;
     text-transform: uppercase;
   }
   .pill--tier-free { border: 1px solid var(--ink-subtle); color: var(--ink-subtle); }
   .pill--tier-essential { background: color-mix(in srgb, var(--teal) 10%, transparent); border: 1px solid var(--teal); color: var(--teal); }
   .pill--tier-pro { background: color-mix(in srgb, var(--orange) 10%, transparent); border: 1px solid var(--orange); color: var(--orange); }
   .pill--tier-power { background: color-mix(in srgb, var(--purple) 10%, transparent); border: 1px solid var(--purple); color: var(--purple); }
   .pill--status-active { background: color-mix(in srgb, #22c55e 10%, transparent); border: 1px solid #22c55e; color: #15803d; }
   .pill--status-warn { background: color-mix(in srgb, #f59e0b 10%, transparent); border: 1px solid #f59e0b; color: #b45309; }
   .pill--status-off { background: var(--surface-inset); border: 1px solid var(--border); color: var(--ink-subtle); }

   .card {
     background: var(--surface);
     border: 1px solid var(--border);
     border-radius: var(--r-lg);
     padding: 24px;
   }
   .card + .card { margin-top: 20px; }
   .card-header {
     display: flex;
     align-items: baseline;
     justify-content: space-between;
     gap: 12px;
     margin-bottom: 16px;
   }
   .card-header h3 {
     font-family: var(--font-sub);
     font-weight: 600;
     font-size: 16px;
     letter-spacing: 0.04em;
     text-transform: uppercase;
     color: var(--ink);
     margin: 0;
   }
   .card-header p {
     font-size: 14px;
     color: var(--ink-muted);
     margin: 0;
   }

   /* Inputs */
   .form-group { margin-bottom: 18px; }
   .form-group label {
     display: block;
     font-family: var(--font-body);
     font-weight: 500;
     font-size: 13px;
     color: var(--ink-muted);
     margin-bottom: 6px;
   }
   .form-group input[type="text"],
   .form-group input[type="email"],
   .form-group input[type="password"],
   .form-group select,
   .form-group textarea {
     width: 100%;
     height: 48px;
     padding: 0 14px;
     font-family: var(--font-body);
     font-size: 15px;
     color: var(--ink);
     background: var(--surface);
     border: 1px solid var(--border);
     border-radius: var(--r-sm);
     transition: border-color var(--dur) var(--ease);
   }
   .form-group textarea { height: auto; min-height: 96px; padding: 12px 14px; line-height: 1.5; }
   .form-group input:focus,
   .form-group select:focus,
   .form-group textarea:focus {
     outline: none;
     border-color: var(--orange);
     box-shadow: 0 0 0 2px color-mix(in srgb, var(--orange) 30%, transparent);
   }

   /* Alert */
   .alert {
     display: none;
     align-items: center;
     gap: 10px;
     padding: 12px 14px;
     border-radius: var(--r-sm);
     font-size: 14px;
     margin-bottom: 16px;
   }
   .alert.show { display: flex; }
   .alert-success { background: var(--peach); color: var(--ink); }
   .alert-error { background: color-mix(in srgb, #ef4444 12%, var(--bg)); color: #991b1b; }

   /* Tables */
   .tbl { width: 100%; border-collapse: collapse; font-size: 14.5px; }
   .tbl th, .tbl td { padding: 12px 14px; text-align: left; border-bottom: 1px solid var(--border); }
   .tbl th {
     font-family: var(--font-sub);
     font-weight: 600;
     font-size: 11px;
     letter-spacing: 0.12em;
     text-transform: uppercase;
     color: var(--ink-subtle);
   }
   .tbl tbody tr:hover { background: color-mix(in srgb, var(--surface-inset) 60%, transparent); }
   .tbl .cell-right { text-align: right; }
   .tbl-empty {
     padding: 32px 16px;
     text-align: center;
     color: var(--ink-subtle);
   }

   /* Copy + reveal buttons */
   .kv-row {
     display: flex;
     align-items: center;
     gap: 10px;
     padding: 12px 14px;
     background: var(--surface-inset);
     border: 1px solid var(--border);
     border-radius: var(--r-sm);
     font-family: var(--font-mono);
     font-size: 13.5px;
     color: var(--ink);
   }
   .kv-row code { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
   .kv-row button { flex-shrink: 0; padding: 4px 8px; font-size: 13px; color: var(--ink-muted); }
   .kv-row button:hover { color: var(--orange); }

   /* Reveal animation */
   .reveal { opacity: 0; transform: translateY(10px); transition: opacity 0.6s var(--ease), transform 0.6s var(--ease); }
   .reveal.is-visible { opacity: 1; transform: translateY(0); }
   @media (prefers-reduced-motion: reduce) {
     .reveal { opacity: 1; transform: none; transition: none; }
     * { transition-duration: 0.01ms !important; animation-duration: 0.01ms !important; }
     html { scroll-behavior: auto; }
   }
   ```

2. Commit:
   ```bash
   git add portal/css/portal.css
   git commit -m "feat: add portal base styles, typography, and components"
   ```

**Verify:** File is ~240 lines. No portal-specific layouts yet (those come in later tasks).

---

### Task 1.4: Create `portal/js/theme.js`

**Files:**
- Create: `portal/js/theme.js`

**Steps:**

1. Copy `docs/theme.js` → `portal/js/theme.js`:
   ```bash
   cp docs/theme.js portal/js/theme.js
   ```
2. Commit:
   ```bash
   git add portal/js/theme.js
   git commit -m "feat: add theme toggle script to portal"
   ```

---

### Task 1.5: Create `portal/js/portal.js` — section switching, gating, utilities

**Files:**
- Create: `portal/js/portal.js`

**Steps:**

1. Write the file. Full content:

   ```javascript
   // portal.js — dashboard behavior: section switching, tier/role gating,
   // mobile tab sync, copy-to-clipboard, password reveal.
   (function () {
     const TIER_RANK = { free: 0, essential: 1, pro: 2, power_user: 3 };

     function isAdmin(user) {
       return !!user && ['owner', 'admin'].includes(user.role);
     }
     function isPowerUser(user) {
       return !!user && (TIER_RANK[user.tier] ?? 0) >= TIER_RANK.power_user;
     }

     function applyVisibility(user) {
       const visibility = {
         account: true,
         mcp: isPowerUser(user) && isAdmin(user),
         'api-keys': isPowerUser(user) && isAdmin(user),
         team: isAdmin(user),
       };
       document.querySelectorAll('[data-section-link]').forEach(el => {
         const key = el.getAttribute('data-section-link');
         el.hidden = !visibility[key];
       });
       // If the current hash targets a hidden section, fall back to account
       const hash = (location.hash || '').replace('#', '');
       if (hash && visibility[hash] === false) {
         showToast("That section isn't available on your plan.");
         activateSection('account');
         history.replaceState(null, '', '#account');
       }
     }

     function activateSection(key) {
       document.querySelectorAll('.dashboard-section').forEach(s => {
         s.classList.toggle('is-active', s.getAttribute('data-section') === key);
       });
       document.querySelectorAll('[data-section-link]').forEach(l => {
         l.classList.toggle('is-active', l.getAttribute('data-section-link') === key);
         if (l.getAttribute('role') === 'tab') {
           l.setAttribute('aria-selected', l.classList.contains('is-active') ? 'true' : 'false');
         }
       });
       window.scrollTo({ top: 0, behavior: 'instant' });
     }

     function initSectionSwitching() {
       document.querySelectorAll('[data-section-link]').forEach(link => {
         link.addEventListener('click', (e) => {
           e.preventDefault();
           const key = link.getAttribute('data-section-link');
           activateSection(key);
           history.replaceState(null, '', '#' + key);
         });
       });
       const startHash = (location.hash || '#account').replace('#', '');
       activateSection(startHash || 'account');
     }

     function initCopyToClipboard() {
       document.addEventListener('click', async (e) => {
         const btn = e.target.closest('[data-copy]');
         if (!btn) return;
         const targetSel = btn.getAttribute('data-copy');
         const el = targetSel ? document.querySelector(targetSel) : btn.previousElementSibling;
         if (!el) return;
         const value = el.dataset.value || el.textContent || '';
         try {
           await navigator.clipboard.writeText(value.trim());
           showToast('Copied');
         } catch {
           showToast('Copy failed');
         }
       });
     }

     function initPasswordReveal() {
       document.addEventListener('click', (e) => {
         const btn = e.target.closest('[data-reveal]');
         if (!btn) return;
         const targetSel = btn.getAttribute('data-reveal');
         const input = document.querySelector(targetSel);
         if (!input) return;
         input.type = input.type === 'password' ? 'text' : 'password';
         btn.setAttribute('aria-pressed', input.type === 'text' ? 'true' : 'false');
       });
     }

     function showToast(msg) {
       let toast = document.getElementById('portal-toast');
       if (!toast) {
         toast = document.createElement('div');
         toast.id = 'portal-toast';
         toast.setAttribute('role', 'status');
         toast.setAttribute('aria-live', 'polite');
         document.body.appendChild(toast);
       }
       toast.textContent = msg;
       toast.classList.add('is-visible');
       clearTimeout(showToast._t);
       showToast._t = setTimeout(() => toast.classList.remove('is-visible'), 1800);
     }

     async function bootstrap() {
       initSectionSwitching();
       initCopyToClipboard();
       initPasswordReveal();
       // User info is loaded elsewhere (auth.js / dashboard inline script).
       // Expose applyVisibility so the dashboard can call it after user loads.
       window.portal = Object.assign(window.portal || {}, { applyVisibility, activateSection, showToast });
     }

     if (document.readyState === 'loading') {
       document.addEventListener('DOMContentLoaded', bootstrap);
     } else {
       bootstrap();
     }
   })();
   ```

2. Commit:
   ```bash
   git add portal/js/portal.js
   git commit -m "feat: add portal dashboard behavior script"
   ```

---

### Task 1.6: Add toast + gating CSS to `portal.css`

**Files:**
- Modify: `portal/css/portal.css` (append section 6)

**Steps:**

1. Append to `portal.css`:

   ```css
   /* =========================================================
      6. Toast + hidden helpers
      ========================================================= */
   #portal-toast {
     position: fixed;
     bottom: 24px;
     left: 50%;
     transform: translateX(-50%) translateY(20px);
     padding: 10px 16px;
     background: var(--ink);
     color: var(--bg);
     border-radius: var(--r-pill);
     font-size: 13.5px;
     font-weight: 500;
     opacity: 0;
     pointer-events: none;
     transition: opacity 0.2s var(--ease), transform 0.2s var(--ease);
     z-index: 100;
   }
   #portal-toast.is-visible {
     opacity: 1;
     transform: translateX(-50%) translateY(0);
   }

   [hidden] { display: none !important; }
   ```

2. Commit:
   ```bash
   git add portal/css/portal.css
   git commit -m "feat: add portal toast styles"
   ```

---

## Phase 2 — Shared shell (nav + auth shared markup)

### Task 2.1: Nav CSS

**Files:**
- Modify: `portal/css/portal.css` (append section 7)

**Steps:**

1. Append:

   ```css
   /* =========================================================
      7. Nav
      ========================================================= */
   .portal-nav {
     position: sticky;
     top: 0;
     z-index: 50;
     background: var(--bg);
     border-bottom: 1px solid var(--border);
     backdrop-filter: saturate(180%) blur(6px);
     -webkit-backdrop-filter: saturate(180%) blur(6px);
   }
   .portal-nav-inner {
     display: flex;
     align-items: center;
     justify-content: space-between;
     padding: 12px clamp(16px, 3vw, 32px);
     gap: 16px;
   }
   .portal-brand {
     display: inline-flex;
     align-items: center;
     gap: 10px;
     font-family: var(--font-sub);
     font-weight: 700;
     text-transform: uppercase;
     letter-spacing: 0.06em;
     font-size: 15px;
     color: var(--ink);
   }
   .portal-brand-mark {
     width: 32px;
     height: 32px;
     display: inline-block;
     flex-shrink: 0;
   }
   .portal-brand-mark img {
     width: 100%;
     height: 100%;
     object-fit: contain;
     display: block;
   }
   .portal-brand-mark .portal-brand-mark--dark { display: none; }
   html[data-theme="dark"] .portal-brand-mark .portal-brand-mark--light { display: none; }
   html[data-theme="dark"] .portal-brand-mark .portal-brand-mark--dark { display: block; }
   @media (prefers-color-scheme: dark) {
     html:not([data-theme]) .portal-brand-mark .portal-brand-mark--light { display: none; }
     html:not([data-theme]) .portal-brand-mark .portal-brand-mark--dark { display: block; }
   }

   .portal-nav-right {
     display: flex;
     align-items: center;
     gap: 10px;
   }
   .portal-theme {
     display: inline-flex;
     align-items: center;
     gap: 6px;
     padding: 6px 12px;
     border-radius: var(--r-pill);
     font-family: var(--font-body);
     font-weight: 500;
     font-size: 13px;
     color: var(--ink-muted);
     background: var(--surface-inset);
     border: 1px solid var(--border);
   }
   .portal-theme:hover { color: var(--ink); }

   .user-pill {
     display: inline-flex;
     align-items: center;
     gap: 8px;
     padding: 4px 12px 4px 4px;
     border-radius: var(--r-pill);
     background: var(--surface-inset);
     border: 1px solid var(--border);
     font-size: 13.5px;
   }
   .user-pill .avatar {
     width: 28px;
     height: 28px;
     border-radius: 50%;
     background: var(--orange);
     color: #fff;
     display: inline-flex;
     align-items: center;
     justify-content: center;
     font-family: var(--font-sub);
     font-weight: 600;
     font-size: 12px;
     text-transform: uppercase;
   }
   .user-pill .user-name { color: var(--ink); font-weight: 500; }
   ```

2. Commit:
   ```bash
   git add portal/css/portal.css
   git commit -m "feat: add portal nav + user pill styles"
   ```

---

### Task 2.2: Nav HTML fragment reference

**Note:** the nav is copy-pasted into each page. The "full-user" variant has theme toggle + user pill + sign out. The "minimal" variant (auth pages) has only theme toggle + logo.

**Full-user nav fragment** (for `dashboard.html`):

```html
<header class="portal-nav">
  <div class="portal-nav-inner">
    <a class="portal-brand" href="dashboard.html">
      <span class="portal-brand-mark">
        <img class="portal-brand-mark--light" src="jt-symbol-black.png" alt="" aria-hidden="true">
        <img class="portal-brand-mark--dark" src="jt-symbol-white.png" alt="" aria-hidden="true">
      </span>
      <span>Power Tools</span>
    </a>
    <div class="portal-nav-right">
      <button class="portal-theme" data-theme-toggle aria-pressed="false" aria-label="Toggle theme">
        <i class="ph ph-moon" data-theme-icon aria-hidden="true"></i>
        <span data-theme-label>Dark</span>
      </button>
      <span class="user-pill">
        <span class="avatar" id="navAvatar">?</span>
        <span class="user-name" id="navName">Loading…</span>
      </span>
      <button class="btn btn--ghost btn-sm" onclick="auth.logout()">Sign Out</button>
    </div>
  </div>
</header>
```

**Minimal nav fragment** (for auth pages):

```html
<header class="portal-nav">
  <div class="portal-nav-inner">
    <a class="portal-brand" href="index.html">
      <span class="portal-brand-mark">
        <img class="portal-brand-mark--light" src="jt-symbol-black.png" alt="" aria-hidden="true">
        <img class="portal-brand-mark--dark" src="jt-symbol-white.png" alt="" aria-hidden="true">
      </span>
      <span>Power Tools</span>
    </a>
    <button class="portal-theme" data-theme-toggle aria-pressed="false" aria-label="Toggle theme">
      <i class="ph ph-moon" data-theme-icon aria-hidden="true"></i>
      <span data-theme-label>Dark</span>
    </button>
  </div>
</header>
```

**Steps:** Save these as a scratch reference in `docs/plans/2026-04-20-portal-redesign-v4-fragments.md` for copy-paste. This is a no-commit task.

---

## Phase 3 — Auth pages

### Task 3.1: Auth split-screen CSS

**Files:**
- Modify: `portal/css/portal.css` (append section 8)

**Steps:**

1. Append:

   ```css
   /* =========================================================
      8. Auth split-screen
      ========================================================= */
   .auth-shell {
     min-height: calc(100vh - 57px);
     display: grid;
     grid-template-columns: 1fr 1fr;
   }
   @media (max-width: 1000px) {
     .auth-shell { grid-template-columns: 1fr; }
   }

   .auth-form-col {
     display: flex;
     align-items: center;
     justify-content: center;
     padding: clamp(32px, 5vw, 64px);
   }
   .auth-form {
     width: 100%;
     max-width: 440px;
   }
   .auth-form .t-label { display: block; margin-bottom: 12px; }
   .auth-form h1 {
     font-family: var(--font-display);
     font-size: clamp(48px, 6vw, 72px);
     line-height: 0.95;
     text-transform: uppercase;
     letter-spacing: 0.005em;
     margin: 0 0 12px;
   }
   .auth-form h1 .accent { color: var(--orange); }
   .auth-form p.lede {
     font-size: 15px;
     color: var(--ink-muted);
     margin: 0 0 28px;
   }
   .auth-form .secondary-link {
     font-size: 13.5px;
     color: var(--ink-muted);
   }
   .auth-form .secondary-link a { color: var(--orange); font-weight: 500; }
   .auth-form .secondary-link a:hover { color: var(--orange-dark); }
   .auth-form .loading-row { display: none; align-items: center; gap: 8px; }
   .btn.is-loading .btn-text { visibility: hidden; }
   .btn.is-loading .loading-row { display: inline-flex; position: absolute; }
   .btn { position: relative; }
   .spinner {
     width: 14px;
     height: 14px;
     border: 2px solid rgba(255,255,255,0.4);
     border-top-color: #fff;
     border-radius: 50%;
     animation: spin 0.7s linear infinite;
   }
   @keyframes spin { to { transform: rotate(360deg); } }

   .auth-brand-col {
     position: relative;
     overflow: hidden;
     background: var(--bg);
     display: flex;
     align-items: center;
     justify-content: center;
   }
   @media (max-width: 1000px) { .auth-brand-col { display: none; } }
   .auth-watermark {
     position: absolute;
     top: 50%;
     left: 50%;
     width: clamp(400px, 45vw, 600px);
     transform: translate(-50%, -50%) rotate(15deg);
     opacity: 0.08;
     pointer-events: none;
   }
   html[data-theme="dark"] .auth-watermark--light { display: none; }
   .auth-watermark--dark { display: none; }
   html[data-theme="dark"] .auth-watermark--dark { display: block; }
   @media (prefers-color-scheme: dark) {
     html:not([data-theme]) .auth-watermark--light { display: none; }
     html:not([data-theme]) .auth-watermark--dark { display: block; }
   }
   .auth-tagline {
     position: relative;
     z-index: 1;
     font-family: var(--font-sub);
     font-weight: 600;
     font-size: 14px;
     letter-spacing: 0.14em;
     text-transform: uppercase;
     color: var(--orange);
     text-align: center;
     padding: 0 32px;
   }
   ```

2. Commit:
   ```bash
   git add portal/css/portal.css
   git commit -m "feat: add auth split-screen styles"
   ```

---

### Task 3.2: Rewrite `portal/index.html` (sign in)

**Files:**
- Modify: `portal/index.html` (full rewrite)

**Steps:**

1. Replace entire file. Content:

   ```html
   <!DOCTYPE html>
   <html lang="en">
   <head>
     <meta charset="UTF-8">
     <meta name="viewport" content="width=device-width, initial-scale=1.0">
     <title>Sign In — JT Power Tools</title>
     <script>(function(){try{var t=localStorage.getItem('jt4-theme');if(t==='dark'||t==='light')document.documentElement.setAttribute('data-theme',t);}catch(e){}})();</script>
     <link rel="icon" type="image/png" href="https://jtpowertools.com/favicon.png">
     <link rel="preconnect" href="https://fonts.googleapis.com">
     <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
     <link href="https://fonts.googleapis.com/css2?family=Anton&family=Oswald:wght@500;600;700&family=Inter:wght@400;500;600;700&family=Instrument+Serif:ital@0;1&family=JetBrains+Mono:wght@400;500&display=swap" rel="stylesheet">
     <link rel="stylesheet" href="https://unpkg.com/@phosphor-icons/web@2.0.3/src/regular/style.css">
     <link rel="stylesheet" href="https://unpkg.com/@phosphor-icons/web@2.0.3/src/fill/style.css">
     <link rel="stylesheet" href="css/portal.css">
   </head>
   <body>
     <!-- PASTE MINIMAL NAV FRAGMENT -->

     <main class="auth-shell">
       <div class="auth-form-col">
         <div class="auth-form">
           <span class="t-label">Sign In</span>
           <h1><span>Welcome</span> <span class="accent">back.</span></h1>
           <p class="lede">Sign in to manage your team, connections, and API keys.</p>

           <div id="alert" class="alert" role="alert"></div>

           <form id="loginForm" autocomplete="on">
             <div class="form-group">
               <label for="email">Email</label>
               <input type="email" id="email" name="email" placeholder="you@company.com" required autocomplete="email">
             </div>
             <div class="form-group">
               <label for="password">Password</label>
               <input type="password" id="password" name="password" placeholder="Your password" required autocomplete="current-password">
             </div>
             <button type="submit" class="btn btn--primary btn--block" id="submitBtn">
               <span class="btn-text">Sign In</span>
               <span class="loading-row"><span class="spinner"></span><span>Signing in…</span></span>
             </button>
           </form>

           <p class="secondary-link" style="text-align:right; margin-top:8px;"><a href="forgot-password.html">Forgot password?</a></p>

           <p class="secondary-link" style="text-align:center; margin-top:24px;">New here? <a href="register.html">Create an account</a></p>

           <p class="secondary-link" style="text-align:center; margin-top:12px;">Need a license? <a href="https://jtpowertools.com/#pricing" target="_blank">Pick a plan</a></p>
         </div>
       </div>

       <div class="auth-brand-col" aria-hidden="true">
         <img class="auth-watermark auth-watermark--light" src="jt-symbol-black.png" alt="">
         <img class="auth-watermark auth-watermark--dark" src="jt-symbol-white.png" alt="">
         <span class="auth-tagline">The missing piece of your JobTread workflow</span>
       </div>
     </main>

     <script src="js/auth.js"></script>
     <script src="js/api.js"></script>
     <script src="js/theme.js"></script>
     <script>
       auth.redirectIfLoggedIn();
       const form = document.getElementById('loginForm');
       const btn = document.getElementById('submitBtn');
       const alert = document.getElementById('alert');
       function showAlert(msg, type = 'error') {
         alert.textContent = msg;
         alert.className = `alert alert-${type} show`;
       }
       form.addEventListener('submit', async (e) => {
         e.preventDefault();
         btn.classList.add('is-loading');
         btn.disabled = true;
         alert.classList.remove('show');
         try {
           await auth.login(
             document.getElementById('email').value,
             document.getElementById('password').value
           );
           window.location.href = 'dashboard.html';
         } catch (err) {
           showAlert(err.message || 'Sign in failed. Please try again.');
         } finally {
           btn.classList.remove('is-loading');
           btn.disabled = false;
         }
       });
     </script>
   </body>
   </html>
   ```

2. Paste the minimal nav fragment (from Task 2.2) where indicated.
3. Commit:
   ```bash
   git add portal/index.html
   git commit -m "feat: rewrite portal sign-in page with split-screen layout"
   ```

**Verify:** Page loads, form submits, dark toggle works, watermark swaps theme.

---

### Task 3.3: Rewrite `portal/register.html`

**Files:**
- Modify: `portal/register.html` (full rewrite)

**Steps:**

1. Use the same scaffold as `index.html` (Task 3.2). Replace:
   - Title: `Create Account — JT Power Tools`
   - Label: `CREATE ACCOUNT`
   - Heading: `<span>Join the</span> <span class="accent">kit.</span>`
   - Lede: *"Create your JT Power Tools account to manage your team and connections."*
   - Form: fields for displayName, email, password, confirmPassword, invite code (if applicable — check current `register.html` for exact fields)
   - Submit button text: `Create Account` / loading `Creating…`
   - Secondary link: *"Already have an account? Sign in"* → `index.html`
   - Inline script: keeps current register flow logic from the old file

2. Copy form-field structure and submit handler from the OLD register.html (in git history: `git show HEAD~N:portal/register.html`). Preserve all hidden fields, invite code handling, URL query param reading.

3. Commit:
   ```bash
   git add portal/register.html
   git commit -m "feat: rewrite portal register page with split-screen layout"
   ```

---

### Task 3.4: Rewrite `portal/forgot-password.html`

**Files:**
- Modify: `portal/forgot-password.html` (full rewrite)

**Steps:**

1. Same scaffold as index.html. Content-specific:
   - Title: `Reset Password — JT Power Tools`
   - Label: `RESET PASSWORD`
   - Heading: `<span>Forgot</span> <span class="accent">password?</span>`
   - Lede: *"Enter your email and we'll send you a reset link."*
   - Form: single email field + Send Reset Link button
   - Secondary link: *"Remember it? Sign in"* → `index.html`
   - Keep submit handler from the OLD forgot-password.html
2. Commit:
   ```bash
   git add portal/forgot-password.html
   git commit -m "feat: rewrite portal forgot-password page with split-screen layout"
   ```

---

### Task 3.5: Rewrite `portal/reset-password.html`

**Files:**
- Modify: `portal/reset-password.html` (full rewrite)

**Steps:**

1. Same scaffold. Content-specific:
   - Title: `Set New Password — JT Power Tools`
   - Label: `NEW PASSWORD`
   - Heading: `<span>Set a</span> <span class="accent">new one.</span>`
   - Lede: *"Enter your new password below to finish resetting."*
   - Form: new password + confirm fields, each with a `[data-reveal]` toggle button
   - Submit: Update Password
   - Secondary link: *"Need a new link?"* → `forgot-password.html`
   - Keep submit handler from the OLD file (token in URL param)
2. Commit:
   ```bash
   git add portal/reset-password.html
   git commit -m "feat: rewrite portal reset-password page with split-screen layout"
   ```

---

### Task 3.6: Auth pages — manual QA pass

**Steps:**

1. Serve `portal/` locally (e.g., `cd portal && python -m http.server 8081`) — or use preview tool if available.
2. Load each auth page, both themes, 3 breakpoints (375/768/1440). Verify:
   - Split-screen shows on ≥ 1000px
   - Watermark is faint and visible
   - Form inputs have orange focus ring
   - Submit buttons show loading state
   - Mobile hides the brand column and centers the form
3. No tracked commits from this task unless bugs are found.

---

## Phase 4 — Dashboard shell

### Task 4.1: Dashboard layout CSS

**Files:**
- Modify: `portal/css/portal.css` (append section 9)

**Steps:**

1. Append:

   ```css
   /* =========================================================
      9. Dashboard layout
      ========================================================= */
   .dashboard-shell {
     display: grid;
     grid-template-columns: 240px 1fr;
     min-height: calc(100vh - 57px);
   }
   @media (max-width: 1000px) {
     .dashboard-shell { grid-template-columns: 1fr; }
   }

   /* Sidebar (desktop) */
   .dashboard-sidebar {
     background: var(--surface-inset);
     border-right: 1px solid var(--border);
     padding: 24px 16px;
     position: sticky;
     top: 57px;
     align-self: start;
     height: calc(100vh - 57px);
     display: flex;
     flex-direction: column;
     gap: 24px;
   }
   @media (max-width: 1000px) { .dashboard-sidebar { display: none; } }
   .sidebar-nav { display: flex; flex-direction: column; gap: 4px; }
   .sidebar-item {
     display: flex;
     align-items: center;
     gap: 12px;
     padding: 12px 14px;
     border-radius: var(--r-sm);
     font-family: var(--font-body);
     font-weight: 500;
     font-size: 15px;
     color: var(--ink-muted);
     cursor: pointer;
     transition: background var(--dur) var(--ease), color var(--dur) var(--ease);
     border-left: 3px solid transparent;
     margin-left: -3px;
   }
   .sidebar-item i { font-size: 18px; flex-shrink: 0; }
   .sidebar-item:hover { background: var(--surface); color: var(--ink); }
   .sidebar-item.is-active {
     background: var(--surface);
     color: var(--ink);
     border-left-color: var(--orange);
     font-weight: 600;
   }
   .sidebar-item.is-active i::before { font-family: 'Phosphor-Fill'; }
   .sidebar-footer {
     margin-top: auto;
     padding: 12px 14px;
     font-family: var(--font-sub);
     font-weight: 600;
     font-size: 11px;
     letter-spacing: 0.12em;
     text-transform: uppercase;
     color: var(--ink-subtle);
     display: flex;
     flex-direction: column;
     gap: 6px;
   }
   .sidebar-footer a { color: var(--ink-muted); }
   .sidebar-footer a:hover { color: var(--orange); }

   /* Top tabs (mobile) */
   .dashboard-tabs {
     display: none;
     background: var(--surface-inset);
     border-bottom: 1px solid var(--border);
     overflow-x: auto;
     scrollbar-width: none;
   }
   .dashboard-tabs::-webkit-scrollbar { display: none; }
   @media (max-width: 1000px) { .dashboard-tabs { display: flex; } }
   .dashboard-tabs .sidebar-item {
     flex-shrink: 0;
     border-left: 0;
     border-bottom: 3px solid transparent;
     margin-left: 0;
     border-radius: 0;
     padding: 14px 20px;
   }
   .dashboard-tabs .sidebar-item.is-active {
     background: transparent;
     border-bottom-color: var(--orange);
     color: var(--ink);
   }

   /* Main content */
   .dashboard-main {
     padding: clamp(24px, 4vw, 56px);
     max-width: 1100px;
     width: 100%;
     margin: 0 auto;
   }

   /* Section panels */
   .dashboard-section { display: none; }
   .dashboard-section.is-active { display: block; }
   .section-head {
     margin-bottom: clamp(28px, 4vw, 48px);
   }
   .section-head .t-label { display: block; margin-bottom: 10px; }
   .section-head h1 {
     font-family: var(--font-display);
     font-size: clamp(40px, 5vw, 64px);
     line-height: 0.95;
     text-transform: uppercase;
     letter-spacing: 0.005em;
     margin: 0 0 10px;
   }
   .section-head h1 .accent { color: var(--orange); }
   .section-head p { font-size: 16px; color: var(--ink-muted); max-width: 60ch; margin: 0; }
   ```

2. Commit:
   ```bash
   git add portal/css/portal.css
   git commit -m "feat: add dashboard sidebar + top-tabs layout styles"
   ```

---

### Task 4.2: Scaffold `portal/dashboard.html`

**Files:**
- Modify: `portal/dashboard.html` (full rewrite; content of each section comes in later tasks)

**Steps:**

1. Replace entire file with the scaffold — head, full-user nav, sidebar + tabs, empty section containers.

   ```html
   <!DOCTYPE html>
   <html lang="en">
   <head>
     <meta charset="UTF-8">
     <meta name="viewport" content="width=device-width, initial-scale=1.0">
     <title>Dashboard — JT Power Tools</title>
     <script>(function(){try{var t=localStorage.getItem('jt4-theme');if(t==='dark'||t==='light')document.documentElement.setAttribute('data-theme',t);}catch(e){}})();</script>
     <link rel="icon" type="image/png" href="https://jtpowertools.com/favicon.png">
     <link rel="preconnect" href="https://fonts.googleapis.com">
     <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
     <link href="https://fonts.googleapis.com/css2?family=Anton&family=Oswald:wght@500;600;700&family=Inter:wght@400;500;600;700&family=Instrument+Serif:ital@0;1&family=JetBrains+Mono:wght@400;500&display=swap" rel="stylesheet">
     <link rel="stylesheet" href="https://unpkg.com/@phosphor-icons/web@2.0.3/src/regular/style.css">
     <link rel="stylesheet" href="https://unpkg.com/@phosphor-icons/web@2.0.3/src/fill/style.css">
     <link rel="stylesheet" href="css/portal.css">
   </head>
   <body>
     <!-- PASTE FULL-USER NAV FRAGMENT -->

     <!-- Mobile top-tabs (hidden on desktop) -->
     <nav class="dashboard-tabs" aria-label="Sections (mobile)">
       <a href="#account" class="sidebar-item" role="tab" data-section-link="account" aria-selected="true"><i class="ph ph-user" aria-hidden="true"></i>Account</a>
       <a href="#mcp" class="sidebar-item" role="tab" data-section-link="mcp" hidden><i class="ph ph-robot" aria-hidden="true"></i>MCP</a>
       <a href="#api-keys" class="sidebar-item" role="tab" data-section-link="api-keys" hidden><i class="ph ph-key" aria-hidden="true"></i>API Keys</a>
       <a href="#team" class="sidebar-item" role="tab" data-section-link="team" hidden><i class="ph ph-users-three" aria-hidden="true"></i>Team</a>
     </nav>

     <div class="dashboard-shell">
       <aside class="dashboard-sidebar" aria-label="Sections">
         <nav class="sidebar-nav">
           <a href="#account" class="sidebar-item is-active" role="tab" data-section-link="account" aria-selected="true"><i class="ph ph-user" aria-hidden="true"></i>Account</a>
           <a href="#mcp" class="sidebar-item" role="tab" data-section-link="mcp" hidden><i class="ph ph-robot" aria-hidden="true"></i>MCP</a>
           <a href="#api-keys" class="sidebar-item" role="tab" data-section-link="api-keys" hidden><i class="ph ph-key" aria-hidden="true"></i>API Keys</a>
           <a href="#team" class="sidebar-item" role="tab" data-section-link="team" hidden><i class="ph ph-users-three" aria-hidden="true"></i>Team</a>
         </nav>
         <div class="sidebar-footer">
           <span>Portal v4.0</span>
           <a href="https://jtpowertools.com" target="_blank" rel="noopener"><i class="ph ph-arrow-square-out"></i> jtpowertools.com</a>
         </div>
       </aside>

       <main class="dashboard-main">
         <section class="dashboard-section is-active" data-section="account" id="section-account" role="tabpanel">
           <!-- Task 5.x inserts Account cards here -->
         </section>
         <section class="dashboard-section" data-section="mcp" id="section-mcp" role="tabpanel">
           <!-- Task 6.x inserts MCP cards here -->
         </section>
         <section class="dashboard-section" data-section="api-keys" id="section-api-keys" role="tabpanel">
           <!-- Task 7.x inserts API Keys cards here -->
         </section>
         <section class="dashboard-section" data-section="team" id="section-team" role="tabpanel">
           <!-- Task 8.x inserts Team cards here -->
         </section>
       </main>
     </div>

     <script src="js/auth.js"></script>
     <script src="js/api.js"></script>
     <script src="js/theme.js"></script>
     <script src="js/portal.js"></script>
     <script>
       // Load user + apply tier/role gating
       (async function() {
         if (!auth.isLoggedIn()) { location.href = 'index.html'; return; }
         try {
           const meData = await api.request('/auth/me', { method: 'POST' });
           const user = meData.user;
           auth.setUser(user);
           // Populate user pill
           document.getElementById('navAvatar').textContent = (user.displayName || user.email)[0].toUpperCase();
           document.getElementById('navName').textContent = user.displayName || user.email;
           // Apply tier/role visibility
           window.portal.applyVisibility(user);
           // Optionally kick off section-specific loaders here — populated in later tasks
         } catch (err) {
           console.error('Dashboard init failed:', err);
           if (err.status === 401) auth.logout();
         }
       })();
     </script>
   </body>
   </html>
   ```

2. Paste the full-user nav fragment from Task 2.2 where indicated.

3. Commit:
   ```bash
   git add portal/dashboard.html
   git commit -m "feat: scaffold dashboard with sidebar + top tabs and tier gating hook"
   ```

---

## Phase 5 — Account section

### Task 5.1: Account section markup

**Files:**
- Modify: `portal/dashboard.html` (insert markup into `#section-account`)

**Steps:**

1. Inside `<section id="section-account">`, insert:

   ```html
   <div class="section-head">
     <span class="t-label">Account</span>
     <h1><span>Your</span> <span class="accent">profile.</span></h1>
     <p>Manage your name, email, and password.</p>
   </div>

   <div class="card">
     <div class="card-header">
       <h3>Profile</h3>
     </div>
     <form id="profileForm">
       <div class="form-group">
         <label for="profileName">Display name</label>
         <input type="text" id="profileName" required>
       </div>
       <div class="form-group">
         <label for="profileEmail">Email</label>
         <input type="email" id="profileEmail" readonly>
         <small style="display:block; margin-top:6px; color:var(--ink-subtle); font-size:12.5px;">Contact support to change your email.</small>
       </div>
       <button type="submit" class="btn btn--primary" id="profileSave" disabled>Save Changes</button>
     </form>
   </div>

   <div class="card">
     <div class="card-header">
       <h3>Password</h3>
     </div>
     <form id="passwordForm">
       <div class="form-group">
         <label for="currentPassword">Current password</label>
         <input type="password" id="currentPassword" required>
       </div>
       <div class="form-group">
         <label for="newPassword">New password</label>
         <input type="password" id="newPassword" required minlength="8">
       </div>
       <div class="form-group">
         <label for="confirmPassword">Confirm new password</label>
         <input type="password" id="confirmPassword" required minlength="8">
       </div>
       <button type="submit" class="btn btn--ghost">Change Password</button>
     </form>
   </div>

   <div class="card" id="planCard">
     <div class="card-header">
       <h3>Org &amp; Plan</h3>
     </div>
     <dl style="display:grid; grid-template-columns: auto 1fr; gap: 10px 20px; margin: 0;">
       <dt style="color:var(--ink-muted); font-size:14px;">Organization</dt>
       <dd id="planOrg" style="margin:0; font-weight:500;"></dd>
       <dt style="color:var(--ink-muted); font-size:14px;">Plan</dt>
       <dd style="margin:0;"><span class="pill" id="planTier"></span></dd>
       <dt style="color:var(--ink-muted); font-size:14px;">Members</dt>
       <dd id="planMembers" style="margin:0;"></dd>
       <dt style="color:var(--ink-muted); font-size:14px;">Renews</dt>
       <dd id="planRenew" style="margin:0;"></dd>
     </dl>
     <div style="margin-top:16px;">
       <a href="https://lightking7.gumroad.com/l/jtpowertools" target="_blank" rel="noopener" class="btn btn--ghost btn-sm">Manage subscription <i class="ph ph-arrow-square-out"></i></a>
     </div>
     <div id="upsellStrip" hidden style="margin-top:20px; padding:14px 16px; background:var(--peach); border-radius:var(--r-sm); font-size:14px;">
       <strong>Unlock MCP + API Keys</strong> by upgrading to Power User → <a href="https://jtpowertools.com/#pricing" target="_blank" style="color:var(--orange); font-weight:600;">See pricing</a>
     </div>
   </div>

   <div class="card">
     <div class="card-header">
       <h3>Sign out of all sessions</h3>
       <p>Ends your session on every browser and device.</p>
     </div>
     <button id="signOutAllBtn" class="btn btn--danger-ghost">Sign out everywhere</button>
   </div>
   ```

2. Extend the bootstrap inline script in `dashboard.html` to populate these fields. Reuse the logic in the OLD `dashboard.html` for profile/password/plan (see `git show HEAD~N:portal/dashboard.html` for the exact API calls). Preserve the original handlers.

3. Commit:
   ```bash
   git add portal/dashboard.html
   git commit -m "feat: add Account section markup and data bindings"
   ```

---

## Phase 6 — MCP section

### Task 6.1: MCP section markup

**Files:**
- Modify: `portal/dashboard.html`
- Modify: `portal/css/portal.css` (small additions for MCP card grid)

**Steps:**

1. Append to `portal.css`:

   ```css
   /* MCP client grid */
   .mcp-client-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 14px; }
   @media (max-width: 900px) { .mcp-client-grid { grid-template-columns: repeat(2, 1fr); } }
   @media (max-width: 560px) { .mcp-client-grid { grid-template-columns: 1fr; } }
   .mcp-client-card {
     display: flex;
     align-items: center;
     gap: 12px;
     padding: 14px;
     background: var(--surface);
     border: 1px solid var(--border);
     border-radius: var(--r-sm);
     transition: border-color var(--dur) var(--ease);
   }
   .mcp-client-card:hover { border-color: var(--ink); }
   .mcp-client-logo {
     width: 32px; height: 32px;
     background: #fff;
     border-radius: 6px;
     display: inline-flex; align-items: center; justify-content: center;
     padding: 4px;
     flex-shrink: 0;
   }
   .mcp-client-card h4 { margin: 0; font-size: 14.5px; }
   .mcp-client-card a { color: var(--orange); font-size: 13px; margin-left: auto; }
   ```

2. Inside `<section id="section-mcp">`, insert:

   ```html
   <div class="section-head">
     <span class="t-label">MCP Server</span>
     <h1><span>AI</span> <span class="accent">access.</span></h1>
     <p>Connect Claude, ChatGPT, or any MCP-aware client to JobTread.</p>
   </div>

   <div class="card">
     <div class="card-header">
       <h3>MCP endpoint</h3>
     </div>
     <div class="kv-row">
       <code id="mcpEndpoint" data-value="https://jobtread-mcp-server.king0light-ai.workers.dev/mcp">https://jobtread-mcp-server.king0light-ai.workers.dev/mcp</code>
       <button data-copy="#mcpEndpoint" aria-label="Copy endpoint URL"><i class="ph ph-copy"></i></button>
     </div>
     <p style="margin-top:10px; color:var(--ink-muted); font-size:13.5px;">Works with Claude desktop, ChatGPT custom GPTs, Cursor, Gemini, and any MCP-aware client.</p>
   </div>

   <div class="card">
     <div class="card-header">
       <h3>Grant Key</h3>
     </div>
     <div class="kv-row">
       <code id="mcpKey" data-value="">••••••••••••••••</code>
       <button data-reveal="#mcpKey" aria-pressed="false" aria-label="Reveal key"><i class="ph ph-eye"></i></button>
       <button data-copy="#mcpKey" aria-label="Copy key"><i class="ph ph-copy"></i></button>
     </div>
     <button class="btn btn--danger-ghost btn-sm" id="rotateKeyBtn" style="margin-top:14px;">Rotate key</button>
     <p style="margin-top:10px; color:var(--ink-muted); font-size:13px;">Rotating invalidates the current key on all connected clients.</p>
   </div>

   <div class="card">
     <div class="card-header">
       <h3>Approved Senders</h3>
       <p>Emails allowed to forward bills for MCP ingestion.</p>
     </div>
     <table class="tbl" id="approvedSendersTable">
       <thead><tr><th>Email</th><th>Added</th><th>Added by</th><th></th></tr></thead>
       <tbody id="approvedSendersBody"></tbody>
     </table>
     <div id="approvedSendersEmpty" class="tbl-empty" hidden>No approved senders yet.</div>
     <form id="addSenderForm" style="margin-top:14px; display:flex; gap:10px;">
       <input type="email" id="addSenderEmail" placeholder="sender@vendor.com" required style="flex:1;">
       <button type="submit" class="btn btn--primary btn-sm">Add sender</button>
     </form>
   </div>

   <div class="card">
     <div class="card-header">
       <h3>Setup Guides</h3>
     </div>
     <div class="mcp-client-grid">
       <a class="mcp-client-card" href="https://jtpowertools.com/mcp/chatgpt.html" target="_blank">
         <span class="mcp-client-logo"><img src="https://jtpowertools.com/ChatGPT-Logo.svg.png" alt=""></span>
         <h4>ChatGPT</h4>
         <span>Guide →</span>
       </a>
       <a class="mcp-client-card" href="https://jtpowertools.com/mcp/other.html" target="_blank">
         <span class="mcp-client-logo"><img src="https://jtpowertools.com/Claude_AI_symbol.svg" alt=""></span>
         <h4>Claude</h4>
         <span>Guide →</span>
       </a>
       <a class="mcp-client-card" href="https://jtpowertools.com/mcp/gemini.html" target="_blank">
         <span class="mcp-client-logo"><img src="https://jtpowertools.com/gemini-color.png" alt=""></span>
         <h4>Gemini</h4>
         <span>Guide →</span>
       </a>
       <a class="mcp-client-card" href="https://jtpowertools.com/mcp/grok.html" target="_blank">
         <span class="mcp-client-logo"><img src="https://jtpowertools.com/grok--v2.png" alt=""></span>
         <h4>Grok</h4>
         <span>Guide →</span>
       </a>
       <a class="mcp-client-card" href="https://jtpowertools.com/mcp/claude-code.html" target="_blank">
         <span class="mcp-client-logo"><i class="ph ph-terminal"></i></span>
         <h4>Claude Code</h4>
         <span>Guide →</span>
       </a>
       <a class="mcp-client-card" href="https://jtpowertools.com/mcp/cursor.html" target="_blank">
         <span class="mcp-client-logo"><i class="ph ph-code"></i></span>
         <h4>Cursor</h4>
         <span>Guide →</span>
       </a>
     </div>
   </div>
   ```

3. Port MCP-specific handlers (fetch endpoint, rotate key, load approved senders, add/remove sender) from the OLD dashboard.html. Preserve their API calls exactly.

4. Commit:
   ```bash
   git add portal/dashboard.html portal/css/portal.css
   git commit -m "feat: add MCP section markup and data bindings"
   ```

---

## Phase 7 — API Keys section

### Task 7.1: API Keys section markup

**Files:**
- Modify: `portal/dashboard.html`
- Modify: `portal/css/portal.css` (minor)

**Steps:**

1. Append to `portal.css`:

   ```css
   .onboarding-band {
     background: var(--peach);
     border: 1px solid color-mix(in srgb, var(--orange) 30%, transparent);
     border-radius: var(--r-sm);
     padding: 14px 16px;
     margin-bottom: 20px;
     display: flex;
     gap: 12px;
     align-items: flex-start;
   }
   .onboarding-band i { color: var(--orange); font-size: 18px; flex-shrink: 0; margin-top: 2px; }
   .onboarding-band button.close-band {
     margin-left: auto; padding: 0 6px; color: var(--ink-subtle); font-size: 18px;
   }
   ```

2. Inside `<section id="section-api-keys">`, insert:

   ```html
   <div class="section-head">
     <span class="t-label">API Keys</span>
     <h1><span>Extension</span> <span class="accent">access.</span></h1>
     <p>Grant keys let the browser extension call the JobTread API for Power User features.</p>
   </div>

   <div class="onboarding-band" id="apiKeysOnboarding">
     <i class="ph ph-info" aria-hidden="true"></i>
     <div>
       <strong>How this works:</strong> Each JobTread organization needs a separate grant key. Click Add Key, paste the key from JobTread's API settings, and the extension picks it up automatically when someone on your team visits that org.
       <br><a href="https://jtpowertools.com/documentation.html#grant-keys" target="_blank" style="color:var(--orange); font-weight:600;">Where do I find a JobTread grant key? →</a>
     </div>
     <button class="close-band" aria-label="Dismiss" onclick="this.parentElement.hidden=true">×</button>
   </div>

   <div class="card">
     <div class="card-header">
       <h3>Keys</h3>
       <button class="btn btn--primary btn-sm" id="addKeyBtn"><i class="ph ph-plus"></i>Add Key</button>
     </div>
     <table class="tbl" id="keysTable">
       <thead><tr><th>Org</th><th>Key</th><th>Added by</th><th>Added</th><th>Status</th><th></th></tr></thead>
       <tbody id="keysBody"></tbody>
     </table>
     <div id="keysEmpty" class="tbl-empty" hidden>No grant keys yet. Add one to unlock Power User features across your orgs.</div>
   </div>

   <div class="card" id="addKeyFormCard" hidden>
     <div class="card-header"><h3>Add a grant key</h3></div>
     <form id="addKeyForm">
       <div class="form-group">
         <label for="newKeyOrgName">Organization name</label>
         <input type="text" id="newKeyOrgName" placeholder="Acme Construction" required>
       </div>
       <div class="form-group">
         <label for="newKeyValue">Grant key</label>
         <input type="password" id="newKeyValue" placeholder="Paste key from JobTread" required>
       </div>
       <div style="display:flex; gap:10px;">
         <button type="button" class="btn btn--ghost btn-sm" id="validateKeyBtn">Validate</button>
         <button type="submit" class="btn btn--primary btn-sm" id="saveKeyBtn" disabled>Save key</button>
         <button type="button" class="btn btn--ghost btn-sm" id="cancelKeyBtn">Cancel</button>
       </div>
     </form>
   </div>

   <p style="margin-top:24px; color:var(--ink-muted); font-size:13.5px;">
     <i class="ph ph-info" style="color:var(--orange); vertical-align:middle;"></i>
     Adding a key for every org is optional — start with the one you use most.
   </p>
   ```

3. Port the extension-keys handlers (load, validate, save, rotate, disable, delete) from the OLD dashboard.html — preserve API endpoint calls exactly.

4. Commit:
   ```bash
   git add portal/dashboard.html portal/css/portal.css
   git commit -m "feat: add API Keys section markup and data bindings"
   ```

---

## Phase 8 — Team section

### Task 8.1: Team section markup

**Files:**
- Modify: `portal/dashboard.html`
- Modify: `portal/css/portal.css` (stats band)

**Steps:**

1. Append to `portal.css`:

   ```css
   .team-stats {
     display: grid;
     grid-template-columns: repeat(4, 1fr);
     background: var(--surface-inset);
     border: 1px solid var(--border);
     border-radius: var(--r-lg);
     margin-bottom: 20px;
   }
   @media (max-width: 700px) { .team-stats { grid-template-columns: repeat(2, 1fr); } }
   .team-stat {
     padding: 20px;
     text-align: center;
     border-right: 1px solid var(--border);
   }
   .team-stat:last-child { border-right: 0; }
   @media (max-width: 700px) {
     .team-stat:nth-child(2) { border-right: 0; }
     .team-stat:nth-child(-n+2) { border-bottom: 1px solid var(--border); }
   }
   .team-stat-num {
     font-family: var(--font-display);
     font-size: clamp(36px, 4.5vw, 56px);
     line-height: 1;
     color: var(--ink);
   }
   .team-stat-label {
     font-family: var(--font-sub);
     font-weight: 600;
     font-size: 11px;
     letter-spacing: 0.12em;
     text-transform: uppercase;
     color: var(--ink-subtle);
     margin-top: 4px;
   }

   .chip-input {
     display: flex;
     flex-wrap: wrap;
     gap: 6px;
     padding: 8px;
     border: 1px solid var(--border);
     border-radius: var(--r-sm);
     min-height: 48px;
     background: var(--surface);
   }
   .chip-input input {
     border: 0;
     flex: 1;
     min-width: 180px;
     outline: none;
     font-size: 15px;
     padding: 6px 8px;
   }
   .chip-input .email-chip {
     display: inline-flex;
     align-items: center;
     gap: 6px;
     padding: 4px 10px;
     background: var(--surface-inset);
     border-radius: var(--r-pill);
     font-size: 13.5px;
   }
   .chip-input .email-chip button { color: var(--ink-subtle); font-size: 14px; }
   .chip-input .email-chip button:hover { color: #c0392b; }
   ```

2. Inside `<section id="section-team">`, insert:

   ```html
   <div class="section-head">
     <span class="t-label">Team</span>
     <h1><span>Your</span> <span class="accent">organization.</span></h1>
     <p>Invite members, manage roles, and track seat usage.</p>
   </div>

   <div class="team-stats">
     <div class="team-stat">
       <div class="team-stat-num" id="teamMembers">—</div>
       <div class="team-stat-label">Members</div>
     </div>
     <div class="team-stat">
       <div class="team-stat-num" id="teamInvites">—</div>
       <div class="team-stat-label">Pending Invites</div>
     </div>
     <div class="team-stat">
       <div class="team-stat-num" id="teamTier">—</div>
       <div class="team-stat-label">Plan</div>
     </div>
     <div class="team-stat">
       <div class="team-stat-num" id="teamStatus">—</div>
       <div class="team-stat-label">License</div>
     </div>
   </div>

   <div class="card">
     <div class="card-header">
       <h3>Invite new members</h3>
     </div>
     <form id="inviteForm">
       <div class="form-group">
         <label for="inviteChips">Email addresses</label>
         <div class="chip-input" id="inviteChipInput">
           <input type="email" id="inviteChipsInput" placeholder="name@company.com, enter to add">
         </div>
       </div>
       <div class="form-group">
         <label for="inviteRole">Role</label>
         <select id="inviteRole">
           <option value="member">Member</option>
           <option value="admin">Admin</option>
           <option value="owner">Owner</option>
         </select>
       </div>
       <button type="submit" class="btn btn--primary">Send Invites</button>
     </form>
   </div>

   <div class="card">
     <div class="card-header"><h3>Active members</h3></div>
     <table class="tbl" id="membersTable">
       <thead><tr><th>Name</th><th>Email</th><th>Role</th><th>Joined</th><th>Last seen</th><th></th></tr></thead>
       <tbody id="membersBody"></tbody>
     </table>
     <div id="membersEmpty" class="tbl-empty" hidden>Just you so far.</div>
   </div>

   <div class="card">
     <div class="card-header"><h3>Pending invites</h3></div>
     <table class="tbl" id="invitesTable">
       <thead><tr><th>Email</th><th>Sent</th><th>Sent by</th><th></th></tr></thead>
       <tbody id="invitesBody"></tbody>
     </table>
     <div id="invitesEmpty" class="tbl-empty" hidden>No pending invites.</div>
   </div>

   <div class="card">
     <div class="card-header"><h3>Organization settings</h3></div>
     <form id="orgSettingsForm">
       <div class="form-group">
         <label for="orgName">Organization name</label>
         <input type="text" id="orgName">
       </div>
       <div class="form-group">
         <label for="orgTimezone">Timezone</label>
         <input type="text" id="orgTimezone" placeholder="America/Denver">
       </div>
       <button type="submit" class="btn btn--primary btn-sm">Save settings</button>
     </form>
     <hr style="margin:28px 0; border:0; border-top:1px solid var(--border);">
     <div style="color:#991b1b;">
       <h4 style="font-family:var(--font-sub); font-size:13px; letter-spacing:.12em; text-transform:uppercase; margin:0 0 8px;">Danger Zone</h4>
       <p style="font-size:14px; margin:0 0 12px;">Permanently delete your organization. This cannot be undone.</p>
       <button type="button" class="btn btn--danger-ghost btn-sm" id="deleteOrgBtn">Delete organization</button>
     </div>
   </div>
   ```

3. Port the team-data loaders (members, invites, stats, invite creation, role change, member removal, org settings, delete) from the OLD dashboard.html. Preserve their API calls.

4. Commit:
   ```bash
   git add portal/dashboard.html portal/css/portal.css
   git commit -m "feat: add Team section markup and data bindings"
   ```

---

## Phase 9 — Polish + release

### Task 9.1: Tier gating end-to-end test

**Steps:**

1. With the portal served locally, sign in as 5 different test users (mock or real):
   - Power User owner — should see all 4 tabs
   - Power User member — should see Account only
   - Pro owner — should see Account + Team
   - Essential owner — should see Account + Team
   - Free user — should see Account only
2. For each, verify:
   - Sidebar + top tabs both show only the gated sections
   - Deep-link to `#mcp` when hidden → falls back to Account + toast appears
   - Upsell strip shows only for non-Power-User on Account page
3. Fix any gating bugs found. Commit each fix separately: `fix: <description>`.

---

### Task 9.2: Dark-mode pass

**Steps:**

1. Toggle dark mode. Scroll every page and section. Verify:
   - Nav + user pill readable
   - Card surfaces distinct from page bg
   - Tables still readable (header row, hover state)
   - Form inputs + focus ring contrast OK
   - Toast: white text on ink should pass AA in both themes
2. Fix any contrast regressions. Commit each.

---

### Task 9.3: Responsive pass

**Steps:**

1. Test at 375 (mobile), 768 (tablet), 1280 (desktop).
2. Verify:
   - Sidebar hides at < 1000px, top tabs show with horizontal scroll
   - Auth pages: brand column hides at < 1000px
   - Tables: no horizontal scroll causing clipping (consider stacking on very narrow)
   - Forms remain usable
3. Fix any layout issues. Commit each.

---

### Task 9.4: Update CHANGELOG

**Files:**
- Modify: `CHANGELOG.md`

**Steps:**

1. Under `## [Unreleased]` → `### Changed`, append:

   ```markdown
   - Redesigned portal (app.jtpowertools.com) with the new light-first warm editorial design system, dark-mode toggle, Anton/Oswald/Inter/Instrument Serif/JetBrains Mono type stack, split-screen auth pages, and collapsible sidebar that turns into top tabs on mobile. Renamed "Extension" section to "API Keys" and "AI & MCP" to "MCP". Added tier gating so only Power User orgs see MCP + API Keys tabs (on top of existing owner/admin role gating). Old portal stylesheet preserved at `portal/css/portal.v3.css`.
   ```

2. Commit:
   ```bash
   git add CHANGELOG.md
   git commit -m "docs: log portal redesign v4 in CHANGELOG"
   ```

---

### Task 9.5: PR prep

**Steps:**

1. `git log --oneline main..HEAD -- portal/ CHANGELOG.md` — review commits.
2. `git diff main -- portal/` — confirm scope stays within `portal/`.
3. Draft PR description summarizing changes. Do not push automatically — surface the draft for user approval.

No commit in this task.

---

## Out of scope

- Backend changes of any kind — `auth.js` and `api.js` are untouched.
- `wrangler.jsonc` deploy config — untouched.
- Extension popup (Chrome extension) — separate track.
- Public site `docs/*` — already rewritten.

## Assumptions

- `auth.js` exposes `isLoggedIn()`, `redirectIfLoggedIn()`, `login()`, `logout()`, `setUser()`, `getUser()` — unchanged from current portal.
- `api.js` exposes `request(path, opts)` — unchanged.
- Backend endpoints (`/auth/me`, `/auth/login`, team/invites/keys/approved-senders routes) exist and behave identically.
- Tier values in user object are one of `free | essential | pro | power_user`.
- Roles are one of `owner | admin | member`.
- Phosphor Icons CDN and Google Fonts CDN remain available.
