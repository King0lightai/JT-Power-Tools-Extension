# MCP Redesign Wave 2 — Write Consolidation Design

> **Status:** Approved
> **Author:** Zee Pepmiller + Claude
> **Date:** 2026-04-15
> **Parent:** [mcp-redesign.md](./mcp-redesign.md) §4.2, §11 Wave 2
> **Schema reference:** [schema probe findings](./2026-04-15-mcp-redesign-schema-probes.md)

---

## 1. Goal

Collapse 25+ create/update tools into 11 per-entity writes with op-dispatch. Add delete support. Close the document/payment/selection/catalog gaps. Deprecate old tools after verification.

---

## 2. Resolved Open Questions

| §14 Q# | Decision | Rationale |
|---|---|---|
| Q2 Delete confirmation | AI-side only — no server `confirm` flag | Simpler API. AI clients already ask "are you sure?" before destructive calls. |
| Q3 Comment tool | Standalone `jt_comment_write` (Option A) | Avoids duplicating comment params in every entity write. Cross-entity by design. |
| Q4 Bill pipeline | Keep `approve_bill` + `reject_bill` as standalone | Controlled workflow, not a general write. Stays always-enabled per §10.5. |

---

## 3. Architecture — Op-Dispatch Pattern

Each write tool is one handler with an `op` parameter:

```javascript
export async function handleDocumentWrite(args, ctx) {
  const { op, ...params } = args;
  const handler = OPS[op];
  if (!handler) return { error: `Unknown op "${op}"` };
  return handler(params, ctx);
}
```

**Schema:** Top-level `op` enum. Per-op params validated inside handler (Pave is authoritative). Zod validates `op` + required fields only.

**Response envelope:**
```json
{
  "success": true,
  "op": "createDocument",
  "id": "22PVcv35ukDF",
  "entity": "document",
  "message": "Created customerInvoice 'Invoice #88'"
}
```

**Permission tiers (§10):** Stubbed in Wave 2. `checkPermission(tier, toolName, op)` middleware slots at dispatch top. D1 `org_settings` table + portal admin UX deferred to a follow-up PR; tier defaults to `read_write` (deletes blocked) until wired.

---

## 4. Tool Inventory — 11 Write Tools

### 4.1 `jt_document_write` — 15 ops

The largest tool. Covers the full document lifecycle for all 5 types.

**Document CRUD:**

| Op | Required | Key notes |
|---|---|---|
| `createDocument` | jobId, type, name, fromName, toName, taxRate | type: bidRequest/customerInvoice/customerOrder/vendorBill/vendorOrder. taxRate 0-1. lineItems: 4-variant union (existingCostGroup/existingCostItem/newCostGroup/newCostItem), pass through to Pave, max 1500. All amounts in DOLLARS. files[] for inline attachment. |
| `updateDocument` | documentId | All fields optional. Adds status (draft/pending/approved/denied), signaturePath, notify (default true). lineItems REPLACES (not appends). |
| `deleteDocument` | documentId | Pave hard-delete. AI-side confirmation only. |

**Recipients + Sending:**

| Op | Required | Notes |
|---|---|---|
| `addRecipient` | documentId, assignee | assignee: 3-variant union — `{_type:"membership", membershipId}`, `{_type:"role", roleId}`, `{_type:"user", name, emailAddress, ...}`. User variant inline-creates contact. |
| `removeRecipient` | documentRecipientId | |
| `send` | documentRecipientId | Optional emailMessage (max 10000). Triggers delivery. |

**Payments:**

| Op | Required | Notes |
|---|---|---|
| `createPayment` | organizationId, amount, paidAt, type | type: "credit"\|"debit". amount in dollars (2dp). Optional: accountId, description, source, attemptAutoMatch, externalId. |
| `updatePayment` | paymentId | |
| `deletePayment` | paymentId | |
| `linkPayment` | documentId, paymentId, amount | Links payment to doc. Optional isLinkedToQbo. |
| `unlinkPayment` | documentPaymentId | |

**Templates:**

| Op | Required | Notes |
|---|---|---|
| `createTemplate` | organizationId, type, templateName, name, dueDays, requireSignature, showProfit | Org-level. No lineItems. |
| `updateTemplate` | documentTemplateId | |
| `deleteTemplate` | documentTemplateId | |

**References:**

| Op | Required | Notes |
|---|---|---|
| `addReference` | documentId, reference | reference: `{_type: "document"\|"timeEntry", id}` |

### 4.2 `jt_job_write` — 5 ops

| Op | Required | Notes |
|---|---|---|
| `create` | locationId, name | name max 30 chars. Optional: number, description, priceType, customFieldValues, copyCostsFromJobId, copyTasksFromJobId, lineItems, parameters, folders, areas. |
| `update` | jobId | closedOn = YYYY-MM-DD to close, null to reopen. All optional. |
| `delete` | jobId | |
| `updateArea` | jobId, area | Rename/reorder an area on a job. |
| `deleteArea` | jobId, area | Remove an area definition. |

### 4.3 `jt_task_write` — 6 ops

| Op | Required | Notes |
|---|---|---|
| `create` | jobId, name | Dates YYYY-MM-DD, times HH:MM. assignees: [{membershipId}]. Parent must be isGroup:true. |
| `update` | taskId | progress 0-100 (handler converts to Pave's 0-1). |
| `delete` | taskId | |
| `importTemplate` | jobId, taskTemplateId | startDate required for scheduled tasks. |
| `notify` | jobId, membershipIds[] | NOT taskId — Pave quirk (verified in schema probes). |
| `createFromBudget` | jobId | Pave auto-generates tasks from budget line items. |

### 4.4 `jt_budget_write` — 11 ops

| Op | Required | Notes |
|---|---|---|
| `createItem` | jobId, name | costCodeId + costTypeId recommended. Amounts in dollars. Optional files[] for inline photo attachment. jobArea for area scoping. |
| `updateItem` | costItemId | |
| `deleteItem` | costItemId | |
| `createGroup` | jobId, name | Selection params: maxSelectionsAllowed, minSelectionsRequired, showChildCosts, showChildDeltas, showChildren, showDescription. Optional files[] + lineItems[] for inline creation. jobArea for area scoping. |
| `updateGroup` | costGroupId | Same selection/presentation params available. |
| `deleteGroup` | costGroupId | |
| `assignSelection` | jobId, assignee, isDocumentRecipient, requireSignature | Assign a customer to job selections. assignee is the 3-variant union. |
| `updateSelection` | selectionAssignmentId | isDocumentRecipient, requireSignature optional. |
| `deleteSelection` | selectionAssignmentId | |
| `importCatalogGroup` | jobId, costGroupTemplateId | Applies org-level cost group template to a job. Recreates group + items (no Pave copyCostGroupToJob mutation — must create individually). |
| (inline files) | — | createItem and createGroup accept optional files[] matching Pave's file input shape. |

### 4.5 `jt_contact_write` — 9 ops

| Op | Required | Notes |
|---|---|---|
| `createAccount` | name, type (customer\|vendor) | Optional: isTaxable, customFieldValues, suffixIfNecessary. |
| `updateAccount` | accountId | Optional: name, isTaxable, primaryContactId, primaryLocationId, customFieldValues. |
| `deleteAccount` | accountId | |
| `createContact` | accountId, name | Optional: title, customFieldValues. |
| `updateContact` | contactId | |
| `createLocation` | accountId, name | Optional: address, contactId, customFieldValues, parseAddress. |
| `updateLocation` | locationId | |
| `grantAccess` | targetType, targetId, assignee | targetType: strict 8-value enum (comment/dailyLog/file/fileTag/document/job/location/account). assignee: 3-variant union. Optional notify. |
| `revokeAccess` | aceId | |

### 4.6 `jt_daily_log_write` — 3 ops

| Op | Required | Notes |
|---|---|---|
| `create` | jobId, date (YYYY-MM-DD) | Optional: notes, assignees, customFieldValues, files (both id AND name required per Pave gotcha), notify. |
| `update` | dailyLogId | date, notes, customFieldValues optional. |
| `delete` | dailyLogId | |

### 4.7 `jt_time_entry_write` — 3 ops

| Op | Required | Notes |
|---|---|---|
| `create` | jobId, startedAt (ISO 8601) | Omit endedAt for running timer. type required (per-membership, query membership.timeEntryTypes). costItemId must have time-trackable costType. |
| `update` | timeEntryId | endNow: true stops running timer. isApproved for approval. |
| `delete` | timeEntryId | |

### 4.8 `jt_dashboard_write` — 6 ops

| Op | Required | Notes |
|---|---|---|
| `createDashboard` | name | Optional: template (7 presets), tiles[], visibleTo. visibleToRoleIds required (query org roles). |
| `updateDashboard` | dashboardId | tiles[] REPLACES all — handler must fetch-merge-write. addTiles/removeTileIds for incremental. |
| `deleteDashboard` | dashboardId | |
| `createDataView` | type, name, fields[] | type: costItem/job/task/document/etc. Optional: where, sortBy, groupBy, view (list/kanban). |
| `updateDataView` | dataViewId | |
| `deleteDataView` | dataViewId | |

### 4.9 `jt_comment_write` — 3 ops (cross-entity utility)

| Op | Required | Notes |
|---|---|---|
| `create` | targetType, targetId, message | targetType: job/task/dailyLog/document/file/account/timeEntry. Optional: assignees [{membershipId}], isPinned, parentCommentId (threading), isVisibleToAll, isVisibleToCustomerRoles, isVisibleToInternalRoles, isVisibleToVendorRoles, isReply. |
| `update` | commentId | message, isPinned optional. |
| `delete` | commentId | |

### 4.10 `jt_workflow_write` — 3 ops

| Op | Required | Notes |
|---|---|---|
| `create` | name, triggerTypeId, actions[] | actions: nested tree [{typeId, input, actions: [...]}]. Handler auto-assigns 12-char IDs. triggerInput optional. isActive default false. Orgs limited to 10 workflows. |
| `update` | workflowId | actions[] REPLACES entire tree — call get_workflow first, merge, send complete tree. |
| `delete` | workflowId | |

### 4.11 `jt_catalog_write` — 12 ops (NEW)

| Op | Required | Notes |
|---|---|---|
| `createCostCode` | name, number | Optional: description. |
| `updateCostCode` | costCodeId | |
| `deleteCostCode` | costCodeId | |
| `createCostType` | name | Optional: isTimeTrackable. |
| `updateCostType` | costTypeId | |
| `deleteCostType` | costTypeId | |
| `createUnit` | name | |
| `updateUnit` | unitId | |
| `deleteUnit` | unitId | |
| `createCostGroupTemplate` | name | Org-level cost group with selection config (maxSelectionsAllowed, etc.). Supports nested lineItems for inline cost items. |
| `updateCostGroupTemplate` | costGroupTemplateId | |
| `deleteCostGroupTemplate` | costGroupTemplateId | |

---

## 5. Tool Count Summary

| Category | Count |
|---|---|
| Read avenues (Wave 1) | 6 |
| Entity writes | 11 |
| Utility tools (search, raw_query, knowledge, files, webhook_write) | 5 |
| Bill pipeline (approve_bill, reject_bill, add_approved_sender) | 3 |
| Context mode (ctx_*) | 6 |
| Sandbox (reserved, Wave 3) | 5 |
| **Total** | **36** |
| **Headroom under 60** | **24** |

The 3 bill pipeline tools (approve_bill, reject_bill, add_approved_sender) stay as standalone per the §10.5 carve-out decision.

---

## 6. Deprecation Plan

After Wave 2 ships and parity is verified:

| Phase | Timeline | Action |
|---|---|---|
| Ship | Day 0 | New write tools live alongside old ones. |
| Deprecation warnings | Day 0 | Old tools log `⚠️ DEPRECATED: use jt_X_write(op: Y) instead` on every call. Warning text includes the new tool name + equivalent op. |
| Old reads deprecated | Day 0 | Wave 1 old reads (26 tools) also get warnings — they've been live since Wave 1. |
| Old reads removed | Day 30 | 26 old read tools removed. |
| Old writes removed | Day 60 | 25+ old write tools removed. |

**Post-removal tool count:** ~36 tools (current target) — down from 86 (current deployed count with old + new).

---

## 7. File Structure

```
server/mcp-server/src/
├── writes/                          # NEW — one file per entity write
│   ├── _shared.js                   # Shared write helpers (response envelope, op validation)
│   ├── document-write.js            # jt_document_write (15 ops)
│   ├── job-write.js                 # jt_job_write (5 ops)
│   ├── task-write.js                # jt_task_write (6 ops)
│   ├── budget-write.js              # jt_budget_write (11 ops)
│   ├── contact-write.js             # jt_contact_write (9 ops)
│   ├── daily-log-write.js           # jt_daily_log_write (3 ops)
│   ├── time-entry-write.js          # jt_time_entry_write (3 ops)
│   ├── dashboard-write.js           # jt_dashboard_write (6 ops)
│   ├── comment-write.js             # jt_comment_write (3 ops)
│   ├── workflow-write.js            # jt_workflow_write (3 ops)
│   └── catalog-write.js             # jt_catalog_write (12 ops)
├── avenues/                         # Wave 1 (done)
│   ├── _shared.js
│   ├── job-context.js
│   ├── schedule-context.js
│   ├── crm-context.js
│   ├── financial-context.js
│   ├── org-context.js
│   └── bills-context.js
├── query-builder.js                 # Shared query composition (Wave 1)
├── tools.js                         # TOOL_DEFINITIONS registry + old handlers
└── index.js                         # Worker entry point
```

---

## 8. Implementation Order

1. `writes/_shared.js` — response envelope, op dispatch helper, Pave mutation builder
2. `jt_document_write` — biggest gap, highest value (unlocks full AR/AP workflow)
3. `jt_job_write` + `jt_task_write` — most-used entity operations
4. `jt_budget_write` — includes selections + inline files + importCatalogGroup
5. `jt_contact_write` — accounts + contacts + locations + ACE
6. `jt_comment_write` — cross-entity utility
7. `jt_daily_log_write` + `jt_time_entry_write` — simple, fast to build
8. `jt_dashboard_write` — dashboards + data views
9. `jt_workflow_write` — automation
10. `jt_catalog_write` — catalog CRUD (NEW, needs Pave probes for some ops)
11. Deprecation wiring — add warnings to old tools, schedule removal

---

## 9. Testing Strategy

Per-entity verification pass:
1. **Create** → read back via avenue → confirm fields match
2. **Update** → read back → confirm changes applied
3. **Delete** → read back → confirm gone (or error on not-found)

For document write specifically:
- Create customerInvoice → addRecipient → send → createPayment → linkPayment
- Verify the full AR workflow end-to-end against the Titus org

Unit tests for:
- Op dispatch (unknown op → error)
- Required field validation per op
- Response envelope shape
- Pave mutation query shape (mock ctx.pave, verify query structure)

---

## 10. Pave Schema Gaps to Probe

Before implementing, need schema introspection for:
- `updateJobArea` / `deleteJobArea` input shape (not probed in Wave 1)
- `createCostCode` / `updateCostCode` / `deleteCostCode` full input
- `createCostType` / `updateCostType` / `deleteCostType` full input
- `createUnit` / `updateUnit` / `deleteUnit` full input
- Org-level area templates (may not exist — fallback to raw_query if absent)
- `copyCostGroupToTarget` or equivalent for importCatalogGroup (may not exist — recreate manually)
