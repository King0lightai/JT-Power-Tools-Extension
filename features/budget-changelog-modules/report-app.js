// Budget Changelog - Interactive Report App Module
// Generates a self-contained interactive HTML page for budget comparison reports

const BudgetReportApp = (() => {
  /**
   * Generate a complete self-contained HTML page for the interactive budget report
   * @param {Object} diff - Diff result from BudgetDiffEngine
   * @param {Object} options - Display options (dates, job name, etc.)
   * @returns {string} Complete HTML document
   */
  function generate(diff, options = {}) {
    const jobName = options.jobName || getJobName();
    const data = serializeData(diff, options, jobName);
    const dataJson = JSON.stringify(data).replace(/<\//g, '<\\/');
    return '<!DOCTYPE html>\n' +
      '<html lang="en">\n' +
      '<head>\n' +
      '  <meta charset="UTF-8">\n' +
      '  <meta name="viewport" content="width=device-width, initial-scale=1.0">\n' +
      '  <title>Budget Changelog - ' + escapeHtml(jobName) + '</title>\n' +
      '  <style>' + getReportStyles() + '</style>\n' +
      '</head>\n' +
      '<body>\n' +
      '  <div id="app" style="padding:24px;font-family:sans-serif;">Loading report...</div>\n' +
      '  <script src="' + (typeof chrome !== 'undefined' && chrome.runtime ? chrome.runtime.getURL('features/budget-changelog-modules/report-app.js') : '') + '"></script>\n' +
      '  <script>\n' +
      '    try {\n' +
      '      var __REPORT_DATA__ = ' + dataJson + ';\n' +
      '      BudgetReportApp.renderReport(__REPORT_DATA__);\n' +
      '    } catch(e) {\n' +
      '      document.getElementById("app").innerHTML = "<h2 style=\\"color:red\\">Report Error</h2><pre>" + e.message + "\\n" + e.stack + "</pre>";\n' +
      '      console.error("Budget Report Error:", e);\n' +
      '    }\n' +
      '  </script>\n' +
      '</body>\n' +
      '</html>';
  }

  /**
   * Serialize diff data into a plain object for storage/transfer
   * @param {Object} diff - Diff result
   * @param {Object} options - Display options
   * @param {string} [jobName] - Job name (optional, auto-detected if omitted)
   * @returns {Object} Plain data object
   */
  function serializeData(diff, options, jobName) {
    if (!jobName) {
      jobName = options.jobName || getJobName();
    }
    const items = [];

    // Flatten added items
    if (diff.added) {
      for (let i = 0; i < diff.added.length; i++) {
        const entry = diff.added[i];
        const item = entry.item || entry;
        items.push(Object.assign({}, flattenItem(item), { _type: 'added' }));
      }
    }

    // Flatten removed items
    if (diff.removed) {
      for (let i = 0; i < diff.removed.length; i++) {
        const entry = diff.removed[i];
        const item = entry.item || entry;
        items.push(Object.assign({}, flattenItem(item), { _type: 'removed' }));
      }
    }

    // Flatten modified items
    if (diff.modified) {
      for (let i = 0; i < diff.modified.length; i++) {
        const mod = diff.modified[i];
        const oldItem = mod.oldItem || {};
        const newItem = mod.newItem || mod.item || {};
        items.push({
          _type: 'modified',
          old: flattenItem(oldItem),
          new: flattenItem(newItem),
          changes: (mod.changes || []).map(function(c) {
            return {
              field: c.field,
              label: c.label,
              oldValue: c.oldValue,
              newValue: c.newValue,
              type: c.type,
              isCurrency: c.isCurrency || false,
              delta: c.delta || 0
            };
          })
        });
      }
    }

    // Flatten unchanged items
    if (diff.unchanged) {
      for (let i = 0; i < diff.unchanged.length; i++) {
        const entry = diff.unchanged[i];
        const item = entry.item || entry;
        items.push(Object.assign({}, flattenItem(item), { _type: 'unchanged' }));
      }
    }

    return {
      items: items,
      summary: diff.summary || {},
      hasChanges: diff.hasChanges || false,
      options: {
        oldDate: options.oldDate || 'Older Backup',
        newDate: options.newDate || 'Newer Backup',
        jobName: jobName
      }
    };
  }

  /**
   * Flatten a budget item into a plain object for serialization
   * @param {Object} item - Budget item
   * @returns {Object} Flattened item
   */
  function flattenItem(item) {
    return {
      name: item.name || '',
      description: item.description || '',
      hierarchy: item.hierarchy || [],
      costGroup: item.costGroup || '',
      costCode: item.costCode || '',
      costType: item.costType || '',
      quantity: item.quantity != null ? item.quantity : null,
      unit: item.unit || '',
      unitCost: item.unitCost != null ? item.unitCost : null,
      extendedCost: item.extendedCost != null ? item.extendedCost : null,
      unitPrice: item.unitPrice != null ? item.unitPrice : null,
      extendedPrice: item.extendedPrice != null ? item.extendedPrice : null,
      taxable: item.taxable || false,
      selected: item.selected || false,
      quantityFormula: item.quantityFormula || '',
      unitCostFormula: item.unitCostFormula || '',
      unitPriceFormula: item.unitPriceFormula || '',
      customFields: item.customFields || {},
      uniqueKey: item.uniqueKey || ''
    };
  }

  /**
   * Get job name from current page
   * @returns {string} Job name
   */
  function getJobName() {
    const jobHeader = document.querySelector('h1, [class*="job-name"], [class*="jobName"]');
    if (jobHeader) {
      return jobHeader.textContent ? jobHeader.textContent.trim() : 'Budget';
    }
    const title = document.title;
    if (title && title.includes('-')) {
      return title.split('-')[0].trim();
    }
    return 'Budget';
  }

  /**
   * Escape HTML to prevent XSS
   * @param {string} text - String to escape
   * @returns {string} Escaped string
   */
  function escapeHtml(text) {
    if (typeof Sanitizer !== 'undefined' && Sanitizer.escapeHTML) {
      return Sanitizer.escapeHTML(text);
    }
    if (!text || typeof text !== 'string') return '';
    return text
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  /**
   * Return the complete CSS styles for the interactive report
   * @returns {string} CSS string
   */
  function getReportStyles() {
    return '\n' +
    '*, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }\n' +
    'body {\n' +
    '  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;\n' +
    '  background: #f3f4f6; color: #1f2937; min-height: 100vh; line-height: 1.5;\n' +
    '}\n' +
    '\n' +
    '/* Toolbar */\n' +
    '.report-toolbar {\n' +
    '  position: sticky; top: 0; z-index: 100; background: white;\n' +
    '  box-shadow: 0 1px 3px rgba(0,0,0,0.1); padding: 12px 24px;\n' +
    '  display: flex; flex-wrap: wrap; align-items: center; gap: 10px;\n' +
    '}\n' +
    '.report-toolbar .toolbar-section { display: flex; align-items: center; gap: 6px; }\n' +
    '.report-toolbar input[type="text"],\n' +
    '.report-toolbar input[type="number"] {\n' +
    '  padding: 6px 10px; border: 1px solid #d1d5db; border-radius: 6px;\n' +
    '  font-size: 13px; outline: none; transition: border-color 0.15s;\n' +
    '}\n' +
    '.report-toolbar input[type="text"]:focus,\n' +
    '.report-toolbar input[type="number"]:focus { border-color: #06b6d4; }\n' +
    '.report-toolbar input[type="text"] { width: 200px; }\n' +
    '.report-toolbar input[type="number"] { width: 100px; }\n' +
    '\n' +
    '/* Chips */\n' +
    '.chip {\n' +
    '  display: inline-flex; align-items: center; padding: 4px 10px;\n' +
    '  border-radius: 9999px; font-size: 12px; font-weight: 500;\n' +
    '  cursor: pointer; border: 1px solid transparent; transition: all 0.15s;\n' +
    '  user-select: none;\n' +
    '}\n' +
    '.chip.active { opacity: 1; }\n' +
    '.chip.inactive { opacity: 0.4; }\n' +
    '.chip-all { background: #f3f4f6; color: #374151; border-color: #d1d5db; }\n' +
    '.chip-all.active { background: #374151; color: white; }\n' +
    '.chip-added { background: #f0fdf4; color: #166534; border-color: #bbf7d0; }\n' +
    '.chip-added.active { background: #22c55e; color: white; }\n' +
    '.chip-removed { background: #fef2f2; color: #991b1b; border-color: #fecaca; }\n' +
    '.chip-removed.active { background: #ef4444; color: white; }\n' +
    '.chip-modified { background: #fefce8; color: #854d0e; border-color: #fef08a; }\n' +
    '.chip-modified.active { background: #eab308; color: white; }\n' +
    '.chip-unchanged { background: #f9fafb; color: #6b7280; border-color: #e5e7eb; }\n' +
    '.chip-unchanged.active { background: #6b7280; color: white; }\n' +
    '\n' +
    '/* Buttons */\n' +
    '.btn {\n' +
    '  padding: 6px 12px; border-radius: 6px; border: 1px solid #d1d5db;\n' +
    '  background: white; color: #374151; font-size: 12px; font-weight: 500;\n' +
    '  cursor: pointer; transition: all 0.15s; white-space: nowrap;\n' +
    '}\n' +
    '.btn:hover { background: #f9fafb; border-color: #9ca3af; }\n' +
    '.btn.active { background: #06b6d4; color: white; border-color: #06b6d4; }\n' +
    '.btn-icon { padding: 6px 8px; }\n' +
    '\n' +
    '/* Dropdown */\n' +
    '.dropdown-wrap { position: relative; display: inline-block; }\n' +
    '.dropdown-panel {\n' +
    '  display: none; position: absolute; top: 100%; left: 0; z-index: 110;\n' +
    '  background: white; border: 1px solid #d1d5db; border-radius: 8px;\n' +
    '  box-shadow: 0 4px 12px rgba(0,0,0,0.1); padding: 8px 0;\n' +
    '  min-width: 200px; max-height: 300px; overflow-y: auto;\n' +
    '}\n' +
    '.dropdown-panel.open { display: block; }\n' +
    '.dropdown-item {\n' +
    '  padding: 6px 12px; font-size: 13px; cursor: pointer;\n' +
    '  display: flex; align-items: center; gap: 8px;\n' +
    '}\n' +
    '.dropdown-item:hover { background: #f3f4f6; }\n' +
    '.dropdown-item input[type="checkbox"] {\n' +
    '  width: 14px; height: 14px; accent-color: #06b6d4; cursor: pointer;\n' +
    '}\n' +
    '\n' +
    '/* Container */\n' +
    '.report-container { max-width: 1200px; margin: 0 auto; padding: 24px; }\n' +
    '\n' +
    '/* Header */\n' +
    '.report-header {\n' +
    '  background: white; border-radius: 10px; box-shadow: 0 1px 3px rgba(0,0,0,0.08);\n' +
    '  padding: 24px; margin-bottom: 20px;\n' +
    '}\n' +
    '.report-header h1 { font-size: 22px; font-weight: 700; color: #111827; margin-bottom: 4px; }\n' +
    '.report-header .subtitle { font-size: 15px; color: #6b7280; }\n' +
    '.date-range {\n' +
    '  display: flex; align-items: center; gap: 10px; margin-top: 12px;\n' +
    '  font-size: 13px; color: #6b7280;\n' +
    '}\n' +
    '.date-badge {\n' +
    '  background: #f3f4f6; padding: 4px 12px; border-radius: 4px; font-weight: 500;\n' +
    '}\n' +
    '\n' +
    '/* Summary Cards */\n' +
    '.summary-grid {\n' +
    '  display: grid; grid-template-columns: repeat(4, 1fr); gap: 16px; margin-bottom: 20px;\n' +
    '}\n' +
    '.summary-card {\n' +
    '  background: white; border-radius: 10px; box-shadow: 0 1px 3px rgba(0,0,0,0.08);\n' +
    '  padding: 18px; text-align: center; cursor: pointer; transition: all 0.15s;\n' +
    '  border: 2px solid transparent;\n' +
    '}\n' +
    '.summary-card:hover { box-shadow: 0 4px 12px rgba(0,0,0,0.1); }\n' +
    '.summary-card.selected { border-color: #06b6d4; }\n' +
    '.summary-card .card-value { font-size: 26px; font-weight: 700; }\n' +
    '.summary-card .card-value.green { color: #16a34a; }\n' +
    '.summary-card .card-value.red { color: #dc2626; }\n' +
    '.summary-card .card-label { font-size: 13px; color: #6b7280; margin-top: 4px; }\n' +
    '.summary-card .card-sub { font-size: 11px; color: #9ca3af; margin-top: 4px; }\n' +
    '.mini-stats {\n' +
    '  display: grid; grid-template-columns: repeat(3, 1fr); gap: 16px;\n' +
    '  background: white; border-radius: 10px; box-shadow: 0 1px 3px rgba(0,0,0,0.08);\n' +
    '  padding: 16px; margin-bottom: 20px; text-align: center;\n' +
    '}\n' +
    '.mini-stats .mini-val { font-size: 20px; font-weight: 600; color: #374151; }\n' +
    '.mini-stats .mini-lbl { font-size: 12px; color: #6b7280; }\n' +
    '\n' +
    '/* Table */\n' +
    '.report-table-wrap {\n' +
    '  background: white; border-radius: 10px; box-shadow: 0 1px 3px rgba(0,0,0,0.08);\n' +
    '  overflow: hidden;\n' +
    '}\n' +
    '.report-table { width: 100%; border-collapse: collapse; table-layout: fixed; }\n' +
    '.report-table th {\n' +
    '  padding: 10px 12px; font-size: 12px; font-weight: 600; color: #6b7280;\n' +
    '  text-align: left; border-bottom: 2px solid #e5e7eb; background: #fafafa;\n' +
    '  cursor: pointer; user-select: none; white-space: nowrap;\n' +
    '}\n' +
    '.report-table th:hover { color: #111827; }\n' +
    '.report-table th .sort-arrow { font-size: 10px; margin-left: 4px; }\n' +
    '.report-table th .sort-arrow.active { color: #06b6d4; }\n' +
    '.report-table td {\n' +
    '  padding: 8px 12px; font-size: 13px; border-bottom: 1px solid #f3f4f6;\n' +
    '  vertical-align: top;\n' +
    '}\n' +
    '.report-table td.num { text-align: right; font-variant-numeric: tabular-nums; }\n' +
    '.report-table .col-type { width: 80px; }\n' +
    '.report-table .col-name { width: auto; }\n' +
    '.report-table .col-num { width: 90px; }\n' +
    '.report-table .col-desc-hint { font-size: 11px; color: #9ca3af; font-style: italic; margin-top: 2px; }\n' +
    '.report-table td.delta-pos { color: #16a34a; font-weight: 500; text-align: right; }\n' +
    '.report-table td.delta-neg { color: #dc2626; font-weight: 500; text-align: right; }\n' +
    '.report-table td.delta-zero { color: #9ca3af; text-align: right; }\n' +
    '\n' +
    '/* Row types */\n' +
    '.row-added { background: #f0fdf4; }\n' +
    '.row-added:hover { background: #dcfce7; }\n' +
    '.row-removed { background: #fef2f2; }\n' +
    '.row-removed:hover { background: #fee2e2; }\n' +
    '.row-modified { background: #fefce8; }\n' +
    '.row-modified:hover { background: #fef9c3; }\n' +
    '.row-unchanged { background: white; }\n' +
    '.row-unchanged:hover { background: #f9fafb; }\n' +
    '\n' +
    '/* Type badge */\n' +
    '.type-badge {\n' +
    '  display: inline-block; padding: 1px 6px; border-radius: 4px;\n' +
    '  font-size: 10px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.5px;\n' +
    '}\n' +
    '.type-badge.added { background: #dcfce7; color: #166534; }\n' +
    '.type-badge.removed { background: #fee2e2; color: #991b1b; }\n' +
    '.type-badge.modified { background: #fef9c3; color: #854d0e; }\n' +
    '.type-badge.unchanged { background: #f3f4f6; color: #6b7280; }\n' +
    '\n' +
    '/* Group headers */\n' +
    '.group-header {\n' +
    '  cursor: pointer; user-select: none;\n' +
    '}\n' +
    '.group-header td {\n' +
    '  background: #f9fafb; font-weight: 600; font-size: 13px;\n' +
    '  padding: 10px 12px; border-bottom: 1px solid #e5e7eb;\n' +
    '}\n' +
    '.group-header:hover td { background: #f3f4f6; }\n' +
    '.group-header .caret {\n' +
    '  display: inline-block; width: 16px; transition: transform 0.15s;\n' +
    '  font-size: 12px; color: #9ca3af;\n' +
    '}\n' +
    '.group-header .caret.collapsed { transform: rotate(-90deg); }\n' +
    '.group-item.group-collapsed { display: none; }\n' +
    '.detail-row.group-collapsed { display: none; }\n' +
    '\n' +
    '/* Expanded row detail */\n' +
    '.detail-row td { padding: 12px 16px; background: #fafafa; }\n' +
    '.detail-content {\n' +
    '  display: grid; grid-template-columns: 1fr 1fr; gap: 12px; font-size: 13px;\n' +
    '}\n' +
    '.detail-content .detail-label { font-weight: 500; color: #6b7280; }\n' +
    '.detail-content .detail-value { color: #1f2937; }\n' +
    '.changes-list { margin-top: 8px; }\n' +
    '.change-entry {\n' +
    '  display: flex; align-items: center; gap: 8px; margin-bottom: 4px;\n' +
    '  font-size: 13px;\n' +
    '}\n' +
    '.change-entry .field-name { font-weight: 500; color: #374151; min-width: 100px; }\n' +
    '.change-entry .old-val { color: #dc2626; text-decoration: line-through; }\n' +
    '.change-entry .arrow { color: #9ca3af; }\n' +
    '.change-entry .new-val { color: #16a34a; font-weight: 500; }\n' +
    '\n' +
    '/* Word diff */\n' +
    '.diff-del {\n' +
    '  background: #fee2e2; color: #991b1b; text-decoration: line-through;\n' +
    '  padding: 0 2px; border-radius: 2px;\n' +
    '}\n' +
    '.diff-add {\n' +
    '  background: #dcfce7; color: #166534; text-decoration: underline;\n' +
    '  padding: 0 2px; border-radius: 2px;\n' +
    '}\n' +
    '.desc-diff { line-height: 1.8; }\n' +
    '\n' +
    '/* No changes */\n' +
    '.no-changes {\n' +
    '  text-align: center; padding: 60px 24px;\n' +
    '  background: white; border-radius: 10px; box-shadow: 0 1px 3px rgba(0,0,0,0.08);\n' +
    '}\n' +
    '.no-changes .check-icon { font-size: 48px; color: #22c55e; margin-bottom: 12px; }\n' +
    '.no-changes h2 { font-size: 20px; font-weight: 600; color: #374151; }\n' +
    '.no-changes p { color: #6b7280; margin-top: 8px; }\n' +
    '\n' +
    '/* Empty state */\n' +
    '.empty-state {\n' +
    '  text-align: center; padding: 40px; color: #9ca3af; font-size: 14px;\n' +
    '}\n' +
    '\n' +
    '/* Footer */\n' +
    '.report-footer {\n' +
    '  text-align: center; font-size: 12px; color: #9ca3af; padding: 24px 0;\n' +
    '}\n' +
    '\n' +
    '/* Clickable row */\n' +
    '.clickable-row { cursor: pointer; }\n' +
    '\n' +
    '/* Responsive */\n' +
    '@media (max-width: 768px) {\n' +
    '  .summary-grid { grid-template-columns: repeat(2, 1fr); }\n' +
    '  .report-toolbar { padding: 10px 12px; }\n' +
    '  .report-toolbar input[type="text"] { width: 140px; }\n' +
    '  .report-container { padding: 12px; }\n' +
    '  .detail-content { grid-template-columns: 1fr; }\n' +
    '}\n' +
    '\n' +
    '/* Print */\n' +
    '@media print {\n' +
    '  .report-toolbar { display: none !important; }\n' +
    '  body { background: white; -webkit-print-color-adjust: exact; print-color-adjust: exact; }\n' +
    '  .report-table-wrap, .report-header, .summary-card, .mini-stats {\n' +
    '    box-shadow: none; border: 1px solid #e5e7eb;\n' +
    '  }\n' +
    '  .group-item.group-collapsed { display: table-row !important; }\n' +
    '  .detail-row.group-collapsed { display: table-row !important; }\n' +
    '  .summary-card { break-inside: avoid; }\n' +
    '}\n';
  }

  /**
   * Render the interactive report into the #app element using real DOM manipulation.
   * This is the real JS equivalent of the old getAppScript() string.
   * @param {Object} data - Serialized report data from serializeData()
   */
  function renderReport(data) {
    const allItems = data.items;
    const summary = data.summary;
    const opts = data.options;

    const state = {
      searchQuery: '',
      activeTypes: ['added', 'removed', 'modified', 'unchanged'],
      activeGroups: [],
      threshold: 0,
      sortColumn: null,
      sortDirection: 'asc',
      collapsedGroups: {},
      viewMode: 'delta',
      expandedRows: {},
      allGroupNames: []
    };

    // Build group index
    const groupNames = extractCostGroups(allItems);
    state.allGroupNames = groupNames;
    state.activeGroups = groupNames.slice();

    // Auto-collapse if large dataset
    const totalCount = allItems.length;
    if (totalCount > 200) {
      groupNames.forEach(function(g) { state.collapsedGroups[g] = true; });
    }

    function extractCostGroups(items) {
      const set = {};
      items.forEach(function(entry) {
        const item = entry._type === 'modified' ? entry.new : entry;
        const h = item.hierarchy;
        if (h && h.length > 0) {
          set[h[0]] = true;
        }
      });
      return Object.keys(set).sort();
    }

    function getItemData(entry) {
      if (entry._type === 'modified') return entry.new;
      return entry;
    }

    function getGroupName(entry) {
      const item = getItemData(entry);
      return (item.hierarchy && item.hierarchy.length > 0) ? item.hierarchy[0] : 'Ungrouped';
    }

    function getHierarchyPath(entry) {
      const item = getItemData(entry);
      const h = item.hierarchy || [];
      return h.length > 1 ? h.slice(0, -1).join(' > ') : (h[0] || 'Root');
    }

    // ---- Filtering ----
    function applyFilters(items) {
      return items.filter(function(entry) {
        // Type filter
        if (state.activeTypes.indexOf(entry._type) === -1) return false;

        // Group filter
        const g = getGroupName(entry);
        if (state.activeGroups.indexOf(g) === -1) return false;

        // Threshold filter
        if (state.threshold > 0) {
          let costD = 0, priceD = 0;
          if (entry._type === 'added') {
            costD = entry.extendedCost || 0;
            priceD = entry.extendedPrice || 0;
          } else if (entry._type === 'removed') {
            costD = entry.extendedCost || 0;
            priceD = entry.extendedPrice || 0;
          } else if (entry._type === 'modified') {
            entry.changes.forEach(function(c) {
              if (c.field === 'extendedCost') costD = Math.abs(c.delta || 0);
              if (c.field === 'extendedPrice') priceD = Math.abs(c.delta || 0);
            });
          } else {
            return false;
          }
          if (Math.abs(costD) < state.threshold && Math.abs(priceD) < state.threshold) return false;
        }

        // Search filter
        if (state.searchQuery) {
          const q = state.searchQuery.toLowerCase();
          const item = getItemData(entry);
          const searchable = (item.name + ' ' + item.description + ' ' + item.costCode + ' ' + item.costType + ' ' + getHierarchyPath(entry)).toLowerCase();
          if (searchable.indexOf(q) === -1) return false;
        }

        return true;
      });
    }

    // ---- Grouping ----
    function groupByHierarchy(items) {
      const groups = {};
      const order = [];
      items.forEach(function(entry) {
        const g = getGroupName(entry);
        if (!groups[g]) { groups[g] = []; order.push(g); }
        groups[g].push(entry);
      });
      return { groups: groups, order: order };
    }

    // ---- Sorting ----
    function sortItems(items, col, dir) {
      if (!col) return items;
      const sorted = items.slice();
      const mult = dir === 'desc' ? -1 : 1;
      sorted.sort(function(a, b) {
        const va = getSortValue(a, col);
        const vb = getSortValue(b, col);
        if (va === vb) return 0;
        if (va === null || va === undefined) return 1;
        if (vb === null || vb === undefined) return -1;
        if (typeof va === 'string') return va.localeCompare(vb) * mult;
        return (va - vb) * mult;
      });
      return sorted;
    }

    function getSortValue(entry, col) {
      const item = getItemData(entry);
      switch (col) {
        case 'name': return item.name;
        case 'type': return entry._type;
        case 'quantity': return item.quantity;
        case 'unit': return item.unit;
        case 'unitCost': return item.unitCost;
        case 'extendedCost': return item.extendedCost;
        case 'unitPrice': return item.unitPrice;
        case 'extendedPrice': return item.extendedPrice;
        case 'costDelta': return getCostDelta(entry);
        case 'priceDelta': return getPriceDelta(entry);
        case 'costCode': return item.costCode;
        case 'costType': return item.costType;
        default: return null;
      }
    }

    function getCostDelta(entry) {
      if (entry._type === 'added') return entry.extendedCost || 0;
      if (entry._type === 'removed') return -(entry.extendedCost || 0);
      if (entry._type === 'modified') {
        for (let i = 0; i < entry.changes.length; i++) {
          if (entry.changes[i].field === 'extendedCost') return entry.changes[i].delta || 0;
        }
      }
      return 0;
    }

    function getPriceDelta(entry) {
      if (entry._type === 'added') return entry.extendedPrice || 0;
      if (entry._type === 'removed') return -(entry.extendedPrice || 0);
      if (entry._type === 'modified') {
        for (let i = 0; i < entry.changes.length; i++) {
          if (entry.changes[i].field === 'extendedPrice') return entry.changes[i].delta || 0;
        }
      }
      return 0;
    }

    // ---- Formatting ----
    function fmtCurrency(n) {
      if (n === null || n === undefined) return '-';
      const prefix = n < 0 ? '-' : '';
      const abs = Math.abs(n);
      return prefix + '$' + abs.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    }

    function fmtDelta(n) {
      if (n === null || n === undefined || n === 0) return '-';
      const prefix = n > 0 ? '+' : '';
      return prefix + fmtCurrency(n);
    }

    function fmtNum(n) {
      if (n === null || n === undefined) return '-';
      return n.toLocaleString('en-US');
    }

    function esc(text) {
      if (!text && text !== 0) return '';
      // Escape all five HTML-sensitive chars, INCLUDING quotes, so the result is
      // safe in both text and attribute contexts. The previous textContent→innerHTML
      // approach did not escape " or ', which would become an injection point if a
      // caller ever interpolated esc() output into an attr="..." value.
      return String(text)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
    }

    // ---- Word-level diff ----
    function wordDiff(oldText, newText) {
      if (!oldText && !newText) return '';
      if (!oldText) return '<span class="diff-add">' + esc(newText) + '</span>';
      if (!newText) return '<span class="diff-del">' + esc(oldText) + '</span>';
      const oldWords = oldText.split(/\s+/);
      const newWords = newText.split(/\s+/);
      const result = lcsWordDiff(oldWords, newWords);
      return result;
    }

    function lcsWordDiff(oldW, newW) {
      // Simple LCS-based word diff
      const m = oldW.length, n = newW.length;
      // For very long texts, fall back to simple diff
      if (m * n > 100000) {
        return '<span class="diff-del">' + esc(oldW.join(' ')) + '</span> <span class="diff-add">' + esc(newW.join(' ')) + '</span>';
      }
      const dp = [];
      for (let i = 0; i <= m; i++) {
        dp[i] = [];
        for (let j = 0; j <= n; j++) {
          if (i === 0 || j === 0) dp[i][j] = 0;
          else if (oldW[i - 1] === newW[j - 1]) dp[i][j] = dp[i - 1][j - 1] + 1;
          else dp[i][j] = Math.max(dp[i - 1][j], dp[i][j - 1]);
        }
      }
      // Backtrack to build diff
      const parts = [];
      let ci = m, cj = n;
      while (ci > 0 || cj > 0) {
        if (ci > 0 && cj > 0 && oldW[ci - 1] === newW[cj - 1]) {
          parts.unshift({ type: 'same', word: esc(oldW[ci - 1]) });
          ci--; cj--;
        } else if (cj > 0 && (ci === 0 || dp[ci][cj - 1] >= dp[ci - 1][cj])) {
          parts.unshift({ type: 'add', word: esc(newW[cj - 1]) });
          cj--;
        } else {
          parts.unshift({ type: 'del', word: esc(oldW[ci - 1]) });
          ci--;
        }
      }
      // Merge consecutive same-type runs
      let html = '';
      let i = 0;
      while (i < parts.length) {
        const t = parts[i].type;
        const words = [];
        while (i < parts.length && parts[i].type === t) {
          words.push(parts[i].word);
          i++;
        }
        const joined = words.join(' ');
        if (t === 'del') html += '<span class="diff-del">' + joined + '</span> ';
        else if (t === 'add') html += '<span class="diff-add">' + joined + '</span> ';
        else html += joined + ' ';
      }
      return html.trim();
    }

    // ---- DOM helpers ----
    function el(tag, attrs, children) {
      const e = document.createElement(tag);
      if (attrs) {
        Object.keys(attrs).forEach(function(k) {
          if (k === 'className') e.className = attrs[k];
          else if (k === 'textContent') e.textContent = attrs[k];
          else if (k === 'innerHTML') e.innerHTML = attrs[k];
          else if (k.indexOf('on') === 0) e.addEventListener(k.slice(2).toLowerCase(), attrs[k]);
          else e.setAttribute(k, attrs[k]);
        });
      }
      if (children) {
        if (!Array.isArray(children)) children = [children];
        children.forEach(function(c) {
          if (typeof c === 'string') e.appendChild(document.createTextNode(c));
          else if (c) e.appendChild(c);
        });
      }
      return e;
    }

    // ---- Debounce ----
    function debounce(fn, ms) {
      let timer;
      return function() {
        const ctx = this, args = arguments;
        clearTimeout(timer);
        timer = setTimeout(function() { fn.apply(ctx, args); }, ms);
      };
    }

    // ---- Open dropdown management ----
    let openDropdown = null;
    document.addEventListener('click', function(e) {
      if (openDropdown && !openDropdown.contains(e.target)) {
        const panel = openDropdown.querySelector('.dropdown-panel');
        if (panel) panel.classList.remove('open');
        openDropdown = null;
      }
    });

    // ================================================================
    // RENDER
    // ================================================================
    function render() {
      const app = document.getElementById('app');
      app.innerHTML = '';
      app.appendChild(renderToolbar());
      const container = el('div', { className: 'report-container' });
      container.appendChild(renderHeader());
      if (!data.hasChanges) {
        container.appendChild(renderNoChanges());
      } else {
        container.appendChild(renderSummary());
        container.appendChild(renderMiniStats());
        const filtered = applyFilters(allItems);
        const sorted = sortItems(filtered, state.sortColumn, state.sortDirection);
        const grouped = groupByHierarchy(sorted);
        container.appendChild(renderTable(grouped));
      }
      container.appendChild(renderFooter());
      app.appendChild(container);
    }

    // ---- Toolbar ----
    function renderToolbar() {
      const toolbar = el('div', { className: 'report-toolbar' });

      // Search
      const searchInput = el('input', {
        type: 'text', placeholder: 'Search items...',
        value: state.searchQuery
      });
      searchInput.addEventListener('input', debounce(function() {
        state.searchQuery = searchInput.value;
        renderContent();
      }, 200));
      toolbar.appendChild(searchInput);

      // Divider
      toolbar.appendChild(el('span', { textContent: '|', style: 'color:#d1d5db;margin:0 2px;' }));

      // Type chips
      const chipSection = el('div', { className: 'toolbar-section' });
      const allActive = state.activeTypes.length === 4;
      const allChip = el('span', {
        className: 'chip chip-all ' + (allActive ? 'active' : 'inactive'),
        textContent: 'All'
      });
      allChip.addEventListener('click', function() {
        state.activeTypes = ['added', 'removed', 'modified', 'unchanged'];
        renderContent();
        updateToolbarChips();
      });
      chipSection.appendChild(allChip);

      const types = [
        { key: 'added', label: 'Added', cls: 'chip-added' },
        { key: 'removed', label: 'Removed', cls: 'chip-removed' },
        { key: 'modified', label: 'Modified', cls: 'chip-modified' },
        { key: 'unchanged', label: 'Unchanged', cls: 'chip-unchanged' }
      ];
      types.forEach(function(t) {
        const isActive = state.activeTypes.indexOf(t.key) !== -1;
        const chip = el('span', {
          className: 'chip ' + t.cls + ' ' + (isActive ? 'active' : 'inactive'),
          textContent: t.label,
          'data-type': t.key
        });
        chip.addEventListener('click', function() {
          const idx = state.activeTypes.indexOf(t.key);
          if (idx !== -1) state.activeTypes.splice(idx, 1);
          else state.activeTypes.push(t.key);
          renderContent();
          updateToolbarChips();
        });
        chipSection.appendChild(chip);
      });
      toolbar.appendChild(chipSection);

      // Divider
      toolbar.appendChild(el('span', { textContent: '|', style: 'color:#d1d5db;margin:0 2px;' }));

      // Cost group dropdown
      const groupDD = el('div', { className: 'dropdown-wrap' });
      const groupBtn = el('button', { className: 'btn', textContent: 'Groups (' + state.activeGroups.length + ')' });
      groupBtn.addEventListener('click', function(e) {
        e.stopPropagation();
        const p = groupDD.querySelector('.dropdown-panel');
        const isOpen = p.classList.contains('open');
        if (openDropdown && openDropdown !== groupDD) {
          openDropdown.querySelector('.dropdown-panel').classList.remove('open');
        }
        p.classList.toggle('open');
        openDropdown = isOpen ? null : groupDD;
      });
      groupDD.appendChild(groupBtn);
      const groupPanel = el('div', { className: 'dropdown-panel' });
      // Select All / Clear All
      const selectAllItem = el('div', { className: 'dropdown-item', style: 'font-weight:600;border-bottom:1px solid #e5e7eb;margin-bottom:4px;padding-bottom:8px;' });
      const selectAllLink = el('span', { textContent: 'Select All', style: 'color:#06b6d4;cursor:pointer;margin-right:12px;' });
      selectAllLink.addEventListener('click', function(e) {
        e.stopPropagation();
        state.activeGroups = state.allGroupNames.slice();
        renderContent();
        updateGroupDropdown(groupPanel, groupBtn);
      });
      const clearAllLink = el('span', { textContent: 'Clear All', style: 'color:#ef4444;cursor:pointer;' });
      clearAllLink.addEventListener('click', function(e) {
        e.stopPropagation();
        state.activeGroups = [];
        renderContent();
        updateGroupDropdown(groupPanel, groupBtn);
      });
      selectAllItem.appendChild(selectAllLink);
      selectAllItem.appendChild(clearAllLink);
      groupPanel.appendChild(selectAllItem);
      state.allGroupNames.forEach(function(g) {
        const item = el('label', { className: 'dropdown-item' });
        const cb = el('input', { type: 'checkbox' });
        cb.checked = state.activeGroups.indexOf(g) !== -1;
        cb.addEventListener('change', function(e) {
          e.stopPropagation();
          const idx = state.activeGroups.indexOf(g);
          if (cb.checked && idx === -1) state.activeGroups.push(g);
          else if (!cb.checked && idx !== -1) state.activeGroups.splice(idx, 1);
          groupBtn.textContent = 'Groups (' + state.activeGroups.length + ')';
          renderContent();
        });
        item.appendChild(cb);
        item.appendChild(document.createTextNode(g));
        groupPanel.appendChild(item);
      });
      groupDD.appendChild(groupPanel);
      toolbar.appendChild(groupDD);

      // Threshold
      const threshInput = el('input', {
        type: 'number', placeholder: 'Min $ change', min: '0', step: '1',
        value: state.threshold > 0 ? String(state.threshold) : ''
      });
      threshInput.addEventListener('input', debounce(function() {
        state.threshold = parseFloat(threshInput.value) || 0;
        renderContent();
      }, 200));
      toolbar.appendChild(threshInput);

      // Divider
      toolbar.appendChild(el('span', { textContent: '|', style: 'color:#d1d5db;margin:0 2px;' }));

      // View toggle
      const viewSection = el('div', { className: 'toolbar-section' });
      const deltaBtn = el('button', {
        className: 'btn' + (state.viewMode === 'delta' ? ' active' : ''),
        textContent: 'Delta'
      });
      deltaBtn.addEventListener('click', function() {
        state.viewMode = 'delta';
        deltaBtn.className = 'btn active';
        sideBySideBtn.className = 'btn';
        renderContent();
      });
      const sideBySideBtn = el('button', {
        className: 'btn' + (state.viewMode === 'sideBySide' ? ' active' : ''),
        textContent: 'Side by Side'
      });
      sideBySideBtn.addEventListener('click', function() {
        state.viewMode = 'sideBySide';
        sideBySideBtn.className = 'btn active';
        deltaBtn.className = 'btn';
        renderContent();
      });
      viewSection.appendChild(deltaBtn);
      viewSection.appendChild(sideBySideBtn);
      toolbar.appendChild(viewSection);

      // Expand All / Collapse All
      const expandBtn = el('button', { className: 'btn', textContent: 'Expand All' });
      expandBtn.addEventListener('click', function() {
        state.collapsedGroups = {};
        renderContent();
      });
      toolbar.appendChild(expandBtn);
      const collapseBtn = el('button', { className: 'btn', textContent: 'Collapse All' });
      collapseBtn.addEventListener('click', function() {
        state.allGroupNames.forEach(function(g) { state.collapsedGroups[g] = true; });
        renderContent();
      });
      toolbar.appendChild(collapseBtn);

      // Divider
      toolbar.appendChild(el('span', { textContent: '|', style: 'color:#d1d5db;margin:0 2px;' }));

      // Export dropdown
      const exportDD = el('div', { className: 'dropdown-wrap' });
      const exportBtn = el('button', { className: 'btn', textContent: 'Export' });
      exportBtn.addEventListener('click', function(e) {
        e.stopPropagation();
        const p = exportDD.querySelector('.dropdown-panel');
        const isOpen = p.classList.contains('open');
        if (openDropdown && openDropdown !== exportDD) {
          openDropdown.querySelector('.dropdown-panel').classList.remove('open');
        }
        p.classList.toggle('open');
        openDropdown = isOpen ? null : exportDD;
      });
      exportDD.appendChild(exportBtn);
      const exportPanel = el('div', { className: 'dropdown-panel', style: 'min-width:120px;' });
      const csvItem = el('div', { className: 'dropdown-item', textContent: 'CSV' });
      csvItem.addEventListener('click', function() { exportCSV(); });
      const copyItem = el('div', { className: 'dropdown-item', textContent: 'Copy Summary' });
      copyItem.addEventListener('click', function() { copyToClipboard(); });
      const printItem = el('div', { className: 'dropdown-item', textContent: 'Print' });
      printItem.addEventListener('click', function() { printReport(); });
      exportPanel.appendChild(csvItem);
      exportPanel.appendChild(copyItem);
      exportPanel.appendChild(printItem);
      exportDD.appendChild(exportPanel);
      toolbar.appendChild(exportDD);

      return toolbar;
    }

    function updateToolbarChips() {
      const chips = document.querySelectorAll('.chip[data-type]');
      chips.forEach(function(c) {
        const t = c.getAttribute('data-type');
        if (state.activeTypes.indexOf(t) !== -1) {
          c.classList.remove('inactive'); c.classList.add('active');
        } else {
          c.classList.remove('active'); c.classList.add('inactive');
        }
      });
      const allChip = document.querySelector('.chip-all');
      if (allChip) {
        if (state.activeTypes.length === 4) {
          allChip.classList.remove('inactive'); allChip.classList.add('active');
        } else {
          allChip.classList.remove('active'); allChip.classList.add('inactive');
        }
      }
    }

    function updateGroupDropdown(panel, btn) {
      btn.textContent = 'Groups (' + state.activeGroups.length + ')';
      const checkboxes = panel.querySelectorAll('input[type=checkbox]');
      state.allGroupNames.forEach(function(g, i) {
        if (checkboxes[i]) checkboxes[i].checked = state.activeGroups.indexOf(g) !== -1;
      });
    }

    // ---- Partial re-render (content only, keep toolbar) ----
    function renderContent() {
      const container = document.querySelector('.report-container');
      if (!container) { render(); return; }
      // Preserve header, rebuild everything after
      const header = container.querySelector('.report-header');
      container.innerHTML = '';
      if (header) container.appendChild(header);
      else container.appendChild(renderHeader());
      if (!data.hasChanges) {
        container.appendChild(renderNoChanges());
      } else {
        container.appendChild(renderSummary());
        container.appendChild(renderMiniStats());
        const filtered = applyFilters(allItems);
        const sorted = sortItems(filtered, state.sortColumn, state.sortDirection);
        const grouped = groupByHierarchy(sorted);
        container.appendChild(renderTable(grouped));
      }
      container.appendChild(renderFooter());
    }

    // ---- Header ----
    function renderHeader() {
      const hdr = el('div', { className: 'report-header' });
      hdr.appendChild(el('h1', null, 'Budget Changelog'));
      hdr.appendChild(el('p', { className: 'subtitle' }, esc(opts.jobName)));
      const dr = el('div', { className: 'date-range' });
      dr.appendChild(el('span', { className: 'date-badge' }, esc(opts.oldDate)));
      dr.appendChild(el('span', null, '\u2192'));
      dr.appendChild(el('span', { className: 'date-badge' }, esc(opts.newDate)));
      hdr.appendChild(dr);
      return hdr;
    }

    // ---- No changes ----
    function renderNoChanges() {
      const wrap = el('div', { className: 'no-changes' });
      wrap.appendChild(el('div', { className: 'check-icon', textContent: '\u2714' }));
      wrap.appendChild(el('h2', null, 'No Changes Detected'));
      wrap.appendChild(el('p', null, 'These two budget backups are identical.'));
      return wrap;
    }

    // ---- Summary cards ----
    function renderSummary() {
      const grid = el('div', { className: 'summary-grid' });

      // Cost Change
      const costCard = el('div', { className: 'summary-card' });
      const costClass = summary.costChange >= 0 ? 'green' : 'red';
      costCard.appendChild(el('div', { className: 'card-value ' + costClass, textContent: fmtDelta(summary.costChange) }));
      costCard.appendChild(el('div', { className: 'card-label', textContent: 'Total Cost Change' }));
      costCard.appendChild(el('div', { className: 'card-sub', textContent: fmtCurrency(summary.oldTotalCost) + ' \u2192 ' + fmtCurrency(summary.newTotalCost) }));
      grid.appendChild(costCard);

      // Price Change
      const priceCard = el('div', { className: 'summary-card' });
      const priceClass = summary.priceChange >= 0 ? 'green' : 'red';
      priceCard.appendChild(el('div', { className: 'card-value ' + priceClass, textContent: fmtDelta(summary.priceChange) }));
      priceCard.appendChild(el('div', { className: 'card-label', textContent: 'Total Price Change' }));
      priceCard.appendChild(el('div', { className: 'card-sub', textContent: fmtCurrency(summary.oldTotalPrice) + ' \u2192 ' + fmtCurrency(summary.newTotalPrice) }));
      grid.appendChild(priceCard);

      // Added
      const addedCard = el('div', { className: 'summary-card' });
      addedCard.appendChild(el('div', { className: 'card-value green', textContent: '+' + summary.addedCount }));
      addedCard.appendChild(el('div', { className: 'card-label', textContent: 'Items Added' }));
      addedCard.addEventListener('click', function() {
        state.activeTypes = ['added'];
        renderContent();
        updateToolbarChips();
      });
      grid.appendChild(addedCard);

      // Removed
      const removedCard = el('div', { className: 'summary-card' });
      removedCard.appendChild(el('div', { className: 'card-value red', textContent: '-' + summary.removedCount }));
      removedCard.appendChild(el('div', { className: 'card-label', textContent: 'Items Removed' }));
      removedCard.addEventListener('click', function() {
        state.activeTypes = ['removed'];
        renderContent();
        updateToolbarChips();
      });
      grid.appendChild(removedCard);

      return grid;
    }

    // ---- Mini stats ----
    function renderMiniStats() {
      const wrap = el('div', { className: 'mini-stats' });
      const items = [
        { val: summary.modifiedCount, lbl: 'Items Modified' },
        { val: summary.unchangedCount || 0, lbl: 'Items Unchanged' },
        { val: summary.addedCount + summary.removedCount + summary.modifiedCount, lbl: 'Total Changes' }
      ];
      items.forEach(function(s) {
        const d = el('div');
        d.appendChild(el('div', { className: 'mini-val', textContent: String(s.val) }));
        d.appendChild(el('div', { className: 'mini-lbl', textContent: s.lbl }));
        wrap.appendChild(d);
      });
      return wrap;
    }

    // ---- Table ----
    function renderTable(grouped) {
      const wrap = el('div', { className: 'report-table-wrap' });
      const table = el('table', { className: 'report-table' });

      // Header
      const thead = el('thead');
      const headerRow = el('tr');
      const columns = getColumns();
      columns.forEach(function(col) {
        const th = el('th', { className: col.cls || '' });
        th.appendChild(document.createTextNode(col.label));
        if (col.sortable) {
          const arrow = el('span', { className: 'sort-arrow' + (state.sortColumn === col.key ? ' active' : '') });
          if (state.sortColumn === col.key) {
            arrow.textContent = state.sortDirection === 'asc' ? ' \u25B2' : ' \u25BC';
          } else {
            arrow.textContent = ' \u25B2';
          }
          th.appendChild(arrow);
          th.addEventListener('click', function() {
            if (state.sortColumn === col.key) {
              state.sortDirection = state.sortDirection === 'asc' ? 'desc' : 'asc';
            } else {
              state.sortColumn = col.key;
              state.sortDirection = 'asc';
            }
            renderContent();
          });
        }
        if (col.align === 'right') th.style.textAlign = 'right';
        headerRow.appendChild(th);
      });
      thead.appendChild(headerRow);
      table.appendChild(thead);

      // Body
      const tbody = el('tbody');
      if (grouped.order.length === 0) {
        const emptyRow = el('tr');
        emptyRow.appendChild(el('td', {
          colspan: String(columns.length), className: 'empty-state',
          textContent: 'No items match the current filters.'
        }));
        tbody.appendChild(emptyRow);
      } else {
        grouped.order.forEach(function(groupName) {
          const items = grouped.groups[groupName];
          const isCollapsed = !!state.collapsedGroups[groupName];

          // Group subtotals
          let groupCost = 0, groupPrice = 0;
          items.forEach(function(entry) {
            const item = getItemData(entry);
            groupCost += item.extendedCost || 0;
            groupPrice += item.extendedPrice || 0;
          });

          // Group header row
          const ghRow = el('tr', { className: 'group-header' });
          const ghCell = el('td', { colspan: String(columns.length) });
          const caret = el('span', { className: 'caret' + (isCollapsed ? ' collapsed' : ''), textContent: '\u25BC' });
          ghCell.appendChild(caret);
          ghCell.appendChild(document.createTextNode(' ' + groupName + ' (' + items.length + ' items) \u2014 Cost: ' + fmtCurrency(groupCost) + ' | Price: ' + fmtCurrency(groupPrice)));
          ghRow.appendChild(ghCell);
          ghRow.addEventListener('click', function() {
            state.collapsedGroups[groupName] = !state.collapsedGroups[groupName];
            const rows = tbody.querySelectorAll('tr[data-group="' + groupName + '"]');
            rows.forEach(function(r) {
              if (state.collapsedGroups[groupName]) {
                r.classList.add('group-collapsed');
              } else {
                r.classList.remove('group-collapsed');
              }
            });
            caret.className = 'caret' + (state.collapsedGroups[groupName] ? ' collapsed' : '');
          });
          tbody.appendChild(ghRow);

          // Render items directly in tbody (no nested table — keeps column alignment)
          items.forEach(function(entry) {
            renderItemRow(entry, tbody, columns, groupName, isCollapsed);
          });
        });
      }
      table.appendChild(tbody);
      wrap.appendChild(table);
      return wrap;
    }

    function getColumns() {
      if (state.viewMode === 'sideBySide') {
        return [
          { key: 'type', label: 'Type', sortable: true },
          { key: 'name', label: 'Name', sortable: true },
          { key: 'oldQty', label: 'Old Qty', align: 'right', sortable: false },
          { key: 'newQty', label: 'New Qty', align: 'right', sortable: false },
          { key: 'oldUnitCost', label: 'Old Unit Cost', align: 'right', sortable: false },
          { key: 'newUnitCost', label: 'New Unit Cost', align: 'right', sortable: false },
          { key: 'oldExtCost', label: 'Old Ext Cost', align: 'right', sortable: false },
          { key: 'newExtCost', label: 'New Ext Cost', align: 'right', sortable: false },
          { key: 'oldExtPrice', label: 'Old Ext Price', align: 'right', sortable: false },
          { key: 'newExtPrice', label: 'New Ext Price', align: 'right', sortable: false }
        ];
      }
      return [
        { key: 'type', label: 'Type', sortable: true, cls: 'col-type' },
        { key: 'name', label: 'Name', sortable: true, cls: 'col-name' },
        { key: 'quantity', label: 'Qty', align: 'right', sortable: true, cls: 'col-num' },
        { key: 'unit', label: 'Unit', sortable: true, cls: 'col-num' },
        { key: 'unitCost', label: 'Unit Cost', align: 'right', sortable: true, cls: 'col-num' },
        { key: 'extendedCost', label: 'Ext Cost', align: 'right', sortable: true, cls: 'col-num' },
        { key: 'unitPrice', label: 'Unit Price', align: 'right', sortable: true, cls: 'col-num' },
        { key: 'extendedPrice', label: 'Ext Price', align: 'right', sortable: true, cls: 'col-num' },
        { key: 'costDelta', label: 'Cost \u0394', align: 'right', sortable: true, cls: 'col-num' },
        { key: 'priceDelta', label: 'Price \u0394', align: 'right', sortable: true, cls: 'col-num' }
      ];
    }

    function renderItemRow(entry, tbody, columns, groupName, isCollapsed) {
      const item = getItemData(entry);
      let className = 'row-' + entry._type + ' clickable-row group-item';
      if (isCollapsed) className += ' group-collapsed';
      const tr = el('tr', { className: className, 'data-group': groupName || '' });
      const rowId = item.uniqueKey || (item.name + '_' + entry._type);

      if (state.viewMode === 'sideBySide') {
        renderSideBySideRow(tr, entry, item);
      } else {
        renderDeltaRow(tr, entry, item);
      }

      tr.addEventListener('click', function() {
        state.expandedRows[rowId] = !state.expandedRows[rowId];
        const detailRow = tr.nextElementSibling;
        if (detailRow && detailRow.classList.contains('detail-row')) {
          detailRow.remove();
        } else {
          const dr = buildDetailRow(entry, columns.length);
          tr.parentNode.insertBefore(dr, tr.nextSibling);
        }
      });
      tbody.appendChild(tr);

      // Show detail if was expanded
      if (state.expandedRows[rowId]) {
        const dr = buildDetailRow(entry, columns.length);
        if (isCollapsed) dr.classList.add('group-collapsed');
        dr.setAttribute('data-group', groupName || '');
        tbody.appendChild(dr);
      }
    }

    function renderDeltaRow(tr, entry, item) {
      // Type
      const typeCell = el('td');
      typeCell.appendChild(el('span', { className: 'type-badge ' + entry._type, textContent: entry._type }));
      tr.appendChild(typeCell);

      // Name + description change hint
      const nameCell = el('td');
      nameCell.appendChild(document.createTextNode(item.name));
      if (entry._type === 'modified' && entry.changes) {
        let descChange = null;
        for (let ci = 0; ci < entry.changes.length; ci++) {
          if (entry.changes[ci].field === 'description') {
            descChange = entry.changes[ci];
            break;
          }
        }
        if (descChange) {
          nameCell.appendChild(el('div', { className: 'col-desc-hint', textContent: '\u270E Description changed — click to view' }));
        }
      }
      tr.appendChild(nameCell);

      // Qty
      tr.appendChild(el('td', { className: 'num', textContent: fmtNum(item.quantity) }));

      // Unit
      tr.appendChild(el('td', { textContent: item.unit || '' }));

      // Unit Cost
      tr.appendChild(el('td', { className: 'num', textContent: fmtCurrency(item.unitCost) }));

      // Ext Cost
      tr.appendChild(el('td', { className: 'num', textContent: fmtCurrency(item.extendedCost) }));

      // Unit Price
      tr.appendChild(el('td', { className: 'num', textContent: fmtCurrency(item.unitPrice) }));

      // Ext Price
      tr.appendChild(el('td', { className: 'num', textContent: fmtCurrency(item.extendedPrice) }));

      // Cost Delta
      const cd = getCostDelta(entry);
      const cdClass = cd > 0 ? 'delta-pos' : cd < 0 ? 'delta-neg' : 'delta-zero';
      tr.appendChild(el('td', { className: cdClass, textContent: fmtDelta(cd) }));

      // Price Delta
      const pd = getPriceDelta(entry);
      const pdClass = pd > 0 ? 'delta-pos' : pd < 0 ? 'delta-neg' : 'delta-zero';
      tr.appendChild(el('td', { className: pdClass, textContent: fmtDelta(pd) }));
    }

    function renderSideBySideRow(tr, entry, item) {
      const oldItem = entry._type === 'modified' ? entry.old : (entry._type === 'removed' ? item : null);
      const newItem = entry._type === 'modified' ? entry.new : (entry._type === 'added' ? item : item);

      // Type
      const typeCell = el('td');
      typeCell.appendChild(el('span', { className: 'type-badge ' + entry._type, textContent: entry._type }));
      tr.appendChild(typeCell);

      // Name
      tr.appendChild(el('td', { textContent: item.name }));

      // Old Qty / New Qty
      tr.appendChild(el('td', { className: 'num', textContent: oldItem ? fmtNum(oldItem.quantity) : '-' }));
      tr.appendChild(el('td', { className: 'num', textContent: newItem ? fmtNum(newItem.quantity) : '-' }));

      // Old Unit Cost / New Unit Cost
      tr.appendChild(el('td', { className: 'num', textContent: oldItem ? fmtCurrency(oldItem.unitCost) : '-' }));
      tr.appendChild(el('td', { className: 'num', textContent: newItem ? fmtCurrency(newItem.unitCost) : '-' }));

      // Old Ext Cost / New Ext Cost
      tr.appendChild(el('td', { className: 'num', textContent: oldItem ? fmtCurrency(oldItem.extendedCost) : '-' }));
      tr.appendChild(el('td', { className: 'num', textContent: newItem ? fmtCurrency(newItem.extendedCost) : '-' }));

      // Old Ext Price / New Ext Price
      tr.appendChild(el('td', { className: 'num', textContent: oldItem ? fmtCurrency(oldItem.extendedPrice) : '-' }));
      tr.appendChild(el('td', { className: 'num', textContent: newItem ? fmtCurrency(newItem.extendedPrice) : '-' }));
    }

    function buildDetailRow(entry, colSpan) {
      const tr = el('tr', { className: 'detail-row' });
      const td = el('td', { colspan: String(colSpan) });
      const item = getItemData(entry);

      const content = el('div', { className: 'detail-content' });

      // Left: item details
      const left = el('div');
      const details = [
        { label: 'Group', value: getHierarchyPath(entry) },
        { label: 'Cost Code', value: item.costCode },
        { label: 'Cost Type', value: item.costType },
        { label: 'Taxable', value: item.taxable ? 'Yes' : 'No' }
      ];
      if (item.description) {
        details.push({ label: 'Description', value: item.description });
      }
      details.forEach(function(d) {
        if (d.value) {
          const row = el('div', { style: 'margin-bottom:4px;' });
          row.appendChild(el('span', { className: 'detail-label', textContent: d.label + ': ' }));
          row.appendChild(el('span', { className: 'detail-value', textContent: d.value }));
          left.appendChild(row);
        }
      });
      content.appendChild(left);

      // Right: changes (for modified items)
      if (entry._type === 'modified' && entry.changes) {
        const right = el('div');
        right.appendChild(el('div', { className: 'detail-label', textContent: 'Changes:', style: 'margin-bottom:6px;' }));
        const list = el('div', { className: 'changes-list' });
        entry.changes.forEach(function(change) {
          if (change.type === 'text' && change.field === 'description') {
            const descRow = el('div', { style: 'margin-bottom:8px;' });
            descRow.appendChild(el('div', { className: 'field-name', textContent: 'Description:' }));
            const diffHtml = wordDiff(change.oldValue || '', change.newValue || '');
            descRow.appendChild(el('div', { className: 'desc-diff', innerHTML: diffHtml }));
            list.appendChild(descRow);
            return;
          }
          const ce = el('div', { className: 'change-entry' });
          ce.appendChild(el('span', { className: 'field-name', textContent: change.label + ':' }));
          let oldDisplay = change.oldValue;
          let newDisplay = change.newValue;
          if (change.isCurrency) {
            oldDisplay = fmtCurrency(change.oldValue);
            newDisplay = fmtCurrency(change.newValue);
          } else if (change.type === 'boolean') {
            oldDisplay = change.oldValue ? 'Yes' : 'No';
            newDisplay = change.newValue ? 'Yes' : 'No';
          }
          if (!oldDisplay && oldDisplay !== 0) oldDisplay = '(empty)';
          ce.appendChild(el('span', { className: 'old-val', textContent: String(oldDisplay) }));
          ce.appendChild(el('span', { className: 'arrow', textContent: '\u2192' }));
          ce.appendChild(el('span', { className: 'new-val', textContent: String(newDisplay) }));
          list.appendChild(ce);
        });
        right.appendChild(list);
        content.appendChild(right);
      }

      td.appendChild(content);
      tr.appendChild(td);
      return tr;
    }

    // ---- Footer ----
    function renderFooter() {
      return el('div', { className: 'report-footer', textContent: 'Generated by JT Power Tools Budget Changelog \u2022 ' + new Date().toLocaleString() });
    }

    // ---- Export CSV ----
    function exportCSV() {
      const filtered = applyFilters(allItems);
      const sorted = sortItems(filtered, state.sortColumn, state.sortDirection);
      const rows = [['Group', 'Name', 'Type', 'Qty', 'Unit', 'Unit Cost', 'Ext Cost', 'Unit Price', 'Ext Price', 'Cost Delta', 'Price Delta', 'Description'].join(',')];
      sorted.forEach(function(entry) {
        const item = getItemData(entry);
        const g = getGroupName(entry);
        const cd = getCostDelta(entry);
        const pd = getPriceDelta(entry);
        const row = [
          csvEsc(g), csvEsc(item.name), csvEsc(entry._type),
          item.quantity != null ? item.quantity : '',
          csvEsc(item.unit || ''),
          item.unitCost != null ? item.unitCost : '',
          item.extendedCost != null ? item.extendedCost : '',
          item.unitPrice != null ? item.unitPrice : '',
          item.extendedPrice != null ? item.extendedPrice : '',
          cd, pd,
          csvEsc(item.description || '')
        ];
        rows.push(row.join(','));
      });
      const csv = rows.join('\n');
      const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'budget-changelog-' + new Date().toISOString().slice(0, 10) + '.csv';
      a.style.display = 'none';
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    }

    function csvEsc(val) {
      const s = String(val || '');
      if (s.indexOf(',') !== -1 || s.indexOf('"') !== -1 || s.indexOf('\n') !== -1) {
        return '"' + s.replace(/"/g, '""') + '"';
      }
      return s;
    }

    // ---- Copy to clipboard ----
    function copyToClipboard() {
      const lines = [];
      lines.push('BUDGET CHANGELOG');
      lines.push('Job: ' + opts.jobName);
      lines.push('Comparing: ' + opts.oldDate + ' -> ' + opts.newDate);
      lines.push('');
      lines.push('SUMMARY:');
      lines.push('  Cost Change: ' + fmtDelta(summary.costChange));
      lines.push('  Price Change: ' + fmtDelta(summary.priceChange));
      lines.push('  Added: ' + summary.addedCount + ' | Removed: ' + summary.removedCount + ' | Modified: ' + summary.modifiedCount);
      lines.push('');

      const filtered = applyFilters(allItems);
      filtered.forEach(function(entry) {
        const item = getItemData(entry);
        const prefix = entry._type === 'added' ? '+' : entry._type === 'removed' ? '-' : '~';
        lines.push(prefix + ' ' + item.name + ' (' + entry._type + ')');
        if (item.extendedCost != null) lines.push('    Cost: ' + fmtCurrency(item.extendedCost));
        if (item.extendedPrice != null) lines.push('    Price: ' + fmtCurrency(item.extendedPrice));
      });

      const text = lines.join('\n');
      navigator.clipboard.writeText(text).then(function() {
        showToast('Summary copied to clipboard!');
      }).catch(function() {
        // Fallback
        const ta = document.createElement('textarea');
        ta.value = text; ta.style.position = 'fixed'; ta.style.opacity = '0';
        document.body.appendChild(ta); ta.select();
        try { document.execCommand('copy'); showToast('Summary copied!'); }
        catch (e) { showToast('Copy failed'); }
        document.body.removeChild(ta);
      });
    }

    function showToast(msg) {
      const existing = document.querySelector('.report-toast');
      if (existing) existing.remove();
      const toast = el('div', {
        className: 'report-toast',
        textContent: msg,
        style: 'position:fixed;bottom:24px;right:24px;background:#374151;color:white;padding:10px 20px;border-radius:8px;font-size:14px;box-shadow:0 4px 12px rgba(0,0,0,0.15);z-index:9999;transition:opacity 0.3s;'
      });
      document.body.appendChild(toast);
      setTimeout(function() { toast.style.opacity = '0'; }, 2000);
      setTimeout(function() { toast.remove(); }, 2500);
    }

    // ---- Print ----
    function printReport() {
      // Expand all groups temporarily
      const savedCollapsed = JSON.parse(JSON.stringify(state.collapsedGroups));
      state.collapsedGroups = {};
      renderContent();
      setTimeout(function() {
        window.print();
        // Restore
        state.collapsedGroups = savedCollapsed;
        renderContent();
      }, 100);
    }

    // ---- Initial render ----
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', render);
    } else {
      render();
    }
  }

  return {
    generate: generate,
    serializeData: serializeData,
    getReportStyles: getReportStyles,
    renderReport: renderReport
  };
})();

// Export for use in other modules
if (typeof window !== 'undefined') {
  window.BudgetReportApp = BudgetReportApp;
}
