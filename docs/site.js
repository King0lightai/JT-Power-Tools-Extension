// site.js — reveal on scroll, scroll-spy active nav, mobile nav sheet
(function() {
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
