# MCP — schema introspection rebuild (audit #1 / #2 / #10 / #11)

**For:** Claude Code, future session
**Author of brief:** Zee + Claude (drafted 2026-05-05 after the audit-driven polish round closed out #3 / #4 / #5 / #6 / #7 / #9 / #12)
**Severity:** P2 — drift mitigation, not actively broken; preventing future correctness regressions
**Estimated scope:** Multi-day; warrants its own brainstorming + writing-plans pass before any code

---

## Problem statement

The MCP server's `PAVE_KNOWLEDGE` object in `server/mcp-server/src/tools.js` is hand-maintained markdown describing JobTread's Pave API entities, fields, and connections. It drives the `jobtread_knowledge_lookup` tool that AI clients call to learn how to query Pave.

The 2026-05-04 live audit found the docs **confidently wrong** in three places:
- `costItem.costGroup` documented as not existing → it exists, walks the parentCostGroup chain.
- `costItem.document` not documented → exists, is the live-vs-snapshot discriminator that broke `jt_job_context.budget` for months.
- `costItem.position` not documented → exists.

The "Does NOT have" lists in the docs were worse than incomplete: they were *discouraging probing*. Whoever built the knowledge base hardcoded a snapshot of "what we know works" without a periodic revalidation pass.

The `tool_search` MCP tool has the same class of problem at the tool-schema layer: parameter `inputSchema` entries describe types but not validation rules (the `size: 100` cap, the AND-wrapper requirement for null checks, the must-be-singular `costGroup` not `costGroups`, etc.). Agents discover those rules by trial and error.

## Goal

Replace the hand-maintained PAVE_KNOWLEDGE with a **cache of live introspection**, falling back to hand-curated content only for the parts introspection can't surface (gotchas, design intent, workflow recipes). Same shift for `tool_search` validation rules.

The architecture changes from:

```
[ hand-maintained markdown ] → [ PAVE_KNOWLEDGE.entries ] → [ jobtread_knowledge_lookup ]
```

to:

```
[ Pave introspection ] → [ refresh job → cache ] → [ jobtread_knowledge_lookup with cache + curated overlay ]
```

Drift is then bounded by the refresh interval rather than unbounded by audit cadence.

## Investigations to do FIRST (before any code)

These determine whether this is a 3-day project or a 3-week one. Run them in order.

### 1. Does Pave expose `__schema`?

GraphQL servers conventionally expose `__schema` for introspection. JT's Pave appears GraphQL-shaped but uses a custom JSON dialect (`{ "$": {...}, "field": {...} }` instead of `{ field(args) { ... } }`). The introspection endpoint may or may not exist.

**To test:**
```bash
# Send a probe via jt_raw_query:
{ __schema: { types: { name: {}, kind: {} } } }
# Or:
{ __type: { name: "Job", fields: { name: {}, type: { name: {} } } } }
```

Outcomes:
- **Has `__schema`:** Architecture is straightforward. Pull, cache, serve.
- **No `__schema`, has typed-client metadata:** JobTread may publish a TypeScript / OpenAPI / SDL artifact somewhere (npm, docs site, github). Use that as the source.
- **Neither:** Architecture gets harder — need to scrape type info from response shapes via probe queries (build a "type discoverer" that runs sample queries, observes returned shapes, infers types). High effort, fragile.

### 2. What's the schema size?

Approximate count of entities + fields + connections. If it's 50 entities × 30 fields × 5 connections each, the introspected JSON is small (~50KB). If it's 500 entities, caching strategy matters more.

### 3. What's the refresh cadence?

JobTread ships product changes regularly. Realistic options:
- **Daily cron** (matches the existing `0 3 * * *` cron in `wrangler.jsonc`) — diff against cache; if changed, surface a release note in MCP responses for ~24h.
- **On-deploy refresh** — trigger from the worker deploy step; manual control.
- **On-demand** — first call after a TTL fetches fresh; cheap but high-latency on first hit.

### 4. Storage shape

Existing `KNOWLEDGE_DB` D1 binding holds scraped help-doc articles. Could reuse with a new `pave_schema` table (rows per entity), or use KV for the whole thing as a single blob (~1 read per knowledge_lookup). Decide based on (2).

## Scope (what changes if introspection is available)

### New tool: `jt_schema_introspect`

```
jt_schema_introspect(entity?: string)
  → {
      entity: { name, kind, fields: [{name, type, nullable, deprecated, args}], connections: [...] },
      lastRefreshed: timestamp,
      stale: boolean
    }
  | { entities: [...], lastRefreshed, stale }
```

Per-entity or full-schema. Pulls from cache; refresh logic runs separately.

### Refresh worker / cron

A worker scheduled handler that:
1. Fetches `__schema` (or equivalent) from Pave.
2. Diffs against cached version.
3. On change: stores new version, retains previous for diff queries, optionally pings telemetry/Slack with the diff summary.

### `jobtread_knowledge_lookup` changes

The existing `entities` category becomes a derived view:

```js
// Pseudocode
async function handleKnowledgeLookup(args, ctx) {
  const live = await ctx.schema.getEntity(args.entity);
  const curated = PAVE_KNOWLEDGE.entities[args.entity]?.curatedOverlay; // gotchas, design intent
  return formatEntityReference(live, curated);
}
```

The hand-maintained entity blocks shrink to a `curatedOverlay` capturing only the things introspection can't say:
- "Live vs snapshot" semantics (architectural — not in the schema).
- Filterable-vs-selectable trap (Pave-runtime behavior, not type metadata).
- Workflow recipes ("to get the live budget tree, do X").
- Cross-entity invariants ("a job document with costItems creates a parallel costGroup tree").

The introspection-derived part covers field/connection lists, types, nullability — the parts that drift.

### Tool-schema validation rules (audit #10)

Tool `inputSchema` entries today document types but not constraints. Add a structured `validationRules` field per parameter that `tool_search` surfaces alongside the type:

```js
{
  name: 'jt_raw_query',
  inputSchema: {
    properties: {
      query: {
        type: 'object',
        validationRules: [
          'Connection $.size capped at 100. Worker rejects size > 100 with a path-pointed error.',
          'For null checks in where, use the 2-element form ["closedOn", null], not 3-element.',
          'Aggregations on the same connection must alias via the _ key.',
        ],
      },
    },
  },
}
```

This is hand-curated for now — there's no obvious way to introspect it. But surfacing it in `tool_search` results gets the rules to agents at the right point.

### `PAVE_KNOWLEDGE` becomes thinner

Categories that survive as hand-curated:
- `gotchas` (workflow traps)
- `examples` (recipe library)
- `pagination_sorting` (rules + cookbook)
- `data_accuracy` (interpretation guidance)
- `text_formatting` (JT markdown)
- `formulas_parameters` / `functions` (formula reference)
- `jt_power_tools` (this product's tools)

Categories that become derived:
- `entities` (introspected + curated overlay)

## Deliverables (suggested PR breakdown)

1. **PR #1 — Investigation report.** Run the probes above, write up findings, decide architecture. No code. Deliverable: a doc updating this brief with concrete answers.

2. **PR #2 — `jt_schema_introspect` tool + cache.** Pulls from Pave (or fallback source), stores in chosen DB, exposes via MCP. No knowledge_lookup integration yet — the tool stands alone.

3. **PR #3 — Refresh worker.** Cron handler. Tests against synthetic schema diffs.

4. **PR #4 — `jobtread_knowledge_lookup` rewrite.** `entities` category becomes derived; curated overlay extracted from existing markdown. Side-by-side diff against the hand-maintained version BEFORE shipping — verify zero regressions in entity coverage.

5. **PR #5 — `tool_search` validation rules.** Hand-curate the existing tools' `validationRules`. Surface in `tool_search` results. Document the convention so future tool additions include them.

Each PR is independent enough to ship + roll back without taking the rest with it.

## Validation strategy

- **Drift smoke test:** before shipping PR #4, generate the introspected `entities` content and diff against the current hand-maintained version. Every entity should be present in both; field lists should match modulo the things audit #1 caught (which the introspection should now surface correctly).
- **Snapshot tests:** lock the introspected schema for known stable entities (`job`, `task`, `costItem`) into test fixtures. If Pave changes those, the test fails loudly — that's the signal to ship a knowledge-base refresh + maybe update curated overlays.
- **Production canary:** ship with a feature flag; route 10% of `jobtread_knowledge_lookup` calls through the new path for a week, monitor for regressions, then full rollout.

## Out of scope (intentionally deferred)

- Auto-generating gotchas from runtime errors. Tempting but expensive — error patterns are noisy and most don't generalize.
- Tool-call cost hints (audit #14). Hard to estimate accurately; revisit if the schema-introspection refresh job exposes per-tool latency stats.
- Tagging non-JobTread tools as Anthropic-side (audit #13). All our tools are already prefixed `jobtread_*` or `jt_*`; this would require relabeling tools we don't own. Won't fix.

## Open questions for the next session

1. **What does Pave's `__schema` look like, if it exists?** Run probe #1.
2. **How does JT version their API?** Is there a way to detect breaking changes between versions before they hit production?
3. **Should the refresh job emit a Slack/email alert on schema diffs?** Useful for proactive catch — but only if you have a notification path set up.
4. **Should `validationRules` move into the tool definitions, or live in a separate config file?** Trade-off: definition-adjacent is closer to the source but bloats the tool registry.

## Files this work will likely touch

- `server/mcp-server/src/tools.js` — `PAVE_KNOWLEDGE.entities` becomes a derived view; `jt_schema_introspect` added; `validationRules` added to tool definitions.
- `server/mcp-server/src/handlers/` (or new `schema-handler.js`) — cache + refresh logic.
- `server/mcp-server/src/index.js` — register the schema-refresh cron handler alongside the existing `0 3 * * *` schedule.
- `server/mcp-server/wrangler.jsonc` — possibly a new D1 binding or KV namespace for the cache.
- `server/mcp-server/migrations/` — new SQL if D1 storage chosen.
- `server/mcp-server/src/tools.test.js` — snapshot tests for stable-entity introspected shapes.

## What NOT to change

- Existing curated content under `PAVE_KNOWLEDGE.gotchas`, `examples`, `pagination_sorting`, `data_accuracy`, `text_formatting`, `formulas_parameters`, `functions`, `jt_power_tools` — these stay hand-curated. They capture WHY/HOW knowledge that doesn't live in a schema.
- Existing avenue handlers (`job-context.js`, `financial-context.js`, etc.) — they're consumers of the tools, not the knowledge base. No change needed unless this work uncovers something else broken.
- `jt_budget_write` and other write tools — separate axis from this work.

## Connection to prior audit work

This brief closes out the architectural items (#1, #2, #10, #11) from the 2026-05-04 audit. The smaller items from that audit (#3, #4, #5, #6, #7, #9, #12) shipped in commits `1d818346` through `11fff17a` in the same window. Skipped: #13 (relabel non-JobTread tools — won't fix), #14 (cost hints — defer until refresh-job exposes latency stats).

The pagination-and-truncation knowledge entry (`PAVE_KNOWLEDGE.pagination_sorting`, expanded in `d493b3a0`) is the model for what hand-curated knowledge looks like when it's healthy: workflow recipes, gotcha tables, cross-tool integration notes. Aim to keep `entities` lean (introspected) and `gotchas` rich (hand-curated) — don't try to make either do the other's job.

## Approval

To start: re-read this brief, run the four investigations under "Investigations to do FIRST", update the brief with findings, then enter the brainstorming + writing-plans flow for the chosen architecture.
