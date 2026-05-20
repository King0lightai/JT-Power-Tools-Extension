/**
 * Job Email Pill
 *
 * Surfaces each job's per-job email address (the `j-*@jtptbills.com` /
 * vanity-alias destination customers and subs can email to land mail
 * on the JT job's activity feed). Without this UI, users had to call
 * `/api/email-address` themselves to discover the address — fine for
 * an AI, hostile for a human.
 *
 * Behavior:
 *   - On a `/jobs/<id>` route AND logged in via AccountService AND on a
 *     Power User license, a small floating pill appears in the
 *     bottom-right corner of the viewport.
 *   - First click: provisions the address (or fetches it if already
 *     created) and copies it to the clipboard.
 *   - Subsequent clicks: copy the cached address.
 *   - Toast confirmation slides in for 2s on copy.
 *   - Address is cached per `jobId` for the session — switching between
 *     jobs flips the pill without re-fetching what we already know.
 *
 * Tier gate: server returns 403 with `tier`/`upgradeUrl` if the account
 * isn't Power User. We treat that as "feature unavailable" — the pill
 * shows a single click-to-learn-more state and never re-attempts.
 *
 * SPA awareness: piggybacks on FormsJobDetector — same module the Forms
 * feature uses — so route changes inside the React app correctly hide,
 * show, and re-target the pill.
 */
const JobEmailPillFeature = (() => {
  const DEBUG = false;
  function log(...args) { if (DEBUG) console.log('JobEmailPill:', ...args); }

  const PILL_ID = 'jt-tools-job-email-pill';
  const TOAST_ID = 'jt-tools-job-email-toast';

  let isActiveState = false;
  let currentJobId = null;
  // Map<jobId, { address, autoPost, emailCount, lastEmailAt }>
  const addressCache = new Map();
  // jobIds we've confirmed are tier-blocked — skip future fetches
  const tierBlockedJobs = new Set();
  // Pending fetch in flight per jobId so simultaneous clicks don't dupe
  const inFlight = new Map();
  let pillEl = null;
  let toastTimer = null;

  // ─── Public lifecycle ───────────────────────────────────────────

  function init() {
    if (isActiveState) return;
    isActiveState = true;
    log('Initializing');

    injectStyles();

    if (!window.FormsJobDetector) {
      console.warn('JobEmailPill: FormsJobDetector not available — feature inert');
      return;
    }

    window.FormsJobDetector.start((job) => {
      handleRouteChange(job ? job.jobId : null);
    });
  }

  function cleanup() {
    if (!isActiveState) return;
    isActiveState = false;
    log('Cleaning up');

    if (window.FormsJobDetector) {
      // Other features (Forms) also use the detector — stopping it
      // would break them. The detector deduplicates via lastJobKey
      // internally, so leaving it running is the safe move; just drop
      // our own state and DOM.
    }
    if (toastTimer) {
      clearTimeout(toastTimer);
      toastTimer = null;
    }
    removePill();
    removeToast();
    removeStyles();
    currentJobId = null;
  }

  // ─── Route handling ─────────────────────────────────────────────

  function handleRouteChange(jobId) {
    currentJobId = jobId;
    if (!jobId) {
      removePill();
      return;
    }

    // Only show for logged-in Power Users. Free / not-logged-in users
    // see nothing — no point teasing a feature they can't use.
    if (!isUsable()) {
      removePill();
      return;
    }

    renderPill(jobId);
  }

  function isUsable() {
    const svc = window.AccountService;
    if (!svc || typeof svc.isLoggedIn !== 'function' || !svc.isLoggedIn()) {
      return false;
    }
    return true;
  }

  // ─── Pill UI ────────────────────────────────────────────────────

  function renderPill(jobId) {
    const cached = addressCache.get(jobId);
    const tierBlocked = tierBlockedJobs.has(jobId);

    if (!pillEl) {
      pillEl = document.createElement('div');
      pillEl.id = PILL_ID;
      pillEl.className = 'jt-tools-jep';
      pillEl.addEventListener('click', onPillClick);
      document.body.appendChild(pillEl);
    }

    pillEl.dataset.jobId = jobId;

    if (tierBlocked) {
      pillEl.innerHTML = `
        <span class="jep-icon">🔒</span>
        <span class="jep-label">Job Email · Power User</span>
      `;
      pillEl.dataset.state = 'tier';
      return;
    }

    if (cached?.address) {
      const counter = cached.emailCount > 0
        ? `<span class="jep-count" title="${cached.emailCount} email${cached.emailCount === 1 ? '' : 's'} received">${cached.emailCount}</span>`
        : '';
      pillEl.innerHTML = `
        <span class="jep-icon">📧</span>
        <span class="jep-label" title="Click to copy">${escapeHtml(cached.address)}</span>
        ${counter}
        <span class="jep-copy" aria-hidden="true">📋</span>
      `;
      pillEl.dataset.state = 'ready';
      return;
    }

    pillEl.innerHTML = `
      <span class="jep-icon">📧</span>
      <span class="jep-label">Get job email</span>
    `;
    pillEl.dataset.state = 'unprovisioned';
  }

  function removePill() {
    if (pillEl && pillEl.parentNode) {
      pillEl.parentNode.removeChild(pillEl);
    }
    pillEl = null;
  }

  // ─── Click handler ──────────────────────────────────────────────

  async function onPillClick(event) {
    event.preventDefault();
    event.stopPropagation();
    if (!pillEl || pillEl.dataset.state === 'loading') return;

    const jobId = pillEl.dataset.jobId;
    if (!jobId) return;

    if (tierBlockedJobs.has(jobId)) {
      window.open('https://jtpowertools.com/#pricing', '_blank', 'noopener');
      return;
    }

    const cached = addressCache.get(jobId);
    if (cached?.address) {
      await copyAndToast(cached.address);
      return;
    }

    pillEl.dataset.state = 'loading';
    pillEl.innerHTML = `<span class="jep-icon">⏳</span><span class="jep-label">Provisioning…</span>`;

    try {
      const result = await fetchAddress(jobId);
      addressCache.set(jobId, result);
      // Render again with the cached entry, then copy.
      if (currentJobId === jobId) renderPill(jobId);
      await copyAndToast(result.address);
    } catch (err) {
      console.error('JobEmailPill: provisioning failed:', err);
      if (err?.tierBlocked) {
        tierBlockedJobs.add(jobId);
        if (currentJobId === jobId) renderPill(jobId);
        showToast('Power User tier required — opening pricing', 'error');
        setTimeout(() => {
          window.open('https://jtpowertools.com/#pricing', '_blank', 'noopener');
        }, 600);
      } else {
        if (currentJobId === jobId) renderPill(jobId);
        showToast(err?.message || 'Failed to fetch job email', 'error');
      }
    }
  }

  async function copyAndToast(address) {
    try {
      await navigator.clipboard.writeText(address);
      showToast(`Copied: ${address}`);
    } catch (err) {
      console.error('JobEmailPill: clipboard write failed:', err);
      showToast('Copy failed — clipboard permission?', 'error');
    }
  }

  // ─── Fetch ──────────────────────────────────────────────────────

  async function fetchAddress(jobId) {
    if (inFlight.has(jobId)) return inFlight.get(jobId);
    const p = (async () => {
      const svc = window.AccountService;
      if (!svc || typeof svc.authenticatedFetch !== 'function') {
        throw new Error('Not logged in');
      }
      const response = await svc.authenticatedFetch('/admin/job-email/address', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ jobId }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        if (response.status === 403) {
          const err = new Error(payload?.error || 'Power User tier required');
          err.tierBlocked = true;
          throw err;
        }
        throw new Error(payload?.error || `HTTP ${response.status}`);
      }
      return payload;
    })();
    inFlight.set(jobId, p);
    try {
      return await p;
    } finally {
      inFlight.delete(jobId);
    }
  }

  // ─── Toast ──────────────────────────────────────────────────────

  function showToast(text, kind = 'success') {
    removeToast();
    const t = document.createElement('div');
    t.id = TOAST_ID;
    t.className = `jt-tools-jep-toast jt-tools-jep-toast-${kind}`;
    t.textContent = text;
    document.body.appendChild(t);

    // Trigger CSS slide-in
    requestAnimationFrame(() => t.classList.add('jep-toast-show'));

    toastTimer = setTimeout(() => {
      t.classList.remove('jep-toast-show');
      setTimeout(removeToast, 250);
    }, 2000);
  }

  function removeToast() {
    const existing = document.getElementById(TOAST_ID);
    if (existing && existing.parentNode) existing.parentNode.removeChild(existing);
    if (toastTimer) {
      clearTimeout(toastTimer);
      toastTimer = null;
    }
  }

  // ─── Styles ─────────────────────────────────────────────────────

  function injectStyles() {
    if (document.getElementById('jt-tools-jep-styles')) return;
    const link = document.createElement('link');
    link.id = 'jt-tools-jep-styles';
    link.rel = 'stylesheet';
    link.href = chrome.runtime.getURL('styles/job-email-pill.css');
    document.head.appendChild(link);
  }

  function removeStyles() {
    const link = document.getElementById('jt-tools-jep-styles');
    if (link && link.parentNode) link.parentNode.removeChild(link);
  }

  // ─── Helpers ────────────────────────────────────────────────────

  function escapeHtml(s) {
    return String(s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  return {
    init,
    cleanup,
    isActive: () => isActiveState,
  };
})();

window.JobEmailPillFeature = JobEmailPillFeature;
