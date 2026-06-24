/**
 * Account Service
 * Handles user authentication, session management, and data sync
 * Works alongside LicenseService for account-based auth
 *
 * v1.0 - Initial implementation with JWT auth
 */

const AccountService = (() => {
  // Debug flag — set to false for production builds to suppress console output
  const DEBUG = false;

  // Safe logging — only outputs when DEBUG is true
  function log(...args) { if (DEBUG) console.log('[Account]', ...args); }
  function logError(...args) { if (DEBUG) console.error('[Account]', ...args); }

  // API endpoints
  const API_URL = 'https://jobtread-mcp-server.king0light-ai.workers.dev';
  const SYNC_URL = 'https://jt-tools-license-proxy.king0light-ai.workers.dev';

  // Storage keys
  const STORAGE_KEYS = {
    ACCESS_TOKEN: 'jtAccountAccessToken',
    REFRESH_TOKEN: 'jtAccountRefreshToken',
    USER_DATA: 'jtAccountUserData',
    TOKEN_EXPIRY: 'jtAccountTokenExpiry',
    NOTES_SYNC_TIMESTAMP: 'jtNotesLastSync',
    TEMPLATES_SYNC_TIMESTAMP: 'jtTemplatesLastSync'
  };

  // Token refresh threshold (refresh if less than 2 minutes left)
  const REFRESH_THRESHOLD = 2 * 60 * 1000; // 2 minutes in ms

  // Current state
  let currentUser = null;
  let accessToken = null;
  let refreshToken = null;
  let tokenExpiry = null;
  let refreshPromise = null;
  let storageSyncAttached = false;

  /**
   * Keep this context's in-memory auth state in sync with chrome.storage.
   * Refresh tokens are single-use (rotated by the server on every refresh):
   * when any other context — popup, service worker, another tab — rotates
   * them, this context must pick up the new values or its next refresh
   * attempt 401s. Also propagates logout (cleared keys) across contexts.
   */
  function setupStorageSync() {
    if (storageSyncAttached) return;
    if (typeof chrome === 'undefined' || !chrome.storage || !chrome.storage.onChanged) return;

    chrome.storage.onChanged.addListener((changes, areaName) => {
      if (areaName !== 'local') return;
      if (STORAGE_KEYS.ACCESS_TOKEN in changes) {
        accessToken = changes[STORAGE_KEYS.ACCESS_TOKEN].newValue || null;
      }
      if (STORAGE_KEYS.REFRESH_TOKEN in changes) {
        refreshToken = changes[STORAGE_KEYS.REFRESH_TOKEN].newValue || null;
      }
      if (STORAGE_KEYS.TOKEN_EXPIRY in changes) {
        tokenExpiry = changes[STORAGE_KEYS.TOKEN_EXPIRY].newValue || null;
      }
      if (STORAGE_KEYS.USER_DATA in changes) {
        currentUser = changes[STORAGE_KEYS.USER_DATA].newValue || null;
      }
    });
    storageSyncAttached = true;
  }

  /**
   * Initialize the service - load stored tokens
   */
  async function init() {
    try {
      setupStorageSync();

      const stored = await chrome.storage.local.get([
        STORAGE_KEYS.ACCESS_TOKEN,
        STORAGE_KEYS.REFRESH_TOKEN,
        STORAGE_KEYS.USER_DATA,
        STORAGE_KEYS.TOKEN_EXPIRY
      ]);

      accessToken = stored[STORAGE_KEYS.ACCESS_TOKEN] || null;
      refreshToken = stored[STORAGE_KEYS.REFRESH_TOKEN] || null;
      currentUser = stored[STORAGE_KEYS.USER_DATA] || null;
      tokenExpiry = stored[STORAGE_KEYS.TOKEN_EXPIRY] || null;

      // Check if token needs refresh
      if (accessToken && isTokenExpiringSoon()) {
        log('Token expiring soon, refreshing...');
        await refreshAccessToken();
      }

      log('Initialized', { hasUser: !!currentUser });
      return { success: true };
    } catch (error) {
      logError('Init error', error);
      return { success: false, error: error.message };
    }
  }

  /**
   * Check if user is logged in
   */
  function isLoggedIn() {
    return !!accessToken && !!currentUser;
  }

  /**
   * Get current user data
   */
  function getCurrentUser() {
    return currentUser;
  }

  /**
   * Get access token (auto-refresh if needed)
   */
  async function getAccessToken() {
    if (!accessToken) return null;

    // Check if token needs refresh
    if (isTokenExpiringSoon()) {
      await refreshAccessToken();
    }

    return accessToken;
  }

  /**
   * Check if token is expiring soon
   */
  function isTokenExpiringSoon() {
    if (!tokenExpiry) return true;
    return (tokenExpiry - Date.now()) < REFRESH_THRESHOLD;
  }

  /**
   * Register a new account
   * @param {string} email - User email
   * @param {string} password - User password
   * @param {string} displayName - Optional display name
   * @param {string} licenseKey - Optional license key
   * @param {string} inviteToken - Optional invite token
   */
  async function register(email, password, displayName = null, licenseKey = null, inviteToken = null) {
    try {
      const body = { email, password, displayName };
      if (inviteToken) body.inviteToken = inviteToken;
      else if (licenseKey) body.licenseKey = licenseKey;

      const response = await fetch(`${API_URL}/auth/register`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
      });

      const result = await response.json();

      if (response.ok) {
        // Portal returns flat: { accessToken, refreshToken, expiresIn, user, grantKey }
        await storeAuthData(result);
        log('Registration successful');
        return { success: true, data: result };
      } else {
        logError('Registration failed', result.error);
        return { success: false, error: result.error || 'Registration failed' };
      }
    } catch (error) {
      logError('Registration error', error);
      return { success: false, error: 'Network error. Please try again.' };
    }
  }

  /**
   * Login with email and password
   * @param {string} email - User email
   * @param {string} password - User password
   */
  async function login(email, password) {
    try {
      const response = await fetch(`${API_URL}/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password })
      });

      const result = await response.json();

      if (response.ok) {
        // Portal returns flat: { accessToken, refreshToken, expiresIn, user, grantKey }
        await storeAuthData(result);
        log('Login successful');
        return { success: true, data: result };
      } else {
        logError('Login failed', result.error);
        return { success: false, error: result.error || 'Login failed' };
      }
    } catch (error) {
      logError('Login error', error);
      return { success: false, error: 'Network error. Please try again.' };
    }
  }

  /**
   * Refresh the access token
   */
  async function refreshAccessToken() {
    // Prevent concurrent refresh attempts
    if (refreshPromise) {
      return refreshPromise;
    }

    refreshPromise = (async () => {
      try {
        // Re-read auth state from storage right before refreshing. Storage is
        // the source of truth: refresh tokens are single-use (the server
        // rotates them on every /auth/refresh), and another context — popup,
        // service worker, or another tab's content script — may have rotated
        // the token after this context cached its copy at init. Refreshing
        // with that stale copy 401s, and the failure path used to wipe the
        // whole session.
        const stored = await chrome.storage.local.get([
          STORAGE_KEYS.ACCESS_TOKEN,
          STORAGE_KEYS.REFRESH_TOKEN,
          STORAGE_KEYS.TOKEN_EXPIRY,
          STORAGE_KEYS.USER_DATA
        ]);
        if (stored[STORAGE_KEYS.REFRESH_TOKEN]) {
          refreshToken = stored[STORAGE_KEYS.REFRESH_TOKEN];
        }

        // If another context already refreshed and left a fresh access token
        // in storage, adopt it and skip the network call entirely — no
        // rotation churn.
        const storedExpiry = stored[STORAGE_KEYS.TOKEN_EXPIRY] || null;
        if (stored[STORAGE_KEYS.ACCESS_TOKEN] && storedExpiry &&
            (storedExpiry - Date.now()) >= REFRESH_THRESHOLD) {
          accessToken = stored[STORAGE_KEYS.ACCESS_TOKEN];
          tokenExpiry = storedExpiry;
          if (stored[STORAGE_KEYS.USER_DATA]) {
            currentUser = stored[STORAGE_KEYS.USER_DATA];
          }
          log('Adopted fresh token refreshed by another context');
          return { success: true };
        }

        if (!refreshToken) {
          return { success: false, error: 'No refresh token' };
        }

        const tokenUsed = refreshToken;
        const response = await fetch(`${API_URL}/auth/refresh`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ refreshToken: tokenUsed })
        });

        const result = await response.json();

        if (response.ok) {
          // Portal returns flat: { accessToken, expiresIn, user } and, when
          // refresh-token rotation is enabled, also a new { refreshToken }.
          accessToken = result.accessToken;
          tokenExpiry = Date.now() + (result.expiresIn * 1000);

          // Update user data if provided
          if (result.user) {
            currentUser = result.user;
          }

          const storeUpdate = {
            [STORAGE_KEYS.ACCESS_TOKEN]: accessToken,
            [STORAGE_KEYS.TOKEN_EXPIRY]: tokenExpiry,
            [STORAGE_KEYS.USER_DATA]: currentUser
          };

          // Refresh-token rotation: if the server issued a new refresh token,
          // persist it and drop the old one (the server has now invalidated it).
          // Backward compatible — pre-rotation responses omit refreshToken.
          if (result.refreshToken) {
            refreshToken = result.refreshToken;
            storeUpdate[STORAGE_KEYS.REFRESH_TOKEN] = refreshToken;
          }

          await chrome.storage.local.set(storeUpdate);

          log('Token refreshed');
          return { success: true };
        } else {
          // Refresh failed. If another context rotated the token while our
          // request was in flight, the session is still alive under the new
          // token — adopt it instead of logging the user out. Only clear auth
          // data when the token currently in storage is the one the server
          // just rejected.
          const recheck = await chrome.storage.local.get([
            STORAGE_KEYS.ACCESS_TOKEN,
            STORAGE_KEYS.REFRESH_TOKEN,
            STORAGE_KEYS.TOKEN_EXPIRY
          ]);
          const currentStored = recheck[STORAGE_KEYS.REFRESH_TOKEN] || null;
          if (currentStored && currentStored !== tokenUsed) {
            refreshToken = currentStored;
            if (recheck[STORAGE_KEYS.ACCESS_TOKEN]) {
              accessToken = recheck[STORAGE_KEYS.ACCESS_TOKEN];
              tokenExpiry = recheck[STORAGE_KEYS.TOKEN_EXPIRY] || null;
            }
            log('Refresh raced with another context; adopted rotated token');
            return { success: true };
          }

          logError('Token refresh failed', result.error);
          await clearAuthData();
          return { success: false, error: result.error || 'Token refresh failed' };
        }
      } catch (error) {
        logError('Token refresh error', error);
        return { success: false, error: 'Network error' };
      } finally {
        refreshPromise = null;
      }
    })();

    return refreshPromise;
  }

  /**
   * Logout - clear local data and invalidate session on server
   */
  async function logout() {
    try {
      // Try to invalidate session on server (don't wait if it fails)
      if (refreshToken) {
        fetch(`${API_URL}/auth/logout`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ refreshToken })
        }).catch(() => {}); // Ignore errors
      }

      // Clear local data
      await clearAuthData();
      log('Logged out');
      return { success: true };
    } catch (error) {
      logError('Logout error', error);
      // Still clear local data even if server request fails
      await clearAuthData();
      return { success: true };
    }
  }

  /**
   * Store authentication data locally
   */
  async function storeAuthData(data) {
    accessToken = data.accessToken;
    refreshToken = data.refreshToken;
    currentUser = data.user;
    tokenExpiry = Date.now() + (data.expiresIn * 1000);

    await chrome.storage.local.set({
      [STORAGE_KEYS.ACCESS_TOKEN]: accessToken,
      [STORAGE_KEYS.REFRESH_TOKEN]: refreshToken,
      [STORAGE_KEYS.USER_DATA]: currentUser,
      [STORAGE_KEYS.TOKEN_EXPIRY]: tokenExpiry
    });

    // Store grant key separately if provided (for Pro Service)
    if (data.grantKey) {
      await chrome.storage.local.set({ jtAccountGrantKey: data.grantKey });

      // Auto-register device with Pro Worker so API features work immediately
      if (window.JobTreadProService) {
        try {
          const proResult = await window.JobTreadProService.verifyOrgAccess(data.grantKey);
          if (proResult.success) {
            log('Auto-registered device with Pro Worker');
          } else {
            logError('Pro Worker auto-registration failed:', proResult.error);
          }
        } catch (err) {
          logError('Pro Worker auto-registration error:', err);
        }
      }
    }

    // Sync license key from portal (portal returns licenseKey on user object)
    if (data.user?.licenseKey && window.LicenseService) {
      log('Syncing license key from server');
      await window.LicenseService.verifyLicense(data.user.licenseKey);
    }
  }

  /**
   * Clear all authentication data (including sync state)
   */
  async function clearAuthData() {
    accessToken = null;
    refreshToken = null;
    currentUser = null;
    tokenExpiry = null;

    await chrome.storage.local.remove([
      STORAGE_KEYS.ACCESS_TOKEN,
      STORAGE_KEYS.REFRESH_TOKEN,
      STORAGE_KEYS.USER_DATA,
      STORAGE_KEYS.TOKEN_EXPIRY,
      STORAGE_KEYS.NOTES_SYNC_TIMESTAMP,
      'jtAccountGrantKey'
    ]);
  }

  /**
   * Make an authenticated API request
   * @param {string} endpoint - API endpoint (e.g., '/sync/notes')
   * @param {object} options - Fetch options
   */
  async function authenticatedFetch(endpoint, options = {}) {
    const token = await getAccessToken();
    if (!token) {
      throw new Error('Not authenticated');
    }

    // Route resolution:
    //   - /sync/notebooks/*, /sync/sections/*, /sync/pages/* live on the
    //     jobtread-mcp-server worker (Migration 022 + notebooks-handler.js).
    //     The license-proxy worker doesn't know these endpoints and returns
    //     "Unknown sync endpoint" 404s if asked.
    //   - Legacy /sync/notes, /sync/templates, /sync/team-notes,
    //     /sync/team-templates, /sync/saved-filters still live on the
    //     license proxy until they're migrated.
    //   - Everything else goes to the MCP server (auth, admin, etc.).
    const isNotebooksSync = endpoint.startsWith('/sync/notebooks') ||
                             endpoint.startsWith('/sync/sections') ||
                             endpoint.startsWith('/sync/pages');
    const baseUrl = isNotebooksSync
      ? API_URL
      : (endpoint.startsWith('/sync/') ? SYNC_URL : API_URL);

    const response = await fetch(`${baseUrl}${endpoint}`, {
      ...options,
      headers: {
        ...options.headers,
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json'
      }
    });

    // Handle 401 - try refresh once
    if (response.status === 401) {
      const refreshResult = await refreshAccessToken();
      if (refreshResult.success) {
        // Retry with new token
        const newToken = await getAccessToken();
        return fetch(`${baseUrl}${endpoint}`, {
          ...options,
          headers: {
            ...options.headers,
            'Authorization': `Bearer ${newToken}`,
            'Content-Type': 'application/json'
          }
        });
      }
    }

    return response;
  }

  // ==========================================================================
  // GRANT KEY MANAGEMENT (Power Users)
  // ==========================================================================

  /**
   * Update grant key for the current user (Power Users only)
   * @param {string} grantKey - The new grant key to store
   */
  async function updateGrantKey(grantKey) {
    try {
      const token = await getAccessToken();
      if (!token) {
        return { success: false, error: 'Not authenticated' };
      }

      // Endpoint is /admin/update-grant-key (handled by admin.js,
      // not auth-handler.js — admin actions live under /admin/*).
      // Previously called /auth/update-grant-key which 404'd silently,
      // causing the popup to look like it succeeded while D1 never
      // actually updated. The downstream effect: features that use
      // licenses.grant_key_encrypted (job email auto-post, etc.) kept
      // using the OLD key — looked like the rotate "didn't land".
      const response = await fetch(`${API_URL}/admin/update-grant-key`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({ grantKey })
      });

      // Parse body as text first, then JSON if possible — mirrors the
      // portal's api.js hardening so a 404 returning "Not Found"
      // doesn't crash with the cryptic "Unexpected token N..." error.
      const text = await response.text();
      let result = null;
      if (text) {
        try { result = JSON.parse(text); }
        catch { /* not JSON */ }
      }

      // Success is determined by HTTP status, NOT a body `success`
      // field — the server returns `{ message: "..." }` on success
      // (no `success: true` wrapper) and `{ error: "..." }` on failure.
      if (response.ok) {
        log('Grant key updated successfully');
        return { success: true };
      }

      const errMsg = (result && result.error) || text || `HTTP ${response.status}`;
      logError('Grant key update failed', errMsg);
      return { success: false, error: errMsg };
    } catch (error) {
      logError('Grant key update error', error);
      return { success: false, error: 'Network error. Please try again.' };
    }
  }

  /**
   * Get the stored grant key for the current user
   * (Retrieved from local storage - stored during login)
   */
  async function getGrantKey() {
    try {
      // Multi-org resolver handles all fallbacks internally.
      // If it returns null, don't bypass it with legacy storage (would leak cross-org data).
      if (window.GrantKeyResolver) {
        return await window.GrantKeyResolver.getGrantKey();
      }
      // Legacy path: only when resolver isn't loaded at all
      const stored = await chrome.storage.local.get(['jtAccountGrantKey']);
      return stored.jtAccountGrantKey || null;
    } catch (error) {
      logError('Error getting grant key', error);
      return null;
    }
  }

  // ==========================================================================
  // SYNC METHODS (P1 - Will be implemented when sync endpoints are ready)
  // ==========================================================================

  /**
   * Sync notes with server
   * @param {Array} localNotes - Local notes array from QuickNotesStorage
   * @returns {Promise<{success: boolean, notes?: Array, stats?: Object, error?: string}>}
   */
  /**
   * Bidirectional notes sync — bridged onto /sync/notebooks/* (Migration 022).
   *
   * The legacy /sync/notes endpoint pushed every local note + every
   * deleted id in a single payload and received the merged set back.
   * The notebook hierarchy uses per-page CRUD instead, so this function
   * fans the old shape into per-page calls:
   *
   *   1. Fetch the personal notebook tree (auto-imports legacy on first call).
   *   2. Apply local deletions via /sync/pages/delete.
   *   3. Apply local upserts (notes newer than server, or never seen) via
   *      /sync/pages/upsert. Sections are materialized on the fly.
   *   4. Re-read the tree and return the merged flat-note list.
   *
   * Wire contract preserved: callers still get `{ success, notes, stats }`
   * back with flat `{id, title, content, folder, isPinned, createdAt,
   * updatedAt}` rows.
   */
  async function syncNotes(localNotes = []) {
    if (!isLoggedIn()) {
      return { success: false, error: 'Not logged in' };
    }

    try {
      const stored = await chrome.storage.local.get([STORAGE_KEYS.NOTES_SYNC_TIMESTAMP]);
      const lastSyncTimestamp = stored[STORAGE_KEYS.NOTES_SYNC_TIMESTAMP] || 0;

      let deletedNoteIds = [];
      if (window.QuickNotesStorage && window.QuickNotesStorage.getDeletedNoteIds) {
        deletedNoteIds = await window.QuickNotesStorage.getDeletedNoteIds();
      }

      log('Syncing notes (notebook-bridged)...', {
        localNotesCount: localNotes.length,
        deletedCount: deletedNoteIds.length,
        lastSyncTimestamp,
      });

      // 1. Tree fetch (this triggers the server-side legacy importer on
      //    the very first call after upgrade).
      const tree = await fetchNotebookTree('personal');
      const serverPageMetaById = new Map(tree.defaultPages.map(p => [p.id, p]));

      let uploaded = 0;
      let deleted = 0;

      // 2. Apply local deletions. Best-effort — if the server returns
      //    "Page not found" the row was never imported; treat as success.
      for (const id of deletedNoteIds) {
        try {
          const resp = await authenticatedFetch('/sync/pages/delete', {
            method: 'POST',
            body: JSON.stringify({ scope: 'personal', id }),
          });
          const result = await resp.json();
          if (result.success) deleted++;
        } catch (err) {
          logError('Skip delete (network)', { id, error: err?.message });
        }
      }

      // 3. Apply local upserts. Push notes that are newer than the
      //    server copy (or absent from it). New notes — those without
      //    a server-side counterpart — always push.
      for (const note of localNotes) {
        const serverCopy = note.id ? serverPageMetaById.get(note.id) : null;
        const isNewOrChanged = !serverCopy ||
          (note.updatedAt || 0) > (serverCopy.updatedAt || 0);
        if (!isNewOrChanged) continue;

        try {
          const { sectionId } = await ensureSectionForFolder('personal', note.folder);
          const resp = await authenticatedFetch('/sync/pages/upsert', {
            method: 'POST',
            body: JSON.stringify({
              scope: 'personal',
              id: note.id || undefined,
              sectionId,
              title: note.title || 'Untitled',
              content: note.content || '',
              isPinned: !!note.isPinned,
            }),
          });
          const result = await resp.json();
          if (result.success) uploaded++;
        } catch (err) {
          logError('Skip upsert (network)', { id: note.id, error: err?.message });
        }
      }

      // 4. Re-fetch the tree to get the canonical post-merge view —
      //    `withContent: true` brings page bodies along in one request
      //    so callers get content alongside metadata, matching the old
      //    /sync/notes single-call shape.
      const merged = await fetchNotebookTree('personal', { withContent: true });
      const mergedSectionNameById = new Map(merged.defaultSections.map(s => [s.id, s.name]));
      const mergedNotes = merged.defaultPages.map(p =>
        pageToFlatNote(p, mergedSectionNameById.get(p.sectionId) || 'General')
      );

      const syncTimestamp = merged.serverTimestamp || Math.floor(Date.now() / 1000);
      await chrome.storage.local.set({ [STORAGE_KEYS.NOTES_SYNC_TIMESTAMP]: syncTimestamp });

      if (deletedNoteIds.length > 0 && window.QuickNotesStorage?.clearDeletedNotes) {
        await window.QuickNotesStorage.clearDeletedNotes();
      }

      const downloaded = mergedNotes.filter(n => (n.updatedAt || 0) > lastSyncTimestamp).length;
      const stats = { uploaded, downloaded, deleted };
      log('Notes synced successfully', stats);

      return { success: true, notes: mergedNotes, stats };
    } catch (error) {
      logError('Sync error', error);
      return { success: false, error: error?.message || 'Network error during sync' };
    }
  }

  /**
   * Get last notes sync timestamp
   * @returns {Promise<number|null>}
   */
  async function getLastSyncTimestamp() {
    const stored = await chrome.storage.local.get([STORAGE_KEYS.NOTES_SYNC_TIMESTAMP]);
    return stored[STORAGE_KEYS.NOTES_SYNC_TIMESTAMP] || null;
  }

  /**
   * Clear sync state (called on logout)
   */
  async function clearSyncState() {
    await chrome.storage.local.remove([
      STORAGE_KEYS.NOTES_SYNC_TIMESTAMP,
      STORAGE_KEYS.TEMPLATES_SYNC_TIMESTAMP
    ]);
  }

  /**
   * Sync templates with server
   * @param {Object} localData - Local templates data { templates: [], defaultTemplateId: null }
   * @returns {Promise<Object>} - Sync result with merged templates
   */
  async function syncTemplates(localData) {
    if (!isLoggedIn()) {
      return { success: false, error: 'Not logged in' };
    }

    try {
      // Get last sync timestamp
      const stored = await chrome.storage.local.get([STORAGE_KEYS.TEMPLATES_SYNC_TIMESTAMP]);
      const lastSyncTimestamp = stored[STORAGE_KEYS.TEMPLATES_SYNC_TIMESTAMP] || null;

      // Get deleted template IDs to sync
      let deletedTemplateIds = [];
      if (window.QuickNotesStorage && window.QuickNotesStorage.getDeletedTemplateIds) {
        deletedTemplateIds = await window.QuickNotesStorage.getDeletedTemplateIds();
      }

      log('Syncing templates...', {
        localTemplatesCount: localData.templates?.length || 0,
        deletedCount: deletedTemplateIds.length,
        defaultTemplateId: localData.defaultTemplateId,
        lastSyncTimestamp
      });

      // Make authenticated request to sync endpoint
      const response = await authenticatedFetch('/sync/templates', {
        method: 'POST',
        body: JSON.stringify({
          lastSyncTimestamp,
          templates: (localData.templates || []).map(template => ({
            id: template.id,
            name: template.name,
            content: template.content,
            createdAt: template.createdAt,
            updatedAt: template.updatedAt
          })),
          defaultTemplateId: localData.defaultTemplateId,
          deletedTemplateIds: deletedTemplateIds
        })
      });

      const result = await response.json();

      if (result.success) {
        // Save new sync timestamp
        await chrome.storage.local.set({
          [STORAGE_KEYS.TEMPLATES_SYNC_TIMESTAMP]: result.data.syncTimestamp
        });

        // Clear deleted template IDs after successful sync
        if (deletedTemplateIds.length > 0 && window.QuickNotesStorage && window.QuickNotesStorage.clearDeletedTemplates) {
          await window.QuickNotesStorage.clearDeletedTemplates();
        }

        log('Templates synced successfully', result.data.stats);
        return {
          success: true,
          templates: result.data.templates,
          defaultTemplateId: result.data.defaultTemplateId,
          stats: result.data.stats
        };
      } else {
        logError('Template sync failed', result.error);
        return { success: false, error: result.error };
      }
    } catch (error) {
      logError('Template sync error', error);
      return { success: false, error: 'Network error during sync' };
    }
  }

  /**
   * Get last templates sync timestamp
   * @returns {Promise<number|null>}
   */
  async function getLastTemplatesSyncTimestamp() {
    const stored = await chrome.storage.local.get([STORAGE_KEYS.TEMPLATES_SYNC_TIMESTAMP]);
    return stored[STORAGE_KEYS.TEMPLATES_SYNC_TIMESTAMP] || null;
  }

  /**
   * Sync settings with server
   */
  async function syncSettings() {
    // TODO: Implement when settings sync is needed
    log('syncSettings - Not yet implemented');
    return { success: false, error: 'Not yet implemented' };
  }

  // ==========================================================================
  // NOTES BRIDGE — flat shape ↔ notebook hierarchy
  // ==========================================================================
  //
  // Migration 022 moved both personal and team notes to a hierarchical
  // notebook → section → page model. The Quick Notes UI is still flat
  // (folder + note). This bridge keeps the wire shape Quick Notes
  // already speaks (`{id, title, content, folder, isPinned, createdAt,
  // updatedAt}`) by translating to/from `/sync/notebooks/*` endpoints
  // on the way in and out. Quick Notes consumers are unchanged.
  //
  // Identity: page.id maps 1:1 to note.id (the server-side importer
  // preserved ids when promoting legacy rows). `folder` is materialized
  // from the page's section name.
  //
  // Default notebook: one per (scope, owner). Picked as "first notebook,
  // ordered by sort_order then created_at" — same order the importer
  // creates it, so users see the notebook the importer made.

  // In-flight cache of section-id-by-name, per scope. Refreshed every
  // time we fetch the tree so we don't fan out section lookups when a
  // user types a folder name we already know about.
  const _notesCache = {
    personal: { notebookId: null, sectionIdByName: new Map(), serverTimestamp: 0 },
    team: { notebookId: null, sectionIdByName: new Map(), serverTimestamp: 0 },
  };

  async function fetchNotebookTree(scope, { withContent = false } = {}) {
    const response = await authenticatedFetch('/sync/notebooks/tree', {
      method: 'POST',
      body: JSON.stringify({ scope, withContent }),
    });
    const result = await response.json();
    if (!result.success) {
      throw new Error(result.error || 'Failed to load notebooks');
    }
    const notebooks = result.data.notebooks || [];
    const sections = result.data.sections || [];
    const pages = result.data.pages || [];

    // Pick the default notebook (first, by server's sort order). If the
    // user has multiple notebooks (they created some in the portal), we
    // still flatten everything into a single Quick Notes view — keyed
    // off the first notebook only — to keep the flat UI usable. A
    // follow-up PR will surface a notebook switcher.
    const defaultNotebook = notebooks[0] || null;
    const cache = _notesCache[scope];
    cache.notebookId = defaultNotebook?.id || null;
    cache.sectionIdByName = new Map();
    cache.serverTimestamp = result.data.serverTimestamp || 0;

    if (!defaultNotebook) {
      return { notebooks, sections, pages, defaultNotebook: null, defaultSections: [], defaultPages: [] };
    }

    const defaultSections = sections.filter(s => s.notebookId === defaultNotebook.id);
    for (const s of defaultSections) cache.sectionIdByName.set(s.name, s.id);
    const sectionIds = new Set(defaultSections.map(s => s.id));
    const defaultPages = pages.filter(p => sectionIds.has(p.sectionId));

    return { notebooks, sections, pages, defaultNotebook, defaultSections, defaultPages };
  }

  function pageToFlatNote(page, sectionName) {
    return {
      id: page.id,
      title: page.title,
      // `content` only travels in the per-page response from /pages/get;
      // tree responses omit it for payload size.
      content: page.content ?? '',
      folder: sectionName || 'General',
      isPinned: !!page.isPinned,
      createdAt: page.createdAt || page.created_at || null,
      updatedAt: page.updatedAt || page.updated_at || null,
    };
  }

  // Materialize a section for `folderName` in `scope`. Returns the
  // section id, creating one (and the default notebook, if missing)
  // on the fly. Cached in _notesCache so a hot loop of saves doesn't
  // re-hit the server for the same folder.
  async function ensureSectionForFolder(scope, folderName) {
    const folder = (folderName || 'General').trim() || 'General';
    const cache = _notesCache[scope];

    if (cache.sectionIdByName.has(folder)) {
      return { notebookId: cache.notebookId, sectionId: cache.sectionIdByName.get(folder) };
    }

    if (!cache.notebookId) {
      // No notebook yet — create the default one. Picks the same name
      // the server-side importer uses so the experience is consistent
      // whether the user came in via the importer or via a fresh
      // install with no legacy data.
      const name = scope === 'team' ? 'Team' : 'Quick Notes';
      const nbResp = await authenticatedFetch('/sync/notebooks/upsert', {
        method: 'POST',
        body: JSON.stringify({ scope, name, icon: 'notebook' }),
      });
      const nbResult = await nbResp.json();
      if (!nbResult.success) throw new Error(nbResult.error || 'Failed to create notebook');
      cache.notebookId = nbResult.data.id;
    }

    const secResp = await authenticatedFetch('/sync/sections/upsert', {
      method: 'POST',
      body: JSON.stringify({ scope, notebookId: cache.notebookId, name: folder }),
    });
    const secResult = await secResp.json();
    if (!secResult.success) throw new Error(secResult.error || 'Failed to create section');
    cache.sectionIdByName.set(folder, secResult.data.id);
    return { notebookId: cache.notebookId, sectionId: secResult.data.id };
  }

  // ==========================================================================
  // TEAM NOTES (Shared across organization)
  // ==========================================================================

  /**
   * Get all team notes for the organization.
   *
   * Migration 022 routes this through /sync/notebooks/tree under the hood —
   * see the "NOTES BRIDGE" section above for the translation rules. Wire
   * shape (`notes: [{id, title, content, folder, isPinned, ...}]`) preserved
   * for Quick Notes consumers.
   *
   * @returns {Promise<Object>} - Result with notes array
   */
  async function getTeamNotes() {
    if (!isLoggedIn()) {
      return { success: false, error: 'Not logged in' };
    }

    try {
      log('Fetching team notes...');
      const tree = await fetchNotebookTree('team', { withContent: true });
      if (!tree.defaultNotebook) {
        return { success: true, notes: [], serverTimestamp: tree.serverTimestamp || Math.floor(Date.now() / 1000) };
      }

      const sectionNameById = new Map(tree.defaultSections.map(s => [s.id, s.name]));
      const notes = tree.defaultPages.map(p =>
        pageToFlatNote(p, sectionNameById.get(p.sectionId) || 'General')
      );

      log('Team notes fetched', { count: notes.length });
      return { success: true, notes, serverTimestamp: tree.serverTimestamp || Math.floor(Date.now() / 1000) };
    } catch (error) {
      logError('Team notes fetch error', error);
      return { success: false, error: error?.message || 'Network error. Please try again.' };
    }
  }

  /**
   * Save (create or update) a team note.
   *
   * Bridged onto /sync/notebooks (Migration 022). `folder` is materialized
   * as a section under the default Team notebook — created on first use.
   *
   * @param {Object} note - Note object { id?, title, content, folder?, isPinned? }
   * @returns {Promise<Object>} - Result with saved note data (flat shape)
   */
  async function saveTeamNote(note) {
    if (!isLoggedIn()) {
      return { success: false, error: 'Not logged in' };
    }
    if (!note.title && !note.content) {
      return { success: false, error: 'Title or content is required' };
    }

    try {
      log('Saving team note...', { id: note.id || 'new', folder: note.folder });

      // Make sure the bridge cache is warm before we ask for a section —
      // first save after a login may hit this path before any tree fetch.
      if (!_notesCache.team.notebookId && _notesCache.team.sectionIdByName.size === 0) {
        try { await fetchNotebookTree('team'); } catch { /* falls through; ensureSectionForFolder will create */ }
      }

      const { sectionId } = await ensureSectionForFolder('team', note.folder);

      const response = await authenticatedFetch('/sync/pages/upsert', {
        method: 'POST',
        body: JSON.stringify({
          scope: 'team',
          id: note.id || undefined,
          sectionId,
          title: note.title || 'Untitled Note',
          content: note.content || '',
          isPinned: !!note.isPinned,
        }),
      });
      const result = await response.json();

      if (result.success) {
        log('Team note saved', result.data);
        // Re-shape response into the flat note contract callers expect.
        return {
          success: true,
          data: {
            id: result.data.id,
            title: result.data.title,
            content: result.data.content,
            folder: note.folder || 'General',
            isPinned: !!result.data.isPinned,
            createdAt: result.data.createdAt,
            updatedAt: result.data.updatedAt,
          },
        };
      }
      logError('Failed to save team note', result.error);
      return { success: false, error: result.error };
    } catch (error) {
      logError('Team note save error', error);
      return { success: false, error: error?.message || 'Network error. Please try again.' };
    }
  }

  /**
   * Delete a team note (soft delete on the server).
   *
   * Bridged onto /sync/pages/delete (Migration 022).
   *
   * @param {string} noteId - ID of the note to delete
   * @returns {Promise<Object>} - Result with success/error
   */
  async function deleteTeamNote(noteId) {
    if (!isLoggedIn()) {
      return { success: false, error: 'Not logged in' };
    }
    if (!noteId) {
      return { success: false, error: 'Note ID is required' };
    }

    try {
      log('Deleting team note...', { id: noteId });

      const response = await authenticatedFetch('/sync/pages/delete', {
        method: 'POST',
        body: JSON.stringify({ scope: 'team', id: noteId }),
      });
      const result = await response.json();

      if (result.success) {
        log('Team note deleted');
        return { success: true };
      }
      logError('Failed to delete team note', result.error);
      return { success: false, error: result.error };
    } catch (error) {
      logError('Team note delete error', error);
      return { success: false, error: error?.message || 'Network error. Please try again.' };
    }
  }

  // ==========================================================================
  // TEAM TEMPLATES (Company-shared templates, Essential+ tier)
  // ==========================================================================

  /**
   * Get all team templates for the organization
   * @returns {Promise<Object>} - Result with templates array
   */
  async function getTeamTemplates() {
    if (!isLoggedIn()) {
      return { success: false, error: 'Not logged in' };
    }

    try {
      log('Fetching team templates...');

      const response = await authenticatedFetch('/sync/team-templates', {
        method: 'POST',
        body: JSON.stringify({})
      });

      const result = await response.json();

      if (result.success) {
        log('Team templates fetched', {
          count: result.data.templates?.length || 0
        });
        return {
          success: true,
          templates: result.data.templates || [],
          serverTimestamp: result.data.serverTimestamp
        };
      } else {
        logError('Failed to fetch team templates', result.error);
        return { success: false, error: result.error };
      }
    } catch (error) {
      logError('Team templates fetch error', error);
      return { success: false, error: 'Network error. Please try again.' };
    }
  }

  /**
   * Save (create or update) a team template
   * @param {Object} template - Template object { id?, name, content }
   * @returns {Promise<Object>} - Result with saved template data
   */
  async function saveTeamTemplate(template) {
    if (!isLoggedIn()) {
      return { success: false, error: 'Not logged in' };
    }

    if (!template.name || !template.name.trim()) {
      return { success: false, error: 'Template name is required' };
    }

    try {
      log('Saving team template...', { id: template.id || 'new' });

      const response = await authenticatedFetch('/sync/team-templates/push', {
        method: 'POST',
        body: JSON.stringify({
          id: template.id || null,
          name: template.name,
          content: template.content || ''
        })
      });

      const result = await response.json();

      if (result.success) {
        log('Team template saved', result.data);
        return { success: true, data: result.data };
      } else {
        logError('Failed to save team template', result.error);
        return { success: false, error: result.error };
      }
    } catch (error) {
      logError('Team template save error', error);
      return { success: false, error: 'Network error. Please try again.' };
    }
  }

  /**
   * Delete a team template
   * @param {string} templateId - ID of the template to delete
   * @returns {Promise<Object>} - Result with success/error
   */
  async function deleteTeamTemplate(templateId) {
    if (!isLoggedIn()) {
      return { success: false, error: 'Not logged in' };
    }

    if (!templateId) {
      return { success: false, error: 'Template ID is required' };
    }

    try {
      log('Deleting team template...', { id: templateId });

      const response = await authenticatedFetch('/sync/team-templates/delete', {
        method: 'POST',
        body: JSON.stringify({ id: templateId })
      });

      const result = await response.json();

      if (result.success) {
        log('Team template deleted');
        return { success: true };
      } else {
        logError('Failed to delete team template', result.error);
        return { success: false, error: result.error };
      }
    } catch (error) {
      logError('Team template delete error', error);
      return { success: false, error: 'Network error. Please try again.' };
    }
  }

  // ==========================================================================
  // SAVED FILTERS (Shared across organization)
  // ==========================================================================

  /**
   * Get all saved filters for the organization
   * @returns {Promise<Object>} - Result with filters array
   */
  async function getSavedFilters() {
    if (!isLoggedIn()) {
      return { success: false, error: 'Not logged in' };
    }

    try {
      log('Fetching saved filters...');

      // Include orgId for multi-org scoping
      const orgId = (typeof JobTreadAPI !== 'undefined') ? await JobTreadAPI.getOrgId() : null;
      const response = await authenticatedFetch('/sync/saved-filters', {
        method: 'POST',
        body: JSON.stringify({ orgId })
      });

      const result = await response.json();

      if (result.success) {
        log('Saved filters fetched', {
          count: result.data.filters?.length || 0
        });
        return {
          success: true,
          filters: result.data.filters || [],
          serverTimestamp: result.data.serverTimestamp
        };
      } else {
        logError('Failed to fetch saved filters', result.error);
        return { success: false, error: result.error };
      }
    } catch (error) {
      logError('Saved filters fetch error', error);
      return { success: false, error: 'Network error. Please try again.' };
    }
  }

  /**
   * Save (create or update) a saved filter
   * @param {Object} filter - Filter object { id?, name, fieldId?, fieldName, filterValues, jobStatus? }
   * @returns {Promise<Object>} - Result with saved filter data
   */
  async function saveSavedFilter(filter) {
    if (!isLoggedIn()) {
      return { success: false, error: 'Not logged in' };
    }

    if (!filter.name || !filter.name.trim()) {
      return { success: false, error: 'Filter name is required' };
    }

    if (!filter.fieldName) {
      return { success: false, error: 'Field name is required' };
    }

    if (!Array.isArray(filter.filterValues) || filter.filterValues.length === 0) {
      return { success: false, error: 'At least one filter value is required' };
    }

    try {
      log('Saving filter...', { id: filter.id || 'new', name: filter.name });

      // Include orgId for multi-org scoping
      const orgId = (typeof JobTreadAPI !== 'undefined') ? await JobTreadAPI.getOrgId() : null;
      const response = await authenticatedFetch('/sync/saved-filters/push', {
        method: 'POST',
        body: JSON.stringify({
          id: filter.id || null,
          name: filter.name.trim(),
          fieldId: filter.fieldId || null,
          fieldName: filter.fieldName,
          filterValues: filter.filterValues,
          jobStatus: filter.jobStatus || 'all',
          orgId
        })
      });

      const result = await response.json();

      if (result.success) {
        log('Saved filter saved', result.data);
        return {
          success: true,
          data: result.data
        };
      } else {
        logError('Failed to save filter', result.error);
        return { success: false, error: result.error };
      }
    } catch (error) {
      logError('Saved filter save error', error);
      return { success: false, error: 'Network error. Please try again.' };
    }
  }

  /**
   * Delete a saved filter
   * @param {string} filterId - ID of the filter to delete
   * @returns {Promise<Object>} - Result with success/error
   */
  async function deleteSavedFilter(filterId) {
    if (!isLoggedIn()) {
      return { success: false, error: 'Not logged in' };
    }

    if (!filterId) {
      return { success: false, error: 'Filter ID is required' };
    }

    try {
      log('Deleting saved filter...', { id: filterId });

      const response = await authenticatedFetch('/sync/saved-filters/delete', {
        method: 'POST',
        body: JSON.stringify({ id: filterId })
      });

      const result = await response.json();

      if (result.success) {
        log('Saved filter deleted');
        return { success: true };
      } else {
        logError('Failed to delete saved filter', result.error);
        return { success: false, error: result.error };
      }
    } catch (error) {
      logError('Saved filter delete error', error);
      return { success: false, error: 'Network error. Please try again.' };
    }
  }

  // ==========================================================================
  // PASSWORD RESET
  // ==========================================================================

  /**
   * Request a password reset email
   * @param {string} email - User's email address
   * @returns {Promise<Object>} - Result with success/error
   */
  async function requestPasswordReset(email) {
    if (!email) {
      return { success: false, error: 'Email is required' };
    }

    try {
      log('Requesting password reset for:', email);

      const response = await fetch(`${API_URL}/auth/forgot`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ email: email.toLowerCase() })
      });

      const result = await response.json();

      if (response.ok) {
        log('Password reset email requested');
        return { success: true, message: result.message };
      } else {
        logError('Password reset request failed', result.error);
        return { success: false, error: result.error || 'Failed to send reset email' };
      }
    } catch (error) {
      logError('Password reset request error', error);
      return { success: false, error: 'Network error. Please try again.' };
    }
  }

  /**
   * Reset password using a reset token
   * @param {string} token - Password reset token from email
   * @param {string} newPassword - New password to set
   * @returns {Promise<Object>} - Result with success/error
   */
  async function resetPassword(token, newPassword) {
    if (!token) {
      return { success: false, error: 'Reset token is required' };
    }

    if (!newPassword || newPassword.length < 8) {
      return { success: false, error: 'Password must be at least 8 characters' };
    }

    try {
      log('Resetting password...');

      const response = await fetch(`${API_URL}/auth/reset`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ token, newPassword })
      });

      const result = await response.json();

      if (response.ok) {
        log('Password reset successful');
        return { success: true, message: result.message };
      } else {
        logError('Password reset failed', result.error);
        return { success: false, error: result.error || 'Password reset failed' };
      }
    } catch (error) {
      logError('Password reset error', error);
      return { success: false, error: 'Network error. Please try again.' };
    }
  }

  // Public API
  return {
    // Initialization
    init,

    // Auth state
    isLoggedIn,
    getCurrentUser,
    getAccessToken,

    // Auth operations
    register,
    login,
    logout,
    refreshAccessToken,
    requestPasswordReset,
    resetPassword,

    // API helpers
    authenticatedFetch,

    // Grant key management
    updateGrantKey,
    getGrantKey,

    // Sync operations
    syncNotes,
    syncTemplates,
    syncSettings,
    getLastSyncTimestamp,
    getLastTemplatesSyncTimestamp,
    clearSyncState,

    // Team notes
    getTeamNotes,
    saveTeamNote,
    deleteTeamNote,

    // Team templates
    getTeamTemplates,
    saveTeamTemplate,
    deleteTeamTemplate,

    // Saved filters
    getSavedFilters,
    saveSavedFilter,
    deleteSavedFilter
  };
})();

// Export for use in other scripts
if (typeof window !== 'undefined') {
  window.AccountService = AccountService;
}

// Initialize on load
if (typeof chrome !== 'undefined' && chrome.runtime) {
  AccountService.init();
}
