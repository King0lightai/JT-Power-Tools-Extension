/**
 * Color Utilities Module
 * Centralized color manipulation functions for JT Power Tools
 *
 * Provides HSL/RGB/Hex conversions, color adjustments, and contrast calculations.
 * Used by: budget-hierarchy.js, rgb-theme.js, help-sidebar-support.js
 */

const ColorUtils = (() => {
  // ============================================================
  // BASIC CONVERSIONS
  // ============================================================

  /**
   * Convert hex color to RGB object
   * @param {string} hex - Hex color string (e.g., "#FF5500" or "FF5500")
   * @returns {{r: number, g: number, b: number}|null} RGB object or null if invalid
   */
  function hexToRgb(hex) {
    if (!hex || typeof hex !== 'string') {
      return null;
    }
    const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
    return result ? {
      r: parseInt(result[1], 16),
      g: parseInt(result[2], 16),
      b: parseInt(result[3], 16)
    } : null;
  }

  /**
   * Convert RGB values to hex color string
   * @param {number} r - Red (0-255)
   * @param {number} g - Green (0-255)
   * @param {number} b - Blue (0-255)
   * @returns {string} Hex color string (e.g., "#FF5500")
   */
  function rgbToHex(r, g, b) {
    const toHex = (n) => {
      const clamped = Math.max(0, Math.min(255, Math.round(n)));
      return clamped.toString(16).padStart(2, '0');
    };
    return `#${toHex(r)}${toHex(g)}${toHex(b)}`;
  }

  /**
   * Convert hex color to HSL object
   * @param {string} hex - Hex color string
   * @returns {{h: number, s: number, l: number}} HSL object (h: 0-360, s: 0-100, l: 0-100)
   */
  function hexToHsl(hex) {
    const rgb = hexToRgb(hex);
    if (!rgb) return { h: 0, s: 0, l: 50 };

    const r = rgb.r / 255;
    const g = rgb.g / 255;
    const b = rgb.b / 255;

    const max = Math.max(r, g, b);
    const min = Math.min(r, g, b);
    const l = (max + min) / 2;
    let h = 0;
    let s = 0;

    if (max !== min) {
      const d = max - min;
      s = l > 0.5 ? d / (2 - max - min) : d / (max + min);

      switch (max) {
        case r: h = ((g - b) / d + (g < b ? 6 : 0)) / 6; break;
        case g: h = ((b - r) / d + 2) / 6; break;
        case b: h = ((r - g) / d + 4) / 6; break;
      }
    }

    return {
      h: Math.round(h * 360),
      s: Math.round(s * 100),
      l: Math.round(l * 100)
    };
  }

  /**
   * Convert HSL values to hex color string
   * @param {number} h - Hue (0-360)
   * @param {number} s - Saturation (0-100)
   * @param {number} l - Lightness (0-100)
   * @returns {string} Hex color string
   */
  function hslToHex(h, s, l) {
    h = ((h % 360) + 360) % 360; // Normalize hue to 0-360
    s = Math.max(0, Math.min(100, s)) / 100;
    l = Math.max(0, Math.min(100, l)) / 100;

    const c = (1 - Math.abs(2 * l - 1)) * s;
    const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
    const m = l - c / 2;

    let r = 0, g = 0, b = 0;

    if (h < 60) { r = c; g = x; b = 0; }
    else if (h < 120) { r = x; g = c; b = 0; }
    else if (h < 180) { r = 0; g = c; b = x; }
    else if (h < 240) { r = 0; g = x; b = c; }
    else if (h < 300) { r = x; g = 0; b = c; }
    else { r = c; g = 0; b = x; }

    return rgbToHex(
      Math.round((r + m) * 255),
      Math.round((g + m) * 255),
      Math.round((b + m) * 255)
    );
  }

  /**
   * Convert hex color to RGBA string
   * @param {string} hex - Hex color string
   * @param {number} alpha - Alpha value (0-1)
   * @returns {string} RGBA string (e.g., "rgba(255, 85, 0, 0.5)")
   */
  function hexToRgba(hex, alpha) {
    const rgb = hexToRgb(hex);
    if (!rgb) return hex;
    return `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, ${alpha})`;
  }

  // ============================================================
  // LUMINANCE AND CONTRAST
  // ============================================================

  /**
   * Calculate relative luminance (WCAG 2.0)
   * @param {string} hex - Hex color string
   * @returns {number} Luminance value (0-1)
   */
  function getLuminance(hex) {
    const rgb = hexToRgb(hex);
    if (!rgb) return 0;

    const toLinear = (c) => {
      const sRGB = c / 255;
      return sRGB <= 0.03928 ? sRGB / 12.92 : Math.pow((sRGB + 0.055) / 1.055, 2.4);
    };

    return 0.2126 * toLinear(rgb.r) + 0.7152 * toLinear(rgb.g) + 0.0722 * toLinear(rgb.b);
  }

  /**
   * Check if a color is dark (luminance < 0.4)
   * @param {string} hex - Hex color string
   * @returns {boolean} True if dark
   */
  function isDark(hex) {
    return getLuminance(hex) < 0.4;
  }

  /**
   * Get contrasting text color (white or black)
   * @param {string} backgroundColor - Hex color string
   * @returns {string} "#ffffff" or "#000000"
   */
  function getContrastText(backgroundColor) {
    return isDark(backgroundColor) ? '#ffffff' : '#000000';
  }

  // ============================================================
  // COLOR ADJUSTMENTS
  // ============================================================

  /**
   * Adjust lightness of a color in HSL space
   * @param {string} hex - Hex color string
   * @param {number} amount - Amount to adjust (-100 to +100)
   * @returns {string} Adjusted hex color
   */
  function adjustLightness(hex, amount) {
    const hsl = hexToHsl(hex);
    const newL = Math.max(0, Math.min(100, hsl.l + amount));
    return hslToHex(hsl.h, hsl.s, newL);
  }

  /**
   * Set specific lightness value
   * @param {string} hex - Hex color string
   * @param {number} lightness - Lightness value (0-100)
   * @returns {string} Adjusted hex color
   */
  function setLightness(hex, lightness) {
    const hsl = hexToHsl(hex);
    return hslToHex(hsl.h, hsl.s, lightness);
  }

  /**
   * Adjust saturation of a color in HSL space
   * @param {string} hex - Hex color string
   * @param {number} amount - Amount to adjust (-100 to +100)
   * @returns {string} Adjusted hex color
   */
  function adjustSaturation(hex, amount) {
    const hsl = hexToHsl(hex);
    const newS = Math.max(0, Math.min(100, hsl.s + amount));
    return hslToHex(hsl.h, newS, hsl.l);
  }

  /**
   * Set specific saturation value
   * @param {string} hex - Hex color string
   * @param {number} saturation - Saturation value (0-100)
   * @returns {string} Adjusted hex color
   */
  function setSaturation(hex, saturation) {
    const hsl = hexToHsl(hex);
    return hslToHex(hsl.h, saturation, hsl.l);
  }

  /**
   * Adjust brightness of a color in RGB space
   * @param {string} hex - Hex color string
   * @param {number} amount - Amount to adjust (-255 to +255)
   * @returns {string} Adjusted hex color
   */
  function adjustBrightness(hex, amount) {
    const rgb = hexToRgb(hex);
    if (!rgb) return hex;

    const adjust = (value) => Math.max(0, Math.min(255, value + amount));

    return rgbToHex(
      adjust(rgb.r),
      adjust(rgb.g),
      adjust(rgb.b)
    );
  }

  /**
   * Adjust brightness of a color by percentage in RGB space
   * Each channel is adjusted proportionally: channel + (channel * percent / 100)
   * @param {string} hex - Hex color string
   * @param {number} percent - Percentage to adjust (-100 to +100)
   * @returns {string} Adjusted hex color
   */
  function adjustBrightnessPercent(hex, percent) {
    const rgb = hexToRgb(hex);
    if (!rgb) return hex;

    const adjust = (value) => Math.min(255, Math.max(0, Math.round(value + (value * percent / 100))));

    return rgbToHex(adjust(rgb.r), adjust(rgb.g), adjust(rgb.b));
  }

  /**
   * Blend two colors together
   * @param {string} hex1 - First hex color
   * @param {string} hex2 - Second hex color
   * @param {number} ratio - Blend ratio (0 = hex1, 1 = hex2)
   * @returns {string} Blended hex color
   */
  function blendColors(hex1, hex2, ratio) {
    const rgb1 = hexToRgb(hex1);
    const rgb2 = hexToRgb(hex2);
    if (!rgb1 || !rgb2) return hex1;

    return rgbToHex(
      rgb1.r + (rgb2.r - rgb1.r) * ratio,
      rgb1.g + (rgb2.g - rgb1.g) * ratio,
      rgb1.b + (rgb2.b - rgb1.b) * ratio
    );
  }

  // ============================================================
  // SHADE GENERATION
  // ============================================================

  /**
   * Generate 5 shades from a base color (for budget hierarchy)
   * @param {string} baseColor - Base hex color
   * @param {boolean} isDarkMode - Whether dark mode is active
   * @returns {string[]} Array of 5 hex colors (level 1 = lightest, level 5 = darkest)
   */
  function generateShades(baseColor, isDarkMode = false) {
    const hsl = hexToHsl(baseColor);
    if (!hsl) return [baseColor, baseColor, baseColor, baseColor, baseColor];

    const isBaseDark = hsl.l < 50;
    const step = isDarkMode ? 2 : 3;

    if (isBaseDark) {
      // For dark backgrounds, progressively lighten from darker to lighter
      return [
        adjustLightness(baseColor, step * 4),   // Level 1 (lightest)
        adjustLightness(baseColor, step * 3),   // Level 2
        adjustLightness(baseColor, step * 2),   // Level 3
        adjustLightness(baseColor, step),       // Level 4
        baseColor                               // Level 5: Base (darkest)
      ];
    } else {
      // For light backgrounds, progressively darken from lighter to darker
      return [
        baseColor,                              // Level 1: Base (lightest)
        adjustLightness(baseColor, -step),      // Level 2
        adjustLightness(baseColor, -step * 2),  // Level 3
        adjustLightness(baseColor, -step * 3),  // Level 4
        adjustLightness(baseColor, -step * 4)   // Level 5 (darkest)
      ];
    }
  }

  // ============================================================
  // PUBLIC API
  // ============================================================

  return {
    // Basic conversions
    hexToRgb,
    rgbToHex,
    hexToHsl,
    hslToHex,
    hexToRgba,

    // Luminance and contrast
    getLuminance,
    isDark,
    getContrastText,

    // Color adjustments
    adjustLightness,
    setLightness,
    adjustSaturation,
    setSaturation,
    adjustBrightness,
    adjustBrightnessPercent,
    blendColors,

    // Shade generation
    generateShades
  };
})();

// Make available globally
if (typeof window !== 'undefined') {
  window.ColorUtils = ColorUtils;
}
