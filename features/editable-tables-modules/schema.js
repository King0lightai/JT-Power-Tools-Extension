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
 * fingerprint instead: the one view whose `fields` array lines up, position
 * for position, with the headers actually on screen. That match is also what
 * proves the positional mapping is safe to write through.
 *
 * Entity scope: jobs, customers, vendors and locations. JobTread names a data
 * view's type and a custom field's targetType with the same word for all four,
 * so one key in SUPPORTED_TYPES drives view lookup, field lookup, row href
 * matching and the write mutation. Which entity a grid holds comes from the
 * row links (the row IS the `<a href="/customers/ID">`), and the matched view
 * must be of that same type — a customer view can never map a vendor grid.
 *
 * Also owns the write: updateJob / updateAccount / updateLocation with a
 * { fieldId: value } customFieldValues map - the same mutation shape the MCP
 * server's write tools use.
 *
 * @module EditableTablesSchema
 * @requires JobTreadAPI
 */
const EditableTablesSchema = (() => {
  // Entity types we can resolve a row into a record id for, and write back to.
  //
  // The key is simultaneously the data view `type`, the custom field
  // `targetType`, and our own name for the entity — JobTread uses the same
  // word for all three. Customers and vendors are both Pave `Account`s, so
  // they share updateAccount and differ only in their route and field set.
  //
  // `idPattern` is matched against the row's href. Jobs, customers and
  // vendors are anchored at the start of the path; locations are not,
  // because JobTread reaches a location both directly and nested under the
  // account that owns it.
  const SUPPORTED_TYPES = {
    job: {
      hrefPrefix: '/jobs/',
      idPattern: /^\/jobs\/([A-Za-z0-9]{6,32})(?:[/?#]|$)/,
      mutation: 'updateJob',
      resultKey: 'job'
    },
    customer: {
      hrefPrefix: '/customers/',
      idPattern: /^\/customers\/([A-Za-z0-9]{6,32})(?:[/?#]|$)/,
      mutation: 'updateAccount',
      resultKey: 'account'
    },
    vendor: {
      hrefPrefix: '/vendors/',
      idPattern: /^\/vendors\/([A-Za-z0-9]{6,32})(?:[/?#]|$)/,
      mutation: 'updateAccount',
      resultKey: 'account'
    },
    location: {
      hrefPrefix: '/locations/',
      idPattern: /\/locations\/([A-Za-z0-9]{6,32})(?:[/?#]|$)/,
      mutation: 'updateLocation',
      resultKey: 'location'
    }
  };

  const TYPE_KEYS = Object.keys(SUPPORTED_TYPES);

  // Custom field types we deliberately refuse to edit inline. multipleText
  // holds many values per record, and a single cell can't express that safely.
  const UNSUPPORTED_FIELD_TYPES = new Set(['multipleText']);

  // Saved data views for the current org (all supported types), the custom
  // field definitions per targetType, and the resolutions already
  // fingerprinted. All cleared on org change (see clearCache).
  let viewsPromise = null;
  const definitionsPromises = new Map();
  const resolutionCache = new Map();

  /**
   * Normalize a column header / field name for comparison. JobTread renders
   * sort indicators and non-breaking spaces into header cells.
   * @param {string} text
   * @returns {string}
   */
  function normalizeLabel(text) {
    return String(text || '')
      .replace(/[▲▼↑↓ ]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
      .toLowerCase();
  }

  /**
   * The entity types a row href could belong to, most specific first. A row
   * is a link to its record, so the route names the entity — except that a
   * location can hang off an account's route, which is why a customer or
   * vendor href also admits `location` as a candidate. The saved view that
   * matches the headers picks between them.
   * @param {HTMLElement} row
   * @returns {Array<string>}
   */
  function candidateTypes(row) {
    const href = (row && row.getAttribute) ? (row.getAttribute('href') || '') : '';
    if (!href) return [];
    const types = TYPE_KEYS.filter((type) => SUPPORTED_TYPES[type].idPattern.test(href));
    // Anchored matches come first so a plain /customers/ID row resolves as a
    // customer before the unanchored location pattern is ever considered.
    return types.sort((a, b) => href.indexOf(SUPPORTED_TYPES[a].hrefPrefix) - href.indexOf(SUPPORTED_TYPES[b].hrefPrefix));
  }

  /**
   * CSS selector matching a row of any supported entity type.
   * @returns {string}
   */
  function rowSelector() {
    return TYPE_KEYS.map((type) => `a[href^="${SUPPORTED_TYPES[type].hrefPrefix}"]`).join(', ');
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
   * Every saved data view in the org that we could ever edit through, grouped
   * by entity type.
   *
   * Pave pages at 100, and an org outgrows that (Titus has ~95 views across
   * every type, jobs alone being a third of them), so the cursor is followed
   * to the end. Filtering by type happens here rather than in the query: one
   * paged fetch serves all four types instead of four.
   *
   * @returns {Promise<Object>} { [type]: Array<view> }
   */
  function loadDataViews() {
    if (viewsPromise) return viewsPromise;
    viewsPromise = (async () => {
      const orgId = await JobTreadAPI.getOrgId();
      if (!orgId) throw new Error('Organization ID not resolved');

      const byType = {};
      TYPE_KEYS.forEach((type) => { byType[type] = []; });

      let page;
      // Bounded so a server that always returns a cursor can't spin forever.
      for (let request = 0; request < 20; request++) {
        const args = { size: 100 };
        if (page) args.page = page;
        const result = await JobTreadAPI.paveQuery({
          organization: {
            $: { id: orgId },
            dataViews: {
              $: args,
              nextPage: {},
              nodes: { id: {}, name: {}, type: {}, fields: {} }
            }
          }
        });
        const connection = result.organization?.dataViews;
        (connection?.nodes || []).forEach((view) => {
          if (view && byType[view.type]) byType[view.type].push(view);
        });
        page = connection?.nextPage;
        if (!page) break;
      }
      return byType;
    })();
    // A failed fetch must not poison the cache for the rest of the session.
    viewsPromise.catch(() => { viewsPromise = null; });
    return viewsPromise;
  }

  /**
   * Custom field definitions for one entity type, keyed by id. Fetched (and
   * cached) per type so a customer grid never checks its headers against job
   * fields.
   * @param {string} type
   * @returns {Promise<Map<string, Object>>}
   */
  function loadDefinitions(type) {
    if (definitionsPromises.has(type)) return definitionsPromises.get(type);
    const promise = (async () => {
      const list = await JobTreadAPI.fetchCustomFieldsByTarget(type);
      return new Map((list || []).map((d) => [d.id, d]));
    })();
    definitionsPromises.set(type, promise);
    promise.catch(() => definitionsPromises.delete(type));
    return promise;
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
   * Resolve the editable columns for a grid, given the headers it renders and
   * the entity types its rows could belong to.
   *
   * Cached (and de-duplicated) by header fingerprint + types: a
   * MutationObserver fires this on every re-render, and the answer only
   * changes when the columns do.
   *
   * @param {Array<string>} labels - header labels in render order
   * @param {Array<string>|string} [types] - candidate entity types; defaults to all
   * @returns {Promise<Object|null>} { type, viewId, name, byIndex } or null
   */
  function resolve(labels, types) {
    if (!Array.isArray(labels) || labels.length === 0) return Promise.resolve(null);

    const wanted = normalizeTypes(types);
    if (wanted.length === 0) return Promise.resolve(null);

    const normalized = labels.map(normalizeLabel);
    const cacheKey = wanted.join('+') + ' :: ' + normalized.join(' | ');
    if (resolutionCache.has(cacheKey)) return resolutionCache.get(cacheKey);

    const promise = computeResolution(normalized, wanted);
    resolutionCache.set(cacheKey, promise);
    // Don't cache a network failure - the next re-render should retry.
    promise.catch(() => resolutionCache.delete(cacheKey));
    return promise;
  }

  /**
   * @param {Array<string>|string|undefined} types
   * @returns {Array<string>} supported types, in SUPPORTED_TYPES order
   */
  function normalizeTypes(types) {
    if (types === undefined || types === null) return TYPE_KEYS.slice();
    const list = Array.isArray(types) ? types : [types];
    return TYPE_KEYS.filter((type) => list.indexOf(type) !== -1);
  }

  /**
   * @param {Array<string>} labels - normalized header labels
   * @param {Array<string>} types - candidate entity types
   * @returns {Promise<Object|null>}
   */
  async function computeResolution(labels, types) {
    const viewsByType = await loadDataViews();

    // Only the types that actually have a view of the right width are worth
    // fetching field definitions for - the others cannot match anyway.
    const worthChecking = types.filter((type) =>
      (viewsByType[type] || []).some((view) => (view.fields || []).length === labels.length));

    const candidates = [];
    for (const type of worthChecking) {
      const definitions = await loadDefinitions(type);
      for (const view of viewsByType[type]) {
        const skipped = [];
        const byIndex = matchView(view, labels, definitions, skipped);
        if (byIndex && byIndex.size > 0) candidates.push({ type, view, byIndex, skipped });
      }
    }

    if (candidates.length === 0) {
      // Silence here is what made this feature look installed-but-dead, so say
      // which columns were on screen and that none of them could be proven.
      console.log(
        `EditableTables: No saved ${types.join('/')} view matches these ${labels.length} columns ` +
        `[${labels.join(', ')}], so nothing here is editable. A renamed or ` +
        'reordered column, or a view you cannot read, will do this.'
      );
      return null;
    }

    // Several views can share a column layout (a filtered copy of the same
    // view), which is harmless while they agree on every field. If they
    // disagree - or belong to different entities - which view is on screen is
    // genuinely unknown, and guessing would write the value into whichever
    // field we happened to pick.
    const [first, ...rest] = candidates;
    if (rest.some((c) => c.type !== first.type || !sameMapping(c.byIndex, first.byIndex))) {
      console.warn(
        'EditableTables: More than one saved view matches these columns with ' +
        'different fields, so inline editing is off for this grid'
      );
      return null;
    }

    const editable = [...first.byIndex.values()].map((f) => f.name).join(', ');
    console.log(`EditableTables: "${first.view.name}" (${first.type}) - editable columns: ${editable}`);
    if (first.skipped.length > 0) {
      console.warn(`EditableTables: columns left read-only - ${first.skipped.join('; ')}`);
    }

    return {
      viewId: first.view.id,
      name: first.view.name,
      type: first.type,
      byIndex: first.byIndex
    };
  }

  /**
   * Extract the record id from a grid row.
   *
   * The row itself is the link to the record (`<a href="/customers/ID">`
   * wrapping the cells), so check the row before looking inside it - a
   * descendant lookup can never match the element it starts from.
   *
   * @param {HTMLElement} row
   * @param {string} type - entity type key ('job', 'customer', 'vendor', 'location')
   * @returns {string|null}
   */
  function getRecordId(row, type) {
    const support = SUPPORTED_TYPES[type];
    if (!row || !support) return null;
    const selector = `a[href^="${support.hrefPrefix}"]`;
    const link = (row.matches && row.matches(selector)) ? row : row.querySelector(selector);
    if (!link) return null;
    const match = support.idPattern.exec(link.getAttribute('href') || '');
    return match ? match[1] : null;
  }

  /**
   * Write one custom field value back to JobTread and return the value the
   * server actually stored (so the cell shows truth, not our optimism).
   * @param {Object} args
   * @param {string} args.type - Entity type ('job', 'customer', 'vendor', 'location')
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
   * Drop cached views, definitions and resolutions (org switch, feature cleanup).
   */
  function clearCache() {
    viewsPromise = null;
    definitionsPromises.clear();
    resolutionCache.clear();
  }

  return {
    normalizeLabel,
    candidateTypes,
    rowSelector,
    resolve,
    getRecordId,
    writeValue,
    clearCache,
    SUPPORTED_TYPES
  };
})();

if (typeof window !== 'undefined') {
  window.EditableTablesSchema = EditableTablesSchema;
}
