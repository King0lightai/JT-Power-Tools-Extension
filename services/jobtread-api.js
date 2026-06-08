// JobTread API Client Service
// Handles Pave API calls for fetching jobs, custom fields, and other data

const JobTreadAPI = (() => {
  // API Configuration - JobTread uses Pave query language
  const API_URL = 'https://api.jobtread.com/pave';
  const DEBUG = false; // Set to true for development debugging only — NEVER ship as true

  /**
   * Detect if we're running in a context that needs the background proxy
   * Content scripts run in web page context and face CORS restrictions
   * Popup and service worker run in extension context and can make direct calls
   */
  function needsProxy() {
    // Check if we're in a content script context
    // Content scripts have access to chrome.runtime but not chrome.action/browserAction
    // Popup and service worker/background have access to chrome.action or chrome.browserAction
    try {
      // If we can't access chrome at all, we're in a web page context
      if (typeof chrome === 'undefined' || !chrome.runtime) {
        return false; // Can't use proxy anyway
      }
      // If we have chrome.action or chrome.browserAction, we're in popup or background (extension context)
      if (chrome.action || chrome.browserAction) {
        return false; // Direct fetch will work
      }
      // Otherwise we're likely in a content script
      return true;
    } catch (e) {
      return true; // Default to proxy for safety
    }
  }

  /**
   * Make a fetch request, using the best available strategy:
   * 1. Extension context (popup/service worker): direct fetch (no CORS issues)
   * 2. Content script (MV3): try direct fetch first (page origin), fall back to proxy
   *    This avoids Safari's unreliable async sendMessage/sendResponse pattern
   * @param {string} url - URL to fetch
   * @param {Object} options - Fetch options
   * @returns {Promise<Response>} Fetch response or proxy result
   */
  async function proxyFetch(url, options) {
    if (!needsProxy()) {
      if (DEBUG) console.log('JobTreadAPI: Using direct fetch (extension context)');
      return fetch(url, options);
    }

    // Content script context — try direct fetch first (MV3 uses page origin)
    try {
      if (DEBUG) console.log('JobTreadAPI: Trying direct fetch (MV3 page origin)');
      const response = await fetch(url, options);
      // Direct fetch succeeded — return native Response
      return response;
    } catch (directError) {
      if (DEBUG) console.log('JobTreadAPI: Direct fetch failed, falling back to proxy:', directError.message);
    }

    // Fall back to background service worker proxy
    if (DEBUG) console.log('JobTreadAPI: Using background proxy for API request');
    const result = await chrome.runtime.sendMessage({
      type: 'JOBTREAD_API_REQUEST',
      url: url,
      options: options
    });

    // Handle Safari async messaging issue (sendMessage resolves with undefined)
    if (!result) {
      throw new Error('No response from background script (Safari async messaging issue)');
    }

    // Convert proxy result to a Response-like object
    return {
      ok: result.success,
      status: result.status || (result.success ? 200 : 500),
      statusText: result.statusText || '',
      text: async () => typeof result.data === 'string' ? result.data : JSON.stringify(result.data),
      json: async () => result.data,
      headers: { entries: () => [] }, // Simplified headers
      _proxyResult: result
    };
  }

  // Storage keys
  const STORAGE_KEYS = {
    API_KEY: 'jtToolsApiKey',
    ORG_ID: 'jtToolsOrgId',
    JOBS_CACHE: 'jtToolsJobsCache',
    CUSTOM_FIELDS_CACHE: 'jtToolsCustomFieldsCache',
    CUSTOM_FIELDS_TIMESTAMP: 'jtToolsCustomFieldsTimestamp',
    JOBS_TIMESTAMP: 'jtToolsJobsTimestamp'
  };

  // Cache duration (5 minutes for jobs, 1 hour for custom field definitions)
  const JOBS_CACHE_DURATION = 5 * 60 * 1000;
  const CUSTOM_FIELDS_CACHE_DURATION = 60 * 60 * 1000;

  /**
   * Get the stored API key
   * @returns {Promise<string|null>}
   */
  async function getApiKey() {
    try {
      // Multi-org resolver handles all fallbacks internally.
      // If it returns null, don't bypass it with legacy storage (would leak cross-org data).
      if (window.GrantKeyResolver) {
        return await window.GrantKeyResolver.getGrantKey();
      }
      // Legacy path: only when resolver isn't loaded at all.
      // Grant key now lives in chrome.storage.local; fall back to the legacy
      // sync location for installs not yet migrated by the service worker.
      const local = await chrome.storage.local.get(STORAGE_KEYS.API_KEY);
      if (local[STORAGE_KEYS.API_KEY]) return local[STORAGE_KEYS.API_KEY];
      const synced = await chrome.storage.sync.get(STORAGE_KEYS.API_KEY);
      return synced[STORAGE_KEYS.API_KEY] || null;
    } catch (error) {
      if (DEBUG) console.error('JobTreadAPI: Error getting API key:', error);
      return null;
    }
  }

  /**
   * Save API key to storage
   * @param {string} apiKey
   * @returns {Promise<boolean>}
   */
  async function setApiKey(apiKey) {
    try {
      // Stored in chrome.storage.local (device-local), NOT sync — a raw grant
      // key must never replicate to Google's cloud or other devices.
      await chrome.storage.local.set({ [STORAGE_KEYS.API_KEY]: apiKey });
      console.log('JobTreadAPI: API key saved');
      return true;
    } catch (error) {
      console.error('JobTreadAPI: Error saving API key:', error);
      return false;
    }
  }

  // Cache for org ID discovered from grant key (avoids repeated Pave calls)
  let discoveredOrgId = null;

  /**
   * Get the organization ID.
   * When multi-org resolver is active, discovers org ID from the grant key
   * via a lightweight currentGrant query (cached per session).
   * Falls back to legacy storage for single-org setups.
   * @returns {Promise<string|null>}
   */
  async function getOrgId() {
    try {
      // Legacy storage check first (fast path)
      const result = await chrome.storage.sync.get(STORAGE_KEYS.ORG_ID);
      if (result[STORAGE_KEYS.ORG_ID]) return result[STORAGE_KEYS.ORG_ID];
    } catch (error) {
      console.error('JobTreadAPI: Error getting org ID:', error);
    }

    // Multi-org: discover from grant key
    if (window.GrantKeyResolver && window.OrgDetector?.getActiveOrg()) {
      if (discoveredOrgId) return discoveredOrgId;
      try {
        const data = await paveQuery({
          currentGrant: {
            user: {
              memberships: {
                nodes: {
                  organization: { id: {} }
                }
              }
            }
          }
        });
        discoveredOrgId = data?.currentGrant?.user?.memberships?.nodes?.[0]?.organization?.id || null;
        return discoveredOrgId;
      } catch (e) {
        console.error('JobTreadAPI: Failed to discover org ID from grant key:', e);
      }
    }

    return null;
  }

  /**
   * Save organization ID to storage
   * @param {string} orgId
   * @returns {Promise<boolean>}
   */
  async function setOrgId(orgId) {
    try {
      await chrome.storage.sync.set({ [STORAGE_KEYS.ORG_ID]: orgId });
      console.log('JobTreadAPI: Org ID saved:', orgId);
      return true;
    } catch (error) {
      console.error('JobTreadAPI: Error saving org ID:', error);
      return false;
    }
  }

  /**
   * Check if API is configured (has API key)
   * @returns {Promise<boolean>}
   */
  async function isConfigured() {
    const apiKey = await getApiKey();
    return !!apiKey;
  }

  /**
   * Check if fully configured (has both API key and org ID)
   * When GrantKeyResolver is active, having a key is sufficient —
   * the org ID can be discovered from the grant key at query time.
   * @returns {Promise<boolean>}
   */
  async function isFullyConfigured() {
    const apiKey = await getApiKey();
    if (!apiKey) return false;
    // When multi-org resolver is active, the key is per-org — org ID not needed separately
    if (window.GrantKeyResolver && window.OrgDetector?.getActiveOrg()) {
      return true;
    }
    // Legacy: need both key and org ID
    const orgId = await getOrgId();
    return !!orgId;
  }

  /**
   * Execute a Pave query
   * JobTread uses Pave query language - a JSON-based query format
   * The query must be wrapped in a "query" key with grantKey in "$"
   * @param {Object} query - Pave query object (inner query, will be wrapped)
   * @returns {Promise<Object>} Response data
   */
  async function paveQuery(query) {
    const apiKey = await getApiKey();

    if (!apiKey) {
      throw new Error('JobTread API key not configured');
    }

    try {
      // Wrap query in the correct format per JT docs:
      // { "query": { "$": { "grantKey": "..." }, ...innerQuery } }
      const wrappedQuery = {
        query: {
          $: { grantKey: apiKey },
          ...query
        }
      };

      if (DEBUG) console.log('JobTreadAPI: Query keys:', Object.keys(query));

      const bodyString = JSON.stringify(wrappedQuery);

      const response = await proxyFetch(API_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: bodyString
      });

      if (DEBUG) console.log('JobTreadAPI: Response status:', response.status);

      if (!response.ok) {
        const errorText = await response.text();
        console.error('JobTreadAPI: API Error:', response.status);
        throw new Error(`API Error ${response.status}: ${errorText}`);
      }

      const result = await response.json();
      if (DEBUG) console.log('JobTreadAPI: Query result keys:', Object.keys(result));

      // Check for errors in the response
      if (result.errors && result.errors.length > 0) {
        console.error('JobTreadAPI: Pave errors:', result.errors);
        throw new Error(result.errors[0].message || 'Query failed');
      }

      return result;
    } catch (error) {
      console.error('JobTreadAPI: Query failed:', error);
      throw error;
    }
  }

  /**
   * Discover organization ID from the current grant
   * Uses currentGrant -> user -> memberships to find orgs
   * @returns {Promise<Object>} Organization info with id and name
   */
  async function discoverOrganization() {
    const query = {
      currentGrant: {
        id: {},
        user: {
          id: {},
          memberships: {
            nodes: {
              organization: {
                id: {},
                name: {}
              }
            }
          }
        }
      }
    };

    const result = await paveQuery(query);
    if (DEBUG) console.log('JobTreadAPI: discoverOrganization result keys:', Object.keys(result));

    // Response comes back WITHOUT the "query" wrapper - data is at root level
    const memberships = result.currentGrant?.user?.memberships?.nodes || [];
    if (DEBUG) console.log('JobTreadAPI: memberships found:', memberships.length);

    if (memberships.length > 0) {
      const org = memberships[0].organization;
      return {
        id: org.id,
        name: org.name
      };
    }

    throw new Error('No organization found for this grant key');
  }

  /**
   * Test API connection by fetching organization name
   * @param {string} orgId - Organization ID to test with (optional - will auto-discover)
   * @returns {Promise<Object>} Connection test result
   */
  async function testConnection(orgId = null) {
    try {
      // If no org ID provided, try to discover it
      if (!orgId) {
        orgId = await getOrgId();
      }

      // If still no org ID, try to discover from currentGrant
      if (!orgId) {
        console.log('JobTreadAPI: No org ID, attempting auto-discovery...');
        try {
          const org = await discoverOrganization();
          if (org) {
            await setOrgId(org.id);
            return {
              success: true,
              message: 'API connection successful',
              organization: {
                id: org.id,
                name: org.name
              }
            };
          }
        } catch (discoverError) {
          console.error('JobTreadAPI: Auto-discovery failed:', discoverError);
          return {
            success: false,
            message: discoverError.message || 'Failed to discover organization',
            error: discoverError
          };
        }
      }

      // If we have an org ID, verify it works
      const query = {
        organization: {
          $: { id: orgId },
          id: {},
          name: {}
        }
      };

      const result = await paveQuery(query);

      // Response comes back WITHOUT the "query" wrapper
      if (result.organization) {
        // Save the org ID since it worked
        await setOrgId(orgId);

        return {
          success: true,
          message: 'API connection successful',
          organization: {
            id: result.organization.id,
            name: result.organization.name
          }
        };
      }

      return { success: false, message: 'No organization data returned' };
    } catch (error) {
      // Check for CORS errors
      if (error.message.includes('Failed to fetch') || error.message.includes('NetworkError')) {
        return {
          success: false,
          message: 'CORS blocked - API calls require a server proxy',
          error
        };
      }
      return {
        success: false,
        message: error.message || 'Connection failed',
        error
      };
    }
  }

  /**
   * Fetch custom field definitions for jobs
   * @param {string} orgId - Organization ID (optional, will use stored if not provided)
   * @returns {Promise<Array>} List of custom field definitions
   */
  async function fetchCustomFieldDefinitions(orgId = null) {
    // Check cache first
    try {
      const cached = await chrome.storage.local.get([
        STORAGE_KEYS.CUSTOM_FIELDS_CACHE,
        STORAGE_KEYS.CUSTOM_FIELDS_TIMESTAMP
      ]);

      const cacheAge = Date.now() - (cached[STORAGE_KEYS.CUSTOM_FIELDS_TIMESTAMP] || 0);

      if (cached[STORAGE_KEYS.CUSTOM_FIELDS_CACHE] && cacheAge < CUSTOM_FIELDS_CACHE_DURATION) {
        console.log('JobTreadAPI: Using cached custom fields');
        return cached[STORAGE_KEYS.CUSTOM_FIELDS_CACHE];
      }
    } catch (e) {
      // Cache read failed, continue to fetch
    }

    // Get org ID if not provided
    if (!orgId) {
      orgId = await getOrgId();
      if (!orgId) {
        throw new Error('Organization ID not configured');
      }
    }

    // Pave query for custom fields - filter for job targetType
    // Using the correct format from JT docs with where clause
    const query = {
      organization: {
        $: { id: orgId },
        id: {},
        customFields: {
          $: {
            where: ['targetType', '=', 'job'],
            sortBy: [
              { field: 'position' }
            ]
          },
          nodes: {
            id: {},
            name: {},
            type: {},
            targetType: {},
            options: {}
          }
        }
      }
    };

    try {
      const result = await paveQuery(query);
      // Response comes back WITHOUT the "query" wrapper
      const jobDefinitions = result.organization?.customFields?.nodes || [];

      console.log('JobTreadAPI: Fetched job custom fields:', jobDefinitions.length);
      console.log('JobTreadAPI: Job custom fields:', jobDefinitions);

      // Cache the results
      await chrome.storage.local.set({
        [STORAGE_KEYS.CUSTOM_FIELDS_CACHE]: jobDefinitions,
        [STORAGE_KEYS.CUSTOM_FIELDS_TIMESTAMP]: Date.now()
      });

      return jobDefinitions;
    } catch (error) {
      console.error('JobTreadAPI: Failed to fetch custom field definitions:', error);
      throw error;
    }
  }

  /**
   * Fetch custom field definitions for locations
   * @param {string} orgId - Organization ID (optional)
   * @returns {Promise<Array>} List of location custom field definitions
   */
  async function fetchLocationCustomFields(orgId = null) {
    // Check cache
    try {
      const cached = await chrome.storage.local.get([
        'jtToolsLocationFieldsCache',
        'jtToolsLocationFieldsTimestamp'
      ]);
      const cacheAge = Date.now() - (cached.jtToolsLocationFieldsTimestamp || 0);
      if (cached.jtToolsLocationFieldsCache && cacheAge < CUSTOM_FIELDS_CACHE_DURATION) {
        console.log('JobTreadAPI: Using cached location custom fields');
        return cached.jtToolsLocationFieldsCache;
      }
    } catch (e) { /* cache read failed */ }

    if (!orgId) {
      orgId = await getOrgId();
      if (!orgId) throw new Error('Organization ID not configured');
    }

    const query = {
      organization: {
        $: { id: orgId },
        customFields: {
          $: {
            where: ['targetType', '=', 'location'],
            sortBy: [{ field: 'position' }]
          },
          nodes: {
            id: {},
            name: {},
            type: {},
            targetType: {},
            options: {}
          }
        }
      }
    };

    try {
      const result = await paveQuery(query);
      const fields = result.organization?.customFields?.nodes || [];
      console.log('JobTreadAPI: Fetched location custom fields:', fields.length);

      await chrome.storage.local.set({
        jtToolsLocationFieldsCache: fields,
        jtToolsLocationFieldsTimestamp: Date.now()
      });

      return fields;
    } catch (error) {
      console.error('JobTreadAPI: Failed to fetch location custom fields:', error);
      throw error;
    }
  }

  /**
   * Fetch organization locations for filtering
   * @param {string} orgId - Organization ID (optional)
   * @returns {Promise<Array>} List of locations with id and name
   */
  async function fetchLocations(orgId = null) {
    // Check cache first
    try {
      const cached = await chrome.storage.local.get([
        'jtToolsLocationsCache',
        'jtToolsLocationsTimestamp'
      ]);
      const cacheAge = Date.now() - (cached.jtToolsLocationsTimestamp || 0);
      if (cached.jtToolsLocationsCache && cacheAge < CUSTOM_FIELDS_CACHE_DURATION) {
        console.log('JobTreadAPI: Using cached locations');
        return cached.jtToolsLocationsCache;
      }
    } catch (e) { /* cache read failed */ }

    if (!orgId) {
      orgId = await getOrgId();
      if (!orgId) throw new Error('Organization ID not configured');
    }

    const query = {
      organization: {
        $: { id: orgId },
        locations: {
          $: { size: 100, sortBy: [{ field: 'name' }] },
          nodes: {
            id: {},
            name: {}
          }
        }
      }
    };

    try {
      const result = await paveQuery(query);
      const locations = result.organization?.locations?.nodes || [];
      console.log('JobTreadAPI: Fetched locations:', locations.length);

      await chrome.storage.local.set({
        jtToolsLocationsCache: locations,
        jtToolsLocationsTimestamp: Date.now()
      });

      return locations;
    } catch (error) {
      console.error('JobTreadAPI: Failed to fetch locations:', error);
      throw error;
    }
  }

  /**
   * Fetch jobs with their custom field values
   * @param {Object} options - Query options
   * @param {number} options.limit - Max number of jobs to fetch (default 100, max 100)
   * @param {number} options.offset - Number of jobs to skip for pagination
   * @param {string} options.status - Filter by job status
   * @param {Array} options.sortBy - Sort configuration array
   * @returns {Promise<Array>} List of jobs with custom fields
   */
  async function fetchJobs(options = {}) {
    const { limit = 100, offset = 0, status = null, sortBy = null } = options;

    let orgId = await getOrgId();
    if (!orgId) {
      throw new Error('Organization ID not configured');
    }

    // Build query parameters (size 25 to avoid Pave 413 with nested customFieldValues)
    const queryParams = {
      size: Math.min(limit, 25),
      sortBy: sortBy || [{ field: 'createdAt' }]
    };

    // Add pagination offset
    if (offset > 0) {
      queryParams.skip = offset;
    }

    // Add status filter if provided
    if (status) {
      queryParams.where = ['status', '=', status];
    }

    // Pave query for jobs with their custom field values
    // Note: location.customFieldValues excluded to avoid 413 on large orgs
    const query = {
      organization: {
        $: { id: orgId },
        id: {},
        jobs: {
          $: queryParams,
          nodes: {
            id: {},
            name: {},
            number: {},
            status: {},
            createdAt: {},
            location: {
              id: {},
              name: {},
            },
            customFieldValues: {
              nodes: {
                id: {},
                value: {},
                customField: {
                  id: {},
                  name: {},
                  type: {}
                }
              }
            }
          }
        }
      }
    };

    try {
      const result = await paveQuery(query);
      // Response comes back WITHOUT the "query" wrapper
      const jobs = result.organization?.jobs?.nodes || [];
      console.log('JobTreadAPI: Fetched jobs:', jobs.length);
      return jobs;
    } catch (error) {
      console.error('JobTreadAPI: Failed to fetch jobs:', error);
      throw error;
    }
  }

  /**
   * Fetch jobs filtered by custom field value using Pave 'with' clause (server-side filtering)
   * @param {string} fieldName - Custom field name to filter by
   * @param {string} fieldValue - Value to match
   * @returns {Promise<Array>} Filtered list of jobs
   */
  async function fetchJobsByCustomField(fieldName, fieldValue) {
    // Use single filter version
    return fetchJobsWithFilters([{ fieldName, value: fieldValue }]);
  }

  /**
   * Fetch jobs filtered by multiple custom field values using Pave 'with' clause
   * Supports AND logic for multiple filters
   * @param {Array} filters - Array of { fieldName, value } objects
   * @param {Object} options - Query options (status, sortBy, limit, offset)
   * @returns {Promise<Array>} Filtered list of jobs
   */
  async function fetchJobsWithFilters(filters = [], options = {}) {
    const { status = null, sortBy = null, limit = 100, offset = 0 } = options;

    let orgId = await getOrgId();
    if (!orgId) {
      throw new Error('Organization ID not configured');
    }

    // If no filters, return all jobs
    if (!filters || filters.length === 0) {
      return fetchJobs({ limit, offset, status, sortBy });
    }

    // Group filters by field name — same field gets OR logic, different fields get AND logic
    // e.g., [{ fieldName: "Status", value: "Pre-Sale" }, { fieldName: "Status", value: "Active" }]
    //     → one with clause for "Status", where condition: values = "Pre-Sale" OR values = "Active"
    const fieldGroups = {};
    filters.forEach(filter => {
      if (!fieldGroups[filter.fieldName]) {
        fieldGroups[filter.fieldName] = [];
      }
      fieldGroups[filter.fieldName].push(filter.value);
    });

    // Build one "with" clause per unique field
    const withClauses = {};
    const fieldKeys = Object.keys(fieldGroups);
    fieldKeys.forEach((fieldName, index) => {
      const key = `filter${index}`;
      withClauses[key] = {
        _: 'customFieldValues',
        $: {
          where: [['customField', 'name'], '=', fieldName]
        },
        values: { $: { field: 'value' } }
      };
    });

    // Build where conditions — OR within same field, AND across fields
    const whereConditions = fieldKeys.map((fieldName, index) => {
      const values = fieldGroups[fieldName];
      const key = `filter${index}`;
      if (values.length === 1) {
        return [[key, 'values'], '=', values[0]];
      }
      // Multiple values for same field → OR
      return { or: values.map(v => [[key, 'values'], '=', v]) };
    });

    // Add status filter if provided (use closedOn since status is computed)
    if (status) {
      if (status === 'closed') {
        whereConditions.push(['closedOn', '!=', null]);
      } else {
        whereConditions.push(['closedOn', null]);
      }
    }

    // Single condition vs multiple conditions (AND logic across fields)
    const whereClause = whereConditions.length === 1
      ? whereConditions[0]
      : { and: whereConditions };

    // Build the query
    const query = {
      organization: {
        $: { id: orgId },
        jobs: {
          $: {
            size: Math.min(limit, 25),
            ...(offset > 0 ? { skip: offset } : {}),
            with: withClauses,
            where: whereClause,
            sortBy: sortBy || [{ field: 'name' }]
          },
          nodes: {
            id: {},
            name: {},
            number: {},
            status: {},
            location: {
              id: {},
              name: {}
            },
            customFieldValues: {
              nodes: {
                value: {},
                customField: {
                  id: {},
                  name: {}
                }
              }
            }
          }
        }
      }
    };

    try {
      console.log('JobTreadAPI: Fetching jobs with filters:', filters);
      const result = await paveQuery(query);
      const jobs = result.organization?.jobs?.nodes || [];
      console.log('JobTreadAPI: Server-side filtered to', jobs.length, 'jobs');
      return jobs;
    } catch (error) {
      console.error('JobTreadAPI: Failed to fetch filtered jobs:', error);
      throw error;
    }
  }

  /**
   * Get unique values for a custom field across all jobs
   * Useful for building filter dropdowns
   * @param {string} customFieldId - Custom field ID
   * @returns {Promise<Array>} Unique values
   */
  async function getCustomFieldValues(customFieldId) {
    // Fetch jobs with pagination (API max is 100 per page)
    const allJobs = [];
    const pageSize = 100;
    const maxPages = 5;

    for (let page = 0; page < maxPages; page++) {
      const jobs = await fetchJobs({ limit: pageSize, offset: page * pageSize });
      allJobs.push(...jobs);
      if (jobs.length < pageSize) break;
    }

    const values = new Set();
    allJobs.forEach(job => {
      const fieldValues = job.customFieldValues?.nodes || [];
      fieldValues.forEach(fv => {
        if (fv.customField?.id === customFieldId && fv.value) {
          values.add(fv.value);
        }
      });
    });

    return Array.from(values).sort();
  }

  /**
   * Clear all cached data
   * @returns {Promise<void>}
   */
  async function clearCache() {
    try {
      await chrome.storage.local.remove([
        STORAGE_KEYS.JOBS_CACHE,
        STORAGE_KEYS.CUSTOM_FIELDS_CACHE,
        STORAGE_KEYS.CUSTOM_FIELDS_TIMESTAMP,
        STORAGE_KEYS.JOBS_TIMESTAMP
      ]);
      discoveredOrgId = null; // Clear discovered org ID on cache clear
      console.log('JobTreadAPI: Cache cleared');
    } catch (error) {
      console.error('JobTreadAPI: Error clearing cache:', error);
    }
  }

  // Clear discovered org ID when org changes
  if (typeof window !== 'undefined') {
    window.addEventListener('jt-org-changed', () => {
      discoveredOrgId = null;
    });
  }

  /**
   * Remove API configuration (logout)
   * @returns {Promise<void>}
   */
  async function clearConfig() {
    try {
      // Grant key now lives in local; also clear the legacy sync copies.
      await chrome.storage.local.remove([STORAGE_KEYS.API_KEY]);
      await chrome.storage.sync.remove([
        STORAGE_KEYS.API_KEY,
        STORAGE_KEYS.ORG_ID
      ]);
      await clearCache();
      console.log('JobTreadAPI: Configuration cleared');
    } catch (error) {
      console.error('JobTreadAPI: Error clearing config:', error);
    }
  }

  /**
   * Direct API test - bypasses storage, uses provided credentials directly
   * Useful for debugging connection issues
   * @param {string} apiKey - API key to test with
   * @param {string} orgId - Optional org ID for testing
   * @returns {Promise<Object>} Test result
   */
  async function directApiTest(apiKey, orgId = null) {
    // Use the correct JT Docs format:
    // { "query": { "$": { "grantKey": "..." }, ...innerQuery } }
    const wrappedQuery = {
      query: {
        $: { grantKey: apiKey },
        currentGrant: {
          id: {},
          user: {
            id: {},
            name: {},
            memberships: {
              nodes: {
                organization: {
                  id: {},
                  name: {}
                }
              }
            }
          }
        }
      }
    };

    if (DEBUG) console.log('JobTreadAPI: Direct test with correct format...');
    if (DEBUG) console.log('JobTreadAPI: Using API key:', apiKey.substring(0, 10) + '...');

    try {
      const response = await proxyFetch(API_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(wrappedQuery)
      });

      if (DEBUG) console.log('JobTreadAPI: Response status:', response.status);
      const responseText = await response.text();
      if (DEBUG) console.log('JobTreadAPI: Response length:', responseText.length);

      let parsedResponse;
      try {
        parsedResponse = JSON.parse(responseText);
      } catch (e) {
        parsedResponse = responseText;
      }

      if (response.ok) {
        if (DEBUG) console.log('JobTreadAPI: API connection test passed');
        return {
          success: true,
          data: parsedResponse
        };
      } else {
        return {
          success: false,
          status: response.status,
          error: responseText
        };
      }
    } catch (error) {
      console.error('JobTreadAPI: Direct test error:', error.message);
      return {
        success: false,
        error: error.message
      };
    }
  }

  /**
   * Upload arbitrary bytes as a file attached to a job. Mirrors the
   * server-side `jt_files.upload` helper:
   *   1. createUploadRequest → returns a signed URL + headers
   *   2. PUT the bytes to that URL
   *   3. createComment with the upload reference so the file shows up in
   *      the Files tab on the job
   *
   * Used by the Forms feature to drop a signed PDF into JobTread Files
   * directly from the extension — no extension-server round-trip required.
   *
   * @param {object} args
   * @param {Uint8Array|ArrayBuffer} args.bytes
   * @param {string}                 args.fileName  - Suggested filename
   * @param {string}                 args.jobId     - JT job ID
   * @param {string}                 [args.contentType='application/pdf']
   * @param {string}                 [args.message] - Comment body shown alongside the file
   * @returns {Promise<{ id: string, name: string, url?: string }>}
   */
  async function uploadFileToJob({ bytes, fileName, jobId, contentType, message }) {
    if (!jobId) throw new Error('uploadFileToJob: jobId is required');
    if (!fileName) throw new Error('uploadFileToJob: fileName is required');
    if (!bytes) throw new Error('uploadFileToJob: bytes is required');

    const buffer = bytes instanceof ArrayBuffer ? bytes : (bytes.buffer || bytes);
    const size = buffer.byteLength;
    const type = contentType || 'application/pdf';

    const orgId = await getOrgId();
    if (!orgId) throw new Error('uploadFileToJob: organization id not resolved');

    // 1. createUploadRequest — Pave hands back a signed URL we PUT to.
    const reqData = await paveQuery({
      createUploadRequest: {
        $: { organizationId: orgId, size, type },
        createdUploadRequest: {
          id: {}, url: {}, method: {}, headers: {},
        },
      },
    });
    const uploadReq = reqData?.createUploadRequest?.createdUploadRequest;
    if (!uploadReq) throw new Error('createUploadRequest returned no data');

    // 2. PUT bytes to the signed URL. We use raw fetch (not proxyFetch)
    // because the URL is on JobTread's storage host, which the extension
    // already has host_permissions for.
    const uploadHeaders = {};
    if (uploadReq.headers && typeof uploadReq.headers === 'object') {
      for (const [k, v] of Object.entries(uploadReq.headers)) {
        uploadHeaders[k] = v;
      }
    }
    const putResp = await fetch(uploadReq.url, {
      method: uploadReq.method || 'PUT',
      headers: uploadHeaders,
      body: buffer,
    });
    if (!putResp.ok) {
      const errText = await putResp.text().catch(() => '');
      throw new Error('Upload failed (' + putResp.status + '): ' + errText.slice(0, 200));
    }

    // 3. Attach to the job via comment — same pattern the MCP server uses,
    // which results in the file appearing in the Files tab.
    const commentData = await paveQuery({
      createComment: {
        $: {
          targetId: jobId,
          targetType: 'job',
          message: typeof message === 'string' && message.length > 0
            ? message
            : ('File uploaded: ' + fileName),
          files: [{ uploadRequestId: uploadReq.id, name: fileName }],
        },
        createdComment: {
          id: {},
          files: { nodes: { id: {}, name: {}, url: {} } },
        },
      },
    });

    const created = commentData?.createComment?.createdComment;
    const file = created?.files?.nodes?.[0];
    if (!file) throw new Error('createComment returned no file reference');
    return { id: file.id, name: file.name, url: file.url };
  }

  // Public API
  return {
    // Configuration
    getApiKey,
    setApiKey,
    getOrgId,
    setOrgId,
    isConfigured,
    isFullyConfigured,
    testConnection,
    clearConfig,

    // Organization discovery
    discoverOrganization,

    // Data fetching
    fetchCustomFieldDefinitions,
    fetchLocations,
    fetchLocationCustomFields,
    fetchJobs,
    fetchJobsByCustomField,
    fetchJobsWithFilters,
    getCustomFieldValues,

    // Raw query access
    paveQuery,

    // File uploads (Files tab on a job)
    uploadFileToJob,

    // Cache management
    clearCache,

    // Direct testing
    directApiTest,

    // Constants
    STORAGE_KEYS
  };
})();

// Export for use in content scripts
if (typeof window !== 'undefined') {
  window.JobTreadAPI = JobTreadAPI;
}

// Export for service worker
if (typeof module !== 'undefined' && module.exports) {
  module.exports = JobTreadAPI;
}
