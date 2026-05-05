/**
 * Forms API Service
 *
 * Thin wrapper around the /admin/forms/* REST endpoints on the MCP
 * server. Auth piggy-backs on AccountService.authenticatedFetch — same
 * portal-session JWT, same auto-refresh-on-401, same Worker domain.
 *
 * Server endpoints (all POST under /admin/forms/):
 *   templates/list          {}                                   → { templates: [...] }
 *   instances/list-by-job   { jtOrgId, jtJobId }                 → { instances: [...] }
 *   instances/upsert        { templateId, jtJobId, jtOrgId,
 *                             data, expectedVersion }            → { instance, ... }
 *                                                                  or 409 with
 *                                                                  { error, currentData, currentVersion }
 *
 * Conflict handling: on 409 the postJson helper preserves the response
 * status + payload on the thrown Error so callers (the save engine)
 * can read err.status === 409 and err.payload.{currentData,currentVersion}
 * to perform field-level merge. Do NOT swallow 409s.
 */
const FormsApi = (() => {
  const DEBUG = false;
  function log(...args) { if (DEBUG) console.log('FormsApi:', ...args); }

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
   * Status + parsed payload are attached to the Error so 409 callers can
   * read currentData / currentVersion for field-level merge.
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
   * List all form templates available to the caller's license/org.
   * Returns Array<TemplateRecord>; empty array if the server omits
   * the field. Throws on auth failure or network error.
   */
  async function listTemplates() {
    log('listTemplates');
    const result = await postJson('/admin/forms/templates/list', {});
    return Array.isArray(result.templates) ? result.templates : [];
  }

  /**
   * Fetch all instances + available templates for a given JT job. Both
   * arguments are required — server rejects missing IDs with 400.
   *
   * The server returns BOTH:
   *   - `instances`: forms already filled on this job. Each entry is a
   *     wrapper `{ instance, template, schema }`, where `template` is a
   *     header-only record (no schema) and `schema` is pinned to
   *     `instance.templateVersion`. Consumers must read `entry.schema`
   *     for rendering — `entry.template.schema` is undefined here.
   *   - `availableTemplates`: full templates (with `.schema`) for forms
   *     NOT yet filled on this job. The server already excludes
   *     archived templates from this list.
   *
   * @param {string} jtOrgId
   * @param {string} jtJobId
   * @returns {Promise<{
   *   instances: Array<{ instance: Object, template: Object, schema: Object }>,
   *   availableTemplates: Array<Object>
   * }>}
   */
  async function listInstancesByJob(jtOrgId, jtJobId) {
    if (!jtOrgId || !jtJobId) {
      throw new Error('jtOrgId and jtJobId are required');
    }
    log('listInstancesByJob', { jtOrgId, jtJobId });
    const result = await postJson('/admin/forms/instances/list-by-job', { jtOrgId, jtJobId });
    return {
      instances: Array.isArray(result.instances) ? result.instances : [],
      availableTemplates: Array.isArray(result.availableTemplates) ? result.availableTemplates : [],
    };
  }

  /**
   * Create-or-update a form instance for a job. Caller must include
   * `expectedVersion` for optimistic concurrency — the server returns
   * 409 + { currentData, currentVersion } if another writer beat us.
   * Returns the raw response payload (engines need the full shape:
   * { instance, ... }) so a caller can read instance.version for the
   * next round-trip.
   */
  async function upsertInstance(payload) {
    log('upsertInstance', payload);
    return postJson('/admin/forms/instances/upsert', payload);
  }

  return {
    listTemplates,
    listInstancesByJob,
    upsertInstance
  };
})();

if (typeof window !== 'undefined') {
  window.FormsApi = FormsApi;
}
