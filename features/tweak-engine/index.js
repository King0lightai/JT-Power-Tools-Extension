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
    // Hydrate auto-disabled state before filtering so a tweak that was
    // auto-disabled in a previous session stays disabled until the user
    // explicitly clicks Re-enable in the popup.
    await hydrateAutoDisabled();
    try {
      const stored = await chrome.storage.local.get(['jtTweaks']);
      const tweaks = Array.isArray(stored.jtTweaks) ? stored.jtTweaks : [];
      const matching = tweaks.filter(matchesContext);
      console.log(`TweakEngine: Loaded ${tweaks.length} total, ${matching.length} match current context`);
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

  // ─── Auto-disable on suspected breakage ──────────────────────────
  // A tweak that previously matched elements and now consistently
  // matches zero is likely broken because JT shipped a UI change
  // and the tweak's selector no longer resolves. Auto-disable it
  // and surface a "Re-enable" path in the popup so the user knows
  // why their tweak stopped working instead of silently failing.
  //
  // Hysteresis: must hit zero on N consecutive applies AND the tweak
  // must have had a successful match at least M ms ago. The first
  // condition prevents false positives from React mid-render. The
  // second prevents auto-disabling tweaks that NEVER matched (those
  // are author bugs, surfaced via the existing "No matches" chip,
  // not auto-disabled).
  const ZERO_MATCH_THRESHOLD = 5;
  const MIN_SUCCESS_AGE_MS = 30_000;
  const consecutiveZeroMatches = new Map();   // tweakId -> count
  const autoDisabled = new Map();              // tweakId -> { reason, since, lastSuccessfulMatchCount }

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
    // Surface the auto-disable in diagnostics so the popup chip can show
    // a clear reason. Does NOT clear lastError (preserves any prior info).
    recordDiagnostic(tweakId, {
      lastError: 'auto-disabled: ' + reason + ' — selectors stopped matching after JT UI change. Click Re-enable in the popup if you fixed the tweak.',
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
      const now = Date.now();
      const partial = { lastMatchCount: totalMatches, lastApplyAt: now };
      if (totalMatches > 0) {
        // Successful match — reset hysteresis counter and stamp the
        // last-success timestamp / count on the diagnostic record.
        consecutiveZeroMatches.delete(tweak.id);
        partial.lastSuccessfulMatchAt = now;
        partial.lastSuccessfulMatchCount = totalMatches;
      } else {
        // Zero matches. Increment counter; if we've crossed the
        // threshold AND the tweak previously worked AND enough time
        // has passed since it last worked, auto-disable.
        const zeros = (consecutiveZeroMatches.get(tweak.id) || 0) + 1;
        consecutiveZeroMatches.set(tweak.id, zeros);
        if (zeros >= ZERO_MATCH_THRESHOLD) {
          // Pull last-success info from the persisted diagnostic
          // (in-memory buffer might not have the historical timestamp
          // if it was flushed already).
          chrome.storage.local.get(['jtTweakDiagnostics']).then((stored) => {
            const d = (stored.jtTweakDiagnostics || {})[tweak.id] || {};
            const lastSuccessAt = d.lastSuccessfulMatchAt;
            const lastSuccessCount = d.lastSuccessfulMatchCount || 0;
            if (lastSuccessAt && (Date.now() - lastSuccessAt) >= MIN_SUCCESS_AGE_MS) {
              autoDisableTweak(tweak.id, 'dom_changed', lastSuccessCount);
            }
          }).catch(() => {});
        }
      }
      recordDiagnostic(tweak.id, partial);
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
        // Clickjacking guard: refuse to overwrite a button-like element
        // whose current text is a destructive/financial action word.
        // See PROTECTED_ACTION_WORDS_RE. Throw is caught by the
        // try/catch in applyActions and recorded in tweak_diagnostics.
        if (isProtectedPrimaryAction(el)) {
          throw new Error('setText refused: target is a primary-action button (text matches a protected pattern — likely clickjacking)');
        }
        // Use textContent to avoid HTML injection. Existing children are wiped.
        el.textContent = action.text;
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
            const n = parseFloat(raw);
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
      // Re-apply on either tweak-set changes OR auto-disable map changes
      // (popup writes to jtTweakAutoDisabled when the user clicks
      // Re-enable, and we want the engine to retry that tweak).
      if (!changes.jtTweaks && !changes.jtTweakAutoDisabled) return;
      console.log('TweakEngine: storage changed, re-applying',
        changes.jtTweaks ? '(tweaks)' : '(auto-disable map)');
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
