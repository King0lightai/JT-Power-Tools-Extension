/**
 * Tweak Engine — applies user-authored tweaks (CSS + declarative DOM
 * actions) to JobTread pages, scoped by JT org name and URL pathname.
 *
 * Storage model (Phase 2):
 *   - Server is source of truth: TweaksApi.list(jtOrg) returns the
 *     authoritative tweak set + per-account diagnostics.
 *   - chrome.storage.local['jtTweaks:<orgName>'] is a per-org offline cache
 *     (write-through after every successful server fetch). Keyed per org so
 *     tabs on different orgs never contend on one key — see storage.js
 *     (window.TweakStorage), which also migrates the legacy single 'jtTweaks'
 *     array into per-org keys on first run.
 *   - chrome.storage.local['jtTweakDiagnostics'] mirrors per-tweak
 *     diagnostics; the engine still buffers locally and flushes to the
 *     server on a debounce (best-effort).
 *
 * Init flow:
 *   1. Read the active org's cached bucket → apply matching tweaks immediately
 *      (instant render even if the network is slow or the user isn't logged in).
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
  const injectedStyles = new Map();   // tweakId -> <style> element
  let observers = [];                // MutationObservers
  let eventListeners = [];           // {target, event, handler}
  let tweakEventListeners = [];      // [{ tweakId, target, event, handler, useCapture }]
  let actionAppliers = [];           // [{ tweakId, run }] — re-runnable action passes

  // ─── Clickjacking guard for setText ──────────────────────────────
  // setText refuses to overwrite a button-like element whose CURRENT
  // textContent matches a destructive/financial action word. Blocks the
  // most plausible UI-redress attack — e.g. relabel "Approve" to "Cancel"
  // so the user clicks thinking they're cancelling but actually approves.
  // Conservative: catches both English variants and JT's common verbiage
  // (Submit, Send, Post Bill, Pay, Sign, etc.). False positives (refuses
  // a legitimate relabel of a primary action button) are acceptable;
  // false negatives are not. Authors who genuinely need to restyle a
  // primary button can use CSS or addClass to change appearance without
  // changing the click target's label.
  const PROTECTED_ACTION_WORDS_RE = /\b(approve|approval|approves|approved|approving|confirm|confirms|confirmed|confirming|confirmation|delete|deletes|deleted|deleting|remove|removes|removed|removing|discard|discards|discarded|discarding|archive|archives|archived|archiving|reject|rejects|rejected|rejecting|submit|submits|submitted|submitting|send|sends|sent|sending|resend|pay|paid|paying|payment|payments|charge|charges|charged|charging|refund|refunds|refunded|refunding|sign|signs|signed|signing|signature|post|posts|posted|posting|publish|publishes|published|publishing)\b/i;

  function isButtonLike(el) {
    if (!el || !el.tagName) return false;
    const tag = el.tagName;
    if (tag === 'BUTTON') return true;
    if (tag === 'INPUT') {
      const t = (el.type || '').toLowerCase();
      if (t === 'submit' || t === 'button') return true;
    }
    if (el.getAttribute && el.getAttribute('role') === 'button') return true;
    return false;
  }

  function isProtectedPrimaryAction(el) {
    if (!isButtonLike(el)) return false;
    const text = (el.textContent || '').trim();
    // Long blocks of text aren't button labels — primary action buttons
    // are short. Cap protects against e.g. a <div role="button"> that
    // wraps a whole card with accidental "delete" inside the body copy.
    if (!text || text.length > 60) return false;
    return PROTECTED_ACTION_WORDS_RE.test(text);
  }

  // After the extension is reloaded/updated (or a Web Store auto-update),
  // content scripts from the previous version keep running on already-open
  // tabs but lose their connection — any chrome.* call then throws
  // "Extension context invalidated". Guard the hot paths that fire on timers
  // and observers so an orphaned script fails silent until the tab refreshes,
  // instead of spamming uncaught errors.
  function isContextValid() {
    try {
      return !!(chrome.runtime && chrome.runtime.id);
    } catch {
      return false;
    }
  }

  function init() {
    if (isActive) return;
    isActive = true;
    console.log('TweakEngine: Initializing...');
    loadAndApply();
    listenForStorageChanges();
    listenForOrgChanges();
    listenForUrlChanges();
    listenForDryRunRequests();
    listenForBuilderPreview();
    listenForVisibility();
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

  /**
   * Listens for preview events dispatched by builder.js on the shared window.
   * Using window CustomEvents instead of chrome.runtime.sendMessage because
   * content script → content script messaging on the same tab requires
   * chrome.tabs.sendMessage (background relay) — chrome.runtime.sendMessage
   * only reaches the background service worker, not sibling content scripts.
   */
  function listenForBuilderPreview() {
    const applyHandler = (e) => {
      try {
        if (e.detail && e.detail.tweak) previewTweak(e.detail.tweak);
      } catch (err) {
        console.error('TweakEngine: error handling preview apply:', err && err.message);
      }
    };
    const clearHandler = () => {
      try { clearPreview(); } catch (err) {
        console.error('TweakEngine: error handling preview clear:', err && err.message);
      }
    };
    window.addEventListener('jt-tweak-preview-apply', applyHandler);
    window.addEventListener('jt-tweak-preview-clear', clearHandler);
    eventListeners.push({ target: window, event: 'jt-tweak-preview-apply', handler: applyHandler });
    eventListeners.push({ target: window, event: 'jt-tweak-preview-clear', handler: clearHandler });
  }

  /**
   * Re-apply on tab focus / bfcache restore. Browsers throttle (or coalesce)
   * MutationObservers and timers in hidden tabs, so a tweak can fall behind
   * while backgrounded; date tiers (matchDate) also go stale at midnight with
   * no DOM mutation to trigger a re-run. When the tab becomes visible again we
   * re-run every tweak's action applier — debounced, and with NO server
   * round-trip (unlike loadAndApply) so it's cheap on every tab switch. CSS
   * tweaks need nothing here; they re-match new elements automatically.
   */
  function listenForVisibility() {
    const rerun = debounce(() => {
      // Orphaned content script after a reload/update — its chrome.* calls
      // inside a.run() would throw "Extension context invalidated". Bail.
      if (!isContextValid()) return;
      for (const a of actionAppliers) {
        try {
          a.run();
        } catch (err) {
          console.error('TweakEngine: visibility re-apply failed for', a.tweakId, err && err.message);
        }
      }
    }, 100);
    const visHandler = () => { if (document.visibilityState === 'visible') rerun(); };
    const showHandler = (e) => { if (e && e.persisted) rerun(); };  // bfcache restore
    document.addEventListener('visibilitychange', visHandler);
    window.addEventListener('pageshow', showHandler);
    eventListeners.push({ target: document, event: 'visibilitychange', handler: visHandler });
    eventListeners.push({ target: window, event: 'pageshow', handler: showHandler });
  }

  /**
   * Safe mode (B2) — a per-install escape hatch. When on, the engine applies
   * ZERO tweaks so JobTread loads exactly as it ships, but still runs the
   * background server refresh so the cache stays warm for when it's turned
   * off. User-driven only in v1 (never auto-enabled on errors). Reads
   * chrome.storage.local['jtTweakSafeMode']; defaults to off / fails open on
   * any read error so a storage hiccup never silently strands the user's
   * tweaks.
   */
  async function isSafeModeOn() {
    try {
      const stored = await chrome.storage.local.get(['jtTweakSafeMode']);
      return stored.jtTweakSafeMode === true;
    } catch {
      return false;
    }
  }

  async function loadAndApply() {
    // Hydrate auto-disabled state before filtering so a tweak that was
    // auto-disabled in a previous session stays disabled until the user
    // explicitly clicks Re-enable in the popup.
    await hydrateAutoDisabled();
    // One-time split of the legacy single-array cache into per-org keys.
    // Idempotent and cheap after the first run (no legacy key → early return).
    await window.TweakStorage.migrateLegacyIfNeeded();
    // Safe mode short-circuits the apply pass entirely — but we still fall
    // through to refreshFromServer() below so the cache stays fresh for the
    // moment the user turns safe mode off.
    if (await isSafeModeOn()) {
      console.log('TweakEngine: safe mode ON — 0 tweaks applied');
      refreshFromServer().catch((err) => {
        console.log('TweakEngine: server refresh skipped:', err.message);
      });
      return;
    }
    try {
      // Read only the ACTIVE org's bucket — a tab never touches another org's
      // key. matchesContext still applies the enabled / auto-disabled / urlMatch
      // filters; the per-org key already guarantees scope.jtOrg === activeOrg.
      // With no active org yet we apply nothing — jt-org-changed re-runs this
      // once OrgDetector resolves the org.
      const activeOrg = window.OrgDetector ? window.OrgDetector.getActiveOrg() : null;
      const tweaks = activeOrg ? await window.TweakStorage.readOrg(activeOrg) : [];
      const matching = tweaks.filter(matchesContext);
      console.log(`TweakEngine: Loaded ${tweaks.length} for org "${activeOrg}", ${matching.length} match current context`);
      activeTweakIds = new Set();
      for (const tweak of matching) {
        applyTweak(tweak);
      }
      // Transparency: if the active org has org_required tweaks the user
      // hasn't acknowledged on this device, surface a one-time banner.
      // Banner module is best-effort — silently skip if it failed to
      // load (defense in depth so engine still applies tweaks).
      if (window.JTTweakSystemBanner && matching.length) {
        window.JTTweakSystemBanner.maybeShowFor(matching);
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
   * Order-insensitive equality of two tweak arrays. The multi-tab flicker loop
   * comes from writing the SAME set in a different array ORDER on every refresh
   * (each tab orders `merged` by its own active org), so chrome.storage's
   * onChanged fires in the other tab forever. Comparing as a sorted set lets the
   * steady state compare equal, so both tabs stop writing and the loop ends.
   * Full content per tweak (not just id/version/enabled) so a real edit still
   * propagates even if a version field isn't bumped; tweaks are stored exactly
   * as the server returns them (no per-fetch fields), so this converges rather
   * than looping.
   */
  function tweakSetsEqual(a, b) {
    if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return false;
    const norm = (arr) => arr.map((t) => JSON.stringify(t)).sort();
    const sa = norm(a);
    const sb = norm(b);
    for (let i = 0; i < sa.length; i++) {
      if (sa[i] !== sb[i]) return false;
    }
    return true;
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
      // Replace only THIS org's bucket. Per-org keys mean there's no cross-org
      // merge to do — other orgs' caches live under their own keys and are never
      // touched here. Still skip the write when the set is unchanged
      // (order-insensitive): a cheap belt-and-suspenders guard against a needless
      // re-apply if the server returns the same set in a different order. See
      // tweakSetsEqual above; per-org keys are what actually kills the old
      // cross-org ping-pong flicker.
      const existing = await window.TweakStorage.readOrg(activeOrg);
      if (!tweakSetsEqual(existing, tweaks)) {
        await window.TweakStorage.writeOrg(activeOrg, tweaks);
      }
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
      // Keep a handle so the applier can be re-run outside the observer — e.g.
      // when the tab regains focus (see listenForVisibility), which catches
      // changes missed while the tab was backgrounded and date tiers that went
      // stale at midnight with no DOM mutation to trigger a re-run.
      actionAppliers.push({ tweakId: tweak.id, run: applyActions });
      // Re-run on DOM changes. JT is a SPA so new matching elements appear on
      // navigation; a debounced body-level observer catches them. We watch
      // childList+subtree AND the attributes that make a tweak visually drift:
      // 'class' and 'style' (React patches these in place on existing nodes,
      // with no childList change, when props update) plus any date attribute a
      // matchDate action reads. Re-asserting on these keeps a tweak "stuck"
      // even when JT rewrites a styled node without re-creating it. Safe from
      // feedback loops because every verb is idempotent — it writes only when
      // the value differs (see runAction) — so a converged element produces no
      // further mutations.
      const obs = new MutationObserver(debounce(applyActions, 100));
      obs.observe(document.body, {
        childList: true,
        subtree: true,
        attributes: true,
        attributeFilter: observedAttrsForTweak(tweak),
      });
      observers.push(obs);
    }

    // Register onEvent listeners. These are SEPARATE from the action
    // applier loop — applyActions handles DOM-mutation verbs, but
    // onEvent attaches a delegated event listener at document level
    // and cannot be re-applied via observer (it's installed once).
    if (Array.isArray(tweak.actions)) {
      for (let i = 0; i < tweak.actions.length; i++) {
        const action = tweak.actions[i];
        if (action.type === 'onEvent') {
          registerOnEventAction(action, i, tweak);
        } else if (action.type === 'confirmBeforeAction') {
          registerConfirmBeforeAction(action, i, tweak);
        }
      }
    }

    activeTweakIds.add(tweak.id);
    // Clear both the error message AND its timestamp: the tweak just applied
    // cleanly, so any prior one-time error (e.g. a library that wasn't loaded
    // yet) is stale and must stop showing in the popup / on the server.
    recordDiagnostic(tweak.id, { lastApplyAt: Date.now(), lastError: null, lastErrorAt: null });
  }

  // ─── Shared helpers for capture-phase action listeners ──────────────
  // onEvent and confirmBeforeAction both register a document-level capture
  // listener that gates on a selector match, optionally stops propagation,
  // and is tracked in tweakEventListeners for teardown. These three helpers
  // hold that shared shape so the two registrars stay in lockstep.

  function matchesActionSelector(e, selector) {
    // closest() catches events bubbled from a child of a matching element.
    try {
      return !!(e.target && e.target.closest && e.target.closest(selector));
    } catch {
      return false;
    }
  }

  function stopEventPropagation(e) {
    e.stopPropagation();
    // Also stop other capturing/bubbling listeners on the same target.
    if (typeof e.stopImmediatePropagation === 'function') {
      e.stopImmediatePropagation();
    }
  }

  function registerCaptureListener(action, tweak, handler) {
    document.addEventListener(action.event, handler, { capture: true });
    tweakEventListeners.push({
      tweakId: tweak.id,
      target: document,
      event: action.event,
      handler,
      useCapture: true
    });
  }

  function registerOnEventAction(action, actionIndex, tweak) {
    const handler = (e) => {
      // Validate the target matches our selector before doing anything.
      if (!matchesActionSelector(e, action.selector)) return;

      // Apply side effects in the correct order:
      // preventDefault must run BEFORE we yield to async (the alert).
      if (action.preventDefault) e.preventDefault();
      if (action.stopPropagation) stopEventPropagation(e);
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
      // V1.7 — action chaining. After the click pre-effects (preventDefault,
      // stopPropagation, alert), run each step in `then` against its own
      // selector. Steps are DOM-mutation verbs only — the validator rejects
      // `onEvent` inside `then` so we don't recursively register listeners.
      // A failing step is recorded in diagnostics but doesn't abort the chain
      // — partial progress is better than nothing for chained UI updates.
      if (Array.isArray(action.then)) {
        for (let ti = 0; ti < action.then.length; ti++) {
          const step = action.then[ti];
          let matches;
          try {
            matches = document.querySelectorAll(step.selector);
          } catch (err) {
            recordDiagnostic(tweak.id, {
              lastError: `action[${actionIndex}].then[${ti}] invalid selector: ${err.message}`,
              lastErrorAt: Date.now()
            });
            continue;
          }
          for (const stepEl of matches) {
            try {
              runAction(step, stepEl, tweak.id);
            } catch (err) {
              recordDiagnostic(tweak.id, {
                lastError: `action[${actionIndex}].then[${ti}]: ${err.message}`,
                lastErrorAt: Date.now()
              });
            }
          }
        }
      }
    };

    // Capture phase so we fire BEFORE JT's own React-attached handlers,
    // which is required for preventDefault to actually block JT's
    // mousedown→drag handoff.
    registerCaptureListener(action, tweak, handler);
  }

  /**
   * confirmBeforeAction — the "warn before action" verb. Where onEvent fires
   * unconditional side effects, this GATES the action behind a confirm() so a
   * React SPA can ask "are you sure?" before its delegated handler runs.
   *
   * React routes the real action through a single delegated synthetic listener
   * on the root container. A native listener's preventDefault() doesn't stop
   * React's handler (it isn't a "default action"), and stopPropagation alone
   * can only BLOCK — never conditionally proceed. So we intercept in the
   * CAPTURE phase at `document` (above React's root) and use the SYNCHRONOUS
   * native confirm(): on cancel we preventDefault + stopImmediatePropagation
   * (React never sees the event); on OK we do nothing and let the event keep
   * propagating, so the original action runs untouched. A styled async dialog
   * can't gate a synchronous event without block-then-re-dispatch (a future v2).
   *
   * Being document-delegated, this survives React re-renders with no
   * re-wrapping — the whole reason it beats poking at fiber handlers.
   */
  function registerConfirmBeforeAction(action, actionIndex, tweak) {
    const handler = (e) => {
      if (!matchesActionSelector(e, action.selector)) return;

      let proceed;
      try {
        proceed = window.confirm(action.confirm);
      } catch (err) {
        // confirm() unavailable/blocked — fail SAFE (block the action) and
        // surface it, rather than silently letting a guarded action through.
        proceed = false;
        recordDiagnostic(tweak.id, {
          lastError: `action[${actionIndex}] confirm failed: ${err.message}`,
          lastErrorAt: Date.now()
        });
      }

      if (!proceed) {
        // Cancelled — block the event so React's delegated handler and the
        // browser's default both stay dormant.
        e.preventDefault();
        stopEventPropagation(e);
      }
      // Confirmed → return without stopping; the event continues to React and
      // the original action proceeds.
    };

    // Capture phase at document so we run BEFORE React's root-delegated
    // handler. Tracked in tweakEventListeners so teardown removes it (same
    // lifecycle as onEvent).
    registerCaptureListener(action, tweak, handler);
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

  // ─── Auto-disable on suspected breakage ──────────────────────────
  // A tweak that previously matched elements and now consistently
  // matches zero is likely broken because JT shipped a UI change
  // and the tweak's selector no longer resolves. Auto-disable it
  // and surface a "Re-enable" path in the popup so the user knows
  // why their tweak stopped working instead of silently failing.
  //
  // Hysteresis: must hit zero on N consecutive applies AND the streak must
  // have persisted for at least D ms AND the tweak must have had a successful
  // match at least M ms ago.
  //   - The COUNT threshold prevents single-fire transients from tripping.
  //   - The DURATION threshold prevents false positives during initial JT
  //     render: on page load the body MutationObserver can fire 5+ debounced
  //     batches in well under a second while React's subtree forms — without
  //     this gate, every reload was tripping the auto-disable for users.
  //   - The SUCCESS-AGE threshold prevents auto-disabling tweaks that NEVER
  //     matched (those are author bugs, surfaced via the existing "No matches"
  //     chip, not auto-disabled).
  const ZERO_MATCH_THRESHOLD = 5;
  const ZERO_STREAK_MIN_DURATION_MS = 10_000;
  const MIN_SUCCESS_AGE_MS = 30_000;
  const consecutiveZeroMatches = new Map();   // tweakId -> { count, since }
  const autoDisabled = new Map();              // tweakId -> { reason, since, lastSuccessfulMatchCount }

  // ─── Performance-budget auto-disable (B6) ────────────────────────
  // A tweak whose per-pass applier is consistently slow makes JobTread
  // feel broken even though its selectors still match. Trip the SAME
  // auto-disable machinery as the zero-match guard (teardown + popup
  // "Re-enable" recovery) on a streak of over-budget passes. Same
  // hysteresis discipline as the zero-match trip so a one-off slow frame
  // (a GC pause, a heavy JT render tick) never trips it:
  //   - COUNT threshold — N consecutive over-budget passes, and
  //   - DURATION threshold — the streak must have persisted D ms.
  // Only observer-driven passes (applyOnce) are timed; a single fast pass
  // resets the streak. Reuses autoDisableTweak → identical teardown and
  // "Re-enable" recovery as dom_changed.
  const APPLY_BUDGET_MS = 50;
  const PERF_OVERRUN_THRESHOLD = ZERO_MATCH_THRESHOLD;
  const PERF_STREAK_MIN_DURATION_MS = ZERO_STREAK_MIN_DURATION_MS;
  const consecutivePerfOverruns = new Map();  // tweakId -> { count, since }

  /**
   * Hydrate the in-memory autoDisabled map from chrome.storage.local
   * so an auto-disable persists across page navigations within the
   * same browser session AND across browser restarts. Called from
   * loadAndApply on every fresh apply pass.
   */
  async function hydrateAutoDisabled() {
    try {
      const stored = await chrome.storage.local.get(['jtTweakAutoDisabled']);
      const map = (stored.jtTweakAutoDisabled && typeof stored.jtTweakAutoDisabled === 'object')
        ? stored.jtTweakAutoDisabled
        : {};
      autoDisabled.clear();
      for (const [id, entry] of Object.entries(map)) {
        if (entry && typeof entry === 'object' && entry.reason) {
          autoDisabled.set(id, entry);
        }
      }
    } catch (e) {
      console.warn('TweakEngine: failed to hydrate auto-disabled map:', e);
    }
  }

  /**
   * Persist the autoDisabled map to chrome.storage.local so the
   * popup can read it (popup runs in its own context, no in-memory
   * sharing). Fire-and-forget — caller doesn't await.
   */
  function persistAutoDisabled() {
    const obj = Object.fromEntries(autoDisabled.entries());
    chrome.storage.local.set({ jtTweakAutoDisabled: obj }).catch((e) => {
      console.warn('TweakEngine: failed to persist auto-disabled map:', e);
    });
  }

  /**
   * Mark a tweak as auto-disabled and tear down its applied effects.
   * The tweak's own `enabled` flag is intentionally NOT touched —
   * auto-disable is a separate engine-level signal, distinguishable
   * in the popup so the user can tell "I turned this off" from
   * "the engine turned this off because it stopped matching."
   */
  function autoDisableTweak(tweakId, reason, lastSuccessfulMatchCount) {
    if (autoDisabled.has(tweakId)) return;
    autoDisabled.set(tweakId, {
      reason,
      since: Date.now(),
      lastSuccessfulMatchCount: lastSuccessfulMatchCount || 0,
    });
    persistAutoDisabled();
    console.warn('TweakEngine: auto-disabled tweak', tweakId, 'reason:', reason);
    // Tear down injected styles + observers for this specific tweak.
    const styleEl = injectedStyles.get(tweakId);
    if (styleEl && styleEl.parentNode) styleEl.parentNode.removeChild(styleEl);
    injectedStyles.delete(tweakId);
    document.documentElement.classList.remove('jt-tweak-' + tweakId);
    activeTweakIds.delete(tweakId);
    consecutiveZeroMatches.delete(tweakId);
    consecutivePerfOverruns.delete(tweakId);
    // Surface the auto-disable in diagnostics so the popup chip can show
    // a clear reason. Does NOT clear lastError (preserves any prior info).
    // Message varies by trip reason so the user sees WHY it was disabled.
    const detail = reason === 'perf_budget_exceeded'
      ? 'this tweak was slowing the page'
      : 'selectors stopped matching after JT UI change';
    recordDiagnostic(tweakId, {
      lastError: 'auto-disabled: ' + reason + ' — ' + detail + '. Click Re-enable in the popup if you fixed the tweak.',
      lastErrorAt: Date.now(),
    });
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
        // An explicit null error in the partial means a clean apply cleared the
        // error — tell the server to null both error columns (lastErrorAt: null
        // is intentionally NOT sent as last_error_at; the typeof-number guard
        // above already drops it, and clear_error does the actual clearing).
        if (partial.lastError === null) body.clear_error = true;
        if (Object.keys(body).length === 0) continue;
        // Fire and forget — don't await, don't surface errors.
        window.TweaksApi.reportDiagnostics(id, body).catch(() => {});
      }
    }
  }

  /**
   * Resolve the elements an action operates on for one pass. Queries the
   * primary `action.selector` first; if it matches ZERO elements and the
   * action carries an optional `selectorCandidates` array (validated
   * upstream), tries each candidate in order and returns the first that
   * yields ≥1 match. The primary is unchanged whenever it matches, so
   * existing tweaks with no candidates are unaffected. Returns a NodeList /
   * array (empty when nothing — primary or any candidate — matched), or null
   * when the primary selector itself is invalid (caller records + skips).
   */
  function resolveActionMatches(action) {
    let matches;
    try {
      matches = document.querySelectorAll(action.selector);
    } catch {
      return null; // invalid primary selector — caller records + skips
    }
    if (matches.length > 0) return matches;
    // Primary matched nothing — walk the optional fallback candidates.
    if (Array.isArray(action.selectorCandidates)) {
      for (const candidate of action.selectorCandidates) {
        if (typeof candidate !== 'string' || !candidate) continue;
        let alt;
        try {
          alt = document.querySelectorAll(candidate);
        } catch {
          continue; // a bad candidate is skipped, not fatal
        }
        if (alt.length > 0) return alt;
      }
    }
    return matches; // empty NodeList — primary AND all candidates missed
  }

  function makeActionApplier(tweak) {
    // Track which (action, element) pairs we've already applied so re-runs
    // are idempotent. WeakSet by element keyed per action index.
    const appliedSets = tweak.actions.map(() => new WeakSet());

    return function applyOnce() {
      // Time the whole per-pass applier so a consistently slow tweak trips
      // the performance-budget auto-disable (B6). performance.now() is
      // monotonic; the streak/duration hysteresis lives after the loop.
      const passStart = performance.now();
      let totalMatches = 0;
      tweak.actions.forEach((action, i) => {
        // onEvent + confirmBeforeAction are wired separately as delegated
        // document listeners — they don't run during the per-element apply loop.
        if (action.type === 'onEvent' || action.type === 'confirmBeforeAction') return;
        // Resolve via primary selector, falling back to selectorCandidates
        // when the primary matches nothing (C1). null = invalid primary.
        const matches = resolveActionMatches(action);
        if (matches === null) {
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
      // Performance-budget hysteresis (B6). Compare this pass's wall-clock
      // cost against APPLY_BUDGET_MS. A single under-budget pass resets the
      // streak so a one-off slow frame never trips; an over-budget streak
      // that has also persisted for the minimum duration auto-disables the
      // tweak via the SAME path as the zero-match trip.
      evaluatePerfBudget(tweak.id, performance.now() - passStart);
      const now = Date.now();
      const partial = { lastMatchCount: totalMatches, lastApplyAt: now };
      if (totalMatches > 0) {
        // Successful match — reset hysteresis counter and stamp the
        // last-success timestamp / count on the diagnostic record.
        consecutiveZeroMatches.delete(tweak.id);
        partial.lastSuccessfulMatchAt = now;
        partial.lastSuccessfulMatchCount = totalMatches;
      } else {
        // Zero matches. Track count + when the streak started so the
        // threshold check can require a minimum duration — protects against
        // false positives from JT's mid-render mutation bursts on page load.
        let streak = consecutiveZeroMatches.get(tweak.id);
        if (!streak) {
          streak = { count: 0, since: now };
          consecutiveZeroMatches.set(tweak.id, streak);
        }
        streak.count++;
        const streakAge = now - streak.since;
        if (streak.count >= ZERO_MATCH_THRESHOLD && streakAge >= ZERO_STREAK_MIN_DURATION_MS && isContextValid()) {
          // Pull last-success info from the persisted diagnostic
          // (in-memory buffer might not have the historical timestamp
          // if it was flushed already). Wrap in try/catch: on an orphaned
          // post-reload script, chrome.storage.local.get throws SYNCHRONOUSLY
          // ("Extension context invalidated") before returning a promise, so
          // the .catch() below can't see it — fail silent instead.
          try {
            chrome.storage.local.get(['jtTweakDiagnostics']).then((stored) => {
              // Re-check inside the async callback: a successful match between
              // the trip and now would have called consecutiveZeroMatches.delete.
              // Without this, we'd auto-disable a tweak that just started
              // working again — exactly the false-positive we're guarding against.
              if (!consecutiveZeroMatches.has(tweak.id)) return;
              const d = (stored.jtTweakDiagnostics || {})[tweak.id] || {};
              const lastSuccessAt = d.lastSuccessfulMatchAt;
              const lastSuccessCount = d.lastSuccessfulMatchCount || 0;
              if (lastSuccessAt && (Date.now() - lastSuccessAt) >= MIN_SUCCESS_AGE_MS) {
                autoDisableTweak(tweak.id, 'dom_changed', lastSuccessCount);
              }
            }).catch(() => {});
          } catch (_e) { /* extension context invalidated mid-pass — ignore */ }
        }
      }
      recordDiagnostic(tweak.id, partial);
    };
  }

  /**
   * Performance-budget hysteresis for one applyOnce pass (B6). `elapsedMs`
   * is the wall-clock cost of the pass. Under budget → reset the streak (so
   * a single fast pass clears any transient slow run and a one-off slow
   * frame can never trip). Over budget → grow the streak; when it hits both
   * the count and minimum-duration thresholds, auto-disable via the SAME
   * path as the zero-match trip (teardown + popup "Re-enable"). Skipped on an
   * orphaned post-reload script (autoDisableTweak touches chrome.storage).
   */
  function evaluatePerfBudget(tweakId, elapsedMs) {
    if (elapsedMs <= APPLY_BUDGET_MS) {
      consecutivePerfOverruns.delete(tweakId);
      return;
    }
    let streak = consecutivePerfOverruns.get(tweakId);
    if (!streak) {
      streak = { count: 0, since: Date.now() };
      consecutivePerfOverruns.set(tweakId, streak);
    }
    streak.count++;
    const streakAge = Date.now() - streak.since;
    if (streak.count >= PERF_OVERRUN_THRESHOLD && streakAge >= PERF_STREAK_MIN_DURATION_MS && isContextValid()) {
      autoDisableTweak(tweakId, 'perf_budget_exceeded', 0);
    }
  }

  // ─── Date guard helpers (matchDate) ──────────────────────────────
  // Lets an action gate on how many whole calendar days an element's date
  // attribute (default "datetime", e.g. <time datetime="2026-06-17">) is
  // from today. This is what a plain pasted CSS/attribute-prefix tweak
  // CANNOT do: it can't tell "2 days out" apart from "3 days overdue"
  // because it only string-matches the attribute. With matchDate an author
  // writes one addClass per tier (overdue / today / tomorrow / 2+ days out)
  // and gets the full color system. Composes with the `match` text guard.
  /**
   * Whole-day offset between a YYYY-MM-DD(…) date string and today.
   * Both sides are normalized to UTC midnight from their calendar Y/M/D so
   * the diff is a clean integer of calendar days, timezone-stable for
   * date-only comparisons. Negative = past, 0 = today, positive = future.
   * Returns null for a missing/unparseable value (caller fails closed).
   */
  function dayOffsetFromToday(value) {
    if (typeof value !== 'string') return null;
    const m = value.match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (!m) return null;
    const due = Date.UTC(+m[1], +m[2] - 1, +m[3]);
    const now = new Date();
    const today = Date.UTC(now.getFullYear(), now.getMonth(), now.getDate());
    return Math.round((due - today) / 86400000);
  }

  /**
   * True if `el` passes the action's optional `matchDate` guard (or if there
   * is none). Reads `attr` (default "datetime") off `el`, or off a descendant
   * matching `selector` when given, computes its day offset from today, and
   * checks it against the inclusive [min, max] bounds (either bound optional).
   * Missing attribute / unparseable date / missing descendant → false (the
   * action is skipped) so a malformed row never gets mis-shaded.
   */
  function passesDateGuard(action, el) {
    const md = action.matchDate;
    if (!md || typeof md !== 'object') return true;
    let source = el;
    if (typeof md.selector === 'string' && md.selector) {
      try {
        source = el.querySelector(md.selector);
      } catch {
        return false;
      }
      if (!source) return false;
    }
    const attr = (typeof md.attr === 'string' && md.attr) ? md.attr : 'datetime';
    const raw = source.getAttribute ? source.getAttribute(attr) : null;
    const offset = dayOffsetFromToday(raw);
    if (offset === null) return false;
    if (typeof md.min === 'number' && offset < md.min) return false;
    if (typeof md.max === 'number' && offset > md.max) return false;
    return true;
  }

  /**
   * The set of date attributes a tweak's actions read via matchDate (default
   * "datetime"). Used to scope the MutationObserver's attributeFilter so an
   * in-place date change re-triggers the action pass. Empty when no action
   * uses matchDate — those tweaks keep a childList-only observer (no new cost).
   */
  function dateAttrsForTweak(tweak) {
    const attrs = new Set();
    for (const a of (tweak.actions || [])) {
      if (a && a.matchDate) {
        const attr = (typeof a.matchDate.attr === 'string' && a.matchDate.attr) ? a.matchDate.attr : 'datetime';
        attrs.add(attr);
      }
    }
    return [...attrs];
  }

  /**
   * Attribute names a tweak's observer watches: 'class' and 'style' (React
   * patches these in place on existing nodes, causing a tweak to drift) plus
   * any date attribute read via matchDate. Deduped.
   */
  function observedAttrsForTweak(tweak) {
    return [...new Set(['class', 'style', ...dateAttrsForTweak(tweak)])];
  }

  function runAction(action, el, tweakId) {
    // Per-element match guard. Lets authors discriminate elements that
    // share a class signature with non-target elements (e.g. "Vendor"
    // cells among other elements with the same class) without inventing
    // a regex DSL. Substring check on textContent — universal across
    // verbs. Selector-level match counts in diagnostics intentionally
    // remain unfiltered (auto-disable should still detect "selector
    // stopped resolving", not "guard stopped passing").
    if (typeof action.match === 'string' && action.match.length > 0) {
      const text = el.textContent || '';
      if (!text.includes(action.match)) return;
    }
    // Per-element date guard — gate on how far el's date attribute is from
    // today. Like `match`, it filters which elements the action fires on
    // (selector-level match counts stay unfiltered, by the same reasoning).
    if (action.matchDate && !passesDateGuard(action, el)) {
      // Date tiers must stay correct across transitions. When a date-gated
      // addClass no longer matches (an item rolled from "due today" to
      // "overdue" at midnight, or its date was edited), actively REMOVE the
      // class instead of just skipping — otherwise a row accumulates two tier
      // colors. classList.remove is a no-op when the class is absent, so this
      // is safe to call on every pass. Other verbs simply skip on a miss.
      if (action.type === 'addClass') el.classList.remove(action.class);
      return;
    }
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
          // Write only when the value actually differs. Re-asserting on every
          // observer fire is how a tweak survives JT rewriting an element's
          // inline style — but an unconditional write would mutate the style
          // attribute and re-trigger the (style-watching) observer in a loop.
          // Comparing first makes re-application a no-op once converged.
          if (el.style.getPropertyValue(kebab) !== String(val)) {
            el.style.setProperty(kebab, val);
          }
        }
        break;
      case 'hide':
        if (el.dataset.jtTweakHidden !== tweakId) el.dataset.jtTweakHidden = tweakId;
        // Idempotent for the same reason as setStyle — don't rewrite display
        // (and re-fire the style-watching observer) when it's already hidden.
        if (el.style.getPropertyValue('display') !== 'none') {
          el.style.setProperty('display', 'none', 'important');
        }
        break;
      case 'show':
        if (el.dataset.jtTweakHidden === tweakId) {
          delete el.dataset.jtTweakHidden;
          el.style.removeProperty('display');
        }
        break;
      case 'setText':
        // Idempotent: setting textContent replaces the element's children,
        // which is itself a childList mutation — so an unconditional write on
        // every observer fire would re-trigger the childList observer in a
        // loop. Skip when the text already matches.
        if (el.textContent !== action.text) {
          // Clickjacking guard: refuse to overwrite a button-like element
          // whose current text is a destructive/financial action word.
          // See PROTECTED_ACTION_WORDS_RE. Throw is caught by the
          // try/catch in applyActions and recorded in tweak_diagnostics.
          if (isProtectedPrimaryAction(el)) {
            throw new Error('setText refused: target is a primary-action button (text matches a protected pattern — likely clickjacking)');
          }
          // Use textContent to avoid HTML injection. Existing children are wiped.
          el.textContent = action.text;
        }
        break;
      case 'moveBefore':
      case 'moveAfter': {
        // Move target (`el`) so it's the previous/next sibling of the first
        // element matching action.referenceSelector. Cross-parent moves work
        // — target gets reparented onto the reference's parent. Idempotent:
        // skip if already in the requested position. If the reference isn't
        // in the DOM yet, this is a no-op — the MutationObserver will retry
        // on the next DOM tick.
        const reference = document.querySelector(action.referenceSelector);
        if (!reference) return;
        if (el === reference) return;
        if (el.contains(reference)) {
          throw new Error('referenceSelector resolves to a descendant of the target — would create a cycle');
        }
        const sameParent = el.parentNode === reference.parentNode;
        if (action.type === 'moveBefore') {
          if (sameParent && el.nextSibling === reference) return;
          reference.parentNode.insertBefore(el, reference);
        } else {
          if (sameParent && el.previousSibling === reference) return;
          reference.parentNode.insertBefore(el, reference.nextSibling);
        }
        break;
      }
      case 'sortChildren': {
        // Sort the matched parent's element children by a key derived from
        // each child. childSelector (optional) filters which children
        // participate — non-matching siblings keep their original positions.
        // keySelector (optional) extracts the sort key from inside each
        // child; without it, the child's own textContent is used.
        // Idempotent: bail if the children are already in the desired order.
        const currentOrder = Array.from(el.children);
        const matching = action.childSelector
          ? currentOrder.filter((c) => c.matches(action.childSelector))
          : currentOrder.slice();
        if (matching.length < 2) return;

        const direction = action.direction === 'desc' ? -1 : 1;
        const keyType = action.key || 'text';

        const getKey = (child) => {
          let raw;
          if (action.keySelector) {
            const target = child.querySelector(action.keySelector);
            raw = target ? (target.textContent || '').trim() : '';
          } else {
            raw = (child.textContent || '').trim();
          }
          if (keyType === 'number') {
            // Strip currency symbols ($, €), thousands separators (,), whitespace,
            // and any other non-numeric noise before parsing. Keeps digits, the
            // decimal point, and a leading minus so "-$1,234.56" → "-1234.56".
            // Without this, every JT currency column ($1,234.56) parses as NaN
            // and sinks to Infinity — sorting amounts becomes impossible without
            // a custom keySelector pointing at a hidden numeric attribute.
            // Caveats: accounting-style negatives like "($50.00)" lose the
            // negative (parens are stripped); European "1.234,56" gets misread
            // as 1.234. JT is US-only currency-formatted, so this is fine.
            const cleaned = raw.replace(/[^0-9.\-]/g, '');
            const n = parseFloat(cleaned);
            return Number.isNaN(n) ? Infinity : n;
          }
          if (keyType === 'date') {
            const t = Date.parse(raw);
            return Number.isNaN(t) ? Infinity : t;
          }
          return raw.toLowerCase();
        };

        const keyed = matching.map((c) => ({ child: c, key: getKey(c) }));
        const sorted = keyed.slice().sort((a, b) => {
          if (a.key < b.key) return -1 * direction;
          if (a.key > b.key) return  1 * direction;
          return 0;
        }).map((k) => k.child);

        let alreadySorted = true;
        for (let i = 0; i < matching.length; i++) {
          if (matching[i] !== sorted[i]) { alreadySorted = false; break; }
        }
        if (alreadySorted) return;

        // Compute the final children order, preserving non-matching siblings
        // in place. appendChild on an already-attached node moves it, so
        // appending in the desired final order produces the correct final
        // children list (intermediate states are transient).
        const matchingSet = new Set(matching);
        let k = 0;
        const finalOrder = [];
        for (const child of currentOrder) {
          if (matchingSet.has(child)) {
            finalOrder.push(sorted[k++]);
          } else {
            finalOrder.push(child);
          }
        }
        for (const node of finalOrder) {
          el.appendChild(node);
        }
        break;
      }
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
    // Auto-disabled by the engine after consecutive zero-match applies
    // — see autoDisableTweak. User must explicitly re-enable via the
    // popup. Distinguishable from `tweak.enabled` so the popup can
    // surface the reason.
    if (autoDisabled.has(tweak.id)) return false;
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
      // React ONLY to OUR active org's per-org key — a tab on org A ignores
      // writes to jtTweaks:<orgB>, which is what removes the cross-org flicker
      // loop at the source. Also react to auto-disable map changes (the popup
      // writes jtTweakAutoDisabled when the user clicks Re-enable, and we want
      // the engine to retry that tweak). The legacy jtTweaks key is deliberately
      // NOT watched: migration removes it, and we don't want to react to that.
      const activeOrg = window.OrgDetector ? window.OrgDetector.getActiveOrg() : null;
      const orgKey = activeOrg ? window.TweakStorage.keyForOrg(activeOrg) : null;
      const tweaksChanged = !!(orgKey && changes[orgKey]);
      // Safe-mode flips (B2) drive a full teardown + re-apply just like a
      // tweak-set change: turning it ON tears down everything (loadAndApply
      // then short-circuits to zero tweaks); turning it OFF hot-re-applies
      // with no page reload.
      const safeModeChanged = !!changes.jtTweakSafeMode;
      if (!tweaksChanged && !changes.jtTweakAutoDisabled && !safeModeChanged) return;
      console.log('TweakEngine: storage changed, re-applying',
        safeModeChanged ? '(safe mode)' : (tweaksChanged ? '(tweaks)' : '(auto-disable map)'));
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

  // ─── SPA navigation re-apply ─────────────────────────────────────
  // Tweaks are scoped by `urlMatch` (substring of pathname). The body
  // MutationObserver re-runs ACTIONS on DOM mutations, but it never
  // re-evaluates which tweaks MATCH the current URL — so a tweak
  // scoped to /jobs/123 never enters the active set when JT pushes
  // /jobs → /jobs/123 without a hard reload. We monkey-patch
  // history.pushState/replaceState (JT/React route through these)
  // and listen for popstate. A 200ms debounce gives React time to
  // render the new view before we re-query selectors.
  let urlChangeState = null;
  function listenForUrlChanges() {
    const origPush = history.pushState;
    const origReplace = history.replaceState;

    const fire = () => window.dispatchEvent(new Event('jt-tweak-url-changed'));

    const wrappedPush = function (...args) {
      const r = origPush.apply(this, args);
      fire();
      return r;
    };
    const wrappedReplace = function (...args) {
      const r = origReplace.apply(this, args);
      fire();
      return r;
    };
    history.pushState = wrappedPush;
    history.replaceState = wrappedReplace;

    let lastUrl = window.location.pathname + window.location.search;
    const reapply = debounce(() => {
      const current = window.location.pathname + window.location.search;
      if (current === lastUrl) return;
      lastUrl = current;
      console.log('TweakEngine: URL changed, re-applying tweaks');
      removeAllAppliedTweaks();
      loadAndApply();
    }, 200);

    const popHandler = () => reapply();
    const customHandler = () => reapply();
    window.addEventListener('popstate', popHandler);
    window.addEventListener('jt-tweak-url-changed', customHandler);

    urlChangeState = { origPush, origReplace, wrappedPush, wrappedReplace, popHandler, customHandler };
  }

  function teardownUrlChangeListener() {
    if (!urlChangeState) return;
    // Restore originals only if our wrappers are still on top of the
    // stack. If another layer wrapped after us, leave the chain alone
    // — they own the unwind.
    if (history.pushState === urlChangeState.wrappedPush) {
      history.pushState = urlChangeState.origPush;
    }
    if (history.replaceState === urlChangeState.wrappedReplace) {
      history.replaceState = urlChangeState.origReplace;
    }
    window.removeEventListener('popstate', urlChangeState.popHandler);
    window.removeEventListener('jt-tweak-url-changed', urlChangeState.customHandler);
    urlChangeState = null;
  }

  function removeAllAppliedTweaks() {
    for (const [id, styleEl] of injectedStyles.entries()) {
      if (styleEl && styleEl.parentNode) styleEl.parentNode.removeChild(styleEl);
      document.documentElement.classList.remove('jt-tweak-' + id);
    }
    injectedStyles.clear();
    observers.forEach(o => o.disconnect());
    observers = [];
    actionAppliers = [];
    tweakEventListeners.forEach(({ target, event, handler, useCapture }) => {
      target.removeEventListener(event, handler, useCapture);
    });
    tweakEventListeners = [];
    // Also dismiss any visible alert from a tweak that's being torn down
    const visibleAlert = document.querySelector('.jt-tweak-alert-overlay');
    if (visibleAlert) visibleAlert.remove();
    activeTweakIds.clear();
  }

  // ─── Builder live preview (reversible, separate from the active set) ───
  let previewStyleEl = null;
  const previewTouched = []; // [{ el, prop, prev, text? }] for inline restore

  function clearPreview() {
    if (previewStyleEl && previewStyleEl.parentNode) previewStyleEl.parentNode.removeChild(previewStyleEl);
    previewStyleEl = null;
    document.documentElement.classList.remove('jt-tweak-preview-active');
    document.documentElement.classList.remove('jt-tweak-preview');
    for (const t of previewTouched.splice(0)) {
      if (t.text !== undefined) {
        // setText restore — prop is '' so we must not call style methods on it
        t.el.textContent = t.text;
      } else if (typeof t.prop === 'string' && t.prop.startsWith('__class:')) {
        // addClass restore — remove the class we added
        t.el.classList.remove(t.prop.slice(8));
      } else if (typeof t.prop === 'string' && t.prop.startsWith('__restore-class:')) {
        // removeClass restore — re-add the class we removed
        t.el.classList.add(t.prop.slice(16));
      } else {
        // setStyle / hide restore — prop is a CSS property name
        if (t.prev === null || t.prev === '') {
          t.el.style.removeProperty(t.prop);
        } else {
          t.el.style.setProperty(t.prop, t.prev);
        }
      }
    }
  }

  function previewTweak(tweak) {
    clearPreview();
    if (!tweak || typeof tweak !== 'object') return;
    if (tweak.css && tweak.css.trim() && window.CssSanitizer) {
      const r = window.CssSanitizer.sanitize(tweak.css, { tweakId: 'preview' });
      if (r.ok) {
        previewStyleEl = document.createElement('style');
        previewStyleEl.id = 'jt-tweak-preview';
        previewStyleEl.textContent = r.css;
        document.head.appendChild(previewStyleEl);
        document.documentElement.classList.add('jt-tweak-preview');
      }
    }
    if (Array.isArray(tweak.actions)) {
      for (const a of tweak.actions) {
        if (a.type === 'onEvent' || a.type === 'confirmBeforeAction') continue; // not live-previewable
        let els;
        try { els = document.querySelectorAll(a.selector); } catch (e) { continue; }
        for (const el of els) {
          if (typeof a.match === 'string' && a.match && !(el.textContent || '').includes(a.match)) continue;
          if (a.matchDate && !passesDateGuard(a, el)) continue;
          previewOne(a, el);
        }
      }
    }
  }

  function previewOne(a, el) {
    if (a.type === 'setText') {
      previewTouched.push({ el, prop: '', prev: null, text: el.textContent });
      el.textContent = a.text;
    } else if (a.type === 'hide') {
      const prev = el.style.getPropertyValue('display');
      previewTouched.push({ el, prop: 'display', prev: prev || null });
      el.style.setProperty('display', 'none', 'important');
    } else if (a.type === 'show') {
      const prev = el.style.getPropertyValue('display');
      previewTouched.push({ el, prop: 'display', prev: prev || null });
      el.style.removeProperty('display');
    } else if (a.type === 'addClass') {
      el.classList.add(a.class);
      previewTouched.push({ el, prop: '__class:' + a.class, prev: null });
    } else if (a.type === 'removeClass') {
      const hadClass = el.classList.contains(a.class);
      if (hadClass) {
        el.classList.remove(a.class);
        // Store as a special marker so clearPreview can re-add it
        previewTouched.push({ el, prop: '__restore-class:' + a.class, prev: null });
      }
    } else if (a.type === 'setStyle') {
      for (const [prop, val] of Object.entries(a.style || {})) {
        const kebab = prop.replace(/([A-Z])/g, '-$1').toLowerCase();
        const prev = el.style.getPropertyValue(kebab);
        previewTouched.push({ el, prop: kebab, prev: prev || null });
        el.style.setProperty(kebab, val);
      }
    }
  }

  function cleanup() {
    if (!isActive) return;
    console.log('TweakEngine: Cleaning up...');
    if (diagnosticsFlushTimer) clearTimeout(diagnosticsFlushTimer);
    teardownUrlChangeListener();
    clearPreview();
    removeAllAppliedTweaks();
    // Reset the perf-guard hysteresis so a fresh init() starts clean (B6).
    consecutivePerfOverruns.clear();
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
    _internals: { loadAndApply, removeAllAppliedTweaks, matchesContext, refreshFromServer, previewTweak, clearPreview, dayOffsetFromToday, passesDateGuard, runAction, dateAttrsForTweak, observedAttrsForTweak, resolveActionMatches, evaluatePerfBudget, isSafeModeOn, makeActionApplier, autoDisabled, consecutivePerfOverruns, APPLY_BUDGET_MS, PERF_OVERRUN_THRESHOLD, PERF_STREAK_MIN_DURATION_MS }
  };
})();

window.TweakEngineFeature = TweakEngineFeature;
