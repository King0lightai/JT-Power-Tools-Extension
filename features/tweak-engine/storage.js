/**
 * TweakStorage — per-org storage keyspace for the tweak cache.
 *
 * Tweaks were historically cached in ONE chrome.storage.local['jtTweaks']
 * array spanning every org. Two tabs on different orgs each rewrote that
 * single key (in their own array order) on every server refresh, so each
 * tab's onChanged fired in the other forever — the multi-tab flicker loop.
 * We now key the cache per org: chrome.storage.local['jtTweaks:<orgName>'].
 * A tab only ever writes — and only reacts to — its own org's key, so tabs
 * on different orgs can never contend. (The order-insensitive set-equality
 * skip in the engine stays as a cheap belt-and-suspenders guard.)
 *
 * Org identity is the JobTread org DISPLAY NAME (OrgDetector.getActiveOrg()),
 * the same value already stored on every tweak's scope.jtOrg and used by the
 * active-org match. There is no immutable client-side org id on the cache-first
 * path — the only real id comes from an authenticated server fetch, which would
 * break the engine's works-logged-out guarantee — so the display name is the
 * join key everywhere.
 *
 * Loaded as a content script (before builder.js / index.js) and as a <script>
 * in popup.html and tweaks/edit.html, so all four contexts that touch the
 * cache share one keyspace implementation. No chrome.* access happens at load
 * time — only inside the functions — so importing the file is side-effect-free.
 */
const TweakStorage = (() => {
  const LEGACY_KEY = 'jtTweaks';
  const PREFIX = 'jtTweaks:';

  function keyForOrg(orgName) {
    return PREFIX + (orgName || '');
  }

  function orgFromTweak(t) {
    return (t && t.scope && t.scope.jtOrg) || '';
  }

  // Every per-org bucket key currently in storage.
  async function allOrgKeys() {
    const everything = await chrome.storage.local.get(null);
    return Object.keys(everything).filter((k) => k.startsWith(PREFIX));
  }

  // Dedupe by id; entries from `b` win over `a`.
  function mergeById(a, b) {
    const map = new Map();
    for (const t of a) if (t && t.id) map.set(t.id, t);
    for (const t of b) if (t && t.id) map.set(t.id, t);
    return [...map.values()];
  }

  /**
   * One-time, idempotent migration: split the legacy single jtTweaks array
   * into per-org keys (grouped by scope.jtOrg), then remove the legacy key.
   * Tweaks with no scope.jtOrg land in the empty-org bucket (lossless — they
   * never matched any active org anyway). Safe to call from any context and
   * concurrently: a repeat run sees no array and returns false. Returns true
   * only when it actually migrated.
   */
  async function migrateLegacyIfNeeded() {
    const stored = await chrome.storage.local.get([LEGACY_KEY]);
    const legacy = stored[LEGACY_KEY];
    if (!Array.isArray(legacy)) return false; // already migrated / never existed

    const byOrg = {};
    for (const t of legacy) {
      const org = orgFromTweak(t);
      (byOrg[org] = byOrg[org] || []).push(t);
    }

    const keys = Object.keys(byOrg).map(keyForOrg);
    const existing = keys.length ? await chrome.storage.local.get(keys) : {};
    const writes = {};
    for (const org of Object.keys(byOrg)) {
      const key = keyForOrg(org);
      const prior = Array.isArray(existing[key]) ? existing[key] : [];
      // Merge legacy entries into any prior per-org data, deduped by id, so a
      // partial/repeat run never duplicates or clobbers.
      writes[key] = mergeById(prior, byOrg[org]);
    }
    if (Object.keys(writes).length) await chrome.storage.local.set(writes);
    await chrome.storage.local.remove(LEGACY_KEY);
    return true;
  }

  async function readOrg(orgName) {
    const key = keyForOrg(orgName);
    const stored = await chrome.storage.local.get([key]);
    return Array.isArray(stored[key]) ? stored[key] : [];
  }

  async function writeOrg(orgName, tweaks) {
    await chrome.storage.local.set({ [keyForOrg(orgName)]: tweaks });
  }

  // Flat array of every tweak across all org buckets — for the popup's
  // "all orgs" view and id-based lookups in the editor.
  async function readAll() {
    const keys = await allOrgKeys();
    if (!keys.length) return [];
    const stored = await chrome.storage.local.get(keys);
    const all = [];
    for (const k of keys) if (Array.isArray(stored[k])) all.push(...stored[k]);
    return all;
  }

  // Insert or replace a tweak by id in its own org bucket (scope.jtOrg).
  async function upsert(tweak) {
    const org = orgFromTweak(tweak);
    const list = await readOrg(org);
    const idx = list.findIndex((t) => t && t.id === tweak.id);
    if (idx >= 0) list[idx] = tweak; else list.push(tweak);
    await writeOrg(org, list);
  }

  // Find a tweak by id across buckets, mutate it, write back only its bucket.
  // mutator(tweak) may mutate in place or return a replacement. Returns true
  // if a matching tweak was found.
  async function updateById(id, mutator) {
    const keys = await allOrgKeys();
    if (!keys.length) return false;
    const stored = await chrome.storage.local.get(keys);
    for (const k of keys) {
      const list = stored[k];
      if (!Array.isArray(list)) continue;
      const idx = list.findIndex((t) => t && t.id === id);
      if (idx >= 0) {
        const res = mutator(list[idx]);
        if (res) list[idx] = res;
        await chrome.storage.local.set({ [k]: list });
        return true;
      }
    }
    return false;
  }

  // Remove a tweak by id from whichever bucket holds it. Returns true if found.
  async function removeById(id) {
    const keys = await allOrgKeys();
    if (!keys.length) return false;
    const stored = await chrome.storage.local.get(keys);
    for (const k of keys) {
      const list = stored[k];
      if (!Array.isArray(list)) continue;
      if (list.some((t) => t && t.id === id)) {
        await chrome.storage.local.set({ [k]: list.filter((t) => !(t && t.id === id)) });
        return true;
      }
    }
    return false;
  }

  return {
    PREFIX,
    LEGACY_KEY,
    keyForOrg,
    orgFromTweak,
    migrateLegacyIfNeeded,
    readOrg,
    writeOrg,
    readAll,
    upsert,
    updateById,
    removeById,
  };
})();

if (typeof window !== 'undefined') window.TweakStorage = TweakStorage;
