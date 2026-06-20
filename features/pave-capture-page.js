/**
 * Pave Capture — page-context sniffer (MAIN world, document_start)
 *
 * Patches window.fetch ONCE to observe JobTread's Pave API calls, mirroring
 * the proven PAVE Inspector interceptor. It is INERT by default: it only
 * emits a capture when the ISOLATED-world feature has told it to record
 * (via a window postMessage). When not recording it's a thin passthrough,
 * so leaving the script installed has negligible cost.
 *
 * It never blocks, modifies, or delays the app's requests — it clones the
 * request body, lets the real fetch run, and posts a copy to the content
 * script for sanitization + upload. Lives in MAIN world (not ISOLATED) so
 * it can see the page's own window.fetch and isn't subject to page CSP the
 * way an injected <script> tag would be.
 *
 * Multiple independent consumers can ask it to emit — e.g. the "Record for
 * AI" uploader and the manual Pave Explorer side panel. It emits while ANY
 * subscriber is active and goes silent when the last one detaches.
 *
 * Protocol (window.postMessage, same-window only):
 *   ← { source:'jt-pt-capture-ctl', subscriber:'upload'|'browse', on:boolean }
 *   → { source:'jt-pt-capture', payload:{...} }
 */
(function () {
  'use strict';

  if (window.__jtPtPaveCaptureInstalled) return;
  window.__jtPtPaveCaptureInstalled = true;

  // Active capture subscribers (e.g. 'upload', 'browse'). Emit while non-empty.
  const subscribers = new Set();

  window.addEventListener('message', (event) => {
    if (event.source !== window) return;
    const d = event.data;
    if (d && d.source === 'jt-pt-capture-ctl' && typeof d.subscriber === 'string') {
      if (d.on) subscribers.add(d.subscriber);
      else subscribers.delete(d.subscriber);
    }
  });

  const originalFetch = window.fetch;

  window.fetch = async function (...args) {
    // Fast path: nobody listening → behave exactly like native fetch.
    if (subscribers.size === 0) return originalFetch.apply(this, args);

    const [input, init] = args;
    const url = typeof input === 'string'
      ? input
      : input instanceof Request ? input.url : String(input);

    // Only Pave calls; skip health checks.
    if (!url.includes('/pave') || url.includes('/healthz')) {
      return originalFetch.apply(this, args);
    }

    // Read the request body without consuming the original.
    let requestBody = null;
    try {
      if (init && init.body) {
        requestBody = typeof init.body === 'string'
          ? init.body
          : await new Response(init.body).text();
      } else if (input instanceof Request) {
        requestBody = await input.clone().text();
      }
    } catch (e) {
      // Couldn't read the body — still let the request proceed.
    }

    const response = await originalFetch.apply(this, args);

    // Emit the capture. We read the response body from a clone (never
    // consuming the app's copy) so the manual Pave Explorer can show a
    // Response tab. The "Record for AI" uploader ignores responseBody —
    // it only stores the request query — so this stays cheap for that path.
    if (requestBody) {
      const emit = (responseBody) => {
        try {
          window.postMessage({
            source: 'jt-pt-capture',
            payload: { url, status: response.status, requestBody, responseBody, timestamp: Date.now() },
          }, window.location.origin);
        } catch (e) {
          // Never break the app over a capture failure.
        }
      };
      try {
        response.clone().text().then(emit).catch(() => emit(null));
      } catch (e) {
        emit(null);
      }
    }

    return response;
  };
})();
