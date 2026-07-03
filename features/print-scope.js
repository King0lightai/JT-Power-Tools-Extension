// JT Power Tools - Print Scope Feature
// Adds a "Print" button (plus a font-size picker) to JobTread's "Preview
// Document" modal (opened from a budget line-item selection) so users can
// print/save the rendered scope document without first creating a real
// document.
//
// Approach: clone the rendered document node, drop the template-picker chrome,
// and render the clone into an isolated hidden IFRAME with JobTread's own
// stylesheets copied in, then print the iframe. Printing in an iframe avoids
// the live page entirely — no modal overlay, no grey backdrop, no app-level
// html/body height/overflow constraints clipping the output — while still
// matching the on-screen look because the same stylesheets apply. The
// font-size picker scales only the printed clone; the on-screen modal is never
// touched. The choice is remembered per browser.

const PrintScopeFeature = (() => {
  let isActiveState = false;
  let observer = null;
  let debouncedInject = null;
  let fontSize = 'normal'; // 'normal' | 'large' | 'larger'

  const CONTROLS_CLASS = 'jt-print-scope-controls';
  const SELECT_CLASS = 'jt-print-scope-size';
  const IFRAME_ID = 'jt-print-scope-frame';
  const FONT_SIZE_KEY = 'jtToolsPrintScopeFontSize';
  const VALID_SIZES = ['normal', 'large', 'larger'];

  const PRINTER_SVG = `<svg xmlns="http://www.w3.org/2000/svg" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2" class="inline-block overflow-visible h-[1em] w-[1em] align-[-0.125em]" viewBox="0 0 24 24"><path d="M6 9V2h12v7M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2M6 14h12v8H6z"></path></svg>`;

  /**
   * Load the saved font-size preference (device-local, defaults to 'normal').
   */
  async function loadFontSize() {
    try {
      let stored;
      if (window.StorageWrapper) {
        const result = await window.StorageWrapper.get([FONT_SIZE_KEY], {});
        stored = result[FONT_SIZE_KEY];
      } else {
        const result = await chrome.storage.sync.get([FONT_SIZE_KEY]);
        stored = result[FONT_SIZE_KEY];
      }
      if (VALID_SIZES.includes(stored)) fontSize = stored;
    } catch (error) {
      console.warn('PrintScope: Could not load font-size preference:', error);
    }
  }

  function saveFontSize(value) {
    try {
      if (window.StorageWrapper) {
        window.StorageWrapper.set({ [FONT_SIZE_KEY]: value });
      } else {
        chrome.storage.sync.set({ [FONT_SIZE_KEY]: value });
      }
    } catch (error) {
      console.warn('PrintScope: Could not save font-size preference:', error);
    }
  }

  /**
   * Locate the open "Preview Document" modal, if present.
   * Anchored on the header title text, then walked up to the modal container.
   * @returns {HTMLElement|null}
   */
  function findModal() {
    const title = [...document.querySelectorAll('div.font-bold.uppercase')]
      .find(el => el.textContent.trim() === 'Preview Document');
    return title ? title.closest('.max-w-screen-lg') : null;
  }

  /**
   * Build the font-size picker (Normal / Large / Larger).
   */
  function buildSizeSelect() {
    const select = document.createElement('select');
    select.className = SELECT_CLASS + ' inline-block align-bottom cursor-pointer py-2 px-2 shadow-xs text-gray-600 bg-white hover:bg-gray-50 rounded-sm border text-center';
    select.setAttribute('aria-label', 'Print font size');
    select.title = 'Print font size';

    [['normal', 'Normal'], ['large', 'Large'], ['larger', 'Larger']].forEach(([value, label]) => {
      const opt = document.createElement('option');
      opt.value = value;
      opt.textContent = label;
      select.appendChild(opt);
    });
    select.value = fontSize;

    select.addEventListener('change', () => {
      fontSize = VALID_SIZES.includes(select.value) ? select.value : 'normal';
      saveFontSize(fontSize);
    });

    return select;
  }

  /**
   * Inject the size picker + Print button into the modal footer (next to Cancel).
   */
  function injectControls() {
    if (!isActiveState) return;

    const modal = findModal();
    if (!modal) return;

    // Footer is the sticky bottom bar with the rounded-b corner.
    const footer = modal.querySelector('.sticky.rounded-b-sm');
    if (!footer) return;

    // Already injected for this modal instance.
    if (footer.querySelector('.' + CONTROLS_CLASS)) return;

    const controls = document.createElement('div');
    controls.className = CONTROLS_CLASS + ' flex items-center space-x-2 mr-2';

    const select = buildSizeSelect();

    const btn = document.createElement('div');
    btn.className = 'inline-block align-bottom relative cursor-pointer select-none truncate py-2 px-4 shadow-xs active:shadow-inner text-white bg-cyan-500 hover:bg-cyan-600 rounded-sm border border-cyan-500 text-center';
    btn.setAttribute('role', 'button');
    btn.setAttribute('tabindex', '0');
    btn.setAttribute('aria-label', 'Print scope document');
    btn.innerHTML = PRINTER_SVG + ' Print';

    const trigger = (e) => {
      e.preventDefault();
      e.stopPropagation();
      printDocument(modal);
    };
    btn.addEventListener('click', trigger);
    btn.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') trigger(e);
    });

    controls.appendChild(select);
    controls.appendChild(btn);

    // Insert before Cancel so order reads [size] [Print] [Cancel].
    footer.insertBefore(controls, footer.firstChild);
  }

  /**
   * Best-effort read of the selected document's name (e.g. "Bid Scope"),
   * used only to set a nicer print title. Returns null if not found.
   */
  function getDocName(modal) {
    const name = modal.querySelector('.grow.min-w-0.truncate');
    return name ? name.textContent.trim() : null;
  }

  /**
   * CSS applied inside the print iframe. Tunes the copied JobTread styles for
   * paper and applies the font-size picker.
   */
  function printFrameCss() {
    return `
      @page { margin: 0.5in; }
      html, body {
        margin: 0;
        padding: 0;
        background: #fff;
        -webkit-print-color-adjust: exact;
        print-color-adjust: exact;
      }
      /* Belt-and-suspenders: force our content visible in print even if any
         stray hide rule slipped through the screen-styles copy. */
      @media print {
        html, body { display: block !important; }
        #jt-print-wrap, #jt-print-wrap * { visibility: visible !important; }
      }
      /* Render background colors and images (group shading, orange bar, photos). */
      #jt-print-wrap, #jt-print-wrap * {
        -webkit-print-color-adjust: exact !important;
        print-color-adjust: exact !important;
      }
      /* The document's inner sticky header must sit inline when printed. */
      #jt-print-wrap .sticky { position: static !important; }
      /* Don't clip/scroll the table wrappers — but leave photo thumbnails
         (.aspect-square uses overflow-hidden to crop bg-cover) alone. */
      #jt-print-wrap .overflow-auto { overflow: visible !important; }
      /* Font-size picker — scope body text is .text-xs; headers inherit root. */
      #jt-print-wrap[data-size="large"] { font-size: 17px; }
      #jt-print-wrap[data-size="large"] .text-xs { font-size: 14px !important; }
      #jt-print-wrap[data-size="larger"] { font-size: 19px; }
      #jt-print-wrap[data-size="larger"] .text-xs { font-size: 16px !important; }
    `;
  }

  /**
   * Serialize a list of CSS rules to text, skipping pure `@media print` blocks.
   * JobTread ships its own print stylesheet that hides page content; copied into
   * our iframe verbatim it would blank the clone. We keep screen styles only —
   * our own print tuning (appended later) becomes the sole print media.
   */
  function rulesToCss(rules) {
    let css = '';
    for (const rule of rules) {
      if (rule.type === CSSRule.MEDIA_RULE) {
        const mt = (rule.media && rule.media.mediaText || '').toLowerCase();
        if (mt === 'print') continue; // drop print-only blocks
      }
      css += rule.cssText + '\n';
    }
    return css;
  }

  /**
   * Rebuild the page's styles into the iframe: inline every reachable
   * stylesheet (same-origin sheets + constructed adoptedStyleSheets) with
   * print-only blocks stripped, and <link> the ones we can't read (cross-origin).
   */
  function copyStyles(doc) {
    const parts = [];

    for (const sheet of [...document.styleSheets]) {
      let rules = null;
      try { rules = sheet.cssRules; } catch (_) { rules = null; }
      if (rules) {
        parts.push(rulesToCss(rules));
      } else if (sheet.href) {
        // Cross-origin — can't read; link it by absolute URL instead.
        const link = doc.createElement('link');
        link.rel = 'stylesheet';
        link.href = sheet.href;
        doc.head.appendChild(link);
      }
    }

    // Constructed stylesheets (document.adoptedStyleSheets) aren't in the DOM,
    // so cloneNode/link can't reach them — pull their rules directly.
    for (const sheet of (document.adoptedStyleSheets || [])) {
      try { parts.push(rulesToCss(sheet.cssRules)); } catch (_) { /* ignore */ }
    }

    if (parts.length) {
      const style = doc.createElement('style');
      style.textContent = parts.join('\n');
      doc.head.appendChild(style);
    }
  }

  /**
   * Preload every background-image thumbnail in the clone so they're in cache
   * before we print (background images that haven't loaded print blank).
   * Resolves after all settle or a short timeout — never hangs.
   */
  function preloadImages(clone) {
    const urls = new Set();
    clone.querySelectorAll('[style*="background-image"]').forEach(el => {
      const m = /url\(["']?([^"')]+)["']?\)/.exec(el.getAttribute('style') || '');
      if (m) urls.add(m[1]);
    });
    if (urls.size === 0) return Promise.resolve();

    return new Promise(resolve => {
      let pending = urls.size;
      const done = () => { if (--pending <= 0) resolve(); };
      urls.forEach(url => {
        const img = new Image();
        img.onload = done;
        img.onerror = done;
        img.src = url;
      });
      setTimeout(resolve, 2500); // safety cap
    });
  }

  /**
   * Print just the rendered scope document from the given modal, via an
   * isolated iframe so the live page's overlay/layout can't interfere.
   */
  function printDocument(modal) {
    // The rendered document lives in the white card (.bg-white.space-y-4):
    // first child is the "Document Template" picker (chrome we drop), then the
    // table and the totals block.
    const card = modal.querySelector('.bg-white.space-y-4');
    if (!card) return;

    const clone = card.cloneNode(true);
    clone.querySelectorAll(':scope > div').forEach(child => {
      if (child.textContent.includes('Document Template') && child.querySelector('.text-jtOrange')) {
        child.remove();
      }
    });

    // Remove any stale frame from a previous run.
    const stale = document.getElementById(IFRAME_ID);
    if (stale) stale.remove();

    const iframe = document.createElement('iframe');
    iframe.id = IFRAME_ID;
    iframe.setAttribute('aria-hidden', 'true');
    // Real, laid-out box positioned off-screen. A visibility:hidden or 0x0
    // iframe is not painted and prints blank, so keep it sized but off-viewport.
    iframe.style.cssText = 'position:fixed; left:-10000px; top:0; width:816px; height:1056px; border:0;';
    document.body.appendChild(iframe);

    const doc = iframe.contentDocument || iframe.contentWindow.document;
    doc.open();
    doc.write(`<!DOCTYPE html><html><head><meta charset="utf-8"><base href="${location.origin}/"></head><body></body></html>`);
    doc.close();

    // Screen styles (Tailwind etc.) minus JobTread's print-hiding rules.
    copyStyles(doc);

    const tuning = doc.createElement('style');
    tuning.textContent = printFrameCss();
    doc.head.appendChild(tuning);

    const wrap = doc.createElement('div');
    wrap.id = 'jt-print-wrap';
    wrap.dataset.size = fontSize;
    wrap.appendChild(doc.importNode(clone, true));
    doc.body.appendChild(wrap);

    const docName = getDocName(modal);
    if (docName) doc.title = docName;

    const cleanup = () => {
      const f = document.getElementById(IFRAME_ID);
      if (f) f.remove();
    };

    // Styles are inlined synchronously; wait only for the thumbnails, then print.
    preloadImages(clone).then(() => {
      try {
        iframe.contentWindow.focus();
        iframe.contentWindow.print();
      } catch (error) {
        console.error('PrintScope: print failed:', error);
      }
      try {
        iframe.contentWindow.addEventListener('afterprint', () => setTimeout(cleanup, 100));
      } catch (_) { /* ignore */ }
      setTimeout(cleanup, 60000);
    });
  }

  function removeControls() {
    document.querySelectorAll('.' + CONTROLS_CLASS).forEach(el => el.remove());
  }

  async function init() {
    if (isActiveState) return;
    isActiveState = true;
    console.log('PrintScope: Activated');

    await loadFontSize();

    debouncedInject = window.TimingUtils
      ? window.TimingUtils.debounce(injectControls, 150)
      : injectControls;

    // Try immediately in case the modal is already open.
    injectControls();

    // Watch for the modal opening (SPA — no full page loads).
    observer = new MutationObserver(() => debouncedInject());
    observer.observe(document.body, { childList: true, subtree: true });
  }

  function cleanup() {
    if (!isActiveState) return;
    isActiveState = false;

    if (observer) {
      observer.disconnect();
      observer = null;
    }
    if (debouncedInject && typeof debouncedInject.cancel === 'function') {
      debouncedInject.cancel();
    }
    debouncedInject = null;

    removeControls();
    const frame = document.getElementById(IFRAME_ID);
    if (frame) frame.remove();

    console.log('PrintScope: Deactivated');
  }

  return {
    init,
    cleanup,
    isActive: () => isActiveState
  };
})();

// Export for use in main content script
if (typeof window !== 'undefined') {
  window.PrintScopeFeature = PrintScopeFeature;
}
