/**
 * Auto Sequence
 * Adds an "Auto Sequence" button to the schedule's mass-actions panel that
 * re-orders each group's items to match their start dates.
 *
 * The problem it solves: dragging schedule items pushes and pulls their DATES,
 * but JobTread's manual sequence (the `position` field) never follows along. In
 * Gantt view the bars end up marching backwards down the rows, and someone has
 * to hand-resequence the job.
 *
 * How it works: every task carries `position` — a lexical sort key scoped to its
 * PARENT. Because the key only ever competes with siblings, re-ordering within a
 * parent physically cannot move an item into another group. We read the job's
 * tasks, sort each group's children by start date, and commit the differences as
 * `updateTask { positionAfterTaskId }` calls — letting JobTread mint the keys
 * rather than computing base-26 strings ourselves.
 *
 * Two deliberate limits:
 *   - Top-level rows (the phase groups) are never re-ordered. Their order is the
 *     Proven Process, not a function of dates.
 *   - Writes carry ONLY position. Dates are never touched, so a resequence
 *     cannot ripple the schedule or fire a dependency cascade.
 */
const AutoSequenceFeature = (() => {
  let isActiveState = false;
  let observer = null;
  let debounceTimer = null;
  let container = null;
  let clickHandler = null;
  let styleElement = null;
  // Guards the body observer against reacting to our own renders.
  let isUpdating = false;
  // Set while writes are in flight so cleanup() can stop mid-run.
  let runToken = null;

  const PANEL_SELECTOR = 'div.z-30.absolute.right-0';
  const MASS_ACTIONS_RE = /mass\s+(\w+\s+)?actions/i;
  // JobTreadAPI throws this when no grant key is configured for the current org.
  const NO_KEY_RE = /API key not configured/i;
  const CONTAINER_CLASS = 'jt-autoseq';
  const PAGE_SIZE = 100;
  const MAX_PAGES = 20;

  // ─── Pure planning logic (unit-tested) ────────────────────────────────────

  /** Lexical compare for JobTread position keys ("n" < "nn" < "o"). */
  function comparePosition(a, b) {
    const pa = a.position || '';
    const pb = b.position || '';
    if (pa === pb) return 0;
    return pa < pb ? -1 : 1;
  }

  /**
   * Sort siblings into their date-correct order.
   * Start date ascending; items with no start date sink to the bottom; ties keep
   * their existing relative order (a stable sort), so running twice in a row
   * produces no writes the second time.
   *
   * @param {Array} current - siblings already in current position order
   * @returns {Array} the same tasks in desired order
   */
  function sortByStartDate(current) {
    return current
      .map((task, index) => ({ task, index }))
      .sort((a, b) => {
        const da = a.task.startDate || '';
        const db = b.task.startDate || '';
        if (da !== db) {
          if (!da) return 1;   // no date → last
          if (!db) return -1;
          return da < db ? -1 : 1;  // YYYY-MM-DD sorts chronologically
        }
        return a.index - b.index;  // stable
      })
      .map((entry) => entry.task);
  }

  /**
   * Bucket the tasks we are allowed to re-order by their parent group.
   * Skips to-dos (not on the schedule) and top-level rows (the phase groups,
   * whose order is the Proven Process rather than a function of dates).
   *
   * @param {Array} tasks
   * @returns {Map<string, Array>} parent id → children
   */
  function groupSortableChildren(tasks) {
    const byParent = new Map();
    for (const task of tasks || []) {
      if (!task || !task.id || task.isToDo || !task.parentId) continue;
      const siblings = byParent.get(task.parentId);
      if (siblings) siblings.push(task);
      else byParent.set(task.parentId, [task]);
    }
    return byParent;
  }

  /**
   * Build the set of `updateTask` moves that puts every group in date order.
   *
   * Per group: find the longest already-correct prefix, then re-anchor every
   * item from the first divergence onward to the item before it. That is
   * provably sufficient — the untouched prefix holds the lowest position keys,
   * so re-anchoring the tail in order lands the whole group in desired order —
   * and it collapses the common "one item slid" case to a couple of writes.
   *
   * When the very first item diverges we start at index 1, which anchors the
   * intended first item where it already sits and moves everything after it.
   * That avoids ever needing a "move to front" write, which Pave has no
   * parameter for.
   *
   * @param {Array} tasks - { id, name, startDate, position, parentId, isGroup, isToDo }
   * @returns {{groups: Array, moveCount: number}}
   */
  function computeResequencePlan(tasks) {
    const byParent = groupSortableChildren(tasks);
    const groups = [];
    let moveCount = 0;

    for (const [parentId, children] of byParent) {
      if (children.length < 2) continue;

      const current = [...children].sort(comparePosition);
      const desired = sortByStartDate(current);

      let prefix = 0;
      while (prefix < current.length && current[prefix].id === desired[prefix].id) prefix++;
      if (prefix === desired.length) continue;  // already in date order

      const moves = [];
      for (let i = Math.max(prefix, 1); i < desired.length; i++) {
        moves.push({
          taskId: desired[i].id,
          name: desired[i].name || '(unnamed)',
          afterTaskId: desired[i - 1].id
        });
      }
      if (moves.length === 0) continue;

      groups.push({
        parentId,
        parentName: children[0].parentName || 'Group',
        itemCount: children.length,
        moves
      });
      moveCount += moves.length;
    }

    // Deterministic report order.
    groups.sort((a, b) => a.parentName.localeCompare(b.parentName));
    return { groups, moveCount };
  }

  // ─── Page / panel helpers ─────────────────────────────────────────────────

  function getJobId() {
    const match = window.location.pathname.match(/\/jobs\/([^/]+)\/schedule/);
    return match ? match[1] : null;
  }

  function isSchedulePage() {
    return getJobId() !== null;
  }

  /** The mass-actions panel's scrollable content area, or null when closed. */
  function findPanelContentArea() {
    const panels = document.querySelectorAll(PANEL_SELECTOR);
    for (const panel of panels) {
      if (MASS_ACTIONS_RE.test(panel.textContent || '')) {
        return panel.querySelector('.overflow-y-auto') || null;
      }
    }
    return null;
  }

  function getThemeColors() {
    const isDark = document.getElementById('jt-dark-mode-styles') !== null;
    const isCustom = document.getElementById('jt-custom-theme-styles') !== null;

    if (isCustom) {
      const s = getComputedStyle(document.documentElement);
      const get = (v, fb) => s.getPropertyValue(v).trim() || fb;
      return {
        bg: get('--jt-theme-background-elevated', '#fafafa'),
        border: get('--jt-theme-border', '#e5e7eb'),
        heading: get('--jt-theme-text-muted', '#6b7280'),
        secondary: get('--jt-theme-text-secondary', '#9ca3af'),
        text: get('--jt-theme-text', '#374151')
      };
    }
    if (isDark) {
      return {
        bg: '#252525', border: '#404040', heading: '#a0a0a0',
        secondary: '#707070', text: '#e0e0e0'
      };
    }
    return {
      bg: '#fafafa', border: '#e5e7eb', heading: '#6b7280',
      secondary: '#9ca3af', text: '#374151'
    };
  }

  function applyTheme(el) {
    const t = getThemeColors();
    el.style.setProperty('--jt-autoseq-bg', t.bg);
    el.style.setProperty('--jt-autoseq-border', t.border);
    el.style.setProperty('--jt-autoseq-heading', t.heading);
    el.style.setProperty('--jt-autoseq-secondary', t.secondary);
    el.style.setProperty('--jt-autoseq-text', t.text);
  }

  // ─── Data access ──────────────────────────────────────────────────────────

  /** Flatten a Pave task node into the shape the planner works with. */
  function mapTaskNode(node) {
    return {
      id: node.id,
      name: node.name,
      startDate: node.startDate,
      position: node.position,
      isGroup: node.isGroup,
      isToDo: node.isToDo,
      parentId: node.parentTask?.id || null,
      parentName: node.parentTask?.name || null
    };
  }

  async function fetchTasks(jobId) {
    if (typeof JobTreadAPI === 'undefined') {
      throw new Error('JobTread API service unavailable');
    }
    const all = [];
    let page;
    let pages = 0;
    do {
      const params = { size: PAGE_SIZE };
      if (page) params.page = page;
      const result = await JobTreadAPI.paveQuery({
        job: {
          $: { id: jobId },
          id: {},
          tasks: {
            $: params,
            nextPage: {},
            nodes: {
              id: {}, name: {}, startDate: {}, isGroup: {}, isToDo: {},
              position: {}, parentTask: { id: {}, name: {} }
            }
          }
        }
      });
      const tasks = result?.job?.tasks;
      for (const node of tasks?.nodes || []) all.push(mapTaskNode(node));
      page = tasks?.nextPage || null;
      pages++;
    } while (page && pages < MAX_PAGES);

    return all;
  }

  /**
   * Commit the plan. Writes MUST be serial — each `positionAfterTaskId` refers
   * to a task whose own move may still be pending, so parallelising would
   * scramble the order it is trying to build.
   */
  async function applyPlan(plan, token, onProgress) {
    let done = 0;
    const failures = [];
    for (const group of plan.groups) {
      for (const move of group.moves) {
        if (token !== runToken) return { done, failures, aborted: true };
        try {
          await JobTreadAPI.paveQuery({
            updateTask: {
              $: { id: move.taskId, positionAfterTaskId: move.afterTaskId },
              // Pave reads this as an entity lookup, not a bare result
              // projection, so it needs its own `$`. Omit it and every write
              // 400s with: A non-null value is required at
              // "updateTask"."task"."$". Matches query-builder.js update().
              task: { $: { id: move.taskId }, id: {} }
            }
          });
        } catch (error) {
          failures.push({ name: move.name, message: error.message });
        }
        done++;
        onProgress(done, plan.moveCount);
      }
    }
    return { done, failures, aborted: false };
  }

  // ─── Rendering ────────────────────────────────────────────────────────────

  function clear(el) {
    while (el.firstChild) el.removeChild(el.firstChild);
  }

  function addEl(parent, tag, className, text) {
    const el = document.createElement(tag);
    if (className) el.className = className;
    if (text !== undefined) el.textContent = text;
    parent.appendChild(el);
    return el;
  }

  function renderIdle(el) {
    clear(el);
    addEl(el, 'div', 'jt-autoseq-heading', 'Auto Sequence');
    addEl(el, 'div', 'jt-autoseq-note',
      'Re-orders the items inside each group to match their start dates. Items never leave their group, and dates are never changed.');
    const button = addEl(el, 'button', 'jt-autoseq-btn jt-autoseq-btn-primary', 'Auto Sequence');
    button.type = 'button';
    button.addEventListener('click', () => { void handleScan(el); });
  }

  function renderBusy(el, message) {
    clear(el);
    addEl(el, 'div', 'jt-autoseq-heading', 'Auto Sequence');
    addEl(el, 'div', 'jt-autoseq-note', message);
  }

  function renderMessage(el, message, isError) {
    clear(el);
    addEl(el, 'div', 'jt-autoseq-heading', 'Auto Sequence');
    addEl(el, 'div', isError ? 'jt-autoseq-error' : 'jt-autoseq-note', message);
    const again = addEl(el, 'button', 'jt-autoseq-btn', 'Start over');
    again.type = 'button';
    again.addEventListener('click', () => renderIdle(el));
  }

  function renderDone(el, result) {
    clear(el);
    addEl(el, 'div', 'jt-autoseq-heading', 'Auto Sequence');

    if (result.failures.length === 0) {
      addEl(el, 'div', 'jt-autoseq-note',
        `Resequenced ${result.done} item${result.done === 1 ? '' : 's'}. Reload to see the new order.`);
    } else {
      addEl(el, 'div', 'jt-autoseq-error',
        `${result.done - result.failures.length} of ${result.done} moved. ${result.failures.length} failed — reload and try again.`);
    }

    const reload = addEl(el, 'button', 'jt-autoseq-btn jt-autoseq-btn-primary', 'Reload schedule');
    reload.type = 'button';
    reload.addEventListener('click', () => window.location.reload());
  }

  function renderPreview(el, plan) {
    clear(el);
    addEl(el, 'div', 'jt-autoseq-heading', 'Auto Sequence');

    if (plan.moveCount === 0) {
      addEl(el, 'div', 'jt-autoseq-note', 'Every group is already in date order — nothing to do.');
      const again = addEl(el, 'button', 'jt-autoseq-btn', 'Check again');
      again.type = 'button';
      again.addEventListener('click', () => { void handleScan(el); });
      return;
    }

    addEl(el, 'div', 'jt-autoseq-note',
      `${plan.moveCount} item${plan.moveCount === 1 ? '' : 's'} will move in ` +
      `${plan.groups.length} group${plan.groups.length === 1 ? '' : 's'}.`);

    const list = addEl(el, 'div', 'jt-autoseq-list');
    for (const group of plan.groups) {
      const row = addEl(list, 'div', 'jt-autoseq-row');
      addEl(row, 'span', 'jt-autoseq-group', group.parentName);
      addEl(row, 'span', 'jt-autoseq-count', `${group.moves.length} of ${group.itemCount}`);
    }

    const actions = addEl(el, 'div', 'jt-autoseq-actions');
    const apply = addEl(actions, 'button', 'jt-autoseq-btn jt-autoseq-btn-primary', 'Apply');
    apply.type = 'button';
    apply.addEventListener('click', () => { void handleApply(el, plan); });

    const cancel = addEl(actions, 'button', 'jt-autoseq-btn', 'Cancel');
    cancel.type = 'button';
    cancel.addEventListener('click', () => renderIdle(el));
  }

  // ─── Actions ──────────────────────────────────────────────────────────────

  async function handleScan(el) {
    const jobId = getJobId();
    if (!jobId) {
      renderMessage(el, 'Open a job schedule to use Auto Sequence.', true);
      return;
    }

    renderBusy(el, 'Reading the schedule…');
    try {
      const tasks = await fetchTasks(jobId);
      if (!isActiveState) return;
      renderPreview(el, computeResequencePlan(tasks));
    } catch (error) {
      console.error('AutoSequence: Failed to read schedule:', error);
      if (!isActiveState) return;
      // Auto Sequence is free but reads and writes through the Pave API, so it
      // still needs a grant key. Say what to do instead of leaking the raw error.
      if (NO_KEY_RE.test(error.message || '')) {
        renderMessage(el, 'Auto Sequence needs a JobTread grant key. Add one in your JT Power Tools account at app.jtpowertools.com, then reload this page.', true);
        return;
      }
      renderMessage(el, `Could not read the schedule: ${error.message}`, true);
    }
  }

  async function handleApply(el, plan) {
    const token = {};
    runToken = token;
    renderBusy(el, `Resequencing 0 of ${plan.moveCount}…`);

    try {
      const result = await applyPlan(plan, token, (done, total) => {
        if (token !== runToken || !isActiveState) return;
        renderBusy(el, `Resequencing ${done} of ${total}…`);
      });
      if (result.aborted || !isActiveState) return;
      if (result.failures.length > 0) {
        console.error('AutoSequence: Some moves failed:', result.failures);
      }
      renderDone(el, result);
    } catch (error) {
      console.error('AutoSequence: Apply failed:', error);
      if (!isActiveState) return;
      renderMessage(el, `Resequence failed: ${error.message}`, true);
    } finally {
      if (runToken === token) runToken = null;
    }
  }

  // ─── Panel wiring ─────────────────────────────────────────────────────────

  function update() {
    if (!isActiveState || !isSchedulePage()) return;

    isUpdating = true;
    try {
      const contentArea = findPanelContentArea();
      if (!contentArea) {
        // Panel closed — drop our reference so the next open re-injects.
        container = null;
        return;
      }

      const existing = contentArea.querySelector(`.${CONTAINER_CLASS}`);
      if (existing) {
        container = existing;
        applyTheme(container);
        return;
      }

      container = document.createElement('div');
      container.className = CONTAINER_CLASS;
      applyTheme(container);
      renderIdle(container);

      const heading = Array.from(contentArea.children).find(
        (child) => MASS_ACTIONS_RE.test(child.textContent || '')
      );
      if (heading && heading.nextSibling) {
        contentArea.insertBefore(container, heading.nextSibling);
      } else if (heading) {
        contentArea.appendChild(container);
      } else {
        contentArea.insertBefore(container, contentArea.firstChild);
      }
    } finally {
      if (observer) observer.takeRecords();
      isUpdating = false;
    }
  }

  function scheduleUpdate() {
    clearTimeout(debounceTimer);
    debounceTimer = setTimeout(update, 80);
  }

  function handleClick() {
    if (!isSchedulePage()) return;
    // The panel opens asynchronously after a selection click.
    setTimeout(update, 50);
    setTimeout(update, 350);
  }

  function injectStyles() {
    styleElement = document.createElement('link');
    styleElement.rel = 'stylesheet';
    styleElement.href = chrome.runtime.getURL('styles/gantt-auto-sequencer.css');
    styleElement.id = 'jt-autoseq-styles';
    document.head.appendChild(styleElement);
  }

  // ─── Lifecycle ────────────────────────────────────────────────────────────

  function init() {
    if (isActiveState) return;
    isActiveState = true;
    console.log('AutoSequence: Initializing...');

    injectStyles();

    observer = new MutationObserver((mutations) => {
      if (isUpdating) return;
      if (container && mutations.every(
        (m) => m.target === container || container.contains(m.target)
      )) {
        return;
      }
      scheduleUpdate();
    });
    observer.observe(document.body, { childList: true, subtree: true });

    clickHandler = handleClick;
    document.addEventListener('click', clickHandler, true);

    scheduleUpdate();
    console.log('AutoSequence: Initialized');
  }

  function cleanup() {
    if (!isActiveState) return;
    console.log('AutoSequence: Cleaning up...');

    // Stops any in-flight write loop before the next mutation.
    runToken = null;

    if (observer) { observer.disconnect(); observer = null; }
    if (clickHandler) { document.removeEventListener('click', clickHandler, true); clickHandler = null; }
    clearTimeout(debounceTimer);
    debounceTimer = null;

    if (container && container.parentElement) container.remove();
    container = null;

    if (styleElement) { styleElement.remove(); styleElement = null; }

    isActiveState = false;
    console.log('AutoSequence: Cleaned up');
  }

  return {
    init,
    cleanup,
    isActive: () => isActiveState,
    // Exposed for unit tests (tests/features/gantt-auto-sequencer.test.js).
    _computeResequencePlan: computeResequencePlan
  };
})();

window.AutoSequenceFeature = AutoSequenceFeature;
