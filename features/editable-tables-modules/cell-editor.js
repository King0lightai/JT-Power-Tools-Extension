/**
 * JT Power Tools - Editable Tables: Cell Editor
 *
 * The inline editor that floats over a table cell. It never replaces
 * JobTread's own cell markup while open — the input is an overlay anchored to
 * the cell's rect — because the table is React-rendered and would fight us for
 * ownership of the cell's children.
 *
 * Commit rules: Enter or blur saves, Escape cancels, Tab saves and steps to
 * the next editable cell. A save is optimistic in the DOM only; the value
 * written into the cell afterwards is the one JobTread echoed back.
 *
 * @module EditableTablesEditor
 * @requires EditableTablesSchema, Sanitizer
 */
const EditableTablesEditor = (() => {
  let overlay = null;      // the floating editor container
  let control = null;      // <input> or <select> inside it
  let session = null;      // { cell, field, recordId, type, original, onNavigate }
  let saving = false;
  let repositionHandler = null;

  const OVERLAY_ID = 'jt-et-editor';

  // ─── PUBLIC ──────────────────────────────────────────────────

  /**
   * Open the editor over a cell.
   * @param {Object} args
   * @param {HTMLElement} args.cell - the <td>
   * @param {Object} args.field - { id, name, type, options }
   * @param {string} args.recordId
   * @param {string} args.type - entity type ('job')
   * @param {Function} [args.onNavigate] - (direction) => void, called after a
   *   Tab commit with 1 (forward) or -1 (backward)
   */
  function open({ cell, field, recordId, type, onNavigate }) {
    close();
    if (!cell || !field) return;

    session = { cell, field, recordId, type, original: '', onNavigate };

    overlay = document.createElement('div');
    overlay.id = OVERLAY_ID;
    // Deliberately NOT .jt-tools-surface: those tokens are dark-only (they
    // mirror the popup's dark theme) and would force near-white text onto this
    // surface, which follows the page instead. See editable-tables.css.
    overlay.className = 'jt-et-editor';

    control = buildControl(field, readCellText(cell));
    // Compare against what the control actually accepted, not what the cell
    // displayed. A number input silently rejects "150,000" and a date input
    // rejects "Fri, Sep 11", leaving the control empty - and an empty commit
    // would erase the value the user only meant to look at.
    session.original = control.value;
    overlay.appendChild(control);

    const hint = document.createElement('div');
    hint.className = 'jt-et-hint';
    hint.textContent = `${field.name} · Enter saves · Esc cancels`;
    overlay.appendChild(hint);

    document.body.appendChild(overlay);
    position();

    control.addEventListener('keydown', onKeyDown);
    control.addEventListener('blur', onBlur);
    if (control.tagName === 'SELECT') control.addEventListener('change', () => commit());

    repositionHandler = () => position();
    window.addEventListener('scroll', repositionHandler, true);
    window.addEventListener('resize', repositionHandler);

    control.focus();
    if (control.select) control.select();
  }

  /**
   * Close without saving.
   */
  function close() {
    if (repositionHandler) {
      window.removeEventListener('scroll', repositionHandler, true);
      window.removeEventListener('resize', repositionHandler);
      repositionHandler = null;
    }
    if (overlay && overlay.parentNode) overlay.parentNode.removeChild(overlay);
    overlay = null;
    control = null;
    session = null;
    saving = false;
  }

  function isOpen() {
    return !!overlay;
  }

  /**
   * The cell currently being edited, if any.
   * @returns {HTMLElement|null}
   */
  function activeCell() {
    return session ? session.cell : null;
  }

  /**
   * Tear down everything this module owns (feature cleanup).
   */
  function destroy() {
    close();
  }

  // ─── CONTROL CONSTRUCTION ────────────────────────────────────

  /**
   * Build the right input for a custom field. Options-backed fields get a
   * dropdown; everything else falls back to a text input, which JobTread
   * stores as a string regardless of the field's declared type.
   * @param {Object} field
   * @param {string} value
   * @returns {HTMLElement}
   */
  function buildControl(field, value) {
    if (field.options && field.options.length > 0) {
      const select = document.createElement('select');
      select.className = 'jt-et-input';
      const blank = document.createElement('option');
      blank.value = '';
      blank.textContent = '— none —';
      select.appendChild(blank);
      field.options.forEach((option) => {
        const el = document.createElement('option');
        el.value = option;
        el.textContent = option;
        select.appendChild(el);
      });
      // A stored value that's no longer a configured option still needs to
      // show, or saving would silently rewrite it.
      if (value && !field.options.includes(value)) {
        const orphan = document.createElement('option');
        orphan.value = value;
        orphan.textContent = `${value} (not in list)`;
        select.appendChild(orphan);
      }
      select.value = value || '';
      return select;
    }

    const input = document.createElement('input');
    input.className = 'jt-et-input';
    input.type = inputTypeFor(field.type);
    input.value = normalizeForInput(input.type, value);
    return input;
  }

  /**
   * Coerce a rendered cell value into something the control will accept.
   * JobTread renders numbers with thousands separators and currency symbols
   * ("150,000", "$3,750.00"), all of which a number input discards.
   * @param {string} inputType
   * @param {string} value
   * @returns {string}
   */
  function normalizeForInput(inputType, value) {
    const text = String(value || '').trim();
    if (!text) return '';
    if (inputType === 'number') return text.replace(/[^\d.-]/g, '');
    return text;
  }

  /**
   * Map a JobTread custom field type onto an HTML input type. Unknown types
   * fall through to text — the value is a string on the wire either way.
   * @param {string} fieldType
   * @returns {string}
   */
  function inputTypeFor(fieldType) {
    const type = String(fieldType || '').toLowerCase();
    if (type.includes('date')) return 'date';
    if (type.includes('number') || type.includes('currency') || type.includes('percent')) return 'number';
    if (type.includes('email')) return 'email';
    if (type.includes('phone')) return 'tel';
    return 'text';
  }

  // ─── POSITIONING ─────────────────────────────────────────────

  function position() {
    if (!overlay || !session) return;
    const rect = session.cell.getBoundingClientRect();
    // The cell scrolled out of the viewport — the editor would float over
    // unrelated content, so stop editing rather than mislead.
    if (rect.bottom < 0 || rect.top > window.innerHeight) {
      close();
      return;
    }
    const width = Math.max(rect.width, 180);
    const left = Math.min(Math.max(rect.left, 4), window.innerWidth - width - 4);
    overlay.style.top = `${rect.top}px`;
    overlay.style.left = `${left}px`;
    overlay.style.minWidth = `${width}px`;
  }

  // ─── EVENTS ──────────────────────────────────────────────────

  function onKeyDown(event) {
    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      close();
      return;
    }
    if (event.key === 'Enter') {
      event.preventDefault();
      event.stopPropagation();
      commit();
      return;
    }
    if (event.key === 'Tab') {
      event.preventDefault();
      event.stopPropagation();
      const direction = event.shiftKey ? -1 : 1;
      const navigate = session && session.onNavigate;
      commit().then(() => {
        if (navigate) navigate(direction);
      });
    }
  }

  function onBlur() {
    // A blur caused by our own save (or by clicking inside the overlay) must
    // not double-commit or cancel the in-flight write.
    if (saving) return;
    if (overlay && overlay.contains(document.activeElement)) return;
    commit();
  }

  // ─── COMMIT ──────────────────────────────────────────────────

  /**
   * Save the current value. Resolves once the write settles (or immediately
   * when there's nothing to write).
   * @returns {Promise<void>}
   */
  async function commit() {
    if (!session || saving) return;
    const { cell, field, recordId, type, original } = session;
    const value = control ? control.value : '';

    if (value === original) {
      close();
      return;
    }

    saving = true;
    overlay.classList.add('jt-et-saving');
    if (control) control.disabled = true;

    try {
      const stored = await EditableTablesSchema.writeValue({
        type,
        recordId,
        fieldId: field.id,
        value
      });
      close();
      applyCellValue(cell, stored);
      flashCell(cell, 'saved');
      showToast(`${field.name} saved`, 'success');
    } catch (error) {
      close();
      flashCell(cell, 'failed');
      showToast(`${field.name} not saved — ${errorText(error)}`, 'error');
      console.error('EditableTables: Save failed:', error);
    }
  }

  /**
   * Keep JobTread's own error text but never let a long payload blow out the
   * toast (grant keys are never included in Pave error bodies, but truncating
   * keeps anything unexpected out of view too).
   * @param {Error} error
   * @returns {string}
   */
  function errorText(error) {
    const message = (error && error.message) ? String(error.message) : 'unknown error';
    return message.length > 120 ? `${message.slice(0, 120)}…` : message;
  }

  // ─── CELL RENDERING ──────────────────────────────────────────

  /**
   * Read a cell's value, ignoring the edit affordance we injected.
   * @param {HTMLElement} cell
   * @returns {string}
   */
  function readCellText(cell) {
    // A date renders as <time datetime="2026-09-11">Fri, Sep 11</time>. The ISO
    // attribute is both what a date input needs and what JobTread stores; the
    // visible text is a display format only.
    const time = cell.querySelector('time[datetime]');
    if (time) return time.getAttribute('datetime');

    const clone = cell.cloneNode(true);
    clone.querySelectorAll('.jt-et-edit').forEach((el) => el.remove());
    return clone.textContent.replace(/\s+/g, ' ').trim();
  }

  /**
   * Paint the saved value into the cell. Text node only — never innerHTML.
   * React owns this cell and will re-render its own version on the next data
   * fetch; this just keeps the table honest until then.
   * @param {HTMLElement} cell
   * @param {string} value
   */
  function applyCellValue(cell, value) {
    const button = cell.querySelector('.jt-et-edit');
    Array.from(cell.childNodes).forEach((node) => {
      if (node !== button) cell.removeChild(node);
    });
    cell.insertBefore(document.createTextNode(value), button || null);
  }

  /**
   * Green (saved) or red (failed) flash on the cell.
   * @param {HTMLElement} cell
   * @param {string} state - 'saved' | 'failed'
   */
  function flashCell(cell, state) {
    const className = `jt-et-flash-${state}`;
    cell.classList.remove('jt-et-flash-saved', 'jt-et-flash-failed');
    // Force a reflow so a repeated save on the same cell replays the flash.
    void cell.offsetWidth;
    cell.classList.add(className);
    setTimeout(() => cell.classList.remove(className), 1200);
  }

  // ─── TOAST ───────────────────────────────────────────────────

  /**
   * @param {string} message
   * @param {string} kind - 'success' | 'error'
   */
  function showToast(message, kind) {
    window.JTToast.show(message, { kind });
  }

  return {
    open,
    close,
    isOpen,
    activeCell,
    destroy
  };
})();

if (typeof window !== 'undefined') {
  window.EditableTablesEditor = EditableTablesEditor;
}
