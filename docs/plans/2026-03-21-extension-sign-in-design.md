# Extension Sign-In Flow Design

**Date:** 2026-03-21
**Status:** Approved

## Summary

Replace the Chrome extension's manual license key + grant key entry with an inline sign-in flow that authenticates via the JT Power Tools portal API. Free features work without sign-in. Premium features prompt sign-in when toggled. Existing license key users continue working — portal auth takes priority when available.

## UX Flow

### Free users (no license)
Extension works as-is. All 11 free features available. No sign-in required.

### Premium feature gate
When a user toggles a premium feature (Drag & Drop, Preview Mode, Custom Theme):
1. Inline sign-in form slides open in the popup (email + password fields)
2. Below the form: "Don't have a license? Get one here" (Gumroad link) and "Forgot password?" (portal link)
3. On successful sign-in → feature auto-enables, form replaced by account info card
4. All premium features unlock based on tier

### Signed-in state
The license section in the popup shows:
- Account avatar (first letter) + display name + role badge
- Org name + tier
- "Sign Out" button
- "Manage Team ↗" link — **owners/admins only**, opens portal dashboard

### Existing license key users
- Legacy license key continues to work (no data loss)
- Dismissable banner: "NEW: Sign in to manage your team → [Sign In] [Learn More ↗]"
- If they sign in, portal auth takes priority over raw license key
- Features keep working throughout transition

### Notification plan
- Extension popup banner for existing license holders
- Gumroad email blast announcing the portal

## Auth Architecture

### Sign-in flow
1. User enters email + password in popup
2. Extension calls `POST /auth/login` on portal API
3. API returns: JWT access token (15min), refresh token (7 days), user data
4. AccountService stores tokens + user data in `chrome.storage.local`
5. LicenseService reads tier from AccountService (portal auth priority)
6. Features unlock based on tier

### User data from portal
- email, displayName, role (owner/admin/member)
- tier (essential/pro/power_user)
- orgName, orgId
- licenseKey, grantKey (org-level, set by admin)

### Token refresh
Access token auto-refreshes via `POST /auth/refresh` before API calls. User stays signed in for 7 days.

### Auto-create on first sign-in
When users register on the portal, their account is created and appears on the admin's team dashboard automatically.

### Grant key from portal
Once signed in, the extension gets the org's grant key from the portal API. Individual users don't need to enter a grant key — the admin sets it once for the whole org.

### Priority chain
Portal JWT → legacy license key → no auth (free features only)

## Extension Code Changes

### Files to modify
1. **`popup.js`** — Update AccountService to point at portal API, replace license key section with sign-in form + signed-in card, add migration banner
2. **`popup.html`** — Replace license key input with sign-in form UI + account info card
3. **`popup.css`** — Styles for sign-in form, account card, banner
4. **`license.js` / LicenseService** — Add check: if AccountService has auth, use that tier

### Files NOT touched
- Feature modules (already check tier via LicenseService)
- `service-worker.js` (settings flow unchanged)
- `content.js` (feature toggle flow unchanged)

### New UI components
- **Sign-in form** — email + password, sign-in button, links
- **Account card** — avatar, name, org, tier badge, sign-out, manage team link
- **Migration banner** — dismissable, for legacy license key users

### Chrome storage keys (existing, reused)
- `jtAccountAccessToken` — JWT access token
- `jtAccountRefreshToken` — refresh token
- `jtAccountUserData` — user profile data
- `jtAccountTokenExpiry` — token expiry timestamp
- `jtAccountGrantKey` — org grant key from portal

### What stays the same
- Feature toggles, settings, dark mode, all free features
- Popup structure and tab layout
- How features initialize via content.js
- Chrome storage keys for settings

## Role-based UI

| Element | Owner | Admin | Member |
|---------|-------|-------|--------|
| Account info card | ✅ | ✅ | ✅ |
| Sign out button | ✅ | ✅ | ✅ |
| Manage Team ↗ link | ✅ | ✅ | ❌ |
| Premium features | Per tier | Per tier | Per tier |
