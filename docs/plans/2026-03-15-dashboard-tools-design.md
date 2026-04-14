# Dashboard MCP Tools — Design Document

**Date:** 2026-03-15
**Status:** Approved

## Overview

Add dashboard CRUD tools to the MCP server so AIs can create, update, and delete JobTread dashboards programmatically. Includes 7 predefined templates following dashboard design best practices (F-pattern layout, 5-9 tiles, KPIs top row, tables below).

## Pave API Reference

### Mutations
- `createDashboard({ organizationId, name, type, visibleToRoleIds, tiles })` → `createdDashboard { id, name, type }`
- `updateDashboard({ id, name, tiles, visibleToRoleIds })` → no return fields
- `deleteDashboard({ id })` → no return fields

### Key Gotchas
- `updateDashboard` with `tiles` **replaces ALL existing tiles** (not additive)
- `where` in tile options cannot be `null` — use a truthy filter like `{"!=": [{"field": ["id"]}, {"value": null}]}` as "match all"
- `targetType` uses `customer`/`vendor` (NOT `account`)
- `visibleToRoleIds` is required on create — query `organization.roles` to resolve
- `type` is always `"organization"`
- No individual tile CRUD — tiles managed as full array on dashboard

### Tile Types
- `actionItems` — user's action items widget (no config needed)
- `text` — markdown content (`options.content`)
- `dataView` — table with `fields`, `where`, `sortBy`, `groupBy`, `targetType`, `primaryFieldCount`
- `custom` — chart with `agg`, `fieldId`, `chartType`, `where`, `groupBy`, `targetType`

### Chart Types
`singleValue`, `pie`, `bar`

### Target Types
`costItem`, `costGroup`, `customer`, `vendor`, `dailyLog`, `document`, `event`, `job`, `jobBudget`, `location`, `membership`, `organization`, `payment`, `task`, `timeEntry`, `user`, `visitor`

## Tool Designs

### Tool 1: `jobtread_create_dashboard`

**Description:** Create a dashboard from a template or custom tiles. Templates follow best-practice layouts (KPIs top, tables below, 5-9 tiles). Users can resize/move tiles after creation.

**Schema:**
```
name (string, required) — Dashboard name
template (enum, optional) — One of 7 predefined templates
tiles (array, optional) — Custom tile configs (overrides template)
visibleTo (string, optional) — "all" (default), "internal", or comma-separated role names
```

**Behavior:**
1. If neither `template` nor `tiles` provided → error
2. Resolve `organizationId` from `ctx.orgId`
3. Query org roles, map `visibleTo` to role IDs:
   - `"all"` → all role IDs
   - `"internal"` → exclude Customer, Vendor roles
   - Specific names → match by name
4. Generate tiles from template map or use raw tiles
5. Call `createDashboard` mutation
6. Return dashboard ID, name, tile count

### Tool 2: `jobtread_update_dashboard`

**Description:** Modify an existing dashboard — rename, add/remove tiles, or replace all tiles. Handles the "tiles replace all" behavior automatically.

**Schema:**
```
dashboardId (string, required) — Dashboard ID
name (string, optional) — New name
addTiles (array, optional) — Tiles to append (auto-positioned at next available row)
removeTileIds (array of string, optional) — Tile IDs to remove
tiles (array, optional) — Full replacement (overrides add/remove)
```

**Behavior:**
1. If `addTiles` or `removeTileIds`: fetch existing dashboard first
2. For `addTiles`: calculate `y` = max existing tile bottom + 1, append
3. For `removeTileIds`: filter out matching tile IDs
4. For `tiles`: use directly as full replacement
5. Call `updateDashboard` with merged result
6. Return updated tile count

### Tool 3: `jobtread_delete_dashboard`

**Description:** Delete a dashboard.

**Schema:**
```
dashboardId (string, required) — Dashboard ID
```

## Template Definitions

All templates follow F-pattern layout:
- **Row 0-1:** KPI singleValue tiles (small, 1-2 height)
- **Row 1-2:** Charts (pie, bar) (medium, 2-3 height)
- **Row 2+:** Data tables (large, 3-5 height)

Grid is 9 columns wide (matching JobTread's grid).

### 1. `project-overview`
| Tile | Type | Position | Config |
|------|------|----------|--------|
| Action Items | actionItems | 0,0 2x2 | — |
| Open Jobs | custom/singleValue | 2,0 2x1 | job, closedOn=null, count |
| Total Contract Value | custom/singleValue | 4,0 2x1 | job, closedOn=null, sum approvedOrdersWithTax |
| Active Jobs | dataView | 2,1 4x4 | job table: name, number, status |
| Resources | text | 0,2 2x3 | Quick links markdown |

### 2. `accounts-payable`
| Tile | Type | Position | Config |
|------|------|----------|--------|
| Open Bills Count | custom/singleValue | 0,0 2x1 | document, type=vendorBill, status=pending, count |
| Total AP (by vendor) | custom/pie | 2,0 3x3 | document, type=vendorBill, status=pending, sum price, groupBy accountName |
| AP by Month | custom/bar | 5,0 4x3 | document, type=vendorBill, status=pending, sum amount, groupBy dueDate YYYY MM |
| Current $ | custom/singleValue | 0,1 1x1 | vendorBill, pending, dueDate in next 30d, sum price |
| 1-30 Past Due $ | custom/singleValue | 1,1 1x1 | vendorBill, pending, dueDate 1-30 days ago, sum price |
| 31-60 Past Due $ | custom/singleValue | 0,2 1x1 | vendorBill, pending, dueDate 31-60 days ago, sum price |
| Open Vendor Bills | dataView | 0,3 9x4 | document table: vendor, fullName, balance, issueDate |

### 3. `accounts-receivable`
| Tile | Type | Position | Config |
|------|------|----------|--------|
| Open Invoices Count | custom/singleValue | 0,0 2x1 | document, type=customerInvoice, status=pending, count |
| Total AR (by customer) | custom/pie | 2,0 3x3 | document, type=customerInvoice, status=pending, sum price, groupBy accountName |
| AR by Month | custom/bar | 5,0 4x3 | document, type=customerInvoice, status=pending, sum amount, groupBy dueDate YYYY MM |
| Current $ | custom/singleValue | 0,1 1x1 | customerInvoice, pending, dueDate in next 30d, sum price |
| 1-30 Past Due $ | custom/singleValue | 1,1 1x1 | customerInvoice, pending, dueDate 1-30 days ago, sum price |
| 31-60 Past Due $ | custom/singleValue | 0,2 1x1 | customerInvoice, pending, dueDate 31-60 days ago, sum price |
| Open Invoices | dataView | 0,3 9x4 | document table: customer, fullName, balance, dueDate |

### 4. `schedule-overview`
| Tile | Type | Position | Config |
|------|------|----------|--------|
| Incomplete Tasks | custom/singleValue | 0,0 2x1 | task, completed=0, isToDo=false, count |
| Overdue Tasks | custom/singleValue | 2,0 2x1 | task, completed=0, endDate before today, count |
| Tasks by Assignee | custom/bar | 4,0 5x3 | task, completed=0, count, groupBy assignee name |
| Upcoming Tasks | dataView | 0,1 4x4 | task table: name, startDate, endDate, job name |

### 5. `field-kpis`
| Tile | Type | Position | Config |
|------|------|----------|--------|
| Daily Logs This Month | custom/singleValue | 0,0 2x1 | dailyLog, createdAt this month, count |
| Time Entries This Week | custom/singleValue | 2,0 2x1 | timeEntry, startedAt this week, count |
| Daily Logs by User | dataView | 0,1 4x5 | dailyLog table: date, grouped by user name and month |
| Time Entries by User | custom/bar | 4,0 5x3 | timeEntry, count, groupBy user name |

### 6. `sales-tracking`
| Tile | Type | Position | Config |
|------|------|----------|--------|
| New Jobs This Month | custom/singleValue | 0,0 2x1 | job, createdAt this month, count |
| Pipeline Value | custom/singleValue | 2,0 2x1 | job, closedOn=null, sum approvedOrdersWithTax |
| Jobs by Status | custom/pie | 4,0 3x3 | job, closedOn=null, count, groupBy status |
| Estimates by Month | custom/bar | 7,0 2x3 | document, type=customerOrder, sum price, groupBy createdAt YYYY MM |
| Recent Estimates | dataView | 0,1 4x4 | document table: type=customerOrder, account, fullName, price, status |
| New Jobs Table | dataView | 0,5 9x3 | job table: name, number, status, createdAt, sorted by createdAt desc |

### 7. `vendor-tracking`
| Tile | Type | Position | Config |
|------|------|----------|--------|
| Total Vendors | custom/singleValue | 0,0 2x1 | vendor, count |
| Open POs | custom/singleValue | 2,0 2x1 | document, type=vendorOrder, status=pending, count |
| Open PO Value | custom/singleValue | 4,0 2x1 | document, type=vendorOrder, status=pending, sum price |
| Bills by Status | custom/bar | 6,0 3x3 | document, type=vendorBill, count, groupBy status |
| Vendor Bills Table | dataView | 0,1 6x4 | document table: type=vendorBill, vendor, fullName, balance, status |
| New Vendors This Month | dataView | 0,5 9x3 | vendor table: name, createdAt this month |

## Implementation Plan

1. Add template definitions as a `DASHBOARD_TEMPLATES` map in tools.js
2. Add helper: `resolveOrgRoles(ctx, visibleTo)` to map role names → IDs
3. Add helper: `autoPositionTiles(existingTiles, newTiles)` for update tool
4. Implement 3 handlers: `handleCreateDashboard`, `handleUpdateDashboard`, `handleDeleteDashboard`
5. Register in `TOOL_DEFINITIONS`
6. Deploy and test each template on JT Power Tools test account
7. Update CHANGELOG

## Dashboard Design Principles Applied

- **F-pattern layout:** KPIs in top-left, details flow right and down
- **5-9 tiles per dashboard:** All templates stay within this range
- **KPI cards compact:** singleValue tiles are 2x1 (small, top row)
- **Charts mid-level:** pie/bar at 3x3, placed beside KPIs
- **Tables large:** dataView tiles span 4-9 columns, placed below
- **Whitespace:** Gaps between tile groups for visual breathing room
