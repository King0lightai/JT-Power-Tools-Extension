/**
 * Alert Modal Module
 * Provides a JobTread-styled modal for creating alerts
 *
 * Dependencies:
 * - formatter-modules/formats.js (FormatterFormats)
 */

const AlertModal = (() => {
  // Icon SVG paths (matching preview-mode.js)
  const iconMap = {
    infoCircle: {
      name: 'Info',
      path: '<circle cx="12" cy="12" r="10"></circle><path d="M12 16v-4M12 8h.01"></path>'
    },
    exclamationTriangle: {
      name: 'Warning',
      path: '<path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3M12 9v4M12 17h.01"></path>'
    },
    checkCircle: {
      name: 'Success',
      path: '<path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"></path><path d="m9 11 3 3L22 4"></path>'
    },
    octogonAlert: {
      name: 'Alert',
      path: '<path d="M7.86 2h8.28L22 7.86v8.28L16.14 22H7.86L2 16.14V7.86z"></path><path d="M12 8v4M12 16h.01"></path>'
    },
    lightbulb: {
      name: 'Tip',
      path: '<path d="M15 14c.2-1 .7-1.7 1.5-2.5 1-.9 1.5-2.2 1.5-3.5A6 6 0 0 0 6 8c0 1 .2 2.2 1.5 3.5.7.7 1.3 1.5 1.5 2.5M9 18h6M10 22h4"></path>'
    }
  };

  // Color definitions
  const colorMap = {
    blue: { name: 'Blue', class: 'jt-color-blue' },
    yellow: { name: 'Yellow', class: 'jt-color-yellow' },
    red: { name: 'Red', class: 'jt-color-red' },
    green: { name: 'Green', class: 'jt-color-green' },
    orange: { name: 'Orange', class: 'jt-color-orange' },
    purple: { name: 'Purple', class: 'jt-color-purple' }
  };

  // SVG icon helper
  function createSVGIcon(pathContent, colorClass = '') {
    return `<svg xmlns="http://www.w3.org/2000/svg" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2" class="inline-block overflow-visible h-[1em] w-[1em] align-[-0.125em] ${colorClass}" viewBox="0 0 24 24">${pathContent}</svg>`;
  }

  // Close icon SVG
  const closeIconPath = '<path d="M18 6 6 18M6 6l12 12"></path>';
  const chevronDownPath = '<path d="m6 9 6 6 6-6"></path>';
  const cancelIconPath = '<path d="M4.929 4.929 19.07 19.071"></path><circle cx="12" cy="12" r="10"></circle>';
  const plusIconPath = '<path d="M5 12h14M12 5v14"></path>';

  /**
   * Create and show the alert modal
   * @returns {Promise<Object|null>} Alert data or null if cancelled
   */
  function show() {
    return new Promise((resolve) => {
      // Default values
      let selectedColor = 'blue';
      let selectedIcon = 'infoCircle';
      let subject = '';
      let body = '';

      // Create modal overlay
      const overlay = document.createElement('div');
      overlay.className = 'jt-alert-modal-overlay';

      // Create modal structure
      overlay.innerHTML = `
        <div class="jt-alert-modal">
          <div class="jt-alert-modal-header">
            <div class="jt-alert-modal-title">Add Alert</div>
            <button type="button" class="jt-alert-modal-close">
              ${createSVGIcon(closeIconPath)} Close
            </button>
          </div>
          <div class="jt-alert-modal-body">
            <div class="jt-alert-options-row">
              <!-- Color Dropdown -->
              <div class="jt-alert-dropdown-container" data-dropdown="color">
                <div class="jt-alert-dropdown-button" tabindex="0">
                  <div class="jt-alert-dropdown-label">
                    <span class="${colorMap[selectedColor].class}">${colorMap[selectedColor].name}</span>
                  </div>
                  ${createSVGIcon(chevronDownPath)}
                </div>
                <div class="jt-alert-dropdown-menu">
                  ${Object.entries(colorMap).map(([key, val]) => `
                    <button type="button" class="jt-alert-dropdown-item ${key === selectedColor ? 'active' : ''}" data-color="${key}">
                      <span class="${val.class}">${val.name}</span>
                    </button>
                  `).join('')}
                </div>
              </div>

              <!-- Icon Dropdown -->
              <div class="jt-alert-dropdown-container" data-dropdown="icon">
                <div class="jt-alert-dropdown-button" tabindex="0">
                  <div class="jt-alert-dropdown-label">
                    ${createSVGIcon(iconMap[selectedIcon].path, colorMap[selectedColor].class)}
                  </div>
                  ${createSVGIcon(chevronDownPath)}
                </div>
                <div class="jt-alert-dropdown-menu">
                  ${Object.entries(iconMap).map(([key, val]) => `
                    <button type="button" class="jt-alert-dropdown-item ${key === selectedIcon ? 'active' : ''}" data-icon="${key}">
                      ${createSVGIcon(val.path)} ${val.name}
                    </button>
                  `).join('')}
                </div>
              </div>

              <!-- Subject Input -->
              <input type="text" class="jt-alert-subject" placeholder="Subject" value="">
            </div>

            <!-- Message Textarea with Embedded Toolbar -->
            <div class="jt-alert-message-container">
              <div class="jt-alert-toolbar jt-responsive-toolbar">
                <button type="button" class="jt-toolbar-item" data-format="bold" title="Bold (Ctrl+B)"><strong>B</strong></button>
                <button type="button" class="jt-toolbar-item" data-format="italic" title="Italic (Ctrl+I)"><em>I</em></button>
                <button type="button" class="jt-toolbar-item" data-format="underline" title="Underline (Ctrl+U)"><u>U</u></button>
                <button type="button" class="jt-toolbar-item" data-format="strikethrough" title="Strikethrough"><s>S</s></button>
                <button type="button" class="jt-toolbar-item" data-format="h1" title="Heading 1">H<sub>1</sub></button>
                <button type="button" class="jt-toolbar-item" data-format="h2" title="Heading 2">H<sub>2</sub></button>
                <button type="button" class="jt-toolbar-item" data-format="h3" title="Heading 3">H<sub>3</sub></button>
                <button type="button" class="jt-toolbar-item" data-format="bullet" title="Bullet List"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="8" y1="6" x2="21" y2="6"></line><line x1="8" y1="12" x2="21" y2="12"></line><line x1="8" y1="18" x2="21" y2="18"></line><circle cx="3" cy="6" r="1" fill="currentColor"></circle><circle cx="3" cy="12" r="1" fill="currentColor"></circle><circle cx="3" cy="18" r="1" fill="currentColor"></circle></svg></button>
                <button type="button" class="jt-toolbar-item" data-format="numbered" title="Numbered List"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="10" y1="6" x2="21" y2="6"></line><line x1="10" y1="12" x2="21" y2="12"></line><line x1="10" y1="18" x2="21" y2="18"></line><text x="3" y="7" font-size="6" fill="currentColor" stroke="none" font-weight="600">1</text><text x="3" y="13" font-size="6" fill="currentColor" stroke="none" font-weight="600">2</text><text x="3" y="19" font-size="6" fill="currentColor" stroke="none" font-weight="600">3</text></svg></button>
                <button type="button" class="jt-toolbar-item jt-color-green" data-format="color" data-color="green" title="Green">A</button>
                <button type="button" class="jt-toolbar-item jt-color-yellow" data-format="color" data-color="yellow" title="Yellow">A</button>
                <button type="button" class="jt-toolbar-item jt-color-blue" data-format="color" data-color="blue" title="Blue">A</button>
                <button type="button" class="jt-toolbar-item jt-color-red" data-format="color" data-color="red" title="Red">A</button>
                <button type="button" class="jt-toolbar-item" data-format="link" title="Insert Link"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"></path><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"></path></svg></button>
                <button type="button" class="jt-toolbar-item" data-format="quote" title="Quote"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 21c3 0 7-1 7-8V5c0-1.25-.756-2.017-2-2H4c-1.25 0-2 .75-2 1.972V11c0 1.25.75 2 2 2 1 0 1 0 1 1v1c0 1-1 2-2 2s-1 .008-1 1.031V21z"></path><path d="M15 21c3 0 7-1 7-8V5c0-1.25-.757-2.017-2-2h-4c-1.25 0-2 .75-2 1.972V11c0 1.25.75 2 2 2h.75c0 2.25.25 4-2.75 4v3z"></path></svg></button>
                <button type="button" class="jt-toolbar-item" data-format="hr" title="Horizontal Rule (---)"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="3" y1="12" x2="21" y2="12"></line></svg></button>
              </div>
              <textarea class="jt-alert-message" placeholder="Message" data-jt-no-formatter="true"></textarea>
            </div>
          </div>
          <div class="jt-alert-modal-footer">
            <button type="button" class="jt-alert-btn-cancel">
              ${createSVGIcon(cancelIconPath)} Cancel
            </button>
            <button type="button" class="jt-alert-btn-add">
              ${createSVGIcon(plusIconPath)} Add
            </button>
          </div>
        </div>
      `;

      // Get references to elements
      const modal = overlay.querySelector('.jt-alert-modal');
      const closeBtn = overlay.querySelector('.jt-alert-modal-close');
      const cancelBtn = overlay.querySelector('.jt-alert-btn-cancel');
      const addBtn = overlay.querySelector('.jt-alert-btn-add');
      const subjectInput = overlay.querySelector('.jt-alert-subject');
      const messageTextarea = overlay.querySelector('.jt-alert-message');
      const colorDropdown = overlay.querySelector('[data-dropdown="color"]');
      const iconDropdown = overlay.querySelector('[data-dropdown="icon"]');

      // Update icon preview with current color
      function updateIconPreview() {
        const iconLabel = iconDropdown.querySelector('.jt-alert-dropdown-label');
        iconLabel.innerHTML = createSVGIcon(iconMap[selectedIcon].path, colorMap[selectedColor].class);
      }

      // Update color label
      function updateColorLabel() {
        const colorLabel = colorDropdown.querySelector('.jt-alert-dropdown-label');
        colorLabel.innerHTML = `<span class="${colorMap[selectedColor].class}">${colorMap[selectedColor].name}</span>`;
      }

      // Close modal
      function closeModal(result = null) {
        overlay.remove();
        resolve(result);
      }

      // Handle dropdown toggle
      function setupDropdown(container) {
        const button = container.querySelector('.jt-alert-dropdown-button');
        const menu = container.querySelector('.jt-alert-dropdown-menu');

        button.addEventListener('click', (e) => {
          e.stopPropagation();

          // Close other dropdowns
          overlay.querySelectorAll('.jt-alert-dropdown-menu').forEach(m => {
            if (m !== menu) m.classList.remove('jt-dropdown-open');
          });

          menu.classList.toggle('jt-dropdown-open');
        });

        button.addEventListener('keydown', (e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            button.click();
          }
        });
      }

      // Setup color dropdown
      setupDropdown(colorDropdown);
      colorDropdown.querySelectorAll('.jt-alert-dropdown-item').forEach(item => {
        item.addEventListener('click', (e) => {
          e.stopPropagation();
          selectedColor = item.dataset.color;

          // Update active state
          colorDropdown.querySelectorAll('.jt-alert-dropdown-item').forEach(i => {
            i.classList.toggle('active', i.dataset.color === selectedColor);
          });

          updateColorLabel();
          updateIconPreview();
          colorDropdown.querySelector('.jt-alert-dropdown-menu').classList.remove('jt-dropdown-open');
        });
      });

      // Setup icon dropdown
      setupDropdown(iconDropdown);
      iconDropdown.querySelectorAll('.jt-alert-dropdown-item').forEach(item => {
        item.addEventListener('click', (e) => {
          e.stopPropagation();
          selectedIcon = item.dataset.icon;

          // Update active state
          iconDropdown.querySelectorAll('.jt-alert-dropdown-item').forEach(i => {
            i.classList.toggle('active', i.dataset.icon === selectedIcon);
          });

          updateIconPreview();
          iconDropdown.querySelector('.jt-alert-dropdown-menu').classList.remove('jt-dropdown-open');
        });
      });

      // Close dropdowns when clicking outside
      overlay.addEventListener('click', (e) => {
        if (!e.target.closest('.jt-alert-dropdown-container')) {
          overlay.querySelectorAll('.jt-alert-dropdown-menu').forEach(m => {
            m.classList.remove('jt-dropdown-open');
          });
        }
      });

      // Update toolbar button states based on cursor position
      function updateToolbarButtonStates() {
        if (!window.FormatterDetection) return;

        const activeFormats = window.FormatterDetection.detectActiveFormats(messageTextarea);
        const toolbar = overlay.querySelector('.jt-alert-toolbar');
        if (!toolbar) return;

        // Update basic format buttons
        const boldBtn = toolbar.querySelector('[data-format="bold"]');
        const italicBtn = toolbar.querySelector('[data-format="italic"]');
        const underlineBtn = toolbar.querySelector('[data-format="underline"]');
        const strikeBtn = toolbar.querySelector('[data-format="strikethrough"]');

        boldBtn?.classList.toggle('active', activeFormats.bold);
        italicBtn?.classList.toggle('active', activeFormats.italic);
        underlineBtn?.classList.toggle('active', activeFormats.underline);
        strikeBtn?.classList.toggle('active', activeFormats.strikethrough);

        // Update color buttons
        toolbar.querySelectorAll('[data-format="color"]').forEach(btn => {
          const color = btn.dataset.color;
          btn.classList.toggle('active', color === activeFormats.color);
        });
      }

      // Update toolbar states on cursor move, selection change, and input
      messageTextarea.addEventListener('keyup', updateToolbarButtonStates);
      messageTextarea.addEventListener('mouseup', updateToolbarButtonStates);
      messageTextarea.addEventListener('input', updateToolbarButtonStates);

      // Handle keyboard shortcuts in message textarea - reuse existing FormatterFormats module
      messageTextarea.addEventListener('keydown', (e) => {
        const isMac = navigator.platform.toUpperCase().indexOf('MAC') >= 0;
        const modifier = isMac ? e.metaKey : e.ctrlKey;

        // Handle Ctrl+key shortcuts
        if (modifier) {
          let format = null;
          switch(e.key.toLowerCase()) {
            case 'b': format = 'bold'; break;
            case 'i': format = 'italic'; break;
            case 'u': format = 'underline'; break;
          }

          if (format && window.FormatterFormats) {
            e.preventDefault();
            e.stopPropagation();
            window.FormatterFormats.applyFormat(messageTextarea, format);
            updateToolbarButtonStates();
          }
          return;
        }

        // Handle Enter key for list continuation
        if (e.key === 'Enter' && !e.shiftKey) {
          const text = messageTextarea.value;
          const cursorPos = messageTextarea.selectionStart;

          // Find the current line
          const lineStart = text.lastIndexOf('\n', cursorPos - 1) + 1;
          const currentLine = text.substring(lineStart, cursorPos);

          // Check for bullet list: starts with "- " or "• "
          const bulletMatch = currentLine.match(/^(\s*)([-•])\s/);
          if (bulletMatch) {
            const indent = bulletMatch[1];
            const bullet = bulletMatch[2];
            // If line only contains the bullet (empty item), remove it instead of continuing
            if (currentLine.trim() === bullet) {
              e.preventDefault();
              // Remove the empty bullet line
              const before = text.substring(0, lineStart);
              const after = text.substring(cursorPos);
              messageTextarea.value = before + after;
              messageTextarea.selectionStart = messageTextarea.selectionEnd = lineStart;
              messageTextarea.dispatchEvent(new Event('input', { bubbles: true }));
            } else {
              e.preventDefault();
              const newBullet = `\n${indent}${bullet} `;
              const before = text.substring(0, cursorPos);
              const after = text.substring(cursorPos);
              messageTextarea.value = before + newBullet + after;
              messageTextarea.selectionStart = messageTextarea.selectionEnd = cursorPos + newBullet.length;
              messageTextarea.dispatchEvent(new Event('input', { bubbles: true }));
            }
            return;
          }

          // Check for numbered list: starts with "1. ", "2. ", etc.
          const numberMatch = currentLine.match(/^(\s*)(\d+)\.\s/);
          if (numberMatch) {
            const indent = numberMatch[1];
            const num = parseInt(numberMatch[2], 10);
            // If line only contains the number (empty item), remove it instead of continuing
            if (currentLine.trim() === `${num}.`) {
              e.preventDefault();
              // Remove the empty numbered line
              const before = text.substring(0, lineStart);
              const after = text.substring(cursorPos);
              messageTextarea.value = before + after;
              messageTextarea.selectionStart = messageTextarea.selectionEnd = lineStart;
              messageTextarea.dispatchEvent(new Event('input', { bubbles: true }));
            } else {
              e.preventDefault();
              const newNumber = `\n${indent}${num + 1}. `;
              const before = text.substring(0, cursorPos);
              const after = text.substring(cursorPos);
              messageTextarea.value = before + newNumber + after;
              messageTextarea.selectionStart = messageTextarea.selectionEnd = cursorPos + newNumber.length;
              messageTextarea.dispatchEvent(new Event('input', { bubbles: true }));
            }
            return;
          }
        }
      });

      // Handle embedded toolbar button clicks
      const toolbarButtons = overlay.querySelectorAll('.jt-alert-toolbar .jt-toolbar-item');
      toolbarButtons.forEach(btn => {
        btn.addEventListener('click', (e) => {
          e.preventDefault();
          e.stopPropagation();
          const format = btn.dataset.format;
          if (format && window.FormatterFormats) {
            // Focus textarea first to ensure selection is preserved
            messageTextarea.focus();
            // Pass color option if this is a color button
            const options = {};
            if (format === 'color' && btn.dataset.color) {
              options.color = btn.dataset.color;
            }
            window.FormatterFormats.applyFormat(messageTextarea, format, options);
          }
        });
      });

      // NOTE: We intentionally do NOT close the modal when clicking outside
      // User requested that modal only closes via buttons (Close, Cancel, Add)

      // Close modal on close/cancel button
      closeBtn.addEventListener('click', () => closeModal(null));
      cancelBtn.addEventListener('click', () => closeModal(null));

      // Add alert on add button
      addBtn.addEventListener('click', () => {
        subject = subjectInput.value.trim() || 'Important';
        body = messageTextarea.value.trim() || 'Your alert message here.';

        closeModal({
          alertColor: selectedColor,
          alertIcon: selectedIcon,
          alertSubject: subject,
          alertBody: body
        });
      });

      // Handle keyboard
      overlay.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') {
          closeModal(null);
        }
      });

      // Append to body and focus subject input
      document.body.appendChild(overlay);
      setTimeout(() => {
        subjectInput.focus();
      }, 50);
    });
  }

  // Public API
  return {
    show
  };
})();

// Export to window
if (typeof window !== 'undefined') {
  window.AlertModal = AlertModal;
}
