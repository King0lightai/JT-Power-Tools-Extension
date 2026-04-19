# MCP Redesign — Pave Schema Probe Findings

> **Date:** 2026-04-15
> **Branch:** `worktree-claude+mcp-redesign-wave1`
> **Source:** Resolves §14 Open Question #6 in [mcp-redesign.md](./mcp-redesign.md)
> **Method:** Schema introspection via Official JobTread MCP `query` tool

This doc captures the exact Pave input shapes and enum values needed to write accurate Zod schemas for the redesigned tools. Each section corresponds to a redesign tool / op and includes the verified Pave field shape so we can build per-op input validators without guessing.

---

## 1. Enums

### `paymentType`
```
"credit" | "debit"
```
Just direction. **NOT** payment method (check, ACH, etc.). Method-like detail lives in `description` / `source` strings on the payment, or as external IDs (`qboId`, `stripeId`, `plaidTransactionId`, `evoKey`).

**Plan §4.2 fix:** `jt_document_write` `createPayment.type` should be typed as `"credit" | "debit"`, not the speculative `"check" | "cash" | "credit" | "ach" | "other"`.

### `paymentMethod`
```
"ach" | "card"
```
This is the *accepted* payment methods on a document (Stripe ACH and card payments). Used in `createDocument.paymentMethods[]` and `updateDocument.paymentMethods[]`. NOT the same as `paymentType`.

### `documentType`
```
"bidRequest" | "customerInvoice" | "customerOrder" | "vendorBill" | "vendorOrder"
```
Matches plan §3.3.

### `documentStatus`
```
"draft" | "pending" | "approved" | "denied"
```
Matches plan §4.2.

### `qboDocumentType`
```
"bill" | "creditCardCredit" | "creditMemo" | "invoice"
| "purchase" | "refundReceipt" | "vendorCredit"
```
Used on `createDocument.qboDocumentType`. Plan §4.2 didn't specify values.

### `accountType`
```
"customer" | "vendor"
```
Used inside `assignee.user.accountType`.

### `aceTargetType` (for `createAce` → "grantAccess" op)
```
"comment" | "dailyLog" | "file" | "fileTag"
| "document" | "job" | "location" | "account"
```
Plan §4.2 said `targetType: string` — type it strictly.

### `eventType` (for `createWebhook`)
40 values (plan §3.4 said 38 — minor count error):
```
accountCreated, accountDeleted, accountUpdated,
commentCreated, commentDeleted, commentUpdated,
contactCreated, contactDeleted, contactUpdated,
dailyLogCreated, dailyLogDeleted, dailyLogUpdated,
documentCreated, documentDeleted,
documentPaymentCreated, documentPaymentDeleted, documentPaymentUpdated,
documentRecipientCreated, documentRecipientDeleted, documentRecipientUpdated,
documentSent, documentUpdated,
fileCreated, fileUpdated, fileDeleted,
jobCreated, jobDeleted, jobUpdated,
locationCreated, locationDeleted, locationUpdated,
paymentCreated, paymentDeleted, paymentUpdated,
taskCreated, taskDeleted, taskUpdated,
timeEntryCreated, timeEntryDeleted, timeEntryUpdated
```
`createWebhook.eventTypes` max length: 40.

---

## 2. Polymorphic input shapes

### `assignee` (used in createAce, createDocumentRecipient, createSelectionAssignment)

Discriminated by Pave's `_type` convention. Three variants:

```typescript
type Assignee =
  | { _type: "role"; roleId: string }
  | { _type: "membership"; membershipId: string }
  | { _type: "user"; name: string; emailAddress: string;
      phoneNumber?: string; accountType?: "customer" | "vendor" }
```

Note: `user` variant **creates a new account/contact inline** if no membership exists yet. For internal team members always use `membership`. For granting access to external customers, `user` lets you create the contact in one call.

### `documentReference` (used in createDocumentReference and createDocument.references[])

```typescript
type DocumentReference = { _type: "document" | "timeEntry"; id: string }
```

Plan §4.2 wrote `{type, id}` — actual key is `_type`.

### `lineItems` discriminator (createDocument, updateDocument)

The `lineItems` array is a discriminated union of **4 variants**, max 1500 items:

| `_type` | Purpose |
|---------|---------|
| `existingCostGroup` | Reference an existing cost group (specify `id`) |
| `existingCostItem` | Reference an existing cost item (specify `id`) |
| `newCostGroup` | Inline-create a new cost group on this document |
| `newCostItem` | Inline-create a new cost item on this document |

Each variant has its own large field set (cost code, cost type, formulas, files, custom field values, selection flags, etc.). The redesign should expose this as a typed union — don't flatten.

---

## 3. createDocument — full input (use as truth for `jt_document_write`)

The plan §4.2 covered roughly half the fields. Verified additions:

| Field | Type | Notes |
|---|---|---|
| `accountId` | nullable jobtreadId | optional account link |
| `allowanceCostItemId` | nullable jobtreadId | when doc represents an allowance |
| `coverPagePhoto` | nullable union (storageId / file / uploadRequest) | image upload |
| `descriptionPdf` | nullable union | PDF embed for description |
| `footerPdf` | nullable union | PDF embed for footer |
| `groupsStartCollapsed` | bool, default false | UI default |
| `isPaymentApplication` | bool, default false | AIA-style payment app |
| `isSimpleSelection` | bool, default false | for selection docs |
| `nonRecoverableTax` / `nonRecoverableTaxName` | nullable | non-recoverable tax |
| `profitBreakdown` | array of `{ name, percentage }`, max 10 | profit allocation |
| `qboClassId`, `qboTaxCodeId`, `qboIsBillable` | nullable strings/bool | QBO mapping |
| `showCostItemFiles`, `showFinancing` | bool | UI toggles |
| `showLinesAtDepth` | nullable int, gte -1 | depth limit |
| `showQboInvoiceLink` | nullable bool | QBO link toggle |
| `subject` | nullable string, max 128 | email subject |
| `taskId` | nullable jobtreadId | links to a task milestone |
| `toOrganizationName` / `fromOrganizationName` | nullable | display names |
| `jobLocationName` / `jobLocationAddress` / `jobArea` | nullable | location fields |
| `externalId` | nullable string, max 32 | for sync mapping |
| `emailMessage` | nullable string, max 10000 | email body |
| `paymentMethods` | nullable arrayOf paymentMethod | accepted methods |
| `references` | array of `documentReference`, max 1000 | linked docs/time entries |
| `scheduledDocuments` | array, max 20 | future docs to auto-create |

**Required fields:** `jobId`, `name`, `type`, `fromName`, `toName`, `taxRate`.

`taxRate` is `number` between 0 and 1 (NOT a percentage like 7.5 — pass 0.075).

`name` and `subject` max 128 chars. `description` max 32768. `footer` max 65536. `emailMessage` max 10000.

**`updateDocument` adds:** `id` (required), `notify` (default true), `signaturePath`, `closeMessage`, `status`. All fields are optional. Removes `jobId`, `type`, `fromName`, `toName`, `taxRate` from required (those are immutable).

---

## 4. createDocumentTemplate — required fields

Differences from createDocument:

- `organizationId` **required** (instead of `jobId`)
- `templateName` **required** (string, max 128)
- `name` **required** (the *document* name when instantiated, max 128)
- `type` **required** (documentType)
- `dueDays` **required** (int, gte 0) — instead of `dueDate` / `dueDays` being optional
- `requireSignature` **required** (bool)
- `showProfit` **required** (bool)
- No `lineItems` field — templates don't carry line items
- No `accountId`, `taskId`, `jobLocation*`, `toAddress` — those are per-doc
- Has `fileIds` (arrayOf jobtreadId, max 10) — attach existing files
- `scheduledDocuments` items don't have `taskId` (templates can't reference jobs)

---

## 5. Selection assignments

### `createSelectionAssignment`
```typescript
{
  jobId: string,            // required
  assignee: Assignee,       // required (role/membership/user variant)
  isDocumentRecipient: boolean,  // required
  requireSignature: boolean      // required
}
```

### `updateSelectionAssignment`
```typescript
{
  id: string,                       // required
  isDocumentRecipient?: boolean,
  requireSignature?: boolean
}
```

Plan §4.2 wrote `assignSelection { costItemId, assignee }` — actual API takes `jobId`, not `costItemId`. Selections are per-job, not per-cost-item. **Plan needs correction.**

---

## 6. updateFile

```typescript
{
  id: string,                        // required
  name?: string,                     // collapseSpace (auto-trim)
  folder?: string | null,
  description?: string | null,
  fileTagIds?: string[],             // max 10
  annotatedUploadRequestId?: string | null  // for PDF annotation diffs
}
```

`fileTagIds` max 10 per file. `annotatedUploadRequestId` accepts annotations from a separate upload request — useful when annotating a PDF without re-uploading the source.

## 7. updateFileTag

```typescript
{
  id: string,                       // required
  name?: string,                    // max 25, collapseSpace
  description?: string | null,      // max 256
  color?: Color                     // typed color
}
```

Plan §4.2 listed only `name` for `updateFileTag` — actual API supports `description` and `color` too.

---

## 8. Plans (createPlan / updatePlan)

### `createPlan`
```typescript
{
  jobId: string,         // required
  fileId: string,        // required
  name: string,          // required
  page: int (gte 1),     // required — 1-indexed PDF page
  scale?: number (gt 0)  // nullable
}
```

### `updatePlan`
```typescript
{
  id: string,               // required
  fileId?: string,
  name?: string,
  page?: int (gte 1),
  scale?: number (gt 0),
  annotations?: Annotation[]  // max 1000
}

// Annotation is a discriminated union:
type Annotation =
  | { type: "path"; page; id; isNegative; strokeWidth; strokeColor;
      fillColor; fillOpacity; isClosed; points }
  | { type: "text"; page; id; text; fontSize; fontColor; fillColor;
      fillOpacity; fontWeight; fontStyle; x; y; rotation; elbow; targets }
  | { type: "point"; page; id; x; y; strokeColor; fillColor; strokeWidth }
  | { type: "meta"; page; id; width; height; rotation }
```

Plan §4.2 said `updatePlan { name, scale }` — actual API also accepts `fileId`, `page`, and rich `annotations` array. The redesign should expose annotations as a first-class capability since this enables AI-driven plan markup.

---

## 9. PDF generation (`pdf` root)

6 PDF generators, each with its own option set. Output is `nullable uploadRequest` (returns `null` if `download: false`, otherwise queues download).

| `id` | Required options | Optional options |
|---|---|---|
| `budget` | `jobId` | `dataViewId`, `expandedKeys`, `searchQuery` |
| `dailyLogs` | (one of) `jobId` / `organizationId` | `startDate`, `endDate`, `userId`, `view` |
| `document` | `id` (the document ID) | — |
| `selections` | `jobId` | — |
| `specifications` | `jobId` | `asQrCodes`, `dataViewOptionsB64`, `searchQuery` |
| `tasks` | (one of) `jobId` / `organizationId` / `accountId` / `dataViewId` | `calendarDate`, `collapsedTaskIds`, `openJobIds`, `scale`, `searchQuery`, `showCriticalPath`, `showDetails`, `showNonWorkingDays`, `showBaselineDatesAndTimes`, `sortId`, `sortOrder` |

All accept `download: boolean` (default false).

**Plan §4.2 fix:** the `tasks` PDF accepts WAY more options than listed. Expose them all.

---

## 10. Webhook subscriptions

### `createWebhook`
```typescript
{
  organizationId: string,            // required
  url: string (URL-typed),           // required
  eventTypes: EventType[]            // max 40, default []
}
```

Note: `eventTypes` is REQUIRED in practice (an empty array means "no events"). Default is `[]` but a webhook with zero events is functionally useless — handler should error if empty.

---

## 11. Other peripheral mutations

### `notifyTaskAssignees`
```typescript
{
  jobId: string,                    // required — NOT taskId!
  membershipIds: string[]           // required
}
```
**Plan §4.2 fix:** `jt_task_write notify` op was specified as `{ taskId, membershipIds }` — actual API takes `jobId`, not `taskId`. Notifies all assignees on a job for the given memberships. Updated op shape:
```typescript
{ op: "notify", jobId: string, membershipIds: string[] }
```

### `sendDocument`
```typescript
{
  documentRecipientId: string,                      // required
  emailMessage?: string (max 10000) | null
}
```
Plan §4.2 was correct.

### `createDocumentRecipient`
```typescript
{
  documentId: string,           // required
  assignee: Assignee,           // required
  requireSignature?: boolean    // default false
}
```
Plan §4.2 was correct.

### `createDocumentReference`
```typescript
{
  documentId: string,                                // required
  reference: { _type: "document" | "timeEntry"; id: string }
}
```

### `createTasksFromBudget`
```typescript
{
  jobId: string                  // just jobId — Pave figures out the rest
}
```
Plan §3.2 #23 was correct.

### `signQuery`
```typescript
{
  query: Query                   // a Pave query object
}
// Returns: signed-token string (no max length)
```
Returns a token that can later execute the same query against the same grant. Plan §4.4 was correct — useful for time-limited shareable links.

### `createPayment`
```typescript
{
  organizationId: string,                            // required
  amount: number (gt 0, 2 decimal places),           // required
  paidAt: datetime,                                  // required
  type: "credit" | "debit",                          // required
  accountId?: string | null,
  description?: string | null,
  externalId?: string (max 128) | null,
  source?: string (max 100) | null,
  attemptAutoMatch?: boolean (default false)
}
```
**Plan §4.2 fix:** missing `attemptAutoMatch` (auto-link to outstanding doc) and `externalId` (for sync mapping). Both are useful.

### `createDocumentPayment` ("linkPayment" op)
```typescript
{
  paymentId: string,             // required
  documentId: string,            // required
  amount: number (gt 0, 2 places), // required
  isLinkedToQbo?: boolean        // default false
}
```
Plan §4.2 missed `isLinkedToQbo` flag.

---

## 12. Plan corrections summary

The probes surfaced these concrete corrections to apply to `mcp-redesign.md` before coding:

| § | Tool / op | Correction |
|---|-----------|------------|
| §3.4 | webhook event types | 40 values, not 38 |
| §4.2 | `jt_document_write createPayment.type` | `"credit" \| "debit"` (not `"check" \| "cash" \| "credit" \| "ach" \| "other"`) |
| §4.2 | `jt_document_write createPayment` | add `attemptAutoMatch`, `externalId` |
| §4.2 | `jt_document_write linkPayment` | add `isLinkedToQbo` |
| §4.2 | `jt_document_write` reference | key is `_type`, not `type` |
| §4.2 | `jt_document_write createDocument` | many missing optional fields (see §3 above) |
| §4.2 | `jt_document_write createTemplate` | tighter required-field spec (templateName, type, dueDays, requireSignature, showProfit are all required) |
| §4.2 | `jt_task_write notify` | takes `jobId` not `taskId` |
| §4.2 | `jt_budget_write assignSelection` | takes `jobId` not `costItemId` |
| §4.2 | `jt_files updatePlan` | also accepts `fileId`, `page`, and `annotations[]` |
| §4.2 | `jt_files updateFileTag` | also accepts `description`, `color` |
| §4.4 | `jt_files generatePdf` `tasks` | many missing options |
| §4.2 | `jt_contact_write grantAccess.targetType` | strict enum (8 values), not loose `string` |
| §4.2 | `jt_contact_write grantAccess.assignee` | discriminator is `_type` (role/membership/user), and `user` variant inline-creates contact |
| §10.6 | tier `blockedOps` for delete | `deleteAce` should be in `revokeAccess` synonym set; `deleteWebhook` already covered |

These are mechanical edits — the architecture is sound. Apply them as part of the Wave 1 query-builder PR (or as a docs-only commit first).

---

## 13. Out-of-scope confirmations

The following were probed but **left for `jt_raw_query`** per plan §3.1:

- `createRole` / `updateRole` / `deleteRole` (admin)
- `createMembership` / `updateMembership` (admin)
- `createCustomField` / `updateCustomField` / `deleteCustomField` (admin)

`createWebForm` / `updateWebForm` etc. deferred to Wave 3 sandbox.

---

## 14. What's still unprobed

- Exact field shape on `commentFile` / `updateCommentFile` (§3.2 #25)
- `pdf.tasks.options` field types (probed names only, not types)
- `pdf.budget.options.expandedKeys` shape
- `dailyLogs.options.view` enum values
- `coverPageTemplate` enum or free string
- `signaturePath` "path" type definition
- `color` type (used in updateFileTag)
- Org-level area templates (Pave only has per-job `updateJobArea`/`deleteJobArea` — no org-level area definitions found)

---

## 15. Wave 2 Schema Probes (2026-04-15, second pass)

Probed via Official JobTread MCP schema introspection for Wave 2 write tools.

### Delete mutations — special params

Most delete mutations take just `{ id }`. Three have extra params:

```typescript
// deleteComment — can preserve child comments (threading)
{ id: string, preserveChildren?: boolean }  // default false

// deleteCostCode — can merge items to another code before deleting
{ id: string, mergeWithCostCodeId?: string }

// deleteCostType — same merge pattern
{ id: string, mergeWithCostTypeId?: string }
```

All other deletes (`deleteJob`, `deleteTask`, `deleteCostItem`, `deleteCostGroup`,
`deleteDocument`, `deletePayment`, `deleteDocumentPayment`, `deleteDocumentRecipient`,
`deleteDocumentReference`, `deleteDocumentTemplate`, `deleteDailyLog`, `deleteTimeEntry`,
`deleteAccount`, `deleteContact`, `deleteAce`, `deleteSelectionAssignment`,
`deleteDashboard`, `deleteDataView`, `deleteWorkflow`, `deleteUnit`, `deleteFile`,
`deleteFileTag`, `deletePlan`) take only `{ id }`.

### Catalog CRUD

#### `createCostCode`
```typescript
{
  organizationId: string,           // required
  name: string (max 128),           // required
  number?: string (max 16) | null,  // e.g. "02.10"
  parentCostCodeId?: string | null  // supports hierarchy
}
```

#### `updateCostCode`
```typescript
{
  id: string,                       // required
  name?: string (max 128),
  number?: string (max 16) | null,
  parentCostCodeId?: string | null,
  isActive?: boolean,               // soft-delete toggle
  qboId?: string | null             // QuickBooks integration
}
```

#### `deleteCostCode`
```typescript
{
  id: string,
  mergeWithCostCodeId?: string      // reassign items before deleting
}
```

#### `createCostType`
```typescript
{
  organizationId: string,           // required
  name: string (max 64),            // required
  isTaxable: boolean,               // required
  isTimeTrackable: boolean,         // required
  margin?: number (< 1) | null      // fraction, e.g. 0.27 for 27%
}
```

#### `updateCostType`
```typescript
{
  id: string,
  name?: string (max 64),
  isTaxable?: boolean,
  isTimeTrackable?: boolean,
  margin?: number (< 1) | null,
  isActive?: boolean                // soft-delete toggle
}
```

#### `deleteCostType`
```typescript
{
  id: string,
  mergeWithCostTypeId?: string      // reassign items before deleting
}
```

#### `createUnit`
```typescript
{
  organizationId: string,           // required
  name: string (max 32)             // required
}
```

#### `updateUnit`
```typescript
{
  id: string,
  name?: string (max 32),
  isActive?: boolean                // soft-delete toggle
}
```

#### `deleteUnit`
```typescript
{ id: string }
```

**Pattern:** All catalog entities support `isActive` on update for soft-delete. Cost codes
and cost types support `mergeWith*Id` on delete to reassign items before removal.

### Job area management

#### `updateJobArea` (rename)
```typescript
{
  jobId: string,                    // required
  previousJobArea: string,          // current name (required)
  nextJobArea: string               // new name (required)
}
```
Note: this is a RENAME operation, not an update-by-id. Areas are identified by name string, not by ID.

#### `deleteJobArea`
```typescript
{
  jobId: string,                    // required
  jobArea: string,                  // area name to delete (required)
  replacementJobArea?: string | null // move items in this area to another area
}
```
If `replacementJobArea` is provided, items in the deleted area are reassigned.
If null/omitted, items in the area become area-less.

**No org-level area templates found.** Pave only has per-job area management. Areas are
created implicitly when referenced in `updateJob.areas[]` or on cost items' `jobArea` field.

Probe these during Wave 2 when building `jt_document_write` and `jt_files`.
