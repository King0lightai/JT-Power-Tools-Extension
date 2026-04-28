# Privacy Policy for JT Power Tools

**Last Updated:** April 28, 2026

## Overview

JT Power Tools ("the Extension") is committed to protecting your privacy. This Privacy Policy explains how the Extension handles information when you use it with JobTread.

## Information We Collect

### Local Storage (All Users)

**Feature settings stored locally in your browser using Chrome's sync storage:**
- Feature toggle states (on/off)
- License key (if you subscribe to premium features)
- Dark mode preference
- Theme color preferences
- Quick Notes panel width and collapse state

**This local data:**
- Stays entirely within your browser
- Syncs across your Chrome devices (via Chrome's built-in sync)
- Is automatically deleted when you uninstall the Extension

### Cloud Storage (Premium Users with Account)

**If you create an account and enable cloud sync, the following data is stored on our servers:**

**Account Information:**
- Email address (for login)
- Display name (optional)
- Hashed password (never stored in plain text)
- License key association

**Personal Notes (My Notes):**
- Note titles and content
- Folder organization
- Pin status
- Creation and modification timestamps
- Notes are associated with your account only

**Team Notes (Shared with your organization):**
- Note titles and content
- Folder organization
- Pin status
- Author information (your display name or email)
- Creation and modification timestamps
- Notes are shared with all team members in your JobTread organization

**User Tweaks (Pro tier — see "User Tweaks" section below for details):**
- Tweak name, description, CSS rules, and DOM action declarations (the "tweak content")
- Author display name (the user who created the tweak)
- Scope (personal vs. org-required) and target JobTread organization name
- Version history (every save creates a new version row; old versions are retained for revert)
- Per-account override state — whether *you* have locally disabled a tweak that your admin pushed to your organization
- Per-account engine telemetry — selector match counts and the most recent applied/error timestamp (debounced reports from the extension; used to surface "no matches found" warnings in the popup)

**AI Grant Keys (Power User tier):**
- Encrypted reference to a JobTread API grant key you provide
- The portal account that issued the key (used for attribution when AI authors User Tweaks on your behalf)
- The MCP permission tier you assigned to the key — `read`, `write`, or `delete` — controls which MCP tools the AI can call

**What We DON'T Collect:**
- JobTread login credentials
- Project data, client information, or budget data (we never persist JobTread query results — they pass through the MCP server in real-time and are not stored)
- Browsing history or usage patterns
- Analytics or tracking data
- Payment information (handled by Gumroad)
- AI prompt content (your conversations with Claude/ChatGPT/etc. happen directly between you and the AI platform — our MCP server only sees the structured tool calls those platforms generate, not the prompts)
- DOM snapshots from Inspect-for-AI (these are written to *your* clipboard and never transmitted to our servers)

## Data Storage Locations

| Data Type | Storage Location | Shared With |
|-----------|------------------|-------------|
| Feature settings | Local browser (Chrome sync) | Your Chrome devices only |
| Personal Notes (local mode) | Local browser | Your Chrome devices only |
| Personal Notes (sync enabled) | Our secure servers | Only you |
| Team Notes | Our secure servers | Your organization's team members |
| License key | Local browser + our servers | Gumroad (for verification) |
| Personal Tweaks (Pro) | Our secure servers + local cache | Only you |
| Org-Required Tweaks (Pro) | Our secure servers + local cache | All members of your JobTread organization |
| Tweak override state (per device) | Our secure servers | Only you (admins see aggregate counts only) |
| Tweak engine diagnostics | Our secure servers | Only you (admins see aggregate per-tweak match-count summaries) |
| AI Grant Keys + permission tiers | Our secure servers | Your admins; provided to AI clients you connect |
| Inspect-for-AI DOM captures | Your clipboard only | Whoever you choose to paste into (an AI assistant) |

## Server Infrastructure

Our cloud services run on **Cloudflare Workers** with **Cloudflare D1** database:
- Data is encrypted in transit (HTTPS/TLS)
- Hosted in Cloudflare's global network
- Subject to Cloudflare's security practices: https://www.cloudflare.com/trust-hub/

## Premium License Verification

**If you subscribe to premium features:**
- Your license key is verified with Gumroad's servers
- Only your license key is sent to Gumroad for verification
- Gumroad may collect information according to their privacy policy: https://gumroad.com/privacy
- We do not receive or store your payment information

## Permissions Explained

The Extension requests the following Chrome permissions:

**storage**
- Purpose: Save your feature preferences and local notes
- Data: Toggle states, license key, preferences, local notes
- Storage: Local browser, synced via Chrome

**activeTab**
- Purpose: Apply formatting and features to the current JobTread tab
- Access: Only when you actively use JobTread pages
- Data: No data is read, only CSS/formatting is applied

**clipboardWrite**
- Purpose: Used exclusively by the Inspect-for-AI feature to copy captured DOM context (CSS selectors + ancestor/descendant tree + page path + JT org name) to your clipboard so you can paste it into your AI assistant.
- Access: Only triggered by your explicit alt-click on a JobTread element or activation of Picker mode.
- Data: A markdown payload describing the clicked element. Never transmitted to our servers — only written to your clipboard for you to paste into the AI assistant of your choice.
- We do NOT request `clipboardRead` — the extension never reads from your clipboard.

**Host Permission: https://*.jobtread.com/***
- Purpose: Enable features on JobTread pages
- Access: Limited to JobTread domains only
- Data: Modifies display and behavior, reads minimal DOM data for features

**Host Permission: https://api.jobtread.com/***
- Purpose: The Pro features (Drag & Drop, Preview Mode, Custom Theme) call JobTread's Pave API to read schedule/budget data when needed for in-page interactions.
- Access: Only when those features are active and you've provided a JobTread API grant key.
- Data: API requests are signed with the grant key you provided.

**Host Permission: https://jobtread-mcp-server.king0light-ai.workers.dev/***
- Purpose: Our primary backend Worker. Handles license validation, account auth, notes sync, team notes, User Tweaks storage, and the MCP server.
- Access: Only when authenticated (signed-in or with a valid license key).
- Data: Whatever data the feature you're using requires (e.g., notes content for notes sync; tweak DSL for tweaks).

**Host Permission: https://jt-tools-license-proxy.king0light-ai.workers.dev/***
- Purpose: Legacy license-validation proxy (retained for backwards compatibility with extension versions before 4.5).
- Access: Only used by the legacy auth path — current installs go through the primary MCP server.
- Data: License key for verification.

**Host Permission: https://jobtread-tools-pro.king0light-ai.workers.dev/***
- Purpose: Pro-tier feature gate Worker (verifies premium entitlements before unlocking Drag & Drop, Preview Mode, Custom Theme).
- Access: Only when you activate a premium license.
- Data: License key, device ID for entitlement verification.

## How We Use Your Data

**We use your data to:**
1. Apply visual styling (dark mode, contrast fixes, themes)
2. Enable productivity features (drag-and-drop, formatting, notes)
3. Sync your notes across devices (if enabled)
4. Share Team Notes with your organization members
5. Verify premium licenses

**We do NOT:**
- Sell your data to third parties
- Use your data for advertising
- Share your data outside your organization (except Team Notes with teammates)
- Access your JobTread project/client data
- Monitor your activity beyond what's needed for features

## Data Retention

- **Local data**: Retained until you uninstall the Extension or clear browser data
- **Cloud notes**: Retained while your account is active
- **Account data**: Retained until you delete your account
- **Deleted notes**: Permanently removed from our servers

## Your Rights

You have the right to:
- **View** all data stored by the Extension (Chrome DevTools → Application → Storage)
- **Export** your notes (copy content manually)
- **Delete** local data (uninstall the Extension or clear storage)
- **Delete** cloud data (delete individual notes or your account)
- **Opt out** of cloud sync (use local-only mode)
- **Request** information about your data (contact us)

## Data Security

- All network communication uses HTTPS/TLS encryption
- Passwords are hashed using industry-standard algorithms
- Access tokens expire and require refresh
- Database access is authenticated and logged
- No plain-text sensitive data storage

## Children's Privacy

The Extension is designed for business professionals and is not directed at children under 13. We do not knowingly collect information from children.

## Changes to This Policy

We may update this Privacy Policy from time to time. Changes will be reflected in the "Last Updated" date. Continued use of the Extension after changes constitutes acceptance of the updated policy.

## Third-Party Services

| Service | Purpose | Data Shared | Privacy Policy |
|---------|---------|-------------|----------------|
| Gumroad | License verification | License key | https://gumroad.com/privacy |
| Cloudflare | Server infrastructure | Notes, account data, tweak DSL, AI grant keys (encrypted refs), MCP usage telemetry | https://www.cloudflare.com/privacypolicy/ |
| AI Platforms (via MCP) | AI-assisted JobTread access (Power User only) | JobTread tool-call results (jobs, customers, vendors, tasks, budgets, documents, daily logs, time entries, comments, dashboards, workflows, files metadata, tweaks). Scope and write capability are controlled by the per-key permission tier you assign — Read / Read+Write / Read+Write+Delete. | See platform-specific policies |

## MCP Server (Power User Tier Only)

Power User subscribers can connect AI assistants (such as Claude, ChatGPT, or Cursor) to their JobTread data through our Model Context Protocol (MCP) server:

- **Authentication:** Requires either an OAuth login (Claude.ai, ChatGPT) or a Bearer token combining your license key and a JobTread grant key (Claude Code, Cursor)
- **Access type:** Configurable per AI grant key. Admins choose one of three tiers:
  - **Read** — AI can query data only (job lookups, schedule views, budget reports, search). No mutations.
  - **Read + Write** — AI can also create or update records (new tasks, comments, time entries, daily logs, budget items, contacts, dashboards, workflows, etc.).
  - **Read + Write + Delete** — full access including destructive operations (delete jobs/tasks/comments/entries, revoke access grants, reject vendor bills, cancel workflow runs).
- **Default for new AI keys:** `Read` (least-privileged). Admins explicitly opt up via the portal at app.jtpowertools.com.
- **Existing keys at the time of this policy update:** Grandfathered to `Read + Write + Delete` so existing AI clients keep working unchanged. Admins can downgrade individual keys at any time via the portal.
- **Data accessible to AI (Read tier):** Job records, customer/account info, vendor/subcontractor info, tasks/to-dos, schedule items, daily logs, time entries, comments, documents (invoices/POs/change orders/bills), budget line items + cost groups, dashboards, workflows, files metadata, location data, contact info, custom field definitions, and User Tweaks the AI key's account is allowed to see.
- **Data accessible to AI (Write/Delete tiers):** Same scope as above PLUS the ability to create/update/delete those records depending on the tier you assigned.
- **Data storage:** The MCP server does not persist JobTread query results. Tool calls are proxied to JobTread's Pave API in real-time and the response flows back to the AI client. The server only persists per-tool usage telemetry (which tool was called, success/failure, duration) for rate-limiting and debugging — never the actual returned data.
- **Optional per-tool indexing (context-mode):** When AI clients use the `ctx_index` tool to cache large JobTread responses for follow-up search, that cached content is stored in a per-license knowledge base and auto-expires. You can clear it via the `ctx_*` tools.
- **AI grant key attribution:** When an admin issues an AI grant key, the portal records which admin issued it. If that AI key creates a User Tweak via Phase 3 MCP tools, the tweak is attributed to the issuing admin (not anonymized).
- **Third-party AI platforms:** When you use MCP, your JobTread data is sent to the AI platform you choose (e.g., Anthropic for Claude, OpenAI for ChatGPT, Anysphere for Cursor). These platforms have their own privacy policies.
- **Opt-in only:** MCP is entirely optional and requires admin setup. No data leaves your organization without an admin explicitly issuing an AI grant key.

## User Tweaks (Pro Tier and Above)

User Tweaks let you author small declarative customizations of the JobTread UI (CSS styling rules and DOM action declarations) and apply them automatically when you visit JobTread. They come in two flavors:

- **Personal tweaks** — visible only to you. You're the author; the data is stored on our servers scoped to your account.
- **Org-required tweaks** — created by your organization's admin and pushed to every member of your JobTread org/license. As a member, you can locally disable an org-required tweak on your specific device (the local-disable hatch) — your admin sees the aggregate count of disables but never which specific member is disabling.

**What's stored on our servers:**

- The tweak's name, description, CSS rules, and DOM actions (`addClass`, `removeClass`, `setStyle`, `hide`, `show`, `setText`, `onEvent`)
- The author's display name (the user who created the tweak)
- Version history (every save creates a new immutable version row; old versions are retained so you can revert)
- For org-required tweaks: which JobTread organization the tweak applies to
- Your per-account override state (which org-required tweaks you've locally disabled)
- Per-account engine telemetry — selector match counts and last-error timestamps (debounced uploads, used in the popup to show "no matches found" warnings)

**Defense in depth:** Every CSS rule and action submitted to our server passes through a server-side sanitizer (rejects `@import`, `expression()`, `url()` not pointing to https or data:image, extension-UI selectors, and unsafe selectors targeting `html`/`body`/`*`) before storage. Even if the extension's client-side validation is bypassed, the server enforces the same allowlist.

**What's NOT stored:**

- Inspect-for-AI DOM captures (those go to your clipboard, never to our servers)
- Tweak preview test results (real-time only, never persisted)

**Inspect-for-AI:**

The Inspect-for-AI feature lets you alt-click any element on JobTread (or activate Picker mode) to capture a structured markdown description of the clicked element — CSS selector, ancestor chain, sample of nested elements, current page path, and the JobTread organization name. The captured description is **written to your clipboard via the `clipboardWrite` permission and never transmitted to our servers**. You then paste it into your AI assistant of choice (Claude, ChatGPT, etc.) so the AI has enough context to write a tweak for you. The extension never reads from the clipboard.

## Open Source

The Extension's source code is available on GitHub, allowing you to verify our privacy practices:
https://github.com/King0lightai/JT-Power-Tools

## Contact

For privacy questions or concerns:
- Email: support@jtpowertools.com
- GitHub Issues: https://github.com/King0lightai/JT-Power-Tools-Extension/issues

## Legal Disclaimer

JT Power Tools is an independent extension and is not officially affiliated with, endorsed by, or connected to JobTread or its parent company. JobTread is a trademark of its respective owner.

## Consent

By installing and using JT Power Tools, you consent to this Privacy Policy.

---

**Summary:**
- **Free users**: All data stays local in your browser. No server communication except optional license verification.
- **Premium users with accounts**: Notes can sync to our servers for cross-device access and team collaboration. We only store what's needed for the features you use.
