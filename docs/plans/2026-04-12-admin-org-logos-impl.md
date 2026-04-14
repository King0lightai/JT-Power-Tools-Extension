# Admin Org Logos — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Move org logo configuration from per-user extension popup to admin-managed portal, stored alongside extension grant keys.

**Architecture:** Add `logo_url` column to `extension_grant_keys` table. Admin sets it in the portal Extension tab. The existing `/admin/extension-grant-key` lookup returns it to the extension. `OrgLogoFeature` reads from the grant key resolver instead of `chrome.storage.sync`. Per-user config UI removed from popup.

**Tech Stack:** Cloudflare Workers, D1 (SQLite), Chrome Extension APIs

---

### Task 1: Database Migration

**Files:**
- Create: `server/mcp-server/migrations/014_extension_grant_keys_logo.sql`

**Step 1: Create migration file**

```sql
-- Migration 014: Add logo_url to extension_grant_keys
ALTER TABLE extension_grant_keys ADD COLUMN logo_url TEXT;
```

**Step 2: Apply migration**

```bash
cd server/mcp-server
npx wrangler d1 execute jobtread-extension-users --remote --file=migrations/014_extension_grant_keys_logo.sql
```

**Step 3: Commit**

```bash
git add server/mcp-server/migrations/014_extension_grant_keys_logo.sql
git commit -m "feat(server): add logo_url column to extension_grant_keys"
```

---

### Task 2: Update Server Endpoints

**Files:**
- Modify: `server/mcp-server/src/admin.js`

**Step 1: Update `handleAddExtensionKey` to accept `logoUrl`**

In `handleAddExtensionKey()`, update the INSERT statement to include `logo_url`. The function currently has:

```javascript
await env.DB.prepare(
  'INSERT INTO extension_grant_keys (id, license_id, label, org_id, org_name, grant_key_encrypted) VALUES (?, ?, ?, ?, ?, ?)'
).bind(id, account.license_id, label, grantResult.orgId, grantResult.orgName, body.grantKey).run();
```

Change to:

```javascript
const logoUrl = body.logoUrl?.trim() || null;
await env.DB.prepare(
  'INSERT INTO extension_grant_keys (id, license_id, label, org_id, org_name, grant_key_encrypted, logo_url) VALUES (?, ?, ?, ?, ?, ?, ?)'
).bind(id, account.license_id, label, grantResult.orgId, grantResult.orgName, body.grantKey, logoUrl).run();
```

And add `logoUrl` to the response:

```javascript
return jsonRes({
  message: 'Extension grant key added',
  key: {
    id,
    label,
    orgId: grantResult.orgId,
    orgName: grantResult.orgName,
    maskedKey: body.grantKey.slice(0, 8) + '••••••••',
    logoUrl,
  },
});
```

**Step 2: Add `handleUpdateExtensionKeyLogo` endpoint**

Add a new handler for updating the logo URL on an existing key (since keys are already created, admins need a way to set/change the logo without re-adding the key):

```javascript
/**
 * POST /admin/extension-keys/update-logo — Update logo URL for an extension key
 * Body: { keyId, logoUrl }
 */
export async function handleUpdateExtensionKeyLogo(request, env) {
  const { account, error } = await requireAdmin(request, env);
  if (error) return error;

  const body = await parseJsonBody(request);
  if (!body?.keyId) {
    return jsonRes({ error: 'keyId is required' }, 400);
  }

  const logoUrl = body.logoUrl?.trim() || null;

  const result = await env.DB.prepare(
    'UPDATE extension_grant_keys SET logo_url = ?, updated_at = strftime(\'%s\', \'now\') WHERE id = ? AND license_id = ?'
  ).bind(logoUrl, body.keyId, account.license_id).run();

  if (!result.meta.changes) {
    return jsonRes({ error: 'Key not found' }, 404);
  }

  return jsonRes({ message: 'Logo updated', logoUrl });
}
```

Register it in the route switch statement alongside the other extension-keys routes:

```javascript
case '/admin/extension-keys/update-logo':
  return await handleUpdateExtensionKeyLogo(request, env);
```

**Step 3: Update `handleListExtensionKeys` to include `logo_url`**

Update the SELECT query to include `logo_url`:

```javascript
const rows = await env.DB.prepare(
  'SELECT id, label, org_id, org_name, grant_key_encrypted, logo_url, created_at FROM extension_grant_keys WHERE license_id = ? ORDER BY created_at ASC'
).bind(account.license_id).all();
```

And add it to the mapped response:

```javascript
const keys = (rows.results || []).map(k => ({
  id: k.id,
  label: k.label,
  orgId: k.org_id,
  orgName: k.org_name,
  maskedKey: k.grant_key_encrypted ? k.grant_key_encrypted.slice(0, 8) + '••••••••' : null,
  logoUrl: k.logo_url || null,
  createdAt: k.created_at,
}));
```

**Step 4: Update `handleExtensionGrantKeyLookup` to include `logo_url`**

Update the SELECT:

```javascript
const key = await env.DB.prepare(
  'SELECT org_id, org_name, grant_key_encrypted, logo_url FROM extension_grant_keys WHERE license_id = ? AND LOWER(org_name) = LOWER(?)'
).bind(account.license_id, body.orgName.trim()).first();
```

And the response:

```javascript
return jsonRes({
  grantKey: key.grant_key_encrypted,
  orgId: key.org_id,
  orgName: key.org_name,
  logoUrl: key.logo_url || null,
});
```

**Step 5: Deploy and commit**

```bash
cd server/mcp-server
npx wrangler deploy
```

```bash
git add server/mcp-server/src/admin.js
git commit -m "feat(server): add logo_url to extension grant key endpoints"
```

---

### Task 3: Update Portal Admin UI

**Files:**
- Modify: The portal frontend (likely `app.jtpowertools.com` — check where the Extension tab renders)

**Context:** The portal admin UI renders an Extension tab with a list of per-org grant keys and add/remove buttons. We need to add a logo URL field per row.

**Step 1: Find the Extension tab component**

The portal is at `app.jtpowertools.com`. Search the portal frontend code for the Extension tab that renders the grant key list. Look for references to `/admin/extension-keys/list` or the `ExtensionKeys` component.

**Step 2: Add logo URL input per org row**

For each org key row, add:
- A text input for the logo URL (placeholder: "Logo image URL")
- A small thumbnail preview (32x32px) next to it
- Save on blur or with a save button — calls `POST /admin/extension-keys/update-logo` with `{ keyId, logoUrl }`

**Step 3: Also accept logo URL during "Add Key" flow**

When adding a new extension key, include an optional logo URL field that gets passed as `logoUrl` in the request body.

**Step 4: Commit**

```bash
git commit -m "feat(portal): add logo URL field to Extension tab"
```

---

### Task 4: Update Extension — Service Worker & Grant Key Resolver

**Files:**
- Modify: `JT-Tools-Master/background/service-worker.js` (~line 370)
- Modify: `JT-Tools-Master/services/grant-key-resolver.js`

**Step 1: Update service worker response to include `logoUrl`**

In `handleFetchExtensionGrantKey()`, the success return already maps server fields. Add `logoUrl`:

```javascript
return {
  success: true,
  grantKey: data.grantKey,
  orgId: data.orgId,
  orgName: data.orgName,
  logoUrl: data.logoUrl || null,
};
```

**Step 2: Update GrantKeyResolver to expose `logoUrl`**

The resolver caches the full response. Add a `getLogoUrl()` method that returns the cached logo URL for the current org:

In `grant-key-resolver.js`, after the existing `getGrantKey()` function, add:

```javascript
/**
 * Get the logo URL for the current org (from cached grant key response).
 * Returns null if no logo is set or no cached data exists.
 */
async function getLogoUrl() {
  const orgName = window.OrgDetector ? window.OrgDetector.getActiveOrg() : null;
  if (!orgName) return null;

  const cacheKey = `_gkr_${orgName}`;
  const stored = await chrome.storage.local.get([cacheKey]);
  const cached = stored[cacheKey];

  if (cached && cached.expiry > Date.now() && cached.logoUrl !== undefined) {
    return cached.logoUrl;
  }

  // If not cached, trigger a fetch (which will cache the result including logoUrl)
  await getGrantKey();

  // Re-read cache
  const refreshed = await chrome.storage.local.get([cacheKey]);
  const refreshedCache = refreshed[cacheKey];
  return refreshedCache?.logoUrl || null;
}
```

Update the cache write inside `getGrantKey()` to include `logoUrl`. Find where the cache is written (the `chrome.storage.local.set` call after a successful fetch) and add `logoUrl` from the response:

```javascript
// Current cache write (approximate):
await chrome.storage.local.set({
  [cacheKey]: {
    grantKey: result.grantKey,
    orgId: result.orgId,
    orgName: result.orgName,
    expiry: Date.now() + CACHE_TTL
  }
});

// Updated:
await chrome.storage.local.set({
  [cacheKey]: {
    grantKey: result.grantKey,
    orgId: result.orgId,
    orgName: result.orgName,
    logoUrl: result.logoUrl || null,
    expiry: Date.now() + CACHE_TTL
  }
});
```

Export `getLogoUrl` in the module return:

```javascript
window.GrantKeyResolver = {
  getGrantKey,
  getLogoUrl,
  invalidateCache,
};
```

**Step 3: Commit**

```bash
git add JT-Tools-Master/background/service-worker.js JT-Tools-Master/services/grant-key-resolver.js
git commit -m "feat(extension): pass logoUrl through grant key resolver"
```

---

### Task 5: Rewrite OrgLogoFeature

**Files:**
- Modify: `JT-Tools-Master/features/org-logo.js`

**Step 1: Rewrite to use GrantKeyResolver instead of chrome.storage.sync**

Replace the entire feature module. The new version:
- Reads logo URL from `GrantKeyResolver.getLogoUrl()` instead of `chrome.storage.sync`
- No storage listener (cache invalidation handled by resolver)
- Same DOM logic (find switcher, replace SVGs, inject img)
- MutationObserver still needed for SPA navigation

```javascript
/**
 * Org Logo Feature
 * Replaces the JT logo in the org switcher with admin-configured branding.
 * Logo URLs are managed in the portal and fetched via GrantKeyResolver.
 */
const OrgLogoFeature = (() => {
  let isActive = false;
  let observer = null;
  let currentLogoUrl = null;

  function init() {
    if (isActive) return;
    isActive = true;
    console.log('OrgLogo: Initializing...');

    applyLogo();

    observer = new MutationObserver(() => {
      if (isActive) applyLogo();
    });
    observer.observe(document.body, { childList: true, subtree: true });

    console.log('OrgLogo: Initialized');
  }

  async function applyLogo() {
    const switcher = findSwitcher();
    if (!switcher) return;

    // Get logo URL from grant key resolver (admin-configured)
    let logoUrl = null;
    if (window.GrantKeyResolver?.getLogoUrl) {
      try {
        logoUrl = await window.GrantKeyResolver.getLogoUrl();
      } catch (e) {
        console.error('OrgLogo: Failed to get logo URL:', e);
      }
    }

    const svgs = switcher.querySelectorAll('svg');

    if (!logoUrl) {
      // No admin logo configured — show default SVGs
      removeLogo(switcher);
      svgs.forEach(svg => svg.style.display = '');
      currentLogoUrl = null;
      return;
    }

    // Skip if same logo already applied
    if (logoUrl === currentLogoUrl) {
      const existing = switcher.querySelector('.jt-org-logo');
      if (existing) return;
    }

    // Hide default SVGs
    svgs.forEach(svg => svg.style.display = 'none');

    // Create or update logo image
    let img = switcher.querySelector('.jt-org-logo');
    if (!img) {
      img = document.createElement('img');
      img.className = 'jt-org-logo';
      img.style.cssText = 'height: 32px; max-width: 160px; object-fit: contain;';
      img.onerror = () => {
        // Image failed to load — restore default SVGs
        console.warn('OrgLogo: Image failed to load:', logoUrl);
        img.remove();
        svgs.forEach(svg => svg.style.display = '');
        currentLogoUrl = null;
      };
      switcher.prepend(img);
    }

    img.src = logoUrl;
    currentLogoUrl = logoUrl;
  }

  function findSwitcher() {
    // The org switcher is a div.relative.rounded-sm in the header
    const candidates = document.querySelectorAll('div.relative.rounded-sm');
    for (const el of candidates) {
      if (el.querySelector('svg') && el.closest('header, nav, [class*="header"]')) {
        return el;
      }
    }
    // Fallback: any div.relative.rounded-sm with SVGs (first match)
    for (const el of candidates) {
      if (el.querySelector('svg')) return el;
    }
    return null;
  }

  function removeLogo(container) {
    const img = (container || document).querySelector('.jt-org-logo');
    if (img) img.remove();
  }

  function cleanup() {
    if (!isActive) return;
    console.log('OrgLogo: Cleaning up...');

    if (observer) {
      observer.disconnect();
      observer = null;
    }

    // Remove injected logos and restore SVGs
    const switcher = findSwitcher();
    if (switcher) {
      removeLogo(switcher);
      switcher.querySelectorAll('svg').forEach(svg => svg.style.display = '');
    }

    currentLogoUrl = null;
    isActive = false;
    console.log('OrgLogo: Cleaned up');
  }

  return {
    init,
    cleanup,
    isActive: () => isActive
  };
})();

window.OrgLogoFeature = OrgLogoFeature;
```

**Step 2: Commit**

```bash
git add JT-Tools-Master/features/org-logo.js
git commit -m "feat(extension): rewrite OrgLogoFeature to use admin-managed logos from portal"
```

---

### Task 6: Remove Per-User Config from Popup

**Files:**
- Modify: `JT-Tools-Master/popup/popup.html` — remove org logo config panel
- Modify: `JT-Tools-Master/popup/popup.js` — remove `initOrgLogoConfig` IIFE

**Step 1: Remove config panel HTML from popup.html**

Remove the entire `orgLogoConfig` div (lines ~382-388):

```html
<!-- REMOVE THIS ENTIRE BLOCK -->
<div id="orgLogoConfig" style="display: none; padding: 12px 16px; border-top: 1px solid var(--border-color, #e5e7eb);">
  <h4 style="font-size: 13px; font-weight: 600; margin: 0 0 8px 0;">Organization Logos</h4>
  <p style="font-size: 11px; color: #6b7280; margin: 0 0 8px 0;">Paste an image URL for each org. The logo replaces the JT icon in the org switcher.</p>
  <div id="orgLogoInputs" style="display: flex; flex-direction: column; gap: 8px;"></div>
  <button id="addOrgLogoBtn" style="margin-top: 8px; padding: 4px 12px; font-size: 12px; border: 1px solid #d1d5db; border-radius: 4px; background: white; cursor: pointer;">+ Add Org</button>
</div>
```

Update the feature description to reflect admin management:

```html
<p>Replace the JT logo with your org's branding (set by admin in portal)</p>
```

**Step 2: Remove `initOrgLogoConfig` IIFE from popup.js**

Remove the entire IIFE block (lines ~2989-3087) that starts with:
```javascript
// ─── Org Logo Configuration ─────────────────────────────────────
(function initOrgLogoConfig() {
```
and ends with:
```javascript
})();
```

**Step 3: Clean up stale storage**

In the extension's init or service worker, add a one-time cleanup to remove the old `orgLogos` key from sync storage. Add this to the service worker's `onInstalled` handler:

```javascript
// Clean up legacy org logo config (now admin-managed in portal)
chrome.storage.sync.remove('orgLogos');
```

**Step 4: Commit**

```bash
git add JT-Tools-Master/popup/popup.html JT-Tools-Master/popup/popup.js JT-Tools-Master/background/service-worker.js
git commit -m "refactor(extension): remove per-user org logo config, now admin-managed"
```

---

### Task 7: Update CHANGELOG

**Files:**
- Modify: `CHANGELOG.md`

**Step 1: Add entries under [Unreleased]**

```markdown
### Changed
#### Org Logo — Admin-Managed
- Org logos are now set by admins in the portal Extension tab instead of per-user in the extension popup
- Logo URLs stored in `extension_grant_keys` table alongside per-org grant keys
- Extension fetches logo automatically via grant key resolver — no manual setup per user
- Removed per-user org logo configuration from extension popup (toggle remains for enable/disable)
```

**Step 2: Commit**

```bash
git add CHANGELOG.md
git commit -m "docs: add admin org logos to CHANGELOG"
```
