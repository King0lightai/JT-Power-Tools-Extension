# Team Notes Write + Workflow Read Tools — Design

**Date**: 2026-03-15
**Status**: Approved

## Overview

Add 5 MCP tools: 2 for writing team notes (D1-backed) and 3 for reading JobTread's native workflow system.

## Part 1: Team Notes Write Tools

### Context

Team notes are stored in D1 (`team_notes` table). Read tools (`search_team_notes`, `list_team_notes`) already exist. Adding write tools enables AI to persist org-specific knowledge (processes, naming conventions, pricing rules) that future AI sessions can reference.

### Schema (existing)

```
team_notes: id, license_id, title, content, folder, is_pinned,
            created_by_name, updated_by_name, created_at, updated_at, deleted_at
```

### Tool: `jobtread_create_team_note`

| Param | Type | Required | Default | Description |
|-------|------|----------|---------|-------------|
| title | string | yes | — | Note title |
| content | string | yes | — | Note content (markdown) |
| folder | string | no | "AI Notes" | Folder/category |
| isPinned | boolean | no | false | Pin to top |

**Behavior:**
- Generate UUID for `id`
- Look up `license_id` from `ctx.licenseKey` via `licenses` table
- Get user name from Pave: `ctx.pave({ viewer: { name: {} } })` → append `" (via AI)"`
- Insert into `team_notes`
- Return: `{ success, id, title, folder }`

### Tool: `jobtread_update_team_note`

| Param | Type | Required | Description |
|-------|------|----------|-------------|
| noteId | string | yes | Note ID to update |
| title | string | no | New title |
| content | string | no | New content |
| folder | string | no | New folder |
| isPinned | boolean | no | New pin status |

**Behavior:**
- Build dynamic SET clause from provided fields
- Set `updated_at = unixepoch()` and `updated_by_name` (user name + `" (via AI)"`)
- Verify note exists and belongs to license
- Return: `{ success, id, updatedFields }`

## Part 2: Workflow Read Tools

### Context

JobTread has a native workflow automation system with triggers, nested action trees, and run history. Orgs are limited to 10 workflows, making them high-value. Starting with read-only tools to understand patterns before building create/update.

### API Reference

**Triggers (67 types):**
- Event triggers (60): CRUD events for 15 entity types (created/updated/deleted/createdOrUpdated)
- Reminder triggers (5): document, job, task, timeEntry, vendor — schedule based on a field value
- General triggers (2): `scheduled` (cron), `webhook` (custom)

**Actions (42 types):**
- Create (9): comment, customer, customerContact, dailyLog, job, location, task, vendor, vendorContact
- Update (10): customer, customerContact, dailyLog, document, file, job, location, task, vendor, vendorContact
- Find (12): lookup entities by criteria
- Tools (7): delay, filter, formatDateTime, loop, query, transform, webhook
- Other (2): assignAccess, importTaskTemplate

**Key patterns:**
- Actions are nested (tree structure) — filter actions contain child actions
- Template syntax: `{{trigger.task.name}}`, `{{trigger.job.id}}`, `{{trigger.data.next.endDate}}`
- Filter expressions: `=`, `contains` operators
- Custom fields: `custom:fieldId` keys in action input
- `workflow.actions` cannot be queried from the `workflows` list — must use `workflow({ id })` root query

### Tool: `jobtread_list_workflows`

| Param | Type | Required | Default | Description |
|-------|------|----------|---------|-------------|
| (none) | — | — | — | Lists all workflows |

**Pave query:**
```
organization.workflows({ size: 10 }).nodes { id, name, isActive, triggerTypeId, triggerInput, nextRunAt, createdAt }
```

**Return:** `{ workflows: [...], count, maxAllowed: 10 }`

### Tool: `jobtread_get_workflow`

| Param | Type | Required | Description |
|-------|------|----------|-------------|
| workflowId | string | yes | Workflow ID |

**Pave query:**
```
workflow({ id }) { id, name, isActive, triggerTypeId, triggerInput, customTriggerFields, actions { id, name, typeId, input, customActionFields, actions { ... recursive } } }
```

**Return:** Raw workflow object with full nested action tree. AI interprets the tree structure directly.

**Note:** Actions nest recursively (e.g., filter → child actions → nested filters). Query depth of 4 levels should cover all practical workflows.

### Tool: `jobtread_list_workflow_runs`

| Param | Type | Required | Default | Description |
|-------|------|----------|---------|-------------|
| workflowId | string | no | — | Filter by workflow |
| status | string | no | — | Filter: scheduled/queued/started/succeeded/failed/cancelled/skipped/delayed |
| limit | number | no | 20 | Max results (cap 50) |

**Pave query:**
```
organization.workflowRuns({ size, where, sortBy: [{ field: ['createdAt'], order: 'desc' }] }).nodes {
  id, status, startAt, startedAt, stoppedAt, createdAt,
  workflow { id, name }
}
```

**Return:** `{ runs: [...], count }`

## Implementation Notes

- All 5 tools go in `server/mcp-server/src/tools.js`
- Team notes tools use `ctx.env.TEAM_DB` (D1)
- Workflow tools use `ctx.pave()` (Pave API)
- Add TOOL_DEFINITIONS entries with zod schemas
- Deploy with `npm run deploy`
- Test on JT Power Tools test account (`mcp__b2761cda-*`)

## Tool Count

- Current: 59 tools
- Adding: 5 tools
- New total: 64 tools
