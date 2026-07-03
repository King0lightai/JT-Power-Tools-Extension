/**
 * JT Power Tools - AI Assistant Panel (Agent Core, Phase 1)
 *
 * Right-side chat drawer wired to the Agent Core server loop
 * (POST /agent/chat, SSE — see .specs/agent-core-spec.md). The panel is
 * pre-loaded with lightweight page context (route, title, visible entity
 * IDs) so the assistant starts oriented to what's on screen.
 *
 * Auth: the extension's existing credentials — license key from
 * LicenseService + the active org's extension grant key from
 * GrantKeyResolver — sent as `Bearer <license_key>:<grant_key>`.
 *
 * Tier: Assistant ($99/mo per company). The client-side check here is
 * cosmetic as always — the server enforces the tier and returns
 * TIER_NO_ASSISTANT (403), which the panel renders as an upgrade notice.
 *
 * Writes: when the server proposes a write draft (draft_proposed frame, or
 * proposed_writes on done), the panel renders it as a card. If the draft was
 * persisted server-side (draft.persisted && draft.id), the card's Apply button
 * runs a two-step confirm → POST /agent/confirm; otherwise Apply is disabled
 * with a re-ask hint. The server is the only thing that executes the write.
 */
const AssistantPanelFeature = (() => {
  const AGENT_URL = 'https://jobtread-mcp-server.king0light-ai.workers.dev/agent/chat';
  // Sibling endpoints (sessions/session/status) share AGENT_URL's origin and path.
  const AGENT_BASE = AGENT_URL.replace(/\/chat$/, '');
  const PORTAL_PROFILE_URL = 'https://app.jtpowertools.com/dashboard#team';
  const LAUNCHER_POS_KEY = 'jtAssistantLauncherPos';
  const PANEL_WIDTH_KEY = 'jtAssistantPanelWidth';
  const DEFAULT_PANEL_WIDTH = 380;
  const MIN_PANEL_WIDTH = 300;

  // One-click job audit — the canned "find something I didn't ask about"
  // prompt. Sent as the task; the chip label is what shows in the chat.
  const JOB_AUDIT_PROMPT =
    'Run a health check on this job. Read the job context and financials, then report: ' +
    '1) approved change orders that have not been invoiced yet, ' +
    '2) budget cost items where actual cost exceeds the estimate, ' +
    '3) schedule tasks past their baseline end date or overdue, ' +
    '4) how recent the last daily log is. ' +
    'Lead with the most important finding and include dollar amounts. ' +
    'If everything is clean, say so in two sentences.';

  // Org credit-pool status banner copy, keyed by server `pool` frame state.
  const POOL_COPY = {
    low: 'Credits are running low — responses may use a lighter model.',
    exhausted:
      'Assistant credits are used up for this cycle — running in reduced mode. Top up or wait for the reset.',
  };

  let isActive = false;
  let launcherEl = null;
  let panelEl = null;
  let poolBannerEl = null;
  let glowEl = null;
  let sessionId = null;
  // Draft cards already rendered this session (draft id / idempotency key) —
  // each draft arrives on two frames and must render once.
  const renderedDraftKeys = new Set();
  let abortController = null;
  let sending = false;
  let statusChecked = false; // profile/skills nudge fires once per page load
  let launcherDrag = null; // { startY, startTop, moved } while a drag is in progress
  let justDragged = false; // suppress the click that follows a drag-release
  // Docked-sidebar push state. When the panel opens it pushes JobTread's app
  // root left via an inline margin-right; we stash the root's PRIOR inline
  // margin/transition so close + cleanup restore them exactly (never assume '').
  let panelWidth = DEFAULT_PANEL_WIDTH;
  let squeezeTarget = null; // the pushed element while the panel is open
  let priorMarginRight = null; // squeezeTarget's inline margin-right before we touched it
  let priorTransition = null; // …and its inline transition
  let restoreTimer = null; // defers transition-restore until the close animation ends
  let panelResizeDrag = null; // { startX, startWidth } while the edge handle is dragged
  const eventListeners = []; // document/window-level — must be removed in cleanup()
  const draftConfirmTimers = new Set(); // pending two-step "are you sure?" reset timers

  // ─── Utilities ────────────────────────────────────────────────────

  function addListener(element, event, handler) {
    element.addEventListener(event, handler);
    eventListeners.push({ element, event, handler });
  }

  function el(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  }

  // ─── Markdown (assistant answers only — escape-first, never raw) ──────
  // Every character of model output is HTML-escaped before any regex runs,
  // so the transforms below can only ever inject the fixed tag set we emit.
  // Prefers window.Sanitizer (matches the rest of the extension) with a
  // local fallback so the renderer works even if Sanitizer hasn't loaded.

  function escapeText(text) {
    const s = text == null ? '' : String(text);
    if (window.Sanitizer && typeof window.Sanitizer.escapeHTML === 'function') {
      return window.Sanitizer.escapeHTML(s);
    }
    return s
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  // Returns an attribute-safe href, or '' when the URL is unsafe (js:, data:,
  // etc.) so the caller can drop the link and keep the text.
  function safeHref(url) {
    let clean = '';
    if (window.Sanitizer && typeof window.Sanitizer.sanitizeURL === 'function') {
      clean = window.Sanitizer.sanitizeURL(url, '');
    } else {
      const t = String(url || '').trim();
      if (/^(https?:\/\/|\/|#)/i.test(t) && !/["'<>\s`]/.test(t)) clean = t;
    }
    if (!clean || clean === '#') return '';
    if (window.Sanitizer && typeof window.Sanitizer.escapeAttr === 'function') {
      return window.Sanitizer.escapeAttr(clean);
    }
    return clean.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  // Inline transforms run on ALREADY-escaped text.
  function inlineMarkdown(escaped) {
    let html = escaped;
    // Links [text](url) — url through safeHref; drop the link (keep text) if unsafe.
    html = html.replace(/\[([^\]\n]+)\]\(([^)\n]+)\)/g, (_m, text, url) => {
      const href = safeHref(url);
      if (!href) return text;
      return `<a href="${href}" target="_blank" rel="noopener noreferrer">${text}</a>`;
    });
    html = html.replace(/`([^`\n]+)`/g, '<code>$1</code>');
    html = html.replace(/\*\*([^*\n]+)\*\*/g, '<strong>$1</strong>');
    html = html.replace(/(?<!\*)\*(?!\*)([^*\n]+)\*(?!\*)/g, '<em>$1</em>');
    return html;
  }

  function splitTableRow(line) {
    let s = line.trim();
    if (s.startsWith('|')) s = s.slice(1);
    if (s.endsWith('|')) s = s.slice(0, -1);
    return s.split('|').map((c) => c.trim());
  }

  function renderTable(headerLine, bodyLines) {
    const headers = splitTableRow(headerLine);
    let html = '<table class="jt-assistant-md-table"><thead><tr>';
    html += headers.map((c) => `<th>${inlineMarkdown(escapeText(c))}</th>`).join('');
    html += '</tr></thead><tbody>';
    for (const row of bodyLines) {
      const cells = splitTableRow(row);
      html += '<tr>' + cells.map((c) => `<td>${inlineMarkdown(escapeText(c))}</td>`).join('') + '</tr>';
    }
    html += '</tbody></table>';
    return html;
  }

  // Block-level renderer. Returns an HTML string safe to assign to innerHTML.
  function renderMarkdown(src) {
    const lines = (src == null ? '' : String(src)).split('\n');
    const out = [];
    let para = [];
    let i = 0;

    const flushPara = () => {
      if (!para.length) return;
      out.push(`<p>${para.map((l) => inlineMarkdown(escapeText(l))).join('<br>')}</p>`);
      para = [];
    };

    while (i < lines.length) {
      const line = lines[i];
      const trimmed = line.trim();

      // Fenced code block
      if (/^```/.test(trimmed)) {
        flushPara();
        const buf = [];
        i++;
        while (i < lines.length && !/^```/.test(lines[i].trim())) {
          buf.push(lines[i]);
          i++;
        }
        i++; // consume closing fence
        out.push(`<pre><code>${escapeText(buf.join('\n'))}</code></pre>`);
        continue;
      }

      // Heading (# / ## → h3, deeper → h4 — compact chat scale)
      const heading = trimmed.match(/^(#{1,6})\s+(.*)$/);
      if (heading) {
        flushPara();
        const level = heading[1].length <= 2 ? 3 : 4;
        out.push(`<h${level}>${inlineMarkdown(escapeText(heading[2]))}</h${level}>`);
        i++;
        continue;
      }

      // GitHub-style pipe table: a row followed by a |---|---| separator
      if (
        trimmed.includes('|') &&
        i + 1 < lines.length &&
        lines[i + 1].includes('-') &&
        /^\s*\|?[\s:|-]+\|?\s*$/.test(lines[i + 1])
      ) {
        flushPara();
        const headerLine = line;
        i += 2; // skip header + separator
        const bodyRows = [];
        while (i < lines.length && lines[i].includes('|') && lines[i].trim() !== '') {
          bodyRows.push(lines[i]);
          i++;
        }
        out.push(renderTable(headerLine, bodyRows));
        continue;
      }

      // Unordered list
      if (/^[-*]\s+/.test(trimmed)) {
        flushPara();
        const items = [];
        while (i < lines.length && /^[-*]\s+/.test(lines[i].trim())) {
          items.push(lines[i].trim().replace(/^[-*]\s+/, ''));
          i++;
        }
        out.push(`<ul>${items.map((it) => `<li>${inlineMarkdown(escapeText(it))}</li>`).join('')}</ul>`);
        continue;
      }

      // Ordered list
      if (/^\d+\.\s+/.test(trimmed)) {
        flushPara();
        const items = [];
        while (i < lines.length && /^\d+\.\s+/.test(lines[i].trim())) {
          items.push(lines[i].trim().replace(/^\d+\.\s+/, ''));
          i++;
        }
        out.push(`<ol>${items.map((it) => `<li>${inlineMarkdown(escapeText(it))}</li>`).join('')}</ol>`);
        continue;
      }

      if (trimmed === '') {
        flushPara();
        i++;
        continue;
      }

      para.push(line);
      i++;
    }

    flushPara();
    return out.join('');
  }

  // Relative "time ago" — no shared helper exists in this module.
  function relativeTime(unixSeconds) {
    if (!unixSeconds) return '';
    const diffSec = Math.round((Date.now() - unixSeconds * 1000) / 1000);
    if (diffSec < 45) return 'just now';
    const min = Math.round(diffSec / 60);
    if (min < 60) return `${min}m ago`;
    const hr = Math.round(min / 60);
    if (hr < 24) return `${hr}h ago`;
    const day = Math.round(hr / 24);
    if (day < 7) return `${day}d ago`;
    const wk = Math.round(day / 7);
    if (wk < 5) return `${wk}w ago`;
    const mo = Math.round(day / 30);
    if (mo < 12) return `${mo}mo ago`;
    return `${Math.round(day / 365)}y ago`;
  }

  // ─── Styles ───────────────────────────────────────────────────────

  // Panel styling rides the shared .jt-tools-surface tokens (same pattern
  // as the tweak builder) — inject both sheets, remove both in cleanup.
  const STYLE_FILES = ['styles/jt-tools-tokens.css', 'styles/assistant-panel.css'];
  const styleId = (file) => `jt-assistant-style-${file.split('/').pop()}`;

  function injectStyles() {
    for (const file of STYLE_FILES) {
      if (document.getElementById(styleId(file))) continue;
      const link = document.createElement('link');
      link.rel = 'stylesheet';
      link.href = chrome.runtime.getURL(file);
      link.id = styleId(file);
      document.head.appendChild(link);
    }
  }

  function removeStyles() {
    for (const file of STYLE_FILES) {
      const link = document.getElementById(styleId(file));
      if (link) link.remove();
    }
  }

  // ─── Page context (spec: route + visible entity IDs) ──────────────

  function collectPageContext() {
    const path = window.location.pathname;
    const entityIds = {};
    // JobTread SPA routes carry entity ids as path segments. Grab the
    // common ones; unknown routes still send path + title, which is
    // usually enough for the assistant to orient itself.
    const patterns = {
      jobId: /\/jobs\/([A-Za-z0-9]+)/,
      taskId: /\/tasks\/([A-Za-z0-9]+)/,
      documentId: /\/documents\/([A-Za-z0-9]+)/,
      accountId: /\/accounts\/([A-Za-z0-9]+)/,
    };
    for (const [key, re] of Object.entries(patterns)) {
      const match = path.match(re);
      if (match) entityIds[key] = match[1];
    }
    return {
      page: { path, title: document.title },
      ...(Object.keys(entityIds).length ? { entityIds } : {}),
    };
  }

  // ─── Auth ─────────────────────────────────────────────────────────

  async function resolveBearer() {
    if (!window.LicenseService || !window.GrantKeyResolver) {
      return { error: 'Sign in through the JT Power Tools popup to use the assistant.' };
    }
    const licenseData = await window.LicenseService.getLicenseData();
    if (!licenseData || !licenseData.valid || !licenseData.key) {
      return { error: 'No valid license found. Add your license key in the JT Power Tools popup.' };
    }
    const grantKey = await window.GrantKeyResolver.getGrantKey();
    if (!grantKey) {
      return {
        error:
          'No JobTread grant key is configured for this org. Set one up in the JT Power Tools portal.',
      };
    }
    // Portal access token (governance): the server requires it alongside the
    // license:grant bearer so it can enforce per-user assistant access.
    const accountToken = await window.AccountService?.getAccessToken?.();
    if (!accountToken) {
      return {
        error: 'Sign in to your JT Power Tools account (extension popup) to use the assistant.',
      };
    }
    return { bearer: `${licenseData.key}:${grantKey}`, accountToken };
  }

  // ─── Suggested prompts (context-aware chips) ──────────────────────
  // The blank input box is where first sessions die. Chips seed the
  // conversation with questions matched to the page the user is on;
  // "Check this job" is the canned audit that leads with a finding.

  function getSuggestions(context) {
    const path = context?.page?.path || '';
    const onJob = Boolean(context?.entityIds?.jobId);

    if (onJob && /budget|cost/i.test(path)) {
      return [
        { label: 'Check this job', task: JOB_AUDIT_PROMPT },
        { label: 'Which items are over estimate?' },
        { label: 'Any change orders not invoiced yet?' },
      ];
    }
    if (onJob && /schedule|task/i.test(path)) {
      return [
        { label: 'Check this job', task: JOB_AUDIT_PROMPT },
        { label: "What's slipping on this job?" },
        { label: 'What has to happen this week?' },
      ];
    }
    if (onJob) {
      return [
        { label: 'Check this job', task: JOB_AUDIT_PROMPT },
        { label: "What's the story on this job?" },
        { label: 'Where are we vs. budget?' },
      ];
    }
    if (/schedule/i.test(path)) {
      return [
        { label: "What's behind schedule this week?" },
        { label: 'Who is overloaded next week?' },
        { label: "Summarize yesterday's daily logs" },
      ];
    }
    return [
      { label: 'Which jobs have unbilled change orders?' },
      { label: "What's behind schedule this week?" },
      { label: "Summarize yesterday's daily logs" },
    ];
  }

  function renderChips() {
    const chips = panelEl?.querySelector('[data-jt-role="chips"]');
    if (!chips) return;
    chips.replaceChildren();
    for (const suggestion of getSuggestions(collectPageContext())) {
      const chip = el('button', 'jt-assistant-chip', suggestion.label);
      chip.type = 'button';
      chip.addEventListener('click', () =>
        void submitTask(suggestion.task || suggestion.label, suggestion.label)
      );
      chips.appendChild(chip);
    }
  }

  // ─── Working glow (presence while a run is active) ────────────────
  // Honest signal, not theater: the viewport tints brand-orange only
  // while the agent is actually reading the org's live data, and the
  // launcher breathes so the state is visible with the panel closed.

  function buildGlow() {
    glowEl = el('div', 'jt-assistant-glow');
    glowEl.setAttribute('aria-hidden', 'true');
    document.body.appendChild(glowEl);
  }

  function setWorking(on) {
    if (glowEl) glowEl.classList.toggle('jt-assistant-glow-active', on);
    if (launcherEl) launcherEl.classList.toggle('jt-assistant-launcher-working', on);
  }

  // ─── Panel UI ─────────────────────────────────────────────────────

  function buildLauncher() {
    launcherEl = el('button', 'jt-assistant-launcher');
    launcherEl.type = 'button';
    launcherEl.setAttribute('aria-label', 'Open JT Power Tools Assistant');
    launcherEl.title = 'JT Power Tools Assistant';
    launcherEl.textContent = 'AI';
    // Click toggles the panel — but a click that followed a drag is swallowed.
    launcherEl.addEventListener('click', onLauncherClick);
    launcherEl.addEventListener('pointerdown', onLauncherPointerDown);
    document.body.appendChild(launcherEl);
    // Move/up ride on the document so a fast drag that outruns the button
    // still tracks — document-level, so they must be removed in cleanup().
    addListener(document, 'pointermove', onLauncherPointerMove);
    addListener(document, 'pointerup', onLauncherPointerUp);
    restoreLauncherPos();
  }

  function onLauncherClick() {
    if (justDragged) {
      justDragged = false;
      return;
    }
    togglePanel();
  }

  // Vertical-only drag along the right edge. A 5px movement threshold keeps a
  // plain click from being read as a drag.
  function onLauncherPointerDown(e) {
    if (e.button != null && e.button !== 0) return;
    justDragged = false; // fresh press — don't inherit a stale drag's suppression
    const rect = launcherEl.getBoundingClientRect();
    launcherDrag = { startY: e.clientY, startTop: rect.top, moved: false };
  }

  function onLauncherPointerMove(e) {
    if (!launcherDrag || !launcherEl) return;
    const dy = e.clientY - launcherDrag.startY;
    if (!launcherDrag.moved && Math.abs(dy) < 5) return;
    launcherDrag.moved = true;
    launcherEl.classList.add('jt-assistant-launcher-dragging');
    setLauncherTop(launcherDrag.startTop + dy);
  }

  function onLauncherPointerUp() {
    if (!launcherDrag) return;
    const { moved } = launcherDrag;
    launcherDrag = null;
    if (launcherEl) launcherEl.classList.remove('jt-assistant-launcher-dragging');
    if (moved) {
      justDragged = true; // the trailing click is not a toggle
      const top = parseInt(launcherEl?.style.top || '', 10);
      if (!Number.isNaN(top)) persistLauncherPos(top);
    }
  }

  // Clamp within the viewport (top 60px … bottom 24px) and pin to the right edge.
  function setLauncherTop(top) {
    if (!launcherEl) return;
    const h = launcherEl.offsetHeight || 40;
    const maxTop = Math.max(60, window.innerHeight - h - 24);
    const clamped = Math.max(60, Math.min(top, maxTop));
    launcherEl.style.top = `${clamped}px`;
    launcherEl.style.bottom = 'auto';
    launcherEl.style.transform = 'none';
    return clamped;
  }

  function persistLauncherPos(top) {
    try {
      chrome.storage.local.set({ [LAUNCHER_POS_KEY]: top });
    } catch {
      // Non-fatal — the launcher just won't remember its spot.
    }
  }

  function restoreLauncherPos() {
    try {
      chrome.storage.local.get(LAUNCHER_POS_KEY, (res) => {
        const top = res && res[LAUNCHER_POS_KEY];
        if (typeof top === 'number' && launcherEl) setLauncherTop(top);
      });
    } catch {
      // Non-fatal — fall back to the CSS default position.
    }
  }

  // ─── Docked push sidebar (squeeze + edge resize) ─────────────────────
  // Study note (Smart Resize / job-switcher.js): it pushes JobTread by writing
  // padding-right onto whichever sibling containers JT itself pads, and lets a
  // MutationObserver re-apply as the SPA re-renders. Here the panel is a single
  // persistent dock, so we take the simpler robust route the spec calls out:
  // one margin-right on JobTread's React mount (#root). #root is normal-flow
  // (flex column, no fixed width), so a right margin shrinks its used width and
  // the header/main reflow into the narrower box — a real push, not an overlay.
  // Falls back to document.body if #root is ever absent.

  function getSqueezeTarget() {
    return document.getElementById('root') || document.body;
  }

  function maxPanelWidth() {
    return Math.round((window.innerWidth || DEFAULT_PANEL_WIDTH * 2) * 0.5);
  }

  function clampWidth(width) {
    return Math.max(MIN_PANEL_WIDTH, Math.min(width, maxPanelWidth()));
  }

  // Live-set the panel width and keep the page squeeze in lockstep.
  function setPanelWidth(width) {
    panelWidth = width;
    if (panelEl) panelEl.style.width = `${width}px`;
    if (squeezeTarget) squeezeTarget.style.marginRight = `${width}px`;
  }

  function applySqueeze() {
    squeezeTarget = getSqueezeTarget();
    priorMarginRight = squeezeTarget.style.marginRight;
    priorTransition = squeezeTarget.style.transition;
    if (restoreTimer) {
      clearTimeout(restoreTimer);
      restoreTimer = null;
    }
    squeezeTarget.style.transition = 'margin-right 0.2s ease';
    squeezeTarget.style.marginRight = `${panelWidth}px`;
    if (panelEl) panelEl.style.width = `${panelWidth}px`;
  }

  // Animate the page back, then restore the target's prior inline transition
  // once the animation finishes. Exact restore of margin-right is synchronous.
  function releaseSqueeze() {
    if (!squeezeTarget) return;
    const target = squeezeTarget;
    const restoreMargin = priorMarginRight;
    const restoreTransition = priorTransition;
    target.style.transition = 'margin-right 0.2s ease';
    target.style.marginRight = restoreMargin == null ? '' : restoreMargin;
    if (restoreTimer) clearTimeout(restoreTimer);
    restoreTimer = setTimeout(() => {
      target.style.transition = restoreTransition == null ? '' : restoreTransition;
      restoreTimer = null;
    }, 220);
    squeezeTarget = null;
    priorMarginRight = null;
    priorTransition = null;
  }

  // Immediate, exact restore for cleanup() — no animation, no lingering timer.
  function restoreSqueezeImmediate() {
    if (restoreTimer) {
      clearTimeout(restoreTimer);
      restoreTimer = null;
    }
    if (squeezeTarget) {
      squeezeTarget.style.marginRight = priorMarginRight == null ? '' : priorMarginRight;
      squeezeTarget.style.transition = priorTransition == null ? '' : priorTransition;
    }
    squeezeTarget = null;
    priorMarginRight = null;
    priorTransition = null;
  }

  function persistPanelWidth(width) {
    try {
      chrome.storage.local.set({ [PANEL_WIDTH_KEY]: width });
    } catch {
      // Non-fatal — the panel just won't remember its width.
    }
  }

  function restorePanelWidth() {
    try {
      chrome.storage.local.get(PANEL_WIDTH_KEY, (res) => {
        const width = res && res[PANEL_WIDTH_KEY];
        // Re-clamp on restore: the viewport may be smaller than when saved.
        if (typeof width === 'number') panelWidth = clampWidth(width);
      });
    } catch {
      // Non-fatal — fall back to the default width.
    }
  }

  // Edge handle — same tracked-listener discipline as the launcher drag.
  // Transitions are suppressed mid-drag so the page tracks the cursor 1:1.
  function onPanelResizePointerDown(e) {
    if (e.button != null && e.button !== 0) return;
    e.preventDefault();
    panelResizeDrag = { startX: e.clientX, startWidth: panelWidth };
    document.body.style.userSelect = 'none';
    if (panelEl) panelEl.style.transition = 'none';
    if (squeezeTarget) squeezeTarget.style.transition = 'none';
    const handle = panelEl?.querySelector('.jt-assistant-resize-handle');
    if (handle) handle.classList.add('jt-assistant-resize-active');
  }

  function onPanelResizePointerMove(e) {
    if (!panelResizeDrag) return;
    // Panel is on the right edge, so dragging left widens it.
    const delta = panelResizeDrag.startX - e.clientX;
    setPanelWidth(clampWidth(panelResizeDrag.startWidth + delta));
  }

  function onPanelResizePointerUp() {
    if (!panelResizeDrag) return;
    panelResizeDrag = null;
    document.body.style.userSelect = '';
    if (panelEl) panelEl.style.transition = '';
    if (squeezeTarget) squeezeTarget.style.transition = 'margin-right 0.2s ease';
    const handle = panelEl?.querySelector('.jt-assistant-resize-handle');
    if (handle) handle.classList.remove('jt-assistant-resize-active');
    persistPanelWidth(panelWidth);
  }

  // Viewport shrank with the panel open — re-clamp so it never exceeds max.
  function onWindowResize() {
    if (!panelEl || !panelEl.classList.contains('jt-assistant-open')) return;
    const clamped = clampWidth(panelWidth);
    if (clamped !== panelWidth) setPanelWidth(clamped);
  }

  function buildPanel() {
    panelEl = el('div', 'jt-tools-surface jt-assistant-panel');
    panelEl.setAttribute('role', 'dialog');
    panelEl.setAttribute('aria-label', 'JT Power Tools Assistant');

    // Left-edge resize handle. Move/up ride on the document so a fast drag
    // still tracks — those are tracked via addListener for cleanup().
    const resizeHandle = el('div', 'jt-assistant-resize-handle');
    resizeHandle.setAttribute('aria-hidden', 'true');
    resizeHandle.addEventListener('pointerdown', onPanelResizePointerDown);
    panelEl.appendChild(resizeHandle);
    addListener(document, 'pointermove', onPanelResizePointerMove);
    addListener(document, 'pointerup', onPanelResizePointerUp);

    // Header
    const header = el('div', 'jt-assistant-header');
    header.appendChild(el('span', 'jt-assistant-title', 'Assistant'));
    const headerActions = el('div', 'jt-assistant-header-actions');
    const historyBtn = el('button', 'jtt-btn jt-assistant-history-btn', '◷');
    historyBtn.type = 'button';
    historyBtn.title = 'Chat history';
    historyBtn.setAttribute('aria-label', 'Chat history');
    historyBtn.addEventListener('click', () => void openHistory());
    const newBtn = el('button', 'jtt-btn jt-assistant-new-btn', 'New chat');
    newBtn.type = 'button';
    newBtn.title = 'Start a fresh session';
    newBtn.addEventListener('click', resetSession);
    const closeBtn = el('button', 'jtt-btn jt-assistant-close-btn', '×');
    closeBtn.type = 'button';
    closeBtn.setAttribute('aria-label', 'Close assistant');
    closeBtn.addEventListener('click', togglePanel);
    headerActions.appendChild(historyBtn);
    headerActions.appendChild(newBtn);
    headerActions.appendChild(closeBtn);
    header.appendChild(headerActions);
    panelEl.appendChild(header);

    // Messages
    const messages = el('div', 'jt-assistant-messages');
    messages.dataset.jtRole = 'messages';
    panelEl.appendChild(messages);

    // Chat-history view — swaps in over the messages area (hidden by default).
    const history = el('div', 'jt-assistant-history');
    history.dataset.jtRole = 'history';
    panelEl.appendChild(history);

    // Status line (tool activity)
    const status = el('div', 'jt-assistant-status');
    status.dataset.jtRole = 'status';
    panelEl.appendChild(status);

    // Suggested prompt chips (re-rendered per page on open/done)
    const chips = el('div', 'jt-assistant-chips');
    chips.dataset.jtRole = 'chips';
    panelEl.appendChild(chips);

    // Composer
    const composer = el('div', 'jt-assistant-composer');
    const input = document.createElement('textarea');
    input.className = 'jtt-input jt-assistant-input';
    input.rows = 2;
    input.placeholder = 'Ask about this job, the schedule, the budget…';
    input.dataset.jtRole = 'input';
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        void handleSend();
      }
    });
    const sendBtn = el('button', 'jtt-btn jtt-btn-primary jt-assistant-send', 'Send');
    sendBtn.type = 'button';
    sendBtn.dataset.jtRole = 'send';
    sendBtn.addEventListener('click', () => void handleSend());
    composer.appendChild(input);
    composer.appendChild(sendBtn);
    panelEl.appendChild(composer);

    // Footer (usage)
    const footer = el('div', 'jt-assistant-footer');
    footer.dataset.jtRole = 'footer';
    panelEl.appendChild(footer);

    document.body.appendChild(panelEl);

    appendSystemNote(
      'Connected to your JobTread data (read-only for now). Answers come from live tool calls, not memory.'
    );
  }

  function togglePanel() {
    if (!panelEl) buildPanel();
    const open = panelEl.classList.toggle('jt-assistant-open');
    if (launcherEl) launcherEl.classList.toggle('jt-assistant-launcher-hidden', open);
    if (open) {
      applySqueeze(); // dock: push JobTread left to make room
      renderChips(); // the SPA route may have changed since last open
      if (!statusChecked) {
        statusChecked = true; // once per page load, whatever the result
        void checkProfileStatus();
      }
      const input = panelEl.querySelector('[data-jt-role="input"]');
      if (input) input.focus();
    } else {
      releaseSqueeze(); // undock: hand the page's width back
    }
  }

  function resetSession() {
    sessionId = null;
    renderedDraftKeys.clear();
    if (abortController) abortController.abort();
    const messages = panelEl?.querySelector('[data-jt-role="messages"]');
    if (messages) messages.replaceChildren();
    setStatus('');
    appendSystemNote('New session started.');
  }

  // ─── Message rendering (textContent only — never innerHTML) ───────

  function messagesEl() {
    return panelEl?.querySelector('[data-jt-role="messages"]');
  }

  function scrollToBottom() {
    const messages = messagesEl();
    if (messages) messages.scrollTop = messages.scrollHeight;
  }

  function appendBubble(role, text) {
    const messages = messagesEl();
    if (!messages) return null;
    const bubble = el('div', `jt-assistant-bubble jt-assistant-bubble-${role}`, text || '');
    messages.appendChild(bubble);
    scrollToBottom();
    return bubble;
  }

  function appendSystemNote(text) {
    const messages = messagesEl();
    if (!messages) return;
    messages.appendChild(el('div', 'jt-assistant-note', text));
    scrollToBottom();
  }

  // A completed assistant turn loaded from history: optional "Read: …" tool
  // line above the markdown-rendered answer.
  function appendAssistantTurn(turn) {
    const messages = messagesEl();
    if (!messages) return;
    const bubble = el('div', 'jt-assistant-bubble jt-assistant-bubble-assistant jt-assistant-md');
    if (Array.isArray(turn.tools) && turn.tools.length) {
      bubble.appendChild(el('div', 'jt-assistant-tools-line', `Read: ${turn.tools.join(', ')}`));
    }
    const body = el('div', 'jt-assistant-md-body');
    body.innerHTML = renderMarkdown(turn.text || '');
    bubble.appendChild(body);
    messages.appendChild(bubble);
    scrollToBottom();
  }

  // A proposed write. When the server persisted it (draft.persisted && draft.id)
  // the card carries a working Apply → confirm flow; otherwise Apply is disabled
  // with a re-ask hint. All model-authored text (humanSummary, args, result)
  // goes through textContent — never innerHTML.
  function appendDraftCard(draft) {
    const messages = messagesEl();
    if (!messages) return;

    // Each draft arrives twice — a streaming draft_proposed frame AND the done
    // frame's proposed_writes (kept as a fallback for dropped frames). Render
    // once: key on the persisted id, falling back to the idempotency key.
    const key = draft.id || draft.idempotencyKey;
    if (key) {
      if (renderedDraftKeys.has(key)) return;
      renderedDraftKeys.add(key);
    }

    const card = el('div', 'jt-assistant-draft');
    card.appendChild(el('div', 'jt-assistant-draft-title', 'Proposed change (draft)'));
    // What will happen, up front.
    card.appendChild(
      el('div', 'jt-assistant-draft-summary', draft.humanSummary || draft.tool || 'Proposed write')
    );

    // Collapsed disclosure: the exact args the write would send (model output).
    const details = el('details', 'jt-assistant-draft-details');
    details.appendChild(el('summary', 'jt-assistant-draft-details-summary', 'Details'));
    let argsText;
    try {
      argsText = JSON.stringify(draft.args ?? draft, null, 2);
    } catch {
      argsText = String(draft.args ?? '');
    }
    details.appendChild(el('pre', 'jt-assistant-draft-args', argsText));
    card.appendChild(details);

    const apply = el('button', 'jtt-btn jt-assistant-draft-apply', 'Apply');
    apply.type = 'button';
    const note = el('div', 'jt-assistant-draft-note');
    note.dataset.jtRole = 'draft-note';

    // No server-side draft record → nothing to confirm against.
    if (!(draft.persisted && draft.id)) {
      apply.disabled = true;
      apply.title = 'Could not save this draft — re-ask';
      card.appendChild(apply);
      card.appendChild(el('div', 'jt-assistant-draft-hint', 'Could not save this draft — re-ask'));
      messages.appendChild(card);
      scrollToBottom();
      return;
    }

    card.appendChild(apply);
    card.appendChild(note);

    // Two-step confirm: first click arms for 4s, second click within the window
    // fires. Less jarring than a modal, and the armed label makes intent clear.
    let armed = false;
    let armTimer = null;

    const disarm = () => {
      armed = false;
      if (armTimer) {
        clearTimeout(armTimer);
        draftConfirmTimers.delete(armTimer);
        armTimer = null;
      }
      apply.classList.remove('jt-assistant-draft-apply-armed');
      apply.textContent = 'Apply';
    };

    const showApplied = (label, resultText) => {
      disarm();
      apply.remove();
      note.textContent = '';
      note.className = 'jt-assistant-draft-note';
      card.classList.add('jt-assistant-draft-applied');
      card.appendChild(el('div', 'jt-assistant-draft-status', `✓ ${label}`));
      if (resultText) {
        const result = el('details', 'jt-assistant-draft-result');
        result.appendChild(el('summary', 'jt-assistant-draft-details-summary', 'Result'));
        result.appendChild(el('pre', 'jt-assistant-draft-result-text', resultText));
        card.appendChild(result);
      }
      scrollToBottom();
    };

    const runConfirm = async () => {
      disarm();
      apply.disabled = true;
      apply.textContent = 'Applying…';
      note.textContent = '';
      note.className = 'jt-assistant-draft-note';

      const result = await agentPost('confirm', { draft_id: draft.id });

      if (result.data && result.data.status === 'executed') {
        showApplied('Applied', result.data.result_text);
        return;
      }
      // Already applied (someone else, or a double-fire) — success with a note.
      if (result.status === 409 && result.code === 'DRAFT_ALREADY_EXECUTED') {
        showApplied('Already applied');
        return;
      }
      // Failed status on a 200, or a hard HTTP error — surface it, re-arm.
      const message =
        (result.data && result.data.error) ||
        result.error ||
        'The change could not be applied.';
      note.textContent = message;
      note.className = 'jt-assistant-draft-note jt-assistant-draft-note-error';
      apply.disabled = false;
      apply.textContent = 'Retry apply';
    };

    apply.addEventListener('click', () => {
      if (armed) {
        void runConfirm();
        return;
      }
      armed = true;
      apply.classList.add('jt-assistant-draft-apply-armed');
      apply.textContent = 'Apply — are you sure?';
      armTimer = setTimeout(disarm, 4000);
      draftConfirmTimers.add(armTimer);
    });

    messages.appendChild(card);
    scrollToBottom();
  }

  function setStatus(text) {
    const status = panelEl?.querySelector('[data-jt-role="status"]');
    if (status) status.textContent = text;
  }

  // Org-level credit-pool banner, pinned above the composer. Created on the
  // first `pool` frame, updated in place on later frames, and persisted for
  // the session (not cleared between runs). Removed with the panel in cleanup.
  function renderPoolBanner(state) {
    const copy = POOL_COPY[state];
    if (!copy || !panelEl) return;
    if (!poolBannerEl) {
      poolBannerEl = el('div', 'jt-assistant-pool-banner');
      poolBannerEl.dataset.jtRole = 'pool-banner';
      const composer = panelEl.querySelector('.jt-assistant-composer');
      panelEl.insertBefore(poolBannerEl, composer);
    }
    poolBannerEl.className = `jt-assistant-pool-banner jt-assistant-pool-banner-${state}`;
    poolBannerEl.textContent = copy;
  }

  function setUsage(usage) {
    const footer = panelEl?.querySelector('[data-jt-role="footer"]');
    if (!footer || !usage) return;
    const cents = usage.costCents ?? 0;
    footer.textContent = `Session: ${usage.outputTokens ?? 0} tokens out · ~$${(cents / 100).toFixed(2)}`;
  }

  function setSending(state) {
    sending = state;
    setWorking(state);
    const sendBtn = panelEl?.querySelector('[data-jt-role="send"]');
    if (sendBtn) {
      sendBtn.disabled = state;
      sendBtn.textContent = state ? '…' : 'Send';
    }
    // Chips make no sense mid-run; they re-render for the (possibly new)
    // page when the run finishes.
    const chips = panelEl?.querySelector('[data-jt-role="chips"]');
    if (chips) {
      if (state) chips.replaceChildren();
      else renderChips();
    }
  }

  // ─── Send + SSE consumption ───────────────────────────────────────

  async function handleSend() {
    if (!panelEl) return;
    const input = panelEl.querySelector('[data-jt-role="input"]');
    const task = (input?.value || '').trim();
    if (!task) return;
    input.value = '';
    await submitTask(task, task);
  }

  /**
   * Run one task. `displayText` is what shows in the user bubble — chip
   * sends show their short label while the full canned prompt goes to
   * the server.
   */
  async function submitTask(task, displayText) {
    if (sending || !panelEl) return;

    const auth = await resolveBearer();
    if (auth.error) {
      appendSystemNote(auth.error);
      return;
    }

    appendBubble('user', displayText || task);
    setSending(true);
    setStatus('Thinking…');

    abortController = new AbortController();
    let assistantBubble = null;
    let assistantText = ''; // raw markdown accumulated across deltas

    try {
      const response = await fetch(AGENT_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${auth.bearer}`,
          'X-Account-Token': auth.accountToken,
          Accept: 'text/event-stream',
        },
        body: JSON.stringify({
          task,
          session_id: sessionId || undefined,
          context: collectPageContext(),
        }),
        signal: abortController.signal,
      });

      if (!response.ok) {
        const detail = await response.json().catch(() => ({}));
        appendSystemNote(friendlyHttpError(response.status, detail));
        return;
      }

      const ensureBubble = () => {
        if (!assistantBubble) {
          assistantBubble = appendBubble('assistant', '');
          assistantBubble.classList.add('jt-assistant-md');
        }
        return assistantBubble;
      };

      const handleDone = (frame) => {
        sessionId = frame.session_id || sessionId;
        // Server truth wins: replace streamed text with the final answer
        // if they diverge (e.g. multi-iteration runs).
        if (frame.answer && ensureBubble()) {
          assistantText = frame.answer;
          assistantBubble.innerHTML = renderMarkdown(assistantText);
        }
        for (const draft of frame.proposed_writes || []) appendDraftCard(draft);
        setUsage(frame.usage);
        if (frame.status === 'budget_exhausted') {
          appendSystemNote('This run hit its budget cap — ask a narrower follow-up to continue.');
        }
        setStatus('');
      };

      const frameHandlers = {
        text_delta: (frame) => {
          if (ensureBubble()) {
            assistantText += frame.text;
            // Re-render the whole bubble per delta — cheap at chat scale and
            // keeps in-progress markdown (lists, code) looking right.
            assistantBubble.innerHTML = renderMarkdown(assistantText);
            scrollToBottom();
          }
          setStatus('');
        },
        tool_started: (frame) => setStatus(`Reading ${frame.label || frame.name}…`),
        pool: (frame) => renderPoolBanner(frame.state),
        draft_proposed: (frame) => appendDraftCard(frame.draft || {}),
        usage: (frame) => setUsage(frame.usage),
        done: handleDone,
        error: (frame) => {
          appendSystemNote(`Something went wrong: ${frame.error}`);
          setStatus('');
        },
      };

      const handleFrame = (frame) => frameHandlers[frame.type]?.(frame);

      await consumeSse(response.body, handleFrame);
      scrollToBottom();
    } catch (err) {
      if (err.name !== 'AbortError') {
        console.log('AssistantPanel: request failed:', err.message);
        appendSystemNote(`Could not reach the assistant: ${err.message}`);
      }
    } finally {
      setSending(false);
      setStatus('');
      abortController = null;
    }
  }

  async function consumeSse(body, onFrame) {
    const reader = body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      let boundary;
      while ((boundary = buffer.indexOf('\n\n')) !== -1) {
        const rawEvent = buffer.slice(0, boundary);
        buffer = buffer.slice(boundary + 2);
        for (const line of rawEvent.split('\n')) {
          if (!line.startsWith('data: ')) continue;
          try {
            onFrame(JSON.parse(line.slice(6)));
          } catch {
            // Malformed frame — skip rather than kill the stream.
          }
        }
      }
    }
  }

  function friendlyHttpError(status, detail) {
    if (status === 403 && detail?.code === 'TIER_NO_ASSISTANT') {
      return (
        'The AI Assistant is part of the Assistant plan ($99/mo per company). ' +
        'Your current tier does not include it — see jtpowertools.com/pricing.'
      );
    }
    if (status === 403 && detail?.code === 'USER_NO_ASSISTANT') {
      // Admin hasn't enabled the assistant for this user — surface the
      // server's message verbatim (no pricing link; it's not a tier issue).
      return detail?.error || "Your admin hasn't enabled the assistant for your account.";
    }
    if (status === 401 && (detail?.code === 'ACCOUNT_REQUIRED' || detail?.code === 'ACCOUNT_INVALID')) {
      return 'Sign in to your JT Power Tools account in the extension popup to use the assistant.';
    }
    if (status === 401) {
      return 'Authentication failed. Re-check your license and grant key in the JT Power Tools popup.';
    }
    return detail?.error || `The assistant returned an error (HTTP ${status}).`;
  }

  // ─── Non-streaming agent endpoints (sessions / session / status) ──────

  async function agentPost(path, payload) {
    try {
      const auth = await resolveBearer();
      if (auth.error) return { error: auth.error };
      const res = await fetch(`${AGENT_BASE}/${path}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${auth.bearer}`,
          'X-Account-Token': auth.accountToken,
        },
        body: JSON.stringify(payload || {}),
      });
      if (!res.ok) {
        const detail = await res.json().catch(() => ({}));
        // status + code let callers branch on specific errors (e.g. the confirm
        // flow treats 409 DRAFT_ALREADY_EXECUTED as success); existing callers
        // read only `.error`, so this stays backward-compatible.
        return { error: friendlyHttpError(res.status, detail), status: res.status, code: detail?.code };
      }
      return { data: await res.json() };
    } catch (err) {
      return { error: `Could not reach the assistant: ${err.message}` };
    }
  }

  // ─── Chat history ─────────────────────────────────────────────────────

  function historyEl() {
    return panelEl?.querySelector('[data-jt-role="history"]');
  }

  function closeHistory() {
    panelEl?.classList.remove('jt-assistant-showing-history');
  }

  async function openHistory() {
    if (!panelEl) return;
    panelEl.classList.add('jt-assistant-showing-history');
    const view = historyEl();
    if (!view) return;
    view.replaceChildren();

    const bar = el('div', 'jt-assistant-history-bar');
    const back = el('button', 'jtt-btn jt-assistant-history-back', '← Back');
    back.type = 'button';
    back.addEventListener('click', closeHistory);
    bar.appendChild(back);
    bar.appendChild(el('span', 'jt-assistant-history-heading', 'Chat history'));
    view.appendChild(bar);

    const list = el('div', 'jt-assistant-history-list');
    list.appendChild(el('div', 'jt-assistant-history-loading', 'Loading…'));
    view.appendChild(list);

    const result = await agentPost('sessions', { limit: 20 });
    // Bail if the user navigated away from the history view while loading.
    if (!panelEl || !panelEl.classList.contains('jt-assistant-showing-history')) return;
    list.replaceChildren();

    if (result.error) {
      closeHistory();
      appendSystemNote(result.error);
      return;
    }

    const sessions = (result.data && result.data.sessions) || [];
    if (!sessions.length) {
      list.appendChild(el('div', 'jt-assistant-history-empty', 'No past chats yet.'));
      return;
    }
    for (const session of sessions) {
      const row = el('button', 'jt-assistant-history-row');
      row.type = 'button';
      row.appendChild(el('div', 'jt-assistant-history-row-title', session.title || 'Untitled'));
      const parts = [];
      const when = relativeTime(session.updatedAt);
      if (when) parts.push(when);
      parts.push(`${session.messageCount || 0} messages`);
      row.appendChild(el('div', 'jt-assistant-history-row-meta', parts.join(' · ')));
      row.addEventListener('click', () => void loadSession(session.id));
      list.appendChild(row);
    }
  }

  async function loadSession(id) {
    const result = await agentPost('session', { id });
    if (result.error) {
      closeHistory();
      appendSystemNote(result.error);
      return;
    }
    const data = result.data || {};
    if (abortController) abortController.abort();
    const messages = messagesEl();
    if (messages) messages.replaceChildren();
    // Continue this conversation on the next send.
    sessionId = (data.session && data.session.id) || id;
    for (const turn of data.messages || []) {
      if (turn.role === 'user') appendBubble('user', turn.text || '');
      else appendAssistantTurn(turn);
    }
    setStatus('');
    closeHistory();
  }

  // ─── Profile / skills nudge ───────────────────────────────────────────

  async function checkProfileStatus() {
    // Status failures are silent — no nudge, no error surfaced.
    const result = await agentPost('status', {});
    if (!result || result.error || !result.data) return;
    const { profileExists, skillsCount } = result.data;
    if (profileExists === false) {
      renderProfileNudge();
    } else if (profileExists === true && skillsCount === 0) {
      renderSkillsHint();
    }
  }

  function renderProfileNudge() {
    const messages = messagesEl();
    if (!messages || messages.querySelector('[data-jt-role="profile-nudge"]')) return;
    const card = el('div', 'jt-assistant-nudge');
    card.dataset.jtRole = 'profile-nudge';

    const dismiss = el('button', 'jt-assistant-nudge-dismiss', '×');
    dismiss.type = 'button';
    dismiss.setAttribute('aria-label', 'Dismiss');
    dismiss.addEventListener('click', () => card.remove());
    card.appendChild(dismiss);

    card.appendChild(el('div', 'jt-assistant-nudge-title', 'Teach the assistant how your company works'));
    card.appendChild(
      el(
        'div',
        'jt-assistant-nudge-copy',
        'Answers get sharper when the assistant knows your trades, pricing, and stage names.'
      )
    );
    const btn = el('button', 'jtt-btn jtt-btn-primary jt-assistant-nudge-btn', 'Set up your Assistant profile');
    btn.type = 'button';
    btn.addEventListener('click', () => window.open(PORTAL_PROFILE_URL, '_blank', 'noopener'));
    card.appendChild(btn);

    messages.prepend(card);
  }

  function renderSkillsHint() {
    const messages = messagesEl();
    if (!messages || messages.querySelector('[data-jt-role="skills-hint"]')) return;
    const hint = el('div', 'jt-assistant-skills-hint', 'Add skills to teach procedures — Portal → Skills');
    hint.dataset.jtRole = 'skills-hint';
    messages.prepend(hint);
  }

  // ─── Lifecycle ────────────────────────────────────────────────────

  function init() {
    if (isActive) return;
    isActive = true;
    console.log('AssistantPanel: Initializing...');

    injectStyles();
    restorePanelWidth();
    buildLauncher();
    buildGlow();

    // Esc closes the panel — document-level, so it must be tracked for
    // removal in cleanup().
    addListener(document, 'keydown', (e) => {
      if (e.key === 'Escape' && panelEl?.classList.contains('jt-assistant-open')) {
        togglePanel();
      }
    });

    // Re-clamp the docked width if the viewport shrinks with the panel open.
    addListener(window, 'resize', onWindowResize);

    console.log('AssistantPanel: Initialized');
  }

  function cleanup() {
    if (!isActive) return;
    console.log('AssistantPanel: Cleaning up...');

    if (abortController) {
      abortController.abort();
      abortController = null;
    }
    eventListeners.forEach(({ element, event, handler }) => {
      element.removeEventListener(event, handler);
    });
    eventListeners.length = 0;

    // Cancel any pending two-step-confirm reset timers (draft cards).
    draftConfirmTimers.forEach((timer) => clearTimeout(timer));
    draftConfirmTimers.clear();

    // Undock: hand the page's width back exactly, and unwind any in-flight
    // resize drag (userSelect was pinned in onPanelResizePointerDown).
    if (panelResizeDrag) document.body.style.userSelect = '';
    panelResizeDrag = null;
    restoreSqueezeImmediate();

    if (panelEl) {
      panelEl.remove();
      panelEl = null;
    }
    // Banner lives inside the panel (removed above); drop the reference so a
    // fresh init() rebuilds it on the next pool frame.
    poolBannerEl = null;
    if (launcherEl) {
      launcherEl.remove();
      launcherEl = null;
    }
    if (glowEl) {
      glowEl.remove();
      glowEl = null;
    }
    removeStyles();

    sessionId = null;
    renderedDraftKeys.clear();
    sending = false;
    statusChecked = false;
    launcherDrag = null;
    justDragged = false;
    panelWidth = DEFAULT_PANEL_WIDTH;
    isActive = false;
    console.log('AssistantPanel: Cleaned up');
  }

  return { init, cleanup, isActive: () => isActive };
})();

window.AssistantPanelFeature = AssistantPanelFeature;
