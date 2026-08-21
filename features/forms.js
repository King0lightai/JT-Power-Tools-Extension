/**
 * Forms Feature — Task 7 (PR #4 of 5)
 *
 * Top-level orchestrator for the per-job Forms drawer. Ties together:
 *   - services/forms-api.js          (REST wrapper)
 *   - features/forms-modules/job-detector.js  (SPA URL detector)
 *   - features/forms-modules/drawer.js        (DOM skeleton)
 *   - features/forms-modules/field-renderers.js (field cards)
 *   - features/forms-modules/save-engine.js   (state machine, debounced upsert)
 *
 * Lifecycle (orchestrator-driven):
 *   init()    — Auth + tier gate, inject CSS, mount drawer, wire callbacks,
 *               start SPA detector. Idempotent.
 *   cleanup() — Reverse all of the above. Idempotent.
 *   isActive() — Boolean.
 *
 * Open flow (handleOpenForCurrentJob):
 *   - Parallel fetch templates + instances for the current job
 *   - Compute "displayable" set: active templates + any template that has
 *     an instance even if the template was archived
 *   - 0 displayable → empty state
 *   - 1 displayable → auto-open the form
 *   - 2+ displayable → list view; back button visible inside openForm
 *
 * Conflict / merge:
 *   onMerge from save-engine fires with the list of fields the server
 *   refreshed. We re-render the active form (cheap for v1) and surface a
 *   toast naming the affected fields.
 */
const FormsFeature = (() => {
  const DEBUG = false;
  function log(...args) { if (DEBUG) console.log('FormsFeature:', ...args); }

  // Internal state — all torn down by cleanup()
  let active = false;
  let currentJob = null;          // { jobId } | null
  let currentOrgId = null;        // resolved lazily via JobTreadAPI.getOrgId()
  let formsCache = null;          // { instances, availableTemplates } cached for current job
  let activeTemplate = null;      // template the user is currently filling (header-only when from instance wrapper)
  let activeSchema = null;        // schema being rendered (pinned for instances, current for unfilled)
  let activeInstance = null;      // instance object (or null when fresh)
  let savedAtTimer = null;        // ticks the "Saved Ns ago" relative time
  let printHeaderEl = null;       // injected print-only header element (cleaned in afterprint)
  let printAfterHandler = null;   // reference to the afterprint listener so we can detach

  // ─── Helpers: tier + auth gate ──────────────────────────────────────

  /**
   * Resolve the user's current license tier. Uses LicenseService — the
   * AccountService user object does not carry tier info on its own.
   */
  async function getTier() {
    if (!window.LicenseService || typeof window.LicenseService.getTier !== 'function') {
      return null;
    }
    try {
      return await window.LicenseService.getTier();
    } catch (err) {
      console.warn('FormsFeature: getTier failed', err);
      return null;
    }
  }

  function isLoggedIn() {
    return !!(window.AccountService && window.AccountService.isLoggedIn && window.AccountService.isLoggedIn());
  }

  /**
   * Rank-based tier gate for Forms. Forms is a Power User feature, but the
   * Assistant / Assistant Pro company tiers rank ABOVE Power User and inherit
   * it — so we ask LicenseService.tierHasFeature (rank-based) rather than an
   * exact `tier === 'power_user'`, which silently locked those higher tiers out.
   */
  function tierAllowsForms(tier) {
    return !!(window.LicenseService
      && typeof window.LicenseService.tierHasFeature === 'function'
      && window.LicenseService.tierHasFeature(tier, 'forms'));
  }

  // ─── Stylesheet ─────────────────────────────────────────────────────

  function injectStylesheet() {
    if (document.getElementById('jt-forms-stylesheet')) return;
    const link = document.createElement('link');
    link.id = 'jt-forms-stylesheet';
    link.rel = 'stylesheet';
    link.href = chrome.runtime.getURL('styles/forms.css');
    document.head.appendChild(link);
  }

  function removeStylesheet() {
    const link = document.getElementById('jt-forms-stylesheet');
    if (link) link.remove();
  }

  // ─── SPA job-change handler ─────────────────────────────────────────

  function sameJobAsInstance(job, instance) {
    if (!job || !instance) return false;
    if (instance.jtJobId !== job.jobId) return false;
    // If we already know the org id, double-check it matches; otherwise fall
    // back to job-only comparison (the org is implicit in the auth context).
    if (currentOrgId && instance.jtOrgId && instance.jtOrgId !== currentOrgId) {
      return false;
    }
    return true;
  }

  function handleJobChange(job) {
    log('handleJobChange', job);
    currentJob = job;
    formsCache = null;

    // Lazily resolve the org id when we first see a job. The org doesn't
    // change mid-session for a given user, so we only kick this off once.
    // If the resolution races the open handler, that handler awaits its
    // own getOrgId() fallback before fetching.
    if (job && !currentOrgId && typeof JobTreadAPI !== 'undefined') {
      JobTreadAPI.getOrgId().then(orgId => {
        if (orgId && !currentOrgId) currentOrgId = orgId;
      }).catch(err => console.warn('FormsFeature: getOrgId failed', err));
    }

    // If we navigated to a different job (or off-job) while the drawer is
    // open, dispose the active form and close the drawer.
    if (window.FormsDrawer && window.FormsDrawer.isOpen()) {
      const drawerJobMatches = activeInstance
        ? sameJobAsInstance(job, activeInstance)
        : false;
      if (!job || !drawerJobMatches) {
        handleClose();
      }
    }

    // Nudge the action-bar injector to re-inject — JT's per-job sub-routes
    // may not have rendered the bar yet at the moment of navigation, and
    // the injector's MutationObserver will catch it eventually, but a
    // direct call shortens the latency on common job-change paths.
    if (window.FormsActionBarInjector
        && typeof window.FormsActionBarInjector.tryInject === 'function') {
      window.FormsActionBarInjector.tryInject();
    }
  }

  // ─── Open / list / form views ───────────────────────────────────────

  /**
   * Combine filled instances + available unfilled templates into a unified
   * displayable list. Each entry has shape `{ template, schema, instance }`
   * where `instance` is null for unfilled templates.
   *
   * For filled instances, `template` is the header pinned to the version
   * the instance was saved with, and `schema` is that pinned schema (NOT
   * `template.schema`, which is undefined for header-only records). For
   * unfilled templates, `template` is the full record and `schema` is the
   * current schema.
   *
   * The server already excludes archived-without-instance templates from
   * `availableTemplates`, and archived-with-instance comes through the
   * `instances` array intentionally (so historical data stays readable).
   *
   * @param {Array<{instance: Object, template: Object, schema: Object}>} instances
   * @param {Array<Object>} availableTemplates - full templates with `.schema`
   * @returns {Array<{ template: Object, schema: Object | null, instance: Object | null }>}
   */
  function computeDisplayable(instances, availableTemplates) {
    const iArr = Array.isArray(instances) ? instances : [];
    const aArr = Array.isArray(availableTemplates) ? availableTemplates : [];
    const filled = iArr
      .filter(w => w && w.instance && w.template)
      .map(w => ({
        template: w.template,
        schema: w.schema || null,
        instance: w.instance,
      }));
    const empty = aArr
      .filter(t => t && typeof t === 'object' && t.id)
      .map(t => ({
        template: t,
        schema: t.schema || null,
        instance: null,
      }));
    // Honor the admin-defined display order (sort_order, set in the portal).
    // The server returns filled instances and available templates as two
    // separate arrays, so concatenating them loses cross-array order — sort
    // the merged list by template.sortOrder to restore the #1/#2/#3 sequence.
    // Fall back to 0 for any record missing the field (older server response).
    const orderOf = (entry) => {
      const v = entry && entry.template ? entry.template.sortOrder : undefined;
      return typeof v === 'number' ? v : 0;
    };
    return [...filled, ...empty].sort((a, b) => orderOf(a) - orderOf(b));
  }

  async function handleOpenForCurrentJob() {
    if (!currentJob) return;
    if (!window.FormsDrawer) return;

    const orgId = currentOrgId
      || (typeof JobTreadAPI !== 'undefined' ? await JobTreadAPI.getOrgId() : null);
    if (!orgId) {
      window.FormsDrawer.open();
      renderErrorState({
        message: 'Could not determine your JobTread organization. Please re-authenticate in the popup.'
      });
      return;
    }
    currentOrgId = orgId;

    window.FormsDrawer.open();
    renderLoadingState();

    try {
      const { instances, availableTemplates } = await window.FormsApi.listInstancesByJob(
        currentOrgId,
        currentJob.jobId
      );
      formsCache = { instances, availableTemplates };

      const displayable = computeDisplayable(instances, availableTemplates);

      if (displayable.length === 0) {
        renderEmptyState();
      } else if (displayable.length === 1) {
        await openForm(displayable[0]);
      } else {
        showListView();
      }
    } catch (err) {
      console.error('FormsFeature: failed to load forms for job', err);
      renderErrorState(err);
    }
  }

  function showListView() {
    if (!formsCache || !window.FormsDrawer) return;
    // Tear down any in-flight save engine for the previous form
    if (window.FormsSaveEngine) {
      try { window.FormsSaveEngine.dispose(); } catch (_e) { /* noop */ }
    }
    stopSavedAtTimer();
    activeTemplate = null;
    activeSchema = null;
    activeInstance = null;

    window.FormsDrawer.setTitle('Worksheets');
    window.FormsDrawer.setBackVisible(false);
    window.FormsDrawer.setStatusPill(null, '');
    if (typeof window.FormsDrawer.setSavePdfVisible === 'function') {
      window.FormsDrawer.setSavePdfVisible(false);
    }

    renderListView(computeDisplayable(formsCache.instances, formsCache.availableTemplates));
  }

  async function openForm(entry) {
    if (!entry || !entry.template) return;
    if (!window.FormsDrawer || !window.FormsSaveEngine) return;

    const template = entry.template;
    const schema = entry.schema || null;
    const instance = entry.instance || null;
    activeTemplate = template;
    activeSchema = schema;
    activeInstance = instance;

    window.FormsDrawer.setTitle(template.name || 'Untitled');

    const showBack = formsCache
      ? computeDisplayable(formsCache.instances, formsCache.availableTemplates).length > 1
      : false;
    window.FormsDrawer.setBackVisible(showBack);

    const initialData = (instance && instance.data && typeof instance.data === 'object')
      ? instance.data
      : {};
    const initialVersion = instance && Number.isInteger(instance.optimisticVersion)
      ? instance.optimisticVersion
      : 0;

    try {
      window.FormsSaveEngine.init({
        templateId: template.id,
        jtOrgId: currentOrgId,
        jtJobId: currentJob.jobId,
        initialData,
        initialVersion,
        onStateChange: handleSaveStateChange,
        onMerge: handleMerge,
      });
    } catch (err) {
      console.error('FormsFeature: save engine init failed', err);
      renderErrorState(err);
      return;
    }

    renderFormFields(schema, initialData);
    window.FormsDrawer.setStatusPill(null, '');
    recomputeSavePdfVisibility(schema, initialData);
  }

  /**
   * Toggle the "Save signed PDF to Job Files" button. We only surface it
   * once at least one signature has been captured — printing/uploading an
   * unsigned form via this button would create a noisy file in JT.
   */
  function recomputeSavePdfVisibility(schema, data) {
    if (!window.FormsDrawer || typeof window.FormsDrawer.setSavePdfVisible !== 'function') return;
    const visible = hasCapturedSignature(schema, data);
    window.FormsDrawer.setSavePdfVisible(visible);
  }

  function hasCapturedSignature(schema, data) {
    if (!schema || !Array.isArray(schema.fields) || !data) return false;
    for (const field of schema.fields) {
      if (!field || field.type !== 'signature') continue;
      const v = data[field.id];
      if (v && typeof v === 'object' && typeof v.dataUrl === 'string' && v.dataUrl.length > 0) {
        return true;
      }
    }
    return false;
  }

  /**
   * Render the form's fields for the given schema + initial data. The
   * schema is the explicit one passed in (pinned for an instance, current
   * for an unfilled template) — never read from the template, since
   * `composeTemplateHeader` does NOT include schema.
   *
   * @param {Object|null} schema - schema with `.fields` array
   * @param {Object} data - initial values keyed by field id
   */
  function renderFormFields(schema, data) {
    if (!window.FormsDrawer || !window.FormsFieldRenderers) return;
    const container = window.FormsDrawer.getContentEl();
    if (!container) return;

    // Wipe whatever's currently rendered (list, loading, prior form)
    while (container.firstChild) container.removeChild(container.firstChild);

    const safe = (schema && typeof schema === 'object') ? schema : { fields: [] };
    const fields = Array.isArray(safe.fields) ? safe.fields : [];

    if (fields.length === 0) {
      const empty = document.createElement('div');
      empty.className = 'jt-forms-empty-state';
      empty.textContent = 'This worksheet has no fields yet.';
      container.appendChild(empty);
      return;
    }

    for (const field of fields) {
      try {
        const card = window.FormsFieldRenderers.renderField(
          field,
          data ? data[field.id] : undefined,
          (fieldId, newValue) => {
            if (window.FormsSaveEngine) {
              window.FormsSaveEngine.markDirty(fieldId, newValue);
            }
          }
        );
        if (card) container.appendChild(card);
      } catch (err) {
        console.error('FormsFeature: failed to render field', field, err);
      }
    }
  }

  // ─── Save state pill ────────────────────────────────────────────────

  function handleSaveStateChange(state, meta) {
    if (!window.FormsDrawer) return;
    const m = meta || {};

    // Recompute save-pdf button visibility on every state transition. The
    // user's signature can land in any of dirty/saving/saved, and the
    // simplest correct heuristic is to scan the latest data each time.
    if (window.FormsSaveEngine && activeSchema) {
      try {
        const latest = window.FormsSaveEngine.getData();
        recomputeSavePdfVisibility(activeSchema, latest);
      } catch (_e) { /* noop */ }
    }

    switch (state) {
      case 'idle':
        stopSavedAtTimer();
        window.FormsDrawer.setStatusPill(null, '');
        break;
      case 'dirty':
        stopSavedAtTimer();
        window.FormsDrawer.setStatusPill('unsaved', 'Unsaved');
        break;
      case 'saving':
        stopSavedAtTimer();
        window.FormsDrawer.setStatusPill('saving', 'Saving...');
        break;
      case 'saved':
        startSavedAtTimer(m.savedAt instanceof Date ? m.savedAt : new Date());
        break;
      case 'conflict':
        stopSavedAtTimer();
        window.FormsDrawer.setStatusPill('conflict', 'Conflict — click to merge');
        break;
      case 'offline':
        stopSavedAtTimer();
        if (m.permanent) {
          const status = m.status;
          let text;
          if (status === 401) text = 'Auth error — please re-login';
          else if (status === 403) text = 'Permission denied';
          else if (status === 404) text = 'Worksheet deleted';
          else text = 'Save failed (' + status + ')';
          window.FormsDrawer.setStatusPill('offline', text);
        } else {
          window.FormsDrawer.setStatusPill('offline', 'Offline — will retry');
        }
        break;
      default:
        // Unknown state — leave pill alone
        break;
    }
  }

  function startSavedAtTimer(savedAt) {
    stopSavedAtTimer();
    const tick = () => {
      if (!window.FormsDrawer) return;
      const seconds = Math.floor((Date.now() - savedAt.getTime()) / 1000);
      let text;
      if (seconds < 5) text = 'Saved just now';
      else if (seconds < 60) text = 'Saved ' + seconds + 's ago';
      else if (seconds < 3600) text = 'Saved ' + Math.floor(seconds / 60) + 'm ago';
      else text = 'Saved ' + Math.floor(seconds / 3600) + 'h ago';
      window.FormsDrawer.setStatusPill('saved', text);
    };
    tick();
    savedAtTimer = setInterval(tick, 5000);
  }

  function stopSavedAtTimer() {
    if (savedAtTimer) {
      clearInterval(savedAtTimer);
      savedAtTimer = null;
    }
  }

  // ─── Merge handler + toast ──────────────────────────────────────────

  function handleMerge(refreshedFieldIds, lastEditedBy, lastEditedAt) {
    if (!Array.isArray(refreshedFieldIds) || refreshedFieldIds.length === 0) return;
    if (!activeTemplate || !window.FormsSaveEngine) return;

    // Re-render with the merged data. Per design doc, a field-keyed renderer
    // is a v2 concern — full re-render is acceptable for v1.
    const data = window.FormsSaveEngine.getData();
    renderFormFields(activeSchema, data);

    const fieldNameMap = buildFieldNameMap(activeSchema);
    const names = refreshedFieldIds.map(id => fieldNameMap.get(id) || id).slice(0, 3);
    const more = refreshedFieldIds.length > 3 ? '...' : '';
    const who = (typeof lastEditedBy === 'string' && lastEditedBy) ? lastEditedBy : 'someone';
    const count = refreshedFieldIds.length;
    const text = 'Synced edits from ' + who + ' · ' + count
      + ' field' + (count === 1 ? '' : 's')
      + ' refreshed: ' + names.join(', ') + more;
    showToast(text, 'info');
  }

  /**
   * Build an id → label map from a schema. Used by the merge toast to
   * surface human-readable field names. Takes a schema directly (not a
   * template) since header-only template records don't carry one.
   *
   * @param {Object|null} schema
   * @returns {Map<string,string>}
   */
  function buildFieldNameMap(schema) {
    const m = new Map();
    if (schema && Array.isArray(schema.fields)) {
      for (const f of schema.fields) {
        if (f && f.id && f.label) m.set(f.id, f.label);
      }
    }
    return m;
  }

  function showToast(text, kind) {
    window.JTToast.show(text, { kind });
  }

  // ─── View renderers ─────────────────────────────────────────────────

  function clearContent() {
    if (!window.FormsDrawer) return null;
    const container = window.FormsDrawer.getContentEl();
    if (!container) return null;
    while (container.firstChild) container.removeChild(container.firstChild);
    return container;
  }

  function renderLoadingState() {
    const container = clearContent();
    if (!container) return;
    const div = document.createElement('div');
    div.className = 'jt-forms-loading-state';
    div.textContent = 'Loading worksheets...';
    container.appendChild(div);
  }

  function renderEmptyState() {
    const container = clearContent();
    if (!container) return;
    const wrap = document.createElement('div');
    wrap.className = 'jt-forms-empty-state';

    const heading = document.createElement('p');
    heading.className = 'jt-forms-empty-heading';
    heading.textContent = 'No worksheets have been created yet.';
    wrap.appendChild(heading);

    const subtitle = document.createElement('p');
    subtitle.className = 'jt-forms-empty-subtitle';
    subtitle.textContent = 'Create one in the portal admin builder, then it will appear here for every job.';
    wrap.appendChild(subtitle);

    const link = document.createElement('a');
    link.className = 'jt-forms-empty-link';
    link.href = 'https://app.jtpowertools.com/dashboard.html#forms';
    link.target = '_blank';
    link.rel = 'noopener noreferrer';
    link.textContent = 'Open the Worksheet Builder';
    wrap.appendChild(link);

    container.appendChild(wrap);
  }

  function renderErrorState(err) {
    const container = clearContent();
    if (!container) return;
    const wrap = document.createElement('div');
    wrap.className = 'jt-forms-error-state';

    const title = document.createElement('p');
    title.className = 'jt-forms-error-title';
    title.textContent = 'Could not load worksheets';
    wrap.appendChild(title);

    const detail = document.createElement('p');
    detail.className = 'jt-forms-error-detail';
    if (err && err.status === 403) {
      detail.textContent = 'This feature requires the Power User tier.';
    } else if (err && err.message) {
      detail.textContent = err.message;
    } else {
      detail.textContent = 'An unknown error occurred.';
    }
    wrap.appendChild(detail);

    container.appendChild(wrap);
  }

  function renderListView(displayable) {
    const container = clearContent();
    if (!container) return;

    const list = document.createElement('div');
    list.className = 'jt-forms-list';

    for (const entry of displayable) {
      const card = buildListCard(entry);
      list.appendChild(card);
    }

    container.appendChild(list);
  }

  function buildListCard(entry) {
    const template = entry.template;
    const instance = entry.instance;

    const card = document.createElement('button');
    card.type = 'button';
    card.className = 'jt-forms-list-card';
    card.addEventListener('click', () => {
      openForm(entry).catch(err => console.error('FormsFeature: openForm failed', err));
    });

    const main = document.createElement('div');
    main.className = 'jt-forms-list-card-main';

    const name = document.createElement('div');
    name.className = 'jt-forms-list-card-name';
    name.textContent = template.name || 'Untitled';
    main.appendChild(name);

    if (template.description) {
      const desc = document.createElement('div');
      desc.className = 'jt-forms-list-card-description';
      const text = String(template.description);
      desc.textContent = text.length > 140 ? text.slice(0, 137) + '...' : text;
      main.appendChild(desc);
    }

    const meta = computeListCardMeta(template, instance);
    if (meta) {
      const metaEl = document.createElement('div');
      metaEl.className = 'jt-forms-list-card-meta';
      metaEl.textContent = meta;
      main.appendChild(metaEl);
    }

    card.appendChild(main);

    const status = computeListCardStatus(template, instance);
    if (status) {
      const pill = document.createElement('span');
      pill.className = 'jt-forms-list-card-pill is-' + status.kind;
      pill.textContent = status.label;
      card.appendChild(pill);
    }

    return card;
  }

  function computeListCardStatus(template, instance) {
    if (!instance) {
      if (template && template.autoAttachToNewJobs) {
        return { kind: 'auto', label: 'Auto-attached' };
      }
      return { kind: 'empty', label: 'Empty' };
    }
    const data = (instance.data && typeof instance.data === 'object') ? instance.data : null;
    const hasData = data ? Object.keys(data).length > 0 : false;
    if (hasData) return { kind: 'progress', label: 'In progress' };
    return { kind: 'empty', label: 'Empty' };
  }

  function computeListCardMeta(_template, instance) {
    if (!instance) return null;
    const editor = instance.lastEditedByName || instance.lastEditedBy || null;
    const ts = instance.lastEditedAt || instance.updatedAt || null;
    if (!editor && !ts) return null;
    const parts = [];
    if (editor) parts.push('by ' + editor);
    if (ts) {
      const rel = formatRelativeTime(ts);
      if (rel) parts.push(rel);
    }
    return parts.join(' · ');
  }

  function formatRelativeTime(input) {
    let ms = null;
    if (typeof input === 'number') {
      ms = input;
    } else if (typeof input === 'string') {
      // Numeric strings (e.g. from D1's strftime('%s','now')) — parse as integer
      // and let the magnitude-detection below decide seconds vs ms. Date.parse on
      // a bare digit string returns NaN, so handle this case first.
      if (/^-?\d+$/.test(input)) {
        const asNum = Number(input);
        if (Number.isFinite(asNum)) ms = asNum;
      } else {
        const parsed = Date.parse(input);
        if (!Number.isNaN(parsed)) ms = parsed;
      }
    }
    if (ms == null) return '';
    // Server stores last_edited_at / updated_at via D1's strftime('%s','now')
    // which returns Unix SECONDS. JS Date constructors expect MILLISECONDS.
    // Auto-detect by magnitude: any value < 1e12 (~Sep 2001 in ms) is almost
    // certainly seconds, since current ms timestamps are ~1.7e12.
    if (Math.abs(ms) < 1e12) ms *= 1000;
    const diff = Math.max(0, Date.now() - ms);
    const seconds = Math.floor(diff / 1000);
    if (seconds < 60) return 'just now';
    const minutes = Math.floor(seconds / 60);
    if (minutes < 60) return minutes + 'm ago';
    const hours = Math.floor(minutes / 60);
    if (hours < 24) return hours + 'h ago';
    const days = Math.floor(hours / 24);
    if (days < 30) return days + 'd ago';
    const months = Math.floor(days / 30);
    if (months < 12) return months + 'mo ago';
    const years = Math.floor(days / 365);
    return years + 'y ago';
  }

  // ─── Print handler ──────────────────────────────────────────────────

  /**
   * Trigger the browser's print dialog after injecting a print-only header
   * (form name + job context + date). Cleans up via the afterprint event so
   * the header doesn't persist on screen if the user cancels the dialog.
   */
  function handlePrint() {
    // Best-effort save before printing — user expects what's on screen to be on paper.
    try {
      if (window.FormsSaveEngine) {
        const flush = window.FormsSaveEngine.forceSave();
        if (flush && typeof flush.catch === 'function') {
          flush.catch(() => { /* noop — engine surfaces its own state */ });
        }
      }
    } catch (_e) { /* noop */ }

    injectPrintHeader();

    // Tear the header back down whether the user prints or cancels. We attach
    // afterprint (not beforeprint) so the header is on the page during the
    // actual print render, then yanked once the dialog closes.
    if (printAfterHandler) {
      window.removeEventListener('afterprint', printAfterHandler);
    }
    printAfterHandler = () => {
      removePrintHeader();
      if (printAfterHandler) {
        window.removeEventListener('afterprint', printAfterHandler);
        printAfterHandler = null;
      }
    };
    window.addEventListener('afterprint', printAfterHandler);

    try {
      window.print();
    } catch (err) {
      console.error('FormsFeature: window.print failed', err);
      // Tear down the injected header immediately if print errored before
      // the afterprint event could fire.
      if (printAfterHandler) {
        window.removeEventListener('afterprint', printAfterHandler);
        printAfterHandler = null;
      }
      removePrintHeader();
    }
  }

  function injectPrintHeader() {
    removePrintHeader();
    if (!window.FormsDrawer) return;
    const content = window.FormsDrawer.getContentEl();
    if (!content || !activeTemplate) return;

    const header = document.createElement('div');
    header.className = 'jt-forms-print-header';

    const h1 = document.createElement('h1');
    h1.textContent = activeTemplate.name || 'Worksheet';
    header.appendChild(h1);

    const ctx = document.createElement('div');
    ctx.className = 'jt-forms-print-context';
    const dateStr = new Date().toLocaleDateString();
    ctx.textContent = currentJob && currentJob.jobId
      ? 'Job: ' + currentJob.jobId + '    Printed: ' + dateStr
      : 'Printed: ' + dateStr;
    header.appendChild(ctx);

    content.insertBefore(header, content.firstChild);
    printHeaderEl = header;
  }

  function removePrintHeader() {
    if (printHeaderEl && printHeaderEl.parentElement) {
      printHeaderEl.parentElement.removeChild(printHeaderEl);
    }
    printHeaderEl = null;
  }

  // ─── Save signed PDF to Job Files ───────────────────────────────────

  /**
   * Build a PDF of the current form state (with embedded signature image)
   * and upload it directly to the job's Files via the Pave API. Runs
   * client-side end-to-end — no extension-server round-trip — using the
   * grant key the user already has configured for JobTreadAPI.
   */
  async function handleSavePdf() {
    if (!window.FormsDrawer || !window.FormsPdfExporter) return;
    if (!window.FormsSaveEngine || !window.JobTreadAPI) return;
    if (!activeTemplate || !activeSchema || !currentJob) return;

    window.FormsDrawer.setSavePdfBusy(true);

    try {
      // Force-save before exporting so the PDF reflects what's persisted.
      // If the save fails (offline/conflict), we abort the upload and let
      // the existing status pill explain why.
      try {
        const flush = window.FormsSaveEngine.forceSave();
        if (flush && typeof flush.then === 'function') await flush;
      } catch (saveErr) {
        showToast('Could not save worksheet before exporting: ' + (saveErr && saveErr.message
          ? saveErr.message : 'unknown error'), 'error');
        return;
      }

      const data = window.FormsSaveEngine.getData() || {};
      const generatedAt = new Date();
      const { base64 } = window.FormsPdfExporter.buildPdf({
        schema: activeSchema,
        data,
        template: activeTemplate,
        job: currentJob,
        generatedAt,
      });
      const fileName = window.FormsPdfExporter.buildFilename(activeTemplate, generatedAt);

      // Decode base64 → Uint8Array. Worker upload helpers expect raw bytes.
      const bytes = base64ToUint8Array(base64);

      const file = await window.JobTreadAPI.uploadFileToJob({
        bytes,
        fileName,
        jobId: currentJob.jobId,
        contentType: 'application/pdf',
        message: 'Signed worksheet: ' + (activeTemplate.name || 'Worksheet'),
      });

      showToast('Saved to Job Files: ' + (file && file.name ? file.name : fileName), 'success');
    } catch (err) {
      console.error('FormsFeature: Save signed PDF failed', err);
      showToast('Save signed PDF failed: ' + (err && err.message ? err.message : 'unknown error'), 'error');
    } finally {
      window.FormsDrawer.setSavePdfBusy(false);
    }
  }

  /**
   * Decode a base64 string to a Uint8Array. Used to hand the PDF bytes to
   * JobTreadAPI.uploadFileToJob. Browser's atob is the canonical primitive.
   */
  function base64ToUint8Array(base64) {
    const binary = atob(base64);
    const out = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i);
    return out;
  }

  // ─── Close handler ──────────────────────────────────────────────────

  function handleClose() {
    log('handleClose');
    // Best-effort flush of any pending save before tearing down.
    if (window.FormsSaveEngine) {
      try {
        const flush = window.FormsSaveEngine.forceSave();
        if (flush && typeof flush.catch === 'function') {
          flush.catch(() => { /* noop — engine surfaces its own state */ });
        }
      } catch (_e) { /* noop */ }
      try { window.FormsSaveEngine.dispose(); } catch (_e) { /* noop */ }
    }
    stopSavedAtTimer();
    activeTemplate = null;
    activeSchema = null;
    activeInstance = null;
    if (window.FormsDrawer && typeof window.FormsDrawer.setSavePdfVisible === 'function') {
      window.FormsDrawer.setSavePdfVisible(false);
    }
    if (window.FormsDrawer && window.FormsDrawer.isOpen()) {
      window.FormsDrawer.close();
    }
  }

  // ─── Lifecycle ──────────────────────────────────────────────────────

  async function init() {
    if (active) return;

    if (!isLoggedIn()) {
      log('init: not logged in — skipping');
      return;
    }

    const tier = await getTier();
    if (!tierAllowsForms(tier)) {
      log('init: tier gate — current tier is', tier);
      return;
    }

    if (!window.FormsDrawer || !window.FormsApi || !window.FormsJobDetector
        || !window.FormsFieldRenderers || !window.FormsSaveEngine) {
      console.warn('FormsFeature: dependencies not available, aborting init');
      return;
    }

    // Migration 029 company-wide gate. The Forms toggle moved from the
    // extension popup to the JT Power Tools Portal — an admin / owner
    // on the license has to flip the toggle ON before the per-job
    // drawer mounts for anyone. Failure modes (network, auth) treat as
    // OFF so we never silently enable a feature the company hasn't
    // sanctioned. Cached for 60s inside FormsApi.
    if (typeof window.FormsApi.isCompanyEnabled === 'function') {
      try {
        const enabled = await window.FormsApi.isCompanyEnabled();
        if (!enabled) {
          log('init: company toggle is OFF — skipping mount');
          return;
        }
      } catch (err) {
        console.warn('FormsFeature: company-enabled check failed, skipping mount', err);
        return;
      }
    }

    injectStylesheet();

    try {
      await window.FormsDrawer.mount();
    } catch (err) {
      console.error('FormsFeature: drawer mount failed', err);
      removeStylesheet();
      return;
    }

    // The action-bar injector owns the button that toggles the drawer
    // open/closed; same toggle semantics the old folder tab had.
    const handleActionButtonClick = () => {
      if (!window.FormsDrawer) return;
      if (window.FormsDrawer.isOpen()) {
        handleClose();
      } else {
        handleOpenForCurrentJob().catch(err =>
          console.error('FormsFeature: open failed', err));
      }
    };
    if (window.FormsActionBarInjector) {
      window.FormsActionBarInjector.start(handleActionButtonClick);
    } else {
      console.warn('FormsFeature: FormsActionBarInjector not available');
    }

    window.FormsDrawer.setOnClose(() => {
      // The close button / ESC inside the drawer fires this — we still
      // want our teardown semantics (dispose engine, stop timer, null state)
      // even though the drawer itself has already toggled closed.
      if (window.FormsSaveEngine) {
        try {
          const flush = window.FormsSaveEngine.forceSave();
          if (flush && typeof flush.catch === 'function') {
            flush.catch(() => {});
          }
        } catch (_e) { /* noop */ }
        try { window.FormsSaveEngine.dispose(); } catch (_e) { /* noop */ }
      }
      stopSavedAtTimer();
      activeTemplate = null;
      activeSchema = null;
      activeInstance = null;
    });
    window.FormsDrawer.setOnBackClick(() => {
      showListView();
    });
    window.FormsDrawer.setOnPrint(() => {
      handlePrint();
    });
    window.FormsDrawer.setOnSavePdf(() => {
      handleSavePdf().catch(err => console.error('FormsFeature: handleSavePdf failed', err));
    });

    window.FormsJobDetector.start(handleJobChange);

    active = true;
    log('init: ready');
  }

  function cleanup() {
    if (!active) return;
    log('cleanup');

    // Kill any in-flight save engine + timer
    if (window.FormsSaveEngine) {
      try { window.FormsSaveEngine.dispose(); } catch (_e) { /* noop */ }
    }
    stopSavedAtTimer();

    // Stop SPA detector first so a late-arriving job change can't re-enter
    // mid-cleanup.
    if (window.FormsJobDetector) {
      try { window.FormsJobDetector.stop(); } catch (_e) { /* noop */ }
    }

    // Stop the action-bar injector before unmounting the drawer so the
    // button can't fire mid-teardown.
    if (window.FormsActionBarInjector) {
      try { window.FormsActionBarInjector.stop(); } catch (_e) { /* noop */ }
    }

    // Tear down drawer DOM
    if (window.FormsDrawer) {
      try { window.FormsDrawer.unmount(); } catch (_e) { /* noop */ }
    }

    removeStylesheet();

    // Detach any pending afterprint listener and drop the injected header.
    if (printAfterHandler) {
      window.removeEventListener('afterprint', printAfterHandler);
      printAfterHandler = null;
    }
    removePrintHeader();

    currentJob = null;
    currentOrgId = null;
    formsCache = null;
    activeTemplate = null;
    activeSchema = null;
    activeInstance = null;
    active = false;
  }

  function isActive() {
    return active;
  }

  return {
    init,
    cleanup,
    isActive,
  };
})();

if (typeof window !== 'undefined') {
  window.FormsFeature = FormsFeature;
}
