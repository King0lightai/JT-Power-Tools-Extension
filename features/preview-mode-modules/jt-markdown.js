/**
 * JT Power Tools - JobTread Markdown Renderer
 *
 * Pure, side-effect-free renderer that reproduces JobTread's native document
 * preview exactly. Exposes window.JTMarkdown.render(text) -> html string.
 *
 * Ground truth: docs/superpowers/specs/2026-07-12-preview-mode-jt-parity-design.md
 * (captured live from app.jobtread.com). JobTread runs Tailwind v4; this module
 * emits jt-md-* prefixed classes mapped 1:1 to those Tailwind classes, plus
 * inline styles exactly where JobTread uses inline styles (alignment divs and
 * bold/italic/underline/strike spans).
 *
 * No chrome.* APIs. Security: all text is escaped via Sanitizer.escapeHTML
 * before inline processing; link URLs go through Sanitizer.sanitizeURL +
 * escapeAttr. The renderer never emits unescaped user text.
 *
 * Options (both opt-in, default off, so Preview Mode's parity output —
 * tests/features/preview-mode-renderer.test.js — never sees either one):
 *   - taskLists: `- [ ]`/`- [x]` renders as an interactive checkbox.
 *   - lineAnchors: every rendered top-level block (a plain line, a heading/
 *     color/align/icon wrapper, a bullet or numbered list item) is stamped
 *     with `data-line="<n>"`, its own index into text.split('\n'). Quick
 *     Notes uses this to map a click in its preview pane back to the
 *     source line (see quick-notes.js's click handler) — Preview Mode has
 *     no click-to-edit feature and never passes it. `data-line` is always
 *     this generated index, never derived from note text.
 */

const JTMarkdown = (() => {
  'use strict';

  // Placeholder markers (Unicode Private Use Area) used to shield fully-built
  // <a> HTML from HTML escaping and inline-formatting passes. They contain no
  // markup or markdown marker characters, so they survive both untouched.
  const TOKEN_OPEN = '\uE000';
  const TOKEN_CLOSE = '\uE001';

  // Icon whitelist — exact SVG path data captured from JobTread. Anything not
  // in this map renders no svg (see renderLine).
  const ICONS = {
    octogonAlert: '<path d="M12 16h.01M12 8v4M15.312 2a2 2 0 0 1 1.414.586l4.688 4.688A2 2 0 0 1 22 8.688v6.624a2 2 0 0 1-.586 1.414l-4.688 4.688a2 2 0 0 1-1.414.586H8.688a2 2 0 0 1-1.414-.586l-4.688-4.688A2 2 0 0 1 2 15.312V8.688a2 2 0 0 1 .586-1.414l4.688-4.688A2 2 0 0 1 8.688 2z"/>',
    info: '<circle cx="12" cy="12" r="10"/><path d="M12 16v-4M12 8h.01"/>',
    triangleAlert: '<path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3M12 9v4M12 17h.01"/>',
    lightbulb: '<path d="M15 14c.2-1 .7-1.7 1.5-2.5 1-.9 1.5-2.2 1.5-3.5A6 6 0 0 0 6 8c0 1 .2 2.2 1.5 3.5.7.7 1.3 1.5 1.5 2.5M9 18h6M10 22h4"/>'
  };

  const HEADING_CLASS = { 1: 'jt-md-h1', 2: 'jt-md-h2', 3: 'jt-md-h3' };

  // --- Security helpers (delegate to shared Sanitizer, with safe fallbacks) --

  function sanitizer() {
    return (typeof window !== 'undefined' && window.Sanitizer) ? window.Sanitizer : null;
  }

  function esc(text) {
    const s = sanitizer();
    if (s && s.escapeHTML) return s.escapeHTML(text);
    if (text === null || text === undefined) return '';
    return String(text)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function safeUrl(url) {
    const s = sanitizer();
    return (s && s.sanitizeURL) ? s.sanitizeURL(url, '#') : '#';
  }

  function escAttr(value) {
    const s = sanitizer();
    if (s && s.escapeAttr) return s.escapeAttr(value);
    return esc(value);
  }

  // --- Inline formatting -----------------------------------------------------

  // Applies inside any line's content: bold/italic/underline/strike spans
  // (inline styles, non-greedy, nestable, intra-word), markdown links, and
  // bare-URL autolinking. Mid-line [!color:x] / [!icon:x] are NOT parsed here —
  // they stay literal, matching JobTread.
  function processInline(text) {
    if (text === '' || text === null || text === undefined) return '';

    const tokens = [];
    const stash = (html) => {
      tokens.push(html);
      return TOKEN_OPEN + (tokens.length - 1) + TOKEN_CLOSE;
    };

    let work = String(text);

    // Markdown links [label](url) — stash the fully-built, sanitized anchor so
    // its href/label survive the escape + inline passes without corruption.
    work = work.replace(/\[([^\]\n]+)\]\(([^)\n]+)\)/g, (m, label, url) => {
      const href = escAttr(safeUrl(url));
      return stash(`<a class="jt-md-link" href="${href}" target="_blank" rel="noopener noreferrer">${esc(label)}</a>`);
    });

    // Bare URLs (http/https or www.) — conventional matcher. Trailing sentence
    // punctuation is kept outside the link.
    work = work.replace(/(https?:\/\/[^\s<]+|www\.[^\s<]+)/gi, (m) => {
      let url = m;
      let trail = '';
      const t = /[.,;:!?)\]}]+$/.exec(url);
      if (t) {
        trail = url.slice(url.length - t[0].length);
        url = url.slice(0, url.length - t[0].length);
      }
      const rawHref = /^www\./i.test(url) ? 'https://' + url : url;
      const href = escAttr(safeUrl(rawHref));
      return stash(`<a class="jt-md-link" href="${href}" target="_blank" rel="noopener noreferrer">${esc(url)}</a>`) + trail;
    });

    // Escape everything else (placeholders and markdown markers pass through).
    work = esc(work);

    // Inline styles — sequential non-greedy passes reproduce JobTread's
    // non-greedy, nestable pairing (a bold span can contain an italic span,
    // etc.). Unclosed markers simply never match and render literally.
    work = work.replace(/\*(.+?)\*/g, '<span style="font-weight: bold;">$1</span>');
    work = work.replace(/\^(.+?)\^/g, '<span style="font-style: italic;">$1</span>');
    work = work.replace(/_(.+?)_/g, '<span style="text-decoration: underline;">$1</span>');
    work = work.replace(/~(.+?)~/g, '<span style="text-decoration: line-through;">$1</span>');

    // Restore stashed anchors.
    work = work.replace(new RegExp(TOKEN_OPEN + '(\\d+)' + TOKEN_CLOSE, 'g'), (m, idx) => tokens[Number(idx)]);

    return work;
  }

  // --- Single-line prefix pipeline -------------------------------------------

  // Consumes prefixes in encounter order (outermost = first matched):
  //   [!color:X]  ->  <div class="jt-md-X">
  //   -:-         ->  <div style="text-align: center;">
  //   --:         ->  <div style="text-align: right;">
  //   #, ##, ###  ->  <div class="jt-md-hN">   (#### and more -> jt-md-h4)
  //   [!icon:name]->  <div>[svg]\n{rest}</div> (terminal; unknown -> no svg)
  // A line that matches ANY prefix renders as a block (no trailing newline);
  // a plain line emits its content followed by "\n".
  function consumePrefixes(line) {
    let rest = line;
    const wrappers = [];
    let icon = null;
    let scanning = true;

    while (scanning) {
      scanning = false;

      let m = /^\[!color:(green|yellow|blue|red|orange|purple)\]/.exec(rest);
      if (m) {
        wrappers.push({ open: `<div class="jt-md-${m[1]}">`, close: '</div>' });
        rest = rest.slice(m[0].length).replace(/^[ \t]+/, '');
        scanning = true;
        continue;
      }

      m = /^\[!icon:([A-Za-z0-9_]+)\]/.exec(rest);
      if (m) {
        icon = m[1];
        rest = rest.slice(m[0].length).replace(/^[ \t]+/, '');
        // Icon is terminal — the remainder is content, not further prefixes.
        break;
      }

      if (/^-:-/.test(rest)) {
        wrappers.push({ open: '<div style="text-align: center;">', close: '</div>' });
        rest = rest.slice(3).replace(/^[ \t]+/, '');
        scanning = true;
        continue;
      }

      if (/^--:/.test(rest)) {
        wrappers.push({ open: '<div style="text-align: right;">', close: '</div>' });
        rest = rest.slice(3).replace(/^[ \t]+/, '');
        scanning = true;
        continue;
      }

      m = /^(#+)/.exec(rest);
      if (m) {
        const cls = HEADING_CLASS[m[1].length] || 'jt-md-h4';
        wrappers.push({ open: `<div class="${cls}">`, close: '</div>' });
        rest = rest.slice(m[1].length).replace(/^[ \t]+/, '');
        scanning = true;
        continue;
      }
    }

    return { wrappers, icon, rest };
  }

  // Applies a prefix pipeline's wrappers around already-rendered inner HTML,
  // outermost first (encounter order). When `lineIndex` is given, it is
  // stamped as `data-line` on the OUTERMOST wrapper only (wrappers[0] —
  // the last one applied below) — never on inner nested wrappers, so a
  // multi-prefix line (e.g. a colored heading) gets exactly one data-line,
  // on the element a click would actually land in first.
  function applyWrappers(wrappers, html, lineIndex) {
    let out = html;
    for (let k = wrappers.length - 1; k >= 0; k--) {
      let open = wrappers[k].open;
      if (k === 0 && lineIndex !== null && lineIndex !== undefined) {
        open = open.slice(0, -1) + ` data-line="${lineIndex}">`;
      }
      out = open + out + wrappers[k].close;
    }
    return out;
  }

  // Identity of a prefix run — consecutive list lines only merge into one list
  // when their prefixes match exactly, so a colored item never absorbs (or is
  // absorbed by) an uncolored one.
  function wrapperKey(wrappers) {
    return wrappers.map((w) => w.open).join('');
  }

  // `lineIndex`/`options` are only used for the opt-in `lineAnchors` stamp
  // below (see its own comment) — every other call site of renderLine
  // (blockquote lines) omits them, which is exactly "flag off", so their
  // output is untouched.
  function renderLine(line, lineIndex, options) {
    const lineAnchors = !!(options && options.lineAnchors);
    const { wrappers, icon, rest } = consumePrefixes(line);
    const isBlock = wrappers.length > 0 || icon !== null;
    let html;

    if (icon !== null) {
      const svg = ICONS[icon];
      const inner = processInline(rest);
      // Only stamp the icon's own wrapper div when it's the OUTERMOST
      // element (no other prefix wraps it) — otherwise the outer wrapper
      // gets the stamp via applyWrappers below, and stamping both would
      // put data-line on two nested elements for one line.
      const iconAttr = (lineAnchors && wrappers.length === 0) ? ` data-line="${lineIndex}"` : '';
      html = svg
        ? `<div${iconAttr}><svg class="jt-md-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${svg}</svg>\n${inner}</div>`
        : `<div${iconAttr}>${inner}</div>`;
    } else {
      html = processInline(rest);
      // A plain line has no wrapper element at all by default — wrap it in
      // an inline <span> (not a block <div>, which would force its own line
      // break on top of the '\n' the caller already joins lines with).
      if (lineAnchors && wrappers.length === 0) {
        html = `<span data-line="${lineIndex}">${html}</span>`;
      }
    }

    html = applyWrappers(wrappers, html, lineAnchors ? lineIndex : null);

    return isBlock ? html : html + '\n';
  }

  // --- Block builders --------------------------------------------------------

  function renderBlockquote(blockLines) {
    // Strip one leading "> " (space optional) from each line.
    const inner = blockLines.map((l) => l.replace(/^>[ \t]?/, ''));

    // Container color comes from the FIRST line's [!color:X] (else gray).
    let color = 'gray';
    const cm = /^\[!color:(green|yellow|blue|red|orange|purple)\]/.exec(inner[0] || '');
    if (cm) color = cm[1];

    const body = inner.map(renderLine).join('');
    return `<div class="jt-md-quote jt-md-quote-${color}">${body}</div>`;
  }

  function parseCells(row) {
    return row.trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map((c) => c.trim());
  }

  function renderTable(rows) {
    let html = '<table class="jt-md-table"><thead><tr class="jt-md-thead-row">';
    parseCells(rows[0]).forEach((c) => {
      html += `<th class="jt-md-th">${processInline(c)}</th>`;
    });
    html += '</tr></thead>';

    if (rows.length > 1) {
      html += '<tbody>';
      for (let r = 1; r < rows.length; r++) {
        html += '<tr class="jt-md-tr">';
        parseCells(rows[r]).forEach((c) => {
          html += `<td class="jt-md-td">${processInline(c)}</td>`;
        });
        html += '</tr>';
      }
      html += '</tbody>';
    }

    html += '</table>';
    return html;
  }

  // Task-list marker — only consulted when options.taskLists is on. Kept out
  // of the default path entirely so Preview Mode's parity output never sees it.
  const TASK_MARKER = /^\[([ xX])\]\s?(.*)$/;

  // options.lineAnchors (opt-in, same shape as taskLists — see its own
  // comment above renderBulletList/renderNumberedList's callers in render())
  // stamps every rendered <li> with the source line's own index into
  // text.split('\n') — using lineIndices, not the item's position within the
  // list, so a list that starts mid-note still points at the right line. A
  // checkbox item ends up with data-line on both its <li> and its <input>;
  // harmless (same index either way) and keeps the checkbox tick handler's
  // own data-line read on the <input> working unchanged.
  function renderBulletList(lines, lineIndices, options) {
    const taskLists = !!(options && options.taskLists);
    const lineAnchors = !!(options && options.lineAnchors);
    const items = lines.map((l, idx) => {
      const content = l.replace(/^- /, '');
      const lineIndex = lineIndices ? lineIndices[idx] : idx;
      const liAttr = lineAnchors ? ` data-line="${lineIndex}"` : '';
      const m = taskLists ? TASK_MARKER.exec(content) : null;
      if (m) {
        const checked = /x/i.test(m[1]);
        return `<li${liAttr}><input type="checkbox" data-line="${lineIndex}"${checked ? ' checked' : ''}> ${processInline(m[2])}</li>`;
      }
      return `<li${liAttr}>${processInline(content)}</li>`;
    }).join('');
    return `<ul class="jt-md-ul">${items}</ul>`;
  }

  function renderNumberedList(lines, lineIndices, options) {
    const lineAnchors = !!(options && options.lineAnchors);
    const first = /^(\d+)\. /.exec(lines[0]);
    const start = first ? first[1] : '1';
    const items = lines.map((l, idx) => {
      const lineIndex = lineIndices ? lineIndices[idx] : idx;
      const liAttr = lineAnchors ? ` data-line="${lineIndex}"` : '';
      return `<li${liAttr}>${processInline(l.replace(/^\d+\. /, ''))}</li>`;
    }).join('');
    return `<ol class="jt-md-ol" start="${escAttr(start)}">${items}</ol>`;
  }

  // --- Line classifiers ------------------------------------------------------

  function isBlockquote(line) {
    return /^>/.test(line);
  }

  function isTableRow(line) {
    const t = line.trim();
    return t.length >= 2 && t.startsWith('|') && t.endsWith('|');
  }

  function isBullet(line) {
    return /^- /.test(line);
  }

  function isNumbered(line) {
    return /^\d+\. /.test(line);
  }

  // --- Entry point -----------------------------------------------------------

  // Multi-line block constructs, each grouping consecutive matching lines.
  // These are recognised on the raw line — they carry no prefix pipeline.
  const BLOCKS = [
    { match: isBlockquote, build: renderBlockquote },
    { match: isTableRow, build: renderTable }
  ];

  // Lists are recognised on the line *after* its prefixes are consumed, so
  // "[!color:red] - item" is a bulleted item inside a red wrapper rather than
  // literal "- item" text.
  const LIST_BLOCKS = [
    { match: isBullet, build: renderBulletList },
    { match: isNumbered, build: renderNumberedList }
  ];

  function render(text, options) {
    if (text === null || text === undefined || text === '') return '';

    const lines = String(text).split('\n').map((l) => l.replace(/\r$/, ''));
    const out = [];
    let i = 0;

    while (i < lines.length) {
      const line = lines[i];

      if (line === '---') {
        out.push('<hr class="jt-md-hr">');
        i++;
        continue;
      }

      const block = BLOCKS.find((b) => b.match(line));
      if (block) {
        const group = [];
        while (i < lines.length && block.match(lines[i])) group.push(lines[i++]);
        out.push(block.build(group));
        continue;
      }

      const head = consumePrefixes(line);
      const list = head.icon === null && LIST_BLOCKS.find((b) => b.match(head.rest));
      if (list) {
        const key = wrapperKey(head.wrappers);
        const group = [];
        const groupLineIndices = [];
        while (i < lines.length) {
          const p = consumePrefixes(lines[i]);
          if (p.icon !== null || !list.match(p.rest) || wrapperKey(p.wrappers) !== key) break;
          group.push(p.rest);
          groupLineIndices.push(i);
          i++;
        }
        out.push(applyWrappers(head.wrappers, list.build(group, groupLineIndices, options)));
        continue;
      }

      out.push(renderLine(line, i, options));
      i++;
    }

    return out.join('');
  }

  return { render };
})();

// Export for use in the content script and other feature modules.
if (typeof window !== 'undefined') {
  window.JTMarkdown = JTMarkdown;
}

// Export for Node / test environments.
if (typeof module !== 'undefined' && module.exports) {
  module.exports = JTMarkdown;
}
