/* JT Power Tools — shared icon registry.

   Why this exists: the same icon markup was being re-declared per call site.
   formatter-modules/toolbar.js alone declared its map twice in one file and
   the copies had already diverged (one carried a `color` entry the other
   lacked), which is the failure mode a single source of truth prevents.

   Scope note — DO NOT add JobTread's own icon paths here. Several features
   match on host markup, e.g.
     row.querySelector('svg path[d="m6 9 6 6 6-6"]')
   in auto-collapse-groups.js, to read JobTread's collapse and completion
   state. Those strings are contracts with JobTread's DOM, not icons we draw.
   Folding them in here would make a future icon swap silently break
   collapse and task-completion detection.

   Icons are Lucide-derived, matching what the extension already shipped.
   Because they live in one place now, changing sets later is a change to
   this file rather than a sweep across every feature. */
const JTIcons = (() => {
  const REGISTRY = {
    bullet: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="8" y1="6" x2="21" y2="6"></line><line x1="8" y1="12" x2="21" y2="12"></line><line x1="8" y1="18" x2="21" y2="18"></line><circle cx="3" cy="6" r="1" fill="currentColor"></circle><circle cx="3" cy="12" r="1" fill="currentColor"></circle><circle cx="3" cy="18" r="1" fill="currentColor"></circle></svg>',
    numbered: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="10" y1="6" x2="21" y2="6"></line><line x1="10" y1="12" x2="21" y2="12"></line><line x1="10" y1="18" x2="21" y2="18"></line><text x="3" y="7" font-size="6" fill="currentColor" stroke="none" font-weight="600">1</text><text x="3" y="13" font-size="6" fill="currentColor" stroke="none" font-weight="600">2</text><text x="3" y="19" font-size="6" fill="currentColor" stroke="none" font-weight="600">3</text></svg>',
    link: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"></path><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"></path></svg>',
    quote: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 21c3 0 7-1 7-8V5c0-1.25-.756-2.017-2-2H4c-1.25 0-2 .75-2 1.972V11c0 1.25.75 2 2 2 1 0 1 0 1 1v1c0 1-1 2-2 2s-1 .008-1 1.031V21z"></path><path d="M15 21c3 0 7-1 7-8V5c0-1.25-.757-2.017-2-2h-4c-1.25 0-2 .75-2 1.972V11c0 1.25.75 2 2 2h.75c0 2.25.25 4-2.75 4v3z"></path></svg>',
    table: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="2" ry="2"></rect><line x1="3" y1="9" x2="21" y2="9"></line><line x1="3" y1="15" x2="21" y2="15"></line><line x1="9" y1="3" x2="9" y2="21"></line><line x1="15" y1="3" x2="15" y2="21"></line></svg>',
    alert: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"></path><line x1="12" y1="9" x2="12" y2="13"></line><line x1="12" y1="17" x2="12.01" y2="17"></line></svg>',
    ai: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3l1.6 4.4L18 9l-4.4 1.6L12 15l-1.6-4.4L6 9l4.4-1.6z"></path><path d="M18 15l.8 2.2L21 18l-2.2.8L18 21l-.8-2.2L15 18l2.2-.8z"></path></svg>',
    color: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="13.5" cy="6.5" r="2.5" fill="#ef4444" stroke="none"></circle><circle cx="17.5" cy="10.5" r="2.5" fill="#f59e0b" stroke="none"></circle><circle cx="8.5" cy="7.5" r="2.5" fill="#3b82f6" stroke="none"></circle><circle cx="6.5" cy="12.5" r="2.5" fill="#10b981" stroke="none"></circle><path d="M12 2C6.5 2 2 6.5 2 12s4.5 10 10 10c.926 0 1.648-.746 1.648-1.688 0-.437-.18-.835-.437-1.125-.29-.289-.438-.652-.438-1.125a1.64 1.64 0 0 1 1.668-1.668h1.996c3.051 0 5.555-2.503 5.555-5.555C21.965 6.012 17.461 2 12 2z"></path></svg>',
    alignLeft: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="3" y1="6" x2="21" y2="6"></line><line x1="3" y1="12" x2="15" y2="12"></line><line x1="3" y1="18" x2="18" y2="18"></line></svg>',
    alignCenter: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="3" y1="6" x2="21" y2="6"></line><line x1="6" y1="12" x2="18" y2="12"></line><line x1="4" y1="18" x2="20" y2="18"></line></svg>',
    alignRight: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="3" y1="6" x2="21" y2="6"></line><line x1="9" y1="12" x2="21" y2="12"></line><line x1="6" y1="18" x2="21" y2="18"></line></svg>',
    hr: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="3" y1="12" x2="21" y2="12"></line></svg>',
  };

  /**
   * Icon markup as a string, for template-literal call sites.
   * Returns '' for an unknown name so a typo degrades to a blank button
   * rather than printing "undefined" into the UI.
   */
  function markup(name) {
    const svg = REGISTRY[name];
    if (!svg) {
      console.warn(`JTIcons: unknown icon "${name}"`);
      return '';
    }
    return svg;
  }

  /**
   * Icon as a live SVGElement — preferred for DOM construction, since it
   * needs no innerHTML. Registry markup is static and authored in this file,
   * never user input, so parsing it carries no injection surface.
   */
  function el(name, attributes = {}) {
    const svg = REGISTRY[name];
    if (!svg) {
      console.warn(`JTIcons: unknown icon "${name}"`);
      return null;
    }
    // The registry markup carries no xmlns — it was authored for innerHTML,
    // where the HTML parser puts <svg> in the SVG namespace for you. DOMParser
    // does not, and a null-namespace <svg> silently fails to render, so the
    // declaration is added here rather than editing the shipped markup.
    const source = svg.includes('xmlns=')
      ? svg
      : svg.replace('<svg', '<svg xmlns="http://www.w3.org/2000/svg"');
    const parsed = new DOMParser().parseFromString(source, 'image/svg+xml').documentElement;
    const node = document.importNode(parsed, true);
    Object.entries(attributes).forEach(([k, v]) => node.setAttribute(k, v));
    return node;
  }

  /**
   * The whole registry as a plain name→markup object, so existing call
   * sites that interpolate `icons.bullet` keep working unchanged.
   * Frozen: the registry is shared, and a caller mutating it would alter
   * every other feature's icons.
   */
  function map() {
    return Object.freeze({ ...REGISTRY });
  }

  /** Icon names currently registered — used by the unit tests. */
  function names() {
    return Object.keys(REGISTRY);
  }

  return { markup, el, map, names };
})();

window.JTIcons = JTIcons;
