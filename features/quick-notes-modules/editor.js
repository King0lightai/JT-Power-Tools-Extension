/**
 * Quick Notes Editor Module
 * Note history reset. The note body is a plain textarea — formatting runs
 * through FormatterFormats (features/formatter-modules/formats.js) and undo/redo
 * through the browser's own stack, not this module.
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
   * Count words in text
   * @param {string} text - Text to count
   * @returns {number} Word count
   */
  function countWords(text) {
    return text.trim().split(/\s+/).filter(w => w.length > 0).length;
  }

  // Public API
  return {
    // History management
    resetHistory,
    undo,
    redo,

    // Utilities
    countWords
  };
})();

// Make available globally
if (typeof window !== 'undefined') {
  window.QuickNotesEditor = QuickNotesEditor;
}
