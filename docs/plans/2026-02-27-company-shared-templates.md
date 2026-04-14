# Company Shared Templates Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add org-wide shared "Company Templates" tab to the existing Message Templates dropdown, gated to Essential+ tier, with server-side storage mirroring the Team Notes pattern.

**Architecture:** Three layers — (1) License Proxy gets new `team_templates` D1 table + 3 endpoints mirroring `handleTeamNotes*`, (2) AccountService gets 3 new methods mirroring `getTeamNotes`/`saveTeamNote`/`deleteTeamNote`, (3) character-counter.js gets tabbed dropdown UI, Daily Log Notes detection, and tier-gated Company tab.

**Tech Stack:** Chrome Extension (Manifest V3), Cloudflare Workers (D1 SQL), Chrome Storage API, vanilla JS (IIFE modules)

---

### Task 1: D1 Database — Create `team_templates` Table

**Files:**
- Modify: `server/licsense proxy.txt` (add table creation SQL as reference comment near top, ~line 1-10)
- Run: D1 SQL via Cloudflare dashboard or wrangler CLI

**Step 1: Run the D1 migration**

Execute this SQL against the D1 database (via Cloudflare dashboard > D1 > Query):

```sql
CREATE TABLE IF NOT EXISTS team_templates (
  id TEXT PRIMARY KEY,
  license_id TEXT NOT NULL,
  name TEXT NOT NULL,
  content TEXT NOT NULL DEFAULT '',
  created_by_account_id TEXT NOT NULL,
  created_by_name TEXT NOT NULL DEFAULT 'Unknown',
  updated_by_account_id TEXT,
  updated_by_name TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  deleted_at INTEGER DEFAULT NULL
);

CREATE INDEX IF NOT EXISTS idx_team_templates_license ON team_templates(license_id);
CREATE INDEX IF NOT EXISTS idx_team_templates_deleted ON team_templates(license_id, deleted_at);
```

**Step 2: Verify table created**

```sql
SELECT name FROM sqlite_master WHERE type='table' AND name='team_templates';
```

Expected: One row with `team_templates`.

---

### Task 2: License Proxy — Add Team Templates Endpoints

**Files:**
- Modify: `server/licsense proxy.txt`
  - Route registration: ~line 1207 (after `team-notes/delete` case)
  - New handler functions: after `handleTeamNotesDelete` (~line 2061)

**Step 1: Add route cases**

In the `handleSyncRequest` switch statement (around line 1207), add three new cases BEFORE the `case '/sync/saved-filters':` line:

```javascript
    case '/sync/team-templates':
      return await handleTeamTemplatesPull(body, payload, env);
    case '/sync/team-templates/push':
      return await handleTeamTemplatesPush(body, payload, env);
    case '/sync/team-templates/delete':
      return await handleTeamTemplatesDelete(body, payload, env);
```

**Step 2: Add the three handler functions**

Add after `handleTeamNotesDelete` function (after ~line 2061), before the Saved Filters section:

```javascript
// =============================================================================
// TEAM TEMPLATES SYNC HANDLERS
// =============================================================================

/**
 * Pull all team templates for the user's organization
 * Scoped by license_id (all users under same license share templates)
 */
async function handleTeamTemplatesPull(body, payload, env) {
  const db = env?.DB;
  if (!db) {
    return jsonResponse({ success: false, error: 'Database not available' }, 500);
  }

  const licenseId = payload.license_id;
  if (!licenseId) {
    return jsonResponse({ success: false, error: 'No license associated with account' }, 403);
  }

  const serverTimestamp = Date.now();

  try {
    const result = await db.prepare(`
      SELECT id, name, content,
             created_by_account_id, created_by_name,
             updated_by_account_id, updated_by_name,
             created_at * 1000 as createdAt,
             updated_at * 1000 as updatedAt
      FROM team_templates
      WHERE license_id = ? AND deleted_at IS NULL
      ORDER BY updated_at DESC
    `).bind(licenseId).all();

    const templates = (result.results || []).map(t => ({
      id: t.id,
      name: t.name,
      content: t.content,
      createdBy: {
        id: t.created_by_account_id,
        name: t.created_by_name || 'Unknown'
      },
      updatedBy: t.updated_by_account_id ? {
        id: t.updated_by_account_id,
        name: t.updated_by_name || 'Unknown'
      } : null,
      createdAt: t.createdAt,
      updatedAt: t.updatedAt
    }));

    return jsonResponse({
      success: true,
      data: {
        templates,
        serverTimestamp
      }
    });
  } catch (error) {
    console.error('Team templates pull error:', error);
    return jsonResponse({ success: false, error: 'Failed to fetch team templates: ' + error.message }, 500);
  }
}

/**
 * Create or update a team template
 */
async function handleTeamTemplatesPush(body, payload, env) {
  const db = env?.DB;
  if (!db) {
    return jsonResponse({ success: false, error: 'Database not available' }, 500);
  }

  const licenseId = payload.license_id;
  const accountId = payload.sub;

  if (!licenseId) {
    return jsonResponse({ success: false, error: 'No license associated with account' }, 403);
  }

  const { id, name, content } = body;

  if (!name || !name.trim()) {
    return jsonResponse({ success: false, error: 'Template name is required' }, 400);
  }

  try {
    const account = await db.prepare(
      'SELECT display_name FROM accounts WHERE id = ?'
    ).bind(accountId).first();
    const displayName = account?.display_name || 'Unknown';

    const serverTimestamp = Date.now();

    if (id) {
      // Update existing template - verify it belongs to this org
      const existing = await db.prepare(
        'SELECT id FROM team_templates WHERE id = ? AND license_id = ? AND deleted_at IS NULL'
      ).bind(id, licenseId).first();

      if (!existing) {
        return jsonResponse({ success: false, error: 'Template not found' }, 404);
      }

      await db.prepare(`
        UPDATE team_templates
        SET name = ?, content = ?,
            updated_by_account_id = ?, updated_by_name = ?,
            updated_at = ?
        WHERE id = ? AND license_id = ?
      `).bind(
        name.trim(),
        content || '',
        accountId,
        displayName,
        Math.floor(serverTimestamp / 1000),
        id,
        licenseId
      ).run();

      return jsonResponse({
        success: true,
        data: {
          id,
          updatedAt: serverTimestamp,
          updatedBy: { id: accountId, name: displayName }
        }
      });
    } else {
      // Create new template
      const templateId = crypto.randomUUID();

      await db.prepare(`
        INSERT INTO team_templates (id, license_id, name, content,
                                    created_by_account_id, created_by_name,
                                    created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `).bind(
        templateId,
        licenseId,
        name.trim(),
        content || '',
        accountId,
        displayName,
        Math.floor(serverTimestamp / 1000),
        Math.floor(serverTimestamp / 1000)
      ).run();

      return jsonResponse({
        success: true,
        data: {
          id: templateId,
          createdAt: serverTimestamp,
          createdBy: { id: accountId, name: displayName }
        }
      });
    }
  } catch (error) {
    console.error('Team templates push error:', error);
    return jsonResponse({ success: false, error: 'Failed to save team template: ' + error.message }, 500);
  }
}

/**
 * Soft delete a team template
 */
async function handleTeamTemplatesDelete(body, payload, env) {
  const db = env?.DB;
  if (!db) {
    return jsonResponse({ success: false, error: 'Database not available' }, 500);
  }

  const licenseId = payload.license_id;
  const { id } = body;

  if (!licenseId) {
    return jsonResponse({ success: false, error: 'No license associated with account' }, 403);
  }

  if (!id) {
    return jsonResponse({ success: false, error: 'Template ID is required' }, 400);
  }

  try {
    const existing = await db.prepare(
      'SELECT id FROM team_templates WHERE id = ? AND license_id = ? AND deleted_at IS NULL'
    ).bind(id, licenseId).first();

    if (!existing) {
      return jsonResponse({ success: false, error: 'Template not found' }, 404);
    }

    await db.prepare(`
      UPDATE team_templates
      SET deleted_at = strftime('%s', 'now'), updated_at = strftime('%s', 'now')
      WHERE id = ? AND license_id = ?
    `).bind(id, licenseId).run();

    return jsonResponse({
      success: true,
      message: 'Template deleted successfully'
    });
  } catch (error) {
    console.error('Team templates delete error:', error);
    return jsonResponse({ success: false, error: 'Failed to delete team template: ' + error.message }, 500);
  }
}
```

**Step 3: Deploy and test**

Deploy the updated License Proxy worker. Test each endpoint with curl or browser:
- POST `/sync/team-templates` with valid auth → should return `{ success: true, data: { templates: [] } }`
- POST `/sync/team-templates/push` with `{ name: "Test", content: "Hello" }` → should return created template
- POST `/sync/team-templates/delete` with `{ id: "<id-from-above>" }` → should return success

**Step 4: Commit**

```bash
# Server files are gitignored - just note the deployment
```

---

### Task 3: AccountService — Add Team Template Methods

**Files:**
- Modify: `JT-Tools-Master/services/account-service.js`
  - After `deleteTeamNote` function (~line 743), add 3 new methods
  - Add to the return object at the bottom of the IIFE

**Step 1: Add `getTeamTemplates()` method**

Add after the `deleteTeamNote` function (after ~line 743):

```javascript
  // =========================================================================
  // TEAM TEMPLATES (Company-shared templates, Essential+ tier)
  // =========================================================================

  /**
   * Fetch all team templates for the user's organization
   * @returns {Promise<{success: boolean, templates?: Array, error?: string}>}
   */
  async function getTeamTemplates() {
    if (!isLoggedIn()) {
      return { success: false, error: 'Not logged in' };
    }

    try {
      console.log('AccountService: Fetching team templates...');

      const response = await authenticatedFetch('/sync/team-templates', {
        method: 'POST',
        body: JSON.stringify({})
      });

      const result = await response.json();

      if (result.success) {
        console.log('AccountService: Team templates fetched', {
          count: result.data.templates?.length || 0
        });
        return {
          success: true,
          templates: result.data.templates || [],
          serverTimestamp: result.data.serverTimestamp
        };
      } else {
        console.error('AccountService: Failed to fetch team templates', result.error);
        return { success: false, error: result.error };
      }
    } catch (error) {
      console.error('AccountService: Team templates fetch error', error);
      return { success: false, error: 'Network error. Please try again.' };
    }
  }

  /**
   * Create or update a team template
   * @param {Object} template - { id?, name, content }
   * @returns {Promise<{success: boolean, data?: Object, error?: string}>}
   */
  async function saveTeamTemplate(template) {
    if (!isLoggedIn()) {
      return { success: false, error: 'Not logged in' };
    }

    if (!template.name || !template.name.trim()) {
      return { success: false, error: 'Template name is required' };
    }

    try {
      console.log('AccountService: Saving team template...', { id: template.id || 'new' });

      const response = await authenticatedFetch('/sync/team-templates/push', {
        method: 'POST',
        body: JSON.stringify({
          id: template.id || null,
          name: template.name,
          content: template.content || ''
        })
      });

      const result = await response.json();

      if (result.success) {
        console.log('AccountService: Team template saved', result.data);
        return { success: true, data: result.data };
      } else {
        console.error('AccountService: Failed to save team template', result.error);
        return { success: false, error: result.error };
      }
    } catch (error) {
      console.error('AccountService: Team template save error', error);
      return { success: false, error: 'Network error. Please try again.' };
    }
  }

  /**
   * Delete a team template
   * @param {string} templateId - The template ID to delete
   * @returns {Promise<{success: boolean, error?: string}>}
   */
  async function deleteTeamTemplate(templateId) {
    if (!isLoggedIn()) {
      return { success: false, error: 'Not logged in' };
    }

    if (!templateId) {
      return { success: false, error: 'Template ID is required' };
    }

    try {
      console.log('AccountService: Deleting team template...', { id: templateId });

      const response = await authenticatedFetch('/sync/team-templates/delete', {
        method: 'POST',
        body: JSON.stringify({ id: templateId })
      });

      const result = await response.json();

      if (result.success) {
        console.log('AccountService: Team template deleted');
        return { success: true };
      } else {
        console.error('AccountService: Failed to delete team template', result.error);
        return { success: false, error: result.error };
      }
    } catch (error) {
      console.error('AccountService: Team template delete error', error);
      return { success: false, error: 'Network error. Please try again.' };
    }
  }
```

**Step 2: Export the new methods**

Find the return object at the bottom of the AccountService IIFE and add:

```javascript
    getTeamTemplates,
    saveTeamTemplate,
    deleteTeamTemplate,
```

Add these after the existing `deleteTeamNote` export.

**Step 3: Commit**

```bash
git add JT-Tools-Master/services/account-service.js
git commit -m "feat: Add AccountService methods for company shared templates

- getTeamTemplates() - fetch org-wide templates
- saveTeamTemplate() - create/update shared template
- deleteTeamTemplate() - soft-delete shared template
- Mirrors Team Notes API pattern"
```

---

### Task 4: Character Counter — Daily Log Notes Detection

**Files:**
- Modify: `JT-Tools-Master/features/character-counter.js`
  - `isMessageTextarea()` function (~line 1799-1857)

**Step 1: Add Daily Log Notes detection**

In `isMessageTextarea()`, add a new check BEFORE the final `return false` (around line 1855):

```javascript
  // Check if this is the Notes textarea inside the Daily Log sidebar
  const sidebar = field.closest('.jt-global-sidebar');
  if (sidebar) {
    // Walk up to find the label - the Notes textarea is inside a div
    // whose preceding sibling div.font-bold contains "Notes"
    const parentDiv = field.closest('.space-y-1')?.parentElement;
    if (parentDiv) {
      const label = parentDiv.querySelector(':scope > .font-bold');
      if (label && label.textContent.trim() === 'Notes') {
        return true;
      }
    }
    // Also check for the rounded-sm border container directly under Notes label
    const container = field.closest('.rounded-sm.border');
    if (container) {
      const prevLabel = container.parentElement?.querySelector(':scope > .font-bold');
      if (prevLabel && prevLabel.textContent.trim() === 'Notes') {
        return true;
      }
    }
  }

  return false;
```

**Step 2: Test manually**

1. Reload extension
2. Open a Daily Log sidebar in JobTread
3. The Notes textarea should now show the Templates button
4. Other textareas (Unplanned Tasks, Safety Incidents, etc.) should NOT show it

**Step 3: Commit**

```bash
git add JT-Tools-Master/features/character-counter.js
git commit -m "feat: Detect Daily Log Notes textarea for template buttons

- Expand isMessageTextarea() to match Notes field in Daily Log sidebar
- Uses .jt-global-sidebar ancestor + 'Notes' label text for precise targeting
- Only targets main Notes field, not other sidebar sections"
```

---

### Task 5: Character Counter — Team Templates Cache Layer

**Files:**
- Modify: `JT-Tools-Master/features/character-counter.js`
  - Add near top of file, after existing constants/variables (~line 20-30 area)

**Step 1: Add team template state variables and cache functions**

Add these module-level variables alongside the existing `cachedTemplates` variable:

```javascript
  // Team (company) templates - Essential+ tier
  const TEAM_TEMPLATES_CACHE_KEY = 'jtTeamTemplates';
  const TEAM_TEMPLATES_CACHE_TTL = 5 * 60 * 1000; // 5 minutes
  let cachedTeamTemplates = { templates: [], lastSync: null };
  let isEssentialPlus = false; // Cached tier check
  let activeTab = 'personal'; // 'personal' or 'company'
```

**Step 2: Add tier check helper**

Add after the variables:

```javascript
  /**
   * Check if user has Essential+ tier (for company templates access)
   * Caches the result so we don't check on every dropdown open
   */
  async function checkEssentialTier() {
    try {
      if (window.LicenseService) {
        const tier = await window.LicenseService.getTier();
        // Essential features available to Essential, Pro, and Power User
        isEssentialPlus = tier && window.LicenseService.tierHasFeature(tier, 'quickNotes');
      } else {
        isEssentialPlus = false;
      }
    } catch (e) {
      console.log('CharacterCounter: Tier check failed', e);
      isEssentialPlus = false;
    }
    return isEssentialPlus;
  }
```

**Step 3: Add team templates fetch and cache functions**

```javascript
  /**
   * Load team templates from cache, refreshing from server if stale
   */
  async function loadTeamTemplates(forceRefresh = false) {
    // Check cache first
    if (!forceRefresh && cachedTeamTemplates.templates.length > 0) {
      const age = Date.now() - (cachedTeamTemplates.lastSync || 0);
      if (age < TEAM_TEMPLATES_CACHE_TTL) {
        return cachedTeamTemplates.templates;
      }
    }

    // Try loading from local storage first (fast)
    try {
      const stored = await chrome.storage.local.get([TEAM_TEMPLATES_CACHE_KEY]);
      if (stored[TEAM_TEMPLATES_CACHE_KEY]) {
        cachedTeamTemplates = stored[TEAM_TEMPLATES_CACHE_KEY];
        const age = Date.now() - (cachedTeamTemplates.lastSync || 0);
        if (!forceRefresh && age < TEAM_TEMPLATES_CACHE_TTL) {
          return cachedTeamTemplates.templates;
        }
      }
    } catch (e) {
      console.log('CharacterCounter: Local cache read failed', e);
    }

    // Fetch from server
    if (window.AccountService?.isLoggedIn()) {
      try {
        console.log('CharacterCounter: Fetching team templates from server...');
        const result = await window.AccountService.getTeamTemplates();
        if (result.success) {
          cachedTeamTemplates = {
            templates: result.templates || [],
            lastSync: Date.now()
          };
          // Persist to local storage
          await chrome.storage.local.set({ [TEAM_TEMPLATES_CACHE_KEY]: cachedTeamTemplates });
          console.log('CharacterCounter: Team templates loaded', { count: cachedTeamTemplates.templates.length });
          return cachedTeamTemplates.templates;
        }
      } catch (e) {
        console.log('CharacterCounter: Team templates fetch failed, using cache', e);
      }
    }

    return cachedTeamTemplates.templates;
  }

  /**
   * Save a team template (create or update)
   */
  async function saveTeamTemplate(template) {
    if (!window.AccountService?.isLoggedIn()) {
      console.error('CharacterCounter: Cannot save team template - not logged in');
      return null;
    }

    const result = await window.AccountService.saveTeamTemplate(template);
    if (result.success) {
      // Refresh cache
      await loadTeamTemplates(true);
      return result.data;
    } else {
      console.error('CharacterCounter: Failed to save team template', result.error);
      return null;
    }
  }

  /**
   * Delete a team template
   */
  async function deleteTeamTemplateById(templateId) {
    if (!window.AccountService?.isLoggedIn()) {
      console.error('CharacterCounter: Cannot delete team template - not logged in');
      return false;
    }

    const result = await window.AccountService.deleteTeamTemplate(templateId);
    if (result.success) {
      // Remove from local cache immediately
      cachedTeamTemplates.templates = cachedTeamTemplates.templates.filter(t => t.id !== templateId);
      await chrome.storage.local.set({ [TEAM_TEMPLATES_CACHE_KEY]: cachedTeamTemplates });
      return true;
    } else {
      console.error('CharacterCounter: Failed to delete team template', result.error);
      return false;
    }
  }
```

**Step 4: Initialize tier check in `init()`**

In the existing `init()` function (~line 2230), add after the initial template load:

```javascript
    // Check tier for company templates tab
    checkEssentialTier();
```

**Step 5: Clear team template cache in `cleanup()`**

In the existing `cleanup()` function (~line 2283), add:

```javascript
    cachedTeamTemplates = { templates: [], lastSync: null };
    isEssentialPlus = false;
    activeTab = 'personal';
```

**Step 6: Commit**

```bash
git add JT-Tools-Master/features/character-counter.js
git commit -m "feat: Add team templates cache layer and tier checking

- Team template state variables and cache (5-min TTL)
- checkEssentialTier() using LicenseService.tierHasFeature
- loadTeamTemplates() with local storage cache + server fetch
- saveTeamTemplate() and deleteTeamTemplateById() with optimistic cache updates
- Proper cleanup of team template state"
```

---

### Task 6: Character Counter — Tabbed Dropdown UI

This is the largest task. It modifies `createTemplateDropdown()` (~lines 1632-1792) to add a tab bar at the top.

**Files:**
- Modify: `JT-Tools-Master/features/character-counter.js`
  - `createTemplateDropdown()` function (~line 1632)
  - Inline CSS styles section (~line 704-803)

**Step 1: Add tab bar CSS styles**

In the inline CSS string (inside the `injectStyles()` function, around line 704-803), add these styles:

```css
/* Template Dropdown Tabs */
.jt-template-tabs {
  display: flex;
  border-bottom: 1px solid #e5e5e5;
  padding: 0;
  margin: 0;
}
.jt-template-tab {
  flex: 1;
  padding: 8px 12px;
  text-align: center;
  cursor: pointer;
  font-size: 12px;
  font-weight: 500;
  color: #666;
  background: transparent;
  border: none;
  border-bottom: 2px solid transparent;
  transition: all 0.15s ease;
}
.jt-template-tab:hover {
  color: #333;
  background: #f5f5f5;
}
.jt-template-tab.active {
  color: #0891b2;
  border-bottom-color: #0891b2;
}
.jt-template-tab .jt-tab-badge {
  font-size: 9px;
  vertical-align: super;
  color: #0891b2;
  margin-left: 2px;
}
/* Created by attribution */
.jt-template-created-by {
  font-size: 10px;
  color: #999;
  margin-top: 2px;
}
```

And in the dark mode section of the same CSS:

```css
/* Dark mode tab styles */
body.jt-dark-mode .jt-template-tabs,
#jt-dark-mode-styles ~ * .jt-template-tabs {
  border-bottom-color: #404040;
}
body.jt-dark-mode .jt-template-tab,
#jt-dark-mode-styles ~ * .jt-template-tab {
  color: #b0b0b0;
}
body.jt-dark-mode .jt-template-tab:hover,
#jt-dark-mode-styles ~ * .jt-template-tab:hover {
  color: #e0e0e0;
  background: #333333;
}
body.jt-dark-mode .jt-template-tab.active,
#jt-dark-mode-styles ~ * .jt-template-tab.active {
  color: #22d3ee;
  border-bottom-color: #22d3ee;
}
body.jt-dark-mode .jt-template-created-by,
#jt-dark-mode-styles ~ * .jt-template-created-by {
  color: #707070;
}
```

**Step 2: Modify `createTemplateDropdown()` to add tab bar**

Inside the `createTemplateDropdown()` function, find where the dropdown element is created and its inner HTML is built. The function needs these modifications:

A) After creating the dropdown div, add the tab bar HTML at the top of the dropdown (only when `isEssentialPlus` is true):

```javascript
    // Build tab bar (only for Essential+ users)
    function buildTabBar() {
      if (!isEssentialPlus) return '';
      return `
        <div class="jt-template-tabs">
          <button class="jt-template-tab ${activeTab === 'personal' ? 'active' : ''}" data-tab="personal">
            My Templates
          </button>
          <button class="jt-template-tab ${activeTab === 'company' ? 'active' : ''}" data-tab="company">
            Company <span class="jt-tab-badge">★</span>
          </button>
        </div>
      `;
    }
```

B) Modify the populate/render function to show the correct template list based on `activeTab`:

```javascript
    // Get templates for the active tab
    function getActiveTemplates() {
      if (activeTab === 'company') {
        return cachedTeamTemplates.templates;
      }
      return cachedTemplates?.templates || [];
    }

    // Get the default template ID for the active tab
    function getActiveDefaultId() {
      if (activeTab === 'company') return null; // No default for company
      return cachedTemplates?.defaultTemplateId || null;
    }
```

C) In the template item rendering, for company templates add the `createdBy` attribution line:

```javascript
    // For company tab items, add attribution
    if (activeTab === 'company' && template.createdBy) {
      itemHtml += `<div class="jt-template-created-by">by ${template.createdBy.name}</div>`;
    }
```

D) Add tab click handlers when the dropdown is shown:

```javascript
    // Attach tab click handlers
    function attachTabHandlers() {
      const tabs = dropdown.querySelectorAll('.jt-template-tab');
      tabs.forEach(tab => {
        tab.addEventListener('click', async (e) => {
          e.stopPropagation();
          const newTab = tab.dataset.tab;
          if (newTab === activeTab) return;

          activeTab = newTab;

          // Update tab active states
          tabs.forEach(t => t.classList.toggle('active', t.dataset.tab === activeTab));

          // If switching to company tab, load team templates
          if (activeTab === 'company') {
            await loadTeamTemplates();
          }

          // Re-render the template list (not the tabs)
          populateTemplateList();
        });
      });
    }
```

E) For the "New Template" button click and edit/save flow — when `activeTab === 'company'`, call `saveTeamTemplate()` instead of saving to local storage. When deleting, call `deleteTeamTemplateById()`.

F) For the edit modal save handler, branch based on `activeTab`:

```javascript
    // In the save handler of the edit modal:
    if (activeTab === 'company') {
      const saved = await saveTeamTemplate({
        id: editingTemplateId || null,
        name: nameInput.value.trim(),
        content: contentInput.value
      });
      if (saved) {
        // Refresh dropdown
        populateTemplateList();
      }
    } else {
      // Existing personal template save logic (unchanged)
    }
```

G) For the delete handler, branch similarly:

```javascript
    // In the delete handler:
    if (activeTab === 'company') {
      const deleted = await deleteTeamTemplateById(templateId);
      if (deleted) {
        populateTemplateList();
      }
    } else {
      // Existing personal template delete logic (unchanged)
    }
```

**Step 3: Set Company tab as default for Essential+ users**

In the dropdown `show()` function, before rendering:

```javascript
    // Default to company tab for Essential+ users
    if (isEssentialPlus && activeTab === 'personal') {
      // On first open, default to company
      // (activeTab persists during session, so this only fires initially)
    }
```

Actually, the module-level `activeTab` is initialized as `'personal'`. Change the init to:

```javascript
    // In init(), after checkEssentialTier():
    checkEssentialTier().then(() => {
      if (isEssentialPlus) {
        activeTab = 'company';
      }
    });
```

**Step 4: Test manually**

1. Reload extension as a free user → dropdown should have NO tabs, behaves exactly as before
2. Log in with Essential+ license → dropdown should show two tabs
3. Company tab should be selected by default
4. Click "New Template" on Company tab → save should call server API
5. Template should appear for other users in the same org
6. Switch to My Templates tab → personal templates work as before
7. Test in Dark Mode — tabs should use neutral grey colors

**Step 5: Commit**

```bash
git add JT-Tools-Master/features/character-counter.js
git commit -m "feat: Add tabbed Company Templates UI to template dropdown

- Tab bar with My Templates / Company tabs (Essential+ only)
- Company tab fetches team templates from server
- Create/edit/delete company templates via AccountService
- Created-by attribution on company template items
- Dark mode styling with neutral greys
- Company tab selected by default for Essential+ users
- Free users see no tabs (identical to current behavior)"
```

---

### Task 7: CHANGELOG & Final Cleanup

**Files:**
- Modify: `CHANGELOG.md`

**Step 1: Update CHANGELOG**

Add under `## [Unreleased]`:

```markdown
### Added
#### Company Shared Templates (Essential+ Tier)
- Added org-wide "Company Templates" tab to the template dropdown
- Any team member (Essential tier or higher) can create, edit, and delete shared templates
- Templates are shared across all users in the same organization
- Tabbed UI with "My Templates" and "Company" tabs (mirrors Team Notes pattern)
- Company tab selected by default for paid users
- Created-by attribution shows who made each template
- 5-minute client-side cache with stale-while-revalidate refresh
- Template buttons now appear on Daily Log Notes textarea in the sidebar
- Full dark mode support with neutral grey color palette
- Free users see no changes — personal templates work exactly as before
```

**Step 2: Commit**

```bash
git add CHANGELOG.md
git commit -m "docs: Add company shared templates to CHANGELOG

Updated CHANGELOG.md under [Unreleased] -> Added"
```

---

## Task Dependency Graph

```
Task 1 (D1 table) ──┐
                     ├── Task 2 (License Proxy endpoints) ── Task 3 (AccountService) ──┐
                     │                                                                   │
Task 4 (DL detection) ─────────────────────────────────────────────────────────────────┤
                                                                                        │
Task 5 (Cache layer) ──────────────────────────────────────── Task 6 (Tabbed UI) ──── Task 7 (CHANGELOG)
```

**Parallelizable:** Tasks 1+4 can run in parallel. Tasks 3+5 can run in parallel after Task 2 is done.

**Sequential:** Task 1 → Task 2 → Task 3 → Task 6. Task 5 → Task 6. Task 6 → Task 7.
