# Interactive Schedule Gantt — MCP App Design

> **Status:** Approved design (2026-05-27). Implementation plan to follow.
> **Owner:** King0lightai
> **Scope:** First bidirectional interactive MCP artifact for JT Power Tools — a draggable
> schedule Gantt that writes changes back to JobTread, built as an MCP App (SEP-1865),
> deployed on a **separate cloned MCP server** so production users are untouched.

---

## 1. The bet

Evolve JT Power Tools from "Chrome extension + MCP server" toward an **interactive MCP
artifact layer** over JobTread — surfaces that fabricate themselves around the question,
that you manipulate directly, with the AI reasoning alongside, writing straight back to the
system of record.

The **Schedule Gantt** is the wedge: the iconic "play the schedule like an instrument"
demo, a bounded write surface (task dates + dependency ripple), and the purest expression
of *manipulate → AI narrates consequences → commit*. Prove the loop here on a contained
domain, then assemble the larger surfaces (estimate canvas, decision war room, job cockpit,
client experience, L10 situation room) from proven pieces.

### Locked decisions
| Pillar | Decision |
|---|---|
| Surface | Schedule Gantt |
| Interaction | True **bidirectional** — the artifact itself calls back |
| Deployment | **Separate cloned MCP server** (`jt-mcp-lab`), prod untouched |
| Standard | **MCP Apps (SEP-1865 / OpenAI Apps SDK)** |
| v1 depth | Drag-to-move + full dependency **ripple** + **conflict flags** (milestone breach, resource double-book) |
| Styling | JTPT popup v5 design system, inlined + host-theme-synced |

---

## 2. Research findings (verified against primary sources, May 2026)

- **MCP Apps render in production TODAY** in Claude (web + desktop), Goose, and VS Code
  Insiders as of the Jan 26 2026 release; ChatGPT via the Apps SDK the same week. This is
  **live in our own primary tool** — not 18 months out.
- **MCP-UI and MCP Apps converged.** SEP-1865 ("MCP Apps") is the official MCP extension
  that unified mcp-ui (idosal) + OpenAI's Apps SDK into one standard. mcp-ui's SDKs
  (`@mcp-ui/server`, `@mcp-ui/client`) are the **reference implementation**. There is no
  "mcp-ui vs MCP Apps" choice — they're one track.
- **The loop:** a tool returns `structuredContent` and links a pre-declared `ui://` resource
  via `_meta.ui.resourceUri` (standard) / `_meta["openai/outputTemplate"]` (ChatGPT alias);
  mimeType `text/html;profile=mcp-app` (standard) / `text/html+skybridge` (OpenAI). The host
  renders it in a **sandboxed iframe**, hydrates via `ui/notifications/tool-result`. The
  iframe is **an MCP client over JSON-RPC via postMessage** — there is deliberately **no
  `window.mcp` global**; on ChatGPT you get `window.openai` (`callTool`, `sendFollowUpMessage`,
  `toolOutput`, `theme`, …). Write back via `tools/call`.
- **Consent constraint:** hosts *can* require explicit approval for UI-initiated tool calls,
  and for side-effecting tools (`readOnlyHint: false`) they likely will. → **Batch the write
  to one call on release**, never per-drag-tick, so at most one prompt per committed move.
- **`widgetState` is non-portable** (in OpenAI's reference, absent from build guides) →
  persist state via tool output re-hydration, not `widgetState`.
- **Code Mode is orthogonal** — agent-side token efficiency (search/execute, V8 isolates),
  nothing to do with rendering. Park it as a *separate* future track for the 72-tool prod
  server (improvement-plan G9); do **not** couple it to the Gantt.

---

## 3. Architecture & isolation (Approach: clone-and-carve)

Clone `server/mcp-server/` → `server/mcp-server-lab/`, deploy as worker `jt-mcp-lab` with
its own `wrangler.jsonc`. Prod (`jobtread-mcp-server`) is never touched.

### Binding strategy (the isolation contract)
| Binding | Lab approach | Why |
|---|---|---|
| `DB` / `TEAM_DB` (`jobtread-extension-users`) | Reuse prod, **read-only** | Authenticate the dev's own license + read the grant key. Lab never writes the user DB (no team-notes/bills writes carried over). |
| `OAUTH_KV` | **Fresh namespace** | Claude.ai connects to the lab as its own custom connector; no collision with prod tokens. |
| `IDEMPOTENCY_KV` | **Fresh namespace** | Reschedule writes are idempotent, scoped to the lab. |
| `CONTEXT_KV` / `CONTEXT_DB` | **Dropped** | The board payload is bounded; no context-mode truncation needed. |
| JobTread (Pave) | Via the dev's grant key | Reads + the one batched write, as prod does. |

> **Cloudflare account note:** all lab bindings live in the **king0light.ai@gmail.com**
> account (`10c7f8f1…`), where `wrangler` is authed and the prod worker deploys. The
> Cloudflare MCP connector is authed to a *different* account (Zee@tituscontracting.com) —
> create namespaces from the `wrangler` CLI, not the MCP. (See memory: reference-cloudflare-accounts.)

### The carve
Keep the hardened auth stack (OAuth 2.1 + Bearer) — needed for Claude.ai to connect. Delete
all other tools. Lab surface = **2 tools + 1 resource**.

### Request-time loop
```
Claude.ai / ChatGPT ──connect──▶ jt-mcp-lab (Cloudflare Worker)
  │  call jt_schedule_board(jobId)        → reads Pave, returns structuredContent
  │  ◀── tool result + _meta.ui ──────────  + links ui://schedule-gantt
  ├─ host renders ui://schedule-gantt in sandboxed iframe, hydrates with board data
  ├─ drag bars; ripple + conflicts computed INSIDE the iframe (no network)
  └─ on release → iframe tools/call → jt_schedule_reschedule → Pave → JobTread
```

### Promotion path
Once proven, cherry-pick the three artifacts — `ui://schedule-gantt`, `jt_schedule_board`,
`jt_schedule_reschedule` — back into prod as a single feature. Nothing else migrates.

---

## 4. The MCP surface (2 tools + 1 resource)

### ① `jt_schedule_board(jobId)` — read tool `readOnlyHint: true`
Returns `structuredContent`:
```jsonc
{
  "job":   { "id", "name", "moveInDate?" },          // moveInDate from a job date field / milestone task
  "tasks": [{ "id","name","startDate","endDate","progress","isGroup","isToDo",
              "parentId","assignedMembershipIds":[] }],
  "dependencies": [{ "predecessorId","successorId" }],   // from dependsOnTasks
  "memberships":  [{ "id","name" }],
  "crossJobLoad": [{ "membershipId","jobId","jobName","taskId","startDate","endDate" }], // double-book math
  "generatedAt": "ISO"
}
```
Links the UI via both keys (renders in Claude AND ChatGPT):
```jsonc
"_meta": { "ui": { "resourceUri": "ui://schedule-gantt" },
           "openai/outputTemplate": "ui://schedule-gantt" }
```
Reuses the existing schedule-read Pave query, reshaped. `crossJobLoad` pulls tasks across
jobs for each assigned membership (feasible via `assignedMemberships` + per-membership task
dates).

### ② `ui://schedule-gantt` — UI resource (new `resources` capability for this server)
- mimeType `text/html;profile=mcp-app`; self-contained HTML + inlined esbuild ESM bundle.
- `_meta.ui.csp`: `connectDomains: []` — no external fetches; all data via hydration, all
  writes via the bridge. Tightest sandbox.

### ③ `jt_schedule_reschedule(jobId, moves[])` — write tool `readOnlyHint:false`, `destructiveHint:false`
```jsonc
{ "jobId", "moves": [{ "taskId","startDate","endDate" }],
  "client_request_id?": "uuid",   // idempotency
  "dry_run?": true }              // simulate
```
- `moves` = the full committed set the iframe computed (dragged + cascaded dependents).
- Server **applies dates, does not recompute the ripple** — trusts the client graph but
  validates each move (parseable dates, `end ≥ start`, task ∈ jobId).
- Writes **serialized** (Pave 500s on parallel mutation under a shared parent).
- `destructiveHint:false` — a reschedule is a reversible update; softer consent.
- Returns the standard write envelope + **per-move `results[]`** for selective rollback.

**Deliberate v1 choice:** dependency *correctness* lives in the iframe; the server is a
dumb, safe date-applier. Every move is still individually validated and reversible.

---

## 5. The iframe bundle (the brain)

**Packaging.** One self-contained HTML doc with an inlined esbuild ESM bundle. Zero external
requests (`csp.connectDomains: []`). JTPT v5 tokens inlined (orange flame `#FE4C0D`, Anton
display / Inter body / JetBrains Mono, sharp 4–8px radii, light-default + `.dark-theme`, the
`0 2px 0` hard shadow). Fonts: system fallback for v1 (popup stack degrades gracefully);
base64-embed Anton later for full brand fidelity. **Theme-synced to host** via the bridge
`theme` global + `openai:set_globals` event.

**Rendering.** SVG/HTML Gantt: rows = tasks indented under parent groups (left rail = name +
assignee chip); timeline columns = days (zoom to weeks), weekends shaded; bars by start/end,
fill tinted by `progress`; dependency arrows; a "today" rule; a `moveInDate` milestone marker.

**Interaction.** Grab a bar, drag horizontally, snap to day grid. v1 = **move**; edge-resize
(end date only) is a trivial follow-on. Weekend skipping follows the extension's existing
drag-drop conventions (Shift overrides to allow weekend landing).

**Ripple engine (pure, client-side, instant).** `computeRipple(tasks, deps, move)`: forward
topological pass — for a finish-to-start dep, `successor.start ≥ predecessor.end`; shift the
minimum and cascade. Downstream tasks render as **ghosted proposed positions** live, no
network.

**Conflict engine (pure).** `detectConflicts(proposed, job, crossJobLoad)`:
1. **Milestone breach** — any task crossing `job.moveInDate` → red flag.
2. **Resource double-book** — moved task's membership overlapping another job in
   `crossJobLoad` → amber flag.
Surfaced as inline chips + a summary banner, styled to the popup badge system
(`badge-fail` / `badge-warn` / `badge-pass`).

**Commit / Reset bar.** Appears on first pending move. **Commit** fires the batched write;
**Reset** drops ghosts to original. Pending state in iframe memory; reconciled from the fresh
tool result on success (not `widgetState`).

---

## 6. Write-back, consent, idempotency & rollback

**Commit flow:** assemble `moves[]` → generate one `client_request_id` → `tools/call
jt_schedule_reschedule` → (one batched consent prompt) → server validates → idempotency check
→ apply serialized → returns `{ success, op:"reschedule", count, results[], idempotent_replay? }`
→ host pushes fresh `tool-result` → iframe reconciles ghosts into actuals.

**Idempotency** (reuses today's deployed infra): key `idem:{licenseId}:jt_schedule_reschedule:{id}`,
24h TTL in `IDEMPOTENCY_KV`. Retry of the same commit returns the cached result with
`idempotent_replay: true` — never double-writes. Further edits → a fresh id.

**Rollback matrix:**
| Failure | Behavior |
|---|---|
| Whole-call fails (network/auth/5xx) | Ghosts stay, error banner, Commit re-enabled; retry reuses the same `client_request_id`. |
| Partial (some ok, some fail) | `results[]` drives selective rollback — failed bars snap back with a red chip + error; graph recomputed from actual post-commit state. |
| Consent denied | No-op cancel; ghosts remain, Commit available. |
| Stale board | v1 = last-write-wins; post-commit re-hydration shows reality. (Optimistic-concurrency via `generatedAt` is v1.1.) |

**Permission:** runs under the dev's grant key through the same `mcp-permissions` write-tier
gate prod uses; `dry_run` previews the payload without mutating.

---

## 7. Testing & standup

**Testing — separation is the key decision.** Ripple + conflict engines are **pure
functions**, DOM-decoupled, tested headless; only the thin render/drag layer needs eyeballs.
- `computeRipple` — single-dep shift, multi-hop cascade, no-dep no-op, weekend skip, diamond
  dependency, cycle guard.
- `detectConflicts` — milestone breach, double-book overlap, clean case.
- `jt_schedule_reschedule` handler — invalid/bad dates, wrong-job rejection, idempotency
  hit/miss, partial-failure shape, serialized order, `dry_run` payload. Mirrors the existing
  `idempotency.test.js` / write-tool patterns.
- `jt_schedule_board` handler — Pave→board reshape, both `_meta` keys present.
- Contract test — `ui://schedule-gantt` registers, correct mimeType, `_meta.ui.resourceUri`
  matches.
- Visual — render the resource in the MCPJam inspector / mcp-ui playground to drag without a
  full host; then real-host smoke test in Claude + ChatGPT.

**Standup:**
1. **Clone** `server/mcp-server` → `server/mcp-server-lab`; `wrangler.jsonc` name `jt-mcp-lab`,
   fresh `OAUTH_KV` + `IDEMPOTENCY_KV` (wrangler CLI, king0light acct), reuse `DB` read, drop
   `CONTEXT_*`.
2. **Carve** — delete all tools but schedule-read; add `jt_schedule_board` +
   `jt_schedule_reschedule`; register the `ui://schedule-gantt` resource (adds the resources
   capability — new to this server).
3. **Bundle** — esbuild the Gantt → single ESM → inline into the resource HTML.
4. **Deploy** — `npx wrangler deploy` → `jt-mcp-lab.<…>.workers.dev`.
5. **Connect** — add `jt-mcp-lab` as a custom connector in Claude (cloned OAuth).
6. **Demo** — "show me the schedule for [job]" → board renders → drag foundation +3d →
   framing/inspection ripple → conflict banner → Commit → reopen the job in JobTread, dates
   moved.
7. **Iterate** — redeploy freely (isolated); when proven, cherry-pick the 3 artifacts into prod.

**Safety:** lab authenticates only the dev's license (not exposed to other users); reschedule
is reversible; rehearse on a sandbox job first.

---

## 8. Open items to confirm at build time (none blocking)
- SEP-1865 formal status (Draft vs Final) — confirm against the `modelcontextprotocol/ext-apps` repo when scaffolding.
- Exact `callServerTool` vs `window.openai.callTool` naming per target host SDK.
- Verify the same bundle renders identically in Claude *and* ChatGPT (hydration globals differ).
- `moveInDate` source on the JobTread job (date custom field vs milestone task) — confirm against the org's schema.
