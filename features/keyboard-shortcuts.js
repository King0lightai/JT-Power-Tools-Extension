// JT Power Tools - Keyboard Shortcuts Enhancement
// Injects missing JT native shortcuts AND JT Power Tools shortcuts
// into JobTread's native Shift+? keyboard shortcuts modal
// Always enabled — no user toggle needed

const KeyboardShortcutsFeature = (() => {
  let isActive = false;
  let observer = null;

  // ID for the injected container so we can detect duplicates
  const INJECTED_ID = 'jt-power-tools-shortcuts';

  // Key badge classes matching JT's native style exactly
  const KEY_CLS = 'bg-gray-100 rounded-sm border border-gray-400 shadow-sm inline-flex items-center justify-center text-xs mx-1 font-bold py-1 px-1 w-6 min-w-max';

  // ── Shortcut definitions ─────────────────────────────────────────
  // Missing JT native shortcuts (not shown in Shift+? modal but documented by JT)

  const JT_MISSING_SECTIONS = [
    {
      title: 'Job Actions',
      color: '#10b981', // green to match JT's reference
      shortcuts: [
        { label: 'New Document', keys: ['n', 'd'] },
        { label: 'New Task', keys: ['n', 't'] },
        { label: 'New To-Do', keys: ['n', 'o'] },
        { label: 'New Time Entry', keys: ['n', 'i'] },
        { label: 'New Daily Log', keys: ['n', 'l'] },
        { label: 'New Expense', keys: ['n', 'e'] },
        { label: 'Open Job Switcher', keys: ['n', 's'] },
        { label: 'New Job Message', keys: ['n', 'm'] },
      ]
    },
    {
      title: 'Budget Actions',
      color: '#f59e0b', // amber
      shortcuts: [
        { label: 'Add Cost Item', keys: ['n', 'i'] },
        { label: 'Add Cost Group', keys: ['n', 'g'] },
      ]
    },
    {
      title: 'Catalog Actions',
      color: '#8b5cf6', // purple
      shortcuts: [
        { label: 'New Cost Group', keys: ['n', 'g'] },
        { label: 'New Schedule Template', keys: ['n', 's'] },
        { label: 'New To-Do Template', keys: ['n', 'd'] },
        { label: 'Open Global Catalog', keys: ['g', 'c'] },
      ]
    },
    {
      title: 'Schedule & To-Do Actions',
      color: '#ec4899', // pink
      shortcuts: [
        { label: 'Go to List View', keys: ['l'] },
        { label: 'Go to Gantt View', keys: ['g'] },
        { label: 'Go to Month View', keys: ['m'] },
        { label: 'Go to Week View', keys: ['w'] },
        { label: 'Go to Day View', keys: ['d'] },
        { label: 'Go to Kanban View', keys: ['k'] },
        { label: 'Select all Tasks', keys: ['cmd/ctrl', 'a'] },
      ]
    },
  ];

  // Also add missing items to existing native sections
  const JT_MISSING_NAVIGATION = [
    { label: 'Go to Messages', keys: ['g', 'm'] },
    { label: 'Go to Custom Fields', keys: ['g', 's', 'c'] },
    { label: 'Go to Integrations', keys: ['g', 's', 'i'] },
    { label: 'Go to Marketplace', keys: ['s', 'm', 'a'] },
    { label: 'Go to Billing', keys: ['s', 'b'] },
  ];

  const JT_MISSING_GENERAL = [
    { label: 'Save Changes', keys: ['cmd/ctrl', 's'] },
    { label: 'Redo', keys: ['cmd/ctrl', 'shift', 'z'] },
  ];

  // JT Power Tools shortcuts
  const POWER_TOOLS_SHORTCUTS = [
    { label: 'Toggle Quick Notes', keys: ['q', 'n'] },
    { label: 'Bold Text', keys: ['ctrl', 'b'] },
    { label: 'Italic Text', keys: ['ctrl', 'i'] },
    { label: 'Underline Text', keys: ['ctrl', 'u'] },
  ];

  // ── DOM builders ─────────────────────────────────────────────────

  /**
   * Build a single shortcut row matching JT's native HTML structure
   */
  function buildRow(shortcut, isDark) {
    const li = document.createElement('li');
    li.className = 'p-1 flex flex-1';

    const label = document.createElement('div');
    label.className = 'flex-1';
    label.textContent = shortcut.label;
    if (isDark) label.style.color = '#e0e0e0';
    li.appendChild(label);

    for (const key of shortcut.keys) {
      const badge = document.createElement('span');
      badge.className = KEY_CLS;
      badge.textContent = key;
      if (isDark) {
        badge.style.background = '#404040';
        badge.style.borderColor = '#606060';
        badge.style.color = '#e0e0e0';
      }
      li.appendChild(badge);
    }

    return li;
  }

  /**
   * Build a standard JT-styled section (for missing native shortcuts)
   */
  function buildNativeSection(title, shortcuts, titleColor, isDark) {
    const wrapper = document.createElement('div');
    wrapper.className = 'break-inside-avoid p-2';

    const card = document.createElement('div');
    card.className = 'rounded-sm bg-gray-100 p-2';
    if (isDark) {
      card.style.background = '#333';
    }

    const header = document.createElement('div');
    header.className = 'font-semibold text-lg border-b pb-1 mb-1 px-1';
    header.textContent = title;
    header.style.color = titleColor;
    if (isDark) header.style.borderColor = '#505050';
    card.appendChild(header);

    const ul = document.createElement('ul');
    for (const s of shortcuts) {
      ul.appendChild(buildRow(s, isDark));
    }
    card.appendChild(ul);

    wrapper.appendChild(card);
    return wrapper;
  }

  /**
   * Build the JT Power Tools branded section
   */
  function buildPowerToolsSection(isDark) {
    const wrapper = document.createElement('div');
    wrapper.className = 'break-inside-avoid p-2';

    const card = document.createElement('div');
    card.className = 'rounded-sm p-2';
    if (isDark) {
      card.style.cssText = 'background: #2a2a3d; border: 1px solid #505060;';
    } else {
      card.style.cssText = 'background: linear-gradient(135deg, #eef2ff 0%, #e0e7ff 100%); border: 1px solid #c7d2fe;';
    }

    const header = document.createElement('div');
    header.className = 'font-semibold text-lg border-b pb-1 mb-1 px-1 flex items-center gap-2';
    header.style.borderColor = isDark ? '#505060' : '#a5b4fc';

    const iconColor = isDark ? '#818cf8' : '#6366f1';
    const titleColor = isDark ? '#a5b4fc' : '#4f46e5';

    header.innerHTML = `
      <svg xmlns="http://www.w3.org/2000/svg" fill="none" stroke="${iconColor}" stroke-linecap="round" stroke-linejoin="round" stroke-width="2" style="height: 18px; width: 18px; flex-shrink: 0;" viewBox="0 0 24 24">
        <path d="M13 2 3 14h9l-1 8 10-12h-9z"></path>
      </svg>
      <span style="color: ${titleColor};">JT Power Tools</span>
    `;
    card.appendChild(header);

    const ul = document.createElement('ul');
    for (const s of POWER_TOOLS_SHORTCUTS) {
      ul.appendChild(buildRow(s, isDark));
    }
    card.appendChild(ul);

    wrapper.appendChild(card);
    return wrapper;
  }

  // ── Modal detection & injection ──────────────────────────────────

  /**
   * Find the keyboard shortcuts modal in the DOM.
   */
  function findShortcutsModal() {
    const modals = document.querySelectorAll('.m-auto.shadow-lg.rounded-sm.bg-white.max-w-4xl');
    for (const modal of modals) {
      const header = modal.querySelector('.text-cyan-500.uppercase');
      if (header) {
        const text = (header.textContent || '').toUpperCase();
        if (text.includes('KEYBOARD') || text.includes('SHORTCUT')) {
          return modal;
        }
      }
    }
    return null;
  }

  /**
   * Append missing shortcuts to an existing native section (Navigation or Actions)
   */
  function appendToExistingSection(contentArea, sectionTitle, missingShortcuts, isDark) {
    const sections = contentArea.querySelectorAll('.font-semibold.text-lg');
    for (const header of sections) {
      if (header.textContent.trim() === sectionTitle) {
        const ul = header.parentElement.querySelector('ul');
        if (ul) {
          for (const s of missingShortcuts) {
            // Check if this shortcut already exists
            const existing = [...ul.querySelectorAll('.flex-1')].some(
              el => el.textContent.trim() === s.label
            );
            if (!existing) {
              ul.appendChild(buildRow(s, isDark));
            }
          }
        }
        return;
      }
    }
  }

  /**
   * Inject all missing sections and Power Tools shortcuts into the modal
   */
  function injectShortcuts() {
    if (!isActive) return;
    if (document.getElementById(INJECTED_ID)) return;

    const modal = findShortcutsModal();
    if (!modal) return;

    // The content area is the second child (index 1) with CSS columns
    const contentArea = modal.children[1];
    if (!contentArea) return;

    const isDark = document.body.classList.contains('jt-dark-mode') ||
                   (window.DarkModeFeature && window.DarkModeFeature.isActive());

    // If dark mode, style the existing modal
    if (isDark) {
      applyDarkModeToModal(modal);
    }

    // 1. Append missing items to existing Navigation and Actions sections
    appendToExistingSection(contentArea, 'Navigation', JT_MISSING_NAVIGATION, isDark);
    appendToExistingSection(contentArea, 'Actions', JT_MISSING_GENERAL, isDark);

    // 2. Create a wrapper div to track all our injections (for cleanup)
    const injectedContainer = document.createElement('div');
    injectedContainer.id = INJECTED_ID;
    injectedContainer.style.display = 'contents'; // Don't affect column layout

    // 3. Add missing JT native sections
    for (const section of JT_MISSING_SECTIONS) {
      injectedContainer.appendChild(
        buildNativeSection(section.title, section.shortcuts, section.color, isDark)
      );
    }

    // 4. Add JT Power Tools section
    injectedContainer.appendChild(buildPowerToolsSection(isDark));

    contentArea.appendChild(injectedContainer);

    console.log('KeyboardShortcuts: Injected shortcuts into modal');
  }

  /**
   * Apply dark mode styling to the native modal elements
   */
  function applyDarkModeToModal(modal) {
    // Modal background
    modal.style.background = '#2c2c2c';
    modal.style.color = '#e0e0e0';

    // Header bar
    const headerBar = modal.children[0];
    if (headerBar) {
      headerBar.style.background = '#252525';
      headerBar.style.borderBottomColor = '#404040';
    }

    // Content cards
    const cards = modal.querySelectorAll('.rounded-sm.bg-gray-100');
    for (const card of cards) {
      card.style.background = '#333';
    }

    // Section headers
    const headers = modal.querySelectorAll('.font-semibold.text-lg');
    for (const h of headers) {
      h.style.borderColor = '#505050';
    }

    // All key badges
    const badges = modal.querySelectorAll('span.rounded-sm.border');
    for (const badge of badges) {
      if (badge.classList.contains('shadow-sm')) {
        badge.style.background = '#404040';
        badge.style.borderColor = '#606060';
        badge.style.color = '#e0e0e0';
      }
    }

    // All labels
    const labels = modal.querySelectorAll('li .flex-1');
    for (const label of labels) {
      label.style.color = '#e0e0e0';
    }

    // Footer
    const footer = modal.children[2];
    if (footer) {
      footer.style.background = '#252525';
      footer.style.borderTopColor = '#404040';
    }

    // Close button in footer
    const closeBtn = footer?.querySelector('[role="button"]');
    if (closeBtn) {
      closeBtn.style.background = '#333';
      closeBtn.style.color = '#e0e0e0';
      closeBtn.style.borderColor = '#505050';
    }

    // Close button in header
    const headerCloseBtn = modal.children[0]?.querySelector('[role="button"]');
    if (headerCloseBtn) {
      headerCloseBtn.style.background = '#333';
      headerCloseBtn.style.color = '#e0e0e0';
      headerCloseBtn.style.borderColor = '#505050';
    }
  }

  // ── Observer ─────────────────────────────────────────────────────

  function startObserver() {
    if (observer) return;

    observer = new MutationObserver((mutations) => {
      if (!isActive) return;

      for (const mutation of mutations) {
        if (mutation.type !== 'childList' || mutation.addedNodes.length === 0) continue;

        for (const node of mutation.addedNodes) {
          if (node.nodeType !== Node.ELEMENT_NODE) continue;

          // Check if the added node IS the modal or CONTAINS the modal
          const isModal = node.classList?.contains('shadow-lg') &&
                         node.classList?.contains('max-w-4xl');
          const containsModal = node.querySelector?.('.m-auto.shadow-lg.rounded-sm.bg-white.max-w-4xl');

          if (isModal || containsModal) {
            // Small delay to let the modal fully render
            setTimeout(injectShortcuts, 50);
          }
        }
      }
    });

    observer.observe(document.body, {
      childList: true,
      subtree: true
    });
  }

  // ── Lifecycle ────────────────────────────────────────────────────

  function init() {
    if (isActive) return;
    isActive = true;

    // Try to inject immediately if modal is already open
    injectShortcuts();

    // Start observing for modal appearances
    startObserver();

    console.log('KeyboardShortcuts: Activated');
  }

  function cleanup() {
    if (!isActive) return;
    isActive = false;

    if (observer) {
      observer.disconnect();
      observer = null;
    }

    // Remove injected sections
    const container = document.getElementById(INJECTED_ID);
    if (container) container.remove();

    console.log('KeyboardShortcuts: Deactivated');
  }

  return {
    init,
    cleanup,
    isActive: () => isActive
  };
})();

window.KeyboardShortcutsFeature = KeyboardShortcutsFeature;
