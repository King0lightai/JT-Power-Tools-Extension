/**
 * Task Completion — task id resolver (ISOLATED world)
 *
 * The content-script half of the task id probe. Marks a card with a one-shot
 * random token, asks the MAIN-world script (task-id-page.js) which task that
 * element belongs to, and resolves with { taskId, taskName } or null.
 *
 * Null is a normal answer, not an error: the probe returns nothing when React's
 * internals move, when the script isn't installed, or when the element isn't a
 * task card at all. Every caller falls back to the sidebar path in that case,
 * so a null costs a few hundred milliseconds and nothing else.
 *
 * @module TaskIdResolver
 */
const TaskIdResolver = (() => {
  const PROBE_ATTR = 'data-jt-pt-task-probe';
  // Generous enough for a busy main thread, short enough that the fallback
  // still feels like a click rather than a hang.
  const TIMEOUT_MS = 250;

  const pending = new Map();   // token -> settle fn
  const cache = new WeakMap(); // element -> { taskId, taskName }
  let listening = false;

  /**
   * @returns {string} 16 hex chars, matching the probe's token format
   */
  function newToken() {
    const bytes = new Uint8Array(8);
    crypto.getRandomValues(bytes);
    return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
  }

  function onMessage(event) {
    // Same-window only. A null source is allowed because jsdom reports one for
    // its own postMessage; the real gate here is the token, which is 64 random
    // bits and never leaves this window - and a forged id would still have to
    // survive the name check in TaskApiSave before anything is written.
    if (event.source && event.source !== window) return;
    const data = event.data;
    if (!data || data.source !== 'jt-pt-taskid-res') return;
    const settle = pending.get(data.token);
    if (!settle) return; // not ours, or already timed out
    settle(data.taskId ? { taskId: data.taskId, taskName: data.taskName } : null);
  }

  function ensureListener() {
    if (listening) return;
    window.addEventListener('message', onMessage);
    listening = true;
  }

  /**
   * Which task does this element belong to?
   * @param {HTMLElement} element - a task card, or anything inside one
   * @returns {Promise<Object|null>} { taskId, taskName } or null
   */
  function resolve(element) {
    if (!element) return Promise.resolve(null);
    if (cache.has(element)) return Promise.resolve(cache.get(element));

    ensureListener();
    const token = newToken();

    return new Promise((resolveWith) => {
      let done = false;
      const finish = (result) => {
        if (done) return;
        done = true;
        clearTimeout(timer);
        pending.delete(token);
        element.removeAttribute(PROBE_ATTR);
        if (result) cache.set(element, result);
        resolveWith(result);
      };

      const timer = setTimeout(() => finish(null), TIMEOUT_MS);
      pending.set(token, finish);

      element.setAttribute(PROBE_ATTR, token);
      try {
        window.postMessage({ source: 'jt-pt-taskid-req', token }, window.location.origin);
      } catch (e) {
        finish(null);
      }
    });
  }

  /**
   * Try several elements in order and return the first task found. A calendar
   * row and a Kanban card put the task component at different depths, so the
   * caller offers both the name element and the card.
   * @param {Array<HTMLElement>} elements
   * @returns {Promise<Object|null>}
   */
  async function resolveAny(elements) {
    for (const element of elements) {
      if (!element) continue;
      const found = await resolve(element);
      if (found) return found;
    }
    return null;
  }

  /**
   * Drop a cached answer (the card was recycled into a different task).
   * @param {HTMLElement} element
   */
  function forget(element) {
    if (element) cache.delete(element);
  }

  /**
   * Feature cleanup: stop listening and abandon anything in flight.
   */
  function destroy() {
    pending.forEach((settle) => settle(null));
    pending.clear();
    if (listening) {
      window.removeEventListener('message', onMessage);
      listening = false;
    }
    document.querySelectorAll(`[${PROBE_ATTR}]`).forEach((el) => el.removeAttribute(PROBE_ATTR));
  }

  return { resolve, resolveAny, forget, destroy };
})();

if (typeof window !== 'undefined') {
  window.TaskIdResolver = TaskIdResolver;
}
