# Wave 2 Write Consolidation — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Build 11 op-dispatch write tools (82 ops total) that replace the existing 25+ create/update tools, add delete support, and close the document/payment/selection/catalog gaps.

**Architecture:** Each write tool is a single handler file in `server/mcp-server/src/writes/` with an `op` parameter that dispatches to per-op functions. Shared helpers (`_shared.js`) provide the response envelope, Pave mutation builder, and op validation. Tools register in `TOOL_DEFINITIONS` alongside existing tools during the deprecation period.

**Tech Stack:** Plain JS (ESM), Zod schemas, Pave JSON-graph API, Cloudflare Workers, D1 for bills. Tests via `node --test` + `node:assert`.

**Design doc:** `docs/plans/2026-04-15-mcp-wave2-writes-design.md`
**Schema reference:** `docs/plans/2026-04-15-mcp-redesign-schema-probes.md`
**Existing handlers:** `server/mcp-server/src/tools.js` (lines 2832-5800 cover current write handlers)

---

## Task 1: Shared Write Helpers

**Files:**
- Create: `server/mcp-server/src/writes/_shared.js`
- Create: `server/mcp-server/src/writes/_shared.test.js`

**Step 1: Write failing tests for the write helpers**

```javascript
// _shared.test.js
import test from 'node:test';
import assert from 'node:assert/strict';
import { createOpDispatcher, successResponse, errorResponse, requireFields } from './_shared.js';

test('createOpDispatcher routes to correct op handler', async () => {
  const handler = createOpDispatcher({
    create: async (params) => successResponse('create', 'job', 'J1', `Created job ${params.name}`),
    update: async (params) => successResponse('update', 'job', params.jobId, 'Updated'),
  });
  const res = await handler({ op: 'create', name: 'Kitchen' }, {});
  assert.equal(res.success, true);
  assert.equal(res.op, 'create');
});

test('createOpDispatcher returns error for unknown op', async () => {
  const handler = createOpDispatcher({ create: async () => ({}) });
  const res = await handler({ op: 'nope' }, {});
  assert.equal(res.success, false);
  assert.match(res.error, /Unknown op/);
});

test('createOpDispatcher returns error when op is missing', async () => {
  const handler = createOpDispatcher({ create: async () => ({}) });
  const res = await handler({}, {});
  assert.equal(res.success, false);
});

test('successResponse has correct shape', () => {
  const r = successResponse('create', 'document', 'D1', 'Created invoice');
  assert.deepEqual(r, { success: true, op: 'create', entity: 'document', id: 'D1', message: 'Created invoice' });
});

test('errorResponse has correct shape', () => {
  const r = errorResponse('create', 'Missing jobId');
  assert.deepEqual(r, { success: false, op: 'create', error: 'Missing jobId' });
});

test('requireFields returns error for missing required field', () => {
  const err = requireFields({ name: 'Test' }, ['name', 'jobId'], 'create');
  assert.match(err.error, /jobId/);
});

test('requireFields returns null when all fields present', () => {
  const err = requireFields({ name: 'Test', jobId: 'J1' }, ['name', 'jobId'], 'create');
  assert.equal(err, null);
});
```

**Step 2: Run tests to verify they fail**

Run: `node --test server/mcp-server/src/writes/_shared.test.js`
Expected: FAIL (module not found)

**Step 3: Implement _shared.js**

```javascript
// writes/_shared.js
import * as qb from '../query-builder.js';

export function createOpDispatcher(ops) {
  return async (args, ctx) => {
    const { op, ...params } = args || {};
    if (!op) return errorResponse(null, 'Missing required "op" parameter');
    const handler = ops[op];
    if (!handler) return errorResponse(op, `Unknown op "${op}". Valid: ${Object.keys(ops).join(', ')}`);
    try {
      return await handler(params, ctx);
    } catch (err) {
      return errorResponse(op, err.message);
    }
  };
}

export function successResponse(op, entity, id, message) {
  return { success: true, op, entity, id, message };
}

export function errorResponse(op, error) {
  return { success: false, op, error };
}

export function requireFields(params, fields, op) {
  for (const f of fields) {
    if (params[f] === undefined || params[f] === null) {
      return errorResponse(op, `Missing required field: ${f}`);
    }
  }
  return null;
}

export { qb };
```

**Step 4: Run tests to verify they pass**

Run: `node --test server/mcp-server/src/writes/_shared.test.js`
Expected: 7/7 PASS

**Step 5: Commit**

```
git add server/mcp-server/src/writes/
git commit -m "feat(writes): shared op-dispatch helpers for Wave 2 entity writes"
```

---

## Task 2: Probe Pave Schema Gaps for Wave 2

Before building writes, probe the mutations that weren't covered in Wave 1 probes.

**Step 1: Probe via Official JT MCP schema introspection**

Mutations to probe:
- `updateJobArea`, `deleteJobArea` input shape
- `createCostCode` / `updateCostCode` / `deleteCostCode`
- `createCostType` / `updateCostType` / `deleteCostType`
- `createUnit` / `updateUnit` / `deleteUnit`
- `deleteDocument`, `deletePayment`, `deleteDocumentPayment`
- `deleteTask`, `deleteCostItem`, `deleteCostGroup`
- `deleteComment`, `deleteDailyLog`, `deleteTimeEntry`
- `deleteAccount`, `deleteAce`
- `deleteWorkflow`
- Org-level area templates (check if Pave has `createJobArea` or similar)

**Step 2: Save findings**

Append to `docs/plans/2026-04-15-mcp-redesign-schema-probes.md` under a new §15 header.

**Step 3: Commit**

```
git commit -m "docs: Wave 2 Pave schema probes — delete mutations + catalog CRUD"
```

---

## Task 3: `jt_document_write` — Document CRUD + Payments + Recipients

The biggest tool. Build in sub-tasks.

**Files:**
- Create: `server/mcp-server/src/writes/document-write.js`
- Create: `server/mcp-server/src/writes/document-write.test.js`
- Modify: `server/mcp-server/src/tools.js` (import + TOOL_DEFINITIONS entry)

### Sub-task 3a: Document CRUD (3 ops)

**Step 1: Write failing tests for createDocument, updateDocument, deleteDocument**

Test op dispatch, required fields, Pave query shape for each. Mock `ctx.pave` to capture the mutation query and return `{ createdDocument: { id: 'D1' } }`.

**Step 2: Implement the 3 ops**

- `createDocument`: Build Pave `createDocument` mutation from params. Required: jobId, type, name, fromName, toName, taxRate. Pass through all optional fields from the design doc. Use `qb.create('document', input, { id: {}, type: {}, name: {} })`.
- `updateDocument`: `qb.update('document', documentId, input)`. Response field is `document` (not `updatedDocument`).
- `deleteDocument`: `qb.del('document', documentId)`.

**Step 3: Run tests, verify pass**

**Step 4: Commit**

```
git commit -m "feat(writes): jt_document_write — createDocument, updateDocument, deleteDocument"
```

### Sub-task 3b: Recipients + Sending (3 ops)

**Step 1: Tests for addRecipient, removeRecipient, send**

**Step 2: Implement**

- `addRecipient`: `qb.create('documentRecipient', { documentId, assignee, requireSignature })`.
- `removeRecipient`: `qb.del('documentRecipient', documentRecipientId)`.
- `send`: Pave mutation `sendDocument({ documentRecipientId, emailMessage })`.

**Step 3: Run tests, commit**

```
git commit -m "feat(writes): jt_document_write — addRecipient, removeRecipient, send"
```

### Sub-task 3c: Payment lifecycle (5 ops)

**Step 1: Tests for createPayment, updatePayment, deletePayment, linkPayment, unlinkPayment**

**Step 2: Implement**

- `createPayment`: Pave `createPayment` with organizationId (use `ctx.orgId` if not provided), amount (2dp), paidAt, type (credit|debit).
- `updatePayment` / `deletePayment`: Standard pattern.
- `linkPayment`: Pave `createDocumentPayment({ documentId, paymentId, amount })`.
- `unlinkPayment`: Pave `deleteDocumentPayment({ id })`.

**Step 3: Run tests, commit**

```
git commit -m "feat(writes): jt_document_write — payment CRUD + link/unlink"
```

### Sub-task 3d: Templates + References (4 ops)

**Step 1: Tests**

**Step 2: Implement createTemplate, updateTemplate, deleteTemplate, addReference**

**Step 3: Commit**

```
git commit -m "feat(writes): jt_document_write — templates + references"
```

### Sub-task 3e: Register + deploy + live test

**Step 1: Add import + TOOL_DEFINITIONS entry to tools.js**

Zod schema: `op` as enum of all 15 ops, then per-op fields as optional (Pave validates required fields per op).

**Step 2: Deploy via wrangler**

**Step 3: Live test the AR workflow**

Via ctx_batch or fresh MCP session:
1. `jt_document_write({ op: "createDocument", type: "customerInvoice", ... })`
2. `jt_document_write({ op: "addRecipient", ... })`
3. `jt_document_write({ op: "send", ... })`
4. `jt_document_write({ op: "createPayment", ... })`
5. `jt_document_write({ op: "linkPayment", ... })`

Verify each returns `{ success: true }` and data appears in JT.

**Step 4: Commit**

```
git commit -m "feat(writes): register jt_document_write — 15 ops, live on Worker"
```

---

## Task 4: `jt_job_write` (5 ops)

**Files:**
- Create: `server/mcp-server/src/writes/job-write.js`
- Modify: `server/mcp-server/src/tools.js`

**Step 1: Tests** — op dispatch, create (locationId+name required, name max 30), update (closedOn for close/reopen), delete, updateArea, deleteArea.

**Step 2: Implement** — Mirror existing `handleCreateJob` / `handleUpdateJob` logic from tools.js. Add area ops by probing `updateJobArea` / `deleteJobArea` in Task 2.

**Step 3: Register + deploy + live test** — Create a test job, update it, close it, reopen it.

**Step 4: Commit**

```
git commit -m "feat(writes): jt_job_write — create, update, delete, area management"
```

---

## Task 5: `jt_task_write` (6 ops)

**Files:**
- Create: `server/mcp-server/src/writes/task-write.js`
- Modify: `server/mcp-server/src/tools.js`

**Step 1: Tests** — create (jobId+name required, progress 0-100 → 0-1 conversion), update, delete, importTemplate (startDate required for scheduled), notify (takes jobId NOT taskId), createFromBudget.

**Step 2: Implement** — Port existing `handleCreateTask` / `handleUpdateTask` + add delete/importTemplate/notify/createFromBudget. Handle the progress conversion (0-100 → 0-1) in the handler, not the caller.

**Step 3: Register + deploy + live test**

**Step 4: Commit**

```
git commit -m "feat(writes): jt_task_write — 6 ops including importTemplate + notify"
```

---

## Task 6: `jt_budget_write` (11 ops)

**Files:**
- Create: `server/mcp-server/src/writes/budget-write.js`
- Modify: `server/mcp-server/src/tools.js`

**Step 1: Tests** — createItem (with files[] and jobArea), createGroup (with selection params), assignSelection (jobId not costItemId), importCatalogGroup.

**Step 2: Implement**

- Cost item CRUD: port from existing handlers. Add `files[]` passthrough and `jobArea` field.
- Cost group CRUD: port + add selection presentation params (maxSelectionsAllowed, etc.).
- Selection ops: `createSelectionAssignment`, `updateSelectionAssignment`, `deleteSelectionAssignment`.
- `importCatalogGroup`: Query org-level costGroup template, recreate group+items on job (no Pave copy mutation exists).

**Step 3: Register + deploy + live test** — Create a selection group, add items, assign to customer.

**Step 4: Commit**

```
git commit -m "feat(writes): jt_budget_write — 11 ops, selections + inline files + catalog import"
```

---

## Task 7: `jt_contact_write` (9 ops)

**Files:**
- Create: `server/mcp-server/src/writes/contact-write.js`
- Modify: `server/mcp-server/src/tools.js`

**Step 1: Tests** — createAccount (name+type required), grantAccess (targetType 8-value enum, assignee 3-variant union), revokeAccess.

**Step 2: Implement** — Port existing handlers + add delete ops + ACE management.

**Step 3: Register + deploy + live test**

**Step 4: Commit**

```
git commit -m "feat(writes): jt_contact_write — accounts, contacts, locations, access control"
```

---

## Task 8: `jt_comment_write` (3 ops)

**Files:**
- Create: `server/mcp-server/src/writes/comment-write.js`
- Modify: `server/mcp-server/src/tools.js`

**Step 1: Tests** — create (targetType + targetId + message required), threading (parentCommentId), visibility flags.

**Step 2: Implement** — Port from existing `handleCreateComment` / `handleUpdateComment`. Add delete.

**Step 3: Register + deploy + live test**

**Step 4: Commit**

```
git commit -m "feat(writes): jt_comment_write — cross-entity comments with threading"
```

---

## Task 9: `jt_daily_log_write` + `jt_time_entry_write` (6 ops total)

**Files:**
- Create: `server/mcp-server/src/writes/daily-log-write.js`
- Create: `server/mcp-server/src/writes/time-entry-write.js`
- Modify: `server/mcp-server/src/tools.js`

**Step 1: Tests** — daily log create (files need id+name), time entry create (type per-membership, costItemId must be time-trackable).

**Step 2: Implement** — Port from existing handlers. Add delete ops. Time entry update supports `endNow: true`.

**Step 3: Register + deploy + live test**

**Step 4: Commit**

```
git commit -m "feat(writes): jt_daily_log_write + jt_time_entry_write"
```

---

## Task 10: `jt_dashboard_write` (6 ops)

**Files:**
- Create: `server/mcp-server/src/writes/dashboard-write.js`
- Modify: `server/mcp-server/src/tools.js`

**Step 1: Tests** — dashboard create (visibleToRoleIds required), update tiles REPLACES (fetch-merge-write), dataView create (type+name+fields required).

**Step 2: Implement** — Port from existing handlers. Add delete ops. Dashboard update handler fetches existing tiles, merges addTiles/removeTileIds, sends full array.

**Step 3: Register + deploy + live test**

**Step 4: Commit**

```
git commit -m "feat(writes): jt_dashboard_write — dashboards + data views"
```

---

## Task 11: `jt_workflow_write` (3 ops)

**Files:**
- Create: `server/mcp-server/src/writes/workflow-write.js`
- Modify: `server/mcp-server/src/tools.js`

**Step 1: Tests** — create (name+triggerTypeId+actions required), auto-assign action IDs, update replaces entire action tree.

**Step 2: Implement** — Port from existing `handleCreateWorkflow` / `handleUpdateWorkflow`. Reuse `assignActionIds()` + `countActions()`. Add delete.

**Step 3: Register + deploy + live test**

**Step 4: Commit**

```
git commit -m "feat(writes): jt_workflow_write — automation CRUD"
```

---

## Task 12: `jt_catalog_write` (12 ops)

**Files:**
- Create: `server/mcp-server/src/writes/catalog-write.js`
- Modify: `server/mcp-server/src/tools.js`

**Step 1: Probe Pave** — Verify `createCostCode`, `createCostType`, `createUnit`, org-level `costGroups` (templates) mutation shapes via schema introspection.

**Step 2: Tests + implement** — Cost code CRUD, cost type CRUD, unit CRUD, cost group template CRUD with selection params.

**Step 3: Register + deploy + live test**

**Step 4: Commit**

```
git commit -m "feat(writes): jt_catalog_write — cost codes, types, units, templates"
```

---

## Task 13: Deprecation Wiring

**Files:**
- Modify: `server/mcp-server/src/tools.js`

**Step 1: Add deprecation warnings to old tools**

For every old tool that's been replaced by an avenue or write, inject a warning into the response:

```javascript
// In registerAllTools, before dispatching to old handler:
if (DEPRECATED_TOOLS[tool.name]) {
  const { replacement, op } = DEPRECATED_TOOLS[tool.name];
  console.warn(`DEPRECATED: ${tool.name} → use ${replacement}${op ? `(op: ${op})` : ''}`);
  // Prepend warning to response text
}
```

Build `DEPRECATED_TOOLS` map from the migration table in mcp-redesign.md §5.1 + §5.2.

**Step 2: Verify old tools still work** — Call a deprecated tool, confirm it returns data WITH the warning prepended.

**Step 3: Commit**

```
git commit -m "chore(writes): add deprecation warnings to 51 old tools — 30-day removal window"
```

---

## Task 14: Final Verification + Deploy

**Step 1: Run full test suite**

```
node --test server/mcp-server/src/writes/_shared.test.js \
             server/mcp-server/src/writes/document-write.test.js \
             server/mcp-server/src/query-builder.test.js \
             server/mcp-server/src/avenues/job-context.test.js
```

Expected: all pass.

**Step 2: Verify OpenAPI spec includes all 11 new write tools**

```
curl -s https://jobtread-mcp-server.king0light-ai.workers.dev/openapi.json | jq '.paths | keys | length'
```

Expected: ~97 paths (86 current + 11 new writes).

**Step 3: End-to-end AR workflow test on Titus org**

1. Create a test job
2. Add budget items (createItem with files)
3. Create a customer invoice from the budget
4. Add recipient
5. Record payment
6. Link payment to invoice
7. Verify everything shows in `jt_job_context` and `jt_financial_context`

**Step 4: Commit + tag**

```
git commit -m "feat(mcp-server): Wave 2 complete — 11 write tools, 82 ops, deprecation wired"
git tag wave2-complete
```
