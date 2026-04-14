# Company Shared Templates — Design Document

**Date:** 2026-02-27
**Feature:** Company Shared Message Templates
**Tier:** Essential+ (auto-unlocked, no separate toggle)

## Overview

Extend the existing Message Templates feature with an org-wide "Company Templates" tab. Any Essential+ team member can create, edit, and delete shared templates visible to everyone in the organization. Personal templates remain unchanged as a free feature.

## User Experience

### Template Dropdown — Tabbed UI

Essential+ users see two tabs at the top of the existing template dropdown:

```
┌─────────────────────────────────┐
│  [My Templates] [Company ★]    │
├─────────────────────────────────┤
│  📝 Weather Delay Notice        │
│     "Due to weather conditio..."│
│  ─────────────────────────────  │
│  📝 Site Cleanup Update         │
│     "Hi [Name], here's today..."│
│  ─────────────────────────────  │
│  + New Template                 │
└─────────────────────────────────┘
```

- **My Templates tab** — personal templates, works exactly as today
- **Company tab** — org-shared templates, same CRUD UI, ★ badge indicates Essential feature
- Free users see no tab bar — dropdown behaves identically to today
- Company tab selected by default for Essential+ users

### Daily Log Sidebar — Template Button Placement

Template buttons appear on the **Notes** textarea inside the Daily Log sidebar panel.

**Detection:** Match textareas where:
1. The textarea is inside a `.jt-global-sidebar` ancestor
2. The preceding sibling `div.font-bold` contains the text "Notes"

This targets only the main Notes field, not other sections (Unplanned Tasks, Safety Incidents, etc.).

### Tier Gating

- Feature auto-unlocks based on cached account tier
- No separate toggle in popup settings
- Free users: personal templates only (no tab bar)
- Essential+: both tabs visible, Company tab default

## Data Model

### Company Template Structure

```javascript
{
  id: string,              // unique ID (generated client-side)
  name: string,            // template name
  content: string,         // template body (markdown supported)
  createdAt: number,       // timestamp
  updatedAt: number,       // timestamp
  createdBy: string,       // user name or email
  updatedBy: string        // last editor name or email
}
```

### D1 Table: `team_templates`

```sql
CREATE TABLE team_templates (
  id TEXT PRIMARY KEY,
  org_id TEXT NOT NULL,
  name TEXT NOT NULL,
  content TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  created_by TEXT NOT NULL,
  updated_by TEXT NOT NULL
);
CREATE INDEX idx_team_templates_org ON team_templates(org_id);
```

### Client Cache (chrome.storage.local)

```javascript
{
  jtTeamTemplates: {
    templates: [...],
    lastSync: 1709234567890
  }
}
```

## API Endpoints (Pro Worker)

| Method | Endpoint | Purpose |
|--------|----------|---------|
| GET | `/sync/team-templates` | Fetch all company templates for the user's org |
| POST | `/sync/team-templates/push` | Create or update a company template |
| DELETE | `/sync/team-templates/:id` | Delete a company template |

All endpoints:
- Require authentication (license key header)
- Enforce Essential+ tier check (403 for free users)
- Scope to the user's `org_id` from their session

## Sync & Caching Strategy

1. **On feature init** — fetch from server, update local cache
2. **On dropdown open** — if cache > 5 minutes old, re-fetch in background (stale-while-revalidate)
3. **On create/edit/delete** — push to server immediately, update cache optimistically
4. **No offline editing** for company templates — reads work from cache, writes require connectivity
5. **Conflict resolution** — last-write-wins using `updatedAt` timestamp

## Implementation Scope

### Files to Modify

| File | Changes |
|------|---------|
| `features/character-counter.js` | Tab bar in dropdown, Company tab rendering, fetch/cache team templates, tier gate, Daily Log Notes detection |
| `services/account-service.js` | New `getTeamTemplates()`, `saveTeamTemplate()`, `deleteTeamTemplate()` methods |
| Pro Worker (server) | New `team_templates` D1 table, 3 API endpoints, tier enforcement |

### CSS Changes

- Tab bar styling in the template dropdown (light + dark mode)
- Company badge/indicator styling
- All dark mode colors: neutral greys (`#2c2c2c`, `#252525`, `#333333`, etc.)

### No Changes Required

- Personal templates — completely untouched
- `popup.html` / `popup.js` — no new toggle
- `manifest.json` — no new permissions
- `content.js` — no new feature registration (enhancement to existing feature)

## Out of Scope

- Template categories/folders
- Template versioning/history
- Role-based permissions (admin vs member)
- Template import/export
- Template buttons on non-Notes Daily Log textareas
