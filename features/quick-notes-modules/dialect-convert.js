/**
 * Quick Notes Dialect Converter
 *
 * Pure text-to-text converter: rewrites Quick Notes' own markdown dialect
 * into JobTread's native dialect, so a migrated note renders identically
 * through JobTread's own renderer (features/preview-mode-modules/jt-markdown.js)
 * instead of Quick Notes' bespoke one (features/quick-notes-modules/markdown.js).
 *
 * Quick Notes dialect (source):  **x** or *x* = bold, _x_ = italic,
 *   __x__ = underline, ~~x~~ = strike, `x` = code.
 * JobTread dialect (target):     *x* = bold, ^x^ = italic, _x_ = underline,
 *   ~x~ = strike, no inline code.
 *
 * No chrome.* APIs, no DOM. Runs identically in the browser (window) and in
 * Node (the server-side migration imports this same file via module.exports)
 * — there must never be a second implementation of these rules.
 *
 * DELIBERATELY NOT SELF-IDEMPOTENT. toJobTread(toJobTread(x)) !== toJobTread(x)
 * in general, and that is by design, not an oversight. __underline__ converts
 * to the JobTread-dialect _underline_; on a second pass that bare _x_ span is
 * byte-identical to source-dialect italic and would be re-mangled into
 * ^underline^. There is no text-level rule that can tell "already-converted
 * underline" apart from "never-converted italic" — the two forms collide.
 *
 * This module must therefore be run exactly ONCE per note. The caller
 * guarantees that by stamping each row's `content_format` column (`qn1` ->
 * `jt1`) in the SAME atomic statement that writes the converted content, so
 * there is never a window where content is converted but unmarked, and a
 * row already marked `jt1` is never re-fed through this converter.
 * Idempotency belongs to that marker, not to this text transform — do not
 * "fix" the underline/italic collision by re-adding a guard here (e.g.
 * skipping the italic rule when a caret is present); a prior version tried
 * exactly that and it silently left italics unconverted on any line
 * containing an unrelated caret (`x^2`, `72^F`, `^ see above`), corrupting
 * real notes. See tests/features/dialect-convert.test.js for the pinned
 * case and .superpowers/sdd/task-2-report.md for the incident writeup.
 *
 * LINE COUNT EXCEPTION: toJobTread() otherwise preserves line count exactly
 * (convertLine() never crosses a '\n'), but a GFM-style table separator row
 * (`| --- | --- |`, optionally with alignment colons) is DROPPED rather than
 * converted, because JobTread's own table grammar has no separator row —
 * "First row is the header (no separator row in JT syntax)" per
 * docs/superpowers/specs/2026-07-12-preview-mode-jt-parity-design.md. A note
 * written under the old GFM-aware renderer has one anyway, and jt-markdown.js
 * (which has no concept of a separator row) would otherwise render it as a
 * literal data row of dashes. A row only counts as a separator, and is only
 * dropped, when (a) every cell is nothing but dashes/colons/spaces AND (b)
 * the line immediately before or after it is itself a pipe row — so a lone
 * `| --- |` in prose, or a real data row that merely contains a dash
 * (`| a - b | c |`), is never touched. See the "table separator rows"
 * describe block in tests/features/dialect-convert.test.js.
 */

const QuickNotesDialect = (() => {
  'use strict';

  // Same technique jt-markdown.js uses to shield built <a> HTML from its own
  // inline-formatting passes: Private Use Area sentinels that cannot occur in
  // note text, so a shielded span can never collide with real content.
  const TOKEN_OPEN = '';
  const TOKEN_CLOSE = '';
  const TOKEN_RE = new RegExp(TOKEN_OPEN + '(\\d+)' + TOKEN_CLOSE, 'g');

  // Checkbox lines are the one documented deviation from JobTread's own
  // grammar (JobTread's text fields have no checkbox markup at all) — the
  // `- [ ] ` / `- [x] ` marker itself is left byte-identical so the
  // checkbox renderer's own line-matching keeps working. Everything AFTER
  // the marker is ordinary note text, though, and goes through the same
  // emphasis conversion as any other line — a checklist item's **bold** or
  // _italic_ converts exactly like it would outside a checklist. Same
  // marker shape as QuickNotesMarkdown.CHECKBOX_LINE_RE, duplicated here
  // (not imported) to keep this module dependency-free and pure.
  const CHECKBOX_LINE_RE = /^- \[([ xX])\]/;

  // A "| ... |" row — table syntax on both source and target dialects.
  function isPipeRow(line) {
    if (typeof line !== 'string') return false;
    const t = line.trim();
    return t.length >= 2 && t.startsWith('|') && t.endsWith('|');
  }

  // A GFM separator row: every cell is nothing but dashes, colons and
  // spaces (`---`, `:---`, `---:`, `:-:`). Checked on the cell content, not
  // the whole line, so this can't be fooled by pipes elsewhere.
  function isSeparatorRow(line) {
    if (!isPipeRow(line)) return false;
    const cells = line.trim().slice(1, -1).split('|').map((c) => c.trim());
    return cells.length > 0 && cells.every((c) => /^:?-+:?$/.test(c));
  }

  /**
   * Convert a single line (never crosses a '\n' — markdown emphasis doesn't
   * span lines here, and keeping this per-line makes "line count never
   * changes" trivially true by construction, aside from the documented
   * separator-row exception handled separately in toJobTread()).
   *
   * Checkbox lines split: the `- [ ] ` / `- [x] ` marker passes through
   * byte-identical, and only the text after it runs through
   * convertEmphasis() — see the CHECKBOX_LINE_RE comment above.
   * @param {string} line
   * @returns {string}
   */
  function convertLine(line) {
    const checkboxMatch = CHECKBOX_LINE_RE.exec(line);
    if (checkboxMatch) {
      const marker = checkboxMatch[0];
      return marker + convertEmphasis(line.slice(marker.length));
    }
    return convertEmphasis(line);
  }

  /**
   * Apply the marker-rewrite rules (bold/italic/underline/strike) and the
   * code-span/link/URL shielding to a span of text. Extracted from
   * convertLine() so a checkbox line can run this on just the text after
   * its marker.
   * @param {string} line
   * @returns {string}
   */
  function convertEmphasis(line) {
    const tokens = [];
    const stash = (value) => {
      tokens.push(value);
      return TOKEN_OPEN + (tokens.length - 1) + TOKEN_CLOSE;
    };

    let work = line;

    // Shield spans that must never be touched by the marker rules below:
    // inline code, markdown link targets, and bare URLs. Order matters —
    // link targets are shielded before the bare-URL pass so a URL that's
    // already inside `](...)` isn't independently re-matched.
    work = work.replace(/`([^`]+)`/g, (match) => stash(match));
    work = work.replace(/\]\(([^)\n]+)\)/g, (match, url) => '](' + stash(url) + ')');
    work = work.replace(/(https?:\/\/\S+|www\.\S+)/gi, (match) => stash(match));

    // Doubles before singles, or **bold** degrades into a stray asterisk
    // wrapping *bold*.
    work = work.replace(/\*\*(.+?)\*\*/g, '*$1*');

    // __x__ -> underline's *target* form is itself a bare _x_ span — the
    // same shape rule 5 (below) converts. Shield it now and restore only
    // after rule 5 has run, so this call never mistakes its own
    // just-produced underline for source-dialect italic.
    work = work.replace(/__(.+?)__/g, (match, inner) => stash(`_${inner}_`));

    work = work.replace(/~~(.+?)~~/g, '~$1~');

    // _x_ -> ^x^ (italic), only where the underscore isn't adjacent to a
    // word character on the outside — so `some_file_name` is untouched.
    // Runs unconditionally, including on lines that already contain a
    // caret (x^2, 72^F, ^ see above) — see the module doc comment for why
    // there is no safe guard to add here.
    work = work.replace(/(?<!\w)_(?!_)(.+?)(?<!_)_(?!\w)/g, '^$1^');

    work = work.replace(TOKEN_RE, (match, index) => tokens[Number(index)]);

    return work;
  }

  /**
   * Convert Quick Notes dialect text to JobTread dialect text.
   *
   * Two passes: convertLine() runs per-line first (so the marker rules
   * never see cross-line context), then GFM separator rows are dropped —
   * but only ones sitting in table context (a pipe row immediately before
   * or after) — per the module doc comment's line-count exception.
   * @param {string} text
   * @returns {string}
   */
  function toJobTread(text) {
    if (typeof text !== 'string' || text === '') return text;
    const rawLines = text.split('\n');
    const convertedLines = rawLines.map(convertLine);
    const out = [];
    for (let i = 0; i < convertedLines.length; i++) {
      const inTableContext = isPipeRow(rawLines[i - 1]) || isPipeRow(rawLines[i + 1]);
      if (isSeparatorRow(rawLines[i]) && inTableContext) continue;
      out.push(convertedLines[i]);
    }
    return out.join('\n');
  }

  return { toJobTread };
})();

if (typeof window !== 'undefined') {
  window.QuickNotesDialect = QuickNotesDialect;
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = QuickNotesDialect;
}
