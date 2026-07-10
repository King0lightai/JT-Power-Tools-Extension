# Assistant Model Routing — Design (v0.2, Fable-corrected)

**Date:** 2026-07-09
**Branch:** `claude/assistant-model-routing`
**Base spec:** `assistant-model-routing-spec.md` (v0.1 draft, author-provided)
**Advisory:** Fable 5 memo, 2026-07-09 (grounded in `models.js` / `pool.js` / `metering.js` / `run-agent.js`)

This document records the **corrections** to the v0.1 spec after the Fable advisory
review, plus the build order we're executing. Read v0.1 for the full vision; read
this for what we're actually building and why it differs.

## The bet (unchanged)

1. **Anthropic-family only, as an enforced invariant.** No third-party model
   provider (DeepSeek, Qwen, OpenRouter, Perplexity) in the assistant data path.
   Client financials stay inside the Anthropic + Cloudflare trust boundary.
2. **Haiku as the always-available workhorse floor**, with Sonnet/Opus a metered
   "premium allowance" that degrades gracefully to Haiku — so a $99 plan *feels*
   roomy. Escalation is decided by **code/heuristic lanes**, never by the weak
   model self-selecting.

## Corrections to v0.1 (what Fable caught)

### C1 — Escalation must be decided PRE-RUN, not mid-run
The model is fixed once per run at [run-agent.js:131-153](../../../server/mcp-server/src/agent-core/run-agent.js) before any
tool fires, and the loop replays assistant content blocks (thinking included)
**byte-identically** for cache hits ([run-agent.js:314](../../../server/mcp-server/src/agent-core/run-agent.js)). So "escalate when the
tool chain gets long" is unimplementable as a mid-run model swap — it would
return a tool_result against thinking blocks minted by a different model (API 400).

**Decision:** escalation is a **pre-run** decision from signals available at run
start:
- `context.page` + `context.entityIds` from the extension ([run-agent.js:194-198](../../../server/mcp-server/src/agent-core/run-agent.js)) —
  the strongest free signal, unused by v1. On a budget/estimate/document page → escalate.
- Task-string keywords biased to escalate on any hit (budget, estimate, invoice,
  change order, price, margin, owe, cost, client, email, draft, schedule date…).
- Session history (previous turn used a financial tool → escalate).
- Panel `model` override (power user) — kept, still tier+pool clamped.

Mid-run escalation, if built later, is a **one-way restart** (abandon early, re-run
on Sonnet from the original user message — reads are idempotent) — NOT a mid-run
switch. Deferred past the first slice.

### C2 — Read-only money questions are high-stakes too
v1 keyed high-stakes on *write* tools. "What's our margin on the Smith job" is a
**read** → would land on Haiku, which mis-attributes a figure from a large
`jt_financial_context` blob, and nothing escalates. That violates the org rule
that money/commitments come from real data. **Financial reads escalate** (page
context + keywords cover this; the lane is not write-only).

### C3 — Standard mode must not answer money questions on Haiku
v1 contradicts itself: exhausted pool = "Haiku-only", but money turns "must" reach
Sonnet. **High-stakes lanes get Sonnet even in Standard state.** The tiny internal
COGS overage is eaten silently — the "no overage charges" contract is about *user
billing*, not internal cost. `poolPolicy` therefore takes the **lane** as an input
so one function owns the final decision (lane × tier × pool state); today it
unconditionally clamps everything to Haiku at `low` ([pool.js:126](../../../server/mcp-server/src/agent-core/pool.js)).

### C4 — "Unmetered Haiku" needs real accounting
`chargeCredits` is model-blind today ([pool.js:94](../../../server/mcp-server/src/agent-core/pool.js)). Metering premium-only
requires **model-aware charging** + a **separate Haiku ceiling counter** (a
migration: `haiku_credits_used` or equivalent) so `jt_agent` (mcp, 100K budget)
driven by automation can't grind the floor all month. The Ceiling state ships
WITH Phase B, not as a hand-wave.

### C5 — Measure before flipping the default (with a faster method than v1)
The whole bet assumes most turns are cheap lookups. For a tool sitting on budgets
and schedules, it's plausible *most* turns escalate anyway — making this
complexity for a ~20% cut, not 3×. v1/Fable propose a week of forward
shadow-logging. **We improve on this:** `agent_messages` already stores every past
session's content blocks *including the persisted `<page_context>`* — so we run the
lane classifier **retroactively over stored traffic** and get the lane
distribution + projected blended-cost delta **today**, no week-long wait. The
Haiku-default flip stays gated on this data + a golden-set quality eval.

### C6 — Coordination / cuts
- Flipping `default` rebaselines the in-flight output-token-reduction experiment —
  coordinate (keep `default` meaning Sonnet for *explicit* callers; a new
  `workhorse` class carries the floor, so version-skewed extensions don't shift
  silently).
- **Cut from the first slice:** AI Gateway (optional, last); the `smart` vs
  `heavy` complexity-lane split (start binary Haiku↔Sonnet; keep Opus Pro-gated
  via existing `resolveModelForTier`).

## Revised build order

**Phase 0 — Prove the bet (zero user exposure). ← current slice**
- 0a. **Anthropic-only invariant** — CI test asserting all `MODELS` ids are
  `claude-*` and the client base URL is Anthropic (or CF AI Gateway). ~20 lines,
  independent, ship first.
- 0b. **`selectModel()` lane classifier** — pure, fully tested function taking
  `{ taskClass, tier, task, page, entityIds, escalationHint }` → model class.
  Not wired into the loop yet.
- 0c. **Retroactive backtest** — dev script: run `selectModel` over stored
  `agent_messages`, output lane distribution + projected blended-cost delta vs
  today's Sonnet-default.
- 0d. **Golden-set eval** — ~30 real captured panel questions, Haiku vs Sonnet,
  LLM-judged, to confirm floor quality on real contractor questions.

**Gate:** read 0c + 0d. If ≥~60% of turns escalate anyway, stop and re-plan pool
sizing instead of routing.

**Phase A — Haiku-first routing** behind a per-license flag; wire `selectModel`
into [run-agent.js:131-153](../../../server/mcp-server/src/agent-core/run-agent.js); dogfood on Titus + support org with an
"answered by" indicator (a sliver of UX moves up — silent model variance on money
answers is unacceptable once routing varies).

**Phase B — Premium-allowance pool** — model-aware `chargeCredits`, Haiku ceiling
counter (migration), `Conserve` state in `poolPolicy` (lane-aware), re-derived
`TIER_POOLS` from 0c data.

**Phase C — UX** — `pool` event payload (state + friendly message), panel mode
chip, portal "Pro answers used / Standard unlimited / resets in D".

**Phase D — AI Gateway (optional)** — `baseURL` env binding through
`createAnthropicClient`; caching/observability/fallback, same trust boundary.

## Quality & safety (unchanged intent, sharpened)
- High-stakes accuracy outranks cost — financial reads *and* writes escalate,
  including in Standard state (C3).
- Degradation is transparent (mode chip / "answered by"), never silent-wrong.
- Fail-open preserved — pool/metering errors keep the assistant up ([pool.js:41-50](../../../server/mcp-server/src/agent-core/pool.js)).
- The Anthropic-only CI test is the guardrail against future third-party leakage.
