// Formatter Formats Module
// Handles format application and removal logic

const FormatterFormats = (() => {
  // Flag to prevent MutationObserver interference during text insertion
  let isInsertingText = false;
  // Flag to prevent blur handlers from hiding toolbar during prompts
  let isPromptingUser = false;

  /**
   * Get insertion lock status
   * @returns {boolean} True if text insertion is in progress
   */
  function isInserting() {
    return isInsertingText;
  }

  /**
   * Get prompting status
   * @returns {boolean} True if user is being prompted
   */
  function isPrompting() {
    return isPromptingUser;
  }

  /**
   * Collect alert data from user using the alert modal
   * @param {HTMLTextAreaElement} field - The textarea field to restore focus to
   * @returns {Promise<Object|null>} Alert data or null if cancelled
   */
  async function collectAlertData(field) {
    isPromptingUser = true;

    try {
      // Use the AlertModal if available, fallback to prompts
      if (window.AlertModal && window.AlertModal.show) {
        const result = await window.AlertModal.show();
        return result;
      }

      // Fallback to prompts if modal not available
      const alertColor = prompt('Alert color (red, yellow, blue, green, orange, purple):', 'blue');
      if (!alertColor) return null;

      const alertIcon = prompt('Alert icon (octogonAlert, exclamationTriangle, infoCircle, checkCircle):', 'infoCircle');
      if (!alertIcon) return null;

      const alertSubject = prompt('Alert subject:', 'Important');
      if (!alertSubject) return null;

      const alertBody = prompt('Alert body text:', 'Your alert message here.');
      if (!alertBody) return null;

      return { alertColor, alertIcon, alertSubject, alertBody };
    } finally {
      // Always unlock prompting, even if user cancels
      isPromptingUser = false;
    }
  }

  /**
   * Dispatch events immediately - for cases where React clears value during delays
   * @param {HTMLTextAreaElement} field - The textarea field
   * @param {number|null} cursorPos - Cursor position to set (or selection start)
   * @param {number|null} selectionEnd - Selection end position (if different from cursorPos)
   */
  function dispatchReactSafeEventImmediate(field, cursorPos = null, selectionEnd = null) {
    try {
      // Set cursor/selection position first
      if (cursorPos !== null) {
        const endPos = selectionEnd !== null ? selectionEnd : cursorPos;
        field.setSelectionRange(cursorPos, endPos);
      }

      // Dispatch input event IMMEDIATELY (synchronously)
      const inputEvent = new InputEvent('input', {
        bubbles: true,
        cancelable: false,
        composed: true,
        data: null,
        dataTransfer: null,
        inputType: 'insertText',
        isComposing: false
      });

      field.dispatchEvent(inputEvent);

      // Dispatch change event immediately too
      const changeEvent = new Event('change', {
        bubbles: true,
        cancelable: false
      });
      field.dispatchEvent(changeEvent);

      // Unlock after a small delay to ensure React has processed the events
      setTimeout(() => {
        isInsertingText = false;
      }, 100);
    } catch (error) {
      console.error('Formatter: Event dispatch error:', error);
      isInsertingText = false;
    }
  }

  /**
   * Remove a format from the field
   * @param {HTMLTextAreaElement} field - The textarea field
   * @param {string} format - The format to remove
   * @param {Object} options - Additional options
   */
  function removeFormat(field, format, options = {}) {
    const start = field.selectionStart;
    const end = field.selectionEnd;
    const text = field.value;
    const hasSelection = start !== end;

    let newText;
    let newCursorPos;
    let newSelectionEnd;

    // Get line boundaries
    const lineStart = text.lastIndexOf('\n', start - 1) + 1;
    const lineEnd = text.indexOf('\n', end);
    const lineEndPos = lineEnd === -1 ? text.length : lineEnd;
    const lineText = text.substring(lineStart, lineEndPos);

    switch(format) {
      case 'bold':
      case 'italic':
      case 'underline':
      case 'strikethrough':
        const markerMap = {
          'bold': '*',
          'italic': '^',
          'underline': '_',
          'strikethrough': '~'
        };
        const marker = markerMap[format];

        if (hasSelection) {
          // Check if selection is exactly wrapped by markers
          const before = text.substring(0, start);
          const after = text.substring(end);

          if (before.endsWith(marker) && after.startsWith(marker)) {
            // Remove the wrapping markers
            newText = before.slice(0, -1) + text.substring(start, end) + after.slice(1);
            newCursorPos = start - 1;
            newSelectionEnd = end - 1;
          } else {
            // Selection is inside formatted text or contains markers
            // Find the enclosing format markers on the current line
            const relStart = start - lineStart;
            const relEnd = end - lineStart;
            const pair = findEnclosingPair(lineText, relStart, marker);

            if (pair && relEnd <= pair.close) {
              // Selection is inside this format pair - remove the enclosing markers
              const beforeLine = text.substring(0, lineStart);
              const afterLine = text.substring(lineEndPos);
              const newLineText = lineText.substring(0, pair.open) +
                                 lineText.substring(pair.open + 1, pair.close) +
                                 lineText.substring(pair.close + 1);
              newText = beforeLine + newLineText + afterLine;

              // Adjust positions (one marker removed before selection)
              newCursorPos = start - 1;
              newSelectionEnd = end - 1;
            } else {
              // Selection contains markers, remove them from inside
              const selection = text.substring(start, end);
              const cleaned = selection.split(marker).join('');
              newText = before + cleaned + after;
              newCursorPos = start;
              newSelectionEnd = start + cleaned.length;
            }
          }
        } else {
          // No selection - find the enclosing format markers on the current line
          const relPos = start - lineStart;
          const pair = findEnclosingPair(lineText, relPos, marker);

          if (pair) {
            // Remove the markers
            const beforeLine = text.substring(0, lineStart);
            const afterLine = text.substring(lineEndPos);
            const newLineText = lineText.substring(0, pair.open) +
                               lineText.substring(pair.open + 1, pair.close) +
                               lineText.substring(pair.close + 1);
            newText = beforeLine + newLineText + afterLine;

            // Adjust cursor position (one marker removed before cursor)
            newCursorPos = start - 1;
          } else {
            return; // No format found to remove
          }
        }
        break;

      case 'color':
        // Match color tag at the beginning of the line
        const colorMatch = lineText.match(/^\[!color:\w+\]\s*/);
        if (colorMatch) {
          const beforeLine = text.substring(0, lineStart);
          const afterMatch = text.substring(lineStart + colorMatch[0].length);
          newText = beforeLine + afterMatch;
          newCursorPos = Math.max(lineStart, start - colorMatch[0].length);
        } else {
          return; // No color tag found
        }
        break;

      case 'justify-center':
      case 'justify-right':
        const justifyMatch = lineText.match(/^(-:-|--:)\s*/);
        if (justifyMatch) {
          const beforeLine = text.substring(0, lineStart);
          const afterMatch = text.substring(lineStart + justifyMatch[0].length);
          newText = beforeLine + afterMatch;
          newCursorPos = lineStart;
        } else {
          return; // No justify tag found
        }
        break;

      default:
        return;
    }

    // Update field value using native setter to avoid React state issues
    isInsertingText = true;
    const nativeInputValueSetter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value').set;
    nativeInputValueSetter.call(field, newText);

    // Dispatch events immediately with proper selection preservation
    dispatchReactSafeEventImmediate(field, newCursorPos, newSelectionEnd);
  }

  /**
   * Find the marker pair that encloses the given position
   * @param {string} line - Line text
   * @param {number} pos - Position within the line
   * @param {string} marker - Marker character
   * @returns {Object|null} {open, close} or null if not found
   */
  function findEnclosingPair(line, pos, marker) {
    let i = 0;

    while (i < line.length) {
      if (line[i] === marker) {
        const openPos = i;
        let closePos = -1;

        // Look for closing marker
        for (let j = i + 1; j < line.length; j++) {
          if (line[j] === marker) {
            closePos = j;
            break;
          }
        }

        if (closePos !== -1) {
          // Check if position is inside this pair
          if (pos > openPos && pos <= closePos) {
            return { open: openPos, close: closePos };
          }
          i = closePos + 1;
        } else {
          i++;
        }
      } else {
        i++;
      }
    }

    return null;
  }

  /**
   * Handle alert format insertion (async due to modal)
   * @param {HTMLTextAreaElement} field - The textarea field
   * @param {number} start - Selection start
   * @param {number} end - Selection end
   * @param {string} text - Full text content
   * @param {string} before - Text before selection
   * @param {string} after - Text after selection
   */
  async function handleAlertFormat(field, start, end, text, before, after) {
    const alertData = await collectAlertData(field);
    if (!alertData) {
      // User cancelled - restore focus
      if (field && document.body.contains(field)) {
        field.focus();
      }
      return;
    }

    // Restore focus after modal closes
    if (field && document.body.contains(field)) {
      field.focus();
    } else {
      console.error('Formatter: Field is not in DOM after alert modal!');
      return;
    }

    const replacement = `> [!color:${alertData.alertColor}] ### [!icon:${alertData.alertIcon}] ${alertData.alertSubject}\n> ${alertData.alertBody}`;
    const cursorPos = start + replacement.length;

    // Update field value using native setter to avoid React state issues
    isInsertingText = true;

    const nativeInputValueSetter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value').set;
    const newValue = before + replacement + after;
    nativeInputValueSetter.call(field, newValue);

    // Dispatch events IMMEDIATELY - React will clear value if we delay!
    dispatchReactSafeEventImmediate(field, cursorPos);
  }

  /**
   * Apply a format to the field
   * @param {HTMLTextAreaElement} field - The textarea field
   * @param {string} format - The format to apply
   * @param {Object} options - Additional options (e.g., color)
   */
  function applyFormat(field, format, options = {}) {
    const start = field.selectionStart;
    const end = field.selectionEnd;
    const text = field.value;
    const selection = text.substring(start, end);
    const hasSelection = selection.length > 0;

    // Check if format is already active
    const activeFormats = window.FormatterDetection.detectActiveFormats(field);

    // Toggle logic for inline formats
    if (['bold', 'italic', 'underline', 'strikethrough'].includes(format)) {
      if (activeFormats[format]) {
        removeFormat(field, format);
        return;
      }
    }

    // Toggle logic for colors
    if (format === 'color' && activeFormats.color === options.color) {
      removeFormat(field, 'color');
      return;
    }

    // Toggle logic for justify
    if (format === 'justify-center' && activeFormats['justify-center']) {
      removeFormat(field, format);
      return;
    }
    if (format === 'justify-right' && activeFormats['justify-right']) {
      removeFormat(field, format);
      return;
    }

    // Apply format logic
    let before = text.substring(0, start);
    let after = text.substring(end);
    let replacement;
    let cursorPos;

    switch(format) {
      case 'bold':
        replacement = hasSelection ? `*${selection}*` : '**';
        cursorPos = hasSelection ? start + replacement.length : start + 1;
        break;

      case 'italic':
        replacement = hasSelection ? `^${selection}^` : '^^';
        cursorPos = hasSelection ? start + replacement.length : start + 1;
        break;

      case 'underline':
        replacement = hasSelection ? `_${selection}_` : '__';
        cursorPos = hasSelection ? start + replacement.length : start + 1;
        break;

      case 'strikethrough':
        replacement = hasSelection ? `~${selection}~` : '~~';
        cursorPos = hasSelection ? start + replacement.length : start + 1;
        break;

      case 'h1':
        const lineStart = before.lastIndexOf('\n') + 1;
        before = text.substring(0, lineStart);
        after = text.substring(lineStart);
        replacement = `# ${after}`;
        cursorPos = lineStart + 2;
        after = '';
        break;

      case 'h2':
        const lineStart2 = before.lastIndexOf('\n') + 1;
        before = text.substring(0, lineStart2);
        after = text.substring(lineStart2);
        replacement = `## ${after}`;
        cursorPos = lineStart2 + 3;
        after = '';
        break;

      case 'h3':
        const lineStart3 = before.lastIndexOf('\n') + 1;
        before = text.substring(0, lineStart3);
        after = text.substring(lineStart3);
        replacement = `### ${after}`;
        cursorPos = lineStart3 + 4;
        after = '';
        break;

      case 'h4':
        const lineStart4 = before.lastIndexOf('\n') + 1;
        before = text.substring(0, lineStart4);
        after = text.substring(lineStart4);
        replacement = `#### ${after}`;
        cursorPos = lineStart4 + 5;
        after = '';
        break;

      case 'bullet':
        if (hasSelection) {
          replacement = selection.split('\n').map(line => `- ${line}`).join('\n');
        } else {
          replacement = '- ';
        }
        cursorPos = hasSelection ? start + replacement.length : start + 2;
        break;

      case 'numbered':
        if (hasSelection) {
          replacement = selection.split('\n').map((line, i) => `${i+1}. ${line}`).join('\n');
        } else {
          replacement = '1. ';
        }
        cursorPos = hasSelection ? start + replacement.length : start + 3;
        break;

      case 'quote':
        const quoteLineStart = before.lastIndexOf('\n') + 1;
        before = text.substring(0, quoteLineStart);
        const afterQuote = text.substring(quoteLineStart);
        replacement = `> ${afterQuote}`;
        cursorPos = quoteLineStart + 2;
        after = '';
        break;

      case 'table':
        isPromptingUser = true;
        const cols = prompt('Number of columns:', '3');
        if (!cols || isNaN(cols) || cols < 1) {
          isPromptingUser = false;
          return;
        }
        const rows = prompt('Number of rows (including header):', '3');
        isPromptingUser = false;

        if (!rows || isNaN(rows) || rows < 2) {
          return;
        }

        const numCols = parseInt(cols);
        const numRows = parseInt(rows);

        // Create table
        const table = [];

        // Header row
        const headers = Array(numCols).fill('Header').map((h, i) => i === 0 ? h : h + (i + 1));
        table.push('| ' + headers.join(' | ') + ' |');

        // Data rows (no separator row for JobTread compatibility)
        for (let i = 1; i < numRows; i++) {
          const cells = Array(numCols).fill('Data');
          table.push('| ' + cells.join(' | ') + ' |');
        }

        replacement = '\n' + table.join('\n') + '\n';
        cursorPos = start + 3; // Position cursor in first header cell
        break;

      case 'justify-left':
        const leftLineStart = before.lastIndexOf('\n') + 1;
        before = text.substring(0, leftLineStart);
        let afterLeft = text.substring(leftLineStart);
        afterLeft = afterLeft.replace(/^(-:-|--:)\s*/, '');
        replacement = afterLeft;
        cursorPos = leftLineStart;
        after = '';
        break;

      case 'justify-center':
        const centerLineStart = before.lastIndexOf('\n') + 1;
        before = text.substring(0, centerLineStart);
        let afterCenter = text.substring(centerLineStart);
        afterCenter = afterCenter.replace(/^(-:-|--:)\s*/, '');
        replacement = `-:- ${afterCenter}`;
        cursorPos = centerLineStart + 4;
        after = '';
        break;

      case 'justify-right':
        const rightLineStart = before.lastIndexOf('\n') + 1;
        before = text.substring(0, rightLineStart);
        let afterRight = text.substring(rightLineStart);
        afterRight = afterRight.replace(/^(-:-|--:)\s*/, '');
        replacement = `--: ${afterRight}`;
        cursorPos = rightLineStart + 4;
        after = '';
        break;

      case 'link':
        isPromptingUser = true;
        const url = prompt('Enter URL:', 'https://');
        isPromptingUser = false;

        if (!url) {
          return;
        }

        replacement = `[${hasSelection ? selection : 'link text'}](${url})`;
        cursorPos = hasSelection ? start + replacement.length : start + 1;
        break;

      case 'color':
        const color = options.color;
        const cLineStart = before.lastIndexOf('\n') + 1;
        const cLineEnd = text.indexOf('\n', start);
        const lineEndPos = cLineEnd === -1 ? text.length : cLineEnd;

        // Check the FULL line for existing color (not just before cursor)
        const fullLine = text.substring(cLineStart, lineEndPos);
        const existingColorMatch = fullLine.match(/^\[!color:(\w+)\]\s*/);

        if (existingColorMatch) {
          // Found existing color formatting on this line
          const colorTagEnd = cLineStart + existingColorMatch[0].length;

          // Extract the text after the color tag (excluding the tag itself)
          const existingText = text.substring(colorTagEnd, lineEndPos).trim();

          // Determine what text to use
          let textToUse;
          if (hasSelection) {
            // User has selection, use that
            textToUse = selection;
          } else if (existingText) {
            // Reuse existing content
            textToUse = existingText;
          } else {
            // No content, use placeholder
            textToUse = 'text';
          }

          // Replace the entire line with new color (or remove if same color being toggled)
          before = text.substring(0, cLineStart);
          replacement = `[!color:${color}] ${textToUse}`;
          after = text.substring(lineEndPos);
        } else {
          // No existing color on this line - add new color
          if (hasSelection) {
            replacement = `[!color:${color}] ${selection}`;
          } else {
            // Check if cursor is on a line with content
            const lineText = fullLine.trim();

            if (lineText.length > 0) {
              // There's content on this line, add color tag at start
              replacement = `[!color:${color}] ${lineText}`;
              before = text.substring(0, cLineStart);
              after = text.substring(lineEndPos);
            } else {
              // Empty line, use placeholder
              replacement = `[!color:${color}] text`;
            }
          }
        }
        cursorPos = before.length + `[!color:${color}] `.length;
        break;

      case 'alert':
        // Alert uses async modal - handle separately
        handleAlertFormat(field, start, end, text, before, after);
        return; // Exit early - handleAlertFormat will complete the operation

      case 'hr':
        replacement = '\n---\n';
        cursorPos = start + replacement.length;
        break;

      default:
        return;
    }

    // Update field value using native setter to avoid React state issues
    // Lock to prevent MutationObserver from interfering
    isInsertingText = true;

    const nativeInputValueSetter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value').set;
    const newValue = before + replacement + after;
    nativeInputValueSetter.call(field, newValue);

    // Dispatch events IMMEDIATELY - React will clear value if we delay!
    dispatchReactSafeEventImmediate(field, cursorPos);
  }

  /**
   * Handle Enter key for smart auto-numbering
   * @param {HTMLTextAreaElement} field - The textarea field
   * @param {KeyboardEvent} e - The keyboard event
   * @returns {boolean} True if handled
   */
  function handleEnterKey(field, e) {
    const start = field.selectionStart;
    const text = field.value;

    // Find the current line
    const lineStart = text.lastIndexOf('\n', start - 1) + 1;
    const lineEnd = text.indexOf('\n', start);
    const currentLine = text.substring(lineStart, lineEnd === -1 ? text.length : lineEnd);

    // Check if current line is a numbered list item (e.g., "1. ", "2. Some text")
    const numberedListMatch = currentLine.match(/^(\d+)\.\s+(.*)$/);

    if (numberedListMatch) {
      e.preventDefault();

      const currentNumber = parseInt(numberedListMatch[1]);
      const lineContent = numberedListMatch[2];

      // If the line is empty (just the number), exit list mode
      let newValue;
      let newCursorPos;
      if (lineContent.trim() === '') {
        // Remove the empty list item and exit
        const before = text.substring(0, lineStart);
        const after = text.substring(lineEnd === -1 ? text.length : lineEnd);
        newValue = before + after;
        newCursorPos = lineStart;
      } else {
        // Insert next number on new line
        const nextNumber = currentNumber + 1;
        const before = text.substring(0, start);
        const after = text.substring(start);

        const newText = `\n${nextNumber}. `;
        newValue = before + newText + after;
        newCursorPos = start + newText.length;
      }

      // Set the new value via the native setter ONLY. Do NOT assign field.value
      // first — that runs React's instance-level setter and updates its
      // _valueTracker, after which the dispatched 'input' event looks unchanged
      // and React silently drops the edit (list continuation lost on save).
      const nativeInputValueSetter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value').set;
      nativeInputValueSetter.call(field, newValue);
      field.setSelectionRange(newCursorPos, newCursorPos);

      // Dispatch only input event (not change to avoid breaking React state)
      const inputEvent = new Event('input', { bubbles: true });
      field.dispatchEvent(inputEvent);

      return true; // Handled
    }

    // Check for bullet lists too
    const bulletListMatch = currentLine.match(/^-\s+(.*)$/);

    if (bulletListMatch) {
      e.preventDefault();

      const lineContent = bulletListMatch[1];

      // If the line is empty (just the bullet), exit list mode
      let newValue;
      let newCursorPos;
      if (lineContent.trim() === '') {
        // Remove the empty list item and exit
        const before = text.substring(0, lineStart);
        const after = text.substring(lineEnd === -1 ? text.length : lineEnd);
        newValue = before + after;
        newCursorPos = lineStart;
      } else {
        // Insert new bullet on new line
        const before = text.substring(0, start);
        const after = text.substring(start);

        const newText = `\n- `;
        newValue = before + newText + after;
        newCursorPos = start + newText.length;
      }

      // Set the new value via the native setter ONLY (see numbered-list note above):
      // assigning field.value first updates React's _valueTracker and the edit is dropped.
      const nativeInputValueSetter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value').set;
      nativeInputValueSetter.call(field, newValue);
      field.setSelectionRange(newCursorPos, newCursorPos);

      // Dispatch only input event (not change to avoid breaking React state)
      const inputEvent = new Event('input', { bubbles: true });
      field.dispatchEvent(inputEvent);

      return true; // Handled
    }

    return false; // Not handled, allow default Enter behavior
  }

  // Public API
  return {
    applyFormat,
    removeFormat,
    handleEnterKey,
    collectAlertData,
    isInserting,
    isPrompting
  };
})();

// Export to window
if (typeof window !== 'undefined') {
  window.FormatterFormats = FormatterFormats;
}
