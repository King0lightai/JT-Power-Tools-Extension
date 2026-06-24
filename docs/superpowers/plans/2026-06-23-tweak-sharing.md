# Tweak Sharing (Share + Auto-load) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a licensed user share a stripped tweak as a short link (`app.jtpowertools.com/s/<code>`), and let recipients auto-load it with a confirm-and-preview prompt when they open the link on JobTread.

**Architecture:** Reuse the existing `TweakPort.exportTweak`/`importTweak` strip+rescope primitives. Add a server-backed short-code store on the MCP worker (new D1 table + 3 routes: authed `POST /admin/tweaks/share`, public `GET /shared/<code>` JSON, public `GET /s/<code>` branded landing). On the extension side: a `TweaksApi.share()` wrapper, Share buttons in the popup tweak list + the on-page editor, and a content-script auto-loader on `app.jobtread.com` that reads `?jtpt_share=<code>`, fetches the envelope, and imports it through a confirm dialog.

**Tech Stack:** Cloudflare Workers + D1 (server), plain-JS Chrome MV3 content scripts/popup (extension). Server tests: `node --test`. Extension tests: `vitest`. Lint: `eslint`. Eval gate: `node scripts/eval.js`.

**Key constants / names (keep identical across tasks):**
- Envelope tag: `tweak-share-v1` (matches `TweakPort.SHARE_TAG` in `JT-Tools-Master/features/tweak-engine/port.js:9`).
- Deep-link param on JobTread: `jtpt_share`.
- Share base origin (creator-facing): `https://app.jtpowertools.com` → `…/s/<code>`.
- Public JSON resolve (extension fetch, in `host_permissions`): `https://jobtread-mcp-server.king0light-ai.workers.dev/shared/<code>`.
- JobTread deep link from landing: `https://app.jobtread.com/?jtpt_share=<code>`.
- Chrome Web Store install URL (landing fallback): `https://chromewebstore.google.com/detail/jt-power-tools/kfbcifdgmcendohejbiiojjkgdbjkpcn`.
- D1 binding: `env.DB`. Table: `shared_tweaks`.
- New server fns: `generateShareCode`, `sanitizeShareEnvelope`, `createSharedTweakData`, `getSharedTweakData`, `handleShareTweak`, `handleSharedTweakRoute`, `renderShareLandingHtml`.

---

## File Structure

**Server (`server/mcp-server/`):**
- Create: `migrations/032_shared_tweaks.sql` — the short-code store.
- Modify: `src/tweaks-handler.js` — add share constants, envelope sanitizer, create/get data fns, REST handlers, the `/admin/tweaks/share` switch entry, and the public `handleSharedTweakRoute` + landing HTML.
- Modify: `src/index.js` — dispatch `/shared/<code>` + `/s/<code>` before `oauthProvider.fetch`.
- Create: `src/tweaks-share.test.js` — unit tests for code generation, envelope sanitize, create/get round-trip, route matching.

**Extension (`JT-Tools-Master/`):**
- Modify: `services/tweaks-api.js` — add `share(envelope)`.
- Modify: `popup/popup.html` — load `port.js`; add a Share result dialog.
- Modify: `popup/popup.js` — add a Share button per tweak card; share handler.
- Modify: `tweaks/edit.html` — load `port.js`; add a Share button to the header.
- Modify: `tweaks/edit.js` — wire the editor Share button.
- Create: `features/tweak-engine/share-loader.js` — the JobTread auto-loader (parse param → fetch → confirm modal → import).
- Modify: `manifest.json` — register `share-loader.js` in the JobTread content-script list.
- Create: `tests/features/tweak-share-loader.test.js` — unit tests for the loader's pure helpers.
- Modify: `CHANGELOG.md` — document under `[Unreleased]`.

---

## Phase A — Server: short-code store + endpoints + landing

### Task 1: Create the `shared_tweaks` D1 migration

**Files:**
- Create: `server/mcp-server/migrations/032_shared_tweaks.sql`

- [ ] **Step 1: Write the migration**

```sql
-- Migration 032: shared_tweaks — server-backed short codes for tweak sharing.
-- A creator exports a stripped tweak envelope (TweakPort.exportTweak) and we
-- store it under a short code. Recipients resolve the code on app.jobtread.com
-- (the content-script auto-loader) or view a branded landing at /s/<code>.
-- created_by_account_id is nullable + intentionally has NO foreign key: the
-- payload carries no org/PII data, the code is the only handle, and we don't
-- want account deletion to cascade-drop still-shared links.
CREATE TABLE IF NOT EXISTS shared_tweaks (
  code                  TEXT PRIMARY KEY,
  payload_json          TEXT NOT NULL,
  created_by_account_id TEXT,
  created_at            INTEGER NOT NULL,
  hits                  INTEGER NOT NULL DEFAULT 0
);

-- Supports the per-account hourly rate-limit count in createSharedTweakData.
CREATE INDEX IF NOT EXISTS idx_shared_tweaks_creator
  ON shared_tweaks (created_by_account_id, created_at);
```

- [ ] **Step 2: Verify the file parses as SQL (sanity only — no DB yet)**

Run: `node -e "const s=require('fs').readFileSync('server/mcp-server/migrations/032_shared_tweaks.sql','utf8'); if(!/CREATE TABLE IF NOT EXISTS shared_tweaks/.test(s)) throw new Error('missing table'); console.log('ok')"`
Expected: prints `ok`

- [ ] **Step 3: Commit**

```bash
git add server/mcp-server/migrations/032_shared_tweaks.sql
git commit -m "feat(server): add shared_tweaks D1 migration for tweak sharing"
```

---

### Task 2: Share-create data layer + REST handler

**Files:**
- Modify: `server/mcp-server/src/tweaks-handler.js` (add constants + fns near the other data-layer fns; add the switch case in `handleTweaksRoute` at line ~899)
- Test: `server/mcp-server/src/tweaks-share.test.js`

- [ ] **Step 1: Write the failing test**

Create `server/mcp-server/src/tweaks-share.test.js`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  generateShareCode,
  sanitizeShareEnvelope,
  createSharedTweakData,
  getSharedTweakData,
  handleSharedTweakRoute,
} from './tweaks-handler.js';

const VALID_ENVELOPE = {
  _jtpt: 'tweak-share-v1',
  version: 1,
  name: 'Tiny Gantt bars',
  description: 'Shrinks schedule bars',
  css: '.gantt-bar { height: 6px !important; }',
  actions: [],
  scope: { urlMatch: '/schedule' },
};

// In-memory D1 stub: just enough surface for prepare().bind().first()/run().
function makeDbStub() {
  const rows = new Map(); // code -> row
  return {
    rows,
    prepare(sql) {
      return {
        sql,
        args: [],
        bind(...args) { this.args = args; return this; },
        async first() {
          if (/FROM shared_tweaks WHERE code = \?/.test(sql)) {
            return rows.get(this.args[0]) || null;
          }
          if (/COUNT\(\*\)/.test(sql)) {
            return { n: 0 };
          }
          return null;
        },
        async run() {
          if (/INSERT INTO shared_tweaks/.test(sql)) {
            const [code, payload_json, created_by_account_id, created_at] = this.args;
            rows.set(code, { code, payload_json, created_by_account_id, created_at, hits: 0 });
          }
          if (/UPDATE shared_tweaks SET hits/.test(sql)) {
            const row = rows.get(this.args[0]);
            if (row) row.hits += 1;
          }
          return { success: true };
        },
      };
    },
  };
}

test('generateShareCode returns 8 unambiguous chars', () => {
  const code = generateShareCode();
  assert.equal(code.length, 8);
  assert.match(code, /^[23456789ABCDEFGHJKMNPQRSTUVWXYZ]{8}$/);
});

test('sanitizeShareEnvelope strips unknown fields and keeps the safe ones', () => {
  const { clean } = sanitizeShareEnvelope({ ...VALID_ENVELOPE, id: 'x', jtOrg: 'Secret Org', storageScope: 'org_required' });
  assert.equal(clean._jtpt, 'tweak-share-v1');
  assert.equal(clean.name, 'Tiny Gantt bars');
  assert.equal(clean.scope.urlMatch, '/schedule');
  assert.equal(clean.id, undefined);
  assert.equal(clean.jtOrg, undefined);
  assert.equal(clean.storageScope, undefined);
});

test('sanitizeShareEnvelope rejects a non-envelope', () => {
  assert.throws(() => sanitizeShareEnvelope({ name: 'no tag' }), /_jtpt/);
});

test('create then get round-trips the envelope and increments hits', async () => {
  const env = { DB: makeDbStub() };
  const account = { id: 'acct1' };
  const created = await createSharedTweakData(env, account, VALID_ENVELOPE);
  assert.equal(created.ok, true);
  assert.match(created.url, /^https:\/\/app\.jtpowertools\.com\/s\/[23456789A-Z]{8}$/);

  const got = await getSharedTweakData(env, created.code);
  assert.equal(got.envelope.name, 'Tiny Gantt bars');
  assert.equal(env.DB.rows.get(created.code).hits, 1);
});

test('getSharedTweakData throws 404 for an unknown code', async () => {
  const env = { DB: makeDbStub() };
  await assert.rejects(() => getSharedTweakData(env, 'NOPECODE'), (e) => e.status === 404);
});

test('handleSharedTweakRoute returns null for non-share paths', async () => {
  const env = { DB: makeDbStub() };
  const res = await handleSharedTweakRoute(new Request('https://x/other'), env, '/other');
  assert.equal(res, null);
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd server/mcp-server && node --test src/tweaks-share.test.js`
Expected: FAIL — `generateShareCode`/`sanitizeShareEnvelope`/etc. are `undefined` (not exported yet).

- [ ] **Step 3: Add the share constants + helpers to `tweaks-handler.js`**

Insert this block immediately **after** the `VALID_SCOPES` constant (currently `tweaks-handler.js:55`):

```js
// ─── Tweak sharing (short-code store) ───────────────────────────────

const SHARE_TAG = 'tweak-share-v1';
// No 0/O/1/I/L — unambiguous when typed or read aloud.
const SHARE_CODE_ALPHABET = '23456789ABCDEFGHJKMNPQRSTUVWXYZ';
const SHARE_CODE_LEN = 8;
const MAX_SHARE_BYTES = 64 * 1024;
const SHARE_RATE_PER_HOUR = 100;
const SHARE_BASE_ORIGIN = 'https://app.jtpowertools.com';
const SHARE_INSTALL_URL =
  'https://chromewebstore.google.com/detail/jt-power-tools/kfbcifdgmcendohejbiiojjkgdbjkpcn';
const SHARE_JOBTREAD_DEEPLINK = 'https://app.jobtread.com/?jtpt_share=';

/** 8-char code from an unambiguous alphabet, via CSPRNG. */
export function generateShareCode(len = SHARE_CODE_LEN) {
  const bytes = new Uint8Array(len);
  crypto.getRandomValues(bytes);
  let out = '';
  for (let i = 0; i < len; i++) {
    out += SHARE_CODE_ALPHABET[bytes[i] % SHARE_CODE_ALPHABET.length];
  }
  return out;
}

/**
 * Validate + minimize a share envelope (the output of TweakPort.exportTweak).
 * Keeps only name/description/css/actions/scope.urlMatch; CSS runs through
 * the same sanitizer as authored tweaks (defense in depth). Throws TweakError
 * on a bad envelope. Returns { clean, json }.
 */
export function sanitizeShareEnvelope(envelope) {
  if (!envelope || typeof envelope !== 'object' || envelope._jtpt !== SHARE_TAG) {
    throw new TweakError('Not a shareable tweak envelope (missing or wrong _jtpt tag)', 400);
  }
  if (typeof envelope.name !== 'string' || !envelope.name.trim()) {
    throw new TweakError('A shared tweak requires a name', 400);
  }
  const clean = { _jtpt: SHARE_TAG, version: 1, name: envelope.name.trim().slice(0, 200) };
  if (typeof envelope.description === 'string' && envelope.description.trim()) {
    clean.description = envelope.description.trim().slice(0, 2000);
  }
  if (typeof envelope.css === 'string' && envelope.css.trim()) {
    const r = sanitizeCss(envelope.css, { tweakId: 'share' });
    if (!r.ok) throw new TweakError('Shared tweak CSS rejected by sanitizer', 400, r.errors);
    clean.css = r.css;
  }
  if (Array.isArray(envelope.actions) && envelope.actions.length) {
    clean.actions = JSON.parse(JSON.stringify(envelope.actions));
  }
  clean.scope =
    envelope.scope && typeof envelope.scope.urlMatch === 'string'
      ? { urlMatch: envelope.scope.urlMatch.slice(0, 500) }
      : {};
  const json = JSON.stringify(clean);
  if (json.length > MAX_SHARE_BYTES) throw new TweakError('Shared tweak is too large', 413);
  return { clean, json };
}

/**
 * Store a share envelope under a fresh code. Enforces a per-account hourly
 * cap. Returns { ok: true, code, url }.
 */
export async function createSharedTweakData(env, account, envelope) {
  const { json } = sanitizeShareEnvelope(envelope);

  const since = Math.floor(Date.now() / 1000) - 3600;
  const recent = await env.DB
    .prepare('SELECT COUNT(*) as n FROM shared_tweaks WHERE created_by_account_id = ? AND created_at > ?')
    .bind(account.id, since)
    .first();
  if (recent && recent.n >= SHARE_RATE_PER_HOUR) {
    throw new TweakError('Share limit reached — try again later', 429);
  }

  const now = Math.floor(Date.now() / 1000);
  // Try a few codes in case of a (vanishingly unlikely) collision.
  for (let attempt = 0; attempt < 5; attempt++) {
    const code = generateShareCode();
    const existing = await env.DB
      .prepare('SELECT code FROM shared_tweaks WHERE code = ?')
      .bind(code)
      .first();
    if (existing) continue;
    await env.DB
      .prepare('INSERT INTO shared_tweaks (code, payload_json, created_by_account_id, created_at, hits) VALUES (?, ?, ?, ?, 0)')
      .bind(code, json, account.id, now)
      .run();
    return { ok: true, code, url: SHARE_BASE_ORIGIN + '/s/' + code };
  }
  throw new TweakError('Could not allocate a share code — try again', 500);
}

/**
 * Resolve a code to its envelope and bump the hit counter (best-effort).
 * Throws TweakError(404) if the code is unknown. Returns { envelope }.
 */
export async function getSharedTweakData(env, code) {
  if (typeof code !== 'string' || !/^[23456789A-Z]{6,12}$/.test(code)) {
    throw new TweakError('Invalid share code', 400);
  }
  const row = await env.DB
    .prepare('SELECT payload_json FROM shared_tweaks WHERE code = ?')
    .bind(code)
    .first();
  if (!row) throw new TweakError('Shared tweak not found', 404);
  // Best-effort analytics; never block the read on it.
  try {
    await env.DB.prepare('UPDATE shared_tweaks SET hits = hits + 1 WHERE code = ?').bind(code).run();
  } catch (_e) { /* ignore */ }
  let envelope;
  try {
    envelope = JSON.parse(row.payload_json);
  } catch (_e) {
    throw new TweakError('Shared tweak is corrupted', 500);
  }
  return { envelope };
}
```

- [ ] **Step 4: Add the REST handler for `POST /admin/tweaks/share`**

Insert this **after** `handleAuditTweaks` (currently ends at `tweaks-handler.js:891`) and **before** the `// ─── Router` comment:

```js
/**
 * POST /admin/tweaks/share — authed (active license). Body: { envelope }.
 * Returns { ok: true, code, url }. This is the effective "licensed tweak
 * user" gate: same active-license requirement as /admin/tweaks/create.
 */
export async function handleShareTweak(request, env) {
  const { account, error } = await requireAccount(request, env);
  if (error) return error;
  const body = await parseJsonBody(request);
  if (!body || typeof body !== 'object' || !body.envelope) {
    return jsonRes({ error: 'Body must be { envelope: { ... } }' }, 400);
  }
  try {
    const result = await createSharedTweakData(env, account, body.envelope);
    return jsonRes(result);
  } catch (err) {
    return tweakErrorToResponse(err);
  }
}
```

- [ ] **Step 5: Register the route in `handleTweaksRoute`**

In the `switch (pathname)` block (currently `tweaks-handler.js:900`), add a case after `'/admin/tweaks/audit'`:

```js
    case '/admin/tweaks/share':
      return handleShareTweak(request, env);
```

- [ ] **Step 6: Run the test — `handleSharedTweakRoute` still missing, expect partial pass**

Run: `cd server/mcp-server && node --test src/tweaks-share.test.js`
Expected: the `generateShareCode`/`sanitizeShareEnvelope`/`create`/`get` tests PASS; the `handleSharedTweakRoute returns null` test still FAILS (not exported yet — added in Task 3).

- [ ] **Step 7: Commit**

```bash
git add server/mcp-server/src/tweaks-handler.js server/mcp-server/src/tweaks-share.test.js
git commit -m "feat(server): share-create data layer + /admin/tweaks/share endpoint"
```

---

### Task 3: Public resolve route (`/shared/<code>` JSON) + landing (`/s/<code>` HTML)

**Files:**
- Modify: `server/mcp-server/src/tweaks-handler.js`
- Test: `server/mcp-server/src/tweaks-share.test.js` (already covers the null-path case; we extend it)

- [ ] **Step 1: Add the landing HTML renderer + public route handler**

Append to the bottom of `tweaks-handler.js` (after `handleTweaksRoute`):

```js
// ─── Public share resolve + landing (no auth) ──────────────────────

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
  ));
}

/**
 * Branded landing page for /s/<code>. Server-rendered (no client fetch) so
 * it works for viewers without the extension. The "Open in JobTread" button
 * deep-links into the app with ?jtpt_share=<code>; the content-script
 * auto-loader takes it from there.
 */
function renderShareLandingHtml(code, envelope) {
  const name = escapeHtml(envelope.name || 'Shared tweak');
  const desc = envelope.description ? `<p class="desc">${escapeHtml(envelope.description)}</p>` : '';
  const css = envelope.css
    ? `<pre class="css">${escapeHtml(envelope.css.slice(0, 4000))}</pre>`
    : '<p class="muted">No CSS — this tweak uses DOM actions only.</p>';
  const deepLink = SHARE_JOBTREAD_DEEPLINK + encodeURIComponent(code);
  return `<!DOCTYPE html>
<html lang="en"><head>
<meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>${name} — Shared JT Power Tools tweak</title>
<style>
  :root { color-scheme: light dark; }
  body { margin:0; font:16px/1.5 -apple-system,Segoe UI,Roboto,sans-serif;
         background:#1b1a18; color:#ece8e1; }
  .wrap { max-width:680px; margin:0 auto; padding:40px 20px; }
  .badge { display:inline-block; font-size:12px; letter-spacing:.08em; text-transform:uppercase;
           color:#ff6b35; border:1px solid #ff6b35; border-radius:999px; padding:3px 10px; }
  h1 { font-size:28px; margin:16px 0 8px; }
  .desc { color:#c9c3b8; }
  .muted { color:#8d877c; }
  pre.css { background:#12110f; border:1px solid #3a3733; border-radius:8px; padding:14px;
            overflow:auto; font:13px/1.5 ui-monospace,Menlo,Consolas,monospace; color:#d7d0c4; }
  .cta { display:inline-block; margin:20px 0 8px; background:#ff6b35; color:#1b1a18;
         font-weight:600; text-decoration:none; padding:12px 22px; border-radius:8px; }
  .install { font-size:14px; color:#8d877c; }
  .install a { color:#ff6b35; }
</style></head>
<body><div class="wrap">
  <span class="badge">JT Power Tools · Shared tweak</span>
  <h1>${name}</h1>
  ${desc}
  <a class="cta" href="${deepLink}">Open in JobTread →</a>
  <p class="install">Don't have the extension yet?
    <a href="${SHARE_INSTALL_URL}" target="_blank" rel="noopener">Install JT Power Tools</a>,
    then open this link again. Tweaks require the Pro tier to apply.</p>
  <h2 style="font-size:16px;margin-top:28px;">What it does</h2>
  ${css}
</div></body></html>`;
}

/**
 * Public, unauthenticated. Matches:
 *   GET /shared/<code>  → JSON { envelope }  (CORS *, consumed by the content-script auto-loader)
 *   GET /s/<code>       → branded landing HTML
 * Returns a Response if matched, else null so the caller can fall through.
 */
export async function handleSharedTweakRoute(request, env, pathname) {
  const jsonMatch = pathname.match(/^\/shared\/([23456789A-Z]{6,12})$/);
  if (jsonMatch) {
    try {
      const { envelope } = await getSharedTweakData(env, jsonMatch[1]);
      return new Response(JSON.stringify({ ok: true, envelope }), {
        status: 200,
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*',
          'Cache-Control': 'public, max-age=300',
        },
      });
    } catch (err) {
      const status = err instanceof TweakError ? err.status : 500;
      return new Response(JSON.stringify({ ok: false, error: err.message || 'error' }), {
        status,
        headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
      });
    }
  }

  const landingMatch = pathname.match(/^\/s\/([23456789A-Z]{6,12})$/);
  if (landingMatch) {
    try {
      const { envelope } = await getSharedTweakData(env, landingMatch[1]);
      return new Response(renderShareLandingHtml(landingMatch[1], envelope), {
        status: 200,
        headers: { 'Content-Type': 'text/html; charset=utf-8' },
      });
    } catch (_err) {
      return new Response(
        '<!DOCTYPE html><meta charset="UTF-8"><title>Not found</title>' +
        '<body style="font:16px sans-serif;max-width:600px;margin:60px auto;padding:0 20px">' +
        '<h1>Shared tweak not found</h1><p>This link may be mistyped or expired.</p></body>',
        { status: 404, headers: { 'Content-Type': 'text/html; charset=utf-8' } }
      );
    }
  }

  return null;
}
```

- [ ] **Step 2: Run the test to verify all pass**

Run: `cd server/mcp-server && node --test src/tweaks-share.test.js`
Expected: PASS (all 6 tests, including `handleSharedTweakRoute returns null for non-share paths`).

- [ ] **Step 3: Run the full server suite to confirm no regressions**

Run: `cd server/mcp-server && npm test`
Expected: PASS (existing suites unaffected; the new file passes).

- [ ] **Step 4: Commit**

```bash
git add server/mcp-server/src/tweaks-handler.js server/mcp-server/src/tweaks-share.test.js
git commit -m "feat(server): public /shared/<code> JSON + /s/<code> landing for tweak sharing"
```

---

### Task 4: Dispatch the public routes in `index.js`

**Files:**
- Modify: `server/mcp-server/src/index.js` (insert in the `fetch` handler, after the `/capture/queries` interceptor at line ~360, before the `.well-known` rewrites)

- [ ] **Step 1: Add the dispatch block**

In `index.js`, immediately **after** the `if (reqUrl.pathname === '/capture/queries') { … }` block (currently ends at line 360), insert:

```js
    // Public tweak-share routes — no OAuth/Bearer auth (the code is the
    // handle). Must run BEFORE oauthProvider.fetch so unauthenticated
    // recipients (and the app.jobtread.com content-script auto-loader) can
    // resolve a code. /shared/<code> → JSON envelope; /s/<code> → landing.
    if (reqUrl.pathname.startsWith('/shared/') || reqUrl.pathname.startsWith('/s/')) {
      const { handleSharedTweakRoute } = await import('./tweaks-handler.js');
      const shareResponse = await handleSharedTweakRoute(request, env, reqUrl.pathname);
      if (shareResponse) return withSecurityHeaders(shareResponse, request, env);
    }
```

- [ ] **Step 2: Confirm the module imports cleanly (no syntax errors)**

Run: `cd server/mcp-server && node --check src/index.js && node --check src/tweaks-handler.js`
Expected: no output, exit 0.

- [ ] **Step 3: Commit**

```bash
git add server/mcp-server/src/index.js
git commit -m "feat(server): route /shared and /s tweak-share paths before OAuth dispatch"
```

---

### Task 5: Apply migration + deploy + smoke-test (manual)

**Files:** none (operational)

- [ ] **Step 1: Apply the migration to the remote D1**

Run: `cd server/mcp-server && npx wrangler d1 migrations apply DB --remote`
Expected: reports `032_shared_tweaks.sql` applied. (If the binding name in `wrangler.toml`/`wrangler.jsonc` differs, use that name; the D1 UUID is `576bc461-59fc-42de-85fd-3397be8b8df9`.)

- [ ] **Step 2: Deploy the worker**

Run: `cd server/mcp-server && npx wrangler deploy`
Expected: deploy succeeds; prints the worker URL.

- [ ] **Step 3: Smoke-test create (needs a portal JWT) — defer to Task 12 end-to-end if no token handy**

The authed `POST /admin/tweaks/share` is exercised live in Task 12 via the extension. For an immediate server check, confirm a bad code 404s without auth:

Run: `curl -s -o /dev/null -w "%{http_code}\n" https://jobtread-mcp-server.king0light-ai.workers.dev/shared/NOPECODE`
Expected: `404`

Run: `curl -s -o /dev/null -w "%{http_code}\n" https://app.jtpowertools.com/s/NOPECODE`
Expected: `404`

- [ ] **Step 4: No commit (operational task).**

---

## Phase B — Extension: Share (export) UI

### Task 6: Add `TweaksApi.share()`

**Files:**
- Modify: `JT-Tools-Master/services/tweaks-api.js`

- [ ] **Step 1: Add the `share` function**

In `tweaks-api.js`, after the `reportDiagnostics` function (ends at line 177) and before `isAvailable`, add:

```js
  /**
   * Share a stripped tweak envelope (the output of TweakPort.exportTweak).
   * Server stores it under a short code. Returns { ok, code, url }.
   * Same auth as create — the active-license requirement is the "licensed
   * tweak user" gate.
   */
  async function share(envelope) {
    if (!envelope || typeof envelope !== 'object') {
      throw new Error('share envelope object is required');
    }
    log('share', { name: envelope.name });
    return postJson('/admin/tweaks/share', { envelope });
  }
```

- [ ] **Step 2: Export it**

In the returned object (currently `tweaks-api.js:188-196`), add `share,` to the list:

```js
  return {
    list,
    create,
    update,
    remove,
    setState,
    reportDiagnostics,
    share,
    isAvailable
  };
```

- [ ] **Step 3: Sanity-check the file parses**

Run: `node --check JT-Tools-Master/services/tweaks-api.js`
Expected: no output, exit 0.

- [ ] **Step 4: Commit**

```bash
git add JT-Tools-Master/services/tweaks-api.js
git commit -m "feat: add TweaksApi.share() wrapper for tweak sharing"
```

---

### Task 7: Load `port.js` in the popup and the editor

**Files:**
- Modify: `JT-Tools-Master/popup/popup.html`
- Modify: `JT-Tools-Master/tweaks/edit.html`

`TweakPort` (window global) is only in the JobTread content-script list today. The popup Share button and editor Share button both call `window.TweakPort.exportTweak`, so the script must load in both pages. `port.js` is a dependency-free IIFE (`importTweak` optionally uses `window.TweakValidator`, which both pages already load).

- [ ] **Step 1: Add `port.js` to the popup**

In `popup/popup.html`, after the tweak-engine storage script (currently line 1055):

```html
  <script src="../features/tweak-engine/storage.js"></script>
  <script src="../features/tweak-engine/port.js"></script>
```

- [ ] **Step 2: Add `port.js` to the editor**

In `tweaks/edit.html`, after the storage script (currently line 72) and before `edit.js`:

```html
  <script src="../features/tweak-engine/storage.js"></script>
  <script src="../features/tweak-engine/port.js"></script>
  <script src="edit.js"></script>
```

- [ ] **Step 3: Commit**

```bash
git add JT-Tools-Master/popup/popup.html JT-Tools-Master/tweaks/edit.html
git commit -m "chore: load TweakPort in popup + editor for share UI"
```

---

### Task 8: Editor Share button

**Files:**
- Modify: `JT-Tools-Master/tweaks/edit.html` (header actions)
- Modify: `JT-Tools-Master/tweaks/edit.js`

- [ ] **Step 1: Add the button to the header**

In `tweaks/edit.html`, inside `.jt-tweak-edit-actions` (currently lines 11-15), add a Share button before Test:

```html
  <div class="jt-tweak-edit-actions">
    <button id="btn-share" class="jt-tweak-edit-btn jt-tweak-edit-btn-secondary" title="Create a shareable link for this tweak">Share</button>
    <button id="btn-test" class="jt-tweak-edit-btn">Test on active JT tab</button>
    <button id="btn-revert" class="jt-tweak-edit-btn jt-tweak-edit-btn-secondary">Revert</button>
    <button id="btn-save" class="jt-tweak-edit-btn jt-tweak-edit-btn-primary">Save</button>
  </div>
```

- [ ] **Step 2: Wire it in `edit.js`**

In `edit.js`, add a `$btnShare` reference near the other button refs (after line 25):

```js
  const $btnRevert = document.getElementById('btn-revert');
  const $btnShare = document.getElementById('btn-share');
```

In the `init()` event-wiring block (after `$btnRevert.addEventListener('click', revert);`, line 94):

```js
    $btnRevert.addEventListener('click', revert);
    $btnShare.addEventListener('click', shareTweak);
```

Add the `shareTweak` function after `revert()` (line 370):

```js
  /**
   * Strip the current tweak to a shareable envelope and create a short
   * link via the server. Copies the link to the clipboard and shows it in
   * the status line. Requires login (server enforces the active-license gate).
   */
  async function shareTweak() {
    const tweak = validateAndRender();
    if (!tweak) { setStatus('Fix validation errors before sharing.', 'error'); return; }
    if (!window.TweakPort) { setStatus('Share unavailable (TweakPort not loaded).', 'error'); return; }
    if (!window.TweaksApi || !window.TweaksApi.isAvailable()) {
      setStatus('Log in to JT Power Tools to share a tweak.', 'error');
      return;
    }
    setStatus('Creating share link…', '');
    try {
      const envelope = window.TweakPort.exportTweak(tweak);
      const result = await window.TweaksApi.share(envelope);
      if (!result || !result.url) throw new Error('No URL returned');
      try { await navigator.clipboard.writeText(result.url); } catch (_e) { /* clipboard may be blocked */ }
      setStatus('Share link copied: ' + result.url, 'ok');
    } catch (err) {
      setStatus('Share failed: ' + (err && err.message ? err.message : String(err)), 'error');
    }
  }
```

- [ ] **Step 3: Sanity-check the file parses**

Run: `node --check JT-Tools-Master/tweaks/edit.js`
Expected: no output, exit 0.

- [ ] **Step 4: Commit**

```bash
git add JT-Tools-Master/tweaks/edit.html JT-Tools-Master/tweaks/edit.js
git commit -m "feat: Share button in the tweak editor"
```

---

### Task 9: Popup per-tweak Share button + result dialog

**Files:**
- Modify: `JT-Tools-Master/popup/popup.html` (add a share result dialog)
- Modify: `JT-Tools-Master/popup/popup.js` (Share button in each card + handler)

- [ ] **Step 1: Add a share result dialog to `popup.html`**

After the import dialog (`popup.html:1037`, the closing `</dialog>` of `data-import-dialog`), add:

```html
  <dialog class="jt-tweaks-import-dialog" data-share-dialog>
    <h3>Share this tweak</h3>
    <p>Anyone with this link can import a copy into their own JobTread org. Org-specific data is stripped.</p>
    <input type="text" data-share-url readonly class="jt-tweaks-share-url" style="width:100%;box-sizing:border-box;font:13px ui-monospace,Menlo,Consolas,monospace;padding:8px;">
    <div class="jt-tweaks-import-actions">
      <button data-action="share-close">Close</button>
      <button data-action="share-copy" class="jt-tweaks-action-primary">Copy link</button>
    </div>
  </dialog>
```

- [ ] **Step 2: Add the Share button to each tweak card in `popup.js`**

In the card-actions block, immediately **after** the `editBtn` is appended (currently `popup.js:4083`, inside the `if (canMutate)` block — but Share should be available regardless of role, so place it just before the `if (canMutate)` block at line 4074). Insert:

```js
        // Share is available to anyone who can see the tweak — export strips
        // all org/person data, so even a member viewing an org_required tweak
        // can share a portable copy.
        const shareBtn = document.createElement('button');
        shareBtn.className = 'icon-btn';
        shareBtn.textContent = 'Share';
        shareBtn.title = 'Create a shareable link for this tweak';
        shareBtn.addEventListener('click', () => shareTweak(tweak));
        actions.appendChild(shareBtn);

        // Edit + Delete are gated on role for org_required tweaks. A
```

(The trailing comment line replaces the existing `// Edit + Delete are gated…` comment at line 4071-4073 — keep just one copy of it.)

- [ ] **Step 3: Add the `shareTweak` handler + dialog wiring in `popup.js`**

Add the handler next to `openEditor` (after `popup.js:4165`):

```js
    async function shareTweak(tweak) {
      if (!window.TweakPort) { showStatus('Share unavailable on this page', 'error'); return; }
      if (!window.TweaksApi || !window.TweaksApi.isAvailable()) {
        showStatus('Log in to share a tweak', 'error');
        return;
      }
      try {
        const envelope = window.TweakPort.exportTweak(tweak);
        const result = await window.TweaksApi.share(envelope);
        if (!result || !result.url) throw new Error('No URL returned');
        const $shareDialog = document.querySelector('[data-share-dialog]');
        const $shareUrl = $shareDialog ? $shareDialog.querySelector('[data-share-url]') : null;
        if ($shareUrl) $shareUrl.value = result.url;
        try { await navigator.clipboard.writeText(result.url); } catch (_e) { /* ignore */ }
        if ($shareDialog && $shareDialog.showModal) {
          $shareDialog.showModal();
        } else {
          showStatus('Share link copied', 'success');
        }
      } catch (err) {
        showStatus('Share failed: ' + (err && err.message ? err.message : 'error'), 'error');
      }
    }
```

Wire the dialog buttons once, alongside the existing import-dialog wiring (after `popup.js:4176`, `$installBtn.addEventListener('click', doInstall);`):

```js
    const $shareDialog = document.querySelector('[data-share-dialog]');
    if ($shareDialog) {
      const $shareClose = $shareDialog.querySelector('[data-action="share-close"]');
      const $shareCopy = $shareDialog.querySelector('[data-action="share-copy"]');
      const $shareUrl = $shareDialog.querySelector('[data-share-url]');
      if ($shareClose) $shareClose.addEventListener('click', () => $shareDialog.close());
      if ($shareCopy) $shareCopy.addEventListener('click', async () => {
        if ($shareUrl) {
          $shareUrl.select();
          try { await navigator.clipboard.writeText($shareUrl.value); } catch (_e) { /* ignore */ }
        }
        $shareCopy.textContent = 'Copied!';
        setTimeout(() => { $shareCopy.textContent = 'Copy link'; }, 1500);
      });
    }
```

- [ ] **Step 4: Sanity-check the file parses**

Run: `node --check JT-Tools-Master/popup/popup.js`
Expected: no output, exit 0.

- [ ] **Step 5: Commit**

```bash
git add JT-Tools-Master/popup/popup.html JT-Tools-Master/popup/popup.js
git commit -m "feat: Share button + link dialog in the popup tweak list"
```

---

## Phase C — Extension: Auto-load (import) on JobTread

### Task 10: Share-loader content script

**Files:**
- Create: `JT-Tools-Master/features/tweak-engine/share-loader.js`
- Modify: `JT-Tools-Master/manifest.json` (register the script)
- Test: `JT-Tools-Master/../tests/features/tweak-share-loader.test.js` (i.e. repo `tests/features/tweak-share-loader.test.js`)

- [ ] **Step 1: Write the failing unit test for the loader's pure helpers**

Create `tests/features/tweak-share-loader.test.js`:

```js
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';

// Load share-loader.js in a sandbox that captures its exported test hooks.
function loadModule() {
  const file = path.resolve(__dirname, '../../JT-Tools-Master/features/tweak-engine/share-loader.js');
  const code = fs.readFileSync(file, 'utf8');
  const sandbox = { window: {}, document: { addEventListener() {} }, location: { search: '' }, history: {}, console };
  sandbox.globalThis = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(code, sandbox);
  return sandbox.window.TweakShareLoader;
}

describe('TweakShareLoader helpers', () => {
  it('parses a valid jtpt_share code from a query string', () => {
    const m = loadModule();
    expect(m._test.parseShareCode('?jtpt_share=AB23CD99')).toBe('AB23CD99');
    expect(m._test.parseShareCode('?foo=1&jtpt_share=MNPQ2345&x=2')).toBe('MNPQ2345');
  });

  it('returns null when no code is present or the code is malformed', () => {
    const m = loadModule();
    expect(m._test.parseShareCode('')).toBe(null);
    expect(m._test.parseShareCode('?jtpt_share=')).toBe(null);
    expect(m._test.parseShareCode('?jtpt_share=has spaces')).toBe(null);
    expect(m._test.parseShareCode('?jtpt_share=toolongtoolongtoolong')).toBe(null);
  });

  it('builds the resolve URL on the host_permissions worker domain', () => {
    const m = loadModule();
    expect(m._test.resolveUrl('AB23CD99')).toBe(
      'https://jobtread-mcp-server.king0light-ai.workers.dev/shared/AB23CD99'
    );
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run tests/features/tweak-share-loader.test.js`
Expected: FAIL — module file does not exist yet.

- [ ] **Step 3: Write `share-loader.js`**

Create `JT-Tools-Master/features/tweak-engine/share-loader.js`:

```js
/**
 * Tweak Share Loader
 *
 * Runs on app.jobtread.com. When a page loads with ?jtpt_share=<code> (from a
 * shared link / the /s/<code> landing's "Open in JobTread" button), it:
 *   1. fetches the stripped envelope from the public /shared/<code> endpoint,
 *   2. re-validates + re-scopes it to the active org via TweakPort.importTweak,
 *   3. shows a confirm dialog with a name/description/CSS preview,
 *   4. on confirm, saves it server-first (TweaksApi.create) + local cache.
 *
 * Importing is allowed for any logged-in user (the recipient gets a personal
 * copy). Applying still requires the Pro Tweaks engine — if it isn't active,
 * the dialog says so. Loads AFTER tweak-engine/index.js (needs TweakEngine,
 * TweakPort, TweaksApi, TweakStorage, OrgDetector — all earlier in the list).
 */
const TweakShareLoader = (() => {
  const RESOLVE_BASE = 'https://jobtread-mcp-server.king0light-ai.workers.dev/shared/';
  const CODE_RE = /^[23456789A-Z]{6,12}$/;

  function parseShareCode(search) {
    try {
      const params = new URLSearchParams(search || '');
      const code = (params.get('jtpt_share') || '').trim();
      return CODE_RE.test(code) ? code : null;
    } catch (_e) {
      return null;
    }
  }

  function resolveUrl(code) {
    return RESOLVE_BASE + encodeURIComponent(code);
  }

  /** Remove the param so a reload doesn't re-prompt. */
  function stripParamFromUrl() {
    try {
      const url = new URL(location.href);
      url.searchParams.delete('jtpt_share');
      history.replaceState(null, '', url.toString());
    } catch (_e) { /* ignore */ }
  }

  async function waitForActiveOrg(maxMs = 4000) {
    const start = Date.now();
    while (Date.now() - start < maxMs) {
      const org = window.OrgDetector ? window.OrgDetector.getActiveOrg() : null;
      if (org) return org;
      await new Promise((r) => setTimeout(r, 200));
    }
    return null;
  }

  function engineActive() {
    try {
      return !!(window.TweakEngine && typeof window.TweakEngine.isActive === 'function' && window.TweakEngine.isActive());
    } catch (_e) {
      return false;
    }
  }

  async function run() {
    const code = parseShareCode(location.search);
    if (!code) return;
    stripParamFromUrl();

    if (!window.TweakPort) { console.warn('TweakShareLoader: TweakPort not loaded'); return; }

    let envelope;
    try {
      const res = await fetch(resolveUrl(code), { method: 'GET' });
      const data = await res.json();
      if (!res.ok || !data || !data.ok || !data.envelope) {
        showError((data && data.error) || 'This shared tweak could not be found.');
        return;
      }
      envelope = data.envelope;
    } catch (err) {
      showError('Could not load the shared tweak: ' + (err && err.message ? err.message : 'network error'));
      return;
    }

    const activeOrg = await waitForActiveOrg();
    if (!activeOrg) {
      showError('Open a JobTread org first, then re-open the share link.');
      return;
    }

    const result = window.TweakPort.importTweak(envelope, { activeOrg });
    if (!result.ok) {
      showError('Shared tweak is invalid: ' + (result.errors && result.errors[0] ? result.errors[0].reason : 'unknown'));
      return;
    }

    showConfirm(result.tweak);
  }

  // ─── Minimal self-contained modal (neutral dark greys) ────────────

  function el(tag, props, ...kids) {
    const node = document.createElement(tag);
    if (props) Object.assign(node, props);
    for (const k of kids) node.appendChild(typeof k === 'string' ? document.createTextNode(k) : k);
    return node;
  }

  function overlay() {
    const o = el('div');
    o.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.5);z-index:2147483646;display:flex;align-items:center;justify-content:center;';
    return o;
  }

  function panel() {
    const p = el('div');
    p.style.cssText = 'background:#2c2c2c;color:#e0e0e0;border:1px solid #404040;border-radius:10px;max-width:520px;width:90%;max-height:80vh;overflow:auto;padding:20px;font:14px/1.5 -apple-system,Segoe UI,Roboto,sans-serif;box-shadow:0 12px 40px rgba(0,0,0,.5);';
    return p;
  }

  function showError(msg) {
    const o = overlay();
    const p = panel();
    p.appendChild(el('h3', { style: 'margin:0 0 8px;font-size:16px;' }, 'Shared tweak'));
    p.appendChild(el('p', { style: 'color:#b0b0b0;margin:0 0 16px;' }, msg));
    const close = el('button', { textContent: 'Close' });
    close.style.cssText = 'background:#333;border:1px solid #505050;color:#e0e0e0;border-radius:6px;padding:8px 16px;cursor:pointer;';
    close.addEventListener('click', () => o.remove());
    p.appendChild(close);
    o.appendChild(p);
    o.addEventListener('click', (e) => { if (e.target === o) o.remove(); });
    document.body.appendChild(o);
  }

  function showConfirm(tweak) {
    const o = overlay();
    const p = panel();
    p.appendChild(el('h3', { style: 'margin:0 0 4px;font-size:16px;' }, 'Import shared tweak?'));
    p.appendChild(el('p', { style: 'font-weight:600;margin:0 0 4px;' }, tweak.name || '(unnamed)'));
    if (tweak.description) {
      p.appendChild(el('p', { style: 'color:#b0b0b0;margin:0 0 12px;' }, tweak.description));
    }
    if (tweak.css) {
      const pre = el('pre', { textContent: tweak.css.slice(0, 2000) });
      pre.style.cssText = 'background:#1f1f1f;border:1px solid #404040;border-radius:6px;padding:10px;overflow:auto;font:12px/1.5 ui-monospace,Menlo,Consolas,monospace;color:#d0d0d0;margin:0 0 12px;';
      p.appendChild(pre);
    } else {
      p.appendChild(el('p', { style: 'color:#a0a0a0;margin:0 0 12px;' }, 'No CSS — DOM actions only.'));
    }
    if (!engineActive()) {
      p.appendChild(el('p', { style: 'color:#e0a060;margin:0 0 12px;font-size:13px;' },
        'Note: enable the Tweaks engine (Pro) in JT Power Tools to see this applied.'));
    }

    const row = el('div');
    row.style.cssText = 'display:flex;gap:8px;justify-content:flex-end;';
    const cancel = el('button', { textContent: 'Cancel' });
    cancel.style.cssText = 'background:#333;border:1px solid #505050;color:#e0e0e0;border-radius:6px;padding:8px 16px;cursor:pointer;';
    const importBtn = el('button', { textContent: 'Import' });
    importBtn.style.cssText = 'background:#ff6b35;border:1px solid #ff6b35;color:#1b1a18;font-weight:600;border-radius:6px;padding:8px 16px;cursor:pointer;';
    cancel.addEventListener('click', () => o.remove());
    importBtn.addEventListener('click', async () => {
      importBtn.disabled = true;
      importBtn.textContent = 'Importing…';
      try {
        await doImport(tweak);
        o.remove();
        showError('Imported "' + (tweak.name || 'tweak') + '". Find it in JT Power Tools → Tweaks.');
      } catch (err) {
        importBtn.disabled = false;
        importBtn.textContent = 'Import';
        const note = el('p', { style: 'color:#e06060;margin:12px 0 0;font-size:13px;' },
          'Import failed: ' + (err && err.message ? err.message : 'error'));
        p.appendChild(note);
      }
    });
    row.appendChild(cancel);
    row.appendChild(importBtn);
    p.appendChild(row);
    o.appendChild(p);
    o.addEventListener('click', (e) => { if (e.target === o) o.remove(); });
    document.body.appendChild(o);
  }

  /** Server-first create (mirrors edit.js save), then local cache upsert. */
  async function doImport(tweak) {
    let canonical = tweak;
    if (window.TweaksApi && window.TweaksApi.isAvailable()) {
      const result = await window.TweaksApi.create(tweak);
      if (result && result.tweak) canonical = result.tweak;
    }
    await window.TweakStorage.upsert(canonical);
  }

  // Run once at load. document_end means the DOM is ready.
  run();

  return { _test: { parseShareCode, resolveUrl } };
})();

if (typeof window !== 'undefined') window.TweakShareLoader = TweakShareLoader;
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run tests/features/tweak-share-loader.test.js`
Expected: PASS (3 tests).

- [ ] **Step 5: Register the script in `manifest.json`**

In `manifest.json`, in the first content-script `js` array, add the loader **after** `features/tweak-engine/index.js` (line 128) and **before** `content.js` (line 129):

```json
        "features/tweak-engine/index.js",
        "features/tweak-engine/share-loader.js",
        "content.js"
```

- [ ] **Step 6: Validate manifest JSON**

Run: `node -e "JSON.parse(require('fs').readFileSync('JT-Tools-Master/manifest.json','utf8')); console.log('manifest ok')"`
Expected: prints `manifest ok`

- [ ] **Step 7: Commit**

```bash
git add JT-Tools-Master/features/tweak-engine/share-loader.js JT-Tools-Master/manifest.json tests/features/tweak-share-loader.test.js
git commit -m "feat: auto-load shared tweaks on JobTread with confirm-and-preview"
```

---

## Phase D — Finish: docs, lint, eval, end-to-end verify

### Task 11: CHANGELOG + lint + eval

**Files:**
- Modify: `CHANGELOG.md`

- [ ] **Step 1: Add a CHANGELOG entry under `[Unreleased]`**

Add (create `### Added` under `## [Unreleased]` if absent):

```markdown
### Added
- **Tweak Sharing** — share any tweak as a short link (`app.jtpowertools.com/s/<code>`)
  - "Share" button on each tweak in the popup list and in the tweak editor; copies a link with all org/personal data stripped
  - Opening a share link on JobTread auto-prompts an import with a name/CSS preview before anything is saved
  - Branded landing page previews the tweak and offers an install prompt for viewers without the extension
```

- [ ] **Step 2: Run lint**

Run: `npm run lint`
Expected: PASS (no errors in the changed files). Fix any reported issues in the files this plan touched, then re-run.

- [ ] **Step 3: Run the extension unit suite**

Run: `npx vitest run`
Expected: PASS, including `tests/features/tweak-share-loader.test.js`.

- [ ] **Step 4: Run the eval gate**

Run: `npm run eval`
Expected: PASS (no regression in the score gate).

- [ ] **Step 5: Commit**

```bash
git add CHANGELOG.md
git commit -m "docs: changelog for Tweak Sharing"
```

---

### Task 12: End-to-end manual verification (load unpacked + live round-trip)

**Files:** none (verification). Use the `extension-test` or `chrome-devtools` MCP per CLAUDE.md's test loop. **Use the support@jtpowertools.com / JT Power Tools org account — never the Titus account.**

- [ ] **Step 1: Load the extension + log in**

- Load unpacked `JT-Tools-Master` (or `install_extension`), navigate to `https://app.jobtread.com`, log into JT Power Tools with the testing account, ensure the Tweaks engine (Pro) is enabled.
- Verify console has no errors and `window.TweakShareLoader` is defined on the JobTread tab.

- [ ] **Step 2: Create a share link (editor path)**

- Open the popup → Tweaks → create or pick a tweak → "Edit" → in the editor click **Share**.
- Expected: status shows "Share link copied: https://app.jtpowertools.com/s/XXXXXXXX" and the link is on the clipboard.

- [ ] **Step 3: Create a share link (popup path)**

- In the popup tweak list, click **Share** on a card.
- Expected: the share dialog opens showing the `app.jtpowertools.com/s/<code>` URL; "Copy link" copies it.

- [ ] **Step 4: View the landing page**

- Open the copied `…/s/<code>` URL in a normal tab.
- Expected: branded page shows the tweak name, description, CSS preview, an "Open in JobTread →" button, and an install prompt.

- [ ] **Step 5: Auto-load round-trip**

- Click "Open in JobTread →" (or navigate to `https://app.jobtread.com/?jtpt_share=<code>`).
- Expected: a confirm dialog appears with the name + CSS preview. Click **Import**.
- Expected: success notice; the tweak appears in the popup Tweaks list (personal scope), and the URL no longer contains `jtpt_share` after handling.

- [ ] **Step 6: Negative checks**

- Navigate to `https://app.jobtread.com/?jtpt_share=NOPECODE` → expect the "could not be found" dialog, no import.
- Confirm a free/non-Pro state shows the "enable the Tweaks engine (Pro)" note in the confirm dialog (toggle the engine off to simulate).

- [ ] **Step 7: Final commit (if any fixes were needed during verification)**

```bash
git add -A
git commit -m "fix: address Tweak Sharing issues found in end-to-end verification"
```

---

## Self-Review

**Spec coverage:**
- "Quick ability to share a stripped tweak" → Tasks 6–9 (TweaksApi.share + popup/editor Share buttons), built on the existing `TweakPort.exportTweak` strip. ✓
- "Auto load from shared tweaks" → Tasks 1–5 (server store + public resolve) + Task 10 (JobTread auto-loader with confirm-and-preview). ✓
- Branded landing page (chosen) → Task 3 `renderShareLandingHtml` + Task 4 dispatch. ✓
- Licensed-tweak-users-only create (chosen) → `handleShareTweak` uses `requireAccount` (active license), same gate as create. ✓
- Confirm-with-preview import (chosen) → Task 10 `showConfirm`. ✓
- Worktree build (chosen) → execution happens in the worktree created at handoff.

**Placeholder scan:** No TBD/TODO; every code step contains complete code; every command has expected output. ✓

**Type/name consistency:** `tweak-share-v1`, `jtpt_share`, `/shared/<code>`, `/s/<code>`, `app.jtpowertools.com/s/`, `generateShareCode`/`sanitizeShareEnvelope`/`createSharedTweakData`/`getSharedTweakData`/`handleShareTweak`/`handleSharedTweakRoute`/`renderShareLandingHtml`, `TweaksApi.share`, `TweakShareLoader._test.{parseShareCode,resolveUrl}` — used identically across server, extension, and tests. The resolve endpoint is on the `workers.dev` host (in `host_permissions`); the creator-facing URL is on `app.jtpowertools.com` — both served by the same worker. ✓

**Open follow-ups (out of scope, noted for later):** a "My shares" list + revoke; optional extension of the popup "Paste from AI" dialog to accept a share link/code directly; share-code expiry/TTL.
