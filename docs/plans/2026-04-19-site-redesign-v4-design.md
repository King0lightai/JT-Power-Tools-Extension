# Site Redesign v4 — Design Doc

**Date**: 2026-04-19
**Scope**: Full rewrite of `docs/index.html`, `docs/about.html`, `docs/roadmap.html` + a new shared stylesheet. Other docs pages unchanged this round.
**Inspiration**: `JT Power Tools - Standalone.html` sample + provided screenshots.

## Goals

- Move the marketing site from a dark neon theme to a **warm editorial light-first** theme with a dark-mode toggle.
- Establish a consistent **section pattern**: small orange small-caps label → two-tone display heading → lede → content.
- Add a text-only **Before/After** comparison section.
- Restyle MCP / AI section as a **navy blueprint-grid** block.
- Keep stack vanilla HTML/CSS/JS. No build step, no framework.

## Design tokens

### Light (default)
| Token | Value | Use |
|-|-|-|
| `--bg` | `#F5F1EA` | Page background (warm cream) |
| `--surface` | `#FFFFFF` | Card bg |
| `--surface-inset` | `#EDE7DC` | Secondary panels |
| `--peach` | `#FDD9BE` | "With Power Tools" card, highlights |
| `--ink` | `#1A1A1A` | Primary text, display |
| `--ink-muted` | `#5A5A5A` | Body secondary |
| `--ink-subtle` | `#8A8A8A` | Labels, captions |
| `--ink-italic` | `#6B5E4E` | Instrument Serif italic tone |
| `--border` | `#E3DCCF` | Hairlines |
| `--border-strong` | `#1A1A1A` | Outline buttons |

### Dark (`[data-theme="dark"]`)
Uses neutral greys per project rules (no blue-greys):
| Token | Value |
|-|-|
| `--bg` | `#1A1A1A` |
| `--surface` | `#242424` |
| `--surface-inset` | `#1F1F1F` |
| `--ink` | `#F2EDE3` |
| `--ink-muted` | `#B0B0B0` |
| `--ink-subtle` | `#8A8A8A` |
| `--border` | `#333333` |
| `--border-strong` | `#F2EDE3` |

### Brand / accents (shared)
| Token | Value | Use |
|-|-|-|
| `--orange` | `#FE4C0D` | Primary CTA, Pro tier, highlight type |
| `--orange-dark` | `#D94000` | Hover |
| `--teal` | `#00C896` | Essential tier, "save 17%" badge |
| `--purple` | `#A855F7` | Power User tier, "Most Popular" |
| `--navy` | `#14315F` | MCP / AI section bg |
| `--hazard` | `#FFC43C` | Yellow hazard stripe, AI heading accent |

## Typography

- **Display**: `Anton` — hero + section headings, all-caps, condensed
- **Sub-display**: `Oswald` 600 — card titles, nav, small-caps labels
- **Body**: `Inter` 400/500/600
- **Accent**: `Instrument Serif` italic — sparingly, editorial flourishes
- **Mono**: `JetBrains Mono` — MCP example prompts only

### Scale
| Role | Size | Line height |
|-|-|-|
| Hero display | `clamp(64px, 9vw, 180px)` | 0.9 |
| Section display | `clamp(44px, 6vw, 104px)` | 0.95 |
| Card title | 20–22px Oswald 600, tracking 0.02em | 1.2 |
| Small-caps label | 12px Oswald 600, tracking 0.12em | 1 |
| Body | 16–17px Inter 400 | 1.55 |
| Lede | 18–20px Inter 500 | 1.5 |

### Radii / borders / shadow
- Radii: `sm 8px`, `md 12px`, `lg 20px`, `pill 999px`
- Borders: hairline `1px` everywhere; outline buttons `1px`; featured pricing card `2px`
- Shadows: minimal (flat editorial). Optional 2px lift on card hover.

## Page structure

### Nav (sticky, shared)
- **Background**: `--bg` with 1px bottom `--border`.
- **Left cluster** (all left-aligned): `JT` logo mark + wordmark, then links `Features · Install · Pricing · AI · Roadmap · About`.
- **Right cluster**: `Dark/Light` toggle (icon + label) + `Install Free` orange pill.
- **Mobile**: hamburger → full-height slide-down sheet with the same links stacked.

### Footer (shared)
- 4-col grid: **Brand** · **Product** · **Resources** · **Legal**.
- Brand col: logo, tagline, version pill, Chrome rating badge, "Made by a contractor, for contractors."
- Bottom strip: `© 2026 JT Power Tools` (left) + `[✓ Official JobTread Partner]` small pill (right).

### index.html sections (order)
1. Hero
2. Before/After ("The Difference")
3. Features grid
4. Install row ("Everywhere You Work")
5. MCP / AI (navy blueprint)
6. How It Works
7. Reviews
8. Pricing
9. Final CTA (dark block)
10. Footer

### about.html sections
1. Hero (shorter)
2. Story ("Why I Built This") — two-col asymmetric, drop-cap, pull-quote
3. Stats strip (full-bleed, 5 stats)
4. Built-With (2-col tech chip grid)
5. Final CTA
6. Footer

### roadmap.html sections
1. Hero
2. Legend strip (5 color-coded tag pills)
3. Timeline (vertical rail, alternating cards)
4. "Request a Feature" strip
5. Final CTA
6. Footer

## Section specs

### Hero (index)

- 12-col grid, `min-height: 88vh`, left col 7/12 content, right col 5/12 popup mockup.
- Pill above headline: `[✓ OFFICIAL JOBTREAD PARTNER]` (orange outline, Oswald small-caps).
- Headline (Anton, clamp 64–180px, lh 0.9):
  - `JOBTREAD IS` (ink)
  - `GREAT.` (ink)
  - `THIS MAKES IT` (orange)
  - `AWESOME.` (orange)
- Lede: *"The all-in-one browser extension toolkit that transforms JobTread into a powerhouse. Dark mode, rich text formatting, message templates, job switcher filtering, and more."*
- CTAs: orange `Install Free Extension` pill + ghost `See Features` pill.
- Trust line: `⭐ 5.0 on Chrome Web Store · 400+ contractors · 20+ features`.
- **Popup mockup** right: placeholder dark card representing extension popup tabs (Features / Theme / API / License) and toggles. To be replaced when popup UI is updated to match.

### Before/After — "The Difference"

- Centered label `THE DIFFERENCE`.
- Two-typeface heading: `JOBTREAD,` (Anton ink) + `NOW WITH POWER TOOLS.` (Instrument Serif italic, `--ink-italic`).
- **Two side-by-side cards** (stacks to 1-col mobile with "With Power Tools" on bottom):
  - **Left — "Standard JobTread"**: label muted, bg `--surface-inset`, muted `✕` icons.
  - **Right — "With Power Tools"**: label orange, bg `--peach`, orange `✓` icons.
- 7 rows each, hairline dividers. Copy verbatim from screenshot (see §Copy below).

### Features grid

- Label `WHAT'S IN THE KIT`.
- Heading: `ONE EXTENSION.` / `EVERY FIX.` (ink / orange).
- Lede: *"20+ features across scheduling, formatting, theming, and AI. Each toggle-able. All one install."*
- 4-col grid (→ 2 tablet, → 1 mobile), 24px gap.
- **Card**: surface bg, 1px border, 16px radius, 24px padding. Icon chip top-left (40×40, 1px border, Phosphor icon). Tier badge top-right (`PRO` orange, `ESSENTIAL` teal, `POWER` purple, none for free). Title Oswald 600 18px small-caps. Body Inter 400 14.5px `--ink-muted`. Hover: lift 2px, border → `--ink`.
- ~20 cards total (actual count audited during implementation).
- Below grid: single text link `See all features →`.

### Install row — "Everywhere You Work"

- Label `INSTALL` centered + rule.
- Heading: `EVERYWHERE` / `YOU WORK.` (ink / orange).
- Browser buttons centered row: Chrome, Edge, Firefox (solid ink pills with white text + icon), Safari disabled pill (`— Soon`). Hover: ink → orange fill.
- Fine print: *"Use **Brave, Arc, or Opera**? Choose Chrome — same store. · Safari supports extensions on iPhone & iPad."*

### MCP / AI toolkit (navy blueprint)

- Full-bleed `--navy` bg.
- **Blueprint grid**: two repeating linear-gradients — 1px at `rgba(255,255,255,0.06)` 40px cells + 1px at `rgba(255,255,255,0.10)` 200px cells.
- **Top edge**: yellow/black hazard stripe (16px tall, repeating SVG).
- Eyebrow `AI TOOLKIT · INCLUDED WITH POWER USER` in electric blue `#7AB5FF`.
- Heading: `YOUR AI NEEDS A` / `TOOLBELT.` (white / `--hazard`).
- Lede white 85%.
- **MCP client grid** 3×2: ChatGPT, Claude, Gemini, Grok, Claude Code, Cursor. Glass cards — `rgba(255,255,255,0.04)` bg, 1px `rgba(255,255,255,0.10)` border.
- **Example prompts chip row**: label `EXAMPLE PROMPTS` hazard-yellow, 4 JetBrains Mono 13px chips:
  - `"Compare this bid request against the project scope"`
  - `"Pull key metrics for my production meeting"`
  - `"Forecast labor needs for the next 2 weeks"`
  - `"Pull historical budget data to develop costs for a new project"`
- Footer line white 70%: *"MCP server access included with Power User tier. Free to try for 30 days."*

### How It Works

- Label `HOW IT WORKS` + rule.
- Heading: `THREE STEPS.` / `ZERO FUSS.` (ink / orange).
- 3 step cards, numerals Anton 88–120px orange upper-left, hairline divider, title Oswald small-caps, body, Phosphor icon bottom-right.
  1. `INSTALL THE EXTENSION`
  2. `OPEN JOBTREAD`
  3. `TURN ON WHAT YOU NEED`
- Below row: text link `Read the full guide →`.

### Reviews

- Label `REVIEWS` + rule.
- Heading: `LOVED BY` / `CONTRACTORS.` (ink / orange).
- Star summary: 5 orange stars + `5.0` Anton 40px + `· 13 REVIEWS ON CHROME WEB STORE`.
- 2-col grid of review cards:
  - Stars + date.
  - Body Inter 400 16px. Key phrases wrapped in `<mark>` with `--peach` bg.
  - Bottom row with hairline divider: orange 40×40 avatar (initials Oswald 600) + name Inter 600 + date `--ink-subtle`.
- 6 visible by default; `LOAD MORE` ghost button appears if > 6.
- Below: pill link `See all reviews on Chrome Web Store →` + trust line `Join **400+** contractors already using JT Power Tools` (orange on number).

### Pricing (4-tier)

- Label `PRICING` + rule.
- Heading: `CHOOSE` / `YOUR PLAN.` (ink / orange).
- Lede: *"One subscription covers your entire organization."*
- **Billing toggle**: `Monthly` / iOS pill / `Yearly` + teal `Save 17%` badge. JS flips `data-billing` attribute; CSS/JS swaps prices via `data-monthly` / `data-yearly`.
- **4 cards** equal-height:

| Tier | Price (mo/yr) | Desc | Button | Highlights |
|-|-|-|-|-|
| FREE (muted ink) | $0 | Core tools to get started | `Install Free` (ink outline) | Text Formatter, Dark Mode, Contrast Fix, Char Counter, Hierarchy Shading, Budget Auto Sum |
| ESSENTIAL (teal) | $10 / $100 | Productivity tools for teams | `Get Essential` (teal outline) | Everything in Free + Quick Notes, Smart Resize, Freeze Header, PDF Markup, Reverse Thread Order |
| PRO (orange) | $20 / $200 | Power users & customization | `Get Pro` (orange outline) | Everything in Essential + Schedule & Task Checkboxes, Custom Theme (3 slots), Preview Mode, Availability Filter |
| POWER USER (purple) ⭐ | $30 / $300 | API-powered features | `Get Power User` (purple outline) | Everything in Pro + Job Switcher Filter, Budget Changelog, Unassigned Availability, **MCP Server Access** |

- Power User card: 2px purple border, `MOST POPULAR` purple pill overlapping top edge.
- **Each paid card**: `7-DAY FREE TRIAL` small-caps label in tier color directly under the CTA button.
- Trust row below grid: `🆓 7-day free trial on all paid plans · 🛡 30-day money-back · ⚡ Cancel anytime · 🔒 One license per org`.

### Final CTA (dark block)

- Full-bleed `--ink` bg, cream text, 6px hazard-stripe top edge.
- Eyebrow hazard-yellow `READY?`.
- Heading: `POWER UP` / `YOUR JOBTREAD.` (cream / orange).
- Lede cream 80%.
- Browser button row (inverted — cream outline on dark, hover fills orange).
- Below buttons: `No account needed · Works on app.jobtread.com · Starts earning time back immediately`.

### About hero/story/stats/built-with

- Hero: label `ABOUT`, heading `BUILT BY` (Anton) + `A CONTRACTOR.` (Instrument Serif italic).
- Story: two-col asymmetric, **drop-cap** (Anton 96px orange float-left) on first paragraph, pull-quote with 2px orange left-rule, Instrument Serif italic.
- Stats strip: full-bleed `--surface-inset`, 5 stats separated by 1px rules: `1 Developer · 20+ Features · 400+ Users · 5 Months · 3 Kids`.
- Built-With: label `UNDER THE HOOD`, heading `BUILT ON BOTH SIDES.`, 2-col tech chip grid ("EXTENSION" / "INFRASTRUCTURE").

### Roadmap hero/legend/timeline

- Hero: label `ROADMAP`, heading `BUILT FAST.` / `SHIPPING FASTER.` (ink / orange). Lede: *"6 months. 20+ features. 400+ contractors. Here's how JT Power Tools got here — and where it's going."*
- Legend: `● LAUNCH` (orange) · `● MAJOR` (teal) · `● BETA` (amber) · `● INFRA` (purple) · `● PLANNED` (dashed `--ink-subtle`).
- Timeline: central 2px rail, alternating cards desktop. 16px color dot with 4px cream halo. Card: date (orange small-caps) + tag pill + version+title (Oswald small-caps) + bullet list with orange `▸`. Every 4th card gets a 6px hazard ribbon top edge. Final "planned" card: dashed border + muted dot.
- Request-a-feature strip: `--surface-inset` band, `HAVE AN IDEA?` / `SEND IT OVER.`, two pills (Email support, GitHub issue).

## Behavior

Five tiny JS features, vanilla, no deps:

1. **Theme toggle** (`theme.js`, ~30 lines): init from `localStorage('jt4-theme')` or `prefers-color-scheme`, set `data-theme` on `<html>`, persist on toggle.
2. **Pricing billing toggle** (`pricing.js`, ~40 lines): flips `data-billing` on wrapper; swaps `.price-amount` from `data-monthly` / `data-yearly`; updates `/mo` vs `/yr` suffix.
3. **Mobile nav** (inline per page, ~20 lines): hamburger toggles `.is-open` on nav sheet.
4. **Scroll-spy active nav link** (inline, ~15 lines): `IntersectionObserver` per section, marks corresponding nav link active.
5. **Reveal-on-scroll** (inline, ~10 lines): `IntersectionObserver` adds `.is-visible` to section labels + headings; respects `prefers-reduced-motion`.

## Accessibility + perf

- Semantic `<nav>`, `<main>`, `<section>`, `<footer>`.
- All icon-only buttons get `aria-label`.
- Focus-visible ring: 2px `--orange` outline + 2px offset.
- `prefers-reduced-motion` disables reveal animations + hover transforms.
- Fonts preconnected, `font-display: swap`.
- Lighthouse targets: ≥ 95 perf / 100 a11y.
- Per-page wire weight: < 180 KB (icons only, no inline images).

## File changes

| File | Action |
|------|--------|
| `docs/styles.css` | Moved to `docs/styles.v3.css` (used by other pages until migrated). |
| `docs/styles.css` (new) | Full rewrite using new tokens + components. |
| `docs/tokens.css` | **New** — tokens + fonts + resets. Imported first by `styles.css`. |
| `docs/index.html` | **Full rewrite**. |
| `docs/about.html` | **Full rewrite**. |
| `docs/roadmap.html` | **Full rewrite**. |
| `docs/theme.js` | **New**. |
| `docs/pricing.js` | **New**. |

**Not touched this round**: `docs/documentation.html`, `docs/changelog.html`, `docs/privacy.html`, `docs/reset.html`, `docs/mcp/*`, `docs/guides/*`. These continue to import `styles.v3.css`. Their migration is a follow-up.

**Also not touched**: anything under `JT-Tools-Master/` (extension code), favicon, images, existing SVG/PNG logos.

## Testing plan

- Manual QA via `preview_start` on all 3 pages.
- Light + dark, 3 breakpoints (375 / 768 / 1440).
- Verify Gumroad overlay opens from pricing CTAs.
- Verify all existing anchor links (`#features`, `#install`, `#pricing`, `#mcp`, etc.) resolve.
- Verify existing inbound links from other pages (changelog, docs, guides) still work — check `<a href>` targets with a grep.

## Out of scope

- Extension popup UI update (separate track; we note here that the hero mockup will be refreshed once the popup is redesigned).
- Any file under `JT-Tools-Master/`.
- Other docs pages (migration is a follow-up).
- New illustrations / photography / logo work.
- Server changes.

## CHANGELOG entry

```markdown
### Changed
- Redesigned docs/ landing site (index, about, roadmap) with new light-first warm editorial theme, dark-mode toggle, two-tone display typography, MCP blueprint-grid section, and text-only Before/After comparison.
```
