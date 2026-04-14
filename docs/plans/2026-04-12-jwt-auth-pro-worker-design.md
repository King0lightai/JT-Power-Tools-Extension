# JWT Auth for Pro Worker — Design

**Date:** 2026-04-12
**Status:** Approved
**Problem:** Users who onboard through the portal (not the old extension flow) have no `authorized_devices` rows. The Pro Worker's `withAuth()` gates on device authorization, so all Pro features (Job Switcher, Availability Schedule) fail with `DEVICE_NOT_AUTHORIZED`.

## Root Cause

Two parallel auth systems exist:
- **Old:** `users` table + `authorized_devices` table (device-based, used by Pro Worker)
- **New:** `accounts` table + `licenses` table + `extension_grant_keys` (portal JWT-based)

Portal login creates entries in the new system but never registers a device in the old system. The `storeAuthData()` call to `verifyOrgAccess()` is gated on `data.grantKey` being truthy, but the portal returns `null` when `licenses.grant_key_encrypted` isn't set (multi-org users store keys in `extension_grant_keys` instead).

## Solution

Add JWT as a first-class auth path in the Pro Worker's `withAuth()`. The portal JWT proves identity — no device registration needed.

## Architecture

```
Request arrives at withAuth()
  ├─ Has Authorization: Bearer <jwt>?
  │   ├─ Verify JWT (HS256, JWT_SECRET — same as MCP server)
  │   ├─ Look up account by jwt.sub in accounts table
  │   ├─ Look up license by account.license_id in licenses table
  │   ├─ Resolve grant key:
  │   │   ├─ grantKeyOverride in body? → use it
  │   │   └─ else → extension_grant_keys for license + orgIdOverride
  │   ├─ Build effectiveUser (same shape as old flow)
  │   └─ Call handler(env, effectiveUser)
  │
  └─ No JWT → fall back to licenseKey + deviceId (existing code, unchanged)
```

## Changes

### Pro Worker (`JT Pro Worker.txt` / `jt-tools-license-proxy`)

1. **Add `JWT_SECRET` env var** — same value as MCP server
2. **Add JWT helpers** (~30 lines): `verifyJwt()`, `getSigningKey()`, `base64url()` — copied from portal-auth.js
3. **Add `resolveJwtAuth(env, jwt, body)`** — verifies JWT, looks up account → license → extension_grant_keys, returns effectiveUser
4. **Update `withAuth()`** — try JWT path first, fall back to device path

### Extension (`jobtread-pro-service.js`)

1. **Update `workerRequest()`** — check for portal JWT in `chrome.storage.local`
2. If JWT present → send `Authorization: Bearer <jwt>` header, still send `orgIdOverride` for multi-org
3. If no JWT → fall back to old `licenseKey + deviceId` body (backward compat)

### Grant Key Resolution (Server-Side)

Single org:
```sql
SELECT grant_key_encrypted, org_id, org_name
FROM extension_grant_keys
WHERE license_id = ?
ORDER BY created_at ASC LIMIT 1
```

Multi-org (orgIdOverride provided):
```sql
SELECT grant_key_encrypted, org_id, org_name
FROM extension_grant_keys
WHERE license_id = ? AND org_id = ?
```

## Dead Code (future cleanup)

Once all users migrate to portal:
- `authorized_devices` table
- `isDeviceAuthorized()`, `authorizeDevice()`, `updateLastActive()`
- `handleRegisterUser()`, `handleVerifyOrgAccess()`
- Device ID generation in extension

No removal now — fallback for non-portal users.

## Affected User Fix

Mick (mick@palmettobuilt.com) signs into portal on Chrome → extension has JWT → Pro Worker accepts it → no device needed. Immediate unblock, no manual DB fix required.
