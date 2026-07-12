# Skill Reference Files — Feature Specification

**Version:** 1.0 (for review)
**Tier:** follows Org Skills (no tier gate — any admin authors skills)
**Status:** Planning — "Phase 1.5" of the Agent Learning Loop, between shipped Phase 1 (single-file SKILL.md import/export) and Phase 2 (skill distillation).
**Dependencies:** shipped Org Skills — `org_skills` (Migrations 038/044), `agent-core/skills.js` (`getSkillsIndex`/`getSkillBody`), `jt_skill` tool (`tools.js`), `admin-skills.js` CRUD, portal Skills tab (`portal/js/page-dashboard.js`), and the Phase 1 `SkillMd` module (`portal/js/skill-md.js`).

---

## Overview

Today a skill is exactly one markdown `body` (≤32KB) keyed by `name`; `jt_skill` returns that body whole. The [agentskills.io](https://agentskills.io/) standard a skill folder can also carry **reference files** (`references/*.md`, tables, examples) that the body points at and the agent loads on demand — progressive disclosure past the single body. This spec adds that: **read-only text reference files attached to a skill**, fetched on demand through the same `jt_skill` tool, with full agentskills.io **bundle (zip) import/export** so a real multi-file skill round-trips in and out.

**Decisions locked (this review):**
- **Storage: a D1 table** `org_skill_files` beside `org_skills` — reference files are small text docs, read-only, fetched in one scoped query. No R2, no signed URLs.
- **Format reach: full bundle.** Import a skill-folder zip (`SKILL.md` + `references/…`); export the same. This lifts Phase 1's single-file-only *import* limit. A loose single `.md` still imports as it does today.

**Explicit non-goals (v1):** executable scripts (we have no execution surface — tools run in-process in the Worker; text reference files only), binary/image files, per-file versioning, reference files on **builtin** skills (in-code; can add a `files` map later), distillation of reference files (Phase 2 proposals stay single-body), and FTS over file contents.

---

## Problem Statement

1. A 32KB body forces everything inline. A skill like "How we price a bathroom remodel" wants a body (the procedure) **plus** a reference sheet (the rate table, the allowance rules) the model pulls only when it's actually pricing. Inlining bloats the body and the tool result; separating them is the whole point of progressive disclosure.
2. Phase 1 import accepts a single `.md`. A real ecosystem skill is a folder. We can generate a bundle zip on export but can't yet *ingest* one — so a skill authored elsewhere (Claude Code, Cursor) can't come in whole.

---

## Data Model — Migration 047

> **Migration numbering:** this feature takes **047**. The Agent Learning Loop spec (kept out-of-repo in the author's working notes, not `.specs/`) reserved 047 for Phase 2 (`skill_proposals` + `agent_messages_fts`); **Phase 2 must take 048 instead** — 047 is now used. Whoever builds Phase 2 renumbers there; nothing in-repo to change today.

```sql
-- Migration 047: Skill reference files — read-only text attachments per skill.
CREATE TABLE IF NOT EXISTS org_skill_files (
  id TEXT PRIMARY KEY,               -- asf_<uuid>
  skill_id TEXT NOT NULL,            -- org_skills.id (app-level cascade on delete)
  path TEXT NOT NULL,                -- skill-relative, e.g. 'references/pricing.md'
  content TEXT NOT NULL,             -- text, <= MAX_FILE_LEN
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_org_skill_files_path ON org_skill_files (skill_id, path);
CREATE INDEX IF NOT EXISTS idx_org_skill_files_skill ON org_skill_files (skill_id);
```

- **Scope is inherited, not duplicated.** A file belongs to a skill via `skill_id`; every read joins through `org_skills` using the *same* scope predicate as `getSkillBody` (org row for `ctx.orgId`, or license global for `ctx.license.id`). A caller can only reach a file if they can reach its skill — the scope boundary is enforced once, in the join.
- **No hard FK / no DB cascade.** D1 delete-cascade behavior is not relied on; `deleteSkillData` explicitly deletes the skill's files in the same batch (matches how the codebase already does explicit deletes).
- **Caps** (API-enforced, mirroring `admin-skills.js` constants):
  - `MAX_FILE_LEN` = 32768 (per file, same as body).
  - `MAX_FILES_PER_SKILL` = 20.
  - `MAX_FILES_TOTAL_LEN` = 262144 (256KB aggregate per skill — bounds a bundle).
  - Path: skill-relative, no leading `/`, no `..` segments, `[A-Za-z0-9._/-]` only, ≤128 chars, and a **text extension allowlist** (`.md .txt .json .csv .yaml .yml`). Non-text paths (e.g. `scripts/run.py`, images) are **rejected on save / skipped on import** with a clear message — text reference only.
  - Each file's `content` runs the existing `CREDENTIAL_RE` scan (files are sent to the model verbatim, same risk as the body).

---

## Read Path — `agent-core/skills.js` + `jt_skill`

Two new data-layer functions beside `getSkillBody` (fail-open, same posture):

- `listSkillFiles(db, orgId, licenseId, name)` → `[{ path }]` — the file manifest for a skill, scoped by the join. `[]` if none or on any error.
- `getSkillFile(db, orgId, licenseId, name, path)` → `{ path, content } | null` — one file, scoped by the join.

**`jt_skill` gains an optional `file` param:**

```
jt_skill { name: string, file?: string }
```

- **`file` omitted** (today's behavior): return the body. If the skill has reference files, append a **manifest footer** so the model knows what it can fetch:
  ```
  <body>

  ---
  Reference files (fetch with jt_skill using name + file): references/pricing.md, references/allowances.md
  ```
  The footer is appended only when files exist; a fileless skill is byte-identical to today.
- **`file` provided:** return that file's `content`. Unknown path → a helpful message listing the skill's available file paths (mirrors the unknown-name behavior).
- Read-classified, unchanged (`readOnlyHint: true`). The tool description gains one sentence about the `file` arg and progressive disclosure.

**Cache discipline (unchanged guarantees):** file contents and the manifest footer load as **tool results (layer 5)** — outside the cached system-prompt prefix, exactly like bodies. The skill **index stays `name — description` only**; file paths never enter the cached prefix. Editing/adding/removing files invalidates **nothing** cached.

---

## Admin CRUD — `admin-skills.js`

Files travel with their skill through the existing endpoints (no new routes needed for CRUD; the bundle import reuses `save`):

- **`saveSkillData`** accepts an optional `files: [{ path, content }]`. When present it is a **full replace** of the skill's file set (validate all → delete existing → insert) in one `db.batch`, matching the body's replace-on-save semantics. Omitted `files` leaves existing files untouched (back-compat with the current single-field save). Validation: count/total/size caps, path rules + text-extension allowlist, credential scan per file. Name-conflict and 404 handling unchanged.
- **`getSkillData`** returns `files: [{ path, content }]` (sorted by path) so the editor can render and round-trip them.
- **`listSkillsData`** adds `fileCount` per row (one `COUNT` grouped query, or a cheap correlated subquery) for the list badge. Bodies still aren't shipped in the list.
- **`deleteSkillData`** also deletes the skill's `org_skill_files` rows (explicit cascade, same batch).

No new permission surface: same org-admin gate, same license/org scoping via `fetchSkillRow`.

---

## Import / Export — `SkillMd` (`portal/js/skill-md.js`)

Phase 1's module gains the read side of zip plus bundle grouping. All pure/isomorphic, unit-tested under `tests/utils/skill-md.test.js`.

- **`SkillMd.unzip(bytes)` → `Promise<[{ path, content }]>`** — parse the EOCD → central directory → local headers. `method 0` (store) sliced directly; `method 8` (deflate) inflated via the browser-standard **`DecompressionStream('deflate-raw')`** (available in the portal's browser and in Workers — no library). Directory entries (path ending `/`) and non-text extensions are dropped. Async because inflate is stream-based.
- **`SkillMd.parseBundle(files)` → `[{ name, description, body, files }]`** — group decoded entries by top-level folder. Each `<folder>/SKILL.md` is a skill (parsed via existing `parse`); its siblings under `<folder>/…` become that skill's reference files with the `<folder>/` prefix stripped (so `bathroom/references/rates.md` → `references/rates.md`). A single loose `SKILL.md` or bare `.md` with no folder → one skill, no files.
- **`SkillMd.generate` / `zip` unchanged**; export composition (below) supplies the file entries.

**Portal wiring (`page-dashboard.js`, `dashboard.html`):**
- **Import:** the file input `accept` adds `.zip`. `handleSkillFiles` branches: a `.zip` → `await unzip` → `parseBundle` → queue each skill (editor prefilled with body **and** its files); a `.md` → today's single-file path. Server `save` (with `files`) is the same validation gate — an over-cap or non-text file surfaces the server's 400 verbatim.
- **Export (per-skill Download):** `.md` when the skill has no files (unchanged); a `<slug>.zip` of `<slug>/SKILL.md` + `<slug>/<path>` when it has files.
- **Export all:** each skill's zip folder now also carries its reference files under `<slug>/<path>`. Slug de-dup unchanged.

---

## Portal Editor UI — `page-dashboard.js` + `dashboard.html`

The skill editor gains a **Reference files** section under the body:
- A list of files, each a row: a **path** input (placeholder `references/pricing.md`) + a collapsible **content** textarea + a **Remove** button, plus an **Add file** button.
- On open (edit), populated from `getSkillData().files`. On save, serialized into the `files` array on the `save` payload.
- Inline validation echoes the server rules (path shape, text extension, count) but the server remains the real gate.
- List view: a small "N files" affordance on rows with `fileCount > 0` (next to Size).

Styling reuses existing portal form/list tokens — no new palette.

---

## Interaction with Phase 2 (distillation)

Unchanged: `skill_proposals` stays single-body; a distilled+approved skill is an ordinary `org_skills` row and can gain reference files afterward in the editor. No schema or prompt coupling.

---

## Economics & Safety

- **Zero added LLM cost.** Files load only on an explicit `jt_skill { file }` call the model chooses to make — same explicit-tool economics as bodies. The manifest footer is a few tokens appended to a body read the model already requested.
- **Injection surface = same as bodies.** Files are trusted config authored/approved by an org admin, sent verbatim to the model; the credential scan runs per file; text-extension allowlist blocks smuggling an executable payload (which we couldn't run anyway).
- **Scope safety** is structural: file reads join through the scoped skill query, so no cross-org/cross-license file is reachable.

---

## Tests & Verification

- **`SkillMd` (unit, `tests/utils/skill-md.test.js`):** `zip`→`unzip` store-only round-trip (byte-stable content); `parseBundle` grouping (folder → skill + relative-path files); loose-`.md`→fileless-skill; directory-entry and non-text-extension filtering; path normalization. Deflate decode is verified in a **real-browser harness** (like Phase 1's `createObjectURL` check) since `DecompressionStream` may not be a jsdom global.
- **Server (co-located, `admin-skills.test.js`):** save-with-files full-replace; caps (count/size/total) → 400; path/extension rejection → 400; credential scan per file; `getSkillData` returns sorted files; `deleteSkillData` cascades; `getSkillFile`/`listSkillFiles` scope isolation (an org can't read another org's skill file). Extend `skills.test.js` for `jt_skill { file }` and the manifest footer (footer present only with files; fileless read byte-identical to today).
- **Round-trip realism:** import a real public agentskills.io skill folder (zipped), confirm body + references land, export it back, diff.

---

## Build Plan

1. **`SkillMd` unzip + parseBundle** (+ tests) — pure, no backend. Verify store round-trip in unit tests, deflate in the browser harness.
2. **Migration 047** `org_skill_files` + the numbering shift note in the learning spec.
3. **Read path**: `getSkillFile`/`listSkillFiles`, `jt_skill { file }` + manifest footer (+ tests).
4. **Admin CRUD**: `save`/`get`/`list`/`delete` file handling (+ tests).
5. **Portal**: import branch for `.zip`, editor Reference-files section, per-skill/all export with files, list badge.
6. **CHANGELOG** + real-browser verification (import a bundle, export it, round-trip).

Ordering rationale: the pure module leads (it's the riskiest logic and unblocks import), then the DB/read/write spine, then UI last.

---

## Open Questions

1. **Per-skill export shape** when a skill has no files: keep the bare `<slug>.md` (current) vs always a `<slug>/SKILL.md` zip for consistency. Lean: keep bare `.md` (nothing to bundle) — simpler for the common case.
2. **Builtin reference files:** deferred. If a builtin ever needs one, add a `files` map to `builtin-skills.js` and teach `getSkillFile`/`listSkillFiles` to fall back to it (same merge order as bodies). Not v1.
3. **Deflate on import in tests:** if `DecompressionStream` turns out available under the vitest Node runtime, promote the deflate case from browser-harness to a unit test.
