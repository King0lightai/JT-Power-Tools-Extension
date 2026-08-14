/**
 * JT Power Tools - Editable Tables (Power User)
 *
 * Makes custom field columns editable in place in JobTread's Data Browser
 * grids (/jobs and friends). Hover a custom field cell and click the pencil, or
 * Alt+click the cell, then type and press Enter - the value is written straight
 * to JobTread with a Pave `updateJob` mutation. Tab commits and steps to the
 * next editable cell, so a whole column can be filled without leaving the grid.
 *
 * The Data Browser is NOT an HTML table. It is a Tailwind flex grid:
 *
 *   div                                  <- grid root
 *     div.sticky                         <- header block (its own scroller)
 *       div.flex.min-w-max                 <- header row, one div per column,
 *                                             label in title="" on an inner div
 *     div.overflow-auto                  <- body scroller
 *       a[href="/jobs/ID"]                 <- THE ROW IS THE LINK
 *         div                               <- cells, one per column
 *     div.sticky                         <- totals row
 *
 * Two consequences drive this file. First, the header lives in a different
 * scroll container than the rows, so it is found by matching the inline pixel
 * widths that header, body and footer rows all share - which doubles as proof
 * that column N of the header really is column N of the row. Second, because
 * the row is an anchor, any plain click opens the job; that is why editing is
 * on the pencil and Alt+click, and why double-click can't be used at all (the
 * first click of the pair navigates before the second arrives).
 *
 * Only columns a saved view proves are custom fields are touched - see
 * editable-tables-modules/schema.js for why that proof matters. Native columns
 * (name, address, dates, totals) are left alone.
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

  let currentUrl = '';
  let decorateTimer = null;
  let noGrantKey = false;

  // Grids whose header can't be matched to the rows. Decorating those by index
  // could write to the wrong field, so they're skipped - once, loudly.
  const warnedGrids = new WeakSet();

  const DECORATE_DEBOUNCE_MS = 250;
  const URL_POLL_MS = 1000;

  // Scope today is job views. Widening to tasks or cost items means adding the
  // entity type to SUPPORTED_TYPES in the schema module and generalising this.
  const ROW_SELECTOR = 'a[href^="/jobs/"]';

  // ─── LIFECYCLE ───────────────────────────────────────────────

  async function init() {
    if (isActiveState) return;
    isActiveState = true;
    console.log('EditableTables: Initializing...');

    injectStyles();
    addListener(document, 'click', onDocumentClick, true);
    addListener(window, 'jt-org-changed', onOrgChanged);

    currentUrl = window.location.href;
    urlCheckInterval = setInterval(checkUrlChange, URL_POLL_MS);
    setupObserver();

    if (!window.JobTreadAPI || !(await JobTreadAPI.isConfigured())) {
      noGrantKey = true;
      console.warn('EditableTables: No JobTread grant key configured - inline editing is off');
    }

    scheduleDecorate();
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
    noGrantKey = false;
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

  // ─── NAVIGATION / ORG ────────────────────────────────────────

  function checkUrlChange() {
    if (window.location.href === currentUrl) return;
    currentUrl = window.location.href;
    // Leaving a grid strips the decorations rather than leaving stale pencils
    // on cells the next page may reuse.
    undecorateAll();
    scheduleDecorate();
  }

  function onOrgChanged() {
    if (window.EditableTablesSchema) window.EditableTablesSchema.clearCache();
    undecorateAll();
    scheduleDecorate();
  }

  // ─── DOM OBSERVATION ─────────────────────────────────────────

  function setupObserver() {
    observer = new MutationObserver(() => {
      if (noGrantKey) return;
      scheduleDecorate();
    });
    observer.observe(document.body, { childList: true, subtree: true });
  }

  function scheduleDecorate() {
    if (noGrantKey) return;
    if (decorateTimer) clearTimeout(decorateTimer);
    decorateTimer = setTimeout(() => {
      decorateTimer = null;
      decorate();
    }, DECORATE_DEBOUNCE_MS);
  }

  // ─── GRID DISCOVERY ──────────────────────────────────────────

  /**
   * The inline pixel widths of an element's children, or null when they aren't
   * all set. JobTread sizes every header, body and footer cell with an inline
   * `width`, and that sequence is what ties the three rows together.
   * @param {HTMLElement} element
   * @returns {Array<string>|null}
   */
  function columnWidths(element) {
    if (!element || !element.children.length) return null;
    const widths = Array.from(element.children).map((cell) => (cell.style && cell.style.width) || '');
    return widths.every(Boolean) ? widths : null;
  }

  /**
   * @param {Array<string>|null} a
   * @param {Array<string>|null} b
   * @returns {boolean}
   */
  function sameWidths(a, b) {
    return !!a && !!b && a.length === b.length && a.every((width, i) => width === b[i]);
  }

  /**
   * Column labels for a header row. JobTread puts the real label in `title` on
   * an inner div; the visible text is truncated with an ellipsis, so reading
   * textContent would mangle long headers.
   * @param {HTMLElement} headerRow
   * @returns {Array<string>}
   */
  function labelsOf(headerRow) {
    return Array.from(headerRow.children).map((cell) => {
      const titled = cell.querySelector('[title]');
      return titled ? titled.getAttribute('title') : cell.textContent;
    });
  }

  /**
   * Does this row label its columns the way JobTread's header does - a `title`
   * on most cells? The totals row shares the header's column widths exactly, so
   * widths alone would happily match "Count" and "Sum" as column labels.
   * @param {HTMLElement} element
   * @returns {boolean}
   */
  function hasColumnTitles(element) {
    const titled = Array.from(element.children).filter((cell) => cell.querySelector('[title]'));
    return titled.length >= Math.ceil(element.children.length / 2);
  }

  /**
   * The header row belonging to a body scroller: the nearby row that shares the
   * rows' column widths and labels its columns.
   * @param {HTMLElement} scroller - the body scroll container
   * @param {Array<string>} widths - a body row's column widths
   * @returns {HTMLElement|null}
   */
  function findHeaderRow(scroller, widths) {
    let root = scroller.parentElement;
    for (let depth = 0; root && depth < 3; depth++, root = root.parentElement) {
      const match = Array.from(root.querySelectorAll('div')).find((element) => {
        if (element.contains(scroller) || scroller.contains(element)) return false;
        if (element.children.length !== widths.length) return false;
        if (!sameWidths(columnWidths(element), widths)) return false;
        return hasColumnTitles(element);
      });
      if (match) return match;
    }
    return null;
  }

  /**
   * Every Data Browser grid on the page, as { rows, headerRow }.
   * @returns {Array<Object>}
   */
  function findGrids() {
    const rowsByScroller = new Map();
    document.querySelectorAll(ROW_SELECTOR).forEach((row) => {
      // A row has one child per column; a plain link to a job does not.
      if (row.children.length < 2) return;
      const scroller = row.parentElement;
      if (!scroller) return;
      if (!rowsByScroller.has(scroller)) rowsByScroller.set(scroller, []);
      rowsByScroller.get(scroller).push(row);
    });

    const grids = [];
    rowsByScroller.forEach((rows, scroller) => {
      const widths = columnWidths(rows[0]);
      if (!widths) return;

      const headerRow = findHeaderRow(scroller, widths);
      if (!headerRow) {
        if (!warnedGrids.has(scroller)) {
          warnedGrids.add(scroller);
          console.warn(
            'EditableTables: Could not match a header row to these rows ' +
            '(expected widths', widths.join(','),
            ') - skipping this grid to avoid writing the wrong field'
          );
        }
        return;
      }
      grids.push({ rows, headerRow, widths });
    });
    return grids;
  }

  // ─── DECORATION ──────────────────────────────────────────────

  async function decorate() {
    if (!isActiveState || noGrantKey) return;

    for (const grid of findGrids()) {
      let schema;
      try {
        schema = await window.EditableTablesSchema.resolve(labelsOf(grid.headerRow));
      } catch (error) {
        console.error('EditableTables: Failed to resolve view schema:', error);
        return;
      }
      // A re-render (or a cleanup) may have landed while the schema was in
      // flight; the next observer tick will decorate the fresh nodes.
      if (!isActiveState) return;
      if (schema) decorateGrid(grid, schema);
    }
  }

  /**
   * Mark the editable cells of one grid and give each an edit affordance.
   * @param {Object} grid - { rows, headerRow, widths }
   * @param {Object} schema - resolved schema (byIndex map)
   */
  function decorateGrid(grid, schema) {
    grid.rows.forEach((row) => {
      // Row widths are re-checked per row: a grouped grid can put a spanning
      // subtotal row in among the record rows.
      if (!sameWidths(columnWidths(row), grid.widths)) return;
      if (!window.EditableTablesSchema.getRecordId(row, schema.hrefPrefix)) return;

      // The class and button are a hover affordance only - which record and
      // field an edit targets is re-resolved at click time (see openEditor),
      // because React can recycle a cell into a different row between this
      // pass and the click.
      schema.byIndex.forEach((field, index) => {
        const cell = row.children[index];
        if (!cell) return;

        cell.classList.add('jt-et-cell');
        if (!cell.querySelector('.jt-et-edit')) {
          cell.appendChild(createEditButton(field));
        }
      });
    });
  }

  /**
   * @param {Object} field
   * @returns {HTMLButtonElement}
   */
  function createEditButton(field) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'jt-et-edit';
    button.title = `Edit ${field.name} (or Alt+click the cell)`;
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

  /**
   * Every row is a link to its job, so a plain click must keep doing what
   * JobTread does - open the job. Editing is claimed only by the pencil or by
   * Alt+click, and both have to cancel the navigation before it starts.
   * @param {MouseEvent} event
   */
  function onDocumentClick(event) {
    if (!event.target.closest) return;

    const button = event.target.closest('.jt-et-edit');
    const cell = button ? button.closest('.jt-et-cell') : event.target.closest('.jt-et-cell');
    if (!cell) return;
    if (!button && !event.altKey) return;

    event.preventDefault();
    event.stopPropagation();
    void openEditor(cell);
  }

  /**
   * Open the editor on a cell, resolving the record and field from the live DOM
   * rather than from anything stamped on at decoration time. A sort, filter or
   * page change can move a row under a recycled cell, and a stale record id
   * would write the right value to the wrong job.
   * @param {HTMLElement} cell
   * @returns {Promise<void>}
   */
  async function openEditor(cell) {
    if (!cell || !isActiveState) return;

    const row = cell.parentElement;
    if (!row || !row.matches(ROW_SELECTOR)) return;

    const widths = columnWidths(row);
    const headerRow = widths ? findHeaderRow(row.parentElement, widths) : null;
    if (!headerRow) return;

    const schema = await window.EditableTablesSchema.resolve(labelsOf(headerRow));
    if (!schema || !isActiveState) return;

    const field = schema.byIndex.get(Array.prototype.indexOf.call(row.children, cell));
    if (!field) return;

    const recordId = window.EditableTablesSchema.getRecordId(row, schema.hrefPrefix);
    if (!recordId) return;

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
    const cells = Array.from(document.querySelectorAll('.jt-et-cell'));
    const index = cells.indexOf(fromCell);
    if (index === -1) return;
    const next = cells[index + direction];
    if (next) void openEditor(next);
  }

  return {
    init,
    cleanup,
    isActive: () => isActiveState,
    // Exposed for unit tests - grid discovery is where a bug writes the wrong
    // field, and it is pure DOM reasoning with no network in the way.
    _findGrids: findGrids,
    _labelsOf: labelsOf
  };
})();

if (typeof window !== 'undefined') {
  window.EditableTablesFeature = EditableTablesFeature;
}
