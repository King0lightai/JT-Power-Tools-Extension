# ⚡ JT Power Tools

[![Chrome Web Store](https://img.shields.io/badge/Chrome%20Web%20Store-Install-brightgreen?logo=googlechrome)](https://chromewebstore.google.com/detail/jt-power-tools/kfbcifdgmcendohejbiiojjkgdbjkpcn)
[![Version](https://img.shields.io/badge/version-V3.6.0%20(Beta)-blue)](https://chromewebstore.google.com/detail/jt-power-tools/kfbcifdgmcendohejbiiojjkgdbjkpcn)
[![Changelog](https://img.shields.io/badge/changelog-view-orange)](https://king0lightai.github.io/JT-Power-Tools/changelog.html)

An all-in-one Chrome extension toolkit for JobTread with toggleable features and a sleek control panel.

**[📥 Install from Chrome Web Store](https://chromewebstore.google.com/detail/jt-power-tools/kfbcifdgmcendohejbiiojjkgdbjkpcn)**

## 🎯 Features

### 🆓 FREE TIER (No License Required)

#### 🎨 Contrast Fix
- Automatically adjusts text colors for better readability in schedule views
- Works on Month, Week, and Day schedule views only
- Uses WCAG contrast formula for optimal visibility
- Highlights current date in schedule view
- Real-time updates as content changes
- Mutual exclusivity with Dark Mode and Custom Theme

#### 📝 Text Formatter
- Rich text formatting toolbar for text fields
- Supports bold, italic, underline, strikethrough
- Headings (H1, H2, H3)
- Lists (bullets, numbered)
- Text alignment and colors with smart color switching
- Detects active formatting and highlights buttons
- Click same color to toggle off formatting
- Tables, links, quotes, and alerts
- Keyboard shortcuts (Ctrl/Cmd + B/I/U)
- MS Word-style active button states
- Works on budget descriptions and other text areas

#### 🌙 Dark Mode
- Beautiful dark theme for JobTread interface
- Reduces eye strain during long work sessions
- Customized for construction management workflows
- Smooth toggle on/off
- Syncs across devices
- Mutual exclusivity with Contrast Fix and Custom Theme

#### 🔢 Character Counter & Templates
- Displays character count for message text fields
- Shows current character count in real-time as you type
- Counter appears in the toolbar next to the writing assistant
- Helps stay within character limits before submitting messages
- **Message Templates**: Create and save reusable message templates
  - Click "Templates" to manage your templates
  - Click "Insert" to add a template at cursor position
  - Templates sync across devices via Chrome storage
  - Ctrl+Enter to quickly save in the modal

#### 📊 Budget Hierarchy Shading
- Progressive visual shading for nested budget groups (up to 5 levels)
- Level 1 (top-level groups) = Lightest shade
- Level 5 (deepest nested groups) = Darkest shade
- Line items automatically match their parent group's shading
- Adapts intelligently to Dark Mode and Custom Theme
- Preserves yellow highlighting for unsaved changes
- Smooth hover states for better visual feedback
- Real-time updates when expanding/collapsing groups
- Helps quickly identify group hierarchy and relationships at a glance

#### ⚠️ Kanban Type Filter
- Automatically hides empty columns (0 items) when in Kanban view grouped by type
- Clean up your Kanban board by removing clutter from empty type columns
- Works on both Schedule and Tasks/To-Dos pages
- Real-time updates as filters are applied or content changes
- Easy toggle on/off from the extension popup

#### 📁 Auto Collapse Completed Groups
- Automatically collapses schedule groups that are 100% complete on page load
- Reduces clutter by hiding completed work while keeping active items visible
- Works on Schedule views with grouped tasks
- Groups expand normally when clicked to view completed items
- Helps focus on remaining work without manual collapsing

---

### 📦 ESSENTIAL TIER ($10/mo per company)

#### ⚡ Smart Job Switcher
- Keyboard shortcuts (J+S or Alt+J) to instantly open job switcher
- Resizable sidebar - drag the left edge to customize width (280-800px)
- Width preference remembered across sessions
- Type to search and filter jobs in real-time
- Press Enter to select top result and navigate
- Press Escape to cancel and close
- Fully keyboard-driven workflow for power users

#### 📒 Quick Notes
- Persistent notepad accessible from any JobTread page
- Keyboard shortcut (Ctrl+Shift+N) to toggle notes panel
- Create, edit, search, and organize multiple notes
- Rich markdown formatting support (bold, italic, lists, checkboxes)
- WYSIWYG editor with formatting toolbar
- Resizable sidebar panel for comfortable note-taking
- Notes sync across devices via Chrome storage
- Word count and last updated timestamps
- Click Quick Notes button in header or use keyboard shortcut
- Press Escape to close editor or panel

#### 📌 Freeze Header
- Keeps job info and navigation tabs visible while scrolling
- Sticky header stays at top of viewport for easy access
- Quick access to job details without scrolling back up
- Works seamlessly with sidebar content
- Prevents frozen elements from overlapping scrollable content

#### ✏️ PDF Markup Tools
- Stamp Selector for Text and Callout tools
- Erase elements faster with the erase button!

---

### ⭐ PRO TIER ($20/mo per company)

#### 📅 Schedule & Task Checkboxes
- Checkboxes added to task cards in month schedule view for instant task completion
- Checkboxes added to Action Items card for instant task completion
- Mark tasks complete or incomplete directly from the calendar
- Visual feedback with smooth animations

#### 🎨 Custom Theme
- Personalize JobTread with your own color palette
- Choose primary, background, and text colors with inline previews
- Intelligent color coordination across entire interface
- Preserves task type colors with enhanced visibility
- Preserves yellow highlighting on edited budget cells
- 5px thick colored borders for clear task identification
- Themed formatter toolbar, buttons, links, and inputs
- Save up to 3 custom themes for quick switching
- Task cards blend seamlessly with custom background
- Mutual exclusivity with Contrast Fix and Dark Mode

#### 👁️ Preview Mode
- Live preview of formatted text with floating preview panel
- Click the preview button (eye icon) on textareas to see rendered formatting
- Converts markdown to beautifully styled HTML
- Works on budget descriptions and daily log fields
- Real-time updates as you type
- Intelligent positioning to avoid viewport edges
- Click outside preview to close

---

### 🚀 POWER USER TIER ($30/mo per company)

#### 🔍 Custom Field Filter
- Filter jobs by custom field values in the Job Switcher
- API-powered dropdown auto-populates with your custom field values
- Quickly find jobs based on project manager, status, or any custom field

#### 🤖 MCP Server Access
- Connect AI assistants (Claude, ChatGPT, Cursor, Gemini) to your JobTread data
- 22 tools for reading jobs, budgets, tasks, schedules, contacts, and more
- Built-in Pave API knowledge base for AI-assisted raw queries
- One-click configuration generator
- Priority support for AI integration issues

## 📦 Installation

### ⭐ Recommended: Chrome Web Store (For All Users)

**[Install from Chrome Web Store](https://chromewebstore.google.com/detail/jt-power-tools/kfbcifdgmcendohejbiiojjkgdbjkpcn)**

1. Click the link above
2. Click **Add to Chrome**
3. Confirm the installation
4. The extension icon will appear in your Chrome toolbar

**Important:** Premium features (Schedule Drag & Drop, Custom Theme) ONLY work with the Chrome Web Store version due to additional security features. GitHub/unpacked versions cannot activate premium licenses.

### For Developers: Load Unpacked

**Note:** This method is for development only. Premium features will not work.

1. **Download or clone** this repository
2. Open Chrome and navigate to `chrome://extensions`
3. Enable **Developer mode** (toggle in top right)
4. Click **Load unpacked**
5. Select the `JT-Tools-Master` folder
6. The extension is now installed (free features only)

## 🚀 Usage

### First-Time Setup

1. After installation, navigate to JobTread (`app.jobtread.com`)
2. Click the extension icon in your Chrome toolbar
3. You'll see the JT Power Tools control panel with feature toggle switches organized by category

### Toggling Features

- **Enable/Disable** any feature by clicking the toggle switch
- Features activate/deactivate instantly without page reload
- Settings are saved automatically and sync across devices
- Click **Refresh Current Tab** to reload the page with new settings

### Using the Features

#### Drag & Drop
1. Go to JobTread Schedule view
2. Click and hold a schedule item
3. Drag to another date cell
4. Drop and watch the date change automatically!

#### Contrast Fix
- Automatically active on schedule views
- No user interaction needed
- Adjusts text colors in real-time

#### Text Formatter
1. Go to any page with text fields (Budget, Notes, etc.)
2. Click in any text field
3. Formatting toolbar appears above the field
4. Use buttons to format text or keyboard shortcuts (Ctrl/Cmd + B/I/U)

#### Preview Mode (Premium)
1. Enable the feature and navigate to a budget or daily log page
2. Look for the eye icon button on textareas
3. Click the preview button to see a live preview of your formatted text
4. Preview updates in real-time as you type
5. Click outside the preview panel to close it

#### Smart Job Switcher
1. Press J+S or Alt+J from anywhere on JobTread (app.jobtread.com)
2. Job switcher sidebar opens with search focused
3. Type to filter jobs in real-time
4. Press Enter to select top result and navigate
5. Press Escape to close without selecting

#### Quick Notes
1. Click the "Quick Notes" button in the header or press Ctrl+Shift+N
2. Click "New Note" to create a note
3. Type a title and content with markdown formatting
4. Use the formatting toolbar for bold, italic, lists, and checkboxes
5. Search notes using the search bar
6. Click a note to view/edit it
7. Drag the left edge to resize the panel
8. Press Escape to close the editor or panel

#### Budget Hierarchy Shading
- Automatically active on budget pages when enabled
- No user interaction needed
- Groups are shaded progressively darker as nesting increases
- Line items automatically inherit their parent group's shade
- Works seamlessly with other appearance features
- Updates in real-time when groups are expanded or collapsed

## 💰 Pricing Tiers

JT Power Tools offers a tiered licensing system with features for everyone:

### 🆓 FREE (No License Required)
Works immediately after installation - no signup needed:
- **Text Formatter** - Rich text formatting toolbar
- **Dark Mode** - Beautiful dark theme
- **Contrast Fix** - WCAG-compliant text readability
- **Character Counter & Templates** - Real-time count + reusable message templates
- **Budget Hierarchy Shading** - Visual nesting indicators
- **Kanban Type Filter** - Auto-hide empty columns
- **Auto Collapse Groups** - Collapse completed groups

### 💼 Essential ($10/mo per company)
Perfect for teams wanting productivity tools:
- Everything in FREE, plus:
- **Quick Notes** - Persistent notepad with markdown & sync
- **Smart Job Switcher** - Keyboard shortcuts (J+S, Alt+J)
- **Freeze Header** - Sticky table headers
- **PDF Markup Tools** - Stamp selector & eraser

### ⭐ Pro ($20/mo per company)
For power users who want customization:
- Everything in Essential, plus:
- **Schedule & Task Checkboxes** - Instant task completion from calendar
- **Custom Theme** - Personalize with your own color palette
- **Preview Mode** - Live markdown preview panel

### 🚀 Power User ($30/mo per company)
For teams leveraging AI and advanced features:
- Everything in Pro, plus:
- **Custom Field Filter** - API-powered job filtering
- **MCP Server Access** - Connect AI assistants to JobTread

### License Activation

**⚠️ Important:** Paid features ONLY work with the [Chrome Web Store version](https://chromewebstore.google.com/detail/jt-power-tools/kfbcifdgmcendohejbiiojjkgdbjkpcn).

**💼 Company Licensing:** One monthly subscription per company — share the license key with all employees!

1. Install from [Chrome Web Store](https://chromewebstore.google.com/detail/jt-power-tools/kfbcifdgmcendohejbiiojjkgdbjkpcn)
2. Subscribe to a license from [jtpowertools.com](https://jtpowertools.com/subscribe.html)
3. Open the extension popup → License section
4. Enter your license key and click "Activate"
5. Share the key with your team

## 🏗️ Architecture

### File Structure
```
JT-Tools-Master/
├── manifest.json              # Extension manifest (Manifest V3)
├── content.js                 # Main orchestrator script
├── popup/
│   ├── popup.html            # Settings UI
│   ├── popup.js              # Settings logic
│   └── popup.css             # Settings styling
├── background/
│   └── service-worker.js     # Background service worker
├── features/
│   ├── drag-drop.js          # Drag & Drop module (Premium)
│   ├── drag-drop-modules/   # Drag & Drop sub-modules
│   ├── contrast-fix.js       # Contrast Fix module
│   ├── formatter.js          # Text Formatter module
│   ├── preview-mode.js       # Preview Mode module (Premium)
│   ├── job-switcher.js       # Smart Job Switcher module
│   ├── quick-notes.js        # Quick Notes module
│   ├── dark-mode.js          # Dark Mode module
│   ├── rgb-theme.js          # Custom Theme module (Premium)
│   └── budget-hierarchy.js   # Budget Hierarchy Shading module
├── styles/
│   ├── formatter-toolbar.css # Formatter toolbar styles
│   ├── preview-mode.css      # Preview Mode styles
│   ├── quick-notes.css       # Quick Notes styles
│   └── dark-mode.css         # Dark mode styles
└── icons/
    ├── icon16.png
    ├── icon48.png
    └── icon128.png
```

### How It Works

1. **Content Script** (`content.js`) loads on app.jobtread.com
2. **Feature Modules** are loaded dynamically based on user settings
3. **Popup UI** allows users to toggle features on/off
4. **Background Service Worker** manages settings and coordinates updates
5. **Chrome Storage API** persists settings across sessions

### Key Design Decisions

- **Modular Architecture**: Each feature is self-contained and can be enabled/disabled independently
- **Dynamic Loading**: Features are only loaded when enabled (performance optimization)
- **Hot Toggle**: Features can be toggled without page reload where possible
- **Separation of Concerns**: Settings, features, and UI are completely separate
- **Easy Updates**: Individual features can be updated without affecting others

## 🔧 Development

### Adding a New Feature

1. **Create feature module** in `features/new-feature.js`:
```javascript
const NewFeature = (() => {
  let isActive = false;

  function init() {
    isActive = true;
    // Your initialization code
  }

  function cleanup() {
    isActive = false;
    // Your cleanup code
  }

  return {
    init,
    cleanup,
    isActive: () => isActive
  };
})();

window.NewFeature = NewFeature;
```

2. **Register in content.js**:
```javascript
const featureModules = {
  // ... existing features
  newFeature: {
    name: 'New Feature',
    scriptPath: 'features/new-feature.js',
    instance: null,
    loaded: false
  }
};
```

3. **Add to popup UI** (`popup/popup.html`):
```html
<div class="feature-item">
  <div class="feature-info">
    <div class="feature-icon">🆕</div>
    <div class="feature-details">
      <h3>New Feature</h3>
      <p>Description of your feature</p>
    </div>
  </div>
  <label class="toggle">
    <input type="checkbox" id="newFeature" data-feature="newFeature">
    <span class="slider"></span>
  </label>
</div>
```

4. **Update manifest** if needed (web accessible resources, permissions, etc.)

### Testing

1. Make changes to your code
2. Go to `chrome://extensions`
3. Click the **Reload** button on the JT Power Tools extension
4. Test on JobTread

### Debugging

- Open Chrome DevTools (F12)
- Check the **Console** tab for logs
- All features log their status with prefixes like `DragDrop:`, `ContrastFix:`, etc.
- Use `chrome://extensions` to view background service worker logs

## 📝 Version History

**For detailed release notes and complete changelog, see the [Changelog](https://king0lightai.github.io/JT-Power-Tools/changelog.html)**

### v3.4.0 (Current - Beta)
- **New: Four-Tier License System**
  - FREE tier: Core features work without any license
  - Essential ($10): Quick Notes, Job Switcher, Freeze Header, PDF Markup
  - Pro ($20): Schedule Checkboxes, Custom Theme, Preview Mode
  - Power User ($30): Custom Field Filter, MCP Server Access
  - Backwards compatible: existing licenses get PRO tier
- **New: Custom Field Filter** (Power User)
  - Filter jobs by custom field values in Job Switcher
  - API-powered dropdown with auto-populated values
- **AI Integration Panel** (Power User)
  - MCP server with 22 tools for reading JobTread data
  - Config generator for Claude, ChatGPT, Cursor, Gemini
  - One-click copy configuration
  - Built-in Pave API knowledge base

### v3.3.6
- **New Feature: Auto Collapse Completed Groups**
  - Automatically collapses schedule groups that are 100% complete on page load
  - Helps focus on remaining work without manual collapsing
- **Custom Theme Improvements**
  - Complete overhaul with HSL-based color palette generation
  - Rich palette with multiple background, border, and text shades
- **Bug Fixes**
  - Fixed budget hierarchy resize handles getting shaded
  - Fixed Smart Job Switcher Enter key behavior

### v3.3.3
- **Architecture & Stability**
  - **Most Stable Version Yet**: Comprehensive restructuring for enhanced reliability
  - Restructured color theme and dark mode systems for better performance
  - Improved code organization and modularity across all features
- **Text Formatter & Preview Mode Enhancements**
  - Added more robust formatting rendering and detection
  - Enhanced compatibility with various textarea types and page structures
  - Improved reliability of formatter toolbar appearance
  - Better detection of editable fields for formatter activation
- **Color Theme & Dark Mode**
  - Complete restructuring of color theme implementation
  - Enhanced dark mode reliability and consistency
  - Improved theme switching and color application logic
  - Better integration between custom themes and dark mode

This release represents a major stability milestone for JT Power Tools. Extensive restructuring of core systems has significantly improved reliability and performance.

### v3.3.2
- **Preview Mode Enhancements**
  - Added inline color markup support for text highlighting
  - Upgraded alert builder to JobTread-style modal dialog
  - Improved alert rendering with proper styling and icons
  - Fixed alert heading level from 4 to 3 hashtags for better hierarchy
- **Quick Notes Improvements**
  - Expanded Quick Notes button to appear on all main pages with action bars
  - Better integration with JobTread's page structure
- **Bug Fixes**
  - Fixed preview button staying blue when preview window closes
  - Fixed preview mode bug where switching rows showed previous row content
  - Prevented text formatter from appearing on settings page
  - Fixed cursor visibility in dark mode for budget textareas
  - Fixed budget row highlighting to supersede hierarchy shading in dark mode
  - Fixed button detection to support both div and link action buttons

### v3.3.1
- **New Feature: Action Items Quick Completion**
  - Checkboxes added to Action Items card for instant task completion
  - Complete action items directly from dashboard without navigation
  - Hidden iframe technology ensures seamless background completion
  - Visual feedback with smooth fade-out animation when tasks are completed
  - Automatic task removal from list upon successful completion
- **New Feature: Month Schedule Task Completion**
  - Checkboxes added to task cards in month schedule view
  - Quickly mark tasks complete or incomplete directly from calendar
  - Visual completion status indicator shows current task state
  - Instant task status updates without opening task details
- **Help Sidebar Integration**
  - JT Power Tools support section added to JobTread help sidebar
  - Help Sidebar Support feature now always enabled by default
- **Bug Fixes & Improvements**:
  - Fixed Quick Notes from running on settings pages
  - Fixed sidebar hiding CSS from blocking help modals
  - Fixed sticky header text elements from overlapping when scrolling
  - Fixed column resize handles appearing over frozen column headers
  - Fixed dark mode background colors to prevent white flash
  - Fixed text formatter disabled for Time Clock Notes field

### v3.3.0
- **New Feature: Quick Notes**
  - Persistent notepad accessible from any JobTread page
  - Keyboard shortcut (Ctrl+Shift+N) to toggle notes panel
  - Create, edit, search, and organize multiple notes
  - Rich markdown formatting support (bold, italic, lists, checkboxes)
  - WYSIWYG editor with formatting toolbar
  - Resizable sidebar panel for comfortable note-taking
  - Notes sync across devices via Chrome storage
  - Word count and last updated timestamps
  - Integrates seamlessly with JobTread header buttons
- **New Premium Feature: Preview Mode**
  - Live preview of formatted text with floating preview panel
  - Click preview button (eye icon) on textareas to see rendered formatting
  - Converts markdown to beautifully styled HTML
  - Works on budget descriptions and daily log fields
  - Real-time updates as you type
  - Intelligent positioning to avoid viewport edges
  - Click outside preview to close

### v3.2.3
- **New Feature: Budget Hierarchy Shading**
  - Progressive visual shading for nested budget groups (up to 5 levels)
  - Level 1 (top) = Lightest, Level 5 (deepest) = Darkest
  - Line items automatically inherit parent group shading
  - Adapts intelligently to Dark Mode and Custom Theme
  - Preserves yellow highlighting for unsaved changes
  - Smooth hover states for better visual feedback
  - Real-time updates when expanding/collapsing groups
  - Helps quickly identify group hierarchy at a glance
- **Enhancements & Bug Fixes**:
  - Improved budget hierarchy shading using HSL color space for better visual consistency
  - Added primary color tooltips for text formatter buttons
  - Fixed budget hierarchy URL detection to work with all budget page variations
  - Custom theme now applies to selected box borders for consistent theming
  - Added dark mode support for text formatter toolbar
  - Theme-aware styling for JobTread header logo
  - Collapsible customize button for cleaner custom theme interface
  - Smart Job Switcher now supports both J+S and Alt+J keyboard shortcuts

### v3.1.0
- **New Feature: Smart Job Switcher**
  - J+S keyboard shortcut to instantly open job switcher
  - Type to search and filter jobs in real-time
  - Enter to select top result and navigate
  - Escape to cancel and close
  - Fully keyboard-driven workflow for power users
- **Drag & Drop Modularization**:
  - Refactored from 1,475 lines to modular architecture
  - Split into 6 focused modules: date-utils, weekend-utils, ui-utils, sidebar-manager, date-changer, event-handlers
  - Main file reduced to 149 lines (90% reduction)
  - Easier to maintain and extend
- **UI/UX Improvements**:
  - Renamed "Budget Formatter" to "Text Formatter" for clarity
  - Redesigned theme customization with inline color previews
  - Moved Dark Mode below Smart Job Switcher in popup
  - Added Premium badge to Schedule Drag & Drop feature
  - Simplified popup to minimal white aesthetic
- **Custom Theme Enhancements** (Premium):
  - Inline color preview boxes next to each color picker
  - Preserves yellow highlighting on edited budget cells
  - Enhanced task type color visibility with 5px thick borders
  - Task cards now use theme background with colored border
  - Subtle shadow effect for better visual depth
  - Preserves task type identification while unifying appearance
- **Major Drag & Drop Fixes**:
  - Fixed December→January year transitions (2025→2026)
  - Fixed date moves in future years (Jan 2026, Feb 2026)
  - Always includes year in date format for accuracy
  - Intelligent year inference using source date as baseline
  - Year validation when page shows different months
- **Formatter Improvements**:
  - Color switching: Change colors by clicking different color buttons
  - Active color detection and button highlighting
  - Click same color to toggle off formatting

### v3.0.0
- Added Custom Theme feature (Premium)
- RGB color sliders for personalized themes
- Mutual exclusivity between appearance modes
- Integrated contrast fix into custom theme
- Enhanced popup UI with collapsible sections

### v1.0.0
- Initial public release
- Four core features: Schedule Drag & Drop, Contrast Fix, Text Formatter, Dark Mode
- Premium licensing system via Gumroad
- Clean, professional popup interface
- Cross-year drag & drop support
- Smart weekend detection with override
- React-compatible formatting events
- Dark mode theme with schedule card overrides
- Toggle controls via popup UI
- Modular architecture for easy expansion

## 🤝 Contributing

Contributions are welcome! To contribute:

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Test thoroughly
5. Submit a pull request

## 📄 License

MIT License - See [LICENSE](LICENSE) file for details.

## 📦 Chrome Web Store

**[🌟 Install JT Power Tools from Chrome Web Store](https://chromewebstore.google.com/detail/jt-power-tools/kfbcifdgmcendohejbiiojjkgdbjkpcn)**

The extension is now live on the Chrome Web Store! For documentation related to the store listing, see the [`chrome-web-store/`](chrome-web-store/) folder:

- **Store Listing**: [CHROME_WEB_STORE_LISTING.md](chrome-web-store/CHROME_WEB_STORE_LISTING.md)
- **Privacy Policy**: [PRIVACY_POLICY.md](chrome-web-store/PRIVACY_POLICY.md)
- **Submission Guide**: [CHROME_WEB_STORE_SUBMISSION_GUIDE.md](chrome-web-store/CHROME_WEB_STORE_SUBMISSION_GUIDE.md)
- **Single Purpose**: [SINGLE_PURPOSE_STATEMENT.txt](chrome-web-store/SINGLE_PURPOSE_STATEMENT.txt)

## 🐛 Known Issues

- **Formatter**: Some complex formatting scenarios may require page refresh
- **Drag & Drop**: Only changes start date by default (use Alt key to modify end date)

## 📧 Support

For issues, questions, or feature requests:
- Open an issue on [GitHub Issues](https://github.com/King0lightai/JT-Tools/issues)
- Premium support: [Subscribe](https://jtpowertools.com/subscribe.html)

## 🙏 Acknowledgments

Built for the JobTread community to enhance productivity and user experience.

---

**Made with ❤️ for JobTread users**
