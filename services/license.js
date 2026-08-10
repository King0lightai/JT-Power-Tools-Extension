// License Verification Service
// Handles secure license key verification via server-side proxy
// v2.0 - Added tier support for Essential, Pro, and Power User subscription levels

const LicenseService = (() => {
  // Debug flag — set to false for production builds to suppress console output
  const DEBUG = false;

  // Safe logging — only outputs when DEBUG is true
  function log(...args) { if (DEBUG) console.log('[License]', ...args); }
  function logError(...args) { if (DEBUG) console.error('[License]', ...args); }
  function logWarn(...args) { if (DEBUG) console.warn('[License]', ...args); }

  // ⚠️ IMPORTANT: Set this to your deployed license proxy URL
  // See server/DEPLOYMENT.md for setup instructions
  const LICENSE_PROXY_URL = 'https://jt-tools-license-proxy.king0light-ai.workers.dev/';

  // Product configuration (kept for compatibility)
  const PRODUCT_PERMALINK = 'jtpowertools';

  // Background re-validation interval.
  //
  // Was 24 hours, which meant a customer who upgraded could sit locked out of
  // the features they had just paid for for the rest of the day — the server
  // knew within seconds and the extension was the last to hear. One hour
  // matches the portal's own re-check cadence; the popup additionally forces a
  // check on open (see FORCE_REVALIDATION_FLOOR), so in practice the interval
  // only covers tabs left open for a long time.
  const REVALIDATION_INTERVAL = 60 * 60 * 1000;

  // Floor for forceRevalidate(). Short enough that a customer who just changed
  // plans can reopen the popup and see it, long enough that reopening in a
  // panic doesn't make a Gumroad call every time. Mirrors the portal's 60s
  // throttle on "Re-check my plan".
  const FORCE_REVALIDATION_FLOOR = 60 * 1000;

  // Offline grace period — if a successful revalidation hasn't completed
  // within this window, deny access. Prevents indefinite premium use after
  // a single valid check (e.g. blocking the proxy host in /etc/hosts).
  const OFFLINE_GRACE_PERIOD = 7 * 24 * 60 * 60 * 1000;

  // Tier definitions - must match server/mcp-server/src/config/tiers.js
  const TIERS = {
    ESSENTIAL: 'essential',
    PRO: 'pro',
    POWER_USER: 'power_user',
    // Agent Core company tiers — above Power User. Server-side is the
    // real gate (mcp-server/src/tiers.js); this mirror is UX only.
    ASSISTANT: 'assistant',
    ASSISTANT_PRO: 'assistant_pro'
  };

  // Tier ordering for "this tier or higher" checks. Keeps tierHasFeature
  // from enumerating every higher tier at every check site.
  const TIER_RANK = {
    [TIERS.ESSENTIAL]: 1,
    [TIERS.PRO]: 2,
    [TIERS.POWER_USER]: 3,
    [TIERS.ASSISTANT]: 4,
    [TIERS.ASSISTANT_PRO]: 5
  };

  function tierAtLeast(tier, floor) {
    return (TIER_RANK[tier] || 0) >= (TIER_RANK[floor] || Infinity);
  }

  // Feature access by tier
  // FREE features - work without any license (hook users)
  const FREE_FEATURES = [
    'formatter',        // Most popular - shows quality
    'darkMode',         // Most popular - instant visual impact
    'contrastFix',      // Accessibility, instant value
    'characterCounter', // Simple utility
    'budgetHierarchy',  // Visual enhancement for budget tables
    'kanbanTypeFilter', // Simple - auto-hide empty Kanban columns
    'autoCollapseGroups', // Simple - collapse 100% complete groups
    'ganttLines',       // Simple visual enhancement for Gantt chart
    'jobAccessCollapse', // Simple UI collapse helper
    'budgetTools',      // Auto Sum — simple totals helper
    'documentSort',     // Sortable column headers on Job > Documents table
    'printScope',       // Print button on the document preview modal
    // Date-driven schedule resequencing. NOTE: the only free feature that talks to
    // the Pave API, so it needs a configured grant key — it degrades to an
    // actionable "connect a grant key" message rather than working DOM-only.
    // Free accounts CAN hold a grant key: portal registration with no license
    // key mints a free-tier license, and the portal's API Keys section is
    // admin-only on every tier. Don't re-gate either without re-tiering this.
    'autoSequence'
  ];

  // ESSENTIAL tier features ($10) - "I want more"
  const ESSENTIAL_FEATURES = [
    'quickNotes',       // Persistent notepad with sync
    'smartJobSwitcher', // Keyboard navigation (J+S, Alt+J)
    'freezeHeader',     // Sticky headers for tables
    'pdfMarkupTools',   // PDF annotations
    'budgetRowHighlight', // Emoji-driven row tinting in budgets
    'orgLogo'           // Admin-managed via portal; requires account (Essential+)
  ];

  // PRO tier features ($20) - "I want premium"
  // NOTE: 'dragDrop' internal key now represents Schedule & Task Checkboxes
  // (JobTread launched native drag-drop, so we pivoted to checkbox completion)
  const PRO_FEATURES = [
    'dragDrop',         // Schedule & Task Checkboxes (legacy key name)
    'rgbTheme',         // Custom color theming
    'previewMode',      // Live markdown preview
    'reverseThreadOrder', // Reverse message thread order
    'availabilityFilter', // Team availability filtering
    'tweakEngine',      // User Tweaks engine (CSS + DOM verbs)
    'tweakBuilder',     // Visual tweak builder panel (companion to tweakEngine)
    'inspectForAi'      // Alt-click DOM inspector for AI-authored tweaks
  ];

  // POWER USER tier features ($30) - "I want everything + AI"
  const POWER_USER_FEATURES = [
    'customFieldFilter', // API-powered job filtering
    'budgetChangelog',   // Compare budget backups
    'taskTypeFilter',    // Power-user schedule filtering
    'mcpAccess',         // AI integration
    'aiKnowledge',       // AI-powered assistance
    'forms',             // Per-job Forms drawer (template-driven submissions)
    'paveCapture',       // Record real Pave queries for the MCP (jt_captured_queries)
    'invoiceForecast'    // Org-wide invoice release forecast in /reports (API-powered)
  ];

  // INTERNAL features - always enabled, not user-toggleable, bypass tier check
  // ASSISTANT features - Agent Core ($99/mo per company)
  const ASSISTANT_FEATURES = [
    'assistantPanel'    // AI Assistant chat panel (server-enforced tier)
  ];

  const INTERNAL_FEATURES = [
    'helpSidebarSupport',
    'keyboardShortcuts'
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
   *
   * EXT-1 (documented / deferred): The extension source is published to a PUBLIC
   * repo (.github/workflows/sync-public.yml), so OBFUSCATION_KEY, the tier lists,
   * and the whole client-side gate are effectively public. Client-side tier gating
   * is therefore NOT a security control — a determined user can forge a license
   * blob in chrome.storage and unlock any purely client-side premium feature
   * (rgbTheme, previewMode, tweak engine/builder, etc.). This cannot be made
   * unbreakable in a public-source extension and must not be treated as such.
   * The `signature` field returned by the proxy is stored (verifyLicense) but not
   * verified here because doing so safely requires server-issued public-key
   * material that isn't shipped with the client — verifying against anything in
   * this file would add no real protection. The real defense is that all
   * high-value features already round-trip to the Worker (API, AI, forms,
   * invoice-forecast), which re-validates the license server-side on every call.
   * Any NEW feature of real monetary value must be server-gated the same way
   * rather than relying on this client tier check.
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
          tier: result.data.tier || TIERS.ESSENTIAL, // Store tier (default to lowest paid tier — never fail open to PRO)
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
      return window.Obfuscation.obfuscate(text, OBFUSCATION_KEY);
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
      return window.Obfuscation.deobfuscate(obfuscatedText, OBFUSCATION_KEY);
    } catch (error) {
      logError('Deobfuscation error:', error);
      return null;
    }
  }

  /**
   * Save license data to storage (obfuscated).
   * SECURITY (EXT-4): stored in chrome.storage.local ONLY. The license blob
   * contains the Gumroad key, purchase email, and tier — writing it to
   * chrome.storage.sync replicates that PII to Google's cloud and every signed-in
   * device, and the XOR obfuscation is not encryption. Grant keys and JWTs are
   * already local-only for the same reason.
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

      // Local only — never replicate the license blob to cloud sync.
      await chrome.storage.local.set(payload).catch(e => logError('Local save failed:', e));
      // Purge any stale sync copy written by pre-EXT-4 versions.
      cleanupStaleSyncLicense();
      log('License data saved (local)');
    } catch (error) {
      logError('Error saving license data:', error);
    }
  }

  /**
   * One-time cleanup: remove the stale license blob from chrome.storage.sync.
   * Older versions replicated the license to sync; EXT-4 keeps it local-only,
   * so purge any lingering cloud copy. Idempotent and safe to call repeatedly.
   */
  function cleanupStaleSyncLicense() {
    chrome.storage.sync
      .remove(['jtToolsLicense', 'jtToolsLicenseVersion'])
      .catch(e => logError('Failed to purge stale sync license:', e));
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
   * Get stored license data (deobfuscate if needed).
   * SECURITY (EXT-4): local storage is the primary (and only) store. Sync is
   * read once as a legacy fallback for installs that predate EXT-4, then the
   * blob is migrated to local and purged from sync.
   * @returns {Promise<Object|null>} License data object or null
   */
  async function getLicenseData() {
    try {
      const keys = ['jtToolsLicense', 'jtToolsLicenseVersion'];

      // Local is the primary store.
      const localResult = await chrome.storage.local.get(keys);
      let licenseData = parseLicenseFromStorage(localResult);

      if (licenseData) {
        // Handle legacy v1 → v2 migration
        if (typeof localResult.jtToolsLicense === 'object') {
          log('Migrating legacy license data to obfuscated format');
          await saveLicenseData(licenseData);
        }
        // Purge any stale cloud copy left by pre-EXT-4 versions.
        cleanupStaleSyncLicense();
        return licenseData;
      }

      // Local empty — try legacy sync copy (pre-EXT-4 installs), then migrate
      // it to local-only and remove it from cloud sync.
      const syncResult = await chrome.storage.sync.get(keys);
      licenseData = parseLicenseFromStorage(syncResult);

      if (licenseData) {
        log('License recovered from legacy sync storage — migrating to local only');
        await saveLicenseData(licenseData); // writes local + purges sync
        return licenseData;
      }

      return null;
    } catch (error) {
      logError('Error getting license data:', error);
      return null;
    }
  }

  // Check if user has valid premium license (with re-validation)
  // Evaluate a re-validation result for hasValidLicense.
  // Returns false to deny access, true to grant temporary (offline) access,
  // or null when the result is successful and the caller should continue.
  function evaluateRevalidationResult(result, timeSinceRevalidation) {
    if (result.success) {
      return null;
    }
    // If re-validation failed due to network, allow temporary access
    // ONLY if we're still within the offline grace period.
    if (result.silent) {
      if (timeSinceRevalidation > OFFLINE_GRACE_PERIOD) {
        logWarn('Re-validation failed (network) and offline grace period exceeded — denying access');
        return false;
      }
      logWarn('Re-validation failed (network), allowing temporary access');
      return true;
    }
    // If license was actually revoked, deny access
    return false;
  }

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
          const decision = evaluateRevalidationResult(result, timeSinceRevalidation);
          if (decision !== null) return decision;
        } else {
          // Start new revalidation with lock
          revalidationInProgress = true;
          revalidationPromise = revalidateLicense();

          try {
            const result = await revalidationPromise;
            const decision = evaluateRevalidationResult(result, timeSinceRevalidation);
            if (decision !== null) return decision;
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

  /**
   * Re-check the plan now, ignoring the background interval.
   *
   * The escape hatch for a customer whose plan change hasn't landed yet: the
   * popup calls this on open so upgrading and then opening the popup is enough
   * to see the new tier, rather than waiting out an interval. Throttled by
   * FORCE_REVALIDATION_FLOOR so repeated opens don't each cost a Gumroad call.
   *
   * @returns {Promise<{changed: boolean, tier: string|null, throttled?: boolean}>}
   */
  async function forceRevalidate() {
    const licenseData = await getLicenseData();
    if (!licenseData || !licenseData.key) {
      return { changed: false, tier: null };
    }

    const previousTier = licenseData.tier || null;
    const lastRevalidated = licenseData.lastRevalidated || licenseData.verifiedAt || 0;
    if (Date.now() - lastRevalidated < FORCE_REVALIDATION_FLOOR) {
      return { changed: false, tier: previousTier, throttled: true };
    }

    // Reuse the in-flight revalidation if one is already running, so opening
    // the popup mid-background-check doesn't fire a second request.
    let result;
    if (revalidationInProgress && revalidationPromise) {
      result = await revalidationPromise;
    } else {
      revalidationInProgress = true;
      revalidationPromise = revalidateLicense();
      try {
        result = await revalidationPromise;
      } finally {
        revalidationInProgress = false;
        revalidationPromise = null;
      }
    }

    // A failed re-check (revoked, cancelled, network) leaves nothing to report
    // a tier from — removeLicense() has already run for the non-network cases.
    const tier = result?.success ? (result.data?.tier || null) : null;
    return { changed: tier !== previousTier, tier };
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
   * Read the tier from the logged-in portal account, straight from
   * chrome.storage.local so it works in any context (popup and content-script
   * gate) without depending on AccountService being initialized or loaded first.
   * Only returns a known tier; anything else is treated as absent.
   * @returns {Promise<string|null>}
   */
  async function getAccountTier() {
    try {
      const stored = await chrome.storage.local.get(['jtAccountUserData']);
      const t = stored && stored.jtAccountUserData && stored.jtAccountUserData.tier;
      return TIER_RANK[t] ? t : null;
    } catch (error) {
      return null;
    }
  }

  /**
   * Resolve the effective tier as the HIGHER of the portal-account tier and the
   * Gumroad license tier. The portal account is the subscription system of
   * record; the Gumroad license is the legacy path. Taking the higher of the two
   * matches the tier the popup shows for a logged-in account while never
   * downgrading a user whose paid license exceeds their account tier. Returns
   * null only when neither grants a tier.
   * @returns {Promise<string|null>} 'essential' | 'pro' | 'power_user' | null
   */
  async function getTier() {
    try {
      const licenseData = await getLicenseData();
      // Default an unspecified-but-valid license to the lowest paid tier — never fail open to PRO.
      const licenseTier = (licenseData && licenseData.valid)
        ? (licenseData.tier || TIERS.ESSENTIAL)
        : null;
      const accountTier = await getAccountTier();

      if (!licenseTier && !accountTier) return null;
      const rank = (t) => TIER_RANK[t] || 0;
      return rank(accountTier) >= rank(licenseTier) ? accountTier : licenseTier;
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
   * Check if a feature is internal (always enabled, bypasses tier check).
   * @param {string} feature
   * @returns {boolean}
   */
  function isInternalFeature(feature) {
    return INTERNAL_FEATURES.includes(feature);
  }

  /**
   * Check if a feature requires a paid license (i.e. is in any non-FREE tier).
   * Single source of truth — replaces the old JTDefaults.isPremiumFeature.
   * Internal and FREE features return false.
   * @param {string} feature
   * @returns {boolean}
   */
  function requiresLicense(feature) {
    if (INTERNAL_FEATURES.includes(feature)) return false;
    if (FREE_FEATURES.includes(feature)) return false;
    return (
      ESSENTIAL_FEATURES.includes(feature) ||
      PRO_FEATURES.includes(feature) ||
      POWER_USER_FEATURES.includes(feature) ||
      ASSISTANT_FEATURES.includes(feature)
    );
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

    // Rank-based: each feature band is available to its tier and above,
    // so the Assistant company tiers inherit everything below them.
    if (ESSENTIAL_FEATURES.includes(feature)) {
      return tierAtLeast(tier, TIERS.ESSENTIAL);
    }

    if (PRO_FEATURES.includes(feature)) {
      return tierAtLeast(tier, TIERS.PRO);
    }

    if (POWER_USER_FEATURES.includes(feature)) {
      return tierAtLeast(tier, TIERS.POWER_USER);
    }

    if (ASSISTANT_FEATURES.includes(feature)) {
      return tierAtLeast(tier, TIERS.ASSISTANT);
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
      case TIERS.ASSISTANT: return 'Assistant';
      case TIERS.ASSISTANT_PRO: return 'Assistant Pro';
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

    // Rank-based: each band applies to its tier and above.
    if (tierAtLeast(tier, TIERS.ESSENTIAL)) {
      features = features.concat(ESSENTIAL_FEATURES);
    }

    if (tierAtLeast(tier, TIERS.PRO)) {
      features = features.concat(PRO_FEATURES);
    }

    if (tierAtLeast(tier, TIERS.POWER_USER)) {
      features = features.concat(POWER_USER_FEATURES);
    }

    if (tierAtLeast(tier, TIERS.ASSISTANT)) {
      features = features.concat(ASSISTANT_FEATURES);
    }

    return features;
  }

  // Public API
  return {
    // License management
    verifyLicense,
    revalidateLicense,
    forceRevalidate,
    getLicenseData,
    hasValidLicense,
    removeLicense,
    checkRevalidationNeeded,

    // Tier management
    getTier,
    tierHasFeature,
    isFeatureFree,
    isInternalFeature,
    requiresLicense,
    getTierDisplayName,
    getFeaturesForTier,

    // Constants
    PRODUCT_PERMALINK,
    TIERS,
    FREE_FEATURES,
    ESSENTIAL_FEATURES,
    PRO_FEATURES,
    POWER_USER_FEATURES,
    ASSISTANT_FEATURES,
    INTERNAL_FEATURES
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
