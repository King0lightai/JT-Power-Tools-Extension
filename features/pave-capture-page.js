/**
 * Pave Capture — page-context sniffer (MAIN world, document_start)
 *
 * Patches window.fetch AND XMLHttpRequest ONCE to observe JobTread's Pave API
 * calls, mirroring the proven PAVE Inspector interceptor. JobTread uses BOTH
 * transports for /pave — notably the budget grid saves through XHR — so a
 * fetch-only sniffer would silently miss those (often the most useful
 * mutations). It is INERT by default: it only emits a capture when the
 * ISOLATED-world feature has told it to record (via a window postMessage).
 * When not recording it's a thin passthrough, so leaving the script installed
 * has negligible cost.
 *
 * It never blocks, modifies, or delays the app's requests — it reads a copy of
 * the request/response body, lets the real request run, and posts the copy to
 * the content script for sanitization + upload. Lives in MAIN world (not
 * ISOLATED) so it can see the page's own fetch/XHR and isn't subject to page
 * CSP the way an injected <script> tag would be.
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

  // Redact the grantKey before the capture crosses the page-observable
  // window.postMessage bus. This MAIN-world script shares its window with the
  // page, so anything broadcast here is readable by any script on the page
  // (e.g. a JobTread XSS or a hostile co-installed MAIN-world extension). The
  // grantKey is the JobTread credential; neither consumer needs it on the bus
  // anymore — the "Record for AI" uploader authenticates with the extension
  // grant key it fetches privately via the service worker, and the Pave
  // Explorer never needed the live key. Strip it at the source.
  const GRANT_KEY_RE = /("grantKey"\s*:\s*")[^"]*(")/g;
  function redactGrantKey(body) {
    return typeof body === 'string' ? body.replace(GRANT_KEY_RE, '$1<REDACTED>$2') : body;
  }

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
            payload: { url, status: response.status, requestBody: redactGrantKey(requestBody), responseBody, timestamp: Date.now() },
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

  // ── XMLHttpRequest path ──────────────────────────────────────
  // JobTread fires many Pave calls (notably budget saves) through XHR, not
  // fetch, so the fetch hook above misses them. Patch open()/send() with the
  // SAME contract: inert unless a subscriber is recording, /pave only, never
  // block or modify the request, and emit the identical payload shape on
  // completion so both consumers (uploader, Pave Explorer) handle it uniformly.
  const XHR = window.XMLHttpRequest;
  if (XHR && XHR.prototype) {
    const originalOpen = XHR.prototype.open;
    const originalSend = XHR.prototype.send;

    XHR.prototype.open = function (method, url, ...rest) {
      // Stash request coordinates on the instance (cheap; no capture decision yet).
      try {
        this.__jtPtPave = { method, url: String(url) };
      } catch (e) {
        // Some hosts may freeze the instance — never break open().
      }
      return originalOpen.call(this, method, url, ...rest);
    };

    XHR.prototype.send = function (body) {
      const meta = this.__jtPtPave;
      // Fast path: not recording, or not a Pave call → plain native send.
      if (subscribers.size === 0 || !meta || !meta.url.includes('/pave') || meta.url.includes('/healthz')) {
        return originalSend.apply(this, arguments);
      }

      // Capture the request body (Pave bodies are JSON strings). Non-string
      // bodies (Blob/FormData/etc.) are skipped, exactly like the fetch path
      // skips emit when it can't read a body.
      meta.requestBody = typeof body === 'string' ? body : null;

      if (meta.requestBody) {
        // addEventListener (not onload=) so we never clobber the app's handler.
        this.addEventListener('load', function () {
          let responseBody = null;
          try {
            responseBody = (this.responseType === '' || this.responseType === 'text')
              ? this.responseText
              : (this.response != null ? JSON.stringify(this.response) : null);
          } catch (e) {
            // Some responseTypes throw on responseText — emit without a body.
          }
          try {
            window.postMessage({
              source: 'jt-pt-capture',
              payload: {
                url: meta.url, status: this.status,
                requestBody: redactGrantKey(meta.requestBody), responseBody, timestamp: Date.now(),
              },
            }, window.location.origin);
          } catch (e) {
            // Never break the app over a capture failure.
          }
        });
      }

      return originalSend.apply(this, arguments);
    };
  }
})();
