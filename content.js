/**
 * JT Power Tools - Content Script Orchestrator
 *
 * This is the main entry point for the extension's content script.
 * It manages the lifecycle of all feature modules, handling:
 * - Loading user settings from Chrome storage
 * - Initializing enabled features
 * - Responding to settings changes from the popup
 * - Coordinating feature cleanup on disable
 * - Tier-based feature gating (v2.0)
 *
 * @module content
 * @author JT Power Tools Team
 * @version 3.3.7
 */

console.log('JT Power Tools: Content script loaded');

// Current license tier (cached for performance)
let currentTier = null;

/**
 * Feature module registry
 * Maps feature keys to their configuration and window references
 *
 * Each feature must implement the standard interface:
 * - init(): Initialize the feature
 * - cleanup(): Clean up resources and remove UI
 * - isActive(): Return boolean indicating if feature is active
 *
 * @type {Object.<string, {name: string, feature: Function, instance: Object|null}>}
 */
const featureModules = {
  dragDrop: {
    name: 'Drag & Drop',
    feature: () => window.DragDropFeature,
    instance: null
  },
  contrastFix: {
    name: 'Contrast Fix',
    feature: () => window.ContrastFixFeature,
    instance: null
  },
  formatter: {
    name: 'Formatter',
    feature: () => window.FormatterFeature,
    instance: null
  },
  previewMode: {
    name: 'Preview Mode',
    feature: () => window.PreviewModeFeature,
    instance: null
  },
  darkMode: {
    name: 'Dark Mode',
    feature: () => window.DarkModeFeature,
    instance: null
  },
  rgbTheme: {
    name: 'RGB Custom Theme',
    feature: () => window.RGBThemeFeature,
    instance: null
  },
  smartJobSwitcher: {
    name: 'Smart Job Switcher',
    feature: () => window.SmartJobSwitcherFeature,
    instance: null
  },
  budgetHierarchy: {
    name: 'Budget Hierarchy Shading',
    feature: () => window.BudgetHierarchyFeature,
    instance: null
  },
  quickNotes: {
    name: 'Quick Notes',
    feature: () => window.QuickNotesFeature,
    instance: null
  },
  helpSidebarSupport: {
    name: 'Help Sidebar Support',
    feature: () => window.HelpSidebarSupportFeature,
    instance: null
  },
  keyboardShortcuts: {
    name: 'Keyboard Shortcuts',
    feature: () => window.KeyboardShortcutsFeature,
    instance: null
  },
  freezeHeader: {
    name: 'Freeze Header',
    feature: () => window.FreezeHeaderFeature,
    instance: null
  },
  characterCounter: {
    name: 'Character Counter',
    feature: () => window.CharacterCounterFeature,
    instance: null
  },
  kanbanTypeFilter: {
    name: 'Kanban Type Filter',
    feature: () => window.KanbanTypeFilterFeature,
    instance: null
  },
  autoCollapseGroups: {
    name: 'Auto-Collapse Full Groups',
    feature: () => window.AutoCollapseGroupsFeature,
    instance: null
  },
  documentSort: {
    name: 'Document Sort',
    feature: () => window.DocumentSortFeature,
    instance: null
  },
  budgetTools: {
    name: 'Budget Tools',
    feature: () => window.BudgetTools,
    instance: null
  },
  pdfMarkupTools: {
    name: 'PDF Markup Tools',
    feature: () => window.PDFMarkupToolsFeature,
    instance: null
  },
  customFieldFilter: {
    name: 'Job Switcher Filter',
    feature: () => window.CustomFieldFilterFeature,
    instance: null
  },
  budgetChangelog: {
    name: 'Budget Changelog',
    feature: () => window.BudgetChangelogFeature,
    instance: null
  },
  availabilityFilter: {
    name: 'Availability Filter',
    feature: () => window.AvailabilityFilterFeature,
    instance: null
  },
  ganttLines: {
    name: 'Fat Gantt',
    feature: () => window.GanttLinesFeature,
    instance: null
  },
  reverseThreadOrder: {
    name: 'Reverse Thread Order',
    feature: () => window.ReverseThreadOrderFeature,
    instance: null
  },
  taskTypeFilter: {
    name: 'Unassigned Availability',
    feature: () => window.TaskTypeFilterFeature,
    instance: null
  },
  jobAccessCollapse: {
    name: 'Job Access Collapse',
    feature: () => window.JobAccessCollapseFeature,
    instance: null
  },
  orgLogo: {
    name: 'Org Logo',
    feature: () => window.OrgLogoFeature,
    instance: null
  },
  inspectForAi: {
    name: 'Inspect for AI',
    feature: () => window.InspectForAiFeature,
    instance: null
  },
  tweakEngine: {
    name: 'User Tweaks',
    feature: () => window.TweakEngineFeature,
    instance: null
  },
  forms: {
    name: 'Forms',
    feature: () => window.FormsFeature,
    instance: null
  },
  // fileDragToFolder: {
  //   name: 'Files Drag to Folder',
  //   feature: () => window.FileDragToFolderFeature,
  //   instance: null
  // }
};

// Current settings - use shared defaults from JTDefaults
let currentSettings = window.JTDefaults
  ? window.JTDefaults.getDefaultSettings()
  : {
      // Inline fallback if JTDefaults not loaded (should not happen)
      dragDrop: false, contrastFix: true, formatter: true, previewMode: false,
      darkMode: false, rgbTheme: false, smartJobSwitcher: true, budgetHierarchy: false,
      quickNotes: true, helpSidebarSupport: true, keyboardShortcuts: true, freezeHeader: false,
      characterCounter: false, kanbanTypeFilter: false, autoCollapseGroups: false, documentSort: false, budgetTools: false,
      pdfMarkupTools: true, reverseThreadOrder: false, customFieldFilter: false,
      budgetChangelog: false, taskTypeFilter: false, availabilityFilter: false,
      jobAccessCollapse: false, orgLogo: false,
      inspectForAi: false, tweakEngine: true, forms: true,
      themeColors: { primary: '#3B82F6', background: '#F3E8FF', text: '#1F1B29' },
      savedThemes: [null, null, null]
    };

/**
 * Load settings from storage with error handling
 * @returns {Promise<Object>} Current settings
 */
async function loadSettings() {
  try {
    // Use StorageWrapper if available for safer storage access
    if (window.StorageWrapper) {
      const result = await window.StorageWrapper.get(['jtToolsSettings'], { jtToolsSettings: currentSettings });
      currentSettings = window.JTDefaults
        ? window.JTDefaults.mergeWithDefaults(result.jtToolsSettings)
        : result.jtToolsSettings || currentSettings;
    } else {
      // Fallback to direct chrome storage
      const result = await chrome.storage.sync.get(['jtToolsSettings']);
      currentSettings = window.JTDefaults
        ? window.JTDefaults.mergeWithDefaults(result.jtToolsSettings)
        : result.jtToolsSettings || currentSettings;
    }

    console.log('JT-Tools: Settings loaded:', currentSettings);
    return currentSettings;
  } catch (error) {
    console.error('JT-Tools: Error loading settings:', error);
    return currentSettings;
  }
}

// Track which blocked features we've already logged this session, to avoid
// spamming the console every time handleSettingsChange fires.
const loggedBlockedFeatures = new Set();

/**
 * Enforce the tier gate for a feature. Returns true if the feature is
 * allowed to initialize; false if it should be blocked.
 *
 * Hard-block policy:
 *   - Internal features (helpSidebarSupport, keyboardShortcuts): always allowed.
 *   - FREE features: always allowed.
 *   - Paid features: require LicenseService.tierHasFeature(tier, key) to be true.
 *   - Unknown features: blocked (fail closed).
 *
 * Defense-in-depth only — the popup UI is the primary gate. This prevents a
 * user who flips settings directly in chrome.storage from getting paid features
 * without a valid license.
 */
async function isFeatureAllowedByTier(featureKey) {
  const license = window.LicenseService;
  if (!license) {
    // LicenseService missing — this should not happen since it's loaded before
    // content.js. Fail closed: only allow explicitly-internal features so the
    // extension's core plumbing still works, but don't grant anything paid.
    console.warn('JT-Tools: LicenseService not available — blocking tier-gated features');
    return featureKey === 'helpSidebarSupport' || featureKey === 'keyboardShortcuts';
  }

  if (license.isInternalFeature(featureKey)) return true;
  if (license.isFeatureFree(featureKey)) return true;

  try {
    const tier = await license.getTier();
    return license.tierHasFeature(tier, featureKey);
  } catch (error) {
    // Network/storage error while resolving tier — fail closed. The popup will
    // re-prompt the user to re-validate next time they open it.
    console.warn(`JT-Tools: Tier resolution failed for ${featureKey}, blocking:`, error);
    return false;
  }
}

/**
 * Initialize a feature module safely
 * @param {string} featureKey - Feature key from featureModules
 */
async function initializeFeature(featureKey) {
  const module = featureModules[featureKey];

  if (!module) {
    console.error(`JT-Tools: Unknown feature key: ${featureKey}`);
    return;
  }

  // Tier gate — block paid features without a valid license tier.
  const allowed = await isFeatureAllowedByTier(featureKey);
  if (!allowed) {
    if (!loggedBlockedFeatures.has(featureKey)) {
      console.warn(`JT-Tools: ${module.name} blocked — current license tier does not grant access`);
      loggedBlockedFeatures.add(featureKey);
    }
    return;
  }

  try {
    // Get the feature from window
    const FeatureClass = module.feature();

    if (!FeatureClass) {
      console.error(`JT-Tools: ${module.name} not found on window`);
      return;
    }

    // Check if feature has required interface
    if (typeof FeatureClass.init !== 'function' || typeof FeatureClass.isActive !== 'function') {
      console.error(`JT-Tools: ${module.name} missing required methods (init/isActive)`);
      return;
    }

    // Initialize if not already active
    if (!FeatureClass.isActive()) {
      // Special handling for RGB theme - pass theme colors
      if (featureKey === 'rgbTheme' && currentSettings.themeColors) {
        await FeatureClass.init(currentSettings.themeColors);
      } else {
        await FeatureClass.init();
      }
      module.instance = FeatureClass;
      console.log(`JT-Tools: ${module.name} initialized`);
    } else {
      console.log(`JT-Tools: ${module.name} already active`);
    }
  } catch (error) {
    console.error(`JT-Tools: Error initializing ${module.name}:`, error);
  }
}

/**
 * Cleanup a feature module safely
 * @param {string} featureKey - Feature key from featureModules
 */
function cleanupFeature(featureKey) {
  const module = featureModules[featureKey];

  if (!module) {
    console.error(`JT-Tools: Unknown feature key: ${featureKey}`);
    return;
  }

  try {
    const FeatureClass = module.feature();

    if (!FeatureClass) {
      console.warn(`JT-Tools: ${module.name} not found during cleanup`);
      return;
    }

    if (typeof FeatureClass.cleanup !== 'function') {
      console.warn(`JT-Tools: ${module.name} missing cleanup method`);
      return;
    }

    if (typeof FeatureClass.isActive === 'function' && FeatureClass.isActive()) {
      FeatureClass.cleanup();
      console.log(`JT-Tools: ${module.name} cleaned up`);
    } else {
      console.log(`JT-Tools: ${module.name} not active, skipping cleanup`);
    }
  } catch (error) {
    console.error(`JT-Tools: Error cleaning up ${module.name}:`, error);
  }
}

// Initialize all enabled features
async function initializeAllFeatures() {
  console.log('JT-Tools: Initializing features based on settings...');

  for (const [key, enabled] of Object.entries(currentSettings)) {
    if (enabled && featureModules[key]) {
      await initializeFeature(key);
    }
  }

  // Always enable Help Sidebar Support (not user-toggleable)
  if (featureModules.helpSidebarSupport) {
    await initializeFeature('helpSidebarSupport');
  }

  // Always enable Keyboard Shortcuts enhancement (not user-toggleable)
  if (featureModules.keyboardShortcuts) {
    await initializeFeature('keyboardShortcuts');
  }

  console.log('JT-Tools: All enabled features initialized');
}

/**
 * Handle settings changes from popup or background
 * @param {Object} newSettings - New settings object
 */
async function handleSettingsChange(newSettings) {
  try {
    if (!newSettings || typeof newSettings !== 'object') {
      console.error('JT-Tools: Invalid settings object received');
      return;
    }

    // Merge with defaults to ensure FREE features (formatter, darkMode, etc.)
    // are never lost due to incomplete settings objects from popup/background
    const mergedSettings = window.JTDefaults
      ? window.JTDefaults.mergeWithDefaults(newSettings)
      : newSettings;

    console.log('JT-Tools: Settings changed:', mergedSettings);

    // Compare old and new settings
    for (const [key, enabled] of Object.entries(mergedSettings)) {
      // Skip non-feature settings like rgbColors
      if (!featureModules[key]) continue;

      // Skip always-enabled features - not user-toggleable
      if (key === 'helpSidebarSupport' || key === 'keyboardShortcuts') continue;

      const wasEnabled = currentSettings[key];

      if (enabled && !wasEnabled) {
        // Feature was enabled
        console.log(`JT-Tools: Enabling ${featureModules[key].name}`);
        await initializeFeature(key);
      } else if (!enabled && wasEnabled) {
        // Feature was disabled
        console.log(`JT-Tools: Disabling ${featureModules[key].name}`);
        cleanupFeature(key);
      }
    }

    // Special handling for theme colors changes
    if (mergedSettings.rgbTheme && mergedSettings.themeColors) {
      const RGBThemeFeature = window.RGBThemeFeature;
      if (RGBThemeFeature && typeof RGBThemeFeature.isActive === 'function' && RGBThemeFeature.isActive()) {
        // Check if colors actually changed
        const colorsChanged = JSON.stringify(currentSettings.themeColors) !== JSON.stringify(mergedSettings.themeColors);
        if (colorsChanged && typeof RGBThemeFeature.updateColors === 'function') {
          console.log('JT-Tools: Theme colors updated, applying new colors');
          RGBThemeFeature.updateColors(mergedSettings.themeColors);
        }
      }
    }

    // Refresh budget hierarchy shading when theme changes
    const themeChanged =
      mergedSettings.darkMode !== currentSettings.darkMode ||
      mergedSettings.rgbTheme !== currentSettings.rgbTheme ||
      (mergedSettings.rgbTheme && JSON.stringify(mergedSettings.themeColors) !== JSON.stringify(currentSettings.themeColors));

    if (themeChanged && window.BudgetHierarchyFeature) {
      if (typeof window.BudgetHierarchyFeature.isActive === 'function' && window.BudgetHierarchyFeature.isActive()) {
        console.log('JT-Tools: Theme changed, refreshing budget hierarchy shading');
        // Use requestAnimationFrame to wait for the next paint cycle
        // This is more deterministic than arbitrary setTimeout as it ensures
        // the browser has processed the style changes before we refresh
        requestAnimationFrame(() => {
          // Double RAF ensures styles are computed after the paint
          requestAnimationFrame(() => {
            try {
              if (typeof window.BudgetHierarchyFeature.refreshShading === 'function') {
                window.BudgetHierarchyFeature.refreshShading();
              }
            } catch (error) {
              console.error('JT-Tools: Error refreshing budget hierarchy:', error);
            }
          });
        });
      }
    }

    // Update current settings (use merged version to preserve FREE feature defaults)
    currentSettings = mergedSettings;
  } catch (error) {
    console.error('JT-Tools: Error in handleSettingsChange:', error);
  }
}

/**
 * Listen for messages from background script
 */
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  try {
    if (!message || !message.type) {
      // Ignore — let other listeners (or the runtime default) respond.
      return false;
    }

    // Only respond to message types this listener actually owns. Other
    // listeners (e.g., tweak-engine, formatter) handle their own types
    // and we MUST NOT pre-empt them — Chrome's first synchronous
    // sendResponse() wins, locking out async responders.
    switch (message.type) {
      case 'SETTINGS_CHANGED':
        console.log('JT-Tools: Message received:', message);
        if (message.settings) {
          handleSettingsChange(message.settings);
          sendResponse({ success: true });
        } else {
          console.error('JT-Tools: SETTINGS_CHANGED message missing settings');
          sendResponse({ success: false, error: 'Missing settings' });
        }
        break;

      default:
        // Not ours — return false WITHOUT calling sendResponse so other
        // listeners (tweak-engine's GET_ACTIVE_ORG / TWEAK_DRY_RUN handler,
        // for example) get a turn.
        return false;
    }
  } catch (error) {
    console.error('JT-Tools: Error handling message:', error);
    sendResponse({ success: false, error: 'Internal error' });
  }

  return false; // Synchronous response
});

// Wait for all features to be available on window
async function waitForFeatures(
  maxAttempts = window.JTDefaults?.TIMING?.FEATURE_LOAD_MAX_ATTEMPTS || 100,
  delayMs = window.JTDefaults?.TIMING?.FEATURE_LOAD_DELAY || 150
) {
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const allAvailable = Object.values(featureModules).every(module => {
      const feature = module.feature();
      return feature !== null && feature !== undefined;
    });

    if (allAvailable) {
      console.log(`JT-Tools: All features loaded (attempt ${attempt + 1})`);
      return true;
    }

    // Only log every 10 attempts to reduce console spam
    if (attempt % 10 === 0 || attempt < 5) {
      console.log(`JT-Tools: Waiting for features... (attempt ${attempt + 1}/${maxAttempts})`);

      // Log which features are missing
      Object.entries(featureModules).forEach(([key, module]) => {
        const feature = module.feature();
        if (!feature) {
          console.log(`  - ${module.name} not yet available`);
        }
      });
    }

    await new Promise(resolve => setTimeout(resolve, delayMs));
  }

  console.error('JT-Tools: Timeout waiting for all features to load');

  // Log which features failed to load
  Object.entries(featureModules).forEach(([key, module]) => {
    const feature = module.feature();
    if (!feature) {
      console.error(`  - ${module.name} FAILED to load`);
    }
  });

  return false;
}

// Initialize on page load
(async function() {
  // Skip all feature initialization inside Action Items completion iframes.
  // The iframe URL contains #jt-completion-iframe as a marker — if present,
  // the extension's features (especially task completion checkboxes) must NOT
  // run, as they would inject elements that interfere with sidebar detection.
  if (window.location.hash === '#jt-completion-iframe') {
    console.log('JT-Tools: Completion iframe detected, skipping feature initialization');
    return;
  }

  console.log('JT-Tools: Starting initialization...');

  // Load settings
  await loadSettings();

  // Initialize OrgDetector for multi-org grant key resolution
  if (window.OrgDetector) {
    window.OrgDetector.init();
  }

  // Wait for all feature scripts to be ready
  const featuresReady = await waitForFeatures();

  if (featuresReady) {
    // Initialize all enabled features
    await initializeAllFeatures();
    console.log('JT Power Tools: Ready!');
  } else {
    console.error('JT Power Tools: Failed to initialize - features not loaded');
  }
})();
