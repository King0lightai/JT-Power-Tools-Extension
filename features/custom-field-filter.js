// JobTread Custom Field Filter Feature
// API-powered filtering of jobs by custom field values in the Job Switcher sidebar
// Supports multi-field AND filtering with multi-value OR within each field
// Saved filters shared across company. Requires Power User tier and API configuration.

const CustomFieldFilterFeature = (() => {
  let isActive = false;
  let sidebarObserver = null;
  let customFieldDefinitions = null;
  let filterContainer = null;
  let filterFields = [];           // Array of { fieldId, fieldName, values: [] }
  let currentEditFieldId = null;   // Which field's values are currently shown in the editor
  let activeJobStatus = 'all';     // 'all', 'open', or 'closed'
  let savedFilters = [];
  let activeSavedFilterId = null;
  let dropdownOpen = false;
  let availableValues = [];
  let activeSortOrder = 'recent';    // 'recent', 'az', 'za'
  let currentPage = 0;
  let isLoadingMore = false;
  let hasMoreJobs = true;
  let allLoadedJobs = [];
  let scrollObserver = null;

  const SIDEBAR_SELECTOR = 'div.z-30.absolute.top-0.bottom-0.right-0';

  /**
   * Safely parse a JSON-serialized dataset.options string. Returns [] on
   * any malformed payload instead of throwing — a corrupt option blob must
   * not take down the filter UI.
   */
  function parseFieldOptions(raw) {
    try {
      const parsed = JSON.parse(raw || '[]');
      return Array.isArray(parsed) ? parsed : [];
    } catch (e) {
      console.warn('CustomFieldFilter: Failed to parse field options, defaulting to []:', e);
      return [];
    }
  }

  /**
   * Check if a sidebar element is specifically the Job Switcher
   */
  function isJobSwitcherSidebar(sidebar) {
    if (!sidebar) return false;

    // Check for "JOB SWITCHER" text in the header
    const headerText = sidebar.textContent || '';
    if (headerText.includes('JOB SWITCHER') || headerText.includes('Job Switcher')) {
      return true;
    }

    // Check for job search input placeholder
    const searchInput = sidebar.querySelector('input[placeholder*="Search Jobs"]') ||
                       sidebar.querySelector('input[placeholder*="Search jobs"]');
    if (searchInput) {
      return true;
    }

    return false;
  }

  /**
   * Find the Job Switcher sidebar specifically
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
   * Initialize the feature
   */
  function init() {
    if (isActive) {
      return;
    }

    isActive = true;

    // Start observing for sidebar to add filter UI
    startSidebarObserver();

    // Keep the selected-job highlight in sync as the user switches jobs. Our
    // row clicks dispatch popstate (and browser back/forward fire it), so this
    // moves the green check + bg-blue-50 to the new job without a full re-render.
    window.addEventListener('popstate', updateSelectedJobHighlight);

    console.log('CustomFieldFilter: Activated');
  }

  /**
   * Cleanup the feature
   */
  function cleanup() {
    if (!isActive) {
      return;
    }

    isActive = false;

    // Stop sidebar observer
    stopSidebarObserver();

    // Remove click-outside listener
    document.removeEventListener('click', handleClickOutside);

    // Remove the job-switch highlight sync listener
    window.removeEventListener('popstate', updateSelectedJobHighlight);

    // Remove any injected UI
    const existingFilter = document.getElementById('jt-custom-field-filter');
    if (existingFilter) {
      existingFilter.remove();
    }

    // Reset state
    customFieldDefinitions = null;
    filterContainer = null;
    filterFields = [];
    currentEditFieldId = null;
    activeJobStatus = 'all';
    savedFilters = [];
    activeSavedFilterId = null;
    dropdownOpen = false;
    availableValues = [];
    activeSortOrder = 'recent';
    if (scrollObserver) {
      scrollObserver.disconnect();
      scrollObserver = null;
    }
    currentPage = 0;
    isLoadingMore = false;
    hasMoreJobs = true;
    allLoadedJobs = [];

    console.log('CustomFieldFilter: Deactivated');
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
        for (const node of mutation.addedNodes) {
          if (node.nodeType === Node.ELEMENT_NODE) {
            const sidebar = node.matches?.(SIDEBAR_SELECTOR)
              ? node
              : node.querySelector?.(SIDEBAR_SELECTOR);

            if (sidebar) {
              // Small delay to ensure sidebar is fully rendered
              setTimeout(() => {
                if (isJobSwitcherSidebar(sidebar)) {
                  const searchInput = sidebar.querySelector('input[placeholder*="Search"]') ||
                                     sidebar.querySelector('input');
                  if (searchInput) {
                    injectFilterUI(searchInput);
                  }
                }
              }, 100);
            }
          }
        }
      }
    });

    sidebarObserver.observe(document.body, {
      childList: true,
      subtree: true
    });

    // Also check if sidebar is already present
    const existingSidebar = findJobSwitcherSidebar();
    if (existingSidebar) {
      const searchInput = existingSidebar.querySelector('input[placeholder*="Search"]') ||
                         existingSidebar.querySelector('input');
      if (searchInput) {
        injectFilterUI(searchInput);
      }
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
   * Inject custom field filter UI after the search input
   */
  async function injectFilterUI(searchInput) {
    // Synchronous short-circuit first: if the filter UI is already injected,
    // bail before firing any async isConfigured() calls. Opening and closing
    // the Job Switcher sidebar quickly could otherwise race multiple
    // injections.
    if (document.getElementById('jt-custom-field-filter')) {
      return;
    }

    // Check if API is configured (Worker or Direct)
    let isApiConfigured = false;

    // Check Worker API first (Pro Service)
    if (typeof JobTreadProService !== 'undefined') {
      isApiConfigured = await JobTreadProService.isConfigured();
    }

    // Fall back to Direct API if Worker not configured
    if (!isApiConfigured && typeof JobTreadAPI !== 'undefined') {
      isApiConfigured = await JobTreadAPI.isFullyConfigured();
    }

    if (!isApiConfigured) {
      return;
    }

    // Re-check after the async gap — another concurrent injection may have
    // completed while we were awaiting isConfigured().
    if (document.getElementById('jt-custom-field-filter')) {
      return;
    }

    // Find the search input container (parent div with p-2 class)
    const searchContainer = searchInput.closest('div.p-2');

    if (!searchContainer) {
      return;
    }

    // Create filter container
    filterContainer = document.createElement('div');
    filterContainer.id = 'jt-custom-field-filter';
    filterContainer.className = 'p-2 pt-0';
    filterContainer.innerHTML = `
      <div class="flex items-center gap-1 mb-1">
        <select id="jt-cf-status-select" class="rounded-sm border p-1 text-xs flex-1 appearance-none bg-white hover:bg-gray-50 focus:border-cyan-500 transition" style="min-width: 0;">
          <option value="all">All Jobs</option>
          <option value="open">Open</option>
          <option value="closed">Closed</option>
        </select>
        <select id="jt-cf-sort-select" class="rounded-sm border p-1 text-xs flex-1 appearance-none bg-white hover:bg-gray-50 focus:border-cyan-500 transition" style="min-width: 0;">
          <option value="recent">Recent</option>
          <option value="az">A → Z</option>
          <option value="za">Z → A</option>
        </select>
      </div>
      <div id="jt-cf-saved-row" class="flex items-center gap-1 mb-1" style="display: none;">
        <select id="jt-cf-saved-select" class="rounded-sm border p-1 text-xs flex-1 appearance-none bg-white hover:bg-gray-50 focus:border-cyan-500 transition" style="min-width: 0;">
          <option value="">Saved Filters...</option>
        </select>
      </div>
      <div class="flex items-center gap-1">
        <select id="jt-cf-field-select" class="rounded-sm border p-1 text-xs flex-1 appearance-none bg-white hover:bg-gray-50 focus:border-cyan-500 transition" style="min-width: 0;">
          <option value="">Filter by Custom Field...</option>
        </select>
      </div>
      <div id="jt-cf-chips" class="flex flex-wrap gap-1 mt-1" style="display: none;"></div>
      <div id="jt-cf-values-row" class="flex items-center gap-1 mt-1" style="display: none;">
        <div id="jt-cf-value-dropdown" class="relative flex-1" style="min-width: 0;">
          <button id="jt-cf-value-trigger" class="rounded-sm border p-1 text-xs w-full text-left bg-white hover:bg-gray-50 focus:border-cyan-500 transition flex items-center justify-between" type="button">
            <span id="jt-cf-value-label" class="truncate text-gray-500">Select values...</span>
            <svg xmlns="http://www.w3.org/2000/svg" fill="none" stroke="currentColor" stroke-width="2" class="h-3 w-3 shrink-0 ml-1" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M19 9l-7 7-7-7"/></svg>
          </button>
          <div id="jt-cf-value-panel" class="absolute z-50 mt-1 w-full rounded-sm border bg-white shadow-lg" style="display: none; max-height: 220px;">
            <div class="flex items-center justify-between p-1 border-b text-xs">
              <button id="jt-cf-select-all" class="text-cyan-600 hover:text-cyan-700 font-medium px-1">Select All</button>
              <button id="jt-cf-clear-all" class="text-gray-500 hover:text-gray-700 font-medium px-1">Clear All</button>
            </div>
            <div id="jt-cf-value-list" class="overflow-y-auto" style="max-height: 180px;"></div>
          </div>
        </div>
        <button id="jt-cf-save-filter-btn" class="rounded-sm border p-1 text-xs bg-white hover:bg-gray-50 text-gray-500" style="display: none;" title="Save current filter">
          <svg xmlns="http://www.w3.org/2000/svg" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2" class="h-4 w-4" viewBox="0 0 24 24"><path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"></path><polyline points="17 21 17 13 7 13 7 21"></polyline><polyline points="7 3 7 8 15 8"></polyline></svg>
        </button>
        <button id="jt-cf-delete-filter-btn" class="rounded-sm border p-1 text-xs bg-white hover:bg-red-50 text-gray-500 hover:text-red-500" style="display: none;" title="Delete saved filter">
          <svg xmlns="http://www.w3.org/2000/svg" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2" class="h-4 w-4" viewBox="0 0 24 24"><path d="M3 6h18"></path><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path></svg>
        </button>
        <button id="jt-cf-clear-btn" class="rounded-sm border p-1 text-xs bg-white hover:bg-gray-50 text-gray-500" style="display: none;" title="Clear filter">
          <svg xmlns="http://www.w3.org/2000/svg" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2" class="h-4 w-4" viewBox="0 0 24 24"><path d="M18 6 6 18M6 6l12 12"></path></svg>
        </button>
      </div>
      <div id="jt-cf-save-input-row" class="flex items-center gap-1 mt-1" style="display: none;">
        <input id="jt-cf-save-name" type="text" placeholder="Filter name..." class="rounded-sm border p-1 text-xs flex-1" style="min-width: 0;" maxlength="50">
        <button id="jt-cf-save-confirm" class="rounded-sm border p-1 text-xs bg-cyan-500 text-white hover:bg-cyan-600" title="Save">
          <svg xmlns="http://www.w3.org/2000/svg" fill="none" stroke="currentColor" stroke-width="2" class="h-3 w-3" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M5 13l4 4L19 7"/></svg>
        </button>
        <button id="jt-cf-save-cancel" class="rounded-sm border p-1 text-xs bg-white hover:bg-gray-50 text-gray-500" title="Cancel">
          <svg xmlns="http://www.w3.org/2000/svg" fill="none" stroke="currentColor" stroke-width="2" class="h-3 w-3" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M6 18L18 6M6 6l12 12"/></svg>
        </button>
      </div>
      <div id="jt-cf-status" class="text-xs text-gray-500 mt-1" style="display: none;"></div>
    `;

    // Insert after search container
    searchContainer.after(filterContainer);

    // Load custom field definitions (includes location custom fields)
    await loadCustomFieldDefinitions();

    // Set up event listeners
    setupFilterEventListeners();

    // Load saved filters
    await loadSavedFilters();

    // Add click-outside listener for dropdown
    document.addEventListener('click', handleClickOutside);
  }

  /**
   * Handle clicks outside the dropdown to close it
   */
  function handleClickOutside(e) {
    if (dropdownOpen) {
      const dropdown = document.getElementById('jt-cf-value-dropdown');
      if (dropdown && !dropdown.contains(e.target)) {
        closeValueDropdown();
      }
    }

  }

  /**
   * Load custom field definitions from API
   */
  async function loadCustomFieldDefinitions() {
    const fieldSelect = document.getElementById('jt-cf-field-select');
    if (!fieldSelect) return;

    try {
      // Try Pro Service first (uses Cloudflare Worker)
      let fieldsData;
      if (window.JobTreadProService && await JobTreadProService.isConfigured()) {
        fieldsData = await JobTreadProService.getCustomFields();
        customFieldDefinitions = fieldsData.fields || [];
      } else {
        // Fall back to direct API
        customFieldDefinitions = await JobTreadAPI.fetchCustomFieldDefinitions();
      }

      // Only exclude multipleText - allow all other field types
      // multipleText can have multiple values per job which makes filtering complex
      customFieldDefinitions.forEach(field => {
        // Skip multipleText fields - they can have multiple values per job
        if (field.type === 'multipleText') {
          return;
        }

        const option = document.createElement('option');
        option.value = field.id;
        option.textContent = field.name;
        option.dataset.type = field.type;
        option.dataset.options = JSON.stringify(field.options || []);
        fieldSelect.appendChild(option);
      });

      // Load location custom fields and add them to the dropdown
      try {
        let locationFields = [];

        // Try Pro Service first
        if (window.JobTreadProService && await JobTreadProService.isConfigured()) {
          try {
            locationFields = await JobTreadProService.getLocationCustomFields();
          } catch (e) {
            console.log('CustomFieldFilter: ProService location fields not available, trying direct API');
          }
        }

        // Fall back to direct API
        if ((!locationFields || locationFields.length === 0) && typeof JobTreadAPI !== 'undefined' && typeof JobTreadAPI.fetchLocationCustomFields === 'function') {
          locationFields = await JobTreadAPI.fetchLocationCustomFields();
        }

        if (locationFields.length > 0) {
          // Add separator
          const separator = document.createElement('option');
          separator.disabled = true;
          separator.textContent = '── Location Fields ──';
          separator.style.cssText = 'color: #9ca3af; font-style: italic;';
          fieldSelect.appendChild(separator);

          locationFields.forEach(field => {
            if (field.type === 'multipleText') return;
            const option = document.createElement('option');
            option.value = 'loc:' + field.id;
            option.textContent = '\uD83D\uDCCD ' + field.name;
            option.dataset.type = field.type;
            option.dataset.options = JSON.stringify(field.options || []);
            option.dataset.targetType = 'location';
            fieldSelect.appendChild(option);
          });
        }
      } catch (locError) {
        console.log('CustomFieldFilter: Location custom fields not available:', locError.message);
      }

      // Show status message if no fields found
      const statusDiv = document.getElementById('jt-cf-status');
      if (statusDiv && customFieldDefinitions.length === 0) {
        statusDiv.style.display = 'block';
        statusDiv.textContent = 'No custom fields found. Create some in JobTread Settings.';
        statusDiv.style.color = '#6b7280';
      }
    } catch (error) {
      console.error('CustomFieldFilter: Failed to load custom fields:', error);
      const statusDiv = document.getElementById('jt-cf-status');
      if (statusDiv) {
        statusDiv.style.display = 'block';
        statusDiv.textContent = 'Failed to load custom fields';
        statusDiv.style.color = '#ef4444';
      }
    }
  }

  // ─── Multi-select checkbox dropdown ──────────────────────────────────

  /**
   * Populate the checkbox dropdown with values
   */
  function populateValueCheckboxes(values) {
    availableValues = values;
    const list = document.getElementById('jt-cf-value-list');
    if (!list) return;

    list.innerHTML = '';

    if (values.length === 0) {
      list.innerHTML = '<div class="p-2 text-xs text-gray-400 text-center">No values found</div>';
      return;
    }

    values.forEach(val => {
      const label = document.createElement('label');
      label.className = 'flex items-center gap-2 px-2 py-1 hover:bg-gray-50 cursor-pointer text-sm';
      label.innerHTML = `
        <input type="checkbox" class="jt-cf-value-cb" value="${escapeAttr(val)}" style="accent-color: #06b6d4;">
        <span class="truncate">${escapeHtml(val)}</span>
      `;
      list.appendChild(label);

      // Listen for checkbox changes
      const cb = label.querySelector('input');
      cb.addEventListener('change', onValueCheckboxChange);
    });
  }

  /**
   * Handle checkbox change — update selected values for current field and trigger filter
   */
  function onValueCheckboxChange() {
    const selected = getSelectedValues();
    updateValueLabel(selected);

    // If user manually changes values, clear saved filter tracking
    if (activeSavedFilterId) {
      activeSavedFilterId = null;
      const savedSelect = document.getElementById('jt-cf-saved-select');
      if (savedSelect) savedSelect.value = '';
    }

    if (!currentEditFieldId) return;

    // Find the field select option to get the field name
    const fieldSelect = document.getElementById('jt-cf-field-select');
    const fieldOption = fieldSelect ? Array.from(fieldSelect.options).find(o => o.value === currentEditFieldId) : null;
    const fieldName = fieldOption ? fieldOption.textContent : '';

    const clearBtn = document.getElementById('jt-cf-clear-btn');

    if (selected.length > 0) {
      // Add or update this field in filterFields
      const existing = filterFields.find(f => f.fieldId === currentEditFieldId);
      if (existing) {
        existing.values = selected;
      } else {
        filterFields.push({ fieldId: currentEditFieldId, fieldName, values: selected });
      }
      if (clearBtn) clearBtn.style.display = 'block';
      renderChips();
      updateFieldSelectOptions();
      updateSaveDeleteVisibility();
      applyFilter();
    } else {
      // Remove this field from filterFields
      filterFields = filterFields.filter(f => f.fieldId !== currentEditFieldId);
      renderChips();
      updateFieldSelectOptions();
      updateSaveDeleteVisibility();

      if (filterFields.length > 0) {
        // Still have other field filters — re-apply
        applyFilter();
      } else {
        if (clearBtn) clearBtn.style.display = 'none';
        clearFilter();
      }
    }
  }

  /**
   * Render filter chips for each active field filter
   */
  function renderChips() {
    const container = document.getElementById('jt-cf-chips');
    if (!container) return;

    container.innerHTML = '';

    if (filterFields.length === 0) {
      container.style.display = 'none';
      return;
    }

    container.style.display = 'flex';

    filterFields.forEach(f => {
      const chip = document.createElement('span');
      chip.className = 'jt-cf-chip';
      chip.dataset.fieldId = f.fieldId;
      chip.style.cssText = 'display: inline-flex; align-items: center; gap: 4px; padding: 2px 6px 2px 8px; border-radius: 4px; font-size: 11px; background: #e0f2fe; color: #0369a1; border: 1px solid #bae6fd; max-width: 180px; cursor: pointer;';

      const valuesText = f.values.length <= 2
        ? f.values.join(', ')
        : `${f.values.length} values`;

      const labelSpan = document.createElement('span');
      labelSpan.style.cssText = 'overflow: hidden; text-overflow: ellipsis; white-space: nowrap;';
      labelSpan.textContent = `${f.fieldName}: ${valuesText}`;
      labelSpan.title = `${f.fieldName}: ${f.values.join(', ')}`;

      // Click label to edit this field
      labelSpan.addEventListener('click', (e) => {
        e.stopPropagation();
        editFieldFilter(f.fieldId);
      });

      const removeBtn = document.createElement('button');
      removeBtn.textContent = '\u00d7';
      removeBtn.title = `Remove ${f.fieldName} filter`;
      removeBtn.style.cssText = 'background: none; border: none; color: #0369a1; font-size: 14px; cursor: pointer; padding: 0 2px; line-height: 1; font-weight: bold; flex-shrink: 0;';
      removeBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        removeFieldFilter(f.fieldId);
      });

      chip.appendChild(labelSpan);
      chip.appendChild(removeBtn);
      container.appendChild(chip);
    });
  }

  /**
   * Edit an existing field filter — switch the editor to show that field's values
   */
  async function editFieldFilter(fieldId) {
    const fieldSelect = document.getElementById('jt-cf-field-select');
    const valuesRow = document.getElementById('jt-cf-values-row');
    if (!fieldSelect) return;

    const ff = filterFields.find(f => f.fieldId === fieldId);
    if (!ff) return;

    currentEditFieldId = fieldId;

    // Temporarily show this field's option in the select (it may be hidden)
    const allOptions = fieldSelect.querySelectorAll('option');
    allOptions.forEach(opt => {
      if (opt.value === fieldId) opt.style.display = '';
    });
    fieldSelect.value = fieldId;
    // Re-hide used fields after setting value
    updateFieldSelectOptions();

    if (valuesRow) valuesRow.style.display = 'flex';

    // Load values for this field
    const fieldOption = Array.from(fieldSelect.options).find(o => o.value === fieldId);
    if (!fieldOption) return;

    const fieldOptions = parseFieldOptions(fieldOption.dataset.options);

    if (fieldOptions && fieldOptions.length > 0) {
      populateValueCheckboxes(fieldOptions);
    } else {
      try {
        let values;
        if (window.JobTreadProService && await JobTreadProService.isConfigured()) {
          values = await JobTreadProService.getCustomFieldValues(fieldId, ff.fieldName);
        } else if (typeof JobTreadAPI !== 'undefined') {
          values = await JobTreadAPI.getCustomFieldValues(fieldId);
        } else {
          values = [];
        }
        populateValueCheckboxes(values);
      } catch (error) {
        console.error('CustomFieldFilter: Failed to load values for edit:', error);
        populateValueCheckboxes([]);
      }
    }

    // Pre-check existing values
    setCheckedValues(ff.values);
    updateSaveDeleteVisibility();
  }

  /**
   * Remove a field filter by fieldId
   */
  async function removeFieldFilter(fieldId) {
    filterFields = filterFields.filter(f => f.fieldId !== fieldId);

    // If we were editing this field, close the editor
    if (currentEditFieldId === fieldId) {
      currentEditFieldId = null;
      const fieldSelect = document.getElementById('jt-cf-field-select');
      const valuesRow = document.getElementById('jt-cf-values-row');
      if (fieldSelect) fieldSelect.value = '';
      if (valuesRow) valuesRow.style.display = 'none';
      closeValueDropdown();
    }

    // Clear saved filter tracking
    activeSavedFilterId = null;
    const savedSelect = document.getElementById('jt-cf-saved-select');
    if (savedSelect) savedSelect.value = '';

    renderChips();
    updateFieldSelectOptions();
    updateSaveDeleteVisibility();

    const clearBtn = document.getElementById('jt-cf-clear-btn');

    if (filterFields.length > 0) {
      if (clearBtn) clearBtn.style.display = 'block';
      await applyFilter();
    } else {
      if (clearBtn) clearBtn.style.display = 'none';
      clearFilter();
    }
  }

  /**
   * Hide fields that are already in filterFields from the dropdown
   * (except the currently editing field)
   */
  function updateFieldSelectOptions() {
    const fieldSelect = document.getElementById('jt-cf-field-select');
    if (!fieldSelect) return;

    const usedFieldIds = new Set(filterFields.map(f => f.fieldId));

    Array.from(fieldSelect.options).forEach(opt => {
      if (!opt.value) return; // Skip placeholder
      if (usedFieldIds.has(opt.value) && opt.value !== currentEditFieldId) {
        opt.style.display = 'none';
      } else {
        opt.style.display = '';
      }
    });
  }

  /**
   * Get all currently selected values from checkboxes
   */
  function getSelectedValues() {
    const checkboxes = document.querySelectorAll('.jt-cf-value-cb:checked');
    return Array.from(checkboxes).map(cb => cb.value);
  }

  /**
   * Update the dropdown trigger label with selection count
   */
  function updateValueLabel(selected) {
    const label = document.getElementById('jt-cf-value-label');
    if (!label) return;

    if (selected.length === 0) {
      label.textContent = 'Select values...';
      label.className = 'truncate text-gray-500';
    } else if (selected.length === 1) {
      label.textContent = selected[0];
      label.className = 'truncate text-gray-900';
    } else {
      label.textContent = `${selected.length} values selected`;
      label.className = 'truncate text-gray-900';
    }
  }

  /**
   * Toggle the value dropdown panel
   */
  function toggleValueDropdown() {
    if (dropdownOpen) {
      closeValueDropdown();
    } else {
      openValueDropdown();
    }
  }

  function openValueDropdown() {
    const panel = document.getElementById('jt-cf-value-panel');
    if (panel) {
      panel.style.display = 'block';
      dropdownOpen = true;
    }
  }

  function closeValueDropdown() {
    const panel = document.getElementById('jt-cf-value-panel');
    if (panel) {
      panel.style.display = 'none';
      dropdownOpen = false;
    }
  }

  /**
   * Select all checkboxes
   */
  function selectAllValues() {
    document.querySelectorAll('.jt-cf-value-cb').forEach(cb => { cb.checked = true; });
    onValueCheckboxChange();
  }

  /**
   * Clear all checkboxes
   */
  function clearAllValues() {
    document.querySelectorAll('.jt-cf-value-cb').forEach(cb => { cb.checked = false; });
    onValueCheckboxChange();
  }

  /**
   * Set specific values as checked (for loading saved filters)
   */
  function setCheckedValues(values) {
    document.querySelectorAll('.jt-cf-value-cb').forEach(cb => {
      cb.checked = values.includes(cb.value);
    });
    const selected = getSelectedValues();
    updateValueLabel(selected);
  }

  // ─── Saved Filters ────────────────────────────────────────────────

  /**
   * Load saved filters from account service and populate the status dropdown
   */
  async function loadSavedFilters() {
    const statusSelect = document.getElementById('jt-cf-status-select');
    if (!statusSelect) return;

    // Check if user is logged in
    const isLoggedIn = typeof AccountService !== 'undefined' && AccountService.isLoggedIn();
    if (!isLoggedIn) return;

    try {
      const result = await AccountService.getSavedFilters();
      if (result.success) {
        let allFilters = result.filters || [];

        // Filter to only show saved filters relevant to the current org.
        // A filter is relevant if its custom fields exist in the current org's definitions.
        if (customFieldDefinitions && customFieldDefinitions.length > 0) {
          const currentFieldNames = new Set(customFieldDefinitions.map(f => f.name));
          allFilters = allFilters.filter(f => {
            if (f.fieldName === '__multi__') {
              // Multi-field: check if ALL field names exist in current org
              const fields = Array.isArray(f.filterValues) ? f.filterValues : [];
              return fields.length > 0 && fields.every(ff =>
                currentFieldNames.has(ff.fieldName) || (ff.fieldId && ff.fieldId.startsWith('loc:'))
              );
            }
            // Single-field: check if the field name exists, or it's a location field
            return currentFieldNames.has(f.fieldName) || (f.fieldId && f.fieldId.startsWith('loc:'));
          });
        }

        savedFilters = allFilters;
        renderSavedFiltersInDropdown();
      }
    } catch (error) {
      console.error('CustomFieldFilter: Failed to load saved filters:', error);
    }
  }

  /**
   * Render saved filters in the dedicated saved filters dropdown
   */
  function renderSavedFiltersInDropdown() {
    const savedRow = document.getElementById('jt-cf-saved-row');
    const savedSelect = document.getElementById('jt-cf-saved-select');
    if (!savedSelect || !savedRow) return;

    // Clear existing options (keep placeholder)
    savedSelect.innerHTML = '<option value="">Saved Filters...</option>';

    // Hide row if no saved filters
    if (savedFilters.length === 0) {
      savedRow.style.display = 'none';
      return;
    }

    // Populate options
    savedFilters.forEach(filter => {
      const option = document.createElement('option');
      option.value = filter.id;
      option.textContent = filter.name;
      savedSelect.appendChild(option);
    });

    // Show the row
    savedRow.style.display = 'flex';
  }

  /**
   * Load a saved filter into the UI and apply it
   */
  async function loadSavedFilter(filter) {
    const fieldSelect = document.getElementById('jt-cf-field-select');
    const valuesRow = document.getElementById('jt-cf-values-row');

    if (!fieldSelect) return;

    // Track which saved filter is active
    activeSavedFilterId = filter.id;

    // Set job status from saved filter
    activeJobStatus = filter.jobStatus || 'all';
    const statusSelect = document.getElementById('jt-cf-status-select');
    if (statusSelect) statusSelect.value = activeJobStatus;

    // Detect format: multi-field vs legacy single-field
    const filterValues = filter.filterValues || [];
    const isMultiField = filter.fieldName === '__multi__' ||
      (filterValues.length > 0 && typeof filterValues[0] === 'object');

    if (isMultiField) {
      // Multi-field format: filterValues is array of { fieldId, fieldName, values }
      filterFields = filterValues.map(f => ({
        fieldId: f.fieldId || '',
        fieldName: f.fieldName,
        values: f.values || []
      }));
    } else {
      // Legacy single-field format
      filterFields = [{
        fieldId: filter.fieldId || '',
        fieldName: filter.fieldName,
        values: filterValues
      }];
    }

    // Render chips and update dropdown visibility
    renderChips();
    updateFieldSelectOptions();

    // Show the last field in the editor (or the only one for single-field)
    const lastField = filterFields[filterFields.length - 1];
    if (lastField) {
      currentEditFieldId = lastField.fieldId;

      // Find field option
      let fieldOption = null;
      for (const opt of fieldSelect.options) {
        if (opt.value === lastField.fieldId || opt.textContent === lastField.fieldName) {
          fieldOption = opt;
          break;
        }
      }

      if (fieldOption) {
        // Temporarily show this option
        fieldOption.style.display = '';
        fieldSelect.value = fieldOption.value;
        updateFieldSelectOptions();

        if (valuesRow) valuesRow.style.display = 'flex';

        // Load values for this field
        const fieldOptions = parseFieldOptions(fieldOption.dataset.options);
        const fieldName = fieldOption.textContent;

        if (fieldOptions && fieldOptions.length > 0) {
          populateValueCheckboxes(fieldOptions);
        } else {
          try {
            let values;
            if (window.JobTreadProService && await JobTreadProService.isConfigured()) {
              values = await JobTreadProService.getCustomFieldValues(lastField.fieldId, fieldName);
            } else if (typeof JobTreadAPI !== 'undefined') {
              values = await JobTreadAPI.getCustomFieldValues(lastField.fieldId);
            } else {
              values = [];
            }
            populateValueCheckboxes(values);
          } catch (error) {
            console.error('CustomFieldFilter: Failed to load values for saved filter:', error);
            populateValueCheckboxes([]);
          }
        }

        // Pre-check the saved values
        setCheckedValues(lastField.values);
      }
    }

    const clearBtn = document.getElementById('jt-cf-clear-btn');
    if (clearBtn) clearBtn.style.display = filterFields.length > 0 ? 'block' : 'none';
    updateSaveDeleteVisibility();

    if (filterFields.length > 0) {
      await applyFilter();
    }
  }

  /**
   * Save the current filter configuration
   */
  async function saveCurrentFilter(name) {
    if (!name || filterFields.length === 0) {
      return;
    }

    const isLoggedIn = typeof AccountService !== 'undefined' && AccountService.isLoggedIn();
    if (!isLoggedIn) return;

    let filter;

    if (filterFields.length === 1) {
      // Single-field: use legacy format for backward compatibility
      const ff = filterFields[0];
      filter = {
        name: name.trim().substring(0, 50),
        fieldId: ff.fieldId || '',
        fieldName: ff.fieldName,
        filterValues: ff.values,
        jobStatus: activeJobStatus || 'all'
      };
    } else {
      // Multi-field: store fields array in filterValues with __multi__ marker
      filter = {
        name: name.trim().substring(0, 50),
        fieldId: '',
        fieldName: '__multi__',
        filterValues: filterFields.map(f => ({ fieldId: f.fieldId, fieldName: f.fieldName, values: f.values })),
        jobStatus: activeJobStatus || 'all'
      };
    }

    try {
      const result = await AccountService.saveSavedFilter(filter);
      if (result.success) {
        console.log('CustomFieldFilter: Filter saved:', filter.name);
        await loadSavedFilters();

        // Select the newly saved filter in the dedicated dropdown
        if (result.data && result.data.id) {
          activeSavedFilterId = result.data.id;
          const savedSelect = document.getElementById('jt-cf-saved-select');
          if (savedSelect) savedSelect.value = result.data.id;
          updateSaveDeleteVisibility();
        }
      } else {
        console.error('CustomFieldFilter: Failed to save filter:', result.error);
      }
    } catch (error) {
      console.error('CustomFieldFilter: Save filter error:', error);
    }
  }

  /**
   * Delete a saved filter
   */
  async function deleteSavedFilter(filterId) {
    const isLoggedIn = typeof AccountService !== 'undefined' && AccountService.isLoggedIn();
    if (!isLoggedIn) return;

    try {
      const result = await AccountService.deleteSavedFilter(filterId);
      if (result.success) {
        console.log('CustomFieldFilter: Filter deleted:', filterId);
        savedFilters = savedFilters.filter(f => f.id !== filterId);
        renderSavedFiltersInDropdown();
      } else {
        console.error('CustomFieldFilter: Failed to delete filter:', result.error);
      }
    } catch (error) {
      console.error('CustomFieldFilter: Delete filter error:', error);
    }
  }

  /**
   * Show/hide save and delete buttons based on current state
   */
  function updateSaveDeleteVisibility() {
    const saveBtn = document.getElementById('jt-cf-save-filter-btn');
    const deleteBtn = document.getElementById('jt-cf-delete-filter-btn');

    const isLoggedIn = typeof AccountService !== 'undefined' && AccountService.isLoggedIn();
    const hasFilter = filterFields.length > 0;

    // Show save button when there's an active filter and no saved filter is loaded
    if (saveBtn) {
      saveBtn.style.display = (isLoggedIn && hasFilter && !activeSavedFilterId) ? 'block' : 'none';
    }

    // Show delete button when a saved filter is currently loaded
    if (deleteBtn) {
      deleteBtn.style.display = (isLoggedIn && activeSavedFilterId) ? 'block' : 'none';
    }
  }

  // ─── Event Listeners ──────────────────────────────────────────────

  /**
   * Set up event listeners for filter controls
   */
  function setupFilterEventListeners() {
    const statusSelect = document.getElementById('jt-cf-status-select');
    const fieldSelect = document.getElementById('jt-cf-field-select');
    const clearBtn = document.getElementById('jt-cf-clear-btn');
    const valueTrigger = document.getElementById('jt-cf-value-trigger');
    const selectAllBtn = document.getElementById('jt-cf-select-all');
    const clearAllBtn = document.getElementById('jt-cf-clear-all');
    const saveFilterBtn = document.getElementById('jt-cf-save-filter-btn');
    const deleteFilterBtn = document.getElementById('jt-cf-delete-filter-btn');
    const saveConfirmBtn = document.getElementById('jt-cf-save-confirm');
    const saveCancelBtn = document.getElementById('jt-cf-save-cancel');
    const saveNameInput = document.getElementById('jt-cf-save-name');

    // Job status select
    if (statusSelect) {
      statusSelect.addEventListener('change', async (e) => {
        activeSavedFilterId = null;
        activeJobStatus = e.target.value;

        // Reset saved filter dropdown when manually changing status
        const savedSelect = document.getElementById('jt-cf-saved-select');
        if (savedSelect) savedSelect.value = '';

        // Re-apply filter (applyFilter handles all combinations: status, sort, location, custom fields)
        await applyFilter();

        updateSaveDeleteVisibility();
      });
    }

    // Saved filter select
    const savedSelect = document.getElementById('jt-cf-saved-select');
    if (savedSelect) {
      savedSelect.addEventListener('change', async (e) => {
        const filterId = e.target.value;
        if (!filterId) return;

        const filter = savedFilters.find(f => f.id === filterId);
        if (filter) {
          await loadSavedFilter(filter);
        }
      });
    }

    // Field selector
    if (fieldSelect) {
      fieldSelect.addEventListener('change', async (e) => {
        const fieldId = e.target.value;
        const selectedOption = e.target.selectedOptions[0];
        const valuesRow = document.getElementById('jt-cf-values-row');

        // Clear saved filter tracking when manually changing fields
        activeSavedFilterId = null;
        const savedSel = document.getElementById('jt-cf-saved-select');
        if (savedSel) savedSel.value = '';

        if (!fieldId) {
          // Placeholder selected — hide editor but keep existing filters
          currentEditFieldId = null;
          if (valuesRow) valuesRow.style.display = 'none';
          closeValueDropdown();
          updateSaveDeleteVisibility();
          return;
        }

        // Set the current edit field
        currentEditFieldId = fieldId;

        // Show values row
        if (valuesRow) valuesRow.style.display = 'flex';

        const fieldOptions = parseFieldOptions(selectedOption.dataset.options);
        const fieldName = selectedOption.textContent;

        // Update label
        const label = document.getElementById('jt-cf-value-label');
        if (label) {
          label.textContent = 'Loading values...';
          label.className = 'truncate text-gray-400';
        }

        // Populate checkboxes
        if (fieldOptions && fieldOptions.length > 0) {
          populateValueCheckboxes(fieldOptions);
        } else if (fieldId.startsWith('loc:')) {
          // Location custom field — extract values from job locations
          try {
            const realFieldId = fieldId.replace('loc:', '');
            const values = await getLocationCustomFieldValues(realFieldId, fieldName);
            populateValueCheckboxes(values);
            if (values.length === 0) {
              const list = document.getElementById('jt-cf-value-list');
              if (list) list.innerHTML = '<div class="p-2 text-xs text-gray-400 text-center">No values found</div>';
            }
          } catch (error) {
            console.error('CustomFieldFilter: Failed to get location field values:', error);
            const list = document.getElementById('jt-cf-value-list');
            if (list) list.innerHTML = '<div class="p-2 text-xs text-red-400 text-center">Error loading values</div>';
          }
        } else {
          try {
            let values;
            if (window.JobTreadProService && await JobTreadProService.isConfigured()) {
              values = await JobTreadProService.getCustomFieldValues(fieldId, fieldName);
            } else if (typeof JobTreadAPI !== 'undefined') {
              values = await JobTreadAPI.getCustomFieldValues(fieldId);
            } else {
              throw new Error('No API configured');
            }

            populateValueCheckboxes(values);

            if (values.length === 0) {
              const list = document.getElementById('jt-cf-value-list');
              if (list) list.innerHTML = '<div class="p-2 text-xs text-gray-400 text-center">No values found</div>';
            }
          } catch (error) {
            console.error('CustomFieldFilter: Failed to get field values:', error);
            const list = document.getElementById('jt-cf-value-list');
            if (list) list.innerHTML = '<div class="p-2 text-xs text-red-400 text-center">Error loading values</div>';
          }
        }

        // Pre-check values if this field already has a filter
        const existingFF = filterFields.find(f => f.fieldId === fieldId);
        if (existingFF) {
          setCheckedValues(existingFF.values);
        } else {
          updateValueLabel([]);
        }

        if (clearBtn) clearBtn.style.display = filterFields.length > 0 ? 'block' : 'none';
        updateSaveDeleteVisibility();
      });
    }

    // Value dropdown trigger
    if (valueTrigger) {
      valueTrigger.addEventListener('click', (e) => {
        e.stopPropagation();
        toggleValueDropdown();
      });
    }

    // Select All / Clear All
    if (selectAllBtn) {
      selectAllBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        selectAllValues();
      });
    }
    if (clearAllBtn) {
      clearAllBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        clearAllValues();
      });
    }

    // Clear button — resets everything back to default
    if (clearBtn) {
      clearBtn.addEventListener('click', () => {
        activeSavedFilterId = null;
        filterFields = [];
        currentEditFieldId = null;
        renderChips();
        updateFieldSelectOptions();
        clearFilter();
        if (fieldSelect) fieldSelect.value = '';
        if (statusSelect) statusSelect.value = activeJobStatus;
        const valuesRow = document.getElementById('jt-cf-values-row');
        if (valuesRow) valuesRow.style.display = 'none';
        closeValueDropdown();
        clearBtn.style.display = 'none';
        hideSaveInput();
        updateSaveDeleteVisibility();
      });
    }

    // Save filter button — show name input
    if (saveFilterBtn) {
      saveFilterBtn.addEventListener('click', () => {
        const inputRow = document.getElementById('jt-cf-save-input-row');
        if (inputRow) {
          inputRow.style.display = 'flex';
          saveFilterBtn.style.display = 'none';
          if (saveNameInput) {
            saveNameInput.value = '';
            saveNameInput.focus();
          }
        }
      });
    }

    // Delete saved filter button
    if (deleteFilterBtn) {
      deleteFilterBtn.addEventListener('click', async () => {
        if (!activeSavedFilterId) return;
        await deleteSavedFilter(activeSavedFilterId);
        activeSavedFilterId = null;

        // Reset status dropdown to 'all'
        if (statusSelect) statusSelect.value = 'all';

        // Clear all field filters
        filterFields = [];
        currentEditFieldId = null;
        renderChips();
        updateFieldSelectOptions();
        clearFilter();
        if (fieldSelect) fieldSelect.value = '';
        const valuesRow = document.getElementById('jt-cf-values-row');
        if (valuesRow) valuesRow.style.display = 'none';
        closeValueDropdown();
        if (clearBtn) clearBtn.style.display = 'none';
        hideSaveInput();
        updateSaveDeleteVisibility();
      });
    }

    // Save confirm
    if (saveConfirmBtn) {
      saveConfirmBtn.addEventListener('click', async (e) => {
        e.stopPropagation();
        if (saveNameInput && saveNameInput.value.trim()) {
          await saveCurrentFilter(saveNameInput.value);
          hideSaveInput();
        }
      });
    }

    // Save cancel
    if (saveCancelBtn) {
      saveCancelBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        hideSaveInput();
      });
    }

    // Enter key on save name input
    if (saveNameInput) {
      saveNameInput.addEventListener('keydown', async (e) => {
        // Stop propagation to prevent Job Switcher's Enter handler from
        // intercepting and closing the sidebar before the save completes
        if (e.key === 'Enter' || e.key === 'Escape') {
          e.stopPropagation();
        }
        if (e.key === 'Enter' && saveNameInput.value.trim()) {
          e.preventDefault();
          await saveCurrentFilter(saveNameInput.value);
          hideSaveInput();
        } else if (e.key === 'Escape') {
          hideSaveInput();
        }
      });
    }

    // Sort select handler
    const sortSelect = document.getElementById('jt-cf-sort-select');
    if (sortSelect) {
      chrome.storage.sync.get('jtSortOrder', (result) => {
        if (result.jtSortOrder) {
          activeSortOrder = result.jtSortOrder;
          sortSelect.value = activeSortOrder;
        }
      });

      sortSelect.addEventListener('change', () => {
        activeSortOrder = sortSelect.value;
        chrome.storage.sync.set({ jtSortOrder: activeSortOrder });
        applyFilter();
      });
    }

  }

  /**
   * Hide the save input row and show the save button
   */
  function hideSaveInput() {
    const inputRow = document.getElementById('jt-cf-save-input-row');
    if (inputRow) inputRow.style.display = 'none';
    updateSaveDeleteVisibility();
  }

  // ─── Filter Application ───────────────────────────────────────────

  /**
   * Apply status-only filter (open/closed/all)
   */
  async function applyStatusFilter() {
    const statusDiv = document.getElementById('jt-cf-status');
    const jobStatus = activeJobStatus || 'all';

    // If status is 'all' (default), just restore original display
    if (jobStatus === 'all') {
      restoreJobListDisplay();
      if (statusDiv) {
        statusDiv.style.display = 'none';
      }
      return;
    }

    if (statusDiv) {
      statusDiv.style.display = 'block';
      statusDiv.textContent = 'Filtering...';
      statusDiv.style.color = '#6b7280';
    }

    try {
      let jobs;

      if (window.JobTreadProService && await JobTreadProService.isConfigured()) {
        const result = await JobTreadProService.getFilteredJobs([], jobStatus);
        jobs = result.jobs || [];
      } else {
        if (statusDiv) {
          statusDiv.textContent = 'Status filter requires API configuration';
          statusDiv.style.color = '#f59e0b';
        }
        return;
      }

      if (statusDiv) {
        const statusLabel = jobStatus === 'closed' ? 'closed' : '';
        statusDiv.textContent = `Found ${jobs.length} ${statusLabel} job${jobs.length !== 1 ? 's' : ''}`;
        statusDiv.style.color = '#10b981';
      }

      updateJobListDisplay(jobs);
    } catch (error) {
      console.error('CustomFieldFilter: Status filter error:', error);
      if (statusDiv) {
        statusDiv.textContent = 'Filter error: ' + error.message;
        statusDiv.style.color = '#ef4444';
      }
    }
  }

  /**
   * Get Pave sortBy config based on current sort order
   */
  function getSortByConfig() {
    switch (activeSortOrder) {
      case 'az':  return [{ field: 'name', order: 'asc' }];
      case 'za':  return [{ field: 'name', order: 'desc' }];
      default:    return [{ field: 'createdAt' }];
    }
  }

  /**
   * Apply the current filter (multi-field AND with multi-value OR per field + status + sort + location)
   */
  async function applyFilter() {
    currentPage = 0;
    isLoadingMore = false;
    hasMoreJobs = true;
    allLoadedJobs = [];
    if (scrollObserver) scrollObserver.disconnect();

    const statusDiv = document.getElementById('jt-cf-status');
    const jobStatus = activeJobStatus || 'all';
    const hasCustomFieldFilters = filterFields.length > 0;

    // If nothing active and sort is default, restore original display
    if (!hasCustomFieldFilters && jobStatus === 'all' && activeSortOrder === 'recent') {
      restoreJobListDisplay();
      if (statusDiv) {
        statusDiv.style.display = 'none';
      }
      return;
    }

    const sortBy = getSortByConfig();

    if (statusDiv) {
      statusDiv.style.display = 'block';
      statusDiv.textContent = 'Filtering...';
      statusDiv.style.color = '#6b7280';
    }

    try {
      let jobs;

      // Separate job custom field filters from location custom field filters
      // Location fields have IDs prefixed with 'loc:' — they're filtered client-side
      const jobFilters = filterFields.filter(f => !f.fieldId.startsWith('loc:'));
      const filters = jobFilters.map(f => ({
        fieldName: f.fieldName,
        values: f.values
      }));


      // Try Pro Service first (uses Cloudflare Worker — supports multi-field AND)
      if (window.JobTreadProService && await JobTreadProService.isConfigured()) {
        const result = await JobTreadProService.getFilteredJobs(filters, jobStatus);
        jobs = result.jobs || [];
      } else if (typeof JobTreadAPI !== 'undefined' && typeof JobTreadAPI.fetchJobsWithFilters === 'function') {
        // Direct API fallback — fetchJobsWithFilters supports multi-field AND
        const flatFilters = [];
        filters.forEach(f => {
          f.values.forEach(v => flatFilters.push({ fieldName: f.fieldName, value: v }));
        });
        jobs = await JobTreadAPI.fetchJobsWithFilters(flatFilters, { status: jobStatus !== 'all' ? jobStatus : null, sortBy });
        // Client-side status filter for direct API (in case API doesn't handle it)
        if (jobStatus !== 'all') {
          const isClosed = jobStatus === 'closed';
          jobs = jobs.filter(job => (job.status === 'Closed') === isClosed);
        }
      } else if (hasCustomFieldFilters) {
        // Legacy single-field fallback
        const allJobs = await JobTreadAPI.fetchJobsByCustomField(
          filters[0].fieldName,
          filters[0].values[0]
        );
        jobs = allJobs;
        if (jobStatus !== 'all') {
          const isClosed = jobStatus === 'closed';
          jobs = jobs.filter(job => (job.status === 'Closed') === isClosed);
        }
      } else {
        // No custom field filters — just status/sort/location, need to fetch jobs
        if (window.JobTreadProService && await JobTreadProService.isConfigured()) {
          const result = await JobTreadProService.getFilteredJobs([], jobStatus);
          jobs = result.jobs || [];
        } else if (typeof JobTreadAPI !== 'undefined' && typeof JobTreadAPI.fetchJobsWithFilters === 'function') {
          jobs = await JobTreadAPI.fetchJobsWithFilters([], { status: jobStatus !== 'all' ? jobStatus : null, sortBy });
          if (jobStatus !== 'all') {
            const isClosed = jobStatus === 'closed';
            jobs = jobs.filter(job => (job.status === 'Closed') === isClosed);
          }
        } else {
          jobs = [];
        }
      }

      // Location custom field filter — resolve matching location IDs, then filter jobs
      const locFieldFilters = filterFields.filter(f => f.fieldId.startsWith('loc:'));
      if (locFieldFilters.length > 0 && jobs) {
        let matchingLocationIds = null;
        try {
          // Fetch locations with custom field values in small pages to avoid 413
          let allLocations = [];
          const orgId = await JobTreadAPI.getOrgId();
          if (orgId) {
            let page = undefined;
            let pageCount = 0;
            do {
              const params = { size: 25 };
              if (page) params.page = page;
              const locData = await JobTreadAPI.paveQuery({
                organization: {
                  $: { id: orgId },
                  locations: {
                    $: params,
                    nextPage: {},
                    nodes: {
                      id: {},
                      customFieldValues: {
                        nodes: {
                          value: {},
                          customField: { id: {}, name: {} }
                        }
                      }
                    }
                  }
                }
              });
              const nodes = locData.organization?.locations?.nodes || [];
              allLocations = allLocations.concat(nodes);
              page = locData.organization?.locations?.nextPage || null;
              pageCount++;
            } while (page && pageCount < 10);

            // Filter locations that match ALL location field filters
            const matching = allLocations.filter(loc => {
              const cfvs = loc.customFieldValues?.nodes || [];
              return locFieldFilters.every(ff => {
                const realId = ff.fieldId.replace('loc:', '');
                const cfv = cfvs.find(v => v.customField?.id === realId || v.customField?.name === ff.fieldName);
                return cfv && ff.values.includes(cfv.value);
              });
            });
            matchingLocationIds = new Set(matching.map(l => l.id));
            console.log('CustomFieldFilter: Location filter matched', matchingLocationIds.size, 'of', allLocations.length, 'locations');
          }
        } catch (e) {
          console.warn('CustomFieldFilter: Location filter query failed:', e);
        }

        if (matchingLocationIds) {
          jobs = jobs.filter(job => job.location?.id && matchingLocationIds.has(job.location.id));
        }
      }

      // Client-side sort for Pro Service results (API may not sort)
      if (activeSortOrder === 'az') {
        jobs.sort((a, b) => (a.name || '').localeCompare(b.name || ''));
      } else if (activeSortOrder === 'za') {
        jobs.sort((a, b) => (b.name || '').localeCompare(a.name || ''));
      }

      if (statusDiv) {
        const parts = [];
        if (hasCustomFieldFilters) {
          const filterCount = filterFields.length;
          parts.push(filterCount > 1 ? `${filterCount} filters` : '1 filter');
        }
        const prefix = parts.length > 0 ? parts.join(' + ') + ': ' : '';
        statusDiv.textContent = `${prefix}Found ${jobs.length} matching job${jobs.length !== 1 ? 's' : ''}`;
        statusDiv.style.color = '#10b981';
      }

      // Update the job list display
      updateJobListDisplay(jobs);
    } catch (error) {
      console.error('CustomFieldFilter: Filter error:', error);
      if (statusDiv) {
        statusDiv.textContent = 'Filter error: ' + error.message;
        statusDiv.style.color = '#ef4444';
      }
    }
  }

  /**
   * Clear the current filter (keeps status filter)
   */
  function clearFilter() {
    // filterFields and currentEditFieldId should already be cleared by caller
    // activeJobStatus is preserved

    const statusDiv = document.getElementById('jt-cf-status');
    if (statusDiv) {
      statusDiv.style.display = 'none';
    }

    // If status is not 'all' (default), re-apply just the status filter
    if (activeJobStatus && activeJobStatus !== 'all') {
      applyStatusFilter();
      return;
    }

    // Restore original job list
    restoreJobListDisplay();
  }

  /**
   * Update the job list to show filtered results
   * @param {Array} jobs - Jobs to display
   * @param {boolean} append - If true, append to existing list (infinite scroll)
   */
  function updateJobListDisplay(jobs, append = false) {
    const sidebar = document.querySelector('div.z-30.absolute.top-0.bottom-0.right-0');
    if (!sidebar) return;

    // Find the job list container (the scrollable area with job items)
    const jobListContainer = sidebar.querySelector('div[style*="padding-top: 0px"]');
    if (!jobListContainer) {
      return;
    }

    // Store original content if not already stored
    if (!jobListContainer.dataset.originalHtml) {
      jobListContainer.dataset.originalHtml = jobListContainer.innerHTML;
    }

    // Track loaded jobs for pagination
    if (!append) {
      allLoadedJobs = jobs;
      currentPage = 0;
      hasMoreJobs = jobs.length >= 50;
    } else {
      allLoadedJobs = allLoadedJobs.concat(jobs);
      hasMoreJobs = jobs.length >= 50;
    }

    // Create filtered job items HTML
    if (!append && jobs.length === 0) {
      jobListContainer.innerHTML = `
        <div class="p-4 text-center text-gray-500">
          No jobs match the selected filter
        </div>
      `;
      return;
    }

    // The currently-open job (from the URL) is highlighted like native JT.
    const currentJobId = (window.location.pathname.match(/^\/jobs\/([^\/]+)/) || [])[1] || null;

    const jobItemsHtml = jobs.map(job => {
      const isClosed = job.status === 'Closed' || job.closedOn;
      const loc = job.location;
      const locName = loc ? (loc.name || '') : '';
      const locAddr = loc ? (loc.formattedAddress || loc.address || '') : '';
      const locDisplay = locName && locAddr ? `${locName} / ${locAddr}` : (locName || locAddr);
      // Match native JT result rows:
      //  - the open job gets bg-blue-50 + a VISIBLE green check (others keep an
      //    invisible check as a spacer so the text columns stay aligned)
      //  - the customer/location is the cyan line; the bold line shows the job
      //    name only (no job number)
      const isSelected = currentJobId && job.id === currentJobId;
      const jobName = job.name || 'Unnamed Job';

      return `
      <div role="button" tabindex="0" class="relative cursor-pointer p-2 flex items-center gap-2 border-t ${isSelected ? 'bg-blue-50' : 'hover:bg-gray-50'}" data-job-id="${escapeAttr(job.id)}">
        <svg xmlns="http://www.w3.org/2000/svg" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2" class="inline-block overflow-visible h-[1em] w-[1em] align-[-0.125em] shrink-0 text-xl text-green-500 ${isSelected ? '' : 'invisible'}" viewBox="0 0 24 24"><path d="M20 6 9 17l-5-5"></path></svg>
        <div class="grow min-w-0">
          ${locDisplay ? `<div class="text-cyan-500 text-xs font-bold uppercase truncate" title="${escapeAttr(locDisplay)}">${escapeHtml(locDisplay)}</div>` : ''}
          <div class="flex gap-2">
            <div class="grow min-w-0 font-bold truncate">${escapeHtml(jobName)}</div>
            ${isClosed ? '<div class="shrink-0 text-gray-500">Closed</div>' : ''}
          </div>
        </div>
      </div>
    `;
    }).join('');

    if (append) {
      // Remove old sentinel before appending
      const oldSentinel = jobListContainer.querySelector('.jt-scroll-sentinel');
      if (oldSentinel) oldSentinel.remove();
      jobListContainer.insertAdjacentHTML('beforeend', jobItemsHtml);
    } else {
      jobListContainer.innerHTML = jobItemsHtml;
    }

    // Add click handlers only to items that haven't been bound yet
    jobListContainer.querySelectorAll('[data-job-id]:not([data-click-bound])').forEach(item => {
      item.dataset.clickBound = 'true';
      item.addEventListener('click', () => {
        const jobId = item.dataset.jobId;

        // Smart navigation: preserve current section (budget, schedule, etc.)
        const currentPath = window.location.pathname;
        const jobSectionMatch = currentPath.match(/^\/jobs\/[^\/]+\/(.+)$/);

        let newPath;
        if (jobSectionMatch) {
          // Currently in a specific section (e.g., /jobs/123/budget)
          const section = jobSectionMatch[1];
          newPath = `/jobs/${jobId}/${section}`;
        } else {
          // Currently on job overview page or elsewhere
          newPath = `/jobs/${jobId}`;
        }

        // Use client-side navigation to keep sidebar open (like native Job Switcher)
        // Push new state and dispatch popstate to trigger React Router navigation
        window.history.pushState({}, '', newPath);
        window.dispatchEvent(new PopStateEvent('popstate', { state: {} }));
      });
    });

    // Set up infinite scroll sentinel if more jobs may be available
    if (hasMoreJobs) {
      // Disconnect previous observer
      if (scrollObserver) scrollObserver.disconnect();

      const sentinel = document.createElement('div');
      sentinel.className = 'jt-scroll-sentinel';
      sentinel.style.cssText = 'padding: 12px; text-align: center; color: #9ca3af; font-size: 12px;';
      sentinel.textContent = 'Loading more...';
      jobListContainer.appendChild(sentinel);

      scrollObserver = new IntersectionObserver((entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting && !isLoadingMore && hasMoreJobs) {
            loadMoreJobs();
          }
        }
      }, { rootMargin: '200px' });

      scrollObserver.observe(sentinel);
    }
  }

  /**
   * Re-apply the "selected job" highlight (green check + bg-blue-50) to the row
   * matching the currently-open job. Called on popstate so switching jobs keeps
   * the highlight current without re-rendering the whole list — our row clicks
   * dispatch popstate, and browser back/forward fire it natively.
   */
  function updateSelectedJobHighlight() {
    const currentJobId = (window.location.pathname.match(/^\/jobs\/([^\/]+)/) || [])[1] || null;
    document.querySelectorAll('[data-job-id]').forEach(row => {
      // Only touch our rendered rows — they carry the green-check spacer svg as
      // a direct child. This guards against any unrelated [data-job-id] element.
      const check = row.querySelector(':scope > svg.text-green-500');
      if (!check) return;
      const isSelected = !!currentJobId && row.dataset.jobId === currentJobId;
      row.classList.toggle('bg-blue-50', isSelected);
      row.classList.toggle('hover:bg-gray-50', !isSelected);
      check.classList.toggle('invisible', !isSelected);
    });
  }

  /**
   * Load the next page of jobs for infinite scroll
   */
  async function loadMoreJobs() {
    if (isLoadingMore || !hasMoreJobs) return;
    isLoadingMore = true;
    currentPage++;

    try {
      const sortBy = getSortByConfig();
      const offset = currentPage * 50;
      const jobStatus = activeJobStatus || 'all';
      let jobs;

      if (filterFields.length > 0) {
        // Has custom field filters
        const filters = filterFields.map(f => ({
          fieldName: f.fieldName,
          values: f.values
        }));

        if (window.JobTreadProService && await JobTreadProService.isConfigured()) {
          const result = await JobTreadProService.getFilteredJobs(filters, jobStatus, {
            sortBy, offset, limit: 50
          });
          jobs = result.jobs || [];
        } else if (typeof JobTreadAPI !== 'undefined') {
          const flatFilters = [];
          filters.forEach(f => {
            f.values.forEach(v => flatFilters.push({ fieldName: f.fieldName, value: v }));
          });
          jobs = await JobTreadAPI.fetchJobsWithFilters(flatFilters, {
            status: jobStatus !== 'all' ? jobStatus : null,
            sortBy, limit: 50, offset
          });
        }
      } else {
        // No custom field filters — just status + sort
        jobs = await JobTreadAPI.fetchJobs({
          limit: 50, offset, sortBy,
          status: jobStatus !== 'all' ? jobStatus : null
        });
      }

      if (jobs && jobs.length > 0) {
        // Client-side sort for Pro Service results
        if (activeSortOrder === 'az') {
          jobs.sort((a, b) => (a.name || '').localeCompare(b.name || ''));
        } else if (activeSortOrder === 'za') {
          jobs.sort((a, b) => (b.name || '').localeCompare(a.name || ''));
        }
        updateJobListDisplay(jobs, true);
      } else {
        hasMoreJobs = false;
        const sentinel = document.querySelector('.jt-scroll-sentinel');
        if (sentinel) sentinel.remove();
      }
    } catch (error) {
      console.error('CustomFieldFilter: Error loading more jobs:', error);
      hasMoreJobs = false;
    } finally {
      isLoadingMore = false;
    }
  }

  /**
   * Restore the original job list display
   */
  function restoreJobListDisplay() {
    const sidebar = document.querySelector('div.z-30.absolute.top-0.bottom-0.right-0');
    if (!sidebar) return;

    const jobListContainer = sidebar.querySelector('div[style*="padding-top: 0px"]');
    if (!jobListContainer || !jobListContainer.dataset.originalHtml) return;

    jobListContainer.innerHTML = jobListContainer.dataset.originalHtml;
    delete jobListContainer.dataset.originalHtml;
  }

  // ─── Helpers ──────────────────────────────────────────────────────

  // Delegate to shared Sanitizer utility — Sanitizer.escapeAttr escapes all
  // five attribute-sensitive chars (& < > " ') whereas this module's former
  // local escapeAttr missed < and >, allowing attribute injection if a
  // field value contained them.
  const escapeHtml = (text) => Sanitizer.escapeHTML(text);
  const escapeAttr = (text) => Sanitizer.escapeAttr(text);

  // ─── Location Filter ─────────────────────────────────────────────

  /**
   * Load locations from the API and populate the location dropdown
   */
  /**
   * Get unique values for a location custom field by scanning job locations
   * @param {string} fieldId - The location custom field ID (without loc: prefix)
   * @param {string} fieldName - The custom field name
   * @returns {Promise<Array>} Unique values
   */
  async function getLocationCustomFieldValues(fieldId, fieldName) {
    // Use Pro Worker first — handles pagination and caching server-side
    if (window.JobTreadProService && await JobTreadProService.isConfigured()) {
      try {
        return await JobTreadProService.getLocationCustomFieldValues(fieldId, fieldName);
      } catch (e) {
        console.warn('CustomFieldFilter: Pro Worker location values failed, trying direct:', e);
      }
    }

    // Fallback: direct Pave query
    const values = new Set();
    const orgId = await JobTreadAPI.getOrgId();
    if (!orgId) return [];

    const result = await JobTreadAPI.paveQuery({
      organization: {
        $: { id: orgId },
        locations: {
          $: { size: 50 },
          nodes: {
            id: {},
            customFieldValues: {
              nodes: {
                value: {},
                customField: { id: {}, name: {} }
              }
            }
          }
        }
      }
    });

    const locations = result.organization?.locations?.nodes || [];
    locations.forEach(loc => {
      const cfvs = loc.customFieldValues?.nodes || [];
      cfvs.forEach(cfv => {
        if ((cfv.customField?.id === fieldId || cfv.customField?.name === fieldName) && cfv.value) {
          values.add(cfv.value);
        }
      });
    });

    return Array.from(values).sort();
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
  window.CustomFieldFilterFeature = CustomFieldFilterFeature;
}
