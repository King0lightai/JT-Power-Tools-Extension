/**
 * JobTread Text Formatter Feature Module
 * Add formatting toolbar to budget description fields
 *
 * Dependencies:
 * - formatter-modules/detection.js (FormatterDetection)
 * - formatter-modules/formats.js (FormatterFormats)
 * - formatter-modules/toolbar.js (FormatterToolbar)
 */

const FormatterFeature = (() => {
  // Module references
  const Detection = () => window.FormatterDetection || {};
  const Formats = () => window.FormatterFormats || {};
  const Toolbar = () => window.FormatterToolbar || {};

  // Local state (minimal - most moved to modules)
  let scrollTimeout = null;
  let observer = null;
  // Pending rAF handle for the coalesced mutation scan (see init()).
  let pendingScan = null;
  let isActive = false;
  let styleElement = null;

  // Store AbortControllers for event listeners (for proper cleanup)
  const fieldControllers = new WeakMap();

  // Initialize the feature
  function init() {
    if (isActive) {
      return;
    }

    isActive = true;

    try {
      // Inject CSS
      injectCSS();

      // Initialize fields
      initializeFields();

      // Inject expand/collapse all button on budget pages
      Toolbar().injectExpandCollapseAllButton();

      // Watch for budget textareas (with error handling).
      //
      // Coalesced onto one animation frame. initializeFields() is expensive —
      // it queries every textarea and walks ancestors calling getComputedStyle
      // — and it MUTATES the DOM (sweeping and embedding toolbars), so running
      // it inline per mutation means our own writes re-trigger us. React
      // re-rendering a large document fires mutations in bursts; one pass per
      // frame is enough and keeps the two from fighting. Same shape as
      // budget-row-highlight's `() => schedule()`.
      observer = new MutationObserver(() => {
        if (pendingScan) return;
        pendingScan = requestAnimationFrame(() => {
          pendingScan = null;
          try {
            initializeFields();
            // Re-inject expand/collapse all button if budget header re-renders
            Toolbar().injectExpandCollapseAllButton();
          } catch (error) {
            console.error('Formatter: Error in MutationObserver callback:', error);
          }
        });
      });

      observer.observe(document.body, {
        childList: true,
        subtree: true
      });

      // Handle window scroll and resize
      window.addEventListener('scroll', handleScroll, true);
      window.addEventListener('resize', handleResize);
      document.addEventListener('click', handleGlobalClick, true);
      // Use capture phase to catch Enter before React's handlers
      document.addEventListener('keydown', handleKeydown, true);

      console.log('Formatter: Activated');
    } catch (error) {
      console.error('Formatter: Error during initialization:', error);
      isActive = false;
      throw error;
    }
  }

  // Cleanup the feature
  function cleanup() {
    if (!isActive) {
      return;
    }

    isActive = false;

    // Remove toolbar if exists (using module)
    Toolbar().hideToolbar();

    // Remove expand/collapse all button
    Toolbar().removeExpandCollapseAllButton();

    // Disconnect observer
    if (observer) {
      observer.disconnect();
      observer = null;
    }

    // Cancel any scan queued for the next frame — otherwise it runs after
    // cleanup and re-embeds toolbars for a feature that is now off.
    if (pendingScan !== null) {
      cancelAnimationFrame(pendingScan);
      pendingScan = null;
    }

    // Tear down every embedded toolbar, disconnecting its ResizeObserver.
    // Without this, turning the formatter off left the toolbars — and the
    // observers pinning them in memory — behind until a page reload.
    document.querySelectorAll('.jt-formatter-toolbar-embedded').forEach(toolbar => {
      Toolbar().destroyToolbar(toolbar);
    });

    // Remove event listeners
    window.removeEventListener('scroll', handleScroll, true);
    window.removeEventListener('resize', handleResize);
    document.removeEventListener('click', handleGlobalClick, true);
    document.removeEventListener('keydown', handleKeydown, true);

    // ai-assist.js is a module, not a feature, so it has no cleanup of its
    // own — the Formatter owns reversing it. v2 never hides or appends
    // anything of its own to the DOM, so the only state it can leave behind
    // is an active watch for "Use This" (a document click listener plus a
    // MutationObserver) while the user is mid-conversation with JobTread's
    // own Writing Assistant. detach() drops both without touching the
    // composer itself — it's the user's now, visible, and theirs to close.
    Toolbar().clearAiError();
    if (window.FormatterAiAssist) {
      window.FormatterAiAssist.detach();
    }

    // Remove injected CSS
    if (styleElement) {
      styleElement.remove();
      styleElement = null;
    }

    // Remove event listeners and formatter markers from fields
    const fields = document.querySelectorAll('textarea[data-formatter-ready="true"]');
    fields.forEach(field => {
      // Abort all event listeners for this field
      const controller = fieldControllers.get(field);
      if (controller) {
        controller.abort();
        fieldControllers.delete(field);
      }
      delete field.dataset.formatterReady;
    });

    console.log('Formatter: Deactivated');
  }

  // Inject CSS dynamically
  function injectCSS() {
    if (styleElement) return;

    styleElement = document.createElement('link');
    styleElement.rel = 'stylesheet';
    styleElement.href = chrome.runtime.getURL('styles/formatter-toolbar.css');
    document.head.appendChild(styleElement);
  }

  // Initialize fields
  function initializeFields() {
    if (!isActive) return;

    // Skip if on excluded paths (but NOT documents or catalog - sidebar fields are allowed there)
    const path = window.location.pathname;
    if (path.includes('/settings') || path.includes('/plans')) {
      return;
    }

    // Don't re-initialize while we're inserting text - prevents interference
    if (Formats().isInserting && Formats().isInserting()) {
      return;
    }

    // Clean up stale references (using Toolbar module)
    const activeField = Toolbar().getActiveField();
    const activeToolbar = Toolbar().getActiveToolbar();
    if (activeField && !document.body.contains(activeField)) {
      Toolbar().setActiveField(null);
    }
    if (activeToolbar && !document.body.contains(activeToolbar)) {
      Toolbar().hideToolbar();
    }

    // Clean up orphaned embedded toolbars whose associated fields no longer exist in the DOM
    // This prevents "ghost" toolbars from accumulating when React re-renders budget tables
    // Budget adaptive toolbars are appended to document.body and are NOT removed by React
    // Torn down via destroyToolbar so each toolbar's ResizeObserver is
    // disconnected — a bare .remove() leaves the observer holding the detached
    // toolbar alive, which is what wedged the tab on React-heavy documents.
    const allEmbeddedToolbars = document.querySelectorAll('.jt-formatter-toolbar-embedded');
    allEmbeddedToolbars.forEach(toolbar => {
      const fieldId = toolbar.dataset.forField;
      if (fieldId) {
        const associatedField = document.querySelector(`[data-formatter-id="${fieldId}"]`);
        if (!associatedField || !document.body.contains(associatedField)) {
          Toolbar().destroyToolbar(toolbar);
        }
      } else if (toolbar.parentElement === document.body) {
        // Body-appended toolbar with no field association — orphaned, remove it
        Toolbar().destroyToolbar(toolbar);
      }
    });

    // Defense-in-depth: sweep away any embedded toolbar that landed INSIDE a
    // budget/catalog table row (only possible via a mid-navigation race). Correct
    // budget Description toolbars are body-appended, so this never touches them.
    Toolbar().removeStrayBudgetToolbars();

    // Find all textareas that should have the formatter
    const fields = [];

    // 1. Budget Description fields
    const descriptionFields = document.querySelectorAll('textarea[placeholder="Description"]');
    fields.push(...descriptionFields);

    // 2. Message fields
    const messageFields = document.querySelectorAll('textarea[placeholder="Message"]');
    fields.push(...messageFields);

    // 3. ALL Daily Log fields, Todo descriptions, Task descriptions
    // (any textarea inside label with bold heading)
    const labels = document.querySelectorAll('label');
    labels.forEach(label => {
      // Check if this label has any bold heading
      const heading = label.querySelector('div.font-bold');
      if (heading && heading.textContent.trim().length > 0) {
        // Find ALL textareas in this label (for multi-text custom fields)
        const textareas = label.querySelectorAll('textarea');
        textareas.forEach(textarea => {
          if (textarea && !fields.includes(textarea)) {
            fields.push(textarea);
          }
        });
      }
    });

    // 4. Daily Log EDIT fields (textareas with transparent color and formatting overlay)
    const allTextareas = document.querySelectorAll('textarea');
    allTextareas.forEach(textarea => {
      if (!fields.includes(textarea)) {
        const hasTransparentColor = textarea.style.color === 'transparent';
        if (hasTransparentColor) {
          const parent = textarea.parentElement;
          if (parent) {
            // Look for a sibling div with pointer-events-none (the formatting overlay)
            const siblings = parent.querySelectorAll('div');
            for (const sibling of siblings) {
              const styles = window.getComputedStyle(sibling);
              if (styles.pointerEvents === 'none' && sibling !== textarea) {
                fields.push(textarea);
                break;
              }
            }
          }
        }
      }
    });

    // 5. Modal/form textareas with min-height styling (alert builder, etc.)
    const modalTextareas = document.querySelectorAll('textarea.min-h-\\[3\\.75rem\\]');
    modalTextareas.forEach(textarea => {
      if (!fields.includes(textarea)) {
        fields.push(textarea);
      }
    });

    // 6. Textareas with caret-black class (common in JobTread forms)
    const caretBlackTextareas = document.querySelectorAll('textarea.caret-black');
    caretBlackTextareas.forEach(textarea => {
      if (!fields.includes(textarea)) {
        fields.push(textarea);
      }
    });

    // 7. Budget/Catalog table editing textareas (any textarea inside a .flex.min-w-max row).
    // JT may create an editing textarea (possibly without transparent color / overlay) in the
    // Description column when the user clicks a cell to edit existing content.
    // Collecting all table-row textareas here ensures focus events are captured;
    // non-Description ones naturally get no toolbar (embedToolbarForField returns null for them).
    if (path.endsWith('/budget') || path.includes('/catalog')) {
      document.querySelectorAll('.flex.min-w-max textarea').forEach(textarea => {
        if (!fields.includes(textarea)) {
          fields.push(textarea);
        }
      });
    }

    // Filter out time entry notes fields, Time Clock notes fields, and subtask fields
    const filteredFields = fields.filter(field => {
      // Exclude textareas explicitly marked to skip formatter
      if (field.dataset.jtNoFormatter === 'true' ||
          field.hasAttribute('data-jt-no-formatter')) {
        return false;
      }

      // Exclude textareas inside our own Alert modal
      if (field.closest('.jt-alert-modal') ||
          field.closest('.jt-alert-modal-overlay') ||
          field.classList.contains('jt-alert-message')) {
        return false;
      }

      const placeholder = field.getAttribute('placeholder');
      if (placeholder === 'Set notes') {
        return false; // Exclude time entry notes
      }

      // Exclude Name field in budget table
      if (placeholder === 'Name') {
        return false;
      }

      // Exclude subtask/checklist fields
      if (placeholder === 'Add an item...' || placeholder === 'Add an item') {
        return false;
      }

      // Check if textarea is inside a checklist/subtask container
      let ancestor = field.closest('div');
      for (let i = 0; i < 10 && ancestor; i++) {
        const heading = ancestor.querySelector(':scope > div > .font-bold');
        if (heading && heading.textContent.trim() === 'Checklist') {
          return false; // This is a subtask field
        }
        ancestor = ancestor.parentElement;
      }

      // Exclude subtask fields by small padding (p-1 without p-2)
      if (field.classList.contains('p-1') && !field.classList.contains('p-2') && field.style.color === 'transparent') {
        return false;
      }

      // Exclude fields in Job Parameters popup
      const jobParamsPopup = field.closest('div.shadow-lg.rounded-sm.bg-white');
      if (jobParamsPopup) {
        const popupHeader = jobParamsPopup.querySelector('div.font-bold.text-cyan-500.uppercase');
        if (popupHeader && popupHeader.textContent.trim() === 'Job Parameters') {
          return false;
        }
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

      // Exclude document metadata fields (signature, prepared by, terms, etc.)
      // These fields should NEVER have the formatter regardless of URL path
      {
        const metaLabel = field.closest('label');
        if (metaLabel) {
          const metaHeading = metaLabel.querySelector('div.font-bold');
          if (metaHeading) {
            const headingText = metaHeading.textContent.trim().toLowerCase();
            const documentMetadataLabels = [
              'signature', 'prepared by', 'prepared for',
              'signed by', 'from', 'to', 'bill to', 'ship to',
              'remit to', 'terms', 'footer', 'header', 'memo'
            ];
            if (documentMetadataLabels.includes(headingText)) {
              return false;
            }
          }
        }
      }

      // In Cost Item / Cost Group sidebars, only the built-in "Description"
      // field should have the formatter. Custom fields (Internal Notes,
      // Construction Specs, Product Specs, Supplier, Trade Partner Notes,
      // PM Notes, etc.) are also labeled with bold headings and would
      // otherwise match the generic "textarea inside bold-headed label" rule.
      if (Detection().isInCostItemDetailsSidebar && Detection().isInCostItemDetailsSidebar(field)) {
        const sidebarLabel = field.closest('label');
        const sidebarHeading = sidebarLabel?.querySelector('div.font-bold');
        const headingText = sidebarHeading?.textContent.trim();
        if (headingText && headingText !== 'Description') {
          return false;
        }
      }

      // On catalog pages, ONLY allow the formatter on fields that truly are
      // Description fields. Accept either:
      //   1. placeholder="Description" (inline cost item Description in table)
      //   2. Label heading "Description" (sidebar Description — already filtered above)
      // Everything else (Template Description, Name, custom fields, etc.) gets rejected.
      if (path.includes('/catalog')) {
        if (placeholder !== 'Description') {
          const catalogLabel = field.closest('label');
          const catalogHeading = catalogLabel?.querySelector('div.font-bold');
          const catalogHeadingText = catalogHeading?.textContent.trim();
          if (catalogHeadingText !== 'Description') {
            return false;
          }
        }
      }

      // Exclude file description fields in file edit forms/modals
      // File edit forms have both Name and Description textareas as siblings
      // Budget Description fields are inline (not in file edit forms) so they're safe
      if (field.closest('.m-auto') && path.includes('/files')) {
        return false;
      }
      if (placeholder === 'Description') {
        // Only check form or space-y-1 containers (file edit forms)
        // NOT border-b — budget table rows have border-b and contain Name + Description
        const parentContainer = field.closest('form') || field.closest('div.space-y-1');
        if (parentContainer && parentContainer.querySelector('textarea[placeholder="Name"]')) {
          return false; // This is a file edit form, not a budget description
        }
      }

      // Exclude fields inside sidebar forms/panels with orange headers (Add Time Entry, Time Clock, etc.)
      // Exception: Budget and Catalog pages — their forms also have orange headers but SHOULD have the formatter
      // Exception: Selection-group option editors (label.cursor-pointer.block + bold heading)
      // live inside an orange-headered sidebar but their Description field should still
      // get the formatter — same pattern as Cost Item Details.
      // Check drag-scroll-boundary FIRST (broader container that holds both the orange header
      // and the form — e.g. Time Clock has the header outside <form> but inside the boundary)
      // Then fall back to <form> for cases where the header IS inside the form
      if (!path.endsWith('/budget') && !path.includes('/catalog')) {
        const isSelectionGroupField = Detection().isInSelectionGroupOption &&
                                      Detection().isInSelectionGroupOption(field);
        if (!isSelectionGroupField) {
          const sidebarContainer = field.closest('[data-is-drag-scroll-boundary="true"]') || field.closest('form');
          if (sidebarContainer) {
            const orangeHeader = sidebarContainer.querySelector('div.font-bold.text-jtOrange.uppercase');
            if (orangeHeader) {
              // Exception: Cost Item Details supports markdown — allow formatter there
              const headerText = orangeHeader.textContent.trim().toLowerCase();
              if (headerText !== 'cost item details') {
                return false;
              }
            }
          }
        }
      }

      // Exclude fields inside document content blocks (signature/acceptance sections)
      if (field.closest('div.border-2.break-inside-avoid')) {
        return false;
      }

      // CRITICAL: Exclude fields in the ADD / EDIT ITEMS table (Documents page only)
      // NOTE: Budget page has similar structure but SHOULD have the formatter
      // Use the Detection module for reliable detection
      if (window.FormatterDetection && window.FormatterDetection.isInAddEditItemsTable) {
        if (window.FormatterDetection.isInAddEditItemsTable(field)) {
          return false;
        }
      } else {
        // Fallback: Check for flex.min-w-max table row with multiple styled columns
        // But NOT on Budget or Catalog pages - those table fields should have formatter
        if (!path.endsWith('/budget') && !path.includes('/catalog')) {
          const tableRow = field.closest('.flex.min-w-max');
          if (tableRow) {
            const styledColumns = tableRow.querySelectorAll(':scope > div[style*="width"]');
            if (styledColumns.length >= 3) {
              return false;
            }
          }
        }
      }

      // CRITICAL: On document-type pages (documents, invoices, estimates, etc.),
      // exclude ALL fields in the main document area - only allow sidebar fields
      // This covers "Prepared by", "Prepared for", "Invoice details", etc.
      const isDocumentTypePage = path.includes('/documents') ||
                                  path.includes('/invoices') ||
                                  path.includes('/estimates') ||
                                  path.includes('/proposals') ||
                                  path.includes('/contracts') ||
                                  path.includes('/purchase-orders');

      if (isDocumentTypePage) {
        // Use Detection module's isFormatterField for comprehensive sidebar check
        if (Detection().isFormatterField) {
          return Detection().isFormatterField(field);
        }
        // Fallback: allow Message fields, exclude everything else on document-type pages
        const fieldPlaceholder = field.getAttribute('placeholder');
        if (fieldPlaceholder === 'Message') {
          return true;
        }
        return false;
      }

      // Extra guard: ensure no native formatter exists (using Detection module)
      return !Detection().hasNativeFormatter(field);
    });

    // Clean up toolbars on fields that were previously attached but are now
    // rejected by the filter (e.g., custom fields in Cost Item sidebar after
    // the Description-only rule was added). Without this, stale toolbars
    // persist in the DOM until the sidebar is closed and reopened.
    const filteredSet = new Set(filteredFields);
    fields.forEach(field => {
      if (!filteredSet.has(field) && field.dataset.formatterReady === 'true') {
        const fmtId = field.dataset.formatterId;
        if (fmtId) {
          const staleToolbar = document.querySelector(`.jt-formatter-toolbar-embedded[data-for-field="${fmtId}"]`);
          if (staleToolbar) Toolbar().destroyToolbar(staleToolbar);
        }
        const controller = fieldControllers.get(field);
        if (controller) {
          controller.abort();
          fieldControllers.delete(field);
        }
        delete field.dataset.formatterReady;
        delete field.dataset.formatterId;
      }
    });

    filteredFields.forEach((field) => {
      // Use WeakMap as source of truth — not the DOM attribute.
      // React can swap DOM elements while preserving attributes, leaving
      // data-formatter-ready="true" on a NEW element that has no listeners.
      //
      // Safety: also re-initialize if the AbortController was aborted
      // (listeners are silently removed when the signal is aborted).
      if (fieldControllers.has(field)) {
        const ctrl = fieldControllers.get(field);
        if (ctrl && ctrl.signal.aborted) {
          fieldControllers.delete(field);
          delete field.dataset.formatterReady;
        }
      }

      if (!fieldControllers.has(field) && document.body.contains(field)) {
        // Clean up stale attribute if present
        delete field.dataset.formatterReady;
        field.dataset.formatterReady = 'true';

        // Create AbortController for this field's event listeners
        const controller = new AbortController();
        const signal = controller.signal;
        fieldControllers.set(field, controller);

        // Add event listeners with AbortSignal for automatic cleanup
        field.addEventListener('focus', (e) => handleFieldFocus(e, field), { signal });
        field.addEventListener('mousedown', (e) => handleFieldMousedown(e, field), { signal });
        field.addEventListener('blur', (e) => handleFieldBlur(e, field), { signal });
        field.addEventListener('input', () => handleFieldInput(field), { signal });
        field.addEventListener('click', () => handleFieldClick(field), { signal });
        field.addEventListener('keyup', () => handleFieldKeyup(field), { signal });
        // Use select event for more reliable cursor/selection change detection
        field.addEventListener('select', () => handleFieldSelectionChange(field), { signal });

        // Pre-create embedded toolbar for non-budget-table fields
        // This makes the toolbar visible on page load, not just on focus
        // Skip fields that aren't visible (e.g., in collapsed budget groups) —
        // their toolbar will be created on-demand when focused via showToolbar()
        if (Toolbar().embedToolbarForField && field.offsetParent !== null) {
          // embedToolbarForField returns null for non-Description budget table fields
          // Budget Description fields get a body-appended adaptive toolbar
          Toolbar().embedToolbarForField(field);
        }

        // Race condition fix: if this field is already focused (e.g., React
        // created and focused the textarea before our MutationObserver fired),
        // the focus event already happened before our listener was attached.
        // Trigger the focus handler immediately so the toolbar appears.
        if (document.activeElement === field) {
          handleFieldFocus({ target: field }, field);
        }

        // Defensive fix: if JT set color:transparent on the textarea (overlay rendering mode)
        // but the overlay sibling isn't present, the user's text will be invisible.
        // Wait briefly for JT's React to render, then restore text visibility as a fallback.
        if (field.style.color === 'transparent') {
          const checkOverlay = () => {
            const parent = field.parentElement;
            if (!parent || !document.body.contains(field)) return;
            const siblings = parent.querySelectorAll(':scope > div');
            let hasOverlay = false;
            for (const sibling of siblings) {
              if (window.getComputedStyle(sibling).pointerEvents === 'none') {
                hasOverlay = true;
                break;
              }
            }
            if (!hasOverlay && field.style.color === 'transparent') {
              field.style.setProperty('color', 'inherit', 'important');
              console.log('Formatter: Restored text visibility — JT overlay not rendering');
            }
          };
          // Allow time for JT's React to mount the overlay div
          setTimeout(checkOverlay, 1000);
        }
      }
    });
  }

  // Event handlers (using modules)
  function handleFieldFocus(e, field) {
    Toolbar().clearHideTimeout();
    Toolbar().setActiveField(field);
    Toolbar().showToolbar(field);

    setTimeout(() => {
      const activeField = Toolbar().getActiveField();
      const activeToolbar = Toolbar().getActiveToolbar();
      if (activeField === field && activeToolbar) {
        Toolbar().positionToolbar(activeToolbar, field);
      }
    }, 50);
  }

  function handleFieldMousedown(e, field) {
    const activeField = Toolbar().getActiveField();
    if (activeField !== field) {
      Toolbar().clearHideTimeout();
      Toolbar().setActiveField(field);

      setTimeout(() => {
        if (Toolbar().getActiveField() === field) {
          Toolbar().showToolbar(field);
        }
      }, 10);
    }
  }

  function handleFieldBlur(e, field) {
    // Don't hide toolbar if we're prompting user
    if (Formats().isPrompting()) {
      return;
    }

    Toolbar().scheduleHide(200);
  }

  function handleFieldInput(field) {
    const activeToolbar = Toolbar().getActiveToolbar();
    const activeField = Toolbar().getActiveField();
    if (activeToolbar && activeField === field) {
      Toolbar().positionToolbar(activeToolbar, field);
      Toolbar().updateToolbarState(field, activeToolbar);
    }
  }

  function handleFieldClick(field) {
    const activeToolbar = Toolbar().getActiveToolbar();
    const activeField = Toolbar().getActiveField();
    if (activeToolbar && activeField === field) {
      Toolbar().updateToolbarState(field, activeToolbar);
    }
  }

  function handleFieldKeyup(field) {
    const activeToolbar = Toolbar().getActiveToolbar();
    const activeField = Toolbar().getActiveField();
    if (activeToolbar && activeField === field) {
      Toolbar().updateToolbarState(field, activeToolbar);
    }
  }

  function handleFieldSelectionChange(field) {
    const activeToolbar = Toolbar().getActiveToolbar();
    const activeField = Toolbar().getActiveField();
    if (activeToolbar && activeField === field) {
      Toolbar().updateToolbarState(field, activeToolbar);
    }
  }

  // Resolve the currently active toolbar/field pair for repositioning.
  // Hides the toolbar (and returns null) if either element has been removed
  // from the DOM, and returns null unless both are present.
  function getActivePositioningPair() {
    const activeToolbar = Toolbar().getActiveToolbar();
    const activeField = Toolbar().getActiveField();

    if (activeToolbar && !document.body.contains(activeToolbar)) {
      Toolbar().hideToolbar();
      return null;
    }
    if (activeField && !document.body.contains(activeField)) {
      Toolbar().hideToolbar();
      return null;
    }

    if (activeToolbar && activeField) {
      return { toolbar: activeToolbar, field: activeField };
    }
    return null;
  }

  function handleScroll() {
    const pair = getActivePositioningPair();
    if (!pair) return;

    Toolbar().positionToolbar(pair.toolbar, pair.field);

    if (scrollTimeout) {
      clearTimeout(scrollTimeout);
    }
    scrollTimeout = setTimeout(() => {
      const toolbar = Toolbar().getActiveToolbar();
      const field = Toolbar().getActiveField();
      if (toolbar && field &&
          document.body.contains(toolbar) &&
          document.body.contains(field)) {
        Toolbar().positionToolbar(toolbar, field);
      }
    }, 100);
  }

  function handleResize() {
    const pair = getActivePositioningPair();
    if (!pair) return;

    Toolbar().positionToolbar(pair.toolbar, pair.field);
  }

  function handleGlobalClick(e) {
    const clickedElement = e.target;

    // ai-assist.js drives JobTread's OWN controls — the "Message" composer
    // trigger, the Writing Assistant, Proofread/Rewrite, Close. Those are
    // JobTread's markup, so no allowlist clause below can name them, and
    // this capture-phase handler would read each one as "the user clicked
    // away" and tear the toolbar down in the middle of the round-trip the
    // click is part of. isDriving() is true only for the synchronous
    // duration of one such synthetic click, so a real user click during the
    // round-trip still dismisses the toolbar normally.
    const ai = window.FormatterAiAssist;
    if (ai && typeof ai.isDriving === 'function' && ai.isDriving()) {
      return;
    }

    // Don't hide if clicking on a formatter-ready field or the toolbar
    // Use data-formatter-ready attribute for more reliable detection
    //
    // .jt-overflow-dropdown is part of the toolbar despite not being a
    // descendant of it — setupResponsiveToolbar reparents it onto
    // document.body so a transformed ancestor cannot capture its `position:
    // fixed` containing block. This listener is registered on the CAPTURE
    // phase, so it runs before the clicked button's own handler and the
    // stopPropagation() there cannot hold it back: without this clause,
    // clicking any overflowed button (the colours overflow first) hid the
    // toolbar before the insert ran — nulling activeField, and on a budget
    // Description field destroying the dropdown mid-click.
    //
    // ai-assist.js v2 no longer appends anything of its own to document.body
    // (no menu, no review panel — JobTread's own Writing Assistant and its
    // "Use This" are the whole UI), so there is no clause to add here for it.
    if (clickedElement.closest('[data-formatter-ready="true"]') ||
        clickedElement.closest('.jt-formatter-toolbar') ||
        clickedElement.closest('.jt-overflow-dropdown') ||
        clickedElement.closest('.jt-formatter-toolbar-embedded')) {
      return;
    }

    const activeToolbar = Toolbar().getActiveToolbar();
    const activeField = Toolbar().getActiveField();
    if (activeToolbar && activeField) {
      Toolbar().hideToolbar();
    }
  }

  function handleKeydown(e) {
    const field = e.target;

    // Only apply to formatter fields (using Detection module)
    if (!Detection().isFormatterField(field)) return;

    // Handle Enter key for auto-numbering (using Formats module)
    if (e.key === 'Enter') {
      const handled = Formats().handleEnterKey(field, e);
      if (handled) return;
    }

    // Handle keyboard shortcuts (Ctrl/Cmd + B/I/U)
    const isMac = navigator.platform.toUpperCase().indexOf('MAC') >= 0;
    const modifier = isMac ? e.metaKey : e.ctrlKey;

    if (!modifier) return;

    let format = null;

    switch(e.key.toLowerCase()) {
      case 'b':
        format = 'bold';
        break;
      case 'i':
        format = 'italic';
        break;
      case 'u':
        format = 'underline';
        break;
    }

    if (format) {
      e.preventDefault();
      e.stopPropagation();
      e.stopImmediatePropagation();
      Formats().applyFormat(field, format);
      const activeToolbar = Toolbar().getActiveToolbar();
      if (activeToolbar) {
        Toolbar().updateToolbarState(field, activeToolbar);
      }
    }
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
  window.FormatterFeature = FormatterFeature;
}
