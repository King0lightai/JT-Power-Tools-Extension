/**
 * JT Power Tools - Background Script (Firefox MV2 compatible)
 * Handles settings persistence, syncing, and tab communication
 *
 * This is the Firefox-compatible version of service-worker.js.
 * Firefox MV2 uses background scripts (not service workers).
 * The browser-polyfill.js is loaded before this script by the manifest,
 * along with defaults.js.
 */

// Get default settings from shared module or use inline fallback
const defaultSettings = (typeof JTDefaults !== 'undefined' && JTDefaults.getDefaultSettings)
  ? JTDefaults.getDefaultSettings()
  : {
      // Inline fallback - should match defaults.js DEFAULT_SETTINGS
      dragDrop: false, contrastFix: true, formatter: true, previewMode: false,
      darkMode: false, rgbTheme: false, smartJobSwitcher: true, budgetHierarchy: false,
      quickNotes: true, helpSidebarSupport: true, keyboardShortcuts: true, freezeHeader: false,
      characterCounter: false, kanbanTypeFilter: false, autoCollapseGroups: false,
      pdfMarkupTools: true, customFieldFilter: false, budgetChangelog: false,
      availabilityFilter: false, ganttLines: true, reverseThreadOrder: false,
      taskTypeFilter: false,
      themeColors: { primary: '#3B82F6', background: '#F3E8FF', text: '#1F1B29' },
      savedThemes: [null, null, null]
    };

/**
 * Safe Chrome storage wrapper for background context
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
  } catch (error) {
    console.error('JT Power Tools: Unhandled error in onInstalled listener:', error);
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
 * Only these origins can be fetched through the background script
 */
const ALLOWED_API_ORIGINS = [
  'https://api.jobtread.com',
  'https://app.jobtread.com'
];

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
  // Note: Only use chrome.runtime.id here — referencing browser?.runtime?.id
  // triggers Safari's WebExtension polyfill (wrappedSendMessage) recursion
  if (sender.id === chrome.runtime.id && sender.tab) {
    return true;
  }

  return false;
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
 * Background script can bypass CORS due to host permissions
 * @param {string} url - API URL to fetch
 * @param {Object} options - Fetch options (method, headers, body)
 * @returns {Promise<Object>} API response
 */
async function handleApiRequest(url, options) {
  try {
    const response = await fetch(url, options);

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
 * Handle settings update
 * @param {Object} settings - New settings to save
 */
async function handleSettingsUpdate(settings) {
  try {
    if (!settings || typeof settings !== 'object') {
      throw new Error('Invalid settings object provided');
    }

    console.log('Settings updated:', settings);

    // Store in storage
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
      "16": chrome.runtime.getURL("icons/icon16-light.png"),
      "48": chrome.runtime.getURL("icons/icon48-light.png"),
      "128": chrome.runtime.getURL("icons/icon128-light.png")
    },
    dark: {
      "16": chrome.runtime.getURL("icons/icon16-dark.png"),
      "48": chrome.runtime.getURL("icons/icon48-dark.png"),
      "128": chrome.runtime.getURL("icons/icon128-dark.png")
    }
  };
}

/**
 * Update extension icon based on system color scheme
 * Uses chrome.action (MV3) or chrome.browserAction (MV2, patched by polyfill)
 * @param {boolean} isDark - Whether system is in dark mode
 */
function updateIconForTheme(isDark) {
  const iconSets = getIconSets();
  const iconSet = isDark ? iconSets.dark : iconSets.light;
  console.log('JT Power Tools: Setting icon paths:', iconSet);

  // chrome.action is polyfilled to chrome.browserAction on Firefox MV2
  const actionApi = chrome.action || chrome.browserAction;
  if (actionApi && actionApi.setIcon) {
    try {
      const result = actionApi.setIcon({ path: iconSet });
      // MV3 returns a Promise, MV2 browserAction.setIcon returns undefined
      if (result && typeof result.then === 'function') {
        result.then(() => {
          console.log('JT Power Tools: Icon updated for', isDark ? 'dark' : 'light', 'theme');
        }).catch((error) => {
          console.error('JT Power Tools: Failed to update icon:', error);
        });
      } else {
        console.log('JT Power Tools: Icon updated for', isDark ? 'dark' : 'light', 'theme');
      }
    } catch (error) {
      console.error('JT Power Tools: Failed to update icon:', error);
    }
  }
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

// Initialize theme-aware icons when background script loads
initThemeAwareIcons();

console.log('JT Power Tools background script loaded');
