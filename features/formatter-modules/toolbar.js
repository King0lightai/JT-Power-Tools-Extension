/**
 * Formatter Toolbar Module
 * Handles toolbar creation, positioning, and management
 *
 * Dependencies:
 * - formatter-modules/detection.js (FormatterDetection)
 * - formatter-modules/formats.js (FormatterFormats)
 */

const FormatterToolbar = (() => {
  // Module state
  let activeToolbar = null;
  let activeField = null;
  let hideTimeout = null;
  let budgetScrollCleanup = null; // cleanup function for budget toolbar scroll listener
  let expandCollapseAllBtn = null;       // The injected button element
  let expandCollapseAllCleanup = null;   // Cleanup function for button listeners

  // WeakSet tracking cells that contain/contained a Description placeholder textarea.
  // Used to recognize transparent editing textareas in the Description column even
  // after JT removes the placeholder element in edit mode.
  const descriptionCells = new WeakSet();

  /**
   * Get the active toolbar
   * @returns {HTMLElement|null}
   */
  function getActiveToolbar() {
    return activeToolbar;
  }

  /**
   * Get the active field
   * @returns {HTMLTextAreaElement|null}
   */
  function getActiveField() {
    return activeField;
  }

  /**
   * Set the active field
   * @param {HTMLTextAreaElement|null} field
   */
  function setActiveField(field) {
    activeField = field;
  }

  /**
   * Clear hide timeout
   */
  function clearHideTimeout() {
    if (hideTimeout) {
      clearTimeout(hideTimeout);
      hideTimeout = null;
    }
  }

  /**
   * Check if a field is inside the budget table (any field, not just Description)
   * Used to exclude ALL budget table fields from getting embedded toolbar
   * @param {HTMLTextAreaElement} field
   * @returns {boolean}
   */
  function isAnyBudgetTableField(field) {
    if (!field) return false;

    // Must be on the budget or catalog page
    const path = window.location.pathname;
    if (!path.endsWith('/budget') && !path.includes('/catalog')) {
      return false;
    }

    // Exclude sidebar fields (Cost Item Details, etc.)
    if (isSidebarField(field)) {
      return false;
    }

    // Exclude custom fields in job overview form (rounded-sm border divide-y)
    const customFieldForm = field.closest('form.rounded-sm');
    if (customFieldForm && customFieldForm.classList.contains('border') &&
        customFieldForm.classList.contains('divide-y')) {
      return false;
    }

    // Exclude custom fields - they have .font-bold sibling with field name (inside labels)
    if (field.closest('label')) {
      return false;
    }

    // Check if in budget table structure: .flex.min-w-max rows inside .overflow-auto
    const row = field.closest('.flex.min-w-max');
    if (!row) return false;

    // The `.overflow-auto` scroll ancestor is the usual confirmation signal, but
    // during SPA navigation (e.g. Document → Budget tab) React mounts the row
    // before its scroll container is attached. If we required `.overflow-auto`
    // here, isAnyBudgetTableField would return false mid-mount, bypassing the
    // guards in embedToolbarForField and leaving stray inline toolbars on budget
    // group rows. On a budget/catalog path, a non-sidebar/non-label/non-custom
    // textarea inside a `.flex.min-w-max` row IS a budget table cell regardless of
    // whether the scroll wrapper has landed yet.
    return true;
  }

  /**
   * Check if a field is a budget table DESCRIPTION field specifically
   * Only Description fields get the floating expanded toolbar
   * @param {HTMLTextAreaElement} field
   * @returns {boolean}
   */
  function isBudgetTableField(field) {
    if (!field) return false;

    // Must be a budget table field first
    if (!isAnyBudgetTableField(field)) {
      return false;
    }

    // Must have placeholder="Description" for floating toolbar
    const placeholder = field.getAttribute('placeholder');
    return placeholder === 'Description';
  }

  /**
   * Find the direct-child cell of a budget row that contains the given field.
   * Returns null if not found or if the row itself is the closest .flex.min-w-max.
   * @param {HTMLTextAreaElement} field
   * @returns {HTMLElement|null}
   */
  function findBudgetCell(field) {
    const row = field.closest('.flex.min-w-max');
    if (!row) return null;
    let cell = field;
    while (cell && cell.parentElement !== row) cell = cell.parentElement;
    return (cell && cell !== row) ? cell : null;
  }

  /**
   * Check if a field is a budget table Description field (for positioning logic).
   * Also recognises the transparent editing textarea JT injects when a Description
   * cell has existing content (same overlay pattern used for Daily Log fields).
   * @param {HTMLTextAreaElement} field
   * @returns {boolean}
   */
  function isBudgetDescriptionField(field) {
    if (!field) return false;

    // Primary: explicit Description placeholder
    if (field.getAttribute('placeholder') === 'Description') {
      if (!isBudgetTableField(field)) return false;
      // Mark this cell so we can recognise transparent editing textareas in it
      const cell = findBudgetCell(field);
      if (cell) descriptionCells.add(cell);
      return true;
    }

    // Secondary: transparent editing textarea in a Description cell.
    // JT uses color:transparent + pointer-events:none overlay when editing cells
    // with existing content. The Description placeholder may or may not still exist.
    if (!isAnyBudgetTableField(field)) return false;
    const cell = findBudgetCell(field);
    if (!cell) return false;

    // Check if a Description placeholder sibling still exists in this cell
    if (cell.querySelector('textarea[placeholder="Description"]')) return true;

    // Check our WeakSet — covers the case where JT replaced the placeholder
    return descriptionCells.has(cell);
  }

  /**
   * Check if a field is inside a sidebar/panel (NOT a modal)
   * @param {HTMLTextAreaElement} field
   * @returns {boolean}
   */
  function isSidebarField(field) {
    if (!field) return false;

    // First, exclude modals/popups - they use centered auto-margin layout
    // This catches NEW JOB MESSAGE popup and similar
    const modalContainer = field.closest('.m-auto');
    if (modalContainer) {
      return false;
    }

    // Check for JobTread's drag-scroll-boundary (sidebars use this)
    // This is the primary and most reliable sidebar indicator
    const dragScrollContainer = field.closest('[data-is-drag-scroll-boundary="true"]');
    if (dragScrollContainer) return true;

    // Check for common sidebar/panel patterns (but NOT modals/dialogs)
    const sidebar = field.closest('[class*="sidebar"], [class*="panel"], [class*="drawer"]');
    if (sidebar) return true;

    // Check if inside a fixed/absolute positioned container on the RIGHT side of screen
    // (sidebars in JobTread typically appear on the right)
    let parent = field.parentElement;
    while (parent && parent !== document.body) {
      const style = window.getComputedStyle(parent);
      if (style.position === 'fixed' || style.position === 'absolute') {
        const rect = parent.getBoundingClientRect();
        // Sidebars are typically narrow (< 600px), tall, and positioned on the right
        const isOnRight = rect.left > window.innerWidth * 0.5;
        if (rect.width < 600 && rect.height > 200 && isOnRight) {
          return true;
        }
      }
      parent = parent.parentElement;
    }

    return false;
  }

  /**
   * Find the sidebar container for a field
   * @param {HTMLTextAreaElement} field
   * @returns {HTMLElement|null}
   */
  function findSidebarContainer(field) {
    // Try drag-scroll-boundary first
    const dragScrollContainer = field.closest('[data-is-drag-scroll-boundary="true"]');
    if (dragScrollContainer) return dragScrollContainer;

    // Try common sidebar patterns (but NOT modals/dialogs)
    const sidebar = field.closest('[class*="sidebar"], [class*="panel"], [class*="drawer"]');
    if (sidebar) return sidebar;

    // Find fixed/absolute container
    let parent = field.parentElement;
    while (parent && parent !== document.body) {
      const style = window.getComputedStyle(parent);
      if (style.position === 'fixed' || style.position === 'absolute') {
        const rect = parent.getBoundingClientRect();
        if (rect.width < 600 && rect.height > 200) {
          return parent;
        }
      }
      parent = parent.parentElement;
    }

    return null;
  }

  /**
   * Find an embedded toolbar for a specific field (if it exists)
   * Uses data-for-field attribute to ensure we only find the toolbar for THIS field
   * @param {HTMLTextAreaElement} field
   * @returns {HTMLElement|null}
   */
  function findEmbeddedToolbar(field) {
    // Generate a unique ID for this field if it doesn't have one
    if (!field.dataset.formatterId) {
      field.dataset.formatterId = 'fmt-' + Math.random().toString(36).substr(2, 9);
    }
    const fieldId = field.dataset.formatterId;

    // First, look for a toolbar with matching field ID (most reliable)
    const matchingToolbar = document.querySelector(`.jt-formatter-toolbar-embedded[data-for-field="${fieldId}"]`);
    if (matchingToolbar) {
      return matchingToolbar;
    }

    // Check if there's an embedded toolbar immediately before this field (direct sibling only)
    const prevSibling = field.previousElementSibling;
    if (prevSibling && prevSibling.classList.contains('jt-formatter-toolbar-embedded') && !prevSibling.dataset.forField) {
      // Associate this unassociated toolbar with this field
      prevSibling.dataset.forField = fieldId;
      return prevSibling;
    }

    // Also check next sibling (for Message fields where toolbar is placed below)
    const nextSibling = field.nextElementSibling;
    if (nextSibling && nextSibling.classList.contains('jt-formatter-toolbar-embedded') && !nextSibling.dataset.forField) {
      nextSibling.dataset.forField = fieldId;
      return nextSibling;
    }

    return null;
  }

  /**
   * Create and embed toolbar between label and field for sidebar/budget fields
   * Uses responsive overflow - buttons that don't fit go into the ... menu
   * Budget Description fields get an adaptive compact toolbar that sticks below the header
   * @param {HTMLTextAreaElement} field
   * @returns {HTMLElement|null}
   */
  function embedToolbarForField(field, { fromFocus = false } = {}) {
    // Budget table fields that are NOT Description get no toolbar
    // Description fields now use the embedded compact toolbar (adaptive)
    if (isAnyBudgetTableField(field) && !isBudgetDescriptionField(field)) {
      return null;
    }

    // Budget Description fields get a body-appended, position:fixed adaptive
    // toolbar that is only positioned and deduped on the focus path
    // (showToolbar -> positionBudgetFixedToolbar / hideAllEmbeddedToolbars).
    // Building one OUTSIDE that path — e.g. initializeFields' "pre-create for
    // every visible field" loop — spawns a visible, unpositioned, click-capturing
    // toolbar on every visible budget row, and nothing removes them. So only
    // build the budget toolbar when the field is actually focused.
    if (!fromFocus && isBudgetDescriptionField(field)) {
      return null;
    }

    // Check if already embedded for THIS specific field
    let toolbar = findEmbeddedToolbar(field);
    if (toolbar) {
      // Re-run overflow check in case width changed
      requestAnimationFrame(() => updateToolbarOverflow(toolbar));
      return toolbar;
    }

    // Create the toolbar
    toolbar = document.createElement('div');
    toolbar.className = 'jt-formatter-toolbar jt-formatter-toolbar-embedded jt-responsive-toolbar';

    // Note: Previously added jt-sidebar-sticky for sticky positioning, but this caused
    // overlap issues with textarea fields like Message. Now the toolbar flows naturally
    // in the document, pushing content down rather than overlapping it.

    // Check if PreviewModeFeature is available and active
    const hasPreviewMode = window.PreviewModeFeature && window.PreviewModeFeature.isActive();

    // SVG icons for cleaner look
    const icons = {
      bullet: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="8" y1="6" x2="21" y2="6"></line><line x1="8" y1="12" x2="21" y2="12"></line><line x1="8" y1="18" x2="21" y2="18"></line><circle cx="3" cy="6" r="1" fill="currentColor"></circle><circle cx="3" cy="12" r="1" fill="currentColor"></circle><circle cx="3" cy="18" r="1" fill="currentColor"></circle></svg>',
      numbered: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="10" y1="6" x2="21" y2="6"></line><line x1="10" y1="12" x2="21" y2="12"></line><line x1="10" y1="18" x2="21" y2="18"></line><text x="3" y="7" font-size="6" fill="currentColor" stroke="none" font-weight="600">1</text><text x="3" y="13" font-size="6" fill="currentColor" stroke="none" font-weight="600">2</text><text x="3" y="19" font-size="6" fill="currentColor" stroke="none" font-weight="600">3</text></svg>',
      link: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"></path><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"></path></svg>',
      quote: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 21c3 0 7-1 7-8V5c0-1.25-.756-2.017-2-2H4c-1.25 0-2 .75-2 1.972V11c0 1.25.75 2 2 2 1 0 1 0 1 1v1c0 1-1 2-2 2s-1 .008-1 1.031V21z"></path><path d="M15 21c3 0 7-1 7-8V5c0-1.25-.757-2.017-2-2h-4c-1.25 0-2 .75-2 1.972V11c0 1.25.75 2 2 2h.75c0 2.25.25 4-2.75 4v3z"></path></svg>',
      table: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="2" ry="2"></rect><line x1="3" y1="9" x2="21" y2="9"></line><line x1="3" y1="15" x2="21" y2="15"></line><line x1="9" y1="3" x2="9" y2="21"></line><line x1="15" y1="3" x2="15" y2="21"></line></svg>',
      alert: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"></path><line x1="12" y1="9" x2="12" y2="13"></line><line x1="12" y1="17" x2="12.01" y2="17"></line></svg>',
      color: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="13.5" cy="6.5" r="2.5" fill="#ef4444" stroke="none"></circle><circle cx="17.5" cy="10.5" r="2.5" fill="#f59e0b" stroke="none"></circle><circle cx="8.5" cy="7.5" r="2.5" fill="#3b82f6" stroke="none"></circle><circle cx="6.5" cy="12.5" r="2.5" fill="#10b981" stroke="none"></circle><path d="M12 2C6.5 2 2 6.5 2 12s4.5 10 10 10c.926 0 1.648-.746 1.648-1.688 0-.437-.18-.835-.437-1.125-.29-.289-.438-.652-.438-1.125a1.64 1.64 0 0 1 1.668-1.668h1.996c3.051 0 5.555-2.503 5.555-5.555C21.965 6.012 17.461 2 12 2z"></path></svg>',
      alignLeft: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="3" y1="6" x2="21" y2="6"></line><line x1="3" y1="12" x2="15" y2="12"></line><line x1="3" y1="18" x2="18" y2="18"></line></svg>',
      alignCenter: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="3" y1="6" x2="21" y2="6"></line><line x1="6" y1="12" x2="18" y2="12"></line><line x1="4" y1="18" x2="20" y2="18"></line></svg>',
      alignRight: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="3" y1="6" x2="21" y2="6"></line><line x1="9" y1="12" x2="21" y2="12"></line><line x1="6" y1="18" x2="21" y2="18"></line></svg>',
      hr: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="3" y1="12" x2="21" y2="12"></line></svg>'
    };

    // SVG for more icon (three dots)
    const moreIcon = '<svg viewBox="0 0 24 24" fill="currentColor" stroke="none"><circle cx="5" cy="12" r="2"></circle><circle cx="12" cy="12" r="2"></circle><circle cx="19" cy="12" r="2"></circle></svg>';

    // Build toolbar with all buttons inline (will be managed by overflow logic)
    let toolbarHTML = '';

    if (hasPreviewMode) {
      toolbarHTML += `<button class="jt-preview-toggle jt-toolbar-item" data-action="preview" data-priority="0" title="Preview"><span>Preview</span></button>`;
    }

    // All buttons in priority order (lower = more important, shown first)
    toolbarHTML += `
      <button class="jt-toolbar-item" data-format="bold" data-priority="1" title="Bold (*text*) - Ctrl/Cmd+B"><strong>B</strong></button>
      <button class="jt-toolbar-item" data-format="italic" data-priority="2" title="Italic (^text^) - Ctrl/Cmd+I"><em>I</em></button>
      <button class="jt-toolbar-item" data-format="underline" data-priority="3" title="Underline (_text_) - Ctrl/Cmd+U"><u>U</u></button>
      <button class="jt-toolbar-item" data-format="strikethrough" data-priority="4" title="Strikethrough (~text~)"><s>S</s></button>
      <button class="jt-toolbar-item" data-format="h1" data-priority="5" title="Heading 1">H<sub>1</sub></button>
      <button class="jt-toolbar-item" data-format="h2" data-priority="6" title="Heading 2">H<sub>2</sub></button>
      <button class="jt-toolbar-item" data-format="h3" data-priority="7" title="Heading 3">H<sub>3</sub></button>
      <button class="jt-toolbar-item" data-format="h4" data-priority="8" title="Heading 4">H<sub>4</sub></button>
      <button class="jt-toolbar-item" data-format="justify-left" data-priority="9" title="Align Left (:--)">${icons.alignLeft}</button>
      <button class="jt-toolbar-item" data-format="justify-center" data-priority="10" title="Align Center (-:-)">${icons.alignCenter}</button>
      <button class="jt-toolbar-item" data-format="justify-right" data-priority="11" title="Align Right (--:)">${icons.alignRight}</button>
      <button class="jt-toolbar-item" data-format="bullet" data-priority="12" title="Bullet List">${icons.bullet}</button>
      <button class="jt-toolbar-item" data-format="numbered" data-priority="13" title="Numbered List">${icons.numbered}</button>
      <button class="jt-toolbar-item" data-format="link" data-priority="14" title="Insert Link">${icons.link}</button>
      <button class="jt-toolbar-item" data-format="quote" data-priority="15" title="Quote">${icons.quote}</button>
      <button class="jt-toolbar-item" data-format="table" data-priority="16" title="Insert Table">${icons.table}</button>
      <button class="jt-toolbar-item" data-format="hr" data-priority="17" title="Horizontal Rule (---)">${icons.hr}</button>
      <button class="jt-toolbar-item jt-color-green" data-format="color" data-color="green" data-priority="18" title="Green">A</button>
      <button class="jt-toolbar-item jt-color-yellow" data-format="color" data-color="yellow" data-priority="19" title="Yellow">A</button>
      <button class="jt-toolbar-item jt-color-blue" data-format="color" data-color="blue" data-priority="20" title="Blue">A</button>
      <button class="jt-toolbar-item jt-color-red" data-format="color" data-color="red" data-priority="21" title="Red">A</button>
      <button class="jt-toolbar-item jt-alert-btn" data-format="alert" data-priority="22" title="Insert Alert">${icons.alert}</button>
    `;

    // More menu (always visible, contains overflow items)
    toolbarHTML += `
      <div class="jt-overflow-menu">
        <button class="jt-overflow-btn" title="More options">${moreIcon}</button>
        <div class="jt-overflow-dropdown"></div>
      </div>
    `;

    toolbar.innerHTML = toolbarHTML;

    // Remove all toolbar buttons from tab order so Tab key skips the toolbar
    // (prevents Tab from getting trapped cycling through format buttons)
    toolbar.querySelectorAll('button').forEach(btn => btn.setAttribute('tabindex', '-1'));

    // Setup handlers
    setupResponsiveToolbar(toolbar);
    setupFormatButtons(toolbar, field);
    setupCustomTooltips(toolbar);

    if (hasPreviewMode) {
      setupPreviewButton(toolbar, field);
    }

    // Check if this is a Message field
    const isMessageField = field.getAttribute('placeholder') === 'Message';

    // Find the right insertion point - need to insert OUTSIDE any relative/absolute container
    // JobTread uses a relative container with absolute textarea + preview div overlay
    let insertTarget = field;
    let insertParent = field.parentElement;

    // Check if parent is a relative container with absolute-positioned children (JobTread's preview system)
    if (insertParent) {
      const parentStyle = window.getComputedStyle(insertParent);
      if (parentStyle.position === 'relative') {
        // Check if the field is absolute positioned inside
        const fieldStyle = window.getComputedStyle(field);
        if (fieldStyle.position === 'absolute') {
          // Insert outside the relative container
          insertTarget = insertParent;
          insertParent = insertParent.parentElement;
        }
      }
    }

    // Associate toolbar with this specific field using data attribute
    // This ensures findEmbeddedToolbar returns the correct toolbar for this field
    toolbar.dataset.forField = field.dataset.formatterId;

    // Check if this is a budget Description field
    const isBudgetDesc = isBudgetDescriptionField(field);

    // Insert toolbar near the field for all contexts
    if (isBudgetDesc) {
      // Budget Description fields: append to document.body with position: fixed.
      // This keeps the toolbar completely outside the cell DOM, so:
      // 1) No cursor alignment issues (cell layout untouched)
      // 2) No covering the row above (positioned below the header)
      // 3) Pins below the budget header row on scroll (sidebar-like behavior)
      // Scroll-aware repositioning handled by positionBudgetFixedToolbar().
      toolbar.classList.add('jt-toolbar-budget-adaptive');
      document.body.appendChild(toolbar);
    } else if (isMessageField) {
      // For Message fields, insert toolbar between the TO line and the textarea
      // scroll container. The TO line is a div.flex.border-t.rounded-t-sm.border-x
      // and the textarea is inside a div.border.rounded-b-sm scroll container.
      const scrollContainer = field.closest('.overflow-auto, .overflow-y-auto');
      toolbar.classList.add('jt-toolbar-message');

      if (scrollContainer) {
        // Insert directly before the scroll container (between TO line and textarea)
        scrollContainer.parentElement.insertBefore(toolbar, scrollContainer);
      } else if (insertParent) {
        insertParent.insertBefore(toolbar, insertTarget);
      } else {
        field.parentElement.insertBefore(toolbar, field);
      }
    } else if (insertParent) {
      insertParent.insertBefore(toolbar, insertTarget);
    } else {
      // Fallback: insert before the field
      field.parentElement.insertBefore(toolbar, field);
    }

    // In modals, add bottom padding to the scroll container so the last toolbar
    // doesn't sit behind the sticky footer (Delete/Cancel/Save button bar)
    const modalContainer = field.closest('.m-auto.shadow-lg');
    if (modalContainer) {
      const scrollArea = modalContainer.querySelector('.overflow-y-auto, .overflow-auto');
      if (scrollArea && !scrollArea.dataset.jtPaddingAdded) {
        scrollArea.dataset.jtPaddingAdded = 'true';
        scrollArea.style.paddingBottom = '2.5rem';
      }
    }

    return toolbar;
  }

  /**
   * Find the budget table header row (sticky row with column names)
   * @param {HTMLTextAreaElement} field
   * @returns {HTMLElement|null}
   */
  function findBudgetHeaderRow(field) {
    const scrollContainer = field.closest('.overflow-auto');

    // Strategy 1 (most reliable): jt-budget-header-container from freeze-header feature.
    // This wraps all header rows with sticky positioning and a known top offset.
    // Check within the scroll container, then parent scroll container, then globally.
    if (scrollContainer) {
      let header = scrollContainer.querySelector('.jt-budget-header-container');
      if (header) return header;

      // Data rows might be in a nested overflow-auto — check parent too
      const parentScroll = scrollContainer.parentElement?.closest('.overflow-auto');
      if (parentScroll) {
        header = parentScroll.querySelector('.jt-budget-header-container');
        if (header) return header;
      }
    }

    // Global fallback — only one budget table visible at a time in JobTread
    const globalHeader = document.querySelector('.jt-budget-header-container');
    if (globalHeader) return globalHeader;

    if (!scrollContainer) return null;

    // Strategy 2: Look for sticky elements that contain header text
    const stickyElements = scrollContainer.querySelectorAll('.sticky');
    for (const sticky of stickyElements) {
      const text = sticky.textContent;
      if (text.includes('Name') && text.includes('Description')) {
        return sticky;
      }
    }

    // Strategy 3: Look through all flex rows for header-like rows
    const allRows = scrollContainer.querySelectorAll('.flex.min-w-max, .flex[style*="min-width"]');
    for (const row of allRows) {
      if (row.querySelector('textarea')) continue;
      const rowText = row.textContent;
      if (rowText.includes('+ Item') || (rowText.includes('Item') && rowText.includes('Group') && row.querySelector('.bg-gray-700'))) continue;
      if (rowText.includes('Name') && rowText.includes('Description')) {
        return row;
      }
    }

    // Strategy 4: The budget column header row is a SIBLING of the scroll container
    // (outside it), so strategies 2 & 3 can't find it. Search the parent element.
    const parent = scrollContainer.parentElement;
    if (parent) {
      const outerSticky = parent.querySelectorAll('.sticky');
      for (const sticky of outerSticky) {
        const text = sticky.textContent;
        if (text.includes('Name') && text.includes('Description')) {
          return sticky;
        }
      }
    }

    return null;
  }


  /**
   * Find the bottom edge of sticky headers that are above the field
   * @param {HTMLTextAreaElement} field - The field we're positioning toolbar for
   * @returns {number} The bottom edge of the lowest sticky header above the field (in viewport coords)
   */
  function getStickyHeaderOffset(field) {
    const fieldRect = field.getBoundingClientRect();
    let maxOffset = 0;

    // Helper to check if element is a table header (should be excluded)
    const isTableHeader = (el) => {
      const tagName = el.tagName.toLowerCase();
      // Exclude thead, th, and elements inside tables that aren't page-level headers
      if (tagName === 'thead' || tagName === 'th') {
        return true;
      }
      // Also exclude if element is inside a table
      if (el.closest('table')) {
        return true;
      }
      return false;
    };

    // Check semantic header/nav elements
    const semanticHeaders = document.querySelectorAll('header, nav');
    semanticHeaders.forEach(el => {
      const style = window.getComputedStyle(el);
      const position = style.position;
      const top = parseFloat(style.top) || 0;

      if ((position === 'sticky' || position === 'fixed') && top >= 0 && top < 20) {
        const rect = el.getBoundingClientRect();
        // Element should be above the field and reasonably sized
        if (rect.bottom < fieldRect.top + 50 && rect.height < 150) {
          if (rect.bottom > maxOffset) {
            maxOffset = rect.bottom;
          }
        }
      }
    });

    // Check elements with sticky class (JobTread budget table headers, sidebar headers)
    // Exclude table headers (thead, th) - these are data tables, not page-level headers
    const stickyClassElements = document.querySelectorAll('.sticky');
    stickyClassElements.forEach(el => {
      // Skip table header elements - they're not page-level navigation headers
      if (isTableHeader(el)) {
        return;
      }

      const style = window.getComputedStyle(el);
      const position = style.position;

      if (position === 'sticky') {
        const rect = el.getBoundingClientRect();
        // Element should be above or overlapping the field's top area, and reasonably sized
        if (rect.bottom <= fieldRect.top + 50 && rect.height > 15 && rect.height < 150) {
          if (rect.bottom > maxOffset) {
            maxOffset = rect.bottom;
          }
        }
      }
    });

    // Also check parent rows of sticky elements (for table header rows like JobTread budget)
    // But skip if the parent is inside a table element
    stickyClassElements.forEach(el => {
      // Skip table header elements
      if (isTableHeader(el)) {
        return;
      }

      const style = window.getComputedStyle(el);
      if (style.position === 'sticky') {
        const parent = el.parentElement;
        if (parent && !parent.closest('table')) {
          const parentRect = parent.getBoundingClientRect();
          // Parent row should be above the field and look like a header row
          if (parentRect.bottom <= fieldRect.top + 50 && parentRect.height > 15 && parentRect.height < 100) {
            if (parentRect.bottom > maxOffset) {
              maxOffset = parentRect.bottom;
            }
          }
        }
      }
    });

    return maxOffset;
  }

  /**
   * Position budget toolbar with position: fixed, pinned below the header row.
   * The toolbar lives in document.body (outside the cell entirely) to avoid
   * cursor alignment issues. It tracks the Description column horizontally
   * and pins below the budget header row vertically.
   * @param {HTMLElement} toolbar
   * @param {HTMLTextAreaElement} field
   */
  function positionBudgetFixedToolbar(toolbar, field) {
    if (!toolbar || !field || !document.body.contains(field)) {
      toolbar.style.visibility = 'hidden';
      return;
    }

    const fieldRect = field.getBoundingClientRect();
    const toolbarHeight = toolbar.offsetHeight || 30;

    // Find the budget header row to get the pin point.
    // The jt-budget-header-container is sticky with a top offset (e.g., top: 101px).
    // Its getBoundingClientRect().bottom gives the header's visual bottom in viewport.
    const headerRow = findBudgetHeaderRow(field);
    const headerBottom = headerRow ? headerRow.getBoundingClientRect().bottom : 0;

    // Find the description column cell for horizontal alignment
    const descCell = field.closest('.shrink-0, [class*="shrink"]') || field.parentElement;
    const cellRect = descCell ? descCell.getBoundingClientRect() : fieldRect;

    // Detect if the field is in the first budget row by checking the row number cell.
    // The first row has a cell with text "1" (the row number indicator).
    const row = field.closest('tr, [class*="group/row"]');
    let isFirstRow = false;
    if (row) {
      const rowNumBtn = row.querySelector('div[role="button"].cursor-pointer');
      if (rowNumBtn && rowNumBtn.textContent.trim() === '1') {
        isFirstRow = true;
      }
    }

    // Default: position ABOVE the field (user's preferred initial position)
    let top = fieldRect.top - toolbarHeight - 2;

    if (isFirstRow) {
      // First row: always place toolbar BELOW the field (no room above the header)
      top = fieldRect.bottom + 2;
    } else if (top < headerBottom) {
      // Other rows: pin just below the header, BUT also track the field's bottom
      // edge so the toolbar slides up under the header as the field scrolls away.
      // +1px gap prevents visual overlap with the header's bottom border.
      const pinnedTop = headerBottom + 1;
      const fieldBottomConstrained = fieldRect.bottom - toolbarHeight - 2;
      top = Math.min(pinnedTop, fieldBottomConstrained);
    }

    // Determine visibility and clip-path based on toolbar vs header position.
    // IMPORTANT: position:fixed paints ON TOP of position:sticky regardless of
    // z-index (different stacking contexts). clip-path is the ONLY reliable way
    // to make the toolbar visually disappear behind the sticky header.
    let isVisible = true;
    let clipPath = 'none';

    if (fieldRect.top > window.innerHeight) {
      // Field is below viewport
      isVisible = false;
    } else if (top <= headerBottom) {
      // Toolbar is at or above the header bottom — clip the overlapping portion.
      // Uses <= (not <) because even at headerBottom the fixed toolbar renders
      // on top of the sticky header due to stacking context rules.
      const clipTop = headerBottom - top;
      if (clipTop >= toolbarHeight) {
        // Fully behind the header — keep it clipped so no flash
        clipPath = 'inset(100% 0 0 0)';
        isVisible = false;
      } else if (clipTop > 0) {
        // Partially behind — clip the top for smooth slide-behind
        clipPath = `inset(${clipTop}px 0 0 0)`;
      }
    }

    // Horizontal: match the description cell
    const left = cellRect.left;
    const width = cellRect.width;

    // ─── Frozen column clipping (horizontal scroll) ───────────────
    // The budget table has frozen columns (row number + Name) that are
    // position:sticky with z-10. Like the header, position:fixed paints
    // on top of position:sticky, so we must clip the left side too.
    let clipLeft = 0;
    if (row) {
      const stickyCells = row.querySelectorAll('.sticky');
      let frozenRight = 0;
      stickyCells.forEach(cell => {
        // Only count frozen COLUMN cells (not the row itself if it's sticky).
        // Frozen columns are narrow cells at the left edge (row#, Name).
        const r = cell.getBoundingClientRect();
        if (r.right > frozenRight && r.width < 400) {
          frozenRight = r.right;
        }
      });
      if (frozenRight > 0 && left < frozenRight) {
        clipLeft = frozenRight - left;
      }
    }

    // ─── Right-rail clipping (Help / Time / Files / etc. sidebars) ──
    // JobTread sidebars render as `.absolute.top-0.bottom-0.right-0`
    // overlays — they paint on top of the page WITHOUT reflowing the
    // budget table. So a focused Description cell can still sit at
    // its original X coordinate behind the open sidebar, and our
    // position:fixed toolbar would otherwise render on top of the
    // sidebar. Clip the toolbar's right edge to the sidebar's left
    // edge so it stops cleanly at the rail.
    let clipRight = 0;
    const rightRails = document.querySelectorAll('.absolute.top-0.bottom-0.right-0');
    rightRails.forEach(rail => {
      const r = rail.getBoundingClientRect();
      // Skip non-visible / not-right-anchored / too-short candidates so
      // we don't accidentally clip against an unrelated absolute element.
      if (r.width === 0 || r.height < window.innerHeight * 0.5) return;
      if (Math.abs(r.right - window.innerWidth) > 2) return;
      if (r.left < left + width) {
        const overlap = (left + width) - r.left;
        if (overlap > clipRight) clipRight = overlap;
      }
    });

    // Parse existing top clip value into a combined inset()
    // clip-path: inset(top right bottom left)
    let clipTop = 0;
    if (clipPath === 'inset(100% 0 0 0)') {
      // Fully clipped from top — keep it fully hidden
      clipTop = toolbarHeight; // will exceed height → fully clipped
    } else if (clipPath !== 'none') {
      const m = clipPath.match(/inset\((\d+(?:\.\d+)?)px/);
      if (m) clipTop = parseFloat(m[1]);
    }

    // If the right-rail covers the entire toolbar, hide it outright.
    if (clipRight >= width) {
      isVisible = false;
    }

    // Build final clip-path combining top + right + left clipping
    if (clipTop >= toolbarHeight || !isVisible) {
      clipPath = 'inset(100% 0 0 0)';
    } else if (clipTop > 0 || clipLeft > 0 || clipRight > 0) {
      clipPath = `inset(${clipTop}px ${clipRight}px 0 ${clipLeft}px)`;
    } else {
      clipPath = 'none';
    }

    // Always set ALL styles in one batch — no early returns that leave stale values.
    toolbar.style.position = 'fixed';
    toolbar.style.top = `${top}px`;
    toolbar.style.left = `${left}px`;
    toolbar.style.width = `${width}px`;
    toolbar.style.zIndex = '35'; // Above data rows (z-[29]) but below budget sticky header (z-[41])
    toolbar.style.clipPath = clipPath;
    toolbar.style.visibility = isVisible ? 'visible' : 'hidden';
    toolbar.style.pointerEvents = isVisible ? 'auto' : 'none';
    toolbar.classList.add('jt-toolbar-sticky-active');
  }

  /**
   * Set up scroll/resize listeners for the budget fixed toolbar.
   * Returns a cleanup function to remove listeners.
   * @param {HTMLElement} toolbar
   * @param {HTMLTextAreaElement} field
   * @returns {Function} cleanup function
   */
  function setupBudgetScrollListeners(toolbar, field) {
    const reposition = () => {
      positionBudgetFixedToolbar(toolbar, field);
    };

    // Collect ALL scrollable ancestors — budget tables can have nested scroll containers.
    // The main scroll container AND any outer scrollable wrapper (page-level) must be tracked.
    const scrollTargets = [];
    let el = field.parentElement;
    while (el && el !== document.documentElement) {
      const style = window.getComputedStyle(el);
      const overflowY = style.overflowY;
      const overflowX = style.overflowX;
      if (overflowY === 'auto' || overflowY === 'scroll' ||
          overflowX === 'auto' || overflowX === 'scroll') {
        scrollTargets.push(el);
      }
      el = el.parentElement;
    }

    scrollTargets.forEach(target => {
      target.addEventListener('scroll', reposition, { passive: true });
    });
    window.addEventListener('scroll', reposition, { passive: true });
    window.addEventListener('resize', reposition, { passive: true });

    return () => {
      scrollTargets.forEach(target => {
        target.removeEventListener('scroll', reposition);
      });
      window.removeEventListener('scroll', reposition);
      window.removeEventListener('resize', reposition);
    };
  }

  /**
   * Position embedded toolbar with sticky behavior for sidebar/modal fields.
   * Budget fields use positionBudgetFixedToolbar instead.
   * @param {HTMLElement} toolbar
   * @param {HTMLTextAreaElement} field
   */
  function positionEmbeddedToolbar(toolbar, field) {
    if (!toolbar || !field) return;

    // Budget adaptive toolbars use fixed positioning (handled separately)
    if (toolbar.classList.contains('jt-toolbar-budget-adaptive')) {
      positionBudgetFixedToolbar(toolbar, field);
      // Set up scroll listeners (only once)
      if (!budgetScrollCleanup) {
        budgetScrollCleanup = setupBudgetScrollListeners(toolbar, field);
      }
      return;
    }

    // Find scrollable ancestor — sidebar, modal, etc.
    const scrollContainer = field.closest('.overflow-y-auto, .overflow-auto, .overflow-y-scroll, .overflow-scroll');

    if (!scrollContainer) {
      // No scroll container — keep in normal flow
      toolbar.style.position = 'relative';
      toolbar.style.top = 'auto';
      toolbar.style.left = 'auto';
      toolbar.style.width = '100%';
      toolbar.classList.remove('jt-toolbar-sticky-active');
      return;
    }

    // Sidebar/modal: find the direct-child sticky header
    let stickyOffset = 0;
    const stickyHeader = scrollContainer.querySelector(':scope > .sticky.z-10') ||
                          scrollContainer.querySelector(':scope > .sticky');
    if (stickyHeader && !stickyHeader.classList.contains('jt-formatter-toolbar-embedded')) {
      stickyOffset = stickyHeader.offsetHeight;
    }

    toolbar.style.position = 'sticky';
    toolbar.style.top = `${stickyOffset}px`;
    toolbar.style.left = 'auto';
    toolbar.style.width = '100%';
    toolbar.style.zIndex = '9';
    toolbar.classList.add('jt-toolbar-sticky-active');
  }

  /**
   * Position toolbar relative to field with sticky behavior
   * For budget Description fields, docks in the sticky header row
   * @param {HTMLElement} toolbar
   * @param {HTMLTextAreaElement} field
   */
  function positionToolbar(toolbar, field) {
    // Handle embedded toolbar positioning (includes budget adaptive and sidebar sticky)
    if (toolbar.classList.contains('jt-formatter-toolbar-embedded')) {
      positionEmbeddedToolbar(toolbar, field);
      return;
    }

    const rect = field.getBoundingClientRect();
    const toolbarHeight = toolbar.offsetHeight || 36;
    const padding = 8;
    const viewportHeight = window.innerHeight;

    // Check if this is a sidebar field - position at bottom of visible viewport
    const isSidebar = isSidebarField(field);
    if (isSidebar) {
      const sidebarContainer = findSidebarContainer(field);
      if (sidebarContainer) {
        const sidebarRect = sidebarContainer.getBoundingClientRect();
        const toolbarWidth = toolbar.offsetWidth || 300;
        const bottomPadding = 12;
        const sidePadding = 12;

        // Position at bottom of the VISIBLE area (viewport), not the sidebar
        // This ensures toolbar is always visible regardless of scroll position
        let top = viewportHeight - toolbarHeight - bottomPadding;

        // But constrain to within the sidebar's horizontal bounds
        let left = sidebarRect.left + sidePadding;

        // Make sure toolbar fits within sidebar width
        if (left + toolbarWidth > sidebarRect.right - sidePadding) {
          left = sidebarRect.right - toolbarWidth - sidePadding;
        }

        // Don't position below the sidebar's visible bottom
        if (top > sidebarRect.bottom - toolbarHeight - bottomPadding) {
          top = sidebarRect.bottom - toolbarHeight - bottomPadding;
        }

        toolbar.style.position = 'fixed';
        toolbar.style.top = `${top}px`;
        toolbar.style.left = `${left}px`;
        toolbar.style.visibility = 'visible';
        toolbar.style.opacity = '1';
        toolbar.classList.add('jt-toolbar-sidebar-bottom');
        toolbar.classList.remove('jt-toolbar-sticky');
        return;
      }
    }

    // Find the top offset (below any fixed/sticky headers)
    const stickyHeaderOffset = getStickyHeaderOffset(field) || 60; // Default 60px for JobTread header

    // Calculate visible area of the field
    const fieldVisibleTop = Math.max(rect.top, stickyHeaderOffset);
    const fieldVisibleBottom = Math.min(rect.bottom, viewportHeight - padding);
    const fieldVisibleHeight = fieldVisibleBottom - fieldVisibleTop;

    // Hide toolbar if field is not visible enough
    if (fieldVisibleHeight < 30) {
      toolbar.style.visibility = 'hidden';
      toolbar.style.opacity = '0';
      return;
    }

    toolbar.style.visibility = 'visible';
    toolbar.style.opacity = '1';
    toolbar.style.position = 'fixed';
    toolbar.classList.remove('jt-toolbar-docked');

    // Determine vertical position
    let top;
    const roomAboveField = rect.top - stickyHeaderOffset;

    if (roomAboveField >= toolbarHeight + padding) {
      // Enough room above the field - position just above it
      top = rect.top - toolbarHeight - padding;
      toolbar.classList.remove('jt-toolbar-sticky');
    } else {
      // Not enough room above - stick to top of viewport (below headers)
      top = stickyHeaderOffset + padding;
      toolbar.classList.add('jt-toolbar-sticky');

      // But don't go past the bottom of the field
      const maxTop = rect.bottom - toolbarHeight - padding;
      if (top > maxTop) {
        top = maxTop;
      }
    }

    toolbar.style.top = `${top}px`;

    // Horizontal position - align with field, prevent overflow
    let left = rect.left;
    const toolbarWidth = toolbar.offsetWidth || 300;
    const viewportWidth = window.innerWidth;

    if (left + toolbarWidth > viewportWidth - padding) {
      left = Math.max(padding, viewportWidth - toolbarWidth - padding);
    }

    toolbar.style.left = `${left}px`;
    toolbar.style.width = 'auto';
  }

  /**
   * Update toolbar button states based on current formatting
   * @param {HTMLTextAreaElement} field
   * @param {HTMLElement} toolbar
   */
  function updateToolbarState(field, toolbar) {
    const activeFormats = window.FormatterDetection.detectActiveFormats(field);

    // Update basic format buttons
    const boldBtn = toolbar.querySelector('[data-format="bold"]');
    const italicBtn = toolbar.querySelector('[data-format="italic"]');
    const underlineBtn = toolbar.querySelector('[data-format="underline"]');
    const strikeBtn = toolbar.querySelector('[data-format="strikethrough"]');

    boldBtn?.classList.toggle('active', activeFormats.bold);
    italicBtn?.classList.toggle('active', activeFormats.italic);
    underlineBtn?.classList.toggle('active', activeFormats.underline);
    strikeBtn?.classList.toggle('active', activeFormats.strikethrough);

    // Update justify buttons
    const justifyLeft = toolbar.querySelector('[data-format="justify-left"]');
    const justifyCenter = toolbar.querySelector('[data-format="justify-center"]');
    const justifyRight = toolbar.querySelector('[data-format="justify-right"]');

    justifyLeft?.classList.toggle('active', !activeFormats['justify-center'] && !activeFormats['justify-right']);
    justifyCenter?.classList.toggle('active', activeFormats['justify-center']);
    justifyRight?.classList.toggle('active', activeFormats['justify-right']);

    // Update color button
    const colorBtn = toolbar.querySelector('.jt-color-btn');
    if (activeFormats.color) {
      colorBtn?.classList.add('active');
      colorBtn?.setAttribute('title', `Current: ${activeFormats.color}`);
    } else {
      colorBtn?.classList.remove('active');
      colorBtn?.setAttribute('title', 'Text Color');
    }

    // Update color options
    toolbar.querySelectorAll('[data-format="color"]').forEach(btn => {
      const color = btn.dataset.color;
      btn.classList.toggle('active', color === activeFormats.color);
    });
  }

  /**
   * Update toolbar overflow - move buttons that don't fit into the overflow menu
   * @param {HTMLElement} toolbar
   */
  function updateToolbarOverflow(toolbar) {
    if (!toolbar || !toolbar.classList.contains('jt-responsive-toolbar')) return;

    const overflowMenu = toolbar.querySelector('.jt-overflow-menu');
    // setupResponsiveToolbar reparents the dropdown onto document.body (see its
    // comment), so it's no longer a descendant of toolbar — querySelector would
    // return null. Use the reference it stashed; fall back to the old lookup
    // for any toolbar that somehow reaches here without going through setup.
    const overflowDropdown = toolbar._overflowDropdown || toolbar.querySelector('.jt-overflow-dropdown');

    if (!overflowMenu || !overflowDropdown) return;

    // A recalculation invalidates whatever was showing (items may move in or
    // out of the dropdown below, and the anchor button may shift) — close it
    // rather than leave a stale or now-empty dropdown floating on screen.
    overflowDropdown.classList.remove('jt-overflow-dropdown-visible');

    // Get all toolbar items (buttons with data-priority)
    // Items live in one of two places: still in the toolbar, or already moved
    // into the dropdown. The dropdown is reparented onto document.body (see
    // setupResponsiveToolbar), so it is NOT a descendant of toolbar — querying
    // only the toolbar would miss every overflowed item, and the reset below
    // could never bring them back. They would stay stuck in the overflow menu
    // for good once the toolbar had been narrowed even once.
    // Sorted by priority up front so the reset restores a deterministic order.
    const allItems = [
      ...toolbar.querySelectorAll('.jt-toolbar-item'),
      ...overflowDropdown.querySelectorAll('.jt-toolbar-item')
    ].sort((a, b) => parseInt(a.dataset.priority || '999') - parseInt(b.dataset.priority || '999'));

    // Reset - move all items back to toolbar (before overflow menu)
    allItems.forEach(item => {
      item.style.display = '';
      item.classList.remove('jt-in-overflow');
      if (item.parentElement === overflowDropdown) {
        toolbar.insertBefore(item, overflowMenu);
      }
    });

    // Get available width (toolbar width minus overflow button width and padding)
    const toolbarRect = toolbar.getBoundingClientRect();
    const overflowBtnWidth = 28; // Approximate width of overflow button
    const padding = 16; // Toolbar padding
    const availableWidth = toolbarRect.width - overflowBtnWidth - padding;

    // Calculate cumulative width of visible items
    let currentWidth = 0;
    let hasOverflow = false;

    // Sort items by priority
    const sortedItems = [...allItems].sort((a, b) => {
      return parseInt(a.dataset.priority || '999') - parseInt(b.dataset.priority || '999');
    });

    sortedItems.forEach(item => {
      // Temporarily show to measure
      item.style.display = '';
      const itemWidth = item.offsetWidth + 2; // 2px gap

      if (currentWidth + itemWidth <= availableWidth) {
        currentWidth += itemWidth;
        item.classList.remove('jt-in-overflow');
      } else {
        // Move to overflow dropdown
        hasOverflow = true;
        item.classList.add('jt-in-overflow');
        overflowDropdown.appendChild(item);
      }
    });

    // Show/hide overflow button based on whether there are overflow items
    overflowMenu.style.display = hasOverflow ? '' : 'none';
  }

  /**
   * Setup responsive toolbar with overflow behavior
   * @param {HTMLElement} toolbar
   */
  function setupResponsiveToolbar(toolbar) {
    const overflowMenu = toolbar.querySelector('.jt-overflow-menu');
    const overflowDropdown = toolbar.querySelector('.jt-overflow-dropdown');
    const overflowBtn = toolbar.querySelector('.jt-overflow-btn');

    if (!overflowMenu || !overflowDropdown || !overflowBtn) return;

    // The dropdown positions itself with `position: fixed` using coordinates
    // from getBoundingClientRect() (viewport space). That's only correct when
    // the dropdown's containing block IS the viewport — but per the CSS spec,
    // any ancestor with a non-`none` transform (as the Quick Notes panel uses
    // for its slide-in animation) becomes the containing block for `position:
    // fixed` descendants instead. Left nested inside such an ancestor, the
    // dropdown's "viewport" coordinates were actually being resolved against
    // that ancestor, landing it off-screen — the menu opened, just nowhere
    // visible. Reparenting it straight onto document.body sidesteps this for
    // this ancestor and any other transformed ancestor anywhere else it's
    // used: body is never itself a transformed containing block, so fixed
    // coordinates on a body child always mean the real viewport.
    //
    // This moves the dropdown out from under `toolbar` in the DOM, so every
    // other lookup of it (updateToolbarOverflow, hideAllEmbeddedToolbars,
    // hideToolbar, destroyToolbar) must use toolbar._overflowDropdown instead
    // of toolbar.querySelector('.jt-overflow-dropdown') — that query returns
    // null once the dropdown lives on body, and the overflow system silently
    // stops working everywhere, not just here.
    document.body.appendChild(overflowDropdown);
    toolbar._overflowDropdown = overflowDropdown;

    // Position dropdown using fixed positioning to escape stacking contexts
    function positionDropdown() {
      const btnRect = overflowBtn.getBoundingClientRect();
      const dropdownWidth = overflowDropdown.offsetWidth || 160;

      // Position below button, aligned to right edge
      let top = btnRect.bottom + 4;
      let left = btnRect.right - dropdownWidth;

      // Ensure dropdown doesn't go off screen
      if (left < 8) left = 8;
      if (top + 200 > window.innerHeight) {
        // Position above button if not enough space below
        top = btnRect.top - overflowDropdown.offsetHeight - 4;
      }

      overflowDropdown.style.position = 'fixed';
      overflowDropdown.style.top = `${top}px`;
      overflowDropdown.style.left = `${left}px`;
      overflowDropdown.style.right = 'auto';
    }

    // Toggle overflow dropdown
    overflowBtn.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      const isVisible = overflowDropdown.classList.contains('jt-overflow-dropdown-visible');
      overflowDropdown.classList.toggle('jt-overflow-dropdown-visible');

      // Position dropdown when opening
      if (!isVisible) {
        requestAnimationFrame(positionDropdown);
      }
    });

    // Close dropdown when clicking outside. The dropdown no longer lives inside
    // `.jt-overflow-menu` (see above), so a click landing inside it must be
    // checked directly — otherwise closest('.jt-overflow-menu') would miss it
    // and this would close the dropdown out from under its own buttons.
    // Self-removing once the toolbar is detached (belt-and-braces for a path
    // that bypasses destroyToolbar — see the ResizeObserver comment below);
    // destroyToolbar removes it deterministically on the normal path.
    const onDocClick = (e) => {
      if (!toolbar.isConnected) {
        document.removeEventListener('click', onDocClick);
        return;
      }
      if (!e.target.closest('.jt-overflow-menu') && !overflowDropdown.contains(e.target)) {
        overflowDropdown.classList.remove('jt-overflow-dropdown-visible');
      }
    };
    document.addEventListener('click', onDocClick);

    // Close dropdown after clicking a button inside it
    overflowDropdown.addEventListener('click', (e) => {
      if (e.target.closest('button[data-format]') || e.target.closest('button[data-action]')) {
        setTimeout(() => {
          overflowDropdown.classList.remove('jt-overflow-dropdown-visible');
        }, 50);
      }
    });

    // The dropdown is now genuinely viewport-fixed, so scrolling any ancestor
    // (the Quick Notes panel's own scroll region included — capture:true
    // catches scrolls on nested containers, not just window) or resizing the
    // window can move the button out from under it. Close rather than chase it.
    const onScrollOrResize = () => {
      if (!toolbar.isConnected) {
        window.removeEventListener('scroll', onScrollOrResize, true);
        window.removeEventListener('resize', onScrollOrResize);
        return;
      }
      overflowDropdown.classList.remove('jt-overflow-dropdown-visible');
    };
    window.addEventListener('scroll', onScrollOrResize, true);
    window.addEventListener('resize', onScrollOrResize);

    // destroyToolbar's job on the normal teardown path: drop the reparented
    // dropdown and the window/document-level listeners it owns. Without this,
    // toolbar.remove() no longer takes the dropdown with it (it isn't a
    // descendant anymore), and document/window are permanent listener targets
    // that never get garbage-collected on their own.
    toolbar._overflowCleanup = () => {
      document.removeEventListener('click', onDocClick);
      window.removeEventListener('scroll', onScrollOrResize, true);
      window.removeEventListener('resize', onScrollOrResize);
      overflowDropdown.remove();
      toolbar._overflowDropdown = null;
      toolbar._overflowCleanup = null;
    };

    // Initial overflow calculation (after render)
    requestAnimationFrame(() => {
      updateToolbarOverflow(toolbar);
    });

    // Watch for resize
    if (window.ResizeObserver) {
      const resizeObserver = new ResizeObserver(() => {
        // Belt-and-braces only — do NOT rely on this to free the observer.
        // A detached element never resizes, so this callback never runs again
        // after removal. Teardown is destroyToolbar()'s job; every removal
        // path must go through it.
        if (!toolbar.isConnected) {
          resizeObserver.disconnect();
          toolbar._resizeObserver = null;
          return;
        }
        updateToolbarOverflow(toolbar);
      });
      resizeObserver.observe(toolbar);

      // Store reference for cleanup
      toolbar._resizeObserver = resizeObserver;
    }
  }

  /**
   * Setup format button handlers
   * @param {HTMLElement} toolbar
   * @param {HTMLTextAreaElement} field
   */
  function setupFormatButtons(toolbar, field) {
    toolbar.querySelectorAll('button').forEach(btn => {
      btn.addEventListener('mousedown', (e) => {
        e.preventDefault();
      });

      btn.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        const format = btn.dataset.format;
        const color = btn.dataset.color;

        // Store field reference
        const targetField = activeField;

        if (format === 'color') {
          window.FormatterFormats.applyFormat(targetField, format, { color });
          toolbar.querySelector('.jt-color-dropdown').classList.remove('jt-color-dropdown-visible');
        } else if (format && format !== 'color-picker') {
          window.FormatterFormats.applyFormat(targetField, format);
          toolbar.querySelectorAll('.jt-dropdown-menu').forEach(menu => {
            menu.classList.remove('jt-dropdown-visible');
          });
        }

        // Restore focus and update toolbar state
        if (targetField && document.body.contains(targetField)) {
          targetField.focus();
          activeField = targetField;
          setTimeout(() => {
            if (document.body.contains(toolbar) && document.body.contains(targetField)) {
              updateToolbarState(targetField, toolbar);
            }
          }, 10);
        }
      });
    });
  }

  /**
   * Setup preview button handler
   * @param {HTMLElement} toolbar
   * @param {HTMLTextAreaElement} field
   */
  function setupPreviewButton(toolbar, field) {
    const previewBtn = toolbar.querySelector('[data-action="preview"]');
    if (!previewBtn) return;

    previewBtn.addEventListener('mousedown', (e) => {
      e.preventDefault();
    });

    previewBtn.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();

      const currentField = activeField;
      if (window.PreviewModeFeature && window.PreviewModeFeature.togglePreview && currentField) {
        window.PreviewModeFeature.togglePreview(currentField, previewBtn);
      }

      if (currentField && document.body.contains(currentField)) {
        currentField.focus();
      }
    });
  }

  /**
   * Setup custom tooltips
   * @param {HTMLElement} toolbar
   */
  function setupCustomTooltips(toolbar) {
    let currentTooltip = null;
    let tooltipTimeout = null;

    toolbar.querySelectorAll('button[title]').forEach(btn => {
      const title = btn.getAttribute('title');
      btn.setAttribute('data-tooltip', title);
      btn.removeAttribute('title');

      btn.addEventListener('mouseenter', (e) => {
        if (tooltipTimeout) {
          clearTimeout(tooltipTimeout);
        }

        tooltipTimeout = setTimeout(() => {
          const tooltipText = btn.getAttribute('data-tooltip');
          if (!tooltipText) return;

          if (currentTooltip && document.body.contains(currentTooltip)) {
            document.body.removeChild(currentTooltip);
          }

          const tooltip = document.createElement('div');
          tooltip.className = 'jt-custom-tooltip';
          tooltip.textContent = tooltipText;
          document.body.appendChild(tooltip);

          const btnRect = btn.getBoundingClientRect();
          const tooltipRect = tooltip.getBoundingClientRect();

          const left = btnRect.left + (btnRect.width / 2) - (tooltipRect.width / 2);
          const top = btnRect.top - tooltipRect.height - 10;

          tooltip.style.left = `${left}px`;
          tooltip.style.top = `${top}px`;

          setTimeout(() => {
            tooltip.classList.add('visible');
          }, 10);

          currentTooltip = tooltip;
        }, 500);
      });

      btn.addEventListener('mouseleave', () => {
        if (tooltipTimeout) {
          clearTimeout(tooltipTimeout);
          tooltipTimeout = null;
        }

        if (currentTooltip && document.body.contains(currentTooltip)) {
          currentTooltip.classList.remove('visible');
          setTimeout(() => {
            if (currentTooltip && document.body.contains(currentTooltip)) {
              document.body.removeChild(currentTooltip);
            }
            currentTooltip = null;
          }, 200);
        }
      });
    });
  }

  /**
   * Create the toolbar element
   * @param {HTMLTextAreaElement} field
   * @param {Object} options - Options for toolbar creation
   * @param {boolean} options.expanded - If true, show all buttons inline (no dropdowns)
   * @returns {HTMLElement}
   */
  function createToolbar(field, options = {}) {
    const { expanded = false } = options;
    const toolbar = document.createElement('div');
    toolbar.className = expanded
      ? 'jt-formatter-toolbar jt-formatter-expanded'
      : 'jt-formatter-toolbar jt-responsive-toolbar';

    // Check if PreviewModeFeature is available and active
    const hasPreviewMode = window.PreviewModeFeature && window.PreviewModeFeature.isActive();

    // Build toolbar HTML
    let toolbarHTML = '';

    if (hasPreviewMode) {
      toolbarHTML += `
      <button class="jt-preview-toggle" data-action="preview" title="Preview">
        <span>Preview</span>
      </button>
      <div class="jt-toolbar-divider"></div>
      `;
    }

    // SVG icons for cleaner look (used in both expanded and compact modes)
    const icons = {
      bullet: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="8" y1="6" x2="21" y2="6"></line><line x1="8" y1="12" x2="21" y2="12"></line><line x1="8" y1="18" x2="21" y2="18"></line><circle cx="3" cy="6" r="1" fill="currentColor"></circle><circle cx="3" cy="12" r="1" fill="currentColor"></circle><circle cx="3" cy="18" r="1" fill="currentColor"></circle></svg>',
      numbered: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="10" y1="6" x2="21" y2="6"></line><line x1="10" y1="12" x2="21" y2="12"></line><line x1="10" y1="18" x2="21" y2="18"></line><text x="3" y="7" font-size="6" fill="currentColor" stroke="none" font-weight="600">1</text><text x="3" y="13" font-size="6" fill="currentColor" stroke="none" font-weight="600">2</text><text x="3" y="19" font-size="6" fill="currentColor" stroke="none" font-weight="600">3</text></svg>',
      link: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"></path><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"></path></svg>',
      quote: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 21c3 0 7-1 7-8V5c0-1.25-.756-2.017-2-2H4c-1.25 0-2 .75-2 1.972V11c0 1.25.75 2 2 2 1 0 1 0 1 1v1c0 1-1 2-2 2s-1 .008-1 1.031V21z"></path><path d="M15 21c3 0 7-1 7-8V5c0-1.25-.757-2.017-2-2h-4c-1.25 0-2 .75-2 1.972V11c0 1.25.75 2 2 2h.75c0 2.25.25 4-2.75 4v3z"></path></svg>',
      table: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="2" ry="2"></rect><line x1="3" y1="9" x2="21" y2="9"></line><line x1="3" y1="15" x2="21" y2="15"></line><line x1="9" y1="3" x2="9" y2="21"></line><line x1="15" y1="3" x2="15" y2="21"></line></svg>',
      alert: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"></path><line x1="12" y1="9" x2="12" y2="13"></line><line x1="12" y1="17" x2="12.01" y2="17"></line></svg>',
      alignLeft: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="3" y1="6" x2="21" y2="6"></line><line x1="3" y1="12" x2="15" y2="12"></line><line x1="3" y1="18" x2="18" y2="18"></line></svg>',
      alignCenter: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="3" y1="6" x2="21" y2="6"></line><line x1="6" y1="12" x2="18" y2="12"></line><line x1="4" y1="18" x2="20" y2="18"></line></svg>',
      alignRight: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="3" y1="6" x2="21" y2="6"></line><line x1="9" y1="12" x2="21" y2="12"></line><line x1="6" y1="18" x2="21" y2="18"></line></svg>',
      hr: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="3" y1="12" x2="21" y2="12"></line></svg>'
    };

    if (expanded) {
      // Expanded layout - all buttons visible inline (for budget view)
      toolbarHTML += `
      <div class="jt-toolbar-group">
        <button data-format="bold" title="Bold (*text*) - Ctrl/Cmd+B">
          <strong>B</strong>
        </button>
        <button data-format="italic" title="Italic (^text^) - Ctrl/Cmd+I">
          <em>I</em>
        </button>
        <button data-format="underline" title="Underline (_text_) - Ctrl/Cmd+U">
          <u>U</u>
        </button>
        <button data-format="strikethrough" title="Strikethrough (~text~)">
          <s>S</s>
        </button>
      </div>

      <div class="jt-toolbar-divider"></div>

      <div class="jt-toolbar-group">
        <button data-format="h1" title="Heading 1">H1</button>
        <button data-format="h2" title="Heading 2">H2</button>
        <button data-format="h3" title="Heading 3">H3</button>
        <button data-format="h4" title="Heading 4">H4</button>
      </div>

      <div class="jt-toolbar-divider"></div>

      <div class="jt-toolbar-group">
        <button data-format="bullet" title="Bullet List">${icons.bullet}</button>
        <button data-format="numbered" title="Numbered List">${icons.numbered}</button>
        <button data-format="link" title="Insert Link">${icons.link}</button>
        <button data-format="quote" title="Quote">${icons.quote}</button>
        <button data-format="table" title="Insert Table">${icons.table}</button>
      </div>

      <div class="jt-toolbar-divider"></div>

      <div class="jt-toolbar-group">
        <button data-format="justify-left" title="Align Left (:--)">${icons.alignLeft}</button>
        <button data-format="justify-center" title="Align Center (-:-)">${icons.alignCenter}</button>
        <button data-format="justify-right" title="Align Right (--:)">${icons.alignRight}</button>
        <button data-format="hr" title="Horizontal Rule (---)">${icons.hr}</button>
      </div>

      <div class="jt-toolbar-divider"></div>

      <div class="jt-toolbar-group">
        <button data-format="color" data-color="green" title="Green" class="jt-color-option jt-color-green">A</button>
        <button data-format="color" data-color="yellow" title="Yellow" class="jt-color-option jt-color-yellow">A</button>
        <button data-format="color" data-color="blue" title="Blue" class="jt-color-option jt-color-blue">A</button>
        <button data-format="color" data-color="red" title="Red" class="jt-color-option jt-color-red">A</button>
      </div>

      <div class="jt-toolbar-divider"></div>

      <div class="jt-toolbar-group">
        <button data-format="alert" title="Insert Alert" class="jt-alert-btn">${icons.alert}</button>
      </div>
    `;
    } else {
      // Responsive layout with overflow menu (same as embedded toolbar)
      // Note: Preview button is added above (before if/else) for all modes

      // All buttons in priority order (lower = more important, shown first)
      toolbarHTML += `
        <button class="jt-toolbar-item" data-format="bold" data-priority="1" title="Bold (*text*) - Ctrl/Cmd+B"><strong>B</strong></button>
        <button class="jt-toolbar-item" data-format="italic" data-priority="2" title="Italic (^text^) - Ctrl/Cmd+I"><em>I</em></button>
        <button class="jt-toolbar-item" data-format="underline" data-priority="3" title="Underline (_text_) - Ctrl/Cmd+U"><u>U</u></button>
        <button class="jt-toolbar-item" data-format="strikethrough" data-priority="4" title="Strikethrough (~text~)"><s>S</s></button>
        <button class="jt-toolbar-item" data-format="h1" data-priority="5" title="Heading 1">H<sub>1</sub></button>
        <button class="jt-toolbar-item" data-format="h2" data-priority="6" title="Heading 2">H<sub>2</sub></button>
        <button class="jt-toolbar-item" data-format="h3" data-priority="7" title="Heading 3">H<sub>3</sub></button>
        <button class="jt-toolbar-item" data-format="h4" data-priority="8" title="Heading 4">H<sub>4</sub></button>
        <button class="jt-toolbar-item" data-format="justify-left" data-priority="9" title="Align Left (:--)">${icons.alignLeft}</button>
        <button class="jt-toolbar-item" data-format="justify-center" data-priority="9" title="Align Center (-:-)">${icons.alignCenter}</button>
        <button class="jt-toolbar-item" data-format="justify-right" data-priority="10" title="Align Right (--:)">${icons.alignRight}</button>
        <button class="jt-toolbar-item" data-format="bullet" data-priority="11" title="Bullet List">${icons.bullet}</button>
        <button class="jt-toolbar-item" data-format="numbered" data-priority="12" title="Numbered List">${icons.numbered}</button>
        <button class="jt-toolbar-item" data-format="link" data-priority="13" title="Insert Link">${icons.link}</button>
        <button class="jt-toolbar-item" data-format="quote" data-priority="14" title="Quote">${icons.quote}</button>
        <button class="jt-toolbar-item" data-format="table" data-priority="15" title="Insert Table">${icons.table}</button>
        <button class="jt-toolbar-item" data-format="hr" data-priority="16" title="Horizontal Rule (---)">${icons.hr}</button>
        <button class="jt-toolbar-item jt-color-green" data-format="color" data-color="green" data-priority="17" title="Green">A</button>
        <button class="jt-toolbar-item jt-color-yellow" data-format="color" data-color="yellow" data-priority="18" title="Yellow">A</button>
        <button class="jt-toolbar-item jt-color-blue" data-format="color" data-color="blue" data-priority="19" title="Blue">A</button>
        <button class="jt-toolbar-item jt-color-red" data-format="color" data-color="red" data-priority="20" title="Red">A</button>
        <button class="jt-toolbar-item jt-alert-btn" data-format="alert" data-priority="21" title="Insert Alert">${icons.alert}</button>
      `;

      // More menu (always visible, contains overflow items)
      const moreIcon = '<svg viewBox="0 0 24 24" fill="currentColor" stroke="none"><circle cx="5" cy="12" r="2"></circle><circle cx="12" cy="12" r="2"></circle><circle cx="19" cy="12" r="2"></circle></svg>';
      toolbarHTML += `
        <div class="jt-overflow-menu">
          <button class="jt-overflow-btn" title="More options">${moreIcon}</button>
          <div class="jt-overflow-dropdown"></div>
        </div>
      `;
    }

    toolbar.innerHTML = toolbarHTML;

    // Remove all toolbar buttons from tab order so Tab key skips the toolbar
    toolbar.querySelectorAll('button').forEach(btn => btn.setAttribute('tabindex', '-1'));

    // Setup handlers
    if (!expanded) {
      // Responsive toolbar with overflow menu
      setupResponsiveToolbar(toolbar);
    }
    setupFormatButtons(toolbar, field);
    setupCustomTooltips(toolbar);

    if (hasPreviewMode) {
      setupPreviewButton(toolbar, field);
    }

    document.body.appendChild(toolbar);
    return toolbar;
  }

  /**
   * Close overflow dropdowns on all embedded toolbars except one
   * Note: Embedded toolbars are always visible, we just close their dropdowns
   * @param {HTMLElement|null} exceptToolbar - Toolbar to skip (or null to close all)
   * @param {boolean} actuallyHide - If true, actually hide the toolbars (for budget field focus)
   */
  function hideAllEmbeddedToolbars(exceptToolbar = null, actuallyHide = false) {
    const embeddedToolbars = document.querySelectorAll('.jt-formatter-toolbar-embedded');
    embeddedToolbars.forEach(toolbar => {
      if (toolbar !== exceptToolbar) {
        // Close any open overflow dropdowns. Reparented onto document.body by
        // setupResponsiveToolbar (see its comment) — toolbar.querySelector()
        // would no longer find it, so use the stashed reference.
        const overflowDropdown = toolbar._overflowDropdown;
        if (overflowDropdown) {
          overflowDropdown.classList.remove('jt-overflow-dropdown-visible');
        }
        // Budget adaptive toolbars from other fields should be removed entirely
        // since they use fixed positioning and would look broken if reset to relative.
        // Also clean up the scroll listeners.
        if (toolbar.classList.contains('jt-toolbar-budget-adaptive')) {
          if (budgetScrollCleanup) {
            budgetScrollCleanup();
            budgetScrollCleanup = null;
          }
          destroyToolbar(toolbar);
          return;
        }
        // Reset sticky positioning from previous focus — ensures only ONE toolbar
        // is ever sticky at a time. Without this, switching between textareas leaves
        // the old toolbar sticky (hideToolbar is cancelled by clearHideTimeout).
        if (toolbar.classList.contains('jt-toolbar-sticky-active')) {
          toolbar.style.position = 'relative';
          toolbar.style.top = 'auto';
          toolbar.style.zIndex = '';
          toolbar.classList.remove('jt-toolbar-sticky-active');
        }
        // If actuallyHide is true, hide the toolbar (used when budget field is focused)
        if (actuallyHide) {
          toolbar.classList.add('jt-toolbar-hidden');
        }
      }
    });
  }

  /**
   * Show the toolbar for a field
   * @param {HTMLTextAreaElement} field
   */
  function showToolbar(field) {
    if (!field || !document.body.contains(field)) return;

    clearHideTimeout();

    // ALL fields now use the EMBEDDED toolbar (compact with overflow menu)
    // Budget Description fields get adaptive positioning (fixed, sticks below header)
    // Sidebar/modal/message fields get sticky positioning
    // Non-Description budget fields get no toolbar

    // Remove any old floating expanded toolbar (legacy cleanup)
    if (activeToolbar && !activeToolbar.classList.contains('jt-formatter-toolbar-embedded')) {
      destroyToolbar(activeToolbar);
      activeToolbar = null;
    }

    // Use embedded toolbar for all fields (embedToolbarForField handles exclusions).
    // fromFocus:true authorizes building the budget Description adaptive toolbar —
    // this is the only path that positions and dedups it.
    const embeddedToolbar = embedToolbarForField(field, { fromFocus: true });
    if (embeddedToolbar) {
      // Close overflow dropdowns on other embedded toolbars
      hideAllEmbeddedToolbars(embeddedToolbar);
      // Ensure this toolbar is visible
      embeddedToolbar.classList.remove('jt-toolbar-hidden');
      activeToolbar = embeddedToolbar;
      activeField = field;
      positionToolbar(embeddedToolbar, field);
      updateToolbarState(field, embeddedToolbar);
    } else {
      // No toolbar created (e.g., non-Description budget table fields like Name)
      // Actively hide the previous toolbar — otherwise it stays visible
      // and the deferred positionToolbar() call in handleFieldFocus repositions
      // the old budget toolbar over the newly-focused non-Description field.
      hideToolbar();
      activeField = field;
    }
  }

  /**
   * Hide the toolbar
   */
  function hideToolbar() {
    clearHideTimeout();

    // Close overflow dropdowns on all embedded toolbars
    hideAllEmbeddedToolbars(null);

    if (activeToolbar) {
      // Close any open overflow dropdown in the active toolbar. Reparented
      // onto document.body by setupResponsiveToolbar — use the stashed
      // reference, not a querySelector that can no longer find it.
      const overflowDropdown = activeToolbar._overflowDropdown;
      if (overflowDropdown) {
        overflowDropdown.classList.remove('jt-overflow-dropdown-visible');
      }

      // Budget toolbars: remove from DOM + clean up scroll listeners.
      // Sidebar/modal toolbars: reset to normal flow.
      // Floating toolbars: remove from DOM.
      if (activeToolbar.classList.contains('jt-toolbar-budget-adaptive')) {
        // Budget toolbars live in document.body — remove and clean up listeners
        if (budgetScrollCleanup) {
          budgetScrollCleanup();
          budgetScrollCleanup = null;
        }
        destroyToolbar(activeToolbar);
      } else if (activeToolbar.classList.contains('jt-formatter-toolbar-embedded')) {
        // Reset from sticky back to normal document flow
        activeToolbar.style.position = 'relative';
        activeToolbar.style.top = 'auto';
        activeToolbar.style.left = 'auto';
        activeToolbar.style.width = '100%';
        activeToolbar.style.zIndex = '';
        activeToolbar.style.display = '';
        activeToolbar.style.pointerEvents = '';
        activeToolbar.classList.remove('jt-toolbar-sticky-active');
      } else {
        // For floating toolbars, remove from DOM
        destroyToolbar(activeToolbar);
      }
      activeToolbar = null;
      activeField = null;
    }
  }

  /**
   * Schedule hiding the toolbar with delay
   * @param {number} delay - Delay in milliseconds
   */
  function scheduleHide(delay = 200) {
    clearHideTimeout();
    hideTimeout = setTimeout(() => {
      const newFocus = document.activeElement;
      // Keep toolbar open if focus is on toolbar, a formatter-enabled textarea,
      // or the preview panel (which is tied to the toolbar)
      if (!newFocus?.closest('.jt-formatter-toolbar') &&
          !newFocus?.closest('.jt-preview-panel') &&
          !newFocus?.dataset?.formatterReady) {
        hideToolbar();
      }
      hideTimeout = null;
    }, delay);
  }

  // ─── Expand/Collapse All Button ─────────────────────────────────────

  // Phosphor ArrowsOut (regular) — expand all groups
  const EXPAND_ALL_SVG = `<svg xmlns="http://www.w3.org/2000/svg" fill="currentColor" class="inline-block overflow-visible h-[1em] w-[1em] align-[-0.125em]" viewBox="0 0 256 256"><path d="M216,48V96a8,8,0,0,1-16,0V67.31l-42.34,42.35a8,8,0,0,1-11.32-11.32L188.69,56H160a8,8,0,0,1,0-16h48A8,8,0,0,1,216,48ZM98.34,146.34,56,188.69V160a8,8,0,0,0-16,0v48a8,8,0,0,0,8,8H96a8,8,0,0,0,0-16H67.31l42.35-42.34a8,8,0,0,0-11.32-11.32ZM208,152a8,8,0,0,0-8,8v28.69l-42.34-42.35a8,8,0,0,0-11.32,11.32L188.69,200H160a8,8,0,0,0,0,16h48a8,8,0,0,0,8-8V160A8,8,0,0,0,208,152ZM67.31,56H96a8,8,0,0,0,0-16H48a8,8,0,0,0-8,8V96a8,8,0,0,0,16,0V67.31l42.34,42.35a8,8,0,0,0,11.32-11.32Z"/></svg>`;

  // Phosphor ArrowsIn (regular) — collapse all groups
  const COLLAPSE_ALL_SVG = `<svg xmlns="http://www.w3.org/2000/svg" fill="currentColor" class="inline-block overflow-visible h-[1em] w-[1em] align-[-0.125em]" viewBox="0 0 256 256"><path d="M144,104V64a8,8,0,0,1,16,0V84.69l42.34-42.35a8,8,0,0,1,11.32,11.32L171.31,96H192a8,8,0,0,1,0,16H152A8,8,0,0,1,144,104Zm-40,40H64a8,8,0,0,0,0,16H84.69L42.34,202.34a8,8,0,0,0,11.32,11.32L96,171.31V192a8,8,0,0,0,16,0V152A8,8,0,0,0,104,144Zm67.31,16H192a8,8,0,0,0,0-16H152a8,8,0,0,0-8,8v40a8,8,0,0,0,16,0V171.31l42.34,42.35a8,8,0,0,0,11.32-11.32ZM104,56a8,8,0,0,0-8,8V84.69L53.66,42.34A8,8,0,0,0,42.34,53.66L84.69,96H64a8,8,0,0,0,0,16h40a8,8,0,0,0,8-8V64A8,8,0,0,0,104,56Z"/></svg>`;

  /**
   * Detect whether budget groups are mostly expanded or collapsed.
   * Looks at group row chevrons — expanded groups have a rotated SVG.
   * @returns {'expanded'|'collapsed'|'none'} Current majority state, or 'none' if no groups
   */
  function detectGroupState() {
    // Find all group chevron SVGs in the budget table.
    // Group rows have a unique chevron with path "m9 18 6-6-6-6" (right-pointing triangle).
    // When expanded, the SVG has the rotate-90 class.
    // This avoids scoping to a specific scroll container (header vs data are separate).
    const chevronPaths = document.querySelectorAll('svg path[d="m9 18 6-6-6-6"]');
    if (chevronPaths.length === 0) return 'none';

    let expanded = 0;
    let collapsed = 0;

    chevronPaths.forEach(path => {
      const svg = path.closest('svg');
      if (!svg) return;

      if (svg.classList.contains('rotate-90')) {
        expanded++;
      } else {
        collapsed++;
      }
    });

    if (expanded === 0 && collapsed === 0) return 'none';
    return expanded > collapsed ? 'expanded' : 'collapsed';
  }

  /**
   * Find the native expand-one-level and collapse-one-level buttons in the Name header.
   * Identifies them by their SVG path data.
   * @returns {{ expandBtn: HTMLElement|null, collapseBtn: HTMLElement|null }}
   */
  function findHeaderExpandCollapseButtons() {
    const headerCells = document.querySelectorAll('div.sticky.font-bold[style*="width: 300px"]');
    let nameHeader = null;

    for (const cell of headerCells) {
      const textDiv = cell.querySelector(':scope > div.p-2.grow');
      if (textDiv && textDiv.textContent.trim() === 'Name') {
        nameHeader = cell;
        break;
      }
    }

    if (!nameHeader) return { expandBtn: null, collapseBtn: null };

    let expandBtn = null;
    let collapseBtn = null;

    const buttons = nameHeader.querySelectorAll('div[role="button"]');
    buttons.forEach(btn => {
      const paths = btn.querySelectorAll('svg path');
      const pathData = Array.from(paths).map(p => p.getAttribute('d')).join(' ');

      // Lucide minimize-2: arrows pointing inward (toward center) = COLLAPSE one level
      if (pathData.includes('M3 21') && pathData.includes('m14 10')) {
        collapseBtn = btn;
      }
      // Lucide maximize-2: arrows pointing outward (toward corners) = EXPAND one level
      if (pathData.includes('M15 3h6v6') && pathData.includes('M9 21H3v-6')) {
        expandBtn = btn;
      }
    });

    return { expandBtn, collapseBtn };
  }

  /**
   * Click the native expand or collapse button repeatedly to expand/collapse all levels.
   * @param {'expand'|'collapse'} action - Which action to perform
   */
  async function performExpandCollapseAll(action) {
    if (!expandCollapseAllBtn) return;

    const { expandBtn, collapseBtn } = findHeaderExpandCollapseButtons();
    const targetBtn = action === 'expand' ? expandBtn : collapseBtn;

    if (!targetBtn) {
      console.log('Formatter: Could not find native ' + action + ' button');
      return;
    }

    expandCollapseAllBtn.style.opacity = '0.5';
    expandCollapseAllBtn.style.pointerEvents = 'none';

    for (let i = 0; i < 5; i++) {
      if (!expandCollapseAllBtn) return; // feature was cleaned up mid-flight
      targetBtn.click();
      await new Promise(resolve => setTimeout(resolve, 150));
    }

    setTimeout(() => {
      if (expandCollapseAllBtn) {
        updateExpandCollapseAllIcon();
        expandCollapseAllBtn.style.opacity = '';
        expandCollapseAllBtn.style.pointerEvents = '';
      }
    }, 300);
  }

  /**
   * Update the expand/collapse all button icon based on current group state.
   */
  function updateExpandCollapseAllIcon() {
    if (!expandCollapseAllBtn) return;

    const state = detectGroupState();

    if (state === 'none') {
      if (expandCollapseAllBtn.dataset.jtState !== 'none') {
        expandCollapseAllBtn.dataset.jtState = 'none';
        expandCollapseAllBtn.style.display = 'none';
      }
      return;
    }

    // Only update innerHTML if state actually changed — prevents MutationObserver
    // infinite loop (innerHTML change → mutation → updateIcon → innerHTML change…)
    if (expandCollapseAllBtn.dataset.jtState === state) return;
    expandCollapseAllBtn.dataset.jtState = state;

    expandCollapseAllBtn.style.display = '';

    if (state === 'expanded') {
      expandCollapseAllBtn.innerHTML = COLLAPSE_ALL_SVG;
      expandCollapseAllBtn.title = 'Collapse All Groups';
    } else {
      expandCollapseAllBtn.innerHTML = EXPAND_ALL_SVG;
      expandCollapseAllBtn.title = 'Expand All Groups';
    }
  }

  /**
   * Inject the Expand/Collapse All button into the budget Name header cell.
   */
  function injectExpandCollapseAllButton() {
    // If already injected, just re-check the icon state (groups may have loaded since injection)
    if (expandCollapseAllBtn && document.body.contains(expandCollapseAllBtn)) {
      updateExpandCollapseAllIcon();
      return;
    }

    if (!window.location.pathname.endsWith('/budget')) return;

    const { expandBtn, collapseBtn } = findHeaderExpandCollapseButtons();
    if (!expandBtn || !collapseBtn) return;

    const nameHeader = expandBtn.closest('div.sticky.font-bold[style*="width: 300px"]');
    if (!nameHeader) return;

    const btn = document.createElement('div');
    btn.setAttribute('role', 'button');
    btn.setAttribute('tabindex', '0');
    btn.className = 'inline-block align-bottom relative cursor-pointer p-2 hover:backdrop-brightness-95';
    btn.dataset.jtExpandCollapseAll = 'true';

    expandCollapseAllBtn = btn;
    updateExpandCollapseAllIcon();

    const handleClick = () => {
      const state = detectGroupState();
      if (state === 'expanded') {
        performExpandCollapseAll('collapse');
      } else {
        performExpandCollapseAll('expand');
      }
    };

    btn.addEventListener('click', handleClick);

    const handleNativeClick = (e) => {
      const target = e.target.closest('div[role="button"]');
      if (target && target !== btn && nameHeader.contains(target)) {
        setTimeout(updateExpandCollapseAllIcon, 300);
      }
    };
    nameHeader.addEventListener('click', handleNativeClick);

    const scrollContainer = document.querySelector('.overflow-auto .flex.min-w-max')?.closest('.overflow-auto');
    const handleGroupChevronClick = (e) => {
      const target = e.target.closest('div[role="button"]');
      if (target) {
        setTimeout(updateExpandCollapseAllIcon, 300);
      }
    };
    if (scrollContainer) {
      scrollContainer.addEventListener('click', handleGroupChevronClick);
    }

    // Insert after expand button (second native button), before the eye/visibility button
    expandBtn.after(btn);

    expandCollapseAllCleanup = () => {
      btn.removeEventListener('click', handleClick);
      nameHeader.removeEventListener('click', handleNativeClick);
      if (scrollContainer) {
        scrollContainer.removeEventListener('click', handleGroupChevronClick);
      }
      btn.remove();
      expandCollapseAllBtn = null;
      expandCollapseAllCleanup = null;
    };

    console.log('Formatter: Expand/Collapse All button injected');
  }

  /**
   * Remove the Expand/Collapse All button and clean up listeners.
   */
  function removeExpandCollapseAllButton() {
    if (expandCollapseAllCleanup) {
      expandCollapseAllCleanup();
    }
  }

  /**
   * Defense-in-depth cleanup for stray budget/catalog toolbars.
   *
   * Budget/catalog Description toolbars are body-appended (jt-toolbar-budget-adaptive)
   * and positioned on focus — a correct one NEVER lives inside a table row. So any
   * `.jt-formatter-toolbar-embedded` found INSIDE a `.flex.min-w-max` row on a
   * budget/catalog page is a stray created during an SPA transition; remove it.
   * Called from initializeFields on every pass so leftovers can't persist.
   */
  function removeStrayBudgetToolbars() {
    const path = window.location.pathname;
    if (!path.endsWith('/budget') && !path.includes('/catalog')) return;
    document.querySelectorAll('.flex.min-w-max .jt-formatter-toolbar-embedded').forEach(toolbar => {
      destroyToolbar(toolbar);
    });
  }

  /**
   * Tear down a toolbar: disconnect its ResizeObserver, drop its reparented
   * overflow dropdown and the window/document listeners it owns, then detach it.
   *
   * ALWAYS use this instead of a bare `toolbar.remove()`. A ResizeObserver
   * keeps a strong reference to what it observes, so detaching a toolbar
   * without disconnecting pins the whole subtree (~15 SVG buttons) as
   * unreachable-but-retained DOM. It costs no CPU — it just accumulates —
   * which is why the symptom was climbing memory with a flat CPU graph and
   * no console output.
   *
   * The observer cannot be relied on to clean itself up: its self-disconnect
   * runs inside its own callback, and a detached element never resizes, so
   * that callback never fires again.
   *
   * The overflow dropdown has the same shape of problem: setupResponsiveToolbar
   * reparents it onto document.body to escape transformed ancestors (see its
   * comment), so `toolbar.remove()` no longer takes it with it — and its
   * click listener plus the module's own scroll/resize/click listeners are
   * registered on the dropdown/window/document, which never get garbage
   * collected on their own the way a detached subtree does.
   *
   * Safe to call with null, with a toolbar that has no observer or overflow
   * dropdown, and twice on the same toolbar.
   */
  function destroyToolbar(toolbar) {
    if (!toolbar) return;
    if (toolbar._resizeObserver) {
      toolbar._resizeObserver.disconnect();
      toolbar._resizeObserver = null;
    }
    if (toolbar._overflowCleanup) {
      toolbar._overflowCleanup();
    }
    toolbar.remove();
  }

  // Public API
  return {
    getActiveToolbar,
    getActiveField,
    setActiveField,
    clearHideTimeout,
    positionToolbar,
    updateToolbarState,
    createToolbar,
    showToolbar,
    hideToolbar,
    scheduleHide,
    embedToolbarForField,
    injectExpandCollapseAllButton,
    removeExpandCollapseAllButton,
    removeStrayBudgetToolbars,
    destroyToolbar
  };
})();

// Export to window
if (typeof window !== 'undefined') {
  window.FormatterToolbar = FormatterToolbar;
}
