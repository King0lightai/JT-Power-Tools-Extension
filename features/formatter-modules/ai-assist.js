/* JT Power Tools — Formatter AI Assist. v2.

   Adds an AI button to long-form fields that JobTread leaves bare (budget
   line descriptions, task descriptions, daily logs) by opening JobTread's
   own Writing Assistant — which otherwise exists only in the message
   composer — and handing control to the user.

   The assistant opens visibly (it is a SIBLING modal card, not a child of
   the composer — measured live 2026-08-22); the composer card itself is
   hidden (display: none + inert) the moment it opens, since it has nothing
   the user needs to see — a "New Job Message" modal with its own Send
   button, sitting behind the dialog they actually asked for. The user
   drives JobTread's own Writing Assistant. When they click JobTread's own
   "Use This", we read what it wrote into the (hidden) composer body and
   write it into the field it came from, then close the composer. If they
   close the assistant without using a result, we close the composer on
   their behalf — hidden, they have no way to close it themselves.

   The hide is guaranteed reversible: teardown() always tries to close the
   composer first, and unhides it if that fails for any reason. Fail
   visible, never fail hidden — see teardown() below.

   Design: docs/superpowers/specs/2026-08-22-formatter-ai-button-design.md,
   "v2 — Rebuilt against the real DOM". (The composer-hiding behavior above
   is a targeted addition on top of that design, not a revival of v1's
   Accept/Discard panel or its document-wide hiding of the whole hand-off.)

   The selectors in JT below are contracts with JobTread's markup, not icons
   we draw. They deliberately do NOT live in utils/icons.js — see the scope
   note at the top of that file. */
const FormatterAiAssist = (() => {
  'use strict';

  // ── Contracts with JobTread's DOM ───────────────────────────────────
  const JT = {
    // Lucide `bot`, the Writing Assistant control. Verified 2026-08-22:
    // exactly one such icon exists, and only while the composer is open.
    BOT_PATH_PREFIX: 'M12 8V4H8',
    COMPOSER_BODY: 'textarea[placeholder="Message"]',
    CLICKABLE: '[class*="cursor-pointer"], [role="button"]',
    TRIGGER_TEXT: 'Message',
    CLOSE_TEXT: 'Close',
    USE_THIS_TEXT: 'Use This'
  };

  // Applied to composerRoot() only — never to the Writing Assistant card,
  // which is a sibling and stays fully visible and interactive. Paired with
  // the `inert` attribute so a hidden composer can't steal keyboard focus.
  // Both are guaranteed reversed by teardown() below.
  const HIDDEN_CLASS = 'jt-ai-composer-hidden';

  function hideComposer(root) {
    if (!root) return;
    root.classList.add(HIDDEN_CLASS);
    root.setAttribute('inert', '');
  }

  function unhideComposer(root) {
    if (!root) return;
    root.classList.remove(HIDDEN_CLASS);
    root.removeAttribute('inert');
  }

  const JOB_URL = /^\/jobs\/([^/]+)/;

  function currentJobId() {
    const m = JOB_URL.exec(window.location.pathname);
    return m ? m[1] : null;
  }

  /* The button renders only where the round-trip can actually work:
     a job to scope the composer to, and a long-form field that is not
     JobTread's own composer. */
  function shouldOffer(field) {
    if (!field) return false;
    if (!currentJobId()) return false;
    const placeholder = field.placeholder || '';
    if (placeholder === 'Message') return false;
    if (placeholder === 'Name') return false;
    return true;
  }

  /* True only for the synchronous duration of a click this driver makes on
     one of JobTread's OWN controls (the composer trigger, the bot icon, a
     Close button). Those controls are JobTread's, so no allowlist selector
     in formatter.js's capture-phase handleGlobalClick can name them — and
     that handler treats any click outside the toolbar as "the user looked
     away". isDriving() lets it skip exactly our own synthetic clicks, so a
     real user click during the hand-off still dismisses the toolbar
     normally. */
  let driving = false;

  function isDriving() {
    return driving;
  }

  function driveClick(el) {
    driving = true;
    try {
      el.click();
    } finally {
      driving = false;
    }
  }

  function findByText(text, root) {
    const scope = root || document;
    return [...scope.querySelectorAll(JT.CLICKABLE)]
      .find((el) => (el.textContent || '').trim() === text) || null;
  }

  function waitFor(probe, options) {
    const opts = options || {};
    const deadline = Date.now() + (opts.timeout || 5000);
    return new Promise((resolve, reject) => {
      const tick = () => {
        let value = null;
        try {
          value = probe();
        } catch (err) {
          value = null; // probe can race a React re-render; retry
        }
        if (value) return resolve(value);
        if (Date.now() > deadline) return reject(new Error('timeout'));
        setTimeout(tick, 25);
      };
      tick();
    });
  }

  /* The composer's own root: nearest ancestor of the body that also holds a
     Close control. Structural rather than matching the modal title, which
     is the only string here that would move under localisation.

     JobTread's Writing Assistant renders as a SIBLING card, not a
     descendant of the composer, so this deliberately does NOT try to reach
     it — only the bot icon and the composer's own Close are scoped this
     way. Everything the assistant owns (Proofread/Rewrite/Use This/the
     result) is genuinely document-wide; see run() below.

     Bails to null (never returns document.body/documentElement) rather than
     letting the walk silently widen scope to the whole document — a Close
     search run against that "root" would match ANY Close control on the
     page. Callers must treat a null return as "no safe scope found". */
  function composerRoot(body) {
    let node = body;
    for (let i = 0; i < 12 && node.parentElement; i++) {
      node = node.parentElement;
      if (node === document.body || node === document.documentElement) break;
      if (findByText(JT.CLOSE_TEXT, node)) return node;
    }
    const fallback = body.parentElement;
    if (!fallback || fallback === document.body || fallback === document.documentElement) {
      return null;
    }
    return fallback;
  }

  function botControl(root) {
    const scope = root || document;
    const svg = [...scope.querySelectorAll('svg')].find((s) =>
      [...s.querySelectorAll('path')].some((p) =>
        String(p.getAttribute('d') || '').startsWith(JT.BOT_PATH_PREFIX)));
    return svg ? svg.closest(JT.CLICKABLE) : null;
  }

  function setValue(el, value) {
    const proto = window.HTMLTextAreaElement.prototype;
    const setter = Object.getOwnPropertyDescriptor(proto, 'value').set;
    setter.call(el, value);
    ['input', 'change'].forEach((type) => {
      const ev = new Event(type, { bubbles: true });
      ev.simulated = true; // JobTread is React — see .claude/rules
      el.dispatchEvent(ev);
    });
  }

  /* Closes whatever composer is currently in the DOM, scoped to its own
     root — never a document-wide "Close" search, which could hit an
     unrelated control elsewhere in the app. Re-derives the root from a
     fresh lookup rather than a cached reference, since React may have
     replaced the composer subtree during the hand-off. Safe to call with
     nothing open. */
  function closeComposer() {
    const body = document.querySelector(JT.COMPOSER_BODY);
    if (!body) return;
    const root = composerRoot(body);
    if (!root) return;
    const close = findByText(JT.CLOSE_TEXT, root);
    if (close) driveClick(close);
  }

  /* The one non-negotiable safety rule: never leave a hidden, live composer
     behind. Tries the normal close; if the exact node we hid is still on
     screen afterwards — its own Close control was missing, or the click
     somehow failed to remove it — the hide (and inert) are reversed instead.
     A visible composer the user can close beats an invisible one they
     cannot. Every path that ends the hand-off (Use This, the assistant
     closed without a result, a failure opening it) must route through this
     rather than calling closeComposer() directly. */
  function teardown(modal) {
    closeComposer();
    if (modal && document.body.contains(modal)) {
      console.warn('FormatterAiAssist: could not close the composer — left it visible');
      unhideComposer(modal);
    }
  }

  /* Opening the composer is the single highest-risk operation in this file:
     the composer can email a client, and a sent message cannot be recalled.
     Two guards run before anything is touched:

     1. If a composer is already open, it is not ours to take over — it may
        be the user's own half-written draft. Refuse immediately, before
        clicking anything.
     2. The trigger lookup ("Message") is a generic label with nothing to
        scope it to before the composer exists. Rather than click the first
        match blindly, refuse on ambiguity too. */
  async function openComposer() {
    const preexisting = document.querySelector(JT.COMPOSER_BODY);
    if (preexisting) throw new Error('composer-already-open');

    const candidates = [...document.querySelectorAll(JT.CLICKABLE)]
      .filter((el) => (el.textContent || '').trim() === JT.TRIGGER_TEXT);
    if (candidates.length === 0) throw new Error('no-composer-trigger');
    if (candidates.length > 1) throw new Error('ambiguous-composer-trigger');

    driveClick(candidates[0]);
    const body = await waitFor(() => document.querySelector(JT.COMPOSER_BODY), { timeout: 5000 });
    const modal = composerRoot(body);
    if (!modal) throw new Error('composer-root-not-found');
    // Hide the composer card immediately — before anything is typed into it
    // — so the user only ever sees the Writing Assistant, never the "New
    // Job Message" modal (with its own Send button) sitting behind it.
    hideComposer(modal);
    return { body, modal };
  }

  let running = false;
  let session = null; // { clickHandler, observer } for the active hand-off, if any

  /* Stops watching for "Use This" / the assistant closing / the composer
     disappearing. Does not itself touch the composer — every caller runs
     teardown(modal) first, so by the time detach() runs the composer is
     already closed (or, on the rare failure, deliberately left visible).
     Called on a successful write-back, on the composer disappearing on its
     own, and by the Formatter's cleanup() if the feature is torn down mid
     hand-off. Safe to call with nothing active. */
  function detach() {
    if (session) {
      document.removeEventListener('click', session.clickHandler, true);
      session.observer.disconnect();
      session = null;
    }
    running = false;
  }

  function afterPaint(fn) {
    requestAnimationFrame(() => requestAnimationFrame(fn));
  }

  /* The hand-off. From here on the user drives JobTread's own dialog —
     nothing here polls or times out waiting for them. Three outcomes end it:

     - They click "Use This" (JobTread's own control, document-wide — the
       assistant is a sibling of the composer, not inside it). That button
       already writes its result into the composer body; we just read it
       back out, immediately after, and write it into the field.
     - They close the Writing Assistant without using a result. The composer
       is hidden, so the user has no way to see or close it themselves — we
       close it on their behalf. A click reaching this handler with the text
       "Close" can only be the assistant's, since a hidden, inert composer
       cannot receive a real pointer click on its own Close.
     - The composer disappears from the DOM for any other reason (a route
       change, anything) without either of the above firing.

     isDriving() guards against our own synthetic clicks: teardown() ->
     closeComposer() drives a click on the composer's own Close control,
     which would otherwise re-enter this same capture-phase handler. */
  function watchComposer(field, body, modal) {
    const clickHandler = (e) => {
      if (isDriving()) return;

      const hit = e.target && e.target.closest && e.target.closest(JT.CLICKABLE);
      if (!hit) return;
      const label = (hit.textContent || '').trim();

      if (label === JT.USE_THIS_TEXT) {
        // Our capture-phase listener runs before JobTread's own click handler
        // has written the result into the composer body — wait a couple of
        // paints so the write has actually landed before we read it.
        afterPaint(() => {
          const liveBody = document.querySelector(JT.COMPOSER_BODY);
          const result = liveBody ? liveBody.value : body.value;
          if (field && document.contains(field)) {
            setValue(field, result);
          } else {
            console.warn('FormatterAiAssist: field is no longer on screen — result was not written back');
          }
          teardown(modal);
          detach();
        });
        return;
      }

      if (label === JT.CLOSE_TEXT) {
        // No async write to wait for here (unlike "Use This"), so this runs
        // synchronously rather than deferring across paints — deferring
        // would leave a stray callback that could fire during a LATER
        // hand-off (a fresh run() reuses this same capture-phase pattern)
        // and close whatever composer happens to be open at that point.
        teardown(modal);
        detach();
      }
    };

    const observer = new MutationObserver(() => {
      if (!document.body.contains(body)) detach();
    });
    observer.observe(document.body, { childList: true, subtree: true });

    document.addEventListener('click', clickHandler, true);
    session = { clickHandler, observer };
  }

  /* One click: open the composer, inject the field's text, open the
     assistant, then hand off. Never reads live toolbar state — opening the
     composer blurs the field, and on the budget grid toolbars are
     destroyed and rebuilt rather than restyled, so everything here works
     off the field/text passed in at click time, not anything read back out
     of the DOM later. */
  async function run(options) {
    const opts = options || {};
    const field = opts.field;
    const text = opts.text || '';
    if (!field || running) return;
    running = true;

    let body, modal;
    try {
      ({ body, modal } = await openComposer());
    } catch (err) {
      running = false;
      throw err; // nothing opened, or it wasn't ours to open — nothing to close
    }

    try {
      setValue(body, text);
      const bot = await waitFor(() => botControl(modal), { timeout: 5000 });
      driveClick(bot);
    } catch (err) {
      teardown(modal); // we opened (and hid) this one — ours to close, or unhide, on failure
      running = false;
      throw err;
    }

    watchComposer(field, body, modal);
  }

  return {
    shouldOffer,
    currentJobId,
    isDriving,
    JT,
    run,
    detach,
    _setValue: setValue,
    _findByText: findByText,
    _waitFor: waitFor,
    _composerRoot: composerRoot,
    _botControl: botControl
  };
})();

if (typeof window !== 'undefined') {
  window.FormatterAiAssist = FormatterAiAssist;
}
