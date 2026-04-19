# MCP Server Redesign — Design Document

> **Status:** Draft  
> **Author:** Zee Pepmiller  
> **Date:** 2026-04-15  
> **Branch:** `worktree-claude+mcp-redesign-wave1`
> **Companion:** [Schema Probe Findings](./2026-04-15-mcp-redesign-schema-probes.md) — verified Pave input shapes and enums for all redesigned tools (resolves §14 Q6, supersedes parts of §4.2 with corrections in §12 of the probe doc)

---

## 1. Motivation

| Constraint | Detail |
|---|---|
| ChatGPT tool ceiling | ~60 tools max |
| Current tool count | ~81 specialized tools in `server/mcp-server/src/tools.js` (7,126 lines) |
| Planned additions | Vendor bill expansion, sandbox/mini-apps, webhook subscriptions, PDF generation |
| Without redesign | Already over ceiling, zero headroom for new features |

JobTread has shipped an official MCP server (single `query` escape hatch against the Pave API). Our value proposition shifts from "API wrapper" to **AI workflow intelligence layer** — context bundles, multi-step orchestration, intent-based trimming, and auto-indexing via context mode.

---

## 2. Design Principles

1. **Avenues over atoms.** A single read tool returns a rich context bundle for an entire task domain, parameterized by `include[]` and `depth`. One tool call replaces 3–5 narrow reads.
2. **Per-entity writes.** One write tool per entity with an `op` parameter (`create` | `update` | `delete`). Clean schemas, moderate consolidation.
3. **Auto-index everything.** Every avenue response pipes through `ctx_index` automatically so `ctx_search` can retrieve sections later. Avenues want to be big; context mode makes big safe.
4. **Escape hatch preserved.** `jt_raw_query` stays for edge cases not covered by avenues or writes.
5. **Slot budget.** 31–32 tools total, leaving ~28 slots of headroom under the 60-tool ceiling.

---

## 3. Gap Analysis — Pave API vs. Current MCP

Probed via the Official JobTread MCP's schema introspection on 2026-04-15. The Pave API root exposes **~120 fields** (reads, mutations, utilities). Our current MCP covers ~50 of those through 81 specialized tools.

### 3.1 Real Gaps (no coverage)

| # | Gap | Pave Surface | Impact | Redesign Target |
|---|-----|-------------|--------|-----------------|
| 1 | **Payment CRUD** | `createPayment`, `updatePayment`, `deletePayment`, `payment` | Can't record or manage payments — AR/AP resolution blocked | `jt_document_write` (op: `createPayment`, `updatePayment`) |
| 2 | **Document Payment linking** | `createDocumentPayment`, `deleteDocumentPayment` | Can't apply payments to invoices/bills | `jt_document_write` (op: `linkPayment`) |
| 3 | **Full document mutations** | `createDocument` (all 5 types: `bidRequest`, `customerInvoice`, `customerOrder`, `vendorBill`, `vendorOrder`), `updateDocument`, `deleteDocument` | Current MCP only creates `vendorBill` via `approve_bill`. Can't create invoices, orders, change orders, or bid requests. Can't update status, line items, signatures, or any doc field. | `jt_document_write` |
| 4 | **Document recipients + sending** | `createDocumentRecipient`, `deleteDocumentRecipient`, `sendDocument` | Can't add recipients or trigger document delivery | `jt_document_write` (op: `addRecipient`, `send`) |
| 5 | **Document references** | `createDocumentReference`, `deleteDocumentReference` | Can't link documents (e.g., change order → original contract) | `jt_document_write` (op: `addReference`) |
| 6 | **Document templates** | `createDocumentTemplate`, `updateDocumentTemplate`, `deleteDocumentTemplate` | Can't manage org-level document templates | `jt_document_write` (op: `createTemplate`, `updateTemplate`) |
| 7 | **Webhook subscriptions** | `createWebhook`, `deleteWebhook` (38 event types) | Can't subscribe to JT events — blocks sandbox/mini-app automation | `jt_webhook_write` |
| 8 | **PDF generation** | `pdf` root (budget, dailyLogs, document, selections, specifications, tasks) | Can only *parse* PDFs, not *generate* them from JT data | `jt_files` (op: `generatePdf`) |
| 9 | **Signed queries** | `signQuery` | Can't create time-limited shareable links for deferred query execution | `jt_files` (op: `signQuery`) or standalone utility |
| 10 | **ACE management** | `createAce`, `deleteAce`, `sendAceNotification` | Can't manage job/account access control directly (only via workflow `assignAccess`) | `jt_contact_write` (op: `grantAccess`, `revokeAccess`) |
| 11 | **Selection assignments** | `createSelectionAssignment`, `updateSelectionAssignment`, `deleteSelectionAssignment` | Can't manage customer portal selections/specifications | `jt_budget_write` (op: `assignSelection`) |
| 12 | **File updates** | `updateFile` (name, folder, description, fileTagIds, annotations), `updateFileTag` | Can upload and tag but can't rename, move, re-describe, or re-tag files after creation | `jt_files` (op: `updateFile`, `updateFileTag`) |
| 13 | **Plans** | `createPlan`, `updatePlan`, `deletePlan` | Can't manage blueprint plan pages (file + page + scale) | `jt_files` (op: `createPlan`, `updatePlan`) |
| 14 | **Roles** | `createRole`, `updateRole`, `deleteRole` | Can't manage org roles | Out of scope (admin, use `jt_raw_query`) |
| 15 | **Membership mutations** | `createMembership`, `updateMembership` | Can't invite users, change roles, or update notification preferences | Out of scope (admin, use `jt_raw_query`) |
| 16 | **Catalog CRUD** | `createCostCode`, `updateCostCode`, `deleteCostCode` (+ types, units, mappings) | Can list but can't manage catalog items | Out of scope (admin, use `jt_raw_query`) |
| 17 | **Custom field management** | `createCustomField`, `updateCustomField`, `deleteCustomField` | Can read/use but can't manage field definitions | Out of scope (admin, use `jt_raw_query`) |
| 18 | **Web forms** | `createWebForm`, `updateWebForm`, `deleteWebForm`, `submitWebForm` | Entire web form system uncovered | Future (sandbox wave) |
| 19 | **Task assignee notifications** | `notifyTaskAssignees` | Can't trigger direct notifications to task assignees | `jt_task_write` (op: `notify`) |
| 20 | **Job area management** | `updateJobArea`, `deleteJobArea` | Can set areas on items but can't manage area definitions | Out of scope (admin, use `jt_raw_query`) |

### 3.2 Partial Gaps

| # | Gap | Detail | Fix |
|---|-----|--------|-----|
| 21 | Delete operations | `jt_raw_query` blocks DELETEs. Pave supports deletes on all entities. | Per-entity writes support `op: "delete"` with confirmation prompt |
| 22 | Cost group presentation params | Missing `maxSelectionsAllowed`, `minSelectionsRequired`, `showChildCosts`, `showChildDeltas`, `showChildren`, `showDescription` | Add to `jt_budget_write` schema |
| 23 | `createTasksFromBudget` | Auto-generate tasks from budget line items | Add to `jt_task_write` (op: `createFromBudget`) |
| 24 | Job `folders` param | `updateJob.folders` for managing folder structure | Add to `jt_job_write` schema |
| 25 | Comment file attachments | `commentFile`, `updateCommentFile` | Add file params to comment operations |

### 3.3 Document Type Coverage Matrix

| Document Type | Current MCP | Pave API | Redesign |
|---|---|---|---|
| `vendorBill` | Create only (via `approve_bill`) | Full CRUD | Full CRUD via `jt_document_write` |
| `customerInvoice` | Read only | Full CRUD | Full CRUD via `jt_document_write` |
| `customerOrder` | Read only | Full CRUD | Full CRUD via `jt_document_write` |
| `vendorOrder` | None | Full CRUD | Full CRUD via `jt_document_write` |
| `bidRequest` | Read only | Full CRUD | Full CRUD via `jt_document_write` |

### 3.4 Pave Event Types (for webhooks)

40 event types confirmed via schema introspection (2026-04-15 reprobed; original count of 38 was off-by-two):

```
accountCreated, accountDeleted, accountUpdated,
commentCreated, commentDeleted, commentUpdated,
contactCreated, contactDeleted, contactUpdated,
dailyLogCreated, dailyLogDeleted, dailyLogUpdated,
documentCreated, documentDeleted, documentPaymentCreated,
documentPaymentDeleted, documentPaymentUpdated,
documentRecipientCreated, documentRecipientDeleted, documentRecipientUpdated,
documentSent, documentUpdated,
fileCreated, fileUpdated, fileDeleted,
jobCreated, jobDeleted, jobUpdated,
locationCreated, locationDeleted, locationUpdated,
paymentCreated, paymentDeleted, paymentUpdated,
taskCreated, taskDeleted, taskUpdated,
timeEntryCreated, timeEntryDeleted, timeEntryUpdated
```

---

## 4. Final Tool Inventory — 31 Tools

### 4.1 Read Avenues (6 tools)

#### `jt_job_context`

Returns a rich context bundle for a single job.

```typescript
{
  jobId: string,              // required
  include?: string[],         // default: ["budget", "schedule", "documents", "activity"]
  depth?: "summary" | "detailed" | "full",  // default: "detailed"
  intent?: string             // optional — passed to ctx_index for semantic retrieval
}
```

**Default bundle (detailed):**

| Section | Fields | Notes |
|---------|--------|-------|
| `job` | id, name, number, status, closedOn, description, priceType, location, account, customFieldValues | Always included |
| `budget` | costGroups → costItems (name, qty, unitCost, unitPrice, totalCost, totalPrice, costCode, costType, isTaxable) | Hierarchical tree |
| `schedule` | tasks (name, startDate, endDate, progress, assignees, taskType, dependencies, isToDo, parentTaskId) | Flat with hierarchy refs |
| `documents` | documents (type, status, name, fullName, price, cost, tax, balance, issueDate, dueDate, includeInBudget) | Grouped by type |
| `activity` | recent comments + daily logs (last 10 each, with files and assignees) | Chronological |

**Optional includes:**

| Include | Adds |
|---------|------|
| `files` | File list with folders, tags, sizes |
| `timeEntries` | Time tracking entries with users and durations |
| `parameters` | Job parameters (COGS, CON, etc.) |
| `customFields` | Full custom field definitions + values |

**Depth behavior:**

| Depth | Budget | Schedule | Documents |
|-------|--------|----------|-----------|
| `summary` | Top-level groups with subtotals only | Tasks with overdue/upcoming counts | Document counts + totals by type |
| `detailed` | Groups + items (no descriptions) | All tasks with assignees | All documents with key fields |
| `full` | Groups + items + descriptions + files | All tasks + comments + descriptions | All documents + line items + recipients |

---

#### `jt_financial_context`

Financial view across one job or the whole org.

```typescript
{
  jobId?: string,             // omit for org-wide
  include?: string[],         // default: ["budget", "documents", "payments"]
  depth?: "summary" | "detailed" | "full",
  intent?: string
}
```

**Default bundle:**

| Section | Fields |
|---------|--------|
| `budget` | Cost vs price totals, margin, cost type breakdown |
| `documents` | All financial docs grouped by type with status, amounts, balance |
| `payments` | Payments with linked documents and amounts |
| `forecast` | Invoice tasks with scheduled amounts and dates |
| `overdue` | Past-due invoices and bills with aging |

**Optional includes:**

| Include | Adds |
|---------|------|
| `costItems` | Individual line-item detail |
| `documentPayments` | Payment-to-document linkages |
| `taxSummary` | Tax totals by document type |

---

#### `jt_schedule_context`

Schedule and workforce view.

```typescript
{
  jobId?: string,             // omit for org-wide
  include?: string[],         // default: ["tasks", "timeEntries"]
  depth?: "summary" | "detailed" | "full",
  membershipId?: string,      // filter to one team member
  intent?: string
}
```

**Default bundle:**

| Section | Fields |
|---------|--------|
| `tasks` | Tasks with dates, progress, assignees, task types, dependencies |
| `timeEntries` | Time entries with users, jobs, durations, approval status |
| `overdue` | Past-due tasks grouped by assignee |
| `upcoming` | Next 14 days of scheduled tasks |

---

#### `jt_crm_context`

Customer/vendor relationship view.

```typescript
{
  accountId?: string,         // specific account (omit for org-wide search)
  query?: string,             // search by name
  type?: "customer" | "vendor" | "subcontractor" | "all",
  include?: string[],         // default: ["contacts", "locations", "jobs"]
  depth?: "summary" | "detailed" | "full",
  intent?: string
}
```

**Default bundle:**

| Section | Fields |
|---------|--------|
| `account` | name, type, isTaxable, customFieldValues, primaryContact, primaryLocation |
| `contacts` | name, title, customFieldValues (email, phone) |
| `locations` | name, address, contactId |
| `jobs` | linked jobs with status, totals |

---

#### `jt_org_context`

Organization-level overview.

```typescript
{
  include?: string[],         // default: ["summary", "members", "catalogs"]
  depth?: "summary" | "detailed" | "full",
  intent?: string
}
```

**Default bundle:**

| Section | Fields |
|---------|--------|
| `summary` | Open/closed job counts, customer/vendor counts, team size |
| `members` | Memberships with roles, user info |
| `catalogs` | Cost codes, cost types, units |
| `dataViews` | Saved views with type and field count |
| `dashboards` | Dashboard list with tile counts |
| `taskTypes` | Task type definitions |
| `customFields` | Custom field definitions by entity type |

---

#### `jt_bills_context`

Vendor bill ingestion pipeline view (JT PowerTools-specific).

```typescript
{
  status?: "pending" | "approved" | "rejected" | "all",
  billId?: string,            // specific bill detail
  include?: string[],         // default: ["pending", "senders"]
  intent?: string
}
```

**Default bundle:**

| Section | Fields |
|---------|--------|
| `pending` | Bills in queue with extracted vendor, amounts, dates |
| `approved` | Recently approved bills with JT document IDs |
| `senders` | Approved sender allowlist |
| `detail` | (when billId provided) Full extraction with line items |

---

### 4.2 Entity Writes (8 tools)

Each write tool follows a consistent pattern:

```typescript
{
  op: "create" | "update" | "delete",
  // entity-specific fields follow
}
```

#### `jt_job_write`

```typescript
// create
{ op: "create", locationId: string, name: string, description?: string,
  number?: string, priceType?: string, customFieldValues?: object,
  copyCostsFromJobId?: string, copyTasksFromJobId?: string,
  lineItems?: CostItem[], parameters?: {name, value}[], folders?: string[] }

// update
{ op: "update", jobId: string, name?: string, description?: string,
  status?: string, customFieldValues?: object, folders?: string[] }

// delete
{ op: "delete", jobId: string }
```

#### `jt_task_write`

```typescript
// create
{ op: "create", jobId: string, name: string, startDate?: string, endDate?: string,
  startTime?: string, endTime?: string, assignees?: {membershipId}[],
  taskTypeId?: string, description?: string, isToDo?: boolean, isGroup?: boolean,
  parentTaskId?: string, positionAfterTaskId?: string,
  dependsOnTasks?: {id}[], dependentTasks?: {id}[],
  recurrenceRule?: string, notify?: boolean }

// update
{ op: "update", taskId: string, name?: string, startDate?: string, endDate?: string,
  progress?: number, assignees?: {membershipId}[], description?: string, ... }

// delete
{ op: "delete", taskId: string }

// createFromBudget
{ op: "createFromBudget", jobId: string }

// notify
{ op: "notify", taskId: string, membershipIds: string[] }

// importTemplate
{ op: "importTemplate", jobId: string, taskTemplateId: string, startDate?: string }
```

#### `jt_budget_write`

Covers cost items and cost groups.

```typescript
// createItem
{ op: "createItem", jobId: string, name: string, costGroupId?: string,
  quantity?: number, unitCost?: number, unitPrice?: number,
  costCodeId?: string, costTypeId?: string, unitId?: string,
  isTaxable?: boolean, description?: string, customFieldValues?: object,
  quantityFormula?: string, unitCostFormula?: string, unitPriceFormula?: string }

// updateItem
{ op: "updateItem", costItemId: string, name?: string, quantity?: number,
  unitCost?: number, unitPrice?: number, costGroupId?: string, ... }

// deleteItem
{ op: "deleteItem", costItemId: string }

// createGroup
{ op: "createGroup", jobId: string, name: string, parentCostGroupId?: string,
  description?: string, quantity?: number, lineItems?: CostItem[],
  maxSelectionsAllowed?: number, minSelectionsRequired?: number,
  showChildCosts?: boolean, showChildren?: boolean, showDescription?: boolean }

// updateGroup
{ op: "updateGroup", costGroupId: string, name?: string, description?: string, ... }

// deleteGroup
{ op: "deleteGroup", costGroupId: string }

// assignSelection
{ op: "assignSelection", costItemId: string, assignee: object }

// updateSelection
{ op: "updateSelection", selectionAssignmentId: string, ... }
```

#### `jt_contact_write`

Covers accounts, contacts, locations, and access control.

```typescript
// createAccount
{ op: "createAccount", organizationId: string, type: "customer"|"vendor",
  name: string, isTaxable?: boolean, customFieldValues?: object }

// updateAccount
{ op: "updateAccount", accountId: string, name?: string, isTaxable?: boolean,
  primaryContactId?: string, primaryLocationId?: string, customFieldValues?: object }

// deleteAccount
{ op: "deleteAccount", accountId: string }

// createContact
{ op: "createContact", accountId: string, name: string,
  title?: string, customFieldValues?: object }

// updateContact
{ op: "updateContact", contactId: string, name?: string,
  title?: string, customFieldValues?: object }

// createLocation
{ op: "createLocation", accountId: string, name: string,
  address?: string, contactId?: string, customFieldValues?: object }

// updateLocation
{ op: "updateLocation", locationId: string, name?: string,
  address?: string, contactId?: string }

// grantAccess
{ op: "grantAccess", targetType: string, targetId: string,
  assignee: object, notify?: boolean }

// revokeAccess
{ op: "revokeAccess", aceId: string }
```

#### `jt_daily_log_write`

```typescript
// create
{ op: "create", jobId: string, date: string, notes?: string,
  assignees?: {membershipId}[], customFieldValues?: object,
  files?: {id, name}[], notify?: boolean }

// update
{ op: "update", dailyLogId: string, notes?: string, date?: string,
  customFieldValues?: object }

// delete
{ op: "delete", dailyLogId: string }
```

#### `jt_document_write`

The most complex write — covers all 5 document types plus payments, recipients, references, templates, and sending.

```typescript
// createDocument
{ op: "createDocument", jobId: string, type: DocumentType, name: string,
  toName: string, fromName: string,
  // Full Pave createDocument input:
  lineItems?: LineItem[], description?: string, footer?: string,
  issueDate?: string, dueDate?: string, dueDays?: number,
  taxRate?: number, taxName?: string, tax?: number,
  requireSignature?: boolean, signatureDisclaimer?: string,
  showQuantity?: boolean, showChildCosts?: boolean, showProfit?: boolean,
  showProgress?: boolean, showScheduledDocuments?: boolean,
  scheduledDocuments?: ScheduledDoc[],
  includeInBudget?: boolean, status?: DocumentStatus,
  // Address fields
  toEmailAddress?: string, toAddress?: string, toPhoneNumber?: string,
  fromEmailAddress?: string, fromAddress?: string, fromPhoneNumber?: string,
  // Cover page
  coverPageTitle?: string, coverPageSubtitle?: string, coverPageTemplate?: string,
  // Payment
  paymentMethods?: string[], allowPartialPayments?: boolean,
  // QBO integration
  qboAccountId?: string, qboDocumentType?: string, qboIsIgnored?: boolean,
  // Files
  files?: FileAttachment[],
  // Refs
  references?: {type, id}[] }

// updateDocument
{ op: "updateDocument", documentId: string,
  // Any field from createDocument except jobId and type
  name?: string, status?: DocumentStatus, lineItems?: LineItem[],
  signaturePath?: string, ... }

// deleteDocument
{ op: "deleteDocument", documentId: string }

// addRecipient
{ op: "addRecipient", documentId: string, assignee: object,
  requireSignature?: boolean }

// removeRecipient
{ op: "removeRecipient", documentRecipientId: string }

// send
{ op: "send", documentRecipientId: string, emailMessage?: string }

// addReference
{ op: "addReference", documentId: string, reference: {type, id} }

// createPayment
{ op: "createPayment", organizationId: string, amount: number,
  paidAt: string, type: PaymentType, accountId?: string,
  description?: string, source?: string }

// updatePayment
{ op: "updatePayment", paymentId: string, amount?: number,
  paidAt?: string, description?: string, source?: string }

// deletePayment
{ op: "deletePayment", paymentId: string }

// linkPayment
{ op: "linkPayment", documentId: string, paymentId: string, amount: number }

// unlinkPayment
{ op: "unlinkPayment", documentPaymentId: string }

// createTemplate
{ op: "createTemplate", organizationId: string, type: DocumentType,
  templateName: string, name: string, ... }

// updateTemplate
{ op: "updateTemplate", documentTemplateId: string, ... }

// deleteTemplate
{ op: "deleteTemplate", documentTemplateId: string }
```

**DocumentType:** `"bidRequest" | "customerInvoice" | "customerOrder" | "vendorBill" | "vendorOrder"`

**DocumentStatus:** `"draft" | "pending" | "approved" | "denied"`

**PaymentType:** `"credit" | "debit"` (verified 2026-04-15 — direction only, NOT method)

**PaymentMethod** (for `createDocument.paymentMethods[]`): `"ach" | "card"` (Stripe-accepted methods)

#### `jt_time_entry_write`

```typescript
// create
{ op: "create", jobId: string, startedAt: string, endedAt?: string,
  userId?: string, costItemId?: string, notes?: string, type?: string }

// update
{ op: "update", timeEntryId: string, startedAt?: string, endedAt?: string,
  notes?: string, isApproved?: boolean, costItemId?: string,
  jobId?: string, endNow?: boolean }

// delete
{ op: "delete", timeEntryId: string }
```

#### `jt_dashboard_write`

Covers dashboards and data views.

```typescript
// createDashboard
{ op: "createDashboard", name: string, template?: string, tiles?: Tile[],
  visibleTo?: string }

// updateDashboard
{ op: "updateDashboard", dashboardId: string, name?: string,
  tiles?: Tile[], addTiles?: Tile[], removeTileIds?: string[] }

// deleteDashboard
{ op: "deleteDashboard", dashboardId: string }

// createDataView
{ op: "createDataView", type: EntityType, name: string, fields: string[],
  where?: Filter[], sortBy?: Sort[], groupBy?: string,
  view?: "list"|"kanban", personal?: boolean }

// updateDataView
{ op: "updateDataView", dataViewId: string, name?: string,
  fields?: string[], where?: Filter[], sortBy?: Sort[], ... }

// deleteDataView
{ op: "deleteDataView", dataViewId: string }
```

---

### 4.3 Workflow Tools (2 tools)

#### `jt_workflow_context`

```typescript
{
  workflowId?: string,        // specific workflow detail
  include?: string[],         // default: ["workflows", "runs"]
  runStatus?: string,         // filter runs by status
  limit?: number
}
```

#### `jt_workflow_write`

```typescript
// create
{ op: "create", name: string, triggerTypeId: string,
  actions: ActionTree[], triggerInput?: object, isActive?: boolean }

// update
{ op: "update", workflowId: string, name?: string, actions?: ActionTree[],
  triggerTypeId?: string, triggerInput?: object, isActive?: boolean }

// delete
{ op: "delete", workflowId: string }

// cancelRun
{ op: "cancelRun", workflowRunId: string }

// rerunRun
{ op: "rerunRun", workflowRunId: string }
```

---

### 4.4 Utility Tools (5 tools)

#### `jt_search`

Global search across all entity types.

```typescript
{
  query: string,
  types?: string[],           // filter to specific entity types
  limit?: number
}
```

#### `jt_raw_query`

Escape hatch — raw Pave query passthrough. Unchanged from current implementation. DELETE mutations remain blocked.

```typescript
{
  query: object,              // Pave query object
  intent?: string
}
```

#### `jt_knowledge`

Knowledge base lookup (API docs + help articles).

```typescript
{
  query: string,
  source?: "api" | "help",
  category?: string,
  limit?: number
}
```

#### `jt_files`

File operations: upload, update, PDF generation, plan management.

```typescript
// upload
{ op: "upload", jobId: string, fileUrl: string,
  fileName?: string, folder?: string }

// uploadToCostItem
{ op: "uploadToCostItem", costItemId: string, fileUrl: string,
  fileName?: string }

// updateFile
{ op: "updateFile", fileId: string, name?: string, folder?: string,
  description?: string, fileTagIds?: string[] }

// updateFileTag
{ op: "updateFileTag", fileTagId: string, name?: string }

// deleteFile
{ op: "deleteFile", fileId: string }

// generatePdf
{ op: "generatePdf", type: "budget"|"dailyLogs"|"document"|"selections"|"specifications"|"tasks",
  options: PdfOptions }
  // PdfOptions varies by type:
  //   budget: { jobId, dataViewId?, searchQuery? }
  //   dailyLogs: { jobId, startDate?, endDate?, userId? }
  //   document: { id }
  //   selections: { jobId }
  //   specifications: { jobId }
  //   tasks: { jobId?, organizationId?, dataViewId?, scale?, showDetails?, ... }

// createPlan
{ op: "createPlan", jobId: string, fileId: string, name: string,
  page: number, scale?: number }

// updatePlan
{ op: "updatePlan", planId: string, name?: string, scale?: number }

// deletePlan
{ op: "deletePlan", planId: string }

// signQuery
{ op: "signQuery", query: object }
```

#### `jt_webhook_write`

Webhook subscription management.

```typescript
// create
{ op: "create", organizationId: string, url: string,
  eventTypes: EventType[] }
  // eventTypes: array of up to 40 from the 38 available event types

// delete
{ op: "delete", webhookId: string }

// list (read via jt_org_context or here)
{ op: "list" }
```

---

### 4.5 Sandbox / Mini-Apps (5 tools — reserved, Wave 3)

| Tool | Purpose |
|------|---------|
| `jt_app_deploy` | Deploy a mini-app to Cloudflare |
| `jt_app_list` | List deployed apps |
| `jt_app_get` | Get app details + logs |
| `jt_app_delete` | Remove a deployed app |
| `jt_app_logs` | Stream app logs |

---

### 4.6 Context Mode (6 tools — unchanged)

| Tool | Purpose |
|------|---------|
| `ctx_search` | BM25-ranked search of indexed content |
| `ctx_index` | Index content into knowledge base |
| `ctx_batch` | Execute multiple tool calls in one request |
| `ctx_stats` | Context consumption statistics |
| `ctx_resume` | Session resume snapshot |
| `ctx_sources` | List indexed content sources |

---

### 4.7 Tool Count Summary

| Category | Count |
|----------|-------|
| Read avenues | 6 |
| Entity writes | 8 |
| Workflow tools | 2 |
| Utility tools | 5 |
| Sandbox (reserved) | 5 |
| Context mode | 6 |
| **Total** | **32** |
| **Headroom under 60** | **28** |

---

## 5. Migration Map — Old Tool → New Tool

### 5.1 Reads (26 current → 6 avenues)

| Old Tool | New Tool | Section |
|----------|----------|---------|
| `jobtread_get_job` | `jt_job_context` | job |
| `jobtread_get_budget` | `jt_job_context` | budget |
| `jobtread_get_budget_tree` | `jt_job_context` (depth: full) | budget |
| `jobtread_get_budget_backups` | `jt_job_context` | budget.backups |
| `jobtread_get_schedule` | `jt_job_context` / `jt_schedule_context` | schedule |
| `jobtread_get_task` | `jt_schedule_context` (taskId param) | tasks |
| `jobtread_get_comments` | `jt_job_context` | activity |
| `jobtread_get_daily_logs` | `jt_job_context` | activity |
| `jobtread_get_document` | `jt_financial_context` (documentId param) | documents |
| `jobtread_list_documents` | `jt_financial_context` | documents |
| `jobtread_get_time_entries` | `jt_schedule_context` | timeEntries |
| `jobtread_search_jobs` | `jt_search` (type: job) | — |
| `jobtread_search_accounts` | `jt_crm_context` / `jt_search` | — |
| `jobtread_get_account_details` | `jt_crm_context` (accountId) | account |
| `jobtread_list_locations` | `jt_crm_context` | locations |
| `jobtread_get_org_summary` | `jt_org_context` | summary |
| `jobtread_list_members` | `jt_org_context` | members |
| `jobtread_list_catalogs` | `jt_org_context` | catalogs |
| `jobtread_list_dashboards` | `jt_org_context` | dashboards |
| `jobtread_get_dashboard` | `jt_org_context` (dashboardId) | dashboard |
| `jobtread_list_data_views` | `jt_org_context` | dataViews |
| `jobtread_get_data_view` | `jt_org_context` (dataViewId) | dataView |
| `jobtread_list_data_view_fields` | `jt_org_context` (include: dataViewFields) | dataViewFields |
| `jobtread_get_workflow` | `jt_workflow_context` (workflowId) | workflow |
| `jobtread_list_workflows` | `jt_workflow_context` | workflows |
| `jobtread_list_workflow_runs` | `jt_workflow_context` | runs |
| `jobtread_get_custom_fields` | `jt_org_context` | customFields |
| `jobtread_search_files` | `jt_job_context` (include: files) | files |
| `jobtread_get_job_activity` | `jt_job_context` | activity |
| `jobtread_get_invoice_forecast` | `jt_financial_context` | forecast |
| `jobtread_get_overdue_by_member` | `jt_schedule_context` | overdue |
| `jobtread_compare_budgets` | `jt_financial_context` (include: backups) | budget.comparison |
| `jobtread_list_task_templates` | `jt_org_context` | taskTemplates |
| `jobtread_list_template_jobs` | `jt_org_context` | templateJobs |
| `jobtread_list_cost_group_templates` | `jt_org_context` | costGroupTemplates |
| `jobtread_search_team_notes` | `jt_knowledge` | — |
| `jobtread_get_knowledge_article` | `jt_knowledge` | — |
| `list_pending_bills` | `jt_bills_context` | pending |
| `get_pending_bill_detail` | `jt_bills_context` (billId) | detail |
| `list_approved_senders` | `jt_bills_context` | senders |

### 5.2 Writes (25 current → 8 entity writes + utilities)

| Old Tool | New Tool | Op |
|----------|----------|----|
| `jobtread_create_job` | `jt_job_write` | create |
| `jobtread_update_job` | `jt_job_write` | update |
| `jobtread_create_task` | `jt_task_write` | create |
| `jobtread_update_task` | `jt_task_write` | update |
| `jobtread_import_task_template` | `jt_task_write` | importTemplate |
| `jobtread_create_cost_item` | `jt_budget_write` | createItem |
| `jobtread_update_cost_item` | `jt_budget_write` | updateItem |
| `jobtread_create_cost_group` | `jt_budget_write` | createGroup |
| `jobtread_update_cost_group` | `jt_budget_write` | updateGroup |
| `jobtread_create_account` | `jt_contact_write` | createAccount |
| `jobtread_update_account` | `jt_contact_write` | updateAccount |
| `jobtread_create_contact` | `jt_contact_write` | createContact |
| `jobtread_update_contact` | `jt_contact_write` | updateContact |
| `jobtread_create_location` | `jt_contact_write` | createLocation |
| `jobtread_update_location` | `jt_contact_write` | updateLocation |
| `jobtread_create_daily_log` | `jt_daily_log_write` | create |
| `jobtread_update_daily_log` | `jt_daily_log_write` | update |
| `jobtread_create_comment` | *(folded into each write as a comment op, or standalone)* | — |
| `jobtread_update_comment` | *(same)* | — |
| `jobtread_create_time_entry` | `jt_time_entry_write` | create |
| `jobtread_update_time_entry` | `jt_time_entry_write` | update |
| `jobtread_create_dashboard` | `jt_dashboard_write` | createDashboard |
| `jobtread_update_dashboard` | `jt_dashboard_write` | updateDashboard |
| `jobtread_create_data_view` | `jt_dashboard_write` | createDataView |
| `jobtread_update_data_view` | `jt_dashboard_write` | updateDataView |
| `jobtread_create_workflow` | `jt_workflow_write` | create |
| `jobtread_update_workflow` | `jt_workflow_write` | update |
| `jobtread_upload_file` | `jt_files` | upload |
| `jobtread_upload_file_to_cost_item` | `jt_files` | uploadToCostItem |
| `jobtread_create_team_note` | `jt_knowledge` | *(or separate)* |
| `jobtread_update_team_note` | `jt_knowledge` | *(or separate)* |
| `approve_bill` | `jt_bills_context` → `jt_document_write` | createDocument (vendorBill) |
| `reject_bill` | `jt_bills_context` | reject |
| `add_approved_sender` | `jt_bills_context` | addSender |

### 5.3 Comment Handling

Comments are cross-cutting — they apply to jobs, tasks, daily logs, documents, files, accounts, and time entries. Options:

**Option A (recommended):** Keep a lightweight `jt_comment_write` tool (doesn't count as a full entity write — it's a utility). This avoids duplicating comment params across every entity write.

```typescript
{
  op: "create" | "update" | "delete",
  targetType: "job"|"task"|"dailyLog"|"document"|"file"|"account"|"timeEntry",
  targetId: string,
  message?: string,
  assignees?: {membershipId}[],
  isPinned?: boolean,
  parentCommentId?: string,
  isVisibleToAll?: boolean,
  // ... visibility flags
}
```

This brings the total to **33 tools** (still 27 slots of headroom).

**Option B:** Fold comments into each entity write as an `addComment` op. More consolidated but duplicates schema across 6+ writes.

---

## 6. Shared Query Builder

### 6.1 Design

Create `server/mcp-server/src/query-builder.js` — composable helpers that eliminate the per-tool Pave query construction.

```javascript
// Core builder
const qb = require('./query-builder');

// Select fields
const jobFields = qb.select('job', ['id', 'name', 'number', 'status', 'closedOn']);

// Nested connection with filtering
const tasks = qb.connection('tasks', {
  where: qb.and(
    qb.eq('isToDo', false),
    qb.isNull('closedOn')
  ),
  sortBy: [{ field: 'startDate', order: 'asc' }],
  size: 100,
  fields: ['id', 'name', 'startDate', 'endDate', 'progress']
});

// Compose into a full query
const query = qb.root({
  job: {
    $: { id: jobId },
    ...jobFields,
    ...tasks
  }
});
```

### 6.2 Helpers

```javascript
// Filtering
qb.eq(field, value)              // ["field", value]
qb.neq(field, value)             // ["field", "!=", value]
qb.gt(field, value)              // ["field", ">", value]
qb.gte(field, value)
qb.lt(field, value)
qb.lte(field, value)
qb.isNull(field)                 // [["field"], null]
qb.isNotNull(field)              // [["field"], "!=", null]
qb.in(field, values)             // ["field", "in", [...]]
qb.between(field, start, end)    // ["field", "between", [start, end]]
qb.like(field, pattern)          // ["field", "like", pattern]
qb.and(...conditions)            // { and: [...] }
qb.or(...conditions)             // { or: [...] }
qb.nested(path, value)           // [["path", "to", "field"], value]

// Aggregation
qb.count()                       // { count: {} }
qb.sum(field)                    // { sum: { $: field } }
qb.min(field)
qb.max(field)
qb.avg(field)

// Connection
qb.connection(name, { where, sortBy, size, page, fields, with, group })

// Pagination
qb.paginate(size, page)          // { size, page }

// Mutations
qb.create(entity, input)         // { [`create${Entity}`]: { $: input, [`created${Entity}`]: { id: {} } } }
qb.update(entity, input)         // { [`update${Entity}`]: { $: input } }
qb.delete(entity, id)            // { [`delete${Entity}`]: { $: { id } } }
```

### 6.3 Impact

Current `tools.js` is 7,126 lines with every tool constructing queries from scratch. With the query builder + avenue pattern, estimated new size: **< 2,000 lines**.

---

## 7. Context Mode Auto-Index

Every avenue response is automatically piped through `ctx_index` using the existing `ctx.wrapTool()` pattern from `mcp-context-mode/integration-example.js`.

```javascript
// In avenue handler
const response = await buildAvenueResponse(params);

// Auto-index each section
for (const [section, data] of Object.entries(response)) {
  await ctx.index({
    source: `${avenueName}/${section}`,
    content: JSON.stringify(data),
    metadata: { jobId: params.jobId, section, timestamp: Date.now() }
  });
}

// Return full response to caller
return response;
```

This means:
- First call: `jt_job_context` returns full bundle + indexes all sections
- Subsequent calls: `ctx_search("overdue tasks")` retrieves the relevant section without re-querying JT
- Avenues can be large without overwhelming context — context mode makes big safe

---

## 8. Pagination Architecture

Avenues return rich bundles, but a job with 400 budget items, 200 tasks, and 50 documents will blow up context windows. Three pagination problems must be solved.

### 8.1 The Three Problems

| Problem | Description | Solution |
|---------|-------------|----------|
| **Intra-avenue overflow** | A single avenue touches 5+ Pave connections, each potentially hundreds of items | Per-section cursors with smart defaults |
| **Cross-avenue follow-up** | User drills into a specific section after seeing summaries | Context mode `ctx_search` retrieves indexed sections without re-fetching |
| **Pave's own pagination** | Max 100 per page, cursor-based `nextPage` | Server-side auto-pagination within default limits |

### 8.2 Per-Section Cursors

Each connection in an avenue response includes its own pagination metadata. The avenue never returns a single flat cursor — sections paginate independently.

```json
{
  "job": { "id": "abc", "name": "Kitchen Reno", "status": "approved" },
  "budget": {
    "items": [ ... ],
    "count": 147,
    "returned": 100,
    "hasMore": true,
    "nextPage": "eyJwIjoyfQ"
  },
  "schedule": {
    "items": [ ... ],
    "count": 42,
    "returned": 42,
    "hasMore": false
  },
  "documents": {
    "items": [ ... ],
    "count": 12,
    "returned": 12,
    "hasMore": false
  }
}
```

Follow-up call fetches only the overflowed section:

```typescript
jt_job_context({
  jobId: "abc",
  include: ["budget"],           // only re-fetch budget
  page: { budget: "eyJwIjoyfQ" } // section-level cursor
})
```

### 8.3 Default Page Sizes by Connection

Tuned to typical residential remodel job cardinality. These are the items returned before `hasMore` kicks in.

| Connection | Default Size | Rationale |
|------------|-------------|-----------|
| Budget cost groups | 50 | Most jobs have < 30 groups |
| Budget cost items | 100 | Pave max per page; large jobs may overflow |
| Tasks (schedule) | 100 | Covers most job schedules in one page |
| To-dos | 25 | Usually fewer, less critical for initial context |
| Documents | 25 | Rarely > 20 per job |
| Comments | 10 | Most recent only; historical via `ctx_search` |
| Daily logs | 10 | Most recent only |
| Time entries | 50 | Moderate volume |
| Files | 50 | Can be high but metadata is small |
| Payments | 25 | Rarely high volume |
| Members (org) | 100 | One page covers most orgs |
| Accounts (org) | 50 | First page; search narrows further |

### 8.4 Depth Controls Payload Size

The `depth` parameter is the primary knob for controlling response size. At each level, the server uses different Pave query strategies:

**`depth: "summary"` — Aggregations only, no records.**

Server uses Pave `count`, `sum`, and `group` aggregations. No item-level data crosses the wire.

```json
{
  "budget": {
    "groupCount": 12,
    "itemCount": 147,
    "totalCost": 23450000,
    "totalPrice": 31200000,
    "margin": 0.287,
    "byType": [
      { "type": "Labor", "cost": 8200000, "price": 11500000 },
      { "type": "Materials", "cost": 9100000, "price": 11700000 }
    ]
  },
  "schedule": {
    "taskCount": 42,
    "overdueCount": 3,
    "completedCount": 28,
    "upcoming7Days": 5
  },
  "documents": {
    "byType": {
      "customerOrder": { "count": 2, "totalPrice": 31200000, "approved": 1, "pending": 1 },
      "customerInvoice": { "count": 8, "totalPrice": 24500000, "totalBalance": 6200000 },
      "vendorBill": { "count": 15, "totalCost": 18900000, "totalBalance": 3100000 }
    }
  }
}
```

Payload size: ~500 bytes regardless of job size. The AI gets enough to orient and decide what to drill into.

**`depth: "detailed"` — Records with key fields, no descriptions/files.**

Server fetches item-level data but selects only the fields needed for identification and decision-making. Descriptions, file attachments, and nested comments are omitted.

Budget items return: `id, name, quantity, unitCost, unitPrice, totalCost, totalPrice, costCode, costType, isTaxable, costGroupId`. *Not:* `description, files, customFieldValues`.

Tasks return: `id, name, startDate, endDate, progress, assignees, taskType, isToDo, parentTaskId`. *Not:* `description, comments, files, dependencies`.

Payload size: ~10-30 KB for a typical 150-item job. This is the default depth.

**`depth: "full"` — Everything including descriptions, files, dependencies.**

Server fetches all available fields. This is the only depth that returns descriptions, file attachments, line-item files, task dependencies, and comment threads.

Payload size: ~50-200 KB for a large job. Use only when the caller needs the detail.

### 8.5 Intent-Based Filtering

The `intent` parameter shapes the Pave query before pagination even applies. This is deterministic pattern matching, not AI inference.

**Server-side intent engine:**

```javascript
// intent-filter.js — deterministic keyword → where clause mapping

const INTENT_PATTERNS = [
  // Budget intents
  { match: /plumb/i,      section: 'budget', where: qb.like('name', '%plumb%') },
  { match: /electric/i,   section: 'budget', where: qb.like('name', '%electr%') },
  { match: /over\s?budget|cost\s?overrun/i, section: 'budget',
    where: qb.gt('totalCost', { field: ['totalPrice'] }) },

  // Schedule intents
  { match: /overdue|past\s?due|late/i, section: 'schedule',
    where: qb.and(qb.lt('endDate', TODAY), qb.lt('progress', 1)) },
  { match: /upcoming|next\s?week/i, section: 'schedule',
    where: qb.between('startDate', TODAY, NEXT_7) },

  // Document intents
  { match: /unpaid|outstanding|balance/i, section: 'documents',
    where: qb.gt('balance', 0) },
  { match: /invoice/i, section: 'documents',
    where: qb.eq('type', 'customerInvoice') },
  { match: /bill/i, section: 'documents',
    where: qb.eq('type', 'vendorBill') },
];

function applyIntent(intent, queries) {
  if (!intent) return queries;
  for (const pattern of INTENT_PATTERNS) {
    if (pattern.match.test(intent)) {
      queries[pattern.section].where = qb.and(
        queries[pattern.section].where,
        pattern.where
      );
    }
  }
  return queries;
}
```

When an intent matches, the Pave query is narrowed *before* execution. A job with 400 budget items but only 12 plumbing items returns 12 items with `hasMore: false` — no pagination needed.

When no intent matches, the default bundle is returned with standard pagination. The full response still gets indexed by `ctx_index` so `ctx_search` handles the needle-in-haystack case later.

### 8.6 Response Size Budget

Target response sizes by depth (after JSON serialization, before any MCP protocol overhead):

| Depth | Target | Hard Limit | Notes |
|-------|--------|------------|-------|
| `summary` | < 1 KB | 5 KB | Aggregations only |
| `detailed` | < 30 KB | 100 KB | Default. Most jobs fit comfortably. |
| `full` | < 100 KB | 500 KB | Large jobs with descriptions and files |

If a response would exceed the hard limit (e.g., a commercial job with 1,000+ line items at `full` depth), the server truncates with `hasMore: true` on overflowing sections and logs a warning. The caller can page through or narrow with `intent`.

### 8.7 Progressive Deepening Pattern

The recommended calling pattern for large jobs:

```
1. jt_job_context({ jobId, depth: "summary" })
   → AI orients: "147 budget items, 3 overdue tasks, $6.2K outstanding invoices"
   → All sections indexed by ctx_index

2. jt_job_context({ jobId, depth: "detailed", include: ["schedule"], intent: "overdue" })
   → Returns only the 3 overdue tasks with assignees and dates
   → AI has what it needs to answer "what's behind schedule?"

3. ctx_search("plumbing budget items")
   → Retrieves from index without another Pave call
   → Works because step 1 indexed the summary, step 2 didn't need budget
```

The AI never pays for data it doesn't need, but can always get more. Context mode makes this safe — even truncated first-page data gets indexed for follow-up retrieval.

---

## 9. Parallel Query Architecture

### 9.1 The Problem

A single `jt_job_context` call at `detailed` depth needs data from 5+ Pave connections. Done sequentially, each Pave round-trip is ~100-200ms. Five sequential queries = 500ms-1s just in network time. For a contractor staring at a chat, that's noticeable.

### 9.2 The Solution: Promise.all() in the Worker

Each avenue handler decomposes into independent Pave queries and executes them in parallel. No AI needed — this is pure concurrent I/O.

```javascript
// avenues/job-context.js

async function handleJobContext({ jobId, include, depth, intent, page }) {
  const orgId = await getOrgId();  // cached per-grant

  // Build queries based on include[] and depth
  const queries = buildQueries({ jobId, orgId, include, depth, intent, page });

  // Execute ALL Pave queries in parallel
  const results = await Promise.all(
    Object.entries(queries).map(async ([section, query]) => {
      const data = await pave(query);
      return [section, data];
    })
  );

  // Assemble response
  const response = {};
  for (const [section, data] of results) {
    response[section] = formatSection(section, data, depth);
  }

  // Auto-index for ctx_search (non-blocking)
  ctx.indexBatch(response, { jobId, avenue: 'job_context' });

  return response;
}
```

### 9.3 Query Decomposition

Each section maps to one or more independent Pave queries. Pave supports multi-root queries (multiple top-level fields in one request), but we split by section for two reasons: (1) parallel execution is faster than one giant query, and (2) section-level error isolation — if the schedule query fails, the budget still returns.

**`jt_job_context` decomposition at `detailed` depth:**

```
Query 1: job core
  → job { id, name, number, status, closedOn, description, priceType,
          location { name, address }, account { name, type },
          customFieldValues { ... } }

Query 2: budget
  → job.costGroups { nodes { id, name, costItems { nodes { ... }, count, nextPage } } }
  (or at summary depth: job.costItems { count, sum(totalCost), sum(totalPrice) })

Query 3: schedule
  → job.tasks { $: { where, sortBy, size }, nodes { ... }, count, nextPage }

Query 4: documents
  → job.documents { $: { sortBy, size }, nodes { ... }, count, nextPage }

Query 5: activity (comments + daily logs)
  → job.comments { $: { size: 10, sortBy: [{ field: 'createdAt', order: 'desc' }] }, nodes { ... } }
  → job.dailyLogs { $: { size: 10, sortBy: [{ field: 'date', order: 'desc' }] }, nodes { ... } }
```

Queries 2-5 run in parallel. Query 1 is fast (single entity) and can run in parallel too, or be combined with any other query as a multi-root Pave request.

### 9.4 Latency Impact

| Pattern | Queries | Sequential | Parallel | Savings |
|---------|---------|-----------|----------|---------|
| `jt_job_context` detailed | 5 | ~750ms | ~200ms | **73%** |
| `jt_job_context` summary | 5 (aggregation) | ~500ms | ~150ms | **70%** |
| `jt_financial_context` detailed | 4 | ~600ms | ~200ms | **67%** |
| `jt_schedule_context` detailed | 3 | ~450ms | ~200ms | **56%** |
| `jt_org_context` summary | 6 | ~900ms | ~200ms | **78%** |

Parallel execution is bottlenecked by the slowest single query, not the sum. Pave queries are typically 100-200ms each, so parallel avenues should consistently return in ~200ms regardless of how many sections are included.

### 9.5 Error Isolation

Each section query is wrapped in a try/catch. If one section fails, the others still return. The failed section includes an error marker instead of data.

```javascript
const results = await Promise.allSettled(
  Object.entries(queries).map(async ([section, query]) => {
    const data = await pave(query);
    return [section, data];
  })
);

for (const result of results) {
  if (result.status === 'fulfilled') {
    const [section, data] = result.value;
    response[section] = formatSection(section, data, depth);
  } else {
    // Section failed — include error marker, don't blow up the whole avenue
    response[section] = { error: result.reason.message, hasMore: false };
  }
}
```

### 9.6 Caching Strategy

Some data is slow-changing and shared across avenue calls within a session:

| Data | Cache TTL | Scope |
|------|----------|-------|
| Org ID | Session lifetime | Per-grant |
| Members list | 5 minutes | Per-org |
| Task types | 5 minutes | Per-org |
| Cost codes/types/units | 5 minutes | Per-org |
| Custom field definitions | 5 minutes | Per-org |
| Job core data | 30 seconds | Per-job |

Cached at the Worker level using Cloudflare's `caches` API or in-memory Maps (scoped to the Worker isolate lifetime). This eliminates redundant Pave calls when the same session hits multiple avenues that share reference data.

### 9.7 Cost Profile

At $30/mo per contractor with ~400 contractors:

| Component | Cost | Notes |
|-----------|------|-------|
| Cloudflare Workers | $5/mo (paid plan) | 10M requests/mo included, ~$0.50/M after |
| Pave API calls | $0 | No per-call cost from JobTread |
| Bandwidth | Negligible | JSON responses, small payloads |
| AI sub-agents | **$0** | Not used — deterministic intent matching only |

The parallel query pattern adds zero marginal cost. It's pure I/O concurrency on the existing Worker. The only cost driver is request volume, which is well within Cloudflare's paid plan limits even at scale.

If the contractor base grows to 1,000+ orgs, the caching strategy becomes increasingly valuable — fewer Pave round-trips per request means lower p99 latencies and better behavior under load.

---

## 10. Permission Tiers — Worker-Side Grant Scoping

### 10.1 Motivation

The redesign introduces powerful write and delete operations that didn't exist before — full document CRUD, payment management, webhook subscriptions, file deletions. Not every contractor wants or needs that surface exposed. A tiered permission model lets admins choose their risk tolerance at onboarding and gives JT PowerTools a natural upsell path if desired.

### 10.2 Why Not Pave-Level Enforcement

Pave grants support a granular `allowedActions` array — ~190 distinct actions like `readJob`, `createCustomerInvoice`, `deleteDocument`. Confirmed via schema introspection:

```
readJob, readJobBudget, readJobTasks, readAccount, readDocument, readPayment,
createJob, createCustomerInvoice, createVendorBill, createTask, createDailyLog,
updateJob, updateDocument, updateTask, updateAccount,
deleteJob, deleteDocument, deleteTask, deletePayment, deleteFile,
... (~190 total)
```

In theory we could scope grants per tier. However, JT PowerTools uses a **single shared grant key per org**. The admin creates a dedicated "AI" user account in JobTread, generates a grant key, and pastes it into the JT PowerTools portal. This is intentional:

- **Auditability** — all AI actions are attributable to one account in JT's activity logs
- **Admin control** — the admin owns the key and can revoke it without touching JT PowerTools
- **Simplicity** — everyone in the org shares the same grant, no per-user key management

Since we don't control grant creation (the admin does that in JT), we can't inject `allowedActions` at the Pave level without requiring the admin to regenerate their key every time they change tiers.

**Enforcement happens in our Cloudflare Worker instead.** The admin picks a tier in the JT PowerTools portal, we store it in D1, and tool handlers check the tier before executing any Pave query. This is better anyway — we can define tiers with more nuance than Pave's flat action list, and we can change tier definitions in a deploy without touching any grant keys.

### 10.3 The Three Tiers

| Tier | Label | What AI Can Do | What's Blocked |
|------|-------|---------------|----------------|
| `read` | **Read Only** | View jobs, budgets, schedules, documents, org data. Run reports. Search. Generate PDFs. | All creates, updates, deletes (except bill pipeline — see §10.5). |
| `read_write` | **Read + Write** | Everything in Read, plus create/update jobs, tasks, documents, budgets, time entries, comments, workflows, dashboards. | All delete operations. |
| `full` | **Full Access** | Everything. Create, update, and delete any entity. | Nothing. |

Default for new orgs: `read_write` (most useful without the scariest operations).

All three tiers are the same $30/mo price — the tier is about risk tolerance, not monetization. Admins self-select based on how much they trust AI automation.

### 10.4 Tool → Tier Mapping

**Read tier — allowed tools and ops:**

| Tool | Allowed | Blocked |
|------|---------|---------|
| All 6 read avenues | Full access | — |
| `jt_search` | Full access | — |
| `jt_knowledge` | Full access | — |
| `jt_raw_query` | Read queries only | All mutations |
| `jt_files` | `generatePdf`, `signQuery` only | `upload`, `updateFile`, `deleteFile`, etc. |
| `jt_bills_context` | `approve`, `reject`, `addSender` (carve-out, see §10.5) | — |
| All `ctx_*` tools | Full access | — |
| All write tools | — | Entirely blocked |

**Read + Write tier — write tools available with delete ops blocked:**

| Tool | Allowed Ops | Blocked Ops |
|------|------------|-------------|
| `jt_job_write` | `create`, `update` | `delete` |
| `jt_task_write` | `create`, `update`, `importTemplate`, `notify`, `createFromBudget` | `delete` |
| `jt_budget_write` | `createItem`, `updateItem`, `createGroup`, `updateGroup`, `assignSelection`, `updateSelection` | `deleteItem`, `deleteGroup` |
| `jt_contact_write` | `createAccount`, `updateAccount`, `createContact`, `updateContact`, `createLocation`, `updateLocation`, `grantAccess` | `deleteAccount`, `revokeAccess` |
| `jt_daily_log_write` | `create`, `update` | `delete` |
| `jt_document_write` | `createDocument`, `updateDocument`, `addRecipient`, `send`, `addReference`, `createPayment`, `updatePayment`, `linkPayment`, `createTemplate`, `updateTemplate` | `deleteDocument`, `removeRecipient`, `deletePayment`, `unlinkPayment`, `deleteTemplate` |
| `jt_time_entry_write` | `create`, `update` | `delete` |
| `jt_dashboard_write` | `createDashboard`, `updateDashboard`, `createDataView`, `updateDataView` | `deleteDashboard`, `deleteDataView` |
| `jt_workflow_write` | `create`, `update` | `delete`, `cancelRun` |
| `jt_webhook_write` | `create`, `list` | `delete` |
| `jt_files` | `upload`, `uploadToCostItem`, `updateFile`, `updateFileTag`, `createPlan`, `updatePlan`, `generatePdf`, `signQuery` | `deleteFile`, `deletePlan` |
| `jt_raw_query` | Read queries + create/update mutations | Delete mutations |

**Full Access tier — adds all blocked delete operations across every tool.**

### 10.5 Bill Pipeline Carve-Out

The vendor bill ingestion pipeline (`approve_bill` → creates a `vendorBill` document in JT) is a controlled workflow, not an open-ended AI write. The flow is:

```
Email arrives → Cloudflare Worker extracts → Bill sits in pending queue
→ Human reviews in chat → Approves or rejects
```

**The bill pipeline is always enabled regardless of tier**, even on Read Only. Rationale:

- The admin explicitly set up email forwarding — they want bills processed
- The human review step provides the safety gate (no bills post to JT without explicit approval)
- Blocking it on Read Only would make the subscription significantly less useful for reporting-focused orgs who still receive vendor bills

Implementation: `jt_bills_context` operations (`approve`, `reject`, `addSender`) bypass the tier check entirely. These are the only write-adjacent operations available on the Read tier.

### 10.6 Worker-Side Enforcement

The tier check runs at the top of every tool handler, before any Pave query fires.

```javascript
// middleware/permissions.js

const TIER_CONFIG = {
  read: {
    allowedTools: new Set([
      'jt_job_context', 'jt_financial_context', 'jt_schedule_context',
      'jt_crm_context', 'jt_org_context', 'jt_bills_context',
      'jt_workflow_context', 'jt_search', 'jt_knowledge',
      'jt_files', 'jt_raw_query',
      'ctx_search', 'ctx_index', 'ctx_batch', 'ctx_stats',
      'ctx_resume', 'ctx_sources'
    ]),
    blockedOps: new Set(['*']),  // all write ops blocked except overrides
    allowedOpsOverride: {
      'jt_bills_context': new Set(['approve', 'reject', 'addSender']),
      'jt_files': new Set(['generatePdf', 'signQuery']),
      'jt_raw_query': new Set(['read']),
    }
  },
  read_write: {
    allowedTools: new Set(['*']),
    blockedOps: new Set([
      'delete', 'deleteItem', 'deleteGroup', 'deleteDocument',
      'deletePayment', 'deleteDashboard', 'deleteDataView',
      'deleteAccount', 'deleteTemplate', 'deletePlan', 'deleteFile',
      'revokeAccess', 'unlinkPayment', 'removeRecipient', 'cancelRun'
    ])
  },
  full: {
    allowedTools: new Set(['*']),
    blockedOps: new Set()
  }
};

function checkPermission(tier, toolName, op) {
  const config = TIER_CONFIG[tier];
  if (!config) return { allowed: false, reason: 'Unknown permission tier.' };

  // Tool-level check
  if (!config.allowedTools.has('*') && !config.allowedTools.has(toolName)) {
    return {
      allowed: false,
      tier,
      required_tier: 'read_write',
      reason: `This tool requires Read + Write access. Your organization's ` +
              `JT PowerTools permission level is set to Read Only. ` +
              `An admin can change this at jtpowertools.com/settings.`
    };
  }

  // Op-level check (for write tools with specific operations)
  if (op && config.blockedOps.has('*')) {
    // Read tier — check carve-out overrides before blocking
    const overrides = config.allowedOpsOverride?.[toolName];
    if (overrides && overrides.has(op)) return { allowed: true };

    return {
      allowed: false,
      tier,
      required_tier: 'read_write',
      reason: `The "${op}" operation requires Read + Write access. Your organization's ` +
              `JT PowerTools permission level is set to Read Only. ` +
              `An admin can change this at jtpowertools.com/settings.`
    };
  }

  if (op && config.blockedOps.has(op)) {
    return {
      allowed: false,
      tier,
      required_tier: 'full',
      reason: `The "${op}" operation requires Full Access. Your organization's ` +
              `JT PowerTools permission level is set to Read + Write. ` +
              `An admin can change this at jtpowertools.com/settings.`
    };
  }

  return { allowed: true };
}
```

**Error response format (returned to the calling AI):**

```json
{
  "error": "permission_denied",
  "tier": "read",
  "required_tier": "read_write",
  "tool": "jt_document_write",
  "op": "createDocument",
  "message": "Creating documents requires Read + Write access. Your organization's JT PowerTools permission level is currently set to Read Only. An admin can change this at jtpowertools.com/settings.",
  "settings_url": "https://jtpowertools.com/settings"
}
```

The AI receives this and can tell the user clearly: *"I can see your budget but I can't create that invoice — your org's JT PowerTools permissions are set to read-only. An admin can change this in the settings."*

### 10.7 Tool Description Injection

Each write tool's MCP description should include a note about the minimum required tier so the AI avoids calling tools it knows will be blocked. The tier is injected into descriptions at tool registration time:

```javascript
// For an org on the 'read' tier:
{
  name: 'jt_document_write',
  description: '⚠️ REQUIRES READ+WRITE — Your org is on READ ONLY. ' +
               'Create, update, or delete documents. ...'
}

// For an org on the 'read_write' tier:
{
  name: 'jt_document_write',
  description: 'Create or update documents (invoices, orders, bills, bid requests). ' +
               'Note: Delete operations require Full Access (current tier: Read + Write). ...'
}

// For an org on the 'full' tier:
{
  name: 'jt_document_write',
  description: 'Create, update, or delete documents (invoices, orders, bills, bid requests). ...'
}
```

This prevents wasted tool calls — the AI reads the description and tells the user upfront instead of calling and getting rejected.

### 10.8 Portal Admin UX

The admin sees this in the JT PowerTools org settings:

```
AI Permission Level
────────────────────────────────────────────────────

○  Read Only
   AI can view all data but cannot create, edit,
   or delete anything. Best for reporting and
   lookups. Vendor bill processing stays active.

●  Read + Write                      ← recommended
   AI can view and create/update data but cannot
   delete anything. Best for most teams.

○  Full Access
   AI can view, create, update, and delete data.
   Only select this if your team needs AI to
   remove records.

────────────────────────────────────────────────────
Changes take effect immediately for all users
in your organization.
```

**D1 storage:**

```sql
CREATE TABLE org_settings (
  org_id TEXT PRIMARY KEY,
  grant_key TEXT NOT NULL,
  permission_tier TEXT NOT NULL DEFAULT 'read_write',
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_by TEXT  -- admin email for audit trail
);

-- Check constraint enforces valid tiers
-- (D1 supports CHECK constraints)
CREATE TABLE org_settings_check AS
  SELECT * FROM org_settings WHERE 0;
-- Enforcement in application layer:
-- tier must be one of: 'read', 'read_write', 'full'
```

The `permission_tier` is read once per session (or cached for 60 seconds) and injected into tool descriptions and the permission middleware. No per-request D1 query needed.

### 10.9 Future Considerations

- **Per-entity tier overrides:** An admin might want "Read + Write on everything except Full Access on documents only." Not needed now but the `TIER_CONFIG` structure supports it — add per-tool override maps.
- **Per-member tiers:** Currently everyone in the org shares the same tier. If JT PowerTools adds per-user auth (via Pave's `viaUserId`), tiers could be per-member. Significant complexity increase — defer unless demand warrants it.
- **Tier-based pricing:** All tiers are the same price today. If Full Access becomes a premium feature, the `org_settings` table already has the field to gate on.
- **Audit logging:** Every permission denial should be logged to D1 with timestamp, tool, op, and tier. This lets you see which orgs are hitting the ceiling and might want to upgrade.

---

## 11. Migration Plan — 3 Waves

### Wave 1 — Avenue Reads (lowest risk, biggest win)

**Goal:** Build 6 read avenues alongside existing 26 narrow reads. Verify response parity. Retire old reads.

| Step | Action | Risk |
|------|--------|------|
| 1 | Build `query-builder.js` with core helpers | Low |
| 2 | Build `jt_job_context` as proof-of-concept | Low |
| 3 | Dogfood `jt_job_context` — verify it returns equivalent data to `get_job` + `get_budget` + `get_schedule` + `get_comments` combined | Low |
| 4 | Build remaining 5 avenues | Low |
| 5 | Add auto-index hook via `ctx.wrapTool()` | Low |
| 6 | Deprecation period: old reads still work but log warnings | Low |
| 7 | Retire old reads | Medium (breaking for existing users) |

**Success criteria:** One `jt_job_context` call returns everything that previously took 4-5 calls, with auto-indexed sections.

### Wave 2 — Write Consolidation (moderate risk)

**Goal:** Collapse 25+ create/update tools into 8 per-entity writes. Add delete support. Close document/payment gaps.

| Step | Action | Risk |
|------|--------|------|
| 1 | Build `jt_document_write` first (biggest gap, highest value) | Medium |
| 2 | Build remaining entity writes | Medium |
| 3 | Add per-entity test pass: create → read back → update → read back → delete | Medium |
| 4 | Verify parity with old tools | Medium |
| 5 | Deprecation period | Low |
| 6 | Retire old writes | Medium |

**Success criteria:** Can create a `customerInvoice`, add recipients, send it, record a payment, and link payment to invoice — all through the new tools.

### Wave 3 — Sandbox / Mini-Apps (greenfield)

**Goal:** Ship the mini-app deployment system for non-tech contractors.

| Step | Action | Risk |
|------|--------|------|
| 1 | Build `jt_webhook_write` (enables app automation) | Low |
| 2 | Build Cloudflare Worker deployment pipeline | Medium |
| 3 | Build 5 sandbox tools | Medium |
| 4 | Ship with 2-3 template apps | Low |

---

## 12. Deprecation Timeline

| Date | Action |
|------|--------|
| Wave 1 ship | Old reads deprecated — log warnings, still functional |
| Wave 1 + 30 days | Old reads removed |
| Wave 2 ship | Old writes deprecated |
| Wave 2 + 30 days | Old writes removed |

All deprecation warnings include the new tool name and equivalent parameters.

---

## 13. Key File Paths

| File | Purpose |
|------|---------|
| `server/mcp-server/src/tools.js` | Current 81 tools (7,126 lines) — being replaced |
| `server/mcp-server/src/index.js` | Worker entry point (453 lines) |
| `server/mcp-server/src/bills-handler.js` | Vendor bill domain (189 lines) |
| `server/mcp-server/src/query-builder.js` | **NEW** — shared query composition |
| `server/mcp-server/src/avenues/` | **NEW** — one file per avenue |
| `server/mcp-server/src/writes/` | **NEW** — one file per entity write |
| `mcp-context-mode/src/` | Context mode integration (6 ctx_* tools) |
| `mcp-context-mode/integration-example.js` | `createContextMode()` + `ctx.wrapTool()` pattern |
| `docs/mcp-redesign.md` | This document |

---

## 14. Open Questions

1. **Payment types:** ✅ **RESOLVED** (2026-04-15) — `paymentType` is `"credit" | "debit"`. See [schema probe doc](./2026-04-15-mcp-redesign-schema-probes.md) §1.
2. **Delete confirmation:** Should entity writes require a `confirm: true` flag for deletes? Or leave that to the AI layer?
3. **Comment tool:** Option A (standalone `jt_comment_write`) vs Option B (fold into each entity write). Recommendation: Option A.
4. **Bill ingestion pipeline:** Does `approve_bill` stay as a JT PowerTools-specific workflow on top of `jt_document_write`, or does it get absorbed? Recommendation: keep as a convenience wrapper that calls `jt_document_write` internally.
5. **Notification suppression:** Pave's root `$` accepts `notify: false`. Should avenue reads pass this? Should writes expose it per-op?
6. **Live schema probing:** ✅ **RESOLVED** (2026-04-15) — All write tool input shapes verified via schema introspection. See [schema probe doc](./2026-04-15-mcp-redesign-schema-probes.md). Field-shape corrections to apply listed in §12 of the probe doc. Avenue bundle response shapes still need a real grant-key probe — defer to first avenue PR.

---

## 15. Next Concrete Steps

1. **Merge this doc** into `docs/mcp-redesign.md` on the redesign branch
2. **Probe remaining Pave types** (paymentType, paymentMethod, assignee, aceTargetType) with a grant key
3. **Build `query-builder.js`** — start with the helpers needed for `jt_job_context`
4. **Build `jt_job_context`** as Wave 1 proof-of-concept
5. **Test with Titus org** — verify response parity against current `jobtread_get_job` + `jobtread_get_budget` + `jobtread_get_schedule`
