/**
 * Org Logo Feature
 * Replaces the JT logo in the org switcher with admin-configured branding.
 * Logo URLs are managed in the portal and fetched via GrantKeyResolver.
 */
const OrgLogoFeature = (() => {
  let isActive = false;
  let observer = null;
  let currentLogoUrl = null;
  let isApplying = false;
  let debounceTimer = null;

  function init() {
    if (isActive) return;
    isActive = true;
    console.log('OrgLogo: Initializing...');

    applyLogo();

    // Debounced observer — prevents infinite loop when applyLogo modifies DOM
    observer = new MutationObserver(() => {
      if (!isActive || isApplying) return;
      if (debounceTimer) clearTimeout(debounceTimer);
      debounceTimer = setTimeout(() => applyLogo(), 500);
    });
    observer.observe(document.body, { childList: true, subtree: true });

    // Listen for org changes to re-apply logo
    window.addEventListener('jt-org-changed', handleOrgChange);

    console.log('OrgLogo: Initialized');
  }

  function handleOrgChange() {
    currentLogoUrl = null; // Force re-fetch for new org
    applyLogo();
  }

  async function applyLogo() {
    if (isApplying) return;
    isApplying = true;

    try {
      const switcher = findSwitcher();
      if (!switcher) return;

      let logoUrl = null;
      if (window.GrantKeyResolver?.getLogoUrl) {
        try {
          logoUrl = await window.GrantKeyResolver.getLogoUrl();
        } catch (e) {
          console.error('OrgLogo: Failed to get logo URL:', e);
        }
      }

      const svgs = switcher.querySelectorAll('svg');

      if (!logoUrl) {
        removeLogo(switcher);
        svgs.forEach(svg => svg.style.display = '');
        currentLogoUrl = null;
        return;
      }

      // Skip if same logo already applied and element exists
      if (logoUrl === currentLogoUrl && switcher.querySelector('.jt-org-logo')) {
        return;
      }

      // Disconnect observer while modifying DOM to prevent re-trigger
      if (observer) observer.disconnect();

      svgs.forEach(svg => svg.style.display = 'none');

      let img = switcher.querySelector('.jt-org-logo');
      if (!img) {
        img = document.createElement('img');
        img.className = 'jt-org-logo';
        img.style.cssText = 'height: 32px; max-width: 160px; object-fit: contain;';
        img.onerror = () => {
          console.warn('OrgLogo: Image failed to load:', logoUrl);
          img.remove();
          svgs.forEach(svg => svg.style.display = '');
          currentLogoUrl = null;
        };
        switcher.prepend(img);
      }

      img.src = logoUrl;
      currentLogoUrl = logoUrl;

      // Re-connect observer after DOM changes
      if (observer) {
        observer.observe(document.body, { childList: true, subtree: true });
      }
    } finally {
      isApplying = false;
    }
  }

  function findSwitcher() {
    const candidates = document.querySelectorAll('div.relative.rounded-sm');
    for (const el of candidates) {
      if (el.querySelector('svg') && el.closest('header, nav, [class*="header"]')) {
        return el;
      }
    }
    for (const el of candidates) {
      if (el.querySelector('svg')) return el;
    }
    return null;
  }

  function removeLogo(container) {
    const img = (container || document).querySelector('.jt-org-logo');
    if (img) img.remove();
  }

  function cleanup() {
    if (!isActive) return;
    console.log('OrgLogo: Cleaning up...');

    if (observer) {
      observer.disconnect();
      observer = null;
    }
    if (debounceTimer) {
      clearTimeout(debounceTimer);
      debounceTimer = null;
    }
    window.removeEventListener('jt-org-changed', handleOrgChange);

    const switcher = findSwitcher();
    if (switcher) {
      removeLogo(switcher);
      switcher.querySelectorAll('svg').forEach(svg => svg.style.display = '');
    }

    currentLogoUrl = null;
    isApplying = false;
    isActive = false;
    console.log('OrgLogo: Cleaned up');
  }

  return {
    init,
    cleanup,
    isActive: () => isActive
  };
})();

window.OrgLogoFeature = OrgLogoFeature;
