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
 *      posts each Pave request body to this ISOLATED module.
 *   2. Here we extract the grantKey (the upload credential + the source of
 *      the per-user namespace), then sanitize the query: grantKey removed,
 *      JobTread IDs (22-prefixed) replaced with <ID_n> placeholders — the
 *      same "shareable Pave" scheme as the inspector.
 *   3. Sanitized queries are buffered and batch-uploaded through the
 *      background service worker (which has host_permissions, so no CORS).
 *
 * The grantKey never leaves the upload payload — it's stripped from anything
 * stored. Recording is visible to the user via a small on-screen pill.
 */
const PaveCaptureFeature = (() => {
  let isActive = false;
  let messageHandler = null;
  let flushTimer = null;
  let indicatorEl = null;

  // Most recent grantKey seen in captured traffic — the upload credential.
  let lastGrantKey = null;
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

    // Pull the grantKey for the upload credential before we strip it.
    const gk = queryObj.$ && typeof queryObj.$.grantKey === 'string' ? queryObj.$.grantKey : null;
    if (gk) lastGrantKey = gk;

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

  function flush() {
    if (!buffer.length || !lastGrantKey) return;
    const queries = buffer;
    buffer = [];
    const grantKey = lastGrantKey;
    try {
      chrome.runtime.sendMessage(
        { type: 'PAVE_CAPTURE_UPLOAD', grantKey, queries },
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
    indicatorEl = document.createElement('div');
    indicatorEl.id = 'jt-pt-pave-capture-indicator';
    indicatorEl.textContent = '● Recording Pave for AI';
    indicatorEl.style.cssText =
      'position:fixed;bottom:16px;left:16px;z-index:2147483646;' +
      'background:#252525;color:#e0e0e0;border:1px solid #404040;border-radius:6px;' +
      'padding:6px 10px;font:11px system-ui,-apple-system,sans-serif;' +
      'box-shadow:0 4px 12px rgba(0,0,0,0.3);pointer-events:none;opacity:0.85;';
    (document.body || document.documentElement).appendChild(indicatorEl);
  }

  function removeIndicator() {
    if (indicatorEl && indicatorEl.parentNode) indicatorEl.parentNode.removeChild(indicatorEl);
    indicatorEl = null;
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
    lastGrantKey = null;
    isActive = false;
    console.log('PaveCapture: Cleaned up');
  }

  return { init, cleanup, isActive: () => isActive };
})();

window.PaveCaptureFeature = PaveCaptureFeature;
