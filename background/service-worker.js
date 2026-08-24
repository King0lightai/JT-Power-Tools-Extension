/**
 * JT Power Tools - Background Service Worker
 * Handles settings persistence, syncing, and tab communication
 */

// Note: Service workers use importScripts instead of ES modules.

// The browser polyfill must load FIRST and in its own try, because everything
// below depends on what it fixes. It installs the chrome.storage.sync ->
// chrome.storage.local fallback, and this worker reads and writes sync in six
// places — including the migration that moves a raw JobTread grant key out of
// it. On a browser that does not implement storage.sync (Orion), those calls
// throw and the worker's settings and grant-key handling fail, which is what
// left API/grant-key features asking the user to sign in when they already
// had. Content scripts and the popup already load this file; the worker was
// the one context still missing it.
try {
  importScripts('../utils/browser-polyfill.js');
} catch (e) {
  console.warn('JT Power Tools: Could not import browser-polyfill.js', e);
}

// Import shared defaults
try {
  importScripts('../utils/defaults.js');
} catch (e) {
  console.warn('JT Power Tools: Could not import defaults.js, using inline fallback');
}

// Get default settings from shared module or use inline fallback
const defaultSettings = (typeof JTDefaults !== 'undefined' && JTDefaults.getDefaultSettings)
  ? JTDefaults.getDefaultSettings()
  : {
    // Inline fallback - should match defaults.js DEFAULT_SETTINGS
    dragDrop: false, contrastFix: true, formatter: true, previewMode: false,
    darkMode: false, rgbTheme: false, smartJobSwitcher: true, budgetHierarchy: false,
    quickNotes: true, helpSidebarSupport: true, keyboardShortcuts: true, freezeHeader: false,
    characterCounter: false, kanbanTypeFilter: false, autoCollapseGroups: false, documentSort: false, budgetTools: false,
    pdfMarkupTools: true, customFieldFilter: false, budgetChangelog: false,
    assistantPanel: true,
    availabilityFilter: false, ganttLines: true, reverseThreadOrder: false,
    taskTypeFilter: false, editableTables: false,
    autoSequence: false,
    jobAccessCollapse: false,
    orgLogo: false,
    // Forms always loads in the content script but self-gates on the
    // server-side company toggle (Migration 029). Admins control the
    // on/off decision in the JT Power Tools Portal, not here.
    forms: true,
    themeColors: { primary: '#3B82F6', background: '#F3E8FF', text: '#1F1B29' },
    savedThemes: [null, null, null]
  };

/**
 * Safe Chrome storage wrapper for service worker context
 */
const safeStorage = {
  async get(keys, defaults = {}) {
    try {
      const result = await chrome.storage.sync.get(keys);
      return typeof keys === 'string'
        ? { [keys]: result[keys] ?? defaults[keys] }
        : { ...defaults, ...result };
    } catch (error) {
      console.error('JT-Tools Storage Error (get):', error);
      return defaults;
    }
  },

  async set(data) {
    try {
      await chrome.storage.sync.set(data);
      return true;
    } catch (error) {
      console.error('JT-Tools Storage Error (set):', error);
      return false;
    }
  }
};

/**
 * Initialize extension on install or update
 */
chrome.runtime.onInstalled.addListener(async (details) => {
  try {
    console.log('JT Power Tools installed:', details.reason);

    // Set default settings on fresh install
    if (details.reason === 'install') {
      const success = await safeStorage.set({ jtToolsSettings: defaultSettings });
      if (success) {
        console.log('Default settings initialized:', defaultSettings);
      } else {
        console.error('Failed to initialize default settings');
      }
    }

    // Clean up legacy per-user org logo config
    chrome.storage.sync.remove('orgLogos');

    // Security: move the raw JobTread grant key out of chrome.storage.sync
    // (which replicates to Google's cloud + every signed-in device) into
    // chrome.storage.local (device-local), then delete the cloud copy. Runs on
    // install + update; no-op once migrated.
    try {
      const syncApi = await chrome.storage.sync.get('jtToolsApiKey');
      if (syncApi.jtToolsApiKey) {
        const localApi = await chrome.storage.local.get('jtToolsApiKey');
        if (!localApi.jtToolsApiKey) {
          await chrome.storage.local.set({ jtToolsApiKey: syncApi.jtToolsApiKey });
        }
        await chrome.storage.sync.remove('jtToolsApiKey');
        console.log('JT Power Tools: Migrated JobTread grant key from sync to local storage');
      }
    } catch (migrateError) {
      console.error('JT Power Tools: Grant key storage migration failed:', migrateError);
    }

    // On update, merge with existing settings and show release notes
    if (details.reason === 'update') {
      try {
        const result = await safeStorage.get(['jtToolsSettings']);
        const existingSettings = result.jtToolsSettings || {};
        const mergedSettings = { ...defaultSettings, ...existingSettings };

        const success = await safeStorage.set({ jtToolsSettings: mergedSettings });
        if (success) {
          console.log('Settings updated after extension update:', mergedSettings);
        } else {
          console.error('Failed to update settings after extension update');
        }

      } catch (updateError) {
        console.error('Error during extension update process:', updateError);
      }
    }

    // Apply the remembered "open in side panel vs popup" action behavior.
    await initSidePanelPreference();
  } catch (error) {
    console.error('JT Power Tools: Unhandled error in onInstalled listener:', error);
  }
});

/**
 * Side-panel-as-default behavior.
 *
 * The toolbar icon opens EITHER the popup or the side panel, never both — Chrome
 * shows the popup whenever action.default_popup is set. To honor a remembered
 * "Always open in side panel" preference we clear the popup and turn on
 * openPanelOnActionClick; to revert we restore the manifest popup and turn it
 * off. The preference is device-local (chrome.storage.local, like the grant key)
 * under `openInSidePanel`. Programmatic action/panel settings reset to manifest
 * defaults on install/update/reload and browser restart, so we re-apply on
 * onInstalled + onStartup, plus live on storage change.
 */
async function applySidePanelPreference(enabled) {
  try {
    await chrome.action.setPopup({ popup: enabled ? '' : 'popup/popup.html' });
    if (chrome.sidePanel && typeof chrome.sidePanel.setPanelBehavior === 'function') {
      await chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: !!enabled });
    }
  } catch (error) {
    console.error('JT Power Tools: Failed to apply side panel preference:', error);
  }
}

async function initSidePanelPreference() {
  try {
    const { openInSidePanel } = await chrome.storage.local.get('openInSidePanel');
    await applySidePanelPreference(!!openInSidePanel);
  } catch (error) {
    console.error('JT Power Tools: Failed to read side panel preference:', error);
  }
}

chrome.runtime.onStartup.addListener(() => {
  initSidePanelPreference();
});

chrome.storage.onChanged.addListener((changes, areaName) => {
  if (areaName === 'local' && changes.openInSidePanel) {
    applySidePanelPreference(!!changes.openInSidePanel.newValue);
  }
});

/**
 * Listen for messages from popup or content scripts
 */
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  try {
    console.log('Background received message:', message);

    if (!message || !message.type) {
      console.warn('Invalid message received:', message);
      sendResponse({ success: false, error: 'Invalid message format' });
      return false;
    }

    switch (message.type) {
      case 'SETTINGS_UPDATED':
        // Handle settings update asynchronously
        handleSettingsUpdate(message.settings)
          .then(() => {
            sendResponse({ success: true });
          })
          .catch(error => {
            console.error('Failed to handle settings update:', error);
            sendResponse({ success: false, error: error.message });
          });
        return true; // Keep channel open for async response

      case 'GET_SETTINGS':
        // Get settings asynchronously
        getSettings()
          .then(settings => {
            sendResponse({ success: true, settings });
          })
          .catch(error => {
            console.error('Failed to get settings:', error);
            sendResponse({ success: false, error: error.message, settings: defaultSettings });
          });
        return true; // Keep channel open for async response

      case 'UPDATE_TOOLBAR_ICON':
        // Update toolbar icon based on popup theme toggle
        console.log('Received UPDATE_TOOLBAR_ICON, isDark:', message.isDark);
        updateIconForTheme(message.isDark);
        sendResponse({ success: true });
        return false;

      case 'JOBTREAD_API_REQUEST':
        // Proxy API requests from content scripts to bypass CORS
        // Security: Validate sender and enforce URL allowlist
        if (!isAllowedApiSender(sender)) {
          console.warn('JT-Tools API Proxy: Rejected request from untrusted sender:', sender);
          sendResponse({ success: false, error: 'Untrusted sender' });
          return false;
        }
        if (!isAllowedApiUrl(message.url)) {
          console.warn('JT-Tools API Proxy: Rejected request to disallowed URL:', message.url);
          sendResponse({ success: false, error: 'URL not allowed' });
          return false;
        }
        handleApiRequest(message.url, message.options)
          .then(result => {
            sendResponse(result);
          })
          .catch(error => {
            console.error('API proxy request failed:', error);
            sendResponse({ success: false, error: error.message });
          });
        return true; // Keep channel open for async response

      case 'PAVE_CAPTURE_UPLOAD':
        // Ship key-stripped Pave queries to the Worker for the AI capture
        // feature. Proxied through the SW (host_permissions → no CORS).
        if (!isAllowedApiSender(sender)) {
          console.warn('PaveCapture: rejected upload from untrusted sender');
          sendResponse({ success: false, error: 'Untrusted sender' });
          return false;
        }
        handlePaveCaptureUpload(message.grantKey, message.queries)
          .then(result => sendResponse(result))
          .catch(error => {
            console.error('PaveCapture: upload failed:', error);
            sendResponse({ success: false, error: error.message });
          });
        return true; // Keep channel open for async response

      case 'FETCH_EXTENSION_GRANT_KEY':
        // Fetch extension grant key from server for a specific org.
        // Security: this returns a full org API credential — enforce the same
        // sender check its sibling handlers use before doing any work.
        if (!isAllowedApiSender(sender)) {
          const shape = describeSender(sender);
          console.warn('JT-Tools: Rejected grant-key request from untrusted sender:', sender);
          // Carry the shape back so the popup's diagnostics panel can show why.
          // Which of these is false is the whole answer on an engine that
          // populates `sender` differently, and there is no console on a phone.
          sendResponse({ success: false, error: 'Untrusted sender', senderShape: shape });
          return false;
        }
        handleFetchExtensionGrantKey(message.orgName)
          .then(result => {
            sendResponse(result);
          })
          .catch(error => {
            console.error('Failed to fetch extension grant key:', error);
            sendResponse({ success: false, error: error.message });
          });
        return true; // Keep channel open for async response

      default:
        console.warn('Unknown message type:', message.type);
        sendResponse({ success: false, error: 'Unknown message type' });
        return false;
    }
  } catch (error) {
    console.error('JT Power Tools: Unhandled error in message listener:', error);
    sendResponse({ success: false, error: 'Internal error processing message' });
    return false;
  }
});

/**
 * Allowed API origins for the proxy
 * Only these origins can be fetched through the service worker
 */
const ALLOWED_API_ORIGINS = [
  'https://api.jobtread.com',
  'https://app.jobtread.com'
];

/**
 * Proxy request sanitization — the service worker has host_permissions to
 * JobTread and can bypass CORS. If a compromised in-page script or extension
 * page reaches this proxy, we must not forward arbitrary methods, headers, or
 * bodies — particularly not Authorization or Cookie headers which could be
 * used to exfiltrate user tokens.
 *
 * Callers (services/jobtread-api.js, features/budget-changelog.js) only need
 * JSON POST/GET, so that's all we allow.
 */
const PROXY_ALLOWED_METHODS = new Set(['GET', 'POST']);
const PROXY_ALLOWED_CONTENT_TYPES = new Set([
  'application/json',
  'application/json; charset=utf-8',
  'application/json;charset=utf-8'
]);

function sanitizeProxyOptions(options) {
  const opts = (options && typeof options === 'object') ? options : {};

  const rawMethod = typeof opts.method === 'string' ? opts.method.toUpperCase() : 'GET';
  if (!PROXY_ALLOWED_METHODS.has(rawMethod)) {
    throw new Error(`Proxy: method not allowed: ${rawMethod}`);
  }

  // Start from a fresh header object — do NOT inherit anything the caller sent
  // beyond the specific values we vet below.
  const headers = { 'Content-Type': 'application/json' };
  if (opts.headers && typeof opts.headers === 'object') {
    const ct = opts.headers['Content-Type'] || opts.headers['content-type'];
    if (typeof ct === 'string') {
      if (!PROXY_ALLOWED_CONTENT_TYPES.has(ct.toLowerCase())) {
        throw new Error(`Proxy: Content-Type not allowed: ${ct}`);
      }
      headers['Content-Type'] = ct;
    }
  }

  const sanitized = { method: rawMethod, headers, credentials: 'omit' };
  if (rawMethod === 'POST' && opts.body !== undefined) {
    if (typeof opts.body !== 'string') {
      throw new Error('Proxy: body must be a pre-serialized string');
    }
    sanitized.body = opts.body;
  }
  return sanitized;
}

/**
 * Validate that the message sender is trusted
 * Only allows messages from this extension's own scripts or from JobTread tabs
 * @param {Object} sender - Chrome runtime message sender
 * @returns {boolean} True if sender is trusted
 */
function isAllowedApiSender(sender) {
  // Allow messages from the extension itself (popup, other background scripts)
  if (sender.id === chrome.runtime.id && !sender.tab) {
    return true;
  }

  // Allow messages from content scripts running on JobTread
  if (sender.tab && sender.tab.url) {
    try {
      const senderUrl = new URL(sender.tab.url);
      return senderUrl.hostname === 'app.jobtread.com' ||
             senderUrl.hostname.endsWith('.jobtread.com');
    } catch (e) {
      return false;
    }
  }

  // Safari may not provide sender.tab.url due to privacy restrictions
  // Allow if the message comes from our own extension's content script
  if (sender.id === chrome.runtime.id && sender.tab) {
    return true;
  }

  // Last resort: this engine gave us nothing to identify the sender with.
  //
  // chrome.runtime.onMessage only ever delivers messages from THIS extension's
  // own scripts. Neither manifest declares `externally_connectable` and there
  // is no onMessageExternal listener anywhere, so a web page cannot reach this
  // handler at all — and our content scripts only run on app.jobtread.com per
  // the manifest match patterns. A sender we cannot identify is therefore
  // still, by construction, one of our own scripts on a JobTread page.
  //
  // The branch above already accommodates WebKit withholding sender.tab.url;
  // an engine that also omits sender.id fails every check and gets denied,
  // which costs every API-backed feature — the user signs in successfully and
  // is then told to sign in. Allowing here grants nothing the two checks above
  // do not already grant.
  //
  // This reasoning depends entirely on externally_connectable staying absent.
  // tests/features/service-worker-sender-trust.test.js fails if it is ever
  // added to either manifest — read that before loosening anything here.
  if (!sender?.id && !sender?.tab?.url) {
    console.warn(
      'JT-Tools: message sender carries neither id nor tab.url — this engine ' +
      'withholds both. Treating it as same-extension, which is what onMessage ' +
      'guarantees while externally_connectable is unset.'
    );
    return true;
  }

  return false;
}

/**
 * Describe a rejected sender, without leaking anything sensitive.
 *
 * A bare "Untrusted sender" is unactionable on a phone: there is no console to
 * inspect the sender in, and the shape of that object is exactly what varies
 * between engines — WebKit already withholds sender.tab.url (see the branch
 * above), and an engine that also omits sender.id would fail every check here
 * with no way to tell from the outside. Booleans and a hostname only.
 */
function describeSender(sender) {
  let hostname = null;
  if (sender?.tab?.url) {
    try { hostname = new URL(sender.tab.url).hostname; } catch (e) { hostname = '(unparseable)'; }
  }
  return {
    hasId: !!sender?.id,
    idMatches: sender?.id === chrome.runtime.id,
    hasTab: !!sender?.tab,
    hasTabUrl: !!sender?.tab?.url,
    hostname
  };
}

/**
 * Validate that the target URL is in the allowlist
 * Prevents the proxy from being used to fetch arbitrary URLs
 * @param {string} url - URL to validate
 * @returns {boolean} True if URL is allowed
 */
function isAllowedApiUrl(url) {
  if (!url || typeof url !== 'string') return false;

  try {
    const parsed = new URL(url);
    return ALLOWED_API_ORIGINS.some(origin => parsed.origin === origin);
  } catch (e) {
    return false;
  }
}

/**
 * Handle API request proxy for content scripts
 * Background service worker can bypass CORS due to host_permissions
 * @param {string} url - API URL to fetch
 * @param {Object} options - Fetch options (method, headers, body)
 * @returns {Promise<Object>} API response
 */
async function handleApiRequest(url, options) {
  let sanitized;
  try {
    sanitized = sanitizeProxyOptions(options);
  } catch (error) {
    console.warn('JT-Tools API Proxy: rejected caller options:', error.message);
    return { success: false, error: error.message };
  }

  try {
    const response = await fetch(url, sanitized);

    const responseText = await response.text();

    // Try to parse as JSON, fall back to text
    let data;
    try {
      data = JSON.parse(responseText);
    } catch (e) {
      data = responseText;
    }

    return {
      success: response.ok,
      status: response.status,
      statusText: response.statusText,
      data: data,
      isJson: typeof data === 'object'
    };
  } catch (error) {
    console.error('JT-Tools API Proxy: Fetch error:', error);
    return {
      success: false,
      error: error.message,
      isNetworkError: true
    };
  }
}

/**
 * Upload captured Pave queries to the Worker's /capture/queries endpoint.
 *
 * Auth is the grantKey embedded in the payload (the Worker resolves it to a
 * user/org namespace), NOT a portal token — so this is intentionally simple.
 * The endpoint is hard-coded (single allowed target) to keep the proxy from
 * becoming a general-purpose outbound relay.
 *
 * @param {string} grantKey - JobTread grant key from the captured traffic
 * @param {Array} queries - [{ query, operation, entity, type }]
 * @returns {Promise<Object>} { success, stored } or { success: false, error }
 */
async function handlePaveCaptureUpload(grantKey, queries) {
  if (!grantKey || typeof grantKey !== 'string') {
    return { success: false, error: 'Missing grantKey' };
  }
  if (!Array.isArray(queries) || queries.length === 0) {
    return { success: false, error: 'No queries to upload' };
  }

  const CAPTURE_URL = 'https://jobtread-mcp-server.king0light-ai.workers.dev/capture/queries';

  try {
    const response = await fetch(CAPTURE_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'omit',
      body: JSON.stringify({ grantKey, queries }),
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      return { success: false, error: data.error || `HTTP ${response.status}` };
    }
    return { success: true, stored: data.stored || 0 };
  } catch (error) {
    return { success: false, error: error.message, isNetworkError: true };
  }
}

/**
 * Fetch an extension grant key from the server for a specific org name.
 * Uses the portal JWT access token for authentication.
 * @param {string} orgName - Organization name to look up
 * @returns {Promise<Object>} { success, grantKey, orgId, orgName } or { success: false, error }
 */
async function handleFetchExtensionGrantKey(orgName) {
  if (!orgName) {
    return { success: false, error: 'orgName is required' };
  }

  const SERVER_URL = 'https://jobtread-mcp-server.king0light-ai.workers.dev';

  try {
    // Get the portal tokens from local storage
    const stored = await chrome.storage.local.get([
      'jtAccountAccessToken',
      'jtAccountRefreshToken'
    ]);
    let accessToken = stored.jtAccountAccessToken;
    const refreshToken = stored.jtAccountRefreshToken;

    if (!accessToken) {
      return { success: false, error: 'Not authenticated — sign in to the portal first' };
    }

    // Try the request
    let response = await fetch(`${SERVER_URL}/admin/extension-grant-key`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${accessToken}`,
      },
      body: JSON.stringify({ orgName }),
    });

    // If 401 and we have a refresh token, try refreshing
    if (response.status === 401 && refreshToken) {
      const refreshResponse = await fetch(`${SERVER_URL}/auth/refresh`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ refreshToken }),
      });

      if (refreshResponse.ok) {
        const refreshData = await refreshResponse.json();
        accessToken = refreshData.accessToken;

        // Store the new tokens. Expiry must be persisted too — without it,
        // AccountService.isTokenExpiringSoon() reads a stale value and forces
        // a token rotation on every page load.
        const tokenUpdate = {
          jtAccountAccessToken: accessToken,
          jtAccountTokenExpiry: Date.now() + ((refreshData.expiresIn || 900) * 1000)
        };
        if (refreshData.refreshToken) {
          tokenUpdate.jtAccountRefreshToken = refreshData.refreshToken;
        }
        await chrome.storage.local.set(tokenUpdate);

        // Retry the original request with new token
        response = await fetch(`${SERVER_URL}/admin/extension-grant-key`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${accessToken}`,
          },
          body: JSON.stringify({ orgName }),
        });
      }
    }

    const data = await response.json();

    if (!response.ok) {
      const notFound = response.status === 404;
      return { success: false, error: data.error || 'Server error', notFound };
    }

    return {
      success: true,
      grantKey: data.grantKey,
      orgId: data.orgId,
      orgName: data.orgName,
      logoUrl: data.logoUrl || null,
    };
  } catch (error) {
    console.error('Extension grant key fetch error:', error);
    return { success: false, error: error.message };
  }
}

/**
 * Handle settings update
 * @param {Object} settings - New settings to save
 */
async function handleSettingsUpdate(settings) {
  try {
    if (!settings || typeof settings !== 'object') {
      throw new Error('Invalid settings object provided');
    }

    console.log('Settings updated:', settings);

    // Store in Chrome storage
    const success = await safeStorage.set({ jtToolsSettings: settings });
    if (!success) {
      throw new Error('Failed to save settings to storage');
    }

    // Notify all JobTread tabs about the settings change
    try {
      const tabs = await chrome.tabs.query({ url: 'https://*.jobtread.com/*' });

      // Use Promise.allSettled to handle all tab notifications
      const notifications = tabs.map(tab =>
        chrome.tabs.sendMessage(tab.id, {
          type: 'SETTINGS_CHANGED',
          settings: settings
        }).catch(err => {
          // Tab might not have content script loaded yet, that's okay
          console.log('Could not notify tab:', tab.id, err.message);
          return null;
        })
      );

      await Promise.allSettled(notifications);
      console.log('Notified', tabs.length, 'tabs about settings change');
    } catch (tabError) {
      console.error('Error querying or notifying tabs:', tabError);
      // Don't throw - settings were saved successfully even if notifications failed
    }
  } catch (error) {
    console.error('JT Power Tools: Error in handleSettingsUpdate:', error);
    throw error; // Re-throw to let caller handle
  }
}

/**
 * Get current settings with fallback to defaults
 * @returns {Promise<Object>} Current settings
 */
async function getSettings() {
  try {
    const result = await safeStorage.get(['jtToolsSettings']);
    const settings = result.jtToolsSettings;

    if (!settings || typeof settings !== 'object') {
      console.warn('Invalid or missing settings, using defaults');
      return defaultSettings;
    }

    // Use JTDefaults.mergeWithDefaults if available for proper deep merge
    if (typeof JTDefaults !== 'undefined' && JTDefaults.mergeWithDefaults) {
      return JTDefaults.mergeWithDefaults(settings);
    }

    // Fallback to shallow merge
    return { ...defaultSettings, ...settings };
  } catch (error) {
    console.error('JT Power Tools: Error in getSettings:', error);
    return defaultSettings;
  }
}

/**
 * Theme-aware icon management
 * Switches extension icon based on browser's color scheme
 */
function getIconSets() {
  return {
    light: {
      '16': chrome.runtime.getURL('icons/icon16-light.png'),
      '48': chrome.runtime.getURL('icons/icon48-light.png'),
      '128': chrome.runtime.getURL('icons/icon128-light.png')
    },
    dark: {
      '16': chrome.runtime.getURL('icons/icon16-dark.png'),
      '48': chrome.runtime.getURL('icons/icon48-dark.png'),
      '128': chrome.runtime.getURL('icons/icon128-dark.png')
    }
  };
}

/**
 * Update extension icon based on system color scheme
 * @param {boolean} isDark - Whether system is in dark mode
 */
function updateIconForTheme(isDark) {
  const iconSets = getIconSets();
  const iconSet = isDark ? iconSets.dark : iconSets.light;
  console.log('JT Power Tools: Setting icon paths:', iconSet);
  chrome.action.setIcon({ path: iconSet })
    .then(() => {
      console.log('JT Power Tools: Icon updated for', isDark ? 'dark' : 'light', 'theme');
    })
    .catch((error) => {
      console.error('JT Power Tools: Failed to update icon:', error);
    });
}

/**
 * Initialize theme-aware icons
 * Loads saved popup theme preference or falls back to system preference
 */
async function initThemeAwareIcons() {
  try {
    // First, check if user has a saved popup theme preference
    const result = await chrome.storage.local.get(['jtPopupTheme']);

    if (result.jtPopupTheme) {
      // Use saved preference
      const isDark = result.jtPopupTheme === 'dark';
      updateIconForTheme(isDark);
      console.log('JT Power Tools: Icon set from saved preference:', isDark ? 'dark' : 'light');
    } else if (typeof matchMedia !== 'undefined') {
      // Fall back to system preference
      const darkModeQuery = matchMedia('(prefers-color-scheme: dark)');
      updateIconForTheme(darkModeQuery.matches);

      // Listen for system theme changes (only if no saved preference)
      darkModeQuery.addEventListener('change', async (e) => {
        // Check if user has set a preference
        const saved = await chrome.storage.local.get(['jtPopupTheme']);
        if (!saved.jtPopupTheme) {
          updateIconForTheme(e.matches);
        }
      });

      console.log('JT Power Tools: Theme-aware icons initialized (system preference)');
    } else {
      console.warn('JT Power Tools: matchMedia not available, using default icons');
    }
  } catch (error) {
    console.error('JT Power Tools: Error initializing theme-aware icons:', error);
  }
}

// Initialize theme-aware icons when service worker starts
initThemeAwareIcons();

console.log('JT Power Tools background service worker loaded');
