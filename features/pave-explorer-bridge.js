/**
 * Pave Explorer Bridge (ISOLATED, always loaded)
 *
 * Connects the MAIN-world Pave sniffer (pave-capture-page.js) to the manual
 * "Pave Explorer" side panel. It is INERT until the panel connects — so it
 * costs nothing when nobody is browsing, and it works independently of the
 * "Record for AI" uploader (inspect + copy Pave without uploading anything).
 *
 * Uses a point-to-point Port (panel → chrome.tabs.connect → here), NOT
 * chrome.runtime.sendMessage, so captured request/response bodies never pass
 * through the background service worker (no SW log noise, tighter data path).
 *
 *   panel connects (name 'pave-explorer')
 *     → subscribe the page sniffer ('browse'), relay each capture over the port
 *   panel disconnects (tab/panel closed)
 *     → unsubscribe, detach
 */
(function () {
  'use strict';

  const PORT_NAME = 'pave-explorer';
  let activePort = null;
  let captureHandler = null;

  function setBrowseSubscriber(on) {
    try {
      window.postMessage(
        { source: 'jt-pt-capture-ctl', subscriber: 'browse', on },
        window.location.origin
      );
    } catch (e) {
      // Same-window post; never break over it.
    }
  }

  function detach() {
    if (captureHandler) {
      window.removeEventListener('message', captureHandler);
      captureHandler = null;
    }
    setBrowseSubscriber(false);
    activePort = null;
  }

  chrome.runtime.onConnect.addListener((port) => {
    if (port.name !== PORT_NAME) return;
    // One browse session at a time; drop any stale port.
    if (activePort) { try { activePort.disconnect(); } catch (e) { /* ignore */ } detach(); }

    activePort = port;
    setBrowseSubscriber(true);

    captureHandler = (event) => {
      if (event.source !== window) return;
      const d = event.data;
      if (d && d.source === 'jt-pt-capture' && d.payload && activePort) {
        try {
          activePort.postMessage({ payload: d.payload });
        } catch (e) {
          detach(); // port closed underneath us
        }
      }
    };
    window.addEventListener('message', captureHandler);

    port.onDisconnect.addListener(() => {
      void chrome.runtime.lastError; // panel closed — expected
      if (activePort === port) detach();
    });
  });
})();
