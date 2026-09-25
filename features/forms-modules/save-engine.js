/**
 * Forms Save Engine
 *
 * Per-instance state machine that owns local field state, debounces
 * upserts, handles 409 optimistic-concurrency conflicts via field-level
 * merge, and surfaces state transitions to the caller (which renders the
 * status pill).
 *
 * State machine
 *   idle      → dirty                       (first markDirty)
 *   dirty     → saving                      (forceSave fires)
 *   saving    → saved                       (200 response)
 *   saving    → conflict                    (409 after retry-409)
 *   saving    → offline                     (network or 5xx error)
 *   saved     → dirty                       (next markDirty)
 *   conflict  → dirty                       (caller resolves OR auto-merge)
 *   offline   → saving                      (next dirty event triggers retry)
 *
 * Coalescing: only one upsert is in flight at a time. dirtyFields is
 * snapshotted into `fieldsBeingSaved` and cleared BEFORE the network
 * call, so writes that happen during the request land in a fresh
 * dirtyFields set and trigger the next save when the current one settles.
 *
 * 409 merge: server's currentData wins for fields the local user touched
 * neither in the just-attempted save NOR in the next-attempt dirty set.
 * Local always wins for "ours". onMerge fires with the list of
 * server-refreshed field IDs so the caller can re-render those fields.
 *
 * Lifecycle: setStatus('complete' | 'in_progress') queues a status change
 * onto the next upsert. Completing LOCKS the instance server-side, so
 * markDirty is dropped while complete and a stray write comes back 423
 * (treated as permanent — retrying it would never succeed).
 *
 * Server contract notes (see server/mcp-server/src/forms-handler.js
 * upsertInstanceData):
 *   - Request body uses `fields` (not `data`), plus an optional `status`
 *   - 409 surfaces conflict info under err.payload.errors[0]:
 *     { field, reason, currentVersion, currentData }
 *   - 423 means the instance is complete; reopen before writing again
 *   - 200 response shape: { instance: { ..., optimisticVersion, status }, schema }
 */
const FormsSaveEngine = (() => {
  const HEARTBEAT_MS = 30000;
  const DEBUG = false;
  function log(...args) { if (DEBUG) console.log('FormsSaveEngine:', ...args); }

  let cfg = null;
  let data = {};
  let version = 0;
  let dirtyFields = new Set();
  let inFlight = null;
  let nextSavePending = false;
  let heartbeatId = null;
  let state = 'idle';
  let abortController = null;
  // Lifecycle (Migration 057). `status` mirrors the server's stored value;
  // `pendingStatus` is a change the user asked for that hasn't landed yet and
  // must ride the NEXT upsert, whether or not any field is dirty.
  let status = 'in_progress';
  let pendingStatus = null;
  // Resolvers for setStatus() callers, released once the change has actually
  // been sent (or given up on) — not when the save that happened to be in
  // flight at the time finished.
  let statusWaiters = [];

  // ─── State helpers ────────────────────────────────────────────────

  function setState(newState, meta) {
    state = newState;
    if (cfg && cfg.onStateChange) {
      try {
        cfg.onStateChange(newState, meta || {});
      } catch (err) {
        console.error('FormsSaveEngine: onStateChange threw', err);
      }
    }
  }

  function resetHeartbeat() {
    if (heartbeatId) clearTimeout(heartbeatId);
    heartbeatId = setTimeout(() => {
      heartbeatId = null;
      if (dirtyFields.size > 0) {
        log('heartbeat → forceSave');
        forceSave();
      }
    }, HEARTBEAT_MS);
  }

  // ─── Public: init ────────────────────────────────────────────────

  /**
   * Initialize a save engine for one form instance. Replaces any prior
   * engine.
   *
   * @param {Object} c
   * @param {string} c.templateId
   * @param {string} c.jtOrgId
   * @param {string} c.jtJobId
   * @param {Object} [c.initialData]    existing instance data_json or {}
   * @param {number} [c.initialVersion] existing optimistic_version or 0
   * @param {string} [c.initialStatus]  'in_progress' (default) or 'complete'
   * @param {Function} c.onStateChange  (state, meta) => void
   * @param {Function} [c.onMerge]      (refreshedFieldIds, lastEditedBy, lastEditedAt) => void
   * @param {Function} [c.getSchema]    () => schema; reserved for future use
   */
  function init(c) {
    if (!c || typeof c !== 'object') {
      throw new Error('FormsSaveEngine.init: cfg required');
    }
    if (typeof c.templateId !== 'string' || !c.templateId) {
      throw new Error('FormsSaveEngine.init: templateId required');
    }
    if (typeof c.jtOrgId !== 'string' || !c.jtOrgId) {
      throw new Error('FormsSaveEngine.init: jtOrgId required');
    }
    if (typeof c.jtJobId !== 'string' || !c.jtJobId) {
      throw new Error('FormsSaveEngine.init: jtJobId required');
    }
    if (typeof c.onStateChange !== 'function') {
      throw new Error('FormsSaveEngine.init: onStateChange required');
    }

    // Defensive: if a prior instance is around, tear it down first
    if (cfg) dispose();

    cfg = c;
    data = Object.assign({}, c.initialData || {});
    version = Number.isInteger(c.initialVersion) ? c.initialVersion : 0;
    status = c.initialStatus === 'complete' ? 'complete' : 'in_progress';
    pendingStatus = null;
    dirtyFields = new Set();
    inFlight = null;
    nextSavePending = false;
    state = 'idle';
    abortController = null;
    heartbeatId = null;
    log('init', { templateId: c.templateId, jtJobId: c.jtJobId, version, status });
  }

  // ─── Public: markDirty ───────────────────────────────────────────

  /**
   * Mark a field as dirty. Schedules an immediate save if none is in
   * flight; otherwise queues a follow-up save.
   */
  function markDirty(fieldId, value) {
    if (!cfg) return;
    if (typeof fieldId !== 'string' || !fieldId) return;
    // A completed worksheet is read-only. The drawer already renders its
    // controls disabled, so reaching here means something slipped through —
    // drop the edit rather than send a write the server will refuse with 423.
    if (status === 'complete' && pendingStatus !== 'in_progress') {
      log('markDirty ignored — worksheet is complete');
      return;
    }

    data[fieldId] = value;
    dirtyFields.add(fieldId);

    if (state === 'saved' || state === 'idle' || state === 'offline') {
      setState('dirty');
    } else if (state === 'conflict') {
      // User resumed editing after a third-writer race — resume the loop
      setState('dirty');
    }

    if (inFlight) {
      nextSavePending = true;
    } else {
      // Fire-and-forget; the Promise is captured by inFlight inside forceSave
      forceSave();
    }

    resetHeartbeat();
  }

  // ─── Public: forceSave ───────────────────────────────────────────

  /**
   * Force an immediate save (e.g. on heartbeat or before close).
   * Returns a Promise that resolves when the save (and any retry) settles.
   */
  function forceSave() {
    if (!cfg) return Promise.resolve();
    if (inFlight) {
      nextSavePending = true;
      return inFlight;
    }
    // A pending status change has to go out even with nothing dirty — that
    // IS the change the user asked for.
    if (pendingStatus === null && dirtyFields.size === 0 && state === 'saved') {
      return Promise.resolve();
    }
    if (pendingStatus === null && dirtyFields.size === 0 && state === 'idle') {
      return Promise.resolve();
    }

    setState('saving');

    // Snapshot dirty fields for THIS attempt and clear the live set so
    // any markDirty during the network call accumulates for the NEXT save.
    const fieldsBeingSaved = new Set(dirtyFields);
    dirtyFields.clear();

    abortController = new AbortController();
    const localTemplateId = cfg.templateId;
    const localJtOrgId = cfg.jtOrgId;
    const localJtJobId = cfg.jtJobId;

    inFlight = (async () => {
      try {
        // Build payload from local data — server expects `fields` (full
        // current snapshot is fine; server merges field-level into its
        // existing data_json).
        const payload = buildUpsertPayload(localTemplateId, localJtOrgId, localJtJobId);
        const result = await window.FormsApi.upsertInstance(payload);
        // 200 path
        version = readVersion(result, version);
        applyStatusFromResult(result, payload.status);
        // Only transition to 'saved' if no new edits arrived during the
        // save. If they did, the .finally block will kick another save and
        // the state will move 'saving' → 'dirty' implicitly via that call.
        if (dirtyFields.size === 0 && !nextSavePending) {
          setState('saved', { savedAt: new Date() });
          // No more dirty work — kill the heartbeat so we don't leave a
          // ghost 30s timer running that no-ops on fire.
          if (heartbeatId) {
            clearTimeout(heartbeatId);
            heartbeatId = null;
          }
        }
      } catch (err) {
        if (err && err.name === 'AbortError') {
          // Forward-looking: dispose() during a save will short-circuit once
          // FormsApi.upsertInstance forwards the AbortSignal. Today the
          // request settles silently and the cfg-null guard in .finally
          // prevents any callbacks from firing.
          return;
        }
        if (err && err.status === 409 && err.payload) {
          await handleConflict(err, fieldsBeingSaved, localTemplateId, localJtOrgId, localJtJobId);
        } else if (err && isPermanentStatus(err.status)) {
          // 401/403/404 — permanent. Do NOT re-add fieldsBeingSaved to
          // dirtyFields; we'd just hammer the same doomed request on the
          // next markDirty. Surface meta.permanent so the caller can render
          // a clearer pill (e.g. "Auth error" / "Permission denied").
          setState('offline', { error: err, permanent: true, status: err.status });
        } else if (err && err.status >= 400 && err.status < 600) {
          // Transient 4xx (non-409, non-permanent) or 5xx — keep dirty
          // fields and let the next markDirty trigger a retry.
          for (const fid of fieldsBeingSaved) dirtyFields.add(fid);
          setState('offline', { error: err, permanent: false });
        } else {
          // Network failure (no status) or unknown — treat as transient offline
          for (const fid of fieldsBeingSaved) dirtyFields.add(fid);
          setState('offline', { error: err, permanent: false });
        }
      } finally {
        inFlight = null;
        abortController = null;
        // If more dirty events happened during this save, kick off another
        if (cfg && (nextSavePending || dirtyFields.size > 0)) {
          nextSavePending = false;
          // Fire-and-forget — Promise tracked via the new inFlight
          forceSave();
        } else {
          // Nothing left to send. Release setStatus() callers whether the
          // change landed or failed — a stuck promise would leave the
          // drawer's Mark complete button disabled forever.
          settleStatusWaiters();
        }
      }
    })();

    return inFlight;
  }

  /**
   * Build the `fields` payload from local data. We send the full local
   * snapshot of all fields the engine knows about (i.e. anything in
   * `data`) — NOT a delta. Rationale: the server merges by key so
   * unchanged fields are harmless no-ops, and on the 409-then-retry path
   * this guarantees merged-from-server fields (now in `data`) get re-sent
   * with the merged value.
   */
  function buildFieldsPayload() {
    const out = {};
    for (const k of Object.keys(data)) {
      out[k] = data[k];
    }
    return out;
  }

  /**
   * The full upsert body, including a pending lifecycle change when one is
   * queued. `status` is only ever sent when the user explicitly asked for it
   * — a background save must never carry one, or the server's completion
   * lock would have nothing to bite on.
   */
  function buildUpsertPayload(templateId, jtOrgId, jtJobId) {
    const payload = {
      templateId,
      jtOrgId,
      jtJobId,
      fields: buildFieldsPayload(),
      expectedVersion: version,
    };
    if (pendingStatus !== null) payload.status = pendingStatus;
    return payload;
  }

  /**
   * Adopt the status the server confirmed and retire the change this save
   * actually carried.
   *
   * `sentStatus` matters: a change queued WHILE this save was in flight was
   * never in its payload, so clearing pendingStatus unconditionally would
   * silently swallow the user's "Mark complete". Only the value we sent is
   * retired; anything newer still has to go out.
   *
   * @param {Object} result - the 200 response
   * @param {string|undefined} sentStatus - status included in the request, if any
   */
  function applyStatusFromResult(result, sentStatus) {
    const previous = status;
    const confirmed = result && result.instance && result.instance.status;
    if (confirmed === 'complete' || confirmed === 'in_progress') {
      status = confirmed;
    } else if (sentStatus !== undefined) {
      // Server predates Migration 057 and echoes no status — trust what we sent.
      status = sentStatus;
    }
    if (sentStatus !== undefined && pendingStatus === sentStatus) {
      pendingStatus = null;
    }
    if (status !== previous && cfg && typeof cfg.onStatusChange === 'function') {
      try {
        cfg.onStatusChange(status, result && result.instance ? result.instance : null);
      } catch (err) {
        console.error('FormsSaveEngine: onStatusChange threw', err);
      }
    }
  }

  /** Release every pending setStatus() promise. */
  function settleStatusWaiters() {
    if (statusWaiters.length === 0) return;
    const waiters = statusWaiters;
    statusWaiters = [];
    waiters.forEach((resolve) => resolve());
  }

  /**
   * Handle a 409 from the upsert: parse currentData/currentVersion from
   * the server's errors[0] payload, merge server-only fields into local
   * data, fire onMerge, and retry once with the new version.
   */
  async function handleConflict(err, fieldsBeingSaved, templateId, jtOrgId, jtJobId) {
    const conflictDetail = extractConflictDetail(err.payload);
    if (!conflictDetail) {
      // Malformed 409 — fall back to offline so dirty work is preserved
      for (const fid of fieldsBeingSaved) dirtyFields.add(fid);
      setState('offline', { error: err, permanent: false });
      return;
    }

    const { currentData, currentVersion } = conflictDetail;
    const refreshedFieldIds = [];

    // Take server values for fields the user touched in NEITHER set:
    //   - fieldsBeingSaved: this just-attempted save
    //   - dirtyFields:      changes the user has made since (next attempt)
    // The user's most recent write always wins.
    for (const fid of Object.keys(currentData)) {
      if (!fieldsBeingSaved.has(fid) && !dirtyFields.has(fid)) {
        if (JSON.stringify(data[fid]) !== JSON.stringify(currentData[fid])) {
          data[fid] = currentData[fid];
          refreshedFieldIds.push(fid);
        }
      }
    }

    version = currentVersion;

    if (cfg && cfg.onMerge && refreshedFieldIds.length > 0) {
      try {
        // Server doesn't surface lastEditedBy/At in its 409 payload; pass
        // null so callers can render a generic "merged" indicator.
        cfg.onMerge(refreshedFieldIds, null, null);
      } catch (e) {
        console.error('FormsSaveEngine: onMerge threw', e);
      }
    }

    // Retry once with merged data + new version (carrying any pending status
    // change — a conflict must not swallow the user's "Mark complete").
    try {
      const retryPayload = buildUpsertPayload(templateId, jtOrgId, jtJobId);
      const retry = await window.FormsApi.upsertInstance(retryPayload);
      version = readVersion(retry, version);
      applyStatusFromResult(retry, retryPayload.status);
      if (dirtyFields.size === 0 && !nextSavePending) {
        setState('saved', { savedAt: new Date(), refreshedFieldIds });
        if (heartbeatId) {
          clearTimeout(heartbeatId);
          heartbeatId = null;
        }
      }
    } catch (retryErr) {
      if (retryErr && retryErr.name === 'AbortError') {
        return;
      }
      if (retryErr && retryErr.status === 409) {
        // Third writer raced — pin to conflict for the caller's diff modal
        const retryDetail = extractConflictDetail(retryErr.payload) || {};
        setState('conflict', {
          error: retryErr,
          currentData: retryDetail.currentData || null,
          currentVersion: retryDetail.currentVersion || null,
        });
        // Don't re-add the fields — caller will resolve and the next
        // markDirty after resolution will trigger a fresh save.
      } else if (retryErr && isPermanentStatus(retryErr.status)) {
        // 401/403/404 on retry — permanent. Don't re-add fields.
        setState('offline', { error: retryErr, permanent: true, status: retryErr.status });
      } else {
        // Network or 500 on retry — surface as offline, preserve dirty
        for (const fid of fieldsBeingSaved) dirtyFields.add(fid);
        setState('offline', { error: retryErr, permanent: false });
      }
    }
  }

  /**
   * Pull { currentData, currentVersion } out of the server's 409 payload.
   * Server contract (forms-handler.js): payload.errors[0] = { field,
   * reason, currentVersion, currentData }.
   *
   * Defensive: also accept a flat shape { currentData, currentVersion }
   * in case the contract evolves.
   */
  function extractConflictDetail(payload) {
    if (!payload || typeof payload !== 'object') return null;
    if (Array.isArray(payload.errors) && payload.errors.length > 0) {
      const e = payload.errors[0];
      if (e && Number.isInteger(e.currentVersion) && e.currentData && typeof e.currentData === 'object') {
        return { currentData: e.currentData, currentVersion: e.currentVersion };
      }
    }
    if (Number.isInteger(payload.currentVersion) && payload.currentData && typeof payload.currentData === 'object') {
      return { currentData: payload.currentData, currentVersion: payload.currentVersion };
    }
    return null;
  }

  /**
   * Classify HTTP status codes that indicate a permanent failure where
   * retrying the same request will keep failing (auth/perm/not-found).
   * 5xx, 429, and missing-status network errors stay transient.
   */
  function isPermanentStatus(httpStatus) {
    // 423 Locked: the worksheet is marked complete, so the same write will
    // keep being refused until someone reopens it. Retrying is pointless.
    return httpStatus === 401 || httpStatus === 403
      || httpStatus === 404 || httpStatus === 423;
  }

  /**
   * Read the new optimistic version off a 200 upsert response. Server
   * shape: { instance: { ..., optimisticVersion }, schema }.
   */
  function readVersion(result, fallback) {
    if (result && result.instance && Number.isInteger(result.instance.optimisticVersion)) {
      return result.instance.optimisticVersion;
    }
    if (result && Number.isInteger(result.optimisticVersion)) {
      return result.optimisticVersion;
    }
    return fallback;
  }

  // ─── Public: getters ─────────────────────────────────────────────

  /**
   * Read current local data. Returns a shallow copy so callers can't
   * mutate engine state.
   */
  function getData() {
    return Object.assign({}, data);
  }

  /**
   * Read current optimistic version.
   */
  function getVersion() {
    return version;
  }

  /**
   * The lifecycle status this engine believes the instance holds.
   * @returns {string} 'in_progress' | 'complete'
   */
  function getStatus() {
    return pendingStatus !== null ? pendingStatus : status;
  }

  /**
   * True while the worksheet is locked against edits.
   */
  function isComplete() {
    return getStatus() === 'complete';
  }

  /**
   * Queue a lifecycle change and push it immediately.
   *
   * 'complete' marks the worksheet done and locks it; 'in_progress' reopens
   * it. The change rides a normal upsert, so whatever the user typed last
   * is flushed in the same round trip.
   *
   * @param {string} newStatus 'in_progress' | 'complete'
   * @returns {Promise<void>} resolves when the write settles
   */
  function setStatus(newStatus) {
    if (!cfg) return Promise.resolve();
    if (newStatus !== 'complete' && newStatus !== 'in_progress') {
      return Promise.reject(new Error('FormsSaveEngine.setStatus: unknown status ' + newStatus));
    }
    if (newStatus === status && pendingStatus === null) return Promise.resolve();
    pendingStatus = newStatus;
    const settled = new Promise((resolve) => statusWaiters.push(resolve));
    if (inFlight) {
      // A save is mid-flight with the OLD payload; queue another so the
      // status change goes out right behind it. The returned promise settles
      // when THAT save lands, not this one.
      nextSavePending = true;
    } else {
      forceSave();
    }
    return settled;
  }

  // ─── Public: dispose ─────────────────────────────────────────────

  /**
   * Tear down: stop heartbeat, abort in-flight save, clear state.
   * markDirty/forceSave become no-ops afterward.
   */
  function dispose() {
    log('dispose');
    if (heartbeatId) {
      clearTimeout(heartbeatId);
      heartbeatId = null;
    }
    if (abortController) {
      // Forward-looking: FormsApi.upsertInstance does not currently forward
      // the AbortSignal to fetch, so this abort() is a no-op for the
      // in-flight request. Once services/forms-api.js threads the signal
      // through, dispose-during-save will short-circuit the network call.
      try { abortController.abort(); } catch (_e) { /* noop */ }
      abortController = null;
    }
    settleStatusWaiters();
    cfg = null;
    data = {};
    version = 0;
    status = 'in_progress';
    pendingStatus = null;
    dirtyFields = new Set();
    inFlight = null;
    nextSavePending = false;
    state = 'idle';
  }

  return {
    init,
    markDirty,
    forceSave,
    getData,
    getVersion,
    getStatus,
    isComplete,
    setStatus,
    dispose,
  };
})();

if (typeof window !== 'undefined') {
  window.FormsSaveEngine = FormsSaveEngine;
}
