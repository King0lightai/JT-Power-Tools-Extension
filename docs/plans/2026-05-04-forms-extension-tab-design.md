# Forms — extension consumer tab on JT job pages (PR #4 of 5)

**Date:** 2026-05-04
**Status:** Approved
**Owner:** zeepe
**Depends on:** PR #1 (D1 schema), PR #2 (REST + Power User gate), PR #3 (portal admin builder) — all merged + deployed.
**Followed by:** PR #5 (TBD — likely admin notification of in-progress instances + auto-attach reconciler).

---

## Problem

Per-job Forms templates exist on the server (PR #1) and admins can author them in the portal (PR #3). End users on a JT job page need a way to **find and fill** the forms attached to that job. Today, opening a form requires going to the portal — a 6-click context switch out of JT. Bad UX, kills adoption, defeats the "living document while the job moves" thesis from the original brainstorm.

## Goals

1. Open + edit a form for the current JT job in ≤ 1 click from the JT page.
2. Don't get in the way: zero JT-DOM mutation, page stays fully interactive while the form is open.
3. Multi-user safe: two members editing the same form on the same job don't blow each other's work away.
4. Survives JT SPA navigation between jobs without ghosting state across jobs.

## Non-goals (deferred to v2 / not this PR)

- Field-level audit trail (instance-level `last_edited_by` only).
- Per-instance revision history (template-version history exists; instance just has a single optimistic-version counter).
- Template authoring inside the extension (portal handles it — keeping admin/non-admin paths split).
- Conditional/dependent field visibility.
- Per-form access control (every license member can read+upsert every instance — gated only at the tier boundary).

---

## Surface area

### Trigger — folder tab

Pinned to the bottom-right edge of the viewport. 36px tall × ~150px wide. Orange JT-Power-Tools accent. Label: `📋 Forms`. Z-index above JT, below modals.

**Why this shape:** the user explicitly asked for "minimal folder tab style on bottom right of screen, non invasive." Matches the unobtrusive pattern of Quick Notes' floating button without occluding JT's chrome.

**Visibility rules** — tab renders only when ALL of:
- URL matches `app.jobtread.com/orgs/{orgId}/jobs/{jobId}` or any sub-path under it.
- User is logged in to JT Power Tools (`AccountService.isLoggedIn()`).
- User's tier is `power_user` (locally cached; server enforces too).
- Feature is enabled in the popup toggle (default: `true`).

**SPA-safe**: a `MutationObserver` on `body` re-evaluates the URL on every DOM tick (per the project memory's "SPA navigation pattern" lesson — content scripts don't re-run on JT navigation, so MutationObserver is the only reliable trigger).

### Drawer

- **Layout**: right-side drawer, 480px default width, full viewport height, slides in from the right.
- **No backdrop, no dim** — the JT page stays fully scrollable and clickable. Users explicitly need to copy values out of JT (job address, contact name, costs) into form fields without closing the panel.
- **Resizable**: same handle pattern as Quick Notes panel. Persisted to `chrome.storage.local['jtToolsFormsWidth']`.
- **Close**: ESC key, click the folder tab again, or click the `×` in the header.
- **Header**: form name + status pill + close button.
- **Footer**: `← All forms` link (visible only when multiple forms exist for the job).

### Initial view logic (when drawer opens)

1. Fetch `/admin/forms/instances/list-by-job` + `/admin/forms/templates/list` in parallel.
2. Compute the displayable set:
   - All non-archived templates owned by the license, plus
   - Any existing instances for this `(jt_org_id, jt_job_id)` even if their template was archived (so historical data stays readable).
3. **If the displayable set has exactly one form** → render the form directly. The instance auto-creates on first save via the `upsert` endpoint; no client-side "create instance" call needed.
4. **Else** → render the list view: one card per form. Card shows name, last-edited "by Sarah · 2h ago" or `Empty`/`Auto-attached` pill. Click a card to open the form. The "← All forms" link in the form footer routes back to the list.
5. **Empty state** (license has no templates yet) → message + link to portal admin builder (`https://app.jtpowertools.com/dashboard#forms`).

---

## Field rendering

Five field types from PR #1's schema (`forms-validator.js`):

| Type | Renders as | Notes |
|---|---|---|
| `section` | `<h3>` | Optional `number` prefix renders as `1.` |
| `text_short` | `<input type="text">` maxLength 200 | `placeholder` from schema |
| `text_long` | `<textarea>` rows 2–20 | `rows` from schema, default 4 |
| `checkboxes` | List of `<input type="checkbox">` | Multi-select |
| `radio` | List of `<input type="radio">` | Single-select |

**Fill-in options** (`option.fillIn = { type: 'text_short' \| 'number' }`): an inline input appears next to the option label, activates only when the parent option is selected. Saved as `data[fieldId] = { value: 'option_2', fillIn: '8 ft' }` for radio; for checkboxes the structure is `data[fieldId] = ['option_1', { value: 'option_3', fillIn: '8 ft' }]`.

**Required indicator**: red asterisk after the label. Empty required at save time produces a soft warning in the status pill but does NOT block save — the data layer doesn't enforce required at v1 (per PR #1 schema notes), so neither does the consumer.

---

## Save & conflict UX

### Save engine

- **Triggers**: field blur (per-field) AND a 30-second heartbeat when dirty.
- **Endpoint**: `POST /admin/forms/instances/upsert` with `{ templateId, jtJobId, jtOrgId, data, expectedVersion }`.
- **Coalescing**: if a save is in flight when a new save fires, the new one queues and only the latest queued save runs after the in-flight finishes (drop intermediates).

### Status pill (in drawer header)

| State | Text | Color |
|---|---|---|
| Resting (saved) | `Saved 3s ago` (relative) | grey |
| In flight | `Saving…` | grey |
| Dirty, no save attempted | `Unsaved` | grey |
| 409 (conflict) | `Conflict — click to merge` | amber, clickable |
| Network error | `Offline — will retry` | red |

### Optimistic-concurrency 409 handling

The data layer (PR #1 `upsertInstanceData`) returns `{ status: 409, currentData, currentVersion }` when `expectedVersion` is stale.

1. Client maintains a `dirtyFields: Set<fieldId>` — every field the local user touched since the last successful save.
2. On 409 receipt:
   - Build merged data: for each field in `data`:
     - If `dirtyFields.has(fieldId)` → keep local value (user just touched it).
     - Else → take `currentData[fieldId]` (remote is more recent).
3. Replace local state with merged data, update `expectedVersion = currentVersion`, re-render visible fields with the new values.
4. Retry the upsert with the merged data + new version. Should succeed (very low probability of two 409s in a row from different writers in the same ~ms).
5. **Toast** (non-blocking, top-right of drawer): `"Synced edits from Sarah · 2 fields refreshed: Site Conditions, Crew Notes"`. Auto-dismiss after 6s.
6. If the retry ALSO returns 409 (race against a third writer), pin status pill to `Conflict — click to merge` and surface a click-to-expand modal listing exact field-level diffs. Edge case — should be vanishingly rare.

---

## Authentication & API surface

Mirrors `services/tweaks-api.js` exactly:

```js
// JT-Tools-Master/services/forms-api.js
const FormsApi = (() => {
  async function listInstancesByJob(jtOrgId, jtJobId) {
    return postJson('/admin/forms/instances/list-by-job', { jtOrgId, jtJobId });
  }
  async function listTemplates() {
    return postJson('/admin/forms/templates/list');
  }
  async function upsertInstance(payload) {
    return postJson('/admin/forms/instances/upsert', payload);
  }
  // postJson wraps AccountService.authenticatedFetch with the same
  // 401-refresh + JSON-error-normalization pattern as tweaks-api.js
  return { listInstancesByJob, listTemplates, upsertInstance };
})();
```

- Auth: piggy-backs on `AccountService.authenticatedFetch` — same JWT, same auto-refresh-on-401, same `mcp.jtpowertools.com` Worker.
- Cache: no offline cache. Forms are collaborative; stale data hurts more than network calls. (Different from tweaks, which is read-mostly.)

---

## Code layout

```
JT-Tools-Master/
├── services/
│   └── forms-api.js                # 3-method REST wrapper (~80 lines)
├── features/
│   ├── forms.js                    # main IIFE module (~250 lines)
│   └── forms-modules/
│       ├── drawer.js               # drawer DOM + open/close/resize (~200 lines)
│       ├── job-detector.js         # SPA URL observer + orgId/jobId parser (~80 lines)
│       ├── field-renderers.js      # 5 field types + fillIn handling (~250 lines)
│       └── save-engine.js          # debounced save + heartbeat + 409 merge (~180 lines)
├── styles/
│   └── forms.css                   # drawer + folder tab + field cards (~250 lines)
├── popup/
│   └── popup.html                  # add Forms toggle (Power User badge)
├── manifest.json                   # add new files to web_accessible_resources + content_scripts
└── content.js                      # register Forms feature in featureModules
```

Total estimated: **~1,290 lines** across 8 new files + 4 edits to existing files.

---

## Test plan

### Manual smoke tests (per the testing-debug.md project rules)

1. **Visibility gates**
   - Power User + admin: tab visible on `/jobs/{id}` and sub-routes.
   - Power User + member: tab visible (members can fill, just not author).
   - Pro tier: tab not visible.
   - Free tier: tab not visible.
   - Logged out: tab not visible.
   - Off `/jobs/...` URL (orgs root, dashboard, etc.): tab not visible.

2. **SPA navigation**
   - Click between two different jobs without page reload → tab stays visible, drawer state resets cleanly to the new job's instance.
   - Navigate from job → schedule → back to job → tab still visible.

3. **Single-form auto-open**
   - License with 1 active template → drawer opens directly to the form, no list view.
   - License with 2 active templates → drawer opens to list view.

4. **Save flow**
   - Fill a field, blur → status pill goes `Unsaved` → `Saving…` → `Saved 0s ago`.
   - Type in a field, wait 30s without blurring → heartbeat fires, save runs.
   - Disable network → save fails → status pill `Offline — will retry`. Re-enable → next save attempt succeeds.

5. **Conflict resolution**
   - Open the same form on the same job in two browser windows.
   - Edit field A in window 1, save.
   - Edit field B in window 2, save → window 2 receives 409, auto-merges, retries, succeeds, toast appears: "Synced edits from {self} · 1 field refreshed: A".
   - Window 1 sees field B update on next refresh.

6. **Cleanup**
   - Toggle off in popup → tab disappears, drawer closes, no console errors, no orphaned event listeners or observers (project memory's MutationObserver hygiene rule).

### Automated checks

- `node --check` on each new JS file (consistent with PR #3 verification pattern).
- Manifest JSON validates.

---

## Risks & mitigations

| Risk | Mitigation |
|---|---|
| JT changes its URL structure for jobs | URL parser is regex-based on `/jobs/{id}` pattern, easy to update. SPA observer pattern from project memory means we don't depend on initial-load URL. |
| 409 retry storm if 3+ writers hit at once | Pin pill to `Conflict — click to merge`, modal forces user to consciously merge. Very rare in field-team usage. |
| Long forms (50+ fields) cause slow re-renders on conflict merge | Re-render only the dirty/changed fields, not the whole drawer. Field-level keyed renderer. |
| User toggles the feature off mid-edit | Save in-flight on cleanup; abort observer; remove drawer from DOM. Use `AbortController` per project security rules. |
| Drawer width steals too much from JT's job dashboard | User-resizable, persists per-license. Defaults to 480px (smaller than Quick Notes' 600px). |

---

## Out-of-band followups (post-PR #4)

- **PR #5** (final of 5): TBD. Likely admin-side instance dashboard + auto-attach reconciler (the `auto_attach_to_new_jobs` flag on templates needs a worker that creates blank instances when new JT jobs land).
- **v2** features per PR #1 schema notes: per-instance revision history, field-level audit, per-form access control, conditional visibility.

---

## Approval

Approved by user on 2026-05-04 after a 5-question brainstorming pass:
1. Trigger: minimal folder tab, bottom-right.
2. Layout: non-blocking right-side drawer.
3. Initial view: auto-open single form, list view if multiple.
4. Save: hybrid auto-save (blur + 30s heartbeat) + status pill.
5. Conflict: field-level auto-merge + non-blocking toast.
