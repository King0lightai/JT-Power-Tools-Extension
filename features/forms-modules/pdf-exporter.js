/**
 * Forms PDF Exporter
 *
 * Builds a paginated PDF of a filled form (schema + data + signatures) using
 * jsPDF. The PDF is returned as base64 so the orchestrator can hand it to
 * the Worker upload-proxy endpoint, which forwards it into JobTread Files
 * via the existing files-write helper.
 *
 * jsPDF is bundled in content_scripts (see manifest.json) — the constructor
 * lives at window.jspdf.jsPDF when the script registers. We grab it lazily
 * so a missing/broken vendor file fails fast with a clear error instead of
 * silently producing nothing.
 *
 * Page layout: 8.5 × 11 in (US Letter), 0.5 in margins. Field cards stack
 * vertically with adaptive heights; signatures embed at 4 × 1.4 in max.
 */
const FormsPdfExporter = (() => {
  const PAGE_WIDTH = 8.5;
  const PAGE_HEIGHT = 11;
  const MARGIN_X = 0.5;
  const MARGIN_TOP = 0.5;
  const MARGIN_BOTTOM = 0.5;
  const CONTENT_WIDTH = PAGE_WIDTH - MARGIN_X * 2;
  const SIG_MAX_W = 4.0;
  const SIG_MAX_H = 1.4;

  // Font sizes (in pt)
  const FS_TITLE = 16;
  const FS_META = 10;
  const FS_SECTION = 13;
  const FS_LABEL = 11;
  const FS_VALUE = 11;

  // Vertical spacing (in inches)
  const SP_AFTER_TITLE = 0.30;
  const SP_AFTER_SECTION = 0.10;
  const SP_AFTER_LABEL = 0.06;
  const SP_AFTER_VALUE = 0.18;
  const LINE_HEIGHT = 0.18;

  function getJsPDF() {
    if (typeof window.jspdf === 'object' && window.jspdf && typeof window.jspdf.jsPDF === 'function') {
      return window.jspdf.jsPDF;
    }
    if (typeof window.jsPDF === 'function') return window.jsPDF;
    throw new Error('jsPDF not loaded — check manifest content_scripts');
  }

  // ─── Layout helpers ───

  function ensureSpace(doc, cursor, neededInches) {
    if (cursor.y + neededInches > PAGE_HEIGHT - MARGIN_BOTTOM) {
      doc.addPage();
      cursor.y = MARGIN_TOP;
    }
  }

  function writeWrappedText(doc, text, x, y, maxWidth, lineHeight) {
    const lines = doc.splitTextToSize(String(text || ''), maxWidth);
    lines.forEach((ln, i) => {
      doc.text(ln, x, y + i * lineHeight);
    });
    return lines.length * lineHeight;
  }

  function findOption(field, optionValue) {
    if (!Array.isArray(field.options)) return null;
    for (const o of field.options) {
      if (o && o.value === optionValue) return o;
    }
    return null;
  }

  function selectionLines(field, value) {
    if (!value || typeof value !== 'object') return [];
    const sels = Array.isArray(value.selections) ? value.selections : [];
    const fills = (value.fills && typeof value.fills === 'object') ? value.fills : {};
    return sels.map(sel => {
      const opt = findOption(field, sel);
      const optLabel = opt && opt.label ? opt.label : sel;
      const fill = typeof fills[sel] === 'string' && fills[sel] ? '  —  ' + fills[sel] : '';
      return '• ' + optLabel + fill;
    });
  }

  // ─── Per-type renderers — each returns the new cursor.y after rendering ───

  function renderSection(doc, field, cursor) {
    ensureSpace(doc, cursor, 0.5);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(FS_SECTION);
    const num = (typeof field.number === 'number' && Number.isFinite(field.number))
      ? field.number + '. ' : '';
    const text = num + (field.label || '');
    const used = writeWrappedText(doc, text, MARGIN_X, cursor.y + 0.16, CONTENT_WIDTH, LINE_HEIGHT * 1.2);
    cursor.y += 0.16 + used + SP_AFTER_SECTION;
  }

  function renderLabelledValue(doc, field, valueText, cursor) {
    // Estimate height: label (1 line) + value (wrapped lines)
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(FS_LABEL);
    const labelText = (field.label || '') + (field.required ? ' *' : '');
    ensureSpace(doc, cursor, 0.6);
    const labelUsed = writeWrappedText(doc, labelText, MARGIN_X, cursor.y + 0.14, CONTENT_WIDTH, LINE_HEIGHT);
    cursor.y += 0.14 + labelUsed + SP_AFTER_LABEL;

    doc.setFont('helvetica', 'normal');
    doc.setFontSize(FS_VALUE);
    const text = (valueText && valueText.length > 0) ? valueText : '—';
    ensureSpace(doc, cursor, LINE_HEIGHT * 2);
    const valUsed = writeWrappedText(doc, text, MARGIN_X, cursor.y, CONTENT_WIDTH, LINE_HEIGHT);
    cursor.y += valUsed + SP_AFTER_VALUE;
  }

  function renderLabelledLines(doc, field, lines, cursor) {
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(FS_LABEL);
    const labelText = (field.label || '') + (field.required ? ' *' : '');
    ensureSpace(doc, cursor, 0.6);
    const labelUsed = writeWrappedText(doc, labelText, MARGIN_X, cursor.y + 0.14, CONTENT_WIDTH, LINE_HEIGHT);
    cursor.y += 0.14 + labelUsed + SP_AFTER_LABEL;

    doc.setFont('helvetica', 'normal');
    doc.setFontSize(FS_VALUE);
    if (!lines || lines.length === 0) {
      ensureSpace(doc, cursor, LINE_HEIGHT * 2);
      doc.text('—', MARGIN_X, cursor.y);
      cursor.y += LINE_HEIGHT + SP_AFTER_VALUE;
      return;
    }
    for (const ln of lines) {
      ensureSpace(doc, cursor, LINE_HEIGHT * 2);
      const used = writeWrappedText(doc, ln, MARGIN_X, cursor.y, CONTENT_WIDTH, LINE_HEIGHT);
      cursor.y += used;
    }
    cursor.y += SP_AFTER_VALUE - LINE_HEIGHT;
  }

  function renderSignature(doc, field, value, cursor) {
    // Label
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(FS_LABEL);
    const labelText = (field.label || 'Signature') + (field.required ? ' *' : '');
    ensureSpace(doc, cursor, SIG_MAX_H + 0.5);
    const labelUsed = writeWrappedText(doc, labelText, MARGIN_X, cursor.y + 0.14, CONTENT_WIDTH, LINE_HEIGHT);
    cursor.y += 0.14 + labelUsed + SP_AFTER_LABEL;

    // Require a data:image/ URL — never pass an arbitrary (e.g. tampered
    // https://) URL to addImage, which would trigger an outbound fetch (FRM-1).
    if (!value || typeof value !== 'object' || typeof value.dataUrl !== 'string' || !/^data:image\//.test(value.dataUrl)) {
      // Empty signature slot — render an underline so a printed-and-rescanned
      // workflow still shows the user where to sign.
      ensureSpace(doc, cursor, 0.6);
      doc.setDrawColor(0);
      doc.line(MARGIN_X, cursor.y + 0.5, MARGIN_X + SIG_MAX_W, cursor.y + 0.5);
      cursor.y += 0.6 + SP_AFTER_VALUE;
      return;
    }

    try {
      doc.addImage(value.dataUrl, 'PNG', MARGIN_X, cursor.y, SIG_MAX_W, SIG_MAX_H, undefined, 'FAST');
    } catch (err) {
      console.warn('FormsPdfExporter: failed to embed signature image', err);
    }
    // Underline beneath the signature — mirrors the print stylesheet.
    doc.setDrawColor(0);
    doc.line(MARGIN_X, cursor.y + SIG_MAX_H + 0.04, MARGIN_X + SIG_MAX_W, cursor.y + SIG_MAX_H + 0.04);
    cursor.y += SIG_MAX_H + 0.10;

    // Signed-at metadata
    if (typeof value.signedAt === 'string') {
      const d = new Date(value.signedAt);
      if (!Number.isNaN(d.getTime())) {
        doc.setFont('helvetica', 'normal');
        doc.setFontSize(FS_META);
        doc.text('Signed ' + d.toLocaleString(), MARGIN_X, cursor.y);
        cursor.y += LINE_HEIGHT;
      }
    }
    cursor.y += SP_AFTER_VALUE;
  }

  // ─── Public API ───

  /**
   * Build a PDF from a schema + filled data, plus job/template context.
   * Returns an object { base64, byteLength } where base64 is the raw PDF
   * payload (no data: prefix) ready to ship to the upload-proxy endpoint.
   *
   * @param {Object} args
   * @param {Object} args.schema           - { fields: [...] }
   * @param {Object} args.data             - { [fieldId]: value }
   * @param {Object} args.template         - { name, description? }
   * @param {Object} args.job              - { jobId, jobName? }
   * @param {Date}   [args.generatedAt]    - defaults to now
   */
  function buildPdf({ schema, data, template, job, generatedAt }) {
    const JsPDFCtor = getJsPDF();
    const doc = new JsPDFCtor({ unit: 'in', format: 'letter', compress: true });

    const cursor = { y: MARGIN_TOP };
    const at = generatedAt instanceof Date ? generatedAt : new Date();

    // Title
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(FS_TITLE);
    const title = (template && template.name) ? template.name : 'Form';
    const titleUsed = writeWrappedText(doc, title, MARGIN_X, cursor.y + 0.20, CONTENT_WIDTH, LINE_HEIGHT * 1.4);
    cursor.y += 0.20 + titleUsed;

    // Meta
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(FS_META);
    const metaParts = [];
    if (job && job.jobId) metaParts.push('Job: ' + (job.jobName || job.jobId));
    metaParts.push('Generated: ' + at.toLocaleString());
    doc.text(metaParts.join('     '), MARGIN_X, cursor.y);
    cursor.y += SP_AFTER_TITLE;

    // Divider
    doc.setDrawColor(180);
    doc.line(MARGIN_X, cursor.y, MARGIN_X + CONTENT_WIDTH, cursor.y);
    cursor.y += 0.18;

    // Fields
    const fields = (schema && Array.isArray(schema.fields)) ? schema.fields : [];
    const dataMap = (data && typeof data === 'object') ? data : {};

    for (const field of fields) {
      if (!field || !field.id || !field.type) continue;
      const value = dataMap[field.id];

      switch (field.type) {
        case 'section':
          renderSection(doc, field, cursor);
          break;
        case 'text_short':
        case 'text_long':
          renderLabelledValue(doc, field, typeof value === 'string' ? value : '', cursor);
          break;
        case 'checkboxes':
        case 'radio':
          renderLabelledLines(doc, field, selectionLines(field, value), cursor);
          break;
        case 'date':
          renderLabelledValue(doc, field, typeof value === 'string' ? value : '', cursor);
          break;
        case 'signature':
          renderSignature(doc, field, value, cursor);
          break;
        default:
          renderLabelledValue(doc, field, '[unsupported field type: ' + field.type + ']', cursor);
      }
    }

    // jsPDF's `datauristring` returns a `data:application/pdf;filename=...;base64,...`
    // form. Strip everything before the comma to get raw base64.
    const dataUri = doc.output('datauristring');
    const commaIdx = dataUri.indexOf(',');
    const base64 = commaIdx >= 0 ? dataUri.slice(commaIdx + 1) : dataUri;
    return { base64, byteLength: Math.floor(base64.length * 3 / 4) };
  }

  /**
   * Build a filename suitable for JobTread Files. Avoids collisions across
   * repeated uploads of the same form by stamping the generated time into
   * the filename. JT's Files UI tolerates any filesystem-safe characters.
   */
  function buildFilename(template, generatedAt) {
    const at = generatedAt instanceof Date ? generatedAt : new Date();
    const stamp = at.toISOString().replace(/[:T.]/g, '-').slice(0, 19);
    const safeName = String((template && template.name) || 'Form')
      .replace(/[^a-z0-9 \-_]/gi, '')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 80);
    return safeName + ' — ' + stamp + '.pdf';
  }

  return { buildPdf, buildFilename };
})();

if (typeof window !== 'undefined') {
  window.FormsPdfExporter = FormsPdfExporter;
}
