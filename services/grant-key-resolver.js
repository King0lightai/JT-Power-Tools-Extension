/**
 * GrantKeyResolver — Resolves the correct extension grant key for the active org.
 *
 * Uses OrgDetector to determine active org, fetches the grant key from the server
 * via the service worker, and caches results for 5 minutes.
 */
const GrantKeyResolver = (() => {
  const CACHE_TTL = 5 * 60 * 1000; // 5 minutes
  let cache = {}; // { orgName: { grantKey, orgId, expiresAt } }
  const inFlight = {}; // { orgName: Promise<grantKey|null> } — dedup concurrent fetches
  const toastShownForOrgs = new Set();

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
          // Distinguish the three silent shapes of "no key": the worker said
          // why, the worker said nothing useful, or the worker never answered.
          const detail = response
            ? (response.error || 'worker returned no key and gave no reason')
            : 'no reply from the extension service worker';
          showMissingKeyToast(orgName, needsSignIn ? 'signin' : 'no-key', detail);
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

  // Show-once guard: while a missing-key toast is up, another call for the
  // same or a different org must not interrupt it. A local timer (independent
  // of the toast's own lifetime, since the toast is now persistent and closed
  // by the user, not on a clock) rather than a DOM check, since the toast is
  // a shared element other features can also be showing.
  const MISSING_KEY_TOAST_GUARD_MS = 8000;
  let missingKeyToastVisible = false;

  function showMissingKeyToast(orgName, reason = 'no-key', detail = '') {
    if (missingKeyToastVisible) return;
    missingKeyToastVisible = true;
    setTimeout(() => { missingKeyToastVisible = false; }, MISSING_KEY_TOAST_GUARD_MS);

    // Two distinct causes get two distinct messages:
    //  - 'signin': no portal account token yet → the user must sign in to the extension
    //  - 'no-key': signed in, but this org has no grant key configured yet
    const isSignIn = reason === 'signin';
    const title = isSignIn
      ? 'Sign in to use API features'
      : `No API key for "${orgName}"`;
    // "no-key" is a catch-all: the org genuinely has no key, the server call
    // failed, the worker returned some other error, or it never replied at
    // all. Those need different fixes and the message named none of them —
    // which sent a real Orion investigation down the wrong path for days,
    // because the only visible symptom was advice to add a key that already
    // existed. Carry the underlying reason so the toast diagnoses itself.
    const reasonSuffix = (!isSignIn && detail) ? ` (${String(detail).slice(0, 120)})` : '';
    const body = isSignIn
      ? `Open the JT Power Tools extension and sign in to your account to enable API features for "${orgName}".`
      : `Add a grant key for this org in the portal to enable API features.${reasonSuffix}`;

    // Persistent + dismissible: the user needs time to reach for the link,
    // and a way to clear the toast themselves once they're done with it.
    window.JTToast.showStructured({
      title,
      body,
      link: isSignIn ? null : { text: 'app.jtpowertools.com', href: 'https://app.jtpowertools.com/dashboard' }
    }, { kind: 'error', persistent: true, dismissible: true });
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
