/**
 * SidebarDetector — Detects the JobTread "Job Switcher" slide-out sidebar.
 *
 * The Job Switcher renders in a generic right-edge slide-out panel that is
 * also used by other JobTread sidebars, so identity is established by content
 * (header text + job-search input) rather than by the container alone. Shared
 * by the Smart Job Switcher and Custom Field Filter features, which both need
 * to locate this specific sidebar.
 */
const SidebarDetector = (() => {
  /**
   * Check if a sidebar element is specifically the Job Switcher.
   */
  function isJobSwitcherSidebar(sidebar) {
    if (!sidebar) return false;

    // Check for "JOB SWITCHER" text in the header
    const headerText = sidebar.textContent || '';
    if (headerText.includes('JOB SWITCHER') || headerText.includes('Job Switcher')) {
      return true;
    }

    // Check for job search input placeholder
    const searchInput = sidebar.querySelector('input[placeholder*="Search Jobs"]') ||
                       sidebar.querySelector('input[placeholder*="Search jobs"]');
    if (searchInput) {
      return true;
    }

    return false;
  }

  /**
   * Find the Job Switcher sidebar specifically. The container selector is
   * passed in so each feature keeps ownership of its own selector constant.
   */
  function findJobSwitcherSidebar(selector) {
    const sidebars = document.querySelectorAll(selector);
    for (const sidebar of sidebars) {
      if (isJobSwitcherSidebar(sidebar)) {
        return sidebar;
      }
    }
    return null;
  }

  return { isJobSwitcherSidebar, findJobSwitcherSidebar };
})();

window.SidebarDetector = SidebarDetector;
