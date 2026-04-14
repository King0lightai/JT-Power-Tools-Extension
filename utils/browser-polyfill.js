/**
 * JT Power Tools - Browser Polyfill
 * Provides cross-browser compatibility between Chrome and Firefox
 *
 * Firefox uses the `browser.*` namespace with Promises
 * Chrome uses the `chrome.*` namespace with callbacks (and Promise support in MV3)
 *
 * This polyfill wraps Firefox's `browser.*` APIs so that `chrome.*` calls
 * work correctly — supporting both Promise-based (await) and callback-based
 * usage patterns used throughout the codebase.
 *
 * Covers: storage, tabs, runtime.sendMessage, action/browserAction
 */

(function () {
  'use strict';

  // Detect Firefox specifically.
  // Other browsers (Safari, Edge Chromium, Chrome with webextension-polyfill loaded)
  // also expose `browser.runtime.id`, but their `browser.*` and `chrome.*` are the
  // SAME object — wrapping chrome.runtime.sendMessage then causes infinite recursion
  // because `browser.runtime.sendMessage === chrome.runtime.sendMessage === wrappedSendMessage`.
  //
  // Requirements for Firefox:
  //   1. `browser` exists
  //   2. `browser !== chrome` (real Firefox has separate namespaces)
  //   3. userAgent contains "Firefox"
  const isFirefoxUA = typeof navigator !== 'undefined' && /Firefox/.test(navigator.userAgent);
  const browsersAreDistinct = typeof browser !== 'undefined' && typeof chrome !== 'undefined' && browser !== chrome;
  const isFirefox = isFirefoxUA && browsersAreDistinct && browser.runtime && browser.runtime.id;

  if (!isFirefox) {
    // Chrome/Edge/Safari: nothing to do, chrome.* APIs are native
    return;
  }

  // Firefox: Ensure chrome.action exists (Firefox MV2 uses browser.browserAction)
  if (!chrome.action && chrome.browserAction) {
    chrome.action = chrome.browserAction;
  }

  /**
   * Wrap a Firefox browser.storage area (sync or local) so it works with both:
   *   - Promise-based: `await chrome.storage.sync.get(keys)`
   *   - Callback-based: `chrome.storage.sync.get(keys, callback)`
   *
   * Firefox's native `browser.storage.*` only returns Promises.
   * Chrome's `chrome.storage.*` uses callbacks.
   * Code in this extension uses BOTH patterns, so we need to support both.
   */
  function wrapStorageArea(browserArea) {
    if (!browserArea) return browserArea;

    return {
      _jt_polyfilled: true,

      get: function (keys, callback) {
        const promise = browserArea.get(keys);
        if (typeof callback === 'function') {
          promise.then(function (result) { callback(result); })
                 .catch(function () { callback({}); });
          return;
        }
        return promise;
      },

      set: function (data, callback) {
        const promise = browserArea.set(data);
        if (typeof callback === 'function') {
          promise.then(function () { callback(); })
                 .catch(function () { callback(); });
          return;
        }
        return promise;
      },

      remove: function (keys, callback) {
        const promise = browserArea.remove(keys);
        if (typeof callback === 'function') {
          promise.then(function () { callback(); })
                 .catch(function () { callback(); });
          return;
        }
        return promise;
      },

      clear: function (callback) {
        const promise = browserArea.clear();
        if (typeof callback === 'function') {
          promise.then(function () { callback(); })
                 .catch(function () { callback(); });
          return;
        }
        return promise;
      },

      // getBytesInUse is not supported in Firefox — provide a safe no-op
      getBytesInUse: function (keys, callback) {
        if (typeof browserArea.getBytesInUse === 'function') {
          var promise = browserArea.getBytesInUse(keys);
          if (typeof callback === 'function') {
            promise.then(function (bytes) { callback(bytes); })
                   .catch(function () { callback(0); });
            return;
          }
          return promise;
        }
        // Not available — return 0
        if (typeof callback === 'function') {
          callback(0);
          return;
        }
        return Promise.resolve(0);
      }
    };
  }

  // ─── Override chrome.storage ───────────────────────────────────────────

  if (typeof browser.storage !== 'undefined') {
    var wrappedStorage = {
      sync: wrapStorageArea(browser.storage.sync),
      local: wrapStorageArea(browser.storage.local),
      onChanged: browser.storage.onChanged
    };

    // Try direct assignment first
    try {
      chrome.storage = wrappedStorage;
    } catch (e) {
      // Direct assignment failed (chrome.storage may be non-writable)
    }

    // Verify the override took effect
    if (!chrome.storage || !chrome.storage.local || !chrome.storage.local._jt_polyfilled) {
      // Direct assignment was silently ignored — use Object.defineProperty
      try {
        Object.defineProperty(chrome, 'storage', {
          value: wrappedStorage,
          writable: true,
          configurable: true
        });
      } catch (e2) {
        // Object.defineProperty also failed — last resort: patch individual areas
        try {
          if (chrome.storage) {
            chrome.storage.sync = wrappedStorage.sync;
            chrome.storage.local = wrappedStorage.local;
            chrome.storage.onChanged = wrappedStorage.onChanged;
          }
        } catch (e3) {
          console.error('Browser polyfill: Could not override chrome.storage at all', e3);
        }
      }
    }

    // Final verification
    if (chrome.storage && chrome.storage.local && chrome.storage.local._jt_polyfilled) {
      console.log('Browser polyfill: chrome.storage successfully overridden (sync + local)');
    } else {
      console.warn('Browser polyfill: chrome.storage override may not have taken effect');
    }
  }

  // ─── Override chrome.tabs ─────────────────────────────────────────────
  // Firefox MV2: chrome.tabs.* uses callbacks, but codebase uses await.
  // browser.tabs.* returns Promises. Wrap so chrome.tabs.* returns Promises too.

  if (typeof browser.tabs !== 'undefined') {
    var wrappedTabs = {
      _jt_polyfilled: true,

      query: function (queryInfo, callback) {
        var promise = browser.tabs.query(queryInfo);
        if (typeof callback === 'function') {
          promise.then(function (tabs) { callback(tabs); })
                 .catch(function () { callback([]); });
          return;
        }
        return promise;
      },

      reload: function (tabId, reloadProperties, callback) {
        // Handle overloads: reload(tabId), reload(tabId, props), reload(tabId, callback)
        if (typeof reloadProperties === 'function') {
          callback = reloadProperties;
          reloadProperties = undefined;
        }
        var promise = reloadProperties
          ? browser.tabs.reload(tabId, reloadProperties)
          : browser.tabs.reload(tabId);
        if (typeof callback === 'function') {
          promise.then(function () { callback(); })
                 .catch(function () { callback(); });
          return;
        }
        return promise;
      },

      create: function (createProperties, callback) {
        var promise = browser.tabs.create(createProperties);
        if (typeof callback === 'function') {
          promise.then(function (tab) { callback(tab); })
                 .catch(function () { callback(null); });
          return;
        }
        return promise;
      },

      sendMessage: function (tabId, message, options, callback) {
        // Handle overloads: sendMessage(tabId, msg, cb) or sendMessage(tabId, msg, opts, cb)
        if (typeof options === 'function') {
          callback = options;
          options = undefined;
        }
        var promise = options
          ? browser.tabs.sendMessage(tabId, message, options)
          : browser.tabs.sendMessage(tabId, message);
        if (typeof callback === 'function') {
          promise.then(function (response) { callback(response); })
                 .catch(function () { callback(undefined); });
          return;
        }
        return promise;
      },

      // Proxy onUpdated, onRemoved etc. for any future usage
      onUpdated: browser.tabs.onUpdated,
      onRemoved: browser.tabs.onRemoved,
      onActivated: browser.tabs.onActivated
    };

    // Apply the override
    try {
      chrome.tabs = wrappedTabs;
    } catch (e) {
      // Try Object.defineProperty
      try {
        Object.defineProperty(chrome, 'tabs', {
          value: wrappedTabs,
          writable: true,
          configurable: true
        });
      } catch (e2) {
        console.error('Browser polyfill: Could not override chrome.tabs', e2);
      }
    }

    // Verify
    if (chrome.tabs && chrome.tabs._jt_polyfilled) {
      console.log('Browser polyfill: chrome.tabs successfully overridden');
    } else {
      console.warn('Browser polyfill: chrome.tabs override may not have taken effect');
    }
  }

  // ─── Override chrome.runtime.sendMessage ───────────────────────────────
  // Firefox MV2: chrome.runtime.sendMessage uses callbacks.
  // browser.runtime.sendMessage returns a Promise.
  // Codebase uses both patterns: fire-and-forget AND await.

  if (typeof browser.runtime !== 'undefined' && typeof browser.runtime.sendMessage === 'function') {
    var originalSendMessage = chrome.runtime.sendMessage;

    // Guard against aliased runtimes: if browser.runtime.sendMessage and
    // chrome.runtime.sendMessage are the same function reference, assigning
    // chrome.runtime.sendMessage = wrappedSendMessage would also mutate
    // browser.runtime.sendMessage, causing wrappedSendMessage to call itself
    // infinitely. Some Firefox versions and Firefox-compat browsers alias them.
    if (browser.runtime.sendMessage === chrome.runtime.sendMessage) {
      console.log('Browser polyfill: runtime.sendMessage is already aliased — skipping wrap');
      return;
    }

    // Capture the original browser promise-based sendMessage BEFORE any
    // assignment to chrome.runtime.sendMessage. Even if they're not aliased
    // now, defensive capture prevents future breakage.
    var browserSendMessage = browser.runtime.sendMessage.bind(browser.runtime);

    var wrappedSendMessage = function (message, options, callback) {
      // Handle overloads:
      //   sendMessage(msg)
      //   sendMessage(msg, callback)
      //   sendMessage(msg, options, callback)
      if (typeof options === 'function') {
        callback = options;
        options = undefined;
      }

      var promise = options
        ? browserSendMessage(message, options)
        : browserSendMessage(message);

      if (typeof callback === 'function') {
        promise.then(function (response) { callback(response); })
               .catch(function (err) {
                 console.warn('Browser polyfill: runtime.sendMessage callback error:', err);
                 callback(undefined);
               });
        return; // No return value when using callbacks
      }

      return promise;
    };

    // Bind to chrome.runtime - try direct assignment
    try {
      chrome.runtime.sendMessage = wrappedSendMessage;
    } catch (e) {
      try {
        Object.defineProperty(chrome.runtime, 'sendMessage', {
          value: wrappedSendMessage,
          writable: true,
          configurable: true
        });
      } catch (e2) {
        console.error('Browser polyfill: Could not override chrome.runtime.sendMessage', e2);
      }
    }

    console.log('Browser polyfill: chrome.runtime.sendMessage wrapped for Promise support');
  }

  // ─── Export detection flag ─────────────────────────────────────────────

  if (typeof window !== 'undefined') {
    window.__JT_IS_FIREFOX = true;
  }
  if (typeof globalThis !== 'undefined') {
    globalThis.__JT_IS_FIREFOX = true;
  }
})();
