# Auto-Device Registration Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Automatically register a device with the Pro Worker when a user logs into their account, so Power User features work immediately without manual setup.

**Architecture:** After login, `storeAuthData()` already saves the grant key locally. We add a call to `JobTreadProService.verifyOrgAccess()` right after, which registers the device with the Pro Worker. The popup refreshes the API tab to show the connected state.

**Tech Stack:** Chrome Extension (Manifest V3), Chrome Storage API, Cloudflare Workers (no changes)

---

### Task 1: Auto-register device in account-service.js

**Files:**
- Modify: `JT-Tools-Master/services/account-service.js:291-301`

**Step 1: Add auto-registration after grant key storage**

In `storeAuthData()`, replace the existing grant key block (lines 291-294):

```javascript
    // Store grant key separately if provided (for Pro Service)
    if (data.grantKey) {
      await chrome.storage.local.set({ jtAccountGrantKey: data.grantKey });
    }
```

With:

```javascript
    // Store grant key separately if provided (for Pro Service)
    if (data.grantKey) {
      await chrome.storage.local.set({ jtAccountGrantKey: data.grantKey });

      // Auto-register device with Pro Worker so API features work immediately
      if (window.JobTreadProService) {
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
    }
```

**Step 2: Commit**

```bash
git add JT-Tools-Master/services/account-service.js
git commit -m "feat: auto-register device with Pro Worker on login"
```

---

### Task 2: Refresh API tab UI after login in popup.js

**Files:**
- Modify: `JT-Tools-Master/popup/popup.js:2406`

**Step 1: Add checkApiStatus() call after login**

In `handleLogin()`, after the existing `updateAccountUI()` call (line 2406), add `checkApiStatus()`:

```javascript
      // Update UI
      await updateAccountUI();
      await checkApiStatus();
      showStatus('Signed in successfully!', 'success');
```

**Step 2: Commit**

```bash
git add JT-Tools-Master/popup/popup.js
git commit -m "feat: refresh API tab status after login"
```

---

### Task 3: Update CHANGELOG.md

**Files:**
- Modify: `CHANGELOG.md`

**Step 1: Add entry under [Unreleased] > Improved**

```markdown
### Improved
- **Auto-device registration on login**: Logging into a JT Power Tools account on a new device now automatically registers the device with the Pro Worker and restores the JobTread API connection. Users no longer need to manually re-enter their grant key or click "Test" in the API tab.
```

**Step 2: Commit**

```bash
git add CHANGELOG.md
git commit -m "docs: update changelog for auto-device registration"
```
