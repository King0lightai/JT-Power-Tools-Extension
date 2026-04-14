/**
 * JT Power Tools - DOM Helpers
 * Provides safe DOM operations with built-in null checks and error handling
 */

const DOMHelpers = (() => {
  /**
   * Safely query a single element
   * @param {string} selector - CSS selector
   * @param {Element} parent - Parent element to query within (default: document)
   * @returns {Element|null} Found element or null
   */
  function querySelector(selector, parent = document) {
    try {
      if (!parent) {
        console.warn('DOMHelpers: Parent element is null');
        return null;
      }
      return parent.querySelector(selector);
    } catch (error) {
      console.error('DOMHelpers: querySelector error:', error, { selector });
      return null;
    }
  }

  /**
   * Safely query multiple elements
   * @param {string} selector - CSS selector
   * @param {Element} parent - Parent element to query within (default: document)
   * @returns {Element[]} Array of found elements (empty array if none found)
   */
  function querySelectorAll(selector, parent = document) {
    try {
      if (!parent) {
        console.warn('DOMHelpers: Parent element is null');
        return [];
      }
      return Array.from(parent.querySelectorAll(selector));
    } catch (error) {
      console.error('DOMHelpers: querySelectorAll error:', error, { selector });
      return [];
    }
  }

  /**
   * Safely get element by ID
   * @param {string} id - Element ID
   * @returns {Element|null} Found element or null
   */
  function getElementById(id) {
    try {
      if (!id) {
        console.warn('DOMHelpers: No ID provided');
        return null;
      }
      return document.getElementById(id);
    } catch (error) {
      console.error('DOMHelpers: getElementById error:', error, { id });
      return null;
    }
  }

  /**
   * Safely create an element with attributes and children
   * @param {string} tag - HTML tag name
   * @param {Object} attributes - Attributes to set (e.g., {class: 'foo', id: 'bar'})
   * @param {Array<Element|string>} children - Child elements or text nodes
   * @returns {Element|null} Created element or null on error
   */
  function createElement(tag, attributes = {}, children = []) {
    try {
      const element = document.createElement(tag);

      // Set attributes
      Object.entries(attributes).forEach(([key, value]) => {
        if (key === 'class') {
          element.className = value;
        } else if (key === 'style' && typeof value === 'object') {
          Object.assign(element.style, value);
        } else if (key.startsWith('data-')) {
          element.setAttribute(key, value);
        } else {
          element[key] = value;
        }
      });

      // Append children
      children.forEach(child => {
        if (typeof child === 'string') {
          element.appendChild(document.createTextNode(child));
        } else if (child instanceof Element) {
          element.appendChild(child);
        }
      });

      return element;
    } catch (error) {
      console.error('DOMHelpers: createElement error:', error, { tag, attributes });
      return null;
    }
  }

  /**
   * Safely remove an element from the DOM
   * @param {Element|string} elementOrSelector - Element or selector string
   * @returns {boolean} True if element was removed
   */
  function removeElement(elementOrSelector) {
    try {
      const element = typeof elementOrSelector === 'string'
        ? querySelector(elementOrSelector)
        : elementOrSelector;

      if (element && element.parentNode) {
        element.parentNode.removeChild(element);
        return true;
      }
      return false;
    } catch (error) {
      console.error('DOMHelpers: removeElement error:', error);
      return false;
    }
  }

  /**
   * Safely add event listener with automatic cleanup tracking
   * @param {Element} element - Target element
   * @param {string} event - Event name
   * @param {Function} handler - Event handler
   * @param {Object} options - Event listener options
   * @returns {Function|null} Cleanup function to remove the listener, or null on error
   */
  function addEventListener(element, event, handler, options = {}) {
    try {
      if (!element || typeof element.addEventListener !== 'function') {
        console.warn('DOMHelpers: Invalid element for addEventListener');
        return null;
      }

      element.addEventListener(event, handler, options);

      // Return cleanup function
      return () => {
        try {
          element.removeEventListener(event, handler, options);
        } catch (error) {
          console.error('DOMHelpers: removeEventListener error:', error);
        }
      };
    } catch (error) {
      console.error('DOMHelpers: addEventListener error:', error, { event });
      return null;
    }
  }

  /**
   * Safely set text content (prevents XSS)
   * @param {Element} element - Target element
   * @param {string} text - Text to set
   * @returns {boolean} True if successful
   */
  function setTextContent(element, text) {
    try {
      if (!element) {
        console.warn('DOMHelpers: Element is null');
        return false;
      }
      element.textContent = text;
      return true;
    } catch (error) {
      console.error('DOMHelpers: setTextContent error:', error);
      return false;
    }
  }

  /**
   * Safely add CSS class(es) to an element
   * @param {Element} element - Target element
   * @param {string|string[]} classes - Class name(s) to add
   * @returns {boolean} True if successful
   */
  function addClass(element, classes) {
    try {
      if (!element || !element.classList) {
        console.warn('DOMHelpers: Invalid element for addClass');
        return false;
      }

      const classArray = Array.isArray(classes) ? classes : [classes];
      element.classList.add(...classArray);
      return true;
    } catch (error) {
      console.error('DOMHelpers: addClass error:', error, { classes });
      return false;
    }
  }

  /**
   * Safely remove CSS class(es) from an element
   * @param {Element} element - Target element
   * @param {string|string[]} classes - Class name(s) to remove
   * @returns {boolean} True if successful
   */
  function removeClass(element, classes) {
    try {
      if (!element || !element.classList) {
        console.warn('DOMHelpers: Invalid element for removeClass');
        return false;
      }

      const classArray = Array.isArray(classes) ? classes : [classes];
      element.classList.remove(...classArray);
      return true;
    } catch (error) {
      console.error('DOMHelpers: removeClass error:', error, { classes });
      return false;
    }
  }

  /**
   * Safely toggle CSS class on an element
   * @param {Element} element - Target element
   * @param {string} className - Class name to toggle
   * @param {boolean} force - Optional force add/remove
   * @returns {boolean} True if class is now present
   */
  function toggleClass(element, className, force = undefined) {
    try {
      if (!element || !element.classList) {
        console.warn('DOMHelpers: Invalid element for toggleClass');
        return false;
      }

      return element.classList.toggle(className, force);
    } catch (error) {
      console.error('DOMHelpers: toggleClass error:', error, { className });
      return false;
    }
  }

  /**
   * Wait for an element to appear in the DOM
   * @param {string} selector - CSS selector
   * @param {number} timeout - Timeout in milliseconds (default: 5000)
   * @param {Element} parent - Parent element to watch (default: document.body)
   * @returns {Promise<Element|null>} Found element or null on timeout
   */
  function waitForElement(selector, timeout = 5000, parent = document.body) {
    return new Promise((resolve) => {
      // Check if element already exists
      const existing = querySelector(selector, parent);
      if (existing) {
        resolve(existing);
        return;
      }

      let observer = null;
      let timeoutId = null;

      const cleanup = () => {
        if (observer) {
          observer.disconnect();
          observer = null;
        }
        if (timeoutId) {
          clearTimeout(timeoutId);
          timeoutId = null;
        }
      };

      try {
        observer = new MutationObserver(() => {
          const element = querySelector(selector, parent);
          if (element) {
            cleanup();
            resolve(element);
          }
        });

        if (parent) {
          observer.observe(parent, {
            childList: true,
            subtree: true
          });
        }

        timeoutId = setTimeout(() => {
          cleanup();
          console.warn('DOMHelpers: waitForElement timeout:', selector);
          resolve(null);
        }, timeout);

      } catch (error) {
        console.error('DOMHelpers: waitForElement error:', error, { selector });
        cleanup();
        resolve(null);
      }
    });
  }

  return {
    querySelector,
    querySelectorAll,
    getElementById,
    createElement,
    removeElement,
    addEventListener,
    setTextContent,
    addClass,
    removeClass,
    toggleClass,
    waitForElement
  };
})();

// Make available globally
if (typeof window !== 'undefined') {
  window.DOMHelpers = DOMHelpers;
}

// Export for use in service worker or Node.js
if (typeof module !== 'undefined' && module.exports) {
  module.exports = DOMHelpers;
}
