/**
 * JT Power Tools - Input Sanitizer
 * Provides input validation and sanitization to prevent XSS and injection attacks
 */

const Sanitizer = (() => {
  /**
   * Validate and sanitize a hex color value
   * @param {string} color - Color value to validate
   * @param {string} defaultColor - Default color if validation fails
   * @returns {string} Valid hex color
   */
  function sanitizeHexColor(color, defaultColor = '#000000') {
    try {
      if (!color || typeof color !== 'string') {
        return defaultColor;
      }

      // Remove any whitespace
      const trimmed = color.trim();

      // Check if it matches valid hex color format (#RRGGBB or #RGB)
      const hexPattern = /^#([0-9A-Fa-f]{6}|[0-9A-Fa-f]{3})$/;

      if (hexPattern.test(trimmed)) {
        // Convert 3-digit hex to 6-digit
        if (trimmed.length === 4) {
          return '#' + trimmed[1] + trimmed[1] + trimmed[2] + trimmed[2] + trimmed[3] + trimmed[3];
        }
        return trimmed.toUpperCase();
      }

      console.warn('Sanitizer: Invalid hex color:', color, '- using default:', defaultColor);
      return defaultColor;
    } catch (error) {
      console.error('Sanitizer: sanitizeHexColor error:', error);
      return defaultColor;
    }
  }

  /**
   * Sanitize CSS for safe injection
   * Only allows color values and basic CSS properties
   * @param {string} cssValue - CSS value to sanitize
   * @param {string} property - CSS property name
   * @returns {string|null} Sanitized CSS value or null if invalid
   */
  function sanitizeCSSValue(cssValue, property) {
    try {
      if (!cssValue || typeof cssValue !== 'string') {
        return null;
      }

      const trimmed = cssValue.trim();

      // For color properties, only allow hex colors and rgb/rgba
      const colorProps = ['color', 'background-color', 'border-color'];
      if (colorProps.includes(property)) {
        // Check for hex color
        if (/^#[0-9A-Fa-f]{6}$/.test(trimmed)) {
          return trimmed;
        }

        // Check for rgb/rgba
        if (/^rgba?\(\s*\d{1,3}\s*,\s*\d{1,3}\s*,\s*\d{1,3}\s*(,\s*[0-9.]+\s*)?\)$/.test(trimmed)) {
          return trimmed;
        }

        console.warn('Sanitizer: Invalid color value:', cssValue);
        return null;
      }

      // For other properties, be very restrictive
      // Only allow alphanumeric, spaces, hyphens, and basic CSS units
      if (!/^[a-zA-Z0-9\s\-%.]+$/.test(trimmed)) {
        console.warn('Sanitizer: Invalid CSS value:', cssValue);
        return null;
      }

      return trimmed;
    } catch (error) {
      console.error('Sanitizer: sanitizeCSSValue error:', error);
      return null;
    }
  }

  /**
   * Escape HTML to prevent XSS
   * @param {string} html - HTML string to escape
   * @returns {string} Escaped HTML
   */
  function escapeHTML(html) {
    try {
      if (!html || typeof html !== 'string') {
        return '';
      }

      const div = document.createElement('div');
      div.textContent = html;
      return div.innerHTML;
    } catch (error) {
      console.error('Sanitizer: escapeHTML error:', error);
      return '';
    }
  }

  /**
   * Sanitize a URL to prevent javascript: and data: URIs
   * @param {string} url - URL to sanitize
   * @param {string} defaultUrl - Default URL if validation fails
   * @returns {string} Safe URL
   */
  function sanitizeURL(url, defaultUrl = '#') {
    try {
      if (!url || typeof url !== 'string') {
        return defaultUrl;
      }

      const trimmed = url.trim().toLowerCase();

      // Reject dangerous protocols
      const dangerousProtocols = ['javascript:', 'data:', 'vbscript:', 'file:'];
      for (const protocol of dangerousProtocols) {
        if (trimmed.startsWith(protocol)) {
          console.warn('Sanitizer: Dangerous URL protocol detected:', url);
          return defaultUrl;
        }
      }

      // Only allow http, https, and relative URLs
      if (trimmed.startsWith('http://') ||
          trimmed.startsWith('https://') ||
          trimmed.startsWith('/') ||
          trimmed.startsWith('#')) {
        return url.trim();
      }

      console.warn('Sanitizer: Invalid URL format:', url);
      return defaultUrl;
    } catch (error) {
      console.error('Sanitizer: sanitizeURL error:', error);
      return defaultUrl;
    }
  }

  /**
   * Validate a license key format
   * @param {string} licenseKey - License key to validate
   * @returns {boolean} True if format is valid
   */
  function isValidLicenseKeyFormat(licenseKey) {
    try {
      if (!licenseKey || typeof licenseKey !== 'string') {
        return false;
      }

      const trimmed = licenseKey.trim();

      // License keys should be alphanumeric with hyphens
      // Typical format: XXXXXXXX-XXXX-XXXX-XXXX-XXXXXXXXXXXX
      const licensePattern = /^[A-Z0-9-]{20,}$/i;

      return licensePattern.test(trimmed);
    } catch (error) {
      console.error('Sanitizer: isValidLicenseKeyFormat error:', error);
      return false;
    }
  }

  /**
   * Sanitize storage key names
   * @param {string} key - Storage key to sanitize
   * @returns {string|null} Sanitized key or null if invalid
   */
  function sanitizeStorageKey(key) {
    try {
      if (!key || typeof key !== 'string') {
        return null;
      }

      const trimmed = key.trim();

      // Only allow alphanumeric and underscores
      if (!/^[a-zA-Z0-9_]+$/.test(trimmed)) {
        console.warn('Sanitizer: Invalid storage key:', key);
        return null;
      }

      return trimmed;
    } catch (error) {
      console.error('Sanitizer: sanitizeStorageKey error:', error);
      return null;
    }
  }

  /**
   * Validate numeric input with range
   * @param {*} value - Value to validate
   * @param {number} min - Minimum allowed value
   * @param {number} max - Maximum allowed value
   * @param {number} defaultValue - Default value if validation fails
   * @returns {number} Valid number within range
   */
  function sanitizeNumber(value, min, max, defaultValue = 0) {
    try {
      const num = Number(value);

      if (isNaN(num)) {
        console.warn('Sanitizer: Invalid number:', value);
        return defaultValue;
      }

      if (num < min) {
        console.warn('Sanitizer: Number below minimum:', num, '< ', min);
        return min;
      }

      if (num > max) {
        console.warn('Sanitizer: Number above maximum:', num, '>', max);
        return max;
      }

      return num;
    } catch (error) {
      console.error('Sanitizer: sanitizeNumber error:', error);
      return defaultValue;
    }
  }

  /**
   * Sanitize HTML by removing dangerous elements and attributes
   * Keeps only safe tags for display purposes
   * @param {string} html - HTML string to sanitize
   * @param {string[]} allowedTags - Array of allowed tag names (lowercase)
   * @returns {string} Sanitized HTML
   */
  function sanitizeHTML(html, allowedTags = ['b', 'strong', 'i', 'em', 'u', 's', 'del', 'br', 'p', 'span']) {
    try {
      if (!html || typeof html !== 'string') {
        return '';
      }

      // Use DOMParser to safely parse the HTML
      const parser = new DOMParser();
      const doc = parser.parseFromString(html, 'text/html');

      // Recursively clean nodes
      function cleanNode(node) {
        const children = Array.from(node.childNodes);

        for (const child of children) {
          if (child.nodeType === Node.ELEMENT_NODE) {
            const tagName = child.tagName.toLowerCase();

            // Remove disallowed tags but keep their text content
            if (!allowedTags.includes(tagName)) {
              const textContent = child.textContent;
              const textNode = document.createTextNode(textContent);
              node.replaceChild(textNode, child);
            } else {
              // Remove all attributes except safe ones
              const safeAttrs = ['class'];
              const attrs = Array.from(child.attributes);
              for (const attr of attrs) {
                if (!safeAttrs.includes(attr.name.toLowerCase())) {
                  child.removeAttribute(attr.name);
                }
              }
              // Recursively clean children
              cleanNode(child);
            }
          }
        }
      }

      cleanNode(doc.body);
      return doc.body.innerHTML;
    } catch (error) {
      console.error('Sanitizer: sanitizeHTML error:', error);
      // Fallback to escaping
      return escapeHTML(html);
    }
  }

  /**
   * Strip all HTML tags from a string safely
   * Uses DOMParser to avoid XSS vulnerabilities that can occur with innerHTML
   * @param {string} html - HTML string
   * @returns {string} Plain text
   */
  function stripHTML(html) {
    try {
      if (!html || typeof html !== 'string') {
        return '';
      }

      // Use DOMParser which is safer than innerHTML as it doesn't execute scripts
      // The 'text/html' MIME type creates an inert document
      const parser = new DOMParser();
      const doc = parser.parseFromString(html, 'text/html');
      return doc.body.textContent || '';
    } catch (error) {
      console.error('Sanitizer: stripHTML error:', error);
      return '';
    }
  }

  return {
    sanitizeHexColor,
    sanitizeCSSValue,
    escapeHTML,
    sanitizeHTML,
    sanitizeURL,
    isValidLicenseKeyFormat,
    sanitizeStorageKey,
    sanitizeNumber,
    stripHTML
  };
})();

// Make available globally
if (typeof window !== 'undefined') {
  window.Sanitizer = Sanitizer;
}

// Export for use in service worker or Node.js
if (typeof module !== 'undefined' && module.exports) {
  module.exports = Sanitizer;
}
