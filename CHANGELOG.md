# Changelog

All notable changes to JT Power Tools will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Changed

#### Org Logo — Admin-Managed via Portal
- Org Logo feature now reads logo URL from GrantKeyResolver (admin-configured in portal) instead of per-user `orgLogos` storage
- Removed per-user org logo configuration UI from popup settings
- Service worker passes `logoUrl` from extension grant key response through to cache
- GrantKeyResolver exposes new `getLogoUrl()` method for cached logo URL lookup
- Legacy `orgLogos` storage key cleaned up on extension install/update

### Added

#### Pro Worker JWT Authentication
- Added JWT verification helpers (`verifyJwt`, `getSigningKey`, `base64urlDecode`) to Pro Worker for portal access token validation
- Added `resolveJwtAuth()` function that resolves portal JWT tokens into effectiveUser objects compatible with existing handlers
- JWT auth path looks up `accounts` + `licenses` + `extension_grant_keys` tables with fallback to legacy `users` table
- Updated `withAuth()` middleware to accept `request` parameter and try JWT `Authorization: Bearer` header before falling back to device-based auth
- Updated all 22 protected endpoint call sites to pass `request` through to `withAuth()`
- Portal users who switch browsers no longer need a device entry in `authorized_devices` to access Pro features
- Updated `workerRequest()` in Pro Service to send portal JWT via `Authorization: Bearer` header when available, with fallback to legacy licenseKey/deviceId auth
- Added automatic JWT refresh and retry on 401 responses via `AccountService.refreshToken()`

#### Multi-Org Grant Key Resolution
- Added OrgDetector utility (`utils/org-detector.js`) to detect current JobTread organization from URL
- Added GrantKeyResolver service (`services/grant-key-resolver.js`) for automatic per-org grant key resolution
- Registered both modules in manifest.json content_scripts load order
- Initialize OrgDetector in content.js orchestrator on page load
- Migrated `JobTreadAPI.getApiKey()`, `JobTreadProService.getGrantKey()`, and `AccountService.getGrantKey()` to try GrantKeyResolver first with fallback to legacy storage

#### Extension Grant Key Support
- Added `extension_grant_keys` D1 table for per-org extension key storage
- Added server endpoints for extension key CRUD (`/admin/extension-keys/list|add|remove`) and lookup (`/api/extension-grant-key`)
- Added `FETCH_EXTENSION_GRANT_KEY` message handler to service worker for fetching extension grant keys from the MCP server using portal JWT authentication
- Added "Extension" tab to portal dashboard for managing per-org extension grant keys (add, list, remove)
- Full backward compatibility — single-org users continue working without any changes

#### Text Formatter — Catalog Support
- Added text formatter toolbar to catalog page Description fields
- Only Description columns get the toolbar (Name and other fields excluded)

#### MCP Server — ChatGPT Compatibility
- Fixed ChatGPT MCP connector showing "No app actions available"
  - Added stateless pre-initialization for MCP clients that send tools/list without prior initialize
  - Added SSE GET endpoint for MCP Streamable HTTP spec compliance
  - Added OAuth 401 retry for KV token propagation race condition
- Consolidated 9 tool pairs to reduce payload size (91 → 80 tool definitions):
  - `get_job` absorbs `get_job_details` (summary=true)
  - `get_budget` absorbs `get_budget_full` (full=true)
  - `get_schedule` absorbs `get_schedule_full` + `list_tasks` (full=true)
  - `search_files` absorbs `get_job_files` (jobId scoping)
  - `search_team_notes` absorbs `list_team_notes` (optional query)
  - `get_daily_logs` absorbs `get_daily_log` (dailyLogId param)
  - `list_documents` absorbs `get_documents_summary` (summary=true)
  - `knowledge_lookup` absorbs `search_knowledge_base` (source=help)
  - `list_catalogs` replaces `list_cost_codes` + `list_cost_types` + `list_units` (type enum)
- ChatGPT gets ~73 tools (excludes bills, file upload, data views); Claude Code/Cursor get full 86

#### MCP Server — New Tools
- **`jobtread_list_documents`** — List individual invoices, bills, POs, estimates for a job with type/status filters, account, amounts, due dates, and attached files
- **`jobtread_get_document`** — Get a single document with full line items, account, files, and amounts
- **`jobtread_get_task`** — Get a single task with full details: description, dependencies (predecessors/successors), assignees, comments, files, recurrence, and group status

#### MCP Server — DataView Tools (Saved Views)
- **`jobtread_list_data_views`** — List all saved views in the organization with optional type filtering
- **`jobtread_get_data_view`** — Get full view configuration with human-readable field names
- **`jobtread_list_data_view_fields`** — Discover available fields (built-in + custom) for any of 17 entity types
- **`jobtread_create_data_view`** — Create views with human-friendly field names, simplified filters, and org-wide visibility by default
- **`jobtread_update_data_view`** — Partial update with automatic options merging
  - Supports all 17 JobTread entity types (job, customer, vendor, costItem, task, document, dailyLog, timeEntry, payment, location, event, costGroup, membership, user, jobBudget, organization, visitor)
  - Human-friendly field names mapped to Pave paths (saves tokens)
  - Simplified filter syntax: `[["closedOn", "=", null]]` instead of Pave AST
  - Dynamic custom field discovery with `cf:` prefix (e.g., `cf:Division`)
  - `userId: null` for org-wide visibility by default

### Improved

#### MCP Server — Enhanced Read Tools
- **Comments** now return `createdByUser` (who said it), `parentComment` (threading), `isPinned`, `isVisibleToAll`, and file URLs
- **Schedule tools** (`get_schedule`, `get_schedule_full`) now include task dependencies (`predecessors`/`successors`), `isGroup`, `recurrenceRule`, and `parentTaskId`
- **Job tools** (`get_job`, `get_job_details`) now include customer/account info via `location→account` chain, plus `scheduleIsPublished`, `priceType`, `defaultRetainagePercentage`, `areas`, `folders`, and `parameters`
- **Budget tools** (`get_budget`, `get_budget_full`, `get_budget_tree`) now include `costType` (Labor/Materials/Subcontractor) and `unit` on each cost item
- **Budget tree** now includes `quantity`, `quantityFormula`, and `unit` on cost groups

#### MCP Server — Enhanced Write Tools
- **`create_comment`** — Added threading (`parentCommentId`, `isReply`), granular role visibility (`isVisibleToCustomerRoles`/`InternalRoles`/`VendorRoles`), `assignees` for @mentions, and expanded target types (`account`, `organization`, `timeEntry`)
- **`create_task` / `update_task`** — Added `dependsOnTasks`/`dependentTasks` for setting predecessors/successors, `isGroup` for task group headers, `positionAfterTaskId` for ordering, `recurrenceRule`, and `updateDependentTasks` for cascading date changes
- **`create_job`** — Added `priceType`, `lineItems` (inline budget), `parameters`
- **`update_job`** — Added `areas`, `folders`, `parameters`, `priceType`, `defaultRetainagePercentage`
- **`create_cost_item`** — Added formula fields (`quantityFormula`, `unitCostFormula`, `unitPriceFormula`) and `positionAfter`
- **`create_cost_group`** — Added `quantity`, `quantityFormula`, `unitId`
- **`update_cost_group`** — Added `lineItems` to add items inline during update
- **`create_account`** — Added `suffixIfNecessary` for auto-dedup of duplicate names
- **`create_daily_log`** — Added `assignees` and `files` parameters

#### MCP Server — Pagination Support
- Added `page` cursor parameter to 13 tools that previously returned `hasMore: true` with no way to fetch the next page
- Affected tools: `get_budget`, `get_budget_backups`, `list_tasks`, `get_schedule`, `search_accounts`, `get_daily_logs`, `get_comments`, `list_documents`, `get_time_entries`, `get_job_files`, `list_locations`, `search_jobs`, `list_cost_codes`
- All paginated tools now return `nextPage` cursor — pass it as the `page` parameter to get the next batch
- Fixed `search_jobs` and `search_accounts` silently truncating results without any indicator

#### MCP Server — Knowledge Base Corrections
- Fixed incorrect claim that comments have no author — `createdByUser` works
- Added newly discovered document fields (`name`, `number`, `dueDate`, `account`, `costItems`, `files`)
- Added task dependency and grouping fields to entities reference
- Added job metadata fields (`areas`, `folders`, `parameters`, `priceType`, etc.)
- Added cost item `costType`, formula fields, and `files` connection
- Documented confirmed non-existent fields to prevent bad queries

## [4.5.0] - 2026-04-05

### Added
- **Job Access Collapse** — Per-section collapse toggles in Job Access panel (Customer, Internal, Vendor, etc.) with persistent state across page loads and SPA navigation
- **Org Logo Replacement** — Replace the generic JobTread logo in the org switcher with custom branding per organization via image URL configuration in popup settings
- **Interactive Budget Changelog Report** — Full interactive report opens in extension page with:
  - Sticky toolbar with search, type filter chips, cost group dropdown, threshold filter, and delta/side-by-side view toggle
  - Clickable summary cards, sortable table columns, collapsible cost group sections with subtotals
  - Click any row to expand and see full details including word-level description diffs
  - Export to CSV, copy summary to clipboard, or print
  - Performance: auto-collapse groups when >200 items
- **Job Switcher Upgrades** — Sort, location custom fields, and infinite scroll:
  - Sort dropdown (Recent / A-Z / Z-A) with persistent preference
  - Location custom fields (📍 prefixed) in the filter dropdown with client-side filtering
  - Location name/address displayed on each job in the results list
  - Infinite scroll pagination (50 jobs per page, auto-loads on scroll)
  - Compact filter UI layout — status and sort on one row

### Fixed
- Fixed Budget Changelog 400 error on jobs with >100 backups — pagination used `after` instead of Pave's `page` cursor
- Fixed Budget Changelog blank page due to JobTread CSP blocking inline scripts — now renders via extension page (`report.html`)
- Fixed Compare Backups stack overflow on large budgets with 3000+ item safety limit
- Fixed Freeze Header activating on `/catalog` pages
- Fixed Update Folder sidebar dropping below frozen headers
- Fixed Job Switcher keyboard shortcuts (CapsLock compatibility, cleanup of orphaned state)

#### Vendor Bill Ingestion (MCP Server)
- Added vendor bill ingestion pipeline via Cloudflare Email Routing
  - Forward vendor invoices (PDF) to `bills-{orgId}@jtpowertools.com` — address shown in portal next to AI grant key
  - Per-org sender allowlist — only approved email addresses are accepted, all others silently dropped
  - Workers AI extracts vendor name, amount, dates, and line items into a pending queue
  - Original PDF stored in Cloudflare R2; nothing is posted to JobTread automatically
  - User's AI processes the queue on demand, applying their own business rules before approving
- Added 6 MCP tools for bill pipeline management:
  - `list_pending_bills` — view bills queued from email (filter by status)
  - `get_pending_bill_detail` — full extracted data and line items for a single bill
  - `approve_bill` — create a draft vendorBill in JobTread with PDF attached; supports overrides for any AI-extracted field
  - `reject_bill` — dismiss a bill with optional reason
  - `list_approved_senders` — view the email allowlist
  - `add_approved_sender` — add an email to the allowlist
- Added vendor bill forwarding address to portal dashboard (shown next to AI grant key when configured)
- Added Approved Senders management section to portal dashboard (Owner/Admin only)
- Added automatic data retention policy:
  - Pending bills auto-deleted after 30 days (original email still exists with the sender)
  - R2 PDFs deleted immediately when a bill is approved or rejected (already attached in JobTread)
  - Approved/rejected audit rows purged from D1 after 90 days
  - Daily cron trigger (3am UTC) handles stale cleanup

- Per-org MCP connector URLs — each AI grant key now has a unique `/mcp?org=<orgId>` URL so Claude.ai and ChatGPT accept multiple connectors for multi-org users
  - Portal dashboard shows per-org connector URLs with copy buttons on each AI grant key card
  - Server reads `?org=` query param to auto-select the correct org's grant key
  - Works across OAuth (Claude.ai, ChatGPT), Bearer auth (Claude Code, Cursor), and OAuth consent flow

### Changed
- Renamed "Budget Tools" to "Auto Sum" in the extension popup for clarity
- Added Auto Sum feature guide (`docs/guides/auto-sum.html`)
- Added Auto Sum feature card to the main site (`docs/index.html`)

### Fixed
- Fixed schedule feature count showing 5 instead of 6 in the extension popup
- Fixed feature description text running into toggle switches — added padding between text and toggle
- Fixed Budget Changelog not finding grant key when user signs in through portal account system
  - Prioritized `jtAccountGrantKey` (from portal login) over potentially stale `jtpro_grant_key`
  - Added `jtAccountGrantKey` check to `checkApiConfigured()` so the feature enables correctly after portal sign-in
  - Grant key entered in MCP setup now also persists to D1 database via AccountService for cross-device sync
- Fixed `update-grant-key` server endpoint failing with SQL error (`no such column: updated_at` on accounts table)

### Improved
#### Documentation Updates
- Rewrote Installation & Setup guide (`docs/guides/installation.html`) to reflect current product
  - Updated feature count from "7 features" to full 20+ feature list across all tiers
  - Added complete premium setup flow: Purchase → Register on Portal → Invite Team → Sign Into Extension
  - Added team member onboarding instructions
  - Updated troubleshooting with sign-in, password reset, and premium feature sections
  - Updated permissions table and uninstall information for account-based system
- Rewrote Premium Features & Licensing guide (`docs/guides/premium.html`) to reflect new account system
  - Replaced old license-key-paste activation flow with portal registration + extension sign-in flow
  - Added Team Setup section with invite and onboarding instructions
  - Added portal management section (team, MCP config, subscription)
  - Added Forgot Password documentation
  - Updated all tier feature lists to include newer features (Availability Filter, Files Drag to Folder, Unassigned Availability, Reverse Thread Order, Fat Gantt, Budget Tools, Smart Resize)
  - Updated FAQ for new account system
  - Updated cancellation section to clarify access continues until billing period ends

### Security
- Removed exposed Gumroad Product ID from public premium documentation

## [4.0.4] - 2026-03-28

### Added
- Added **Budget Tools** feature: select budget line items by clicking their row numbers to see a live "Selection Totals" panel injected at the top of JobTread's MASS BUDGET ACTIONS sidebar
  - Shows Extended Cost, Extended Price, and Profit (with margin %) for all selected rows
  - Dynamically reads the budget column header row to locate Extended Cost and Extended Price by name — works correctly regardless of which columns the user has configured or their order
  - Handles TBD items gracefully (skips them and shows a count)
  - Updates live as rows are selected or deselected
  - Correctly excludes parent group rows (which get auto-highlighted when children are selected) — only sums actual line items
  - Reads cell values from `<input>` elements (how JobTread renders editable budget cells), not just innerText
  - Handles JobTread's lazy/virtual row loading: uses a persistent selection map keyed by row number so items scrolled out of view still contribute to the totals
  - Enable via the "Budget Tools" toggle in the extension popup
- Added dark mode support for Budget Tools — uses neutral grey palette (#252525, #404040, #e0e0e0) with brighter green/red for profit/loss readability
- Added RGB custom theme support for Budget Tools — reads CSS variables (--jt-theme-background-elevated, --jt-theme-border, --jt-theme-text, etc.) to adapt to any custom palette
- Budget Tools panel auto-updates theme colors on each render, so toggling dark mode or custom theme while the panel is open updates correctly

### Fixed
- Fixed Budget Tools toggle state not persisting — `getCurrentSettings()` and `loadSettings()` in popup.js were missing `budgetTools`, so every settings save overwrote it with the default (false)
- Fixed Claude.ai MCP setup instructions in the portal dashboard: updated "Settings → Integrations" → "Settings → Connectors" and "Add More Integrations" → "Add a custom connector" to match Claude.ai's renamed UI
- Fixed Text Formatter toolbar not appearing in the Cost Item Details sidebar panel (on /budget and /specifications pages); the orange-header exclusion filter now exempts panels whose header text is "cost item details"
- Fixed Freeze Header not recognising the schedule week/month calendar view header; added `time[datetime]` detection to `findAndMarkScheduleHeader` so the day/week column header row is correctly marked as `jt-schedule-header-container`
- Fixed Text Formatter toolbar not appearing in budget table Description fields that already have content
  - Root cause 1: React removes the `placeholder` attribute from Description textareas when content is present; `isBudgetDescriptionField` relied on the placeholder to identify the field, so filled cells were never recognised and the toolbar was suppressed
  - Added sticky-column detection as final fallback in `isBudgetDescriptionField`: budget rows have frozen (sticky) columns for row# and Name; the Description column is NOT frozen, so any non-sticky budget textarea must be a Description field
  - Root cause 2: Budget toolbar `z-index` was `9`, but JobTread's main layout wrapper uses `z-[29]`, creating a stacking context that placed all data row content above the toolbar; raised toolbar `z-index` to `35` (above data rows at z-29, below sticky budget header at z-41)
  - Root cause 3: `findBudgetHeaderRow` only searched inside the scroll container, but the budget column header row is a sibling of the scroll container (outside it); added Strategy 4 to search the scroll container's parent element, restoring correct clip-path behavior when the toolbar scrolls up behind the header

## [4.0.0] - 2026-03-22

### Added
#### Web Portal — app.jtpowertools.com
- Added full web portal for team and license management at `app.jtpowertools.com`

#### Web Portal Backend — Sprint 1 (Auth, Admin, Invites)
- Added JWT-based portal authentication system (`portal-auth.js`)
  - `POST /auth/register` — account registration with invite token or license key
  - `POST /auth/login` — email/password sign-in, returns JWT access + refresh tokens
  - `POST /auth/refresh` — exchange refresh token for new access token
  - `POST /auth/forgot` — request password reset email (via Resend)
  - `POST /auth/reset` — reset password with token
  - `POST /auth/me` — get current user info from access token
  - `POST /auth/logout` — invalidate refresh token session
  - HMAC-SHA256 JWT signing via Web Crypto API (no external deps)
  - PBKDF2-SHA256 password hashing (100K iterations)
  - 15-minute access tokens + 7-day refresh tokens in D1 sessions table
- Added admin team management endpoints (`admin.js`)
  - `POST /admin/org` — org/license details with member & invite counts
  - `POST /admin/team` — list all team members with roles and last login
  - `POST /admin/create-invite` — generate invite links (open or email-specific)
  - `POST /admin/revoke-invite` — revoke pending invites
  - `POST /admin/list-invites` — list all invites with status
  - `POST /admin/remove-member` — soft-delete team members (owner protection)
  - `POST /admin/update-role` — promote/demote members (owner-only)
  - `POST /admin/update-grant-key` — validate and update org grant key
- Added invite system for team onboarding
  - `GET /invite/:token` — validate invite link, return org info
  - Invite links support email-specific or open (shareable) modes
  - Configurable expiration (default 7 days) and max uses
  - Automatic Resend email delivery when configured
- Added auto-owner assignment logic
  - First account registered on a license automatically becomes `owner`
  - Email matching Gumroad `purchaseEmail` also gets `owner` role
  - Invite-based registrations default to `member`
- Added `invites` table migration (`006_invites.sql`)
- Added rate limiting on `/auth/register` and `/auth/login` endpoints
- MCP server version bumped to 5.3.0

#### Web Portal Frontend — Sprint 2 (Portal UI)
- Added portal site hosted on Cloudflare Pages at `app.jtpowertools.com`
  - Login page with email/password authentication
  - Registration page with invite token and license key flows
  - Forgot password and reset password pages
  - Dashboard with account info, org overview, and admin controls
- Added on-brand design system (Bebas Neue headers, Source Sans 3 body, #FE4C0D/#FF6B35 gradient, dark neutral backgrounds)
- Added admin dashboard features for org owners
  - Organization overview stats (members, invites, plan, license status)
  - Team members table with remove member functionality
  - Invite creation with shareable links and email-specific invites
  - Invite management with revoke capability
- Added JobTread Connection card — validate and store org-level Grant Key
- Added AI Server (MCP) card — separate Grant Key for AI tools, server URL and license key with copy buttons
- Added `POST /admin/update-ai-key` endpoint for AI-specific grant key management
- Added `POST /admin/connection` endpoint for connection status (grant keys, MCP info)
- Added `ai_grant_key_encrypted` and `grant_key_encrypted` columns to licenses table
- Added auto-refresh JWT flow in API client (transparent 401 → refresh → retry)

#### Extension Sign-In Flow — Sprint 3
- Added inline portal sign-in in popup for premium feature access
  - AccountService now authenticates against portal API (jobtread-mcp-server)
  - Direct registration without setup tokens (email + password + license key)
  - Grant key auto-syncs from portal on sign-in (admin sets once for org)
  - Portal auth takes priority over legacy license key when both present
- Added migration banner for existing license key users ("NEW: Manage your team online")
- Added "Manage Team ↗" link for owners/admins in popup account card (opens portal dashboard)
- Added grant key to portal auth responses (login, register, refresh, me endpoints)

#### Extension Simplification — Sprint 4
- Removed License, API, and MCP tabs from popup — all configuration now in portal
- Added Account tab with sign-in/sign-out and account info display
- Added refresh button to popup header (always visible)
- Simplified popup to Features + Theme + Account tabs
- Extended refresh token TTL from 7 days to 90 days with rolling renewal

#### Branding & Polish
- Updated extension icons with new logo across all sizes
- Added tagline to docs site: "The Missing Piece of Your JobTread Workflow"
- Added branded invite emails via Resend with install instructions and quick setup guide
- Added sidebar navigation to portal dashboard (Account, AI & MCP, Team sections)
- Added profile editing (display name, change password) to portal
- Added MCP setup instructions with tabs for Claude Code, Claude Desktop, Claude Web, ChatGPT
- Added role-based dashboard views (owner/admin see team management, members see limited view)

### Changed
- Version bumped to 4.0.0
- Portal live at custom domain `app.jtpowertools.com`

### Fixed
- Fixed team members table showing removed members — added `status = 'active'` filter to team query
- Fixed password verification crash on legacy base64 hash format — dual-format detection (legacy base64 vs iterations:salt_hex:hash_hex)
- Fixed portal auth queries using wrong table — updated from `users` to `licenses` table with correct column names

### Fixed
#### MCP Server Tool Quality Fixes
- Fixed `search_jobs` status filter returning too few results — now over-fetches (100) before client-side filtering by computed status, then applies user's requested limit
- Fixed `list_tasks` and `get_schedule` returning 413 Request Entity Too Large on jobs with many tasks — reduced default limit from 50 to 25, capped max at 50, removed `description` field from bulk queries, and limited nested `assignedMemberships` size
- Fixed `get_org_summary` and `get_documents_summary` amount labels — renamed `totalCents` to `total` and updated descriptions from "cents" to "dollars" to match actual Pave API values

### Added
#### MCP Server — Dashboard Management Tools
- Added `jobtread_create_dashboard` tool — create dashboards from 7 predefined templates or custom tile arrays
  - Templates: `project-overview`, `accounts-payable`, `accounts-receivable`, `schedule-overview`, `field-kpis`, `sales-tracking`, `vendor-tracking`
  - Each template uses F-pattern layout with KPI tiles, charts, and data tables
  - Supports `visibleTo` parameter for role-based access control ("all", "internal", or specific role names)
- Added `jobtread_update_dashboard` tool — rename, add tiles, remove tiles, or replace all tiles
  - Automatically fetches existing tiles before merging to prevent the "tiles replace all" API gotcha
  - Auto-positions new tiles below existing content
- Added delete mutation guard to `raw_query` — blocks any query key starting with `delete` and directs users to the JobTread UI

#### MCP Server — Team Notes Write Tools
- Added `jobtread_create_team_note` tool — save notes to org's shared knowledge base with folder categorization (default: "AI Notes")
  - AI-created notes tagged with user name + "(via AI)" for attribution
- Added `jobtread_update_team_note` tool — update existing team note title, content, folder, or pin status

#### MCP Server — Workflow Read Tools
- Added `jobtread_list_workflows` tool — list all automation workflows with trigger type, active status, and 10-workflow org limit
- Added `jobtread_get_workflow` tool — get full workflow detail with nested action tree and trigger configuration
- Added `jobtread_list_workflow_runs` tool — list recent workflow execution history with status filtering

#### MCP Server — Workflow Builder Tools
- Added `jobtread_create_workflow` tool — create automation workflows with nested action trees
  - Supports all 66 trigger types and 41 action types
  - Auto-generates action IDs for the nested action tree
  - Creates workflows as inactive by default for safety review
  - Tool description guides AI to check existing workflows first before creating new ones
- Added `jobtread_update_workflow` tool — update workflow name, trigger, active status, or action tree
  - Actions array replaces the entire tree (same pattern as dashboard tiles)
  - Preserves existing action IDs when provided, generates new ones for additions

### Improved
- Added `hasMore` and `count` fields to `list_tasks` and `get_schedule` responses for pagination awareness
- Improved `list_tasks` tool description to clarify it returns names/dates/assignees and to use `get_schedule` for more detail
- Improved `get_schedule` tool description to differentiate from `list_tasks` (includes task types and parent hierarchy)

## [3.7.0] - 2026-03-14

### Added
#### Budget — Expand/Collapse All Groups Button
- Added Expand/Collapse All Groups button to budget table Name header
  - Single smart toggle button auto-detects current group state
  - Shows Phosphor ArrowsOut/ArrowsIn icons matching detected state
  - Clicks native expand/collapse buttons 5 times to cover all nesting levels
  - Updates icon when native expand/collapse buttons or group chevrons are clicked
  - Styled to match native JobTread header buttons exactly

### Changed
- Renamed **Task Type Filter** to **Unassigned Availability** in popup and docs
  - Updated description to "See unassigned tasks in schedule availability, filtered by type"
  - Added docs guide page for the feature

### Security
#### MCP Config & Grant Key Hardening
- Removed grant key copy button from popup — grant keys are sensitive and should not be re-exposed after initial creation
- Changed grant key display from masked value to simple "Configured" / "Not configured" status
- Removed credential embedding from generated MCP configs — configs now use `<YOUR_LICENSE_KEY>:<YOUR_GRANT_KEY>` placeholders
- Status message guides users to replace placeholders with their credentials

## [3.6.93] - 2026-03-12

### Added
#### MCP Server — File Upload Tools
- Added `jobtread_upload_file` tool — uploads a file from a URL to a JobTread job as a comment attachment
- Added `jobtread_upload_file_to_cost_item` tool — uploads a file from a URL and attaches it directly to a budget line item
  - Both tools fetch the file, create a signed upload request via Pave, upload the binary, and attach to the target entity
  - Supports images (JPG, PNG, GIF, WebP), PDFs, and documents up to 25MB

### Fixed
#### Firefox Extension — Browser Polyfill & Compatibility
- Fixed Firefox extension popup not refreshing the JT page when toggling settings — `chrome.tabs.query/reload/create` were not polyfilled for Firefox MV2
- Fixed Firefox popup dark mode toggle not persisting — `chrome.runtime.sendMessage` was not returning Promises in Firefox
- Fixed `setIcon` crash in Firefox MV2 background script — `browserAction.setIcon()` returns `undefined` (not a Promise), now handled gracefully
- Expanded `browser-polyfill.js` to cover `chrome.tabs` (query, reload, create, sendMessage) and `chrome.runtime.sendMessage` in addition to existing storage and action/browserAction polyfills
- Synced `manifest.firefox.json` content scripts and web_accessible_resources with current Chrome manifest (added task-type-filter)
- Synced inline fallback defaults in both `background.js` and `service-worker.js` to match `defaults.js` (added 8 missing feature keys)

### Changed
#### MCP Popup — Full Tool Reference
- Updated MCP tab to list all 57 tools (was 24 read-only)
  - Added 12 missing read tools: Full Budget, Budget Tree, Budget Backups, Compare Budgets, Job Activity, Global Search, Org Summary, Search Files, Template Jobs, Task Templates, Cost Group Templates
  - Added all 21 write tools organized by category: Jobs, Budget, Tasks, Accounts & Contacts, Locations, Daily Logs & Comments, Time Entries
  - Write tools visually distinguished with green icons; read tools keep orange icons
  - Updated beta banner, "What is MCP" description, and safety hint to reflect read + write access

### Improved
#### MCP Server — Token Efficiency
- Reduced token consumption for AI clients across all 57 MCP tools
  - Trimmed all tool descriptions — removed verbose "BEFORE CREATING/UPDATING" guidance from write tools, condensed read tool descriptions
  - Shortened all parameter `.describe()` strings (e.g., `'The JobTread job ID'` → `'Job ID'`)
  - Removed redundant `_tip` and `_note` instructional fields from response payloads
  - Removed `sizeFormatted` from file responses (kept `sizeBytes`)
  - Switched MCP responses from pretty-printed JSON to compact JSON (removed whitespace tokens)
  - Compressed 7 PAVE_KNOWLEDGE sections (query_syntax, filtering, pagination_sorting, custom_fields, aggregations, data_accuracy, mutations) — kept information-dense sections like examples, text_formatting, and functions intact

### Fixed
#### Character Counter
- Fixed character counter and message template buttons pushing the Send button off-screen in narrow/resizable task and to-do sidebars
  - Counter and template buttons now render in their own compact row above the action bar instead of injecting into JT's button wrapper
  - Send button remains fully visible and accessible at any sidebar width

#### Availability Filter
- Fixed availability filter positioning at the job level — filter now inserts directly above the availability grid instead of at the top of the page above the task list

#### Dark Mode
- Fixed schedule availability task cards not being styled in dark mode — cards with inline background colors now get a dark overlay and white text, matching existing schedule card behavior

#### Text Formatter
- Fixed formatter toolbar not appearing in Daily Log and Cost Item Details sidebars — orange-header sidebar exclusion was too broad; now only excludes utility panels (Help, Time Entry, Time Clock, Files) that don't support markdown
- Fixed formatter toolbar following focus to non-Description fields in the budget table — toolbar now only appears on Description fields and is actively hidden when focus moves to Name or other budget cells
- Fixed budget description toolbar covering the line item row above the active field — toolbar now renders in `document.body` with `position: fixed`, positioned above the active Description cell
- Fixed toolbar not following the textarea when scrolling — toolbar pins just below the budget header row on scroll (sidebar-like behavior)
  - Toolbar width and horizontal position track the Description column automatically
  - Cell DOM is completely untouched — no cursor alignment issues
  - Toolbar slides smoothly behind the budget header when the field's bottom edge scrolls past (clip-path transition)
  - Correct z-index layering ensures toolbar renders above the sticky header when pinned

#### Freeze Header
- Added Files sidebar to global sidebar detection — prevents the Files detail panel from being pushed down by frozen headers
- Fixed full-page overlay sidebars (History, Selection Details) being pushed down by frozen headers — sidebars inside `absolute inset-0` containers are now excluded from positioning adjustments

#### Custom Theme (RGB)
- Fixed Custom Theme task card overlay covering assignee avatar icons — `.rounded-full` elements with `background-image` are now excluded from the `::before` overlay

#### Firefox Compatibility — License Proxy
- Fixed "Unauthorized origin" error on Firefox sync requests — Firefox content scripts may strip the `Origin` header on cross-origin fetches; license proxy now allows requests with valid JWT tokens even without an Origin header

### Changed
#### Availability Filter
- Redesigned availability assignee filter to compact single-row layout matching the Task Type Filter style
  - Replaced card-style panel with inline bar: title | badge | category chips | actions | collapse toggle
  - Category chips now display inline with expand arrows (▸) to reveal assignee sub-chips in a drawer below
  - All/None buttons and Saved Views moved inline with the bar for a more compact footprint
  - Lowered z-index so JT's task sidebar renders above the filter bar
  - Rewrote CSS for new compact HTML structure with dark mode and RGB theme support

### Fixed
#### Task Type Filter
- Refactored Task Type Filter to route API calls through Pro Worker instead of direct Pave calls
  - Added `getTaskTypes` and `getUnassignedTasks` action handlers to Pro Worker with KV caching
  - Added corresponding `getTaskTypes()` and `getUnassignedTasks()` methods to `JobTreadProService`
  - Removed direct Pave query functions (`executePaveQuery`, `getGrantKey`, `getOrgId`) from the feature
  - Feature now uses authenticated Pro Worker pipeline (license + device auth) like Custom Field Filter
- Fixed Pave 413 "Request Entity Too Large" error — reduced page size from 100 to 50 for tasks query (nested connections exceeded Pave response limit) and trimmed unused fields (`endDate`, `progress`, `completed`, `user` details from assignedMemberships)
- Fixed task groups/phases appearing as tasks — added `parentTask != null` filter to Pave query (server-side) and `taskType != null` check (client-side) to exclude group headers
- Fixed week switching not refreshing data — `scanAndBuild` now tracks last-fetched date range and forces a fresh API call when the visible dates change
- Fixed task click opening JT 404 — `openTaskSidebar` was prepending an incorrect org slug (e.g. `/schedule/schedule?taskId=...`), now uses the current pathname to build the correct URL
- Fixed filter bar positioning — uses `<div>` above table instead of `<tr>` for proper rendering
- Fixed dark mode colors — replaced dark blues with neutral grey palette per project standards

### Added
- Added 20 write tools to MCP server — create and update operations for all major entities
  - **Comments**: Create/update comments on jobs, tasks, daily logs, documents, files
  - **Daily Logs**: Create/update daily log entries with notes and custom fields
  - **Tasks**: Create/update schedule tasks and to-do items with dates, assignees, progress
  - **Jobs**: Create/update jobs with custom fields, clone budget/schedule from templates
  - **Accounts**: Create/update customer and vendor accounts
  - **Contacts**: Create/update contact people under accounts
  - **Locations**: Create/update job sites with auto-address parsing
  - **Budget**: Create/update cost items (line items) and cost groups (categories)
  - **Time Entries**: Create/update time tracking with running timer support
  - Updated knowledge base mutations section with comprehensive schema reference
  - Design decision: NO delete operations (safety boundary)
- Added 8 advanced read tools to MCP server for deeper insights
  - **Full Budget**: Auto-paginating budget retrieval (up to 2000 items) with accurate totals
  - **Budget Tree**: Hierarchical budget view with cost groups, nested items, and subtotals
  - **Job Activity**: Unified timeline combining comments, daily logs, and tasks
  - **Global Search**: Cross-entity search across jobs, accounts, contacts, tasks, and locations
  - **Budget Comparison**: Diff current budget vs backup snapshot (added/removed/changed items)
  - **Org Summary**: Organization-level metrics (job counts, customer/vendor counts, invoice totals)
  - **File Search**: Search files by name, folder, or tags across jobs or the entire organization
  - **Template Jobs**: List jobs with budgets/schedules available for cloning into new jobs
- Added pre-flight guidance to all 20 write tool descriptions
  - Create tools instruct AI to research team notes, existing data, custom fields, and duplicates before creating
  - Update tools instruct AI to read current values before modifying
  - Reduces hallucinations and bad data entry from AI assistants
- Added budget backup history tool (`jobtread_get_budget_backups`) to MCP server
- Added 3 template/catalog tools to MCP server for schedule and budget templates
  - **List Task Templates** (`jobtread_list_task_templates`): Browse org schedule templates with task previews
  - **Import Task Template** (`jobtread_import_task_template`): Import a template's tasks into a job schedule
  - **List Cost Group Templates** (`jobtread_list_cost_group_templates`): Browse budget catalog with cost item previews
  - Added taskTemplate and costGroup (org-level) entities to knowledge base

### Fixed
- Fixed MCP time entry type auto-detection to query per-membership types instead of org-level
  - `organization.timeEntryTypeNames` returns all org types, but not all are valid for every user
  - Now queries `membership.timeEntryTypes` to get the current user's valid types
- Fixed MCP task progress conversion — Pave API uses 0-1 scale, tool accepts 0-100 and converts automatically
- Fixed MCP cost item creation requiring `costCodeId` (now properly required by Pave API)
- Fixed MCP cost item `costTypeId` parameter — auto-detects "Other" cost type if not provided

### Added
- Added data accuracy knowledge section to MCP knowledge base
  - 7 rules for accurate reading/reporting: partial data disclosure, financial amounts (dollars vs cents), selection groups, computed vs stored fields, never infer missing data, cross-referencing, number formatting
  - Added gotchas for partial data totals and selection group budget items
  - Updated read tool descriptions with accuracy warnings
- Added JT Power Tools knowledge to MCP knowledge base
  - AI assistants can now look up extension features, keyboard shortcuts, and tips
  - Includes contextual suggestions (e.g., suggest Freeze Header for large budgets)
  - Available via `jobtread_knowledge_lookup` with keyword search or `jt_power_tools` category
- Added Safari Web Extension build framework (build-safari.sh + GitHub Actions CI)
  - `build-safari.sh` — macOS build script using `xcrun safari-web-extension-converter`
  - `.github/workflows/build-safari.yml` — CI workflow on macOS 15 with Xcode 16.2
  - Unsigned debug builds run automatically on push to main
  - Xcode project uploaded as artifact for local testing
- Added Firefox install button to website alongside Chrome and Edge
  - Links to Firefox Add-ons listing
  - Updated mobile notes to mention Firefox & Android support
- Added `moz-extension://` and `safari-web-extension://` origin support to license proxy
  - Firefox and Safari use random per-install UUIDs, so all origins from these schemes are allowed
- Added **Keyboard Shortcuts Enhancement** — always-on feature that enriches JT's native Shift+? modal
  - Injects missing JT native shortcuts: Job Actions, Budget Actions, Catalog Actions, Schedule & To-Do Actions
  - Appends missing items to existing Navigation and General Actions sections (Go to Messages, Save Changes, Redo, etc.)
  - Adds JT Power Tools shortcuts section (Q+N, Ctrl+B/I/U)
  - Dark mode support — automatically styles the entire modal when Dark Mode is active
  - Uses MutationObserver to detect modal appearance; matches JT's exact HTML structure and classes

### Changed
- Renamed **Quick Job Switcher** to **Smart Resize** in popup and docs
  - Updated description to "Resize any sidebar" to reflect the generic sidebar resize capability

### Fixed
- Fixed Text Formatter toolbar blocking Tab key navigation in message compose fields
  - Toolbar buttons now set `tabindex="-1"` so Tab skips over them entirely
  - Affects both embedded (message) and floating (budget) toolbar variants
- Fixed Firefox `chrome.storage.local` not persisting (popup theme, grant key)
  - Root cause: Firefox's `chrome` object may have non-writable `storage` property
  - Polyfill now uses 3-tier override: direct assignment → `Object.defineProperty` → individual area patching
  - Added verification flag (`_jt_polyfilled`) to confirm override took effect
- Fixed Firefox "unauthorized origin" error when validating license keys
  - License proxy now accepts `moz-extension://` origins (previously only `chrome-extension://`)
- Fixed drag-drop checkboxes appearing on fresh installs without a license key
  - Changed `dragDrop` default from `true` to `false` in all fallback locations
- Fixed Freeze Header pushing down Daily Log and Notifications sidebars
  - Root cause: CSS `text-transform: uppercase` doesn't affect `textContent`
  - All sidebar detection now uses case-insensitive comparison
- Fixed Freeze Header pushing down Time Entry and Add Time Entry sidebar headers
  - Added `isTimeEntry` detection (TIME ENTRY, ADD TIME, TIME ENTRIES) to global sidebar marking
  - Time Entry sidebars now stay at native header-level positioning like Time Clock

### Improved
- Smart Job Switcher sidebar resize is now generic — resize handles appear on **any** JobTread sidebar (documents, task details, etc.), not just the Job Switcher
  - Each sidebar type remembers its own width independently (detected from header text)
  - Distinguishes "push" sidebars (Job Switcher, Notifications, Help, Daily Logs, Time Clock, Time Entry — adjusts main content padding) from "overlay" sidebars (Cost Item Details, Budget panels, Schedule Tasks — float on top without pushing content)
  - Push classification now checks only header-level elements (h1-h3, bold/semibold text), not full sidebar body content, preventing false positives from body text references
  - Explicit overlay exclusion list for Cost Item, Cost Group, Budget, Estimate, etc. prevents misclassification
  - Daily Logs push now adjusts ALL sibling containers (navigation, headers, and content) — matching Job Switcher behavior
  - Only applies a saved width if the user has previously resized that specific sidebar type; otherwise leaves it at its natural size
  - Switched width storage from `chrome.storage.sync` to `localStorage` for synchronous reads and per-device preferences
  - Existing users' saved Job Switcher width is automatically migrated on first run
  - Uses `WeakSet` to track enhanced sidebars and prevent double-injection of resize handles
  - Data attributes (`data-jt-push-padding`) track manually padded elements for precise cleanup on sidebar close
  - Keyboard shortcuts (J+S, Alt+J) remain unchanged
- Firefox storage polyfill now wraps `browser.storage` to support both Promise and callback patterns
- Bumped Firefox manifest version to 3.6.91

## [3.6.9] - 2026-03-06

### Added

#### MCP Server — PDF Parsing
- **Added `jobtread_parse_pdf` tool** — AI assistants can now extract text content and metadata from PDF files attached to JobTread jobs or from direct URLs. Accepts a JobTread file ID (from `jobtread_get_job_files`) or a direct URL. Returns per-page text with page dimensions and document metadata (title, author, creation date, PDF version). Supports configurable page ranges (e.g., "1-5", "1,3,5"). Enables workflows like bid leveling, scope alignment, contract review, and spec analysis.
  - **Safeguards**: 25 MB file size limit, 50-page max per request, 10s fetch timeout, 100 KB per-page text cap, PDF magic-byte validation, HTTPS-only URL enforcement
- **Added scanned PDF image extraction** — Pages with little or no extractable text (< 50 chars) are automatically detected as scanned/image pages. Embedded images are extracted via `unpdf`'s `extractImages()`, downscaled to max 1600px, encoded as PNG using a pure-JS encoder (with `CompressionStream` for DEFLATE), and returned as base64 MCP image content blocks. AI clients with vision (Claude, ChatGPT) can now "read" scanned bid documents, hand-written notes, and image-based PDFs directly.
  - **Limits**: 3 images per page, 2 MB per page, 5 MB total across all pages

#### MCP Server — Custom Fields Enhancement
- **Enhanced `jobtread_get_custom_fields` tool** — Now accepts an optional `targetType` parameter to filter custom fields by entity type: `job`, `location`, `account` (customer/vendor), `dailyLog`, or `costItem` (budget line items). Omit the parameter to return all custom fields across all types. Previously hardcoded to job fields only.

#### MCP Server — Dashboards
- **Added `jobtread_list_dashboards` tool** — List all dashboards in the organization with names, types, and IDs.
- **Added `jobtread_get_dashboard` tool** — Get a specific dashboard with all its tiles (widgets), including tile position (x, y), size (width, height), and configuration options.

#### MCP Server — Tool Naming Alignment
- **Renamed `jobtread_search_contacts` → `jobtread_search_accounts`** — Now searches for customers, vendors, and subcontractors (accounts) by name, returning accounts with their nested contacts (people). Aligns with JobTread's terminology where accounts are the primary entity and contacts are people within them.
- **Renamed `jobtread_get_financial_summary` → `jobtread_get_documents_summary`** — Matches JobTread's "Documents" terminology for estimates, invoices, purchase orders, bills, and change orders.
- **Updated tool descriptions** across all tools to use JobTread-specific terminology (cost items, cost groups, schedule, tasks & to-dos, documents vs files, accounts vs contacts).
- **Updated popup tool list** — Reflects all renames, adds Dashboards and Parse PDF sections, updates tool count to 24.

#### MCP Server — Knowledge Base Expansion
- **Added text formatting knowledge** — AI assistants can now look up JobTread's custom Markdown syntax (bold `*text*`, italic `^text^`, underline `_text_`, justification, colors, alerts, tables) via the `text_formatting` category.
- **Added formulas & parameters knowledge** — Reference for building cost item formulas with job parameters, parent quantities, custom fields, and construction-specific examples (concrete, paint, drywall, roofing) via the `formulas_parameters` category.
- **Added functions knowledge** — Complete reference for arithmetic operators, math functions, conditional logic (if/and/or), and utility functions (coalesce, cast, number) via the `functions` category.

#### MCP Server
- **Added OAuth 2.1 support** — ChatGPT and Claude.ai can now connect via OAuth auto-discovery (`.well-known/`). Users just paste the server URL; the AI client handles the full OAuth flow with PKCE. Authorization page lets users enter their License Key and Grant Key.
- **Added `jobtread_knowledge_lookup` tool** — AI assistants can now query a built-in Pave API reference to learn the correct query format, available entity fields, filtering operators, and common pitfalls before writing raw queries. Organized into 8 categories: query syntax, entities, filtering, pagination/sorting, mutations, custom fields, aggregations, gotchas, and examples.
- **Updated `jobtread_raw_query` description** to direct AIs to call `jobtread_knowledge_lookup` first, reducing failed queries from incorrect format or nonexistent fields.

#### Popup — MCP Tab
- **Redesigned platform config generator with two-level picker**: Level 1 selects AI provider (Claude, ChatGPT, Gemini), Level 2 selects variant (Code, Desktop, Web) — only shown for Claude
- **Added Claude.ai (Web) platform** with OAuth badge and step-by-step setup instructions (Settings → Connectors → Add custom connector)
- **Added ChatGPT OAuth instructions** — Settings → Apps → Advanced settings → Enable developer mode → Create app → Paste URL
- **Added credential copy buttons** — License Key and Grant Key rows now have individual copy buttons for quick access
- **OAuth platforms auto-enable Copy button** — ChatGPT and Claude Web only need the server URL (no keys required to copy)

### Changed

#### Popup — MCP Tab
- Removed standalone "Server URL" section (redundant — config generator handles URL copying for OAuth platforms)
- Platform notes now use numbered steps for OAuth platforms and command blocks for CLI platforms
- Updated ChatGPT and Claude Web setup instructions in docs site (`docs/mcp/chatgpt.html`)

### Added

#### Custom Field Filter
- **Multi-field filtering** — filter jobs by multiple custom fields simultaneously with AND logic (e.g., PM = "John" AND Job Type = "Renovation"). Active filters appear as clickable chips between the field dropdown and values area. Click a chip to edit its values, click × to remove it. Fields already in use are hidden from the dropdown. Saved filters support both single and multi-field formats with backward compatibility.

### Fixed

#### Character Counter & Templates
- **Fixed character counter not moving inline in reply forms** — Broadened toolbar detection to recognize reply form toolbars (which lack a Send button but have a right-side button container). Counter and template button now appear inline in the toolbar instead of a separate wrapper row.

#### Reverse Thread Order
- **Fixed Reply button sitting too low** — Switched from negative margin to absolute positioning so the Reply button overlays the header bar's right side cleanly, aligned with the participants row.

#### Freeze Header
- **Fixed sidebar going behind frozen navigation on Documents and Schedule pages** — sidebars (Cost Group/Item Details, Update Task, Task Details) had their scroll containers stuck at `top: 48px`, overlapping the frozen tab navigation. CSS-only fixes couldn't work because JobTread's JavaScript continuously overwrites the inline `top` and `max-height` on scroll. Now uses a dedicated MutationObserver that watches for style attribute changes on sidebar scroll containers and immediately re-corrects the positioning below the frozen tabs. Also fixes the sidebar scrollbar being cut off at the bottom on Schedule pages.

#### Custom Field Filter
- **Added dedicated Saved Filters dropdown** — saved filters were previously hidden inside the job status dropdown as an optgroup, making them undiscoverable. Now appears as its own dropdown between the status and field selects, visible whenever saved filters exist.

#### MCP Server
- **Fixed MCP endpoint failing for Claude.ai and other OAuth clients** — replaced `createMcpHandler` from `agents/mcp` (which enforced strict `Accept: text/event-stream` header and returned SSE streams) with a direct Streamable HTTP handler that returns JSON responses. This fixes the "McpServerError: temporarily unavailable" error when connecting from Claude.ai.
- **Fixed Claude.ai and ChatGPT failing to connect after OAuth** — OAuth clients were posting MCP requests to the base URL (`/`) but the MCP handler only listened on `/mcp`. Added `/` as an authenticated MCP route so both paths work. Also updated the popup copy button and docs to provide the full `/mcp` URL for OAuth platforms.
- **Fixed `jobtread_search_contacts` failing with 400 error** — was using invalid `contains` operator in Pave WHERE clause. Now uses `like` with `%wildcards%`. Also implemented the previously unused `type` filter parameter (customer/vendor/subcontractor).
- **Fixed `jobtread_search_jobs` failing with 400 error when filtering by status** — `status` is a computed field in Pave that cannot be used in WHERE clauses. Now uses `closedOn` null checks for open/closed filtering with client-side filtering for specific status values. Also corrected the status enum to accept actual Pave values (`created`, `approved`, etc.) instead of incorrect UI labels.
- **Fixed `jobtread_list_locations` search using invalid `contains` operator** — now uses `like` with `%wildcards%`.
- **Corrected `jobtread_knowledge_lookup` reference content** — removed `contains` from valid operators, fixed null check syntax (JS `null` not string `"null"`), fixed job status examples to use actual Pave values, added gotcha about `status` being computed/unfilterable.

#### Popup — MCP Tab
- **Fixed undefined CSS variables** causing invisible active states on platform tabs — replaced `--accent-primary`, `--accent-subtle`, `--bg-hover` (never defined) with actual color values
- **Cleaned up duplicate CSS rules** for `.platform-tabs` and `.platform-tab` that were left over from the old layout

## [3.6.7] - 2026-03-01

### Fixed

#### Text Formatter
- **Fixed formatter toolbars appearing in every description field when budget loads with collapsed groups**: When groups were collapsed on load, the DOM structure wasn't fully in place, causing budget description fields to incorrectly receive embedded toolbars. Added a visibility check (`offsetParent`) to skip pre-creating toolbars for hidden fields — they're created on-demand when focused instead.

#### Freeze Header
- **Fixed Add/Edit Items panel headers scrolling away instead of staying frozen**: Our CSS was resetting `z-index: auto` on the panel's sticky header, causing data rows to paint on top of it. Now preserves the header's z-30 stacking context so line items scroll behind the frozen header.
- **Fixed Cost Item Details sidebar stuck behind frozen navigation bar**: The sidebar's scroll container wasn't being detected and repositioned below the frozen tabs/toolbar. Now detects both "Add / Edit Items" and "Cost Item Details" panels and positions them correctly below frozen headers.
- **Fixed footer totals row in Add/Edit Items panel losing its bottom-sticky positioning**: The drag-boundary CSS rule was incorrectly adding a `top` value to footer elements with `bottom: 0`. Added exclusion for sticky elements with bottom positioning.

#### Dark Mode
- **Fixed spreadsheet exports showing blank data when dark mode is enabled**: Dark mode text color overrides (e.g., white text on dark backgrounds) were being included in exports to apps like Mac Numbers. Wrapped text color rules in `@media screen` so they only apply on-screen, not during export.

### Added

#### MCP Server Integration (Beta)
- **Launched MCP tab in popup** replacing the "Coming Soon" placeholder with full setup experience
- MCP tab now includes: prerequisites checklist, platform-specific config generator (Claude Code, Claude Desktop, ChatGPT, Gemini), credential status display, server URL with copy button, and a categorized list of all 22 read-only tools
- Config generator auto-embeds user's License Key and Grant Key for one-click copy
- Prerequisite links navigate directly to the License or API tab when keys are missing
- Prominent BETA badge and read-only banner clearly communicate the current status

#### MCP Server Expansion (Power User Tier)
- Added 15 new read-only MCP tools for deeper AI assistant visibility into JobTread data
- **Job-scoped tools**: `get_job_details` (composite summary), `get_daily_logs`, `get_daily_log`, `get_schedule`, `get_time_entries`, `get_job_files`, `get_financial_summary`
- **Org-wide tools**: `get_account_details`, `get_comments`, `list_locations`, `list_members`, `list_cost_codes`
- **Team Notes tools**: `search_team_notes` (full-text search), `list_team_notes` — AI can now read and search shared team notes
- Financial summary uses Pave aggregation for document totals by type and status
- Time entries include computed `durationHours` from start/end timestamps
- Added corresponding Pro Worker action handlers for non-MCP clients

## [3.6.6] - 2026-02-27

### Added

#### Company Shared Templates (Essential+ Tier)
- Added org-wide "Company Templates" tab to the template dropdown
- Any team member (Essential tier or higher) can create, edit, and delete shared templates
- Templates are shared across all users in the same organization
- Tabbed UI with "My Templates" and "Company" tabs (mirrors Team Notes pattern)
- Company tab selected by default for paid users
- Created-by attribution shows who made each template
- 5-minute client-side cache for team templates
- Template buttons now appear on Daily Log Notes textarea in the sidebar
- Full dark mode support with neutral grey color palette
- Free users see no changes — personal templates work exactly as before

### Fixed

#### Text Formatter
- **Fixed formatter toolbars covering Cancel/Save buttons in Daily Log sidebar**: When switching between textareas, the previous toolbar's sticky positioning was never cleared (the scheduled `hideToolbar` was cancelled by `clearHideTimeout`). Now only the actively focused toolbar gets sticky positioning — all others are reset to normal document flow. Added CSS z-index rule to ensure sidebar sticky footers always render above formatter toolbars.

#### Company Shared Templates
- **Fixed Manage Templates modal (settings gear) not supporting company templates**: The modal now shows the same My Templates / Company tab bar as the dropdown, with tab-aware create, edit, and delete operations routed to the correct API
- **Fixed Daily Log Notes detection failing when Freeze Header is disabled**: Detection no longer depends on `.jt-global-sidebar` class (added by Freeze Header); now also detects native sidebar structure (`div.sticky.overflow-y-auto.overscroll-contain`) with Daily Log content verification
- **Fixed race condition in tier check**: `checkEssentialTier()` is now awaited before processing fields, ensuring tabs render correctly on first load
- **Fixed Company tab showing empty on first dropdown open**: Team templates are now fetched when Company tab is the default active tab
- **Fixed "Set as default" checkbox appearing for company templates**: Checkbox is now hidden in the edit modal when creating or editing company templates (defaults are personal-only)

### Security

#### Service Worker API Proxy
- **Fixed SSRF vulnerability in API proxy**: The `JOBTREAD_API_REQUEST` message handler now validates sender origin (must be from the extension or a JobTread tab) and enforces a URL allowlist (only `api.jobtread.com` and `app.jobtread.com`). Previously, the proxy could be used to fetch arbitrary URLs.

#### Preview Mode
- **Fixed XSS in markdown preview renderer**: Raw text is now HTML-escaped before inline formatting is applied, preventing injection of malicious HTML tags. Link URLs are sanitized via `Sanitizer.sanitizeURL()` to block `javascript:` and `data:` URI schemes. Table and alert HTML blocks are preserved using placeholder tokens during escaping.

#### Quick Notes
- **Fixed `javascript:` URL injection in markdown links**: Both `processInlineFormatting()` and `parseMarkdown()` now sanitize link URLs through `Sanitizer.sanitizeURL()` to block dangerous URI schemes.

#### Budget Changelog
- **Fixed XSS via unsanitized error messages**: Server-returned error strings are now escaped before injection into `innerHTML`.
- **Fixed unsanitized API data in backup selector**: Usernames, IDs, URLs, and dates from the API are now escaped with `escapeHtml()` before being interpolated into HTML option elements.

#### CORS Hardening
- **Tightened CORS on Pro Worker and License Proxy**: Both workers now resolve the `Access-Control-Allow-Origin` header from the `ALLOWED_ORIGINS` environment variable per-request instead of returning `*`. Responses include `Vary: Origin` when origin-specific.

### Fixed

#### Memory Leaks
- **Fixed `setInterval` leak in Auto Collapse Groups**: URL-check interval and `popstate` listener are now stored at module level and cleared in `cleanup()`, preventing orphaned timers after feature disable.
- **Fixed `setInterval` leak in Freeze Header**: URL-check interval is now tracked and cleared in `cleanup()`.
- **Fixed `setInterval` leak in Kanban Type Filter**: URL-check interval moved from local const to module-level variable with explicit `clearInterval` in `cleanup()`.

#### Availability Filter
- **Fixed saved filter views not applying when clicked**: The MutationObserver-triggered UI rebuild was clobbering the applied view state. Added a guard flag (`_applyingView`) to skip rebuilds during view application.
- **Fixed `document.addEventListener('click')` leak**: The outside-click handler for the saved views dropdown was re-added on every UI rebuild without removing the previous one. Now tracked at module level and properly cleaned up.
- **Fixed delete view refresh using double-click hack**: Extracted list rendering into a reusable `renderSavedViewsList()` function for direct re-render after deletion.
- **Fixed z-index too high**: Filter container and saved views dropdown now use z-index 20/25 instead of 30/9999, allowing the panel to slide under the frozen header.

### Improved

#### Code Deduplication
- **Consolidated `escapeHtml` into shared `Sanitizer.escapeHTML`**: Six files (availability-filter, budget-changelog-modules/ui, character-counter, custom-field-filter, preview-mode, quick-notes-modules/markdown) now delegate to `Sanitizer.escapeHTML()` instead of maintaining independent copies.
- **Consolidated `adjustColorBrightness` into shared `ColorUtils.adjustBrightnessPercent`**: Added percentage-based brightness adjustment to `color-utils.js`. Preview Mode and Quick Notes now delegate to the shared utility instead of defining their own copies.
- **Removed dead `isFormatterField` function from Preview Mode**: Function was defined but never called; removed to reduce code size.
- **Replaced inline `defaultSettings` in popup.js with shared `JTDefaults`**: Popup now loads `utils/defaults.js` and uses `JTDefaults.getDefaultSettings()`, eliminating a stale copy that was missing newer feature flags (`customFieldFilter`, `budgetChangelog`).
- **Auto-device registration on login**: Logging into a JT Power Tools account on a new device now automatically registers the device with the Pro Worker and restores the JobTread API connection. Users no longer need to manually re-enter their grant key or click "Test" in the API tab.
- **Availability filter remembers collapsed/expanded state**: The filter panel no longer resets to collapsed on every UI rebuild. State is preserved across MutationObserver-triggered refreshes.
- **Active filter count badge**: When the availability filter panel is collapsed and filters are active, a badge shows how many assignees are currently hidden.

#### Server Infrastructure
- **Fixed tier enforcement in Pro Worker**: `getUser()` now reads tier from the `licenses` table via LEFT JOIN instead of trusting the `users.tier` default, ensuring purchased tier is always enforced.
- **Added session cleanup on token refresh**: License Proxy now opportunistically deletes all expired sessions during each successful token refresh via `ctx.waitUntil()`.
- **Added scheduled maintenance in Pro Worker**: New Cron-triggered `scheduled()` handler runs daily to clean up api_usage records older than 90 days and expired sessions.
- **Populated `licenses.org_name` on org verification**: Pro Worker's `lockUserToOrg()` now also updates the linked `licenses` record with org_name and org_id, keeping both tables in sync.

### Added

#### Preview Mode
- **Pinned mode**: New pin button in the preview header toggles between docked and pinned modes
  - **Persistent panel**: Pinned panel stays open even when you leave the textarea, requires manual close via X button
  - **Draggable**: Drag the panel by its header bar to reposition anywhere on screen, with viewport bounds clamping
  - **Resizable**: Drag right edge, bottom edge, or corner handle to resize (280-800px wide, 150-600px tall)
  - **Content follows focus**: When pinned, the preview automatically updates to show whichever textarea you click into — no need to close and reopen
  - **Position/size memory**: Pinned panel position and dimensions are saved and restored across sessions

## [3.6.51] - 2026-02-23 (Hotfix)

### Fixed

#### Freeze Header
- **Fixed global sidebars dropping down on some devices**: On devices where the header height resolves to a sub-pixel value (e.g. 47.9688px instead of 48px), global sidebars like Notifications and Daily Logs were incorrectly pushed below the frozen tabs/toolbar. Fixed by allowing content-detected global sidebars inside `data-is-drag-scroll-boundary` containers, using `var(--jt-header-height)` instead of hardcoded 48px for global sidebar positioning, and widening the inline style exclusion range to 45-52px.

#### Text Formatter
- **Fixed overflow dropdown items oversized compared to compact toolbar**: The overflow dropdown items were 32px while the rest of the compact toolbar uses 22px. Shrunk dropdown items to match with consistent font-size (11px), padding, SVG sizing (12px), and container dimensions.

## [3.6.5] - 2026-02-21

### Added

#### Freeze Header
- **Job context indicator**: When scrolled past the job header, the current job name/number now appears in the top header bar (between the logo and search) so users always know which job they're viewing. Clicking the label opens the Job Switcher. Uses zero additional screen space. Supports dark mode and custom themes.

#### Custom Field Filter Enhancements
- **Multi-select filtering**: Select multiple values for a custom field with OR logic — jobs matching ANY selected value are shown. Replaces the single-value dropdown with a checkbox dropdown component featuring Select All / Clear All controls and a selected count badge.
- **Saved Filters**: Save and load named filter presets via the status dropdown. Saved filters appear as selectable options alongside All Jobs / Open Jobs / Closed Jobs. Selecting a saved filter auto-populates the field and values then applies the filter. Save (floppy icon) and delete (trash icon) buttons appear contextually next to the values dropdown. Shared across all users in the same company. Requires login to a JT Power Tools account.
- **Saved Filters API**: New `/sync/saved-filters` endpoints on the license proxy Worker with D1 database migration for company-scoped filter persistence.

### Removed
- **Quick Notes floating button**: Removed the floating blue button fallback that appeared when the header bar wasn't found. Quick Notes now only appears via the header icon.
- **Task completion retry logic**: Removed the exponential-backoff retry mechanism for checkbox injection since the MutationObserver already handles re-initialization when new DOM nodes appear.

### Fixed

#### Quick Notes
- **Fixed extension running on jobtread.com marketing site**: Content scripts were matching `*.jobtread.com` which caused the extension (including the Quick Notes floating button) to run on the marketing site. Restricted content scripts to `app.jobtread.com` only.

#### Freeze Header
- **Fixed global sidebars dropping down with blank space above**: Full-height sidebars like Notifications and Job Switcher were being pushed below the frozen tabs/toolbar instead of staying at their native position just below the main header. Added Job Switcher content detection to the global sidebar marker, broadened the inline style exclusion range (48-52px), and increased CSS specificity on the `.jt-global-sidebar` rule to reliably override the generic sticky panel positioning.

#### Text Formatter
- **Fixed toolbar appearing on document signature/metadata fields**: The formatter toolbar was incorrectly showing on signature lines, "Prepared By", "From", "To", "Terms", "Footer", and other document metadata fields on invoices, estimates, proposals, contracts, and purchase orders. Added a label heading blocklist to exclude these document-specific fields regardless of URL path.
- **Fixed toolbar appearing on file description fields**: The formatter toolbar was showing on file description textareas in file view/edit popups. The `placeholder="Description"` check was returning `true` before the modal exclusion could run. Moved the modal check inside the Description block so file description fields in any modal are excluded while budget Description fields (which are inline, never in modals) continue to work.
- **Fixed floating toolbar not vanishing when switching fields on budget page**: When clicking from a budget Description textarea (which shows the expanded floating toolbar) to another field like a custom field or Name column, the floating toolbar would remain on screen and reposition over the new field instead of disappearing. Moved the floating toolbar cleanup to run unconditionally when any non-budget-Description field receives focus, rather than only when an embedded toolbar was successfully created.

#### Custom Field Filter (Job Switcher)
- **Fixed saved filters disappearing when saving**: The Job Switcher's keyboard shortcut handler was capturing Enter and Escape key events in the capture phase before the custom field filter's save input could process them. Pressing Enter to confirm a filter name would instead trigger "select top job and close sidebar", navigating away and discarding the save. Added input detection to skip Job Switcher keyboard handling when a custom field filter input is focused, and added `stopPropagation` to the filter's save/cancel handlers.
- **Fixed multi-value custom field filter not returning results**: The Worker API expected a singular `filter.value` property but the client was sending `filter.values` (array) for multi-select support, resulting in undefined filter values and no matching jobs. Updated the Worker to normalize both formats, use the Pave `in` operator for multi-value filtering, and generate correct cache keys from value arrays.
- **Added server-side custom field limits and type exclusion**: The Worker now enforces a maximum of 25 custom fields per query and excludes `multipleText` type fields from the response, matching the client-side filtering for consistent behavior.

#### Task Completion Checkboxes
- **Fixed checkboxes not appearing in grouped Kanban views**: When Kanban is grouped by Job, Type, or other fields, task cards lose the `cursor-grab` class that our selector depended on. Added a fallback selector matching the grouped card class pattern with validation to ensure only actual task cards receive checkboxes.
- **Improved Kanban checkbox reliability**: Made card detection more robust with fallback selectors for header buttons and task name containers. Extracted reusable `findTaskNameDiv()` helper for consistent task name detection across all code paths. Fixed retry logic selector mismatch that only checked `cursor-[grab]` but not `cursor-grab` Tailwind class variant. Increased retry attempts from 3 to 5 for slower-loading pages.

## [3.6.4] - 2026-02-15

### Added
- **Reverse Thread Order** (Essential): New feature that reverses message threads so newest messages appear at the top with the reply form and editor moved above the conversation for immediate access. Works across all message thread locations in JobTread — jobs, documents, daily logs, sidebars, and single-message threads. Uses pure CSS visual reordering to keep React stable.

## [3.6.3] - 2026-02-13

### Improved

#### Custom Theme Presets
- **Quick Themes**: Added 10 preloaded theme presets to the Theme tab as clickable color circles above the saved themes section. Clicking a preset instantly loads and applies the theme.
  - **Light row**: Ocean, Forest, Sunset, Berry, Slate
  - **Dark row**: Midnight, Ember, Neon, Plum, Charcoal

#### Text Formatter Toolbar
- **Compact toolbar everywhere**: Reduced the embedded toolbar size to match the compact modal version (22px buttons, 11px font, 12px SVG icons) for a cleaner, less intrusive look across all contexts
- **Sticky scroll in all contexts**: Extended the sticky scroll behavior (toolbar follows textarea during scroll) to all embedded toolbar locations — modals, job overview columns, and custom fields — not just sidebars
- **Message field toolbar repositioned**: Moved the formatter toolbar from below the message textarea to above it, embedded between the TO line and the message area for easier access while composing

### Fixed

#### Text Formatter on More Pages
- **Re-enabled Text Formatter on Files, Customer, and Vendor pages**: The formatter was previously excluded from these pages. Now that toolbar positioning has been fixed (modal and sidebar overlap issues resolved), the formatter is available on all content pages. Only `/settings`, `/plans`, and `/catalog` remain excluded.
- **Fixed Text Formatter missing on Message fields in document-type pages**: On documents, invoices, estimates, proposals, contracts, and purchase order pages, the formatter was blocked for all non-sidebar fields. Message compose areas are now allowed through the document-type page filter.

#### Text Formatter Toolbar Fix
- **Fixed toolbar covering bottom buttons in edit job popup**: The embedded formatter toolbars were adding too much height in modal popups (e.g., Update Job), pushing the bottom button bar (Delete / Cancel / Update) out of view. Added compact modal-specific toolbar styles — smaller buttons (22px), tighter padding, and minimal margins — so toolbars remain visible and functional without interfering with the modal layout.
- **Fixed sticky toolbar overlapping page headers in sidebars**: When scrolling a sidebar (e.g., UPDATE TASK panel), the formatter toolbar's sticky/fixed positioning would float up into page-level headers (action bar with + Task/+ To-Do, or the Documents/Files/Reports tab bar). Fixed by detecting the sidebar's sticky header boundary and reverting the toolbar to its natural flow position when the textarea scrolls completely above the header area, preventing any overlap with page navigation elements.
- **Fixed formatter toolbar appearing below character counter on page load**: On message fields, a race condition between the formatter and character counter MutationObservers could cause the toolbar to render below the counter and template buttons instead of directly below the textarea. Fixed by anchoring toolbar insertion to the native action bar (Send button row) rather than relying on `nextSibling` ordering.
- **Fixed floating toolbar appearing on custom fields in budget table**: Custom fields like "Internal Notes" on the budget page were incorrectly showing the floating expanded toolbar (meant only for Description fields). A fallthrough bug in `showToolbar()` caused non-Description budget fields to bypass the embedded toolbar check and fall into the floating toolbar code path. Added explicit return to prevent fallthrough.
- **Fixed sidebar toolbar positioning and scroll behavior**: Replaced `position: fixed` with `position: sticky` for sidebar toolbar positioning. Fixed positioning took the toolbar out of the sidebar's stacking context, causing it to render on top of the sidebar header (z-50 vs z-10) and creating phantom hover states on toolbar buttons when the cursor was over the textarea. Sticky positioning keeps the toolbar in the sidebar's flow, naturally slides behind the header, and eliminates all z-index and hover issues.
- **Fixed toolbar staying in floating position after clicking away**: Embedded toolbars in sidebars would remain stuck in `position: fixed` after the textarea lost focus, because `hideToolbar()` only reset floating toolbars. Now resets embedded toolbars back to `position: relative` on blur, and keeps toolbar visible when focus moves to the preview panel.

#### Schedule Task Checkboxes Fixes
- **Added retry logic for slow-loading pages**: Schedule Task Checkboxes now retry initialization up to 3 times with exponential backoff if task cards aren't detected immediately. This fixes issues on slower connections or devices where the Kanban/Calendar view loads after the initial check.
- **Added debounce to MutationObserver**: Prevents multiple rapid reinitializations when DOM changes quickly (e.g., during Kanban drag operations), improving performance and reliability.

#### Dark Mode Checkbox Fix
- **Fixed checkbox circle appearing white in dark mode and custom themes**: JobTread updated their checkbox SVG to use `fill-blue-50` for the circle interior, which rendered as bright white in dark mode and custom themes. Added `fill-blue-50` overrides in both dark mode CSS and custom RGB theme to match the respective background colors.

#### Action Items Completion Fix
- **Fixed Action Items checkbox failing to complete tasks**: The extension's content scripts (including task completion checkboxes) were running inside the hidden iframe used for action item completion, injecting elements that interfered with sidebar and Progress checkbox detection. Added `#jt-completion-iframe` URL marker so `content.js` skips all feature initialization inside the iframe. Also simplified the iframe completion logic to use the Progress checkbox directly (removed checklist detection that was prone to false positives from injected elements).

---

## [3.6.2] - 2026-02-12

### Added

#### Takeoff Print Tool (PDF Markup Tools)
- **New feature: Takeoff Print Tool** integrated into PDF Markup Tools for printing construction takeoff drawings to PDF
  - **Integrated Print button**: Embedded directly into JobTread's native takeoff toolbar (next to Rotate, Ruler, Scale Plan)
  - **Plan comparison view support**: Single print button in comparison mode prints the full visible composite (both overlaid image layers with red/blue filters). Users can toggle layers before printing to control what's included.
  - **Dynamic page sizing**: Automatically measures the drawing and sets the print page size to fit the content exactly (no more hardcoded Tabloid). Based on [FitToPage.js](https://github.com/sulimanbenhalim/fit-to-page) (MIT)
  - **Auto orientation detection**: Automatically selects landscape or portrait based on the drawing's aspect ratio
  - **Clean export**: Hides all JobTread UI when printing, showing only the takeoff drawing
  - **Full theme support**: Works with light mode, dark mode, and custom RGB themes
  - Print button appears automatically whenever the takeoff toolbar is present (SPA-navigation aware)

### Improved

#### Takeoff Print Tool
- **Auto orientation + fit-to-page printing**: Drawing auto-detects landscape vs portrait from its aspect ratio and scales to fill whatever paper size the user selects (Tabloid, Letter, etc.). No longer hardcoded to Tabloid 11x17".
- **Proper SVG measurement**: Uses SVG `viewBox` attributes for accurate intrinsic dimensions instead of `scrollWidth`/`scrollHeight` which could return the wrong container size.
- **Clean print layout**: Drawing is cloned into a dedicated print wrapper instead of using `visibility: hidden`. This prevents the drawing from being trapped inside JobTread's nested flex/absolute containers that distorted print layout.

#### Eraser Tool
- **Improved eraser reliability**: Eraser now simulates a Backspace keypress after selecting an annotation instead of searching for the trash icon button in the DOM. This is more reliable since JobTread natively handles Backspace to delete selected annotations.

### Fixed

#### PDF Markup Tools Fixes
- **Fixed Print button not appearing in takeoff toolbar**: The Print button was gated behind a URL check (`/files/`, `/takeoff/`, `/plans/`) that didn't account for SPA navigation. Since JobTread is a single-page app, navigating to a takeoff page after initial load never triggered the injection. Removed the URL gate and added `injectTakeoffButtons()` to the main MutationObserver so the Print button is injected whenever the takeoff toolbar appears in the DOM, regardless of navigation timing.
- **Fixed "Cannot find takeoff drawing area" in plan comparison view**: The comparison view renders plans as `<img>` elements (not SVGs), so the print container detection failed. Updated `detectTakeoffContainer()` to also find image-based comparison containers, `measurePrintSize()` to read `naturalWidth`/`naturalHeight` from images, and `printDrawingOnly()` to clone comparison images with their CSS filter overlays (red/blue color effects) and `mix-blend-mode` compositing intact. Single print button in comparison mode captures the full visible composite.

#### Account & Login Fixes
- **Fixed account login/register forms hidden without license key**: The account section (Sign In / Create Account) was completely hidden when no license key was entered. Users on a new device couldn't sign in to sync their data without first entering a license key. The account forms are now always visible regardless of license status — the server handles license validation on login.

---

## [3.6.1] - 2026-02-10

### Fixed

#### Sync & Data Persistence Fixes
- **Fixed license key not syncing on new device login**: When logging into the extension on a new device, the license key was not being fetched from the server, causing premium features to be unavailable. The server now returns the license key on login, and the client automatically verifies and stores it.
- **Fixed grant key not syncing on new device login**: Grant keys for Power Users are now properly returned from the server on login and stored locally for MCP/AI integrations.
- **Fixed deleted notes/templates reappearing on new devices**: Deleted notes and templates were not being synced to the server, causing them to reappear when logging in on a new device. Now tracks deleted item IDs and sends them during sync so the server can soft-delete them.
- **Fixed personal notes folders not syncing**: The `syncNotes()` function was not including the `folder` property in the sync payload, causing folders to be lost after server sync. Folders now persist correctly across devices.
- **Fixed team notes folder column missing**: Added database migration to add `folder` column to `team_notes` table, fixing "table has no column named folder" errors when saving team notes to folders.

---

## [3.6.0] - 2026-02-08

### Added

#### Files Drag to Folder (Pro)
- **New feature: Files Drag to Folder** allows dragging files directly onto folder buttons to organize them
  - Supports both list view and grid view on the JobTread Files page
  - Visual drop zone highlighting on folder buttons during drag
  - Handles grid view's extra steps (Select Files / Edit File) automatically
  - Simulates the native folder assignment workflow behind the scenes
  - Dark mode compatible

#### Fat Gantt - Thicker Dependency Lines
- **New feature: Fat Gantt**: Makes Gantt chart dependency lines thicker (3.5px vs 1.5px) and easier to click
  - Increased stroke width from 1.5px to 3.5px for better visibility
  - Applies to all dependency line colors: blue (default), red (selected), and gray (completed/inactive)
  - Rounded line caps and joins for smoother appearance
  - Slightly enlarged arrow markers for visual balance
  - Dark mode compatible with brighter colors for visibility
  - Toggleable in Settings under "Schedule & Calendar" category
  - Enabled by default (free feature)

#### Quick Notes Panel Improvements
- **Push page content**: Quick Notes panel now pushes JobTread page content to the left instead of overlaying it, allowing you to still see and interact with JobTread while a note is open
- **Collapsible sidebar**: Added a collapse button (<<) in the sidebar header to hide the notes list while keeping the editor visible. Collapsed state is remembered across sessions.
- **Minimum editor width**: Editor enforces a minimum width of 452px to ensure toolbar buttons (including undo/redo) are always visible
- **Custom theme compatibility**: Added complete custom RGB theme support for collapsed sidebar state and all new UI elements (borders, backgrounds, button containers)

#### Account & License UI
- **Sign in link**: Added "Already have an account? Sign in" link to the account setup prompt for users who already have an account on another device

#### Popup UI Improvements
- **Updated feature count badge**: Feature count now shows 18 (up from 14) to reflect all available features
- **Device compatibility icons**: Added mobile phone icon to Fat Gantt feature. Added tablet icon to Freeze Header, Availability Filter, and PDF Markup Tools to indicate these work on wider screens (tablet/desktop)

#### Team Notes Enhancements
- **Folder support for team notes**: Team notes now persist folder assignments to the server, enabling folder organization that syncs across team members
- **Pin notes in folders**: Notes can now be pinned to appear at the top of their folder. Click the pin icon next to any note to pin/unpin. Pinned notes display with a cyan left border accent.
- **Polling sync for team notes**: Team notes now automatically sync every 15 seconds when the panel is open, allowing near real-time collaboration without page refresh
- **Drag to reorder folders**: Folders can now be reordered by dragging the grip handle on folder headers. Custom folder order is saved per tab (My Notes vs Team Notes)
- **Drag notes between folders**: Notes can now be moved between folders by dragging them onto a folder header. The folder header highlights when hovering with a dragged note.
- **Delete folders**: Folders (except General) can now be deleted by hovering over the folder header and clicking the × button. Notes in deleted folders are automatically moved to General.
- **Drag notes to reorder**: Notes can now be reordered within a folder or moved to a different position in another folder by dragging them onto other notes. A blue indicator shows where the note will be placed.

#### Quick Notes - Pure WYSIWYG Editor & Folder Organization
- **Pure WYSIWYG Editor**: Quick Notes now uses a clean rendered-only editor
  - SVG icon toolbar with bold, italic, underline, strikethrough, lists, checkboxes, links, code, undo/redo
  - Formatting is rendered directly - no markdown syntax visible to users
  - Keyboard shortcuts: Ctrl+B (bold), Ctrl+I (italic), Ctrl+U (underline), Ctrl+K (link), Ctrl+Z (undo), Ctrl+Y (redo)
  - Full undo/redo support with history tracking
  - Proper spell checking (uses browser's native spellcheck)
  - Interactive checkboxes that toggle on click
  - Notes still stored as markdown for backward compatibility
  - Removed EasyMDE library (~110KB saved)
- **Numbered list support**: Added numbered/ordered list formatting
  - Click numbered list button or convert existing content
  - Supports indentation levels
  - Proper markdown conversion (1. item, 2. item, etc.)
- **Folder organization for notes**: Notes can now be organized into collapsible folders
  - Each folder shows a note count badge
  - Click folder header to expand/collapse
  - Quick [+] button on folder header to create note directly in that folder
  - Folder dropdown selector in editor header (select existing or create new)
  - "+ New Folder..." option in dropdown to create new folders
  - Separate folders for My Notes vs Team Notes tabs
  - Collapsed folder state persists across sessions
  - Existing notes are automatically migrated to "General" folder
- **Dark mode support**: Full WYSIWYG editor and folder styling for dark theme
- **Custom theme support**: Editor and folders respect custom RGB theme

#### User Accounts System (P0 Core)
- **Account-based authentication**: Users can now create accounts with email/password to sync data across devices
- **New AccountService** (`services/account-service.js`): Handles JWT authentication, session management, and data sync
- **Server-side auth endpoints**: Added to Cloudflare Worker:
  - `/auth/setup-token` - Generate registration token after license validation
  - `/auth/register` - Create account with email/password
  - `/auth/login` - Authenticate and receive JWT tokens
  - `/auth/refresh` - Refresh access tokens
  - `/auth/logout` - Invalidate session
  - `/auth/update-grant-key` - Update grant key for Power Users
  - `/auth/forgot-password` - Request password reset email
  - `/auth/reset-password` - Complete password reset with token
- **New database schema**: Added D1 tables for accounts, sessions, notes sync, templates sync, and settings sync
- **Popup UI updates**:
  - Login form for existing account holders
  - Registration form for new users after license validation
  - Logged-in state showing user email and sync status
  - Setup prompt after license validation to encourage account creation
  - **Forgot Password flow**: Request password reset via email
  - **Reset Password form**: Set new password from email link
- **Email integration**: Password reset emails sent via Resend API
- **Security features**:
  - PBKDF2 password hashing with 100k iterations
  - AES-256-GCM encryption for grant keys
  - JWT tokens with short-lived access (15 min) and long-lived refresh (30 days)
  - Secure token storage in `chrome.storage.local`
  - Password reset tokens expire after 1 hour (single-use)
  - All sessions invalidated after password reset
- **Backward compatible**: Existing device-auth users can continue without creating an account

#### Quick Notes Cloud Sync
- **Automatic sync**: Notes automatically sync to cloud when you're logged in
- **Last-write-wins conflict resolution**: When the same note is edited on multiple devices, the most recent edit wins
- **Bidirectional sync**: Push local changes and pull remote changes in a single operation
- **Background sync**: Changes sync automatically after a short delay (3 seconds after last edit)
- **On-demand sync**: Sync triggers when you switch tabs back to JobTread
- **Local-first architecture**: Notes always save locally first, then sync to server
- **Preserves existing notes**: All your existing notes in browser storage are preserved and merged with cloud
- **Server-side endpoints**: Added `/sync/notes`, `/sync/notes/pull`, `/sync/notes/push` endpoints
- **Soft delete support**: Deleted notes sync across devices properly

#### Message Templates Cloud Sync
- **Automatic sync**: Templates from Character Counter automatically sync when logged in
- **Same sync architecture as Quick Notes**: Last-write-wins, bidirectional, background sync
- **Default template syncs**: The default template selection syncs across devices
- **Server-side endpoints**: Added `/sync/templates`, `/sync/templates/pull`, `/sync/templates/push` endpoints
- **Local-first**: Templates save locally first, then sync to cloud
- **Free feature**: Template sync works for all users with an account (doesn't require premium)

#### Team Notes (Shared Notes)
- **New "Team Notes" tab**: Quick Notes now has tabs for "My Notes" (personal) and "Team Notes" (shared)
- **Organization-wide sharing**: Team notes are visible and editable by all users under the same license
- **Real-time attribution**: Each team note shows who created it and who last updated it
- **Server-first sync**: Team notes are stored on the server and refresh when switching tabs or returning to JobTread
- **Debounced saves**: Team note edits are saved automatically after 1 second of inactivity
- **Login prompt**: Team Notes tab shows a helpful sign-in prompt for users not logged in
- **Loading states**: Visual spinner while team notes are loading from server
- **Server-side endpoints**: Added `/sync/team-notes`, `/sync/team-notes/push`, `/sync/team-notes/delete`
- **Database migration**: New `team_notes` table with org scoping and soft delete support
- **Full dark mode support**: Tabs and attribution styled for dark theme

#### MCP Setup Improvements (Power Users)
- **Credentials Display**: MCP tab now shows your License Key and Grant Key status
- **Grant Key Management**: Update your Grant Key directly from the MCP tab when it expires
- **Multi-Platform Config Generator**: Platform selector tabs generate ready-to-use configs for:
  - **Claude Code**: Direct SSE config with headers
  - **Claude Desktop**: mcp-remote wrapper config (npx command)
  - **ChatGPT**: URL and Bearer token format for UI setup
  - **Gemini**: HTTP endpoint config format
- **Platform-specific notes**: Helpful hints and requirements for each platform
- **Enhanced UX**: Clear status indicators and error messages for credential configuration

#### Availability Filter (Pro Feature)
- New filter for the Schedule Availability view to show/hide assignees by role or category
- **Hierarchical filter structure**:
  - **INTERNAL category**: Expandable dropdown with individual roles (e.g., "01 Field", "02 Project Supervisor")
  - **VENDOR category**: Expandable dropdown with individual vendor company names (uses company name, not contact name)
  - **Other categories**: Expandable dropdown with assignee names
  - Click category to toggle all children; click individual items for granular control
  - Partial state indicator (dashed border) shows when some but not all children are selected
  - Role/assignee count badges show selection status (e.g., "3/12")
- Automatically detects roles, vendors, and categories from your organization's assignee structure
- **Saved Views**: Save and load filter configurations via dropdown in header
  - Save current filter state with custom name
  - Load saved views to quickly restore filter configurations
  - Delete saved views when no longer needed
  - Persists across sessions using browser storage
- **Smooth collapse animation**: Filtered-out rows collapse smoothly instead of abruptly disappearing
- **Visual highlight**: Visible (filtered) rows get a subtle blue left border for easy identification
- Filter selections persist across sessions
- Quick actions: "Show All" and "Hide All" buttons
- **Collapsible filter panel**: Entire header bar clickable to expand/collapse; starts collapsed by default
- Full dark mode support (using proper dark grey palette)
- Full RGB/Custom Theme support (uses CSS custom properties)
- Located in Schedule & Calendar category in popup settings

### Improved

#### Dark Mode Colors
- Updated Availability Filter dark mode styling to use proper dark grey colors (#2c2c2c, #252525, #333333) instead of dark blues
- Added Dark Mode Color Palette guide to CLAUDE.md for consistent dark mode styling across all features

#### Custom Theme Support
- Added RGB/Custom Theme support to Availability Filter for consistent theming with user-selected color palettes

#### MCP Documentation
- Added setup guides for MCP server integration:
  - Claude Code setup guide
  - Cursor setup guide
  - ChatGPT setup guide
  - Generic MCP client guide with API documentation
- Fixed MCP guide links in popup to point to correct URLs

### Fixed

#### Quick Notes Editor Fixes
- **Fixed folder showing "[object PointerEvent]"**: The "New Note" button was incorrectly passing the click event object as the folder parameter, causing folders to display as "[object PointerEvent]" instead of "General"
- **Fixed toolbar buttons not working**: Added `mousedown` event handler to prevent toolbar buttons from stealing focus, which was causing formatting commands to fail because the text selection was lost
- **Fixed Quick Notes toolbar affecting Text Formatter**: Quick Notes formatting button state updates now scope queries to its own toolbar, preventing it from accidentally highlighting the Text Formatter toolbar buttons when both features are active on the same page
- **Added Enter key support for lists**: Pressing Enter while in a bullet, numbered, or checkbox item now creates a new list item of the same type on the next line. Numbered lists are automatically renumbered.
- **Fixed checkbox deletion**: Empty checkboxes can now be deleted with Backspace or Delete keys. Empty bullet and numbered list items can also be removed with Backspace.
- **Fixed invalid folder names**: Added automatic cleanup of invalid folder names (like "[object Object]" or "[object PointerEvent]") that may have been created due to the earlier bug. These are now automatically reset to "General" on load.
- **Fixed redo not working**: Redo was broken because undo/redo operations were incorrectly triggering history saves, which cleared the redo stack. Now undo/redo operations are handled separately and don't corrupt the history.
- **Fixed markdown formatting order**: Reordered regex patterns to process strikethrough and underline before bold/italic, preventing incorrect parsing of formatting markers.
- **Improved toolbar button responsiveness**: Formatting buttons (Bold, Italic, etc.) now immediately show active/inactive state after clicking, using `document.queryCommandState()` for accurate detection even when cursor is positioned without text selection.
- **Fixed undo/redo buttons not working**: Switched to browser's native undo/redo commands (`document.execCommand('undo'/'redo')`) which properly track all user edits made during the session.
- **Enhanced active button styling**: Made active formatting buttons more visually prominent with stronger cyan background (`#cffafe`) and a subtle glow effect (`box-shadow`).
- **Fixed formatting in list items**: Formatting buttons (Bold, Italic, etc.) now work correctly inside bullet points, numbered lists, and checkboxes. The selection is preserved and restored before applying formatting commands.
- **Fixed "wall" issue between formatted and unformatted text**: Backspace can now properly cross the boundary between bold/italic/underline text and normal text. Empty formatting elements are automatically cleaned up, preventing invisible barriers that blocked cursor movement.
- **Added Ctrl+click to open links**: Links in Quick Notes can now be opened by Ctrl+clicking (or Cmd+click on Mac) while editing.
- **Added table support**: New table button in toolbar allows inserting markdown tables with customizable rows/columns. Tables are editable directly in the WYSIWYG editor and properly convert to/from markdown format.
- **Removed code button**: Removed the inline code formatting button from the toolbar to simplify the interface.
- **Improved extension context handling**: Quick Notes now gracefully handles extension context invalidation (e.g., after reloading the extension) instead of throwing errors.
- **Fixed resize handle showing on sidebar-only view**: The resize handle is now only visible and functional when a note is open in the editor. Previously it was active even when viewing the sidebar list, causing users to drag an empty area.
- **Added table row/column management**: Right-click on any table cell to add/remove rows and columns via context menu. Options include Add Row Above/Below, Add Column Left/Right, Delete Row, Delete Column, and Delete Table.
- **Added folder colors**: Folders can now be assigned custom colors for visual organization. Click the circle icon next to a folder name to choose from 18 color options. Colored folders display a left border accent and filled color indicator.

---

## [3.5.4] - 2026-02-03 (Beta)

### Added

#### Kanban Task Checkboxes
- Added completion checkboxes to Kanban task cards (To-Dos and Schedule views)
- Click checkbox to toggle task completion without opening the full task details
- Works seamlessly with existing calendar view task checkboxes
- Opens sidebar in background to toggle progress, then automatically closes
- Visual feedback with loading state and completion notifications

### Improved

#### Text Formatter Consistency
- **Budget table**: Floating expanded toolbar now ONLY appears for budget table Description fields
- **All other fields**: Now use embedded compact toolbar (including custom fields on budget page, sidebar fields, messages, etc.)
- **Budget table custom fields**: Internal Notes, custom text fields, and other non-Description fields in the budget table now correctly get NO toolbar (neither embedded nor floating)
- **Filtered budget view**: Floating toolbar is now hidden when cost items are filtered (use the Cost Item Details sidebar to edit descriptions when filtering)
- Embedded toolbars now appear on page load, not just on focus
- Removed redundant `isBudgetCustomField()` logic that was incorrectly giving floating toolbar to non-table fields

#### Mobile Support Foundation
- Increased mobile support functionality for future versions of the extension
- Quick Notes side panel now takes full screen width on mobile devices (max-width: 768px)
- Added back button to navigate from note editor back to notes list on mobile
- Panel layout switches from side-by-side to stacked (vertical) on mobile
- Quick Job Switcher now auto-disables on mobile viewports (≤768px) - keyboard-driven feature doesn't work well on mobile
- Fixed Auto Collapse Completed Groups to work on both desktop and mobile Schedule/Gantt views
- Freeze Header now works on mobile viewports when navigation bar is visible

### Fixed

#### Freeze Header Sidebar Cutoff (Resolved in [Unreleased])
- ~~**Issue**: When freeze header is active and user is at the top of the page, opening a sidebar (Update Task, Task Details) causes the bottom portion to be cut off~~
- **Fixed**: Now uses a MutationObserver to watch for JobTread's JavaScript resetting `top` and `max-height` on sidebar scroll containers, and immediately corrects them to position below frozen tabs

#### Message Templates Dropdown Positioning
- Fixed templates dropdown appearing off-screen in sidebar message forms
- Dropdown now uses fixed positioning and calculates optimal placement
- Opens above or below the button depending on available viewport space

---

## [3.5.1] - 2026-01-24 (Beta)

### Fixed

#### Quick Notes Header Icon Now Persistent
- Removed URL restrictions that prevented Quick Notes icon from appearing on certain JobTread pages
- Quick Notes header icon now visible on all JobTread pages (settings, home, account pages, etc.)
- Previously only showed on specific pages like /jobs, /schedule, /messages, etc.

#### Message Templates & Character Counter Positioning
- Templates dropdown now appears inline to the left of the Send button on dashboard and sidebar message forms
- Character counter now appears below the toolbar (under upload buttons) to avoid crowding the Send button
- Split positioning: Templates stay by Send button, counter goes below on its own row

### Improved

#### Message Templates Button Styling
- Redesigned Templates and Settings buttons to match JobTread's native button styling (upload/copy/gif buttons)
- Added Phosphor-style SVG icons: document icon for Templates, gear icon for Settings
- Removed text labels and dropdown arrows for a cleaner icon-only appearance
- Removed gray background wrapper from buttons and character counter for cleaner appearance
- Full compatibility with Dark Mode and Custom Theme (RGB Theme)
- Buttons now appear as a connected button group matching JobTread's design language

#### Budget Changelog API Pagination
- Fixed Pave API query returning only 10 most recent backups (all from same day)
- Added `size: 100` and `sortBy` parameters based on Pave API documentation for connection fields
- Dropdown now shows backup dates from across multiple days as expected (e.g., Jan 22, Jan 6, Dec 17, etc.)

#### Budget Changelog Report Styling
- Fixed changelog report opening with broken styling (raw text, no CSS)
- Replaced Tailwind CDN with comprehensive inline CSS for reliable rendering in new tabs
- Fixed "Items Modified: undefined" by adding missing `unchangedCount` calculation to diff engine
- Report now displays with proper card layouts, color-coded sections, and visual hierarchy
- Print Report and Copy Summary buttons now work correctly in the new tab view

#### Popup Toggle Settings
- Fixed null reference errors when loading settings after popup HTML overhaul
- Added `setCheckbox` and `getCheckboxValue` helper functions for safe checkbox operations
- Added null checks for theme customization elements that may not exist in all popup states

### Added

#### Discord Community Link
- Added Discord invite link to popup footer for community support

#### Freeze Header - Documents Page Panel Fix
- Fixed ADD/EDIT ITEMS panel and COST ITEM DETAILS sidebar appearing behind frozen headers on Documents page
- Panel now correctly adjusts its sticky position to stay below frozen headers when scrolling
- Lowered frozen header z-index when edit panel is open to prevent overlap
- Added dedicated detection for the ADD/EDIT ITEMS panel on Documents pages

#### Text Formatter Enhancements
- Text formatter now appears in COST ITEM DETAILS sidebar when editing document line items
- Built custom embedded text formatter toolbar for the Alert Builder modal
- Alert modal toolbar supports bold, italic, underline, strikethrough, headings, lists, colors, links, quotes, and horizontal rules

#### Popup Layout Fix
- Fixed Custom Theme customization panel appearing below API Integration section
- Theme customization options now appear directly below the Custom Theme toggle in the Appearance category

#### Budget Changelog Sidebar Detection Fix
- Fixed Budget Changelog compare controls not appearing in Budget Backups sidebar
- Added `budgetChangelog` to default settings (was missing, preventing feature from initializing)
- Updated sidebar selector to use `data-is-drag-scroll-boundary` attribute for reliable detection
- Improved `isBudgetBackupsSidebar` detection to look for orange "BUDGET BACKUPS" header
- Enhanced UI injection to find correct insertion point after instruction text
- Compare controls now appear with proper styling inside the sidebar content area
- Fixed API configuration detection to use Grant Key from Pro Service storage when available
- Added direct Pave API request functionality for fetching budget backups without relying on JobTreadAPI service

#### Budget Changelog UI Improvements
- Redesigned compare controls layout with vertical stacking to fit narrow sidebar better
- Backup dropdowns now show only the latest backup per day (reduces clutter for frequently saved budgets)
- Comparison results now open in a new browser tab with a full detailed report
- New tab report includes: job name header, printable layout, expanded statistics, and better visual organization
- Added Print Report button to export comparison as PDF
- Copy Summary button works in new tab view
- Fallback modal display if popup is blocked

### Improved

#### Custom Theme (RGB Theme) Support
- Added RGB theme support to Alert Modal (text formatter's alert builder)
- Added RGB theme support to Message Templates modals (templates dropdown, manager, edit modal)
- All modal elements now properly inherit Custom Theme colors when RGB theme is active
- Uses CSS custom properties (--jt-theme-*) for consistent theming across extension features

---

## [3.5.0] - 2026-01-18 (Beta)

### Added

#### Message Templates Feature (formerly Signature)
- Upgraded single signature to multi-template system with named templates
- Templates dropdown button shows list of saved templates for quick insertion
- Settings button (⚙) opens Template Manager modal for CRUD operations
- Create, edit, and delete multiple named message templates
- Set any template as default (marked with ★) for quick reference
- Automatic migration from old single-signature format to new templates format
- Templates sync across devices via Chrome storage
- Template edit modal with name input, content textarea, and "set as default" option
- Ctrl+Enter keyboard shortcut to save template in modal
- Full dark mode support using neutral dark grays for all template UI elements

#### License Tier System
- Added four-tier license system: FREE, Essential ($10), Pro ($20), Power User ($30)
- FREE features work without any license to attract new users
- Essential tier unlocks Quick Notes, Smart Job Switcher, Freeze Header, PDF Markup Tools
- Pro tier unlocks Schedule & Task Checkboxes, Custom Theme, Preview Mode
- Power User tier unlocks Custom Field Filter, MCP Server Access
- Backwards compatibility: existing "JT Power Tools" purchasers get PRO tier

#### Custom Field Filter Feature
- Separated Custom Field Filter from Job Switcher as a standalone Power User feature
- API-powered filtering of jobs by custom field values in Job Switcher sidebar
- Requires Power User tier and API configuration
- Added `getCustomFieldValues` API endpoint to fetch unique values for text-based fields
- Filter dropdown auto-populates with available values from your jobs

#### AI Integration Panel (Power User)
- Added AI Integration section in extension popup for Power User tier
- Platform selector with Claude, ChatGPT, Cursor, and Other MCP clients
- Auto-generates personalized MCP config JSON with user's license and grant keys
- One-click copy to clipboard for easy setup
- Platform-specific setup instructions for each AI client
- Connection status indicator with live server test
- Test Connection button validates credentials against MCP server
- Quick links to full documentation and server status
- Full dark mode support for the integration panel
- Claude Desktop now uses mcp-remote bridge for remote MCP server connection (Windows path-with-spaces fix)
- Claude Code (CLI) option added with direct HTTP config support
- Separated Claude Desktop and Claude Code tabs for clearer setup instructions
- Config output shows just the server entry for easy merging into existing configs

### Fixed

#### Text Formatter Budget Table Fix
- Fixed expanded toolbar not appearing for Budget table Description fields
- The `isInAddEditItemsTable` detection was incorrectly matching Budget table rows
- Added Budget page exclusion to ensure Budget table fields get the expanded floating toolbar

#### Freeze Header ADD/EDIT ITEMS Panel Fix
- Fixed ADD/EDIT ITEMS panel and COST ITEM DETAILS sidebar appearing behind frozen headers on Documents page
- When the ADD/EDIT ITEMS panel is detected, frozen headers z-index is lowered (tabs to 30, toolbar to 29)
- Adjusted panel's sticky `top` position to account for frozen headers (prevents sliding under when scrolling)
- This allows the panel to appear in its natural stacking context without breaking layout
- Added `jt-edit-panel-open` class to body when panel is open
- Panel is excluded from global sidebar marking to prevent incorrect positioning
- Added dedicated `findAndMarkEditItemsPanel()` function for reliable panel detection on Documents pages

#### Popup Layout Fix
- Fixed Custom Theme customization panel appearing below API Integration section
- Theme customization options now appear directly below the Custom Theme toggle in the Appearance category

#### Task Completion Checkbox Fix
- Fixed task completion checkbox being covered by JobTread's "Add Task" button in Week/Day view
- Moved checkbox to left side of task name to avoid z-index conflicts with native JobTread elements

#### Text Formatter Documents Page Support
- Compact embedded toolbar now appears in Documents page sidebar description fields
- Fixed URL blocker that was preventing formatter from initializing on Documents pages
- Main document editor area still uses JobTread's native formatter (no conflict)
- Fixed formatter exclusion for ADD / EDIT ITEMS table to prevent toolbar stretching across empty rows
- Detection now properly distinguishes between COST ITEM DETAILS sidebar (formatter allowed) and ADD / EDIT ITEMS table (excluded)

#### Character Counter & Signature in Document Modals
- Character counter and signature buttons now appear in document-sending modals (Send Estimate, Send Change Order, Send Invoice, etc.)
- Detects "Email Message" textarea in send modals alongside existing message dialog support
- Signature container positioned below the textarea for easy access
- Fixed formatter incorrectly appearing in "Add / Edit Items" line item table textareas
- Sidebar detection now specifically targets "COST ITEM DETAILS" panel only

#### Alert Modal Embedded Toolbar
- Added embedded/compact formatter toolbar directly inside the Alert Builder modal
- Full formatting support: Bold, Italic, Underline, Strikethrough, Headings (H1-H3), Lists (bullet/numbered), Colors (green/yellow/blue/red), Links, Quotes, and Horizontal Rules
- Prevents the floating expanded toolbar from appearing and blocking the message textarea
- Full dark mode support for the embedded toolbar
- Toolbar buttons now show active state (blue highlight) when cursor is inside formatted text
- Auto-continue lists: pressing Enter on bullet or numbered lists automatically adds next item
- Pressing Enter on empty list item removes it instead of adding another
- Modal no longer closes when clicking outside - only closes via Close, Cancel, or Add buttons

#### AI Integration Panel Bug Fixes
- Fixed Test Connection sending undefined license key (was using wrong property name)
- Fixed license key retrieval using correct property (`key` instead of `licenseKey`)

#### PDF Markup Tools Auto-Deselect
- Fixed custom PDF tools (Highlight, Eraser) staying active when clicking JobTread native tools
- Custom tools now automatically deactivate when any native JobTread tool (Move, Select, Freedraw, etc.) is clicked
- Handles dynamically added toolbar buttons for consistent behavior

### Changed

#### Feature Tier Restructuring
- Dark Mode and Text Formatter are FREE (most popular features as hooks)
- Budget Hierarchy Shading, Kanban Type Filter, Auto Collapse Groups are FREE
- Contrast Fix and Character Counter are FREE
- Smart Job Switcher, Freeze Header, PDF Markup Tools moved to Essential tier
- Renamed "Drag & Drop" feature to "Schedule & Task Checkboxes" (JobTread launched native drag-drop)

---

## [3.3.10] - 2026-01-06 (Beta)

### Added

#### New Feature: ToDo Drag & Drop
- Drag and drop To-Dos in month calendar view to change due dates
- Works on To-Dos pages (URL contains "to-dos")
- Uses the "Due" date field for To-Dos (unlike tasks which have Start/End dates)
- Seamless integration with existing drag & drop infrastructure

### Improved

#### Preview Mode Enhancements
- Fixed last line getting cut off when scrolling in preview pane
- Fixed blockquotes rendering as separate elements with gaps
- Fixed inline icons showing as placeholder characters - now renders actual SVG icons
- Simplified alert box styling to match JobTread rendering
- Improved paragraph spacing consistency

#### Freeze Header Improvements
- Fixed Time Clock and Daily Log global sidebars appearing too low on page
- Fixed Notifications sidebar positioning to stay at native header level
- Fixed Files page left sidebar sliding under frozen action bar
- Added max-height constraint to Files sidebar to prevent scroll jump at bottom of page

---

## [3.3.6] - 2025-12-05 (Beta)

### Added

#### New Feature: Auto Collapse Completed Groups
- Automatically collapses schedule groups that are 100% complete on page load
- Reduces clutter by hiding completed work while keeping active items visible
- Works on Schedule views with grouped tasks
- Groups expand normally when clicked to view completed items
- Helps focus on remaining work without manual collapsing

### Improved

#### Custom Theme Overhaul
- Complete overhaul with HSL-based color palette generation
- Rich palette with multiple background, border, and text shades
- Distinct hover/focus/active state colors (not brightness filters)
- Theme-harmonized alert colors that adapt to light/dark backgrounds
- Better visual separation between UI layers
- Fixed dropdown menus and popper-positioned elements
- Fixed scrollbars only appearing on scrollable containers
- Clean lines in Gantt chart (removed unnecessary shadows)

### Fixed
- Fixed budget hierarchy resize handles getting shaded
- Fixed Smart Job Switcher to select highlighted item on Enter when using arrow keys
- Fixed dark toolbars and file viewers being incorrectly themed
- Fixed content tiles incorrectly getting popup shadows
- Fixed native formatter detection for custom fields in labels
- Fixed Text Formatter not appearing in New Job Message popup modal
- Fixed dark mode color picker buttons having poor contrast (A letters now visible)
- Fixed sidebar/panel embedded toolbar not hiding when clicking away from textarea
- Fixed dark mode overflow dropdown not matching toolbar styling
- Fixed duplicate formatter toolbar appearing in JobTread's native ADD ALERT modal
- Removed redundant built-in toolbar from extension's Alert Builder modal (uses secondary toolbar on focus instead)
- Fixed sidebar scrollbar being cut off at the bottom when Freeze Header is active and page is scrolled

---

## [3.3.4] - 2025-11-27 (Beta)

### Added

#### New Feature: Freeze Headers
- Freeze column and row headers in table views for easier navigation
- Keep important headers visible while scrolling through large datasets
- Works seamlessly with budget tables and other data views
- Toggle on/off from the extension popup

#### New Feature: Message Character Counter
- Real-time character count display for message fields
- Helps stay within character limits when composing messages
- Unobtrusive counter that appears when typing
- Useful for daily logs and communication fields

---

## [3.3.3] - 2025-11-22 (Beta)

### Improved

#### Architecture & Stability
- **Most Stable Version Yet**: Comprehensive restructuring for enhanced reliability
- Restructured color theme and dark mode systems for better performance
- Improved code organization and modularity across all features

#### Text Formatter & Preview Mode Enhancements
- Added more robust formatting rendering and detection
- Enhanced compatibility with various textarea types and page structures
- Improved reliability of formatter toolbar appearance
- Better detection of editable fields for formatter activation

#### Color Theme & Dark Mode
- Complete restructuring of color theme implementation
- Enhanced dark mode reliability and consistency
- Improved theme switching and color application logic
- Better integration between custom themes and dark mode

### Notes
This release represents a major stability milestone for JT Power Tools. Extensive restructuring of core systems has significantly improved reliability and performance. This is the beta version demonstrating the extension's readiness for broader use.

---

## [3.3.2] - 2025-11-20

### Improved

#### Preview Mode Enhancements
- Added inline color markup support for text highlighting
- Upgraded alert builder to JobTread-style modal dialog
- Improved alert rendering with proper styling and icons
- Fixed alert heading level from 4 to 3 hashtags for better hierarchy

#### Quick Notes Improvements
- Expanded Quick Notes button to appear on all main pages with action bars
- Better integration with JobTread's page structure

### Fixed

#### Preview Mode Fixes
- Fixed preview button staying blue when preview window closes
- Fixed preview mode bug where switching rows showed previous row content
- Improved preview button state management

#### Text Formatter Fixes
- Prevented text formatter from appearing on settings page
- Improved compatibility with different page types

#### Dark Mode Fixes
- Fixed cursor visibility in dark mode for budget textareas
- Fixed budget row highlighting to supersede hierarchy shading in dark mode
- Fixed bright spacer divs in budget rows when highlighted
- Restored blue row highlight for budget row selection in dark mode
- Removed orange text to white conversion in dark mode for better consistency

#### General Fixes
- Fixed button detection to support both div and link action buttons
- Improved overall UI stability and consistency

---

## [3.3.1] - 2025-11-17

### Added

#### New Feature: Action Items Quick Completion
- Checkboxes added to Action Items card for instant task completion
- Complete action items directly from dashboard without navigation
- Hidden iframe technology ensures seamless background completion
- Visual feedback with smooth fade-out animation when tasks are completed
- Automatic task removal from list upon successful completion
- Smart task ID extraction from both schedule and to-do URLs
- Real-time Save button detection and state monitoring

#### New Feature: Month Schedule Task Completion
- Checkboxes added to task cards in month schedule view
- Quickly mark tasks complete or incomplete directly from calendar
- Visual completion status indicator shows current task state
- Instant task status updates without opening task details
- Works seamlessly with existing drag & drop functionality

#### Help Sidebar Integration
- JT Power Tools support section added to JobTread help sidebar
- Help Sidebar Support feature now always enabled by default
- Better integration with JobTread's native help system

### Fixed

#### Action Items & Task Completion Fixes
- Fixed task completion to use full-size hidden iframe for proper toolbar rendering
- Fixed Save button detection and enabled state checking
- Improved task completion reliability with better timeout handling
- Cleaned up orphaned code that was causing JavaScript errors

#### UI & Display Fixes
- Fixed Quick Notes from running on settings pages
- Fixed sidebar hiding CSS from blocking help modals
- Fixed sticky header text elements from overlapping when scrolling
- Fixed column resize handles appearing over frozen column headers
- Fixed search bar to use shaded background on hover instead of primary color

#### Theme & Appearance Fixes
- Fixed dark mode background colors with !important flag to prevent white flash
- Added solid blue background for today's date in dark mode calendar
- Fixed text formatter and preview mode disabled for Time Clock Notes field

---

## [3.3.0] - 2025-11-13

### Added

#### New Feature: Quick Notes
- Persistent notepad accessible from any JobTread page
- Keyboard shortcut (Ctrl+Shift+N) to toggle notes panel
- Create, edit, search, and organize multiple notes
- Rich markdown formatting support (bold, italic, lists, checkboxes)
- WYSIWYG editor with formatting toolbar
- Resizable sidebar panel for comfortable note-taking
- Notes sync across devices via Chrome storage
- Word count and last updated timestamps
- Integrates seamlessly with JobTread header buttons

#### New Premium Feature: Preview Mode
- Live preview of formatted text with floating preview panel
- Click preview button (eye icon) on textareas to see rendered formatting
- Converts markdown to beautifully styled HTML
- Works on budget descriptions and daily log fields
- Real-time updates as you type
- Intelligent positioning to avoid viewport edges
- Click outside preview to close

#### Text Formatter Improvements
- Added table formatting support with interactive table builder
  - Create tables with custom rows and columns
  - Visual table preview in formatting toolbar
  - Generates markdown-formatted tables
  - Works seamlessly with existing formatting options

#### Other Improvements
- Added feedback link to popup for easier user support
- Removed mutual exclusivity between formatter and preview mode - they now work together seamlessly
- Added custom theme support for per-job tab navigation
- Improved custom theme to use primary color for selected states

### Fixed

#### Text Formatter & Preview Mode Fixes
- Fixed text formatter not appearing in daily log edit fields with transparent textarea structure
- Fixed preview button not showing on first focus
- Improved preview button visibility and content readability
- Skip text formatter and preview mode on /files path for better compatibility
- Exclude formatter and preview mode from vendors, customers, and time entries pages

#### Custom Theme Fixes
- Fixed custom theme to preserve orange text color for better readability
- Fixed custom theme by pre-calculating lightened colors for consistent appearance
- Fixed budget table borders and preview button visibility with custom themes
- Fixed theming for Preview Mode and Quick Notes to respect user color preferences

#### Dark Mode Fixes
- Reverted orange text color override in dark mode to maintain JobTread's native styling

### Changed
- Renamed "Premium Formatter" to "Preview Mode" for better clarity
- Enhanced formatter and preview mode to work together instead of being mutually exclusive

---

## [3.2.3] - 2025-11-XX

### Added
- **New Feature: Budget Hierarchy Shading**
  - Progressive visual shading for nested budget groups (up to 5 levels)
  - Level 1 (top) = Lightest, Level 5 (deepest) = Darkest
  - Line items automatically inherit parent group shading
  - Adapts intelligently to Dark Mode and Custom Theme
  - Preserves yellow highlighting for unsaved changes
  - Smooth hover states for better visual feedback
  - Real-time updates when expanding/collapsing groups
  - Helps quickly identify group hierarchy at a glance

### Improved
- Improved budget hierarchy shading using HSL color space for better visual consistency
- Added primary color tooltips for text formatter buttons
- Custom theme now applies to selected box borders for consistent theming
- Theme-aware styling for JobTread header logo
- Collapsible customize button for cleaner custom theme interface

### Fixed
- Fixed budget hierarchy URL detection to work with all budget page variations
- Added dark mode support for text formatter toolbar

### Changed
- Smart Job Switcher now supports both J+S and Alt+J keyboard shortcuts

---

## [3.1.0] - 2025-11-XX

### Added
- **New Feature: Smart Job Switcher**
  - J+S keyboard shortcut to instantly open job switcher
  - Type to search and filter jobs in real-time
  - Enter to select top result and navigate
  - Escape to cancel and close
  - Fully keyboard-driven workflow for power users

### Improved
- **Drag & Drop Modularization**:
  - Refactored from 1,475 lines to modular architecture
  - Split into 6 focused modules: date-utils, weekend-utils, ui-utils, sidebar-manager, date-changer, event-handlers
  - Main file reduced to 149 lines (90% reduction)
  - Easier to maintain and extend

- **UI/UX Improvements**:
  - Renamed "Budget Formatter" to "Text Formatter" for clarity
  - Redesigned theme customization with inline color previews
  - Moved Dark Mode below Smart Job Switcher in popup
  - Added Premium badge to Schedule Drag & Drop feature
  - Simplified popup to minimal white aesthetic

- **Custom Theme Enhancements** (Premium):
  - Inline color preview boxes next to each color picker
  - Preserves yellow highlighting on edited budget cells
  - Enhanced task type color visibility with 5px thick borders
  - Task cards now use theme background with colored border
  - Subtle shadow effect for better visual depth
  - Preserves task type identification while unifying appearance

### Fixed
- **Major Drag & Drop Fixes**:
  - Fixed December→January year transitions (2025→2026)
  - Fixed date moves in future years (Jan 2026, Feb 2026)
  - Always includes year in date format for accuracy
  - Intelligent year inference using source date as baseline
  - Year validation when page shows different months

- **Formatter Improvements**:
  - Color switching: Change colors by clicking different color buttons
  - Active color detection and button highlighting
  - Click same color to toggle off formatting

---

## [3.0.0] - 2025-11-04

### Added
- Added Custom Theme feature (Premium)
- RGB color sliders for personalized themes
- Mutual exclusivity between appearance modes
- Integrated contrast fix into custom theme
- Enhanced popup UI with collapsible sections

---

## [1.0.0] - 2025-10-29

### Added
- Initial public release
- Four core features: Schedule Drag & Drop, Contrast Fix, Text Formatter, Dark Mode
- Premium licensing system via Gumroad
- Clean, professional popup interface
- Cross-year drag & drop support
- Smart weekend detection with override
- React-compatible formatting events
- Dark mode theme with schedule card overrides
- Toggle controls via popup UI
- Modular architecture for easy expansion

---

## Legend

- **Added**: New features or functionality
- **Changed**: Changes to existing functionality
- **Deprecated**: Features that will be removed in upcoming releases
- **Removed**: Features that have been removed
- **Fixed**: Bug fixes
- **Security**: Security vulnerability fixes
- **Improved**: Enhancements to existing features

---

[3.6.3]: https://github.com/King0lightai/JT-Power-Tools/releases/tag/v3.6.3
[3.6.2]: https://github.com/King0lightai/JT-Power-Tools/releases/tag/v3.6.2
[3.6.1]: https://github.com/King0lightai/JT-Power-Tools/releases/tag/v3.6.1
[3.6.0]: https://github.com/King0lightai/JT-Power-Tools/releases/tag/v3.6.0
[3.5.4]: https://github.com/King0lightai/JT-Power-Tools/releases/tag/v3.5.4
[3.5.1]: https://github.com/King0lightai/JT-Power-Tools/releases/tag/v3.5.1
[3.5.0]: https://github.com/King0lightai/JT-Power-Tools/releases/tag/v3.5.0
[3.3.10]: https://github.com/King0lightai/JT-Power-Tools/releases/tag/v3.3.10
[3.3.6]: https://github.com/King0lightai/JT-Power-Tools/releases/tag/v3.3.6
[3.3.4]: https://github.com/King0lightai/JT-Power-Tools/releases/tag/v3.3.4
[3.3.3]: https://github.com/King0lightai/JT-Power-Tools/releases/tag/v3.3.3
[3.3.2]: https://github.com/King0lightai/JT-Power-Tools/releases/tag/v3.3.2
[3.3.1]: https://github.com/King0lightai/JT-Power-Tools/releases/tag/v3.3.1
[3.3.0]: https://github.com/King0lightai/JT-Power-Tools/releases/tag/v3.3.0
[3.2.3]: https://github.com/King0lightai/JT-Power-Tools/releases/tag/v3.2.3
[3.1.0]: https://github.com/King0lightai/JT-Power-Tools/releases/tag/v3.1.0
[3.0.0]: https://github.com/King0lightai/JT-Power-Tools/releases/tag/v3.0.0
[1.0.0]: https://github.com/King0lightai/JT-Power-Tools/releases/tag/v1.0.0
