/**
 * GrantKeyResolver — Resolves the correct extension grant key for the active org.
 *
 * Uses OrgDetector to determine active org, fetches the grant key from the server
 * via the service worker, and caches results for 5 minutes.
 */
const GrantKeyResolver = (() => {
  const CACHE_TTL = 5 * 60 * 1000; // 5 minutes
  let cache = {}; // { orgName: { grantKey, orgId, expiresAt } }
  let inFlight = {}; // { orgName: Promise<grantKey|null> } — dedup concurrent fetches
  let toastShownForOrgs = new Set();

  /**
   * Check if the extension context is still valid.
   * Returns false after extension reload/update when old content scripts linger.
   */
  function isContextValid() {
    try {
      return !!chrome.runtime && !!chrome.runtime.id;
    } catch {
      return false;
    }
  }

  /**
   * Escape HTML entities to prevent XSS in toast messages.
   * Uses Sanitizer.escapeHTML if available, otherwise a local fallback.
   * @param {string} str - String to escape
   * @returns {string} Escaped string
   */
  function safeEscapeHTML(str) {
    if (window.Sanitizer && typeof window.Sanitizer.escapeHTML === 'function') {
      return window.Sanitizer.escapeHTML(str);
    }
    // Local fallback — escapes the same five chars as Sanitizer.escapeHTML
    // so it's safe in both text-content and attribute-value contexts.
    if (str === null || str === undefined) return '';
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  async function getGrantKey() {
    // Bail silently if extension context was invalidated (reload/update)
    if (!isContextValid()) return null;

    let orgName = window.OrgDetector ? window.OrgDetector.getActiveOrg() : null;

    // If org not detected yet, wait briefly for the SPA header to render.
    // This prevents a race where features call isConfigured() before OrgDetector
    // finds the search bar placeholder. Without this, portal-only users (no legacy
    // storage keys) get "No API configured" on first load.
    if (!orgName && window.OrgDetector) {
      for (let i = 0; i < 5; i++) {
        await new Promise(r => setTimeout(r, 500));
        orgName = window.OrgDetector.getActiveOrg();
        if (orgName) break;
      }
    }

    if (!orgName) {
      return getFallbackGrantKey();
    }

    const cached = cache[orgName];
    if (cached && cached.expiresAt > Date.now()) {
      return cached.grantKey;
    }

    // Dedup: if a fetch for this org is already in flight, return the same promise.
    // Prevents rapid org-switch (A→B→A) from firing parallel fetches that can
    // write results back to the cache out of order.
    if (inFlight[orgName]) {
      return inFlight[orgName];
    }

    const fetchPromise = (async () => {
      try {
        const response = await chrome.runtime.sendMessage({
          type: 'FETCH_EXTENSION_GRANT_KEY',
          orgName
        });

        if (response && response.success && response.grantKey) {
          cache[orgName] = {
            grantKey: response.grantKey,
            orgId: response.orgId,
            logoUrl: response.logoUrl || null,
            expiresAt: Date.now() + CACHE_TTL,
          };
          toastShownForOrgs.delete(orgName);
          return response.grantKey;
        }

        // We have an org name, so we're in multi-org mode.
        // NEVER fall back to legacy keys — that would return another org's key.
        if (!toastShownForOrgs.has(orgName)) {
          toastShownForOrgs.add(orgName);
          // Distinguish "not signed in" from "signed in but no key for this org"
          // so the toast points the user to the right next step.
          const needsSignIn = !!(response && response.error &&
            /not authenticated|sign in/i.test(response.error));
          showMissingKeyToast(orgName, needsSignIn ? 'signin' : 'no-key');
        }
        return null;
      } catch (err) {
        // Any error (network, context invalidated, etc.) when we have an org name:
        // return null, not legacy keys. Legacy keys belong to a different org.
        return null;
      } finally {
        delete inFlight[orgName];
      }
    })();

    inFlight[orgName] = fetchPromise;
    return fetchPromise;
  }

  async function getFallbackGrantKey() {
    if (!isContextValid()) return null;
    try {
      const proResult = await chrome.storage.local.get(['jtpro_grant_key', 'jtpro_grant_key_version']);
      if (proResult.jtpro_grant_key) {
        return proResult.jtpro_grant_key;
      }

      // Grant key now lives in chrome.storage.local; fall back to the legacy
      // sync location for installs not yet migrated by the service worker.
      const localApi = await chrome.storage.local.get(['jtToolsApiKey']);
      if (localApi.jtToolsApiKey) {
        return localApi.jtToolsApiKey;
      }
      const apiResult = await chrome.storage.sync.get(['jtToolsApiKey']);
      if (apiResult.jtToolsApiKey) {
        return apiResult.jtToolsApiKey;
      }

      const accountResult = await chrome.storage.local.get(['jtAccountGrantKey']);
      if (accountResult.jtAccountGrantKey) {
        return accountResult.jtAccountGrantKey;
      }

      return null;
    } catch (err) {
      console.error('GrantKeyResolver: Fallback key lookup failed', err);
      return null;
    }
  }

  function showMissingKeyToast(orgName, reason = 'no-key') {
    if (document.getElementById('jt-missing-key-toast')) return;

    const escapedOrgName = safeEscapeHTML(orgName);

    // Two distinct causes get two distinct messages:
    //  - 'signin': no portal account token yet → the user must sign in to the extension
    //  - 'no-key': signed in, but this org has no grant key configured yet
    const isSignIn = reason === 'signin';
    const title = isSignIn
      ? 'Sign in to use API features'
      : `No API key for "${escapedOrgName}"`;
    const body = isSignIn
      ? `Open the JT Power Tools extension and sign in to your account to enable API features for "${escapedOrgName}".`
      : `Add one at <a href="https://app.jtpowertools.com/dashboard" target="_blank" style="color: #FF6B35; text-decoration: none;">app.jtpowertools.com</a>`;

    const toast = document.createElement('div');
    toast.id = 'jt-missing-key-toast';
    toast.style.cssText = `
      position: fixed; bottom: 24px; right: 24px; z-index: 999999;
      background: #2c2c2c; color: #e0e0e0; border: 1px solid #404040;
      border-radius: 8px; padding: 14px 20px; max-width: 380px;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      font-size: 13px; line-height: 1.5; box-shadow: 0 4px 12px rgba(0,0,0,0.3);
      transition: opacity 0.3s ease, transform 0.3s ease;
      opacity: 0; transform: translateY(10px);
    `;
    toast.innerHTML = `
      <div style="display: flex; align-items: flex-start; gap: 10px;">
        <span style="font-size: 16px; flex-shrink: 0;">&#9888;&#65039;</span>
        <div>
          <div style="font-weight: 600; margin-bottom: 4px;">${title}</div>
          <div style="color: #b0b0b0;">${body}</div>
        </div>
        <button style="background: none; border: none; color: #707070; cursor: pointer; font-size: 16px; padding: 0; margin-left: 8px; flex-shrink: 0;" aria-label="Dismiss notification">&#10005;</button>
      </div>
    `;

    // Attach close handler via addEventListener (no inline onclick)
    const closeBtn = toast.querySelector('button');
    if (closeBtn) {
      closeBtn.addEventListener('click', () => toast.remove());
    }

    document.body.appendChild(toast);

    requestAnimationFrame(() => {
      toast.style.opacity = '1';
      toast.style.transform = 'translateY(0)';
    });

    setTimeout(() => {
      if (toast.parentElement) {
        toast.style.opacity = '0';
        toast.style.transform = 'translateY(10px)';
        setTimeout(() => toast.remove(), 300);
      }
    }, 8000);
  }

  function invalidateCache() {
    cache = {};
    toastShownForOrgs.clear();
  }

  // Note: we deliberately do NOT clear the cache on `jt-org-changed`.
  // The cache is keyed by orgName, so each org has its own independent
  // entry — switching orgs reads the correct entry. In-flight fetch dedup
  // (see `inFlight` above) handles the rapid-switch race.

  /**
   * Get the logo URL for the current org from cached grant key data.
   * Returns { orgName, logoUrl } so callers can verify the response matches
   * the org that was active when they called. Caller is expected to compare
   * the returned orgName against the currently-active org before painting.
   */
  async function getLogoUrl() {
    const orgName = window.OrgDetector ? window.OrgDetector.getActiveOrg() : null;
    if (!orgName) return { orgName: null, logoUrl: null };

    const cached = cache[orgName];
    if (cached && cached.expiresAt > Date.now() && cached.logoUrl !== undefined) {
      return { orgName, logoUrl: cached.logoUrl };
    }

    // Trigger a fetch to populate cache (deduped via inFlight)
    await getGrantKey();

    const refreshedCache = cache[orgName];
    return { orgName, logoUrl: refreshedCache?.logoUrl || null };
  }

  return { getGrantKey, getLogoUrl, invalidateCache, getFallbackGrantKey };
})();

window.GrantKeyResolver = GrantKeyResolver;
