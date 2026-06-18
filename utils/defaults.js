/**
 * JT Power Tools - Shared Defaults and Constants
 * Single source of truth for default settings and configuration values
 */

const JTDefaults = (() => {
  /**
   * Default feature settings
   * All boolean values indicate whether a feature is enabled by default
   */
  const DEFAULT_SETTINGS = {
    // Premium Features (require license) - default to false
    dragDrop: false,
    previewMode: false,
    rgbTheme: false,

    // Free Features - Schedule & Calendar
    contrastFix: true,
    kanbanTypeFilter: false,
    autoCollapseGroups: false,
    ganttLines: true,

    // Free Features - Productivity Tools
    formatter: true,
    smartJobSwitcher: true,
    quickNotes: true,
    freezeHeader: false,
    characterCounter: false,
    pdfMarkupTools: true,
    reverseThreadOrder: false,
    budgetTools: false,
    documentSort: false,
    inspectForAi: false,    // off by default — most users won't author tweaks
    tweakEngine: true,      // on by default — installed tweaks should "just work"

    // Free Features - Appearance & Themes
    darkMode: false,
    budgetHierarchy: false,

    // Internal Features (not user-toggleable)
    helpSidebarSupport: true,
    keyboardShortcuts: true,

    // API (Experimental) Features
    customFieldFilter: false,

    // Power User Features (require API connection)
    budgetChangelog: false,
    taskTypeFilter: false,
    jobAccessCollapse: false,
    orgLogo: false,
    // Forms toggle moved from popup to portal (Migration 029). Default
    // true so content.js still loads features/forms.js; the feature
    // self-gates on the server-side company flag.
    forms: true,

    // Pro Features - Schedule & Calendar
    availabilityFilter: false,

    // Pro Features - Productivity Tools
    // fileDragToFolder: false, // Saved for a later version

    // Theme Configuration
    themeColors: {
      primary: '#3B82F6',     // Default blue
      background: '#F3E8FF',  // Light purple
      text: '#1F1B29'         // Dark purple
    },

    // Saved Theme Slots
    savedThemes: [null, null, null]
  };

  /**
   * Feature categories for UI organization
   */
  const FEATURE_CATEGORIES = {
    scheduleCalendar: ['dragDrop', 'kanbanTypeFilter', 'autoCollapseGroups', 'availabilityFilter', 'ganttLines'],
    productivityTools: ['formatter', 'smartJobSwitcher', 'quickNotes', 'previewMode', 'freezeHeader', 'characterCounter', 'pdfMarkupTools', 'reverseThreadOrder', 'inspectForAi', 'tweakEngine'],
    appearanceThemes: ['contrastFix', 'budgetHierarchy', 'darkMode', 'rgbTheme'],
    apiExperimental: ['customFieldFilter'],
    powerUser: ['budgetChangelog', 'taskTypeFilter']
  };

  /**
   * Timing constants (in milliseconds)
   */
  const TIMING = {
    // Feature initialization
    FEATURE_LOAD_DELAY: 150,
    FEATURE_LOAD_MAX_ATTEMPTS: 100,
    FEATURE_LOAD_TIMEOUT: 15000, // 100 * 150ms

    // DOM operations
    ELEMENT_WAIT_TIMEOUT: 5000,
    DEBOUNCE_DELAY: 500,
    SCROLL_DEBOUNCE: 100,

    // UI feedback
    STATUS_MESSAGE_DURATION: 3000,
    TOOLTIP_SHOW_DELAY: 500,
    TOOLTIP_FADE_DURATION: 200,

    // License validation
    LICENSE_REVALIDATION_INTERVAL: 24 * 60 * 60 * 1000, // 24 hours

    // Retry intervals
    BUTTON_INJECTION_RETRY: 500,
    BUTTON_INJECTION_MAX_RETRIES: 10,
    PERIODIC_CHECK_INTERVAL: 2000
  };

  /**
   * Size constraints
   */
  const SIZES = {
    // Quick Notes panel
    NOTES_PANEL_MIN_WIDTH: 320,
    NOTES_PANEL_MAX_WIDTH: 1200,

    // Undo/Redo history
    MAX_HISTORY_ENTRIES: 50,

    // Formatter toolbar
    TOOLBAR_HEIGHT: 44,
    TOOLBAR_PADDING: 8,

    // Preview panel (pinned mode)
    PREVIEW_PANEL_MIN_WIDTH: 280,
    PREVIEW_PANEL_MAX_WIDTH: 800,
    PREVIEW_PANEL_MIN_HEIGHT: 150,
    PREVIEW_PANEL_MAX_HEIGHT: 600,
    PREVIEW_PANEL_DEFAULT_WIDTH: 380
  };

  /**
   * DOM selectors used across features
   * Centralized to make updates easier if JobTread changes their DOM structure
   */
  const SELECTORS = {
    // Action bars
    ACTION_BAR: 'div.absolute.inset-0.flex.justify-end',

    // JobTread specific
    JOBTREAD_HEADER: 'header',
    JOBTREAD_SIDEBAR: 'aside',

    // Form fields
    DESCRIPTION_TEXTAREA: 'textarea[placeholder="Description"]',
    MESSAGE_TEXTAREA: 'textarea[placeholder="Message"]',

    // Budget hierarchy
    BUDGET_ROW: 'div[data-budget-item]'
  };

  /**
   * Storage keys
   */
  const STORAGE_KEYS = {
    SETTINGS: 'jtToolsSettings',
    LICENSE: 'jtToolsLicense',
    LICENSE_VERSION: 'jtToolsLicenseVersion',
    QUICK_NOTES: 'jtToolsQuickNotes',
    QUICK_NOTES_WIDTH: 'jtToolsQuickNotesWidth',
    MESSAGE_SIGNATURE: 'messageSignature',
    PREVIEW_PINNED_STATE: 'jtToolsPreviewPinnedState'
  };

  /**
   * Get a deep copy of default settings
   * @returns {Object} Copy of default settings
   */
  function getDefaultSettings() {
    return JSON.parse(JSON.stringify(DEFAULT_SETTINGS));
  }

  /**
   * Merge settings with defaults, ensuring all keys exist
   * @param {Object} settings - Partial settings object
   * @returns {Object} Complete settings object with defaults filled in
   */
  function mergeWithDefaults(settings) {
    const defaults = getDefaultSettings();

    if (!settings || typeof settings !== 'object') {
      return defaults;
    }

    // Shallow merge for top-level keys
    const merged = { ...defaults, ...settings };

    // Deep merge for themeColors
    if (settings.themeColors && typeof settings.themeColors === 'object') {
      merged.themeColors = { ...defaults.themeColors, ...settings.themeColors };
    }

    // Ensure savedThemes array has correct length
    if (!Array.isArray(merged.savedThemes) || merged.savedThemes.length !== 3) {
      merged.savedThemes = defaults.savedThemes;
    }

    return merged;
  }

  return {
    DEFAULT_SETTINGS,
    FEATURE_CATEGORIES,
    TIMING,
    SIZES,
    SELECTORS,
    STORAGE_KEYS,
    getDefaultSettings,
    mergeWithDefaults
  };
})();

// Make available globally
if (typeof window !== 'undefined') {
  window.JTDefaults = JTDefaults;
}

// Export for use in service worker or Node.js
if (typeof module !== 'undefined' && module.exports) {
  module.exports = JTDefaults;
}
