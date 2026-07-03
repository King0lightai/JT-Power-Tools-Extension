// Action Items Completion Module
// Adds checkboxes to Action Items card for quick task completion

const ActionItemsCompletion = (() => {
  // Feature state
  let isActive = false;
  let observer = null;
  let debounceTimer = null;

  // Track which action items have checkboxes added
  const processedItems = new WeakSet();

  /**
   * Initialize action items completion feature
   */
  function init() {
    if (isActive) {
      return;
    }

    isActive = true;

    // Add checkboxes to action items
    addCompletionCheckboxes();

    // Watch for changes to the Action Items card. The previous observer ran the
    // full card scan on EVERY DOM mutation page-wide and re-fired on its own
    // checkbox inserts. Now we (a) ignore mutations whose only added nodes are
    // our own checkboxes, (b) require at least one added element, and
    // (c) debounce, so the scan runs at most once per quiet 200ms window.
    observer = new MutationObserver((mutations) => {
      let relevant = false;
      for (const m of mutations) {
        for (const node of m.addedNodes) {
          if (node.nodeType === Node.ELEMENT_NODE &&
              !(node.classList && node.classList.contains('jt-action-item-checkbox'))) {
            relevant = true;
            break;
          }
        }
        if (relevant) break;
      }
      if (!relevant) return;

      if (debounceTimer) clearTimeout(debounceTimer);
      debounceTimer = setTimeout(() => {
        debounceTimer = null;
        addCompletionCheckboxes();
      }, 200);
    });

    observer.observe(document.body, {
      childList: true,
      subtree: true
    });
  }

  /**
   * Find the Action Items card on the page
   * @returns {HTMLElement|null} The Action Items card container
   */
  function findActionItemsCard() {
    // Look for a heading that says "Action Items"
    const headings = document.querySelectorAll('h2, h3, h4, div.font-bold, span.font-bold');

    for (const heading of headings) {
      if (heading.textContent.trim() === 'Action Items') {
        // Find the parent container
        const card = heading.closest('div.bg-white, div.rounded, div.shadow, div[class*="card"]');
        if (card) {
          return card;
        }
      }
    }

    return null;
  }

  /**
   * Add completion checkboxes to all action items
   */
  function addCompletionCheckboxes() {
    const card = findActionItemsCard();
    if (!card) {
      return;
    }

    // Find all action item links
    // These are <a> tags with href containing /schedule?taskId= or /to-dos
    const actionItems = card.querySelectorAll('a[href*="/schedule?taskId="], a[href*="/to-dos"]');

    actionItems.forEach(item => {
      // Skip if already processed
      if (processedItems.has(item)) {
        return;
      }

      // Skip if checkbox already exists
      if (item.querySelector('.jt-action-item-checkbox')) {
        return;
      }

      // Extract task ID from href
      const taskId = extractTaskId(item.getAttribute('href'));
      if (!taskId) {
        return;
      }

      // Create checkbox button (always unchecked - if task is complete, it won't be in Action Items)
      const checkbox = createCheckboxButton(false);

      // Find the View button
      const viewButton = findViewButton(item);
      if (!viewButton) {
        return;
      }

      // Insert checkbox before the View button
      viewButton.parentNode.insertBefore(checkbox, viewButton);

      // Mark as processed
      processedItems.add(item);

      // Add click handler
      checkbox.addEventListener('click', (e) => handleCheckboxClick(e, item, checkbox, taskId));
    });
  }

  /**
   * Extract task ID from href
   * @param {string} href - The href attribute value
   * @returns {string|null} The task ID or null
   */
  function extractTaskId(href) {
    if (!href) return null;

    // Extract from /schedule?taskId=XXXXX
    const taskIdMatch = href.match(/taskId=([^&]+)/);
    if (taskIdMatch) {
      return taskIdMatch[1];
    }

    // Extract from /to-dos/XXXXX
    const todoMatch = href.match(/\/to-dos\/([^/?]+)/);
    if (todoMatch) {
      return todoMatch[1];
    }

    return null;
  }

  /**
   * Find the View button in an action item
   * @param {HTMLElement} item - The action item link element
   * @returns {HTMLElement|null} The View button or null
   */
  function findViewButton(item) {
    // Look for a button with text "View" inside the item
    const buttons = item.querySelectorAll('div[role="button"]');

    for (const button of buttons) {
      const text = button.textContent.trim();
      if (text === 'View' || text.toLowerCase().includes('view')) {
        return button;
      }
    }

    // Fallback: look for any element with "View" text inside item
    const allDivs = item.querySelectorAll('div');
    for (const div of allDivs) {
      if (div.textContent.trim() === 'View') {
        return div;
      }
    }

    // Extended fallback: search parent container for View button
    // The View button might be a sibling or in a flex container
    const parent = item.parentElement;
    if (parent) {
      const siblingButtons = parent.querySelectorAll('div[role="button"]');
      for (const button of siblingButtons) {
        const text = button.textContent.trim();
        if (text === 'View' || text.toLowerCase().includes('view')) {
          return button;
        }
      }
    }

    // Last resort: find the first button-like element in the item
    const firstButton = item.querySelector('[role="button"], button');
    if (firstButton) {
      return firstButton;
    }

    return null;
  }

  /**
   * Create the checkbox button element
   * @param {boolean} isComplete - Whether the task is currently complete
   * @returns {HTMLElement} The checkbox button
   */
  function createCheckboxButton(isComplete = false) {
    const button = document.createElement('div');
    button.className = 'jt-action-item-checkbox inline-block align-middle cursor-pointer p-1 rounded hover:bg-gray-100';
    button.setAttribute('role', 'button');
    button.setAttribute('tabindex', '0');
    button.style.cssText = 'margin-right: 8px; flex-shrink: 0;';

    // Create SVG checkbox icon
    const svg = window.UIUtils.createCheckboxSvg(isComplete, {
      className: 'inline-block overflow-visible',
      width: '20',
      height: '20'
    });

    button.appendChild(svg);

    // Add title for tooltip
    button.setAttribute('title', isComplete ? 'Task marked complete' : 'Mark task complete');

    return button;
  }

  /**
   * Handle checkbox click
   * @param {Event} e - The click event
   * @param {HTMLElement} item - The action item link element
   * @param {HTMLElement} checkbox - The checkbox button element
   * @param {string} taskId - The task ID
   */
  function handleCheckboxClick(e, item, checkbox, taskId) {
    // Prevent default link navigation
    e.stopPropagation();
    e.preventDefault();

    // Show loading state
    checkbox.style.opacity = '0.5';
    checkbox.style.pointerEvents = 'none';

    // Get the target URL
    const targetUrl = item.getAttribute('href');

    // Complete the task in a hidden iframe (no page navigation)
    // The iframe URL includes a marker hash so content.js skips feature initialization
    completeTaskInIframe(targetUrl, taskId, item, (success) => {
      if (success) {
        // Fade out and remove the action item from the list
        item.style.transition = 'opacity 0.3s ease-out';
        item.style.opacity = '0';

        setTimeout(() => {
          item.remove();
        }, 300);

        // Show notification
        if (window.UIUtils) {
          window.UIUtils.showNotification('Task completed');
        }
      } else {
        // Restore checkbox
        checkbox.style.opacity = '';
        checkbox.style.pointerEvents = '';

        // Show error notification
        if (window.UIUtils) {
          window.UIUtils.showNotification('Failed to complete task');
        }
      }
    });
  }

  /**
   * Complete a task in a hidden iframe (no visible page navigation)
   * Appends #jt-completion-iframe to the URL so that content.js detects
   * the marker and skips all feature initialization inside the iframe.
   * This prevents injected checkboxes from interfering with sidebar detection.
   * @param {string} targetUrl - The URL of the task page
   * @param {string} taskId - The task ID
   * @param {HTMLElement} item - The action item element
   * @param {Function} callback - Callback function (success: boolean)
   */
  function completeTaskInIframe(targetUrl, taskId, item, callback) {
    // The task page is a full SPA that boots inside the hidden iframe. Its boot
    // time is variable and occasionally the SPA fails to mount at all (empty
    // body). The old fixed-setTimeout chain (2.5s to find the sidebar) lost that
    // race and reported failure. Instead we poll for readiness and retry the
    // iframe load once if the SPA never mounts.
    const MAX_ATTEMPTS = 2;          // one retry covers the intermittent no-boot
    const OVERALL_TIMEOUT_MS = 30000; // hard backstop across all attempts
    const READY_TIMEOUT_MS = 10000;  // per-attempt: wait for the Progress control
    const SAVE_ENABLE_TIMEOUT_MS = 4000;

    let finished = false;
    let currentIframe = null;

    const overallFailsafe = setTimeout(() => finish(false), OVERALL_TIMEOUT_MS);

    function finish(success) {
      if (finished) return;
      finished = true;
      clearTimeout(overallFailsafe);
      if (currentIframe && currentIframe.parentNode) {
        currentIframe.remove();
      }
      callback(success);
    }

    // Poll getValue() until it returns a truthy value or the timeout elapses.
    // Resolves with the value, or null on timeout / if we've already finished.
    function pollFor(getValue, timeoutMs) {
      return new Promise((resolve) => {
        const start = Date.now();
        (function check() {
          if (finished) return resolve(null);
          let value = null;
          try { value = getValue(); } catch (e) { value = null; }
          if (value) return resolve(value);
          if (Date.now() - start >= timeoutMs) return resolve(null);
          setTimeout(check, 100);
        })();
      });
    }

    function retryOrFail(attempt) {
      if (finished) return;
      if (currentIframe && currentIframe.parentNode) {
        currentIframe.remove();
      }
      if (attempt + 1 < MAX_ATTEMPTS) {
        console.log('ActionItems: iframe did not become ready, retrying');
        runAttempt(attempt + 1);
      } else {
        finish(false);
      }
    }

    function runAttempt(attempt) {
      if (finished) return;

      // Hidden, off-screen, full-size iframe (no sandbox so the app fully renders)
      const iframe = document.createElement('iframe');
      iframe.style.cssText = 'position: absolute; top: -9999px; left: -9999px; width: 1920px; height: 1080px; opacity: 0; pointer-events: none; border: none;';
      currentIframe = iframe;

      iframe.onload = async () => {
        if (finished) return;

        let iframeDoc;
        try {
          iframeDoc = iframe.contentDocument || iframe.contentWindow.document;
        } catch (e) {
          return retryOrFail(attempt);
        }

        // Wait for the Progress checkbox to render. findProgressCheckboxInDoc
        // resolves the sidebar + Progress label + button, so this single poll
        // covers "SPA still booting" and "sidebar not populated yet". If it
        // never appears, the SPA likely didn't mount — retry the load.
        const progressCheckbox = await pollFor(
          () => findProgressCheckboxInDoc(iframeDoc), READY_TIMEOUT_MS
        );
        if (finished) return;
        if (!progressCheckbox) {
          return retryOrFail(attempt);
        }

        progressCheckbox.click();

        // Wait for the Save button to appear, then for it to become enabled.
        const saveButton = await pollFor(
          () => findSaveButtonInDoc(iframeDoc), SAVE_ENABLE_TIMEOUT_MS
        );
        if (finished) return;
        if (!saveButton) {
          return finish(false);
        }

        const isEnabled = await waitForSaveButtonEnabledInDoc(saveButton, SAVE_ENABLE_TIMEOUT_MS);
        if (finished) return;
        if (!isEnabled) {
          return finish(false);
        }

        // Click Save (plus a synthetic event for React compatibility)
        saveButton.click();
        saveButton.dispatchEvent(new MouseEvent('click', {
          bubbles: true,
          cancelable: true,
          view: iframe.contentWindow
        }));

        // Give the save request time to flush before tearing down the iframe.
        setTimeout(() => finish(true), 1500);
      };

      iframe.onerror = () => retryOrFail(attempt);

      // Marker hash makes content.js skip feature init inside the iframe.
      document.body.appendChild(iframe);
      const markerHash = '#jt-completion-iframe';
      iframe.src = targetUrl.includes('#') ? targetUrl : targetUrl + markerHash;
    }

    runAttempt(0);
  }

  /**
   * Find the progress checkbox in a document (iframe)
   * @param {Document} doc - The iframe document to search in
   * @returns {HTMLElement|null} The progress checkbox or null
   */
  function findProgressCheckboxInDoc(doc) {
    // Try multiple sidebar selectors for robustness
    const sidebarSelectors = [
      'div.overflow-y-auto.overscroll-contain.sticky',
      'div.sticky.overflow-y-auto',
      'div[data-is-drag-scroll-boundary="true"]',
      'div.overflow-y-auto.sticky',
      'div.sticky[class*="overflow"]'
    ];

    let sidebar = null;
    for (const selector of sidebarSelectors) {
      sidebar = doc.querySelector(selector);
      if (sidebar) break;
    }

    // Fallback: search the entire document
    const searchRoot = sidebar || doc.body;

    // Find "Progress" label
    const allLabels = Array.from(searchRoot.querySelectorAll('span.font-bold'));
    const progressLabel = allLabels.find(el => el.textContent.trim() === 'Progress');

    if (!progressLabel) return null;

    // Find the container with Progress label
    const progressContainer = progressLabel.closest('div.flex.items-center.space-x-1');
    if (!progressContainer) return null;

    // Find the checkbox button in the progress container
    const button = progressContainer.querySelector('div[role="button"]');
    return button || null;
  }

  /**
   * Find the Save button in a document
   * @param {Document} doc - The iframe document to search in
   * @returns {HTMLElement|null} The Save button or null
   */
  function findSaveButtonInDoc(doc) {
    const allButtons = Array.from(doc.querySelectorAll('div[role="button"], [role="button"], button'));

    for (const button of allButtons) {
      const text = button.textContent.trim();

      // Check for Save text (primary method)
      if (text.includes('Save')) {
        // Verify it has a checkmark icon (various possible paths)
        const hasCheckmark = button.querySelector('path[d="M20 6 9 17l-5-5"]') ||
                            button.querySelector('path[d*="M20 6"]') ||
                            button.querySelector('path[d*="9 17"]') ||
                            button.querySelector('svg');

        if (hasCheckmark) {
          return button;
        }
      }
    }

    // Fallback: find button with just "Save" text
    for (const button of allButtons) {
      const text = button.textContent.trim();
      if (text === 'Save' || text.startsWith('Save')) {
        return button;
      }
    }

    return null;
  }

  /**
   * Wait for a Save button element to become enabled
   * @param {HTMLElement} button - The Save button element from iframe document
   * @param {number} maxWaitMs - Maximum time to wait in milliseconds
   * @returns {Promise<boolean>} True if button became enabled, false if timeout
   */
  function waitForSaveButtonEnabledInDoc(button, maxWaitMs = 2000) {
    return new Promise((resolve) => {
      const startTime = Date.now();

      const checkEnabled = () => {
        const classes = button.className;
        const isDisabled = classes.includes('pointer-events-none');

        if (!isDisabled) {
          resolve(true);
          return;
        }

        if (Date.now() - startTime >= maxWaitMs) {
          resolve(false);
          return;
        }

        setTimeout(checkEnabled, 100);
      };

      checkEnabled();
    });
  }

  /**
   * Cleanup function
   */
  function cleanup() {
    if (!isActive) {
      return;
    }

    isActive = false;

    // Clear any pending debounced scan
    if (debounceTimer) {
      clearTimeout(debounceTimer);
      debounceTimer = null;
    }

    // Disconnect observer
    if (observer) {
      observer.disconnect();
      observer = null;
    }

    // Remove all checkboxes
    const checkboxes = document.querySelectorAll('.jt-action-item-checkbox');
    checkboxes.forEach(checkbox => checkbox.remove());
  }

  // Public API
  return {
    init,
    cleanup,
    addCompletionCheckboxes,
    isActive: () => isActive
  };
})();

// Export for use in other modules
if (typeof window !== 'undefined') {
  window.ActionItemsCompletion = ActionItemsCompletion;
}
