/**
 * Admin API Base
 *
 * Shared auth + POST-JSON plumbing for the thin /admin/* REST service
 * wrappers (TweaksApi, CustomThemeApi, FormsApi). Each of those services
 * piggy-backs on AccountService.authenticatedFetch — same portal-session
 * JWT, same auto-refresh-on-401, same Worker domain routing — and shared
 * the identical requireAccountService + postJson boilerplate. This module
 * is the single home for that boilerplate.
 *
 * Must load before its consumers in the manifest content_scripts list
 * (it is referenced at IIFE-init time via AdminApiBase.createPostJson).
 */
const AdminApiBase = (() => {
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
   * Build a postJson helper bound to one service. Wraps fetch + JSON parse
   * + error normalization: the server returns { error: '...' } on 4xx/5xx,
   * surfaced as a thrown Error so callers can distinguish ok-with-result
   * from server errors via try/catch. Status + parsed payload are attached
   * to the Error so callers (e.g. Forms' 409 merge) can read currentData /
   * currentVersion.
   *
   * @param {boolean} [treatSuccessFalseAsError] - when true, a 200 body of
   *   { success: false } is also treated as an error (Custom Theme's
   *   envelope). Defaults to false (Tweaks/Forms rely on HTTP status only).
   */
  function createPostJson(treatSuccessFalseAsError) {
    return async function postJson(endpoint, body) {
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

      if (!response.ok ||
          (treatSuccessFalseAsError && payload && payload.success === false)) {
        const msg = (payload && (payload.error || payload.message)) ||
                    ('HTTP ' + response.status + ' ' + response.statusText);
        const err = new Error(msg);
        err.status = response.status;
        err.payload = payload;
        throw err;
      }

      return payload;
    };
  }

  return {
    requireAccountService,
    createPostJson
  };
})();

if (typeof window !== 'undefined') {
  window.AdminApiBase = AdminApiBase;
}
