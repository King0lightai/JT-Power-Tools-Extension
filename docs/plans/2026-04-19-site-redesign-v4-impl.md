# Site Redesign v4 Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Rewrite `docs/index.html`, `docs/about.html`, and `docs/roadmap.html` with a new light-first warm editorial design system, dark-mode toggle, new type stack, and a navy blueprint-grid MCP section.

**Architecture:** Vanilla HTML/CSS/JS, no build step. One shared `styles.css` + `tokens.css` + tiny `theme.js` and `pricing.js`. Old `styles.css` is archived to `styles.v3.css` so the un-migrated pages keep working.

**Tech Stack:** Plain HTML5, CSS3 (custom properties, grid, clamp()), vanilla JS (IntersectionObserver), Google Fonts (Anton, Oswald, Inter, Instrument Serif, JetBrains Mono), Phosphor Icons via CDN, Gumroad overlay JS (existing).

**Design reference:** [docs/plans/2026-04-19-site-redesign-v4-design.md](./2026-04-19-site-redesign-v4-design.md) — copy, tokens, and section specs live there. This plan focuses on execution order and concrete code.

**Working dir:** `docs/` (all changes scoped here except the CHANGELOG at repo root).

---

## Phase 0 — Preparation

### Task 0.1: Archive the current stylesheet

**Files:**
- Rename: `docs/styles.css` → `docs/styles.v3.css`

**Steps:**

1. Run: `git mv docs/styles.css docs/styles.v3.css`
2. Grep every HTML file under `docs/` that references `styles.css` and update the link tag to `styles.v3.css` *for pages we aren't rewriting this round.* Pages we ARE rewriting (index, about, roadmap) will be untouched here — they get new stylesheets in later tasks.

   ```bash
   grep -l "styles.css" docs/**/*.html docs/*.html | grep -vE "(index|about|roadmap)\.html$"
   ```

   For each match that isn't `index.html`, `about.html`, or `roadmap.html`, edit the `<link>` tag:
   ```html
   <!-- was --> <link rel="stylesheet" href="styles.css">
   <!-- now --> <link rel="stylesheet" href="/styles.v3.css">
   ```

   Pages likely to need this: `changelog.html`, `documentation.html`, `privacy.html`, `reset.html`, `mcp/*.html`, `guides/*.html`. Use the grep output as the authoritative list.

3. For `index.html`, `about.html`, `roadmap.html`: leave them with the *broken* reference for now. They'll be rewritten in later tasks and will reference the new `styles.css`.

4. Commit:
   ```bash
   git add docs/
   git commit -m "chore: archive docs/styles.css to styles.v3.css for unmigrated pages"
   ```

**Verify:** `git status` shows the rename + link updates. `grep -r "styles.v3.css" docs/` returns every non-rewritten page.

---

## Phase 1 — Foundation (tokens, base CSS, JS helpers)

### Task 1.1: Create `docs/tokens.css`

**Files:**
- Create: `docs/tokens.css`

**Steps:**

1. Write the file. Full content:

   ```css
   /* Design tokens — light-first with dark-mode toggle */

   /* Light (default) */
   :root {
     --bg: #F5F1EA;
     --surface: #FFFFFF;
     --surface-inset: #EDE7DC;
     --peach: #FDD9BE;
     --ink: #1A1A1A;
     --ink-muted: #5A5A5A;
     --ink-subtle: #8A8A8A;
     --ink-italic: #6B5E4E;
     --border: #E3DCCF;
     --border-strong: #1A1A1A;

     /* Brand / accents (shared light+dark) */
     --orange: #FE4C0D;
     --orange-dark: #D94000;
     --teal: #00C896;
     --purple: #A855F7;
     --navy: #14315F;
     --navy-grid-minor: rgba(255,255,255,0.06);
     --navy-grid-major: rgba(255,255,255,0.10);
     --hazard: #FFC43C;
     --blue-electric: #7AB5FF;

     /* Type */
     --font-display: 'Anton', Impact, 'Arial Black', sans-serif;
     --font-sub: 'Oswald', 'Arial Narrow', sans-serif;
     --font-body: 'Inter', system-ui, -apple-system, Segoe UI, Roboto, sans-serif;
     --font-serif: 'Instrument Serif', Georgia, serif;
     --font-mono: 'JetBrains Mono', ui-monospace, Consolas, monospace;

     /* Spacing & radius */
     --r-sm: 8px;
     --r-md: 12px;
     --r-lg: 16px;
     --r-xl: 20px;
     --r-pill: 999px;

     --dur: 0.22s;
     --ease: cubic-bezier(0.22, 0.61, 0.36, 1);
   }

   /* Dark */
   html[data-theme="dark"] {
     --bg: #1A1A1A;
     --surface: #242424;
     --surface-inset: #1F1F1F;
     --peach: #3A2A20;
     --ink: #F2EDE3;
     --ink-muted: #B0B0B0;
     --ink-subtle: #8A8A8A;
     --ink-italic: #C8B8A0;
     --border: #333333;
     --border-strong: #F2EDE3;
   }

   /* Respect prefers-color-scheme on first load (theme.js overrides if user chose) */
   @media (prefers-color-scheme: dark) {
     html:not([data-theme]) {
       --bg: #1A1A1A;
       --surface: #242424;
       --surface-inset: #1F1F1F;
       --peach: #3A2A20;
       --ink: #F2EDE3;
       --ink-muted: #B0B0B0;
       --ink-subtle: #8A8A8A;
       --ink-italic: #C8B8A0;
       --border: #333333;
       --border-strong: #F2EDE3;
     }
   }
   ```

2. Verify syntax: `npx prettier --check docs/tokens.css` (if prettier isn't available, skip).

3. Commit:
   ```bash
   git add docs/tokens.css
   git commit -m "feat: add design tokens for site redesign v4"
   ```

**Verify:** The file exists and is 60–80 lines.

---

### Task 1.2: Create new `docs/styles.css` — base + typography + utilities

**Files:**
- Create: `docs/styles.css`

**Steps:**

1. Write the base stylesheet. This covers sections 1-4 of the CSS architecture: tokens import, resets, typography, layout utilities. Section-specific styles come later.

   Key sections of the file (write them in this order, with section comments):

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
     font-size: 17px;
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

   /* Focus */
   :focus-visible {
     outline: 2px solid var(--orange);
     outline-offset: 2px;
     border-radius: var(--r-sm);
   }

   /* =========================================================
      3. Typography
      ========================================================= */
   .t-display {
     font-family: var(--font-display);
     font-size: clamp(44px, 6vw, 104px);
     line-height: 0.95;
     letter-spacing: 0.005em;
     text-transform: uppercase;
     color: var(--ink);
     margin: 0;
   }
   .t-display--hero {
     font-size: clamp(64px, 9vw, 180px);
     line-height: 0.9;
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
   .t-label--ink { color: var(--ink); }
   .t-label--muted { color: var(--ink-subtle); }

   .t-lede {
     font-family: var(--font-body);
     font-weight: 500;
     font-size: clamp(17px, 1.4vw, 20px);
     line-height: 1.5;
     color: var(--ink-muted);
     max-width: 60ch;
   }

   .t-card-title {
     font-family: var(--font-sub);
     font-weight: 600;
     font-size: 18px;
     letter-spacing: 0.02em;
     text-transform: uppercase;
     color: var(--ink);
     margin: 0;
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

   .section {
     padding: clamp(72px, 10vw, 128px) 0;
   }
   .section--tight { padding: clamp(48px, 6vw, 80px) 0; }
   .section--bleed { padding: 0; } /* for full-bleed child handling */

   .section-head {
     text-align: center;
     margin-bottom: clamp(40px, 5vw, 72px);
   }
   .section-head .t-label {
     display: inline-flex;
     align-items: center;
     gap: 12px;
   }
   .section-head .t-label::before,
   .section-head .t-label::after {
     content: '';
     display: inline-block;
     width: clamp(24px, 4vw, 80px);
     height: 1px;
     background: currentColor;
     opacity: 0.4;
   }

   .grid {
     display: grid;
     gap: 24px;
   }
   .grid-2 { grid-template-columns: repeat(2, 1fr); }
   .grid-3 { grid-template-columns: repeat(3, 1fr); }
   .grid-4 { grid-template-columns: repeat(4, 1fr); }
   @media (max-width: 1000px) {
     .grid-4 { grid-template-columns: repeat(2, 1fr); }
     .grid-3 { grid-template-columns: repeat(2, 1fr); }
   }
   @media (max-width: 640px) {
     .grid-4, .grid-3, .grid-2 { grid-template-columns: 1fr; }
   }

   .rule { border: 0; border-top: 1px solid var(--border); margin: 0; }

   /* =========================================================
      5. Components (buttons, pills, toggles, chips)
      ========================================================= */
   .btn {
     display: inline-flex;
     align-items: center;
     justify-content: center;
     gap: 8px;
     padding: 14px 24px;
     font-family: var(--font-body);
     font-weight: 600;
     font-size: 16px;
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

   .btn--ink { background: var(--ink); color: var(--bg); }
   .btn--ink:hover { background: var(--orange); color: #fff; }

   .btn--disabled { background: var(--surface-inset); color: var(--ink-subtle); cursor: not-allowed; }
   .btn--disabled:hover { transform: none; }

   .pill {
     display: inline-flex;
     align-items: center;
     gap: 6px;
     padding: 6px 12px;
     border-radius: var(--r-pill);
     font-family: var(--font-sub);
     font-weight: 600;
     font-size: 11px;
     letter-spacing: 0.12em;
     text-transform: uppercase;
     border: 1px solid var(--orange);
     color: var(--orange);
   }
   .pill--tier-pro { border-color: var(--orange); color: var(--orange); }
   .pill--tier-essential { border-color: var(--teal); color: var(--teal); background: color-mix(in srgb, var(--teal) 10%, transparent); }
   .pill--tier-power { border-color: var(--purple); color: var(--purple); background: color-mix(in srgb, var(--purple) 10%, transparent); }

   .chip {
     display: inline-flex;
     align-items: center;
     padding: 6px 12px;
     border-radius: var(--r-pill);
     font-family: var(--font-body);
     font-weight: 500;
     font-size: 13px;
     background: var(--surface-inset);
     color: var(--ink);
   }

   /* Toggle (iOS-style) */
   .toggle {
     position: relative;
     display: inline-block;
     width: 52px;
     height: 28px;
     background: var(--surface-inset);
     border-radius: 999px;
     border: 1px solid var(--border);
     cursor: pointer;
     transition: background var(--dur) var(--ease);
   }
   .toggle::after {
     content: '';
     position: absolute;
     top: 2px;
     left: 2px;
     width: 22px;
     height: 22px;
     background: var(--surface);
     border-radius: 50%;
     box-shadow: 0 1px 3px rgba(0,0,0,0.2);
     transition: transform var(--dur) var(--ease);
   }
   .toggle[aria-checked="true"] { background: var(--orange); }
   .toggle[aria-checked="true"]::after { transform: translateX(24px); }

   /* Cards */
   .card {
     background: var(--surface);
     border: 1px solid var(--border);
     border-radius: var(--r-lg);
     padding: 24px;
     transition: transform var(--dur) var(--ease), border-color var(--dur) var(--ease);
   }
   .card:hover {
     transform: translateY(-2px);
     border-color: var(--ink);
   }

   /* Reveal animation */
   .reveal { opacity: 0; transform: translateY(12px); transition: opacity 0.6s var(--ease), transform 0.6s var(--ease); }
   .reveal.is-visible { opacity: 1; transform: translateY(0); }
   @media (prefers-reduced-motion: reduce) {
     .reveal { opacity: 1; transform: none; transition: none; }
     * { transition-duration: 0.01ms !important; animation-duration: 0.01ms !important; }
   }
   ```

2. Commit:
   ```bash
   git add docs/styles.css
   git commit -m "feat: add base styles, type scale, and utilities for site v4"
   ```

**Verify:** File is ~250-300 lines. No section-specific styles yet.

---

### Task 1.3: Create `docs/theme.js`

**Files:**
- Create: `docs/theme.js`

**Steps:**

1. Write the theme toggle script:

   ```javascript
   // theme.js — light/dark toggle with localStorage + system preference fallback
   (function() {
     const KEY = 'jt4-theme';
     const root = document.documentElement;

     function apply(theme) {
       if (theme === 'light' || theme === 'dark') {
         root.setAttribute('data-theme', theme);
       } else {
         root.removeAttribute('data-theme');
       }
     }

     // Init from localStorage (falls back to prefers-color-scheme via CSS)
     const saved = localStorage.getItem(KEY);
     if (saved === 'light' || saved === 'dark') apply(saved);

     // Wire toggle buttons
     function wire() {
       document.querySelectorAll('[data-theme-toggle]').forEach(btn => {
         btn.addEventListener('click', () => {
           const current = root.getAttribute('data-theme')
             || (window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
           const next = current === 'dark' ? 'light' : 'dark';
           apply(next);
           localStorage.setItem(KEY, next);
           btn.setAttribute('aria-pressed', next === 'dark' ? 'true' : 'false');
           const label = btn.querySelector('[data-theme-label]');
           if (label) label.textContent = next === 'dark' ? 'Light' : 'Dark';
           const icon = btn.querySelector('[data-theme-icon]');
           if (icon) icon.className = next === 'dark' ? 'ph ph-sun' : 'ph ph-moon';
         });
       });
     }

     if (document.readyState === 'loading') {
       document.addEventListener('DOMContentLoaded', wire);
     } else {
       wire();
     }
   })();
   ```

2. Commit:
   ```bash
   git add docs/theme.js
   git commit -m "feat: add theme toggle script"
   ```

---

### Task 1.4: Create `docs/pricing.js`

**Files:**
- Create: `docs/pricing.js`

**Steps:**

1. Write the pricing toggle script:

   ```javascript
   // pricing.js — monthly/yearly billing toggle for pricing cards
   (function() {
     function wire() {
       const toggle = document.querySelector('[data-billing-toggle]');
       const wrapper = document.querySelector('[data-billing-wrapper]');
       if (!toggle || !wrapper) return;

       function apply(mode) {
         wrapper.setAttribute('data-billing', mode);
         toggle.setAttribute('aria-checked', mode === 'yearly' ? 'true' : 'false');

         wrapper.querySelectorAll('[data-monthly][data-yearly]').forEach(card => {
           const amount = mode === 'yearly' ? card.dataset.yearly : card.dataset.monthly;
           const suffix = mode === 'yearly' ? '/yr' : '/mo';
           const amountEl = card.querySelector('[data-price-amount]');
           const periodEl = card.querySelector('[data-price-period]');
           if (amountEl) amountEl.textContent = '$' + amount;
           if (periodEl) periodEl.textContent = suffix;
         });
       }

       toggle.addEventListener('click', () => {
         const current = wrapper.getAttribute('data-billing') || 'monthly';
         apply(current === 'monthly' ? 'yearly' : 'monthly');
       });

       apply('monthly');
     }

     if (document.readyState === 'loading') {
       document.addEventListener('DOMContentLoaded', wire);
     } else {
       wire();
     }
   })();
   ```

2. Commit:
   ```bash
   git add docs/pricing.js
   git commit -m "feat: add monthly/yearly pricing toggle"
   ```

---

### Task 1.5: Create `docs/site.js` — reveal + scroll-spy + mobile nav

**Files:**
- Create: `docs/site.js`

**Steps:**

1. Write:

   ```javascript
   // site.js — reveal on scroll, scroll-spy active nav, mobile nav sheet
   (function() {
     function initReveal() {
       if (!('IntersectionObserver' in window)) return;
       const els = document.querySelectorAll('.reveal');
       const io = new IntersectionObserver((entries) => {
         entries.forEach(e => {
           if (e.isIntersecting) {
             e.target.classList.add('is-visible');
             io.unobserve(e.target);
           }
         });
       }, { rootMargin: '0px 0px -10% 0px', threshold: 0.1 });
       els.forEach(el => io.observe(el));
     }

     function initSpy() {
       if (!('IntersectionObserver' in window)) return;
       const links = document.querySelectorAll('[data-spy-link]');
       if (!links.length) return;
       const map = new Map();
       links.forEach(l => {
         const id = l.getAttribute('href')?.replace('#', '');
         if (!id) return;
         const sec = document.getElementById(id);
         if (sec) map.set(sec, l);
       });
       const io = new IntersectionObserver((entries) => {
         entries.forEach(e => {
           const link = map.get(e.target);
           if (!link) return;
           if (e.isIntersecting) {
             links.forEach(l => l.classList.remove('is-active'));
             link.classList.add('is-active');
           }
         });
       }, { rootMargin: '-40% 0px -55% 0px', threshold: 0 });
       map.forEach((_, sec) => io.observe(sec));
     }

     function initMobileNav() {
       const btn = document.querySelector('[data-nav-toggle]');
       const sheet = document.querySelector('[data-nav-sheet]');
       if (!btn || !sheet) return;
       btn.addEventListener('click', () => {
         const open = sheet.classList.toggle('is-open');
         btn.setAttribute('aria-expanded', open ? 'true' : 'false');
         document.body.style.overflow = open ? 'hidden' : '';
       });
       sheet.querySelectorAll('a').forEach(a => a.addEventListener('click', () => {
         sheet.classList.remove('is-open');
         btn.setAttribute('aria-expanded', 'false');
         document.body.style.overflow = '';
       }));
     }

     function init() {
       initReveal();
       initSpy();
       initMobileNav();
     }

     if (document.readyState === 'loading') {
       document.addEventListener('DOMContentLoaded', init);
     } else {
       init();
     }
   })();
   ```

2. Commit:
   ```bash
   git add docs/site.js
   git commit -m "feat: add reveal, scroll-spy, and mobile nav behaviors"
   ```

---

### Task 1.6: Start preview server and verify foundation loads

**Steps:**

1. Call the harness preview tool: `preview_start` with working dir `docs/`.
2. Open any existing unmigrated page (e.g. `changelog.html`) and confirm it still renders using `styles.v3.css`. Take a screenshot.
3. Note the preview URL; leave the server running for subsequent tasks.

**Verify:** Changelog page renders with old styles. No broken references to `styles.css` (it's fine that `styles.css` exists but references no old content yet — nothing loads it yet).

---

## Phase 2 — Shared shell (nav + footer)

### Task 2.1: Add nav + footer CSS to styles.css

**Files:**
- Modify: `docs/styles.css` (append section 6)

**Steps:**

1. Append to `styles.css`:

   ```css
   /* =========================================================
      6. Nav + footer
      ========================================================= */
   .nav {
     position: sticky;
     top: 0;
     z-index: 50;
     background: var(--bg);
     border-bottom: 1px solid var(--border);
     backdrop-filter: saturate(180%) blur(6px);
     -webkit-backdrop-filter: saturate(180%) blur(6px);
   }
   .nav-inner {
     display: flex;
     align-items: center;
     justify-content: space-between;
     padding: 14px 0;
     gap: 24px;
   }
   .nav-left {
     display: flex;
     align-items: center;
     gap: 32px;
     flex-wrap: nowrap;
   }
   .nav-brand {
     display: inline-flex;
     align-items: center;
     gap: 10px;
     font-family: var(--font-sub);
     font-weight: 700;
     text-transform: uppercase;
     letter-spacing: 0.06em;
     color: var(--ink);
   }
   .nav-brand-mark {
     width: 28px;
     height: 28px;
     background: var(--ink);
     color: var(--bg);
     border-radius: var(--r-sm);
     display: inline-flex;
     align-items: center;
     justify-content: center;
     font-size: 13px;
     font-weight: 700;
   }
   .nav-links {
     display: flex;
     align-items: center;
     gap: 20px;
     font-family: var(--font-body);
     font-weight: 500;
     font-size: 14.5px;
   }
   .nav-links a {
     color: var(--ink-muted);
     transition: color var(--dur) var(--ease);
   }
   .nav-links a:hover,
   .nav-links a.is-active { color: var(--ink); }
   .nav-right {
     display: flex;
     align-items: center;
     gap: 12px;
   }
   .nav-theme {
     display: inline-flex;
     align-items: center;
     gap: 6px;
     padding: 8px 14px;
     border-radius: var(--r-pill);
     font-family: var(--font-body);
     font-weight: 500;
     font-size: 13.5px;
     color: var(--ink-muted);
     background: var(--surface-inset);
     border: 1px solid var(--border);
   }
   .nav-theme:hover { color: var(--ink); }
   .nav-burger { display: none; }

   @media (max-width: 900px) {
     .nav-links, .nav-theme { display: none; }
     .nav-burger {
       display: inline-flex;
       align-items: center;
       justify-content: center;
       width: 40px;
       height: 40px;
       border-radius: var(--r-sm);
       color: var(--ink);
     }
     .nav-sheet {
       position: fixed;
       inset: 64px 0 0;
       background: var(--bg);
       transform: translateY(-100%);
       transition: transform 0.3s var(--ease);
       padding: 32px 24px;
       overflow-y: auto;
     }
     .nav-sheet.is-open { transform: translateY(0); }
     .nav-sheet a {
       display: block;
       padding: 16px 0;
       font-family: var(--font-sub);
       font-weight: 600;
       font-size: 24px;
       text-transform: uppercase;
       letter-spacing: 0.04em;
       color: var(--ink);
       border-bottom: 1px solid var(--border);
     }
   }

   /* Footer */
   .footer {
     background: var(--bg);
     border-top: 1px solid var(--border);
     padding: 64px 0 32px;
     color: var(--ink-muted);
   }
   .footer-grid {
     display: grid;
     grid-template-columns: 2fr 1fr 1fr 1fr;
     gap: 48px;
     margin-bottom: 48px;
   }
   @media (max-width: 900px) {
     .footer-grid { grid-template-columns: 1fr 1fr; }
   }
   @media (max-width: 560px) {
     .footer-grid { grid-template-columns: 1fr; }
   }
   .footer h4 {
     font-family: var(--font-sub);
     font-weight: 600;
     font-size: 12px;
     letter-spacing: 0.12em;
     text-transform: uppercase;
     color: var(--ink);
     margin: 0 0 16px;
   }
   .footer ul { display: flex; flex-direction: column; gap: 10px; font-size: 14.5px; }
   .footer a { color: var(--ink-muted); transition: color var(--dur) var(--ease); }
   .footer a:hover { color: var(--orange); }
   .footer-bottom {
     display: flex;
     justify-content: space-between;
     align-items: center;
     padding-top: 24px;
     border-top: 1px solid var(--border);
     font-size: 13px;
     flex-wrap: wrap;
     gap: 12px;
   }
   .footer-partner {
     display: inline-flex;
     align-items: center;
     gap: 6px;
     padding: 5px 10px;
     border-radius: var(--r-pill);
     border: 1px solid var(--orange);
     color: var(--orange);
     font-family: var(--font-sub);
     font-weight: 600;
     font-size: 11px;
     letter-spacing: 0.12em;
     text-transform: uppercase;
   }
   ```

2. Commit:
   ```bash
   git add docs/styles.css
   git commit -m "feat: add nav + footer styles"
   ```

---

### Task 2.2: Create reusable nav + footer HTML snippet reference

**Note:** These are HTML fragments that will be copy-pasted into each of `index.html`, `about.html`, `roadmap.html`. Since we're vanilla (no build/templating), we copy. Keep them identical across pages except the `data-spy-link` class may be on the active page only.

**Nav fragment:**

```html
<header class="nav">
  <div class="container nav-inner">
    <div class="nav-left">
      <a class="nav-brand" href="/">
        <span class="nav-brand-mark">JT</span>
        <span>Power Tools</span>
      </a>
      <nav class="nav-links" aria-label="Primary">
        <a href="/#features" data-spy-link>Features</a>
        <a href="/#install" data-spy-link>Install</a>
        <a href="/#pricing" data-spy-link>Pricing</a>
        <a href="/#mcp" data-spy-link>AI</a>
        <a href="/roadmap.html">Roadmap</a>
        <a href="/about.html">About</a>
      </nav>
    </div>
    <div class="nav-right">
      <button class="nav-theme" data-theme-toggle aria-pressed="false" aria-label="Toggle theme">
        <i class="ph ph-moon" data-theme-icon aria-hidden="true"></i>
        <span data-theme-label>Dark</span>
      </button>
      <a href="https://chromewebstore.google.com/detail/jt-power-tools/kfbcifdgmcendohejbiiojjkgdbjkpcn" class="btn btn--primary" target="_blank" rel="noopener">
        <i class="ph ph-download-simple" aria-hidden="true"></i>
        Install Free
      </a>
      <button class="nav-burger" data-nav-toggle aria-label="Open menu" aria-expanded="false">
        <i class="ph ph-list" aria-hidden="true"></i>
      </button>
    </div>
  </div>
  <nav class="nav-sheet" data-nav-sheet aria-label="Mobile menu">
    <a href="/#features">Features</a>
    <a href="/#install">Install</a>
    <a href="/#pricing">Pricing</a>
    <a href="/#mcp">AI</a>
    <a href="/roadmap.html">Roadmap</a>
    <a href="/about.html">About</a>
  </nav>
</header>
```

**Footer fragment:**

```html
<footer class="footer">
  <div class="container">
    <div class="footer-grid">
      <div>
        <a class="nav-brand" href="/">
          <span class="nav-brand-mark">JT</span>
          <span>Power Tools</span>
        </a>
        <p style="margin: 16px 0 20px; max-width: 32ch;">JobTread, supercharged.</p>
        <div style="display:flex; gap:8px; flex-wrap:wrap;">
          <span class="chip">v3.3.8</span>
          <span class="chip"><i class="ph-fill ph-star" style="color: var(--orange); margin-right: 4px;"></i>5.0</span>
        </div>
        <p style="margin-top: 20px; font-size: 13px; color: var(--ink-subtle);">Made by a contractor, for contractors.</p>
      </div>
      <div>
        <h4>Product</h4>
        <ul>
          <li><a href="/#features">Features</a></li>
          <li><a href="/#install">Install</a></li>
          <li><a href="/#pricing">Pricing</a></li>
          <li><a href="/#mcp">AI Toolkit</a></li>
          <li><a href="/roadmap.html">Roadmap</a></li>
          <li><a href="/changelog.html">Changelog</a></li>
        </ul>
      </div>
      <div>
        <h4>Resources</h4>
        <ul>
          <li><a href="/documentation.html">Documentation</a></li>
          <li><a href="/mcp/">MCP Setup</a></li>
          <li><a href="https://chromewebstore.google.com/detail/jt-power-tools/kfbcifdgmcendohejbiiojjkgdbjkpcn">Chrome Web Store</a></li>
          <li><a href="mailto:support@jtpowertools.com">Support</a></li>
        </ul>
      </div>
      <div>
        <h4>Legal</h4>
        <ul>
          <li><a href="/privacy.html">Privacy</a></li>
          <li><a href="/privacy.html#terms">Terms</a></li>
        </ul>
      </div>
    </div>
    <div class="footer-bottom">
      <span>© 2026 JT Power Tools. All rights reserved.</span>
      <span class="footer-partner"><i class="ph ph-check" aria-hidden="true"></i>Official JobTread Partner</span>
    </div>
  </div>
</footer>
```

**Steps:**

1. Save both fragments into `docs/plans/2026-04-19-site-redesign-v4-fragments.md` for easy copy-paste later (not committed — it's a scratch file).

2. No commit for this task (no tracked file changes).

---

## Phase 3 — index.html rewrite

### Task 3.1: Scaffold new `index.html`

**Files:**
- Modify: `docs/index.html` (full rewrite)

**Steps:**

1. Replace `docs/index.html` with the scaffold — `<head>`, nav fragment, empty `<main>`, footer fragment, script tags. Key parts:

   ```html
   <!DOCTYPE html>
   <html lang="en">
   <head>
     <meta charset="UTF-8">
     <meta name="viewport" content="width=device-width, initial-scale=1.0">
     <title>JT Power Tools — JobTread, Supercharged.</title>
     <meta name="description" content="The all-in-one Chrome extension toolkit that transforms JobTread into a powerhouse. Dark mode, rich text formatting, job switcher filtering, and 20+ more productivity features.">
     <link rel="canonical" href="https://jtpowertools.com/">
     <link rel="icon" type="image/png" href="favicon.png">

     <!-- OG / Twitter -->
     <meta property="og:type" content="website">
     <meta property="og:url" content="https://jtpowertools.com/">
     <meta property="og:title" content="JT Power Tools — JobTread, Supercharged.">
     <meta property="og:description" content="The all-in-one Chrome extension toolkit for JobTread.">
     <meta property="og:image" content="https://jtpowertools.com/og-image.png">
     <meta name="twitter:card" content="summary_large_image">

     <!-- Fonts -->
     <link rel="preconnect" href="https://fonts.googleapis.com">
     <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
     <link href="https://fonts.googleapis.com/css2?family=Anton&family=Oswald:wght@500;600;700&family=Inter:wght@400;500;600;700&family=Instrument+Serif:ital@0;1&family=JetBrains+Mono:wght@400;500&display=swap" rel="stylesheet">

     <!-- Icons -->
     <link rel="stylesheet" href="https://unpkg.com/@phosphor-icons/web@2.0.3/src/regular/style.css">
     <link rel="stylesheet" href="https://unpkg.com/@phosphor-icons/web@2.0.3/src/fill/style.css">

     <!-- App styles -->
     <link rel="stylesheet" href="styles.css">

     <!-- Gumroad overlay checkout -->
     <script src="https://gumroad.com/js/gumroad.js"></script>
   </head>
   <body>
     <!-- PASTE NAV FRAGMENT HERE -->

     <main>
       <!-- Sections added in later tasks -->
     </main>

     <!-- PASTE FOOTER FRAGMENT HERE -->

     <script src="theme.js"></script>
     <script src="pricing.js"></script>
     <script src="site.js"></script>
   </body>
   </html>
   ```

2. Paste the nav fragment (from Task 2.2) where marked.
3. Paste the footer fragment where marked.
4. Reload preview, verify nav + footer render with correct styles, theme toggle clicks work (body bg changes to dark and back), mobile menu opens at 375px.
5. Take screenshot at 1440 width.

6. Commit:
   ```bash
   git add docs/index.html
   git commit -m "feat: scaffold new index.html with nav, footer, theme toggle"
   ```

---

### Task 3.2: Hero section CSS + HTML

**Files:**
- Modify: `docs/styles.css` (append `.s-hero`)
- Modify: `docs/index.html` (insert hero section)

**Steps:**

1. Append to `styles.css`:

   ```css
   /* =========================================================
      7. Section: Hero
      ========================================================= */
   .s-hero {
     padding: clamp(40px, 6vw, 80px) 0 clamp(64px, 8vw, 120px);
     min-height: 88vh;
     display: flex;
     align-items: center;
   }
   .s-hero-grid {
     display: grid;
     grid-template-columns: 7fr 5fr;
     gap: 48px;
     align-items: center;
   }
   @media (max-width: 1100px) {
     .s-hero-grid { grid-template-columns: 1fr; }
   }
   .s-hero-badge {
     display: inline-flex;
     align-items: center;
     gap: 8px;
     padding: 8px 14px;
     border: 1px solid var(--orange);
     border-radius: var(--r-pill);
     color: var(--orange);
     font-family: var(--font-sub);
     font-weight: 600;
     font-size: 11px;
     letter-spacing: 0.14em;
     text-transform: uppercase;
     margin-bottom: 32px;
   }
   .s-hero-headline {
     font-family: var(--font-display);
     font-size: clamp(64px, 9vw, 168px);
     line-height: 0.9;
     letter-spacing: 0.005em;
     text-transform: uppercase;
     margin: 0 0 28px;
     color: var(--ink);
   }
   .s-hero-headline .accent { color: var(--orange); display: block; }
   .s-hero-headline span:not(.accent) { display: block; }

   .s-hero-lede {
     font-family: var(--font-body);
     font-weight: 400;
     font-size: clamp(16px, 1.3vw, 19px);
     line-height: 1.55;
     color: var(--ink-muted);
     max-width: 56ch;
     margin: 0 0 32px;
   }
   .s-hero-ctas { display: flex; gap: 12px; flex-wrap: wrap; margin-bottom: 28px; }
   .s-hero-trust {
     font-family: var(--font-sub);
     font-weight: 500;
     font-size: 12px;
     letter-spacing: 0.08em;
     text-transform: uppercase;
     color: var(--ink-subtle);
     display: inline-flex;
     align-items: center;
     gap: 14px;
     flex-wrap: wrap;
   }
   .s-hero-trust i { color: var(--orange); }

   .s-hero-mockup {
     background: #1A1A1A;
     color: #F2EDE3;
     border-radius: var(--r-xl);
     padding: 20px;
     box-shadow: 0 24px 60px -20px rgba(0,0,0,0.25);
     transform: rotate(1.5deg);
     transition: transform var(--dur) var(--ease);
   }
   .s-hero-mockup:hover { transform: rotate(0); }
   @media (max-width: 1100px) { .s-hero-mockup { transform: none; } }
   ```

2. Insert the hero markup into `<main>` in index.html:

   ```html
   <section class="s-hero">
     <div class="container s-hero-grid">
       <div class="reveal">
         <span class="s-hero-badge">
           <i class="ph ph-check-circle" aria-hidden="true"></i>
           Official JobTread Partner
         </span>
         <h1 class="s-hero-headline">
           <span>JobTread Is</span>
           <span>Great.</span>
           <span class="accent">This Makes It</span>
           <span class="accent">Awesome.</span>
         </h1>
         <p class="s-hero-lede">
           The all-in-one browser extension toolkit that transforms JobTread into a powerhouse. Dark mode, rich text formatting, message templates, job switcher filtering, and more.
         </p>
         <div class="s-hero-ctas">
           <a href="#install" class="btn btn--primary">
             <i class="ph ph-download-simple" aria-hidden="true"></i>
             Install Free Extension
           </a>
           <a href="#features" class="btn btn--ghost">See Features</a>
         </div>
         <div class="s-hero-trust">
           <span><i class="ph-fill ph-star"></i> 5.0 on Chrome Web Store</span>
           <span>·</span>
           <span>400+ contractors</span>
           <span>·</span>
           <span>20+ features</span>
         </div>
       </div>
       <aside class="s-hero-mockup reveal" aria-label="Extension popup preview">
         <!-- Placeholder popup mockup (to be redesigned in lockstep with the real popup) -->
         <div style="display:flex; align-items:center; justify-content:space-between; padding-bottom:12px; border-bottom:1px solid rgba(255,255,255,0.08);">
           <span style="font-family: var(--font-sub); font-weight: 700; letter-spacing: 0.06em; text-transform: uppercase; font-size: 14px;">⚙ JT Power Tools</span>
           <span style="font-family: var(--font-mono); font-size: 11px; opacity: 0.6;">v3.3.8</span>
         </div>
         <div style="display:flex; gap: 16px; padding: 14px 0; border-bottom: 1px solid rgba(255,255,255,0.08); font-size: 12px; font-family: var(--font-sub); text-transform: uppercase; letter-spacing: 0.06em;">
           <span style="color: var(--orange); border-bottom: 2px solid var(--orange); padding-bottom: 2px;">Features</span>
           <span style="opacity: 0.5;">Theme</span>
           <span style="opacity: 0.5;">API</span>
           <span style="opacity: 0.5;">License</span>
         </div>
         <ul style="display:flex; flex-direction: column; gap: 10px; padding-top: 14px; font-size: 13px;">
           <li style="display:flex; align-items:center; justify-content: space-between;"><span>📅 Schedule & Calendar <span style="opacity:.5; margin-left:6px;">5</span></span><i class="ph ph-caret-down" style="opacity:.4;"></i></li>
           <li style="display:flex; align-items:center; justify-content: space-between; padding-left: 12px;"><span>Auto Collapse Completed</span><span class="toggle" aria-checked="true" role="switch" tabindex="0"></span></li>
           <li style="display:flex; align-items:center; justify-content: space-between; padding-left: 12px;"><span>Schedule Task Checkboxes <span class="pill pill--tier-pro" style="margin-left:6px; font-size:9px; padding:3px 8px;">Pro</span></span><span class="toggle" aria-checked="true" role="switch" tabindex="0"></span></li>
           <li style="display:flex; align-items:center; justify-content: space-between; padding-left: 12px;"><span>Text Formatter</span><span class="toggle" aria-checked="true" role="switch" tabindex="0"></span></li>
           <li style="display:flex; align-items:center; justify-content: space-between; padding-left: 12px;"><span>Quick Notes <span class="pill pill--tier-essential" style="margin-left:6px; font-size:9px; padding:3px 8px;">Essential</span></span><span class="toggle" aria-checked="false" role="switch" tabindex="0"></span></li>
           <li style="display:flex; align-items:center; justify-content: space-between; padding-left: 12px;"><span>Dark Mode</span><span class="toggle" aria-checked="true" role="switch" tabindex="0"></span></li>
         </ul>
       </aside>
     </div>
   </section>
   ```

3. Reload preview. Verify:
   - Hero headline renders in two-tone, Anton font, properly sized.
   - CTAs functional, hover states work.
   - Popup mockup visible right column at desktop, stacks below on mobile.
   - Toggle dark mode: text colors invert but orange/popup stay readable.
4. Screenshot at 1440 and 375 widths, both themes. Save to `/tmp/jtpt-screenshots/` for comparison.

5. Commit:
   ```bash
   git add docs/styles.css docs/index.html
   git commit -m "feat: add hero section to index.html"
   ```

---

### Task 3.3: Before/After section

**Files:**
- Modify: `docs/styles.css` (append `.s-diff`)
- Modify: `docs/index.html` (insert section after hero)

**Steps:**

1. Append CSS:

   ```css
   /* =========================================================
      Section: The Difference (Before/After)
      ========================================================= */
   .s-diff {
     padding: clamp(64px, 8vw, 120px) 0;
   }
   .s-diff-head { text-align: center; margin-bottom: clamp(40px, 5vw, 72px); }
   .s-diff-title {
     font-family: var(--font-display);
     font-size: clamp(44px, 6vw, 104px);
     line-height: 0.98;
     letter-spacing: 0.005em;
     text-transform: uppercase;
     margin: 12px 0 0;
   }
   .s-diff-title .serif {
     font-family: var(--font-serif);
     font-style: italic;
     color: var(--ink-italic);
     text-transform: none;
     letter-spacing: 0;
   }
   .s-diff-grid {
     display: grid;
     grid-template-columns: 1fr 1fr;
     gap: 24px;
   }
   @media (max-width: 900px) {
     .s-diff-grid { grid-template-columns: 1fr; }
   }
   .s-diff-card {
     border-radius: var(--r-xl);
     padding: 32px;
   }
   .s-diff-card--standard { background: var(--surface-inset); }
   .s-diff-card--power { background: var(--peach); }
   .s-diff-card h3 {
     font-family: var(--font-sub);
     font-weight: 600;
     font-size: 12px;
     letter-spacing: 0.14em;
     text-transform: uppercase;
     margin: 0 0 20px;
   }
   .s-diff-card--standard h3 { color: var(--ink-subtle); }
   .s-diff-card--power h3 { color: var(--orange); }
   .s-diff-list { display: flex; flex-direction: column; }
   .s-diff-list li {
     display: flex;
     align-items: flex-start;
     gap: 14px;
     padding: 14px 0;
     font-size: 15.5px;
     line-height: 1.5;
     border-bottom: 1px solid color-mix(in srgb, currentColor 8%, transparent);
   }
   .s-diff-list li:last-child { border-bottom: 0; }
   .s-diff-list i {
     flex-shrink: 0;
     margin-top: 2px;
     font-size: 18px;
   }
   .s-diff-card--standard i { color: var(--ink-subtle); }
   .s-diff-card--power i { color: var(--orange); }
   ```

2. Insert markup after hero:

   ```html
   <section class="s-diff">
     <div class="container">
       <div class="s-diff-head reveal">
         <span class="t-label">The Difference</span>
         <h2 class="s-diff-title">
           JobTread, <span class="serif">now with Power Tools.</span>
         </h2>
       </div>
       <div class="s-diff-grid reveal">
         <article class="s-diff-card s-diff-card--standard">
           <h3>Standard JobTread</h3>
           <ul class="s-diff-list">
             <li><i class="ph ph-x" aria-hidden="true"></i>Blinding white screen, even at midnight</li>
             <li><i class="ph ph-x" aria-hidden="true"></i>Job switcher is one long list of every job — open, closed, archived — scroll or type to find it</li>
             <li><i class="ph ph-x" aria-hidden="true"></i>Assignee picker shows every member and every vendor with no way to filter</li>
             <li><i class="ph ph-x" aria-hidden="true"></i>Open task cards individually to check them off</li>
             <li><i class="ph ph-x" aria-hidden="true"></i>Plain text fields for notes and budget descriptions</li>
             <li><i class="ph ph-x" aria-hidden="true"></i>Type the same signature and canned replies every time</li>
             <li><i class="ph ph-x" aria-hidden="true"></i>Re-type messages to count characters</li>
           </ul>
         </article>
         <article class="s-diff-card s-diff-card--power">
           <h3>With Power Tools</h3>
           <ul class="s-diff-list">
             <li><i class="ph ph-check" aria-hidden="true"></i>True dark mode for late nights and early mornings</li>
             <li><i class="ph ph-check" aria-hidden="true"></i>Job switcher with filters — status, stage, recently opened</li>
             <li><i class="ph ph-check" aria-hidden="true"></i>Availability filter hides off-duty members and inactive vendors</li>
             <li><i class="ph ph-check" aria-hidden="true"></i>Checkboxes on schedule cards — one click, no modal</li>
             <li><i class="ph ph-check" aria-hidden="true"></i>Rich text with lists, colors, tables, headings</li>
             <li><i class="ph ph-check" aria-hidden="true"></i>Saved templates paste in one click</li>
             <li><i class="ph ph-check" aria-hidden="true"></i>Live character counter on every message field</li>
           </ul>
         </article>
       </div>
     </div>
   </section>
   ```

3. Reload preview. Verify:
   - Two-typeface headline reads correctly (Anton "JOBTREAD," then italic serif "now with Power Tools.")
   - Cards are equal height side-by-side desktop, stack correctly mobile with the Power Tools card second.
   - Orange ✓ vs muted ✕.
4. Screenshot both themes.

5. Commit:
   ```bash
   git add docs/styles.css docs/index.html
   git commit -m "feat: add before/after section to index.html"
   ```

---

### Task 3.4: Features grid section

**Files:**
- Modify: `docs/styles.css` (append `.s-features`)
- Modify: `docs/index.html` (insert section)

**Steps:**

1. Audit the feature list before writing markup. Read [JT-Tools-Master/manifest.json](../../JT-Tools-Master/manifest.json) and [JT-Tools-Master/content.js](../../JT-Tools-Master/content.js) to list every loaded feature with its actual name + tier. This replaces the "14+ features" marketing copy with an accurate count and ensures the grid matches reality.

2. Append CSS:

   ```css
   /* =========================================================
      Section: Features grid
      ========================================================= */
   .s-features { padding: clamp(64px, 8vw, 120px) 0; }
   .s-features-head {
     display: grid;
     grid-template-columns: auto 1fr;
     gap: 32px;
     align-items: end;
     margin-bottom: clamp(40px, 5vw, 72px);
   }
   @media (max-width: 900px) { .s-features-head { grid-template-columns: 1fr; } }
   .s-features-title {
     font-family: var(--font-display);
     font-size: clamp(40px, 5.5vw, 88px);
     line-height: 0.95;
     text-transform: uppercase;
     letter-spacing: 0.005em;
     margin: 0;
   }
   .s-features-title .accent { color: var(--orange); display: block; }
   .s-features-card {
     position: relative;
     background: var(--surface);
     border: 1px solid var(--border);
     border-radius: var(--r-lg);
     padding: 24px;
     transition: transform var(--dur) var(--ease), border-color var(--dur) var(--ease);
   }
   .s-features-card:hover { transform: translateY(-2px); border-color: var(--ink); }
   .s-features-card-top {
     display: flex;
     align-items: flex-start;
     justify-content: space-between;
     margin-bottom: 16px;
   }
   .s-features-icon {
     width: 40px;
     height: 40px;
     border: 1px solid var(--border);
     border-radius: var(--r-sm);
     display: inline-flex;
     align-items: center;
     justify-content: center;
     color: var(--ink);
     font-size: 20px;
   }
   .s-features-card h3 {
     font-family: var(--font-sub);
     font-weight: 600;
     font-size: 16px;
     letter-spacing: 0.06em;
     text-transform: uppercase;
     margin: 0 0 8px;
   }
   .s-features-card p {
     margin: 0;
     font-size: 14px;
     color: var(--ink-muted);
     line-height: 1.5;
   }
   .s-features-footer {
     text-align: center;
     margin-top: 40px;
     font-size: 15px;
   }
   .s-features-footer a { color: var(--orange); font-weight: 600; }
   ```

3. Insert markup. Use the list you audited in step 1. Tier mapping from code: features that call `checkLicense` with `tier === 'pro'` → PRO, `tier === 'essential'` → ESSENTIAL, `tier === 'power'` → POWER, no license check → free. For each, write a card with appropriate Phosphor icon, title, one-sentence description.

   Example shape (write ~20 cards):

   ```html
   <section class="s-features" id="features">
     <div class="container">
       <div class="s-features-head reveal">
         <span class="t-label">What's in the Kit</span>
         <h2 class="s-features-title">
           <span>One Extension.</span>
           <span class="accent">Every Fix.</span>
         </h2>
         <p class="t-lede">20+ features across scheduling, formatting, theming, and AI. Each toggle-able. All one install.</p>
       </div>
       <div class="grid grid-4 reveal">
         <article class="s-features-card">
           <div class="s-features-card-top">
             <span class="s-features-icon"><i class="ph ph-palette" aria-hidden="true"></i></span>
             <span class="pill pill--tier-pro">Pro</span>
           </div>
           <h3>Custom Theme</h3>
           <p>Personalize JobTread with your own color palette. Save up to 3 themes for quick switching.</p>
         </article>
         <!-- … ~19 more cards … -->
       </div>
       <div class="s-features-footer reveal">
         <a href="/documentation.html">See all features →</a>
       </div>
     </div>
   </section>
   ```

4. Reload preview, verify grid layout at 4/2/1 columns (1440 / 900 / 375 widths).

5. Commit:
   ```bash
   git add docs/styles.css docs/index.html
   git commit -m "feat: add features grid to index.html with 20 feature cards"
   ```

---

### Task 3.5: Install row ("Everywhere You Work")

**Files:**
- Modify: `docs/styles.css`
- Modify: `docs/index.html`

**Steps:**

1. Append CSS:

   ```css
   /* =========================================================
      Section: Install row
      ========================================================= */
   .s-install {
     padding: clamp(56px, 7vw, 96px) 0;
     text-align: center;
   }
   .s-install-title {
     font-family: var(--font-display);
     font-size: clamp(56px, 8vw, 136px);
     line-height: 0.95;
     text-transform: uppercase;
     letter-spacing: 0.005em;
     margin: 16px 0 32px;
   }
   .s-install-title .accent { color: var(--orange); }
   .s-install-buttons {
     display: flex;
     flex-wrap: wrap;
     justify-content: center;
     gap: 14px;
     margin-bottom: 20px;
   }
   .s-install-note {
     font-size: 13px;
     color: var(--ink-subtle);
     max-width: 64ch;
     margin: 0 auto;
   }
   ```

2. Insert markup:

   ```html
   <section class="s-install" id="install">
     <div class="container">
       <span class="t-label">Install</span>
       <h2 class="s-install-title">
         Everywhere <span class="accent">You Work.</span>
       </h2>
       <div class="s-install-buttons">
         <a href="https://chromewebstore.google.com/detail/jt-power-tools/kfbcifdgmcendohejbiiojjkgdbjkpcn" class="btn btn--ink" target="_blank" rel="noopener">
           <i class="ph ph-globe" aria-hidden="true"></i> Chrome
         </a>
         <a href="https://microsoftedge.microsoft.com/addons/detail/jt-power-tools/mimieaaodidgnkblemjpfmffgikbnofi" class="btn btn--ink" target="_blank" rel="noopener">
           <i class="ph ph-browser" aria-hidden="true"></i> Edge
         </a>
         <a href="https://addons.mozilla.org/en-US/firefox/addon/jt-power-tools/" class="btn btn--ink" target="_blank" rel="noopener">
           <i class="ph ph-fire" aria-hidden="true"></i> Firefox
         </a>
         <span class="btn btn--disabled" aria-disabled="true">
           <i class="ph ph-apple-logo" aria-hidden="true"></i> Safari — Soon
         </span>
       </div>
       <p class="s-install-note">Use <strong>Brave, Arc, or Opera</strong>? Choose Chrome — same store. · Safari supports extensions on iPhone &amp; iPad.</p>
     </div>
   </section>
   ```

3. Reload preview, screenshot, verify buttons wrap cleanly on mobile.

4. Commit:
   ```bash
   git add docs/styles.css docs/index.html
   git commit -m "feat: add install row section"
   ```

---

### Task 3.6: MCP / AI blueprint section

**Files:**
- Modify: `docs/styles.css`
- Modify: `docs/index.html`

**Steps:**

1. Append CSS:

   ```css
   /* =========================================================
      Section: MCP / AI (navy blueprint)
      ========================================================= */
   .s-mcp {
     position: relative;
     background: var(--navy);
     color: #fff;
     padding: clamp(72px, 10vw, 128px) 0 clamp(64px, 8vw, 104px);
     overflow: hidden;
   }
   .s-mcp::before {
     content: '';
     position: absolute;
     inset: 0;
     background-image:
       linear-gradient(var(--navy-grid-minor) 1px, transparent 1px),
       linear-gradient(90deg, var(--navy-grid-minor) 1px, transparent 1px),
       linear-gradient(var(--navy-grid-major) 1px, transparent 1px),
       linear-gradient(90deg, var(--navy-grid-major) 1px, transparent 1px);
     background-size: 40px 40px, 40px 40px, 200px 200px, 200px 200px;
     pointer-events: none;
   }
   .s-mcp-hazard {
     position: absolute;
     top: 0;
     left: 0;
     right: 0;
     height: 16px;
     background-image: repeating-linear-gradient(
       135deg,
       var(--hazard) 0 16px,
       #0D0D0D 16px 32px
     );
   }
   .s-mcp-inner { position: relative; text-align: center; }
   .s-mcp-eyebrow {
     font-family: var(--font-sub);
     font-weight: 600;
     font-size: 12px;
     letter-spacing: 0.18em;
     text-transform: uppercase;
     color: var(--blue-electric);
   }
   .s-mcp-title {
     font-family: var(--font-display);
     font-size: clamp(52px, 7vw, 120px);
     line-height: 0.95;
     text-transform: uppercase;
     letter-spacing: 0.005em;
     margin: 16px 0 24px;
   }
   .s-mcp-title .accent { color: var(--hazard); display: block; }
   .s-mcp-lede {
     max-width: 64ch;
     margin: 0 auto 48px;
     font-size: 17px;
     color: rgba(255,255,255,0.85);
   }
   .s-mcp-grid {
     display: grid;
     grid-template-columns: repeat(3, 1fr);
     gap: 16px;
     margin-bottom: 56px;
     text-align: left;
   }
   @media (max-width: 900px) { .s-mcp-grid { grid-template-columns: repeat(2, 1fr); } }
   @media (max-width: 560px) { .s-mcp-grid { grid-template-columns: 1fr; } }
   .s-mcp-card {
     background: rgba(255,255,255,0.04);
     border: 1px solid rgba(255,255,255,0.10);
     border-radius: var(--r-md);
     padding: 20px;
     transition: border-color var(--dur) var(--ease), transform var(--dur) var(--ease);
     display: flex;
     flex-direction: column;
     gap: 14px;
     color: #fff;
   }
   .s-mcp-card:hover { border-color: rgba(255,255,255,0.28); transform: translateY(-2px); }
   .s-mcp-card-logo {
     width: 32px;
     height: 32px;
     background: #fff;
     border-radius: var(--r-sm);
     display: inline-flex;
     align-items: center;
     justify-content: center;
     padding: 4px;
   }
   .s-mcp-card-logo img { max-width: 100%; max-height: 100%; }
   .s-mcp-card h3 {
     font-family: var(--font-sub);
     font-weight: 600;
     font-size: 16px;
     letter-spacing: 0.04em;
     text-transform: uppercase;
     margin: 0;
   }
   .s-mcp-card p { margin: 0; font-size: 13px; color: rgba(255,255,255,0.6); }
   .s-mcp-card-cta {
     margin-top: auto;
     color: var(--hazard);
     font-family: var(--font-sub);
     font-weight: 600;
     font-size: 13px;
     letter-spacing: 0.06em;
     text-transform: uppercase;
   }

   .s-mcp-prompts-label {
     font-family: var(--font-sub);
     font-weight: 600;
     font-size: 12px;
     letter-spacing: 0.14em;
     text-transform: uppercase;
     color: var(--hazard);
     text-align: left;
     margin-bottom: 14px;
     max-width: 900px;
     margin-left: auto;
     margin-right: auto;
   }
   .s-mcp-prompts {
     display: flex;
     flex-wrap: wrap;
     gap: 10px;
     justify-content: center;
     margin-bottom: 32px;
   }
   .s-mcp-prompt {
     display: inline-block;
     padding: 8px 16px;
     border-radius: var(--r-pill);
     border: 1px dashed rgba(255,255,255,0.3);
     background: rgba(255,255,255,0.06);
     font-family: var(--font-mono);
     font-size: 13px;
     color: #fff;
   }
   .s-mcp-footer {
     color: rgba(255,255,255,0.7);
     font-size: 14px;
   }
   ```

2. Insert markup:

   ```html
   <section class="s-mcp" id="mcp">
     <div class="s-mcp-hazard" aria-hidden="true"></div>
     <div class="container s-mcp-inner">
       <span class="s-mcp-eyebrow reveal">AI Toolkit · Included with Power User</span>
       <h2 class="s-mcp-title reveal">
         <span>Your AI Needs A</span>
         <span class="accent">Toolbelt.</span>
       </h2>
       <p class="s-mcp-lede reveal">
         Connect Claude, ChatGPT, Gemini, Cursor, or any MCP-aware client directly to JobTread. Your AI gets real job data, schedules, budgets — not stale copy-paste.
       </p>
       <div class="s-mcp-grid reveal">
         <a class="s-mcp-card" href="/mcp/chatgpt.html">
           <span class="s-mcp-card-logo"><img src="ChatGPT-Logo.svg.png" alt=""></span>
           <h3>ChatGPT</h3>
           <p>Custom GPT + browser-side MCP.</p>
           <span class="s-mcp-card-cta">Setup Guide →</span>
         </a>
         <a class="s-mcp-card" href="/mcp/other.html">
           <span class="s-mcp-card-logo"><img src="Claude_AI_symbol.svg" alt=""></span>
           <h3>Claude</h3>
           <p>Claude.ai web + desktop.</p>
           <span class="s-mcp-card-cta">Setup Guide →</span>
         </a>
         <a class="s-mcp-card" href="/mcp/gemini.html">
           <span class="s-mcp-card-logo"><img src="gemini-color.png" alt=""></span>
           <h3>Gemini</h3>
           <p>Google's AI with MCP support.</p>
           <span class="s-mcp-card-cta">Setup Guide →</span>
         </a>
         <a class="s-mcp-card" href="/mcp/grok.html">
           <span class="s-mcp-card-logo"><img src="grok--v2.png" alt=""></span>
           <h3>Grok</h3>
           <p>X's AI assistant.</p>
           <span class="s-mcp-card-cta">Setup Guide →</span>
         </a>
         <a class="s-mcp-card" href="/mcp/claude-code.html">
           <span class="s-mcp-card-logo"><i class="ph ph-terminal" style="color:#1A1A1A;"></i></span>
           <h3>Claude Code</h3>
           <p>Anthropic's official CLI.</p>
           <span class="s-mcp-card-cta">Setup Guide →</span>
         </a>
         <a class="s-mcp-card" href="/mcp/cursor.html">
           <span class="s-mcp-card-logo"><i class="ph ph-code" style="color:#1A1A1A;"></i></span>
           <h3>Cursor</h3>
           <p>AI-native code editor.</p>
           <span class="s-mcp-card-cta">Setup Guide →</span>
         </a>
       </div>
       <div class="reveal">
         <div class="s-mcp-prompts-label">Example Prompts</div>
         <div class="s-mcp-prompts">
           <span class="s-mcp-prompt">"Compare this bid request against the project scope"</span>
           <span class="s-mcp-prompt">"Pull key metrics for my production meeting"</span>
           <span class="s-mcp-prompt">"Forecast labor needs for the next 2 weeks"</span>
           <span class="s-mcp-prompt">"Pull historical budget data to develop costs for a new project"</span>
         </div>
       </div>
       <p class="s-mcp-footer reveal">MCP server access included with Power User tier. Free to try for 30 days.</p>
     </div>
   </section>
   ```

3. Reload preview. Verify:
   - Blueprint grid is visible but subtle (both minor 40px and major 200px lines).
   - Hazard stripe along top.
   - Heading in white/yellow.
   - MCP card logos render (these are existing PNG/SVG assets in `docs/`).
4. Screenshot both themes — note that the navy section is always dark regardless of theme.

5. Commit:
   ```bash
   git add docs/styles.css docs/index.html
   git commit -m "feat: add MCP blueprint section with hazard stripe"
   ```

---

### Task 3.7: How It Works section

**Files:**
- Modify: `docs/styles.css`
- Modify: `docs/index.html`

**Steps:**

1. Append CSS:

   ```css
   /* =========================================================
      Section: How It Works
      ========================================================= */
   .s-how { padding: clamp(72px, 9vw, 120px) 0; }
   .s-how-card {
     background: var(--surface);
     border: 1px solid var(--border);
     border-radius: var(--r-lg);
     padding: 28px;
     position: relative;
     min-height: 260px;
     display: flex;
     flex-direction: column;
   }
   .s-how-num {
     font-family: var(--font-display);
     font-size: clamp(72px, 10vw, 120px);
     line-height: 0.9;
     color: var(--orange);
     margin-bottom: 8px;
   }
   .s-how-card h3 {
     font-family: var(--font-sub);
     font-weight: 600;
     font-size: 16px;
     letter-spacing: 0.06em;
     text-transform: uppercase;
     margin: 0 0 10px;
     padding-top: 12px;
     border-top: 1px solid var(--border);
   }
   .s-how-card p { margin: 0; color: var(--ink-muted); font-size: 15px; line-height: 1.5; }
   .s-how-card .s-how-icon {
     margin-top: auto;
     align-self: flex-end;
     color: var(--ink-subtle);
     font-size: 24px;
   }
   .s-how-footer {
     text-align: center;
     margin-top: 40px;
   }
   .s-how-footer a { color: var(--orange); font-weight: 600; }
   ```

2. Insert markup:

   ```html
   <section class="s-how" id="how-it-works">
     <div class="container">
       <div class="section-head reveal">
         <span class="t-label">How It Works</span>
         <h2 class="s-features-title">
           <span>Three Steps.</span>
           <span class="accent">Zero Fuss.</span>
         </h2>
         <p class="t-lede" style="margin: 24px auto 0;">Install in seconds, no account required to start.</p>
       </div>
       <div class="grid grid-3 reveal">
         <article class="s-how-card">
           <div class="s-how-num">01</div>
           <h3>Install the Extension</h3>
           <p>One click from your browser's store. Works on Chrome, Edge, Firefox — no signup, no setup.</p>
           <i class="ph ph-download-simple s-how-icon" aria-hidden="true"></i>
         </article>
         <article class="s-how-card">
           <div class="s-how-num">02</div>
           <h3>Open JobTread</h3>
           <p>Everything activates automatically on <code>app.jobtread.com</code>. All free features turn on out of the box.</p>
           <i class="ph ph-lightning s-how-icon" aria-hidden="true"></i>
         </article>
         <article class="s-how-card">
           <div class="s-how-num">03</div>
           <h3>Turn On What You Need</h3>
           <p>Click the extension icon to toggle features. Upgrade in-app when you want Essential, Pro, or Power User tools.</p>
           <i class="ph ph-toggle-right s-how-icon" aria-hidden="true"></i>
         </article>
       </div>
       <div class="s-how-footer reveal">
         <a href="/documentation.html">Read the full guide →</a>
       </div>
     </div>
   </section>
   ```

3. Reload preview, screenshot.

4. Commit:
   ```bash
   git add docs/styles.css docs/index.html
   git commit -m "feat: add how-it-works section"
   ```

---

### Task 3.8: Reviews section

**Files:**
- Modify: `docs/styles.css`
- Modify: `docs/index.html`

**Steps:**

1. First, read the current `index.html` (in git history — `git show HEAD~N:docs/index.html`, where `N` gets you to before the rewrite) to extract the existing review list (star rating, name, date, body text). Port all reviews into the new markup below.

2. Append CSS:

   ```css
   /* =========================================================
      Section: Reviews
      ========================================================= */
   .s-reviews { padding: clamp(72px, 9vw, 120px) 0; }
   .s-reviews-summary {
     text-align: center;
     margin-bottom: 32px;
     display: flex;
     justify-content: center;
     align-items: baseline;
     gap: 16px;
     flex-wrap: wrap;
   }
   .s-reviews-summary .stars { color: var(--orange); font-size: 22px; display: inline-flex; gap: 4px; }
   .s-reviews-summary .score { font-family: var(--font-display); font-size: 40px; color: var(--ink); }
   .s-reviews-summary .total {
     font-family: var(--font-sub); font-weight: 600; font-size: 11px;
     letter-spacing: 0.12em; text-transform: uppercase; color: var(--ink-subtle);
   }
   .s-reviews-card {
     background: var(--surface);
     border: 1px solid var(--border);
     border-radius: var(--r-lg);
     padding: 28px;
     display: flex;
     flex-direction: column;
     gap: 16px;
   }
   .s-reviews-card-top { display: flex; justify-content: space-between; align-items: center; }
   .s-reviews-card-top .stars { color: var(--orange); font-size: 16px; }
   .s-reviews-card-top .date { font-family: var(--font-sub); font-size: 11px; letter-spacing: 0.12em; text-transform: uppercase; color: var(--ink-subtle); }
   .s-reviews-body { font-size: 16px; line-height: 1.55; color: var(--ink); }
   .s-reviews-body mark { background: var(--peach); color: inherit; padding: 0 2px; border-radius: 1px; }
   .s-reviews-card-author {
     display: flex;
     align-items: center;
     gap: 12px;
     padding-top: 16px;
     border-top: 1px solid var(--border);
   }
   .s-reviews-avatar {
     width: 40px; height: 40px; border-radius: 50%;
     background: var(--orange); color: #fff;
     display: inline-flex; align-items: center; justify-content: center;
     font-family: var(--font-sub); font-weight: 600; font-size: 14px;
     text-transform: uppercase; letter-spacing: 0.04em;
   }
   .s-reviews-author-name { font-weight: 600; font-size: 15px; }
   .s-reviews-author-date { font-size: 13px; color: var(--ink-subtle); }
   .s-reviews-cta {
     text-align: center; margin-top: 40px;
     display: flex; flex-direction: column; align-items: center; gap: 12px;
   }
   .s-reviews-trust { font-size: 15px; color: var(--ink-muted); }
   .s-reviews-trust strong { color: var(--orange); }
   ```

3. Insert markup (include at minimum 6 review cards, using your ported data):

   ```html
   <section class="s-reviews" id="reviews">
     <div class="container">
       <div class="section-head reveal">
         <span class="t-label">Reviews</span>
         <h2 class="s-features-title">
           <span>Loved By</span>
           <span class="accent">Contractors.</span>
         </h2>
       </div>
       <div class="s-reviews-summary reveal">
         <span class="stars"><i class="ph-fill ph-star"></i><i class="ph-fill ph-star"></i><i class="ph-fill ph-star"></i><i class="ph-fill ph-star"></i><i class="ph-fill ph-star"></i></span>
         <span class="score">5.0</span>
         <span class="total">· 13 Reviews on Chrome Web Store</span>
       </div>
       <div class="grid grid-2 reveal">
         <!-- Review card template, repeat for each review -->
         <article class="s-reviews-card">
           <div class="s-reviews-card-top">
             <span class="stars"><i class="ph-fill ph-star"></i><i class="ph-fill ph-star"></i><i class="ph-fill ph-star"></i><i class="ph-fill ph-star"></i><i class="ph-fill ph-star"></i></span>
             <span class="date">Dec 2, 2025</span>
           </div>
           <p class="s-reviews-body">
             <!-- Paste body, wrap 2-4 word phrases in <mark> -->
           </p>
           <div class="s-reviews-card-author">
             <span class="s-reviews-avatar">CU</span>
             <div>
               <div class="s-reviews-author-name">Chris Uhler</div>
               <div class="s-reviews-author-date">December 2, 2025</div>
             </div>
           </div>
         </article>
         <!-- Remaining review cards here -->
       </div>
       <div class="s-reviews-cta reveal">
         <a href="https://chromewebstore.google.com/detail/jt-power-tools/kfbcifdgmcendohejbiiojjkgdbjkpcn" class="btn btn--ghost" target="_blank" rel="noopener">See all reviews on Chrome Web Store →</a>
         <p class="s-reviews-trust">Join <strong>400+</strong> contractors already using JT Power Tools</p>
       </div>
     </div>
   </section>
   ```

4. Reload preview, verify highlights render as peach backgrounds, cards align properly 2-col / 1-col.

5. Commit:
   ```bash
   git add docs/styles.css docs/index.html
   git commit -m "feat: add reviews section with highlighted phrases"
   ```

---

### Task 3.9: Pricing section

**Files:**
- Modify: `docs/styles.css`
- Modify: `docs/index.html`

**Steps:**

1. Append CSS:

   ```css
   /* =========================================================
      Section: Pricing
      ========================================================= */
   .s-pricing { padding: clamp(72px, 9vw, 120px) 0; background: var(--surface-inset); }
   .s-pricing-toggle {
     display: inline-flex;
     align-items: center;
     gap: 14px;
     padding: 8px 16px;
     background: var(--surface);
     border-radius: var(--r-pill);
     border: 1px solid var(--border);
     margin-top: 16px;
   }
   .s-pricing-save {
     display: inline-block;
     background: var(--teal);
     color: #0D2E24;
     font-family: var(--font-sub);
     font-weight: 700;
     font-size: 11px;
     letter-spacing: 0.08em;
     text-transform: uppercase;
     padding: 4px 10px;
     border-radius: var(--r-pill);
   }
   .s-pricing-grid { display: grid; grid-template-columns: repeat(4, 1fr); gap: 20px; margin-top: 48px; }
   @media (max-width: 1100px) { .s-pricing-grid { grid-template-columns: repeat(2, 1fr); } }
   @media (max-width: 640px) { .s-pricing-grid { grid-template-columns: 1fr; } }

   .s-pricing-card {
     position: relative;
     background: var(--surface);
     border: 1px solid var(--border);
     border-radius: var(--r-xl);
     padding: 32px 24px;
     display: flex;
     flex-direction: column;
     gap: 18px;
   }
   .s-pricing-card--featured {
     border: 2px solid var(--purple);
     padding-top: 40px;
   }
   .s-pricing-featured-badge {
     position: absolute;
     top: -14px;
     left: 50%;
     transform: translateX(-50%);
     background: var(--purple);
     color: #fff;
     font-family: var(--font-sub);
     font-weight: 700;
     font-size: 10px;
     letter-spacing: 0.14em;
     text-transform: uppercase;
     padding: 6px 14px;
     border-radius: var(--r-pill);
   }
   .s-pricing-tier {
     font-family: var(--font-sub);
     font-weight: 700;
     font-size: 11px;
     letter-spacing: 0.16em;
     text-transform: uppercase;
   }
   .s-pricing-tier--free { color: var(--ink-subtle); }
   .s-pricing-tier--essential { color: var(--teal); }
   .s-pricing-tier--pro { color: var(--orange); }
   .s-pricing-tier--power { color: var(--purple); }

   .s-pricing-price {
     font-family: var(--font-display);
     font-size: 60px;
     line-height: 0.9;
     display: flex;
     align-items: baseline;
     gap: 4px;
   }
   .s-pricing-price [data-price-period] {
     font-family: var(--font-body);
     font-weight: 500;
     font-size: 14px;
     color: var(--ink-subtle);
   }
   .s-pricing-desc { font-size: 14px; color: var(--ink-muted); min-height: 3em; }
   .s-pricing-btn {
     display: block;
     width: 100%;
     padding: 12px 16px;
     border-radius: var(--r-sm);
     font-family: var(--font-body);
     font-weight: 700;
     font-size: 15px;
     text-align: center;
     border: 2px solid;
     transition: background var(--dur) var(--ease), color var(--dur) var(--ease);
   }
   .s-pricing-btn--free { border-color: var(--ink); color: var(--ink); background: transparent; }
   .s-pricing-btn--free:hover { background: var(--ink); color: var(--bg); }
   .s-pricing-btn--essential { border-color: var(--teal); color: var(--teal); background: transparent; }
   .s-pricing-btn--essential:hover { background: var(--teal); color: var(--ink); }
   .s-pricing-btn--pro { border-color: var(--orange); color: var(--orange); background: transparent; }
   .s-pricing-btn--pro:hover { background: var(--orange); color: #fff; }
   .s-pricing-btn--power { border-color: var(--purple); color: var(--purple); background: transparent; }
   .s-pricing-btn--power:hover { background: var(--purple); color: #fff; }

   .s-pricing-trial {
     font-family: var(--font-sub);
     font-weight: 600;
     font-size: 10px;
     letter-spacing: 0.14em;
     text-transform: uppercase;
     text-align: center;
     margin-top: -8px;
   }
   .s-pricing-trial--essential { color: var(--teal); }
   .s-pricing-trial--pro { color: var(--orange); }
   .s-pricing-trial--power { color: var(--purple); }

   .s-pricing-features { display: flex; flex-direction: column; gap: 10px; font-size: 14px; border-top: 1px solid var(--border); padding-top: 18px; margin-top: 4px; }
   .s-pricing-features li { display: flex; align-items: flex-start; gap: 10px; }
   .s-pricing-features i { flex-shrink: 0; margin-top: 3px; font-size: 14px; }
   .s-pricing-features--free i { color: var(--ink-subtle); }
   .s-pricing-features--essential i { color: var(--teal); }
   .s-pricing-features--pro i { color: var(--orange); }
   .s-pricing-features--power i { color: var(--purple); }

   .s-pricing-trust {
     text-align: center;
     margin-top: 40px;
     font-size: 13px;
     color: var(--ink-muted);
     display: flex;
     justify-content: center;
     gap: 16px;
     flex-wrap: wrap;
   }
   ```

2. Insert markup (four cards):

   ```html
   <section class="s-pricing" id="pricing">
     <div class="container">
       <div class="section-head reveal">
         <span class="t-label">Pricing</span>
         <h2 class="s-features-title">
           <span>Choose</span>
           <span class="accent">Your Plan.</span>
         </h2>
         <p class="t-lede" style="margin: 24px auto 0;">One subscription covers your entire organization.</p>
         <div class="s-pricing-toggle" data-billing-wrapper-anchor>
           <span>Monthly</span>
           <span class="toggle" data-billing-toggle role="switch" aria-checked="false" tabindex="0" aria-label="Toggle billing period"></span>
           <span>Yearly</span>
           <span class="s-pricing-save">Save 17%</span>
         </div>
       </div>
       <div class="s-pricing-grid reveal" data-billing-wrapper data-billing="monthly">
         <!-- FREE -->
         <article class="s-pricing-card">
           <div class="s-pricing-tier s-pricing-tier--free">Free</div>
           <div class="s-pricing-price"><span data-price-amount>$0</span></div>
           <p class="s-pricing-desc">Core tools to get started.</p>
           <a href="https://chromewebstore.google.com/detail/jt-power-tools/kfbcifdgmcendohejbiiojjkgdbjkpcn" class="s-pricing-btn s-pricing-btn--free" target="_blank">Install Free</a>
           <ul class="s-pricing-features s-pricing-features--free">
             <li><i class="ph ph-check"></i>Text Formatter</li>
             <li><i class="ph ph-check"></i>Dark Mode</li>
             <li><i class="ph ph-check"></i>Contrast Fix</li>
             <li><i class="ph ph-check"></i>Character Counter & Templates</li>
             <li><i class="ph ph-check"></i>Budget Hierarchy Shading</li>
             <li><i class="ph ph-check"></i>Budget Auto Sum</li>
           </ul>
         </article>
         <!-- ESSENTIAL -->
         <article class="s-pricing-card" data-monthly="10" data-yearly="100">
           <div class="s-pricing-tier s-pricing-tier--essential">Essential</div>
           <div class="s-pricing-price">
             <span data-price-amount>$10</span>
             <span data-price-period>/mo</span>
           </div>
           <p class="s-pricing-desc">Productivity tools for teams.</p>
           <a href="https://lightking7.gumroad.com/l/jtpowertools-essential" class="s-pricing-btn s-pricing-btn--essential">Get Essential</a>
           <div class="s-pricing-trial s-pricing-trial--essential">7-Day Free Trial</div>
           <ul class="s-pricing-features s-pricing-features--essential">
             <li><i class="ph ph-check"></i>Everything in Free</li>
             <li><i class="ph ph-check"></i>Quick Notes</li>
             <li><i class="ph ph-check"></i>Smart Resize</li>
             <li><i class="ph ph-check"></i>Freeze Header</li>
             <li><i class="ph ph-check"></i>PDF Markup Tools</li>
             <li><i class="ph ph-check"></i>Reverse Thread Order</li>
           </ul>
         </article>
         <!-- PRO -->
         <article class="s-pricing-card" data-monthly="20" data-yearly="200">
           <div class="s-pricing-tier s-pricing-tier--pro">Pro</div>
           <div class="s-pricing-price">
             <span data-price-amount>$20</span>
             <span data-price-period>/mo</span>
           </div>
           <p class="s-pricing-desc">Power users & customization.</p>
           <a href="https://lightking7.gumroad.com/l/jtpowertools-pro" class="s-pricing-btn s-pricing-btn--pro">Get Pro</a>
           <div class="s-pricing-trial s-pricing-trial--pro">7-Day Free Trial</div>
           <ul class="s-pricing-features s-pricing-features--pro">
             <li><i class="ph ph-check"></i>Everything in Essential</li>
             <li><i class="ph ph-check"></i>Schedule & Task Checkboxes</li>
             <li><i class="ph ph-check"></i>Custom Theme (3 slots)</li>
             <li><i class="ph ph-check"></i>Preview Mode</li>
             <li><i class="ph ph-check"></i>Availability Filter</li>
           </ul>
         </article>
         <!-- POWER USER -->
         <article class="s-pricing-card s-pricing-card--featured" data-monthly="30" data-yearly="300">
           <span class="s-pricing-featured-badge">Most Popular</span>
           <div class="s-pricing-tier s-pricing-tier--power">Power User</div>
           <div class="s-pricing-price">
             <span data-price-amount>$30</span>
             <span data-price-period>/mo</span>
           </div>
           <p class="s-pricing-desc">API-powered features.</p>
           <a href="https://lightking7.gumroad.com/l/jtpowertools-power" class="s-pricing-btn s-pricing-btn--power">Get Power User</a>
           <div class="s-pricing-trial s-pricing-trial--power">7-Day Free Trial</div>
           <ul class="s-pricing-features s-pricing-features--power">
             <li><i class="ph ph-check"></i>Everything in Pro</li>
             <li><i class="ph ph-check"></i>Job Switcher Filter</li>
             <li><i class="ph ph-check"></i>Budget Changelog</li>
             <li><i class="ph ph-check"></i>Unassigned Availability</li>
             <li><i class="ph ph-check"></i><strong>MCP Server Access</strong></li>
           </ul>
         </article>
       </div>
       <div class="s-pricing-trust reveal">
         <span><i class="ph ph-gift"></i> 7-day free trial on all paid plans</span>
         <span>·</span>
         <span><i class="ph ph-shield-check"></i> 30-day money-back</span>
         <span>·</span>
         <span><i class="ph ph-lightning"></i> Cancel anytime</span>
         <span>·</span>
         <span><i class="ph ph-lock"></i> One license per org</span>
       </div>
     </div>
   </section>
   ```

3. Reload preview. Click the billing toggle; verify:
   - All three paid cards swap $10/$20/$30 → $100/$200/$300
   - "/mo" changes to "/yr"
   - FREE card untouched
4. Screenshot both billing states.

5. Commit:
   ```bash
   git add docs/styles.css docs/index.html
   git commit -m "feat: add 4-tier pricing section with monthly/yearly toggle"
   ```

---

### Task 3.10: Final CTA section (dark block)

**Files:**
- Modify: `docs/styles.css`
- Modify: `docs/index.html`

**Steps:**

1. Append CSS:

   ```css
   /* =========================================================
      Section: Final CTA
      ========================================================= */
   .s-cta {
     position: relative;
     background: var(--ink);
     color: var(--bg);
     padding: clamp(72px, 10vw, 128px) 0;
     text-align: center;
     overflow: hidden;
   }
   .s-cta-hazard {
     position: absolute; top: 0; left: 0; right: 0; height: 6px;
     background-image: repeating-linear-gradient(135deg, var(--hazard) 0 12px, #0D0D0D 12px 24px);
   }
   .s-cta-eyebrow {
     font-family: var(--font-sub);
     font-weight: 600;
     font-size: 12px;
     letter-spacing: 0.18em;
     text-transform: uppercase;
     color: var(--hazard);
   }
   .s-cta-title {
     font-family: var(--font-display);
     font-size: clamp(56px, 8vw, 136px);
     line-height: 0.95;
     text-transform: uppercase;
     letter-spacing: 0.005em;
     margin: 16px 0 24px;
   }
   .s-cta-title .accent { color: var(--orange); }
   .s-cta-lede { color: rgba(255,255,255,0.8); font-size: 17px; max-width: 54ch; margin: 0 auto 32px; }
   .s-cta-buttons {
     display: flex; flex-wrap: wrap; gap: 14px; justify-content: center; margin-bottom: 18px;
   }
   .s-cta .btn--ink-inverted {
     background: transparent;
     color: var(--bg);
     border: 1px solid rgba(255,255,255,0.3);
   }
   .s-cta .btn--ink-inverted:hover { background: var(--orange); border-color: var(--orange); color: #fff; }
   .s-cta-note { font-size: 13px; color: rgba(255,255,255,0.6); }
   ```

2. Insert markup:

   ```html
   <section class="s-cta">
     <div class="s-cta-hazard" aria-hidden="true"></div>
     <div class="container">
       <span class="s-cta-eyebrow reveal">Ready?</span>
       <h2 class="s-cta-title reveal">
         <span>Power Up</span>
         <span class="accent">Your JobTread.</span>
       </h2>
       <p class="s-cta-lede reveal">Install in under 30 seconds. Keep everything free forever, or unlock the pros when you need them.</p>
       <div class="s-cta-buttons reveal">
         <a href="https://chromewebstore.google.com/detail/jt-power-tools/kfbcifdgmcendohejbiiojjkgdbjkpcn" class="btn btn--ink-inverted" target="_blank"><i class="ph ph-globe"></i> Chrome</a>
         <a href="https://microsoftedge.microsoft.com/addons/detail/jt-power-tools/mimieaaodidgnkblemjpfmffgikbnofi" class="btn btn--ink-inverted" target="_blank"><i class="ph ph-browser"></i> Edge</a>
         <a href="https://addons.mozilla.org/en-US/firefox/addon/jt-power-tools/" class="btn btn--ink-inverted" target="_blank"><i class="ph ph-fire"></i> Firefox</a>
       </div>
       <p class="s-cta-note reveal">No account needed · Works on app.jobtread.com · Starts earning time back immediately</p>
     </div>
   </section>
   ```

3. Reload preview, verify dark block rendering, hazard stripe, buttons.

4. Commit:
   ```bash
   git add docs/styles.css docs/index.html
   git commit -m "feat: add final CTA block with hazard stripe"
   ```

---

### Task 3.11: index.html — full-page review pass

**Steps:**

1. In preview, load the full index.html. Scroll top to bottom at:
   - Light theme, 1440px
   - Light theme, 900px
   - Light theme, 375px
   - Dark theme, 1440px
   - Dark theme, 375px
2. Use `preview_console_logs` to check for console errors (expect none).
3. Use `preview_network` to confirm all assets load 200 OK (fonts, icons, images, scripts).
4. Tab through the page to confirm focus visible rings appear on all interactive elements.
5. Screenshot the full page in both themes.
6. Note any layout issues — fix in follow-up micro-commits.

No tracked changes in this task (just verification), unless you find bugs → fix → commit.

---

## Phase 4 — about.html rewrite

### Task 4.1: Scaffold new about.html

**Files:** Modify `docs/about.html` (full rewrite).

**Steps:** Same scaffold as Task 3.1 — doctype, head with fonts + styles.css + theme.js/site.js, nav fragment, empty `<main>`, footer fragment. Title: `About — JT Power Tools`. Description: `Built by a contractor, for contractors. The story behind JT Power Tools.`

Commit: `feat: scaffold new about.html`.

---

### Task 4.2: About hero + story section

**Files:**
- Modify: `docs/styles.css` (append `.s-about-hero`, `.s-story`)
- Modify: `docs/about.html`

**Steps:**

1. Append CSS:

   ```css
   /* =========================================================
      About page
      ========================================================= */
   .s-about-hero {
     padding: clamp(80px, 8vw, 128px) 0 clamp(48px, 6vw, 80px);
     text-align: center;
   }
   .s-about-title {
     font-family: var(--font-display);
     font-size: clamp(56px, 8vw, 136px);
     line-height: 0.95;
     text-transform: uppercase;
     letter-spacing: 0.005em;
     margin: 16px 0 24px;
   }
   .s-about-title .serif {
     font-family: var(--font-serif);
     font-style: italic;
     color: var(--ink-italic);
     text-transform: none;
     letter-spacing: 0;
     display: block;
   }

   .s-story { padding: clamp(48px, 6vw, 96px) 0; }
   .s-story-grid {
     display: grid;
     grid-template-columns: 4fr 8fr;
     gap: 48px;
   }
   @media (max-width: 900px) { .s-story-grid { grid-template-columns: 1fr; gap: 24px; } }
   .s-story h2 {
     font-family: var(--font-display);
     font-size: clamp(40px, 5vw, 88px);
     line-height: 0.95;
     text-transform: uppercase;
     margin: 0;
   }
   .s-story-body p { margin: 0 0 20px; font-size: 17px; line-height: 1.65; color: var(--ink-muted); }
   .s-story-body p.lead::first-letter {
     font-family: var(--font-display);
     float: left;
     font-size: 88px;
     line-height: 0.85;
     color: var(--orange);
     padding: 4px 12px 0 0;
   }
   .s-story-quote {
     border-left: 2px solid var(--orange);
     padding: 8px 24px;
     font-family: var(--font-serif);
     font-style: italic;
     font-size: clamp(22px, 2.4vw, 28px);
     color: var(--ink);
     margin: 32px 0;
   }
   ```

2. Insert hero + story markup. Port the existing story copy from `git show HEAD~N:docs/about.html`. Mark the first paragraph with `class="lead"` for the drop-cap. Pick one strong line for the pull-quote.

3. Reload preview, verify drop-cap renders, pull-quote rule is orange.

4. Commit: `feat: add about page hero and story sections`.

---

### Task 4.3: Stats strip + built-with section

**Files:**
- Modify: `docs/styles.css`
- Modify: `docs/about.html`

**Steps:**

1. Append CSS:

   ```css
   .s-stats {
     background: var(--surface-inset);
     padding: clamp(48px, 6vw, 80px) 0;
   }
   .s-stats-grid {
     display: grid;
     grid-template-columns: repeat(5, 1fr);
     gap: 0;
   }
   @media (max-width: 900px) { .s-stats-grid { grid-template-columns: repeat(3, 1fr); } }
   @media (max-width: 560px) { .s-stats-grid { grid-template-columns: repeat(2, 1fr); } }
   .s-stats-item {
     text-align: center;
     padding: 16px;
     border-right: 1px solid var(--border);
   }
   .s-stats-item:last-child { border-right: 0; }
   .s-stats-num {
     font-family: var(--font-display);
     font-size: clamp(56px, 7vw, 88px);
     line-height: 1;
     color: var(--ink);
     margin-bottom: 8px;
   }
   .s-stats-label {
     font-family: var(--font-sub);
     font-weight: 600;
     font-size: 11px;
     letter-spacing: 0.14em;
     text-transform: uppercase;
     color: var(--ink-subtle);
   }

   .s-built { padding: clamp(64px, 8vw, 120px) 0; }
   .s-built-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 48px; }
   @media (max-width: 900px) { .s-built-grid { grid-template-columns: 1fr; } }
   .s-built-col h3 {
     font-family: var(--font-sub);
     font-weight: 600;
     font-size: 12px;
     letter-spacing: 0.14em;
     text-transform: uppercase;
     color: var(--ink);
     margin: 0 0 20px;
   }
   .s-built-chips { display: flex; flex-wrap: wrap; gap: 10px; }
   .s-built-chip {
     display: inline-flex; align-items: center; gap: 8px;
     padding: 10px 14px;
     background: var(--surface);
     border: 1px solid var(--border);
     border-radius: var(--r-sm);
     font-family: var(--font-body);
     font-weight: 500;
     font-size: 14px;
     color: var(--ink);
   }
   ```

2. Insert markup for both sections. Use current stat values (1 Developer, 20+ Features, 400+ Users, 5 Months, 3 Kids).

3. Reload preview, verify stats row wraps gracefully.

4. Commit: `feat: add about stats and built-with sections`.

---

### Task 4.4: About page Final CTA + review pass

**Steps:**

1. Copy the `<section class="s-cta">…</section>` from index.html and paste into about.html before the footer.
2. Full-page review pass like Task 3.11.
3. Commit: `feat: add CTA to about page and verify layout`.

---

## Phase 5 — roadmap.html rewrite

### Task 5.1: Scaffold new roadmap.html

**Files:** Modify `docs/roadmap.html`. Title: `Roadmap — JT Power Tools`.

Commit: `feat: scaffold new roadmap.html`.

---

### Task 5.2: Roadmap hero + legend

**Files:**
- Modify: `docs/styles.css`
- Modify: `docs/roadmap.html`

**Steps:**

1. Append CSS:

   ```css
   .s-roadmap-hero {
     padding: clamp(80px, 8vw, 128px) 0 clamp(48px, 6vw, 80px);
     text-align: center;
   }
   .s-legend {
     padding: 24px 0;
     border-bottom: 1px solid var(--border);
     display: flex;
     justify-content: center;
     align-items: center;
     gap: 20px;
     flex-wrap: wrap;
   }
   .s-legend-label {
     font-family: var(--font-sub);
     font-weight: 600;
     font-size: 11px;
     letter-spacing: 0.14em;
     text-transform: uppercase;
     color: var(--ink-subtle);
   }
   .s-legend-tag {
     display: inline-flex; align-items: center; gap: 6px;
     font-family: var(--font-sub);
     font-weight: 600;
     font-size: 11px;
     letter-spacing: 0.1em;
     text-transform: uppercase;
     padding: 4px 10px;
     border-radius: var(--r-pill);
     border: 1px solid var(--border);
   }
   .s-legend-tag::before {
     content: '●';
     font-size: 10px;
   }
   .s-legend-tag--launch::before { color: var(--orange); }
   .s-legend-tag--major::before { color: var(--teal); }
   .s-legend-tag--beta::before { color: var(--hazard); }
   .s-legend-tag--infra::before { color: var(--purple); }
   .s-legend-tag--planned {
     border-style: dashed;
     color: var(--ink-subtle);
   }
   .s-legend-tag--planned::before { color: var(--ink-subtle); }
   ```

2. Insert hero + legend markup. Hero heading: `Built Fast.` (ink) + `Shipping Faster.` (orange). Lede: as specified in the design doc.

3. Commit: `feat: add roadmap hero and legend`.

---

### Task 5.3: Timeline

**Files:**
- Modify: `docs/styles.css`
- Modify: `docs/roadmap.html`

**Steps:**

1. Append CSS:

   ```css
   .s-timeline { padding: clamp(48px, 6vw, 96px) 0; position: relative; }
   .s-timeline-rail {
     position: relative;
     max-width: 1000px;
     margin: 0 auto;
     padding-left: 40px;
   }
   .s-timeline-rail::before {
     content: '';
     position: absolute;
     top: 0; bottom: 0; left: 50%;
     width: 2px;
     background: var(--border);
     transform: translateX(-50%);
   }
   @media (max-width: 900px) {
     .s-timeline-rail { padding-left: 24px; }
     .s-timeline-rail::before { left: 12px; transform: none; }
   }

   .s-timeline-item {
     position: relative;
     padding: 20px 0 20px 48px;
     width: 50%;
   }
   .s-timeline-item--right { margin-left: 50%; padding-left: 48px; padding-right: 0; }
   .s-timeline-item--left { padding-left: 0; padding-right: 48px; text-align: right; }
   @media (max-width: 900px) {
     .s-timeline-item, .s-timeline-item--left, .s-timeline-item--right {
       width: 100%; margin-left: 0; padding-left: 32px; padding-right: 0; text-align: left;
     }
   }

   .s-timeline-dot {
     position: absolute; top: 28px;
     width: 16px; height: 16px;
     border-radius: 50%;
     box-shadow: 0 0 0 4px var(--bg);
   }
   .s-timeline-item--right .s-timeline-dot { left: -8px; }
   .s-timeline-item--left .s-timeline-dot { right: -8px; }
   @media (max-width: 900px) {
     .s-timeline-dot { left: 4px !important; right: auto !important; }
   }
   .s-timeline-dot--launch { background: var(--orange); }
   .s-timeline-dot--major { background: var(--teal); }
   .s-timeline-dot--beta { background: var(--hazard); }
   .s-timeline-dot--infra { background: var(--purple); }
   .s-timeline-dot--planned {
     background: var(--bg);
     border: 2px dashed var(--ink-subtle);
     box-shadow: 0 0 0 2px var(--bg);
   }

   .s-timeline-card {
     background: var(--surface);
     border: 1px solid var(--border);
     border-radius: var(--r-lg);
     padding: 24px;
     display: inline-block;
     text-align: left;
     transition: border-color var(--dur) var(--ease), transform var(--dur) var(--ease);
   }
   .s-timeline-card:hover { border-color: var(--ink); transform: translateY(-2px); }
   .s-timeline-card--planned { border-style: dashed; }
   .s-timeline-card--hazard {
     border-top: 6px solid transparent;
     background:
       repeating-linear-gradient(135deg, var(--hazard) 0 8px, #0D0D0D 8px 16px) 0 0 / 100% 6px no-repeat,
       var(--surface);
     padding-top: 30px;
   }
   .s-timeline-date {
     font-family: var(--font-sub);
     font-weight: 600;
     font-size: 11px;
     letter-spacing: 0.14em;
     text-transform: uppercase;
     color: var(--orange);
   }
   .s-timeline-tag {
     float: right;
     font-family: var(--font-sub);
     font-weight: 600;
     font-size: 10px;
     letter-spacing: 0.1em;
     text-transform: uppercase;
     padding: 2px 8px;
     border-radius: var(--r-pill);
     background: var(--surface-inset);
     color: var(--ink);
   }
   .s-timeline-version {
     font-family: var(--font-sub);
     font-weight: 600;
     font-size: 18px;
     letter-spacing: 0.04em;
     text-transform: uppercase;
     margin: 14px 0 12px;
   }
   .s-timeline-highlights { display: flex; flex-direction: column; gap: 6px; font-size: 14.5px; color: var(--ink-muted); }
   .s-timeline-highlights li { display: flex; gap: 8px; }
   .s-timeline-highlights li::before {
     content: '▸';
     color: var(--orange);
     flex-shrink: 0;
   }
   ```

2. Insert timeline markup. Port each milestone from `git show HEAD~N:docs/roadmap.html`. Alternate `--left`/`--right` on items, set appropriate `--launch`/`--major`/`--beta`/`--infra` classes on dot + tag. Every 4th card gets `--hazard`. The "What's next" card gets `--planned`.

3. Reload preview, verify rail renders centered desktop, left-aligned mobile, dots pop over the rail, cards alternate sides.

4. Commit: `feat: add roadmap timeline with color-coded milestones`.

---

### Task 5.4: Request-a-feature strip + Final CTA + review pass

**Files:**
- Modify: `docs/styles.css`
- Modify: `docs/roadmap.html`

**Steps:**

1. Append CSS:

   ```css
   .s-request {
     background: var(--surface-inset);
     padding: clamp(56px, 7vw, 96px) 0;
     text-align: center;
   }
   .s-request-title {
     font-family: var(--font-display);
     font-size: clamp(40px, 5vw, 72px);
     line-height: 0.95;
     text-transform: uppercase;
     margin: 16px 0 24px;
   }
   .s-request-buttons { display: flex; gap: 12px; justify-content: center; flex-wrap: wrap; }
   ```

2. Insert markup (request strip + CTA block copy-pasted from index.html).

3. Full-page review pass like Task 3.11.

4. Commit: `feat: add roadmap request strip and final CTA`.

---

## Phase 6 — Final polish + release

### Task 6.1: Cross-page link audit

**Steps:**

1. Grep for all anchor targets on the three rewritten pages:
   ```bash
   grep -rE 'href="#[a-z-]+"' docs/index.html docs/about.html docs/roadmap.html
   ```
2. Verify every `#id` has a matching `id=""` on the page.
3. Grep for all inter-page links:
   ```bash
   grep -rE 'href="(/[a-z-]+\.html|[a-z-]+\.html)"' docs/index.html docs/about.html docs/roadmap.html
   ```
4. For each target, verify the file exists.
5. Any broken link: fix. Commit: `fix: correct broken internal link`.

---

### Task 6.2: Inbound link audit from unmigrated pages

**Steps:**

1. Grep unmigrated pages for links pointing at index/about/roadmap:
   ```bash
   grep -rE 'href="(\/|index\.html|about\.html|roadmap\.html)' docs/changelog.html docs/documentation.html docs/privacy.html docs/reset.html docs/mcp/ docs/guides/
   ```
2. Verify anchors still exist on the new pages.
3. Fix any broken references.
4. Commit: `fix: update inbound links from unmigrated pages`.

---

### Task 6.3: Theme toggle — verify every section in dark mode

**Steps:**

1. Load each of the three rewritten pages in preview at dark mode (click the nav toggle once).
2. Scroll through every section. Visual checklist:
   - [ ] Hero: text legible on dark bg, popup mockup still contrasts, orange hasn't become muddy
   - [ ] Before/After: `--peach` peach bg swap works on dark (token changes to `#3A2A20`); ink/orange legible
   - [ ] Features: card surfaces distinct from page bg
   - [ ] Install: buttons readable (they're `--ink` bg, which is light in dark mode — text needs to be dark)
   - [ ] MCP: unchanged (always navy); verify no regressions
   - [ ] How It Works: numerals visible, borders distinct
   - [ ] Reviews: `<mark>` peach highlight visible
   - [ ] Pricing: surface-inset bg distinct, featured purple border visible
   - [ ] Final CTA: unchanged (always `--ink`)
3. Fix any contrast regressions — most likely `.btn--ink` in dark mode needs explicit override.
4. Commit each fix separately.

---

### Task 6.4: A11y + responsive + Lighthouse pass

**Steps:**

1. Run Lighthouse (Chrome DevTools or preview tool) on `docs/index.html`. Expect ≥ 95 perf, 100 a11y.
2. Resize to 375, 768, 1024, 1440. Confirm no horizontal scroll.
3. Tab through the nav, hero CTAs, feature cards, pricing cards, footer links. Focus ring visible on every element.
4. Turn on VoiceOver / Narrator briefly — confirm nav landmarks, headings announce correctly.
5. Fix any issues; commit.

---

### Task 6.5: Update CHANGELOG

**Files:** Modify `CHANGELOG.md`.

**Steps:**

1. Under `## [Unreleased]` add:

   ```markdown
   ### Changed
   - Redesigned docs/ landing site (index, about, roadmap) with new light-first warm editorial theme, dark-mode toggle, two-tone Anton/Oswald/Inter/Instrument Serif/JetBrains Mono type system, navy blueprint-grid MCP section, and text-only Before/After comparison. Old stylesheet preserved at `docs/styles.v3.css` for unmigrated pages.
   ```

2. Commit:
   ```bash
   git add CHANGELOG.md
   git commit -m "docs: log site redesign v4 in CHANGELOG"
   ```

---

### Task 6.6: PR prep

**Steps:**

1. `git log main..HEAD --oneline` → review commit history.
2. `git diff main -- docs/` → sanity check scope stays within `docs/`.
3. Confirm no stray files in the worktree (`git status` clean).
4. Draft PR description summarizing changes (link to design doc, list sections, call out un-migrated pages).

No commit — this is the handoff point. Stop here and surface the PR draft for user approval before pushing.

---

## Out of scope (explicit non-goals)

- Redesigning the extension popup UI (separate track; the hero mockup is a placeholder).
- Migrating `docs/documentation.html`, `docs/changelog.html`, `docs/privacy.html`, `docs/reset.html`, `docs/mcp/*`, `docs/guides/*`. They continue to use `styles.v3.css`.
- Any file under `JT-Tools-Master/`.
- New illustrations / photography / logo artwork.
- Server changes.

## Assumptions

- Google Fonts CDN remains available (no self-hosting required).
- Phosphor Icons CDN remains available.
- Gumroad overlay JS is still the purchase path.
- The `<mark>` highlight style on review bodies is acceptable (some assistive tech may announce "marked text").
- Existing logo assets (`Claude_AI_symbol.svg`, `ChatGPT-Logo.svg.png`, `gemini-color.png`, `grok--v2.png`, icons) stay in `docs/` at current paths.
