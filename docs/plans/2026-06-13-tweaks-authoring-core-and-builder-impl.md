# Tweaks Authoring — Core + Visual Builder Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the first authoring milestone — a shared `describe`/`port` core plus an in-page visual builder that lets a non-technical user create the six common tweaks by point-and-click, with live preview, no JSON and no AI.

**Architecture:** Pure-logic modules (`describe`, `port`, `builder-emit`) are IIFEs on `window`, unit-tested under vitest/jsdom. The engine (`features/tweak-engine/index.js`) gains a reversible `preview` capability driven by two new messages. An injected in-page panel (`builder.js`) reuses the existing picker, calls `builder-emit` to produce DSL, previews via the engine, and saves through the existing storage + `TweaksApi` path. All visuals come from a shared token stylesheet so the builder matches the popup.

**Tech Stack:** Plain ES5/ES6 JS (no bundler), IIFE-module-on-`window` pattern, vitest + jsdom for unit tests, Playwright for e2e, `npm run eval:full` as the gate. Spec: [docs/plans/2026-06-13-tweaks-authoring-upgrade-design.md](2026-06-13-tweaks-authoring-upgrade-design.md).

---

## Conventions (read once)

- **Module pattern:** `const X = (() => { ... return {...}; })(); if (typeof window !== 'undefined') window.X = X;`
- **Tests:** live in `tests/features/` (so they run — vitest `include` is `tests/utils/**` + `tests/features/**`). Import the module for its side effect, then read `window.X`:
  ```js
  import { describe, it, expect, beforeEach } from 'vitest';
  import '../../JT-Tools-Master/utils/tweak-validator.js';
  import '../../JT-Tools-Master/features/tweak-engine/describe.js';
  const TweakDescribe = window.TweakDescribe;
  ```
- **Run one test file:** `npx vitest run tests/features/<file>.test.js`
- **Run everything + gates:** `npm run eval:full` (unit, security guard, tooling lint, visual regression).
- **Commit style:** conventional (`feat:`/`test:`/`refactor:`/`style:`). No CHANGELOG entry for pure-internal modules or tests; add one under `[Unreleased] → Added` only when user-visible (the builder UI in Task 12).
- **Never edit** manifest permissions/host_permissions, `scripts/eval.js`, `scripts/security-guard.js`. Adding to `content_scripts.js[]` and `web_accessible_resources.resources[]` is allowed and required.

## File Structure

| File | Responsibility | New/Modify |
|---|---|---|
| `JT-Tools-Master/features/tweak-engine/describe.js` | `describe(tweak)→string[]`, `describeScope(tweak)→string` — plain-English summary. Pure. | Create |
| `JT-Tools-Master/features/tweak-engine/port.js` | `exportTweak(tweak)→envelope`, `importTweak(payload,opts)→{ok,...}` — sanitize-out / rewrite-in. Pure (uses validator). | Create |
| `JT-Tools-Master/features/tweak-engine/builder-emit.js` | `buildTweak(opts)→tweak`, `buildAction/​buildRestyleCss` — verb forms → DSL. Pure. | Create |
| `JT-Tools-Master/features/tweak-engine/builder.js` | In-page docked panel IIFE (`window.TweakBuilderFeature`): picker→form→preview→save. | Create |
| `JT-Tools-Master/styles/jt-tools-tokens.css` | Shared design tokens + base component classes (mirrors popup). | Create |
| `JT-Tools-Master/styles/tweak-builder.css` | Builder-panel layout, consuming the tokens. | Create |
| `JT-Tools-Master/features/tweak-engine/index.js` | Add `previewTweak`/`clearPreview` + `TWEAK_PREVIEW_APPLY`/`TWEAK_PREVIEW_CLEAR` handlers. | Modify |
| `JT-Tools-Master/features/inspect-for-ai.js` | Add `INSPECT_PICK_FOR_BUILDER` mode that dispatches `jt-tweak-build` (capture) instead of copying markdown. | Modify |
| `JT-Tools-Master/content.js` | Register `tweakBuilder` in the feature lifecycle. | Modify |
| `JT-Tools-Master/popup/popup.html` | `<link>` the shared tokens stylesheet. | Modify |
| `JT-Tools-Master/manifest.json` | Add new scripts to `content_scripts.js[]`; add CSS to `web_accessible_resources`. | Modify |
| `tests/features/tweak-describe.test.js` | Unit tests for describe. | Create |
| `tests/features/tweak-port.test.js` | Unit tests for export/import + round-trip. | Create |
| `tests/features/tweak-builder-emit.test.js` | Unit tests for every verb's emission + validator pass. | Create |
| `tests/e2e/tweak-builder.spec.js` | E2E: pick → form → preview → save. | Create |

---

# Phase A — Shared core

### Task 1: `describe()` — plain-English summary

**Files:**
- Create: `JT-Tools-Master/features/tweak-engine/describe.js`
- Test: `tests/features/tweak-describe.test.js`

- [ ] **Step 1: Write the failing test**

```js
import { describe, it, expect } from 'vitest';
import '../../JT-Tools-Master/features/tweak-engine/describe.js';
const D = window.TweakDescribe;

describe('TweakDescribe.describe', () => {
  it('describes setText as a rename', () => {
    expect(D.describe({ actions: [{ type: 'setText', selector: 'th', text: 'Trade Partner' }] }))
      .toEqual(['Renames text to "Trade Partner"']);
  });
  it('describes hide / show', () => {
    expect(D.describe({ actions: [{ type: 'hide', selector: '.x' }] })).toEqual(['Hides matching elements']);
    expect(D.describe({ actions: [{ type: 'show', selector: '.x' }] })).toEqual(['Shows matching elements']);
  });
  it('describes confirmBeforeAction as a warning gate', () => {
    expect(D.describe({ actions: [{ type: 'confirmBeforeAction', selector: 'button', event: 'click', confirm: 'Delete this task?' }] }))
      .toEqual(['Asks "Delete this task?" before the click goes through']);
  });
  it('describes onEvent+alert as a warning', () => {
    expect(D.describe({ actions: [{ type: 'onEvent', selector: 'a', event: 'click', preventDefault: true, alert: { body: 'hi' } }] }))
      .toEqual(['Warns you when you click matching elements']);
  });
  it('describes sortChildren by its key', () => {
    expect(D.describe({ actions: [{ type: 'sortChildren', selector: 'tbody', key: 'number' }] }))
      .toEqual(['Sorts the list by number']);
  });
  it('appends the match guard', () => {
    expect(D.describe({ actions: [{ type: 'setText', selector: 'td', text: 'Trade Partner', match: 'Vendor' }] }))
      .toEqual(['Renames text to "Trade Partner" (only cells containing "Vendor")']);
  });
  it('reports a css-only tweak', () => {
    expect(D.describe({ css: '.gantt-bar { height: 6px; }' })).toEqual(['Applies custom styling (CSS)']);
  });
  it('returns [] for an empty tweak', () => {
    expect(D.describe({})).toEqual([]);
  });
});

describe('TweakDescribe.describeScope', () => {
  it('names org + url path', () => {
    expect(D.describeScope({ scope: { jtOrg: 'Titus Contracting', urlMatch: '/budget' } }))
      .toBe('Titus Contracting · /budget pages only');
  });
  it('falls back to all pages with no urlMatch', () => {
    expect(D.describeScope({ scope: { jtOrg: 'Titus Contracting' } }))
      .toBe('Titus Contracting · all pages');
  });
});
```

- [ ] **Step 2: Run it, verify it fails**

Run: `npx vitest run tests/features/tweak-describe.test.js`
Expected: FAIL — `Cannot read properties of undefined (reading 'describe')` (module not created).

- [ ] **Step 3: Implement `describe.js`**

```js
/**
 * TweakDescribe — turns a tweak (or candidate tweak) into plain-English
 * lines for the builder preview, the import-trust dialog, popup cards,
 * and the MCP create_tweak confirmation. Pure: no DOM, no storage.
 */
const TweakDescribe = (() => {
  const q = (s) => '"' + String(s) + '"';

  function lineForAction(a) {
    switch (a && a.type) {
      case 'setText': return 'Renames text to ' + q(a.text);
      case 'hide': return 'Hides matching elements';
      case 'show': return 'Shows matching elements';
      case 'addClass': return 'Adds the ' + q(a.class) + ' style to matching elements';
      case 'removeClass': return 'Removes the ' + q(a.class) + ' style from matching elements';
      case 'setStyle': {
        const props = Object.keys(a.style || {});
        return props.length ? 'Restyles matching elements (' + props.join(', ') + ')' : 'Restyles matching elements';
      }
      case 'onEvent':
        if (a.alert) return 'Warns you when you ' + a.event + ' matching elements';
        if (Array.isArray(a.then) && a.then.length) return 'On ' + a.event + ', updates matching elements';
        if (a.preventDefault) return 'Blocks the ' + a.event + ' on matching elements';
        return 'Reacts to ' + a.event + ' on matching elements';
      case 'confirmBeforeAction': return 'Asks ' + q(a.confirm) + ' before the ' + a.event + ' goes through';
      case 'moveBefore': return 'Moves matching elements before another element';
      case 'moveAfter': return 'Moves matching elements after another element';
      case 'sortChildren': return 'Sorts the list by ' + (a.key || 'text');
      default: return 'Modifies matching elements';
    }
  }

  function describe(tweak) {
    const lines = [];
    if (tweak && typeof tweak.css === 'string' && tweak.css.trim()) {
      lines.push('Applies custom styling (CSS)');
    }
    if (tweak && Array.isArray(tweak.actions)) {
      for (const a of tweak.actions) {
        let line = lineForAction(a);
        if (a && typeof a.match === 'string' && a.match) {
          line += ' (only cells containing ' + q(a.match) + ')';
        }
        lines.push(line);
      }
    }
    return lines;
  }

  function describeScope(tweak) {
    const scope = (tweak && tweak.scope) || {};
    const org = scope.jtOrg || 'your org';
    return scope.urlMatch ? (org + ' · ' + scope.urlMatch + ' pages only') : (org + ' · all pages');
  }

  return { describe, describeScope, lineForAction };
})();

if (typeof window !== 'undefined') window.TweakDescribe = TweakDescribe;
```

- [ ] **Step 4: Run it, verify it passes**

Run: `npx vitest run tests/features/tweak-describe.test.js`
Expected: PASS (10 tests).

- [ ] **Step 5: Commit**

```bash
git add JT-Tools-Master/features/tweak-engine/describe.js tests/features/tweak-describe.test.js
git commit -m "feat(tweaks): add describe() for plain-English tweak summaries"
```

---

### Task 2: `port.exportTweak()` — sanitize on the way out

**Files:**
- Create: `JT-Tools-Master/features/tweak-engine/port.js`
- Test: `tests/features/tweak-port.test.js`

- [ ] **Step 1: Write the failing test**

```js
import { describe, it, expect } from 'vitest';
import '../../JT-Tools-Master/utils/tweak-validator.js';
import '../../JT-Tools-Master/features/tweak-engine/port.js';
const P = window.TweakPort;

const fullTweak = {
  id: '11111111-1111-4111-8111-111111111111',
  name: 'Vendor → Trade Partner',
  description: 'Relabels vendor language',
  version: 1,
  scope: { jtOrg: 'Titus Contracting', urlMatch: '/budget' },
  storageScope: 'personal',
  enabled: true,
  authorDisplayName: 'Zee',
  originalDomContext: '<th>Vendor</th> with customer name Jane Doe',
  actions: [{ type: 'setText', selector: 'th', text: 'Trade Partner', match: 'Vendor' }]
};

describe('TweakPort.exportTweak', () => {
  it('tags the envelope', () => {
    expect(P.exportTweak(fullTweak)._jtpt).toBe('tweak-share-v1');
  });
  it('keeps name, description, actions, and urlMatch', () => {
    const e = P.exportTweak(fullTweak);
    expect(e.name).toBe('Vendor → Trade Partner');
    expect(e.description).toBe('Relabels vendor language');
    expect(e.actions).toEqual(fullTweak.actions);
    expect(e.scope).toEqual({ urlMatch: '/budget' });
  });
  it('strips id, org, author, and captured DOM (PII boundary)', () => {
    const e = P.exportTweak(fullTweak);
    expect(e.id).toBeUndefined();
    expect(e.scope.jtOrg).toBeUndefined();
    expect(e.authorDisplayName).toBeUndefined();
    expect(e.originalDomContext).toBeUndefined();
    expect(e.storageScope).toBeUndefined();
    expect(e.enabled).toBeUndefined();
    expect(JSON.stringify(e)).not.toContain('Jane Doe');
  });
});
```

- [ ] **Step 2: Run it, verify it fails**

Run: `npx vitest run tests/features/tweak-port.test.js`
Expected: FAIL — `window.TweakPort` is undefined.

- [ ] **Step 3: Implement `exportTweak` in `port.js`**

```js
/**
 * TweakPort — safe export/import for sharing tweaks.
 *   exportTweak: strips everything org/person/PII-specific (the boundary
 *     for what leaves the machine) and tags a shareable envelope.
 *   importTweak: re-validates, mints a fresh id, rewrites org to the
 *     importer's, and FORCES personal scope. (defined in Task 3)
 */
const TweakPort = (() => {
  const SHARE_TAG = 'tweak-share-v1';

  function exportTweak(tweak) {
    if (!tweak || typeof tweak !== 'object') throw new Error('exportTweak: tweak object required');
    const env = { _jtpt: SHARE_TAG, version: 1, name: tweak.name };
    if (typeof tweak.description === 'string' && tweak.description) env.description = tweak.description;
    if (typeof tweak.css === 'string' && tweak.css.trim()) env.css = tweak.css;
    if (Array.isArray(tweak.actions) && tweak.actions.length) {
      env.actions = JSON.parse(JSON.stringify(tweak.actions));
    }
    const urlMatch = tweak.scope && typeof tweak.scope.urlMatch === 'string' ? tweak.scope.urlMatch : undefined;
    env.scope = urlMatch ? { urlMatch } : {};
    return env;
  }

  return { exportTweak, SHARE_TAG };
})();

if (typeof window !== 'undefined') window.TweakPort = TweakPort;
```

- [ ] **Step 4: Run it, verify it passes**

Run: `npx vitest run tests/features/tweak-port.test.js`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add JT-Tools-Master/features/tweak-engine/port.js tests/features/tweak-port.test.js
git commit -m "feat(tweaks): add port.exportTweak with PII strip-out"
```

---

### Task 3: `port.importTweak()` — re-validate + rewrite on the way in

**Files:**
- Modify: `JT-Tools-Master/features/tweak-engine/port.js`
- Modify: `tests/features/tweak-port.test.js`

- [ ] **Step 1: Add the failing tests**

```js
describe('TweakPort.importTweak', () => {
  const envelope = {
    _jtpt: 'tweak-share-v1', version: 1, name: 'Vendor → Trade Partner',
    scope: { urlMatch: '/budget' },
    actions: [{ type: 'setText', selector: 'th', text: 'Trade Partner', match: 'Vendor' }]
  };
  const opts = { activeOrg: 'Acme Builders', id: '22222222-2222-4222-8222-222222222222' };

  it('rejects a non-envelope payload', () => {
    expect(P.importTweak({ name: 'x' }, opts).ok).toBe(false);
    expect(P.importTweak(null, opts).ok).toBe(false);
  });
  it('rejects when there is no active org', () => {
    expect(P.importTweak(envelope, { id: opts.id }).ok).toBe(false);
  });
  it('rewrites org to the importer, forces personal, mints the given id', () => {
    const r = P.importTweak(envelope, opts);
    expect(r.ok).toBe(true);
    expect(r.tweak.scope.jtOrg).toBe('Acme Builders');
    expect(r.tweak.scope.urlMatch).toBe('/budget');
    expect(r.tweak.storageScope).toBe('personal');
    expect(r.tweak.id).toBe(opts.id);
  });
  it('produces a tweak that passes the validator', () => {
    const r = P.importTweak(envelope, opts);
    expect(window.TweakValidator.validate(r.tweak)).toEqual({ ok: true });
  });
  it('round-trips export → import', () => {
    const exported = P.exportTweak({
      id: '33333333-3333-4333-8333-333333333333', name: 'Hide print', version: 1,
      scope: { jtOrg: 'Original Org', urlMatch: '/jobs' },
      actions: [{ type: 'hide', selector: '.print-btn' }]
    });
    const r = P.importTweak(exported, opts);
    expect(r.ok).toBe(true);
    expect(r.tweak.scope.jtOrg).toBe('Acme Builders');
    expect(r.tweak.actions).toEqual([{ type: 'hide', selector: '.print-btn' }]);
  });
});
```

- [ ] **Step 2: Run it, verify the new tests fail**

Run: `npx vitest run tests/features/tweak-port.test.js`
Expected: FAIL — `P.importTweak is not a function`.

- [ ] **Step 3: Add `importTweak` to `port.js`**

Inside the IIFE, before `return`:

```js
  function importTweak(payload, opts) {
    opts = opts || {};
    if (!payload || typeof payload !== 'object' || payload._jtpt !== SHARE_TAG) {
      return { ok: false, errors: [{ field: '', reason: 'not a JT Power Tools shared tweak (missing or wrong _jtpt tag)' }] };
    }
    if (typeof opts.activeOrg !== 'string' || !opts.activeOrg) {
      return { ok: false, errors: [{ field: 'scope.jtOrg', reason: 'no active JobTread org to import into' }] };
    }
    const id = opts.id || (typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : null);
    if (!id) return { ok: false, errors: [{ field: 'id', reason: 'could not generate an id' }] };

    const tweak = {
      id, name: payload.name, version: 1,
      scope: { jtOrg: opts.activeOrg },
      storageScope: 'personal', enabled: true
    };
    if (typeof payload.description === 'string') tweak.description = payload.description;
    if (typeof payload.css === 'string') tweak.css = payload.css;
    if (Array.isArray(payload.actions)) tweak.actions = JSON.parse(JSON.stringify(payload.actions));
    if (payload.scope && typeof payload.scope.urlMatch === 'string') tweak.scope.urlMatch = payload.scope.urlMatch;

    const v = (typeof window !== 'undefined' && window.TweakValidator)
      ? window.TweakValidator.validate(tweak) : { ok: true };
    if (!v.ok) return { ok: false, errors: v.errors };
    return { ok: true, tweak };
  }
```

And update the return: `return { exportTweak, importTweak, SHARE_TAG };`

- [ ] **Step 4: Run it, verify it passes**

Run: `npx vitest run tests/features/tweak-port.test.js`
Expected: PASS (8 tests total).

- [ ] **Step 5: Commit**

```bash
git add JT-Tools-Master/features/tweak-engine/port.js tests/features/tweak-port.test.js
git commit -m "feat(tweaks): add port.importTweak with re-validate + org rewrite + force-personal"
```

---

### Task 4: Shared token stylesheet

**Files:**
- Create: `JT-Tools-Master/styles/jt-tools-tokens.css`
- Modify: `JT-Tools-Master/popup/popup.html`

Rationale: the builder is injected on JobTread and can't load `popup.css`. This file holds the design tokens (the documented dark palette) + a few base component classes, namespaced so JT's CSS can't bleed in. We do **not** refactor `popup.css` here (avoids regressions); we mirror its values so the builder matches. Repointing `popup.css` at these tokens is a deferred cleanup.

- [ ] **Step 1: Create `jt-tools-tokens.css`**

```css
/* JT Power Tools — shared design tokens (popup + injected surfaces).
   Namespaced under .jt-tools-surface so JobTread styles can't bleed in. */
.jt-tools-surface {
  --jtt-bg: #2c2c2c;
  --jtt-bg-2: #252525;
  --jtt-bg-elev: #333333;
  --jtt-bg-hover: #3a3a3a;
  --jtt-border: #404040;
  --jtt-border-2: #505050;
  --jtt-text: #e0e0e0;
  --jtt-text-2: #b0b0b0;
  --jtt-text-muted: #a0a0a0;
  --jtt-text-disabled: #707070;
  --jtt-primary: #3B82F6;
  --jtt-primary-hover: #2563eb;
  --jtt-accent: #f08c00;
  --jtt-safe: #9fe1cb;
  color: var(--jtt-text);
  font: 13px system-ui, -apple-system, sans-serif;
}
.jt-tools-surface .jtt-btn {
  background: var(--jtt-bg-elev); color: var(--jtt-text-2);
  border: 1px solid var(--jtt-border-2); border-radius: 5px;
  padding: 7px 12px; font: inherit; cursor: pointer;
}
.jt-tools-surface .jtt-btn:hover { background: var(--jtt-bg-hover); color: var(--jtt-text); }
.jt-tools-surface .jtt-btn-primary { background: var(--jtt-primary); color: #fff; border-color: var(--jtt-primary); }
.jt-tools-surface .jtt-btn-primary:hover { background: var(--jtt-primary-hover); }
.jt-tools-surface .jtt-input {
  background: #1f1f1f; color: var(--jtt-text);
  border: 1px solid var(--jtt-border-2); border-radius: 5px;
  padding: 8px 10px; font: inherit; width: 100%; box-sizing: border-box;
}
.jt-tools-surface .jtt-label { font-size: 11px; color: var(--jtt-text-muted); }
```

- [ ] **Step 2: Link it from `popup.html`**

In `JT-Tools-Master/popup/popup.html`, add inside `<head>` BEFORE the existing `popup.css` link:

```html
<link rel="stylesheet" href="../styles/jt-tools-tokens.css">
```

- [ ] **Step 3: Verify the popup still renders unchanged**

Load the unpacked extension, open the popup. Expected: visually identical (the new file adds scoped tokens only; nothing references `.jt-tools-surface` in the popup yet).

- [ ] **Step 4: Commit**

```bash
git add JT-Tools-Master/styles/jt-tools-tokens.css JT-Tools-Master/popup/popup.html
git commit -m "feat(tweaks): add shared jt-tools design tokens stylesheet"
```

---

### Task 5: Reversible `preview` in the engine

**Files:**
- Modify: `JT-Tools-Master/features/tweak-engine/index.js`
- Test: `tests/e2e/tweak-builder.spec.js` (preview round-trip is verified in Task 13's e2e; this task adds a manual check)

Design: a candidate tweak is applied into a dedicated preview slot (`<style id="jt-tweak-preview">` + a marker class `jt-tweak-preview-active`) separate from the live `activeTweakIds` set, so clearing the preview never touches saved tweaks. Reuse the existing `applyTweak` machinery minimally — for v1, preview supports `css`, `setText`, `hide`, `show`, `setStyle`, `addClass`, `removeClass` (the non-event verbs the builder emits). Event verbs (`onEvent`/`confirmBeforeAction`) are not previewed live (they need a real interaction); the panel shows their `describe()` line instead.

- [ ] **Step 1: Add preview state + functions inside the engine IIFE**

After `removeAllAppliedTweaks` in `index.js`, add:

```js
  // ─── Builder live preview (reversible, separate from the active set) ───
  let previewStyleEl = null;
  const previewTouched = []; // [{ el, prop, prev }] for inline style restore

  function clearPreview() {
    if (previewStyleEl && previewStyleEl.parentNode) previewStyleEl.parentNode.removeChild(previewStyleEl);
    previewStyleEl = null;
    document.documentElement.classList.remove('jt-tweak-preview-active');
    document.documentElement.classList.remove('jt-tweak-preview');
    for (const t of previewTouched.splice(0)) {
      if (t.prev === null) t.el.style.removeProperty(t.prop);
      else t.el.style.setProperty(t.prop, t.prev);
      if (t.text !== undefined) t.el.textContent = t.text;
    }
  }

  function previewTweak(tweak) {
    clearPreview();
    if (!tweak || typeof tweak !== 'object') return;
    if (tweak.css && tweak.css.trim() && window.CssSanitizer) {
      const r = window.CssSanitizer.sanitize(tweak.css, { tweakId: 'preview' });
      if (r.ok) {
        previewStyleEl = document.createElement('style');
        previewStyleEl.id = 'jt-tweak-preview';
        previewStyleEl.textContent = r.css;
        document.head.appendChild(previewStyleEl);
        document.documentElement.classList.add('jt-tweak-preview');
      }
    }
    if (Array.isArray(tweak.actions)) {
      for (const a of tweak.actions) {
        if (a.type === 'onEvent' || a.type === 'confirmBeforeAction') continue; // not live-previewable
        let els;
        try { els = document.querySelectorAll(a.selector); } catch { continue; }
        for (const el of els) {
          if (typeof a.match === 'string' && a.match && !(el.textContent || '').includes(a.match)) continue;
          previewOne(a, el);
        }
      }
    }
  }

  function previewOne(a, el) {
    if (a.type === 'setText') {
      previewTouched.push({ el, prop: '', prev: null, text: el.textContent });
      el.textContent = a.text;
    } else if (a.type === 'hide') {
      previewTouched.push({ el, prop: 'display', prev: el.style.getPropertyValue('display') || null });
      el.style.setProperty('display', 'none', 'important');
    } else if (a.type === 'addClass') {
      el.classList.add(a.class);
      previewTouched.push({ el, prop: '__class:' + a.class, prev: null });
    } else if (a.type === 'setStyle') {
      for (const [prop, val] of Object.entries(a.style || {})) {
        const kebab = prop.replace(/([A-Z])/g, '-$1').toLowerCase();
        previewTouched.push({ el, prop: kebab, prev: el.style.getPropertyValue(kebab) || null });
        el.style.setProperty(kebab, val);
      }
    }
  }
```

(Note: `addClass` restore on clear — extend the splice loop to handle `__class:` markers: if `t.prop.startsWith('__class:')` call `t.el.classList.remove(t.prop.slice(8))`. Add that branch in `clearPreview`.)

- [ ] **Step 2: Wire the messages in `listenForDryRunRequests`**

In the existing `msgHandler` in `listenForDryRunRequests`, add before the final `return false;`:

```js
      if (message && message.type === 'TWEAK_PREVIEW_APPLY' && message.tweak) {
        try { previewTweak(message.tweak); sendResponse({ ok: true }); }
        catch (err) { sendResponse({ ok: false, error: err.message }); }
        return true;
      }
      if (message && message.type === 'TWEAK_PREVIEW_CLEAR') {
        try { clearPreview(); sendResponse({ ok: true }); }
        catch (err) { sendResponse({ ok: false, error: err.message }); }
        return true;
      }
```

- [ ] **Step 3: Expose on `_internals` and clear on teardown**

Add `previewTweak, clearPreview` to the `_internals` object in the `return`. In `cleanup()`, call `clearPreview();` before `removeAllAppliedTweaks();`.

- [ ] **Step 4: Manual verification**

Load the unpacked extension on `app.jobtread.com`, open DevTools console on the page, run:
```js
chrome.runtime.sendMessage // not available on page; instead test via the engine directly:
window.TweakEngineFeature._internals.previewTweak({ actions: [{ type: 'setText', selector: 'h1', text: 'PREVIEW' }] });
```
Expected: the first `<h1>` shows "PREVIEW". Then:
```js
window.TweakEngineFeature._internals.clearPreview();
```
Expected: the `<h1>` reverts to its original text. Confirm no `<style id="jt-tweak-preview">` remains in `<head>`.

- [ ] **Step 5: Run the gate + commit**

Run: `npm run eval:full`
Expected: all gates green (no rendered change in fixtures → visual regression passes).

```bash
git add JT-Tools-Master/features/tweak-engine/index.js
git commit -m "feat(tweaks): add reversible live preview to the tweak engine"
```

---

# Phase B — Visual builder

### Task 6: `builder-emit` — verb forms → DSL

**Files:**
- Create: `JT-Tools-Master/features/tweak-engine/builder-emit.js`
- Test: `tests/features/tweak-builder-emit.test.js`

Gotcha encoded here: `setStyle` values go through the *strict* `sanitizeCSSValue` (alphanumeric + `- % . space` only), so colors (`#hex`, `rgb()`) FAIL validation as a `setStyle` action. The **Restyle** intent therefore emits a `css` rule (where the CSS sanitizer parses colors properly), not a `setStyle` action. Font-size (`16px`) and weight (`bold`) are strict-safe but we keep all restyle output in `css` for one consistent path.

- [ ] **Step 1: Write the failing test**

```js
import { describe, it, expect } from 'vitest';
import '../../JT-Tools-Master/utils/sanitizer.js';
import '../../JT-Tools-Master/utils/tweak-validator.js';
import '../../JT-Tools-Master/features/tweak-engine/builder-emit.js';
const E = window.TweakBuilderEmit;
const V = window.TweakValidator;
const cap = { selector: '.budget th:nth-child(2)' };
const base = { capture: cap, org: 'Titus Contracting', urlMatch: '/budget', id: '44444444-4444-4444-8444-444444444444' };

const expectValid = (t) => expect(V.validate(t)).toEqual({ ok: true });

describe('TweakBuilderEmit.buildTweak', () => {
  it('rename → setText, validates', () => {
    const t = E.buildTweak({ ...base, intent: 'rename', values: { text: 'Trade Partner' } });
    expect(t.actions[0]).toEqual({ type: 'setText', selector: cap.selector, text: 'Trade Partner' });
    expect(t.scope).toEqual({ jtOrg: 'Titus Contracting', urlMatch: '/budget' });
    expect(t.storageScope).toBe('personal');
    expectValid(t);
  });
  it('hide → hide, validates', () => {
    const t = E.buildTweak({ ...base, intent: 'hide', values: {} });
    expect(t.actions[0]).toEqual({ type: 'hide', selector: cap.selector });
    expectValid(t);
  });
  it('restyle color → css (NOT setStyle), validates', () => {
    const t = E.buildTweak({ ...base, intent: 'restyle', values: { color: '#ff0000', bold: true } });
    expect(t.actions).toBeUndefined();
    expect(t.css).toContain('color: #ff0000');
    expect(t.css).toContain('font-weight: bold');
    expectValid(t);
  });
  it('warn → confirmBeforeAction, validates', () => {
    const t = E.buildTweak({ ...base, intent: 'warn', values: { confirm: 'Delete this task?' } });
    expect(t.actions[0]).toEqual({ type: 'confirmBeforeAction', selector: cap.selector, event: 'click', confirm: 'Delete this task?' });
    expectValid(t);
  });
  it('sort → sortChildren with defaults, validates', () => {
    const t = E.buildTweak({ ...base, intent: 'sort', values: { key: 'number', direction: 'desc' } });
    expect(t.actions[0]).toMatchObject({ type: 'sortChildren', selector: cap.selector, key: 'number', direction: 'desc' });
    expectValid(t);
  });
  it('move → moveAfter when position=after, validates', () => {
    const t = E.buildTweak({ ...base, intent: 'move', values: { position: 'after', referenceSelector: '.budget th:first-child' } });
    expect(t.actions[0]).toEqual({ type: 'moveAfter', selector: cap.selector, referenceSelector: '.budget th:first-child' });
    expectValid(t);
  });
  it('uses a sensible default name', () => {
    const t = E.buildTweak({ ...base, intent: 'rename', values: { text: 'Trade Partner' } });
    expect(t.name).toBe('Rename → Trade Partner');
  });
});
```

- [ ] **Step 2: Run it, verify it fails**

Run: `npx vitest run tests/features/tweak-builder-emit.test.js`
Expected: FAIL — `window.TweakBuilderEmit` undefined.

- [ ] **Step 3: Implement `builder-emit.js`**

```js
/**
 * TweakBuilderEmit — turns a builder intent + form values + picked-element
 * capture into a valid tweak DSL object. Pure: no DOM, no storage.
 *
 * Restyle emits `css` (not setStyle) because setStyle values run through the
 * strict sanitizeCSSValue — #hex / rgb() are rejected there but parse fine in
 * the css field's AST sanitizer.
 */
const TweakBuilderEmit = (() => {
  function buildRestyleCss(selector, values) {
    const decls = [];
    if (values.color) decls.push('color: ' + values.color);
    if (values.fontSize) decls.push('font-size: ' + values.fontSize);
    if (values.bold) decls.push('font-weight: bold');
    return selector + ' { ' + decls.join('; ') + '; }';
  }

  function buildAction(intent, values, selector) {
    switch (intent) {
      case 'rename': return { type: 'setText', selector, text: values.text };
      case 'hide': return { type: 'hide', selector };
      case 'warn': return { type: 'confirmBeforeAction', selector, event: values.event || 'click', confirm: values.confirm };
      case 'sort': {
        const a = { type: 'sortChildren', selector };
        if (values.childSelector) a.childSelector = values.childSelector;
        if (values.keySelector) a.keySelector = values.keySelector;
        a.key = values.key || 'text';
        a.direction = values.direction || 'asc';
        return a;
      }
      case 'move': return {
        type: values.position === 'after' ? 'moveAfter' : 'moveBefore',
        selector, referenceSelector: values.referenceSelector
      };
      default: throw new Error('unknown intent: ' + intent);
    }
  }

  function defaultName(intent, values) {
    switch (intent) {
      case 'rename': return 'Rename → ' + (values.text || '');
      case 'hide': return 'Hide element';
      case 'restyle': return 'Restyle element';
      case 'warn': return 'Warn before click';
      case 'sort': return 'Sort table';
      case 'move': return 'Move element';
      default: return 'Tweak';
    }
  }

  function buildTweak(opts) {
    const { intent, values, capture, org, urlMatch, id, name } = opts;
    const selector = (capture && capture.selector) || values.selector || '';
    const tweak = {
      id, version: 1,
      name: name || defaultName(intent, values),
      scope: { jtOrg: org },
      storageScope: 'personal',
      enabled: true
    };
    if (urlMatch) tweak.scope.urlMatch = urlMatch;
    if (intent === 'restyle') {
      tweak.css = buildRestyleCss(selector, values);
    } else {
      tweak.actions = [buildAction(intent, values, selector)];
    }
    return tweak;
  }

  return { buildTweak, buildAction, buildRestyleCss, defaultName };
})();

if (typeof window !== 'undefined') window.TweakBuilderEmit = TweakBuilderEmit;
```

- [ ] **Step 4: Run it, verify it passes**

Run: `npx vitest run tests/features/tweak-builder-emit.test.js`
Expected: PASS (7 tests).

- [ ] **Step 5: Commit**

```bash
git add JT-Tools-Master/features/tweak-engine/builder-emit.js tests/features/tweak-builder-emit.test.js
git commit -m "feat(tweaks): add builder-emit (verb forms → validated DSL)"
```

---

### Task 7: Picker → builder hand-off

**Files:**
- Modify: `JT-Tools-Master/features/inspect-for-ai.js`

Add a mode where the picker, instead of copying markdown, dispatches the capture to the builder via a DOM CustomEvent. Reuses all the existing overlay/highlight code.

- [ ] **Step 1: Add the message + a build flag**

In `inspect-for-ai.js`, in the `msgHandler` inside `init()`, add a branch:

```js
      if (message && message.type === 'INSPECT_PICK_FOR_BUILDER') {
        enterPickerMode({ multi: false, forBuilder: true });
        sendResponse({ ok: true });
        return false;
      }
```

- [ ] **Step 2: Thread the flag through `enterPickerMode` and the click handler**

In `enterPickerMode(opts)`, the existing code stores `opts`. In `onPickerClick`, the single-pick branch currently calls `captureAndCopy(el); exitPickerMode();`. Change it to:

```js
    } else {
      if (pickerForBuilder) {
        const ctx = buildCaptureContext(el);
        window.dispatchEvent(new CustomEvent('jt-tweak-build', { detail: ctx }));
        exitPickerMode();
      } else {
        captureAndCopy(el);
        exitPickerMode();
      }
    }
```

Add a module-scoped `let pickerForBuilder = false;` near `pickerActive`, set it in `enterPickerMode` (`pickerForBuilder = !!opts.forBuilder;`) and reset it in `exitPickerMode` (`pickerForBuilder = false;`).

- [ ] **Step 3: Manual verification (after Task 8 exists, the panel opens; for now confirm the event fires)**

Load the extension, on a JT page run in console:
```js
window.addEventListener('jt-tweak-build', (e) => console.log('build capture:', e.detail));
chrome.runtime.sendMessage // not on page — instead call directly:
window.InspectForAiFeature; // confirm present
```
Then trigger picker-for-builder by dispatching the message from the popup (wired in Task 12), or temporarily call the internal `enterPickerMode({ forBuilder: true })` via a console hook. Expected: clicking an element logs the capture object with a `selector`.

- [ ] **Step 4: Commit**

```bash
git add JT-Tools-Master/features/inspect-for-ai.js
git commit -m "feat(tweaks): picker can hand a capture to the builder via jt-tweak-build event"
```

---

### Task 8: Builder panel — skeleton + styles

**Files:**
- Create: `JT-Tools-Master/features/tweak-engine/builder.js`
- Create: `JT-Tools-Master/styles/tweak-builder.css`

- [ ] **Step 1: Create `tweak-builder.css`**

```css
/* Tweak builder panel — consumes jt-tools-tokens.css variables.
   Root node carries .jt-tools-surface so the tokens resolve. */
.jt-tweak-builder {
  position: fixed; top: 0; right: 0; height: 100vh; width: 320px;
  background: var(--jtt-bg); border-left: 1px solid var(--jtt-border);
  box-shadow: -4px 0 16px rgba(0,0,0,0.35);
  z-index: 2147483645; display: flex; flex-direction: column;
  box-sizing: border-box;
}
.jt-tweak-builder * { box-sizing: border-box; }
.jt-tweak-builder-header {
  display: flex; align-items: center; justify-content: space-between;
  padding: 12px 14px; background: var(--jtt-bg-2); border-bottom: 1px solid var(--jtt-border);
}
.jt-tweak-builder-body { padding: 14px; overflow-y: auto; display: flex; flex-direction: column; gap: 12px; flex: 1; }
.jt-tweak-builder-intents { display: grid; grid-template-columns: 1fr 1fr; gap: 6px; }
.jt-tweak-builder-intent {
  font-size: 11.5px; color: var(--jtt-text-2); background: var(--jtt-bg-elev);
  border: 1px solid var(--jtt-border-2); border-radius: 5px; padding: 6px 8px; cursor: pointer; text-align: left;
}
.jt-tweak-builder-intent[aria-pressed="true"] { background: #1e40af; color: #fff; border-color: var(--jtt-primary); }
.jt-tweak-builder-footer { display: flex; gap: 8px; padding: 12px 14px; border-top: 1px solid var(--jtt-border); }
.jt-tweak-builder-footer .jtt-btn { flex: 1; text-align: center; }
.jt-tweak-builder-safe { font-size: 11px; color: var(--jtt-safe); display: flex; align-items: center; gap: 6px; }
```

- [ ] **Step 2: Create `builder.js` skeleton (IIFE, lifecycle + open/close)**

```js
/**
 * TweakBuilderFeature — in-page docked panel for point-and-click tweak
 * authoring. Listens for `jt-tweak-build` (capture from the picker),
 * renders intent → form → live preview (engine message) → save.
 */
const TweakBuilderFeature = (() => {
  let isActive = false;
  let panel = null;
  let capture = null;
  let intent = null;
  const values = {};
  const listeners = [];

  function on(target, event, handler) {
    target.addEventListener(event, handler);
    listeners.push({ target, event, handler });
  }

  function init() {
    if (isActive) return;
    isActive = true;
    injectStyles();
    on(window, 'jt-tweak-build', (e) => open(e.detail));
    console.log('TweakBuilder: Initialized');
  }

  function injectStyles() {
    for (const file of ['styles/jt-tools-tokens.css', 'styles/tweak-builder.css']) {
      const id = 'jt-tweak-builder-' + file.replace(/\W/g, '-');
      if (document.getElementById(id)) continue;
      const link = document.createElement('link');
      link.id = id; link.rel = 'stylesheet';
      link.href = chrome.runtime.getURL(file);
      document.head.appendChild(link);
    }
  }

  function open(ctx) {
    capture = ctx; intent = null;
    Object.keys(values).forEach((k) => delete values[k]);
    if (panel) close();
    panel = renderPanel();
    document.body.appendChild(panel);
  }

  function close() {
    sendPreviewClear();
    if (panel && panel.parentNode) panel.parentNode.removeChild(panel);
    panel = null; capture = null; intent = null;
  }

  function cleanup() {
    if (!isActive) return;
    close();
    listeners.forEach(({ target, event, handler }) => target.removeEventListener(event, handler));
    listeners.length = 0;
    isActive = false;
    console.log('TweakBuilder: Cleaned up');
  }

  // renderPanel(), the intent/form rendering, preview, and save are added in Tasks 9–11.
  function renderPanel() { /* Task 9 */ return document.createElement('div'); }
  function sendPreviewClear() { /* Task 10 */ }

  return { init, cleanup, isActive: () => isActive, _internals: { open, close } };
})();

if (typeof window !== 'undefined') window.TweakBuilderFeature = TweakBuilderFeature;
```

- [ ] **Step 3: Commit (panel fills in over the next tasks)**

```bash
git add JT-Tools-Master/features/tweak-engine/builder.js JT-Tools-Master/styles/tweak-builder.css
git commit -m "feat(tweaks): builder panel skeleton + styles"
```

---

### Task 9: Builder panel — intent grid + per-verb form

**Files:**
- Modify: `JT-Tools-Master/features/tweak-engine/builder.js`

- [ ] **Step 1: Implement `renderPanel` + intent grid + form rendering**

Replace the placeholder `renderPanel` with a full implementation that builds (using `document.createElement` and `textContent` only — no `innerHTML`):
- root `<div class="jt-tweak-builder jt-tools-surface">`
- header: title "Build a tweak" + a close button (`<i>`-free; use a text "×" button with `aria-label`) wired to `close()`
- a "You picked" chip showing `capture.selector`
- the 6 intent buttons (`rename`, `hide`, `restyle`, `warn`, `sort`, `move`) in `.jt-tweak-builder-intents`; clicking one sets `intent`, toggles `aria-pressed`, and calls `renderForm()`
- a `<div class="jt-tweak-builder-form">` container (filled by `renderForm`)
- a `<div class="jt-tweak-builder-safe">` line, shown for `rename` (the clickjacking note) — text: "Safe — won't relabel action/financial buttons"
- a Name `<input class="jtt-input">`
- footer with Cancel (→ `close()`) and Save (→ `save()`, Task 11)

`renderForm()` clears the form container and renders inputs per intent, each wired to write into `values` and call `updatePreview()` (Task 10) on `input`:
- `rename`: one text input → `values.text`
- `hide`: no fields (label "Hides the picked element")
- `restyle`: a color text input (`values.color`, placeholder `#2c2c2c`), a font-size text input (`values.fontSize`, placeholder `14px`), a Bold checkbox (`values.bold`)
- `warn`: a text input for the message → `values.confirm` (default "Are you sure?")
- `sort`: a `key` select (text/number/date) → `values.key`, a `direction` select (asc/desc) → `values.direction`
- `move`: a `position` select (before/after) → `values.position`, and a hint to pick the reference element (v1: a text input for `values.referenceSelector`)

(Full element-construction code follows the same `createElement`/`textContent` style as `system-banner.js`; reuse `.jtt-input`, `.jtt-label`, `.jtt-btn` classes.)

- [ ] **Step 2: Manual verification**

Load extension, trigger the picker-for-builder (temporary console hook: `window.dispatchEvent(new CustomEvent('jt-tweak-build', { detail: { selector: 'h1' } }))`). Expected: panel docks on the right, matches popup styling (dark `#2c2c2c`, blue primary), intent buttons toggle, and selecting "Rename text" shows a text field + the safe line.

- [ ] **Step 3: Commit**

```bash
git add JT-Tools-Master/features/tweak-engine/builder.js
git commit -m "feat(tweaks): builder intent grid + per-verb forms"
```

---

### Task 10: Builder panel — live preview

**Files:**
- Modify: `JT-Tools-Master/features/tweak-engine/builder.js`

- [ ] **Step 1: Implement preview helpers using `builder-emit` + the engine messages**

```js
  function currentTweak() {
    if (!intent) return null;
    return window.TweakBuilderEmit.buildTweak({
      intent, values, capture,
      org: window.OrgDetector ? window.OrgDetector.getActiveOrg() : '',
      urlMatch: location.pathname,
      id: '00000000-0000-4000-8000-000000000000', // placeholder id for preview only
      name: nameInput ? nameInput.value : ''
    });
  }

  function updatePreview() {
    const t = currentTweak();
    if (!t) return;
    // Validate before previewing; show describe() lines as the summary.
    const v = window.TweakValidator.validate({ ...t, id: '00000000-0000-4000-8000-000000000000' });
    renderSummary(window.TweakDescribe.describe(t), v);
    if (v.ok) chrome.runtime.sendMessage({ type: 'TWEAK_PREVIEW_APPLY', tweak: t });
  }

  function sendPreviewClear() {
    try { chrome.runtime.sendMessage({ type: 'TWEAK_PREVIEW_CLEAR' }); } catch (_) {}
  }
```

`renderSummary(lines, validation)` writes the `describe()` lines into a summary area and, if invalid, shows the first error and disables Save. Wire every form input's `input`/`change` to `updatePreview`. Call `sendPreviewClear()` in `close()` (already stubbed).

Note: the builder runs in the page (content script) context, so `chrome.runtime.sendMessage` round-trips to the engine's listener in the SAME page — confirm the engine's `listenForDryRunRequests` handles these (Task 5). Since both are content scripts in the same frame, use `chrome.runtime.sendMessage` → received by `chrome.runtime.onMessage` listeners in all extension contexts including this frame's other content scripts.

- [ ] **Step 2: Manual verification**

Open the builder on a JT `<h1>` (console hook), pick Rename, type "PREVIEW LIVE". Expected: the page `<h1>` updates live; the summary shows `Renames text to "PREVIEW LIVE"`. Click Cancel → reverts.

- [ ] **Step 3: Commit**

```bash
git add JT-Tools-Master/features/tweak-engine/builder.js
git commit -m "feat(tweaks): builder live preview via engine preview messages"
```

---

### Task 11: Builder panel — save

**Files:**
- Modify: `JT-Tools-Master/features/tweak-engine/builder.js`

- [ ] **Step 1: Implement `save()`**

```js
  async function save() {
    const org = window.OrgDetector ? window.OrgDetector.getActiveOrg() : '';
    if (!org) { /* show inline error: no active org */ return; }
    const id = (crypto && crypto.randomUUID) ? crypto.randomUUID() : null;
    const tweak = window.TweakBuilderEmit.buildTweak({
      intent, values, capture, org, urlMatch: location.pathname, id,
      name: (nameInput && nameInput.value.trim()) || undefined
    });
    const v = window.TweakValidator.validate(tweak);
    if (!v.ok) { /* show v.errors[0].reason inline */ return; }

    // Server-first (best effort), then write-through to local cache so the
    // engine's storage-change listener applies it. Mirrors editor save().
    let canonical = tweak;
    if (window.TweaksApi && window.TweaksApi.isAvailable()) {
      try {
        const result = await window.TweaksApi.create(tweak);
        if (result && result.tweak) canonical = result.tweak;
      } catch (err) { /* show 'saved locally only' notice; continue */ }
    }
    const stored = await chrome.storage.local.get(['jtTweaks']);
    const list = Array.isArray(stored.jtTweaks) ? stored.jtTweaks : [];
    list.push(canonical);
    await chrome.storage.local.set({ jtTweaks: list });

    sendPreviewClear();
    close();
  }
```

Wire the Save button (Task 9) to `save`. Save must `sendPreviewClear()` before closing so the preview slot doesn't linger while the real tweak applies.

- [ ] **Step 2: Manual verification (full loop)**

Load extension, open the builder on a JT element, Rename it, Save. Expected: panel closes, the change persists (now applied as a real saved tweak via the engine, not the preview slot), and it appears in the popup's tweak list with the chosen name.

- [ ] **Step 3: Commit**

```bash
git add JT-Tools-Master/features/tweak-engine/builder.js
git commit -m "feat(tweaks): builder save (server-first + local write-through)"
```

---

### Task 12: Wire-up — manifest, content.js, popup entry

**Files:**
- Modify: `JT-Tools-Master/manifest.json`
- Modify: `JT-Tools-Master/content.js`
- Modify: `JT-Tools-Master/popup/popup.js` and `popup/popup.html`
- Modify: `CHANGELOG.md`

- [ ] **Step 1: manifest `content_scripts.js[]`**

Insert these entries immediately AFTER `"features/tweak-engine/system-banner.js"` and BEFORE `"features/tweak-engine/index.js"`:
```json
        "features/tweak-engine/describe.js",
        "features/tweak-engine/port.js",
        "features/tweak-engine/builder-emit.js",
        "features/tweak-engine/builder.js",
```
(Load order: `describe`/`port`/`builder-emit` are dependencies of `builder.js`; all must load before `index.js`/`content.js`. `tweak-validator.js` and `css-sanitizer.js` already load earlier.)

- [ ] **Step 2: manifest `web_accessible_resources.resources[]`**

Add:
```json
        "styles/jt-tools-tokens.css",
        "styles/tweak-builder.css",
```

- [ ] **Step 3: Register the builder feature in `content.js`**

Follow the existing feature-lifecycle pattern (mirror how `inspect-for-ai`/`tweakEngine` are init/cleaned). The builder should `init()` whenever the tweak engine is active (it's free/Pro-gated identically). Add `window.TweakBuilderFeature` to the same init/cleanup path the engine uses.

- [ ] **Step 4: Popup "Build a tweak" button**

In the tweaks section of `popup.html`, add a button `<button id="tweakBuildBtn" class="...">Build a tweak</button>`. In `popup.js`'s `initTweaksSection`, wire it: on click, query the active JT tab and `chrome.tabs.sendMessage(tab.id, { type: 'INSPECT_PICK_FOR_BUILDER' })`, then `window.close()` so the user is on the page to pick. (Mirror the existing `openEditor`/tab-query code in that section.)

- [ ] **Step 5: CHANGELOG (user-visible feature)**

Under `## [Unreleased] → ### Added`:
```markdown
- Added a visual tweak builder: pick any element on JobTread and create a tweak (rename, hide, restyle, warn-before-click, sort, move) by point-and-click, with live preview — no JSON required.
```

- [ ] **Step 6: Manual verification (real end-to-end)**

Reload the unpacked extension. On `app.jobtread.com`, open the popup → click "Build a tweak" → popup closes, crosshair picker active → click the Vendor column header → panel docks → Rename to "Trade Partner" → preview shows live → Save → header stays "Trade Partner", tweak listed in popup.

- [ ] **Step 7: Commit**

```bash
git add JT-Tools-Master/manifest.json JT-Tools-Master/content.js JT-Tools-Master/popup/popup.js JT-Tools-Master/popup/popup.html CHANGELOG.md
git commit -m "feat(tweaks): wire visual builder into manifest, content orchestrator, and popup"
```

---

### Task 13: E2E + lifecycle + green gate

**Files:**
- Create: `tests/e2e/tweak-builder.spec.js`
- Modify: `tests/features/lifecycle.test.js`

- [ ] **Step 1: Add the builder to the lifecycle smoke table**

In `tests/features/lifecycle.test.js`, add a row for `TweakBuilderFeature` (init → isActive true → cleanup → isActive false), mirroring the existing entries, with the `jsdom` document as the fixture (it only needs `document.body`).

- [ ] **Step 2: Run lifecycle test**

Run: `npx vitest run tests/features/lifecycle.test.js`
Expected: PASS including the new `TweakBuilderFeature` row.

- [ ] **Step 3: Write the e2e (Playwright, against `tests/fixtures/jobtread/budget-page.html`)**

Mirror `tests/e2e/features.spec.js` setup (load extension, open fixture). Steps: dispatch `jt-tweak-build` with a `selector` targeting a fixture header cell → assert the panel appears → click "Rename text" → fill the field → assert the live preview changed the cell text → click Save → assert the panel closed and the cell text persists. Add a visual baseline only if a new rendered surface needs one (`npm run e2e:update` once, commit `tests/e2e/__screenshots__`).

- [ ] **Step 4: Run the full gate**

Run: `npm run eval:full`
Expected: all gates green (unit, security guard, tooling lint, visual regression, e2e).

- [ ] **Step 5: Commit**

```bash
git add tests/e2e/tweak-builder.spec.js tests/features/lifecycle.test.js tests/e2e/__screenshots__
git commit -m "test(tweaks): lifecycle + e2e coverage for the visual builder"
```

---

## Self-review notes

- **Spec coverage:** `describe`/`preview`/`port` core (Tasks 1–5), shared token stylesheet for popup-parity (Task 4), in-page builder with all 6 verbs (Tasks 6–11), picker hand-off (Task 7), wiring + popup entry (Task 12), tests (Tasks 1–3, 6, 13). Export/import UI, MCP path, and editor demotion are explicitly out of this plan (separate plans per the spec's build sequence).
- **`setStyle` color gotcha** is handled — Restyle emits `css`, verified by a test asserting `t.actions` is undefined and `t.css` contains the color.
- **Preview reversibility** is the main risk; Task 5's clear path restores inline styles/text and removes the preview `<style>`, verified manually and via e2e.
- **Naming consistency:** `TweakDescribe.describe/describeScope`, `TweakPort.exportTweak/importTweak`, `TweakBuilderEmit.buildTweak`, engine `previewTweak/clearPreview`, messages `TWEAK_PREVIEW_APPLY/TWEAK_PREVIEW_CLEAR`, event `jt-tweak-build`, message `INSPECT_PICK_FOR_BUILDER` — used identically across all tasks.
