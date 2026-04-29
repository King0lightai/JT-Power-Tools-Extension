/**
 * JTTweakSystemBanner — one-time slide-down banner shown on JT pages
 * when the tweak engine detects org_required tweaks the user hasn't
 * acknowledged on this device.
 *
 * Purpose: transparency. Members shouldn't be surprised that an admin
 * has pushed UI-modifying tweaks to their browser. The banner names
 * the tweaks and lets the user acknowledge once. Local-disable hatch
 * stays available in the popup as a separate decision.
 *
 * Storage: chrome.storage.local['jtTweakAcknowledged'] —
 *   { [tweakId]: ackTimestampMs }
 *
 * Per-device, by design — each device sees the banner once when a new
 * org_required tweak first lands. Re-showing on a different device is
 * intentional (different surface, separate trust decision).
 *
 * SAFETY: All tweak names are rendered via textContent. No innerHTML.
 */
const JTTweakSystemBanner = (() => {
  const STORAGE_KEY = 'jtTweakAcknowledged';
  const AUTO_HIDE_MS = 60_000;
  let stylesInjected = false;
  let visibleBanner = null;

  function injectStyles() {
    if (stylesInjected || document.getElementById('jt-tweak-system-banner-styles')) {
      stylesInjected = true;
      return;
    }
    const style = document.createElement('style');
    style.id = 'jt-tweak-system-banner-styles';
    style.textContent = [
      '.jt-tweak-system-banner {',
      '  position: fixed; top: 0; left: 0; right: 0;',
      '  background: #2c2c2c; color: #e0e0e0;',
      '  border-bottom: 1px solid #404040;',
      '  box-shadow: 0 4px 16px rgba(0,0,0,0.35);',
      '  font: 13px system-ui, -apple-system, sans-serif;',
      '  z-index: 2147483646;',  // 1 below alert-modal so a tweak alert wins if both fire
      '  animation: jtTweakSystemBannerSlide 220ms ease-out;',
      '}',
      '@keyframes jtTweakSystemBannerSlide {',
      '  from { transform: translateY(-100%); opacity: 0; }',
      '  to   { transform: translateY(0);    opacity: 1; }',
      '}',
      '.jt-tweak-system-banner-inner {',
      '  display: flex; align-items: flex-start; gap: 12px;',
      '  padding: 12px 16px;',
      '  max-width: 1200px; margin: 0 auto;',
      '}',
      '.jt-tweak-system-banner-icon {',
      '  flex: 0 0 auto;',
      '  font-size: 18px; line-height: 1;',
      '  margin-top: 1px;',
      '}',
      '.jt-tweak-system-banner-body { flex: 1; min-width: 0; }',
      '.jt-tweak-system-banner-title { font-weight: 600; color: #e0e0e0; margin: 0 0 4px; font-size: 13px; }',
      '.jt-tweak-system-banner-list { margin: 4px 0 0; padding: 0; list-style: none; color: #b0b0b0; font-size: 12.5px; }',
      '.jt-tweak-system-banner-list li { padding: 2px 0; }',
      '.jt-tweak-system-banner-list li::before { content: "• "; color: #707070; }',
      '.jt-tweak-system-banner-actions { display: flex; gap: 6px; flex: 0 0 auto; }',
      '.jt-tweak-system-banner-btn {',
      '  background: #333333; color: #b0b0b0; border: 1px solid #505050;',
      '  padding: 5px 12px; border-radius: 4px;',
      '  font: inherit; font-size: 12px; cursor: pointer;',
      '}',
      '.jt-tweak-system-banner-btn:hover { background: #3a3a3a; color: #e0e0e0; }',
      '.jt-tweak-system-banner-btn-primary { background: #3B82F6; color: #fff; border-color: #3B82F6; }',
      '.jt-tweak-system-banner-btn-primary:hover { background: #2563eb; color: #fff; }'
    ].join('\n');
    document.head.appendChild(style);
    stylesInjected = true;
  }

  /**
   * Read acknowledged map from chrome.storage.local, defaulting to {}.
   */
  async function readAck() {
    try {
      const stored = await chrome.storage.local.get([STORAGE_KEY]);
      return stored[STORAGE_KEY] && typeof stored[STORAGE_KEY] === 'object' ? stored[STORAGE_KEY] : {};
    } catch {
      return {};
    }
  }

  /**
   * Write acknowledgements for the given tweak ids. Merges with existing.
   */
  async function writeAck(tweakIds) {
    const existing = await readAck();
    const now = Date.now();
    for (const id of tweakIds) {
      existing[id] = now;
    }
    try {
      await chrome.storage.local.set({ [STORAGE_KEY]: existing });
    } catch (e) {
      console.warn('TweakSystemBanner: failed to write ack:', e);
    }
  }

  /**
   * Compute which org_required tweaks need to be acknowledged on this
   * device. Returns the array of tweaks (not just ids) so the caller can
   * render names. Caller passes the already-loaded tweaks array.
   */
  async function findUnacknowledged(tweaks) {
    if (!Array.isArray(tweaks)) return [];
    const orgRequired = tweaks.filter(t => t && t.storageScope === 'org_required');
    if (!orgRequired.length) return [];
    const ack = await readAck();
    return orgRequired.filter(t => !ack[t.id]);
  }

  function dismiss() {
    if (visibleBanner && visibleBanner.parentNode) {
      visibleBanner.parentNode.removeChild(visibleBanner);
    }
    visibleBanner = null;
  }

  /**
   * Show the banner for a list of unacknowledged tweaks. The "Got it"
   * button writes acknowledgements for all of them; "Review" opens the
   * extension popup (best-effort — Chrome only allows this from a user
   * gesture in a content script).
   */
  function show(unackedTweaks) {
    if (!Array.isArray(unackedTweaks) || unackedTweaks.length === 0) return;
    if (!document.body) return;
    if (visibleBanner) return;  // idempotent — never stack

    injectStyles();

    const banner = document.createElement('div');
    banner.className = 'jt-tweak-system-banner';
    banner.setAttribute('role', 'status');
    banner.setAttribute('aria-live', 'polite');

    const inner = document.createElement('div');
    inner.className = 'jt-tweak-system-banner-inner';
    banner.appendChild(inner);

    const icon = document.createElement('div');
    icon.className = 'jt-tweak-system-banner-icon';
    icon.textContent = 'i';
    icon.setAttribute('aria-hidden', 'true');
    inner.appendChild(icon);

    const body = document.createElement('div');
    body.className = 'jt-tweak-system-banner-body';
    inner.appendChild(body);

    const title = document.createElement('p');
    title.className = 'jt-tweak-system-banner-title';
    const count = unackedTweaks.length;
    title.textContent = 'Your admin has ' + count + ' required tweak' + (count === 1 ? '' : 's') + ' active in this org';
    body.appendChild(title);

    const list = document.createElement('ul');
    list.className = 'jt-tweak-system-banner-list';
    const shown = unackedTweaks.slice(0, 5);
    for (const t of shown) {
      const li = document.createElement('li');
      li.textContent = (t && t.name) ? String(t.name).slice(0, 100) : '(unnamed tweak)';
      list.appendChild(li);
    }
    if (unackedTweaks.length > shown.length) {
      const more = document.createElement('li');
      more.textContent = 'and ' + (unackedTweaks.length - shown.length) + ' more';
      list.appendChild(more);
    }
    body.appendChild(list);

    const actions = document.createElement('div');
    actions.className = 'jt-tweak-system-banner-actions';
    inner.appendChild(actions);

    const ackBtn = document.createElement('button');
    ackBtn.className = 'jt-tweak-system-banner-btn jt-tweak-system-banner-btn-primary';
    ackBtn.type = 'button';
    ackBtn.textContent = 'Got it';
    ackBtn.title = 'Mark these as seen on this device';
    actions.appendChild(ackBtn);

    const dismissBtn = document.createElement('button');
    dismissBtn.className = 'jt-tweak-system-banner-btn';
    dismissBtn.type = 'button';
    dismissBtn.textContent = 'Remind me later';
    dismissBtn.title = 'Hide this banner without marking the tweaks as seen';
    actions.appendChild(dismissBtn);

    visibleBanner = banner;

    ackBtn.addEventListener('click', async () => {
      await writeAck(unackedTweaks.map(t => t.id));
      dismiss();
    });
    dismissBtn.addEventListener('click', () => dismiss());

    // Auto-hide after a generous window — without ack'ing, so the
    // banner returns on the next page load until the member clicks
    // "Got it" or disables the tweaks via the popup.
    const timer = setTimeout(() => dismiss(), AUTO_HIDE_MS);
    banner.addEventListener('jt-tweak-banner-dismissed', () => clearTimeout(timer), { once: true });

    document.body.appendChild(banner);
  }

  /**
   * Convenience entry point: takes the engine's loaded tweak array,
   * filters unacknowledged org_required tweaks, and shows the banner
   * if any are pending. Safe to call multiple times — show() guards
   * against stacking.
   */
  async function maybeShowFor(tweaks) {
    try {
      const unacked = await findUnacknowledged(tweaks);
      if (unacked.length > 0) show(unacked);
    } catch (e) {
      console.warn('TweakSystemBanner: maybeShowFor failed (non-fatal):', e);
    }
  }

  return { show, dismiss, maybeShowFor, findUnacknowledged };
})();

window.JTTweakSystemBanner = JTTweakSystemBanner;
