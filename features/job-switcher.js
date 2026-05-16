// JobTread Smart Job Switcher Feature
// Keyboard shortcuts: J+S or ALT+J to quickly search and switch jobs
// Features: Quick job search, keyboard navigation, resizable sidebars with per-sidebar width memory

const SmartJobSwitcherFeature = (() => {
  let isActive = false;
  let isSearchOpen = false;
  let jKeyPressed = false;
  let sidebarObserver = null;
  let migrationDone = false;
  let resizeState = {
    isResizing: false,
    startX: 0,
    startWidth: 0,
    activeSidebar: null
  };

  // WeakSet to track sidebars that already have resize handles injected
  const enhancedSidebars = new WeakSet();

  // Track which sidebars push content (have associated padding-right elements)
  // vs overlay sidebars that just float on top
  const pushSidebars = new WeakSet();

  // Constants for resize functionality
  const OLD_STORAGE_KEY = 'jt-job-switcher-width'; // Legacy chrome.storage.sync key
  const STORAGE_PREFIX = 'jt-sidebar-';
  const MIN_WIDTH = 280;
  const MAX_WIDTH_FLOOR = 800;
  const DEFAULT_WIDTH = 400;
  const SIDEBAR_SELECTOR = 'div.z-30.absolute.top-0.bottom-0.right-0';

  /**
   * Maximum sidebar width scales with the viewport so ultrawide monitors can
   * resize sidebars beyond the old fixed 800px ceiling. Always leaves at least
   * 400px for the main content area, and never goes below the 800px floor so
   * behavior on normal screens is unchanged.
   */
  function getMaxWidth() {
    const viewport = typeof window !== 'undefined' ? window.innerWidth : 0;
    return Math.max(MAX_WIDTH_FLOOR, viewport - 400);
  }

  /**
   * Detect the sidebar type from its content for per-sidebar width storage.
   * Looks at header text to identify the sidebar (e.g., "job-switcher", "documents", "task-details").
   * Falls back to "default" if no identifiable header is found.
   */
  function getSidebarType(sidebarEl) {
    if (!sidebarEl) return 'default';

    // Look for header text in common patterns
    const headerCandidates = sidebarEl.querySelectorAll('h1, h2, h3, [class*="font-bold"], [class*="font-semibold"]');
    for (const header of headerCandidates) {
      const text = (header.textContent || '').trim().toLowerCase();
      // Skip very long text (not a header) or very short text (icons, etc.)
      if (text.length < 2 || text.length > 60) continue;

      // Normalize to kebab-case for storage key
      const normalized = text
        .replace(/[^a-z0-9\s]+/g, '')  // Remove non-alphanumeric
        .trim()
        .replace(/\s+/g, '-');          // Spaces to hyphens

      if (normalized && normalized.length >= 2) {
        return normalized;
      }
    }

    return 'default';
  }

  /**
   * Check if a sidebar element is specifically the Job Switcher
   * Used only for keyboard shortcut features (Enter to select, Escape to close)
   */
  function isJobSwitcherSidebar(sidebar) {
    if (!sidebar) return false;

    const headerText = sidebar.textContent || '';
    if (headerText.includes('JOB SWITCHER') || headerText.includes('Job Switcher')) {
      return true;
    }

    const searchInput = sidebar.querySelector('input[placeholder*="Search Jobs"]') ||
                       sidebar.querySelector('input[placeholder*="Search jobs"]');
    if (searchInput) {
      return true;
    }

    return false;
  }

  /**
   * Find the Job Switcher sidebar specifically (for keyboard shortcuts)
   */
  function findJobSwitcherSidebar() {
    const sidebars = document.querySelectorAll(SIDEBAR_SELECTOR);
    for (const sidebar of sidebars) {
      if (isJobSwitcherSidebar(sidebar)) {
        return sidebar;
      }
    }
    return null;
  }

  /**
   * Get saved sidebar width from localStorage for a given sidebar type.
   * Returns the saved width or null if no width was previously saved.
   */
  function getSavedWidth(sidebarType) {
    try {
      const saved = localStorage.getItem(STORAGE_PREFIX + sidebarType);
      if (saved) {
        const width = parseInt(saved, 10);
        if (width >= MIN_WIDTH) {
          // Clamp to current viewport's max — a width saved on an ultrawide
          // may exceed the max on a smaller screen.
          return Math.min(width, getMaxWidth());
        }
      }
    } catch (e) {
      console.warn('SmartJobSwitcher: Could not read saved width', e);
    }
    return null;
  }

  /**
   * Save sidebar width to localStorage for a given sidebar type
   */
  function saveWidth(sidebarType, width) {
    try {
      localStorage.setItem(STORAGE_PREFIX + sidebarType, String(width));
    } catch (e) {
      console.warn('SmartJobSwitcher: Could not save width', e);
    }
  }

  /**
   * Migrate saved width from old chrome.storage.sync to localStorage (one-time)
   */
  async function migrateOldStorage() {
    if (migrationDone) return;
    migrationDone = true;

    try {
      // Check if we already have any localStorage sidebar widths
      const hasLocalData = localStorage.getItem(STORAGE_PREFIX + 'job-switcher');
      if (hasLocalData) return; // Already migrated

      const data = await chrome.storage.sync.get(OLD_STORAGE_KEY);
      const oldWidth = data[OLD_STORAGE_KEY];
      if (oldWidth) {
        const width = parseInt(oldWidth, 10);
        if (width >= MIN_WIDTH && width <= getMaxWidth()) {
          localStorage.setItem(STORAGE_PREFIX + 'job-switcher', String(width));
          console.log('SmartJobSwitcher: Migrated saved width from sync storage to localStorage');
        }
        // Clean up old key
        chrome.storage.sync.remove(OLD_STORAGE_KEY);
      }
    } catch (e) {
      console.warn('SmartJobSwitcher: Migration failed (non-critical)', e);
    }
  }

  /**
   * Determine whether a sidebar should push main content when resized.
   * Uses header-level keyword detection — checks only h1-h3 and bold/semibold
   * elements, NOT full textContent, to avoid false positives from body content
   * (e.g., a Cost Item Details sidebar that mentions "daily log" in its body).
   *
   * Push sidebars: Job Switcher, Notifications, Help, Daily Logs
   * Overlay sidebars: Everything else (Budget, Schedule Tasks, Todos, Cost Items, etc.)
   */

  // Overlay exclusions — if any header matches these, never push (checked first)
  const OVERLAY_HEADER_PATTERNS = [
    'COST ITEM', 'COST GROUP', 'ADD / EDIT', 'EDIT ITEMS',
    'BUDGET', 'ESTIMATE', 'PURCHASE ORDER', 'INVOICE',
  ];

  /**
   * Full-bypass exclusions — sidebars whose header matches one of these
   * patterns get NO resize handle and NO saved-width application. JT renders
   * them as full-bleed wide-table editors (12+ columns, min-w-max rows) that
   * need every available pixel of horizontal space; clamping them to a saved
   * "sidebar width" breaks the layout. The header-text check fires after the
   * 50ms render delay in startSidebarObserver(), so by the time we sample
   * `headerText` the JT-rendered title is in place.
   */
  const IGNORE_HEADER_PATTERNS = [
    'ADD / EDIT ITEMS',
  ];

  function shouldIgnoreSidebar(sidebar) {
    const headers = sidebar.querySelectorAll('h1, h2, h3, [class*="font-bold"], [class*="font-semibold"]');
    let headerText = '';
    for (const header of headers) {
      const text = (header.textContent || '').trim();
      if (text.length >= 2 && text.length <= 80) {
        headerText += ' ' + text;
      }
    }
    headerText = headerText.toUpperCase();
    for (const pattern of IGNORE_HEADER_PATTERNS) {
      if (headerText.includes(pattern)) return true;
    }
    return false;
  }

  // Push patterns — if any header matches these, push content
  const PUSH_HEADER_PATTERNS = [
    'JOB SWITCHER',
    'NOTIFICATIONS',
    'HELP',
    'DAILY LOG',
    'TIME CLOCK',
    'TIME ENTRY',
    'ADD TIME',
    'CLOCK IN',
    'CLOCK OUT',
    'CLOCKED',
  ];

  function shouldPushContent(sidebar) {
    // Collect text from header-level elements only (not full body content)
    const headers = sidebar.querySelectorAll('h1, h2, h3, [class*="font-bold"], [class*="font-semibold"]');
    let headerText = '';
    for (const header of headers) {
      const text = (header.textContent || '').trim();
      if (text.length >= 2 && text.length <= 80) {
        headerText += ' ' + text;
      }
    }
    headerText = headerText.toUpperCase();

    // Check overlay exclusions first (takes priority)
    for (const pattern of OVERLAY_HEADER_PATTERNS) {
      if (headerText.includes(pattern)) return false;
    }

    // Check push patterns
    for (const pattern of PUSH_HEADER_PATTERNS) {
      if (headerText.includes(pattern)) return true;
    }

    return false;
  }

  /**
   * Create and inject the resize handle into a sidebar
   */
  function injectResizeHandle(sidebar) {
    // Skip if already enhanced (WeakSet prevents double-injection)
    if (enhancedSidebars.has(sidebar)) {
      return;
    }

    // Full-bypass: certain wide-table editor sidebars (Add / Edit Items, etc.)
    // need their natural full-bleed width and shouldn't be resized at all.
    // Mark them as enhanced so future mutation observers don't reconsider.
    if (shouldIgnoreSidebar(sidebar)) {
      enhancedSidebars.add(sidebar);
      return;
    }

    enhancedSidebars.add(sidebar);

    // Classify push vs overlay by sidebar content keywords
    if (shouldPushContent(sidebar)) {
      pushSidebars.add(sidebar);
    }

    // Detect sidebar type for per-sidebar width storage
    const sidebarType = getSidebarType(sidebar);

    // Create the resize handle element
    const resizeHandle = document.createElement('div');
    resizeHandle.className = 'jt-resize-handle';
    resizeHandle.dataset.sidebarType = sidebarType;
    resizeHandle.style.cssText = `
      position: absolute;
      left: 0;
      top: 0;
      bottom: 0;
      width: 6px;
      cursor: col-resize;
      background: transparent;
      z-index: 100;
      transition: background 0.15s ease;
    `;

    // Visual indicator on hover
    resizeHandle.addEventListener('mouseenter', () => {
      resizeHandle.style.background = 'rgba(0, 0, 0, 0.1)';
    });
    resizeHandle.addEventListener('mouseleave', () => {
      if (!resizeState.isResizing) {
        resizeHandle.style.background = 'transparent';
      }
    });

    // Start resize on mousedown
    resizeHandle.addEventListener('mousedown', (e) => {
      e.preventDefault();
      e.stopPropagation();
      startResize(e, sidebar, sidebarType);
    });

    // Insert the resize handle into the inner container (the one with bg-white)
    const innerContainer = sidebar.querySelector('.absolute.inset-0');
    if (innerContainer) {
      innerContainer.insertBefore(resizeHandle, innerContainer.firstChild);
    } else {
      sidebar.insertBefore(resizeHandle, sidebar.firstChild);
    }

    // Only apply a saved width if the user has previously resized this sidebar type
    // Otherwise leave it at its natural size so we don't break overlay sidebars
    const savedWidth = getSavedWidth(sidebarType);
    if (savedWidth !== null) {
      updateSidebarWidth(sidebar, savedWidth);
    }
  }

  /**
   * Update sidebar width and adjust main content area.
   * Push sidebars: adjusts padding-right on content to match new width.
   * Overlay sidebars: only changes sidebar width, never touches page layout.
   */
  function updateSidebarWidth(sidebar, newWidth) {
    // Remove max-width constraint that might interfere
    sidebar.style.maxWidth = 'none';
    sidebar.style.width = `${newWidth}px`;

    // Only adjust main content padding for push sidebars
    if (pushSidebars.has(sidebar)) {
      let foundPadding = false;

      // Strategy 1: Update existing inline padding-right on siblings
      const parent = sidebar.parentElement;
      if (parent) {
        for (const sibling of parent.children) {
          if (sibling === sidebar) continue;
          if (sibling.style.paddingRight) {
            sibling.style.paddingRight = `${newWidth}px`;
            foundPadding = true;
          }
        }
        if (parent.style.paddingRight) {
          parent.style.paddingRight = `${newWidth}px`;
          foundPadding = true;
        }
      }

      // Strategy 2: If JT hasn't set padding yet (e.g., Daily Logs),
      // apply padding to ALL visible sibling containers — this mimics how JT
      // natively pushes content for the Job Switcher (nav, headers, AND content)
      if (!foundPadding && parent) {
        for (const sibling of parent.children) {
          if (sibling === sidebar) continue;
          // Skip tiny or hidden elements
          if (sibling.offsetHeight < 10) continue;
          sibling.style.paddingRight = `${newWidth}px`;
          sibling.dataset.jtPushPadding = 'true';
          foundPadding = true;
        }
      }

      // Strategy 3: Update page-wide padding that matches sidebar width range,
      // plus any elements we manually padded via Strategy 2
      const elementsWithPadding = document.querySelectorAll('[style*="padding-right"], [data-jt-push-padding]');
      for (const el of elementsWithPadding) {
        if (el === sidebar || sidebar.contains(el)) continue;
        if (el.dataset.jtPushPadding) {
          el.style.paddingRight = `${newWidth}px`;
        } else {
          const currentPadding = parseInt(el.style.paddingRight, 10);
          if (currentPadding >= MIN_WIDTH && currentPadding <= getMaxWidth()) {
            el.style.paddingRight = `${newWidth}px`;
          }
        }
      }

      // Notify JT's layout to reflow (only for push sidebars)
      window.dispatchEvent(new Event('resize'));
    }

    // Force a reflow to ensure the width is applied
    void sidebar.offsetWidth;
  }

  /**
   * Clean up padding after a resized sidebar is removed from the DOM.
   * When JT closes a sidebar, it should reset padding itself — but if we changed
   * the padding values (for push sidebars), JT's cleanup may not match. This
   * ensures the page returns to its original boundaries.
   */
  function resetPaddingAfterClose(parentEl) {
    if (!parentEl) return;

    // Remove our padding overrides from siblings — JT will handle its own state
    for (const sibling of parentEl.children) {
      if (sibling.dataset.jtPushPadding) {
        sibling.style.paddingRight = '';
        delete sibling.dataset.jtPushPadding;
      } else {
        const pr = parseInt(sibling.style.paddingRight, 10);
        if (pr >= MIN_WIDTH && pr <= getMaxWidth()) {
          sibling.style.paddingRight = '';
        }
      }
    }

    // Clean up any elements we manually padded (Strategy 2 tracking)
    const manuallyPadded = document.querySelectorAll('[data-jt-push-padding]');
    for (const el of manuallyPadded) {
      // Only clear if there's no longer an active sidebar that owns this padding
      const activeSidebar = el.querySelector?.(SIDEBAR_SELECTOR) ||
                           el.parentElement?.querySelector?.(SIDEBAR_SELECTOR);
      if (!activeSidebar) {
        el.style.paddingRight = '';
        delete el.dataset.jtPushPadding;
      }
    }

    // Also clean up page-wide padding that we may have set
    const elementsWithPadding = document.querySelectorAll('[style*="padding-right"]');
    for (const el of elementsWithPadding) {
      if (el.dataset.jtPushPadding) continue; // Already handled above
      const pr = parseInt(el.style.paddingRight, 10);
      if (pr >= MIN_WIDTH && pr <= getMaxWidth()) {
        const activeSidebar = el.querySelector?.(SIDEBAR_SELECTOR) ||
                             el.parentElement?.querySelector?.(SIDEBAR_SELECTOR);
        if (!activeSidebar) {
          el.style.paddingRight = '';
        }
      }
    }
  }

  /**
   * Start the resize operation
   */
  function startResize(e, sidebar, sidebarType) {
    if (resizeState.isResizing) return;
    resizeState.isResizing = true;
    resizeState.startX = e.clientX;
    resizeState.startWidth = sidebar.offsetWidth;
    resizeState.activeSidebar = sidebar;
    resizeState.activeSidebarType = sidebarType;

    // Add global event listeners
    document.addEventListener('mousemove', handleResizeMove);
    document.addEventListener('mouseup', handleResizeEnd);

    // Prevent text selection during resize
    document.body.style.userSelect = 'none';
    document.body.style.cursor = 'col-resize';
  }

  /**
   * Handle mouse move during resize
   */
  function handleResizeMove(e) {
    if (!resizeState.isResizing || !resizeState.activeSidebar) return;

    const sidebar = resizeState.activeSidebar;

    // Check if the sidebar is still in the DOM
    if (!document.body.contains(sidebar)) {
      handleResizeEnd();
      return;
    }

    // Calculate new width (dragging left increases width since sidebar is on right)
    const deltaX = resizeState.startX - e.clientX;
    let newWidth = resizeState.startWidth + deltaX;

    // Clamp to min/max (max scales with viewport for ultrawide monitors)
    newWidth = Math.max(MIN_WIDTH, Math.min(getMaxWidth(), newWidth));

    // Apply new width and update main content
    updateSidebarWidth(sidebar, newWidth);
  }

  /**
   * End the resize operation
   */
  function handleResizeEnd() {
    if (!resizeState.isResizing) return;

    const sidebar = resizeState.activeSidebar;
    const sidebarType = resizeState.activeSidebarType;

    resizeState.isResizing = false;
    resizeState.activeSidebar = null;
    resizeState.activeSidebarType = null;

    // Remove global event listeners
    document.removeEventListener('mousemove', handleResizeMove);
    document.removeEventListener('mouseup', handleResizeEnd);

    // Restore normal cursor and selection
    document.body.style.userSelect = '';
    document.body.style.cursor = '';

    // Save the final width for this sidebar type
    if (sidebar && document.body.contains(sidebar) && sidebarType) {
      const finalWidth = sidebar.offsetWidth;
      saveWidth(sidebarType, finalWidth);

      // Reset resize handle visual
      const resizeHandle = sidebar.querySelector('.jt-resize-handle');
      if (resizeHandle) {
        resizeHandle.style.background = 'transparent';
      }
    }
  }

  /**
   * Start observing for sidebar appearances
   */
  function startSidebarObserver() {
    if (sidebarObserver) {
      return;
    }

    sidebarObserver = new MutationObserver((mutations) => {
      for (const mutation of mutations) {
        // Check for added nodes (sidebar opening)
        for (const node of mutation.addedNodes) {
          if (node.nodeType === Node.ELEMENT_NODE) {
            // Check if the added node is a sidebar or contains one
            const sidebar = node.matches?.(SIDEBAR_SELECTOR)
              ? node
              : node.querySelector?.(SIDEBAR_SELECTOR);

            if (sidebar) {
              // Small delay to ensure sidebar is fully rendered with header text
              setTimeout(() => {
                injectResizeHandle(sidebar);
              }, 50);
            }
          }
        }

        // Check for removed nodes (sidebar closing)
        // When a resized sidebar is removed, reset any padding we changed
        // so the page returns to its original layout
        for (const node of mutation.removedNodes) {
          if (node.nodeType === Node.ELEMENT_NODE) {
            const hadResizeHandle = node.querySelector?.('.jt-resize-handle') ||
                                   node.classList?.contains('jt-resize-handle');
            if (hadResizeHandle) {
              resetPaddingAfterClose(mutation.target);
            }
          }
        }
      }
    });

    sidebarObserver.observe(document.body, {
      childList: true,
      subtree: true
    });

    // Also check for any existing sidebars on the page
    const existingSidebars = document.querySelectorAll(SIDEBAR_SELECTOR);
    for (const sidebar of existingSidebars) {
      injectResizeHandle(sidebar);
    }
  }

  /**
   * Stop observing for sidebar appearances
   */
  function stopSidebarObserver() {
    if (sidebarObserver) {
      sidebarObserver.disconnect();
      sidebarObserver = null;
    }
  }

  /**
   * Check if the current viewport is mobile-sized
   * Quick Job Switcher is keyboard-driven and doesn't work well on mobile
   */
  function isMobileViewport() {
    return window.innerWidth <= 768;
  }

  /**
   * Initialize the feature
   */
  function init() {
    if (isActive) {
      return;
    }

    // Disable on mobile viewports - keyboard-driven feature doesn't work well on mobile
    if (isMobileViewport()) {
      console.log('SmartJobSwitcher: Disabled on mobile viewport');
      return;
    }

    isActive = true;

    // Migrate old storage (one-time, async, non-blocking)
    migrateOldStorage();

    // Listen for keyboard shortcuts
    document.addEventListener('keydown', handleKeyDown, true);
    document.addEventListener('keyup', handleKeyUp, true);

    // Start observing for sidebars to add resize handles
    startSidebarObserver();

    console.log('SmartJobSwitcher: Activated');
  }

  /**
   * Cleanup the feature
   */
  function cleanup() {
    if (!isActive) {
      return;
    }

    isActive = false;
    jKeyPressed = false;

    document.removeEventListener('keydown', handleKeyDown, true);
    document.removeEventListener('keyup', handleKeyUp, true);
    document.removeEventListener('mousemove', handleResizeMove);
    document.removeEventListener('mouseup', handleResizeEnd);

    // Stop sidebar observer
    stopSidebarObserver();

    // Clean up any active resize state
    if (resizeState.isResizing) {
      handleResizeEnd();
    }

    closeSidebar();

    console.log('SmartJobSwitcher: Deactivated');
  }

  /**
   * Handle keydown events
   */
  function handleKeyDown(e) {
    const key = e.key.toLowerCase();

    // Don't track J key if sidebar is already open (prevents interference with typing)
    if (!isSearchOpen && !e.ctrlKey && !e.altKey && !e.metaKey && key === 'j') {
      jKeyPressed = true;
    }

    // Open sidebar: J+S (both keys pressed together) or ALT+J
    const isJSShortcut = jKeyPressed && !e.ctrlKey && !e.altKey && !e.metaKey && key === 's';
    const isAltJShortcut = e.altKey && !e.ctrlKey && !e.metaKey && key === 'j';

    if (isJSShortcut || isAltJShortcut) {
      // Check if sidebar actually exists (user may have manually closed it)
      const sidebar = document.querySelector('div.z-30.absolute.top-0.bottom-0.right-0');

      if (!sidebar) {
        // Sidebar doesn't exist, reset state and allow opening
        isSearchOpen = false;
      }

      if (!isSearchOpen) {
        e.preventDefault();
        e.stopPropagation();
        // Reset J key state immediately after opening
        jKeyPressed = false;
        openSidebar();
      }
      return;
    }

    // If the Job Switcher sidebar is open (regardless of who opened it) and
    // Enter is pressed, select top job and close. We check DOM presence
    // rather than isSearchOpen because the user may have opened the sidebar
    // by clicking the job name directly — in that path our code never runs
    // and isSearchOpen stays false. Scoped to the Job Switcher specifically
    // so Enter inside other sidebars (e.g., Custom Field Filter) is unaffected.
    if (e.key === 'Enter') {
      const jobSwitcherSidebar = findJobSwitcherSidebar();
      if (jobSwitcherSidebar) {
        const searchInput = jobSwitcherSidebar.querySelector('input[placeholder*="Search"]') ||
                           jobSwitcherSidebar.querySelector('input[type="text"]') ||
                           jobSwitcherSidebar.querySelector('input');

        const activeEl = document.activeElement;
        const isInSidebar = jobSwitcherSidebar.contains(activeEl);

        if ((searchInput && activeEl === searchInput) || isInSidebar) {
          e.preventDefault();
          e.stopPropagation();
          selectTopJobAndClose();
          return;
        }
      }
    }

    // Close sidebar on Escape — scoped to the Job Switcher sidebar only so
    // other sidebars handle their own Escape behavior.
    if (e.key === 'Escape' && findJobSwitcherSidebar()) {
      e.preventDefault();
      e.stopPropagation();
      closeSidebar();
      return;
    }
  }

  /**
   * Handle keyup events
   */
  function handleKeyUp(e) {
    const key = e.key.toLowerCase();

    // Reset J key state when released
    if (key === 'j') {
      jKeyPressed = false;
    }
  }

  /**
   * Open the job switcher sidebar
   */
  function openSidebar() {
    // Find the job number button - try multiple selectors
    let jobNumberButton = null;

    // Strategy 1: Look for the specific structure
    jobNumberButton = document.querySelector('.font-bold.text-2xl div[role="button"]');

    // Strategy 2: Look for any button with "Job" text
    if (!jobNumberButton) {
      const buttons = document.querySelectorAll('div[role="button"]');
      for (const btn of buttons) {
        if (btn.textContent.includes('Job ')) {
          jobNumberButton = btn;
          break;
        }
      }
    }

    // Strategy 3: Look for text-2xl class with Job text
    if (!jobNumberButton) {
      const elements = document.querySelectorAll('.text-2xl');
      for (const el of elements) {
        if (el.textContent.includes('Job ')) {
          const button = el.querySelector('div[role="button"]');
          if (button) {
            jobNumberButton = button;
            break;
          }
        }
      }
    }

    if (!jobNumberButton) {
      showErrorNotification('Could not find job switcher button. Make sure you\'re on a job page.');
      return;
    }

    // Click to open sidebar
    jobNumberButton.click();
    isSearchOpen = true;

    // Focus the search input after a short delay to let sidebar render
    setTimeout(() => {
      const searchInput = document.querySelector('div.z-30.absolute input[placeholder*="Search"]') ||
                         document.querySelector('div.z-30.absolute input[type="text"]') ||
                         document.querySelector('div.z-30 input');

      if (searchInput) {
        searchInput.focus();
      }
    }, 150);
  }

  /**
   * Close the job switcher sidebar
   */
  function closeSidebar() {
    // Find the sidebar
    const sidebar = document.querySelector('div.z-30.absolute.top-0.bottom-0.right-0');
    if (!sidebar) {
      // Nothing to close — reset our flag in case it drifted out of sync
      isSearchOpen = false;
      return;
    }

    // Strategy 1: Find the close button by looking for X icon or Close text
    const allButtons = sidebar.querySelectorAll('div[role="button"]');
    let closeButton = null;

    for (const button of allButtons) {
      const text = button.textContent.trim();
      // Look for close button indicators
      if (text === 'Close' || text === '×' || text === 'X') {
        closeButton = button;
        break;
      }
      // Check for X icon SVG (close icon typically has M18 6 or similar path for X shape)
      const svg = button.querySelector('svg');
      if (svg) {
        const paths = svg.querySelectorAll('path');
        for (const path of paths) {
          const d = path.getAttribute('d') || '';
          // Common X/close icon path patterns
          if (d.includes('M18 6') || d.includes('m18 6') ||
              d.includes('M6 18') || d.includes('m6 18') ||
              (d.includes('18') && d.includes('6') && d.length < 50)) {
            closeButton = button;
            break;
          }
        }
        if (closeButton) break;
      }
    }

    if (closeButton) {
      closeButton.click();
    } else {
      // Strategy 2: Try clicking outside the sidebar (on the overlay)
      const overlay = document.querySelector('div.z-30.absolute.inset-0:not(.top-0)') ||
                     document.querySelector('div.z-20.fixed.inset-0') ||
                     document.querySelector('[class*="backdrop"]') ||
                     document.querySelector('[class*="overlay"]');
      if (overlay) {
        overlay.click();
      } else {
        // Strategy 3: Dispatch Escape key to close
        const escEvent = new KeyboardEvent('keydown', {
          key: 'Escape',
          code: 'Escape',
          keyCode: 27,
          which: 27,
          bubbles: true,
          cancelable: true
        });
        sidebar.dispatchEvent(escEvent);
        document.dispatchEvent(escEvent);
      }
    }

    isSearchOpen = false;
  }

  /**
   * Select the currently highlighted job (or top job) and close sidebar
   */
  function selectTopJobAndClose() {
    // Find the sidebar
    const sidebar = document.querySelector('div.z-30.absolute.top-0.bottom-0.right-0');
    if (!sidebar) {
      closeSidebar();
      return;
    }

    let selectedButton = null;

    // Strategy 1: Check for visually highlighted items (arrow key navigation uses visual highlighting)
    const allJobButtons = sidebar.querySelectorAll('div[role="button"]');

    for (const button of allJobButtons) {
      const text = button.textContent.trim();
      // Skip non-job items (close button, header, etc.)
      if (text === 'Close' || text === '×' || text === 'X' ||
          text.includes('Job Switcher') ||
          button.querySelector('path[d*="M18 6"]') ||
          button.querySelector('path[d*="M6 18"]')) {
        continue;
      }

      // Check for highlight indicators
      const classList = button.className || '';
      const hasHighlight = classList.includes('bg-blue-') ||
                          classList.includes('bg-cyan-') ||
                          classList.includes('bg-gray-100') ||
                          classList.includes('bg-gray-200') ||
                          classList.includes('highlighted') ||
                          classList.includes('selected') ||
                          classList.includes('active') ||
                          classList.includes('focus') ||
                          button.getAttribute('aria-selected') === 'true' ||
                          button.getAttribute('data-highlighted') === 'true' ||
                          button.getAttribute('data-selected') === 'true' ||
                          button.matches(':focus') ||
                          button.matches(':focus-visible');

      if (hasHighlight) {
        selectedButton = button;
        break;
      }
    }

    // Strategy 2: Check if there's a currently focused element that's a job
    if (!selectedButton) {
      const activeElement = document.activeElement;

      if (activeElement &&
          sidebar.contains(activeElement) &&
          activeElement.getAttribute('role') === 'button' &&
          activeElement.tagName !== 'INPUT') {
        const text = activeElement.textContent.trim();
        if (text !== 'Close' && text !== '×' && text !== 'X' &&
            !text.includes('Job Switcher') &&
            !activeElement.querySelector('path[d*="M18 6"]')) {
          selectedButton = activeElement;
        }
      }
    }

    // Strategy 3: Fall back to finding the top job in the list
    if (!selectedButton) {
      const jobList = sidebar.querySelector('.overflow-y-auto') || sidebar;
      const jobButtons = jobList.querySelectorAll('div[role="button"][tabindex="0"]');

      for (const button of jobButtons) {
        const text = button.textContent.trim();

        if (text === 'Close' || text === '×' || text === 'X' ||
            button.querySelector('path[d*="M18 6"]') ||
            button.querySelector('path[d*="M6 18"]')) {
          continue;
        }

        if (text.includes('Job Switcher')) {
          continue;
        }

        if (text.length < 3) {
          continue;
        }

        selectedButton = button;
        break;
      }
    }

    if (selectedButton) {
      selectedButton.click();
      setTimeout(() => {
        closeSidebar();
      }, 100);
    } else {
      closeSidebar();
    }
  }

  /**
   * Show error notification
   */
  function showErrorNotification(message) {
    const notification = document.createElement('div');
    notification.style.cssText = `
      position: fixed;
      top: 20px;
      right: 20px;
      background: #ef4444;
      color: white;
      padding: 12px 16px;
      border-radius: 6px;
      box-shadow: 0 4px 12px rgba(0,0,0,0.2);
      z-index: 999999;
      font-size: 13px;
      max-width: 300px;
    `;
    notification.textContent = message;
    document.body.appendChild(notification);

    setTimeout(() => {
      notification.remove();
    }, 3000);
  }

  // Public API
  return {
    init,
    cleanup,
    isActive: () => isActive
  };
})();

// Export for use in main content script
if (typeof window !== 'undefined') {
  window.SmartJobSwitcherFeature = SmartJobSwitcherFeature;
}
