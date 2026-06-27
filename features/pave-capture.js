/**
 * Pave Query Capture for AI
 *
 * When enabled ("Record for AI"), this captures the real Pave queries the
 * user runs in JobTread and ships them — key-stripped — to the JT Power
 * Tools Worker, where Claude can read them back via the jt_captured_queries
 * MCP tool and reuse working query syntax instead of trial-and-erroring it.
 *
 * Pipeline:
 *   1. A MAIN-world sniffer (pave-capture-page.js) observes window.fetch and
 *      posts each Pave request body to this ISOLATED module — with the
 *      grantKey already redacted, so the live credential never rides the
 *      page-observable postMessage bus.
 *   2. Here we sanitize the query: any residual grantKey blanked, JobTread
 *      IDs (22-prefixed) replaced with <ID_n> placeholders — the same
 *      "shareable Pave" scheme as the inspector.
 *   3. Sanitized queries are buffered and batch-uploaded through the
 *      background service worker (which has host_permissions, so no CORS).
 *      The upload credential is the extension grant key for the active org,
 *      fetched privately via the service worker (FETCH_EXTENSION_GRANT_KEY) —
 *      not scraped from page traffic. The capture endpoint resolves it to the
 *      same org namespace (reads are org-scoped), so results are unchanged.
 *
 * The grantKey never leaves the upload payload — it's stripped from anything
 * stored. Recording is visible to the user via a small on-screen pill.
 */
const PaveCaptureFeature = (() => {
  let isActive = false;
  let messageHandler = null;
  let flushTimer = null;
  let indicatorEl = null;
  let indicatorStyleEl = null;

  // Upload credential: the extension grant key for the active org, fetched
  // privately via the service worker (portal-authed) — NOT scraped from page
  // traffic, so the live JobTread grantKey never has to ride the page-
  // observable postMessage bus. Cached per org; refetched on org change.
  let grantKey = null;
  let grantKeyOrg = null;
  // Pending sanitized queries awaiting upload.
  let buffer = [];

  const FLUSH_INTERVAL_MS = 10000;   // batch every 10s
  const FLUSH_THRESHOLD = 25;        // …or once 25 queries pile up
  const MAX_BUFFER = 200;            // hard cap so a burst can't grow unbounded

  // Root keys that aren't real operations (analyzer noise).
  const SKIP_KEYS = new Set(['$', '_type', 'currentGrant']);
  // Mutation verb prefixes — enough to label a query type, not exhaustive.
  const WRITE_PREFIXES = [
    'create', 'update', 'delete', 'remove', 'add', 'set', 'close', 'reopen',
    'approve', 'deny', 'archive', 'unarchive', 'assign', 'move', 'copy',
    'merge', 'split', 'send', 'import', 'upload', 'attach', 'detach', 'draft',
  ];

  function init() {
    if (isActive) return;
    isActive = true;
    console.log('PaveCapture: Initializing...');

    messageHandler = (event) => {
      if (event.source !== window) return;
      const d = event.data;
      if (d && d.source === 'jt-pt-capture' && d.payload) {
        handleCapture(d.payload);
      }
    };
    window.addEventListener('message', messageHandler);

    // Tell the page-context sniffer to start emitting.
    setRecording(true);

    // Warm the upload credential for the active org so the first flush ships.
    ensureGrantKey();

    flushTimer = setInterval(flush, FLUSH_INTERVAL_MS);
    showIndicator();
    console.log('PaveCapture: Recording for AI');
  }

  function setRecording(on) {
    try {
      window.postMessage(
        { source: 'jt-pt-capture-ctl', subscriber: 'upload', on },
        window.location.origin
      );
    } catch (e) {
      // Same-window post; should never throw, but never break over it.
    }
  }

  function handleCapture(payload) {
    // Only keep successful calls — we want WORKING queries.
    if (payload.status !== 200 || !payload.requestBody) return;

    let parsed;
    try {
      parsed = JSON.parse(payload.requestBody);
    } catch (e) {
      return;
    }

    const queryObj = parsed && parsed.query ? parsed.query : parsed;
    if (!queryObj || typeof queryObj !== 'object') return;

    const sanitized = sanitizeQuery(queryObj);
    if (!sanitized) return;

    const { operation, type, entity } = labelQuery(sanitized);
    // Skip the all-noise page-load chatter (analytics, permission checks).
    if (!operation) return;

    if (buffer.length >= MAX_BUFFER) buffer.shift();
    buffer.push({ query: sanitized, operation, entity, type });

    if (buffer.length >= FLUSH_THRESHOLD) flush();
  }

  /**
   * Deep-clone the query with grantKey removed and JobTread IDs replaced by
   * <ID_n> placeholders. Mirrors the inspector's "shareable Pave" sanitizer,
   * but returns an object (no ID legend — we deliberately don't keep real IDs).
   */
  function sanitizeQuery(queryObj) {
    let json;
    try {
      json = JSON.stringify(queryObj);
    } catch (e) {
      return null;
    }
    // Strip the grantKey value.
    json = json.replace(/("grantKey":\s*")[^"]*(")/g, '$1<GRANT_KEY>$2');
    // Replace JobTread IDs (22-prefixed, 8-30 chars) with stable placeholders.
    const idMap = new Map();
    let counter = 0;
    json = json.replace(/22[A-Za-z0-9]{6,28}/g, (match) => {
      if (!idMap.has(match)) { counter++; idMap.set(match, `<ID_${counter}>`); }
      return idMap.get(match);
    });
    try {
      return JSON.parse(json);
    } catch (e) {
      return null;
    }
  }

  /**
   * Best-effort label: the first real root operation key + a query/mutation
   * type guess. Returns operation:null for pure noise (analytics/permission).
   */
  function labelQuery(queryObj) {
    const keys = Object.keys(queryObj).filter((k) => !SKIP_KEYS.has(k));
    for (const key of keys) {
      const lower = key.toLowerCase();
      if (key === 'collect' || key === 'whoCan' || key === 'can') continue; // noise
      if (key === 'scope') return { operation: 'scope', type: 'query', entity: null };
      const isWrite = WRITE_PREFIXES.some((p) => lower.startsWith(p));
      return { operation: key, type: isWrite ? 'mutation' : 'query', entity: null };
    }
    // Scope-only queries (connection reads) still count.
    if (queryObj.scope) return { operation: 'scope', type: 'query', entity: null };
    return { operation: null, type: 'other', entity: null };
  }

  /**
   * Resolve (and cache) the extension grant key for the active org. Fetched
   * via the service worker, which holds the portal access token — the key
   * never passes through page-world script. Returns null if the org isn't
   * known yet or the user isn't signed into the portal; the upload is skipped
   * and the buffer is retried on the next flush.
   */
  function ensureGrantKey() {
    const org = window.OrgDetector ? window.OrgDetector.getActiveOrg() : null;
    if (!org) return Promise.resolve(null);
    if (grantKey && grantKeyOrg === org) return Promise.resolve(grantKey);
    grantKey = null;
    grantKeyOrg = org;
    return new Promise((resolve) => {
      try {
        chrome.runtime.sendMessage({ type: 'FETCH_EXTENSION_GRANT_KEY', orgName: org }, (res) => {
          if (chrome.runtime.lastError || !res || !res.success || !res.grantKey) {
            const why = (chrome.runtime.lastError && chrome.runtime.lastError.message)
              || (res && res.error) || 'unknown';
            console.warn('PaveCapture: no upload credential yet:', why);
            resolve(null);
            return;
          }
          // Guard against an org switch during the round-trip.
          if (grantKeyOrg === org) grantKey = res.grantKey;
          resolve(res.grantKey);
        });
      } catch (e) {
        console.warn('PaveCapture: grant key fetch failed:', e.message);
        resolve(null);
      }
    });
  }

  async function flush() {
    if (!buffer.length) return;
    const key = await ensureGrantKey();
    if (!key) return; // keep the buffer; retry once a credential is available
    const queries = buffer;
    buffer = [];
    try {
      chrome.runtime.sendMessage(
        { type: 'PAVE_CAPTURE_UPLOAD', grantKey: key, queries },
        (res) => {
          // Surface (but never throw) chrome.runtime errors.
          if (chrome.runtime.lastError) {
            console.warn('PaveCapture: upload failed:', chrome.runtime.lastError.message);
          } else if (res && !res.success) {
            console.warn('PaveCapture: upload rejected:', res.error);
          }
        }
      );
    } catch (e) {
      console.warn('PaveCapture: sendMessage failed:', e.message);
    }
  }

  function showIndicator() {
    if (indicatorEl) return;

    // Keyframes + hover states can't live in inline styles, so inject a small
    // scoped <style>. Everything is namespaced under the pill's id.
    indicatorStyleEl = document.createElement('style');
    indicatorStyleEl.id = 'jt-pt-pave-capture-style';
    indicatorStyleEl.textContent = `
      #jt-pt-pave-capture-indicator {
        position: fixed; bottom: 16px; left: 16px; z-index: 2147483646;
        display: flex; align-items: center; gap: 9px;
        background: #1f1f1f; color: #f0f0f0;
        border: 1px solid #ff4d4d; border-left-width: 4px;
        border-radius: 8px; padding: 8px 10px 8px 12px;
        font: 600 12px/1 system-ui, -apple-system, sans-serif;
        box-shadow: 0 6px 20px rgba(0,0,0,0.45);
      }
      #jt-pt-pave-capture-indicator .jt-pt-rec-dot {
        width: 9px; height: 9px; border-radius: 50%; flex-shrink: 0;
        background: #ff4d4d;
        animation: jt-pt-rec-pulse 1.4s ease-out infinite;
      }
      @keyframes jt-pt-rec-pulse {
        0%   { box-shadow: 0 0 0 0 rgba(255,77,77,0.7); }
        70%  { box-shadow: 0 0 0 7px rgba(255,77,77,0); }
        100% { box-shadow: 0 0 0 0 rgba(255,77,77,0); }
      }
      #jt-pt-pave-capture-indicator .jt-pt-rec-stop {
        margin-left: 4px; background: #ff4d4d; color: #fff;
        border: none; border-radius: 5px; padding: 4px 10px;
        font: 700 11px system-ui, -apple-system, sans-serif; cursor: pointer;
      }
      #jt-pt-pave-capture-indicator .jt-pt-rec-stop:hover { background: #e23b3b; }
      @media (prefers-reduced-motion: reduce) {
        #jt-pt-pave-capture-indicator .jt-pt-rec-dot { animation: none; }
      }
    `;
    (document.head || document.documentElement).appendChild(indicatorStyleEl);

    indicatorEl = document.createElement('div');
    indicatorEl.id = 'jt-pt-pave-capture-indicator';

    const dot = document.createElement('span');
    dot.className = 'jt-pt-rec-dot';

    const text = document.createElement('span');
    text.className = 'jt-pt-rec-text';
    text.textContent = 'Recording Pave for AI';

    const stopBtn = document.createElement('button');
    stopBtn.type = 'button';
    stopBtn.className = 'jt-pt-rec-stop';
    stopBtn.textContent = 'Stop';
    stopBtn.title = 'Stop recording Pave queries';
    stopBtn.addEventListener('click', stopRecording);

    indicatorEl.appendChild(dot);
    indicatorEl.appendChild(text);
    indicatorEl.appendChild(stopBtn);
    (document.body || document.documentElement).appendChild(indicatorEl);
  }

  /**
   * Stop recording from the on-page pill. Persists paveCapture=false (so it
   * stays off and the popup toggle reflects it) and tears the feature down.
   * Mirrors the popup's save path: GET_SETTINGS → flip → SETTINGS_UPDATED; the
   * service worker persists it and relays SETTINGS_CHANGED, which also drives
   * content.js to clean this feature up. cleanup() below is the instant local
   * fallback (idempotent, so the relayed message is a harmless no-op).
   */
  function stopRecording() {
    try {
      chrome.runtime.sendMessage({ type: 'GET_SETTINGS' }, (res) => {
        if (chrome.runtime.lastError) return;
        const settings = (res && res.settings && typeof res.settings === 'object') ? res.settings : {};
        settings.paveCapture = false;
        chrome.runtime.sendMessage({ type: 'SETTINGS_UPDATED', settings }, () => {
          void chrome.runtime.lastError; // ignore — local cleanup covers us
        });
      });
    } catch (e) {
      console.warn('PaveCapture: stop failed:', e.message);
    }
    cleanup();
  }

  function removeIndicator() {
    if (indicatorEl && indicatorEl.parentNode) indicatorEl.parentNode.removeChild(indicatorEl);
    indicatorEl = null;
    if (indicatorStyleEl && indicatorStyleEl.parentNode) indicatorStyleEl.parentNode.removeChild(indicatorStyleEl);
    indicatorStyleEl = null;
  }

  function cleanup() {
    if (!isActive) return;
    console.log('PaveCapture: Cleaning up...');
    setRecording(false);
    if (flushTimer) { clearInterval(flushTimer); flushTimer = null; }
    flush(); // ship anything left
    if (messageHandler) { window.removeEventListener('message', messageHandler); messageHandler = null; }
    removeIndicator();
    buffer = [];
    grantKey = null;
    grantKeyOrg = null;
    isActive = false;
    console.log('PaveCapture: Cleaned up');
  }

  return { init, cleanup, isActive: () => isActive };
})();

window.PaveCaptureFeature = PaveCaptureFeature;
