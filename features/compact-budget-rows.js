/**
 * Compact Budget Rows
 * Collapses budget rows to a single line; hovering a row expands it to full
 * content height. Pure CSS, no DOM mutation — promotes the "Compact budget +
 * hover reveal" org tweak into a built-in feature.
 *
 * Scoped to /budget pages via an html class (jt-compact-budget-rows) so the
 * compaction can't bleed onto other views that reuse the same Tailwind classes.
 * The class is toggled as the user navigates the SPA — a body MutationObserver
 * re-evaluates the path (the project's SPA-safe pattern; a URL check at load
 * alone misses subsequent client-side navigations).
 *
 * Unlike the tweak engine, a built-in feature has no auto-disable safety net,
 * so if it's on a budget page but no `.group/row` rows match, it logs a
 * one-shot console.warn — an early signal that JobTread changed its markup.
 */
const CompactBudgetRowsFeature = (() => {
  const STYLE_ID = 'jt-compact-budget-rows-styles';
  const HTML_CLASS = 'jt-compact-budget-rows';
  const ROW_SELECTOR = '.group\\/row';
  const EVALUATE_DEBOUNCE_MS = 150;
  const WARN_DELAY_MS = 2500;

  let isActive = false;
  let observer = null;
  let evaluateTimer = null;
  let warnTimer = null;
  let onBudget = false;
  let warned = false;

  function injectStyles() {
    if (document.getElementById(STYLE_ID)) return;
    const link = document.createElement('link');
    link.id = STYLE_ID;
    link.rel = 'stylesheet';
    link.href = chrome.runtime.getURL('styles/compact-budget-rows.css');
    document.head.appendChild(link);
  }

  function removeStyles() {
    const link = document.getElementById(STYLE_ID);
    if (link && link.parentNode) link.parentNode.removeChild(link);
  }

  function isBudgetPath() {
    return window.location.pathname.toLowerCase().includes('/budget');
  }

  // Toggle the html scope class based on the current path. Only acts on a
  // transition so we don't thrash the classList on every observer fire.
  function evaluate() {
    const nowOnBudget = isBudgetPath();
    if (nowOnBudget === onBudget) return;
    onBudget = nowOnBudget;
    if (onBudget) {
      document.documentElement.classList.add(HTML_CLASS);
      scheduleZeroMatchWarning();
    } else {
      document.documentElement.classList.remove(HTML_CLASS);
      clearWarnTimer();
      warned = false; // allow a fresh warning if we return to a budget page
    }
  }

  // No auto-disable safety net (unlike the tweak engine) — so if we're on a
  // budget page and nothing matches after the view has had time to render,
  // surface it once in the console for support/diagnosis.
  function scheduleZeroMatchWarning() {
    if (warned) return;
    clearWarnTimer();
    warnTimer = setTimeout(() => {
      warnTimer = null;
      if (!isActive || !onBudget || warned) return;
      let count = 0;
      try { count = document.querySelectorAll(ROW_SELECTOR).length; } catch (_e) { count = 0; }
      if (count === 0) {
        warned = true;
        console.warn('CompactBudgetRows: no budget rows matched (.group/row) — JobTread may have changed its markup');
      }
    }, WARN_DELAY_MS);
  }

  function clearWarnTimer() {
    if (warnTimer) { clearTimeout(warnTimer); warnTimer = null; }
  }

  function scheduleEvaluate() {
    if (evaluateTimer) clearTimeout(evaluateTimer);
    evaluateTimer = setTimeout(() => {
      evaluateTimer = null;
      if (isActive) evaluate();
    }, EVALUATE_DEBOUNCE_MS);
  }

  function startObserver() {
    if (observer) return;
    observer = new MutationObserver(scheduleEvaluate);
    observer.observe(document.body, { childList: true, subtree: true });
  }

  function init() {
    if (isActive) return;
    isActive = true;
    injectStyles();
    startObserver();
    evaluate();
    console.log('CompactBudgetRows: Initialized');
  }

  function cleanup() {
    if (!isActive) return;
    isActive = false;
    if (observer) { observer.disconnect(); observer = null; }
    if (evaluateTimer) { clearTimeout(evaluateTimer); evaluateTimer = null; }
    clearWarnTimer();
    document.documentElement.classList.remove(HTML_CLASS);
    removeStyles();
    onBudget = false;
    warned = false;
    console.log('CompactBudgetRows: Cleaned up');
  }

  return { init, cleanup, isActive: () => isActive };
})();

window.CompactBudgetRowsFeature = CompactBudgetRowsFeature;
