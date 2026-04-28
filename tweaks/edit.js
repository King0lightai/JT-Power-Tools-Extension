/**
 * Tweak editor page logic.
 *
 * Mode is determined by URL params:
 *   ?id=<uuid>   -> edit existing tweak
 *   ?new=1       -> create blank
 *
 * Live validates JSON + CSS as the user types, can dry-run on the active
 * JT tab via chrome.tabs.sendMessage, and saves to chrome.storage.local.
 * The tweak engine hot-reloads via its storage-change listener.
 */
(function () {
  const params = new URLSearchParams(location.search);
  const tweakId = params.get('id');
  const isNew = params.get('new') === '1';

  const $json = document.getElementById('json');
  const $title = document.getElementById('title');
  const $status = document.getElementById('status');
  const $valErrors = document.getElementById('validation-errors');
  const $cssWarnings = document.getElementById('css-warnings');
  const $matchCounts = document.getElementById('match-counts');
  const $btnSave = document.getElementById('btn-save');
  const $btnTest = document.getElementById('btn-test');
  const $btnRevert = document.getElementById('btn-revert');
  const $scopeRow = document.getElementById('scope-toggle-row');
  const $scopeLockedNote = document.getElementById('scope-locked-note');

  // Snapshot of the JSON value at last save (or initial load) — used by Revert.
  let originalSnapshot = null;
  // True iff the caller's role is admin or owner (server-side role,
  // resolved via AccountService). Controls visibility of the scope toggle.
  let canAuthorOrgRequired = false;
  // Tracks the radio toggle's current value so save() can override the
  // JSON's storageScope reliably even if the textarea-sync path failed
  // (defensive fallback for the radio-handler bug observed in the wild).
  let pendingScope = null;

  init();

  async function init() {
    // Check role first so the scope toggle can render synchronously
    // alongside the rest of the editor body. AccountService.init() runs
    // async at script load — if it hasn't finished by the time we
    // checkAdminRole() here, getCurrentUser() returns null and we'd
    // mark the user as a non-admin even when they are. Wait briefly
    // (up to ~250ms total) for AccountService to populate before
    // deciding. Silent fallback: any non-admin caller simply doesn't
    // see the toggle.
    canAuthorOrgRequired = checkAdminRole();
    if (!canAuthorOrgRequired && window.AccountService) {
      for (let i = 0; i < 5 && !canAuthorOrgRequired; i++) {
        await new Promise((r) => setTimeout(r, 50));
        canAuthorOrgRequired = checkAdminRole();
      }
    }

    if (isNew) {
      $title.textContent = 'New Tweak';
      const blank = {
        id: crypto.randomUUID(),
        name: '',
        version: 1,
        scope: { jtOrg: '' },
        css: '',
        actions: []
      };
      // Default scope is personal. Admin can flip via the toggle.
      blank.storageScope = 'personal';
      $json.value = JSON.stringify(blank, null, 2);
      originalSnapshot = $json.value;
    } else if (tweakId) {
      const stored = await chrome.storage.local.get(['jtTweaks']);
      const list = Array.isArray(stored.jtTweaks) ? stored.jtTweaks : [];
      const tweak = list.find(t => t.id === tweakId);
      if (!tweak) {
        setStatus('Tweak not found', 'error');
        return;
      }
      $title.textContent = 'Edit: ' + (tweak.name || '(unnamed)');
      $json.value = JSON.stringify(tweak, null, 2);
      originalSnapshot = $json.value;
    } else {
      setStatus('No id or new flag in URL', 'error');
      return;
    }

    setupScopeToggle();
    $json.addEventListener('input', debounce(validateAndRender, 300));
    $btnSave.addEventListener('click', save);
    $btnTest.addEventListener('click', testOnActiveTab);
    $btnRevert.addEventListener('click', revert);

    validateAndRender();
  }

  /**
   * Returns true when the caller is admin or owner. Reads from
   * AccountService.getCurrentUser().role (set during login). Returns
   * false on any error or missing data — least-privileged default.
   */
  function checkAdminRole() {
    try {
      if (!window.AccountService || !window.AccountService.getCurrentUser) return false;
      const user = window.AccountService.getCurrentUser();
      return !!(user && (user.role === 'admin' || user.role === 'owner'));
    } catch (_e) {
      return false;
    }
  }

  /**
   * Show + wire the scope toggle for admin/owner callers. Both new and
   * existing tweaks can flip scope — server enforces the admin role
   * check on the flip, so members never see the toggle but admins can
   * promote a personal tweak to required-for-org without deleting it
   * (or vice versa). Version history is preserved on flip.
   *
   * Implementation notes:
   *   - Uses delegated `change` listener on $scopeRow rather than per-
   *     radio bindings. Bubbling-based delegation is robust against any
   *     timing race where radios might not yet be in the DOM, and
   *     avoids the per-element binding loop that has been observed to
   *     silently fail on Windows Chrome with label-wrapped inputs.
   *   - Maintains pendingScope as a separate source of truth. save()
   *     uses it to override the JSON's storageScope at submit time, so
   *     even if textarea-sync fails for any reason the user's selection
   *     still gets through.
   */
  function setupScopeToggle() {
    if (!canAuthorOrgRequired) {
      // Member — no toggle, JSON stays with whatever scope is in it
      // (defaults to 'personal' for new tweaks).
      return;
    }
    $scopeRow.hidden = false;

    // Determine the current value from the JSON (pre-fill the radio +
    // seed pendingScope so save() reflects unchanged state correctly).
    let currentScope = 'personal';
    try {
      const parsed = JSON.parse($json.value);
      if (parsed.storageScope === 'org_required') currentScope = 'org_required';
    } catch (_e) {
      // Invalid JSON — defaults stand.
    }
    pendingScope = currentScope;
    const radios = $scopeRow.querySelectorAll('input[name="storage-scope"]');
    radios.forEach((r) => {
      r.checked = r.value === currentScope;
    });
    // Locked-note is no longer relevant (admins can flip freely now);
    // keep the element hidden.
    if ($scopeLockedNote) $scopeLockedNote.hidden = true;

    // Delegated change listener — catches any radio in the group regardless
    // of how they're nested or when they appear in the DOM.
    $scopeRow.addEventListener('change', (e) => {
      const target = e.target;
      if (!target || target.name !== 'storage-scope' || !target.checked) return;
      pendingScope = target.value;
      // Best-effort textarea sync so the JSON view reflects the radio.
      // If parsing fails, save() still has pendingScope as the override.
      try {
        const parsed = JSON.parse($json.value);
        parsed.storageScope = target.value;
        $json.value = JSON.stringify(parsed, null, 2);
        validateAndRender();
      } catch (_e) {
        // JSON malformed — pendingScope still wins at save time.
      }
    });

    // Belt-and-suspenders: also listen for `click` on the scope row.
    // Some Chrome configurations on Windows don't reliably bubble change
    // events from label-wrapped inputs. Click bubbles consistently.
    $scopeRow.addEventListener('click', (e) => {
      const target = e.target;
      // Walk up to find an input radio in our group (e.g., user clicked
      // on the label text rather than the input itself).
      const input = target?.closest?.('input[name="storage-scope"]') ||
                    target?.parentElement?.querySelector?.('input[name="storage-scope"]');
      if (!input) return;
      // Defer one tick so the browser has actually updated `input.checked`.
      setTimeout(() => {
        if (!input.checked) return;
        if (pendingScope === input.value) return;  // no-op if unchanged
        pendingScope = input.value;
        try {
          const parsed = JSON.parse($json.value);
          parsed.storageScope = input.value;
          $json.value = JSON.stringify(parsed, null, 2);
          validateAndRender();
        } catch (_e) {}
      }, 0);
    });
  }

  /**
   * Parses the JSON, runs validation + CSS sanitization, updates the
   * diagnostics panel, and returns the parsed tweak (or null on failure).
   * Also flips the Save button's disabled state.
   */
  function validateAndRender() {
    let parsed;
    try {
      parsed = JSON.parse($json.value);
    } catch (err) {
      setStatus('Invalid JSON: ' + err.message, 'error');
      $valErrors.innerHTML = '';
      $cssWarnings.innerHTML = '';
      $btnSave.disabled = true;
      return null;
    }

    const v = window.TweakValidator.validate(parsed);
    $valErrors.innerHTML = '';
    if (!v.ok) {
      v.errors.forEach(e => {
        const li = document.createElement('li');
        li.className = 'error';
        li.textContent = (e.field ? e.field + ': ' : '') + e.reason;
        $valErrors.appendChild(li);
      });
      setStatus('Validation failed (' + v.errors.length + ' errors)', 'error');
      $btnSave.disabled = true;
      return null;
    }

    // CSS sanitization — collect warnings (always shown) and errors (block save).
    $cssWarnings.innerHTML = '';
    if (parsed.css && parsed.css.trim()) {
      const r = window.CssSanitizer.sanitize(parsed.css, { tweakId: parsed.id });
      const items = r.warnings || (r.ok === false ? r.errors : []);
      items.forEach(w => {
        const li = document.createElement('li');
        li.className = r.ok ? 'warn' : 'error';
        li.textContent = w.reason + (w.position ? ` (line ${w.position.line})` : '');
        $cssWarnings.appendChild(li);
      });
      if (!r.ok) {
        setStatus('CSS rejected — fix errors before saving', 'error');
        $btnSave.disabled = true;
        return null;
      }
    }

    setStatus('Ready to save.', 'ok');
    $btnSave.disabled = false;
    return parsed;
  }

  async function save() {
    const tweak = validateAndRender();
    if (!tweak) return;
    // Default to enabled on first save; preserve existing flag otherwise.
    tweak.enabled = tweak.enabled !== false;

    // Read scope DIRECTLY from the radio's checked state at save time —
    // single source of truth. NOT gated by canAuthorOrgRequired: the
    // toggle row is hidden via CSS for non-admins (see edit.css
    // `.jt-tweak-edit-scope-row[hidden]`), so a member can't physically
    // click it. AND the server enforces the actual role check on the
    // flip. Removing the client gate fixes the AccountService-init race
    // where canAuthorOrgRequired could still be false at save time
    // even though the user IS admin.
    const checkedRadio = $scopeRow?.querySelector?.('input[name="storage-scope"]:checked');
    if (checkedRadio && checkedRadio.value && !$scopeRow.hidden) {
      tweak.storageScope = checkedRadio.value;
    }

    try {
      // Phase 2: server-first. If logged in, push to /admin/tweaks/{create,update}
      // and use the canonical (server-sanitized) tweak in our cache. The
      // server enforces auth (e.g., 403 if a member tried to author org_required)
      // and runs CSS sanitizer + DSL validator independently. Surface
      // server cssWarnings if present.
      let canonical = tweak;
      const isUpdate = !isNew && !!tweakId;
      if (window.TweaksApi && window.TweaksApi.isAvailable()) {
        try {
          const result = isUpdate
            ? await window.TweaksApi.update(tweak)
            : await window.TweaksApi.create(tweak);
          if (result && result.tweak) canonical = result.tweak;
          // Render server-side CSS sanitizer warnings if any. These are
          // additive to client warnings (which are already shown in the
          // CSS warnings panel from validateAndRender).
          if (result && Array.isArray(result.cssWarnings) && result.cssWarnings.length) {
            for (const w of result.cssWarnings) {
              const li = document.createElement('li');
              li.className = 'warn';
              li.textContent = '[server] ' + (w.reason || JSON.stringify(w));
              $cssWarnings.appendChild(li);
            }
          }
        } catch (err) {
          setStatus('Server rejected: ' + (err.message || 'Unknown error'), 'error');
          return;
        }
      }

      // Always also write through the local cache so the engine's
      // storage-change listener fires and re-applies on the JT tab.
      const stored = await chrome.storage.local.get(['jtTweaks']);
      const list = Array.isArray(stored.jtTweaks) ? stored.jtTweaks : [];
      const idx = list.findIndex(t => t.id === canonical.id);
      if (idx >= 0) {
        list[idx] = canonical;
      } else {
        list.push(canonical);
      }
      await chrome.storage.local.set({ jtTweaks: list });

      // Reflect the server's canonical shape back into the textarea so
      // the user sees the sanitized CSS and any normalized fields.
      $json.value = JSON.stringify(canonical, null, 2);
      // Update the revert snapshot so Revert returns to last-saved state.
      originalSnapshot = $json.value;
      $title.textContent = 'Edit: ' + (canonical.name || '(unnamed)');
      setStatus('Saved.', 'ok');
    } catch (err) {
      setStatus('Save failed: ' + (err && err.message ? err.message : String(err)), 'error');
    }
  }

  /**
   * Sends a TWEAK_DRY_RUN message to the most recently accessed JT tab.
   * The tweak engine's listener returns per-selector match counts which
   * we render into the match-counts list.
   */
  async function testOnActiveTab() {
    const tweak = validateAndRender();
    if (!tweak) return;

    const tabs = await chrome.tabs.query({ url: 'https://app.jobtread.com/*' });
    if (!tabs.length) {
      setStatus('No JT tab open — open app.jobtread.com and try again', 'warn');
      return;
    }
    // Pick the most recently accessed JT tab.
    tabs.sort((a, b) => (b.lastAccessed || 0) - (a.lastAccessed || 0));
    const tab = tabs[0];

    try {
      const response = await chrome.tabs.sendMessage(tab.id, {
        type: 'TWEAK_DRY_RUN',
        tweak
      });
      if (response && response.matchCounts) {
        $matchCounts.innerHTML = '';
        Object.entries(response.matchCounts).forEach(([sel, n]) => {
          const li = document.createElement('li');
          li.className = n === 0 ? 'warn' : '';
          li.textContent = `${sel} → ${n} matches`;
          $matchCounts.appendChild(li);
        });
        setStatus('Dry-run complete on ' + tab.url, 'ok');
      } else if (response && response.error) {
        setStatus('Dry-run error: ' + response.error, 'error');
      } else {
        setStatus('Dry-run returned no diagnostics', 'warn');
      }
    } catch (err) {
      setStatus('Dry-run failed: ' + err.message, 'error');
    }
  }

  function revert() {
    if (originalSnapshot) {
      $json.value = originalSnapshot;
      validateAndRender();
      setStatus('Reverted to last save.', 'ok');
    }
  }

  function setStatus(msg, state = '') {
    $status.textContent = msg;
    $status.dataset.state = state;
  }

  function debounce(fn, ms) {
    let t = null;
    return function (...args) {
      if (t) clearTimeout(t);
      t = setTimeout(() => fn.apply(this, args), ms);
    };
  }
})();
