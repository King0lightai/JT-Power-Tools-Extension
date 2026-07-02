# POR-2: Portal Refresh Token → httpOnly Cookie — Design

**Date:** 2026-07-01
**Status:** Approved
**Finding:** POR-2 (SECURITY_REVIEW_2026-07.md) — the portal refresh token (long-lived, self-renewing) lives in `localStorage`, so any XSS on `app.jtpowertools.com` can exfiltrate it for durable account takeover. POR-1 (URL sanitizer allowlist) and POR-3 (enforcing CSP) already break the known XSS→theft chain; this removes the stored credential from JS reach entirely.

## Decision summary

- **Approach A — dual-mode auth endpoints** on the existing `jobtread-mcp-server` worker. No BFF/proxy, no new runtime.
- **Force re-login** for existing portal sessions (user-approved; consistent with prior security rollouts). Legacy localStorage refresh tokens are revoked server-side on first page load after deploy.
- The **extension's body-token flow is untouched** — same endpoints, same payloads, byte-identical responses.

## 1. Cookie contract (worker)

Host-only cookie on `mcp.jtpowertools.com` (no `Domain` attribute):

```
jt_refresh=<token>; HttpOnly; Secure; SameSite=Strict; Path=/auth; Max-Age=7776000
```

- `Max-Age` mirrors `REFRESH_TOKEN_TTL` (90 days) in `server/mcp-server/src/portal-auth.js`.
- Set on cookie-mode `login`/`register`; **re-set on every cookie-mode `refresh`** (token rotation).
- Cleared (`Max-Age=0`, empty value, same Path) on `logout`, `logout-all`, and on any failed cookie-mode refresh (401).
- `Path=/auth` means the browser never attaches it to non-auth endpoints; `SameSite=Strict` means no cross-site request ever carries it. `app.jtpowertools.com` → `mcp.jtpowertools.com` is same-site (same registrable domain + scheme), so portal fetches with `credentials: 'include'` do carry it.

## 2. Mode selection (worker, backward compatible)

| Endpoint | Cookie mode trigger | Cookie-mode behavior | Body mode (extension — unchanged) |
|---|---|---|---|
| `/auth/login`, `/auth/register` | `body.cookieMode === true` | `Set-Cookie` + omit `refreshToken` from JSON | returns `refreshToken` in JSON |
| `/auth/refresh` | `jt_refresh` cookie present (takes precedence over body) | rotate, `Set-Cookie` new token, omit `refreshToken` from JSON | reads `body.refreshToken`, returns new one in JSON |
| `/auth/logout` | `jt_refresh` cookie present | revoke session, clear cookie | reads `body.refreshToken` |
| `/auth/logout-all` | (access-token authed, as today) | additionally clears cookie | unchanged |

- `/auth/refresh` returns 400 only when **neither** cookie nor body token is present.
- The single-use rotation + KV grace path (`rotgrace:` entries) is unchanged — only the token's transport differs. A cookie-mode grace hit re-sets the cookie with the already-issued new token.
- Cookie parsing: exact-name match on the `Cookie` header; no cookie library.

## 3. CORS with credentials

`Access-Control-Allow-Origin: *` is invalid with credentials. On `/auth/*` responses (including preflight):

- Request `Origin` is `https://app.jtpowertools.com` → echo the origin, add `Access-Control-Allow-Credentials: true` and `Vary: Origin`.
- Any other origin → current behavior (`*`, no credentials). Extension contexts don't send credentials.
- Computed per-request in the handler (no module-scope state — same rule as the SRV-5 fix).
- The portal origin allowlist is a hardcoded constant (single production origin). pages.dev preview URLs are deliberately **not** allowlisted — see Rollout.

## 4. Portal client

- `portal/js/api.js`: `API_BASE` → `https://mcp.jtpowertools.com` (already in CSP `connect-src`). Requests to paths starting with `/auth/` send `credentials: 'include'` (this covers `logout-all`, which must clear the cookie); all other paths keep today's no-credentials fetches (their `*` CORS would reject credentialed responses).
- `portal/js/auth.js`:
  - `login`/`register` pass `cookieMode: true`; `setTokens` no longer persists a refresh token (the `jt_refresh_token` storage key is removed from the code).
  - `_doRefresh` always attempts (it cannot see the httpOnly cookie, so the "no local token → false" early return goes away), POSTs `{}` with credentials, and hard-fails to `clearAll()` on 401 exactly as today. The two hardcoded workers.dev URLs in `auth.js` switch to the new API base.
  - `logout` POSTs with credentials and no body token.
  - **Legacy cleanup (force re-login + server-side revocation):** on script load, if `localStorage.jt_refresh_token` exists, fire-and-forget a body-mode `/auth/logout` with it (revokes that session in D1, killing any previously-exfiltrated copy), then `clearAll()`. The route guards then send the user to sign-in.
  - The `SECURITY / POR-2` header comment is rewritten to describe the shipped model.

## 5. Deliberately unchanged

- **Access token + user object stay in `localStorage`.** The access token is short-lived (~30 min), the synchronous guards (`isLoggedIn`/`requireAuth`/`redirectIfLoggedIn`) depend on reading it at page load, and residual XSS risk is mitigated by POR-1 + the enforcing CSP.
- Extension (`account-service.js`) — zero changes.
- Session storage model in D1 (hashed tokens, rotation, grace window) — zero schema changes.

## 6. Error handling

- Failed cookie-mode refresh (401) → response also clears the cookie; client `clearAll()` + redirect (existing behavior).
- Network failure during refresh → `clearAll()` (existing behavior, unchanged).
- Malformed/absent cookie on `/auth/refresh` with no body token → 400 (existing message).

## 7. Testing

Worker harness (`server/mcp-server`, node test suite):
- cookie-mode login/register: `Set-Cookie` present with all five attributes; JSON omits `refreshToken`.
- refresh from cookie: rotates (old hash dead after grace), re-sets cookie, omits token from JSON.
- refresh grace path via cookie: converges on the same new token, re-sets cookie.
- body-mode login/refresh/logout: responses byte-identical to today (extension regression).
- logout / failed refresh: `Set-Cookie` clear (Max-Age=0).
- CORS: portal origin → echo + credentials + Vary; other origin → `*` without credentials.

Post-deploy live verification on `app.jtpowertools.com`: sign in → cookie visible in DevTools (HttpOnly flagged), `localStorage` has no `jt_refresh_token`; refresh works (dashboard reload after access-token expiry or forced 401); logout clears the cookie; extension login/refresh still works.

## 8. Rollout

1. Deploy worker (backward compatible — live portal keeps working on body flow).
2. Deploy portal.
3. CHANGELOG under `### Security`.

Accepted quirk: pages.dev preview deployments are cross-site to `mcp.jtpowertools.com`; the cookie won't stick there and preview sessions die when the access token expires (~30 min). Production is unaffected.
