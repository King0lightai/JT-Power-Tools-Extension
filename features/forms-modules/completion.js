/**
 * FormsCompletion
 *
 * Answers "how much of this worksheet is actually filled in?" for the
 * Worksheets drawer — the list card's status pill, the footer's "8 of 10
 * answered" counter, and the decision of whether "Mark complete" should warn
 * about anything first.
 *
 * Kept apart from the renderers deliberately: the list view has to count a
 * worksheet it is not rendering, from nothing but the pinned schema and the
 * saved data blob.
 *
 * Two ideas that are easy to conflate:
 *
 *   ANSWERED   — derived, live, never stored. Every answerable field has a
 *                value. A worksheet can go from answered back to unanswered
 *                the moment someone clears a field.
 *   COMPLETE   — stored on the instance (form_instances.status), only ever
 *                set by someone clicking "Mark complete", and it LOCKS the
 *                worksheet. Fully answered does NOT set it: locking a user
 *                out the instant they typed the last answer would be worse
 *                than the stale "In progress" it fixes.
 *
 * `section` fields are headings, not questions, so they never count toward
 * either number.
 *
 * Public surface:
 *   FormsCompletion.isAnswerable(field)       → boolean
 *   FormsCompletion.isAnswered(field, value)  → boolean
 *   FormsCompletion.summarize(schema, data)   → { total, answered, unanswered,
 *                                                 allAnswered, requiredUnanswered,
 *                                                 started }
 *   FormsCompletion.STATUS_IN_PROGRESS / STATUS_COMPLETE
 *   FormsCompletion.statusOf(instance)        → 'in_progress' | 'complete'
 *   FormsCompletion.isComplete(instance)      → boolean
 */
const FormsCompletion = (() => {
  const STATUS_IN_PROGRESS = 'in_progress';
  const STATUS_COMPLETE = 'complete';

  /**
   * Is this field a question at all? Sections are headings.
   * @param {Object} field
   * @returns {boolean}
   */
  function isAnswerable(field) {
    return !!(field && typeof field === 'object' && field.type && field.type !== 'section');
  }

  function hasText(value) {
    return typeof value === 'string' && value.trim().length > 0;
  }

  /**
   * Checkbox / radio values are { selections, fills }. A selection whose
   * option declares a fill-in ("Other ___") isn't an answer until the blank
   * is filled — an empty "Other" tells the next reader nothing.
   */
  function isSelectionAnswered(field, value) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
    const selections = Array.isArray(value.selections) ? value.selections : [];
    if (selections.length === 0) return false;

    const fills = (value.fills && typeof value.fills === 'object' && !Array.isArray(value.fills))
      ? value.fills
      : {};
    const options = Array.isArray(field.options) ? field.options : [];
    for (const selected of selections) {
      const option = options.find(o => o && o.value === selected);
      if (option && option.fillIn && !hasText(fills[selected])) return false;
    }
    return true;
  }

  /**
   * Does this field hold a value a reader would call an answer?
   * @param {Object} field
   * @param {*} value
   * @returns {boolean}
   */
  function isAnswered(field, value) {
    if (!isAnswerable(field)) return false;
    switch (field.type) {
      case 'text_short':
      case 'text_long':
      case 'date':
        return hasText(value);
      case 'checkboxes':
      case 'radio':
        return isSelectionAnswered(field, value);
      case 'signature':
        return !!(value && typeof value === 'object' && hasText(value.dataUrl));
      default:
        // An unknown field type still renders something, so treat any
        // non-empty value as an answer rather than pinning the worksheet
        // permanently below 100%.
        if (value == null) return false;
        if (typeof value === 'string') return hasText(value);
        if (Array.isArray(value)) return value.length > 0;
        if (typeof value === 'object') return Object.keys(value).length > 0;
        return true;
    }
  }

  /**
   * Count the questions and the answers.
   *
   * @param {Object|null} schema - the pinned schema, with `.fields`
   * @param {Object|null} data - instance data keyed by field id
   * @returns {{ total: number, answered: number, unanswered: number,
   *             allAnswered: boolean, requiredUnanswered: number,
   *             started: boolean }}
   */
  function summarize(schema, data) {
    const fields = (schema && Array.isArray(schema.fields)) ? schema.fields : [];
    const values = (data && typeof data === 'object') ? data : {};

    let total = 0;
    let answered = 0;
    let requiredUnanswered = 0;

    for (const field of fields) {
      if (!isAnswerable(field)) continue;
      total++;
      if (isAnswered(field, values[field.id])) {
        answered++;
      } else if (field.required) {
        requiredUnanswered++;
      }
    }

    return {
      total,
      answered,
      unanswered: total - answered,
      // A worksheet with no questions at all is not "all answered" — calling
      // an empty template complete would be a lie on the list card.
      allAnswered: total > 0 && answered === total,
      requiredUnanswered,
      started: answered > 0,
    };
  }

  /**
   * The stored lifecycle status of an instance. Tolerates a server that
   * predates Migration 057 (no status field) by reading as in progress.
   * @param {Object|null} instance
   * @returns {string}
   */
  function statusOf(instance) {
    return (instance && instance.status === STATUS_COMPLETE)
      ? STATUS_COMPLETE
      : STATUS_IN_PROGRESS;
  }

  /**
   * @param {Object|null} instance
   * @returns {boolean}
   */
  function isComplete(instance) {
    return statusOf(instance) === STATUS_COMPLETE;
  }

  return {
    STATUS_IN_PROGRESS,
    STATUS_COMPLETE,
    isAnswerable,
    isAnswered,
    summarize,
    statusOf,
    isComplete,
  };
})();

if (typeof window !== 'undefined') {
  window.FormsCompletion = FormsCompletion;
}
