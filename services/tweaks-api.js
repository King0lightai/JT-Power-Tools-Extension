/**
 * Tweaks API Service (Phase 2)
 *
 * Thin wrapper around the six /admin/tweaks/* REST endpoints on the MCP
 * server. Auth piggy-backs on AccountService.authenticatedFetch — same
 * portal-session JWT, same auto-refresh-on-401, same Worker domain.
 *
 * Server endpoints (all POST under /admin/tweaks/):
 *   list         { jt_org_id }                         → { tweaks: [...], diagnostics: {...} }
 *   create       { ...tweak DSL }                      → { ok, tweak, cssWarnings }
 *   update       { ...tweak DSL with id }              → { ok, tweak, cssWarnings }
 *   delete       { id }                                → { ok }
 *   state        { id, enabled?, pinned_version? }     → { ok }
 *   diagnostics  { id, last_match_count?, last_apply_at?,
 *                  last_error_at?, last_error_message? } → { ok }
 *
 * Authorization rules are enforced by the server:
 *   - personal scope: author or admin/owner can mutate
 *   - org_required scope: admin/owner only can mutate
 *   - any authenticated member can write own state (incl. local-disable
 *     of org_required tweaks)
 *
 * The extension keeps per-org offline caches in
 * chrome.storage.local['jtTweaks:<orgName>'] (see storage.js /
 * window.TweakStorage). The engine reads its active org's cache on init,
 * then refreshes from the server in the background.
 */
const TweaksApi = (() => {
  const DEBUG = false;
  function log(...args) { if (DEBUG) console.log('TweaksApi:', ...args); }

  /**
   * Resolve AccountService and verify the user is logged in. Returns the
   * service or throws a stable error message that callers can render.
   */
  function requireAccountService() {
    const svc = window.AccountService;
    if (!svc) throw new Error('AccountService not loaded');
    if (!svc.isLoggedIn || !svc.isLoggedIn()) {
      throw new Error('Not logged in');
    }
    return svc;
  }

  /**
   * Wrap fetch + JSON parse + error normalization. The server returns
   * { error: '...' } on 4xx/5xx; we surface that as a thrown Error so
   * callers can distinguish ok-with-result from server errors via try/catch.
   */
  async function postJson(endpoint, body) {
    const svc = requireAccountService();
    const response = await svc.authenticatedFetch(endpoint, {
      method: 'POST',
      body: JSON.stringify(body || {})
    });

    let payload = null;
    try {
      payload = await response.json();
    } catch (_err) {
      // Non-JSON response — surface the status text
    }

    if (!response.ok) {
      const msg = (payload && (payload.error || payload.message)) ||
                  ('HTTP ' + response.status + ' ' + response.statusText);
      const err = new Error(msg);
      err.status = response.status;
      err.payload = payload;
      throw err;
    }

    return payload;
  }

  // ─── Public API ─────────────────────────────────────────────────────

  /**
   * List tweaks visible to the caller for a given JT org. Returns:
   *   { tweaks: Array<TweakDSL+meta>, diagnostics: { [id]: {...} } }
   * Throws on auth failure or network error.
   */
  async function list(jtOrgId) {
    if (!jtOrgId || typeof jtOrgId !== 'string') {
      throw new Error('jtOrgId is required');
    }
    log('list', { jtOrgId });
    const result = await postJson('/admin/tweaks/list', { jt_org_id: jtOrgId });
    return {
      tweaks: Array.isArray(result.tweaks) ? result.tweaks : [],
      diagnostics: result.diagnostics || {}
    };
  }

  /**
   * Create a new tweak. The body should be a full V1.5 DSL object plus
   * an optional `storageScope: 'personal' | 'org_required'` field.
   * Default is 'personal' if not specified. Server enforces admin role
   * for org_required.
   * Returns { ok, tweak, cssWarnings }.
   */
  async function create(tweak) {
    if (!tweak || typeof tweak !== 'object') {
      throw new Error('tweak object is required');
    }
    log('create', { id: tweak.id, name: tweak.name, scope: tweak.storageScope });
    return postJson('/admin/tweaks/create', tweak);
  }

  /**
   * Update an existing tweak. The body must include the existing tweak's
   * id. The storageScope cannot be flipped on update — server returns 400.
   * Returns { ok, tweak, cssWarnings }.
   */
  async function update(tweak) {
    if (!tweak || typeof tweak !== 'object' || !tweak.id) {
      throw new Error('tweak object with id is required');
    }
    log('update', { id: tweak.id });
    return postJson('/admin/tweaks/update', tweak);
  }

  /**
   * Soft-delete a tweak. Personal: author or admin. Org_required: admin only.
   * Returns { ok: true }.
   */
  async function remove(tweakId) {
    if (!tweakId || typeof tweakId !== 'string') {
      throw new Error('tweakId is required');
    }
    log('remove', { id: tweakId });
    return postJson('/admin/tweaks/delete', { id: tweakId });
  }

  /**
   * Write the caller's per-account state for a tweak (the local-disable
   * hatch for org_required tweaks, plus version-pinning for power users).
   *   - state: { enabled?: boolean, pinned_version?: number | null }
   * Pass `{ enabled: null, pinned_version: null }` to clear the override
   * and fall back to the tweak's enabled_default. Server returns
   * { ok: true, cleared?: true }.
   */
  async function setState(tweakId, state) {
    if (!tweakId || typeof tweakId !== 'string') {
      throw new Error('tweakId is required');
    }
    const body = { id: tweakId };
    if (state && typeof state === 'object') {
      if (typeof state.enabled === 'boolean') body.enabled = state.enabled;
      if (typeof state.pinned_version === 'number' || state.pinned_version === null) {
        body.pinned_version = state.pinned_version;
      }
    }
    log('setState', body);
    return postJson('/admin/tweaks/state', body);
  }

  /**
   * Best-effort diagnostics report. The engine flushes a debounced batch
   * (~1/min/tweak per the design doc) so we don't hammer the server.
   * Caller may pass any subset of the optional fields. Returns { ok: true }.
   */
  async function reportDiagnostics(tweakId, diag) {
    if (!tweakId || typeof tweakId !== 'string') {
      throw new Error('tweakId is required');
    }
    const body = { id: tweakId };
    if (diag && typeof diag === 'object') {
      if (typeof diag.last_match_count === 'number') body.last_match_count = diag.last_match_count;
      if (typeof diag.last_apply_at === 'number') body.last_apply_at = diag.last_apply_at;
      if (typeof diag.last_error_at === 'number') body.last_error_at = diag.last_error_at;
      if (typeof diag.last_error_message === 'string') body.last_error_message = diag.last_error_message;
    }
    log('reportDiagnostics', body);
    return postJson('/admin/tweaks/diagnostics', body);
  }

  /**
   * Share a stripped tweak envelope (the output of TweakPort.exportTweak).
   * Server stores it under a short code. Returns { ok, code, url }.
   * Same auth as create — the active-license requirement is the "licensed
   * tweak user" gate.
   */
  async function share(envelope) {
    if (!envelope || typeof envelope !== 'object') {
      throw new Error('share envelope object is required');
    }
    log('share', { name: envelope.name });
    return postJson('/admin/tweaks/share', { envelope });
  }

  /**
   * Convenience predicate: is the API reachable for this caller? Used by
   * the engine to decide whether to attempt a server fetch on init.
   * Returns true when AccountService reports a logged-in user.
   */
  function isAvailable() {
    return !!(window.AccountService && window.AccountService.isLoggedIn && window.AccountService.isLoggedIn());
  }

  return {
    list,
    create,
    update,
    remove,
    setState,
    reportDiagnostics,
    share,
    isAvailable
  };
})();

if (typeof window !== 'undefined') {
  window.TweaksApi = TweaksApi;
}
