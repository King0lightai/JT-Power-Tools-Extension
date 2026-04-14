# Auto-Device Registration on Login

**Date:** 2026-02-27
**Status:** Approved
**Approach:** Client-Side Auto-Registration (Approach 1)

## Problem

When a user logs into their JT Power Tools account on a new device, the login flow restores their license key and grant key from the server. However, the Pro Worker (which handles custom field filtering, budget changelog, and other API features) is never told about this new device. The user must manually go to the API tab and click "Test" to register the device.

## Solution

After `storeAuthData()` saves the grant key, automatically call `JobTreadProService.verifyOrgAccess(grantKey)` to register the new device with the Pro Worker. Then refresh the popup's API tab UI to show the connected state.

## Changes

### `account-service.js` — `storeAuthData()`

After the existing grant key storage block (line 293), add:

```javascript
if (data.grantKey && window.JobTreadProService) {
  try {
    const proResult = await window.JobTreadProService.verifyOrgAccess(data.grantKey);
    if (proResult.success) {
      console.log('AccountService: Auto-registered device with Pro Worker');
    } else {
      console.warn('AccountService: Pro Worker auto-registration failed:', proResult.error);
    }
  } catch (err) {
    console.warn('AccountService: Pro Worker auto-registration error:', err);
  }
}
```

Non-blocking: login succeeds regardless of whether Pro Worker registration works.

### `popup.js` — `handleLogin()`

After `updateAccountUI()` (line 2406), add `await checkApiStatus()` to refresh the API tab.

## What Doesn't Change

- No server-side changes (either Cloudflare Worker)
- `verifyOrgAccess()` already handles device registration, org locking, etc.
- License restoration already works (line 297-301)
- Logout/clearAuthData already cleans up grant key

## Error Handling

- Pro Worker call wrapped in try/catch; failure is logged but doesn't break login
- If `JobTreadProService` isn't loaded, skipped silently
- If grant key is expired/invalid, user can re-enter manually later

## Scope

- 2 files: `account-service.js`, `popup.js`
- ~10 lines of new code
- No new endpoints, storage keys, or schema changes
