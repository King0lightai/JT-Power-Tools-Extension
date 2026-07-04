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
 *   { [`${tweakId}@${version}`]: ackTimestampMs }
 *
 * Ack is keyed by tweak id AND version (the server's currentVersion). A
 * bumped version means the id@version ack is absent, so an already-acked
 * org tweak that an admin edits re-surfaces once — this time framed as an
 * "Updated" tweak with a plain-English summary of what the new version does
 * (B4). Re-acking suppresses it until the next version.
 *
 * Backward-compat: a legacy id-only ack (from before versioned keying) is
 * treated as covering whatever version the user currently sees — it is
 * migrated to the id@version key on first read, so the banner does NOT
 * re-show spuriously; it only re-shows on a genuine subsequent bump. Least-
 * surprising: a user who already acked stays acked until there's a real
 * update.
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
   * The tweak's current server version. Falls back to a stable sentinel so a
   * tweak that (unexpectedly) lacks currentVersion still keys deterministically
   * and doesn't re-nag on every load.
   */
  function tweakVersion(t) {
    const v = t && t.currentVersion;
    return (typeof v === 'number' || typeof v === 'string') ? String(v) : '0';
  }

  function ackKey(id, version) {
    return id + '@' + version;
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
   * Write acknowledgements for the given (id, version) pairs. Merges with
   * existing, using the versioned key so a later bump re-surfaces the banner.
   */
  async function writeAck(pairs) {
    const existing = await readAck();
    const now = Date.now();
    for (const { id, version } of pairs) {
      existing[ackKey(id, version)] = now;
    }
    try {
      await chrome.storage.local.set({ [STORAGE_KEY]: existing });
    } catch (e) {
      console.warn('TweakSystemBanner: failed to write ack:', e);
    }
  }

  /**
   * Migrate any legacy id-only ack (a bare tweak id key, no "@version") for
   * the given org_required tweaks into the versioned key for the version the
   * user currently sees. Idempotent: only acts when a legacy key exists and
   * the versioned key doesn't. Prevents a one-time spurious re-show on the
   * first load after this feature ships. Returns the possibly-updated ack map.
   */
  async function migrateLegacyAcks(orgRequired, ack) {
    let dirty = false;
    for (const t of orgRequired) {
      const legacy = ack[t.id];
      const versioned = ackKey(t.id, tweakVersion(t));
      // A legacy key is a bare id with a timestamp value and no "@" — the id
      // itself never contains "@". Migrate it to cover the current version.
      if (legacy && ack[versioned] === undefined) {
        ack[versioned] = legacy;
        delete ack[t.id];
        dirty = true;
      } else if (legacy && ack[versioned] !== undefined) {
        // Already covered by a versioned ack — just drop the stale legacy key.
        delete ack[t.id];
        dirty = true;
      }
    }
    if (dirty) {
      try {
        await chrome.storage.local.set({ [STORAGE_KEY]: ack });
      } catch (e) {
        console.warn('TweakSystemBanner: failed to migrate legacy acks:', e);
      }
    }
    return ack;
  }

  /**
   * Compute which org_required tweaks need to be acknowledged on this device
   * at their CURRENT version. Returns tweaks (not just ids) tagged with
   * `_isUpdate` — true when a PRIOR version of this tweak was already acked
   * (so the banner frames it as "Updated"), false on first-ever sight. Caller
   * passes the already-loaded tweaks array.
   */
  async function findUnacknowledged(tweaks) {
    if (!Array.isArray(tweaks)) return [];
    const orgRequired = tweaks.filter(t => t && t.storageScope === 'org_required');
    if (!orgRequired.length) return [];
    let ack = await readAck();
    ack = await migrateLegacyAcks(orgRequired, ack);
    const result = [];
    for (const t of orgRequired) {
      const version = tweakVersion(t);
      if (ack[ackKey(t.id, version)] !== undefined) continue; // acked at this version
      // Unacked at this version. It's an UPDATE if any other version of this
      // tweak was previously acked (a "<id>@" prefix with a different version).
      const prefix = t.id + '@';
      const isUpdate = Object.keys(ack).some(k => k.startsWith(prefix) && k !== ackKey(t.id, version));
      result.push({ ...t, _isUpdate: isUpdate });
    }
    return result;
  }

  function dismiss() {
    if (visibleBanner && visibleBanner.parentNode) {
      visibleBanner.parentNode.removeChild(visibleBanner);
    }
    visibleBanner = null;
  }

  /**
   * The list-item label for a pending tweak. For an UPDATED tweak, append the
   * plain-English summary of the new version (via describe.js — the same
   * summary shown in the builder / import dialog) so the member sees WHAT
   * changed, not just that it did. describe is best-effort — fall back to the
   * name alone if it's missing or throws. Rendered via textContent by caller.
   */
  function itemLabel(t) {
    const name = (t && t.name) ? String(t.name).slice(0, 100) : '(unnamed tweak)';
    if (t && t._isUpdate && window.TweakDescribe) {
      try {
        const lines = window.TweakDescribe.describe(t);
        if (lines && lines.length) return (name + ' — ' + lines.join('; ')).slice(0, 200);
      } catch { /* fall through to name only */ }
    }
    return name.slice(0, 200);
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

    // "Updated" framing when EVERY pending tweak is a re-notify (a prior
    // version was acked); "required" framing otherwise. A mixed batch (some
    // new, some updated) keeps the original "required" framing — the safe
    // default that names all of them; the per-item summary still calls out
    // what each does.
    const allUpdates = unackedTweaks.length > 0 && unackedTweaks.every(t => t && t._isUpdate);

    const title = document.createElement('p');
    title.className = 'jt-tweak-system-banner-title';
    const count = unackedTweaks.length;
    const tweakWord = 'tweak' + (count === 1 ? '' : 's');
    title.textContent = allUpdates
      ? ('Your admin updated ' + count + ' required ' + tweakWord + ' in this org')
      : ('Your admin has ' + count + ' required ' + tweakWord + ' active in this org');
    body.appendChild(title);

    const list = document.createElement('ul');
    list.className = 'jt-tweak-system-banner-list';
    const shown = unackedTweaks.slice(0, 5);
    for (const t of shown) {
      const li = document.createElement('li');
      li.textContent = itemLabel(t);
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
      await writeAck(unackedTweaks.map(t => ({ id: t.id, version: tweakVersion(t) })));
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

  return { show, dismiss, maybeShowFor, findUnacknowledged, writeAck, ackKey, tweakVersion };
})();

window.JTTweakSystemBanner = JTTweakSystemBanner;
