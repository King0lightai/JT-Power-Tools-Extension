/**
 * TweakPort — safe export/import for sharing tweaks.
 *   exportTweak: strips everything org/person/PII-specific (the boundary
 *     for what leaves the machine) and tags a shareable envelope.
 *   importTweak: re-validates, mints a fresh id, rewrites org to the
 *     importer's, and FORCES personal scope. (defined in Task 3)
 */
const TweakPort = (() => {
  const SHARE_TAG = 'tweak-share-v1';

  function exportTweak(tweak) {
    if (!tweak || typeof tweak !== 'object') throw new Error('exportTweak: tweak object required');
    const env = { _jtpt: SHARE_TAG, version: 1, name: tweak.name };
    if (typeof tweak.description === 'string' && tweak.description) env.description = tweak.description;
    if (typeof tweak.css === 'string' && tweak.css.trim()) env.css = tweak.css;
    if (Array.isArray(tweak.actions) && tweak.actions.length) {
      env.actions = JSON.parse(JSON.stringify(tweak.actions));
    }
    const urlMatch = tweak.scope && typeof tweak.scope.urlMatch === 'string' ? tweak.scope.urlMatch : undefined;
    env.scope = urlMatch ? { urlMatch } : {};
    return env;
  }

  function importTweak(payload, opts) {
    opts = opts || {};
    if (!payload || typeof payload !== 'object' || payload._jtpt !== SHARE_TAG) {
      return { ok: false, errors: [{ field: '', reason: 'not a JT Power Tools shared tweak (missing or wrong _jtpt tag)' }] };
    }
    if (typeof opts.activeOrg !== 'string' || !opts.activeOrg) {
      return { ok: false, errors: [{ field: 'scope.jtOrg', reason: 'no active JobTread org to import into' }] };
    }
    const id = opts.id || (typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : null);
    if (!id) return { ok: false, errors: [{ field: 'id', reason: 'could not generate an id' }] };

    const tweak = {
      id, name: payload.name, version: 1,
      scope: { jtOrg: opts.activeOrg },
      storageScope: 'personal', enabled: true
    };
    if (typeof payload.description === 'string') tweak.description = payload.description;
    if (typeof payload.css === 'string') tweak.css = payload.css;
    if (Array.isArray(payload.actions)) tweak.actions = JSON.parse(JSON.stringify(payload.actions));
    if (payload.scope && typeof payload.scope.urlMatch === 'string') tweak.scope.urlMatch = payload.scope.urlMatch;

    const v = (typeof window !== 'undefined' && window.TweakValidator)
      ? window.TweakValidator.validate(tweak) : { ok: true };
    if (!v.ok) return { ok: false, errors: v.errors };
    return { ok: true, tweak };
  }

  return { exportTweak, importTweak, SHARE_TAG };
})();

if (typeof window !== 'undefined') window.TweakPort = TweakPort;
