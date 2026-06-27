/**
 * Custom Theme API Service
 *
 * Thin wrapper around the three /admin/themes/* REST endpoints on the
 * MCP server. Auth piggy-backs on AccountService.authenticatedFetch —
 * same JWT, same auto-refresh-on-401, same Worker domain routing
 * (account-service.js routes /admin/* to the MCP server).
 *
 * Server endpoints (all POST under /admin/themes/):
 *   list    {}                                        → { themes: [...] }
 *   save    { slotIndex, name, primary, background, text }
 *                                                     → { theme: {...} }
 *   delete  { slotIndex }                             → { ok: true }
 *
 * Each theme has shape:
 *   { slotIndex, name, primary, background, text, updatedAt }
 *
 * The Custom Theme feature has 3 hard-coded slots (0, 1, 2). Slot index
 * is the stable identity — server enforces 0–2 via UNIQUE constraint
 * + CHECK on the column. Data is per-account (personal), not per-license.
 */
const CustomThemeApi = (() => {
  const DEBUG = false;
  function log(...args) { if (DEBUG) console.log('CustomThemeApi:', ...args); }

  // Auth + POST-JSON plumbing shared with TweaksApi / FormsApi. The server
  // returns { success: false, error: '...' } on failure, so this service
  // opts into treating a 200 { success:false } body as an error too.
  const postJson = window.AdminApiBase.createPostJson(true);

  // ─── Public API ─────────────────────────────────────────────────────

  /**
   * List all populated theme slots for the current account. Returns
   * Array<{slotIndex, name, primary, background, text, updatedAt}>.
   * Sparse — only populated slots are returned; the popup pads to 3.
   * Throws on auth failure or network error.
   */
  async function list() {
    log('list');
    const result = await postJson('/admin/themes/list', {});
    return Array.isArray(result.themes) ? result.themes : [];
  }

  /**
   * Upsert a theme to a slot. Body fields are required and validated
   * server-side: slotIndex (0–2), name (1–50 chars), primary/background/
   * text (each #rrggbb hex). Returns { theme }.
   */
  async function save({ slotIndex, name, primary, background, text }) {
    if (!Number.isInteger(slotIndex) || slotIndex < 0 || slotIndex > 2) {
      throw new Error('slotIndex must be 0, 1, or 2');
    }
    log('save', { slotIndex, name });
    return postJson('/admin/themes/save', {
      slotIndex,
      name,
      primary,
      background,
      text
    });
  }

  /**
   * Remove a theme slot for the current account. Idempotent — deleting
   * an empty slot is a no-op on the server. Returns { ok: true }.
   */
  async function remove(slotIndex) {
    if (!Number.isInteger(slotIndex) || slotIndex < 0 || slotIndex > 2) {
      throw new Error('slotIndex must be 0, 1, or 2');
    }
    log('remove', { slotIndex });
    return postJson('/admin/themes/delete', { slotIndex });
  }

  /**
   * Convenience predicate: is the API reachable for this caller? Used
   * by the popup to decide whether to attempt a server fetch on theme
   * tab open.
   */
  function isAvailable() {
    return !!(window.AccountService &&
              window.AccountService.isLoggedIn &&
              window.AccountService.isLoggedIn());
  }

  return {
    list,
    save,
    'delete': remove,
    isAvailable
  };
})();

if (typeof window !== 'undefined') {
  window.CustomThemeApi = CustomThemeApi;
}
