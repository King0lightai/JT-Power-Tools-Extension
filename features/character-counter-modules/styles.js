/**
 * Character Counter Styles Module
 * CSS for the character counter UI, template dropdown, and editor modals.
 * Extracted from character-counter.js to keep that file within the LOC budget.
 *
 * Dependencies: None
 */

const CharacterCounterStyles = `
    .jt-char-counter {
      font-size: 11px;
      text-align: right;
      margin-top: 4px;
      padding-right: 4px;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      transition: color 0.2s ease, opacity 0.2s ease;
      pointer-events: none;
      opacity: 0;
      height: 0;
      overflow: hidden;
    }

    /* Show counter when textarea is focused */
    .jt-char-counter.visible {
      opacity: 1;
      height: auto;
      overflow: visible;
    }

    .jt-char-counter.safe {
      color: #6b7280;
    }

    .jt-char-counter.warning {
      color: #f59e0b;
      font-weight: 500;
    }

    .jt-char-counter.danger {
      color: #ef4444;
      font-weight: 600;
    }

    .jt-char-counter.over-limit {
      color: #dc2626;
      font-weight: 700;
    }

    /* Position counter for message dialogs - inline next to template button */
    .jt-char-counter-message {
      display: inline-flex;
      align-items: center;
      font-size: 12px;
      color: #6b7280;
      padding: 4px 4px;
      margin-right: 4px;
      opacity: 1;
      height: auto;
      overflow: visible;
      white-space: nowrap;
    }

    /* Dark mode compatibility */
    .jt-dark-mode .jt-char-counter.safe,
    #jt-dark-mode-styles ~ * .jt-char-counter.safe,
    [data-theme="dark"] .jt-char-counter.safe {
      color: #9ca3af;
    }

    .jt-dark-mode .jt-char-counter-message,
    #jt-dark-mode-styles ~ * .jt-char-counter-message {
      color: #9ca3af;
    }

    /* Counter wrapper to keep it aligned */
    .jt-char-counter-wrapper {
      display: flex;
      justify-content: flex-end;
      width: 100%;
    }

    /* Signature container - wraps counter and signature buttons */
    .jt-signature-container {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      padding: 2px 6px;
      border: 1px solid rgba(128, 128, 128, 0.25);
      border-radius: 4px;
      background: rgba(0, 0, 0, 0.02);
      margin-left: auto;
      flex-shrink: 0;
      position: relative;
    }

    /* Remove background/border from split containers (templates-only and counter-only) */
    .jt-signature-container.jt-templates-only,
    .jt-signature-container.jt-counter-only {
      padding: 0;
      border: none;
      background: none;
      gap: 0;
    }

    /* When in sidebar (narrower container), stack vertically */
    .jt-signature-container-row {
      display: flex;
      align-items: center;
      justify-content: flex-end;
      width: 100%;
      margin-top: 8px;
    }

    .jt-signature-container-row .jt-signature-container {
      margin-left: 0;
    }

    /* Inline group for counter + templates inside the action bar */
    .jt-counter-templates-group {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      margin-left: auto;
      flex-shrink: 1;
      min-width: 0;
    }

    .jt-dark-mode .jt-signature-container,
    #jt-dark-mode-styles ~ * .jt-signature-container {
      border-color: rgba(255, 255, 255, 0.15);
      background: rgba(255, 255, 255, 0.05);
    }

    /* Remove background/border from split containers in dark mode too */
    .jt-dark-mode .jt-signature-container.jt-templates-only,
    .jt-dark-mode .jt-signature-container.jt-counter-only,
    #jt-dark-mode-styles ~ * .jt-signature-container.jt-templates-only,
    #jt-dark-mode-styles ~ * .jt-signature-container.jt-counter-only {
      border: none;
      background: none;
    }

    /* Signature buttons */
    .jt-signature-btn {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      gap: 4px;
      background: none;
      border: none;
      cursor: pointer;
      padding: 4px 6px;
      border-radius: 3px;
      font-size: 11px;
      color: #6b7280;
      transition: background-color 0.15s ease, color 0.15s ease;
      white-space: nowrap;
    }

    .jt-signature-btn:hover {
      background: rgba(0, 0, 0, 0.08);
      color: #374151;
    }

    .jt-signature-btn:active {
      background: rgba(0, 0, 0, 0.12);
    }

    .jt-dark-mode .jt-signature-btn,
    #jt-dark-mode-styles ~ * .jt-signature-btn {
      color: #9ca3af;
    }

    .jt-dark-mode .jt-signature-btn:hover,
    #jt-dark-mode-styles ~ * .jt-signature-btn:hover {
      background: rgba(255, 255, 255, 0.1);
      color: #d1d5db;
    }

    .jt-signature-btn-icon {
      font-size: 12px;
    }

    /* Native JobTread-style buttons (matching upload/copy/gif buttons) */
    .jt-native-btn {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      position: relative;
      cursor: pointer;
      user-select: none;
      white-space: nowrap;
      padding: 4px 8px;
      min-width: 28px;
      min-height: 26px;
      box-shadow: 0 1px 2px 0 rgba(0, 0, 0, 0.05);
      color: #4b5563;
      background: white;
      border: 1px solid #e5e7eb;
      border-radius: 2px;
      text-align: center;
      font-size: 14px;
      line-height: 1;
      transition: background-color 0.15s ease, box-shadow 0.15s ease;
    }

    .jt-native-btn:hover {
      background: #f9fafb;
    }

    .jt-native-btn:active {
      box-shadow: inset 0 2px 4px 0 rgba(0, 0, 0, 0.06);
    }

    /* Touch targets. These render 45x36 / 46x36, under the 44px minimum a
       thumb needs, so the hit area grows on touch devices only.

       TRADE-OFF worth knowing: this class exists to match JobTread's own
       upload/copy/gif buttons, and growing ours means we no longer match them
       exactly on a phone or tablet. Accessibility was judged to win over
       pixel parity with a host control that is itself undersized — but if
       parity matters more, deleting this block is the whole revert. */
    @media (pointer: coarse) {
      .jt-native-btn {
        min-width: 44px;
        min-height: 44px;
      }
    }

    .jt-native-btn svg {
      display: inline-block;
      overflow: visible;
      height: 1em;
      width: 1em;
      vertical-align: -0.125em;
      font-size: 16px;
    }

    /* Dark mode for native buttons - neutral dark gray background */
    .jt-dark-mode .jt-native-btn,
    #jt-dark-mode-styles ~ * .jt-native-btn {
      background: #2c2c2c;
      border-color: #404040;
      color: #d4d4d4;
    }

    .jt-dark-mode .jt-native-btn:hover,
    #jt-dark-mode-styles ~ * .jt-native-btn:hover {
      background: #3c3c3c;
      color: #e5e5e5;
    }

    /* RGB Theme for native buttons */
    .jt-custom-theme .jt-native-btn {
      background: var(--jt-theme-background, white);
      border-color: var(--jt-theme-border, #e5e7eb);
      color: var(--jt-theme-text-muted, #4b5563);
    }

    .jt-custom-theme .jt-native-btn:hover {
      background: var(--jt-theme-background-muted, #f9fafb);
      color: var(--jt-theme-text, #374151);
    }

    /* Button group styling for templates container */
    .jt-templates-only {
      display: inline-flex;
      align-items: center;
      gap: 0;
    }

    .jt-templates-only .jt-native-btn:first-child {
      border-top-right-radius: 0;
      border-bottom-right-radius: 0;
      border-right: none;
    }

    .jt-templates-only .jt-settings-btn {
      border-top-left-radius: 0;
      border-bottom-left-radius: 0;
    }

    /* When the expand button is present, the dropdown becomes the middle button —
       strip its radii and right border so the three pieces read as one pill */
    .jt-templates-only .jt-template-dropdown-btn:not(:first-child) {
      border-radius: 0;
      border-right: none;
    }

    /* Expand button on message dialogs — toggles the textarea max-height
       (default 20vh from Tailwind's max-h-[20vh] → 70vh when expanded) */
    .jt-message-expanded {
      max-height: 70vh !important;
    }

    /* Separator between buttons and counter */
    .jt-signature-separator {
      width: 1px;
      height: 16px;
      background: rgba(128, 128, 128, 0.3);
      margin: 0 2px;
    }

    .jt-dark-mode .jt-signature-separator,
    #jt-dark-mode-styles ~ * .jt-signature-separator {
      background: rgba(255, 255, 255, 0.2);
    }

    /* Modal overlay */
    .jt-signature-modal-overlay {
      position: fixed;
      top: 0;
      left: 0;
      right: 0;
      bottom: 0;
      background: rgba(0, 0, 0, 0.5);
      display: flex;
      align-items: center;
      justify-content: center;
      z-index: 10000;
      animation: jt-sig-fade-in 0.15s ease;
    }

    @keyframes jt-sig-fade-in {
      from { opacity: 0; }
      to { opacity: 1; }
    }

    /* Modal container */
    .jt-signature-modal {
      background: white;
      border-radius: 8px;
      box-shadow: 0 20px 40px rgba(0, 0, 0, 0.25);
      width: 90%;
      max-width: 450px;
      max-height: 80vh;
      display: flex;
      flex-direction: column;
      animation: jt-sig-slide-up 0.2s ease;
    }

    @keyframes jt-sig-slide-up {
      from {
        opacity: 0;
        transform: translateY(20px);
      }
      to {
        opacity: 1;
        transform: translateY(0);
      }
    }

    .jt-dark-mode .jt-signature-modal,
    #jt-dark-mode-styles ~ * .jt-signature-modal {
      background: #252525;
      color: #e5e5e5;
    }

    /* Modal header */
    .jt-signature-modal-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 16px 20px;
      border-bottom: 1px solid #e5e7eb;
    }

    .jt-dark-mode .jt-signature-modal-header,
    #jt-dark-mode-styles ~ * .jt-signature-modal-header {
      border-color: #404040;
    }

    .jt-signature-modal-title {
      font-size: 16px;
      font-weight: 600;
      margin: 0;
      color: #111827;
    }

    .jt-dark-mode .jt-signature-modal-title,
    #jt-dark-mode-styles ~ * .jt-signature-modal-title {
      color: #e5e5e5;
    }

    .jt-signature-modal-close {
      background: none;
      border: none;
      cursor: pointer;
      padding: 4px;
      color: #6b7280;
      font-size: 20px;
      line-height: 1;
      border-radius: 4px;
      transition: background-color 0.15s ease;
    }

    .jt-signature-modal-close:hover {
      background: rgba(0, 0, 0, 0.05);
      color: #374151;
    }

    .jt-dark-mode .jt-signature-modal-close:hover,
    #jt-dark-mode-styles ~ * .jt-signature-modal-close:hover {
      background: rgba(255, 255, 255, 0.1);
      color: #d1d5db;
    }

    /* Modal body */
    .jt-signature-modal-body {
      padding: 20px;
      flex: 1;
      overflow-y: auto;
    }

    .jt-signature-modal-description {
      font-size: 13px;
      color: #6b7280;
      margin: 0 0 12px 0;
    }

    .jt-dark-mode .jt-signature-modal-description,
    #jt-dark-mode-styles ~ * .jt-signature-modal-description {
      color: #9ca3af;
    }

    .jt-signature-textarea {
      width: 100%;
      min-height: 120px;
      padding: 12px;
      border: 1px solid #d1d5db;
      border-radius: 6px;
      font-size: 14px;
      font-family: inherit;
      resize: vertical;
      box-sizing: border-box;
      transition: border-color 0.15s ease, box-shadow 0.15s ease;
    }

    .jt-signature-textarea:focus {
      outline: none;
      border-color: #3b82f6;
      box-shadow: 0 0 0 3px rgba(59, 130, 246, 0.15);
    }

    .jt-dark-mode .jt-signature-textarea,
    #jt-dark-mode-styles ~ * .jt-signature-textarea {
      background: #1a1a1a;
      border-color: #404040;
      color: #e5e5e5;
    }

    .jt-dark-mode .jt-signature-textarea:focus,
    #jt-dark-mode-styles ~ * .jt-signature-textarea:focus {
      border-color: #525252;
      box-shadow: 0 0 0 3px rgba(82, 82, 82, 0.3);
    }

    /* Modal footer */
    .jt-signature-modal-footer {
      display: flex;
      justify-content: flex-end;
      gap: 10px;
      padding: 16px 20px;
      border-top: 1px solid #e5e7eb;
    }

    .jt-dark-mode .jt-signature-modal-footer,
    #jt-dark-mode-styles ~ * .jt-signature-modal-footer {
      border-color: #404040;
    }

    .jt-signature-modal-btn {
      padding: 8px 16px;
      border-radius: 6px;
      font-size: 14px;
      font-weight: 500;
      cursor: pointer;
      transition: background-color 0.15s ease, transform 0.1s ease;
    }

    .jt-signature-modal-btn:active {
      transform: scale(0.98);
    }

    .jt-signature-modal-btn-cancel {
      background: #f3f4f6;
      border: 1px solid #d1d5db;
      color: #374151;
    }

    .jt-signature-modal-btn-cancel:hover {
      background: #e5e7eb;
    }

    .jt-dark-mode .jt-signature-modal-btn-cancel,
    #jt-dark-mode-styles ~ * .jt-signature-modal-btn-cancel {
      background: #333333;
      border-color: #404040;
      color: #e5e5e5;
    }

    .jt-dark-mode .jt-signature-modal-btn-cancel:hover,
    #jt-dark-mode-styles ~ * .jt-signature-modal-btn-cancel:hover {
      background: #404040;
    }

    .jt-signature-modal-btn-save {
      background: #3b82f6;
      border: none;
      color: white;
    }

    .jt-signature-modal-btn-save:hover {
      background: #2563eb;
    }

    .jt-signature-modal-btn-save:disabled {
      opacity: 0.6;
      cursor: not-allowed;
    }

    /* Dropdown menu */
    .jt-template-dropdown {
      position: fixed;
      background: white;
      border: 1px solid #e5e7eb;
      border-radius: 6px;
      box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
      min-width: 220px;
      max-width: 300px;
      max-height: 300px;
      overflow-y: auto;
      z-index: 10000;
    }

    .jt-template-dropdown-item {
      padding: 10px 12px;
      cursor: pointer;
      border-bottom: 1px solid #f3f4f6;
    }

    .jt-template-dropdown-item:last-child {
      border-bottom: none;
    }

    .jt-template-dropdown-item:hover {
      background: #f9fafb;
    }

    .jt-template-dropdown-name {
      font-weight: 500;
      font-size: 13px;
      color: #111827;
    }

    .jt-template-dropdown-preview {
      font-size: 11px;
      color: #6b7280;
      margin-top: 2px;
    }

    .jt-template-dropdown-separator {
      height: 1px;
      background: #e5e7eb;
      margin: 4px 0;
    }

    .jt-template-dropdown-add {
      color: #3b82f6;
      font-weight: 500;
    }

    .jt-template-add-icon {
      margin-right: 4px;
    }

    /* Template manager list */
    .jt-template-list {
      display: flex;
      flex-direction: column;
      gap: 8px;
    }

    .jt-template-list-item {
      display: flex;
      justify-content: space-between;
      align-items: flex-start;
      padding: 12px;
      border: 1px solid #e5e7eb;
      border-radius: 6px;
      background: #fafafa;
    }

    .jt-template-list-item:hover {
      border-color: #d1d5db;
    }

    .jt-template-item-info {
      flex: 1;
      min-width: 0;
    }

    .jt-template-item-header {
      display: flex;
      align-items: center;
      gap: 4px;
    }

    .jt-template-star {
      color: #f59e0b;
    }

    .jt-template-item-name {
      font-weight: 500;
      font-size: 14px;
    }

    .jt-template-item-preview {
      font-size: 12px;
      color: #6b7280;
      margin-top: 4px;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }

    .jt-template-item-actions {
      display: flex;
      gap: 4px;
      margin-left: 12px;
      flex-shrink: 0;
    }

    .jt-template-action-btn {
      background: white;
      border: 1px solid #e5e7eb;
      border-radius: 4px;
      padding: 4px 8px;
      cursor: pointer;
      font-size: 12px;
      transition: background-color 0.15s ease;
    }

    .jt-template-action-btn:hover {
      background: #f3f4f6;
    }

    .jt-template-action-delete:hover {
      background: #fee2e2;
      border-color: #fecaca;
    }

    /* Empty state */
    .jt-template-empty {
      text-align: center;
      padding: 32px 16px;
      color: #6b7280;
    }

    .jt-template-empty-hint {
      font-size: 12px;
      margin-top: 4px;
      color: #9ca3af;
    }

    /* Form elements */
    .jt-template-form-group {
      margin-bottom: 16px;
    }

    .jt-template-label {
      display: block;
      font-weight: 500;
      margin-bottom: 6px;
      font-size: 13px;
      color: #374151;
    }

    .jt-template-name-input {
      width: 100%;
      padding: 10px 12px;
      border: 1px solid #d1d5db;
      border-radius: 6px;
      font-size: 14px;
      box-sizing: border-box;
      transition: border-color 0.15s ease, box-shadow 0.15s ease;
    }

    .jt-template-name-input:focus {
      outline: none;
      border-color: #3b82f6;
      box-shadow: 0 0 0 3px rgba(59, 130, 246, 0.15);
    }

    .jt-template-checkbox-label {
      display: flex;
      align-items: center;
      gap: 8px;
      font-size: 13px;
      cursor: pointer;
      color: #374151;
    }

    /* Dark mode - using dark grays (not blues) */
    .jt-dark-mode .jt-template-dropdown,
    #jt-dark-mode-styles ~ * .jt-template-dropdown {
      background: #252525;
      border-color: #404040;
    }

    .jt-dark-mode .jt-template-dropdown-item,
    #jt-dark-mode-styles ~ * .jt-template-dropdown-item {
      border-color: #333333;
    }

    .jt-dark-mode .jt-template-dropdown-item:hover,
    #jt-dark-mode-styles ~ * .jt-template-dropdown-item:hover {
      background: #333333;
    }

    .jt-dark-mode .jt-template-dropdown-name,
    #jt-dark-mode-styles ~ * .jt-template-dropdown-name {
      color: #e5e5e5;
    }

    .jt-dark-mode .jt-template-dropdown-preview,
    #jt-dark-mode-styles ~ * .jt-template-dropdown-preview {
      color: #a3a3a3;
    }

    .jt-dark-mode .jt-template-dropdown-separator,
    #jt-dark-mode-styles ~ * .jt-template-dropdown-separator {
      background: #404040;
    }

    .jt-dark-mode .jt-template-list-item,
    #jt-dark-mode-styles ~ * .jt-template-list-item {
      background: #1a1a1a;
      border-color: #404040;
    }

    .jt-dark-mode .jt-template-list-item:hover,
    #jt-dark-mode-styles ~ * .jt-template-list-item:hover {
      border-color: #525252;
    }

    .jt-dark-mode .jt-template-item-name,
    #jt-dark-mode-styles ~ * .jt-template-item-name {
      color: #e5e5e5;
    }

    .jt-dark-mode .jt-template-item-preview,
    #jt-dark-mode-styles ~ * .jt-template-item-preview {
      color: #a3a3a3;
    }

    .jt-dark-mode .jt-template-name-input,
    #jt-dark-mode-styles ~ * .jt-template-name-input {
      background: #1a1a1a;
      border-color: #404040;
      color: #e5e5e5;
    }

    .jt-dark-mode .jt-template-name-input:focus,
    #jt-dark-mode-styles ~ * .jt-template-name-input:focus {
      border-color: #525252;
      box-shadow: 0 0 0 3px rgba(82, 82, 82, 0.3);
    }

    .jt-dark-mode .jt-template-label,
    .jt-dark-mode .jt-template-checkbox-label,
    #jt-dark-mode-styles ~ * .jt-template-label,
    #jt-dark-mode-styles ~ * .jt-template-checkbox-label {
      color: #d4d4d4;
    }

    .jt-dark-mode .jt-template-action-btn,
    #jt-dark-mode-styles ~ * .jt-template-action-btn {
      background: #2a2a2a;
      border-color: #404040;
      color: #d4d4d4;
    }

    .jt-dark-mode .jt-template-action-btn:hover,
    #jt-dark-mode-styles ~ * .jt-template-action-btn:hover {
      background: #333333;
    }

    .jt-dark-mode .jt-template-action-delete:hover,
    #jt-dark-mode-styles ~ * .jt-template-action-delete:hover {
      background: #3d1f1f;
      border-color: #5c2929;
    }

    .jt-dark-mode .jt-template-empty,
    #jt-dark-mode-styles ~ * .jt-template-empty {
      color: #a3a3a3;
    }

    .jt-dark-mode .jt-template-empty-hint,
    #jt-dark-mode-styles ~ * .jt-template-empty-hint {
      color: #737373;
    }

    /* ===========================================
       RGB THEME (Custom Theme) Support
       Uses CSS custom properties from rgb-theme.js
       Body has .jt-custom-theme class when active
       =========================================== */

    /* Signature Container - RGB Theme */
    .jt-custom-theme .jt-signature-container {
      border-color: var(--jt-theme-border, rgba(128, 128, 128, 0.25));
      background: var(--jt-theme-background-subtle, rgba(0, 0, 0, 0.02));
    }

    .jt-custom-theme .jt-signature-btn {
      background: var(--jt-theme-background, #ffffff);
      border-color: var(--jt-theme-border, #e5e7eb);
      color: var(--jt-theme-text, #374151);
    }

    .jt-custom-theme .jt-signature-btn:hover {
      background: var(--jt-theme-background-muted, #f3f4f6);
      border-color: var(--jt-theme-border-strong, #d1d5db);
    }

    .jt-custom-theme .jt-signature-separator {
      background: var(--jt-theme-border, #e5e7eb);
    }

    /* Signature/Template Modal - RGB Theme */
    .jt-custom-theme .jt-signature-modal {
      background: var(--jt-theme-background-elevated, #ffffff);
      color: var(--jt-theme-text, #1f2937);
    }

    .jt-custom-theme .jt-signature-modal-header {
      border-color: var(--jt-theme-border, #e5e7eb);
    }

    .jt-custom-theme .jt-signature-modal-title {
      color: var(--jt-theme-text, #111827);
    }

    .jt-custom-theme .jt-signature-modal-close {
      color: var(--jt-theme-text-secondary, #6b7280);
    }

    .jt-custom-theme .jt-signature-modal-close:hover {
      color: var(--jt-theme-text, #111827);
      background: var(--jt-theme-background-muted, #f3f4f6);
    }

    .jt-custom-theme .jt-signature-modal-description {
      color: var(--jt-theme-text-secondary, #6b7280);
    }

    .jt-custom-theme .jt-signature-textarea {
      background: var(--jt-theme-background, #ffffff);
      border-color: var(--jt-theme-border, #d1d5db);
      color: var(--jt-theme-text, #1f2937);
    }

    .jt-custom-theme .jt-signature-textarea:focus {
      border-color: var(--jt-theme-primary, #3b82f6);
    }

    .jt-custom-theme .jt-signature-modal-footer {
      border-color: var(--jt-theme-border, #e5e7eb);
    }

    .jt-custom-theme .jt-signature-modal-btn-cancel {
      background: var(--jt-theme-background, #ffffff);
      border-color: var(--jt-theme-border, #d1d5db);
      color: var(--jt-theme-text, #374151);
    }

    .jt-custom-theme .jt-signature-modal-btn-cancel:hover {
      background: var(--jt-theme-background-muted, #f3f4f6);
    }

    .jt-custom-theme .jt-signature-modal-btn-save {
      background: var(--jt-theme-primary, #3b82f6);
      color: #ffffff;
    }

    .jt-custom-theme .jt-signature-modal-btn-save:hover {
      background: var(--jt-theme-primary-hover, #2563eb);
    }

    /* Template Dropdown - RGB Theme */
    .jt-custom-theme .jt-template-dropdown {
      background: var(--jt-theme-background-elevated, #ffffff);
      border-color: var(--jt-theme-border, #e5e7eb);
      box-shadow: 0 4px 12px rgba(0, 0, 0, 0.1);
    }

    .jt-custom-theme .jt-template-dropdown-item {
      border-color: var(--jt-theme-border-subtle, #f3f4f6);
    }

    .jt-custom-theme .jt-template-dropdown-item:hover {
      background: var(--jt-theme-background-muted, #f9fafb);
    }

    .jt-custom-theme .jt-template-dropdown-name {
      color: var(--jt-theme-text, #111827);
    }

    .jt-custom-theme .jt-template-dropdown-preview {
      color: var(--jt-theme-text-secondary, #6b7280);
    }

    .jt-custom-theme .jt-template-dropdown-separator {
      background: var(--jt-theme-border, #e5e7eb);
    }

    .jt-custom-theme .jt-template-dropdown-add {
      color: var(--jt-theme-primary, #3b82f6);
    }

    /* Template Manager List - RGB Theme */
    .jt-custom-theme .jt-template-list-item {
      background: var(--jt-theme-background-subtle, #fafafa);
      border-color: var(--jt-theme-border, #e5e7eb);
    }

    .jt-custom-theme .jt-template-list-item:hover {
      border-color: var(--jt-theme-border-strong, #d1d5db);
    }

    .jt-custom-theme .jt-template-item-name {
      color: var(--jt-theme-text, #111827);
    }

    .jt-custom-theme .jt-template-item-preview {
      color: var(--jt-theme-text-secondary, #6b7280);
    }

    .jt-custom-theme .jt-template-star {
      color: #f59e0b;
    }

    .jt-custom-theme .jt-template-name-input {
      background: var(--jt-theme-background, #ffffff);
      border-color: var(--jt-theme-border, #d1d5db);
      color: var(--jt-theme-text, #1f2937);
    }

    .jt-custom-theme .jt-template-name-input:focus {
      border-color: var(--jt-theme-primary, #3b82f6);
    }

    .jt-custom-theme .jt-template-label,
    .jt-custom-theme .jt-template-checkbox-label {
      color: var(--jt-theme-text, #374151);
    }

    .jt-custom-theme .jt-template-action-btn {
      background: var(--jt-theme-background, #ffffff);
      border-color: var(--jt-theme-border, #e5e7eb);
      color: var(--jt-theme-text, #374151);
    }

    .jt-custom-theme .jt-template-action-btn:hover {
      background: var(--jt-theme-background-muted, #f3f4f6);
    }

    .jt-custom-theme .jt-template-action-delete:hover {
      background: #fee2e2;
      border-color: #fecaca;
    }

    .jt-custom-theme .jt-template-empty {
      color: var(--jt-theme-text-secondary, #6b7280);
    }

    .jt-custom-theme .jt-template-empty-hint {
      color: var(--jt-theme-text-muted, #9ca3af);
    }

    /* Template Dropdown Tabs */
    .jt-template-tabs {
      display: flex;
      border-bottom: 1px solid #e5e5e5;
      padding: 0;
      margin: 0;
    }
    .jt-template-tab {
      flex: 1;
      padding: 8px 12px;
      text-align: center;
      cursor: pointer;
      font-size: 12px;
      font-weight: 500;
      color: #666;
      background: transparent;
      border: none;
      border-bottom: 2px solid transparent;
      transition: all 0.15s ease;
    }
    .jt-template-tab:hover {
      color: #333;
      background: #f5f5f5;
    }
    .jt-template-tab.active {
      color: #0891b2;
      border-bottom-color: #0891b2;
    }
    .jt-template-tab .jt-tab-badge {
      font-size: 9px;
      vertical-align: super;
      color: #0891b2;
      margin-left: 2px;
    }
    .jt-template-created-by {
      font-size: 10px;
      color: #999;
      margin-top: 2px;
    }

    /* Dark mode - Template Dropdown Tabs */
    body.jt-dark-mode .jt-template-tabs,
    #jt-dark-mode-styles ~ * .jt-template-tabs {
      border-bottom-color: #404040;
    }
    body.jt-dark-mode .jt-template-tab,
    #jt-dark-mode-styles ~ * .jt-template-tab {
      color: #b0b0b0;
    }
    body.jt-dark-mode .jt-template-tab:hover,
    #jt-dark-mode-styles ~ * .jt-template-tab:hover {
      color: #e0e0e0;
      background: #333333;
    }
    body.jt-dark-mode .jt-template-tab.active,
    #jt-dark-mode-styles ~ * .jt-template-tab.active {
      color: #22d3ee;
      border-bottom-color: #22d3ee;
    }
    body.jt-dark-mode .jt-template-created-by,
    #jt-dark-mode-styles ~ * .jt-template-created-by {
      color: #707070;
    }

    /* ===========================================
       JOBTREAD'S OWN DARK MODE as the ground

       NativeDarkBridge sets body.jt-native-dark when JobTread's theme picker
       is on jt-dark, and body.jt-dark-mode alongside it — jt-dark-mode means
       "the page is dark by either route". So every .jt-dark-mode rule above
       already fires here, painting this popup in the JT Power Tools warm
       greys (#252525 / #404040) on top of JobTread's cooler, bluer palette,
       where they read as a foreign patch.

       These rules inherit JobTread's LIVE tokens instead. Their gray scale is
       INVERTED under jt-dark — low numbers are surfaces, high numbers are text
       (--color-gray-800 is #e0e3e9) — and --color-white never flips, so it is
       never a surface colour. --jtd2-keep is defined (66%) only while Double
       Dark is loaded, so the 100% fallback is a no-op otherwise and every
       surface here darkens with that level for free.

       Both guards are load-bearing:
         :not(.jt-dark-standard)  our Dark level repaints the whole app in the
                                  JT Power Tools greys — match the app then.
         :not(.jt-custom-theme)   the RGB theme is a palette the user picked.
                                  It wins today on source order; these rules
                                  are more specific, so without the guard they
                                  would silently override that choice.

       Accents are left alone on purpose: the cyan active tab, the blue Save
       button and the red delete tint are state signals, not surfaces, and all
       three read on JobTread's dark ground unchanged. The alpha-based
       .jt-signature-container / .jt-signature-separator rules are already
       ground-agnostic and need no variant.
       =========================================== */

    /* Template dropdown — the "My Templates / Company" popup */
    body.jt-native-dark:not(.jt-dark-standard):not(.jt-custom-theme) .jt-template-dropdown {
      background: color-mix(in oklab, var(--color-gray-100, #1e2128) var(--jtd2-keep, 100%), black);
      border-color: color-mix(in oklab, var(--color-gray-300, #3a4150) var(--jtd2-keep, 100%), black);
    }

    body.jt-native-dark:not(.jt-dark-standard):not(.jt-custom-theme) .jt-template-dropdown-item {
      border-color: color-mix(in oklab, var(--color-gray-200, #2c303a) var(--jtd2-keep, 100%), black);
    }

    body.jt-native-dark:not(.jt-dark-standard):not(.jt-custom-theme) .jt-template-dropdown-item:hover {
      background: color-mix(in oklab, var(--color-gray-200, #2c303a) var(--jtd2-keep, 100%), black);
    }

    body.jt-native-dark:not(.jt-dark-standard):not(.jt-custom-theme) .jt-template-dropdown-name {
      color: var(--color-gray-800, #e0e3e9);
    }

    body.jt-native-dark:not(.jt-dark-standard):not(.jt-custom-theme) .jt-template-dropdown-preview,
    body.jt-native-dark:not(.jt-dark-standard):not(.jt-custom-theme) .jt-template-created-by {
      color: var(--color-gray-600, #aab2bf);
    }

    body.jt-native-dark:not(.jt-dark-standard):not(.jt-custom-theme) .jt-template-dropdown-separator {
      background: color-mix(in oklab, var(--color-gray-300, #3a4150) var(--jtd2-keep, 100%), black);
    }

    /* Tab bar inside the dropdown and the manager modal */
    body.jt-native-dark:not(.jt-dark-standard):not(.jt-custom-theme) .jt-template-tabs {
      border-bottom-color: color-mix(in oklab, var(--color-gray-300, #3a4150) var(--jtd2-keep, 100%), black);
    }

    body.jt-native-dark:not(.jt-dark-standard):not(.jt-custom-theme) .jt-template-tab {
      color: var(--color-gray-600, #aab2bf);
    }

    body.jt-native-dark:not(.jt-dark-standard):not(.jt-custom-theme) .jt-template-tab:hover {
      background: color-mix(in oklab, var(--color-gray-200, #2c303a) var(--jtd2-keep, 100%), black);
      color: var(--color-gray-800, #e0e3e9);
    }

    /* Restated, not inherited. The two rules above carry a class more than the
       base .jt-template-tab.active rule does, so without this the selected tab
       would lose its cyan and read as just another idle tab. Declared after
       :hover so the active tab keeps its accent while hovered — the same
       precedence the light and .jt-dark-mode rules already have. */
    body.jt-native-dark:not(.jt-dark-standard):not(.jt-custom-theme) .jt-template-tab.active {
      color: #22d3ee;
      border-bottom-color: #22d3ee;
    }

    /* Template manager / signature modal */
    body.jt-native-dark:not(.jt-dark-standard):not(.jt-custom-theme) .jt-signature-modal {
      background: color-mix(in oklab, var(--color-gray-100, #1e2128) var(--jtd2-keep, 100%), black);
      color: var(--color-gray-800, #e0e3e9);
    }

    body.jt-native-dark:not(.jt-dark-standard):not(.jt-custom-theme) .jt-signature-modal-header,
    body.jt-native-dark:not(.jt-dark-standard):not(.jt-custom-theme) .jt-signature-modal-footer {
      border-color: color-mix(in oklab, var(--color-gray-300, #3a4150) var(--jtd2-keep, 100%), black);
    }

    body.jt-native-dark:not(.jt-dark-standard):not(.jt-custom-theme) .jt-signature-modal-title {
      color: var(--color-gray-800, #e0e3e9);
    }

    body.jt-native-dark:not(.jt-dark-standard):not(.jt-custom-theme) .jt-signature-modal-description {
      color: var(--color-gray-600, #aab2bf);
    }

    /* The close glyph keeps its light-mode #6b7280 in every dark treatment we
       ship — about 2.3:1 on this ground. Give it the token instead. */
    body.jt-native-dark:not(.jt-dark-standard):not(.jt-custom-theme) .jt-signature-modal-close {
      color: var(--color-gray-600, #aab2bf);
    }

    body.jt-native-dark:not(.jt-dark-standard):not(.jt-custom-theme) .jt-signature-modal-close:hover {
      background: color-mix(in oklab, var(--color-gray-200, #2c303a) var(--jtd2-keep, 100%), black);
      color: var(--color-gray-800, #e0e3e9);
    }

    body.jt-native-dark:not(.jt-dark-standard):not(.jt-custom-theme) .jt-signature-textarea,
    body.jt-native-dark:not(.jt-dark-standard):not(.jt-custom-theme) .jt-template-name-input {
      background: color-mix(in oklab, var(--color-gray-50, #15171c) var(--jtd2-keep, 100%), black);
      border-color: color-mix(in oklab, var(--color-gray-300, #3a4150) var(--jtd2-keep, 100%), black);
      color: var(--color-gray-800, #e0e3e9);
    }

    /* Focus ring rides gray-600 — a LIGHT step under jt-dark, so the border
       brightens against the field rather than fading into it. */
    body.jt-native-dark:not(.jt-dark-standard):not(.jt-custom-theme) .jt-signature-textarea:focus,
    body.jt-native-dark:not(.jt-dark-standard):not(.jt-custom-theme) .jt-template-name-input:focus {
      border-color: var(--color-gray-600, #aab2bf);
      box-shadow: 0 0 0 3px color-mix(in oklab, var(--color-gray-600, #aab2bf) 25%, transparent);
    }

    body.jt-native-dark:not(.jt-dark-standard):not(.jt-custom-theme) .jt-signature-modal-btn-cancel {
      background: color-mix(in oklab, var(--color-gray-200, #2c303a) var(--jtd2-keep, 100%), black);
      border-color: color-mix(in oklab, var(--color-gray-300, #3a4150) var(--jtd2-keep, 100%), black);
      color: var(--color-gray-800, #e0e3e9);
    }

    body.jt-native-dark:not(.jt-dark-standard):not(.jt-custom-theme) .jt-signature-modal-btn-cancel:hover {
      background: color-mix(in oklab, var(--color-gray-300, #3a4150) var(--jtd2-keep, 100%), black);
    }

    /* Saved-template rows inside the manager */
    body.jt-native-dark:not(.jt-dark-standard):not(.jt-custom-theme) .jt-template-list-item {
      background: color-mix(in oklab, var(--color-gray-50, #15171c) var(--jtd2-keep, 100%), black);
      border-color: color-mix(in oklab, var(--color-gray-200, #2c303a) var(--jtd2-keep, 100%), black);
    }

    body.jt-native-dark:not(.jt-dark-standard):not(.jt-custom-theme) .jt-template-list-item:hover {
      border-color: color-mix(in oklab, var(--color-gray-300, #3a4150) var(--jtd2-keep, 100%), black);
    }

    body.jt-native-dark:not(.jt-dark-standard):not(.jt-custom-theme) .jt-template-item-name,
    body.jt-native-dark:not(.jt-dark-standard):not(.jt-custom-theme) .jt-template-label,
    body.jt-native-dark:not(.jt-dark-standard):not(.jt-custom-theme) .jt-template-checkbox-label {
      color: var(--color-gray-800, #e0e3e9);
    }

    body.jt-native-dark:not(.jt-dark-standard):not(.jt-custom-theme) .jt-template-item-preview,
    body.jt-native-dark:not(.jt-dark-standard):not(.jt-custom-theme) .jt-template-empty,
    body.jt-native-dark:not(.jt-dark-standard):not(.jt-custom-theme) .jt-template-empty-hint {
      color: var(--color-gray-600, #aab2bf);
    }

    body.jt-native-dark:not(.jt-dark-standard):not(.jt-custom-theme) .jt-template-action-btn {
      background: color-mix(in oklab, var(--color-gray-200, #2c303a) var(--jtd2-keep, 100%), black);
      border-color: color-mix(in oklab, var(--color-gray-300, #3a4150) var(--jtd2-keep, 100%), black);
      color: var(--color-gray-800, #e0e3e9);
    }

    body.jt-native-dark:not(.jt-dark-standard):not(.jt-custom-theme) .jt-template-action-btn:hover {
      background: color-mix(in oklab, var(--color-gray-300, #3a4150) var(--jtd2-keep, 100%), black);
    }

    /* The delete button carries .jt-template-action-btn too, so the hover rule
       above outranks its danger tint. Restate it: losing the red on the one
       destructive control in this popup is worse than any palette mismatch. */
    body.jt-native-dark:not(.jt-dark-standard):not(.jt-custom-theme) .jt-template-action-delete:hover {
      background: #3d1f1f;
      border-color: #5c2929;
    }

    /* The Templates / settings pill that opens all of the above, plus the
       character counter that sits beside it */
    body.jt-native-dark:not(.jt-dark-standard):not(.jt-custom-theme) .jt-native-btn {
      background: color-mix(in oklab, var(--color-gray-100, #1e2128) var(--jtd2-keep, 100%), black);
      border-color: color-mix(in oklab, var(--color-gray-300, #3a4150) var(--jtd2-keep, 100%), black);
      color: var(--color-gray-800, #e0e3e9);
    }

    body.jt-native-dark:not(.jt-dark-standard):not(.jt-custom-theme) .jt-native-btn:hover {
      background: color-mix(in oklab, var(--color-gray-200, #2c303a) var(--jtd2-keep, 100%), black);
    }

    body.jt-native-dark:not(.jt-dark-standard):not(.jt-custom-theme) .jt-signature-btn,
    body.jt-native-dark:not(.jt-dark-standard):not(.jt-custom-theme) .jt-char-counter.safe,
    body.jt-native-dark:not(.jt-dark-standard):not(.jt-custom-theme) .jt-char-counter-message {
      color: var(--color-gray-600, #aab2bf);
    }

    body.jt-native-dark:not(.jt-dark-standard):not(.jt-custom-theme) .jt-signature-btn:hover {
      background: color-mix(in oklab, var(--color-gray-200, #2c303a) var(--jtd2-keep, 100%), black);
      color: var(--color-gray-800, #e0e3e9);
    }
  `;

// Make available globally
if (typeof window !== undefined) {
  window.CharacterCounterStyles = CharacterCounterStyles;
}
