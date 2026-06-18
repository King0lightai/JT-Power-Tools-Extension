/**
 * Budget Row Highlight (Essential)
 *
 * Tints a budget row when it contains one of nine circle emojis — a highlight
 * workaround for JobTread budgets. Soft, theme-adaptive, readable. Sibling to
 * Budget Hierarchy Shading.
 *
 * Detection: scan the whole row (cell text + input values) for a circle emoji;
 * the first by the fixed precedence order wins. The tint is an OPAQUE color
 * chosen per active theme (light/dark) and applied to every cell — including the
 * sticky number/name columns — so the whole row reads as one band.
 *
 * Precedence: `:not(.bg-blue-50)` lets JobTread's selection highlight win while a
 * row is selected; `!important` lets the tint override Budget Hierarchy shading.
 */
const BudgetRowHighlight = (() => {
  let isActive = false;
  let observer = null;
  let debounceTimer = null;
  let styleEl = null;
  let currentSet = null; // 'light' | 'dark' the stylesheet was built for
  let inputHandler = null;
  let focusHandler = null;

  // Emoji → color key, in precedence order (first match in a row wins).
  const EMOJI_COLORS = [
    ['🔴', 'red'], ['🟠', 'orange'], ['🟡', 'amber'], ['🟢', 'green'],
    ['🔵', 'blue'], ['🟣', 'purple'], ['🟤', 'brown'], ['⚫', 'dark'], ['⚪', 'light'],
  ];
  const COLOR_KEYS = EMOJI_COLORS.map(([, k]) => k);

  // Opaque tints, for light vs dark backgrounds. Opaque (not rgba) so the sticky
  // cells — which carry their own bg — tint cleanly and text stays readable.
  const TINTS = {
    light: {
      red: 'hsl(0,75%,91%)', orange: 'hsl(28,85%,88%)', amber: 'hsl(45,90%,85%)',
      green: 'hsl(140,55%,88%)', blue: 'hsl(210,80%,90%)', purple: 'hsl(280,55%,91%)',
      brown: 'hsl(25,45%,83%)', dark: 'hsl(0,0%,84%)', light: 'hsl(0,0%,95%)',
    },
    dark: {
      red: 'hsl(0,45%,30%)', orange: 'hsl(28,50%,30%)', amber: 'hsl(45,45%,28%)',
      green: 'hsl(140,35%,26%)', blue: 'hsl(210,45%,32%)', purple: 'hsl(280,35%,33%)',
      brown: 'hsl(25,40%,26%)', dark: 'hsl(0,0%,20%)', light: 'hsl(0,0%,42%)',
    },
  };

  /** Pure: the first circle emoji in the text → color key, else null. */
  function detectRowColor(text) {
    if (!text) return null;
    for (const [emoji, key] of EMOJI_COLORS) {
      if (text.indexOf(emoji) !== -1) return key;
    }
    return null;
  }

  function isBudgetPage() {
    return /\/jobs\/[^/]+\/budget/.test(window.location.pathname);
  }

  /** Rough luminance test for a hex or rgb() color string. */
  function isDarkColor(color) {
    if (!color) return false;
    let r, g, b;
    const hex = color.replace('#', '').trim();
    if (/^[0-9a-f]{6}$/i.test(hex)) {
      r = parseInt(hex.slice(0, 2), 16); g = parseInt(hex.slice(2, 4), 16); b = parseInt(hex.slice(4, 6), 16);
    } else {
      const m = color.match(/(\d+)[,\s]+(\d+)[,\s]+(\d+)/);
      if (!m) return false;
      r = +m[1]; g = +m[2]; b = +m[3];
    }
    return (0.299 * r + 0.587 * g + 0.114 * b) < 140;
  }

  /** Which tint set to use for the active theme ('light' | 'dark'). */
  function activeTintSet() {
    if (document.getElementById('jt-custom-theme-styles')) {
      const bg = getComputedStyle(document.documentElement)
        .getPropertyValue('--jt-theme-background').trim();
      return isDarkColor(bg) ? 'dark' : 'light';
    }
    if (document.getElementById('jt-dark-mode-styles')) return 'dark';
    return 'light';
  }

  function buildStylesheet(set) {
    const tints = TINTS[set];
    // :not(.bg-blue-50) yields to JobTread's selection highlight.
    const css = COLOR_KEYS.map((k) => {
      const tint = tints[k];
      // (1) tint the cell itself, yielding to JobTread's selection shades;
      // (2) tint opaque bg-white descendants — chiefly the nested-row indent
      // spacers, which carry their own bg-white and would otherwise stay white
      // inside a tinted row. The row being EDITED is dropped from tinting
      // entirely in apply() (see rowIsEditing): JobTread's cell editor is a
      // bg-transparent <textarea> laid over the cell, so any tint on the cell or
      // row shows through behind the text and washes out the caret. Clearing the
      // whole row while a field in it is focused lets the editor render on
      // JobTread's native background with a normal, visible caret.
      return `.jt-rowhl-${k}:not(.bg-blue-50):not(.bg-blue-100){background-color:${tint} !important;}` +
        `.jt-rowhl-${k} .bg-white{background-color:${tint} !important;}`;
    }).join('');
    if (!styleEl) {
      styleEl = document.createElement('style');
      styleEl.id = 'jt-budget-row-highlight-styles';
      document.head.appendChild(styleEl);
    }
    styleEl.textContent = css;
    currentSet = set;
  }

  function cellValue(cell) {
    const input = cell.querySelector && cell.querySelector('input,textarea');
    if (input) return input.value || '';
    return cell.textContent || '';
  }

  function rowText(row) {
    let t = '';
    for (const cell of row.children) t += cellValue(cell) + '\n';
    return t;
  }

  /** A data row (line item or group) shows a numeric row number in its first cell. */
  function isDataRow(row) {
    const c0 = row.children[0];
    return !!c0 && /^\d+$/.test((c0.textContent || '').trim());
  }

  /** True when the focused field (the cell editor) lives inside this row. */
  function rowIsEditing(row) {
    const ae = document.activeElement;
    return !!ae && (ae.tagName === 'INPUT' || ae.tagName === 'TEXTAREA') && row.contains(ae);
  }

  function setRowClass(row, key) {
    const want = key ? `jt-rowhl-${key}` : null;
    for (const cell of row.children) {
      const cl = cell.classList;
      if (!cl) continue;
      for (const c of [...cl]) {
        if (c.startsWith('jt-rowhl-') && c !== want) cl.remove(c);
      }
      if (want && !cl.contains(want)) cl.add(want);
    }
    // Also tint the ROW element inline. Budget Hierarchy Shading colors the row
    // and forces every cell + indent spacer to `background-color: inherit
    // !important` via a selector that out-specifies our cell class — so without
    // this they'd inherit Hierarchy's shade instead of our tint. An inline
    // !important on the row beats Hierarchy's class rule, so the cells it forces
    // to `inherit` inherit OUR tint. Cleared on deselect / no-emoji so Hierarchy
    // resumes. The 'jt-rowhl-row' flag lets cleanup() find these rows.
    const tint = (key && currentSet) ? TINTS[currentSet][key] : null;
    if (tint) {
      row.style.setProperty('background-color', tint, 'important');
      row.classList.add('jt-rowhl-row');
    } else {
      row.style.removeProperty('background-color');
      row.classList.remove('jt-rowhl-row');
    }
  }

  function apply() {
    if (!isActive || !isBudgetPage()) return;
    // Disconnect/reconnect: our own class writes must not re-trigger the observer
    // (guard flags don't work — observer callbacks fire after the flag clears).
    if (observer) observer.disconnect();
    try {
      const set = activeTintSet();
      if (set !== currentSet) buildStylesheet(set);
      for (const row of document.querySelectorAll('.flex.min-w-max')) {
        if (!isDataRow(row)) continue;
        // Drop the tint from the row being edited so the cell editor renders on
        // JobTread's native background — the editor <textarea> is transparent, so
        // a tinted cell/row would show through behind the caret and wash it out.
        if (rowIsEditing(row)) { setRowClass(row, null); continue; }
        // While the row is selected, drop the tint entirely so JobTread's
        // selection highlight shows through on every cell — the sticky cell uses
        // bg-blue-50, the rest use bg-blue-100. Re-tints on deselect.
        const selected = Array.from(row.children).some((c) =>
          c.classList && (c.classList.contains('bg-blue-50') || c.classList.contains('bg-blue-100')));
        setRowClass(row, selected ? null : detectRowColor(rowText(row)));
      }
    } finally {
      if (isActive && observer) {
        observer.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['class'] });
      }
    }
  }

  function schedule() {
    clearTimeout(debounceTimer);
    debounceTimer = setTimeout(apply, 80);
  }

  function init() {
    if (isActive) return;
    isActive = true;
    console.log('BudgetRowHighlight: Initializing...');
    buildStylesheet(activeTintSet());

    observer = new MutationObserver(() => schedule());
    observer.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['class'] });

    // Live re-tint while typing an emoji into a custom-field input (no DOM
    // mutation otherwise fires for a value change).
    inputHandler = (e) => {
      if (isBudgetPage() && e.target && e.target.matches && e.target.matches('input,textarea')) schedule();
    };
    document.addEventListener('input', inputHandler, true);

    // Clear the edited row's tint on focus, restore it on blur (see apply()).
    focusHandler = (e) => {
      if (isBudgetPage() && e.target && e.target.matches && e.target.matches('input,textarea')) schedule();
    };
    document.addEventListener('focusin', focusHandler, true);
    document.addEventListener('focusout', focusHandler, true);

    schedule();
    console.log('BudgetRowHighlight: Initialized');
  }

  function cleanup() {
    if (!isActive) return;
    console.log('BudgetRowHighlight: Cleaning up...');
    if (observer) { observer.disconnect(); observer = null; }
    if (inputHandler) { document.removeEventListener('input', inputHandler, true); inputHandler = null; }
    if (focusHandler) {
      document.removeEventListener('focusin', focusHandler, true);
      document.removeEventListener('focusout', focusHandler, true);
      focusHandler = null;
    }
    clearTimeout(debounceTimer);
    for (const el of document.querySelectorAll('[class*="jt-rowhl-"]')) {
      for (const c of [...el.classList]) {
        if (c.startsWith('jt-rowhl-')) el.classList.remove(c);
      }
      el.style.removeProperty('background-color'); // clears the inline row tint
    }
    if (styleEl) { styleEl.remove(); styleEl = null; }
    currentSet = null;
    isActive = false;
    console.log('BudgetRowHighlight: Cleaned up');
  }

  return {
    init,
    cleanup,
    isActive: () => isActive,
    // Exposed for unit tests (tests/features/budget-row-highlight.test.js).
    _detectRowColor: detectRowColor,
  };
})();

window.BudgetRowHighlight = BudgetRowHighlight;
