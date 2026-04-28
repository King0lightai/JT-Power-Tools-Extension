/**
 * Tweak Engine — applies user-authored tweaks (CSS + declarative DOM
 * actions) to JobTread pages, scoped by JT org name and URL pathname.
 *
 * Storage model (Phase 2):
 *   - Server is source of truth: TweaksApi.list(jtOrg) returns the
 *     authoritative tweak set + per-account diagnostics.
 *   - chrome.storage.local['jtTweaks'] is an offline cache (write-through
 *     after every successful server fetch).
 *   - chrome.storage.local['jtTweakDiagnostics'] mirrors per-tweak
 *     diagnostics; the engine still buffers locally and flushes to the
 *     server on a debounce (best-effort).
 *
 * Init flow:
 *   1. Read cached jtTweaks → apply matching tweaks immediately (instant
 *      render even if the network is slow or the user isn't logged in).
 *   2. Fire a background TweaksApi.list(activeOrg) refresh. On success,
 *      write the response into chrome.storage.local — the existing
 *      storage-change listener triggers a re-apply automatically.
 *   3. On TweaksApi failure (offline, not logged in, server down): keep
 *      using the cache. No user-facing error — degraded but functional.
 *
 * The org-change listener (`jt-org-changed`) re-runs the same flow so
 * switching JT orgs picks up the new org's tweaks.
 */
const TweakEngineFeature = (() => {
  let isActive = false;
  let activeTweakIds = new Set();
  // injectedStyles + observers + tweakEventListeners are populated by the
  // apply phase. Storing here so removeAllAppliedTweaks() owns disposal —
  // apply-phase code MUST write into these, not parallel containers.
  let injectedStyles = new Map();   // tweakId -> <style> element
  let observers = [];                // MutationObservers
  let eventListeners = [];           // {target, event, handler}
  let tweakEventListeners = [];      // [{ tweakId, target, event, handler, useCapture }]

  function init() {
    if (isActive) return;
    isActive = true;
    console.log('TweakEngine: Initializing...');
    loadAndApply();
    listenForStorageChanges();
    listenForOrgChanges();
    listenForDryRunRequests();
    console.log('TweakEngine: Initialized');
  }

  /**
   * Listens for TWEAK_DRY_RUN messages from the editor page. Computes per-
   * selector match counts and a CSS sanitize indicator without applying
   * anything to the DOM. Also handles GET_ACTIVE_ORG so the popup can show
   * the active org without needing the `scripting` permission. Returns true
   * to keep the message channel alive for the async sendResponse pattern;
   * returns false on non-matching messages so other listeners can still pick
   * them up.
   */
  function listenForDryRunRequests() {
    const msgHandler = (message, sender, sendResponse) => {
      if (message && message.type === 'GET_ACTIVE_ORG') {
        try {
          const org = window.OrgDetector ? window.OrgDetector.getActiveOrg() : null;
          sendResponse({ org });
        } catch (err) {
          sendResponse({ org: null, error: err.message });
        }
        return true; // async response
      }
      if (message && message.type === 'TWEAK_DRY_RUN' && message.tweak) {
        try {
          const tweak = message.tweak;
          const matchCounts = {};
          if (tweak.css && tweak.css.trim()) {
            // Quick sanity-check on CSS — does it sanitize cleanly?
            // We don't apply it, just report ok/not-ok as a "(css)" pseudo-row.
            const r = window.CssSanitizer
              ? window.CssSanitizer.sanitize(tweak.css, { tweakId: tweak.id })
              : { ok: false };
            matchCounts['(css)'] = r.ok ? 1 : 0;
          }
          if (Array.isArray(tweak.actions)) {
            for (const a of tweak.actions) {
              try {
                matchCounts[a.selector] = document.querySelectorAll(a.selector).length;
              } catch {
                matchCounts[a.selector] = 0;
              }
            }
          }
          sendResponse({ matchCounts });
        } catch (err) {
          sendResponse({ error: err.message });
        }
        return true; // async response
      }
      return false;
    };
    chrome.runtime.onMessage.addListener(msgHandler);
    eventListeners.push({ target: chrome.runtime.onMessage, event: 'message', handler: msgHandler, isChromeListener: true });
  }

  async function loadAndApply() {
    try {
      const stored = await chrome.storage.local.get(['jtTweaks']);
      const tweaks = Array.isArray(stored.jtTweaks) ? stored.jtTweaks : [];
      const matching = tweaks.filter(matchesContext);
      console.log(`TweakEngine: Loaded ${tweaks.length} total, ${matching.length} match current context`);
      activeTweakIds = new Set();
      for (const tweak of matching) {
        applyTweak(tweak);
      }
    } catch (err) {
      console.error('TweakEngine: Failed to load tweaks:', err);
    }

    // Kick off a background refresh from the server. Don't block apply
    // on this — cache-first means tweaks render instantly. The server
    // response is written back into chrome.storage.local, which triggers
    // our storage-change listener and a fresh apply pass.
    refreshFromServer().catch((err) => {
      // Stay silent on cold-start errors. The next org-change or popup
      // mutation will retry automatically.
      console.log('TweakEngine: server refresh skipped:', err.message);
    });
  }

  /**
   * Pull authoritative tweak set from the server for the current active
   * org and replace the cache. Best-effort: returns silently if there's
   * no active org, no API, or the user isn't logged in.
   */
  async function refreshFromServer() {
    if (!window.TweaksApi || !window.TweaksApi.isAvailable()) {
      // No portal account / not logged in — cache is the only source.
      return;
    }
    const activeOrg = window.OrgDetector ? window.OrgDetector.getActiveOrg() : null;
    if (!activeOrg) {
      // No org detected yet — wait for jt-org-changed to fire and retry.
      return;
    }
    try {
      const { tweaks, diagnostics } = await window.TweaksApi.list(activeOrg);
      console.log(`TweakEngine: Server returned ${tweaks.length} tweaks for org "${activeOrg}"`);
      // Merge server set with any cached tweaks for OTHER orgs (so we
      // don't lose offline data for an org the user isn't currently
      // viewing). The cache is keyed only by tweak content, not by
      // org-of-fetch, so we use scope.jtOrg as the join key.
      const stored = await chrome.storage.local.get(['jtTweaks']);
      const existing = Array.isArray(stored.jtTweaks) ? stored.jtTweaks : [];
      const otherOrgs = existing.filter(t => t && t.scope && t.scope.jtOrg && t.scope.jtOrg !== activeOrg);
      const merged = otherOrgs.concat(tweaks);
      await chrome.storage.local.set({ jtTweaks: merged });
      // Also overwrite diagnostics for the tweaks we have fresh data on.
      // Don't blow away diagnostics for tweaks not in the response.
      const diagStored = await chrome.storage.local.get(['jtTweakDiagnostics']);
      const mergedDiag = { ...(diagStored.jtTweakDiagnostics || {}) };
      for (const [id, d] of Object.entries(diagnostics || {})) {
        mergedDiag[id] = {
          lastMatchCount: d.lastMatchCount,
          lastApplyAt: d.lastApplyAt,
          lastErrorAt: d.lastErrorAt,
          lastError: d.lastErrorMessage  // server name → engine name
        };
      }
      await chrome.storage.local.set({ jtTweakDiagnostics: mergedDiag });
    } catch (err) {
      // Server unreachable, 401, validation issue, etc. Don't leak —
      // engine continues running on cached data.
      console.log('TweakEngine: refreshFromServer failed:', err.message);
    }
  }

  function applyTweak(tweak) {
    // Validate the tweak before doing anything with it. Validation runs again
    // here even though the editor validates on save — defense in depth in
    // case storage was modified outside the editor.
    if (!window.TweakValidator) {
      console.error('TweakEngine: TweakValidator missing, cannot apply', tweak.id);
      recordDiagnostic(tweak.id, { lastError: 'system: TweakValidator not loaded', lastErrorAt: Date.now() });
      return;
    }
    const v = window.TweakValidator.validate(tweak);
    if (!v.ok) {
      console.error('TweakEngine: tweak failed validation, skipping', tweak.id, v.errors);
      recordDiagnostic(tweak.id, { lastError: 'validation: ' + v.errors[0]?.reason, lastErrorAt: Date.now() });
      return;
    }

    // Apply CSS
    if (tweak.css && tweak.css.trim()) {
      if (!window.CssSanitizer) {
        console.error('TweakEngine: CssSanitizer missing, cannot apply', tweak.id);
        recordDiagnostic(tweak.id, { lastError: 'system: CssSanitizer not loaded', lastErrorAt: Date.now() });
        return;
      }
      const sanitizeResult = window.CssSanitizer.sanitize(tweak.css, { tweakId: tweak.id });
      if (!sanitizeResult.ok) {
        console.error('TweakEngine: css sanitization failed, skipping', tweak.id, sanitizeResult.errors);
        recordDiagnostic(tweak.id, { lastError: 'css: ' + sanitizeResult.errors[0]?.reason, lastErrorAt: Date.now() });
        return;
      }
      injectStyle(tweak.id, sanitizeResult.css);
      // Apply the scope class to <html> so descendant selectors match.
      // The scope class is .jt-tweak-{id} — see CssSanitizer.
      document.documentElement.classList.add('jt-tweak-' + tweak.id);
    }

    // Apply actions
    if (Array.isArray(tweak.actions) && tweak.actions.length > 0) {
      const applyActions = makeActionApplier(tweak);
      applyActions();  // run once now
      // Re-run on DOM changes — but only if the tweak's actions haven't been
      // fully applied yet. JT is a SPA so new matching elements appear on
      // navigation. We use a body-level observer with a debounce.
      const obs = new MutationObserver(debounce(applyActions, 100));
      obs.observe(document.body, { childList: true, subtree: true });
      observers.push(obs);
    }

    // Register onEvent listeners. These are SEPARATE from the action
    // applier loop — applyActions handles DOM-mutation verbs, but
    // onEvent attaches a delegated event listener at document level
    // and cannot be re-applied via observer (it's installed once).
    if (Array.isArray(tweak.actions)) {
      for (let i = 0; i < tweak.actions.length; i++) {
        const action = tweak.actions[i];
        if (action.type !== 'onEvent') continue;
        registerOnEventAction(action, i, tweak);
      }
    }

    activeTweakIds.add(tweak.id);
    recordDiagnostic(tweak.id, { lastApplyAt: Date.now(), lastError: null });
  }

  function registerOnEventAction(action, actionIndex, tweak) {
    const handler = (e) => {
      // Validate the target matches our selector. Use closest() so we catch
      // events that bubbled from a child of a matching element.
      let matched;
      try {
        matched = e.target && e.target.closest && e.target.closest(action.selector);
      } catch {
        return;
      }
      if (!matched) return;

      // Apply side effects in the correct order:
      // preventDefault must run BEFORE we yield to async (the alert).
      if (action.preventDefault) e.preventDefault();
      if (action.stopPropagation) {
        e.stopPropagation();
        // Also stop other capturing/bubbling listeners on the same target
        if (typeof e.stopImmediatePropagation === 'function') {
          e.stopImmediatePropagation();
        }
      }
      if (action.alert && window.JTTweakAlert) {
        try {
          window.JTTweakAlert.show(action.alert);
        } catch (err) {
          recordDiagnostic(tweak.id, {
            lastError: `action[${actionIndex}] alert failed: ${err.message}`,
            lastErrorAt: Date.now()
          });
        }
      }
    };

    // Capture phase so we fire BEFORE JT's own React-attached handlers,
    // which is required for preventDefault to actually block JT's
    // mousedown→drag handoff.
    document.addEventListener(action.event, handler, { capture: true });
    tweakEventListeners.push({
      tweakId: tweak.id,
      target: document,
      event: action.event,
      handler,
      useCapture: true
    });
  }

  function injectStyle(tweakId, css) {
    const styleId = 'jt-tweak-style-' + tweakId;
    let styleEl = document.getElementById(styleId);
    if (!styleEl) {
      styleEl = document.createElement('style');
      styleEl.id = styleId;
      styleEl.dataset.tweakId = tweakId;
      document.head.appendChild(styleEl);
    }
    styleEl.textContent = css;
    injectedStyles.set(tweakId, styleEl);
  }

  // In-memory diagnostics, flushed to storage on a debounce.
  const diagnosticsBuffer = new Map();
  let diagnosticsFlushTimer = null;
  function recordDiagnostic(tweakId, partial) {
    const existing = diagnosticsBuffer.get(tweakId) || {};
    diagnosticsBuffer.set(tweakId, { ...existing, ...partial });
    if (diagnosticsFlushTimer) clearTimeout(diagnosticsFlushTimer);
    diagnosticsFlushTimer = setTimeout(flushDiagnostics, 2000);
  }
  async function flushDiagnostics() {
    if (diagnosticsBuffer.size === 0) return;
    // Snapshot before mutating so server pushes use the same data even if
    // a new diagnostic arrives mid-flush.
    const snapshot = new Map(diagnosticsBuffer);
    try {
      const stored = await chrome.storage.local.get(['jtTweakDiagnostics']);
      const merged = { ...(stored.jtTweakDiagnostics || {}) };
      for (const [id, partial] of snapshot.entries()) {
        merged[id] = { ...(merged[id] || {}), ...partial };
      }
      await chrome.storage.local.set({ jtTweakDiagnostics: merged });
      diagnosticsBuffer.clear();
    } catch (err) {
      console.warn('TweakEngine: failed to flush diagnostics', err);
    }

    // Best-effort: push the same diagnostics to the server. Doesn't block
    // the local flush. Skipped silently if the user isn't logged in.
    if (window.TweaksApi && window.TweaksApi.isAvailable()) {
      for (const [id, partial] of snapshot.entries()) {
        // Server expects snake_case field names; map our camelCase.
        const body = {};
        if (typeof partial.lastMatchCount === 'number') body.last_match_count = partial.lastMatchCount;
        if (typeof partial.lastApplyAt === 'number') body.last_apply_at = partial.lastApplyAt;
        if (typeof partial.lastErrorAt === 'number') body.last_error_at = partial.lastErrorAt;
        if (typeof partial.lastError === 'string') body.last_error_message = partial.lastError;
        if (Object.keys(body).length === 0) continue;
        // Fire and forget — don't await, don't surface errors.
        window.TweaksApi.reportDiagnostics(id, body).catch(() => {});
      }
    }
  }

  function makeActionApplier(tweak) {
    // Track which (action, element) pairs we've already applied so re-runs
    // are idempotent. WeakSet by element keyed per action index.
    const appliedSets = tweak.actions.map(() => new WeakSet());

    return function applyOnce() {
      let totalMatches = 0;
      tweak.actions.forEach((action, i) => {
        // onEvent actions are wired separately in registerOnEventAction —
        // they don't run during the per-element apply loop.
        if (action.type === 'onEvent') return;
        let matches;
        try {
          matches = document.querySelectorAll(action.selector);
        } catch (err) {
          recordDiagnostic(tweak.id, { lastError: `action[${i}]: invalid selector`, lastErrorAt: Date.now() });
          return;
        }
        totalMatches += matches.length;
        // The WeakSet skip is only safe for verbs where re-applying could
        // mutate user-visible state in unexpected ways (none in V1). For
        // addClass/removeClass/hide/show/setStyle/setText we re-run on
        // every observer fire because JobTread's React reconciler may
        // rewrite className/style on tracked elements at any time —
        // skipping would let the tweak's effect drift away silently.
        // The DOM-level idempotency of classList/setProperty/textContent
        // makes repeated calls cheap. WeakSet retained only for diagnostics
        // / future verbs.
        for (const el of matches) {
          try {
            runAction(action, el, tweak.id);
            appliedSets[i].add(el);
          } catch (err) {
            recordDiagnostic(tweak.id, { lastError: `action[${i}]: ${err.message}`, lastErrorAt: Date.now() });
          }
        }
      });
      recordDiagnostic(tweak.id, { lastMatchCount: totalMatches, lastApplyAt: Date.now() });
    };
  }

  function runAction(action, el, tweakId) {
    switch (action.type) {
      case 'addClass':
        el.classList.add(action.class);
        break;
      case 'removeClass':
        el.classList.remove(action.class);
        break;
      case 'setStyle':
        for (const [prop, val] of Object.entries(action.style || {})) {
          // setProperty handles both kebab and camel case; convert camel to kebab
          const kebab = prop.replace(/([A-Z])/g, '-$1').toLowerCase();
          el.style.setProperty(kebab, val);
        }
        break;
      case 'hide':
        el.dataset.jtTweakHidden = tweakId;
        el.style.setProperty('display', 'none', 'important');
        break;
      case 'show':
        if (el.dataset.jtTweakHidden === tweakId) {
          delete el.dataset.jtTweakHidden;
          el.style.removeProperty('display');
        }
        break;
      case 'setText':
        // Use textContent to avoid HTML injection. Existing children are wiped.
        el.textContent = action.text;
        break;
      default:
        // Unknown verb — validator should have caught this, but storage
        // tampering or future-version data could slip through.
        throw new Error('unknown action type: ' + action.type);
    }
  }

  function debounce(fn, ms) {
    let t = null;
    return function (...args) {
      if (t) clearTimeout(t);
      t = setTimeout(() => fn.apply(this, args), ms);
    };
  }

  function matchesContext(tweak) {
    if (!tweak.enabled) return false;
    if (!tweak.scope || !tweak.scope.jtOrg) return false;
    const activeOrg = window.OrgDetector ? window.OrgDetector.getActiveOrg() : null;
    if (!activeOrg) return false;
    if (tweak.scope.jtOrg !== activeOrg) return false;
    if (tweak.scope.urlMatch && !window.location.pathname.includes(tweak.scope.urlMatch)) {
      return false;
    }
    return true;
  }

  function listenForStorageChanges() {
    const handler = (changes, areaName) => {
      if (areaName !== 'local') return;
      if (!changes.jtTweaks) return;
      console.log('TweakEngine: Tweak set changed, re-applying');
      removeAllAppliedTweaks();
      loadAndApply();
    };
    chrome.storage.onChanged.addListener(handler);
    eventListeners.push({ target: chrome.storage.onChanged, event: 'change', handler, isChromeListener: true });
  }

  function listenForOrgChanges() {
    const handler = (e) => {
      console.log('TweakEngine: Org changed, re-evaluating tweaks');
      removeAllAppliedTweaks();
      loadAndApply();
    };
    window.addEventListener('jt-org-changed', handler);
    eventListeners.push({ target: window, event: 'jt-org-changed', handler });
  }

  function removeAllAppliedTweaks() {
    for (const [id, styleEl] of injectedStyles.entries()) {
      if (styleEl && styleEl.parentNode) styleEl.parentNode.removeChild(styleEl);
      document.documentElement.classList.remove('jt-tweak-' + id);
    }
    injectedStyles.clear();
    observers.forEach(o => o.disconnect());
    observers = [];
    tweakEventListeners.forEach(({ target, event, handler, useCapture }) => {
      target.removeEventListener(event, handler, useCapture);
    });
    tweakEventListeners = [];
    // Also dismiss any visible alert from a tweak that's being torn down
    const visibleAlert = document.querySelector('.jt-tweak-alert-overlay');
    if (visibleAlert) visibleAlert.remove();
    activeTweakIds.clear();
  }

  function cleanup() {
    if (!isActive) return;
    console.log('TweakEngine: Cleaning up...');
    if (diagnosticsFlushTimer) clearTimeout(diagnosticsFlushTimer);
    removeAllAppliedTweaks();
    eventListeners.forEach(({ target, event, handler, isChromeListener }) => {
      if (isChromeListener) {
        target.removeListener(handler);
      } else {
        target.removeEventListener(event, handler);
      }
    });
    eventListeners = [];
    isActive = false;
    console.log('TweakEngine: Cleaned up');
  }

  return {
    init,
    cleanup,
    isActive: () => isActive,
    // exposed for the editor's "Test on active tab" message handler + popup refresh button
    _internals: { loadAndApply, removeAllAppliedTweaks, matchesContext, refreshFromServer }
  };
})();

window.TweakEngineFeature = TweakEngineFeature;
