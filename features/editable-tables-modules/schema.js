/**
 * JT Power Tools - Editable Tables: Schema Resolver
 *
 * Answers one question for the Editable Tables feature: "in the Data Browser
 * grid on screen right now, which columns are custom fields I'm allowed to
 * write, and at which position?"
 *
 * Why the Data View and not just the column headers: a header labelled
 * "Status" could be JobTread's native job status OR an org custom field of the
 * same name (Titus has exactly this). Writing to the wrong one is a silent data
 * corruption bug, so a column is only ever editable when some saved view's own
 * `fields` array proves that position renders a custom field value:
 *   { path: ["withValue", "cfv:<CUSTOM_FIELD_ID>", "values"] }
 * and that field's name matches the header rendered at the same position.
 *
 * Finding the active view: JobTread does NOT put the view in the URL. `/jobs`
 * renders whichever saved view is selected (the user's `defaultJobDataView`, or
 * whatever they picked from the dropdown), and that selection appears in no
 * URL, localStorage entry or history state. So the view is identified by
 * fingerprint instead: the one job view whose `fields` array lines up, position
 * for position, with the headers actually on screen. That match is also what
 * proves the positional mapping is safe to write through.
 *
 * Also owns the write: updateJob with a { fieldId: value } customFieldValues
 * map - the same mutation shape the MCP server's jt_job_write uses.
 *
 * @module EditableTablesSchema
 * @requires JobTreadAPI
 */
const EditableTablesSchema = (() => {
  // Entity types we can resolve a row into a record id for, and write back to.
  // Extending to tasks/costItems means adding an href prefix + mutation here.
  const SUPPORTED_TYPES = {
    job: { hrefPrefix: '/jobs/', mutation: 'updateJob', resultKey: 'job' }
  };

  // Custom field types we deliberately refuse to edit inline. multipleText
  // holds many values per record, and a single cell can't express that safely.
  const UNSUPPORTED_FIELD_TYPES = new Set(['multipleText']);

  // Job data views for the current org, and the resolutions already
  // fingerprinted. Both cleared on org change (see clearCache).
  let viewsPromise = null;
  const resolutionCache = new Map();

  /**
   * Normalize a column header / field name for comparison. JobTread renders
   * sort indicators and non-breaking spaces into header cells.
   * @param {string} text
   * @returns {string}
   */
  function normalizeLabel(text) {
    return String(text || '')
      .replace(/[▲▼↑↓ ]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
      .toLowerCase();
  }

  /**
   * The custom field id a data view field renders, if any.
   * `fields` entries look like { path: ["withValue", "cfv:ID", "values"] };
   * older captures store the bare array, so both shapes are accepted.
   * @param {Object|Array} entry - one dataView.fields entry
   * @returns {string|null}
   */
  function customFieldIdOf(entry) {
    const path = Array.isArray(entry) ? entry : (entry && entry.path);
    if (!Array.isArray(path)) return null;
    const segment = path.find((p) => typeof p === 'string' && p.startsWith('cfv:'));
    return segment ? segment.slice(4) : null;
  }

  /**
   * Every saved job data view in the org, with its ordered field list.
   * @returns {Promise<Array>}
   */
  function loadJobDataViews() {
    if (viewsPromise) return viewsPromise;
    viewsPromise = (async () => {
      const orgId = await JobTreadAPI.getOrgId();
      if (!orgId) throw new Error('Organization ID not resolved');
      const result = await JobTreadAPI.paveQuery({
        organization: {
          $: { id: orgId },
          dataViews: {
            $: { size: 100, where: ['type', 'job'] },
            nodes: { id: {}, name: {}, type: {}, fields: {} }
          }
        }
      });
      return result.organization?.dataViews?.nodes || [];
    })();
    // A failed fetch must not poison the cache for the rest of the session.
    viewsPromise.catch(() => { viewsPromise = null; });
    return viewsPromise;
  }

  /**
   * Custom field `options` arrive as an array of strings, but older orgs have
   * them JSON-encoded. Normalize to an array; [] means "free text".
   * @param {Array|string} options
   * @returns {Array<string>}
   */
  function parseOptions(options) {
    if (Array.isArray(options)) return options.filter((o) => typeof o === 'string');
    if (typeof options === 'string' && options.trim()) {
      try {
        const parsed = JSON.parse(options);
        return Array.isArray(parsed) ? parsed.filter((o) => typeof o === 'string') : [];
      } catch (e) {
        return [];
      }
    }
    return [];
  }

  /**
   * Try to line one saved view up against the headers on screen.
   *
   * Every custom field column the view claims must carry that field's exact
   * name at that exact position, or the view isn't what's rendered and it is
   * refused outright. Columns that can't be verified (a field definition we
   * can't see, a type we won't edit) are simply left out - they still occupy
   * their position, so the surviving indices stay aligned.
   *
   * @param {Object} view - { id, name, fields }
   * @param {Array<string>} labels - normalized header labels, in render order
   * @param {Map<string, Object>} definitions - custom field defs by id
   * @param {Array<string>} [skipped] - collects human-readable reasons a column
   *   was left out, so "why isn't this column editable?" has an answer
   * @returns {Map<number, Object>|null} index to field, or null if not this view
   */
  function matchView(view, labels, definitions, skipped = []) {
    const fields = view.fields || [];
    if (fields.length !== labels.length) return null;

    const byIndex = new Map();
    for (let index = 0; index < fields.length; index++) {
      const fieldId = customFieldIdOf(fields[index]);
      if (!fieldId) continue;

      const definition = definitions.get(fieldId);
      // No definition means the label can't be verified, so the column has to
      // be left alone. It usually means the custom fields cache predates the
      // field (it refreshes hourly) or the grant key can't see it.
      if (!definition) {
        skipped.push(`column ${index + 1} (cfv:${fieldId}): no custom field definition found`);
        continue;
      }
      if (UNSUPPORTED_FIELD_TYPES.has(definition.type)) {
        skipped.push(`${definition.name}: ${definition.type} fields are not editable inline`);
        continue;
      }

      // The proof: this view says position N is custom field X, and position N
      // on screen is titled X. Anything else means a different view is
      // rendered, so nothing from this one can be trusted.
      if (normalizeLabel(definition.name) !== labels[index]) return null;

      byIndex.set(index, {
        id: definition.id,
        name: definition.name,
        type: definition.type,
        options: parseOptions(definition.options)
      });
    }
    return byIndex;
  }

  /**
   * @param {Map<number, Object>} a
   * @param {Map<number, Object>} b
   * @returns {boolean} true when both maps write the same field at every index
   */
  function sameMapping(a, b) {
    if (a.size !== b.size) return false;
    for (const [index, field] of a) {
      if (b.get(index)?.id !== field.id) return false;
    }
    return true;
  }

  /**
   * Resolve the editable columns for a grid, given the headers it renders.
   *
   * Cached (and de-duplicated) by header fingerprint: a MutationObserver fires
   * this on every re-render, and the answer only changes when the columns do.
   *
   * @param {Array<string>} labels - header labels in render order
   * @returns {Promise<Object|null>} { type, hrefPrefix, byIndex } or null
   */
  function resolve(labels) {
    if (!Array.isArray(labels) || labels.length === 0) return Promise.resolve(null);

    const normalized = labels.map(normalizeLabel);
    const cacheKey = normalized.join(' | ');
    if (resolutionCache.has(cacheKey)) return resolutionCache.get(cacheKey);

    const promise = computeResolution(normalized);
    resolutionCache.set(cacheKey, promise);
    // Don't cache a network failure - the next re-render should retry.
    promise.catch(() => resolutionCache.delete(cacheKey));
    return promise;
  }

  /**
   * @param {Array<string>} labels - normalized header labels
   * @returns {Promise<Object|null>}
   */
  async function computeResolution(labels) {
    const [views, definitionList] = await Promise.all([
      loadJobDataViews(),
      JobTreadAPI.fetchCustomFieldDefinitions()
    ]);
    const definitions = new Map((definitionList || []).map((d) => [d.id, d]));

    const candidates = [];
    views.forEach((view) => {
      const skipped = [];
      const byIndex = matchView(view, labels, definitions, skipped);
      if (byIndex && byIndex.size > 0) candidates.push({ view, byIndex, skipped });
    });

    if (candidates.length === 0) {
      // Silence here is what made this feature look installed-but-dead, so say
      // which columns were on screen and that none of them could be proven.
      console.log(
        `EditableTables: No saved job view matches these ${labels.length} columns ` +
        `[${labels.join(', ')}], so nothing here is editable. A renamed or ` +
        'reordered column, or a view you cannot read, will do this.'
      );
      return null;
    }

    // Several views can share a column layout (a filtered copy of the same
    // view), which is harmless while they agree on every field. If they
    // disagree, which view is on screen is genuinely unknown, and guessing
    // would write the value into whichever field we happened to pick.
    const [first, ...rest] = candidates;
    if (rest.some((c) => !sameMapping(c.byIndex, first.byIndex))) {
      console.warn(
        'EditableTables: More than one saved view matches these columns with ' +
        'different fields, so inline editing is off for this grid'
      );
      return null;
    }

    const editable = [...first.byIndex.values()].map((f) => f.name).join(', ');
    console.log(`EditableTables: "${first.view.name}" - editable columns: ${editable}`);
    if (first.skipped.length > 0) {
      console.warn(`EditableTables: columns left read-only - ${first.skipped.join('; ')}`);
    }

    return {
      viewId: first.view.id,
      name: first.view.name,
      type: 'job',
      hrefPrefix: SUPPORTED_TYPES.job.hrefPrefix,
      byIndex: first.byIndex
    };
  }

  /**
   * Extract the record id from a grid row.
   *
   * The row itself is the link to the record (`<a href="/jobs/ID">` wrapping
   * the cells), so check the row before looking inside it - a descendant
   * lookup can never match the element it starts from.
   *
   * @param {HTMLElement} row
   * @param {string} hrefPrefix - e.g. '/jobs/'
   * @returns {string|null}
   */
  function getRecordId(row, hrefPrefix) {
    if (!row) return null;
    const selector = `a[href^="${hrefPrefix}"]`;
    const link = (row.matches && row.matches(selector)) ? row : row.querySelector(selector);
    if (!link) return null;
    const rest = link.getAttribute('href').slice(hrefPrefix.length);
    const id = rest.split(/[/?#]/)[0];
    return /^[A-Za-z0-9]{6,32}$/.test(id) ? id : null;
  }

  /**
   * Write one custom field value back to JobTread and return the value the
   * server actually stored (so the cell shows truth, not our optimism).
   * @param {Object} args
   * @param {string} args.type - Entity type ('job')
   * @param {string} args.recordId
   * @param {string} args.fieldId
   * @param {string} args.value
   * @returns {Promise<string>} stored value
   */
  async function writeValue({ type, recordId, fieldId, value }) {
    const support = SUPPORTED_TYPES[type];
    if (!support) throw new Error(`Editing ${type} records is not supported yet`);

    const result = await JobTreadAPI.paveQuery({
      [support.mutation]: {
        $: { id: recordId, customFieldValues: { [fieldId]: value } },
        [support.resultKey]: {
          $: { id: recordId },
          id: {},
          customFieldValues: {
            $: { size: 100 },
            nodes: { value: {}, customField: { id: {} } }
          }
        }
      }
    });

    const record = result?.[support.mutation]?.[support.resultKey];
    if (!record) throw new Error('JobTread did not confirm the update');

    const stored = (record.customFieldValues?.nodes || [])
      .find((node) => node.customField?.id === fieldId);
    return stored ? (stored.value ?? '') : value;
  }

  /**
   * Drop cached views and resolutions (org switch, feature cleanup).
   */
  function clearCache() {
    viewsPromise = null;
    resolutionCache.clear();
  }

  return {
    normalizeLabel,
    resolve,
    getRecordId,
    writeValue,
    clearCache
  };
})();

if (typeof window !== 'undefined') {
  window.EditableTablesSchema = EditableTablesSchema;
}
