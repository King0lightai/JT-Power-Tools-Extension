/**
 * Feature Guide sheet — in-popup help.
 *
 * Renders a <dialog> over the popup explaining one feature: what it does,
 * where it shows up in JobTread, and whether it needs API access. Content
 * comes from config/feature-guides.js.
 *
 * Why a sheet and not a link: the help icon used to call chrome.tabs.create()
 * and send the user to the docs site, which CLOSES the popup. They were
 * mid-configuration; now they are on a marketing page and their place is
 * gone. The sheet answers the question in place and still offers the full
 * guide as a link for anyone who wants depth.
 *
 * Also stamps an "API" chip onto the rows of features that need a grant key.
 * That chip is rendered here from the guide data rather than hand-written into
 * popup.html so it cannot drift away from the `apiAccess` field it reports.
 *
 * No innerHTML anywhere in this file — every node is built with createElement
 * and textContent, per .claude/rules/security.md.
 */
const FeatureGuide = (() => {
  'use strict';

  let dialog = null;
  let isInitialised = false;

  /** Tier id → the label shown on the badge. */
  const TIER_LABELS = {
    free: 'Free',
    essential: 'Essential',
    pro: 'Pro',
    'power-user': 'Power User'
  };

  /**
   * Find the row that owns a feature toggle. Most features render as
   * `.feature-item`, but Custom Theme and Record for AI render as
   * `.master-toggle-bar` in their own tabs — both carry the `data-feature`
   * checkbox, so anchor on that and walk up.
   */
  function rowFor(featureId) {
    const input = document.querySelector(`[data-feature="${featureId}"]`);
    return input ? input.closest('.feature-item, .master-toggle-bar') : null;
  }

  /** The element inside a row that holds the feature's name and badges. */
  function titleHolder(row) {
    return row ? row.querySelector('h3, .master-toggle-info') : null;
  }

  function el(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined && text !== null) node.textContent = text;
    return node;
  }

  // ─── API chips on the feature rows ────────────────────────────────────────

  /**
   * Stamp an "API" chip on every row whose feature needs a grant key.
   *
   * This is the whole point of the exercise: toggling on Budget Changelog or
   * Auto Sequence without a key configured produces silence, not an error, and
   * nothing in the popup ever said so. The chip says so before the click.
   */
  function renderAccessChips() {
    if (!window.FeatureGuides) return;

    const { API_ACCESS } = window.FeatureGuides;

    window.FeatureGuides.ids().forEach((featureId) => {
      const guide = window.FeatureGuides.get(featureId);
      if (!guide || guide.apiAccess !== API_ACCESS.REQUIRED) return;

      const holder = titleHolder(rowFor(featureId));
      if (!holder || holder.querySelector('.badge.api')) return;

      const chip = el('span', 'badge api', 'API');
      chip.title = 'Needs a JobTread grant key configured';
      holder.appendChild(document.createTextNode(' '));
      holder.appendChild(chip);
    });
  }

  // ─── The sheet ────────────────────────────────────────────────────────────

  function buildHeader(guide) {
    const header = el('div', 'fg-header');

    const heading = el('h3', 'fg-title', guide.title);
    header.appendChild(heading);

    const badges = el('div', 'fg-badges');
    if (guide.tier && TIER_LABELS[guide.tier]) {
      badges.appendChild(el('span', `badge ${guide.tier}`, TIER_LABELS[guide.tier]));
    }
    if (guide.apiAccess === window.FeatureGuides.API_ACCESS.REQUIRED) {
      badges.appendChild(el('span', 'badge api', 'API'));
    }
    header.appendChild(badges);

    const close = el('button', 'fg-close');
    close.type = 'button';
    close.setAttribute('aria-label', 'Close guide');
    close.appendChild(el('i', 'ph ph-x'));
    close.addEventListener('click', () => hide());
    header.appendChild(close);

    return header;
  }

  /**
   * Build the media element, or null when the entry has none.
   *
   * Created only when the sheet opens, so nothing is fetched for features the
   * user never asks about. `preload="none"` keeps even the open cheap until
   * the video element decides to play. Muted + loop + playsinline is what
   * makes an MP4 behave exactly like the GIF it replaces at a fraction of the
   * bytes.
   */
  function buildMedia(guide) {
    if (!guide.media || !guide.media.file) return null;

    const src = window.FeatureGuides.mediaUrl(guide.media.file);
    const poster = window.FeatureGuides.mediaUrl(guide.media.poster);

    const figure = el('div', 'fg-media');
    const video = document.createElement('video');
    video.src = src;
    if (poster) video.poster = poster;
    video.autoplay = true;
    video.muted = true;
    video.loop = true;
    video.playsInline = true;
    video.preload = 'none';
    video.setAttribute('aria-label', guide.media.alt || guide.title);
    figure.appendChild(video);

    return figure;
  }

  function buildAccessCallout(guide) {
    const { API_ACCESS, PORTAL_KEYS_URL } = window.FeatureGuides;
    if (guide.apiAccess === API_ACCESS.NONE) return null;

    const required = guide.apiAccess === API_ACCESS.REQUIRED;
    const callout = el('div', `fg-access ${required ? 'fg-access--required' : 'fg-access--optional'}`);

    const head = el('div', 'fg-access-head');
    head.appendChild(el('i', required ? 'ph-fill ph-key' : 'ph ph-key'));
    head.appendChild(el('span', null, required ? 'Needs API access' : 'Optional extras'));
    callout.appendChild(head);

    if (guide.accessNote) {
      callout.appendChild(el('p', 'fg-access-note', guide.accessNote));
    }

    if (required) {
      const link = el('button', 'fg-access-link', 'Add a grant key');
      link.type = 'button';
      link.addEventListener('click', () => {
        chrome.tabs.create({ url: PORTAL_KEYS_URL });
      });
      callout.appendChild(link);
    }

    return callout;
  }

  function buildBody(guide) {
    const body = el('div', 'fg-body');

    const media = buildMedia(guide);
    if (media) body.appendChild(media);

    body.appendChild(el('p', 'fg-summary', guide.summary));

    if (guide.where) {
      const where = el('div', 'fg-where');
      where.appendChild(el('i', 'ph ph-map-pin'));
      where.appendChild(el('span', null, guide.where));
      body.appendChild(where);
    }

    if (Array.isArray(guide.steps) && guide.steps.length) {
      const list = el('ol', 'fg-steps');
      guide.steps.forEach((step) => list.appendChild(el('li', null, step)));
      body.appendChild(list);
    }

    const access = buildAccessCallout(guide);
    if (access) body.appendChild(access);

    if (guide.note) {
      const note = el('div', 'fg-note');
      note.appendChild(el('i', 'ph ph-info'));
      note.appendChild(el('span', null, guide.note));
      body.appendChild(note);
    }

    return body;
  }

  function buildFooter(guide) {
    const docs = window.FeatureGuides.docsUrl(guide.docs);
    // No docs page for this feature yet — render no footer rather than a link
    // to a 404, which is the exact failure this sheet replaces.
    if (!docs) return null;

    const footer = el('div', 'fg-footer');
    const link = el('button', 'fg-docs-link', 'Open full guide');
    link.type = 'button';
    link.appendChild(el('i', 'ph ph-arrow-square-out'));
    link.addEventListener('click', () => {
      chrome.tabs.create({ url: docs });
    });
    footer.appendChild(link);
    return footer;
  }

  function render(guide) {
    while (dialog.firstChild) dialog.removeChild(dialog.firstChild);

    const sheet = el('div', 'fg-sheet');
    sheet.appendChild(buildHeader(guide));
    sheet.appendChild(buildBody(guide));

    const footer = buildFooter(guide);
    if (footer) sheet.appendChild(footer);

    dialog.appendChild(sheet);
  }

  /**
   * Open the sheet for a feature id. No-ops when the feature has no guide
   * entry, so a help icon added ahead of its copy degrades to doing nothing
   * rather than opening an empty sheet.
   */
  function show(featureId) {
    if (!dialog || typeof dialog.showModal !== 'function') return;

    const guide = window.FeatureGuides && window.FeatureGuides.get(featureId);
    if (!guide) {
      console.warn(`FeatureGuide: no guide entry for "${featureId}"`);
      return;
    }

    render(guide);
    dialog.showModal();
  }

  function hide() {
    if (dialog && dialog.open) dialog.close();
  }

  function init() {
    if (isInitialised) return;

    dialog = document.querySelector('[data-feature-guide]');
    if (!dialog) {
      console.warn('FeatureGuide: dialog element missing from popup.html');
      return;
    }

    if (!window.FeatureGuides) {
      console.warn('FeatureGuide: config/feature-guides.js not loaded');
      return;
    }

    // Clicking the backdrop closes. The sheet itself stops the event, so a
    // click inside never reaches this handler.
    dialog.addEventListener('click', (e) => {
      if (e.target === dialog) hide();
    });

    document.querySelectorAll('.feature-help[data-guide-for]').forEach((icon) => {
      icon.addEventListener('click', (e) => {
        e.preventDefault();
        // The help icon sits inside the row; without this the click falls
        // through to the row and flips the feature toggle.
        e.stopPropagation();
        show(icon.dataset.guideFor);
      });
    });

    renderAccessChips();

    isInitialised = true;
    console.log('FeatureGuide: Initialized');
  }

  return { init, show, hide };
})();

if (typeof window !== 'undefined') {
  window.FeatureGuide = FeatureGuide;
}
