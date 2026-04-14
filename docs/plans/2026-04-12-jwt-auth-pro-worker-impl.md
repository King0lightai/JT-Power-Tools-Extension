# JWT Auth for Pro Worker — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add portal JWT as a first-class auth path in the Pro Worker, eliminating the device registration requirement for portal users.

**Architecture:** The Pro Worker's `withAuth()` middleware gains a JWT code path that verifies the portal access token, looks up the account/license in D1, resolves the grant key from `extension_grant_keys`, and builds the same `effectiveUser` object handlers already expect. The extension's `workerRequest()` sends the JWT when available, falling back to the old licenseKey+deviceId flow.

**Tech Stack:** Cloudflare Workers, D1 (SQLite), HS256 JWT, Chrome Extension APIs

---

### Task 1: Add JWT Helpers to Pro Worker

**Files:**
- Modify: `server/JT Pro Worker.txt` — add after the constants block (~line 18)

**Step 1: Add JWT verification functions**

Add these functions after the constants (`JOBTREAD_API`, `CACHE_TTL_JOBS`, etc.) and before the `export default` block:

```javascript
// ─── JWT Verification (portal access tokens) ─────────────────────
// Copied from portal-auth.js — same HS256 signing used by the MCP server portal.

function getJwtSecret(env) {
  return env.JWT_SECRET || 'jt-power-tools-portal-jwt-secret-change-me';
}

async function getSigningKey(secret) {
  const enc = new TextEncoder();
  return crypto.subtle.importKey(
    'raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign', 'verify']
  );
}

function base64urlDecode(str) {
  str = str.replace(/-/g, '+').replace(/_/g, '/');
  while (str.length % 4) str += '=';
  const binary = atob(str);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

async function verifyJwt(token, secret) {
  try {
    const [header, body, sig] = token.split('.');
    if (!header || !body || !sig) return null;
    const key = await getSigningKey(secret);
    const data = `${header}.${body}`;
    const valid = await crypto.subtle.verify(
      'HMAC', key, base64urlDecode(sig), new TextEncoder().encode(data)
    );
    if (!valid) return null;
    const payload = JSON.parse(atob(body.replace(/-/g, '+').replace(/_/g, '/')));
    if (payload.exp && payload.exp < Math.floor(Date.now() / 1000)) return null;
    return payload;
  } catch {
    return null;
  }
}
```

**Step 2: Commit**

```bash
git add "server/JT Pro Worker.txt"
git commit -m "feat(worker): add JWT verification helpers to Pro Worker"
```

---

### Task 2: Add JWT Auth Resolver Function

**Files:**
- Modify: `server/JT Pro Worker.txt` — add after the JWT helpers from Task 1

**Step 1: Add resolveJwtAuth function**

This function verifies the JWT, looks up the account and license in D1, resolves the extension grant key, and returns an `effectiveUser` object with the same shape handlers expect:

```javascript
/**
 * Resolve auth from a portal JWT access token.
 * Returns an effectiveUser object (same shape as withAuth's user) or null on failure.
 *
 * JWT payload: { sub: accountId, lic: licenseId, role, tier, exp }
 * Looks up: accounts → licenses → extension_grant_keys
 */
async function resolveJwtAuth(env, jwtToken, body) {
  const payload = await verifyJwt(jwtToken, getJwtSecret(env));
  if (!payload || !payload.sub || !payload.lic) return null;

  // Look up account
  const account = await env.DB.prepare(
    'SELECT id, license_id, email, role, status FROM accounts WHERE id = ? AND status = \'active\''
  ).bind(payload.sub).first();
  if (!account) return null;

  // Look up license
  const license = await env.DB.prepare(
    'SELECT id, license_key, org_id, org_name, tier, status FROM licenses WHERE id = ? AND status = \'active\''
  ).bind(account.license_id).first();
  if (!license) return null;

  // Resolve grant key: prefer body.grantKeyOverride, then extension_grant_keys
  let grantKey = body.grantKeyOverride || null;
  let orgId = body.orgIdOverride || license.org_id;
  let orgName = license.org_name;

  if (!grantKey) {
    // Query extension_grant_keys — use orgIdOverride if multi-org, else first key
    let keyRow;
    if (body.orgIdOverride) {
      keyRow = await env.DB.prepare(
        'SELECT grant_key_encrypted, org_id, org_name FROM extension_grant_keys WHERE license_id = ? AND org_id = ?'
      ).bind(license.id, body.orgIdOverride).first();
    }
    if (!keyRow) {
      keyRow = await env.DB.prepare(
        'SELECT grant_key_encrypted, org_id, org_name FROM extension_grant_keys WHERE license_id = ? ORDER BY created_at ASC LIMIT 1'
      ).bind(license.id).first();
    }
    if (keyRow) {
      grantKey = keyRow.grant_key_encrypted;
      orgId = keyRow.org_id;
      orgName = keyRow.org_name;
    }
  }

  if (!grantKey) {
    // Last resort: check if the old users table has a grant key for this license
    const legacyUser = await env.DB.prepare(
      'SELECT jobtread_grant_key, jobtread_org_id, jobtread_org_name FROM users WHERE gumroad_license_key = ?'
    ).bind(license.license_key).first();
    if (legacyUser?.jobtread_grant_key) {
      grantKey = legacyUser.jobtread_grant_key;
      orgId = legacyUser.jobtread_org_id || orgId;
      orgName = legacyUser.jobtread_org_name || orgName;
    }
  }

  if (!grantKey) return null; // No grant key found anywhere

  // If grantKeyOverride was provided without orgIdOverride, resolve the org
  if (body.grantKeyOverride && !body.orgIdOverride) {
    try {
      const orgInfo = await testGrantKey(body.grantKeyOverride);
      if (orgInfo.success && orgInfo.id) {
        orgId = orgInfo.id;
        orgName = orgInfo.name;
      }
    } catch (e) {
      console.error('Failed to resolve org from grantKeyOverride:', e);
    }
  }

  // Build effectiveUser with the same shape handlers expect
  return {
    id: account.id,
    email: account.email,
    gumroad_license_key: license.license_key,
    license_valid: true,
    jobtread_grant_key: grantKey,
    jobtread_org_id: orgId,
    jobtread_org_name: orgName,
    org_locked: true,
    tier: license.tier,
    _jwtAuth: true, // Flag for logging/debugging
  };
}
```

**Step 2: Commit**

```bash
git add "server/JT Pro Worker.txt"
git commit -m "feat(worker): add resolveJwtAuth for portal JWT auth path"
```

---

### Task 3: Update withAuth() to Try JWT First

**Files:**
- Modify: `server/JT Pro Worker.txt` — update the `withAuth()` function

**Step 1: Add JWT path at the top of withAuth()**

Replace the existing `withAuth` function with this updated version that tries JWT first:

```javascript
async function withAuth(env, body, handler, request) {
  // ─── JWT auth path (portal users) ─────────────────────────────
  // If the request has an Authorization: Bearer <jwt> header,
  // verify the JWT and skip device registration entirely.
  if (request) {
    const authHeader = request.headers.get('Authorization');
    if (authHeader && authHeader.startsWith('Bearer ')) {
      const jwtToken = authHeader.slice(7);
      // JWTs contain dots; device tokens and license keys don't
      if (jwtToken.includes('.')) {
        const effectiveUser = await resolveJwtAuth(env, jwtToken, body);
        if (effectiveUser) {
          return handler(env, effectiveUser);
        }
        // JWT invalid/expired — fall through to legacy auth
        // (don't return 401 here; the user might have both JWT and licenseKey)
      }
    }
  }

  // ─── Legacy auth path (device-based) ──────────────────────────
  const { licenseKey, deviceId } = body;

  if (!licenseKey || !deviceId) {
    return jsonResponse({ error: 'Missing credentials', code: 'MISSING_CREDENTIALS' }, 400);
  }

  // ... (rest of existing withAuth code unchanged)
```

**Step 2: Update all withAuth call sites to pass `request`**

In the main `fetch` handler's switch statement, every `withAuth` call needs the `request` parameter added. The pattern changes from:

```javascript
// OLD:
return await withAuth(env, body, handleGetStatus);

// NEW:
return await withAuth(env, body, handleGetStatus, request);
```

Update ALL protected action cases in the switch statement (there are ~22 of them).

**Step 3: Commit**

```bash
git add "server/JT Pro Worker.txt"
git commit -m "feat(worker): update withAuth to accept portal JWT, pass request to all call sites"
```

---

### Task 4: Add JWT_SECRET to Pro Worker Environment

**Step 1: Add the secret via wrangler**

```bash
cd server
npx wrangler secret put JWT_SECRET --name jt-tools-license-proxy
# When prompted, paste the same JWT_SECRET value used by the MCP server
```

To find the current MCP server secret:
```bash
cd server/mcp-server
npx wrangler secret list
# The JWT_SECRET should be listed. Use the same value for the Pro Worker.
```

**Step 2: Verify the secret is set**

```bash
npx wrangler secret list --name jt-tools-license-proxy
# Should show JWT_SECRET in the list
```

---

### Task 5: Update Extension to Send JWT

**Files:**
- Modify: `JT-Tools-Master/services/jobtread-pro-service.js` — update `workerRequest()`

**Step 1: Update workerRequest to send JWT when available**

In the `workerRequest()` function, after the `const deviceId = await getDeviceId();` line and before building `requestBody`, add JWT detection. Then conditionally set the Authorization header:

```javascript
  async function workerRequest(action, params = {}) {
    // ... existing validation of WORKER_CONFIG ...

    try {
      const licenseData = await getLicenseKey();
      const deviceId = await getDeviceId();

      // Check for portal JWT (preferred auth — no device registration needed)
      const stored = await chrome.storage.local.get(['jtAccountAccessToken']);
      const portalJwt = stored.jtAccountAccessToken || null;

      // Multi-org grant key resolution (works with both auth paths)
      if (window.GrantKeyResolver && window.OrgDetector?.getActiveOrg()) {
        const resolvedKey = await getGrantKey();
        if (resolvedKey) {
          params.grantKeyOverride = resolvedKey;
          if (typeof JobTreadAPI !== 'undefined') {
            const orgId = await JobTreadAPI.getOrgId();
            if (orgId) params.orgIdOverride = orgId;
          }
        }
      }

      const requestBody = {
        action,
        ...params
      };

      // Build headers — send JWT if available, else include legacy credentials in body
      const headers = { 'Content-Type': 'application/json' };

      if (portalJwt) {
        headers['Authorization'] = `Bearer ${portalJwt}`;
        // Still include licenseKey/deviceId as fallback in case JWT is expired
        if (licenseData) requestBody.licenseKey = licenseData.licenseKey;
        if (deviceId) requestBody.deviceId = deviceId;
      } else {
        // Legacy auth — require both
        if (!licenseData) {
          throw new Error('No Gumroad license found. Please activate your license first.');
        }
        requestBody.licenseKey = licenseData.licenseKey;
        requestBody.deviceId = deviceId;
      }

      const response = await fetch(workerUrl, {
        method: 'POST',
        headers,
        body: JSON.stringify(requestBody)
      });

      // If JWT auth got 401 (expired token), try refreshing and retrying once
      if (response.status === 401 && portalJwt && window.AccountService?.refreshToken) {
        log('JWT expired, attempting refresh...');
        const refreshed = await window.AccountService.refreshToken();
        if (refreshed) {
          const newStored = await chrome.storage.local.get(['jtAccountAccessToken']);
          if (newStored.jtAccountAccessToken) {
            headers['Authorization'] = `Bearer ${newStored.jtAccountAccessToken}`;
            const retryResponse = await fetch(workerUrl, {
              method: 'POST',
              headers,
              body: JSON.stringify(requestBody)
            });
            if (retryResponse.ok) {
              return await retryResponse.json();
            }
          }
        }
        // Refresh failed — fall through to error handling below
      }

      if (!response.ok) {
        const errorText = await response.text();
        logError('Worker error:', response.status, errorText);
        throw new Error(`Worker error ${response.status}: ${errorText}`);
      }

      const data = await response.json();
      if (data.error) {
        logError('API error:', data);
        return data;
      }
      return data;
    } catch (error) {
      logError('Request failed:', error);
      throw error;
    }
  }
```

**Step 2: Commit**

```bash
git add "JT-Tools-Master/services/jobtread-pro-service.js"
git commit -m "feat(extension): send portal JWT to Pro Worker, fallback to device auth"
```

---

### Task 6: Deploy and Test

**Step 1: Deploy Pro Worker**

The Pro Worker is deployed as `jt-tools-license-proxy`. Check for its wrangler config:

```bash
# Find the wrangler config for the Pro Worker
ls server/wrangler.toml server/wrangler.jsonc 2>/dev/null
# Or check if it's deployed via the Cloudflare dashboard (paste-deployed)
```

If the Pro Worker is paste-deployed (no wrangler.toml), update the code via the Cloudflare dashboard by pasting the updated `JT Pro Worker.txt`.

**Step 2: Test with Mick's scenario**

1. Install extension in Chrome
2. Sign into portal (mick@palmettobuilt.com)
3. Navigate to app.jobtread.com
4. Open Job Switcher (J+S or Alt+J)
5. Verify custom fields load (no DEVICE_NOT_AUTHORIZED)
6. Filter A-Z — should work
7. Check Availability Schedule — should work

**Step 3: Test fallback (no portal login)**

1. Clear portal session (`chrome.storage.local.remove(['jtAccountAccessToken'])`)
2. Verify old licenseKey+deviceId flow still works for users with authorized devices

**Step 4: Commit any fixes from testing**

```bash
git add -A
git commit -m "fix(worker): address issues found during JWT auth testing"
```

---

### Task 7: Update CHANGELOG

**Files:**
- Modify: `CHANGELOG.md`

**Step 1: Add entry under [Unreleased]**

```markdown
### Fixed
- Fixed device registration bug where users switching browsers (e.g., Edge to Chrome)
  could not use Pro features (Job Switcher, Availability Schedule)
  - Pro Worker now accepts portal JWT as authentication, eliminating the device
    registration requirement for portal users
  - Extension sends portal JWT when available, falls back to legacy device auth
```

**Step 2: Commit**

```bash
git add CHANGELOG.md
git commit -m "docs: add JWT auth fix to CHANGELOG"
```
