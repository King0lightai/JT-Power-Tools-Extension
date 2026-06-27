// UI Utilities Module
// Shared toast notification used by Task Completion checkboxes and File Drag-to-Folder.
// (Drag & drop helpers were removed Jun 2026 — JobTread has native schedule drag & drop.)

const UIUtils = (() => {
  /**
   * Show a toast notification to the user
   * @param {string} message - The message to display
   */
  function showNotification(message) {
    // Find the search box container
    const searchContainer = document.querySelector('div.relative.h-10.cursor-pointer.grow.min-w-0.rounded-sm');

    if (!searchContainer) {
      return;
    }

    // Create notification element
    const notification = document.createElement('div');
    notification.style.cssText = `
        position: absolute;
        top: 50%;
        right: 8px;
        transform: translateY(-50%);
        background: rgb(59, 130, 246);
        color: white;
        padding: 6px 12px;
        border-radius: 6px;
        box-shadow: 0 2px 8px rgba(0,0,0,0.2);
        z-index: 10000;
        max-width: 250px;
        font-size: 12px;
        font-weight: 600;
        white-space: nowrap;
        pointer-events: none;
        animation: fadeIn 0.2s ease-out;
    `;
    notification.textContent = message;

    // Inject animation styles if not already present
    if (!document.getElementById('jt-notification-styles')) {
      const style = document.createElement('style');
      style.id = 'jt-notification-styles';
      style.textContent = `
          @keyframes fadeIn {
              from {
                  opacity: 0;
                  transform: translateY(-50%) translateX(20px);
              }
              to {
                  opacity: 1;
                  transform: translateY(-50%) translateX(0);
              }
          }
          @keyframes fadeOut {
              from {
                  opacity: 1;
                  transform: translateY(-50%) translateX(0);
              }
              to {
                  opacity: 0;
                  transform: translateY(-50%) translateX(20px);
              }
          }
      `;
      document.head.appendChild(style);
    }

    // Ensure the search container has relative positioning
    const originalPosition = searchContainer.style.position;
    if (!originalPosition || originalPosition === 'static') {
      searchContainer.style.position = 'relative';
    }

    searchContainer.appendChild(notification);

    // Remove after 3 seconds with fade out animation
    setTimeout(() => {
      notification.style.animation = 'fadeOut 0.2s ease-out';
      setTimeout(() => {
        notification.remove();
        // Restore original position if it was changed
        if (!originalPosition || originalPosition === 'static') {
          searchContainer.style.position = originalPosition || '';
        }
      }, 200);
    }, 3000);
  }

  /**
   * Build the SVG checkbox icon shared by the task and action-item completion
   * checkboxes (an outlined rounded rect, plus a checkmark path when complete).
   * @param {boolean} isComplete - Whether to render the checkmark
   * @param {Object} [options] - Per-caller SVG variations
   * @param {string} [options.className] - SVG class attribute
   * @param {string} [options.width] - SVG width attribute (omitted if falsy)
   * @param {string} [options.height] - SVG height attribute (omitted if falsy)
   * @returns {SVGElement} The constructed SVG element
   */
  function createCheckboxSvg(isComplete = false, options = {}) {
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
    svg.setAttribute('fill', 'none');
    svg.setAttribute('stroke', 'currentColor');
    svg.setAttribute('stroke-linecap', 'round');
    svg.setAttribute('stroke-linejoin', 'round');
    svg.setAttribute('stroke-width', '2');
    svg.setAttribute('class', options.className || 'inline-block overflow-visible');
    svg.setAttribute('viewBox', '0 0 24 24');
    if (options.width) {
      svg.setAttribute('width', options.width);
    }
    if (options.height) {
      svg.setAttribute('height', options.height);
    }

    // Checkbox rect
    const rect = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
    rect.setAttribute('width', '18');
    rect.setAttribute('height', '18');
    rect.setAttribute('x', '3');
    rect.setAttribute('y', '3');
    rect.setAttribute('rx', '2');
    svg.appendChild(rect);

    // Add checkmark if task is complete
    if (isComplete) {
      const checkmark = document.createElementNS('http://www.w3.org/2000/svg', 'path');
      checkmark.setAttribute('d', 'M20 6 9 17l-5-5');
      checkmark.setAttribute('class', 'jt-checkmark');
      svg.appendChild(checkmark);
    }

    return svg;
  }

  // Public API
  return {
    showNotification,
    createCheckboxSvg
  };
})();

// Export for use in other modules
if (typeof window !== 'undefined') {
  window.UIUtils = UIUtils;
}
