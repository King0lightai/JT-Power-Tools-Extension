/**
 * Pave Explorer — manual network-filter view (side panel)
 *
 * A browse-and-copy view of the Pave API calls you run in JobTread, modeled
 * on the standalone PAVE Inspector. Independent of "Record for AI": opening
 * this tab streams live captures locally so you can read the Request /
 * Response / Shareable (key-stripped) query and copy it — nothing is uploaded.
 *
 * Capture path: pave-capture-page.js (MAIN) → pave-explorer-bridge.js
 * (ISOLATED, on the JobTread tab) → here via chrome.runtime messages.
 *
 * Self-contained: renders into #paveExplorerRoot and starts/stops capture
 * when its tab becomes active, so it doesn't touch popup.js's logic.
 */
(function () {
  'use strict';

  // ── Analyzer (ported from PAVE Inspector) ──────────────────────────
  const ROOT_SKIP = new Set(['_type', '$', 'currentGrant']);
  const WRITE_PREFIXES = [
    'create', 'update', 'delete', 'remove', 'add', 'set', 'close', 'reopen',
    'approve', 'deny', 'archive', 'unarchive', 'assign', 'move', 'copy', 'merge',
    'split', 'send', 'import', 'upload', 'attach', 'detach', 'invite', 'revoke',
    'push', 'accept', 'reject', 'cancel', 'restore', 'transfer', 'draft',
  ];
  const ENTITY_NAMES = {
    dataview: 'DataView', job: 'Job', jobs: 'Jobs', account: 'Account', accounts: 'Accounts',
    contact: 'Contact', contacts: 'Contacts', location: 'Location', locations: 'Locations',
    document: 'Document', documents: 'Documents', costitem: 'Cost Item', costitems: 'Cost Items',
    costgroup: 'Cost Group', costcode: 'Cost Code', payment: 'Payment', payments: 'Payments',
    task: 'Task', tasks: 'Tasks', tasktype: 'Task Type', timeentry: 'Time Entry',
    dailylog: 'Daily Log', file: 'File', files: 'Files', comment: 'Comment', comments: 'Comments',
    dashboard: 'Dashboard', grant: 'Grant', user: 'User', users: 'Users',
    organization: 'Organization', webhook: 'Webhook', template: 'Template',
    customerorder: 'Estimate', customerinvoice: 'Invoice', vendororder: 'Purchase Order',
    vendorbill: 'Bill', customfield: 'Custom Field', membership: 'Membership',
    memberships: 'Memberships', tag: 'Tag', catalog: 'Catalog', todo: 'To-Do',
  };

  function camelToTitle(s) { return s.replace(/([A-Z])/g, ' $1').replace(/^./, (c) => c.toUpperCase()).trim(); }
  function capitalize(s) { return s.charAt(0).toUpperCase() + s.slice(1); }
  function truncate(s, n) { if (!s) return ''; return s.length > n ? s.slice(0, n) + '…' : s; }
  function detectEntity(str) {
    for (const [k, label] of Object.entries(ENTITY_NAMES)) if (str.includes(k)) return label;
    return null;
  }

  function analyzeQuery(body) {
    const result = { type: 'query', operation: null, displayName: null, entity: null, details: [], isNoise: false, hasFilters: false };
    if (!body || typeof body !== 'object') { result.isNoise = true; return result; }
    const query = body.query || body;
    const opKeys = Object.keys(query).filter((k) => !ROOT_SKIP.has(k));
    for (const key of opKeys) {
      if (key === 'scope' || key === 'collect') continue;
      const lower = key.toLowerCase();
      const val = query[key];
      const params = (val && typeof val === 'object') ? val.$ : null;
      const paramKeys = params ? Object.keys(params) : [];
      if (key === 'whoCan' || key === 'can') {
        result.type = 'other'; result.operation = key; result.displayName = 'Permission Check'; result.isNoise = true;
        return result;
      }
      const isActionOnly = paramKeys.length <= 2 && paramKeys.includes('action') && paramKeys.includes('id')
        && !paramKeys.some((k) => !['action', 'id'].includes(k));
      if (key === 'connection') {
        result.type = 'query'; result.operation = key;
        const action = params && params.action;
        result.displayName = action ? camelToTitle(action) : 'Connection Query';
        result.entity = action ? detectEntity(action.toLowerCase()) : null;
        result.isNoise = isActionOnly; return result;
      }
      if (lower.startsWith('read')) {
        result.type = 'query'; result.operation = key; result.displayName = camelToTitle(key);
        result.entity = detectEntity(lower.replace('read', '')); result.isNoise = isActionOnly; return result;
      }
      if (lower.startsWith('export')) {
        result.type = 'other'; result.operation = key; result.displayName = camelToTitle(key);
        result.entity = detectEntity(lower.replace('export', '')); return result;
      }
      if (WRITE_PREFIXES.some((p) => lower.startsWith(p))) {
        if (isActionOnly) {
          result.type = 'other'; result.operation = key; result.displayName = `Can ${camelToTitle(key)}`; result.isNoise = true; return result;
        }
        result.type = 'mutation'; result.operation = key; result.displayName = camelToTitle(key); result.entity = detectEntity(lower);
        if (params) {
          if (params.name) result.details.push(`"${params.name}"`);
          if (params.type) result.details.push(params.type);
          if (params.status) result.details.push(params.status);
          if (params.message) result.details.push(truncate(params.message, 30));
        }
        return result;
      }
      if (params && paramKeys.length === 1 && paramKeys[0] === 'id') {
        result.type = 'query'; result.operation = key;
        const entity = ENTITY_NAMES[lower] || capitalize(key);
        result.displayName = `Get ${entity}`; result.entity = entity; result.isNoise = (lower === 'organization'); return result;
      }
      result.operation = key; result.displayName = camelToTitle(key); result.entity = detectEntity(lower); return result;
    }
    if (query.collect) { result.type = 'other'; result.operation = 'collect'; result.displayName = 'Analytics Event'; result.isNoise = true; return result; }
    if (query.scope) return analyzeScopeQuery(query.scope, result);
    result.displayName = 'Unknown'; result.isNoise = true; return result;
  }

  function analyzeScopeQuery(scope, result) {
    const conn = scope.connection;
    if (!conn) { result.displayName = 'Scope Query'; result.isNoise = true; return result; }
    const connType = conn._;
    const connParams = conn.$;
    const PAGE_LOAD_TYPES = new Set(['memberships', 'taskTypes', 'events', 'notifications']);
    if (connType) {
      const pretty = ENTITY_NAMES[connType.toLowerCase()] || capitalize(connType);
      result.operation = `query:${connType}`; result.displayName = `Query ${pretty}`; result.entity = pretty;
      if (PAGE_LOAD_TYPES.has(connType)) result.isNoise = true;
    }
    if (connParams) {
      if (connParams.where) result.hasFilters = true;
      if (connParams.with) {
        result.hasFilters = true;
        const cfKeys = Object.keys(connParams.with).filter((k) => k.startsWith('cfv:'));
        if (cfKeys.length > 0) result.details.push(`${cfKeys.length} custom field${cfKeys.length > 1 ? 's' : ''}`);
      }
    }
    if (!connType) result.displayName = (connParams && connParams.with) ? 'Grouped View Query' : 'Connection Query';
    if (!result.hasFilters && !connType) result.isNoise = true;
    return result;
  }

  // ── Sanitizer (ported "shareable Pave") ────────────────────────────
  function sanitize(obj) {
    const json = JSON.stringify(obj, null, 2);
    const idMap = new Map();
    let counter = 0;
    let out = json.replace(/("grantKey":\s*")[^"]*(")/g, '$1<GRANT_KEY>$2');
    out = out.replace(/22[A-Za-z0-9]{6,28}/g, (m) => {
      if (!idMap.has(m)) { counter++; idMap.set(m, `<ID_${counter}>`); }
      return idMap.get(m);
    });
    if (idMap.size > 0) {
      const legend = Array.from(idMap.entries()).map(([id, ph]) => `//   ${ph} = ${id}`).join('\n');
      out = `// ── ID Legend ──\n${legend}\n// ${'─'.repeat(40)}\n\n${out}`;
    }
    return out;
  }

  function esc(s) { return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }
  function escText(s) { return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }
  function highlight(json) {
    return esc(json)
      .replace(/(&quot;(?:\\.|[^&])*?&quot;)\s*:/g, '<span class="jk">$1</span>:')
      .replace(/:\s*(&quot;(?:\\.|[^&])*?&quot;)/g, ': <span class="js">$1</span>')
      .replace(/:\s*(-?\d+\.?\d*(?:[eE][+-]?\d+)?)/g, ': <span class="jn">$1</span>')
      .replace(/:\s*(true|false|null)/g, ': <span class="jb">$1</span>');
  }

  // ── State + DOM ────────────────────────────────────────────────────
  const state = { calls: [], selectedIndex: -1, filter: 'mutations', search: '', active: false, port: null };
  let root = null;
  let els = {};

  function build() {
    root = document.getElementById('paveExplorerRoot');
    if (!root || root.dataset.built) return;
    root.dataset.built = '1';
    root.innerHTML = `
      <div class="pe-toolbar">
        <select class="pe-filter" id="peFilter">
          <option value="mutations">Mutations only</option>
          <option value="actions">Actions + Queries</option>
          <option value="all">All traffic</option>
        </select>
        <input class="pe-search" id="peSearch" type="text" placeholder="Filter…" />
        <span class="pe-count" id="peCount">0</span>
        <button class="pe-btn" id="peExport" title="Export visible calls as JSON">Export</button>
        <button class="pe-btn" id="peClear" title="Clear captured calls">Clear</button>
      </div>
      <div class="pe-status" id="peStatus"></div>
      <div class="pe-list" id="peList"></div>
      <div class="pe-detail" id="peDetail" hidden></div>`;
    els = {
      filter: root.querySelector('#peFilter'),
      search: root.querySelector('#peSearch'),
      count: root.querySelector('#peCount'),
      list: root.querySelector('#peList'),
      detail: root.querySelector('#peDetail'),
      status: root.querySelector('#peStatus'),
    };
    els.filter.addEventListener('change', (e) => { state.filter = e.target.value; render(); });
    els.search.addEventListener('input', (e) => { state.search = e.target.value; render(); });
    root.querySelector('#peClear').addEventListener('click', () => {
      state.calls = []; state.selectedIndex = -1; hideDetail(); render();
    });
    root.querySelector('#peExport').addEventListener('click', exportCalls);
  }

  function getFiltered() {
    return state.calls.filter((c) => {
      const a = c.analysis;
      if (state.filter === 'mutations' && a.type !== 'mutation') return false;
      if (state.filter === 'actions' && a.type !== 'mutation' && a.isNoise) return false;
      if (state.search) {
        const hay = [a.displayName, a.operation, a.entity, ...a.details].filter(Boolean).join(' ').toLowerCase();
        if (!hay.includes(state.search.toLowerCase())) return false;
      }
      return true;
    });
  }

  function render() {
    if (!els.list) return;
    const items = getFiltered();
    els.count.textContent = items.length === state.calls.length ? `${state.calls.length}` : `${items.length}/${state.calls.length}`;
    if (items.length === 0) {
      els.list.innerHTML = `<div class="pe-empty">${state.calls.length > 0
        ? 'No calls match the current filter. Try “All traffic”.'
        : 'Listening… interact with JobTread and Pave calls will appear here.'}</div>`;
      return;
    }
    // Newest first — most recent Pave calls stay at the top so the user never
    // scrolls to find the latest. getFiltered() preserves capture order
    // (oldest→newest); reversing only the display keeps data-idx as the
    // canonical state.calls index, so detail lookups are unaffected.
    els.list.innerHTML = [...items].reverse().map((call) => {
      const idx = state.calls.indexOf(call);
      const a = call.analysis;
      const time = call.timestamp.toLocaleTimeString('en-US', { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' });
      const badge = a.type === 'mutation' ? 'mut' : a.type === 'other' ? 'evt' : 'qry';
      const txt = a.type === 'mutation' ? 'MUT' : a.type === 'other' ? 'EVT' : 'QRY';
      const meta = a.details.join(' · ') || a.entity || '';
      return `<div class="pe-item" data-idx="${idx}">
        <span class="pe-badge pe-${badge}">${txt}</span>
        <div class="pe-info"><div class="pe-name">${escText(a.displayName || 'Unknown')}</div>
        ${meta ? `<div class="pe-meta">${escText(meta)}</div>` : ''}</div>
        <span class="pe-time">${time}</span></div>`;
    }).join('');
    els.list.querySelectorAll('.pe-item').forEach((item) => {
      item.addEventListener('click', () => showDetail(parseInt(item.dataset.idx, 10)));
    });
  }

  function showDetail(index) {
    state.selectedIndex = index;
    const call = state.calls[index];
    const a = call.analysis;
    const reqJSON = JSON.stringify(call.requestBody, null, 2);
    const resJSON = JSON.stringify(call.responseBody, null, 2);
    const sanJSON = sanitize(call.requestBody);
    const badge = a.type === 'mutation' ? 'mut' : a.type === 'other' ? 'evt' : 'qry';
    const txt = a.type === 'mutation' ? 'MUT' : a.type === 'other' ? 'EVT' : 'QRY';
    const meta = [call.timestamp.toLocaleTimeString(), `HTTP ${call.status}`].concat(a.entity ? [a.entity] : []).concat(a.details);
    els.detail.hidden = false;
    els.list.hidden = true;
    els.detail.innerHTML = `
      <div class="pe-detail-head">
        <button class="pe-btn pe-back" id="peBack">← Back</button>
        <span class="pe-badge pe-${badge}">${txt}</span>
        <span class="pe-detail-name">${escText(a.displayName || 'Unknown')}</span>
      </div>
      <div class="pe-detail-meta">${escText(meta.join(' · '))}</div>
      <div class="pe-tabs">
        <button class="pe-tab active" data-tab="request">Request</button>
        <button class="pe-tab" data-tab="response">Response</button>
        <button class="pe-tab" data-tab="sanitized">Shareable</button>
      </div>
      <div class="pe-pane active" data-pane="request">
        <div class="pe-codebar"><span>Pave query</span><button class="pe-copy" data-copy="request">Copy</button></div>
        <pre class="pe-code"><code>${highlight(reqJSON)}</code></pre>
      </div>
      <div class="pe-pane" data-pane="response" hidden>
        <div class="pe-codebar"><span>Response</span><button class="pe-copy" data-copy="response">Copy</button></div>
        <pre class="pe-code"><code>${highlight(resJSON)}</code></pre>
      </div>
      <div class="pe-pane" data-pane="sanitized" hidden>
        <div class="pe-codebar"><span>Key-stripped — safe to share</span><button class="pe-copy" data-copy="sanitized">Copy</button></div>
        <pre class="pe-code"><code>${escText(sanJSON)}</code></pre>
      </div>`;
    els.detail.querySelector('#peBack').addEventListener('click', hideDetail);
    els.detail.querySelectorAll('.pe-tab').forEach((tab) => {
      tab.addEventListener('click', () => {
        const name = tab.dataset.tab;
        els.detail.querySelectorAll('.pe-tab').forEach((t) => t.classList.remove('active'));
        els.detail.querySelectorAll('.pe-pane').forEach((p) => { p.classList.remove('active'); p.hidden = true; });
        tab.classList.add('active');
        const pane = els.detail.querySelector(`.pe-pane[data-pane="${name}"]`);
        pane.classList.add('active'); pane.hidden = false;
      });
    });
    els.detail.querySelectorAll('.pe-copy').forEach((btn) => {
      btn.addEventListener('click', () => {
        const t = btn.dataset.copy;
        const text = t === 'request' ? reqJSON : t === 'response' ? resJSON : sanJSON;
        navigator.clipboard.writeText(text).then(() => {
          btn.textContent = 'Copied!';
          setTimeout(() => { btn.textContent = 'Copy'; }, 1200);
        });
      });
    });
  }

  function hideDetail() {
    state.selectedIndex = -1;
    if (els.detail) { els.detail.hidden = true; els.detail.innerHTML = ''; }
    if (els.list) els.list.hidden = false;
  }

  function exportCalls() {
    const items = getFiltered();
    const data = {
      _meta: { tool: 'JT Power Tools — Pave Explorer', exportedAt: new Date().toISOString(), count: items.length },
      calls: items.map((c) => ({
        timestamp: c.timestamp.toISOString(), operation: c.analysis.operation, type: c.analysis.type,
        displayName: c.analysis.displayName, entity: c.analysis.entity, status: c.status,
        request: c.requestBody, response: c.responseBody,
      })),
    };
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = `pave-capture-${new Date().toISOString().slice(0, 10)}.json`;
    a.click(); URL.revokeObjectURL(url);
  }

  function onCapture(payload) {
    if (!state.active) return;
    let reqBody = null;
    try { reqBody = typeof payload.requestBody === 'string' ? JSON.parse(payload.requestBody) : payload.requestBody; } catch (e) { reqBody = payload.requestBody; }
    let resBody = null;
    try { resBody = typeof payload.responseBody === 'string' ? JSON.parse(payload.responseBody) : payload.responseBody; } catch (e) { resBody = payload.responseBody; }
    state.calls.push({
      timestamp: new Date(payload.timestamp), url: payload.url, status: payload.status,
      requestBody: reqBody, responseBody: resBody, analysis: analyzeQuery(reqBody),
    });
    if (state.calls.length > 500) state.calls.shift();
    render();
  }

  // ── Lifecycle: start/stop capture on the active JobTread tab ────────
  // Uses a Port so captures go straight from the tab's content script to this
  // panel — bypassing the service worker.
  async function start() {
    if (state.active) return;
    let tab;
    try {
      const tabs = await chrome.tabs.query({ active: true, currentWindow: true, url: 'https://app.jobtread.com/*' });
      tab = tabs && tabs[0];
    } catch (e) { tab = null; }
    if (!tab) {
      if (els.status) els.status.textContent = 'Open a JobTread tab to capture Pave calls.';
      return;
    }
    let port;
    try {
      port = chrome.tabs.connect(tab.id, { name: 'pave-explorer' });
    } catch (e) {
      if (els.status) els.status.textContent = 'Reload your JobTread tab once, then reopen this panel.';
      return;
    }
    state.active = true;
    state.port = port;
    if (els.status) els.status.textContent = '';
    port.onMessage.addListener((msg) => {
      if (msg && msg.payload) onCapture(msg.payload);
    });
    port.onDisconnect.addListener(() => {
      // Content script not present (tab never loaded the extension) or tab closed.
      if (chrome.runtime.lastError && els.status) {
        els.status.textContent = 'Reload your JobTread tab once, then reopen this panel.';
      }
      state.active = false;
      state.port = null;
    });
  }

  function stop() {
    if (!state.active) return;
    state.active = false;
    if (state.port) {
      try { state.port.disconnect(); } catch (e) { /* already gone */ }
      state.port = null;
    }
  }

  function tierAllows(tier) {
    const ls = window.LicenseService;
    if (!ls || !ls.tierHasFeature) return false;
    // Match Inspect for AI (Pro) — a manual, local inspector, no MCP needed.
    return ls.tierHasFeature(tier, 'inspectForAi');
  }

  async function initGate() {
    const tabBtn = document.querySelector('.tab-item[data-tab="paveExplorer"]');
    const panel = document.getElementById('tab-paveExplorer');
    let allowed = false;
    try {
      const tier = window.LicenseService ? await window.LicenseService.getTier() : null;
      allowed = tierAllows(tier);
    } catch (e) { allowed = false; }
    if (!allowed) {
      if (tabBtn) tabBtn.style.display = 'none';
      if (panel) panel.style.display = 'none';
      return;
    }
    build();
    // Watch the panel's active state to start/stop capture without touching
    // popup.js's tab switcher.
    if (panel) {
      const obs = new MutationObserver(() => {
        const isActive = panel.classList.contains('active');
        if (isActive && !state.active) start();
        else if (!isActive && state.active) stop();
      });
      obs.observe(panel, { attributes: true, attributeFilter: ['class'] });
      if (panel.classList.contains('active')) start();
    }
  }

  window.addEventListener('pagehide', stop);

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initGate);
  } else {
    initGate();
  }
})();
