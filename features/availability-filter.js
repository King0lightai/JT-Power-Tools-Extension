/**
 * JT Power Tools - Availability Filter Feature
 * Filters assignees in the Schedule Availability view by role/department or category (Internal/Vendor)
 *
 * @module AvailabilityFilterFeature
 * @version 1.0.0
 * @requires TimingUtils
 */

const AvailabilityFilterFeature = (() => {
  let isActiveState = false;
  let observer = null;
  let urlCheckInterval = null;
  let styleElement = null;
  let filterContainer = null;
  let debouncedScanAndBuild = null;

  // Storage keys for persisting filter selections and saved views
  const STORAGE_KEY = 'jtAvailabilityFilterSelections';
  const SAVED_VIEWS_KEY = 'jtAvailabilityFilterSavedViews';

  // Persist to chrome.storage.LOCAL, not sync. Each saved view stores a full
  // snapshot of every category + assignee on/off state; on an org with a large
  // VENDOR list this easily exceeds sync's 8KB-per-item quota
  // (QUOTA_BYTES_PER_ITEM = 8192), making set() reject and the save silently
  // fail. local has a ~10MB budget and no per-item cap. Trade-off: views no
  // longer roam across devices — acceptable given the data size and that the
  // alternative was "saves don't persist at all."
  const filterStore = chrome.storage.local;

  // Track current filters
  // Structure: { categories: { 'INTERNAL': true }, assignees: { 'INTERNAL': { '01 Field': true } } }
  let currentFilters = {
    categories: {},
    assignees: {}
  };

  // Track detected assignee data - per category
  const detectedCategories = new Set();
  let detectedAssigneesByCategory = {}; // e.g., { 'INTERNAL': Set(['01 Field', ...]), 'VENDOR': Set(['ABC Co', ...]) }

  // Guard flag: prevents observer-triggered rebuild from clobbering a saved view application
  let _applyingView = false;

  // Preserve collapsed/expanded state across UI rebuilds
  let _isCollapsed = true;

  // Track global click listener for cleanup
  let _outsideClickHandler = null;

  // Perf: signature of the last-built assignee set. JT re-renders the whole
  // assignment table on every week switch, but the people don't change — so
  // we skip the expensive chip rebuild when the set is identical and only
  // re-hide rows. requestAnimationFrame coalesces the burst of mutations into
  // one applyFilters() that runs BEFORE the next paint, so filtered rows never
  // flash visible.
  let _lastSignature = null;
  let _rafId = null;

  // Searchable assignee dropdown (singleton popover appended to body). ONE
  // element is reused for every category — repopulated on open — which avoids
  // the orphaned-node accumulation that per-category dropdowns would cause
  // across rebuilds. Replaces the old inline pill drawer.
  let _assigneeDropdown = null;
  let _assigneeDropdownCategory = null;
  let _assigneeAnchorChip = null;
  let _assigneeHighlightIndex = -1;
  // Bound scroll/resize handler that keeps the open dropdown glued to its
  // anchor chip (and closes it if the chip scrolls out of view) so the popup
  // stays locked to the header instead of floating over the scrolling grid.
  let _assigneeReposition = null;

  /**
   * Check if we're on the Schedule Availability view
   */
  function isAvailabilityView() {
    // Must be on schedule page
    if (!window.location.pathname.includes('/schedule')) {
      return false;
    }

    // Check for Availability view indicator - the button/dropdown that says "Availability"
    const availabilityBtn = document.querySelector('button[class*="flex"][class*="items-center"]');
    if (availabilityBtn && availabilityBtn.textContent.includes('Availability')) {
      return true;
    }

    // Alternative check: look for the assignee sidebar structure
    const assigneeSidebar = document.querySelector('div.text-xs.uppercase.truncate.p-1.border-b.font-bold.text-jtOrange');
    if (assigneeSidebar) {
      return true;
    }

    // Check for the availability table structure with assignee rows
    const assigneeRows = document.querySelectorAll('tr[class*="group"]');
    for (const row of assigneeRows) {
      const roleCell = row.querySelector('div.truncate');
      if (roleCell && /^\d{2}\s/.test(roleCell.textContent.trim())) {
        return true;
      }
    }

    return false;
  }

  /**
   * A "navigation key" for the current URL with the transient `taskId` param
   * removed. Opening/closing a task sidebar only toggles ?taskId=, which is
   * NOT a real navigation — using this key for URL-change detection keeps the
   * filter bar from tearing down and rebuilding every time a task opens.
   */
  function navKeyIgnoringTask(href) {
    try {
      const u = new URL(href);
      u.searchParams.delete('taskId');
      return `${u.pathname}?${u.searchParams.toString()}`;
    } catch (e) {
      return href;
    }
  }

  /**
   * Scan the page for categories and their assignees
   *
   * Structure:
   * - Each category (INTERNAL, VENDOR, ZZ ASSIGNEE PLACEHOLDER, etc.) has assignees under it
   * - For INTERNAL: we use the ROLE as the child identifier (01 Field, 02 Project Supervisor, etc.)
   * - For all other categories: we use the assignee NAME as the child identifier
   *
   * IMPORTANT: The first assignee can be in the SAME row as the category header!
   * We need to check for assignee cards in header rows too.
   */
  function scanForFilters() {
    detectedCategories.clear();
    detectedAssigneesByCategory = {};

    // Find all orange category headers
    const categoryHeaders = document.querySelectorAll('div.text-xs.uppercase.truncate.p-1.border-b.font-bold');

    categoryHeaders.forEach(header => {
      const text = header.textContent.trim().toUpperCase();
      if (text && text.length > 0 && text.length < 50) {
        detectedCategories.add(text);
        detectedAssigneesByCategory[text] = new Set();
      }
    });

    // Now scan table rows to collect assignees per category
    // We need to track which section we're in as we iterate
    let currentCategory = null;

    const tableRows = document.querySelectorAll('tbody tr');
    tableRows.forEach(row => {
      const firstCell = row.querySelector('td:first-child');
      if (!firstCell) return;

      // Check if this row contains a category header (orange text)
      const categoryHeader = firstCell.querySelector('.text-jtOrange') ||
                            firstCell.querySelector('[class*="text-jtOrange"]');

      if (categoryHeader) {
        // This is a category header row - update current section
        currentCategory = categoryHeader.textContent.trim().toUpperCase();

        // Ensure the category exists in our tracking
        if (!detectedAssigneesByCategory[currentCategory]) {
          detectedAssigneesByCategory[currentCategory] = new Set();
        }

        // IMPORTANT: The first assignee might be in this same row!
        // Check for assignee cards in this row
        const assigneeCards = firstCell.querySelectorAll('div.p-1.flex.items-center.space-x-1');
        assigneeCards.forEach(card => {
          const childIdentifier = getAssigneeIdentifier(card, currentCategory);
          if (childIdentifier) {
            detectedAssigneesByCategory[currentCategory].add(childIdentifier);
          }
        });
        return;
      }

      // Collect from pure assignee rows (no header)
      if (currentCategory && detectedAssigneesByCategory[currentCategory]) {
        const assigneeCards = firstCell.querySelectorAll('div.p-1.flex.items-center.space-x-1');
        assigneeCards.forEach(card => {
          const childIdentifier = getAssigneeIdentifier(card, currentCategory);
          if (childIdentifier) {
            detectedAssigneesByCategory[currentCategory].add(childIdentifier);
          }
        });
      }
    });

    console.log('AvailabilityFilter: Detected categories:', Array.from(detectedCategories));
    console.log('AvailabilityFilter: Detected assignees by category:',
      Object.fromEntries(
        Object.entries(detectedAssigneesByCategory).map(([k, v]) => [k, Array.from(v)])
      )
    );

    return {
      categories: Array.from(detectedCategories).sort(),
      assigneesByCategory: Object.fromEntries(
        Object.entries(detectedAssigneesByCategory).map(([k, v]) => [k, Array.from(v).sort()])
      )
    };
  }

  /**
   * Get the identifier for an assignee card based on category
   * - For INTERNAL: use role (e.g., "01 Field") - the non-bold text below the name
   * - For VENDOR: use vendor company name (the link text below the contact name)
   * - For all others: use the name (bold text)
   *
   * Card structure:
   * - INTERNAL: [Avatar] [Name (bold)] [Role (non-bold truncate)]
   * - VENDOR: [Avatar] [Contact Name (bold)] [Vendor Company (link)]
   * - Others: [Avatar] [Name (bold)] [optional subtitle]
   */
  function getAssigneeIdentifier(card, category) {
    if (category === 'INTERNAL') {
      // For internal, use the role (non-bold truncate div)
      const roleDiv = card.querySelector('div.truncate:not(.font-bold)');
      if (roleDiv) {
        const roleText = roleDiv.textContent.trim();
        if (roleText && roleText.length > 0) {
          return roleText;
        }
      }
    } else {
      // For vendors and other categories, check for a link first (vendor company name)
      // Structure: <div class="truncate"><a href="/vendors/..." class="text-cyan-500">Vendor Name</a></div>
      const linkElement = card.querySelector('a[href*="/vendors"], a.text-cyan-500');
      if (linkElement) {
        const linkText = linkElement.textContent.trim();
        if (linkText && linkText.length > 0) {
          return linkText;
        }
      }

      // Fallback: use the name (bold truncate div) for categories without vendor links
      const nameDiv = card.querySelector('div.font-bold.truncate');
      if (nameDiv) {
        const nameText = nameDiv.textContent.trim();
        if (nameText && nameText.length > 0) {
          return nameText;
        }
      }
    }
    return null;
  }

  /**
   * Load saved filter selections from storage
   */
  // Defensive: strip __proto__/constructor/prototype keys from a plain object
  // loaded from storage to prevent prototype-pollution if a corrupt or
  // malicious sync payload ever reaches us. Chrome's storage serialization
  // already guards against direct prototype reassignment, but later code
  // that indexes by user-controlled keys (e.g. currentFilters.categories[k])
  // should never see these special names.
  function sanitizeStoredObject(obj) {
    if (!obj || typeof obj !== 'object') return {};
    const clean = Object.create(null);
    for (const key of Object.keys(obj)) {
      if (key === '__proto__' || key === 'constructor' || key === 'prototype') continue;
      const v = obj[key];
      clean[key] = (v && typeof v === 'object' && !Array.isArray(v))
        ? sanitizeStoredObject(v)
        : v;
    }
    return clean;
  }

  /**
   * One-time migration: earlier versions stored selections + saved views in
   * chrome.storage.sync, where large payloads hit the 8KB/item quota and
   * failed to save. Copy any existing sync data into local on first run so
   * users don't lose previously-saved views. Only copies keys not already
   * present in local (local always wins once it exists).
   */
  async function migrateFromSyncIfNeeded() {
    try {
      const local = await chrome.storage.local.get([STORAGE_KEY, SAVED_VIEWS_KEY]);
      const missing = local[STORAGE_KEY] === undefined || local[SAVED_VIEWS_KEY] === undefined;
      if (!missing) return;
      const sync = await chrome.storage.sync.get([STORAGE_KEY, SAVED_VIEWS_KEY]);
      const toSet = {};
      if (local[STORAGE_KEY] === undefined && sync[STORAGE_KEY] !== undefined) toSet[STORAGE_KEY] = sync[STORAGE_KEY];
      if (local[SAVED_VIEWS_KEY] === undefined && sync[SAVED_VIEWS_KEY] !== undefined) toSet[SAVED_VIEWS_KEY] = sync[SAVED_VIEWS_KEY];
      if (Object.keys(toSet).length > 0) {
        await chrome.storage.local.set(toSet);
        console.log('AvailabilityFilter: Migrated saved data from sync → local');
      }
    } catch (error) {
      console.error('AvailabilityFilter: Migration from sync failed (non-fatal):', error);
    }
  }

  async function loadFilterSelections() {
    try {
      const result = await filterStore.get([STORAGE_KEY]);
      if (result[STORAGE_KEY]) {
        const saved = result[STORAGE_KEY];
        currentFilters = {
          categories: sanitizeStoredObject(saved.categories),
          assignees: sanitizeStoredObject(saved.assignees)
        };

        // Migrate from old format (roles/vendors) to new format (assignees)
        if (saved.roles && Object.keys(saved.roles).length > 0) {
          if (!currentFilters.assignees['INTERNAL']) {
            currentFilters.assignees['INTERNAL'] = {};
          }
          Object.assign(currentFilters.assignees['INTERNAL'], saved.roles);
        }
        if (saved.vendors && Object.keys(saved.vendors).length > 0) {
          if (!currentFilters.assignees['VENDOR']) {
            currentFilters.assignees['VENDOR'] = {};
          }
          Object.assign(currentFilters.assignees['VENDOR'], saved.vendors);
        }

        console.log('AvailabilityFilter: Loaded saved filters:', currentFilters);
      }
    } catch (error) {
      console.error('AvailabilityFilter: Error loading filter selections:', error);
    }
  }

  /**
   * Save filter selections to storage
   */
  async function saveFilterSelections() {
    try {
      await filterStore.set({ [STORAGE_KEY]: currentFilters });
      console.log('AvailabilityFilter: Saved filter selections');
    } catch (error) {
      console.error('AvailabilityFilter: Error saving filter selections:', error);
    }
  }

  /**
   * Load saved views from storage
   */
  async function loadSavedViews() {
    try {
      const result = await filterStore.get([SAVED_VIEWS_KEY]);
      return result[SAVED_VIEWS_KEY] || [];
    } catch (error) {
      console.error('AvailabilityFilter: Error loading saved views:', error);
      return [];
    }
  }

  /**
   * Save a new view to storage
   */
  async function saveNewView(viewName) {
    try {
      const views = await loadSavedViews();
      const newView = {
        id: Date.now().toString(),
        name: viewName,
        filters: JSON.parse(JSON.stringify(currentFilters)), // Deep copy
        createdAt: new Date().toISOString()
      };
      views.push(newView);
      await filterStore.set({ [SAVED_VIEWS_KEY]: views });
      console.log('AvailabilityFilter: Saved new view:', viewName);
      return newView;
    } catch (error) {
      console.error('AvailabilityFilter: Error saving view:', error);
      return null;
    }
  }

  /**
   * Delete a saved view
   */
  async function deleteSavedView(viewId) {
    try {
      const views = await loadSavedViews();
      const filteredViews = views.filter(v => v.id !== viewId);
      await filterStore.set({ [SAVED_VIEWS_KEY]: filteredViews });
      console.log('AvailabilityFilter: Deleted view:', viewId);
      return true;
    } catch (error) {
      console.error('AvailabilityFilter: Error deleting view:', error);
      return false;
    }
  }

  /**
   * Apply a saved view
   */
  function applySavedView(view) {
    // Guard: prevent observer-triggered rebuild from clobbering this application
    _applyingView = true;

    // Deep copy the saved filters
    currentFilters = JSON.parse(JSON.stringify(view.filters));
    updateChipStates();
    applyFilters();
    saveFilterSelections();
    updateFilterBadge();
    console.log('AvailabilityFilter: Applied view:', view.name);

    // Clear guard after observer debounce window (300ms debounce + margin)
    setTimeout(() => { _applyingView = false; }, 500);
  }

  /**
   * Render saved views list inside the dropdown and attach event listeners
   */
  async function renderSavedViewsList(listContainer, viewsDropdown) {
    const views = await loadSavedViews();

    if (views.length === 0) {
      listContainer.innerHTML = '<div class="jt-avail-saved-views-empty">No saved views yet</div>';
    } else {
      listContainer.innerHTML = views.map(view => `
        <div class="jt-avail-saved-view-item" data-view-id="${escapeHtml(view.id)}">
          <span class="jt-avail-saved-view-name" title="Click to apply">${escapeHtml(view.name)}</span>
          <button class="jt-avail-saved-view-delete" title="Delete view" data-view-id="${escapeHtml(view.id)}">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <line x1="18" y1="6" x2="6" y2="18"></line>
              <line x1="6" y1="6" x2="18" y2="18"></line>
            </svg>
          </button>
        </div>
      `).join('');

      // Add click listeners to view items
      listContainer.querySelectorAll('.jt-avail-saved-view-name').forEach(item => {
        item.addEventListener('click', async (e) => {
          e.stopPropagation();
          const viewId = item.closest('.jt-avail-saved-view-item').dataset.viewId;
          const allViews = await loadSavedViews();
          const view = allViews.find(v => v.id === viewId);
          if (view) {
            applySavedView(view);
            viewsDropdown.classList.remove('open');
          }
        });
      });

      // Add click listeners to delete buttons
      listContainer.querySelectorAll('.jt-avail-saved-view-delete').forEach(btn => {
        btn.addEventListener('click', async (e) => {
          e.stopPropagation();
          const viewId = btn.dataset.viewId;
          if (confirm('Delete this saved view?')) {
            await deleteSavedView(viewId);
            // Re-render the list in place
            await renderSavedViewsList(listContainer, viewsDropdown);
          }
        });
      });
    }
  }

  /**
   * Setup saved views event listeners
   */
  function setupSavedViewsListeners() {
    if (!filterContainer) return;

    const viewsBtn = filterContainer.querySelector('.jt-avail-saved-views-btn');
    const viewsDropdown = filterContainer.querySelector('.jt-avail-saved-views-dropdown');
    const saveBtn = filterContainer.querySelector('.jt-avail-save-view-btn');

    if (!viewsBtn || !viewsDropdown) return;

    // Toggle dropdown on button click
    viewsBtn.addEventListener('click', async (e) => {
      e.stopPropagation();
      const isOpen = viewsDropdown.classList.contains('open');

      // Close dropdown if open
      if (isOpen) {
        viewsDropdown.classList.remove('open');
        return;
      }

      // Move dropdown to document.body to escape parent stacking context
      // (the filter container has position:relative + z-index which traps children)
      if (viewsDropdown.parentElement !== document.body) {
        document.body.appendChild(viewsDropdown);
      }

      // Position the dropdown below the button (using fixed positioning)
      const btnRect = viewsBtn.getBoundingClientRect();
      viewsDropdown.style.top = (btnRect.bottom + 4) + 'px';
      viewsDropdown.style.right = (window.innerWidth - btnRect.right) + 'px';

      // Load and render saved views
      const listContainer = viewsDropdown.querySelector('.jt-avail-saved-views-list');
      await renderSavedViewsList(listContainer, viewsDropdown);

      viewsDropdown.classList.add('open');
    });

    // Save current view button
    if (saveBtn) {
      saveBtn.addEventListener('click', async (e) => {
        e.stopPropagation();
        const viewName = prompt('Enter a name for this view:');
        if (viewName && viewName.trim()) {
          const saved = await saveNewView(viewName.trim());
          if (saved) {
            // Refresh the list so the new view shows immediately
            const listContainer = viewsDropdown.querySelector('.jt-avail-saved-views-list');
            if (listContainer) await renderSavedViewsList(listContainer, viewsDropdown);
          } else {
            // Don't fail silently — the old code swallowed storage errors,
            // which is exactly why "saves" appeared to vanish.
            alert('Could not save this view — a storage error occurred. Open the console (F12) for details.');
          }
          viewsDropdown.classList.remove('open');
        }
      });
    }

    // Close dropdown when clicking outside (remove previous listener to prevent leaks)
    if (_outsideClickHandler) {
      document.removeEventListener('click', _outsideClickHandler);
    }
    _outsideClickHandler = (e) => {
      // Check both the original container (button) and the dropdown itself (now on body)
      if (!e.target.closest('.jt-avail-saved-views-container') && !e.target.closest('.jt-avail-saved-views-dropdown')) {
        viewsDropdown.classList.remove('open');
      }
      // Close the assignee dropdown on any outside click. Inside-clicks
      // (dropdown + category chips) stopPropagation, so they never reach here.
      if (_assigneeDropdown && _assigneeDropdown.classList.contains('open') &&
          !e.target.closest('.jt-avail-assignee-dropdown') &&
          !e.target.closest('.category-chip')) {
        closeAssigneeDropdown();
      }
    };
    document.addEventListener('click', _outsideClickHandler);
  }

  /**
   * Initialize filter states for newly detected items
   */
  function initializeFilterStates(categories, assigneesByCategory) {
    // Initialize categories (default to visible)
    categories.forEach(cat => {
      if (currentFilters.categories[cat] === undefined) {
        currentFilters.categories[cat] = true;
      }
      // Initialize assignees object for this category
      if (!currentFilters.assignees[cat]) {
        currentFilters.assignees[cat] = {};
      }
    });

    // Initialize assignees per category (default to visible)
    Object.entries(assigneesByCategory).forEach(([category, assignees]) => {
      if (!currentFilters.assignees[category]) {
        currentFilters.assignees[category] = {};
      }
      assignees.forEach(assignee => {
        if (currentFilters.assignees[category][assignee] === undefined) {
          currentFilters.assignees[category][assignee] = true;
        }
      });
    });
  }

  /**
   * Create the filter UI container — compact single-row layout
   */
  function createFilterUI(categories, assigneesByCategory) {
    // A rebuild recreates the category chips, so any open dropdown's anchor
    // would dangle — close it first.
    closeAssigneeDropdown();

    // Preserve collapsed state from existing container before removing
    if (filterContainer) {
      _isCollapsed = filterContainer.classList.contains('collapsed');
      filterContainer.remove();
    }

    filterContainer = document.createElement('div');
    filterContainer.id = 'jt-availability-filter';
    filterContainer.className = 'jt-availability-filter-container' + (_isCollapsed ? ' collapsed' : '');

    // Count total active vs total assignees
    let totalAssignees = 0;
    let activeAssignees = 0;
    categories.forEach(cat => {
      const catAssignees = assigneesByCategory[cat] || [];
      const catFilters = currentFilters.assignees[cat] || {};
      totalAssignees += catAssignees.length;
      activeAssignees += catAssignees.filter(a => catFilters[a] !== false).length;
    });

    // Build compact inline chips — each category chip is now a dropdown
    // TRIGGER (caret affordance). Clicking opens a searchable, scrollable
    // assignee picker (see openAssigneeDropdown) instead of an inline pill row.
    let chipsHtml = '';
    categories.forEach(cat => {
      const isCatActive = currentFilters.categories[cat] !== false;
      const categoryAssignees = assigneesByCategory[cat] || [];
      const catAssigneeFilters = currentFilters.assignees[cat] || {};
      const activeChildCount = categoryAssignees.filter(a => catAssigneeFilters[a] !== false).length;
      const someChildrenActive = activeChildCount > 0 && activeChildCount < categoryAssignees.length;
      const hasAssignees = categoryAssignees.length > 0;

      chipsHtml += `
        <button class="jt-avail-filter-chip category-chip ${isCatActive ? 'active' : ''} ${someChildrenActive ? 'partial' : ''}"
                data-type="category"
                data-value="${escapeHtml(cat)}"
                ${hasAssignees ? 'data-has-assignees="1" aria-haspopup="listbox" aria-expanded="false"' : ''}
                title="${hasAssignees ? `Filter ${escapeHtml(cat)} assignees` : escapeHtml(cat)}">
          ${escapeHtml(cat)}
          ${hasAssignees ? `<span class="jt-avail-role-count">${activeChildCount}/${categoryAssignees.length}</span>` : ''}
          ${hasAssignees ? `<span class="jt-avail-chip-caret" aria-hidden="true">▾</span>` : ''}
        </button>`;
    });

    // Build the compact filter HTML — single row (no inline drawer; assignee
    // selection lives in the popover dropdown built lazily on body).
    const html = `
      <div class="jt-avail-filter-bar ${_isCollapsed ? 'collapsed' : ''}">
        <div class="jt-avail-bar-row">
          <span class="jt-avail-bar-title">Assignees</span>
          <span class="jt-avail-filter-badge">${activeAssignees}/${totalAssignees}</span>
          <span class="jt-avail-bar-separator">│</span>
          <div class="jt-avail-bar-chips">
            ${chipsHtml || '<span class="jt-avail-bar-empty">No assignees found</span>'}
          </div>
          <div class="jt-avail-bar-actions">
            <button class="jt-avail-filter-action" data-action="all" title="Show all">All</button>
            <button class="jt-avail-filter-action" data-action="none" title="Hide all">None</button>
            <div class="jt-avail-saved-views-container">
              <button class="jt-avail-saved-views-btn" title="Saved filter views">
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                  <path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"></path>
                  <polyline points="17 21 17 13 7 13 7 21"></polyline>
                  <polyline points="7 3 7 8 15 8"></polyline>
                </svg>
              </button>
              <div class="jt-avail-saved-views-dropdown">
                <div class="jt-avail-saved-views-header">Saved Views</div>
                <div class="jt-avail-saved-views-list"></div>
                <div class="jt-avail-saved-views-actions">
                  <button class="jt-avail-save-view-btn" title="Save current filter as a view">
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                      <line x1="12" y1="5" x2="12" y2="19"></line>
                      <line x1="5" y1="12" x2="19" y2="12"></line>
                    </svg>
                    Save Current View
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    `;

    filterContainer.innerHTML = html;

    // Add event listeners
    setupFilterEventListeners();

    // Insert into the page
    insertFilterUI();

    return filterContainer;
  }

  /**
   * Escape HTML to prevent XSS - delegates to shared Sanitizer utility
   */
  const escapeHtml = (text) => Sanitizer.escapeHTML(text);

  // ========================================================================
  // Searchable assignee dropdown (replaces the inline pill drawer)
  // ========================================================================

  /**
   * Lazily build the singleton dropdown and wire its permanent listeners:
   * type-to-filter, keyboard nav (↑/↓/Enter/Esc), option toggling, All/None.
   * Lives on document.body to escape the filter bar's stacking/overflow.
   */
  function ensureAssigneeDropdown() {
    if (_assigneeDropdown && document.body.contains(_assigneeDropdown)) return _assigneeDropdown;

    const dd = document.createElement('div');
    dd.className = 'jt-avail-assignee-dropdown';
    dd.innerHTML = `
      <div class="jt-avail-add-header">
        <input type="text" class="jt-avail-add-search" placeholder="Search…" autocomplete="off" spellcheck="false" />
      </div>
      <div class="jt-avail-add-toolbar">
        <span class="jt-avail-add-count"></span>
        <span class="jt-avail-add-actions">
          <button type="button" class="jt-avail-add-action" data-action="all">All</button>
          <button type="button" class="jt-avail-add-action" data-action="none">None</button>
        </span>
      </div>
      <div class="jt-avail-add-list" role="listbox" aria-multiselectable="true"></div>
    `;
    document.body.appendChild(dd);

    const search = dd.querySelector('.jt-avail-add-search');
    const list = dd.querySelector('.jt-avail-add-list');

    search.addEventListener('input', () => filterAssigneeOptions(search.value));

    search.addEventListener('keydown', (e) => {
      const visible = getVisibleOptions();
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        if (visible.length) setHighlight(Math.min(_assigneeHighlightIndex + 1, visible.length - 1), visible);
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        if (visible.length) setHighlight(Math.max(_assigneeHighlightIndex - 1, 0), visible);
      } else if (e.key === 'Enter') {
        e.preventDefault();
        const opt = visible[_assigneeHighlightIndex] || visible[0];
        if (opt) toggleAssigneeOption(opt.dataset.value, opt);
      } else if (e.key === 'Escape') {
        e.preventDefault();
        const anchor = _assigneeAnchorChip; // closeAssigneeDropdown() nulls it
        closeAssigneeDropdown();
        if (anchor) anchor.focus();
      }
    });

    list.addEventListener('click', (e) => {
      const opt = e.target.closest('.jt-avail-add-option');
      if (opt) toggleAssigneeOption(opt.dataset.value, opt);
    });

    dd.querySelectorAll('.jt-avail-add-action').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        setCategoryAll(_assigneeDropdownCategory, btn.dataset.action === 'all');
      });
    });

    // Inside-clicks must not reach the document outside-close handler
    dd.addEventListener('click', (e) => e.stopPropagation());

    _assigneeDropdown = dd;
    return dd;
  }

  function getVisibleOptions() {
    if (!_assigneeDropdown) return [];
    return Array.from(_assigneeDropdown.querySelectorAll('.jt-avail-add-option:not(.hidden)'));
  }

  function setHighlight(index, visible) {
    visible = visible || getVisibleOptions();
    _assigneeHighlightIndex = index;
    visible.forEach((opt, i) => opt.classList.toggle('highlighted', i === index));
    if (visible[index]) visible[index].scrollIntoView({ block: 'nearest' });
  }

  function filterAssigneeOptions(term) {
    if (!_assigneeDropdown) return;
    const q = (term || '').trim().toLowerCase();
    _assigneeDropdown.querySelectorAll('.jt-avail-add-option').forEach(opt => {
      const match = !q || (opt.dataset.value || '').toLowerCase().includes(q);
      opt.classList.toggle('hidden', !match);
    });
    const visible = getVisibleOptions();
    setHighlight(visible.length ? 0 : -1, visible);
  }

  /** Render the option rows for one category from currentFilters. */
  function populateAssigneeDropdown(category) {
    const dd = ensureAssigneeDropdown();
    const search = dd.querySelector('.jt-avail-add-search');
    const list = dd.querySelector('.jt-avail-add-list');

    const assignees = Array.from(detectedAssigneesByCategory[category] || []).sort();
    const catFilters = currentFilters.assignees[category] || {};

    search.placeholder = `Search ${category}…`;
    search.value = '';

    let rows = '';
    assignees.forEach(a => {
      const active = catFilters[a] !== false;
      rows += `
        <div class="jt-avail-add-option ${active ? 'active' : ''}" role="option" aria-selected="${active}" data-value="${escapeHtml(a)}" title="${escapeHtml(a)}">
          <span class="jt-avail-add-check" aria-hidden="true"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3"><polyline points="20 6 9 17 4 12"></polyline></svg></span>
          <span class="jt-avail-add-label">${escapeHtml(a)}</span>
        </div>`;
    });
    list.innerHTML = rows || '<div class="jt-avail-add-empty">No assignees</div>';
    updateAssigneeDropdownCount();
    _assigneeHighlightIndex = -1;
  }

  function updateAssigneeDropdownCount() {
    if (!_assigneeDropdown || !_assigneeDropdownCategory) return;
    const countEl = _assigneeDropdown.querySelector('.jt-avail-add-count');
    if (!countEl) return;
    const assignees = Array.from(detectedAssigneesByCategory[_assigneeDropdownCategory] || []);
    const catFilters = currentFilters.assignees[_assigneeDropdownCategory] || {};
    const active = assignees.filter(a => catFilters[a] !== false).length;
    countEl.textContent = `${active} / ${assignees.length}`;
  }

  /**
   * Recompute the dropdown's position from its anchor chip's CURRENT rect.
   * Called on open and on every scroll/resize so the popup tracks the chip.
   * If the chip has scrolled out of view, close the popup so it never floats
   * detached over the schedule grid.
   */
  function positionAssigneeDropdown() {
    if (!_assigneeDropdown || !_assigneeAnchorChip) return;
    const rect = _assigneeAnchorChip.getBoundingClientRect();
    // Anchor scrolled off-screen (or detached) → don't leave the popup floating.
    if (rect.width === 0 || rect.bottom <= 0 || rect.top >= window.innerHeight) {
      closeAssigneeDropdown();
      return;
    }
    const ddWidth = _assigneeDropdown.offsetWidth || 240;
    let left = rect.left;
    if (left + ddWidth > window.innerWidth - 8) {
      left = Math.max(8, window.innerWidth - ddWidth - 8);
    }
    _assigneeDropdown.style.top = `${rect.bottom + 4}px`;
    _assigneeDropdown.style.left = `${left}px`;
  }

  /** Position under the anchor chip (clamped to viewport) and reveal. */
  function openAssigneeDropdown(category, chipEl) {
    const dd = ensureAssigneeDropdown();
    _assigneeDropdownCategory = category;
    _assigneeAnchorChip = chipEl;

    if (filterContainer) {
      filterContainer.querySelectorAll('.category-chip[aria-haspopup]').forEach(c => c.setAttribute('aria-expanded', 'false'));
    }
    if (chipEl) chipEl.setAttribute('aria-expanded', 'true');

    populateAssigneeDropdown(category);
    dd.classList.add('open'); // show before measuring
    positionAssigneeDropdown();

    // Keep the popup glued to its chip as the page / schedule grid scrolls.
    // capture:true catches scroll events from JobTread's nested scroll
    // containers, not just window. rAF-throttled to stay smooth. Same function
    // reference each time, so re-adding on a category switch is a no-op.
    if (!_assigneeReposition) {
      let raf = null;
      _assigneeReposition = () => {
        if (raf) return;
        raf = requestAnimationFrame(() => { raf = null; positionAssigneeDropdown(); });
      };
    }
    window.addEventListener('scroll', _assigneeReposition, true);
    window.addEventListener('resize', _assigneeReposition);

    const search = dd.querySelector('.jt-avail-add-search');
    if (search) setTimeout(() => search.focus(), 0);
  }

  function closeAssigneeDropdown() {
    if (_assigneeReposition) {
      window.removeEventListener('scroll', _assigneeReposition, true);
      window.removeEventListener('resize', _assigneeReposition);
    }
    if (_assigneeDropdown) _assigneeDropdown.classList.remove('open');
    if (_assigneeAnchorChip) _assigneeAnchorChip.setAttribute('aria-expanded', 'false');
    _assigneeDropdownCategory = null;
    _assigneeAnchorChip = null;
    _assigneeHighlightIndex = -1;
  }

  /**
   * Toggle one assignee's visibility from the dropdown, then sync the option
   * row, the count, the category chip, the table rows, and storage in place —
   * no rebuild.
   */
  function toggleAssigneeOption(value, optEl) {
    const category = _assigneeDropdownCategory;
    if (!category) return;
    if (!currentFilters.assignees[category]) currentFilters.assignees[category] = {};

    const next = currentFilters.assignees[category][value] === false; // hidden → show
    currentFilters.assignees[category][value] = next;
    currentFilters.categories[category] = Object.values(currentFilters.assignees[category]).some(v => v === true);

    if (optEl) {
      optEl.classList.toggle('active', next);
      optEl.setAttribute('aria-selected', String(next));
    }
    updateAssigneeDropdownCount();
    updateChipStates();
    applyFilters();
    saveFilterSelections();
  }

  /** All / None for the open category. */
  function setCategoryAll(category, newState) {
    if (!category) return;
    if (!currentFilters.assignees[category]) currentFilters.assignees[category] = {};
    Array.from(detectedAssigneesByCategory[category] || []).forEach(a => {
      currentFilters.assignees[category][a] = newState;
    });
    currentFilters.categories[category] = newState;

    if (_assigneeDropdown) {
      _assigneeDropdown.querySelectorAll('.jt-avail-add-option').forEach(opt => {
        opt.classList.toggle('active', newState);
        opt.setAttribute('aria-selected', String(newState));
      });
    }
    updateAssigneeDropdownCount();
    updateChipStates();
    applyFilters();
    saveFilterSelections();
  }

  /**
   * Setup event listeners for filter UI
   */
  function setupFilterEventListeners() {
    if (!filterContainer) return;

    // Toggle collapse via clicking anywhere on the bar row (title, badge, separator, arrow)
    // Clicks on chips, actions, and saved views are excluded (they have their own handlers)
    const barRow = filterContainer.querySelector('.jt-avail-bar-row');
    if (barRow) {
      barRow.addEventListener('click', (e) => {
        // Don't toggle if the click is on an actual chip or action button
        if (e.target.closest('.jt-avail-filter-chip') ||
            e.target.closest('.jt-avail-bar-actions')) {
          return;
        }
        const bar = filterContainer.querySelector('.jt-avail-filter-bar');
        if (bar) { bar.classList.toggle('collapsed'); _isCollapsed = bar.classList.contains('collapsed'); }
      });
    }

    // Setup saved views functionality
    setupSavedViewsListeners();

    // Category chip clicks → open the searchable assignee dropdown for that
    // category (or close it if it's already showing this category). Chips with
    // no assignees just no-op.
    const categoryChips = filterContainer.querySelectorAll('.jt-avail-filter-chip.category-chip');
    categoryChips.forEach(chip => {
      chip.addEventListener('click', (e) => {
        e.stopPropagation();
        if (!chip.dataset.hasAssignees) return;
        const category = chip.dataset.value;
        const isOpenForThis = _assigneeDropdownCategory === category &&
          _assigneeDropdown && _assigneeDropdown.classList.contains('open');
        if (isOpenForThis) {
          closeAssigneeDropdown();
        } else {
          openAssigneeDropdown(category, chip);
        }
      });
    });

    // Quick action buttons
    const actionBtns = filterContainer.querySelectorAll('.jt-avail-filter-action');
    actionBtns.forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const action = btn.dataset.action;

        if (action === 'all') {
          Object.keys(currentFilters.categories).forEach(key => { currentFilters.categories[key] = true; });
          Object.keys(currentFilters.assignees).forEach(category => {
            Object.keys(currentFilters.assignees[category]).forEach(assignee => {
              currentFilters.assignees[category][assignee] = true;
            });
          });
          updateChipStates(); applyFilters(); saveFilterSelections();
        } else if (action === 'none') {
          Object.keys(currentFilters.categories).forEach(key => { currentFilters.categories[key] = false; });
          Object.keys(currentFilters.assignees).forEach(category => {
            Object.keys(currentFilters.assignees[category]).forEach(assignee => {
              currentFilters.assignees[category][assignee] = false;
            });
          });
          updateChipStates(); applyFilters(); saveFilterSelections();
        }
      });
    });
  }

  /**
   * Update chip visual states to match currentFilters
   */
  function updateChipStates() {
    if (!filterContainer) return;

    // Assignee selection now lives in the dropdown, not inline chips — update
    // the category chips (active + partial + count) to reflect currentFilters.
    const categoryChips = filterContainer.querySelectorAll('.jt-avail-filter-chip.category-chip');
    categoryChips.forEach(chip => {
      const category = chip.dataset.value;
      const isCatActive = currentFilters.categories[category] !== false;

      chip.classList.toggle('active', isCatActive);

      // Check partial state - use detected assignees for accurate count
      const detectedAssignees = detectedAssigneesByCategory[category];
      if (detectedAssignees && detectedAssignees.size > 0) {
        const detectedArray = Array.from(detectedAssignees);
        const catAssigneeFilters = currentFilters.assignees[category] || {};
        const activeCount = detectedArray.filter(a => catAssigneeFilters[a] !== false).length;
        const totalCount = detectedArray.length;
        const isPartial = activeCount > 0 && activeCount < totalCount;

        chip.classList.toggle('partial', isPartial);

        const countSpan = chip.querySelector('.jt-avail-role-count');
        if (countSpan) {
          countSpan.textContent = `${activeCount}/${totalCount}`;
        }
      }
    });

    updateFilterBadge();
  }

  /**
   * Update the hidden-count badge on the collapsed header
   */
  function updateFilterBadge() {
    if (!filterContainer) return;
    const badge = filterContainer.querySelector('.jt-avail-filter-badge');
    if (!badge) return;

    // Count total hidden assignees across all categories
    let hiddenCount = 0;
    Object.entries(currentFilters.assignees).forEach(([category, assignees]) => {
      Object.values(assignees).forEach(visible => {
        if (visible === false) hiddenCount++;
      });
    });

    if (hiddenCount > 0) {
      badge.textContent = hiddenCount;
      badge.style.display = '';
    } else {
      badge.style.display = 'none';
    }
  }

  /**
   * Insert filter UI into the page
   */
  function insertFilterUI() {
    if (!filterContainer) return;

    // Remove from previous location if it exists
    const existingFilter = document.getElementById('jt-availability-filter');
    if (existingFilter && existingFilter !== filterContainer) {
      existingFilter.remove();
    }

    // Try to find the best insertion point
    // Priority 1 (job-level only): Insert right after the sticky "Availability" header bar.
    // At the job level, there's a sticky bar with the text "Availability", week nav, and Close.
    // We must verify the text content says "Availability" to avoid matching category headers
    // (INTERNAL, VENDOR, etc.) that also use text-jtOrange in the table or sidebar.
    const stickyOrangeHeaders = document.querySelectorAll('div.sticky div.font-bold.text-jtOrange.uppercase');
    for (const header of stickyOrangeHeaders) {
      if (header.textContent.trim().toLowerCase() === 'availability') {
        const stickyBar = header.closest('div.sticky');
        if (stickyBar && stickyBar.parentElement) {
          stickyBar.parentElement.insertBefore(filterContainer, stickyBar.nextSibling);
          console.log('AvailabilityFilter: Inserted after sticky Availability header');
          return;
        }
      }
    }

    // Priority 2: After the schedule header/toolbar area (below "My Incomplete Tasks" dropdown row)
    // Look for the filter bar that contains "My Incomplete Tasks", gear icon, "Availability", etc.
    const filterBar = document.querySelector('div.flex.items-center.space-x-2.p-2') ||
                      document.querySelector('div.flex.items-center.gap-2');

    if (filterBar && filterBar.closest('main, [class*="schedule"]')) {
      // Insert after the filter bar's parent row
      const filterBarParent = filterBar.closest('div.flex') || filterBar.parentElement;
      if (filterBarParent && filterBarParent.parentElement) {
        filterBarParent.parentElement.insertBefore(filterContainer, filterBarParent.nextSibling);
        console.log('AvailabilityFilter: Inserted after filter bar');
        return;
      }
    }

    // Priority 3: Before the table that contains the availability grid
    const availabilityTable = document.querySelector('table');
    if (availabilityTable) {
      // Find a parent div that's a good container
      const tableContainer = availabilityTable.closest('div.overflow-auto') ||
                            availabilityTable.closest('div.relative') ||
                            availabilityTable.parentElement;

      if (tableContainer && tableContainer.parentElement) {
        tableContainer.parentElement.insertBefore(filterContainer, tableContainer);
        console.log('AvailabilityFilter: Inserted before table container');
        return;
      }
    }

    // Option 3: Find the schedule header with org name and "Schedule" title
    const scheduleHeader = document.querySelector('div.font-bold.text-2xl');
    if (scheduleHeader && scheduleHeader.textContent.includes('Schedule')) {
      const headerContainer = scheduleHeader.closest('div.flex');
      if (headerContainer && headerContainer.parentElement) {
        // Insert after the header section
        headerContainer.parentElement.insertBefore(filterContainer, headerContainer.nextSibling);
        console.log('AvailabilityFilter: Inserted after schedule header');
        return;
      }
    }

    // Fallback: Look for any main content area
    const scheduleContainer = document.querySelector('main') ||
                              document.querySelector('div[class*="schedule"]') ||
                              document.querySelector('div.overflow-auto');

    if (scheduleContainer) {
      // Insert at the beginning of the container
      scheduleContainer.insertBefore(filterContainer, scheduleContainer.firstChild);
      console.log('AvailabilityFilter: Filter UI inserted at container start');
    } else {
      // Last resort: append to body as fixed/floating element
      document.body.appendChild(filterContainer);
      filterContainer.classList.add('floating');
      console.log('AvailabilityFilter: Filter UI appended as floating element');
    }
  }

  /**
   * Apply filters to hide/show assignee rows
   *
   * IMPORTANT: The DOM structure has category headers AND the first assignee in the SAME <tr>!
   * Example structure from user:
   * <tr>
   *   <td class="border-r">
   *     <div>
   *       <div class="text-xs uppercase truncate p-1 border-b font-bold text-jtOrange">Internal</div>
   *       <div class="p-1 flex items-center space-x-1">...assignee card...</div>
   *     </div>
   *   </td>
   *   <td>...task cells for this assignee...</td>
   * </tr>
   *
   * ADDITIONAL COMPLEXITY: Some rows have empty first cells but contain task data in other cells.
   * These "continuation" rows belong to the previous assignee and should follow the same visibility.
   *
   * Strategy:
   * 1. Track the current assignee's visibility as we iterate
   * 2. Apply that visibility to continuation rows (empty first cell)
   */
  function applyFilters() {
    if (!isActiveState) return;

    let hiddenCount = 0;
    let shownCount = 0;

    // Build sets of what should be hidden per category
    const hiddenCategories = new Set();
    const hiddenAssignees = {}; // { 'INTERNAL': Set(['01 Field']), 'VENDOR': Set(['ABC Co']) }

    Object.entries(currentFilters.categories).forEach(([cat, visible]) => {
      if (!visible) hiddenCategories.add(cat.toUpperCase());
    });

    Object.entries(currentFilters.assignees).forEach(([category, assignees]) => {
      hiddenAssignees[category] = new Set();
      Object.entries(assignees).forEach(([assignee, visible]) => {
        if (!visible) hiddenAssignees[category].add(assignee);
      });
    });

    // Track current section as we iterate through rows
    let currentCategory = null;
    let currentAssigneeHidden = false; // Track if current assignee should be hidden

    // Process ALL table rows (tbody tr)
    const tableRows = document.querySelectorAll('tbody tr');

    tableRows.forEach((row, index) => {
      const firstCell = row.querySelector('td:first-child') || row.querySelector('th:first-child');
      if (!firstCell) return;

      // Check if first cell has any meaningful content
      const hasContent = firstCell.textContent.trim().length > 0;

      // Check if this row contains a category header (orange text)
      const categoryHeader = firstCell.querySelector('.text-jtOrange') ||
                            firstCell.querySelector('[class*="text-jtOrange"]');

      if (categoryHeader) {
        // This row has a category header - update current section
        currentCategory = categoryHeader.textContent.trim().toUpperCase();

        // Check if this header row ALSO contains an assignee (first assignee after header)
        const assigneeCard = firstCell.querySelector('div.p-1.flex.items-center.space-x-1');

        if (assigneeCard) {
          // This row has both a header AND an assignee
          const identifier = getAssigneeIdentifier(assigneeCard, currentCategory);

          currentAssigneeHidden = false;

          // Check if this specific assignee is hidden
          if (identifier && hiddenAssignees[currentCategory]) {
            currentAssigneeHidden = hiddenAssignees[currentCategory].has(identifier);
          } else if (hiddenCategories.has(currentCategory)) {
            currentAssigneeHidden = true;
          }

          if (currentAssigneeHidden) {
            row.classList.add('jt-avail-collapsed');
            row.classList.remove('jt-avail-visible');
            hiddenCount++;
          } else {
            row.classList.remove('jt-avail-collapsed');
            row.classList.add('jt-avail-visible');
            shownCount++;
          }
        } else {
          // This is just a header row with no assignee
          // Show header if any child in category is visible
          const catAssigneeFilters = currentFilters.assignees[currentCategory] || {};
          const anyChildVisible = Object.values(catAssigneeFilters).some(v => v === true);

          currentAssigneeHidden = !anyChildVisible && hiddenCategories.has(currentCategory);

          if (currentAssigneeHidden) {
            row.classList.add('jt-avail-collapsed');
            row.classList.remove('jt-avail-visible');
            hiddenCount++;
          } else {
            row.classList.remove('jt-avail-collapsed');
            row.classList.add('jt-avail-visible');
            shownCount++;
          }
        }
        return;
      }

      // Check for assignee card in first cell
      const assigneeCard = firstCell.querySelector('div.p-1.flex.items-center.space-x-1');

      if (assigneeCard) {
        // This is an assignee row - determine visibility
        const identifier = getAssigneeIdentifier(assigneeCard, currentCategory);

        currentAssigneeHidden = false;

        // Check if this specific assignee is hidden
        if (identifier && currentCategory && hiddenAssignees[currentCategory]) {
          currentAssigneeHidden = hiddenAssignees[currentCategory].has(identifier);
        } else if (currentCategory && hiddenCategories.has(currentCategory)) {
          currentAssigneeHidden = true;
        }

        if (currentAssigneeHidden) {
          row.classList.add('jt-avail-collapsed');
          row.classList.remove('jt-avail-visible');
          hiddenCount++;
        } else {
          row.classList.remove('jt-avail-collapsed');
          row.classList.add('jt-avail-visible');
          shownCount++;
        }
      } else if (!hasContent) {
        // This is a continuation row (empty first cell) - follow previous assignee's visibility
        // This handles rows that have tasks in later cells but empty first cell
        if (currentAssigneeHidden) {
          row.classList.add('jt-avail-collapsed');
          row.classList.remove('jt-avail-visible');
          hiddenCount++;
        } else {
          row.classList.remove('jt-avail-collapsed');
          row.classList.add('jt-avail-visible');
          shownCount++;
        }
      }
    });

    console.log(`AvailabilityFilter: Applied filters - ${shownCount} shown, ${hiddenCount} hidden`);

    return { shownCount, hiddenCount };
  }

  /**
   * Remove all filter markers
   */
  function removeFilters() {
    document.querySelectorAll('.jt-avail-collapsed').forEach(el => {
      el.classList.remove('jt-avail-collapsed');
    });
    document.querySelectorAll('.jt-avail-visible').forEach(el => {
      el.classList.remove('jt-avail-visible');
    });
  }

  /**
   * Inject CSS styles
   */
  function injectStyles() {
    if (styleElement) return;

    styleElement = document.createElement('link');
    styleElement.rel = 'stylesheet';
    styleElement.href = chrome.runtime.getURL('styles/availability-filter.css');
    styleElement.id = 'jt-availability-filter-styles';
    document.head.appendChild(styleElement);
  }

  /**
   * Remove injected styles
   */
  function removeStyles() {
    if (styleElement) {
      styleElement.remove();
      styleElement = null;
    }
  }

  /**
   * Stable signature of the detected assignee set. When this is unchanged
   * across a re-render (the common case on a week switch — same people, new
   * week), we can re-hide rows without tearing down and rebuilding every chip.
   */
  function computeSignature(categories, assigneesByCategory) {
    return categories
      .map(c => `${c}:${(assigneesByCategory[c] || []).join(',')}`)
      .join('|');
  }

  /**
   * Fast path: coalesce a burst of DOM mutations into a single applyFilters()
   * that runs before the next paint. This is what kills the week-switch flash —
   * JT re-adds all rows (unclassed = visible), and we re-hide the filtered ones
   * in the same frame, before the browser paints them.
   */
  function requestApplyFilters() {
    if (!isActiveState || _applyingView) return;
    if (_rafId) return; // already scheduled this frame
    _rafId = requestAnimationFrame(() => {
      _rafId = null;
      if (!isActiveState) return;
      if (!isAvailabilityView()) return;
      applyFilters();
    });
  }

  /**
   * Main function to scan page and build/update filter UI
   */
  function scanAndBuildFilter() {
    if (!isActiveState) return;
    if (_applyingView) return; // Skip rebuild during saved view application
    if (!isAvailabilityView()) {
      // Not on availability view, hide filter UI if present
      if (filterContainer) {
        filterContainer.style.display = 'none';
      }
      return;
    }

    // Show filter UI if hidden
    if (filterContainer) {
      filterContainer.style.display = '';
    }

    // Scan for categories and assignees
    const { categories, assigneesByCategory } = scanForFilters();

    // If no filters detected, don't show UI
    if (categories.length === 0) {
      console.log('AvailabilityFilter: No categories detected');
      return;
    }

    // Initialize filter states for new items
    initializeFilterStates(categories, assigneesByCategory);

    // Skip the expensive chip rebuild when the assignee set is unchanged
    // (week switches re-render rows but keep the same people). Just re-apply
    // row visibility — the chips already reflect currentFilters.
    const signature = computeSignature(categories, assigneesByCategory);
    if (filterContainer && document.body.contains(filterContainer) && signature === _lastSignature) {
      applyFilters();
      return;
    }
    _lastSignature = signature;

    // Create or update the filter UI
    createFilterUI(categories, assigneesByCategory);

    // Apply current filters
    applyFilters();
  }

  /**
   * Initialize the feature
   */
  async function init() {
    if (isActiveState) {
      console.log('AvailabilityFilter: Already active');
      return;
    }

    isActiveState = true;
    console.log('AvailabilityFilter: Initializing...');

    // Move any legacy sync-stored data into local before reading (see filterStore note)
    await migrateFromSyncIfNeeded();

    // Load saved filter selections
    await loadFilterSelections();

    // Inject styles
    injectStyles();

    // Create debounced scan function
    if (window.TimingUtils && typeof window.TimingUtils.debounce === 'function') {
      debouncedScanAndBuild = window.TimingUtils.debounce(scanAndBuildFilter, 300);
    } else {
      // Fallback debounce
      let timeout = null;
      debouncedScanAndBuild = function() {
        if (timeout) clearTimeout(timeout);
        timeout = setTimeout(scanAndBuildFilter, 300);
      };
      debouncedScanAndBuild.cancel = function() {
        if (timeout) clearTimeout(timeout);
      };
    }

    // Initial scan
    scanAndBuildFilter();

    // Watch for DOM changes
    observer = new MutationObserver((mutations) => {
      let shouldUpdate = false;

      for (const mutation of mutations) {
        // Check for relevant changes
        if (mutation.addedNodes.length > 0 || mutation.removedNodes.length > 0) {
          for (const node of [...mutation.addedNodes, ...mutation.removedNodes]) {
            if (node.nodeType === Node.ELEMENT_NODE) {
              // Check if the change might affect our filter targets
              if (node.classList && (
                node.classList.contains('p-1') ||
                node.classList.contains('truncate') ||
                node.classList.contains('font-bold') ||
                node.tagName === 'TR' ||
                node.tagName === 'TBODY'
              )) {
                shouldUpdate = true;
                break;
              }
            }
          }
        }

        if (shouldUpdate) break;
      }

      if (shouldUpdate) {
        // Fast path first: re-hide filtered rows before the next paint so a
        // week switch doesn't flash the full unfiltered list. Then the
        // debounced rebuild reconciles the chip UI only if the set changed.
        requestApplyFilters();
        debouncedScanAndBuild();
      }
    });

    observer.observe(document.body, {
      childList: true,
      subtree: true
    });

    // Watch for URL changes (SPA navigation). Compare with the transient
    // `taskId` param stripped — opening/closing a task sidebar toggles
    // ?taskId= and must NOT be treated as navigation, or the whole filter bar
    // tears down and rebuilds every time a task opens (visually jarring).
    let lastNavKey = navKeyIgnoringTask(location.href);
    urlCheckInterval = setInterval(() => {
      if (!isActiveState) {
        clearInterval(urlCheckInterval);
        return;
      }

      const navKey = navKeyIgnoringTask(location.href);
      if (navKey !== lastNavKey) {
        lastNavKey = navKey;
        console.log('AvailabilityFilter: URL changed, rescanning...');

        // Remove existing UI when navigating away
        closeAssigneeDropdown();
        if (filterContainer) {
          filterContainer.remove();
          filterContainer = null;
        }
        // Force a full rebuild on the next scan (new page context)
        _lastSignature = null;

        // Small delay to let page content load
        setTimeout(scanAndBuildFilter, 500);
      }
    }, 500);

    console.log('AvailabilityFilter: Initialized');
  }

  /**
   * Cleanup the feature
   */
  function cleanup() {
    if (!isActiveState) {
      console.log('AvailabilityFilter: Not active, skipping cleanup');
      return;
    }

    isActiveState = false;
    console.log('AvailabilityFilter: Cleaning up...');

    // Disconnect observer
    if (observer) {
      observer.disconnect();
      observer = null;
    }

    // Clear interval
    if (urlCheckInterval) {
      clearInterval(urlCheckInterval);
      urlCheckInterval = null;
    }

    // Cancel debounced function
    if (debouncedScanAndBuild && typeof debouncedScanAndBuild.cancel === 'function') {
      debouncedScanAndBuild.cancel();
    }
    debouncedScanAndBuild = null;

    // Cancel any pending fast-apply frame and reset the rebuild signature
    if (_rafId) {
      cancelAnimationFrame(_rafId);
      _rafId = null;
    }
    _lastSignature = null;

    // Remove global click listener
    if (_outsideClickHandler) {
      document.removeEventListener('click', _outsideClickHandler);
      _outsideClickHandler = null;
    }

    // Remove filter UI
    if (filterContainer) {
      filterContainer.remove();
      filterContainer = null;
    }

    // Remove the singleton assignee dropdown (lives on document.body).
    // closeAssigneeDropdown() detaches its scroll/resize listeners first.
    closeAssigneeDropdown();
    if (_assigneeDropdown) {
      _assigneeDropdown.remove();
      _assigneeDropdown = null;
    }
    _assigneeReposition = null;

    // Remove filters from DOM
    removeFilters();

    // Remove styles
    removeStyles();

    // Reset state
    _applyingView = false;
    _isCollapsed = true;

    console.log('AvailabilityFilter: Cleaned up');
  }

  // Public API
  return {
    init,
    cleanup,
    isActive: () => isActiveState,
    refresh: scanAndBuildFilter
  };
})();

// Export for use in main content script
if (typeof window !== 'undefined') {
  window.AvailabilityFilterFeature = AvailabilityFilterFeature;
}
