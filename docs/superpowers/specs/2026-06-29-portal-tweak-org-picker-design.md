# Portal Tweak Org Picker — Design

**Date:** 2026-06-29
**Status:** Approved (pre-implementation)
**Branch:** `claude/portal-tweak-org-picker`

## Problem

The portal's Tweaks section scopes org-required tweaks by a **JobTread org name**
that the admin types into a free-text field (`#tweakOrgFilter`,
[dashboard.html:624](../../../portal/dashboard.html)). That typed value is sent verbatim
as `jt_org_id` and the server matches it **exactly**
([tweaks-handler.js `listTweaksData`](../../../server/mcp-server/src/tweaks-handler.js)):

```sql
WHERE t.license_id = ? AND t.jt_org_id = ? AND t.deleted_at IS NULL
  AND (t.scope = 'org_required' OR t.author_account_id = ?)
```

The `jt_org_id` stored on a tweak is the JobTread org **display name** the extension's
`OrgDetector` captured from the search bar when the tweak was authored. This is often
**not** the same string as the license's `org_name`.

**Confirmed real-world case (Beloved Built):** the license `org_name` is `Beloved Built`,
but every tweak is stored under `jt_org_id = "Beloved Built LLC, ROC#345682"`. An admin
who types the natural "Beloved Built" gets an empty list and concludes their org tweaks
are missing. They are not — the filter string just doesn't match.

## Goal

Let an admin **select** their JobTread org from a list instead of typing it, so the
exact stored `jt_org_id` is always used.

## Non-goals

- No new DB columns or tables.
- No extension changes / redeploy.
- No syncing the extension-detected org name to the server (considered and rejected as
  more surface than the bug needs; revisit only if the first-tweak type-once step proves
  painful).
- No `<datalist>` (a weak suggestion that still lets users mistype).

## Source of options

The only place JobTread org display names exist server-side is the `jt_org_id` column on
rows the extension already created. We use the **distinct `jt_org_id` values on the
caller's own license's tweaks**. The license's own `org_name` is deliberately not used —
it is the wrong value (see Problem).

Scope of the distinct query: **all non-deleted tweaks on the license, any scope.** The org
name is the org name regardless of a tweak's personal/org_required scope, and an admin who
has only personal tweaks under an org should still be able to select that org to push their
first org_required one. The query exposes only distinct org-name strings (no authorship,
no tweak contents), and is license-scoped, so it leaks nothing across licenses.

## Server

New read-only endpoint, mirroring the existing `/admin/tweaks/*` handlers in
`tweaks-handler.js`:

- **Route:** `POST /admin/tweaks/orgs`, added to `handleTweaksRoute`.
- **Auth:** `requireAccount(request, env)` — same active-license gate as the siblings.
  (The portal only shows this section to admins, but the endpoint itself requires only an
  authenticated active account; it returns just this license's distinct org names, which
  is safe for any member. No new authz needed.)
- **Data layer:** `listTweakOrgsData(env, account)` returns `{ orgs: string[] }`.

```sql
SELECT DISTINCT jt_org_id FROM tweaks
WHERE license_id = ? AND deleted_at IS NULL
  AND jt_org_id IS NOT NULL AND jt_org_id != ''
ORDER BY jt_org_id
```

- **REST wrapper:** `handleListTweakOrgs(request, env)` — `requireAccount` → call data
  layer → `jsonRes({ orgs })`; `TweakError` → `tweakErrorToResponse`, matching the other
  wrappers exactly.

## Portal UI

Replace the free-text `#tweakOrgFilter` input with a `<select id="tweakOrgFilter">`, plus
a hidden sibling text input `#tweakOrgFilterCustom` for the add-new / empty-license path.

**Population (on Tweaks section load, where the org filter is currently wired —
[dashboard.html ~2286](../../../portal/dashboard.html)):**

1. `api.post('/admin/tweaks/orgs', {})` → `orgs`.
2. Build options: one `<option>` per org name, then a trailing
   `<option value="__other__">Other / add a different org…</option>`.
3. Selection logic:
   - **Exactly one org** → select it, hide the custom input, `loadTweaks()` immediately.
   - **Multiple** → if `localStorage['jt-tweak-org']` matches a known org, preselect it and
     `loadTweaks()`; else select a disabled placeholder `Select your organization…` and
     render the existing empty hint (no load).
   - **Zero orgs** → select `__other__`, reveal `#tweakOrgFilterCustom`, focus it (the
     first-tweak path).
4. On `change`:
   - `__other__` → reveal `#tweakOrgFilterCustom`; effective value comes from it (debounced
     input → persist + `loadTweaks()`, same 400 ms debounce as today).
   - any org → hide the custom input, persist to `localStorage['jt-tweak-org']`,
     `loadTweaks()`.

**Effective-value helper:** `getSelectedTweakOrg()` returns the custom input's trimmed
value when the select is on `__other__`, otherwise the select's value (`''` for the
placeholder). `loadTweaks()` and the "New tweak" editor skeleton
(`scope.jtOrg = tweaksJtOrg`) both read through this helper. The `tweaksJtOrg` /
`localStorage['jt-tweak-org']` persistence and the empty-state hints are otherwise
unchanged.

## Error handling

- Endpoint failure (network / 4xx): fall back to showing `#tweakOrgFilterCustom` (the
  current free-text behavior) so the section is never bricked by a failed orgs fetch. Show
  the existing inline alert.
- Empty `orgs`: treated as the zero-orgs path above.

## Testing

- **Unit (`tweaks-handler` test suite):** `listTweakOrgsData` returns distinct names,
  is license-scoped (a second license's tweaks never appear), and excludes
  deleted / null / empty `jt_org_id`.
- **Manual (portal):**
  - One-org license → picker auto-selects and tweaks load with no typing.
  - Multi-org license → last-used org preselected; switching reloads.
  - Empty license → "Other" text field shown; first tweak can be created.
  - Orgs-fetch failure → falls back to the text field.

## Files touched

- `server/mcp-server/src/tweaks-handler.js` — `listTweakOrgsData`, `handleListTweakOrgs`,
  route case.
- `server/mcp-server/src/tweaks-handler.test.js` — **new** test file (the data layer in
  `tweaks-handler.js` has no test file today; existing tweaks tests are
  `tweaks-share.test.js` and `tweaks-validator.test.js`). Holds the `listTweakOrgsData`
  unit test; uses the same D1-mock style as the neighboring suites.
- `portal/dashboard.html` — select markup + population/selection wiring.
- `CHANGELOG.md` — Fixed/Improved entry.
</content>
</invoke>
