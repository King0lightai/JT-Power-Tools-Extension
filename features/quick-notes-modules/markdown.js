/**
 * Quick Notes Markdown Module
 * Handles markdown parsing and HTML conversion
 *
 * Dependencies: None
 */

const QuickNotesMarkdown = (() => {
  /**
   * The one definition of "this line is a checkbox" — shared by parseMarkdown
   * below AND by quick-notes.js's toggleCheckboxLine(), which reads the
   * source line named by a rendered checkbox's `data-line` attribute and
   * re-tests it against this same regex before flipping it. It requires a
   * literal single space between the dash and the bracket. Anything looser
   * (two spaces, a tab) must NOT match here, because it doesn't render an
   * interactive checkbox below. Keep this the only place that decides
   * "checkbox or not"; don't let a second, independently-maintained regex
   * grow elsewhere.
   */
  const CHECKBOX_LINE_RE = /^- \[([ xX])\]/;

  /**
   * Escape HTML special characters - delegates to shared Sanitizer utility
   * @param {string} text - Text to escape
   * @returns {string} Escaped HTML
   */
  const escapeHtml = (text) => Sanitizer.escapeHTML(text);

  /**
   * Process inline formatting (bold, italic, underline, strikethrough, code, links)
   * @param {string} text - Text with markdown
   * @returns {string} HTML with inline formatting
   */
  function processInlineFormatting(text) {
    if (!text) return '';

    let html = escapeHtml(text);

    // Parse links [text](url) - sanitize URL and attr-escape before href interpolation
    html = html.replace(/\[(.+?)\]\((.+?)\)/g, (match, linkText, url) => {
      const safeUrl = (typeof Sanitizer !== 'undefined' && Sanitizer.sanitizeURL)
        ? Sanitizer.sanitizeURL(url, '#')
        : '#';
      const hrefAttr = (typeof Sanitizer !== 'undefined' && Sanitizer.escapeAttr)
        ? Sanitizer.escapeAttr(safeUrl)
        : safeUrl;
      return `<a href="${hrefAttr}" target="_blank" rel="noopener noreferrer">${linkText}</a>`;
    });

    // Parse inline code `code`
    html = html.replace(/`(.+?)`/g, '<code>$1</code>');

    // Parse strikethrough ~~text~~ (must be before underline)
    html = html.replace(/~~(.+?)~~/g, '<s>$1</s>');

    // Parse underline __text__ (must be before bold to not confuse with **)
    html = html.replace(/__(.+?)__/g, '<u>$1</u>');

    // Parse bold **text**
    html = html.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');

    // Parse bold *text* (single asterisks, but not if preceded/followed by another asterisk)
    html = html.replace(/(?<!\*)\*(?!\*)(.+?)(?<!\*)\*(?!\*)/g, '<strong>$1</strong>');

    // Parse italic _text_ (single underscores, but not if preceded/followed by another underscore)
    html = html.replace(/(?<!_)_(?!_)(.+?)(?<!_)_(?!_)/g, '<em>$1</em>');

    return html;
  }

  /**
   * Render a run of consecutive "| ... |" lines as a read-only HTML table.
   * Ported from the deleted contenteditable editor's parseMarkdownTable
   * (features/quick-notes-modules/markdown.js as of 410e18ee) — same
   * row/column extraction (first line = header, second line = the markdown
   * separator row, discarded rather than validated). This is a preview
   * renderer, not the old WYSIWYG editor, so cells are plain <th>/<td> —
   * no `contenteditable`, no row/column context menu.
   * @param {string[]} tableLines - Raw lines that make up the table block
   * @param {number} lineIndex - Index of the table's first line in
   *   text.split('\n'); stamped as `data-line` so a click anywhere in the
   *   table can be mapped back to that line (see quick-notes.js's
   *   click-to-caret handler).
   * @returns {string} HTML table markup
   */
  function parseMarkdownTable(tableLines, lineIndex) {
    if (tableLines.length < 2) return '';

    const parseRow = (line) => {
      return line.split('|')
        .map(cell => cell.trim())
        .filter((cell, i, arr) => i > 0 && i < arr.length - 1); // Remove empty first/last from split
    };

    const headerCells = parseRow(tableLines[0]);
    // tableLines[1] is the markdown separator row (e.g. |---|---|) — discarded, not rendered.
    const bodyRows = tableLines.slice(2).map(parseRow);

    let html = `<div class="jt-note-table-container" data-line="${lineIndex}"><table class="jt-note-table"><thead><tr>`;
    headerCells.forEach(cell => {
      html += `<th>${escapeHtml(cell)}</th>`;
    });
    html += '</tr></thead><tbody>';

    bodyRows.forEach(cells => {
      html += '<tr>';
      cells.forEach(cell => {
        html += `<td>${escapeHtml(cell)}</td>`;
      });
      html += '</tr>';
    });

    html += '</tbody></table></div>';
    return html;
  }

  /**
   * Parse markdown to HTML (for preview in sidebar)
   * @param {string} text - Markdown text
   * @returns {string} HTML preview
   */
  function parseMarkdown(text) {
    if (!text) return '';

    /**
     * Classify each line against CHECKBOX_LINE_RE using the RAW line, before
     * inline formatting runs on it. Inline formatting (the link rule
     * especially — its lazy `[(.+?)]` can start a match at a checkbox's own
     * leading "[") can turn what was unambiguously "- [ ] ..." into
     * something that no longer looks like a checkbox line once escaped/
     * transformed. Classifying pre-formatting keeps "is this a checkbox
     * line" independent of what the line's text happens to contain.
     * Inline formatting is still applied — just to the remainder of the
     * line, after the checkbox/bullet marker has been stripped off.
     *
     * Walked with an explicit index (not Array.map) because a table block
     * consumes multiple raw lines but renders as a single output entry.
     * `i` is always the line's true position in rawLines/text.split('\n'),
     * so a table earlier in the note never shifts the `data-line` stamped
     * on a checkbox that comes after it.
     *
     * Every branch below stamps its output with that same `data-line`
     * index — checkboxes and bullets on their wrapping `<div>`, plain text
     * on a wrapping `<span>` (inline, so it can't disturb the pre-wrap
     * layout the way an empty `<div>` per blank line would) — so
     * quick-notes.js's click handler can map a click anywhere in the
     * preview back to the source line it started at, without counting
     * rendered elements.
     */
    const rawLines = text.split('\n');
    const parsedLines = [];
    let i = 0;

    while (i < rawLines.length) {
      const rawLine = rawLines[i];

      // Tables: a run of two or more consecutive "| ... |" lines.
      if (rawLine.trim().startsWith('|') && rawLine.trim().endsWith('|')) {
        const tableLines = [];
        let j = i;
        while (j < rawLines.length && rawLines[j].trim().startsWith('|') && rawLines[j].trim().endsWith('|')) {
          tableLines.push(rawLines[j]);
          j++;
        }
        if (tableLines.length >= 2) {
          parsedLines.push(parseMarkdownTable(tableLines, i));
          i = j;
          continue;
        }
      }

      // Checkbox lists
      const checkboxMatch = CHECKBOX_LINE_RE.exec(rawLine);
      if (checkboxMatch) {
        const checked = /x/i.test(checkboxMatch[1]);
        const rawRest = rawLine.slice(checkboxMatch[0].length).replace(/^\s*/, '');
        const rest = processInlineFormatting(rawRest);
        // i is this line's position in text.split('\n') — an integer we
        // maintain ourselves, never user-controlled text — so stamping it
        // directly as a numeric attribute is safe; it is never built by
        // concatenating unescaped input.
        parsedLines.push(`<div class="jt-note-checkbox${checked ? ' checked' : ''}" data-line="${i}"><input type="checkbox"${checked ? ' checked' : ''} disabled data-line="${i}"><span>${rest}</span></div>`);
        i++;
        continue;
      }

      // Bullet lists
      if (rawLine.match(/^- /)) {
        const rest = processInlineFormatting(rawLine.slice(2));
        parsedLines.push(`<div class="jt-note-bullet" data-line="${i}">• ${rest}</div>`);
        i++;
        continue;
      }

      parsedLines.push(`<span data-line="${i}">${processInlineFormatting(rawLine)}</span>`);
      i++;
    }

    return parsedLines.join('\n');
  }

  // Public API
  return {
    CHECKBOX_LINE_RE,
    escapeHtml,
    processInlineFormatting,
    parseMarkdown
  };
})();

// Make available globally
if (typeof window !== 'undefined') {
  window.QuickNotesMarkdown = QuickNotesMarkdown;
}
