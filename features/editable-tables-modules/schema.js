/**
 * JT Power Tools - Editable Tables: Schema Resolver
 *
 * Answers one question for the Editable Tables feature: "in THIS saved Data
 * Browser view, which table columns are custom fields I'm allowed to write?"
 *
 * Why the Data View and not just the column headers: a header labelled
 * "Status" could be JobTread's native job status OR an org custom field of
 * the same name. Writing to the wrong one is a silent data corruption bug, so
 * a column is only ever considered editable when the view's own `fields`
 * array proves it renders a custom field value:
 *   ["withValue", "cfv:<CUSTOM_FIELD_ID>", "values"]
 * and the header text uniquely matches that custom field's name.
 *
 * Also owns the write: updateJob with a { fieldId: value } customFieldValues
 * map — the same mutation shape the MCP server's jt_job_write uses.
 *
 * @module EditableTablesSchema
 * @requires JobTreadAPI
 */
const EditableTablesSchema = (() => {
  // Entity types we can resolve a row → record id for, and write back to.
  // Extending to tasks/costItems means adding an href prefix + mutation here.
  const SUPPORTED_TYPES = {
    job: { hrefPrefix: '/jobs/', mutation: 'updateJob', resultKey: 'job' }
  };

  // Custom field types we deliberately refuse to edit inline. multipleText
  // holds many values per record — a single cell can't express that safely.
  const UNSUPPORTED_FIELD_TYPES = new Set(['multipleText']);

  // Resolved schemas by view id. Cleared on org change (see cleanup below).
  const schemaCache = new Map();

  /**
   * Read the saved-view id out of the URL (?view=22PRZaTnZTu2).
   * @returns {string|null}
   */
  function getViewIdFromUrl() {
    try {
      const value = new URLSearchParams(window.location.search).get('view');
      return value && /^[A-Za-z0-9]{6,32}$/.test(value) ? value : null;
    } catch (e) {
      return null;
    }
  }

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
   * Pull the custom field ids a view renders as columns.
   * `fields` entries look like { path: ["withValue", "cfv:ID", "values"] };
   * older captures store the bare array, so both shapes are accepted.
   * @param {Array} fields - dataView.fields
   * @returns {Set<string>} custom field ids
   */
  function extractCustomFieldIds(fields) {
    const ids = new Set();
    (fields || []).forEach((entry) => {
      const path = Array.isArray(entry) ? entry : (entry && entry.path);
      if (!Array.isArray(path)) return;
      const segment = path.find((p) => typeof p === 'string' && p.startsWith('cfv:'));
      if (segment) ids.add(segment.slice(4));
    });
    return ids;
  }

  /**
   * Fetch custom field definitions for an entity type. Jobs go through the
   * cached JobTreadAPI helper; other types query directly so the feature can
   * be widened later without touching the API service.
   * @param {string} targetType
   * @returns {Promise<Array>} [{ id, name, type, options }]
   */
  async function fetchCustomFields(targetType) {
    if (targetType === 'job') {
      return JobTreadAPI.fetchCustomFieldDefinitions();
    }
    const orgId = await JobTreadAPI.getOrgId();
    if (!orgId) throw new Error('Organization ID not resolved');
    const result = await JobTreadAPI.paveQuery({
      organization: {
        $: { id: orgId },
        customFields: {
          $: { where: ['targetType', '=', targetType], sortBy: [{ field: 'position' }] },
          nodes: { id: {}, name: {}, type: {}, targetType: {}, options: {} }
        }
      }
    });
    return result.organization?.customFields?.nodes || [];
  }

  /**
   * Resolve the editable-column schema for a saved view.
   * @param {string} viewId
   * @returns {Promise<Object|null>} { viewId, type, hrefPrefix, byLabel: Map<string, field>, supported }
   */
  async function load(viewId) {
    if (!viewId) return null;
    if (schemaCache.has(viewId)) return schemaCache.get(viewId);

    const data = await JobTreadAPI.paveQuery({
      dataView: { $: { id: viewId }, id: {}, name: {}, type: {}, fields: {} }
    });
    const view = data?.dataView;
    if (!view) return null;

    const support = SUPPORTED_TYPES[view.type];
    if (!support) {
      const unsupported = { viewId, type: view.type, supported: false, byLabel: new Map() };
      schemaCache.set(viewId, unsupported);
      return unsupported;
    }

    const cfvIds = extractCustomFieldIds(view.fields);
    const byLabel = new Map();

    if (cfvIds.size > 0) {
      const definitions = await fetchCustomFields(view.type);
      definitions.forEach((def) => {
        if (!cfvIds.has(def.id)) return;
        if (UNSUPPORTED_FIELD_TYPES.has(def.type)) return;
        const label = normalizeLabel(def.name);
        // A duplicate label is ambiguous — drop both rather than guess.
        if (byLabel.has(label)) {
          byLabel.set(label, null);
          return;
        }
        byLabel.set(label, {
          id: def.id,
          name: def.name,
          type: def.type,
          options: parseOptions(def.options)
        });
      });
      // Purge the ambiguous entries flagged above.
      Array.from(byLabel.keys()).forEach((key) => {
        if (!byLabel.get(key)) byLabel.delete(key);
      });
    }

    const schema = {
      viewId,
      type: view.type,
      name: view.name,
      supported: true,
      hrefPrefix: support.hrefPrefix,
      byLabel
    };
    schemaCache.set(viewId, schema);
    return schema;
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
   * Extract the record id from a table row via its link to the record.
   * @param {HTMLElement} row - <tr>
   * @param {string} hrefPrefix - e.g. '/jobs/'
   * @returns {string|null}
   */
  function getRecordId(row, hrefPrefix) {
    const link = row.querySelector(`a[href^="${hrefPrefix}"]`);
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
   * Drop cached schemas (org switch, feature cleanup).
   */
  function clearCache() {
    schemaCache.clear();
  }

  return {
    getViewIdFromUrl,
    normalizeLabel,
    load,
    getRecordId,
    writeValue,
    clearCache
  };
})();

if (typeof window !== 'undefined') {
  window.EditableTablesSchema = EditableTablesSchema;
}
