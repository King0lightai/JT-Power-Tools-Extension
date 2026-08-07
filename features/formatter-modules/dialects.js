// Formatter Dialects Module
//
// JobTread's own text fields and Quick Notes' preview renderer
// (features/quick-notes-modules/markdown.js) speak two different inline
// markdown dialects. formats.js (apply/remove) and detection.js (active-state
// detection) both need to agree on which marker string means which format —
// this is the single place that mapping is defined, so the two engines can
// never drift apart again the way they did when Quick Notes' toolbar was
// wired to the JobTread-only engine.
//
// JOBTREAD is the default and must stay byte-for-byte what detection.js and
// formats.js already did before dialects existed: every marker is a single
// character, doubling as both open and close.
const FormatterDialects = (() => {
  const JOBTREAD = Object.freeze({
    bold: '*',
    italic: '^',
    underline: '_',
    strikethrough: '~'
  });

  // Quick Notes' renderer (quick-notes-modules/markdown.js:54-66) parses
  // strike as ~~x~~, underline as __x__, bold as **x** (or *x*), and italic
  // as _x_ — with no marker at all for `^`. Emitting/detecting these markers
  // is what keeps the toolbar honest with what the preview actually renders.
  const QUICK_NOTES = Object.freeze({
    bold: '**',
    italic: '_',
    underline: '__',
    strikethrough: '~~'
  });

  const DEFAULT_DIALECT = JOBTREAD;

  return {
    JOBTREAD,
    QUICK_NOTES,
    DEFAULT_DIALECT
  };
})();

// Export to window
if (typeof window !== 'undefined') {
  window.FormatterDialects = FormatterDialects;
}
