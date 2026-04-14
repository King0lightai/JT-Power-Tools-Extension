# Admin-Managed Org Logos — Design

**Date:** 2026-04-12
**Status:** Approved

## Problem
Each user must manually paste an org logo URL + org ID in the extension popup. This is per-browser-profile (`chrome.storage.sync`), not shared across the team. Every new team member has to configure it themselves.

## Solution
Admin sets the logo URL once per org in the portal. The extension fetches it alongside the grant key — every team member gets the logo automatically.

## Approach
Add `logo_url` column to the existing `extension_grant_keys` table. No new tables or endpoints — piggyback on the existing per-org grant key flow.

## Database
Migration: `ALTER TABLE extension_grant_keys ADD COLUMN logo_url TEXT`

## Server Changes
1. `/admin/extension-keys/add` — accept optional `logoUrl`, store in `logo_url`
2. `/admin/extension-keys/list` — include `logo_url` in response
3. `/admin/extension-grant-key` (extension lookup) — include `logo_url` in response

## Portal Admin UI
Add image URL input + thumbnail preview per org row in the Extension tab.

## Extension Changes
1. Service worker `FETCH_EXTENSION_GRANT_KEY` — return `logoUrl` from response
2. `GrantKeyResolver` — pass `logoUrl` through, include in cache
3. `OrgLogoFeature` — read logo from grant key resolver instead of `chrome.storage.sync`
4. Popup — remove per-user logo config panel entirely; keep the enable/disable toggle

## Data Flow
```
Admin sets logo URL in portal
  → extension_grant_keys.logo_url
  → /admin/extension-grant-key returns logoUrl
  → GrantKeyResolver caches it (5 min)
  → OrgLogoFeature injects <img>
```

## Cleanup
- Remove `orgLogos` from `chrome.storage.sync`
- Remove `saveOrgLogos()`, `setupOrgLogoUI()`, `addOrgRow()` from popup.js
- Remove org logo config HTML from popup.html
- Simplify `org-logo.js` — no storage listener, reads from resolver
