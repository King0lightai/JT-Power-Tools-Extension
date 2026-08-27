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
  const PORTAL_SKILLS_URL = 'https://app.jtpowertools.com/dashboard#skills';
  const PANEL_WIDTH_KEY = 'jtAssistantPanelWidth';
  const PENDING_RUN_KEY = 'jtAssistantPendingRun';
  // Savings ↔ Quality dial — remembered per-user default, sent as `mode` on each
  // /agent/chat. Server normalizes anything unknown to 'balanced'.
  const EFFORT_MODE_KEY = 'jtAssistantEffortMode';
  // Auto-apply dial — opt-in, remembered per-user. When on, proposed writes are
  // confirmed automatically as they arrive (no manual Apply click). Off by
  // default: auto-writes stay a deliberate choice (spec §Non-Goals).
  const AUTO_APPLY_KEY = 'jtAssistantAutoApply';
  const EFFORT_MODES = [
    { id: 'savings', label: 'Savings', title: 'Cheapest model the safety rules allow + low effort. Money questions still use the smart model.' },
    { id: 'balanced', label: 'Balanced', title: 'The tuned default — smart routing, low effort only on follow-up turns.' },
    { id: 'quality', label: 'Quality', title: 'Always the smart model at full effort. Best answers, top cost.' },
  ];
  const DEFAULT_EFFORT_MODE = 'balanced';
  // Only reopen an interrupted run if it started within this window — an older
  // stash is almost certainly a run that already finished (or was abandoned).
  const PENDING_RUN_MAX_AGE_MS = 10 * 60 * 1000;
  const DEFAULT_PANEL_WIDTH = 380;
  const MIN_PANEL_WIDTH = 300;
  // Mobile layout breakpoint. Matches every other responsive feature in the
  // extension (quick-notes, forms, preview-mode, jt-tools-toast). Width-only,
  // no pointer-type gate, so DevTools responsive mode reproduces it exactly.
  const MOBILE_MAX_WIDTH = 768;
  const MOBILE_QUERY = `(max-width: ${MOBILE_MAX_WIDTH}px)`;
  // How long to keep watching for JobTread's help bubble to render before
  // giving up. The top bar is usually present on the first look; this only
  // covers a slow SPA mount. There is no fallback launcher — if the bubble
  // never appears, the assistant is simply unreachable that session.
  const BUBBLE_WATCH_MS = 8000;
  // JobTread's help bubble (top-right question mark) — the control we
  // intercept to offer a JobTread-AI vs JT-Power-Tools fork. The live bubble
  // is an icon-only `div[role="button"]` with NO aria-label/title/text, so the
  // attribute selectors below are defensive (in case JobTread labels it later)
  // and real matching leans on the SVG signature in looksLikeHelpBubble().
  // Every candidate is still gated by isTopRightIcon() so a stray element
  // elsewhere is never bound. This is the one place to update if JobTread
  // reshuffles that toolbar.
  const HELP_BUBBLE_SELECTORS = [
    '[data-testid="help-button"]',
    'button[aria-label="Help" i]',
    'button[title="Help" i]',
    'a[aria-label="Help" i]',
  ];
  // The bubble's distinguishing marks, matched inside a candidate:
  //  • the question-mark "help" glyph — its dot path (`M12 17h.01`) is unique
  //  • JobTread's purple "AI" sparkle overlay (`.fill-purple-500`)
  const HELP_GLYPH_SELECTOR = 'svg path[d*="M12 17h"]';
  const AI_SPARKLE_SELECTOR = '.fill-purple-500';

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

  // Org credit-pool status copy, derived from the server `pool` frame.
  function poolCopy(frame) {
    if (frame.trial && frame.state !== 'exhausted' && !frame.blocked) {
      const endStr = frame.trialEndsAt ? new Date(frame.trialEndsAt * 1000).toLocaleDateString() : null;
      const remaining = Number(frame.remaining ?? 0);
      const total = Number(frame.total ?? 0);
      return `Trial: the assistant runs on a reduced ${total.toLocaleString()}-credit allowance${
        endStr ? ` until ${endStr}` : ''
      } (${remaining.toLocaleString()} left). Your full allowance starts when your subscription begins.`;
    }
    const remaining = Number(frame.remaining ?? 0);
    const total = Number(frame.total ?? 0);
    const resetStr = frame.cycleResetAt
      ? new Date(frame.cycleResetAt * 1000).toLocaleDateString()
      : null;
    if (frame.blocked || frame.state === 'exhausted') {
      return `Your company is out of Assistant credits this cycle (${remaining.toLocaleString()} of ${total.toLocaleString()} remaining)${
        resetStr ? ` — resets ${resetStr}` : ''
      }. Top up or wait for the reset to continue.`;
    }
    if (frame.state === 'low') {
      return `Your company has ${remaining.toLocaleString()} of ${total.toLocaleString()} Assistant credits left this cycle. Top up to avoid interruption.`;
    }
    return null;
  }

  let isActive = false;
  let panelEl = null;
  let poolBannerEl = null;
  let composerBlocked = false;
  let glowEl = null;
  let sessionId = null;
  let effortMode = DEFAULT_EFFORT_MODE; // Savings↔Quality dial; restored from storage on init
  // Draft cards already rendered this session (draft id / idempotency key) —
  // each draft arrives on two frames and must render once.
  const renderedDraftKeys = new Set();
  // Persisted, not-yet-applied draft cards this session, keyed by draft id.
  // Drives the "Apply all" bar and auto-apply. Each value exposes applyNow()
  // (fires that card's confirm) — a card removes itself here once applied.
  const pendingDrafts = new Map();
  let autoApply = false; // opt-in; drafts confirm without a click when true
  let bulkBarEl = null; // the "Apply all" bar (built lazily above the composer)
  let bulkArmed = false; // two-step confirm state for the bulk bar
  let bulkArmTimer = null; // resets the bulk arm after the window
  let bulkApplying = false; // guards against re-entry while a bulk pass runs
  let abortController = null;
  let sending = false;
  let statusChecked = false; // profile/skills nudge fires once per page load
  let pendingRecovery = null; // interrupted run to reopen on the next panel open (set at init from storage)
  // Docked-sidebar push state. When the panel opens it pushes JobTread's app
  // root left via an inline margin-right; we stash the root's PRIOR inline
  // margin/transition so close + cleanup restore them exactly (never assume '').
  let panelWidth = DEFAULT_PANEL_WIDTH;
  let squeezeTarget = null; // the pushed element while the panel is open
  let priorMarginRight = null; // squeezeTarget's inline margin-right before we touched it
  let priorTransition = null; // …and its inline transition
  let restoreTimer = null; // defers transition-restore until the close animation ends
  let panelResizeDrag = null; // { startX, startWidth } while the edge handle is dragged
  let vvBound = false; // visualViewport listeners currently attached
  let vvFrame = 0; // pending rAF id for the visual-viewport handler
  let vvTarget = null; // the visualViewport we bound to — unbind from THIS, not a re-read
  let vvLastHeight = 0; // last seen visible height, to tell a shrink from a pan
  let vvPendingScroll = false; // a shrink is waiting to ride the next coalesced frame
  let mobileQuery = null; // MediaQueryList while init'd (null when matchMedia is absent)
  let mobileQueryHandler = null; // its 'change' handler, tracked for removal
  const eventListeners = []; // document/window-level — must be removed in cleanup()
  const draftConfirmTimers = new Set(); // pending two-step "are you sure?" reset timers
  // Help-bubble activation fork. The assistant is reached exclusively through
  // JobTread's top-right help bubble: we intercept it and offer a two-option
  // chooser. If the bubble never renders we keep watching for the watch window
  // and then give up — there is no floating fallback launcher.
  let usingBubble = false; // true once the interceptor is bound
  let helpBubbleEl = null; // the intercepted bubble
  let helpBubbleHandler = null; // its capture-phase click handler (tracked for removal)
  let bubbleObserver = null; // watches for a late-rendering bubble
  let bubbleObserverTimer = null; // bounds how long bubbleObserver runs
  let passThroughNextBubbleClick = false; // let the next bubble click reach JobTread's own handler
  let chooserEl = null; // the open activation popover (null = closed)
  let chooserDismissHandlers = null; // { onDocClick, onKeydown } while the chooser is open

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

  // Grow the composer textarea to fit its content (clamped by the CSS
  // max-height, past which it scrolls). Setting height to 'auto' first lets
  // the field shrink again when text is deleted.
  function autoGrowInput(input) {
    if (!input) return;
    input.style.height = 'auto';
    input.style.height = `${input.scrollHeight}px`;
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
    // Which org this session is about. A license:grant bearer carries no org —
    // a grant key reaches every org its JobTread user belongs to — so without
    // this the server binds the session to the license's home org, and a panel
    // opened on a second org's page read and WROTE the wrong company (its
    // drafts, sessions and usage all filed under the home org too). Null when
    // no org is detected or no key is configured for it; the caller then omits
    // the header rather than guessing.
    const { orgId } = (await window.GrantKeyResolver.getOrgContext?.()) || {};
    return { bearer: `${licenseData.key}:${grantKey}`, accountToken, orgId: orgId || null };
  }

  /**
   * Headers every agent call shares. `X-JT-Org` is omitted rather than sent
   * empty when the org is unknown, so the server applies its own precedence
   * instead of being handed a blank selector to reject.
   */
  function agentHeaders(auth, extra = {}) {
    const headers = {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${auth.bearer}`,
      'X-Account-Token': auth.accountToken,
      ...extra,
    };
    if (auth.orgId) headers['X-JT-Org'] = auth.orgId;
    return headers;
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
  // while the agent is actually reading the org's live data.

  function buildGlow() {
    glowEl = el('div', 'jt-assistant-glow');
    glowEl.setAttribute('aria-hidden', 'true');
    document.body.appendChild(glowEl);
  }

  function setWorking(on) {
    if (glowEl) glowEl.classList.toggle('jt-assistant-glow-active', on);
  }

  // ─── Panel UI ─────────────────────────────────────────────────────

  // ─── Help-bubble activation fork ──────────────────────────────────────
  // JobTread's top-right question-mark bubble opens its built-in AI help
  // chat. We intercept the click and show a two-option chooser: keep going to
  // JobTread AI, or open the JT Power Tools Assistant. This is the only entry
  // point — there is no floating launcher.

  function isOurElement(node) {
    return Boolean(
      node.closest &&
        node.closest('.jt-assistant-chooser, .jt-assistant-panel')
    );
  }

  // Gate every candidate on being a small control in the top-right corner.
  // This is also what keeps jsdom (zero-size rects) and stray page buttons
  // from ever being bound.
  function isTopRightIcon(node) {
    const r = node.getBoundingClientRect();
    if (!r || r.width === 0 || r.height === 0) return false;
    if (r.width > 80 || r.height > 80) return false; // an icon button, not a wide control
    if (r.top > 140) return false; // within the top bar
    const vw = window.innerWidth || 0;
    if (r.right < vw - 260) return false; // in the right-hand cluster
    return true;
  }

  // A candidate is the help bubble if it carries the question-mark help glyph
  // or JobTread's purple AI sparkle. querySelector tolerates a missing node.
  function looksLikeHelpBubble(node) {
    if (!node.querySelector) return false;
    return Boolean(
      node.querySelector(HELP_GLYPH_SELECTOR) || node.querySelector(AI_SPARKLE_SELECTOR)
    );
  }

  function findHelpBubble() {
    for (const sel of HELP_BUBBLE_SELECTORS) {
      const node = document.querySelector(sel);
      if (node && !isOurElement(node) && isTopRightIcon(node)) return node;
    }
    // Heuristic sweep: a top-right control carrying the help/AI affordance —
    // the SVG signature, a "help" label, or a literal "?".
    for (const node of document.querySelectorAll('button, a[role="button"], [role="button"]')) {
      if (isOurElement(node) || !isTopRightIcon(node)) continue;
      if (looksLikeHelpBubble(node)) return node;
      const meta = `${node.getAttribute('aria-label') || ''} ${node.getAttribute('title') || ''}`.toLowerCase();
      if (meta.includes('help')) return node;
      if ((node.textContent || '').trim() === '?') return node;
    }
    return null;
  }

  // Bind the bubble if it's already there; otherwise keep watching so a
  // late-rendering bubble is still picked up within the watch window.
  function setupEntryPoint() {
    if (tryBindHelpBubble()) return;
    startBubbleWatch();
  }

  function tryBindHelpBubble() {
    if (usingBubble) return true;
    const bubble = findHelpBubble();
    if (!bubble) return false;
    helpBubbleEl = bubble;
    helpBubbleHandler = onBubbleClick;
    // Capture phase so we run before JobTread's own React handler.
    bubble.addEventListener('click', helpBubbleHandler, true);
    usingBubble = true;
    stopBubbleWatch();
    return true;
  }

  function startBubbleWatch() {
    if (bubbleObserver) return;
    bubbleObserver = new MutationObserver(() => tryBindHelpBubble());
    bubbleObserver.observe(document.body, { childList: true, subtree: true });
    // Give up after the watch window. With no fallback launcher, log so a
    // support session can tell the assistant never attached.
    bubbleObserverTimer = setTimeout(() => {
      stopBubbleWatch();
      if (!usingBubble) {
        console.warn('AssistantPanel: JobTread help bubble not found — assistant unreachable this session');
      }
    }, BUBBLE_WATCH_MS);
  }

  function stopBubbleWatch() {
    if (bubbleObserver) {
      bubbleObserver.disconnect();
      bubbleObserver = null;
    }
    if (bubbleObserverTimer) {
      clearTimeout(bubbleObserverTimer);
      bubbleObserverTimer = null;
    }
  }

  // JobTread is a SPA: switching orgs remounts the top bar (including the help
  // bubble) without a page reload, so our bound bubble node goes stale and the
  // assistant stops opening until a manual refresh. Re-attach the entry point to
  // the fresh bubble, and start a clean session so a conversation from the
  // previous org doesn't carry across the switch. Fired by OrgDetector's
  // `jt-org-changed` window event (registered in init(), removed in cleanup()).
  function handleOrgChange() {
    if (!isActive) return;
    if (helpBubbleEl && helpBubbleHandler) {
      helpBubbleEl.removeEventListener('click', helpBubbleHandler, true);
    }
    helpBubbleEl = null;
    helpBubbleHandler = null;
    usingBubble = false;
    passThroughNextBubbleClick = false;
    stopBubbleWatch();
    closeChooser(); // any open chooser popover belonged to the old bubble
    setupEntryPoint(); // re-bind to the current (possibly new) bubble
    // Only the built panel holds a session worth resetting.
    if (panelEl) resetSession();
  }

  function onBubbleClick(e) {
    if (passThroughNextBubbleClick) {
      passThroughNextBubbleClick = false;
      return; // our re-fire — let JobTread's native handler run (JobTread AI)
    }
    e.preventDefault();
    e.stopImmediatePropagation();
    toggleChooser();
  }

  function toggleChooser() {
    if (chooserEl) {
      closeChooser();
      return;
    }
    openChooser();
  }

  function buildChooserItem(title, sub, onClick) {
    const item = el('button', 'jt-assistant-chooser-item');
    item.type = 'button';
    item.setAttribute('role', 'menuitem');
    item.appendChild(el('span', 'jt-assistant-chooser-item-title', title));
    item.appendChild(el('span', 'jt-assistant-chooser-item-sub', sub));
    item.addEventListener('click', onClick);
    return item;
  }

  function openChooser() {
    if (!helpBubbleEl) return;
    chooserEl = el('div', 'jt-tools-surface jt-assistant-chooser');
    chooserEl.setAttribute('role', 'menu');
    chooserEl.setAttribute('aria-label', 'Choose an assistant');
    chooserEl.appendChild(
      buildChooserItem('JobTread AI', "JobTread's built-in help chat", chooseJobTread)
    );
    chooserEl.appendChild(
      buildChooserItem(
        'JT Power Tools Assistant',
        'Answers from your live JobTread data',
        choosePowerTools
      )
    );
    document.body.appendChild(chooserEl);
    positionChooser();

    // Dismiss on an outside click or Escape. The opening click was already
    // stopped at the bubble and these listeners are added afterward, so they
    // only ever see later events.
    const onDocClick = (ev) => {
      if (
        chooserEl &&
        !chooserEl.contains(ev.target) &&
        ev.target !== helpBubbleEl &&
        !(helpBubbleEl && helpBubbleEl.contains(ev.target))
      ) {
        closeChooser();
      }
    };
    const onKeydown = (ev) => {
      if (ev.key === 'Escape') closeChooser();
    };
    chooserDismissHandlers = { onDocClick, onKeydown };
    document.addEventListener('click', onDocClick, true);
    document.addEventListener('keydown', onKeydown, true);
  }

  // Anchor the popover under the bubble, aligned to its right edge.
  function positionChooser() {
    if (!chooserEl || !helpBubbleEl) return;
    const r = helpBubbleEl.getBoundingClientRect();
    const vw = window.innerWidth || 0;
    chooserEl.style.top = `${Math.round(r.bottom + 8)}px`;
    chooserEl.style.right = `${Math.max(8, Math.round(vw - r.right))}px`;
  }

  function chooseJobTread() {
    closeChooser();
    if (!helpBubbleEl) return;
    passThroughNextBubbleClick = true;
    helpBubbleEl.click(); // re-fire the native handler → JobTread's own AI chat
  }

  function choosePowerTools() {
    closeChooser();
    if (!panelEl || !panelEl.classList.contains('jt-assistant-open')) {
      togglePanel();
    }
  }

  function closeChooser() {
    if (chooserDismissHandlers) {
      document.removeEventListener('click', chooserDismissHandlers.onDocClick, true);
      document.removeEventListener('keydown', chooserDismissHandlers.onKeydown, true);
      chooserDismissHandlers = null;
    }
    if (chooserEl) {
      chooserEl.remove();
      chooserEl = null;
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

  // Narrow-viewport layout: the panel becomes a full-viewport overlay and
  // stops pushing JobTread. matchMedia is feature-detected on purpose — jsdom
  // (and therefore the whole unit suite) has no matchMedia, and an unguarded
  // call throws at init(). The innerWidth fallback keeps jsdom's 1024 in
  // desktop mode, so existing tests are unaffected.
  function isMobileLayout() {
    if (typeof window.matchMedia === 'function') {
      return window.matchMedia(MOBILE_QUERY).matches;
    }
    return (window.innerWidth || 0) <= MOBILE_MAX_WIDTH;
  }

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
    // Mobile is a full-viewport overlay — the media query owns the size, and
    // an inline width would beat it.
    if (isMobileLayout()) {
      if (panelEl) panelEl.style.width = '';
      return;
    }
    if (panelEl) panelEl.style.width = `${width}px`;
    if (squeezeTarget) squeezeTarget.style.marginRight = `${width}px`;
  }

  function applySqueeze() {
    // Mobile overlays the page instead of pushing it — leave #root untouched
    // so closing the panel is a true no-op. squeezeTarget stays null, which
    // releaseSqueeze()/restoreSqueezeImmediate() already handle.
    if (isMobileLayout()) {
      if (panelEl) panelEl.style.width = '';
      return;
    }
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

  // ─── Mobile keyboard fit ───────────────────────────────────────────
  // position:fixed measures against the LAYOUT viewport, which does NOT
  // shrink when the on-screen keyboard opens — so the composer ends up
  // underneath it. visualViewport is the only API reporting the actually
  // visible box. The panel is already a flex column with a flex:1 scrolling
  // message list, so constraining its height is the entire fix: the composer
  // stays pinned and the list gives up the space.

  function applyViewportFit() {
    vvFrame = 0;
    const vv = vvTarget;
    if (!vv || !panelEl) return;
    panelEl.style.height = `${vv.height}px`;
    panelEl.style.transform = `translateY(${vv.offsetTop}px)`;
    if (vvPendingScroll) {
      vvPendingScroll = false;
      scrollToBottom(); // keep the newest message above the keyboard
    }
  }

  // rAF-coalesced: visualViewport 'scroll' fires on every pixel of an iOS
  // rubber-band, and the mobile gate weights unthrottled hot handlers x3.
  // Only a SHRINK means the keyboard opened; a pan keeps the height and just
  // moves offsetTop, and scrolling there would yank the user off a message
  // they had deliberately scrolled up to read.
  function onVisualViewportChange() {
    if (!vvTarget) return;
    if (vvTarget.height < vvLastHeight) vvPendingScroll = true;
    vvLastHeight = vvTarget.height;
    if (vvFrame) return;
    vvFrame = requestAnimationFrame(applyViewportFit);
  }

  // Bound on open (mobile only) and unbound on close — NOT via addListener(),
  // which is for the feature's whole lifetime.
  function bindViewportFit() {
    const vv = window.visualViewport;
    if (vvBound || !vv) return; // no visualViewport → the CSS 100dvh fallback
    vvTarget = vv;
    vvLastHeight = vv.height;
    vv.addEventListener('resize', onVisualViewportChange); /* mobile-ok: onVisualViewportChange coalesces every event into one rAF */
    vv.addEventListener('scroll', onVisualViewportChange); /* mobile-ok: onVisualViewportChange coalesces every event into one rAF */
    vvBound = true;
    applyViewportFit();
  }

  function unbindViewportFit() {
    if (vvTarget && vvBound) {
      vvTarget.removeEventListener('resize', onVisualViewportChange);
      vvTarget.removeEventListener('scroll', onVisualViewportChange);
    }
    vvTarget = null;
    vvBound = false;
    vvLastHeight = 0; // a later open re-baselines from its own bind
    vvPendingScroll = false;
    if (vvFrame) {
      cancelAnimationFrame(vvFrame);
      vvFrame = 0;
    }
    if (panelEl) {
      panelEl.style.height = '';
      panelEl.style.transform = '';
    }
  }

  // Crossing the breakpoint with the panel open (rotation, or dragging a
  // desktop window) has to hand off cleanly in BOTH directions — otherwise a
  // half-applied squeeze is stranded on #root with no panel beside it.
  // panelWidth is never written from mobile mode, so the user's chosen desktop
  // width survives a round trip through a narrow viewport.
  function onMobileLayoutChange() {
    if (!panelEl || !panelEl.classList.contains('jt-assistant-open')) return;
    if (isMobileLayout()) {
      releaseSqueeze(); // hand #root's width back
      panelEl.style.width = ''; // let the media query own the size
      bindViewportFit();
    } else {
      unbindViewportFit(); // also clears the inline height/transform
      applySqueeze(); // re-dock at the persisted width
    }
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

  // ─── Savings ↔ Quality dial ───────────────────────────────────────────

  function persistEffortMode(mode) {
    try {
      chrome.storage.local.set({ [EFFORT_MODE_KEY]: mode });
    } catch {
      // Non-fatal — the dial just won't be remembered next time.
    }
  }

  function restoreEffortMode() {
    try {
      chrome.storage.local.get(EFFORT_MODE_KEY, (res) => {
        const mode = res && res[EFFORT_MODE_KEY];
        if (EFFORT_MODES.some((m) => m.id === mode)) {
          effortMode = mode;
          renderEffortMode();
        }
      });
    } catch {
      // Non-fatal — fall back to the default mode.
    }
  }

  // Reflect the current effortMode onto the segmented control (if built).
  function renderEffortMode() {
    const bar = panelEl?.querySelector('[data-jt-role="mode-bar"]');
    if (!bar) return;
    for (const seg of bar.querySelectorAll('.jt-assistant-mode-seg')) {
      const on = seg.dataset.mode === effortMode;
      seg.classList.toggle('jt-assistant-mode-seg-active', on);
      seg.setAttribute('aria-pressed', on ? 'true' : 'false');
    }
  }

  // Change the dial (applies to the NEXT turn, not an in-flight run).
  function setEffortMode(mode) {
    if (!EFFORT_MODES.some((m) => m.id === mode)) return;
    effortMode = mode;
    persistEffortMode(mode);
    renderEffortMode();
  }

  // ─── Auto-apply dial ──────────────────────────────────────────────────
  // A single opt-in switch above the composer. Off by default; when the user
  // turns it on, new drafts confirm automatically AND any already-pending
  // drafts are applied now, so "stop clicking Apply" means exactly that.

  function persistAutoApply(on) {
    try {
      chrome.storage.local.set({ [AUTO_APPLY_KEY]: on });
    } catch {
      // Non-fatal — the switch just won't be remembered next time.
    }
  }

  function restoreAutoApply() {
    try {
      chrome.storage.local.get(AUTO_APPLY_KEY, (res) => {
        if (res && res[AUTO_APPLY_KEY] === true) {
          autoApply = true;
          renderAutoApply();
        }
      });
    } catch {
      // Non-fatal — fall back to off.
    }
  }

  // Reflect autoApply onto the switch (if built).
  function renderAutoApply() {
    const toggle = panelEl?.querySelector('[data-jt-role="auto-apply"]');
    if (!toggle) return;
    toggle.classList.toggle('jt-assistant-autoapply-on', autoApply);
    toggle.setAttribute('aria-checked', autoApply ? 'true' : 'false');
    const state = toggle.querySelector('.jt-assistant-autoapply-state');
    if (state) state.textContent = autoApply ? 'On' : 'Off';
  }

  function setAutoApply(on) {
    autoApply = on;
    persistAutoApply(on);
    renderAutoApply();
    // Turning it on applies whatever's already waiting; the bulk bar is moot
    // while auto-apply is live, so updateBulkBar() hides it either way.
    updateBulkBar();
    if (on) void applyAllPending();
  }

  function buildAutoApplyToggle() {
    const row = el('div', 'jt-assistant-autoapply');
    const toggle = el('button', 'jt-assistant-autoapply-toggle');
    toggle.type = 'button';
    toggle.dataset.jtRole = 'auto-apply';
    toggle.setAttribute('role', 'switch');
    toggle.setAttribute('aria-checked', 'false');
    toggle.title =
      'When on, proposed changes are applied automatically as they arrive — no confirm click.';
    toggle.appendChild(el('span', 'jt-assistant-autoapply-label', 'Auto-apply changes'));
    toggle.appendChild(el('span', 'jt-assistant-autoapply-state', 'Off'));
    toggle.addEventListener('click', () => setAutoApply(!autoApply));
    row.appendChild(toggle);
    return row;
  }

  // ─── Bulk apply ("Apply all") ─────────────────────────────────────────
  // A slim bar above the composer, shown only when 2+ persisted drafts are
  // waiting (and auto-apply is off). One two-step confirm applies them all,
  // reusing each card's own confirm path so every write still runs through
  // /agent/confirm with its idempotency key.

  function removeBulkBar() {
    if (bulkArmTimer) {
      clearTimeout(bulkArmTimer);
      draftConfirmTimers.delete(bulkArmTimer);
      bulkArmTimer = null;
    }
    bulkArmed = false;
    if (bulkBarEl) {
      bulkBarEl.remove();
      bulkBarEl = null;
    }
  }

  function disarmBulk() {
    if (bulkArmTimer) {
      clearTimeout(bulkArmTimer);
      draftConfirmTimers.delete(bulkArmTimer);
      bulkArmTimer = null;
    }
    bulkArmed = false;
    const btn = bulkBarEl?.querySelector('[data-jt-role="bulk-apply"]');
    if (btn) btn.classList.remove('jt-assistant-draft-apply-armed');
    updateBulkBar();
  }

  function onBulkApplyClick() {
    if (bulkApplying) return;
    if (bulkArmed) {
      disarmBulk();
      void applyAllPending();
      return;
    }
    bulkArmed = true;
    const btn = bulkBarEl?.querySelector('[data-jt-role="bulk-apply"]');
    if (btn) btn.classList.add('jt-assistant-draft-apply-armed');
    bulkArmTimer = setTimeout(disarmBulk, 4000);
    draftConfirmTimers.add(bulkArmTimer);
    updateBulkBar();
  }

  async function applyAllPending() {
    if (bulkApplying) return;
    bulkApplying = true;
    const btn = bulkBarEl?.querySelector('[data-jt-role="bulk-apply"]');
    if (btn) {
      btn.disabled = true;
      btn.textContent = 'Applying…';
    }
    // Snapshot first — each applyNow() removes its draft from pendingDrafts on
    // success, so iterating the live map would skip entries.
    for (const draft of [...pendingDrafts.values()]) {
      await draft.applyNow();
    }
    bulkApplying = false;
    const liveBtn = bulkBarEl?.querySelector('[data-jt-role="bulk-apply"]');
    if (liveBtn) liveBtn.disabled = false;
    updateBulkBar();
  }

  // Show/refresh the bar when 2+ drafts wait and auto-apply is off; otherwise
  // remove it. Called whenever the pending set changes.
  function updateBulkBar() {
    if (!panelEl) return;
    const count = pendingDrafts.size;
    if (count < 2 || autoApply) {
      removeBulkBar();
      return;
    }
    if (!bulkBarEl) {
      bulkBarEl = el('div', 'jt-assistant-bulk-bar');
      bulkBarEl.dataset.jtRole = 'bulk-bar';
      const label = el('span', 'jt-assistant-bulk-label');
      label.dataset.jtRole = 'bulk-label';
      const btn = el('button', 'jtt-btn jt-assistant-bulk-apply', 'Apply all');
      btn.type = 'button';
      btn.dataset.jtRole = 'bulk-apply';
      btn.addEventListener('click', onBulkApplyClick);
      bulkBarEl.appendChild(label);
      bulkBarEl.appendChild(btn);
      const composer = panelEl.querySelector('.jt-assistant-composer');
      panelEl.insertBefore(bulkBarEl, composer);
    }
    const label = bulkBarEl.querySelector('[data-jt-role="bulk-label"]');
    if (label) label.textContent = `${count} proposed changes`;
    const btn = bulkBarEl.querySelector('[data-jt-role="bulk-apply"]');
    if (btn && !bulkApplying) {
      btn.textContent = bulkArmed ? `Apply all ${count} — are you sure?` : `Apply all (${count})`;
    }
  }

  function buildModeBar() {
    const bar = el('div', 'jt-assistant-mode-bar');
    bar.dataset.jtRole = 'mode-bar';
    bar.setAttribute('role', 'group');
    bar.setAttribute('aria-label', 'Response mode');
    for (const m of EFFORT_MODES) {
      const seg = el('button', 'jt-assistant-mode-seg', m.label);
      seg.type = 'button';
      seg.dataset.mode = m.id;
      seg.title = m.title;
      seg.setAttribute('aria-pressed', 'false');
      seg.addEventListener('click', () => setEffortMode(m.id));
      bar.appendChild(seg);
    }
    return bar;
  }

  // ─── In-flight run recovery (survives a mid-run reload) ───────────────
  // A page reload kills this JS context before the answer lands, but the run
  // keeps going server-side and persists to its session. We stash the active
  // run so the next load can reopen that session and let it finish.

  function setPendingRun(record) {
    try {
      chrome.storage.local.set({ [PENDING_RUN_KEY]: record });
    } catch {
      // Non-fatal — recovery just won't be available after a reload.
    }
  }

  function clearPendingRun() {
    try {
      chrome.storage.local.remove(PENDING_RUN_KEY);
    } catch {
      // Non-fatal.
    }
  }

  // Read the stash at init. Keep it for the next panel open only when it's
  // recent AND has a session id to reopen; otherwise drop it now.
  function loadPendingRecovery() {
    try {
      chrome.storage.local.get(PENDING_RUN_KEY, (res) => {
        const record = res && res[PENDING_RUN_KEY];
        if (!record) return;
        const recent =
          typeof record.startedAt === 'number' &&
          Date.now() - record.startedAt < PENDING_RUN_MAX_AGE_MS;
        if (recent && record.sessionId) {
          pendingRecovery = record;
        } else {
          clearPendingRun();
        }
      });
    } catch {
      // Non-fatal — no recovery this load.
    }
  }

  // Reopen the interrupted run's session and explain what happened. Consumed
  // once, on the first panel open after a reload.
  async function recoverPendingRun(record) {
    clearPendingRun();
    await loadSession(record.sessionId);
    appendSystemNote(
      "You reloaded during a run — this is the conversation so far. If the answer hasn't landed " +
        "yet, it's still finishing; reopen it from History in a moment."
    );
  }

  // Edge handle — document-level move/up listeners, tracked for removal.
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
    if (isMobileLayout()) return; // full-viewport overlay — no docked width to re-clamp
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

    // Savings ↔ Quality dial (segmented control, above the composer)
    panelEl.appendChild(buildModeBar());

    // Auto-apply switch (opt-in — applies drafts without a confirm click)
    panelEl.appendChild(buildAutoApplyToggle());

    // Composer
    const composer = el('div', 'jt-assistant-composer');
    const input = document.createElement('textarea');
    input.className = 'jtt-input jt-assistant-input';
    input.rows = 2;
    input.placeholder = 'Ask about this job, the schedule, the budget…';
    input.dataset.jtBasePlaceholder = input.placeholder; // restored when the composer wall lifts
    input.dataset.jtRole = 'input';
    // Auto-grow with the prompt so longer messages stay readable, up to the
    // CSS max-height (then it scrolls). Reset in handleSend() after clearing.
    input.addEventListener('input', () => autoGrowInput(input));
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        void handleSend();
      }
    });
    const sendBtn = el('button', 'jtt-btn jtt-btn-primary jt-assistant-send', 'Send');
    sendBtn.type = 'button';
    sendBtn.dataset.jtRole = 'send';
    // Doubles as Stop while a run is in flight — cancels the stream instead of
    // sending. Enter in the textarea only ever sends.
    sendBtn.addEventListener('click', () => {
      if (sending) {
        stopRun();
        return;
      }
      void handleSend();
    });
    composer.appendChild(input);
    composer.appendChild(sendBtn);
    panelEl.appendChild(composer);

    // Footer (usage)
    const footer = el('div', 'jt-assistant-footer');
    footer.dataset.jtRole = 'footer';
    panelEl.appendChild(footer);

    document.body.appendChild(panelEl);
    renderEffortMode(); // reflect the current (default or restored) dial position
    renderAutoApply(); // reflect the current (default or restored) auto-apply state

    appendSystemNote(
      'Connected to your JobTread data. Answers come from live tool calls, not memory, and changes are drafted for your approval.'
    );
  }

  function togglePanel() {
    if (!panelEl) buildPanel();
    const open = panelEl.classList.toggle('jt-assistant-open');
    if (open) {
      applySqueeze(); // dock: push JobTread left to make room
      if (isMobileLayout()) bindViewportFit(); // mobile: sit above the keyboard
      renderChips(); // the SPA route may have changed since last open
      if (!statusChecked) {
        statusChecked = true; // once per page load, whatever the result
        void checkProfileStatus();
      }
      const input = panelEl.querySelector('[data-jt-role="input"]');
      if (input) input.focus();
      // Reopen an interrupted run (Feature 1) — once, on the first open after a reload.
      if (pendingRecovery) {
        const record = pendingRecovery;
        pendingRecovery = null;
        void recoverPendingRun(record);
      }
    } else {
      unbindViewportFit();
      releaseSqueeze(); // undock: hand the page's width back
    }
  }

  function resetSession() {
    sessionId = null;
    renderedDraftKeys.clear();
    pendingDrafts.clear();
    removeBulkBar();
    clearPendingRun(); // starting fresh abandons any interrupted run
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

  // `editText` (user bubbles only) is the raw text an Edit click restores to the
  // composer — for chip sends it's the full prompt, not the short label shown.
  function appendBubble(role, text, editText) {
    const messages = messagesEl();
    if (!messages) return null;
    const bubble = el('div', `jt-assistant-bubble jt-assistant-bubble-${role}`, text || '');
    if (role !== 'user') {
      messages.appendChild(bubble);
      scrollToBottom();
      return bubble;
    }
    // Wrap so the Edit control is a SIBLING of the bubble, never a child — the
    // bubble's textContent stays exactly the message (tests and copy rely on it).
    const row = el('div', 'jt-assistant-user-row');
    row.appendChild(bubble);
    const editBtn = el('button', 'jt-assistant-edit-btn', 'Edit');
    editBtn.type = 'button';
    editBtn.title = 'Edit and resend this message';
    editBtn.setAttribute('aria-label', 'Edit and resend this message');
    const raw = editText != null ? editText : text || '';
    editBtn.addEventListener('click', () => startEditMessage(raw));
    row.appendChild(editBtn);
    messages.appendChild(row);
    scrollToBottom();
    return bubble;
  }

  // Pull a past message back into the composer to tweak and resend. Stops any
  // in-flight run first so the edited version isn't racing the old one.
  function startEditMessage(text) {
    if (sending) stopRun();
    const input = panelEl?.querySelector('[data-jt-role="input"]');
    if (!input) return;
    input.value = text;
    autoGrowInput(input);
    input.focus();
    input.setSelectionRange(input.value.length, input.value.length);
    scrollToBottom();
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

    // Applied/failed drops the draft out of the pending set (or leaves it for a
    // retry), then refreshes the "Apply all" bar. Returns true on success so a
    // bulk/auto pass can tell what landed.
    let applying = false;
    const runConfirm = async () => {
      if (applying) return false;
      applying = true;
      disarm();
      apply.disabled = true;
      apply.textContent = 'Applying…';
      note.textContent = '';
      note.className = 'jt-assistant-draft-note';

      const result = await agentPost('confirm', { draft_id: draft.id });
      applying = false;

      if (result.data && result.data.status === 'executed') {
        showApplied('Applied', result.data.result_text);
        pendingDrafts.delete(draft.id);
        updateBulkBar();
        return true;
      }
      // Already applied (someone else, or a double-fire) — success with a note.
      if (result.status === 409 && result.code === 'DRAFT_ALREADY_EXECUTED') {
        showApplied('Already applied');
        pendingDrafts.delete(draft.id);
        updateBulkBar();
        return true;
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
      return false;
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

    // Register for bulk/auto-apply (applyNow fires this card's own confirm).
    pendingDrafts.set(draft.id, { applyNow: () => runConfirm() });
    if (autoApply) {
      void runConfirm(); // auto-apply confirms it now; updateBulkBar runs on settle
    } else {
      updateBulkBar();
    }
  }

  function setStatus(text) {
    const status = panelEl?.querySelector('[data-jt-role="status"]');
    if (status) status.textContent = text;
  }

  // Org-level credit-pool banner, pinned above the composer. Created on the
  // first `pool` frame, updated in place on later frames, and persisted for
  // the session (not cleared between runs). Removed with the panel in cleanup.
  function renderPoolBanner(frame) {
    // The composer's blocked state must track every pool frame, independent of
    // whether there's banner copy to show — otherwise a recovered `blocked:false`
    // frame with no copy (e.g. state:'normal' after a top-up) can never clear it.
    setComposerBlocked(!!frame.blocked);
    const copy = poolCopy(frame);
    if (!copy || !panelEl) return;
    if (!poolBannerEl) {
      poolBannerEl = el('div', 'jt-assistant-pool-banner');
      poolBannerEl.dataset.jtRole = 'pool-banner';
      const composer = panelEl.querySelector('.jt-assistant-composer');
      panelEl.insertBefore(poolBannerEl, composer);
    }
    const variant = frame.trial && frame.state === 'normal' ? 'trial' : frame.state;
    poolBannerEl.className = `jt-assistant-pool-banner jt-assistant-pool-banner-${variant}`;
    poolBannerEl.textContent = copy;
  }

  // Wall the composer when the org is out of credits: disable input + Send and
  // refuse new runs. An in-flight run is unaffected (the wall arrives instead of
  // a run, never mid-stream). Re-enabled by a later non-blocked pool frame.
  function setComposerBlocked(blocked) {
    composerBlocked = blocked;
    const input = panelEl?.querySelector('[data-jt-role="input"]');
    const sendBtn = panelEl?.querySelector('[data-jt-role="send"]');
    if (input) {
      input.disabled = blocked;
      input.placeholder = blocked
        ? 'Out of Assistant credits — top up or wait for the reset.'
        : input.dataset.jtBasePlaceholder || input.placeholder;
    }
    if (sendBtn && !sending) sendBtn.disabled = blocked;
    panelEl?.querySelector('.jt-assistant-composer')?.classList.toggle('jt-assistant-composer-blocked', blocked);
  }

  function setUsage(usage) {
    const footer = panelEl?.querySelector('[data-jt-role="footer"]');
    if (!footer || !usage) return;
    const cents = usage.costCents ?? 0;
    footer.textContent = `Session: ${usage.outputTokens ?? 0} tokens out · ~$${(cents / 100).toFixed(2)}`;
  }

  // Abort the in-flight run. The fetch rejects with AbortError (swallowed in
  // submitTask's catch), then its finally clears the sending state. We drop the
  // pending-run stash too — a deliberate stop shouldn't offer to resume.
  function stopRun() {
    if (abortController) abortController.abort();
    clearPendingRun();
    setStatus('');
    appendSystemNote('Stopped.');
  }

  function setSending(state) {
    sending = state;
    setWorking(state);
    const sendBtn = panelEl?.querySelector('[data-jt-role="send"]');
    if (sendBtn) {
      // Stay enabled while sending so it can act as Stop.
      sendBtn.disabled = false;
      sendBtn.textContent = state ? 'Stop' : 'Send';
      sendBtn.classList.toggle('jt-assistant-send-stop', state);
      sendBtn.setAttribute('aria-label', state ? 'Stop the assistant' : 'Send message');
    }
    // When a run ends while the org is walled, keep Send disabled.
    if (!state && composerBlocked && sendBtn) sendBtn.disabled = true;
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
    input.style.height = ''; // collapse back to the base height after send
    await submitTask(task, task);
  }

  /**
   * Run one task. `displayText` is what shows in the user bubble — chip
   * sends show their short label while the full canned prompt goes to
   * the server.
   */
  async function submitTask(task, displayText) {
    if (sending || composerBlocked || !panelEl) return;

    const auth = await resolveBearer();
    if (auth.error) {
      appendSystemNote(auth.error);
      return;
    }

    appendBubble('user', displayText || task, task);
    setSending(true);
    setStatus('Thinking…');

    // Stash this run so a mid-run reload can reopen its session (Feature 1).
    // The session id is known up front only when continuing a session; for a
    // fresh session it arrives on a frame (today only `done` carries it) and we
    // backfill it via capturePendingSession as soon as any frame surfaces it.
    const pendingRun = { sessionId: sessionId || null, task, startedAt: Date.now() };
    setPendingRun(pendingRun);
    const capturePendingSession = (id) => {
      if (id && !pendingRun.sessionId) {
        pendingRun.sessionId = id;
        setPendingRun(pendingRun);
      }
    };

    abortController = new AbortController();
    let assistantBubble = null;
    let assistantText = ''; // raw markdown accumulated across deltas

    try {
      const response = await fetch(AGENT_URL, {
        method: 'POST',
        headers: agentHeaders(auth, { Accept: 'text/event-stream' }),
        body: JSON.stringify({
          task,
          session_id: sessionId || undefined,
          context: collectPageContext(),
          mode: effortMode, // Savings↔Quality dial
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
        clearPendingRun(); // run finished normally — nothing to recover
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
        pool: (frame) => renderPoolBanner(frame),
        draft_proposed: (frame) => appendDraftCard(frame.draft || {}),
        usage: (frame) => setUsage(frame.usage),
        done: handleDone,
        error: (frame) => {
          clearPendingRun(); // run ended (server error) — nothing to recover
          appendSystemNote(`Something went wrong: ${frame.error}`);
          setStatus('');
        },
      };

      // Capture the session id from any frame that carries one (today only
      // `done`, but this stays correct if an earlier frame starts including it),
      // then dispatch to the frame's handler.
      const handleFrame = (frame) => {
        if (frame.session_id) capturePendingSession(frame.session_id);
        frameHandlers[frame.type]?.(frame);
      };

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
    if (detail?.code === 'ORG_MISMATCH') {
      return (
        "The assistant isn't set up for this organization yet. Ask your admin to " +
        'add an AI grant key for this org in the JT Power Tools portal.'
      );
    }
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
      return (
        "The assistant couldn't authenticate for this organization. If it keeps " +
        'happening, ask your admin to check the AI grant key for this org in the ' +
        'JT Power Tools portal.'
      );
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
        headers: agentHeaders(auth),
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
    // The old session's draft cards are being cleared from the DOM — drop their
    // pending records and the bulk bar so they don't outlive their cards.
    renderedDraftKeys.clear();
    pendingDrafts.clear();
    removeBulkBar();
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
    const { profileExists, skillsCount, pendingProposals } = result.data;
    if (profileExists === false) {
      renderProfileNudge();
    } else if (profileExists === true && skillsCount === 0) {
      renderSkillsHint();
    }
    // Independent of the profile/skills nudges: if the assistant drafted a
    // skill from a past session, surface a low-key awareness chip. Approval is
    // an admin action in the portal — the panel only points there (spec §A).
    if (Number(pendingProposals) > 0) renderProposalChip(Number(pendingProposals));
  }

  // Awareness chip for assistant-drafted skills (distillation). Dismissible,
  // reappears on next open until an admin resolves the proposals (count → 0),
  // mirroring the profile nudge's no-persistence behavior. Reuses the nudge
  // CSS classes so no new styles are needed.
  function renderProposalChip(count) {
    const messages = messagesEl();
    if (!messages || messages.querySelector('[data-jt-role="proposal-chip"]')) return;
    const card = el('div', 'jt-assistant-nudge');
    card.dataset.jtRole = 'proposal-chip';

    const dismiss = el('button', 'jt-assistant-nudge-dismiss', '×');
    dismiss.type = 'button';
    dismiss.setAttribute('aria-label', 'Dismiss');
    dismiss.addEventListener('click', () => card.remove());
    card.appendChild(dismiss);

    const noun = count === 1 ? 'a skill' : `${count} skills`;
    const them = count === 1 ? 'it' : 'them';
    card.appendChild(el('div', 'jt-assistant-nudge-title', 'The assistant drafted a skill'));
    card.appendChild(
      el(
        'div',
        'jt-assistant-nudge-copy',
        `From a recent session, the assistant drafted ${noun} worth saving. An admin can review ${them} in the portal.`
      )
    );

    const portalLink = el('button', 'jt-assistant-nudge-portal-link', 'Review in the portal');
    portalLink.type = 'button';
    portalLink.addEventListener('click', () => window.open(PORTAL_SKILLS_URL, '_blank', 'noopener'));
    card.appendChild(portalLink);

    messages.prepend(card);
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
    // Primary: run the setup interview right here — the server-side skill takes
    // over from this message (one question at a time, ending in an Apply card).
    const btn = el('button', 'jtt-btn jtt-btn-primary jt-assistant-nudge-btn', 'Set it up right here');
    btn.type = 'button';
    btn.addEventListener('click', () => {
      card.remove();
      void submitTask('Help me set up my assistant profile.');
    });
    card.appendChild(btn);

    // Secondary: the old portal path, for anyone who'd rather edit it there.
    const portalLink = el('button', 'jt-assistant-nudge-portal-link', 'or edit it in the portal');
    portalLink.type = 'button';
    portalLink.addEventListener('click', () => window.open(PORTAL_PROFILE_URL, '_blank', 'noopener'));
    card.appendChild(portalLink);

    messages.prepend(card);
  }

  function renderSkillsHint() {
    const messages = messagesEl();
    if (!messages || messages.querySelector('[data-jt-role="skills-hint"]')) return;
    const hint = el('div', 'jt-assistant-skills-hint', 'Add skills to teach procedures — Portal → Skills');
    hint.dataset.jtRole = 'skills-hint';
    messages.prepend(hint);
  }

  // ─── Per-user seat gate ───────────────────────────────────────────
  // The portal's per-member Assistant toggle (accounts.assistant_access,
  // Migration 036) rides on the stored account user object — the same place
  // `tier` comes from. Read chrome.storage directly so this doesn't depend on
  // AccountService's init order. A MISSING field (an account payload cached
  // before this shipped, refreshed on the next token refresh) is treated as
  // ENABLED: the server enforces the seat on every request, so a stale client
  // copy can only briefly expose the entry point, never grant real access.
  async function userAssistantAccessAllowed() {
    try {
      const stored = await chrome.storage.local.get(['jtAccountUserData']);
      const user = stored && stored.jtAccountUserData;
      return !(user && user.assistantAccess === false);
    } catch {
      return true; // fail open on a storage error; the server still gates use
    }
  }

  // ─── Lifecycle ────────────────────────────────────────────────────

  async function init() {
    if (isActive) return;

    // The AI Assistant toggle was removed from the popup — enablement is an
    // admin/company decision in the JT Power Tools Portal. Self-gate on the
    // Assistant company tier so the entry point only appears for entitled
    // companies; the server still enforces per-user access on every request.
    // Fail closed on any error so we never surface the assistant to a company
    // that isn't on the Assistant tier.
    try {
      const tier = await window.LicenseService?.getTier?.();
      if (!window.LicenseService?.tierHasFeature?.(tier, 'assistantPanel')) {
        console.log('AssistantPanel: tier gate — not on the Assistant tier, skipping');
        return;
      }
    } catch (err) {
      console.warn('AssistantPanel: tier check failed, skipping init', err);
      return;
    }

    // Per-user seat: skip binding for members an admin has opted out of the
    // Assistant in the portal. The server still enforces this on every request;
    // this keeps the chooser from ever appearing for a disabled seat.
    if (!(await userAssistantAccessAllowed())) {
      console.log('AssistantPanel: per-user gate — Assistant disabled for this account, skipping');
      return;
    }

    isActive = true;
    console.log('AssistantPanel: Initializing...');

    injectStyles();
    restorePanelWidth();
    restoreEffortMode(); // remembered Savings↔Quality dial position
    restoreAutoApply(); // remembered auto-apply opt-in
    loadPendingRecovery(); // reopen an interrupted run on the next panel open
    setupEntryPoint(); // intercept JobTread's help bubble (the only entry point)
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

    // Live breakpoint transitions. matchMedia is feature-detected — without it
    // (jsdom, very old engines) the panel simply never switches modes
    // mid-session, which is correct for a fixed-size environment.
    if (typeof window.matchMedia === 'function') {
      mobileQuery = window.matchMedia(MOBILE_QUERY);
      if (typeof mobileQuery.addEventListener === 'function') {
        mobileQueryHandler = onMobileLayoutChange;
        mobileQuery.addEventListener('change', mobileQueryHandler);
      }
    }

    // JobTread SPA org switches don't reload the page — re-attach the entry
    // point and reset the session when the active org changes.
    addListener(window, 'jt-org-changed', handleOrgChange);

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

    // Cancel any pending two-step-confirm reset timers (draft cards + bulk bar).
    draftConfirmTimers.forEach((timer) => clearTimeout(timer));
    draftConfirmTimers.clear();
    removeBulkBar();
    pendingDrafts.clear();

    // Help-bubble fork: unbind the interceptor, stop watching, close the popover.
    stopBubbleWatch();
    closeChooser();
    if (helpBubbleEl && helpBubbleHandler) {
      helpBubbleEl.removeEventListener('click', helpBubbleHandler, true);
    }
    helpBubbleEl = null;
    helpBubbleHandler = null;
    usingBubble = false;
    passThroughNextBubbleClick = false;

    // Undock: hand the page's width back exactly, and unwind any in-flight
    // resize drag (userSelect was pinned in onPanelResizePointerDown).
    if (panelResizeDrag) document.body.style.userSelect = '';
    panelResizeDrag = null;
    unbindViewportFit(); // clears panelEl's inline height/transform while it's still attached
    if (mobileQuery && mobileQueryHandler) {
      mobileQuery.removeEventListener('change', mobileQueryHandler);
    }
    mobileQuery = null;
    mobileQueryHandler = null;
    restoreSqueezeImmediate();

    if (panelEl) {
      panelEl.remove();
      panelEl = null;
    }
    // Banner lives inside the panel (removed above); drop the reference so a
    // fresh init() rebuilds it on the next pool frame.
    poolBannerEl = null;
    if (glowEl) {
      glowEl.remove();
      glowEl = null;
    }
    removeStyles();

    sessionId = null;
    composerBlocked = false;
    effortMode = DEFAULT_EFFORT_MODE; // re-restored from storage on next init
    autoApply = false; // re-restored from storage on next init
    bulkArmed = false;
    bulkApplying = false;
    renderedDraftKeys.clear();
    sending = false;
    statusChecked = false;
    pendingRecovery = null;
    panelWidth = DEFAULT_PANEL_WIDTH;
    isActive = false;
    console.log('AssistantPanel: Cleaned up');
  }

  return { init, cleanup, isActive: () => isActive };
})();

window.AssistantPanelFeature = AssistantPanelFeature;
