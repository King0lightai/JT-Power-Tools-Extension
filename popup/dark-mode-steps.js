// ═══ Dark Mode step toggle + JobTread theme offer ═══
//
// Dark Mode is a 4-step setting rather than an on/off one. Step "off" maps to
// darkMode = false; the other three map to darkMode = true plus a
// darkModeLevel. The #darkMode checkbox stays the on/off source of truth (see
// popup.html), so everything else in popup.js — mutual exclusion,
// getCurrentSettings, the master toggle — keeps working against a boolean.
//
// Three of the four steps also depend on JobTread's OWN theme: Kinda Dark is a
// dimmed LIGHT theme, Dark repaints the app in the JT Power Tools greys, and
// Double Dark layers on JobTread's dark mode. When the selected step and
// JobTread's theme disagree, Kinda and Double silently do nothing (each
// stylesheet self-disables) while Dark stacks two dark themes on one page — so
// this module says so and points at the one place that can fix it: JobTread's
// own Settings → Appearance.
//
// It used to offer a button that flipped JobTread's theme for you. It couldn't
// — see the measurement in features/jobtread-theme.js. Directing beats a
// control that appears to work and reverts on the next reload.
//
// This lives in its own file, not in popup.js, purely so it can be exercised:
// popup.js runs license checks, account UI and a dozen network calls on load,
// which makes its 5000 lines untestable in jsdom. Nothing here touches those.
const DarkModeSteps = (() => {
  const STEPS = [
    { level: 'off', hint: "JobTread's own theme, untouched." },
    { level: 'soft', hint: "Kinda Dark — still a light theme, with the glare taken off. Needs JobTread's own theme set to Light." },
    {
      level: 'dark',
      hint: "Dark — the standard JT Power Tools dark theme. Needs JobTread's own theme set to Light."
    },
    {
      level: 'double',
      hint: "Double Dark — sits on top of JobTread's dark mode and takes the blue out of it. Switch JobTread's own theme to Dark as well.",
      needsAction: true
    }
  ];

  // What JobTread's theme has to be for a level to look right. Only "off" works
  // against either — it is JobTread's own theme, untouched.
  //
  // `dark` is here because it REPAINTS the app in the JT Power Tools greys
  // rather than layering on JobTread's dark mode. On top of their dark mode the
  // two fight, and unlike Kinda and Double this level's stylesheet has no scope
  // that makes it stand down, so the notice is the only warning the user gets.
  const LEVEL_NEEDS_THEME = { soft: 'light', dark: 'light', double: 'dark' };

  const NOTICE_TEXT = {
    double: "Double Dark sits on top of JobTread's dark mode.",
    dark: 'Dark repaints JobTread in its own greys.',
    soft: 'Kinda Dark is a light theme.'
  };

  // Where the user actually changes it. JobTread's Appearance card is headed
  // "Choose how JobTread looks on this device" and offers System / Light /
  // Dark. No link: we have no URL for that screen we can state with
  // confidence, and a guessed one that 404s is worse than the instruction.
  const HELP_TEXT = {
    dark: 'Set JobTread to Dark in its own Settings → Appearance.',
    light: 'Set JobTread to Light in its own Settings → Appearance.'
  };

  const JOBTREAD_URL_PREFIX = 'https://app.jobtread.com';

  // The level to restore when the user steps back onto a dark step. Seeded
  // from saved settings; 'dark' until then.
  let level = 'dark';

  // JobTread's theme on the tab the popup was opened over. Null when the
  // active tab is not a JobTread page, which is what keeps the notice hidden
  // entirely off JobTread.
  let jtTheme = null;

  const el = (id) => document.getElementById(id);

  function activeLevel() {
    const checkbox = el('darkMode');
    return checkbox && checkbox.checked ? level : 'off';
  }

  /**
   * Show or hide the "JobTread's own theme disagrees" notice.
   *
   * Hidden whenever there is nothing to say: a level that works either way, a
   * non-JobTread tab, or a JobTread theme that already agrees.
   */
  function renderThemeNotice(active) {
    const notice = el('darkModeThemeNotice');
    if (!notice) return;

    const needed = LEVEL_NEEDS_THEME[active];
    if (!needed || !jtTheme || jtTheme.effective === needed) {
      notice.hidden = true;
      return;
    }

    const text = el('darkModeThemeNoticeText');
    if (text) text.textContent = NOTICE_TEXT[active];

    const help = el('darkModeThemeHelp');
    if (help) help.textContent = HELP_TEXT[needed];

    notice.hidden = false;
  }

  /**
   * Paint the step control from the current checkbox state. Called on load, on
   * every step click, and after appearance-mode exclusion silently unchecks
   * darkMode — without that last one the control would still read "Dark" while
   * Contrast Fix had taken over.
   */
  function sync() {
    const group = el('darkModeSteps');
    const checkbox = el('darkMode');
    const hint = el('darkModeHint');
    if (!group || !checkbox) return;

    const active = activeLevel();
    const step = STEPS.find(s => s.level === active) || STEPS[0];

    group.querySelectorAll('.step-toggle-option').forEach(btn => {
      const selected = btn.dataset.level === active;
      btn.setAttribute('aria-checked', selected ? 'true' : 'false');
      // Roving tabindex: the group is one tab stop, arrows move within it.
      btn.tabIndex = selected ? 0 : -1;
    });

    if (hint) {
      hint.textContent = step.hint;
      hint.classList.toggle('needs-action', Boolean(step.needsAction));
    }

    renderThemeNotice(active);
  }

  /**
   * Select a step. Writes through to the checkbox and dispatches `change` so
   * the existing listener saves the settings — this must not become a second
   * save path.
   */
  function select(next) {
    const checkbox = el('darkMode');
    if (!checkbox) return;

    const wantsDark = next !== 'off';
    if (wantsDark) level = next;

    checkbox.checked = wantsDark;
    sync();

    // Setting .checked in script never fires `change`, and stepping between two
    // dark levels doesn't move the checkbox at all — so dispatch it explicitly.
    // The existing listener then runs appearance-mode exclusion and saves,
    // which keeps this off a second save path.
    checkbox.dispatchEvent(new Event('change', { bubbles: true }));
  }

  /**
   * Seed the remembered level from saved settings. Settings saved before this
   * was a 4-step toggle have no darkModeLevel, and those users had the standard
   * dark theme — so that is what an absent (or unknown) value means.
   */
  function restoreLevel(saved) {
    if (saved && STEPS.some(s => s.level === saved)) level = saved;
  }

  /**
   * Read JobTread's theme off the tab the popup was opened over.
   *
   * Only the ACTIVE tab: the popup opens over whatever the user was looking at,
   * and reporting on some other window's JobTread tab would describe a page
   * they can't see. Any failure — not a JobTread page, no content script yet,
   * tab closed — leaves the cache null, which hides the notice.
   */
  async function readJobTreadTheme() {
    jtTheme = null;

    try {
      const tabs = await new Promise(resolve => {
        chrome.tabs.query({ active: true, currentWindow: true }, (t) => resolve(t || []));
      });
      const tab = tabs[0];
      if (!tab || !tab.id || typeof tab.url !== 'string' ||
        !tab.url.startsWith(JOBTREAD_URL_PREFIX)) {
        return;
      }

      const resp = await chrome.tabs.sendMessage(tab.id, { type: 'GET_JOBTREAD_THEME' });
      if (!resp || (resp.effective !== 'dark' && resp.effective !== 'light')) return;

      jtTheme = { effective: resp.effective };
    } catch (_error) {
      // No receiving end on that tab, or it went away. Silence is the right
      // answer: we simply don't show the notice.
    }
  }

  /** Re-read JobTread's theme and repaint. */
  async function refresh() {
    await readJobTreadTheme();
    sync();
  }

  function init() {
    const group = el('darkModeSteps');
    if (!group) return;

    const options = Array.from(group.querySelectorAll('.step-toggle-option'));

    options.forEach((btn, index) => {
      btn.addEventListener('click', () => select(btn.dataset.level));

      // Arrow keys move between steps, matching the radiogroup role the markup
      // advertises. Without this the group is reachable but not operable by
      // keyboard beyond the one focused step.
      btn.addEventListener('keydown', (e) => {
        let next = null;
        if (e.key === 'ArrowRight' || e.key === 'ArrowDown') next = (index + 1) % options.length;
        else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') next = (index - 1 + options.length) % options.length;
        if (next === null) return;

        e.preventDefault();
        options[next].focus();
        select(options[next].dataset.level);
      });
    });

    sync();

    // JobTread's theme lives on another tab, so it can only be read
    // asynchronously. Paint the control first and repaint when the answer
    // lands — the notice is the only part that depends on it.
    refresh().catch(err => console.error('DarkModeSteps: theme read failed:', err));
  }

  return {
    STEPS,
    init,
    sync,
    select,
    refresh,
    restoreLevel,
    getLevel: () => level
  };
})();

if (typeof window !== 'undefined') {
  window.DarkModeSteps = DarkModeSteps;
}
