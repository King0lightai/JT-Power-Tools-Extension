/**
 * OrgDetector — Detects the active JobTread organization from the search bar.
 *
 * The JT search bar placeholder shows "Search <Org Name>". JobTread has
 * shipped DOM changes over time, so we try multiple strategies and
 * fall through. Each strategy logs which path it used (or why it
 * didn't), so when JT ships another DOM change we can diagnose from
 * the console without redeploying.
 *
 * Events dispatched:
 *   'jt-org-changed' on window — { detail: { orgName, previousOrg } }
 */
const OrgDetector = (() => {
  let activeOrgName = null;
  let observer = null;
  let bodyObserver = null;
  let initialized = false;
  let lastDiagnostic = null; // exposed via getDiagnostic() for debugging

  // Common search placeholders that are NOT the global org search.
  // If the remainder after "Search " matches one of these, skip the input.
  const NON_ORG_PLACEHOLDER_REMAINDERS = new Set([
    'jobs', 'tasks', 'files', 'documents', 'comments', 'people',
    'contacts', 'vendors', 'customers', 'accounts', 'items'
  ]);

  function init() {
    if (initialized) return;
    initialized = true;
    detectOrg();
    setupObserver();
    console.log('OrgDetector: Initialized, activeOrg:', activeOrgName, '(strategy:', lastDiagnostic && lastDiagnostic.strategy, ')');
  }

  /**
   * Try each strategy in order; return the first input whose placeholder
   * looks like "Search <Org Name>" (org-name-like, not a generic noun).
   */
  function findOrgSearchInput() {
    // Strategy 1: legacy class match — .jt-top-header was a JT-specific class
    let el = document.querySelector('.jt-top-header input[placeholder^="Search "]');
    if (el && isOrgPlaceholder(el.getAttribute('placeholder'))) {
      lastDiagnostic = { strategy: 'jt-top-header', placeholder: el.getAttribute('placeholder') };
      return el;
    }

    // Strategy 2: any "Search <Capitalized>" input, skipping known generic ones
    const candidates = Array.from(document.querySelectorAll('input[placeholder^="Search "]'));
    for (const input of candidates) {
      const placeholder = input.getAttribute('placeholder') || '';
      if (isOrgPlaceholder(placeholder)) {
        lastDiagnostic = { strategy: 'global-search-input', placeholder };
        return input;
      }
    }

    // Nothing matched — record what we saw so we can diagnose from console
    lastDiagnostic = {
      strategy: 'none',
      jtTopHeaderFound: !!document.querySelector('.jt-top-header'),
      searchInputCount: candidates.length,
      searchInputPlaceholders: candidates.map(i => i.getAttribute('placeholder')).slice(0, 5)
    };
    return null;
  }

  /**
   * A placeholder counts as an org-search placeholder if, after stripping
   * "Search ", the remainder is non-empty, doesn't match a known generic
   * noun ("jobs", "tasks", etc.), doesn't end in ellipsis (those are
   * typically search-anywhere inputs), and starts with an uppercase
   * letter (org names are proper nouns).
   */
  function isOrgPlaceholder(placeholder) {
    if (typeof placeholder !== 'string') return false;
    const m = placeholder.match(/^Search\s+(.+)$/);
    if (!m) return false;
    const remainder = m[1].trim();
    if (!remainder) return false;
    if (remainder.endsWith('...') || remainder.endsWith('…')) return false;
    if (NON_ORG_PLACEHOLDER_REMAINDERS.has(remainder.toLowerCase())) return false;
    if (!/^[A-Z]/.test(remainder)) return false;
    return true;
  }

  function detectOrg() {
    const input = findOrgSearchInput();
    if (!input) return;
    const placeholder = input.getAttribute('placeholder') || '';
    const orgName = placeholder.replace(/^Search\s+/, '').trim();
    if (orgName && orgName !== activeOrgName) {
      const previous = activeOrgName;
      activeOrgName = orgName;
      if (previous !== null) {
        console.log('OrgDetector: Org changed from', previous, 'to', orgName);
        window.dispatchEvent(new CustomEvent('jt-org-changed', {
          detail: { orgName, previousOrg: previous }
        }));
      }
    }
  }

  /**
   * Observe the whole body for placeholder attribute changes anywhere.
   * Cheap because attribute filters narrow the firing scope. This is
   * resilient to JT swapping out their header structure entirely — as
   * long as a "Search <Org Name>" input exists somewhere, we'll catch it.
   */
  function setupObserver() {
    observer = new MutationObserver((mutations) => {
      // Quick filter: only re-detect if a placeholder attribute changed,
      // or if new <input> elements were added to the tree.
      let shouldRedetect = false;
      for (const m of mutations) {
        if (m.type === 'attributes' && m.attributeName === 'placeholder') {
          shouldRedetect = true;
          break;
        }
        if (m.type === 'childList' && m.addedNodes.length > 0) {
          for (const n of m.addedNodes) {
            if (n.nodeType === 1 && (n.tagName === 'INPUT' || n.querySelector?.('input'))) {
              shouldRedetect = true;
              break;
            }
          }
          if (shouldRedetect) break;
        }
      }
      if (shouldRedetect) detectOrg();
    });
    observer.observe(document.body, {
      attributes: true,
      attributeFilter: ['placeholder'],
      subtree: true,
      childList: true,
    });
  }

  function getActiveOrg() {
    if (!activeOrgName) detectOrg();
    return activeOrgName;
  }

  /**
   * Exposed for debugging from the console:
   *   window.OrgDetector.getDiagnostic()
   * Returns details about the last detection attempt — what strategy
   * succeeded, or what was tried and what was found, when none matched.
   */
  function getDiagnostic() {
    return {
      activeOrgName,
      initialized,
      lastDiagnostic,
      // Re-scan once now in case the DOM changed since last detection
      currentSearchInputs: Array.from(document.querySelectorAll('input[placeholder^="Search "]'))
        .map(i => ({
          placeholder: i.getAttribute('placeholder'),
          isOrg: isOrgPlaceholder(i.getAttribute('placeholder'))
        }))
        .slice(0, 10)
    };
  }

  function cleanup() {
    if (observer) { observer.disconnect(); observer = null; }
    if (bodyObserver) { bodyObserver.disconnect(); bodyObserver = null; }
    activeOrgName = null;
    initialized = false;
    lastDiagnostic = null;
  }

  return { init, getActiveOrg, getDiagnostic, cleanup };
})();

window.OrgDetector = OrgDetector;
