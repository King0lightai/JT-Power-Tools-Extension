# Extension Sign-In Flow Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Rewire the extension's existing AccountService to authenticate against the portal API so users sign in with email/password and get their license tier, grant key, and org info automatically.

**Architecture:** The extension already has AccountService (JWT auth), account UI forms (login/register/forgot-password), and LicenseService (tier gating). The main work is: (1) change API_URL to portal, (2) adapt response format (portal uses flat JSON, not `{success, data}` wrapper), (3) add grant key to login response on the server, (4) add migration banner for legacy users, (5) add "Manage Team" link for owners/admins.

**Tech Stack:** Chrome Extension (Manifest V3), Cloudflare Workers (portal API), JWT auth

---

### Task 1: Update Portal Login Response to Include Grant Key

The extension's `storeAuthData()` expects `data.grantKey` and `data.licenseKey` on the login/register responses. The portal currently returns `licenseKey` on the `user` object but doesn't include the org's `grant_key_encrypted` in the response.

**Files:**
- Modify: `server/mcp-server/src/portal-auth.js` (login handler ~line 392, register handler ~line 323)

**Step 1: Add grant key to login response**

In `handleLogin()`, after fetching the license (line 373), the response at line 392 needs `grantKey` added:

```javascript
return jsonRes({
    accessToken,
    refreshToken,
    expiresIn: ACCESS_TOKEN_TTL,
    user: {
      id: account.id,
      email: account.email,
      displayName: account.display_name,
      role: account.role,
      tier,
      orgName: license.org_name,
      orgId: license.org_id,
      licenseKey: license.license_key,
    },
    grantKey: license.grant_key_encrypted || null,
  });
```

Do the same for `handleRegister()` response at line 323 — add `grantKey: null` (new accounts won't have a grant key yet).

Also update `handleRefresh()` and `handleMe()` to include `grantKey` from the license row.

**Step 2: Deploy worker**

```bash
cd server/mcp-server && npx wrangler deploy
```

**Step 3: Verify with curl**

```bash
curl -s -X POST https://jobtread-mcp-server.king0light-ai.workers.dev/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"zee@tituscontracting.com","password":"YOUR_PASSWORD"}' | jq '.grantKey'
```

Expected: grant key value or null

**Step 4: Commit**

```bash
git add server/  # server is gitignored, just deploy
```

---

### Task 2: Adapt AccountService to Portal API

The AccountService currently points at `jt-tools-license-proxy` and expects `{success: true, data: {...}}` response format. The portal API returns flat JSON: `{accessToken, refreshToken, user, ...}` on success, and `{error: "..."}` on failure (with non-200 status).

**Files:**
- Modify: `JT-Tools-Master/services/account-service.js`

**Step 1: Change API_URL (line 18)**

```javascript
// Old:
const API_URL = 'https://jt-tools-license-proxy.king0light-ai.workers.dev';
// New:
const API_URL = 'https://jobtread-mcp-server.king0light-ai.workers.dev';
```

**Step 2: Update `login()` (line 172) response handling**

Portal returns flat JSON, not wrapped in `{success, data}`:

```javascript
async function login(email, password) {
    try {
      const response = await fetch(`${API_URL}/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password })
      });

      const result = await response.json();

      if (response.ok) {
        // Portal returns flat: { accessToken, refreshToken, expiresIn, user, grantKey }
        await storeAuthData(result);
        log('Login successful');
        return { success: true, data: result };
      } else {
        logError('Login failed', result.error);
        return { success: false, error: result.error || 'Login failed' };
      }
    } catch (error) {
      logError('Login error', error);
      return { success: false, error: 'Network error. Please try again.' };
    }
  }
```

**Step 3: Update `register()` (line 142) similarly**

Portal `/auth/register` expects `{ email, password, displayName, licenseKey, inviteToken }` (no setupToken):

```javascript
async function register(email, password, displayName, licenseKey, inviteToken) {
    try {
      const body = { email, password, displayName };
      if (inviteToken) body.inviteToken = inviteToken;
      else if (licenseKey) body.licenseKey = licenseKey;

      const response = await fetch(`${API_URL}/auth/register`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
      });

      const result = await response.json();

      if (response.ok) {
        await storeAuthData(result);
        log('Registration successful');
        return { success: true, data: result };
      } else {
        logError('Registration failed', result.error);
        return { success: false, error: result.error || 'Registration failed' };
      }
    } catch (error) {
      logError('Registration error', error);
      return { success: false, error: 'Network error. Please try again.' };
    }
  }
```

**Step 4: Update `refreshAccessToken()` (line 200)**

Portal `/auth/refresh` expects `{ refreshToken }`, returns `{ accessToken, expiresIn, user }`:

```javascript
const response = await fetch(`${API_URL}/auth/refresh`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ refreshToken })
  });

  const result = await response.json();

  if (response.ok) {
    accessToken = result.accessToken;
    tokenExpiry = Date.now() + (result.expiresIn * 1000);
    if (result.user) {
      currentUser = result.user;
    }
    // ... store updated tokens
  }
```

**Step 5: Update forgot password endpoint path**

Portal uses `/auth/forgot` not `/auth/forgot-password`:

```javascript
// Old (line ~1023):
const response = await fetch(`${API_URL}/auth/forgot-password`, {
// New:
const response = await fetch(`${API_URL}/auth/forgot`, {
```

**Step 6: Update reset password endpoint path**

Portal uses `/auth/reset` not `/auth/reset-password`:

```javascript
// Old (line ~1064):
const response = await fetch(`${API_URL}/auth/reset-password`, {
// New:
const response = await fetch(`${API_URL}/auth/reset`, {
```

**Step 7: Remove `requestSetupToken()` (lines 112-133)**

The portal doesn't use setup tokens. Registration is direct. Remove this method and update any callers.

**Step 8: Update `storeAuthData()` to handle portal response format**

The portal returns `grantKey` at top level and `licenseKey` on the `user` object:

```javascript
async function storeAuthData(data) {
    accessToken = data.accessToken;
    refreshToken = data.refreshToken;
    currentUser = data.user;
    tokenExpiry = Date.now() + (data.expiresIn * 1000);

    await chrome.storage.local.set({
      [STORAGE_KEYS.ACCESS_TOKEN]: accessToken,
      [STORAGE_KEYS.REFRESH_TOKEN]: refreshToken,
      [STORAGE_KEYS.USER_DATA]: currentUser,
      [STORAGE_KEYS.TOKEN_EXPIRY]: tokenExpiry
    });

    // Store grant key if provided by org admin
    if (data.grantKey) {
      await chrome.storage.local.set({ jtAccountGrantKey: data.grantKey });
      // Auto-register with Pro Service
      if (window.JobTreadProService) {
        try {
          await window.JobTreadProService.verifyOrgAccess(data.grantKey);
        } catch (err) { logError('Pro auto-reg error:', err); }
      }
    }

    // Sync license key from portal
    if (data.user?.licenseKey && window.LicenseService) {
      await window.LicenseService.verifyLicense(data.user.licenseKey);
    }
  }
```

**Step 9: Commit**

```bash
git add JT-Tools-Master/services/account-service.js
git commit -m "feat: Update AccountService to use portal API

- Changed API_URL to portal (jobtread-mcp-server)
- Adapted response handling for flat JSON format
- Updated register() to use direct registration (no setup token)
- Fixed forgot/reset password endpoint paths
- Grant key now synced from portal on login"
```

---

### Task 3: Update Popup Registration Flow

The popup's register handler currently requires a setupToken flow. Update it to pass licenseKey directly to the new `register()` signature.

**Files:**
- Modify: `JT-Tools-Master/popup/popup.js` — registration handler (~line 2267-2557)

**Step 1: Find the register button handler**

Look for where `AccountService.register(setupToken, email, password, displayName)` is called and change to:

```javascript
const result = await AccountService.register(email, password, displayName, licenseKey);
```

Where `licenseKey` comes from `LicenseService.getStoredKey()` or the license input.

**Step 2: Remove setupToken request flow**

Remove any calls to `AccountService.requestSetupToken()` in popup.js since we removed that method.

**Step 3: Update forgot password response handling**

Portal `/auth/forgot` returns `{ message: "..." }` not `{ success: true }`. Update the handler to check `response.ok`.

**Step 4: Commit**

```bash
git add JT-Tools-Master/popup/popup.js
git commit -m "fix: Update popup registration to use direct portal register"
```

---

### Task 4: Add Migration Banner for Legacy Users

Show a dismissable banner for users who have a license key stored but haven't signed into the portal.

**Files:**
- Modify: `JT-Tools-Master/popup/popup.html` — add banner HTML in license section
- Modify: `JT-Tools-Master/popup/popup.js` — show/hide logic
- Modify: `JT-Tools-Master/popup/popup.css` — banner styles

**Step 1: Add banner HTML after the license panel div**

```html
<!-- Migration Banner (shown for legacy license users) -->
<div class="migration-banner" id="migrationBanner" style="display: none;">
  <div class="migration-content">
    <i class="ph ph-sparkle"></i>
    <div>
      <strong>NEW: Manage your team online</strong>
      <p>Sign in to invite team members, manage grant keys, and more.</p>
    </div>
    <button class="btn-small btn-primary" id="migrationSignInBtn">Sign In</button>
    <button class="migration-dismiss" id="migrationDismiss" title="Dismiss">
      <i class="ph ph-x"></i>
    </button>
  </div>
</div>
```

**Step 2: Add banner display logic in popup.js**

In `updateAccountUI()`, add check:

```javascript
// Show migration banner if user has license but no portal account
if (LicenseService.hasValidLicense() && !AccountService.isLoggedIn()) {
  const dismissed = sessionStorage.getItem('migrationBannerDismissed');
  if (!dismissed) {
    document.getElementById('migrationBanner').style.display = '';
  }
}
```

Wire up dismiss button:
```javascript
document.getElementById('migrationDismiss')?.addEventListener('click', () => {
  document.getElementById('migrationBanner').style.display = 'none';
  sessionStorage.setItem('migrationBannerDismissed', 'true');
});
```

Wire up sign-in button to show login form:
```javascript
document.getElementById('migrationSignInBtn')?.addEventListener('click', () => {
  showAccountForm('login');
  document.getElementById('migrationBanner').style.display = 'none';
});
```

**Step 3: Add CSS styles**

```css
.migration-banner {
  background: linear-gradient(135deg, rgba(254, 76, 13, 0.08), rgba(255, 107, 53, 0.05));
  border: 1px solid rgba(254, 76, 13, 0.2);
  border-radius: 10px;
  padding: 12px 16px;
  margin: 12px 0;
}
.migration-content {
  display: flex;
  align-items: center;
  gap: 10px;
}
.migration-content i.ph-sparkle { color: #fe4c0d; font-size: 20px; flex-shrink: 0; }
.migration-content div { flex: 1; }
.migration-content strong { font-size: 13px; color: var(--text-primary); }
.migration-content p { font-size: 11px; color: var(--text-secondary); margin: 2px 0 0; }
.migration-dismiss {
  background: none; border: none; color: var(--text-tertiary);
  cursor: pointer; padding: 4px; font-size: 16px;
}
```

**Step 4: Commit**

```bash
git add JT-Tools-Master/popup/popup.html JT-Tools-Master/popup/popup.js JT-Tools-Master/popup/popup.css
git commit -m "feat: Add migration banner for legacy license key users"
```

---

### Task 5: Add "Manage Team" Link for Owners/Admins

When a user is signed in via the portal, show a "Manage Team" link that opens the portal dashboard. Only visible to owners and admins.

**Files:**
- Modify: `JT-Tools-Master/popup/popup.html` — add link in account-logged-in card
- Modify: `JT-Tools-Master/popup/popup.js` — conditionally show based on role

**Step 1: Add link HTML in the account-logged-in div**

After the sync-status div, add:

```html
<a href="https://app.jtpowertools.com/dashboard.html" target="_blank"
   id="manageTeamLink" class="manage-team-link" style="display: none;">
  <i class="ph ph-users-three"></i> Manage Team <i class="ph ph-arrow-square-out"></i>
</a>
```

**Step 2: Show/hide based on role in `updateAccountUI()`**

```javascript
const manageLink = document.getElementById('manageTeamLink');
if (manageLink && user.role && (user.role === 'owner' || user.role === 'admin')) {
  manageLink.style.display = '';
} else if (manageLink) {
  manageLink.style.display = 'none';
}
```

**Step 3: Add CSS**

```css
.manage-team-link {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 8px 12px;
  margin-top: 8px;
  background: var(--bg-tertiary);
  border: 1px solid var(--border-subtle);
  border-radius: 8px;
  color: var(--text-secondary);
  text-decoration: none;
  font-size: 13px;
  font-weight: 500;
  transition: all 0.15s ease;
}
.manage-team-link:hover {
  background: var(--bg-hover);
  color: var(--brand);
  border-color: rgba(254, 76, 13, 0.3);
}
```

**Step 4: Commit**

```bash
git add JT-Tools-Master/popup/popup.html JT-Tools-Master/popup/popup.js JT-Tools-Master/popup/popup.css
git commit -m "feat: Add 'Manage Team' link for owners/admins in popup"
```

---

### Task 6: Test Full Flow & Update CHANGELOG

**Step 1: Load extension in Chrome**

```
chrome://extensions → Developer mode → Load unpacked → JT-Tools-Master
```

**Step 2: Test sign-in flow**

- Open popup → toggle a premium feature → inline sign-in form should appear
- Enter portal credentials → should sign in, feature enables, account card shows
- Verify grant key auto-syncs from portal
- Verify tier badge shows correctly
- Verify "Manage Team" link shows for owner account

**Step 3: Test legacy flow**

- Clear extension storage
- Enter license key manually → should still work as before
- Migration banner should appear
- Click "Sign In" on banner → login form shows

**Step 4: Test sign-out**

- Click "Sign Out" → account card hides, features lock behind tier gate
- Legacy license key still works if present

**Step 5: Update CHANGELOG.md**

```markdown
### Added
#### Extension Sign-In Flow
- Added inline portal sign-in in popup for premium feature access
- Added migration banner for existing license key users
- Added "Manage Team" link for owners/admins (opens portal dashboard)
- Grant key auto-syncs from portal on sign-in (admin sets it once for the org)
- Portal auth takes priority over legacy license key when both present
```

**Step 6: Commit**

```bash
git add CHANGELOG.md
git commit -m "docs: Update CHANGELOG for extension sign-in flow"
```

---

### Task 7: Deploy Portal & Worker Updates

**Step 1: Deploy worker (if Task 1 changes aren't deployed yet)**

```bash
cd server/mcp-server && npx wrangler deploy
```

**Step 2: Deploy portal (no changes needed unless UI was updated)**

```bash
cd portal && npx wrangler pages deploy . --project-name jt-power-tools-portal
```

**Step 3: Verify MCP connection still works**

Test that existing MCP Bearer token auth still works after the worker deploy.
