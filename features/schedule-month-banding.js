/**
 * Schedule Month Banding
 *
 * JobTread's Schedule calendar renders one continuous multi-month grid — a
 * Month view routinely shows three months at once (98 day cells measured live).
 * The only cue for a boundary is a small blue "1 August" label on the first of
 * the month, so scrolling loses you.
 *
 * This bands alternating months with a background wash and puts a stronger rule
 * across the whole week row where a new month begins, so the boundary reads
 * at a glance. A month rarely starts on a Sunday, so the visible rule has to
 * be horizontal (a top box-shadow on every cell in that row) rather than a
 * vertical bar on the single cell that happens to hold the month name.
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
 *   2. There is no date data in the DOM at all — no data-date, no <time>, no
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
const ScheduleMonthBandingFeature = (() => {
  // The exact header chain, verified live. Do not loosen this.
  const DAY_HEADER_SELECTOR =
    'td > div.flex.justify-between.items-center > div.flex.space-x-2 > div.font-bold';
  const BAND_ATTR = 'data-jt-month-band';
  const START_ATTR = 'data-jt-month-start';
  // Separate from START_ATTR: START_ATTR marks the single cell holding the
  // month name (still useful for identifying that cell, and asserted by
  // tests); ROW_START_ATTR marks every cell in that cell's row, since the
  // visible boundary is a horizontal rule across the whole week.
  const ROW_START_ATTR = 'data-jt-month-start-row';
  const MARKED_SELECTOR =
    '[' + BAND_ATTR + '], [' + START_ATTR + '], [' + ROW_START_ATTR + ']';
  const STYLE_ID = 'jt-schedule-month-banding-styles';
  const DEBOUNCE_DELAY = 200;

  let isActiveState = false;
  let observer = null;
  let debouncedApply = null;
  let styleElement = null;
  // Fail-quiet: log the "nothing to band" case once, not on every pass.
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
      el.removeAttribute(ROW_START_ATTR);
    });
    hasMarks = false;
  }

  /**
   * Idempotent: attributes are only written when the value actually changes, so
   * a second pass over unchanged DOM mutates nothing.
   */
  function applyBanding() {
    if (!isActiveState) return;

    if (!isSchedulePage()) {
      clearMarks();
      return;
    }

    const cells = collectDayCells();
    if (cells.length === 0) {
      if (!loggedEmpty) {
        console.log('ScheduleMonthBanding: no calendar day cells found — nothing to band');
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
    const boundaryRows = new Set();
    cells.forEach((cell) => {
      const { td } = cell;
      marked.add(td);

      const value = String(cell.band % 2);
      if (td.getAttribute(BAND_ATTR) !== value) td.setAttribute(BAND_ATTR, value);

      const hasStart = td.hasAttribute(START_ATTR);
      if (cell.isBoundary && !hasStart) td.setAttribute(START_ATTR, '');
      else if (!cell.isBoundary && hasStart) td.removeAttribute(START_ATTR);

      if (cell.isBoundary) {
        const tr = td.closest('tr');
        if (tr) boundaryRows.add(tr);
      }
    });

    // The visible boundary is the whole week row, not just the cell holding
    // the month name — mark every cell in that row, including cells that
    // belong to the previous month.
    const rowMarked = new Set();
    boundaryRows.forEach((tr) => {
      tr.querySelectorAll(':scope > td').forEach((td) => {
        rowMarked.add(td);
        if (!td.hasAttribute(ROW_START_ATTR)) td.setAttribute(ROW_START_ATTR, '');
      });
    });

    // Drop marks from cells that are no longer day cells (view switch, re-render),
    // or no longer part of a boundary row.
    if (hasMarks) {
      document.querySelectorAll(MARKED_SELECTOR).forEach((el) => {
        if (!marked.has(el)) {
          el.removeAttribute(BAND_ATTR);
          el.removeAttribute(START_ATTR);
        }
        if (!rowMarked.has(el)) el.removeAttribute(ROW_START_ATTR);
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
    styleElement.href = chrome.runtime.getURL('styles/schedule-month-banding.css');
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
    console.log('ScheduleMonthBanding: Initializing...');

    injectStyles();
    applyBanding();

    debouncedApply = createDebounced(applyBanding, DEBOUNCE_DELAY);

    // childList + subtree ONLY. We write a data attribute on these cells every
    // pass, so observing attributes would make the debounce self-sustaining.
    observer = new MutationObserver((mutations) => {
      const structural = mutations.some(
        (m) => m.addedNodes.length > 0 || m.removedNodes.length > 0
      );
      if (structural) debouncedApply();
    });
    observer.observe(document.body, { childList: true, subtree: true });

    console.log('ScheduleMonthBanding: Initialized');
  }

  function cleanup() {
    if (!isActiveState) return;
    console.log('ScheduleMonthBanding: Cleaning up...');

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

    console.log('ScheduleMonthBanding: Cleaned up');
  }

  return {
    init,
    cleanup,
    isActive: () => isActiveState,
    // Exposed for tests.
    _collectDayCells: collectDayCells,
    _assignBands: assignBands,
    _applyBanding: applyBanding
  };
})();

if (typeof window !== 'undefined') {
  window.ScheduleMonthBandingFeature = ScheduleMonthBandingFeature;
}
