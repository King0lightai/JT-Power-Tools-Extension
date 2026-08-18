// JT Power Tools - Character Counter Feature
// Shows character countdown on text fields to prevent hitting limits
// Includes message signature functionality

const CharacterCounterFeature = (() => {
  let isActiveState = false;
  let observer = null;
  let debounceTimer = null;
  let cachedTemplates = { templates: [], defaultTemplateId: null };
  const processedFields = new WeakSet();
  const fieldToContainerMap = new WeakMap();

  // Storage key for templates
  const TEMPLATES_STORAGE_KEY = 'messageTemplates';

  // Team (company) templates - Essential+ tier
  const TEAM_TEMPLATES_CACHE_KEY = 'jtTeamTemplates';
  const TEAM_TEMPLATES_CACHE_TTL = 5 * 60 * 1000; // 5 minutes
  let cachedTeamTemplates = { templates: [], lastSync: null };
  let isEssentialPlus = false; // Cached tier check
  let activeTab = 'personal'; // 'personal' or 'company'

  /**
   * Generate a unique ID for templates
   * @returns {string}
   */
  function generateId() {
    return Date.now().toString(36) + Math.random().toString(36).substr(2, 5);
  }

  /**
   * Wire standard signature-modal dismissal: click on the backdrop closes the
   * modal, and Escape closes it only when this overlay is the topmost one (so a
   * nested modal doesn't close every open modal at once). Both listeners are
   * bound to the provided AbortSignal for cleanup.
   * @param {HTMLElement} overlay
   * @param {Function} closeModal
   * @param {AbortSignal} signal
   */
  function wireOverlayDismiss(overlay, closeModal, signal) {
    // Close on overlay click
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) {
        closeModal();
      }
    }, { signal });

    // Close on Escape — only if THIS overlay is the topmost one. Without
    // this check, Escape pressed while the edit modal sits on top of the
    // manager modal closes BOTH (each document-scoped handler fires).
    document.addEventListener('keydown', (e) => {
      if (e.key !== 'Escape') return;
      const allOverlays = document.querySelectorAll('.jt-signature-modal-overlay');
      if (allOverlays[allOverlays.length - 1] === overlay) {
        closeModal();
      }
    }, { signal });
  }

  async function checkEssentialTier() {
    try {
      if (window.LicenseService) {
        const tier = await window.LicenseService.getTier();
        isEssentialPlus = tier && window.LicenseService.tierHasFeature(tier, 'teamTemplates');
      } else {
        isEssentialPlus = false;
      }
    } catch (e) {
      console.log('CharacterCounter: Tier check failed', e);
      isEssentialPlus = false;
    }
    return isEssentialPlus;
  }

  async function loadTeamTemplates(forceRefresh = false) {
    if (!forceRefresh && cachedTeamTemplates.templates.length > 0) {
      const age = Date.now() - (cachedTeamTemplates.lastSync || 0);
      if (age < TEAM_TEMPLATES_CACHE_TTL) {
        return cachedTeamTemplates.templates;
      }
    }

    try {
      const stored = await chrome.storage.local.get([TEAM_TEMPLATES_CACHE_KEY]);
      if (stored[TEAM_TEMPLATES_CACHE_KEY]) {
        cachedTeamTemplates = stored[TEAM_TEMPLATES_CACHE_KEY];
        const age = Date.now() - (cachedTeamTemplates.lastSync || 0);
        if (!forceRefresh && age < TEAM_TEMPLATES_CACHE_TTL) {
          return cachedTeamTemplates.templates;
        }
      }
    } catch (e) {
      console.log('CharacterCounter: Local cache read failed', e);
    }

    if (window.AccountService?.isLoggedIn()) {
      try {
        console.log('CharacterCounter: Fetching team templates from server...');
        const result = await window.AccountService.getTeamTemplates();
        if (result.success) {
          cachedTeamTemplates = {
            templates: result.templates || [],
            lastSync: Date.now()
          };
          await chrome.storage.local.set({ [TEAM_TEMPLATES_CACHE_KEY]: cachedTeamTemplates });
          console.log('CharacterCounter: Team templates loaded', { count: cachedTeamTemplates.templates.length });
          return cachedTeamTemplates.templates;
        }
      } catch (e) {
        console.log('CharacterCounter: Team templates fetch failed, using cache', e);
      }
    }

    return cachedTeamTemplates.templates;
  }

  async function saveTeamTemplate(template) {
    if (!window.AccountService?.isLoggedIn()) {
      console.error('CharacterCounter: Cannot save team template - not logged in');
      return null;
    }

    const result = await window.AccountService.saveTeamTemplate(template);
    if (result.success) {
      await loadTeamTemplates(true);
      return result.data;
    } else {
      console.error('CharacterCounter: Failed to save team template', result.error);
      return null;
    }
  }

  async function deleteTeamTemplateById(templateId) {
    if (!window.AccountService?.isLoggedIn()) {
      console.error('CharacterCounter: Cannot delete team template - not logged in');
      return false;
    }

    const result = await window.AccountService.deleteTeamTemplate(templateId);
    if (result.success) {
      cachedTeamTemplates.templates = cachedTeamTemplates.templates.filter(t => t.id !== templateId);
      await chrome.storage.local.set({ [TEAM_TEMPLATES_CACHE_KEY]: cachedTeamTemplates });
      return true;
    } else {
      console.error('CharacterCounter: Failed to delete team template', result.error);
      return false;
    }
  }

  // Character limits for JobTread fields
  // Comments and messages have a 4096 character limit
  const FIELD_LIMITS = {
    // Message and comment fields - 4096 limit
    'message': 4096,
    'comment': 4096,
    'comments': 4096,
    // Notes and description fields
    'notes': 5000,
    'note': 5000,
    'description': 5000,
    'details': 5000,
    // Shorter fields
    'name': 255,
    'title': 255,
    'subject': 255,
    'address': 500,
    'email': 255,
    'phone': 50,
    // Default for unknown textareas
    'default': 4096
  };

  // CSS for counter styling
  const COUNTER_STYLES = window.CharacterCounterStyles;

  let styleElement = null;

  /**
   * Inject CSS styles
   */
  function injectStyles() {
    if (styleElement) return;

    styleElement = document.createElement('style');
    styleElement.id = 'jt-char-counter-styles';
    styleElement.textContent = COUNTER_STYLES;
    document.head.appendChild(styleElement);
  }

  /**
   * Remove injected styles
   */
  function removeStyles() {
    if (styleElement) {
      styleElement.remove();
      styleElement = null;
    }
  }

  // Debounced template sync
  let templateSyncTimeout = null;
  const TEMPLATE_SYNC_DEBOUNCE = 3000; // 3 seconds

  /**
   * Trigger debounced template sync
   */
  function triggerDebouncedTemplateSync() {
    if (templateSyncTimeout) {
      clearTimeout(templateSyncTimeout);
    }
    templateSyncTimeout = setTimeout(async () => {
      if (window.AccountService?.isLoggedIn()) {
        console.log('CharacterCounter: Triggering background template sync...');
        const data = cachedTemplates || { templates: [], defaultTemplateId: null };
        const result = await window.AccountService.syncTemplates(data);
        if (result.success && result.templates) {
          // Update local cache and storage with merged data
          cachedTemplates = {
            templates: result.templates,
            defaultTemplateId: result.defaultTemplateId
          };
          await chrome.storage.sync.set({ [TEMPLATES_STORAGE_KEY]: cachedTemplates });
          console.log('CharacterCounter: Background template sync complete', result.stats);
        }
      }
    }, TEMPLATE_SYNC_DEBOUNCE);
  }

  /**
   * Load templates from Chrome storage
   * Includes migration from old messageSignature format
   * Syncs with server when logged in
   * @returns {Promise<Object>}
   */
  async function loadTemplates() {
    try {
      const result = await chrome.storage.sync.get([TEMPLATES_STORAGE_KEY, 'messageSignature']);

      // Migration: Convert old signature to template if needed
      if (!result[TEMPLATES_STORAGE_KEY] && result.messageSignature) {
        const migrated = {
          templates: [{
            id: generateId(),
            name: 'My Signature',
            content: result.messageSignature,
            createdAt: Date.now(),
            updatedAt: Date.now()
          }],
          defaultTemplateId: null
        };
        migrated.defaultTemplateId = migrated.templates[0].id;
        await chrome.storage.sync.set({ [TEMPLATES_STORAGE_KEY]: migrated });
        await chrome.storage.sync.remove('messageSignature');
        cachedTemplates = migrated;
        console.log('CharacterCounter: Migrated signature to templates');
        return migrated;
      }

      let data = result[TEMPLATES_STORAGE_KEY] || { templates: [], defaultTemplateId: null };

      // Sync with server if logged in
      if (window.AccountService?.isLoggedIn()) {
        try {
          console.log('CharacterCounter: Syncing templates on load...');
          const syncResult = await window.AccountService.syncTemplates(data);
          if (syncResult.success && syncResult.templates) {
            data = {
              templates: syncResult.templates,
              defaultTemplateId: syncResult.defaultTemplateId
            };
            // Save merged data locally
            await chrome.storage.sync.set({ [TEMPLATES_STORAGE_KEY]: data });
            console.log('CharacterCounter: Templates synced', syncResult.stats);
          }
        } catch (syncError) {
          console.log('CharacterCounter: Template sync failed, using local', syncError);
        }
      }

      cachedTemplates = data;
      return cachedTemplates;
    } catch (error) {
      console.error('CharacterCounter: Failed to load templates', error);
      return { templates: [], defaultTemplateId: null };
    }
  }

  /**
   * Save templates to Chrome storage
   * Triggers debounced sync when logged in
   * @param {Object} data - The templates data object
   * @returns {Promise<void>}
   */
  async function saveTemplates(data) {
    try {
      cachedTemplates = data;
      await chrome.storage.sync.set({ [TEMPLATES_STORAGE_KEY]: data });

      // Trigger debounced sync if logged in
      if (window.AccountService?.isLoggedIn()) {
        triggerDebouncedTemplateSync();
      }
    } catch (error) {
      console.error('CharacterCounter: Failed to save templates', error);
    }
  }

  /**
   * Create a new template
   * @param {string} name - Template name
   * @param {string} content - Template content
   * @param {boolean} setAsDefault - Whether to set as default
   * @returns {Promise<Object>} The created template
   */
  async function createTemplate(name, content, setAsDefault = false) {
    const data = await loadTemplates();
    const newTemplate = {
      id: generateId(),
      name: name.trim(),
      content: content,
      createdAt: Date.now(),
      updatedAt: Date.now()
    };
    data.templates.push(newTemplate);
    if (setAsDefault || data.templates.length === 1) {
      data.defaultTemplateId = newTemplate.id;
    }
    await saveTemplates(data);
    return newTemplate;
  }

  /**
   * Update an existing template
   * @param {string} id - Template ID
   * @param {Object} updates - Fields to update (name, content)
   * @returns {Promise<Object|null>} The updated template or null
   */
  async function updateTemplate(id, updates) {
    const data = await loadTemplates();
    const index = data.templates.findIndex(t => t.id === id);
    if (index !== -1) {
      data.templates[index] = { ...data.templates[index], ...updates, updatedAt: Date.now() };
      await saveTemplates(data);
      return data.templates[index];
    }
    return null;
  }

  /**
   * Delete a template
   * @param {string} id - Template ID
   * @returns {Promise<void>}
   */
  async function deleteTemplate(id) {
    // Track deletion for sync before removing
    if (window.QuickNotesStorage && window.QuickNotesStorage.trackDeletedTemplate) {
      await window.QuickNotesStorage.trackDeletedTemplate(id);
    }

    const data = await loadTemplates();
    data.templates = data.templates.filter(t => t.id !== id);
    if (data.defaultTemplateId === id) {
      data.defaultTemplateId = data.templates[0]?.id || null;
    }
    await saveTemplates(data);
  }

  /**
   * Set a template as the default
   * @param {string} id - Template ID
   * @returns {Promise<void>}
   */
  async function setDefaultTemplate(id) {
    const data = await loadTemplates();
    if (data.templates.some(t => t.id === id)) {
      data.defaultTemplateId = id;
      await saveTemplates(data);
    }
  }

  /**
   * Open the template edit/create modal
   * @param {Object|null} template - Existing template to edit, or null to create new
   * @returns {Promise<Object|null>} - { name, content, setAsDefault } or null if cancelled
   */
  function openTemplateEditModal(template = null, options = {}) {
    const isNew = !template;
    const showDefaultCheckbox = options.showDefaultCheckbox !== false; // default true
    return new Promise((resolve) => {
      const abortController = new AbortController();
      const { signal } = abortController;

      // Create overlay
      const overlay = document.createElement('div');
      overlay.className = 'jt-signature-modal-overlay';
      overlay.style.zIndex = '10001'; // Above manager modal if open

      // Create modal
      const modal = document.createElement('div');
      modal.className = 'jt-signature-modal';

      // Header
      const header = document.createElement('div');
      header.className = 'jt-signature-modal-header';

      const title = document.createElement('h3');
      title.className = 'jt-signature-modal-title';
      title.textContent = isNew ? 'New Template' : 'Edit Template';

      const closeBtn = document.createElement('button');
      closeBtn.className = 'jt-signature-modal-close';
      closeBtn.innerHTML = '&times;';
      closeBtn.setAttribute('aria-label', 'Close');

      header.appendChild(title);
      header.appendChild(closeBtn);

      // Body with name input and content textarea
      const body = document.createElement('div');
      body.className = 'jt-signature-modal-body';

      // Template name input
      const nameGroup = document.createElement('div');
      nameGroup.className = 'jt-template-form-group';

      const nameLabel = document.createElement('label');
      nameLabel.className = 'jt-template-label';
      nameLabel.textContent = 'Template Name';

      const nameInput = document.createElement('input');
      nameInput.type = 'text';
      nameInput.className = 'jt-template-name-input';
      nameInput.placeholder = 'e.g., Professional, Quick Thanks';
      nameInput.value = template ? template.name : '';

      nameGroup.appendChild(nameLabel);
      nameGroup.appendChild(nameInput);

      // Template content textarea
      const contentGroup = document.createElement('div');
      contentGroup.className = 'jt-template-form-group';

      const contentLabel = document.createElement('label');
      contentLabel.className = 'jt-template-label';
      contentLabel.textContent = 'Template Content';

      const textarea = document.createElement('textarea');
      textarea.className = 'jt-signature-textarea';
      textarea.placeholder = 'Enter your template text...\n\nExample:\n--\nBest regards,\nJohn Smith\nProject Manager';
      textarea.value = template ? template.content : '';

      contentGroup.appendChild(contentLabel);
      contentGroup.appendChild(textarea);

      // Default checkbox (hidden for company templates)
      let defaultCheckbox = null;
      if (showDefaultCheckbox) {
        const checkboxLabel = document.createElement('label');
        checkboxLabel.className = 'jt-template-checkbox-label';

        defaultCheckbox = document.createElement('input');
        defaultCheckbox.type = 'checkbox';
        defaultCheckbox.className = 'jt-template-default-checkbox';

        checkboxLabel.appendChild(defaultCheckbox);
        checkboxLabel.appendChild(document.createTextNode(' Set as default template'));

        body.appendChild(nameGroup);
        body.appendChild(contentGroup);
        body.appendChild(checkboxLabel);
      } else {
        body.appendChild(nameGroup);
        body.appendChild(contentGroup);
      }

      // Footer
      const footer = document.createElement('div');
      footer.className = 'jt-signature-modal-footer';

      const cancelBtn = document.createElement('button');
      cancelBtn.className = 'jt-signature-modal-btn jt-signature-modal-btn-cancel';
      cancelBtn.textContent = 'Cancel';

      const saveBtn = document.createElement('button');
      saveBtn.className = 'jt-signature-modal-btn jt-signature-modal-btn-save';
      saveBtn.textContent = isNew ? 'Create Template' : 'Save Changes';

      footer.appendChild(cancelBtn);
      footer.appendChild(saveBtn);

      // Assemble modal
      modal.appendChild(header);
      modal.appendChild(body);
      modal.appendChild(footer);
      overlay.appendChild(modal);

      // Close function
      function closeModal(result = null) {
        abortController.abort();
        overlay.remove();
        resolve(result);
      }

      // Save function
      function saveTemplate() {
        const name = nameInput.value.trim();
        const content = textarea.value;
        if (!name) {
          nameInput.focus();
          nameInput.style.borderColor = '#ef4444';
          return;
        }
        closeModal({ name, content, setAsDefault: defaultCheckbox ? defaultCheckbox.checked : false });
      }

      // Event listeners
      closeBtn.addEventListener('click', () => closeModal(), { signal });
      cancelBtn.addEventListener('click', () => closeModal(), { signal });
      saveBtn.addEventListener('click', saveTemplate, { signal });

      // Close on overlay click + Escape (topmost only)
      wireOverlayDismiss(overlay, closeModal, signal);

      // Submit on Ctrl+Enter in textarea
      textarea.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
          e.preventDefault();
          saveTemplate();
        }
      }, { signal });

      // Clear error styling on input
      nameInput.addEventListener('input', () => {
        nameInput.style.borderColor = '';
      }, { signal });

      // Add to page
      document.body.appendChild(overlay);

      // Focus name input for new templates, content for editing
      setTimeout(() => {
        if (isNew) {
          nameInput.focus();
        } else {
          textarea.focus();
        }
      }, 50);
    });
  }

  /**
   * Open the template manager modal
   * @returns {Promise<void>}
   */
  function openTemplateManagerModal() {
    return new Promise((resolve) => {
      const abortController = new AbortController();
      const { signal } = abortController;

      // Track which tab is active within this modal
      let managerTab = activeTab;

      // Create overlay
      const overlay = document.createElement('div');
      overlay.className = 'jt-signature-modal-overlay';

      // Create modal
      const modal = document.createElement('div');
      modal.className = 'jt-signature-modal jt-template-manager';
      modal.style.maxWidth = '500px';

      // Header
      const header = document.createElement('div');
      header.className = 'jt-signature-modal-header';

      const title = document.createElement('h3');
      title.className = 'jt-signature-modal-title';
      title.textContent = 'Message Templates';

      const closeBtn = document.createElement('button');
      closeBtn.className = 'jt-signature-modal-close';
      closeBtn.innerHTML = '&times;';
      closeBtn.setAttribute('aria-label', 'Close');

      header.appendChild(title);
      header.appendChild(closeBtn);

      // Tab bar (for Essential+ users)
      const tabBarContainer = document.createElement('div');
      if (isEssentialPlus) {
        tabBarContainer.className = 'jt-template-tabs';
        tabBarContainer.style.margin = '0 16px';

        const personalTab = document.createElement('button');
        personalTab.className = 'jt-template-tab' + (managerTab === 'personal' ? ' active' : '');
        personalTab.dataset.tab = 'personal';
        personalTab.textContent = 'My Templates';

        const companyTab = document.createElement('button');
        companyTab.className = 'jt-template-tab' + (managerTab === 'company' ? ' active' : '');
        companyTab.dataset.tab = 'company';
        companyTab.innerHTML = 'Company <span class="jt-tab-badge">\u2605</span>';

        tabBarContainer.appendChild(personalTab);
        tabBarContainer.appendChild(companyTab);

        // Tab switching
        [personalTab, companyTab].forEach(tab => {
          tab.addEventListener('click', async () => {
            const newTab = tab.dataset.tab;
            if (newTab === managerTab) return;
            managerTab = newTab;
            personalTab.classList.toggle('active', managerTab === 'personal');
            companyTab.classList.toggle('active', managerTab === 'company');
            if (managerTab === 'company') {
              await loadTeamTemplates();
            }
            renderList();
          }, { signal });
        });
      }

      // Body - will contain template list
      const body = document.createElement('div');
      body.className = 'jt-signature-modal-body jt-template-list-container';

      // Footer with Add button
      const footer = document.createElement('div');
      footer.className = 'jt-signature-modal-footer';
      footer.style.justifyContent = 'center';

      const addBtn = document.createElement('button');
      addBtn.className = 'jt-signature-modal-btn jt-signature-modal-btn-save';
      addBtn.textContent = '+ Add New Template';

      footer.appendChild(addBtn);

      // Assemble modal
      modal.appendChild(header);
      if (isEssentialPlus) {
        modal.appendChild(tabBarContainer);
      }
      modal.appendChild(body);
      modal.appendChild(footer);
      overlay.appendChild(modal);

      /**
       * Render the template list based on active manager tab
       */
      async function renderList() {
        const isCompany = managerTab === 'company';
        let templates, defaultTemplateId;

        if (isCompany) {
          await loadTeamTemplates();
          templates = cachedTeamTemplates.templates;
          defaultTemplateId = null;
        } else {
          const data = await loadTemplates();
          templates = data.templates;
          defaultTemplateId = data.defaultTemplateId;
        }

        body.innerHTML = '';

        if (templates.length === 0) {
          const empty = document.createElement('div');
          empty.className = 'jt-template-empty';
          const emptyMsg = document.createElement('p');
          emptyMsg.textContent = isCompany ? 'No company templates yet' : 'No templates yet';
          const emptyHint = document.createElement('p');
          emptyHint.className = 'jt-template-empty-hint';
          emptyHint.textContent = isCompany
            ? 'Create a shared template for your team'
            : 'Create your first template to get started';
          empty.appendChild(emptyMsg);
          empty.appendChild(emptyHint);
          body.appendChild(empty);
          return;
        }

        const list = document.createElement('div');
        list.className = 'jt-template-list';

        templates.forEach(template => {
          const isDefault = !isCompany && template.id === defaultTemplateId;
          const item = document.createElement('div');
          item.className = 'jt-template-list-item';

          const preview = template.content.substring(0, 50).replace(/\n/g, ' ');

          // Info section
          const info = document.createElement('div');
          info.className = 'jt-template-item-info';

          const itemHeader = document.createElement('div');
          itemHeader.className = 'jt-template-item-header';
          if (isDefault) {
            const star = document.createElement('span');
            star.className = 'jt-template-star';
            star.textContent = '\u2605';
            itemHeader.appendChild(star);
          }
          const nameSpan = document.createElement('span');
          nameSpan.className = 'jt-template-item-name';
          nameSpan.textContent = template.name;
          itemHeader.appendChild(nameSpan);

          const previewDiv = document.createElement('div');
          previewDiv.className = 'jt-template-item-preview';
          previewDiv.textContent = preview + (template.content.length > 50 ? '...' : '');

          info.appendChild(itemHeader);
          info.appendChild(previewDiv);

          // Show "by Name" for company templates
          if (isCompany && template.createdBy) {
            const createdByDiv = document.createElement('div');
            createdByDiv.className = 'jt-template-created-by';
            createdByDiv.textContent = 'by ' + (template.createdBy.name || 'Unknown');
            info.appendChild(createdByDiv);
          }

          // Actions section
          const actions = document.createElement('div');
          actions.className = 'jt-template-item-actions';

          // Set as default button (personal only, not already default)
          if (!isCompany && !isDefault) {
            const defaultBtn = document.createElement('button');
            defaultBtn.className = 'jt-template-action-btn';
            defaultBtn.title = 'Set as default';
            defaultBtn.textContent = '\u2606';
            defaultBtn.addEventListener('click', async (e) => {
              e.stopPropagation();
              await setDefaultTemplate(template.id);
              renderList();
            }, { signal });
            actions.appendChild(defaultBtn);
          }

          // Edit button
          const editBtn = document.createElement('button');
          editBtn.className = 'jt-template-action-btn';
          editBtn.title = 'Edit';
          editBtn.textContent = '\u270E';
          editBtn.addEventListener('click', async (e) => {
            e.stopPropagation();
            const result = await openTemplateEditModal(template, { showDefaultCheckbox: !isCompany });
            if (result) {
              if (isCompany) {
                await saveTeamTemplate({ id: template.id, name: result.name, content: result.content });
              } else {
                await updateTemplate(template.id, { name: result.name, content: result.content });
                if (result.setAsDefault) await setDefaultTemplate(template.id);
              }
              renderList();
            }
          }, { signal });
          actions.appendChild(editBtn);

          // Delete button
          const deleteBtn = document.createElement('button');
          deleteBtn.className = 'jt-template-action-btn jt-template-action-delete';
          deleteBtn.title = 'Delete';
          deleteBtn.textContent = '\uD83D\uDDD1';
          deleteBtn.addEventListener('click', async (e) => {
            e.stopPropagation();
            if (confirm(`Delete "${template.name}"?`)) {
              if (isCompany) {
                await deleteTeamTemplateById(template.id);
              } else {
                await deleteTemplate(template.id);
              }
              renderList();
            }
          }, { signal });
          actions.appendChild(deleteBtn);

          item.appendChild(info);
          item.appendChild(actions);
          list.appendChild(item);
        });

        body.appendChild(list);
      }

      // Close function
      function closeModal() {
        abortController.abort();
        overlay.remove();
        resolve();
      }

      // Event listeners
      closeBtn.addEventListener('click', closeModal, { signal });

      // Close on overlay click + Escape (topmost only)
      wireOverlayDismiss(overlay, closeModal, signal);

      // Add new template button
      addBtn.addEventListener('click', async () => {
        const isCompany = managerTab === 'company';
        const result = await openTemplateEditModal(null, { showDefaultCheckbox: !isCompany });
        if (result) {
          if (isCompany) {
            await saveTeamTemplate({ name: result.name, content: result.content });
          } else {
            await createTemplate(result.name, result.content, result.setAsDefault);
          }
          renderList();
        }
      }, { signal });

      // Add to page and render
      document.body.appendChild(overlay);
      renderList();
    });
  }

  /**
   * Insert signature into a message field
   * @param {HTMLTextAreaElement} field - The textarea element
   * @param {string} signature - The signature text
   */
  function insertSignature(field, signature) {
    if (!field || !signature) return;

    // Get current cursor position
    const start = field.selectionStart;
    const end = field.selectionEnd;
    const currentValue = field.value;

    // Add newlines before signature if there's existing content and no trailing newlines
    let prefix = '';
    if (currentValue.length > 0 && start === currentValue.length) {
      // Cursor at end - add line breaks before signature
      if (!currentValue.endsWith('\n\n')) {
        prefix = currentValue.endsWith('\n') ? '\n' : '\n\n';
      }
    }

    // Insert at cursor position
    const newValue = currentValue.slice(0, start) + prefix + signature + currentValue.slice(end);
    field.value = newValue;

    // Move cursor to end of inserted signature
    const newPosition = start + prefix.length + signature.length;
    field.setSelectionRange(newPosition, newPosition);

    // Trigger React-compatible events
    const inputEvent = new Event('input', { bubbles: true });
    inputEvent.simulated = true;
    field.dispatchEvent(inputEvent);

    const changeEvent = new Event('change', { bubbles: true });
    changeEvent.simulated = true;
    field.dispatchEvent(changeEvent);

    // Focus the field
    field.focus();
  }

  /**
   * Create a dropdown component for template selection
   * @param {HTMLElement} container - The parent container
   * @param {HTMLTextAreaElement} field - The message field
   * @param {Function} updateCounter - Function to update the character counter
   * @returns {Object} Dropdown control object
   */
  function createTemplateDropdown(container, field, updateCounter) {
    const dropdown = document.createElement('div');
    dropdown.className = 'jt-template-dropdown';
    dropdown.style.display = 'none';

    // Store the outside click handler so we can remove it
    let outsideClickHandler = null;
    // Store reference to the trigger button for positioning
    let triggerButton = null;

    function setTriggerButton(btn) {
      triggerButton = btn;
    }

    function buildTabBar() {
      if (!isEssentialPlus) return '';
      return `
        <div class="jt-template-tabs">
          <button class="jt-template-tab ${activeTab === 'personal' ? 'active' : ''}" data-tab="personal">
            My Templates
          </button>
          <button class="jt-template-tab ${activeTab === 'company' ? 'active' : ''}" data-tab="company">
            Company <span class="jt-tab-badge">\u2605</span>
          </button>
        </div>
      `;
    }

    function getActiveTemplates() {
      if (activeTab === 'company') {
        return cachedTeamTemplates.templates;
      }
      return cachedTemplates?.templates || [];
    }

    function getActiveDefaultId() {
      if (activeTab === 'company') return null;
      return cachedTemplates?.defaultTemplateId || null;
    }

    function attachTabHandlers() {
      const tabs = dropdown.querySelectorAll('.jt-template-tab');
      tabs.forEach(tab => {
        tab.addEventListener('click', async (e) => {
          e.stopPropagation();
          const newTab = tab.dataset.tab;
          if (newTab === activeTab) return;
          activeTab = newTab;
          tabs.forEach(t => t.classList.toggle('active', t.dataset.tab === activeTab));
          if (activeTab === 'company') {
            await loadTeamTemplates();
          }
          populate();
        });
      });
    }

    /**
     * Populate the dropdown with templates
     */
    async function populate() {
      await loadTemplates();
      dropdown.innerHTML = '';

      // If company tab is active, ensure team templates are loaded
      if (activeTab === 'company') {
        await loadTeamTemplates();
      }

      // Add tab bar if Essential+ tier
      const tabBarHtml = buildTabBar();
      if (tabBarHtml) {
        const tabBarContainer = document.createElement('div');
        tabBarContainer.innerHTML = tabBarHtml;
        // Append the actual tab bar element (the .jt-template-tabs div)
        const tabBarEl = tabBarContainer.firstElementChild;
        if (tabBarEl) {
          dropdown.appendChild(tabBarEl);
        }
      }

      const templates = getActiveTemplates();
      const defaultId = getActiveDefaultId();
      const isCompanyTab = activeTab === 'company';

      // Template items
      templates.forEach(template => {
        const isDefault = !isCompanyTab && template.id === defaultId;
        const item = document.createElement('div');
        item.className = 'jt-template-dropdown-item';

        const preview = template.content.substring(0, 30).replace(/\n/g, ' ');

        const nameDiv = document.createElement('div');
        nameDiv.className = 'jt-template-dropdown-name';
        nameDiv.textContent = (isDefault ? '\u2605 ' : '') + template.name;

        const previewDiv = document.createElement('div');
        previewDiv.className = 'jt-template-dropdown-preview';
        previewDiv.textContent = preview + (template.content.length > 30 ? '...' : '');

        item.appendChild(nameDiv);
        item.appendChild(previewDiv);

        // For company tab items, show who created it
        if (isCompanyTab && template.createdBy) {
          const createdByDiv = document.createElement('div');
          createdByDiv.className = 'jt-template-created-by';
          createdByDiv.textContent = 'by ' + (template.createdBy.name || 'Unknown');
          item.appendChild(createdByDiv);
        }

        item.addEventListener('click', (e) => {
          e.stopPropagation();
          insertSignature(field, template.content);
          updateCounter();
          hide();
        });

        dropdown.appendChild(item);
      });

      // Separator (if templates exist)
      if (templates.length > 0) {
        const sep = document.createElement('div');
        sep.className = 'jt-template-dropdown-separator';
        dropdown.appendChild(sep);
      }

      // Add new option
      const addNew = document.createElement('div');
      addNew.className = 'jt-template-dropdown-item jt-template-dropdown-add';

      const addIcon = document.createElement('span');
      addIcon.className = 'jt-template-add-icon';
      addIcon.textContent = '+';

      addNew.appendChild(addIcon);
      addNew.appendChild(document.createTextNode(' New Template'));

      addNew.addEventListener('click', async (e) => {
        e.stopPropagation();
        hide();
        const result = await openTemplateEditModal(null, { showDefaultCheckbox: !isCompanyTab });
        if (result) {
          if (isCompanyTab) {
            // Save as company template
            const saved = await saveTeamTemplate({ name: result.name, content: result.content });
            if (saved) {
              insertSignature(field, result.content);
              updateCounter();
            }
          } else {
            // Save as personal template
            const newTemplate = await createTemplate(result.name, result.content, result.setAsDefault);
            insertSignature(field, newTemplate.content);
            updateCounter();
          }
        }
      });

      dropdown.appendChild(addNew);

      // Attach tab handlers after populate
      attachTabHandlers();
    }

    function show() {
      populate();
      dropdown.style.display = 'block';

      // Position the dropdown using fixed positioning
      // Use the stored trigger button reference, or fall back to container
      const buttonRef = triggerButton || container;
      const rect = buttonRef.getBoundingClientRect();
      const dropdownHeight = dropdown.offsetHeight || 300; // Use actual height or estimate
      const dropdownWidth = dropdown.offsetWidth || 220;
      const viewportHeight = window.innerHeight;
      const viewportWidth = window.innerWidth;
      const margin = 8; // Margin from viewport edges

      // Determine if dropdown should open above or below
      const spaceAbove = rect.top;
      const spaceBelow = viewportHeight - rect.bottom;

      let top, left;

      // Prefer opening above (original behavior), but flip to below if not enough space
      if (spaceAbove >= dropdownHeight + margin || spaceAbove > spaceBelow) {
        // Open above the button
        top = Math.max(margin, rect.top - dropdownHeight - 4);
      } else {
        // Open below the button
        top = Math.min(viewportHeight - dropdownHeight - margin, rect.bottom + 4);
      }

      // Horizontal positioning - align left edge with button, but keep within viewport
      left = rect.left;
      if (left + dropdownWidth > viewportWidth - margin) {
        // Would overflow right edge, align to right edge of button instead
        left = Math.max(margin, rect.right - dropdownWidth);
      }
      if (left < margin) {
        left = margin;
      }

      dropdown.style.top = `${top}px`;
      dropdown.style.left = `${left}px`;

      // Add outside click handler
      outsideClickHandler = (e) => {
        // Close if clicking outside both the dropdown and the trigger button
        if (!dropdown.contains(e.target) && !container.contains(e.target) &&
            (!triggerButton || !triggerButton.contains(e.target))) {
          hide();
        }
      };
      // Delay adding the listener to avoid immediate trigger
      setTimeout(() => {
        document.addEventListener('click', outsideClickHandler);
      }, 0);
    }

    function hide() {
      dropdown.style.display = 'none';
      if (outsideClickHandler) {
        document.removeEventListener('click', outsideClickHandler);
        outsideClickHandler = null;
      }
    }

    function toggle() {
      if (dropdown.style.display === 'none') {
        show();
      } else {
        hide();
      }
    }

    function cleanup() {
      hide();
      dropdown.remove();
    }

    return { element: dropdown, show, hide, toggle, cleanup, setTriggerButton };
  }

  /**
   * Check if this is a message textarea (Direct Message, Customer Message, etc.)
   * @param {HTMLElement} field - The textarea element
   * @returns {boolean}
   */
  function isMessageTextarea(field) {
    // Exclude "Send Us A Message" support form - this is JobTread's internal support form
    // Look for the orange header text that says "Send Us A Message"
    const form = field.closest('form');
    if (form) {
      const orangeHeader = form.querySelector('.text-jtOrange.font-bold.uppercase');
      if (orangeHeader && orangeHeader.textContent.toLowerCase().includes('send us a message')) {
        return false;
      }
    }

    // Check placeholder
    const placeholder = (field.placeholder || '').toLowerCase();
    if (placeholder === 'message') return true;

    // Check if inside a message dialog (has "Message" in header)
    const dialog = field.closest('.shadow-lg, [role="dialog"], .modal');
    if (dialog) {
      const header = dialog.querySelector('.font-bold, h1, h2, h3');
      if (header && header.textContent.toLowerCase().includes('message')) {
        return true;
      }
    }

    // Check if inside document-sending modals (Send Estimate, Send Change Order, etc.)
    // These have m-auto.shadow-lg container
    const sendModal = field.closest('.m-auto.shadow-lg');
    if (sendModal) {
      // Check if this modal has an "Email Message" section (using orange label)
      const emailMessageLabel = Array.from(sendModal.querySelectorAll('.text-jtOrange'))
        .find(el => (el.textContent || '').toLowerCase().includes('email message'));

      if (emailMessageLabel) {
        // This is a document-sending modal with email message
        // The textarea should be inside a .rounded-sm.border container
        if (field.closest('.rounded-sm.border')) {
          return true;
        }
        // Or it has caret-black class (JobTread's transparent-text textarea)
        if (field.classList.contains('caret-black')) {
          return true;
        }
      }

      // Also match if modal header says "Send" (Send Estimate, Send Invoice, etc.)
      const modalHeader = sendModal.querySelector('.text-cyan-500');
      if (modalHeader) {
        const headerText = (modalHeader.textContent || '').toLowerCase();
        if (headerText.includes('send')) {
          // Any textarea in a Send modal is likely the message field
          if (field.closest('.rounded-sm.border') || field.classList.contains('caret-black')) {
            return true;
          }
        }
      }
    }

    // Check if this is the Notes textarea inside the Daily Log sidebar
    // Detect sidebar via Freeze Header's class OR native JT sidebar classes
    const sidebar = field.closest('.jt-global-sidebar') ||
                    field.closest('div.sticky.overflow-y-auto.overscroll-contain');
    if (sidebar) {
      // Verify this is a Daily Log sidebar (not any random sidebar)
      const sidebarText = sidebar.textContent || '';
      const isDailyLog = sidebarText.includes('DAILY LOG') ||
                         sidebarText.includes('Daily Log') ||
                         (sidebarText.includes('Weather') && sidebarText.includes('Notes') && sidebarText.includes('Unplanned Tasks'));
      if (isDailyLog) {
        const parentDiv = field.closest('.space-y-1')?.parentElement;
        if (parentDiv) {
          const label = parentDiv.querySelector(':scope > .font-bold');
          if (label && label.textContent.trim() === 'Notes') {
            return true;
          }
        }
        const container = field.closest('.rounded-sm.border');
        if (container) {
          const prevLabel = container.parentElement?.querySelector(':scope > .font-bold');
          if (prevLabel && prevLabel.textContent.trim() === 'Notes') {
            return true;
          }
        }
      }
    }

    return false;
  }

  /**
   * Check if a field lives inside a pop-up window (a JobTread modal dialog).
   * Pop-ups are the message compose dialogs and document-sending modals
   * (Send Estimate, Send Invoice, etc.), which render inside a
   * shadow-lg / [role="dialog"] / .modal container. Inline message fields —
   * the activity-feed reply box and the Daily Log sidebar Notes field — are
   * message fields too, but are NOT pop-up windows.
   * @param {HTMLElement} field - The textarea element
   * @returns {boolean}
   */
  function isInPopupWindow(field) {
    return !!field.closest('[role="dialog"], .modal, .shadow-lg');
  }

  /**
   * Determine the character limit for a field
   * @param {HTMLElement} field - The textarea or input element
   * @returns {number} The character limit
   */
  function getFieldLimit(field) {
    // First, check for explicit maxlength attribute
    const maxLength = field.getAttribute('maxlength');
    if (maxLength) {
      return parseInt(maxLength, 10);
    }

    // Check for data attribute
    const dataLimit = field.getAttribute('data-char-limit');
    if (dataLimit) {
      return parseInt(dataLimit, 10);
    }

    // Check if this is a message textarea - 4096 limit
    if (isMessageTextarea(field)) {
      return FIELD_LIMITS.message;
    }

    // Try to infer from field name, id, placeholder, or aria-label
    const identifiers = [
      field.name,
      field.id,
      field.placeholder,
      field.getAttribute('aria-label'),
      field.getAttribute('data-field'),
      field.getAttribute('data-testid')
    ].filter(Boolean).map(s => s.toLowerCase());

    // Check each identifier against known field types
    for (const identifier of identifiers) {
      for (const [fieldType, limit] of Object.entries(FIELD_LIMITS)) {
        if (fieldType !== 'default' && identifier.includes(fieldType)) {
          return limit;
        }
      }
    }

    // Check parent labels for hints
    const label = field.closest('label') ||
                  document.querySelector(`label[for="${field.id}"]`);
    if (label) {
      const labelText = label.textContent.toLowerCase();
      for (const [fieldType, limit] of Object.entries(FIELD_LIMITS)) {
        if (fieldType !== 'default' && labelText.includes(fieldType)) {
          return limit;
        }
      }
    }

    // Return default limit for textareas
    return FIELD_LIMITS.default;
  }

  /**
   * Create and attach a counter to a field
   * @param {HTMLElement} field - The textarea or input element
   */
  function attachCounter(field) {
    // Skip if already processed
    if (processedFields.has(field)) return;

    // Only show counter on message textareas
    if (!isMessageTextarea(field)) {
      return;
    }

    const maxLength = getFieldLimit(field);
    const isMessage = true; // Always true now since we only process messages

    // The expand toggle only belongs in pop-up windows (message compose dialogs
    // and document-sending modals). Inline message fields — the activity-feed
    // reply box and the Daily Log sidebar Notes field — match isMessageTextarea
    // too, but the expand button is excluded there.
    const inPopupWindow = isInPopupWindow(field);

    // Create container (wraps buttons and counter)
    const container = document.createElement('div');
    container.className = 'jt-signature-container';

    // Create counter element first (needed for updateCounter reference)
    const counter = document.createElement('div');
    counter.className = 'jt-char-counter safe jt-char-counter-message';
    counter.setAttribute('aria-live', 'polite');
    counter.setAttribute('aria-atomic', 'true');
    counter.style.margin = '0'; // Remove margin since it's in container

    /**
     * Update the counter display
     */
    function updateCounter() {
      const currentLength = field.value.length;
      const remaining = maxLength - currentLength;

      // Update text
      if (remaining < 0) {
        counter.textContent = `${Math.abs(remaining)} over limit`;
        counter.className = 'jt-char-counter over-limit jt-char-counter-message';
      } else if (remaining === 0) {
        counter.textContent = 'Limit reached';
        counter.className = 'jt-char-counter danger jt-char-counter-message';
      } else {
        // Show compact format for messages
        counter.textContent = `${currentLength.toLocaleString()} / ${maxLength.toLocaleString()}`;

        // Color coding based on remaining percentage
        const percentRemaining = (remaining / maxLength) * 100;
        let colorClass = 'safe';
        if (percentRemaining <= 5) {
          colorClass = 'danger';
        } else if (percentRemaining <= 15) {
          colorClass = 'warning';
        }
        counter.className = 'jt-char-counter ' + colorClass + ' jt-char-counter-message';
      }
      counter.style.margin = '0'; // Keep margin reset
    }

    // Create Templates dropdown button (native JobTread button styling)
    // Using div[role="button"] to match JobTread's native buttons
    const dropdownBtn = document.createElement('div');
    dropdownBtn.setAttribute('role', 'button');
    dropdownBtn.setAttribute('tabindex', '0');
    dropdownBtn.className = 'jt-native-btn jt-template-dropdown-btn';
    dropdownBtn.title = 'Insert a template';
    // Phosphor-style "article" / document template icon (simplified)
    dropdownBtn.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2" class="inline-block overflow-visible h-[1em] w-[1em] align-[-0.125em]" viewBox="0 0 24 24"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path><polyline points="14 2 14 8 20 8"></polyline><line x1="16" y1="13" x2="8" y2="13"></line><line x1="16" y1="17" x2="8" y2="17"></line><polyline points="10 9 9 9 8 9"></polyline></svg>`;

    // Create dropdown component
    const dropdown = createTemplateDropdown(container, field, updateCounter);

    // Create Settings button (native JobTread button styling with gear icon)
    const settingsBtn = document.createElement('div');
    settingsBtn.setAttribute('role', 'button');
    settingsBtn.setAttribute('tabindex', '0');
    settingsBtn.className = 'jt-native-btn jt-settings-btn';
    settingsBtn.title = 'Manage templates';
    // Phosphor-style gear icon
    settingsBtn.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2" class="inline-block overflow-visible h-[1em] w-[1em] align-[-0.125em]" viewBox="0 0 24 24"><circle cx="12" cy="12" r="3"></circle><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"></path></svg>`;

    // Create Expand button — toggles the textarea's outer container between
    // the default Tailwind max-h-[20vh] and a larger 70vh so long messages
    // don't force the user to scroll a tiny window. Only built for pop-up
    // windows; inline message fields don't get an expand toggle.
    const getTextareaContainer = () =>
      field.closest('.border.rounded-b-sm, .rounded-sm.border');

    let expandBtn = null;
    if (inPopupWindow) {
      const EXPAND_ICON = `<svg xmlns="http://www.w3.org/2000/svg" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2" class="inline-block overflow-visible h-[1em] w-[1em] align-[-0.125em]" viewBox="0 0 24 24"><polyline points="15 3 21 3 21 9"></polyline><polyline points="9 21 3 21 3 15"></polyline><line x1="21" y1="3" x2="14" y2="10"></line><line x1="3" y1="21" x2="10" y2="14"></line></svg>`;
      const COLLAPSE_ICON = `<svg xmlns="http://www.w3.org/2000/svg" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2" class="inline-block overflow-visible h-[1em] w-[1em] align-[-0.125em]" viewBox="0 0 24 24"><polyline points="4 14 10 14 10 20"></polyline><polyline points="20 10 14 10 14 4"></polyline><line x1="14" y1="10" x2="21" y2="3"></line><line x1="3" y1="21" x2="10" y2="14"></line></svg>`;
      expandBtn = document.createElement('div');
      expandBtn.setAttribute('role', 'button');
      expandBtn.setAttribute('tabindex', '0');
      expandBtn.className = 'jt-native-btn jt-expand-btn';
      expandBtn.title = 'Expand message field';
      expandBtn.innerHTML = EXPAND_ICON;

      let isFieldExpanded = false;
      const handleExpandToggle = (e) => {
        e.preventDefault();
        e.stopPropagation();
        const textareaContainer = getTextareaContainer();
        if (!textareaContainer) return;
        isFieldExpanded = !isFieldExpanded;
        if (isFieldExpanded) {
          textareaContainer.classList.add('jt-message-expanded');
          expandBtn.innerHTML = COLLAPSE_ICON;
          expandBtn.title = 'Collapse message field';
        } else {
          textareaContainer.classList.remove('jt-message-expanded');
          expandBtn.innerHTML = EXPAND_ICON;
          expandBtn.title = 'Expand message field';
        }
      };
      expandBtn.addEventListener('click', handleExpandToggle);
      expandBtn.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          handleExpandToggle(e);
        }
      });
    }

    // Create TWO separate containers:
    // 1. Counter container (goes on LEFT side, after upload buttons)
    // 2. Templates container (goes on RIGHT side, next to Send button)

    // Counter container (just the counter)
    const counterContainer = document.createElement('div');
    counterContainer.className = 'jt-signature-container jt-counter-only';
    counterContainer.appendChild(counter);

    // Templates container (expand + dropdown + settings button — joined as one pill).
    // The expand button is only present in pop-up windows.
    const templatesContainer = document.createElement('div');
    templatesContainer.className = 'jt-signature-container jt-templates-only';
    if (expandBtn) templatesContainer.appendChild(expandBtn);
    templatesContainer.appendChild(dropdownBtn);
    templatesContainer.appendChild(settingsBtn);

    // Append dropdown to body for proper z-index stacking (fixed positioning)
    document.body.appendChild(dropdown.element);
    // Store reference to trigger button for positioning
    dropdown.setTriggerButton(dropdownBtn);

    // The main container reference (for cleanup tracking)
    container.appendChild(counterContainer);
    container.appendChild(templatesContainer);
    container.style.display = 'contents'; // Makes container invisible, children flow naturally

    // Store reference to container for this field
    fieldToContainerMap.set(field, container);

    // Handle dropdown button click and keyboard
    const handleDropdownActivate = (e) => {
      e.preventDefault();
      e.stopPropagation();
      dropdown.toggle();
    };
    dropdownBtn.addEventListener('click', handleDropdownActivate);
    dropdownBtn.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        handleDropdownActivate(e);
      }
    });

    // Handle settings button click and keyboard
    const handleSettingsActivate = async (e) => {
      e.preventDefault();
      e.stopPropagation();
      dropdown.hide();
      await openTemplateManagerModal();
    };
    settingsBtn.addEventListener('click', handleSettingsActivate);
    settingsBtn.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        handleSettingsActivate(e);
      }
    });

    // Store dropdown cleanup reference
    const dropdownCleanup = dropdown.cleanup;

    // Attach event listeners. The paste handler is stored in a named ref so
    // cleanup() can actually remove it — an inline arrow can't be unregistered.
    const pasteHandler = () => setTimeout(updateCounter, 0);
    field.addEventListener('input', updateCounter);
    field.addEventListener('keyup', updateCounter);
    field.addEventListener('paste', pasteHandler);

    // Show/hide counter on focus/blur (except for message dialogs which are always visible)
    if (!isMessage) {
      // Track focus state
      let isFocused = false;
      let hideTimeout = null;

      const showCounter = () => {
        isFocused = true;
        if (hideTimeout) {
          clearTimeout(hideTimeout);
          hideTimeout = null;
        }
        counter.classList.add('visible');
      };

      const hideCounter = () => {
        isFocused = false;
        // Longer delay to handle JobTread's UI interactions
        hideTimeout = setTimeout(() => {
          if (!isFocused) {
            counter.classList.remove('visible');
          }
        }, 300);
      };

      field.addEventListener('focus', showCounter);
      field.addEventListener('blur', hideCounter);
      // Also show on click in case focus event doesn't fire properly
      field.addEventListener('click', showCounter);
      // Keep visible while typing
      field.addEventListener('input', showCounter);
    }

    // Find the best insertion point for the container (replaces counter-only insertion)
    const parent = field.parentElement;
    if (parent) {
      if (isMessage) {
        // For message textareas, find the toolbar below the textarea
        // Structure: div.flex.justify-between containing buttons and Send button
        // We want to insert the container next to the writing assistant buttons
        const dialog = field.closest('.shadow-lg, [role="dialog"], .modal, form');
        let toolbar = null;

        if (dialog) {
          // FIRST: Check for document-sending modals (Send Estimate, Send Change Order, etc.)
          // These have a sticky footer with Cancel and Send buttons
          // Check this BEFORE other toolbars to ensure proper positioning
          const stickyFooter = dialog.querySelector('.sticky.border-t');
          if (stickyFooter) {
            // Verify it has a Send button (div with role="button" containing "Send")
            const buttons = stickyFooter.querySelectorAll('[role="button"]');
            const sendBtn = Array.from(buttons).find(b => b.textContent.trim() === 'Send');
            if (sendBtn) {
              toolbar = stickyFooter;
            }
          }

          // SECOND: If no sticky footer found, look for flex.justify-between toolbars
          // These are used in standard message dialogs and reply forms
          if (!toolbar) {
            const toolbars = dialog.querySelectorAll('div.flex.justify-between');
            for (const t of toolbars) {
              // Look for the one with a Send button
              const sendButton = t.querySelector('button[type="submit"]') ||
                                 Array.from(t.querySelectorAll('button')).find(b => b.textContent.trim() === 'Send');
              if (sendButton) {
                toolbar = t;
                break;
              }
              // Also match toolbars with a right-side button container (reply forms)
              if (t.querySelector('div.shrink-0')) {
                toolbar = t;
                break;
              }
            }
          }
        }

        if (toolbar) {
          if (toolbar.classList.contains('sticky')) {
            // Document-sending modal (sticky footer) - both go together before Cancel
            const cancelBtn = toolbar.querySelector('[role="button"]');
            if (cancelBtn) {
              counterContainer.style.marginRight = '8px';
              toolbar.insertBefore(templatesContainer, cancelBtn);
              toolbar.insertBefore(counterContainer, templatesContainer);
            } else {
              toolbar.insertBefore(counterContainer, toolbar.firstChild);
              toolbar.insertBefore(templatesContainer, counterContainer.nextSibling);
            }
          } else {
            // Insert counter + templates into the action bar as a group
            // between the left buttons (upload/copy/gif) and the right side (Send)
            // margin-left:auto pushes the group rightward without crowding Send
            const group = document.createElement('div');
            group.className = 'jt-counter-templates-group';
            group.appendChild(counterContainer);
            group.appendChild(templatesContainer);

            const rightSide = toolbar.querySelector('div.shrink-0');
            if (rightSide) {
              toolbar.insertBefore(group, rightSide);
            } else {
              toolbar.appendChild(group);
            }
          }
        } else {
          // Fallback: add both in a row after the textarea's container
          const textareaContainer = field.closest('.border.rounded-b-sm, .rounded-sm.border') || parent;
          if (textareaContainer.parentElement) {
            const wrapper = document.createElement('div');
            wrapper.className = 'jt-signature-container-row';
            wrapper.style.marginTop = '8px';
            wrapper.style.display = 'flex';
            wrapper.style.justifyContent = 'space-between';
            wrapper.appendChild(counterContainer);
            wrapper.appendChild(templatesContainer);
            textareaContainer.parentElement.insertBefore(wrapper, textareaContainer.nextSibling);
          }
        }
      } else {
        // Standard positioning: after the field
        if (field.nextSibling) {
          parent.insertBefore(container, field.nextSibling);
        } else {
          parent.appendChild(container);
        }
      }
    }

    // Mark as processed
    processedFields.add(field);

    // Initial update
    updateCounter();

    // Store cleanup function on the element
    field._jtCounterCleanup = () => {
      field.removeEventListener('input', updateCounter);
      field.removeEventListener('keyup', updateCounter);
      field.removeEventListener('paste', pasteHandler);
      // Focus/blur listeners are anonymous so they'll be garbage collected
      // Cleanup dropdown
      dropdownCleanup();
      // Reset expanded-state class on the textarea container so the next
      // re-init starts collapsed even if the modal is still open
      const expandedContainer = getTextareaContainer();
      if (expandedContainer) expandedContainer.classList.remove('jt-message-expanded');
      // Remove the group wrapper if counter is inside one (inline toolbar layout)
      const group = counterContainer.closest('.jt-counter-templates-group');
      if (group) group.remove();
      // Remove containers - they may be placed separately for message fields
      counterContainer.remove();
      templatesContainer.remove();
      container.remove();
    };

    // If field is already focused, show the counter immediately
    if (document.activeElement === field && !isMessage) {
      counter.classList.add('visible');
    }
  }

  /**
   * Find and process all text fields on the page
   */
  function processAllFields() {
    // Find all textareas - these are the main target
    const textareas = document.querySelectorAll('textarea:not([data-jt-no-counter])');
    textareas.forEach(attachCounter);
  }

  /**
   * Initialize the feature
   */
  async function init() {
    if (isActiveState) return;

    isActiveState = true;
    console.log('CharacterCounter: Activated');

    // Inject styles
    injectStyles();

    // Load templates from storage (includes migration from old signature)
    await loadTemplates();

    // Check tier for company templates tab (must await before processing fields)
    await checkEssentialTier();
    if (isEssentialPlus) {
      activeTab = 'company';
    }

    // Process existing fields
    processAllFields();

    // Watch for new fields being added (dialogs opening, etc.)
    observer = new MutationObserver((mutations) => {
      let shouldProcess = false;

      for (const mutation of mutations) {
        if (mutation.addedNodes.length > 0) {
          for (const node of mutation.addedNodes) {
            if (node.nodeType === Node.ELEMENT_NODE) {
              // Check if the added node contains textareas
              if (node.tagName === 'TEXTAREA' ||
                  (node.querySelector && node.querySelector('textarea'))) {
                shouldProcess = true;
                break;
              }
            }
          }
        }
        if (shouldProcess) break;
      }

      if (shouldProcess) {
        // Debounce processing
        if (debounceTimer) clearTimeout(debounceTimer);
        debounceTimer = setTimeout(() => {
          processAllFields();
        }, 100);
      }
    });

    observer.observe(document.body, {
      childList: true,
      subtree: true
    });
  }

  /**
   * Cleanup the feature
   */
  function cleanup() {
    if (!isActiveState) return;

    isActiveState = false;
    console.log('CharacterCounter: Deactivated');

    // Disconnect observer
    if (observer) {
      observer.disconnect();
      observer = null;
    }

    // Clear debounce timer
    if (debounceTimer) {
      clearTimeout(debounceTimer);
      debounceTimer = null;
    }

    // Remove any open modals (signature and template modals)
    document.querySelectorAll('.jt-signature-modal-overlay').forEach(modal => {
      modal.remove();
    });

    // Remove all template dropdowns
    document.querySelectorAll('.jt-template-dropdown').forEach(dropdown => {
      dropdown.remove();
    });

    // Remove all signature container rows (for sidebar layout)
    document.querySelectorAll('.jt-signature-container-row').forEach(row => {
      row.remove();
    });

    // Remove all counter+templates groups (for inline toolbar layout)
    document.querySelectorAll('.jt-counter-templates-group').forEach(group => {
      group.remove();
    });

    // Remove all signature containers (which include counters)
    document.querySelectorAll('.jt-signature-container').forEach(container => {
      container.remove();
    });

    // Remove any standalone counters (fallback)
    document.querySelectorAll('.jt-char-counter').forEach(counter => {
      counter.remove();
    });

    // Clean up event listeners from processed fields
    document.querySelectorAll('textarea, input').forEach(field => {
      if (field._jtCounterCleanup) {
        field._jtCounterCleanup();
        delete field._jtCounterCleanup;
      }
    });

    // Clear cached templates
    cachedTemplates = { templates: [], defaultTemplateId: null };
    cachedTeamTemplates = { templates: [], lastSync: null };
    isEssentialPlus = false;
    activeTab = 'personal';

    // Remove styles
    removeStyles();
  }

  // Public API
  return {
    init,
    cleanup,
    isActive: () => isActiveState,
    // Expose for potential customization
    setFieldLimit: (fieldName, limit) => {
      FIELD_LIMITS[fieldName.toLowerCase()] = limit;
    }
  };
})();

// Export for use in main content script
if (typeof window !== 'undefined') {
  window.CharacterCounterFeature = CharacterCounterFeature;
}
