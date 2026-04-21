/**
 * JT Power Tools - Invoice Forecast Feature (SKETCH)
 *
 * NOT WIRED INTO content.js / manifest.json / popup. Design review only.
 *
 * Injects an "Invoice Forecast" tab into JobTread's /reports tab bar
 * alongside Exports / Data Browser / Cost Mapping. When clicked, hides
 * JT's report content pane and renders our own forecast view in its place.
 *
 * DOM reference — JT's tab bar structure on /reports:
 *   <div class="shrink-0">
 *     <div class="flex overflow-auto border-b">
 *       <div class="shrink-0 border-r">               <!-- active tab wrapper -->
 *         <a class="... border-t-2 border-jtOrange bg-gray-50">Exports</a>
 *       </div>
 *       <div class="shrink-0 border-t border-r">      <!-- inactive tab wrapper -->
 *         <a class="... border-t border-white hover:...">Data Browser</a>
 *       </div>
 *       <div class="shrink-0 border-t border-r">
 *         <a class="... border-t border-white hover:...">Cost Mapping</a>
 *       </div>
 *       <div class="border-t grow min-w-0"></div>     <!-- filler -->
 *     </div>
 *   </div>
 *
 * Our tab is inserted BEFORE the filler div. Uses the same classes as the
 * inactive tabs so it's visually indistinguishable.
 */

const InvoiceForecastFeature = (() => {
  let isActiveState = false;
  let observer = null;
  let urlCheckInterval = null;
  let eventListeners = [];
  let isMounted = false;      // our panel currently displayed
  let hiddenReportPane = null; // reference to JT's content pane we hid

  const TAB_ID = 'jt-pt-invoice-forecast-tab';
  const PANEL_ID = 'jt-pt-invoice-forecast-panel';

  // ─── LIFECYCLE ───────────────────────────────────────────────

  function init() {
    if (isActiveState) return;
    isActiveState = true;
    console.log('InvoiceForecast: Initializing...');

    injectStyles();
    setupUrlWatcher();
    setupDomObserver();
    tryInject();

    console.log('InvoiceForecast: Initialized');
  }

  function cleanup() {
    if (!isActiveState) return;
    console.log('InvoiceForecast: Cleaning up...');

    unmountPanel();
    removeTab();
    removeStyles();

    eventListeners.forEach(({ el, evt, fn }) => el.removeEventListener(evt, fn));
    eventListeners = [];

    if (observer) { observer.disconnect(); observer = null; }
    if (urlCheckInterval) { clearInterval(urlCheckInterval); urlCheckInterval = null; }

    isActiveState = false;
    console.log('InvoiceForecast: Cleaned up');
  }

  // ─── VIEW DETECTION ──────────────────────────────────────────

  function isReportsPage() {
    return location.pathname === '/reports' || location.pathname.startsWith('/reports/');
  }

  function findTabBar() {
    // The tab bar: flex container with border-b, containing children whose
    // <a> hrefs start with /reports. Keyed on the nav anchors, not fragile
    // class strings.
    const anchors = document.querySelectorAll('a[href^="/reports"]');
    for (const a of anchors) {
      const bar = a.closest('.flex.overflow-auto.border-b');
      if (bar) return bar;
    }
    return null;
  }

  function findReportContentPane(tabBar) {
    // The content pane is the tab bar's grandparent's next sibling, typically.
    // Safer: walk up until we find the reports route container.
    let node = tabBar.parentElement;
    while (node && node !== document.body) {
      const sib = node.nextElementSibling;
      if (sib && sib.clientHeight > 100) return sib;
      node = node.parentElement;
    }
    return null;
  }

  // ─── INJECTION ───────────────────────────────────────────────

  function tryInject() {
    if (!isReportsPage()) { removeTab(); unmountPanel(); return; }
    if (document.getElementById(TAB_ID)) return;  // already injected

    const tabBar = findTabBar();
    if (!tabBar) return;

    const filler = tabBar.querySelector('.grow.min-w-0');
    const wrapper = document.createElement('div');
    wrapper.id = TAB_ID;
    wrapper.className = 'shrink-0 border-t border-r';

    const anchor = document.createElement('a');
    anchor.href = '#';
    anchor.dataset.jtPtTab = 'invoice-forecast';
    anchor.className = [
      'inline-block', 'align-bottom', 'relative', 'cursor-pointer',
      'font-bold', 'px-5', 'py-3', 'text-gray-800',
      'active:bg-gray-100',
      'border-t', 'border-white', 'hover:border-gray-50', 'hover:bg-gray-50'
    ].join(' ');
    anchor.textContent = 'Invoice Forecast';

    addListener(anchor, 'click', onTabClick);
    wrapper.appendChild(anchor);

    if (filler) tabBar.insertBefore(wrapper, filler);
    else tabBar.appendChild(wrapper);

    // If user navigates between JT's own tabs, unmount us.
    tabBar.querySelectorAll('a[href^="/reports"]:not([data-jt-pt-tab])').forEach(a => {
      addListener(a, 'click', unmountPanel);
    });
  }

  function removeTab() {
    document.getElementById(TAB_ID)?.remove();
  }

  // ─── TAB CLICK → PANEL SWAP ──────────────────────────────────

  function onTabClick(e) {
    e.preventDefault();
    e.stopPropagation();

    // Visually mark our tab active, deactivate JT's tabs
    markActive(e.currentTarget);

    mountPanel();
  }

  function markActive(ourAnchor) {
    const tabBar = ourAnchor.closest('.flex.overflow-auto.border-b');
    if (!tabBar) return;

    tabBar.querySelectorAll('a').forEach(a => {
      a.classList.remove('border-t-2', 'border-jtOrange', 'bg-gray-50');
      if (!a.classList.contains('border-t')) a.classList.add('border-t');
      if (!a.classList.contains('border-white')) a.classList.add('border-white');
      a.parentElement?.classList.add('border-t');
    });

    ourAnchor.classList.remove('border-t', 'border-white');
    ourAnchor.classList.add('border-t-2', 'border-jtOrange', 'bg-gray-50');
    ourAnchor.parentElement?.classList.remove('border-t');
  }

  function mountPanel() {
    if (isMounted) return;
    const tabBar = findTabBar();
    if (!tabBar) return;

    const pane = findReportContentPane(tabBar);
    if (pane) {
      hiddenReportPane = pane;
      pane.style.display = 'none';
    }

    const panel = document.createElement('div');
    panel.id = PANEL_ID;
    panel.className = 'jt-pt-invoice-forecast-panel';
    panel.innerHTML = `
      <div class="jt-pt-if-header">
        <h2>Invoice Forecast</h2>
        <div class="jt-pt-if-meta">
          <span class="jt-pt-if-last-updated">Last updated: —</span>
          <button class="jt-pt-if-refresh">Update</button>
          <button class="jt-pt-if-export">Export CSV</button>
        </div>
      </div>
      <div class="jt-pt-if-body">
        <div class="jt-pt-if-loading">Press Update to load your forecast.</div>
        <!-- Rendered on data load:
             - Summary tiles (grand total, slipping total, unscheduled total)
             - Monthly timeline bars (stacked by status)
             - Filterable table
        -->
      </div>
    `;

    hiddenReportPane?.parentElement?.insertBefore(panel, hiddenReportPane);

    addListener(panel.querySelector('.jt-pt-if-refresh'), 'click', onRefreshClick);
    addListener(panel.querySelector('.jt-pt-if-export'), 'click', onExportClick);

    isMounted = true;

    // Warm-load the cached snapshot (if any) without triggering a refresh.
    loadSnapshot();
  }

  function unmountPanel() {
    if (!isMounted) return;
    document.getElementById(PANEL_ID)?.remove();
    if (hiddenReportPane) { hiddenReportPane.style.display = ''; hiddenReportPane = null; }
    isMounted = false;
  }

  // ─── DATA ────────────────────────────────────────────────────

  async function loadSnapshot() {
    // Hit the pro worker via existing JobTreadProService
    // Extension-side service method to add:
    //   proService.getInvoiceForecast() → { empty?, lastUpdatedAt, records, aggregates }
    try {
      const res = await window.JobTreadProService.workerRequest('getInvoiceForecast');
      if (res?.empty) { renderEmpty(); return; }
      render(res);
    } catch (err) {
      console.error('InvoiceForecast: loadSnapshot failed', err);
      renderError(err);
    }
  }

  async function onRefreshClick() {
    setLoading(true);
    try {
      const res = await window.JobTreadProService.workerRequest('refreshInvoiceForecast', {
        options: readUserOptions()
      });
      render(res);
    } catch (err) {
      console.error('InvoiceForecast: refresh failed', err);
      renderError(err);
    } finally {
      setLoading(false);
    }
  }

  function onExportClick() {
    // Serialize current records to CSV client-side from the mounted snapshot.
    // Stubbed — implement when rendering is built out.
    console.log('InvoiceForecast: CSV export (TODO)');
  }

  function readUserOptions() {
    // TODO: pull user prefs from chrome.storage.sync
    //   { includeStatuses: ['draft','pending','approved','sent'],
    //     includePaid: false,
    //     dateSource: 'taskStart' }
    return {};
  }

  // ─── RENDER (stubs — fill in during implementation) ──────────

  function render(snapshot) {
    const panel = document.getElementById(PANEL_ID);
    if (!panel) return;
    const body = panel.querySelector('.jt-pt-if-body');
    body.textContent = `Loaded ${snapshot.count} invoices. Last updated ${snapshot.lastUpdatedAt}.`;
    // TODO: render summary tiles, timeline, table
  }

  function renderEmpty() {
    const body = document.querySelector(`#${PANEL_ID} .jt-pt-if-body`);
    if (body) body.textContent = 'No forecast yet. Press Update to build one.';
  }

  function renderError(err) {
    const body = document.querySelector(`#${PANEL_ID} .jt-pt-if-body`);
    if (body) body.textContent = `Error: ${err.message}`;
  }

  function setLoading(loading) {
    const btn = document.querySelector(`#${PANEL_ID} .jt-pt-if-refresh`);
    if (btn) { btn.disabled = loading; btn.textContent = loading ? 'Updating…' : 'Update'; }
  }

  // ─── OBSERVERS ───────────────────────────────────────────────

  function setupDomObserver() {
    // React re-renders can wipe our injected tab. Reinject whenever the
    // reports DOM changes and we're still on /reports.
    observer = new MutationObserver(() => {
      if (!isReportsPage()) return;
      if (!document.getElementById(TAB_ID)) tryInject();
    });
    observer.observe(document.body, { childList: true, subtree: true });
  }

  function setupUrlWatcher() {
    // SPA route changes don't fire popstate reliably — poll.
    let lastPath = location.pathname;
    urlCheckInterval = setInterval(() => {
      if (location.pathname === lastPath) return;
      lastPath = location.pathname;
      if (!isReportsPage()) { removeTab(); unmountPanel(); }
      else tryInject();
    }, 500);
  }

  // ─── STYLES ──────────────────────────────────────────────────
  // TODO: move to styles/invoice-forecast.css and load via
  // chrome.runtime.getURL + manifest web_accessible_resources.

  function injectStyles() {
    const s = document.createElement('style');
    s.id = 'jt-pt-invoice-forecast-styles';
    s.textContent = `
      .jt-pt-invoice-forecast-panel { padding: 16px; }
      .jt-pt-if-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 16px; }
      .jt-pt-if-header h2 { font-size: 18px; font-weight: 600; margin: 0; }
      .jt-pt-if-meta { display: flex; gap: 8px; align-items: center; }
      .jt-pt-if-last-updated { color: #6b7280; font-size: 12px; }
      .jt-pt-if-refresh, .jt-pt-if-export {
        padding: 6px 12px; border: 1px solid #d1d5db; border-radius: 4px;
        background: #fff; font-weight: 500; cursor: pointer;
      }
      .jt-pt-if-refresh:hover, .jt-pt-if-export:hover { background: #f9fafb; }
      body.jt-dark-mode .jt-pt-invoice-forecast-panel { background: #2c2c2c; color: #e0e0e0; }
      body.jt-dark-mode .jt-pt-if-refresh,
      body.jt-dark-mode .jt-pt-if-export {
        background: #333; border-color: #505050; color: #e0e0e0;
      }
      body.jt-dark-mode .jt-pt-if-refresh:hover,
      body.jt-dark-mode .jt-pt-if-export:hover { background: #3a3a3a; }
    `;
    document.head.appendChild(s);
  }

  function removeStyles() {
    document.getElementById('jt-pt-invoice-forecast-styles')?.remove();
  }

  // ─── UTILS ───────────────────────────────────────────────────

  function addListener(el, evt, fn) {
    if (!el) return;
    el.addEventListener(evt, fn);
    eventListeners.push({ el, evt, fn });
  }

  return { init, cleanup, isActive: () => isActiveState };
})();

window.InvoiceForecastFeature = InvoiceForecastFeature;
