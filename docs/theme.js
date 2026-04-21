// theme.js — light/dark toggle with localStorage + system preference fallback
(function() {
  const KEY = 'jt4-theme';
  const root = document.documentElement;

  function apply(theme) {
    if (theme === 'light' || theme === 'dark') {
      root.setAttribute('data-theme', theme);
    } else {
      root.removeAttribute('data-theme');
    }
  }

  // Init from localStorage (falls back to prefers-color-scheme via CSS)
  const saved = localStorage.getItem(KEY);
  if (saved === 'light' || saved === 'dark') apply(saved);

  // Wire toggle buttons
  function wire() {
    document.querySelectorAll('[data-theme-toggle]').forEach(btn => {
      btn.addEventListener('click', () => {
        const current = root.getAttribute('data-theme')
          || (window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
        const next = current === 'dark' ? 'light' : 'dark';
        apply(next);
        localStorage.setItem(KEY, next);
        btn.setAttribute('aria-pressed', next === 'dark' ? 'true' : 'false');
        const label = btn.querySelector('[data-theme-label]');
        if (label) label.textContent = next === 'dark' ? 'Light' : 'Dark';
        const icon = btn.querySelector('[data-theme-icon]');
        if (icon) icon.className = next === 'dark' ? 'ph ph-sun' : 'ph ph-moon';
      });
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', wire);
  } else {
    wire();
  }
})();
