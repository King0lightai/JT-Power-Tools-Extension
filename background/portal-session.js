/**
 * JT Power Tools - Portal session helper for the background context
 *
 * Shared by background/service-worker.js (Chrome/Edge MV3, via importScripts)
 * and background/background.js (Firefox MV2, via the manifest's background
 * scripts). Owns the one place the background context renews the portal
 * session, and the grant-key lookup that depends on it.
 *
 * Why one place: the server rotates the refresh token on every renewal, so
 * the token is single-use. This context used to renew it once per grant-key
 * request, with nothing stopping two requests — the grant-key resolver and
 * Pave Capture in the same tab, or two tabs — from renewing at the same
 * moment with the same token. Two renewals in flight for one token is a race
 * the browser can lose, and losing it means the stored refresh token is dead
 * and the next renewal signs the user out. Everything here funnels through a
 * single in-flight renewal per worker lifetime, and adopts a token another
 * context has already written before asking the server for a new one.
 */
(function (root) {
  'use strict';

  const SERVER_URL = 'https://jobtread-mcp-server.king0light-ai.workers.dev';

  const KEYS = {
    ACCESS: 'jtAccountAccessToken',
    REFRESH: 'jtAccountRefreshToken',
    EXPIRY: 'jtAccountTokenExpiry',
  };

  // The exact set AccountService.clearAuthData() removes, so a session this
  // context finds dead ends up in the same state as one a content script
  // found dead: the popup shows the sign-in form instead of a stale account.
  const AUTH_KEYS = [
    KEYS.ACCESS,
    KEYS.REFRESH,
    'jtAccountUserData',
    KEYS.EXPIRY,
    'jtNotesLastSync',
    'jtAccountGrantKey',
  ];

  const NOT_SIGNED_IN = 'Not authenticated — sign in to the portal first';
  const SESSION_ENDED = 'Not authenticated — your session has ended, sign in to the extension again';

  let inFlightRefresh = null;

  function readTokens() {
    return chrome.storage.local.get([KEYS.ACCESS, KEYS.REFRESH, KEYS.EXPIRY]);
  }

  /**
   * Renew the portal session once, however many callers ask while it is in
   * flight. Resolves to:
   *   { ok: true, accessToken }
   *   { ok: false, error, signedOut: true }   — server rejected the token;
   *                                             stored auth has been cleared
   *   { ok: false, error, transient: true }   — network / 5xx / 429; stored
   *                                             auth left alone, retry later
   *   { ok: false, error }                    — nothing to renew with
   */
  function refreshSession() {
    if (inFlightRefresh) return inFlightRefresh;
    inFlightRefresh = doRefresh().finally(() => { inFlightRefresh = null; });
    return inFlightRefresh;
  }

  async function doRefresh() {
    const stored = await readTokens();
    const refreshToken = stored[KEYS.REFRESH];
    if (!refreshToken) {
      return { ok: false, error: NOT_SIGNED_IN };
    }

    let response;
    try {
      response = await fetch(`${SERVER_URL}/auth/refresh`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ refreshToken }),
      });
    } catch (error) {
      return { ok: false, error: `Could not reach the server to renew the session (${error.message})`, transient: true };
    }

    const data = await response.json().catch(() => ({}));

    if (response.ok) {
      const update = {
        [KEYS.ACCESS]: data.accessToken,
        // Expiry must be persisted too — without it,
        // AccountService.isTokenExpiringSoon() reads a stale value and forces
        // a renewal on every page load.
        [KEYS.EXPIRY]: Date.now() + ((data.expiresIn || 900) * 1000),
      };
      if (data.refreshToken) update[KEYS.REFRESH] = data.refreshToken;
      await chrome.storage.local.set(update);
      return { ok: true, accessToken: data.accessToken };
    }

    if (response.status === 401 || response.status === 403) {
      // The server refused the token we sent. If another context rotated it
      // while our request was in flight, the session is alive under the new
      // token in storage — adopt that instead of declaring it over.
      const recheck = await readTokens();
      if (recheck[KEYS.REFRESH] && recheck[KEYS.REFRESH] !== refreshToken && recheck[KEYS.ACCESS]) {
        return { ok: true, accessToken: recheck[KEYS.ACCESS] };
      }
      // Storage still holds the token the server just rejected: nothing can
      // revive it. Same narrowed rule AccountService.refreshAccessToken()
      // applies — only a 401/403 ends the session; a blip never does.
      await chrome.storage.local.remove(AUTH_KEYS);
      return { ok: false, error: SESSION_ENDED, signedOut: true };
    }

    return {
      ok: false,
      error: `Could not renew the session (HTTP ${response.status}${data.error ? `: ${data.error}` : ''})`,
      transient: true,
    };
  }

  function lookupGrantKey(orgName, accessToken) {
    return fetch(`${SERVER_URL}/admin/extension-grant-key`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${accessToken}`,
      },
      body: JSON.stringify({ orgName }),
    });
  }

  /**
   * Fetch the extension grant key for an org, renewing the portal session if
   * the access token has expired.
   * @param {string} orgName
   * @returns {Promise<Object>} { success, grantKey, orgId, orgName, logoUrl }
   *   or { success: false, error, notFound?, signedOut? }
   */
  async function fetchExtensionGrantKey(orgName) {
    if (!orgName) {
      return { success: false, error: 'orgName is required' };
    }

    try {
      const stored = await readTokens();
      let accessToken = stored[KEYS.ACCESS];
      if (!accessToken) {
        return { success: false, error: NOT_SIGNED_IN };
      }

      let response = await lookupGrantKey(orgName, accessToken);

      if (response.status === 401) {
        // Another context may already have renewed while we were in flight.
        // Its token is in storage; use it before asking the server for one.
        const latest = await readTokens();
        if (latest[KEYS.ACCESS] && latest[KEYS.ACCESS] !== accessToken) {
          accessToken = latest[KEYS.ACCESS];
          response = await lookupGrantKey(orgName, accessToken);
        }
      }

      if (response.status === 401) {
        const renewed = await refreshSession();
        if (!renewed.ok) {
          return { success: false, error: renewed.error, signedOut: !!renewed.signedOut };
        }
        accessToken = renewed.accessToken;
        response = await lookupGrantKey(orgName, accessToken);
      }

      const data = await response.json().catch(() => ({}));

      if (!response.ok) {
        if (response.status === 401) {
          // Renewed and still refused: this is an authentication problem, and
          // must not read as "add a grant key" to the user.
          return { success: false, error: SESSION_ENDED };
        }
        return { success: false, error: data.error || 'Server error', notFound: response.status === 404 };
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

  root.JTPortalSession = { fetchExtensionGrantKey, refreshSession, SERVER_URL };
})(typeof globalThis !== 'undefined' ? globalThis : self);
