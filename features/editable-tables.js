/**
 * JT Power Tools - Editable Tables (Power User)
 *
 * Makes custom field columns editable in place in JobTread's Data Browser
 * saved views (e.g. /jobs?view=22PRZaTnZTu2). Hover a custom field cell, click
 * the pencil (or double-click the cell), type, press Enter — the value is
 * written straight to JobTread with a Pave `updateJob` mutation. Tab commits
 * and steps to the next editable cell, so a whole column can be filled in
 * without leaving the table.
 *
 * Only columns the saved view proves are custom fields are touched — see
 * editable-tables-modules/schema.js for why that proof matters. Native columns
 * (name, number, status, dates) are left alone.
 *
 * Scope today: `job` data views. Widening to tasks or cost items is a matter
 * of adding the entity type to SUPPORTED_TYPES in the schema module.
 *
 * @module EditableTablesFeature
 * @requires EditableTablesSchema, EditableTablesEditor, JobTreadAPI
 */
const EditableTablesFeature = (() => {
  let isActiveState = false;
  let observer = null;
  let urlCheckInterval = null;
  let styleElement = null;
  let eventListeners = [];

  let schema = null;          // resolved editable-column schema for the current view
  let currentViewId = null;
  let currentUrl = '';
  let decorateTimer = null;
  let schemaLoadFailed = false;

  // Tables whose header/body column counts don't line up. Decorating those by
  // index could write to the wrong field, so they're skipped — once, loudly.
  const warnedTables = new WeakSet();

  const DECORATE_DEBOUNCE_MS = 250;
  const URL_POLL_MS = 1000;

  // ─── LIFECYCLE ───────────────────────────────────────────────

  async function init() {
    if (isActiveState) return;
    isActiveState = true;
    console.log('EditableTables: Initializing...');

    injectStyles();
    addListener(document, 'click', onDocumentClick, true);
    addListener(document, 'dblclick', onDocumentDoubleClick, true);
    addListener(window, 'jt-org-changed', onOrgChanged);

    currentUrl = window.location.href;
    urlCheckInterval = setInterval(checkUrlChange, URL_POLL_MS);
    setupObserver();

    await refreshSchema();
    console.log('EditableTables: Initialized');
  }

  function cleanup() {
    if (!isActiveState) return;
    console.log('EditableTables: Cleaning up...');

    if (window.EditableTablesEditor) window.EditableTablesEditor.destroy();

    if (observer) { observer.disconnect(); observer = null; }
    if (urlCheckInterval) { clearInterval(urlCheckInterval); urlCheckInterval = null; }
    if (decorateTimer) { clearTimeout(decorateTimer); decorateTimer = null; }

    eventListeners.forEach(({ element, event, handler, capture }) => {
      element.removeEventListener(event, handler, capture);
    });
    eventListeners = [];

    undecorateAll();
    removeStyles();

    if (window.EditableTablesSchema) window.EditableTablesSchema.clearCache();
    schema = null;
    currentViewId = null;
    schemaLoadFailed = false;
    isActiveState = false;
    console.log('EditableTables: Cleaned up');
  }

  function addListener(element, event, handler, capture = false) {
    element.addEventListener(event, handler, capture);
    eventListeners.push({ element, event, handler, capture });
  }

  // ─── STYLES ──────────────────────────────────────────────────

  function injectStyles() {
    if (styleElement) return;
    styleElement = document.createElement('link');
    styleElement.rel = 'stylesheet';
    styleElement.id = 'jt-editable-tables-styles';
    styleElement.href = chrome.runtime.getURL('styles/editable-tables.css');
    (document.head || document.documentElement).appendChild(styleElement);
  }

  function removeStyles() {
    if (styleElement && styleElement.parentNode) styleElement.parentNode.removeChild(styleElement);
    styleElement = null;
  }

  // ─── VIEW / SCHEMA RESOLUTION ────────────────────────────────

  function checkUrlChange() {
    if (window.location.href === currentUrl) return;
    currentUrl = window.location.href;
    refreshSchema();
  }

  function onOrgChanged() {
    if (window.EditableTablesSchema) window.EditableTablesSchema.clearCache();
    currentViewId = null;
    refreshSchema();
  }

  /**
   * Resolve the editable columns for whatever view is on screen now.
   * Leaving a saved view strips the decorations rather than leaving stale
   * pencils pointing at fields that aren't in this table.
   */
  async function refreshSchema() {
    const viewId = window.EditableTablesSchema
      ? window.EditableTablesSchema.getViewIdFromUrl()
      : null;

    if (viewId === currentViewId && schema) {
      scheduleDecorate();
      return;
    }

    currentViewId = viewId;
    schema = null;
    schemaLoadFailed = false;
    undecorateAll();

    if (!viewId) return;

    if (!window.JobTreadAPI || !(await JobTreadAPI.isConfigured())) {
      console.warn('EditableTables: No JobTread grant key configured — inline editing is off');
      schemaLoadFailed = true;
      return;
    }

    try {
      const resolved = await window.EditableTablesSchema.load(viewId);
      if (!resolved) return;
      if (!resolved.supported) {
        console.log(`EditableTables: ${resolved.type} views aren't editable yet — skipping`);
        return;
      }
      if (resolved.byLabel.size === 0) {
        console.log('EditableTables: This view has no editable custom field columns');
        return;
      }
      schema = resolved;
      scheduleDecorate();
    } catch (error) {
      schemaLoadFailed = true;
      console.error('EditableTables: Failed to resolve view schema:', error);
    }
  }

  // ─── DOM OBSERVATION ─────────────────────────────────────────

  function setupObserver() {
    observer = new MutationObserver(() => {
      if (!schema || schemaLoadFailed) return;
      scheduleDecorate();
    });
    observer.observe(document.body, { childList: true, subtree: true });
  }

  function scheduleDecorate() {
    if (decorateTimer) clearTimeout(decorateTimer);
    decorateTimer = setTimeout(() => {
      decorateTimer = null;
      decorate();
    }, DECORATE_DEBOUNCE_MS);
  }

  // ─── DECORATION ──────────────────────────────────────────────

  function decorate() {
    if (!schema || !isActiveState) return;
    document.querySelectorAll('table').forEach(decorateTable);
  }

  /**
   * Mark the editable cells of one table and give each an edit affordance.
   * @param {HTMLTableElement} table
   */
  function decorateTable(table) {
    const columns = buildColumnMap(table, schema);
    if (!columns || columns.size === 0) return;

    table.querySelectorAll('tbody tr').forEach((row) => {
      const recordId = window.EditableTablesSchema.getRecordId(row, schema.hrefPrefix);
      if (!recordId) return;

      // The class and button are a hover affordance only — which record and
      // field an edit targets is re-resolved at click time (see openEditor),
      // because React can recycle a <td> into a different row between this
      // pass and the click.
      columns.forEach((field, index) => {
        const cell = row.children[index];
        if (!cell || cell.tagName !== 'TD') return;

        cell.classList.add('jt-et-cell');
        if (!cell.querySelector('.jt-et-edit')) {
          cell.appendChild(createEditButton(field));
        }
      });
    });
  }

  /**
   * Map column index → custom field for one table.
   * Returns null when the table's header and body disagree on column count,
   * because index-based mapping would then target the wrong field.
   * @param {HTMLTableElement} table
   * @param {Object} viewSchema - resolved schema (byLabel map)
   * @returns {Map<number, Object>|null}
   */
  function buildColumnMap(table, viewSchema) {
    const headerCells = findHeaderCells(table);
    if (!headerCells.length) return null;

    const firstBodyRow = table.querySelector('tbody tr');
    if (!firstBodyRow) return null;

    if (firstBodyRow.children.length !== headerCells.length) {
      if (!warnedTables.has(table)) {
        warnedTables.add(table);
        console.warn(
          'EditableTables: Column count mismatch (header',
          headerCells.length, 'vs row', firstBodyRow.children.length,
          ') — skipping this table to avoid writing the wrong field'
        );
      }
      return null;
    }

    // A label that appears twice can't be resolved to one field safely.
    const labels = headerCells.map((th) => window.EditableTablesSchema.normalizeLabel(th.textContent));
    const duplicates = new Set(labels.filter((label, i) => labels.indexOf(label) !== i));

    const columns = new Map();
    labels.forEach((label, index) => {
      if (!label || duplicates.has(label)) return;
      const field = viewSchema.byLabel.get(label);
      if (field) columns.set(index, field);
    });
    return columns;
  }

  /**
   * The header row that actually labels the columns — the one with the most
   * cells, since grouped views stack a spanning row above it.
   * @param {HTMLTableElement} table
   * @returns {Array<HTMLElement>}
   */
  function findHeaderCells(table) {
    const headerRows = Array.from(table.querySelectorAll('thead tr'));
    if (!headerRows.length) return [];
    const best = headerRows.reduce((a, b) => (b.children.length > a.children.length ? b : a));
    return Array.from(best.children).filter((cell) => cell.tagName === 'TH');
  }

  /**
   * @param {Object} field
   * @returns {HTMLButtonElement}
   */
  function createEditButton(field) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'jt-et-edit';
    button.title = `Edit ${field.name}`;
    button.setAttribute('aria-label', `Edit ${field.name}`);
    button.textContent = '✎';
    return button;
  }

  function undecorateAll() {
    document.querySelectorAll('.jt-et-edit').forEach((el) => el.remove());
    document.querySelectorAll('.jt-et-cell').forEach((cell) => {
      cell.classList.remove('jt-et-cell', 'jt-et-flash-saved', 'jt-et-flash-failed');
    });
  }

  // ─── INTERACTION ─────────────────────────────────────────────

  function onDocumentClick(event) {
    const button = event.target.closest ? event.target.closest('.jt-et-edit') : null;
    if (!button) return;
    // The cell usually sits inside a row-wide link — don't let the click
    // navigate to the job.
    event.preventDefault();
    event.stopPropagation();
    openEditor(button.closest('td'));
  }

  function onDocumentDoubleClick(event) {
    const cell = event.target.closest ? event.target.closest('td.jt-et-cell') : null;
    if (!cell) return;
    event.preventDefault();
    event.stopPropagation();
    openEditor(cell);
  }

  /**
   * Open the editor on a cell, resolving the record and field from the live
   * DOM rather than from anything stamped on at decoration time. A sort,
   * filter, or page change can move a row under a recycled <td>, and a stale
   * record id would write the right value to the wrong job.
   * @param {HTMLElement} cell
   */
  function openEditor(cell) {
    if (!cell || !schema) return;
    const row = cell.closest('tr');
    const table = cell.closest('table');
    if (!row || !table) return;

    const recordId = window.EditableTablesSchema.getRecordId(row, schema.hrefPrefix);
    if (!recordId) return;

    const columns = buildColumnMap(table, schema);
    if (!columns) return;
    const field = columns.get(Array.prototype.indexOf.call(row.children, cell));
    if (!field) return;

    window.EditableTablesEditor.open({
      cell,
      field,
      recordId,
      type: schema.type,
      onNavigate: (direction) => moveToAdjacentCell(cell, direction)
    });
  }

  /**
   * Tab / Shift+Tab between editable cells in document order.
   * @param {HTMLElement} fromCell
   * @param {number} direction - 1 forward, -1 backward
   */
  function moveToAdjacentCell(fromCell, direction) {
    const cells = Array.from(document.querySelectorAll('td.jt-et-cell'));
    const index = cells.indexOf(fromCell);
    if (index === -1) return;
    const next = cells[index + direction];
    if (next) openEditor(next);
  }

  return {
    init,
    cleanup,
    isActive: () => isActiveState,
    // Exposed for unit tests — column mapping is where a bug writes the wrong field.
    _buildColumnMap: buildColumnMap
  };
})();

if (typeof window !== 'undefined') {
  window.EditableTablesFeature = EditableTablesFeature;
}
