# Portal Redesign v4 — Design Doc

**Date**: 2026-04-20
**Scope**: Full rewrite of the 5-page portal at `app.jtpowertools.com` (`portal/`). Applies the same design system established for the public site redesign (see `2026-04-19-site-redesign-v4-design.md`) to the logged-in app.
**Out of scope**: Backend/API changes. `js/auth.js` and `js/api.js` stay exactly as-is.

## Goals

- Align the portal with the public site's warm editorial design language.
- Light-first with dark-mode toggle, matching the site.
- Swap Bebas Neue → Anton/Oswald/Inter/Instrument Serif/JetBrains Mono.
- Replace the dark-only palette with `--bg`/`--surface`/`--ink` tokens imported from the site.
- Add **tier gating** on top of the existing role gating.
- Collapsible sidebar → top-tabs layout on mobile.
- Rename `Extension` section → `API Keys`.
- Rename `AI & MCP` section → `MCP`.

## Reused foundation

- Tokens: copy `docs/tokens.css` to `portal/css/tokens.css` (all colors, type, radii identical).
- Type stack: Anton / Oswald / Inter / Instrument Serif / JetBrains Mono.
- Brand mark: `jt-symbol-black.png` + `jt-symbol-white.png` (copied to `portal/`).
- FOUC bootstrap script in every page `<head>`.
- Dark mode: `html[data-theme="dark"]` override + `prefers-color-scheme` fallback.
- Icons: Phosphor via CDN (no emojis anywhere in UI).

## Shared shell

### Nav (all pages, including auth)
- Sticky, `--bg`, 1px bottom border.
- Left: JT gear logo + "Power Tools" wordmark (links to `index.html`).
- Right: theme toggle (`ph-moon` / `ph-sun`) + user pill + Sign Out ghost button.
- User pill: avatar circle (orange, initials) + first name + tier badge pill.
- No "Install Free" pill (logged-in context).
- On auth pages: nav is minimal — logo only, no user pill.

### Footer
- No footer on the portal (reduces chrome in an app context).

## Auth pages (index / register / forgot-password / reset-password)

### Layout — 50/50 split screen
- Desktop ≥ 1000px: two equal columns. Mobile: stacks, form on top.

### Left column — form
- White `--surface` on cream `--bg`
- Max-width 440px, vertically centered
- 32px padding
- Small label (`SIGN IN` / `CREATE ACCOUNT` / `RESET PASSWORD`) — Oswald small-caps orange, 12px, 0.12em tracking
- Page heading — Anton 48–72px, two-tone. Examples:
  - Sign in: `Welcome` (ink) `back.` (orange)
  - Register: `Join the` (ink) `kit.` (orange)
  - Forgot password: `Forgot` (ink) `password.` (orange)
  - Reset password: `Set a` (ink) `new one.` (orange)
- Form fields:
  - Label (Inter 500 13px, `--ink-muted`)
  - Input: 48px height, 1px `--border` hairline, 8px radius, Inter 400 16px
  - Focus: 2px `--orange` outline, 2px offset
- Primary CTA: full-width orange pill, Inter 600 16px, `ph-arrow-right` icon suffix
- Secondary links (forgot password, sign in instead): Inter 400 14px, `--orange` color, hover → `--orange-dark`
- Alert: `--peach` bg for success, light red-tinted peach for error, icon prefix (`ph-check-circle` or `ph-warning-circle`)

### Right column — brand moment
- `--bg` (cream) background
- Centered huge rotated JT gear:
  - Image: `jt-symbol-black.png` (swap to `jt-symbol-white.png` in dark)
  - Size: clamp(400px, 45vw, 600px)
  - Transform: rotate(15deg)
  - Opacity: 8%
  - Positioned relative within the column, visually centered
- Over the gear (higher z-index): single line Oswald small-caps 14px, 0.14em tracking, `--orange`: `THE MISSING PIECE OF YOUR JOBTREAD WORKFLOW`

### Mobile
- Below 1000px: right column hides entirely
- Form card gets max-width 440px + auto margin + 56px top padding
- Faint gear shows as absolute-positioned background accent at 4% opacity

## Dashboard layout

### Main shell
- Same nav as auth pages
- Optional sub-nav strip under main nav (only if user has multiple orgs): org switcher pill, Oswald small-caps, `ph-buildings` icon, dropdown on click
- Split: sidebar (240px fixed, desktop only) + main content

### Sidebar (desktop ≥ 1000px)
- `--surface-inset` bg, 1px right border
- Fixed position, full viewport height minus nav
- 16px padding
- Sidebar items (4 total, gated per user context):
  - `ph-user` Account (always visible)
  - `ph-robot` MCP (Power User tier + owner/admin role)
  - `ph-key` API Keys (Power User tier + owner/admin role)
  - `ph-users-three` Team (owner/admin role, any tier)
- Item style:
  - Flex row: 18px icon + 15px Inter 500 label, 14px vertical padding, 14px horizontal padding
  - Icons switch from `ph` → `ph-fill` on active
  - Active: 3px orange left rail + `--surface` bg + ink text
  - Hover: `--surface` bg, no rail
- Sidebar footer (below items):
  - Small label: `Portal v4.0`
  - Link to `jtpowertools.com` (`ph-arrow-square-out` icon)

### Mobile (< 1000px) — top-tabs
- Sidebar hides entirely
- Horizontal tab strip pinned below the nav
- `--surface-inset` bg, 1px bottom border, horizontal scroll on overflow
- Tabs: same items, active state = 3px orange underline bar + ink text
- Tap scrolls main content to top and switches section

### Main content
- Max-width 1100px
- Padding: clamp(32px, 5vw, 56px)
- Each section has a page-head:
  - Oswald small-caps orange label
  - Anton 40–56px display heading (two-tone when copy allows)
  - Inter 500 18px lede, `--ink-muted`, max-width 60ch

## Dashboard sections

### Account (everyone)

**Page head**: label `ACCOUNT` + heading `Your profile.` + lede `Manage your name, email, and password.`

**Card 1 — Profile**
- Avatar circle (orange, initials, 64px) + editable display name + email (read-only with helper text)
- Save button appears only when edited

**Card 2 — Password**
- Current / new / confirm fields
- 4-dot strength meter below new password
- Change Password ghost pill CTA

**Card 3 — Org & Plan**
- Org name, tier badge (Free/Essential/Pro/Power User, tier-colored per site pricing), member count, license renewal date
- Manage subscription → link to Gumroad (new tab — **not** an overlay)
- Upsell strip for non-Power-User: `--peach` band, *"Unlock MCP + API Keys by upgrading to Power User →"*

**Card 4 — Sign out everywhere**
- Single ghost pill, `--ink-subtle` text: *"Sign out of all sessions"*

### MCP (Power User + owner/admin)

**Page head**: label `MCP SERVER` + heading `AI access.` + lede `Connect Claude, ChatGPT, or any MCP-aware client to JobTread.`

**Card 1 — MCP endpoint**
- Mono line with the MCP URL
- Copy-to-clipboard (`ph-copy`) ghost button
- Helper text about supported clients

**Card 2 — Grant Key**
- Masked password-style field with reveal + copy
- Rotate Key ghost button (red-tinted hover) with confirm modal
- Warning text about invalidation

**Card 3 — Approved Senders** (vendor bill ingestion)
- Table: email · added on · added by · remove
- Add sender input + button below
- Empty state with explainer link

**Card 4 — Setup Guides**
- 3-col grid, 6 client cards (ChatGPT, Claude, Gemini, Grok, Claude Code, Cursor)
- Each: logo chip + name + Setup guide → link to `jtpowertools.com/mcp/*.html`

### API Keys (Power User + owner/admin)

**Page head**: label `API KEYS` + heading `Extension access.` + lede `Grant keys let the browser extension call the JobTread API for Power User features.`

**Card 1 — How this works** (dismissible onboarding strip)
- `--peach` band with 1px orange border
- Short explainer about per-org keys
- Link to "Where do I find a JobTread grant key?"

**Card 2 — Keys table**
- Columns: Org · Key (masked + reveal/copy) · Added by · Added on · Status · Actions
- Status pill: green Active, amber Unverified, grey Disabled
- Actions menu: Rotate · Disable · Delete (each with confirmation)
- Empty state: icon + primary CTA

**Card 3 — Add key form** (inline expansion)
- Org name field + Grant key field (paste detection)
- Validate button calls MCP endpoint to confirm before save
- Save button disabled until validation passes

**Card 4 — Multi-org tip**
- Small informational band: *"Adding a key for every org is optional — start with the one you use most."*

### Team (owner/admin role)

**Page head**: label `TEAM` + heading `Your organization.` + lede `Invite members, manage roles, and track seat usage.`

**Card 1 — Seat stats band**
- Full-bleed `--surface-inset`, 4 stats with 1px dividers: Members · Pending Invites · Plan · License Status
- Pattern matches roadmap stats band on the public site

**Card 2 — Invite new members**
- Multi-email chip input (Enter or comma adds another)
- Role selector dropdown: Member / Admin / Owner
- Send Invites orange pill

**Card 3 — Active members**
- Table: Avatar + Name · Email · Role (pill, tier-colored) · Joined · Last seen · Actions
- Actions: Change role · Remove (with confirm)
- Searchable / filterable when > 20 members
- Owner row can't change own role (safety)

**Card 4 — Pending invites**
- Table: Email · Sent · Sent by · Resend · Revoke
- Empty state: *"No pending invites."*

**Card 5 — Organization settings**
- Org name (editable inline)
- Logo upload (used by Org Logo feature in the extension)
- Timezone for activity timestamps
- Delete organization: red text, password confirm, buried at bottom

## Tier + role gating

Implemented in `portal/js/portal.js`:

```js
const TIER_RANK = { free: 0, essential: 1, pro: 2, power_user: 3 };
const isAdmin = ['owner', 'admin'].includes(user.role);
const isPowerUser = TIER_RANK[user.tier] >= TIER_RANK.power_user;

const visibility = {
  account: true,
  mcp: isPowerUser && isAdmin,
  apiKeys: isPowerUser && isAdmin,
  team: isAdmin,
};
```

- Each sidebar item gets `hidden` attribute toggled based on visibility.
- If the user deep-links to a hidden section (e.g. `#mcp` on a Pro org), show the Account section and display a one-time toast: *"That section isn't available on your plan."*
- Account section shows the Power User upsell strip when MCP/API Keys are hidden.

## Behavior scripts (vanilla, no deps)

**`portal/js/theme.js`** — copy of `docs/theme.js`. Toggle dark/light, persist to `localStorage('jt4-theme')`.

**`portal/js/portal.js`** — ~120 lines:
- Section switching: listens for `[data-section]` clicks on sidebar + top tabs, toggles `.is-active` on `.dashboard-section`
- Tier/role gating: reads `currentUser` from `auth.getUser()`, applies visibility rules
- Mobile sidebar → top-tabs: CSS handles layout swap; JS handles active state on both sets of items
- Copy-to-clipboard: `[data-copy]` buttons, toast feedback
- Password reveal: `[data-reveal]` buttons flip `input type="password"` ↔ `type="text"`
- Paste detection on grant key fields

**`portal/js/auth.js`** and **`portal/js/api.js`** — untouched.

## Accessibility + perf

- Focus-visible ring: 2px `--orange` outline + 2px offset on all interactive elements
- ARIA on sidebar/tabs: `role="tab"`, `aria-selected`, `aria-controls` pointing at section id
- Tables: proper `<th scope="col">` headers, `aria-label` on action menus
- `prefers-reduced-motion` disables reveal animations
- Fonts preconnected, `font-display: swap`
- Target: ≥ 95 Lighthouse perf, 100 a11y

## File changes

| File | Action |
|------|--------|
| `portal/css/portal.v3.css` | **New.** Archive of current `portal.css` (unused, kept for reference). |
| `portal/css/portal.css` | **Full rewrite.** ~900–1200 lines expected: imports tokens, base, nav, auth split-screen, dashboard sidebar/tabs, section cards, tables, forms. |
| `portal/css/tokens.css` | **New.** Copy of `docs/tokens.css`. |
| `portal/index.html` | **Full rewrite.** Split-screen sign-in. |
| `portal/register.html` | **Full rewrite.** Split-screen. |
| `portal/forgot-password.html` | **Full rewrite.** Split-screen. |
| `portal/reset-password.html` | **Full rewrite.** Split-screen. |
| `portal/dashboard.html` | **Full rewrite.** Sidebar + 4 section panels with tier/role gating. |
| `portal/js/theme.js` | **New.** Copy of `docs/theme.js`. |
| `portal/js/portal.js` | **New.** Section switching, gating, mobile tabs, copy-clipboard, password reveal. |
| `portal/js/auth.js` | **Unchanged.** |
| `portal/js/api.js` | **Unchanged.** |
| `portal/jt-symbol-black.png` | **New.** Copied from `docs/`. |
| `portal/jt-symbol-white.png` | **New.** Copied from `docs/`. |
| `portal/wrangler.jsonc` | **Unchanged.** |

## Testing plan

- Manual QA of all 5 pages at 3 breakpoints (375 / 768 / 1440) × 2 themes (light / dark) = 30 states.
- Every auth flow end-to-end: sign in → land on dashboard; register → confirmation screen; forgot password → email sent screen; reset password → success screen.
- Every dashboard section renders at each user profile:
  - Power User owner/admin: all 4 tabs
  - Power User member: Account only
  - Pro owner/admin: Account + Team (MCP + API Keys hidden)
  - Pro member: Account only
  - Essential owner/admin: Account + Team
  - Essential member: Account only
  - Free: Account only (no other tabs)
- Deep link to hidden section → correct toast fallback behavior.
- Copy-to-clipboard works.
- Theme toggle persists across reload.
- Focus-visible rings appear on every interactive element.
- No console errors on any page.

## CHANGELOG entry

```markdown
### Changed
- Redesigned portal (app.jtpowertools.com) with the new light-first warm editorial design system, dark-mode toggle, Anton/Oswald/Inter/Instrument Serif/JetBrains Mono type stack, split-screen auth pages, and collapsible sidebar that turns into top tabs on mobile. Renamed "Extension" section to "API Keys" and "AI & MCP" to "MCP". Added tier gating so only Power User orgs see MCP + API Keys tabs (on top of existing owner/admin role gating). Old portal stylesheet preserved at `portal/css/portal.v3.css`.
```
