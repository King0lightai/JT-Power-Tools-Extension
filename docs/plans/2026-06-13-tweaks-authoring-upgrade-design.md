# Tweaks Authoring Upgrade — Design

- **Date:** 2026-06-13
- **Status:** Design approved — pending implementation plan
- **Scope:** Authoring experience only. Management (popup), governance (portal admin), and a tweak library are separate sub-projects, sequenced after this.

## Why

The tweak engine is mature at **running, managing, and governing** tweaks (cache-first apply, auto-disable-on-breakage with re-enable, status chips, org-required transparency banner, privacy-preserving admin audit, full version history in D1, dual client+server validation and CSS sanitization). It is raw at **creating** them.

Today, authoring a tweak means either:
1. Hand-writing the JSON DSL in a raw `<textarea>` (`tweaks/edit.html`), or
2. A four-app round-trip: enable Inspect-for-AI → Alt-click an element → it copies a markdown prompt to the clipboard → paste into an *external* AI chat → copy the JSON back → paste into the popup's import box.

Both are developer-grade. Nobody non-technical at a remodeling company is doing either. The engine is powerful; the front door isn't. This upgrade fixes the front door for two audiences at once — **both, tiered** — without changing the engine's safety model.

## Goals

- A non-technical user can author the common tweaks with **zero JSON and zero AI**, seeing the change live on the real page before saving.
- A power user / admin can author **any** tweak by talking to their **own** connected AI client (no inference hosted by us).
- A tweak can be **safely exported and shared**, and safely imported, with a plain-English trust gate before anything runs.
- Every path produces the identical, already-validated DSL — one engine, one safety model.

## Non-goals (this pass)

- A visual flow-builder for multi-step / conditional tweaks (`onEvent` + `then[]`). That's exactly where natural language beats a form — it belongs to the MCP/AI path.
- A schema-aware code editor (CodeMirror/autocomplete). The JSON editor stays as a fallback; niceties are deferred.
- The tweak **library/gallery** surface. The share path seeds it, but it's its own sub-project.
- Portal admin completion for org-required tweaks. Separate sub-project.
- A server-minted **share link**. File-first now; link later (reuses D1 + portal when built).

## Constraints (locked decisions)

1. **No hosted AI.** AI authoring is the user's own MCP-connected client. We expose tools; the user brings the model.
2. **Styling parity with the popup.** The injected builder must look like the popup — see "Styling" below.
3. **Engine safety model is unchanged.** Closed verb list, dual validate, CSS sanitize/auto-scope, anti-clickjacking guard on `setText`, no `innerHTML`, org+URL scoping. Every new front-end emits DSL that passes the existing validators.
4. **File-first export transport.** Sanitized `.json` (download + clipboard) now; share link later.

## Architecture — the shared core

The trap is three half-built authoring UIs. The unlock: every path emits the same DSL, so build one shared core and keep the front-ends thin.

```
                  ┌──────────────── shared core ─────────────────┐
  Visual builder  │ describe() → DSL → plain-English summary       │
  (everyone) ────▶│ preview()  → live apply-with-undo on JT tab    │◀── MCP tools
  MCP / own AI ──▶│ validate() → DSL + CSS sanitize  (exists)      │    (power users)
  Paste-back ────▶│ port()     → export-sanitize / import-rewrite  │
  Editor (fallbk) └───────────────────────────────────────────────┘
                                     │
                         chrome.storage + D1  (unchanged)
```

- **`describe(tweak) → string[]`** — turns any tweak into a plain-English summary ("Renames 'Vendor' → 'Trade Partner' on /budget · Warns before clicking Delete · Runs no code"). New. Must cover every verb. Reused by: builder live-preview label, import-trust dialog, popup card description, and the MCP `create_tweak` confirmation. One function, four surfaces.
- **`preview(tweak)` / `preview.clear()`** — extends the existing `TWEAK_DRY_RUN` message from "selector match counts" to an actual **reversible live apply** on the JT tab. Teardown reuses the engine's existing `removeAllAppliedTweaks` discipline so a preview never persists or leaks. Used by builder, import, editor.
- **`validate()` + CSS sanitize** — already exists (`utils/tweak-validator.js`, `utils/css-sanitizer.js`, mirrored server-side). Reused as-is.
- **`port.export(tweak)` / `port.import(payload, activeOrg)`** — sanitize-out / re-validate-and-rewrite-in. New. See cross-cutting section.

Front-ends become thin: the builder is forms that emit DSL; the MCP path is finishing the Phase-3 tools (they call the same validate/describe); paste-back + the JSON editor become the power/fallback path.

## Front-end 1 — Visual builder (everyone, no AI)

**Placement:** an **in-page docked panel injected on the JobTread page** (content-script context) — *not* the popup, *not* the standalone editor page. This keeps the live preview on the real page, which is what makes it usable for non-technical people.

**Flow:**
1. Enable the picker (popup toggle or the existing `Alt+Shift+P`); click any element on JobTread.
2. The panel slides in, pre-loaded with the capture (reuses the existing picker + `@medv/finder` selector generation).
3. Pick one of six intents (below). A one-field form appears.
4. The change **previews live on the real page** behind the panel, with an Undo — nothing commits until Save.
5. Scope auto-fills: active org (`OrgDetector`) + current page path as the suggested `urlMatch`.
6. Name it → Save. Writes a `personal` tweak; the engine hot-applies via its storage-change listener.

**v1 verb set — six one-click intents** (each maps to a single DSL verb + a one-field form):

| Intent | DSL verb |
|---|---|
| Rename text | `setText` (clickjacking guard surfaced *before* save, not as a silent apply-time failure) |
| Hide it | `hide` |
| Restyle (color / size / weight) | `setStyle` / `addClass` |
| Warn before clicking | `confirmBeforeAction` (or `onEvent` + `alert`) |
| Sort this table | `sortChildren` |
| Move above / below | `moveBefore` / `moveAfter` |

Multi-step chains, conditional logic, and cross-view tweaks are **out** — routed to the MCP/AI path.

**Reference wireframe** (rendered in design chat): JT budget table on the left with the "Vendor" column header selected (orange `#f08c00` picker outline) and already showing "Trade Partner" with a "live" tag; docked dark builder panel on the right with the picked-element chip, the six intent chips (Rename selected), the "Change text to" field, a green "Safe — not an action/financial button" line, a Live-preview toggle, the auto-filled scope line, a Name field, and Cancel / Save.

**Styling:** The builder is injected onto JT, so it can't `@import popup.css` (not loaded there; JT's CSS would bleed). Instead, **extract the popup's design tokens + component styles** (dark palette `#2c2c2c`/`#252525`/`#333`/`#3a3a3a`/`#404040`/`#505050`, text `#e0e0e0`/`#b0b0b0`/`#a0a0a0`, primary `#3B82F6`, buttons, inputs, toggle, `required` badge, `tweak-card`, `status-chip`) into **one shared stylesheet that both the popup and the injected builder load** — the builder via a `web_accessible_resource` `<link>`, namespaced under `.jt-tools-` with enough specificity to resist JT bleed. Popup and builder then can't drift, because they're the same tokens.

## Front-end 2 — MCP / own-AI path (power users & admins, zero hosting)

Finish the scaffolded Phase-3 tools: `create_tweak`, `update_tweak`, `revert_tweak`. The user's own connected client (Claude Desktop/Code, Cursor) calls them.

- **Same core.** The tools run the same `validate()` + CSS sanitize + `describe()` as the builder, so an AI-authored tweak is byte-identical in shape to a hand-built one. `create_tweak` returns the `describe()` summary as its confirmation before it lands.
- **Same guardrails.** AI emits only the closed verb list; server re-validates + re-sanitizes; clickjacking guard applies; `create_tweak` defaults to `personal`. Pushing `org_required` still requires the caller's admin role server-side — an AI can't distribute org-wide unless the person driving it already could.
- **Landing behavior:** AI-created personal tweaks land **live + flagged** — applied immediately, with a "New · AI-created" badge + a one-line review nudge on the popup card (`describe()` makes them inspectable). Org-required stays admin-gated and explicitly confirmed.
- **Context hand-off (both, v1):**
  - *Paste-first:* the picker's existing clipboard markdown works in any AI client today.
  - *`get_recent_picks` MCP tool:* the picker also **stashes captures server-side keyed to the account**, so a power user's connected AI pulls the last element(s) they clicked with zero copy-paste. Members without MCP never touch it — pure upside for the power tier.

## Front-end 3 — JSON editor (demoted to fallback)

`tweaks/edit.html` stops being the front door and becomes the **power/debug fallback**: paste an AI's JSON, inspect/repair a malformed tweak, see raw validation/sanitize output and dry-run match counts. Keep it. Point everyone non-technical at the builder. Schema-aware editor niceties (CodeMirror/autocomplete) are deferred.

## Cross-cutting — Safe export/share + import-trust

**Export** (`port.export`): an "Export / Share" action on any tweak card (and in the builder/editor).
- **Strips:** `id`, your org name (`scope.jtOrg`), your display name (`authorDisplayName`), any captured DOM / `originalDomContext`, diagnostics.
- **Keeps:** `name`, `description`, `css`, `actions`, `urlMatch` (a path substring like `/budget` — useful, not PII).
- Output: a `.json` file download + "Copy to clipboard," tagged `"_jtpt": "tweak-share-v1"` so import recognizes it.
- A **pre-export confirm** shows exactly what's included vs. stripped — and surfaces `description` (your own free text) so you can edit it before sharing rather than silently stripping your words.

**Import** (`port.import`): re-validate + re-sanitize, mint a **fresh `id`**, rewrite `scope.jtOrg` to the importer's active org, and **force `scope = personal`** — a shared tweak can never land as `org_required`; only the recipient's own admin can promote it later.

**Import-trust gate** (the safety UX — reference wireframe rendered in design chat): before anything touches the page, a dialog (popup styling) shows the tweak name + description, a plain-English "What it does" from `describe()`, a safety summary ("Runs no code — declarative only · Can't modify financial/action buttons · Scoped to <your org>, /budget only · Added as personal — only you see it"), a "Stripped on import" note, a "Preview on this page first" action, and Cancel / Add to my tweaks.

**Trust asymmetry (deliberate):** imported-from-a-file tweaks are **preview-then-confirm** — they do *not* auto-apply; "Add to my tweaks" enables them. This is stricter than AI-created tweaks (live + flagged) because your own connected AI is a trusted actor and a file someone emailed you is a stranger's content. Same engine, same DSL — different trust, different default.

## Data model & validation impact

- **Recent picks** (for `get_recent_picks`): new D1 table proposal `tweak_picks (account_id, id, capture_json, created_at)`, capped to the last ~10 per account (or KV with TTL). Resolve store choice in planning.
- **AI-created / unreviewed flag:** `tweak_versions.authored_by_ai` already exists (server-side source of truth). The "New · AI-created, unreviewed" popup badge needs a per-account "reviewed" marker — proposed as a local `chrome.storage.local['jtTweakReviewed']` map to avoid a migration (the badge is a UX nudge). Resolve in planning.
- **Validators unchanged.** Builder output and MCP output must pass the existing client + server validators as-is.
- **`describe()` is new** and must have a branch for every verb (`addClass`, `removeClass`, `setStyle`, `hide`, `show`, `setText`, `onEvent`, `confirmBeforeAction`, `moveBefore`, `moveAfter`, `sortChildren`, including `then[]` chains and the `match` guard).

## Safety

- `preview()` must be **truly reversible and non-persistent** — teardown identical to `removeAllAppliedTweaks` for the candidate tweak; a preview never writes to storage or the server.
- Export sanitization is the PII boundary — captured DOM/`originalDomContext` and org/author identity must never leave in a shared file. Covered by tests.
- Import re-runs the full server-side validate + sanitize (defense in depth) — the importer never trusts the file's claims.
- The clickjacking guard and closed verb list are unchanged and apply to all paths.

## Testing

- **Unit:** `describe()` (every verb → expected summary), `port.export` (strip list correctness, PII removal, envelope tag), `port.import` (fresh id, org rewrite, force-personal, re-validate), builder form → DSL emission per verb.
- **E2E:** in-page builder (pick → form → live preview → save → engine applies), import-trust dialog (preview-then-confirm gating), against `tests/fixtures/jobtread/*`.
- **Regression:** the existing `npm run eval:full` gates (unit, security guard, tooling lint, visual regression) stay green; builder/dialog get visual baselines.

## Build sequence

1. **Shared core** — `describe()`, `preview()` (apply-with-undo), `port.export/import`, and the shared popup-token stylesheet. Everything else depends on these.
2. **Visual builder** — in-page panel + the six verb forms, on top of the core.
3. **Export / import UI** — uses `port` + `describe` + `preview` + the trust dialog.
4. **MCP path** — finish `create_tweak`/`update_tweak`/`revert_tweak`, `get_recent_picks`, and the live+flagged popup surfacing.
5. **Editor demotion** — repoint navigation at the builder; keep the JSON editor as fallback.

## Deferred / out of scope

- Server-minted share link (after file-first ships).
- Schema-aware / CodeMirror editor.
- Visual flow-builder for multi-step chains (owned by the MCP/AI path).
- Tweak library / gallery (separate sub-project; seeded by the share path).
- Portal admin completion for org-required tweaks (separate sub-project).
