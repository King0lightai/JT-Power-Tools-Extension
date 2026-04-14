# Job Switcher & Budget Changelog Improvements — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add infinite scroll, alphabetical sorting, and location filtering to Job Switcher; rebuild Budget Changelog report as a full interactive app with virtual scrolling, sorting, filtering, collapsible groups, side-by-side view, and exports.

**Architecture:** Job Switcher changes modify existing IIFE modules (jobtread-api.js, custom-field-filter.js, job-switcher.js) to support pagination, sort params, and location entity fetching. Budget Changelog replaces the static HTML report generator in ui.js with a self-contained interactive SPA embedded in a Blob URL, powered by a new report-app.js module that handles virtual rendering, state management, and user interactions for 1000+ line items.

**Tech Stack:** Plain JavaScript (IIFE modules), Chrome Extension MV3, Pave API, CSS Grid/Flexbox, IntersectionObserver, no build tools.

---

## PART 1: JOB SWITCHER IMPROVEMENTS

### Task 1: Add Sort Parameter Support to JobTreadAPI

**Files:**
- Modify: `JT-Tools-Master/services/jobtread-api.js:444-507` (fetchJobs)
- Modify: `JT-Tools-Master/services/jobtread-api.js:526-600` (fetchJobsWithFilters)

**Step 1: Add sortBy parameter to fetchJobs**

In `jobtread-api.js`, update the `fetchJobs` function signature and query construction to accept a `sortBy` option:

```javascript
// Line 444 — update options destructuring
async function fetchJobs(options = {}) {
  const { limit = 100, offset = 0, status = null, sortBy = null } = options;

  // ...existing orgId check...

  // Build query parameters (max size is 100)
  const queryParams = {
    size: Math.min(limit, 100),
    sortBy: sortBy || [{ field: 'createdAt' }]
  };
```

**Step 2: Add sortBy parameter to fetchJobsWithFilters**

Update `fetchJobsWithFilters` to accept and pass through sort options:

```javascript
// Line 526 — update signature
async function fetchJobsWithFilters(filters = [], options = {}) {
  const { status = null, sortBy = null, limit = 100, offset = 0 } = options;

  // ...existing orgId check...

  // If no filters, return all jobs with sort
  if (!filters || filters.length === 0) {
    return fetchJobs({ limit, offset, status, sortBy });
  }

  // In the query object at line 561, update:
  const query = {
    organization: {
      $: { id: orgId },
      jobs: {
        $: {
          size: Math.min(limit, 100),
          ...(offset > 0 ? { skip: offset } : {}),
          with: withClauses,
          where: whereClause,
          sortBy: sortBy || [{ field: 'name' }]
        },
        // ...existing nodes...
      }
    }
  };
```

**Step 3: Add fetchLocations method**

Add a new method after `fetchCustomFieldDefinitions` (~line 434):

```javascript
/**
 * Fetch organization locations for filtering
 * @param {string} orgId - Organization ID (optional)
 * @returns {Promise<Array>} List of locations with id and name
 */
async function fetchLocations(orgId = null) {
  // Check cache first
  try {
    const cached = await chrome.storage.local.get([
      'jtToolsLocationsCache',
      'jtToolsLocationsTimestamp'
    ]);
    const cacheAge = Date.now() - (cached.jtToolsLocationsTimestamp || 0);
    if (cached.jtToolsLocationsCache && cacheAge < CUSTOM_FIELDS_CACHE_DURATION) {
      console.log('JobTreadAPI: Using cached locations');
      return cached.jtToolsLocationsCache;
    }
  } catch (e) { /* cache read failed */ }

  if (!orgId) {
    orgId = await getOrgId();
    if (!orgId) throw new Error('Organization ID not configured');
  }

  const query = {
    organization: {
      $: { id: orgId },
      locations: {
        $: { size: 100, sortBy: [{ field: 'name' }] },
        nodes: {
          id: {},
          name: {}
        }
      }
    }
  };

  try {
    const result = await paveQuery(query);
    const locations = result.organization?.locations?.nodes || [];
    console.log('JobTreadAPI: Fetched locations:', locations.length);

    await chrome.storage.local.set({
      jtToolsLocationsCache: locations,
      jtToolsLocationsTimestamp: Date.now()
    });

    return locations;
  } catch (error) {
    console.error('JobTreadAPI: Failed to fetch locations:', error);
    throw error;
  }
}
```

**Step 4: Add fetchLocations to the public API return object**

Find the `return { ... }` at the bottom of the IIFE and add `fetchLocations`:

```javascript
return {
  // ...existing exports...
  fetchLocations,
};
```

**Step 5: Commit**

```bash
git add JT-Tools-Master/services/jobtread-api.js
git commit -m "feat: add sort params, pagination offsets, and location fetching to JobTreadAPI"
```

---

### Task 2: Add Sort Controls and Location Filter to CustomFieldFilter UI

**Files:**
- Modify: `JT-Tools-Master/features/custom-field-filter.js:6-17` (state vars)
- Modify: `JT-Tools-Master/features/custom-field-filter.js:202-258` (filter container HTML)
- Modify: `JT-Tools-Master/features/custom-field-filter.js:263-274` (setup after injection)
- Modify: `JT-Tools-Master/features/custom-field-filter.js:290-337` (loadCustomFieldDefinitions)
- Modify: `JT-Tools-Master/features/custom-field-filter.js:1236-1305` (applyFilter)
- Modify: `JT-Tools-Master/features/custom-field-filter.js:1332-1401` (updateJobListDisplay)

**Step 1: Add state variables for sort and location**

After line 17 (`let availableValues = [];`), add:

```javascript
let activeSortOrder = 'recent';    // 'recent', 'az', 'za'
let locationDefinitions = null;    // Cached location list
let locationFilterValues = [];     // Selected location IDs
```

**Step 2: Add sort control and location filter to the injected HTML**

In the `injectFilterUI` function, update the `filterContainer.innerHTML` template. Insert a sort row after the status select and a location row after the sort:

```html
<!-- After the status select div (line 206-211), add: -->
<div class="flex items-center gap-2 mb-2">
  <select id="jt-cf-sort-select" class="rounded-sm border p-1 text-sm flex-1 appearance-none bg-white hover:bg-gray-50 focus:border-cyan-500 focus:shadow-sm transition" style="min-width: 0;">
    <option value="recent">Sort: Recent</option>
    <option value="az">Sort: A → Z</option>
    <option value="za">Sort: Z → A</option>
  </select>
</div>
<div class="flex items-center gap-2 mb-2" id="jt-cf-location-row" style="display: none;">
  <div id="jt-cf-location-dropdown" class="relative flex-1" style="min-width: 0;">
    <button id="jt-cf-location-trigger" class="rounded-sm border p-1 text-sm w-full text-left bg-white hover:bg-gray-50 focus:border-cyan-500 focus:shadow-sm transition flex items-center justify-between" type="button">
      <span id="jt-cf-location-label" class="truncate text-gray-500">Filter by Location...</span>
      <svg xmlns="http://www.w3.org/2000/svg" fill="none" stroke="currentColor" stroke-width="2" class="h-3 w-3 shrink-0 ml-1" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M19 9l-7 7-7-7"/></svg>
    </button>
    <div id="jt-cf-location-panel" class="absolute z-50 mt-1 w-full rounded-sm border bg-white shadow-lg" style="display: none; max-height: 220px;">
      <div class="flex items-center justify-between p-1 border-b text-xs">
        <button id="jt-cf-location-select-all" class="text-cyan-600 hover:text-cyan-700 font-medium px-1">Select All</button>
        <button id="jt-cf-location-clear-all" class="text-gray-500 hover:text-gray-700 font-medium px-1">Clear All</button>
      </div>
      <div id="jt-cf-location-list" class="overflow-y-auto" style="max-height: 180px;"></div>
    </div>
  </div>
</div>
```

**Step 3: Load locations alongside custom fields**

After `loadCustomFieldDefinitions()` call in `injectFilterUI` (~line 264), add:

```javascript
// Load locations for location filter
await loadLocations();
```

Add the `loadLocations` function:

```javascript
async function loadLocations() {
  const locationRow = document.getElementById('jt-cf-location-row');
  if (!locationRow) return;

  try {
    let locations;
    if (window.JobTreadProService && await JobTreadProService.isConfigured()) {
      // Pro Service path — if it supports locations
      const result = await JobTreadProService.getLocations?.();
      locations = result?.locations || [];
    }
    if (!locations || locations.length === 0) {
      if (typeof JobTreadAPI !== 'undefined') {
        locations = await JobTreadAPI.fetchLocations();
      }
    }

    locationDefinitions = locations || [];

    if (locationDefinitions.length > 0) {
      locationRow.style.display = 'flex';
      populateLocationCheckboxes(locationDefinitions);
    }
  } catch (error) {
    console.error('CustomFieldFilter: Failed to load locations:', error);
  }
}

function populateLocationCheckboxes(locations) {
  const list = document.getElementById('jt-cf-location-list');
  if (!list) return;
  list.innerHTML = '';

  locations.forEach(loc => {
    const label = document.createElement('label');
    label.className = 'flex items-center gap-2 px-2 py-1 hover:bg-gray-50 cursor-pointer text-sm';
    label.innerHTML = `
      <input type="checkbox" class="jt-cf-location-cb" value="${escapeAttr(loc.id)}" data-name="${escapeAttr(loc.name)}" style="accent-color: #06b6d4;">
      <span class="truncate">${escapeHtml(loc.name)}</span>
    `;
    list.appendChild(label);

    label.querySelector('input').addEventListener('change', onLocationCheckboxChange);
  });
}

function onLocationCheckboxChange() {
  const checked = document.querySelectorAll('.jt-cf-location-cb:checked');
  locationFilterValues = Array.from(checked).map(cb => ({
    id: cb.value,
    name: cb.dataset.name
  }));

  const label = document.getElementById('jt-cf-location-label');
  if (label) {
    if (locationFilterValues.length === 0) {
      label.textContent = 'Filter by Location...';
      label.className = 'truncate text-gray-500';
    } else if (locationFilterValues.length === 1) {
      label.textContent = locationFilterValues[0].name;
      label.className = 'truncate text-gray-900';
    } else {
      label.textContent = `${locationFilterValues.length} locations selected`;
      label.className = 'truncate text-gray-900';
    }
  }

  // Trigger filter application
  applyFilter();
}
```

**Step 4: Add sort and location dropdown event listeners**

In `setupFilterEventListeners` function, add handlers for the sort select and location dropdown:

```javascript
// Sort select handler
const sortSelect = document.getElementById('jt-cf-sort-select');
if (sortSelect) {
  // Restore saved sort preference
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

// Location dropdown toggle
const locationTrigger = document.getElementById('jt-cf-location-trigger');
if (locationTrigger) {
  locationTrigger.addEventListener('click', (e) => {
    e.stopPropagation();
    const panel = document.getElementById('jt-cf-location-panel');
    if (panel) panel.style.display = panel.style.display === 'none' ? 'block' : 'none';
  });
}

// Location select all / clear all
const locSelectAll = document.getElementById('jt-cf-location-select-all');
const locClearAll = document.getElementById('jt-cf-location-clear-all');
if (locSelectAll) {
  locSelectAll.addEventListener('click', () => {
    document.querySelectorAll('.jt-cf-location-cb').forEach(cb => { cb.checked = true; });
    onLocationCheckboxChange();
  });
}
if (locClearAll) {
  locClearAll.addEventListener('click', () => {
    document.querySelectorAll('.jt-cf-location-cb').forEach(cb => { cb.checked = false; });
    onLocationCheckboxChange();
  });
}
```

**Step 5: Update applyFilter to include sort and location**

Rewrite the `applyFilter` function (~line 1236) to pass sort order and location filters:

```javascript
async function applyFilter() {
  const statusDiv = document.getElementById('jt-cf-status');
  const jobStatus = activeJobStatus || 'all';

  // Build sortBy based on activeSortOrder
  let sortBy;
  switch (activeSortOrder) {
    case 'az':  sortBy = [{ field: 'name', order: 'asc' }]; break;
    case 'za':  sortBy = [{ field: 'name', order: 'desc' }]; break;
    default:    sortBy = [{ field: 'createdAt' }]; break;
  }

  const hasCustomFieldFilters = filterFields.length > 0;
  const hasLocationFilter = locationFilterValues.length > 0;
  const hasAnyFilter = hasCustomFieldFilters || hasLocationFilter || jobStatus !== 'all';

  if (!hasAnyFilter && activeSortOrder === 'recent') {
    // No filters, default sort — restore original
    restoreJobListDisplay();
    return;
  }

  if (statusDiv) {
    statusDiv.style.display = 'block';
    statusDiv.textContent = 'Filtering...';
    statusDiv.style.color = '#6b7280';
  }

  try {
    let jobs;

    const filters = filterFields.map(f => ({
      fieldName: f.fieldName,
      values: f.values
    }));

    // Try Pro Service first
    if (window.JobTreadProService && await JobTreadProService.isConfigured()) {
      const result = await JobTreadProService.getFilteredJobs(filters, jobStatus, {
        sortBy,
        locationIds: hasLocationFilter ? locationFilterValues.map(l => l.id) : null
      });
      jobs = result.jobs || [];
    } else if (typeof JobTreadAPI !== 'undefined') {
      // Direct API fallback
      const flatFilters = [];
      filters.forEach(f => {
        f.values.forEach(v => flatFilters.push({ fieldName: f.fieldName, value: v }));
      });

      jobs = await JobTreadAPI.fetchJobsWithFilters(flatFilters, {
        status: jobStatus !== 'all' ? jobStatus : null,
        sortBy
      });

      // Client-side location filter (Pave location with clause would need separate implementation)
      if (hasLocationFilter) {
        // For direct API, we need to filter client-side by location
        // This is a limitation — Pro Service handles it server-side
        console.log('CustomFieldFilter: Location filtering via direct API not yet supported');
      }

      // Client-side status filter for direct API
      if (jobStatus !== 'all' && !flatFilters.length) {
        const isClosed = jobStatus === 'closed';
        jobs = jobs.filter(job => (job.status === 'Closed') === isClosed);
      }
    }

    if (statusDiv) {
      const parts = [];
      if (hasCustomFieldFilters) parts.push(`${filterFields.length} field${filterFields.length > 1 ? 's' : ''}`);
      if (hasLocationFilter) parts.push(`${locationFilterValues.length} location${locationFilterValues.length > 1 ? 's' : ''}`);
      const prefix = parts.length > 0 ? parts.join(', ') + ': ' : '';
      statusDiv.textContent = `${prefix}Found ${jobs.length} matching job${jobs.length !== 1 ? 's' : ''}`;
      statusDiv.style.color = '#10b981';
    }

    updateJobListDisplay(jobs);
  } catch (error) {
    console.error('CustomFieldFilter: Filter error:', error);
    if (statusDiv) {
      statusDiv.textContent = 'Filter error: ' + error.message;
      statusDiv.style.color = '#ef4444';
    }
  }
}
```

**Step 6: Update handleClickOutside to also close location dropdown**

```javascript
function handleClickOutside(e) {
  if (dropdownOpen) {
    const dropdown = document.getElementById('jt-cf-value-dropdown');
    if (dropdown && !dropdown.contains(e.target)) {
      closeValueDropdown();
    }
  }
  // Close location dropdown too
  const locDropdown = document.getElementById('jt-cf-location-dropdown');
  const locPanel = document.getElementById('jt-cf-location-panel');
  if (locPanel && locPanel.style.display !== 'none' && locDropdown && !locDropdown.contains(e.target)) {
    locPanel.style.display = 'none';
  }
}
```

**Step 7: Reset location state in cleanup**

In `cleanup()` (~line 75), add:

```javascript
locationDefinitions = null;
locationFilterValues = [];
activeSortOrder = 'recent';
```

**Step 8: Commit**

```bash
git add JT-Tools-Master/features/custom-field-filter.js
git commit -m "feat: add sort controls and location entity filter to Job Switcher"
```

---

### Task 3: Add Infinite Scroll to Job Switcher

**Files:**
- Modify: `JT-Tools-Master/features/custom-field-filter.js:1332-1401` (updateJobListDisplay)
- Modify: `JT-Tools-Master/features/custom-field-filter.js:6-17` (state vars)

**Step 1: Add infinite scroll state variables**

Add after existing state vars:

```javascript
let currentPage = 0;
let isLoadingMore = false;
let hasMoreJobs = true;
let allLoadedJobs = [];
let scrollObserver = null;
let lastAppliedFilters = null;  // Cache of last filter params for loading more
```

**Step 2: Rewrite updateJobListDisplay to support infinite scroll**

Replace the `updateJobListDisplay` function with a version that renders a page at a time and sets up an IntersectionObserver sentinel:

```javascript
function updateJobListDisplay(jobs, append = false) {
  const sidebar = document.querySelector('div.z-30.absolute.top-0.bottom-0.right-0');
  if (!sidebar) return;

  const jobListContainer = sidebar.querySelector('div[style*="padding-top: 0px"]');
  if (!jobListContainer) return;

  // Store original content if not already stored
  if (!jobListContainer.dataset.originalHtml) {
    jobListContainer.dataset.originalHtml = jobListContainer.innerHTML;
  }

  if (!append) {
    // Fresh render — reset state
    allLoadedJobs = jobs;
    currentPage = 0;
    hasMoreJobs = jobs.length >= 50; // If we got a full page, there might be more
  } else {
    allLoadedJobs = allLoadedJobs.concat(jobs);
    hasMoreJobs = jobs.length >= 50;
  }

  if (allLoadedJobs.length === 0) {
    jobListContainer.innerHTML = `
      <div class="p-4 text-center text-gray-500">
        No jobs match the selected filter
      </div>
    `;
    return;
  }

  const jobItemsHtml = (append ? jobs : allLoadedJobs).map(job => {
    const isClosed = job.status === 'Closed' || job.closedOn;
    return `
    <div role="button" tabindex="0" class="relative cursor-pointer p-2 flex items-center gap-2 border-t hover:bg-gray-50" data-job-id="${escapeAttr(job.id)}">
      <svg xmlns="http://www.w3.org/2000/svg" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2" class="inline-block overflow-visible h-[1em] w-[1em] align-[-0.125em] shrink-0 text-xl text-green-500 invisible" viewBox="0 0 24 24"><path d="M20 6 9 17l-5-5"></path></svg>
      <div class="grow min-w-0">
        <div class="text-cyan-500 text-xs font-bold uppercase truncate">${escapeHtml(job.number || '')}</div>
        <div class="flex gap-2">
          <div class="grow min-w-0 font-bold truncate">${escapeHtml(job.name || 'Unnamed Job')}</div>
          ${isClosed ? '<div class="shrink-0 text-gray-500">Closed</div>' : ''}
        </div>
      </div>
    </div>
    `;
  }).join('');

  if (append) {
    // Remove existing sentinel before appending
    const oldSentinel = jobListContainer.querySelector('.jt-scroll-sentinel');
    if (oldSentinel) oldSentinel.remove();
    jobListContainer.insertAdjacentHTML('beforeend', jobItemsHtml);
  } else {
    jobListContainer.innerHTML = jobItemsHtml;
  }

  // Attach click handlers to new items only
  const selector = append ? '[data-job-id]:not([data-click-bound])' : '[data-job-id]';
  jobListContainer.querySelectorAll(selector).forEach(item => {
    item.dataset.clickBound = 'true';
    item.addEventListener('click', () => {
      const jobId = item.dataset.jobId;
      const currentPath = window.location.pathname;
      const jobSectionMatch = currentPath.match(/^\/jobs\/[^\/]+\/(.+)$/);
      const newPath = jobSectionMatch
        ? `/jobs/${jobId}/${jobSectionMatch[1]}`
        : `/jobs/${jobId}`;
      window.history.pushState({}, '', newPath);
      window.dispatchEvent(new PopStateEvent('popstate', { state: {} }));
    });
  });

  // Add infinite scroll sentinel
  if (hasMoreJobs) {
    const sentinel = document.createElement('div');
    sentinel.className = 'jt-scroll-sentinel';
    sentinel.style.cssText = 'padding: 12px; text-align: center;';
    sentinel.innerHTML = '<div class="text-xs text-gray-400">Loading more...</div>';
    jobListContainer.appendChild(sentinel);

    // Disconnect previous observer
    if (scrollObserver) scrollObserver.disconnect();

    scrollObserver = new IntersectionObserver((entries) => {
      if (entries[0].isIntersecting && !isLoadingMore && hasMoreJobs) {
        loadMoreJobs();
      }
    }, { rootMargin: '200px' });

    scrollObserver.observe(sentinel);
  }

  // Update status count
  const statusDiv = document.getElementById('jt-cf-status');
  if (statusDiv && statusDiv.style.display !== 'none') {
    const currentText = statusDiv.textContent;
    if (!currentText.includes('Showing')) {
      statusDiv.textContent += ` (Showing ${allLoadedJobs.length})`;
    }
  }
}
```

**Step 3: Add loadMoreJobs function**

```javascript
async function loadMoreJobs() {
  if (isLoadingMore || !hasMoreJobs) return;
  isLoadingMore = true;
  currentPage++;

  try {
    let sortBy;
    switch (activeSortOrder) {
      case 'az':  sortBy = [{ field: 'name', order: 'asc' }]; break;
      case 'za':  sortBy = [{ field: 'name', order: 'desc' }]; break;
      default:    sortBy = [{ field: 'createdAt' }]; break;
    }

    const offset = currentPage * 50;
    const jobStatus = activeJobStatus || 'all';
    let jobs;

    if (filterFields.length > 0) {
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
      updateJobListDisplay(jobs, true);
    } else {
      hasMoreJobs = false;
      // Remove sentinel
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
```

**Step 4: Reset pagination on filter change**

In `applyFilter()`, before the API call, reset pagination state:

```javascript
// Reset pagination
currentPage = 0;
isLoadingMore = false;
hasMoreJobs = true;
allLoadedJobs = [];
if (scrollObserver) scrollObserver.disconnect();
```

**Step 5: Cleanup scroll observer**

In `cleanup()`, add:

```javascript
if (scrollObserver) {
  scrollObserver.disconnect();
  scrollObserver = null;
}
currentPage = 0;
isLoadingMore = false;
hasMoreJobs = true;
allLoadedJobs = [];
```

**Step 6: Commit**

```bash
git add JT-Tools-Master/features/custom-field-filter.js
git commit -m "feat: add infinite scroll pagination to Job Switcher filter results"
```

---

### Task 4: Update CHANGELOG for Job Switcher improvements

**Files:**
- Modify: `CHANGELOG.md`

**Step 1: Add entries under `## [Unreleased]`**

```markdown
### Added
#### Job Switcher Improvements
- Added alphabetical sorting (A→Z, Z→A) with persistent sort preference
- Added Location entity filter for filtering jobs by JobTread locations
- Added infinite scroll pagination for large job lists (loads 50 at a time)
```

**Step 2: Commit**

```bash
git add CHANGELOG.md
git commit -m "docs: update CHANGELOG for Job Switcher improvements"
```

---

## PART 2: BUDGET CHANGELOG — INTERACTIVE REPORT

### Task 5: Enhance Diff Engine to Track Unchanged Items and Group Data

**Files:**
- Modify: `JT-Tools-Master/features/budget-changelog-modules/diff-engine.js:11-58` (compare function)

**Step 1: Add unchanged items to diff output**

Update the `compare` function to also collect unchanged items:

```javascript
// After the modified items loop (~line 39), before the summary calculation:
// Find unchanged items
const unchanged = [];
for (const [key, newItem] of newMap.entries()) {
  if (oldMap.has(key) && !modified.find(m => m.uniqueKey === key) && !removed.find(r => r.uniqueKey === key)) {
    unchanged.push({ item: newItem, type: 'unchanged' });
  }
}
```

Update the return object to include unchanged:

```javascript
return {
  added,
  removed,
  modified,
  unchanged,
  summary,
  hasChanges: added.length > 0 || removed.length > 0 || modified.length > 0
};
```

**Step 2: Enhance summary with unchanged count**

In `calculateSummary`, ensure `unchangedCount` is properly calculated:

```javascript
// The summary object should include:
unchangedCount: oldItems.length - removedItems.length - modifiedItems.length
```

**Step 3: Add a method to get all unique cost groups from diff**

```javascript
function getUniqueCostGroups(diff) {
  const groups = new Set();
  const allItems = [
    ...diff.added.map(i => i.item || i),
    ...diff.removed.map(i => i.item || i),
    ...diff.modified.map(i => i.newItem || i),
    ...diff.unchanged.map(i => i.item || i)
  ];
  allItems.forEach(item => {
    if (item.hierarchy && item.hierarchy.length > 0) {
      groups.add(item.hierarchy[0]);
    }
  });
  return Array.from(groups).sort();
}
```

Add `getUniqueCostGroups` to the module's public API.

**Step 4: Commit**

```bash
git add JT-Tools-Master/features/budget-changelog-modules/diff-engine.js
git commit -m "feat: track unchanged items and add cost group extraction to diff engine"
```

---

### Task 6: Create Interactive Report App Module

**Files:**
- Create: `JT-Tools-Master/features/budget-changelog-modules/report-app.js`

This is the largest task. The report-app.js module generates a self-contained HTML page with embedded JavaScript that handles:
- Virtual scrolling for 1000+ items
- Toolbar with search, type filters, group filters, threshold filter, field visibility, view toggle
- Collapsible cost group sections
- Sortable columns
- Side-by-side view toggle
- Full description diff
- CSV export, clipboard copy, print

**Step 1: Create the report-app.js module scaffold**

```javascript
// Budget Changelog Interactive Report App
// Generates a self-contained HTML application for budget comparison reports
// Designed for 1000+ line items with virtual scrolling and full interactivity

const BudgetReportApp = (() => {

  /**
   * Generate the complete interactive report HTML
   * @param {Object} diff - Diff result from BudgetDiffEngine
   * @param {Object} options - { oldDate, newDate }
   * @returns {string} Complete HTML document
   */
  function generate(diff, options) {
    const jobName = getJobName();
    const data = serializeData(diff, options);

    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Budget Changelog - ${escapeHtml(jobName)}</title>
  <style>${getStyles()}</style>
</head>
<body>
  <div id="app"></div>
  <script>
    var __REPORT_DATA__ = ${data};
    ${getAppScript()}
  </script>
</body>
</html>`;
  }

  // ... (helper functions below)

  return { generate };
})();

window.BudgetReportApp = BudgetReportApp;
```

**Step 2: Implement serializeData**

This function flattens the diff into a JSON-safe format that the embedded script can consume:

```javascript
function serializeData(diff, options) {
  // Flatten all items into a single array with type tags
  const items = [];

  diff.added.forEach(a => {
    const item = a.item || a;
    items.push({ ...sanitizeItem(item), _type: 'added' });
  });

  diff.removed.forEach(r => {
    const item = r.item || r;
    items.push({ ...sanitizeItem(item), _type: 'removed' });
  });

  diff.modified.forEach(m => {
    items.push({
      _type: 'modified',
      old: sanitizeItem(m.oldItem),
      new: sanitizeItem(m.newItem),
      changes: m.changes
    });
  });

  (diff.unchanged || []).forEach(u => {
    const item = u.item || u;
    items.push({ ...sanitizeItem(item), _type: 'unchanged' });
  });

  return JSON.stringify({
    items,
    summary: diff.summary,
    options: {
      oldDate: options.oldDate || 'Older Backup',
      newDate: options.newDate || 'Newer Backup',
      jobName: getJobName() || 'Budget'
    }
  });
}

function sanitizeItem(item) {
  if (!item) return {};
  return {
    name: item.name || '',
    description: item.description || '',
    hierarchy: item.hierarchy || [],
    costGroup: item.costGroup || '',
    costCode: item.costCode || '',
    costType: item.costType || '',
    quantity: item.quantity,
    unit: item.unit || '',
    unitCost: item.unitCost,
    extendedCost: item.extendedCost,
    unitPrice: item.unitPrice,
    extendedPrice: item.extendedPrice,
    taxable: item.taxable,
    selected: item.selected,
    quantityFormula: item.quantityFormula || '',
    unitCostFormula: item.unitCostFormula || '',
    unitPriceFormula: item.unitPriceFormula || '',
    customFields: item.customFields || {},
    uniqueKey: item.uniqueKey || ''
  };
}
```

**Step 3: Implement getStyles**

Returns a CSS string for the report. This is a large block — key sections:

- Reset and base typography
- Sticky toolbar
- Summary dashboard cards
- Data table with striped rows and type coloring
- Collapsible group headers
- Side-by-side column layout
- Sort indicators
- Filter chips
- Print styles
- Responsive breakpoints

(Full CSS implementation — ~300 lines. See design doc for color scheme: green=added, red=removed, yellow=modified, grey=unchanged.)

**Step 4: Implement getAppScript**

Returns the embedded JavaScript as a string. This is the core interactive logic:

```javascript
function getAppScript() {
  return `
(function() {
  'use strict';

  var data = __REPORT_DATA__;
  var state = {
    searchQuery: '',
    activeTypes: ['added', 'removed', 'modified', 'unchanged'],
    activeGroups: [],  // empty = all
    threshold: 0,
    sortColumn: null,
    sortDirection: 'asc',
    collapsedGroups: {},
    viewMode: 'delta',  // 'delta' or 'sideBySide'
    visibleColumns: {
      description: true, quantity: true, unitCost: true, extendedCost: true,
      unitPrice: true, extendedPrice: true, costCode: false, costType: false,
      formulas: false, taxable: false, customFields: false, unit: true
    },
    expandedRows: {}
  };

  // Build indexes at startup
  var allItems = data.items;
  var costGroups = extractCostGroups(allItems);
  var filteredItems = allItems;

  // ─── Rendering ───
  function render() {
    filteredItems = applyFilters(allItems, state);
    var grouped = groupByHierarchy(filteredItems);

    var app = document.getElementById('app');
    app.innerHTML = '';
    app.appendChild(renderToolbar());
    app.appendChild(renderSummary(data.summary, filteredItems));
    app.appendChild(renderTable(grouped));
    app.appendChild(renderFooter());
  }

  // ... (toolbar, summary, table, virtual scroll, sort, filter, export functions)
  // Each function builds DOM elements programmatically (no innerHTML with user data)

  render();
})();
  `;
}
```

The embedded script contains these key subsystems (each is a function block):

1. **applyFilters(items, state)** — filters by search, type, group, threshold
2. **groupByHierarchy(items)** — organizes filtered items into collapsible groups
3. **renderToolbar()** — builds search box, filter chips, sort, view toggle, column visibility, export
4. **renderSummary(summary, filtered)** — clickable summary cards
5. **renderTable(grouped)** — group headers + item rows with virtual scroll
6. **renderGroupHeader(group)** — collapsible header with subtotals
7. **renderItemRow(item)** — delta or side-by-side view depending on state.viewMode
8. **renderDescriptionDiff(oldDesc, newDesc)** — word-level inline diff
9. **sortItems(items, column, direction)** — stable sort within groups
10. **exportCSV()** — generates and downloads CSV of visible items
11. **copyToClipboard()** — text summary
12. **printReport()** — expand all groups, trigger print, restore state

**Step 5: Register in manifest.json**

Add `report-app.js` to the content_scripts js array, before `budget-changelog.js`:

```json
"features/budget-changelog-modules/report-app.js",
```

**Step 6: Commit**

```bash
git add JT-Tools-Master/features/budget-changelog-modules/report-app.js JT-Tools-Master/manifest.json
git commit -m "feat: create interactive report app module for budget changelog"
```

---

### Task 7: Wire Report App into Budget Changelog UI

**Files:**
- Modify: `JT-Tools-Master/features/budget-changelog-modules/ui.js:372-390` (showDiffModal)
- Modify: `JT-Tools-Master/features/budget-changelog-modules/ui.js:398-637` (generateFullReportHTML)

**Step 1: Update showDiffModal to use BudgetReportApp**

Replace the `showDiffModal` function body to generate the interactive report instead of the static one:

```javascript
function showDiffModal(diff, options) {
  let html;

  // Use interactive report if available, fall back to static
  if (typeof BudgetReportApp !== 'undefined') {
    html = BudgetReportApp.generate(diff, options);
  } else {
    html = generateFullReportHTML(diff, options);
  }

  const blob = new Blob([html], { type: 'text/html' });
  const blobUrl = URL.createObjectURL(blob);

  const newWindow = window.open(blobUrl, '_blank');
  if (!newWindow) {
    showDiffModalFallback(diff, options);
  }
}
```

**Step 2: Keep generateFullReportHTML as fallback**

No changes needed to the existing static generator — it stays as a fallback.

**Step 3: Commit**

```bash
git add JT-Tools-Master/features/budget-changelog-modules/ui.js
git commit -m "feat: wire interactive report app into budget changelog UI"
```

---

### Task 8: Implement the Full Interactive Report Script

**Files:**
- Modify: `JT-Tools-Master/features/budget-changelog-modules/report-app.js`

This task fills in the complete `getAppScript()` and `getStyles()` implementations. Due to the size (~1500+ lines for the embedded script, ~300 lines for CSS), this will be implemented in focused sub-steps.

**Step 1: Implement getStyles() — complete CSS**

Full stylesheet covering: toolbar (sticky), summary dashboard, table, group headers, row types, sort arrows, filter chips, column visibility, side-by-side layout, description diff, print mode, responsive.

**Step 2: Implement core rendering — render(), renderToolbar(), renderSummary()**

- `render()` orchestrates full re-render
- `renderToolbar()` builds: search input, type chips (All/Added/Removed/Modified/Unchanged), cost group multi-select, threshold input, view toggle (Delta/Side-by-Side), column visibility dropdown, expand/collapse all buttons, export dropdown
- `renderSummary()` builds clickable stat cards

**Step 3: Implement table rendering — renderTable(), renderGroupHeader(), renderItemRow()**

- `renderTable()` iterates grouped data, renders headers + rows
- `renderGroupHeader()` builds collapsible header with group name, item count, subtotals, expand/collapse toggle
- `renderItemRow()` builds delta view or side-by-side view based on `state.viewMode`
- Virtual scrolling: use container with calculated height, only render visible rows in viewport + 20-row buffer, update on scroll

**Step 4: Implement description diff — renderDescriptionDiff()**

Word-level diff using a simple LCS (longest common subsequence) approach:
- Split old and new descriptions into words
- Find matching/added/removed words
- Wrap additions in `<span class="diff-add">`, removals in `<span class="diff-del">`

**Step 5: Implement filtering — applyFilters(), groupByHierarchy()**

- Filter by search query (name, description, cost code — case insensitive)
- Filter by type (added/removed/modified/unchanged)
- Filter by cost group
- Filter by threshold (absolute cost or price delta > N)
- Group results by hierarchy[0] (first cost group level)

**Step 6: Implement sorting — sortItems()**

- Sort within each group (not across groups)
- Sort by: name (alpha), quantity, unitCost, extendedCost, unitPrice, extendedPrice, costDelta, priceDelta
- Toggle direction on re-click
- Stable sort (preserve original order for equal values)

**Step 7: Implement exports — exportCSV(), copyToClipboard(), printReport()**

- `exportCSV()`: build CSV string from filtered items, create blob, trigger download
- `copyToClipboard()`: use existing text summary format from BudgetDiffEngine
- `printReport()`: expand all groups, hide toolbar, call `window.print()`, restore state

**Step 8: Commit**

```bash
git add JT-Tools-Master/features/budget-changelog-modules/report-app.js
git commit -m "feat: implement full interactive report with virtual scroll, sort, filter, exports"
```

---

### Task 9: Update CHANGELOG and Final Testing

**Files:**
- Modify: `CHANGELOG.md`

**Step 1: Add Budget Changelog entries**

```markdown
### Added
#### Budget Changelog Interactive Report
- Added interactive report with search, filtering, and sorting for budget comparisons
- Added collapsible cost group sections with group-level subtotals
- Added sortable columns (name, quantity, cost, price, deltas)
- Added side-by-side view toggle showing old vs new values
- Added word-level description diff highlighting for text changes
- Added threshold filter to show only changes above a dollar amount
- Added column visibility toggles (show/hide description, formulas, cost codes, etc.)
- Added CSV export of visible/filtered items
- Added virtual scrolling for smooth performance with 1000+ line items
- Added change type filter chips (Added/Removed/Modified/Unchanged)
- Added cost group filter dropdown
- Added "Jump to group" quick navigation
- Added Expand All / Collapse All controls
```

**Step 2: Commit**

```bash
git add CHANGELOG.md
git commit -m "docs: update CHANGELOG for Budget Changelog interactive report"
```

---

## Testing Checklist

### Job Switcher
- [ ] Sort dropdown appears and persists preference across sessions
- [ ] A→Z sort returns jobs alphabetically
- [ ] Location filter dropdown appears when org has locations
- [ ] Multi-select locations filters job list correctly
- [ ] Infinite scroll loads more jobs when scrolling near bottom
- [ ] Changing filters/sort resets scroll and re-fetches
- [ ] All filters (status + custom field + location + sort) compose correctly
- [ ] Keyboard shortcuts (J+S, ALT+J) still work
- [ ] Cleanup removes all observers and state

### Budget Changelog
- [ ] Compare button opens interactive report in new tab
- [ ] Summary cards display correct counts and deltas
- [ ] Clicking summary cards filters to that change type
- [ ] Search filters items by name/description/cost code
- [ ] Type chips toggle correctly (show/hide added/removed/modified/unchanged)
- [ ] Cost group filter works
- [ ] Threshold filter hides small changes
- [ ] Column visibility toggles work
- [ ] Sortable column headers work (click to sort, click again to reverse)
- [ ] Cost groups collapse/expand correctly
- [ ] Expand All / Collapse All buttons work
- [ ] Side-by-side view shows old vs new columns
- [ ] Description diffs show word-level highlighting
- [ ] CSV export downloads correct data
- [ ] Copy to clipboard works
- [ ] Print produces clean output
- [ ] Virtual scrolling handles 1000+ items smoothly
- [ ] Falls back to static report if report-app.js fails to load
