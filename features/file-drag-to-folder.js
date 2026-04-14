/**
 * Files Drag to Folder Feature
 * Allows dragging files onto folder buttons to organize them.
 * Simulates the manual workflow: select file → open sidebar → set folder dropdown.
 * Supports both list view and grid view on the JobTread files page.
 */
const FileDragToFolderFeature = (() => {
  let isActiveState = false;
  let observer = null;
  let debounceTimer = null;
  let styleElement = null;
  let operationInProgress = false;
  let failsafeTimeout = null;

  // WeakSets to track enhanced elements (prevent duplicate handlers)
  const enhancedFiles = new WeakSet();
  const enhancedFolders = new WeakSet();

  // State for current drag operation
  let dragState = {
    draggedFileElement: null,
    sourceView: null, // 'list' or 'grid'
    didDrag: false // Flag to suppress click after drag
  };

  // Timing constants (ms)
  const DEBOUNCE_DELAY = 300;
  const SIDEBAR_OPEN_DELAY = 600;
  const DROPDOWN_OPEN_DELAY = 400;
  const OPTION_SELECT_DELAY = 300;
  const SELECTION_MODE_DELAY = 300;
  const FAILSAFE_TIMEOUT = 8000;

  // Folder SVG path data for reliable detection
  // JobTread uses this path for the folder icon
  const FOLDER_SVG_PATH = 'M20 20a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.69-.9L9.6 3.9A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2z';

  // ===== Lifecycle =====

  function init() {
    if (isActiveState) return;
    isActiveState = true;
    console.log('FileDragToFolder: Initializing...');

    injectStyles();
    setupObserver();
    enhanceFilesPage();

    console.log('FileDragToFolder: Initialized');
  }

  function cleanup() {
    if (!isActiveState) return;
    console.log('FileDragToFolder: Cleaning up...');

    isActiveState = false;

    // Disconnect observer
    if (observer) {
      observer.disconnect();
      observer = null;
    }

    // Clear timers
    if (debounceTimer) {
      clearTimeout(debounceTimer);
      debounceTimer = null;
    }
    if (failsafeTimeout) {
      clearTimeout(failsafeTimeout);
      failsafeTimeout = null;
    }

    // Remove styles
    removeStyles();

    // Clean up enhanced elements
    cleanupEnhancedElements();

    // Reset operation state
    operationInProgress = false;

    console.log('FileDragToFolder: Cleaned up');
  }

  // ===== Observer =====

  function setupObserver() {
    observer = new MutationObserver(() => {
      if (!isActiveState) return;
      if (debounceTimer) clearTimeout(debounceTimer);
      debounceTimer = setTimeout(() => {
        enhanceFilesPage();
      }, DEBOUNCE_DELAY);
    });

    observer.observe(document.body, {
      childList: true,
      subtree: true
    });
  }

  // ===== Detection =====

  /**
   * Detect if we're on a files page by looking for folder buttons in the toolbar.
   * Returns the toolbar container element or null.
   */
  function findFilesToolbar() {
    // Look for folder buttons — they have a folder SVG icon
    const folderButtons = findFolderButtons();
    if (folderButtons.length > 0) {
      return folderButtons[0].parentElement;
    }
    return null;
  }

  /**
   * Detect view type: 'list' or 'grid'
   */
  function detectViewType() {
    // Grid view has a "Select Files" button or grid layout with file cards
    const selectFilesBtn = findSelectFilesButton();
    if (selectFilesBtn) return 'grid';

    // List view has file rows with sticky left column checkboxes
    const listCheckbox = document.querySelector('div.shrink-0.sticky.z-10.px-1.py-2');
    if (listCheckbox) return 'list';

    return null;
  }

  /**
   * Find all folder buttons on the page.
   * Uses SVG-first detection: find folder icon SVGs, then walk up to container.
   * Handles both grid/toolbar view (div[role="button"]) and list view (div.shrink-0.p-2).
   */
  function findFolderButtons() {
    const allPaths = document.querySelectorAll('svg path');
    const folders = [];
    const seen = new WeakSet();

    for (const path of allPaths) {
      const d = path.getAttribute('d');
      if (!d || !d.includes('M20 20') || !d.includes('2 2 0 0 0 2 2Z')) continue;

      // Walk up from SVG to find the folder container
      const svg = path.closest('svg');
      if (!svg) continue;

      // The folder container is the outermost clickable/hoverable wrapper
      // div[role="button"] for grid/toolbar view, div.shrink-0.p-2 for list view
      const container = svg.closest('div[role="button"]') ||
                        svg.closest('div.shrink-0.p-2') ||
                        svg.closest('div.hover\\:bg-gray-50');
      if (!container || seen.has(container)) continue;

      // Verify it has a folder name text
      const nameEl = container.querySelector('div.truncate') || container.querySelector('div');
      if (nameEl && nameEl.textContent.trim()) {
        folders.push(container);
        seen.add(container);
      }
    }

    return folders;
  }

  /**
   * Find file elements based on view type.
   * List view: file rows in the table
   * Grid view: file cards in the grid
   */
  function findFileElements(viewType) {
    if (viewType === 'list') {
      return findListViewFiles();
    } else if (viewType === 'grid') {
      return findGridViewFiles();
    }
    return [];
  }

  /**
   * Find file rows in list view.
   * Each file row has a sticky checkbox column: div.shrink-0.sticky.z-10.px-1.py-2
   */
  function findListViewFiles() {
    const checkboxCells = document.querySelectorAll('div.shrink-0.sticky.z-10.px-1.py-2');
    const fileRows = [];

    for (const cell of checkboxCells) {
      // The file row is the parent container that holds both the checkbox and file data
      // Walk up to find the row-level container
      const row = cell.parentElement;
      if (row && !enhancedFiles.has(row)) {
        fileRows.push(row);
      }
    }

    return fileRows;
  }

  /**
   * Find file cards in grid view.
   * Grid file cards are typically in a grid/flex container with thumbnails.
   */
  function findGridViewFiles() {
    // Grid view files are typically div elements with images/thumbnails
    // Look for the grid container which often has grid or flex layout with file cards
    const gridContainers = document.querySelectorAll('div.grid, div.flex.flex-wrap');
    const fileCards = [];

    for (const container of gridContainers) {
      const cards = container.querySelectorAll(':scope > div[role="button"], :scope > div.relative.cursor-pointer');
      for (const card of cards) {
        // Verify it's a file card (has an image or file icon)
        const hasImage = card.querySelector('img') || card.querySelector('svg');
        if (hasImage && !enhancedFiles.has(card)) {
          fileCards.push(card);
        }
      }
    }

    return fileCards;
  }

  /**
   * Find the "Select Files" button (grid view only).
   */
  function findSelectFilesButton() {
    const buttons = document.querySelectorAll('div[role="button"]');
    for (const btn of buttons) {
      if (btn.textContent.trim().includes('Select Files')) {
        return btn;
      }
    }
    return null;
  }

  /**
   * Find the "Edit File" button (grid view only).
   */
  function findEditFileButton() {
    const buttons = document.querySelectorAll('div[role="button"]');
    for (const btn of buttons) {
      const text = btn.textContent.trim();
      if (text.includes('Edit') && text.includes('File')) {
        return btn;
      }
    }
    return null;
  }

  /**
   * Check if grid view is in selection mode (checkboxes visible on cards).
   */
  function isInSelectionMode() {
    // When in selection mode, file cards have visible checkboxes
    // The "Select Files" button may change appearance or a "Cancel" button appears
    const editBtn = findEditFileButton();
    return !!editBtn; // Edit File button only appears when in selection mode
  }

  // ===== Enhancement =====

  /**
   * Main entry point — enhance the files page with drag/drop capabilities.
   */
  function enhanceFilesPage() {
    if (!isActiveState) return;

    const folderButtons = findFolderButtons();
    if (folderButtons.length === 0) return; // Not on a files page

    const viewType = detectViewType();
    if (!viewType) return;

    // Make folders droppable
    makeFoldersDroppable(folderButtons);

    // Make files draggable
    makeFilesDraggable(viewType);
  }

  /**
   * Make file elements draggable.
   */
  function makeFilesDraggable(viewType) {
    const files = findFileElements(viewType);

    for (const file of files) {
      if (enhancedFiles.has(file)) continue;

      file.setAttribute('draggable', 'true');
      file.setAttribute('data-jt-file-draggable', 'true');

      const onDragStart = (e) => handleFileDragStart(e, file, viewType);
      const onDragEnd = (e) => handleFileDragEnd(e, file);

      // Suppress click event that fires after drag to prevent file from opening
      const onClick = (e) => {
        if (dragState.didDrag) {
          e.preventDefault();
          e.stopImmediatePropagation();
          dragState.didDrag = false;
        }
      };

      file.addEventListener('dragstart', onDragStart);
      file.addEventListener('dragend', onDragEnd);
      file.addEventListener('click', onClick, true); // capturing phase

      // Store handlers for cleanup
      file._jtDragHandlers = { onDragStart, onDragEnd, onClick };
      enhancedFiles.add(file);
    }
  }

  /**
   * Make folder buttons droppable.
   */
  function makeFoldersDroppable(folderButtons) {
    for (const folder of folderButtons) {
      if (enhancedFolders.has(folder)) continue;

      const onDragOver = (e) => handleFolderDragOver(e);
      const onDragEnter = (e) => handleFolderDragEnter(e, folder);
      const onDragLeave = (e) => handleFolderDragLeave(e, folder);
      const onDrop = (e) => handleFolderDrop(e, folder);

      folder.addEventListener('dragover', onDragOver);
      folder.addEventListener('dragenter', onDragEnter);
      folder.addEventListener('dragleave', onDragLeave);
      folder.addEventListener('drop', onDrop);

      folder.setAttribute('data-jt-folder-droppable', 'true');

      // Store handlers for cleanup
      folder._jtDropHandlers = { onDragOver, onDragEnter, onDragLeave, onDrop };
      enhancedFolders.add(folder);
    }
  }

  // ===== Drag Event Handlers =====

  function handleFileDragStart(e, fileElement, viewType) {
    dragState.draggedFileElement = fileElement;
    dragState.sourceView = viewType;
    dragState.didDrag = true;

    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', 'jt-file-drag');

    // Visual feedback — reduce opacity
    fileElement.style.opacity = '0.5';

    // Create custom drag ghost
    const ghost = createDragGhost();
    document.body.appendChild(ghost);
    e.dataTransfer.setDragImage(ghost, 0, 0);

    // Remove ghost after drag image is captured
    requestAnimationFrame(() => {
      ghost.remove();
    });
  }

  function handleFileDragEnd(e, fileElement) {
    fileElement.style.opacity = '';
    dragState.draggedFileElement = null;
    dragState.sourceView = null;

    // Safety: clear didDrag after a tick in case click event doesn't fire
    setTimeout(() => { dragState.didDrag = false; }, 100);

    // Remove any lingering drop highlights
    document.querySelectorAll('.jt-folder-drop-active').forEach(el => {
      el.classList.remove('jt-folder-drop-active');
    });
  }

  function handleFolderDragOver(e) {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
  }

  function handleFolderDragEnter(e, folderButton) {
    e.preventDefault();
    folderButton.classList.add('jt-folder-drop-active');
  }

  function handleFolderDragLeave(e, folderButton) {
    // Only remove highlight if actually leaving the folder button
    // (not just moving between child elements)
    const relatedTarget = e.relatedTarget;
    if (!folderButton.contains(relatedTarget)) {
      folderButton.classList.remove('jt-folder-drop-active');
    }
  }

  function handleFolderDrop(e, folderButton) {
    e.preventDefault();
    e.stopPropagation();

    // Remove drop highlight
    folderButton.classList.remove('jt-folder-drop-active');

    // Verify this is our drag data
    const data = e.dataTransfer.getData('text/plain');
    if (data !== 'jt-file-drag') return;

    if (!dragState.draggedFileElement) {
      console.warn('FileDragToFolder: No dragged file element');
      return;
    }

    if (operationInProgress) {
      if (window.UIUtils) {
        window.UIUtils.showNotification('Move operation already in progress');
      }
      return;
    }

    // Get target folder name — handle both list view (div.truncate) and grid view (first div)
    const folderNameEl = folderButton.querySelector('div.truncate') || folderButton.querySelector('div');
    const folderName = folderNameEl ? folderNameEl.textContent.trim() : '';
    if (!folderName) {
      console.error('FileDragToFolder: Could not determine folder name');
      return;
    }

    console.log(`FileDragToFolder: Moving file to folder "${folderName}" (${dragState.sourceView} view)`);

    // Start the move operation
    moveFilesToFolder(folderName, dragState.draggedFileElement, dragState.sourceView);
  }

  // ===== Core Move Operation =====

  /**
   * Poll for a sidebar element to appear in the DOM.
   * Checks every 200ms up to FAILSAFE_TIMEOUT.
   * @param {Function} callback - Called with the sidebar element when found
   */
  function waitForSidebar(callback) {
    const POLL_INTERVAL = 200;
    let elapsed = 0;

    const poller = setInterval(() => {
      elapsed += POLL_INTERVAL;

      // Try multiple selectors — the files sidebar may differ from schedule sidebar
      const sidebar = document.querySelector('div.overflow-y-auto.overscroll-contain.sticky') ||
                      document.querySelector('[data-is-drag-scroll-boundary="true"] .overflow-y-auto');

      // Also check for the "Folder" label directly as a sign the files sidebar is open
      if (!sidebar) {
        const folderLabels = document.querySelectorAll('span.font-bold');
        for (const label of folderLabels) {
          if (label.textContent.trim() === 'Folder') {
            const sidebarEl = label.closest('div.overflow-y-auto') ||
                             label.closest('[data-is-drag-scroll-boundary="true"]') ||
                             label.closest('div.sticky');
            if (sidebarEl) {
              clearInterval(poller);
              console.log('FileDragToFolder: Sidebar found via Folder label');
              callback(sidebarEl);
              return;
            }
          }
        }
      }

      if (sidebar) {
        clearInterval(poller);
        console.log('FileDragToFolder: Sidebar found');
        callback(sidebar);
        return;
      }

      if (elapsed >= FAILSAFE_TIMEOUT) {
        clearInterval(poller);
        resetOperation('Sidebar did not open');
      }
    }, POLL_INTERVAL);
  }

  /**
   * Move a file to a folder by simulating UI clicks.
   * @param {string} folderName - Target folder name
   * @param {HTMLElement} fileElement - The file row/card element
   * @param {string} viewType - 'list' or 'grid'
   */
  function moveFilesToFolder(folderName, fileElement, viewType) {
    operationInProgress = true;

    // Set failsafe timeout
    failsafeTimeout = setTimeout(() => {
      console.error('FileDragToFolder: Operation timed out');
      resetOperation('Move operation timed out');
    }, FAILSAFE_TIMEOUT);

    if (viewType === 'list') {
      moveFileListView(folderName, fileElement);
    } else if (viewType === 'grid') {
      moveFileGridView(folderName, fileElement);
    }
  }

  /**
   * Move a file in list view.
   * Flow: click checkbox → sidebar opens → set folder → close sidebar
   */
  function moveFileListView(folderName, fileElement) {
    // Step 1: Find and click the file's checkbox
    const checkbox = findFileCheckbox(fileElement);
    if (!checkbox) {
      resetOperation('Could not find file checkbox');
      return;
    }

    checkbox.click();

    // Step 2: Poll for sidebar to appear (don't hide it upfront — let it render first)
    waitForSidebar(() => {
      setFolderInSidebar(folderName);
    });
  }

  /**
   * Move a file in grid view.
   * Flow: Select Files → check file → Edit File → sidebar opens → set folder → close sidebar
   */
  function moveFileGridView(folderName, fileElement) {
    // Step 1: Enter selection mode if needed
    if (!isInSelectionMode()) {
      const selectBtn = findSelectFilesButton();
      if (!selectBtn) {
        resetOperation('Could not find Select Files button');
        return;
      }
      selectBtn.click();

      // Wait for selection mode to activate
      setTimeout(() => {
        continueGridViewMove(folderName, fileElement);
      }, SELECTION_MODE_DELAY);
    } else {
      continueGridViewMove(folderName, fileElement);
    }
  }

  /**
   * Continue grid view move after entering selection mode.
   */
  function continueGridViewMove(folderName, fileElement) {
    // Step 2: Click file's checkbox on the card
    const checkbox = findGridFileCheckbox(fileElement);
    if (!checkbox) {
      resetOperation('Could not find grid file checkbox');
      return;
    }
    checkbox.click();

    // Step 3: Click "Edit File" button
    setTimeout(() => {
      const editBtn = findEditFileButton();
      if (!editBtn) {
        resetOperation('Could not find Edit File button');
        return;
      }
      editBtn.click();

      // Step 4: Poll for sidebar, then set folder
      waitForSidebar(() => {
        setFolderInSidebar(folderName);
      });
    }, SELECTION_MODE_DELAY);
  }

  /**
   * Find and set the folder in the sidebar dropdown.
   * This is the shared final step for both list and grid view.
   */
  function setFolderInSidebar(folderName) {
    // Find the Folder dropdown — search broadly since the files sidebar
    // may have a different structure than the schedule sidebar
    const folderDropdown = findSidebarFolderDropdown();
    if (!folderDropdown) {
      closeSidebarAndReset('Could not find Folder dropdown in sidebar');
      return;
    }

    // Click the dropdown to open it
    folderDropdown.click();

    // Wait for dropdown options to appear
    setTimeout(() => {
      selectDropdownOption(folderName);
    }, DROPDOWN_OPEN_DELAY);
  }

  /**
   * Find the Folder dropdown control in the sidebar.
   * Searches the entire document for the "Folder" label and its associated dropdown.
   * The files sidebar may have different structure than the schedule sidebar.
   */
  function findSidebarFolderDropdown() {
    // Strategy 1: Look for any element whose text is exactly "Folder"
    // and find an adjacent/parent dropdown control
    const allElements = document.querySelectorAll('span, label, div');
    for (const el of allElements) {
      // Only match leaf-level text nodes containing exactly "Folder"
      if (el.childElementCount > 0) continue;
      const text = el.textContent.trim();
      if (text !== 'Folder') continue;

      // Found a "Folder" label — look for the dropdown nearby
      // Walk up to find the container, then look for sibling/child dropdown elements
      let searchScope = el.parentElement;
      for (let depth = 0; depth < 3 && searchScope; depth++) {
        // Check for <select> element
        const select = searchScope.querySelector('select');
        if (select) return select;

        // Check for custom dropdown (div with role="button" or cursor-pointer)
        const customDropdown = searchScope.querySelector('div[role="button"]') ||
                              searchScope.querySelector('div[role="listbox"]') ||
                              searchScope.querySelector('div.cursor-pointer');
        if (customDropdown && customDropdown !== el) return customDropdown;

        searchScope = searchScope.parentElement;
      }
    }

    return null;
  }

  /**
   * Select a folder option from the opened dropdown.
   */
  function selectDropdownOption(folderName) {
    // The dropdown list is typically rendered as a portal/overlay
    // Look for dropdown options in the entire document
    const options = document.querySelectorAll('div[role="option"], div[role="listbox"] > div, ul > li');

    for (const option of options) {
      const text = option.textContent.trim();
      if (text === folderName) {
        option.click();
        console.log(`FileDragToFolder: Selected folder "${folderName}"`);

        // Wait for selection to register, then close sidebar
        setTimeout(() => {
          closeSidebarAndFinish(folderName);
        }, OPTION_SELECT_DELAY);
        return;
      }
    }

    // If dropdown options aren't role="option", try other patterns
    // JT may use a custom dropdown with clickable divs
    const dropdownLists = document.querySelectorAll('div.absolute, div.fixed, div[class*="dropdown"], div[class*="menu"]');
    for (const list of dropdownLists) {
      const items = list.querySelectorAll('div[role="button"], div.cursor-pointer, div.hover\\:bg-gray-100');
      for (const item of items) {
        if (item.textContent.trim() === folderName) {
          item.click();
          console.log(`FileDragToFolder: Selected folder "${folderName}" (alt pattern)`);

          setTimeout(() => {
            closeSidebarAndFinish(folderName);
          }, OPTION_SELECT_DELAY);
          return;
        }
      }
    }

    closeSidebarAndReset(`Could not find folder option "${folderName}"`);
  }

  // ===== Sidebar Close & Cleanup =====

  /**
   * Close the files sidebar by finding and clicking the Close button.
   * Falls back to SidebarManager if our search doesn't find it.
   * @param {Function} callback - Called after sidebar closes
   */
  function closeFilesSidebar(callback) {
    // Clear failsafe since we're handling cleanup
    if (failsafeTimeout) {
      clearTimeout(failsafeTimeout);
      failsafeTimeout = null;
    }

    // Try to find Close button anywhere on the page
    const allButtons = document.querySelectorAll('div[role="button"], button');
    let closeBtn = null;
    for (const btn of allButtons) {
      const text = btn.textContent.trim();
      if (text === 'Close' || text === '× Close' || text === 'X Close') {
        closeBtn = btn;
        break;
      }
    }

    if (closeBtn) {
      closeBtn.click();
      // Wait for sidebar to close before calling back
      setTimeout(() => {
        if (callback) callback();
      }, 500);
    } else if (window.SidebarManager) {
      // Fallback to SidebarManager
      window.SidebarManager.closeSidebar(null, callback);
    } else {
      if (callback) callback();
    }
  }

  /**
   * Close sidebar and show success notification.
   */
  function closeSidebarAndFinish(folderName) {
    closeFilesSidebar(() => {
      operationInProgress = false;
      if (window.UIUtils) {
        window.UIUtils.showNotification(`Moved to "${folderName}"`);
      }
      console.log(`FileDragToFolder: Successfully moved file to "${folderName}"`);
    });
  }

  /**
   * Close sidebar and show error notification.
   */
  function closeSidebarAndReset(errorMessage) {
    console.error(`FileDragToFolder: ${errorMessage}`);
    closeFilesSidebar(() => {
      operationInProgress = false;
      if (window.UIUtils && errorMessage) {
        window.UIUtils.showNotification(errorMessage);
      }
    });
  }

  /**
   * Reset operation state and clean up (failsafe / error path).
   */
  function resetOperation(errorMessage) {
    if (failsafeTimeout) {
      clearTimeout(failsafeTimeout);
      failsafeTimeout = null;
    }

    operationInProgress = false;

    if (window.SidebarManager) {
      window.SidebarManager.removeSidebarCSS();
    }

    if (errorMessage && window.UIUtils) {
      window.UIUtils.showNotification(errorMessage);
    }
  }

  // ===== Checkbox Helpers =====

  /**
   * Find the checkbox element for a list view file row.
   */
  function findFileCheckbox(fileRow) {
    // The checkbox is in the sticky left column
    const checkboxCell = fileRow.querySelector('div.shrink-0.sticky.z-10.px-1.py-2');
    if (checkboxCell) {
      // Find the clickable checkbox element (role="button" or the SVG container)
      const clickable = checkboxCell.querySelector('div[role="button"]') ||
                       checkboxCell.querySelector('div.cursor-pointer') ||
                       checkboxCell;
      return clickable;
    }
    return null;
  }

  /**
   * Find the checkbox element for a grid view file card.
   */
  function findGridFileCheckbox(fileCard) {
    // In selection mode, cards have checkboxes (usually in a corner)
    const checkbox = fileCard.querySelector('div[role="button"]') ||
                    fileCard.querySelector('input[type="checkbox"]') ||
                    fileCard.querySelector('div.absolute');
    return checkbox;
  }

  // ===== Drag Ghost =====

  /**
   * Create a custom drag ghost element.
   */
  function createDragGhost() {
    const ghost = document.createElement('div');
    ghost.className = 'jt-file-drag-ghost';
    ghost.textContent = '📁 Move to folder';
    ghost.style.cssText = `
      position: absolute;
      top: -9999px;
      left: -9999px;
      display: inline-flex;
      align-items: center;
      gap: 6px;
      padding: 6px 12px;
      background: rgb(59, 130, 246);
      color: white;
      border-radius: 6px;
      font-size: 12px;
      font-weight: 600;
      box-shadow: 0 2px 8px rgba(0, 0, 0, 0.2);
      pointer-events: none;
      white-space: nowrap;
    `;
    return ghost;
  }

  // ===== Styles =====

  function injectStyles() {
    if (styleElement) return;

    styleElement = document.createElement('style');
    styleElement.id = 'jt-file-drag-to-folder-styles';
    styleElement.textContent = `
      /* Folder drop zone highlight */
      .jt-folder-drop-active {
        border: 2px dashed rgb(59, 130, 246) !important;
        background-color: rgba(59, 130, 246, 0.1) !important;
        border-radius: 6px !important;
        transition: all 0.15s ease !important;
      }

      /* Draggable file cursor */
      [data-jt-file-draggable="true"] {
        cursor: grab !important;
      }
      [data-jt-file-draggable="true"]:active {
        cursor: grabbing !important;
      }

      /* Dark mode support */
      body.jt-dark-mode .jt-folder-drop-active {
        background-color: rgba(59, 130, 246, 0.2) !important;
      }
    `;
    document.head.appendChild(styleElement);
  }

  function removeStyles() {
    if (styleElement) {
      styleElement.remove();
      styleElement = null;
    }
  }

  // ===== Cleanup =====

  /**
   * Remove all drag/drop attributes and event listeners from enhanced elements.
   */
  function cleanupEnhancedElements() {
    // Clean up draggable files
    const draggableFiles = document.querySelectorAll('[data-jt-file-draggable="true"]');
    for (const file of draggableFiles) {
      file.removeAttribute('draggable');
      file.removeAttribute('data-jt-file-draggable');
      file.style.opacity = '';

      if (file._jtDragHandlers) {
        file.removeEventListener('dragstart', file._jtDragHandlers.onDragStart);
        file.removeEventListener('dragend', file._jtDragHandlers.onDragEnd);
        if (file._jtDragHandlers.onClick) {
          file.removeEventListener('click', file._jtDragHandlers.onClick, true);
        }
        delete file._jtDragHandlers;
      }
    }

    // Clean up droppable folders
    const droppableFolders = document.querySelectorAll('[data-jt-folder-droppable="true"]');
    for (const folder of droppableFolders) {
      folder.removeAttribute('data-jt-folder-droppable');
      folder.classList.remove('jt-folder-drop-active');

      if (folder._jtDropHandlers) {
        folder.removeEventListener('dragover', folder._jtDropHandlers.onDragOver);
        folder.removeEventListener('dragenter', folder._jtDropHandlers.onDragEnter);
        folder.removeEventListener('dragleave', folder._jtDropHandlers.onDragLeave);
        folder.removeEventListener('drop', folder._jtDropHandlers.onDrop);
        delete folder._jtDropHandlers;
      }
    }
  }

  // ===== Public API =====
  return {
    init,
    cleanup,
    isActive: () => isActiveState
  };
})();

// Export for use by content.js
if (typeof window !== 'undefined') {
  window.FileDragToFolderFeature = FileDragToFolderFeature;
}
