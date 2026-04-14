/**
 * Job Access Section Collapse
 * Adds per-section collapse toggles to the Job Access panel in job dashboards.
 * State persisted in Chrome storage so sections stay collapsed across page loads.
 */
const JobAccessCollapseFeature = (() => {
  let isActive = false;
  let observer = null;
  const STORAGE_KEY = 'jobAccessCollapsed';
  let collapsedState = {};

  // Chevron SVG for toggle buttons
  const CHEVRON_RIGHT = '<svg xmlns="http://www.w3.org/2000/svg" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2" class="inline-block overflow-visible" style="width:12px;height:12px;transition:transform 0.15s ease" viewBox="0 0 24 24"><path d="m9 18 6-6-6-6"></path></svg>';

  async function init() {
    if (isActive) return;
    isActive = true;

    // Load persisted state
    try {
      const result = await chrome.storage.sync.get(STORAGE_KEY);
      collapsedState = result[STORAGE_KEY] || {};
    } catch (e) {
      console.error('JobAccessCollapse: Failed to load state:', e);
      collapsedState = {};
    }

    applyToPage();

    // Watch for SPA navigation / new panels
    observer = new MutationObserver(() => {
      applyToPage();
    });
    observer.observe(document.body, { childList: true, subtree: true });

    console.log('JobAccessCollapse: Initialized');
  }

  function applyToPage() {
    // Find Job Access header: "JOB ACCESS" text in orange uppercase font-bold
    const headers = document.querySelectorAll('div.font-bold.uppercase');
    for (const header of headers) {
      if (header.textContent.trim() !== 'Job Access') continue;

      const panel = header.closest('div.space-y-1');
      if (!panel) continue;

      const userListContainer = panel.querySelector('div.rounded-sm.border.divide-y');
      if (!userListContainer) continue;

      // Find all section divs with a section label
      const sections = userListContainer.querySelectorAll(':scope > div.p-2.space-y-1');
      for (const section of sections) {
        const label = section.querySelector('div.text-xs.uppercase.font-bold.text-gray-500');
        if (!label) continue;

        // Skip "Other Users with Access" — it already has JT's native toggle
        if (label.getAttribute('role') === 'button') continue;

        // Skip if already enhanced
        if (label.dataset.jtCollapseEnhanced) continue;
        label.dataset.jtCollapseEnhanced = 'true';

        const sectionName = label.textContent.trim();

        // Make label clickable
        label.style.cursor = 'pointer';
        label.style.userSelect = 'none';
        label.style.display = 'flex';
        label.style.alignItems = 'center';
        label.style.gap = '4px';

        // Insert chevron
        const chevronSpan = document.createElement('span');
        chevronSpan.innerHTML = CHEVRON_RIGHT;
        chevronSpan.className = 'jt-collapse-chevron';
        label.insertBefore(chevronSpan, label.firstChild);

        // Get user rows within this section
        const userRows = section.querySelectorAll(':scope > div.flex.items-center.space-x-1\\.5');

        // Apply persisted state
        const isCollapsed = collapsedState[sectionName] === true;
        applyCollapseState(chevronSpan, userRows, isCollapsed);

        // Click handler
        label.addEventListener('click', () => {
          const nowCollapsed = !collapsedState[sectionName];
          collapsedState[sectionName] = nowCollapsed;
          applyCollapseState(chevronSpan, userRows, nowCollapsed);
          saveState();
        });
      }
    }
  }

  function applyCollapseState(chevronSpan, userRows, isCollapsed) {
    const svg = chevronSpan.querySelector('svg');
    if (svg) {
      svg.style.transform = isCollapsed ? 'rotate(0deg)' : 'rotate(90deg)';
    }
    for (const row of userRows) {
      row.style.display = isCollapsed ? 'none' : '';
    }
  }

  function saveState() {
    try {
      chrome.storage.sync.set({ [STORAGE_KEY]: collapsedState });
    } catch (e) {
      console.error('JobAccessCollapse: Failed to save state:', e);
    }
  }

  function cleanup() {
    if (!isActive) return;
    isActive = false;

    if (observer) {
      observer.disconnect();
      observer = null;
    }

    // Remove all injected chevrons and restore display
    const enhanced = document.querySelectorAll('[data-jt-collapse-enhanced]');
    for (const label of enhanced) {
      delete label.dataset.jtCollapseEnhanced;
      label.style.cursor = '';
      label.style.userSelect = '';
      label.style.display = '';
      label.style.gap = '';

      const chevron = label.querySelector('.jt-collapse-chevron');
      if (chevron) chevron.remove();

      const section = label.closest('div.p-2.space-y-1');
      if (section) {
        const rows = section.querySelectorAll(':scope > div.flex.items-center');
        for (const row of rows) {
          row.style.display = '';
        }
      }
    }

    console.log('JobAccessCollapse: Cleaned up');
  }

  return {
    init,
    cleanup,
    isActive: () => isActive
  };
})();

window.JobAccessCollapseFeature = JobAccessCollapseFeature;
