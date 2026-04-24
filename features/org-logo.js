/**
 * Org Logo Feature
 * Replaces the JT logo in the org switcher with admin-configured branding.
 * Logo URLs are managed in the portal and fetched via GrantKeyResolver.
 */
const OrgLogoFeature = (() => {
  let isActive = false;
  let observer = null;
  let appliedFor = { orgName: null, logoUrl: null }; // what's currently painted
  let isApplying = false;
  let applyPending = false; // re-run requested while in-flight
  let debounceTimer = null;
  let consecutiveRetries = 0; // runaway-guard for applyPending re-runs
  const MAX_RETRIES = 3;

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
    // Invalidate what's painted so applyLogo won't early-return as up-to-date.
    appliedFor = { orgName: null, logoUrl: null };
    consecutiveRetries = 0; // fresh state
    applyLogo();
  }

  async function applyLogo() {
    if (isApplying) {
      applyPending = true;
      return;
    }
    isApplying = true;

    try {
      const switcher = findSwitcher();
      if (!switcher) return;

      // Fast path: if the observer fired but the active org and the DOM logo
      // both match what we last painted, skip the async fetch entirely.
      const orgBefore = window.OrgDetector?.getActiveOrg() || null;
      const existingImg = switcher.querySelector('.jt-org-logo');
      if (
        appliedFor.orgName === orgBefore &&
        appliedFor.orgName !== null &&
        existingImg &&
        existingImg.src === appliedFor.logoUrl
      ) {
        consecutiveRetries = 0;
        return;
      }

      let resolved = { orgName: null, logoUrl: null };
      if (window.GrantKeyResolver?.getLogoUrl) {
        try {
          resolved = await window.GrantKeyResolver.getLogoUrl();
        } catch (e) {
          console.error('OrgLogo: Failed to get logo URL:', e);
        }
      }

      const orgNow = window.OrgDetector?.getActiveOrg() || null;

      // Guard: the fetched data must correspond to the currently-active org.
      // If mismatch, queue a re-run — the next pass will pull from cache and paint.
      // orgBefore is intentionally NOT checked; if OrgDetector only became ready
      // during the await, and resolved.orgName matches orgNow, we can paint.
      if (resolved.orgName !== orgNow) {
        if (consecutiveRetries < MAX_RETRIES) {
          console.debug(`OrgLogo: org mismatch (fetched-for: ${resolved.orgName}, active: ${orgNow}) — re-run scheduled (${consecutiveRetries + 1}/${MAX_RETRIES})`);
          applyPending = true;
        } else {
          console.warn('OrgLogo: hit max retries on org mismatch, giving up for now');
          consecutiveRetries = 0;
        }
        return;
      }

      // Reached a stable state — reset retry counter
      consecutiveRetries = 0;

      const svgs = switcher.querySelectorAll('svg');
      let logoUrl = resolved.logoUrl;

      // Restrict to HTTPS only. The portal is the admin-controlled source of
      // this URL, but defense-in-depth: reject javascript:/data:/blob:/http:
      // schemes and URLs with attribute-breaking chars before setting img.src.
      if (logoUrl) {
        const isHttps = typeof logoUrl === 'string' && /^https:\/\//i.test(logoUrl.trim());
        const safe = isHttps && typeof Sanitizer !== 'undefined'
          ? Sanitizer.sanitizeURL(logoUrl, null)
          : null;
        if (!safe) {
          console.warn('OrgLogo: Rejecting non-HTTPS or malformed logo URL:', logoUrl);
          logoUrl = null;
        } else {
          logoUrl = safe;
        }
      }

      if (!logoUrl) {
        removeLogo(switcher);
        svgs.forEach(svg => svg.style.display = '');
        appliedFor = { orgName: orgNow, logoUrl: null };
        return;
      }

      // Already painted this exact (org, URL) pair
      if (
        appliedFor.orgName === orgNow &&
        appliedFor.logoUrl === logoUrl &&
        switcher.querySelector('.jt-org-logo')
      ) {
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
          appliedFor = { orgName: null, logoUrl: null };
        };
        switcher.prepend(img);
      }

      img.src = logoUrl;
      appliedFor = { orgName: orgNow, logoUrl };

      if (observer) {
        observer.observe(document.body, { childList: true, subtree: true });
      }
    } finally {
      isApplying = false;
      if (applyPending) {
        applyPending = false;
        consecutiveRetries++;
        // 150ms backoff so we don't busy-loop if OrgDetector keeps racing us
        setTimeout(() => applyLogo(), 150);
      }
    }
  }

  /**
   * Locate the JobTread top header bar.
   *
   * Matches the pattern used by freeze-header.js: a `div.shrink-0.sticky`
   * that contains BOTH the JT logo SVG (viewBox "0 0 120 18" text logo or
   * "0 0 8 8" icon variant) AND the header search input. Other
   * `.shrink-0.sticky` elements elsewhere on the page won't have both.
   */
  function findTopHeader() {
    const candidates = document.querySelectorAll('div.shrink-0.sticky');
    for (const header of candidates) {
      const hasLogo = header.querySelector('svg[viewBox="0 0 120 18"]') ||
                      header.querySelector('svg[viewBox="0 0 8 8"]');
      const hasSearch = header.querySelector('input[placeholder*="Search"]');
      if (hasLogo && hasSearch) return header;
    }
    return null;
  }

  /**
   * Locate the org switcher element — strictly inside the top header.
   *
   * The switcher is a `div.relative.rounded-sm` that contains BOTH an <svg>
   * (the JT logo icon) AND a <select> (the org dropdown). The select+svg
   * combination alone is NOT unique: plenty of form dropdowns elsewhere in
   * the app render as `<div class="relative rounded-sm"><select/><svg/></div>`
   * (the svg is the dropdown chevron). Scoping the search to the top header
   * bar prevents the logo from being injected into random page dropdowns.
   */
  function findSwitcher() {
    const header = findTopHeader();
    if (!header) return null;
    const candidates = header.querySelectorAll('div.relative.rounded-sm');
    for (const el of candidates) {
      if (el.querySelector('select') && el.querySelector('svg')) {
        return el;
      }
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

    appliedFor = { orgName: null, logoUrl: null };
    isApplying = false;
    applyPending = false;
    consecutiveRetries = 0;
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
