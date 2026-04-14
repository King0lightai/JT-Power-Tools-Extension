# Dashboard MCP Tools Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add create, update, and delete dashboard tools to the MCP server with 7 predefined templates.

**Architecture:** Three new handler functions + a DASHBOARD_TEMPLATES map + two helpers (role resolution, auto-positioning), all in `server/mcp-server/src/tools.js`. Templates are static tile config arrays. Handlers use `ctx.pave()` for Pave mutations.

**Tech Stack:** Zod schemas, Pave API mutations, existing MCP tool registration pattern.

**Design doc:** `docs/plans/2026-03-15-dashboard-tools-design.md`

---

### Task 1: Add DASHBOARD_TEMPLATES map and helpers

**Files:**
- Modify: `server/mcp-server/src/tools.js` (insert after line 2688, before ADVANCED READ HANDLERS section)

**Step 1: Add the DASHBOARD_TEMPLATES constant and helpers**

Insert after line 2688 (end of `handleUpdateTimeEntry`) and before line 2690 (`// ADVANCED READ HANDLERS`):

```javascript
// ═══════════════════════════════════════════════════════════════════
// DASHBOARD TEMPLATES & HELPERS
// ═══════════════════════════════════════════════════════════════════

// Helper: where filter shortcuts
const W_OPEN = { '=': [{ field: ['closedOn'] }, { value: null }] };
const W_ALL = { '!=': [{ field: ['id'] }, { value: null }] };
function wDocType(type, status) {
  const conds = [{ '=': [{ field: ['type'] }, { value: type }] }];
  if (status) conds.push({ '=': [{ field: ['status'] }, { value: status }] });
  return conds.length === 1 ? conds[0] : { and: conds };
}
function wDateRange(field, startOffset, endOffset) {
  return { between: [{ field: [field] }, [{ date: { fromNow: startOffset } }, { date: { fromNow: endOffset } }]] };
}
function wThisMonth(field) {
  return { between: [{ field: [field] }, [{ datetime: { startOf: 'month' } }, { datetime: { endOf: 'month' } }]] };
}
function wThisWeek(field) {
  return { between: [{ field: [field] }, [{ datetime: { startOf: 'week' } }, { datetime: { endOf: 'week' } }]] };
}

// Helper: resolve visibleTo string to role IDs
async function resolveOrgRoles(ctx, visibleTo) {
  const data = await ctx.pave({
    organization: { $: { id: ctx.orgId }, roles: { nodes: { id: {}, name: {} } } },
  });
  const allRoles = data.organization?.roles?.nodes || [];
  if (!allRoles.length) throw new Error('Could not resolve organization roles');

  if (!visibleTo || visibleTo === 'all') return allRoles.map((r) => r.id);
  if (visibleTo === 'internal') {
    return allRoles.filter((r) => !['Customer', 'Vendor'].includes(r.name)).map((r) => r.id);
  }
  // Comma-separated role names
  const names = visibleTo.split(',').map((n) => n.trim().toLowerCase());
  const matched = allRoles.filter((r) => names.includes(r.name.toLowerCase()));
  if (!matched.length) throw new Error(`No matching roles found for: ${visibleTo}. Available: ${allRoles.map((r) => r.name).join(', ')}`);
  return matched.map((r) => r.id);
}

// Helper: auto-position new tiles below existing ones
function autoPositionTiles(existingTiles, newTiles) {
  let maxBottom = 0;
  for (const t of existingTiles) {
    const bottom = (t.y || 0) + (t.height || 1);
    if (bottom > maxBottom) maxBottom = bottom;
  }
  // Add 1 row gap for visual separation
  const startY = maxBottom > 0 ? maxBottom + 1 : 0;
  return newTiles.map((t, i) => ({ ...t, y: (t.y || 0) + startY }));
}

const DASHBOARD_TEMPLATES = {
  'project-overview': [
    { x: 0, y: 0, width: 2, height: 2, options: { type: 'actionItems' } },
    { x: 2, y: 0, width: 2, height: 1, options: { agg: 'count', name: 'Open Jobs', type: 'custom', where: W_OPEN, chartType: 'singleValue', targetType: 'job' } },
    { x: 4, y: 0, width: 2, height: 1, options: { agg: 'sum', name: 'Total Contract Value', type: 'custom', where: W_OPEN, fieldId: 'approvedOrdersWithTax', chartType: 'singleValue', targetType: 'job' } },
    { x: 2, y: 1, width: 4, height: 4, options: { name: 'Active Jobs', type: 'dataView', where: W_OPEN, fields: [{ name: 'Job', type: 'text', width: 200, formula: '{name}' }, { name: '#', type: 'text', width: 60, formula: '{number}' }, { name: 'Status', type: 'text', width: 100, formula: '{status}' }], sortBy: [{ field: ['createdAt'], order: 'desc' }], groupBy: null, targetType: 'job', primaryFieldCount: 3 } },
    { x: 0, y: 2, width: 2, height: 3, options: { name: 'Resources', type: 'text', content: '# Quick Links\n- [JobTread Help](https://help.jobtread.com)\n\n# Tips\n- Use the schedule to track tasks\n- Add daily logs to document progress' } },
  ],

  'accounts-payable': [
    { x: 0, y: 0, width: 2, height: 1, options: { agg: 'count', name: 'Open Bills', type: 'custom', where: wDocType('vendorBill', 'pending'), chartType: 'singleValue', targetType: 'document' } },
    { x: 2, y: 0, width: 3, height: 3, options: { agg: 'sum', name: 'AP by Vendor', type: 'custom', where: wDocType('vendorBill', 'pending'), fieldId: 'price', groupBy: [{ fieldId: 'account:name' }], chartType: 'pie', targetType: 'document' } },
    { x: 5, y: 0, width: 4, height: 3, options: { agg: 'sum', name: 'AP by Month', type: 'custom', where: wDocType('vendorBill', 'pending'), fieldId: 'amount', groupBy: [{ order: 'desc', fieldId: 'dueDate', datetimeFormat: 'YYYY MM' }], chartType: 'bar', targetType: 'document' } },
    { x: 0, y: 1, width: 1, height: 1, options: { agg: 'sum', name: 'Current $', type: 'custom', where: { and: [wDocType('vendorBill', 'pending'), wDateRange('dueDate', 'P1D', 'P30D')] }, fieldId: 'price', chartType: 'singleValue', targetType: 'document' } },
    { x: 1, y: 1, width: 1, height: 1, options: { agg: 'sum', name: '1-30 Past Due', type: 'custom', where: { and: [wDocType('vendorBill', 'pending'), wDateRange('dueDate', 'P-1D', 'P-29D')] }, fieldId: 'price', chartType: 'singleValue', targetType: 'document' } },
    { x: 0, y: 2, width: 1, height: 1, options: { agg: 'sum', name: '31-60 Past Due', type: 'custom', where: { and: [wDocType('vendorBill', 'pending'), wDateRange('dueDate', 'P-30D', 'P-59D')] }, fieldId: 'price', chartType: 'singleValue', targetType: 'document' } },
    { x: 0, y: 3, width: 9, height: 4, options: { name: 'Open Vendor Bills', type: 'dataView', where: wDocType('vendorBill', 'pending'), fields: [{ name: 'Vendor', type: 'text', width: 150, formula: '{account:name}' }, { name: 'Document', type: 'text', width: 150, formula: '{fullName}' }, { path: ['node', 'balance'] }, { path: ['node', 'issueDate'] }], sortBy: [{ field: ['createdAt'], order: 'desc' }], groupBy: null, targetType: 'document', primaryFieldCount: 3 } },
  ],

  'accounts-receivable': [
    { x: 0, y: 0, width: 2, height: 1, options: { agg: 'count', name: 'Open Invoices', type: 'custom', where: wDocType('customerInvoice', 'pending'), chartType: 'singleValue', targetType: 'document' } },
    { x: 2, y: 0, width: 3, height: 3, options: { agg: 'sum', name: 'AR by Customer', type: 'custom', where: wDocType('customerInvoice', 'pending'), fieldId: 'price', groupBy: [{ fieldId: 'account:name' }], chartType: 'pie', targetType: 'document' } },
    { x: 5, y: 0, width: 4, height: 3, options: { agg: 'sum', name: 'AR by Month', type: 'custom', where: wDocType('customerInvoice', 'pending'), fieldId: 'amount', groupBy: [{ order: 'desc', fieldId: 'dueDate', datetimeFormat: 'YYYY MM' }], chartType: 'bar', targetType: 'document' } },
    { x: 0, y: 1, width: 1, height: 1, options: { agg: 'sum', name: 'Current $', type: 'custom', where: { and: [wDocType('customerInvoice', 'pending'), wDateRange('dueDate', 'P1D', 'P30D')] }, fieldId: 'price', chartType: 'singleValue', targetType: 'document' } },
    { x: 1, y: 1, width: 1, height: 1, options: { agg: 'sum', name: '1-30 Past Due', type: 'custom', where: { and: [wDocType('customerInvoice', 'pending'), wDateRange('dueDate', 'P-1D', 'P-29D')] }, fieldId: 'price', chartType: 'singleValue', targetType: 'document' } },
    { x: 0, y: 2, width: 1, height: 1, options: { agg: 'sum', name: '31-60 Past Due', type: 'custom', where: { and: [wDocType('customerInvoice', 'pending'), wDateRange('dueDate', 'P-30D', 'P-59D')] }, fieldId: 'price', chartType: 'singleValue', targetType: 'document' } },
    { x: 0, y: 3, width: 9, height: 4, options: { name: 'Open Invoices', type: 'dataView', where: wDocType('customerInvoice', 'pending'), fields: [{ name: 'Customer', type: 'text', width: 150, formula: '{account:name}' }, { name: 'Invoice', type: 'text', width: 150, formula: '{fullName}' }, { path: ['node', 'balance'] }, { path: ['node', 'dueDate'] }], sortBy: [{ field: ['createdAt'], order: 'desc' }], groupBy: null, targetType: 'document', primaryFieldCount: 3 } },
  ],

  'schedule-overview': [
    { x: 0, y: 0, width: 2, height: 1, options: { agg: 'count', name: 'Incomplete Tasks', type: 'custom', where: { and: [{ '=': [{ field: ['completed'] }, { value: 0 }] }, { '=': [{ field: ['isToDo'] }, { value: false }] }] }, chartType: 'singleValue', targetType: 'task' } },
    { x: 2, y: 0, width: 2, height: 1, options: { agg: 'count', name: 'Overdue Tasks', type: 'custom', where: { and: [{ '=': [{ field: ['completed'] }, { value: 0 }] }, { '<': [{ field: ['endDate'] }, { date: { fromNow: 'P0D' } }] }] }, chartType: 'singleValue', targetType: 'task' } },
    { x: 4, y: 0, width: 5, height: 3, options: { agg: 'count', name: 'Tasks by Assignee', type: 'custom', where: { '=': [{ field: ['completed'] }, { value: 0 }] }, groupBy: [{ fieldId: 'assignee:name' }], chartType: 'bar', targetType: 'task' } },
    { x: 0, y: 1, width: 4, height: 4, options: { name: 'Upcoming Tasks', type: 'dataView', where: { and: [{ '=': [{ field: ['completed'] }, { value: 0 }] }, { '=': [{ field: ['isToDo'] }, { value: false }] }] }, fields: [{ name: 'Task', type: 'text', width: 200, formula: '{name}' }, { path: ['node', 'startDate'] }, { path: ['node', 'endDate'] }, { name: 'Job', type: 'text', width: 150, formula: '{job:name}' }], sortBy: [{ field: ['startDate'] }], groupBy: null, targetType: 'task', primaryFieldCount: 3 } },
  ],

  'field-kpis': [
    { x: 0, y: 0, width: 2, height: 1, options: { agg: 'count', name: 'Daily Logs This Month', type: 'custom', where: wThisMonth('createdAt'), chartType: 'singleValue', targetType: 'dailyLog' } },
    { x: 2, y: 0, width: 2, height: 1, options: { agg: 'count', name: 'Time Entries This Week', type: 'custom', where: wThisWeek('startedAt'), chartType: 'singleValue', targetType: 'timeEntry' } },
    { x: 4, y: 0, width: 5, height: 3, options: { agg: 'count', name: 'Time Entries by User', type: 'custom', where: W_ALL, groupBy: [{ fieldId: 'user:name' }], chartType: 'bar', targetType: 'timeEntry' } },
    { x: 0, y: 1, width: 4, height: 5, options: { name: 'Daily Logs', type: 'dataView', where: W_ALL, fields: [{ path: ['node', 'date'] }], sortBy: [], groupBy: [{ fieldId: 'user:name' }, { fieldId: 'date', datetimeFormat: 'YYYY MM' }], targetType: 'dailyLog', primaryFieldCount: 3 } },
  ],

  'sales-tracking': [
    { x: 0, y: 0, width: 2, height: 1, options: { agg: 'count', name: 'New Jobs This Month', type: 'custom', where: wThisMonth('createdAt'), chartType: 'singleValue', targetType: 'job' } },
    { x: 2, y: 0, width: 2, height: 1, options: { agg: 'sum', name: 'Pipeline Value', type: 'custom', where: W_OPEN, fieldId: 'approvedOrdersWithTax', chartType: 'singleValue', targetType: 'job' } },
    { x: 4, y: 0, width: 3, height: 3, options: { agg: 'count', name: 'Jobs by Status', type: 'custom', where: W_OPEN, groupBy: [{ fieldId: 'status' }], chartType: 'pie', targetType: 'job' } },
    { x: 7, y: 0, width: 2, height: 3, options: { agg: 'sum', name: 'Estimates by Month', type: 'custom', where: wDocType('customerOrder'), fieldId: 'price', groupBy: [{ fieldId: 'createdAt', datetimeFormat: 'YYYY MM' }], chartType: 'bar', targetType: 'document' } },
    { x: 0, y: 1, width: 4, height: 4, options: { name: 'Recent Estimates', type: 'dataView', where: wDocType('customerOrder'), fields: [{ name: 'Customer', type: 'text', width: 150, formula: '{account:name}' }, { name: 'Estimate', type: 'text', width: 150, formula: '{fullName}' }, { path: ['node', 'price'] }, { name: 'Status', type: 'text', width: 80, formula: '{status}' }], sortBy: [{ field: ['createdAt'], order: 'desc' }], groupBy: null, targetType: 'document', primaryFieldCount: 3 } },
    { x: 0, y: 5, width: 9, height: 3, options: { name: 'New Jobs', type: 'dataView', where: W_OPEN, fields: [{ name: 'Job', type: 'text', width: 200, formula: '{name}' }, { name: '#', type: 'text', width: 60, formula: '{number}' }, { name: 'Status', type: 'text', width: 100, formula: '{status}' }, { path: ['node', 'createdAt'] }], sortBy: [{ field: ['createdAt'], order: 'desc' }], groupBy: null, targetType: 'job', primaryFieldCount: 3 } },
  ],

  'vendor-tracking': [
    { x: 0, y: 0, width: 2, height: 1, options: { agg: 'count', name: 'Total Vendors', type: 'custom', where: W_ALL, chartType: 'singleValue', targetType: 'vendor' } },
    { x: 2, y: 0, width: 2, height: 1, options: { agg: 'count', name: 'Open POs', type: 'custom', where: wDocType('vendorOrder', 'pending'), chartType: 'singleValue', targetType: 'document' } },
    { x: 4, y: 0, width: 2, height: 1, options: { agg: 'sum', name: 'Open PO Value', type: 'custom', where: wDocType('vendorOrder', 'pending'), fieldId: 'price', chartType: 'singleValue', targetType: 'document' } },
    { x: 6, y: 0, width: 3, height: 3, options: { agg: 'count', name: 'Bills by Status', type: 'custom', where: wDocType('vendorBill'), groupBy: [{ fieldId: 'status' }], chartType: 'bar', targetType: 'document' } },
    { x: 0, y: 1, width: 6, height: 4, options: { name: 'Vendor Bills', type: 'dataView', where: wDocType('vendorBill'), fields: [{ name: 'Vendor', type: 'text', width: 150, formula: '{account:name}' }, { name: 'Bill', type: 'text', width: 150, formula: '{fullName}' }, { path: ['node', 'balance'] }, { name: 'Status', type: 'text', width: 80, formula: '{status}' }], sortBy: [{ field: ['createdAt'], order: 'desc' }], groupBy: null, targetType: 'document', primaryFieldCount: 3 } },
    { x: 0, y: 5, width: 9, height: 3, options: { name: 'New Vendors This Month', type: 'dataView', where: wThisMonth('createdAt'), fields: [{ path: ['node', 'name'] }, { path: ['node', 'createdAt'] }], sortBy: [{ field: ['createdAt'], order: 'desc' }], groupBy: null, targetType: 'vendor', primaryFieldCount: 3 } },
  ],
};
```

**Step 2: Verify syntax**

Run: `node -c server/mcp-server/src/tools.js`
Expected: No output (clean syntax)

**Step 3: Commit**

```bash
git add server/mcp-server/src/tools.js
git commit -m "feat(mcp): add dashboard templates and helpers"
```

---

### Task 2: Add handler functions

**Files:**
- Modify: `server/mcp-server/src/tools.js` (insert after the DASHBOARD_TEMPLATES block, before ADVANCED READ HANDLERS)

**Step 1: Add the three handler functions**

```javascript
// ─── Dashboard Handlers ─────────────────────────────────────────

async function handleCreateDashboard({ name, template, tiles, visibleTo }, ctx) {
  if (!template && !tiles) throw new Error('Provide either a template name or a tiles array. Templates: ' + Object.keys(DASHBOARD_TEMPLATES).join(', '));

  const dashTiles = tiles || DASHBOARD_TEMPLATES[template];
  if (!dashTiles) throw new Error(`Unknown template "${template}". Available: ${Object.keys(DASHBOARD_TEMPLATES).join(', ')}`);

  const roleIds = await resolveOrgRoles(ctx, visibleTo);

  const data = await ctx.pave({
    createDashboard: {
      $: {
        organizationId: ctx.orgId,
        name,
        type: 'organization',
        visibleToRoleIds: roleIds,
        tiles: dashTiles,
      },
      createdDashboard: { id: {}, name: {}, type: {} },
    },
  });

  const dashboard = data.createDashboard?.createdDashboard;
  if (!dashboard) throw new Error('Failed to create dashboard');
  return { success: true, dashboard, tileCount: dashTiles.length, template: template || 'custom' };
}

async function handleUpdateDashboard({ dashboardId, name, addTiles, removeTileIds, tiles }, ctx) {
  const params = { id: dashboardId };
  if (name) params.name = name;

  if (tiles) {
    // Full replacement
    params.tiles = tiles;
  } else if (addTiles || removeTileIds) {
    // Fetch existing dashboard to merge
    const existing = await ctx.pave({
      dashboard: {
        $: { id: dashboardId },
        tiles: { $: { size: 100 }, nodes: { id: {}, x: {}, y: {}, width: {}, height: {}, options: {} } },
      },
    });
    if (!existing.dashboard) throw new Error('Dashboard not found');

    let currentTiles = (existing.dashboard.tiles?.nodes || []).map(({ id, ...rest }) => rest);

    if (removeTileIds?.length) {
      const existingWithIds = existing.dashboard.tiles?.nodes || [];
      const keepTiles = existingWithIds.filter((t) => !removeTileIds.includes(t.id));
      currentTiles = keepTiles.map(({ id, ...rest }) => rest);
    }

    if (addTiles?.length) {
      const positioned = autoPositionTiles(currentTiles, addTiles);
      currentTiles = [...currentTiles, ...positioned];
    }

    params.tiles = currentTiles;
  }

  await ctx.pave({ updateDashboard: { $: params } });
  return { success: true, dashboardId, tileCount: params.tiles?.length || null, renamed: !!name };
}

async function handleDeleteDashboard({ dashboardId }, ctx) {
  await ctx.pave({ deleteDashboard: { $: { id: dashboardId } } });
  return { success: true, dashboardId, deleted: true };
}
```

**Step 2: Verify syntax**

Run: `node -c server/mcp-server/src/tools.js`
Expected: No output (clean syntax)

**Step 3: Commit**

```bash
git add server/mcp-server/src/tools.js
git commit -m "feat(mcp): add dashboard create/update/delete handlers"
```

---

### Task 3: Register tools in TOOL_DEFINITIONS

**Files:**
- Modify: `server/mcp-server/src/tools.js` (add entries to TOOL_DEFINITIONS array, before the closing `];`)

**Step 1: Add three tool definitions**

Insert before the `];` that closes `TOOL_DEFINITIONS` (before line 4445):

```javascript
  // ─── Dashboard Management ──────────────────────────────────────
  {
    name: 'jobtread_create_dashboard',
    description: 'Create a dashboard from a template or custom tiles. Templates: project-overview, accounts-payable, accounts-receivable, schedule-overview, field-kpis, sales-tracking, vendor-tracking. Users can resize/move tiles after creation.',
    schema: {
      name: z.string().describe('Dashboard name'),
      template: z.enum(['project-overview', 'accounts-payable', 'accounts-receivable', 'schedule-overview', 'field-kpis', 'sales-tracking', 'vendor-tracking']).optional().describe('Predefined template with best-practice layout'),
      tiles: z.array(z.object({
        x: z.number().describe('Column position (0-8)'),
        y: z.number().describe('Row position'),
        width: z.number().describe('Width in columns (1-9)'),
        height: z.number().describe('Height in rows'),
        options: z.record(z.any()).describe('Tile config: { type, name, ... }'),
      })).optional().describe('Custom tiles (overrides template)'),
      visibleTo: z.string().optional().describe('"all" (default), "internal" (excludes Customer/Vendor), or comma-separated role names'),
    },
    handler: handleCreateDashboard,
    restPath: '/api/dashboards/create',
  },
  {
    name: 'jobtread_update_dashboard',
    description: 'Modify a dashboard — rename, add tiles, remove tiles, or replace all tiles. Automatically handles tile merging (fetches existing tiles before updating).',
    schema: {
      dashboardId: z.string().describe('Dashboard ID'),
      name: z.string().optional().describe('New dashboard name'),
      addTiles: z.array(z.object({
        x: z.number().describe('Column position (0-8)'),
        y: z.number().optional().describe('Row (auto-positioned below existing if omitted)'),
        width: z.number().describe('Width in columns'),
        height: z.number().describe('Height in rows'),
        options: z.record(z.any()).describe('Tile config'),
      })).optional().describe('Tiles to add (auto-positioned below existing tiles)'),
      removeTileIds: z.array(z.string()).optional().describe('Tile IDs to remove'),
      tiles: z.array(z.object({
        x: z.number(), y: z.number(), width: z.number(), height: z.number(),
        options: z.record(z.any()),
      })).optional().describe('Full replacement tile array (overrides add/remove)'),
    },
    handler: handleUpdateDashboard,
    restPath: '/api/dashboards/update',
  },
  {
    name: 'jobtread_delete_dashboard',
    description: 'Delete a dashboard by ID. This action cannot be undone.',
    schema: {
      dashboardId: z.string().describe('Dashboard ID'),
    },
    handler: handleDeleteDashboard,
    restPath: '/api/dashboards/delete',
  },
```

**Step 2: Verify syntax**

Run: `node -c server/mcp-server/src/tools.js`
Expected: No output (clean syntax)

**Step 3: Commit**

```bash
git add server/mcp-server/src/tools.js
git commit -m "feat(mcp): register dashboard tools in TOOL_DEFINITIONS"
```

---

### Task 4: Deploy and test all 7 templates

**Step 1: Deploy**

Run: `cd server/mcp-server && npm run deploy`
Expected: Successful deploy with new version ID

**Step 2: Test create_dashboard with each template**

Use the JT Power Tools test account MCP connector (`mcp__b2761cda-...`) to call `jobtread_create_dashboard` for each template:

1. `{ name: "Test: Project Overview", template: "project-overview" }`
2. `{ name: "Test: AP", template: "accounts-payable" }`
3. `{ name: "Test: AR", template: "accounts-receivable" }`
4. `{ name: "Test: Schedule", template: "schedule-overview" }`
5. `{ name: "Test: Field KPIs", template: "field-kpis" }`
6. `{ name: "Test: Sales", template: "sales-tracking" }`
7. `{ name: "Test: Vendors", template: "vendor-tracking" }`

Each should return `{ success: true, dashboard: { id, name }, tileCount: N }`.

**Step 3: Test update_dashboard**

- Rename a dashboard: `{ dashboardId: "<id>", name: "Renamed Dashboard" }`
- Add a tile: `{ dashboardId: "<id>", addTiles: [{ x: 0, y: 0, width: 2, height: 1, options: { type: "actionItems" } }] }`
- Remove a tile by ID (get IDs from `get_dashboard` first)

**Step 4: Test delete_dashboard**

- Delete a test dashboard: `{ dashboardId: "<id>" }`
- Verify with `list_dashboards` that it's gone

**Step 5: Verify list/get still work**

- `list_dashboards` should show all created dashboards
- `get_dashboard` on one should show correct tiles

---

### Task 5: Update CHANGELOG and commit

**Files:**
- Modify: `CHANGELOG.md`

**Step 1: Add entry under [Unreleased]**

```markdown
### Added
#### MCP Server — Dashboard Management Tools
- Added `create_dashboard` tool with 7 predefined templates: project-overview, accounts-payable, accounts-receivable, schedule-overview, field-kpis, sales-tracking, vendor-tracking
- Added `update_dashboard` tool with add/remove/replace tile support and automatic tile merging
- Added `delete_dashboard` tool
- Templates follow dashboard design best practices: F-pattern layout, KPIs top row, charts mid-level, data tables below
```

**Step 2: Commit**

```bash
git add CHANGELOG.md
git commit -m "docs: Add dashboard tools to CHANGELOG"
```
