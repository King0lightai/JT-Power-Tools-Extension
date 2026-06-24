/**
 * Tweak Share Loader
 *
 * Runs on app.jobtread.com. When a page loads with ?jtpt_share=<code> (from a
 * shared link / the /s/<code> landing's "Open in JobTread" button), it:
 *   1. fetches the stripped envelope from the public /shared/<code> endpoint,
 *   2. re-validates + re-scopes it to the active org via TweakPort.importTweak,
 *   3. shows a confirm dialog with a name/description/CSS preview,
 *   4. on confirm, saves it server-first (TweaksApi.create) + local cache.
 *
 * Importing is allowed for any logged-in user (the recipient gets a personal
 * copy). Applying still requires the Pro Tweaks engine — if it isn't active,
 * the dialog says so. Loads AFTER tweak-engine/index.js (needs TweakEngine,
 * TweakPort, TweaksApi, TweakStorage, OrgDetector — all earlier in the list).
 */
const TweakShareLoader = (() => {
  const RESOLVE_BASE = 'https://jobtread-mcp-server.king0light-ai.workers.dev/shared/';
  const CODE_RE = /^[23456789A-Z]{6,12}$/;

  function parseShareCode(search) {
    try {
      const params = new URLSearchParams(search || '');
      const code = (params.get('jtpt_share') || '').trim();
      return CODE_RE.test(code) ? code : null;
    } catch (_e) {
      return null;
    }
  }

  function resolveUrl(code) {
    return RESOLVE_BASE + encodeURIComponent(code);
  }

  /** Remove the param so a reload doesn't re-prompt. */
  function stripParamFromUrl() {
    try {
      const url = new URL(location.href);
      url.searchParams.delete('jtpt_share');
      history.replaceState(null, '', url.toString());
    } catch (_e) { /* ignore */ }
  }

  async function waitForActiveOrg(maxMs = 4000) {
    const start = Date.now();
    while (Date.now() - start < maxMs) {
      const org = window.OrgDetector ? window.OrgDetector.getActiveOrg() : null;
      if (org) return org;
      await new Promise((r) => setTimeout(r, 200));
    }
    return null;
  }

  function engineActive() {
    // The engine registers itself on window as TweakEngineFeature (see
    // features/tweak-engine/index.js), not TweakEngine.
    try {
      const eng = window.TweakEngineFeature;
      return !!(eng && typeof eng.isActive === 'function' && eng.isActive());
    } catch (_e) {
      return false;
    }
  }

  async function run() {
    const code = parseShareCode(location.search);
    if (!code) return;
    stripParamFromUrl();

    if (!window.TweakPort) { console.warn('TweakShareLoader: TweakPort not loaded'); return; }

    let envelope;
    try {
      const res = await fetch(resolveUrl(code), { method: 'GET' });
      // Parse defensively — a gateway/proxy error can return a non-JSON body,
      // and res.json() would throw. Keep the server's error text when present.
      let data = null;
      try { data = await res.json(); } catch (_e) { /* non-JSON body */ }
      if (!res.ok || !data || !data.ok || !data.envelope) {
        showError((data && data.error) || 'This shared tweak could not be found.');
        return;
      }
      envelope = data.envelope;
    } catch (err) {
      showError('Could not load the shared tweak: ' + (err && err.message ? err.message : 'network error'));
      return;
    }

    const activeOrg = await waitForActiveOrg();
    if (!activeOrg) {
      showError('Open a JobTread org first, then re-open the share link.');
      return;
    }

    const result = window.TweakPort.importTweak(envelope, { activeOrg });
    if (!result.ok) {
      showError('Shared tweak is invalid: ' + (result.errors && result.errors[0] ? result.errors[0].reason : 'unknown'));
      return;
    }

    showConfirm(result.tweak);
  }

  // ─── Minimal self-contained modal (neutral dark greys) ────────────

  function el(tag, props, ...kids) {
    const node = document.createElement(tag);
    if (props) {
      for (const [k, v] of Object.entries(props)) {
        // `style` must go through cssText — assigning a string to node.style
        // is unreliable across engines. Everything else is a plain property.
        if (k === 'style') node.style.cssText = v;
        else node[k] = v;
      }
    }
    for (const k of kids) node.appendChild(typeof k === 'string' ? document.createTextNode(k) : k);
    return node;
  }

  function overlay() {
    const o = el('div');
    o.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.5);z-index:2147483646;display:flex;align-items:center;justify-content:center;';
    return o;
  }

  function panel() {
    const p = el('div');
    p.style.cssText = 'background:#2c2c2c;color:#e0e0e0;border:1px solid #404040;border-radius:10px;max-width:520px;width:90%;max-height:80vh;overflow:auto;padding:20px;font:14px/1.5 -apple-system,Segoe UI,Roboto,sans-serif;box-shadow:0 12px 40px rgba(0,0,0,.5);';
    return p;
  }

  function showError(msg) {
    const o = overlay();
    const p = panel();
    p.appendChild(el('h3', { style: 'margin:0 0 8px;font-size:16px;' }, 'Shared tweak'));
    p.appendChild(el('p', { style: 'color:#b0b0b0;margin:0 0 16px;' }, msg));
    const close = el('button', { textContent: 'Close' });
    close.style.cssText = 'background:#333;border:1px solid #505050;color:#e0e0e0;border-radius:6px;padding:8px 16px;cursor:pointer;';
    close.addEventListener('click', () => o.remove());
    p.appendChild(close);
    o.appendChild(p);
    o.addEventListener('click', (e) => { if (e.target === o) o.remove(); });
    document.body.appendChild(o);
  }

  function showConfirm(tweak) {
    const o = overlay();
    const p = panel();
    p.appendChild(el('h3', { style: 'margin:0 0 4px;font-size:16px;' }, 'Import shared tweak?'));
    p.appendChild(el('p', { style: 'font-weight:600;margin:0 0 4px;' }, tweak.name || '(unnamed)'));
    if (tweak.description) {
      p.appendChild(el('p', { style: 'color:#b0b0b0;margin:0 0 12px;' }, tweak.description));
    }
    if (tweak.css) {
      const pre = el('pre', { textContent: tweak.css.slice(0, 2000) });
      pre.style.cssText = 'background:#1f1f1f;border:1px solid #404040;border-radius:6px;padding:10px;overflow:auto;font:12px/1.5 ui-monospace,Menlo,Consolas,monospace;color:#d0d0d0;margin:0 0 12px;';
      p.appendChild(pre);
    } else {
      p.appendChild(el('p', { style: 'color:#a0a0a0;margin:0 0 12px;' }, 'No CSS — DOM actions only.'));
    }
    if (!engineActive()) {
      p.appendChild(el('p', { style: 'color:#e0a060;margin:0 0 12px;font-size:13px;' },
        'Note: enable the Tweaks engine (Pro) in JT Power Tools to see this applied.'));
    }

    const row = el('div');
    row.style.cssText = 'display:flex;gap:8px;justify-content:flex-end;';
    const cancel = el('button', { textContent: 'Cancel' });
    cancel.style.cssText = 'background:#333;border:1px solid #505050;color:#e0e0e0;border-radius:6px;padding:8px 16px;cursor:pointer;';
    const importBtn = el('button', { textContent: 'Import' });
    importBtn.style.cssText = 'background:#ff6b35;border:1px solid #ff6b35;color:#1b1a18;font-weight:600;border-radius:6px;padding:8px 16px;cursor:pointer;';
    cancel.addEventListener('click', () => o.remove());
    importBtn.addEventListener('click', async () => {
      importBtn.disabled = true;
      importBtn.textContent = 'Importing…';
      try {
        await doImport(tweak);
        o.remove();
        showError('Imported "' + (tweak.name || 'tweak') + '". Find it in JT Power Tools → Tweaks.');
      } catch (err) {
        importBtn.disabled = false;
        importBtn.textContent = 'Import';
        const note = el('p', { style: 'color:#e06060;margin:12px 0 0;font-size:13px;' },
          'Import failed: ' + (err && err.message ? err.message : 'error'));
        p.appendChild(note);
      }
    });
    row.appendChild(cancel);
    row.appendChild(importBtn);
    p.appendChild(row);
    o.appendChild(p);
    o.addEventListener('click', (e) => { if (e.target === o) o.remove(); });
    document.body.appendChild(o);
  }

  /** Server-first create (mirrors edit.js save), then local cache upsert. */
  async function doImport(tweak) {
    let canonical = tweak;
    if (window.TweaksApi && window.TweaksApi.isAvailable()) {
      const result = await window.TweaksApi.create(tweak);
      if (result && result.tweak) canonical = result.tweak;
    }
    await window.TweakStorage.upsert(canonical);
  }

  // Run once at load. document_end means the DOM is ready.
  run();

  return { _test: { parseShareCode, resolveUrl } };
})();

if (typeof window !== 'undefined') window.TweakShareLoader = TweakShareLoader;
