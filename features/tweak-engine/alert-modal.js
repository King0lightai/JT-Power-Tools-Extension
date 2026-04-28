/**
 * JTTweakAlert — built-in popup primitive for the onEvent verb's `alert`
 * side effect. Renders a centered dialog with title + body + OK button.
 *
 * SAFETY: All user-supplied strings (title, body, confirmLabel) are
 * rendered via textContent. No innerHTML. No HTML interpolation. Length
 * limits are also enforced at the validator layer; this module re-applies
 * defensively in case storage was tampered with.
 */
const JTTweakAlert = (() => {
  let stylesInjected = false;

  function injectStyles() {
    if (stylesInjected || document.getElementById('jt-tweak-alert-styles')) {
      stylesInjected = true;
      return;
    }
    const style = document.createElement('style');
    style.id = 'jt-tweak-alert-styles';
    style.textContent = [
      '.jt-tweak-alert-overlay {',
      '  position: fixed; inset: 0;',
      '  background: rgba(0,0,0,0.55);',
      '  display: flex; align-items: center; justify-content: center;',
      '  z-index: 2147483647;',
      '  font: 14px system-ui, -apple-system, sans-serif;',
      '  animation: jtTweakAlertFadeIn 120ms ease-out;',
      '}',
      '@keyframes jtTweakAlertFadeIn { from { opacity: 0; } to { opacity: 1; } }',
      '.jt-tweak-alert-dialog {',
      '  background: #2c2c2c; color: #e0e0e0;',
      '  border: 1px solid #404040; border-radius: 8px;',
      '  padding: 20px 24px; max-width: 440px; min-width: 280px;',
      '  box-shadow: 0 12px 48px rgba(0,0,0,0.5);',
      '}',
      '.jt-tweak-alert-title { margin: 0 0 10px; font-size: 16px; font-weight: 600; color: #e0e0e0; }',
      '.jt-tweak-alert-body { margin: 0 0 18px; line-height: 1.5; color: #b0b0b0; white-space: pre-wrap; }',
      '.jt-tweak-alert-actions { display: flex; justify-content: flex-end; gap: 8px; }',
      '.jt-tweak-alert-confirm {',
      '  background: #3B82F6; color: #fff; border: none;',
      '  padding: 8px 18px; border-radius: 4px; font: inherit; cursor: pointer; font-weight: 500;',
      '}',
      '.jt-tweak-alert-confirm:hover { background: #2563eb; }',
      '.jt-tweak-alert-confirm:focus { outline: 2px solid #93c5fd; outline-offset: 2px; }'
    ].join('\n');
    document.head.appendChild(style);
    stylesInjected = true;
  }

  function show(opts) {
    if (!opts || typeof opts !== 'object') return;
    if (typeof opts.body !== 'string' || opts.body.length === 0) return;

    injectStyles();

    // Idempotent: dismiss any existing modal first so we never stack.
    const existing = document.querySelector('.jt-tweak-alert-overlay');
    if (existing) existing.remove();

    const overlay = document.createElement('div');
    overlay.className = 'jt-tweak-alert-overlay';
    overlay.setAttribute('role', 'dialog');
    overlay.setAttribute('aria-modal', 'true');

    const dialog = document.createElement('div');
    dialog.className = 'jt-tweak-alert-dialog';
    overlay.appendChild(dialog);

    if (opts.title) {
      const h = document.createElement('h3');
      h.className = 'jt-tweak-alert-title';
      h.textContent = String(opts.title).slice(0, 200);
      dialog.appendChild(h);
    }

    const p = document.createElement('p');
    p.className = 'jt-tweak-alert-body';
    p.textContent = String(opts.body).slice(0, 1000);
    dialog.appendChild(p);

    const actions = document.createElement('div');
    actions.className = 'jt-tweak-alert-actions';
    const btn = document.createElement('button');
    btn.className = 'jt-tweak-alert-confirm';
    btn.type = 'button';
    btn.textContent = String(opts.confirmLabel || 'OK').slice(0, 30);
    actions.appendChild(btn);
    dialog.appendChild(actions);

    function dismiss() {
      document.removeEventListener('keydown', onKey, true);
      if (overlay.parentNode) overlay.parentNode.removeChild(overlay);
    }
    function onKey(e) {
      if (e.key === 'Escape' || e.key === 'Enter') {
        e.preventDefault();
        e.stopPropagation();
        dismiss();
      }
    }
    btn.addEventListener('click', dismiss);
    overlay.addEventListener('click', (e) => { if (e.target === overlay) dismiss(); });
    document.addEventListener('keydown', onKey, true);

    document.body.appendChild(overlay);
    btn.focus();
  }

  return { show };
})();

window.JTTweakAlert = JTTweakAlert;
