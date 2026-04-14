# DataView MCP Tools — Design Document

**Date**: 2026-04-05
**Status**: Approved
**Scope**: Add 5 new MCP tools for managing JobTread DataViews (saved views)

## Background

JobTread's Data Browser supports saved views with custom filters, field selection, sorting, grouping, and list/kanban modes. Views can be personal or org-wide. The Pave API exposes `dataView` as a first-class entity with full CRUD support, though this is undocumented.

### API Discovery Summary

**Entity**: `dataView`
**Readable fields**: `id`, `name`, `type`, `fields`, `options`, `createdAt`, `organization` (connection)
**Mutations**: `createDataView`, `updateDataView`, `deleteDataView` (delete blocked by our safety rule)

**Visibility control**: `userId: null` on create/update = org-wide view. Omitting `userId` = personal view (assigned to authenticated user).

**Supported types** (from schema introspection):
`costItem`, `costGroup`, `customer`, `dailyLog`, `document`, `event`, `job`, `jobBudget`, `location`, `membership`, `organization`, `payment`, `task`, `timeEntry`, `user`, `vendor`, `visitor`

**`options` structure**:
```json
{
  "view": "list" | "kanban",
  "where": { /* Pave filter AST */ },
  "sortBy": [{ "field": ["fieldName"], "order": "asc" | "desc" }],
  "groupBy": [{ "customFieldId": "ID" }],
  "primaryFieldCount": 3
}
```

**`fields` structure** — array of `{ path: [...] }` objects:
- `["node", "fieldName"]` — direct entity field
- `["node", "connection", "fieldName"]` — nested connection field
- `["withValue", "computedName"]` — computed/aggregate field
- `["withValue", "computedName", "metric"]` — computed with sub-metric
- `["withValue", "cfv:ID", "values"]` — custom field value
- `["node", "connection", "nodes", "0", "url"]` — indexed array access

## Design Decisions

1. **Human-friendly field names** — AI passes short names like `"name"`, `"location.name"`, `"projectedCost"`, `"cf:Division"` instead of raw path arrays. Handler maps to Pave paths. Saves tokens on every call.

2. **Simplified filter syntax** — `[["closedOn", "=", null]]` instead of Pave AST. Handler converts to `{"=": [{"field": [...]}, {"value": ...}]}`.

3. **Dynamic field discovery tool** — `list_data_view_fields` returns available fields per type, including org-specific custom fields. Critical for the AI to know what columns are available.

4. **Org-wide by default** — Views created with `userId: null` so the whole team sees them. Optional `personal: true` to override.

5. **All 17 entity types supported** — No artificial limits on which types can have views.

## Tool Specifications

### Tool 1: `jobtread_list_data_views`

**Description**: List all saved views in the organization. Shows name, type, view mode, and ID.
**Annotations**: `readOnlyHint: true, openWorldHint: true`
**REST path**: `/api/data-views/list`

**Input schema**:
```
type (optional, enum) — Filter by entity type
```

**Handler** (`handleListDataViews`):
1. Query `organization.dataViews.nodes` with `id, name, type, options, createdAt`
2. If `type` provided, filter client-side
3. Extract `options.view` as `viewMode` for cleaner output
4. Return `{ views: [{ id, name, type, viewMode, createdAt }], count }`

---

### Tool 2: `jobtread_get_data_view`

**Description**: Get full configuration of a saved view including fields, filters, sorting, and grouping.
**Annotations**: `readOnlyHint: true, openWorldHint: true`
**REST path**: `/api/data-views/get`

**Input schema**:
```
dataViewId (string, required) — View ID
```

**Handler** (`handleGetDataView`):
1. Query `dataView` by ID with all fields
2. Reverse-map field paths to human-readable names where possible
3. Return full config: `{ id, name, type, viewMode, fields, options, createdAt }`

---

### Tool 3: `jobtread_list_data_view_fields`

**Description**: Discover available fields for a given entity type. Use before creating/updating views to know what columns are available. Returns both built-in fields and org-specific custom fields.
**Annotations**: `readOnlyHint: true, openWorldHint: true`
**REST path**: `/api/data-views/fields`

**Input schema**:
```
type (string, required, enum) — Entity type
```

**Handler** (`handleListDataViewFields`):
1. Look up static field registry for the given type
2. Query org custom fields filtered by `targetType` matching the view type
3. Map custom fields to `cf:FieldName` format with `["withValue", "cfv:ID", "values"]` paths
4. Return merged list: `{ type, fields: [{ name, path, description }] }`

**Static field registries** (built from observed Titus views + entity knowledge):

**Job fields**:
| Name | Path | Description |
|------|------|-------------|
| `name` | `["node","name"]` | Job name |
| `number` | `["node","number"]` | Job number |
| `description` | `["node","description"]` | Job description |
| `closedOn` | `["node","closedOn"]` | Date closed |
| `createdAt` | `["node","createdAt"]` | Date created |
| `scheduleIsPublished` | `["node","scheduleIsPublished"]` | Schedule published? |
| `location.name` | `["node","location","name"]` | Location name |
| `location.address` | `["node","location","address"]` | Location address |
| `location.account.name` | `["node","location","account","name"]` | Customer/account name |
| `projectedCost` | `["withValue","projectedCost"]` | Projected cost |
| `actualCost` | `["withValue","actualCost"]` | Actual cost |
| `budgetedCost` | `["withValue","budgetedCost"]` | Budgeted cost |
| `budgetVariance` | `["withValue","budgetVariance"]` | Budget variance |
| `projectedPrice` | `["withValue","projectedPrice"]` | Projected price |
| `projectedProfit` | `["withValue","projectedProfit"]` | Projected profit |
| `projectedMargin` | `["withValue","projectedMargin"]` | Projected margin % |
| `percentComplete` | `["withValue","percentComplete"]` | % complete |
| `earnedRevenue` | `["withValue","earnedRevenue"]` | Earned revenue |
| `costToComplete` | `["withValue","costToComplete"]` | Cost to complete |
| `taskDays` | `["withValue","taskDays"]` | Task days |
| `projectedProfitPerTaskDay` | `["withValue","projectedProfitPerTaskDay"]` | Profit per task day |
| `approvedCustomerOrders.price` | `["withValue","approvedCustomerOrders","price"]` | Approved orders $ |
| `approvedCustomerOrders.priceWithTaxSum` | `["withValue","approvedCustomerOrders","priceWithTaxSum"]` | Approved orders $ (w/ tax) |
| `approvedCustomerInvoices.price` | `["withValue","approvedCustomerInvoices","price"]` | Approved invoices $ |
| `approvedCustomerInvoices.sum` | `["withValue","approvedCustomerInvoices","sum"]` | Approved invoices sum |
| `pendingCustomerOrders.sum` | `["withValue","pendingCustomerOrders","sum"]` | Pending orders $ |
| `pendingCustomerInvoices.sum` | `["withValue","pendingCustomerInvoices","sum"]` | Pending invoices $ |
| `invoiced.price` | `["withValue","invoiced","price"]` | Invoiced amount |
| `overInvoiced` | `["withValue","overInvoiced"]` | Over-invoiced amount |
| `underInvoiced` | `["withValue","underInvoiced"]` | Under-invoiced amount |
| `earliestScheduledIncompleteTask.name` | `["withValue","earliestScheduledIncompleteTask","name"]` | Next incomplete task |
| `latestCompletedTask.name` | `["withValue","latestCompletedTask","name"]` | Last completed task |

**Customer fields**:
| Name | Path | Description |
|------|------|-------------|
| `name` | `["node","name"]` | Customer name |
| `createdAt` | `["node","createdAt"]` | Date created |
| `archivedAt` | `["node","archivedAt"]` | Date archived |
| `primaryContact.name` | `["node","primaryContact","name"]` | Primary contact name |
| `primaryLocation.name` | `["node","primaryLocation","name"]` | Primary location name |
| `activeCustomerJobs.count` | `["withValue","activeCustomerJobs","count"]` | Active jobs count |
| `closedCustomerJobs.count` | `["withValue","closedCustomerJobs","count"]` | Closed jobs count |
| `pendingCustomerOrders.sum` | `["withValue","pendingCustomerOrders","sum"]` | Pending orders $ |
| `approvedCustomerOrders.sum` | `["withValue","approvedCustomerOrders","sum"]` | Approved orders $ |
| `openCustomerInvoices.sum` | `["withValue","openCustomerInvoices","sum"]` | Open invoices $ |
| `approvedCustomerInvoices.sum` | `["withValue","approvedCustomerInvoices","sum"]` | Approved invoices $ |

**Vendor fields**:
| Name | Path | Description |
|------|------|-------------|
| `name` | `["node","name"]` | Vendor name |
| `createdAt` | `["node","createdAt"]` | Date created |
| `archivedAt` | `["node","archivedAt"]` | Date archived |
| `primaryContact.name` | `["node","primaryContact","name"]` | Primary contact name |
| `primaryLocation.name` | `["node","primaryLocation","name"]` | Primary location name |

**CostItem fields**:
| Name | Path | Description |
|------|------|-------------|
| `image` | `["node","image","nodes","0","url"]` | Item image URL |
| `name` | `["node","name"]` | Item name |
| `description` | `["node","description"]` | Item description |
| `quantity` | `["node","quantity"]` | Quantity |
| `unit.name` | `["node","unit","name"]` | Unit of measure |
| `unitCost` | `["node","unitCost"]` | Unit cost |
| `unitPrice` | `["node","unitPrice"]` | Unit price |
| `costType.name` | `["node","costType","name"]` | Cost type |
| `costCode.name` | `["node","costCode","name"]` | Cost code name |
| `costCode.number` | `["node","costCode","number"]` | Cost code number |
| `createdAt` | `["node","createdAt"]` | Date created |
| `isTaxable` | `["node","isTaxable"]` | Taxable? |
| `isSpecification` | `["node","isSpecification"]` | Is specification? |
| `requireSpecificationApproval` | `["node","requireSpecificationApproval"]` | Requires spec approval? |
| `markup` | `["withValue","markup"]` | Markup % |
| `margin` | `["withValue","margin"]` | Margin % |

**Task, Document, DailyLog, TimeEntry, Payment, Location, Event fields**: Minimal initial registries based on known entity fields from Pave. Can be expanded as users create views with those types and we observe the available `withValue` computed fields.

**Custom field mapping**: For any type, query `organization.customFields` where `targetType` matches, then generate:
- Name: `cf:FieldName` (e.g., `cf:Division`, `cf:Project Type`)
- Path: `["withValue", "cfv:CUSTOM_FIELD_ID", "values"]`
- Description: `Custom: FieldName (fieldType)`

---

### Tool 4: `jobtread_create_data_view`

**Description**: Create a saved view. Call `jobtread_list_data_view_fields` first to discover available fields. Views are created as organization-wide by default.
**Annotations**: `readOnlyHint: false, destructiveHint: false, openWorldHint: true`
**REST path**: `/api/data-views/create`

**Input schema**:
```
name (string, required) — View name (max 128 chars)
type (string, required, enum) — Entity type
fields (array of strings, required, min 1, max 100) — Field names from list_data_view_fields
view (string, optional, default "list") — "list" or "kanban"
where (array, optional) — Filter tuples: [["field", "operator", value], ...]
  Operators: =, !=, >, <, >=, <=, like
  Example: [["closedOn", "=", null], ["projectedPrice", ">", 0]]
sortBy (array, optional) — Sort tuples: [["field", "asc|desc"], ...]
  Example: [["name", "asc"]] or [["createdAt", "desc"]]
groupBy (string, optional) — Custom field name to group by: "cf:Division"
primaryFieldCount (number, optional, default 3) — Pinned left columns
personal (boolean, optional, default false) — true = personal view
positionAfterDataViewId (string, optional) — Position after this view ID
```

**Handler** (`handleCreateDataView`):
1. Resolve field names → Pave path arrays via static registry + custom field lookup
2. Convert `where` tuples → Pave filter AST
3. Convert `sortBy` shorthand → `[{field: [...], order: "..."}]`
4. Convert `groupBy` cf name → `[{customFieldId: "..."}]` via custom field lookup
5. Build options object: `{ view, where, sortBy, groupBy, primaryFieldCount }`
6. Set `userId: null` unless `personal: true`
7. Call `createDataView` mutation
8. Return `{ success: true, dataView: { id, name, type }, visibility: "organization"|"personal" }`

**Filter conversion logic**:
```
Single:  [["closedOn", "=", null]]
  → {"=": [{"field": ["closedOn"]}, {"value": null}]}

Multiple: [["closedOn", "=", null], ["projectedPrice", ">", 0]]
  → {"and": [
      {"=": [{"field": ["closedOn"]}, {"value": null}]},
      {">": [{"field": ["projectedPrice"]}, {"value": 0}]}
    ]}
```

**Sort conversion logic**:
```
[["name", "asc"]]
  → [{"field": ["name"], "order": "asc"}]

[["createdAt", "desc"]]
  → [{"field": ["createdAt"], "order": "desc"}]
```

**GroupBy conversion logic**:
```
"cf:Division"
  → Look up custom field "Division" for this type
  → [{"customFieldId": "22PGZG3BnRsP"}]
```

---

### Tool 5: `jobtread_update_data_view`

**Description**: Update an existing saved view. Only provided fields are changed; omitted fields keep their current values.
**Annotations**: `readOnlyHint: false, destructiveHint: false, openWorldHint: true`
**REST path**: `/api/data-views/update`

**Input schema**:
```
dataViewId (string, required) — View ID
name (string, optional) — New name
fields (array of strings, optional) — Replacement field list
view (string, optional) — "list" or "kanban"
where (array, optional) — Replacement filter tuples (same format as create)
sortBy (array, optional) — Replacement sort
groupBy (string, optional) — Replacement grouping (cf name or null to remove)
primaryFieldCount (number, optional) — Pinned columns
personal (boolean, optional) — Switch visibility
positionAfterDataViewId (string, optional) — Reorder
```

**Handler** (`handleUpdateDataView`):
1. Fetch existing view to get current type (needed for field resolution)
2. If `fields` provided, resolve names → paths
3. If `where`/`sortBy`/`groupBy` provided, convert to Pave format
4. Build update payload merging only changed options
5. Set `userId: null` if `personal: false`, omit userId if `personal: true`
6. Call `updateDataView` mutation
7. Return `{ success: true, dataViewId, updated: [...changed fields] }`

---

## File Changes

**Single file**: `server/mcp-server/src/tools.js`
- Add 5 handler functions before TOOL_DEFINITIONS
- Add static field registries (one object per entity type)
- Add helper functions: `resolveFieldPaths()`, `convertFilterToAst()`, `convertSortBy()`, `resolveGroupBy()`
- Add 5 entries to TOOL_DEFINITIONS array
- Add to large-response tools list if needed (probably not — views are small)

## Gotchas & Edge Cases

1. **Custom field name collisions** — Two custom fields could have the same name but different target types. Resolution: filter by `targetType` matching the view `type`.
2. **Unknown withValue fields** — The static registry won't cover every computed field. If a field name isn't found in the registry or custom fields, return an error with suggestion to use `list_data_view_fields`.
3. **Field max 100** — Pave enforces max 100 fields per view.
4. **Name max 128 chars** — Pave enforces max 128 char view names.
5. **Custom field name with special chars** — Custom field names may contain spaces, parentheses, etc. The `cf:` prefix handles this: `cf:PM Estimated Amount`.
6. **GroupBy only works with custom fields** — The Pave `groupBy` structure requires `customFieldId`. Cannot group by built-in fields.
7. **kanban requires groupBy** — Kanban view mode doesn't make sense without a groupBy field. Handler should warn but not block.
