# Interactive Schedule Gantt — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Ship a draggable schedule Gantt that renders as an MCP App (SEP-1865), computes dependency ripple + conflict flags client-side, and writes batched, idempotent reschedules back to JobTread — on an isolated lab server that never touches production.

**Architecture:** Clone-and-carve. Copy `server/mcp-server/` → `server/mcp-server-lab/` (worker `jt-mcp-lab`, fresh OAUTH_KV + IDEMPOTENCY_KV, reuse user DB read-only, drop CONTEXT_*). Carve the tool surface to **2 tools + 1 resource**: `jt_schedule_board` (read, links the UI resource via `_meta.ui.resourceUri`), `jt_schedule_reschedule` (idempotent batched write), `ui://schedule-gantt` (the iframe bundle). The iframe is an MCP client over postMessage; the ripple/conflict engines are **pure functions** tested headless; the worker is a dumb, safe date-applier.

**Tech Stack:** Cloudflare Workers · `@modelcontextprotocol/sdk` (upgrade required — see Task 1.1) · `@mcp-ui/server` (reference MCP Apps SDK) · `zod` · esbuild (bundles the Gantt to one inlined ESM module) · `node --test` (built-in runner) · vanilla JS + SVG for the Gantt (no framework needed for v1).

**Design doc:** `docs/plans/2026-05-27-interactive-schedule-gantt-design.md`

**Sequencing principle:** prove the bidirectional loop end-to-end as early as possible. Phase 1 ends with a trivial board rendering in a host; Phase 2 makes it write back; Phases 3–4 add the ripple/conflict brain. Each phase is independently shippable.

---

## Conventions for the executor

- **Run all commands from `server/mcp-server-lab/`** unless a path says otherwise.
- **Test command:** `node --test src/path/to/file.test.js` (this repo uses Node's built-in test runner — there is no `npm test`). Pure-logic engine tests live under `gantt/src/` and run the same way.
- **Deploy:** `npx wrangler deploy`. **Never deploy the prod `server/mcp-server/`** in this work.
- **Commit** after every green step using conventional commits (`feat:`, `test:`, `chore:`, `fix:`). The lab lives in the same repo; scope commits with `(gantt)` or `(lab)`.
- **Cloudflare account:** `wrangler` must be logged into **king0light.ai@gmail.com** (`npx wrangler whoami` to confirm). KV namespaces are created from the CLI, NOT the Cloudflare MCP (it's authed to a different account).
- Reference skills: @superpowers:test-driven-development for the engine work, @superpowers:executing-plans for task flow.

---

# PHASE 1 — Lab server stands up and renders a board (read-only loop)

Goal: `jt-mcp-lab` deploys, connects to Claude, and "show me the schedule for [job]" renders a static Gantt in the artifact. No dragging yet.

### Task 1.0: Clone the server directory

**Files:**
- Create: `server/mcp-server-lab/` (full copy of `server/mcp-server/`)

**Step 1:** From repo root, copy the tree (PowerShell):
```powershell
Copy-Item -Recurse -Force "server/mcp-server" "server/mcp-server-lab"
Remove-Item -Recurse -Force "server/mcp-server-lab/node_modules" -ErrorAction SilentlyContinue
```

**Step 2:** Verify: `ls server/mcp-server-lab/src/index.js` exists.

**Step 3:** Commit.
```bash
git add server/mcp-server-lab
git commit -m "chore(lab): clone mcp-server into mcp-server-lab"
```

### Task 1.1: Upgrade the MCP SDK to an MCP-Apps-capable version + add @mcp-ui/server

**Why:** the cloned `package.json` pins `@modelcontextprotocol/sdk ^1.11.0`, which predates MCP Apps (SEP-1865, Jan 2026). MCP Apps needs resource registration with the `text/html;profile=mcp-app` mimetype and `_meta.ui` tool linkage. `@mcp-ui/server` is the reference SDK that emits spec-correct UI resources.

**Files:**
- Modify: `server/mcp-server-lab/package.json`

**Step 1:** Install latest SDK + the mcp-ui server SDK:
```bash
cd server/mcp-server-lab
npm install @modelcontextprotocol/sdk@latest @mcp-ui/server@latest
npm install
```

**Step 2:** Verify the installed SDK exposes `registerResource` on `McpServer` and supports tool `_meta`:
```bash
node -e "import('@modelcontextprotocol/sdk/server/mcp.js').then(m => { const s = new m.McpServer({name:'t',version:'1'}); console.log('registerResource:', typeof s.registerResource); })"
```
Expected: `registerResource: function`. **If it prints `undefined`**, STOP and report — the SDK API differs and the resource-registration tasks (1.5, 2.x) need adjusting to the actual API surface (check the SDK's `mcp.js` exports).

**Step 3:** Commit.
```bash
git add server/mcp-server-lab/package.json server/mcp-server-lab/package-lock.json
git commit -m "chore(lab): upgrade MCP SDK + add @mcp-ui/server for MCP Apps"
```

### Task 1.2: Create the lab's KV namespaces

**Files:** none (Cloudflare resources)

**Step 1:** Confirm account: `npx wrangler whoami` → must be `king0light.ai@gmail.com`.

**Step 2:** Create fresh namespaces (the lab must NOT share prod's OAuth/idempotency state):
```bash
npx wrangler kv namespace create OAUTH_KV
npx wrangler kv namespace create OAUTH_KV --preview
npx wrangler kv namespace create IDEMPOTENCY_KV
npx wrangler kv namespace create IDEMPOTENCY_KV --preview
```

**Step 3:** Record the four returned IDs — they go into `wrangler.jsonc` in the next task. No commit yet.

### Task 1.3: Rewrite the lab wrangler.jsonc

**Files:**
- Modify: `server/mcp-server-lab/wrangler.jsonc`

**Step 1:** Replace the contents with the lab config. Reuse the prod **user DB** ids (read-only auth), fresh KV ids from Task 1.2, **drop** CONTEXT_*, R2, queues, crons, and the prod custom domain. Add the `ai` binding now (used in a later phase if we add server-side narration; harmless).
```jsonc
{
  "name": "jt-mcp-lab",
  "main": "src/index.js",
  "compatibility_date": "2025-04-01",
  "compatibility_flags": ["nodejs_compat"],

  "d1_databases": [
    { "binding": "DB",       "database_name": "jobtread-extension-users", "database_id": "576bc461-59fc-42de-85fd-3397be8b8df9" },
    { "binding": "TEAM_DB",  "database_name": "jobtread-extension-users", "database_id": "576bc461-59fc-42de-85fd-3397be8b8df9" }
  ],

  "vars": {
    "PORTAL_URL": "https://app.jtpowertools.com",
    "MCP_BASE_URL": "https://jt-mcp-lab.king0light-ai.workers.dev"
  },

  "kv_namespaces": [
    { "binding": "OAUTH_KV",       "id": "<LAB_OAUTH_KV_ID>",       "preview_id": "<LAB_OAUTH_KV_PREVIEW_ID>" },
    { "binding": "IDEMPOTENCY_KV", "id": "<LAB_IDEMPOTENCY_KV_ID>", "preview_id": "<LAB_IDEMPOTENCY_KV_PREVIEW_ID>" }
  ],

  "workers_dev": true
}
```

**Step 2:** Paste the real IDs from Task 1.2 into the four `<…>` placeholders.

**Step 3:** Validate config + bindings (builds, doesn't deploy):
```bash
npx wrangler deploy --dry-run
```
Expected: lists `DB`, `TEAM_DB`, `OAUTH_KV`, `IDEMPOTENCY_KV` and exits. **Expect build errors** about missing CONTEXT_DB references — fixed in Task 1.4.

**Step 4:** Commit.
```bash
git add server/mcp-server-lab/wrangler.jsonc
git commit -m "chore(lab): lab wrangler config — jt-mcp-lab, fresh KV, drop context/r2/queues"
```

### Task 1.4: Neutralize context-mode in index.js (CONTEXT_DB dropped)

**Files:**
- Modify: `server/mcp-server-lab/src/index.js`

**Step 1:** In `handleMcpStreamable`, the block `if (env.CONTEXT_DB) { … createContextMode … }` already guards on the binding. Since `CONTEXT_DB` is absent, `contextMode` stays `null` — no code change needed there. Confirm the import line for `createContextMode` still resolves (the file still exists in the clone). Leave it.

**Step 2:** Re-run `npx wrangler deploy --dry-run`. Expected: clean build, bindings listed, no CONTEXT errors. If `agent-events.js` / queue/email imports error on missing bindings at build time, comment out the `email`, `scheduled`, and `queue` exports in `index.js` (the lab needs none of them):
- Remove the `async email(...)`, `async scheduled(...)`, `async queue(...)` methods from the `export default {}` object.
- Remove their now-unused imports (`handleBillEmail`, `handleJobEmail`, `handleScheduledCleanup`, `dispatchDelivery`, `handleBillPdfDownload`) and the `/bills/:id/pdf` route block in `fetch`.

**Step 3:** `npx wrangler deploy --dry-run` → clean.

**Step 4:** Commit.
```bash
git add server/mcp-server-lab/src/index.js
git commit -m "chore(lab): strip email/queue/scheduled/bills entrypoints from lab worker"
```

### Task 1.5: Carve the tool surface down to a stub board tool

**Files:**
- Modify: `server/mcp-server-lab/src/tools.js`
- Modify: `server/mcp-server-lab/src/mcp-permissions.js`

**Step 1:** In `tools.js`, locate the tool-definitions array (the entries carrying `name`/`description`/`schema`/`handler`, roughly lines 7900–9100). Reduce it to a SINGLE stub entry; delete the rest. Remove now-unused handler imports at the top to keep the bundle lean (leave the shared infra: `registerAllTools`, dispatcher, `lookupCachedResult`, `DryRunSignal`, `zod-to-jsonschema`, permission helpers).
```js
import { z } from 'zod';
// keep: registerAllTools machinery, idempotency, dry-run, permissions imports

const TOOL_DEFINITIONS = [
  {
    name: 'jt_schedule_board',
    description: 'Returns a job schedule as a draggable Gantt board. Renders an interactive MCP App.',
    schema: { jobId: z.string().describe('JobTread job ID') },
    handler: async (args, ctx) => ({ ok: true, jobId: args.jobId, tasks: [] }), // stub — real handler in Task 1.6
  },
];
```

**Step 2:** In `mcp-permissions.js`, replace the `TOOL_PERMISSIONS` map body with only:
```js
export const TOOL_PERMISSIONS = Object.freeze({
  jt_schedule_board:      { category: 'read' },
  jt_schedule_reschedule: { category: 'write' }, // added now so Phase 2 needs no edit here
});
```

**Step 3:** `npx wrangler deploy --dry-run` → clean build, no missing-import errors. (Fix any dangling imports the carve exposed.)

**Step 4:** Commit.
```bash
git add server/mcp-server-lab/src/tools.js server/mcp-server-lab/src/mcp-permissions.js
git commit -m "feat(lab): carve tool surface to jt_schedule_board stub"
```

### Task 1.6: Real `jt_schedule_board` read handler (TDD)

**Files:**
- Create: `server/mcp-server-lab/src/avenues/schedule-board.js`
- Create: `server/mcp-server-lab/src/avenues/schedule-board.test.js`

**Step 1: Write the failing test.** The handler reshapes a Pave response into board `structuredContent`. Inject a fake `ctx.pave`.
```js
// schedule-board.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { handleScheduleBoard } from './schedule-board.js';

function fakeCtx(paveResponse) {
  return { orgId: 'org1', pave: async () => paveResponse };
}

test('reshapes job tasks into board structuredContent', async () => {
  const ctx = fakeCtx({
    job: {
      id: 'j1', name: 'Smith Kitchen',
      tasks: { nodes: [
        { id: 't1', name: 'Foundation', startDate: '2026-06-01', endDate: '2026-06-03',
          progress: 0, isGroup: false, isToDo: false,
          parentTask: null,
          assignedMemberships: { nodes: [{ id: 'm1', user: { id: 'u1', name: 'Framer Joe' } }] },
          dependentTasks: { nodes: [{ id: 't2', name: 'Framing' }] },
          dependsOnTasks: { nodes: [] } },
      ] },
    },
  });
  const out = await handleScheduleBoard({ jobId: 'j1' }, ctx);
  assert.equal(out.job.id, 'j1');
  assert.equal(out.tasks.length, 1);
  assert.deepEqual(out.tasks[0].assignedMembershipIds, ['m1']);
  assert.deepEqual(out.dependencies, [{ predecessorId: 't1', successorId: 't2' }]);
  assert.equal(out.memberships[0].name, 'Framer Joe');
  assert.ok(out.generatedAt);
});

test('errors when job missing', async () => {
  const out = await handleScheduleBoard({ jobId: 'x' }, fakeCtx({ job: null }));
  assert.equal(out.error, 'Job not found');
});
```

**Step 2: Run → fails** (`handleScheduleBoard not defined`): `node --test src/avenues/schedule-board.test.js`

**Step 3: Implement.** Mirror the dep/assignment field selection from `schedule-context.js:53-100`. Build `dependencies` from each task's `dependentTasks` (predecessor = this task). De-dupe memberships. (Cross-job conflict load is added in Task 4.x — leave `crossJobLoad: []` here.)
```js
// schedule-board.js
export async function handleScheduleBoard(args, ctx) {
  const { jobId } = args || {};
  if (!jobId) return { error: 'Missing required field: jobId' };

  const data = await ctx.pave({
    job: {
      $: { id: jobId },
      id: {}, name: {},
      // moveInDate: confirm the real source (date custom field vs milestone task) — see Open Items.
      tasks: {
        $: { size: 200, where: ['isToDo', '=', false], sortBy: [{ field: 'startDate', order: 'asc' }] },
        nodes: {
          id: {}, name: {}, startDate: {}, endDate: {}, progress: {}, isGroup: {}, isToDo: {},
          parentTask: { id: {} },
          assignedMemberships: { $: { size: 20 }, nodes: { id: {}, user: { id: {}, name: {} } } },
          dependsOnTasks: { nodes: { id: {} } },
          dependentTasks: { nodes: { id: {} } },
        },
      },
    },
  });

  if (!data.job) return { error: 'Job not found' };
  const job = data.job;
  const nodes = job.tasks?.nodes || [];

  const memberships = new Map();
  const dependencies = [];
  const tasks = nodes.map((n) => {
    const memberIds = (n.assignedMemberships?.nodes || []).map((m) => {
      if (m.user?.name) memberships.set(m.id, { id: m.id, name: m.user.name });
      return m.id;
    });
    for (const d of (n.dependentTasks?.nodes || [])) {
      dependencies.push({ predecessorId: n.id, successorId: d.id });
    }
    return {
      id: n.id, name: n.name,
      startDate: n.startDate, endDate: n.endDate,
      progress: n.progress ?? 0,
      isGroup: !!n.isGroup, isToDo: !!n.isToDo,
      parentId: n.parentTask?.id || null,
      assignedMembershipIds: memberIds,
    };
  });

  return {
    job: { id: job.id, name: job.name, moveInDate: job.moveInDate || null },
    tasks,
    dependencies,
    memberships: [...memberships.values()],
    crossJobLoad: [],
    generatedAt: new Date().toISOString(),
  };
}
```

**Step 4: Run → passes.** `node --test src/avenues/schedule-board.test.js`

**Step 5:** Wire it into `tools.js` — replace the stub handler with `handler: (args, ctx) => handleScheduleBoard(args, ctx)` and `import { handleScheduleBoard } from './avenues/schedule-board.js';`. Add `outputSchema` (so the SDK validates structuredContent) using zod that mirrors the shape.

**Step 6:** Commit.
```bash
git add server/mcp-server-lab/src/avenues/schedule-board.js server/mcp-server-lab/src/avenues/schedule-board.test.js server/mcp-server-lab/src/tools.js
git commit -m "feat(lab): jt_schedule_board read handler + structuredContent reshape"
```

### Task 1.7: Register the `ui://schedule-gantt` resource + link it from the tool

**Files:**
- Create: `server/mcp-server-lab/src/gantt/resource.js` (exports the HTML string + a register helper)
- Modify: `server/mcp-server-lab/src/tools.js` (registerAllTools: register the resource; add `_meta` to the board tool)

**Step 1:** Create a minimal resource that just renders the hydrated JSON (proves rendering + hydration before any Gantt drawing):
```js
// gantt/resource.js
export const GANTT_RESOURCE_URI = 'ui://schedule-gantt';
export const GANTT_MIME = 'text/html;profile=mcp-app';

// v1 stub bundle — replaced by the built Gantt in Phase 3.
export const GANTT_HTML = `<!doctype html><html><head><meta charset="utf-8">
<style>body{font-family:Inter,system-ui;background:#252525;color:#e0d8c8;margin:0;padding:16px}</style>
</head><body><h1 style="font-family:Anton,Impact;color:#FE4C0D">SCHEDULE</h1>
<pre id="out">loading…</pre>
<script type="module">
  // MCP Apps host pushes tool output; render it. (Bridge wiring hardened in Task 2.x.)
  function render(data){ document.getElementById('out').textContent = JSON.stringify(data, null, 2); }
  // OpenAI bridge global (ChatGPT) — standard hosts deliver via ui/notifications/tool-result.
  if (window.openai && window.openai.toolOutput) render(window.openai.toolOutput);
  window.addEventListener('openai:set_globals', () => { if (window.openai?.toolOutput) render(window.openai.toolOutput); });
</script></body></html>`;

export function registerGanttResource(server) {
  server.registerResource(
    'schedule-gantt',
    GANTT_RESOURCE_URI,
    { mimeType: GANTT_MIME, _meta: { 'ui': { csp: { connectDomains: [] } } } },
    async () => ({ contents: [{ uri: GANTT_RESOURCE_URI, mimeType: GANTT_MIME, text: GANTT_HTML }] })
  );
}
```
> If Task 1.1 Step 2 showed `registerResource` has a different signature, adapt this call to the actual SDK API (and the `@mcp-ui/server` `createUIResource` helper can build the resource body instead).

**Step 2:** In `registerAllTools` (tools.js), call `registerGanttResource(server)` once. On the `jt_schedule_board` definition add the `_meta` linkage so the host knows to render the resource with the tool's output. Confirm the registration path forwards `_meta` into `server.registerTool` config; if it doesn't, extend the registration call to pass `_meta`:
```js
// board tool def:
_meta: {
  'ui': { resourceUri: 'ui://schedule-gantt' },     // SEP-1865 standard
  'openai/outputTemplate': 'ui://schedule-gantt',    // ChatGPT alias
},
```

**Step 3:** `npx wrangler deploy --dry-run` → clean.

**Step 4:** Deploy for real and smoke-test the resource in the MCPJam inspector before touching a real host:
```bash
npx wrangler deploy
```
Then point MCPJam inspector at `https://jt-mcp-lab.king0light-ai.workers.dev/mcp`, call `jt_schedule_board`, confirm the resource renders and shows the hydrated JSON.

**Step 5:** Commit.
```bash
git add server/mcp-server-lab/src/gantt/resource.js server/mcp-server-lab/src/tools.js
git commit -m "feat(lab): register ui://schedule-gantt resource + link from jt_schedule_board"
```

### Task 1.8: Connect to Claude and confirm the read loop

**Steps (manual, no commit):**
1. In Claude → Settings → Connectors → add custom connector `https://jt-mcp-lab.king0light-ai.workers.dev/mcp`. Complete the OAuth consent (cloned auth).
2. Prompt: "show me the schedule for [a real jobId]".
3. Confirm: the board tool fires, the resource renders in the artifact, hydrated JSON shows the job's tasks.
4. **Milestone:** read loop proven end-to-end. If hydration doesn't fire, debug the bridge (`window.openai.toolOutput` on ChatGPT; `ui/notifications/tool-result` on Claude) — this is the integration crux and must work before Phase 3.

---

# PHASE 2 — Write-back loop (reschedule tool, idempotent, with rollback)

Goal: a tool the iframe can call to commit date changes. Built and tested before the UI can drive it, so Phase 3's drag handler has a proven endpoint.

### Task 2.1: `jt_schedule_reschedule` handler (TDD — happy path)

**Files:**
- Create: `server/mcp-server-lab/src/writes/schedule-reschedule.js`
- Create: `server/mcp-server-lab/src/writes/schedule-reschedule.test.js`

**Step 1: Failing test** — applies each move via `ctx.pave`, serialized, returns per-move results.
```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { handleScheduleReschedule } from './schedule-reschedule.js';

function recordingCtx(failTaskIds = []) {
  const calls = [];
  return {
    calls,
    pave: async (q) => {
      const id = q.updateTask.$.id;
      calls.push(id);
      if (failTaskIds.includes(id)) throw new Error('Pave rejected');
      return { updateTask: { task: { id } } };
    },
  };
}

test('applies all moves serialized, returns success', async () => {
  const ctx = recordingCtx();
  const out = await handleScheduleReschedule(
    { jobId: 'j1', moves: [
      { taskId: 't1', startDate: '2026-06-04', endDate: '2026-06-06' },
      { taskId: 't2', startDate: '2026-06-07', endDate: '2026-06-09' },
    ] }, ctx);
  assert.equal(out.success, true);
  assert.equal(out.count, 2);
  assert.deepEqual(ctx.calls, ['t1', 't2']); // serialized, in order
  assert.deepEqual(out.results, [{ taskId: 't1', ok: true }, { taskId: 't2', ok: true }]);
});
```

**Step 2: Run → fails.** `node --test src/writes/schedule-reschedule.test.js`

**Step 3: Implement.** Plain handler (not `createOpDispatcher` — single operation). Validate, apply serialized, collect results. Let `DryRunSignal` bubble (don't catch it).
```js
import * as qb from '../query-builder.js';

function validMove(m) {
  if (!m || typeof m.taskId !== 'string') return 'taskId required';
  if (!/^\d{4}-\d{2}-\d{2}$/.test(m.startDate || '')) return 'startDate must be YYYY-MM-DD';
  if (!/^\d{4}-\d{2}-\d{2}$/.test(m.endDate || '')) return 'endDate must be YYYY-MM-DD';
  if (m.endDate < m.startDate) return 'endDate must be >= startDate';
  return null;
}

export async function handleScheduleReschedule(args, ctx) {
  const { jobId, moves } = args || {};
  if (!jobId) return { success: false, op: 'reschedule', error: 'Missing required field: jobId' };
  if (!Array.isArray(moves) || moves.length === 0) {
    return { success: false, op: 'reschedule', error: 'moves must be a non-empty array' };
  }
  for (const m of moves) {
    const v = validMove(m);
    if (v) return { success: false, op: 'reschedule', error: `Invalid move (${m?.taskId}): ${v}` };
  }

  const results = [];
  for (const m of moves) { // SERIALIZED — Pave 500s on parallel mutation under a shared parent
    try {
      await ctx.pave(qb.update('task', m.taskId, { startDate: m.startDate, endDate: m.endDate }, { id: {} }));
      results.push({ taskId: m.taskId, ok: true });
    } catch (err) {
      results.push({ taskId: m.taskId, ok: false, error: err.message });
    }
  }
  const allOk = results.every((r) => r.ok);
  return {
    success: allOk,
    op: 'reschedule', entity: 'task',
    count: results.filter((r) => r.ok).length,
    results,
    message: allOk
      ? `Rescheduled ${results.length} task(s)`
      : `Rescheduled ${results.filter(r=>r.ok).length}/${results.length}; ${results.filter(r=>!r.ok).length} failed`,
  };
}
```

**Step 4: Run → passes.**

**Step 5:** Commit.
```bash
git add server/mcp-server-lab/src/writes/schedule-reschedule.js server/mcp-server-lab/src/writes/schedule-reschedule.test.js
git commit -m "feat(lab): jt_schedule_reschedule handler — serialized batched date writes"
```

### Task 2.2: Validation + partial-failure tests

**Step 1:** Add tests: empty moves → error; bad date format → error; `endDate < startDate` → error; one failing taskId → `success:false`, correct `results[]` with the failed entry, and the successful ones still applied.
```js
test('partial failure: reports per-move results, success=false', async () => {
  const ctx = recordingCtx(['t2']);
  const out = await handleScheduleReschedule({ jobId: 'j1', moves: [
    { taskId: 't1', startDate: '2026-06-04', endDate: '2026-06-06' },
    { taskId: 't2', startDate: '2026-06-07', endDate: '2026-06-09' },
  ] }, ctx);
  assert.equal(out.success, false);
  assert.equal(out.count, 1);
  assert.equal(out.results[1].ok, false);
  assert.match(out.results[1].error, /rejected/);
});
test('rejects endDate before startDate', async () => {
  const out = await handleScheduleReschedule({ jobId: 'j1', moves: [
    { taskId: 't1', startDate: '2026-06-06', endDate: '2026-06-04' }] }, recordingCtx());
  assert.equal(out.success, false);
  assert.match(out.error, /endDate/);
});
```

**Step 2: Run → passes** (impl already handles these). **Step 3:** Commit `test(lab): reschedule validation + partial-failure coverage`.

### Task 2.3: Register the write tool with idempotency + outputSchema + dry-run

**Files:**
- Modify: `server/mcp-server-lab/src/tools.js`

**Step 1:** Add the second tool definition. `idempotent: true` enables the dispatcher's `client_request_id` caching (no handler change). `outputSchema` extends the standard envelope with `results[]`.
```js
import { handleScheduleReschedule } from './writes/schedule-reschedule.js';
import { STANDARD_WRITE_OUTPUT_SCHEMA } from './writes/_shared.js';

// add to TOOL_DEFINITIONS:
{
  name: 'jt_schedule_reschedule',
  description: 'Apply a batch of task date moves (dragged task + cascaded dependents) computed by the Gantt. Idempotent via client_request_id. Supports dry_run.',
  schema: {
    jobId: z.string(),
    moves: z.array(z.object({
      taskId: z.string(),
      startDate: z.string().describe('YYYY-MM-DD'),
      endDate: z.string().describe('YYYY-MM-DD'),
    })).describe('The full committed set: the dragged task plus every cascaded dependent.'),
  },
  outputSchema: {
    ...STANDARD_WRITE_OUTPUT_SCHEMA,
    count: z.number().optional(),
    results: z.array(z.object({ taskId: z.string(), ok: z.boolean(), error: z.string().optional() })).optional(),
  },
  idempotent: true,
  handler: (args, ctx) => handleScheduleReschedule(args, ctx),
}
```
> The dispatcher injects `client_request_id` and `dry_run` into the schema for `idempotent` tools (mirrors prod). Confirm by reading the registration loop; if the lab's carve removed that injection, restore it.

**Step 2:** `npx wrangler deploy --dry-run` → clean. Deploy: `npx wrangler deploy`.

**Step 3:** Smoke-test in MCPJam: call `jt_schedule_reschedule` with `dry_run: true` → returns `{ dry_run: true, would_call: 'updateTask', payload }`, no write. Then a real 1-move call on a sandbox job → reopen the job in JobTread, confirm the date moved.

**Step 4:** Commit `feat(lab): register jt_schedule_reschedule (idempotent + dry_run + outputSchema)`.

---

# PHASE 3 — The Gantt bundle (rendering + drag, no brain yet)

Goal: replace the stub resource with a real SVG Gantt that renders the hydrated board and lets you drag a bar, then commit via the Phase-2 tool. Ripple/conflicts come in Phase 4.

### Task 3.1: esbuild pipeline for the bundle

**Files:**
- Create: `server/mcp-server-lab/gantt/src/main.js` (entry — placeholder)
- Create: `server/mcp-server-lab/gantt/build.mjs` (esbuild → single ESM string)
- Modify: `server/mcp-server-lab/package.json` (add `esbuild` devDep + `build:gantt` script)

**Step 1:** `npm install -D esbuild`. Add script `"build:gantt": "node gantt/build.mjs"`.

**Step 2:** `build.mjs` bundles `gantt/src/main.js` → minified ESM, then writes `gantt/dist/gantt.bundle.js` AND regenerates `src/gantt/resource.js`'s `GANTT_HTML` with the bundle inlined inside `<script type="module">…</script>`. (Inline, not external — CSP `connectDomains: []`.)

**Step 3:** `npm run build:gantt` → produces the dist + updated resource. Commit `chore(lab): esbuild pipeline for inlined Gantt bundle`.

### Task 3.2: Board data model + JTPT v5 tokens (TDD on the pure date/scale helpers)

**Files:**
- Create: `server/mcp-server-lab/gantt/src/timescale.js` + `timescale.test.js`
- Create: `server/mcp-server-lab/gantt/src/theme.css.js` (v5 tokens as an inlined string)

**Step 1: Failing tests** for pure helpers: `dateToX(date, {start, pxPerDay})`, `xToDate(x, …)` (snap to day), `daysBetween(a, b)`, weekend detection. These are the math the drag layer depends on — test them headless.

**Step 2: Implement** the pure functions. **Step 3:** Run → pass.

**Step 4:** `theme.css.js` exports the inlined v5 tokens (orange `#FE4C0D`, Anton/Inter/JetBrains Mono with system fallback, `.dark-theme` palette `#252525`/`#2c2c2c`/`#e0d8c8`, sharp radii, `0 2px 0` hard shadow) — copied from `JT-Tools-Master/popup/popup.css:10-153`.

**Step 5:** Commit `feat(gantt): timescale helpers + v5 theme tokens`.

### Task 3.3: Render the Gantt from hydrated data

**Files:**
- Modify: `server/mcp-server-lab/gantt/src/main.js`
- Create: `server/mcp-server-lab/gantt/src/render.js`

**Step 1:** `render.js` builds the SVG/HTML: left rail (task name + assignee chip, indented by `parentId`), timeline columns (days, weekends shaded), bars positioned via `timescale`, dependency arrows, a "today" rule, a `moveInDate` milestone marker. Read host `theme` and toggle `.dark-theme`.

**Step 2:** `main.js` wires hydration (both `window.openai.toolOutput` and the standard `ui/notifications/tool-result` path), calls `render(boardData)`.

**Step 3:** `npm run build:gantt`, `npx wrangler deploy`, view in MCPJam → the real job's bars render. (Visual QA — no unit test for SVG.)

**Step 4:** Commit `feat(gantt): SVG Gantt render from hydrated board data`.

### Task 3.4: Drag-to-move a single bar + Commit/Reset bar (no ripple yet)

**Files:**
- Modify: `server/mcp-server-lab/gantt/src/main.js`
- Create: `server/mcp-server-lab/gantt/src/drag.js`

**Step 1:** Pointer drag handler: grab a bar, move horizontally, snap to day grid via `xToDate`, show the bar at its proposed position (ghost). Track pending moves in memory (`Map<taskId, {startDate,endDate}>`).

**Step 2:** Commit/Reset action bar (orange-flame `.btn-primary` styling) appears when pending moves exist. **Reset** clears ghosts. **Commit** generates a `client_request_id` (`crypto.randomUUID()`) and calls the tool:
```js
async function commit(jobId, pending) {
  const moves = [...pending.entries()].map(([taskId, d]) => ({ taskId, ...d }));
  const id = crypto.randomUUID();
  const res = await callTool('jt_schedule_reschedule', { jobId, moves, client_request_id: id });
  return res; // reconcile in Task 3.5
}
// callTool: window.openai.callTool on ChatGPT; ui/JSON-RPC tools/call on standard hosts.
```

**Step 3:** Build, deploy, test in Claude: drag the foundation bar 3 days → Commit → reopen the job in JobTread, date moved. **Milestone: full bidirectional loop proven (single bar).**

**Step 4:** Commit `feat(gantt): drag-to-move single bar + batched commit`.

### Task 3.5: Reconcile commit result (rollback on failure)

**Files:**
- Modify: `server/mcp-server-lab/gantt/src/main.js`

**Step 1:** On commit response: successful `results[]` bars settle into new positions; failed bars snap back with a red chip (`badge-fail`) showing the error; whole-call failure keeps ghosts + shows an error banner with retry (reusing the same `client_request_id`). Re-render from the post-commit actual state.

**Step 2:** Build, deploy, test partial failure (temporarily point a move at a bogus taskId) → that bar rolls back, others persist.

**Step 3:** Commit `feat(gantt): reconcile commit results + selective rollback`.

---

# PHASE 4 — The brain (ripple + conflicts)

Goal: dragging one bar ripples dependents live; conflicts flag inline. Pure functions, fully TDD'd, then wired into the drag loop.

### Task 4.1: Ripple engine (TDD)

**Files:**
- Create: `server/mcp-server-lab/gantt/src/ripple.js` + `ripple.test.js`

**Step 1: Failing tests** for `computeRipple(tasks, dependencies, move)` → returns `Map<taskId, {startDate,endDate}>` of all shifted tasks (including the moved one). Cases: single finish-to-start dep shifts successor; multi-hop cascade; no-dependents → only the moved task; diamond (two paths to one successor → max shift wins); cycle guard (no infinite loop); a move that *shortens* slack does NOT pull a successor earlier (ripple only pushes forward).
```js
test('single dependent shifts to preserve finish-to-start', () => {
  const tasks = [
    { id:'t1', startDate:'2026-06-01', endDate:'2026-06-03' },
    { id:'t2', startDate:'2026-06-04', endDate:'2026-06-06' },
  ];
  const deps = [{ predecessorId:'t1', successorId:'t2' }];
  const out = computeRipple(tasks, deps, { taskId:'t1', startDate:'2026-06-04', endDate:'2026-06-06' });
  assert.deepEqual(out.get('t1'), { startDate:'2026-06-04', endDate:'2026-06-06' });
  assert.equal(out.get('t2').startDate, '2026-06-09'); // pushed: was 1 day after t1.end, preserve gap (skip weekend per Task 4.3)
});
```

**Step 2: Implement** as a forward topological pass: maintain proposed dates, for each dep where `successor.start < predecessor.end + gap` push the successor; cascade via a queue; guard visited to break cycles. Keep date math in a pure helper (reuse `timescale`/a `dateAdd` util). (Weekend-aware shifting added in 4.3.)

**Step 3:** Run → pass. **Step 4:** Commit `feat(gantt): pure ripple engine + tests`.

### Task 4.2: Conflict engine (TDD)

**Files:**
- Create: `server/mcp-server-lab/gantt/src/conflicts.js` + `conflicts.test.js`

**Step 1: Failing tests** for `detectConflicts(proposed, { tasks, job, crossJobLoad })` → returns `[{ taskId, type:'milestone'|'doubleBook', message }]`. Cases: a proposed task crossing `job.moveInDate` → milestone flag; a moved task's membership overlapping a `crossJobLoad` entry's date range → doubleBook flag with the other job name; clean → `[]`.

**Step 2: Implement** — pure date-range overlap + milestone comparison. **Step 3:** Run → pass. **Step 4:** Commit `feat(gantt): pure conflict engine + tests`.

### Task 4.3: Weekend-aware shifting (TDD)

**Step 1:** Extend `ripple.js` so pushed dates skip weekends (matching the extension's drag-drop convention), with a `{ allowWeekend }` flag (Shift override). Add tests: a push landing on Saturday rolls to Monday; `allowWeekend:true` lands on Saturday.

**Step 2:** Run → pass. **Step 3:** Commit `feat(gantt): weekend-aware ripple shifting`.

### Task 4.4: Wire ripple + conflicts into the drag loop

**Files:**
- Modify: `server/mcp-server-lab/gantt/src/main.js`, `drag.js`

**Step 1:** On each drag tick: `computeRipple` over the current graph → render all shifted tasks as ghosts → `detectConflicts` on the proposed set → render inline chips (`badge-fail`/`badge-warn`) + a summary banner. Commit sends the full rippled set as `moves[]` (every changed task), not just the dragged one.

**Step 2:** Build, deploy, test in Claude: drag foundation +3 days → framing/inspection ripple live → a conflict banner appears when a dependent crosses the move-in date → Commit writes the whole cascade → verify in JobTread.

**Step 3:** Commit `feat(gantt): live ripple + conflict flags wired into drag`.

### Task 4.5: Cross-job load for double-book detection

**Files:**
- Modify: `server/mcp-server-lab/src/avenues/schedule-board.js` + its test

**Step 1: Failing test:** with `includeConflicts` (default true), the board populates `crossJobLoad[]` from other jobs' tasks assigned to the board's memberships.

**Step 2: Implement** — after the job query, for the set of `assignedMembershipIds`, query org-wide tasks (other jobs) assigned to those memberships with their dates + job name. Reuse the membership-filter pattern from `schedule-context.js:414-419`. Cap size; tolerate empty.

**Step 3:** Run → pass. Build/deploy. In Claude, drag a task so its assignee overlaps another job → amber double-book flag naming the other job.

**Step 4:** Commit `feat(lab): cross-job load in board for double-book conflicts`.

---

# PHASE 5 — Hardening & polish

### Task 5.1: Full regression + both-host smoke
- Run every `*.test.js` under `server/mcp-server-lab/src/` and `gantt/src/`: `node --test src/**/*.test.js gantt/src/**/*.test.js` (or loop). All green.
- Smoke-test the full loop in **Claude** and **ChatGPT** (the `window.openai` bridge vs standard JSON-RPC path — confirm the same bundle renders + commits in both). Note any divergence.
- Commit any fixes.

### Task 5.2: Theme + empty/error states
- Confirm host light/dark sync. Empty schedule → friendly empty state. Board fetch error → in-iframe error card (not a blank frame).
- Commit `feat(gantt): theme sync + empty/error states`.

### Task 5.3: CHANGELOG + design-doc status
- Add a CHANGELOG entry under `[Unreleased] → Added` for the lab Gantt MCP App.
- Flip the design doc status to "Implemented (lab)".
- Commit `docs: changelog + design status for lab Gantt`.

---

## Open items to resolve during implementation (flagged in the design)
- **`moveInDate` source** (Task 1.6 / 4.2): confirm whether it's a date custom field on the job or a milestone task. Adjust the board query accordingly. If unavailable, omit the milestone marker + milestone conflict for v1.
- **SDK API surface** (Task 1.1): if `registerResource` / tool `_meta` differ from assumed, adapt registration to the installed SDK + `@mcp-ui/server`.
- **`callTool` naming** (Task 3.4): `window.openai.callTool` (ChatGPT) vs the standard host's `tools/call` over postMessage — implement both branches behind one `callTool()` wrapper.
- **Consent UX** (Task 3.4/5.1): observe whether Claude/ChatGPT prompts per commit; `destructiveHint:false` should soften it. If it's intrusive, evaluate a host-side "always allow" path.

---

## Execution handoff

Plan complete and saved to `docs/plans/2026-05-27-interactive-schedule-gantt.md`. Two execution options:

**1. Subagent-Driven (this session)** — I dispatch a fresh subagent per task, review between tasks, fast iteration.

**2. Parallel Session (separate)** — open a new session with superpowers:executing-plans for batch execution with checkpoints.

Which approach?
