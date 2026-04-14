# Workflow Builder Tools Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add `jobtread_create_workflow` and `jobtread_update_workflow` MCP tools so AI can build and modify JobTread automation workflows.

**Architecture:** Two Pave mutation handlers in `tools.js` following existing create/update patterns (like dashboards). Handlers go after workflow read handlers (~line 2220). TOOL_DEFINITIONS entries go after `jobtread_list_workflow_runs` (~line 4396). Both tools use the Pave `createWorkflow`/`updateWorkflow` mutations with nested action trees.

**Tech Stack:** Cloudflare Workers, Pave API, zod schemas

---

### Task 1: Add `handleCreateWorkflow` handler

**Files:**
- Modify: `server/mcp-server/src/tools.js:2220` (after `handleListWorkflowRuns` closing `}`, before `// ─── Knowledge Lookup`)

**Step 1: Add the handler function**

Insert after line 2220 (the closing `}` of `handleListWorkflowRuns`), before the `// ─── Knowledge Lookup` comment:

```javascript

async function handleCreateWorkflow({ name, triggerTypeId, triggerInput, actions, isActive }, ctx) {
  if (!name?.trim()) throw new Error('name is required.');
  if (!triggerTypeId?.trim()) throw new Error('triggerTypeId is required.');
  if (!Array.isArray(actions) || actions.length === 0) throw new Error('actions array is required and must not be empty.');

  const data = await ctx.pave({
    createWorkflow: {
      $: {
        name: name.trim(),
        triggerTypeId: triggerTypeId.trim(),
        triggerInput: triggerInput || {},
        actions,
        isActive: isActive ?? false,
      },
      createdWorkflow: {
        id: {}, name: {}, isActive: {}, triggerTypeId: {}, url: {}, actions: {},
      },
    },
  });

  const wf = data.createWorkflow?.createdWorkflow;
  if (!wf) throw new Error('Failed to create workflow.');

  const actionCount = countActions(wf.actions || []);
  return {
    success: true,
    id: wf.id,
    name: wf.name,
    triggerTypeId: wf.triggerTypeId,
    isActive: wf.isActive,
    actionCount,
    url: wf.url,
    note: wf.isActive ? undefined : 'Workflow created as INACTIVE. Review in JobTread UI before activating.',
  };
}

function countActions(actions) {
  let count = 0;
  for (const a of actions) {
    count++;
    if (Array.isArray(a.actions)) count += countActions(a.actions);
  }
  return count;
}
```

**Step 2: Verify syntax**

Run: `cd server/mcp-server && node -c src/tools.js`
Expected: No output (clean syntax)

### Task 2: Add `handleUpdateWorkflow` handler

**Files:**
- Modify: `server/mcp-server/src/tools.js` (immediately after `countActions` function from Task 1)

**Step 1: Add the handler function**

Insert directly after the `countActions` function:

```javascript

async function handleUpdateWorkflow({ workflowId, name, triggerTypeId, triggerInput, actions, isActive }, ctx) {
  if (!workflowId) throw new Error('workflowId is required.');

  const updates = {};
  const updatedFields = [];

  if (name !== undefined) { updates.name = name.trim(); updatedFields.push('name'); }
  if (triggerTypeId !== undefined) { updates.triggerTypeId = triggerTypeId.trim(); updatedFields.push('triggerTypeId'); }
  if (triggerInput !== undefined) { updates.triggerInput = triggerInput; updatedFields.push('triggerInput'); }
  if (actions !== undefined) {
    if (!Array.isArray(actions)) throw new Error('actions must be an array.');
    updates.actions = actions;
    updatedFields.push('actions');
  }
  if (isActive !== undefined) { updates.isActive = isActive; updatedFields.push('isActive'); }

  if (updatedFields.length === 0) throw new Error('No fields to update. Provide at least one of: name, triggerTypeId, triggerInput, actions, isActive.');

  const data = await ctx.pave({
    updateWorkflow: {
      $: { id: workflowId, ...updates },
      updatedWorkflow: {
        id: {}, name: {}, isActive: {}, triggerTypeId: {}, actions: {},
      },
    },
  });

  const wf = data.updateWorkflow?.updatedWorkflow;
  if (!wf) throw new Error('Failed to update workflow. It may not exist or you may not have access.');

  const actionCount = countActions(wf.actions || []);
  return {
    success: true,
    id: wf.id,
    name: wf.name,
    triggerTypeId: wf.triggerTypeId,
    isActive: wf.isActive,
    updatedFields,
    actionCount,
  };
}
```

**Step 2: Verify syntax**

Run: `cd server/mcp-server && node -c src/tools.js`
Expected: No output (clean syntax)

### Task 3: Add TOOL_DEFINITIONS entries

**Files:**
- Modify: `server/mcp-server/src/tools.js:4396` (after `jobtread_list_workflow_runs` entry, before `// ─── Dashboards`)

**Step 1: Add 2 TOOL_DEFINITIONS entries**

Insert after line 4396 (closing `},` of `jobtread_list_workflow_runs`), before the `// ─── Dashboards` comment:

```javascript
  {
    name: 'jobtread_create_workflow',
    description: 'Create a new automation workflow. BEFORE creating, ALWAYS call list_workflows first — if a workflow with the same trigger type exists, use update_workflow to add actions instead. Orgs limited to 10 workflows. Starts inactive by default.\n\nAction tree format: [{ typeId, input, actions: [...] }]. Common patterns: filter → action (gate by condition), findMembership → assignAccess (team routing). Templates: {{trigger.job.id}}, {{trigger.task.taskType.name}}, {{trigger.job.custom:FIELD_ID}}.\n\nTrigger types (66): jobCreated/Updated/Deleted/Restored, taskCreated/Updated/Deleted/Restored, accountCreated/Updated, contactCreated/Updated, documentCreated/Updated/Deleted/Restored, costItemCreated/Updated, dailyLogCreated/Updated, timeEntryCreated/Updated, commentCreated/Updated, scheduled, webhook, taskReminder, jobReminder, etc.\n\nAction types (41): filter, delay, loop, transform, findJob/Account/Contact/Membership/Task/Document/CostItem/CostGroup/DailyLog/TimeEntry/Event/Location/File, createJob/Task/Comment/DailyLog/Document/CostItem/CostGroup/TimeEntry/Notification, updateJob/Task/Account/Contact/Document/CostItem/CostGroup/Location/DailyLog/TimeEntry/Membership, assignAccess, query, webhook.',
    schema: {
      name: z.string().describe('Workflow name'),
      triggerTypeId: z.string().describe('Trigger type (e.g., taskCreated, jobUpdated, scheduled)'),
      triggerInput: z.record(z.any()).optional().describe('Trigger configuration object'),
      actions: z.array(z.any()).describe('Nested action tree: [{ typeId, input, actions: [...] }]'),
      isActive: z.boolean().optional().describe('Activate immediately (default: false for safety)'),
    },
    handler: handleCreateWorkflow,
    restPath: '/api/workflows/create',
  },
  {
    name: 'jobtread_update_workflow',
    description: 'Update an existing workflow name, trigger, active status, or action tree. The actions array REPLACES the entire action tree — call get_workflow first, merge changes, then send the complete tree. Use this to add action branches to existing workflows with the same trigger type.',
    schema: {
      workflowId: z.string().describe('Workflow ID'),
      name: z.string().optional().describe('New workflow name'),
      triggerTypeId: z.string().optional().describe('Change trigger type'),
      triggerInput: z.record(z.any()).optional().describe('Change trigger configuration'),
      actions: z.array(z.any()).optional().describe('Full replacement action tree'),
      isActive: z.boolean().optional().describe('Activate or deactivate'),
    },
    handler: handleUpdateWorkflow,
    restPath: '/api/workflows/update',
  },
```

**Step 2: Verify syntax**

Run: `cd server/mcp-server && node -c src/tools.js`
Expected: No output (clean syntax)

**Step 3: Commit**

```bash
git add server/mcp-server/src/tools.js && git commit -m "feat(mcp): Add workflow builder tools (create + update)"
```

### Task 4: Deploy and test both tools

**Step 1: Deploy**

Run: `cd server/mcp-server && npm run deploy`
Expected: `Deployed jobtread-mcp-server triggers`

**Step 2: Test `jobtread_create_workflow`**

Call with Titus connector (`mcp__dec758b4-*`):
```json
{
  "name": "Test Workflow - AI Created",
  "triggerTypeId": "commentCreated",
  "actions": [
    {
      "typeId": "filter",
      "input": {
        "filter": {
          "expression": { "=": [{ "value": "{{trigger.comment.message}}" }, { "value": "test" }] },
          "_resolvedType": "simple"
        }
      },
      "actions": [
        {
          "typeId": "createNotification",
          "input": { "message": "A test comment was posted" },
          "actions": []
        }
      ]
    }
  ],
  "isActive": false
}
```
Expected: `{ success: true, id: "...", name: "Test Workflow - AI Created", isActive: false, actionCount: 2 }`

**Step 3: Test `jobtread_update_workflow`**

Use the ID from Step 2. Add a second filter branch and rename:
```json
{
  "workflowId": "<id-from-step-2>",
  "name": "Test Workflow - AI Updated",
  "actions": [
    {
      "typeId": "filter",
      "input": {
        "filter": {
          "expression": { "=": [{ "value": "{{trigger.comment.message}}" }, { "value": "test" }] },
          "_resolvedType": "simple"
        }
      },
      "actions": [
        {
          "typeId": "createNotification",
          "input": { "message": "A test comment was posted" },
          "actions": []
        }
      ]
    },
    {
      "typeId": "filter",
      "input": {
        "filter": {
          "expression": { "=": [{ "value": "{{trigger.comment.message}}" }, { "value": "urgent" }] },
          "_resolvedType": "simple"
        }
      },
      "actions": [
        {
          "typeId": "createNotification",
          "input": { "message": "URGENT comment posted!" },
          "actions": []
        }
      ]
    }
  ]
}
```
Expected: `{ success: true, name: "Test Workflow - AI Updated", updatedFields: ["name", "actions"], actionCount: 4 }`

**Step 4: Verify with `jobtread_list_workflows`**

Call `jobtread_list_workflows` (Titus connector) and confirm the new workflow appears with updated name, `isActive: false`, and `commentCreated` trigger.

**Step 5: Test deactivate/activate toggle**

```json
{ "workflowId": "<id>", "isActive": false }
```
Expected: `{ success: true, updatedFields: ["isActive"], isActive: false }`

### Task 5: Update CHANGELOG and popup

**Files:**
- Modify: `CHANGELOG.md` — add under `[Unreleased] > Added`
- Modify: `JT-Tools-Master/popup/popup.html` — update tool counts (64→66, 25→27 write)

**Step 1: Add CHANGELOG entries**

```markdown
- Added `jobtread_create_workflow` tool — create automation workflows with nested action trees, trigger configuration, and safety-first inactive default
- Added `jobtread_update_workflow` tool — update workflow name, trigger, active status, or replace entire action tree
```

**Step 2: Update popup tool counts**

Update the beta banner and any tool count references from 64→66 total, 25→27 write tools.

**Step 3: Commit**

```bash
git add CHANGELOG.md JT-Tools-Master/popup/popup.html && git commit -m "docs: Add workflow builder tools to CHANGELOG and update popup counts"
```
