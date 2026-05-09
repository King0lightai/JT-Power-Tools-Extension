# Forms Extension Tab — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add a non-invasive folder-tab trigger + right-side drawer to JT job pages that lets Power Users on a license fill per-job form templates, syncing to the `/admin/forms/*` REST endpoints with auto-save and field-level conflict merge.

**Architecture:** New `FormsFeature` IIFE module under `JT-Tools-Master/features/forms.js`, with its own sub-modules (`forms-modules/{drawer,job-detector,field-renderers,save-engine}.js`) and a thin `services/forms-api.js` wrapper that piggy-backs on `AccountService.authenticatedFetch` (same pattern as `services/tweaks-api.js`). MutationObserver-based SPA URL detection guards visibility. No automated test runner exists in this project — verification at each task is via manual Chrome reload + console probe (per `.claude/rules/testing-debug.md`).

**Tech Stack:** Plain JavaScript (no TypeScript, no bundler), Chrome Extension Manifest V3, Chrome Storage API, fetch + Bearer JWT, `chrome.runtime.getURL` for stylesheet injection.

**Design doc:** [docs/plans/2026-05-04-forms-extension-tab-design.md](2026-05-04-forms-extension-tab-design.md)

---

## Task 1: REST wrapper — `services/forms-api.js`

**Files:**
- Create: `JT-Tools-Master/services/forms-api.js`
- Reference: `JT-Tools-Master/services/tweaks-api.js` (mirror its `postJson` + IIFE shape)

**Step 1.1:** Write `services/forms-api.js` with three public methods (`listInstancesByJob`, `listTemplates`, `upsertInstance`) wrapping `AccountService.authenticatedFetch`. Reuse the exact `postJson` helper from `tweaks-api.js:50-74` — same 401-refresh, same error normalization, same DEBUG-flag log gate.

```js
const FormsApi = (() => {
  const DEBUG = false;
  function log(...a) { if (DEBUG) console.log('FormsApi:', ...a); }

  function requireAccountService() {
    const svc = window.AccountService;
    if (!svc) throw new Error('AccountService not loaded');
    if (!svc.isLoggedIn || !svc.isLoggedIn()) throw new Error('Not logged in');
    return svc;
  }

  async function postJson(endpoint, body) {
    const svc = requireAccountService();
    const response = await svc.authenticatedFetch(endpoint, {
      method: 'POST',
      body: JSON.stringify(body || {})
    });
    let payload = null;
    try { payload = await response.json(); } catch (_) {}
    if (!response.ok) {
      const msg = (payload && (payload.error || payload.message))
        || ('HTTP ' + response.status + ' ' + response.statusText);
      const err = new Error(msg);
      err.status = response.status;
      err.payload = payload;
      throw err;
    }
    return payload;
  }

  async function listTemplates() {
    log('listTemplates');
    const r = await postJson('/admin/forms/templates/list');
    return Array.isArray(r.templates) ? r.templates : [];
  }
  async function listInstancesByJob(jtOrgId, jtJobId) {
    if (!jtOrgId || !jtJobId) throw new Error('jtOrgId and jtJobId are required');
    log('listInstancesByJob', { jtOrgId, jtJobId });
    const r = await postJson('/admin/forms/instances/list-by-job', { jtOrgId, jtJobId });
    return Array.isArray(r.instances) ? r.instances : [];
  }
  async function upsertInstance(payload) {
    log('upsertInstance', payload);
    return postJson('/admin/forms/instances/upsert', payload);
  }

  return { listTemplates, listInstancesByJob, upsertInstance };
})();
window.FormsApi = FormsApi;
```

**Step 1.2:** Verify the file parses cleanly.

Run: `node --check JT-Tools-Master/services/forms-api.js`
Expected: no output (success).

**Step 1.3:** Add to `manifest.json` `content_scripts[0].js` array AFTER `services/account-service.js` and BEFORE the feature module list (the feature uses it).

**Step 1.4:** Commit.

```bash
git add JT-Tools-Master/services/forms-api.js JT-Tools-Master/manifest.json
git commit -m "feat(forms): REST wrapper service for /admin/forms/* (PR #4 of 5)

Mirrors tweaks-api.js: thin postJson wrapper around
AccountService.authenticatedFetch, three methods covering the
consumer-side endpoints (templates list, instances list-by-job,
instance upsert)."
```

---

## Task 2: SPA URL detection — `forms-modules/job-detector.js`

**Files:**
- Create: `JT-Tools-Master/features/forms-modules/job-detector.js`

**Step 2.1:** Write the module. Key responsibility: parse `app.jobtread.com/orgs/{orgId}/jobs/{jobId}` (and any sub-path), expose `getCurrentJob()` returning `{ orgId, jobId } | null`, and run a callback when the route changes.

```js
const FormsJobDetector = (() => {
  const URL_RE = /^https:\/\/app\.jobtread\.com\/orgs\/([^/]+)\/jobs\/([^/?#]+)/i;
  let observer = null;
  let lastJobKey = null;
  let listener = null;

  function parse(href) {
    const m = (href || location.href).match(URL_RE);
    return m ? { orgId: m[1], jobId: m[2] } : null;
  }

  function getCurrentJob() {
    return parse(location.href);
  }

  function notifyIfChanged() {
    const current = parse(location.href);
    const key = current ? `${current.orgId}/${current.jobId}` : '__none__';
    if (key !== lastJobKey) {
      lastJobKey = key;
      if (listener) listener(current);
    }
  }

  function start(onChange) {
    listener = onChange;
    notifyIfChanged();  // emit initial state
    observer = new MutationObserver(notifyIfChanged);
    observer.observe(document.body, { childList: true, subtree: true });
    window.addEventListener('popstate', notifyIfChanged);
  }

  function stop() {
    if (observer) { observer.disconnect(); observer = null; }
    window.removeEventListener('popstate', notifyIfChanged);
    listener = null;
    lastJobKey = null;
  }

  return { parse, getCurrentJob, start, stop };
})();
window.FormsJobDetector = FormsJobDetector;
```

**Step 2.2:** Verify it parses.

Run: `node --check JT-Tools-Master/features/forms-modules/job-detector.js`
Expected: no output.

**Step 2.3:** Smoke test in the JT app.

1. Reload the extension in `chrome://extensions`.
2. Navigate to `app.jobtread.com/orgs/{any}/jobs/{any}`.
3. Open DevTools console, run: `FormsJobDetector.getCurrentJob()`.
4. Expected: `{ orgId: '...', jobId: '...' }` matching the URL.
5. Navigate to `app.jobtread.com/orgs/{any}/dashboard` (no job).
6. Run: `FormsJobDetector.getCurrentJob()`.
7. Expected: `null`.

**Step 2.4:** Commit.

```bash
git add JT-Tools-Master/features/forms-modules/job-detector.js
git commit -m "feat(forms): SPA URL detector for /jobs/{id} routes (PR #4 of 5)

MutationObserver-based detection — JT is a React SPA so URL gate
can't run once at content-script load. Emits {orgId, jobId} or
null on every route change."
```

---

## Task 3: Stylesheet — `styles/forms.css`

**Files:**
- Create: `JT-Tools-Master/styles/forms.css`

**Step 3.1:** Write the stylesheet. Cover: folder tab (fixed bottom-right), drawer (right-side fixed, full-height, 480px default, resizable, z-index 99998), header with status pill, list-view cards, field cards (5 types), toast notification, dark mode variants per `.claude/rules/code-style.md` palette (`#2c2c2c`, `#252525`, `#333333`, `#3a3a3a`, `#404040`, `#505050`, `#e0e0e0`, `#b0b0b0`).

Key class structure:
- `.jt-forms-tab` (folder tab trigger)
- `.jt-forms-drawer` (the panel; `.is-open` modifier)
- `.jt-forms-resize-handle` (left edge of drawer)
- `.jt-forms-header` + `.jt-forms-status-pill` (states: `is-saved`, `is-saving`, `is-unsaved`, `is-conflict`, `is-offline`)
- `.jt-forms-list` + `.jt-forms-list-card`
- `.jt-forms-field-card` (with `.jt-forms-field-section`, `.jt-forms-field-text-short`, `.jt-forms-field-text-long`, `.jt-forms-field-checkboxes`, `.jt-forms-field-radio`)
- `.jt-forms-fillin-input` (option fill-in)
- `.jt-forms-required-asterisk`
- `.jt-forms-toast`

Z-index policy: tab and drawer both use 99998. Toast uses 99999. JT modals are typically below 99000.

**Step 3.2:** Verify parses (CSS, no node check; visual check happens in Task 5).

**Step 3.3:** Add `styles/forms.css` to `manifest.json` `web_accessible_resources[0].resources`.

**Step 3.4:** Commit.

```bash
git add JT-Tools-Master/styles/forms.css JT-Tools-Master/manifest.json
git commit -m "feat(forms): stylesheet for folder tab + drawer + field cards (PR #4 of 5)"
```

---

## Task 4: Folder tab + drawer skeleton — `forms-modules/drawer.js`

**Files:**
- Create: `JT-Tools-Master/features/forms-modules/drawer.js`

**Step 4.1:** Write the drawer module. Public API: `mount(container)`, `unmount()`, `open(jobContext)`, `close()`, `isOpen()`, `setView(viewKey, payload)`, `getRoot()`. Internal: builds DOM (tab + drawer shell + header + content area + footer), wires resize handle (mousedown drag → store width to `chrome.storage.local['jtToolsFormsWidth']`), wires ESC + tab-click + ×-button close. Does NOT yet render forms — just the shell.

Drawer DOM structure:
```html
<div class="jt-forms-tab" role="button" aria-label="Open Forms">
  📋 <span>Forms</span>
</div>
<div class="jt-forms-drawer" role="dialog" aria-label="Job Forms">
  <div class="jt-forms-resize-handle"></div>
  <div class="jt-forms-header">
    <button class="jt-forms-back" hidden>← All forms</button>
    <h2 class="jt-forms-title">Forms</h2>
    <span class="jt-forms-status-pill"></span>
    <button class="jt-forms-close" aria-label="Close">×</button>
  </div>
  <div class="jt-forms-content" tabindex="0"></div>
  <div class="jt-forms-footer"></div>
</div>
```

Track all event listeners + observers in arrays for cleanup. Use `WeakMap` for any per-element data per `.claude/rules/security.md`.

**Step 4.2:** Verify parses.

Run: `node --check JT-Tools-Master/features/forms-modules/drawer.js`
Expected: no output.

**Step 4.3:** Smoke test (after Task 6 wires it up — defer to Task 6 final smoke).

**Step 4.4:** Commit.

```bash
git add JT-Tools-Master/features/forms-modules/drawer.js
git commit -m "feat(forms): folder tab + drawer DOM skeleton (PR #4 of 5)"
```

---

## Task 5: Field renderers — `forms-modules/field-renderers.js`

**Files:**
- Create: `JT-Tools-Master/features/forms-modules/field-renderers.js`

**Step 5.1:** Write the renderers. Public: `renderField(field, value, onChange)` returning a `<div class="jt-forms-field-card">` element wired to call `onChange(fieldId, newValue)` whenever the user interacts. One internal renderer per type:

- `section`: `<h3>` with optional `field.number` prefix. No value, no onChange.
- `text_short`: `<input type="text">`, maxLength 200, placeholder from `field.placeholder`.
- `text_long`: `<textarea>` with rows from `field.rows` (clamped 2–20, default 4).
- `checkboxes`: list of `<label><input type="checkbox">`. Value shape: array of strings (selected option values), with `{ value, fillIn }` objects for options that have a fillIn.
- `radio`: list of `<label><input type="radio">`. Value shape: string value OR `{ value, fillIn }` object.

Fill-in handling: when an option has `option.fillIn = { type: 'text_short' | 'number' }`, render an inline input next to the option label. Activate (focus + readable styling) only when the parent option is selected.

Required asterisk: render a `<span class="jt-forms-required-asterisk">*</span>` next to the label if `field.required === true` (skipped for sections).

Always sanitize labels and option text via a `Sanitizer.escapeHtml`-like helper — but since we use `textContent` exclusively (no innerHTML on user data), this is automatic. Use `Sanitizer.escapeHtml` from `utils/sanitizer.js` if any label is interpolated into innerHTML.

**Step 5.2:** Verify parses.

Run: `node --check JT-Tools-Master/features/forms-modules/field-renderers.js`
Expected: no output.

**Step 5.3:** Bench-test in console (after Task 6 wires it up).

**Step 5.4:** Commit.

```bash
git add JT-Tools-Master/features/forms-modules/field-renderers.js
git commit -m "feat(forms): 5-type field renderers with fill-in support (PR #4 of 5)"
```

---

## Task 6: Save engine + status pill — `forms-modules/save-engine.js`

**Files:**
- Create: `JT-Tools-Master/features/forms-modules/save-engine.js`

**Step 6.1:** Write the save engine. Public: `init({ instance, template, onStateChange, onMerge })`, `markDirty(fieldId, value)`, `forceSave()`, `dispose()`. State machine: `idle | dirty | saving | saved | conflict | offline`.

Behavior:
- Holds local `data`, `expectedVersion`, `dirtyFields: Set<string>`.
- `markDirty(fieldId, value)`: updates `data[fieldId]`, adds to `dirtyFields`, transitions to `dirty`, schedules a heartbeat-30s timer.
- `forceSave()`: if a save is in flight, queue (only the latest queued runs). Otherwise: transition `saving`, POST `upsertInstance`, on success → state `saved` with new `optimistic_version`, clear `dirtyFields`. On 409 → field-level merge (keep dirty fields, take server values for the rest), update version, retry once. On retry-409 → state `conflict`, surface to caller. On network error → state `offline`, retry on next dirty event.
- `onStateChange(state, meta)`: caller renders status pill from this.
- `onMerge(refreshedFieldIds, lastEditedBy, lastEditedAt)`: caller fires the toast.
- Calls field-level "blur fired" via a per-field handler the renderer wires up — engine doesn't observe DOM.

Coalescing: maintain a `nextSavePending: boolean` flag and an `inFlight: Promise | null`. New `forceSave` while `inFlight` sets `nextSavePending = true`; `inFlight.then()` re-fires `forceSave` if pending was set. Drop intermediate calls.

**Step 6.2:** Verify parses.

Run: `node --check JT-Tools-Master/features/forms-modules/save-engine.js`
Expected: no output.

**Step 6.3:** Commit.

```bash
git add JT-Tools-Master/features/forms-modules/save-engine.js
git commit -m "feat(forms): save engine with debounced upsert + 409 merge (PR #4 of 5)"
```

---

## Task 7: Main feature module — `features/forms.js`

**Files:**
- Create: `JT-Tools-Master/features/forms.js`

**Step 7.1:** Write the orchestrator IIFE. Public: `init()`, `cleanup()`, `isActive()`. Internal flow:

1. `init()`: check `AccountService.isLoggedIn()` + tier === `'power_user'`. If not, no-op (server enforces too, this is just UX). Inject stylesheet. Call `FormsJobDetector.start(onJobChanged)`. Mount drawer (hidden).
2. `onJobChanged(job)`:
   - If `job === null` → hide tab + drawer.
   - Else show tab; on tab click open drawer with `job` context.
3. `openForJob(job)`:
   - Render drawer in "loading" state.
   - In parallel: `FormsApi.listTemplates()` + `FormsApi.listInstancesByJob(job.orgId, job.jobId)`.
   - Compute displayable set (active templates ∪ instances).
   - Empty → render "no templates yet" + portal link.
   - 1 entry → call `openForm(formMeta)`.
   - 2+ entries → call `renderListView(entries)`.
4. `openForm(meta)`:
   - Resolve instance (existing or fresh blank from template schema).
   - Init `SaveEngine` with `{ instance, template, onStateChange, onMerge }`.
   - Wire `field-renderers` for each field, blur calls `engine.markDirty`.
   - Set drawer title, show "← All forms" if multi-form.
5. `cleanup()`:
   - `SaveEngine.dispose()`, `Drawer.unmount()`, `JobDetector.stop()`, remove stylesheet.

**Step 7.2:** Verify parses.

Run: `node --check JT-Tools-Master/features/forms.js`
Expected: no output.

**Step 7.3:** Register in `JT-Tools-Master/content.js` `featureModules` object next to other features. Pick a key like `forms`.

**Step 7.4:** Add `features/forms.js` and `features/forms-modules/*.js` to `manifest.json` `content_scripts[0].js`. Order matters: sub-modules before `forms.js`, and `forms.js` before `content.js` (content.js references `featureModules`).

**Step 7.5:** Add to `background/service-worker.js` `defaultSettings`:
```js
forms: true,
```

**Step 7.6:** Commit.

```bash
git add JT-Tools-Master/features/forms.js JT-Tools-Master/content.js JT-Tools-Master/manifest.json JT-Tools-Master/background/service-worker.js
git commit -m "feat(forms): main feature module + content.js registration (PR #4 of 5)"
```

---

## Task 8: Popup toggle — `popup/popup.html` + `popup.js`

**Files:**
- Modify: `JT-Tools-Master/popup/popup.html` (add toggle near other Power User features)
- Modify: `JT-Tools-Master/popup/popup.js` if any toggle-init wiring is needed (likely zero — toggles use `data-feature` and a generic handler)

**Step 8.1:** Add the toggle markup (place next to MCP / Tweaks toggles since same Power User tier):

```html
<div class="feature-item">
  <div class="feature-info">
    <div class="feature-icon">📋</div>
    <div class="feature-details">
      <h3>Forms <span class="premium-badge">Power User</span></h3>
      <p>Per-job intake forms. Folder tab on the bottom-right of any JT job page opens a fillable side drawer.</p>
    </div>
  </div>
  <label class="toggle">
    <input type="checkbox" id="forms" data-feature="forms">
    <span class="slider"></span>
  </label>
</div>
```

**Step 8.2:** Reload the extension in `chrome://extensions`. Open the popup. Verify the new toggle appears, defaults ON.

**Step 8.3:** Commit.

```bash
git add JT-Tools-Master/popup/popup.html
git commit -m "feat(forms): popup toggle for Forms feature (PR #4 of 5)"
```

---

## Task 9: End-to-end smoke test (manual)

**Files:** none (verification only)

**Step 9.1:** Reload extension at `chrome://extensions`.

**Step 9.2:** Navigate to `app.jobtread.com/orgs/{your-org}/jobs/{any-job}` while logged into JT Power Tools as a Power User on a license with at least one active form template (created via portal in previous testing).

**Step 9.3:** Verify the folder tab appears on the bottom-right.

**Step 9.4:** Click the tab → drawer slides in. Verify:
- If license has 1 active template → opens directly to the form.
- If license has 2+ → shows the list view, click one to open.
- The JT page behind the drawer is still scrollable + clickable.

**Step 9.5:** Fill one field of each type (section is non-interactive, skip it). Blur each:
- Status pill should go `Unsaved` → `Saving…` → `Saved 0s ago`.

**Step 9.6:** Open a second JT browser tab on the same job, fill a different field, save. Switch back to first tab, fill a field, save. Verify:
- First tab receives 409, auto-merges, shows toast: "Synced edits from {self} · 1 field refreshed: {field name}".
- Status pill returns to `Saved`.

**Step 9.7:** Navigate to a non-job route (e.g., `/orgs/{id}/dashboard`). Verify the folder tab disappears.

**Step 9.8:** Toggle Forms OFF in the popup. Reload the page. Verify the tab is gone, no console errors.

**Step 9.9:** Toggle back ON. Verify tab returns.

**Step 9.10:** Open DevTools Memory profiler. Toggle the feature OFF. Take a heap snapshot. Confirm no detached DOM nodes from `.jt-forms-*` classes (cleanup is complete).

**Step 9.11:** If any check fails, fix in place, re-run from Step 9.1.

---

## Task 10: CHANGELOG + final commit

**Files:**
- Modify: `CHANGELOG.md` under `## [Unreleased]` → `### Added`

**Step 10.1:** Append to the `### Added` section under `[Unreleased]` (group with the existing Per-Job Forms entries):

```markdown
#### Per-Job Forms — Extension consumer tab on JT job pages (Power User, PR #4 of 5)
- **Folder tab on `app.jobtread.com/orgs/{orgId}/jobs/{jobId}` pages** ([JT-Tools-Master/features/forms.js](JT-Tools-Master/features/forms.js), [JT-Tools-Master/styles/forms.css](JT-Tools-Master/styles/forms.css)). Bottom-right viewport-pinned trigger labeled `📋 Forms`. Visible only to Power User accounts on a license. SPA-safe via MutationObserver — survives JT route changes between jobs without a page reload. Defaults ON; togglable in the popup.
- **Non-blocking right-side drawer** that opens on tab click. 480px default width, full viewport height, resizable (persists per-license). The JT page stays fully scrollable and clickable behind the drawer — users can copy values out of JT directly into form fields. ESC, tab-click, or × closes.
- **Auto-open in single-form mode**, list view in multi-form mode. On open, the drawer fetches `/admin/forms/templates/list` + `/admin/forms/instances/list-by-job` in parallel; if exactly one form is available the drawer renders the form directly, otherwise it shows a card list with last-edited metadata (by + relative time) and Empty/In progress/Auto-attached pills. Empty state when the license has no templates yet links to the portal admin builder.
- **5 field types rendered** ([JT-Tools-Master/features/forms-modules/field-renderers.js](JT-Tools-Master/features/forms-modules/field-renderers.js)): `section` (h3 with optional number prefix), `text_short` (input maxLength 200), `text_long` (textarea rows 2-20), `checkboxes` (multi-select), `radio` (single-select). All inputs support the schema's `fillIn` per-option pattern: when an option has `fillIn: { type: 'text_short' | 'number' }`, an inline input activates next to the option when selected (the "Other ___" / "Yes — how many ___" pattern from the brainstorm).
- **Auto-save engine** ([JT-Tools-Master/features/forms-modules/save-engine.js](JT-Tools-Master/features/forms-modules/save-engine.js)) — saves on every field blur AND on a 30-second heartbeat when dirty. Status pill in the drawer header surfaces every state: `Saved 3s ago` (relative time), `Saving…`, `Unsaved`, `Conflict — click to merge` (amber, clickable), `Offline — will retry` (red). Coalesced — if a save is in flight when a new save fires, the new one queues and only the latest queued save runs.
- **Field-level merge on optimistic-concurrency 409** — when the server returns a stale-version conflict with `currentData`, the client keeps fields the local user has touched since the last successful save (`dirtyFields` Set) and pulls remote values for everything else, then retries with the new `optimistic_version`. A non-blocking toast announces "Synced edits from {name} · {n} fields refreshed: {names}". Edge case (retry-409 from a third writer) pins the pill to Conflict and opens a click-to-expand merge modal.
- **REST wrapper** ([JT-Tools-Master/services/forms-api.js](JT-Tools-Master/services/forms-api.js)) — three methods (`listTemplates`, `listInstancesByJob`, `upsertInstance`) over `AccountService.authenticatedFetch`, mirroring `services/tweaks-api.js` exactly. Same JWT, same auto-refresh-on-401, same `mcp.jtpowertools.com` Worker.
```

**Step 10.2:** Verify the CHANGELOG renders cleanly (no broken markdown, links resolve).

**Step 10.3:** Commit.

```bash
git add CHANGELOG.md
git commit -m "docs(forms): CHANGELOG entry for Forms extension tab (PR #4 of 5)"
```

---

## Handoff state at end of plan

After Task 10:
- 7 new files: `services/forms-api.js`, `features/forms.js`, `features/forms-modules/{drawer,job-detector,field-renderers,save-engine}.js`, `styles/forms.css`.
- 4 edited files: `manifest.json`, `content.js`, `background/service-worker.js`, `popup/popup.html`, `CHANGELOG.md`.
- 10 commits on `main` (or feature branch), each scoped to one task.
- No deploy step — extension changes ship via Chrome Web Store on the next release.
- Server side already deployed (PRs #1-3); no migration or worker redeploy needed.

PR #5 (final) is unscoped at this point — see design doc section "Out-of-band followups."
