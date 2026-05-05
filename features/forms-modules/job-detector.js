/**
 * FormsJobDetector
 *
 * SPA-aware detector for `app.jobtread.com/jobs/{jobId}` routes.
 *
 * JobTread is a React single-page app — content scripts load once at
 * `document_end` and never re-execute on subsequent navigations. A one-shot
 * URL check at startup therefore misses every route change after the first.
 *
 * This module observes `document.body` mutations and `popstate` events, then
 * emits the current `{ jobId }` (or `null`) only when it actually changes
 * from the previously-seen value. The dedupe via `lastJobKey` keeps the
 * listener quiet during JT's heavy DOM churn while still catching every real
 * route transition.
 *
 * Note: JT's job URLs do NOT include the org id (e.g. `/jobs/{jobId}` or
 * `/jobs/{jobId}/{section}`). Callers that need the org id should resolve
 * it via `JobTreadAPI.getOrgId()` separately.
 */
const FormsJobDetector = (() => {
  const URL_RE = /^https:\/\/app\.jobtread\.com\/jobs\/([^/?#]+)/i;
  const NONE_KEY = '__none__';

  let observer = null;
  let lastJobKey = null;
  let listener = null;

  /**
   * Parse a URL string into `{ jobId }` or `null`.
   * Pure function — no side effects, no state read.
   *
   * @param {string} href
   * @returns {{ jobId: string } | null}
   */
  function parse(href) {
    if (typeof href !== 'string' || !href) return null;
    const match = URL_RE.exec(href);
    if (!match) return null;
    return { jobId: match[1] };
  }

  /**
   * Get the current job context derived from `location.href`.
   *
   * @returns {{ jobId: string } | null}
   */
  function getCurrentJob() {
    return parse(location.href);
  }

  function notifyIfChanged() {
    const current = getCurrentJob();
    const key = current ? current.jobId : NONE_KEY;
    if (key === lastJobKey) return;
    lastJobKey = key;
    if (typeof listener === 'function') {
      listener(current);
    }
  }

  /**
   * Start observing route changes. Fires `onChange` once immediately with
   * the initial state, then again whenever the detected job changes.
   *
   * @param {(job: { jobId: string } | null) => void} onChange
   */
  function start(onChange) {
    stop();
    listener = typeof onChange === 'function' ? onChange : null;
    lastJobKey = null;

    notifyIfChanged();

    observer = new MutationObserver(notifyIfChanged);
    observer.observe(document.body, { childList: true, subtree: true });

    window.addEventListener('popstate', notifyIfChanged);
  }

  /**
   * Stop observing and release all references. Fully reverses `start()`.
   */
  function stop() {
    if (observer) {
      observer.disconnect();
      observer = null;
    }
    window.removeEventListener('popstate', notifyIfChanged);
    listener = null;
    lastJobKey = null;
  }

  return { parse, getCurrentJob, start, stop };
})();

window.FormsJobDetector = FormsJobDetector;
