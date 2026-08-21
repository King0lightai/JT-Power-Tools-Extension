/**
 * Task Completion — API save path (ISOLATED world)
 *
 * Writes a task's completion straight to JobTread with a Pave `updateTask`
 * mutation, instead of opening JobTread's sidebar and clicking its Progress
 * checkbox. One round trip rather than a second and a half of UI puppeteering
 * that breaks whenever the sidebar's markup changes.
 *
 * The id comes from React's props (see task-id-resolver.js), which is a page
 * internal and not a contract. So it is PROVEN before anything is written: read
 * the task back by id and require its name to match the card the user actually
 * clicked. A wrong id would silently complete some other task on some other
 * job, and nobody would see it happen. If the proof fails - for any reason -
 * this returns null and the caller uses the sidebar, which cannot target the
 * wrong task because it is driving the card's own UI.
 *
 * @module TaskApiSave
 * @requires JobTreadAPI
 */
const TaskApiSave = (() => {
  const ID_RE = /^[A-Za-z0-9]{6,32}$/;

  // Ids already matched to their card this session. The name check is one
  // extra request per task; repeated toggles of the same task skip it.
  const verifiedIds = new Set();

  /**
   * Is the API path usable at all? Without a grant key there is nothing to
   * write with, and the feature quietly stays on the sidebar path.
   * @returns {Promise<boolean>}
   */
  async function isAvailable() {
    if (!window.JobTreadAPI) return false;
    try {
      return await window.JobTreadAPI.isConfigured();
    } catch (e) {
      return false;
    }
  }

  /**
   * @param {string} text
   * @returns {string}
   */
  function normalizeName(text) {
    return String(text || '').replace(/\s+/g, ' ').trim().toLowerCase();
  }

  /**
   * Prove the resolved id is the task on screen.
   * @param {string} taskId
   * @param {string} expectedName - the name rendered on the card
   * @returns {Promise<boolean>}
   */
  async function verify(taskId, expectedName) {
    if (verifiedIds.has(taskId)) return true;
    if (!normalizeName(expectedName)) return false;

    const result = await window.JobTreadAPI.paveQuery({
      task: { $: { id: taskId }, id: {}, name: {} }
    });

    const name = result?.task?.name;
    if (!name || normalizeName(name) !== normalizeName(expectedName)) {
      console.warn(
        `TaskApiSave: id ${taskId} reads back as "${name || '(nothing)'}" but the card says ` +
        `"${expectedName}" - not writing, falling back to the sidebar`
      );
      return false;
    }

    verifiedIds.add(taskId);
    return true;
  }

  /**
   * Set a task complete or incomplete.
   *
   * Pave stores progress as 0-1, not a percentage.
   *
   * @param {Object} args
   * @param {string} args.taskId
   * @param {string} args.expectedName - name rendered on the card, for the proof
   * @param {boolean} args.complete
   * @returns {Promise<boolean|null>} the saved state, or null when the id could
   *   not be proven (caller should fall back)
   */
  async function setComplete({ taskId, expectedName, complete }) {
    if (!taskId || !ID_RE.test(taskId)) return null;
    if (!(await verify(taskId, expectedName))) return null;

    const result = await window.JobTreadAPI.paveQuery({
      updateTask: {
        $: { id: taskId, progress: complete ? 1 : 0 },
        task: { $: { id: taskId }, id: {}, progress: {} }
      }
    });

    const task = result?.updateTask?.task;
    if (!task) throw new Error('JobTread did not confirm the update');

    // Report what JobTread stored, not what we asked for.
    return Number(task.progress || 0) >= 1;
  }

  /**
   * Feature cleanup - a re-enable should re-prove its ids.
   */
  function clearCache() {
    verifiedIds.clear();
  }

  return { isAvailable, setComplete, clearCache };
})();

if (typeof window !== 'undefined') {
  window.TaskApiSave = TaskApiSave;
}
