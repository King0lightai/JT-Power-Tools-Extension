/**
 * JT Power Tools - Task Type Filter Feature
 * Injects a "TASKS" row into the Schedule Availability table showing unassigned tasks
 * from the JT API, with a filter bar to filter by task type (Labor, Material, etc.)
 *
 * What this builds (injected into the existing schedule table):
 *   [Header: "As of: date" | "2-Mar Monday" | "3-Mar Tuesday" ...]
 *   [TASKS row: "TASKS" label + filter chips | task cards per day column] ← WE BUILD THIS
 *   [Assignee rows: Warren, Tommy, Ben, Ethan, Jose...] ← already in JobTread
 *
 * API calls (via Pro Worker → Pave):
 *   1. getTaskTypes → organization.taskTypes.nodes { id, name }
 *   2. getUnassignedTasks → organization.tasks (by date range) with taskType, job info
 *
 * @module TaskTypeFilterFeature
 * @version 2.1.0
 * @requires JobTreadProService, TimingUtils, Sanitizer
 */

const TaskTypeFilterFeature = (() => {
  let isActiveState = false;
  let observer = null;
  let urlCheckInterval = null;
  let styleElement = null;
  let debouncedScanAndBuild = null;

  // Storage keys
  const STORAGE_KEY = 'jtTaskTypeFilterSelections';
  const CACHE_KEY = 'jtTaskTypeFilterCache';
  const CACHE_DURATION = 2 * 60 * 1000; // 2 minutes

  // State
  let taskTypes = [];            // Array of { id, name } from API
  let selectedTypes = {};        // { typeId: true/false }
  let tasksByType = {};          // { typeId: [...tasks] }
  let unassignedTasks = [];      // Filtered to unassigned only
  let isLoading = false;
  let lastError = null;
  let _isCollapsed = true;

  // Injected DOM elements
  let tasksRow = null;           // The <tr> we inject
  let filterBarDiv = null;       // The filter bar <div> above the table

  // Date range + column mapping
  let visibleDates = [];         // Array of 'YYYY-MM-DD' strings matching table columns
  let colCount = 0;
  let lastFetchedDateRange = ''; // Track last fetched range to detect week changes

  // ─── VIEW DETECTION ───────────────────────────────────────

  function isAvailabilityView() {
    if (!window.location.pathname.includes('/schedule')) return false;

    const availabilityBtn = document.querySelector('button[class*="flex"][class*="items-center"]');
    if (availabilityBtn && availabilityBtn.textContent.includes('Availability')) return true;

    const assigneeSidebar = document.querySelector('div.text-xs.uppercase.truncate.p-1.border-b.font-bold.text-jtOrange');
    if (assigneeSidebar) return true;

    return false;
  }

  /**
   * Check if we're on a job-level schedule (e.g. /jobs/{id}/schedule)
   * vs. the global org schedule (/schedule).
   * On job-level, task cards from other jobs can't be opened in the sidebar.
   */
  function isJobLevelSchedule() {
    return /\/jobs\/[^/]+\/schedule/.test(window.location.pathname);
  }

  /**
   * A "navigation key" for the current URL with the transient `taskId` param
   * removed. Opening/closing a task sidebar only toggles ?taskId=, which is
   * NOT a real navigation — using this key for change-detection keeps the
   * feature from reloading every time a task sidebar opens.
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

  // ─── TABLE DETECTION ─────────────────────────────────────

  /**
   * Find the availability table (not the main calendar table).
   * In job-level month view, there are two tables — the month calendar first,
   * then the availability table. We want the availability table.
   */
  function findAvailabilityTable() {
    const tables = document.querySelectorAll('table');
    if (tables.length === 0) return null;
    if (tables.length === 1) return tables[0];

    // Multiple tables — find the one in the availability section.
    // The availability table is near the assignee sidebar (text-jtOrange labels)
    // or near the "AVAILABILITY" heading. Use the last table as a reliable fallback
    // since availability always renders after the main calendar.
    for (const t of tables) {
      const parent = t.parentElement;
      if (!parent) continue;
      // Check if this table's container has assignee-style elements nearby
      if (parent.querySelector('.text-jtOrange, [class*="text-jtOrange"]')) {
        return t;
      }
    }

    // Fallback: last table (availability comes after main calendar)
    return tables[tables.length - 1];
  }

  // ─── DATE PARSING ─────────────────────────────────────────

  /**
   * Parse visible dates from the schedule table header.
   * Returns an array of date strings (YYYY-MM-DD) matching each column after the first (label) column.
   *
   * Header structure:
   *   Row 1: [empty th] [day-of-week abbrevs: SUN, MON, TUE...]
   *   Row 2: [empty th] [date numbers: 2, 3, 4...]
   *
   * We also extract the date from "2-Mar" style headers (e.g. "2-Mar\nMonday")
   */
  function parseVisibleDates() {
    const table = findAvailabilityTable();
    if (!table) return [];

    const thead = table.querySelector('thead');
    if (!thead) return [];

    const headerRows = thead.querySelectorAll('tr');

    // Try to get dates from the first header row which may have "2-Mar\nMonday" format
    const firstRow = headerRows[0];
    if (!firstRow) return [];

    const thCells = firstRow.querySelectorAll('th');
    const dates = [];
    const dateContext = findDateContext();
    const year = dateContext.year || new Date().getFullYear();

    // Month abbreviation map
    const monthAbbrevs = {
      'jan': 0, 'feb': 1, 'mar': 2, 'apr': 3, 'may': 4, 'jun': 5,
      'jul': 6, 'aug': 7, 'sep': 8, 'oct': 9, 'nov': 10, 'dec': 11
    };

    // Try parsing "2-Mar" format from first header row
    thCells.forEach((th, index) => {
      if (index === 0) return; // Skip label column
      const text = th.textContent.trim();

      // Match "2-Mar", "15-Jan", etc.
      const match = text.match(/(\d{1,2})-([A-Za-z]{3})/);
      if (match) {
        const day = parseInt(match[1], 10);
        const monthStr = match[2].toLowerCase();
        const month = monthAbbrevs[monthStr];
        if (month !== undefined) {
          dates.push(formatDate(new Date(year, month, day)));
          return;
        }
      }

      // Fallback: just a number (date) — need month from context
      const num = parseInt(text, 10);
      if (!isNaN(num) && num >= 1 && num <= 31 && dateContext.month !== null) {
        dates.push(formatDate(new Date(year, dateContext.month, num)));
      }
    });

    // If first row didn't work, try second row (pure date numbers)
    if (dates.length === 0 && headerRows.length >= 2) {
      const secondRow = headerRows[1];
      const cells = secondRow.querySelectorAll('th');
      const month = dateContext.month !== null ? dateContext.month : new Date().getMonth();

      cells.forEach((cell, index) => {
        if (index === 0) return;
        const text = cell.textContent.trim();
        const num = parseInt(text, 10);
        if (!isNaN(num) && num >= 1 && num <= 31) {
          dates.push(formatDate(new Date(year, month, num)));
        }
      });
    }

    return dates;
  }

  function findDateContext() {
    const months = [
      'january', 'february', 'march', 'april', 'may', 'june',
      'july', 'august', 'september', 'october', 'november', 'december'
    ];

    const candidates = document.querySelectorAll('h1, h2, h3, button, span.font-bold, div.font-bold');
    for (const el of candidates) {
      const text = el.textContent.toLowerCase().trim();
      for (let i = 0; i < months.length; i++) {
        if (text.includes(months[i])) {
          const yearMatch = text.match(/\b(20\d{2})\b/);
          return {
            month: i,
            year: yearMatch ? parseInt(yearMatch[1], 10) : new Date().getFullYear()
          };
        }
      }
    }
    return { month: null, year: null };
  }

  function formatDate(date) {
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, '0');
    const d = String(date.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  }

  // ─── API CALLS (Pro Worker with direct Pave fallback) ───────

  async function fetchTaskTypes() {
    // Try Pro Worker first (single-org / legacy)
    if (typeof JobTreadProService !== 'undefined') {
      const configured = await JobTreadProService.isConfigured();
      if (configured) {
        return await JobTreadProService.getTaskTypes();
      }
    }

    // Fallback: direct Pave query via JobTreadAPI (multi-org aware)
    // Uses currentGrant → user → memberships → organization to find org,
    // then queries organization.taskTypes
    if (typeof JobTreadAPI !== 'undefined' && await JobTreadAPI.isConfigured()) {
      // First discover the org ID from the grant key
      const orgResult = await JobTreadAPI.paveQuery({
        currentGrant: {
          user: {
            memberships: {
              nodes: {
                organization: { id: {} }
              }
            }
          }
        }
      });
      const orgId = orgResult?.currentGrant?.user?.memberships?.nodes?.[0]?.organization?.id;
      if (!orgId) throw new Error('Could not determine organization from grant key');

      // Now query task types via the organization
      let allTaskTypes = [];
      let page = undefined;
      do {
        const params = { size: 100 };
        if (page) params.page = page;
        const result = await JobTreadAPI.paveQuery({
          organization: {
            $: { id: orgId },
            taskTypes: {
              $: params,
              nextPage: {},
              nodes: { id: {}, name: {} }
            }
          }
        });
        const nodes = result?.organization?.taskTypes?.nodes || [];
        allTaskTypes = allTaskTypes.concat(nodes);
        page = result?.organization?.taskTypes?.nextPage || null;
      } while (page);
      return allTaskTypes;
    }

    throw new Error('No API configured. Please connect your Grant Key.');
  }

  /**
   * Fetch tasks for a date range.
   * Returns ALL tasks — we filter to unassigned client-side
   * (Pave doesn't support filtering by empty assignedMemberships)
   */
  async function fetchTasksForDateRange(startDate, endDate) {
    // Try Pro Worker first (single-org / legacy)
    if (typeof JobTreadProService !== 'undefined') {
      const configured = await JobTreadProService.isConfigured();
      if (configured) {
        return await JobTreadProService.getUnassignedTasks(startDate, endDate);
      }
    }

    // Fallback: direct Pave query via JobTreadAPI (multi-org aware)
    if (typeof JobTreadAPI !== 'undefined' && await JobTreadAPI.isConfigured()) {
      // Discover org ID from grant key
      const orgResult = await JobTreadAPI.paveQuery({
        currentGrant: {
          user: {
            memberships: {
              nodes: {
                organization: { id: {} }
              }
            }
          }
        }
      });
      const orgId = orgResult?.currentGrant?.user?.memberships?.nodes?.[0]?.organization?.id;
      if (!orgId) throw new Error('Could not determine organization from grant key');

      // Fetch tasks via organization (paginated, size 50 to avoid 413)
      let allTasks = [];
      let page = undefined;
      let pageCount = 0;
      const MAX_PAGES = 10;

      do {
        const params = {
          size: 50,
          where: {
            and: [
              ['isToDo', '=', false],
              ['startDate', '>=', startDate],
              ['startDate', '<=', endDate],
              [['parentTask', 'id'], '!=', null]
            ]
          }
        };
        if (page) params.page = page;

        const result = await JobTreadAPI.paveQuery({
          organization: {
            $: { id: orgId },
            tasks: {
              $: params,
              nextPage: {},
              nodes: {
                id: {},
                name: {},
                startDate: {},
                endDate: {},
                startTime: {},
                endTime: {},
                completed: {},
                isToDo: {},
                taskType: { id: {}, name: {} },
                assignedMemberships: {
                  nodes: { id: {} }
                },
                job: { id: {}, name: {}, number: {} }
              }
            }
          }
        });
        const nodes = result?.organization?.tasks?.nodes || [];
        allTasks = allTasks.concat(nodes);
        page = result?.organization?.tasks?.nextPage || null;
        pageCount++;
      } while (page && pageCount < MAX_PAGES);

      return allTasks;
    }

    throw new Error('No API configured. Please connect your Grant Key.');
  }

  // ─── DATA MANAGEMENT ───────────────────────────────────────

  async function loadData() {
    if (isLoading) return;
    isLoading = true;
    lastError = null;
    renderInjectedRows(); // Show loading state

    try {
      // Parse dates from table header
      visibleDates = parseVisibleDates();
      if (visibleDates.length === 0) {
        throw new Error('Could not determine visible date range');
      }

      const startDate = visibleDates[0];
      const endDate = visibleDates[visibleDates.length - 1];

      // Track the fetched date range so scanAndBuild can detect week changes
      lastFetchedDateRange = `${startDate}:${endDate}`;

      // Check cache
      const cached = await getCachedData();
      let allTasks;
      if (cached && cached.startDate === startDate && cached.endDate === endDate) {
        taskTypes = cached.taskTypes;
        allTasks = cached.tasks;
        console.log('TaskTypeFilter: Using cached data');
      } else {
        const [types, tasks] = await Promise.all([
          fetchTaskTypes(),
          fetchTasksForDateRange(startDate, endDate)
        ]);
        taskTypes = types;
        allTasks = tasks;

        await setCachedData({
          startDate, endDate, taskTypes: types, tasks, timestamp: Date.now()
        });
        console.log(`TaskTypeFilter: Loaded ${types.length} task types, ${tasks.length} tasks`);
      }

      // Filter to unassigned, non-group tasks only
      // Groups/phases have no assignees AND no taskType — exclude them
      unassignedTasks = allTasks.filter(task => {
        const assignees = task.assignedMemberships?.nodes || [];
        if (assignees.length > 0) return false; // Has assignees — not unassigned
        // Exclude task groups: no taskType means it's a phase/group header
        if (!task.taskType) return false;
        return true;
      });

      console.log(`TaskTypeFilter: ${unassignedTasks.length} unassigned tasks out of ${allTasks.length} total`);

      // Index by type
      tasksByType = {};
      taskTypes.forEach(t => { tasksByType[t.id] = []; });
      tasksByType['_untyped'] = [];

      unassignedTasks.forEach(task => {
        const typeId = task.taskType ? task.taskType.id : '_untyped';
        if (!tasksByType[typeId]) tasksByType[typeId] = [];
        tasksByType[typeId].push(task);
      });

      // Load saved type selections
      await loadSelections();
      taskTypes.forEach(t => {
        if (selectedTypes[t.id] === undefined) selectedTypes[t.id] = true;
      });
      if (tasksByType['_untyped'].length > 0 && selectedTypes['_untyped'] === undefined) {
        selectedTypes['_untyped'] = true;
      }

    } catch (error) {
      console.error('TaskTypeFilter: Error loading data:', error);
      lastError = error.message;
    } finally {
      isLoading = false;
      renderInjectedRows();
    }
  }

  async function getCachedData() {
    try {
      const result = await chrome.storage.local.get([CACHE_KEY]);
      const cached = result[CACHE_KEY];
      if (cached && (Date.now() - cached.timestamp) < CACHE_DURATION) return cached;
      return null;
    } catch (e) { return null; }
  }

  async function setCachedData(data) {
    try { await chrome.storage.local.set({ [CACHE_KEY]: data }); }
    catch (e) { console.error('TaskTypeFilter: Cache write error:', e); }
  }

  async function loadSelections() {
    try {
      const result = await chrome.storage.sync.get([STORAGE_KEY]);
      if (result[STORAGE_KEY]) selectedTypes = result[STORAGE_KEY];
    } catch (e) { /* ignore */ }
  }

  async function saveSelections() {
    try { await chrome.storage.sync.set({ [STORAGE_KEY]: selectedTypes }); }
    catch (e) { /* ignore */ }
  }

  // ─── TASK CARD COLOR ───────────────────────────────────────

  // Assign consistent colors to task types for visual distinction
  const TYPE_COLORS = [
    '#FDE68A', '#BFDBFE', '#BBF7D0', '#FECACA', '#DDD6FE',
    '#FED7AA', '#A5F3FC', '#FBCFE8', '#D9F99D', '#E9D5FF'
  ];

  function getTypeColor(typeId) {
    if (typeId === '_untyped') return '#E5E7EB';
    const idx = taskTypes.findIndex(t => t.id === typeId);
    return TYPE_COLORS[idx % TYPE_COLORS.length] || '#FDE68A';
  }

  // ─── DOM INJECTION ─────────────────────────────────────────

  /**
   * Get the column count and tbody reference from the schedule table
   */
  function getTableInfo() {
    const table = findAvailabilityTable();
    if (!table) return null;

    const thead = table.querySelector('thead');
    const tbody = table.querySelector('tbody');
    if (!thead || !tbody) return null;

    const firstHeaderRow = thead.querySelector('tr');
    const cols = firstHeaderRow ? firstHeaderRow.querySelectorAll('th').length : 0;

    return { table, thead, tbody, colCount: cols };
  }

  /**
   * Find the first row in tbody — we insert our rows BEFORE it
   * (above all assignee rows like INTERNAL, Warren, etc.)
   */
  function getFirstBodyRow() {
    const info = getTableInfo();
    if (!info) return null;
    return info.tbody.querySelector('tr');
  }

  /**
   * Build and render the filter bar (above the table) and TASKS row (inside tbody)
   */
  function renderInjectedRows() {
    const info = getTableInfo();
    if (!info) return;

    colCount = info.colCount;
    const { table, tbody } = info;

    // Remove old elements if they exist
    removeInjectedRows();

    // === FILTER BAR DIV (above table) ===
    filterBarDiv = document.createElement('div');
    filterBarDiv.id = 'jt-ttf-filter-bar-container';
    filterBarDiv.innerHTML = buildFilterBarHTML();
    table.parentNode.insertBefore(filterBarDiv, table);

    // === TASKS ROW (inside tbody) ===
    tasksRow = document.createElement('tr');
    tasksRow.id = 'jt-ttf-tasks-row';
    tasksRow.className = 'jt-ttf-injected-row';

    // First cell: "TASKS" label
    const labelTd = document.createElement('td');
    labelTd.className = 'jt-ttf-label-cell border-r';
    labelTd.innerHTML = `
      <div>
        <div class="jt-ttf-tasks-label">TASKS</div>
        <div class="jt-ttf-task-count">${unassignedTasks.length} unassigned</div>
      </div>
    `;
    tasksRow.appendChild(labelTd);

    // Day columns — one <td> per visible date
    if (isLoading) {
      const loadingTd = document.createElement('td');
      loadingTd.setAttribute('colspan', colCount - 1);
      loadingTd.className = 'jt-ttf-day-cell';
      loadingTd.innerHTML = '<div class="jt-ttf-loading-msg">Loading unassigned tasks...</div>';
      tasksRow.appendChild(loadingTd);
    } else if (lastError) {
      const errorTd = document.createElement('td');
      errorTd.setAttribute('colspan', colCount - 1);
      errorTd.className = 'jt-ttf-day-cell';
      errorTd.innerHTML = `<div class="jt-ttf-error-msg">${Sanitizer.escapeHTML(lastError)}</div>`;
      tasksRow.appendChild(errorTd);
    } else {
      // Get filtered tasks (by selected types)
      const filteredTasks = getFilteredTasks();

      // Group tasks by startDate
      const tasksByDate = {};
      filteredTasks.forEach(task => {
        const date = task.startDate;
        if (!tasksByDate[date]) tasksByDate[date] = [];
        tasksByDate[date].push(task);
      });

      // Build one <td> per column date
      for (let i = 0; i < visibleDates.length; i++) {
        const date = visibleDates[i];
        const td = document.createElement('td');
        td.className = 'jt-ttf-day-cell border-r';

        const dayTasks = tasksByDate[date] || [];
        if (dayTasks.length > 0) {
          dayTasks.forEach(task => {
            td.appendChild(buildTaskCard(task));
          });

          // "+ Add" link at the bottom, like native JT
          const addLink = document.createElement('div');
          addLink.className = 'jt-ttf-add-link';
          addLink.textContent = `+ ${dayTasks.length} task${dayTasks.length !== 1 ? 's' : ''}`;
          td.appendChild(addLink);
        }

        tasksRow.appendChild(td);
      }

      // If colCount > visibleDates + 1 (label col), fill remaining columns
      const remaining = colCount - 1 - visibleDates.length;
      for (let i = 0; i < remaining; i++) {
        const emptyTd = document.createElement('td');
        emptyTd.className = 'jt-ttf-day-cell border-r';
        tasksRow.appendChild(emptyTd);
      }
    }

    // Insert TASKS row as the first row in tbody
    const firstRow = tbody.querySelector('tr');
    if (firstRow) {
      tbody.insertBefore(tasksRow, firstRow);
    } else {
      tbody.appendChild(tasksRow);
    }

    // Attach filter event listeners
    attachFilterListeners(filterBarDiv);

    console.log('TaskTypeFilter: Injected filter bar above table and TASKS row');
  }

  /**
   * Build a single task card element
   */
  function buildTaskCard(task) {
    const typeId = task.taskType ? task.taskType.id : '_untyped';
    const bgColor = getTypeColor(typeId);
    const typeName = task.taskType ? task.taskType.name : '';
    const jobName = task.job ? (task.job.name || '') : '';
    const jobNumber = task.job ? (task.job.number || '') : '';
    const jobLabel = jobNumber ? `${jobName} ${jobNumber}` : jobName;

    // Click-to-open is DISABLED for now. JobTread opens a task sidebar from
    // ?taskId only on page load (not reactively on client-side history nav),
    // and there's no native unassigned-task element to click — so every
    // approach we tried either failed to open the sidebar or forced a full
    // page reload. Until JT supports it, the card is a passive, informative
    // chip: it shows the unassigned task + job on hover but does nothing on
    // click. (openTaskSidebar is retained below for when we revisit this.)
    const card = document.createElement('div');
    card.className = 'jt-ttf-task-card jt-ttf-readonly';
    card.style.backgroundColor = bgColor;
    card.setAttribute('data-task-id', task.id);
    card.setAttribute('title', `${task.name}\n${jobLabel}${typeName ? '\nType: ' + typeName : ''}`);

    card.innerHTML = `
      <div class="jt-ttf-task-name">${Sanitizer.escapeHTML(task.name)}</div>
      <div class="jt-ttf-task-job">${Sanitizer.escapeHTML(jobLabel)}</div>
    `;

    return card;
  }

  /**
   * Show a brief toast message telling the user to use the global schedule
   */
  let _toastTimeout = null;
  function showJobLevelMessage() {
    // Remove existing toast if any
    const existing = document.getElementById('jt-ttf-toast');
    if (existing) existing.remove();
    if (_toastTimeout) clearTimeout(_toastTimeout);

    const toast = document.createElement('div');
    toast.id = 'jt-ttf-toast';
    toast.className = 'jt-ttf-toast';
    toast.textContent = 'Go to the global Schedule → Availability to interact with unassigned tasks';
    document.body.appendChild(toast);

    // Fade in
    requestAnimationFrame(() => toast.classList.add('visible'));

    // Auto-dismiss after 3 seconds
    _toastTimeout = setTimeout(() => {
      toast.classList.remove('visible');
      setTimeout(() => toast.remove(), 300);
    }, 3000);
  }

  /**
   * Open the task sidebar by adding ?taskId=<id> to the current URL. JT's SPA
   * router picks up the taskId param and opens the sidebar.
   *
   * CRITICAL: preserve the OTHER query params — notably ?view=<savedViewId>.
   * The availability saved-view URL looks like
   *   /schedule?view=22PGZ2Aw3fAH&taskId=22PYYaA6UvM3
   * The old code rebuilt the URL as `${path}?taskId=${id}`, which wiped the
   * `view` param. JT then navigated away from the saved view (the flicker) and
   * the sidebar never opened. We now mutate only the taskId param via
   * URLSearchParams so the view (and anything else) survives.
   *
   * Staying on the same path means the schedule grid never unmounts — no flash.
   * If a sidebar is already open for a different task, we clear taskId first
   * (keeping other params) so React detects the change.
   */
  function openTaskSidebar(taskId) {
    if (!taskId) return;

    // Build the target URL preserving existing params (notably ?view=).
    const params = new URLSearchParams(window.location.search);
    params.set('taskId', taskId);
    const targetUrl = `${window.location.pathname}?${params.toString()}`;

    // Mirror the Job Switcher's instant client-side navigation EXACTLY — it
    // updates the page with no refresh by doing a synchronous pushState with
    // an empty-object state, then dispatching a popstate that also carries
    // `{ state: {} }`. (Earlier attempts here used requestAnimationFrame + a
    // null state + a clear-first step, or a synthetic anchor click — none of
    // which JT's router picked up, so the sidebar only opened on refresh / the
    // anchor triggered a full reload.)
    window.history.pushState({}, '', targetUrl);
    window.dispatchEvent(new PopStateEvent('popstate', { state: {} }));
  }

  /**
   * Get tasks filtered by the currently selected types
   */
  function getFilteredTasks() {
    return unassignedTasks.filter(task => {
      const typeId = task.taskType ? task.taskType.id : '_untyped';
      return selectedTypes[typeId] !== false;
    });
  }

  /**
   * Remove our injected rows from the DOM
   */
  function removeInjectedRows() {
    const existing1 = document.getElementById('jt-ttf-filter-bar-container');
    const existing2 = document.getElementById('jt-ttf-tasks-row');
    if (existing1) existing1.remove();
    if (existing2) existing2.remove();
    filterBarDiv = null;
    tasksRow = null;
  }

  // ─── FILTER BAR ────────────────────────────────────────────

  function buildFilterBarHTML() {
    let chipsHtml = '';
    if (taskTypes.length > 0) {
      taskTypes.forEach((type, idx) => {
        const isActive = selectedTypes[type.id] !== false;
        const count = (tasksByType[type.id] || []).length;
        const color = TYPE_COLORS[idx % TYPE_COLORS.length];
        chipsHtml += `
          <button class="jt-ttf-chip ${isActive ? 'active' : ''}"
                  data-type-id="${Sanitizer.escapeHTML(type.id)}"
                  style="--chip-color: ${color}"
                  title="${Sanitizer.escapeHTML(type.name)}: ${count} task${count !== 1 ? 's' : ''}">
            <span class="jt-ttf-chip-dot" style="background: ${color}"></span>
            <span class="jt-ttf-chip-label">${Sanitizer.escapeHTML(type.name)}</span>
            <span class="jt-ttf-chip-count">${count}</span>
          </button>`;
      });

      const untypedCount = (tasksByType['_untyped'] || []).length;
      if (untypedCount > 0) {
        const isActive = selectedTypes['_untyped'] !== false;
        chipsHtml += `
          <button class="jt-ttf-chip untyped ${isActive ? 'active' : ''}"
                  data-type-id="_untyped"
                  title="No Type: ${untypedCount} task${untypedCount !== 1 ? 's' : ''}">
            <span class="jt-ttf-chip-dot" style="background: #E5E7EB"></span>
            <span class="jt-ttf-chip-label">No Type</span>
            <span class="jt-ttf-chip-count">${untypedCount}</span>
          </button>`;
      }
    }

    const activeCount = Object.values(selectedTypes).filter(v => v !== false).length;
    const totalTypes = taskTypes.length + ((tasksByType['_untyped'] || []).length > 0 ? 1 : 0);

    return `
      <div class="jt-ttf-filter-bar ${_isCollapsed ? 'collapsed' : ''}">
        <div class="jt-ttf-bar-header">
          <span class="jt-ttf-bar-title">Filter by Type</span>
          <span class="jt-ttf-badge">${activeCount}/${totalTypes}</span>
          <div class="jt-ttf-actions">
            <button class="jt-ttf-action" data-action="all" title="Show all">All</button>
            <button class="jt-ttf-action" data-action="none" title="Hide all">None</button>
            <button class="jt-ttf-action" data-action="refresh" title="Refresh">↻</button>
          </div>
          <button class="jt-ttf-toggle" title="Collapse">▾</button>
        </div>
        <div class="jt-ttf-chips-wrap">
          ${chipsHtml || '<span class="jt-ttf-empty">No task types found</span>'}
        </div>
        ${lastError ? `<div class="jt-ttf-error-inline">${Sanitizer.escapeHTML(lastError)}</div>` : ''}
        ${isLoading ? '<div class="jt-ttf-loading-inline">Loading...</div>' : ''}
      </div>
    `;
  }

  function attachFilterListeners(row) {
    if (!row) return;

    // Toggle collapse
    const toggleBtn = row.querySelector('.jt-ttf-toggle');
    if (toggleBtn) {
      toggleBtn.addEventListener('click', () => {
        const bar = row.querySelector('.jt-ttf-filter-bar');
        if (bar) {
          bar.classList.toggle('collapsed');
          _isCollapsed = bar.classList.contains('collapsed');
        }
      });
    }

    // Header click collapse
    const header = row.querySelector('.jt-ttf-bar-header');
    if (header) {
      header.addEventListener('click', (e) => {
        if (e.target.closest('.jt-ttf-action') || e.target.closest('.jt-ttf-toggle')) return;
        const bar = row.querySelector('.jt-ttf-filter-bar');
        if (bar) {
          bar.classList.toggle('collapsed');
          _isCollapsed = bar.classList.contains('collapsed');
        }
      });
    }

    // Chip toggles
    row.querySelectorAll('.jt-ttf-chip').forEach(chip => {
      chip.addEventListener('click', (e) => {
        e.stopPropagation();
        const typeId = chip.getAttribute('data-type-id');
        selectedTypes[typeId] = !chip.classList.contains('active');
        chip.classList.toggle('active');
        updateBadge(row);
        saveSelections();
        renderInjectedRows(); // Re-render task cards with new filter
      });
    });

    // All / None / Refresh
    row.querySelectorAll('.jt-ttf-action').forEach(btn => {
      btn.addEventListener('click', async (e) => {
        e.stopPropagation();
        const action = btn.getAttribute('data-action');
        if (action === 'all') {
          Object.keys(selectedTypes).forEach(k => { selectedTypes[k] = true; });
          saveSelections();
          renderInjectedRows();
        } else if (action === 'none') {
          Object.keys(selectedTypes).forEach(k => { selectedTypes[k] = false; });
          saveSelections();
          renderInjectedRows();
        } else if (action === 'refresh') {
          try { await chrome.storage.local.remove([CACHE_KEY]); } catch (e) { /* */ }
          loadData();
        }
      });
    });
  }

  function updateBadge(row) {
    if (!row) return;
    const badge = row.querySelector('.jt-ttf-badge');
    if (!badge) return;
    const activeCount = Object.values(selectedTypes).filter(v => v !== false).length;
    const totalTypes = taskTypes.length + ((tasksByType['_untyped'] || []).length > 0 ? 1 : 0);
    badge.textContent = `${activeCount}/${totalTypes}`;
  }

  // ─── STYLES ─────────────────────────────────────────────────

  function injectStyles() {
    if (styleElement) return;
    styleElement = document.createElement('link');
    styleElement.rel = 'stylesheet';
    styleElement.href = chrome.runtime.getURL('styles/task-type-filter.css');
    styleElement.id = 'jt-task-type-filter-styles';
    document.head.appendChild(styleElement);
  }

  function removeStyles() {
    if (styleElement) { styleElement.remove(); styleElement = null; }
  }

  // ─── LIFECYCLE ──────────────────────────────────────────────

  function scanAndBuild() {
    if (!isActiveState) return;

    if (!isAvailabilityView()) {
      removeInjectedRows();
      return;
    }

    // Check if the visible date range changed (user switched weeks)
    const currentDates = parseVisibleDates();
    const currentDateRange = currentDates.length > 0
      ? `${currentDates[0]}:${currentDates[currentDates.length - 1]}`
      : '';

    if (currentDateRange && currentDateRange !== lastFetchedDateRange) {
      // Dates changed — force fresh load
      console.log('TaskTypeFilter: Date range changed, refreshing data...');
      removeInjectedRows();
      unassignedTasks = [];
      tasksByType = {};
      // Keep taskTypes (they don't change per week) but reload tasks
      loadData();
      return;
    }

    // Check if our elements are still in the DOM (JT may have re-rendered the table)
    const existingTasksRow = document.getElementById('jt-ttf-tasks-row');
    const existingFilterBar = document.getElementById('jt-ttf-filter-bar-container');
    if (existingTasksRow && existingFilterBar) return; // Already injected and present

    // If we have data, just re-render; otherwise load fresh
    if (unassignedTasks.length > 0 || taskTypes.length > 0) {
      renderInjectedRows();
    } else {
      loadData();
    }
  }

  async function init() {
    if (isActiveState) {
      console.log('TaskTypeFilter: Already active');
      return;
    }

    isActiveState = true;
    console.log('TaskTypeFilter: Initializing...');

    injectStyles();

    if (typeof TimingUtils !== 'undefined' && TimingUtils.debounce) {
      debouncedScanAndBuild = TimingUtils.debounce(scanAndBuild, 300);
    } else {
      let debounceTimer = null;
      debouncedScanAndBuild = () => {
        clearTimeout(debounceTimer);
        debounceTimer = setTimeout(scanAndBuild, 300);
      };
    }

    scanAndBuild();

    observer = new MutationObserver(() => {
      if (!isActiveState) return;
      debouncedScanAndBuild();
    });

    observer.observe(document.body, {
      childList: true,
      subtree: true,
      attributes: false
    });

    // Compare URLs IGNORING the taskId param — opening/closing a task sidebar
    // adds/removes ?taskId=, and we must NOT treat that as a navigation
    // (otherwise opening any task wipes our state and re-fetches, which the
    // user sees as a jarring reload). Path / ?view= / date changes still count.
    let lastNavKey = navKeyIgnoringTask(window.location.href);
    urlCheckInterval = setInterval(() => {
      const key = navKeyIgnoringTask(window.location.href);
      if (key !== lastNavKey) {
        lastNavKey = key;
        removeInjectedRows();
        unassignedTasks = [];
        tasksByType = {};
        taskTypes = [];
        lastFetchedDateRange = '';
        scanAndBuild();
      }
    }, 1000);

    console.log('TaskTypeFilter: Initialized');
  }

  function cleanup() {
    if (!isActiveState) return;
    isActiveState = false;
    console.log('TaskTypeFilter: Cleaning up...');

    if (observer) { observer.disconnect(); observer = null; }
    if (urlCheckInterval) { clearInterval(urlCheckInterval); urlCheckInterval = null; }

    removeInjectedRows();
    removeStyles();

    taskTypes = [];
    unassignedTasks = [];
    tasksByType = {};
    lastFetchedDateRange = '';
    selectedTypes = {};
    lastError = null;

    console.log('TaskTypeFilter: Cleaned up');
  }

  return {
    init,
    cleanup,
    isActive: () => isActiveState,
    refresh: () => {
      removeInjectedRows();
      unassignedTasks = [];
      tasksByType = {};
      chrome.storage.local.remove([CACHE_KEY]).catch(() => {});
      scanAndBuild();
    }
  };
})();

if (typeof window !== 'undefined') {
  window.TaskTypeFilterFeature = TaskTypeFilterFeature;
}
