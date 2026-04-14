# Privacy Policy for JT Power Tools

**Last Updated:** March 4, 2026

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

**What We DON'T Collect:**
- JobTread login credentials
- Project data, client information, or budget data
- Browsing history or usage patterns
- Analytics or tracking data
- Payment information (handled by Gumroad)

## Data Storage Locations

| Data Type | Storage Location | Shared With |
|-----------|------------------|-------------|
| Feature settings | Local browser (Chrome sync) | Your Chrome devices only |
| Personal Notes (local mode) | Local browser | Your Chrome devices only |
| Personal Notes (sync enabled) | Our secure servers | Only you |
| Team Notes | Our secure servers | Your organization's team members |
| License key | Local browser + our servers | Gumroad (for verification) |

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

**Host Permission: https://*.jobtread.com/***
- Purpose: Enable features on JobTread pages
- Access: Limited to JobTread domains only
- Data: Modifies display and behavior, reads minimal DOM data for features

**Host Permission: https://api.gumroad.com/***
- Purpose: Verify premium license keys (optional)
- Access: Only when you activate a premium license
- Data: Only license key is sent to Gumroad

**Host Permission: https://*.workers.dev/***
- Purpose: Sync notes and verify accounts (Premium users only)
- Access: Only when sync features are enabled
- Data: Notes content, account credentials, license association

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
| Cloudflare | Server infrastructure | Notes, account data | https://www.cloudflare.com/privacypolicy/ |
| AI Platforms (via MCP) | AI-assisted JobTread access (Power User only) | JobTread query results (jobs, customers, vendors, tasks, budgets) | See platform-specific policies |

## MCP Server (Power User Tier Only)

Power User subscribers can connect AI assistants (such as Claude, ChatGPT, or Cursor) to their JobTread data through our Model Context Protocol (MCP) server:

- **Authentication:** Requires both your license key and JobTread grant key
- **Access type:** Read-only — AI assistants cannot modify your JobTread data
- **Data accessible to AI:** Job names/IDs, customer/account info, vendor/subcontractor info, tasks/to-dos, job budgets, and schedule data
- **Data NOT accessible:** Files, attachments, documents, or raw financial data beyond budget line items
- **Data storage:** The MCP server does not persist your JobTread data. Query results are returned to the AI client in real-time
- **Third-party AI platforms:** When you use MCP, your JobTread data is sent to the AI platform you choose (e.g., Anthropic for Claude, OpenAI for ChatGPT). These platforms have their own privacy policies
- **Opt-in only:** MCP is entirely optional and requires manual setup

## Open Source

The Extension's source code is available on GitHub, allowing you to verify our privacy practices:
https://github.com/King0lightai/JT-Power-Tools

## Contact

For privacy questions or concerns:
- Email: support@jtpowertools.com
- GitHub Issues: https://github.com/King0lightai/JT-Power-Tools/issues

## Legal Disclaimer

JT Power Tools is an independent extension and is not officially affiliated with, endorsed by, or connected to JobTread or its parent company. JobTread is a trademark of its respective owner.

## Consent

By installing and using JT Power Tools, you consent to this Privacy Policy.

---

**Summary:**
- **Free users**: All data stays local in your browser. No server communication except optional license verification.
- **Premium users with accounts**: Notes can sync to our servers for cross-device access and team collaboration. We only store what's needed for the features you use.
