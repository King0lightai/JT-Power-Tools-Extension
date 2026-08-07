/**
 * Quick Notes Markdown Module
 * Handles markdown parsing and HTML conversion
 *
 * Dependencies: None
 */

const QuickNotesMarkdown = (() => {
  /**
   * The one definition of "this line is a checkbox" — shared by parseMarkdown
   * below AND by quick-notes.js's toggleCheckboxLine(), which maps the nth
   * rendered <input> back to its source line by counting lines that match
   * this same regex. It requires a literal single space between the dash and
   * the bracket. Anything looser (two spaces, a tab) must NOT match here,
   * because it doesn't render an interactive checkbox below — a toggler
   * regex that accepted more than this one would count phantom lines and
   * tick the wrong one. Keep this the only place that decides "checkbox or
   * not"; don't let a second, independently-maintained regex grow elsewhere.
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
   * Parse markdown to HTML (for preview in sidebar)
   * @param {string} text - Markdown text
   * @returns {string} HTML preview
   */
  function parseMarkdown(text) {
    if (!text) return '';

    // Apply inline formatting (links, code, bold, italic, etc.)
    const html = processInlineFormatting(text);

    // Parse line by line for lists and checkboxes
    const lines = html.split('\n');
    const parsedLines = lines.map(line => {
      // Checkbox lists
      const previewCheckboxMatch = CHECKBOX_LINE_RE.exec(line);
      if (previewCheckboxMatch) {
        const checked = /x/i.test(previewCheckboxMatch[1]);
        const rest = line.slice(previewCheckboxMatch[0].length).replace(/^\s*/, '');
        return `<div class="jt-note-checkbox${checked ? ' checked' : ''}"><input type="checkbox"${checked ? ' checked' : ''} disabled><span>${rest}</span></div>`;
      }
      // Bullet lists
      if (line.match(/^- /)) {
        return line.replace(/^- /, '<div class="jt-note-bullet">• ') + '</div>';
      }
      return line;
    });

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
