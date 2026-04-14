/**
 * Quick Notes Editor Module
 * Handles WYSIWYG editing, formatting, and undo/redo
 *
 * Dependencies: quick-notes-modules/markdown.js (QuickNotesMarkdown)
 */

const QuickNotesEditor = (() => {
  // Undo/redo state
  let undoHistory = [];
  let redoHistory = [];
  let lastSavedContent = '';
  let historyTimeout = null;

  // Reference to markdown module
  const getMarkdown = () => window.QuickNotesMarkdown || {};

  /**
   * Reset history state for a new note
   * @param {string} initialContent - Initial content of the note
   */
  function resetHistory(initialContent = '') {
    undoHistory = [];
    redoHistory = [];
    lastSavedContent = initialContent;
    if (historyTimeout) {
      clearTimeout(historyTimeout);
      historyTimeout = null;
    }
  }

  /**
   * Add content to undo history
   * @param {string} content - Current content
   */
  function saveToHistory(content) {
    if (content !== lastSavedContent) {
      undoHistory.push(lastSavedContent);
      // Limit history to 50 entries
      if (undoHistory.length > 50) {
        undoHistory.shift();
      }
      redoHistory = []; // Clear redo history on new change
      lastSavedContent = content;
    }
  }

  /**
   * Undo last change
   * @param {HTMLElement} contentInput - Contenteditable element
   * @param {Function} onUpdate - Callback when content changes
   * @returns {boolean} Whether undo was performed
   */
  function undo(contentInput, onUpdate) {
    if (undoHistory.length > 0) {
      const previousContent = undoHistory.pop();
      redoHistory.push(lastSavedContent);
      lastSavedContent = previousContent;

      // Restore content
      const { parseMarkdownForEditor } = getMarkdown();
      if (parseMarkdownForEditor) {
        contentInput.innerHTML = parseMarkdownForEditor(previousContent);
      }

      // Notify about the change
      if (onUpdate) {
        onUpdate(previousContent);
      }

      return true;
    }
    return false;
  }

  /**
   * Redo last undone change
   * @param {HTMLElement} contentInput - Contenteditable element
   * @param {Function} onUpdate - Callback when content changes
   * @returns {boolean} Whether redo was performed
   */
  function redo(contentInput, onUpdate) {
    if (redoHistory.length > 0) {
      const nextContent = redoHistory.pop();
      undoHistory.push(lastSavedContent);
      lastSavedContent = nextContent;

      // Restore content
      const { parseMarkdownForEditor } = getMarkdown();
      if (parseMarkdownForEditor) {
        contentInput.innerHTML = parseMarkdownForEditor(nextContent);
      }

      // Notify about the change
      if (onUpdate) {
        onUpdate(nextContent);
      }

      return true;
    }
    return false;
  }

  /**
   * Update formatting button states based on selection
   * Uses document.queryCommandState for accurate state detection
   * @param {HTMLElement} contentInput - Contenteditable element
   * @param {HTMLElement} toolbar - The toolbar element to scope button queries
   */
  function updateFormattingButtons(contentInput, toolbar) {
    if (!contentInput || !toolbar) return;

    // Scope all queries to the Quick Notes toolbar only
    const formatButtons = toolbar.querySelectorAll('.jt-notes-format-btn');
    formatButtons.forEach(btn => btn.classList.remove('active'));

    // Use queryCommandState for accurate detection of formatting state
    // This works even when cursor is positioned but no text is selected
    try {
      if (document.queryCommandState('bold')) {
        const boldBtn = toolbar.querySelector('[data-format="bold"]');
        if (boldBtn) boldBtn.classList.add('active');
      }
      if (document.queryCommandState('italic')) {
        const italicBtn = toolbar.querySelector('[data-format="italic"]');
        if (italicBtn) italicBtn.classList.add('active');
      }
      if (document.queryCommandState('underline')) {
        const underlineBtn = toolbar.querySelector('[data-format="underline"]');
        if (underlineBtn) underlineBtn.classList.add('active');
      }
      if (document.queryCommandState('strikeThrough')) {
        const strikeBtn = toolbar.querySelector('[data-format="strikethrough"]');
        if (strikeBtn) strikeBtn.classList.add('active');
      }
    } catch (e) {
      // queryCommandState may throw in some browsers, fall back to DOM inspection
    }

    // Also check for links by traversing DOM (no queryCommandState for links)
    const selection = window.getSelection();
    if (selection.rangeCount) {
      let node = selection.anchorNode;
      while (node && node !== contentInput) {
        if (node.nodeType === Node.ELEMENT_NODE && node.tagName?.toLowerCase() === 'a') {
          const linkBtn = toolbar.querySelector('[data-format="link"]');
          if (linkBtn) linkBtn.classList.add('active');
          break;
        }
        node = node.parentNode;
      }
    }
  }

  /**
   * Normalize text nodes and clean up empty formatting elements
   * This fixes the "wall" issue where backspace can't cross formatting boundaries
   * @param {HTMLElement} element - The contenteditable element
   */
  function normalizeContent(element) {
    // First, normalize text nodes (merge adjacent text nodes)
    element.normalize();

    // Find and clean up empty formatting elements that create invisible walls
    const formattingTags = ['b', 'strong', 'i', 'em', 'u', 's', 'strike', 'del'];

    formattingTags.forEach(tag => {
      const elements = element.querySelectorAll(tag);
      elements.forEach(el => {
        // Remove completely empty formatting elements
        if (el.textContent === '' && !el.querySelector('*')) {
          el.remove();
        }
        // Also remove elements that only contain whitespace/zero-width chars
        else if (el.textContent.trim() === '' && el.textContent.length <= 1) {
          // Preserve the text content but remove the formatting wrapper
          const text = el.textContent;
          if (text) {
            const textNode = document.createTextNode(text);
            el.parentNode.replaceChild(textNode, el);
          } else {
            el.remove();
          }
        }
      });
    });

    // Normalize again after removals to merge text nodes
    element.normalize();
  }

  /**
   * Insert a zero-width space to help with cursor positioning when toggling formats
   * @param {Range} range - Current selection range
   * @returns {Text} The inserted text node
   */
  function insertCursorHelper(range) {
    // Insert a regular space instead of zero-width space to avoid wall issues
    const spaceNode = document.createTextNode(' ');
    range.insertNode(spaceNode);
    range.setStartAfter(spaceNode);
    range.setEndAfter(spaceNode);
    return spaceNode;
  }

  /**
   * Apply formatting to contenteditable (WYSIWYG)
   *
   * @param {HTMLElement} element - The contenteditable element
   * @param {string} formatType - The type of formatting to apply
   * @param {Function} onUpdate - Callback when content changes
   */
  function applyFormatting(element, formatType, onUpdate) {
    // Save current selection before any operations
    const selection = window.getSelection();
    let savedRange = null;
    if (selection.rangeCount > 0) {
      savedRange = selection.getRangeAt(0).cloneRange();
    }

    // Focus the element (this should preserve selection in most browsers)
    element.focus();

    // Restore selection if it was lost
    if (savedRange && selection.rangeCount === 0) {
      selection.removeAllRanges();
      selection.addRange(savedRange);
    }

    // Handle undo/redo using browser's native commands (more reliable)
    if (formatType === 'undo') {
      document.execCommand('undo', false, null);
      // Trigger input event to save changes
      element.dispatchEvent(new Event('input', { bubbles: true }));
      return;
    }

    if (formatType === 'redo') {
      document.execCommand('redo', false, null);
      // Trigger input event to save changes
      element.dispatchEvent(new Event('input', { bubbles: true }));
      return;
    }

    const { htmlToMarkdown } = getMarkdown();

    // Save to history before making changes (but NOT for undo/redo)
    if (htmlToMarkdown) {
      const currentContent = htmlToMarkdown(element);
      clearTimeout(historyTimeout);
      historyTimeout = setTimeout(() => {
        saveToHistory(currentContent);
      }, 500);
    }

    // Check if this is an inline formatting command with no selection (collapsed cursor)
    const isInlineFormat = ['bold', 'italic', 'underline', 'strikethrough'].includes(formatType);
    const hasNoSelection = selection.rangeCount > 0 && selection.getRangeAt(0).collapsed;

    // NOTE: execCommand is deprecated but still widely supported for contenteditable.
    switch (formatType) {
      case 'bold':
        document.execCommand('bold', false, null);
        break;

      case 'italic':
        document.execCommand('italic', false, null);
        break;

      case 'underline':
        document.execCommand('underline', false, null);
        break;

      case 'strikethrough':
        document.execCommand('strikeThrough', false, null);
        break;

      case 'link':
        handleLinkFormatting(element);
        break;

      case 'bullet':
        insertBulletItem(element);
        break;

      case 'checkbox':
        insertCheckboxItem(element);
        break;

      case 'numbered':
        insertNumberedItem(element);
        break;

      case 'table':
        insertTable(element);
        break;
    }

    // Clean up empty formatting elements after a short delay
    // This prevents the "wall" issue where backspace can't cross formatting boundaries
    if (isInlineFormat) {
      setTimeout(() => {
        normalizeContent(element);
      }, 10);
    }

    // Trigger input event to save changes
    element.dispatchEvent(new Event('input', { bubbles: true }));
  }

  /**
   * Handle backspace across formatting boundaries
   * This helps break through the "wall" between formatted and unformatted text
   * @param {KeyboardEvent} e - The keyboard event
   * @param {HTMLElement} contentInput - The contenteditable element
   * @returns {boolean} Whether the event was handled
   */
  function handleFormattingBoundaryBackspace(e, contentInput) {
    if (e.key !== 'Backspace') return false;

    const selection = window.getSelection();
    if (!selection.rangeCount) return false;

    const range = selection.getRangeAt(0);

    // Only handle collapsed selections (cursor, not a selection)
    if (!range.collapsed) return false;

    const node = range.startContainer;
    const offset = range.startOffset;

    // Check if we're at the start of a formatting element
    if (node.nodeType === Node.TEXT_NODE && offset === 0) {
      const parent = node.parentNode;
      const formattingTags = ['B', 'STRONG', 'I', 'EM', 'U', 'S', 'STRIKE', 'DEL'];

      if (parent && formattingTags.includes(parent.tagName)) {
        // We're at the beginning of a formatting element
        // Check if there's a previous sibling
        const prevSibling = parent.previousSibling;

        if (prevSibling) {
          e.preventDefault();

          if (prevSibling.nodeType === Node.TEXT_NODE) {
            // Delete the last character of the previous text node
            if (prevSibling.textContent.length > 0) {
              prevSibling.textContent = prevSibling.textContent.slice(0, -1);
            }
            // If the text node is now empty, remove it
            if (prevSibling.textContent === '') {
              prevSibling.remove();
            }
          } else if (prevSibling.nodeType === Node.ELEMENT_NODE) {
            // Previous sibling is an element - try to merge or delete last char
            if (prevSibling.textContent.length > 0) {
              // Find the last text node in the previous element
              const lastText = getLastTextNode(prevSibling);
              if (lastText && lastText.textContent.length > 0) {
                lastText.textContent = lastText.textContent.slice(0, -1);
              }
            }
            // Remove empty element
            if (prevSibling.textContent === '') {
              prevSibling.remove();
            }
          }

          // Normalize and position cursor
          contentInput.normalize();
          return true;
        }
      }
    }

    // Check if we're in an empty formatting element
    if (node.nodeType === Node.ELEMENT_NODE) {
      const formattingTags = ['B', 'STRONG', 'I', 'EM', 'U', 'S', 'STRIKE', 'DEL'];
      if (formattingTags.includes(node.tagName) && node.textContent === '') {
        e.preventDefault();
        const prevSibling = node.previousSibling;
        node.remove();

        // Position cursor at the end of the previous sibling
        if (prevSibling) {
          const newRange = document.createRange();
          if (prevSibling.nodeType === Node.TEXT_NODE) {
            newRange.setStart(prevSibling, prevSibling.length);
            newRange.setEnd(prevSibling, prevSibling.length);
          } else {
            newRange.selectNodeContents(prevSibling);
            newRange.collapse(false);
          }
          selection.removeAllRanges();
          selection.addRange(newRange);
        }
        return true;
      }
    }

    return false;
  }

  /**
   * Get the last text node within an element
   * @param {Node} node - The node to search
   * @returns {Text|null} The last text node or null
   */
  function getLastTextNode(node) {
    if (node.nodeType === Node.TEXT_NODE) {
      return node;
    }
    for (let i = node.childNodes.length - 1; i >= 0; i--) {
      const result = getLastTextNode(node.childNodes[i]);
      if (result) return result;
    }
    return null;
  }

  /**
   * Handle link formatting
   * @param {HTMLElement} element - Contenteditable element
   */
  function handleLinkFormatting(element) {
    const selection = window.getSelection();
    if (selection.rangeCount === 0) return;

    const range = selection.getRangeAt(0);
    const selectedText = range.toString();

    // Check if we're already in a link
    let linkElement = null;
    let node = selection.anchorNode;
    while (node && node !== element) {
      if (node.nodeType === Node.ELEMENT_NODE && node.tagName === 'A') {
        linkElement = node;
        break;
      }
      node = node.parentNode;
    }

    if (linkElement) {
      // Edit existing link
      const currentUrl = linkElement.getAttribute('href') || '';
      const newUrl = prompt('Edit link URL:', currentUrl);

      if (newUrl !== null) {
        if (newUrl.trim() === '') {
          // Remove link
          const parent = linkElement.parentNode;
          while (linkElement.firstChild) {
            parent.insertBefore(linkElement.firstChild, linkElement);
          }
          parent.removeChild(linkElement);
        } else {
          // Update link
          linkElement.setAttribute('href', newUrl);
        }
      }
    } else if (selectedText) {
      // Create new link with selected text
      const url = prompt('Enter link URL:', 'https://');

      if (url && url.trim() !== '' && url !== 'https://') {
        const linkEl = document.createElement('a');
        linkEl.href = url;
        linkEl.target = '_blank';
        linkEl.rel = 'noopener noreferrer';
        linkEl.textContent = selectedText;

        range.deleteContents();
        range.insertNode(linkEl);

        // Move cursor after the link
        range.setStartAfter(linkEl);
        range.setEndAfter(linkEl);
        selection.removeAllRanges();
        selection.addRange(range);
      }
    } else {
      // No selection, prompt for both text and URL
      const linkText = prompt('Enter link text:');
      if (linkText && linkText.trim() !== '') {
        const url = prompt('Enter link URL:', 'https://');
        if (url && url.trim() !== '' && url !== 'https://') {
          const linkEl = document.createElement('a');
          linkEl.href = url;
          linkEl.target = '_blank';
          linkEl.rel = 'noopener noreferrer';
          linkEl.textContent = linkText;

          range.insertNode(linkEl);

          // Move cursor after the link
          range.setStartAfter(linkEl);
          range.setEndAfter(linkEl);
          selection.removeAllRanges();
          selection.addRange(range);
        }
      }
    }
  }

  /**
   * Insert a bullet list item
   * @param {HTMLElement} element - Contenteditable element
   */
  function insertBulletItem(element) {
    const bulletDiv = document.createElement('div');
    bulletDiv.className = 'jt-note-bullet';
    bulletDiv.textContent = '• ';

    const selection = window.getSelection();
    if (selection.rangeCount > 0) {
      const range = selection.getRangeAt(0);
      range.deleteContents();
      range.insertNode(bulletDiv);

      // Place cursor at the end of the bullet text (after "• ")
      const newRange = document.createRange();
      const textNode = bulletDiv.firstChild;
      if (textNode) {
        newRange.setStart(textNode, textNode.length);
        newRange.setEnd(textNode, textNode.length);
        selection.removeAllRanges();
        selection.addRange(newRange);
      }
    }
  }

  /**
   * Insert a numbered list item
   * @param {HTMLElement} element - Contenteditable element
   */
  function insertNumberedItem(element) {
    let nextNumber = 1;
    const allNumbered = element.querySelectorAll('.jt-note-numbered');
    if (allNumbered.length > 0) {
      const lastItem = allNumbered[allNumbered.length - 1];
      const lastNum = parseInt(lastItem.getAttribute('data-number') || '0');
      nextNumber = lastNum + 1;
    }

    const numberedDiv = document.createElement('div');
    numberedDiv.className = 'jt-note-numbered';
    numberedDiv.setAttribute('data-number', nextNumber.toString());
    numberedDiv.textContent = `${nextNumber}. `;

    const selection = window.getSelection();
    if (selection.rangeCount > 0) {
      const range = selection.getRangeAt(0);
      range.deleteContents();
      range.insertNode(numberedDiv);

      const newRange = document.createRange();
      const textNode = numberedDiv.firstChild;
      if (textNode) {
        newRange.setStart(textNode, textNode.length);
        newRange.setEnd(textNode, textNode.length);
        selection.removeAllRanges();
        selection.addRange(newRange);
      }
    }
  }

  /**
   * Insert a checkbox item
   * @param {HTMLElement} element - Contenteditable element
   */
  function insertCheckboxItem(element) {
    const checkboxDiv = document.createElement('div');
    checkboxDiv.className = 'jt-note-checkbox';
    checkboxDiv.setAttribute('contenteditable', 'false');

    const checkbox = document.createElement('input');
    checkbox.type = 'checkbox';

    const span = document.createElement('span');
    span.setAttribute('contenteditable', 'true');
    span.textContent = '';

    checkboxDiv.appendChild(checkbox);
    checkboxDiv.appendChild(span);

    const selection = window.getSelection();
    if (selection.rangeCount > 0) {
      const range = selection.getRangeAt(0);
      range.deleteContents();
      range.insertNode(checkboxDiv);

      // Place cursor inside the span with proper focus
      setTimeout(() => {
        span.focus();
        const newRange = document.createRange();
        newRange.selectNodeContents(span);
        newRange.collapse(true);
        selection.removeAllRanges();
        selection.addRange(newRange);
      }, 0);
    }
  }

  /**
   * Insert a table
   * @param {HTMLElement} element - Contenteditable element
   */
  function insertTable(element) {
    // Prompt for table dimensions
    const rowsInput = prompt('Number of rows (1-10):', '3');
    if (!rowsInput) return;

    const rows = Math.min(10, Math.max(1, parseInt(rowsInput) || 3));

    const colsInput = prompt('Number of columns (1-6):', '3');
    if (!colsInput) return;

    const cols = Math.min(6, Math.max(1, parseInt(colsInput) || 3));

    // Create table container
    const tableContainer = document.createElement('div');
    tableContainer.className = 'jt-note-table-container';

    const table = document.createElement('table');
    table.className = 'jt-note-table';

    // Create header row
    const thead = document.createElement('thead');
    const headerRow = document.createElement('tr');
    for (let j = 0; j < cols; j++) {
      const th = document.createElement('th');
      th.textContent = `Header ${j + 1}`;
      th.setAttribute('contenteditable', 'true');
      headerRow.appendChild(th);
    }
    thead.appendChild(headerRow);
    table.appendChild(thead);

    // Create body rows
    const tbody = document.createElement('tbody');
    for (let i = 0; i < rows - 1; i++) {
      const row = document.createElement('tr');
      for (let j = 0; j < cols; j++) {
        const td = document.createElement('td');
        td.textContent = '';
        td.setAttribute('contenteditable', 'true');
        row.appendChild(td);
      }
      tbody.appendChild(row);
    }
    table.appendChild(tbody);

    tableContainer.appendChild(table);

    // Add a line break after the table for easier editing
    const br = document.createElement('div');
    br.innerHTML = '<br>';

    const selection = window.getSelection();
    if (selection.rangeCount > 0) {
      const range = selection.getRangeAt(0);
      range.deleteContents();
      range.insertNode(br);
      range.insertNode(tableContainer);

      // Place cursor in first header cell
      setTimeout(() => {
        const firstCell = table.querySelector('th');
        if (firstCell) {
          firstCell.focus();
          const newRange = document.createRange();
          newRange.selectNodeContents(firstCell);
          newRange.collapse(false);
          selection.removeAllRanges();
          selection.addRange(newRange);
        }
      }, 0);
    }
  }

  /**
   * Add a row to a table
   * @param {HTMLTableElement} table - The table element
   * @param {HTMLElement} referenceCell - The cell to add row relative to
   * @param {string} position - 'above' or 'below'
   */
  function addTableRow(table, referenceCell, position = 'below') {
    const row = referenceCell.closest('tr');
    if (!row) return;

    const colCount = row.cells.length;
    const newRow = document.createElement('tr');

    for (let i = 0; i < colCount; i++) {
      const td = document.createElement('td');
      td.setAttribute('contenteditable', 'true');
      td.textContent = '';
      newRow.appendChild(td);
    }

    // If reference is in thead, add to tbody instead
    const isHeader = referenceCell.tagName === 'TH';
    if (isHeader) {
      // Add row at the beginning of tbody
      const tbody = table.querySelector('tbody');
      if (tbody && tbody.firstChild) {
        tbody.insertBefore(newRow, tbody.firstChild);
      } else if (tbody) {
        tbody.appendChild(newRow);
      }
    } else {
      if (position === 'above') {
        row.parentNode.insertBefore(newRow, row);
      } else {
        row.parentNode.insertBefore(newRow, row.nextSibling);
      }
    }

    // Focus the first cell of the new row
    const firstCell = newRow.querySelector('td');
    if (firstCell) {
      firstCell.focus();
    }
  }

  /**
   * Add a column to a table
   * @param {HTMLTableElement} table - The table element
   * @param {HTMLElement} referenceCell - The cell to add column relative to
   * @param {string} position - 'left' or 'right'
   */
  function addTableColumn(table, referenceCell, position = 'right') {
    const cellIndex = referenceCell.cellIndex;
    const insertIndex = position === 'left' ? cellIndex : cellIndex + 1;

    // Add header cell
    const headerRow = table.querySelector('thead tr');
    if (headerRow) {
      const th = document.createElement('th');
      th.setAttribute('contenteditable', 'true');
      th.textContent = 'Header';
      if (insertIndex >= headerRow.cells.length) {
        headerRow.appendChild(th);
      } else {
        headerRow.insertBefore(th, headerRow.cells[insertIndex]);
      }
    }

    // Add cells to all body rows
    const bodyRows = table.querySelectorAll('tbody tr');
    bodyRows.forEach(row => {
      const td = document.createElement('td');
      td.setAttribute('contenteditable', 'true');
      td.textContent = '';
      if (insertIndex >= row.cells.length) {
        row.appendChild(td);
      } else {
        row.insertBefore(td, row.cells[insertIndex]);
      }
    });
  }

  /**
   * Delete a row from a table
   * @param {HTMLTableElement} table - The table element
   * @param {HTMLElement} referenceCell - A cell in the row to delete
   */
  function deleteTableRow(table, referenceCell) {
    const row = referenceCell.closest('tr');
    if (!row) return;

    // Don't delete header row
    if (referenceCell.tagName === 'TH') {
      alert('Cannot delete the header row.');
      return;
    }

    // Don't delete if it's the last body row
    const tbody = table.querySelector('tbody');
    if (tbody && tbody.rows.length <= 1) {
      alert('Cannot delete the last row.');
      return;
    }

    row.remove();
  }

  /**
   * Delete a column from a table
   * @param {HTMLTableElement} table - The table element
   * @param {HTMLElement} referenceCell - A cell in the column to delete
   */
  function deleteTableColumn(table, referenceCell) {
    const cellIndex = referenceCell.cellIndex;

    // Check if this is the last column
    const headerRow = table.querySelector('thead tr');
    if (headerRow && headerRow.cells.length <= 1) {
      alert('Cannot delete the last column.');
      return;
    }

    // Delete from header
    if (headerRow && headerRow.cells[cellIndex]) {
      headerRow.cells[cellIndex].remove();
    }

    // Delete from all body rows
    const bodyRows = table.querySelectorAll('tbody tr');
    bodyRows.forEach(row => {
      if (row.cells[cellIndex]) {
        row.cells[cellIndex].remove();
      }
    });
  }

  /**
   * Delete an entire table
   * @param {HTMLTableElement} table - The table element
   */
  function deleteTable(table) {
    const container = table.closest('.jt-note-table-container');
    if (container) {
      container.remove();
    } else {
      table.remove();
    }
  }

  /**
   * Show table context menu
   * @param {MouseEvent} e - The context menu event
   * @param {HTMLElement} cell - The table cell that was right-clicked
   * @param {HTMLElement} contentInput - The contenteditable element (for triggering save)
   */
  function showTableContextMenu(e, cell, contentInput) {
    e.preventDefault();

    // Remove any existing context menu
    const existingMenu = document.querySelector('.jt-note-table-context-menu');
    if (existingMenu) {
      existingMenu.remove();
    }

    const table = cell.closest('table');
    if (!table) return;

    const menu = document.createElement('div');
    menu.className = 'jt-note-table-context-menu';
    menu.innerHTML = `
      <div class="jt-table-menu-item" data-action="add-row-above">Add Row Above</div>
      <div class="jt-table-menu-item" data-action="add-row-below">Add Row Below</div>
      <div class="jt-table-menu-divider"></div>
      <div class="jt-table-menu-item" data-action="add-col-left">Add Column Left</div>
      <div class="jt-table-menu-item" data-action="add-col-right">Add Column Right</div>
      <div class="jt-table-menu-divider"></div>
      <div class="jt-table-menu-item jt-table-menu-danger" data-action="delete-row">Delete Row</div>
      <div class="jt-table-menu-item jt-table-menu-danger" data-action="delete-col">Delete Column</div>
      <div class="jt-table-menu-divider"></div>
      <div class="jt-table-menu-item jt-table-menu-danger" data-action="delete-table">Delete Table</div>
    `;

    // Position menu at click location
    menu.style.left = `${e.clientX}px`;
    menu.style.top = `${e.clientY}px`;

    document.body.appendChild(menu);

    // Handle menu item clicks
    menu.addEventListener('click', (menuEvent) => {
      const item = menuEvent.target.closest('.jt-table-menu-item');
      if (!item) return;

      const action = item.dataset.action;

      switch (action) {
        case 'add-row-above':
          addTableRow(table, cell, 'above');
          break;
        case 'add-row-below':
          addTableRow(table, cell, 'below');
          break;
        case 'add-col-left':
          addTableColumn(table, cell, 'left');
          break;
        case 'add-col-right':
          addTableColumn(table, cell, 'right');
          break;
        case 'delete-row':
          deleteTableRow(table, cell);
          break;
        case 'delete-col':
          deleteTableColumn(table, cell);
          break;
        case 'delete-table':
          if (confirm('Are you sure you want to delete this table?')) {
            deleteTable(table);
          }
          break;
      }

      // Trigger save
      if (contentInput) {
        contentInput.dispatchEvent(new Event('input', { bubbles: true }));
      }

      menu.remove();
    });

    // Close menu when clicking outside
    const closeMenu = (closeEvent) => {
      if (!menu.contains(closeEvent.target)) {
        menu.remove();
        document.removeEventListener('click', closeMenu);
      }
    };

    // Delay adding the listener to prevent immediate close
    setTimeout(() => {
      document.addEventListener('click', closeMenu);
    }, 0);
  }

  /**
   * Clean pasted HTML content
   * @param {string} html - Raw pasted HTML
   * @returns {DocumentFragment} Cleaned content
   */
  function cleanPastedHtml(html) {
    const tempDiv = document.createElement('div');
    tempDiv.innerHTML = html;

    const allowedTags = ['b', 'strong', 'i', 'em', 'u', 's', 'strike', 'del', 'code', 'a', 'br'];

    const cleanHTML = (element) => {
      const clone = element.cloneNode(false);
      for (const child of element.childNodes) {
        if (child.nodeType === Node.TEXT_NODE) {
          clone.appendChild(child.cloneNode(true));
        } else if (child.nodeType === Node.ELEMENT_NODE) {
          const tagName = child.tagName.toLowerCase();
          if (allowedTags.includes(tagName)) {
            const cleanChild = cleanHTML(child);
            // Preserve href for links
            if (tagName === 'a' && child.hasAttribute('href')) {
              cleanChild.setAttribute('href', child.getAttribute('href'));
              cleanChild.setAttribute('target', '_blank');
              cleanChild.setAttribute('rel', 'noopener noreferrer');
            }
            clone.appendChild(cleanChild);
          } else {
            // Skip the tag but keep its children
            for (const grandChild of child.childNodes) {
              const processedChild = grandChild.nodeType === Node.ELEMENT_NODE
                ? cleanHTML(grandChild)
                : grandChild.cloneNode(true);
              clone.appendChild(processedChild);
            }
          }
        }
      }
      return clone;
    };

    const cleanedContent = cleanHTML(tempDiv);
    const fragment = document.createDocumentFragment();
    while (cleanedContent.firstChild) {
      fragment.appendChild(cleanedContent.firstChild);
    }
    return fragment;
  }

  /**
   * Count words in text
   * @param {string} text - Text to count
   * @returns {number} Word count
   */
  function countWords(text) {
    return text.trim().split(/\s+/).filter(w => w.length > 0).length;
  }

  /**
   * Handle keydown events for list items (Enter to continue, Backspace to delete)
   * @param {KeyboardEvent} e - The keyboard event
   * @param {HTMLElement} contentInput - The contenteditable element
   * @returns {boolean} Whether the event was handled
   */
  function handleListKeydown(e, contentInput) {
    const selection = window.getSelection();
    if (!selection.rangeCount) return false;

    const range = selection.getRangeAt(0);
    let currentNode = range.startContainer;

    // Find if we're inside a list item
    let listItem = null;
    let listType = null;

    while (currentNode && currentNode !== contentInput) {
      if (currentNode.nodeType === Node.ELEMENT_NODE) {
        if (currentNode.classList?.contains('jt-note-bullet')) {
          listItem = currentNode;
          listType = 'bullet';
          break;
        } else if (currentNode.classList?.contains('jt-note-numbered')) {
          listItem = currentNode;
          listType = 'numbered';
          break;
        } else if (currentNode.classList?.contains('jt-note-checkbox')) {
          listItem = currentNode;
          listType = 'checkbox';
          break;
        }
      }
      currentNode = currentNode.parentNode;
    }

    // Handle Enter key - create new list item
    if (e.key === 'Enter' && !e.shiftKey && listItem) {
      e.preventDefault();

      // Get text content after cursor for the new item
      const textAfterCursor = range.toString() || '';

      // Create new list item based on type
      let newItem;

      if (listType === 'bullet') {
        newItem = document.createElement('div');
        newItem.className = 'jt-note-bullet';
        newItem.textContent = '• ' + textAfterCursor;
      } else if (listType === 'numbered') {
        const currentNum = parseInt(listItem.getAttribute('data-number') || '1');
        newItem = document.createElement('div');
        newItem.className = 'jt-note-numbered';
        newItem.setAttribute('data-number', (currentNum + 1).toString());
        newItem.textContent = `${currentNum + 1}. ` + textAfterCursor;

        // Renumber subsequent items
        let sibling = listItem.nextElementSibling;
        let nextNum = currentNum + 2;
        while (sibling) {
          if (sibling.classList?.contains('jt-note-numbered')) {
            sibling.setAttribute('data-number', nextNum.toString());
            // Update the visible number in the text
            const text = sibling.textContent;
            sibling.textContent = text.replace(/^\d+\.\s*/, `${nextNum}. `);
            nextNum++;
          }
          sibling = sibling.nextElementSibling;
        }
      } else if (listType === 'checkbox') {
        newItem = document.createElement('div');
        newItem.className = 'jt-note-checkbox';
        newItem.setAttribute('contenteditable', 'false');

        const checkbox = document.createElement('input');
        checkbox.type = 'checkbox';

        const span = document.createElement('span');
        span.setAttribute('contenteditable', 'true');
        span.textContent = textAfterCursor;

        newItem.appendChild(checkbox);
        newItem.appendChild(span);
      }

      // Delete any selected text from current item
      if (!range.collapsed) {
        range.deleteContents();
      }

      // Insert new item after current one
      if (listItem.nextSibling) {
        listItem.parentNode.insertBefore(newItem, listItem.nextSibling);
      } else {
        listItem.parentNode.appendChild(newItem);
      }

      // Move cursor to the new item
      setTimeout(() => {
        const newRange = document.createRange();
        if (listType === 'checkbox') {
          const span = newItem.querySelector('span');
          if (span) {
            span.focus();
            newRange.setStart(span, 0);
            newRange.setEnd(span, 0);
          }
        } else {
          const textNode = newItem.firstChild;
          if (textNode) {
            // Position after the bullet/number prefix
            const prefixLength = listType === 'bullet' ? 2 : newItem.textContent.indexOf(' ') + 1;
            newRange.setStart(textNode, Math.min(prefixLength, textNode.length));
            newRange.setEnd(textNode, Math.min(prefixLength, textNode.length));
          }
        }
        selection.removeAllRanges();
        selection.addRange(newRange);
      }, 0);

      return true;
    }

    // Handle Backspace key - delete empty list items or checkboxes
    if (e.key === 'Backspace' && listItem) {
      // For checkboxes, check if span is empty
      if (listType === 'checkbox') {
        const span = listItem.querySelector('span[contenteditable="true"]');
        if (span && span.textContent === '') {
          e.preventDefault();

          // Move cursor to previous sibling or before the checkbox
          const prevSibling = listItem.previousElementSibling;
          listItem.remove();

          if (prevSibling) {
            const newRange = document.createRange();
            if (prevSibling.classList?.contains('jt-note-checkbox')) {
              const prevSpan = prevSibling.querySelector('span');
              if (prevSpan) {
                prevSpan.focus();
                newRange.selectNodeContents(prevSpan);
                newRange.collapse(false);
              }
            } else {
              newRange.selectNodeContents(prevSibling);
              newRange.collapse(false);
            }
            selection.removeAllRanges();
            selection.addRange(newRange);
          }
          return true;
        }
      } else {
        // For bullets and numbered lists, check if only prefix remains
        const text = listItem.textContent;
        const prefixPattern = listType === 'bullet' ? /^•\s*$/ : /^\d+\.\s*$/;

        if (prefixPattern.test(text)) {
          e.preventDefault();

          const prevSibling = listItem.previousElementSibling;

          // If numbered list, renumber subsequent items
          if (listType === 'numbered') {
            let sibling = listItem.nextElementSibling;
            let currentNum = parseInt(listItem.getAttribute('data-number') || '1');
            while (sibling) {
              if (sibling.classList?.contains('jt-note-numbered')) {
                sibling.setAttribute('data-number', currentNum.toString());
                const sibText = sibling.textContent;
                sibling.textContent = sibText.replace(/^\d+\.\s*/, `${currentNum}. `);
                currentNum++;
              }
              sibling = sibling.nextElementSibling;
            }
          }

          listItem.remove();

          // Move cursor to previous element
          if (prevSibling) {
            const newRange = document.createRange();
            newRange.selectNodeContents(prevSibling);
            newRange.collapse(false);
            selection.removeAllRanges();
            selection.addRange(newRange);
          }
          return true;
        }
      }
    }

    // Handle Delete key for checkboxes
    if (e.key === 'Delete' && listType === 'checkbox') {
      const span = listItem.querySelector('span[contenteditable="true"]');
      if (span && span.textContent === '') {
        e.preventDefault();
        const nextSibling = listItem.nextElementSibling;
        listItem.remove();

        if (nextSibling) {
          const newRange = document.createRange();
          if (nextSibling.classList?.contains('jt-note-checkbox')) {
            const nextSpan = nextSibling.querySelector('span');
            if (nextSpan) {
              nextSpan.focus();
              newRange.selectNodeContents(nextSpan);
              newRange.collapse(true);
            }
          } else {
            newRange.selectNodeContents(nextSibling);
            newRange.collapse(true);
          }
          selection.removeAllRanges();
          selection.addRange(newRange);
        }
        return true;
      }
    }

    return false;
  }

  // Public API
  return {
    // History management
    resetHistory,
    saveToHistory,
    undo,
    redo,

    // Formatting
    updateFormattingButtons,
    applyFormatting,
    normalizeContent,

    // Table operations
    showTableContextMenu,

    // List handling
    handleListKeydown,
    handleFormattingBoundaryBackspace,

    // Utilities
    cleanPastedHtml,
    countWords
  };
})();

// Make available globally
if (typeof window !== 'undefined') {
  window.QuickNotesEditor = QuickNotesEditor;
}
