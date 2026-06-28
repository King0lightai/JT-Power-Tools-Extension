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

  function tryInject() {
    if (!isReportsPage()) { removeTab(); unmountPanel(); return; }
    if (document.getElementById(TAB_ID)) return;

    const tabBar = findTabBar();
    if (!tabBar) return;

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
    if (active) {
      a.classList.remove(...TAB_INACTIVE);
      a.classList.add(...TAB_ACTIVE);
    } else {
      a.classList.remove(...TAB_ACTIVE);
      a.classList.add(...TAB_INACTIVE);
    }
  }

  // Best-effort: drop the active styling on JobTread's own tabs while our panel
  // is shown so only our tab reads as active. The URL is unchanged by design,
  // so JT's router won't re-highlight unless it re-renders for another reason.
  function deactivateNativeTabs() {
    const bar = findTabBar();
    if (!bar) return;
    bar.querySelectorAll('a[href^="/reports"]:not([data-jt-if-tab])').forEach(a => {
      a.classList.remove('border-t-2', 'border-jtOrange', 'bg-gray-50');
      if (!a.classList.contains('border-t')) a.classList.add('border-t');
      if (!a.classList.contains('border-white')) a.classList.add('border-white');
    });
  }

  function mountPanel() {
    if (isMounted) return;
    const tabBar = findTabBar();
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
    const invoices = await fetchInvoicesDirect(orgId, config.taskTypeIds, from, to, config.includeClosed);
    let soldJobIds = null;
    if (config.soldContractNames.length) {
      soldJobIds = await fetchSoldJobIdsDirect(orgId, config.soldContractNames, config.includeClosed);
    }
    return invoices.map(inv => normalize(inv, soldJobIds)).filter(r => r.expectedMonth);
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
          id: {}, number: {}, status: {}, priceWithTax: {},
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

  function normalize(inv, soldJobIds) {
    const expectedDate = inv.task?.startDate || null;
    const jobId = inv.job?.id || null;
    return {
      id: inv.id,
      number: inv.number,
      status: inv.status || null,
      amount: inv.priceWithTax || 0,
      expectedDate,
      expectedMonth: expectedDate ? expectedDate.slice(0, 7) : null,
      jobSold: soldJobIds ? (jobId ? soldJobIds.has(jobId) : false) : true,
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
    let grandTotal = 0, committedTotal = 0, projectedTotal = 0;

    for (const r of records) {
      grandTotal += r.amount;
      if (r.jobSold) committedTotal += r.amount; else projectedTotal += r.amount;
      const k = r.expectedMonth || 'unscheduled';
      const m = byMonth[k] || (byMonth[k] = { total: 0, committed: 0, projected: 0, jobs: {} });
      m.total += r.amount;
      if (r.jobSold) m.committed += r.amount; else m.projected += r.amount;
      if (r.job) {
        const j = m.jobs[r.job.id] || (m.jobs[r.job.id] = { name: r.job.name, total: 0, sold: r.jobSold });
        j.total += r.amount;
      }
    }
    return {
      count: records.length,
      soldConfigured: config.soldContractNames.length > 0,
      grandTotal, committedTotal, projectedTotal, byMonth
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
          <div class="jt-if-sub">Projected invoice releases, dated by linked task · open jobs only</div>
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
    const header = ['Month', 'Date', 'Job', 'Invoice #', 'Amount', 'Status'].concat(showSplit ? ['Type'] : []);
    const lines = [header];
    for (const r of recs) {
      const row = [
        r.expectedMonth,
        r.expectedDate || '',
        r.job ? (r.job.name || '') : '',
        r.number != null ? r.number : '',
        r.amount,
        r.status || ''
      ];
      if (showSplit) row.push(r.jobSold ? 'Committed' : 'Projected');
      lines.push(row);
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
      body.innerHTML = '<div class="jt-if-empty"><h3>No upcoming invoices</h3><p>No invoices on open jobs are linked to the selected task type(s).</p></div>';
      return;
    }

    const maxTotal = Math.max(...months.map(k => snapshot.byMonth[k].total), 1);
    const showSplit = snapshot.soldConfigured;

    const tiles = [
      ['', fmtM(snapshot.grandTotal), 'Total forecast'],
      showSplit ? ['commit', fmtM(snapshot.committedTotal), 'Committed (sold)'] : null,
      showSplit ? ['proj', fmtM(snapshot.projectedTotal), 'Projected (not sold)'] : null,
      ['', String(snapshot.count), 'Invoices']
    ].filter(Boolean);

    const tilesHtml = tiles.map(t => `<div class="jt-if-tile"><div class="jt-if-tile-v ${t[0]}">${t[1]}</div><div class="jt-if-tile-k">${t[2]}</div></div>`).join('');

    const colsHtml = months.map(k => {
      const m = snapshot.byMonth[k];
      const commitH = (m.committed / maxTotal) * 100;
      const projH = (m.projected / maxTotal) * 100;
      const jobsTip = Object.values(m.jobs).sort((a, b) => b.total - a.total)
        .map(j => `${Sanitizer.escapeHTML(j.name || '')}: ${fmtFull(j.total)}${showSplit ? (j.sold ? '' : ' (projected)') : ''}`).join('\n');
      return `
        <div class="jt-if-col">
          <div class="jt-if-col-total">${m.total > 0 ? fmtK(m.total) : ''}</div>
          <div class="jt-if-bar" title="${Sanitizer.escapeHTML(monthLabel(k))}\n${Sanitizer.escapeHTML(jobsTip)}">
            ${showSplit && projH > 0 ? `<div class="jt-if-seg proj" style="height:${projH}%"></div>` : ''}
            <div class="jt-if-seg commit" style="height:${(showSplit ? commitH : (m.total / maxTotal) * 100)}%"></div>
          </div>
          <div class="jt-if-col-label">${monthLabel(k)}</div>
        </div>`;
    }).join('');

    const legendHtml = showSplit ? `
      <div class="jt-if-legend">
        <span class="jt-if-li"><span class="jt-if-dot commit"></span>Committed (sold)</span>
        <span class="jt-if-li"><span class="jt-if-dot proj"></span>Projected (not yet sold)</span>
        <span class="jt-if-li muted">hover a bar for the per-job breakdown</span>
      </div>` : `
      <div class="jt-if-legend"><span class="jt-if-li muted">Set a sold-contract type above to split committed vs. projected · hover a bar for jobs</span></div>`;

    body.innerHTML = `
      <div class="jt-if-tiles">${tilesHtml}</div>
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

  // Detail breakdown: every upcoming invoice grouped by month, sorted by day,
  // showing day / job / amount / status (+ committed vs projected when split on).
  function buildTableHtml() {
    const recs = currentRecords
      .filter(r => r.expectedMonth)
      .slice()
      .sort((a, b) => (a.expectedDate || '').localeCompare(b.expectedDate || ''));
    if (!recs.length) return '';

    const showSplit = snapshot.soldConfigured;
    const cols = showSplit ? 5 : 4;
    let rows = '';
    let curMonth = null;
    for (const r of recs) {
      if (r.expectedMonth !== curMonth) {
        curMonth = r.expectedMonth;
        const m = snapshot.byMonth[curMonth];
        rows += `<tr class="jt-if-trow-month"><td colspan="${cols}">${monthLabel(curMonth)} · ${fmtFull(m.total)}</td></tr>`;
      }
      const typeTag = showSplit
        ? `<td>${r.jobSold ? '<span class="jt-if-tag commit">Committed</span>' : '<span class="jt-if-tag proj">Projected</span>'}</td>`
        : '';
      rows += `<tr>
        <td class="jt-if-td-date">${dayLabel(r.expectedDate)}</td>
        <td>${Sanitizer.escapeHTML(r.job ? (r.job.name || '—') : '—')}</td>
        <td class="jt-if-td-amt">${fmtFull(r.amount)}</td>
        <td>${statusBadge(r.status)}</td>
        ${typeTag}
      </tr>`;
    }
    const head = `<tr><th>Date</th><th>Job</th><th class="jt-if-td-amt">Amount</th><th>Status</th>${showSplit ? '<th>Type</th>' : ''}</tr>`;
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
