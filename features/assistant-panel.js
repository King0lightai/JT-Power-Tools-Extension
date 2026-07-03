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
 * Writes: Phase 1 is read-only. If the server proposes a write draft
 * (draft_proposed frame), the panel renders it as a card; the Apply
 * button ships with the Phase 2 confirm flow.
 */
const AssistantPanelFeature = (() => {
  const AGENT_URL = 'https://jobtread-mcp-server.king0light-ai.workers.dev/agent/chat';

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

  let isActive = false;
  let launcherEl = null;
  let panelEl = null;
  let glowEl = null;
  let sessionId = null;
  let abortController = null;
  let sending = false;
  const eventListeners = []; // document/window-level — must be removed in cleanup()

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
    return { bearer: `${licenseData.key}:${grantKey}` };
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
    launcherEl.addEventListener('click', togglePanel);
    document.body.appendChild(launcherEl);
  }

  function buildPanel() {
    panelEl = el('div', 'jt-tools-surface jt-assistant-panel');
    panelEl.setAttribute('role', 'dialog');
    panelEl.setAttribute('aria-label', 'JT Power Tools Assistant');

    // Header
    const header = el('div', 'jt-assistant-header');
    header.appendChild(el('span', 'jt-assistant-title', 'Assistant'));
    const headerActions = el('div', 'jt-assistant-header-actions');
    const newBtn = el('button', 'jtt-btn jt-assistant-new-btn', 'New chat');
    newBtn.type = 'button';
    newBtn.title = 'Start a fresh session';
    newBtn.addEventListener('click', resetSession);
    const closeBtn = el('button', 'jtt-btn jt-assistant-close-btn', '×');
    closeBtn.type = 'button';
    closeBtn.setAttribute('aria-label', 'Close assistant');
    closeBtn.addEventListener('click', togglePanel);
    headerActions.appendChild(newBtn);
    headerActions.appendChild(closeBtn);
    header.appendChild(headerActions);
    panelEl.appendChild(header);

    // Messages
    const messages = el('div', 'jt-assistant-messages');
    messages.dataset.jtRole = 'messages';
    panelEl.appendChild(messages);

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
      renderChips(); // the SPA route may have changed since last open
      const input = panelEl.querySelector('[data-jt-role="input"]');
      if (input) input.focus();
    }
  }

  function resetSession() {
    sessionId = null;
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

  function appendDraftCard(draft) {
    const messages = messagesEl();
    if (!messages) return;
    const card = el('div', 'jt-assistant-draft');
    card.appendChild(el('div', 'jt-assistant-draft-title', 'Proposed change (draft)'));
    card.appendChild(el('div', 'jt-assistant-draft-summary', draft.humanSummary || draft.tool));
    const apply = el('button', 'jtt-btn jt-assistant-draft-apply', 'Apply (coming soon)');
    apply.type = 'button';
    apply.disabled = true;
    apply.title = 'Draft approval ships with the write-enabled release';
    card.appendChild(apply);
    messages.appendChild(card);
    scrollToBottom();
  }

  function setStatus(text) {
    const status = panelEl?.querySelector('[data-jt-role="status"]');
    if (status) status.textContent = text;
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

    try {
      const response = await fetch(AGENT_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${auth.bearer}`,
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
        if (!assistantBubble) assistantBubble = appendBubble('assistant', '');
        return assistantBubble;
      };

      const handleDone = (frame) => {
        sessionId = frame.session_id || sessionId;
        // Server truth wins: replace streamed text with the final answer
        // if they diverge (e.g. multi-iteration runs).
        if (frame.answer && ensureBubble()) {
          assistantBubble.textContent = frame.answer;
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
            assistantBubble.textContent += frame.text;
            scrollToBottom();
          }
          setStatus('');
        },
        tool_started: (frame) => setStatus(`Reading ${frame.label || frame.name}…`),
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
    if (status === 401) {
      return 'Authentication failed. Re-check your license and grant key in the JT Power Tools popup.';
    }
    return detail?.error || `The assistant returned an error (HTTP ${status}).`;
  }

  // ─── Lifecycle ────────────────────────────────────────────────────

  function init() {
    if (isActive) return;
    isActive = true;
    console.log('AssistantPanel: Initializing...');

    injectStyles();
    buildLauncher();
    buildGlow();

    // Esc closes the panel — document-level, so it must be tracked for
    // removal in cleanup().
    addListener(document, 'keydown', (e) => {
      if (e.key === 'Escape' && panelEl?.classList.contains('jt-assistant-open')) {
        togglePanel();
      }
    });

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

    if (panelEl) {
      panelEl.remove();
      panelEl = null;
    }
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
    sending = false;
    isActive = false;
    console.log('AssistantPanel: Cleaned up');
  }

  return { init, cleanup, isActive: () => isActive };
})();

window.AssistantPanelFeature = AssistantPanelFeature;
