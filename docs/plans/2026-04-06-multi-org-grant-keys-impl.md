# Multi-Org Extension Grant Keys — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Enable per-org grant key management so multi-org users get correct API results when switching JobTread orgs.

**Architecture:** New D1 table + 3 admin endpoints + 1 extension lookup endpoint on the server. New OrgDetector + GrantKeyResolver modules in the extension. New "Extension" tab in the portal dashboard. Services migrated to use GrantKeyResolver.

**Tech Stack:** Cloudflare Workers (D1), Chrome Extension (MV3, plain JS), Portal (vanilla HTML/JS)

---

### Task 1: D1 Migration — `extension_grant_keys` table

**Files:**
- Create: `server/mcp-server/migrations/012_extension_grant_keys.sql`

**Step 1: Write the migration SQL**

```sql
-- Migration 012: Extension grant keys (per-org, for Chrome extension)
-- Separate from ai_grant_keys — different purpose, different key set

CREATE TABLE IF NOT EXISTS extension_grant_keys (
  id TEXT PRIMARY KEY,
  license_id TEXT NOT NULL,
  org_id TEXT NOT NULL,
  org_name TEXT NOT NULL,
  grant_key_encrypted TEXT NOT NULL,
  label TEXT,
  created_at INTEGER DEFAULT (strftime('%s', 'now')),
  updated_at INTEGER DEFAULT (strftime('%s', 'now')),
  FOREIGN KEY (license_id) REFERENCES licenses(id)
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_ext_grant_keys_license_org
  ON extension_grant_keys(license_id, org_id);
```

**Step 2: Apply migration**

Run: `cd server/mcp-server && npx wrangler d1 migrations apply jt-power-tools-db --remote`

**Step 3: Commit**

```bash
git add server/mcp-server/migrations/012_extension_grant_keys.sql
git commit -m "feat(server): add extension_grant_keys D1 migration"
```

---

### Task 2: Server — Extension key admin endpoints

**Files:**
- Modify: `server/mcp-server/src/admin.js` — add 3 new endpoint handlers + route entries
- Reference: existing `handleAddAiKey` / `handleListAiKeys` / `handleRemoveAiKey` patterns (lines 574-693)

**Step 1: Add extension key handlers to admin.js**

Add these after the Multi-AI-Grant-Key section (~line 693), before the Public Invite Endpoints section:

```javascript
// ─── Extension Grant Key Endpoints ───────────────────────────────

const MAX_EXT_KEYS_PER_LICENSE = 10;

/**
 * POST /admin/extension-keys/list — List all extension grant keys for the license
 */
export async function handleListExtensionKeys(request, env) {
  const { account, error } = await requireAdmin(request, env);
  if (error) return error;

  const rows = await env.DB.prepare(
    'SELECT id, label, org_id, org_name, grant_key_encrypted, created_at FROM extension_grant_keys WHERE license_id = ? ORDER BY created_at ASC'
  ).bind(account.license_id).all();

  const keys = (rows.results || []).map(k => ({
    id: k.id,
    label: k.label,
    orgId: k.org_id,
    orgName: k.org_name,
    maskedKey: k.grant_key_encrypted ? k.grant_key_encrypted.slice(0, 8) + '••••••••' : null,
    createdAt: k.created_at,
  }));

  return jsonRes({ keys, count: keys.length, maxAllowed: MAX_EXT_KEYS_PER_LICENSE });
}

/**
 * POST /admin/extension-keys/add — Add an extension grant key
 *
 * Body: { grantKey, label? }
 * Auto-discovers org from Pave currentGrant query.
 */
export async function handleAddExtensionKey(request, env) {
  const { account, error } = await requireAdmin(request, env);
  if (error) return error;

  const body = await parseJsonBody(request);
  if (!body?.grantKey) {
    return jsonRes({ error: 'grantKey is required' }, 400);
  }

  // Check count limit
  const countRow = await env.DB.prepare(
    'SELECT COUNT(*) as cnt FROM extension_grant_keys WHERE license_id = ?'
  ).bind(account.license_id).first();

  if (countRow.cnt >= MAX_EXT_KEYS_PER_LICENSE) {
    return jsonRes({ error: `Maximum ${MAX_EXT_KEYS_PER_LICENSE} extension grant keys allowed per license` }, 400);
  }

  // Validate the grant key against JobTread Pave API
  const { validateGrantKey } = await import('./auth.js');
  const grantResult = await validateGrantKey(body.grantKey);

  if (!grantResult.valid) {
    return jsonRes({ error: 'Invalid grant key — could not validate with JobTread' }, 400);
  }

  // Check for duplicate org
  const existing = await env.DB.prepare(
    'SELECT id FROM extension_grant_keys WHERE license_id = ? AND org_id = ?'
  ).bind(account.license_id, grantResult.orgId).first();

  if (existing) {
    return jsonRes({ error: `A key for ${grantResult.orgName || 'this organization'} already exists. Remove it first to replace.` }, 409);
  }

  // Insert
  const id = crypto.randomUUID();
  const label = body.label?.trim() || grantResult.orgName || 'Unnamed';
  await env.DB.prepare(
    'INSERT INTO extension_grant_keys (id, license_id, org_id, org_name, grant_key_encrypted, label) VALUES (?, ?, ?, ?, ?, ?)'
  ).bind(id, account.license_id, grantResult.orgId, grantResult.orgName, body.grantKey, label).run();

  return jsonRes({
    message: 'Extension grant key added',
    key: {
      id,
      label,
      orgId: grantResult.orgId,
      orgName: grantResult.orgName,
      maskedKey: body.grantKey.slice(0, 8) + '••••••••',
    },
  });
}

/**
 * POST /admin/extension-keys/remove — Remove an extension grant key
 *
 * Body: { keyId } or { orgId }
 */
export async function handleRemoveExtensionKey(request, env) {
  const { account, error } = await requireAdmin(request, env);
  if (error) return error;

  const body = await parseJsonBody(request);

  let key;
  if (body?.keyId) {
    key = await env.DB.prepare(
      'SELECT id, label, org_name FROM extension_grant_keys WHERE id = ? AND license_id = ?'
    ).bind(body.keyId, account.license_id).first();
  } else if (body?.orgId) {
    key = await env.DB.prepare(
      'SELECT id, label, org_name FROM extension_grant_keys WHERE org_id = ? AND license_id = ?'
    ).bind(body.orgId, account.license_id).first();
  } else {
    return jsonRes({ error: 'keyId or orgId is required' }, 400);
  }

  if (!key) {
    return jsonRes({ error: 'Key not found' }, 404);
  }

  await env.DB.prepare(
    'DELETE FROM extension_grant_keys WHERE id = ? AND license_id = ?'
  ).bind(key.id, account.license_id).run();

  return jsonRes({
    message: `Removed extension grant key "${key.label}" (${key.org_name || 'unknown org'})`,
  });
}
```

**Step 2: Add route entries to `handleAdminRoute` switch**

In the `handleAdminRoute` function's switch statement (around line 749-777), add before `default:`:

```javascript
      case '/admin/extension-keys/list':
        return await handleListExtensionKeys(request, env);
      case '/admin/extension-keys/add':
        return await handleAddExtensionKey(request, env);
      case '/admin/extension-keys/remove':
        return await handleRemoveExtensionKey(request, env);
```

**Step 3: Commit**

```bash
git add server/mcp-server/src/admin.js
git commit -m "feat(server): add extension grant key admin endpoints"
```

---

### Task 3: Server — Extension grant key lookup endpoint

**Files:**
- Modify: `server/mcp-server/src/auth-handler.js` — add route for `/api/extension-grant-key`

This endpoint is called by the Chrome extension's service worker. It authenticates via the portal JWT (same as admin endpoints) and looks up the grant key by org name (case-insensitive).

**Step 1: Add the lookup handler and route**

In `auth-handler.js`, add a new route before the admin endpoints block (around line 70):

```javascript
    // ─── Extension grant key lookup ─────────────────────────
    if (url.pathname === '/api/extension-grant-key' && request.method === 'POST') {
      return handleExtensionGrantKeyLookup(request, env);
    }
```

Then add the handler function at the bottom of the file (or import it from admin.js):

The cleanest approach is to add the handler in `admin.js` and import it in `auth-handler.js`. Add to admin.js:

```javascript
/**
 * POST /api/extension-grant-key — Lookup extension grant key by org name
 *
 * Body: { orgName }
 * Auth: Portal JWT (same as admin endpoints)
 * Returns the decrypted grant key for the matching org.
 */
export async function handleExtensionGrantKeyLookup(request, env) {
  // Authenticate — any role (not just admin)
  const { authenticateRequest } = await import('./portal-auth.js');
  const payload = await authenticateRequest(request, env);
  if (!payload) {
    return jsonRes({ error: 'Unauthorized' }, 401);
  }

  const account = await env.DB.prepare(
    'SELECT a.license_id FROM accounts a WHERE a.id = ? AND a.status = ?'
  ).bind(payload.sub, 'active').first();

  if (!account) {
    return jsonRes({ error: 'Account not found' }, 404);
  }

  const body = await parseJsonBody(request);
  if (!body?.orgName) {
    return jsonRes({ error: 'orgName is required' }, 400);
  }

  // Case-insensitive lookup by org_name
  const key = await env.DB.prepare(
    'SELECT org_id, org_name, grant_key_encrypted FROM extension_grant_keys WHERE license_id = ? AND LOWER(org_name) = LOWER(?)'
  ).bind(account.license_id, body.orgName.trim()).first();

  if (!key) {
    return jsonRes({ error: 'No extension grant key found for this organization' }, 404);
  }

  return jsonRes({
    grantKey: key.grant_key_encrypted,
    orgId: key.org_id,
    orgName: key.org_name,
  });
}
```

Then update the import in `auth-handler.js` (line 33):

```javascript
import { handleAdminRoute, handleInviteValidate, handleExtensionGrantKeyLookup } from './admin.js';
```

**Step 2: Commit**

```bash
git add server/mcp-server/src/admin.js server/mcp-server/src/auth-handler.js
git commit -m "feat(server): add extension grant key lookup endpoint"
```

---

### Task 4: Extension — OrgDetector module

**Files:**
- Create: `JT-Tools-Master/utils/org-detector.js`

**Step 1: Create the OrgDetector module**

```javascript
/**
 * OrgDetector — Detects the active JobTread organization from the search bar.
 *
 * The JT search bar placeholder always shows "Search <Org Name>".
 * This module watches for placeholder changes to detect org switches in real time.
 *
 * Events dispatched:
 *   'jt-org-changed' on window — { detail: { orgName, previousOrg } }
 */
const OrgDetector = (() => {
  let activeOrgName = null;
  let observer = null;
  let bodyObserver = null;
  let initialized = false;

  function init() {
    if (initialized) return;
    initialized = true;
    detectOrg();
    setupObserver();
    console.log('OrgDetector: Initialized, activeOrg:', activeOrgName);
  }

  function detectOrg() {
    const input = document.querySelector('.jt-top-header input[placeholder^="Search"]');
    if (!input) return;
    const placeholder = input.getAttribute('placeholder') || '';
    const orgName = placeholder.replace(/^Search\s+/, '').trim();
    if (orgName && orgName !== activeOrgName) {
      const previous = activeOrgName;
      activeOrgName = orgName;
      if (previous !== null) {
        console.log('OrgDetector: Org changed from', previous, 'to', orgName);
        window.dispatchEvent(new CustomEvent('jt-org-changed', {
          detail: { orgName, previousOrg: previous }
        }));
      }
    }
  }

  function setupObserver() {
    const header = document.querySelector('.jt-top-header');
    if (!header) {
      // Header not yet in DOM — watch body for it
      bodyObserver = new MutationObserver(() => {
        const h = document.querySelector('.jt-top-header');
        if (h) {
          bodyObserver.disconnect();
          bodyObserver = null;
          detectOrg();
          observeHeader(h);
        }
      });
      bodyObserver.observe(document.body, { childList: true, subtree: true });
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
    // Lazy detect if not yet found
    if (!activeOrgName) detectOrg();
    return activeOrgName;
  }

  function cleanup() {
    if (observer) { observer.disconnect(); observer = null; }
    if (bodyObserver) { bodyObserver.disconnect(); bodyObserver = null; }
    activeOrgName = null;
    initialized = false;
  }

  return { init, getActiveOrg, cleanup };
})();

window.OrgDetector = OrgDetector;
```

**Step 2: Commit**

```bash
git add JT-Tools-Master/utils/org-detector.js
git commit -m "feat(extension): add OrgDetector module for active org detection"
```

---

### Task 5: Extension — GrantKeyResolver service

**Files:**
- Create: `JT-Tools-Master/services/grant-key-resolver.js`

**Step 1: Create the GrantKeyResolver service**

```javascript
/**
 * GrantKeyResolver — Resolves the correct extension grant key for the active org.
 *
 * Uses OrgDetector to determine active org, fetches the grant key from the server
 * via the service worker, and caches results for 5 minutes.
 *
 * All three services (JobTreadAPI, JobTreadProService, AccountService) call
 * GrantKeyResolver.getGrantKey() instead of reading from individual storage keys.
 */
const GrantKeyResolver = (() => {
  const CACHE_TTL = 5 * 60 * 1000; // 5 minutes
  let cache = {}; // { orgName: { grantKey, orgId, expiresAt } }
  let toastShownForOrgs = new Set(); // Track which orgs we've shown missing-key toast for

  /**
   * Get the grant key for the currently active org.
   * Returns cached value if fresh, otherwise fetches from server.
   * @returns {Promise<string|null>} The grant key or null
   */
  async function getGrantKey() {
    const orgName = window.OrgDetector ? window.OrgDetector.getActiveOrg() : null;
    if (!orgName) {
      // OrgDetector not ready or not on JT page — fall back to legacy storage
      return getFallbackGrantKey();
    }

    // Check cache
    const cached = cache[orgName];
    if (cached && cached.expiresAt > Date.now()) {
      return cached.grantKey;
    }

    // Fetch from server via service worker
    try {
      const response = await chrome.runtime.sendMessage({
        type: 'FETCH_EXTENSION_GRANT_KEY',
        orgName
      });

      if (response && response.success && response.grantKey) {
        cache[orgName] = {
          grantKey: response.grantKey,
          orgId: response.orgId,
          expiresAt: Date.now() + CACHE_TTL,
        };
        toastShownForOrgs.delete(orgName); // Clear toast flag on success
        return response.grantKey;
      }

      // No key for this org — show toast once per org switch
      if (!toastShownForOrgs.has(orgName)) {
        toastShownForOrgs.add(orgName);
        showMissingKeyToast(orgName);
      }

      // Fall back to legacy storage
      return getFallbackGrantKey();
    } catch (err) {
      console.error('GrantKeyResolver: Failed to fetch key for', orgName, err);
      return getFallbackGrantKey();
    }
  }

  /**
   * Fall back to legacy single-key storage for backward compatibility.
   * Used when: server unreachable, no org detected, no key for current org.
   */
  async function getFallbackGrantKey() {
    try {
      // Try pro service key first (obfuscated, local storage)
      const proResult = await chrome.storage.local.get(['jtpro_grant_key', 'jtpro_grant_key_version']);
      if (proResult.jtpro_grant_key) {
        // If it's v2 (obfuscated), the caller (JobTreadProService) handles deobfuscation
        // Return raw value — services know their own format
        return proResult.jtpro_grant_key;
      }

      // Try basic API key (sync storage, plaintext)
      const apiResult = await chrome.storage.sync.get(['jtToolsApiKey']);
      if (apiResult.jtToolsApiKey) {
        return apiResult.jtToolsApiKey;
      }

      // Try account service key
      const accountResult = await chrome.storage.local.get(['jtAccountGrantKey']);
      if (accountResult.jtAccountGrantKey) {
        return accountResult.jtAccountGrantKey;
      }

      return null;
    } catch (err) {
      console.error('GrantKeyResolver: Fallback key lookup failed', err);
      return null;
    }
  }

  /**
   * Show a non-intrusive toast when no key is configured for the current org.
   */
  function showMissingKeyToast(orgName) {
    // Don't show if a toast already exists
    if (document.getElementById('jt-missing-key-toast')) return;

    const toast = document.createElement('div');
    toast.id = 'jt-missing-key-toast';
    toast.style.cssText = `
      position: fixed; bottom: 24px; right: 24px; z-index: 999999;
      background: #2c2c2c; color: #e0e0e0; border: 1px solid #404040;
      border-radius: 8px; padding: 14px 20px; max-width: 380px;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      font-size: 13px; line-height: 1.5; box-shadow: 0 4px 12px rgba(0,0,0,0.3);
      transition: opacity 0.3s ease, transform 0.3s ease;
      opacity: 0; transform: translateY(10px);
    `;
    toast.innerHTML = `
      <div style="display: flex; align-items: flex-start; gap: 10px;">
        <span style="font-size: 16px; flex-shrink: 0;">⚠️</span>
        <div>
          <div style="font-weight: 600; margin-bottom: 4px;">No API key for "${orgName}"</div>
          <div style="color: #b0b0b0;">Add one at <a href="https://app.jtpowertools.com/dashboard" target="_blank" style="color: #FF6B35; text-decoration: none;">app.jtpowertools.com</a></div>
        </div>
        <button style="background: none; border: none; color: #707070; cursor: pointer; font-size: 16px; padding: 0; margin-left: 8px; flex-shrink: 0;" onclick="this.parentElement.parentElement.remove()">✕</button>
      </div>
    `;
    document.body.appendChild(toast);

    // Animate in
    requestAnimationFrame(() => {
      toast.style.opacity = '1';
      toast.style.transform = 'translateY(0)';
    });

    // Auto-dismiss after 8 seconds
    setTimeout(() => {
      if (toast.parentElement) {
        toast.style.opacity = '0';
        toast.style.transform = 'translateY(10px)';
        setTimeout(() => toast.remove(), 300);
      }
    }, 8000);
  }

  /**
   * Clear the cache (e.g., when user updates keys in portal).
   */
  function invalidateCache() {
    cache = {};
    toastShownForOrgs.clear();
  }

  // Listen for org changes — reset toast tracking for new org
  if (typeof window !== 'undefined') {
    window.addEventListener('jt-org-changed', () => {
      // Don't clear cache — the new org might already be cached.
      // Toast tracking resets per-org naturally via the Set.
    });
  }

  return { getGrantKey, invalidateCache, getFallbackGrantKey };
})();

window.GrantKeyResolver = GrantKeyResolver;
```

**Step 2: Commit**

```bash
git add JT-Tools-Master/services/grant-key-resolver.js
git commit -m "feat(extension): add GrantKeyResolver with caching and toast notifications"
```

---

### Task 6: Extension — Service worker message handler

**Files:**
- Modify: `JT-Tools-Master/background/service-worker.js` — add `FETCH_EXTENSION_GRANT_KEY` handler

**Step 1: Add the message handler**

In the `switch (message.type)` block (around line 112), add a new case before `default:`:

```javascript
      case 'FETCH_EXTENSION_GRANT_KEY':
        // Fetch extension grant key from server for a specific org
        handleFetchExtensionGrantKey(message.orgName)
          .then(result => {
            sendResponse(result);
          })
          .catch(error => {
            console.error('Failed to fetch extension grant key:', error);
            sendResponse({ success: false, error: error.message });
          });
        return true; // Keep channel open for async response
```

**Step 2: Add the handler function**

Add after the existing helper functions (after `isAllowedApiUrl`, around line 220+):

```javascript
/**
 * Fetch an extension grant key from the server for a specific org name.
 * Uses the portal JWT access token for authentication.
 * @param {string} orgName - Organization name to look up
 * @returns {Promise<Object>} { success, grantKey, orgId, orgName } or { success: false, error }
 */
async function handleFetchExtensionGrantKey(orgName) {
  if (!orgName) {
    return { success: false, error: 'orgName is required' };
  }

  try {
    // Get the portal access token from local storage
    const stored = await chrome.storage.local.get(['jtAccountAccessToken']);
    const accessToken = stored.jtAccountAccessToken;

    if (!accessToken) {
      return { success: false, error: 'Not authenticated — sign in to the portal first' };
    }

    const response = await fetch('https://jobtread-mcp-server.king0light-ai.workers.dev/api/extension-grant-key', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${accessToken}`,
      },
      body: JSON.stringify({ orgName }),
    });

    const data = await response.json();

    if (!response.ok) {
      return { success: false, error: data.error || 'Server error' };
    }

    return {
      success: true,
      grantKey: data.grantKey,
      orgId: data.orgId,
      orgName: data.orgName,
    };
  } catch (error) {
    console.error('Extension grant key fetch error:', error);
    return { success: false, error: error.message };
  }
}
```

**Step 3: Commit**

```bash
git add JT-Tools-Master/background/service-worker.js
git commit -m "feat(extension): add FETCH_EXTENSION_GRANT_KEY service worker handler"
```

---

### Task 7: Extension — Update manifest.json and content.js

**Files:**
- Modify: `JT-Tools-Master/manifest.json` — add org-detector.js and grant-key-resolver.js to content_scripts
- Modify: `JT-Tools-Master/content.js` — init OrgDetector on startup

**Step 1: Update manifest.json**

Add the two new scripts to the `content_scripts.js` array. Insert them after the services block and before features:

- `utils/org-detector.js` — after `utils/debounce.js` (line 43), before `config/worker-config.js`
- `services/grant-key-resolver.js` — after `services/jobtread-api.js` (line 47), before drag-drop modules

The insertion order matters:
1. `utils/org-detector.js` goes with the other utils (after debounce.js, line 43)
2. `services/grant-key-resolver.js` goes after `services/jobtread-api.js` (line 47)

**Step 2: Update content.js**

In the IIFE at the bottom of content.js (the `(async function() { ... })()` block, around line 483), add OrgDetector init right after `loadSettings()` and before `waitForFeatures()`:

```javascript
  // Initialize OrgDetector for multi-org grant key resolution
  if (window.OrgDetector) {
    window.OrgDetector.init();
  }
```

**Step 3: Commit**

```bash
git add JT-Tools-Master/manifest.json JT-Tools-Master/content.js
git commit -m "feat(extension): wire OrgDetector and GrantKeyResolver into manifest and content.js"
```

---

### Task 8: Extension — Migrate services to use GrantKeyResolver

**Files:**
- Modify: `JT-Tools-Master/services/jobtread-api.js` — update `getApiKey()` to try GrantKeyResolver first
- Modify: `JT-Tools-Master/services/jobtread-pro-service.js` — update `getGrantKey()` to try GrantKeyResolver first
- Modify: `JT-Tools-Master/services/account-service.js` — update `getGrantKey()` to try GrantKeyResolver first

**Important:** Each service keeps its existing fallback logic. GrantKeyResolver is tried first; if it returns null or fails, the service falls back to its legacy storage key. This ensures zero-friction migration for existing single-org users.

**Step 1: Update JobTreadAPI.getApiKey()**

In `jobtread-api.js`, modify the `getApiKey()` function (line 102):

```javascript
  async function getApiKey() {
    try {
      // Try multi-org resolver first
      if (window.GrantKeyResolver) {
        const resolved = await window.GrantKeyResolver.getGrantKey();
        if (resolved) return resolved;
      }
      // Fallback to legacy single-key storage
      const result = await chrome.storage.sync.get(STORAGE_KEYS.API_KEY);
      return result[STORAGE_KEYS.API_KEY] || null;
    } catch (error) {
      if (DEBUG) console.error('JobTreadAPI: Error getting API key:', error);
      return null;
    }
  }
```

**Step 2: Update JobTreadProService.getGrantKey()**

In `jobtread-pro-service.js`, modify the `getGrantKey()` function (line 86). The key difference: GrantKeyResolver returns plaintext, but the legacy path returns obfuscated. The existing callers handle deobfuscation, so we need to return plaintext from the resolver path and let the legacy path keep its existing behavior:

```javascript
  async function getGrantKey() {
    try {
      // Try multi-org resolver first (returns plaintext)
      if (window.GrantKeyResolver) {
        const resolved = await window.GrantKeyResolver.getGrantKey();
        if (resolved) return resolved;
      }
      // Fallback to legacy obfuscated storage
      const result = await chrome.storage.local.get([
        STORAGE_KEYS.GRANT_KEY,
        STORAGE_KEYS.GRANT_KEY_VERSION
      ]);
      // ... rest of existing deobfuscation logic unchanged
```

**Note:** Only the first 4 lines change. The rest of the existing deobfuscation/migration logic stays.

**Step 3: Update AccountService.getGrantKey()**

In `account-service.js`, modify the `getGrantKey()` function (line 407):

```javascript
  async function getGrantKey() {
    try {
      // Try multi-org resolver first
      if (window.GrantKeyResolver) {
        const resolved = await window.GrantKeyResolver.getGrantKey();
        if (resolved) return resolved;
      }
      // Fallback to legacy storage
      const stored = await chrome.storage.local.get(['jtAccountGrantKey']);
      return stored.jtAccountGrantKey || null;
    } catch (error) {
      logError('Error getting grant key', error);
      return null;
    }
  }
```

**Step 4: Commit**

```bash
git add JT-Tools-Master/services/jobtread-api.js JT-Tools-Master/services/jobtread-pro-service.js JT-Tools-Master/services/account-service.js
git commit -m "feat(extension): migrate services to use GrantKeyResolver with legacy fallback"
```

---

### Task 9: Portal — New "Extension" tab in dashboard

**Files:**
- Modify: `portal/dashboard.html` — add sidebar item + section + JS functions

**Step 1: Add sidebar item**

After the "AI & MCP" sidebar item (around line 31-34), add:

```html
        <li class="sidebar-item" data-section="extension" id="sidebarExtension" style="display: none;">
          <span class="sidebar-icon">🧩</span>
          Extension
        </li>
```

**Step 2: Add the Extension section**

After `</div><!-- end #section-mcp -->` (around line 355), add:

```html
      <!-- ════════ EXTENSION SECTION ════════ -->
      <div class="dashboard-section" id="section-extension">
        <div class="card">
          <div class="card-header">
            <h3>Extension Grant Keys</h3>
          </div>
          <p style="font-size: 13px; color: var(--text-dim); margin-bottom: 16px;">
            Add a grant key for each JobTread organization you use. The extension will automatically use the correct key when you switch orgs.
          </p>

          <!-- Existing Keys List -->
          <div id="extKeysList" style="display: flex; flex-direction: column; gap: 8px; margin-bottom: 16px;"></div>

          <!-- Add Key Form -->
          <div style="background: var(--bg-input); border: 1px solid var(--border-light); border-radius: var(--radius-sm); padding: 14px;">
            <p style="font-size: 13px; font-weight: 600; margin: 0 0 8px;">Add Organization</p>
            <div style="display: flex; gap: 8px; flex-wrap: wrap; margin-bottom: 8px;">
              <input type="text" id="extKeyLabelInput" placeholder="Label (optional)" style="flex: 1; min-width: 120px; padding: 8px 12px; border-radius: var(--radius-sm); border: 1px solid var(--border-light); background: var(--bg-card); color: var(--text); font-size: 13px;">
              <input type="text" id="extKeyNewInput" placeholder="Grant Key" style="flex: 2; min-width: 200px; padding: 8px 12px; border-radius: var(--radius-sm); border: 1px solid var(--border-light); background: var(--bg-card); color: var(--text); font-size: 13px;">
              <button class="btn btn-primary btn-sm" id="addExtKeyBtn" onclick="addExtensionKey()">
                <span class="btn-text">Add</span>
                <span class="loading-text"><span class="spinner"></span></span>
              </button>
            </div>
            <div id="addExtKeyAlert" class="hidden" style="padding: 8px 12px; border-radius: var(--radius-sm); font-size: 12px; margin-top: 8px;"></div>
          </div>
        </div>
      </div><!-- end #section-extension -->
```

**Step 3: Add JS functions in the script block**

Add alongside the existing `loadAiKeys()`, `addAiKey()`, `removeAiKey()` functions:

```javascript
    // ─── Extension Keys ─────────────────────────────────────

    async function loadExtensionKeys() {
      const container = document.getElementById('extKeysList');
      try {
        const data = await api.post('/admin/extension-keys/list');
        const keys = data.keys || [];
        if (keys.length === 0) {
          container.innerHTML = '<p style="font-size: 13px; color: var(--text-dim);">No extension keys added yet. Add one below to connect an organization.</p>';
          return;
        }
        container.innerHTML = keys.map(k => `
          <div style="padding: 12px 14px; background: var(--bg-input); border: 1px solid var(--border-light); border-radius: var(--radius-sm); display: flex; justify-content: space-between; align-items: center;">
            <div>
              <div style="font-weight: 600; font-size: 14px;">${escapeHtml(k.orgName || k.label)}</div>
              <div style="font-size: 12px; color: var(--text-dim); margin-top: 2px;">
                <span style="font-family: monospace;">${escapeHtml(k.maskedKey || '')}</span>
                ${k.label && k.label !== k.orgName ? ' · <span>' + escapeHtml(k.label) + '</span>' : ''}
              </div>
            </div>
            <button class="btn btn-ghost btn-sm" onclick="removeExtensionKey('${escapeHtml(k.id)}', '${escapeHtml(k.orgName || k.label)}')" style="color: #ef4444; flex-shrink: 0;">Remove</button>
          </div>
        `).join('');
      } catch (err) {
        container.innerHTML = '<p style="color: #ef4444; font-size: 13px;">Failed to load extension keys: ' + escapeHtml(err.message) + '</p>';
      }
    }

    async function addExtensionKey() {
      const btn = document.getElementById('addExtKeyBtn');
      const labelInput = document.getElementById('extKeyLabelInput');
      const keyInput = document.getElementById('extKeyNewInput');
      const alertEl = document.getElementById('addExtKeyAlert');
      const label = labelInput.value.trim();
      const grantKey = keyInput.value.trim();

      if (!grantKey) { showInlineAlert(alertEl, 'Please enter a Grant Key', 'error'); return; }

      btn.classList.add('loading');
      try {
        const data = await api.post('/admin/extension-keys/add', { grantKey, label: label || undefined });
        showInlineAlert(alertEl, `Added ${data.key.orgName || label || 'organization'}`, 'success');
        labelInput.value = '';
        keyInput.value = '';
        await loadExtensionKeys();
      } catch (err) {
        showInlineAlert(alertEl, err.message || 'Failed to add key', 'error');
      } finally {
        btn.classList.remove('loading');
      }
    }

    async function removeExtensionKey(keyId, name) {
      if (!confirm(`Remove extension key for "${name}"? The extension won't be able to make API calls for this org.`)) return;
      try {
        await api.post('/admin/extension-keys/remove', { keyId });
        await loadExtensionKeys();
      } catch (err) {
        alert('Failed to remove: ' + (err.message || 'Unknown error'));
      }
    }
```

**Step 4: Show the Extension tab for admins and load data**

In the admin initialization block (around line 551-560 where `sidebarMcp` is shown), add:

```javascript
          document.getElementById('sidebarExtension').style.display = '';
          // ... existing loadAdminData() call
          loadExtensionKeys();
```

And in the else block (non-admin), hide it:

```javascript
          document.getElementById('sidebarExtension').style.display = 'none';
```

**Step 5: Commit**

```bash
git add portal/dashboard.html
git commit -m "feat(portal): add Extension tab for per-org grant key management"
```

---

### Task 10: Deploy server and test

**Step 1: Deploy the Cloudflare Worker**

```bash
cd server/mcp-server && npx wrangler deploy
```

**Step 2: Verify migration applied**

```bash
npx wrangler d1 execute jt-power-tools-db --remote --command "SELECT name FROM sqlite_master WHERE type='table' AND name='extension_grant_keys'"
```

Expected: One row with `extension_grant_keys`.

**Step 3: Test endpoints manually**

```bash
# Test list (should return empty)
curl -X POST https://jobtread-mcp-server.king0light-ai.workers.dev/admin/extension-keys/list \
  -H "Authorization: Bearer <access_token>" \
  -H "Content-Type: application/json"

# Test add
curl -X POST https://jobtread-mcp-server.king0light-ai.workers.dev/admin/extension-keys/add \
  -H "Authorization: Bearer <access_token>" \
  -H "Content-Type: application/json" \
  -d '{"grantKey": "<test_grant_key>"}'
```

**Step 4: Commit any fixes**

---

### Task 11: Update CHANGELOG.md

**Files:**
- Modify: `CHANGELOG.md`

**Step 1: Add entries under [Unreleased]**

```markdown
## [Unreleased]

### Added
#### Multi-Org Extension Grant Keys
- Added per-org grant key management in portal Extension tab
- Added OrgDetector module that watches the JT search bar to detect active organization
- Added GrantKeyResolver service with 5-minute cache and automatic server lookup
- Added toast notification when switching to an org with no configured key
- Extension services (JobTreadAPI, JobTreadProService, AccountService) now auto-resolve the correct grant key based on active org
- Added server endpoints for extension grant key CRUD and lookup
- Added `extension_grant_keys` D1 table for per-org key storage
- Full backward compatibility — single-org users continue working without changes
```

**Step 2: Commit**

```bash
git add CHANGELOG.md
git commit -m "docs: add multi-org extension grant keys to CHANGELOG"
```

---

## Edge Cases & Notes

- **Fallback chain**: GrantKeyResolver → server lookup → legacy storage keys. Existing single-org users are unaffected.
- **Case-insensitive org matching**: Server uses `LOWER()` on both sides of the org_name comparison.
- **Toast dedup**: `toastShownForOrgs` Set prevents spamming toasts on repeated API calls for the same unregistered org.
- **Tab isolation**: Each tab has its own OrgDetector + GrantKeyResolver instances (in-memory). Different tabs can show different orgs correctly.
- **Service worker auth**: Uses the portal JWT (`jtAccountAccessToken`). Users must be signed in to the portal for multi-org to work. Falls back to legacy if not.
- **No popup UI changes**: Keys are managed in the portal, not the extension popup. The extension resolves keys automatically.
