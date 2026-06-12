// Document Sort Feature Module
// Adds clickable sort arrows to the column headers of the Documents table.
// Works on three views that share the same table component:
//   • Job > Documents       (/jobs/.../documents)
//   • Customer > Documents   (/customers/.../documents)
//   • Vendor > Documents     (/vendors/.../documents)
// JT lazy-loads more rows as you scroll, so the first click on a column
// header force-loads every row (scrolls to the bottom in a loop until no
// new rows arrive) before sorting — otherwise the user would only see the
// visible window sorted, with unloaded rows sitting in their original
// positions further down.
//
// DOM signature this feature targets. The Job view shows the linked
// account as "Account"; the Customer/Vendor views replace it with a "Job"
// column (shifting Name to index 1). Both are 5-column sticky tables:
//   <div class="sticky z-30" style="top: 48px;">
//     <div class="overflow-auto overscroll-x-none scrollbar-none">
//       <div class="flex min-w-max">
//         <!-- Job view:            Name | Account | Subject | Status | Amount -->
//         <!-- Customer/Vendor view: Job  | Name    | Subject | Status | Amount -->
//         <div ...bg-gray-700...>...</div>  x5
//       </div>
//     </div>
//   </div>
//   <div class="overflow-auto overscroll-x-none scrollbar-none">
//     <a href="/jobs/.../documents/...">...</a>  <!-- rows (always job-scoped,
//     <a href="/jobs/.../documents/...">...</a>        even in customer/vendor views) -->
//     ...
//   </div>
//
// Per-index sort extraction is compatible across both layouts: indices 0
// and 1 are always a bold primary line (Name/Account/Job all render that
// way) and indices 2/3/4 (Subject/Status/Amount) are identical — so the
// comparator needs no per-layout branching.

const DocumentSortFeature = (() => {
  let isActive = false;
  let observer = null;
  let mountedHeader = null;        // The header element we've decorated
  let mountedRowsContainer = null; // The container holding the <a> rows
  let originalOrder = null;        // Snapshot of row order before any sort
  let activeColumn = null;         // 0-4 (Name/Account/Subject/Status/Amount)
  let activeDirection = null;      // 'asc' | 'desc' | null
  let loadInFlight = false;        // Guard against concurrent force-loads

  // Known documents-table column layouts. A sticky table must match one of
  // these header sets exactly to qualify (defensive against other 5-column
  // sticky tables like budgets/payments). The Job > Documents tab shows the
  // linked account as "Account"; the Customer/Vendor > Documents tabs replace
  // it with the "Job" column (shifting Name to index 1).
  const KNOWN_LAYOUTS = [
    ['Name', 'Account', 'Subject', 'Status', 'Amount'], // Job > Documents
    ['Job', 'Name', 'Subject', 'Status', 'Amount'],     // Customer/Vendor > Documents
  ];
  const COLUMN_COUNT = 5;

  // Status enum order. Lower = sorts earlier in ascending direction.
  // Unknown statuses get a higher value than any known one so they fall
  // to the bottom in ascending sort.
  const STATUS_ORDER = {
    draft: 0,
    pending: 1,
    payable: 2,
    approved: 3,
    paid: 4,
    denied: 5,
  };
  const UNKNOWN_STATUS_RANK = 99;

  // Force-load tuning
  const SCROLL_INTERVAL_MS = 100;          // Wait between scroll-to-bottom ticks
  const STABLE_TICKS_REQUIRED = 2;         // Consecutive zero-growth ticks to call it done
  const FORCE_LOAD_TIMEOUT_MS = 30000;     // Hard cap so a runaway never hangs the UI

  // ─── Activation lifecycle ─────────────────────────────────────────

  function init() {
    if (isActive) return;
    isActive = true;
    console.log('DocumentSort: Initializing...');

    // Try once immediately (page may already be on the documents tab),
    // then keep an observer running for SPA tab/job changes.
    tryMount();

    observer = new MutationObserver(() => {
      if (!isActive) return;
      tryMount();
    });
    observer.observe(document.body, { childList: true, subtree: true });

    console.log('DocumentSort: Initialized');
  }

  function cleanup() {
    if (!isActive) return;
    console.log('DocumentSort: Cleaning up...');

    if (observer) {
      observer.disconnect();
      observer = null;
    }

    unmount();

    isActive = false;
    console.log('DocumentSort: Cleaned up');
  }

  // ─── Mount / unmount ──────────────────────────────────────────────

  function tryMount() {
    const header = findDocumentsHeader();
    if (!header) {
      // No documents table on screen. If we had one previously
      // (navigated away), tear our decorations down.
      if (mountedHeader) unmount();
      return;
    }

    if (header === mountedHeader) return; // Already mounted on this header

    // Different header element — JT re-rendered the table. Tear down
    // the old decorations and remount on the new one.
    if (mountedHeader) unmount();
    mountHeader(header);
  }

  function mountHeader(header) {
    const rowsContainer = findRowsContainer(header);
    if (!rowsContainer) return; // Can't sort without rows

    mountedHeader = header;
    mountedRowsContainer = rowsContainer;

    const cells = getHeaderCells(header);
    if (cells.length !== COLUMN_COUNT) {
      // Defensive: signature changed mid-detection
      mountedHeader = null;
      mountedRowsContainer = null;
      return;
    }

    cells.forEach((cell, idx) => decorateHeaderCell(cell, idx));
  }

  function unmount() {
    if (!mountedHeader) return;

    // Restore original row order if any sort was applied
    if (originalOrder && mountedRowsContainer) {
      restoreOriginalOrder();
    }

    // Strip arrow + click handler from each header cell
    const cells = getHeaderCells(mountedHeader);
    cells.forEach(cell => {
      const arrow = cell.querySelector('.jt-doc-sort-arrow');
      if (arrow) arrow.remove();
      const spinner = cell.querySelector('.jt-doc-sort-spinner');
      if (spinner) spinner.remove();
      if (cell._jtSortHandler) {
        cell.removeEventListener('click', cell._jtSortHandler);
        delete cell._jtSortHandler;
      }
      cell.style.cursor = '';
      cell.style.userSelect = '';
    });

    mountedHeader = null;
    mountedRowsContainer = null;
    originalOrder = null;
    activeColumn = null;
    activeDirection = null;
  }

  // ─── Detection ────────────────────────────────────────────────────

  function findDocumentsHeader() {
    // Match the table's sticky header. Multiple `.sticky.z-30` elements
    // may exist (budget table also uses one); we further require all
    // five expected header texts.
    const candidates = document.querySelectorAll('div.sticky.z-30');
    for (const candidate of candidates) {
      const cells = getHeaderCells(candidate);
      if (cells.length !== COLUMN_COUNT) continue;
      const headerTexts = cells.map(c => extractHeaderText(c));
      const matches = KNOWN_LAYOUTS.some(layout =>
        layout.every((expected, idx) => headerTexts[idx] === expected)
      );
      if (matches) return candidate;
    }
    return null;
  }

  function getHeaderCells(header) {
    // The header cells are nested inside `.overflow-auto > .flex.min-w-max`.
    // Direct children of that flex row are the column cells.
    const flexRow = header.querySelector('.flex.min-w-max');
    if (!flexRow) return [];
    return Array.from(flexRow.children).filter(child => {
      // Skip child <span>s our decorator may have added; we only count
      // the cell <div>s from JT.
      return child.classList.contains('bg-gray-700');
    });
  }

  function extractHeaderText(cell) {
    // Read just the original text JT put in (ignoring our arrow span).
    // Clone, strip out our injected elements, return trimmed text.
    const clone = cell.cloneNode(true);
    clone.querySelectorAll('.jt-doc-sort-arrow, .jt-doc-sort-spinner').forEach(n => n.remove());
    return clone.textContent.trim();
  }

  function findRowsContainer(header) {
    // The rows container is the next sibling `<div class="overflow-auto
    // overscroll-x-none scrollbar-none">` after the sticky header.
    // (NOT sticky itself.) Rows are document links; today every view —
    // including Customer/Vendor — renders them job-scoped
    // (/jobs/.../documents/...), but we match on `/documents/` alone so a
    // future account-scoped path wouldn't silently break detection.
    let sibling = header.nextElementSibling;
    while (sibling) {
      if (
        !sibling.classList.contains('sticky') &&
        sibling.classList.contains('overflow-auto') &&
        sibling.querySelector(':scope > a[href*="/documents/"]')
      ) {
        return sibling;
      }
      sibling = sibling.nextElementSibling;
    }
    return null;
  }

  function getRows() {
    if (!mountedRowsContainer) return [];
    return Array.from(
      mountedRowsContainer.querySelectorAll(':scope > a[href*="/documents/"]')
    );
  }

  // ─── Header decoration ────────────────────────────────────────────

  function decorateHeaderCell(cell, columnIndex) {
    // Arrow + spinner slots. Arrow always present; spinner shown only
    // during force-load. Both are inline spans.
    const arrow = document.createElement('span');
    arrow.className = 'jt-doc-sort-arrow';
    arrow.style.cssText = 'margin-left:6px; display:inline-block; font-size:10px; opacity:0.4; vertical-align:middle;';
    arrow.textContent = '▾';
    cell.appendChild(arrow);

    const spinner = document.createElement('span');
    spinner.className = 'jt-doc-sort-spinner';
    spinner.style.cssText = 'margin-left:6px; display:none; vertical-align:middle;';
    spinner.innerHTML = `
      <svg width="12" height="12" viewBox="0 0 24 24" style="animation: jt-doc-sort-spin 0.8s linear infinite;" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round">
        <path d="M21 12a9 9 0 1 1-6.219-8.56" />
      </svg>
    `;
    cell.appendChild(spinner);

    ensureSpinKeyframes();

    cell.style.cursor = 'pointer';
    cell.style.userSelect = 'none';

    const handler = () => onHeaderClick(columnIndex);
    cell.addEventListener('click', handler);
    cell._jtSortHandler = handler;
  }

  function ensureSpinKeyframes() {
    if (document.getElementById('jt-doc-sort-keyframes')) return;
    const style = document.createElement('style');
    style.id = 'jt-doc-sort-keyframes';
    style.textContent = `
      @keyframes jt-doc-sort-spin {
        from { transform: rotate(0deg); }
        to   { transform: rotate(360deg); }
      }
    `;
    document.head.appendChild(style);
  }

  function setHeaderState(columnIndex, state) {
    // state: 'inactive' | 'asc' | 'desc' | 'loading'
    if (!mountedHeader) return;
    const cells = getHeaderCells(mountedHeader);
    cells.forEach((cell, idx) => {
      const arrow = cell.querySelector('.jt-doc-sort-arrow');
      const spinner = cell.querySelector('.jt-doc-sort-spinner');
      if (!arrow || !spinner) return;

      if (idx !== columnIndex) {
        // Non-clicked columns reset to inactive
        arrow.textContent = '▾';
        arrow.style.opacity = '0.4';
        arrow.style.display = 'inline-block';
        spinner.style.display = 'none';
        return;
      }

      // The clicked column
      if (state === 'loading') {
        arrow.style.display = 'none';
        spinner.style.display = 'inline-block';
      } else if (state === 'asc') {
        arrow.textContent = '▲';
        arrow.style.opacity = '1';
        arrow.style.display = 'inline-block';
        spinner.style.display = 'none';
      } else if (state === 'desc') {
        arrow.textContent = '▼';
        arrow.style.opacity = '1';
        arrow.style.display = 'inline-block';
        spinner.style.display = 'none';
      } else {
        arrow.textContent = '▾';
        arrow.style.opacity = '0.4';
        arrow.style.display = 'inline-block';
        spinner.style.display = 'none';
      }
    });
  }

  // ─── Click handler & state machine ────────────────────────────────

  async function onHeaderClick(columnIndex) {
    if (loadInFlight) return;

    // Determine next direction in the asc → desc → none cycle
    let nextDirection;
    if (activeColumn !== columnIndex) {
      nextDirection = 'asc';
    } else if (activeDirection === 'asc') {
      nextDirection = 'desc';
    } else if (activeDirection === 'desc') {
      nextDirection = null; // back to original order
    } else {
      nextDirection = 'asc';
    }

    if (nextDirection === null) {
      // Restore JT's original order
      restoreOriginalOrder();
      activeColumn = null;
      activeDirection = null;
      setHeaderState(columnIndex, 'inactive');
      return;
    }

    // Need every row loaded before we can correctly sort
    setHeaderState(columnIndex, 'loading');
    loadInFlight = true;
    try {
      await forceLoadAllRows();

      // Snapshot original order on first ever sort, so the cycle's "none"
      // state can restore it. Re-snapshot if our previous snapshot is
      // stale (different rows present).
      if (!originalOrder || !originalOrderMatchesCurrentRows()) {
        originalOrder = getRows();
      }

      sortRows(columnIndex, nextDirection);
      activeColumn = columnIndex;
      activeDirection = nextDirection;
      setHeaderState(columnIndex, nextDirection);
    } catch (err) {
      console.error('DocumentSort: sort failed', err);
      setHeaderState(columnIndex, 'inactive');
    } finally {
      loadInFlight = false;
    }
  }

  function originalOrderMatchesCurrentRows() {
    const current = getRows();
    if (!originalOrder || originalOrder.length !== current.length) return false;
    // Cheap check: every original row is still in the current set.
    const currentSet = new Set(current);
    return originalOrder.every(row => currentSet.has(row));
  }

  function restoreOriginalOrder() {
    if (!originalOrder || !mountedRowsContainer) return;
    originalOrder.forEach(row => {
      if (row.parentElement === mountedRowsContainer) {
        mountedRowsContainer.appendChild(row);
      }
    });
  }

  // ─── Force-load ───────────────────────────────────────────────────

  async function forceLoadAllRows() {
    const scrollEl = findScrollContainer();

    // Save the user's current scroll position so we can restore it after
    // we're done loading — otherwise the page is left jumped to the
    // bottom of the document table, which is jarring.
    const savedScroll = getScrollPosition(scrollEl);

    // Short-circuit: if the scroll container isn't actually scrollable
    // (table fits in viewport), there's nothing to lazy-load and no need
    // to bounce the page around. Skip the loop.
    if (!isScrollable(scrollEl)) return;

    const startTime = Date.now();
    let stableTicks = 0;
    let lastCount = getRows().length;

    try {
      while (stableTicks < STABLE_TICKS_REQUIRED) {
        if (Date.now() - startTime > FORCE_LOAD_TIMEOUT_MS) {
          console.warn('DocumentSort: force-load hit timeout, proceeding with rows loaded so far');
          break;
        }

        // Scroll to the very bottom of the relevant container. Most JT
        // lazy-loaders hook off IntersectionObserver on a sentinel
        // element near the end of the list — scrolling there triggers
        // fetch.
        scrollToBottom(scrollEl);

        await sleep(SCROLL_INTERVAL_MS);

        const currentCount = getRows().length;
        if (currentCount === lastCount) {
          stableTicks++;
        } else {
          stableTicks = 0;
          lastCount = currentCount;
        }
      }
    } finally {
      // Always restore — even on timeout / error — so the user lands
      // back where they were. Use instant (non-smooth) so it snaps
      // cleanly without an extra animation.
      restoreScrollPosition(scrollEl, savedScroll);
    }
  }

  function findScrollContainer() {
    // Walk up from the rows container looking for an ancestor with
    // overflow-y: auto/scroll. JT's main content area is typically the
    // scroll target. Falls back to window.
    if (!mountedRowsContainer) return window;
    let node = mountedRowsContainer.parentElement;
    while (node && node !== document.body) {
      const style = window.getComputedStyle(node);
      const overflowY = style.overflowY;
      if ((overflowY === 'auto' || overflowY === 'scroll') && node.scrollHeight > node.clientHeight) {
        return node;
      }
      node = node.parentElement;
    }
    return window;
  }

  function isScrollable(scrollEl) {
    if (scrollEl === window) {
      return document.documentElement.scrollHeight > window.innerHeight;
    }
    return scrollEl && scrollEl.scrollHeight > scrollEl.clientHeight;
  }

  function getScrollPosition(scrollEl) {
    if (scrollEl === window) {
      return window.scrollY || document.documentElement.scrollTop || 0;
    }
    return scrollEl ? scrollEl.scrollTop : 0;
  }

  function scrollToBottom(scrollEl) {
    if (scrollEl === window) {
      window.scrollTo({ top: document.documentElement.scrollHeight, behavior: 'auto' });
    } else if (scrollEl && typeof scrollEl.scrollTo === 'function') {
      scrollEl.scrollTo({ top: scrollEl.scrollHeight, behavior: 'auto' });
    } else if (scrollEl) {
      scrollEl.scrollTop = scrollEl.scrollHeight;
    }
  }

  function restoreScrollPosition(scrollEl, y) {
    if (scrollEl === window) {
      window.scrollTo({ top: y, behavior: 'auto' });
    } else if (scrollEl && typeof scrollEl.scrollTo === 'function') {
      scrollEl.scrollTo({ top: y, behavior: 'auto' });
    } else if (scrollEl) {
      scrollEl.scrollTop = y;
    }
  }

  function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  // ─── Sort implementation ──────────────────────────────────────────

  function sortRows(columnIndex, direction) {
    const rows = getRows();
    if (rows.length < 2) return;

    const comparator = buildComparator(columnIndex);
    rows.sort((a, b) => {
      const result = comparator(a, b);
      return direction === 'asc' ? result : -result;
    });

    // Reorder by appendChild — preserves React internals and event
    // listeners on the row elements.
    rows.forEach(row => mountedRowsContainer.appendChild(row));
  }

  function buildComparator(columnIndex) {
    // Each row is an <a> with 5 child <div>s (one per column).
    return (a, b) => {
      const ka = extractSortKey(a, columnIndex);
      const kb = extractSortKey(b, columnIndex);
      return compareKeys(ka, kb, columnIndex);
    };
  }

  function extractSortKey(row, columnIndex) {
    const cells = row.children;
    if (!cells || cells.length <= columnIndex) return null;
    const cell = cells[columnIndex];

    if (columnIndex === 0 || columnIndex === 1) {
      // Name / Account — use the bold primary line, fall back to full cell text
      const bold = cell.querySelector('.font-bold');
      return (bold ? bold.textContent : cell.textContent).trim().toLowerCase();
    }
    if (columnIndex === 2) {
      // Subject — plain text
      return cell.textContent.trim().toLowerCase();
    }
    if (columnIndex === 3) {
      // Status — return composite key { rank, date } for status-then-date sort
      const statusEl = cell.querySelector('.uppercase.font-bold');
      const status = statusEl ? statusEl.textContent.trim().toLowerCase() : '';
      const rank = status in STATUS_ORDER ? STATUS_ORDER[status] : UNKNOWN_STATUS_RANK;

      const timeEl = cell.querySelector('time');
      const dateAttr = timeEl ? timeEl.getAttribute('datetime') : '';
      // Date string sorts lexicographically because ISO format (YYYY-MM-DD).
      return { rank, date: dateAttr || '' };
    }
    if (columnIndex === 4) {
      // Amount — parse `$8,100.00`, `-$912.65`, etc. Empty → -Infinity so
      // missing amounts sort to the start in ascending direction.
      const text = cell.textContent.trim();
      if (!text) return -Infinity;
      const negative = text.startsWith('-');
      const cleaned = text.replace(/[^\d.]/g, '');
      const num = parseFloat(cleaned);
      if (isNaN(num)) return -Infinity;
      return negative ? -num : num;
    }
    return null;
  }

  function compareKeys(a, b, columnIndex) {
    if (columnIndex === 3) {
      // Status composite: rank first, date as tiebreaker.
      if (a.rank !== b.rank) return a.rank - b.rank;
      if (a.date < b.date) return -1;
      if (a.date > b.date) return 1;
      return 0;
    }
    if (typeof a === 'number' && typeof b === 'number') {
      return a - b;
    }
    // String compare (Name / Account / Subject). Empty strings go last
    // in ascending direction.
    if (!a && !b) return 0;
    if (!a) return 1;
    if (!b) return -1;
    return a.localeCompare(b);
  }

  return {
    init,
    cleanup,
    isActive: () => isActive,
  };
})();

window.DocumentSortFeature = DocumentSortFeature;
