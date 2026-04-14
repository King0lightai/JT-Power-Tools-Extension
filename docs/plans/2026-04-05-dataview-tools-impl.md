# DataView MCP Tools Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add 5 MCP tools for managing JobTread DataViews (saved views) with human-friendly field names, simplified filters, and org-wide visibility by default.

**Architecture:** All changes in `server/mcp-server/src/tools.js`. Static field registries map short names to Pave path arrays. Helper functions convert simplified filter/sort/group inputs to Pave AST format. Custom fields resolved dynamically at runtime. Follows existing dashboard tool patterns exactly.

**Tech Stack:** Pave API, Zod schemas, Cloudflare Workers

**Design doc:** `docs/plans/2026-04-05-dataview-tools-design.md`

---

### Task 1: Add Static Field Registries

**Files:**
- Modify: `server/mcp-server/src/tools.js` — insert after line 3617 (end of `handleUpdateDashboard`)

**Step 1: Add the field registry constants**

Insert this block after line 3617 (`}` closing `handleUpdateDashboard`), before line 3619 (`// ═══ ADVANCED READ HANDLERS`):

```javascript
// ═══════════════════════════════════════════════════════════════════
// DATA VIEW FIELD REGISTRIES & HELPERS
// ═══════════════════════════════════════════════════════════════════

const DATA_VIEW_TYPES = [
  'costItem', 'costGroup', 'customer', 'dailyLog', 'document', 'event',
  'job', 'jobBudget', 'location', 'membership', 'organization', 'payment',
  'task', 'timeEntry', 'user', 'vendor', 'visitor',
];

// Maps custom field targetType values to dataView type values
const CF_TARGET_TO_VIEW_TYPE = {
  job: 'job',
  customer: 'customer',
  vendor: 'vendor',
  costItem: 'costItem',
  location: 'location',
  dailyLog: 'dailyLog',
  customerContact: 'customer',
  vendorContact: 'vendor',
};

const FIELD_REGISTRIES = {
  job: {
    'name':                          { path: ['node', 'name'], desc: 'Job name' },
    'number':                        { path: ['node', 'number'], desc: 'Job number' },
    'description':                   { path: ['node', 'description'], desc: 'Job description' },
    'closedOn':                      { path: ['node', 'closedOn'], desc: 'Date closed' },
    'createdAt':                     { path: ['node', 'createdAt'], desc: 'Date created' },
    'scheduleIsPublished':           { path: ['node', 'scheduleIsPublished'], desc: 'Schedule published?' },
    'location.name':                 { path: ['node', 'location', 'name'], desc: 'Location name' },
    'location.address':              { path: ['node', 'location', 'address'], desc: 'Location address' },
    'location.account.name':         { path: ['node', 'location', 'account', 'name'], desc: 'Customer/account name' },
    'projectedCost':                 { path: ['withValue', 'projectedCost'], desc: 'Projected cost' },
    'actualCost':                    { path: ['withValue', 'actualCost'], desc: 'Actual cost' },
    'budgetedCost':                  { path: ['withValue', 'budgetedCost'], desc: 'Budgeted cost' },
    'budgetVariance':                { path: ['withValue', 'budgetVariance'], desc: 'Budget variance' },
    'projectedPrice':                { path: ['withValue', 'projectedPrice'], desc: 'Projected price' },
    'projectedProfit':               { path: ['withValue', 'projectedProfit'], desc: 'Projected profit' },
    'projectedMargin':               { path: ['withValue', 'projectedMargin'], desc: 'Projected margin %' },
    'percentComplete':               { path: ['withValue', 'percentComplete'], desc: '% complete' },
    'earnedRevenue':                 { path: ['withValue', 'earnedRevenue'], desc: 'Earned revenue' },
    'costToComplete':                { path: ['withValue', 'costToComplete'], desc: 'Cost to complete' },
    'taskDays':                      { path: ['withValue', 'taskDays'], desc: 'Task days' },
    'projectedProfitPerTaskDay':     { path: ['withValue', 'projectedProfitPerTaskDay'], desc: 'Profit per task day' },
    'approvedCustomerOrders.price':  { path: ['withValue', 'approvedCustomerOrders', 'price'], desc: 'Approved orders $' },
    'approvedCustomerOrders.priceWithTaxSum': { path: ['withValue', 'approvedCustomerOrders', 'priceWithTaxSum'], desc: 'Approved orders $ (w/ tax)' },
    'approvedCustomerInvoices.price': { path: ['withValue', 'approvedCustomerInvoices', 'price'], desc: 'Approved invoices $' },
    'approvedCustomerInvoices.sum':  { path: ['withValue', 'approvedCustomerInvoices', 'sum'], desc: 'Approved invoices sum' },
    'pendingCustomerOrders.sum':     { path: ['withValue', 'pendingCustomerOrders', 'sum'], desc: 'Pending orders $' },
    'pendingCustomerInvoices.sum':   { path: ['withValue', 'pendingCustomerInvoices', 'sum'], desc: 'Pending invoices $' },
    'invoiced.price':                { path: ['withValue', 'invoiced', 'price'], desc: 'Invoiced amount' },
    'overInvoiced':                  { path: ['withValue', 'overInvoiced'], desc: 'Over-invoiced amount' },
    'underInvoiced':                 { path: ['withValue', 'underInvoiced'], desc: 'Under-invoiced amount' },
    'earliestScheduledIncompleteTask.name': { path: ['withValue', 'earliestScheduledIncompleteTask', 'name'], desc: 'Next incomplete task' },
    'latestCompletedTask.name':      { path: ['withValue', 'latestCompletedTask', 'name'], desc: 'Last completed task' },
  },
  customer: {
    'name':                          { path: ['node', 'name'], desc: 'Customer name' },
    'createdAt':                     { path: ['node', 'createdAt'], desc: 'Date created' },
    'archivedAt':                    { path: ['node', 'archivedAt'], desc: 'Date archived' },
    'primaryContact.name':           { path: ['node', 'primaryContact', 'name'], desc: 'Primary contact name' },
    'primaryLocation.name':          { path: ['node', 'primaryLocation', 'name'], desc: 'Primary location name' },
    'activeCustomerJobs.count':      { path: ['withValue', 'activeCustomerJobs', 'count'], desc: 'Active jobs count' },
    'closedCustomerJobs.count':      { path: ['withValue', 'closedCustomerJobs', 'count'], desc: 'Closed jobs count' },
    'pendingCustomerOrders.sum':     { path: ['withValue', 'pendingCustomerOrders', 'sum'], desc: 'Pending orders $' },
    'approvedCustomerOrders.sum':    { path: ['withValue', 'approvedCustomerOrders', 'sum'], desc: 'Approved orders $' },
    'openCustomerInvoices.sum':      { path: ['withValue', 'openCustomerInvoices', 'sum'], desc: 'Open invoices $' },
    'approvedCustomerInvoices.sum':  { path: ['withValue', 'approvedCustomerInvoices', 'sum'], desc: 'Approved invoices $' },
  },
  vendor: {
    'name':                          { path: ['node', 'name'], desc: 'Vendor name' },
    'createdAt':                     { path: ['node', 'createdAt'], desc: 'Date created' },
    'archivedAt':                    { path: ['node', 'archivedAt'], desc: 'Date archived' },
    'primaryContact.name':           { path: ['node', 'primaryContact', 'name'], desc: 'Primary contact name' },
    'primaryLocation.name':          { path: ['node', 'primaryLocation', 'name'], desc: 'Primary location name' },
  },
  costItem: {
    'image':                         { path: ['node', 'image', 'nodes', '0', 'url'], desc: 'Item image URL' },
    'name':                          { path: ['node', 'name'], desc: 'Item name' },
    'description':                   { path: ['node', 'description'], desc: 'Item description' },
    'quantity':                      { path: ['node', 'quantity'], desc: 'Quantity' },
    'unit.name':                     { path: ['node', 'unit', 'name'], desc: 'Unit of measure' },
    'unitCost':                      { path: ['node', 'unitCost'], desc: 'Unit cost' },
    'unitPrice':                     { path: ['node', 'unitPrice'], desc: 'Unit price' },
    'costType.name':                 { path: ['node', 'costType', 'name'], desc: 'Cost type' },
    'costCode.name':                 { path: ['node', 'costCode', 'name'], desc: 'Cost code name' },
    'costCode.number':               { path: ['node', 'costCode', 'number'], desc: 'Cost code number' },
    'createdAt':                     { path: ['node', 'createdAt'], desc: 'Date created' },
    'isTaxable':                     { path: ['node', 'isTaxable'], desc: 'Taxable?' },
    'isSpecification':               { path: ['node', 'isSpecification'], desc: 'Is specification?' },
    'requireSpecificationApproval':  { path: ['node', 'requireSpecificationApproval'], desc: 'Requires spec approval?' },
    'markup':                        { path: ['withValue', 'markup'], desc: 'Markup %' },
    'margin':                        { path: ['withValue', 'margin'], desc: 'Margin %' },
  },
  task: {
    'name':                          { path: ['node', 'name'], desc: 'Task name' },
    'description':                   { path: ['node', 'description'], desc: 'Task description' },
    'startDate':                     { path: ['node', 'startDate'], desc: 'Start date' },
    'endDate':                       { path: ['node', 'endDate'], desc: 'End date' },
    'progress':                      { path: ['node', 'progress'], desc: 'Progress (0-100)' },
    'completed':                     { path: ['node', 'completed'], desc: 'Completed (0/1)' },
    'isToDo':                        { path: ['node', 'isToDo'], desc: 'Is to-do item?' },
    'isGroup':                       { path: ['node', 'isGroup'], desc: 'Is group?' },
    'createdAt':                     { path: ['node', 'createdAt'], desc: 'Date created' },
  },
  document: {
    'name':                          { path: ['node', 'name'], desc: 'Document name' },
    'number':                        { path: ['node', 'number'], desc: 'Document number' },
    'type':                          { path: ['node', 'type'], desc: 'Document type' },
    'status':                        { path: ['node', 'status'], desc: 'Document status' },
    'priceWithTax':                  { path: ['node', 'priceWithTax'], desc: 'Price with tax' },
    'dueDate':                       { path: ['node', 'dueDate'], desc: 'Due date' },
    'createdAt':                     { path: ['node', 'createdAt'], desc: 'Date created' },
    'account.name':                  { path: ['node', 'account', 'name'], desc: 'Account name' },
  },
  dailyLog: {
    'date':                          { path: ['node', 'date'], desc: 'Log date' },
    'notes':                         { path: ['node', 'notes'], desc: 'Log notes' },
    'createdAt':                     { path: ['node', 'createdAt'], desc: 'Date created' },
  },
  timeEntry: {
    'startedAt':                     { path: ['node', 'startedAt'], desc: 'Start time' },
    'endedAt':                       { path: ['node', 'endedAt'], desc: 'End time' },
    'notes':                         { path: ['node', 'notes'], desc: 'Notes' },
    'createdAt':                     { path: ['node', 'createdAt'], desc: 'Date created' },
    'user.name':                     { path: ['node', 'user', 'name'], desc: 'User name' },
    'job.name':                      { path: ['node', 'job', 'name'], desc: 'Job name' },
  },
  payment: {
    'name':                          { path: ['node', 'name'], desc: 'Payment name' },
    'createdAt':                     { path: ['node', 'createdAt'], desc: 'Date created' },
  },
  location: {
    'name':                          { path: ['node', 'name'], desc: 'Location name' },
    'address':                       { path: ['node', 'address'], desc: 'Address' },
    'createdAt':                     { path: ['node', 'createdAt'], desc: 'Date created' },
  },
  event: {
    'name':                          { path: ['node', 'name'], desc: 'Event name' },
    'createdAt':                     { path: ['node', 'createdAt'], desc: 'Date created' },
  },
  costGroup: {
    'name':                          { path: ['node', 'name'], desc: 'Cost group name' },
    'description':                   { path: ['node', 'description'], desc: 'Description' },
  },
  membership: {
    'user.name':                     { path: ['node', 'user', 'name'], desc: 'User name' },
    'role':                          { path: ['node', 'role'], desc: 'Role' },
    'createdAt':                     { path: ['node', 'createdAt'], desc: 'Date created' },
  },
  user: {
    'name':                          { path: ['node', 'name'], desc: 'User name' },
  },
};
```

**Step 2: Commit**

```bash
git add server/mcp-server/src/tools.js
git commit -m "feat(mcp): add DataView static field registries

- Field registries for 13 entity types (job, customer, vendor, costItem, task, document, dailyLog, timeEntry, payment, location, event, costGroup, membership, user)
- Maps human-friendly names to Pave path arrays
- DATA_VIEW_TYPES constant with all 17 supported types
- CF_TARGET_TO_VIEW_TYPE for custom field targetType mapping"
```

---

### Task 2: Add Helper Functions

**Files:**
- Modify: `server/mcp-server/src/tools.js` — insert immediately after the field registries from Task 1

**Step 1: Add the helper functions**

Insert right after the closing `};` of `FIELD_REGISTRIES`:

```javascript

// ─── DataView Helper: resolve field names → Pave paths ──────────

async function resolveFieldPaths(fieldNames, viewType, ctx) {
  const registry = FIELD_REGISTRIES[viewType] || {};
  const resolved = [];
  const unresolved = [];

  // Separate static fields from custom fields
  const cfNames = [];
  for (const name of fieldNames) {
    if (name.startsWith('cf:')) {
      cfNames.push(name);
    } else if (registry[name]) {
      resolved.push({ path: registry[name].path });
    } else {
      unresolved.push(name);
    }
  }

  // Resolve custom fields if any
  if (cfNames.length > 0) {
    const cfData = await ctx.pave({
      organization: {
        $: { id: ctx.orgId },
        customFields: {
          $: { size: 100, sortBy: [{ field: 'position' }] },
          nodes: { id: {}, name: {}, type: {}, targetType: {} },
        },
      },
    });
    const allCfs = cfData.organization?.customFields?.nodes || [];
    for (const cfName of cfNames) {
      const name = cfName.slice(3); // strip "cf:"
      const cf = allCfs.find(f => f.name === name && (
        f.targetType === viewType ||
        CF_TARGET_TO_VIEW_TYPE[f.targetType] === viewType
      ));
      if (cf) {
        resolved.push({ path: ['withValue', `cfv:${cf.id}`, 'values'] });
      } else {
        unresolved.push(cfName);
      }
    }
  }

  if (unresolved.length > 0) {
    throw new Error(`Unknown fields for type "${viewType}": ${unresolved.join(', ')}. Use jobtread_list_data_view_fields to discover available fields.`);
  }

  return resolved;
}

// ─── DataView Helper: convert filter tuples → Pave AST ──────────

function convertFilterToAst(whereTuples) {
  if (!whereTuples || whereTuples.length === 0) return null;

  const conditions = whereTuples.map(tuple => {
    const [field, op, value] = tuple;
    return { [op]: [{ field: [field] }, { value }] };
  });

  if (conditions.length === 1) return conditions[0];
  return { and: conditions };
}

// ─── DataView Helper: convert sort shorthand → Pave format ──────

function convertSortBy(sortTuples) {
  if (!sortTuples || sortTuples.length === 0) return null;
  return sortTuples.map(([field, order]) => ({ field: [field], order }));
}

// ─── DataView Helper: resolve groupBy cf name → Pave format ─────

async function resolveGroupBy(groupByName, viewType, ctx) {
  if (!groupByName) return null;
  if (!groupByName.startsWith('cf:')) {
    throw new Error('groupBy must be a custom field name prefixed with "cf:" (e.g., "cf:Division"). Built-in fields cannot be used for grouping.');
  }
  const name = groupByName.slice(3);
  const cfData = await ctx.pave({
    organization: {
      $: { id: ctx.orgId },
      customFields: {
        $: { size: 100, where: ['targetType', '=', viewType] },
        nodes: { id: {}, name: {} },
      },
    },
  });
  const allCfs = cfData.organization?.customFields?.nodes || [];
  const cf = allCfs.find(f => f.name === name);
  if (!cf) {
    // Also check mapped target types (e.g., customerContact → customer)
    const altTypes = Object.entries(CF_TARGET_TO_VIEW_TYPE)
      .filter(([, v]) => v === viewType)
      .map(([k]) => k);
    for (const altType of altTypes) {
      const altData = await ctx.pave({
        organization: {
          $: { id: ctx.orgId },
          customFields: {
            $: { size: 100, where: ['targetType', '=', altType] },
            nodes: { id: {}, name: {} },
          },
        },
      });
      const altCf = (altData.organization?.customFields?.nodes || []).find(f => f.name === name);
      if (altCf) return [{ customFieldId: altCf.id }];
    }
    throw new Error(`Custom field "${name}" not found for type "${viewType}". Use jobtread_get_custom_fields to see available fields.`);
  }
  return [{ customFieldId: cf.id }];
}

// ─── DataView Helper: reverse-map Pave paths → friendly names ───

function reverseMapFields(fields, viewType) {
  const registry = FIELD_REGISTRIES[viewType] || {};
  const reverseMap = {};
  for (const [name, { path }] of Object.entries(registry)) {
    reverseMap[JSON.stringify(path)] = name;
  }
  return fields.map(f => {
    const key = JSON.stringify(f.path);
    const friendlyName = reverseMap[key];
    if (friendlyName) return { name: friendlyName, path: f.path };
    // Check for custom field pattern
    if (f.path[0] === 'withValue' && f.path[1]?.startsWith('cfv:')) {
      return { name: `cf:${f.path[1].slice(4)}`, path: f.path, isCustomField: true };
    }
    return { name: f.path.join('.'), path: f.path };
  });
}
```

**Step 2: Commit**

```bash
git add server/mcp-server/src/tools.js
git commit -m "feat(mcp): add DataView helper functions

- resolveFieldPaths: maps friendly names + cf: prefixed custom fields to Pave paths
- convertFilterToAst: converts [field, op, value] tuples to Pave filter AST
- convertSortBy: converts [field, order] tuples to Pave sort format
- resolveGroupBy: resolves cf:Name to {customFieldId} for grouping
- reverseMapFields: maps Pave paths back to friendly names for display"
```

---

### Task 3: Add Handler Functions

**Files:**
- Modify: `server/mcp-server/src/tools.js` — insert immediately after the helper functions from Task 2

**Step 1: Add the 5 handler functions**

```javascript

// ═══════════════════════════════════════════════════════════════════
// DATA VIEW HANDLERS
// ═══════════════════════════════════════════════════════════════════

async function handleListDataViews({ type }, ctx) {
  const data = await ctx.pave({
    organization: {
      $: { id: ctx.orgId },
      dataViews: {
        nodes: { id: {}, name: {}, type: {}, options: {}, createdAt: {} },
      },
    },
  });
  let views = (data.organization?.dataViews?.nodes || []).map(v => ({
    id: v.id,
    name: v.name,
    type: v.type,
    viewMode: v.options?.view || 'list',
    createdAt: v.createdAt,
  }));
  if (type) {
    views = views.filter(v => v.type === type);
  }
  return { views, count: views.length };
}

async function handleGetDataView({ dataViewId }, ctx) {
  const data = await ctx.pave({
    dataView: {
      $: { id: dataViewId },
      id: {}, name: {}, type: {}, fields: {}, options: {}, createdAt: {},
    },
  });
  const view = data.dataView;
  if (!view) throw new Error(`DataView ${dataViewId} not found`);
  const friendlyFields = reverseMapFields(view.fields || [], view.type);
  return {
    id: view.id,
    name: view.name,
    type: view.type,
    viewMode: view.options?.view || 'list',
    fields: friendlyFields,
    options: view.options,
    createdAt: view.createdAt,
  };
}

async function handleListDataViewFields({ type }, ctx) {
  const registry = FIELD_REGISTRIES[type] || {};
  const builtIn = Object.entries(registry).map(([name, { path, desc }]) => ({
    name,
    path,
    description: desc,
  }));

  // Fetch custom fields for this type
  const targetTypes = [type];
  // Also include sub-target types (e.g., customerContact for customer views)
  for (const [cfTarget, viewType] of Object.entries(CF_TARGET_TO_VIEW_TYPE)) {
    if (viewType === type && cfTarget !== type) {
      targetTypes.push(cfTarget);
    }
  }

  const customFields = [];
  for (const tt of targetTypes) {
    const cfData = await ctx.pave({
      organization: {
        $: { id: ctx.orgId },
        customFields: {
          $: { size: 100, where: ['targetType', '=', tt], sortBy: [{ field: 'position' }] },
          nodes: { id: {}, name: {}, type: {}, targetType: {} },
        },
      },
    });
    const cfs = cfData.organization?.customFields?.nodes || [];
    for (const cf of cfs) {
      customFields.push({
        name: `cf:${cf.name}`,
        path: ['withValue', `cfv:${cf.id}`, 'values'],
        description: `Custom: ${cf.name} (${cf.type})`,
      });
    }
  }

  return { type, fields: [...builtIn, ...customFields], count: builtIn.length + customFields.length };
}

async function handleCreateDataView({ name, type, fields, view, where, sortBy, groupBy, primaryFieldCount, personal, positionAfterDataViewId }, ctx) {
  // Resolve human-friendly field names to Pave paths
  const resolvedFields = await resolveFieldPaths(fields, type, ctx);

  // Build options
  const options = {
    view: view || 'list',
    where: convertFilterToAst(where) || null,
    sortBy: convertSortBy(sortBy) || [{ field: ['name'], order: 'asc' }],
    groupBy: groupBy ? await resolveGroupBy(groupBy, type, ctx) : null,
    primaryFieldCount: primaryFieldCount || 3,
  };

  // Warn if kanban without groupBy
  if (options.view === 'kanban' && !options.groupBy) {
    throw new Error('Kanban view requires a groupBy field. Provide a custom field name like "cf:Status".');
  }

  const params = {
    organizationId: ctx.orgId,
    name,
    type,
    options,
    fields: resolvedFields,
  };

  // Org-wide by default (userId: null), personal if requested
  if (!personal) {
    params.userId = null;
  }

  if (positionAfterDataViewId) {
    params.positionAfterDataViewId = positionAfterDataViewId;
  }

  const data = await ctx.pave({
    createDataView: {
      $: params,
      createdDataView: { id: {}, name: {} },
    },
  });

  const created = data.createDataView?.createdDataView;
  return {
    success: true,
    dataView: { id: created?.id, name: created?.name, type },
    visibility: personal ? 'personal' : 'organization',
  };
}

async function handleUpdateDataView({ dataViewId, name, fields, view, where, sortBy, groupBy, primaryFieldCount, personal, positionAfterDataViewId }, ctx) {
  // Fetch existing view to get type for field resolution
  const existing = await ctx.pave({
    dataView: {
      $: { id: dataViewId },
      id: {}, name: {}, type: {}, options: {}, fields: {},
    },
  });
  const existingView = existing.dataView;
  if (!existingView) throw new Error(`DataView ${dataViewId} not found`);

  const viewType = existingView.type;
  const updated = [];
  const params = { id: dataViewId };

  // Update name
  if (name !== undefined) {
    params.name = name;
    updated.push('name');
  }

  // Update fields
  if (fields !== undefined) {
    params.fields = await resolveFieldPaths(fields, viewType, ctx);
    updated.push('fields');
  }

  // Build updated options (merge with existing)
  const existingOptions = existingView.options || {};
  let optionsChanged = false;
  const newOptions = { ...existingOptions };

  if (view !== undefined) {
    newOptions.view = view;
    optionsChanged = true;
  }
  if (where !== undefined) {
    newOptions.where = convertFilterToAst(where) || null;
    optionsChanged = true;
  }
  if (sortBy !== undefined) {
    newOptions.sortBy = convertSortBy(sortBy);
    optionsChanged = true;
  }
  if (groupBy !== undefined) {
    newOptions.groupBy = groupBy ? await resolveGroupBy(groupBy, viewType, ctx) : null;
    optionsChanged = true;
  }
  if (primaryFieldCount !== undefined) {
    newOptions.primaryFieldCount = primaryFieldCount;
    optionsChanged = true;
  }

  if (optionsChanged) {
    params.options = newOptions;
    updated.push('options');
  }

  // Visibility
  if (personal !== undefined) {
    params.userId = personal ? undefined : null;
    updated.push('visibility');
  }

  if (positionAfterDataViewId !== undefined) {
    params.positionAfterDataViewId = positionAfterDataViewId;
    updated.push('position');
  }

  // Warn if kanban without groupBy
  if (newOptions.view === 'kanban' && !newOptions.groupBy) {
    throw new Error('Kanban view requires a groupBy field. Provide a custom field name like "cf:Status".');
  }

  await ctx.pave({
    updateDataView: {
      $: params,
      dataView: { $: { id: dataViewId }, id: {}, name: {} },
    },
  });

  return { success: true, dataViewId, updated };
}
```

**Step 2: Commit**

```bash
git add server/mcp-server/src/tools.js
git commit -m "feat(mcp): add DataView handler functions

- handleListDataViews: list org views with optional type filter
- handleGetDataView: get full view config with reverse-mapped field names
- handleListDataViewFields: discover built-in + custom fields per type
- handleCreateDataView: create views with friendly field names, org-wide by default
- handleUpdateDataView: partial update with options merging"
```

---

### Task 4: Add TOOL_DEFINITIONS Entries

**Files:**
- Modify: `server/mcp-server/src/tools.js` — insert into TOOL_DEFINITIONS array before the closing `];` at line 6161

**Step 1: Add the 5 tool definitions**

Insert before line 6161 (the `];` closing TOOL_DEFINITIONS), after the `add_approved_sender` entry:

```javascript
  // ─── Data Views ─────────────────────────────────────────────────
  {
    name: 'jobtread_list_data_views',
    description: 'List all saved views in the organization. Views control how data is displayed in the Data Browser — filters, columns, sorting, grouping, and list/kanban modes.',
    annotations: { readOnlyHint: true, openWorldHint: true },
    schema: {
      type: z.enum(['costItem', 'costGroup', 'customer', 'dailyLog', 'document', 'event', 'job', 'jobBudget', 'location', 'membership', 'organization', 'payment', 'task', 'timeEntry', 'user', 'vendor', 'visitor']).optional().describe('Filter views by entity type'),
    },
    handler: handleListDataViews,
    restPath: '/api/data-views/list',
  },
  {
    name: 'jobtread_get_data_view',
    description: 'Get full configuration of a saved view: fields (columns), filters, sorting, grouping, and view mode.',
    annotations: { readOnlyHint: true, openWorldHint: true },
    schema: {
      dataViewId: z.string().describe('View ID'),
    },
    handler: handleGetDataView,
    restPath: '/api/data-views/get',
  },
  {
    name: 'jobtread_list_data_view_fields',
    description: 'Discover available fields for a view type. Returns built-in fields and org-specific custom fields. Call this before creating or updating a view to know what columns are available.',
    annotations: { readOnlyHint: true, openWorldHint: true },
    schema: {
      type: z.enum(['costItem', 'costGroup', 'customer', 'dailyLog', 'document', 'event', 'job', 'jobBudget', 'location', 'membership', 'organization', 'payment', 'task', 'timeEntry', 'user', 'vendor', 'visitor']).describe('Entity type to list fields for'),
    },
    handler: handleListDataViewFields,
    restPath: '/api/data-views/fields',
  },
  {
    name: 'jobtread_create_data_view',
    description: 'Create a saved view. Call jobtread_list_data_view_fields first to discover available fields. Use human-friendly field names (e.g., "name", "location.name", "projectedCost", "cf:Division"). Views are created as organization-wide by default.',
    annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: true },
    schema: {
      name: z.string().describe('View name (max 128 chars)'),
      type: z.enum(['costItem', 'costGroup', 'customer', 'dailyLog', 'document', 'event', 'job', 'jobBudget', 'location', 'membership', 'organization', 'payment', 'task', 'timeEntry', 'user', 'vendor', 'visitor']).describe('Entity type'),
      fields: z.array(z.string()).min(1).max(100).describe('Field names from jobtread_list_data_view_fields (e.g., ["name", "location.name", "cf:Division"])'),
      view: z.enum(['list', 'kanban']).optional().describe('View mode (default: list). Kanban requires groupBy.'),
      where: z.array(z.array(z.any())).optional().describe('Filter tuples: [["field", "op", value], ...]. Ops: =, !=, >, <, >=, <=, like. Example: [["closedOn", "=", null]]'),
      sortBy: z.array(z.array(z.string())).optional().describe('Sort: [["field", "asc|desc"]]. Example: [["name", "asc"]]'),
      groupBy: z.string().optional().describe('Custom field to group by: "cf:Division". Only custom fields supported.'),
      primaryFieldCount: z.number().optional().describe('Number of pinned left columns (default: 3)'),
      personal: z.boolean().optional().describe('Create as personal view instead of organization-wide (default: false)'),
      positionAfterDataViewId: z.string().optional().describe('Position after this view ID in the list'),
    },
    handler: handleCreateDataView,
    restPath: '/api/data-views/create',
  },
  {
    name: 'jobtread_update_data_view',
    description: 'Update a saved view. Only provided fields are changed. Fetch current config with jobtread_get_data_view first if needed.',
    annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: true },
    schema: {
      dataViewId: z.string().describe('View ID'),
      name: z.string().optional().describe('New view name'),
      fields: z.array(z.string()).min(1).max(100).optional().describe('Replacement field list (same format as create)'),
      view: z.enum(['list', 'kanban']).optional().describe('Change view mode'),
      where: z.array(z.array(z.any())).optional().describe('Replacement filter tuples'),
      sortBy: z.array(z.array(z.string())).optional().describe('Replacement sort'),
      groupBy: z.string().nullable().optional().describe('Change grouping (cf name, or null to remove)'),
      primaryFieldCount: z.number().optional().describe('Change pinned column count'),
      personal: z.boolean().optional().describe('Switch to personal (true) or organization (false)'),
      positionAfterDataViewId: z.string().optional().describe('Reorder: position after this view ID'),
    },
    handler: handleUpdateDataView,
    restPath: '/api/data-views/update',
  },
```

**Step 2: Commit**

```bash
git add server/mcp-server/src/tools.js
git commit -m "feat(mcp): register 5 DataView tools in TOOL_DEFINITIONS

- jobtread_list_data_views: list org views with type filter
- jobtread_get_data_view: get full view config
- jobtread_list_data_view_fields: discover available fields per type
- jobtread_create_data_view: create views with friendly field names
- jobtread_update_data_view: partial update with options merge"
```

---

### Task 5: Update CHANGELOG and Knowledge Base

**Files:**
- Modify: `CHANGELOG.md` — add entry under `[Unreleased]`
- Modify: `server/mcp-server/src/tools.js` — update knowledge base entry at top of file if applicable

**Step 1: Add CHANGELOG entry**

Add under `## [Unreleased]` → `### Added`:

```markdown
### Added
- Added 5 DataView MCP tools for managing saved views in JobTread's Data Browser
  - `jobtread_list_data_views` — list all saved views with optional type filtering
  - `jobtread_get_data_view` — get full view configuration
  - `jobtread_list_data_view_fields` — discover available fields (built-in + custom) per entity type
  - `jobtread_create_data_view` — create views with human-friendly field names and simplified filters
  - `jobtread_update_data_view` — partial update with automatic options merging
  - Supports all 17 JobTread entity types (job, customer, vendor, costItem, task, document, etc.)
  - Views created as organization-wide by default (userId: null)
  - Human-friendly field names mapped to Pave paths (saves tokens)
  - Simplified filter syntax: [["closedOn", "=", null]] instead of Pave AST
  - Dynamic custom field discovery with cf: prefix
```

**Step 2: Commit**

```bash
git add CHANGELOG.md server/mcp-server/src/tools.js
git commit -m "docs: add DataView tools to CHANGELOG

Updated CHANGELOG.md"
```

---

### Task 6: Test with Live API

**Step 1: Deploy to dev**

```bash
cd server/mcp-server && npx wrangler deploy
```

**Step 2: Test list_data_views**

Use MCP to call `jobtread_list_data_views` with no args. Expect: list of existing Titus views (All Jobs, Open Jobs, Pipeline, etc.).

Then call with `type: "job"`. Expect: only job-type views.

**Step 3: Test get_data_view**

Call `jobtread_get_data_view` with an ID from step 2. Expect: full config with human-readable field names.

**Step 4: Test list_data_view_fields**

Call `jobtread_list_data_view_fields` with `type: "job"`. Expect: built-in fields + all Titus job custom fields (Status, Division, Project Type, etc.).

**Step 5: Test create_data_view**

Call `jobtread_create_data_view`:
```json
{
  "name": "AI Test - Open Jobs by Division",
  "type": "job",
  "fields": ["name", "location.name", "cf:Division", "projectedCost", "actualCost"],
  "where": [["closedOn", "=", null]],
  "sortBy": [["name", "asc"]],
  "groupBy": "cf:Division"
}
```
Expect: success, org-wide view created. Verify in JT UI it appears as an Organization view.

**Step 6: Test update_data_view**

Call `jobtread_update_data_view` with the ID from step 5:
```json
{
  "dataViewId": "<id>",
  "name": "AI Test - Open Jobs by Division (Updated)",
  "sortBy": [["createdAt", "desc"]]
}
```
Expect: success, name and sort changed, other fields preserved.

**Step 7: Clean up**

Delete the test view from JT UI.

**Step 8: Commit any fixes**

If any bugs found during testing, fix and commit with `fix(mcp): ...`.
