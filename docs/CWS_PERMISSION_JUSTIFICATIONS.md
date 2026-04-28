# Chrome Web Store — Permission Justifications

This document is the source of truth for the per-permission justifications
submitted to the Chrome Web Store dashboard for **JT Power Tools**
(extension ID `kfbcifdgmcendohejbiiojjkgdbjkpcn`). When updating the
extension's `manifest.json`, mirror any changes here so the next CWS
review submission matches what's deployed.

The CWS dashboard requires plain-language explanations for every
permission. Reviewers want to see (a) what the permission does, (b)
why this extension specifically needs it, (c) what *user-visible*
feature breaks without it. Vague answers ("for functionality") get
rejected.

---

## Single Purpose

> JT Power Tools enhances the JobTread construction management platform
> (`app.jobtread.com`) with productivity features tailored for
> construction project managers — drag-and-drop scheduling, dark mode,
> rich-text formatting in budget descriptions, persistent quick notes,
> and AI-assisted UI customization.

---

## Permissions

### `storage`

> Persists user preferences (which features are enabled, dark-mode
> toggle, color theme, quick-notes content, custom tweaks the user
> authored) across sessions and across devices when the user is signed
> into Chrome. Without `storage`, every browser restart would reset
> the extension to default settings — every feature toggle would have
> to be re-flipped, all saved Quick Notes would be lost, and any
> personal UI tweaks would disappear.

### `activeTab`

> Lets the extension run its UI enhancements (drag-and-drop, dark mode,
> rich-text toolbar, etc.) on the JobTread page the user is currently
> viewing — but ONLY when the user clicks the JT Power Tools icon or
> interacts with one of its features. We use `activeTab` instead of
> broad `tabs` permission to minimize access: we never read tab data
> the user hasn't explicitly invoked us on.

### `clipboardWrite`

> Used by a single feature: **Inspect for AI**. When the user holds
> Alt and clicks any element on a JobTread page (or activates the
> Picker mode via the popup), the extension captures a structured
> markdown description of the clicked element (CSS selector, ancestor
> chain, sample of descendants, current page path, JobTread
> organization name) and copies it to the clipboard. The user then
> pastes that into their preferred AI assistant (ChatGPT, Claude,
> Cursor, Gemini, etc.) so the AI has enough context to author a
> custom UI tweak.
>
> Why we need to write to the clipboard programmatically rather than
> using a fallback like a copy button:
>
> 1. **The capture point is mid-interaction with JobTread** (alt-click
>    on an element). Asking the user to then click a separate "copy"
>    button in a popup interrupts the flow they're already in and
>    breaks the timing we need for a clean DOM snapshot.
> 2. **The captured payload is too long for selection-based copy.**
>    A typical capture is 200–800 lines of structured markdown —
>    selector trees plus descriptions. Users would have to manually
>    drag to highlight all of it and lose context.
> 3. **`clipboardWrite` only — never `clipboardRead`.** The extension
>    NEVER reads from the user's clipboard. We declared `clipboardWrite`
>    specifically because reading is unnecessary; we only ever push
>    captured DOM snapshots out to the user's clipboard for them to
>    paste into their own AI tool.
>
> Without `clipboardWrite`, the Inspect-for-AI feature would have to
> fall back to a "click here to copy" button after every capture,
> adding friction to a workflow that's already a deliberate
> alt-modifier interaction. The capture is always user-initiated
> (alt-click or explicit picker activation) — there is no scenario
> where the extension writes to the clipboard without an active user
> gesture.

### `host_permissions: https://*.jobtread.com/*`

> The extension's entire purpose is to enhance the JobTread web app.
> Content scripts only inject on JobTread domains. No other websites
> are accessed via this permission.

### `host_permissions: https://api.jobtread.com/*`

> The Pro features (Drag & Drop, Preview Mode, Custom Theme) call
> JobTread's official Pave API to read schedule and budget data when
> needed for in-page interactions (e.g. moving a task to a new date
> via drag-and-drop has to commit the new date through the API). The
> user provides their own JobTread API grant key during sign-in; the
> extension never accesses the API on behalf of users who haven't
> provided one.

### `host_permissions: https://jobtread-mcp-server.king0light-ai.workers.dev/*`

> Our backend Worker (Cloudflare) for: license validation against
> Gumroad, optional Quick-Notes sync across devices, Team Notes shared
> within the user's organization, and the User Tweaks storage layer
> (Phase 2+ feature: admins can push UI tweaks to all members of their
> JT org). All requests are authenticated with a JWT issued at
> sign-in; no user data is sent to this domain without an active
> authenticated session.

### `host_permissions: https://jt-tools-license-proxy.king0light-ai.workers.dev/*`

> Legacy license-validation proxy retained for backwards compatibility
> with extension versions before 4.5. New installs use the primary
> MCP server (above). Will be removed in a future major version once
> all installs have migrated.

### `host_permissions: https://jobtread-tools-pro.king0light-ai.workers.dev/*`

> Pro-tier feature gate (separate Worker that validates premium
> entitlements before unlocking Drag & Drop, Preview Mode, and Custom
> Theme). Same auth model as the MCP server.

---

## Permissions explicitly NOT requested

For reviewers who want to confirm the minimum-privilege posture:

- `tabs` — not requested. We use `activeTab` instead, which only grants
  access to a tab when the user explicitly invokes the extension.
- `scripting` — not requested. The popup uses content-script
  `chrome.tabs.sendMessage` to communicate with JobTread tabs instead
  of injecting scripts dynamically.
- `clipboardRead` — not requested. We only write captures out, never
  read.
- `cookies` — not requested.
- `webRequest` / `webRequestBlocking` — not requested. We don't
  intercept or modify network requests.
- `unlimitedStorage` — not requested. Quick Notes and tweak data fit
  comfortably in the default 5 MB `chrome.storage.local` quota.
- `<all_urls>` host permission — not requested. Host access is
  enumerated to specific domains.

---

## Audit trail

Last reviewed: 2026-04-28 (extension version 4.7.0)
Last submitted to CWS: TBD when 4.7.0 publishes.
Reviewer questions answered in this doc: clipboardWrite was the
specific concern raised pre-submission.
