/**
 * JT Power Tools - Logging Utility
 * Centralized logging with configurable log levels
 */

const JTLogger = (() => {
  /**
   * Log levels (higher number = more important)
   */
  const LOG_LEVELS = {
    DEBUG: 0,    // Verbose debugging information
    INFO: 1,     // General information
    WARN: 2,     // Warnings
    ERROR: 3,    // Errors
    NONE: 4      // Disable all logging
  };

  /**
   * Current log level - can be changed at runtime
   * Default to INFO for production, DEBUG for development
   */
  let currentLevel = LOG_LEVELS.INFO;

  /**
   * Prefix for all log messages
   */
  const PREFIX = 'JT-Tools';

  /**
   * Feature-specific prefixes for easier filtering
   */
  const featurePrefixes = new Map();

  /**
   * Set the current log level
   * @param {string|number} level - Log level name or number
   */
  function setLevel(level) {
    if (typeof level === 'string') {
      const upperLevel = level.toUpperCase();
      if (LOG_LEVELS.hasOwnProperty(upperLevel)) {
        currentLevel = LOG_LEVELS[upperLevel];
      } else {
        console.warn(`${PREFIX}: Unknown log level "${level}"`);
      }
    } else if (typeof level === 'number') {
      currentLevel = Math.max(0, Math.min(level, LOG_LEVELS.NONE));
    }
  }

  /**
   * Get the current log level
   * @returns {number} Current log level
   */
  function getLevel() {
    return currentLevel;
  }

  /**
   * Enable debug mode (all logs visible)
   */
  function enableDebug() {
    currentLevel = LOG_LEVELS.DEBUG;
    console.info(`${PREFIX}: Debug logging enabled`);
  }

  /**
   * Disable all logging
   */
  function silence() {
    currentLevel = LOG_LEVELS.NONE;
  }

  /**
   * Format a log message with prefix and optional feature tag
   * @param {string} feature - Optional feature name
   * @param {Array} args - Arguments to log
   * @returns {Array} Formatted arguments
   */
  function formatMessage(feature, args) {
    const prefix = feature ? `${PREFIX} [${feature}]:` : `${PREFIX}:`;
    return [prefix, ...args];
  }

  /**
   * Core logging function
   * @param {number} level - Log level
   * @param {string} method - Console method to use
   * @param {string} feature - Optional feature name
   * @param {Array} args - Arguments to log
   */
  function log(level, method, feature, args) {
    if (level >= currentLevel) {
      const formattedArgs = formatMessage(feature, args);
      console[method](...formattedArgs);
    }
  }

  /**
   * Debug log (verbose information)
   * @param {...any} args - Arguments to log
   */
  function debug(...args) {
    log(LOG_LEVELS.DEBUG, 'log', null, args);
  }

  /**
   * Info log (general information)
   * @param {...any} args - Arguments to log
   */
  function info(...args) {
    log(LOG_LEVELS.INFO, 'log', null, args);
  }

  /**
   * Warning log
   * @param {...any} args - Arguments to log
   */
  function warn(...args) {
    log(LOG_LEVELS.WARN, 'warn', null, args);
  }

  /**
   * Error log
   * @param {...any} args - Arguments to log
   */
  function error(...args) {
    log(LOG_LEVELS.ERROR, 'error', null, args);
  }

  /**
   * Create a feature-specific logger
   * @param {string} featureName - Name of the feature
   * @returns {Object} Logger object with debug, info, warn, error methods
   */
  function createFeatureLogger(featureName) {
    return {
      debug: (...args) => log(LOG_LEVELS.DEBUG, 'log', featureName, args),
      info: (...args) => log(LOG_LEVELS.INFO, 'log', featureName, args),
      warn: (...args) => log(LOG_LEVELS.WARN, 'warn', featureName, args),
      error: (...args) => log(LOG_LEVELS.ERROR, 'error', featureName, args),
      /**
       * Log with timing information
       * @param {string} label - Timer label
       */
      time: (label) => {
        if (currentLevel <= LOG_LEVELS.DEBUG) {
          console.time(`${PREFIX} [${featureName}] ${label}`);
        }
      },
      timeEnd: (label) => {
        if (currentLevel <= LOG_LEVELS.DEBUG) {
          console.timeEnd(`${PREFIX} [${featureName}] ${label}`);
        }
      }
    };
  }

  /**
   * Group related logs together
   * @param {string} label - Group label
   * @param {Function} fn - Function containing logs to group
   */
  function group(label, fn) {
    if (currentLevel < LOG_LEVELS.NONE) {
      console.group(`${PREFIX}: ${label}`);
      try {
        fn();
      } finally {
        console.groupEnd();
      }
    }
  }

  /**
   * Collapsed group (hidden by default)
   * @param {string} label - Group label
   * @param {Function} fn - Function containing logs to group
   */
  function groupCollapsed(label, fn) {
    if (currentLevel < LOG_LEVELS.NONE) {
      console.groupCollapsed(`${PREFIX}: ${label}`);
      try {
        fn();
      } finally {
        console.groupEnd();
      }
    }
  }

  return {
    LOG_LEVELS,
    setLevel,
    getLevel,
    enableDebug,
    silence,
    debug,
    info,
    warn,
    error,
    createFeatureLogger,
    group,
    groupCollapsed
  };
})();

// Make available globally
if (typeof window !== 'undefined') {
  window.JTLogger = JTLogger;
}

// Export for use in service worker or Node.js
if (typeof module !== 'undefined' && module.exports) {
  module.exports = JTLogger;
}
