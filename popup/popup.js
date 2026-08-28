// True when this popup.html instance is loaded inside the side panel (Chrome)
// or sidebar (Firefox) rather than the toolbar popup. Both the Chrome
// side_panel.default_path and the Firefox sidebar_action.default_panel include
// `?context=sidepanel`, and the Open-in-Sidebar button preserves that param.
// Side-panel mode behaves like a persistent panel — closing it requires the
// user, so calls that would auto-close the popup (e.g. `window.close()` after
// refreshing the JobTread tab) must no-op here, otherwise the user's pinned
// sidebar disappears every time they touch the refresh icon.
const IS_IN_SIDE_PANEL = new URLSearchParams(window.location.search).get('context') === 'sidepanel';

// Sidebar capability detection. Chrome exposes chrome.sidePanel; Firefox has no
// chrome.sidePanel and instead exposes browser.sidebarAction. The Open-in-Sidebar
// header button uses whichever exists; the rest of side-panel mode is identical.
const FIREFOX_SIDEBAR_API =
  (typeof browser !== 'undefined' && browser.sidebarAction) ? browser.sidebarAction : null;
const HAS_CHROME_SIDEPANEL = !!(chrome.sidePanel && typeof chrome.sidePanel.open === 'function');
const HAS_FIREFOX_SIDEBAR = !!(FIREFOX_SIDEBAR_API && typeof FIREFOX_SIDEBAR_API.open === 'function');

// All feature toggle IDs (used by master toggle)
const FEATURE_TOGGLE_IDS = [
  'kanbanTypeFilter', 'autoCollapseGroups', 'documentSort', 'printScope', 'ganttLines', 'scheduleMonthShading', 'dragDrop',
  'availabilityFilter', 'taskTypeFilter', 'budgetTools', 'formatter',
  'characterCounter', 'smartJobSwitcher', 'quickNotes', 'freezeHeader',
  'pdfMarkupTools', 'reverseThreadOrder', 'previewMode', 'customFieldFilter',
  'budgetChangelog', 'invoiceForecast', 'editableTables', 'autoSequence', 'contrastFix', 'budgetHierarchy', 'budgetRowHighlight', 'darkMode', 'rgbTheme',
  'jobAccessCollapse', 'orgLogo'
];

// Feature toggles that require a JobTread grant key to function. When a
// user enables one of these without a grant key configured, we may nudge
// them through the register/setup flow (see maybeShowRegisterNudge).
const GRANT_KEY_REQUIRED_FEATURES = new Set([
  'customFieldFilter',
  'editableTables',
  'budgetChangelog',
  'taskTypeFilter',
  'availabilityFilter',
  'invoiceForecast',
  'autoSequence',
]);

const REGISTER_NUDGE_DISMISSED_KEY = 'jtRegisterNudgeDismissed';
const PORTAL_BASE_URL = 'https://app.jtpowertools.com';

const MASTER_TOGGLE_KEY = 'jtMasterToggleOff';
const MASTER_SNAPSHOT_KEY = 'jtMasterToggleSnapshot';

/**
 * Initialize master toggle: wire up events and restore state
 */
async function initMasterToggle() {
  const masterCheckbox = document.getElementById('masterToggle');
  const featuresSection = document.querySelector('.features-section');
  if (!masterCheckbox || !featuresSection) return;

  // Restore master toggle state
  const stored = await chrome.storage.local.get([MASTER_TOGGLE_KEY]);
  if (stored[MASTER_TOGGLE_KEY]) {
    masterCheckbox.checked = false;
    featuresSection.classList.add('master-disabled');
  }

  masterCheckbox.addEventListener('change', async () => {
    if (!masterCheckbox.checked) {
      // --- Turning OFF ---
      // Snapshot current feature states before disabling
      const snapshot = {};
      FEATURE_TOGGLE_IDS.forEach(id => {
        const el = document.getElementById(id);
        if (el) snapshot[id] = el.checked;
      });
      await chrome.storage.local.set({
        [MASTER_TOGGLE_KEY]: true,
        [MASTER_SNAPSHOT_KEY]: snapshot
      });

      // Uncheck all feature toggles in the UI
      FEATURE_TOGGLE_IDS.forEach(id => {
        const el = document.getElementById(id);
        if (el) el.checked = false;
      });

      // Save the all-off state to sync storage
      const settings = await getCurrentSettings();
      await saveSettings(settings);

      featuresSection.classList.add('master-disabled');
    } else {
      // --- Turning ON ---
      // Restore from snapshot
      const stored = await chrome.storage.local.get([MASTER_SNAPSHOT_KEY]);
      const snapshot = stored[MASTER_SNAPSHOT_KEY] || {};

      FEATURE_TOGGLE_IDS.forEach(id => {
        const el = document.getElementById(id);
        if (el) el.checked = !!snapshot[id];
      });

      await chrome.storage.local.remove([MASTER_TOGGLE_KEY, MASTER_SNAPSHOT_KEY]);

      // Save restored state
      const settings = await getCurrentSettings();
      await saveSettings(settings);

      featuresSection.classList.remove('master-disabled');
    }
  });
}

// Tab navigation management
function initTabNavigation() {
  const tabItems = document.querySelectorAll('.tab-item');
  const tabContents = document.querySelectorAll('.tab-content');

  tabItems.forEach(tab => {
    tab.addEventListener('click', () => {
      const targetTab = tab.dataset.tab;

      // Update tab buttons
      tabItems.forEach(t => t.classList.remove('active'));
      tab.classList.add('active');

      // Update tab content
      tabContents.forEach(content => {
        content.classList.remove('active');
        if (content.id === `tab-${targetTab}`) {
          content.classList.add('active');
        }
      });
    });
  });
}

// Popup theme management
const POPUP_THEME_KEY = 'jtPopupTheme';

/**
 * Initialize popup theme based on saved preference
 */
async function initPopupTheme() {
  try {
    const result = await chrome.storage.local.get([POPUP_THEME_KEY]);
    const isDark = result[POPUP_THEME_KEY] === 'dark';
    applyPopupTheme(isDark);
  } catch (error) {
    console.error('Error loading popup theme:', error);
  }
}

/**
 * Apply popup theme and update header icon
 * @param {boolean} isDark - Whether to use dark theme
 */
function applyPopupTheme(isDark) {
  const body = document.body;
  const headerIcon = document.getElementById('headerIcon');

  if (isDark) {
    body.classList.add('dark-theme');
    headerIcon.src = '../icons/icon48-dark.png';
  } else {
    body.classList.remove('dark-theme');
    headerIcon.src = '../icons/icon48-light.png';
  }

  // Update toolbar icon via service worker
  // Wrapped in try/catch because Firefox can throw synchronously if the
  // service worker is inactive or sendMessage doesn't return a thenable.
  try {
    const msgPromise = chrome.runtime.sendMessage({
      type: 'UPDATE_TOOLBAR_ICON',
      isDark: isDark
    });
    if (msgPromise && typeof msgPromise.then === 'function') {
      msgPromise.catch((error) => {
        console.warn('Failed to update toolbar icon:', error);
      });
    }
  } catch (error) {
    console.warn('Failed to send toolbar icon message:', error);
  }
}

/**
 * Toggle popup theme
 */
async function togglePopupTheme() {
  const isDark = !document.body.classList.contains('dark-theme');

  // Save preference FIRST — before anything that might fail.
  // This prevents Firefox popup close or sendMessage errors from
  // blocking the persist.
  try {
    await chrome.storage.local.set({ [POPUP_THEME_KEY]: isDark ? 'dark' : 'light' });
  } catch (error) {
    console.error('Error saving popup theme:', error);
  }

  // Then apply visual changes and notify service worker
  applyPopupTheme(isDark);
}

// Default settings - use shared JTDefaults (loaded from utils/defaults.js)
const defaultSettings = (typeof JTDefaults !== 'undefined' && JTDefaults.getDefaultSettings)
  ? JTDefaults.getDefaultSettings()
  : {
    dragDrop: true, contrastFix: true, formatter: true, previewMode: false,
    darkMode: false, darkModeLevel: 'dark', rgbTheme: false, smartJobSwitcher: true, budgetHierarchy: false, budgetRowHighlight: false,
    quickNotes: true, helpSidebarSupport: true, freezeHeader: false, characterCounter: false,
    kanbanTypeFilter: false, autoCollapseGroups: false, availabilityFilter: false,
    ganttLines: true, scheduleMonthShading: false, pdfMarkupTools: true, reverseThreadOrder: false,
    jobAccessCollapse: false, orgLogo: true,
    themeColors: { primary: '#3B82F6', background: '#F3E8FF', text: '#1F1B29' },
    savedThemes: [null, null, null]
  };

// Check and update API status on load
async function checkApiStatus() {
  const apiStatus = document.getElementById('apiStatus');
  if (!apiStatus) return; // API UI removed — config now in portal
  const statusText = apiStatus.querySelector('.status-text');
  const apiKeyInput = document.getElementById('apiKey');
  const orgIdInput = document.getElementById('orgId');
  const customFieldFilterToggle = document.getElementById('customFieldFilter');
  const customFieldFilterFeature = document.getElementById('customFieldFilterFeature');
  const budgetChangelogToggle = document.getElementById('budgetChangelog');
  const budgetChangelogFeature = document.getElementById('budgetChangelogFeature');
  const taskTypeFilterToggle = document.getElementById('taskTypeFilter');
  const taskTypeFilterFeature = document.getElementById('taskTypeFilterFeature');

  // Enable the API-dependent feature toggles (shared by the Pro and Direct config branches)
  function enableApiDependentToggles() {
    // Enable Custom Field Filter toggle
    customFieldFilterToggle.disabled = false;
    if (customFieldFilterFeature) {
      customFieldFilterFeature.classList.remove('disabled');
      customFieldFilterFeature.title = '';
    }
    // Enable Budget Changelog toggle
    if (budgetChangelogToggle) budgetChangelogToggle.disabled = false;
    if (budgetChangelogFeature) {
      budgetChangelogFeature.classList.remove('disabled');
      budgetChangelogFeature.title = '';
    }
    // Enable Task Type Filter toggle
    if (taskTypeFilterToggle) taskTypeFilterToggle.disabled = false;
    if (taskTypeFilterFeature) {
      taskTypeFilterFeature.classList.remove('disabled');
      taskTypeFilterFeature.title = '';
    }
  }

  // Check if Pro Service is configured (uses Worker)
  const isProConfigured = await JobTreadProService.isConfigured();

  if (isProConfigured) {
    const orgInfo = await JobTreadProService.getOrgInfo();
    apiStatus.className = 'api-status active';
    statusText.textContent = `API configured (${orgInfo.orgName || 'Connected'})`;
    apiKeyInput.placeholder = '••••••••••••';
    orgIdInput.placeholder = orgInfo.orgId || 'Org ID';
    orgIdInput.value = '';

    enableApiDependentToggles();
  } else {
    // Fall back to check old direct API configuration
    const isDirectConfigured = await JobTreadAPI.isFullyConfigured();

    if (isDirectConfigured) {
      const storedOrgId = await JobTreadAPI.getOrgId();
      apiStatus.className = 'api-status active';
      statusText.textContent = 'API configured (Direct)';
      apiKeyInput.placeholder = '••••••••••••';
      orgIdInput.placeholder = storedOrgId || 'Org ID';

      enableApiDependentToggles();
    } else {
      apiStatus.className = 'api-status inactive';

      // Check if license is activated to provide better messaging
      const licenseData = await LicenseService.getLicenseData();
      if (licenseData && licenseData.valid) {
        // Has license but no API configured - guide them to setup
        statusText.textContent = '🚀 Setup API access for your team';
      } else {
        statusText.textContent = 'API not configured';
      }

      apiKeyInput.placeholder = 'Grant Key';
      orgIdInput.placeholder = 'Org ID (auto)';

      // Disable Custom Field Filter toggle and uncheck it
      customFieldFilterToggle.disabled = true;
      customFieldFilterToggle.checked = false;
      if (customFieldFilterFeature) {
        customFieldFilterFeature.classList.add('disabled');
        customFieldFilterFeature.title = 'Connect your JobTread API first (enter Grant Key below)';
      }
      // Disable Budget Changelog toggle and uncheck it
      if (budgetChangelogToggle) {
        budgetChangelogToggle.disabled = true;
        budgetChangelogToggle.checked = false;
      }
      if (budgetChangelogFeature) {
        budgetChangelogFeature.classList.add('disabled');
        budgetChangelogFeature.title = 'Connect your JobTread API first (enter Grant Key below)';
      }
      // Disable Task Type Filter toggle and uncheck it
      if (taskTypeFilterToggle) {
        taskTypeFilterToggle.disabled = true;
        taskTypeFilterToggle.checked = false;
      }
      if (taskTypeFilterFeature) {
        taskTypeFilterFeature.classList.add('disabled');
        taskTypeFilterFeature.title = 'Connect your JobTread API first (enter Grant Key below)';
      }

      // Persist disabled state so features actually turn off on the JobTread page.
      // Without this, storage keeps saying the features are enabled even though
      // the UI shows them as off, leaving the features "stuck active".
      // autoSequence is deliberately absent: it is a free feature, so silently
      // switching it off would just make it vanish. It stays on and explains in
      // the panel that a grant key is needed (see NO_KEY_RE in the feature).
      await syncDisabledFeaturesToStorage(['customFieldFilter', 'budgetChangelog', 'taskTypeFilter', 'invoiceForecast', 'editableTables']);
    }
  }
}

/**
 * Persist feature=false to storage and notify content scripts when the popup
 * has forced toggles off due to missing API access or insufficient tier.
 * Only writes if the stored settings differ from the desired disabled state
 * (avoids unnecessary storage churn and SETTINGS_CHANGED storms).
 *
 * @param {string[]} featureIds - Feature keys to force to false in storage
 */
async function syncDisabledFeaturesToStorage(featureIds) {
  try {
    const result = await chrome.storage.sync.get(['jtToolsSettings']);
    const stored = result.jtToolsSettings || {};
    let changed = false;
    const next = { ...stored };
    for (const id of featureIds) {
      if (next[id] === true) {
        next[id] = false;
        changed = true;
      }
    }
    if (!changed) return;
    await chrome.storage.sync.set({ jtToolsSettings: next });
    chrome.runtime.sendMessage({ type: 'SETTINGS_UPDATED', settings: next });
    console.log('Popup: Synced disabled features to storage:', featureIds.filter(id => stored[id] === true));
  } catch (err) {
    console.error('Popup: Failed to sync disabled features to storage:', err);
  }
}

// Test and save API credentials
async function testApiKey() {
  const apiKeyInput = document.getElementById('apiKey');
  const orgIdInput = document.getElementById('orgId');
  const testBtn = document.getElementById('testApiBtn');

  const grantKey = apiKeyInput.value.trim();

  // Validate Grant Key is provided
  if (!grantKey) {
    showStatus('Grant Key is required', 'error');
    return;
  }

  // Check if user has activated Gumroad license
  const licenseData = await LicenseService.getLicenseData();
  if (!licenseData || !licenseData.valid) {
    showStatus('Please activate your Gumroad license first in the Premium License section below', 'error');
    return;
  }

  // Disable button during test
  testBtn.disabled = true;
  testBtn.textContent = 'Connecting...';

  try {
    // Use Pro Service to verify org access through Worker
    const result = await JobTreadProService.verifyOrgAccess(grantKey);

    if (result.success) {
      const orgName = result.organizationName || 'Unknown';
      showStatus(`✓ Connected to ${orgName}!`, 'success');
      apiKeyInput.value = '';
      orgIdInput.value = '';

      await checkApiStatus();

      // Try to fetch custom fields to verify full connectivity
      try {
        await JobTreadProService.getCustomFields();
      } catch (cfError) {
        // Non-critical — fields will be fetched on demand
      }
    } else {
      // Handle specific error codes
      if (result.code === 'ORG_MISMATCH') {
        showStatus(`❌ ${result.message || 'This license is registered to a different organization'}`, 'error');
      } else if (result.code === 'INVALID_GRANT_KEY') {
        showStatus('❌ Invalid Grant Key. Please check your key and try again.', 'error');
      } else {
        showStatus(result.message || result.error || 'Connection failed', 'error');
      }
    }
  } catch (error) {

    // Check if it's a Worker configuration error
    if (error.message.includes('Worker not configured') || error.message.includes('WORKER_URL')) {
      showStatus('⚠️  Worker not configured. Please update worker-config.js', 'error');
    } else if (error.message.includes('No Gumroad license')) {
      showStatus('Please activate your Gumroad license first', 'error');
    } else {
      showStatus('Error connecting to Worker API', 'error');
    }
  } finally {
    testBtn.disabled = false;
    testBtn.textContent = 'Test';
  }
}

// Check and update license status on load
// Now uses tier-based feature gating with FREE features for all users
/**
 * Show the theme presets, palette and WCAG panel only while Custom Theme is on.
 * Left visible they read as live settings, so people pick a preset, see nothing
 * change, and conclude the theme is broken — the toggle above them is the part
 * that is off.
 * @param {boolean} enabled
 */
function syncThemeControlsVisibility(enabled) {
  const controls = document.querySelector('.theme-rebuild');
  if (controls) controls.classList.toggle('hidden', !enabled);
}

/**
 * Lock or unlock one feature row by id.
 *
 * checkLicenseStatus() otherwise enumerates every paid feature by hand, twice
 * — once to unlock for a licence holder, once to lock in Free Mode — which is
 * how Editable Tables reached the unlock list but not the lock list, and how
 * Tweak Engine and Inspect for AI ended up in neither. A row that stays
 * enabled promises something the content script's tier gate then refuses.
 *
 * @param {string} featureId - the `data-feature` id, e.g. 'tweakEngine'
 * @param {boolean} locked
 */
function setFeatureRowLocked(featureId, locked) {
  document.getElementById(`${featureId}Feature`)?.classList.toggle('locked', locked);
  const checkbox = document.getElementById(featureId);
  if (checkbox) checkbox.disabled = locked;
}

/** Paid rows the hand-maintained lists above don't cover. */
const EXTRA_PRO_ROWS = ['tweakEngine', 'inspectForAi'];

const TIER_PLAN_NAMES = {
  essential: 'Essential',
  pro: 'Pro',
  'power-user': 'Power User'
};

/**
 * Put a padlock on every locked row and take it off the rest.
 *
 * The tier is carried by the icon chip's colour, which says which plan a
 * feature belongs to but not that you cannot use it yet. A dimmed toggle reads
 * as "off" just as easily as "unavailable", so the padlock is the part that
 * says upgrade — and it names the plan on hover, which colour alone can never
 * do (and which anyone who can't distinguish the tints needs).
 */
function syncLockIcons() {
  document.querySelectorAll('.feature-item').forEach((row) => {
    const locked = row.classList.contains('locked');
    let icon = row.querySelector('.feature-lock');

    if (!locked) {
      if (icon) icon.remove();
      return;
    }

    if (!icon) {
      icon = document.createElement('i');
      icon.className = 'ph ph-lock-simple feature-lock';
      row.insertBefore(icon, row.querySelector('.toggle'));
    }
    const plan = TIER_PLAN_NAMES[row.dataset.tier];
    const label = plan ? `Requires the ${plan} plan` : 'Requires an upgrade';
    icon.title = label;
    icon.setAttribute('aria-label', label);
  });
}

async function checkLicenseStatus() {
  // No getLicenseData() here any more: entitlement is the resolved tier, which
  // already folds in the Gumroad license. See the comment on the branch below.
  const tier = await LicenseService.getTier();
  const licenseStatus = document.getElementById('licenseStatus');
  const statusText = licenseStatus ? licenseStatus.querySelector('.status-text') : null;

  // PRO tier features (require Pro or Power User)
  const dragDropFeature = document.getElementById('dragDropFeature');
  const dragDropCheckbox = document.getElementById('dragDrop');
  const rgbThemeFeature = document.getElementById('rgbThemeFeature');
  const rgbThemeCheckbox = document.getElementById('rgbTheme');
  const previewModeFeature = document.getElementById('previewModeFeature');
  const previewModeCheckbox = document.getElementById('previewMode');
  const availabilityFilterFeature = document.getElementById('availabilityFilterFeature');
  const availabilityFilterCheckbox = document.getElementById('availabilityFilter');

  // ESSENTIAL tier features (require Essential, Pro, or Power User)
  const quickNotesFeature = document.getElementById('quickNotesFeature');
  const quickNotesCheckbox = document.getElementById('quickNotes');
  const smartJobSwitcherFeature = document.getElementById('smartJobSwitcherFeature');
  const smartJobSwitcherCheckbox = document.getElementById('smartJobSwitcher');
  const freezeHeaderFeature = document.getElementById('freezeHeaderFeature');
  const freezeHeaderCheckbox = document.getElementById('freezeHeader');
  const pdfMarkupToolsFeature = document.getElementById('pdfMarkupToolsFeature');
  const pdfMarkupToolsCheckbox = document.getElementById('pdfMarkupTools');
  const reverseThreadOrderFeature = document.getElementById('reverseThreadOrderFeature');
  const reverseThreadOrderCheckbox = document.getElementById('reverseThreadOrder');
  const budgetRowHighlightFeature = document.getElementById('budgetRowHighlightFeature');
  const budgetRowHighlightCheckbox = document.getElementById('budgetRowHighlight');
  const invoiceForecastFeature = document.getElementById('invoiceForecastFeature');
  const invoiceForecastCheckbox = document.getElementById('invoiceForecast');
  const editableTablesFeature = document.getElementById('editableTablesFeature');
  const editableTablesCheckbox = document.getElementById('editableTables');

  // POWER USER tier features and UI elements
  const apiCategory = document.getElementById('apiCategory');
  const apiConfigPanel = document.getElementById('apiConfigPanel');
  const customFieldFilterFeature = document.getElementById('customFieldFilterFeature');
  const customFieldFilterCheckbox = document.getElementById('customFieldFilter');
  const budgetChangelogFeature = document.getElementById('budgetChangelogFeature');
  const budgetChangelogCheckbox = document.getElementById('budgetChangelog');
  const taskTypeFilterFeature = document.getElementById('taskTypeFilterFeature');
  const taskTypeFilterCheckbox = document.getElementById('taskTypeFilter');
  // Pave Query Capture ("Record for AI") — lives in the Pave Explorer tab now.
  const paveCaptureFeature = document.getElementById('paveCaptureFeature');
  const paveCaptureCheckbox = document.getElementById('paveCapture');

  // Entitlement is the RESOLVED TIER, not a stored Gumroad license.
  //
  // This used to also require `licenseData.valid`, which meant a Gumroad
  // license cached on the device was the only thing that could unlock a
  // toggle. An account whose subscription lives in the portal — no Gumroad
  // key, which is every account created since the portal launched, and any
  // existing one signing in on a new browser — fell through to the else
  // branch and had every paid feature locked, while the account panel right
  // above it reported the subscription active and named the tier. The two
  // checks disagreed because they were asking different questions.
  //
  // getTier() already resolves both sources (the higher of the portal account
  // tier and the Gumroad license tier), so a non-null tier IS the entitlement
  // — the extra condition could only ever subtract from it. This also matches
  // what content.js enforces on the page (isFeatureAllowedByTier → getTier),
  // so the popup no longer locks toggles the content script would have run.
  if (tier) {
    // Entitled - show tier name
    const tierDisplayName = LicenseService.getTierDisplayName(tier);
    if (licenseStatus) licenseStatus.className = 'license-status active';
    if (statusText) statusText.textContent = `✓ ${tierDisplayName} Active`;

    // Check tier access for PRO features (Pro and Power User only)
    const hasProFeatures = LicenseService.tierAtLeast(tier, LicenseService.TIERS.PRO);
    // Check for Power User tier (for API/MCP features)
    const hasPowerUserFeatures = LicenseService.tierHasFeature(tier, 'customFieldFilter');

    if (hasProFeatures) {
      // Pro or Power User tier - enable PRO features
      dragDropFeature?.classList.remove('locked');
      if (dragDropCheckbox) dragDropCheckbox.disabled = false;
      rgbThemeFeature?.classList.remove('locked');
      if (rgbThemeCheckbox) rgbThemeCheckbox.disabled = false;
      previewModeFeature?.classList.remove('locked');
      if (previewModeCheckbox) previewModeCheckbox.disabled = false;
      availabilityFilterFeature?.classList.remove('locked');
      if (availabilityFilterCheckbox) availabilityFilterCheckbox.disabled = false;
      reverseThreadOrderFeature?.classList.remove('locked');
      if (reverseThreadOrderCheckbox) reverseThreadOrderCheckbox.disabled = false;
      EXTRA_PRO_ROWS.forEach((id) => setFeatureRowLocked(id, false));
    } else {
      // Essential tier - lock PRO features
      EXTRA_PRO_ROWS.forEach((id) => setFeatureRowLocked(id, true));
      dragDropFeature?.classList.add('locked');
      if (dragDropCheckbox) dragDropCheckbox.disabled = true;
      rgbThemeFeature?.classList.add('locked');
      if (rgbThemeCheckbox) rgbThemeCheckbox.disabled = true;
      previewModeFeature?.classList.add('locked');
      if (previewModeCheckbox) previewModeCheckbox.disabled = true;
      availabilityFilterFeature?.classList.add('locked');
      if (availabilityFilterCheckbox) availabilityFilterCheckbox.disabled = true;
      reverseThreadOrderFeature?.classList.add('locked');
      if (reverseThreadOrderCheckbox) reverseThreadOrderCheckbox.disabled = true;

      // Add upgrade hint for Essential users
      if (statusText) statusText.textContent = `✓ ${tierDisplayName} Active - Upgrade to Pro for more features`;
    }

    // POWER USER features and API section visibility
    if (hasPowerUserFeatures) {
      // Show API category and grant key panel for Power Users
      apiCategory?.classList.remove('hidden');
      if (apiConfigPanel) apiConfigPanel.style.display = 'block';
      customFieldFilterFeature?.classList.remove('locked');
      if (customFieldFilterCheckbox) customFieldFilterCheckbox.disabled = false;
      budgetChangelogFeature?.classList.remove('locked');
      if (budgetChangelogCheckbox) budgetChangelogCheckbox.disabled = false;
      taskTypeFilterFeature?.classList.remove('locked');
      if (taskTypeFilterCheckbox) taskTypeFilterCheckbox.disabled = false;
      paveCaptureFeature?.classList.remove('locked');
      if (paveCaptureCheckbox) paveCaptureCheckbox.disabled = false;
      invoiceForecastFeature?.classList.remove('locked');
      if (invoiceForecastCheckbox) invoiceForecastCheckbox.disabled = false;
      editableTablesFeature?.classList.remove('locked');
      if (editableTablesCheckbox) editableTablesCheckbox.disabled = false;
    } else {
      // Hide API category and lock features for non-Power Users
      apiCategory?.classList.add('hidden');
      if (apiConfigPanel) apiConfigPanel.style.display = 'none';
      customFieldFilterFeature?.classList.add('locked');
      if (customFieldFilterCheckbox) customFieldFilterCheckbox.disabled = true;
      budgetChangelogFeature?.classList.add('locked');
      if (budgetChangelogCheckbox) budgetChangelogCheckbox.disabled = true;
      taskTypeFilterFeature?.classList.add('locked');
      if (taskTypeFilterCheckbox) taskTypeFilterCheckbox.disabled = true;
      paveCaptureFeature?.classList.add('locked');
      if (paveCaptureCheckbox) paveCaptureCheckbox.disabled = true;
      invoiceForecastFeature?.classList.add('locked');
      if (invoiceForecastCheckbox) invoiceForecastCheckbox.disabled = true;
      editableTablesFeature?.classList.add('locked');
      if (editableTablesCheckbox) editableTablesCheckbox.disabled = true;
    }

    // ESSENTIAL features are available to all license holders
    quickNotesFeature?.classList.remove('locked');
    if (quickNotesCheckbox) quickNotesCheckbox.disabled = false;
    smartJobSwitcherFeature?.classList.remove('locked');
    if (smartJobSwitcherCheckbox) smartJobSwitcherCheckbox.disabled = false;
    freezeHeaderFeature?.classList.remove('locked');
    if (freezeHeaderCheckbox) freezeHeaderCheckbox.disabled = false;
    pdfMarkupToolsFeature?.classList.remove('locked');
    if (pdfMarkupToolsCheckbox) pdfMarkupToolsCheckbox.disabled = false;
    budgetRowHighlightFeature?.classList.remove('locked');
    if (budgetRowHighlightCheckbox) budgetRowHighlightCheckbox.disabled = false;

    syncLockIcons();
    return { hasLicense: true, tier: tier };
  } else {
    // No license or invalid - FREE features still work!
    if (licenseStatus) licenseStatus.className = 'license-status inactive';
    if (statusText) statusText.textContent = 'Free Mode - Upgrade for more features';

    // Lock PRO features
    dragDropFeature?.classList.add('locked');
    if (dragDropCheckbox) dragDropCheckbox.disabled = true;
    rgbThemeFeature?.classList.add('locked');
    if (rgbThemeCheckbox) rgbThemeCheckbox.disabled = true;
    previewModeFeature?.classList.add('locked');
    if (previewModeCheckbox) previewModeCheckbox.disabled = true;
    availabilityFilterFeature?.classList.add('locked');
    if (availabilityFilterCheckbox) availabilityFilterCheckbox.disabled = true;
    reverseThreadOrderFeature?.classList.add('locked');
    if (reverseThreadOrderCheckbox) reverseThreadOrderCheckbox.disabled = true;

    // Lock ESSENTIAL features (require license)
    quickNotesFeature?.classList.add('locked');
    if (quickNotesCheckbox) quickNotesCheckbox.disabled = true;
    smartJobSwitcherFeature?.classList.add('locked');
    if (smartJobSwitcherCheckbox) smartJobSwitcherCheckbox.disabled = true;
    freezeHeaderFeature?.classList.add('locked');
    if (freezeHeaderCheckbox) freezeHeaderCheckbox.disabled = true;
    pdfMarkupToolsFeature?.classList.add('locked');
    if (pdfMarkupToolsCheckbox) pdfMarkupToolsCheckbox.disabled = true;
    budgetRowHighlightFeature?.classList.add('locked');
    if (budgetRowHighlightCheckbox) budgetRowHighlightCheckbox.disabled = true;

    // Hide API category and grant key for free users
    apiCategory?.classList.add('hidden');
    if (apiConfigPanel) apiConfigPanel.style.display = 'none';
    customFieldFilterFeature?.classList.add('locked');
    if (customFieldFilterCheckbox) customFieldFilterCheckbox.disabled = true;
    budgetChangelogFeature?.classList.add('locked');
    if (budgetChangelogCheckbox) budgetChangelogCheckbox.disabled = true;
    taskTypeFilterFeature?.classList.add('locked');
    if (taskTypeFilterCheckbox) taskTypeFilterCheckbox.disabled = true;
    paveCaptureFeature?.classList.add('locked');
    if (paveCaptureCheckbox) paveCaptureCheckbox.disabled = true;
    invoiceForecastFeature?.classList.add('locked');
    if (invoiceForecastCheckbox) invoiceForecastCheckbox.disabled = true;
    editableTablesFeature?.classList.add('locked');
    if (editableTablesCheckbox) editableTablesCheckbox.disabled = true;
    EXTRA_PRO_ROWS.forEach((id) => setFeatureRowLocked(id, true));

    // FREE features remain unlocked (formatter, darkMode, contrastFix,
    // characterCounter, budgetHierarchy, kanbanTypeFilter, autoCollapseGroups,
    // autoSequence)

    syncLockIcons();
    return { hasLicense: false, tier: null };
  }
}

// Verify license key
async function verifyLicenseKey() {
  const licenseInput = document.getElementById('licenseKey');
  const verifyBtn = document.getElementById('verifyBtn');
  const licenseKey = licenseInput.value.trim();

  if (!licenseKey) {
    showStatus('Please enter a license key', 'error');
    return;
  }

  // Disable button during verification
  verifyBtn.disabled = true;
  verifyBtn.textContent = 'Verifying...';

  try {
    const result = await LicenseService.verifyLicense(licenseKey);

    if (result.success) {
      // Show tier in success message
      const tier = result.data?.tier;
      const tierName = tier ? LicenseService.getTierDisplayName(tier) : 'Pro';
      showStatus(`${tierName} license activated!`, 'success');
      licenseInput.value = '';

      // Update UI
      await checkLicenseStatus();
      await loadSettings();

      // Update account UI to show setup prompt (if AccountService available)
      if (typeof AccountService !== 'undefined') {
        sessionStorage.removeItem('accountSetupSkipped'); // Reset skip state on new license
        await updateAccountUI();
      }
    } else {
      showStatus(result.error || 'Invalid license key', 'error');
    }
  } catch (error) {
    console.error('Error verifying license:', error);
    showStatus('Error verifying license', 'error');
  } finally {
    verifyBtn.disabled = false;
    verifyBtn.textContent = 'Verify';
  }
}

// Load saved settings and update UI
async function loadSettings() {
  try {
    const result = await chrome.storage.sync.get(['jtToolsSettings']);
    // Merge stored settings with defaults so new feature keys are always present
    let settings = (typeof JTDefaults !== 'undefined' && JTDefaults.mergeWithDefaults)
      ? JTDefaults.mergeWithDefaults(result.jtToolsSettings)
      : result.jtToolsSettings || defaultSettings;

    // darkMode/darkModeLevel are per-device: this device's values win
    if (typeof JTDeviceSettings !== 'undefined') {
      settings = await JTDeviceSettings.overlay(settings);
    }

    // Check user's tier for feature access
    const tier = await LicenseService.getTier();
    const hasLicense = tier !== null;
    const hasProFeatures = LicenseService.tierAtLeast(tier, LicenseService.TIERS.PRO);
    const hasEssentialFeatures = LicenseService.tierAtLeast(tier, LicenseService.TIERS.ESSENTIAL);
    const hasPowerUser = tier && LicenseService.tierHasFeature(tier, 'customFieldFilter');

    // Helper to safely set checkbox value
    const setCheckbox = (id, value) => {
      const el = document.getElementById(id);
      if (el) el.checked = value;
    };

    // FREE features - work for everyone (no license required)
    setCheckbox('formatter', settings.formatter);
    setCheckbox('darkMode', settings.darkMode);
    // Seed the remembered level before painting the step control. Settings saved
    // before this was a 4-step toggle have no darkModeLevel, and those users had
    // the standard dark theme — so that is what an absent value means.
    DarkModeSteps.restoreLevel(settings.darkModeLevel);
    syncDarkModeSteps();
    setCheckbox('contrastFix', settings.contrastFix);
    setCheckbox('characterCounter', settings.characterCounter !== undefined ? settings.characterCounter : false);
    setCheckbox('budgetHierarchy', settings.budgetHierarchy !== undefined ? settings.budgetHierarchy : false);
    setCheckbox('budgetRowHighlight', settings.budgetRowHighlight !== undefined ? settings.budgetRowHighlight : false);
    setCheckbox('kanbanTypeFilter', settings.kanbanTypeFilter !== undefined ? settings.kanbanTypeFilter : false);
    setCheckbox('autoCollapseGroups', settings.autoCollapseGroups !== undefined ? settings.autoCollapseGroups : false);
    setCheckbox('documentSort', settings.documentSort !== undefined ? settings.documentSort : false);
    setCheckbox('printScope', settings.printScope !== undefined ? settings.printScope : false);
    setCheckbox('budgetTools', settings.budgetTools !== undefined ? settings.budgetTools : false);
    setCheckbox('ganttLines', settings.ganttLines !== undefined ? settings.ganttLines : true);
    setCheckbox('scheduleMonthShading', settings.scheduleMonthShading !== undefined ? settings.scheduleMonthShading : false);
    setCheckbox('jobAccessCollapse', settings.jobAccessCollapse !== undefined ? settings.jobAccessCollapse : false);
    setCheckbox('autoSequence', settings.autoSequence !== undefined ? settings.autoSequence : false);

    // ESSENTIAL features - require any license (Essential, Pro, Power User)
    setCheckbox('quickNotes', hasEssentialFeatures && (settings.quickNotes !== undefined ? settings.quickNotes : true));
    setCheckbox('smartJobSwitcher', hasEssentialFeatures && (settings.smartJobSwitcher !== undefined ? settings.smartJobSwitcher : true));
    setCheckbox('freezeHeader', hasEssentialFeatures && (settings.freezeHeader !== undefined ? settings.freezeHeader : false));
    setCheckbox('pdfMarkupTools', hasEssentialFeatures && (settings.pdfMarkupTools !== undefined ? settings.pdfMarkupTools : true));

    // PRO features - require Pro or Power User tier
    setCheckbox('dragDrop', hasProFeatures && settings.dragDrop);
    setCheckbox('previewMode', hasProFeatures && settings.previewMode);
    setCheckbox('rgbTheme', hasProFeatures && settings.rgbTheme);
    setCheckbox('availabilityFilter', hasProFeatures && (settings.availabilityFilter !== undefined ? settings.availabilityFilter : false));
    setCheckbox('reverseThreadOrder', hasProFeatures && (settings.reverseThreadOrder !== undefined ? settings.reverseThreadOrder : false));
    setCheckbox('tweakEngine', hasProFeatures && (settings.tweakEngine !== undefined ? settings.tweakEngine : true));
    setCheckbox('inspectForAi', hasProFeatures && (settings.inspectForAi !== undefined ? settings.inspectForAi : false));

    // Tweaks tab: show upgrade notice + lock toggles for non-Pro users
    const tweaksUpgradeNotice = document.getElementById('tweaksUpgradeNotice');
    const tweaksToggles = document.getElementById('tweaksToggles');
    const tweaksSection = document.querySelector('[data-tweaks-section]');
    if (tweaksUpgradeNotice) tweaksUpgradeNotice.hidden = !!hasProFeatures;
    if (tweaksToggles) tweaksToggles.style.display = hasProFeatures ? '' : 'none';
    if (tweaksSection) tweaksSection.style.display = hasProFeatures ? '' : 'none';

    // Show the "Pick an element" row only when Inspect for AI is enabled,
    // so contractors see the discoverable button right where it matters.
    const tweaksPickRow = document.getElementById('tweaksPickRow');
    const inspectForAiEl = document.getElementById('inspectForAi');
    if (tweaksPickRow) {
      const showPick = hasProFeatures && inspectForAiEl && inspectForAiEl.checked;
      tweaksPickRow.hidden = !showPick;
    }
    // Live-update the pick row when the inspector toggle is flipped from
    // inside this popup session (no full reload needed).
    if (inspectForAiEl && tweaksPickRow && !inspectForAiEl.dataset.pickRowWired) {
      inspectForAiEl.dataset.pickRowWired = '1';
      inspectForAiEl.addEventListener('change', () => {
        tweaksPickRow.hidden = !inspectForAiEl.checked;
      });
    }

    // POWER USER features - require Power User tier (API-powered)
    setCheckbox('customFieldFilter', settings.customFieldFilter !== undefined ? settings.customFieldFilter : false);
    setCheckbox('budgetChangelog', settings.budgetChangelog !== undefined ? settings.budgetChangelog : false);
    setCheckbox('taskTypeFilter', settings.taskTypeFilter !== undefined ? settings.taskTypeFilter : false);
    setCheckbox('invoiceForecast', settings.invoiceForecast !== undefined ? settings.invoiceForecast : false);
    setCheckbox('editableTables', settings.editableTables !== undefined ? settings.editableTables : false);
    setCheckbox('paveCapture', hasPowerUser && (settings.paveCapture !== undefined ? settings.paveCapture : false));

    // AI Assistant toggle removed — admin-managed in the portal. The popup
    // never reads or writes settings.assistantPanel anymore; the feature
    // self-gates in features/assistant-panel.js init() on login + the
    // Assistant company tier.
    // Forms toggle removed — see Migration 029. The on/off decision is
    // admin-managed in the portal; this popup never reads or writes
    // settings.forms anymore.

    // Reconcile storage with current access: if a feature is stored as true
    // but can't actually run given the current tier or portal session state,
    // persist false and notify content scripts so the feature actually stops
    // running on the JobTread page. Without this, features appear off in the
    // popup but stay active on the page (storage still says true).
    const featuresToDisable = [];
    if (!hasProFeatures) {
      if (settings.dragDrop) featuresToDisable.push('dragDrop');
      if (settings.previewMode) featuresToDisable.push('previewMode');
      if (settings.rgbTheme) featuresToDisable.push('rgbTheme');
      if (settings.availabilityFilter) featuresToDisable.push('availabilityFilter');
      if (settings.tweakEngine) featuresToDisable.push('tweakEngine');
      if (settings.inspectForAi) featuresToDisable.push('inspectForAi');
      if (settings.reverseThreadOrder) featuresToDisable.push('reverseThreadOrder');
    }
    if (!hasEssentialFeatures) {
      if (settings.quickNotes) featuresToDisable.push('quickNotes');
      if (settings.smartJobSwitcher) featuresToDisable.push('smartJobSwitcher');
      if (settings.freezeHeader) featuresToDisable.push('freezeHeader');
      if (settings.pdfMarkupTools) featuresToDisable.push('pdfMarkupTools');
    }

    // API-dependent features need a portal session (JWT) to fetch data from
    // the server. Without it, they throw "No API configured" errors on every
    // operation. Disable them when signed out of the portal.
    const { jtAccountAccessToken } = await chrome.storage.local.get(['jtAccountAccessToken']);
    if (!jtAccountAccessToken) {
      if (settings.customFieldFilter) featuresToDisable.push('customFieldFilter');
      if (settings.budgetChangelog) featuresToDisable.push('budgetChangelog');
      if (settings.taskTypeFilter) featuresToDisable.push('taskTypeFilter');
      if (settings.invoiceForecast) featuresToDisable.push('invoiceForecast');
      if (settings.editableTables) featuresToDisable.push('editableTables');
      // Capture only pays off with MCP access to read it back; both need a
      // portal session, so disable recording when signed out.
      if (settings.paveCapture) featuresToDisable.push('paveCapture');
    }

    if (featuresToDisable.length > 0) {
      await syncDisabledFeaturesToStorage(featuresToDisable);
      // Also flip the visible checkboxes so the UI matches the storage write
      featuresToDisable.forEach(id => setCheckbox(id, false));
    }

    // Load theme colors
    const themeColors = settings.themeColors || defaultSettings.themeColors;
    loadThemeColors(themeColors);

    // Load saved themes — render local first so the UI is immediately
    // populated, then attempt a server pull and re-render with the
    // merged result. Server fetch is best-effort; local wins on error.
    const savedThemes = settings.savedThemes || defaultSettings.savedThemes;
    loadSavedThemes(savedThemes);

    // v4.8.4 — Sync the active-card label to whatever theme is actually applied
    // (preset / saved slot / custom). Otherwise the HTML-hardcoded "Field Day"
    // shows even when the applied colors are a saved theme.
    reconcileActiveThemeLabel(themeColors, savedThemes);

    // Fire-and-forget server sync for saved palettes. When logged in,
    // pulls server themes and merges with local (server wins per slot),
    // then re-renders. Logged-out users get the local-only path.
    syncSavedThemesFromServer(savedThemes).then(merged => {
      if (merged !== savedThemes) {
        loadSavedThemes(merged);
        reconcileActiveThemeLabel(themeColors, merged);
      }
    }).catch(err => {
      console.warn('CustomTheme: initial sync failed:', err && err.message);
    });

    // Show/hide customize button based on rgbTheme state (if it exists in the HTML)
    const customizeBtn = document.getElementById('customizeThemeBtn');
    if (customizeBtn) {
      customizeBtn.style.display = (hasProFeatures && settings.rgbTheme) ? 'inline-flex' : 'none';
    }

    syncThemeControlsVisibility(hasProFeatures && settings.rgbTheme);

    // Hide the customization panel initially (if it exists in the HTML)
    const themeCustomization = document.getElementById('themeCustomization');
    if (themeCustomization) {
      themeCustomization.style.display = 'none';
      if (customizeBtn) customizeBtn.classList.remove('expanded');
    }

    console.log('Settings loaded:', settings, 'tier:', tier, 'hasLicense:', hasLicense);
  } catch (error) {
    console.error('Error loading settings:', error);
    showStatus('Error loading settings', 'error');
  }
}

// Save settings
async function saveSettings(settings) {
  try {
    // Use tier-based feature checking
    const tier = await LicenseService.getTier();
    const hasProFeatures = LicenseService.tierAtLeast(tier, LicenseService.TIERS.PRO);
    const hasEssentialFeatures = LicenseService.tierAtLeast(tier, LicenseService.TIERS.ESSENTIAL);

    // PRO tier feature checks
    // Check if user is trying to enable Schedule & Task Checkboxes without Pro tier
    if (settings.dragDrop && !hasProFeatures) {
      const message = tier ? 'Schedule & Task Checkboxes requires Pro or Power User tier' : 'Schedule & Task Checkboxes requires a license';
      showStatus(message, 'error');
      document.getElementById('dragDrop').checked = false;
      settings.dragDrop = false;
      return;
    }

    // Check if user is trying to enable Preview Mode without Pro tier
    if (settings.previewMode && !hasProFeatures) {
      const message = tier ? 'Preview Mode requires Pro or Power User tier' : 'Preview Mode requires a license';
      showStatus(message, 'error');
      document.getElementById('previewMode').checked = false;
      settings.previewMode = false;
      return;
    }

    // Check if user is trying to enable Custom Theme without Pro tier
    if (settings.rgbTheme && !hasProFeatures) {
      const message = tier ? 'Custom Theme requires Pro or Power User tier' : 'Custom Theme requires a license';
      showStatus(message, 'error');
      document.getElementById('rgbTheme').checked = false;
      settings.rgbTheme = false;
      // Hide customize button and panel since RGB theme can't be enabled
      const customizeBtn = document.getElementById('customizeThemeBtn');
      const themeCustomization = document.getElementById('themeCustomization');
      customizeBtn.style.display = 'none';
      themeCustomization.style.display = 'none';
      return;
    }

    // Check if user is trying to enable Availability Filter without Pro tier
    if (settings.availabilityFilter && !hasProFeatures) {
      const message = tier ? 'Availability Filter requires Pro or Power User tier' : 'Availability Filter requires a license';
      showStatus(message, 'error');
      document.getElementById('availabilityFilter').checked = false;
      settings.availabilityFilter = false;
      return;
    }

    // ESSENTIAL tier feature checks
    // Check if user is trying to enable Quick Notes without license
    if (settings.quickNotes && !hasEssentialFeatures) {
      showStatus('Quick Notes requires a license (Essential tier or higher)', 'error');
      document.getElementById('quickNotes').checked = false;
      settings.quickNotes = false;
      return;
    }

    // Check if user is trying to enable Smart Resize without license
    if (settings.smartJobSwitcher && !hasEssentialFeatures) {
      showStatus('Smart Resize requires a license (Essential tier or higher)', 'error');
      document.getElementById('smartJobSwitcher').checked = false;
      settings.smartJobSwitcher = false;
      return;
    }

    // Check if user is trying to enable Freeze Header without license
    if (settings.freezeHeader && !hasEssentialFeatures) {
      showStatus('Freeze Header requires a license (Essential tier or higher)', 'error');
      document.getElementById('freezeHeader').checked = false;
      settings.freezeHeader = false;
      return;
    }

    // Check if user is trying to enable PDF Markup Tools without license
    if (settings.pdfMarkupTools && !hasEssentialFeatures) {
      showStatus('PDF Markup Tools requires a license (Essential tier or higher)', 'error');
      document.getElementById('pdfMarkupTools').checked = false;
      settings.pdfMarkupTools = false;
      return;
    }

    // Show/hide customize button based on rgbTheme toggle (if elements exist)
    const customizeBtn = document.getElementById('customizeThemeBtn');
    const themeCustomization = document.getElementById('themeCustomization');
    const shouldShowButton = hasProFeatures && settings.rgbTheme;

    if (customizeBtn) {
      customizeBtn.style.display = shouldShowButton ? 'inline-flex' : 'none';
    }

    syncThemeControlsVisibility(shouldShowButton);

    // Hide panel when toggle is turned off
    if (!shouldShowButton && themeCustomization) {
      themeCustomization.style.display = 'none';
      if (customizeBtn) customizeBtn.classList.remove('expanded');
    }

    console.log('saveSettings: Customize button visibility:', shouldShowButton ? 'visible' : 'hidden', 'tier:', tier);

    await chrome.storage.sync.set({ jtToolsSettings: settings });
    // darkMode/darkModeLevel also land in this device's local overlay — the
    // synced copies are legacy seed material for not-yet-migrated devices
    if (typeof JTDeviceSettings !== 'undefined') {
      await JTDeviceSettings.set({
        darkMode: settings.darkMode,
        darkModeLevel: settings.darkModeLevel
      });
    }
    console.log('Settings saved:', settings);

    // Notify background script of settings change
    chrome.runtime.sendMessage({
      type: 'SETTINGS_UPDATED',
      settings: settings
    });

    showStatus('Settings saved!', 'success');
  } catch (error) {
    console.error('Error saving settings:', error);
    showStatus('Error saving settings', 'error');
  }
}

// ═══ Dark Mode step toggle ═══
// The control itself — the 4 steps, the remembered level, and the offer to
// switch JobTread's own theme when the selected step needs a different one —
// lives in popup/dark-mode-steps.js as window.DarkModeSteps. It was moved out
// so it can be exercised in jsdom: this file runs license checks, account UI
// and a dozen network calls on load, and none of that is loadable in a test.
//
// These two wrappers keep the existing call sites in this file unchanged.
function syncDarkModeSteps() {
  DarkModeSteps.sync();
}

function initDarkModeSteps() {
  DarkModeSteps.init();
}

// Helper to safely get checkbox value with fallback
function getCheckboxValue(id, fallback = false) {
  const el = document.getElementById(id);
  return el ? el.checked : fallback;
}

// Get current settings from checkboxes
async function getCurrentSettings() {
  const result = await chrome.storage.sync.get(['jtToolsSettings']);
  const currentColors = (result.jtToolsSettings && result.jtToolsSettings.themeColors) || defaultSettings.themeColors;
  const savedThemes = (result.jtToolsSettings && result.jtToolsSettings.savedThemes) || defaultSettings.savedThemes;

  return {
    dragDrop: getCheckboxValue('dragDrop', defaultSettings.dragDrop),
    contrastFix: getCheckboxValue('contrastFix', defaultSettings.contrastFix),
    formatter: getCheckboxValue('formatter', defaultSettings.formatter),
    previewMode: getCheckboxValue('previewMode', defaultSettings.previewMode),
    darkMode: getCheckboxValue('darkMode', defaultSettings.darkMode),
    darkModeLevel: DarkModeSteps.getLevel(),
    rgbTheme: getCheckboxValue('rgbTheme', defaultSettings.rgbTheme),
    smartJobSwitcher: getCheckboxValue('smartJobSwitcher', defaultSettings.smartJobSwitcher),
    budgetHierarchy: getCheckboxValue('budgetHierarchy', defaultSettings.budgetHierarchy),
    budgetRowHighlight: getCheckboxValue('budgetRowHighlight', defaultSettings.budgetRowHighlight),
    quickNotes: getCheckboxValue('quickNotes', defaultSettings.quickNotes),
    helpSidebarSupport: true, // Always enabled, not user-toggleable
    freezeHeader: getCheckboxValue('freezeHeader', defaultSettings.freezeHeader),
    characterCounter: getCheckboxValue('characterCounter', defaultSettings.characterCounter),
    kanbanTypeFilter: getCheckboxValue('kanbanTypeFilter', defaultSettings.kanbanTypeFilter),
    autoCollapseGroups: getCheckboxValue('autoCollapseGroups', defaultSettings.autoCollapseGroups),
    documentSort: getCheckboxValue('documentSort', defaultSettings.documentSort),
    printScope: getCheckboxValue('printScope', defaultSettings.printScope),
    budgetTools: getCheckboxValue('budgetTools', defaultSettings.budgetTools),
    ganttLines: getCheckboxValue('ganttLines', defaultSettings.ganttLines),
    scheduleMonthShading: getCheckboxValue('scheduleMonthShading', defaultSettings.scheduleMonthShading),
    autoSequence: getCheckboxValue('autoSequence', defaultSettings.autoSequence),
    availabilityFilter: getCheckboxValue('availabilityFilter', false),
    customFieldFilter: getCheckboxValue('customFieldFilter', defaultSettings.customFieldFilter),
    budgetChangelog: getCheckboxValue('budgetChangelog', defaultSettings.budgetChangelog),
    taskTypeFilter: getCheckboxValue('taskTypeFilter', defaultSettings.taskTypeFilter),
    invoiceForecast: getCheckboxValue('invoiceForecast', defaultSettings.invoiceForecast),
    editableTables: getCheckboxValue('editableTables', defaultSettings.editableTables),
    // assistantPanel: removed from popup — admin-controlled in the portal.
    // We pass `true` so the content script still loads features/assistant-panel.js;
    // the feature self-gates on login + the Assistant company tier.
    assistantPanel: true,
    paveCapture: getCheckboxValue('paveCapture', defaultSettings.paveCapture !== undefined ? defaultSettings.paveCapture : false),
    pdfMarkupTools: getCheckboxValue('pdfMarkupTools', defaultSettings.pdfMarkupTools),
    reverseThreadOrder: getCheckboxValue('reverseThreadOrder', defaultSettings.reverseThreadOrder),
    jobAccessCollapse: getCheckboxValue('jobAccessCollapse', defaultSettings.jobAccessCollapse),
    orgLogo: true,
    tweakEngine: getCheckboxValue('tweakEngine', defaultSettings.tweakEngine !== undefined ? defaultSettings.tweakEngine : true),
    inspectForAi: getCheckboxValue('inspectForAi', defaultSettings.inspectForAi !== undefined ? defaultSettings.inspectForAi : false),
    // forms: removed from popup — admin-controlled in the portal.
    // We pass `true` so the content script still loads features/forms.js;
    // the feature self-gates on the server-side company toggle.
    forms: true,
    // fileDragToFolder: getCheckboxValue('fileDragToFolder', defaultSettings.fileDragToFolder), // Saved for a later version
    themeColors: currentColors,
    savedThemes: savedThemes
  };
}

// Show status message
/**
 * If the user just toggled on a grant-key-requiring feature but is in the
 * "legacy" state (valid Gumroad license, no portal account), show a modal
 * directing them to register. No-ops in every other state:
 *   - Already registered + grant key set: nothing to do
 *   - Already registered + no grant key: existing UI handles this
 *   - No license at all: existing UI handles this
 *   - User dismissed the modal previously: respect that
 *   - Network error / endpoint unavailable: silently skip
 *
 * Non-blocking — the toggle proceeds either way; the modal is informative.
 */
async function maybeShowRegisterNudge() {
  try {
    if (typeof StorageWrapper === 'undefined') return;

    // Respect prior dismissal
    const dismissedRecord = await StorageWrapper.get(REGISTER_NUDGE_DISMISSED_KEY);
    if (dismissedRecord && dismissedRecord[REGISTER_NUDGE_DISMISSED_KEY]) return;

    // Need a license + license key to ask the server about
    if (typeof LicenseService === 'undefined') return;
    const hasLicense = await LicenseService.hasValidLicense();
    if (!hasLicense) return;
    const licenseData = await LicenseService.getLicenseData();
    const licenseKey = licenseData?.key;
    if (!licenseKey) return;

    // If a grant key is already configured, nothing to nudge about
    if (typeof JobTreadProService !== 'undefined') {
      const existingGrantKey = await JobTreadProService.getGrantKey();
      if (existingGrantKey) return;
    }

    // Ask the server: does this license have a registered portal account?
    if (typeof JobTreadProService === 'undefined' || !JobTreadProService.checkAccountState) return;
    const state = await JobTreadProService.checkAccountState(licenseKey);
    if (!state) return; // Network error — fall through silently
    if (!state.hasValidLicense) return; // Server-side license invalid — different UX path
    if (state.hasAccount) return; // Registered already; existing "configure grant key" UI handles this

    // Legacy state confirmed — show the nudge
    showRegisterNudgeDialog(licenseKey);
  } catch (e) {
    console.error('maybeShowRegisterNudge error:', e);
  }
}

function showRegisterNudgeDialog(licenseKey) {
  const dialog = document.querySelector('[data-register-nudge]');
  if (!dialog || typeof dialog.showModal !== 'function') return;

  const dontShow = dialog.querySelector('[data-register-nudge-dontshow]');
  const closeBtn = dialog.querySelector('[data-register-nudge-close]');
  const registerBtn = dialog.querySelector('[data-register-nudge-register]');

  if (dontShow) dontShow.checked = false;

  const persistDismissalIfChecked = async () => {
    if (dontShow?.checked && typeof StorageWrapper !== 'undefined') {
      await StorageWrapper.set({ [REGISTER_NUDGE_DISMISSED_KEY]: true });
    }
  };

  const onClose = async () => {
    await persistDismissalIfChecked();
    dialog.close();
    cleanup();
  };

  const onRegister = async () => {
    await persistDismissalIfChecked();
    // Pre-fill the licenseKey field via query param so the user only has
    // to set displayName/email/password. The portal's register.html
    // handles ?licenseKey=… already if wired; otherwise the user pastes.
    const url = `${PORTAL_BASE_URL}/register.html?licenseKey=${encodeURIComponent(licenseKey)}`;
    window.open(url, '_blank', 'noopener,noreferrer');
    dialog.close();
    cleanup();
  };

  function cleanup() {
    closeBtn?.removeEventListener('click', onClose);
    registerBtn?.removeEventListener('click', onRegister);
  }

  closeBtn?.addEventListener('click', onClose);
  registerBtn?.addEventListener('click', onRegister);

  dialog.showModal();
}

function showStatus(message, type = 'success') {
  const statusEl = document.getElementById('statusMessage');
  if (!statusEl) {
    console.log('Status:', message, type);
    return;
  }
  statusEl.textContent = message;
  statusEl.className = `status-message ${type}`;

  // Clear after 3 seconds
  setTimeout(() => {
    statusEl.textContent = '';
    statusEl.className = 'status-message';
  }, 3000);
}

// Refresh current tab
async function refreshCurrentTab() {
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });

    if (!tab) {
      showStatus('No active tab found', 'error');
      return;
    }

    // Check if it's a JobTread tab
    if (!tab.url || !tab.url.includes('jobtread.com')) {
      showStatus('Please navigate to JobTread', 'error');
      return;
    }

    // Reload the tab
    await chrome.tabs.reload(tab.id);
    showStatus('Tab refreshed!', 'success');

    // Auto-close the popup after the toast so the user lands on the
    // freshly-reloaded JobTread tab. Skip this in side-panel mode —
    // window.close() collapses the entire pinned sidebar, defeating the
    // whole point of pinning.
    if (!IS_IN_SIDE_PANEL) {
      setTimeout(() => {
        window.close();
      }, 1000);
    }
  } catch (error) {
    console.error('Error refreshing tab:', error);
    showStatus('Error refreshing tab', 'error');
  }
}

function openInSidebar(windowId) {
  try {
    chrome.sidePanel.open({ windowId });
    window.close();
  } catch (error) {
    console.error('Error opening side panel:', error);
    showStatus('Could not open side panel', 'error');
  }
}

// Firefox equivalent of openInSidebar(). browser.sidebarAction.open() takes no
// windowId and must be called synchronously inside the user gesture, so there's
// no windowId pre-fetch like the Chrome path.
function openInSidebarFirefox() {
  try {
    FIREFOX_SIDEBAR_API.open();
    window.close();
  } catch (error) {
    console.error('Error opening sidebar:', error);
    showStatus('Could not open sidebar', 'error');
  }
}

// Load theme colors into pickers
function loadThemeColors(colors) {
  const primaryPicker = document.getElementById('primaryColorPicker');
  const backgroundPicker = document.getElementById('backgroundColorPicker');
  const textPicker = document.getElementById('textColorPicker');
  const primaryValue = document.getElementById('primaryColorValue');
  const backgroundValue = document.getElementById('backgroundColorValue');
  const textValue = document.getElementById('textColorValue');

  // Only update if elements exist
  if (primaryPicker) primaryPicker.value = colors.primary;
  if (backgroundPicker) backgroundPicker.value = colors.background;
  if (textPicker) textPicker.value = colors.text;

  if (primaryValue) primaryValue.textContent = colors.primary.toUpperCase();
  if (backgroundValue) backgroundValue.textContent = colors.background.toUpperCase();
  if (textValue) textValue.textContent = colors.text.toUpperCase();

  updateThemePreview();
}

// Get current theme colors from pickers
function getCurrentThemeColors() {
  const primaryPicker = document.getElementById('primaryColorPicker');
  const backgroundPicker = document.getElementById('backgroundColorPicker');
  const textPicker = document.getElementById('textColorPicker');

  return {
    primary: primaryPicker ? primaryPicker.value : defaultSettings.themeColors.primary,
    background: backgroundPicker ? backgroundPicker.value : defaultSettings.themeColors.background,
    text: textPicker ? textPicker.value : defaultSettings.themeColors.text
  };
}

// Update theme preview samples
function updateThemePreview() {
  const colors = getCurrentThemeColors();

  // Primary
  const previewPrimary = document.getElementById('previewPrimary');
  if (previewPrimary) {
    previewPrimary.style.backgroundColor = colors.primary;
    previewPrimary.style.borderColor = colors.primary;
    previewPrimary.style.color = 'white';
  }

  // Background
  const previewBackground = document.getElementById('previewBackground');
  if (previewBackground) {
    previewBackground.style.backgroundColor = colors.background;
    previewBackground.style.color = colors.text;
    previewBackground.style.borderColor = colors.background;
  }

  // Text
  const previewText = document.getElementById('previewText');
  if (previewText) {
    previewText.style.backgroundColor = 'white';
    previewText.style.color = colors.text;
    previewText.style.borderColor = '#e5e7eb';
  }

  // v4.8 — also refresh OKLCH triplets, WCAG meter, JT preview, builder swatches
  refreshThemeRebuildUI(colors);
}

// ──────────────────────────────────────────────────────────────────
// v4.8 Theme Rebuild — OKLCH triplets, WCAG meter, JT preview pane,
// auto-nudge, random harmonized, color-blind toggle, active card.
// All driven by window.ThemePalette (OKLCH module loaded with rgb-theme).
// ──────────────────────────────────────────────────────────────────
function refreshThemeRebuildUI(colorsArg) {
  const TP = window.ThemePalette;
  if (!TP || !TP.generatePalette) return; // module not loaded yet

  const colors = colorsArg || getCurrentThemeColors();
  let palette;
  try {
    palette = TP.generatePalette(colors);
  } catch (e) {
    console.warn('[v4.8] generatePalette failed, skipping refresh', e);
    return;
  }

  // OKLCH triplet under each clr-cell hex
  const fmtOklch = (hex) => {
    try {
      const c = TP.hexToOklch(hex);
      const L = Math.round(c.L * 100);
      const C = c.C.toFixed(2);
      const H = isNaN(c.h) ? 0 : Math.round(c.h);
      return `oklch(${L}% ${C} ${H})`;
    } catch (_) { return ''; }
  };
  const setText = (id, value) => { const el = document.getElementById(id); if (el) el.textContent = value; };
  setText('primaryOklch', fmtOklch(colors.primary));
  setText('backgroundOklch', fmtOklch(colors.background));
  setText('textOklch', fmtOklch(colors.text));

  // Builder cell swatches (visible color of the .swatch div)
  const setBg = (id, color) => { const el = document.getElementById(id); if (el) el.style.background = color; };
  setBg('primarySwatch', colors.primary);
  setBg('backgroundSwatch', colors.background);
  setBg('textSwatch', colors.text);

  // Active card swatches
  const activeRow = document.getElementById('activeSwatches');
  if (activeRow) {
    const spans = activeRow.querySelectorAll('span');
    if (spans[0]) spans[0].style.background = colors.primary;
    if (spans[1]) spans[1].style.background = colors.background;
    if (spans[2]) spans[2].style.background = colors.text;
  }

  // WCAG panel
  refreshWcagPanel(palette.meta && palette.meta.ratios ? palette.meta.ratios : null);
}

function refreshWcagPanel(ratios) {
  if (!ratios) return;
  const grade = (r) => r >= 7 ? 'AAA' : r >= 4.5 ? 'AA' : r >= 3 ? 'A' : 'FAIL';
  const cls = (r) => r >= 4.5 ? 'badge-pass' : r >= 3 ? 'badge-warn' : 'badge-fail';
  document.querySelectorAll('#wcagPanel .item').forEach(item => {
    const key = item.dataset.ratio;
    if (!key || ratios[key] == null) return;
    const num = ratios[key];
    const numEl = item.querySelector('[data-ratio-num]');
    const badgeEl = item.querySelector('[data-ratio-badge]');
    if (numEl) numEl.textContent = num.toFixed(1);
    if (badgeEl) {
      badgeEl.textContent = grade(num);
      badgeEl.className = `badge ${cls(num)}`;
      badgeEl.style.marginLeft = 'auto';
    }
  });
  // Auto-nudge button: visible only when at least one ratio is below AA
  const autoFixBtn = document.getElementById('autoFixBtn');
  const anyFails = Object.values(ratios).some(r => r < 4.5);
  if (autoFixBtn) autoFixBtn.hidden = !anyFails;
}

// One-shot: walk the failing color toward bg in 1% Oklab L steps until contrast >= 4.5
function autoNudgeToAA() {
  const TP = window.ThemePalette;
  if (!TP) return;
  const colors = getCurrentThemeColors();
  const bgIsDark = TP.hexToOklch(colors.background).L < 0.5;
  let changed = null;

  // Try primary-on-bg first (most common fail), then text-on-bg (rare)
  const tryShift = (key, target) => {
    if (changed) return;
    let c = colors[key];
    const directionPos = bgIsDark; // dark bg → lighten the foreground; light bg → darken
    for (let i = 0; i < 60; i++) {
      const ratio = TP.contrast(c, colors[target]);
      if (ratio >= 4.5) break;
      c = TP.shiftL(c, directionPos ? +0.01 : -0.01);
    }
    if (c !== colors[key]) {
      colors[key] = c;
      changed = key;
    }
  };

  if (TP.contrast(colors.primary, colors.background) < 4.5) tryShift('primary', 'background');
  if (!changed && TP.contrast(colors.text, colors.background) < 4.5) tryShift('text', 'background');

  if (changed) {
    loadThemeColors(colors);
    showStatus(`Auto-nudged ${changed} to AA`, 'success');
  } else {
    showStatus('Nothing to nudge — all combos pass AA', 'success');
  }
}

function randomHarmonizedTheme() {
  const TP = window.ThemePalette;
  if (!TP) return;
  const h = Math.random() * 360;
  // Vivid mid-light primary
  const primary = TP.oklchToHex({ L: 0.65, C: 0.18, h });
  // Warm-tinted near-white background
  const background = TP.oklchToHex({ L: 0.97, C: 0.012, h });
  // Deep near-black text
  const text = TP.oklchToHex({ L: 0.18, C: 0.04, h });
  loadThemeColors({ primary, background, text });
  // Mark "Custom" in the active card since this isn't a named preset
  const nameEl = document.getElementById('activeThemeName');
  const metaEl = document.getElementById('activeThemeMeta');
  if (nameEl) nameEl.textContent = 'Custom';
  if (metaEl) metaEl.textContent = `Harmonized · hue ${Math.round(h)}°`;
  document.querySelectorAll('.preset.is-current').forEach(p => p.classList.remove('is-current'));
}

// Apply current theme
async function applyTheme() {
  try {
    const colors = getCurrentThemeColors();
    const result = await chrome.storage.sync.get(['jtToolsSettings']);
    const settings = result.jtToolsSettings || defaultSettings;

    settings.themeColors = colors;

    await chrome.storage.sync.set({ jtToolsSettings: settings });
    console.log('Theme colors saved:', colors);

    // Notify background script of settings change
    chrome.runtime.sendMessage({
      type: 'SETTINGS_UPDATED',
      settings: settings
    });

    showStatus('Theme applied!', 'success');
  } catch (error) {
    console.error('Error applying theme:', error);
    showStatus('Error applying theme', 'error');
  }
}

// Preloaded theme presets — v4.8 lineup
// Brand themes (Light / Dark / Jurassic Tarantula) lead the lineup — seed
// triples taken from the JT Power Tools Design System (warm paper, warm coal,
// and the fossil-amber/tar Jurassic theme). The OKLCH engine derives the full
// palette from these three seeds.
const PRESET_THEMES = {
  'light':      { primary: '#FE4C0D', background: '#F5F1EA', text: '#1A1A1A', label: 'Light',      meta: 'Brand · warm paper' },
  'dark':       { primary: '#FE4C0D', background: '#1C1A16', text: '#F4EFE6', label: 'Dark',       meta: 'Brand · warm coal' },
  'jurassic':   { primary: '#E0531F', background: '#16110A', text: '#F6E9C9', label: 'Jurassic Tarantula', meta: 'Fossil amber · tar black' },
  'field-day':  { primary: '#FE4C0D', background: '#FFFBF4', text: '#1A1410', label: 'Field Day',  meta: 'High-vis · auto-applied' },
  'blueprint':  { primary: '#0EA5E9', background: '#F4F8FC', text: '#0C2230', label: 'Blueprint',  meta: 'Brand · auto-applied' },
  'carbon':     { primary: '#FFB000', background: '#1A1916', text: '#ECECEC', label: 'Carbon',     meta: 'Dark · auto-applied' },
  'paper':      { primary: '#3B5898', background: '#F7F3E8', text: '#221C10', label: 'Paper',      meta: 'Low strain · auto-applied' },
  'forest':     { primary: '#16A34A', background: '#F4F9EE', text: '#1A2410', label: 'Forest',     meta: 'Calm · auto-applied' },
  'owner-demo': { primary: '#7C3AED', background: '#FBF6FF', text: '#1A1029', label: 'Owner Demo', meta: 'Screenshot · auto-applied' },
  'sunset':     { primary: '#EA580C', background: '#FFF7ED', text: '#431407', label: 'Sunset',     meta: 'Warm · auto-applied' },
  'berry':      { primary: '#7C3AED', background: '#F3E8FF', text: '#1F1B29', label: 'Berry',      meta: 'Vivid · auto-applied' },
  'slate':      { primary: '#64748B', background: '#F1F5F9', text: '#1E293B', label: 'Slate',      meta: 'Neutral · auto-applied' },
  'charcoal':   { primary: '#A1A1AA', background: '#27272A', text: '#E4E4E7', label: 'Charcoal',   meta: 'Mono · auto-applied' },
  // legacy aliases — kept so users with old saved presetKey in storage don't see broken state
  ocean:    { primary: '#0EA5E9', background: '#E0F2FE', text: '#0C4A6E', label: 'Ocean',    meta: 'Legacy preset' },
  midnight: { primary: '#60A5FA', background: '#1E293B', text: '#CBD5E1', label: 'Midnight', meta: 'Legacy preset' },
  ember:    { primary: '#F97316', background: '#292524', text: '#D6D3D1', label: 'Ember',    meta: 'Legacy preset' },
  neon:     { primary: '#22D3EE', background: '#18181B', text: '#E4E4E7', label: 'Neon',     meta: 'Legacy preset' },
  plum:     { primary: '#A78BFA', background: '#1C1917', text: '#D4D4D8', label: 'Plum',     meta: 'Legacy preset' }
};

// v4.8.4 — Reconcile the active-card label against the currently-applied
// themeColors. Without this, the HTML-hardcoded "Field Day" sat as the
// active label whenever the user re-opened the popup with a saved-slot
// theme applied, even though the actual JT colors matched the saved slot.
// Order: preset match → saved-slot match → "Custom".
function reconcileActiveThemeLabel(colors, savedThemes) {
  const nameEl = document.getElementById('activeThemeName');
  const metaEl = document.getElementById('activeThemeMeta');
  if (!nameEl || !metaEl || !colors) return;

  const norm = c => (c || '').toLowerCase();
  const cp = norm(colors.primary), cb = norm(colors.background), ct = norm(colors.text);

  // Try presets first (cheap and most common)
  const matchedPreset = Object.entries(PRESET_THEMES).find(([_k, p]) =>
    norm(p.primary) === cp && norm(p.background) === cb && norm(p.text) === ct
  );
  if (matchedPreset) {
    const [presetKey, preset] = matchedPreset;
    nameEl.textContent = preset.label || presetKey;
    metaEl.textContent = preset.meta || '';
    document.querySelectorAll('.preset[data-preset]').forEach(btn => {
      btn.classList.toggle('is-current', btn.dataset.preset === presetKey);
    });
    return;
  }

  // Try saved-theme slots
  if (Array.isArray(savedThemes)) {
    const slotIdx = savedThemes.findIndex(t => t && t.colors &&
      norm(t.colors.primary) === cp &&
      norm(t.colors.background) === cb &&
      norm(t.colors.text) === ct
    );
    if (slotIdx !== -1 && savedThemes[slotIdx]) {
      nameEl.textContent = savedThemes[slotIdx].name || `Theme ${slotIdx + 1}`;
      metaEl.textContent = `Saved · slot ${slotIdx + 1}`;
      document.querySelectorAll('.preset.is-current').forEach(p => p.classList.remove('is-current'));
      return;
    }
  }

  // Custom colors — neither preset nor saved slot
  nameEl.textContent = 'Custom';
  metaEl.textContent = 'Custom palette';
  document.querySelectorAll('.preset.is-current').forEach(p => p.classList.remove('is-current'));
}

// Load a preset theme — updates pickers, applies, and saves
async function loadPresetTheme(presetKey) {
  const preset = PRESET_THEMES[presetKey];
  if (!preset) return;

  const colors = { primary: preset.primary, background: preset.background, text: preset.text };

  // Update the pickers
  loadThemeColors(colors);

  // Apply and save in one step (same as applyTheme)
  await applyTheme();

  // Highlight the active circle (legacy) and the new preset card
  document.querySelectorAll('.preloaded-theme-circle').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.preset === presetKey);
  });
  document.querySelectorAll('.preset[data-preset]').forEach(btn => {
    btn.classList.toggle('is-current', btn.dataset.preset === presetKey);
  });

  // v4.8 active card label/meta
  const nameEl = document.getElementById('activeThemeName');
  const metaEl = document.getElementById('activeThemeMeta');
  if (nameEl) nameEl.textContent = preset.label || presetKey;
  if (metaEl) metaEl.textContent = preset.meta || '';

  showStatus(`Loaded "${preset.label || presetKey}" theme`, 'success');
}

// Load saved themes into slots
function loadSavedThemes(savedThemes) {
  savedThemes.forEach((theme, index) => {
    const themeName = document.getElementById(`themeName${index}`);
    const slotPrimary = document.getElementById(`slot${index}Primary`);
    const slotBackground = document.getElementById(`slot${index}Background`);
    const slotText = document.getElementById(`slot${index}Text`);
    const loadBtn = document.querySelector(`[data-slot="${index}"].load-theme-btn`);

    // Skip if elements don't exist (theme tab may have different structure)
    if (!themeName || !slotPrimary || !slotBackground || !slotText) {
      return;
    }

    if (theme) {
      // Theme exists - show load button
      themeName.value = theme.name || `Theme ${index + 1}`;
      slotPrimary.style.backgroundColor = theme.colors.primary;
      slotBackground.style.backgroundColor = theme.colors.background;
      slotText.style.backgroundColor = theme.colors.text;

      if (loadBtn) loadBtn.style.display = 'inline-block';
    } else {
      // No theme saved
      themeName.value = '';
      themeName.placeholder = `Theme ${index + 1}`;
      slotPrimary.style.backgroundColor = '#f3f4f6';
      slotBackground.style.backgroundColor = '#f3f4f6';
      slotText.style.backgroundColor = '#f3f4f6';

      if (loadBtn) loadBtn.style.display = 'none';
    }
  });
}

/**
 * Pull saved palettes from the server and merge with local. Server
 * wins per slot (last-write-wins by way of the upsert at save time —
 * server's row reflects whichever device saved most recently). Returns
 * the merged 3-slot array, also written back to chrome.storage.sync
 * for offline use.
 *
 * No-op + returns the local array unchanged when:
 *   - CustomThemeApi or AccountService is not available
 *   - The user is not logged in
 *   - The server fetch fails (network, auth, etc.) — local wins
 */
async function syncSavedThemesFromServer(localSavedThemes) {
  // Always start from a 3-slot array so callers can index safely.
  const merged = Array.isArray(localSavedThemes) && localSavedThemes.length === 3
    ? [...localSavedThemes]
    : [null, null, null];

  if (!window.CustomThemeApi || !window.CustomThemeApi.isAvailable()) {
    return merged;
  }

  try {
    const serverThemes = await window.CustomThemeApi.list();
    if (!Array.isArray(serverThemes)) return merged;

    // Server entries replace whatever was local at that slot. Slots
    // missing from the server response are NOT cleared — the client
    // may have unsynced local saves we don't want to drop.
    for (const t of serverThemes) {
      if (!t || !Number.isInteger(t.slotIndex)) continue;
      if (t.slotIndex < 0 || t.slotIndex > 2) continue;
      merged[t.slotIndex] = {
        name: t.name,
        colors: {
          primary: t.primary,
          background: t.background,
          text: t.text
        }
      };
    }

    // Cache merged result for offline use. Read-modify-write the full
    // settings blob since other code paths use the same key.
    const result = await chrome.storage.sync.get(['jtToolsSettings']);
    const settings = result.jtToolsSettings || defaultSettings;
    settings.savedThemes = merged;
    await chrome.storage.sync.set({ jtToolsSettings: settings });
  } catch (err) {
    console.warn('CustomTheme: server sync failed, using local copy:', err && err.message);
  }

  return merged;
}

// Save theme to slot
async function saveThemeToSlot(slotIndex) {
  try {
    const result = await chrome.storage.sync.get(['jtToolsSettings']);
    const settings = result.jtToolsSettings || defaultSettings;

    const themeName = document.getElementById(`themeName${slotIndex}`).value || `Theme ${slotIndex + 1}`;
    const colors = getCurrentThemeColors();

    if (!settings.savedThemes) {
      settings.savedThemes = [null, null, null];
    }

    settings.savedThemes[slotIndex] = {
      name: themeName,
      colors: colors
    };

    await chrome.storage.sync.set({ jtToolsSettings: settings });
    console.log(`Theme saved to slot ${slotIndex}:`, settings.savedThemes[slotIndex]);

    // Update the slot display
    loadSavedThemes(settings.savedThemes);

    // Dual-write to server when logged in. Local save above is the
    // source of truth; server failure surfaces as a soft warning so
    // the user knows sync didn't take, but we don't roll back.
    let syncWarning = null;
    if (window.CustomThemeApi && window.CustomThemeApi.isAvailable()) {
      try {
        await window.CustomThemeApi.save({
          slotIndex,
          name: themeName,
          primary: colors.primary,
          background: colors.background,
          text: colors.text
        });
      } catch (err) {
        console.warn('CustomTheme: server save failed:', err && err.message);
        syncWarning = err && err.message ? err.message : 'sync failed';
      }
    }

    if (syncWarning) {
      showStatus(`Saved locally — sync failed: ${syncWarning}`, 'error');
    } else {
      showStatus(`Theme saved to slot ${slotIndex + 1}!`, 'success');
    }
  } catch (error) {
    console.error('Error saving theme:', error);
    showStatus('Error saving theme', 'error');
  }
}

// Load theme from slot
async function loadThemeFromSlot(slotIndex) {
  try {
    const result = await chrome.storage.sync.get(['jtToolsSettings']);
    const settings = result.jtToolsSettings || defaultSettings;

    if (settings.savedThemes && settings.savedThemes[slotIndex]) {
      const theme = settings.savedThemes[slotIndex];
      loadThemeColors(theme.colors);
      // v4.8.4 — Update active-card label to reflect the loaded slot.
      reconcileActiveThemeLabel(theme.colors, settings.savedThemes);
      showStatus(`Loaded "${theme.name}"`, 'success');
    }
  } catch (error) {
    console.error('Error loading theme:', error);
    showStatus('Error loading theme', 'error');
  }
}

/**
 * Render the Features-tab categories from the single source of truth
 * (JTDefaults.FEATURE_CATEGORIES). Reparents the existing static .feature-item
 * nodes into category sections in the defined order and sets each count
 * dynamically — so categories, order, and counts all derive from one
 * definition and never drift (kills the hardcoded-count bug). Any feature row
 * not listed in a category is kept (appended to a "More" section) so nothing is
 * ever hidden. Moving the existing nodes (not regenerating them) preserves each
 * toggle's id and all the load/save wiring that references it by id.
 */
function renderFeatureCategories() {
  const section = document.querySelector('#tab-features .features-section');
  const cats = window.JTDefaults && window.JTDefaults.FEATURE_CATEGORIES;
  if (!section || !Array.isArray(cats)) return; // defensive: fall back to static HTML

  // Index every feature toggle row by its feature id, wherever it lives now.
  const itemsById = {};
  section.querySelectorAll('.feature-item').forEach(item => {
    const input = item.querySelector('input[data-feature]');
    if (input) itemsById[input.dataset.feature] = item;
  });

  const buildSection = (id, title, ids) => {
    const wrap = document.createElement('div');
    wrap.className = 'feature-category';

    const header = document.createElement('div');
    header.className = 'category-header collapsed';
    header.dataset.category = id;
    // No icon on group headers — each row carries its own now, and a second
    // icon on the header just competed with them.
    const titleEl = document.createElement('span');
    titleEl.className = 'category-title';
    titleEl.textContent = title;
    const countEl = document.createElement('span');
    countEl.className = 'category-count';
    const toggle = document.createElement('span');
    toggle.className = 'category-toggle';
    toggle.textContent = '▼';
    header.append(titleEl, countEl, toggle);

    const body = document.createElement('div');
    body.className = 'category-features collapsed';
    body.dataset.categoryContent = id;

    let count = 0;
    ids.forEach(fid => {
      const item = itemsById[fid];
      if (item) { body.appendChild(item); delete itemsById[fid]; count++; }
    });
    countEl.textContent = String(count);

    wrap.append(header, body);
    return wrap;
  };

  const frag = document.createDocumentFragment();
  cats.forEach(cat => {
    if (cat && cat.id && Array.isArray(cat.features)) {
      frag.appendChild(buildSection(cat.id, cat.title || cat.id, cat.features));
    }
  });

  // Safety net: any toggle not assigned to a category still gets shown.
  const orphanIds = Object.keys(itemsById);
  if (orphanIds.length) {
    console.warn('renderFeatureCategories: uncategorized feature toggles:', orphanIds);
    frag.appendChild(buildSection('more', 'More', orphanIds));
  }

  // Replace the old static category sections with the rebuilt ones, mounted
  // right after the master-toggle bar.
  section.querySelectorAll('.feature-category').forEach(el => el.remove());
  const masterBar = section.querySelector('.master-toggle-bar');
  if (masterBar) masterBar.after(frag);
  else section.appendChild(frag);
}

// Initialize popup
// Initialize collapsible category functionality
function initializeCategories() {
  // Get all category headers
  const categoryHeaders = document.querySelectorAll('.category-header');

  categoryHeaders.forEach(header => {
    header.addEventListener('click', () => {
      const category = header.dataset.category;
      const content = document.querySelector(`[data-category-content="${category}"]`);

      // Toggle collapsed state
      header.classList.toggle('collapsed');
      content.classList.toggle('collapsed');

      // Save state to chrome.storage.local
      chrome.storage.local.set({
        [`category_${category}_collapsed`]: header.classList.contains('collapsed')
      });
    });

    // Restore state from storage - expand if previously expanded
    const category = header.dataset.category;
    chrome.storage.local.get(`category_${category}_collapsed`, (result) => {
      // If user previously expanded it (collapsed = false), expand it
      if (result[`category_${category}_collapsed`] === false) {
        header.classList.remove('collapsed');
        const content = document.querySelector(`[data-category-content="${category}"]`);
        if (content) {
          content.classList.remove('collapsed');
        }
      }
      // Otherwise, keep default collapsed state (no action needed)
    });
  });
}

/**
 * Initialize feature help icon click handlers
 * Opens the relevant guide page when clicked
 */
function initFeatureHelpLinks() {
  const baseUrl = 'https://jtpowertools.com/guides/';

  document.querySelectorAll('.feature-help[data-guide]').forEach(helpIcon => {
    helpIcon.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation(); // Prevent toggle from being triggered

      const guideName = helpIcon.dataset.guide;
      if (guideName) {
        chrome.tabs.create({ url: `${baseUrl}${guideName}.html` });
      }
    });
  });
}

/**
 * Names of init steps that failed this session. Read by the diagnostics panel.
 * @type {string[]}
 */
window.JTPopupInitFailures = [];

/**
 * Run one popup-initialisation step without letting it take down the rest.
 *
 * Startup used to be a bare chain of awaits, so the first step that threw
 * ended the whole handler and everything below it silently never ran. In
 * Orion, `chrome.storage.sync` is not implemented: one unguarded read threw,
 * and because `initAccountUI()` is further down the chain, the popup opened
 * with no login form, no feature list and no way to recover — from a single
 * missing API on one browser.
 *
 * A step that fails now loses only itself. The failure is recorded rather than
 * swallowed, so the diagnostics panel can name it instead of leaving someone
 * to guess which part of the popup is missing and why.
 *
 * @param {string} name - step name, as it should appear in diagnostics
 * @param {() => any} fn - the step
 * @param {*} [fallback] - value to return if it throws
 */
async function safeInitStep(name, fn, fallback = undefined) {
  try {
    return await fn();
  } catch (err) {
    window.JTPopupInitFailures.push(name);
    console.error(`JT Power Tools: popup init step "${name}" failed (continuing):`, err);
    return fallback;
  }
}

document.addEventListener('DOMContentLoaded', async () => {
  console.log('JT Power Tools popup loaded');

  // NOTE: the diagnostics trigger is NOT wired here. popup/diagnostics.js
  // attaches it itself, from a script that loads before this one, because a
  // listener registered inside this DOMContentLoaded chain is unreachable in
  // the exact case the panel exists to diagnose — one unsupported API aborting
  // the chain before this line is ever reached. Adding a second listener here
  // would also toggle the panel twice per tap, which looks like a dead button.

  // Keep the popup version label in sync with the manifest so it never drifts.
  const versionEl = document.querySelector('.version');
  if (versionEl && chrome.runtime?.getManifest) {
    versionEl.textContent = `v${chrome.runtime.getManifest().version}`;
  }

  const urlParams = new URLSearchParams(window.location.search);
  if (IS_IN_SIDE_PANEL) {
    document.body.classList.add('in-sidepanel');
  }

  // Check for password reset token in URL
  const resetToken = urlParams.get('reset_token');
  if (resetToken) {
    console.log('Password reset token detected, showing reset form');
    // We'll show the reset form after account UI is initialized
    window.pendingResetToken = resetToken;
  }

  // Initialize popup theme first (before any other UI updates)
  await safeInitStep('theme', initPopupTheme);

  // Setup theme toggle button
  document.getElementById('popupThemeToggle').addEventListener('click', togglePopupTheme);

  // Setup tab navigation
  initTabNavigation();

  // Check license status first (just UI, don't modify settings)
  // Falls back to a free-tier shape: a popup showing fewer features beats
  // one showing none because tier resolution threw.
  const licenseStatus = await safeInitStep('license', checkLicenseStatus, { hasLicense: false, tier: null });
  const { hasLicense, tier } = licenseStatus;

  // Re-check the plan with Gumroad in the background. Opening the popup is the
  // clearest "did my upgrade land yet?" signal we get, and waiting out the
  // background interval meant a customer could pay and still see their new
  // features locked. Deliberately not awaited — the popup renders against the
  // tier we already know, and re-gates below only if the answer changed.
  // Throttled to once a minute inside forceRevalidate().
  if (hasLicense && typeof LicenseService?.forceRevalidate === 'function') {
    LicenseService.forceRevalidate()
      .then(async (result) => {
        if (!result?.changed) return;
        console.log('Popup: plan changed to', result.tier, '— re-gating');
        await refreshLicenseGating();
        await updateAccountUI();
      })
      .catch((err) => console.error('Popup: plan re-check failed:', err));
  }

  // Check API status
  await safeInitStep('api-status', checkApiStatus);

  // Reorganize the Features tab into categories from the single source of
  // truth BEFORE loading settings / wiring categories (it reparents existing
  // toggle rows, so ids — and their load/save wiring — are preserved).
  renderFeatureCategories();

  // Load current settings and update UI
  await safeInitStep('settings', loadSettings);

  // Initialize master toggle (after settings are loaded)
  await safeInitStep('master-toggle', initMasterToggle);

  // Initialize collapsible categories
  initializeCategories();

  // Feature help icons. Two handlers, deliberately:
  //   FeatureGuide.init()      — [data-guide-for] icons open the in-popup
  //                              guide sheet and stamp the API chips.
  //   initFeatureHelpLinks()   — the older [data-guide] icons, which still
  //                              open the docs site in a new tab. Only the
  //                              on-hold Files Drag to Folder row uses this
  //                              path now; it is left untouched on purpose.
  if (window.FeatureGuide) window.FeatureGuide.init();
  initFeatureHelpLinks();

  // Initialize Job Email card — Power User + active tab on /jobs/<id>.
  // Fire-and-forget so it doesn't block the rest of popup init.
  initJobEmailCard(tier).catch((err) => console.error('JobEmail card init failed:', err));

  // Determine if user has access to different tiers
  const hasProFeatures = hasLicense && LicenseService.tierAtLeast(tier, LicenseService.TIERS.PRO);
  const hasEssentialFeatures = hasLicense && LicenseService.tierAtLeast(tier, LicenseService.TIERS.ESSENTIAL);

  // If no license, ensure licensed features stay disabled
  // Merge with defaults first so FREE features (formatter, darkMode, etc.)
  // are always preserved even if stored settings are incomplete
  // The exact line that blanked the popup in Orion: unguarded, with every
  // remaining step — the account UI included — sitting below it.
  const currentSettingsResult = await safeInitStep(
    'read-settings', () => chrome.storage.sync.get(['jtToolsSettings']), {});
  const mergedCurrentSettings = (typeof JTDefaults !== 'undefined' && JTDefaults.mergeWithDefaults)
    ? JTDefaults.mergeWithDefaults(currentSettingsResult.jtToolsSettings)
    : { ...defaultSettings, ...(currentSettingsResult.jtToolsSettings || {}) };

  if (currentSettingsResult.jtToolsSettings) {
    let needsUpdate = false;
    const updatedSettings = { ...mergedCurrentSettings };

    // PRO features require Pro or Power User tier
    if (!hasProFeatures) {
      if (updatedSettings.dragDrop || updatedSettings.rgbTheme || updatedSettings.previewMode || updatedSettings.availabilityFilter) {
        console.log('Disabling PRO features - tier:', tier);
        updatedSettings.dragDrop = false;
        updatedSettings.rgbTheme = false;
        updatedSettings.previewMode = false;
        updatedSettings.availabilityFilter = false;
        needsUpdate = true;
      }
    }

    // ESSENTIAL features require Essential, Pro, or Power User tier
    if (!hasEssentialFeatures) {
      if (updatedSettings.quickNotes || updatedSettings.smartJobSwitcher ||
          updatedSettings.freezeHeader || updatedSettings.pdfMarkupTools) {
        console.log('Disabling ESSENTIAL features - tier:', tier);
        updatedSettings.quickNotes = false;
        updatedSettings.smartJobSwitcher = false;
        updatedSettings.freezeHeader = false;
        updatedSettings.pdfMarkupTools = false;
        needsUpdate = true;
      }
    }

    if (needsUpdate) {
      await safeInitStep('write-settings',
        () => chrome.storage.sync.set({ jtToolsSettings: updatedSettings }));
    }
  }

  // Listen for API key test (if elements exist — moved to portal)
  const testApiBtn = document.getElementById('testApiBtn');
  if (testApiBtn) testApiBtn.addEventListener('click', testApiKey);
  const apiKeyEl = document.getElementById('apiKey');
  if (apiKeyEl) apiKeyEl.addEventListener('keypress', (e) => { if (e.key === 'Enter') testApiKey(); });
  const orgIdEl = document.getElementById('orgId');
  if (orgIdEl) orgIdEl.addEventListener('keypress', (e) => { if (e.key === 'Enter') testApiKey(); });

  // Listen for license verification (if elements exist — moved to portal)
  const verifyBtn = document.getElementById('verifyBtn');
  const licenseKeyInput = document.getElementById('licenseKey');
  if (verifyBtn) verifyBtn.addEventListener('click', verifyLicenseKey);
  if (licenseKeyInput) {
    licenseKeyInput.addEventListener('keypress', (e) => {
      if (e.key === 'Enter') verifyLicenseKey();
    });
  }

  // Initialize account UI
  // Last, and the one that matters most: without this there is no login
  // form, so nothing above may be allowed to prevent it running.
  await safeInitStep('account-ui', initAccountUI);

  // Dark Mode's 4-step control. Bound before the checkbox listener below so a
  // step click has a listener to fire into.
  initDarkModeSteps();

  // Listen for checkbox changes (skip master toggle — handled separately)
  const checkboxes = document.querySelectorAll('input[type="checkbox"]:not(#masterToggle)');
  checkboxes.forEach(checkbox => {
    checkbox.addEventListener('change', async () => {
      console.log('Checkbox changed:', checkbox.id, checkbox.checked);

      // Handle mutual exclusivity for appearance modes
      if (checkbox.checked) {
        const darkModeEl = document.getElementById('darkMode');
        const rgbThemeEl = document.getElementById('rgbTheme');
        const contrastFixEl = document.getElementById('contrastFix');

        if (checkbox.id === 'contrastFix') {
          // Contrast Fix enabled - disable Dark Mode and RGB Theme
          if (darkModeEl) darkModeEl.checked = false;
          if (rgbThemeEl) rgbThemeEl.checked = false;
        } else if (checkbox.id === 'darkMode') {
          // Dark Mode enabled - disable Contrast Fix and RGB Theme
          if (contrastFixEl) contrastFixEl.checked = false;
          if (rgbThemeEl) rgbThemeEl.checked = false;
        } else if (checkbox.id === 'rgbTheme') {
          // RGB Theme enabled - disable Contrast Fix and Dark Mode
          if (contrastFixEl) contrastFixEl.checked = false;
          if (darkModeEl) darkModeEl.checked = false;
        }

        // Dark Mode's step control mirrors the checkbox, so it has to be
        // repainted whenever the exclusion above turns Dark Mode off.
        syncDarkModeSteps();
      }

      // If the user just enabled a feature that needs a grant key but
      // hasn't registered a portal account yet (legacy state), nudge
      // them to register instead of leaving them to discover the gap
      // via a forgot-password email that never arrives. Non-blocking —
      // the toggle proceeds, the feature just won't work until they
      // register and configure a grant key.
      if (checkbox.checked && GRANT_KEY_REQUIRED_FEATURES.has(checkbox.id)) {
        maybeShowRegisterNudge().catch(err => console.error('Register nudge error:', err));
      }

      // Get current settings from checkboxes
      const settings = await getCurrentSettings();

      // Save settings (this will handle theme panel visibility)
      await saveSettings(settings);
    });
  });

  // Listen for color picker changes
  const colorPickers = [
    { picker: 'primaryColorPicker', value: 'primaryColorValue' },
    { picker: 'backgroundColorPicker', value: 'backgroundColorValue' },
    { picker: 'textColorPicker', value: 'textColorValue' }
  ];

  colorPickers.forEach(({ picker, value }) => {
    const pickerEl = document.getElementById(picker);
    const valueEl = document.getElementById(value);
    if (pickerEl) {
      pickerEl.addEventListener('input', (e) => {
        if (valueEl) valueEl.textContent = e.target.value.toUpperCase();
        updateThemePreview();
      });
    }
  });

  // Listen for apply theme button
  const applyThemeBtn = document.getElementById('applyThemeBtn');
  if (applyThemeBtn) {
    applyThemeBtn.addEventListener('click', applyTheme);
  }

  // Listen for customize button to toggle theme customization panel (if it exists)
  const customizeThemeBtn = document.getElementById('customizeThemeBtn');
  if (customizeThemeBtn) {
    customizeThemeBtn.addEventListener('click', () => {
      const themeCustomization = document.getElementById('themeCustomization');
      const isVisible = themeCustomization && themeCustomization.style.display === 'block';

      if (themeCustomization) {
        if (isVisible) {
          themeCustomization.style.display = 'none';
          customizeThemeBtn.classList.remove('expanded');
        } else {
          themeCustomization.style.display = 'block';
          customizeThemeBtn.classList.add('expanded');
        }
      }
    });
  }

  // Listen for preset theme circles
  document.querySelectorAll('.preloaded-theme-circle').forEach(btn => {
    btn.addEventListener('click', () => {
      loadPresetTheme(btn.dataset.preset);
    });
  });

  // Listen for save theme buttons
  document.querySelectorAll('.save-theme-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
      const slotIndex = parseInt(e.target.dataset.slot);
      saveThemeToSlot(slotIndex);
    });
  });

  // Listen for load theme buttons
  document.querySelectorAll('.load-theme-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
      const slotIndex = parseInt(e.target.dataset.slot);
      loadThemeFromSlot(slotIndex);
    });
  });

  // Listen for refresh button
  const refreshBtn = document.getElementById('refreshBtn');
  if (refreshBtn) {
    refreshBtn.addEventListener('click', refreshCurrentTab);
  }

  // Open-in-sidebar button: only shown in popup context, only if the browser has a
  // side-panel/sidebar API. Chrome uses chrome.sidePanel.open({windowId}) — we pre-fetch
  // windowId so the click handler stays synchronous and preserves the user-gesture
  // activation. Firefox uses browser.sidebarAction.open() (no windowId, must be called
  // synchronously in the gesture), wired directly without the pre-fetch.
  const openInSidebarBtn = document.getElementById('openInSidebarBtn');
  if (openInSidebarBtn) {
    if (IS_IN_SIDE_PANEL || (!HAS_CHROME_SIDEPANEL && !HAS_FIREFOX_SIDEBAR)) {
      openInSidebarBtn.style.display = 'none';
    } else if (HAS_CHROME_SIDEPANEL) {
      chrome.windows.getCurrent().then(win => {
        openInSidebarBtn.addEventListener('click', () => openInSidebar(win.id));
      }).catch(err => {
        console.error('Could not resolve current window for sidebar button:', err);
        openInSidebarBtn.style.display = 'none';
      });
    } else {
      openInSidebarBtn.addEventListener('click', () => openInSidebarFirefox());
    }
  }

  // "Always open in side panel" preference. Device-local; the service worker
  // reads it and flips the toolbar-icon behavior (popup vs side panel). Hidden
  // when the browser has no side-panel API. Rendered in both the popup and the
  // side panel, so the user can always toggle it back off.
  const sidePanelPref = document.getElementById('alwaysOpenInSidePanel');
  const sidePanelPrefItem = document.getElementById('sidePanelPrefItem');
  if (sidePanelPref) {
    if (!chrome.sidePanel || typeof chrome.sidePanel.open !== 'function') {
      if (sidePanelPrefItem) sidePanelPrefItem.style.display = 'none';
    } else {
      chrome.storage.local.get('openInSidePanel').then(({ openInSidePanel }) => {
        sidePanelPref.checked = !!openInSidePanel;
      });
      sidePanelPref.addEventListener('change', () => {
        const enabled = sidePanelPref.checked;
        chrome.storage.local.set({ openInSidePanel: enabled });
        showStatus(
          enabled
            ? 'Side panel set as default — click the toolbar icon to open it'
            : 'Toolbar icon will open the popup',
          'success'
        );
      });
    }
  }

  // ── v4.8 Theme rebuild — preset cards, extras pills, auto-nudge ──
  document.querySelectorAll('.preset[data-preset]').forEach(btn => {
    btn.addEventListener('click', () => {
      loadPresetTheme(btn.dataset.preset);
    });
  });

  const autoFixBtn = document.getElementById('autoFixBtn');
  if (autoFixBtn) autoFixBtn.addEventListener('click', autoNudgeToAA);

  const randomBtn = document.getElementById('randomHarmonizedBtn');
  if (randomBtn) randomBtn.addEventListener('click', randomHarmonizedTheme);

  // Initial paint of the v4.8 reactive UI (after pickers are populated)
  setTimeout(() => refreshThemeRebuildUI(), 0);

  // Initialize AI Integration section
  await initAiIntegration();

  // Initialize MCP tab
  await initMcpTab();
});

// ===================================
// AI Integration Section
// ===================================

// MCP Server URL - uses workers.dev (same account as main worker)
const MCP_SERVER_URL = 'https://jobtread-mcp-server.king0light-ai.workers.dev';

const AI_PLATFORMS = {
  claude: {
    name: 'Claude Desktop',
    icon: '🟣',
    instructions: `<ol>
      <li>Install mcp-remote: <code>npm install -g mcp-remote</code></li>
      <li>Open Claude Desktop → <strong>Settings → Developer</strong></li>
      <li>Click <strong>Edit Config</strong></li>
      <li>Add the entry below inside your <code>mcpServers</code> object</li>
      <li>Save and restart Claude Desktop</li>
    </ol>
    <p style="margin-top:8px;font-size:11px;color:#888;">
      <strong>Note:</strong> Replace <code>YOUR_NPM_PATH</code> with your npm global path
    </p>`,
    filePath: 'Config: <code>claude_desktop_config.json</code>',
    configType: 'mcp-remote'
  },
  claudeCode: {
    name: 'Claude Code (CLI)',
    icon: '🟣',
    instructions: `<ol>
      <li>Open your Claude Code settings file</li>
      <li>Add the entry below inside your <code>mcpServers</code> object</li>
      <li>Save and restart Claude Code</li>
    </ol>
    <p style="margin-top:8px;font-size:11px;color:#888;">
      Claude Code supports HTTP directly - no mcp-remote needed
    </p>`,
    filePath: 'Config: <code>~/.claude/settings.json</code>',
    configType: 'http'
  },
  chatgpt: {
    name: 'ChatGPT',
    icon: '🟢',
    instructions: `<ol>
      <li>Open ChatGPT settings</li>
      <li>Go to <strong>Features → MCP Servers</strong></li>
      <li>Click <strong>Add Server</strong></li>
      <li>Use SSE endpoint with your credentials</li>
    </ol>`,
    filePath: `Endpoint: <code>${MCP_SERVER_URL}/sse</code>`,
    configType: 'sse'
  },
  cursor: {
    name: 'Cursor IDE',
    icon: '🔵',
    instructions: `<ol>
      <li>Open Cursor settings (<code>Cmd/Ctrl + ,</code>)</li>
      <li>Search for <strong>MCP</strong></li>
      <li>Add new MCP server with config below</li>
      <li>Restart Cursor</li>
    </ol>`,
    filePath: 'Config file: <code>~/.cursor/mcp.json</code>',
    configType: 'http'
  },
  other: {
    name: 'Other MCP Clients',
    icon: '⚪',
    instructions: `<ol>
      <li>Use <strong>HTTP endpoint</strong> for request/response clients</li>
      <li>Use <strong>SSE endpoint</strong> for streaming clients</li>
      <li>Auth format: <code>Bearer LICENSE:GRANT_KEY</code></li>
    </ol>`,
    filePath: `HTTP: <code>/message</code> | SSE: <code>/sse</code>`,
    configType: 'both'
  }
};

/**
 * Initialize AI Integration section
 */
async function initAiIntegration() {
  const aiSection = document.getElementById('aiIntegrationSection');
  if (!aiSection) return;

  // Check if user has Power User tier
  const tier = await LicenseService.getTier();
  const hasPowerUser = tier && LicenseService.tierHasFeature(tier, 'customFieldFilter');

  if (!hasPowerUser) {
    aiSection.style.display = 'none';
    return;
  }

  // Show the section for Power Users
  aiSection.style.display = 'block';

  // Setup platform tab switching
  setupPlatformTabs();

  // Setup copy button
  setupCopyButton();

  // Setup test connection button
  setupTestConnection();

  // Load initial config for default platform (Claude)
  updateConfigDisplay('claude');

  // Check connection status
  await checkAiConnectionStatus();
}

/**
 * Setup platform tab switching
 */
function setupPlatformTabs() {
  const tabs = document.querySelectorAll('.platform-tab');

  tabs.forEach(tab => {
    tab.addEventListener('click', () => {
      // Remove active from all tabs
      tabs.forEach(t => t.classList.remove('active'));

      // Add active to clicked tab
      tab.classList.add('active');

      // Update config display
      const platform = tab.dataset.platform;
      updateConfigDisplay(platform);
    });
  });
}

/**
 * Update config display based on selected platform
 */
async function updateConfigDisplay(platform) {
  const platformConfig = AI_PLATFORMS[platform];
  if (!platformConfig) return;

  // Update instructions
  const instructionsEl = document.getElementById('configInstructions');
  instructionsEl.innerHTML = platformConfig.instructions;

  // Update file path hint
  const filePathEl = document.getElementById('configFilePath');
  filePathEl.innerHTML = platformConfig.filePath;

  // Generate and display config JSON
  const configCode = document.getElementById('configCode');
  const config = await generateConfigJson(platform);
  configCode.textContent = config;
}

/**
 * Generate MCP config JSON with user's credentials
 */
async function generateConfigJson(platform) {
  // Get user's license key and grant key
  const licenseData = await LicenseService.getLicenseData();
  const licenseKey = licenseData?.key || 'YOUR_LICENSE_KEY';

  // Get grant key from Pro Service (obfuscated storage)
  let grantKey = 'YOUR_GRANT_KEY';
  try {
    const isConfigured = await JobTreadProService.isConfigured();
    if (isConfigured) {
      const storedGrantKey = await JobTreadProService.getGrantKey();
      if (storedGrantKey) {
        grantKey = storedGrantKey;
      }
    }
  } catch (e) {
    // Grant key retrieval failed — config will show placeholder
  }

  const authToken = `${licenseKey}:${grantKey}`;
  const platformConfig = AI_PLATFORMS[platform];

  if (platform === 'other') {
    // Show both endpoints for "Other" clients
    return JSON.stringify({
      'mcpServers': {
        'jobtread': {
          'comment': 'Use HTTP for request/response, SSE for streaming',
          'http_url': `${MCP_SERVER_URL}/message`,
          'sse_url': `${MCP_SERVER_URL}/sse`,
          'headers': {
            'Authorization': `Bearer ${authToken}`
          }
        }
      }
    }, null, 2);
  }

  if (platformConfig.configType === 'sse') {
    // SSE config for ChatGPT
    return JSON.stringify({
      'mcpServers': {
        'jobtread': {
          'type': 'sse',
          'url': `${MCP_SERVER_URL}/sse`,
          'headers': {
            'Authorization': `Bearer ${authToken}`
          }
        }
      }
    }, null, 2);
  }

  // Claude Desktop - uses mcp-remote bridge for remote servers
  // Claude Desktop only supports local stdio servers, so we need mcp-remote as a bridge
  if (platform === 'claude') {
    const serverConfig = {
      'command': 'node',
      'args': [
        'YOUR_NPM_PATH/node_modules/mcp-remote/dist/proxy.js',
        `${MCP_SERVER_URL}/sse`,
        '--header',
        `Authorization: Bearer ${authToken}`
      ]
    };
    // Add helpful comment about finding npm path
    const configStr = JSON.stringify(serverConfig, null, 2);
    const helpComment = `// Find YOUR_NPM_PATH by running: npm root -g
// Windows: Usually C:/Users/USERNAME/AppData/Roaming/npm
// Mac/Linux: Usually /usr/local/lib or ~/.npm-global

`;
    return helpComment + `"jobtread": ${configStr}`;
  }

  // Claude Code (CLI) - supports HTTP directly
  if (platform === 'claudeCode') {
    const serverConfig = {
      'type': 'http',
      'url': `${MCP_SERVER_URL}/message`,
      'headers': {
        'Authorization': `Bearer ${authToken}`
      }
    };
    return `"jobtread": ${JSON.stringify(serverConfig, null, 2)}`;
  }

  // HTTP config for Cursor, etc.
  return JSON.stringify({
    'mcpServers': {
      'jobtread': {
        'type': 'http',
        'url': `${MCP_SERVER_URL}/message`,
        'headers': {
          'Authorization': `Bearer ${authToken}`
        }
      }
    }
  }, null, 2);
}

/**
 * Setup copy to clipboard button
 */
function setupCopyButton() {
  const copyBtn = document.getElementById('copyConfigBtn');
  if (!copyBtn) return;

  copyBtn.addEventListener('click', async () => {
    const configCode = document.getElementById('configCode');
    const configText = configCode.textContent;

    try {
      await navigator.clipboard.writeText(configText);

      // Show copied state
      copyBtn.classList.add('copied');
      const copyText = copyBtn.querySelector('.copy-text');
      const copyIcon = copyBtn.querySelector('.copy-icon');
      copyText.textContent = 'Copied!';
      copyIcon.textContent = '✓';

      // Reset after 2 seconds
      setTimeout(() => {
        copyBtn.classList.remove('copied');
        copyText.textContent = 'Copy';
        copyIcon.textContent = '📋';
      }, 2000);
    } catch (err) {
      showStatus('Failed to copy to clipboard', 'error');
    }
  });
}

/**
 * Setup test connection button
 */
function setupTestConnection() {
  const testBtn = document.getElementById('testAiConnectionBtn');
  if (!testBtn) return;

  testBtn.addEventListener('click', async () => {
    testBtn.classList.add('testing');
    testBtn.textContent = 'Testing...';

    try {
      await testMcpConnection();
    } finally {
      testBtn.classList.remove('testing');
      testBtn.textContent = 'Test Connection';
    }
  });
}

/**
 * Test MCP server connection
 */
async function testMcpConnection() {
  const statusIndicator = document.getElementById('aiStatusIndicator');
  const statusText = statusIndicator.querySelector('.status-text');

  try {
    // Test the health endpoint
    const response = await fetch(`${MCP_SERVER_URL}/health`, {
      method: 'GET',
      headers: {
        'Accept': 'application/json'
      }
    });

    if (response.ok) {
      const data = await response.json();

      if (data.status === 'ok') {
        // Server is healthy, now test auth
        await testMcpAuth(statusIndicator, statusText);
      } else {
        setConnectionStatus(statusIndicator, statusText, 'error', 'Server error');
      }
    } else {
      setConnectionStatus(statusIndicator, statusText, 'error', 'Server unavailable');
    }
  } catch (error) {
    setConnectionStatus(statusIndicator, statusText, 'error', 'Connection failed');
  }
}

/**
 * Test MCP authentication with user's grant key
 * Uses session token when available, falls back to raw credentials
 */
async function testMcpAuth(statusIndicator, statusText) {
  try {
    // Get grant key via obfuscated storage
    const grantKey = await JobTreadProService.getGrantKey();

    if (!grantKey) {
      setConnectionStatus(statusIndicator, statusText, 'disconnected', 'Configure Grant Key above first');
      showStatus('Enter your Grant Key in the API section above', 'error');
      return;
    }

    // Prefer session token over raw credentials
    const { token } = await JobTreadProService.getSessionToken();
    if (!token) {
      setConnectionStatus(statusIndicator, statusText, 'error', 'Could not authenticate');
      showStatus('Authentication failed — check your license and grant key', 'error');
      return;
    }

    // Test the tools endpoint with auth
    const response = await fetch(`${MCP_SERVER_URL}/tools`, {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Accept': 'application/json'
      }
    });

    if (response.ok) {
      const data = await response.json();
      setConnectionStatus(statusIndicator, statusText, 'connected',
        `Connected (${data.toolCount || 0} tools)`);
      showStatus('MCP server connected!', 'success');
    } else if (response.status === 401) {
      setConnectionStatus(statusIndicator, statusText, 'error', 'Invalid grant key');
      showStatus('Grant key not recognized', 'error');
    } else if (response.status === 403) {
      setConnectionStatus(statusIndicator, statusText, 'error', 'Org mismatch');
      showStatus('Grant key doesn\'t match your license org', 'error');
    } else {
      setConnectionStatus(statusIndicator, statusText, 'error', 'Connection failed');
    }
  } catch (error) {
    setConnectionStatus(statusIndicator, statusText, 'error', 'Connection failed');
  }
}

/**
 * Check AI connection status on load
 */
async function checkAiConnectionStatus() {
  const statusIndicator = document.getElementById('aiStatusIndicator');
  const statusText = statusIndicator?.querySelector('.status-text');

  if (!statusIndicator || !statusText) return;

  // Check if grant key is configured (via obfuscated storage)
  const grantKey = await JobTreadProService.getGrantKey();

  if (!grantKey) {
    setConnectionStatus(statusIndicator, statusText, 'disconnected', 'Configure Grant Key above');
    return;
  }

  // Grant key is configured, show ready status
  setConnectionStatus(statusIndicator, statusText, 'disconnected', 'Ready - click Test to verify');
}

/**
 * Set connection status display
 */
function setConnectionStatus(indicator, textEl, status, message) {
  indicator.className = `ai-status-indicator ${status}`;
  textEl.textContent = message;
}

// ===================================
// MCP Tab Functionality
// ===================================

/**
 * Initialize MCP tab functionality
 */
async function initMcpTab() {
  // Setup copy URL button
  const copyUrlBtn = document.getElementById('copyMcpUrl');
  if (copyUrlBtn) {
    copyUrlBtn.addEventListener('click', async () => {
      const urlCode = document.getElementById('mcpServerUrl');
      const urlText = urlCode.textContent;

      try {
        await navigator.clipboard.writeText(urlText);

        // Show copied state
        copyUrlBtn.classList.add('copied');
        const icon = copyUrlBtn.querySelector('i');
        icon.className = 'ph ph-check';

        // Reset after 2 seconds
        setTimeout(() => {
          copyUrlBtn.classList.remove('copied');
          icon.className = 'ph ph-copy';
        }, 2000);
      } catch (err) {
        // Clipboard write failed silently
      }
    });
  }

  // Setup Grant Key update button
  const updateGrantKeyBtn = document.getElementById('updateGrantKeyBtn');
  if (updateGrantKeyBtn) {
    updateGrantKeyBtn.addEventListener('click', handleUpdateGrantKey);
  }

  // Setup Grant Key input enter key
  const grantKeyInput = document.getElementById('mcpGrantKeyInput');
  if (grantKeyInput) {
    grantKeyInput.addEventListener('keypress', (e) => {
      if (e.key === 'Enter') handleUpdateGrantKey();
    });
  }

  // Setup Copy MCP Config button
  const copyConfigBtn = document.getElementById('copyMcpConfigBtn');
  if (copyConfigBtn) {
    copyConfigBtn.addEventListener('click', handleCopyMcpConfig);
  }

  // Setup credential copy buttons (grab keys easily)
  const copyLicenseBtn = document.getElementById('copyLicenseKey');
  if (copyLicenseBtn) {
    copyLicenseBtn.addEventListener('click', async () => {
      const licenseData = await LicenseService.getLicenseData();
      if (!licenseData?.key) {
        showStatus('No License Key configured', 'error');
        return;
      }
      try {
        await navigator.clipboard.writeText(licenseData.key);
        copyLicenseBtn.classList.add('copied');
        copyLicenseBtn.querySelector('i').className = 'ph ph-check';
        showStatus('License Key copied!', 'success');
        setTimeout(() => {
          copyLicenseBtn.classList.remove('copied');
          copyLicenseBtn.querySelector('i').className = 'ph ph-copy';
        }, 2000);
      } catch (err) {
        showStatus('Failed to copy', 'error');
      }
    });
  }

  // Setup platform tabs
  initPlatformTabs();

  // Setup tab-link navigation (prerequisite links that switch to other tabs)
  document.querySelectorAll('[data-tab-link]').forEach(link => {
    link.addEventListener('click', (e) => {
      e.preventDefault();
      const targetTab = link.dataset.tabLink;
      const tabBtn = document.querySelector(`.tab-item[data-tab="${targetTab}"]`);
      if (tabBtn) tabBtn.click();
    });
  });

  // Gate setup sections for non-Power Users
  const tier = await LicenseService.getTier();
  const hasPowerUser = tier && LicenseService.tierHasFeature(tier, 'customFieldFilter');

  const upgradeCta = document.getElementById('mcpUpgradeCta');
  const setupSections = document.getElementById('mcpSetupSections');

  if (hasPowerUser) {
    // Power User — show setup, hide CTA
    if (upgradeCta) upgradeCta.style.display = 'none';
    if (setupSections) setupSections.style.display = '';

    // Check MCP credentials and prerequisites
    await updateMcpCredentialsDisplay();
    await updateMcpPrerequisites();
  } else {
    // Non-Power User — show CTA, hide setup
    if (upgradeCta) upgradeCta.style.display = '';
    if (setupSections) setupSections.style.display = 'none';
  }
}

/**
 * Update the MCP credentials display
 */
async function updateMcpCredentialsDisplay() {
  const licenseKeyEl = document.getElementById('mcpLicenseKey');
  const grantKeyEl = document.getElementById('mcpGrantKey');
  const licenseStatusEl = document.getElementById('mcpLicenseStatus');
  const grantStatusEl = document.getElementById('mcpGrantStatus');
  const copyConfigBtn = document.getElementById('copyMcpConfigBtn');

  if (!licenseKeyEl || !grantKeyEl) return;

  // Get license key
  const licenseData = await LicenseService.getLicenseData();
  if (licenseData && licenseData.key) {
    // Show masked key (first 8 chars + ...)
    const maskedKey = licenseData.key.substring(0, 8) + '••••••••';
    licenseKeyEl.textContent = maskedKey;
    licenseKeyEl.classList.remove('not-set');
    licenseStatusEl.className = 'credential-status valid';
  } else {
    licenseKeyEl.textContent = 'Not configured';
    licenseKeyEl.classList.add('not-set');
    licenseStatusEl.className = 'credential-status invalid';
  }

  // Get grant key status (never display the key itself — JT only shows it once)
  const grantKey = await JobTreadProService.getGrantKey();
  if (grantKey) {
    grantKeyEl.textContent = 'Configured';
    grantKeyEl.classList.remove('not-set');
    grantStatusEl.className = 'credential-status valid';
  } else {
    grantKeyEl.textContent = 'Not configured';
    grantKeyEl.classList.add('not-set');
    grantStatusEl.className = 'credential-status invalid';
  }

  // Enable/disable Copy MCP Config button
  if (copyConfigBtn) {
    const isOAuth = ['chatgpt', 'claude-web'].includes(selectedMcpPlatform);
    if (isOAuth) {
      // OAuth platforms don't need keys — always enabled
      copyConfigBtn.disabled = false;
    } else {
      const hasCredentials = licenseData?.key && grantKey;
      copyConfigBtn.disabled = !hasCredentials;
    }
  }
}

// Grant key update rate limiting
let grantKeyFailCount = 0;
let grantKeyLockoutUntil = 0;

/**
 * Handle updating the grant key
 */
async function handleUpdateGrantKey() {
  const grantKeyInput = document.getElementById('mcpGrantKeyInput');
  const updateBtn = document.getElementById('updateGrantKeyBtn');
  const errorEl = document.getElementById('grantKeyError');

  // Rate limit: lock out after 3 consecutive failures for 30 seconds
  if (Date.now() < grantKeyLockoutUntil) {
    const secondsLeft = Math.ceil((grantKeyLockoutUntil - Date.now()) / 1000);
    showGrantKeyError(`Too many attempts. Please wait ${secondsLeft} seconds.`);
    return;
  }

  const newGrantKey = grantKeyInput.value.trim();

  if (!newGrantKey) {
    showGrantKeyError('Please enter a Grant Key');
    return;
  }

  // Disable button during update
  updateBtn.disabled = true;
  updateBtn.innerHTML = '<i class="ph ph-spinner"></i> Updating...';
  errorEl.style.display = 'none';

  try {
    // Test the new grant key via Pro Service
    const result = await JobTreadProService.verifyOrgAccess(newGrantKey);

    if (result.success) {
      // Reset rate limit on success
      grantKeyFailCount = 0;

      // Clear input
      grantKeyInput.value = '';

      // Persist grant key to D1 database via AccountService (for cross-device sync)
      if (typeof AccountService !== 'undefined' && AccountService.isAuthenticated) {
        try {
          const isAuth = await AccountService.isAuthenticated();
          if (isAuth) {
            await AccountService.updateGrantKey(newGrantKey);
          }
        } catch (err) {
          console.log('Grant key D1 sync skipped:', err.message);
        }
      }

      // Show success with write-attribution reminder
      showGrantKeySuccess(
        `Grant Key updated! Connected to ${result.organizationName || 'organization'}. ` +
        `Reminder: Write actions will appear as the grant key owner. We recommend using a dedicated "AI Assistant" account.`
      );

      // Update displays
      await updateMcpCredentialsDisplay();
      await updateMcpPrerequisites();
      await checkApiStatus();
    } else {
      // Increment rate limit counter
      grantKeyFailCount++;
      if (grantKeyFailCount >= 3) {
        grantKeyLockoutUntil = Date.now() + 30000; // 30 second lockout
        grantKeyFailCount = 0;
      }

      // Show error
      if (result.code === 'ORG_MISMATCH') {
        showGrantKeyError('This Grant Key is from a different organization than your license');
      } else if (result.code === 'INVALID_GRANT_KEY') {
        showGrantKeyError('Invalid Grant Key. Please check and try again.');
      } else {
        showGrantKeyError(result.message || result.error || 'Failed to verify Grant Key');
      }
    }
  } catch (error) {
    showGrantKeyError('Error connecting to server. Please try again.');
  } finally {
    updateBtn.disabled = false;
    updateBtn.innerHTML = '<i class="ph ph-arrows-clockwise"></i> Update';
  }
}

/**
 * Show grant key error message
 */
function showGrantKeyError(message) {
  const errorEl = document.getElementById('grantKeyError');
  if (errorEl) {
    errorEl.textContent = message;
    errorEl.className = 'grant-key-error';
    errorEl.style.display = 'block';
  }
}

/**
 * Show grant key success message
 */
function showGrantKeySuccess(message) {
  const errorEl = document.getElementById('grantKeyError');
  if (errorEl) {
    errorEl.textContent = message;
    errorEl.className = 'grant-key-success';
    errorEl.style.display = 'block';

    // Auto-hide after 3 seconds
    setTimeout(() => {
      errorEl.style.display = 'none';
    }, 3000);
  }
}

// Current selected platform for MCP config
let selectedMcpPlatform = 'claude-code';

/**
 * Default platform for each AI provider
 */
const PROVIDER_DEFAULTS = {
  'claude': 'claude-code',
  'chatgpt': 'chatgpt',
  'gemini': 'gemini',
  'grok': 'grok'
};

/**
 * Initialize two-level platform tabs for MCP config generator
 * Level 1: AI Provider (Claude, ChatGPT, Gemini)
 * Level 2: Variant (Code, Desktop, Web) — only for Claude
 */
function initPlatformTabs() {
  const providerTabs = document.querySelectorAll('#aiProviderTabs .platform-tab');
  const variantGroups = document.querySelectorAll('.variant-group');
  const variantTabs = document.querySelectorAll('.variant-tab');
  const platformNotes = document.querySelectorAll('.platform-note');

  // Level 1: AI Provider click
  providerTabs.forEach(tab => {
    tab.addEventListener('click', () => {
      const provider = tab.dataset.provider;

      // Update active provider tab
      providerTabs.forEach(t => t.classList.remove('active'));
      tab.classList.add('active');

      // Show/hide variant groups
      variantGroups.forEach(g => {
        g.classList.remove('active');
        if (g.dataset.provider === provider) {
          g.classList.add('active');
        }
      });

      // Select the default platform for this provider
      const defaultPlatform = PROVIDER_DEFAULTS[provider];
      selectPlatform(defaultPlatform, platformNotes);
    });
  });

  // Level 2: Variant click (within Claude)
  variantTabs.forEach(tab => {
    tab.addEventListener('click', () => {
      const platform = tab.dataset.platform;

      // Update active variant within its group
      const group = tab.closest('.variant-group');
      group.querySelectorAll('.variant-tab').forEach(t => t.classList.remove('active'));
      tab.classList.add('active');

      selectPlatform(platform, platformNotes);
    });
  });
}

/**
 * Select a specific platform and update notes + copy button
 */
function selectPlatform(platform, platformNotes) {
  selectedMcpPlatform = platform;

  // Update active note
  platformNotes.forEach(note => {
    note.classList.remove('active');
    if (note.dataset.platform === platform) {
      note.classList.add('active');
    }
  });

  // Update copy button text and hint for OAuth vs legacy platforms
  updateCopyButtonForPlatform(platform);
}

/**
 * Update copy button label and hint based on whether platform uses OAuth or legacy auth
 */
async function updateCopyButtonForPlatform(platform) {
  const copyConfigBtn = document.getElementById('copyMcpConfigBtn');
  const hintText = document.getElementById('mcpConfigHintText');
  if (!copyConfigBtn) return;

  const isOAuth = ['chatgpt', 'claude-web'].includes(platform);

  if (isOAuth) {
    // OAuth platforms just need the server URL — no keys needed
    copyConfigBtn.disabled = false;
    copyConfigBtn.innerHTML = '<i class="ph ph-copy"></i> Copy Server URL';
    if (hintText) {
      hintText.textContent = 'Paste this URL in your AI client \u2014 you\'ll enter your keys on the authorization screen';
    }
  } else {
    // Legacy platforms need keys embedded in config
    copyConfigBtn.innerHTML = '<i class="ph ph-copy"></i> Copy Config';
    if (hintText) {
      hintText.textContent = 'Both keys must be configured to copy';
    }
    // Check if keys are available
    const licenseData = await LicenseService.getLicenseData();
    const grantKey = await JobTreadProService.getGrantKey();
    const hasCredentials = licenseData?.key && grantKey;
    copyConfigBtn.disabled = !hasCredentials;
  }
}

/**
 * Generate MCP config for the selected platform.
 * Uses placeholder credentials — users must replace with their own keys.
 * @param {string} platform - The platform to generate config for
 * @returns {string} The config as a formatted string
 */
function generateMcpConfig(platform) {
  const serverUrl = MCP_SERVER_URL;
  const placeholder = '<YOUR_LICENSE_KEY>:<YOUR_GRANT_KEY>';

  switch (platform) {
    case 'claude-code':
      // Claude Code: HTTP transport (official type per Anthropic docs)
      return JSON.stringify({
        'mcpServers': {
          'jobtread': {
            'type': 'http',
            'url': `${serverUrl}/mcp`,
            'headers': {
              'Authorization': `Bearer ${placeholder}`
            }
          }
        }
      }, null, 2);

    case 'claude-desktop':
      // Claude Desktop: Requires mcp-remote wrapper (stdio bridge to remote)
      return JSON.stringify({
        'mcpServers': {
          'jobtread': {
            'command': 'npx',
            'args': [
              '-y',
              'mcp-remote',
              `${serverUrl}/mcp`,
              '--header',
              `Authorization:Bearer ${placeholder}`
            ]
          }
        }
      }, null, 2);

    case 'chatgpt':
      // ChatGPT: OAuth — paste the MCP endpoint URL, ChatGPT handles OAuth flow
      return `${serverUrl}/mcp`;

    case 'claude-web':
      // Claude Web: OAuth — paste the MCP endpoint URL, Claude handles OAuth flow
      return `${serverUrl}/mcp`;

    case 'gemini':
      // Gemini CLI: Uses httpUrl key (per Google Gemini docs)
      return JSON.stringify({
        'mcpServers': {
          'jobtread': {
            'httpUrl': `${serverUrl}/mcp`,
            'headers': {
              'Authorization': `Bearer ${placeholder}`
            }
          }
        }
      }, null, 2);

    case 'grok':
      // Grok (xAI): Standard MCP config with url + headers
      return JSON.stringify({
        'mcpServers': {
          'jobtread': {
            'url': `${serverUrl}/mcp`,
            'headers': {
              'Authorization': `Bearer ${placeholder}`
            }
          }
        }
      }, null, 2);

    default:
      return '';
  }
}

/**
 * Handle copying MCP config to clipboard
 */
async function handleCopyMcpConfig() {
  const copyConfigBtn = document.getElementById('copyMcpConfigBtn');
  const isOAuthPlatform = ['chatgpt', 'claude-web'].includes(selectedMcpPlatform);

  // Generate config with placeholders (no real credentials embedded)
  const config = generateMcpConfig(selectedMcpPlatform);

  try {
    await navigator.clipboard.writeText(config);

    // Show copied state
    const isUrl = isOAuthPlatform;
    copyConfigBtn.classList.add('copied');
    copyConfigBtn.innerHTML = '<i class="ph ph-check"></i> Copied!';

    // Reset after 2 seconds
    setTimeout(() => {
      copyConfigBtn.classList.remove('copied');
      copyConfigBtn.innerHTML = isUrl
        ? '<i class="ph ph-copy"></i> Copy Server URL'
        : '<i class="ph ph-copy"></i> Copy Config';
    }, 2000);

    const platformNames = {
      'claude-code': 'Claude Code',
      'claude-desktop': 'Claude Desktop',
      'chatgpt': 'ChatGPT',
      'claude-web': 'Claude Web',
      'gemini': 'Gemini',
      'grok': 'Grok'
    };
    const label = isUrl ? 'URL' : 'config';

    // Guide users to replace placeholders with their credentials
    if (!isUrl) {
      showStatus(`${platformNames[selectedMcpPlatform]} ${label} copied! Replace <YOUR_LICENSE_KEY> and <YOUR_GRANT_KEY> with your credentials.`, 'success');
    } else {
      showStatus(`${platformNames[selectedMcpPlatform]} ${label} copied!`, 'success');
    }
  } catch (err) {
    showStatus('Failed to copy to clipboard', 'error');
  }
}

/**
 * Update MCP prerequisites checklist
 */
async function updateMcpPrerequisites() {
  const prereqLicense = document.getElementById('prereqLicense');
  const prereqGrantKey = document.getElementById('prereqGrantKey');

  if (!prereqLicense || !prereqGrantKey) return;

  // Check license (Power User tier)
  const tier = await LicenseService.getTier();
  const hasPowerUser = tier && LicenseService.tierHasFeature(tier, 'customFieldFilter');
  setPrereqStatus(prereqLicense, hasPowerUser);

  // Check grant key (via obfuscated storage)
  const grantKey = await JobTreadProService.getGrantKey();
  setPrereqStatus(prereqGrantKey, !!grantKey);

}

/**
 * Set a prerequisite row as done or not
 */
function setPrereqStatus(el, isDone) {
  if (!el) return;
  const icon = el.querySelector('.prereq-icon');
  if (isDone) {
    icon.className = 'ph ph-check-circle prereq-icon prereq-check';
    el.classList.add('prereq-done');
  } else {
    icon.className = 'ph ph-circle-dashed prereq-icon';
    el.classList.remove('prereq-done');
  }
}

// Initialize MCP tab when DOM is ready (add to existing DOMContentLoaded)

// ===================================
// Account Section
// ===================================

// Temporary setup token storage
// currentSetupToken removed — portal uses direct registration

/**
 * Initialize account UI
 */
async function initAccountUI() {
  // Get elements
  const accountSection = document.getElementById('accountSection');

  if (!accountSection) return;

  // Check if AccountService is available
  if (typeof AccountService === 'undefined') {
    console.warn('AccountService not available');
    accountSection.style.display = 'none';
    return;
  }

  // Initialize AccountService
  await AccountService.init();

  // Set up event listeners
  setupAccountEventListeners();

  // Check if there's a pending password reset token
  if (window.pendingResetToken) {
    // Switch to License tab and show reset form
    const licenseTab = document.querySelector('[data-tab="license"]');
    if (licenseTab) licenseTab.click();
    showAccountForm('reset');
    delete window.pendingResetToken;
  } else {
    // Update account UI state
    await updateAccountUI();
  }
}

/**
 * Set up event listeners for account forms
 */
function setupAccountEventListeners() {
  // Login button
  const loginBtn = document.getElementById('loginBtn');
  if (loginBtn) {
    loginBtn.addEventListener('click', handleLogin);
  }

  // Register button
  const registerBtn = document.getElementById('registerBtn');
  if (registerBtn) {
    registerBtn.addEventListener('click', handleRegister);
  }

  // Logout button
  const logoutBtn = document.getElementById('logoutBtn');
  if (logoutBtn) {
    logoutBtn.addEventListener('click', handleLogout);
  }

  // Attach license button (free → paid upgrade)
  const attachLicenseBtn = document.getElementById('attachLicenseBtn');
  if (attachLicenseBtn) {
    attachLicenseBtn.addEventListener('click', handleAttachLicense);
  }
  const attachLicenseKey = document.getElementById('attachLicenseKey');
  if (attachLicenseKey) {
    attachLicenseKey.addEventListener('keypress', (e) => {
      if (e.key === 'Enter') handleAttachLicense();
    });
  }

  // Show register form
  const showRegisterBtn = document.getElementById('showRegisterBtn');
  if (showRegisterBtn) {
    showRegisterBtn.addEventListener('click', (e) => {
      e.preventDefault();
      showAccountForm('register');
    });
  }

  // Show login form
  const showLoginBtn = document.getElementById('showLoginBtn');
  if (showLoginBtn) {
    showLoginBtn.addEventListener('click', (e) => {
      e.preventDefault();
      showAccountForm('login');
    });
  }

  // Setup account button (from prompt)
  // setupAccountBtn is now an external link to https://app.jtpowertools.com/register
  // No click handler needed — the <a> tag handles navigation directly

  // Skip account button
  const skipAccountBtn = document.getElementById('skipAccountBtn');
  if (skipAccountBtn) {
    skipAccountBtn.addEventListener('click', (e) => {
      e.preventDefault();
      // Hide setup prompt, show nothing (user chose to skip)
      document.getElementById('accountSetupPrompt').style.display = 'none';
      // Store that user skipped (won't show prompt again this session)
      sessionStorage.setItem('accountSetupSkipped', 'true');
    });
  }

  // Sign in button (from prompt - for users who already have an account)
  const signInBtn = document.getElementById('signInBtn');
  if (signInBtn) {
    signInBtn.addEventListener('click', (e) => {
      e.preventDefault();
      showAccountForm('login');
    });
  }

  // Show forgot password form
  const showForgotPasswordBtn = document.getElementById('showForgotPasswordBtn');
  if (showForgotPasswordBtn) {
    showForgotPasswordBtn.addEventListener('click', (e) => {
      e.preventDefault();
      showAccountForm('forgot');
    });
  }

  // Back to login from forgot password
  const backToLoginBtn = document.getElementById('backToLoginBtn');
  if (backToLoginBtn) {
    backToLoginBtn.addEventListener('click', (e) => {
      e.preventDefault();
      showAccountForm('login');
    });
  }

  // Send reset link button
  const sendResetBtn = document.getElementById('sendResetBtn');
  if (sendResetBtn) {
    sendResetBtn.addEventListener('click', handleForgotPassword);
  }

  // Reset password button
  const resetPasswordBtn = document.getElementById('resetPasswordBtn');
  if (resetPasswordBtn) {
    resetPasswordBtn.addEventListener('click', handleResetPassword);
  }

  // Enter key for forgot password form
  const forgotEmail = document.getElementById('forgotEmail');
  if (forgotEmail) {
    forgotEmail.addEventListener('keypress', (e) => {
      if (e.key === 'Enter') handleForgotPassword();
    });
  }

  // Enter key for reset password form
  const confirmPassword = document.getElementById('confirmPassword');
  if (confirmPassword) {
    confirmPassword.addEventListener('keypress', (e) => {
      if (e.key === 'Enter') handleResetPassword();
    });
  }

  // Enter key for login form
  const loginPassword = document.getElementById('loginPassword');
  if (loginPassword) {
    loginPassword.addEventListener('keypress', (e) => {
      if (e.key === 'Enter') handleLogin();
    });
  }

  // Enter key for register form
  const registerPassword = document.getElementById('registerPassword');
  if (registerPassword) {
    registerPassword.addEventListener('keypress', (e) => {
      if (e.key === 'Enter') handleRegister();
    });
  }

  // Migration banner dismiss
  document.getElementById('migrationDismiss')?.addEventListener('click', () => {
    document.getElementById('migrationBanner').style.display = 'none';
    sessionStorage.setItem('migrationBannerDismissed', 'true');
  });

  // Migration banner sign-in
  document.getElementById('migrationSignInBtn')?.addEventListener('click', () => {
    document.getElementById('migrationBanner').style.display = 'none';
    showAccountForm('login');
  });
}

/**
 * Update account UI based on current state
 */
async function updateAccountUI() {
  const accountLoggedIn = document.getElementById('accountLoggedIn');
  const accountLogin = document.getElementById('accountLogin');
  const accountRegister = document.getElementById('accountRegister');
  const accountSetupPrompt = document.getElementById('accountSetupPrompt');
  const accountSection = document.getElementById('accountSection');

  if (!accountSection) return;

  // Check if user is logged in
  if (AccountService.isLoggedIn()) {
    // Show logged in state
    const user = AccountService.getCurrentUser();
    document.getElementById('accountEmail').textContent = user?.email || 'Unknown';
    document.getElementById('accountOrg').textContent = user?.orgName || '';
    // Show the resolved effective tier — the SAME value that gates every
    // feature, with no fallback.
    //
    // This used to read `getTier() || user?.tier`, and that fallback hid a
    // real failure: when resolution returned null the chip still printed the
    // tier from the login response, so the popup reported "Power User" while
    // the gate denied every paid feature. A UI that reports success the gate
    // does not agree with is how that stayed invisible. Null now renders as
    // Free, which is what null actually means to the gate.
    const effectiveTier = await LicenseService.getTier();
    document.getElementById('accountTier').textContent = effectiveTier
      ? `${LicenseService.getTierDisplayName(effectiveTier)} Tier`
      : 'Free Tier';

    // Divergence is a bug, not a state — the account says one thing and the
    // gate does another. Say so where whoever is debugging will see it.
    if (user?.tier && user.tier !== effectiveTier) {
      console.warn(
        `Account tier "${user.tier}" does not match the resolved gate tier ` +
        `"${effectiveTier}". Paid features follow the gate, so they are locked ` +
        'to the lower value. Check chrome.storage.local jtAccountUserData / jtToolsLicense.'
      );
    }

    // Update license status indicator
    const licenseStatusEl = document.getElementById('accountLicenseStatus');
    const connectionStatusEl = document.getElementById('accountConnectionStatus');
    const licenseData = await LicenseService.getLicenseData();
    const isLicenseActive = (licenseData && licenseData.valid) || user?.licenseStatus === 'active';
    if (licenseStatusEl) {
      if (isLicenseActive) {
        licenseStatusEl.className = 'account-status-item active';
        licenseStatusEl.querySelector('i').className = 'ph ph-crown';
      } else {
        licenseStatusEl.className = 'account-status-item inactive';
        licenseStatusEl.querySelector('i').className = 'ph ph-crown';
      }
    }
    if (connectionStatusEl) {
      if (isLicenseActive) {
        connectionStatusEl.className = 'account-status-item active';
        connectionStatusEl.innerHTML = '<i class="ph ph-check-circle"></i><span>Active</span>';
      } else {
        connectionStatusEl.className = 'account-status-item inactive';
        connectionStatusEl.innerHTML = '<i class="ph ph-x-circle"></i><span>Inactive</span>';
      }
    }

    accountLoggedIn.style.display = 'block';
    accountLogin.style.display = 'none';
    accountRegister.style.display = 'none';
    accountSetupPrompt.style.display = 'none';
    accountSection.style.display = 'block';

    // Hide migration banner when logged in
    const migrationBanner = document.getElementById('migrationBanner');
    if (migrationBanner) migrationBanner.style.display = 'none';

    // Show portal links for signed-in users
    const portalLinks = document.getElementById('portalLinks');
    if (portalLinks) portalLinks.style.display = 'block';

    // Hide get-license CTA
    const getLicenseCta = document.getElementById('getLicenseCta');
    if (getLicenseCta) getLicenseCta.style.display = 'none';

    // Attach-license card: only the OWNER of a free account can upgrade in
    // place. Paid accounts change plans on Gumroad, and a member can't
    // re-plan the whole license. Server enforces both checks independently.
    const attachCard = document.getElementById('attachLicenseCard');
    if (attachCard) {
      const effectiveTier = (await LicenseService.getTier()) || user?.tier;
      attachCard.style.display =
        (effectiveTier === 'free' && user?.role === 'owner') ? 'block' : 'none';
    }

    return;
  }

  // User not logged in - show login form directly
  accountLoggedIn.style.display = 'none';
  accountLogin.style.display = 'block';
  accountRegister.style.display = 'none';
  if (accountSetupPrompt) accountSetupPrompt.style.display = 'none';
  accountSection.style.display = 'block';

  // Hide portal links when not signed in
  const portalLinks = document.getElementById('portalLinks');
  if (portalLinks) portalLinks.style.display = 'none';

  // Show get-license CTA when not signed in
  const getLicenseCta = document.getElementById('getLicenseCta');
  if (getLicenseCta) getLicenseCta.style.display = '';

  // Show migration banner if licensed but not signed in
  const migrationBanner = document.getElementById('migrationBanner');
  if (migrationBanner) {
    const licenseData = await LicenseService.getLicenseData();
    if (licenseData && licenseData.valid) {
      const dismissed = sessionStorage.getItem('migrationBannerDismissed');
      if (!dismissed) {
        migrationBanner.style.display = '';
      }
    } else {
      migrationBanner.style.display = 'none';
    }
  }
}

/**
 * Show a specific account form
 */
async function showAccountForm(formType) {
  const accountLoggedIn = document.getElementById('accountLoggedIn');
  const accountLogin = document.getElementById('accountLogin');
  const accountRegister = document.getElementById('accountRegister');
  const accountSetupPrompt = document.getElementById('accountSetupPrompt');
  const accountForgotPassword = document.getElementById('accountForgotPassword');
  const accountResetPassword = document.getElementById('accountResetPassword');
  const accountSection = document.getElementById('accountSection');

  // Hide all
  accountLoggedIn.style.display = 'none';
  accountLogin.style.display = 'none';
  accountRegister.style.display = 'none';
  accountSetupPrompt.style.display = 'none';
  if (accountForgotPassword) accountForgotPassword.style.display = 'none';
  if (accountResetPassword) accountResetPassword.style.display = 'none';

  // Clear errors and success messages
  document.getElementById('loginError').style.display = 'none';
  document.getElementById('registerError').style.display = 'none';
  const forgotError = document.getElementById('forgotError');
  const forgotSuccess = document.getElementById('forgotSuccess');
  const resetError = document.getElementById('resetError');
  const resetSuccess = document.getElementById('resetSuccess');
  if (forgotError) forgotError.style.display = 'none';
  if (forgotSuccess) forgotSuccess.style.display = 'none';
  if (resetError) resetError.style.display = 'none';
  if (resetSuccess) resetSuccess.style.display = 'none';

  if (formType === 'login') {
    accountLogin.style.display = 'block';
  } else if (formType === 'register') {
    accountRegister.style.display = 'block';
  } else if (formType === 'forgot') {
    if (accountForgotPassword) accountForgotPassword.style.display = 'block';
  } else if (formType === 'reset') {
    if (accountResetPassword) accountResetPassword.style.display = 'block';
  }

  accountSection.style.display = 'block';
}

/**
 * Handle login form submission
 */
/**
 * Re-apply license gating after the signed-in identity changes.
 *
 * Signing in, registering, and signing out all change which tier the popup
 * should be showing, but only the init path and the license-activation path
 * ever re-ran the gating — so after signing in you had to close and reopen
 * the popup before your features unlocked. checkLicenseStatus() adds and
 * removes the .locked treatment; loadSettings() re-reads the stored toggles
 * that gating may have just changed.
 *
 * Deliberately does NOT call renderFeatureCategories() — that reparents the
 * toggle rows and has already run once at init.
 */
async function refreshLicenseGating() {
  await checkLicenseStatus();
  await loadSettings();
}

async function handleLogin() {
  const emailInput = document.getElementById('loginEmail');
  const passwordInput = document.getElementById('loginPassword');
  const loginBtn = document.getElementById('loginBtn');

  const email = emailInput.value.trim();
  const password = passwordInput.value;

  if (!email || !password) {
    showAccountError('login', 'Please enter email and password');
    return;
  }

  // Disable button
  loginBtn.disabled = true;
  loginBtn.textContent = 'Signing in...';

  try {
    const result = await AccountService.login(email, password);

    if (result.success) {
      // Clear form
      emailInput.value = '';
      passwordInput.value = '';
      // Unlock the Features tab for the tier we just signed in as, before
      // touching the account panel — otherwise the popup keeps showing the
      // signed-out gating until it is closed and reopened.
      await refreshLicenseGating();
      // Update UI — refresh account, API status, and MCP credentials
      // (login auto-registers the grant key via JobTreadProService)
      await updateAccountUI();
      await checkApiStatus();
      if (typeof updateMcpCredentialsDisplay === 'function') {
        await updateMcpCredentialsDisplay();
      }
      showStatus('Signed in successfully!', 'success');
    } else {
      showAccountError('login', result.error || 'Login failed');
    }
  } catch (error) {
    console.error('Login error:', error);
    showAccountError('login', 'An error occurred. Please try again.');
  } finally {
    loginBtn.disabled = false;
    loginBtn.textContent = 'Sign In';
  }
}

/**
 * Handle register form submission
 */
async function handleRegister() {
  const nameInput = document.getElementById('registerName');
  const emailInput = document.getElementById('registerEmail');
  const passwordInput = document.getElementById('registerPassword');
  const registerBtn = document.getElementById('registerBtn');

  const displayName = nameInput.value.trim();
  const email = emailInput.value.trim();
  const password = passwordInput.value;

  if (!email || !password) {
    showAccountError('register', 'Please enter email and password');
    return;
  }

  if (password.length < 8) {
    showAccountError('register', 'Password must be at least 8 characters');
    return;
  }

  // Disable button
  registerBtn.disabled = true;
  registerBtn.textContent = 'Creating account...';

  try {
    // Get license key if available (for linking account to existing license)
    let licenseKey = null;
    const licenseData = await LicenseService.getLicenseData();
    if (licenseData && licenseData.key) {
      licenseKey = licenseData.key;
    }

    const result = await AccountService.register(email, password, displayName, licenseKey);

    if (result.success) {
      // Clear form
      nameInput.value = '';
      emailInput.value = '';
      passwordInput.value = '';
      // Registering with a license key changes the tier the popup should
      // show, so re-gate before the account panel repaints.
      await refreshLicenseGating();
      // Update UI — refresh account, API status, and MCP credentials
      await updateAccountUI();
      await checkApiStatus();
      if (typeof updateMcpCredentialsDisplay === 'function') {
        await updateMcpCredentialsDisplay();
      }
      showStatus('Account created successfully!', 'success');
    } else {
      showAccountError('register', result.error || 'Registration failed');
    }
  } catch (error) {
    console.error('Register error:', error);
    showAccountError('register', 'An error occurred. Please try again.');
  } finally {
    registerBtn.disabled = false;
    registerBtn.textContent = 'Create Account';
  }
}

/**
 * Handle attaching a purchased license to a free account.
 *
 * The server upgrades the existing license row in place, so the user's grant
 * keys, notes, and team survive the upgrade. On success the whole popup is
 * re-read: the tier chip, feature gates, and API status all change at once.
 */
async function handleAttachLicense() {
  const input = document.getElementById('attachLicenseKey');
  const btn = document.getElementById('attachLicenseBtn');
  const errorEl = document.getElementById('attachLicenseError');
  if (!input || !btn) return;

  const licenseKey = input.value.trim();
  if (!licenseKey) {
    showAccountError('attachLicense', 'Please enter your license key');
    return;
  }

  if (errorEl) errorEl.style.display = 'none';
  btn.disabled = true;
  btn.textContent = 'Checking...';

  try {
    const result = await AccountService.attachLicense(licenseKey);

    if (result.success) {
      input.value = '';
      // Re-read everything the tier drives: the chip, the premium toggles,
      // API status, and the MCP credentials panel. refreshLicenseGating()
      // covers the toggles — loadSettings() alone re-reads the stored values
      // but leaves every row's .locked treatment on the pre-upgrade tier.
      await updateAccountUI();
      await refreshLicenseGating();
      await checkApiStatus();
      if (typeof updateMcpCredentialsDisplay === 'function') {
        await updateMcpCredentialsDisplay();
      }
      const tierName = LicenseService.getTierDisplayName(result.data?.user?.tier);
      showStatus(`Upgraded to ${tierName}!`, 'success');
    } else {
      showAccountError('attachLicense', result.error || 'Could not attach that license key');
    }
  } catch (error) {
    console.error('Attach license error:', error);
    showAccountError('attachLicense', 'An error occurred. Please try again.');
  } finally {
    btn.disabled = false;
    btn.textContent = 'Attach';
  }
}

/**
 * Handle logout
 */
async function handleLogout() {
  const logoutBtn = document.getElementById('logoutBtn');
  logoutBtn.disabled = true;
  logoutBtn.textContent = 'Signing out...';

  try {
    await AccountService.logout();

    // Clear license data so premium features deactivate
    if (window.LicenseService && LicenseService.removeLicense) {
      await LicenseService.removeLicense();
    }

    // Disable premium/licensed features in stored settings
    // Merge with defaults first so FREE features (formatter, darkMode, etc.)
    // are always preserved even if stored settings are incomplete
    const result = await chrome.storage.sync.get(['jtToolsSettings']);
    const mergedSettings = (typeof JTDefaults !== 'undefined' && JTDefaults.mergeWithDefaults)
      ? JTDefaults.mergeWithDefaults(result.jtToolsSettings)
      : { ...defaultSettings, ...(result.jtToolsSettings || {}) };
    const updated = { ...mergedSettings };
    // PRO features
    updated.dragDrop = false;
    updated.previewMode = false;
    updated.rgbTheme = false;
    updated.availabilityFilter = false;
    updated.reverseThreadOrder = false;
    // ESSENTIAL features
    updated.quickNotes = false;
    updated.smartJobSwitcher = false;
    updated.freezeHeader = false;
    updated.pdfMarkupTools = false;
    await chrome.storage.sync.set({ jtToolsSettings: updated });

    // Notify content script to deactivate features
    chrome.runtime.sendMessage({ type: 'SETTINGS_UPDATED', settings: updated });

    // Reload settings UI and re-lock the rows the signed-out tier can't use.
    // Without the gating pass the toggles read as unlocked until the popup is
    // reopened, even though the features are now off.
    await refreshLicenseGating();
    await updateAccountUI();
    if (typeof updateMcpCredentialsDisplay === 'function') {
      await updateMcpCredentialsDisplay();
    }
    showStatus('Signed out', 'success');
  } catch (error) {
    console.error('Logout error:', error);
  } finally {
    logoutBtn.disabled = false;
    logoutBtn.textContent = 'Sign Out';
  }
}

/**
 * Handle forgot password form submission
 */
async function handleForgotPassword() {
  const emailInput = document.getElementById('forgotEmail');
  const sendResetBtn = document.getElementById('sendResetBtn');
  const forgotSuccess = document.getElementById('forgotSuccess');
  const forgotError = document.getElementById('forgotError');

  const email = emailInput.value.trim();

  if (!email) {
    showAccountError('forgot', 'Please enter your email address');
    return;
  }

  // Disable button
  sendResetBtn.disabled = true;
  sendResetBtn.textContent = 'Sending...';
  forgotSuccess.style.display = 'none';
  forgotError.style.display = 'none';

  try {
    const result = await AccountService.requestPasswordReset(email);

    if (result.success) {
      // Show success message
      forgotSuccess.textContent = 'If an account exists with that email, a reset link has been sent. Please check your inbox.';
      forgotSuccess.style.display = 'block';
      // Clear email input
      emailInput.value = '';
    } else {
      showAccountError('forgot', result.error || 'Failed to send reset email');
    }
  } catch (error) {
    console.error('Forgot password error:', error);
    showAccountError('forgot', 'An error occurred. Please try again.');
  } finally {
    sendResetBtn.disabled = false;
    sendResetBtn.textContent = 'Send Reset Link';
  }
}

/**
 * Handle reset password form submission
 */
async function handleResetPassword() {
  const newPasswordInput = document.getElementById('newPassword');
  const confirmPasswordInput = document.getElementById('confirmPassword');
  const resetPasswordBtn = document.getElementById('resetPasswordBtn');
  const resetSuccess = document.getElementById('resetSuccess');
  const resetError = document.getElementById('resetError');

  const newPassword = newPasswordInput.value;
  const confirmPassword = confirmPasswordInput.value;

  if (!newPassword) {
    showAccountError('reset', 'Please enter a new password');
    return;
  }

  if (newPassword.length < 8) {
    showAccountError('reset', 'Password must be at least 8 characters');
    return;
  }

  if (newPassword !== confirmPassword) {
    showAccountError('reset', 'Passwords do not match');
    return;
  }

  // Get reset token from URL
  const urlParams = new URLSearchParams(window.location.search);
  const resetToken = urlParams.get('reset_token');

  if (!resetToken) {
    showAccountError('reset', 'Invalid reset link. Please request a new one.');
    return;
  }

  // Disable button
  resetPasswordBtn.disabled = true;
  resetPasswordBtn.textContent = 'Resetting...';
  resetSuccess.style.display = 'none';
  resetError.style.display = 'none';

  try {
    const result = await AccountService.resetPassword(resetToken, newPassword);

    if (result.success) {
      // Show success message
      resetSuccess.textContent = 'Password has been reset successfully! You can now sign in with your new password.';
      resetSuccess.style.display = 'block';
      // Clear inputs
      newPasswordInput.value = '';
      confirmPasswordInput.value = '';
      // Clear token from URL
      window.history.replaceState({}, document.title, window.location.pathname);
      // After 2 seconds, show login form
      setTimeout(() => {
        showAccountForm('login');
      }, 2000);
    } else {
      showAccountError('reset', result.error || 'Failed to reset password');
    }
  } catch (error) {
    console.error('Reset password error:', error);
    showAccountError('reset', 'An error occurred. Please try again.');
  } finally {
    resetPasswordBtn.disabled = false;
    resetPasswordBtn.textContent = 'Reset Password';
  }
}

/**
 * Show account error message
 */
function showAccountError(formType, message) {
  const errorIds = {
    'login': 'loginError',
    'register': 'registerError',
    'forgot': 'forgotError',
    'reset': 'resetError',
    'attachLicense': 'attachLicenseError'
  };

  const errorEl = document.getElementById(errorIds[formType]);
  if (errorEl) {
    errorEl.textContent = message;
    errorEl.style.display = 'block';
  }
}

// ==================== User Tweaks Section ====================
// Self-contained: lists tweaks scoped to the active JT org with toggle/edit/delete
// actions, and exposes an Import dialog that validates pasted JSON and previews
// selector match counts on the active JT tab via the engine's TWEAK_DRY_RUN
// message handler. Active org is fetched from the JT tab via GET_ACTIVE_ORG
// (handled by the tweak-engine content script) — avoids requiring the
// `scripting` permission.
(function initTweaksSection() {
  function start() {
    const $section = document.querySelector('[data-tweaks-section]');
    if (!$section) return;
    const $list = $section.querySelector('[data-tweaks-list]');
    const $empty = $section.querySelector('[data-tweaks-empty]');
    const $orgLabel = $section.querySelector('[data-tweaks-org]');
    const $importBtn = $section.querySelector('[data-action="import"]');
    const $newBtn = $section.querySelector('[data-action="new"]');
    const $summary = $section.querySelector('[data-tweaks-summary]');
    const $summaryStats = $section.querySelector('[data-tweaks-summary-stats]');
    const $summaryCopy = $section.querySelector('[data-action="copy-diagnostic"]');
    const $dialog = document.querySelector('[data-import-dialog]');
    if (!$dialog) return;
    const $importJson = $dialog.querySelector('[data-import-json]');
    const $importPreview = $dialog.querySelector('[data-import-preview]');
    const $cancelBtn = $dialog.querySelector('[data-action="cancel"]');
    const $installBtn = $dialog.querySelector('[data-action="install"]');

    let activeOrg = null;
    let isJtTab = false;
    // Id of the JT tab this popup/panel is tracking — set by detectJtTab() and
    // used to scope JT_ORG_CHANGED broadcasts to the tab we're showing.
    let trackedTabId = null;
    // Cache of the caller's account info (role) used for Phase 2 UI gating
    // — admin/owner sees Edit/Delete on org_required tweaks; members don't.
    let callerAccount = null;

    // Find a JT tab — prefer the active tab in this window, fall back to any
    // open JT tab in any window, then ask its content script for the org name
    // via the tweak-engine message handler. No `scripting` permission needed.
    detectJtTab();
    loadCallerAccount();

    // Re-render the Tweaks list when the org is switched in the JT tab.
    // OrgDetector (content script) broadcasts JT_ORG_CHANGED with the new org
    // name; the `jt-org-changed` window event it also fires never leaves the
    // page, so without this the list stays on the previous org while a
    // persistent side panel is open across the switch (a transient popup closes
    // on the click that switches orgs, so this only bit the side panel).
    //
    // Set activeOrg DIRECTLY from the broadcast (authoritative) rather than
    // re-running detectJtTab — re-querying raced the SPA's org swap and could
    // resolve null, which made render() fall back to readAll() and show every
    // org's tweaks at once. Scope to the tab we're tracking so a change in a
    // different JT tab doesn't hijack the panel; adopt a tab if we had none.
    chrome.runtime.onMessage.addListener((message, sender) => {
      if (!message || message.type !== 'JT_ORG_CHANGED') return;
      const senderTabId = sender && sender.tab && sender.tab.id;
      if (senderTabId == null) return;
      if (trackedTabId != null && senderTabId !== trackedTabId) return;
      trackedTabId = senderTabId;
      activeOrg = message.orgName || null;
      $orgLabel.textContent = activeOrg ? '(' + activeOrg + ')' : '(JT tab — org not detected)';
      render();
    });

    /**
     * Read the caller's role from AccountService. Called once on start
     * to seed the cache, then re-read on each render() to handle the
     * race where AccountService.init() (async) hasn't finished by the
     * time popup.js runs.
     */
    function loadCallerAccount() {
      try {
        if (window.AccountService && typeof window.AccountService.getCurrentUser === 'function') {
          callerAccount = window.AccountService.getCurrentUser();
        }
      } catch (_e) {
        callerAccount = null;
      }
    }

    /**
     * True iff the caller is an admin or owner. Re-reads AccountService
     * each call so a slow async init doesn't leave us stuck thinking
     * the user is unauthenticated. Defaults to false when the account
     * isn't loaded — least-privileged fallback so a stale cached UI
     * doesn't expose Edit/Delete to a member.
     */
    function isCallerAdmin() {
      // Refresh on each call — AccountService.init() is async and may
      // not be done when the popup first renders.
      loadCallerAccount();
      if (!callerAccount) return false;
      const role = callerAccount.role;
      return role === 'admin' || role === 'owner';
    }

    /**
     * Best-effort server pull. Updates chrome.storage.local['jtTweaks']
     * so render() reads fresh data. Stays silent on offline/auth errors —
     * the cache + render path keeps working.
     */
    async function refreshFromServerSilent() {
      if (!window.TweaksApi || !window.TweaksApi.isAvailable()) return;
      if (!activeOrg) return;
      // Tweaks are Pro, and the server enforces that. Below Pro this pull is a
      // request that can only 403 — once per popup open, and it surfaces in the
      // console looking like a bug. Skip it; render() falls back to the cache
      // exactly as it does when the server is unreachable.
      try {
        if (window.LicenseService) {
          const tier = await window.LicenseService.getTier();
          if (!window.LicenseService.tierHasFeature(tier, 'tweakEngine')) return;
        }
      } catch (_e) {
        // Tier unknown — fall through and let the server decide.
      }
      try {
        const { tweaks, diagnostics } = await window.TweaksApi.list(activeOrg);
        // Per-org keys: replace only this org's bucket — no cross-org merge.
        await window.TweakStorage.writeOrg(activeOrg, tweaks);
        const stored = await chrome.storage.local.get(['jtTweakDiagnostics']);
        const mergedDiag = { ...(stored.jtTweakDiagnostics || {}) };
        for (const [id, d] of Object.entries(diagnostics || {})) {
          mergedDiag[id] = {
            lastMatchCount: d.lastMatchCount,
            lastApplyAt: d.lastApplyAt,
            lastErrorAt: d.lastErrorAt,
            lastError: d.lastErrorMessage
          };
        }
        await chrome.storage.local.set({ jtTweakDiagnostics: mergedDiag });
      } catch (_err) {
        // Server offline / not logged in — silent fallback, render() uses cache.
      }
    }

    async function detectJtTab() {
      // Pass 1: active tab in current window
      let tab = await new Promise(r => chrome.tabs.query({ active: true, currentWindow: true }, t => r((t && t[0]) || null)));
      if (!isJobTreadUrl(tab && tab.url)) {
        // Pass 2: any JT tab in any window — the user may have clicked the
        // extension icon from a non-JT window (Slack, email, etc.) but still
        // wants to manage tweaks scoped to the JT tab they have open elsewhere
        tab = await new Promise(r => chrome.tabs.query({ url: 'https://app.jobtread.com/*' }, t => {
          if (!t || !t.length) return r(null);
          // Prefer the most recently accessed JT tab
          t.sort((a, b) => (b.lastAccessed || 0) - (a.lastAccessed || 0));
          r(t[0]);
        }));
      }
      isJtTab = !!(tab && isJobTreadUrl(tab.url));
      // Remember which tab we're showing so JT_ORG_CHANGED broadcasts from a
      // different JT tab don't hijack the list.
      trackedTabId = isJtTab ? tab.id : null;
      if (isJtTab) {
        // Try up to 3 times with a small delay — content script may still be
        // initializing on a freshly-loaded page, or OrgDetector may not have
        // observed the JT header placeholder yet.
        for (let attempt = 0; attempt < 3 && !activeOrg; attempt++) {
          if (attempt > 0) await new Promise(r => setTimeout(r, 250));
          try {
            const resp = await chrome.tabs.sendMessage(tab.id, { type: 'GET_ACTIVE_ORG' });
            activeOrg = (resp && resp.org) || null;
          } catch (_e) {
            // Content script not ready yet — retry
          }
        }
      }
      // Three labels for three states (so contractors see a useful message
      // instead of always-misleading "no JT tab"):
      //   - org detected → show org name
      //   - JT tab open but org not detected (rare timing edge case) → show that
      //   - no JT tab in any window → show that
      if (activeOrg) {
        $orgLabel.textContent = '(' + activeOrg + ')';
      } else if (isJtTab) {
        $orgLabel.textContent = '(JT tab — org not detected)';
      } else {
        $orgLabel.textContent = '(no JT tab open)';
      }
      render();
    }

    function isJobTreadUrl(url) {
      return typeof url === 'string' && url.startsWith('https://app.jobtread.com');
    }

    /**
     * True when a recorded error is stale: the tweak has applied cleanly
     * (a newer lastApplyAt) since the error was recorded. A one-time error
     * like "css-tree library not loaded" shouldn't display forever once the
     * tweak applies fine. Auto-disabled tweaks don't get a fresh lastApplyAt
     * after being disabled, so this naturally leaves their error visible.
     */
    function isStaleTweakError(d) {
      return !!(d && d.lastError &&
        typeof d.lastApplyAt === 'number' &&
        typeof d.lastErrorAt === 'number' &&
        d.lastApplyAt > d.lastErrorAt);
    }

    /**
     * Update the at-a-glance summary line above the tweak list. Visible
     * for any user (admin or member) so support / CS can ask "do you
     * have any active Power Tools tweaks?" and the user can read the
     * answer right off this line.
     */
    function renderSummary(visible, diag) {
      if (!$summary || !$summaryStats) return;
      if (!visible.length) {
        $summary.hidden = true;
        return;
      }
      let active = 0, errored = 0, noMatches = 0;
      for (const t of visible) {
        if (t.enabled === false) continue;
        active++;
        const d = diag[t.id] || {};
        if (d.lastError && !isStaleTweakError(d)) errored++;
        else if (d.lastMatchCount === 0) noMatches++;
      }
      const parts = [active + ' active'];
      if (errored) parts.push(errored + ' with errors');
      if (noMatches) parts.push(noMatches + ' with no matches');
      $summaryStats.textContent = parts.join(' · ');
      $summary.hidden = false;
    }

    /**
     * Build a multi-line plain-text dump of the current tweak state for
     * the user to paste into a support email. Includes per-tweak status
     * (enabled, last apply, last error) but never the tweak's CSS / DSL
     * body — that may be sensitive (e.g. selectors revealing internal
     * org structure). The user controls what they paste; we just hand
     * them a clean summary.
     */
    function buildSupportDiagnostic(visible, diag) {
      const lines = [];
      const ts = new Date().toISOString();
      lines.push('JT Power Tools — Tweak Diagnostic');
      lines.push('Captured: ' + ts);
      lines.push('Active org: ' + (activeOrg || '(none)'));
      lines.push('Total tweaks: ' + visible.length);
      lines.push('');
      for (const t of visible) {
        const d = diag[t.id] || {};
        const enabled = t.enabled === false ? 'disabled' : 'enabled';
        const scope = t.storageScope === 'org_required' ? 'org_required' : 'personal';
        lines.push('— ' + (t.name || '(unnamed)'));
        lines.push('   id: ' + t.id);
        lines.push('   state: ' + enabled + ' (' + scope + ')');
        if (typeof d.lastMatchCount === 'number') {
          lines.push('   last match count: ' + d.lastMatchCount);
        }
        if (d.lastApplyAt) {
          lines.push('   last applied: ' + new Date(d.lastApplyAt).toISOString());
        }
        if (d.lastError) {
          const staleNote = isStaleTweakError(d) ? ' (stale — applied successfully since)' : '';
          lines.push('   last error: ' + d.lastError + staleNote);
          if (d.lastErrorAt) {
            lines.push('   last error at: ' + new Date(d.lastErrorAt).toISOString());
          }
        }
        lines.push('');
      }
      return lines.join('\n');
    }

    if ($summaryCopy) {
      $summaryCopy.addEventListener('click', async () => {
        const stored = await chrome.storage.local.get(['jtTweakDiagnostics']);
        const diag = stored.jtTweakDiagnostics || {};
        const visible = activeOrg
          ? await window.TweakStorage.readOrg(activeOrg)
          : await window.TweakStorage.readAll();
        const text = buildSupportDiagnostic(visible, diag);
        try {
          await navigator.clipboard.writeText(text);
          const original = $summaryCopy.textContent;
          $summaryCopy.textContent = 'Copied!';
          setTimeout(() => { $summaryCopy.textContent = original; }, 1500);
        } catch (err) {
          console.warn('Clipboard write failed:', err);
        }
      });
    }

    async function render() {
      // Split any legacy single-array cache into per-org keys before reading.
      await window.TweakStorage.migrateLegacyIfNeeded();
      // Pull fresh data from the server before rendering (best-effort).
      // Cache keeps render() fast on repeat opens; this just keeps it
      // accurate when the user has authored on another device.
      await refreshFromServerSilent();
      const stored = await chrome.storage.local.get(['jtTweakDiagnostics', 'jtTweakAutoDisabled']);
      const diag = stored.jtTweakDiagnostics || {};
      const autoDisabledMap = stored.jtTweakAutoDisabled || {};
      // With an active org, show just that org's bucket; otherwise show every
      // org's tweaks (same visibility as before, now sourced per-org).
      const visible = activeOrg
        ? await window.TweakStorage.readOrg(activeOrg)
        : await window.TweakStorage.readAll();

      $list.innerHTML = '';
      renderSummary(visible, diag);
      if (!visible.length) {
        $empty.hidden = false;
        return;
      }
      $empty.hidden = true;
      const isAdmin = isCallerAdmin();
      for (const tweak of visible) {
        const d = diag[tweak.id] || {};
        const autoDisabledEntry = autoDisabledMap[tweak.id];
        const isAutoDisabled = !!autoDisabledEntry;
        const hasWarning = (!!d.lastError && !isStaleTweakError(d)) || d.lastMatchCount === 0 || isAutoDisabled;
        const isOrgRequired = tweak.storageScope === 'org_required';
        const isLocallyDisabled = isOrgRequired && tweak.enabled === false;

        const card = document.createElement('li');
        card.className = 'tweak-card';
        if (hasWarning) card.classList.add('has-warning');
        if (isLocallyDisabled) card.classList.add('is-locally-disabled');

        // Row 1: name + optional "Required" badge + slider toggle.
        const name = document.createElement('span');
        name.className = 'name';
        name.textContent = tweak.name || '(unnamed)';
        if (isOrgRequired) {
          const badge = document.createElement('span');
          badge.className = 'jt-tweak-required-badge';
          badge.textContent = 'Required';
          // Authored-by attribution helps members see "this came from
          // <admin name>" rather than guessing.
          if (tweak.authorDisplayName) {
            badge.title = 'Required by your company (' + tweak.authorDisplayName + ')';
          } else {
            badge.title = 'Required by your company';
          }
          name.appendChild(badge);
        }
        card.appendChild(name);

        const toggleLabel = document.createElement('label');
        toggleLabel.className = 'toggle';
        if (isOrgRequired) {
          // Per-account local-disable hatch. Frame copy honestly so the
          // member knows their toggle doesn't affect coworkers.
          toggleLabel.title = isLocallyDisabled
            ? 'Disabled locally on this device — your admin still has this enabled for the org'
            : 'Disable on this device only (your admin still requires it)';
        } else {
          toggleLabel.title = tweak.enabled !== false ? 'Disable this tweak' : 'Enable this tweak';
        }
        const toggleInput = document.createElement('input');
        toggleInput.type = 'checkbox';
        toggleInput.checked = tweak.enabled !== false;
        toggleInput.addEventListener('change', () => toggleTweak(tweak.id, toggleInput.checked));
        const toggleSlider = document.createElement('span');
        toggleSlider.className = 'slider';
        toggleLabel.appendChild(toggleInput);
        toggleLabel.appendChild(toggleSlider);
        card.appendChild(toggleLabel);

        // Row 2: optional description (helps contractors recognize what
        // each tweak does without opening the editor)
        if (tweak.description && typeof tweak.description === 'string' && tweak.description.trim()) {
          const desc = document.createElement('p');
          desc.className = 'jt-tweaks-desc';
          desc.textContent = tweak.description.trim();
          card.appendChild(desc);
        }

        // Row 3: status chip + Edit / Delete actions on a divided footer
        const actions = document.createElement('div');
        actions.className = 'tweak-card-actions';

        const status = document.createElement('span');
        status.className = 'tweak-status-chip';
        if (isAutoDisabled) {
          // Engine auto-disabled this tweak after consecutive zero-match
          // applies — JT likely shipped a UI change that broke the
          // selector. Distinct chip so the user knows it's not their
          // own toggle and there's a Re-enable path below.
          status.classList.add('auto-disabled');
          const icon = document.createElement('span');
          icon.className = 'icon';
          icon.textContent = '⏻';
          const label = document.createElement('span');
          label.className = 'label';
          label.textContent = 'Auto-disabled (UI moved)';
          const since = autoDisabledEntry.since
            ? new Date(autoDisabledEntry.since).toLocaleString()
            : 'recently';
          const lastCount = autoDisabledEntry.lastSuccessfulMatchCount;
          status.title = 'Auto-disabled ' + since +
            (lastCount ? ' (used to match ' + lastCount + ' element' + (lastCount === 1 ? '' : 's') + ')' : '') +
            '. JT likely shipped a UI change. Edit the tweak\'s selector or click Re-enable to retry.';
          status.appendChild(icon);
          status.appendChild(label);
        } else if (d.lastError && !isStaleTweakError(d)) {
          status.classList.add('error');
          const icon = document.createElement('span');
          icon.className = 'icon';
          icon.textContent = '⚠';
          const label = document.createElement('span');
          label.className = 'label';
          label.textContent = 'Error';
          status.title = d.lastError;
          status.appendChild(icon);
          status.appendChild(label);
        } else if (d.lastMatchCount === 0) {
          status.classList.add('warn');
          const icon = document.createElement('span');
          icon.className = 'icon';
          icon.textContent = '⚠';
          const label = document.createElement('span');
          label.className = 'label';
          label.textContent = 'No matches found';
          status.title = 'Selectors matched 0 elements on the last run';
          status.appendChild(icon);
          status.appendChild(label);
        } else if (typeof d.lastMatchCount === 'number') {
          const label = document.createElement('span');
          label.className = 'label';
          label.textContent = d.lastMatchCount + ' match' + (d.lastMatchCount === 1 ? '' : 'es');
          status.appendChild(label);
        }
        actions.appendChild(status);

        // Re-enable button when the engine auto-disabled this tweak.
        // Visible to anyone who could have authored or accepted it
        // (auto-disable applies regardless of admin/member role since
        // the breakage is per-device, not per-permission).
        if (isAutoDisabled) {
          const reBtn = document.createElement('button');
          reBtn.className = 'icon-btn';
          reBtn.textContent = 'Re-enable';
          reBtn.title = 'Clear the auto-disable and retry. If the selector still doesn\'t match, the engine will auto-disable again.';
          reBtn.addEventListener('click', () => clearAutoDisable(tweak.id));
          actions.appendChild(reBtn);

          // Repair opens the in-page builder on the active JobTread tab,
          // pre-loaded with this tweak and the element picker armed, so the
          // user re-clicks the element and the builder regenerates the
          // selector (saved as a new version). Members can repair a personal
          // tweak; only admins can repair an org_required one (matches the
          // Edit gate — a member re-picking would be rejected server-side).
          const canRepair = !isOrgRequired || isAdmin;
          if (canRepair) {
            const repairBtn = document.createElement('button');
            repairBtn.className = 'icon-btn';
            repairBtn.textContent = 'Repair';
            repairBtn.title = 'Open JobTread and re-pick the element to fix this tweak\'s selector.';
            repairBtn.addEventListener('click', () => repairTweak(tweak, repairBtn));
            actions.appendChild(repairBtn);
          }
        }

        // Share is available to anyone who can see the tweak — export strips
        // all org/person data, so even a member viewing an org_required tweak
        // can share a portable copy.
        const shareBtn = document.createElement('button');
        shareBtn.className = 'icon-btn';
        shareBtn.textContent = 'Share';
        shareBtn.title = 'Create a shareable link for this tweak';
        shareBtn.addEventListener('click', () => shareTweak(tweak));
        actions.appendChild(shareBtn);

        // Edit + Delete are gated on role for org_required tweaks. A
        // member can't mutate them — only locally disable via the
        // toggle. Admin/owner sees the buttons either way.
        const canMutate = !isOrgRequired || isAdmin;
        if (canMutate) {
          const editBtn = document.createElement('button');
          editBtn.className = 'icon-btn';
          editBtn.textContent = 'Edit';
          editBtn.title = isOrgRequired
            ? 'Edit this org-required tweak (admin)'
            : 'Open in the tweak editor';
          editBtn.addEventListener('click', () => openEditor(tweak.id));
          actions.appendChild(editBtn);

          const delBtn = document.createElement('button');
          delBtn.className = 'icon-btn danger';
          delBtn.textContent = 'Delete';
          delBtn.title = isOrgRequired
            ? 'Remove this org-required tweak for the whole company (admin)'
            : 'Remove this tweak';
          delBtn.addEventListener('click', () => deleteTweak(tweak.id, tweak.name));
          actions.appendChild(delBtn);
        }

        card.appendChild(actions);
        $list.appendChild(card);
      }
    }

    /**
     * Clear an engine-issued auto-disable for this tweak so it gets
     * retried on the next apply pass. The engine listens on
     * jtTweakAutoDisabled storage changes and re-runs loadAndApply
     * when the map changes. If the selector still doesn't match
     * after re-applying, the engine will auto-disable again.
     */
    async function clearAutoDisable(id) {
      try {
        const stored = await chrome.storage.local.get(['jtTweakAutoDisabled']);
        const map = (stored.jtTweakAutoDisabled && typeof stored.jtTweakAutoDisabled === 'object')
          ? { ...stored.jtTweakAutoDisabled }
          : {};
        delete map[id];
        await chrome.storage.local.set({ jtTweakAutoDisabled: map });
        // Also clear any "auto-disabled: ..." lastError so the chip flips
        // back to a neutral state until the next apply records fresh data.
        const diagStored = await chrome.storage.local.get(['jtTweakDiagnostics']);
        const diagMap = { ...(diagStored.jtTweakDiagnostics || {}) };
        if (diagMap[id] && typeof diagMap[id].lastError === 'string' && diagMap[id].lastError.startsWith('auto-disabled:')) {
          diagMap[id] = { ...diagMap[id], lastError: null, lastErrorAt: null };
          await chrome.storage.local.set({ jtTweakDiagnostics: diagMap });
        }
      } catch (e) {
        console.warn('clearAutoDisable failed:', e);
      }
      render();
    }

    /**
     * Repair an auto-disabled tweak. The builder runs on the JobTread page
     * (content-script context), not here, so we message the active JT tab to
     * open the builder pre-loaded with this tweak and the picker armed. The
     * user re-clicks the element; the builder regenerates the selector and
     * saves as an update (reusing the tweak's id → new version). If no JT tab
     * is open we can't reach the builder, so show an inline hint on the button.
     */
    async function repairTweak(tweak, btn) {
      const original = btn ? btn.textContent : null;
      const tab = await findJtTab();
      if (!tab) {
        if (btn) {
          btn.textContent = 'Open JobTread to repair';
          setTimeout(() => { btn.textContent = original; }, 2200);
        }
        return;
      }
      try {
        await chrome.tabs.update(tab.id, { active: true });
        await chrome.tabs.sendMessage(tab.id, { type: 'TWEAK_OPEN_REPAIR', tweak });
        // Land the user on JT so they can re-pick the element. Keep the side
        // panel open (closing it would collapse the pinned sidebar); the
        // picker + builder run on the page itself either way.
        if (!IS_IN_SIDE_PANEL) window.close();
      } catch (err) {
        if (btn) {
          btn.textContent = 'JT tab not ready — reload it';
          setTimeout(() => { btn.textContent = original; }, 2200);
        }
      }
    }

    async function toggleTweak(id, enabled) {
      // Phase 2: route through the server's per-account state endpoint.
      // For personal tweaks owned by the caller, this writes their state
      // override; for org_required tweaks it's the local-disable hatch.
      // Always also mutate the local cache — engine's storage listener
      // picks up the change instantly.
      if (window.TweaksApi && window.TweaksApi.isAvailable()) {
        try {
          await window.TweaksApi.setState(id, { enabled });
        } catch (err) {
          console.warn('TweaksApi.setState failed, falling back to cache only:', err.message);
        }
      }
      await window.TweakStorage.updateById(id, (t) => { t.enabled = enabled; });
    }

    async function deleteTweak(id, name) {
      if (!confirm('Delete tweak "' + (name || '(unnamed)') + '"?')) return;
      // Server delete first — if it rejects (e.g., member trying to
      // delete an org_required tweak), DO NOT mutate cache. Otherwise
      // the tweak would briefly disappear, then reappear on next refresh.
      if (window.TweaksApi && window.TweaksApi.isAvailable()) {
        try {
          await window.TweaksApi.remove(id);
        } catch (err) {
          alert('Could not delete tweak: ' + err.message);
          return;
        }
      }
      await window.TweakStorage.removeById(id);
      render();
    }

    function openEditor(id) {
      const url = chrome.runtime.getURL('tweaks/edit.html') + (id ? '?id=' + id : '?new=1');
      chrome.tabs.create({ url });
    }

    async function shareTweak(tweak) {
      if (!window.TweakPort) { showStatus('Share unavailable on this page', 'error'); return; }
      if (!window.TweaksApi || !window.TweaksApi.isAvailable()) {
        showStatus('Log in to share a tweak', 'error');
        return;
      }
      try {
        const envelope = window.TweakPort.exportTweak(tweak);
        const result = await window.TweaksApi.share(envelope);
        if (!result || !result.url) throw new Error('No URL returned');
        const $shareDialog = document.querySelector('[data-share-dialog]');
        const $shareUrl = $shareDialog ? $shareDialog.querySelector('[data-share-url]') : null;
        if ($shareUrl) $shareUrl.value = result.url;
        try { await navigator.clipboard.writeText(result.url); } catch (_e) { /* ignore */ }
        if ($shareDialog && $shareDialog.showModal) {
          $shareDialog.showModal();
        } else {
          showStatus('Share link copied', 'success');
        }
      } catch (err) {
        showStatus('Share failed: ' + (err && err.message ? err.message : 'error'), 'error');
      }
    }

    $importBtn.addEventListener('click', () => {
      $importJson.value = '';
      $importPreview.textContent = '';
      $installBtn.disabled = true;
      $dialog.showModal();
    });
    $newBtn.addEventListener('click', () => openEditor(null));
    $cancelBtn.addEventListener('click', () => $dialog.close());
    $importJson.addEventListener('input', previewImport);
    $installBtn.addEventListener('click', doInstall);

    const $shareDialog = document.querySelector('[data-share-dialog]');
    if ($shareDialog) {
      const $shareClose = $shareDialog.querySelector('[data-action="share-close"]');
      const $shareCopy = $shareDialog.querySelector('[data-action="share-copy"]');
      const $shareUrl = $shareDialog.querySelector('[data-share-url]');
      if ($shareClose) $shareClose.addEventListener('click', () => $shareDialog.close());
      if ($shareCopy) $shareCopy.addEventListener('click', async () => {
        if ($shareUrl) {
          $shareUrl.select();
          try { await navigator.clipboard.writeText($shareUrl.value); } catch (_e) { /* ignore */ }
        }
        $shareCopy.textContent = 'Copied!';
        setTimeout(() => { $shareCopy.textContent = 'Copy link'; }, 1500);
      });
    }

    // "Pick an element on JobTread" buttons — single + multi-view variants.
    // Both send a message to the JT tab to start picker mode. The multi
    // variant lets the user switch JT views between captures and produces
    // one combined AI prompt at the end.
    async function findJtTab() {
      let tab = await new Promise(r => chrome.tabs.query({ active: true, currentWindow: true }, t => r((t && t[0]) || null)));
      if (!tab || !tab.url || !tab.url.startsWith('https://app.jobtread.com')) {
        tab = await new Promise(r => chrome.tabs.query({ url: 'https://app.jobtread.com/*' }, t => {
          if (!t || !t.length) return r(null);
          t.sort((a, b) => (b.lastAccessed || 0) - (a.lastAccessed || 0));
          r(t[0]);
        }));
      }
      return tab;
    }

    async function startPicker(messageType, btn, originalLabel) {
      const tab = await findJtTab();
      if (!tab) {
        btn.textContent = 'Open JobTread first';
        setTimeout(() => { btn.textContent = originalLabel; }, 1800);
        return;
      }
      try {
        await chrome.tabs.update(tab.id, { active: true });
        await chrome.tabs.sendMessage(tab.id, { type: messageType });
        // Close the popup so the user lands on JT for picking — except
        // in side-panel mode, where closing would collapse the pinned
        // sidebar (the picker runs on the page itself either way).
        if (!IS_IN_SIDE_PANEL) window.close();
      } catch (err) {
        btn.textContent = 'JT tab not ready — reload it';
        setTimeout(() => { btn.textContent = originalLabel; }, 2200);
      }
    }

    // Side-panel only: focus stays in the side panel, so the page's crosshair
    // picker and builder-panel Escape handlers never receive the keydown.
    // Forward Escape to the JobTread tab so they can cancel. Harmless when
    // nothing is active — the page-side handlers guard on their own state.
    if (IS_IN_SIDE_PANEL) {
      document.addEventListener('keydown', async (e) => {
        if (e.key !== 'Escape') return;
        const tab = await findJtTab();
        if (!tab) return;
        try { await chrome.tabs.sendMessage(tab.id, { type: 'JT_TWEAK_CANCEL' }); } catch (_) { /* no receiver */ }
      });
    }

    const $pickBtn = document.querySelector('[data-action="pick"]');
    if ($pickBtn) {
      $pickBtn.addEventListener('click', () => startPicker('INSPECT_START_PICKER', $pickBtn, 'Pick an element on JobTread'));
    }
    const $pickMultiBtn = document.querySelector('[data-action="pick-multi"]');
    if ($pickMultiBtn) {
      // Preserve the original innerHTML (button has a <span> badge inside)
      const originalMultiHTML = $pickMultiBtn.innerHTML;
      $pickMultiBtn.addEventListener('click', async () => {
        const tab = await findJtTab();
        if (!tab) {
          $pickMultiBtn.textContent = 'Open JobTread first';
          setTimeout(() => { $pickMultiBtn.innerHTML = originalMultiHTML; }, 1800);
          return;
        }
        try {
          await chrome.tabs.update(tab.id, { active: true });
          await chrome.tabs.sendMessage(tab.id, { type: 'INSPECT_START_MULTI_PICKER' });
          if (!IS_IN_SIDE_PANEL) window.close();
        } catch (err) {
          $pickMultiBtn.textContent = 'JT tab not ready — reload it';
          setTimeout(() => { $pickMultiBtn.innerHTML = originalMultiHTML; }, 2200);
        }
      });
    }

    const $buildBtn = document.getElementById('tweakBuildBtn');
    if ($buildBtn) {
      $buildBtn.addEventListener('click', () => startPicker('INSPECT_PICK_FOR_BUILDER', $buildBtn, 'Build a tweak'));
    }

    // Safe-mode master switch (B3). Reads/writes chrome.storage.local
    // ['jtTweakSafeMode']; the engine's own storage-change listener applies
    // or tears down tweaks — the popup never messages the page for this.
    const $safeModeToggle = $section.querySelector('[data-tweaks-safemode-toggle]');
    if ($safeModeToggle) {
      chrome.storage.local.get(['jtTweakSafeMode'], (stored) => {
        $safeModeToggle.checked = stored.jtTweakSafeMode === true;
      });
      $safeModeToggle.addEventListener('change', () => {
        chrome.storage.local.set({ jtTweakSafeMode: $safeModeToggle.checked });
      });
      // Reflect changes made elsewhere (another popup/side-panel instance, or
      // the engine) so the toggle never drifts from the stored value.
      chrome.storage.onChanged.addListener((changes, area) => {
        if (area !== 'local' || !changes.jtTweakSafeMode) return;
        $safeModeToggle.checked = changes.jtTweakSafeMode.newValue === true;
      });
    }

    function previewImport() {
      let parsed;
      try {
        parsed = JSON.parse($importJson.value);
      } catch (err) {
        $importPreview.innerHTML = '';
        const span = document.createElement('span');
        span.className = 'err';
        span.textContent = 'Invalid JSON: ' + err.message;
        $importPreview.appendChild(span);
        $installBtn.disabled = true;
        return;
      }
      // Generate a fresh id if missing — lets users paste tweaks without one.
      if (!parsed.id) parsed.id = crypto.randomUUID();
      const v = window.TweakValidator ? window.TweakValidator.validate(parsed) : null;
      if (v && !v.ok) {
        $importPreview.innerHTML = '';
        const span = document.createElement('span');
        span.className = 'err';
        span.textContent = 'Validation: ' + v.errors.map(e => (e.field ? e.field + ': ' : '') + e.reason).join('; ');
        $importPreview.appendChild(span);
        $installBtn.disabled = true;
        return;
      }
      // Preview action match counts on the active JT tab.
      chrome.tabs.query({ url: 'https://app.jobtread.com/*' }, async (tabs) => {
        if (!tabs.length) {
          renderPreviewOk('Looks valid. No JT tab open to preview match counts.', null);
          return;
        }
        try {
          const resp = await chrome.tabs.sendMessage(tabs[0].id, { type: 'TWEAK_DRY_RUN', tweak: parsed });
          const counts = resp && resp.matchCounts ? Object.entries(resp.matchCounts) : [];
          renderPreviewOk('Looks valid.', counts);
        } catch (_e) {
          renderPreviewOk('Looks valid (could not preview matches).', null);
        }
      });
    }

    function renderPreviewOk(msg, counts) {
      $importPreview.innerHTML = '';
      const ok = document.createElement('span');
      ok.className = 'ok';
      ok.textContent = msg;
      $importPreview.appendChild(ok);
      if (Array.isArray(counts)) {
        for (const [sel, n] of counts) {
          const row = document.createElement('div');
          row.textContent = sel + ' \u2192 ' + n + ' matches';
          $importPreview.appendChild(row);
        }
      }
      $installBtn.disabled = false;
    }

    async function doInstall() {
      const parsed = JSON.parse($importJson.value);
      if (!parsed.id) parsed.id = crypto.randomUUID();
      parsed.enabled = parsed.enabled !== false;

      // Decide whether this is a fresh create or an update of an existing
      // tweak — the editor / popup share the same import flow for both.
      await window.TweakStorage.migrateLegacyIfNeeded();
      const existingAll = await window.TweakStorage.readAll();
      const isUpdate = existingAll.some(t => t && t.id === parsed.id);

      // Server-first. If we're online + logged in, send to the server
      // and use the canonical (sanitized) shape it returns. The server
      // also enforces auth (e.g., 403 if a member tried to import an
      // org_required tweak). Fall through to local-only on failure.
      let canonical = parsed;
      if (window.TweaksApi && window.TweaksApi.isAvailable()) {
        try {
          const result = isUpdate
            ? await window.TweaksApi.update(parsed)
            : await window.TweaksApi.create(parsed);
          if (result && result.tweak) canonical = result.tweak;
        } catch (err) {
          $importPreview.innerHTML = '';
          const span = document.createElement('span');
          span.className = 'err';
          span.textContent = 'Server rejected: ' + err.message;
          $importPreview.appendChild(span);
          return;
        }
      }

      // Lands in canonical.scope.jtOrg's bucket; upsert replaces by id on update.
      await window.TweakStorage.upsert(canonical);
      $dialog.close();
      render();
    }
  }

  // popup.js is loaded at the end of <body>, so the DOM is ready by now.
  // Guard for paranoia in case load order ever changes.
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', start, { once: true });
  } else {
    start();
  }
})();

// ════════════════════════════════════════════════════════════════════════
// Job Email Card
// ════════════════════════════════════════════════════════════════════════
//
// Shown above the Features list when:
//   1. The account is on a Power User license tier, AND
//   2. The active browser tab is on a `/jobs/<id>` URL.
//
// Hidden in every other case (free/pro tier, not on a job page, not
// logged in to the extension). Provisions the per-job email address
// via /admin/job-email/address on first open and copies it to the
// clipboard on click. The server endpoint is get-or-create, so opening
// the popup on a job whose address already exists is a fast read.

const JT_JOB_URL_RE = /^https:\/\/app\.jobtread\.com\/jobs\/([^/?#]+)/i;
const JOB_EMAIL_ENDPOINT = '/admin/job-email/address';

/**
 * The JobTread org id for the org shown in a JT tab, via content.js's
 * GET_ORG_CONTEXT. Returns null on any failure — no content script on that
 * tab, org not detected yet, or no grant key configured for it — because a
 * wrong org is worse than no org: the server's own fallback is at least the
 * license's home org rather than a guess.
 */
async function getTabOrgId(tab) {
  if (!tab || !tab.id) return null;
  try {
    const resp = await chrome.tabs.sendMessage(tab.id, { type: 'GET_ORG_CONTEXT' });
    return (resp && resp.orgId) || null;
  } catch (_e) {
    return null;
  }
}

async function initJobEmailCard(tier) {
  const card = document.getElementById('jobEmailCard');
  if (!card) return;

  // Tier gate — Power User only. Free/Pro accounts never see the card.
  if (!tier || typeof LicenseService === 'undefined' ||
      !LicenseService.tierHasFeature(tier, 'mcpAccess')) {
    return;
  }

  // Need a logged-in AccountService — that's what carries the portal
  // JWT used to authenticate /admin/job-email/* calls.
  if (typeof AccountService === 'undefined' ||
      typeof AccountService.isLoggedIn !== 'function' ||
      !AccountService.isLoggedIn()) {
    return;
  }

  // Resolve the active tab's URL, then check whether it's a JT job page.
  const tab = await new Promise((resolve) => {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      resolve((tabs && tabs[0]) || null);
    });
  });
  const url = tab && tab.url;
  const match = url && JT_JOB_URL_RE.exec(url);
  if (!match) return;
  const jobId = match[1];

  // Which org this job belongs to. Job-email rows are keyed
  // (license_id, org_id, job_id), and the server otherwise assumes the
  // license's HOME org — so provisioning from a second org's job filed the
  // address under the wrong company and inbound mail tried to auto-post there.
  // Ask the content script on that tab; a null answer means the server keeps
  // its own default, which is right for a single-org license.
  const orgId = await getTabOrgId(tab);

  // Wire copy button BEFORE the fetch so the user can interact the
  // moment the value lands. The button starts disabled until fetch
  // completes (or fails) so we don't copy an empty string.
  const valueEl = document.getElementById('jobEmailValue');
  const copyBtn = document.getElementById('jobEmailCopy');
  const metaEl = document.getElementById('jobEmailMeta');

  copyBtn.addEventListener('click', async () => {
    const text = valueEl && valueEl.value;
    if (!text) return;
    try {
      await navigator.clipboard.writeText(text);
      copyBtn.classList.add('is-copied');
      copyBtn.title = 'Copied!';
      const icon = copyBtn.querySelector('i');
      if (icon) {
        icon.classList.remove('ph-copy');
        icon.classList.add('ph-check');
      }
      setTimeout(() => {
        copyBtn.classList.remove('is-copied');
        copyBtn.title = 'Copy to clipboard';
        if (icon) {
          icon.classList.remove('ph-check');
          icon.classList.add('ph-copy');
        }
      }, 1500);
    } catch (err) {
      console.error('JobEmail clipboard write failed:', err);
      showJobEmailError('Clipboard permission denied. Select + Ctrl+C instead.');
    }
  });

  card.classList.add('is-visible');

  try {
    const response = await AccountService.authenticatedFetch(JOB_EMAIL_ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(orgId ? { jobId, orgId } : { jobId }),
    });
    const payload = await response.json().catch(() => ({}));

    if (!response.ok) {
      // 403 means the server's tier gate rejected us — the LicenseService
      // tier check above said otherwise, so we treat this as a stale local
      // license cache. Hide the card and let the Account tab handle it.
      if (response.status === 403) {
        card.classList.remove('is-visible');
        return;
      }
      throw new Error(payload && payload.error
        ? payload.error
        : 'HTTP ' + response.status);
    }

    valueEl.value = payload.address || '';
    valueEl.placeholder = '';
    copyBtn.disabled = !payload.address;

    renderJobEmailChips(metaEl, payload);
  } catch (err) {
    console.error('JobEmail fetch failed:', err);
    showJobEmailError(err && err.message
      ? err.message
      : 'Could not load job email address');
  }
}

function showJobEmailError(message) {
  const errorEl = document.getElementById('jobEmailError');
  if (!errorEl) return;
  errorEl.textContent = message;
  errorEl.classList.add('is-visible');
}

// Render the meta line as status chips instead of a `·`-separated string.
// Each fact gets its own pill so state reads at a glance (auto-post on/off,
// inbound mail count). DOM construction is manual — no innerHTML — to keep
// the popup CSP happy and dodge any escaping pitfalls.
function renderJobEmailChips(container, payload) {
  if (!container) return;
  container.textContent = '';

  const autoPostOn = payload.autoPost !== false;
  const autoChip = document.createElement('span');
  autoChip.className = 'je-chip ' + (autoPostOn ? 'is-on' : 'is-off');
  autoChip.title = autoPostOn
    ? 'Inbound emails auto-post to the job as comments'
    : 'Inbound emails are parked for manual review';
  const dot = document.createElement('span');
  dot.className = 'je-chip-dot';
  autoChip.appendChild(dot);
  autoChip.appendChild(document.createTextNode(autoPostOn ? 'Auto-post on' : 'Auto-post off'));
  container.appendChild(autoChip);

  if (typeof payload.emailCount === 'number') {
    const countChip = document.createElement('span');
    countChip.className = 'je-chip';
    const n = payload.emailCount;
    countChip.textContent = n.toLocaleString() + (n === 1 ? ' email' : ' emails');
    container.appendChild(countChip);
  }
}

