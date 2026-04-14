/**
 * OrgDetector — Detects the active JobTread organization from the search bar.
 *
 * The JT search bar placeholder always shows "Search <Org Name>".
 * This module watches for placeholder changes to detect org switches in real time.
 *
 * Events dispatched:
 *   'jt-org-changed' on window — { detail: { orgName, previousOrg } }
 */
const OrgDetector = (() => {
  let activeOrgName = null;
  let observer = null;
  let bodyObserver = null;
  let initialized = false;

  function init() {
    if (initialized) return;
    initialized = true;
    detectOrg();
    setupObserver();
    console.log('OrgDetector: Initialized, activeOrg:', activeOrgName);
  }

  function detectOrg() {
    const input = document.querySelector('.jt-top-header input[placeholder^="Search"]');
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

  function setupObserver() {
    const header = document.querySelector('.jt-top-header');
    if (!header) {
      bodyObserver = new MutationObserver(() => {
        const h = document.querySelector('.jt-top-header');
        if (h) {
          bodyObserver.disconnect();
          bodyObserver = null;
          detectOrg();
          observeHeader(h);
        }
      });
      bodyObserver.observe(document.body, { childList: true, subtree: true });
      return;
    }
    observeHeader(header);
  }

  function observeHeader(header) {
    observer = new MutationObserver(() => detectOrg());
    observer.observe(header, {
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

  function cleanup() {
    if (observer) { observer.disconnect(); observer = null; }
    if (bodyObserver) { bodyObserver.disconnect(); bodyObserver = null; }
    activeOrgName = null;
    initialized = false;
  }

  return { init, getActiveOrg, cleanup };
})();

window.OrgDetector = OrgDetector;
