# Architecture A — "Haiku writes, Sonnet drives" (v1, flagged)

**Date:** 2026-07-10
**Branch:** `claude/assistant-model-routing`
**Supersedes the routing approach in:** `2026-07-09-assistant-model-routing-design.md` (v0.2)
**Decision basis:** golden eval (Haiku = strong writer), tool-selection eval (Haiku = weaker driver, 11-16% no-call), Experiment 1 (descriptions don't cheaply fix it). See [[project-assistant-model-routing]].

## What we're building and why

The evidence says: **Haiku writes well, drives the tool loop poorly.** So route the
minority of *no-tool* turns to Haiku and keep Sonnet on everything that needs a
tool. This is safety-first with **modest** savings (tool-heavy workload → Sonnet
does most of the expensive work), shipped behind a per-license flag so Titus
dogfoods it with a one-line kill switch.

## Non-goals (v1)
- No mid-run model switching (breaks thinking-block replay at run-agent.js:314).
- No premium-pool accounting change (Phase B) — metering already charges per-model.
- No panel UI (Phase C) — v1 only *emits* the "answered by" event.
- No structural tool consolidation (separate track; Experiment-1 descriptions did not help and the match-harness can't grade it).

## Design

### 1. The routing decision — `selectDriveModel` (pure)
New export in `src/agent-core/select-model.js`:
`selectDriveModel({ task, page, entityIds }) -> { model, reason }`

- Returns **Haiku** (`MODELS.routing`) ONLY for high-confidence **no-tool** turns:
  - Text transforms of prior content: rewrite / reword / rephrase / shorten /
    lengthen / "make it shorter|more formal|clearer" / summarize the above /
    tighten / polish / proofread.
  - Greetings / acknowledgements, short and data-free: hi, hello, thanks, got it,
    ok, great, perfect.
- **Hard veto to Sonnet** if the task carries any data/lookup signal — reuse
  `HIGH_STAKES_KEYWORDS` plus lookup verbs (find, show, list, pull, get, what,
  when, who, how many, status, which). A data question must never land on Haiku,
  because Haiku's failure mode is answering *without* looking it up (the no-call
  risk). Veto wins over the no-tool patterns.
- **Everything else → Sonnet** (`MODELS.default`). Default-safe.

The no-call guardrail is satisfied *by the routing itself*: only turns that
genuinely need no tool go to Haiku, so "Haiku answered without a tool" is correct
there, never a skipped lookup.

### 2. The flag — env allowlist
Worker var `HAIKU_ROUTING_LICENSE_IDS` = comma-separated license IDs. Routing is
active only when the run's `authContext.license.id` is in that set. Unset/empty →
**exact current behavior** (Sonnet default everywhere). Kill switch = unset the var.
Helper `haikuRoutingEnabled(env, licenseId) -> boolean` (in select-model.js or a
small flag helper), parsed defensively (trim, ignore blanks).

### 3. Wiring into run-agent.js
At the model-resolution seam (~lines 131-153), when:
- there is **no explicit caller `model` override**, AND
- `haikuRoutingEnabled(env, authContext.license?.id)`,
then set the candidate model from `selectDriveModel({ task, context.page, context.entityIds })`
BEFORE `resolveModelForTier` + `poolPolicy` (which still clamp by tier and degrade
by pool — unchanged). Explicit overrides and the pool degradation ladder keep
priority. Emit once, after `modelId` is final:
`emit({ type: 'model', model: modelId, reason })`.

### 4. Metering / pool
Unchanged. `costCents` / `creditsForUsage` are already model-aware; a Haiku turn
just charges less. Premium-only pool accounting is Phase B.

## Testing
- `selectDriveModel` unit tests: rewrite/summarize-above → Haiku; "what's the Smith
  budget" / "find the invoice" / "show the schedule" → Sonnet (data veto);
  "hi"/"thanks" → Haiku; a rewrite request that also names a dollar figure → Sonnet
  (veto wins); empty → Sonnet.
- `haikuRoutingEnabled`: unset/empty → false; matching id → true; non-matching → false.
- run-agent: with the flag off (no env), model resolution is byte-identical to today
  (existing run-agent tests stay green); with an allowlisted license + a no-tool
  task, the resolved model is Haiku; with a data task, Sonnet. Emits a `model` frame.
- Full `node --test "src/**/*.test.js"` stays green.

## Rollout
1. Merge behind the flag (unset in prod = no-op).
2. Set `HAIKU_ROUTING_LICENSE_IDS` to Titus's license only; dogfood.
3. Watch real tool-selection + answer quality (the "answered by" frame; forward
   traffic is the only unbiased tool-selection signal — the offline match-harness
   can't grade routing changes).
4. If solid, widen the allowlist; then Phase B (premium-pool accounting) + Phase C (panel chip).

## Honest expectation
Savings are modest (tens of % on the no-tool subset), not the original 3×. This is
the safety-preserving slice the evidence supports; larger COGS wins likely come
from prompt caching, the deployed output-token reduction, and tool consolidation
for prompt-token savings — weighed separately.
