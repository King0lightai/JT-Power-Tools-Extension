/**
 * JT Power Tools - Centralized Error Handler
 * Provides consistent error handling and logging across all features
 */

const ErrorHandler = (() => {
  const ERROR_PREFIX = 'JT-Tools Error:';
  const WARN_PREFIX = 'JT-Tools Warning:';

  /**
   * Log an error with context
   * @param {string} context - Where the error occurred (e.g., 'Formatter', 'DragDrop')
   * @param {Error|string} error - The error object or message
   * @param {Object} additionalData - Optional additional context
   */
  function logError(context, error, additionalData = {}) {
    const errorMessage = error instanceof Error ? error.message : error;
    const errorStack = error instanceof Error ? error.stack : '';

    console.error(`${ERROR_PREFIX} [${context}]`, errorMessage);

    if (errorStack) {
      console.error('Stack trace:', errorStack);
    }

    if (Object.keys(additionalData).length > 0) {
      console.error('Additional context:', additionalData);
    }
  }

  /**
   * Log a warning with context
   * @param {string} context - Where the warning occurred
   * @param {string} message - The warning message
   * @param {Object} additionalData - Optional additional context
   */
  function logWarning(context, message, additionalData = {}) {
    console.warn(`${WARN_PREFIX} [${context}]`, message);

    if (Object.keys(additionalData).length > 0) {
      console.warn('Additional context:', additionalData);
    }
  }

  /**
   * Safely execute a function with error handling
   * @param {Function} fn - Function to execute
   * @param {string} context - Context for error logging
   * @param {Function} fallback - Optional fallback function if main function fails
   * @returns {*} Result of function execution or undefined on error
   */
  function safeExecute(fn, context, fallback = null) {
    try {
      return fn();
    } catch (error) {
      logError(context, error);
      if (fallback && typeof fallback === 'function') {
        try {
          return fallback();
        } catch (fallbackError) {
          logError(`${context} (fallback)`, fallbackError);
        }
      }
      return undefined;
    }
  }

  /**
   * Safely execute an async function with error handling
   * @param {Function} fn - Async function to execute
   * @param {string} context - Context for error logging
   * @param {Function} fallback - Optional fallback function if main function fails
   * @returns {Promise<*>} Result of function execution or undefined on error
   */
  async function safeExecuteAsync(fn, context, fallback = null) {
    try {
      return await fn();
    } catch (error) {
      logError(context, error);
      if (fallback && typeof fallback === 'function') {
        try {
          return await fallback();
        } catch (fallbackError) {
          logError(`${context} (fallback)`, fallbackError);
        }
      }
      return undefined;
    }
  }

  /**
   * Wrap a MutationObserver callback with error handling
   * @param {Function} callback - The observer callback
   * @param {string} context - Context for error logging
   * @returns {Function} Wrapped callback
   */
  function wrapObserverCallback(callback, context) {
    return (...args) => {
      try {
        callback(...args);
      } catch (error) {
        logError(`${context} (MutationObserver)`, error);
      }
    };
  }

  /**
   * Wrap an event handler with error handling
   * @param {Function} handler - The event handler
   * @param {string} context - Context for error logging
   * @returns {Function} Wrapped handler
   */
  function wrapEventHandler(handler, context) {
    return (event) => {
      try {
        handler(event);
      } catch (error) {
        logError(`${context} (EventHandler)`, error, {
          eventType: event?.type,
          target: event?.target?.tagName
        });
      }
    };
  }

  return {
    logError,
    logWarning,
    safeExecute,
    safeExecuteAsync,
    wrapObserverCallback,
    wrapEventHandler
  };
})();

// Make available globally
if (typeof window !== 'undefined') {
  window.ErrorHandler = ErrorHandler;
}

// Export for use in service worker or Node.js
if (typeof module !== 'undefined' && module.exports) {
  module.exports = ErrorHandler;
}
