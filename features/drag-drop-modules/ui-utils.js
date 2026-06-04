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

  // Public API
  return {
    showNotification
  };
})();

// Export for use in other modules
if (typeof window !== 'undefined') {
  window.UIUtils = UIUtils;
}
