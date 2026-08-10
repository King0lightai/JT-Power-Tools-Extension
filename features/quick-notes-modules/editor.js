/**
 * Quick Notes Editor Module
 * The note body is a plain textarea — formatting runs through FormatterFormats
 * (features/formatter-modules/formats.js), pasting uses the browser's own
 * clipboard handling, and undo/redo run through the textarea's native undo
 * stack. None of that needs this module; all it exposes now is a word-count
 * utility.
 *
 * Dependencies: none.
 */

const QuickNotesEditor = (() => {
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
    // Utilities
    countWords
  };
})();

// Make available globally
if (typeof window !== 'undefined') {
  window.QuickNotesEditor = QuickNotesEditor;
}
