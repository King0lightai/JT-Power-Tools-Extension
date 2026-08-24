/**
 * On-device diagnostics.
 *
 * Built because a browser can be broken in a place you cannot look. Orion on
 * iOS runs this extension with no devtools, no console, and no way to attach a
 * desktop inspector from Windows — so four releases went out against guesses
 * about which API was failing, each one unverifiable. This panel puts the
 * answer on the screen instead.
 *
 * Every probe is independently guarded and reports its own failure as a
 * result, never as an exception. A diagnostic that can itself go blank is
 * worthless precisely when it is needed — that is the same fault it exists to
 * diagnose (one unguarded await aborting the popup's whole startup).
 */
(function () {
  'use strict';

  const TIMEOUT_MS = 4000;

  /** Never throws. Turns any outcome — value, throw, or hang — into a row. */
  async function probe(label, fn, { timeout = TIMEOUT_MS } = {}) {
    const started = Date.now();
    try {
      const value = await Promise.race([
        Promise.resolve().then(fn),
        new Promise((_, reject) =>
          setTimeout(() => reject(new Error(`timed out after ${timeout}ms`)), timeout))
      ]);
      return { label, ok: true, detail: value, ms: Date.now() - started };
    } catch (err) {
      return { label, ok: false, detail: (err && err.message) || String(err), ms: Date.now() - started };
    }
  }

  function browserLine() {
    // Report the raw UA plus the one reliable signal, rather than guessing an
    // engine: a "Chromium vs WebKit" heuristic mislabels headless Chrome as
    // WebKit, because every Chrome UA contains AppleWebKit. A diagnostic that
    // states something wrong with confidence is worse than one that says less.
    // Orion exposes window.KAGI — Kagi's own documented way to detect it.
    const isOrion = typeof window !== 'undefined' && !!window.KAGI;
    return `Orion(window.KAGI)=${isOrion ? 'yes' : 'no'} | ${(navigator.userAgent || '').slice(0, 110)}`;
  }

  async function roundTripStorage(area) {
    const key = `__jt_diag_${Date.now()}`;
    await chrome.storage[area].set({ [key]: 'ok' });
    const read = await chrome.storage[area].get([key]);
    await chrome.storage[area].remove([key]);
    if (read?.[key] !== 'ok') throw new Error('wrote but read back nothing');
    return 'read/write OK';
  }

  /** Is the storage.sync fallback carrying writes into local? */
  async function syncBackedByLocal() {
    const key = `__jt_diag_where_${Date.now()}`;
    await chrome.storage.sync.set({ [key]: 'ok' });
    const inLocal = await chrome.storage.local.get([key]);
    const landed = inLocal?.[key] === 'ok';
    try {
      await chrome.storage.sync.remove([key]);
      await chrome.storage.local.remove([key]);
    } catch (_) { /* cleanup is best-effort */ }
    return landed
      ? 'FALLBACK ACTIVE — storage.sync is unavailable, writes go to local'
      : 'native storage.sync in use';
  }

  /** Does the MV3 service worker answer at all? The grant-key path needs it. */
  async function serviceWorkerAlive() {
    const reply = await new Promise((resolve, reject) => {
      let done = false;
      const t = setTimeout(() => { if (!done) reject(new Error('no reply — worker may not be running')); }, TIMEOUT_MS - 500);
      try {
        chrome.runtime.sendMessage({ type: 'GET_SETTINGS' }, (res) => {
          done = true; clearTimeout(t);
          const err = chrome.runtime.lastError;
          if (err) reject(new Error(err.message));
          else resolve(res);
        });
      } catch (err) { done = true; clearTimeout(t); reject(err); }
    });
    if (!reply) throw new Error('replied with nothing');
    return 'worker replied';
  }

  async function accountState() {
    const s = await chrome.storage.local.get(['jtAccountUserData', 'jtAccountAccessToken']);
    const tier = s?.jtAccountUserData?.tier || '(none)';
    return `token ${s?.jtAccountAccessToken ? 'present' : 'MISSING'}, stored tier ${tier}`;
  }

  async function gateTier() {
    if (!window.LicenseService) throw new Error('LicenseService not loaded');
    const t = await window.LicenseService.getTier();
    return t ? `gate grants "${t}"` : 'gate grants NOTHING (features stay locked)';
  }

  /** The failing path: the worker fetches the org grant key. */
  async function grantKeyPath() {
    const s = await chrome.storage.local.get(['jtAccountUserData']);
    const orgName = s?.jtAccountUserData?.orgName;
    if (!orgName) throw new Error('no org name stored — sign in first');
    const reply = await new Promise((resolve, reject) => {
      let done = false;
      const t = setTimeout(() => { if (!done) reject(new Error('no reply from worker')); }, TIMEOUT_MS - 500);
      try {
        chrome.runtime.sendMessage({ type: 'FETCH_EXTENSION_GRANT_KEY', orgName }, (res) => {
          done = true; clearTimeout(t);
          const err = chrome.runtime.lastError;
          if (err) reject(new Error(err.message));
          else resolve(res);
        });
      } catch (err) { done = true; clearTimeout(t); reject(err); }
    });
    if (reply?.success && reply.grantKey) return `key resolved for "${orgName}"`;

    const error = reply?.error || 'no key and no error given';
    // Expected, not a fault: the handler only accepts content-script senders
    // from app.jobtread.com, and this probe runs in the popup. Reaching that
    // rejection still proves the worker is alive and routing messages, which
    // is the part worth knowing. Reporting it as FAIL would cry wolf.
    if (/untrusted sender/i.test(error)) {
      // The shape is the answer. A real popup message carries sender.id and no
      // sender.tab, which the worker allows outright — so a rejection here
      // means this engine populates `sender` differently, and which field is
      // missing says exactly how.
      const sh = reply?.senderShape;
      const detail = sh
        ? `hasId=${sh.hasId} idMatches=${sh.idMatches} hasTab=${sh.hasTab} hasTabUrl=${sh.hasTabUrl} host=${sh.hostname || '-'}`
        : '(no shape reported — worker predates this diagnostic)';
      throw new Error(`worker rejected this popup as untrusted -> ${detail}`);
    }
    // This one IS the bug being chased: signed in, and told to sign in.
    if (/not authenticated|sign in/i.test(error)) {
      throw new Error(`"${orgName}" -> ${error}  <-- worker cannot see your login`);
    }
    throw new Error(`"${orgName}" -> ${error}`);
  }

  async function run() {
    const rows = [];
    rows.push({ label: 'Version', ok: true, detail: chrome.runtime?.getManifest?.().version || '?' });
    rows.push({ label: 'Browser', ok: true, detail: browserLine() });
    // Which parts of the popup failed to start. Each step is isolated now, so
    // a broken one no longer blanks the window — but it does leave that piece
    // of the UI missing, and this is the only place that says which.
    const failed = (typeof window !== 'undefined' && window.JTPopupInitFailures) || [];
    rows.push({
      label: 'popup init',
      ok: failed.length === 0,
      detail: failed.length ? `FAILED STEPS: ${failed.join(', ')}` : 'all steps completed'
    });
    rows.push(await probe('storage.local', () => roundTripStorage('local')));
    rows.push(await probe('storage.sync', () => roundTripStorage('sync')));
    rows.push(await probe('sync backing', syncBackedByLocal));
    rows.push(await probe('service worker', serviceWorkerAlive));
    rows.push(await probe('account', accountState));
    rows.push(await probe('tier gate', gateTier));
    rows.push(await probe('grant key', grantKeyPath));
    return rows;
  }

  function asText(rows) {
    return rows
      .map((r) => `${r.ok ? 'OK  ' : 'FAIL'} ${r.label.padEnd(15)} ${r.detail}`)
      .join('\n');
  }

  function render(container, rows) {
    container.textContent = '';
    const pre = document.createElement('pre');
    pre.className = 'jt-diag-output';
    pre.textContent = asText(rows);
    container.appendChild(pre);

    const copy = document.createElement('button');
    copy.className = 'jt-diag-copy';
    copy.textContent = 'Copy for support';
    copy.addEventListener('click', async () => {
      const text = asText(rows);
      try {
        await navigator.clipboard.writeText(text);
        copy.textContent = 'Copied';
      } catch (_) {
        // iOS can refuse clipboard writes outside a trusted gesture chain.
        // Selecting the text is a workable fallback for a phone.
        const range = document.createRange();
        range.selectNodeContents(pre);
        const sel = window.getSelection();
        sel.removeAllRanges();
        sel.addRange(range);
        copy.textContent = 'Selected — long-press to copy';
      }
      setTimeout(() => { copy.textContent = 'Copy for support'; }, 2500);
    });
    container.appendChild(copy);
  }

  async function show(container) {
    container.textContent = 'Running diagnostics…';
    let rows;
    try {
      rows = await run();
    } catch (err) {
      rows = [{ label: 'diagnostics', ok: false, detail: (err && err.message) || String(err) }];
    }
    render(container, rows);
  }

  /* ---- Trigger -------------------------------------------------------------
     Owned here rather than in popup.js, and deliberately so.

     popup.js wires its listeners inside one long DOMContentLoaded chain, and a
     single unsupported API anywhere in that chain aborts everything after it —
     which is exactly the failure this panel exists to report. A trigger living
     in that chain is unreachable in precisely the case you need it. This file
     loads before popup.js and attaches independently, so the panel opens even
     when the rest of the popup never finishes starting.

     Delegated from `document` because the version label's text is rewritten
     during init, and bound to touchend as well as click because iOS does not
     reliably dispatch click to a non-interactive element like a <span>.
     -------------------------------------------------------------------------- */
  const SELECTOR = '#versionLabel, .version';
  // iOS fires a synthetic click after touchend; without this the panel would
  // toggle twice and look like nothing happened at all.
  let lastToggle = 0;

  function toggle(event) {
    const target = event.target;
    if (!target || typeof target.closest !== 'function') return;
    if (!target.closest(SELECTOR)) return;

    const now = Date.now();
    if (now - lastToggle < 600) return;
    lastToggle = now;

    event.preventDefault();
    const panel = document.getElementById('diagnosticsPanel');
    if (!panel) return;
    try {
      panel.hidden = !panel.hidden;
      if (!panel.hidden) show(panel);
    } catch (err) {
      panel.hidden = false;
      panel.textContent = `Diagnostics failed to start: ${(err && err.message) || err}`;
    }
  }

  function attachTrigger() {
    document.addEventListener('click', toggle, true);
    document.addEventListener('touchend', toggle, true);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', attachTrigger, { once: true });
  } else {
    attachTrigger();
  }

  window.JTDiagnostics = { run, asText, show };
})();
