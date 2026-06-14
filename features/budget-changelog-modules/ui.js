// Budget Changelog - UI Module
// Injects comparison UI into the Budget Backups sidebar

const BudgetChangelogUI = (() => {
  const DEBUG = false; // Set to true for development debugging only
  let diffModal = null;

  // Helper to build HTML from arrays iteratively (avoids deep call stacks from nested .map())
  function buildHtmlList(items, renderFn) {
    const parts = [];
    for (let i = 0; i < items.length; i++) {
      parts.push(renderFn(items[i]));
    }
    return parts.join('');
  }

  /**
   * Inject compare controls into the Budget Backups sidebar
   * @param {HTMLElement} sidebar - The Budget Backups sidebar element
   * @param {Array} backups - List of backup objects from API
   */
  function injectCompareControls(sidebar, backups) {
    // Check if we already injected
    if (sidebar.querySelector('#jt-budget-compare-controls')) {
      return;
    }

    // Find the scrollable content area inside the sidebar
    // The sidebar structure is: outer div > absolute inset div > overflow-y-auto div (sticky)
    const scrollableArea = sidebar.querySelector('.overflow-y-auto');
    if (!scrollableArea) {
      console.warn('BudgetChangelog: Could not find scrollable sidebar area');
      return;
    }

    // Find the content container - specifically the div.p-4.space-y-4 that contains
    // the description and backup list, NOT the header div.p-4 which contains the title
    // Sidebar structure:
    //   - overflow-y-auto (scrollable)
    //     - sticky header row (contains: div.p-4.font-bold + close button)
    //     - div.p-4.space-y-4 (content: description + border-t with backup items)
    const contentContainer = scrollableArea.querySelector('div.p-4.space-y-4');
    if (!contentContainer) {
      console.warn('BudgetChangelog: Could not find content container (div.p-4.space-y-4)');
      return;
    }

    // Create compare controls container - vertical stacking for narrow sidebar
    const controlsContainer = document.createElement('div');
    controlsContainer.id = 'jt-budget-compare-controls';
    controlsContainer.className = 'p-3 bg-gray-50 border border-gray-200 rounded-lg';
    controlsContainer.innerHTML = `
      <div class="text-sm font-bold text-gray-700 mb-2">Compare Backups</div>
      <div class="space-y-2 mb-2">
        <div>
          <label class="text-xs text-gray-500 block mb-1">To (newer):</label>
          <select id="jt-backup-new" class="w-full text-xs border rounded p-1.5 bg-white">
            <option value="">Select backup...</option>
          </select>
        </div>
        <div>
          <label class="text-xs text-gray-500 block mb-1">From (older):</label>
          <select id="jt-backup-old" class="w-full text-xs border rounded p-1.5 bg-white">
            <option value="">Select backup...</option>
          </select>
        </div>
      </div>
      <button id="jt-compare-btn" class="w-full text-xs bg-cyan-500 hover:bg-cyan-600 text-white font-medium py-2 px-3 rounded disabled:opacity-50 disabled:cursor-not-allowed transition">
        Compare
      </button>
      <div id="jt-compare-status" class="text-xs text-gray-500 mt-2 hidden"></div>
    `;

    // Insert AFTER the description text but BEFORE the backup items list (div.border-t)
    // The content container structure is:
    //   - div (description text)
    //   - div.border-t (backup items list)
    const backupItemsList = contentContainer.querySelector('div.border-t');

    if (backupItemsList) {
      // Insert right before the backup items list
      contentContainer.insertBefore(controlsContainer, backupItemsList);
    } else {
      // Fallback: append to content container (after description)
      contentContainer.appendChild(controlsContainer);
    }

    if (DEBUG) console.log('BudgetChangelog: Compare controls injected');

    // Populate dropdowns
    populateBackupDropdowns(backups);

    // Set up event listeners
    setupCompareEventListeners();
  }

  /**
   * Filter backups to only include the latest backup per day (local timezone)
   * If there are fewer than 3 unique days, returns all backups to allow comparison
   * @param {Array} backups - List of backup objects
   * @returns {Array} Filtered list with only latest per day (or all if few unique days)
   */
  function filterLatestPerDay(backups) {
    if (!backups || backups.length === 0) return [];

    // Sort backups by date (newest first)
    const sorted = [...backups].sort((a, b) => {
      return new Date(b.createdAt) - new Date(a.createdAt);
    });

    if (DEBUG) console.log('BudgetChangelog: Filtering backups, total count:', sorted.length);

    // Group by LOCAL date (YYYY-MM-DD) and keep only the latest per day
    // Using local date instead of UTC to match user's timezone
    const latestByDay = new Map();
    const allByDay = new Map(); // Track all backups per day for fallback

    for (const backup of sorted) {
      const date = new Date(backup.createdAt);
      // Use local date components instead of toISOString (which is UTC)
      const year = date.getFullYear();
      const month = String(date.getMonth() + 1).padStart(2, '0');
      const day = String(date.getDate()).padStart(2, '0');
      const dateKey = `${year}-${month}-${day}`;

      // Track all backups per day
      if (!allByDay.has(dateKey)) {
        allByDay.set(dateKey, []);
      }
      allByDay.get(dateKey).push(backup);

      // Since sorted newest first, first occurrence is the latest for that day
      if (!latestByDay.has(dateKey)) {
        latestByDay.set(dateKey, backup);
        if (DEBUG) console.log('BudgetChangelog: Added backup for date:', dateKey);
      }
    }

    const uniqueDays = latestByDay.size;
    if (DEBUG) console.log('BudgetChangelog: Found', uniqueDays, 'unique days');

    // If fewer than 3 unique days but we have multiple backups, show all backups
    // This allows comparing backups from the same day
    if (uniqueDays < 3 && sorted.length > 1) {
      if (DEBUG) console.log('BudgetChangelog: Few unique days, returning all', sorted.length, 'backups');
      return sorted;
    }

    const result = Array.from(latestByDay.values());
    if (DEBUG) console.log('BudgetChangelog: Filtered to', result.length, 'backups (one per day)');

    // Return as array, maintaining newest-first order
    return result;
  }

  /**
   * Populate the backup selection dropdowns
   * Shows only the latest backup per day to reduce clutter
   * If multiple backups from same day, includes time in display
   * @param {Array} backups - List of backup objects
   */
  function populateBackupDropdowns(backups) {
    const oldSelect = document.getElementById('jt-backup-old');
    const newSelect = document.getElementById('jt-backup-new');

    if (!oldSelect || !newSelect) return;

    // Filter to only show latest backup per day (or all if few unique days)
    const filteredBackups = filterLatestPerDay(backups);

    // Check if we need to show times (multiple backups from same day)
    const needsTimes = filteredBackups.length > countUniqueDays(filteredBackups);

    // Clear existing options (keep placeholder)
    oldSelect.innerHTML = '<option value="">Select backup...</option>';
    newSelect.innerHTML = '<option value="">Select backup...</option>';

    // Add backup options
    for (const backup of filteredBackups) {
      const date = new Date(backup.createdAt);

      let dateStr;
      if (needsTimes) {
        // Include time when multiple backups from same day
        dateStr = date.toLocaleDateString('en-US', {
          weekday: 'short',
          month: 'short',
          day: 'numeric',
          year: 'numeric',
          hour: 'numeric',
          minute: '2-digit'
        });
      } else {
        dateStr = date.toLocaleDateString('en-US', {
          weekday: 'short',
          month: 'short',
          day: 'numeric',
          year: 'numeric'
        });
      }
      const user = backup.createdByUser?.name || 'Unknown';

      // Escape API-sourced values to prevent XSS
      const escUser = escapeHtml(user);
      const escId = escapeHtml(String(backup.id));
      const escUrl = escapeHtml(backup.url || '');
      const escDate = escapeHtml(backup.createdAt || '');
      const optionHtml = `<option value="${escId}" data-url="${escUrl}" data-date="${escDate}">${dateStr} - ${escUser}</option>`;

      oldSelect.insertAdjacentHTML('beforeend', optionHtml);
      newSelect.insertAdjacentHTML('beforeend', optionHtml);
    }

    // Pre-select most recent two if available
    if (filteredBackups.length >= 2) {
      newSelect.value = filteredBackups[0].id;
      oldSelect.value = filteredBackups[1].id;
    }
  }

  /**
   * Count unique days in backup list
   * @param {Array} backups - List of backup objects
   * @returns {number} Number of unique days
   */
  function countUniqueDays(backups) {
    const days = new Set();
    for (const backup of backups) {
      const date = new Date(backup.createdAt);
      const dateKey = `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`;
      days.add(dateKey);
    }
    return days.size;
  }

  /**
   * Set up event listeners for compare controls
   */
  function setupCompareEventListeners() {
    const oldSelect = document.getElementById('jt-backup-old');
    const newSelect = document.getElementById('jt-backup-new');
    const compareBtn = document.getElementById('jt-compare-btn');

    if (!oldSelect || !newSelect || !compareBtn) return;

    // Enable/disable compare button based on selections
    const updateButtonState = () => {
      const canCompare = oldSelect.value && newSelect.value && oldSelect.value !== newSelect.value;
      compareBtn.disabled = !canCompare;
    };

    oldSelect.addEventListener('change', updateButtonState);
    newSelect.addEventListener('change', updateButtonState);

    // Initial button state
    updateButtonState();

    // Compare button click
    compareBtn.addEventListener('click', async () => {
      const oldOption = oldSelect.selectedOptions[0];
      const newOption = newSelect.selectedOptions[0];

      if (!oldOption?.value || !newOption?.value) return;

      await performComparison({
        oldId: oldOption.value,
        oldUrl: oldOption.dataset.url,
        oldDate: oldOption.dataset.date,
        newId: newOption.value,
        newUrl: newOption.dataset.url,
        newDate: newOption.dataset.date
      });
    });
  }

  /**
   * Perform the backup comparison
   * @param {Object} options - Comparison options with URLs and dates
   */
  async function performComparison(options) {
    const statusEl = document.getElementById('jt-compare-status');
    const compareBtn = document.getElementById('jt-compare-btn');

    try {
      // Show loading state
      if (statusEl) {
        statusEl.textContent = 'Downloading backups...';
        statusEl.classList.remove('hidden', 'text-red-500');
        statusEl.classList.add('text-gray-500');
      }
      if (compareBtn) {
        compareBtn.disabled = true;
        compareBtn.textContent = 'Comparing...';
      }

      // Fetch both CSVs
      const [oldCsv, newCsv] = await Promise.all([
        fetchBackupCSV(options.oldUrl, options.oldId),
        fetchBackupCSV(options.newUrl, options.newId)
      ]);

      if (statusEl) {
        statusEl.textContent = 'Analyzing changes...';
      }

      // Parse CSVs
      const oldItems = BudgetCSVParser.parse(oldCsv);
      const newItems = BudgetCSVParser.parse(newCsv);

      // Compare
      const diff = BudgetDiffEngine.compare(oldItems, newItems);

      // Show results
      showDiffModal(diff, {
        oldDate: formatDate(options.oldDate),
        newDate: formatDate(options.newDate)
      });

      if (statusEl) {
        statusEl.classList.add('hidden');
      }

    } catch (error) {
      console.error('BudgetChangelog: Comparison error:', error);
      if (statusEl) {
        statusEl.textContent = 'Error: ' + (error.message || 'Failed to compare backups');
        statusEl.classList.remove('hidden', 'text-gray-500');
        statusEl.classList.add('text-red-500');
      }
    } finally {
      if (compareBtn) {
        compareBtn.disabled = false;
        compareBtn.textContent = 'Compare Selected Backups';
      }
    }
  }

  /**
   * Fetch CSV content from a backup URL
   * @param {string} url - Backup download URL
   * @param {string} backupId - Backup ID (for API fallback)
   * @returns {Promise<string>} CSV text content
   */
  async function fetchBackupCSV(url, backupId) {
    // If we have a direct URL, use it
    if (url) {
      const response = await fetch(url);
      if (!response.ok) {
        throw new Error(`Failed to download backup: ${response.status}`);
      }
      return await response.text();
    }

    // Otherwise, we need to get the URL via API
    // This would require JobTreadProService integration
    throw new Error('Backup URL not available. Please refresh the page and try again.');
  }

  /**
   * Format a date string for display
   * @param {string} dateStr - ISO date string
   * @returns {string} Formatted date
   */
  function formatDate(dateStr) {
    if (!dateStr) return 'Unknown';
    const date = new Date(dateStr);
    return date.toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
      hour: 'numeric',
      minute: '2-digit'
    });
  }

  /**
   * Show the diff results in a new browser tab
   * Uses chrome extension page approach to bypass JobTread CSP restrictions.
   * Falls back to static HTML modal if extension page is unavailable.
   * @param {Object} diff - Diff result from BudgetDiffEngine
   * @param {Object} options - Display options (dates, etc.)
   */
  function showDiffModal(diff, options = {}) {
    // Safety check for very large diffs
    const totalItems = (diff.added?.length || 0) + (diff.removed?.length || 0) + (diff.modified?.length || 0);
    if (totalItems > 3000) {
      options.summaryOnly = true;
      options.totalItems = totalItems;
      console.warn(`BudgetChangelog: Large diff (${totalItems} items), showing summary view`);
    }

    if (typeof BudgetReportApp !== 'undefined' && BudgetReportApp.serializeData) {
      // Use extension page approach (bypasses CSP)
      const data = BudgetReportApp.serializeData(diff, options);
      chrome.storage.local.set({ _budgetReportData: data }, function() {
        const reportUrl = chrome.runtime.getURL('report.html');
        window.open(reportUrl, '_blank');
      });
    } else {
      // Fallback to static HTML report
      const htmlContent = generateFullReportHTML(diff, options);
      const blob = new Blob([htmlContent], { type: 'text/html' });
      const blobUrl = URL.createObjectURL(blob);
      const newTab = window.open(blobUrl, '_blank');
      if (!newTab) {
        URL.revokeObjectURL(blobUrl);
        showDiffModalFallback(diff, options);
      }
    }
  }

  /**
   * Generate full HTML report for new tab
   * @param {Object} diff - Diff result
   * @param {Object} options - Options with dates
   * @returns {string} Complete HTML document
   */
  /**
   * JSON-encode a value for safe interpolation into an inline <script> block.
   *
   * Plain JSON.stringify does NOT escape '</script>' — an item name like
   * `</script><img src=x onerror=...>` would break out of the script context
   * and execute arbitrary JS in the blob: URL's origin. This helper escapes:
   *   - '<' and '>'  → prevents </script> and <!-- sequences
   *   - '&'          → defensive for mixed-HTML/JS contexts
   *   - U+2028/U+2029 → valid JSON but terminate JS string literals
   */
  function jsonForScript(value) {
    return JSON.stringify(value)
      .replace(/</g, '\\u003c')
      .replace(/>/g, '\\u003e')
      .replace(/&/g, '\\u0026')
      .replace(/\u2028/g, '\\u2028')
      .replace(/\u2029/g, '\\u2029');
  }

  function generateFullReportHTML(diff, options) {
    const jobName = getJobNameFromPage() || 'Budget';
    const { summary } = diff;

    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Budget Changelog - ${escapeHtml(jobName)}</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background: #f3f4f6; min-height: 100vh; color: #1f2937; }
    .container { max-width: 900px; margin: 0 auto; padding: 24px; }
    .card { background: white; border-radius: 8px; box-shadow: 0 1px 3px rgba(0,0,0,0.1); padding: 24px; margin-bottom: 24px; }
    .header-row { display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 16px; flex-wrap: wrap; gap: 16px; }
    h1 { font-size: 24px; font-weight: 700; color: #111827; }
    .subtitle { font-size: 18px; color: #6b7280; }
    .btn { padding: 8px 16px; border-radius: 8px; border: none; cursor: pointer; font-size: 14px; transition: background 0.2s; }
    .btn-gray { background: #f3f4f6; color: #374151; }
    .btn-gray:hover { background: #e5e7eb; }
    .btn-cyan { background: #06b6d4; color: white; }
    .btn-cyan:hover { background: #0891b2; }
    .btn-green { background: #22c55e; color: white; }
    .date-range { display: flex; align-items: center; gap: 12px; font-size: 14px; color: #6b7280; flex-wrap: wrap; }
    .date-badge { background: #f3f4f6; padding: 4px 12px; border-radius: 4px; }
    .arrow { width: 16px; height: 16px; }
    .stats-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(180px, 1fr)); gap: 16px; margin-bottom: 24px; }
    .stat-card { background: white; border-radius: 8px; box-shadow: 0 1px 3px rgba(0,0,0,0.1); padding: 16px; text-align: center; }
    .stat-card.green-border { border-left: 4px solid #22c55e; }
    .stat-card.red-border { border-left: 4px solid #ef4444; }
    .stat-value { font-size: 28px; font-weight: 700; }
    .stat-value.green { color: #16a34a; }
    .stat-value.red { color: #dc2626; }
    .stat-label { font-size: 14px; color: #6b7280; margin-top: 4px; }
    .stat-sublabel { font-size: 12px; color: #9ca3af; margin-top: 4px; }
    .mini-stats { display: grid; grid-template-columns: repeat(3, 1fr); gap: 16px; text-align: center; }
    .mini-stat-value { font-size: 20px; font-weight: 600; color: #374151; }
    .mini-stat-label { font-size: 12px; color: #6b7280; }
    .section { background: white; border-radius: 8px; box-shadow: 0 1px 3px rgba(0,0,0,0.1); margin-bottom: 24px; overflow: hidden; }
    .section-header { padding: 16px; border-bottom: 1px solid #e5e7eb; display: flex; align-items: center; gap: 8px; }
    .section-header.green { background: #f0fdf4; border-color: #bbf7d0; }
    .section-header.red { background: #fef2f2; border-color: #fecaca; }
    .section-header.yellow { background: #fefce8; border-color: #fef08a; }
    .section-header h2 { font-size: 16px; font-weight: 700; }
    .section-header.green h2 { color: #166534; }
    .section-header.red h2 { color: #991b1b; }
    .section-header.yellow h2 { color: #854d0e; }
    .dot { width: 12px; height: 12px; border-radius: 50%; }
    .dot.green { background: #22c55e; }
    .dot.red { background: #ef4444; }
    .dot.yellow { background: #eab308; }
    .item { padding: 16px; border-bottom: 1px solid #f3f4f6; }
    .item:last-child { border-bottom: none; }
    .item:hover { background: #fafafa; }
    .item-row { display: flex; justify-content: space-between; align-items: flex-start; gap: 16px; }
    .item-name { font-weight: 600; color: #111827; }
    .item-location { font-size: 14px; margin-top: 2px; }
    .item-location.green { color: #16a34a; }
    .item-location.red { color: #dc2626; }
    .item-location.yellow { color: #ca8a04; }
    .item-desc { font-size: 14px; color: #6b7280; font-style: italic; margin-top: 4px; }
    .item-values { text-align: right; flex-shrink: 0; }
    .item-values div { font-size: 14px; }
    .changes-box { background: #f9fafb; border-radius: 6px; padding: 12px; margin-top: 8px; }
    .change-row { font-size: 14px; display: flex; align-items: center; gap: 8px; flex-wrap: wrap; margin-bottom: 4px; }
    .change-row:last-child { margin-bottom: 0; }
    .change-label { font-weight: 500; color: #374151; }
    .change-old { color: #dc2626; text-decoration: line-through; }
    .change-new { color: #16a34a; font-weight: 500; }
    .footer { text-align: center; font-size: 12px; color: #9ca3af; padding: 32px 0; }
    .no-changes { text-align: center; padding: 48px; }
    .no-changes svg { width: 64px; height: 64px; margin: 0 auto 16px; color: #22c55e; }
    .no-changes h2 { font-size: 20px; font-weight: 600; color: #374151; }
    .no-changes p { color: #6b7280; margin-top: 8px; }
    @media print {
      .no-print { display: none !important; }
      body { background: white; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
      .card, .stat-card, .section { box-shadow: none; border: 1px solid #e5e7eb; }
    }
    @media (max-width: 600px) {
      .header-row { flex-direction: column; }
      .stats-grid { grid-template-columns: 1fr 1fr; }
    }
  </style>
</head>
<body>
  <div class="container">
    <!-- Header -->
    <div class="card">
      <div class="header-row">
        <div>
          <h1>Budget Changelog</h1>
          <p class="subtitle">${escapeHtml(jobName)}</p>
        </div>
        <!-- Buttons temporarily hidden - will be fixed in future update -->
        <div class="no-print" style="display: none; gap: 8px;">
          <button id="print-btn" class="btn btn-gray">Print Report</button>
          <button id="copy-btn" class="btn btn-cyan">Copy Summary</button>
        </div>
      </div>
      <div class="date-range">
        <span class="date-badge">${options.oldDate || 'Older Backup'}</span>
        <svg class="arrow" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M17 8l4 4m0 0l-4 4m4-4H3"/>
        </svg>
        <span class="date-badge">${options.newDate || 'Newer Backup'}</span>
      </div>
    </div>

    ${diff.hasChanges ? `
    <!-- Summary Cards -->
    <div class="stats-grid">
      <div class="stat-card">
        <div class="stat-value ${summary.costChange >= 0 ? 'green' : 'red'}">
          ${BudgetDiffEngine.formatDelta(summary.costChange, true)}
        </div>
        <div class="stat-label">Total Cost Change</div>
        <div class="stat-sublabel">
          ${BudgetDiffEngine.formatCurrency(summary.oldTotalCost)} → ${BudgetDiffEngine.formatCurrency(summary.newTotalCost)}
        </div>
      </div>
      <div class="stat-card">
        <div class="stat-value ${summary.priceChange >= 0 ? 'green' : 'red'}">
          ${BudgetDiffEngine.formatDelta(summary.priceChange, true)}
        </div>
        <div class="stat-label">Total Price Change</div>
        <div class="stat-sublabel">
          ${BudgetDiffEngine.formatCurrency(summary.oldTotalPrice)} → ${BudgetDiffEngine.formatCurrency(summary.newTotalPrice)}
        </div>
      </div>
      <div class="stat-card green-border">
        <div class="stat-value green">+${summary.addedCount}</div>
        <div class="stat-label">Items Added</div>
      </div>
      <div class="stat-card red-border">
        <div class="stat-value red">-${summary.removedCount}</div>
        <div class="stat-label">Items Removed</div>
      </div>
    </div>

    <!-- Additional Stats -->
    <div class="card">
      <div class="mini-stats">
        <div>
          <div class="mini-stat-value">${summary.modifiedCount}</div>
          <div class="mini-stat-label">Items Modified</div>
        </div>
        <div>
          <div class="mini-stat-value">${summary.unchangedCount || 0}</div>
          <div class="mini-stat-label">Items Unchanged</div>
        </div>
        <div>
          <div class="mini-stat-value">${summary.addedCount + summary.removedCount + summary.modifiedCount}</div>
          <div class="mini-stat-label">Total Changes</div>
        </div>
      </div>
    </div>

    ${options.summaryOnly ? '<div class="summary-note" style="padding: 20px; text-align: center; color: #666;">This comparison has ' + (options.totalItems || '3000') + '+ items. Showing summary only to prevent browser slowdown.</div>' : `
    ${renderFullAddedSection(diff.added)}
    ${renderFullRemovedSection(diff.removed)}
    ${renderFullModifiedSection(diff.modified)}
    `}
    ` : `
    <!-- No Changes -->
    <div class="card no-changes">
      <svg fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z"/>
      </svg>
      <h2>No Changes Detected</h2>
      <p>These two budget backups are identical.</p>
    </div>
    `}

    <!-- Footer -->
    <div class="footer">
      Generated by JT Power Tools Budget Changelog • ${new Date().toLocaleString()}
    </div>
  </div>

  <script>
    (function() {
      var summaryText = ${jsonForScript(String(BudgetDiffEngine.generateTextSummary(diff, options)))};

      // Wait for DOM to be fully ready
      function init() {
        var printBtn = document.getElementById('print-btn');
        var copyBtn = document.getElementById('copy-btn');

        if (printBtn) {
          printBtn.addEventListener('click', function() {
            window.print();
          });
        }

        if (copyBtn) {
          copyBtn.addEventListener('click', function() {
            navigator.clipboard.writeText(summaryText).then(function() {
              copyBtn.textContent = 'Copied!';
              copyBtn.className = 'btn btn-green';
              setTimeout(function() {
                copyBtn.textContent = 'Copy Summary';
                copyBtn.className = 'btn btn-cyan';
              }, 2000);
            }).catch(function(err) {
              console.error('Copy failed:', err);
              // Fallback: try execCommand
              var textarea = document.createElement('textarea');
              textarea.value = summaryText;
              textarea.style.position = 'fixed';
              textarea.style.opacity = '0';
              document.body.appendChild(textarea);
              textarea.select();
              try {
                document.execCommand('copy');
                copyBtn.textContent = 'Copied!';
                copyBtn.className = 'btn btn-green';
              } catch (e) {
                copyBtn.textContent = 'Failed';
              }
              document.body.removeChild(textarea);
              setTimeout(function() {
                copyBtn.textContent = 'Copy Summary';
                copyBtn.className = 'btn btn-cyan';
              }, 2000);
            });
          });
        }
      }

      // Run init when DOM is ready
      if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
      } else {
        init();
      }
    })();
  </script>
</body>
</html>`;
  }

  /**
   * Get job name from current page
   * @returns {string|null} Job name or null
   */
  function getJobNameFromPage() {
    // Try to get job name from page title or header
    const jobHeader = document.querySelector('h1, [class*="job-name"], [class*="jobName"]');
    if (jobHeader) {
      return jobHeader.textContent?.trim();
    }
    // Try from document title
    const title = document.title;
    if (title && title.includes('-')) {
      return title.split('-')[0].trim();
    }
    return null;
  }

  /**
   * Render full added items section for new tab
   */
  function renderFullAddedSection(items) {
    if (!items || items.length === 0) return '';

    return `
    <div class="section">
      <div class="section-header green">
        <span class="dot green"></span>
        <h2>Added Items (${items.length})</h2>
      </div>
      ${buildHtmlList(items, item => {
    const location = item.hierarchy.slice(0, -1).join(' > ') || 'Root Level';
    return `
        <div class="item">
          <div class="item-row">
            <div style="flex: 1;">
              <div class="item-name">${escapeHtml(item.name)}</div>
              <div class="item-location green">${escapeHtml(location)}</div>
              ${item.description ? `<div class="item-desc">${escapeHtml(item.description.substring(0, 200))}${item.description.length > 200 ? '...' : ''}</div>` : ''}
            </div>
            <div class="item-values">
              ${item.quantity !== null ? `<div style="color: #6b7280;">Qty: ${item.quantity} ${item.unit || ''}</div>` : ''}
              ${item.extendedCost !== null ? `<div style="font-weight: 500;">Cost: ${BudgetDiffEngine.formatCurrency(item.extendedCost)}</div>` : ''}
              ${item.extendedPrice !== null ? `<div style="color: #16a34a; font-weight: 500;">Price: ${BudgetDiffEngine.formatCurrency(item.extendedPrice)}</div>` : ''}
            </div>
          </div>
        </div>`;
  })}
    </div>`;
  }

  /**
   * Render full removed items section for new tab
   */
  function renderFullRemovedSection(items) {
    if (!items || items.length === 0) return '';

    return `
    <div class="section">
      <div class="section-header red">
        <span class="dot red"></span>
        <h2>Removed Items (${items.length})</h2>
      </div>
      ${buildHtmlList(items, item => {
    const location = item.hierarchy.slice(0, -1).join(' > ') || 'Root Level';
    return `
        <div class="item">
          <div class="item-row">
            <div style="flex: 1;">
              <div class="item-name">${escapeHtml(item.name)}</div>
              <div class="item-location red">${escapeHtml(location)}</div>
              ${item.description ? `<div class="item-desc">${escapeHtml(item.description.substring(0, 200))}${item.description.length > 200 ? '...' : ''}</div>` : ''}
            </div>
            <div class="item-values">
              ${item.quantity !== null ? `<div style="color: #6b7280;">Qty: ${item.quantity} ${item.unit || ''}</div>` : ''}
              ${item.extendedCost !== null ? `<div style="font-weight: 500;">Cost: ${BudgetDiffEngine.formatCurrency(item.extendedCost)}</div>` : ''}
              ${item.extendedPrice !== null ? `<div style="color: #dc2626; font-weight: 500;">Price: ${BudgetDiffEngine.formatCurrency(item.extendedPrice)}</div>` : ''}
            </div>
          </div>
        </div>`;
  })}
    </div>`;
  }

  /**
   * Render full modified items section for new tab
   */
  function renderFullModifiedSection(modifications) {
    if (!modifications || modifications.length === 0) return '';

    return `
    <div class="section">
      <div class="section-header yellow">
        <span class="dot yellow"></span>
        <h2>Modified Items (${modifications.length})</h2>
      </div>
      ${buildHtmlList(modifications, mod => {
    const { item, changes } = mod;
    const location = item.hierarchy.slice(0, -1).join(' > ') || 'Root Level';
    return `
        <div class="item">
          <div class="item-name">${escapeHtml(item.name)}</div>
          <div class="item-location yellow">${escapeHtml(location)}</div>
          <div class="changes-box">
            ${buildHtmlList(changes, change => {
    let oldDisplay = change.oldValue;
    let newDisplay = change.newValue;

    if (change.isCurrency) {
      oldDisplay = BudgetDiffEngine.formatCurrency(change.oldValue);
      newDisplay = BudgetDiffEngine.formatCurrency(change.newValue);
    } else if (change.type === 'boolean') {
      oldDisplay = change.oldValue ? 'Yes' : 'No';
      newDisplay = change.newValue ? 'Yes' : 'No';
    } else if (change.type === 'text' && change.field === 'description') {
      return `<div class="change-row"><span class="change-label">${change.label}:</span> <span style="color: #ca8a04; font-style: italic;">Description was modified</span></div>`;
    }

    if (!oldDisplay && oldDisplay !== 0) oldDisplay = '(empty)';

    return `
              <div class="change-row">
                <span class="change-label">${change.label}:</span>
                <span class="change-old">${escapeHtml(String(oldDisplay))}</span>
                <span style="color: #9ca3af;">→</span>
                <span class="change-new">${escapeHtml(String(newDisplay))}</span>
              </div>`;
  })}
          </div>
        </div>`;
  })}
    </div>`;
  }

  /**
   * Fallback modal if popup is blocked
   * @param {Object} diff - Diff result from BudgetDiffEngine
   * @param {Object} options - Display options (dates, etc.)
   */
  function showDiffModalFallback(diff, options = {}) {
    // Remove existing modal if any
    closeDiffModal();

    // Create modal backdrop
    const backdrop = document.createElement('div');
    backdrop.id = 'jt-diff-modal-backdrop';
    backdrop.className = 'fixed inset-0 bg-black bg-opacity-50 z-50 flex items-center justify-center p-4';
    backdrop.onclick = (e) => {
      if (e.target === backdrop) closeDiffModal();
    };

    // Create modal content
    const modal = document.createElement('div');
    modal.id = 'jt-diff-modal';
    modal.className = 'bg-white rounded-lg shadow-xl max-w-4xl w-full max-h-[90vh] flex flex-col';
    modal.innerHTML = `
      <div class="flex items-center justify-between p-4 border-b">
        <div>
          <h2 class="text-lg font-bold text-gray-900">Budget Changelog</h2>
          <p class="text-sm text-gray-500">${options.oldDate || 'Older'} → ${options.newDate || 'Newer'}</p>
        </div>
        <div class="flex items-center gap-2">
          <button id="jt-diff-copy-btn" class="text-sm bg-gray-100 hover:bg-gray-200 text-gray-700 px-3 py-1.5 rounded transition">
            Copy Summary
          </button>
          <button id="jt-diff-close-btn" class="text-gray-400 hover:text-gray-600 p-1">
            <svg xmlns="http://www.w3.org/2000/svg" class="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
      </div>
      <div class="overflow-auto flex-1 p-4">
        ${renderDiffContent(diff)}
      </div>
    `;

    backdrop.appendChild(modal);
    document.body.appendChild(backdrop);
    diffModal = backdrop;

    // Set up modal event listeners
    document.getElementById('jt-diff-close-btn')?.addEventListener('click', closeDiffModal);
    document.getElementById('jt-diff-copy-btn')?.addEventListener('click', () => {
      copyDiffSummary(diff, options);
    });

    // Close on Escape key
    const escHandler = (e) => {
      if (e.key === 'Escape') {
        closeDiffModal();
        document.removeEventListener('keydown', escHandler);
      }
    };
    document.addEventListener('keydown', escHandler);
  }

  /**
   * Close the diff modal
   */
  function closeDiffModal() {
    if (diffModal) {
      diffModal.remove();
      diffModal = null;
    }
  }

  /**
   * Render the diff content HTML
   * @param {Object} diff - Diff result
   * @returns {string} HTML string
   */
  function renderDiffContent(diff) {
    if (!diff.hasChanges) {
      return `
        <div class="text-center py-8 text-gray-500">
          <svg xmlns="http://www.w3.org/2000/svg" class="h-12 w-12 mx-auto mb-4 text-gray-300" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
          <p class="text-lg font-medium">No Changes Detected</p>
          <p class="text-sm">These two backups are identical.</p>
        </div>
      `;
    }

    const { summary } = diff;
    let html = '';

    // Summary cards
    html += `
      <div class="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6">
        <div class="bg-gray-50 rounded-lg p-3 text-center">
          <div class="text-2xl font-bold ${summary.costChange >= 0 ? 'text-green-600' : 'text-red-600'}">
            ${BudgetDiffEngine.formatDelta(summary.costChange, true)}
          </div>
          <div class="text-xs text-gray-500">Cost Change</div>
        </div>
        <div class="bg-gray-50 rounded-lg p-3 text-center">
          <div class="text-2xl font-bold ${summary.priceChange >= 0 ? 'text-green-600' : 'text-red-600'}">
            ${BudgetDiffEngine.formatDelta(summary.priceChange, true)}
          </div>
          <div class="text-xs text-gray-500">Price Change</div>
        </div>
        <div class="bg-green-50 rounded-lg p-3 text-center">
          <div class="text-2xl font-bold text-green-600">+${summary.addedCount}</div>
          <div class="text-xs text-gray-500">Items Added</div>
        </div>
        <div class="bg-red-50 rounded-lg p-3 text-center">
          <div class="text-2xl font-bold text-red-600">-${summary.removedCount}</div>
          <div class="text-xs text-gray-500">Items Removed</div>
        </div>
      </div>
    `;

    // Added items
    if (diff.added.length > 0) {
      html += `
        <div class="mb-6">
          <h3 class="text-sm font-bold text-green-700 mb-2 flex items-center gap-2">
            <span class="w-2 h-2 bg-green-500 rounded-full"></span>
            Added Items (${diff.added.length})
          </h3>
          <div class="space-y-2">
            ${buildHtmlList(diff.added, renderAddedItem)}
          </div>
        </div>
      `;
    }

    // Removed items
    if (diff.removed.length > 0) {
      html += `
        <div class="mb-6">
          <h3 class="text-sm font-bold text-red-700 mb-2 flex items-center gap-2">
            <span class="w-2 h-2 bg-red-500 rounded-full"></span>
            Removed Items (${diff.removed.length})
          </h3>
          <div class="space-y-2">
            ${buildHtmlList(diff.removed, renderRemovedItem)}
          </div>
        </div>
      `;
    }

    // Modified items
    if (diff.modified.length > 0) {
      html += `
        <div class="mb-6">
          <h3 class="text-sm font-bold text-yellow-700 mb-2 flex items-center gap-2">
            <span class="w-2 h-2 bg-yellow-500 rounded-full"></span>
            Modified Items (${diff.modified.length})
          </h3>
          <div class="space-y-2">
            ${buildHtmlList(diff.modified, renderModifiedItem)}
          </div>
        </div>
      `;
    }

    return html;
  }

  /**
   * Render an added item card
   * @param {Object} item - Budget item
   * @returns {string} HTML string
   */
  function renderAddedItem(item) {
    const location = item.hierarchy.slice(0, -1).join(' > ') || 'Root';
    return `
      <div class="bg-green-50 border border-green-200 rounded p-3">
        <div class="font-medium text-green-800">${escapeHtml(item.name)}</div>
        <div class="text-xs text-green-600 mb-1">${escapeHtml(location)}</div>
        <div class="flex gap-4 text-xs text-green-700">
          ${item.extendedCost !== null ? `<span>Cost: ${BudgetDiffEngine.formatCurrency(item.extendedCost)}</span>` : ''}
          ${item.extendedPrice !== null ? `<span>Price: ${BudgetDiffEngine.formatCurrency(item.extendedPrice)}</span>` : ''}
          ${item.quantity !== null ? `<span>Qty: ${item.quantity} ${item.unit || ''}</span>` : ''}
        </div>
      </div>
    `;
  }

  /**
   * Render a removed item card
   * @param {Object} item - Budget item
   * @returns {string} HTML string
   */
  function renderRemovedItem(item) {
    const location = item.hierarchy.slice(0, -1).join(' > ') || 'Root';
    return `
      <div class="bg-red-50 border border-red-200 rounded p-3">
        <div class="font-medium text-red-800">${escapeHtml(item.name)}</div>
        <div class="text-xs text-red-600 mb-1">${escapeHtml(location)}</div>
        <div class="flex gap-4 text-xs text-red-700">
          ${item.extendedCost !== null ? `<span>Cost: ${BudgetDiffEngine.formatCurrency(item.extendedCost)}</span>` : ''}
          ${item.extendedPrice !== null ? `<span>Price: ${BudgetDiffEngine.formatCurrency(item.extendedPrice)}</span>` : ''}
          ${item.quantity !== null ? `<span>Qty: ${item.quantity} ${item.unit || ''}</span>` : ''}
        </div>
      </div>
    `;
  }

  /**
   * Render a modified item card
   * @param {Object} mod - Modified item with changes
   * @returns {string} HTML string
   */
  function renderModifiedItem(mod) {
    const { item, changes } = mod;
    const location = item.hierarchy.slice(0, -1).join(' > ') || 'Root';

    const changesHtml = buildHtmlList(changes, change => {
      if (change.type === 'text' && change.field === 'description') {
        return `<div class="text-xs"><span class="text-gray-500">${change.label}:</span> <span class="text-yellow-700">(description changed)</span></div>`;
      }

      let oldDisplay = change.oldValue;
      let newDisplay = change.newValue;

      if (change.isCurrency) {
        oldDisplay = BudgetDiffEngine.formatCurrency(change.oldValue);
        newDisplay = BudgetDiffEngine.formatCurrency(change.newValue);
      } else if (change.type === 'boolean') {
        oldDisplay = change.oldValue ? 'Yes' : 'No';
        newDisplay = change.newValue ? 'Yes' : 'No';
      } else if (!oldDisplay && oldDisplay !== 0) {
        oldDisplay = '(empty)';
      }

      return `
        <div class="text-xs">
          <span class="text-gray-500">${change.label}:</span>
          <span class="text-red-600 line-through">${escapeHtml(String(oldDisplay))}</span>
          <span class="text-gray-400">→</span>
          <span class="text-green-600">${escapeHtml(String(newDisplay))}</span>
        </div>
      `;
    });

    return `
      <div class="bg-yellow-50 border border-yellow-200 rounded p-3">
        <div class="font-medium text-yellow-800">${escapeHtml(item.name)}</div>
        <div class="text-xs text-yellow-600 mb-2">${escapeHtml(location)}</div>
        <div class="space-y-1">
          ${changesHtml}
        </div>
      </div>
    `;
  }

  /**
   * Copy diff summary to clipboard
   * @param {Object} diff - Diff result
   * @param {Object} options - Options with dates
   */
  async function copyDiffSummary(diff, options) {
    const summary = BudgetDiffEngine.generateTextSummary(diff, options);
    const copyBtn = document.getElementById('jt-diff-copy-btn');

    try {
      await navigator.clipboard.writeText(summary);
      if (copyBtn) {
        const originalText = copyBtn.textContent;
        copyBtn.textContent = 'Copied!';
        copyBtn.classList.add('bg-green-100', 'text-green-700');
        setTimeout(() => {
          copyBtn.textContent = originalText;
          copyBtn.classList.remove('bg-green-100', 'text-green-700');
        }, 2000);
      }
    } catch (error) {
      console.error('BudgetChangelog: Failed to copy to clipboard:', error);
      if (copyBtn) {
        copyBtn.textContent = 'Copy failed';
        setTimeout(() => {
          copyBtn.textContent = 'Copy Summary';
        }, 2000);
      }
    }
  }

  /**
   * Escape HTML to prevent XSS
   * @param {string} str - String to escape
   * @returns {string} Escaped string
   */
  // Delegate to shared Sanitizer utility
  const escapeHtml = (text) => Sanitizer.escapeHTML(text);

  /**
   * Remove all injected UI elements
   */
  function cleanup() {
    closeDiffModal();
    const controls = document.getElementById('jt-budget-compare-controls');
    if (controls) {
      controls.remove();
    }
  }

  // Public API
  return {
    injectCompareControls,
    populateBackupDropdowns,
    showDiffModal,
    closeDiffModal,
    cleanup
  };
})();

// Export for use in other modules
if (typeof window !== 'undefined') {
  window.BudgetChangelogUI = BudgetChangelogUI;
}
