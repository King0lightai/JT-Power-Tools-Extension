// site.js — reveal on scroll, scroll-spy active nav, mobile nav sheet,
// Just Shipped announcement tabs
(function() {
  function initShipTabs() {
    const tablist = document.querySelector('[data-ship-tabs]');
    if (!tablist) return;
    const tabs = Array.from(tablist.querySelectorAll('[role="tab"]'));
    const panels = tabs.map(t => document.getElementById(t.getAttribute('aria-controls')));

    function activate(tab, focus) {
      tabs.forEach((t, i) => {
        const active = t === tab;
        t.classList.toggle('is-active', active);
        t.setAttribute('aria-selected', active ? 'true' : 'false');
        t.tabIndex = active ? 0 : -1;
        if (panels[i]) panels[i].hidden = !active;
      });
      if (focus) tab.focus();
    }

    tabs.forEach(tab => {
      tab.addEventListener('click', () => activate(tab));
      tab.addEventListener('keydown', (e) => {
        const i = tabs.indexOf(tab);
        let next = null;
        if (e.key === 'ArrowRight') next = tabs[(i + 1) % tabs.length];
        else if (e.key === 'ArrowLeft') next = tabs[(i - 1 + tabs.length) % tabs.length];
        else if (e.key === 'Home') next = tabs[0];
        else if (e.key === 'End') next = tabs[tabs.length - 1];
        if (next) {
          e.preventDefault();
          activate(next, true);
        }
      });
    });

    // Deep links: #email-to-job / #tweaks open their tab and scroll to the rail
    function openFromHash() {
      const id = location.hash.replace('#', '');
      if (!id) return;
      const idx = panels.findIndex(p => p && p.id === id);
      if (idx === -1) return;
      activate(tabs[idx]);
      const section = document.getElementById('shipped');
      if (section) section.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
    window.addEventListener('hashchange', openFromHash);
    openFromHash();
  }

  function initReveal() {
    if (!('IntersectionObserver' in window)) return;
    const els = document.querySelectorAll('.reveal');
    const io = new IntersectionObserver((entries) => {
      entries.forEach(e => {
        if (e.isIntersecting) {
          e.target.classList.add('is-visible');
          io.unobserve(e.target);
        }
      });
    }, { rootMargin: '0px 0px -10% 0px', threshold: 0.1 });
    els.forEach(el => io.observe(el));
  }

  function initSpy() {
    if (!('IntersectionObserver' in window)) return;
    const links = document.querySelectorAll('[data-spy-link]');
    if (!links.length) return;
    const map = new Map();
    links.forEach(l => {
      const id = l.getAttribute('href')?.replace('#', '');
      if (!id) return;
      const sec = document.getElementById(id);
      if (sec) map.set(sec, l);
    });
    const io = new IntersectionObserver((entries) => {
      entries.forEach(e => {
        const link = map.get(e.target);
        if (!link) return;
        if (e.isIntersecting) {
          links.forEach(l => l.classList.remove('is-active'));
          link.classList.add('is-active');
        }
      });
    }, { rootMargin: '-40% 0px -55% 0px', threshold: 0 });
    map.forEach((_, sec) => io.observe(sec));
  }

  function initMobileNav() {
    const btn = document.querySelector('[data-nav-toggle]');
    const sheet = document.querySelector('[data-nav-sheet]');
    if (!btn || !sheet) return;
    btn.addEventListener('click', () => {
      const open = sheet.classList.toggle('is-open');
      btn.setAttribute('aria-expanded', open ? 'true' : 'false');
      document.body.classList.toggle('is-nav-open', open);
    });
    sheet.querySelectorAll('a').forEach(a => a.addEventListener('click', () => {
      sheet.classList.remove('is-open');
      btn.setAttribute('aria-expanded', 'false');
      document.body.classList.remove('is-nav-open');
    }));
  }

  function initBrandScrollTop() {
    const isHome = location.pathname === '/' || location.pathname === '/index.html';
    document.querySelectorAll('a.nav-brand').forEach(a => {
      a.addEventListener('click', (e) => {
        if (isHome) {
          e.preventDefault();
          window.scrollTo(0, 0);
        }
      });
    });
  }

  function init() {
    initShipTabs();
    initReveal();
    initSpy();
    initMobileNav();
    initBrandScrollTop();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
