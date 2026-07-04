# Tweak Engine Hardening — Design

- **Date:** 2026-07-04
- **Status:** Design approved — implementation in progress
- **Scope:** Robustness, operational safety, and resilience for user-authored tweaks. Three workstreams (A / B / C), each an independent PR. Does **not** change the DSL grammar's verb set or the existing validate/sanitize logic (those were already hardened in the 2026-07-01 review — commits `d88c46c7`, `aa8d652e`).

## Why

The tweak engine's *content* safety model is strong and already remediated: closed 11-verb DSL, no code execution, AST-based CSS sanitizer with url()/font allowlists + escape normalization, dual client+server validation, a `setText` clickjacking guard, share/import that mints fresh IDs and forces personal scope. Every tweak-related finding from `SECURITY_REVIEW_2026-07.md` (UTL-1..4, CSS-1, TWK-1..3) is fixed in current code.

What remains is **not content safety** — it's the three things that make a customization platform trustworthy at scale for a company betting on it:

1. **Durability of the fixes.** The client validator has ~137 unit tests; the server mirror (the *real* enforcement boundary for MCP writes, share envelopes, and org distribution) has 12. Two hand-mirrored validators drift. A bypass fixed client-side can silently reopen server-side.
2. **Operational safety.** A bad `org_required` tweak applies to every teammate's browser. Auto-disable only fires on *zero selector matches* — a tweak that matches and wrecks (or slows) the page never trips it. There is no kill switch, no safe-mode boot, no instant server-side revoke, and no re-notification when an org tweak is silently updated.
3. **Resilience.** One selector per action means a JobTread redesign kills tweaks, and recovery is manual re-authoring.

## Goals

- Make every past security fix **permanent** via a shared adversarial corpus tested against *both* the client and server validator/sanitizer implementations.
- Give admins and members a **kill switch and safe mode** so a bad org-wide tweak is a 5-second recovery, not a support ticket.
- Make org-wide tweak changes **visible** — re-notify + diff on update, not just first-sight.
- Add **rate limits and version retention** so CRUD (including the AI/MCP write path) can't be abused or grow unbounded.
- Add a **performance guard** so a tweak can't make JobTread feel broken.
- Add **selector resilience + a repair flow** so a JT UI change is recoverable in seconds.

## Non-goals (this pass)

- No new DSL verbs, no change to the closed verb list or the CSS sanitizer's allowlists.
- No client-side storage encryption (unchanged threat model — same as all extension data).
- No portal admin UI rebuild beyond the tweak-health surface in workstream C.
- No staged/percentage rollout of org tweaks (re-notify is enough for v1; staged rollout is a deferred follow-on).
- No cross-device per-install state (server state stays per-account, as today).

---

## Workstream A — Lock in the fixes (validators, corpus, limits)

**Purpose:** make the content-safety model tamper-evident and prevent client/server drift.

### A1. Shared adversarial corpus

Create `tests/fixtures/tweaks/adversarial-corpus.json` — a single source-of-truth list of hostile and edge-case inputs, each entry:

```jsonc
{
  "id": "css-exfil-attr-selector",
  "kind": "css" | "tweak" | "selector" | "styleValue",
  "input": "...",            // the raw CSS string / tweak object / selector
  "expect": "reject" | "sanitize" | "accept",
  "note": "attribute-value exfiltration via background url()"
}
```

Cover, at minimum: bare/universal selectors on **both** css and every action verb (UTL-1); arbitrary `https://` `url()` and `[attr^=]{background:url()}` exfiltration (CSS-1); `@import`/`@charset`/`@namespace`; `expression()` and hex-escaped variants `expr\65ssion` (UTL-3); `behavior`/`-moz-binding`; `url(javascript:...)` unquoted-with-inner-parens Raw-node fallback (UTL-3); `setStyle` values with `url()`/`javascript:`/`<script`; extension-UI selectors `.jt-tools-`/`.jt-popup-`; scheme-relative `//host` where a URL is accepted (UTL-4); over-limit name/desc/text/selector/actions/then; `setText` on protected action words (clickjacking guard); `onEvent` with no side effect; nested `onEvent` inside `then[]`; SVG data URIs in url() (must reject); non-UUID ids.

### A2. Corpus-driven tests on both implementations

- **Client:** extend `tests/utils/css-sanitizer.test.js`, `tests/utils/tweak-validator.test.js`, `tests/utils/sanitizer.test.js` to iterate the corpus (filtered by `kind`) and assert `expect`.
- **Server:** extend `server/mcp-server/src/tweaks-validator.test.js` and `server/mcp-server/src/tweaks-css-sanitizer.test.js` to iterate the **same** corpus file and assert the **same** `expect`.
- A single test guarantees parity: for every `tweak`/`css`/`selector`/`styleValue` entry, the client verdict and server verdict must be identical. This is the anti-drift mechanism — if someone patches one validator and not the other, this test goes red.

**Acceptance:** both `npm test` (root) and the server vitest suite iterate the corpus; the parity test passes; every currently-fixed finding has ≥1 corpus entry proving it stays fixed. Removing any single fix (spot-check by reverting one guard locally) turns the corpus red.

### A3. CRUD rate limits + version retention (server)

In `server/mcp-server/src/tweaks-handler.js`, reuse the exact `shared_tweaks` rate-limit pattern (count rows in a rolling hour, throw `TweakError(…, 429)`):

- Add per-account hourly caps to `createTweakData` and `updateTweakData` (and thus the MCP `create`/`update`/`revert` paths, which call them). Proposed: `TWEAK_WRITE_RATE_PER_HOUR = 120`. Count against `tweak_versions.authored_by_account_id` in the last hour (covers both create and update since both insert a version row).
- **Version retention:** after inserting a new `tweak_versions` row, prune to the most recent `MAX_VERSIONS_PER_TWEAK = 50` for that `tweak_id` (`DELETE … WHERE tweak_id = ? AND version NOT IN (SELECT version … ORDER BY version DESC LIMIT 50)`). Keeps revert useful while bounding growth. Never prune below the `current_version`.

**Acceptance:** new server tests: 121st write in an hour → 429; a tweak updated 60 times keeps exactly 50 versions with the newest contiguous and `current_version` intact; revert still works within the retained window.

---

## Workstream B — Operational safety net (kill switch, safe mode, update visibility, perf guard)

**Purpose:** bound the blast radius of a bad tweak — especially an org-wide one.

### B1. Server-side kill switch (instant revoke)

Add a nullable `revoked_at INTEGER` column to `tweaks` (new migration `045_tweak_kill_switch.sql` — renumbered from 044 to avoid a collision with `044_skill_scope.sql` that landed on main in parallel).

- `listTweaksData` excludes `revoked_at IS NOT NULL` rows exactly like `deleted_at` — so a revoked tweak stops distributing on the next refresh (≤ one refresh cycle) to every member, without a hard delete (reversible; version history intact).
- New handler `revokeTweakData(env, account, tweakId, { revoked })` — admin-only for `org_required`, author-or-admin for `personal`. Sets/clears `revoked_at`.
- Expose as a REST endpoint (`/admin/tweaks/revoke`) and as a `jt_tweaks` operation `revoke` (see B5). Distinct from delete: delete is the author cleaning up; revoke is "stop this everywhere, now, I might un-revoke it."

**Acceptance:** revoking an `org_required` tweak removes it from `list` output for all members' next refresh; the engine's storage-change listener tears it down; un-revoking restores it; a member cannot revoke an org tweak; version history survives a revoke.

### B2. Client safe mode (boot with tweaks off)

A local, per-install escape hatch that survives even if the network is down and the server kill switch can't be reached.

- New `chrome.storage.local['jtTweakSafeMode']` boolean. When true, `loadAndApply()` in `features/tweak-engine/index.js` skips the entire apply pass (logs `TweakEngine: safe mode ON — 0 tweaks applied`) but still runs the server refresh so the cache stays fresh for when safe mode is turned off.
- **Auto-trip:** if the content script catches an uncaught error originating in the apply path N times in one page session (guard a counter around `applyTweak`/`runAction`), it does **not** auto-enable global safe mode (too blunt) — it relies on the existing per-tweak auto-disable. Global safe mode is **user-driven only** in v1. (Auto-trip on a crash loop is a deferred idea.)
- **Toggle:** a "Disable all tweaks (safe mode)" switch in the popup tweaks section (B3).

**Acceptance:** with `jtTweakSafeMode=true`, no `.jt-tweak-*` styles or actions are applied on JobTread; toggling it off hot-re-applies via the existing storage-change path without a reload; refresh still populates the cache while safe mode is on.

### B3. Popup: "Disable all tweaks" + safe-mode control

In `popup/` tweaks UI: add a single prominent toggle that sets `jtTweakSafeMode`. Copy: *"Turn off all tweaks — JobTread loads exactly as it ships. Your tweaks are kept and come back when you switch this off."* Matches the guarantee tone ("you'll always know what's happening"). Neutral-grey popup palette per `code-style.md`.

**Acceptance:** toggle reflects and writes `jtTweakSafeMode`; state persists; screenshot baseline added.

### B4. Org-tweak update visibility (re-notify + diff)

Today `system-banner.js` shows a one-time banner on first sight of an org_required tweak (acked per device). Extend so an **update** to an already-acked org tweak re-surfaces it:

- The banner ack is currently keyed by tweak id. Re-key the ack to `id@version` (using the server's `currentVersion`, already on the tweak object). A bumped version → the id@version ack is absent → banner re-shows with "Updated" framing.
- The banner uses `describe.js` to show a plain-English summary of what the (new version of the) tweak does — reuse, don't reinvent.
- No server change required beyond what already returns `currentVersion`.

**Acceptance:** acking an org tweak at v3 suppresses the banner; an admin edit to v4 re-shows it once with an "Updated" label and the `describe()` summary; re-acking suppresses until the next version.

### B5. `jt_tweaks` MCP: expose `revoke`, keep write-gating

Add the `revoke` operation to `server/mcp-server/src/tweaks-mcp-tools.js` and the dispatcher, calling `revokeTweakData`. It is a **write** op for permission-tier purposes (Power User + account binding, same as create/update). An AI can revoke only what its human driver could. Update the tool's inline schema/description and the read/write op classification.

**Acceptance:** MCP `jt_tweaks {op:"revoke", id, revoked:true}` revokes; unbound grant key is rejected on the write path; a non-admin driver cannot revoke an org tweak.

### B6. Performance guard (auto-disable on slow, not just gone)

Extend the existing auto-disable machinery in `index.js` (which currently trips only on a zero-match streak). Add a second trip condition: if a single tweak's action-applier pass exceeds a wall-clock budget (`APPLY_BUDGET_MS`, propose 50ms) on ≥N consecutive MutationObserver-driven runs, auto-disable it with reason `perf_budget_exceeded` and surface it in diagnostics ("auto-disabled: this tweak was slowing the page"). Measure with `performance.now()` around the per-tweak `applyOnce`. Same hysteresis discipline (consecutive count + minimum duration) so a one-off slow frame doesn't trip it. Same explicit "Re-enable" recovery.

**Acceptance:** a synthetic tweak whose applier is artificially slow trips `perf_budget_exceeded` after the streak; a normal tweak never trips; the diagnostic reason renders in the popup; re-enable works.

---

## Workstream C — Resilience & repair (fallback selectors, repair flow, org health)

**Purpose:** turn a JobTread UI change from "tweak silently dies, user must rebuild it" into "tweak self-heals or is re-pointed in seconds."

### C1. Fallback selector candidates (DSL-compatible, additive)

Extend the schema so any action may carry an optional `selectorCandidates?: string[]` (≤5, each validated by the same `isSafeSelector`, same bare/UI guards). Semantics: the engine tries `selector` first; on zero matches it tries each candidate in order and uses the first that matches. `selector` stays required (back-compat). This is **additive and optional** — existing tweaks are unaffected; the validator gains a bounded array check, mirrored client + server, with corpus entries in workstream A.

- The builder (`builder.js` / `builder-emit.js`) populates `selectorCandidates` from `@medv/finder` by generating 2–3 alternative selectors at pick time (e.g., a more-specific and a more-structural variant) — so builder-authored tweaks are resilient by default with zero extra user effort.
- `describe.js` gains a branch mentioning fallbacks exist ("with 2 backup selectors") so it's inspectable.

**Acceptance:** an action whose primary selector matches nothing but whose candidate matches applies via the candidate; validator rejects >5 candidates or an unsafe one; builder emits candidates for a picked element; corpus + parity tests cover the new field.

### C2. Repair flow when auto-disable fires

When a tweak is auto-disabled (`dom_changed` or `perf_budget_exceeded`), the popup card's "Re-enable" gains a companion **"Repair"** action that opens the in-page builder pre-loaded with the broken tweak and the picker armed, so the user re-clicks the element and the builder regenerates `selector` + `selectorCandidates`, then saves as an update (new version). Reuses the existing builder + picker + save-as-update path; no new engine primitive.

**Acceptance:** clicking Repair on an auto-disabled tweak opens the builder with that tweak loaded and the picker active; re-picking + save produces a new version with refreshed selectors; the tweak leaves the auto-disabled set.

### C3. Org tweak-health visibility (portal)

In `portal/` tweaks admin, add a read-only health column per org tweak driven by the existing per-account diagnostics (`auditTweaksData` already gates admin-only and aggregates): show how many members have it applying vs. auto-disabled vs. erroring. This is aggregate counts only — never per-person "why," per the org PEOPLE rule (factual observations, not speculation). Surfaces "this org tweak broke for 8 of 12 people" so an admin repairs or revokes proactively.

**Acceptance:** an admin sees per-org-tweak applied/auto-disabled/error counts sourced from `auditTweaksData`; no per-member detail beyond counts; non-admins get 403 (unchanged).

---

## Cross-cutting

- **Validator parity is sacred.** Every schema change in this spec (`selectorCandidates`) lands in the client validator (`utils/tweak-validator.js`) **and** the server validator (`server/mcp-server/src/tweaks-validator.js`) in the same PR, with corpus + parity coverage (A2). Same for any sanitizer touch.
- **Migrations are applied manually** via `wrangler d1 execute --file` (per project memory) — not `migrations apply`. The migration file (`045_tweak_kill_switch.sql`) is authored and referenced; deployment is a separate human step.
- **CHANGELOG.md** gets an `[Unreleased]` entry per workstream (Added/Improved/Security), naming the feature and user impact, per `.claude/rules/changelog.md`.
- **No `innerHTML`** anywhere in new UI — `utils/dom-helpers.js` (`createElement`/`textContent`) only. The `describe()` and banner render paths stay on `textContent` (keeps UTL-1/UTL-2 from ever becoming stored XSS).
- **Lifecycle:** any new listener/observer/style added in `index.js` must be torn down by `removeAllAppliedTweaks`; safe-mode and perf-guard state must reset cleanly on `cleanup()`.

## Testing

- **Unit (client):** corpus + parity (A2), `selectorCandidates` validation (C1), safe-mode skip (B2), perf-guard trip math (B6), banner id@version re-notify (B4).
- **Unit (server):** corpus + parity (A2), CRUD rate limit + version retention (A3), `revokeTweakData` authz + list exclusion (B1), MCP `revoke` gating (B5), `selectorCandidates` server validation (C1).
- **E2E (Playwright, against `tests/fixtures/jobtread/*`):** safe-mode toggle applies nothing; fallback selector resolves when primary misses (C1); repair flow opens builder with tweak loaded (C2). Visual baselines for the popup safe-mode toggle (B3) and the "Updated" banner (B4).
- **Regression:** `npm run eval:full` gates (lint, duplication, feature-file LOC budget, banned colors, visual) stay green. `index.js` is near the 1500-line budget — if B6 + C changes push it over, split the auto-disable/perf-guard logic into `features/tweak-engine/health.js` as part of the work (noted for the implementer).

## Build sequence & parallelization

Three PRs. Workstream **A first** (de-risks everything; the corpus + parity test guards all later validator edits). Then **B** and **C** can proceed in parallel *except* for the shared files below.

**File-ownership map (to avoid collisions when running agents in parallel):**

- **A** owns: `tests/fixtures/tweaks/adversarial-corpus.json`, all `*validator*.test.js` / `*css-sanitizer*.test.js` / `sanitizer.test.js` (client + server), and the rate-limit/retention additions in `tweaks-handler.js` (create/update/version-prune region).
- **B-server** owns: migration `044`, the kill-switch region of `tweaks-handler.js` (`revokeTweakData`, `listTweaksData` exclusion, REST route), `tweaks-mcp-tools.js`.
- **B-client** owns: `index.js` (safe-mode boot + perf guard), `system-banner.js` (id@version re-notify), `popup/` (safe-mode toggle).
- **C** owns: schema field in **both** validators (coordinate with A's parity test — land C1's validator change *after* A merges, or include the corpus entry in C1's PR), `builder.js`/`builder-emit.js`/`describe.js` (candidates + repair), `portal/` (health column).

**Conflict points:** `tweaks-handler.js` is touched by A (rate limit/retention) and B-server (kill switch) — sequence A→B-server, or use worktrees and expect a small merge. Both client `tweak-validator.js` and server `tweaks-validator.js` are touched by A (nothing) and C1 (new field) — C1 lands after A. Given this, the safe execution order is: **A → (B-server, B-client, C in parallel)**, with C1's validator edit rebased on A.

## Deferred / out of scope

- Auto-trip global safe mode on a detected crash loop (B2 is user-driven only for v1).
- Staged/percentage rollout of org tweaks.
- Cross-device per-install tweak state.
- Client-side storage encryption.
- Server-minted share links beyond the existing short-code store.
