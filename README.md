# ⚡ JT Power Tools

[![Chrome Web Store](https://img.shields.io/badge/Chrome%20Web%20Store-Install-brightgreen?logo=googlechrome)](https://chromewebstore.google.com/detail/jt-power-tools/kfbcifdgmcendohejbiiojjkgdbjkpcn)
[![Version](https://img.shields.io/badge/version-4.5.3-blue)](https://chromewebstore.google.com/detail/jt-power-tools/kfbcifdgmcendohejbiiojjkgdbjkpcn)
[![Changelog](https://img.shields.io/badge/changelog-view-orange)](https://jtpowertools.com/changelog.html)
[![Docs](https://img.shields.io/badge/docs-jtpowertools.com-purple)](https://jtpowertools.com)

A Chrome & Firefox extension that supercharges [JobTread](https://www.jobtread.com) with 20+ productivity features for construction professionals.

**[📥 Install from Chrome Web Store](https://chromewebstore.google.com/detail/jt-power-tools/kfbcifdgmcendohejbiiojjkgdbjkpcn)** · **[📖 Documentation](https://jtpowertools.com)** · **[📋 Changelog](https://jtpowertools.com/changelog.html)**

---

## Features

### Free (No License Required)

| Feature | Description |
|---------|-------------|
| **Text Formatter** | Rich text toolbar with bold, italic, headings, tables, links, alerts, colors, and keyboard shortcuts |
| **Dark Mode** | Complete dark theme with neutral greys and current-date highlighting |
| **Contrast Fix** | WCAG-compliant text color adjustment for schedule views |
| **Budget Hierarchy Shading** | Progressive visual shading for nested budget groups (up to 5 levels) |
| **Kanban Type Filter** | Auto-hide empty columns in Kanban view |
| **Auto Collapse Groups** | Automatically collapse 100% complete budget/schedule groups |
| **Character Counter** | Real-time character count in message fields |
| **Budget Tools** | Selection totals and quick actions for budget line items |
| **Gantt Lines** | Enhanced visual gridlines for Gantt/schedule views |
| **Job Access Collapse** | Collapse job access sections for cleaner navigation |

### Essential ($10/mo per company)

| Feature | Description |
|---------|-------------|
| **Smart Job Switcher** | Keyboard-driven job search (J+S or Alt+J) with real-time filtering |
| **Quick Notes** | Persistent notepad with markdown, WYSIWYG editor, and cross-device sync |
| **Freeze Header** | Sticky column/row headers during table scrolling |
| **PDF Markup Tools** | Stamp selector and eraser for PDF annotations |
| **Reverse Thread Order** | Newest messages and reply form at the top |

### Pro ($20/mo per company)

| Feature | Description |
|---------|-------------|
| **Schedule & Task Checkboxes** | Complete tasks directly from calendar and action items |
| **Custom Theme** | Personalized HSL-based color palettes with up to 3 saved themes |
| **Preview Mode** | Live markdown preview with floating panel for descriptions and daily logs |
| **Availability Filter** | Filter schedule availability by role, department, or assignee category |

### Power User ($30/mo per company)

| Feature | Description |
|---------|-------------|
| **Job Switcher Filter** | Filter jobs by custom field values with saved filters and multi-org support |
| **Budget Changelog** | Interactive diff report comparing budget backups with search, filtering, and CSV export |
| **Task Type Filter** | Filter schedule by task type with quick-select presets |
| **Org Logo** | Admin-managed org branding replacing the JT logo (configured in portal) |
| **MCP Server** | Connect AI assistants (Claude, ChatGPT, Cursor, Gemini) to your JobTread data — 80+ tools |

---

## Installation

### Chrome Web Store (Recommended)

**[Install from Chrome Web Store](https://chromewebstore.google.com/detail/jt-power-tools/kfbcifdgmcendohejbiiojjkgdbjkpcn)**

### Firefox

Download the latest `.xpi` from [Releases](https://github.com/King0lightai/JT-Power-Tools-Extension/releases) or load the Firefox build as a temporary add-on.

### Load Unpacked (Development)

1. Clone this repository
2. Open `chrome://extensions` → enable Developer mode
3. Click **Load unpacked** → select the root folder
4. Navigate to `app.jobtread.com`

> **Note:** Premium features require a license from the Chrome Web Store version.

---

## Portal

Power User subscribers get access to the **[JT Power Tools Portal](https://app.jtpowertools.com)** for:

- **Extension Grant Keys** — per-org API keys for multi-org support
- **Org Logo Management** — set branding per org, applied to all team members
- **MCP Configuration** — AI assistant setup for Claude, ChatGPT, Cursor, and more
- **Team Management** — invite members, manage roles, view connection status

---

## MCP Server (AI Integration)

Power Users can connect AI assistants to their JobTread data via the [Model Context Protocol](https://modelcontextprotocol.io):

- **80+ tools** — search jobs, budgets, tasks, schedules, documents, contacts, and more
- **Read + Write** — create/update jobs, tasks, comments, daily logs, cost items, time entries
- **Multi-org** — per-org grant keys for companies with multiple JobTread organizations
- **Works with** — Claude (Code, Desktop, .ai), ChatGPT, Cursor, Windsurf, Gemini, Copilot

See the [MCP setup guides](https://jtpowertools.com/documentation.html) for each client.

---

## Architecture

```
├── background/          # Service worker (Chrome MV3)
├── config/              # Worker configuration
├── features/            # Feature modules (IIFE pattern with init/cleanup/isActive)
│   ├── drag-drop-modules/
│   ├── formatter-modules/
│   ├── budget-changelog-modules/
│   ├── quick-notes-modules/
│   └── rgb-theme-modules/
├── icons/               # Extension icons (light/dark variants)
├── popup/               # Settings UI (popup.html, popup.js, popup.css)
├── services/            # API services (Pro Worker, JobTread API, Grant Key Resolver)
├── styles/              # Feature CSS
├── utils/               # Shared utilities (sanitizer, DOM helpers, storage, color, debounce)
├── content.js           # Main orchestrator
└── manifest.json        # Chrome Extension Manifest V3
```

Each feature is a self-contained module:
```javascript
const FeatureName = (() => {
  let isActive = false;
  function init() { /* setup */ }
  function cleanup() { /* teardown */ }
  return { init, cleanup, isActive: () => isActive };
})();
window.FeatureName = FeatureName;
```

---

## Contributing

1. Fork this repo
2. Create a feature branch: `git checkout -b feat/my-feature`
3. Follow the [code style guidelines](CLAUDE.md#code-style-guidelines)
4. Test on `app.jobtread.com`
5. Submit a PR

---

## Links

- **Chrome Web Store:** [Install](https://chromewebstore.google.com/detail/jt-power-tools/kfbcifdgmcendohejbiiojjkgdbjkpcn)
- **Documentation:** [jtpowertools.com](https://jtpowertools.com)
- **Portal:** [app.jtpowertools.com](https://app.jtpowertools.com)
- **Changelog:** [jtpowertools.com/changelog](https://jtpowertools.com/changelog.html)
- **Issues:** [GitHub Issues](https://github.com/King0lightai/JT-Power-Tools-Extension/issues)
- **Discord:** [Join](https://discord.gg/jobtread)

---

## License

[MIT](LICENSE)
