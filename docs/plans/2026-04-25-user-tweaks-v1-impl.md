# User Tweaks V1 — Phase 1 Extension-Only Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use `superpowers:executing-plans` to implement this plan task-by-task.

**Goal:** Ship the local-only "User Tweaks" system: Alt-click DOM inspector that copies AI-ready context to clipboard, a declarative tweak DSL the extension interprets, a CSS-tree-AST sanitizer, a popup section to import/toggle/delete tweaks, and a minimal editor page for authoring. No server, no team sharing — that's Phase 2.

**Architecture:** Two new IIFE feature modules (`features/inspect-for-ai.js`, `features/tweak-engine/index.js`) plus three new utility modules (`utils/css-sanitizer.js`, `utils/tweak-validator.js`, vendor copies of `@medv/finder` and `css-tree`). One new full-page UI under `tweaks/edit.html`. Tweaks are stored in `chrome.storage.local` keyed by JT org name, scoped by URL pathname pattern, applied via `<style>` injection + MutationObserver-driven action applier. CSS is parsed to AST, every selector is auto-wrapped in a `.jt-tweak-{id}` scope, dangerous at-rules and value patterns are rejected. **No JS execution path** — V1 is CSS + a closed list of declarative DOM verbs (`addClass`, `removeClass`, `setStyle`, `hide`, `show`, `setText`).

**Tech Stack:** Plain JavaScript ES6+ (no bundler, no TypeScript), Chrome Extension Manifest V3, IIFE module pattern. Two vendored libraries: `@medv/finder` (~1.5KB MIT) for selector generation, `css-tree` (~150KB MIT) for CSS parsing/serialization. No new test framework — the project has none — verification uses the manual rhythm plus the `extension-test` MCP for automated DOM/console assertions where it adds real signal.

**Design source:** This plan implements Phase 1 of the user-supplied design pasted into the kickoff session. Phase 2 (MCP storage layer + new D1 tables) and Phase 3 (AI MCP write surface) are documented in the same kickoff message and are explicit non-goals here.

**Pre-flight:**
- You're in the worktree `.claude/worktrees/claude+tweaks-v1-extension` on branch `claude/tweaks-v1-extension`. Confirm with `git status` and `git branch --show-current`.
- Load the unpacked extension from `JT-Tools-Master/` at `chrome://extensions` before starting Task 1. You'll reload it after every code change. The extension ID for the loaded copy may already be visible there — note it.
- Open Chrome DevTools on a JT page (`https://app.jobtread.com`) and keep the console open throughout. The project uses prefixed `console.log('Module: msg')` patterns; you will use those to verify each step.
- This work touches manifest, content_scripts, and the popup. Do not enable hot-toggle behavior until the registry plumbing in Task 13 is done — you'll get console errors otherwise.

**TDD adaptation for this codebase:** No unit-test harness exists. Per-step verification uses three tiers in order of preference:
1. **Browser console assertions** — write small `console.assert(...)` blocks you paste into DevTools after a reload. Cheap, fast, the right granularity for sanitizer logic.
2. **`extension-test` MCP tool** — for end-to-end "click → DOM changed correctly" checks. Use sparingly; load times are real.
3. **Manual verification** — when neither of the above fits (e.g., clipboard read-back, popup UX).

Each task's "verify" step says which tier to use.

**Key V1 design decisions (locked, do not relitigate during execution):**
- **Scope by JT org name string, not org ID.** `OrgDetector` only exposes name. The DSL key is `scope.jtOrg` (string match against the active org name). Phase 2 server schema will use `jt_org_id` and resolve via license/account binding at sync time — that's a future migration, not a V1 problem. Document this with a `TODO(phase-2)` comment in the engine.
- **Defaults live in `utils/defaults.js`** (`JTDefaults.DEFAULT_SETTINGS`), NOT `background/service-worker.js`. The user-supplied plan got that wrong. Update `JTDefaults` only.
- **Editor is a `<textarea>`, not CodeMirror.** Per the project's "Don't add features beyond what the task requires" rule. CodeMirror can ship in V2.
- **No `insertHTML` / `insertElement` action verbs in V1.** Hard-rejected by the validator. XSS lives there.
- **The tweak engine is free tier (`isFeatureFree`).** No license check. Premium gate is a Phase 3 question once team-shared tweaks exist.

---

## Task 1: Vendor `@medv/finder` and `css-tree`

**Files:**
- Create: `JT-Tools-Master/vendor/finder.js`
- Create: `JT-Tools-Master/vendor/css-tree.js`
- Create: `JT-Tools-Master/vendor/README.md`

**Step 1: Fetch finder**

Pin to a specific tagged release. From the worktree root:

```bash
mkdir -p JT-Tools-Master/vendor
curl -sSL https://unpkg.com/@medv/finder@3.2.0/finder.js -o JT-Tools-Master/vendor/finder.js
ls -la JT-Tools-Master/vendor/finder.js
```

Expected: file ~1.5–3KB. The unpkg copy is an ES module — we need to make it work without a bundler. Open the file. If it ends with `export { ... }` or starts with `import`, convert it:

- Remove any top-level `import` lines (the lib has none in this version, but verify).
- Replace the trailing `export { finder as default };` (or similar) with `window.JTFinder = finder;`.
- Wrap the whole thing in an IIFE: `(() => { ...existing code...; window.JTFinder = finder; })();`

If finder is already UMD-style on unpkg, skip the wrap and just verify it sets a global.

**Step 2: Fetch css-tree**

We want the browser-ready bundle. css-tree publishes one at `dist/csstree.js`:

```bash
curl -sSL https://unpkg.com/css-tree@2.3.1/dist/csstree.js -o JT-Tools-Master/vendor/css-tree.js
ls -la JT-Tools-Master/vendor/css-tree.js
```

Expected: file ~150–200KB. The bundle exposes `csstree` as a UMD global — when no module loader is present it attaches to `window.csstree`. Open the file, confirm a line like `(this, function () { ... })` or similar UMD wrapper. No edits needed.

**Step 3: Verify in a sandbox HTML**

Create a temp file `/tmp/vendor-smoke.html` (do NOT commit):

```html
<!DOCTYPE html>
<html><body>
<script src="../JT-Tools-Master/vendor/finder.js"></script>
<script src="../JT-Tools-Master/vendor/css-tree.js"></script>
<script>
  document.body.innerHTML += '<div id="x" class="test"><span>hi</span></div>';
  const sel = window.JTFinder(document.querySelector('span'));
  console.log('finder result:', sel);
  const ast = window.csstree.parse('.foo { color: red }');
  console.log('csstree result:', window.csstree.generate(ast));
</script>
</body></html>
```

Open in Chrome (file:// works). Console must show:
- `finder result: <some selector ending in span>`
- `csstree result: .foo{color:red}`

If either fails, fix the wrapping in Step 1/2 before continuing. Delete the smoke file.

**Step 4: Document attribution**

Create `JT-Tools-Master/vendor/README.md`:

```markdown
# Vendored Libraries

These libraries are bundled directly into the extension because the project has no bundler.

## finder.js

- Source: https://github.com/antonmedv/finder
- Version: 3.2.0
- License: MIT
- Purpose: Generate unique, robust CSS selectors for arbitrary DOM elements.
  Used by the Inspect-for-AI feature to capture stable selectors when the user
  alt-clicks an element.
- Global: `window.JTFinder(element, options?)`

## css-tree.js

- Source: https://github.com/csstree/csstree
- Version: 2.3.1
- License: MIT
- Purpose: Parse CSS into a serializable AST and walk/transform it. Used by
  the tweak engine's CSS sanitizer to reject dangerous rules and auto-scope
  every tweak's selectors to a `.jt-tweak-{id}` wrapper.
- Global: `window.csstree`
```

**Step 5: Commit**

```bash
git add JT-Tools-Master/vendor/
git commit -m "$(cat <<'EOF'
chore(vendor): add finder + css-tree for User Tweaks V1

Both libraries are MIT-licensed and shipped as plain-JS globals
(window.JTFinder, window.csstree). Vendored rather than installed
because the extension has no bundler.

Groundwork for the User Tweaks feature — no behavior change.
EOF
)"
```

---

## Task 2: CSS sanitizer module

**Files:**
- Create: `JT-Tools-Master/utils/css-sanitizer.js`

**Step 1: Write the module skeleton**

Create the file. The sanitizer takes raw CSS and a `tweakId`, returns either `{ ok: true, css: '<sanitized>' }` or `{ ok: false, errors: [...] }`. Every error has a `reason` and (when known) a CSS source `position`.

```javascript
/**
 * CSS Sanitizer — parses raw CSS via css-tree, rejects dangerous constructs,
 * and wraps every selector in a `.jt-tweak-{tweakId}` scope so a tweak's
 * styles cannot bleed outside its own elements.
 *
 * Used by the User Tweaks feature. Server-side mirrors this logic in Phase 2.
 *
 * Rejection categories:
 *   - At-rule: @import, @charset, @namespace
 *   - Selector: bare html/body/:root/* (when used as the only token), or
 *     anything starting with `.jt-tools-` / `.jt-popup-` (extension UI)
 *   - Value: expression(...), behavior:..., or url(...) where the argument
 *     is not https:// or data:image/
 *
 * Allowed at-rules: @media, @supports, @keyframes, @font-face (with src
 * restrictions). All declarations preserved otherwise.
 */
const CssSanitizer = (() => {
  const csstree = window.csstree;

  const REJECTED_AT_RULES = new Set(['import', 'charset', 'namespace']);
  const ALLOWED_AT_RULES = new Set(['media', 'supports', 'keyframes', 'font-face', 'page']);
  const EXTENSION_UI_PREFIXES = ['.jt-tools-', '.jt-popup-', '.jt-tweak-edit-'];
  const FORBIDDEN_BARE_SELECTORS = new Set(['html', 'body', ':root', '*']);

  function sanitize(rawCss, options = {}) {
    if (!csstree) {
      return { ok: false, errors: [{ reason: 'css-tree library not loaded' }] };
    }
    const { tweakId } = options;
    if (!tweakId || typeof tweakId !== 'string' || !/^[a-zA-Z0-9_-]+$/.test(tweakId)) {
      return { ok: false, errors: [{ reason: 'tweakId must be a non-empty alphanumeric/-/_ string' }] };
    }
    if (typeof rawCss !== 'string') {
      return { ok: false, errors: [{ reason: 'css must be a string' }] };
    }
    if (rawCss.length > 50_000) {
      return { ok: false, errors: [{ reason: 'css exceeds 50KB limit' }] };
    }

    let ast;
    try {
      ast = csstree.parse(rawCss, { positions: true, onParseError: () => {} });
    } catch (err) {
      return { ok: false, errors: [{ reason: 'parse failed: ' + err.message }] };
    }

    const errors = [];
    const scopeClass = '.jt-tweak-' + tweakId;

    csstree.walk(ast, {
      enter(node, item, list) {
        // Reject dangerous at-rules
        if (node.type === 'Atrule') {
          const name = (node.name || '').toLowerCase();
          if (REJECTED_AT_RULES.has(name)) {
            errors.push({ reason: 'at-rule @' + name + ' is not allowed', position: node.loc?.start });
            // Remove from tree
            if (list) list.remove(item);
            return;
          }
          if (!ALLOWED_AT_RULES.has(name)) {
            errors.push({ reason: 'at-rule @' + name + ' is not on the allowlist', position: node.loc?.start });
            if (list) list.remove(item);
            return;
          }
          if (name === 'font-face') {
            // Walk the block looking for src declarations and validate URLs
            // (handled by the Url visitor below)
          }
        }

        // Reject dangerous values: expression(), url(non-https/data),
        // behavior property
        if (node.type === 'Declaration') {
          const propName = (node.property || '').toLowerCase();
          if (propName === 'behavior' || propName === '-moz-binding') {
            errors.push({ reason: 'property `' + propName + '` is not allowed', position: node.loc?.start });
            if (list) list.remove(item);
            return;
          }
        }
        if (node.type === 'Function' && (node.name || '').toLowerCase() === 'expression') {
          errors.push({ reason: 'expression() is not allowed', position: node.loc?.start });
          // Replace function with empty raw — easier than tree surgery
          node.children = csstree.List ? new csstree.List() : { head: null, tail: null };
          return;
        }
        if (node.type === 'Url') {
          const value = (node.value || '').replace(/^['"]|['"]$/g, '').trim();
          const ok = /^https:\/\//i.test(value) || /^data:image\//i.test(value);
          if (!ok) {
            errors.push({ reason: 'url() must be https:// or data:image/, got: ' + value.slice(0, 80), position: node.loc?.start });
            node.value = '';
          }
        }

        // Selectors: enforce blocklist + auto-scope
        if (node.type === 'Selector') {
          const selectorText = csstree.generate(node).trim();

          // Reject extension UI prefixes
          if (EXTENSION_UI_PREFIXES.some(p => selectorText.includes(p))) {
            errors.push({ reason: 'selector targets extension UI: ' + selectorText, position: node.loc?.start });
            // Replace the selector content with one that matches nothing — use
            // a guaranteed-no-match class
            const noMatch = csstree.parse('.jt-tweak-rejected-' + Math.random().toString(36).slice(2, 8), { context: 'selector' });
            node.children = noMatch.children;
            return;
          }

          // Reject bare html/body/:root/* (single-token selectors)
          const tokens = selectorText.split(/\s+/);
          if (tokens.length === 1 && FORBIDDEN_BARE_SELECTORS.has(tokens[0])) {
            errors.push({ reason: 'bare ' + tokens[0] + ' selector is not allowed', position: node.loc?.start });
            const noMatch = csstree.parse('.jt-tweak-rejected', { context: 'selector' });
            node.children = noMatch.children;
            return;
          }

          // Auto-scope: prepend `.jt-tweak-{id} ` to every selector
          // We do this by parsing the scope class as a selector and prepending
          // its children with a Combinator (descendant whitespace).
          const scopeAst = csstree.parse(scopeClass + ' x', { context: 'selector' });
          // scopeAst has [ClassSelector, WhiteSpace, TypeSelector(x)] — strip the trailing 'x' TypeSelector
          // Easier: build the scope nodes by hand
          const newChildren = csstree.parse(scopeClass, { context: 'selector' }).children;
          newChildren.appendData({ type: 'Combinator', name: ' ' });
          // Append all existing children
          node.children.forEach(child => newChildren.appendData(child));
          node.children = newChildren;
        }
      }
    });

    const css = csstree.generate(ast);
    return errors.length === 0
      ? { ok: true, css }
      : (css.trim().length === 0
          ? { ok: false, errors }
          : { ok: true, css, warnings: errors });
  }

  return { sanitize };
})();

window.CssSanitizer = CssSanitizer;
```

**Note on the partial-success case:** if some rules were rejected but valid CSS remains, the sanitizer returns `{ ok: true, css, warnings }`. The editor UI surfaces `warnings`; the engine accepts the partial CSS. This matches the user's design decision that the editor's error panel "surface every rejected rule with reason."

**Step 2: Add to manifest content_scripts**

Open `JT-Tools-Master/manifest.json`. The content_scripts `js` array currently runs `utils/sanitizer.js` at line 43. Insert two new lines right after `utils/sanitizer.js`:

```json
"utils/sanitizer.js",
"vendor/css-tree.js",
"vendor/finder.js",
"utils/css-sanitizer.js",
```

(Order matters: css-tree must load before css-sanitizer.) Also add `vendor/finder.js` here since we'll use it in Task 8 — easier to load it once globally than only when the inspector is active.

**Step 3: Browser-console smoke test**

Reload the unpacked extension at `chrome://extensions`. Refresh `app.jobtread.com`. Open DevTools console. Paste:

```javascript
(function() {
  const tests = [
    { name: 'simple rule', input: '.foo { color: red }', expectOk: true },
    { name: '@import rejected', input: '@import "x.css"; .a{color:red}', expectOk: true /* warning, css remains */ },
    { name: 'expression() rejected', input: '.x { width: expression(alert(1)) }', expectOk: true },
    { name: 'url(javascript:) rejected', input: '.x { background: url(javascript:alert(1)) }', expectOk: true },
    { name: 'data:text rejected', input: '.x { background: url(data:text/html,xss) }', expectOk: true },
    { name: 'bare body rejected', input: 'body { color: red }', expectOk: true },
    { name: 'html allowed in compound', input: 'html.dark .x { color: red }', expectOk: true },
    { name: 'extension UI prefix rejected', input: '.jt-tools-popup { display: none }', expectOk: true },
    { name: 'auto-scope applied', input: '.gantt-bar { height: 6px }', expectOk: true, mustContain: '.jt-tweak-test' },
    { name: 'bad tweakId', input: '.x{color:red}', tweakId: 'bad id with spaces', expectOk: false },
  ];
  let pass = 0, fail = 0;
  for (const t of tests) {
    const r = window.CssSanitizer.sanitize(t.input, { tweakId: t.tweakId || 'test' });
    const okMatches = r.ok === t.expectOk;
    const containsMatches = !t.mustContain || (r.css || '').includes(t.mustContain);
    if (okMatches && containsMatches) {
      pass++;
      console.log('PASS:', t.name, r);
    } else {
      fail++;
      console.error('FAIL:', t.name, 'got:', r);
    }
  }
  console.log(`\n${pass}/${pass+fail} passing`);
})();
```

Expected: all 10 pass. The output for valid inputs should show every selector prefixed with `.jt-tweak-test `. For inputs with rejected rules (expression, javascript: url, body, etc.), `warnings` should list the rejection reason.

If anything fails, fix the sanitizer before continuing — don't paper over a failing test.

**Step 4: Commit**

```bash
git add JT-Tools-Master/utils/css-sanitizer.js JT-Tools-Master/manifest.json
git commit -m "$(cat <<'EOF'
feat(tweaks): add css-tree-based CSS sanitizer

Parses raw CSS, rejects dangerous at-rules (@import, @charset, @namespace),
dangerous values (expression(), url() with non-https/data schemes,
behavior:), and bare html/body/:root/* selectors. Auto-wraps every
selector in a .jt-tweak-{id} scope to isolate a tweak's effects.

Wired into the content-script load order ahead of any feature that will
consume it.

Updated CHANGELOG: deferred to final task.
EOF
)"
```

---

## Task 3: Tweak DSL validator

**Files:**
- Create: `JT-Tools-Master/utils/tweak-validator.js`

**Step 1: Write the validator**

Create the file:

```javascript
/**
 * Tweak DSL Validator — validates a tweak object against the V1 schema.
 *
 * V1 schema (locked):
 *   {
 *     id: string (uuid v4 format),
 *     name: string (1..80 chars),
 *     description?: string (0..500),
 *     version: 1,
 *     scope: { jtOrg: string, urlMatch?: string },
 *     css?: string,
 *     actions?: Array<Action>,
 *     originalDomContext?: string
 *   }
 *
 * Actions (V1 closed list):
 *   { type: 'addClass',    selector: string, class: string }
 *   { type: 'removeClass', selector: string, class: string }
 *   { type: 'setStyle',    selector: string, style: { [prop]: value } }
 *   { type: 'hide',        selector: string }
 *   { type: 'show',        selector: string }
 *   { type: 'setText',     selector: string, text: string }
 *
 * Refused in V1: insertHTML, insertElement, removeElement, eval-style verbs.
 *
 * Selectors are checked for the same extension-UI blocklist as the CSS
 * sanitizer. setStyle values pass through Sanitizer.sanitizeCSSValue.
 */
const TweakValidator = (() => {
  const ALLOWED_VERBS = new Set(['addClass', 'removeClass', 'setStyle', 'hide', 'show', 'setText']);
  const EXTENSION_UI_PREFIXES = ['.jt-tools-', '.jt-popup-', '.jt-tweak-edit-'];
  const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

  function isSafeSelector(sel) {
    if (typeof sel !== 'string' || sel.length === 0 || sel.length > 500) return false;
    if (EXTENSION_UI_PREFIXES.some(p => sel.includes(p))) return false;
    // Quick syntax check: must succeed querySelector parse
    try {
      document.createDocumentFragment().querySelector(sel);
      return true;
    } catch {
      return false;
    }
  }

  function validate(tweak) {
    const errors = [];

    if (!tweak || typeof tweak !== 'object') {
      return { ok: false, errors: [{ field: '', reason: 'tweak must be an object' }] };
    }

    // id
    if (!tweak.id || !UUID_RE.test(tweak.id)) {
      errors.push({ field: 'id', reason: 'id must be a uuid v4' });
    }

    // name
    if (typeof tweak.name !== 'string' || tweak.name.trim().length === 0 || tweak.name.length > 80) {
      errors.push({ field: 'name', reason: 'name must be a 1..80 char string' });
    }

    // description (optional)
    if (tweak.description !== undefined && (typeof tweak.description !== 'string' || tweak.description.length > 500)) {
      errors.push({ field: 'description', reason: 'description must be a string up to 500 chars' });
    }

    // version
    if (tweak.version !== 1) {
      errors.push({ field: 'version', reason: 'version must be 1 (V1 schema)' });
    }

    // scope
    if (!tweak.scope || typeof tweak.scope !== 'object') {
      errors.push({ field: 'scope', reason: 'scope is required' });
    } else {
      if (typeof tweak.scope.jtOrg !== 'string' || tweak.scope.jtOrg.length === 0) {
        errors.push({ field: 'scope.jtOrg', reason: 'scope.jtOrg must be a non-empty org name string' });
      }
      if (tweak.scope.urlMatch !== undefined && typeof tweak.scope.urlMatch !== 'string') {
        errors.push({ field: 'scope.urlMatch', reason: 'scope.urlMatch must be a string (substring match against pathname)' });
      }
    }

    // css (optional)
    if (tweak.css !== undefined && typeof tweak.css !== 'string') {
      errors.push({ field: 'css', reason: 'css must be a string' });
    }

    // actions (optional)
    if (tweak.actions !== undefined) {
      if (!Array.isArray(tweak.actions)) {
        errors.push({ field: 'actions', reason: 'actions must be an array' });
      } else {
        if (tweak.actions.length > 100) {
          errors.push({ field: 'actions', reason: 'no more than 100 actions per tweak' });
        }
        tweak.actions.forEach((action, i) => {
          if (!action || typeof action !== 'object') {
            errors.push({ field: `actions[${i}]`, reason: 'action must be an object' });
            return;
          }
          if (!ALLOWED_VERBS.has(action.type)) {
            errors.push({ field: `actions[${i}].type`, reason: `verb "${action.type}" is not allowed in V1 (allowed: ${[...ALLOWED_VERBS].join(', ')})` });
            return;
          }
          if (!isSafeSelector(action.selector)) {
            errors.push({ field: `actions[${i}].selector`, reason: 'selector is invalid or targets extension UI' });
          }
          if (action.type === 'addClass' || action.type === 'removeClass') {
            if (typeof action.class !== 'string' || !/^[a-zA-Z_-][a-zA-Z0-9_-]*$/.test(action.class)) {
              errors.push({ field: `actions[${i}].class`, reason: 'class must be a valid CSS identifier' });
            }
          }
          if (action.type === 'setStyle') {
            if (!action.style || typeof action.style !== 'object') {
              errors.push({ field: `actions[${i}].style`, reason: 'style must be an object of {property: value}' });
            } else {
              for (const [prop, val] of Object.entries(action.style)) {
                // Property must be camelCase or kebab-case identifier
                if (!/^[a-zA-Z][a-zA-Z0-9-]*$/.test(prop)) {
                  errors.push({ field: `actions[${i}].style.${prop}`, reason: 'property name is invalid' });
                  continue;
                }
                // Value must pass sanitizeCSSValue
                const safe = window.Sanitizer && window.Sanitizer.sanitizeCSSValue
                  ? window.Sanitizer.sanitizeCSSValue(String(val))
                  : null;
                if (!safe || safe !== String(val).trim()) {
                  errors.push({ field: `actions[${i}].style.${prop}`, reason: 'value contains disallowed characters or fails sanitization' });
                }
              }
            }
          }
          if (action.type === 'setText') {
            if (typeof action.text !== 'string' || action.text.length > 500) {
              errors.push({ field: `actions[${i}].text`, reason: 'text must be a string up to 500 chars' });
            }
          }
        });
      }
    }

    // originalDomContext (optional)
    if (tweak.originalDomContext !== undefined && typeof tweak.originalDomContext !== 'string') {
      errors.push({ field: 'originalDomContext', reason: 'originalDomContext must be a string' });
    }

    return errors.length === 0 ? { ok: true } : { ok: false, errors };
  }

  return { validate, isSafeSelector };
})();

window.TweakValidator = TweakValidator;
```

**Step 2: Add to manifest content_scripts**

In `manifest.json`, after `utils/css-sanitizer.js`, add `utils/tweak-validator.js`.

**Step 3: Browser-console smoke test**

Reload the extension. Refresh `app.jobtread.com`. In console:

```javascript
(function() {
  const goodId = '12345678-1234-4234-8234-123456789abc';
  const tests = [
    { name: 'minimal valid', tweak: { id: goodId, name: 'x', version: 1, scope: { jtOrg: 'Titus' } }, ok: true },
    { name: 'missing id', tweak: { name: 'x', version: 1, scope: { jtOrg: 'Titus' } }, ok: false },
    { name: 'bad version', tweak: { id: goodId, name: 'x', version: 2, scope: { jtOrg: 'Titus' } }, ok: false },
    { name: 'unknown verb rejected', tweak: { id: goodId, name: 'x', version: 1, scope: { jtOrg: 'Titus' }, actions: [{ type: 'insertHTML', selector: '.x', html: '<x>' }] }, ok: false },
    { name: 'addClass valid', tweak: { id: goodId, name: 'x', version: 1, scope: { jtOrg: 'Titus' }, actions: [{ type: 'addClass', selector: '.x', class: 'foo' }] }, ok: true },
    { name: 'extension UI selector rejected', tweak: { id: goodId, name: 'x', version: 1, scope: { jtOrg: 'Titus' }, actions: [{ type: 'hide', selector: '.jt-tools-popup' }] }, ok: false },
    { name: 'setStyle bad value rejected', tweak: { id: goodId, name: 'x', version: 1, scope: { jtOrg: 'Titus' }, actions: [{ type: 'setStyle', selector: '.x', style: { width: 'expression(1)' } }] }, ok: false },
    { name: 'setStyle good value', tweak: { id: goodId, name: 'x', version: 1, scope: { jtOrg: 'Titus' }, actions: [{ type: 'setStyle', selector: '.x', style: { width: '100px' } }] }, ok: true },
  ];
  let pass = 0, fail = 0;
  for (const t of tests) {
    const r = window.TweakValidator.validate(t.tweak);
    if (r.ok === t.ok) {
      pass++;
      console.log('PASS:', t.name);
    } else {
      fail++;
      console.error('FAIL:', t.name, 'got:', r);
    }
  }
  console.log(`\n${pass}/${pass+fail} passing`);
})();
```

Expected: 8/8 passing. If `setStyle bad value rejected` passes but should fail, double-check `Sanitizer.sanitizeCSSValue` behavior — it may need a tighter regex than the existing sanitizer applies. Look at `JT-Tools-Master/utils/sanitizer.js` and verify what `sanitizeCSSValue('expression(1)')` returns; if it doesn't reject, we need to harden either the existing utility or the validator's check. Prefer hardening the validator's check (less risk of breaking other features).

**Step 4: Commit**

```bash
git add JT-Tools-Master/utils/tweak-validator.js JT-Tools-Master/manifest.json
git commit -m "$(cat <<'EOF'
feat(tweaks): add DSL validator for User Tweaks V1 schema

Validates tweak objects: id (uuid), name length, scope.jtOrg required,
version === 1, actions limited to a closed verb list (addClass,
removeClass, setStyle, hide, show, setText), selectors blocked from
targeting extension UI, setStyle values run through Sanitizer.sanitizeCSSValue.

Refuses insertHTML / insertElement and any unknown verb.
EOF
)"
```

---

## Task 4: Tweak engine skeleton (loads + scopes, no apply yet)

**Files:**
- Create: `JT-Tools-Master/features/tweak-engine/index.js`

**Step 1: Write the IIFE skeleton**

Following the exact pattern from `.claude/rules/development-patterns.md`:

```javascript
/**
 * Tweak Engine — applies user-authored tweaks (CSS + declarative DOM
 * actions) to JobTread pages, scoped by JT org name and URL pathname.
 *
 * Storage: chrome.storage.local['jtTweaks'] is an array of tweak objects
 * matching the V1 DSL (see utils/tweak-validator.js). Per-tweak diagnostics
 * (selector match counts, last error) live at chrome.storage.local['jtTweakDiagnostics'].
 *
 * TODO(phase-2): swap the storage backend for /tweaks API calls when the
 * MCP storage layer ships. The shape of `tweak` objects already matches
 * the planned server schema, so the migration is a fetch swap, not a
 * data restructure.
 */
const TweakEngineFeature = (() => {
  let isActive = false;
  let activeTweakIds = new Set();
  let injectedStyles = new Map();   // tweakId -> <style> element
  let observers = [];                // MutationObservers
  let eventListeners = [];           // {target, event, handler}

  function init() {
    if (isActive) return;
    isActive = true;
    console.log('TweakEngine: Initializing...');
    loadAndApply();
    listenForStorageChanges();
    listenForOrgChanges();
    console.log('TweakEngine: Initialized');
  }

  async function loadAndApply() {
    try {
      const stored = await chrome.storage.local.get(['jtTweaks']);
      const tweaks = Array.isArray(stored.jtTweaks) ? stored.jtTweaks : [];
      const matching = tweaks.filter(matchesContext);
      console.log(`TweakEngine: Loaded ${tweaks.length} total, ${matching.length} match current context`);
      // Apply phase added in Task 5/6 — for now just log.
      activeTweakIds = new Set(matching.map(t => t.id));
    } catch (err) {
      console.error('TweakEngine: Failed to load tweaks:', err);
    }
  }

  function matchesContext(tweak) {
    if (!tweak.enabled) return false;
    if (!tweak.scope || !tweak.scope.jtOrg) return false;
    const activeOrg = window.OrgDetector ? window.OrgDetector.getActiveOrg() : null;
    if (!activeOrg) return false;
    if (tweak.scope.jtOrg !== activeOrg) return false;
    if (tweak.scope.urlMatch && !window.location.pathname.includes(tweak.scope.urlMatch)) {
      return false;
    }
    return true;
  }

  function listenForStorageChanges() {
    const handler = (changes, areaName) => {
      if (areaName !== 'local') return;
      if (!changes.jtTweaks) return;
      console.log('TweakEngine: Tweak set changed, re-applying');
      removeAllAppliedTweaks();
      loadAndApply();
    };
    chrome.storage.onChanged.addListener(handler);
    eventListeners.push({ target: chrome.storage.onChanged, event: 'change', handler, isChromeListener: true });
  }

  function listenForOrgChanges() {
    const handler = (e) => {
      console.log('TweakEngine: Org changed, re-evaluating tweaks');
      removeAllAppliedTweaks();
      loadAndApply();
    };
    window.addEventListener('jt-org-changed', handler);
    eventListeners.push({ target: window, event: 'jt-org-changed', handler });
  }

  function removeAllAppliedTweaks() {
    for (const styleEl of injectedStyles.values()) {
      if (styleEl && styleEl.parentNode) styleEl.parentNode.removeChild(styleEl);
    }
    injectedStyles.clear();
    observers.forEach(o => o.disconnect());
    observers = [];
    activeTweakIds.clear();
  }

  function cleanup() {
    if (!isActive) return;
    console.log('TweakEngine: Cleaning up...');
    removeAllAppliedTweaks();
    eventListeners.forEach(({ target, event, handler, isChromeListener }) => {
      if (isChromeListener) {
        target.removeListener(handler);
      } else {
        target.removeEventListener(event, handler);
      }
    });
    eventListeners = [];
    isActive = false;
    console.log('TweakEngine: Cleaned up');
  }

  return {
    init,
    cleanup,
    isActive: () => isActive,
    // exposed for the editor's "Test on active tab" message handler — set in Task 9
    _internals: { loadAndApply, removeAllAppliedTweaks, matchesContext }
  };
})();

window.TweakEngineFeature = TweakEngineFeature;
```

**Step 2: Add to manifest content_scripts**

In `manifest.json`, append `features/tweak-engine/index.js` near the end of the `js` array, AFTER all other feature scripts but BEFORE `content.js`. Place it alongside `features/org-logo.js` (line ~100).

**Step 3: Smoke test (no apply yet)**

Reload extension. On a JT page, open console:

```javascript
window.TweakEngineFeature           // should be defined
window.TweakEngineFeature.isActive()  // false (not in registry yet)
window.TweakEngineFeature.init()      // should log "Initializing..." and "Loaded 0 total..."
```

Expected: no errors. Engine logs that it initialized and saw 0 tweaks.

Now manually plant a tweak in storage and verify it's seen:

```javascript
const orgName = window.OrgDetector.getActiveOrg();
chrome.storage.local.set({
  jtTweaks: [{
    id: '12345678-1234-4234-8234-123456789abc',
    name: 'Test',
    version: 1,
    enabled: true,
    scope: { jtOrg: orgName },
    css: '.gantt-bar { height: 6px }'
  }]
}, () => console.log('Storage written'));
```

Expected: console logs "TweakEngine: Tweak set changed, re-applying" then "Loaded 1 total, 1 match current context". This validates that:
- Storage change listener fires
- Org-name match works against the live `OrgDetector`

Clean up the test data when done:

```javascript
chrome.storage.local.remove(['jtTweaks']);
```

**Step 4: Commit**

```bash
git add JT-Tools-Master/features/tweak-engine/index.js JT-Tools-Master/manifest.json
git commit -m "$(cat <<'EOF'
feat(tweaks): add tweak-engine skeleton with org/URL scoping

Loads tweaks from chrome.storage.local, filters by active JT org name
(via OrgDetector) and URL pathname substring match, listens for storage
changes and org-change events to hot-reload. No apply phase yet — the
matching set is just logged.

Wired into the content-script load order. Not yet registered in
content.js featureModules — that lands with the registry update.
EOF
)"
```

---

## Task 5: Apply CSS phase

**Files:**
- Modify: `JT-Tools-Master/features/tweak-engine/index.js`

**Step 1: Implement `applyTweak(tweak)` for the CSS path**

In `tweak-engine/index.js`, replace the body of `loadAndApply()` to actually apply matching tweaks, and add `applyTweak`:

Find the current `async function loadAndApply()`. Replace its body (after the try/catch around storage.get) so it iterates and applies. Add a new helper just below it:

```javascript
  async function loadAndApply() {
    try {
      const stored = await chrome.storage.local.get(['jtTweaks']);
      const tweaks = Array.isArray(stored.jtTweaks) ? stored.jtTweaks : [];
      const matching = tweaks.filter(matchesContext);
      console.log(`TweakEngine: Loaded ${tweaks.length} total, ${matching.length} match current context`);
      activeTweakIds = new Set();
      for (const tweak of matching) {
        applyTweak(tweak);
      }
    } catch (err) {
      console.error('TweakEngine: Failed to load tweaks:', err);
    }
  }

  function applyTweak(tweak) {
    // Validate the tweak before doing anything with it. Validation runs again
    // here even though the editor validates on save — defense in depth in
    // case storage was modified outside the editor.
    if (!window.TweakValidator) {
      console.error('TweakEngine: TweakValidator missing, cannot apply', tweak.id);
      return;
    }
    const v = window.TweakValidator.validate(tweak);
    if (!v.ok) {
      console.error('TweakEngine: tweak failed validation, skipping', tweak.id, v.errors);
      recordDiagnostic(tweak.id, { lastError: 'validation: ' + v.errors[0]?.reason, lastErrorAt: Date.now() });
      return;
    }

    // Apply CSS
    if (tweak.css && tweak.css.trim()) {
      const sanitizeResult = window.CssSanitizer.sanitize(tweak.css, { tweakId: tweak.id });
      if (!sanitizeResult.ok) {
        console.error('TweakEngine: css sanitization failed, skipping', tweak.id, sanitizeResult.errors);
        recordDiagnostic(tweak.id, { lastError: 'css: ' + sanitizeResult.errors[0]?.reason, lastErrorAt: Date.now() });
        return;
      }
      injectStyle(tweak.id, sanitizeResult.css);
      // Apply the scope class to <html> so descendant selectors match.
      // The scope class is .jt-tweak-{id} — see CssSanitizer.
      document.documentElement.classList.add('jt-tweak-' + tweak.id);
    }

    activeTweakIds.add(tweak.id);
    recordDiagnostic(tweak.id, { lastApplyAt: Date.now(), lastError: null });
    // Action applier in Task 6
  }

  function injectStyle(tweakId, css) {
    const styleId = 'jt-tweak-style-' + tweakId;
    let styleEl = document.getElementById(styleId);
    if (!styleEl) {
      styleEl = document.createElement('style');
      styleEl.id = styleId;
      styleEl.dataset.tweakId = tweakId;
      document.head.appendChild(styleEl);
    }
    styleEl.textContent = css;
    injectedStyles.set(tweakId, styleEl);
  }

  // In-memory diagnostics, flushed to storage on a debounce.
  const diagnosticsBuffer = new Map();
  let diagnosticsFlushTimer = null;
  function recordDiagnostic(tweakId, partial) {
    const existing = diagnosticsBuffer.get(tweakId) || {};
    diagnosticsBuffer.set(tweakId, { ...existing, ...partial });
    if (diagnosticsFlushTimer) clearTimeout(diagnosticsFlushTimer);
    diagnosticsFlushTimer = setTimeout(flushDiagnostics, 2000);
  }
  async function flushDiagnostics() {
    if (diagnosticsBuffer.size === 0) return;
    try {
      const stored = await chrome.storage.local.get(['jtTweakDiagnostics']);
      const merged = { ...(stored.jtTweakDiagnostics || {}) };
      for (const [id, partial] of diagnosticsBuffer.entries()) {
        merged[id] = { ...(merged[id] || {}), ...partial };
      }
      await chrome.storage.local.set({ jtTweakDiagnostics: merged });
      diagnosticsBuffer.clear();
    } catch (err) {
      console.warn('TweakEngine: failed to flush diagnostics', err);
    }
  }
```

Also update `removeAllAppliedTweaks` to strip the scope classes from `<html>`:

```javascript
  function removeAllAppliedTweaks() {
    for (const [id, styleEl] of injectedStyles.entries()) {
      if (styleEl && styleEl.parentNode) styleEl.parentNode.removeChild(styleEl);
      document.documentElement.classList.remove('jt-tweak-' + id);
    }
    injectedStyles.clear();
    observers.forEach(o => o.disconnect());
    observers = [];
    activeTweakIds.clear();
  }
```

**Step 2: Verify with a real tweak**

Reload extension. On JT, in console:

```javascript
window.TweakEngineFeature.init();
const orgName = window.OrgDetector.getActiveOrg();
chrome.storage.local.set({
  jtTweaks: [{
    id: '12345678-1234-4234-8234-123456789abc',
    name: 'Red Outline',
    version: 1,
    enabled: true,
    scope: { jtOrg: orgName },
    css: 'div { outline: 2px solid red !important }'
  }]
});
```

Wait ~500ms. Expected:
- `<style id="jt-tweak-style-12345678-...">` appears in `<head>`
- `<html>` has class `jt-tweak-12345678-...`
- Every `div` on the page now has a red outline.

Inspect the injected `<style>` element's text — confirm every selector starts with `.jt-tweak-12345678... div` (the auto-scope wrap).

Clean up:

```javascript
chrome.storage.local.remove(['jtTweaks']);
```

Confirm the red outlines disappear (storage change → `removeAllAppliedTweaks()`).

**Step 3: Commit**

```bash
git add JT-Tools-Master/features/tweak-engine/index.js
git commit -m "$(cat <<'EOF'
feat(tweaks): apply CSS phase of tweak-engine

Each matching tweak now: validates against the DSL, sanitizes its CSS,
injects a <style> with the scoped output, and adds the .jt-tweak-{id}
class to <html> so descendant selectors match. Diagnostics are recorded
in a debounced in-memory buffer and flushed to chrome.storage.local
every 2s.
EOF
)"
```

---

## Task 6: Apply actions phase with MutationObserver

**Files:**
- Modify: `JT-Tools-Master/features/tweak-engine/index.js`

**Step 1: Implement the action applier**

Inside `applyTweak`, after the CSS injection block but before `activeTweakIds.add`, add the actions block:

```javascript
    // Apply actions
    if (Array.isArray(tweak.actions) && tweak.actions.length > 0) {
      const applyActions = makeActionApplier(tweak);
      applyActions();  // run once now
      // Re-run on DOM changes — but only if the tweak's actions haven't been
      // fully applied yet. JT is a SPA so new matching elements appear on
      // navigation. We use a body-level observer with a debounce.
      const obs = new MutationObserver(debounce(applyActions, 100));
      obs.observe(document.body, { childList: true, subtree: true });
      observers.push(obs);
    }
```

Add the helpers below the existing `recordDiagnostic` block:

```javascript
  function makeActionApplier(tweak) {
    // Track which (action, element) pairs we've already applied so re-runs
    // are idempotent. WeakSet by element keyed per action index.
    const appliedSets = tweak.actions.map(() => new WeakSet());

    return function applyOnce() {
      let totalMatches = 0;
      tweak.actions.forEach((action, i) => {
        let matches;
        try {
          matches = document.querySelectorAll(action.selector);
        } catch (err) {
          recordDiagnostic(tweak.id, { lastError: `action[${i}]: invalid selector`, lastErrorAt: Date.now() });
          return;
        }
        totalMatches += matches.length;
        for (const el of matches) {
          if (appliedSets[i].has(el)) continue;
          try {
            runAction(action, el, tweak.id);
            appliedSets[i].add(el);
          } catch (err) {
            recordDiagnostic(tweak.id, { lastError: `action[${i}]: ${err.message}`, lastErrorAt: Date.now() });
          }
        }
      });
      recordDiagnostic(tweak.id, { lastMatchCount: totalMatches, lastApplyAt: Date.now() });
    };
  }

  function runAction(action, el, tweakId) {
    switch (action.type) {
      case 'addClass':
        el.classList.add(action.class);
        break;
      case 'removeClass':
        el.classList.remove(action.class);
        break;
      case 'setStyle':
        for (const [prop, val] of Object.entries(action.style || {})) {
          // setProperty handles both kebab and camel case; convert camel to kebab
          const kebab = prop.replace(/([A-Z])/g, '-$1').toLowerCase();
          el.style.setProperty(kebab, val);
        }
        break;
      case 'hide':
        el.dataset.jtTweakHidden = tweakId;
        el.style.setProperty('display', 'none', 'important');
        break;
      case 'show':
        if (el.dataset.jtTweakHidden === tweakId) {
          delete el.dataset.jtTweakHidden;
          el.style.removeProperty('display');
        }
        break;
      case 'setText':
        // Use textContent to avoid HTML injection. Existing children are wiped.
        el.textContent = action.text;
        break;
    }
  }

  function debounce(fn, ms) {
    let t = null;
    return function (...args) {
      if (t) clearTimeout(t);
      t = setTimeout(() => fn.apply(this, args), ms);
    };
  }
```

**Step 2: Verify**

Reload extension. On JT, in console:

```javascript
const orgName = window.OrgDetector.getActiveOrg();
chrome.storage.local.set({
  jtTweaks: [{
    id: '12345678-1234-4234-8234-123456789abc',
    name: 'Action Test',
    version: 1,
    enabled: true,
    scope: { jtOrg: orgName },
    actions: [
      { type: 'addClass', selector: 'body', class: 'jt-test-marker' },
      { type: 'setStyle', selector: '.jt-top-header', style: { borderTop: '4px solid lime' } }
    ]
  }]
});
```

Expected:
- `document.body.classList.contains('jt-test-marker')` returns `true`
- `.jt-top-header` has a 4px lime top border
- Diagnostics buffer flushes to storage; check with:
  ```javascript
  chrome.storage.local.get(['jtTweakDiagnostics'], r => console.log(r));
  ```
  Expect a record showing `lastMatchCount` ≥ 2 and recent `lastApplyAt`.

Now navigate within JT (click another job). The actions should re-apply to any newly rendered `.jt-top-header` (still works because it's the same element) AND `body` should retain its class.

Clean up:

```javascript
chrome.storage.local.remove(['jtTweaks']);
```

Verify body class is gone and header border is gone.

**Step 3: Commit**

```bash
git add JT-Tools-Master/features/tweak-engine/index.js
git commit -m "$(cat <<'EOF'
feat(tweaks): apply DOM actions phase with MutationObserver

Closed-list verbs: addClass, removeClass, setStyle, hide, show, setText.
Each action is run once per matching element (tracked via per-action
WeakSet), and the body-level MutationObserver re-runs on DOM changes
so SPA navigation in JT picks up newly-rendered matches.

Diagnostics now record per-tweak match counts and per-action errors.
EOF
)"
```

---

## Task 7: Inspect-for-AI feature

**Files:**
- Create: `JT-Tools-Master/features/inspect-for-ai.js`

**Step 1: Write the IIFE**

```javascript
/**
 * Inspect-for-AI — when active, alt-clicking any element on app.jobtread.com
 * captures DOM context (selector + ancestors + descendants + URL + org)
 * formatted as markdown and copies it to the clipboard. The user pastes
 * this into any AI chat (Claude.ai, ChatGPT, Cursor, etc.) so the AI has
 * enough context to author a working tweak.
 *
 * Selector generation uses @medv/finder (vendored as window.JTFinder).
 * Tailwind atomic classes are explicitly blocklisted via finder's tagFilter
 * so we get stable structural selectors instead of fragile utility chains.
 */
const InspectForAiFeature = (() => {
  let isActive = false;
  let eventListeners = [];

  // Tailwind atomic prefixes finder should ignore — these change every release.
  // Borrowed from the user-supplied design doc.
  const TAILWIND_PREFIX_RE = /^(text-|bg-|flex-|grid-|p-|m-|w-|h-|gap-|rounded|shadow|border-|cursor-|opacity-|z-|inset-|top-|right-|bottom-|left-|max-|min-|space-|divide-|order-|col-|row-|leading-|tracking-|uppercase|lowercase|whitespace-|truncate|overflow-|object-|select-|pointer-|appearance-|outline-|ring-|fill-|stroke-)/;

  function init() {
    if (isActive) return;
    isActive = true;
    console.log('InspectForAi: Initializing...');
    const handler = (e) => {
      if (!e.altKey) return;
      // Don't interfere with extension UI itself
      if (e.target.closest('.jt-tools-popup, .jt-tweak-edit-')) return;
      e.preventDefault();
      e.stopPropagation();
      captureAndCopy(e.target);
    };
    document.addEventListener('click', handler, true);  // capture phase to fire before JT handlers
    eventListeners.push({ target: document, event: 'click', handler, useCapture: true });
    console.log('InspectForAi: Initialized — alt+click any element to copy DOM context');
  }

  function captureAndCopy(el) {
    if (!window.JTFinder) {
      showToast('Selector library not loaded', true);
      return;
    }
    let selector;
    try {
      selector = window.JTFinder(el, {
        className: (n) => !TAILWIND_PREFIX_RE.test(n),
        tagName: () => true,
        seedMinLength: 1,
        optimizedMinLength: 2
      });
    } catch (err) {
      console.error('InspectForAi: finder failed', err);
      showToast('Could not generate selector', true);
      return;
    }

    const md = formatMarkdown(el, selector);
    navigator.clipboard.writeText(md)
      .then(() => showToast('Copied DOM context for AI'))
      .catch((err) => {
        console.error('InspectForAi: clipboard write failed', err);
        showToast('Clipboard write failed', true);
      });
  }

  function formatMarkdown(el, selector) {
    const tag = el.tagName.toLowerCase();
    const classes = el.className && typeof el.className === 'string' ? el.className.split(/\s+/).filter(Boolean) : [];
    const dataAttrs = collectDataAttrs(el);
    const ancestors = collectAncestors(el, 2);
    const descendants = collectDescendants(el, 2);
    const orgName = window.OrgDetector ? window.OrgDetector.getActiveOrg() : '(unknown)';
    const path = window.location.pathname;

    return [
      '## JT DOM Context for AI',
      '',
      '**Active org:** ' + orgName,
      '**Path:** ' + path,
      '',
      '**Target selector (recommended):** `' + selector + '`',
      '',
      '**Target element:** `<' + tag + (classes.length ? ' class="' + classes.join(' ') + '"' : '') + (dataAttrs ? ' ' + dataAttrs : '') + '>`',
      '',
      '**Ancestor chain (closest first):**',
      ancestors.map((a, i) => `${i + 1}. \`${a}\``).join('\n'),
      '',
      '**Sampled descendants (depth 2):**',
      descendants.length ? descendants.map(d => `- \`${d}\``).join('\n') : '(none)',
      '',
      '_Copied by JT Power Tools — Inspect for AI_'
    ].join('\n');
  }

  function collectDataAttrs(el) {
    const attrs = [];
    for (const a of el.attributes || []) {
      if (a.name.startsWith('data-')) attrs.push(a.name + '="' + a.value + '"');
    }
    return attrs.join(' ');
  }

  function collectAncestors(el, depth) {
    const out = [];
    let cur = el.parentElement;
    let d = 0;
    while (cur && d < depth) {
      out.push(formatTagSnippet(cur));
      cur = cur.parentElement;
      d++;
    }
    return out;
  }

  function collectDescendants(el, depth) {
    const out = [];
    function walk(node, d) {
      if (d > depth) return;
      const child = node.firstElementChild;
      if (child) {
        out.push(formatTagSnippet(child));
        walk(child, d + 1);
      }
    }
    walk(el, 1);
    return out;
  }

  function formatTagSnippet(el) {
    const tag = el.tagName.toLowerCase();
    const cls = el.className && typeof el.className === 'string'
      ? el.className.split(/\s+/).filter(c => c && !TAILWIND_PREFIX_RE.test(c)).slice(0, 4)
      : [];
    const dataAttrs = collectDataAttrs(el);
    return '<' + tag + (cls.length ? ' class="' + cls.join(' ') + '"' : '') + (dataAttrs ? ' ' + dataAttrs : '') + '>';
  }

  let toastEl = null;
  let toastTimer = null;
  function showToast(msg, isError = false) {
    if (!toastEl) {
      toastEl = document.createElement('div');
      toastEl.className = 'jt-tools-inspect-toast';
      toastEl.style.cssText = 'position:fixed;bottom:20px;right:20px;padding:10px 16px;background:#252525;color:#e0e0e0;border-radius:4px;border:1px solid #404040;font:13px system-ui;z-index:99999;box-shadow:0 4px 12px rgba(0,0,0,0.3);transition:opacity 200ms';
      document.body.appendChild(toastEl);
    }
    toastEl.textContent = msg;
    toastEl.style.borderColor = isError ? '#a02020' : '#404040';
    toastEl.style.opacity = '1';
    if (toastTimer) clearTimeout(toastTimer);
    toastTimer = setTimeout(() => {
      if (toastEl) toastEl.style.opacity = '0';
    }, 2000);
  }

  function cleanup() {
    if (!isActive) return;
    console.log('InspectForAi: Cleaning up...');
    eventListeners.forEach(({ target, event, handler, useCapture }) => {
      target.removeEventListener(event, handler, useCapture);
    });
    eventListeners = [];
    if (toastEl && toastEl.parentNode) toastEl.parentNode.removeChild(toastEl);
    toastEl = null;
    if (toastTimer) clearTimeout(toastTimer);
    isActive = false;
    console.log('InspectForAi: Cleaned up');
  }

  return { init, cleanup, isActive: () => isActive };
})();

window.InspectForAiFeature = InspectForAiFeature;
```

**Step 2: Add to manifest content_scripts**

In `manifest.json`, append `features/inspect-for-ai.js` near other features (alongside `features/org-logo.js`).

**Step 3: Add `clipboardWrite` permission**

In `manifest.json` `permissions` array (currently `["storage", "activeTab"]`), add `"clipboardWrite"`. The final array:

```json
"permissions": ["storage", "activeTab", "clipboardWrite"],
```

**Step 4: Verify**

Reload extension. On JT, in console:

```javascript
window.InspectForAiFeature.init();
```

Then alt+click on, say, `.jt-top-header`. Expected:
- Toast in bottom-right: "Copied DOM context for AI"
- No console errors
- Paste into a text editor — you should see a markdown block with sections: Active org, Path, Target selector, Target element, Ancestor chain, Sampled descendants

Try alt+click on a Gantt bar (navigate to a schedule first). Confirm the selector returned is reasonably stable (not a chain of 8 Tailwind atomic classes).

Test cleanup:

```javascript
window.InspectForAiFeature.cleanup();
```

Alt+click should now do nothing (no toast).

**Step 5: Commit**

```bash
git add JT-Tools-Master/features/inspect-for-ai.js JT-Tools-Master/manifest.json
git commit -m "$(cat <<'EOF'
feat(tweaks): add inspect-for-ai feature

Alt+click any element on app.jobtread.com to capture DOM context
(selector via @medv/finder with Tailwind atomic-class blocklist,
2 ancestors up, 2 descendants down, current URL, active org name)
and copy it to clipboard as a labeled markdown block. The user pastes
this into any AI chat to give the AI enough context to author a
working tweak.

Adds clipboardWrite permission (already minimal manifest, no other
new permissions needed).
EOF
)"
```

---

## Task 8: Register both features in content.js + defaults

**Files:**
- Modify: `JT-Tools-Master/content.js` (the `featureModules` registry, ~line 33-164)
- Modify: `JT-Tools-Master/utils/defaults.js` (`DEFAULT_SETTINGS` ~line 11-65)

**Step 1: Register in content.js**

In `content.js`, find the `featureModules` object (starts ~line 33). Add two new entries at the end of the registry (just before the commented-out `fileDragToFolder`):

```javascript
  inspectForAi: {
    name: 'Inspect for AI',
    feature: () => window.InspectForAiFeature,
    instance: null
  },
  tweakEngine: {
    name: 'User Tweaks',
    feature: () => window.TweakEngineFeature,
    instance: null
  },
```

**Step 2: Register in defaults**

In `utils/defaults.js`, find `DEFAULT_SETTINGS`. Add the two new keys grouped under "Free Features - Productivity Tools" (matching the section comment around line 23):

```javascript
    // ... existing free features
    reverseThreadOrder: false,
    budgetTools: false,
    inspectForAi: false,    // off by default — most users won't author tweaks
    tweakEngine: true,      // on by default — installed tweaks should "just work"
```

Also update `FEATURE_CATEGORIES.productivityTools` (line ~72) to include the new keys:

```javascript
    productivityTools: ['formatter', 'smartJobSwitcher', 'quickNotes', 'previewMode', 'freezeHeader', 'characterCounter', 'pdfMarkupTools', 'reverseThreadOrder', 'inspectForAi', 'tweakEngine'],
```

**Step 3: Inline-fallback update in content.js**

`content.js:171-179` has an inline-fallback `currentSettings` object used if `JTDefaults` failed to load. Add the same two keys there:

```javascript
      // Inline fallback if JTDefaults not loaded (should not happen)
      dragDrop: false, contrastFix: true, formatter: true, previewMode: false,
      darkMode: false, rgbTheme: false, smartJobSwitcher: true, budgetHierarchy: false,
      quickNotes: true, helpSidebarSupport: true, keyboardShortcuts: true, freezeHeader: false,
      characterCounter: false, kanbanTypeFilter: false, autoCollapseGroups: false, budgetTools: false,
      pdfMarkupTools: true, reverseThreadOrder: false, customFieldFilter: false,
      budgetChangelog: false, taskTypeFilter: false, availabilityFilter: false,
      jobAccessCollapse: false, orgLogo: false,
      inspectForAi: false, tweakEngine: true,
      themeColors: { primary: '#3B82F6', background: '#F3E8FF', text: '#1F1B29' },
      savedThemes: [null, null, null]
```

**Step 4: Verify hot-loading both features**

Reload extension. On a JT page:

```javascript
window.TweakEngineFeature.isActive()    // true (default-on)
window.InspectForAiFeature.isActive()   // false (default-off)
```

Open DevTools → Application → Storage → Extension → Local Storage. You should see the engine has run (no tweaks yet, but no errors). Console should show `JT-Tools: User Tweaks initialized`.

Now toggle inspect-for-ai on through chrome.storage to test hot-load:

```javascript
chrome.storage.sync.get(['jtToolsSettings'], r => {
  const s = { ...r.jtToolsSettings, inspectForAi: true };
  chrome.storage.sync.set({ jtToolsSettings: s });
});
```

A short delay later, console should log `JT-Tools: Enabling Inspect for AI` and `InspectForAi: Initializing...`. Confirm `window.InspectForAiFeature.isActive() === true`.

Toggle it back off:

```javascript
chrome.storage.sync.get(['jtToolsSettings'], r => {
  const s = { ...r.jtToolsSettings, inspectForAi: false };
  chrome.storage.sync.set({ jtToolsSettings: s });
});
```

Confirm cleanup logs and `isActive()` returns false.

**Step 5: Commit**

```bash
git add JT-Tools-Master/content.js JT-Tools-Master/utils/defaults.js
git commit -m "$(cat <<'EOF'
feat(tweaks): register inspect-for-ai + tweak-engine in registry

Both features wired into content.js featureModules and JTDefaults
DEFAULT_SETTINGS. Tweak engine defaults to ON (installed tweaks should
"just work"); inspector defaults to OFF (only authoring users need it).

Hot-toggle works via the existing settings-change message path — no
popup UI yet, but storage-driven toggling is verified.
EOF
)"
```

---

## Task 9: Tweak editor page (textarea + diagnostics)

**Files:**
- Create: `JT-Tools-Master/tweaks/edit.html`
- Create: `JT-Tools-Master/tweaks/edit.js`
- Create: `JT-Tools-Master/tweaks/edit.css`
- Modify: `JT-Tools-Master/manifest.json` (web_accessible_resources)

The editor is a chrome-extension://-hosted page opened in a tab. The popup links here. The page lets the user paste/edit a tweak's JSON, validates it live, shows a diagnostics panel, can dry-run on the active JT tab via message passing, and saves to `chrome.storage.local`.

**Step 1: HTML**

```html
<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<title>Edit Tweak — JT Power Tools</title>
<link rel="stylesheet" href="edit.css">
</head>
<body>
<header class="jt-tweak-edit-header">
  <h1 id="title">Edit Tweak</h1>
  <div class="jt-tweak-edit-actions">
    <button id="btn-test" class="jt-tweak-edit-btn">Test on active JT tab</button>
    <button id="btn-revert" class="jt-tweak-edit-btn jt-tweak-edit-btn-secondary">Revert</button>
    <button id="btn-save" class="jt-tweak-edit-btn jt-tweak-edit-btn-primary">Save</button>
  </div>
</header>
<main class="jt-tweak-edit-main">
  <section class="jt-tweak-edit-editor">
    <label for="json">Tweak JSON</label>
    <textarea id="json" spellcheck="false" placeholder='{
  "id": "...",
  "name": "...",
  "version": 1,
  "scope": { "jtOrg": "Your Org Name" },
  "css": ".gantt-bar { height: 6px !important; }",
  "actions": []
}'></textarea>
  </section>
  <aside class="jt-tweak-edit-diagnostics">
    <h2>Diagnostics</h2>
    <div id="status" class="jt-tweak-edit-status">Ready.</div>
    <h3>Validation</h3>
    <ul id="validation-errors" class="jt-tweak-edit-list"></ul>
    <h3>CSS warnings</h3>
    <ul id="css-warnings" class="jt-tweak-edit-list"></ul>
    <h3>Selector match counts (last test run)</h3>
    <ul id="match-counts" class="jt-tweak-edit-list"></ul>
  </aside>
</main>
<script src="../utils/browser-polyfill.js"></script>
<script src="../utils/sanitizer.js"></script>
<script src="../vendor/css-tree.js"></script>
<script src="../utils/css-sanitizer.js"></script>
<script src="../utils/tweak-validator.js"></script>
<script src="edit.js"></script>
</body>
</html>
```

**Step 2: CSS**

Per the project's dark-mode palette (`#2c2c2c`, `#252525`, etc., NOT blues):

```css
:root {
  --bg-primary: #2c2c2c;
  --bg-secondary: #252525;
  --bg-elevated: #333333;
  --bg-hover: #3a3a3a;
  --border-primary: #404040;
  --border-secondary: #505050;
  --text-primary: #e0e0e0;
  --text-secondary: #b0b0b0;
  --text-muted: #a0a0a0;
  --accent: #3B82F6;
  --error: #ff6b6b;
  --warn: #ffb84a;
}

* { box-sizing: border-box; }
html, body { margin: 0; padding: 0; height: 100%; }
body {
  background: var(--bg-primary);
  color: var(--text-primary);
  font: 14px/1.4 system-ui, -apple-system, sans-serif;
  display: flex;
  flex-direction: column;
}

.jt-tweak-edit-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 12px 20px;
  background: var(--bg-secondary);
  border-bottom: 1px solid var(--border-primary);
}
.jt-tweak-edit-header h1 { margin: 0; font-size: 16px; font-weight: 600; }
.jt-tweak-edit-actions { display: flex; gap: 8px; }

.jt-tweak-edit-btn {
  background: var(--bg-elevated);
  border: 1px solid var(--border-secondary);
  color: var(--text-secondary);
  padding: 6px 14px;
  border-radius: 4px;
  font: inherit;
  cursor: pointer;
}
.jt-tweak-edit-btn:hover { background: var(--bg-hover); }
.jt-tweak-edit-btn-primary { background: var(--accent); color: #fff; border-color: var(--accent); }
.jt-tweak-edit-btn-primary:hover { background: #2563eb; }
.jt-tweak-edit-btn-secondary { color: var(--text-muted); }

.jt-tweak-edit-main {
  display: flex;
  flex: 1;
  overflow: hidden;
}
.jt-tweak-edit-editor {
  flex: 1;
  display: flex;
  flex-direction: column;
  padding: 16px;
  border-right: 1px solid var(--border-primary);
}
.jt-tweak-edit-editor label { font-size: 12px; color: var(--text-muted); margin-bottom: 8px; text-transform: uppercase; letter-spacing: 0.5px; }
.jt-tweak-edit-editor textarea {
  flex: 1;
  background: var(--bg-secondary);
  border: 1px solid var(--border-primary);
  color: var(--text-primary);
  padding: 12px;
  border-radius: 4px;
  font: 13px/1.5 ui-monospace, "Cascadia Code", Consolas, monospace;
  resize: none;
  outline: none;
}
.jt-tweak-edit-editor textarea:focus { border-color: var(--accent); }

.jt-tweak-edit-diagnostics {
  width: 380px;
  padding: 16px;
  overflow-y: auto;
  background: var(--bg-secondary);
}
.jt-tweak-edit-diagnostics h2 { margin: 0 0 12px; font-size: 14px; font-weight: 600; }
.jt-tweak-edit-diagnostics h3 { margin: 16px 0 6px; font-size: 12px; font-weight: 600; color: var(--text-muted); text-transform: uppercase; letter-spacing: 0.5px; }
.jt-tweak-edit-status { padding: 8px 12px; background: var(--bg-elevated); border-radius: 4px; font-size: 13px; }
.jt-tweak-edit-status[data-state="error"] { color: var(--error); }
.jt-tweak-edit-status[data-state="warn"] { color: var(--warn); }
.jt-tweak-edit-status[data-state="ok"] { color: #6dd; }
.jt-tweak-edit-list { list-style: none; padding: 0; margin: 0; font-size: 12px; }
.jt-tweak-edit-list li { padding: 4px 0; border-bottom: 1px solid var(--border-primary); color: var(--text-secondary); }
.jt-tweak-edit-list li:last-child { border-bottom: none; }
.jt-tweak-edit-list li.error { color: var(--error); }
.jt-tweak-edit-list li.warn { color: var(--warn); }
```

**Step 3: JS**

```javascript
/**
 * Tweak editor page logic.
 *
 * Mode is determined by URL params:
 *   ?id=<uuid>   → edit existing tweak
 *   ?new=1       → create blank
 */
(function () {
  const params = new URLSearchParams(location.search);
  const tweakId = params.get('id');
  const isNew = params.get('new') === '1';

  const $json = document.getElementById('json');
  const $title = document.getElementById('title');
  const $status = document.getElementById('status');
  const $valErrors = document.getElementById('validation-errors');
  const $cssWarnings = document.getElementById('css-warnings');
  const $matchCounts = document.getElementById('match-counts');
  const $btnSave = document.getElementById('btn-save');
  const $btnTest = document.getElementById('btn-test');
  const $btnRevert = document.getElementById('btn-revert');

  let originalSnapshot = null;  // for revert

  init();

  async function init() {
    if (isNew) {
      $title.textContent = 'New Tweak';
      const blank = {
        id: crypto.randomUUID(),
        name: '',
        version: 1,
        scope: { jtOrg: '' },
        css: '',
        actions: []
      };
      $json.value = JSON.stringify(blank, null, 2);
      originalSnapshot = $json.value;
    } else if (tweakId) {
      const stored = await chrome.storage.local.get(['jtTweaks']);
      const list = Array.isArray(stored.jtTweaks) ? stored.jtTweaks : [];
      const tweak = list.find(t => t.id === tweakId);
      if (!tweak) {
        setStatus('Tweak not found', 'error');
        return;
      }
      $title.textContent = 'Edit: ' + (tweak.name || '(unnamed)');
      $json.value = JSON.stringify(tweak, null, 2);
      originalSnapshot = $json.value;
    } else {
      setStatus('No id or new flag in URL', 'error');
      return;
    }

    $json.addEventListener('input', debounce(validateAndRender, 300));
    $btnSave.addEventListener('click', save);
    $btnTest.addEventListener('click', testOnActiveTab);
    $btnRevert.addEventListener('click', revert);

    validateAndRender();
  }

  function validateAndRender() {
    let parsed;
    try {
      parsed = JSON.parse($json.value);
    } catch (err) {
      setStatus('Invalid JSON: ' + err.message, 'error');
      $valErrors.innerHTML = '';
      return null;
    }
    const v = window.TweakValidator.validate(parsed);
    $valErrors.innerHTML = '';
    if (!v.ok) {
      v.errors.forEach(e => {
        const li = document.createElement('li');
        li.className = 'error';
        li.textContent = (e.field ? e.field + ': ' : '') + e.reason;
        $valErrors.appendChild(li);
      });
      setStatus('Validation failed (' + v.errors.length + ' errors)', 'error');
      $btnSave.disabled = true;
      return null;
    }

    // CSS sanitization
    $cssWarnings.innerHTML = '';
    if (parsed.css && parsed.css.trim()) {
      const r = window.CssSanitizer.sanitize(parsed.css, { tweakId: parsed.id });
      const warnings = r.warnings || (r.ok === false ? r.errors : []);
      warnings.forEach(w => {
        const li = document.createElement('li');
        li.className = r.ok ? 'warn' : 'error';
        li.textContent = w.reason + (w.position ? ` (line ${w.position.line})` : '');
        $cssWarnings.appendChild(li);
      });
      if (!r.ok) {
        setStatus('CSS rejected — fix errors before saving', 'error');
        $btnSave.disabled = true;
        return null;
      }
    }

    setStatus('Ready to save.', 'ok');
    $btnSave.disabled = false;
    return parsed;
  }

  async function save() {
    const tweak = validateAndRender();
    if (!tweak) return;
    tweak.enabled = tweak.enabled !== false;  // default to enabled on first save

    const stored = await chrome.storage.local.get(['jtTweaks']);
    const list = Array.isArray(stored.jtTweaks) ? stored.jtTweaks : [];
    const idx = list.findIndex(t => t.id === tweak.id);
    if (idx >= 0) {
      list[idx] = tweak;
    } else {
      list.push(tweak);
    }
    await chrome.storage.local.set({ jtTweaks: list });
    originalSnapshot = $json.value;
    setStatus('Saved.', 'ok');
  }

  async function testOnActiveTab() {
    const tweak = validateAndRender();
    if (!tweak) return;
    // Find an active JT tab and message the engine to dry-run this tweak.
    const tabs = await chrome.tabs.query({ url: 'https://app.jobtread.com/*' });
    if (!tabs.length) {
      setStatus('No JT tab open — open app.jobtread.com and try again', 'warn');
      return;
    }
    // Pick the most recently active JT tab
    tabs.sort((a, b) => (b.lastAccessed || 0) - (a.lastAccessed || 0));
    const tab = tabs[0];
    try {
      const response = await chrome.tabs.sendMessage(tab.id, {
        type: 'TWEAK_DRY_RUN',
        tweak
      });
      if (response && response.matchCounts) {
        $matchCounts.innerHTML = '';
        Object.entries(response.matchCounts).forEach(([sel, n]) => {
          const li = document.createElement('li');
          li.className = n === 0 ? 'warn' : '';
          li.textContent = `${sel} → ${n} matches`;
          $matchCounts.appendChild(li);
        });
        setStatus('Dry-run complete on ' + tab.url, 'ok');
      } else {
        setStatus('Dry-run returned no diagnostics', 'warn');
      }
    } catch (err) {
      setStatus('Dry-run failed: ' + err.message, 'error');
    }
  }

  function revert() {
    if (originalSnapshot) {
      $json.value = originalSnapshot;
      validateAndRender();
      setStatus('Reverted to last save.', 'ok');
    }
  }

  function setStatus(msg, state = '') {
    $status.textContent = msg;
    $status.dataset.state = state;
  }

  function debounce(fn, ms) {
    let t = null;
    return function (...args) {
      if (t) clearTimeout(t);
      t = setTimeout(() => fn.apply(this, args), ms);
    };
  }
})();
```

**Step 4: Wire the dry-run message in tweak-engine**

In `JT-Tools-Master/features/tweak-engine/index.js`, add a chrome.runtime.onMessage listener inside `init()`:

```javascript
    // Listen for editor "Test on active tab" requests
    const msgHandler = (message, sender, sendResponse) => {
      if (message && message.type === 'TWEAK_DRY_RUN' && message.tweak) {
        try {
          const tweak = message.tweak;
          // Compute match counts per selector without persisting state
          const matchCounts = {};
          if (tweak.css) {
            // Crude: just verify CSS sanitizes
            const r = window.CssSanitizer.sanitize(tweak.css, { tweakId: tweak.id });
            matchCounts['(css)'] = r.ok ? 1 : 0;
          }
          if (Array.isArray(tweak.actions)) {
            for (const a of tweak.actions) {
              try {
                matchCounts[a.selector] = document.querySelectorAll(a.selector).length;
              } catch {
                matchCounts[a.selector] = 0;
              }
            }
          }
          sendResponse({ matchCounts });
        } catch (err) {
          sendResponse({ error: err.message });
        }
        return true; // async response
      }
      return false;
    };
    chrome.runtime.onMessage.addListener(msgHandler);
    eventListeners.push({ target: chrome.runtime.onMessage, event: 'message', handler: msgHandler, isChromeListener: true });
```

**Step 5: Update manifest web_accessible_resources**

In `manifest.json`, append to the `resources` array inside `web_accessible_resources`:

```json
"tweaks/edit.html",
"tweaks/edit.js",
"tweaks/edit.css",
"vendor/finder.js",
"vendor/css-tree.js"
```

**Step 6: Verify**

Reload extension. In a new tab: `chrome-extension://<extension-id>/tweaks/edit.html?new=1`

You'll need the extension's actual ID — find it at chrome://extensions on the loaded extension card.

Expected:
- Dark editor opens with a blank-tweak template pre-populated
- Type garbage JSON → validation errors appear in the right rail
- Type a valid tweak → status turns green ("Ready to save")
- Click Save → status says "Saved." Open chrome://extensions → Inspect views → service worker → console → run `chrome.storage.local.get(['jtTweaks'], r => console.log(r))` and confirm the tweak is there.
- With a JT tab open in another window, click "Test on active JT tab" → match counts populate

**Step 7: Commit**

```bash
git add JT-Tools-Master/tweaks/ JT-Tools-Master/manifest.json JT-Tools-Master/features/tweak-engine/index.js
git commit -m "$(cat <<'EOF'
feat(tweaks): add tweak editor page

chrome-extension://<id>/tweaks/edit.html?new=1 (blank) or ?id=<uuid>
(edit existing). Textarea + live diagnostics: validation errors, CSS
sanitization warnings, selector match counts from dry-run on the active
JT tab. Saves to chrome.storage.local; tweak-engine hot-reloads from the
storage-change listener.

Editor uses the project's dark-mode neutral grey palette (no blues).
EOF
)"
```

---

## Task 10: Popup Tweaks section

**Files:**
- Modify: `JT-Tools-Master/popup/popup.html` (add a new section)
- Modify: `JT-Tools-Master/popup/popup.js` (load + render + actions)
- Modify: `JT-Tools-Master/popup/popup.css` (styling for the new section)

**Step 1: HTML section**

In `popup/popup.html`, find the section that lists features (look for `<div class="feature-list">` or similar — read lines around the existing feature toggles). Add a new section above or below it:

```html
<section class="jt-tweaks-section" data-tweaks-section>
  <div class="jt-tweaks-header">
    <h2>Tweaks <span class="jt-tweaks-org" data-tweaks-org>(no org)</span></h2>
    <button class="jt-tweaks-action" data-action="import">Import</button>
    <button class="jt-tweaks-action" data-action="new">New</button>
  </div>
  <ul class="jt-tweaks-list" data-tweaks-list>
    <!-- rendered by popup.js -->
  </ul>
  <div class="jt-tweaks-empty" data-tweaks-empty hidden>
    No tweaks for this org yet. Ask your AI to write one — paste the result with Import.
  </div>
</section>

<dialog class="jt-tweaks-import-dialog" data-import-dialog>
  <h3>Import Tweak</h3>
  <p>Paste a tweak JSON object below. It'll be validated before installing.</p>
  <textarea data-import-json rows="14" spellcheck="false" placeholder='{ "id": "...", "name": "...", ... }'></textarea>
  <div data-import-preview class="jt-tweaks-import-preview"></div>
  <div class="jt-tweaks-import-actions">
    <button data-action="cancel">Cancel</button>
    <button data-action="install" disabled>Install</button>
  </div>
</dialog>
```

**Step 2: CSS**

Append to `popup/popup.css` (use the project's dark-mode palette):

```css
/* User Tweaks — Popup Section */
.jt-tweaks-section {
  border-top: 1px solid #404040;
  padding: 12px 16px;
  margin-top: 12px;
}
.jt-tweaks-header {
  display: flex;
  align-items: baseline;
  gap: 8px;
  margin-bottom: 8px;
}
.jt-tweaks-header h2 {
  margin: 0;
  font-size: 14px;
  font-weight: 600;
  flex: 1;
}
.jt-tweaks-org {
  font-size: 11px;
  color: #a0a0a0;
  font-weight: normal;
}
.jt-tweaks-action {
  background: #333333;
  border: 1px solid #505050;
  color: #b0b0b0;
  padding: 4px 10px;
  font-size: 12px;
  border-radius: 3px;
  cursor: pointer;
}
.jt-tweaks-action:hover { background: #3a3a3a; }
.jt-tweaks-list { list-style: none; padding: 0; margin: 0; }
.jt-tweaks-list li {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 0;
  border-bottom: 1px solid #404040;
  font-size: 13px;
}
.jt-tweaks-list li:last-child { border-bottom: none; }
.jt-tweaks-list .name { flex: 1; color: #e0e0e0; }
.jt-tweaks-list .warn { color: #ffb84a; font-size: 11px; }
.jt-tweaks-list button { background: transparent; border: none; color: #b0b0b0; cursor: pointer; padding: 2px 6px; font-size: 12px; }
.jt-tweaks-list button:hover { color: #e0e0e0; }
.jt-tweaks-empty { padding: 12px; color: #a0a0a0; font-size: 12px; font-style: italic; }
.jt-tweaks-import-dialog {
  background: #2c2c2c;
  border: 1px solid #404040;
  color: #e0e0e0;
  padding: 16px;
  border-radius: 6px;
  width: 480px;
  max-width: 90vw;
}
.jt-tweaks-import-dialog::backdrop { background: rgba(0,0,0,0.5); }
.jt-tweaks-import-dialog h3 { margin: 0 0 8px; }
.jt-tweaks-import-dialog textarea {
  width: 100%;
  background: #252525;
  border: 1px solid #404040;
  color: #e0e0e0;
  padding: 8px;
  font: 12px ui-monospace, monospace;
  border-radius: 3px;
  resize: vertical;
}
.jt-tweaks-import-preview { margin-top: 8px; font-size: 12px; min-height: 40px; }
.jt-tweaks-import-preview .ok { color: #6dd; }
.jt-tweaks-import-preview .err { color: #ff6b6b; }
.jt-tweaks-import-actions { display: flex; justify-content: flex-end; gap: 8px; margin-top: 12px; }
.jt-tweaks-import-actions button {
  background: #333333;
  border: 1px solid #505050;
  color: #b0b0b0;
  padding: 6px 14px;
  border-radius: 3px;
  cursor: pointer;
}
.jt-tweaks-import-actions button[data-action="install"] { background: #3B82F6; color: #fff; border-color: #3B82F6; }
.jt-tweaks-import-actions button:disabled { opacity: 0.5; cursor: not-allowed; }
```

**Step 3: JS**

In `popup/popup.js`, add a new initialization block at the end of the existing init flow (search for the existing DOMContentLoaded handler and add this after the existing setup, OR add a standalone module-style block guarded by document-readystate):

```javascript
// === User Tweaks section ===
(function initTweaksSection() {
  const $section = document.querySelector('[data-tweaks-section]');
  if (!$section) return;
  const $list = $section.querySelector('[data-tweaks-list]');
  const $empty = $section.querySelector('[data-tweaks-empty]');
  const $orgLabel = $section.querySelector('[data-tweaks-org]');
  const $importBtn = $section.querySelector('[data-action="import"]');
  const $newBtn = $section.querySelector('[data-action="new"]');
  const $dialog = document.querySelector('[data-import-dialog]');
  const $importJson = $dialog.querySelector('[data-import-json]');
  const $importPreview = $dialog.querySelector('[data-import-preview]');
  const $cancelBtn = $dialog.querySelector('[data-action="cancel"]');
  const $installBtn = $dialog.querySelector('[data-action="install"]');

  let activeOrg = null;

  // Get the active org from the current JT tab via content-script messaging
  chrome.tabs.query({ active: true, currentWindow: true }, async (tabs) => {
    const tab = tabs[0];
    if (tab && tab.url && tab.url.startsWith('https://app.jobtread.com/')) {
      try {
        const result = await chrome.scripting.executeScript({
          target: { tabId: tab.id },
          func: () => window.OrgDetector ? window.OrgDetector.getActiveOrg() : null
        });
        activeOrg = result[0] && result[0].result;
      } catch {}
    }
    $orgLabel.textContent = activeOrg ? '(' + activeOrg + ')' : '(no JT tab)';
    render();
  });

  async function render() {
    const stored = await chrome.storage.local.get(['jtTweaks', 'jtTweakDiagnostics']);
    const all = Array.isArray(stored.jtTweaks) ? stored.jtTweaks : [];
    const diag = stored.jtTweakDiagnostics || {};
    const visible = activeOrg ? all.filter(t => t.scope && t.scope.jtOrg === activeOrg) : all;

    $list.innerHTML = '';
    if (!visible.length) {
      $empty.hidden = false;
      return;
    }
    $empty.hidden = true;
    for (const tweak of visible) {
      const d = diag[tweak.id] || {};
      const li = document.createElement('li');
      const name = document.createElement('span');
      name.className = 'name';
      name.textContent = tweak.name || '(unnamed)';
      li.appendChild(name);
      if (d.lastError) {
        const w = document.createElement('span');
        w.className = 'warn';
        w.title = d.lastError;
        w.textContent = '⚠ error';
        li.appendChild(w);
      } else if (d.lastMatchCount === 0) {
        const w = document.createElement('span');
        w.className = 'warn';
        w.title = 'Selectors matched 0 elements last run';
        w.textContent = '⚠ no matches';
        li.appendChild(w);
      }
      const toggle = document.createElement('input');
      toggle.type = 'checkbox';
      toggle.checked = tweak.enabled !== false;
      toggle.addEventListener('change', () => toggleTweak(tweak.id, toggle.checked));
      li.appendChild(toggle);
      const editBtn = document.createElement('button');
      editBtn.textContent = 'Edit';
      editBtn.addEventListener('click', () => openEditor(tweak.id));
      li.appendChild(editBtn);
      const delBtn = document.createElement('button');
      delBtn.textContent = 'Delete';
      delBtn.addEventListener('click', () => deleteTweak(tweak.id, tweak.name));
      li.appendChild(delBtn);
      $list.appendChild(li);
    }
  }

  async function toggleTweak(id, enabled) {
    const stored = await chrome.storage.local.get(['jtTweaks']);
    const list = Array.isArray(stored.jtTweaks) ? stored.jtTweaks : [];
    const idx = list.findIndex(t => t.id === id);
    if (idx >= 0) {
      list[idx].enabled = enabled;
      await chrome.storage.local.set({ jtTweaks: list });
    }
  }

  async function deleteTweak(id, name) {
    if (!confirm('Delete tweak "' + (name || '(unnamed)') + '"?')) return;
    const stored = await chrome.storage.local.get(['jtTweaks']);
    const list = (stored.jtTweaks || []).filter(t => t.id !== id);
    await chrome.storage.local.set({ jtTweaks: list });
    render();
  }

  function openEditor(id) {
    const url = chrome.runtime.getURL('tweaks/edit.html') + (id ? '?id=' + id : '?new=1');
    chrome.tabs.create({ url });
  }

  $importBtn.addEventListener('click', () => {
    $importJson.value = '';
    $importPreview.textContent = '';
    $installBtn.disabled = true;
    $dialog.showModal();
  });
  $newBtn.addEventListener('click', () => openEditor(null));
  $cancelBtn.addEventListener('click', () => $dialog.close());
  $importJson.addEventListener('input', () => previewImport());
  $installBtn.addEventListener('click', () => doInstall());

  function previewImport() {
    let parsed;
    try {
      parsed = JSON.parse($importJson.value);
    } catch (err) {
      $importPreview.innerHTML = '<span class="err">Invalid JSON: ' + err.message + '</span>';
      $installBtn.disabled = true;
      return;
    }
    // Generate a fresh id if missing or imported
    if (!parsed.id) parsed.id = crypto.randomUUID();
    const v = window.TweakValidator ? window.TweakValidator.validate(parsed) : null;
    if (v && !v.ok) {
      $importPreview.innerHTML = '<span class="err">Validation: ' + v.errors.map(e => (e.field ? e.field + ': ' : '') + e.reason).join('; ') + '</span>';
      $installBtn.disabled = true;
      return;
    }
    // Preview action match counts on the active JT tab
    chrome.tabs.query({ url: 'https://app.jobtread.com/*' }, async (tabs) => {
      if (!tabs.length) {
        $importPreview.innerHTML = '<span class="ok">Looks valid. No JT tab open to preview match counts.</span>';
        $installBtn.disabled = false;
        return;
      }
      try {
        const resp = await chrome.tabs.sendMessage(tabs[0].id, { type: 'TWEAK_DRY_RUN', tweak: parsed });
        const counts = resp && resp.matchCounts ? Object.entries(resp.matchCounts) : [];
        const lines = counts.map(([sel, n]) => `<div>${sel} → ${n} matches</div>`).join('');
        $importPreview.innerHTML = '<span class="ok">Looks valid.</span>' + lines;
        $installBtn.disabled = false;
      } catch {
        $importPreview.innerHTML = '<span class="ok">Looks valid (could not preview matches).</span>';
        $installBtn.disabled = false;
      }
    });
  }

  async function doInstall() {
    const parsed = JSON.parse($importJson.value);
    if (!parsed.id) parsed.id = crypto.randomUUID();
    parsed.enabled = parsed.enabled !== false;
    const stored = await chrome.storage.local.get(['jtTweaks']);
    const list = Array.isArray(stored.jtTweaks) ? stored.jtTweaks : [];
    const idx = list.findIndex(t => t.id === parsed.id);
    if (idx >= 0) list[idx] = parsed; else list.push(parsed);
    await chrome.storage.local.set({ jtTweaks: list });
    $dialog.close();
    render();
  }
})();
```

**Step 4: Verify end-to-end UX flow**

Reload extension. Open the popup on a JT tab. Expected:
- New "Tweaks" section appears (below or above existing toggles, depending on placement)
- Org name shown next to the heading
- "Import" and "New" buttons visible
- Empty state message if no tweaks

Click "New" → editor opens in a new tab with a blank tweak. Save it. Close the tab.
Reopen popup → the saved tweak is listed.
Click "Edit" → editor opens with that tweak's JSON.
Click the toggle → tweak enabled/disabled.
Click "Delete" → confirm → tweak gone.

Click "Import" → dialog opens. Paste:

```json
{
  "name": "Outline Test",
  "version": 1,
  "scope": { "jtOrg": "<paste your active org name here>" },
  "css": ".gantt-bar { outline: 2px solid magenta }"
}
```

Expected: preview area shows "Looks valid" plus match counts. Install button enables. Click Install → tweak appears in the list and (if you're on the schedule view) Gantt bars get magenta outlines.

**Step 5: Commit**

```bash
git add JT-Tools-Master/popup/popup.html JT-Tools-Master/popup/popup.js JT-Tools-Master/popup/popup.css
git commit -m "$(cat <<'EOF'
feat(tweaks): add Tweaks section to popup

Lists tweaks scoped to the active JT org with on/off toggle, edit,
and delete actions. ⚠ badges surface tweaks with errors or zero-match
selectors. Import dialog accepts pasted tweak JSON, validates, previews
selector match counts on the active tab, then installs to local storage.
"New" opens the standalone editor page.
EOF
)"
```

---

## Task 11: extension-test MCP smoke pass (optional automated verification)

**Files:**
- None (test artifacts only)

**Step 1: Use the extension-test MCP to load the unpacked extension**

The MCP tool `mcp__extension-test__load_extension` opens a fresh Chrome profile with the extension loaded. The `extension-test` server is in the deferred tools list — call `ToolSearch` with `select:mcp__extension-test__load_extension,mcp__extension-test__navigate,mcp__extension-test__evaluate,mcp__extension-test__get_console_logs,mcp__extension-test__close_browser` to load schemas first.

Run a sequence of automated assertions against the loaded extension:

1. Load the extension from the worktree's `JT-Tools-Master/` path.
2. Navigate to `https://app.jobtread.com` (note: this requires login state in the test profile; if the test profile is fresh, skip this task and rely on manual verification — automated end-to-end on JT requires an authenticated session). Navigate to a static page with the right MV3 surface instead, e.g. `chrome://extensions` to verify the extension loaded.
3. Eval against a JT page (in a real session) to confirm:
   - `typeof window.TweakEngineFeature === 'object'`
   - `typeof window.InspectForAiFeature === 'object'`
   - `typeof window.CssSanitizer === 'object'`
   - `typeof window.TweakValidator === 'object'`
   - `typeof window.JTFinder === 'function'`
   - `typeof window.csstree === 'object'`
4. Get the console logs and assert no `error`-level messages with text containing `TweakEngine` or `InspectForAi`.

**If the test profile cannot reach JT (auth required), skip this task** — it's optional. The manual verifications in Tasks 4-10 cover the same ground.

**Step 2: Don't commit any test artifacts**

Tasks 1-10 already have manual smoke tests embedded. This step is a belt-and-suspenders sanity check, not a permanent test asset.

---

## Task 12: CHANGELOG + version bump + final smoke

**Files:**
- Modify: `CHANGELOG.md` (root)
- Modify: `JT-Tools-Master/manifest.json` (version)

**Step 1: CHANGELOG**

Open `CHANGELOG.md` at the repo root. Find the `## [Unreleased]` section (create one above the most-recent-version section if it doesn't exist). Add:

```markdown
## [Unreleased]

### Added

#### User Tweaks V1 (Free)
- Added "Inspect for AI" feature: alt-click any element on JobTread to copy a markdown DOM context block to clipboard, suitable for pasting into any AI chat to author a working tweak. Off by default.
- Added "User Tweaks" engine: applies declarative tweaks (CSS + a closed list of DOM verbs — addClass, removeClass, setStyle, hide, show, setText) scoped by JobTread organization name and URL pathname. On by default; tweaks toggled individually in the popup. Imports/exports as JSON.
- Added in-popup Tweaks section: per-org list with on/off toggles, ⚠ badges for tweaks with errors or zero-match selectors, Import (paste JSON) and New (open editor) actions.
- Added Tweaks editor page (chrome-extension://<id>/tweaks/edit.html): textarea editor with live validation, CSS sanitization warnings, and "Test on active JT tab" dry-run that reports per-selector match counts before saving.

### Security
- Added css-tree-AST-based CSS sanitizer for User Tweaks: rejects @import/@charset/@namespace at-rules, expression() / behavior:, url() with non-https/data schemes, and bare html/body/:root/* selectors. Auto-wraps every tweak's selectors in a `.jt-tweak-{id}` scope to prevent style bleed.
- Added DSL validator for User Tweaks: rejects unknown action verbs (insertHTML, insertElement, etc. are explicitly not in the V1 allowlist), validates UUIDs, blocks selectors that target extension UI prefixes.
- Added clipboardWrite permission for the Inspect-for-AI feature (writes only — no clipboardRead).
```

**Step 2: Version bump**

In `JT-Tools-Master/manifest.json`, bump the version. Current is `4.5.5` — bump to `4.6.0` (minor version for a feature add).

**Step 3: Final smoke (10 minutes)**

Reload the unpacked extension. On `app.jobtread.com`:

1. Open popup → Tweaks section visible, org name shown ✓
2. Toggle Inspect-for-AI on in popup feature toggles → confirm console logs init message
3. Alt+click a Gantt bar → toast appears, paste-buffer has the markdown ✓
4. Open editor (Tweaks → New) → save a CSS-only tweak (e.g. `.gantt-bar { outline: 2px solid lime }`) ✓
5. Reload JT page → outlines applied ✓
6. Switch to another JT org via the org switcher → outlines disappear (org scope filter) ✓
7. Switch back → outlines re-appear ✓
8. Toggle the tweak off via popup → outlines disappear without page reload ✓
9. Toggle on, refresh page, then disable User Tweaks engine entirely in popup → outlines disappear ✓ (cleanup works)
10. Re-enable engine → outlines reappear ✓

If any of these fail, debug before committing. Don't ship a half-working feature.

**Step 4: Commit + push**

```bash
git add CHANGELOG.md JT-Tools-Master/manifest.json
git commit -m "$(cat <<'EOF'
chore: bump to 4.6.0 + CHANGELOG for User Tweaks V1

Phase 1 of User Tweaks ships: alt-click DOM inspector, declarative
tweak DSL, css-tree sanitizer, popup management UI, standalone editor.
Extension-only, local storage. Phase 2 (MCP storage layer) and Phase 3
(AI MCP write surface) are future work documented in the design doc.
EOF
)"
git push -u origin claude/tweaks-v1-extension
```

After push, the implementation is on the feature branch ready for PR review. Use the `superpowers:finishing-a-development-branch` skill (or open PR manually) once the user has reviewed.

---

## What is NOT in this plan (intentionally)

- **No PR creation step.** The user's git workflow rule says "Update CHANGELOG.md, check for console errors" — the user opens the PR. Don't auto-`gh pr create`.
- **No removal of `.claude/worktrees/` from gitignore.** Out of scope.
- **No npm/test framework introduction.** The project doesn't have one; introducing one is a separate decision.
- **No `chrome.userScripts` integration** (would let users author arbitrary JS). Considered and rejected for V1 in the design doc — requires Chrome dev-mode flag, hostile UX.
- **No D1 schema, no MCP tools, no server endpoints.** That's Phase 2 / Phase 3.

## Reference: file inventory after this plan lands

```
JT-Tools-Master/vendor/finder.js            (~3KB, vendored MIT)
JT-Tools-Master/vendor/css-tree.js          (~150KB, vendored MIT)
JT-Tools-Master/vendor/README.md
JT-Tools-Master/utils/css-sanitizer.js
JT-Tools-Master/utils/tweak-validator.js
JT-Tools-Master/features/inspect-for-ai.js
JT-Tools-Master/features/tweak-engine/index.js
JT-Tools-Master/tweaks/edit.html
JT-Tools-Master/tweaks/edit.js
JT-Tools-Master/tweaks/edit.css
```

Modified:
```
JT-Tools-Master/manifest.json    (permissions, content_scripts, web_accessible_resources, version)
JT-Tools-Master/content.js       (featureModules, inline-fallback defaults)
JT-Tools-Master/utils/defaults.js (DEFAULT_SETTINGS, FEATURE_CATEGORIES)
JT-Tools-Master/popup/popup.html (Tweaks section + import dialog)
JT-Tools-Master/popup/popup.js   (init block + render/import/edit/delete logic)
JT-Tools-Master/popup/popup.css  (Tweaks section styles)
CHANGELOG.md                      (Unreleased entries)
```

Total LOC estimate: ~1,400 lines new code + ~150 lines modified.

---

End of plan. The receiving session should execute Tasks 1-12 in order. Each task ends with a commit; do not skip commits to "save them up" — the smaller commits are the rollback boundary if something goes wrong.
