/**
 * RGB Theme Palette Module
 * Generates a complete color palette from three base colors using HSL manipulation
 *
 * Dependencies: utils/color-utils.js (ColorUtils)
 */

const ThemePalette = (() => {
  // Get ColorUtils functions
  const getColorUtils = () => window.ColorUtils || {};

  /**
   * Generate a complete color palette from base colors
   * @param {Object} colors - Base colors { primary, background, text }
   * @returns {Object} Complete palette with all derived colors
   */
  function generatePalette(colors) {
    const {
      hexToHsl,
      hslToHex,
      isDark,
      blendColors
    } = getColorUtils();

    const { primary, background, text } = colors;
    const bgHsl = hexToHsl(background);
    const primaryHsl = hexToHsl(primary);
    const darkMode = isDark(background);

    // Calculate contrast direction (positive = lighten, negative = darken for contrast)
    const contrastDir = darkMode ? 1 : -1;

    // ---- BACKGROUND SHADES ----
    // Create 5 distinct background levels for visual hierarchy
    const bgShades = {
      // Level 0: Base background (cards, main content)
      base: background,
      // Level 1: Subtle shade (slight contrast for sections)
      subtle: hslToHex(bgHsl.h, bgHsl.s, bgHsl.l + (contrastDir * 3)),
      // Level 2: Muted (input backgrounds, list items)
      muted: hslToHex(bgHsl.h, bgHsl.s, bgHsl.l + (contrastDir * 6)),
      // Level 3: Emphasis (active states, hover)
      emphasis: hslToHex(bgHsl.h, bgHsl.s, bgHsl.l + (contrastDir * 10)),
      // Level 4: Strong (tooltips, overlays)
      strong: hslToHex(bgHsl.h, bgHsl.s, bgHsl.l + (contrastDir * 15)),
      // Level 5: Elevated (modals, dropdowns - opposite direction for depth)
      elevated: hslToHex(bgHsl.h, bgHsl.s, bgHsl.l + (contrastDir * -2))
    };

    // ---- BORDER COLORS ----
    // Create distinct border shades for depth perception
    const borderShades = {
      // Subtle border for cards and sections
      subtle: hslToHex(bgHsl.h, Math.min(bgHsl.s + 5, 30), bgHsl.l + (contrastDir * 12)),
      // Default border for inputs and dividers
      default: hslToHex(bgHsl.h, Math.min(bgHsl.s + 8, 35), bgHsl.l + (contrastDir * 18)),
      // Strong border for focus states
      strong: hslToHex(bgHsl.h, Math.min(bgHsl.s + 10, 40), bgHsl.l + (contrastDir * 25))
    };

    // ---- TEXT COLORS ----
    // Create text hierarchy
    const textShades = {
      primary: text,
      secondary: blendColors(text, background, 0.25),
      muted: blendColors(text, background, 0.45),
      disabled: blendColors(text, background, 0.6)
    };

    // ---- PRIMARY COLOR VARIATIONS ----
    // Create primary color palette for interactive elements
    const primaryShades = {
      base: primary,
      hover: hslToHex(primaryHsl.h, primaryHsl.s, primaryHsl.l + (darkMode ? 8 : -8)),
      active: hslToHex(primaryHsl.h, primaryHsl.s, primaryHsl.l + (darkMode ? 12 : -12)),
      // Light versions for backgrounds
      light: hslToHex(primaryHsl.h, Math.max(primaryHsl.s - 20, 20), darkMode ? 25 : 92),
      lighter: hslToHex(primaryHsl.h, Math.max(primaryHsl.s - 30, 15), darkMode ? 20 : 95),
      // For selection highlighting - blend with background
      selection: blendColors(background, primary, 0.15),
      selectionHover: blendColors(background, primary, 0.25),
      selectionStrong: blendColors(background, primary, 0.35)
    };

    // ---- HOVER/FOCUS/ACTIVE STATES ----
    // Distinct colors for interactive states (not just brightness filters!)
    const states = {
      hover: hslToHex(bgHsl.h, bgHsl.s + 2, bgHsl.l + (contrastDir * 5)),
      focus: blendColors(background, primary, 0.1),
      active: hslToHex(bgHsl.h, bgHsl.s + 3, bgHsl.l + (contrastDir * 8)),
      // Row hover - subtle but noticeable
      rowHover: hslToHex(bgHsl.h, bgHsl.s + 1, bgHsl.l + (contrastDir * 3))
    };

    // ---- ALERT COLORS ----
    // Generate alert colors that harmonize with the theme
    const alerts = generateAlertColors(background, darkMode);

    // ---- SCROLLBAR COLORS ----
    const scrollbar = {
      track: bgShades.muted,
      thumb: borderShades.default,
      thumbHover: primary
    };

    // ---- SHADOW COLORS ----
    const shadows = {
      color: darkMode ? 'rgba(0, 0, 0, 0.4)' : 'rgba(0, 0, 0, 0.1)',
      colorStrong: darkMode ? 'rgba(0, 0, 0, 0.6)' : 'rgba(0, 0, 0, 0.2)'
    };

    return {
      isDark: darkMode,
      background: bgShades,
      border: borderShades,
      text: textShades,
      primary: primaryShades,
      states,
      alerts,
      scrollbar,
      shadows,
      // Keep raw colors for backward compatibility
      raw: { primary, background, text }
    };
  }

  /**
   * Generate alert colors that blend with the theme
   * @param {string} background - Background color hex
   * @param {boolean} darkMode - Whether dark mode is active
   * @returns {Object} Alert colors for each alert type
   */
  function generateAlertColors(background, darkMode) {
    const { hslToHex } = getColorUtils();

    // Base alert hues
    const alertHues = {
      green: 145,
      yellow: 45,
      red: 0,
      orange: 25,
      purple: 270,
      blue: 210
    };

    const result = {};

    Object.entries(alertHues).forEach(([name, hue]) => {
      if (darkMode) {
        // Dark mode: desaturated dark backgrounds, bright text
        result[name] = {
          bg: hslToHex(hue, 35, 18),
          text: hslToHex(hue, 75, 65),
          border: hslToHex(hue, 50, 35)
        };
      } else {
        // Light mode: tinted light backgrounds, dark vivid text
        result[name] = {
          bg: hslToHex(hue, 65, 95),
          text: hslToHex(hue, 70, 40),
          border: hslToHex(hue, 55, 75)
        };
      }
    });

    // Body text adapts to background
    result.bodyText = darkMode ? '#e0e0e0' : '#374151';

    return result;
  }

  // Public API
  return {
    generatePalette,
    generateAlertColors
  };
})();

// Export to window
if (typeof window !== 'undefined') {
  window.ThemePalette = ThemePalette;
}
