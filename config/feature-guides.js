/**
 * Feature Guides — in-popup help content.
 *
 * One entry per feature toggle rendered in popup.html, keyed by the same
 * `data-feature` id the checkbox uses. The popup's guide sheet
 * (popup/feature-guide.js) renders these; nothing here touches JobTread.
 *
 * This is the SINGLE SOURCE OF TRUTH for "what does this feature do and does
 * it need API access". Before this file existed the answer lived in three
 * places that drifted apart: the one-line <p> in popup.html, the standalone
 * pages under docs/guides/, and the feature module's own header comment. That
 * drift was load-bearing — `data-guide="file-drag-to-folder"` pointed at a
 * guide page that was never written, and six guide pages that DO exist were
 * linked from nowhere.
 *
 * ── apiAccess ───────────────────────────────────────────────────────────────
 * The field that earns this file's keep. A user toggling on Auto Sequence or
 * Budget Changelog without a grant key configured sees the feature do
 * NOTHING — no error in the UI, just silence. Three values:
 *
 *   'none'     — pure DOM/CSS. Works the moment it is toggled on.
 *   'optional' — core function works unaided; something extra needs an
 *                account or a key. `accessNote` says which half is which.
 *   'required' — reads or writes JobTread data. Dead without a grant key.
 *
 * Whenever a feature starts calling JobTreadAPI / the Pro Worker, its entry
 * here has to move to 'required' in the same change. tests/features/
 * feature-guides.test.js checks the obvious half of that automatically.
 *
 * ── media ───────────────────────────────────────────────────────────────────
 * `media` is null everywhere today; clips have not been recorded yet. The
 * sheet renders fine without it, so entries can be filled in one at a time
 * with no code change. When you do record:
 *
 *   media: { file: 'auto-sum.mp4', poster: 'auto-sum.jpg', alt: '…' }
 *
 * Resolved against MEDIA_BASE (R2, lazy-loaded on sheet open, then left to
 * the browser's HTTP cache). Prefer muted H.264 MP4 over GIF — a UI capture
 * runs 100–300 KB as MP4 against 2–5 MB as GIF, and GIF's 256-color cap
 * visibly wrecks JobTread's gradients and small text. `alt` is required when
 * media is present; it is the only description a screen-reader user gets.
 *
 * ── docs ────────────────────────────────────────────────────────────────────
 * Slug of the matching page under docs/guides/, or null when none exists yet.
 * The sheet renders an "Open full guide" link only when this is set, so a null
 * is a missing link rather than a 404 — which is the failure this replaces.
 */
const FeatureGuides = (() => {
  'use strict';

  /** Public R2 origin for guide media. Nothing is hosted here yet. */
  const MEDIA_BASE = 'https://media.jtpowertools.com/guides/';

  /** Docs-site guide pages live here. */
  const DOCS_BASE = 'https://jtpowertools.com/guides/';

  /** Where a user actually configures the grant key these features need. */
  const PORTAL_KEYS_URL = 'https://app.jtpowertools.com/dashboard#api-keys';

  const API_ACCESS = {
    NONE: 'none',
    OPTIONAL: 'optional',
    REQUIRED: 'required'
  };

  /**
   * Shared copy for the two things a 'required' feature always needs said.
   * Kept as constants so the wording can't drift entry to entry.
   */
  const NEEDS_KEY = 'Reads your JobTread data through a grant key. Until one is ' +
    'configured this feature has nothing to show — add a key in the portal under ' +
    'API Keys.';
  const WRITES_KEY = 'Reads and writes JobTread data through a grant key. Until ' +
    'one is configured it cannot run — add a key in the portal under API Keys.';

  const GUIDES = {
    // ─── Schedule & Calendar ──────────────────────────────────────────────
    kanbanTypeFilter: {
      title: 'Kanban Type Filter',
      tier: 'free',
      summary: 'Hides type columns that have no cards in them once you filter, ' +
        'so the board is only as wide as the work you are actually looking at.',
      where: 'Schedule → Kanban view, after you apply a filter.',
      apiAccess: API_ACCESS.NONE,
      media: null,
      docs: 'kanban-filter'
    },

    autoCollapseGroups: {
      title: 'Auto Collapse Completed Groups',
      tier: 'free',
      summary: 'Collapses every 100%-complete group when the Schedule loads, and ' +
        'adds an Expand/Collapse All Groups button so you can flip the whole ' +
        'schedule either way in one click.',
      where: 'Schedule view — applies on page load.',
      apiAccess: API_ACCESS.NONE,
      media: null,
      docs: 'auto-collapse'
    },

    documentSort: {
      title: 'Document Sort',
      tier: 'free',
      summary: 'Makes the Documents table column headers clickable so you can sort ' +
        'by name, job/account, subject, status, or amount.',
      where: 'Documents tab on a Job, a Customer, or a Vendor.',
      steps: [
        'Click any column header to sort by it. Click again to reverse.',
        'The first click force-loads every row before sorting. JobTread ' +
          'lazy-loads rows as you scroll, so without this you would only be ' +
          'sorting the handful of rows currently on screen.'
      ],
      apiAccess: API_ACCESS.NONE,
      media: null,
      docs: 'document-sort'
    },

    jobAccessCollapse: {
      title: 'Job Access Collapse',
      tier: 'free',
      summary: 'Makes the sections of the Job Access panel collapsible, so a long ' +
        'permissions list stops burying the group you need.',
      where: 'Job → Job Access panel.',
      apiAccess: API_ACCESS.NONE,
      media: null,
      docs: null
    },

    ganttLines: {
      title: 'Fat Gantt',
      tier: 'free',
      summary: 'Thickens the dependency lines on the Gantt chart so they are big ' +
        'enough to actually click and drag.',
      where: 'Schedule → Gantt view.',
      apiAccess: API_ACCESS.NONE,
      media: null,
      docs: 'fat-gantt'
    },

    scheduleMonthShading: {
      title: 'Schedule Month Shading',
      tier: 'free',
      summary: 'Shades alternating months on the Schedule calendar and traces the ' +
        'month boundary itself — stepping along the top of the new month, down the ' +
        'left of the 1st, then along the next week — so you can tell at a glance ' +
        'where one month ends and the next begins in a grid that shows three at once.',
      where: 'Schedule → calendar views.',
      apiAccess: API_ACCESS.NONE,
      media: null,
      docs: null
    },

    autoSequence: {
      title: 'Auto Sequence',
      tier: 'free',
      summary: 'Adds a button to the schedule mass-actions panel that re-orders the ' +
        'items in each group to match their start dates, so the list reads in the ' +
        'order the work actually happens.',
      where: 'Schedule → select items → mass-actions panel.',
      apiAccess: API_ACCESS.REQUIRED,
      accessNote: WRITES_KEY + ' Re-ordering writes the new position back to ' +
        'JobTread, so it cannot run key-less even though the feature itself is ' +
        'free. Without a key the panel says so and links you to the portal.',
      media: null,
      docs: null
    },

    dragDrop: {
      title: 'Schedule Task Checkboxes',
      tier: 'pro',
      summary: 'Puts a completion checkbox on task cards so you can mark work done ' +
        'from the board without opening each task.',
      where: 'Schedule → task cards.',
      apiAccess: API_ACCESS.NONE,
      media: null,
      docs: 'drag-drop'
    },

    availabilityFilter: {
      title: 'Availability Filter',
      tier: 'pro',
      summary: 'Filters the assignee list in the availability view down to one role ' +
        'or category, instead of scrolling the whole company.',
      where: 'Schedule → Availability view.',
      apiAccess: API_ACCESS.NONE,
      media: null,
      docs: 'availability-filter'
    },

    taskTypeFilter: {
      title: 'Unassigned Availability',
      tier: 'power-user',
      summary: 'Adds a TASKS row to the top of the Schedule Availability table ' +
        'showing work that has no one on it yet, with chips to filter by task type ' +
        '(Labor, Material, and so on).',
      where: 'Schedule → Availability view, above the assignee rows.',
      apiAccess: API_ACCESS.REQUIRED,
      accessNote: NEEDS_KEY,
      media: null,
      docs: 'unassigned-availability'
    },

    // ─── Budget ───────────────────────────────────────────────────────────
    budgetTools: {
      title: 'Auto Sum',
      tier: 'free',
      summary: 'Select budget line items and see live cost, price, and profit totals ' +
        'for just that selection — no exporting to a spreadsheet to check a subtotal.',
      where: 'Job → Budget.',
      apiAccess: API_ACCESS.NONE,
      media: null,
      docs: 'auto-sum'
    },

    budgetHierarchy: {
      title: 'Budget Hierarchy Shading',
      tier: 'free',
      summary: 'Shades nested budget groups by depth so the structure of a long ' +
        'budget is readable at a glance.',
      where: 'Job → Budget.',
      apiAccess: API_ACCESS.NONE,
      media: null,
      docs: 'budget-hierarchy'
    },

    budgetRowHighlight: {
      title: 'Budget Row Highlight',
      tier: 'essential',
      summary: 'Put a circle emoji (🔴 🟢 🔵 …) in any field on a budget row and the ' +
        'whole row tints to match — a highlight workaround for budgets, which have ' +
        'no native row color.',
      where: 'Job → Budget.',
      steps: [
        'Type a circle emoji into any field on the row.',
        'The row tints across every column, including the sticky number and name ' +
          'columns, so it reads as one band.',
        'Nine colors are supported. If a row has more than one, a fixed precedence ' +
          'order picks the winner.'
      ],
      apiAccess: API_ACCESS.NONE,
      media: null,
      docs: 'budget-row-highlight'
    },

    budgetChangelog: {
      title: 'Budget Changelog',
      tier: 'power-user',
      summary: 'Compares two budget backups and shows you exactly what changed ' +
        'between them — which lines moved, by how much, and in which direction.',
      where: 'Job → Budget.',
      apiAccess: API_ACCESS.REQUIRED,
      accessNote: NEEDS_KEY,
      media: null,
      docs: 'budget-changelog'
    },

    invoiceForecast: {
      title: 'Invoice Forecast',
      tier: 'power-user',
      summary: 'Adds an Invoice Forecast tab to Reports charting upcoming invoices ' +
        'by month — a solid bar for committed work on sold jobs, a hatched cap for ' +
        'projected work on jobs not yet sold. Hover any month for the job breakdown.',
      where: 'Reports → Invoice Forecast tab.',
      apiAccess: API_ACCESS.REQUIRED,
      accessNote: NEEDS_KEY,
      media: null,
      docs: 'invoice-forecast'
    },

    // ─── Documents & Text ─────────────────────────────────────────────────
    formatter: {
      title: 'Text Formatter',
      tier: 'free',
      summary: 'A rich-text toolbar on the text fields you actually write in — ' +
        'budget scopes, daily logs, and tasks. Bold, lists, headings, links.',
      where: 'Budget line items, daily logs, and task description fields.',
      apiAccess: API_ACCESS.NONE,
      media: null,
      docs: 'text-formatter'
    },

    characterCounter: {
      title: 'Message Counter & Templates',
      tier: 'free',
      summary: 'Shows a live character countdown on text fields so you find the limit ' +
        'before it truncates you, and lets you save signatures and stock messages to ' +
        'paste in.',
      where: 'Message and comment fields throughout JobTread.',
      apiAccess: API_ACCESS.NONE,
      media: null,
      docs: 'character-counter'
    },

    printScope: {
      title: 'Print Scope',
      tier: 'free',
      summary: 'Adds a Print button and a font-size picker to the Preview Document ' +
        'modal, so you can print or save a scope straight from a budget selection ' +
        'without creating a real document first.',
      where: 'Job → Budget → select line items → Preview Document.',
      apiAccess: API_ACCESS.NONE,
      media: null,
      docs: null
    },

    pdfMarkupTools: {
      title: 'PDF Markup Tools',
      tier: 'essential',
      summary: 'Adds stamp and eraser tools to the PDF viewer for marking up plans ' +
        'and submittals in place.',
      where: 'Any PDF opened inside JobTread.',
      apiAccess: API_ACCESS.NONE,
      media: null,
      docs: 'pdf-markup-tools'
    },

    reverseThreadOrder: {
      title: 'Reverse Thread Order',
      tier: 'pro',
      summary: 'Flips message threads so the newest post and the reply box are both ' +
        'at the top — no scrolling to the bottom of a long thread to answer it.',
      where: 'Comment and message threads.',
      apiAccess: API_ACCESS.NONE,
      media: null,
      docs: 'reverse-thread-order'
    },

    previewMode: {
      title: 'Preview Mode',
      tier: 'pro',
      summary: 'A floating panel that renders your formatted text live as you type, ' +
        'so you can see what a scope or log will look like before you save it.',
      where: 'Any formatted text field. Pairs with Text Formatter.',
      apiAccess: API_ACCESS.NONE,
      media: null,
      docs: 'preview-mode'
    },

    // ─── General ──────────────────────────────────────────────────────────
    smartJobSwitcher: {
      title: 'Smart Resize',
      tier: 'essential',
      summary: 'Lets you resize JobTread\'s side panels. Drag a sidebar wider or ' +
        'narrower and it stays that way — each sidebar remembers its own width.',
      where: 'Any sidebar in JobTread.',
      steps: [
        'Drag the edge of a sidebar to resize it.',
        'The width is remembered per sidebar, so each panel keeps its own size.'
      ],
      apiAccess: API_ACCESS.NONE,
      media: null,
      docs: 'job-switcher'
    },

    quickNotes: {
      title: 'Quick Notes',
      tier: 'essential',
      summary: 'A notepad you can open from any page in JobTread by pressing Q then ' +
        'N. Jot something down without losing the page you are on.',
      where: 'Anywhere in JobTread — press Q+N.',
      apiAccess: API_ACCESS.OPTIONAL,
      accessNote: 'No JobTread grant key needed. Notes are stored on this device ' +
        'until you sign in to your JT Power Tools account, which syncs them across ' +
        'your devices and unlocks shared team notes.',
      media: null,
      docs: 'quick-notes'
    },

    freezeHeader: {
      title: 'Freeze Header',
      tier: 'essential',
      summary: 'Pins the job header and its tab bar in place as you scroll, so you ' +
        'always know which job you are in and can switch tabs without scrolling back up.',
      where: 'Job pages.',
      apiAccess: API_ACCESS.NONE,
      media: null,
      docs: 'freeze-header'
    },

    customFieldFilter: {
      title: 'Job Switcher Filter',
      tier: 'power-user',
      summary: 'Filters the Job Switcher by custom field values — several fields at ' +
        'once, with multiple accepted values per field. Saved filters are shared ' +
        'across your company.',
      where: 'Job Switcher sidebar.',
      apiAccess: API_ACCESS.REQUIRED,
      accessNote: NEEDS_KEY,
      media: null,
      docs: 'custom-field-filter'
    },

    editableTables: {
      title: 'Editable Tables',
      tier: 'power-user',
      summary: 'Edit custom field cells without opening each job. Click the pencil ' +
        'on a cell, or Alt+click it, then type and press Enter. Tab saves and moves ' +
        'to the next one.',
      where: 'The Jobs list, in whichever saved view you have open.',
      note: 'A plain click still opens the job. Only custom field columns become ' +
        'editable — name, address and dates are left alone.',
      apiAccess: API_ACCESS.REQUIRED,
      accessNote: WRITES_KEY,
      media: null,
      docs: null
    },

    // ─── Appearance ───────────────────────────────────────────────────────
    darkMode: {
      title: 'Dark Mode',
      tier: 'free',
      summary: 'A dark theme for JobTread, in neutral greys rather than the blue-black ' +
        'most dark modes default to.',
      where: 'Everywhere in JobTread.',
      apiAccess: API_ACCESS.NONE,
      media: null,
      docs: 'dark-mode'
    },

    contrastFix: {
      title: 'Contrast Fix',
      tier: 'free',
      summary: 'Raises text contrast in the schedule view so labels stay readable ' +
        'against the color-coded bars.',
      where: 'Schedule view.',
      apiAccess: API_ACCESS.NONE,
      media: null,
      docs: 'contrast-fix'
    },

    rgbTheme: {
      title: 'Custom Theme',
      tier: 'pro',
      summary: 'Recolors the JobTread interface to a palette you pick — your own ' +
        'brand colors instead of the stock blue.',
      where: 'Everywhere in JobTread. Configure it in the Appearance tab here.',
      apiAccess: API_ACCESS.NONE,
      media: null,
      docs: 'custom-theme'
    },

    // ─── Tweaks & AI ──────────────────────────────────────────────────────
    tweakEngine: {
      title: 'User Tweaks Engine',
      tier: 'pro',
      summary: 'Runs the tweaks you have installed against JobTread pages. Tweaks are ' +
        'small user-authored rules that hide, restyle, or relabel parts of the UI. ' +
        'Turning this off disables every tweak on this device at once.',
      where: 'Tweaks tab here. Effects show up throughout JobTread.',
      apiAccess: API_ACCESS.NONE,
      media: null,
      docs: 'tweaks'
    },

    inspectForAi: {
      title: 'Inspect for AI',
      tier: 'pro',
      summary: 'Alt-click any element in JobTread and its DOM context — selector, ' +
        'ancestors, descendants, page URL — is copied to your clipboard as markdown. ' +
        'Paste that into Claude or ChatGPT and it has enough to write a working tweak ' +
        'for that exact element.',
      where: 'Anywhere in JobTread — alt-click while this is on.',
      steps: [
        'Turn it on, then alt-click the element you want to change.',
        'The context lands on your clipboard automatically.',
        'Paste it into your AI chat and ask for a tweak.',
        'Bring the result back to the Tweaks tab here.'
      ],
      apiAccess: API_ACCESS.NONE,
      media: null,
      docs: null
    },

    paveCapture: {
      title: 'Record for AI',
      tier: 'power-user',
      summary: 'Records the real Pave queries JobTread runs as you use it, so your AI ' +
        'can read them back through the MCP server and learn how your org\'s data is ' +
        'actually shaped.',
      where: 'Pave Explorer tab here. Recording happens as you browse JobTread.',
      note: 'Grant keys are stripped from every captured query before it is stored — ' +
        'the live credential never rides along with a recording.',
      apiAccess: API_ACCESS.NONE,
      media: null,
      docs: 'pave-explorer'
    }
  };

  /**
   * @param {string} featureId — the `data-feature` value from popup.html
   * @returns {object|null} the guide entry, or null when none is written yet
   */
  function get(featureId) {
    return Object.prototype.hasOwnProperty.call(GUIDES, featureId)
      ? GUIDES[featureId]
      : null;
  }

  /** @returns {string[]} every feature id that has a guide entry */
  function ids() {
    return Object.keys(GUIDES);
  }

  /** Absolute URL for a media filename, or null when the entry has no media. */
  function mediaUrl(file) {
    return file ? MEDIA_BASE + file : null;
  }

  /** Absolute URL for a docs slug, or null when the entry has no docs page. */
  function docsUrl(slug) {
    return slug ? DOCS_BASE + slug + '.html' : null;
  }

  return {
    API_ACCESS,
    PORTAL_KEYS_URL,
    MEDIA_BASE,
    DOCS_BASE,
    get,
    ids,
    mediaUrl,
    docsUrl
  };
})();

if (typeof window !== 'undefined') {
  window.FeatureGuides = FeatureGuides;
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = FeatureGuides;
}
