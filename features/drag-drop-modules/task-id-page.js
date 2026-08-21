/**
 * Task Completion — page-context task id probe (MAIN world, document_start)
 *
 * Answers one question for the completion checkboxes: "which JobTread task is
 * this card?" The schedule DOM never says. A task card carries no id, no data
 * attribute and no link — which is why toggling completion used to mean
 * opening JobTread's own sidebar and clicking its Progress checkbox, a ~1.5s
 * round trip through UI that moves whenever JobTread reshuffles it.
 *
 * The id does exist, in React's props for the card's component. Those live on
 * expando properties (`__reactFiber$*` / `__reactProps$*`) that a content
 * script cannot see: the ISOLATED world shares the DOM nodes but not the
 * page's JS properties on them. So this runs in the MAIN world and hands the
 * id back over a same-window postMessage.
 *
 * It never reads anything but the fiber tree above one element the caller
 * marked, and returns only { taskId, taskName } — both already rendered on the
 * page. No credentials cross this bus.
 *
 * Protocol (window.postMessage, same-window only):
 *   ← { source:'jt-pt-taskid-req', token }
 *   → { source:'jt-pt-taskid-res', token, taskId, taskName }
 */
(function () {
  'use strict';

  if (window.__jtPtTaskIdProbeInstalled) return;
  window.__jtPtTaskIdProbeInstalled = true;

  const PROBE_ATTR = 'data-jt-pt-task-probe';
  // The caller's own random token. Anything else is not a request we made.
  const TOKEN_RE = /^[a-f0-9]{16}$/;
  // JobTread ids are short base62 strings ("22PGZ2Aw3f9m").
  const ID_RE = /^[A-Za-z0-9]{6,32}$/;

  // How far up the fiber tree to look. The card's own component is usually
  // within a few levels; beyond that we're into page chrome that knows nothing
  // about this task.
  const MAX_DEPTH = 30;

  // Props that only a task carries. A job node also has { id, name }, so
  // without one of these there is no way to tell the two apart - and guessing
  // would complete a task on the wrong record.
  const TASK_MARKERS = ['progress', 'startDate', 'endDate', 'isToDo', 'taskType', 'taskTypeId'];

  /**
   * @param {Object} value
   * @returns {boolean} true when this looks like a task node, not a job/other
   */
  function isTaskNode(value) {
    if (!value || typeof value !== 'object') return false;
    if (typeof value.id !== 'string' || !ID_RE.test(value.id)) return false;
    if (typeof value.name !== 'string') return false;
    return TASK_MARKERS.some((marker) => Object.prototype.hasOwnProperty.call(value, marker));
  }

  /**
   * The fiber React attached to a DOM node, if any.
   * @param {HTMLElement} element
   * @returns {Object|null}
   */
  function fiberOf(element) {
    const key = Object.keys(element).find((k) => k.startsWith('__reactFiber$'));
    return key ? element[key] : null;
  }

  /**
   * Walk up from a marked element looking for the task node in a component's
   * props. Prefers an explicitly named `task` prop; falls back to any prop
   * value that carries task-only fields.
   * @param {HTMLElement} element
   * @returns {Object|null} { taskId, taskName }
   */
  function findTask(element) {
    let fiber = fiberOf(element);

    for (let depth = 0; fiber && depth < MAX_DEPTH; depth++, fiber = fiber.return) {
      const props = fiber.memoizedProps;
      if (props && typeof props === 'object') {
        if (isTaskNode(props.task)) return { taskId: props.task.id, taskName: props.task.name };
        // Some card components spread the node in under another name
        // ("node", "item", "value"), so scan the shallow prop values too.
        for (const value of Object.values(props)) {
          if (isTaskNode(value)) return { taskId: value.id, taskName: value.name };
        }
        if (isTaskNode(props)) return { taskId: props.id, taskName: props.name };
      }
    }
    return null;
  }

  window.addEventListener('message', (event) => {
    if (event.source !== window) return;
    const data = event.data;
    if (!data || data.source !== 'jt-pt-taskid-req') return;
    if (typeof data.token !== 'string' || !TOKEN_RE.test(data.token)) return;

    let found = null;
    try {
      const element = document.querySelector(`[${PROBE_ATTR}="${data.token}"]`);
      if (element) found = findTask(element);
    } catch (e) {
      // A React internals change must never break the page - the caller
      // treats a null answer as "use the sidebar instead".
    }

    try {
      window.postMessage({
        source: 'jt-pt-taskid-res',
        token: data.token,
        taskId: found ? found.taskId : null,
        taskName: found ? found.taskName : null
      }, window.location.origin);
    } catch (e) {
      // Caller times out and falls back.
    }
  });
})();
