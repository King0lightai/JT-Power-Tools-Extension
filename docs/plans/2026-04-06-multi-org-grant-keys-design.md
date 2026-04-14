# Multi-Org Extension Grant Keys — Design Document

**Date**: 2026-04-06
**Status**: Approved
**Scope**: Enable per-org grant key management for the Chrome extension, with keys managed in the portal and auto-resolved based on active org detection.

## Problem

The Chrome extension stores a single grant key. Users who belong to multiple JobTread organizations get wrong API results when they switch orgs, because the stored key is bound to one org.

## Solution Overview

1. **Portal**: New "Extension" section for managing per-org extension grant keys (separate from AI/MCP keys)
2. **Server**: New D1 table + API endpoint for extension grant key lookup by org name
3. **Extension**: New `OrgDetector` module watches the JT search bar to detect active org, services resolve the correct grant key from the server automatically

## Design Decisions

1. **Keys managed in portal, not extension popup** — users enter keys once in the portal, extension resolves them automatically. No popup UI changes.
2. **Separate table from `ai_grant_keys`** — extension grant keys serve a different purpose than MCP/AI grant keys. Different keys, different permissions, different mental model.
3. **Org detection via search bar** — the `.jt-top-header input[placeholder^="Search"]` placeholder always shows the org name (e.g., "Search Titus Contracting Inc"). Most reliable always-visible indicator.
4. **Continuous MutationObserver** — detect org changes in real time, not on-demand per API call. Org switches are infrequent; having the active org always in memory avoids repeated DOM queries.
5. **Auto-associate on key entry** — when user enters a grant key in the portal, server calls Pave `currentGrant` to discover which org it belongs to. No manual org name entry.
6. **Toast notification for missing keys** — when user switches to an org with no stored key, show a non-intrusive toast: "No API key configured for [Org Name]. Configure in JT Power Tools portal." Auto-dismiss after 8 seconds, once per org switch.
7. **New "Extension" portal section** — separate from "AI & MCP" section for clarity.

## Architecture

### 1. D1 Schema: `extension_grant_keys` table

```sql
CREATE TABLE IF NOT EXISTS extension_grant_keys (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  license_id INTEGER NOT NULL REFERENCES licenses(id),
  org_id TEXT NOT NULL,
  org_name TEXT NOT NULL,
  grant_key_encrypted TEXT NOT NULL,
  label TEXT,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now')),
  UNIQUE(license_id, org_id)
);
```

- `grant_key_encrypted`: server-side encrypted (same pattern as `ai_grant_keys`)
- `org_id` + `org_name`: auto-discovered from Pave `currentGrant` query on key entry
- `UNIQUE(license_id, org_id)`: one key per org per license

### 2. Server Endpoints

**Portal management endpoints** (authenticated by portal JWT):

```
POST /admin/extension-keys/list
  → { keys: [{ id, orgId, orgName, label, createdAt }] }

POST /admin/extension-keys/add
  Body: { grantKey, label? }
  → Calls Pave currentGrant to discover org
  → Encrypts and stores in D1
  → { success, orgId, orgName }

POST /admin/extension-keys/remove
  Body: { orgId }
  → Removes key for this org
  → { success }
```

**Extension lookup endpoint** (authenticated by session token or license key):

```
POST /api/extension-grant-key
  Body: { orgName }
  → Looks up extension_grant_keys by license_id + org_name
  → Returns decrypted grant key
  → { grantKey, orgId, orgName }
  → 404 if no key found for this org
```

### 3. Extension: OrgDetector Module

New file: `JT-Tools-Master/utils/org-detector.js`

```javascript
const OrgDetector = (() => {
  let activeOrgName = null;
  let observer = null;

  function init() {
    // Read initial org from search bar
    detectOrg();
    // Watch for changes (org switches)
    setupObserver();
  }

  function detectOrg() {
    const input = document.querySelector('.jt-top-header input[placeholder^="Search"]');
    if (!input) return;
    const placeholder = input.placeholder; // "Search Titus Contracting Inc"
    const orgName = placeholder.replace(/^Search\s+/, '');
    if (orgName && orgName !== activeOrgName) {
      const previous = activeOrgName;
      activeOrgName = orgName;
      if (previous !== null) {
        // Org changed — dispatch event
        window.dispatchEvent(new CustomEvent('jt-org-changed', {
          detail: { orgName, previousOrg: previous }
        }));
      }
    }
  }

  function setupObserver() {
    // Watch for placeholder attribute changes on the search input
    // Also watch for DOM reconstruction (SPA navigation)
    const header = document.querySelector('.jt-top-header');
    if (!header) {
      // Header not yet in DOM — watch body for it
      const bodyObs = new MutationObserver(() => {
        const h = document.querySelector('.jt-top-header');
        if (h) {
          bodyObs.disconnect();
          observeHeader(h);
        }
      });
      bodyObs.observe(document.body, { childList: true, subtree: true });
      return;
    }
    observeHeader(header);
  }

  function observeHeader(header) {
    observer = new MutationObserver(() => detectOrg());
    observer.observe(header, {
      attributes: true,
      attributeFilter: ['placeholder'],
      subtree: true,
      childList: true,
    });
  }

  function getActiveOrg() {
    return activeOrgName;
  }

  function cleanup() {
    if (observer) observer.disconnect();
    observer = null;
    activeOrgName = null;
  }

  return { init, getActiveOrg, cleanup };
})();

window.OrgDetector = OrgDetector;
```

### 4. Extension: Grant Key Resolution

New file: `JT-Tools-Master/services/grant-key-resolver.js`

Shared function all three services call:

```javascript
const GrantKeyResolver = (() => {
  let cache = {}; // { orgName: { grantKey, orgId, expiresAt } }
  const CACHE_TTL = 5 * 60 * 1000; // 5 minutes

  async function getGrantKey() {
    const orgName = OrgDetector.getActiveOrg();
    if (!orgName) return null;

    // Check cache
    const cached = cache[orgName];
    if (cached && cached.expiresAt > Date.now()) {
      return cached.grantKey;
    }

    // Fetch from server
    try {
      const response = await chrome.runtime.sendMessage({
        action: 'FETCH_EXTENSION_GRANT_KEY',
        orgName
      });
      if (response.success && response.grantKey) {
        cache[orgName] = {
          grantKey: response.grantKey,
          orgId: response.orgId,
          expiresAt: Date.now() + CACHE_TTL,
        };
        return response.grantKey;
      }
      // No key for this org — show toast (once)
      showMissingKeyToast(orgName);
      return null;
    } catch (err) {
      console.error('GrantKeyResolver: Failed to fetch key', err);
      return null;
    }
  }

  function invalidateCache() {
    cache = {};
  }

  // Listen for org changes
  window.addEventListener('jt-org-changed', () => {
    // Don't clear entire cache — just let the next call fetch if needed
    // The new org may already be cached
  });

  return { getGrantKey, invalidateCache };
})();

window.GrantKeyResolver = GrantKeyResolver;
```

### 5. Extension: Service Migration

All three services updated to use `GrantKeyResolver.getGrantKey()`:

| Service | Current | After |
|---------|---------|-------|
| `JobTreadAPI` | `chrome.storage.sync.get('jtToolsApiKey')` | `GrantKeyResolver.getGrantKey()` |
| `JobTreadProService` | `chrome.storage.local.get('jtpro_grant_key')` | `GrantKeyResolver.getGrantKey()` |
| `AccountService` | `chrome.storage.local.get('jtAccountGrantKey')` | `GrantKeyResolver.getGrantKey()` |

### 6. Extension: Toast Notification

When `GrantKeyResolver` gets a 404 (no key for org):

```
┌──────────────────────────────────────────────┐
│ ⚠ No API key configured for "Other Org LLC"  │
│ Add one at app.jtpowertools.com/dashboard     │
└──────────────────────────────────────────────┘
```

- Bottom-right corner of JT UI
- Auto-dismiss after 8 seconds
- Only shows once per org switch (not on every failed API call)
- Styled to match JT UI (or dark mode if active)

### 7. Portal: New "Extension" Section

Add to `dashboard.html` as a new tab alongside Account, AI & MCP, and Team:

**Extension tab contents:**
- "Extension Grant Keys" header
- Explanation: "Add a grant key for each JobTread organization you use. The extension will automatically use the correct key when you switch orgs."
- Table of configured orgs: Org Name | Label | Added | [Remove]
- "Add Grant Key" input + button (auto-discovers org on submit)
- Status indicator per org

### 8. Migration: Existing Keys

On extension update:
1. Read existing keys from old storage locations (`jtToolsApiKey`, `jtpro_grant_key`, `jtAccountGrantKey`)
2. If found, call server to store them under the current org name (detected from search bar)
3. Clean up old storage keys
4. Existing users' setup keeps working — zero friction

## File Changes

### New Files
- `JT-Tools-Master/utils/org-detector.js` — org detection module
- `JT-Tools-Master/services/grant-key-resolver.js` — shared grant key resolution
- `server/mcp-server/migrations/0XX_extension_grant_keys.sql` — D1 schema

### Modified Files
- `server/mcp-server/src/index.js` — new endpoint routing
- `server/mcp-server/src/admin.js` — new admin endpoints for extension keys
- `portal/dashboard.html` — new Extension tab
- `portal/js/api.js` — new API methods for extension key management
- `JT-Tools-Master/services/jobtread-api.js` — use GrantKeyResolver
- `JT-Tools-Master/services/jobtread-pro-service.js` — use GrantKeyResolver
- `JT-Tools-Master/services/account-service.js` — use GrantKeyResolver
- `JT-Tools-Master/background/service-worker.js` — handle FETCH_EXTENSION_GRANT_KEY message
- `JT-Tools-Master/content.js` — init OrgDetector
- `JT-Tools-Master/manifest.json` — add new scripts

## Gotchas & Edge Cases

1. **Org name mismatch** — search bar placeholder must exactly match stored org name. Server lookup should be case-insensitive.
2. **Page load before search bar renders** — OrgDetector must handle the header not being in DOM yet (body observer fallback).
3. **Multiple tabs** — each tab runs its own OrgDetector. Cache is in-memory per tab, which is correct (different tabs could show different orgs).
4. **Rate limiting** — the `/api/extension-grant-key` endpoint should be rate limited to prevent abuse.
5. **Cache invalidation** — if user updates a key in the portal, the extension cache (5-min TTL) will eventually refresh. Could add a manual "refresh" option if needed.
6. **Offline/server unreachable** — if server is down, fall back gracefully. Features that need API just don't work, no crash.
7. **Migration timing** — migration runs on first page load after update. If user isn't on JT (search bar not visible), defer migration until they are.
