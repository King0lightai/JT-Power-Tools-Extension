/**
 * Quick Notes Markdown Module
 * Handles markdown parsing and HTML conversion
 *
 * Dependencies: None
 */

const QuickNotesMarkdown = (() => {
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

    // Parse links [text](url) - sanitize URL to block javascript:/data: schemes
    html = html.replace(/\[(.+?)\]\((.+?)\)/g, (match, linkText, url) => {
      const safeUrl = (typeof Sanitizer !== 'undefined' && Sanitizer.sanitizeURL)
        ? Sanitizer.sanitizeURL(url, '#')
        : (url.trim().toLowerCase().startsWith('javascript:') || url.trim().toLowerCase().startsWith('data:')) ? '#' : url;
      return `<a href="${safeUrl}" target="_blank" rel="noopener noreferrer">${linkText}</a>`;
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
   * Parse markdown table to HTML
   * @param {string[]} tableLines - Array of table lines
   * @returns {string} HTML table
   */
  function parseMarkdownTable(tableLines) {
    if (tableLines.length < 2) return '';

    const parseRow = (line) => {
      return line.split('|')
        .map(cell => cell.trim())
        .filter((cell, i, arr) => i > 0 && i < arr.length - 1); // Remove empty first/last from split
    };

    const headerCells = parseRow(tableLines[0]);
    // Skip separator line (index 1)
    const bodyRows = tableLines.slice(2).map(parseRow);

    let html = '<div class="jt-note-table-container"><table class="jt-note-table"><thead><tr>';
    headerCells.forEach(cell => {
      html += `<th contenteditable="true">${escapeHtml(cell)}</th>`;
    });
    html += '</tr></thead><tbody>';

    bodyRows.forEach(cells => {
      html += '<tr>';
      cells.forEach(cell => {
        html += `<td contenteditable="true">${escapeHtml(cell)}</td>`;
      });
      html += '</tr>';
    });

    html += '</tbody></table></div>';
    return html;
  }

  /**
   * Parse markdown to HTML for contenteditable editor (WYSIWYG)
   * @param {string} text - Markdown text
   * @returns {string} HTML for editor
   */
  function parseMarkdownForEditor(text) {
    if (!text) return '<div><br></div>';

    const lines = text.split('\n');
    const htmlParts = [];
    let i = 0;

    while (i < lines.length) {
      const line = lines[i];

      // Check if this is the start of a table (line starts with |)
      if (line.trim().startsWith('|') && line.trim().endsWith('|')) {
        // Collect all table lines
        const tableLines = [];
        while (i < lines.length && lines[i].trim().startsWith('|') && lines[i].trim().endsWith('|')) {
          tableLines.push(lines[i]);
          i++;
        }
        if (tableLines.length >= 2) {
          htmlParts.push(parseMarkdownTable(tableLines));
        }
        continue;
      }

      // Checkbox lists
      if (line.match(/^- \[x\]/i)) {
        const content = line.replace(/^- \[x\]\s*/i, '');
        htmlParts.push(`<div class="jt-note-checkbox checked" contenteditable="false"><input type="checkbox" checked><span contenteditable="true">${processInlineFormatting(content)}</span></div>`);
        i++;
        continue;
      }
      if (line.match(/^- \[ \]/)) {
        const content = line.replace(/^- \[ \]\s*/, '');
        htmlParts.push(`<div class="jt-note-checkbox" contenteditable="false"><input type="checkbox"><span contenteditable="true">${processInlineFormatting(content)}</span></div>`);
        i++;
        continue;
      }
      // Bullet lists with indentation support
      if (line.match(/^(\s*)- /)) {
        const match = line.match(/^(\s*)- (.*)$/);
        const indent = Math.floor(match[1].length / 2); // 2 spaces = 1 indent level
        const content = match[2];
        const indentAttr = indent > 0 ? ` data-indent="${indent}"` : '';
        htmlParts.push(`<div class="jt-note-bullet"${indentAttr}>• ${processInlineFormatting(content)}</div>`);
        i++;
        continue;
      }
      // Numbered lists: 1. item, 2. item
      if (line.match(/^(\s*)(\d+)\. /)) {
        const match = line.match(/^(\s*)(\d+)\. (.*)$/);
        if (match) {
          const indent = Math.floor(match[1].length / 2);
          const number = match[2];
          const content = match[3];
          const indentAttr = indent > 0 ? ` data-indent="${indent}"` : '';
          htmlParts.push(`<div class="jt-note-numbered" data-number="${number}"${indentAttr}>${number}. ${processInlineFormatting(content)}</div>`);
          i++;
          continue;
        }
      }
      // Regular text with inline formatting
      htmlParts.push(`<div>${processInlineFormatting(line) || '<br>'}</div>`);
      i++;
    }

    return htmlParts.join('');
  }

  /**
   * Parse markdown to HTML (for preview in sidebar)
   * @param {string} text - Markdown text
   * @returns {string} HTML preview
   */
  function parseMarkdown(text) {
    if (!text) return '';

    // Escape HTML first
    let html = escapeHtml(text);

    // Parse links [text](url) - sanitize URL to block javascript:/data: schemes
    html = html.replace(/\[(.+?)\]\((.+?)\)/g, (match, linkText, url) => {
      const safeUrl = (typeof Sanitizer !== 'undefined' && Sanitizer.sanitizeURL)
        ? Sanitizer.sanitizeURL(url, '#')
        : (url.trim().toLowerCase().startsWith('javascript:') || url.trim().toLowerCase().startsWith('data:')) ? '#' : url;
      return `<a href="${safeUrl}" target="_blank" rel="noopener noreferrer">${linkText}</a>`;
    });

    // Parse inline code `code`
    html = html.replace(/`(.+?)`/g, '<code>$1</code>');

    // Parse strikethrough ~~text~~ (must be before underline)
    html = html.replace(/~~(.+?)~~/g, '<s>$1</s>');

    // Parse underline __text__ (must be before bold)
    html = html.replace(/__(.+?)__/g, '<u>$1</u>');

    // Parse bold **text**
    html = html.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');

    // Parse bold *text* (single asterisks)
    html = html.replace(/(?<!\*)\*(?!\*)(.+?)(?<!\*)\*(?!\*)/g, '<strong>$1</strong>');

    // Parse italic _text_ (single underscores)
    html = html.replace(/(?<!_)_(?!_)(.+?)(?<!_)_(?!_)/g, '<em>$1</em>');

    // Parse line by line for lists and checkboxes
    const lines = html.split('\n');
    const parsedLines = lines.map(line => {
      // Checkbox lists
      if (line.match(/^- \[x\]/i)) {
        return line.replace(/^- \[x\]\s*/i, '<div class="jt-note-checkbox checked"><input type="checkbox" checked disabled><span>') + '</span></div>';
      }
      if (line.match(/^- \[ \]/)) {
        return line.replace(/^- \[ \]\s*/, '<div class="jt-note-checkbox"><input type="checkbox" disabled><span>') + '</span></div>';
      }
      // Bullet lists
      if (line.match(/^- /)) {
        return line.replace(/^- /, '<div class="jt-note-bullet">• ') + '</div>';
      }
      return line;
    });

    return parsedLines.join('\n');
  }

  /**
   * Extract inline markdown from formatted HTML element
   * @param {HTMLElement} element - Element to extract from
   * @returns {string} Markdown text
   */
  function extractInlineMarkdown(element) {
    let text = '';
    const children = element.childNodes;

    for (let node of children) {
      if (node.nodeType === Node.TEXT_NODE) {
        text += node.textContent;
      } else if (node.nodeType === Node.ELEMENT_NODE) {
        const tag = node.tagName.toLowerCase();
        const content = node.textContent;

        if (tag === 'strong' || tag === 'b') {
          text += `**${content}**`;
        } else if (tag === 'em' || tag === 'i') {
          text += `_${content}_`;
        } else if (tag === 'u') {
          text += `__${content}__`;
        } else if (tag === 's' || tag === 'del' || tag === 'strike') {
          text += `~~${content}~~`;
        } else if (tag === 'code') {
          text += `\`${content}\``;
        } else if (tag === 'a') {
          const href = node.getAttribute('href') || '#';
          text += `[${content}](${href})`;
        } else if (tag === 'br') {
          // Skip br tags
        } else {
          text += extractInlineMarkdown(node);
        }
      }
    }

    return text.replace(/^•\s*/, '');
  }

  /**
   * Convert HTML table to markdown table format
   * @param {HTMLTableElement} table - Table element
   * @returns {string} Markdown table
   */
  function tableToMarkdown(table) {
    const rows = [];
    const headerRow = table.querySelector('thead tr');
    const bodyRows = table.querySelectorAll('tbody tr');

    // Process header row
    if (headerRow) {
      const headers = [];
      const separators = [];
      headerRow.querySelectorAll('th').forEach(th => {
        const text = th.textContent.trim() || ' ';
        headers.push(text);
        separators.push('-'.repeat(Math.max(3, text.length)));
      });
      rows.push('| ' + headers.join(' | ') + ' |');
      rows.push('| ' + separators.join(' | ') + ' |');
    }

    // Process body rows
    bodyRows.forEach(tr => {
      const cells = [];
      tr.querySelectorAll('td').forEach(td => {
        cells.push(td.textContent.trim() || ' ');
      });
      if (cells.length > 0) {
        rows.push('| ' + cells.join(' | ') + ' |');
      }
    });

    return rows.join('\n');
  }

  /**
   * Convert contenteditable HTML back to markdown
   * @param {HTMLElement} element - Contenteditable element
   * @returns {string} Markdown text
   */
  function htmlToMarkdown(element) {
    let markdown = '';
    const children = element.childNodes;

    for (let node of children) {
      if (node.nodeType === Node.ELEMENT_NODE) {
        const tag = node.tagName.toLowerCase();

        if (node.classList.contains('jt-note-checkbox')) {
          const checkbox = node.querySelector('input[type="checkbox"]');
          const span = node.querySelector('span');
          const checked = checkbox && checkbox.checked;
          const text = span ? extractInlineMarkdown(span) : '';
          markdown += `- [${checked ? 'x' : ' '}] ${text}\n`;
        } else if (node.classList.contains('jt-note-bullet')) {
          const text = node.textContent.replace(/^•\s*/, '');
          const indent = parseInt(node.getAttribute('data-indent') || '0');
          const indentSpaces = '  '.repeat(indent); // 2 spaces per indent level
          markdown += `${indentSpaces}- ${extractInlineMarkdown(node)}\n`;
        } else if (node.classList.contains('jt-note-numbered')) {
          const number = node.getAttribute('data-number') || '1';
          const indent = parseInt(node.getAttribute('data-indent') || '0');
          const indentSpaces = '  '.repeat(indent);
          // Remove the number prefix from content before extracting markdown
          const textContent = node.textContent.replace(/^\d+\.\s*/, '');
          markdown += `${indentSpaces}${number}. ${textContent}\n`;
        } else if (node.classList.contains('jt-note-table-container') || tag === 'table') {
          // Handle table conversion to markdown
          const table = tag === 'table' ? node : node.querySelector('table');
          if (table) {
            markdown += tableToMarkdown(table) + '\n';
          }
        } else if (tag === 'div') {
          const content = extractInlineMarkdown(node);
          if (content) markdown += content + '\n';
        }
      } else if (node.nodeType === Node.TEXT_NODE) {
        const text = node.textContent;
        if (text.trim()) markdown += text;
      }
    }

    return markdown.trim();
  }

  // Public API
  return {
    escapeHtml,
    processInlineFormatting,
    parseMarkdownForEditor,
    parseMarkdown,
    extractInlineMarkdown,
    htmlToMarkdown
  };
})();

// Make available globally
if (typeof window !== 'undefined') {
  window.QuickNotesMarkdown = QuickNotesMarkdown;
}
