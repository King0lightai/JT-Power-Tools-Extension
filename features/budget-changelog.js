// Budget Changelog Feature
// Compare JobTread budget backups and display human-readable changes
// Power User tier feature

const BudgetChangelogFeature = (() => {
  const DEBUG = false; // Set to true for development debugging only — NEVER ship as true
  let isActive = false;
  let sidebarObserver = null;
  let currentJobId = null;

  // Selectors for Budget Backups sidebar
  // Note: JobTread sidebars have z-30, absolute positioning, and right-0
  // The sidebar may include additional classes like max-w-full
  const SIDEBAR_SELECTOR = 'div.z-30.absolute.right-0[data-is-drag-scroll-boundary="true"]';

  /**
   * Check if a sidebar element is the Budget Backups sidebar
   * @param {HTMLElement} sidebar - Sidebar element to check
   * @returns {boolean} True if this is the Budget Backups sidebar
   */
  function isBudgetBackupsSidebar(sidebar) {
    if (!sidebar) return false;

    // Look for the orange "BUDGET BACKUPS" header text (JobTread pattern)
    // The header has class font-bold.text-jtOrange.uppercase
    const orangeHeader = sidebar.querySelector('.font-bold.text-jtOrange.uppercase');
    if (orangeHeader) {
      const headerText = orangeHeader.textContent.trim().toUpperCase();
      if (headerText === 'BUDGET BACKUPS') {
        return true;
      }
    }

    // Fallback: Look for "Budget Backups" anywhere in the sidebar
    const sidebarText = sidebar.textContent || '';
    if (sidebarText.includes('Budget Backups') || sidebarText.includes('BUDGET BACKUPS')) {
      // Verify it has backup download links (a tags with href containing budget-backup)
      const hasBackupLinks = sidebar.querySelector('a[href*="budget-backup"], a[download]');
      if (hasBackupLinks) {
        return true;
      }
    }

    return false;
  }

  /**
   * Find the Budget Backups sidebar if currently open
   * @returns {HTMLElement|null} Sidebar element or null
   */
  function findBudgetBackupsSidebar() {
    const sidebars = document.querySelectorAll(SIDEBAR_SELECTOR);
    for (const sidebar of sidebars) {
      if (isBudgetBackupsSidebar(sidebar)) {
        return sidebar;
      }
    }
    return null;
  }

  /**
   * Extract job ID from current URL
   * @returns {string|null} Job ID or null
   */
  function getJobIdFromUrl() {
    const match = window.location.pathname.match(/\/jobs\/([^\/]+)/);
    return match ? match[1] : null;
  }

  /**
   * Initialize the feature
   */
  function init() {
    if (isActive) {
      if (DEBUG) console.log('BudgetChangelog: Already active, skipping init');
      return;
    }

    isActive = true;
    if (DEBUG) console.log('BudgetChangelog: Initializing...');

    // Start observing for Budget Backups sidebar
    startSidebarObserver();

    // Check if sidebar is already present
    const existingSidebar = findBudgetBackupsSidebar();
    if (DEBUG) console.log('BudgetChangelog: Existing sidebar check:', existingSidebar ? 'FOUND' : 'not found');
    if (existingSidebar) {
      handleSidebarAppeared(existingSidebar);
    }

    if (DEBUG) console.log('BudgetChangelog: Activated');
  }

  /**
   * Cleanup the feature
   */
  function cleanup() {
    if (!isActive) {
      return;
    }

    isActive = false;

    // Stop observer
    stopSidebarObserver();

    // Remove any injected UI
    BudgetChangelogUI.cleanup();

    // Reset state
    currentJobId = null;

    if (DEBUG) console.log('BudgetChangelog: Deactivated');
  }

  /**
   * Start observing for Budget Backups sidebar appearances
   */
  function startSidebarObserver() {
    if (sidebarObserver) {
      if (DEBUG) console.log('BudgetChangelog: Observer already running');
      return;
    }

    if (DEBUG) console.log('BudgetChangelog: Starting sidebar observer with selector:', SIDEBAR_SELECTOR);

    sidebarObserver = new MutationObserver((mutations) => {
      for (const mutation of mutations) {
        for (const node of mutation.addedNodes) {
          if (node.nodeType === Node.ELEMENT_NODE) {
            // Check if added node is a sidebar or contains one
            const sidebar = node.matches?.(SIDEBAR_SELECTOR)
              ? node
              : node.querySelector?.(SIDEBAR_SELECTOR);

            if (sidebar) {
              if (DEBUG) console.log('BudgetChangelog: Found potential sidebar via mutation');
              // Delay to ensure sidebar is fully rendered
              setTimeout(() => {
                const isBudgetSidebar = isBudgetBackupsSidebar(sidebar);
                if (DEBUG) console.log('BudgetChangelog: Is Budget Backups sidebar:', isBudgetSidebar);
                if (isBudgetSidebar) {
                  handleSidebarAppeared(sidebar);
                }
              }, 200);
            }
          }
        }

        // Also check for removed nodes to cleanup
        for (const node of mutation.removedNodes) {
          if (node.nodeType === Node.ELEMENT_NODE) {
            if (node.matches?.(SIDEBAR_SELECTOR) || node.querySelector?.(SIDEBAR_SELECTOR)) {
              // Sidebar was removed, cleanup our UI
              BudgetChangelogUI.cleanup();
            }
          }
        }
      }
    });

    sidebarObserver.observe(document.body, {
      childList: true,
      subtree: true
    });

    if (DEBUG) console.log('BudgetChangelog: Observer started');
  }

  /**
   * Stop the sidebar observer
   */
  function stopSidebarObserver() {
    if (sidebarObserver) {
      sidebarObserver.disconnect();
      sidebarObserver = null;
    }
  }

  /**
   * Handle when Budget Backups sidebar appears
   * @param {HTMLElement} sidebar - The sidebar element
   */
  async function handleSidebarAppeared(sidebar) {
    if (DEBUG) console.log('BudgetChangelog: handleSidebarAppeared called');

    // Check if API is configured
    const isApiConfigured = await checkApiConfigured();
    if (DEBUG) console.log('BudgetChangelog: API configured:', isApiConfigured);
    if (!isApiConfigured) {
      if (DEBUG) console.log('BudgetChangelog: API not configured, skipping');
      // Still inject UI but show a message that API is needed
      injectApiRequiredMessage(sidebar);
      return;
    }

    // Get job ID
    const jobId = getJobIdFromUrl();
    if (DEBUG) console.log('BudgetChangelog: Job ID from URL:', jobId);
    if (!jobId) {
      if (DEBUG) console.log('BudgetChangelog: Not on a job page, skipping');
      return;
    }

    currentJobId = jobId;

    // Fetch backup list
    try {
      if (DEBUG) console.log('BudgetChangelog: Fetching backups for job:', jobId);
      const backups = await fetchBudgetBackups(jobId);
      if (DEBUG) console.log('BudgetChangelog: Fetched backups:', backups.length);

      if (backups.length < 2) {
        if (DEBUG) console.log('BudgetChangelog: Less than 2 backups, comparison not possible');
        // Show a message in the sidebar
        injectNotEnoughBackupsMessage(sidebar, backups.length);
        return;
      }

      // Inject compare controls
      BudgetChangelogUI.injectCompareControls(sidebar, backups);

    } catch (error) {
      console.error('BudgetChangelog: Error fetching backups:', error);
      injectErrorMessage(sidebar, error.message);
    }
  }

  /**
   * Inject a message when API is not configured
   */
  function injectApiRequiredMessage(sidebar) {
    if (sidebar.querySelector('#jt-budget-compare-controls')) return;

    const scrollableArea = sidebar.querySelector('.overflow-y-auto');
    const contentContainer = scrollableArea?.querySelector('div.p-4');
    if (!contentContainer) return;

    const messageDiv = document.createElement('div');
    messageDiv.id = 'jt-budget-compare-controls';
    messageDiv.className = 'p-3 mx-4 mb-3 bg-yellow-50 border border-yellow-200 rounded-lg';
    messageDiv.innerHTML = `
      <div class="text-sm font-medium text-yellow-800 mb-1">Compare Backups</div>
      <div class="text-xs text-yellow-600">Configure your JobTread API in the extension popup to enable budget comparison.</div>
    `;

    const instructionText = contentContainer.querySelector('.text-xs.text-gray-500');
    if (instructionText) {
      instructionText.after(messageDiv);
    } else {
      contentContainer.insertBefore(messageDiv, contentContainer.firstChild);
    }
  }

  /**
   * Inject a message when not enough backups exist
   */
  function injectNotEnoughBackupsMessage(sidebar, count) {
    if (sidebar.querySelector('#jt-budget-compare-controls')) return;

    const scrollableArea = sidebar.querySelector('.overflow-y-auto');
    const contentContainer = scrollableArea?.querySelector('div.p-4');
    if (!contentContainer) return;

    const messageDiv = document.createElement('div');
    messageDiv.id = 'jt-budget-compare-controls';
    messageDiv.className = 'p-3 mx-4 mb-3 bg-gray-50 border border-gray-200 rounded-lg';
    messageDiv.innerHTML = `
      <div class="text-sm font-medium text-gray-700 mb-1">Compare Backups</div>
      <div class="text-xs text-gray-500">${count === 0 ? 'No backups available yet.' : 'Need at least 2 backups to compare.'} Create more backups to enable comparison.</div>
    `;

    const instructionText = contentContainer.querySelector('.text-xs.text-gray-500');
    if (instructionText) {
      instructionText.after(messageDiv);
    } else {
      contentContainer.insertBefore(messageDiv, contentContainer.firstChild);
    }
  }

  /**
   * Inject an error message
   */
  function injectErrorMessage(sidebar, errorMsg) {
    if (sidebar.querySelector('#jt-budget-compare-controls')) return;

    const scrollableArea = sidebar.querySelector('.overflow-y-auto');
    const contentContainer = scrollableArea?.querySelector('div.p-4');
    if (!contentContainer) return;

    const messageDiv = document.createElement('div');
    messageDiv.id = 'jt-budget-compare-controls';
    messageDiv.className = 'p-3 mx-4 mb-3 bg-red-50 border border-red-200 rounded-lg';
    // Escape error message to prevent XSS from server-returned strings
    const safeMsg = (typeof Sanitizer !== 'undefined' && Sanitizer.escapeHTML)
      ? Sanitizer.escapeHTML(errorMsg || 'Failed to load backups')
      : (errorMsg || 'Failed to load backups').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
    messageDiv.innerHTML = `
      <div class="text-sm font-medium text-red-800 mb-1">Compare Backups</div>
      <div class="text-xs text-red-600">Error: ${safeMsg}</div>
    `;

    const instructionText = contentContainer.querySelector('.text-xs.text-gray-500');
    if (instructionText) {
      instructionText.after(messageDiv);
    } else {
      contentContainer.insertBefore(messageDiv, contentContainer.firstChild);
    }
  }

  /**
   * Check if API is configured (Worker or Direct)
   * @returns {Promise<boolean>} True if API is configured
   */
  async function checkApiConfigured() {
    // Use GrantKeyResolver as source of truth when available
    if (window.GrantKeyResolver) {
      const key = await getGrantKey();
      return !!key;
    }

    // Check Worker API first (Pro Service)
    if (typeof JobTreadProService !== 'undefined') {
      const configured = await JobTreadProService.isConfigured();
      if (configured) return true;
    }

    // Fall back to Direct API
    if (typeof JobTreadAPI !== 'undefined') {
      const configured = await JobTreadAPI.isFullyConfigured();
      if (configured) return true;
    }

    return false;
  }

  /**
   * Get Grant Key from any available source
   * Uses GrantKeyResolver when available (multi-org aware), else legacy storage
   * @returns {Promise<string|null>} Grant key or null
   */
  async function getGrantKey() {
    // Multi-org resolver handles per-org key resolution and fallback
    if (window.GrantKeyResolver) {
      return await window.GrantKeyResolver.getGrantKey();
    }

    try {
      // Legacy: AccountService storage (set during portal login)
      const accountResult = await chrome.storage.local.get('jtAccountGrantKey');
      if (accountResult.jtAccountGrantKey) {
        return accountResult.jtAccountGrantKey;
      }

      // Legacy: Pro Service (obfuscated storage from MCP setup)
      if (typeof JobTreadProService !== 'undefined') {
        const proKey = await JobTreadProService.getGrantKey();
        if (proKey) return proKey;
      }

      // Legacy: JobTreadAPI storage (jtToolsApiKey in sync storage)
      const apiResult = await chrome.storage.sync.get('jtToolsApiKey');
      if (apiResult.jtToolsApiKey) {
        return apiResult.jtToolsApiKey;
      }

      return null;
    } catch (error) {
      return null;
    }
  }

  /**
   * Fetch budget backups for a job
   * @param {string} jobId - Job ID
   * @returns {Promise<Array>} Array of backup objects
   */
  async function fetchBudgetBackups(jobId) {
    // Get grant key from any available source
    const grantKey = await getGrantKey();

    if (!grantKey) {
      throw new Error('No API configured. Please enter your Grant Key in the extension popup.');
    }

    return await fetchBackupsWithKey(jobId, grantKey);
  }

  /**
   * Fetch backups using a Grant Key directly
   * Makes a direct Pave API call without relying on JobTreadAPI service
   * @param {string} jobId - Job ID
   * @param {string} grantKey - JobTread Grant Key
   * @returns {Promise<Array>} Array of backup objects
   */
  async function fetchBackupsWithKey(jobId, grantKey) {
    let allBackups = [];
    let cursor = null;
    let page = 0;
    const PAGE_SIZE = 100;
    // Defend against the API echoing the same cursor back twice — an infinite
    // pagination loop in the wild would otherwise only terminate at the 50-page
    // safety cap (5000 rows) and spam the server along the way.
    const seenCursors = new Set();

    do {
      page++;
      const paginationParams = {
        size: PAGE_SIZE,
        sortBy: [{ field: 'createdAt', order: 'desc' }]
      };
      if (cursor) {
        paginationParams.page = cursor;
      }

      const innerQuery = {
        job: {
          $: { id: jobId },
          jobBudgetBackups: {
            $: paginationParams,
            nextPage: {},
            nodes: {
              id: {},
              createdAt: {},
              createdByUser: {
                name: {}
              },
              url: {
                $: { download: true }
              }
            }
          }
        }
      };

      const wrappedQuery = {
        query: {
          $: { grantKey: grantKey },
          ...innerQuery
        }
      };

      if (DEBUG) console.log(`BudgetChangelog: Fetching backups page ${page}`);

      const response = await makePaveRequest(wrappedQuery);

      if (response.errors && response.errors.length > 0) {
        throw new Error(response.errors[0].message || 'Query failed');
      }

      if (!response?.job) {
        throw new Error('Unexpected API response — job data not found. Grant key may not have access to this job.');
      }

      const backupData = response.job.jobBudgetBackups;
      const nodes = backupData?.nodes || [];

      allBackups = allBackups.concat(nodes.map(backup => ({
        id: backup.id,
        createdAt: backup.createdAt,
        createdByUser: backup.createdByUser,
        url: backup.url
      })));

      const nextCursor = backupData?.nextPage || null;

      if (DEBUG) console.log(`BudgetChangelog: Page ${page}: ${nodes.length} backups, nextPage: ${!!nextCursor}`);

      // Stop if the API handed us a cursor we've already followed — this
      // would otherwise be an infinite loop bounded only by the 50-page cap.
      if (nextCursor && seenCursors.has(nextCursor)) {
        console.warn('BudgetChangelog: pagination cursor repeated, stopping early at page', page);
        cursor = null;
      } else {
        if (nextCursor) seenCursors.add(nextCursor);
        cursor = nextCursor;
      }

    } while (cursor && page < 50); // Safety cap at 50 pages (5000 backups)

    console.log(`BudgetChangelog: Total backups fetched: ${allBackups.length}`);
    return allBackups;
  }

  /**
   * Make a Pave API request
   * In MV3, content scripts use the web page's origin for fetch() calls.
   * Since we run on app.jobtread.com, we can call api.jobtread.com directly
   * (JobTread's API allows CORS from its own app domain).
   * This avoids unreliable service worker async messaging on Safari.
   * Falls back to background service worker proxy if direct fetch fails.
   * @param {Object} query - Wrapped Pave query
   * @returns {Promise<Object>} API response
   */
  async function makePaveRequest(query) {
    const API_URL = 'https://api.jobtread.com/pave';
    const fetchOptions = {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(query)
    };

    // Strategy 1: Direct fetch (MV3 content scripts inherit page origin)
    try {
      const response = await fetch(API_URL, fetchOptions);
      if (!response.ok) {
        throw new Error(`API Error ${response.status}: ${response.statusText}`);
      }
      const data = await response.json();
      if (DEBUG) console.log('BudgetChangelog: Direct fetch succeeded');
      return data;
    } catch (directError) {
      if (DEBUG) console.log('BudgetChangelog: Direct fetch failed, trying service worker proxy:', directError.message);
    }

    // Strategy 2: Route through background service worker (CORS bypass)
    try {
      const result = await chrome.runtime.sendMessage({
        type: 'JOBTREAD_API_REQUEST',
        url: API_URL,
        options: fetchOptions
      });

      if (!result) {
        throw new Error('No response from background script (Safari async messaging issue)');
      }

      if (!result.success) {
        throw new Error(result.error || `API Error: ${result.status}`);
      }

      return result.data;
    } catch (proxyError) {
      console.error('BudgetChangelog: Pave request failed (both direct and proxy):', proxyError.message);
      throw proxyError;
    }
  }

  // Public API
  return {
    init,
    cleanup,
    isActive: () => isActive
  };
})();

// Export for use in main content script
if (typeof window !== 'undefined') {
  window.BudgetChangelogFeature = BudgetChangelogFeature;
}
