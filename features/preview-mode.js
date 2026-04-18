// JobTread Preview Mode (Premium Feature)
// Shows a live preview of formatted text with a floating preview panel

const PreviewModeFeature = (() => {
  let observer = null;
  let isActive = false;
  let styleElement = null;
  let activePreview = null;
  let activeButton = null;

  // Store button and preview references for each textarea
  const buttonMap = new WeakMap();
  const previewMap = new WeakMap();

  // Pinned mode state
  let isPinned = false;
  let pinnedTextarea = null;
  let focusinHandler = null;
  let pinnedInputHandler = null;
  let pinnedDragHandlers = null;
  let pinnedResizeHandlers = null;
  let dragState = null;
  let resizeState = null;
  let savePinnedTimeout = null;

  // Handle settings changes from other tabs
  function handleSettingsChange(message) {
    if (message.type === 'SETTINGS_CHANGED') {
      // Re-apply theme to all buttons
      const buttons = document.querySelectorAll('.jt-preview-btn');
      buttons.forEach(btn => detectAndApplyTheme(btn));

      // Re-apply theme to active preview if exists
      if (activePreview) {
        detectAndApplyTheme(activePreview);
      }
    }
  }

  // Initialize the feature
  function init() {
    if (isActive) {
      return;
    }

    isActive = true;
    console.log('PreviewMode: Activated');

    // Inject CSS
    injectCSS();

    // Initialize fields
    initializeFields();

    // Watch for new textareas
    observer = new MutationObserver(() => {
      initializeFields();
    });

    observer.observe(document.body, {
      childList: true,
      subtree: true
    });

    // Handle clicks outside preview to close it
    document.addEventListener('click', handleGlobalClick, true);

    // Listen for settings changes
    chrome.runtime.onMessage.addListener(handleSettingsChange);
  }

  // Cleanup the feature
  function cleanup() {
    if (!isActive) {
      return;
    }

    isActive = false;
    console.log('PreviewMode: Deactivated');

    // Tear down pinned mode if active
    if (isPinned && activePreview) {
      teardownDragBehavior(activePreview);
      removeResizeHandles(activePreview);

      if (focusinHandler) {
        document.removeEventListener('focusin', focusinHandler, true);
        focusinHandler = null;
      }

      if (pinnedInputHandler && pinnedTextarea) {
        pinnedTextarea.removeEventListener('input', pinnedInputHandler);
        pinnedInputHandler = null;
      }

      isPinned = false;
      pinnedTextarea = null;
    }

    if (savePinnedTimeout) {
      clearTimeout(savePinnedTimeout);
      savePinnedTimeout = null;
    }

    // Close any open preview
    closePreview();

    // Disconnect observer
    if (observer) {
      observer.disconnect();
      observer = null;
    }

    // Remove event listeners
    document.removeEventListener('click', handleGlobalClick, true);

    // Remove settings change listener
    chrome.runtime.onMessage.removeListener(handleSettingsChange);

    // Remove injected CSS
    if (styleElement) {
      styleElement.remove();
      styleElement = null;
    }

    // Remove all preview buttons
    const buttons = document.querySelectorAll('.jt-preview-btn');
    buttons.forEach(btn => btn.remove());

    // Remove all preview panels
    const previews = document.querySelectorAll('.jt-preview-panel');
    previews.forEach(panel => panel.remove());
  }

  // Inject CSS
  function injectCSS() {
    if (styleElement) return;

    const formatterCSS = document.createElement('link');
    formatterCSS.rel = 'stylesheet';
    formatterCSS.href = chrome.runtime.getURL('styles/formatter-toolbar.css');
    document.head.appendChild(formatterCSS);

    styleElement = document.createElement('link');
    styleElement.rel = 'stylesheet';
    styleElement.href = chrome.runtime.getURL('styles/preview-mode.css');
    document.head.appendChild(styleElement);
  }

  // Initialize fields
  function initializeFields() {
    if (!isActive) return;

    // Skip if on excluded paths
    const path = window.location.pathname;
    if (path.includes('/files') || path.includes('/vendors') || path.includes('/customers')) {
      return;
    }

    // Find all textareas that should have the formatter
    const fields = [];

    // 1. Budget Description fields
    const descriptionFields = document.querySelectorAll('textarea[placeholder="Description"]');
    fields.push(...descriptionFields);

    // 2. ALL Daily Log fields
    const labels = document.querySelectorAll('label');
    labels.forEach(label => {
      const heading = label.querySelector('div.font-bold');
      if (heading && heading.textContent.trim().length > 0) {
        const textareas = label.querySelectorAll('textarea');
        textareas.forEach(textarea => {
          if (textarea && !fields.includes(textarea)) {
            fields.push(textarea);
          }
        });
      }
    });

    // Filter out time entry notes fields and Time Clock notes fields
    const filteredFields = fields.filter(field => {
      const placeholder = field.getAttribute('placeholder');
      if (placeholder === 'Set notes') {
        return false; // Exclude time entry notes
      }

      // Exclude Notes field in Time Clock sidebar
      const label = field.closest('label');
      if (label) {
        const heading = label.querySelector('div.font-bold');
        if (heading && heading.textContent.trim() === 'Notes') {
          // Check if this is within a Time Clock sidebar
          const sidebar = field.closest('div.overflow-y-auto, form');
          if (sidebar) {
            const timeClockHeader = sidebar.querySelector('div.font-bold.text-jtOrange.uppercase');
            if (timeClockHeader && timeClockHeader.textContent.trim() === 'Time Clock') {
              return false; // Exclude Time Clock Notes field
            }
          }
        }
      }

      return true;
    });

    filteredFields.forEach((field) => {
      if (!field.dataset.previewModeReady && document.body.contains(field)) {
        field.dataset.previewModeReady = 'true';
        // Standalone preview button removed - preview is now only accessible via formatter toolbar
        // addPreviewButton(field);
      }
    });
  }

  // Add preview button next to textarea
  function addPreviewButton(textarea) {
    // Find the container that holds the textarea
    const container = textarea.closest('div');
    if (!container) return;

    // Create preview button
    const button = document.createElement('button');
    button.className = 'jt-preview-btn';
    button.innerHTML = `
      <svg width="16" height="16" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
        <path d="M8 3C4.5 3 1.73 5.61 1 9c.73 3.39 3.5 6 7 6s6.27-2.61 7-6c-.73-3.39-3.5-6-7-6zm0 10c-2.21 0-4-1.79-4-4s1.79-4 4-4 4 1.79 4 4-1.79 4-4 4zm0-6.5c-1.38 0-2.5 1.12-2.5 2.5s1.12 2.5 2.5 2.5 2.5-1.12 2.5-2.5-1.12-2.5-2.5-2.5z" fill="currentColor"/>
      </svg>
    `;
    button.title = 'Preview formatting';
    button.type = 'button';

    // Position button absolutely relative to container
    button.style.position = 'absolute';
    button.style.top = '4px';
    button.style.right = '4px';
    button.style.zIndex = '100';
    button.style.opacity = '0';
    button.style.pointerEvents = 'none';
    button.style.transition = 'opacity 0.15s ease';

    // Apply theme to button
    detectAndApplyTheme(button);

    // Track hide timeout for this specific button
    let hideTimeout = null;

    // Show button helper
    const showButton = () => {
      if (hideTimeout) {
        clearTimeout(hideTimeout);
        hideTimeout = null;
      }
      button.style.opacity = '1';
      button.style.pointerEvents = 'auto';
    };

    // Hide button helper
    const hideButton = () => {
      // Don't hide if preview is open
      const preview = previewMap.get(textarea);
      if (preview && document.body.contains(preview)) {
        return;
      }
      button.style.opacity = '0';
      button.style.pointerEvents = 'none';
    };

    // Click handler for button
    button.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      togglePreview(textarea, button);
    });

    // Focus event - show button (matches formatter pattern)
    textarea.addEventListener('focus', () => {
      if (hideTimeout) {
        clearTimeout(hideTimeout);
        hideTimeout = null;
      }
      showButton();
    });

    // Mousedown event - show button (matches formatter pattern)
    textarea.addEventListener('mousedown', () => {
      if (hideTimeout) {
        clearTimeout(hideTimeout);
        hideTimeout = null;
      }
      // Small delay to ensure it appears smoothly
      setTimeout(() => {
        if (document.body.contains(textarea)) {
          showButton();
        }
      }, 10);
    });

    // Blur event - hide button with delay (matches formatter pattern)
    textarea.addEventListener('blur', () => {
      if (hideTimeout) {
        clearTimeout(hideTimeout);
      }

      hideTimeout = setTimeout(() => {
        const newFocus = document.activeElement;
        const preview = previewMap.get(textarea);

        // Don't hide if focus went to the button or preview is open
        if (!newFocus?.closest('.jt-preview-btn') &&
            (!preview || !document.body.contains(preview))) {
          hideButton();
        }
        hideTimeout = null;
      }, 200);
    });

    // Store reference
    buttonMap.set(textarea, button);
    button._textarea = textarea; // Store textarea reference on button for closePreview

    // Insert button into the container
    container.style.position = 'relative';
    container.appendChild(button);

    // If textarea is already focused, show button immediately
    if (document.activeElement === textarea) {
      showButton();
    }
  }

  // Toggle preview panel
  function togglePreview(textarea, button) {
    // If pinned and panel exists, handle differently
    if (isPinned && activePreview && document.body.contains(activePreview)) {
      // Clicking toggle for the same textarea that's pinned → unpin and close
      if (textarea === pinnedTextarea) {
        unpinAndClose();
        if (button) button.classList.remove('active');
        return;
      }

      // Different textarea → swap content (same as focusin behavior)
      if (pinnedInputHandler && pinnedTextarea) {
        pinnedTextarea.removeEventListener('input', pinnedInputHandler);
      }

      pinnedTextarea = textarea;
      activePreview._textarea = textarea;

      // Render new content
      const contentEl = activePreview.querySelector('.jt-preview-content');
      if (contentEl) {
        const md = textarea.value;
        contentEl.innerHTML = md ? markdownToHTML(md) : '<p class="jt-preview-empty">No content to preview</p>';
      }

      // Attach new input handler
      pinnedInputHandler = () => {
        const contentEl = activePreview.querySelector('.jt-preview-content');
        if (contentEl) {
          const md = textarea.value;
          contentEl.innerHTML = md ? markdownToHTML(md) : '<p class="jt-preview-empty">No content to preview</p>';
        }
      };
      textarea.addEventListener('input', pinnedInputHandler);

      // Update button active states
      if (activeButton && activeButton !== button) activeButton.classList.remove('active');
      if (button) button.classList.add('active');
      activeButton = button;
      return;
    }

    // Standard docked mode toggle
    // Check if this textarea already has an open preview
    const existingPreview = previewMap.get(textarea);

    // If this preview is already open, close it and remove active state from button
    if (existingPreview && document.body.contains(existingPreview)) {
      closePreview();
      // Ensure the button's active class is removed
      if (button) {
        button.classList.remove('active');
      }
      return;
    }

    // Close any other open preview
    closePreview();

    // Create and show preview
    showPreview(textarea, button);
  }

  // Detect if JobTread is in dark mode (by checking body background color)
  function isJobTreadDarkMode() {
    const body = document.body;
    if (!body) return false;

    // Check for dark mode class on body or html
    if (body.classList.contains('dark') || document.documentElement.classList.contains('dark')) {
      return true;
    }

    // Check body background color
    const bgColor = window.getComputedStyle(body).backgroundColor;
    if (bgColor) {
      // Parse RGB values
      const match = bgColor.match(/rgb\((\d+),\s*(\d+),\s*(\d+)\)/);
      if (match) {
        const r = parseInt(match[1]);
        const g = parseInt(match[2]);
        const b = parseInt(match[3]);
        // Calculate luminance - dark mode if less than 50
        const luminance = (0.299 * r + 0.587 * g + 0.114 * b);
        return luminance < 80;
      }
    }

    return false;
  }

  // Detect and apply theme
  function detectAndApplyTheme(element) {
    if (!element) return;

    // Get current settings
    chrome.storage.sync.get(['jtToolsSettings'], (result) => {
      const settings = result.jtToolsSettings || {};

      // Remove existing theme classes
      element.classList.remove('dark-theme', 'custom-theme');

      // Check if dark mode is enabled (either via settings OR JobTread's native dark mode)
      if (settings.darkMode || isJobTreadDarkMode()) {
        element.classList.add('dark-theme');
        return;
      }

      // Check if custom RGB theme is enabled
      if (settings.rgbTheme && settings.themeColors) {
        element.classList.add('custom-theme');
        const { primary, background, text } = settings.themeColors;

        // Calculate lighter background for inputs
        const lighterBg = adjustColorBrightness(background, 10);
        const borderColor = adjustColorBrightness(background, -20);

        // Set CSS variables for custom theme
        element.style.setProperty('--jt-preview-bg', background);
        element.style.setProperty('--jt-preview-text', text);
        element.style.setProperty('--jt-preview-primary', primary);
        element.style.setProperty('--jt-preview-text-muted', adjustColorBrightness(text, 30));
        element.style.setProperty('--jt-preview-border', borderColor);
        element.style.setProperty('--jt-preview-btn-bg', lighterBg);
        element.style.setProperty('--jt-preview-btn-text', text);
        element.style.setProperty('--jt-preview-btn-border', borderColor);
        element.style.setProperty('--jt-preview-btn-hover-bg', adjustColorBrightness(lighterBg, 5));
        element.style.setProperty('--jt-preview-btn-hover-text', text);
        element.style.setProperty('--jt-preview-btn-hover-border', adjustColorBrightness(borderColor, -10));
        element.style.setProperty('--jt-preview-scrollbar-track', adjustColorBrightness(background, 5));
        element.style.setProperty('--jt-preview-scrollbar-thumb', borderColor);
        element.style.setProperty('--jt-preview-scrollbar-thumb-hover', adjustColorBrightness(borderColor, -10));
      }
    });
  }

  // Delegate to shared ColorUtils utility
  const adjustColorBrightness = (hex, percent) => ColorUtils.adjustBrightnessPercent(hex, percent);

  // Show preview panel
  function showPreview(textarea, button) {
    const preview = document.createElement('div');
    preview.className = 'jt-preview-panel';

    // Apply theme
    detectAndApplyTheme(preview);
    detectAndApplyTheme(button);

    // Add header
    const header = document.createElement('div');
    header.className = 'jt-preview-header';
    header.innerHTML = `
      <span class="jt-preview-title">
        <svg width="14" height="14" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
          <path d="M8 3C4.5 3 1.73 5.61 1 9c.73 3.39 3.5 6 7 6s6.27-2.61 7-6c-.73-3.39-3.5-6-7-6zm0 10c-2.21 0-4-1.79-4-4s1.79-4 4-4 4 1.79 4 4-1.79 4-4 4zm0-6.5c-1.38 0-2.5 1.12-2.5 2.5s1.12 2.5 2.5 2.5 2.5-1.12 2.5-2.5-1.12-2.5-2.5-2.5z" fill="currentColor"/>
        </svg>
        Format Preview
      </span>
      <div class="jt-preview-header-actions">
        <button class="jt-preview-pin-btn" title="Pin preview panel" type="button">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M9 4v6l-2 4v2h10v-2l-2-4V4"/>
            <line x1="12" y1="16" x2="12" y2="22"/>
            <line x1="8" y1="4" x2="16" y2="4"/>
          </svg>
        </button>
        <button class="jt-preview-close-btn" title="Close preview" type="button" style="display: none;">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <line x1="18" y1="6" x2="6" y2="18"></line>
            <line x1="6" y1="6" x2="18" y2="18"></line>
          </svg>
        </button>
      </div>
    `;
    preview.appendChild(header);

    // Attach pin and close button handlers
    const pinBtn = header.querySelector('.jt-preview-pin-btn');
    const closeBtn = header.querySelector('.jt-preview-close-btn');

    // Stop mousedown/touchstart on buttons from reaching header drag handler (Safari fix)
    [pinBtn, closeBtn].forEach(btn => {
      btn.addEventListener('mousedown', (e) => { e.stopPropagation(); });
      btn.addEventListener('touchstart', (e) => { e.stopPropagation(); }, { passive: true });
    });

    pinBtn.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      togglePinMode(preview, textarea, button);
    });

    closeBtn.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      unpinAndClose();
    });

    // Add content area
    const content = document.createElement('div');
    content.className = 'jt-preview-content';

    // Convert markdown to HTML
    const markdown = textarea.value;
    if (markdown) {
      content.innerHTML = markdownToHTML(markdown);
    } else {
      content.innerHTML = '<p class="jt-preview-empty">No content to preview</p>';
    }

    preview.appendChild(content);

    // Add to document
    document.body.appendChild(preview);

    // Position preview
    positionPreview(preview, textarea, button);

    // Remove active class from previous button if any
    if (activeButton && activeButton !== button) {
      activeButton.classList.remove('active');
    }

    // Mark new button as active
    if (button) {
      button.classList.add('active');
    }

    // Store references
    activePreview = preview;
    activeButton = button;
    previewMap.set(textarea, preview);

    // Update preview on textarea input
    const updatePreview = () => {
      const markdown = textarea.value;
      if (markdown) {
        content.innerHTML = markdownToHTML(markdown);
      } else {
        content.innerHTML = '<p class="jt-preview-empty">No content to preview</p>';
      }
    };

    // Close preview when textarea loses focus (user clicks out of textarea)
    const handleBlur = (e) => {
      // Don't auto-close if pinned
      if (isPinned) return;

      // Use a small delay to check where focus went
      setTimeout(() => {
        const newFocus = document.activeElement;

        // Don't close if focus went to the preview button or preview panel
        // This allows clicking the preview button to toggle it off, or clicking inside preview
        if (!newFocus?.closest('.jt-preview-btn') &&
            !newFocus?.closest('.jt-preview-toggle') &&
            !newFocus?.closest('.jt-preview-panel')) {
          closePreview();
        }
      }, 100);
    };

    // Scroll handler to reposition preview
    const handleScroll = () => {
      if (preview && document.body.contains(preview) && document.body.contains(textarea)) {
        positionPreview(preview, textarea, button);
      }
    };

    textarea.addEventListener('input', updatePreview);
    textarea.addEventListener('blur', handleBlur);
    window.addEventListener('scroll', handleScroll, true);
    preview._updateHandler = updatePreview;
    preview._blurHandler = handleBlur;
    preview._scrollHandler = handleScroll;
    preview._textarea = textarea;
    preview._button = button;
  }

  // ========================================
  // Pinned Mode Functions
  // ========================================

  // Toggle between docked and pinned modes
  function togglePinMode(preview, textarea, button) {
    if (isPinned) {
      // UNPIN: Close the panel entirely (textarea context may be stale)
      unpinAndClose();
      console.log('PreviewMode: Unpinned and closed');
      return;
    } else {
      // PIN: Enter pinned mode
      isPinned = true;
      pinnedTextarea = textarea;
      preview.classList.add('jt-preview-pinned');

      // Show close button, highlight pin icon
      const closeBtn = preview.querySelector('.jt-preview-close-btn');
      const pinBtn = preview.querySelector('.jt-preview-pin-btn');
      if (closeBtn) closeBtn.style.display = '';
      if (pinBtn) pinBtn.classList.add('active');

      // Remove blur handler (no auto-close in pinned mode)
      if (preview._blurHandler && preview._textarea) {
        preview._textarea.removeEventListener('blur', preview._blurHandler);
        preview._blurHandler = null;
      }

      // Remove scroll repositioning (pinned panel stays put)
      if (preview._scrollHandler) {
        window.removeEventListener('scroll', preview._scrollHandler, true);
        preview._scrollHandler = null;
      }

      // Load saved position/size and apply
      loadPinnedState().then(state => {
        if (state && preview && document.body.contains(preview)) {
          preview.style.left = `${state.left}px`;
          preview.style.top = `${state.top}px`;
          preview.style.width = `${state.width}px`;
          if (state.height) {
            preview.style.maxHeight = 'none';
            preview.style.height = `${state.height}px`;
            const contentEl = preview.querySelector('.jt-preview-content');
            if (contentEl) {
              const headerHeight = preview.querySelector('.jt-preview-header')?.offsetHeight || 44;
              contentEl.style.maxHeight = `${state.height - headerHeight}px`;
            }
          }
        }
      });

      // Add resize handles
      addResizeHandles(preview);

      // Setup drag behavior on header
      setupDragBehavior(preview);

      // Setup global focusin listener to track textarea changes
      setupFocusinListener(preview);

      console.log('PreviewMode: Pinned (persistent mode)');
    }
  }

  // Force-unpin and close the preview panel
  function unpinAndClose() {
    if (isPinned) {
      isPinned = false;

      if (focusinHandler) {
        document.removeEventListener('focusin', focusinHandler, true);
        focusinHandler = null;
      }

      if (pinnedInputHandler && pinnedTextarea) {
        pinnedTextarea.removeEventListener('input', pinnedInputHandler);
        pinnedInputHandler = null;
      }

      if (activePreview) {
        teardownDragBehavior(activePreview);
        removeResizeHandles(activePreview);
      }

      pinnedTextarea = null;
    }

    closePreview();
  }

  // ========================================
  // Drag Behavior
  // ========================================

  function setupDragBehavior(preview) {
    const header = preview.querySelector('.jt-preview-header');
    if (!header) return;

    // Extract clientX/clientY from mouse or touch event
    const getPointer = (e) => {
      if (e.touches && e.touches.length > 0) return e.touches[0];
      if (e.changedTouches && e.changedTouches.length > 0) return e.changedTouches[0];
      return e;
    };

    const handleDragStart = (e) => {
      // Don't drag from buttons inside header
      if (e.target.closest('.jt-preview-pin-btn') || e.target.closest('.jt-preview-close-btn')) {
        return;
      }

      const pointer = getPointer(e);
      dragState = {
        isDragging: true,
        startX: pointer.clientX,
        startY: pointer.clientY,
        startLeft: parseInt(preview.style.left, 10) || 0,
        startTop: parseInt(preview.style.top, 10) || 0
      };

      document.body.style.cursor = 'grabbing';
      document.body.style.userSelect = 'none';
      preview.classList.add('jt-preview-dragging');
      e.preventDefault();
    };

    const handleDragMove = (e) => {
      if (!dragState || !dragState.isDragging) return;

      const pointer = getPointer(e);
      const deltaX = pointer.clientX - dragState.startX;
      const deltaY = pointer.clientY - dragState.startY;

      let newLeft = dragState.startLeft + deltaX;
      let newTop = dragState.startTop + deltaY;

      // Viewport bounds clamping (keep at least 50px visible)
      const pw = preview.offsetWidth;
      const vw = window.innerWidth;
      const vh = window.innerHeight;

      newLeft = Math.max(-pw + 50, Math.min(vw - 50, newLeft));
      newTop = Math.max(0, Math.min(vh - 30, newTop));

      preview.style.left = `${newLeft}px`;
      preview.style.top = `${newTop}px`;
    };

    const handleDragEnd = () => {
      if (!dragState || !dragState.isDragging) return;

      dragState.isDragging = false;
      dragState = null;
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
      preview.classList.remove('jt-preview-dragging');

      savePinnedState(preview);
    };

    // Mouse events
    header.addEventListener('mousedown', handleDragStart);
    document.addEventListener('mousemove', handleDragMove);
    document.addEventListener('mouseup', handleDragEnd);

    // Touch events — passive: false so preventDefault() stops page scrolling while dragging
    header.addEventListener('touchstart', handleDragStart, { passive: false });
    document.addEventListener('touchmove', handleDragMove, { passive: false });
    document.addEventListener('touchend', handleDragEnd);

    pinnedDragHandlers = { handleDragStart, handleDragMove, handleDragEnd, header };
  }

  function teardownDragBehavior(preview) {
    if (!pinnedDragHandlers) return;

    const { handleDragStart, handleDragMove, handleDragEnd, header } = pinnedDragHandlers;
    if (header) {
      header.removeEventListener('mousedown', handleDragStart);
      header.removeEventListener('touchstart', handleDragStart);
    }
    document.removeEventListener('mousemove', handleDragMove);
    document.removeEventListener('mouseup', handleDragEnd);
    document.removeEventListener('touchmove', handleDragMove);
    document.removeEventListener('touchend', handleDragEnd);
    pinnedDragHandlers = null;
    dragState = null;
    document.body.style.cursor = '';
    document.body.style.userSelect = '';
  }

  // ========================================
  // Resize Behavior
  // ========================================

  const PREVIEW_MIN_WIDTH = 280;
  const PREVIEW_MAX_WIDTH = 800;
  const PREVIEW_MIN_HEIGHT = 150;
  const PREVIEW_MAX_HEIGHT = 600;

  function addResizeHandles(preview) {
    // Right edge handle
    const rightHandle = document.createElement('div');
    rightHandle.className = 'jt-preview-resize-handle jt-preview-resize-right';
    preview.appendChild(rightHandle);

    // Bottom edge handle
    const bottomHandle = document.createElement('div');
    bottomHandle.className = 'jt-preview-resize-handle jt-preview-resize-bottom';
    preview.appendChild(bottomHandle);

    // Bottom-right corner handle
    const cornerHandle = document.createElement('div');
    cornerHandle.className = 'jt-preview-resize-handle jt-preview-resize-corner';
    preview.appendChild(cornerHandle);

    // Extract clientX/clientY from mouse or touch event
    const getPointer = (e) => {
      if (e.touches && e.touches.length > 0) return e.touches[0];
      if (e.changedTouches && e.changedTouches.length > 0) return e.changedTouches[0];
      return e;
    };

    // Single shared move/end handlers for all handles (mouse + touch)
    const handleResizeMove = (e) => {
      if (!resizeState || !resizeState.isResizing) return;

      const pointer = getPointer(e);
      const deltaX = pointer.clientX - resizeState.startX;
      const deltaY = pointer.clientY - resizeState.startY;

      if (resizeState.handle === 'right' || resizeState.handle === 'corner') {
        const newWidth = Math.max(PREVIEW_MIN_WIDTH, Math.min(PREVIEW_MAX_WIDTH, resizeState.startWidth + deltaX));
        preview.style.width = `${newWidth}px`;
      }

      if (resizeState.handle === 'bottom' || resizeState.handle === 'corner') {
        const newHeight = Math.max(PREVIEW_MIN_HEIGHT, Math.min(PREVIEW_MAX_HEIGHT, resizeState.startHeight + deltaY));
        preview.style.maxHeight = 'none';
        preview.style.height = `${newHeight}px`;

        // Update content area height
        const contentEl = preview.querySelector('.jt-preview-content');
        if (contentEl) {
          const headerHeight = preview.querySelector('.jt-preview-header')?.offsetHeight || 44;
          contentEl.style.maxHeight = `${newHeight - headerHeight}px`;
        }
      }
    };

    const handleResizeEnd = () => {
      if (!resizeState || !resizeState.isResizing) return;

      resizeState.isResizing = false;
      resizeState = null;
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
      preview.classList.remove('jt-preview-resizing');

      savePinnedState(preview);
    };

    // Start resize from mouse or touch on each handle
    const startResize = (handle, direction) => {
      const onStart = (e) => {
        e.preventDefault();
        e.stopPropagation();

        const pointer = getPointer(e);
        resizeState = {
          isResizing: true,
          handle: direction,
          startX: pointer.clientX,
          startY: pointer.clientY,
          startWidth: preview.offsetWidth,
          startHeight: preview.offsetHeight
        };

        const cursor = direction === 'right' ? 'ew-resize' :
                       direction === 'bottom' ? 'ns-resize' : 'nwse-resize';
        document.body.style.cursor = cursor;
        document.body.style.userSelect = 'none';
        preview.classList.add('jt-preview-resizing');
      };

      handle.addEventListener('mousedown', onStart);
      handle.addEventListener('touchstart', onStart, { passive: false });
    };

    startResize(rightHandle, 'right');
    startResize(bottomHandle, 'bottom');
    startResize(cornerHandle, 'corner');

    // Mouse events
    document.addEventListener('mousemove', handleResizeMove);
    document.addEventListener('mouseup', handleResizeEnd);

    // Touch events
    document.addEventListener('touchmove', handleResizeMove, { passive: false });
    document.addEventListener('touchend', handleResizeEnd);

    pinnedResizeHandlers = { handleResizeMove, handleResizeEnd };
  }

  function removeResizeHandles(preview) {
    if (!preview) return;
    preview.querySelectorAll('.jt-preview-resize-handle').forEach(h => h.remove());

    if (pinnedResizeHandlers) {
      document.removeEventListener('mousemove', pinnedResizeHandlers.handleResizeMove);
      document.removeEventListener('mouseup', pinnedResizeHandlers.handleResizeEnd);
      document.removeEventListener('touchmove', pinnedResizeHandlers.handleResizeMove);
      document.removeEventListener('touchend', pinnedResizeHandlers.handleResizeEnd);
      pinnedResizeHandlers = null;
    }
    resizeState = null;
  }

  // ========================================
  // Focusin Listener (content follows focus)
  // ========================================

  function setupFocusinListener(preview) {
    focusinHandler = (e) => {
      if (!isPinned || !preview || !document.body.contains(preview)) return;

      const textarea = e.target;
      if (!textarea || textarea.tagName !== 'TEXTAREA') return;

      // Skip if same textarea already tracked
      if (textarea === pinnedTextarea) return;

      // Remove old input handler from previous textarea
      if (pinnedInputHandler && pinnedTextarea) {
        pinnedTextarea.removeEventListener('input', pinnedInputHandler);
      }

      // Update tracked textarea
      pinnedTextarea = textarea;
      preview._textarea = textarea;

      // Remove old button active state, set new one
      if (activeButton) {
        activeButton.classList.remove('active');
      }
      const newToolbar = textarea.closest('.jt-formatter-container')?.querySelector('.jt-preview-toggle');
      if (newToolbar) {
        newToolbar.classList.add('active');
        activeButton = newToolbar;
      }

      // Render new textarea's content immediately
      const contentEl = preview.querySelector('.jt-preview-content');
      if (contentEl) {
        const markdown = textarea.value;
        contentEl.innerHTML = markdown ? markdownToHTML(markdown) : '<p class="jt-preview-empty">No content to preview</p>';
      }

      // Attach new input handler for live updates
      pinnedInputHandler = () => {
        const contentEl = preview.querySelector('.jt-preview-content');
        if (contentEl) {
          const md = textarea.value;
          contentEl.innerHTML = md ? markdownToHTML(md) : '<p class="jt-preview-empty">No content to preview</p>';
        }
      };
      textarea.addEventListener('input', pinnedInputHandler);
    };

    document.addEventListener('focusin', focusinHandler, true);
  }

  // ========================================
  // Persistence (save/load pinned state)
  // ========================================

  function savePinnedState(preview) {
    if (!preview) return;

    // Debounce to avoid chrome.storage rate limits
    if (savePinnedTimeout) clearTimeout(savePinnedTimeout);
    savePinnedTimeout = setTimeout(() => {
      const state = {
        left: parseInt(preview.style.left, 10) || 0,
        top: parseInt(preview.style.top, 10) || 0,
        width: preview.offsetWidth,
        height: preview.offsetHeight
      };
      chrome.storage.sync.set({ jtToolsPreviewPinnedState: state });
    }, 500);
  }

  async function loadPinnedState() {
    return new Promise((resolve) => {
      chrome.storage.sync.get(['jtToolsPreviewPinnedState'], (result) => {
        resolve(result.jtToolsPreviewPinnedState || null);
      });
    });
  }

  // Get sticky header offset for preview positioning (mirrors toolbar logic)
  function getPreviewStickyOffset(textarea) {
    const fieldRect = textarea.getBoundingClientRect();
    let maxOffset = 0;

    // Check elements with sticky class
    const stickyClassElements = document.querySelectorAll('.sticky');
    stickyClassElements.forEach(el => {
      const style = window.getComputedStyle(el);
      if (style.position === 'sticky') {
        const rect = el.getBoundingClientRect();
        if (rect.bottom <= fieldRect.top + 50 && rect.height > 15 && rect.height < 150) {
          if (rect.bottom > maxOffset) {
            maxOffset = rect.bottom;
          }
        }
      }
    });

    return maxOffset;
  }

  // Position preview panel intelligently - prefer LEFT side, NEVER overlap textarea
  function positionPreview(preview, textarea, button) {
    const textareaRect = textarea.getBoundingClientRect();
    const viewportHeight = window.innerHeight;
    const viewportWidth = window.innerWidth;
    const stickyOffset = getPreviewStickyOffset(textarea);

    const previewWidth = 380;
    const previewMaxHeight = 280;
    const padding = 12;
    const gap = 16; // Gap between textarea and preview

    // Calculate available space on each side of the textarea
    const spaceOnLeft = textareaRect.left - padding;
    const spaceOnRight = viewportWidth - textareaRect.right - padding;

    let left, top;
    let placedSide = false;

    // PREFER positioning to the LEFT of the textarea (user requested)
    if (spaceOnLeft >= previewWidth + gap) {
      left = textareaRect.left - previewWidth - gap;
      top = textareaRect.top;
      placedSide = true;
    }
    // Otherwise try positioning to the RIGHT
    else if (spaceOnRight >= previewWidth + gap) {
      left = textareaRect.right + gap;
      top = textareaRect.top;
      placedSide = true;
    }
    // If not enough space on either side, try a smaller width on LEFT
    else if (spaceOnLeft >= 250) {
      left = padding;
      top = textareaRect.top;
      preview.style.width = `${spaceOnLeft - gap}px`;
      placedSide = true;
    }

    // If neither side works, position BELOW the textarea (never overlap!)
    if (!placedSide) {
      left = Math.max(padding, Math.min(textareaRect.left, viewportWidth - previewWidth - padding));
      top = textareaRect.bottom + gap;

      // If not enough room below, position ABOVE the textarea
      if (top + previewMaxHeight > viewportHeight - padding) {
        top = textareaRect.top - previewMaxHeight - gap;
      }

      // If still no room above, clamp to viewport bottom
      if (top < stickyOffset + padding) {
        top = stickyOffset + padding;
      }
    }

    // If placed on the side, adjust vertical position to stay in viewport
    if (placedSide) {
      // Account for sticky headers
      const minTop = stickyOffset + padding;
      const maxTop = viewportHeight - previewMaxHeight - padding;

      // Try to align with textarea top, but clamp to viewport
      top = Math.max(minTop, Math.min(top, maxTop));
    }

    // Use fixed positioning for consistent behavior
    preview.style.position = 'fixed';
    preview.style.left = `${left}px`;
    preview.style.top = `${top}px`;
    if (!preview.style.width) {
      preview.style.width = `${previewWidth}px`;
    }
    preview.style.maxHeight = `${previewMaxHeight}px`;

    // Add show class for animation
    setTimeout(() => {
      preview.classList.add('show');
    }, 10);
  }

  // Close preview panel
  function closePreview() {
    if (activePreview) {
      // Remove input listener
      if (activePreview._updateHandler && activePreview._textarea) {
        activePreview._textarea.removeEventListener('input', activePreview._updateHandler);
        // Clear the preview from the map
        previewMap.delete(activePreview._textarea);
      }

      // Remove blur listener
      if (activePreview._blurHandler && activePreview._textarea) {
        activePreview._textarea.removeEventListener('blur', activePreview._blurHandler);
      }

      // Remove scroll listener
      if (activePreview._scrollHandler) {
        window.removeEventListener('scroll', activePreview._scrollHandler, true);
      }

      activePreview.classList.remove('show');
      setTimeout(() => {
        if (activePreview && activePreview.parentNode) {
          activePreview.remove();
        }
      }, 200);
    }

    // Always remove active class from ALL preview buttons (comprehensive cleanup)
    // This ensures the button state is reset regardless of reference issues
    const allActiveButtons = document.querySelectorAll('.jt-preview-btn.active, .jt-preview-toggle.active');
    allActiveButtons.forEach(btn => {
      btn.classList.remove('active');

      // Hide standalone button if textarea is not focused (toolbar buttons don't have _textarea)
      const textarea = btn._textarea;
      if (textarea && document.activeElement !== textarea) {
        btn.style.opacity = '0';
        btn.style.pointerEvents = 'none';
      }
    });

    // Also explicitly remove from activeButton reference if it exists
    if (activeButton) {
      activeButton.classList.remove('active');
    }

    activePreview = null;
    activeButton = null;
  }

  // Handle global clicks to hide buttons (preview stays open until blur or toggle)
  function handleGlobalClick(e) {
    const clickedElement = e.target;

    // Note: Preview is no longer closed on outside clicks
    // It only closes via:
    // 1. Clicking the preview button again (toggle)
    // 2. Textarea blur event (clicking/focusing out of textarea)

    // Handle button hiding when clicking outside (matches formatter pattern)
    if (!clickedElement.closest('textarea[data-preview-mode-ready="true"]') &&
        !clickedElement.closest('.jt-preview-btn') &&
        !clickedElement.closest('.jt-preview-panel')) {

      // Hide all visible buttons that don't have an active preview
      const allButtons = document.querySelectorAll('.jt-preview-btn');
      allButtons.forEach(btn => {
        const textarea = btn._textarea;
        if (textarea) {
          const preview = previewMap.get(textarea);
          // Only hide if no preview is open and textarea doesn't have focus
          if ((!preview || !document.body.contains(preview)) &&
              document.activeElement !== textarea) {
            btn.style.opacity = '0';
            btn.style.pointerEvents = 'none';
          }
        }
      });
    }
  }

  // Parse markdown tables and convert to HTML
  function parseMarkdownTables(text) {
    // Split text into lines
    const lines = text.split('\n');
    const result = [];
    let i = 0;

    while (i < lines.length) {
      const line = lines[i];

      // Check if this line starts a table (contains pipes)
      if (line.trim().startsWith('|') && line.trim().endsWith('|')) {
        // Collect all table rows
        const tableRows = [];
        let j = i;

        while (j < lines.length) {
          const tableLine = lines[j].trim();
          if (tableLine.startsWith('|') && tableLine.endsWith('|')) {
            tableRows.push(tableLine);
            j++;
          } else {
            break;
          }
        }

        // Parse table if we have at least one row
        if (tableRows.length > 0) {
          const tableHTML = convertTableToHTML(tableRows);
          result.push(tableHTML);
          i = j;
          continue;
        }
      }

      result.push(line);
      i++;
    }

    return result.join('\n');
  }

  // Convert markdown table rows to HTML table
  function convertTableToHTML(rows) {
    if (rows.length === 0) return '';

    let html = '<table class="jt-markdown-table">\n';

    // Check if second row is separator (contains only |, -, :, and spaces)
    const hasSeparator = rows.length > 1 && /^[\|\-\s:]+$/.test(rows[1]);

    // Determine header row index
    const headerIndex = 0;
    const dataStartIndex = hasSeparator ? 2 : 1;

    // Parse header row
    if (rows[headerIndex]) {
      const headerCells = rows[headerIndex]
        .split('|')
        .map(cell => cell.trim())
        .filter(cell => cell.length > 0);

      if (headerCells.length > 0) {
        html += '  <thead>\n    <tr>\n';
        headerCells.forEach(cell => {
          html += `      <th>${escapeHTML(cell)}</th>\n`;
        });
        html += '    </tr>\n  </thead>\n';
      }
    }

    // Parse data rows
    if (dataStartIndex < rows.length) {
      html += '  <tbody>\n';
      for (let i = dataStartIndex; i < rows.length; i++) {
        const cells = rows[i]
          .split('|')
          .map(cell => cell.trim())
          .filter(cell => cell.length > 0);

        if (cells.length > 0) {
          html += '    <tr>\n';
          cells.forEach(cell => {
            html += `      <td>${escapeHTML(cell)}</td>\n`;
          });
          html += '    </tr>\n';
        }
      }
      html += '  </tbody>\n';
    }

    html += '</table>';
    return html;
  }

  // Delegate to shared Sanitizer utility
  const escapeHTML = (text) => Sanitizer.escapeHTML(text);

  // Parse and render alerts
  function parseAlerts(text) {
    const lines = text.split('\n');
    const alertBlocks = [];
    let i = 0;

    while (i < lines.length) {
      const line = lines[i].trim();

      // Check if this line starts an alert: > [!color:xxx] ### [!icon:xxx] Subject (supports ### or ####)
      const alertMatch = line.match(/^>\s*\[!color:(\w+)\]\s*#{3,4}\s*\[!icon:\s*(\w+)\]\s*(.+)$/);

      if (alertMatch) {
        const color = alertMatch[1];
        const icon = alertMatch[2];
        const subject = alertMatch[3].trim();
        const bodyLines = [];

        // Collect subsequent blockquoted lines as body
        i++;
        while (i < lines.length && lines[i].trim().startsWith('> ')) {
          const bodyLine = lines[i].trim().substring(2); // Remove "> "
          bodyLines.push(bodyLine);
          i++;
        }

        const body = bodyLines.join('\n');

        // Render the alert
        const alertHTML = renderAlert(color, icon, subject, body);
        const placeholder = `___ALERT_${alertBlocks.length}___`;
        alertBlocks.push(alertHTML);

        // Replace the alert lines with placeholder
        const alertLineCount = 1 + bodyLines.length;
        const startIdx = i - alertLineCount;
        lines.splice(startIdx, alertLineCount, placeholder);

        // Reset i to account for removed lines
        i = startIdx + 1;
      } else {
        i++;
      }
    }

    // Return text with ___ALERT_N___ placeholders still in place.
    // The caller (markdownToHTML) will resolve them after escaping.
    return { text: lines.join('\n'), alertBlocks };
  }

  // Render a single alert
  function renderAlert(color, icon, subject, body) {
    // Color mappings - use JT-specific classes that work with dark theme
    const colorMap = {
      blue: { border: 'jt-alert-border-blue', bg: 'jt-alert-bg-blue', text: 'jt-alert-text-blue' },
      yellow: { border: 'jt-alert-border-yellow', bg: 'jt-alert-bg-yellow', text: 'jt-alert-text-yellow' },
      red: { border: 'jt-alert-border-red', bg: 'jt-alert-bg-red', text: 'jt-alert-text-red' },
      green: { border: 'jt-alert-border-green', bg: 'jt-alert-bg-green', text: 'jt-alert-text-green' },
      orange: { border: 'jt-alert-border-orange', bg: 'jt-alert-bg-orange', text: 'jt-alert-text-orange' },
      purple: { border: 'jt-alert-border-purple', bg: 'jt-alert-bg-purple', text: 'jt-alert-text-purple' }
    };

    const colors = colorMap[color] || colorMap.blue;
    const iconSVG = ICON_MAP[icon] || ICON_MAP.infoCircle;

    // Process body inline formatting
    const processedBody = processInlineFormatting(body);

    // Build the icon SVG element
    const iconElement = `<svg class="jt-alert-icon" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${iconSVG}</svg>`;

    return `<div class="jt-alert-box ${colors.border} ${colors.bg}"><div class="jt-alert-subject ${colors.text}">${iconElement}<span>${escapeHTML(subject)}</span></div><div class="jt-alert-body">${processedBody}</div></div>`;
  }

  // Icon SVG paths - shared between alerts and inline icons
  const ICON_MAP = {
    lightbulb: '<path d="M15 14c.2-1 .7-1.7 1.5-2.5 1-.9 1.5-2.2 1.5-3.5A6 6 0 0 0 6 8c0 1 .2 2.2 1.5 3.5.7.7 1.3 1.5 1.5 2.5M9 18h6M10 22h4"></path>',
    infoCircle: '<circle cx="12" cy="12" r="10"></circle><path d="M12 16v-4M12 8h.01"></path>',
    info: '<circle cx="12" cy="12" r="10"></circle><path d="M12 16v-4M12 8h.01"></path>',
    exclamationTriangle: '<path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3M12 9v4M12 17h.01"></path>',
    checkCircle: '<path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"></path><path d="m9 11 3 3L22 4"></path>',
    octogonAlert: '<path d="M7.86 2h8.28L22 7.86v8.28L16.14 22H7.86L2 16.14V7.86z"></path><path d="M12 8v4M12 16h.01"></path>'
  };

  // Helper to render an inline SVG icon
  function renderInlineIcon(iconName) {
    const iconPath = ICON_MAP[iconName] || ICON_MAP.infoCircle;
    return `<svg class="jt-inline-icon" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${iconPath}</svg>`;
  }

  // Process inline formatting (can be nested inside block elements)
  function processInlineFormatting(text) {
    // Escape HTML entities first to prevent XSS, then apply formatting
    // Markdown syntax chars (*, ^, _, ~, [, ], (, )) are unaffected by escapeHTML
    let result = escapeHTML(text);

    // Icons [!icon:name] - render as actual SVG icons
    result = result.replace(/\[!icon:(\w+)\]/g, (match, iconName) => renderInlineIcon(iconName));

    // Inline colors [!color:green] text - process before other formatting
    result = result.replace(/\[!color:(\w+)\]\s*(.+?)(?=\[!color:|$)/g, '<span class="jt-color-$1">$2</span>');

    // Links [text](url) - sanitize URL and attr-escape before href interpolation
    result = result.replace(/\[([^\]]+)\]\(([^)]+)\)/g, (match, text, url) => {
      const safeUrl = (typeof Sanitizer !== 'undefined' && Sanitizer.sanitizeURL)
        ? Sanitizer.sanitizeURL(url, '#')
        : '#';
      const hrefAttr = (typeof Sanitizer !== 'undefined' && Sanitizer.escapeAttr)
        ? Sanitizer.escapeAttr(safeUrl)
        : safeUrl;
      return `<a href="${hrefAttr}" target="_blank" rel="noopener noreferrer">${text}</a>`;
    });

    // Inline formatting (bold, italic, underline, strikethrough)
    // Using non-greedy matching to properly handle nested formatting
    result = result.replace(/\*(.+?)\*/g, '<strong>$1</strong>');
    result = result.replace(/\^(.+?)\^/g, '<em>$1</em>');
    result = result.replace(/_(.+?)_/g, '<u>$1</u>');
    result = result.replace(/~(.+?)~/g, '<s>$1</s>');

    return result;
  }

  // Convert markdown to HTML for preview
  function markdownToHTML(markdown) {
    if (!markdown) return '';

    let html = markdown;

    // Parse tables and alerts first - they produce HTML blocks
    // Use placeholder tokens so we can escape raw text without breaking their output
    const htmlBlocks = [];

    // Parse tables — produces inline HTML that needs tokenizing
    html = parseMarkdownTables(html);
    html = html.replace(/<table[\s\S]*?<\/table>/gi, (match) => {
      const index = htmlBlocks.length;
      htmlBlocks.push(match);
      return `\x00HTMLBLOCK${index}\x00`;
    });

    // Parse alerts — returns { text, alertBlocks } with ___ALERT_N___ placeholders
    const alertResult = parseAlerts(html);
    html = alertResult.text;
    // Convert alert placeholders to HTMLBLOCK tokens
    alertResult.alertBlocks.forEach((alertHTML, idx) => {
      const blockIndex = htmlBlocks.length;
      htmlBlocks.push(alertHTML);
      html = html.replace(`___ALERT_${idx}___`, `\x00HTMLBLOCK${blockIndex}\x00`);
    });

    // Process line by line to handle block-level formatting
    const lines = html.split('\n');
    const processedLines = lines.map(line => {
      let processedLine = line.trim();

      // Restore HTML block placeholders as-is (already safe HTML from our parsers)
      const blockMatch = processedLine.match(/^\x00HTMLBLOCK(\d+)\x00$/);
      if (blockMatch) {
        return htmlBlocks[parseInt(blockMatch[1])];
      }

      let isBlockQuote = false;
      let isColored = false;
      let colorClass = '';

      // Check for blockquote
      if (processedLine.startsWith('> ')) {
        processedLine = processedLine.substring(2);
        isBlockQuote = true;
      }

      // Check for color tags [!color:red]
      const colorMatch = processedLine.match(/^\[!color:(\w+)\]\s*/);
      if (colorMatch) {
        colorClass = `jt-color-${colorMatch[1]}`;
        processedLine = processedLine.substring(colorMatch[0].length);
        isColored = true;
      }

      // Check for headings (now that blockquote/color are stripped)
      let headingLevel = 0;
      if (processedLine.startsWith('#### ')) {
        headingLevel = 4;
        processedLine = processedLine.substring(5);
      } else if (processedLine.startsWith('### ')) {
        headingLevel = 3;
        processedLine = processedLine.substring(4);
      } else if (processedLine.startsWith('## ')) {
        headingLevel = 2;
        processedLine = processedLine.substring(3);
      } else if (processedLine.startsWith('# ')) {
        headingLevel = 1;
        processedLine = processedLine.substring(2);
      }

      // Check for text alignment
      let alignment = '';
      if (processedLine.startsWith('---: ')) {
        alignment = 'right';
        processedLine = processedLine.substring(5);
      } else if (processedLine.startsWith('--: ')) {
        alignment = 'center';
        processedLine = processedLine.substring(4);
      }

      // Check for lists
      let isBulletList = false;
      let isNumberedList = false;
      let listValue = '';

      if (processedLine.startsWith('- ')) {
        processedLine = processedLine.substring(2);
        isBulletList = true;
      } else {
        const numberedMatch = processedLine.match(/^(\d+)\.\s+(.*)$/);
        if (numberedMatch) {
          listValue = numberedMatch[1];
          processedLine = numberedMatch[2];
          isNumberedList = true;
        }
      }

      // Process inline formatting
      processedLine = processInlineFormatting(processedLine);

      // Build the HTML from inside out
      let result = processedLine;

      // Wrap in heading if needed
      if (headingLevel > 0) {
        result = `<h${headingLevel}>${result}</h${headingLevel}>`;
      }

      // Wrap in color if needed
      if (isColored) {
        result = `<span class="${colorClass}">${result}</span>`;
      }

      // Wrap in alignment if needed
      if (alignment) {
        result = `<div class="jt-align-${alignment}">${result}</div>`;
      }

      // Wrap in list item if needed
      if (isBulletList) {
        result = `<li>${result}</li>`;
      } else if (isNumberedList) {
        result = `<li value="${listValue}">${result}</li>`;
      }

      // Wrap in blockquote if needed
      if (isBlockQuote) {
        result = `<blockquote>${result}</blockquote>`;
      }

      return result;
    });

    // Wrap consecutive list items
    let result = processedLines.join('\n');
    result = result.replace(/(<li>.*<\/li>\n?)+/g, (match) => {
      if (match.includes('value=')) {
        return `<ol>${match}</ol>`;
      } else {
        return `<ul>${match}</ul>`;
      }
    });

    // FIRST: Preserve paragraph breaks (double+ newlines) with a placeholder
    // This must happen before blockquote combining to prevent newlines being eaten
    result = result.replace(/\n\n+/g, '___PARA_BREAK___');

    // Combine consecutive blockquotes into a single blockquote
    // This ensures "> line1" and "> line2" render as one continuous blockquote
    result = result.replace(/(<blockquote>[\s\S]*?<\/blockquote>\n?)+/g, (match) => {
      // Extract content from each blockquote and join with <br>
      const contents = [];
      const blockquoteRegex = /<blockquote>([\s\S]*?)<\/blockquote>/g;
      let blockMatch;
      while ((blockMatch = blockquoteRegex.exec(match)) !== null) {
        contents.push(blockMatch[1]);
      }
      return `<blockquote>${contents.join('<br>')}</blockquote>`;
    });

    // Restore paragraph breaks
    result = result.replace(/___PARA_BREAK___/g, '<div class="jt-paragraph-break"></div>');

    // Preserve remaining single line breaks
    result = result.replace(/\n/g, '<br>');

    // But remove breaks inside/around block elements
    result = result.replace(/<\/(h[123]|blockquote|div|li|table|thead|tbody|tr|th|td)><br>/g, '</$1>');
    result = result.replace(/<br><(h[123]|blockquote|div|li|ul|ol|table|thead|tbody|tr|th|td)/g, '<$1');

    return result;
  }

  // Public API
  return {
    init,
    cleanup,
    isActive: () => isActive,
    togglePreview: (textarea, button) => {
      if (!isActive) return;
      togglePreview(textarea, button);
    }
  };
})();

// Export for use in main content script
if (typeof window !== 'undefined') {
  window.PreviewModeFeature = PreviewModeFeature;
}
