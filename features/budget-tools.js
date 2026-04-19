/**
 * Budget Tools
 * Injects selection totals into the MASS BUDGET ACTIONS panel when budget rows
 * are selected. Dynamically reads column headers so it works regardless of which
 * columns the user has configured.
 *
 * Handles JobTread's lazy/virtual row loading: a persistent selectionMap tracks
 * each selected row's cost/price by row-number key. Visible rows update the map;
 * unloaded rows stay in the map until they reappear without selection.
 */
const BudgetTools = (() => {
  let isActive = false;
  let observer = null;
  let debounceTimer = null;
  let injectedPanel = null;
  let clickHandler = null;
  // Guards the body-subtree observer against reacting to mutations we cause
  // ourselves (rendering into injectedPanel). Without it, every render queues
  // another scheduleUpdate — a debounced reflow loop on any page activity.
  let isUpdating = false;

  // Persists cost/price across lazy row unloads.
  // Key: row number string (e.g. "42"). Value: { cost, price, isTbd }
  const selectionMap = new Map();

  // Columns we already sum elsewhere (Cost/Price in the main panel) or that
  // aren't number-typed. Detection skips these — anything NOT in this set is
  // a candidate for number-custom-field classification.
  const BUILTIN_COLUMN_LABELS = new Set([
    'Line Item',
    'Name',
    'Description',
    'Cost Code',
    'Cost Type',
    'Quantity',
    'Unit',
    'Unit Cost',
    'Unit Price',
    'Cost',
    'Price',
    'Extended Cost',
    'Extended Price',
    'Profit',
    'Margin',
    'Retainage',
    'Tax',
    'Status',
  ]);

  // Cached number-custom-field classification. Invalidates when the set of
  // header labels changes (user adds/removes/renames a column).
  // Shape: { signature: string, fields: [{ name: string, colIndex: number }] }
  let numberCustomFieldsCache = { signature: null, fields: [] };

  // ─── Helpers ──────────────────────────────────────────────────────────────

  function isBudgetPage() {
    return window.location.pathname.match(/\/jobs\/[^/]+\/budget/);
  }

  /**
   * Find the Mass Budget Actions panel's scrollable content area.
   * The panel root is: div.z-30.absolute.right-0
   * The content area is the overflow-y-auto div inside it.
   */
  function findPanelContentArea() {
    const panels = document.querySelectorAll('div.z-30.absolute.right-0');
    for (const panel of panels) {
      if (panel.textContent?.toLowerCase().includes('mass budget actions')) {
        return panel.querySelector('.overflow-y-auto') || null;
      }
    }
    return null;
  }

  /**
   * Build a map of column name → child index from the budget header row.
   * The header row is a .flex.min-w-max without any textareas whose child
   * cells include at least one known built-in column label. We match on
   * cell-level text (not whole-row textContent) and accept any builtin —
   * not just "Extended Cost" — so budgets without that specific column
   * still get column detection (and therefore custom-field detection).
   */
  function getColumnIndices() {
    const headerRow = Array.from(document.querySelectorAll('.flex.min-w-max')).find(r => {
      if (r.querySelector('textarea')) return false;
      return Array.from(r.children).some(c =>
        BUILTIN_COLUMN_LABELS.has(c.innerText?.trim())
      );
    });
    if (!headerRow) return {};

    const map = {};
    Array.from(headerRow.children).forEach((cell, i) => {
      const t = cell.innerText?.trim();
      if (t) map[t] = i;
    });
    return map;
  }

  /**
   * Detect which non-built-in columns are number-typed custom fields.
   *
   * Heuristic: for each header label NOT in BUILTIN_COLUMN_LABELS,
   * sample up to the first 3 loaded non-group rows. A column is classified
   * as "number" when:
   *   - ≥1 sample row has an <input> with class `text-right` whose value
   *     parses as a finite number, AND
   *   - no sample row has a non-empty input that fails the above check
   *
   * Results are cached by header-signature so repeated sync cycles don't
   * re-scan the DOM.
   *
   * @param {Record<string, number>} colIndices - label → column-child-index map
   * @returns {Array<{name: string, colIndex: number}>}
   */
  function detectNumberCustomFields(colIndices) {
    const entries = Object.entries(colIndices).sort(([a], [b]) => a.localeCompare(b));
    const signature = entries.map(([k, v]) => `${k}:${v}`).join('|');
    if (numberCustomFieldsCache.signature === signature) {
      return numberCustomFieldsCache.fields;
    }

    const candidates = entries.filter(([name]) => !BUILTIN_COLUMN_LABELS.has(name));
    if (candidates.length === 0) {
      numberCustomFieldsCache = { signature, fields: [] };
      return [];
    }

    // Collect first 3 loaded, non-group rows for sampling
    const allRows = Array.from(document.querySelectorAll('.flex.min-w-max'));
    const sampleRows = [];
    for (const row of allRows) {
      if (sampleRows.length >= 3) break;
      if (getRowKey(row) && !isGroupRow(row)) sampleRows.push(row);
    }

    const fields = [];
    for (const [name, colIndex] of candidates) {
      let voteYes = 0;
      let disqualified = false;

      for (const row of sampleRows) {
        const cell = row.children[colIndex];
        if (!cell) continue;
        const input = cell.querySelector('input');
        if (!input) continue; // abstain — cell has no input
        const raw = input.value;
        if (raw === '' || raw == null) continue; // empty — abstain
        const hasTextRight = input.classList.contains('text-right');
        const parsed = parseFloat(raw);
        if (hasTextRight && Number.isFinite(parsed)) {
          voteYes++;
        } else {
          disqualified = true;
          break;
        }
      }

      if (!disqualified && voteYes >= 1) {
        fields.push({ name, colIndex });
      }
    }

    numberCustomFieldsCache = { signature, fields };
    return fields;
  }

  /**
   * Stable key for a line item row — the row number shown in the leftmost cell.
   * This survives lazy unload/reload since the row number is tied to data position.
   */
  function getRowKey(row) {
    const numText = row.children[0]?.innerText?.trim();
    return numText && /^\d+$/.test(numText) ? numText : null;
  }

  /**
   * Check if a row is a group row (any nesting level).
   * Groups have TWO [role="button"] elements in the name cell:
   *   1. The expand/collapse chevron
   *   2. The 3-dot context menu
   * Line items only have ONE [role="button"] (the 3-dot menu).
   */
  function isGroupRow(row) {
    const nameCell = row.children[1];
    if (!nameCell) return true;
    const roleButtons = nameCell.querySelectorAll('[role="button"]');
    return roleButtons.length >= 2;
  }

  /**
   * Sync visible rows into selectionMap. Persistent map survives lazy scroll
   * unloads. Groups are always excluded (their totals are sums of children).
   *
   * - Visible + selected item   → upsert with current values
   * - Visible + deselected item → remove (user deselected)
   * - Visible + group (any)     → remove if present (never count groups)
   * - Not in DOM                → leave in map (lazy-unloaded, still selected)
   */
  function syncSelectionMap(colIndices) {
    const numberCustomFields = detectNumberCustomFields(colIndices);
    const allVisibleRows = document.querySelectorAll('.flex.min-w-max');

    for (const row of allVisibleRows) {
      const key = getRowKey(row);
      if (!key) continue;

      // Always remove groups from the map — they're aggregate rows
      if (isGroupRow(row)) {
        selectionMap.delete(key);
        continue;
      }

      // classList.contains is safe for both HTML and SVG elements; c.className
      // on an SVG element is a SVGAnimatedString (not a string), so
      // c.className?.includes would silently skip SVG children.
      const isSelected = Array.from(row.children).some(c => c.classList?.contains?.('bg-blue-100'));

      if (isSelected) {
        const costRaw = getCellValue(row.children[colIndices['Extended Cost']]);
        const priceRaw = getCellValue(row.children[colIndices['Extended Price']]);

        const custom = {};
        for (const { name, colIndex } of numberCustomFields) {
          const raw = getCellValue(row.children[colIndex]);
          if (raw === '') continue;
          const parsed = parseFloat(raw);
          if (Number.isFinite(parsed)) custom[name] = parsed;
        }

        selectionMap.set(key, {
          cost: parseCurrency(costRaw),
          price: parseCurrency(priceRaw),
          isTbd: costRaw === 'TBD',
          custom,
        });
      } else {
        // Visible but not selected — user deselected, not a lazy unload
        selectionMap.delete(key);
      }
    }
  }

  /**
   * Get the display value from a budget cell — checks input.value first (cells
   * use <input> elements), then falls back to innerText.
   */
  function getCellValue(cell) {
    if (!cell) return '';
    const input = cell.querySelector('input');
    if (input) return input.value?.trim() ?? '';
    return cell.innerText?.trim() ?? '';
  }

  /** Parse a currency string like "$2,392.40" or "-$250.00" to a number. */
  function parseCurrency(str) {
    if (!str) return null;
    const trimmed = str.trim();
    if (!trimmed || trimmed === 'TBD' || trimmed === '—' || trimmed === '-') return null;
    const cleaned = trimmed.replace(/[$,\s]/g, '');
    const val = parseFloat(cleaned);
    return isNaN(val) ? null : val;
  }

  /** Format a number as a currency string, e.g. 12345.67 → "$12,345.67". */
  function formatCurrency(val) {
    const abs = Math.abs(val);
    const formatted = abs.toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
    return (val < 0 ? '-$' : '$') + formatted;
  }

  /**
   * Format a number for display in custom-field rows. Uses locale thousands
   * separators and caps fractional digits at 4 to avoid floating-point noise
   * (0.1 + 0.2 = 0.30000000000000004 → "0.3").
   */
  function formatNumber(n) {
    if (!Number.isFinite(n)) return String(n);
    return n.toLocaleString('en-US', { maximumFractionDigits: 4 });
  }

  // ─── Theme detection ─────────────────────────────────────────────────────

  function getThemeColors() {
    const isDark = document.getElementById('jt-dark-mode-styles') !== null;
    const isCustom = document.getElementById('jt-custom-theme-styles') !== null;

    if (isCustom) {
      const s = getComputedStyle(document.documentElement);
      const get = (v, fb) => s.getPropertyValue(v).trim() || fb;
      return {
        bg:        get('--jt-theme-background-elevated', '#fafafa'),
        border:    get('--jt-theme-border', '#e5e7eb'),
        heading:   get('--jt-theme-text-muted', '#6b7280'),
        secondary: get('--jt-theme-text-secondary', '#9ca3af'),
        text:      get('--jt-theme-text', '#374151'),
        profit:    '#16a34a',
        loss:      '#dc2626'
      };
    }

    if (isDark) {
      return {
        bg:        '#252525',
        border:    '#404040',
        heading:   '#a0a0a0',
        secondary: '#707070',
        text:      '#e0e0e0',
        profit:    '#4ade80',
        loss:      '#f87171'
      };
    }

    // Light mode defaults
    return {
      bg:        '#fafafa',
      border:    '#e5e7eb',
      heading:   '#6b7280',
      secondary: '#9ca3af',
      text:      '#374151',
      profit:    '#16a34a',
      loss:      '#dc2626'
    };
  }

  // ─── DOM building ─────────────────────────────────────────────────────────

  function buildTotalsEl() {
    const t = getThemeColors();
    const el = document.createElement('div');
    el.className = 'jt-budget-tools-totals';
    el.style.cssText = [
      'padding: 12px 16px',
      `border-bottom: 1px solid ${t.border}`,
      `background: ${t.bg}`,
    ].join(';');
    return el;
  }

  function renderTotals(el, colIndices) {
    // Sum in integer cents to avoid floating-point drift across thousands of
    // rows — a budget totalling $1M+ summed from raw $0.10+$0.20 floats could
    // otherwise display cents that are off by a penny, and Profit / Margin
    // are derived from these sums.
    let totalCostCents = 0, totalPriceCents = 0;
    let countWithCost = 0, countWithPrice = 0, tbdCount = 0;
    const hasCost = colIndices['Extended Cost'] !== undefined;
    const hasPrice = colIndices['Extended Price'] !== undefined;

    for (const { cost, price, isTbd } of selectionMap.values()) {
      if (hasCost) {
        if (cost !== null) { totalCostCents += Math.round(cost * 100); countWithCost++; }
        else if (isTbd) tbdCount++;
      }
      if (hasPrice && price !== null) { totalPriceCents += Math.round(price * 100); countWithPrice++; }
    }

    const totalCost = totalCostCents / 100;
    const totalPrice = totalPriceCents / 100;
    const count = selectionMap.size;
    const profit = (totalPriceCents - totalCostCents) / 100;
    const margin = totalPriceCents > 0 ? ((totalPriceCents - totalCostCents) / totalPriceCents * 100) : 0;
    const t = getThemeColors();

    el.innerHTML = '';

    // Update container colors in case theme changed since buildTotalsEl()
    el.style.borderBottom = `1px solid ${t.border}`;
    el.style.background = t.bg;

    // Header
    const header = document.createElement('div');
    header.style.cssText = `font-size:11px;font-weight:700;color:${t.heading};text-transform:uppercase;letter-spacing:0.05em;margin-bottom:8px;`;
    header.textContent = 'Selection Totals';
    el.appendChild(header);

    // Item count
    const countEl = document.createElement('div');
    countEl.style.cssText = `font-size:12px;color:${t.secondary};margin-bottom:8px;`;
    const tbdNote = tbdCount > 0 ? ` (${tbdCount} TBD)` : '';
    countEl.textContent = `${count} visible item${count !== 1 ? 's' : ''} counted${tbdNote} — scroll to count more`;
    el.appendChild(countEl);

    // Money rows (Extended Cost, Extended Price, Profit)
    const dataRows = [];
    if (hasCost && countWithCost > 0) {
      dataRows.push({ label: 'Extended Cost', value: formatCurrency(totalCost), color: null });
    }
    if (hasPrice && countWithPrice > 0) {
      dataRows.push({ label: 'Extended Price', value: formatCurrency(totalPrice), color: null });
    }
    if (hasCost && hasPrice && countWithCost > 0 && countWithPrice > 0) {
      dataRows.push({
        label: 'Profit',
        value: `${formatCurrency(profit)} (${margin.toFixed(1)}%)`,
        color: profit >= 0 ? t.profit : t.loss,
        border: true
      });
    }

    // Aggregate number custom fields across the persisted selection. Computed
    // before the empty-state check so custom-field totals render even when
    // Cost/Price columns aren't visible (or all rows are TBD).
    const customSums = Object.create(null);
    for (const entry of selectionMap.values()) {
      if (!entry.custom) continue;
      for (const [name, val] of Object.entries(entry.custom)) {
        customSums[name] = (customSums[name] ?? 0) + val;
      }
    }
    const customNames = Object.keys(customSums);

    if (dataRows.length === 0 && customNames.length === 0) {
      const empty = document.createElement('div');
      empty.style.cssText = `font-size:12px;color:${t.secondary};`;
      empty.textContent = 'No cost/price data available for selected rows.';
      el.appendChild(empty);
      return;
    }

    if (dataRows.length > 0) {
      const grid = document.createElement('div');
      grid.style.cssText = 'display:flex;flex-direction:column;gap:4px;';

      for (const row of dataRows) {
        const rowEl = document.createElement('div');
        rowEl.style.cssText = 'display:flex;justify-content:space-between;align-items:baseline;' +
          (row.border ? `border-top:1px solid ${t.border};padding-top:5px;margin-top:1px;` : '');

        const label = document.createElement('span');
        label.style.cssText = `font-size:12px;color:${t.heading};`;
        label.textContent = row.label;

        const value = document.createElement('span');
        value.style.cssText = `font-size:12px;font-weight:600;color:${row.color || t.text};`;
        value.textContent = row.value;

        rowEl.appendChild(label);
        rowEl.appendChild(value);
        grid.appendChild(rowEl);
      }

      el.appendChild(grid);
    }

    if (customNames.length > 0) {
      const section = document.createElement('div');
      // Only draw the separator when there's a money-rows section above to
      // separate from — otherwise the divider floats under the header.
      section.style.cssText = dataRows.length > 0
        ? `margin-top:10px;padding-top:8px;border-top:1px solid ${t.border};`
        : '';

      const subheader = document.createElement('div');
      subheader.style.cssText =
        `font-size:11px;font-weight:700;color:${t.heading};` +
        `text-transform:uppercase;letter-spacing:0.05em;margin-bottom:6px;`;
      subheader.textContent = 'Custom Fields';
      section.appendChild(subheader);

      const customGrid = document.createElement('div');
      customGrid.style.cssText = 'display:flex;flex-direction:column;gap:4px;';

      // Sort alphabetically for stable display order across cycles
      for (const name of customNames.sort()) {
        const rowEl = document.createElement('div');
        rowEl.style.cssText = 'display:flex;justify-content:space-between;align-items:baseline;';

        const label = document.createElement('span');
        label.style.cssText = `font-size:12px;color:${t.heading};`;
        label.textContent = name;

        const value = document.createElement('span');
        value.style.cssText = `font-size:12px;font-weight:600;color:${t.text};`;
        value.textContent = formatNumber(customSums[name]);

        rowEl.appendChild(label);
        rowEl.appendChild(value);
        customGrid.appendChild(rowEl);
      }

      section.appendChild(customGrid);
      el.appendChild(section);
    }
  }

  // ─── Core logic ───────────────────────────────────────────────────────────

  function update() {
    if (!isActive || !isBudgetPage()) return;

    isUpdating = true;
    try {
      const contentArea = findPanelContentArea();

      if (!contentArea) {
        // Panel closed — clear all tracked state for the next selection session
        selectionMap.clear();
        injectedPanel = null;
        return;
      }

      // Inject our totals element if not already present — after the heading row
      if (!contentArea.querySelector('.jt-budget-tools-totals')) {
        injectedPanel = buildTotalsEl();
        const headingChild = Array.from(contentArea.children).find(
          child => child.textContent?.toLowerCase().includes('mass budget actions')
        );
        if (headingChild && headingChild.nextSibling) {
          contentArea.insertBefore(injectedPanel, headingChild.nextSibling);
        } else if (headingChild) {
          contentArea.appendChild(injectedPanel);
        } else {
          contentArea.insertBefore(injectedPanel, contentArea.firstChild);
        }
      } else {
        injectedPanel = contentArea.querySelector('.jt-budget-tools-totals');
      }

      const colIndices = getColumnIndices();

      // Sync visible rows into the persistent map
      syncSelectionMap(colIndices);

      if (selectionMap.size === 0) {
        injectedPanel.innerHTML = '';
        return;
      }

      renderTotals(injectedPanel, colIndices);
    } finally {
      // Drain mutation records our own DOM writes just queued so the observer
      // callback doesn't see them and schedule another update.
      if (observer) observer.takeRecords();
      isUpdating = false;
    }
  }

  function scheduleUpdate() {
    clearTimeout(debounceTimer);
    debounceTimer = setTimeout(update, 80);
  }

  /**
   * Click handler — catches selection clicks immediately. Runs update once
   * right after the click (React will have committed the class change by then)
   * and again after a short delay (for the MASS BUDGET ACTIONS panel to open).
   */
  function handleClick() {
    if (!isBudgetPage()) return;
    // First pass: pick up selection class changes that React commits synchronously
    setTimeout(update, 50);
    // Second pass: catch the panel opening (React renders it async / with animation)
    setTimeout(update, 350);
  }

  // ─── Lifecycle ────────────────────────────────────────────────────────────

  function init() {
    if (isActive) return;
    isActive = true;
    console.log('BudgetTools: Initializing...');

    observer = new MutationObserver((mutations) => {
      // Ignore mutations we just caused — both the isUpdating flag (fast
      // path) and a target check (belt-and-suspenders against timing).
      if (isUpdating) return;
      if (injectedPanel && mutations.every(m =>
        m.target === injectedPanel || injectedPanel.contains(m.target)
      )) {
        return;
      }
      scheduleUpdate();
    });
    observer.observe(document.body, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ['class']
    });

    // Click listener gives immediate responsiveness — the MutationObserver
    // is a backup for non-click-driven changes (scroll, React re-renders).
    clickHandler = handleClick;
    document.addEventListener('click', clickHandler, true);

    scheduleUpdate();
    console.log('BudgetTools: Initialized');
  }

  function cleanup() {
    if (!isActive) return;
    console.log('BudgetTools: Cleaning up...');

    if (observer) { observer.disconnect(); observer = null; }
    if (clickHandler) { document.removeEventListener('click', clickHandler, true); clickHandler = null; }
    clearTimeout(debounceTimer);

    if (injectedPanel && injectedPanel.parentElement) injectedPanel.remove();
    injectedPanel = null;
    selectionMap.clear();
    numberCustomFieldsCache = { signature: null, fields: [] };
    isActive = false;

    console.log('BudgetTools: Cleaned up');
  }

  return {
    init,
    cleanup,
    isActive: () => isActive
  };
})();

window.BudgetTools = BudgetTools;
