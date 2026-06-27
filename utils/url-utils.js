/**
 * URL Utilities
 * Centralized URL/navigation helpers for JT Power Tools
 *
 * Used by: availability-filter.js, task-type-filter.js
 */

const UrlUtils = (() => {
  /**
   * A "navigation key" for the given URL with the transient `taskId` param
   * removed. Opening/closing a task sidebar only toggles ?taskId=, which is
   * NOT a real navigation — using this key for URL-change detection keeps
   * features from tearing down and rebuilding every time a task opens.
   *
   * @param {string} href - The URL to derive a navigation key from
   * @returns {string} Pathname + query string with `taskId` stripped, or the
   *                   original href if it cannot be parsed
   */
  function navKeyIgnoringTask(href) {
    try {
      const u = new URL(href);
      u.searchParams.delete('taskId');
      return `${u.pathname}?${u.searchParams.toString()}`;
    } catch (e) {
      return href;
    }
  }

  return { navKeyIgnoringTask };
})();

if (typeof window !== 'undefined') {
  window.UrlUtils = UrlUtils;
}
