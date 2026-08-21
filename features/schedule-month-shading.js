/**
 * Schedule Month Shading
 *
 * JobTread's Schedule calendar renders one continuous multi-month grid — a
 * Month view routinely shows three months at once (98 day cells measured live).
 * The only cue for a boundary is a small blue "1 August" label on the first of
 * the month, so scrolling loses you.
 *
 * This shades alternating months with a background wash and draws a stronger
 * rule along the month boundary itself, so the boundary reads at a glance.
 * A month rarely starts on a Sunday, so that boundary is a STAIRCASE, not a
 * straight line: it runs along the top of the new month's cells, drops down
 * the left edge of the 1st through the full height of that week block, and
 * picks up again along the top of the next week's cells that still sit under
 * the old month. A month that does start on a Sunday degenerates to a single
 * straight rule, which is the correct answer for that case rather than a
 * special case.
 *
 * Two things the DOM forces:
 *
 *   1. A day cell's header is a fixed shallow chain —
 *      td > div.flex.justify-between.items-center > div.flex.space-x-2 > div.font-bold
 *      The FIRST div.font-bold in that chain is the day number; on the first of
 *      a month there is a SECOND one holding the month name. A loose
 *      `td div.font-bold` descendant selector over-matches badly (task card
 *      titles are div.font-bold too), so the tight chain is load-bearing.
 *
 *   2. A week is NOT one tall row of day cells. JobTread renders each week as
 *      a run of sibling <tr>s: first the day-number row (~32px), then one row
 *      per stacked task card, plus 1px spacer rows. Every row is exactly 7
 *      cells wide with no colspan, so cellIndex is the weekday. Marking only
 *      the day-number row shades a thin strip across the top of the week
 *      rather than the day, which is what the first version shipped — each
 *      column's band has to be carried down the rest of its week block.
 *
 *   3. There is no date data in the DOM at all — no data-date, no <time>, no
 *      date attribute. The month has to be inferred by walking day cells in
 *      document order and starting a new band each time a cell carries a month
 *      name. Cells before the first month-name cell are the trailing days of
 *      the previous month and form their own band.
 *
 * Styling goes through a data attribute + stylesheet, never inline styles:
 * dark-mode.js writes `style.backgroundColor` inline on the today cell, and
 * inline beats class, so today's blue correctly wins over the band. For the
 * same reason nothing here uses !important, and cleanup() never touches
 * style.backgroundColor.
 *
 * Dependencies: utils/debounce.js (TimingUtils) — optional, guarded.
 */
const ScheduleMonthShadingFeature = (() => {
  // The exact header chain, verified live. Do not loosen this.
  const DAY_HEADER_SELECTOR =
    'td > div.flex.justify-between.items-center > div.flex.space-x-2 > div.font-bold';
  const BAND_ATTR = 'data-jt-month-band';
  const START_ATTR = 'data-jt-month-start';
  // Separate from START_ATTR: START_ATTR marks the single cell holding the
  // month name; EDGE_ATTR marks which of a cell's own edges the boundary
  // staircase runs along. Its value names the edges ('top', 'left',
  // 'top-left') rather than using one attribute per edge, because two
  // box-shadow rules from two selectors do not combine — the winner replaces
  // the loser outright, so the corner cell needs a single rule declaring both.
  const EDGE_ATTR = 'data-jt-month-edge';
  const MARKED_SELECTOR =
    '[' + BAND_ATTR + '], [' + START_ATTR + '], [' + EDGE_ATTR + ']';
  const STYLE_ID = 'jt-schedule-month-shading-styles';
  const DEBOUNCE_DELAY = 200;

  let isActiveState = false;
  let observer = null;
  let debouncedApply = null;
  let styleElement = null;
  // Fail-quiet: log the "nothing to shade" case once, not on every pass.
  let loggedEmpty = false;
  // Tracks whether anything is currently marked, so the common "nothing to do"
  // pass costs no document-wide query.
  let hasMarks = false;

  function isSchedulePage() {
    return window.location.pathname.includes('/schedule');
  }

  /**
   * Collect the calendar day cells in document order.
   * Each entry is { td, isMonthStart }. A cell whose header group holds a
   * second div.font-bold carries a month name, i.e. it is the 1st.
   *
   * @returns {Array<{td: HTMLElement, isMonthStart: boolean}>}
   */
  function collectDayCells() {
    const cells = [];
    const seen = new Set();

    document.querySelectorAll(DAY_HEADER_SELECTOR).forEach((bold) => {
      const td = bold.closest('td');
      if (!td || seen.has(td)) return;
      // Consider each cell exactly once, on its FIRST matching chain — that is
      // the header. Marking it seen even when it fails the numeric test below
      // keeps a stray match later in the cell from re-opening the question.
      seen.add(td);

      const group = bold.parentElement;
      if (!group) return;
      const bolds = group.querySelectorAll(':scope > div.font-bold');
      if (!bolds.length) return;

      // Second guard against over-matching: a day number is numeric.
      const dayText = (bolds[0].textContent || '').trim();
      if (!/^\d{1,2}$/.test(dayText)) return;

      cells.push({ td, isMonthStart: bolds.length > 1 });
    });

    return cells;
  }

  /**
   * Walk the cells and assign a band index. Cells before the first month-name
   * cell are the previous month's trailing days and keep band 0; each
   * month-name cell after the very first cell opens the next band.
   *
   * @param {Array} cells - from collectDayCells(), mutated in place
   * @returns {number} the number of distinct month segments found
   */
  function assignBands(cells) {
    let band = 0;
    cells.forEach((cell, index) => {
      // index 0 being a month start means the grid opens exactly on the 1st —
      // no preceding trailing-days segment, so it stays band 0.
      if (cell.isMonthStart && index > 0) band += 1;
      cell.band = band;
      // The boundary marker belongs on a real boundary inside the grid, not on
      // the grid's own first cell.
      cell.isBoundary = cell.isMonthStart && index > 0;
    });
    return band + 1;
  }

  /** Remove every attribute this feature writes. Never touches inline styles. */
  function clearMarks() {
    if (!hasMarks) return;
    document.querySelectorAll(MARKED_SELECTOR).forEach((el) => {
      el.removeAttribute(BAND_ATTR);
      el.removeAttribute(START_ATTR);
      el.removeAttribute(EDGE_ATTR);
    });
    hasMarks = false;
  }

  /**
   * The rows a week occupies: its day-number row, then every sibling row up to
   * (not including) the next day-number row — the task-card rows and the 1px
   * spacers between them.
   *
   * @param {HTMLElement} dayRow
   * @param {Map} weekColumns - keyed by day-number row; membership is the stop test
   * @returns {Array<HTMLElement>}
   */
  function weekBlockRows(dayRow, weekColumns) {
    const rows = [dayRow];
    let row = dayRow.nextElementSibling;
    while (row && row.tagName === 'TR' && !weekColumns.has(row)) {
      rows.push(row);
      row = row.nextElementSibling;
    }
    return rows;
  }

  /** The next week's day-number row, or null at the end of the grid. */
  function nextDayRow(dayRow, weekColumns) {
    let row = dayRow.nextElementSibling;
    while (row && row.tagName === 'TR' && !weekColumns.has(row)) {
      row = row.nextElementSibling;
    }
    return row && row.tagName === 'TR' ? row : null;
  }

  /**
   * Idempotent: attributes are only written when the value actually changes, so
   * a second pass over unchanged DOM mutates nothing.
   */
  function applyShading() {
    if (!isActiveState) return;

    if (!isSchedulePage()) {
      clearMarks();
      return;
    }

    const cells = collectDayCells();
    if (cells.length === 0) {
      if (!loggedEmpty) {
        console.log('ScheduleMonthShading: no calendar day cells found — nothing to shade');
        loggedEmpty = true;
      }
      clearMarks();
      return;
    }
    loggedEmpty = false;

    const segments = assignBands(cells);
    // One month on screen means there is no boundary to show; a uniform wash
    // over the whole grid would be noise. Week and Day views land here.
    if (segments < 2) {
      clearMarks();
      return;
    }

    const marked = new Set();
    const edgeMarked = new Set();

    // Index the day cells by week row and column up front: every later step —
    // carrying the band down a week, finding where a week block ends, walking
    // to the next week — needs to recognise a day-number row on sight.
    const weekColumns = new Map();
    cells.forEach((cell) => {
      const tr = cell.td.closest('tr');
      if (!tr) return;
      let columns = weekColumns.get(tr);
      if (!columns) {
        columns = new Map();
        weekColumns.set(tr, columns);
      }
      columns.set(cell.td.cellIndex, String(cell.band % 2));
    });

    const boundaryCells = [];
    cells.forEach((cell) => {
      const { td } = cell;
      marked.add(td);

      const value = String(cell.band % 2);
      if (td.getAttribute(BAND_ATTR) !== value) td.setAttribute(BAND_ATTR, value);

      const hasStart = td.hasAttribute(START_ATTR);
      if (cell.isBoundary && !hasStart) td.setAttribute(START_ATTR, '');
      else if (!cell.isBoundary && hasStart) td.removeAttribute(START_ATTR);

      if (cell.isBoundary) boundaryCells.push(cell);
    });

    // A day is not one <td>: see point 2 in the module docblock. Carry each
    // column's band down the remaining rows of its week block so the wash
    // covers the whole day cell, not just its day-number strip.
    weekColumns.forEach((columns, dayRow) => {
      weekBlockRows(dayRow, weekColumns).slice(1).forEach((row) => {
        Array.from(row.children).forEach((td) => {
          if (td.tagName !== 'TD') return;
          const value = columns.get(td.cellIndex);
          if (value === undefined) return;
          marked.add(td);
          if (td.getAttribute(BAND_ATTR) !== value) td.setAttribute(BAND_ATTR, value);
        });
      });
    });

    // The boundary staircase (see the docblock). Written as one edge attribute
    // per cell so the corner gets both of its edges from a single rule.
    const setEdge = (td, value) => {
      edgeMarked.add(td);
      if (td.getAttribute(EDGE_ATTR) !== value) td.setAttribute(EDGE_ATTR, value);
    };

    boundaryCells.forEach((cell) => {
      const startTd = cell.td;
      const startCol = startTd.cellIndex;
      const dayRow = startTd.closest('tr');
      if (!dayRow) return;

      // Along the top of the new month's own cells, out to the end of the week.
      Array.from(dayRow.children).forEach((td) => {
        if (td.tagName !== 'TD' || td.cellIndex < startCol) return;
        setEdge(td, td.cellIndex === startCol && startCol > 0 ? 'top-left' : 'top');
      });

      // A month starting on a Sunday has no step: the rule above already spans
      // the full width and there is nothing left of it to drop down.
      if (startCol === 0) return;

      // Down the left edge of the 1st, through the rest of the week block.
      weekBlockRows(dayRow, weekColumns).slice(1).forEach((row) => {
        const td = Array.from(row.children).find(
          (candidate) => candidate.tagName === 'TD' && candidate.cellIndex === startCol
        );
        if (td) setEdge(td, 'left');
      });

      // Then along the top of the next week's cells that still sit beneath the
      // old month. Drawn on that row rather than as a bottom edge on this one:
      // a week block can end on a 1px spacer row, which would clip the rule.
      const following = nextDayRow(dayRow, weekColumns);
      if (!following) return;
      Array.from(following.children).forEach((td) => {
        if (td.tagName !== 'TD' || td.cellIndex >= startCol) return;
        setEdge(td, 'top');
      });
    });

    // Drop marks from cells that are no longer day cells (view switch, re-render),
    // or no longer part of the boundary staircase.
    if (hasMarks) {
      document.querySelectorAll(MARKED_SELECTOR).forEach((el) => {
        if (!marked.has(el)) {
          el.removeAttribute(BAND_ATTR);
          el.removeAttribute(START_ATTR);
        }
        if (!edgeMarked.has(el)) el.removeAttribute(EDGE_ATTR);
      });
    }
    hasMarks = true;
  }

  /** TimingUtils.debounce when available, a minimal equivalent when it is not. */
  function createDebounced(fn, delay) {
    if (window.TimingUtils && typeof window.TimingUtils.debounce === 'function') {
      return window.TimingUtils.debounce(fn, delay);
    }
    let timer = null;
    const debounced = () => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => {
        timer = null;
        fn();
      }, delay);
    };
    debounced.cancel = () => {
      if (timer) clearTimeout(timer);
      timer = null;
    };
    return debounced;
  }

  function injectStyles() {
    if (styleElement) return;
    styleElement = document.createElement('link');
    styleElement.rel = 'stylesheet';
    styleElement.href = chrome.runtime.getURL('styles/schedule-month-shading.css');
    styleElement.id = STYLE_ID;
    document.head.appendChild(styleElement);
  }

  function removeStyles() {
    if (styleElement) {
      styleElement.remove();
      styleElement = null;
    }
  }

  function init() {
    if (isActiveState) return;
    isActiveState = true;
    console.log('ScheduleMonthShading: Initializing...');

    injectStyles();
    applyShading();

    debouncedApply = createDebounced(applyShading, DEBOUNCE_DELAY);

    // childList + subtree ONLY. We write a data attribute on these cells every
    // pass, so observing attributes would make the debounce self-sustaining.
    observer = new MutationObserver((mutations) => {
      const structural = mutations.some(
        (m) => m.addedNodes.length > 0 || m.removedNodes.length > 0
      );
      if (structural) debouncedApply();
    });
    observer.observe(document.body, { childList: true, subtree: true });

    console.log('ScheduleMonthShading: Initialized');
  }

  function cleanup() {
    if (!isActiveState) return;
    console.log('ScheduleMonthShading: Cleaning up...');

    if (observer) {
      observer.disconnect();
      observer = null;
    }
    if (debouncedApply) {
      debouncedApply.cancel();
      debouncedApply = null;
    }

    clearMarks();
    removeStyles();
    loggedEmpty = false;
    isActiveState = false;

    console.log('ScheduleMonthShading: Cleaned up');
  }

  return {
    init,
    cleanup,
    isActive: () => isActiveState,
    // Exposed for tests.
    _collectDayCells: collectDayCells,
    _assignBands: assignBands,
    _applyShading: applyShading
  };
})();

if (typeof window !== 'undefined') {
  window.ScheduleMonthShadingFeature = ScheduleMonthShadingFeature;
}
