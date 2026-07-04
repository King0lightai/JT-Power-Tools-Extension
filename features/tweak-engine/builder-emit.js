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
      const action = buildAction(intent, values, selector);
      // Resilience (spec C1): carry the picker's fallback selectors so the
      // engine can recover if JobTread's UI change breaks the primary. Only
      // for action verbs — restyle emits css, which has no per-action
      // fallback. The validator caps/re-checks these on save.
      const candidates = capture && Array.isArray(capture.selectorCandidates)
        ? capture.selectorCandidates.filter((c) => typeof c === 'string' && c && c !== selector).slice(0, 5)
        : [];
      if (candidates.length) action.selectorCandidates = candidates;
      tweak.actions = [action];
    }
    return tweak;
  }

  return { buildTweak, buildAction, buildRestyleCss, defaultName };
})();

if (typeof window !== 'undefined') window.TweakBuilderEmit = TweakBuilderEmit;
