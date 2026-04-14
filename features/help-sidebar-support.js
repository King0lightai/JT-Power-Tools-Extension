// JT Power Tools - Help Sidebar Support Feature
// Adds a support section at the bottom of JobTread's help sidebar
//
// Dependencies: utils/color-utils.js (ColorUtils)

const HelpSidebarSupportFeature = (() => {
  let isActive = false;
  let observer = null;
  let injectedElement = null;

  // Use shared ColorUtils module
  const { adjustBrightness } = window.ColorUtils || {};

  // Initialize the feature
  function init() {
    if (isActive) return;

    isActive = true;
    console.log('HelpSidebarSupport: Activated');

    // Try to inject immediately if sidebar exists
    injectSupportSection();

    // Start observing for sidebar changes
    startObserver();
  }

  // Cleanup the feature
  function cleanup() {
    if (!isActive) return;

    isActive = false;

    // Disconnect observer
    if (observer) {
      observer.disconnect();
      observer = null;
    }

    // Remove injected element
    removeInjectedElement();

    console.log('HelpSidebarSupport: Deactivated');
  }

  // Remove the injected support section
  function removeInjectedElement() {
    if (injectedElement && injectedElement.parentNode) {
      injectedElement.remove();
      injectedElement = null;
    }
  }

  // Get current theme colors
  function getThemeColors() {
    // Check if custom theme is active
    if (window.CustomThemeFeature && window.CustomThemeFeature.isActive()) {
      const colors = window.CustomThemeFeature.getColors();
      return {
        background: colors.background,
        text: colors.text,
        border: adjustBrightness(colors.background, -30),
        accent: '#6366f1', // Indigo for JT Power Tools
        isDark: false
      };
    }

    // Check if dark mode is active
    if (window.DarkModeFeature && window.DarkModeFeature.isActive()) {
      return {
        background: '#2c2c2c',
        text: '#e0e0e0',
        border: '#464646',
        accent: '#818cf8', // Lighter indigo for dark mode
        isDark: true
      };
    }

    // Default light mode
    return {
      background: '#f9fafb',
      text: '#374151',
      border: '#e5e7eb',
      accent: '#6366f1',
      isDark: false
    };
  }

  // Color utility functions moved to utils/color-utils.js

  // Find the help sidebar
  function findHelpSidebar() {
    // Look for the help sidebar container
    const sidebars = document.querySelectorAll('.absolute.top-0.bottom-0.right-0');

    for (const sidebar of sidebars) {
      const helpHeader = sidebar.querySelector('.text-jtOrange.uppercase');
      if (helpHeader && helpHeader.textContent.trim() === 'Help') {
        return sidebar;
      }
    }

    return null;
  }

  // Check if our section is already injected
  function isSectionInjected() {
    return document.querySelector('#jt-power-tools-support') !== null;
  }

  // Inject the support section
  function injectSupportSection() {
    if (!isActive) return;
    if (isSectionInjected()) return;

    const sidebar = findHelpSidebar();
    if (!sidebar) return;

    // Find the divide-y container
    const divideContainer = sidebar.querySelector('.divide-y');
    if (!divideContainer) return;

    const theme = getThemeColors();

    // Create the support section
    const supportSection = document.createElement('div');
    supportSection.id = 'jt-power-tools-support';
    supportSection.className = 'p-4 space-y-2';
    supportSection.style.cssText = `
      background-color: ${theme.background};
      border-top: 2px solid ${theme.accent};
      filter: brightness(${theme.isDark ? '0.95' : '0.98'});
    `;

    supportSection.innerHTML = `
      <div style="display: flex; align-items: center; gap: 8px;">
        <svg xmlns="http://www.w3.org/2000/svg" fill="none" stroke="${theme.accent}" stroke-linecap="round" stroke-linejoin="round" stroke-width="2" class="inline-block overflow-visible" style="height: 20px; width: 20px;" viewBox="0 0 24 24">
          <path d="M13 2 3 14h9l-1 8 10-12h-9z"></path>
        </svg>
        <div style="font-weight: bold; text-transform: uppercase; color: ${theme.accent}; font-size: 14px;">
          JT Power Tools Support
        </div>
      </div>
      <div style="color: ${theme.text}; font-size: 14px;">
        Need help with the JT Power Tools extension? We're here to help!
      </div>
      <div style="display: flex; flex-direction: column; gap: 8px; margin-top: 12px;">
        <a href="mailto:support@jtpowertools.com?subject=JT%20Power%20Tools%20Support"
           target="_blank"
           class="jt-support-link"
           style="
             display: flex;
             align-items: center;
             gap: 8px;
             padding: 8px 12px;
             border-radius: 4px;
             background-color: ${theme.background};
             border: 1px solid ${theme.border};
             color: ${theme.text};
             text-decoration: none;
             transition: all 0.2s;
             cursor: pointer;
           ">
          <svg xmlns="http://www.w3.org/2000/svg" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2" style="height: 16px; width: 16px; flex-shrink: 0;" viewBox="0 0 24 24">
            <path d="m22 7-8.991 5.727a2 2 0 0 1-2.009 0L2 7"></path>
            <rect width="20" height="16" x="2" y="4" rx="2"></rect>
          </svg>
          <span style="font-size: 14px;">Contact Support</span>
        </a>
        <a href="mailto:support@jtpowertools.com?subject=JT%20Power%20Tools%20-%20Bug%20Report&body=Please%20describe%20the%20bug%20you%20encountered%3A%0A%0A"
           target="_blank"
           class="jt-support-link"
           style="
             display: flex;
             align-items: center;
             gap: 8px;
             padding: 8px 12px;
             border-radius: 4px;
             background-color: ${theme.background};
             border: 1px solid ${theme.border};
             color: ${theme.text};
             text-decoration: none;
             transition: all 0.2s;
             cursor: pointer;
           ">
          <svg xmlns="http://www.w3.org/2000/svg" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2" style="height: 16px; width: 16px; flex-shrink: 0;" viewBox="0 0 24 24">
            <path d="m8 2 1.88 1.88M14.12 3.88 16 2M9 7.13v-1a3.003 3.003 0 1 1 6 0v1"></path>
            <path d="M12 20c-3.3 0-6-2.7-6-6v-3a4 4 0 0 1 4-4h4a4 4 0 0 1 4 4v3c0 3.3-2.7 6-6 6"></path>
            <path d="M12 20v-9"></path>
          </svg>
          <span style="font-size: 14px;">Report a Bug</span>
        </a>
        <a href="mailto:support@jtpowertools.com?subject=JT%20Power%20Tools%20-%20Feature%20Request&body=Feature%20request%3A%0A%0A"
           target="_blank"
           class="jt-support-link"
           style="
             display: flex;
             align-items: center;
             gap: 8px;
             padding: 8px 12px;
             border-radius: 4px;
             background-color: ${theme.background};
             border: 1px solid ${theme.border};
             color: ${theme.text};
             text-decoration: none;
             transition: all 0.2s;
             cursor: pointer;
           ">
          <svg xmlns="http://www.w3.org/2000/svg" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2" style="height: 16px; width: 16px; flex-shrink: 0;" viewBox="0 0 24 24">
            <path d="M12 5a3 3 0 1 0-5.997.125 4 4 0 0 0-2.526 5.77 4 4 0 0 0 .556 6.588A4 4 0 1 0 12 18Z"></path>
            <path d="M9 13a4.5 4.5 0 0 0 3-4 4.5 4.5 0 0 0 3 4M9.5 9.5 12 7l2.5 2.5"></path>
          </svg>
          <span style="font-size: 14px;">Request a Feature</span>
        </a>
      </div>
      <div style="font-size: 12px; color: ${theme.text}; opacity: 0.7; margin-top: 12px; text-align: center;">
        Version ${chrome.runtime.getManifest().version}
      </div>
    `;

    // Add hover effects
    const style = document.createElement('style');
    style.textContent = `
      .jt-support-link:hover {
        filter: brightness(0.95) !important;
        border-color: ${theme.accent} !important;
      }
    `;
    document.head.appendChild(style);

    // Append to the divide container
    divideContainer.appendChild(supportSection);
    injectedElement = supportSection;
  }

  // Start observing for sidebar changes
  function startObserver() {
    if (observer) return;

    observer = new MutationObserver((mutations) => {
      if (!isActive) return;

      let shouldCheckSidebar = false;

      for (const mutation of mutations) {
        if (mutation.type === 'childList' && mutation.addedNodes.length > 0) {
          shouldCheckSidebar = true;
          break;
        }
      }

      if (shouldCheckSidebar) {
        // Check if sidebar exists and our section is missing
        const sidebar = findHelpSidebar();
        if (sidebar && !isSectionInjected()) {
          injectSupportSection();
        }

        // Check if sidebar was removed
        if (!sidebar && injectedElement) {
          injectedElement = null;
        }
      }
    });

    observer.observe(document.body, {
      childList: true,
      subtree: true
    });
  }

  // Public API
  return {
    init,
    cleanup,
    isActive: () => isActive
  };
})();

// Make available globally
window.HelpSidebarSupportFeature = HelpSidebarSupportFeature;
