/**
 * TweakDescribe — turns a tweak (or candidate tweak) into plain-English
 * lines for the builder preview, the import-trust dialog, popup cards,
 * and the MCP create_tweak confirmation. Pure: no DOM, no storage.
 */
const TweakDescribe = (() => {
  const q = (s) => '"' + String(s) + '"';

  // Plain-English label for a single day offset used by matchDate.
  function dayLabel(n) {
    if (n === 0) return 'today';
    if (n === 1) return 'tomorrow';
    if (n === -1) return 'yesterday';
    if (n < 0) return Math.abs(n) + ' days overdue';
    return 'in ' + n + ' days';
  }

  // Suffix describing a matchDate guard, e.g. "(only items due today)".
  function dateGuardPhrase(md) {
    if (!md || typeof md !== 'object') return '';
    const { min, max } = md;
    if (typeof min === 'number' && typeof max === 'number') {
      return min === max
        ? '(only items due ' + dayLabel(min) + ')'
        : '(only items due ' + dayLabel(min) + ' through ' + dayLabel(max) + ')';
    }
    if (typeof max === 'number') return '(only items due ' + dayLabel(max) + ' or sooner)';
    if (typeof min === 'number') return '(only items due ' + dayLabel(min) + ' or later)';
    return '';
  }

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
        if (a && a.matchDate) {
          const phrase = dateGuardPhrase(a.matchDate);
          if (phrase) line += ' ' + phrase;
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
