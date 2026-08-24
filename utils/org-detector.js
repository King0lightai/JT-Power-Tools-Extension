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
  // Poll backstop for first-org acquisition — see startPolling().
  let pollTimer = null;
  const POLL_INTERVAL_MS = 400;
  const POLL_MAX_MS = 20000;

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
    // The MutationObserver catches the search bar when JT swaps its placeholder
    // via setAttribute, but it misses property-only updates and can lose the
    // render race on first load. Poll as a backstop until the org is acquired —
    // detectOrg() reads the live placeholder each tick regardless of how JT set
    // it. Bounded so we don't poll forever on a page with no org search bar.
    if (!activeOrgName) startPolling();
    console.log('OrgDetector: Initialized, activeOrg:', activeOrgName, '(strategy:', lastDiagnostic && lastDiagnostic.strategy, ')');
  }

  function startPolling() {
    if (pollTimer || activeOrgName) return;
    const startedAt = Date.now();
    pollTimer = setInterval(() => {
      if (activeOrgName) { stopPolling(); return; }
      detectOrg();
      if (Date.now() - startedAt > POLL_MAX_MS) stopPolling();
    }, POLL_INTERVAL_MS);
  }

  function stopPolling() {
    if (pollTimer) { clearInterval(pollTimer); pollTimer = null; }
  }

  /**
   * Try each strategy in order; return the first input whose placeholder
   * looks like "Search <Org Name>" (org-name-like, not a generic noun).
   */
  function findOrgSearchInput() {
    // Strategy 1: legacy class match — .jt-top-header was a JT-specific class
    const el = document.querySelector('.jt-top-header input[placeholder^="Search "]');
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
   * typically search-anywhere inputs), and isn't a purely-lowercase word or
   * phrase.
   *
   * That last guard is the discriminator: JobTread's generic in-context search
   * placeholders ("Search jobs", "Search files") are always lowercase common
   * nouns, while org display names are proper nouns or handles — they carry a
   * capital ("Acme Builders"), a digit ("3M Remodeling"), or a symbol
   * ("@designREMODEL") somewhere. So we reject only the all-lowercase shape and
   * accept everything else, rather than whitelisting one leading character at a
   * time. The one case this can't resolve is an org literally named in all
   * lowercase with no digits/symbols (e.g. "acme") — indistinguishable from a
   * generic noun by placeholder alone, so we treat it as generic.
   */
  function isOrgPlaceholder(placeholder) {
    if (typeof placeholder !== 'string') return false;
    const m = placeholder.match(/^Search\s+(.+)$/);
    if (!m) return false;
    const remainder = m[1].trim();
    if (!remainder) return false;
    if (remainder.endsWith('...') || remainder.endsWith('…')) return false;
    if (NON_ORG_PLACEHOLDER_REMAINDERS.has(remainder.toLowerCase())) return false;
    if (/^[a-z\s]+$/.test(remainder)) return false;
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
      stopPolling(); // acquired — stop the acquisition poll
      // Dispatch on FIRST detection too (previous === null), not just on org
      // switches. JT renders the search bar asynchronously, so the first
      // successful detect usually lands AFTER dependent features (tweak engine,
      // org logo, API context) have init'd and read a null org. They listen for
      // this event to react once the org is known — suppressing it on first
      // detect was why those only updated after a manual page refresh.
      console.log('OrgDetector:', previous === null
        ? 'detected org "' + orgName + '"'
        : 'org changed from "' + previous + '" to "' + orgName + '"');
      window.dispatchEvent(new CustomEvent('jt-org-changed', {
        detail: { orgName, previousOrg: previous }
      }));
      // The window event above only reaches content scripts in THIS frame.
      // Also broadcast to extension pages (popup / side panel) so they can
      // react to an org switch — the popup's Tweaks list reads the active org
      // once on open and otherwise goes stale while a persistent side panel
      // stays open across the switch.
      broadcastOrgChange(orgName, previous);
    }
  }

  /**
   * Notify extension pages (popup / side panel) of an org change via
   * chrome.runtime.sendMessage. Fire-and-forget: reads lastError in the
   * callback to swallow the "no receiving end" noise when no page is open,
   * and bails if the extension context was invalidated (reload/update).
   */
  function broadcastOrgChange(orgName, previousOrg) {
    try {
      if (!chrome || !chrome.runtime || !chrome.runtime.id) return;
      chrome.runtime.sendMessage(
        { type: 'JT_ORG_CHANGED', orgName, previousOrg },
        () => { void chrome.runtime.lastError; }
      );
    } catch (_e) {
      // Extension context invalidated — nothing to notify.
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
   * True while the first-org acquisition poll is still running — i.e. no org
   * has been detected yet, but the search bar may still be rendering.
   *
   * GrantKeyResolver waits on this before it considers falling back to the
   * license's home-org key: handing that key out while a second org's page is
   * merely slow to render would point API features at the wrong company.
   */
  function isAcquiring() {
    return !!pollTimer;
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
    stopPolling();
    if (observer) { observer.disconnect(); observer = null; }
    if (bodyObserver) { bodyObserver.disconnect(); bodyObserver = null; }
    activeOrgName = null;
    initialized = false;
    lastDiagnostic = null;
  }

  return { init, getActiveOrg, isAcquiring, getDiagnostic, cleanup };
})();

window.OrgDetector = OrgDetector;
