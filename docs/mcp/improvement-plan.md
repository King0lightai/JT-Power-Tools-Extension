# JT Power Tools MCP Server — Improvement Plan

> Companion to `docs/mcp/best-practices.md`. Built from a direct audit of
> `server/mcp-server/src/` (May 2026) plus a deep-dive on Anthropic guidance,
> the MCP spec (June + November 2025), production-server postmortems, and
> the Cloudflare Code Mode pattern.
>
> **Bottom line up front:** the server is in better shape than most. Three
> areas concentrate the highest ROI improvements: `outputSchema` adoption,
> error-response pedagogy, and a strategic decision on Code Mode. Hold the
> line at ~32 tools — published benchmarks show tool-count degradation is a
> cliff, not a slope.

---

## Audit summary — what's already strong

These are working well and should be **preserved, not refactored**:

1. **Tool description quality.** `jt_bills_inbox` (tools.js:7945) reads like
   an agent-facing tutorial — numbered workflow, kind-routing signals with
   real vendor examples (Home Depot, Lowe's, Costco), QBO override field
   semantics. `jt_job_context` (tools.js:7510) calls out depth modes,
   `headerDepth` payload tactics, and value units (cents vs dollars
   distinction is explicit). Independent research finds description quality
   alone is +11.6% on tool-call functionality and +8.8% on accuracy across a
   10,831-server study. This server is already doing what the literature
   says drives the biggest gains.

2. **Permission system.** `mcp-permissions.js` implements three tiers
   (read / write / delete), two-layer enforcement (tool category + op-level
   `destructiveOps` escalation), least-privileged default for unknown tools,
   and a 403 message that names the required tier and points the user to the
   portal. Better than most production MCP servers.

3. **Context-mode infrastructure.** `context-mode/index.js` does structural
   array truncation first, falls back to head/tail string slicing only when
   wide-not-deep, surfaces a `_truncationApplied` block describing what
   happened. Combined with intent-driven indexing and FTS5 BM25 search,
   this is the sophisticated answer to the 25,000-token Claude Code response
   ceiling.

4. **In-context teaching.** The hint at tools.js:9087-9091 — when
   `jt_raw_query` truncates >10KB without intent, the response prepends a
   one-line hint telling the agent to retry with `intent: "..."`. This is
   the right pattern (errors that teach next-tool-to-call) and just needs
   to be applied to other error paths.

5. **Annotations.** `readOnlyHint`, `destructiveHint`, `openWorldHint` set
   per tool — honest signals to the host.

6. **Dual registration path.** Dispatcher at tools.js:9123 cleanly forks
   between `server.registerTool` (June 2025 spec, `outputSchema` +
   `structuredContent`) and legacy `server.tool` — so `outputSchema` rollout
   can be incremental without breaking the rest.

---

## Tool inventory

**31 tools follow the `jt_*` convention.** 3 don't:

| Tool | Location | Issue |
|------|----------|-------|
| `team_notebooks` | tools.js:7814 | No service prefix |
| `jobtread_compare_budgets` | tools.js:7874 | Long-form `jobtread_` prefix instead of `jt_` |
| `jobtread_list_data_view_fields` | tools.js:8184 | Long-form `jobtread_` prefix |

Plus a stale `reject_bill` entry in `mcp-permissions.js:166` that doesn't
appear in the tool list — likely a leftover from the bills-inbox
consolidation.

---

## Gaps, ranked by ROI

### Tier 1 — High ROI, low effort

#### G1. Adopt `outputSchema` across all read tools

**Current state:** only 3 of ~34 tools declare `outputSchema`
(`jobtread_compare_budgets`:7881, `jobtread_list_data_view_fields`:8190,
`jt_job_write`:8347). A `// Phase 1 scope` comment at tools.js:9107
acknowledges this and notes LARGE-response tools (avenue context bundles,
`jt_raw_query`) need a `structuredContent` path that respects context-mode
trimming.

**Why it matters:** the June 2025 MCP spec introduced `outputSchema` +
`structuredContent` precisely so agents can parse tool results
programmatically instead of regex-scraping prose. It also gives you
schema-validation-during-test for free — drift in the response shape fails
the build instead of leaking to production.

**Fix:**
1. Phase 2 plan, in priority order:
   - Smaller write tools first: `jt_task_write`, `jt_budget_write`,
     `jt_contact_write`, `jt_comment_write`, `jt_daily_log_write`,
     `jt_time_entry_write`, `jt_dashboard_write`, `jt_workflow_write`,
     `jt_webhook_write`, `jt_catalog_write`, `jt_document_write`,
     `jt_files`, `jt_tweaks`, `jt_forms`, `jt_notes`. Same pattern as
     `jt_job_write`:8347 — `{success, op, entity, id, message?, error?}`.
   - Read tools that return small shapes: `jt_search`, `jt_budget_find`,
     `jt_email_address`, `jt_email`.
2. Phase 3 plan, with structured trimming:
   - Avenue context bundles return nested objects already. Define
     `outputSchema` per top-level key (`job`, `budget`, `schedule`, etc.)
     and emit `structuredContent` from the pre-truncation source, with the
     human-rendered text block (the truncated/filtered prose) as the
     fallback `content`. Both paths coexist — schema describes the full
     shape; the text content is the token-budgeted rendering.
3. `jt_raw_query`: schema is genuinely open. Keep text-only or define a
   minimal envelope `{rows, nextCursor, _meta}`.

**Effort:** ~1 sprint for Phase 2, ~1 sprint for Phase 3.

#### G2. Fix the 3 naming outliers and the stale permission entry

**Current state:** see inventory table above.

**Why it matters:** Anthropic's "Writing effective tools" guide and SEP-986
both call out service-prefix consistency. Inconsistent naming on a small
minority is worse than 100% inconsistent — the agent learns the prefix
pattern and then mis-predicts on the outliers.

**Fix:**
- Rename: `team_notebooks` → `jt_team_notebooks`,
  `jobtread_compare_budgets` → `jt_budget_compare`,
  `jobtread_list_data_view_fields` → `jt_data_view_fields`.
- Keep old names as aliases for one release cycle. Emit a deprecation
  notice in the tool description so the host can warn callers.
- Remove `reject_bill` from `mcp-permissions.js:166` — it's no longer a
  registered tool (consolidated into `jt_bills_inbox` with op:"reject").

**Effort:** half-day plus a docs migration line in CHANGELOG.

#### G3. Make errors teach

**Current state:** dispatcher returns generic
`{ content: [{ type: 'text', text: 'Error: ' + msg }], isError: true }` at
tools.js:9119 and 9043 and 9211. Compare to the truncation-hint pattern at
tools.js:9087 — that's the right pattern, just not extended.

**Why it matters:** an error that says "missing field X — call `tool_y`
first to get it" measurably cuts retry loops. Agents fail at the same
spots repeatedly when errors are generic.

**Fix:** error-classification table per tool, returning a `next_steps`
hint in the error envelope. Top failure modes worth hand-tuned hints:
- 401/403 from Pave → `"Your AI key tier is '<X>' — this op needs '<Y>'.
  Ask admin to upgrade at app.jtpowertools.com → AI Grant Keys."`
  (the message you already have in `permissionDeniedMessage` — extend the
  same shape to other errors).
- Missing required ID → `"Call jt_search with query='<term>' to get the
  jobId/accountId first."`
- Budget item not found → `"jt_budget_find with jobId='<id>' lists current
  items."`
- Pave 5xx / network → `"Pave returned 5xx; safe to retry with the same
  args."`
- Validation failure on `*_write` → echo back the field name and an example
  value.

**Effort:** 1-2 days. Build it as a small `errorHint(toolName, errorType,
context)` helper called from the existing catch.

### Tier 2 — Medium effort, meaningful impact

#### G4. Add `client_request_id` for idempotent writes

**Current state:** sampled `jt_job_write`:8321, `jt_task_write`:8367,
`jt_budget_write`:8396 — none accept a client-generated request ID. Agent
retries can produce duplicate jobs / tasks / budget items.

**Why it matters:** agents retry and parallelize. Without idempotency keys,
network blips become data quality incidents.

**Fix:** add optional `client_request_id: z.string().uuid().optional()` to
every `*_write` schema. Handler stores `(client_request_id → result)` in a
KV namespace with 24-hour TTL. On retry with the same ID, return the
cached result instead of re-executing the Pave mutation.

**Effort:** 2-3 days plus a KV namespace binding.

#### G5. `dry_run` mode on writes

**Current state:** no write tool accepts a dry-run / simulate flag. For
destructive ops (`jt_job_write` op:"delete", `jt_workflow_write`
op:"cancelRun", any `jt_*_write` op:"delete*"), this is a meaningful
safety gap.

**Why it matters:** lets the agent self-correct before committing. Cuts
"I deleted the wrong job" Slack threads to zero.

**Fix:** add `dry_run: z.boolean().optional()` to every `*_write` schema.
When true: validate args, build the Pave mutation payload, return
`{would_call: '...', payload: {...}, predicted_effect: '...'}` without
calling Pave.

**Effort:** ~1 day per write tool family if the handlers share a
build-payload helper (looks like they do via `writes/_shared.js`).

#### G6. Elicitation on destructive ops

**Current state:** `destructiveHint: true` is set as an annotation — an
honest signal to the host but not enforcement.

**Why it matters:** the June 2025 spec added `elicitation/create` so the
server can pause mid-tool-call, ask the host to prompt the user, and only
proceed on confirmation. From the spec: even if an LLM is manipulated via
prompt injection, the host can block execution. This is the spec-blessed
answer to "writes scare me."

**Fix:** for any op in `destructiveOps`, before dispatching to the Pave
handler, emit `elicitation/create` with a message like *"Delete job
'Smith Kitchen' (jobId: abc123)? This removes the job, its budget, and
all associated tasks."* and a `confirm: boolean` schema. Only proceed on
true. Gracefully no-op for clients that don't advertise elicitation
capability (you'll see this in the `initialize` response).

**Effort:** ~3 days including capability negotiation handling.

#### G7. MCP Resources for reference docs

**Current state:** the server exposes 34 tools, but `jt_knowledge` returns
docs by op as if they were tool calls. Notion's MCP server pattern (and
the spec's recommendation): reference material that the agent pulls *only
when relevant* belongs as MCP `resources/*`, not as tool responses.

**Why it matters:** reference content (Pave query syntax, JT data model
docs, SOPs) is the kind of material the agent should be able to *resolve
on demand* without burning a tool-call slot. Resources are listed in
metadata but content only loads when read — different cost profile from
tools.

**Fix:**
- Expose `pave://reference/{topic}` resources for each Pave reference
  doc currently behind `jt_knowledge` (op:"get").
- Expose `jt://sop/{slug}` resources for Titus Way SOPs surfaced via
  SharePoint (when sync is wired).
- Keep `jt_knowledge` for search; `resources/read` handles single-doc
  fetch.

**Effort:** ~3-5 days. Touches `index.js` and adds a resources handler.

#### G8. Eval harness for tool-call accuracy

**Current state:** unit tests exist for individual handlers
(`*-write.test.js`, `query-builder.test.js`) but no harness measures
"given prompt X, does the agent pick the right tool sequence?"

**Why it matters:** published benchmarks (MCP-Atlas, MCPMark, MCP-Bench)
show even SOTA models fail 30-50% of realistic multi-step MCP workflows.
Description tweaks have the biggest measurable impact, but without a
harness you can't tell whether a description change helped or hurt.

**Fix:**
- Build a private eval set: 50-100 realistic Titus-domain prompts ("show
  me overdue tasks on Smith Kitchen", "approve this bill against PO
  17-04", "list active jobs missing daily logs this week") with
  ground-truth expected tool sequences.
- Run the eval against `claude-opus-4-7` and `claude-sonnet-4-6` on every
  description change. Track tool-hit-rate per tool.
- Tools called <5% of the time when they should be → fix the description,
  not the tool.

**Effort:** ~1 sprint for the harness + initial eval set. Recurring
maintenance: ~1 day per release.

### Tier 3 — Strategic

#### G9. Code Mode endpoint (long-term direction)

**Current state:** 34 tools loaded upfront, ~1,500-2,000 tokens of tool
metadata in every request. Even with `tool_search` host-side, the
discovery layer is implicit.

**Why it matters — this is the big one:** Cloudflare's own "Code Mode"
pattern (which they ship as `@cloudflare/codemode` and use for their own
MCP server) collapses an entire API into **two tools** — `search()` +
`execute()`. The agent writes a TypeScript snippet that imports just the
tool wrappers it needs and runs it in a V8 isolate; only the final result
returns to context. Published numbers: **99.2% reduction in tool-metadata
tokens (150K → 1.2K)** across a 112-tool surface; **92.5% reduction in
typical multi-tool conversation tokens (80K → 6K)**; **~108ms warm
execution latency** with pooled isolates. Cloudflare reports their own
MCP server runs with **~1,000 tokens** of tool overhead.

This is the **strategic endgame** for any MCP server on Cloudflare
Workers. Anthropic and Cloudflare both treat it as the architecture for
non-trivial MCP servers going forward, not an optional optimization.

**Fix (proposed migration path):**
1. Keep the current 34-tool MCP surface as the "raw" layer. No
   deprecation.
2. Add a parallel `/code-mode` endpoint exposing two tools:
   - `jt_search(query)` — finds available wrappers (by tool name + intent)
   - `jt_execute(code)` — runs a TypeScript snippet in a V8 isolate that
     can import `./tools/jt_job_context.ts`, `./tools/jt_bills_inbox.ts`,
     etc. Each wrapper is a thin async function that calls the existing
     tool handler.
3. Build per-tool wrappers in `server/mcp-server/codemode/tools/*.ts`.
   The wrappers can be generated from `TOOL_DEFINITIONS` — same source
   of truth.
4. Use `@cloudflare/codemode` v0.2.1+ for the sandbox layer (handles
   AST normalization, barrel exports, isolate pooling).
5. Phase in by client: agentic IDEs that load many tools (Cursor, Claude
   Code) point at `/code-mode`; chat-style clients keep using `/mcp`.

**Effort:** ~1 quarter for a working prototype, ~2 quarters to production.
This is a strategic bet, not a sprint task.

#### G10. Long-running operation support (Tasks + progressNotification)

**Current state:** `jt_raw_query` over big date ranges, full-org budget
rolls, and large schedule queries can take >10s. Agent gets no progress
signal; just blocks until done.

**Why it matters:** the November 2025 MCP spec revision added the **Tasks**
primitive — tool calls can return a durable handle for ops that exceed
30s, with `progressToken` for sub-30s ops via `progressNotification`. This
is now the spec-blessed pattern.

**Fix:**
- Short-term: support `progressToken` in request metadata, emit
  `notifications/progress` with `{progress, total?, message}` from
  long-running handlers (avenue context bundles, `jt_raw_query`).
- Long-term: register tools that legitimately exceed 30s (bulk imports,
  full-org budget exports) as Tasks. Returns a handle immediately; agent
  polls or subscribes.

**Effort:** ~1 sprint for progressNotification. Tasks is ~1 quarter
(needs durable storage of task state — Cloudflare Durable Objects fit).

---

## Anti-patterns NOT found

Worth calling out — these are common production failures the server has
avoided:

- **Raw API row dumping.** Avenues (`job-context.js`, `bills-context.js`,
  etc.) consistently shape responses; nothing returns Pave's raw
  GraphQL envelope.
- **1:1 endpoint mapping.** The consolidation from 81 → ~32 tools was
  aggressive in the right way. `jt_bills_inbox` absorbing 9 old tools,
  `jt_knowledge` absorbing 3, `jt_tweaks` and `jt_forms` similarly
  consolidated.
- **Generic CRUD-shaped tools.** Each `*_write` tool exposes domain ops
  (`importTemplate`, `createFromBudget`, `notify`), not just create/
  update/delete.
- **Untyped schemas.** Zod everywhere via `zod-to-jsonschema.js`. Enums
  used where they should be (`op`, `depth`, `headerDepth`, `type`,
  `source`).

---

## Don't do these

A few things I considered recommending and decided against:

- **Don't expand the tool count.** Published research shows
  tool-count degradation is a cliff, not a slope (one team: 107 tools →
  total task failure; 20 → 95% accuracy; 10 → 100%). GitHub reduced
  their Copilot MCP integration from 40 → 13 tools and got
  2-5 percentage-point accuracy + 400ms latency improvement. 34 is
  fine; 40+ is risky. New capability proposals must absorb into existing
  tools or replace one.

- **Don't migrate off Zod.** The Zod-to-JSON-schema layer is doing its
  job; it's not worth ripping out for native JSON Schema.

- **Don't refactor `context-mode/`.** It's structurally sophisticated and
  the comments show genuine design thinking. The improvement is
  *integration* (G1 Phase 3) not refactor.

---

## Suggested sequencing

If shipping in priority order:

1. **Sprint 1:** G2 (naming fix), G3 (errors teach). Both small, high
   leverage, no breaking changes.
2. **Sprint 2:** G1 Phase 2 (outputSchema on smaller write tools), G4
   (idempotency keys).
3. **Sprint 3:** G5 (dry_run), G6 (elicitation on destructive ops).
4. **Sprint 4-5:** G1 Phase 3 (outputSchema on avenue bundles), G8 (eval
   harness).
5. **Quarter 2:** G7 (MCP resources), G10 (progressNotification).
6. **Quarters 3-4:** G9 (Code Mode prototype → production).
