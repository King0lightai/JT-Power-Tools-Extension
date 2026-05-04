// JobTread Custom Theme Feature Module
// Applies custom color theme to JobTread interface (PREMIUM FEATURE)
// Generates a complete color palette from three base colors using HSL manipulation
//
// Dependencies:
// - utils/color-utils.js (ColorUtils)
// - utils/debounce.js (TimingUtils)
// - rgb-theme-modules/palette.js (ThemePalette)

const CustomThemeFeature = (() => {
  let isActive = false;
  let styleElement = null;
  let observer = null;
  let debouncedContrastFix = null;
  let currentColors = {
    primary: '#3B82F6',
    background: '#F3E8FF',
    text: '#1F1B29'
  };

  // Generated palette (populated by ThemePalette.generatePalette)
  let palette = {};

  // Module references
  const Palette = () => window.ThemePalette || {};

  // Use shared ColorUtils module
  const {
    hexToRgb,
    rgbToHex,
    hexToHsl,
    hslToHex,
    hexToRgba,
    getLuminance,
    isDark,
    getContrastText,
    adjustLightness,
    adjustSaturation,
    setLightness,
    setSaturation,
    blendColors
  } = window.ColorUtils || {};

  // Initialize the feature
  function init(colors = null) {
    if (isActive) return;

    isActive = true;
    console.log('RGBTheme: Activated');

    // Add custom theme class to body for other features to detect
    document.body.classList.add('jt-custom-theme');

    // Update colors if provided (with validation)
    if (colors) {
      currentColors = {
        primary: window.Sanitizer ? window.Sanitizer.sanitizeHexColor(colors.primary, currentColors.primary) : (colors.primary || currentColors.primary),
        background: window.Sanitizer ? window.Sanitizer.sanitizeHexColor(colors.background, currentColors.background) : (colors.background || currentColors.background),
        text: window.Sanitizer ? window.Sanitizer.sanitizeHexColor(colors.text, currentColors.text) : (colors.text || currentColors.text)
      };
    }

    // Generate the full color palette from base colors (using Palette module)
    palette = Palette().generatePalette(currentColors);

    // Inject custom theme CSS
    injectThemeCSS();

    // Apply contrast fixes to existing elements
    applyContrastFixes();

    // Start observing for new elements
    startObserver();
  }

  // Cleanup the feature
  function cleanup() {
    if (!isActive) return;

    isActive = false;
    console.log('RGBTheme: Deactivated');

    // Remove custom theme class from body
    document.body.classList.remove('jt-custom-theme');

    // Disconnect observer
    if (observer) {
      observer.disconnect();
      observer = null;
    }

    // Cancel debounced function
    if (debouncedContrastFix) {
      debouncedContrastFix.cancel();
      debouncedContrastFix = null;
    }

    // Remove injected CSS
    if (styleElement) {
      styleElement.remove();
      styleElement = null;
    }
  }

  // Update colors dynamically
  function updateColors(colors) {
    // Validate and sanitize colors before applying
    if (window.Sanitizer) {
      currentColors = {
        primary: colors.primary ? window.Sanitizer.sanitizeHexColor(colors.primary, currentColors.primary) : currentColors.primary,
        background: colors.background ? window.Sanitizer.sanitizeHexColor(colors.background, currentColors.background) : currentColors.background,
        text: colors.text ? window.Sanitizer.sanitizeHexColor(colors.text, currentColors.text) : currentColors.text
      };
    } else {
      // Fallback if Sanitizer not available
      currentColors = { ...currentColors, ...colors };
    }

    if (isActive) {
      // Regenerate the full palette with new colors (using Palette module)
      palette = Palette().generatePalette(currentColors);

      // v4.8 polish — injectThemeCSS now reuses the existing <style> element
      // and only swaps textContent. No teardown needed.
      injectThemeCSS();

      // Reapply contrast fixes with new colors
      applyContrastFixes();
    }
  }

  // Get current colors
  function getColors() {
    return { ...currentColors };
  }

  // Get the generated palette
  function getPalette() {
    return { ...palette };
  }

  // v4.8 polish — fixed-color contrast text values, computed once.
  // The 6 picker hexes (#10b981, #f59e0b, #3b82f6, #ef4444, #f97316, #a855f7)
  // never change, so memoizing avoids re-running luminance math on every
  // injectThemeCSS() call (was hot during color-picker drag).
  let _fixedContrastCache = null;
  function getFixedContrastText() {
    if (_fixedContrastCache) return _fixedContrastCache;
    _fixedContrastCache = {
      green:  getContrastText('#10b981'),
      yellow: getContrastText('#f59e0b'),
      blue:   getContrastText('#3b82f6'),
      red:    getContrastText('#ef4444'),
      orange: getContrastText('#f97316'),
      purple: getContrastText('#a855f7'),
    };
    return _fixedContrastCache;
  }

  // Inject theme CSS using the generated palette
  // v4.8 polish — reuse the same <style> element across updates instead of
  // tearing down and recreating, which forced a fresh stylesheet parse +
  // reflow on every color-picker tick.
  function injectThemeCSS() {
    // Use the pre-generated palette
    const p = palette;
    const { primary, background, text } = currentColors;

    // Get contrast text for primary color (changes per-theme so not cached)
    const primaryText = getContrastText(primary);

    // Fixed-color contrast (memoized — see getFixedContrastText)
    const fc = getFixedContrastText();
    const greenText = fc.green;
    const yellowText = fc.yellow;
    const blueText = fc.blue;
    const redText = fc.red;
    const orangeText = fc.orange;
    const purpleText = fc.purple;

    // Create CSS using the rich palette
    const css = `
      /* === JT Power Tools - Custom Color Theme === */
      /* Rich palette generated from Primary, Background, and Text colors */

      /* === CSS Custom Properties for other features === */
      :root {
        --jt-theme-primary: ${p.primary.base};
        --jt-theme-primary-hover: ${p.primary.hover};
        --jt-theme-primary-active: ${p.primary.active};
        --jt-theme-background: ${p.background.base};
        --jt-theme-background-subtle: ${p.background.subtle};
        --jt-theme-background-muted: ${p.background.muted};
        --jt-theme-background-emphasis: ${p.background.emphasis};
        --jt-theme-background-elevated: ${p.background.elevated};
        --jt-theme-text: ${p.text.primary};
        --jt-theme-text-secondary: ${p.text.secondary};
        --jt-theme-text-muted: ${p.text.muted};
        --jt-theme-border: ${p.border.default};
        --jt-theme-border-subtle: ${p.border.subtle};
        --jt-theme-border-strong: ${p.border.strong};
      }

      /* === Z-Index Fixes for Sidebars === */
      /* Ensure sidebar panels appear above job tabs and content bars when scrolling */
      .jt-job-tabs-container {
        position: relative;
        z-index: 20 !important;
      }

      /* Sidebar panels (Daily Log, etc.) need higher z-index to stay above page content */
      /* Target the absolute positioned sidebars on the right side */
      .absolute.top-0.bottom-0.right-0[data-is-drag-scroll-boundary="true"],
      div.z-30.absolute.top-0.bottom-0.right-0 {
        z-index: 35 !important;
      }

      /* Ensure the inner content of sidebars also has proper stacking */
      .absolute.top-0.bottom-0.right-0[data-is-drag-scroll-boundary="true"] > .absolute.inset-0,
      div.z-30.absolute.top-0.bottom-0.right-0 > .absolute.inset-0 {
        z-index: inherit;
      }

      /* === Custom Scrollbar Styling === */
      /* Only style scrollbars on scrollable containers, not all elements */
      html::-webkit-scrollbar,
      body::-webkit-scrollbar,
      [class*="overflow-auto"]::-webkit-scrollbar,
      [class*="overflow-y-auto"]::-webkit-scrollbar,
      [class*="overflow-x-auto"]::-webkit-scrollbar,
      [class*="overflow-scroll"]::-webkit-scrollbar {
        width: 10px;
        height: 10px;
      }

      html::-webkit-scrollbar-track,
      body::-webkit-scrollbar-track,
      [class*="overflow-auto"]::-webkit-scrollbar-track,
      [class*="overflow-y-auto"]::-webkit-scrollbar-track,
      [class*="overflow-x-auto"]::-webkit-scrollbar-track,
      [class*="overflow-scroll"]::-webkit-scrollbar-track {
        background: ${p.scrollbar.track};
        border-radius: 5px;
      }

      html::-webkit-scrollbar-thumb,
      body::-webkit-scrollbar-thumb,
      [class*="overflow-auto"]::-webkit-scrollbar-thumb,
      [class*="overflow-y-auto"]::-webkit-scrollbar-thumb,
      [class*="overflow-x-auto"]::-webkit-scrollbar-thumb,
      [class*="overflow-scroll"]::-webkit-scrollbar-thumb {
        background: ${p.scrollbar.thumb};
        border-radius: 5px;
        border: 2px solid ${p.background.base};
      }

      html::-webkit-scrollbar-thumb:hover,
      body::-webkit-scrollbar-thumb:hover,
      [class*="overflow-auto"]::-webkit-scrollbar-thumb:hover,
      [class*="overflow-y-auto"]::-webkit-scrollbar-thumb:hover,
      [class*="overflow-x-auto"]::-webkit-scrollbar-thumb:hover,
      [class*="overflow-scroll"]::-webkit-scrollbar-thumb:hover {
        background: ${p.scrollbar.thumbHover};
      }

      html::-webkit-scrollbar-corner,
      body::-webkit-scrollbar-corner {
        background: ${p.background.base};
      }

      /* Firefox - only on html/body, not all elements */
      html, body {
        scrollbar-width: thin;
        scrollbar-color: ${p.scrollbar.thumb} ${p.scrollbar.track};
      }

      /* === Logo Colors === */
      .text-gray-800 {
        color: ${p.primary.base} !important;
      }

      /* === Task Cards === */
      /* Overlay on task cards to blend with theme while preserving selection state */
      /* Covers all schedule task cards: month, week/day, availability, and task type filter row */
      /* Exclude .rounded-full (assignee avatars) — they use background-image for photos */
      td div[style*="background-color"]:not(.rounded-full),
      div.select-none.break-inside-avoid div.cursor-pointer[style*="background-color"]:not(.rounded-full),
      div.cursor-pointer.break-inside-avoid.border-l-2[style*="background-color"]:not(.rounded-full),
      .jt-ttf-task-card[style*="background-color"] {
        position: relative !important;
      }

      td div[style*="background-color"]:not(.rounded-full)::before,
      div.select-none.break-inside-avoid div.cursor-pointer[style*="background-color"]:not(.rounded-full)::before,
      div.cursor-pointer.break-inside-avoid.border-l-2[style*="background-color"]:not(.rounded-full)::before,
      .jt-ttf-task-card[style*="background-color"]::before {
        content: '' !important;
        position: absolute !important;
        inset: 0 !important;
        background: ${p.background.emphasis} !important;
        opacity: 0.85 !important;
        pointer-events: none !important;
        z-index: 0 !important;
      }

      /* Ensure text and content stays above the overlay */
      td div[style*="background-color"]:not(.rounded-full) > *,
      div.select-none.break-inside-avoid div.cursor-pointer[style*="background-color"]:not(.rounded-full) > *,
      div.cursor-pointer.break-inside-avoid.border-l-2[style*="background-color"]:not(.rounded-full) > *,
      .jt-ttf-task-card[style*="background-color"] > * {
        position: relative !important;
        z-index: 1 !important;
      }

      /* Force readable text on task cards */
      td div[style*="background-color"]:not(.rounded-full),
      td div[style*="background-color"]:not(.rounded-full) *,
      div.select-none.break-inside-avoid div.cursor-pointer[style*="background-color"]:not(.rounded-full),
      div.select-none.break-inside-avoid div.cursor-pointer[style*="background-color"]:not(.rounded-full) *,
      div.cursor-pointer.break-inside-avoid.border-l-2[style*="background-color"]:not(.rounded-full),
      div.cursor-pointer.break-inside-avoid.border-l-2[style*="background-color"]:not(.rounded-full) *,
      .jt-ttf-task-card[style*="background-color"],
      .jt-ttf-task-card[style*="background-color"] * {
        color: ${p.text.primary} !important;
      }

      /* Keep the left border visible (task type indicator) */
      td div[style*="border-left"],
      div.select-none.break-inside-avoid div.cursor-pointer[style*="border-left"],
      div.cursor-pointer.break-inside-avoid.border-l-2[style*="border-color"] {
        border-left-width: 5px !important;
      }

      /* === General Border Colors === */
      *, ::backdrop, ::file-selector-button, :after, :before {
        border-color: ${p.border.default};
      }

      .border-transparent {
        border-color: transparent !important;
      }

      .border-white {
        border-color: ${p.border.subtle} !important;
      }

      input.border-transparent,
      textarea.border-transparent {
        border-color: transparent !important;
      }

      /* === Formatter Toolbar Theme === */
      .jt-formatter-toolbar {
        background: ${p.background.elevated} !important;
        border-color: ${p.border.default} !important;
        box-shadow: none !important;
      }

      .jt-formatter-toolbar button {
        background: transparent !important;
        border: none !important;
        color: ${p.text.primary} !important;
      }

      .jt-formatter-toolbar button:hover {
        background: ${p.states.hover} !important;
        border: none !important;
      }

      .jt-formatter-toolbar button:active {
        background: ${p.states.active} !important;
      }

      .jt-formatter-toolbar button.active {
        background: ${p.primary.base} !important;
        color: ${primaryText} !important;
        border-color: ${p.primary.base} !important;
      }

      .jt-formatter-toolbar button.active:hover {
        background: ${p.primary.hover} !important;
      }

      /* Color picker buttons */
      .jt-formatter-toolbar button.jt-color-green { color: #10b981 !important; }
      .jt-formatter-toolbar button.jt-color-yellow { color: #f59e0b !important; }
      .jt-formatter-toolbar button.jt-color-blue { color: #3b82f6 !important; }
      .jt-formatter-toolbar button.jt-color-red { color: #ef4444 !important; }
      .jt-formatter-toolbar button.jt-color-orange { color: #f97316 !important; }
      .jt-formatter-toolbar button.jt-color-purple { color: #a855f7 !important; }

      .jt-formatter-toolbar button.jt-color-green.active { background: #10b981 !important; color: ${greenText} !important; }
      .jt-formatter-toolbar button.jt-color-yellow.active { background: #f59e0b !important; color: ${yellowText} !important; }
      .jt-formatter-toolbar button.jt-color-blue.active { background: #3b82f6 !important; color: ${blueText} !important; }
      .jt-formatter-toolbar button.jt-color-red.active { background: #ef4444 !important; color: ${redText} !important; }
      .jt-formatter-toolbar button.jt-color-orange.active { background: #f97316 !important; color: ${orangeText} !important; }
      .jt-formatter-toolbar button.jt-color-purple.active { background: #a855f7 !important; color: ${purpleText} !important; }

      .jt-toolbar-divider {
        background: ${p.border.default} !important;
      }

      .jt-dropdown-menu {
        background: ${p.background.elevated} !important;
        border-color: ${p.border.default} !important;
        box-shadow: none !important;
      }

      .jt-dropdown-menu button {
        color: ${p.text.primary} !important;
      }

      .jt-dropdown-menu button:hover {
        background: ${p.states.hover} !important;
      }

      .jt-dropdown-menu button.active {
        background: ${p.primary.base} !important;
        color: ${primaryText} !important;
      }

      /* Overflow dropdown (compact toolbar "..." menu) */
      .jt-overflow-dropdown {
        background: ${p.background.elevated} !important;
        border-color: ${p.border.default} !important;
        box-shadow: none !important;
      }

      .jt-overflow-dropdown .jt-toolbar-item {
        background: ${p.background.elevated} !important;
        border-color: ${p.border.subtle} !important;
        color: ${p.text.primary} !important;
      }

      .jt-overflow-dropdown .jt-toolbar-item:hover {
        background: ${p.states.hover} !important;
        border-color: ${p.border.default} !important;
        color: ${p.text.primary} !important;
      }

      .jt-overflow-dropdown .jt-toolbar-item.active {
        background: ${p.primary.base} !important;
        border-color: ${p.primary.base} !important;
        color: ${primaryText} !important;
      }

      /* Color buttons in overflow dropdown */
      .jt-overflow-dropdown .jt-toolbar-item.jt-color-green { color: #10b981 !important; }
      .jt-overflow-dropdown .jt-toolbar-item.jt-color-yellow { color: #f59e0b !important; }
      .jt-overflow-dropdown .jt-toolbar-item.jt-color-blue { color: #3b82f6 !important; }
      .jt-overflow-dropdown .jt-toolbar-item.jt-color-red { color: #ef4444 !important; }

      .jt-overflow-dropdown .jt-toolbar-item.jt-color-green.active { background: #10b981 !important; color: ${greenText} !important; }
      .jt-overflow-dropdown .jt-toolbar-item.jt-color-yellow.active { background: #f59e0b !important; color: ${yellowText} !important; }
      .jt-overflow-dropdown .jt-toolbar-item.jt-color-blue.active { background: #3b82f6 !important; color: ${blueText} !important; }
      .jt-overflow-dropdown .jt-toolbar-item.jt-color-red.active { background: #ef4444 !important; color: ${redText} !important; }

      /* === Background Color Hierarchy === */
      .bg-white,
      .bg-slate-50 {
        background-color: ${p.background.base};
      }

      .bg-gray-50 {
        background-color: ${p.background.subtle} !important;
      }

      .bg-gray-100 {
        background-color: ${p.background.muted} !important;
      }

      .bg-gray-200 {
        background-color: ${p.background.emphasis} !important;
      }

      /* v4.8.3 — secondary action buttons (Item / Group / chip-style buttons in JT).
         The :not([style*="background-image"]) exclusion guarantees profile-icon
         elements (which use inline background-image: url(...) but no .bg-gray-* class today)
         are never recolored, even if a future JT markup change adds .bg-gray-* to them. */
      .bg-gray-700:not([style*="background-image"]) {
        background-color: ${p.secondary.base} !important;
        color: white !important;
      }
      .bg-gray-800:not([style*="background-image"]) {
        background-color: ${p.secondary.hover} !important;
        color: white !important;
      }
      .hover\\:bg-gray-800:hover:not([style*="background-image"]) {
        background-color: ${p.secondary.hover} !important;
      }
      .active\\:bg-gray-900:active:not([style*="background-image"]) {
        background-color: ${p.secondary.active} !important;
      }

      /* === Selection Highlighting === */
      .bg-blue-50,
      .bg-blue-100 {
        background-color: ${p.primary.selection} !important;
      }

      /* SVG fill colors - checkbox/radio circle interiors */
      .fill-blue-50 {
        fill: ${p.background.base} !important;
      }

      /* Sticky columns - solid colors */
      .sticky[style*="left"].bg-blue-50,
      .sticky[style*="left"].bg-blue-100 {
        background-color: ${p.primary.selection} !important;
      }

      .group\\/row:has(.bg-blue-50) .sticky[style*="left"]:not(.bg-blue-50):not(.bg-blue-100),
      .group\\/row:has(.bg-blue-100) .sticky[style*="left"]:not(.bg-blue-50):not(.bg-blue-100) {
        background-color: ${p.primary.selection} !important;
      }

      .sticky[style*="top: 0px"].bg-blue-50,
      .sticky[style*="top: 0px"].bg-blue-100,
      .sticky[style*="top:0px"].bg-blue-50,
      .sticky[style*="top:0px"].bg-blue-100,
      .sticky[style*="top: 0"].bg-blue-50,
      .sticky[style*="top: 0"].bg-blue-100 {
        background-color: ${p.primary.selection} !important;
      }

      /* === Alert Colors (Theme-Harmonized) === */
      .bg-green-50 { background-color: ${p.alerts.green.bg} !important; }
      .bg-yellow-50 { background-color: ${p.alerts.yellow.bg} !important; }
      .bg-red-50 { background-color: ${p.alerts.red.bg} !important; }
      .bg-orange-50 { background-color: ${p.alerts.orange.bg} !important; }
      .bg-purple-50 { background-color: ${p.alerts.purple.bg} !important; }

      /* v4.8.3 — unscoped .text-{color}-500 / .border-{color}-500 rules removed.
         JT uses these classes for standalone status indicators (e.g. yellow "pending",
         green "submitted", red "rejected") that should keep their vivid defaults
         regardless of theme. The SCOPED rules at .bg-{color}-50 .text-{color}-500
         remain unchanged — alert text inside alert pills still harmonizes with the
         OKLCH theme. */

      /* Alert body text */
      .bg-green-50, .bg-yellow-50, .bg-red-50, .bg-orange-50, .bg-purple-50 {
        color: ${p.alerts.bodyText};
      }

      /* Keep header colored */
      .bg-green-50 .text-green-500 { color: ${p.alerts.green.text} !important; }
      .bg-yellow-50 .text-yellow-500 { color: ${p.alerts.yellow.text} !important; }
      .bg-red-50 .text-red-500 { color: ${p.alerts.red.text} !important; }
      .bg-orange-50 .text-orange-500 { color: ${p.alerts.orange.text} !important; }
      .bg-purple-50 .text-purple-500 { color: ${p.alerts.purple.text} !important; }

      /* === Focus States (Real Colors, Not Filters!) === */
      .focus\\:bg-white:focus,
      .focus\\:bg-gray-100:focus {
        background-color: ${p.states.focus} !important;
      }

      .focus-within\\:bg-white {
        background-color: ${p.background.base};
      }

      .focus-within\\:bg-blue-50:focus-within {
        background-color: ${p.primary.selectionStrong} !important;
      }

      /* === Hover States (Real Colors, Not Filters!) === */
      .hover\\:bg-gray-50:hover {
        background-color: ${p.states.hover} !important;
      }

      .hover\\:bg-gray-100:hover {
        background-color: ${p.states.hover} !important;
      }

      .hover\\:bg-gray-200:hover {
        background-color: ${p.states.active} !important;
      }

      .hover\\:bg-slate-50:hover {
        background-color: ${p.states.hover} !important;
      }

      .hover\\:bg-white:hover {
        background-color: ${p.states.hover} !important;
      }

      /* Note: hover:bg-gray-800 and hover:bg-gray-900 are NOT overridden */
      /* (v4.8.3 update: bg-gray-700 + bg-gray-800 + hover:bg-gray-800 NOW overridden via secondary token. bg-gray-900 + .bg-black still not overridden.) */
      /* They're used intentionally on dark toolbars/headers */

      /* Resize handles */
      .hover\\:bg-gray-300:hover {
        background-color: ${p.border.default} !important;
      }

      .hover\\:bg-blue-50:hover,
      .hover\\:bg-blue-100:hover {
        background-color: ${p.primary.selectionHover} !important;
      }

      /* === Active States === */
      .active\\:bg-gray-100:active,
      .active\\:bg-gray-200:active,
      .active\\:bg-gray-300:active {
        background-color: ${p.states.active} !important;
      }

      /* === Group Hover States === */
      .group-hover\\/row\\:bg-gray-50 {
        background-color: ${p.states.rowHover} !important;
      }

      .group-hover\\/row\\:bg-blue-100 {
        background-color: ${p.primary.selectionHover} !important;
      }

      .group:hover .group-hover\\:text-gray-800 {
        color: ${p.text.primary};
      }

      .group:hover .group-hover\\:bg-slate-50 {
        background-color: ${p.states.rowHover} !important;
      }

      /* === Popups, Tooltips, and Modals (Elevated Surfaces) === */
      /* Apply to dialogs, menus, and popper-positioned dropdowns */
      [role="dialog"],
      [role="menu"],
      [role="listbox"],
      div[data-popper-placement] {
        background-color: ${p.background.elevated} !important;
        color: ${p.text.primary} !important;
        box-shadow: 0 8px 24px ${p.shadows.colorStrong} !important;
      }

      /* Dropdown menu items - ensure proper text color (but preserve text-white) */
      div[data-popper-placement] div[role="button"]:not(.text-white),
      div[data-popper-placement] [tabindex]:not(.text-white) {
        color: ${p.text.primary} !important;
      }

      /* Dropdown dividers */
      div[data-popper-placement] .divide-y > * + * {
        border-color: ${p.border.subtle} !important;
      }

      /* Absolute/fixed positioned elements - theme colors but NO shadow */
      /* These are often content tiles, not popups */
      div[class*="absolute"][class*="bg-white"]:not(.inset-0):not([data-popper-placement]),
      div[class*="fixed"][class*="bg-white"]:not(.inset-0):not([data-popper-placement]) {
        background-color: ${p.background.base} !important;
        color: ${p.text.primary} !important;
      }

      /* Modal backdrop - darker overlay to make popups stand out */
      div.fixed.inset-0.bg-black,
      div.fixed.inset-0.bg-gray-800,
      div.fixed.inset-0.bg-gray-900,
      div.absolute.inset-0[class*="bg-gray-800\\/"],
      div.absolute.inset-0[class*="bg-gray-900\\/"],
      div.absolute.inset-0[class*="bg-black\\/"] {
        background-color: rgba(0, 0, 0, 0.7) !important;
      }

      /* Note: .bg-gray-800, .bg-gray-900, .bg-black are NOT overridden */
      /* (v4.8.3 update: bg-gray-700 + bg-gray-800 + hover:bg-gray-800 NOW overridden via secondary token. bg-gray-900 + .bg-black still not overridden.) */
      /* They're used intentionally for dark toolbars, file viewers, etc. */

      /* === Text Color Hierarchy === */
      /* Note: .text-white is NOT overridden - it's used intentionally on dark toolbars */
      .text-gray-900,
      .text-gray-800,
      .text-black {
        color: ${p.text.primary};
      }

      .text-gray-700,
      .text-gray-600 {
        color: ${p.text.secondary};
      }

      .text-gray-500 {
        color: ${p.text.muted};
      }

      .text-gray-400,
      .text-gray-300 {
        color: ${p.text.disabled};
      }

      /* Keep .text-white as white - used on intentionally dark UI elements */
      /* .text-white is NOT themed */

      /* v4.8.4 — bg-yellow-100 edit-highlight is now theme-aware.
         In LIGHT themes we let JT's default Tailwind pale yellow (#fef9c3)
         ride — themed primary text is dark, so contrast is fine.
         In DARK themes (Carbon, Charcoal) the pale yellow forces the themed
         light-grey text into near-invisibility, so we re-color the cell to
         a hue-harmonized dark olive (palette.alerts.yellow.bg, OKLCH
         L=0.30 / C=0.10 / h=85) that supports light text without shouting. */
      ${p.meta.bgIsDark ? `
      .bg-yellow-100 {
        background-color: ${p.alerts.yellow.bg} !important;
      }` : ''}

      .hover\\:text-gray-800:hover,
      .hover\\:text-gray-900:hover {
        color: ${p.text.primary};
      }

      .group-hover\\:text-gray-500,
      .group:hover .group-hover\\:text-gray-500 {
        color: ${p.text.secondary} !important;
      }

      .placeholder-gray-400::placeholder,
      .group-hover\\:placeholder-gray-500:hover::placeholder {
        color: ${p.text.muted} !important;
      }

      /* === Shadow Styles === */
      .shadow-line-right {
        box-shadow: 1px 0 0 ${p.border.subtle};
      }

      .shadow-line-left {
        box-shadow: -1px 0 0 ${p.border.subtle};
      }

      .shadow-line-bottom {
        box-shadow: 0 1px 0 ${p.border.subtle};
      }

      .shadow-sm {
        border: solid 1px ${p.border.subtle};
        box-shadow: none;
      }

      /* === Primary Buttons === */
      button.bg-blue-500,
      button.bg-blue-600,
      button[class*="bg-blue"] {
        background-color: ${p.primary.base} !important;
        color: ${primaryText} !important;
        box-shadow: 0 2px 4px ${p.shadows.color};
      }

      button.hover\\:bg-blue-600:hover,
      button.hover\\:bg-blue-700:hover,
      button.hover\\:bg-blue-500:hover {
        background-color: ${p.primary.hover} !important;
      }

      button.bg-purple-700,
      button.bg-purple-600,
      button[class*="bg-purple"] {
        background-color: ${p.primary.base} !important;
        border-color: ${p.primary.base} !important;
        color: ${primaryText} !important;
      }

      button.hover\\:bg-purple-800:hover,
      button.hover\\:bg-purple-700:hover {
        background-color: ${p.primary.hover} !important;
      }

      /* === Primary colors on non-button elements (menu items, etc.) === */
      /* Exclude elements with inline background-color (task type colors on schedule) */
      .bg-blue-500:not(button):not([style*="background-color"]),
      .bg-blue-600:not(button):not([style*="background-color"]) {
        background-color: ${p.primary.base} !important;
      }

      /* Preserve text-white on blue backgrounds */
      .bg-blue-500.text-white:not([style*="background-color"]),
      .bg-blue-600.text-white:not([style*="background-color"]) {
        color: ${primaryText} !important;
      }

      /* Hover states for non-button elements */
      .hover\\:bg-blue-500:hover:not(button):not([style*="background-color"]),
      .hover\\:bg-blue-600:hover:not(button):not([style*="background-color"]),
      .hover\\:bg-blue-700:hover:not(button):not([style*="background-color"]) {
        background-color: ${p.primary.base} !important;
      }

      .hover\\:text-white:hover {
        color: ${primaryText} !important;
      }

      /* v4.8.4 — Higher-specificity hover-text override for dropdown/menu items.
         The dropdown rule "div[data-popper-placement] [tabindex]:not(.text-white)"
         (specificity 0,3,0) was beating ".hover\\:text-white:hover" (0,2,0) and
         keeping text in p.text.primary on hover — producing "themed text on
         themed-primary background" (often invisible). These scoped rules
         (specificity 0,4,0+) restore readable contrast on hovered dropdown
         items across all 10 presets. */
      div[data-popper-placement] div[role="button"].hover\\:text-white:hover,
      div[data-popper-placement] [tabindex].hover\\:text-white:hover,
      [role="menu"] [role="menuitem"].hover\\:text-white:hover,
      [role="listbox"] [role="option"].hover\\:text-white:hover {
        color: ${primaryText} !important;
      }

      /* === Selected State === */
      .border-jtOrange {
        border-color: ${p.primary.base} !important;
      }

      .border-jtOrange.bg-gray-100 {
        background-color: ${p.primary.selectionStrong} !important;
      }

      /* === Search Bar === */
      /* Note: Search inputs with bg-transparent should stay transparent */
      /* The outer container gets themed via .bg-white rules */

      /* === Budget Group Level Rows === */
      /* Exclude resize handles (.cursor-col-resize) from inheriting background */
      [class*="jt-group-level"] > div:not([class*="bg-yellow"]):not([class*="bg-blue"]):not(.bg-gray-50):not(.bg-gray-100):not(.cursor-col-resize) {
        background-color: inherit !important;
      }

      [class*="jt-item-under-level"] > div:not([class*="bg-yellow"]):not([class*="bg-blue"]):not(.bg-gray-50):not(.bg-gray-100):not(.cursor-col-resize) {
        background-color: inherit !important;
      }

      /* === Column Resize Handles === */
      .absolute.z-10.cursor-col-resize {
        z-index: 1 !important;
      }

      .absolute.z-10.cursor-col-resize:hover {
        background-color: ${p.border.strong} !important;
      }

      /* === Quick Notes === */
      .jt-quick-notes-btn.jt-notes-button-active {
        background: ${p.primary.base} !important;
        color: ${primaryText} !important;
      }

      .jt-quick-notes-btn.jt-notes-button-active:hover {
        background: ${p.primary.hover} !important;
      }


      .jt-quick-notes-panel.custom-theme {
        --jt-notes-bg: ${p.background.elevated};
        --jt-notes-text: ${p.text.primary};
        --jt-notes-border: ${p.border.default};
        --jt-notes-primary: ${p.primary.base};
        --jt-notes-input-bg: ${p.background.muted};
      }

      /* === Preview Button === */
      .jt-preview-btn.active {
        background: ${p.primary.base} !important;
        color: ${primaryText} !important;
        border-color: ${p.primary.base} !important;
        box-shadow: none;
      }

      .jt-preview-btn {
        background: ${p.background.muted} !important;
        color: ${p.text.primary} !important;
        border-color: ${p.border.default} !important;
      }

      .jt-preview-btn:hover {
        background: ${p.states.hover} !important;
        border-color: ${p.border.strong} !important;
      }

      .jt-preview-panel.custom-theme {
        --jt-preview-bg: ${p.background.elevated};
        --jt-preview-text: ${p.text.primary};
        --jt-preview-border: ${p.border.default};
        --jt-preview-primary: ${p.primary.base};
        --jt-preview-btn-bg: ${p.background.muted};
        --jt-preview-btn-text: ${p.text.primary};
        --jt-preview-btn-border: ${p.border.default};
        --jt-preview-btn-hover-bg: ${p.states.hover};
        --jt-preview-btn-hover-text: ${p.text.primary};
        --jt-preview-btn-hover-border: ${p.border.strong};
        --jt-preview-text-muted: ${p.text.muted};
        --jt-preview-scrollbar-track: ${p.scrollbar.track};
        --jt-preview-scrollbar-thumb: ${p.scrollbar.thumb};
        --jt-preview-scrollbar-thumb-hover: ${p.scrollbar.thumbHover};
      }

      .jt-preview-panel.custom-theme .jt-preview-header {
        background: ${p.background.elevated} !important;
        border-bottom-color: ${p.border.default} !important;
        color: ${p.text.primary} !important;
      }

      .jt-preview-panel.custom-theme .jt-preview-content {
        background: ${p.background.base} !important;
        color: ${p.text.primary} !important;
      }

      /* === Alert Modal === */
      .jt-alert-modal {
        background: ${p.background.elevated} !important;
        box-shadow: 0 8px 32px ${p.shadows.colorStrong} !important;
      }

      .jt-alert-modal-header {
        background: ${p.background.elevated} !important;
        border-bottom-color: ${p.border.default} !important;
      }

      .jt-alert-modal-title {
        color: ${p.primary.base} !important;
      }

      .jt-alert-modal-close {
        background: ${p.background.muted} !important;
        color: ${p.text.primary} !important;
        border-color: ${p.border.default} !important;
      }

      .jt-alert-modal-close:hover {
        background: ${p.states.hover} !important;
      }

      .jt-alert-modal-body {
        background: ${p.background.elevated} !important;
      }

      .jt-alert-dropdown-button {
        background: ${p.background.muted} !important;
        border-color: ${p.border.default} !important;
        color: ${p.text.primary} !important;
      }

      .jt-alert-dropdown-button:hover {
        background: ${p.states.hover} !important;
      }

      .jt-alert-dropdown-menu {
        background: ${p.background.elevated} !important;
        border-color: ${p.border.default} !important;
        box-shadow: 0 4px 12px ${p.shadows.colorStrong} !important;
      }

      .jt-alert-dropdown-item {
        background: transparent !important;
        border-bottom-color: ${p.border.subtle} !important;
        color: ${p.text.primary} !important;
      }

      .jt-alert-dropdown-item:hover {
        background: ${p.states.hover} !important;
      }

      .jt-alert-dropdown-item.active {
        background: ${p.primary.selection} !important;
      }

      .jt-alert-subject {
        background: ${p.background.muted} !important;
        border-color: ${p.border.default} !important;
        color: ${p.text.primary} !important;
      }

      .jt-alert-subject:hover:not(:focus) {
        background: ${p.states.hover} !important;
        border-color: ${p.border.strong} !important;
      }

      .jt-alert-subject:focus {
        background: ${p.background.muted} !important;
        border-color: ${p.primary.base} !important;
        box-shadow: 0 0 0 2px ${p.primary.selection} !important;
      }

      .jt-alert-message-container {
        border-color: ${p.border.default} !important;
      }

      .jt-alert-message {
        background: ${p.background.muted} !important;
        color: ${p.text.primary} !important;
      }

      .jt-alert-message:hover:not(:focus) {
        background: ${p.states.hover} !important;
      }

      .jt-alert-message:focus {
        background: ${p.background.muted} !important;
        box-shadow: 0 0 0 2px ${p.primary.selection} !important;
      }

      .jt-alert-modal-footer {
        background: ${p.background.elevated} !important;
        border-top-color: ${p.border.default} !important;
      }

      .jt-alert-btn-cancel {
        background: ${p.background.muted} !important;
        color: ${p.text.primary} !important;
        border-color: ${p.border.default} !important;
      }

      .jt-alert-btn-cancel:hover {
        background: ${p.states.hover} !important;
        border-color: ${p.border.strong} !important;
      }

      /* === Ring/Focus Ring Colors === */
      .ring-gray-200 {
        --tw-ring-color: ${p.border.default};
      }

      .focus-within\\:border-cyan-500:focus-within {
        border-color: ${p.primary.base} !important;
      }

      /* === Caret Color === */
      .caret-black {
        caret-color: ${p.text.primary};
      }
    `;

    // v4.8 polish — only create the <style> element once. Subsequent calls
    // just swap textContent so JT's React reconciler doesn't see a node
    // disappear/reappear (which was triggering its observer + reflow).
    if (!styleElement) {
      styleElement = document.createElement('style');
      styleElement.id = 'jt-custom-theme-styles';
      document.head.appendChild(styleElement);
    }
    styleElement.textContent = css;
  }

  // Start observing DOM changes for contrast fixes
  function startObserver() {
    // Create debounced contrast fix function using TimingUtils
    debouncedContrastFix = window.TimingUtils.debounce(() => {
      // Temporarily disconnect observer to prevent infinite loop
      observer.disconnect();

      applyContrastFixes();

      // Reconnect observer after a short delay
      setTimeout(() => {
        if (isActive) {
          observer.observe(document.body, {
            childList: true,
            subtree: true
          });
        }
      }, 100);
    }, 250);

    observer = new MutationObserver((mutations) => {
      const shouldUpdate = mutations.some(mutation => mutation.addedNodes.length > 0);

      if (shouldUpdate) {
        debouncedContrastFix();
      }
    });

    // Start observing
    observer.observe(document.body, {
      childList: true,
      subtree: true
    });
  }

  // Apply custom text color and current date highlighting
  function applyContrastFixes() {
    // Apply custom text color to schedule items
    const scheduleItems = document.querySelectorAll('div[style*="background-color"][style*="color"]');

    scheduleItems.forEach(item => {
      // Target calendar/schedule items (they have cursor-pointer class)
      if (item.classList.contains('cursor-pointer')) {
        fixTextContrast(item);
      }
    });

    // Highlight current date with primary color
    highlightCurrentDate();
  }

  // Fix text contrast for a single element using palette text color
  function fixTextContrast(element) {
    const style = element.getAttribute('style');
    if (!style) return;

    // Skip tags - they should keep their original colors
    if (element.classList.contains('rounded-sm') &&
        (element.classList.contains('px-2') || element.classList.contains('py-1'))) {
      return;
    }

    // Check if element has both background-color and color in inline styles
    const bgColorMatch = style.match(/background-color:\s*rgb\([^)]+\)/);
    const textColorMatch = style.match(/color:\s*rgb\([^)]+\)/);

    if (bgColorMatch && textColorMatch) {
      // Get current computed color
      const currentColor = window.getComputedStyle(element).color;
      const textColor = hexToRgb(palette.text?.primary || currentColors.text);
      const targetColor = `rgb(${textColor.r}, ${textColor.g}, ${textColor.b})`;

      // Only update if different (prevents infinite loop)
      if (currentColor !== targetColor) {
        const newStyle = style.replace(/color:\s*rgb\([^)]+\)/, `color: ${targetColor}`);
        element.setAttribute('style', newStyle);
        element.style.color = targetColor;
      }
    }
  }

  // Highlight current date with primary color
  function highlightCurrentDate() {
    // Find all date cells with blue background (current date indicator)
    const currentDateDivs = document.querySelectorAll('div.bg-blue-500.text-white');

    currentDateDivs.forEach(dateDiv => {
      // Find the parent td cell
      let tdCell = dateDiv.closest('td');

      if (tdCell && !tdCell.classList.contains('jt-current-date-enhanced')) {
        // Add custom class to prevent re-processing
        tdCell.classList.add('jt-current-date-enhanced');

        // Fill entire cell background with primary color from palette
        const primaryColor = palette.primary?.base || currentColors.primary;
        const primaryRgb = hexToRgb(primaryColor);
        tdCell.style.backgroundColor = `rgb(${primaryRgb.r}, ${primaryRgb.g}, ${primaryRgb.b})`;
      }
    });
  }

  // Public API
  return {
    init,
    cleanup,
    updateColors,
    getColors,
    getPalette,
    isActive: () => isActive
  };
})();

// Export for use in main content script
if (typeof window !== 'undefined') {
  window.RGBThemeFeature = CustomThemeFeature;
  window.CustomThemeFeature = CustomThemeFeature;
}
