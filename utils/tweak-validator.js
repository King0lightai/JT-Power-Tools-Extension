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
 * Actions (V1.7 closed list):
 *   { type: 'addClass',     selector: string, class: string }
 *   { type: 'removeClass',  selector: string, class: string }
 *   { type: 'setStyle',     selector: string, style: { [prop]: value } }
 *   { type: 'hide',         selector: string }
 *   { type: 'show',         selector: string }
 *   { type: 'setText',      selector: string, text: string }
 *   { type: 'onEvent',      selector: string, event: 'click'|'dblclick'|'mousedown'|'dragstart',
 *                           preventDefault?: boolean, stopPropagation?: boolean,
 *                           alert?: { title?: string, body: string, confirmLabel?: string },
 *                           then?: Array<Action>  // V1.7: chained DOM-mutation actions
 *   }
 *   { type: 'moveBefore',   selector: string, referenceSelector: string }
 *   { type: 'moveAfter',    selector: string, referenceSelector: string }
 *   { type: 'sortChildren', selector: string, childSelector?: string, keySelector?: string,
 *                           key?: 'text'|'number'|'date', direction?: 'asc'|'desc' }
 *
 * Every action also accepts an optional `match: string` (≤200 chars). When
 * set, the engine only fires the action on elements whose textContent
 * contains the substring — a per-element guard for over-broad selectors.
 *
 * Every action also accepts an optional date guard:
 *   matchDate?: { min?: integer, max?: integer, attr?: string, selector?: string }
 * It gates the action on how many whole calendar days the element's date
 * attribute (default "datetime", optionally read from a descendant via
 * `selector`) is from today — min/max are inclusive day offsets (0 = today,
 * -1 = yesterday, 2 = in two days; at least one bound required). Pairs with
 * addClass to shade rows by due date (overdue / today / tomorrow / 2+ out).
 *
 * Refused: insertHTML, insertElement, removeElement, eval-style verbs.
 * onEvent requires at least one side effect (preventDefault, stopPropagation, alert, or then[]).
 * Nested onEvent is forbidden inside `then` — chains are pure DOM-mutation only.
 * Move/sort verbs are not undone on tweak disable — same model as setText/addClass;
 * a page reload restores original DOM order.
 *
 * Selectors are checked for the same extension-UI blocklist as the CSS
 * sanitizer. setStyle values pass through Sanitizer.sanitizeCSSValue and
 * an explicit dangerous-pattern blocklist (defense-in-depth).
 *
 * Returns: { ok: true } or { ok: false, errors: [{ field, reason }, ...] }
 */
const TweakValidator = (() => {
  const ALLOWED_VERBS = new Set(['addClass', 'removeClass', 'setStyle', 'hide', 'show', 'setText', 'onEvent', 'confirmBeforeAction', 'moveBefore', 'moveAfter', 'sortChildren']);
  const ALLOWED_EVENTS = new Set(['click', 'dblclick', 'mousedown', 'dragstart']);
  // confirmBeforeAction gates these events behind a confirm() before React's
  // handler runs. Restricted to events that gate cleanly — where the value /
  // state hasn't already mutated by the time the event dispatches (so e.g.
  // 'change' is excluded: the input has already changed before it fires).
  const ALLOWED_CONFIRM_EVENTS = new Set(['click', 'dblclick', 'submit']);
  const ALLOWED_SORT_KEYS = new Set(['text', 'number', 'date']);
  const ALLOWED_SORT_DIRECTIONS = new Set(['asc', 'desc']);
  const EXTENSION_UI_PREFIXES = ['.jt-tools-', '.jt-popup-', '.jt-tweak-edit-'];
  const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

  // Mirrors the CSS sanitizer's FORBIDDEN_BARE_SELECTORS. The CSS path
  // auto-scopes selectors and rejects bare page-wide selectors, but the
  // action path (hide/setText/setStyle) runs raw querySelectorAll against
  // the whole document, so it needs the same guard.
  const FORBIDDEN_BARE_SELECTORS = new Set(['html', 'body', ':root', '*']);

  // Defense-in-depth: explicit blocklist for setStyle values. These should
  // never appear in an action-set inline style; complex backgrounds/animations
  // belong in the css field where the sanitizer can parse them properly.
  const DANGEROUS_VALUE_RE = /expression\s*\(|url\s*\(|behavior\s*:|@import|javascript:|<\/?script|@charset/i;

  const MAX_ACTIONS = 100;
  const MAX_THEN_STEPS = 20;
  const MAX_NAME_LEN = 80;
  const MAX_DESC_LEN = 500;
  const MAX_TEXT_LEN = 500;
  const MAX_SELECTOR_LEN = 500;
  const MAX_MATCH_LEN = 200;

  // Conservative selector charset for non-DOM environments. Real CSS
  // selectors are far more permissive, but in a service-worker / Node
  // context (no `document.createDocumentFragment`) we can't ask the
  // browser to parse, so we apply a strict syntactic gate covering the
  // common combinators / pseudo-classes / attribute selectors / nesting
  // characters and reject anything outside it. This prevents the
  // historical fall-open behavior where any string passed.
  const SAFE_SELECTOR_CHARSET = /^[a-zA-Z0-9\s\-_#.>+~*:()[\]="',\\^$|@/]+$/;

  // Reject bare/universal/combinator-only selectors that would match the
  // whole page (body, *, :root, "* > *", " * "). Applied before both the
  // DOM-parse and charset-fallback branches so a shared tweak can't blank
  // the page or rewrite every element via an over-broad action selector.
  function isBareOrUniversalSelector(sel) {
    const trimmed = sel.trim();
    if (trimmed.length === 0) return true;
    const tokens = trimmed.replace(/[>+~]/g, ' ').split(/\s+/).filter(Boolean);
    if (tokens.length === 0) return true; // combinator-only (e.g. ">")
    return tokens.every(t => FORBIDDEN_BARE_SELECTORS.has(t));
  }

  function isSafeSelector(sel) {
    if (typeof sel !== 'string' || sel.length === 0 || sel.length > MAX_SELECTOR_LEN) return false;
    if (EXTENSION_UI_PREFIXES.some(p => sel.includes(p))) return false;
    if (isBareOrUniversalSelector(sel)) return false;

    // Quick syntax check: must succeed querySelector parse. Preferred
    // path when running inside a content script / popup — the browser
    // is the gold-standard parser.
    if (typeof document !== 'undefined' && document.createDocumentFragment) {
      try {
        document.createDocumentFragment().querySelector(sel);
        return true;
      } catch (e) {
        return false;
      }
    }

    // Non-DOM env (service worker, Node test harness): apply a strict
    // syntactic gate. Anything containing characters outside the
    // expected CSS selector charset is rejected — closes the previous
    // "return true unconditionally" fall-open path.
    return SAFE_SELECTOR_CHARSET.test(sel);
  }

  function validateStyleValue(prop, val, fieldPrefix, errors) {
    const str = String(val);
    // Explicit dangerous-pattern check first (defense-in-depth).
    if (DANGEROUS_VALUE_RE.test(str)) {
      errors.push({ field: fieldPrefix, reason: 'value contains a disallowed pattern (url/expression/javascript/etc.)' });
      return;
    }
    // Intentionally call sanitizeCSSValue WITHOUT a property hint. This forces
    // the strict fallback regex (alphanumeric + - % . space only), which is
    // the V1 "simple values only" rule for inline-style actions. Complex
    // values (rgb(), calc(), #hex, multi-token shorthands like "1px solid red")
    // belong in the `css` field where the CSS sanitizer parses them via AST.
    // Do NOT pass `prop` here — it would broaden the attack surface for V1.
    const safe = (typeof window !== 'undefined' && window.Sanitizer && window.Sanitizer.sanitizeCSSValue)
      ? window.Sanitizer.sanitizeCSSValue(str)
      : null;
    if (!safe || safe !== str.trim()) {
      errors.push({ field: fieldPrefix, reason: 'value contains disallowed characters or fails sanitization' });
    }
  }

  // Day-offset bounds for matchDate. ±100yrs is wide enough for any real
  // due-date rule while keeping the value sane (an integer count of days
  // from today, not a timestamp).
  const MATCHDATE_BOUND = 36500;
  // Attribute name an author may read the date from. Conservative HTML/XML
  // attribute-name charset (lets through data-*, datetime, aria-*, etc.).
  const ATTR_NAME_RE = /^[a-zA-Z_:][a-zA-Z0-9_:.-]*$/;

  function validateMatchDate(md, fieldPath, errors) {
    if (!md || typeof md !== 'object' || Array.isArray(md)) {
      errors.push({ field: fieldPath, reason: 'matchDate must be an object { min?, max?, attr?, selector? }' });
      return;
    }
    if (md.attr !== undefined && (typeof md.attr !== 'string' || !ATTR_NAME_RE.test(md.attr))) {
      errors.push({ field: `${fieldPath}.attr`, reason: 'attr must be a valid attribute name (defaults to "datetime")' });
    }
    if (md.selector !== undefined && !isSafeSelector(md.selector)) {
      errors.push({ field: `${fieldPath}.selector`, reason: 'selector is invalid or targets extension UI' });
    }
    for (const key of ['min', 'max']) {
      if (md[key] !== undefined &&
          (typeof md[key] !== 'number' || !Number.isInteger(md[key]) ||
           md[key] < -MATCHDATE_BOUND || md[key] > MATCHDATE_BOUND)) {
        errors.push({ field: `${fieldPath}.${key}`, reason: `${key} must be an integer day offset from today between -${MATCHDATE_BOUND} and ${MATCHDATE_BOUND}` });
      }
    }
    if (md.min === undefined && md.max === undefined) {
      errors.push({ field: fieldPath, reason: 'matchDate needs at least one of min/max (day offset from today: 0=today, -1=yesterday, 2=in two days)' });
    }
    if (typeof md.min === 'number' && typeof md.max === 'number' && md.min > md.max) {
      errors.push({ field: fieldPath, reason: 'matchDate.min must be ≤ matchDate.max' });
    }
  }

  function validateAction(action, fieldPath, errors, inThen) {
    if (!action || typeof action !== 'object') {
      errors.push({ field: fieldPath, reason: 'action must be an object' });
      return;
    }
    if (!ALLOWED_VERBS.has(action.type)) {
      errors.push({
        field: `${fieldPath}.type`,
        reason: `verb "${action.type}" is not allowed in V1 (allowed: ${[...ALLOWED_VERBS].join(', ')})`
      });
      return;
    }
    // V1.7: nested onEvent inside then[] is forbidden — chains run only
    // pure DOM-mutation verbs so we don't recursively register listeners
    // (and keep the chain semantics simple: fire → mutate, no event-loops).
    if (inThen && (action.type === 'onEvent' || action.type === 'confirmBeforeAction')) {
      errors.push({
        field: `${fieldPath}.type`,
        reason: `${action.type} is not allowed inside then[] — chains are pure DOM-mutation actions only`
      });
      return;
    }
    if (!isSafeSelector(action.selector)) {
      errors.push({ field: `${fieldPath}.selector`, reason: 'selector is invalid or targets extension UI' });
    }
    // Optional per-element guard — substring match against el.textContent.
    // Universal across verbs. Plain string only (no regex) to keep the
    // surface small and avoid ReDoS.
    if (action.match !== undefined) {
      if (typeof action.match !== 'string' || action.match.length > MAX_MATCH_LEN) {
        errors.push({ field: `${fieldPath}.match`, reason: `match must be a string up to ${MAX_MATCH_LEN} chars` });
      }
    }
    // Optional per-element date guard — gate the action on how many whole
    // calendar days the element's date attribute is from today. Universal
    // across verbs (like `match`). Lets a tweak shade by due date — the
    // engine's passesDateGuard does the day math against `datetime`.
    if (action.matchDate !== undefined) {
      validateMatchDate(action.matchDate, `${fieldPath}.matchDate`, errors);
    }
    if (action.type === 'addClass' || action.type === 'removeClass') {
      if (typeof action.class !== 'string' || !/^[a-zA-Z_-][a-zA-Z0-9_-]*$/.test(action.class)) {
        errors.push({ field: `${fieldPath}.class`, reason: 'class must be a valid CSS identifier' });
      }
    }
    if (action.type === 'setStyle') {
      if (!action.style || typeof action.style !== 'object') {
        errors.push({ field: `${fieldPath}.style`, reason: 'style must be an object of {property: value}' });
      } else {
        for (const [prop, val] of Object.entries(action.style)) {
          // Property must be a CSS identifier (camelCase or kebab-case).
          if (!/^[a-zA-Z][a-zA-Z0-9-]*$/.test(prop)) {
            errors.push({ field: `${fieldPath}.style.${prop}`, reason: 'property name is invalid' });
            continue;
          }
          validateStyleValue(prop, val, `${fieldPath}.style.${prop}`, errors);
        }
      }
    }
    if (action.type === 'setText') {
      if (typeof action.text !== 'string' || action.text.length > MAX_TEXT_LEN) {
        errors.push({ field: `${fieldPath}.text`, reason: `text must be a string up to ${MAX_TEXT_LEN} chars` });
      }
    }
    if (action.type === 'onEvent') {
      if (!ALLOWED_EVENTS.has(action.event)) {
        errors.push({ field: `${fieldPath}.event`, reason: `event "${action.event}" is not allowed in V1.5 (allowed: ${[...ALLOWED_EVENTS].join(', ')})` });
      }
      if (action.preventDefault !== undefined && typeof action.preventDefault !== 'boolean') {
        errors.push({ field: `${fieldPath}.preventDefault`, reason: 'preventDefault must be a boolean' });
      }
      if (action.stopPropagation !== undefined && typeof action.stopPropagation !== 'boolean') {
        errors.push({ field: `${fieldPath}.stopPropagation`, reason: 'stopPropagation must be a boolean' });
      }
      if (action.alert !== undefined) {
        if (!action.alert || typeof action.alert !== 'object') {
          errors.push({ field: `${fieldPath}.alert`, reason: 'alert must be an object' });
        } else {
          if (action.alert.title !== undefined && (typeof action.alert.title !== 'string' || action.alert.title.length > 200)) {
            errors.push({ field: `${fieldPath}.alert.title`, reason: 'title must be a string up to 200 chars' });
          }
          if (typeof action.alert.body !== 'string' || action.alert.body.length === 0 || action.alert.body.length > 1000) {
            errors.push({ field: `${fieldPath}.alert.body`, reason: 'body must be a string 1..1000 chars' });
          }
          if (action.alert.confirmLabel !== undefined && (typeof action.alert.confirmLabel !== 'string' || action.alert.confirmLabel.length > 30)) {
            errors.push({ field: `${fieldPath}.alert.confirmLabel`, reason: 'confirmLabel must be a string up to 30 chars' });
          }
        }
      }
      // V1.7: validate the chained then[] steps (recursively, with inThen=true
      // to forbid further onEvent nesting).
      if (action.then !== undefined) {
        if (!Array.isArray(action.then)) {
          errors.push({ field: `${fieldPath}.then`, reason: 'then must be an array of actions' });
        } else if (action.then.length > MAX_THEN_STEPS) {
          errors.push({ field: `${fieldPath}.then`, reason: `no more than ${MAX_THEN_STEPS} chained steps per onEvent` });
        } else {
          action.then.forEach((step, ti) => {
            validateAction(step, `${fieldPath}.then[${ti}]`, errors, true);
          });
        }
      }
      // Must have at least one side effect — otherwise the action is a no-op.
      // V1.7: a non-empty then[] counts as a side effect on its own (the
      // sortable-headers use case is "click → setText" with no alert).
      const hasThen = Array.isArray(action.then) && action.then.length > 0;
      const hasSideEffect = action.preventDefault === true || action.stopPropagation === true || action.alert !== undefined || hasThen;
      if (!hasSideEffect) {
        errors.push({ field: fieldPath, reason: 'onEvent must have at least one side effect (preventDefault, stopPropagation, alert, or then[])' });
      }
    }
    if (action.type === 'confirmBeforeAction') {
      if (!ALLOWED_CONFIRM_EVENTS.has(action.event)) {
        errors.push({ field: `${fieldPath}.event`, reason: `event "${action.event}" is not allowed for confirmBeforeAction (allowed: ${[...ALLOWED_CONFIRM_EVENTS].join(', ')})` });
      }
      if (typeof action.confirm !== 'string' || action.confirm.length < 1 || action.confirm.length > MAX_TEXT_LEN) {
        errors.push({ field: `${fieldPath}.confirm`, reason: `confirm must be a string 1..${MAX_TEXT_LEN} chars (the warning shown before the action runs)` });
      }
    }
    if (action.type === 'moveBefore' || action.type === 'moveAfter') {
      if (!isSafeSelector(action.referenceSelector)) {
        errors.push({ field: `${fieldPath}.referenceSelector`, reason: 'referenceSelector is invalid or targets extension UI' });
      }
    }
    if (action.type === 'sortChildren') {
      if (action.childSelector !== undefined && !isSafeSelector(action.childSelector)) {
        errors.push({ field: `${fieldPath}.childSelector`, reason: 'childSelector is invalid or targets extension UI' });
      }
      if (action.keySelector !== undefined && !isSafeSelector(action.keySelector)) {
        errors.push({ field: `${fieldPath}.keySelector`, reason: 'keySelector is invalid or targets extension UI' });
      }
      if (action.key !== undefined && !ALLOWED_SORT_KEYS.has(action.key)) {
        errors.push({ field: `${fieldPath}.key`, reason: `key must be one of: ${[...ALLOWED_SORT_KEYS].join(', ')}` });
      }
      if (action.direction !== undefined && !ALLOWED_SORT_DIRECTIONS.has(action.direction)) {
        errors.push({ field: `${fieldPath}.direction`, reason: `direction must be one of: ${[...ALLOWED_SORT_DIRECTIONS].join(', ')}` });
      }
    }
  }

  function validate(tweak) {
    const errors = [];

    if (!tweak || typeof tweak !== 'object') {
      return { ok: false, errors: [{ field: '', reason: 'tweak must be an object' }] };
    }

    // id
    if (!tweak.id || typeof tweak.id !== 'string' || !UUID_RE.test(tweak.id)) {
      errors.push({ field: 'id', reason: 'id must be a uuid v4' });
    }

    // name
    if (typeof tweak.name !== 'string' || tweak.name.trim().length === 0 || tweak.name.length > MAX_NAME_LEN) {
      errors.push({ field: 'name', reason: `name must be a 1..${MAX_NAME_LEN} char string` });
    }

    // description (optional). `!= null` accepts both undefined (freshly built,
    // in-memory) and null (JSON round-trip from the server, which stores
    // `description || null`) as "no description".
    if (tweak.description != null && (typeof tweak.description !== 'string' || tweak.description.length > MAX_DESC_LEN)) {
      errors.push({ field: 'description', reason: `description must be a string up to ${MAX_DESC_LEN} chars` });
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
        if (tweak.actions.length > MAX_ACTIONS) {
          errors.push({ field: 'actions', reason: `no more than ${MAX_ACTIONS} actions per tweak` });
        }
        tweak.actions.forEach((action, i) => validateAction(action, `actions[${i}]`, errors, false));
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

if (typeof window !== 'undefined') {
  window.TweakValidator = TweakValidator;
}
