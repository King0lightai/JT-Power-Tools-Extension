# User Tweaks Phase 2 — Mid-implementation Handoff

> **For Claude:** This document is a self-handoff written at a context-compact boundary mid-Phase-2.
> Read this file end-to-end before doing anything. It tells you exactly where we are, what's
> committed, what's next, what NOT to break, and what user preferences are baked into how we work.

## Where you are

- **Branch:** `claude/tweaks-mcp-storage` (off `main`, freshly created post Phase 1 merge)
- **Worktree:** `C:\Users\zeepe\OneDrive\Desktop\JT-Power-Tools\.claude\worktrees\claude+tweaks-mcp-storage`
- **Main repo CWD:** `C:\Users\zeepe\OneDrive\Desktop\JT-Power-Tools` (don't accidentally commit to `main`)
- **Phase 1 (V1 + V1.5)** is fully merged to main as commit `d1fff3cb` — `Merge: User Tweaks V1 + V1.5 (Phase 1 — extension-only)`. The full V1 + V1.5 + UI polish lives in main now.

### Auto mode is ON

The user enabled auto mode early in the session. That means:

- Execute autonomously, don't over-discuss
- Make reasonable assumptions, ship work, accept course-corrections
- DO ask before destructive actions (deploys, force-pushes, branch deletes, server changes that ship to prod)
- DO NOT push to remote / deploy / wrangler-deploy without explicit "ship it" from the user
- DO NOT delete the worktree without confirmation

### User style preferences (carry these forward)

- **Direct, terse responses** — no preamble, no trailing summaries (per their global CLAUDE.md)
- **Conventional commits** always: `feat:`, `fix:`, `refactor:`, `chore:`, `docs:`, `style:`, `test:`
- **CHANGELOG entries** for every functional commit, under `## [Unreleased]`
- **Subagent-driven review cadence** for risky/non-trivial work (security-critical, complex logic). For tiny cosmetic edits inline edits are fine.
- **Two-stage review (spec then quality)** is the discipline that caught real Critical bugs in V1
- **Theme tokens, not hardcoded hex** — the popup uses `--bg-*`, `--text-*`, `--border-*`, `--brand-orange*` and auto-flips light/dark
- **Contractor-friendly framing** — these users are construction PMs, not developers. UX copy reflects that ("Paste from AI", "Pick an element on JobTread", numbered walkthroughs, no jargon)

## Phase 2 design decisions (locked)

You don't need to relitigate these — they were debated, decided, and committed:

### 1. Storage scope: `'personal' | 'org_required'`

The Phase 2 expansion adds **org-pushed tweaks**. An admin can author a tweak and push it to all members of their license/org. Members CAN'T edit or delete org-required tweaks; they CAN locally disable them as an emergency hatch (per-account override).

- `tweaks.scope = 'personal'` → author-only visibility, author CRUDs
- `tweaks.scope = 'org_required'` → all members of license/org see it; only admin/owner CRUDs

### 2. Local-disable allowed (Option A, NOT B)

User explicitly chose **(A) local disable allowed** for org_required tweaks. Mandatory tweaks default-on for everyone, members can disable on their device only via `tweak_user_state`, doesn't sync, admin sees overrides as audit signal. **Don't change to "truly forced"** without explicit user request.

### 3. Endpoints under `/admin/tweaks/*`, POST-everywhere

The mcp-server's existing convention is `POST /admin/foo` (not RESTful GET/POST/PUT/DELETE). I followed that for tweaks. Auth path is portal-session JWT via `authenticateRequest` from `portal-auth.js`. Don't switch to RESTful methods — consistency with existing `/admin/*` pattern matters more than purism here.

### 4. Defense in depth: server runs sanitizer + validator on every write

The server NEVER trusts the extension's claim that content is sanitized/validated. Every POST `/admin/tweaks/{create,update}` runs:

1. `validateTweak(body)` from `tweaks-validator.js`
2. `sanitizeCss(body.css, { tweakId })` from `tweaks-css-sanitizer.js`

Both ported line-for-line from the extension's client-side versions, with adaptations for ESM + Workers (no DOM). **Don't skip these on writes** even if the extension already validated.

### 5. The extension keeps `chrome.storage.local` as offline fallback

The engine should call the server first, fall back to local cache on network failure. Don't rip out chrome.storage.local writes — they're the offline path.

## What's committed on this branch

Run `git log --oneline main..HEAD` to confirm. As of handoff:

| Commit | What |
|---|---|
| `0d909d37` | `feat(tweaks-storage): add D1 migration for User Tweaks Phase 2` — `015_tweaks.sql`, four tables (tweaks, tweak_versions, tweak_user_state, tweak_diagnostics) with `scope` column |
| `5e01b146` | `feat(tweaks-storage): port CSS sanitizer to server` — `src/tweaks-css-sanitizer.js`, css-tree as npm dep, ESM port |
| `9ccb3d18` | `feat(tweaks-storage): port DSL validator to server` — `src/tweaks-validator.js`, no-DOM port, scope-aware (`storageScope` field validation) |
| `e13c9b7c` | `feat(tweaks-storage): REST endpoints for User Tweaks Phase 2` — `src/tweaks-handler.js` (six handlers + router fn), wired into `admin.js handleAdminRoute` via dynamic import |

**Files in this branch's diff vs main:**
- `server/mcp-server/migrations/015_tweaks.sql` (new)
- `server/mcp-server/src/tweaks-css-sanitizer.js` (new)
- `server/mcp-server/src/tweaks-validator.js` (new)
- `server/mcp-server/src/tweaks-handler.js` (new)
- `server/mcp-server/src/admin.js` (modified — added 7-line tweaks router fast-path)
- `server/mcp-server/package.json` (added `css-tree: ^2.3.1`)

**Things you might NEED to do before continuing:**
- Run `npm install` inside `server/mcp-server/` to fetch the `css-tree` dep (the worktree's `node_modules` is local to the worktree)

## What's NOT done — the next concrete steps

The TodoWrite list at handoff:

1. ✅ Task 1: D1 migration (committed)
2. ✅ Task 2: CSS sanitizer port (committed)
3. ✅ Task 2b: DSL validator port (committed)
4. ✅ Task 3: REST endpoints (committed)
5. **⏭️ Task 5: Extension API integration** ← NEXT
6. ⏳ Task 6: Popup UI for org_required tweak rendering
7. ⏳ Task 7: Portal admin page for org tweaks management
8. ⏳ Task 8: CHANGELOG + integration test

### Task 5 in detail (next up)

Wire the extension to call `/admin/tweaks/*` instead of (or in addition to) `chrome.storage.local`. Files to touch in `JT-Tools-Master/`:

#### a. New service module: `JT-Tools-Master/services/tweaks-api.js`

A wrapper around the six endpoints. Mirrors the pattern of `services/account-service.js` — uses the existing portal-session JWT auth (the extension already has portal sessions for `/admin/extension-keys` etc., so this just rides along). Functions to export:

```js
window.TweaksApi = {
  list(jtOrgId)              → POST /admin/tweaks/list
  create(tweak)              → POST /admin/tweaks/create
  update(tweak)              → POST /admin/tweaks/update
  delete(tweakId)            → POST /admin/tweaks/delete
  setState(tweakId, state)   → POST /admin/tweaks/state
  reportDiagnostics(...)     → POST /admin/tweaks/diagnostics
}
```

The base URL pattern: same hostname the extension already uses for `/admin/extension-keys` etc. Look at `services/account-service.js` for the request pattern (it has the bearer token plumbing).

#### b. Update `features/tweak-engine/index.js`

Currently reads from `chrome.storage.local['jtTweaks']`. Switch to:
1. On init: try `TweaksApi.list(activeOrg)` first
2. On success: cache the result in `chrome.storage.local['jtTweaks']` and apply
3. On failure (network down, not logged in): fall back to cached `chrome.storage.local['jtTweaks']`

Keep the storage-change listener alive so external writers (e.g., portal admin) trigger re-apply.

For diagnostics: keep the existing debounced flush, but also POST to `/admin/tweaks/diagnostics` with the same data (best-effort, don't block the local flush).

#### c. Update popup `services/account-service.js` integration

The popup's tweaks IIFE (around `popup.js:3084` — search for `initTweaksSection`) currently:
- Reads `chrome.storage.local['jtTweaks']` directly
- Writes via `chrome.storage.local.set`

Switch to:
- `TweaksApi.list(activeOrg)` for the list
- `TweaksApi.create / update / delete` for mutations
- Keep `chrome.storage.local` as a write-through cache (so the engine reads from the same place as before)

#### d. Update editor `tweaks/edit.js`

The editor save path currently writes directly to `chrome.storage.local`. Switch to `TweaksApi.create` (new) or `TweaksApi.update` (existing) based on whether the URL has `?id=` or `?new=1`.

#### e. New: a "scope" toggle in the editor

If the user is an admin/owner, the editor needs a select/toggle for `storageScope: 'personal' | 'org_required'`. Default to personal. Members shouldn't see this toggle (they can only create personal). Tier check via `LicenseService.getRole()` (or whatever the existing helper is — search for role-based UI in popup.js).

### Task 6 in detail

Popup UI for org_required tweaks. The list rendering is at `popup.js:3120` ish (`for (const tweak of visible)` loop). Add:

- **"Required by org" badge** — small purple chip next to the tweak name. CSS: use `--brand-orange-glow` style as a base, switch hue to purple. Or add a new `--badge-required-bg` token if going clean.
- **Hide Edit + Delete buttons** for org_required tweaks if caller is NOT admin/owner. Members only see the toggle (which writes to `tweak_user_state` for local disable).
- **Tooltip on the disable toggle for org_required**: "Disabled locally — your admin still has this enabled for the org" (only when toggled off).

### Task 7 in detail

Portal admin page at `app.jtpowertools.com/admin/tweaks` (the portal lives in `portal/` directory at the repo root, separate from the extension). I haven't explored portal/ yet — start by reading the existing admin pages (`portal/dashboard.html` referenced earlier in the conversation) to match style.

The page should have:

- **List of org_required tweaks** for the admin's org (filter `storageScope = 'org_required'` from `TweaksApi.list`)
- **Create button** opens the same editor we built in `JT-Tools-Master/tweaks/edit.html` (could iframe it from the extension OR copy the component into the portal — TBD; iframe is simpler if the editor's CSS doesn't conflict)
- **Per-row actions:** Edit, Disable (server-side, sets `enabled_default = 0`), Delete, View deployment status
- **Audit panel:** "5 of 12 members have locally disabled this tweak" — sourced from `tweak_user_state` rows where `enabled = 0`. (May need a new endpoint to surface this — `POST /admin/tweaks/audit` returning override counts.)

### Task 8 in detail

- CHANGELOG entry under `[Unreleased]` describing Phase 2 (the storage layer + the org_required mechanism, the local-disable hatch)
- Integration test if feasible — manual smoke at minimum:
  1. Create personal tweak via popup → verify it persists across browser restart
  2. Open the editor on another device with same login → tweak appears
  3. Admin creates org_required tweak → member's popup shows it
  4. Member locally disables it → still applied to other members, not them
  5. Admin deletes the org_required tweak → it disappears for everyone

## Open question waiting for the user

The user asked: **"Will the AI eventually be able to use the element picker?"**

I answered with three paths (A: AI proposes selectors, picker verifies; B: AI requests, user fulfills; C: fully autonomous via headless Chrome). Recommended **A** for V2 (after Phase 2/3 land) since it leverages the existing picker code with a small UX inversion.

**They haven't answered yet.** When picking up after compact, treat this as a parking-lot item — don't dive into building Path A unless they confirm. Phase 2 is still the priority.

## Architectural context that's hard to recover

### File layout

- **Extension (Phase 1, merged):**
  - `JT-Tools-Master/features/tweak-engine/index.js` — engine, applies CSS + actions
  - `JT-Tools-Master/features/tweak-engine/alert-modal.js` — JTTweakAlert modal for `onEvent` verb
  - `JT-Tools-Master/features/inspect-for-ai.js` — picker (single + multi-view) + alt-click capture
  - `JT-Tools-Master/utils/css-sanitizer.js` — client css-tree-AST sanitizer
  - `JT-Tools-Master/utils/tweak-validator.js` — client DSL validator
  - `JT-Tools-Master/popup/popup.{html,js,css}` — Tweaks tab is the 4th tab
  - `JT-Tools-Master/tweaks/edit.{html,js,css}` — standalone editor page
  - `JT-Tools-Master/services/account-service.js` — pattern reference for the new tweaks-api.js
- **Server (Phase 2, in progress on this branch):**
  - `server/mcp-server/migrations/015_tweaks.sql` — schema
  - `server/mcp-server/src/tweaks-css-sanitizer.js` — server sanitizer
  - `server/mcp-server/src/tweaks-validator.js` — server validator
  - `server/mcp-server/src/tweaks-handler.js` — REST handlers
  - `server/mcp-server/src/admin.js` — router (modified to dispatch /admin/tweaks/*)
  - `server/mcp-server/src/portal-auth.js:951` — `authenticateRequest` (used by every /admin/* handler)
- **Portal (Phase 2 Task 7, not started):**
  - `portal/dashboard.html` and friends — the admin web UI

### Server architecture quirks

- **Two server workers exist:** `server/pro-worker/` and `server/mcp-server/`. They serve different purposes. The tweaks endpoints go in `mcp-server` (where `/admin/*` lives). `pro-worker` is the legacy validation proxy.
- **`server/pro-worker/` is untracked** in the repo (whole directory). Don't worry about it for tweaks work.
- **`server/pro-worker/src/index.js:1500`** has `isDeviceAuthorized` short-circuited to `return true;` — fix the user shipped earlier this session. Already deployed via wrangler.
- **MCP server domain:** `jobtread-mcp-server.king0light-ai.workers.dev`
- **Migrations are mostly untracked**: 011-014 are tracked in main, 006-010 + the duplicate 014_extension_grant_keys_logo are local-only. Don't worry about retroactively committing them — they're presumably already applied to the live D1.

### Tier model

From `services/license.js` (in the extension, also in the server's tiers.js):

- **Free** — unlicensed users
- **Essential** — `quickNotes`, `smartJobSwitcher`, `freezeHeader`, `pdfMarkupTools`, `orgLogo`
- **Pro** — `dragDrop`, `rgbTheme`, `previewMode`, `reverseThreadOrder`, `availabilityFilter`, **`tweakEngine`**, **`inspectForAi`**
- **Power User** — `customFieldFilter`, `budgetChangelog`, `taskTypeFilter`, `mcpAccess`, `aiKnowledge` (and Phase 3 will add MCP-on-the-fly tweak authoring)

`org_required` tweak creation requires admin/owner role at the *server level*, but a Pro license is needed for the engine to even apply tweaks. So a non-admin Pro user authors personal tweaks; an admin Pro user can ALSO author org_required.

### chrome.storage.local schema (extension side)

- `jtTweaks` — array of tweak objects (each is a full V1.5 DSL JSON + `enabled` flag)
- `jtTweakDiagnostics` — `{ [tweakId]: { lastMatchCount, lastApplyAt, lastErrorAt, lastErrorMessage } }`

After Task 5 lands, `jtTweaks` becomes a write-through cache of the server's `/admin/tweaks/list` response. Same shape, same key.

### CHANGELOG sections currently in `[Unreleased]` (don't blow these away)

Two existing sub-sections you'll be adding to:
- `### Added` → User Tweaks V1 + V1.5 entries (already in)
- `### Security` → Defense layers entries (already in)

Add a new sub-section under `### Added`:
```
#### User Tweaks Phase 2 — Server-backed storage + org-pushed tweaks
- ...
```

## Hard rules — don't break these

1. **Don't push to `origin`** without the user saying "push it" or "open PR"
2. **Don't run `wrangler deploy`** without explicit "deploy"
3. **Don't change the storage scope on update** — the handler refuses this on purpose; don't loosen it
4. **Don't strip the server-side sanitizer/validator calls** — they're defense in depth
5. **Don't merge this branch to main** until Phase 2 is end-to-end working AND the user signs off
6. **Don't introduce new permissions** on the extension manifest — current set (`storage`, `activeTab`, `clipboardWrite`) is what we have. The `/admin/tweaks/*` calls use existing `host_permissions` to the worker domain.
7. **Don't delete the `claude/tweaks-v1-extension` local branch ref** — it's a marker, harmless to keep. Already merged.

## Quick orientation commands when picking back up

```bash
cd C:/Users/zeepe/OneDrive/Desktop/JT-Power-Tools/.claude/worktrees/claude+tweaks-mcp-storage

# Confirm where you are
git branch --show-current   # → claude/tweaks-mcp-storage
git log --oneline main..HEAD  # → the four Phase 2 commits

# Re-read this handoff
cat docs/plans/2026-04-26-tweaks-phase2-handoff.md

# Re-read the original plan
cat docs/plans/2026-04-25-user-tweaks-v1-impl.md  # Phase 2/3 sections at the bottom

# Verify server files compile
node --check server/mcp-server/src/tweaks-handler.js
node --check server/mcp-server/src/tweaks-validator.js
node --check server/mcp-server/src/tweaks-css-sanitizer.js
node --check server/mcp-server/src/admin.js

# See where Task 5 should start
ls JT-Tools-Master/services/  # find account-service.js as the pattern
grep -n initTweaksSection JT-Tools-Master/popup/popup.js  # find the popup IIFE to update
```

## When you're done with Phase 2

Once Tasks 5-8 are complete:
1. Bump `JT-Tools-Master/manifest.json` version (currently 4.6.0 → 4.7.0 for Phase 2)
2. Final smoke pass per Task 8
3. Tell the user "Phase 2 complete, ready to merge" — they'll decide when to merge to main and whether to start Phase 3 (MCP tools) on a fresh branch off the freshly-merged main
4. **Don't auto-merge.** They explicitly want to control merges.

## Phase 3 preview (don't start until Phase 2 ships)

After Phase 2 lands, Phase 3 = MCP tools in `server/mcp-server/src/tools.js` registry:
- `mcp__jt__list_tweaks` (Pro+)
- `mcp__jt__get_tweak` (Pro+)
- `mcp__jt__create_tweak` (Power User)
- `mcp__jt__update_tweak` (Power User)
- `mcp__jt__revert_tweak` (Power User)

All these read/write the same D1 tables we set up in Task 1, through the same handlers we wrote in Task 3 (just exposed as MCP tools instead of REST endpoints). The Phase 2 plumbing is what makes Phase 3 a small lift.

Also Phase 3 needs: `ai_grant_keys.issued_for_account_id` column added (per the original design doc) so AI-authored tweaks attribute to a real human, not just a license.

---

End of handoff. The next instance of you should be able to pick up by reading this doc and running the orientation commands.
