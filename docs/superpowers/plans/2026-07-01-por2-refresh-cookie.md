# POR-2: Portal Refresh Token → httpOnly Cookie — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move the portal's refresh token out of `localStorage` into an `HttpOnly; Secure; SameSite=Strict` cookie set by the `jobtread-mcp-server` worker, so page-origin XSS cannot exfiltrate it — while leaving the extension's body-token flow byte-identical.

**Architecture:** Dual-mode auth endpoints (Approach A from the approved spec at `docs/superpowers/specs/2026-07-01-por2-refresh-cookie-design.md`). A new `portal-cookie.js` module owns cookie parse/build and portal-credentialed CORS; `portal-auth.js` handlers gain a cookie mode; `auth-handler.js` applies credentialed CORS centrally on `/auth/*`; the portal client switches its API base to `mcp.jtpowertools.com` and stops persisting refresh tokens (force re-login, with server-side revocation of legacy tokens).

**Tech Stack:** Cloudflare Workers (plain JS, ES modules), `node:test` harness in `server/mcp-server/`, static portal JS (no bundler).

**Working-tree caution:** The repo has an uncommitted WIP (print-scope feature) touching `JT-Tools-Master/**` and `CHANGELOG.md`. NEVER run `git add .` — every commit step lists exact files. For the CHANGELOG commit (Task 7) follow its special steps exactly.

**Run tests from `server/mcp-server/`** (`npm test` there runs the node harness). The repo-root `npm test` is the extension vitest suite — not needed here except as a final regression sweep.

---

### Task 1: `portal-cookie.js` — cookie + portal-CORS helpers

**Files:**
- Create: `server/mcp-server/src/portal-cookie.js`
- Test: `server/mcp-server/src/portal-cookie.test.js`

- [ ] **Step 1: Write the failing test**

Create `server/mcp-server/src/portal-cookie.test.js`:

```js
/**
 * Tests for portal-cookie.js — POR-2 httpOnly refresh-token cookie helpers.
 *
 * Runs standalone: node --test server/mcp-server/src/portal-cookie.test.js
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  REFRESH_COOKIE,
  PORTAL_ORIGIN,
  getRefreshCookie,
  buildSetCookie,
  buildClearCookie,
  applyPortalCors,
} from './portal-cookie.js';

function req(headers = {}) {
  return new Request('https://mcp.example/auth/refresh', { method: 'POST', headers });
}

test('getRefreshCookie parses the jt_refresh cookie', () => {
  assert.equal(getRefreshCookie(req({ Cookie: 'jt_refresh=tok123' })), 'tok123');
  assert.equal(
    getRefreshCookie(req({ Cookie: 'a=1; jt_refresh=tok123; b=2' })),
    'tok123'
  );
});

test('getRefreshCookie returns null when absent or empty', () => {
  assert.equal(getRefreshCookie(req()), null);
  assert.equal(getRefreshCookie(req({ Cookie: 'other=1' })), null);
  assert.equal(getRefreshCookie(req({ Cookie: 'jt_refresh=' })), null);
});

test('getRefreshCookie does not match name prefixes/suffixes', () => {
  assert.equal(getRefreshCookie(req({ Cookie: 'xjt_refresh=evil' })), null);
  assert.equal(getRefreshCookie(req({ Cookie: 'jt_refresh_2=evil' })), null);
});

test('buildSetCookie emits all required attributes', () => {
  const c = buildSetCookie('tok123');
  assert.ok(c.startsWith(`${REFRESH_COOKIE}=tok123;`));
  for (const attr of ['HttpOnly', 'Secure', 'SameSite=Strict', 'Path=/auth', `Max-Age=${90 * 24 * 60 * 60}`]) {
    assert.ok(c.includes(attr), `missing ${attr} in: ${c}`);
  }
});

test('buildClearCookie expires the cookie immediately', () => {
  const c = buildClearCookie();
  assert.ok(c.startsWith(`${REFRESH_COOKIE}=;`));
  assert.ok(c.includes('Max-Age=0'));
  assert.ok(c.includes('Path=/auth'));
});

test('applyPortalCors echoes the portal origin and allows credentials', async () => {
  const original = new Response('{"ok":true}', {
    headers: { 'Access-Control-Allow-Origin': '*' },
  });
  const res = applyPortalCors(original, req({ Origin: PORTAL_ORIGIN }));
  assert.equal(res.headers.get('Access-Control-Allow-Origin'), PORTAL_ORIGIN);
  assert.equal(res.headers.get('Access-Control-Allow-Credentials'), 'true');
  assert.ok((res.headers.get('Vary') || '').includes('Origin'));
  assert.equal(await res.text(), '{"ok":true}'); // body preserved
});

test('applyPortalCors leaves non-portal origins untouched', () => {
  const original = new Response(null, {
    status: 204,
    headers: { 'Access-Control-Allow-Origin': '*' },
  });
  const res = applyPortalCors(original, req({ Origin: 'https://evil.example' }));
  assert.equal(res.headers.get('Access-Control-Allow-Origin'), '*');
  assert.equal(res.headers.get('Access-Control-Allow-Credentials'), null);
  const res2 = applyPortalCors(original, req()); // no Origin header (extension/worker fetch)
  assert.equal(res2.headers.get('Access-Control-Allow-Origin'), '*');
});
```

- [ ] **Step 2: Run test to verify it fails**

Run (from `server/mcp-server/`): `node --test src/portal-cookie.test.js`
Expected: FAIL — `Cannot find module './portal-cookie.js'`

- [ ] **Step 3: Write the implementation**

Create `server/mcp-server/src/portal-cookie.js`:

```js
/**
 * Portal refresh-token cookie helpers (POR-2).
 *
 * The portal keeps its refresh token in an httpOnly cookie on this worker's
 * host (mcp.jtpowertools.com) instead of localStorage, so page-origin XSS on
 * app.jtpowertools.com cannot exfiltrate it. The extension continues to send
 * refresh tokens in the request body — these helpers are portal-only and the
 * body flow must stay byte-identical.
 *
 * SameSite=Strict works because app.jtpowertools.com and mcp.jtpowertools.com
 * share the registrable domain (same-site, cross-origin). Path=/auth keeps
 * the cookie off every non-auth endpoint. pages.dev preview deployments are a
 * different site — the cookie intentionally does not flow there.
 */

export const REFRESH_COOKIE = 'jt_refresh';
// MUST mirror REFRESH_TOKEN_TTL in portal-auth.js (90 days).
const COOKIE_MAX_AGE = 90 * 24 * 60 * 60;
export const PORTAL_ORIGIN = 'https://app.jtpowertools.com';

/** Exact-name parse of the jt_refresh cookie. Returns null when absent/empty. */
export function getRefreshCookie(request) {
  const header = request.headers.get('Cookie') || '';
  for (const part of header.split(';')) {
    const eq = part.indexOf('=');
    if (eq === -1) continue;
    if (part.slice(0, eq).trim() === REFRESH_COOKIE) {
      return part.slice(eq + 1).trim() || null;
    }
  }
  return null;
}

export function buildSetCookie(token) {
  return `${REFRESH_COOKIE}=${token}; HttpOnly; Secure; SameSite=Strict; Path=/auth; Max-Age=${COOKIE_MAX_AGE}`;
}

export function buildClearCookie() {
  return `${REFRESH_COOKIE}=; HttpOnly; Secure; SameSite=Strict; Path=/auth; Max-Age=0`;
}

/**
 * Re-headers an /auth/* response for the portal origin: echoes the Origin and
 * allows credentials (browsers reject a credentialed fetch whose response
 * says `Access-Control-Allow-Origin: *`). Any other origin — including no
 * Origin at all — gets the response back unchanged (wildcard CORS, no
 * credentials: the extension path). Computed per-request; no module state.
 */
export function applyPortalCors(response, request) {
  const origin = request.headers.get('Origin');
  if (origin !== PORTAL_ORIGIN) return response;
  const res = new Response(response.body, response);
  res.headers.set('Access-Control-Allow-Origin', origin);
  res.headers.set('Access-Control-Allow-Credentials', 'true');
  res.headers.append('Vary', 'Origin');
  return res;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test src/portal-cookie.test.js`
Expected: PASS (7 tests)

- [ ] **Step 5: Commit**

```bash
git add server/mcp-server/src/portal-cookie.js server/mcp-server/src/portal-cookie.test.js
git commit -m "feat(server): portal refresh-cookie helpers (POR-2)"
```

---

### Task 2: `/auth/refresh` cookie mode

**Files:**
- Modify: `server/mcp-server/src/portal-auth.js` (imports ~line 20, `jsonRes` ~line 298, `buildRefreshSuccess` ~line 631, `handleRefresh` ~line 661)
- Test: `server/mcp-server/src/portal-auth-cookie.test.js` (create)

- [ ] **Step 1: Write the failing tests**

Create `server/mcp-server/src/portal-auth-cookie.test.js`. It reuses the mock-DB style of `portal-auth-grantkey.test.js` (same file, same session/account shapes):

```js
/**
 * Tests for POR-2 cookie-mode auth endpoints in portal-auth.js.
 *
 * Contract under test:
 *  - /auth/refresh with a jt_refresh cookie rotates the token INTO a
 *    Set-Cookie header and omits refreshToken from the JSON.
 *  - /auth/refresh with a body token (extension) behaves exactly as before.
 *  - a failed cookie-mode refresh clears the cookie.
 *  - /auth/logout with a cookie revokes the session and clears the cookie.
 *
 * Runs standalone: node --test server/mcp-server/src/portal-auth-cookie.test.js
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { handleRefresh, handleLogout } from './portal-auth.js';

function makeEnv({ sessionExists = true } = {}) {
  const calls = { deletes: 0 };
  const db = {
    prepare(sql) {
      return {
        bind() {
          return {
            async first() {
              if (sql.includes('FROM sessions WHERE refresh_token_hash')) {
                if (!sessionExists) return null;
                return {
                  id: 'sess-1',
                  account_id: 'acct-1',
                  expires_at: Math.floor(Date.now() / 1000) + 3600,
                };
              }
              if (sql.includes('FROM accounts a JOIN licenses l')) {
                return {
                  id: 'acct-1',
                  email: 'user@example.com',
                  display_name: 'Test User',
                  role: 'owner',
                  status: 'active',
                  tier: 'power_user',
                  org_id: 'org-1',
                  org_name: 'Test Org',
                  license_key: 'LIC-123',
                  grant_key_encrypted: null,
                };
              }
              return null;
            },
            async run() {
              if (sql.startsWith('DELETE FROM sessions')) calls.deletes++;
              return { success: true };
            },
          };
        },
      };
    },
  };
  return {
    env: {
      DB: db,
      JWT_SECRET: 'test-jwt-secret-that-is-long-enough-000',
      ENCRYPTION_KEY: 'k'.repeat(32),
    },
    calls,
  };
}

function cookieRequest(path, cookie) {
  return new Request(`https://mcp.example${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Cookie: cookie },
    body: '{}',
  });
}

function bodyRequest(path, body) {
  return new Request(`https://mcp.example${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

test('cookie-mode refresh sets a rotated cookie and omits refreshToken from JSON', async () => {
  const { env } = makeEnv();
  const res = await handleRefresh(cookieRequest('/auth/refresh', 'jt_refresh=live-token'), env);
  assert.equal(res.status, 200);
  const setCookie = res.headers.get('Set-Cookie');
  assert.ok(setCookie, 'expected a Set-Cookie header');
  assert.match(setCookie, /^jt_refresh=[0-9a-f]{64};/); // rotated 32-byte hex token
  assert.ok(!setCookie.includes('live-token'), 'must not re-issue the presented token');
  for (const attr of ['HttpOnly', 'Secure', 'SameSite=Strict', 'Path=/auth']) {
    assert.ok(setCookie.includes(attr), `missing ${attr}`);
  }
  const body = await res.json();
  assert.equal(body.refreshToken, undefined, 'cookie mode must not leak the token into JSON');
  assert.ok(body.accessToken, 'still returns an access token');
});

test('body-mode refresh (extension) still returns refreshToken in JSON, no cookie', async () => {
  const { env } = makeEnv();
  const res = await handleRefresh(bodyRequest('/auth/refresh', { refreshToken: 'live-token' }), env);
  assert.equal(res.status, 200);
  assert.equal(res.headers.get('Set-Cookie'), null);
  const body = await res.json();
  assert.match(body.refreshToken, /^[0-9a-f]{64}$/);
  assert.ok(body.accessToken);
});

test('refresh with neither cookie nor body token is a 400', async () => {
  const { env } = makeEnv();
  const res = await handleRefresh(bodyRequest('/auth/refresh', {}), env);
  assert.equal(res.status, 400);
});

test('failed cookie-mode refresh clears the cookie', async () => {
  const { env } = makeEnv({ sessionExists: false });
  const res = await handleRefresh(cookieRequest('/auth/refresh', 'jt_refresh=dead-token'), env);
  assert.equal(res.status, 401);
  const setCookie = res.headers.get('Set-Cookie');
  assert.ok(setCookie && setCookie.includes('Max-Age=0'), 'expected a clearing Set-Cookie');
});

test('cookie-mode logout revokes the session and clears the cookie', async () => {
  const { env, calls } = makeEnv();
  const res = await handleLogout(cookieRequest('/auth/logout', 'jt_refresh=live-token'), env);
  assert.equal(res.status, 200);
  assert.equal(calls.deletes, 1, 'session row must be deleted');
  const setCookie = res.headers.get('Set-Cookie');
  assert.ok(setCookie && setCookie.includes('Max-Age=0'));
});

test('body-mode logout (extension) unchanged: revokes session, no cookie header', async () => {
  const { env, calls } = makeEnv();
  const res = await handleLogout(bodyRequest('/auth/logout', { refreshToken: 'live-token' }), env);
  assert.equal(res.status, 200);
  assert.equal(calls.deletes, 1);
  assert.equal(res.headers.get('Set-Cookie'), null);
});
```

(The logout tests belong to Task 4's code — they will fail until Task 4 lands; that's expected. Run only the refresh tests to gate this task.)

- [ ] **Step 2: Run to verify the refresh tests fail**

Run: `node --test src/portal-auth-cookie.test.js`
Expected: the two cookie-mode refresh tests FAIL (no Set-Cookie header, refreshToken present in JSON); body-mode tests may already pass.

- [ ] **Step 3: Implement in `portal-auth.js`**

3a. Add the import at the top (next to the existing crypto import, ~line 20):

```js
import { readGrantKey } from './crypto.js';
import { getRefreshCookie, buildSetCookie, buildClearCookie } from './portal-cookie.js';
```

3b. Give `jsonRes` an optional extra-headers param (~line 298). Replace:

```js
function jsonRes(data, status = 200) {
  return new Response(JSON.stringify(data, null, 2), {
    status,
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    },
  });
}
```

with:

```js
function jsonRes(data, status = 200, extraHeaders = null) {
  const headers = {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  };
  if (extraHeaders) Object.assign(headers, extraHeaders);
  return new Response(JSON.stringify(data, null, 2), { status, headers });
}
```

3c. Teach `buildRefreshSuccess` cookie mode (~line 631). Change the signature and the return. The function currently ends with a `return jsonRes({ accessToken, refreshToken: refreshTokenToReturn, expiresIn, user: {...}, grantKey });` — restructure to:

```js
async function buildRefreshSuccess(env, accountId, refreshTokenToReturn, cookieMode = false) {
  // ... existing account lookup + access-token minting unchanged ...

  const payload = {
    accessToken,
    expiresIn: ACCESS_TOKEN_TTL,
    user: {
      id: account.id,
      email: account.email,
      displayName: account.display_name,
      role: account.role,
      tier,
      orgName: account.org_name,
      licenseKey: account.license_key,
    },
    grantKey: (await readGrantKey(account.grant_key_encrypted, env)) || null, // SRV-1: decrypt for the caller
  };
  // POR-2: portal (cookie mode) gets the rotated token in an httpOnly cookie,
  // never in JSON. Extension (body mode) keeps the JSON field.
  if (cookieMode) {
    return jsonRes(payload, 200, { 'Set-Cookie': buildSetCookie(refreshTokenToReturn) });
  }
  payload.refreshToken = refreshTokenToReturn;
  return jsonRes(payload);
}
```

(Only the return shape changes — keep the existing lookup/401/minting code above it exactly as is.)

3d. Make `handleRefresh` cookie-first (~line 661). Replace its opening:

```js
export async function handleRefresh(request, env) {
  if (request.method !== 'POST') return jsonRes({ error: 'Method not allowed' }, 405);

  const body = await parseJsonBody(request);
  if (!body?.refreshToken) {
    return jsonRes({ error: 'Refresh token is required' }, 400);
  }

  const nowSec = Math.floor(Date.now() / 1000);
  const tokenHash = await hashToken(body.refreshToken);
```

with:

```js
export async function handleRefresh(request, env) {
  if (request.method !== 'POST') return jsonRes({ error: 'Method not allowed' }, 405);

  // POR-2: the portal presents its refresh token in an httpOnly cookie; the
  // extension presents it in the body. Cookie wins when both are present.
  const cookieToken = getRefreshCookie(request);
  const body = cookieToken ? null : await parseJsonBody(request);
  const presentedToken = cookieToken || body?.refreshToken;
  const cookieMode = !!cookieToken;
  if (!presentedToken) {
    return jsonRes({ error: 'Refresh token is required' }, 400);
  }

  const nowSec = Math.floor(Date.now() / 1000);
  const tokenHash = await hashToken(presentedToken);
```

Then thread `cookieMode` through the two success paths and the failure path:

- normal path: `return buildRefreshSuccess(env, session.account_id, newToken, cookieMode);`
- grace path: `return buildRefreshSuccess(env, graceSession.account_id, newToken, cookieMode);`
- final failure: replace `return jsonRes({ error: 'Invalid or expired refresh token' }, 401);` with:

```js
  return jsonRes(
    { error: 'Invalid or expired refresh token' },
    401,
    cookieMode ? { 'Set-Cookie': buildClearCookie() } : null
  );
```

- [ ] **Step 4: Run to verify the refresh tests pass**

Run: `node --test src/portal-auth-cookie.test.js`
Expected: all four refresh tests PASS; the two logout tests still FAIL (Task 4).
Also run the whole suite to catch regressions: `npm test` → expected: 789+ pass (the pre-existing `portal-auth-grantkey.test.js` must still pass — it exercises body mode).

- [ ] **Step 5: Commit**

```bash
git add server/mcp-server/src/portal-auth.js server/mcp-server/src/portal-auth-cookie.test.js
git commit -m "feat(server): cookie-mode /auth/refresh (POR-2)"
```

---

### Task 3: cookie-mode login + register

**Files:**
- Modify: `server/mcp-server/src/portal-auth.js` (`handleLogin` return ~line 591, `handleRegister` return ~line 506)

- [ ] **Step 1: Write the failing test**

Login requires a PBKDF2 password hash, which the module doesn't export a builder for — so pin the contract at the cheapest reliable level: source assertions that the two return sites branch on `cookieMode`. Append to `portal-auth-cookie.test.js`:

```js
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

test('login and register returns branch on cookieMode (source contract)', async () => {
  const src = await readFile(
    fileURLToPath(new URL('./portal-auth.js', import.meta.url)),
    'utf8'
  );
  // Both handlers must consult body.cookieMode and build a Set-Cookie via
  // buildSetCookie. Crude but effective: this file has exactly two handlers
  // that mint a refresh token at login time.
  const cookieModeReads = src.match(/body\.cookieMode === true/g) || [];
  assert.ok(cookieModeReads.length >= 2, 'handleLogin AND handleRegister must read body.cookieMode');
  assert.ok(src.includes("'Set-Cookie': buildSetCookie(refreshToken)"), 'login/register must set the refresh cookie in cookie mode');
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `node --test src/portal-auth-cookie.test.js`
Expected: the new source-contract test FAILS.

- [ ] **Step 3: Implement**

3a. `handleLogin` (~line 589): replace the return

```js
  return jsonRes({
    accessToken,
    refreshToken,
    expiresIn: ACCESS_TOKEN_TTL,
    user: { ... },          // keep exactly as is
    grantKey: ...,          // keep exactly as is (readGrantKey)
    license: { ... },       // keep exactly as is
  });
```

with:

```js
  // POR-2: portal opts into cookie mode; the refresh token then travels only
  // in an httpOnly cookie. Extension requests (no cookieMode flag) keep the
  // JSON field — byte-identical to the old response.
  const cookieMode = body.cookieMode === true;
  const loginPayload = {
    accessToken,
    expiresIn: ACCESS_TOKEN_TTL,
    user: { ... },          // keep exactly as is
    grantKey: ...,          // keep exactly as is (readGrantKey)
    license: { ... },       // keep exactly as is
  };
  if (!cookieMode) loginPayload.refreshToken = refreshToken;
  return jsonRes(
    loginPayload,
    200,
    cookieMode ? { 'Set-Cookie': buildSetCookie(refreshToken) } : null
  );
```

(Note: JSON key order changes — `refreshToken` moves to last in body mode. No consumer indexes by position; `account-service.js` reads `data.refreshToken` by name.)

3b. `handleRegister` (~line 504): same transformation on its `return jsonRes({ accessToken, refreshToken, expiresIn, user: {...}, grantKey: ... }, 201);` — build the payload without `refreshToken`, read `const cookieMode = body.cookieMode === true;`, add `refreshToken` back when `!cookieMode`, and pass `cookieMode ? { 'Set-Cookie': buildSetCookie(refreshToken) } : null` as the third `jsonRes` arg with status `201`.

**Register wrinkle:** `handleRegister` has TWO account-creation flows (invite and first-user) but a single return at ~line 504 — verify with `grep -n "return jsonRes({" server/mcp-server/src/portal-auth.js` that only one register return mints tokens; apply the change there.

- [ ] **Step 4: Run tests**

Run: `node --test src/portal-auth-cookie.test.js` → source-contract test PASSES.
Run: `npm test` → full suite green.

- [ ] **Step 5: Commit**

```bash
git add server/mcp-server/src/portal-auth.js server/mcp-server/src/portal-auth-cookie.test.js
git commit -m "feat(server): cookie-mode /auth/login and /auth/register (POR-2)"
```

---

### Task 4: logout + logout-all clear the cookie

**Files:**
- Modify: `server/mcp-server/src/portal-auth.js` (`handleLogout` ~line 921, `handleLogoutAll` ~line 1003)

- [ ] **Step 1: The failing tests already exist** (the two logout tests from Task 2's test file).

Run: `node --test src/portal-auth-cookie.test.js`
Expected: the two logout tests FAIL.

- [ ] **Step 2: Implement `handleLogout`**

Replace the body of `handleLogout`:

```js
export async function handleLogout(request, env) {
  if (request.method !== 'POST') return jsonRes({ error: 'Method not allowed' }, 405);

  // POR-2: portal presents the refresh token via cookie, extension via body.
  const cookieToken = getRefreshCookie(request);
  const body = cookieToken ? null : await parseJsonBody(request);
  const presentedToken = cookieToken || body?.refreshToken;
  if (presentedToken) {
    const tokenHash = await hashToken(presentedToken);
    await env.DB.prepare('DELETE FROM sessions WHERE refresh_token_hash = ?')
      .bind(tokenHash).run();
  }

  return jsonRes(
    { message: 'Logged out' },
    200,
    cookieToken ? { 'Set-Cookie': buildClearCookie() } : null
  );
}
```

- [ ] **Step 3: Implement `handleLogoutAll`**

Replace its final `return jsonRes({ success: true });` with:

```js
  // POR-2: also drop the portal's refresh cookie if this call carried one
  // (harmless no-op for extension callers, which never send it).
  return jsonRes(
    { success: true },
    200,
    getRefreshCookie(request) ? { 'Set-Cookie': buildClearCookie() } : null
  );
```

- [ ] **Step 4: Run tests**

Run: `node --test src/portal-auth-cookie.test.js` → ALL tests PASS.
Run: `npm test` → full suite green.

- [ ] **Step 5: Commit**

```bash
git add server/mcp-server/src/portal-auth.js
git commit -m "feat(server): logout endpoints clear the refresh cookie (POR-2)"
```

---

### Task 5: credentialed CORS on `/auth/*` (auth-handler)

**Files:**
- Modify: `server/mcp-server/src/auth-handler.js` (imports ~line 43, OPTIONS branch ~line 50, `/auth/*` dispatch lines 55–90)
- Test: append to `server/mcp-server/src/portal-auth-cookie.test.js`

- [ ] **Step 1: Write the failing test**

Append:

```js
import { AuthHandler } from './auth-handler.js';

test('OPTIONS preflight on /auth/* echoes the portal origin with credentials', async () => {
  const res = await AuthHandler.fetch(
    new Request('https://mcp.example/auth/refresh', {
      method: 'OPTIONS',
      headers: { Origin: 'https://app.jtpowertools.com' },
    }),
    {},
    {}
  );
  assert.equal(res.status, 204);
  assert.equal(res.headers.get('Access-Control-Allow-Origin'), 'https://app.jtpowertools.com');
  assert.equal(res.headers.get('Access-Control-Allow-Credentials'), 'true');
});

test('OPTIONS preflight without portal origin keeps wildcard CORS', async () => {
  const res = await AuthHandler.fetch(
    new Request('https://mcp.example/auth/refresh', { method: 'OPTIONS' }),
    {},
    {}
  );
  assert.equal(res.headers.get('Access-Control-Allow-Origin'), '*');
  assert.equal(res.headers.get('Access-Control-Allow-Credentials'), null);
});

test('portal-origin /auth/refresh response carries credentialed CORS', async () => {
  const { env } = makeEnv();
  const req = new Request('https://mcp.example/auth/refresh', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Origin: 'https://app.jtpowertools.com',
      Cookie: 'jt_refresh=live-token',
    },
    body: '{}',
  });
  const res = await AuthHandler.fetch(req, env, {});
  assert.equal(res.status, 200);
  assert.equal(res.headers.get('Access-Control-Allow-Origin'), 'https://app.jtpowertools.com');
  assert.equal(res.headers.get('Access-Control-Allow-Credentials'), 'true');
  assert.ok(res.headers.get('Set-Cookie'));
});
```

(If importing `auth-handler.js` fails in the node harness because of a transitive dependency, check how other tests in the suite import route-level modules and mirror that; as a last resort drop the third test and keep the two OPTIONS tests, which exercise the same wrapper.)

- [ ] **Step 2: Run to verify failure**

Run: `node --test src/portal-auth-cookie.test.js`
Expected: the three new tests FAIL (wildcard everywhere today).

- [ ] **Step 3: Implement**

3a. Import in `auth-handler.js`:

```js
import { applyPortalCors } from './portal-cookie.js';
```

3b. OPTIONS branch (~line 50) — replace:

```js
    if (request.method === 'OPTIONS') {
      return corsResponse();
    }
```

with:

```js
    if (request.method === 'OPTIONS') {
      // POR-2: /auth/* preflights from the portal must be credentialed —
      // wildcard CORS is invalid for cookie-carrying requests.
      const res = corsResponse();
      return url.pathname.startsWith('/auth/') ? applyPortalCors(res, request) : res;
    }
```

3c. Wrap every `/auth/*` response. The dispatch (lines 55–90) is a flat if-chain of `return <handler>(...)` calls. Extract it verbatim into a helper placed just above `export const AuthHandler`:

```js
/** Flat /auth/* dispatch — returns a Response or null (not an auth path). */
async function routeAuthEndpoints(request, env, url) {
  if (url.pathname === '/auth/register') {
    return guardAuthEndpoint(request, env, handleRegister, { recordFailures: false });
  }
  // ... move EVERY existing `if (url.pathname === '/auth/...')` line here
  //     unchanged, including /auth/session ...
  return null;
}
```

and in `fetch()`, where the chain used to start, put:

```js
    // ─── Portal Auth endpoints ──────────────────────────────
    // POR-2: every /auth/* response gets portal-credentialed CORS when the
    // request comes from app.jtpowertools.com (cookie flows need it).
    if (url.pathname.startsWith('/auth/')) {
      const authRes = await routeAuthEndpoints(request, env, url);
      if (authRes) return applyPortalCors(authRes, request);
    }
```

Keep `/auth/session` inside the moved chain (it is under `/auth/` and harmless to portalize). Everything after (agent-connections, `/admin/*`, …) stays untouched.

- [ ] **Step 4: Run tests**

Run: `node --test src/portal-auth-cookie.test.js` → all PASS.
Run: `npm test` → full suite green.

- [ ] **Step 5: Commit**

```bash
git add server/mcp-server/src/auth-handler.js server/mcp-server/src/portal-auth-cookie.test.js
git commit -m "feat(server): credentialed portal CORS on /auth/* (POR-2)"
```

---

### Task 6: portal client — cookie flow + force re-login

**Files:**
- Modify: `portal/js/api.js` (API base ~line 7, fetch options ~lines 27–49)
- Modify: `portal/js/auth.js` (whole token-management section)

No JS test harness covers `portal/js` — verification is the live checklist in Task 8 plus a careful read. Before editing, confirm no other callers break:

- [ ] **Step 1: Verify caller surface**

Run: `grep -rn "getRefreshToken\|setTokens" portal/js/`
Expected: `getRefreshToken` appears only in `auth.js` itself and `api.js:34`; `setTokens` only in `auth.js`. If a `page-*.js` file uses either, update it with the same substitutions below.

- [ ] **Step 2: Edit `portal/js/api.js`**

2a. Line 7: `const API_BASE = 'https://mcp.jtpowertools.com';`

2b. In `request()`, send credentials on auth paths and fix the 401-retry guard (it can no longer see a refresh token — gate on "we believed we were logged in" instead):

```js
  async request(path, options = {}) {
    const url = `${API_BASE}${path}`;
    const headers = {
      'Content-Type': 'application/json',
      ...options.headers,
    };

    // POR-2: /auth/* requests carry the httpOnly refresh cookie. Other
    // endpoints stay credential-less (their wildcard CORS would reject a
    // credentialed response).
    const credentials = path.startsWith('/auth/') ? 'include' : 'omit';

    // Attach access token if available
    const token = auth.getAccessToken();
    if (token) {
      headers['Authorization'] = `Bearer ${token}`;
    }

    let response = await fetch(url, {
      method: options.method || 'POST',
      headers,
      body: options.body ? JSON.stringify(options.body) : undefined,
      credentials,
    });

    // If 401 while we hold an access token, try a cookie refresh. (The
    // refresh token is httpOnly — invisible to JS — so "do we have one" is
    // approximated by "did we think we were signed in".)
    if (response.status === 401 && token) {
      const refreshed = await auth.refresh();
      if (refreshed) {
        headers['Authorization'] = `Bearer ${auth.getAccessToken()}`;
        response = await fetch(url, {
          method: options.method || 'POST',
          headers,
          body: options.body ? JSON.stringify(options.body) : undefined,
          credentials,
        });
      } else {
        auth.logout();
        return null;
      }
    }
```

(The rest of `request()` — text/JSON parsing and `ApiError` — is unchanged.)

- [ ] **Step 3: Edit `portal/js/auth.js`**

3a. Replace the header comment (lines 1–24) with:

```js
/**
 * Auth Manager for JT Power Tools Portal
 *
 * Handles JWT storage, refresh, and session state.
 *
 * POR-2 (shipped): the refresh token lives in an `HttpOnly; Secure;
 * SameSite=Strict; Path=/auth` cookie on mcp.jtpowertools.com, set by the
 * worker on login/register and rotated on every /auth/refresh — it never
 * touches JS or localStorage, so page-origin XSS cannot exfiltrate it.
 * The short-lived access token (and user object) stay in localStorage on
 * purpose: isLoggedIn()/requireAuth() are called synchronously at page load,
 * and the residual XSS risk is mitigated by POR-1 + the enforcing CSP.
 */
```

3b. Storage keys — keep the legacy key name only for the one-time purge:

```js
const STORAGE_KEYS = {
  ACCESS_TOKEN: 'jt_access_token',
  USER: 'jt_user',
};
// Pre-POR-2 localStorage refresh-token key — only referenced by the purge below.
const LEGACY_REFRESH_KEY = 'jt_refresh_token';

const AUTH_BASE = 'https://mcp.jtpowertools.com';
```

3c. Token management: delete `getRefreshToken()`; simplify `setTokens`/`clearAll`:

```js
  setTokens(accessToken) {
    localStorage.setItem(STORAGE_KEYS.ACCESS_TOKEN, accessToken);
  },
```

```js
  clearAll() {
    localStorage.removeItem(STORAGE_KEYS.ACCESS_TOKEN);
    localStorage.removeItem(LEGACY_REFRESH_KEY);
    localStorage.removeItem(STORAGE_KEYS.USER);
  },
```

3d. `login`/`register` opt into cookie mode; `setTokens` calls drop the second arg:

```js
  async login(email, password, cfTurnstileToken) {
    const body = { email, password, cookieMode: true };
    if (cfTurnstileToken) body.cfTurnstileToken = cfTurnstileToken;
    const data = await api.post('/auth/login', body);
    this.setTokens(data.accessToken);
    this.setUser(data.user);
    return data;
  },

  async register(fields) {
    // Caller may set fields.cfTurnstileToken before calling.
    const data = await api.post('/auth/register', { ...fields, cookieMode: true });
    this.setTokens(data.accessToken);
    this.setUser(data.user);
    return data;
  },
```

3e. `_doRefresh` — no local token check (the cookie is invisible to JS); send credentials. Keep the single-flight `refresh()` wrapper exactly as is:

```js
  async _doRefresh() {
    try {
      const response = await fetch(`${AUTH_BASE}/auth/refresh`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include', // sends the httpOnly jt_refresh cookie
        body: '{}',
      });

      if (!response.ok) {
        this.clearAll();
        return false;
      }

      const data = await response.json();
      // The worker rotates the cookie itself; only the access token comes
      // back in JSON.
      this.setTokens(data.accessToken);
      if (data.user) this.setUser(data.user);
      return true;
    } catch {
      this.clearAll();
      return false;
    }
  },
```

3f. `logout` — cookie does the identifying; no body token:

```js
  async logout() {
    try {
      await fetch(`${AUTH_BASE}/auth/logout`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: '{}',
      });
    } catch {
      // Non-critical
    }
    this.clearAll();
    window.location.href = '/';
  },
```

3g. One-time legacy purge — add just above the final `window.auth = auth;`:

```js
// POR-2 one-time migration: pre-cookie sessions kept the refresh token in
// localStorage. Revoke that session server-side (kills any previously
// exfiltrated copy too), drop the whole cached login, and let the route
// guards send the user to sign-in. Fire-and-forget — nothing depends on it.
(function purgeLegacyRefreshToken() {
  const legacy = localStorage.getItem(LEGACY_REFRESH_KEY);
  if (!legacy) return;
  try {
    fetch(`${AUTH_BASE}/auth/logout`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ refreshToken: legacy }),
    }).catch(() => {});
  } catch { /* non-critical */ }
  auth.clearAll();
})();
```

- [ ] **Step 4: Static sanity check**

Run: `grep -n "getRefreshToken\|jt_refresh_token\|workers.dev" portal/js/*.js`
Expected: no `getRefreshToken` anywhere; `jt_refresh_token` only via `LEGACY_REFRESH_KEY` in `auth.js`; no `workers.dev` URL left in `portal/js/` (config.js mentions endpoints in comments only — comments are fine).

- [ ] **Step 5: Commit**

```bash
git add portal/js/api.js portal/js/auth.js
git commit -m "feat(portal): refresh token via httpOnly cookie, force re-login (POR-2)"
```

---

### Task 7: CHANGELOG

**Files:**
- Modify: `CHANGELOG.md`

⚠️ The working tree's `CHANGELOG.md` may carry two uncommitted WIP lines (print-scope under `### Added`, a Dark Mode fix under `### Fixed`). Commit ONLY the POR-2 entry:

- [ ] **Step 1:** `git stash push CHANGELOG.md` (parks WIP lines if present; if `git diff --quiet CHANGELOG.md` says clean, skip stashing)
- [ ] **Step 2:** Add under `## [Unreleased]` → `### Security`  (create the `### Security` heading right after the `## [Unreleased]` line if it doesn't exist):

```markdown
- **Portal refresh token moved out of localStorage into an httpOnly cookie** (POR-2) ([portal-cookie.js](server/mcp-server/src/portal-cookie.js), [portal-auth.js](server/mcp-server/src/portal-auth.js), [auth-handler.js](server/mcp-server/src/auth-handler.js), [api.js](portal/js/api.js), [auth.js](portal/js/auth.js)). The portal's long-lived refresh token sat in localStorage, so any XSS on app.jtpowertools.com could steal it for durable account takeover. The worker now sets it as `jt_refresh` — `HttpOnly; Secure; SameSite=Strict; Path=/auth` on mcp.jtpowertools.com — on login/register, rotates it on every refresh, and clears it on logout/failed refresh; the token never appears in JSON or JS. The portal switched its API base to mcp.jtpowertools.com (same-site, so the strict cookie flows) and `/auth/*` responses gain per-request credentialed CORS for the portal origin. The extension's body-token flow is untouched. **Existing portal sessions are signed out once** — on first load the old localStorage token is revoked server-side and purged. Covered by [portal-cookie.test.js](server/mcp-server/src/portal-cookie.test.js) and [portal-auth-cookie.test.js](server/mcp-server/src/portal-auth-cookie.test.js).
```

- [ ] **Step 3:** Commit + restore WIP:

```bash
git add CHANGELOG.md
git commit -m "docs: CHANGELOG for POR-2 refresh-token cookie

Updated CHANGELOG.md"
git stash pop   # only if Step 1 stashed; resolve by keeping both entries if it conflicts
```

---

### Task 8: deploy + live verification

Worker first (backward compatible), portal second.

- [ ] **Step 1: Final full test pass**

```bash
cd server/mcp-server && npm test          # expect 800+ pass, 0 fail
cd ../.. && npm test                      # extension vitest — expect 487+ pass (no extension changes; regression only)
```

- [ ] **Step 2: Deploy the worker**

```bash
cd server/mcp-server && npx wrangler deploy
```

- [ ] **Step 3: Deploy the portal**

```bash
npx wrangler pages deploy portal --project-name jt-power-tools-portal --commit-dirty=true
```

- [ ] **Step 4: Credential-less live checks** (no portal account needed)

```bash
# Preflight from the portal origin → echoed origin + credentials
curl -s -X OPTIONS https://mcp.jtpowertools.com/auth/refresh \
  -H "Origin: https://app.jtpowertools.com" -H "Access-Control-Request-Method: POST" \
  -D - -o /dev/null | grep -i "access-control-allow"
# Expect: Access-Control-Allow-Origin: https://app.jtpowertools.com
#         Access-Control-Allow-Credentials: true

# Body-mode refresh with a dead token → 401, no Set-Cookie (extension contract)
curl -s -X POST https://mcp.jtpowertools.com/auth/refresh \
  -H "Content-Type: application/json" -d '{"refreshToken":"dead"}' -D - -o /dev/null | grep -iE "HTTP|set-cookie"
# Expect: 401, and NO Set-Cookie line

# Cookie-mode refresh with a dead cookie → 401 + clearing Set-Cookie
curl -s -X POST https://mcp.jtpowertools.com/auth/refresh \
  -H "Content-Type: application/json" -H "Cookie: jt_refresh=dead" -d '{}' -D - -o /dev/null | grep -iE "HTTP|set-cookie"
# Expect: 401, Set-Cookie: jt_refresh=; ... Max-Age=0
```

- [ ] **Step 5: Browser verification on app.jtpowertools.com** (needs a real portal login — ask the user to sign in, or use their session)

1. Sign in → DevTools → Application → Cookies on `https://mcp.jtpowertools.com`: `jt_refresh` present, HttpOnly ✓, Secure ✓, SameSite=Strict, Path=/auth.
2. DevTools → Application → Local Storage on `app.jtpowertools.com`: `jt_access_token` + `jt_user` present, **no `jt_refresh_token`**.
3. Dashboard loads (admin API calls work).
4. Wait >15 min (or delete `jt_access_token` and reload): silent refresh signs you back in without a login prompt.
5. Sign out → cookie gone, back at login.
6. Extension regression: sign in via the extension popup (support@jtpowertools.com test account — NEVER the Titus account) and confirm worker-backed features still load.

- [ ] **Step 6: Push**

```bash
git push origin main
```

---

## Self-review notes

- **Spec coverage:** cookie contract → Task 1; dual-mode refresh/login/register/logout/logout-all → Tasks 2–4; credentialed CORS incl. preflight → Task 5; portal client + API base + 401 guard + legacy purge → Task 6; rollout order + verification → Task 8; CHANGELOG → Task 7. Deliberately-unchanged list needs no tasks.
- **Grace path:** covered by threading `cookieMode` through the second `buildRefreshSuccess` call site (Task 2, step 3d).
- **Type consistency:** `jsonRes(data, status, extraHeaders)` third arg is used by Tasks 2–4 identically; `buildRefreshSuccess(env, accountId, token, cookieMode)` matches both call sites; portal `AUTH_BASE` constant used by all auth.js fetches.
