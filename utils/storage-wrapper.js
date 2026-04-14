/**
 * JT Power Tools - Storage Wrapper
 * Provides safe Chrome storage operations with comprehensive error handling
 */

const StorageWrapper = (() => {
  /**
   * Safely get data from Chrome storage
   * @param {string|string[]} keys - Storage key(s) to retrieve
   * @param {Object} defaults - Default values if keys don't exist
   * @returns {Promise<Object>} Retrieved data or defaults
   */
  async function get(keys, defaults = {}) {
    return new Promise((resolve) => {
      try {
        if (!chrome?.storage?.sync) {
          console.error('JT-Tools Storage: Chrome storage API not available');
          resolve(defaults);
          return;
        }

        chrome.storage.sync.get(keys, (result) => {
          if (chrome.runtime.lastError) {
            console.error('JT-Tools Storage: Get error:', chrome.runtime.lastError.message);
            resolve(defaults);
            return;
          }

          // Merge with defaults for any missing keys
          const finalResult = typeof keys === 'string'
            ? { [keys]: result[keys] ?? defaults[keys] }
            : { ...defaults, ...result };

          resolve(finalResult);
        });
      } catch (error) {
        console.error('JT-Tools Storage: Unexpected get error:', error);
        resolve(defaults);
      }
    });
  }

  /**
   * Safely set data in Chrome storage
   * @param {Object} data - Data to store
   * @returns {Promise<boolean>} True if successful, false otherwise
   */
  async function set(data) {
    return new Promise((resolve) => {
      try {
        if (!chrome?.storage?.sync) {
          console.error('JT-Tools Storage: Chrome storage API not available');
          resolve(false);
          return;
        }

        if (!data || typeof data !== 'object') {
          console.error('JT-Tools Storage: Invalid data provided to set()');
          resolve(false);
          return;
        }

        chrome.storage.sync.set(data, () => {
          if (chrome.runtime.lastError) {
            console.error('JT-Tools Storage: Set error:', chrome.runtime.lastError.message);
            resolve(false);
            return;
          }

          resolve(true);
        });
      } catch (error) {
        console.error('JT-Tools Storage: Unexpected set error:', error);
        resolve(false);
      }
    });
  }

  /**
   * Safely remove data from Chrome storage
   * @param {string|string[]} keys - Key(s) to remove
   * @returns {Promise<boolean>} True if successful, false otherwise
   */
  async function remove(keys) {
    return new Promise((resolve) => {
      try {
        if (!chrome?.storage?.sync) {
          console.error('JT-Tools Storage: Chrome storage API not available');
          resolve(false);
          return;
        }

        chrome.storage.sync.remove(keys, () => {
          if (chrome.runtime.lastError) {
            console.error('JT-Tools Storage: Remove error:', chrome.runtime.lastError.message);
            resolve(false);
            return;
          }

          resolve(true);
        });
      } catch (error) {
        console.error('JT-Tools Storage: Unexpected remove error:', error);
        resolve(false);
      }
    });
  }

  /**
   * Safely clear all data from Chrome storage
   * @returns {Promise<boolean>} True if successful, false otherwise
   */
  async function clear() {
    return new Promise((resolve) => {
      try {
        if (!chrome?.storage?.sync) {
          console.error('JT-Tools Storage: Chrome storage API not available');
          resolve(false);
          return;
        }

        chrome.storage.sync.clear(() => {
          if (chrome.runtime.lastError) {
            console.error('JT-Tools Storage: Clear error:', chrome.runtime.lastError.message);
            resolve(false);
            return;
          }

          resolve(true);
        });
      } catch (error) {
        console.error('JT-Tools Storage: Unexpected clear error:', error);
        resolve(false);
      }
    });
  }

  /**
   * Get storage usage information
   * @returns {Promise<Object>} Storage usage info or null on error
   */
  async function getBytesInUse(keys = null) {
    return new Promise((resolve) => {
      try {
        if (!chrome?.storage?.sync?.getBytesInUse) {
          console.warn('JT-Tools Storage: getBytesInUse not available');
          resolve(null);
          return;
        }

        chrome.storage.sync.getBytesInUse(keys, (bytes) => {
          if (chrome.runtime.lastError) {
            console.error('JT-Tools Storage: getBytesInUse error:', chrome.runtime.lastError.message);
            resolve(null);
            return;
          }

          resolve(bytes);
        });
      } catch (error) {
        console.error('JT-Tools Storage: Unexpected getBytesInUse error:', error);
        resolve(null);
      }
    });
  }

  return {
    get,
    set,
    remove,
    clear,
    getBytesInUse
  };
})();

// Make available globally
if (typeof window !== 'undefined') {
  window.StorageWrapper = StorageWrapper;
}

// Export for use in service worker or Node.js
if (typeof module !== 'undefined' && module.exports) {
  module.exports = StorageWrapper;
}
