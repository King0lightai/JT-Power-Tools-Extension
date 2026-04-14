# Team Notes Write + Workflow Read Tools Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add 5 MCP tools — 2 team notes write tools (D1) and 3 workflow read tools (Pave API).

**Architecture:** Handlers go in `tools.js` after existing team notes handlers (line ~2062). TOOL_DEFINITIONS entries go after existing team notes entries (line ~4190). All follow existing patterns.

**Tech Stack:** Cloudflare Workers, D1 database, Pave API, zod schemas

---

### Task 1: Add team notes write handlers

**Files:**
- Modify: `server/mcp-server/src/tools.js:2062` (after `handleListTeamNotes`)

**Step 1: Add `handleCreateTeamNote` and `handleUpdateTeamNote` handlers**

Insert after line 2061 (closing `}` of `handleListTeamNotes`):

```javascript

async function handleCreateTeamNote({ title, content, folder = 'AI Notes', isPinned = false }, ctx) {
  if (!ctx.env.TEAM_DB) throw new Error('Team notes database not configured.');
  if (!title?.trim()) throw new Error('Title is required.');
  if (!content?.trim()) throw new Error('Content is required.');

  const lic = await ctx.env.TEAM_DB.prepare('SELECT id FROM licenses WHERE license_key = ?').bind(ctx.licenseKey).first();
  if (!lic) throw new Error('License not found. Team notes require a linked license.');

  // Get user name from Pave
  let createdBy = 'AI Assistant';
  try {
    const viewer = await ctx.pave({ viewer: { name: {} } });
    if (viewer.viewer?.name) createdBy = `${viewer.viewer.name} (via AI)`;
  } catch (_) { /* fallback to default */ }

  const id = crypto.randomUUID();
  const now = Math.floor(Date.now() / 1000);

  await ctx.env.TEAM_DB.prepare(`
    INSERT INTO team_notes (id, license_id, title, content, folder, is_pinned, created_by_name, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).bind(id, lic.id, title.trim(), content.trim(), folder.trim(), isPinned ? 1 : 0, createdBy, now, now).run();

  return { success: true, id, title: title.trim(), folder: folder.trim(), createdBy };
}

async function handleUpdateTeamNote({ noteId, title, content, folder, isPinned }, ctx) {
  if (!ctx.env.TEAM_DB) throw new Error('Team notes database not configured.');
  if (!noteId) throw new Error('noteId is required.');

  const lic = await ctx.env.TEAM_DB.prepare('SELECT id FROM licenses WHERE license_key = ?').bind(ctx.licenseKey).first();
  if (!lic) throw new Error('License not found.');

  // Verify note exists and belongs to this license
  const existing = await ctx.env.TEAM_DB.prepare(
    'SELECT id FROM team_notes WHERE id = ? AND license_id = ? AND deleted_at IS NULL'
  ).bind(noteId, lic.id).first();
  if (!existing) throw new Error('Team note not found or access denied.');

  // Build dynamic update
  const sets = [];
  const values = [];
  const updatedFields = [];

  if (title !== undefined) { sets.push('title = ?'); values.push(title.trim()); updatedFields.push('title'); }
  if (content !== undefined) { sets.push('content = ?'); values.push(content.trim()); updatedFields.push('content'); }
  if (folder !== undefined) { sets.push('folder = ?'); values.push(folder.trim()); updatedFields.push('folder'); }
  if (isPinned !== undefined) { sets.push('is_pinned = ?'); values.push(isPinned ? 1 : 0); updatedFields.push('isPinned'); }

  if (sets.length === 0) throw new Error('No fields to update. Provide at least one of: title, content, folder, isPinned.');

  // Get user name
  let updatedBy = 'AI Assistant';
  try {
    const viewer = await ctx.pave({ viewer: { name: {} } });
    if (viewer.viewer?.name) updatedBy = `${viewer.viewer.name} (via AI)`;
  } catch (_) { /* fallback */ }

  sets.push('updated_by_name = ?');
  values.push(updatedBy);
  sets.push('updated_at = ?');
  values.push(Math.floor(Date.now() / 1000));
  values.push(noteId);

  await ctx.env.TEAM_DB.prepare(
    `UPDATE team_notes SET ${sets.join(', ')} WHERE id = ?`
  ).bind(...values).run();

  return { success: true, id: noteId, updatedFields, updatedBy };
}
```

**Step 2: Verify syntax**

Run: `cd server/mcp-server && node -c src/tools.js`
Expected: No output (clean syntax)

### Task 2: Add workflow read handlers

**Files:**
- Modify: `server/mcp-server/src/tools.js:2062` (after the new team notes handlers from Task 1)

**Step 1: Add workflow handlers**

Insert after `handleUpdateTeamNote` (before the `// ─── Knowledge Lookup` comment):

```javascript

// ─── Workflow Read (Pave) ────────────────────────────────────────

async function handleListWorkflows(_, ctx) {
  const data = await ctx.pave({
    organization: {
      $: { id: ctx.orgId },
      workflows: {
        $: { size: 10 },
        count: {},
        nodes: { id: {}, name: {}, isActive: {}, triggerTypeId: {}, triggerInput: {}, nextRunAt: {}, createdAt: {} },
      },
    },
  });

  const wf = data.organization?.workflows;
  return {
    workflows: (wf?.nodes || []).map(w => ({
      id: w.id,
      name: w.name,
      isActive: w.isActive,
      triggerType: w.triggerTypeId,
      triggerInput: w.triggerInput,
      nextRunAt: w.nextRunAt,
      createdAt: w.createdAt,
    })),
    count: wf?.count ?? 0,
    maxAllowed: 10,
  };
}

const ACTION_FIELDS = { id: {}, name: {}, typeId: {}, input: {}, customActionFields: {} };
// 4 levels of nesting covers all practical workflows
const NESTED_ACTIONS = {
  ...ACTION_FIELDS,
  actions: { ...ACTION_FIELDS, actions: { ...ACTION_FIELDS, actions: { ...ACTION_FIELDS, actions: ACTION_FIELDS } } },
};

async function handleGetWorkflow({ workflowId }, ctx) {
  const data = await ctx.pave({
    workflow: {
      $: { id: workflowId },
      id: {}, name: {}, isActive: {}, triggerTypeId: {}, triggerInput: {},
      customTriggerFields: {}, nextRunAt: {}, createdAt: {}, url: {},
      actions: NESTED_ACTIONS,
    },
  });

  if (!data.workflow) throw new Error('Workflow not found.');
  return { workflow: data.workflow };
}

async function handleListWorkflowRuns({ workflowId, status, limit = 20 }, ctx) {
  const size = Math.min(limit, 50);
  const where = [];
  if (workflowId) where.push({ '=': [{ field: ['workflow', 'id'] }, { value: workflowId }] });
  if (status) where.push({ '=': [{ field: ['status'] }, { value: status }] });

  const queryWhere = where.length === 0 ? undefined : where.length === 1 ? where[0] : { and: where };

  const params = {
    size,
    sortBy: [{ field: ['createdAt'], order: 'desc' }],
  };
  if (queryWhere) params.where = queryWhere;

  const data = await ctx.pave({
    organization: {
      $: { id: ctx.orgId },
      workflowRuns: {
        $: params,
        count: {},
        nodes: {
          id: {}, status: {}, startAt: {}, startedAt: {}, stoppedAt: {}, createdAt: {},
          workflow: { id: {}, name: {} },
        },
      },
    },
  });

  const runs = data.organization?.workflowRuns;
  return {
    runs: (runs?.nodes || []).map(r => ({
      id: r.id,
      status: r.status,
      workflowId: r.workflow?.id,
      workflowName: r.workflow?.name,
      startAt: r.startAt,
      startedAt: r.startedAt,
      stoppedAt: r.stoppedAt,
      createdAt: r.createdAt,
    })),
    count: runs?.count ?? 0,
  };
}
```

**Step 2: Verify syntax**

Run: `cd server/mcp-server && node -c src/tools.js`
Expected: No output (clean syntax)

### Task 3: Add TOOL_DEFINITIONS entries

**Files:**
- Modify: `server/mcp-server/src/tools.js:4190` (after `jobtread_list_team_notes` entry, before `// ─── Dashboards`)

**Step 1: Add 5 TOOL_DEFINITIONS entries**

Insert after line 4190 (closing `},` of `jobtread_list_team_notes`):

```javascript
  {
    name: 'jobtread_create_team_note',
    description: 'Save a team note to the organization\'s shared knowledge base. Use folder "AI Notes" for AI-discovered org knowledge. Notes persist across sessions and are searchable.',
    schema: {
      title: z.string().describe('Note title'),
      content: z.string().describe('Note content (markdown supported)'),
      folder: z.string().optional().describe('Folder name (default: "AI Notes")'),
      isPinned: z.boolean().optional().describe('Pin to top of list'),
    },
    handler: handleCreateTeamNote,
    restPath: '/api/team-notes/create',
  },
  {
    name: 'jobtread_update_team_note',
    description: 'Update an existing team note\'s title, content, folder, or pin status.',
    schema: {
      noteId: z.string().describe('Team note ID'),
      title: z.string().optional().describe('New title'),
      content: z.string().optional().describe('New content'),
      folder: z.string().optional().describe('New folder'),
      isPinned: z.boolean().optional().describe('Pin or unpin'),
    },
    handler: handleUpdateTeamNote,
    restPath: '/api/team-notes/update',
  },
  // ─── Workflows ──────────────────────────────────────────────────
  {
    name: 'jobtread_list_workflows',
    description: 'List all automation workflows. Shows name, trigger type, active status, next run. Orgs are limited to 10 workflows.',
    schema: {},
    handler: handleListWorkflows,
    restPath: '/api/workflows/list',
  },
  {
    name: 'jobtread_get_workflow',
    description: 'Get full workflow detail including trigger config and nested action tree. Actions use {{trigger.field}} template syntax.',
    schema: {
      workflowId: z.string().describe('Workflow ID'),
    },
    handler: handleGetWorkflow,
    restPath: '/api/workflows/get',
  },
  {
    name: 'jobtread_list_workflow_runs',
    description: 'List recent workflow execution history with status (succeeded/failed/skipped), timing, and workflow name.',
    schema: {
      workflowId: z.string().optional().describe('Filter by workflow ID'),
      status: z.enum(['scheduled', 'queued', 'started', 'succeeded', 'failed', 'cancelled', 'skipped', 'delayed']).optional().describe('Filter by status'),
      limit: z.number().optional().describe('Max results (default 20, max 50)'),
    },
    handler: handleListWorkflowRuns,
    restPath: '/api/workflows/runs',
  },
```

**Step 2: Verify syntax**

Run: `cd server/mcp-server && node -c src/tools.js`
Expected: No output (clean syntax)

**Step 3: Commit**

```bash
git add -A && git commit -m "feat(mcp): Add team notes write + workflow read tools"
```

### Task 4: Deploy and test all 5 tools

**Step 1: Deploy**

Run: `cd server/mcp-server && npm run deploy`
Expected: `Deployed jobtread-mcp-server triggers`

**Step 2: Test `jobtread_create_team_note`**

Call with JT Power Tools connector (`mcp__b2761cda-*`):
```json
{ "title": "Test Note", "content": "This is a test note created by AI.", "folder": "AI Notes" }
```
Expected: `{ success: true, id: "...", title: "Test Note", folder: "AI Notes" }`

**Step 3: Test `jobtread_update_team_note`**

Use the ID from Step 2:
```json
{ "noteId": "<id>", "content": "Updated content.", "isPinned": true }
```
Expected: `{ success: true, updatedFields: ["content", "isPinned"] }`

**Step 4: Verify with `jobtread_list_team_notes`**

Call `jobtread_list_team_notes` and confirm the new note appears with updated content and pinned status.

**Step 5: Test `jobtread_list_workflows`**

Call with Titus connector (`mcp__dec758b4-*`):
Expected: 2 workflows (Daily Log Created Trigger, Job Status Updater), count: 2, maxAllowed: 10

**Step 6: Test `jobtread_get_workflow`**

Use Job Status Updater ID `22PKfA8anmFN`:
Expected: Full workflow with triggerTypeId `taskUpdated` and nested filter → updateJob actions

**Step 7: Test `jobtread_list_workflow_runs`**

Call with `status: "skipped"`, `limit: 3`:
Expected: Recent skipped runs for Job Status Updater

### Task 5: Update CHANGELOG

**Files:**
- Modify: `CHANGELOG.md` — add under `[Unreleased] > Added`

**Step 1: Add entries**

```markdown
- Added `jobtread_create_team_note` tool — save notes to org's shared knowledge base with folder categorization (default: "AI Notes")
- Added `jobtread_update_team_note` tool — update existing team note title, content, folder, or pin status
- Added `jobtread_list_workflows` tool — list all automation workflows with trigger type, active status, and 10-workflow org limit
- Added `jobtread_get_workflow` tool — get full workflow detail with nested action tree and trigger configuration
- Added `jobtread_list_workflow_runs` tool — list recent workflow execution history with status filtering
```

**Step 2: Commit**

```bash
git add CHANGELOG.md && git commit -m "docs: Add team notes write + workflow read tools to CHANGELOG"
```
