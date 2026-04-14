// License Verification Service
// Handles secure license key verification via server-side proxy
// v2.0 - Added tier support for Essential, Pro, and Power User subscription levels

const LicenseService = (() => {
  // Debug flag — set to false for production builds to suppress console output
  const DEBUG = false;

  // Safe logging — only outputs when DEBUG is true
  function log(...args) { if (DEBUG) log('', ...args); }
  function logError(...args) { if (DEBUG) logError('', ...args); }
  function logWarn(...args) { if (DEBUG) logWarn('', ...args); }

  // ⚠️ IMPORTANT: Set this to your deployed license proxy URL
  // See server/DEPLOYMENT.md for setup instructions
  const LICENSE_PROXY_URL = 'https://jt-tools-license-proxy.king0light-ai.workers.dev/';

  // Product configuration (kept for compatibility)
  const PRODUCT_PERMALINK = 'jtpowertools';

  // Re-validation interval (24 hours)
  const REVALIDATION_INTERVAL = 24 * 60 * 60 * 1000;

  // Tier definitions - must match server/mcp-server/src/config/tiers.js
  const TIERS = {
    ESSENTIAL: 'essential',
    PRO: 'pro',
    POWER_USER: 'power_user'
  };

  // Feature access by tier
  // FREE features - work without any license (hook users)
  const FREE_FEATURES = [
    'formatter',        // Most popular - shows quality
    'darkMode',         // Most popular - instant visual impact
    'contrastFix',      // Accessibility, instant value
    'characterCounter', // Simple utility
    'budgetHierarchy',  // Visual enhancement for budget tables
    'kanbanTypeFilter', // Simple - auto-hide empty Kanban columns
    'autoCollapseGroups' // Simple - collapse 100% complete groups
  ];

  // ESSENTIAL tier features ($10) - "I want more"
  const ESSENTIAL_FEATURES = [
    'quickNotes',       // Persistent notepad with sync
    'smartJobSwitcher', // Keyboard navigation (J+S, Alt+J)
    'freezeHeader',     // Sticky headers for tables
    'pdfMarkupTools'    // PDF annotations
  ];

  // PRO tier features ($20) - "I want premium"
  // NOTE: 'dragDrop' internal key now represents Schedule & Task Checkboxes
  // (JobTread launched native drag-drop, so we pivoted to checkbox completion)
  const PRO_FEATURES = [
    'dragDrop',         // Schedule & Task Checkboxes (legacy key name)
    'rgbTheme',         // Custom color theming
    'previewMode'       // Live markdown preview
  ];

  // POWER USER tier features ($30) - "I want everything + AI"
  const POWER_USER_FEATURES = [
    'customFieldFilter', // API-powered job filtering
    'budgetChangelog',   // Compare budget backups
    'mcpAccess',         // AI integration
    'aiKnowledge'        // AI-powered assistance
  ];

  /**
   * SECURITY NOTE: This is NOT cryptographic encryption.
   * XOR with a static key provides only basic obfuscation to prevent casual inspection.
   * The actual security comes from server-side validation via the license proxy.
   * This obfuscation is used to:
   * 1. Prevent license data from being trivially readable in Chrome storage
   * 2. Deter casual tampering (though not prevent determined attackers)
   *
   * True security is enforced by:
   * - Server-side license validation every 24 hours
   * - License revocation capabilities on the server
   */
  const OBFUSCATION_KEY = 'jt-power-tools-v1';

  // Revalidation lock to prevent concurrent revalidation attempts (fix race condition)
  let revalidationInProgress = false;
  let revalidationPromise = null;

  // Verify license key via secure proxy
  async function verifyLicense(licenseKey) {
    try {
      if (LICENSE_PROXY_URL.includes('YOUR_WORKER_URL')) {
        logError('LICENSE_PROXY_URL not configured!');
        return {
          success: false,
          error: 'License validation not configured. Please deploy the license proxy server.'
        };
      }

      log('Verifying license key via proxy...');

      // Call our secure proxy server instead of Gumroad directly
      const response = await fetch(LICENSE_PROXY_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          licenseKey: licenseKey,
          action: 'verify'
        })
      });

      if (!response.ok) {
        throw new Error(`Proxy returned ${response.status}`);
      }

      const result = await response.json();

      if (result.success && result.data) {
        // License is valid - encrypt and store
        const licenseData = {
          valid: true,
          key: licenseKey,
          tier: result.data.tier || TIERS.PRO, // NEW: Store tier (default to PRO for backwards compatibility)
          purchaseEmail: result.data.purchaseEmail,
          productName: result.data.productName,
          purchaseDate: result.data.purchaseDate,
          variantName: result.data.variantName || null, // Store variant for debugging
          verifiedAt: result.data.verifiedAt,
          signature: result.data.signature,
          lastRevalidated: Date.now()
        };

        // Encrypt and store license data
        await saveLicenseData(licenseData);

        log('Valid license activated, tier:', licenseData.tier);
        return { success: true, data: licenseData };
      } else {
        // License is invalid
        log('Invalid license key');
        return { success: false, error: result.error || 'Invalid license key' };
      }
    } catch (error) {
      logError('Error verifying license:', error);
      return {
        success: false,
        error: 'Unable to verify license. Please check your internet connection and try again.'
      };
    }
  }

  // Re-validate existing license (periodic check)
  async function revalidateLicense() {
    try {
      const licenseData = await getLicenseData();

      if (!licenseData || !licenseData.key) {
        return { success: false, error: 'No license to revalidate' };
      }

      log('Re-validating existing license...');

      const response = await fetch(LICENSE_PROXY_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          licenseKey: licenseData.key,
          action: 'revalidate'
        })
      });

      if (!response.ok) {
        throw new Error(`Proxy returned ${response.status}`);
      }

      const result = await response.json();

      if (result.success && result.data) {
        // Update stored license data (including tier in case of upgrade)
        licenseData.lastRevalidated = Date.now();
        licenseData.signature = result.data.signature;
        // Update tier in case user upgraded their subscription
        if (result.data.tier) {
          const oldTier = licenseData.tier;
          licenseData.tier = result.data.tier;
          if (oldTier !== licenseData.tier) {
            log('Tier changed from', oldTier, 'to', licenseData.tier);
          }
        }
        await saveLicenseData(licenseData);

        log('Re-validation successful, tier:', licenseData.tier);
        return { success: true, data: licenseData };
      } else {
        // License no longer valid (refunded, revoked, etc.)
        logWarn('Re-validation failed - license may be revoked');
        await removeLicense();
        return { success: false, error: 'License is no longer valid' };
      }
    } catch (error) {
      logError('Error re-validating license:', error);
      // Don't remove license on network errors, just skip re-validation
      return { success: false, error: 'Re-validation failed', silent: true };
    }
  }

  /**
   * Obfuscate license data using XOR
   * NOTE: This is NOT secure encryption - see SECURITY NOTE above
   * @param {string} text - Plain text to obfuscate
   * @returns {string} Base64-encoded obfuscated string
   */
  function obfuscate(text) {
    try {
      const textBytes = new TextEncoder().encode(text);
      const keyBytes = new TextEncoder().encode(OBFUSCATION_KEY);
      const obfuscated = new Uint8Array(textBytes.length);

      for (let i = 0; i < textBytes.length; i++) {
        obfuscated[i] = textBytes[i] ^ keyBytes[i % keyBytes.length];
      }

      // Convert to base64
      return btoa(String.fromCharCode(...obfuscated));
    } catch (error) {
      logError('Obfuscation error:', error);
      return text; // Fallback to plaintext if obfuscation fails
    }
  }

  /**
   * Deobfuscate license data
   * NOTE: This is NOT secure decryption - see SECURITY NOTE above
   * @param {string} obfuscatedText - Base64-encoded obfuscated string
   * @returns {string|null} Original plain text or null on error
   */
  function deobfuscate(obfuscatedText) {
    try {
      // Decode from base64
      const obfuscated = Uint8Array.from(atob(obfuscatedText), c => c.charCodeAt(0));
      const keyBytes = new TextEncoder().encode(OBFUSCATION_KEY);
      const original = new Uint8Array(obfuscated.length);

      for (let i = 0; i < obfuscated.length; i++) {
        original[i] = obfuscated[i] ^ keyBytes[i % keyBytes.length];
      }

      return new TextDecoder().decode(original);
    } catch (error) {
      logError('Deobfuscation error:', error);
      return null;
    }
  }

  /**
   * Save license data to storage (obfuscated)
   * Writes to both sync AND local storage for resilience.
   * Firefox can lose storage.sync data on extension updates when no Firefox Account
   * is connected, so local serves as a fallback.
   * @param {Object} licenseData - License data object to save
   */
  async function saveLicenseData(licenseData) {
    try {
      // Obfuscate sensitive data before storing
      const obfuscated = obfuscate(JSON.stringify(licenseData));
      const payload = {
        jtToolsLicense: obfuscated,
        jtToolsLicenseVersion: 2 // Version flag for obfuscated format
      };

      // Write to both sync and local for cross-update resilience
      await Promise.all([
        chrome.storage.sync.set(payload).catch(e => logError('Sync save failed:', e)),
        chrome.storage.local.set(payload).catch(e => logError('Local save failed:', e))
      ]);
      log('License data saved (sync + local)');
    } catch (error) {
      logError('Error saving license data:', error);
    }
  }

  /**
   * Parse license from a storage result object.
   * @param {Object} result - Storage result with jtToolsLicense and jtToolsLicenseVersion
   * @returns {Object|null} Parsed license data or null
   */
  function parseLicenseFromStorage(result) {
    if (!result.jtToolsLicense) return null;

    // Handle obfuscated data (v2)
    if (result.jtToolsLicenseVersion === 2) {
      const deobfuscated = deobfuscate(result.jtToolsLicense);
      return deobfuscated ? JSON.parse(deobfuscated) : null;
    }

    // Handle legacy plaintext data (v1)
    if (typeof result.jtToolsLicense === 'object') {
      return result.jtToolsLicense;
    }

    return null;
  }

  /**
   * Get stored license data (deobfuscate if needed)
   * Tries sync storage first, falls back to local storage.
   * This prevents Firefox users from being logged out on extension updates
   * when storage.sync is lost (no Firefox Account connected).
   * @returns {Promise<Object|null>} License data object or null
   */
  async function getLicenseData() {
    try {
      const keys = ['jtToolsLicense', 'jtToolsLicenseVersion'];

      // Try sync first (primary)
      const syncResult = await chrome.storage.sync.get(keys);
      let licenseData = parseLicenseFromStorage(syncResult);

      if (licenseData) {
        // Handle legacy v1 → v2 migration
        if (typeof syncResult.jtToolsLicense === 'object') {
          log('Migrating legacy license data to obfuscated format');
          await saveLicenseData(licenseData);
        }
        return licenseData;
      }

      // Sync empty — try local fallback (Firefox update recovery)
      const localResult = await chrome.storage.local.get(keys);
      licenseData = parseLicenseFromStorage(localResult);

      if (licenseData) {
        log('License recovered from local storage fallback — restoring to sync');
        // Restore to sync so future reads are fast
        await chrome.storage.sync.set({
          jtToolsLicense: localResult.jtToolsLicense,
          jtToolsLicenseVersion: localResult.jtToolsLicenseVersion
        }).catch(e => logError('Failed to restore license to sync:', e));
        return licenseData;
      }

      return null;
    } catch (error) {
      logError('Error getting license data:', error);
      return null;
    }
  }

  // Check if user has valid premium license (with re-validation)
  async function hasValidLicense() {
    try {
      const licenseData = await getLicenseData();

      if (!licenseData || !licenseData.valid) {
        return false;
      }

      // Check if re-validation is needed (24 hours since last check)
      const lastRevalidated = licenseData.lastRevalidated || licenseData.verifiedAt;
      const timeSinceRevalidation = Date.now() - lastRevalidated;

      if (timeSinceRevalidation > REVALIDATION_INTERVAL) {
        log('Re-validation required (24 hours elapsed)');

        // If revalidation is already in progress, wait for it
        if (revalidationInProgress && revalidationPromise) {
          log('Revalidation already in progress, waiting...');
          const result = await revalidationPromise;

          if (!result.success) {
            // If re-validation failed due to network, allow temporary access
            if (result.silent) {
              logWarn('Re-validation failed (network), allowing temporary access');
              return true;
            }
            // If license was actually revoked, deny access
            return false;
          }
        } else {
          // Start new revalidation with lock
          revalidationInProgress = true;
          revalidationPromise = revalidateLicense();

          try {
            const result = await revalidationPromise;

            if (!result.success) {
              // If re-validation failed due to network, allow temporary access
              if (result.silent) {
                logWarn('Re-validation failed (network), allowing temporary access');
                return true;
              }
              // If license was actually revoked, deny access
              return false;
            }
          } finally {
            // Release lock
            revalidationInProgress = false;
            revalidationPromise = null;
          }
        }
      }

      return true;
    } catch (error) {
      logError('Error in hasValidLicense:', error);
      // On error, deny access to be safe
      return false;
    }
  }

  // Check if re-validation is needed on startup
  async function checkRevalidationNeeded() {
    const licenseData = await getLicenseData();

    if (!licenseData || !licenseData.valid) {
      return;
    }

    const lastRevalidated = licenseData.lastRevalidated || licenseData.verifiedAt;
    const timeSinceRevalidation = Date.now() - lastRevalidated;

    // If more than 24 hours, trigger re-validation
    if (timeSinceRevalidation > REVALIDATION_INTERVAL) {
      log('Triggering background re-validation on startup');
      revalidateLicense().catch(err => {
        logError('Background re-validation error:', err);
      });
    }
  }

  // Remove license (for deactivation)
  async function removeLicense() {
    const keys = ['jtToolsLicense', 'jtToolsLicenseVersion'];
    await Promise.all([
      chrome.storage.sync.remove(keys),
      chrome.storage.local.remove(keys)
    ]);
    log('License removed (sync + local)');
  }

  /**
   * Get the current subscription tier
   * @returns {Promise<string|null>} Tier name ('essential', 'pro', 'power_user') or null if no license
   */
  async function getTier() {
    try {
      const licenseData = await getLicenseData();
      if (!licenseData || !licenseData.valid) {
        return null;
      }
      // Default to PRO for backwards compatibility with existing users
      return licenseData.tier || TIERS.PRO;
    } catch (error) {
      logError('Error getting tier:', error);
      return null;
    }
  }

  /**
   * Check if a feature is free (works without any license)
   * @param {string} feature - The feature name to check
   * @returns {boolean} True if the feature is free
   */
  function isFeatureFree(feature) {
    return FREE_FEATURES.includes(feature);
  }

  /**
   * Check if a specific feature is available for a given tier
   * @param {string|null} tier - The tier to check ('essential', 'pro', 'power_user', or null)
   * @param {string} feature - The feature name to check
   * @returns {boolean} True if the feature is available for the tier
   */
  function tierHasFeature(tier, feature) {
    // FREE features work for everyone (even without a license)
    if (FREE_FEATURES.includes(feature)) {
      return true;
    }

    // All other features require a license
    if (!tier) {
      return false;
    }

    // ESSENTIAL features available to Essential, Pro, and Power User tiers
    if (ESSENTIAL_FEATURES.includes(feature)) {
      return tier === TIERS.ESSENTIAL || tier === TIERS.PRO || tier === TIERS.POWER_USER;
    }

    // PRO features available to Pro and Power User tiers only
    if (PRO_FEATURES.includes(feature)) {
      return tier === TIERS.PRO || tier === TIERS.POWER_USER;
    }

    // POWER USER features only available to Power User tier
    if (POWER_USER_FEATURES.includes(feature)) {
      return tier === TIERS.POWER_USER;
    }

    // Unknown feature - default to false for safety
    logWarn('Unknown feature requested:', feature);
    return false;
  }

  /**
   * Get the tier display name for UI
   * @param {string} tier - The tier code
   * @returns {string} Human-readable tier name
   */
  function getTierDisplayName(tier) {
    switch (tier) {
      case TIERS.ESSENTIAL: return 'Essential';
      case TIERS.PRO: return 'Pro';
      case TIERS.POWER_USER: return 'Power User';
      default: return tier || 'Unknown';
    }
  }

  /**
   * Get features available for a tier
   * @param {string|null} tier - The tier to check (null = no license, free features only)
   * @returns {string[]} Array of feature names available for the tier
   */
  function getFeaturesForTier(tier) {
    // Free features always available
    let features = [...FREE_FEATURES];

    if (!tier) return features;

    // Essential tier adds Essential features
    if (tier === TIERS.ESSENTIAL || tier === TIERS.PRO || tier === TIERS.POWER_USER) {
      features = features.concat(ESSENTIAL_FEATURES);
    }

    // Pro tier adds Pro features
    if (tier === TIERS.PRO || tier === TIERS.POWER_USER) {
      features = features.concat(PRO_FEATURES);
    }

    // Power User tier adds Power User features
    if (tier === TIERS.POWER_USER) {
      features = features.concat(POWER_USER_FEATURES);
    }

    return features;
  }

  // Public API
  return {
    // License management
    verifyLicense,
    revalidateLicense,
    getLicenseData,
    hasValidLicense,
    removeLicense,
    checkRevalidationNeeded,

    // Tier management
    getTier,
    tierHasFeature,
    isFeatureFree,
    getTierDisplayName,
    getFeaturesForTier,

    // Constants
    PRODUCT_PERMALINK,
    TIERS,
    FREE_FEATURES,
    ESSENTIAL_FEATURES,
    PRO_FEATURES,
    POWER_USER_FEATURES
  };
})();

// Export for use in other scripts
if (typeof window !== 'undefined') {
  window.LicenseService = LicenseService;
}

// Check if re-validation needed on extension startup
if (typeof chrome !== 'undefined' && chrome.runtime) {
  // Run revalidation check when extension loads
  LicenseService.checkRevalidationNeeded();
}
