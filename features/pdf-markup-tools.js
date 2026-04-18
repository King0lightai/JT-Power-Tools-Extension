/**
 * JobTread PDF Markup Tools Enhancement
 * Integrates with JobTread's native PDF annotation system
 *
 * New Tools:
 * - Highlight tool (uses JobTread's rectangle + yellow color)
 * - Custom stamps library (uses JobTread's text tool)
 * - Line tool shortcut
 * - Enhanced eraser
 *
 * Integration Strategy:
 * - Programmatically triggers JobTread's native tool buttons
 * - Uses their annotation system for persistence and undo/redo
 * - Adds shortcuts and presets on top of their system
 *
 * @module PDFMarkupTools
 * @author JT Power Tools Team
 */

const PDFMarkupToolsFeature = (() => {
  // Local state
  let isActive = false;
  let observer = null;
  let styleElement = null;
  let injectedTools = [];

  // Store references to injected elements for cleanup
  const toolbarEnhancements = new WeakMap();

  // Cache for JobTread's native tool buttons
  let jtNativeButtons = null;

  // Track toolbars where we've attached native button listeners
  const toolbarsWithNativeListeners = new WeakSet();

  // Stamp library - using clear text abbreviations for markup/redlining
  // These are universally readable without special fonts
  const stampLibrary = {
    approval: [
      { name: 'APPROVED', icon: '✓', color: '#22c55e', textColor: '#fff' },
      { name: 'REVIEWED', icon: '👁', color: '#3b82f6', textColor: '#fff' },
      { name: 'REJECTED', icon: '✗', color: '#ef4444', textColor: '#fff' },
      { name: 'PENDING', icon: '⏱', color: '#f59e0b', textColor: '#fff' },
      { name: 'CONFIDENTIAL', icon: '🔒', color: '#dc2626', textColor: '#fff' }
    ],
    date: [
      { name: 'DATE_STAMP', icon: '📅', color: '#6366f1', textColor: '#fff', includeDate: true },
      { name: 'COMPLETED', icon: '✓', color: '#10b981', textColor: '#fff', includeDate: true },
      { name: 'RECEIVED', icon: '📥', color: '#0ea5e9', textColor: '#fff', includeDate: true }
    ],
    architecture: [
      // Doors & Windows - clear abbreviations
      { name: 'DOOR', icon: '🚪', color: '#374151', textColor: '#fff', copyText: 'DOOR' },
      { name: 'SLIDING_DOOR', icon: '⟺', color: '#374151', textColor: '#fff', copyText: 'SLIDER' },
      { name: 'BIFOLD_DOOR', icon: '⋈', color: '#374151', textColor: '#fff', copyText: 'BIFOLD' },
      { name: 'POCKET_DOOR', icon: '⊏', color: '#374151', textColor: '#fff', copyText: 'POCKET' },
      { name: 'WINDOW', icon: '⬜', color: '#374151', textColor: '#fff', copyText: 'WIN' },
      { name: 'FRENCH_DOOR', icon: '⧈', color: '#374151', textColor: '#fff', copyText: 'FRENCH DR' },
      // Electrical - industry standard abbreviations
      { name: 'OUTLET', icon: '⊙', color: '#f59e0b', textColor: '#fff', copyText: 'OUTLET' },
      { name: 'SWITCHED_OUTLET', icon: '⊛', color: '#f59e0b', textColor: '#fff', copyText: 'SW OUTLET' },
      { name: 'GFI_OUTLET', icon: '⊚', color: '#f59e0b', textColor: '#fff', copyText: 'GFI' },
      { name: '220V_OUTLET', icon: '⦿', color: '#f59e0b', textColor: '#fff', copyText: '220V' },
      { name: 'SWITCH', icon: 'S', color: '#f59e0b', textColor: '#fff', copyText: 'SW' },
      { name: '3_WAY_SWITCH', icon: 'S₃', color: '#f59e0b', textColor: '#fff', copyText: '3-WAY SW' },
      { name: 'DIMMER', icon: 'D', color: '#f59e0b', textColor: '#fff', copyText: 'DIMMER' },
      { name: 'LIGHT', icon: '💡', color: '#f59e0b', textColor: '#fff', copyText: 'LIGHT' },
      { name: 'CEILING_FAN', icon: '⌀', color: '#f59e0b', textColor: '#fff', copyText: 'FAN' },
      { name: 'RECESSED_LIGHT', icon: '◎', color: '#f59e0b', textColor: '#fff', copyText: 'RECESS' },
      { name: 'SMOKE_DETECTOR', icon: '◉', color: '#ef4444', textColor: '#fff', copyText: 'SMOKE DET' },
      { name: 'THERMOSTAT', icon: 'T', color: '#f59e0b', textColor: '#fff', copyText: 'TSTAT' },
      // Plumbing - clear abbreviations
      { name: 'TOILET', icon: '🚽', color: '#0ea5e9', textColor: '#fff', copyText: 'WC' },
      { name: 'BATHTUB', icon: '🛁', color: '#0ea5e9', textColor: '#fff', copyText: 'TUB' },
      { name: 'SHOWER', icon: '🚿', color: '#0ea5e9', textColor: '#fff', copyText: 'SHWR' },
      { name: 'SINK', icon: '○', color: '#0ea5e9', textColor: '#fff', copyText: 'SINK' },
      { name: 'DOUBLE_SINK', icon: '○○', color: '#0ea5e9', textColor: '#fff', copyText: 'DBL SINK' },
      { name: 'WATER_HEATER', icon: '⬡', color: '#0ea5e9', textColor: '#fff', copyText: 'WH' },
      { name: 'DISHWASHER', icon: '▣', color: '#0ea5e9', textColor: '#fff', copyText: 'DW' },
      { name: 'WASHER', icon: 'W', color: '#0ea5e9', textColor: '#fff', copyText: 'WASH' },
      { name: 'DRYER', icon: 'D', color: '#0ea5e9', textColor: '#fff', copyText: 'DRY' },
      // Appliances
      { name: 'RANGE', icon: '▦', color: '#6b7280', textColor: '#fff', copyText: 'RANGE' },
      { name: 'REFRIGERATOR', icon: '▯', color: '#6b7280', textColor: '#fff', copyText: 'REF' },
      { name: 'MICROWAVE', icon: '▢', color: '#6b7280', textColor: '#fff', copyText: 'MW' },
      // HVAC
      { name: 'SUPPLY_AIR', icon: '↑', color: '#10b981', textColor: '#fff', copyText: 'SUPPLY' },
      { name: 'RETURN_AIR', icon: '↓', color: '#10b981', textColor: '#fff', copyText: 'RETURN' },
      { name: 'HVAC_UNIT', icon: '⬢', color: '#10b981', textColor: '#fff', copyText: 'HVAC' },
      // Markup callouts
      { name: 'NOTE', icon: '📝', color: '#dc2626', textColor: '#fff', copyText: 'NOTE:' },
      { name: 'VERIFY', icon: '❓', color: '#dc2626', textColor: '#fff', copyText: 'VERIFY' },
      { name: 'REVISION', icon: '△', color: '#dc2626', textColor: '#fff', copyText: 'REV' },
      { name: 'ADD', icon: '+', color: '#22c55e', textColor: '#fff', copyText: 'ADD' },
      { name: 'REMOVE', icon: '−', color: '#ef4444', textColor: '#fff', copyText: 'REMOVE' },
      { name: 'RELOCATE', icon: '→', color: '#8b5cf6', textColor: '#fff', copyText: 'RELOCATE' }
    ],
    custom: [] // User-created stamps stored in Chrome storage
  };

  /**
   * Inject CSS styles for our new tools
   * Includes dark mode and RGB theme compatibility
   */
  function injectCSS() {
    if (styleElement) return;

    const css = `
      /* PDF Markup Tools Enhancement Styles */

      /* ========== BASE STYLES ========== */
      /* Vertical toolbar buttons - match JT's outlined button style */
      .jt-pdf-tool-btn {
        display: inline-block;
        vertical-align: bottom;
        position: relative;
        cursor: pointer;
        user-select: none;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
        padding: 0.25rem 0.5rem;
        box-shadow: 0 1px 2px 0 rgba(0, 0, 0, 0.05);
        text-align: center;
        flex-shrink: 0;
        /* Inactive state - white bg with gray text */
        background-color: #fff;
        color: #4b5563;
        border-left: 1px solid #e5e7eb;
        border-right: 1px solid #e5e7eb;
        border-top: 1px solid #e5e7eb;
        border-bottom: 1px solid #e5e7eb;
        border-radius: 0.125rem;
      }

      .jt-pdf-tool-btn:hover {
        background-color: #f9fafb;
      }

      .jt-pdf-tool-btn:active {
        box-shadow: inset 0 2px 4px 0 rgba(0, 0, 0, 0.05);
      }

      /* Active state - dark bg with white text */
      .jt-pdf-tool-btn.active {
        background-color: #374151;
        color: #fff;
        border-color: #374151;
      }

      .jt-pdf-tool-btn.active:hover {
        background-color: #1f2937;
      }

      /* Horizontal toolbar buttons (file viewer style) */
      .jt-pdf-tool-btn-horizontal.active {
        background-color: #4b5563 !important;
      }

      .jt-pdf-tool-btn svg {
        display: inline-block;
        overflow: visible;
        height: 1em;
        width: 1em;
        vertical-align: -0.125em;
      }

      /* Highlight tool indicator */
      .jt-highlight-icon {
        fill: #fbbf24;
        stroke: #f59e0b;
      }

      /* Separator line between tool groups - for dark toolbar */
      .jt-tool-separator {
        height: 1px;
        background: #4b5563;
        margin: 0.5rem 0;
      }

      /* Badge for new tools */
      .jt-new-badge {
        position: absolute;
        top: -4px;
        right: -4px;
        background: #ef4444;
        color: white;
        font-size: 0.625rem;
        padding: 0.125rem 0.25rem;
        border-radius: 0.25rem;
        font-weight: 600;
      }

      /* Toast notification animations */
      @keyframes slideIn {
        from {
          transform: translateX(400px);
          opacity: 0;
        }
        to {
          transform: translateX(0);
          opacity: 1;
        }
      }

      @keyframes slideOut {
        from {
          transform: translateX(0);
          opacity: 1;
        }
        to {
          transform: translateX(400px);
          opacity: 0;
        }
      }

      .jt-pdf-notification {
        transition: all 0.3s ease-out;
      }

      /* Stamp quick-select base styles - light mode (white background) */
      .jt-stamp-quick-select {
        background-color: #fff !important;
        border-color: #e5e7eb !important;
      }

      .jt-stamp-btn {
        background-color: #f9fafb !important;
        color: #374151 !important;
        border-color: #d1d5db !important;
      }

      .jt-stamp-btn:hover {
        background-color: #e5e7eb !important;
      }

      .jt-stamp-tab {
        background-color: #f9fafb !important;
        color: #374151 !important;
        border-color: #d1d5db !important;
      }

      .jt-stamp-tab.active {
        background-color: #3b82f6 !important;
        color: #fff !important;
        border-color: #3b82f6 !important;
      }

      /* ========== DARK MODE STYLES ========== */
      /* Vertical toolbar buttons need dark styling in dark mode */
      body.jt-dark-mode .jt-pdf-tool-btn {
        background-color: #2c2c2c;
        color: #d4d4d4;
        border-color: #404040;
      }

      body.jt-dark-mode .jt-pdf-tool-btn:hover {
        background-color: #3c3c3c;
      }

      body.jt-dark-mode .jt-pdf-tool-btn.active {
        background-color: #4a4a4a;
        color: #fff;
        border-color: #4a4a4a;
      }

      body.jt-dark-mode .jt-pdf-tool-btn.active:hover {
        background-color: #5a5a5a;
      }

      body.jt-dark-mode .jt-pdf-notification {
        background-color: #2c2c2c !important;
      }

      body.jt-dark-mode .jt-pdf-notification.error {
        background-color: #991b1b !important;
      }

      /* Dark mode stamp quick-select - dark gray backgrounds */
      body.jt-dark-mode .jt-stamp-quick-select {
        background-color: #2c2c2c !important;
        border-color: #404040 !important;
      }

      body.jt-dark-mode .jt-stamp-btn {
        background-color: #2c2c2c !important;
        color: #d4d4d4 !important;
        border-color: #404040 !important;
      }

      body.jt-dark-mode .jt-stamp-btn:hover {
        background-color: #3c3c3c !important;
      }

      body.jt-dark-mode .jt-stamp-tab {
        background-color: #2c2c2c !important;
        color: #d4d4d4 !important;
        border-color: #404040 !important;
      }

      body.jt-dark-mode .jt-stamp-tab.active {
        background-color: #4a4a4a !important;
        color: #fff !important;
        border-color: #4a4a4a !important;
      }

      /* ========== RGB/CUSTOM THEME STYLES ========== */
      body.jt-custom-theme .jt-pdf-tool-btn {
        background-color: var(--jt-theme-background, #fff);
        color: var(--jt-theme-text, #4b5563);
        border-color: var(--jt-theme-border, #e5e7eb);
      }

      body.jt-custom-theme .jt-pdf-tool-btn:hover {
        background-color: var(--jt-theme-background-subtle, #f9fafb);
      }

      body.jt-custom-theme .jt-pdf-tool-btn.active {
        background-color: var(--jt-theme-primary, #3b82f6);
        color: var(--jt-theme-primary-text, #fff);
        border-color: var(--jt-theme-primary, #3b82f6);
      }

      body.jt-custom-theme .jt-pdf-tool-btn.active:hover {
        background-color: var(--jt-theme-primary-hover, #2563eb);
      }

      body.jt-custom-theme .jt-tool-separator {
        background: var(--jt-theme-border, #e5e7eb);
      }

      body.jt-custom-theme .jt-pdf-notification {
        background-color: var(--jt-theme-primary, #3b82f6) !important;
        color: var(--jt-theme-primary-text, #fff) !important;
      }

      /* RGB/Custom theme stamp quick-select styles */
      body.jt-custom-theme .jt-stamp-quick-select {
        background-color: var(--jt-theme-background, #fff) !important;
        border-color: var(--jt-theme-border, #e5e7eb) !important;
      }

      body.jt-custom-theme .jt-stamp-btn {
        background-color: var(--jt-theme-background-subtle, #f9fafb) !important;
        color: var(--jt-theme-text, #374151) !important;
        border-color: var(--jt-theme-border, #d1d5db) !important;
      }

      body.jt-custom-theme .jt-stamp-btn:hover {
        background-color: var(--jt-theme-background-hover, #e5e7eb) !important;
      }

      body.jt-custom-theme .jt-stamp-tab {
        background-color: var(--jt-theme-background-subtle, #f9fafb) !important;
        color: var(--jt-theme-text, #374151) !important;
        border-color: var(--jt-theme-border, #d1d5db) !important;
      }

      body.jt-custom-theme .jt-stamp-tab.active {
        background-color: var(--jt-theme-primary, #3b82f6) !important;
        color: var(--jt-theme-primary-text, #fff) !important;
        border-color: var(--jt-theme-primary, #3b82f6) !important;
      }

      /* ========== TAKEOFF PRINT TOOL STYLES ========== */

      /* Injected Print button - matches JobTread's native button style */
      .jt-takeoff-injected-btn {
        transition: all 0.15s ease;
      }

      /* Dark mode styling for injected button */
      body.jt-dark-mode .jt-takeoff-injected-btn,
      .dark .jt-takeoff-injected-btn {
        background: #333333 !important;
        border-color: #505050 !important;
        color: #e0e0e0 !important;
      }

      body.jt-dark-mode .jt-takeoff-injected-btn:hover,
      .dark .jt-takeoff-injected-btn:hover {
        background: #3a3a3a !important;
      }

      /* Custom theme styling for injected button */
      body.jt-custom-theme .jt-takeoff-injected-btn {
        background: var(--jt-theme-background-subtle, #f3f4f6) !important;
        border-color: var(--jt-theme-border, #d1d5db) !important;
        color: var(--jt-theme-text, #374151) !important;
      }

      body.jt-custom-theme .jt-takeoff-injected-btn:hover {
        background: var(--jt-theme-background-hover, #e5e7eb) !important;
      }
    `;

    styleElement = document.createElement('style');
    styleElement.textContent = css;
    styleElement.id = 'jt-pdf-markup-tools-styles';
    document.head.appendChild(styleElement);
  }

  /**
   * Create SVG icon for highlight tool - simple filled rectangle
   */
  function createHighlightIcon() {
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('viewBox', '0 0 24 24');
    svg.setAttribute('fill', 'none');
    svg.setAttribute('stroke', 'currentColor');
    svg.setAttribute('stroke-width', '2');
    svg.setAttribute('stroke-linecap', 'round');
    svg.setAttribute('stroke-linejoin', 'round');
    svg.setAttribute('class', 'inline-block overflow-visible h-[1em] w-[1em] align-[-0.125em]');

    // Simple rectangle with yellow fill to represent highlight
    const rect = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
    rect.setAttribute('x', '3');
    rect.setAttribute('y', '6');
    rect.setAttribute('width', '18');
    rect.setAttribute('height', '12');
    rect.setAttribute('rx', '2');
    rect.setAttribute('fill', '#fbbf24');
    rect.setAttribute('fill-opacity', '0.5');
    rect.setAttribute('stroke', '#f59e0b');
    svg.appendChild(rect);

    // Horizontal lines to suggest text being highlighted
    const line1 = document.createElementNS('http://www.w3.org/2000/svg', 'line');
    line1.setAttribute('x1', '6');
    line1.setAttribute('y1', '10');
    line1.setAttribute('x2', '18');
    line1.setAttribute('y2', '10');
    line1.setAttribute('stroke', '#92400e');
    line1.setAttribute('stroke-width', '1.5');
    svg.appendChild(line1);

    const line2 = document.createElementNS('http://www.w3.org/2000/svg', 'line');
    line2.setAttribute('x1', '6');
    line2.setAttribute('y1', '14');
    line2.setAttribute('x2', '14');
    line2.setAttribute('y2', '14');
    line2.setAttribute('stroke', '#92400e');
    line2.setAttribute('stroke-width', '1.5');
    svg.appendChild(line2);

    return svg;
  }

  /**
   * Create SVG icon for line tool
   */
  function createLineIcon() {
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('viewBox', '0 0 24 24');
    svg.setAttribute('fill', 'none');
    svg.setAttribute('stroke', 'currentColor');
    svg.setAttribute('stroke-width', '2');
    svg.setAttribute('stroke-linecap', 'round');
    svg.setAttribute('stroke-linejoin', 'round');
    svg.setAttribute('class', 'inline-block overflow-visible h-[1em] w-[1em] align-[-0.125em]');

    const line = document.createElementNS('http://www.w3.org/2000/svg', 'line');
    line.setAttribute('x1', '5');
    line.setAttribute('y1', '19');
    line.setAttribute('x2', '19');
    line.setAttribute('y2', '5');
    svg.appendChild(line);

    return svg;
  }

  /**
   * Create SVG icon for eraser tool
   */
  function createEraserIcon() {
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('viewBox', '0 0 24 24');
    svg.setAttribute('fill', 'none');
    svg.setAttribute('stroke', 'currentColor');
    svg.setAttribute('stroke-width', '2');
    svg.setAttribute('stroke-linecap', 'round');
    svg.setAttribute('stroke-linejoin', 'round');
    svg.setAttribute('class', 'inline-block overflow-visible h-[1em] w-[1em] align-[-0.125em]');

    const path1 = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    path1.setAttribute('d', 'm7 21-4.3-4.3c-1-1-1-2.5 0-3.4l9.6-9.6c1-1 2.5-1 3.4 0l5.6 5.6c1 1 1 2.5 0 3.4L13 21');
    svg.appendChild(path1);

    const path2 = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    path2.setAttribute('d', 'M22 21H7');
    svg.appendChild(path2);

    const path3 = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    path3.setAttribute('d', 'm5 11 9 9');
    svg.appendChild(path3);

    return svg;
  }

  /**
   * Create a tool button
   */
  function createToolButton(icon, tooltip, onClick) {
    const btn = document.createElement('div');
    btn.setAttribute('role', 'button');
    btn.setAttribute('tabindex', '0');
    btn.setAttribute('title', tooltip);
    btn.className = 'jt-pdf-tool-btn';

    btn.appendChild(icon);

    // Add click handler
    btn.addEventListener('click', onClick);

    // Add keyboard support
    btn.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        onClick(e);
      }
    });

    return btn;
  }

  /**
   * Get the active SVG plan element
   */
  function getActiveSVG() {
    return document.querySelector('svg[cursor="crosshair"]');
  }

  /**
   * Find JobTread's native tool buttons
   * Returns object with button references keyed by button index/type
   *
   * JobTread toolbar layout (as of Jan 2026):
   * - Top group: Move (0), Select (1), Zoom In (2), Zoom Out (3)
   * - Drawing group: Freedraw/Pencil (4), Text (5), Arrow/Line (6), Rectangle (7), Circle (8), Connector (9)
   * - More options (10)
   */
  function findJobTreadButtons() {
    // Always refresh button references since toolbar can re-render
    jtNativeButtons = null;

    // Find buttons within the PDF toolbar specifically - try multiple toolbar structures
    let toolbar = document.querySelector('.flex.relative.shadow-line-left.p-1');

    // Try file viewer toolbar if first not found
    if (!toolbar) {
      toolbar = document.querySelector('.bg-gray-800 .relative .absolute.inset-0.flex');
    }

    if (!toolbar) {
      return null;
    }

    // Get all native JT buttons (exclude our custom .jt-pdf-tool-btn buttons)
    const buttons = toolbar.querySelectorAll('[role="button"]:not(.jt-pdf-tool-btn)');

    if (buttons.length === 0) {
      return null;
    }

    // Map buttons by their function based on SVG content analysis
    // We identify buttons by their SVG path content for reliability
    jtNativeButtons = {
      all: Array.from(buttons),
      move: null,
      select: null,
      zoomIn: null,
      zoomOut: null,
      freedraw: null,
      text: null,
      line: null,      // Arrow/line tool
      rectangle: null, // Rectangle tool (for highlights)
      circle: null,
      connector: null,
      more: null
    };

    // Identify each button by its SVG content
    buttons.forEach((btn, index) => {
      const svg = btn.querySelector('svg');
      if (!svg) return;

      const svgContent = svg.innerHTML;

      // Move tool - has multiple arrow paths
      if (svgContent.includes('M12 2v20') && svgContent.includes('M2 12h20')) {
        jtNativeButtons.move = btn;
      }
      // Select/pointer tool - cursor shape
      else if (svgContent.includes('M4.037 4.688')) {
        jtNativeButtons.select = btn;
      }
      // Zoom in - circle with + inside
      else if (svgContent.includes('M11 8v6') && svgContent.includes('M8 11h6')) {
        jtNativeButtons.zoomIn = btn;
      }
      // Zoom out - circle with - inside
      else if (svgContent.includes('M8 11h6') && !svgContent.includes('M11 8v6')) {
        jtNativeButtons.zoomOut = btn;
      }
      // Freedraw/Pencil - pen path
      else if (svgContent.includes('M21.174 6.812') || svgContent.includes('M13 21h8')) {
        jtNativeButtons.freedraw = btn;
      }
      // Text tool - T shape
      else if (svgContent.includes('M12 4v16') && svgContent.includes('M4 7V5')) {
        jtNativeButtons.text = btn;
      }
      // Arrow/Line tool - diagonal arrow
      else if (svgContent.includes('M13 5h6v6') && svgContent.includes('M19 5 5 19')) {
        jtNativeButtons.line = btn;
      }
      // Rectangle tool
      else if (svgContent.includes('<rect') && svgContent.includes('width="18" height="18"')) {
        jtNativeButtons.rectangle = btn;
      }
      // Circle tool
      else if (svgContent.includes('<circle') && svgContent.includes('r="10"') && !svgContent.includes('path')) {
        jtNativeButtons.circle = btn;
      }
      // Connector tool - multiple circles connected
      else if (svgContent.includes('r="2.5"')) {
        jtNativeButtons.connector = btn;
      }
      // More options - three dots
      else if (svgContent.includes('r="1"') && svgContent.includes('cx="19"')) {
        jtNativeButtons.more = btn;
      }
    });

    return jtNativeButtons;
  }

  /**
   * Check if a JobTread button is active
   */
  function isJobTreadButtonActive(button) {
    if (!button) return false;
    // Check for active states in different toolbar variants
    // File viewer uses bg-gray-600, PDF annotation uses bg-gray-700
    return (button.classList.contains('bg-gray-700') || button.classList.contains('bg-gray-600')) &&
           button.classList.contains('text-white');
  }

  /**
   * Activate a JobTread native tool by clicking its button
   */
  function activateJobTreadTool(buttonKey) {
    const buttons = findJobTreadButtons();
    if (!buttons) {
      console.error('PDF Markup Tools: Cannot find JobTread buttons');
      return false;
    }

    const button = buttons[buttonKey];
    if (!button) {
      console.error(`PDF Markup Tools: Button "${buttonKey}" not found`);
      return false;
    }

    // Only click if not already active
    if (!isJobTreadButtonActive(button)) {
      button.click();
      return true;
    }

    return true;
  }

  // Note: Old setHighlightPresets() and setColorOnFirstSwatch() functions removed
  // Replaced by new configureHighlightSettings() workflow with proper line/fill/opacity control

  /**
   * Set the value of a color input and trigger React change events
   */
  function setColorInputValue(input, hexColor) {
    if (!input) return;

    // Set the value using native setter
    const nativeInputValueSetter = Object.getOwnPropertyDescriptor(
      window.HTMLInputElement.prototype,
      'value'
    ).set;

    nativeInputValueSetter.call(input, hexColor);

    // Dispatch events to trigger React's change detection
    const inputEvent = new Event('input', { bubbles: true });
    input.dispatchEvent(inputEvent);

    const changeEvent = new Event('change', { bubbles: true });
    input.dispatchEvent(changeEvent);
  }

  // Note: Old setOpacitySlider() and openMoreOptionsAndSetPresets() functions removed
  // Replaced by setSliderValue() and configureHighlightSettings()

  /**
   * Find and click JobTread's color picker to set a specific color
   * @deprecated Use setHighlightPresets() instead for highlight tool
   */
  function setJobTreadColor(hexColor) {
    // Convert hex to RGB
    const rgb = hexToRgb(hexColor);
    if (!rgb) {
      console.error('PDF Markup Tools: Invalid hex color');
      return;
    }

    // Look for the color picker button (appears when a drawing tool is active)
    // Structure: div.w-7.h-7.border with background-color style
    const colorPicker = document.querySelector('.w-7.h-7.border.flex.items-center.justify-center.rounded-sm.border-gray-300.shadow-xs.self-center.cursor-pointer');

    if (colorPicker) {
      colorPicker.click();

      // Wait for color picker modal to open and render RGB inputs
      setTimeout(() => {
        setRgbValues(rgb.r, rgb.g, rgb.b);
      }, 200);
    }
  }

  /**
   * Convert hex color to RGB
   */
  function hexToRgb(hex) {
    // Remove # if present
    hex = hex.replace('#', '');

    // Parse hex values
    const r = parseInt(hex.substring(0, 2), 16);
    const g = parseInt(hex.substring(2, 4), 16);
    const b = parseInt(hex.substring(4, 6), 16);

    if (isNaN(r) || isNaN(g) || isNaN(b)) {
      return null;
    }

    return { r, g, b };
  }

  /**
   * Set RGB values in JobTread's color picker
   */
  function setRgbValues(r, g, b) {
    // Find all number inputs in the color picker area
    const allInputs = Array.from(document.querySelectorAll('input[type="number"], input[type="text"]'));

    // Filter to likely RGB inputs (value should be 0-255)
    const rgbInputs = allInputs.filter(input => {
      const value = parseInt(input.value);
      return !isNaN(value) && value >= 0 && value <= 255 && input.parentElement;
    });

    if (rgbInputs.length >= 3) {
      // Assume first 3 inputs are R, G, B in order
      const [rInput, gInput, bInput] = rgbInputs.slice(0, 3);

      setInputValue(rInput, r);
      setInputValue(gInput, g);
      setInputValue(bInput, b);

      showNotification(`Color set to yellow (RGB: ${r}, ${g}, ${b})`);
    } else {
      showNotification('Please manually select yellow color', 'info');
    }
  }

  /**
   * Set input value and trigger React events
   */
  function setInputValue(input, value) {
    // Set the value using React's way
    const nativeInputValueSetter = Object.getOwnPropertyDescriptor(
      window.HTMLInputElement.prototype,
      'value'
    ).set;

    nativeInputValueSetter.call(input, value);

    // Dispatch events to trigger React's change detection
    const inputEvent = new Event('input', { bubbles: true });
    input.dispatchEvent(inputEvent);

    const changeEvent = new Event('change', { bubbles: true });
    input.dispatchEvent(changeEvent);

    // Also trigger blur to ensure value is committed
    const blurEvent = new Event('blur', { bubbles: true });
    input.dispatchEvent(blurEvent);
  }

  /**
   * Show a notification to the user
   * Theme-aware - respects dark mode and RGB theme settings
   */
  function showNotification(message, type = 'info') {

    // Detect current theme for fallback colors
    const isDarkMode = document.body.classList.contains('jt-dark-mode');
    const isCustomTheme = document.body.classList.contains('jt-custom-theme');

    // Get theme-appropriate colors
    let bgColor, textColor;
    if (type === 'error') {
      bgColor = isDarkMode ? '#991b1b' : '#ef4444';
      textColor = 'white';
    } else {
      // Info/default - use theme primary if available
      if (isCustomTheme) {
        // CSS will handle via .jt-pdf-notification class
        bgColor = ''; // Let CSS handle it
        textColor = '';
      } else if (isDarkMode) {
        bgColor = '#1e40af';
        textColor = 'white';
      } else {
        bgColor = '#3b82f6';
        textColor = 'white';
      }
    }

    // Create a simple toast notification
    const toast = document.createElement('div');
    toast.className = 'jt-pdf-notification' + (type === 'error' ? ' error' : '');
    toast.textContent = message;

    // Base styles - colors applied via CSS classes for theme support
    let styleString = `
      position: fixed;
      bottom: 20px;
      right: 20px;
      padding: 12px 20px;
      border-radius: 6px;
      box-shadow: 0 4px 6px rgba(0, 0, 0, 0.1);
      z-index: 10000;
      font-size: 14px;
      font-weight: 500;
      max-width: 300px;
      animation: slideIn 0.3s ease-out;
    `;

    // Apply inline colors only if not using custom theme (CSS handles it)
    if (!isCustomTheme && bgColor) {
      styleString += `background: ${bgColor}; color: ${textColor};`;
    } else if (!isCustomTheme) {
      // Fallback for non-custom theme
      styleString += `background: ${isDarkMode ? '#1e40af' : '#3b82f6'}; color: white;`;
    }

    toast.style.cssText = styleString;

    document.body.appendChild(toast);

    // Auto-remove after 3 seconds
    setTimeout(() => {
      toast.style.animation = 'slideOut 0.3s ease-out';
      setTimeout(() => toast.remove(), 300);
    }, 3000);
  }

  /**
   * Handle highlight tool click - activates JobTread's rectangle tool with yellow highlight presets
   * Workflow: Rectangle tool → Line/Fill swatches appear → Configure colors and opacity
   */
  function handleHighlightClick() {
    const highlightBtn = document.querySelector('[data-jt-tool="highlight"]');
    if (!highlightBtn) return;

    const wasActive = highlightBtn.classList.contains('active');

    if (!wasActive) {
      // Activate JobTread's rectangle tool
      const success = activateJobTreadTool('rectangle');

      if (success) {
        // Mark our button as active
        deactivateOtherTools('highlight');
        highlightBtn.classList.add('active');

        // After rectangle is activated, the line/fill swatches appear in the toolbar
        // Wait for them to render, then configure (need more time for DOM update)
        setTimeout(() => {
          configureHighlightSettings();
        }, 500);

        showNotification('Highlight tool activated');
      } else {
        showNotification('Could not activate highlight tool', 'error');
      }
    } else {
      // Deactivate - click select tool to exit drawing mode
      highlightBtn.classList.remove('active');
      const buttons = findJobTreadButtons();
      if (buttons && buttons.select) {
        buttons.select.click();
      }
      showNotification('Highlight tool deactivated');
    }
  }

  /**
   * Configure highlight settings in the toolbar
   * JobTread Workflow (after rectangle tool activated):
   * 1. Line swatch appears (w-7 h-7 border with background-color)
   * 2. Fill swatch appears below (w-7 h-7 with droplet SVG)
   * 3. Click LINE → color picker + thickness slider popover
   * 4. Click FILL → color picker popover, click again → opacity slider
   */
  function configureHighlightSettings() {
    // Find the line swatch - it's a div with w-7 h-7 border and has a background-color or diagonal line
    // The line swatch is in a flex-col container
    let lineSwatch = null;
    let fillSwatch = null;

    // Method 1: Look for the swatch container (flex flex-col space-y-1)
    const swatchContainers = document.querySelectorAll('div.flex.flex-col.space-y-1');

    for (const container of swatchContainers) {
      // Line swatch: div.w-7.h-7.border with style background-color or has diagonal SVG
      const possibleLine = container.querySelector('div.w-7.h-7.border');
      // Fill swatch: has the droplet SVG path
      const possibleFill = container.querySelector('svg path[d*="M12 22a7"]');

      if (possibleLine && possibleFill) {
        lineSwatch = possibleLine;
        // Fill swatch is the parent container of the SVG
        fillSwatch = possibleFill.closest('div.w-7.h-7');
        break;
      }
    }

    // Method 2: Search for swatches in toolbar area specifically
    if (!lineSwatch || !fillSwatch) {
      // Find the toolbar first
      const toolbar = document.querySelector('.flex.relative.shadow-line-left.p-1') ||
                     document.querySelector('.bg-gray-800 .relative');

      if (toolbar) {
        // Line swatch has border class
        lineSwatch = toolbar.querySelector('div.w-7.h-7.border');

        // Fill swatch has the droplet icon
        const dropletPath = toolbar.querySelector('svg path[d*="M12 22a7"]');
        if (dropletPath) {
          fillSwatch = dropletPath.closest('div.w-7.h-7');
        }
      }
    }

    // Method 3: Fallback - search entire document
    if (!lineSwatch || !fillSwatch) {
      // Line swatch has border-gray-300 class
      lineSwatch = document.querySelector('div.w-7.h-7.border.border-gray-300.cursor-pointer') ||
                   document.querySelector('div.w-7.h-7.border.cursor-pointer');

      // Fill swatch has the droplet icon
      const dropletPath = document.querySelector('svg path[d*="M12 22a7 7 0 0 0 7-7"]') ||
                         document.querySelector('svg path[d*="M12 22a7"]');
      if (dropletPath) {
        fillSwatch = dropletPath.closest('div.w-7.h-7');
      }
    }

    // Method 4: Final fallback - any w-7 h-7 elements that look like swatches
    if (!lineSwatch || !fillSwatch) {
      const allSwatches = document.querySelectorAll('div.w-7.h-7.cursor-pointer');

      if (allSwatches.length >= 2) {
        // Typically line is first, fill is second
        lineSwatch = lineSwatch || allSwatches[0];
        fillSwatch = fillSwatch || allSwatches[1];
      }
    }

    if (!lineSwatch || !fillSwatch) {
      showNotification('Set colors manually: yellow fill, 50% opacity', 'info');
      return;
    }

    configureWithSwatches(lineSwatch, fillSwatch);
  }

  /**
   * Configure highlight with found swatches
   * Workflow:
   * 1. Click line swatch → set yellow color + minimum thickness → click line swatch to close
   * 2. Set fill color directly via the hidden input inside fill swatch
   * 3. Click fill swatch to access opacity slider → set 50% opacity → close
   */
  function configureWithSwatches(lineSwatch, fillSwatch) {
    // Step 1: Click LINE swatch to set yellow color and minimum thickness
    lineSwatch.click();

    setTimeout(() => {
      // Set line color to yellow
      const lineColorInput = document.querySelector('div.z-50 input[type="color"]');
      if (lineColorInput) {
        setColorInputValue(lineColorInput, '#FFFF00');
        // Update the swatch background to show the selected color
        lineSwatch.style.backgroundColor = '#FFFF00';
      }

      // Set thickness to minimum
      const thicknessSlider = document.querySelector('div.z-50 input[type="range"]');
      if (thicknessSlider) {
        setSliderValue(thicknessSlider, 1); // Minimum thickness
      }

      // Step 2: Click line swatch AGAIN to close the popup (it covers fill swatch)
      setTimeout(() => {
        lineSwatch.click();

        // Step 3: Set fill color directly - the input is INSIDE the fill swatch (hidden)
        setTimeout(() => {
          // Find the hidden color input inside the fill swatch (may be nested in div.relative)
          let fillColorInput = fillSwatch.querySelector('input[type="color"]');

          // If not found directly, try finding it near the droplet SVG
          if (!fillColorInput) {
            const dropletSvg = fillSwatch.querySelector('svg path[d*="M12 22a7"]');
            if (dropletSvg) {
              const relativeContainer = dropletSvg.closest('div.relative');
              if (relativeContainer) {
                fillColorInput = relativeContainer.querySelector('input[type="color"]');
              }
            }
          }

          // Final fallback - search in parent container
          if (!fillColorInput && fillSwatch.parentElement) {
            fillColorInput = fillSwatch.parentElement.querySelector('input[type="color"]');
          }

          if (fillColorInput) {
            setColorInputValue(fillColorInput, '#FFFF00');
            // Update the fill swatch background to show the selected color
            fillSwatch.style.backgroundColor = '#FFFF00';
          }

          // Step 4: Click fill swatch to access opacity slider
          setTimeout(() => {
            fillSwatch.click();

            setTimeout(() => {
              // Find opacity slider in the popup
              const opacitySlider = document.querySelector('div.z-50 input[type="range"]');

              if (opacitySlider) {
                setSliderValue(opacitySlider, 5); // 50% opacity (5 out of 10)
              }

              // Step 5: Close the popover by clicking fill swatch again
              setTimeout(() => {
                fillSwatch.click();
                showNotification('Highlight ready! Draw rectangles to highlight.');
              }, 200);
            }, 300);
          }, 300);
        }, 300);
      }, 300);
    }, 350);
  }

  /**
   * Set a slider to a specific value
   */
  function setSliderValue(slider, value) {
    if (!slider) return;

    // Set the value using native setter
    const nativeInputValueSetter = Object.getOwnPropertyDescriptor(
      window.HTMLInputElement.prototype,
      'value'
    ).set;

    nativeInputValueSetter.call(slider, value);

    // Dispatch events to trigger React's change detection
    slider.dispatchEvent(new Event('input', { bubbles: true }));
    slider.dispatchEvent(new Event('change', { bubbles: true }));
  }

  /**
   * Deactivate all other JT tools (visual state only)
   * JobTread's buttons manage their own state
   * @param {string|null} exceptTool - Tool to keep active, or null to deactivate all
   */
  function deactivateOtherTools(exceptTool) {
    const tools = ['highlight', 'eraser', 'line'];

    tools.forEach(toolName => {
      if (toolName === exceptTool) return;

      const btn = document.querySelector(`[data-jt-tool="${toolName}"]`);
      if (btn && btn.classList.contains('active')) {
        btn.classList.remove('active');

        // If deactivating eraser, also disable delete-on-click mode
        if (toolName === 'eraser') {
          disableDeleteOnClick();
        }
      }
    });
  }

  /**
   * Attach click listeners to JobTread's native tool buttons
   * When any native button is clicked, deactivate all our custom tools
   * @param {HTMLElement} toolbar - The toolbar element containing native buttons
   */
  function attachNativeButtonListeners(toolbar) {
    if (!toolbar) return;
    if (toolbarsWithNativeListeners.has(toolbar)) return; // Already attached

    // Get all native JT buttons (exclude our custom .jt-pdf-tool-btn buttons)
    const nativeButtons = toolbar.querySelectorAll('[role="button"]:not(.jt-pdf-tool-btn):not(.jt-pdf-tool-btn-horizontal)');

    if (nativeButtons.length === 0) return;

    nativeButtons.forEach(btn => {
      btn.addEventListener('click', handleNativeButtonClick, true); // Use capture to fire before JT's handlers
      btn.setAttribute('data-jt-listener-attached', 'true'); // Mark as having listener
    });

    toolbarsWithNativeListeners.add(toolbar);
  }

  /**
   * Handle click on JobTread native button
   * Deactivates all our custom tools
   */
  function handleNativeButtonClick() {
    // Deactivate all our custom tools (pass null to deactivate all)
    deactivateOtherTools(null);
  }

  // Note: Old drawing mode functions removed - we now use JobTread's native tools
  // This eliminates event listener conflicts and ensures proper integration with
  // their save/undo system

  /**
   * Handle line tool click - activates JobTread's arrow/line tool for straight lines
   */
  function handleLineClick() {
    const lineBtn = document.querySelector('[data-jt-tool="line"]');
    if (!lineBtn) return;

    const wasActive = lineBtn.classList.contains('active');

    if (!wasActive) {
      // Activate JobTread's arrow/line tool (not freedraw)
      const success = activateJobTreadTool('line');

      if (success) {
        deactivateOtherTools('line');
        lineBtn.classList.add('active');
        showNotification('Line tool activated');
      } else {
        showNotification('Could not activate line tool', 'error');
      }
    } else {
      // Deactivate - click select tool to exit drawing mode
      lineBtn.classList.remove('active');
      const buttons = findJobTreadButtons();
      if (buttons && buttons.select) {
        buttons.select.click();
      }
      showNotification('Line tool deactivated');
    }
  }

  /**
   * Handle eraser tool click
   * Activates JobTread's select tool so user can click annotations to select them,
   * then press Delete key to remove them
   */
  function handleEraserClick() {
    const eraserBtn = document.querySelector('[data-jt-tool="eraser"]');
    if (!eraserBtn) return;

    const wasActive = eraserBtn.classList.contains('active');

    if (!wasActive) {
      // Activate JobTread's select tool for selecting annotations
      const success = activateJobTreadTool('select');

      if (success) {
        deactivateOtherTools('eraser');
        eraserBtn.classList.add('active');

        // Enable delete-on-click mode
        enableDeleteOnClick();

        showNotification('Eraser tool activated');
      } else {
        showNotification('Could not activate eraser tool', 'error');
      }
    } else {
      // Deactivate
      eraserBtn.classList.remove('active');
      disableDeleteOnClick();
      showNotification('Eraser tool deactivated');
    }
  }

  // Track delete-on-click state
  let deleteOnClickEnabled = false;
  let deleteClickHandler = null;

  /**
   * Enable delete-on-click mode - clicking an annotation will select it and then click the delete button
   * The workflow is: click selects -> wait for delete button to appear -> click delete button
   */
  function enableDeleteOnClick() {
    if (deleteOnClickEnabled) return;
    deleteOnClickEnabled = true;

    deleteClickHandler = (e) => {
      // Check if eraser is still active
      const eraserBtn = document.querySelector('[data-jt-tool="eraser"]');
      if (!eraserBtn || !eraserBtn.classList.contains('active')) {
        disableDeleteOnClick();
        return;
      }

      // Check if we clicked within the SVG drawing area
      const target = e.target;
      const svgParent = target.closest('svg.h-full.object-contain');
      if (!svgParent) return;

      // Don't try to detect specific annotations - just let the click
      // propagate to JT's select tool. After a delay for React to process
      // the selection, fire Backspace. If nothing was selected, Backspace
      // is harmless. If something was selected, it gets deleted.
      setTimeout(() => {
        document.dispatchEvent(new KeyboardEvent('keydown', {
          key: 'Backspace',
          code: 'Backspace',
          keyCode: 8,
          which: 8,
          bubbles: true,
          cancelable: true
        }));
      }, 300); // Give React time to process the selection state
    };

    // Use mouseup instead of click - fires after JT's mousedown/mouseup
    // selection logic has completed, before React re-renders
    document.addEventListener('mouseup', deleteClickHandler, false);
  }

  /**
   * Find and click the delete button that appears when an annotation is selected
   * The delete button has a trash icon with paths: M10 11v6, M14 11v6, M19 6v14...
   */
  function clickDeleteButton() {
    // Look for the delete button by its trash icon SVG paths
    // The trash icon has distinctive paths: "M10 11v6" and "M14 11v6"
    const allButtons = document.querySelectorAll('div[role="button"]');

    for (const btn of allButtons) {
      const svg = btn.querySelector('svg');
      if (!svg) continue;

      const paths = svg.querySelectorAll('path');
      let hasTrashIcon = false;

      for (const path of paths) {
        const d = path.getAttribute('d') || '';
        // Check for the distinctive trash can paths
        if (d.includes('M10 11v6') || d.includes('M14 11v6') || d.includes('M19 6v14')) {
          hasTrashIcon = true;
          break;
        }
      }

      if (hasTrashIcon) {
        btn.click();
        return true;
      }
    }

    // Fallback: Look for red delete button (old selector)
    const redDeleteButton = document.querySelector('div[role="button"].text-red-500');
    if (redDeleteButton) {
      redDeleteButton.click();
      return true;
    }

    return false;
  }

  /**
   * Disable delete-on-click mode
   */
  function disableDeleteOnClick() {
    if (!deleteOnClickEnabled) return;
    deleteOnClickEnabled = false;

    if (deleteClickHandler) {
      document.removeEventListener('mouseup', deleteClickHandler, false);
      deleteClickHandler = null;
    }
  }

  /**
   * Create a tool button for horizontal toolbar (file viewer style)
   */
  function createHorizontalToolButton(icon, tooltip, onClick, shortcutNum) {
    const btn = document.createElement('div');
    btn.setAttribute('role', 'button');
    btn.setAttribute('tabindex', '0');
    btn.setAttribute('title', tooltip);
    btn.className = 'jt-pdf-tool-btn-horizontal inline-block align-bottom relative cursor-pointer px-4 py-1 text-center text-lg w-full text-white hover:bg-gray-700';

    // Create inner container with relative positioning for shortcut number
    const inner = document.createElement('div');
    inner.className = 'relative';
    inner.appendChild(icon);

    // Add shortcut number if provided
    if (shortcutNum) {
      const shortcut = document.createElement('span');
      shortcut.className = 'absolute bottom-0 right-0 text-xs text-gray-500';
      shortcut.textContent = shortcutNum;
      inner.appendChild(shortcut);
    }

    btn.appendChild(inner);

    // Add click handler
    btn.addEventListener('click', onClick);

    // Add keyboard support
    btn.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        onClick(e);
      }
    });

    return btn;
  }

  /**
   * Inject tools into the vertical PDF toolbar (sidebar style)
   */
  function injectToolsVertical(toolbar) {
    if (!toolbar) return;
    if (toolbarEnhancements.has(toolbar)) return; // Already injected

    // Find the container where tools are added
    const toolContainer = toolbar.querySelector('.relative.grow > .absolute.inset-0 > .flex.flex-col');
    if (!toolContainer) {
      return;
    }

    // Create separator
    const separator = document.createElement('div');
    separator.className = 'jt-tool-separator';

    // Create our tools
    const highlightBtn = createToolButton(
      createHighlightIcon(),
      'Highlight Tool (JT Enhanced) - Yellow rectangle with 50% opacity',
      handleHighlightClick
    );
    highlightBtn.setAttribute('data-jt-tool', 'highlight');

    const eraserBtn = createToolButton(
      createEraserIcon(),
      'Eraser Tool (JT Enhanced)',
      handleEraserClick
    );
    eraserBtn.setAttribute('data-jt-tool', 'eraser');

    // Append tools to toolbar
    toolContainer.appendChild(separator);
    toolContainer.appendChild(highlightBtn);
    toolContainer.appendChild(eraserBtn);

    // Attach listeners to native buttons so our tools deactivate when JT tools are clicked
    attachNativeButtonListeners(toolbar);

    // Track injected elements
    toolbarEnhancements.set(toolbar, {
      separator,
      highlightBtn,
      eraserBtn
    });

    injectedTools.push({ toolbar, separator, highlightBtn, eraserBtn });
  }

  /**
   * Inject tools into the horizontal PDF toolbar (file viewer style)
   */
  function injectToolsHorizontal(toolbar) {
    if (!toolbar) return;
    if (toolbarEnhancements.has(toolbar)) return; // Already injected

    // The horizontal toolbar is the flex container with the tool buttons
    // We need to append our buttons to the end of this container

    // Create our tools with horizontal styling
    const highlightBtn = createHorizontalToolButton(
      createHighlightIcon(),
      'Highlight Tool (JT Enhanced) - Yellow rectangle with 50% opacity',
      handleHighlightClick,
      'H'
    );
    highlightBtn.setAttribute('data-jt-tool', 'highlight');

    const eraserBtn = createHorizontalToolButton(
      createEraserIcon(),
      'Eraser Tool (JT Enhanced)',
      handleEraserClick,
      'E'
    );
    eraserBtn.setAttribute('data-jt-tool', 'eraser');

    // Append tools to toolbar
    toolbar.appendChild(highlightBtn);
    toolbar.appendChild(eraserBtn);

    // Attach listeners to native buttons so our tools deactivate when JT tools are clicked
    attachNativeButtonListeners(toolbar);

    // Track injected elements
    toolbarEnhancements.set(toolbar, {
      highlightBtn,
      eraserBtn
    });

    injectedTools.push({ toolbar, highlightBtn, eraserBtn });
  }

  /**
   * Find and enhance PDF toolbars on the page
   */
  function findAndEnhanceToolbars() {
    // Structure 1: Vertical sidebar toolbar (PDF annotation mode)
    // <div class="flex relative shadow-line-left p-1">
    const verticalToolbars = document.querySelectorAll('.flex.relative.shadow-line-left.p-1');

    verticalToolbars.forEach(toolbar => {
      const hasTools = toolbar.querySelector('[role="button"] svg');
      if (hasTools) {
        injectToolsVertical(toolbar);
        // Also reattach listeners in case new buttons were added
        reattachNativeButtonListeners(toolbar);
      }
    });

    // Structure 2: Horizontal file viewer toolbar (desktop)
    // <div class="w-full bg-gray-800"> containing <div class="absolute inset-0 flex">
    const horizontalContainers = document.querySelectorAll('.w-full.bg-gray-800 .relative .absolute.inset-0.flex');

    horizontalContainers.forEach(toolbar => {
      // Verify it's a tool toolbar by checking for numbered shortcuts (1, 2, 3, etc.)
      const hasNumberedTools = toolbar.querySelector('.text-xs.text-gray-500');
      if (hasNumberedTools) {
        injectToolsHorizontal(toolbar);
        // Also reattach listeners in case new buttons were added
        reattachNativeButtonListeners(toolbar);
      }
    });
  }

  /**
   * Reattach listeners to any new native buttons that may have been added
   * This handles dynamically added buttons (e.g., "More" menu items)
   * @param {HTMLElement} toolbar - The toolbar element
   */
  function reattachNativeButtonListeners(toolbar) {
    if (!toolbar) return;

    // Get all native JT buttons that don't have our listener marker
    const nativeButtons = toolbar.querySelectorAll('[role="button"]:not(.jt-pdf-tool-btn):not(.jt-pdf-tool-btn-horizontal):not([data-jt-listener-attached])');

    nativeButtons.forEach(btn => {
      btn.addEventListener('click', handleNativeButtonClick, true);
      btn.setAttribute('data-jt-listener-attached', 'true');
    });
  }

  /**
   * Remove all injected tools
   */
  function removeInjectedTools() {
    injectedTools.forEach(({ separator, highlightBtn, eraserBtn }) => {
      separator?.remove();
      highlightBtn?.remove();
      eraserBtn?.remove();
    });

    injectedTools = [];
    // toolbarEnhancements is a const WeakMap — can't reassign.
    // WeakMap entries are garbage-collected automatically when toolbar nodes
    // are removed from the DOM, so no explicit clear is needed.
  }

  /**
   * Inject stamp quick-select buttons into JobTread's "Input Text" modal
   * This is called when the modal appears
   * Supports dark mode and RGB theme via CSS classes
   */
  function injectStampButtonsIntoModal(modal) {
    // Check if we already injected
    if (modal.querySelector('.jt-stamp-quick-select')) return;

    // Find the textarea
    const textarea = modal.querySelector('textarea');
    if (!textarea) return;

    // Create stamp quick-select container - uses .jt-stamp-quick-select for theme styling
    const container = document.createElement('div');
    container.className = 'jt-stamp-quick-select';
    container.style.cssText = `
      padding: 8px;
      border-bottom-width: 1px;
      border-bottom-style: solid;
      display: flex;
      flex-wrap: wrap;
      gap: 4px;
      max-height: 120px;
      overflow-y: auto;
    `;

    // Add category tabs
    const tabsContainer = document.createElement('div');
    tabsContainer.style.cssText = `
      display: flex;
      gap: 4px;
      margin-bottom: 8px;
      width: 100%;
    `;

    const categories = [
      { key: 'architecture', label: '🏗️ Arch' },
      { key: 'approval', label: '✓ Approval' },
      { key: 'date', label: '📅 Date' }
    ];

    let activeCategory = 'architecture';

    const stampsContainer = document.createElement('div');
    stampsContainer.style.cssText = `
      display: flex;
      flex-wrap: wrap;
      gap: 4px;
      width: 100%;
    `;

    function renderStamps(category) {
      stampsContainer.innerHTML = '';
      const stamps = stampLibrary[category] || [];

      stamps.forEach(stamp => {
        const btn = document.createElement('button');
        btn.type = 'button';
        // Use CSS class for theme-aware styling
        btn.className = 'jt-stamp-btn';
        btn.style.cssText = `
          padding: 4px 8px;
          font-size: 11px;
          border-width: 1px;
          border-style: solid;
          border-radius: 4px;
          cursor: pointer;
          display: flex;
          align-items: center;
          gap: 4px;
          white-space: nowrap;
          transition: background-color 0.15s ease;
        `;
        btn.innerHTML = `<span style="font-size: 14px;">${stamp.icon}</span> ${stamp.copyText || stamp.name.replace(/_/g, ' ')}`;

        // Hover is handled by CSS now via .jt-stamp-btn:hover

        btn.addEventListener('click', (e) => {
          e.preventDefault();
          e.stopPropagation();

          // Get fresh reference to textarea in case modal was recreated
          const currentTextarea = modal.querySelector('textarea');
          if (!currentTextarea) {
            console.error('PDF Markup Tools: Could not find textarea in modal');
            return;
          }

          // Get the text to insert
          // All stamps include icon for visual consistency
          let text;
          if (stamp.includeDate) {
            const date = new Date().toLocaleDateString();
            text = stamp.icon + ' ' + stamp.name.replace(/_/g, ' ') + ' - ' + date;
          } else if (stamp.copyText) {
            // Architecture stamps: icon + abbreviation
            text = stamp.icon + ' ' + stamp.copyText;
          } else {
            // Approval stamps: icon + name
            text = stamp.icon + ' ' + stamp.name.replace(/_/g, ' ');
          }

          // Get current value and cursor position
          const currentValue = currentTextarea.value || '';
          const start = currentTextarea.selectionStart || currentValue.length;
          const end = currentTextarea.selectionEnd || currentValue.length;
          const newValue = currentValue.substring(0, start) + text + currentValue.substring(end);

          // Set value using native setter for React compatibility
          const nativeInputValueSetter = Object.getOwnPropertyDescriptor(
            window.HTMLTextAreaElement.prototype,
            'value'
          ).set;
          nativeInputValueSetter.call(currentTextarea, newValue);

          // Dispatch events
          currentTextarea.dispatchEvent(new Event('input', { bubbles: true }));
          currentTextarea.dispatchEvent(new Event('change', { bubbles: true }));

          // Focus and set cursor position
          currentTextarea.focus();
          currentTextarea.selectionStart = currentTextarea.selectionEnd = start + text.length;

        });

        stampsContainer.appendChild(btn);
      });
    }

    categories.forEach((cat, index) => {
      const tab = document.createElement('button');
      tab.type = 'button';
      tab.textContent = cat.label;
      // Use CSS class for theme-aware styling
      tab.className = 'jt-stamp-tab' + (cat.key === activeCategory ? ' active' : '');
      tab.style.cssText = `
        padding: 4px 8px;
        font-size: 11px;
        border-width: 1px;
        border-style: solid;
        border-radius: 4px;
        cursor: pointer;
        transition: background-color 0.15s ease, color 0.15s ease;
      `;

      tab.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        activeCategory = cat.key;

        // Update tab classes for theme-aware styling
        tabsContainer.querySelectorAll('button').forEach((t, i) => {
          const isActive = categories[i].key === activeCategory;
          t.className = 'jt-stamp-tab' + (isActive ? ' active' : '');
        });

        renderStamps(activeCategory);
      });

      tabsContainer.appendChild(tab);
    });

    container.appendChild(tabsContainer);
    container.appendChild(stampsContainer);

    // Insert before the textarea's parent div
    const textareaParent = textarea.closest('.p-2');
    if (textareaParent) {
      textareaParent.parentNode.insertBefore(container, textareaParent);
    }

    // Render initial stamps
    renderStamps(activeCategory);
  }

  /**
   * Watch for the "Input Text" modal to appear
   */
  function checkForInputTextModal() {
    // Look for the modal with "Input Text" header
    const modals = document.querySelectorAll('.m-auto.shadow-lg.rounded-sm.bg-white.max-w-lg');

    modals.forEach(modal => {
      const header = modal.querySelector('.font-bold.text-cyan-500.uppercase');
      if (header && header.textContent.includes('Input Text')) {
        injectStampButtonsIntoModal(modal);
      }
    });
  }

  // ============================================================================
  // TAKEOFF PRINT TOOL
  // Print takeoff drawings cleanly to PDF (auto-sized to fit content)
  // ============================================================================

  // Takeoff toolkit state
  let takeoffToolbar = null;
  let takeoffToolbarObserver = null;

  /**
   * Detect the takeoff drawing container element
   */
  /**
   * Detect the takeoff drawing container.
   * Finds the SVG plan element in standard view, or the image container
   * in comparison view (with overlaid red/blue filtered images).
   * @returns {HTMLElement|null} The drawing element (SVG or comparison image container)
   */
  function detectTakeoffContainer() {
    const root = document;

    // Priority order: most specific to least specific
    const selectors = [
      'svg.h-full.object-contain',  // Standard SVG plan drawing
      '[data-takeoff-container]',
      '.takeoff-viewer',
      '.plan-viewer'
    ];

    for (const selector of selectors) {
      const element = root.querySelector(selector);
      if (element) {
        return element;
      }
    }

    // Comparison view: look for the image container with plan images
    // Structure: div.bg-gray-100.relative > div.absolute > div.overflow-auto > div (with <img> children)
    const comparisonImg = root.querySelector('img.object-contain.select-none.pointer-events-none');
    if (comparisonImg) {
      // Return the parent flex container that holds both overlaid images
      const imageContainer = comparisonImg.closest('div.flex.items-center.justify-center')
        || comparisonImg.parentElement;
      if (imageContainer) {
        return imageContainer;
      }
    }

    return null;
  }

  /**
   * Convert pixels to millimeters
   * @param {number} px - Pixel value
   * @param {number} dpi - Screen DPI (default 96)
   * @returns {number} Millimeter value
   */
  function pxToMm(px, dpi = 96) {
    return (px * 25.4) / dpi;
  }

  /**
   * Measure the drawing container and calculate optimal print page size.
   * Handles both SVG elements (via viewBox/getBBox) and regular HTML elements.
   * Auto-detects orientation based on content aspect ratio.
   * Based on FitToPage.js (MIT License, Suliman Benhalim).
   *
   * @param {HTMLElement} container - The drawing container element
   * @returns {{ widthMm: number, heightMm: number, orientation: string, aspectRatio: number }}
   */
  function measurePrintSize(container) {
    const MARGIN_MM = 6.35; // ~0.25in margin on each side

    let widthPx, heightPx;

    if (container.tagName === 'svg' || container instanceof SVGElement) {
      // For SVG elements, use viewBox or getBBox for accurate intrinsic dimensions
      const viewBox = container.getAttribute('viewBox');
      if (viewBox) {
        const parts = viewBox.split(/[\s,]+/).map(Number);
        widthPx = parts[2];  // viewBox width
        heightPx = parts[3]; // viewBox height
      } else {
        // Fallback to getBBox which gives the bounding box of SVG content
        try {
          const bbox = container.getBBox();
          widthPx = bbox.width;
          heightPx = bbox.height;
        } catch (e) {
          // getBBox can fail if SVG not rendered; use client dimensions
          widthPx = container.clientWidth;
          heightPx = container.clientHeight;
        }
      }
    } else {
      // For HTML containers (including comparison view image containers),
      // try to get dimensions from the first <img> element inside
      const img = container.tagName === 'IMG'
        ? container
        : container.querySelector('img');
      if (img && img.naturalWidth && img.naturalHeight) {
        widthPx = img.naturalWidth;
        heightPx = img.naturalHeight;
      } else {
        widthPx = container.scrollWidth;
        heightPx = container.scrollHeight;
      }
    }

    // Calculate aspect ratio for print sizing
    const aspectRatio = widthPx / heightPx;

    // Convert to millimeters and add margins
    const contentWidthMm = pxToMm(widthPx) + (MARGIN_MM * 2);
    const contentHeightMm = pxToMm(heightPx) + (MARGIN_MM * 2);

    // Auto-detect orientation based on content aspect ratio
    let pageWidth, pageHeight, orientation;
    if (aspectRatio > 1) {
      // Content is wider than tall - landscape
      pageWidth = Math.max(contentWidthMm, contentHeightMm);
      pageHeight = Math.min(contentWidthMm, contentHeightMm);
      orientation = 'landscape';
    } else {
      // Content is taller than wide - portrait
      pageWidth = Math.min(contentWidthMm, contentHeightMm);
      pageHeight = Math.max(contentWidthMm, contentHeightMm);
      orientation = 'portrait';
    }

    return { widthMm: pageWidth, heightMm: pageHeight, orientation, aspectRatio };
  }

  /**
   * Print only the takeoff drawing (hide all other UI).
   * Auto-detects landscape vs portrait orientation from the drawing's aspect ratio.
   * The drawing scales to fill whatever paper size the user selects in the print dialog.
   *
   * Approach: Clone the drawing element into a clean top-level print wrapper so it's
   * not trapped inside nested flex/absolute containers that distort layout.
   * In comparison mode, prints the full visible composite (both overlaid image layers).
   */
  function printDrawingOnly() {
    const container = detectTakeoffContainer();
    if (!container) {
      showNotification('Could not find takeoff drawing area', 'error');
      return;
    }

    // Measure drawing to determine orientation
    const { orientation } = measurePrintSize(container);

    // Remove any leftover print wrapper / style from a previous invocation —
    // otherwise rapid repeat clicks create duplicate #jt-print-wrapper nodes
    // (id collision silently works in practice but produces broken output).
    document.getElementById('jt-print-wrapper')?.remove();
    document.getElementById('jt-takeoff-print-styles')?.remove();

    // Create a top-level print wrapper
    const printWrapper = document.createElement('div');
    printWrapper.id = 'jt-print-wrapper';

    const isSVG = container.tagName === 'svg' || container instanceof SVGElement;
    const isImageContainer = !isSVG && container.querySelector('img');

    if (isSVG) {
      // Clone SVG and clean up for print
      const clone = container.cloneNode(true);
      clone.removeAttribute('cursor');
      clone.removeAttribute('class');
      clone.setAttribute('preserveAspectRatio', 'xMidYMid meet');
      printWrapper.appendChild(clone);
    } else if (isImageContainer) {
      // Comparison view: clone all images with their CSS filters intact
      const images = container.querySelectorAll('img');
      const imgWrapper = document.createElement('div');
      imgWrapper.style.cssText = 'position: relative; width: 100%; height: 100%; display: flex; align-items: center; justify-content: center;';

      images.forEach((img, index) => {
        const imgClone = img.cloneNode(true);
        // Preserve the filter styles (red/blue overlay)
        imgClone.style.maxWidth = '100%';
        imgClone.style.maxHeight = '100%';
        imgClone.style.objectFit = 'contain';
        imgClone.removeAttribute('class');

        if (index > 0) {
          // Overlay images: position absolute with blend mode
          const overlay = document.createElement('div');
          overlay.style.cssText = 'position: absolute; inset: 0; display: flex; align-items: center; justify-content: center; mix-blend-mode: multiply; pointer-events: none;';
          overlay.appendChild(imgClone);
          imgWrapper.appendChild(overlay);
        } else {
          imgWrapper.appendChild(imgClone);
        }
      });

      printWrapper.appendChild(imgWrapper);
    } else {
      // Generic fallback: clone the container
      const clone = container.cloneNode(true);
      clone.removeAttribute('class');
      printWrapper.appendChild(clone);
    }

    document.body.appendChild(printWrapper);

    // Inject print CSS - uses auto orientation, lets user pick paper size
    const printStyle = document.createElement('style');
    printStyle.id = 'jt-takeoff-print-styles';
    printStyle.textContent = `
      @page {
        size: ${orientation};
        margin: 0;
      }

      @media print {
        /* Hide everything except our print wrapper */
        body > *:not(#jt-print-wrapper) {
          display: none !important;
        }

        /* Reset body for clean print */
        body {
          margin: 0 !important;
          padding: 0 !important;
          background: white !important;
        }

        /* Print wrapper fills the entire page */
        #jt-print-wrapper {
          display: block !important;
          width: 100vw !important;
          height: 100vh !important;
          margin: 0 !important;
          padding: 0 !important;
          overflow: hidden !important;
          page-break-inside: avoid !important;
          break-inside: avoid !important;
        }

        /* SVG fills the full page, maintaining aspect ratio */
        #jt-print-wrapper > svg {
          display: block !important;
          width: 100vw !important;
          height: 100vh !important;
          object-fit: contain !important;
        }

        /* Image container fills the full page */
        #jt-print-wrapper > div {
          width: 100vw !important;
          height: 100vh !important;
        }

        #jt-print-wrapper img {
          max-width: 100vw !important;
          max-height: 100vh !important;
          object-fit: contain !important;
        }
      }

      /* Hide wrapper on screen - only visible in print */
      @media screen {
        #jt-print-wrapper {
          display: none !important;
        }
      }
    `;
    document.head.appendChild(printStyle);

    // Cleanup on afterprint — this fires when the dialog is dismissed
    // (either the job printed or the user cancelled). Previously cleanup ran
    // on a hardcoded 1s timer, which corrupted long-running dialogs (wrapper
    // removed mid-print) and left orphans if the dialog was left open.
    // Attach only once; afterprint fires exactly once per print invocation.
    const onAfterPrint = () => {
      window.removeEventListener('afterprint', onAfterPrint);
      printStyle.remove();
      printWrapper.remove();
    };
    window.addEventListener('afterprint', onAfterPrint);

    // Fallback: if afterprint never fires (very old browser / edge case),
    // GC these nodes after 60s so we never leak forever.
    setTimeout(() => {
      if (document.contains(printWrapper)) {
        window.removeEventListener('afterprint', onAfterPrint);
        printStyle.remove();
        printWrapper.remove();
      }
    }, 60000);

    // Trigger print dialog
    window.print();

    showNotification(`Print: ${orientation} - select your paper size in the dialog`);
  }

  /**
   * Find the JobTread takeoff toolbar
   * Supports two toolbar types:
   * 1. Standard takeoff toolbar (with Rotate, Scale Plan buttons)
   * 2. Plan comparison toolbar (with Exit, v1/v2 panels, zoom controls)
   */
  /**
   * Find all takeoff toolbars on the page.
   * Returns an array of toolbar results (can be multiple in comparison view).
   */
  function findAllTakeoffToolbars() {
    const results = [];

    // Standard toolbar - has Rotate or Scale Plan buttons
    const allButtons = document.querySelectorAll('[role="button"]');
    for (const btn of allButtons) {
      const text = btn.textContent?.trim() || '';
      if (text === 'Rotate' || text.includes('Scale Plan')) {
        const toolbar = btn.closest('div.border-t') || btn.parentElement;
        if (toolbar) {
          results.push({ toolbar, type: 'standard' });
          break; // Only one standard toolbar
        }
      }
    }

    // Comparison view: detect by v1/v2 panels, then use the parent
    // comparison toolbar container (which holds both panels + shared controls
    // like zoom, locked, magnify buttons).
    const comparisonPanels = document.querySelectorAll(
      'div.flex.self-stretch[class*="border-red-"], div.flex.self-stretch[class*="border-blue-"]'
    );
    if (comparisonPanels.length > 0) {
      const firstPanel = comparisonPanels[0];
      const label = firstPanel.firstElementChild?.textContent?.trim();
      if (label === 'v1' || label === 'v2') {
        // Use the parent container that holds v1, v2, and shared controls
        const comparisonBar = firstPanel.parentElement;
        if (comparisonBar) {
          results.push({ toolbar: comparisonBar, type: 'comparison' });
        }
      }
    }

    return results;
  }

  /**
   * Find the first available takeoff toolbar (for backward compat).
   */
  function findTakeoffToolbar() {
    const all = findAllTakeoffToolbars();
    return all.length > 0 ? all[0] : null;
  }

  /**
   * Create a print button element for the given toolbar type.
   * In comparison mode, prints the entire visible composite (both layers).
   */
  function createPrintButton(toolbarType, jtToolbar) {
    const printBtn = document.createElement('div');
    printBtn.setAttribute('role', 'button');
    printBtn.setAttribute('tabindex', '0');
    printBtn.title = 'Print Drawing Only (auto-fit page size)';
    printBtn.addEventListener('click', () => printDrawingOnly());
    printBtn.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        printDrawingOnly();
      }
    });

    const printerSvg = '<svg xmlns="http://www.w3.org/2000/svg" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2" class="inline-block overflow-visible h-[1em] w-[1em] align-[-0.125em]" viewBox="0 0 24 24"><polyline points="6 9 6 2 18 2 18 9"/><path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2"/><rect x="6" y="14" width="12" height="8"/></svg>';

    if (toolbarType === 'comparison') {
      // Shared comparison toolbar: neutral icon-only style matching zoom controls
      printBtn.className = 'inline-block align-bottom relative cursor-pointer px-2 content-center text-gray-400 min-w-10 hover:bg-gray-700 jt-takeoff-injected-btn';
      printBtn.innerHTML = printerSvg;
    } else {
      // Standard toolbar styling (icon + text)
      printBtn.id = 'jt-print-drawing';
      printBtn.className = 'inline-block align-bottom relative cursor-pointer select-none truncate py-2 px-4 shadow-xs active:shadow-inner text-gray-600 bg-white hover:bg-gray-50 rounded-sm border text-center shrink-0 jt-takeoff-injected-btn';
      printBtn.innerHTML = printerSvg + ' Print';
    }

    return printBtn;
  }

  /**
   * Inject Print button into all detected takeoff toolbars
   */
  function injectTakeoffButtons() {
    const toolbars = findAllTakeoffToolbars();
    if (toolbars.length === 0) return;

    for (const { toolbar: jtToolbar, type: toolbarType } of toolbars) {
      // Skip if this toolbar already has our button
      if (jtToolbar.querySelector('.jt-takeoff-injected-btn')) continue;

      const printBtn = createPrintButton(toolbarType, jtToolbar);

      if (toolbarType === 'standard') {
        // Standard toolbar: insert before Scale Plan button
        const scalePlanBtn = Array.from(jtToolbar.querySelectorAll('[role="button"]')).find(btn =>
          btn.textContent?.includes('Scale Plan')
        );

        if (scalePlanBtn) {
          jtToolbar.insertBefore(printBtn, scalePlanBtn);
        } else {
          jtToolbar.appendChild(printBtn);
        }

        // Store reference for cleanup (standard toolbar is the primary)
        takeoffToolbar = { printBtn, jtToolbar };
      } else if (toolbarType === 'comparison') {
        // Comparison toolbar structure:
        //   [Exit] [middle flex-wrap: v2 panel, v1 panel] [magnify group]
        // Insert print button right before the magnify group (last child of the bar).
        const magnifyGroup = jtToolbar.querySelector('div.flex.items-center.group');
        if (magnifyGroup) {
          jtToolbar.insertBefore(printBtn, magnifyGroup);
        } else {
          jtToolbar.appendChild(printBtn);
        }
      }

      console.log(`PDF Markup Tools: Print button injected into ${toolbarType} toolbar`);
    }
  }

  /**
   * Initialize takeoff toolkit
   * No longer gates on URL - the main MutationObserver handles dynamic injection,
   * and injectTakeoffButtons() safely no-ops when no toolbar is present.
   */
  function initTakeoffToolkit() {
    // Try to inject button into existing toolbar
    injectTakeoffButtons();

    console.log('PDF Markup Tools: Takeoff print tool initialized');
  }

  /**
   * Cleanup takeoff toolkit
   */
  function cleanupTakeoffToolkit() {
    // Disconnect toolbar observer
    if (takeoffToolbarObserver) {
      takeoffToolbarObserver.disconnect();
      takeoffToolbarObserver = null;
    }

    // Remove all injected print buttons (standard + comparison panels)
    if (takeoffToolbar) {
      if (takeoffToolbar.printBtn) takeoffToolbar.printBtn.remove();
      takeoffToolbar = null;
    }
    document.querySelectorAll('.jt-takeoff-injected-btn').forEach(btn => btn.remove());

    // Remove any leftover print styles and wrapper
    const printStyle = document.getElementById('jt-takeoff-print-styles');
    if (printStyle) printStyle.remove();

    const printWrapper = document.getElementById('jt-print-wrapper');
    if (printWrapper) printWrapper.remove();
  }

  /**
   * Handle Delete key press to remove selected annotations
   */
  function handleDeleteKey(e) {
    // Only handle Delete/Backspace keys
    if (e.key !== 'Delete' && e.key !== 'Backspace') return;

    // Don't interfere with input fields
    const target = e.target;
    if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable) {
      return;
    }

    const svg = getActiveSVG();
    if (!svg) return;

    // Find selected annotation (look for elements with certain attributes or classes that indicate selection)
    // JobTread might mark selected items differently - we'll try a few approaches
    const selectedAnnotation = svg.querySelector('[data-selected="true"]') ||
                               svg.querySelector('.selected') ||
                               svg.querySelector('[aria-selected="true"]');

    if (selectedAnnotation) {
      e.preventDefault();

      // Try to trigger JobTread's delete button
      const buttons = findJobTreadButtons();
      if (buttons && buttons.delete) {
        buttons.delete.click();
      } else {
        // Fallback: directly remove the element (may not persist)
        selectedAnnotation.remove();
        showNotification('Annotation deleted');
      }
    }
  }

  /**
   * Initialize the feature
   */
  function init() {
    if (isActive) {
      return;
    }

    isActive = true;

    try {
      // Inject CSS
      injectCSS();

      // Find and enhance existing toolbars
      findAndEnhanceToolbars();

      // Watch for new toolbars, Input Text modals, and takeoff toolbar (PDF pages loaded dynamically)
      observer = new MutationObserver(() => {
        findAndEnhanceToolbars();
        checkForInputTextModal();
        injectTakeoffButtons();
      });

      observer.observe(document.body, {
        childList: true,
        subtree: true
      });

      // Also check immediately for any existing modals
      checkForInputTextModal();

      // Handle Delete key for removing annotations
      document.addEventListener('keydown', handleDeleteKey);

      // Initialize takeoff toolkit if on takeoff page
      initTakeoffToolkit();

      console.log('PDF Markup Tools: Activated');
    } catch (error) {
      isActive = false;
      throw error;
    }
  }

  /**
   * Cleanup the feature
   */
  function cleanup() {
    if (!isActive) {
      return;
    }

    isActive = false;

    // Disable delete-on-click mode if active
    disableDeleteOnClick();

    // Deactivate all our tools
    deactivateOtherTools(null);

    // Remove injected tools
    removeInjectedTools();

    // Disconnect observer
    if (observer) {
      observer.disconnect();
      observer = null;
    }

    // Remove event listeners
    document.removeEventListener('keydown', handleDeleteKey);

    // Cleanup takeoff toolkit
    cleanupTakeoffToolkit();

    // Remove injected CSS
    if (styleElement) {
      styleElement.remove();
      styleElement = null;
    }

    // Clear button cache
    jtNativeButtons = null;

    console.log('PDF Markup Tools: Deactivated');
  }

  /**
   * Check if feature is active
   */
  function isFeatureActive() {
    return isActive;
  }

  // Public API
  return {
    init,
    cleanup,
    isActive: isFeatureActive
  };
})();

// Expose to window for content script orchestrator
window.PDFMarkupToolsFeature = PDFMarkupToolsFeature;
