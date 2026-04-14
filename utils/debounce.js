/**
 * Debounce and Throttle Utilities
 * Centralized timing control functions for JT Power Tools
 *
 * Used by: budget-hierarchy.js, freeze-header.js, character-counter.js,
 *          rgb-theme.js, kanban-type-filter.js, and more
 */

const TimingUtils = (() => {
  /**
   * Creates a debounced function that delays invoking fn until after
   * delay milliseconds have elapsed since the last time it was invoked.
   *
   * @param {Function} fn - The function to debounce
   * @param {number} delay - Delay in milliseconds
   * @param {Object} options - Optional configuration
   * @param {boolean} options.leading - Invoke on leading edge (default: false)
   * @param {boolean} options.trailing - Invoke on trailing edge (default: true)
   * @returns {Function} The debounced function with .cancel() method
   *
   * @example
   * const debouncedSave = TimingUtils.debounce(save, 500);
   * input.addEventListener('input', debouncedSave);
   * // Later: debouncedSave.cancel(); // Cancel pending execution
   */
  function debounce(fn, delay, options = {}) {
    const { leading = false, trailing = true } = options;
    let timeoutId = null;
    let lastArgs = null;
    let lastThis = null;
    let lastCallTime = 0;

    function invokeFunc() {
      const args = lastArgs;
      const thisArg = lastThis;
      lastArgs = null;
      lastThis = null;
      fn.apply(thisArg, args);
    }

    function debounced(...args) {
      const now = Date.now();
      const isInvoking = shouldInvoke(now);

      lastArgs = args;
      lastThis = this;
      lastCallTime = now;

      if (isInvoking) {
        if (timeoutId === null && leading) {
          invokeFunc();
        }
      }

      // Clear existing timeout
      if (timeoutId !== null) {
        clearTimeout(timeoutId);
      }

      // Set new timeout for trailing invocation
      if (trailing) {
        timeoutId = setTimeout(() => {
          timeoutId = null;
          if (lastArgs !== null) {
            invokeFunc();
          }
        }, delay);
      }
    }

    function shouldInvoke(time) {
      const timeSinceLastCall = time - lastCallTime;
      return lastCallTime === 0 || timeSinceLastCall >= delay;
    }

    debounced.cancel = function() {
      if (timeoutId !== null) {
        clearTimeout(timeoutId);
        timeoutId = null;
      }
      lastArgs = null;
      lastThis = null;
      lastCallTime = 0;
    };

    debounced.flush = function() {
      if (timeoutId !== null && lastArgs !== null) {
        invokeFunc();
        debounced.cancel();
      }
    };

    debounced.pending = function() {
      return timeoutId !== null;
    };

    return debounced;
  }

  /**
   * Creates a throttled function that only invokes fn at most once
   * per every wait milliseconds.
   *
   * @param {Function} fn - The function to throttle
   * @param {number} wait - Wait time in milliseconds
   * @param {Object} options - Optional configuration
   * @param {boolean} options.leading - Invoke on leading edge (default: true)
   * @param {boolean} options.trailing - Invoke on trailing edge (default: true)
   * @returns {Function} The throttled function with .cancel() method
   *
   * @example
   * const throttledScroll = TimingUtils.throttle(handleScroll, 100);
   * window.addEventListener('scroll', throttledScroll);
   */
  function throttle(fn, wait, options = {}) {
    const { leading = true, trailing = true } = options;
    let timeoutId = null;
    let lastArgs = null;
    let lastThis = null;
    let lastInvokeTime = 0;

    function invokeFunc(time) {
      const args = lastArgs;
      const thisArg = lastThis;
      lastArgs = null;
      lastThis = null;
      lastInvokeTime = time;
      fn.apply(thisArg, args);
    }

    function throttled(...args) {
      const now = Date.now();
      const timeSinceLastInvoke = now - lastInvokeTime;

      lastArgs = args;
      lastThis = this;

      // Leading edge invocation
      if (leading && timeSinceLastInvoke >= wait) {
        invokeFunc(now);
        return;
      }

      // Schedule trailing edge invocation
      if (trailing && timeoutId === null) {
        const remaining = wait - timeSinceLastInvoke;
        timeoutId = setTimeout(() => {
          timeoutId = null;
          if (trailing && lastArgs !== null) {
            invokeFunc(Date.now());
          }
        }, remaining > 0 ? remaining : 0);
      }
    }

    throttled.cancel = function() {
      if (timeoutId !== null) {
        clearTimeout(timeoutId);
        timeoutId = null;
      }
      lastArgs = null;
      lastThis = null;
      lastInvokeTime = 0;
    };

    throttled.flush = function() {
      if (lastArgs !== null) {
        invokeFunc(Date.now());
        throttled.cancel();
      }
    };

    return throttled;
  }

  /**
   * Delays execution for specified milliseconds
   * Returns a promise for async/await usage
   *
   * @param {number} ms - Milliseconds to delay
   * @returns {Promise<void>}
   *
   * @example
   * await TimingUtils.delay(100);
   * console.log('100ms later');
   */
  function delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /**
   * Creates a function that runs on next animation frame
   * Useful for batching DOM updates
   *
   * @param {Function} fn - The function to run
   * @returns {Function} The RAF-wrapped function with .cancel() method
   *
   * @example
   * const updateDOM = TimingUtils.raf(renderChanges);
   * // Call multiple times, only runs once per frame
   * updateDOM();
   * updateDOM();
   * updateDOM();
   */
  function raf(fn) {
    let rafId = null;
    let lastArgs = null;
    let lastThis = null;

    function rafHandler(...args) {
      lastArgs = args;
      lastThis = this;

      if (rafId === null) {
        rafId = requestAnimationFrame(() => {
          rafId = null;
          fn.apply(lastThis, lastArgs);
        });
      }
    }

    rafHandler.cancel = function() {
      if (rafId !== null) {
        cancelAnimationFrame(rafId);
        rafId = null;
      }
    };

    return rafHandler;
  }

  /**
   * Creates an interval that can be easily cleaned up
   *
   * @param {Function} fn - The function to run
   * @param {number} interval - Interval in milliseconds
   * @returns {{stop: Function, isRunning: Function}} Controller object
   *
   * @example
   * const timer = TimingUtils.interval(checkStatus, 2000);
   * // Later: timer.stop();
   */
  function interval(fn, intervalMs) {
    let intervalId = setInterval(fn, intervalMs);
    let running = true;

    return {
      stop() {
        if (intervalId !== null) {
          clearInterval(intervalId);
          intervalId = null;
          running = false;
        }
      },
      isRunning() {
        return running;
      }
    };
  }

  // ============================================================
  // PUBLIC API
  // ============================================================

  return {
    debounce,
    throttle,
    delay,
    raf,
    interval
  };
})();

// Make available globally
if (typeof window !== 'undefined') {
  window.TimingUtils = TimingUtils;
}
