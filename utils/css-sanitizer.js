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
  // At-rules whose body contains nested Rules whose preludes are real
  // selectors (need scoping). @keyframes is intentionally excluded — its
  // rule preludes are frame selectors (0%, from, to) which must stay raw.
  const SCOPE_NESTED_AT_RULES = new Set(['media', 'supports', 'page']);

  // Walk the AST and scope only top-level Rule preludes. Recurses into
  // @media/@supports/@page (which contain real nested rules) but skips
  // @keyframes (frame selectors are not real selectors). Nested selectors
  // inside :not()/:is()/:has()/:where() are NOT visited because we walk
  // SelectorList → top-level Selector children only, never descending
  // into pseudo-class argument lists.
  function walkRules(container, scopeClass, errors) {
    if (!container || !container.children || typeof container.children.forEach !== 'function') {
      return;
    }
    container.children.forEach((node) => {
      if (node.type === 'Rule') {
        scopeSelectorList(node.prelude, scopeClass, errors);
      } else if (node.type === 'Atrule') {
        const name = (node.name || '').toLowerCase();
        if (SCOPE_NESTED_AT_RULES.has(name) && node.block) {
          // Recurse: nested rules inside @media etc. need scoping
          walkRules(node.block, scopeClass, errors);
        }
        // @keyframes: leave its block untouched — frame selectors stay raw
        // @font-face / @page: no nested rules to scope
      }
    });
  }

  // Scope every top-level Selector in a SelectorList. Does NOT recurse
  // into the Selector's children — pseudo-class arg lists like :not(.x)
  // contain their own SelectorList but those nested selectors must
  // remain in their original form for matching to work correctly.
  function scopeSelectorList(selectorList, scopeClass, errors) {
    if (!selectorList || selectorList.type !== 'SelectorList' || !selectorList.children) {
      return;
    }
    selectorList.children.forEach((selector) => {
      if (selector.type !== 'Selector') return;
      scopeSelector(selector, scopeClass, errors);
    });
  }

  // Apply blocklist + auto-scope to a single Selector node.
  function scopeSelector(node, scopeClass, errors) {
    // Strip any pre-existing `.jt-tweak-{id} ` scope prefixes first.
    // Makes the sanitizer idempotent — saving / updating / reverting
    // already-scoped CSS no longer double-scopes selectors. Also lets a
    // tweak cloned under a fresh id re-scope cleanly to its new id
    // instead of carrying the old one forward.
    stripLeadingScopePrefixes(node);

    const selectorText = csstree.generate(node).trim();

    // Reject extension UI prefixes
    if (EXTENSION_UI_PREFIXES.some(p => selectorText.includes(p))) {
      errors.push({ reason: 'selector targets extension UI: ' + selectorText, position: node.loc?.start });
      const noMatch = csstree.parse('.jt-tweak-rejected', { context: 'selector' });
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

    // Auto-scope: prepend `.jt-tweak-{id} ` to the selector by parsing
    // the scope class as a fresh selector AST and appending the original
    // selector's children after a descendant Combinator.
    const newChildren = csstree.parse(scopeClass, { context: 'selector' }).children;
    newChildren.appendData({ type: 'Combinator', name: ' ' });
    node.children.forEach(child => newChildren.appendData(child));
    node.children = newChildren;
  }

  // Strip any leading `.jt-tweak-{anyId} ` (descendant combinator)
  // prefixes from a Selector's children. Loops so doubly/triply-scoped
  // input collapses to its bare form. Conservative — only strips when
  // the class is followed by a descendant combinator AND further content
  // (so a lone `.jt-tweak-x` selector isn't reduced to empty), and
  // explicitly skips `.jt-tweak-edit-*` so the EXTENSION_UI_PREFIXES
  // rejection still fires on hostile input.
  function stripLeadingScopePrefixes(node) {
    if (!node.children || !node.children.head) return;
    while (node.children.head) {
      const firstItem = node.children.head;
      const firstNode = firstItem.data;
      if (!firstNode || firstNode.type !== 'ClassSelector') break;
      const name = firstNode.name;
      if (typeof name !== 'string') break;
      if (!name.startsWith('jt-tweak-')) break;
      if (name.startsWith('jt-tweak-edit-')) break;
      const secondItem = firstItem.next;
      if (!secondItem) break;
      const secondNode = secondItem.data;
      if (!secondNode || secondNode.type !== 'Combinator' || secondNode.name !== ' ') break;
      if (!secondItem.next) break;
      node.children.remove(firstItem);
      node.children.remove(secondItem);
    }
  }

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

    // Pass 1: walk the tree for at-rule rejection, declaration property
    // rejection, expression(), Url, and Raw value handling. These checks
    // operate on individual nodes and do not have the same parent-aware
    // requirement as Selector scoping (which needs Pass 2).
    csstree.walk(ast, {
      enter(node, item, list) {
        // Reject dangerous at-rules
        if (node.type === 'Atrule') {
          const name = (node.name || '').toLowerCase();
          if (REJECTED_AT_RULES.has(name)) {
            errors.push({ reason: 'at-rule @' + name + ' is not allowed', position: node.loc?.start });
            if (list) list.remove(item);
            return;
          }
          if (!ALLOWED_AT_RULES.has(name)) {
            errors.push({ reason: 'at-rule @' + name + ' is not on the allowlist', position: node.loc?.start });
            if (list) list.remove(item);
            return;
          }
        }

        // Reject dangerous declaration properties
        if (node.type === 'Declaration') {
          const propName = (node.property || '').toLowerCase();
          if (propName === 'behavior' || propName === '-moz-binding') {
            errors.push({ reason: 'property `' + propName + '` is not allowed', position: node.loc?.start });
            if (list) list.remove(item);
            return;
          }
        }

        // expression() — IE legacy code execution
        if (node.type === 'Function' && (node.name || '').toLowerCase() === 'expression') {
          errors.push({ reason: 'expression() is not allowed', position: node.loc?.start });
          node.children = csstree.List ? new csstree.List() : { head: null, tail: null };
          return;
        }

        // url() — only https:// or data:image/ permitted
        if (node.type === 'Url') {
          const value = (node.value || '').replace(/^['"]|['"]$/g, '').trim();
          const ok = /^https:\/\//i.test(value) || /^data:image\//i.test(value);
          if (!ok) {
            errors.push({ reason: 'url() must be https:// or data:image/, got: ' + value.slice(0, 80), position: node.loc?.start });
            node.value = '';
          }
        }

        // Raw nodes: css-tree falls back to Raw when it can't tokenize
        // cleanly (e.g., url(javascript:alert(1)) — unquoted with inner
        // parens). Without this, dangerous URLs slip through. If we detect
        // any unsafe url() in the raw value, blank the whole value — the
        // declaration becomes invalid CSS that browsers drop. Cleaner than
        // splicing the regex match out (which would leave stray parens).
        if (node.type === 'Raw' && typeof node.value === 'string') {
          const urlMatches = node.value.match(/url\s*\(\s*([^)]*)\s*\)/gi);
          if (urlMatches) {
            for (const match of urlMatches) {
              const inner = match.replace(/^url\s*\(\s*['"]?|['"]?\s*\)$/gi, '').trim();
              const safe = /^https:\/\//i.test(inner) || /^data:image\//i.test(inner);
              if (!safe) {
                errors.push({
                  reason: 'url() in raw value must be https:// or data:image/, got: ' + inner.slice(0, 80),
                  position: node.loc?.start
                });
                node.value = '';
                break;
              }
            }
          }
        }
      }
    });

    // Pass 2: parent-aware Selector scoping. We walk Rule nodes manually
    // so we know exactly when a Selector is a top-level rule prelude
    // (which we scope) versus nested inside :not()/:is()/:has()/:where()
    // (which we leave alone), versus inside @keyframes (frame selectors
    // like 0%, from, to — which must not be scoped).
    walkRules(ast, scopeClass, errors);

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
