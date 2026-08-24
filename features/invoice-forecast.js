/**
 * JT Power Tools - Invoice Forecast (Power User)
 *
 * Injects an "Invoice Forecast" tab into JobTread's /reports tab bar. When
 * clicked, hides JT's report pane and renders a monthly bar chart of projected
 * invoice releases: a solid COMMITTED base (invoices on sold jobs) + a hatched
 * PROJECTED cap (invoices on not-yet-sold jobs). Per-job detail on hover.
 *
 * Data (via Pro Worker → Pave, with direct JobTreadAPI fallback for multi-org):
 *   - customerInvoice docs whose linked task is one of the user-chosen task
 *     types, on OPEN jobs only; dated by task.startDate. Document status ignored.
 *   - "Sold" = the invoice's job has an approved contract document whose name the
 *     user configures (e.g. "Home Improvement Agreement").
 *
 * Both the invoice task type(s) and the sold-contract name(s) are user-chosen,
 * multi-select, and stored per-org — nothing is hardcoded per JobTread org.
 *
 * @module InvoiceForecastFeature
 * @requires JobTreadProService | JobTreadAPI, Sanitizer
 */
const InvoiceForecastFeature = (() => {
  let isActiveState = false;
  let observer = null;
  let urlCheckInterval = null;
  let eventListeners = [];
  let styleElement = null;
  let isMounted = false;
  let hiddenReportPanes = []; // JT content siblings we hid (restored on unmount)

  const TAB_ID = 'jt-if-tab';
  const PANEL_ID = 'jt-if-panel';
  const CONFIG_KEY = 'jtInvoiceForecastConfig';   // { [orgKey]: { taskTypeIds, soldContractNames } }

  // Per-org config + loaded data
  let orgKey = 'default';
  // from/to are 'YYYY-MM' ('' = unbounded; from undefined = default to current month)
  let config = { taskTypeIds: [], soldContractNames: [], from: undefined, to: '', includeClosed: false };
  let taskTypeOptions = [];      // [{ id, name }]
  let contractNameOptions = [];  // [{ name, count }]
  let snapshot = null;           // aggregates { byMonth, totals, soldConfigured }
  let currentRecords = [];       // normalized invoice records (drives the detail table)
  let isLoading = false;
  let lastError = null;

  // ─── LIFECYCLE ───────────────────────────────────────────────

  async function init() {
    if (isActiveState) return;
    isActiveState = true;
    console.log('InvoiceForecast: Initializing...');

    injectStyles();
    await resolveOrgKey();
    await loadConfig();
    setupUrlWatcher();
    setupDomObserver();
    // Close any open picker menu on outside click
    addListener(document, 'click', onDocumentClick);
    // React to org switches (per-org views + forecasts)
    addListener(window, 'jt-org-changed', onOrgChanged);
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

    snapshot = null;
    currentRecords = [];
    lastError = null;
    isActiveState = false;
    console.log('InvoiceForecast: Cleaned up');
  }

  // ─── CONFIG (per-org) ────────────────────────────────────────

  async function resolveOrgKey() {
    // Canonical active org from the shared resolver — keeps config/views per-org
    // and consistent with tweaks/forms.
    const active = window.OrgDetector && typeof window.OrgDetector.getActiveOrg === 'function' && window.OrgDetector.getActiveOrg();
    if (active) { orgKey = active; return; }
    try {
      if (typeof JobTreadProService !== 'undefined' && JobTreadProService.getOrgInfo) {
        const info = await JobTreadProService.getOrgInfo();
        orgKey = info?.orgId || info?.orgName || 'default';
      } else {
        orgKey = 'default';
      }
    } catch (e) { orgKey = 'default'; }
  }

  // The user switched orgs in JobTread — re-key config to the new org and reload
  // its options + forecast (picker options and data are both per-org).
  async function onOrgChanged() {
    await resolveOrgKey();
    await loadConfig();
    taskTypeOptions = [];
    contractNameOptions = [];
    if (isMounted) await bootstrap();
  }

  async function loadConfig() {
    try {
      const res = await chrome.storage.sync.get([CONFIG_KEY]);
      const all = res[CONFIG_KEY] || {};
      const saved = all[orgKey];
      if (saved) {
        config = {
          taskTypeIds: Array.isArray(saved.taskTypeIds) ? saved.taskTypeIds : [],
          soldContractNames: Array.isArray(saved.soldContractNames) ? saved.soldContractNames : [],
          from: saved.from !== undefined ? saved.from : undefined,
          to: typeof saved.to === 'string' ? saved.to : '',
          includeClosed: saved.includeClosed === true
        };
      }
    } catch (e) { /* keep defaults */ }
    // Default the lower bound to the current month so past invoices ("the past
    // is past") don't clutter the view. Users can clear it to see everything.
    if (config.from === undefined) config.from = currentMonth();
  }

  function currentMonth() {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
  }

  // 'YYYY-MM' → first day; → last day. Empty input → null (unbounded).
  function monthToFromDate(ym) {
    return ym ? `${ym}-01` : null;
  }
  function monthToToDate(ym) {
    if (!ym) return null;
    const [y, m] = ym.split('-').map(Number);
    const last = new Date(y, m, 0).getDate();
    return `${ym}-${String(last).padStart(2, '0')}`;
  }

  async function saveConfig() {
    try {
      const res = await chrome.storage.sync.get([CONFIG_KEY]);
      const all = res[CONFIG_KEY] || {};
      all[orgKey] = config;
      await chrome.storage.sync.set({ [CONFIG_KEY]: all });
    } catch (e) { /* ignore */ }
    syncConfigToServer();
  }

  // Best-effort push of the ORG config (task types + sold names — never the
  // from/to/includeClosed view state) to the Pro Worker so the MCP server can
  // serve chart-parity forecasts. Fire-and-forget: a failed sync never blocks
  // the chart; the MCP just sees stale config until the next successful save.
  async function syncConfigToServer() {
    try {
      if (!config.taskTypeIds.length) return;
      if (!proServiceReady() || !(await JobTreadProService.isConfigured())) return;
      await JobTreadProService.saveInvoiceForecastConfig({
        taskTypeIds: config.taskTypeIds,
        soldContractNames: config.soldContractNames
      });
    } catch (e) { /* best-effort */ }
  }

  // ─── VIEW DETECTION + INJECTION ──────────────────────────────

  function isReportsPage() {
    return location.pathname === '/reports' || location.pathname.startsWith('/reports/');
  }

  function findTabBar() {
    const anchors = document.querySelectorAll('a[href^="/reports"]');
    for (const a of anchors) {
      const bar = a.closest('.flex.overflow-auto.border-b');
      if (bar) return bar;
    }
    return null;
  }

  /* ---- Collapsed (narrow-viewport) tab strip --------------------------------
     JobTread renders the reports tabs two completely different ways. Wide: the
     horizontal scrolling bar findTabBar() looks for. Narrow: a hamburger
     trigger showing the current tab name, which opens a dropdown list of
     anchors. They share no markup — the collapsed form has no
     `.flex.overflow-auto.border-b` anywhere — so findTabBar() returned null,
     tryInject() bailed at its first guard, and the Invoice Forecast tab was
     simply never created on a small screen. Not hidden, never built.

     The trigger is identified by its hamburger icon path rather than by its
     Tailwind classes: the classes encode active state (`border-t-jtOrange`
     comes and goes) while the icon is what the control *is*. Matching host
     SVG paths is the same technique auto-collapse-groups.js and
     task-completion.js already use against JobTread's DOM. */
  const HAMBURGER_PATH = 'M4 5h16M4 12h16M4 19h16';

  function findCollapsedTrigger() {
    for (const p of document.querySelectorAll(`svg path[d="${HAMBURGER_PATH}"]`)) {
      const btn = p.closest('[role="button"]');
      // `.grow` holds the current tab's name — it is what separates this
      // control from any other hamburger JobTread may render on the page.
      if (btn && btn.querySelector('.grow')) return btn;
    }
    return null;
  }

  /* The open dropdown. Found via its own anchors rather than its container
     classes, which are generic (`shadow-lg`, `max-w-xs`) and shared with every
     other popover in the app. Requiring two or more report links keeps a lone
     link elsewhere on the page from being mistaken for the menu. Returns null
     while the menu is closed, since JobTread removes it from the DOM. */
  function findCollapsedMenu() {
    for (const a of document.querySelectorAll('a[href^="/reports"].block.w-full')) {
      const menu = a.parentElement;
      if (menu && menu.querySelectorAll('a[href^="/reports"]').length >= 2) return menu;
    }
    return null;
  }

  /* The element to hang the panel's mount context off, whichever layout is
     live. findMountContext() walks up from here looking for the report content
     region, and that walk works from the trigger exactly as it does from the
     wide bar — but NOT from the dropdown, which is a popover with no content
     region after it. */
  function findTabStrip() {
    return findTabBar() || findCollapsedTrigger();
  }

  // Find the wrapper that holds the tab bar plus the report content region that
  // follows it. Returns the wrapper AND every following sibling, so we can hide
  // the whole content region — not just the first block — when our panel mounts.
  // (Some tabs, e.g. Exports, render their content across multiple siblings;
  // hiding only the first let the rest bleed in below our panel.)
  function findMountContext(tabBar) {
    let node = tabBar.parentElement;
    while (node && node !== document.body) {
      const siblings = [];
      for (let s = node.nextElementSibling; s; s = s.nextElementSibling) siblings.push(s);
      if (siblings.some(el => el.clientHeight > 100)) return { wrapper: node, siblings };
      node = node.parentElement;
    }
    return null;
  }

  /* Build our row inside the collapsed dropdown, matching the shape of
     JobTread's own entries: an anchor carrying the row classes wrapping a
     `border-b p-3 font-bold` label. Placed before the trailing Close button so
     it reads as one of the tabs rather than an afterthought below the list. */
  function injectIntoCollapsedMenu(menu) {
    const wrapper = document.createElement('div');
    wrapper.id = TAB_ID;

    const anchor = document.createElement('a');
    anchor.href = '#';
    anchor.dataset.jtIfTab = '1';
    anchor.dataset.jtIfCollapsed = '1';
    anchor.className = MENU_ITEM_BASE.join(' ');

    const label = document.createElement('div');
    label.className = 'border-b p-3 font-bold';
    label.textContent = 'Invoice Forecast';
    anchor.appendChild(label);

    addListener(anchor, 'click', onTabClick);
    wrapper.appendChild(anchor);

    // The Close control is a role=button, unlike the anchors above it.
    const closeBtn = menu.querySelector(':scope > [role="button"]');
    if (closeBtn) menu.insertBefore(wrapper, closeBtn);
    else menu.appendChild(wrapper);

    menu.querySelectorAll('a[href^="/reports"]:not([data-jt-if-tab])').forEach(a => {
      addListener(a, 'click', unmountPanel);
    });

    setTabActive(isMounted);
  }

  function tryInject() {
    if (!isReportsPage()) { removeTab(); unmountPanel(); return; }
    if (document.getElementById(TAB_ID)) return;

    const tabBar = findTabBar();
    if (!tabBar) {
      // Narrow layout: no wide bar exists. Inject into the dropdown instead,
      // but only while it is open — JobTread removes it from the DOM on close,
      // taking our row with it, and the observer re-injects on the next open.
      const menu = findCollapsedMenu();
      if (menu) injectIntoCollapsedMenu(menu);
      return;
    }

    const filler = tabBar.querySelector('.grow.min-w-0');
    const wrapper = document.createElement('div');
    wrapper.id = TAB_ID;
    wrapper.className = 'shrink-0 border-t border-r';

    const anchor = document.createElement('a');
    anchor.href = '#';
    anchor.dataset.jtIfTab = '1';
    anchor.className = [
      'inline-block', 'align-bottom', 'relative', 'cursor-pointer',
      'font-bold', 'px-5', 'py-3', 'text-gray-800',
      'active:bg-gray-100', 'border-t', 'border-white',
      'hover:border-gray-50', 'hover:bg-gray-50'
    ].join(' ');
    anchor.textContent = 'Invoice Forecast';

    addListener(anchor, 'click', onTabClick);
    wrapper.appendChild(anchor);

    if (filler) tabBar.insertBefore(wrapper, filler);
    else tabBar.appendChild(wrapper);

    // Clicking a native JT report tab unmounts our panel
    tabBar.querySelectorAll('a[href^="/reports"]:not([data-jt-if-tab])').forEach(a => {
      addListener(a, 'click', unmountPanel);
    });

    // Reflect current state — if React re-injected the bar while our panel is
    // open, the fresh tab must come back active; otherwise inactive.
    setTabActive(isMounted);
  }

  function removeTab() {
    const el = document.getElementById(TAB_ID);
    if (el) el.remove();
  }

  const TAB_ACTIVE = ['border-t-2', 'border-jtOrange', 'bg-gray-50'];
  const TAB_INACTIVE = ['border-t', 'border-white'];

  /* The dropdown marks its active row differently from the wide bar: the row
     is `border-l-2` throughout and gains `border-jtOrange bg-gray-50` when
     selected, where the wide bar swaps a top border. Applying the wide bar's
     classes to a menu row would draw an orange line along the wrong edge. */
  const MENU_ITEM_BASE = [
    'block', 'w-full', 'relative', 'cursor-pointer', 'border-l-2',
    'hover:bg-gray-50', 'active:bg-gray-100'
  ];
  const MENU_ACTIVE = ['border-jtOrange', 'bg-gray-50'];

  function onTabClick(e) {
    e.preventDefault();
    e.stopPropagation();
    mountPanel();
  }

  function getOurAnchor() {
    return document.querySelector(`#${TAB_ID} a[data-jt-if-tab]`);
  }

  // Our tab's highlight reflects ONLY whether our panel is mounted — applied at
  // inject time and on mount/unmount, so it never gets stuck "active".
  function setTabActive(active) {
    const a = getOurAnchor();
    if (!a) return;
    // Which class set applies depends on which layout our tab landed in.
    const [on, off] = a.dataset.jtIfCollapsed
      ? [MENU_ACTIVE, []]
      : [TAB_ACTIVE, TAB_INACTIVE];
    if (active) {
      if (off.length) a.classList.remove(...off);
      a.classList.add(...on);
    } else {
      a.classList.remove(...on);
      if (off.length) a.classList.add(...off);
    }
  }

  // Best-effort: drop the active styling on JobTread's own tabs while our panel
  // is shown so only our tab reads as active. The URL is unchanged by design,
  // so JT's router won't re-highlight unless it re-renders for another reason.
  function deactivateNativeTabs() {
    const bar = findTabBar();
    if (bar) {
      bar.querySelectorAll('a[href^="/reports"]:not([data-jt-if-tab])').forEach(a => {
        a.classList.remove('border-t-2', 'border-jtOrange', 'bg-gray-50');
        if (!a.classList.contains('border-t')) a.classList.add('border-t');
        if (!a.classList.contains('border-white')) a.classList.add('border-white');
      });
      return;
    }
    // Collapsed layout: only the orange left border and tint mark the active
    // row, and there is no inactive class to restore in its place.
    const menu = findCollapsedMenu();
    if (!menu) return;
    menu.querySelectorAll('a[href^="/reports"]:not([data-jt-if-tab])').forEach(a => {
      a.classList.remove(...MENU_ACTIVE);
    });
  }

  function mountPanel() {
    if (isMounted) return;
    // Whichever strip is live. On a narrow viewport this is the hamburger
    // trigger; anchoring to the dropdown instead would not work, since the
    // menu is a popover with no report content region following it — and it
    // is about to be closed anyway.
    const tabBar = findTabStrip();
    if (!tabBar) return;

    const panel = document.createElement('div');
    panel.id = PANEL_ID;
    panel.className = 'jt-if-panel';

    const ctx = findMountContext(tabBar);
    if (ctx) {
      // Hide the WHOLE report content region so the previous tab's content
      // (e.g. Exports) can't bleed in below our panel. Remember each element's
      // prior inline display so unmount restores it exactly.
      hiddenReportPanes = ctx.siblings;
      hiddenReportPanes.forEach(elem => {
        elem.dataset.jtIfPrevDisplay = elem.style.display || '';
        elem.style.display = 'none';
      });
      ctx.wrapper.parentElement.insertBefore(panel, ctx.wrapper.nextSibling);
    } else {
      tabBar.parentElement.appendChild(panel);
    }

    isMounted = true;
    setTabActive(true);
    deactivateNativeTabs();

    renderPanelShell();
    bootstrap();
  }

  function unmountPanel() {
    if (!isMounted) return;
    const el = document.getElementById(PANEL_ID);
    if (el) el.remove();
    hiddenReportPanes.forEach(node => {
      if (node && node.isConnected) {
        node.style.display = node.dataset.jtIfPrevDisplay || '';
        delete node.dataset.jtIfPrevDisplay;
      }
    });
    hiddenReportPanes = [];
    isMounted = false;
    setTabActive(false);
  }

  // ─── DATA ────────────────────────────────────────────────────

  async function bootstrap() {
    // Load picker options (task types + contract names) once, then forecast.
    try {
      if (!taskTypeOptions.length || !contractNameOptions.length) {
        const [types, names] = await Promise.all([fetchTaskTypes(), fetchContractNames()]);
        taskTypeOptions = types;
        contractNameOptions = names;
      }
    } catch (e) {
      console.warn('InvoiceForecast: option load failed', e);
    }
    renderHeaderControls();

    if (!config.taskTypeIds.length) {
      renderUnconfigured();
      return;
    }
    await loadForecast();
  }

  async function loadForecast() {
    if (isLoading) return;
    isLoading = true;
    lastError = null;
    renderBodyLoading();
    try {
      currentRecords = await fetchForecastRecords();
      snapshot = aggregate(currentRecords);
      renderChart();
    } catch (err) {
      console.error('InvoiceForecast: forecast load failed', err);
      lastError = err.message || String(err);
      renderError();
    } finally {
      isLoading = false;
    }
  }

  function proServiceReady() {
    return typeof JobTreadProService !== 'undefined' &&
      typeof JobTreadProService.getInvoiceForecast === 'function';
  }

  // True when the org resolver knows which org the user is currently viewing.
  // In that case we use the active-org-aware JobTreadAPI path so views and
  // forecasts are scoped to the viewed org (the Pro Worker is single-org).
  function orgResolverActive() {
    return typeof JobTreadAPI !== 'undefined' &&
      !!(window.OrgDetector && typeof window.OrgDetector.getActiveOrg === 'function' && window.OrgDetector.getActiveOrg());
  }

  async function preferDirect() {
    return orgResolverActive() && await JobTreadAPI.isConfigured();
  }

  // Active org id via the canonical resolver (OrgDetector + GrantKeyResolver),
  // falling back to the first membership only if that's unavailable.
  async function resolveActiveOrgId() {
    if (typeof JobTreadAPI !== 'undefined' && typeof JobTreadAPI.getOrgId === 'function') {
      const id = await JobTreadAPI.getOrgId();
      if (id) return id;
    }
    return await discoverOrgId();
  }

  async function fetchTaskTypes() {
    if (!(await preferDirect()) && proServiceReady() && await JobTreadProService.isConfigured()) {
      return await JobTreadProService.getTaskTypes();
    }
    const orgId = await resolveActiveOrgId();
    let all = [], page;
    do {
      const params = { size: 100 };
      if (page) params.page = page;
      const r = await JobTreadAPI.paveQuery({
        organization: { $: { id: orgId }, taskTypes: { $: params, nextPage: {}, nodes: { id: {}, name: {} } } }
      });
      all = all.concat(r?.organization?.taskTypes?.nodes || []);
      page = r?.organization?.taskTypes?.nextPage || null;
    } while (page);
    return all;
  }

  async function fetchContractNames() {
    if (!(await preferDirect()) && proServiceReady() && await JobTreadProService.isConfigured()) {
      return await JobTreadProService.getContractDocNames();
    }
    const orgId = await resolveActiveOrgId();
    const r = await JobTreadAPI.paveQuery({
      organization: {
        $: { id: orgId },
        documents: {
          $: { where: { and: [['type', '=', 'customerOrder']] }, group: { by: ['name'], aggs: { count: { count: [] } } } },
          withValues: {}
        }
      }
    });
    return (r?.organization?.documents?.withValues || [])
      .map(v => ({ name: v.name, count: v.count || 0 }))
      .filter(v => v.name)
      .sort((a, b) => b.count - a.count);
  }

  // Returns normalized records [{ amount, expectedMonth, jobSold, job, task, status }]
  async function fetchForecastRecords() {
    const from = monthToFromDate(config.from);
    const to = monthToToDate(config.to);
    const options = {
      taskTypeIds: config.taskTypeIds,
      soldContractNames: config.soldContractNames,
      from, to, includeClosed: config.includeClosed
    };

    if (!(await preferDirect()) && proServiceReady() && await JobTreadProService.isConfigured()) {
      const res = await JobTreadProService.getInvoiceForecast(options);
      if (res?.unconfigured) return [];
      return res?.records || [];
    }

    // Active-org-aware direct path (per-org forecasts)
    const orgId = await resolveActiveOrgId();
    const [scheduled, paid] = await Promise.all([
      fetchInvoicesDirect(orgId, config.taskTypeIds, from, to, config.includeClosed),
      fetchPaidInvoicesDirect(orgId, from, to, config.includeClosed)
    ]);
    let soldJobIds = null;
    if (config.soldContractNames.length) {
      soldJobIds = await fetchSoldJobIdsDirect(orgId, config.soldContractNames, config.includeClosed);
    }
    // Scheduled set drops paid invoices — they come from the paid query, dated by
    // issueDate. Keeps the two disjoint (no double-count).
    return [
      ...scheduled.filter(inv => !((inv.amountPaid || 0) > 0)).map(inv => normalize(inv, soldJobIds, false)),
      ...paid.map(inv => normalize(inv, soldJobIds, true))
    ].filter(r => r.expectedMonth);
  }

  async function fetchInvoicesDirect(orgId, taskTypeIds, from, to, includeClosed) {
    let all = [], page, pages = 0;
    const and = [
      ['type', '=', 'customerInvoice'],
      [['task', 'taskType', 'id'], 'in', taskTypeIds]
    ];
    if (!includeClosed) and.push([['job', 'closedOn'], '=', null]);
    if (from) and.push([['task', 'startDate'], '>=', from]);
    if (to) and.push([['task', 'startDate'], '<=', to]);
    do {
      const params = { size: 100, where: { and } };
      if (page) params.page = page;
      const r = await JobTreadAPI.paveQuery({
        organization: { $: { id: orgId }, documents: { $: params, nextPage: {}, nodes: {
          id: {}, number: {}, status: {}, priceWithTax: {}, amountPaid: {},
          job: { id: {}, name: {}, number: {} },
          task: { id: {}, name: {}, startDate: {}, completed: {} }
        } } }
      });
      const docs = r?.organization?.documents;
      all = all.concat(docs?.nodes || []);
      page = docs?.nextPage || null;
      pages++;
    } while (page && pages < 50);
    return all;
  }

  // Paid invoices on open jobs, ANY task type, dated by issueDate. Catches
  // deposits billed on doc approval that aren't linked to an invoice task.
  async function fetchPaidInvoicesDirect(orgId, from, to, includeClosed) {
    let all = [], page, pages = 0;
    const and = [
      ['type', '=', 'customerInvoice'],
      ['amountPaid', '>', 0]
    ];
    if (!includeClosed) and.push([['job', 'closedOn'], '=', null]);
    if (from) and.push(['issueDate', '>=', from]);
    if (to) and.push(['issueDate', '<=', to]);
    do {
      const params = { size: 100, where: { and } };
      if (page) params.page = page;
      const r = await JobTreadAPI.paveQuery({
        organization: { $: { id: orgId }, documents: { $: params, nextPage: {}, nodes: {
          id: {}, number: {}, status: {}, priceWithTax: {}, amountPaid: {}, issueDate: {},
          job: { id: {}, name: {}, number: {} },
          task: { id: {}, name: {}, startDate: {}, completed: {} }
        } } }
      });
      const docs = r?.organization?.documents;
      all = all.concat(docs?.nodes || []);
      page = docs?.nextPage || null;
      pages++;
    } while (page && pages < 50);
    return all;
  }

  async function fetchSoldJobIdsDirect(orgId, soldContractNames, includeClosed) {
    const ids = new Set();
    let page, pages = 0;
    const and = [
      ['type', '=', 'customerOrder'],
      ['status', '=', 'approved'],
      ['name', 'in', soldContractNames]
    ];
    if (!includeClosed) and.push([['job', 'closedOn'], '=', null]);
    do {
      const params = { size: 100, where: { and } };
      if (page) params.page = page;
      const r = await JobTreadAPI.paveQuery({
        organization: { $: { id: orgId }, documents: { $: params, nextPage: {}, nodes: { job: { id: {} } } } }
      });
      const docs = r?.organization?.documents;
      (docs?.nodes || []).forEach(n => { if (n.job?.id) ids.add(n.job.id); });
      page = docs?.nextPage || null;
      pages++;
    } while (page && pages < 50);
    return ids;
  }

  function normalize(inv, soldJobIds, isPaid) {
    // Paid = collected, dated by when billed (issueDate). Scheduled = forward,
    // dated by its linked task. Deposits are paid + untasked → issueDate only.
    const expectedDate = isPaid ? (inv.issueDate || null) : (inv.task?.startDate || null);
    const jobId = inv.job?.id || null;
    const jobSold = soldJobIds ? (jobId ? soldJobIds.has(jobId) : false) : true;
    // Paid is its own category (not split by sold — collected cash is collected).
    const category = isPaid ? 'paid' : (jobSold ? 'committed' : 'projected');
    return {
      id: inv.id,
      number: inv.number,
      status: inv.status || null,
      amount: inv.priceWithTax || 0,
      expectedDate,
      expectedMonth: expectedDate ? expectedDate.slice(0, 7) : null,
      paid: !!isPaid,
      category,
      jobSold,
      job: inv.job ? { id: inv.job.id, name: inv.job.name } : null,
      task: inv.task ? { name: inv.task.name } : null
    };
  }

  async function discoverOrgId() {
    const r = await JobTreadAPI.paveQuery({
      currentGrant: { user: { memberships: { nodes: { organization: { id: {} } } } } }
    });
    const id = r?.currentGrant?.user?.memberships?.nodes?.[0]?.organization?.id;
    if (!id) throw new Error('Could not determine organization from grant key');
    return id;
  }

  // Single client-side aggregator (used for both pro-service + direct paths)
  function aggregate(records) {
    const byMonth = {};
    let grandTotal = 0, paidTotal = 0, committedTotal = 0, projectedTotal = 0;

    for (const r of records) {
      grandTotal += r.amount;
      if (r.category === 'paid') paidTotal += r.amount;
      else if (r.category === 'projected') projectedTotal += r.amount;
      else committedTotal += r.amount;
      const k = r.expectedMonth || 'unscheduled';
      const m = byMonth[k] || (byMonth[k] = { total: 0, paid: 0, committed: 0, projected: 0, jobs: {} });
      m.total += r.amount;
      m[r.category] += r.amount;
      if (r.job) {
        const j = m.jobs[r.job.id] || (m.jobs[r.job.id] = { name: r.job.name, total: 0, sold: r.jobSold, paid: 0, committed: 0, projected: 0 });
        j.total += r.amount;
        j[r.category] += r.amount;
      }
    }
    return {
      count: records.length,
      soldConfigured: config.soldContractNames.length > 0,
      grandTotal, paidTotal, committedTotal, projectedTotal, byMonth
    };
  }

  // ─── RENDER ──────────────────────────────────────────────────

  function renderPanelShell() {
    const panel = document.getElementById(PANEL_ID);
    if (!panel) return;
    panel.innerHTML = `
      <div class="jt-if-header">
        <div>
          <h2 class="jt-if-title">Invoice forecast</h2>
          <div class="jt-if-sub">Collected + scheduled invoices · paid dated by issue date, scheduled by task · open jobs only</div>
        </div>
        <div class="jt-if-controls" id="jt-if-controls"></div>
      </div>
      <div class="jt-if-body" id="jt-if-body"></div>`;
  }

  function el(id) { return document.getElementById(id); }

  function renderHeaderControls() {
    const host = el('jt-if-controls');
    if (!host) return;
    host.innerHTML = `
      <div class="jt-if-picker" data-picker="types">
        <button class="jt-if-picker-btn" type="button">Task types <span class="jt-if-count">${config.taskTypeIds.length || '—'}</span> ▾</button>
        <div class="jt-if-menu" hidden></div>
      </div>
      <div class="jt-if-picker" data-picker="sold">
        <button class="jt-if-picker-btn" type="button">Sold = <span class="jt-if-count">${config.soldContractNames.length || '—'}</span> ▾</button>
        <div class="jt-if-menu" hidden></div>
      </div>
      <div class="jt-if-period">
        <label>From <input type="month" class="jt-if-month" data-period="from" value="${config.from || ''}"></label>
        <label>To <input type="month" class="jt-if-month" data-period="to" value="${config.to || ''}"></label>
      </div>
      <label class="jt-if-check">
        <input type="checkbox" data-opt="closed" ${config.includeClosed ? 'checked' : ''}> Include closed jobs
      </label>
      <button class="jt-if-export" type="button"><i class="ph ph-download-simple"></i> Export CSV</button>`;

    wirePicker(host.querySelector('[data-picker="types"]'),
      taskTypeOptions.map(t => ({ value: t.id, label: t.name })),
      config.taskTypeIds,
      (selected) => { config.taskTypeIds = selected; saveConfig(); loadForecast(); renderHeaderControls(); });

    wirePicker(host.querySelector('[data-picker="sold"]'),
      contractNameOptions.map(c => ({ value: c.name, label: `${c.name} (${c.count})` })),
      config.soldContractNames,
      (selected) => { config.soldContractNames = selected; saveConfig(); loadForecast(); renderHeaderControls(); });

    host.querySelectorAll('input[data-period]').forEach(inp => {
      addListener(inp, 'change', () => {
        config[inp.getAttribute('data-period')] = inp.value;  // '' when cleared = unbounded
        saveConfig();
        loadForecast();
      });
    });

    const closed = host.querySelector('input[data-opt="closed"]');
    addListener(closed, 'change', () => {
      config.includeClosed = closed.checked;
      saveConfig();
      loadForecast();
    });

    const exportBtn = host.querySelector('.jt-if-export');
    addListener(exportBtn, 'click', exportCsv);
  }

  function csvCell(v) {
    const s = String(v == null ? '' : v);
    return /[",\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  }

  function exportCsv() {
    const recs = currentRecords
      .filter(r => r.expectedMonth)
      .slice()
      .sort((a, b) => (a.expectedDate || '').localeCompare(b.expectedDate || ''));
    if (!recs.length) return;

    const showSplit = snapshot && snapshot.soldConfigured;
    const header = ['Month', 'Date', 'Job', 'Invoice #', 'Amount', 'Status', 'Type'];
    const lines = [header];
    for (const r of recs) {
      lines.push([
        r.expectedMonth,
        r.expectedDate || '',
        r.job ? (r.job.name || '') : '',
        r.number != null ? r.number : '',
        r.amount,
        r.status || '',
        typeLabel(r, showSplit)
      ]);
    }
    const csv = lines.map(row => row.map(csvCell).join(',')).join('\r\n');

    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const stamp = new Date().toISOString().slice(0, 10);
    const safeOrg = String(orgKey).replace(/[^a-z0-9]+/gi, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'org';
    const a = document.createElement('a');
    a.href = url;
    a.download = `invoice-forecast-${safeOrg}-${stamp}.csv`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  }

  function wirePicker(root, options, selectedValues, onChange) {
    if (!root) return;
    const btn = root.querySelector('.jt-if-picker-btn');
    const menu = root.querySelector('.jt-if-menu');
    const selSet = new Set(selectedValues);

    menu.innerHTML = options.length
      ? options.map(o => `
          <label class="jt-if-opt">
            <input type="checkbox" value="${Sanitizer.escapeHTML(String(o.value))}" ${selSet.has(o.value) ? 'checked' : ''}>
            <span>${Sanitizer.escapeHTML(o.label)}</span>
          </label>`).join('')
      : '<div class="jt-if-opt-empty">No options found</div>';

    addListener(btn, 'click', (e) => {
      e.stopPropagation();
      // close other menus
      document.querySelectorAll('.jt-if-menu').forEach(m => { if (m !== menu) m.hidden = true; });
      menu.hidden = !menu.hidden;
    });

    menu.querySelectorAll('input[type="checkbox"]').forEach(cb => {
      addListener(cb, 'change', () => {
        const picked = Array.from(menu.querySelectorAll('input:checked')).map(i => i.value);
        onChange(picked);
      });
    });
  }

  function renderUnconfigured() {
    const body = el('jt-if-body');
    if (!body) return;
    body.innerHTML = `
      <div class="jt-if-empty">
        <div class="jt-if-empty-icon">📊</div>
        <h3>Pick your invoice task type(s)</h3>
        <p>Choose which task type marks an invoice release (e.g. "Invoice") using the <strong>Task types</strong> menu above. Optionally set which approved contract means a job is <strong>sold</strong> to split committed vs. projected.</p>
      </div>`;
  }

  function renderBodyLoading() {
    const body = el('jt-if-body');
    if (body) body.innerHTML = '<div class="jt-if-loading">Building forecast…</div>';
  }

  function renderError() {
    const body = el('jt-if-body');
    if (body) body.innerHTML = `<div class="jt-if-error">Couldn't load the forecast: ${Sanitizer.escapeHTML(lastError || 'unknown error')}</div>`;
  }

  function fmtK(n) { return n >= 1000 ? '$' + Math.round(n / 1000) + 'k' : '$' + Math.round(n); }
  function fmtFull(n) { return '$' + Math.round(n).toLocaleString('en-US'); }
  function fmtM(n) { return n >= 1e6 ? '$' + (n / 1e6).toFixed(2) + 'M' : fmtK(n); }

  // Bar tooltip: paid / committed / projected shown as separate blocks, each
  // with its own subtotal and per-job breakdown, instead of one mixed list.
  function monthTip(m, showSplit) {
    const groups = [
      ['paid', 'Paid (collected)', m.paid],
      ['committed', showSplit ? 'Committed (sold)' : 'Scheduled', m.committed]
    ];
    if (showSplit) groups.push(['projected', 'Projected (not sold)', m.projected]);

    const blocks = [];
    for (const [cat, label, total] of groups) {
      if (total <= 0) continue;
      const jobs = Object.values(m.jobs)
        .filter(j => j[cat] > 0)
        .sort((a, b) => b[cat] - a[cat])
        .map(j => `  ${j.name || ''}: ${fmtFull(j[cat])}`);
      blocks.push([`${label} — ${fmtFull(total)}`, ...jobs].join('\n'));
    }
    return blocks.join('\n\n');
  }

  function monthLabel(key) {
    if (key === 'unscheduled') return 'No date';
    const [y, m] = key.split('-');
    const names = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    return `${names[parseInt(m, 10) - 1]} ${String(y).slice(2)}`;
  }

  function renderChart() {
    const body = el('jt-if-body');
    if (!body || !snapshot) return;

    const months = Object.keys(snapshot.byMonth).filter(k => k !== 'unscheduled').sort();
    if (!months.length) {
      body.innerHTML = '<div class="jt-if-empty"><h3>No invoices in this window</h3><p>No invoices on open jobs match the selected task type(s) or were paid in this period.</p></div>';
      return;
    }

    const maxTotal = Math.max(...months.map(k => snapshot.byMonth[k].total), 1);
    const showSplit = snapshot.soldConfigured;

    const tiles = [
      ['', fmtM(snapshot.grandTotal), 'Total (in window)'],
      ['paid', fmtM(snapshot.paidTotal), 'Collected'],
      ['commit', fmtM(snapshot.committedTotal), showSplit ? 'Committed (sold)' : 'Scheduled'],
      showSplit ? ['proj', fmtM(snapshot.projectedTotal), 'Projected (not sold)'] : null,
      ['', String(snapshot.count), 'Invoices']
    ].filter(Boolean);

    const tilesHtml = tiles.map(t => `<div class="jt-if-tile"><div class="jt-if-tile-v ${t[0]}">${t[1]}</div><div class="jt-if-tile-k">${t[2]}</div></div>`).join('');

    const pct = (v) => (v / maxTotal) * 100;
    const colsHtml = months.map(k => {
      const m = snapshot.byMonth[k];
      // Stack bottom→top: paid, committed, projected. Flex column ends at the
      // bottom, so DOM order top→bottom is projected → committed → paid.
      const segs = [];
      if (m.projected > 0) segs.push(['proj', m.projected]);
      if (m.committed > 0) segs.push(['commit', m.committed]);
      if (m.paid > 0) segs.push(['paid', m.paid]);
      const segHtml = segs.map(([cls, v], i) => {
        const top = i === 0, bottom = i === segs.length - 1;
        const radius = top && bottom ? '3px' : top ? '3px 3px 0 0' : bottom ? '0 0 3px 3px' : '0';
        return `<div class="jt-if-seg ${cls}" style="height:${pct(v)}%;border-radius:${radius}"></div>`;
      }).join('');
      const jobsTip = monthTip(m, showSplit);
      return `
        <div class="jt-if-col">
          <div class="jt-if-col-total">${m.total > 0 ? fmtK(m.total) : ''}</div>
          <div class="jt-if-bar" title="${Sanitizer.escapeHTML(monthLabel(k))}\n\n${Sanitizer.escapeHTML(jobsTip)}">
            ${segHtml}
          </div>
          <div class="jt-if-col-label">${monthLabel(k)}</div>
        </div>`;
    }).join('');

    const paidLi = `<span class="jt-if-li"><span class="jt-if-dot paid"></span>Paid (collected)</span>`;
    const legendHtml = showSplit ? `
      <div class="jt-if-legend">
        ${paidLi}
        <span class="jt-if-li"><span class="jt-if-dot commit"></span>Committed (sold)</span>
        <span class="jt-if-li"><span class="jt-if-dot proj"></span>Projected (not yet sold)</span>
        <span class="jt-if-li muted">hover a bar for the per-job breakdown</span>
      </div>` : `
      <div class="jt-if-legend">
        ${paidLi}
        <span class="jt-if-li"><span class="jt-if-dot commit"></span>Scheduled</span>
        <span class="jt-if-li muted">set a sold-contract type above to split committed vs. projected · hover for jobs</span>
      </div>`;

    body.innerHTML = `
      <div class="jt-if-tiles" style="grid-template-columns:repeat(${tiles.length},1fr)">${tilesHtml}</div>
      <div class="jt-if-chart">
        <div class="jt-if-yaxis">
          <span>${fmtK(maxTotal)}</span><span>${fmtK(maxTotal / 2)}</span><span>$0</span>
        </div>
        <div class="jt-if-plot">${colsHtml}</div>
      </div>
      ${legendHtml}
      ${buildTableHtml()}`;
  }

  function dayLabel(iso) {
    if (!iso) return '—';
    const parts = iso.split('-').map(Number);
    const dt = new Date(parts[0], parts[1] - 1, parts[2]);  // local — avoids UTC day-shift
    const wd = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][dt.getDay()];
    const mo = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][parts[1] - 1];
    return `${wd} ${mo} ${parts[2]}`;
  }

  function statusBadge(status) {
    const s = (status || '').toLowerCase();
    const label = s ? s.charAt(0).toUpperCase() + s.slice(1) : 'Unknown';
    return `<span class="jt-if-status s-${Sanitizer.escapeHTML(s || 'unknown')}">${Sanitizer.escapeHTML(label)}</span>`;
  }

  // Category label for the detail table / CSV. When sold isn't configured the
  // scheduled bucket is just "Scheduled" (no committed/projected split).
  function typeLabel(r, showSplit) {
    if (r.category === 'paid') return 'Paid';
    if (r.category === 'projected') return 'Projected';
    return showSplit ? 'Committed' : 'Scheduled';
  }

  function typeTag(r, showSplit) {
    const cls = r.category === 'paid' ? 'paid' : r.category === 'projected' ? 'proj' : 'commit';
    return `<span class="jt-if-tag ${cls}">${typeLabel(r, showSplit)}</span>`;
  }

  // Detail breakdown: every upcoming invoice grouped by month, sorted by day,
  // showing day / job / amount / status (+ committed vs projected when split on).
  function buildTableHtml() {
    const recs = currentRecords
      .filter(r => r.expectedMonth)
      .slice()
      .sort((a, b) => (a.expectedDate || '').localeCompare(b.expectedDate || ''));
    if (!recs.length) return '';

    const showSplit = snapshot.soldConfigured;
    const cols = 5;
    let rows = '';
    let curMonth = null;
    for (const r of recs) {
      if (r.expectedMonth !== curMonth) {
        curMonth = r.expectedMonth;
        const m = snapshot.byMonth[curMonth];
        rows += `<tr class="jt-if-trow-month"><td colspan="${cols}">${monthLabel(curMonth)} · ${fmtFull(m.total)}</td></tr>`;
      }
      rows += `<tr>
        <td class="jt-if-td-date">${dayLabel(r.expectedDate)}</td>
        <td>${Sanitizer.escapeHTML(r.job ? (r.job.name || '—') : '—')}</td>
        <td class="jt-if-td-amt">${fmtFull(r.amount)}</td>
        <td>${statusBadge(r.status)}</td>
        <td>${typeTag(r, showSplit)}</td>
      </tr>`;
    }
    const head = `<tr><th>Date</th><th>Job</th><th class="jt-if-td-amt">Amount</th><th>Status</th><th>Type</th></tr>`;
    return `
      <h3 class="jt-if-table-title">Detail by month</h3>
      <div class="jt-if-table-wrap">
        <table class="jt-if-table"><thead>${head}</thead><tbody>${rows}</tbody></table>
      </div>`;
  }

  // ─── OBSERVERS ───────────────────────────────────────────────

  function setupDomObserver() {
    observer = new MutationObserver(() => {
      if (!isReportsPage()) return;
      if (!document.getElementById(TAB_ID)) tryInject();
    });
    observer.observe(document.body, { childList: true, subtree: true });
  }

  function setupUrlWatcher() {
    let lastPath = location.pathname;
    urlCheckInterval = setInterval(() => {
      if (location.pathname === lastPath) return;
      lastPath = location.pathname;
      if (!isReportsPage()) { removeTab(); unmountPanel(); }
      else tryInject();
    }, 500);
  }

  // ─── STYLES + UTILS ──────────────────────────────────────────

  function injectStyles() {
    if (styleElement) return;
    styleElement = document.createElement('link');
    styleElement.rel = 'stylesheet';
    styleElement.href = chrome.runtime.getURL('styles/invoice-forecast.css');
    styleElement.id = 'jt-if-styles';
    document.head.appendChild(styleElement);
  }

  function removeStyles() {
    if (styleElement) { styleElement.remove(); styleElement = null; }
  }

  function addListener(el2, evt, fn) {
    if (!el2) return;
    el2.addEventListener(evt, fn);
    eventListeners.push({ el: el2, evt, fn });
  }

  function onDocumentClick() {
    if (!isMounted) return;
    document.querySelectorAll('.jt-if-menu').forEach(m => { m.hidden = true; });
  }

  return { init, cleanup, isActive: () => isActiveState };
})();

if (typeof window !== 'undefined') {
  window.InvoiceForecastFeature = InvoiceForecastFeature;
}
