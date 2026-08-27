/**
 * Quick Notes Feature
 * Provides a persistent notepad accessible from any Jobtread page
 *
 * Dependencies:
 * - features/quick-notes-modules/storage.js (QuickNotesStorage)
 * - features/preview-mode-modules/jt-markdown.js (JTMarkdown) — the shared
 *   JobTread-parity renderer; also this feature's own preview markup.
 */

const QuickNotesFeature = (() => {
  // State variables
  let isActive = false;
  let notesPanel = null;
  let notesButton = null;
  let buttonObserver = null;
  let periodicCheckInterval = null;
  let retryInjectInterval = null;
  let notes = [];  // Personal notes (My Notes)
  let teamNotes = []; // Team notes (shared)
  let activeTab = 'my'; // 'my' or 'team'
  let currentNoteId = null;
  let searchTerm = '';
  let isResizing = false;
  let isLoadingTeamNotes = false;
  let teamNotesLoaded = false;
  // Current selectionchange handler bound for the note editor. Re-rendering
  // the editor (switching notes / tabs / folders) registers a new one; this
  // lets us remove the previous one so listeners don't accumulate.
  let selectionChangeHandler = null;
  // The shared Text Formatter toolbar (window.FormatterToolbar) embedded
  // above the note body. Re-rendering the editor replaces the DOM out from
  // under it via innerHTML, which would otherwise detach the toolbar without
  // disconnecting its ResizeObserver — see FormatterToolbar.destroyToolbar's
  // own comment on the memory leak that exact gap caused elsewhere in the
  // product. Tracked here so every render/cleanup path can tear it down
  // through that helper first.
  let embeddedFormatterToolbar = null;

  // Folder organization state
  let myNotesCollapsedFolders = new Set(); // Collapsed folders for My Notes
  let teamNotesCollapsedFolders = new Set(); // Collapsed folders for Team Notes
  let myNotesFolderColors = {}; // { folderName: '#hexcolor' } for My Notes
  let teamNotesFolderColors = {}; // { folderName: '#hexcolor' } for Team Notes
  let myNotesFolderOrder = []; // Custom folder order for My Notes
  let teamNotesFolderOrder = []; // Custom folder order for Team Notes
  let myNotesNoteOrder = {}; // { folderName: [noteId1, noteId2, ...] } for My Notes
  let teamNotesNoteOrder = {}; // { folderName: [noteId1, noteId2, ...] } for Team Notes
  let activeFolder = 'General'; // Current folder for new notes

  // Drag state for folder/note reordering
  let dragState = {
    type: null,       // 'folder' or 'note'
    sourceId: null,   // folder name or note ID
    sourceElement: null
  };

  // Polling sync state
  let teamNotesPollInterval = null;
  const POLL_INTERVAL_MS = 15000; // Poll every 15 seconds when on team tab

  // Sidebar collapse state
  let isSidebarCollapsed = false;

  // Store resize event handlers for cleanup
  const resizeHandlers = {
    mouseMove: null,
    mouseUp: null
  };

  // Module references (loaded after DOM ready)
  const getStorage = () => window.QuickNotesStorage || {};

  /**
   * Thin facade over Sanitizer + JTMarkdown for the sidebar note-list
   * rendering below (renderNoteItem/renderFolderGroup), which only needs
   * "escape this text" and "render this note to HTML" — it doesn't care
   * that those now come from two different globals instead of the old
   * QuickNotesMarkdown module. Defensive the same way getStorage() is:
   * the lifecycle smoke test imports this file with neither Sanitizer nor
   * JTMarkdown loaded, and renderNoteItem's own `markdown.escapeHtml ? ... :`
   * guards already expect a missing method, not a missing object.
   */
  const getMarkdown = () => {
    const sanitizer = window.Sanitizer;
    const jt = window.JTMarkdown;
    return {
      escapeHtml: (sanitizer && sanitizer.escapeHTML) ? sanitizer.escapeHTML : null,
      parseMarkdown: (jt && jt.render) ? (text) => jt.render(text, { taskLists: true }) : null
    };
  };

  // The one definition of "this line is a checkbox" for the tick handler
  // below (toggleCheckboxLine). Requires a literal single space between the
  // dash and the bracket — matching window.JTMarkdown's own TASK_MARKER
  // (preview-mode-modules/jt-markdown.js), which is what actually decides
  // whether a line rendered an interactive checkbox. Quick Notes is the only
  // consumer now that quick-notes-modules/markdown.js is gone; dialect-convert.js
  // keeps its own independent copy (by design — see that file) rather than
  // importing this one.
  const CHECKBOX_LINE_RE = /^- \[([ xX])\]/;

  // Constants from storage module (with fallbacks)
  const MIN_WIDTH = 320;
  const MAX_WIDTH = 1200;
  const MIN_EDITOR_WIDTH = 452; // Minimum width for editor (to fit the embedded formatter toolbar)
  const COLLAPSED_SIDEBAR_WIDTH = 48;
  const WIDTH_STORAGE_KEY = 'jtToolsQuickNotesWidth';

  // Check if team notes are available (user is logged in)
  function isTeamNotesAvailable() {
    return window.AccountService && window.AccountService.isLoggedIn();
  }

  // Get the currently active notes array
  function getCurrentNotes() {
    return activeTab === 'my' ? notes : teamNotes;
  }

  // Helper to load notes using storage module (sync-aware)
  async function loadNotes() {
    const storage = getStorage();
    // Use sync-aware load if available and user is logged in
    if (storage.loadNotesWithSync && storage.isSyncAvailable && storage.isSyncAvailable()) {
      notes = await storage.loadNotesWithSync();
      return notes;
    }
    // Fallback to regular load
    if (storage.loadNotes) {
      notes = await storage.loadNotes();
      return notes;
    }
    return [];
  }

  // Helper to save notes using storage module (sync-aware)
  async function saveNotes() {
    const storage = getStorage();
    // Use sync-aware save if available and user is logged in
    if (storage.saveNotesWithSync && storage.isSyncAvailable && storage.isSyncAvailable()) {
      return await storage.saveNotesWithSync(notes);
    }
    // Fallback to regular save
    if (storage.saveNotes) {
      return await storage.saveNotes(notes);
    }
    return false;
  }

  // Load team notes from server
  async function loadTeamNotesFromServer() {
    if (!isTeamNotesAvailable()) {
      teamNotes = [];
      return [];
    }

    if (isLoadingTeamNotes) return teamNotes;
    isLoadingTeamNotes = true;

    try {
      console.log('QuickNotes: Loading team notes...');
      const result = await window.AccountService.getTeamNotes();

      if (result.success) {
        teamNotes = result.notes || [];
        teamNotesLoaded = true;
        console.log('QuickNotes: Team notes loaded', { count: teamNotes.length });
      } else {
        console.warn('QuickNotes: Failed to load team notes', result.error);
      }
    } catch (error) {
      console.error('QuickNotes: Error loading team notes', error);
    } finally {
      isLoadingTeamNotes = false;
    }

    return teamNotes;
  }

  // Switch between My Notes and Team Notes tabs
  async function switchTab(tab) {
    if (tab === activeTab) return;

    activeTab = tab;
    currentNoteId = null;
    searchTerm = '';

    // Clear search input
    const searchInput = notesPanel?.querySelector('.jt-notes-search-input');
    if (searchInput) searchInput.value = '';

    // Handle polling based on tab
    if (tab === 'team') {
      // If switching to team notes, load from server and start polling
      if (!teamNotesLoaded) {
        await loadTeamNotesFromServer();
      }
      startTeamNotesPolling();
    } else {
      // Stop polling when switching away from team tab
      stopTeamNotesPolling();
    }

    renderTabs();
    renderNotesList();
    renderNoteEditor();
  }

  // Render the tabs UI
  function renderTabs() {
    const tabsContainer = notesPanel?.querySelector('.jt-notes-tabs');
    if (!tabsContainer) return;

    const myCount = notes.length;
    const teamCount = teamNotes.length;
    const showTeamTab = isTeamNotesAvailable();

    tabsContainer.innerHTML = `
      <button class="jt-notes-tab ${activeTab === 'my' ? 'active' : ''}" data-tab="my">
        My Notes
        <span class="jt-notes-tab-count">${myCount}</span>
      </button>
      ${showTeamTab ? `
        <button class="jt-notes-tab ${activeTab === 'team' ? 'active' : ''}" data-tab="team">
          Team Notes
          <span class="jt-notes-tab-count">${teamCount}</span>
        </button>
      ` : ''}
    `;

    // Add click handlers for tabs
    tabsContainer.querySelectorAll('.jt-notes-tab').forEach(tab => {
      tab.addEventListener('click', () => {
        const tabName = tab.dataset.tab;
        switchTab(tabName);
      });
    });
  }

  // Create a new note (handles both personal and team notes)
  async function createNote(folder = null) {
    const targetFolder = folder || activeFolder || 'General';

    if (activeTab === 'team') {
      // Create team note
      await createTeamNote(targetFolder);
    } else {
      // Create personal note
      const storage = getStorage();
      const note = {
        id: storage.generateId ? storage.generateId() : Date.now().toString(36),
        title: 'Untitled Note',
        content: '',
        folder: targetFolder,
        createdAt: Date.now(),
        updatedAt: Date.now()
      };
      notes.unshift(note);
      currentNoteId = note.id;
      saveNotes();
      renderNotesList();
      renderNoteEditor();
      // Open editor when creating new note
      openEditor();
    }
  }

  // Create a new team note
  async function createTeamNote(folder = 'General') {
    if (!isTeamNotesAvailable()) {
      alert('Please sign in to create team notes.');
      return;
    }

    try {
      const result = await window.AccountService.saveTeamNote({
        title: 'Untitled Note',
        content: '',
        folder: folder,
        isPinned: false
      });

      if (result.success) {
        const newNote = {
          id: result.data.id,
          title: 'Untitled Note',
          content: '',
          folder: folder,
          isPinned: false,
          createdBy: result.data.createdBy,
          updatedBy: null,
          createdAt: result.data.createdAt,
          updatedAt: result.data.createdAt
        };
        teamNotes.unshift(newNote);
        currentNoteId = newNote.id;
        renderTabs();
        renderNotesList();
        renderNoteEditor();
        openEditor();
      } else {
        alert('Failed to create team note: ' + result.error);
      }
    } catch (error) {
      console.error('QuickNotes: Error creating team note', error);
      alert('Failed to create team note. Please try again.');
    }
  }

  // Delete a note (handles both personal and team notes)
  async function deleteNote(noteId) {
    if (!confirm('Are you sure you want to delete this note?')) {
      return;
    }

    if (activeTab === 'team') {
      // Delete team note
      await deleteTeamNote(noteId);
    } else {
      // Track deletion for sync before removing from array
      await QuickNotesStorage.trackDeletedNote(noteId);

      // Delete personal note
      notes = notes.filter(n => n.id !== noteId);
      if (currentNoteId === noteId) {
        currentNoteId = notes.length > 0 ? notes[0].id : null;
      }
      saveNotes();
      renderNotesList();
      renderNoteEditor();
    }
  }

  // Delete a team note
  async function deleteTeamNote(noteId) {
    try {
      const result = await window.AccountService.deleteTeamNote(noteId);

      if (result.success) {
        teamNotes = teamNotes.filter(n => n.id !== noteId);
        if (currentNoteId === noteId) {
          currentNoteId = teamNotes.length > 0 ? teamNotes[0].id : null;
        }
        renderTabs();
        renderNotesList();
        renderNoteEditor();
      } else {
        alert('Failed to delete team note: ' + result.error);
      }
    } catch (error) {
      console.error('QuickNotes: Error deleting team note', error);
      alert('Failed to delete team note. Please try again.');
    }
  }

  // Export notes as JSON file (uses storage module)
  function exportNotes() {
    const storage = getStorage();
    if (storage.exportNotes) {
      storage.exportNotes(notes);
    }
  }

  // Import notes from JSON file (uses storage module)
  function importNotes() {
    const storage = getStorage();
    if (storage.importNotes) {
      storage.importNotes(notes, async (importedNotes, mode, count) => {
        notes = importedNotes;
        await saveNotes();
        await loadNotes();

        if (mode === 'merge') {
          alert(`Successfully imported ${count} new note(s)!\n${notes.length} total notes.`);
        } else {
          alert(`Successfully replaced notes!\n${notes.length} note(s) imported.`);
        }

        // Reset current note and re-render
        currentNoteId = notes.length > 0 ? notes[0].id : null;
        renderNotesList();
        renderNoteEditor();
      });
    }
  }

  // Update note content (handles both personal and team notes)
  function updateNote(noteId, updates) {
    if (activeTab === 'team') {
      updateTeamNote(noteId, updates);
    } else {
      const note = notes.find(n => n.id === noteId);
      if (note) {
        Object.assign(note, updates, { updatedAt: Date.now() });
        saveNotes();
        renderNotesList();
      }
    }
  }

  // Debounced personal-note save. Module scope, not per-render: the timer
  // used to be a local of renderNoteEditor(), so nothing outside that closure
  // could cancel it. Two ways that bit — a save could land after cleanup()
  // had torn the panel down and reset state, and every re-render abandoned
  // the previous pass's timer still armed.
  let noteSaveTimeout = null;
  let pendingNoteSave = null;

  // Run a queued save now instead of waiting out the debounce.
  function flushPendingNoteSave() {
    if (!pendingNoteSave) return;
    clearTimeout(noteSaveTimeout);
    noteSaveTimeout = null;
    const run = pendingNoteSave;
    pendingNoteSave = null;
    run();
  }

  // Drop a queued save without running it. For teardown, where the note the
  // save targets is about to stop existing.
  function cancelPendingNoteSave() {
    clearTimeout(noteSaveTimeout);
    noteSaveTimeout = null;
    pendingNoteSave = null;
  }

  // Debounced team note save
  let teamNoteSaveTimeout = null;
  const TEAM_NOTE_SAVE_DEBOUNCE = 1000; // 1 second

  // Update a team note (debounced save to server)
  function updateTeamNote(noteId, updates) {
    const note = teamNotes.find(n => n.id === noteId);
    if (!note) return;

    // Update local copy immediately for responsiveness
    Object.assign(note, updates, { updatedAt: Date.now() });
    renderNotesList();

    // Debounce the server save
    clearTimeout(teamNoteSaveTimeout);
    teamNoteSaveTimeout = setTimeout(async () => {
      try {
        const result = await window.AccountService.saveTeamNote({
          id: noteId,
          title: note.title,
          content: note.content,
          folder: note.folder || 'General',
          isPinned: note.isPinned || false
        });

        if (result.success) {
          // Update with server response
          note.updatedBy = result.data.updatedBy;
          note.updatedAt = result.data.updatedAt;
          renderNotesList();
          console.log('QuickNotes: Team note saved to server');
        } else {
          console.error('QuickNotes: Failed to save team note', result.error);
        }
      } catch (error) {
        console.error('QuickNotes: Error saving team note', error);
      }
    }, TEAM_NOTE_SAVE_DEBOUNCE);
  }

  // Format date
  function formatDate(timestamp) {
    const date = new Date(timestamp);
    const now = new Date();
    const diff = now - date;
    const days = Math.floor(diff / (1000 * 60 * 60 * 24));

    if (days === 0) {
      const hours = Math.floor(diff / (1000 * 60 * 60));
      if (hours === 0) {
        const minutes = Math.floor(diff / (1000 * 60));
        return minutes === 0 ? 'Just now' : `${minutes}m ago`;
      }
      return `${hours}h ago`;
    } else if (days === 1) {
      return 'Yesterday';
    } else if (days < 7) {
      return `${days}d ago`;
    } else {
      return date.toLocaleDateString();
    }
  }

  // ============================================================
  // FOLDER ORGANIZATION
  // ============================================================

  // Get the collapsed folders set for the current tab
  function getCollapsedFolders() {
    return activeTab === 'team' ? teamNotesCollapsedFolders : myNotesCollapsedFolders;
  }

  // Group notes by folder
  function groupNotesByFolder(notes) {
    const grouped = {};
    for (const note of notes) {
      const folder = note.folder || 'General';
      if (!grouped[folder]) grouped[folder] = [];
      grouped[folder].push(note);
    }

    // Sort notes within each folder: pinned first, then by custom order or updatedAt
    for (const folder in grouped) {
      const customOrder = getNoteOrder(folder);

      grouped[folder].sort((a, b) => {
        // Pinned notes first
        if (a.isPinned && !b.isPinned) return -1;
        if (!a.isPinned && b.isPinned) return 1;

        // Then by custom order if exists
        if (customOrder && customOrder.length > 0) {
          const aIndex = customOrder.indexOf(a.id);
          const bIndex = customOrder.indexOf(b.id);
          // Notes in custom order come before those not in it
          if (aIndex !== -1 && bIndex !== -1) return aIndex - bIndex;
          if (aIndex !== -1) return -1;
          if (bIndex !== -1) return 1;
        }

        // Fallback: by updatedAt (most recent first)
        return (b.updatedAt || 0) - (a.updatedAt || 0);
      });
    }

    return grouped;
  }

  // Get all unique folders from notes
  function getFoldersList(notes) {
    const folders = new Set(['General']); // Always include General
    for (const note of notes) {
      if (note.folder) {
        folders.add(note.folder);
      }
    }

    const allFolders = Array.from(folders);
    const customOrder = getFolderOrder();

    // If custom order exists, use it (but ensure all folders are included)
    if (customOrder && customOrder.length > 0) {
      const orderedFolders = [];
      // First add folders in custom order
      for (const folder of customOrder) {
        if (allFolders.includes(folder)) {
          orderedFolders.push(folder);
        }
      }
      // Then add any new folders not in the custom order
      for (const folder of allFolders) {
        if (!orderedFolders.includes(folder)) {
          orderedFolders.push(folder);
        }
      }
      return orderedFolders;
    }

    // Default: Sort folders alphabetically, but keep General first
    const sortedFolders = allFolders.sort((a, b) => {
      if (a === 'General') return -1;
      if (b === 'General') return 1;
      return a.localeCompare(b);
    });
    return sortedFolders;
  }

  // Toggle folder collapse state
  function toggleFolderCollapse(folderName) {
    const collapsedFolders = getCollapsedFolders();
    if (collapsedFolders.has(folderName)) {
      collapsedFolders.delete(folderName);
      activeFolder = folderName; // Set as active when expanded
    } else {
      collapsedFolders.add(folderName);
    }
    saveFolderPrefs();
    renderNotesList();
  }

  // Save folder preferences to storage
  async function saveFolderPrefs() {
    const storage = getStorage();
    if (storage.saveFolderPrefs) {
      await storage.saveFolderPrefs({
        myNotes: {
          collapsedFolders: Array.from(myNotesCollapsedFolders),
          folderColors: myNotesFolderColors,
          folderOrder: myNotesFolderOrder,
          noteOrder: myNotesNoteOrder
        },
        teamNotes: {
          collapsedFolders: Array.from(teamNotesCollapsedFolders),
          folderColors: teamNotesFolderColors,
          folderOrder: teamNotesFolderOrder,
          noteOrder: teamNotesNoteOrder
        }
      });
    }
  }

  // Load folder preferences from storage
  async function loadFolderPrefs() {
    const storage = getStorage();
    if (storage.loadFolderPrefs) {
      const prefs = await storage.loadFolderPrefs();
      if (prefs.myNotes?.collapsedFolders) {
        myNotesCollapsedFolders = new Set(prefs.myNotes.collapsedFolders);
      }
      if (prefs.myNotes?.folderColors) {
        myNotesFolderColors = prefs.myNotes.folderColors;
      }
      if (prefs.myNotes?.folderOrder) {
        myNotesFolderOrder = prefs.myNotes.folderOrder;
      }
      if (prefs.myNotes?.noteOrder) {
        myNotesNoteOrder = prefs.myNotes.noteOrder;
      }
      if (prefs.teamNotes?.collapsedFolders) {
        teamNotesCollapsedFolders = new Set(prefs.teamNotes.collapsedFolders);
      }
      if (prefs.teamNotes?.folderColors) {
        teamNotesFolderColors = prefs.teamNotes.folderColors;
      }
      if (prefs.teamNotes?.folderOrder) {
        teamNotesFolderOrder = prefs.teamNotes.folderOrder;
      }
      if (prefs.teamNotes?.noteOrder) {
        teamNotesNoteOrder = prefs.teamNotes.noteOrder;
      }
    }
  }

  // Get folder order for current tab
  function getFolderOrder() {
    return activeTab === 'team' ? teamNotesFolderOrder : myNotesFolderOrder;
  }

  // Set folder order for current tab
  function setFolderOrder(order) {
    if (activeTab === 'team') {
      teamNotesFolderOrder = order;
    } else {
      myNotesFolderOrder = order;
    }
    saveFolderPrefs();
  }

  // Get note order for a folder
  function getNoteOrder(folderName) {
    const orders = activeTab === 'team' ? teamNotesNoteOrder : myNotesNoteOrder;
    return orders[folderName] || [];
  }

  // Set note order for a folder
  function setNoteOrder(folderName, orderArray) {
    if (activeTab === 'team') {
      teamNotesNoteOrder[folderName] = orderArray;
    } else {
      myNotesNoteOrder[folderName] = orderArray;
    }
  }

  // Get folder colors for current tab
  function getFolderColors() {
    return activeTab === 'team' ? teamNotesFolderColors : myNotesFolderColors;
  }

  // Get color for a specific folder
  function getFolderColor(folderName) {
    const colors = getFolderColors();
    return colors[folderName] || null;
  }

  // Set color for a folder
  function setFolderColor(folderName, color) {
    if (activeTab === 'team') {
      if (color) {
        teamNotesFolderColors[folderName] = color;
      } else {
        delete teamNotesFolderColors[folderName];
      }
    } else {
      if (color) {
        myNotesFolderColors[folderName] = color;
      } else {
        delete myNotesFolderColors[folderName];
      }
    }
    saveFolderPrefs();
    renderNotesList();
  }

  // Delete a folder and move its notes to General
  async function deleteFolder(folderName) {
    if (folderName === 'General') return; // Can't delete General

    if (!confirm(`Delete folder "${folderName}"? Notes will be moved to General.`)) {
      return;
    }

    const currentNotes = getCurrentNotes();
    const notesToMove = currentNotes.filter(n => n.folder === folderName);

    // Move notes to General
    for (const note of notesToMove) {
      await updateNote(note.id, { folder: 'General' });
    }

    // Remove folder from order
    const order = getFolderOrder();
    setFolderOrder(order.filter(f => f !== folderName));

    // Remove folder color
    if (activeTab === 'team') {
      delete teamNotesFolderColors[folderName];
    } else {
      delete myNotesFolderColors[folderName];
    }

    // Remove folder's note order
    if (activeTab === 'team') {
      delete teamNotesNoteOrder[folderName];
    } else {
      delete myNotesNoteOrder[folderName];
    }

    await saveFolderPrefs();
    renderNotesList();
    console.log('QuickNotes: Deleted folder', folderName, 'moved', notesToMove.length, 'notes to General');
  }

  // Show folder color picker
  function showFolderColorPicker(folderName, buttonElement) {
    // Remove any existing color picker
    const existingPicker = document.querySelector('.jt-folder-color-picker');
    if (existingPicker) {
      existingPicker.remove();
    }

    const storage = getStorage();
    const colors = storage.FOLDER_COLORS || [];
    const currentColor = getFolderColor(folderName);

    const picker = document.createElement('div');
    picker.className = 'jt-folder-color-picker';

    // Build color swatches
    let swatchesHtml = colors.map(c => {
      const isSelected = currentColor === c.value;
      return `<button class="jt-color-swatch ${isSelected ? 'selected' : ''}"
                      data-color="${c.value}"
                      title="${c.name}"
                      style="background-color: ${c.value}">
                ${isSelected ? '✓' : ''}
              </button>`;
    }).join('');

    // Add "no color" option
    const noColorSelected = !currentColor;
    swatchesHtml = `<button class="jt-color-swatch jt-color-none ${noColorSelected ? 'selected' : ''}"
                            data-color=""
                            title="No color">
                      ${noColorSelected ? '✓' : '✕'}
                    </button>` + swatchesHtml;

    picker.innerHTML = `
      <div class="jt-color-picker-header">Folder Color</div>
      <div class="jt-color-swatches">${swatchesHtml}</div>
    `;

    // Position the picker near the button
    const rect = buttonElement.getBoundingClientRect();
    picker.style.position = 'fixed';
    picker.style.top = `${rect.bottom + 4}px`;
    picker.style.left = `${rect.left}px`;
    picker.style.zIndex = '999999';

    document.body.appendChild(picker);

    // Handle color selection
    picker.addEventListener('click', (e) => {
      const swatch = e.target.closest('.jt-color-swatch');
      if (swatch) {
        const color = swatch.dataset.color || null;
        setFolderColor(folderName, color);
        picker.remove();
      }
    });

    // Close picker when clicking outside
    const closePicker = (e) => {
      if (!picker.contains(e.target) && e.target !== buttonElement) {
        picker.remove();
        document.removeEventListener('click', closePicker);
      }
    };

    setTimeout(() => {
      document.addEventListener('click', closePicker);
    }, 0);
  }

  // Update note's folder
  function updateNoteFolder(noteId, newFolder) {
    const trimmedFolder = (newFolder || 'General').trim();
    updateNote(noteId, { folder: trimmedFolder });
    activeFolder = trimmedFolder;
  }

  // Toggle note's pinned state
  function toggleNotePin(noteId) {
    const currentNotes = getCurrentNotes();
    const note = currentNotes.find(n => n.id === noteId);
    if (!note) return;

    const newPinnedState = !note.isPinned;
    updateNote(noteId, { isPinned: newPinnedState });
    console.log(`QuickNotes: ${newPinnedState ? 'Pinned' : 'Unpinned'} note ${noteId}`);
  }

  // Render a single note item HTML
  function renderNoteItem(note, markdown) {
    const previewContent = (note.content || '').slice(0, 150);
    // Sidebar snippets are a single line of plain text, never rendered
    // blocks — strip every tag (table, div, span, …) that parseMarkdown
    // produced rather than just <div>, so a note starting with a pipe
    // table (or any other block markup) can't blow out the list row.
    // parseMarkdown already HTML-escaped the underlying text, so the
    // result stays safe to drop straight into innerHTML.
    const parsedPreview = (markdown.parseMarkdown ? markdown.parseMarkdown(previewContent) : previewContent)
      .replace(/<[^>]+>/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();

    const escapedTitle = markdown.escapeHtml ? markdown.escapeHtml(note.title || 'Untitled Note') : (note.title || 'Untitled Note');
    const isPinned = note.isPinned || false;

    // Attribution for team notes
    let attribution = '';
    if (activeTab === 'team') {
      if (note.updatedBy && note.updatedBy.name) {
        attribution = `<span class="jt-note-attribution">Updated by ${markdown.escapeHtml ? markdown.escapeHtml(note.updatedBy.name) : note.updatedBy.name}</span>`;
      } else if (note.createdBy && note.createdBy.name) {
        attribution = `<span class="jt-note-attribution">By ${markdown.escapeHtml ? markdown.escapeHtml(note.createdBy.name) : note.createdBy.name}</span>`;
      }
    }

    return `
      <div class="jt-note-item ${currentNoteId === note.id ? 'active' : ''} ${isPinned ? 'pinned' : ''}" data-note-id="${note.id}" draggable="true">
        <div class="jt-note-item-header">
          <button class="jt-note-pin ${isPinned ? 'pinned' : ''}" data-note-id="${note.id}" title="${isPinned ? 'Unpin note' : 'Pin note'}">
            <svg viewBox="0 0 24 24" width="12" height="12" fill="${isPinned ? 'currentColor' : 'none'}" stroke="currentColor" stroke-width="2">
              <path d="M12 2L12 12M12 12L8 8M12 12L16 8M5 12H19M5 12V20C5 21 6 22 7 22H17C18 22 19 21 19 20V12" transform="rotate(45 12 12)"/>
            </svg>
          </button>
          <div class="jt-note-item-title">${escapedTitle}</div>
          <button class="jt-note-delete" data-note-id="${note.id}" title="Delete note">×</button>
        </div>
        <div class="jt-note-item-preview">${parsedPreview}</div>
        <div class="jt-note-item-meta">
          ${attribution}
          <span class="jt-note-item-date">${formatDate(note.updatedAt)}</span>
        </div>
      </div>
    `;
  }

  // Render folder group HTML
  function renderFolderGroup(folderName, folderNotes, isCollapsed, markdown) {
    const escapedFolderName = markdown.escapeHtml ? markdown.escapeHtml(folderName) : folderName;
    const notesHtml = isCollapsed ? '' : folderNotes.map(note => renderNoteItem(note, markdown)).join('');
    // Validate the folder color as a hex literal before interpolating it
    // into a `style="..."` attribute. The values today come from a fixed
    // palette (storage.js FOLDER_COLORS), but they flow through
    // chrome.storage.sync — a poisoned/tampered storage entry could
    // smuggle a CSS injection like `red; background-image: url(...)`.
    // Sanitizer.sanitizeHexColor returns null for anything that isn't
    // `#RRGGBB` / `#RGB`, which we treat as "no color" rather than
    // emitting raw user-influenced CSS.
    const rawColor = getFolderColor(folderName);
    const folderColor = window.Sanitizer && typeof window.Sanitizer.sanitizeHexColor === 'function'
      ? window.Sanitizer.sanitizeHexColor(rawColor)
      : (typeof rawColor === 'string' && /^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/i.test(rawColor) ? rawColor : null);
    const colorBtnStyle = folderColor ? `style="background-color: ${folderColor}"` : '';
    const headerStyle = folderColor ? `style="border-left: 3px solid ${folderColor}"` : '';
    const colorClass = folderColor ? 'has-color' : '';

    return `
      <div class="jt-notes-folder-group ${isCollapsed ? 'collapsed' : ''} ${colorClass}" data-folder="${escapedFolderName}" draggable="true">
        <div class="jt-notes-folder-header" data-folder="${escapedFolderName}" ${headerStyle}>
          <span class="jt-notes-folder-drag-handle" title="Drag to reorder">⋮⋮</span>
          <span class="jt-notes-folder-chevron">${isCollapsed ? '▶' : '▼'}</span>
          <button class="jt-notes-folder-color-btn" data-folder="${escapedFolderName}" title="Set folder color" ${colorBtnStyle}>
            ${folderColor ? '' : '<svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/></svg>'}
          </button>
          <span class="jt-notes-folder-name">${escapedFolderName}</span>
          <span class="jt-notes-folder-count">${folderNotes.length}</span>
          <div class="jt-notes-folder-actions">
            <button class="jt-notes-folder-add" data-folder="${escapedFolderName}" title="New note in folder">+</button>
            ${folderName !== 'General' ? `<button class="jt-notes-folder-delete" data-folder="${escapedFolderName}" title="Delete folder">×</button>` : ''}
          </div>
        </div>
        <div class="jt-notes-folder-content">
          ${notesHtml}
        </div>
      </div>
    `;
  }

  // Folder drag handlers
  function handleFolderDragStart(e) {
    const folderGroup = e.target.closest('.jt-notes-folder-group');
    if (!folderGroup) return;

    const folderName = folderGroup.dataset.folder;
    dragState = {
      type: 'folder',
      sourceId: folderName,
      sourceElement: folderGroup
    };

    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', folderName);
    folderGroup.classList.add('dragging');
  }

  function handleFolderDragOver(e) {
    if (dragState.type !== 'folder') return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';

    const folderGroup = e.target.closest('.jt-notes-folder-group');
    if (folderGroup && folderGroup !== dragState.sourceElement) {
      // Remove indicator from all folders
      notesPanel.querySelectorAll('.jt-notes-folder-group').forEach(f => {
        f.classList.remove('drag-over-above', 'drag-over-below');
      });

      // Determine if dropping above or below based on mouse position
      const rect = folderGroup.getBoundingClientRect();
      const midpoint = rect.top + rect.height / 2;
      if (e.clientY < midpoint) {
        folderGroup.classList.add('drag-over-above');
      } else {
        folderGroup.classList.add('drag-over-below');
      }
    }
  }

  function handleFolderDragLeave(e) {
    const folderGroup = e.target.closest('.jt-notes-folder-group');
    if (folderGroup) {
      folderGroup.classList.remove('drag-over-above', 'drag-over-below');
    }
  }

  function handleFolderDrop(e) {
    e.preventDefault();

    if (dragState.type !== 'folder') return;

    const targetFolderGroup = e.target.closest('.jt-notes-folder-group');
    if (!targetFolderGroup || targetFolderGroup === dragState.sourceElement) {
      cleanupDragState();
      return;
    }

    const sourceFolderName = dragState.sourceId;
    const targetFolderName = targetFolderGroup.dataset.folder;

    // Get current folder list
    const currentNotes = getCurrentNotes();
    const folders = getFoldersList(currentNotes);

    // Determine insert position
    const rect = targetFolderGroup.getBoundingClientRect();
    const midpoint = rect.top + rect.height / 2;
    const insertBefore = e.clientY < midpoint;

    // Create new order
    const newOrder = folders.filter(f => f !== sourceFolderName);
    const targetIndex = newOrder.indexOf(targetFolderName);
    const insertIndex = insertBefore ? targetIndex : targetIndex + 1;
    newOrder.splice(insertIndex, 0, sourceFolderName);

    // Save new order
    setFolderOrder(newOrder);
    console.log('QuickNotes: Folder order updated', newOrder);

    cleanupDragState();
    renderNotesList();
  }

  function handleFolderDragEnd(e) {
    cleanupDragState();
  }

  // ==========================================================================
  // NOTE DRAG & DROP HANDLERS
  // ==========================================================================

  function handleNoteDragStart(e) {
    const noteItem = e.target.closest('.jt-note-item');
    if (!noteItem) return;

    const noteId = noteItem.dataset.noteId;
    const currentNotes = getCurrentNotes();
    const note = currentNotes.find(n => n.id === noteId);
    if (!note) return;

    dragState = {
      type: 'note',
      sourceId: noteId,
      sourceElement: noteItem,
      sourceFolder: note.folder || 'General'
    };

    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', noteId);
    noteItem.classList.add('dragging');

    console.log('QuickNotes: Started dragging note', noteId);
  }

  function handleNoteDragOver(e) {
    // Allow drops on folder headers or other notes when dragging notes
    if (dragState.type !== 'note') return;

    // Clear all note drag indicators
    notesPanel.querySelectorAll('.jt-note-item').forEach(n => {
      n.classList.remove('drag-over-above', 'drag-over-below');
    });

    const folderHeader = e.target.closest('.jt-notes-folder-header');
    if (folderHeader) {
      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';

      // Highlight the folder as drop target
      notesPanel.querySelectorAll('.jt-notes-folder-group').forEach(f => {
        f.classList.remove('drag-over');
      });
      const folderGroup = folderHeader.closest('.jt-notes-folder-group');
      if (folderGroup && folderGroup.dataset.folder !== dragState.sourceFolder) {
        folderGroup.classList.add('drag-over');
      }
      return;
    }

    // Allow drops on other notes (for reordering)
    const targetNote = e.target.closest('.jt-note-item');
    if (targetNote && targetNote.dataset.noteId !== dragState.sourceId) {
      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';

      // Clear folder highlighting
      notesPanel.querySelectorAll('.jt-notes-folder-group').forEach(f => {
        f.classList.remove('drag-over');
      });

      // Show drop indicator above or below
      const rect = targetNote.getBoundingClientRect();
      const midY = rect.top + rect.height / 2;
      if (e.clientY < midY) {
        targetNote.classList.add('drag-over-above');
      } else {
        targetNote.classList.add('drag-over-below');
      }
    }
  }

  function handleNoteDragLeave(e) {
    if (dragState.type !== 'note') return;

    const folderGroup = e.target.closest('.jt-notes-folder-group');
    if (folderGroup) {
      // Only remove if we're actually leaving the folder group
      const relatedTarget = e.relatedTarget;
      if (!relatedTarget || !folderGroup.contains(relatedTarget)) {
        folderGroup.classList.remove('drag-over');
      }
    }
  }

  function handleNoteDrop(e) {
    if (dragState.type !== 'note') return;

    // Handle drop on folder header (moves to folder)
    const folderHeader = e.target.closest('.jt-notes-folder-header');
    if (folderHeader) {
      e.preventDefault();

      const targetFolder = folderHeader.dataset.folder;
      if (targetFolder === dragState.sourceFolder) {
        cleanupDragState();
        return;
      }

      const noteId = dragState.sourceId;
      console.log('QuickNotes: Moving note', noteId, 'to folder', targetFolder);

      // Update the note's folder
      moveNoteToFolder(noteId, targetFolder);

      cleanupDragState();
      return;
    }

    // Handle drop on another note (reorder)
    const targetNote = e.target.closest('.jt-note-item');
    if (targetNote && targetNote.dataset.noteId !== dragState.sourceId) {
      e.preventDefault();

      const targetNoteId = targetNote.dataset.noteId;
      const sourceNoteId = dragState.sourceId;

      // Determine if dropping above or below
      const rect = targetNote.getBoundingClientRect();
      const dropAbove = e.clientY < rect.top + rect.height / 2;

      reorderNote(sourceNoteId, targetNoteId, dropAbove);

      cleanupDragState();
      return;
    }

    cleanupDragState();
  }

  function handleNoteDragEnd(e) {
    cleanupDragState();
  }

  async function moveNoteToFolder(noteId, targetFolder) {
    const currentNotes = getCurrentNotes();
    const noteIndex = currentNotes.findIndex(n => n.id === noteId);
    if (noteIndex === -1) return;

    const note = currentNotes[noteIndex];
    const oldFolder = note.folder || 'General';

    // Update the note's folder
    note.folder = targetFolder;
    note.updatedAt = Date.now();

    if (activeTab === 'team') {
      // For team notes, save to server
      teamNotes = currentNotes;
      await saveTeamNoteToServer(note);
    } else {
      // For personal notes, save locally
      notes = currentNotes;
      await QuickNotesStorage.saveNotesWithSync(notes);
    }

    console.log('QuickNotes: Moved note from', oldFolder, 'to', targetFolder);
    renderNotesList();
    renderNoteEditor();
  }

  // Reorder a note within or between folders
  async function reorderNote(sourceNoteId, targetNoteId, insertBefore) {
    const currentNotes = getCurrentNotes();
    const sourceNote = currentNotes.find(n => n.id === sourceNoteId);
    const targetNote = currentNotes.find(n => n.id === targetNoteId);

    if (!sourceNote || !targetNote) return;

    const sourceFolder = sourceNote.folder || 'General';
    const targetFolder = targetNote.folder || 'General';

    // If different folders, move note first
    if (sourceFolder !== targetFolder) {
      sourceNote.folder = targetFolder;
      sourceNote.updatedAt = Date.now();

      if (activeTab === 'team') {
        await saveTeamNoteToServer(sourceNote);
      } else {
        await QuickNotesStorage.saveNotesWithSync(notes);
      }
    }

    // Get current order for target folder
    const folderNotes = currentNotes.filter(n => (n.folder || 'General') === targetFolder);
    let currentOrder = getNoteOrder(targetFolder);

    // If no custom order, create one from current note IDs
    if (!currentOrder || currentOrder.length === 0) {
      currentOrder = folderNotes.map(n => n.id);
    }

    // Remove source from current position
    currentOrder = currentOrder.filter(id => id !== sourceNoteId);

    // Find target position
    const targetIndex = currentOrder.indexOf(targetNoteId);
    const insertIndex = insertBefore ? targetIndex : targetIndex + 1;

    // Insert at new position
    currentOrder.splice(insertIndex, 0, sourceNoteId);

    // Save new order
    setNoteOrder(targetFolder, currentOrder);
    await saveFolderPrefs();

    console.log('QuickNotes: Reordered note', sourceNoteId, insertBefore ? 'before' : 'after', targetNoteId);
    renderNotesList();
  }

  function cleanupDragState() {
    if (dragState.sourceElement) {
      dragState.sourceElement.classList.remove('dragging');
    }
    notesPanel?.querySelectorAll('.jt-notes-folder-group').forEach(f => {
      f.classList.remove('drag-over-above', 'drag-over-below', 'drag-over');
    });
    notesPanel?.querySelectorAll('.jt-note-item').forEach(n => {
      n.classList.remove('dragging', 'drag-over-above', 'drag-over-below');
    });
    dragState = { type: null, sourceId: null, sourceElement: null };
  }

  // Render notes list
  function renderNotesList() {
    const notesList = notesPanel.querySelector('.jt-notes-list');
    if (!notesList) return;

    const markdown = getMarkdown();
    const currentNotes = getCurrentNotes();

    const filteredNotes = currentNotes.filter(note => {
      if (!searchTerm) return true;
      const search = searchTerm.toLowerCase();
      return (note.title || '').toLowerCase().includes(search) ||
             (note.content || '').toLowerCase().includes(search);
    });

    // Show loading state for team notes
    if (activeTab === 'team' && isLoadingTeamNotes) {
      notesList.innerHTML = `
        <div class="jt-notes-empty">
          <div class="jt-notes-loading">Loading team notes...</div>
        </div>
      `;
      return;
    }

    // Show login prompt for team notes if not logged in
    if (activeTab === 'team' && !isTeamNotesAvailable()) {
      notesList.innerHTML = `
        <div class="jt-notes-empty">
          <div class="jt-notes-login-prompt">
            <svg xmlns="http://www.w3.org/2000/svg" fill="none" stroke="currentColor" stroke-width="1.5" viewBox="0 0 24 24" width="32" height="32">
              <path stroke-linecap="round" stroke-linejoin="round" d="M18 18.72a9.094 9.094 0 003.741-.479 3 3 0 00-4.682-2.72m.94 3.198l.001.031c0 .225-.012.447-.037.666A11.944 11.944 0 0112 21c-2.17 0-4.207-.576-5.963-1.584A6.062 6.062 0 016 18.719m12 0a5.971 5.971 0 00-.941-3.197m0 0A5.995 5.995 0 0012 12.75a5.995 5.995 0 00-5.058 2.772m0 0a3 3 0 00-4.681 2.72 8.986 8.986 0 003.74.477m.94-3.197a5.971 5.971 0 00-.94 3.197M15 6.75a3 3 0 11-6 0 3 3 0 016 0zm6 3a2.25 2.25 0 11-4.5 0 2.25 2.25 0 014.5 0zm-13.5 0a2.25 2.25 0 11-4.5 0 2.25 2.25 0 014.5 0z"/>
            </svg>
            <p>Sign in to access team notes</p>
            <p class="jt-notes-login-hint">Team notes are shared with your organization</p>
          </div>
        </div>
      `;
      return;
    }

    if (filteredNotes.length === 0) {
      const emptyMessage = activeTab === 'team'
        ? (searchTerm ? 'No team notes match your search' : 'No team notes yet. Create one to share with your team!')
        : (searchTerm ? 'No notes match your search' : 'No notes yet. Click "New Note" to get started!');

      notesList.innerHTML = `
        <div class="jt-notes-empty">
          ${emptyMessage}
        </div>
      `;
      return;
    }

    // Group notes by folder
    const grouped = groupNotesByFolder(filteredNotes);
    const folders = getFoldersList(filteredNotes);
    const collapsedFolders = getCollapsedFolders();

    // Render folder groups
    let html = '';
    for (const folderName of folders) {
      const folderNotes = grouped[folderName] || [];
      if (folderNotes.length === 0) continue; // Skip empty folders

      const isCollapsed = collapsedFolders.has(folderName);
      html += renderFolderGroup(folderName, folderNotes, isCollapsed, markdown);
    }

    notesList.innerHTML = html;

    // Add event handlers for folder headers
    notesList.querySelectorAll('.jt-notes-folder-header').forEach(header => {
      header.addEventListener('click', (e) => {
        // Don't toggle if clicking on add button, color button, or delete button
        if (e.target.closest('.jt-notes-folder-add')) return;
        if (e.target.closest('.jt-notes-folder-color-btn')) return;
        if (e.target.closest('.jt-notes-folder-delete')) return;
        const folderName = header.dataset.folder;
        toggleFolderCollapse(folderName);
      });
    });

    // Add event handlers for folder color buttons
    notesList.querySelectorAll('.jt-notes-folder-color-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const folderName = btn.dataset.folder;
        showFolderColorPicker(folderName, btn);
      });
    });

    // Add event handlers for folder add buttons
    notesList.querySelectorAll('.jt-notes-folder-add').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const folderName = btn.dataset.folder;
        createNote(folderName);
      });
    });

    // Add event handlers for folder delete buttons
    notesList.querySelectorAll('.jt-notes-folder-delete').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        deleteFolder(btn.dataset.folder);
      });
    });

    // Add drag handlers for folders
    notesList.querySelectorAll('.jt-notes-folder-group').forEach(folder => {
      folder.addEventListener('dragstart', handleFolderDragStart);
      folder.addEventListener('dragover', handleFolderDragOver);
      folder.addEventListener('dragleave', handleFolderDragLeave);
      folder.addEventListener('drop', handleFolderDrop);
      folder.addEventListener('dragend', handleFolderDragEnd);
    });

    // Add drag handlers for notes (to move between folders)
    notesList.querySelectorAll('.jt-note-item').forEach(item => {
      item.addEventListener('dragstart', handleNoteDragStart);
      item.addEventListener('dragend', handleNoteDragEnd);
    });

    // Add dragover/drop handlers for folder headers (for receiving note drops)
    notesList.querySelectorAll('.jt-notes-folder-header').forEach(header => {
      header.addEventListener('dragover', handleNoteDragOver);
      header.addEventListener('dragleave', handleNoteDragLeave);
      header.addEventListener('drop', handleNoteDrop);
    });

    // Add click handlers for note items
    notesList.querySelectorAll('.jt-note-item').forEach(item => {
      item.addEventListener('click', (e) => {
        // Don't open note if clicking delete or pin button
        if (e.target.closest('.jt-note-delete') || e.target.closest('.jt-note-pin')) {
          return;
        }
        currentNoteId = item.dataset.noteId;
        renderNotesList();
        renderNoteEditor();
        // Open editor when clicking a note
        openEditor();
      });
    });

    // Add click handlers for pin buttons
    notesList.querySelectorAll('.jt-note-pin').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        toggleNotePin(btn.dataset.noteId);
      });
    });

    notesList.querySelectorAll('.jt-note-delete').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        deleteNote(btn.dataset.noteId);
      });
    });
  }

  // Count words in text
  function countWords(text) {
    if (!text) return 0;
    return text.trim().split(/\s+/).filter(w => w.length > 0).length;
  }

  /**
   * The character offset where line `lineIndex` starts in `text`, using the
   * same `text.split('\n')` line numbering as parseMarkdown()'s `data-line`
   * stamps. Used to land the caret at the START of a clicked line when a
   * rendered preview block drops into the textarea below — not a pixel- or
   * character-accurate reproduction of the click point, which parseMarkdown's
   * lossy rendering (stripped markers, "•" for "- ", table cells) makes
   * unrecoverable in general.
   */
  function getLineStartOffset(text, lineIndex) {
    const lines = text.split('\n');
    let offset = 0;
    for (let i = 0; i < lineIndex && i < lines.length; i++) {
      offset += lines[i].length + 1; // +1 for the '\n' the split() consumed
    }
    return offset;
  }

  /**
   * Tear down the currently-tracked embedded formatter toolbar, if any.
   * Called both before renderNoteEditor() replaces the editor DOM (a new
   * note/tab/folder) and from cleanup() — see embeddedFormatterToolbar's
   * own comment on why a bare DOM removal isn't enough.
   */
  function destroyEmbeddedFormatterToolbar() {
    if (embeddedFormatterToolbar) {
      window.FormatterToolbar && window.FormatterToolbar.destroyToolbar(embeddedFormatterToolbar);
      embeddedFormatterToolbar = null;
    }
  }

  /**
   * Embed the real Text Formatter toolbar — the same one JobTread's own
   * text fields use — for the given note-body textarea, and keep
   * FormatterToolbar's module-level "active field" pointed at it. See the
   * call site in renderNoteEditor() for why the walk-up-out-of-any-
   * relative/absolute-container heuristic in embedToolbarForField() never
   * triggers for this field, and why formatter-toolbar.css needs Quick
   * Notes' own init() to load it (both docs live there instead of here to
   * stay next to the render call this is meant to explain).
   * @param {HTMLTextAreaElement} field
   * @returns {HTMLElement|null} The embedded toolbar, or null if
   *   window.FormatterToolbar isn't loaded.
   */
  function embedFormatterToolbar(field) {
    if (!window.FormatterToolbar) return null;
    const toolbar = window.FormatterToolbar.embedToolbarForField(field, { fromFocus: true });
    // The toolbar's own buttons apply formatting to FormatterToolbar's
    // module-level "active field", not to whatever element this function
    // was called with — set it explicitly rather than waiting on a focus
    // event that may never fire (e.g. a brand-new note focuses the title
    // input first; see the "Focus handling" block in renderNoteEditor()).
    window.FormatterToolbar.setActiveField(field);
    field.addEventListener('focus', () => {
      window.FormatterToolbar.setActiveField(field);
    });
    return toolbar;
  }

  // Render note editor with WYSIWYG contenteditable
  function renderNoteEditor() {
    const editorContainer = notesPanel.querySelector('.jt-notes-editor');
    if (!editorContainer) return;

    // Commit the outgoing note's queued edit before this pass replaces the
    // DOM. Dropping it would silently lose the last half-second of typing
    // whenever someone switches notes mid-keystroke.
    flushPendingNoteSave();

    // Tear down the previous note's embedded formatter toolbar before this
    // render replaces the DOM out from under it.
    destroyEmbeddedFormatterToolbar();

    const markdown = getMarkdown();
    const currentNotes = getCurrentNotes();
    const currentNote = currentNotes.find(n => n.id === currentNoteId);

    if (!currentNote) {
      editorContainer.innerHTML = `
        <div class="jt-notes-editor-header">
          <button class="jt-notes-back-button" title="Back to notes list">
            <svg xmlns="http://www.w3.org/2000/svg" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2" viewBox="0 0 24 24" width="16" height="16">
              <path d="M19 12H5M12 19l-7-7 7-7"></path>
            </svg>
          </button>
          <div class="jt-notes-sidebar-title">Quick Notes</div>
          <button class="jt-notes-close-button" title="Close (Esc)"></button>
        </div>
        <div class="jt-notes-editor-empty">
          <div class="jt-notes-editor-empty-icon">📝</div>
          <div class="jt-notes-editor-empty-text">Select a note to view or create a new one</div>
        </div>
      `;

      // Add button handlers
      const closeButton = editorContainer.querySelector('.jt-notes-close-button');
      closeButton.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        closeEditor();
      });

      const backButton = editorContainer.querySelector('.jt-notes-back-button');
      if (backButton) {
        backButton.addEventListener('click', (e) => {
          e.preventDefault();
          e.stopPropagation();
          closeEditor();
        });
      }
      return;
    }

    const escapedTitle = markdown.escapeHtml ? markdown.escapeHtml(currentNote.title) : currentNote.title;
    const wordCount = countWords(currentNote.content);
    const currentFolder = currentNote.folder || 'General';
    const folders = getFoldersList(getCurrentNotes());
    const folderOptions = folders.map(f => {
      const escaped = markdown.escapeHtml ? markdown.escapeHtml(f) : f;
      const selected = f === currentFolder ? 'selected' : '';
      return `<option value="${escaped}" ${selected}>${escaped}</option>`;
    }).join('');

    editorContainer.innerHTML = `
      <div class="jt-notes-editor-header">
        <button class="jt-notes-back-button" title="Back to notes list">
          <svg xmlns="http://www.w3.org/2000/svg" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2" viewBox="0 0 24 24" width="16" height="16">
            <path d="M19 12H5M12 19l-7-7 7-7"></path>
          </svg>
        </button>
        <input
          type="text"
          class="jt-notes-title-input"
          value="${escapedTitle}"
          placeholder="Note title..."
        />
        <div class="jt-notes-folder-select-wrapper">
          <select class="jt-notes-folder-select" title="Select folder">
            ${folderOptions}
            <option value="__new__">+ New Folder...</option>
          </select>
        </div>
        <button class="jt-notes-close-button" title="Close (Esc)"></button>
      </div>
      <div class="jt-notes-wysiwyg-container">
        <div class="jt-notes-toolbar">
          <button class="jt-notes-preview-btn" title="Preview note">
            <svg viewBox="0 0 24 24" width="16" height="16" stroke="currentColor" stroke-width="2" fill="none">
              <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"></path>
              <circle cx="12" cy="12" r="3"></circle>
            </svg>
          </button>
          <div class="jt-notes-toolbar-divider"></div>
          <button class="jt-notes-checklist-btn" title="Insert checklist item">
            <svg viewBox="0 0 24 24" width="16" height="16" stroke="currentColor" stroke-width="2" fill="none">
              <rect x="3" y="3" width="18" height="18" rx="2" ry="2"></rect>
              <polyline points="9 11 12 14 22 4"></polyline>
            </svg>
          </button>
        </div>
        <textarea
          class="jt-notes-content-input"
          placeholder="Start typing your note..."
          spellcheck="true"
        ></textarea>
        <div class="jt-notes-preview" hidden></div>
      </div>
      <div class="jt-notes-editor-footer">
        <span class="jt-notes-word-count">${wordCount} words</span>
        <span class="jt-notes-updated">Updated ${formatDate(currentNote.updatedAt)}</span>
      </div>
    `;

    // Get element references
    const titleInput = editorContainer.querySelector('.jt-notes-title-input');
    const closeButton = editorContainer.querySelector('.jt-notes-close-button');
    const contentInput = editorContainer.querySelector('.jt-notes-content-input');
    // The slim view-toggle row — Preview and Insert Checklist. NOT the
    // formatting toolbar; that's the shared FormatterToolbar embedded below.
    const viewToggleRow = editorContainer.querySelector('.jt-notes-toolbar');
    const preview = editorContainer.querySelector('.jt-notes-preview');
    const previewToggleBtn = editorContainer.querySelector('.jt-notes-preview-btn');
    const checklistBtn = editorContainer.querySelector('.jt-notes-checklist-btn');
    // Notes are re-read far more than they are written, so a note with
    // content opens in preview and drops to the textarea on click; an empty
    // note opens straight into edit (see the toggleNotePreview(hasContent)
    // call below). Local to this render pass (editorContainer.innerHTML is
    // rebuilt per note) so it can't leak the previous note's edit/preview
    // state onto the next one.
    let showingPreview = true;

    // Initialize content from markdown
    contentInput.value = currentNote.content || '';

    // Embed the real Text Formatter toolbar (see embedFormatterToolbar()'s
    // own doc comment above) directly above the note body. Quick Notes used
    // to ship its own bespoke toolbar wired to a private marker dialect
    // (formatter-modules/dialects.js' QUICK_NOTES); both are gone now that
    // the preview renders through the same JTMarkdown grammar the shared
    // toolbar writes, so there is only one dialect to keep in sync with.
    //
    // embedToolbarForField() walks up out of any relative/absolute-positioned
    // ancestor before choosing where to insert — that heuristic exists for
    // JobTread's own preview-overlay fields (an absolutely-positioned
    // textarea over a relatively-positioned wrapper). Quick Notes' textarea
    // is a plain flow child of .jt-notes-wysiwyg-container (verified: neither
    // it nor its parent uses absolute/relative positioning in quick-notes.css),
    // so that walk-up never triggers and the toolbar lands exactly where
    // inserted — directly before the textarea, inside
    // .jt-notes-wysiwyg-container — rather than escaping the panel.
    //
    // formatter-toolbar.css is normally injected by the Text Formatter
    // feature's own init(), which may be OFF while Quick Notes is on — so
    // Quick Notes loads its own copy in init() below (same pattern already
    // used for preview-mode.css).
    embeddedFormatterToolbar = embedFormatterToolbar(contentInput);

    /**
     * Refresh the shared toolbar's active-state highlighting (bold/italic/
     * .../justify/color) for the caret position in contentInput. Uses
     * FormatterToolbar's own updater — the exact same one every JobTread
     * field's toolbar uses — so there is nothing Quick-Notes-specific left
     * to keep in sync.
     */
    function refreshToolbarState() {
      if (window.FormatterToolbar && embeddedFormatterToolbar && document.body.contains(embeddedFormatterToolbar)) {
        window.FormatterToolbar.updateToolbarState(contentInput, embeddedFormatterToolbar);
      }
    }

    // Debounced save function
    const debouncedSave = (field, value) => {
      // Pin the note being edited at schedule time. currentNoteId is read at
      // fire time otherwise, so switching notes inside the debounce window
      // wrote this note's text into whichever note was open when it landed.
      const noteId = currentNoteId;
      cancelPendingNoteSave();
      pendingNoteSave = () => {
        updateNote(noteId, { [field]: value });
        if (field === 'content') {
          const wordCountEl = editorContainer.querySelector('.jt-notes-word-count');
          if (wordCountEl) {
            const count = countWords(value);
            wordCountEl.textContent = `${count} words`;
          }
        }
      };
      noteSaveTimeout = setTimeout(flushPendingNoteSave, 500);
    };

    /**
     * Re-render the preview pane's markup from the textarea's current value.
     * The same renderer Preview Mode uses for JobTread's own document
     * fields, with two options opted in that Preview Mode itself never
     * passes (see jt-markdown.js's own module doc comment — both default
     * off, so its parity output is unaffected):
     *   - taskLists: `- [ ]`/`- [x]` is Quick Notes' one documented
     *     deviation from JobTread's grammar. Unlike the old
     *     quick-notes-modules/markdown.js renderer, JTMarkdown never emits a
     *     `disabled` checkbox here, so there is nothing to re-enable.
     *   - lineAnchors: stamps every rendered top-level block with
     *     `data-line`, which the click handler below reads to land the
     *     caret on the line you clicked (see its own comment).
     */
    function renderPreviewMarkup() {
      const jt = window.JTMarkdown;
      if (!jt || !jt.render) return;
      preview.innerHTML = jt.render(contentInput.value || '', { taskLists: true, lineAnchors: true });
    }

    /**
     * Swap between the raw textarea and the rendered preview. Never both:
     * the same model JobTread's own fields and the portal's Notes use.
     *
     * The view-toggle row (Preview + Insert Checklist) stays visible in both
     * modes — only Insert Checklist (which doesn't apply to a rendered
     * preview) hides via the preview-mode class below. That leaves the
     * Preview toggle button reachable from preview mode, which is the only
     * way back to the textarea other than clicking the note body. The
     * embedded formatting toolbar has nothing to act on while the textarea
     * is hidden, so it's hidden along with it.
     */
    function toggleNotePreview(showPreview) {
      showingPreview = showPreview;
      if (showPreview) renderPreviewMarkup();
      preview.hidden = !showPreview;
      contentInput.hidden = showPreview;
      viewToggleRow.classList.toggle('jt-notes-toolbar-preview-mode', showPreview);
      if (embeddedFormatterToolbar) {
        embeddedFormatterToolbar.style.display = showPreview ? 'none' : '';
      }
      if (previewToggleBtn) {
        previewToggleBtn.classList.toggle('is-active', showPreview);
        previewToggleBtn.title = showPreview ? 'Edit note' : 'Preview note';
      }
      if (!showPreview) contentInput.focus();
    }

    /**
     * Tick/untick the source line behind a rendered checkbox. Rewrites exactly
     * that line so the rest of the note is untouched.
     *
     * Identity, not counting: JTMarkdown's render() stamps each rendered
     * checkbox `<input>` with `data-line`, the line's own index into
     * content.split('\n') (opt-in via { taskLists: true }, see
     * preview-mode-modules/jt-markdown.js). We read that index straight off
     * the clicked element — no second pass that re-classifies lines and no
     * assumption that "lines matching CHECKBOX_LINE_RE" and "lines that
     * rendered a checkbox" are the same set (they aren't, e.g. a checkbox
     * line containing a markdown link used to render as a mangled bullet
     * with no <input> at all, which threw off any scheme that counted
     * rendered boxes against re-matched lines). If the attribute is missing
     * or not a valid index, do nothing rather than guess.
     */
    function toggleCheckboxLine(box) {
      const lineAttr = box.getAttribute('data-line');
      if (lineAttr === null) return;
      const lineIndex = Number(lineAttr);
      if (!Number.isInteger(lineIndex) || lineIndex < 0) return;

      const lines = contentInput.value.split('\n');
      if (lineIndex >= lines.length) return;

      const match = CHECKBOX_LINE_RE.exec(lines[lineIndex]);
      if (!match) return; // stale/mismatched index — never guess

      const checked = /x/i.test(match[1]);
      lines[lineIndex] = checked
        ? lines[lineIndex].replace(CHECKBOX_LINE_RE, '- [ ]')
        : lines[lineIndex].replace(CHECKBOX_LINE_RE, '- [x]');

      contentInput.value = lines.join('\n');
      debouncedSave('content', contentInput.value);
      toggleNotePreview(true); // re-render, stay in preview
    }

    // Clicking the rendered note drops into edit — except on a checkbox,
    // which toggles in place and stays in preview, and except on a link,
    // which should navigate rather than be swallowed into edit mode.
    //
    // renderPreviewMarkup() renders with `{ lineAnchors: true }`, so
    // JTMarkdown stamps `data-line` (source line index in
    // content.split('\n')) on every rendered top-level block — a plain
    // line, a heading/color/align/icon wrapper, and each bullet/numbered
    // list item — not just a checkbox's own <input>. Read it off whatever
    // was clicked via closest(); when the click landed inside a checklist
    // item's label instead of its box, fall back to that item's own
    // checkbox input rather than landing nowhere (belt-and-suspenders now
    // that the <li> itself also carries data-line, but kept in case a click
    // lands on something between the two with neither). A click that finds
    // no data-line at all (a table cell, the pane's empty margin) still
    // drops into edit mode — it just can't land the caret at that exact
    // line, and falls back to whatever the browser does on focus() alone.
    preview.addEventListener('click', (e) => {
      const box = e.target.closest('input[type="checkbox"]');
      if (box) {
        e.preventDefault();
        toggleCheckboxLine(box);
        return;
      }
      if (e.target.closest('a')) return;

      let lineEl = e.target.closest('[data-line]');
      if (!lineEl) {
        const item = e.target.closest('li');
        lineEl = item ? item.querySelector('input[type="checkbox"][data-line]') : null;
      }
      const lineIndex = lineEl ? Number(lineEl.dataset.line) : NaN;

      toggleNotePreview(false);

      if (Number.isInteger(lineIndex) && lineIndex >= 0) {
        const offset = getLineStartOffset(contentInput.value, lineIndex);
        contentInput.setSelectionRange(offset, offset);
      }
    });

    // A note opens rendered — reading is the far more common case than
    // editing — except an empty note, which has nothing to render: preview
    // of '' is a blank pane with no hint, while the textarea's placeholder
    // only shows once it's actually visible. This also applies the initial
    // hidden/visible split, since the markup above only marks the preview
    // hidden by default.
    const hasContent = !!(currentNote.content || '').trim();
    toggleNotePreview(hasContent);

    // Title input handler
    titleInput.addEventListener('input', (e) => {
      debouncedSave('title', e.target.value || 'Untitled Note');
    });

    // Folder select handler
    const folderSelect = editorContainer.querySelector('.jt-notes-folder-select');
    folderSelect.addEventListener('change', (e) => {
      const selectedValue = e.target.value;
      if (selectedValue === '__new__') {
        const newFolderName = prompt('Enter new folder name:');
        if (newFolderName && newFolderName.trim()) {
          updateNoteFolder(currentNoteId, newFolderName.trim());
          renderNoteEditor();
        } else {
          e.target.value = currentFolder;
        }
      } else {
        updateNoteFolder(currentNoteId, selectedValue);
      }
    });

    // Close button handler
    closeButton.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      closeEditor();
    });

    // Back button handler (mobile)
    const backButton = editorContainer.querySelector('.jt-notes-back-button');
    if (backButton) {
      backButton.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        closeEditor();
      });
    }

    // Prevent the view-toggle row's own buttons from stealing focus (preserve
    // selection). The embedded formatter toolbar's buttons handle this
    // themselves (toolbar.js's own setupFormatButtons).
    viewToggleRow.addEventListener('mousedown', (e) => {
      if (e.target.closest('.jt-notes-checklist-btn') || e.target.closest('.jt-notes-preview-btn')) {
        e.preventDefault();
      }
    });

    // Preview toggle button — the only way back to the rendered view once
    // the user has dropped into the textarea (other than closing/reopening
    // the note). It is the panel's own view control, not a formatting
    // operation, so it lives in the view-toggle row rather than the shared
    // formatter toolbar and must never reach FormatterFormats.applyFormat().
    if (previewToggleBtn) {
      previewToggleBtn.addEventListener('click', (e) => {
        e.preventDefault();
        toggleNotePreview(!showingPreview);
      });
    }

    // Insert Checklist — the one button the shared formatter toolbar doesn't
    // have. `checkbox` is a Quick-Notes-only format (see its case in
    // formats.js's applyFormat switch, added for exactly this button) that
    // still runs through the same shared engine, so there is one formatting
    // engine rather than a second one living in this panel.
    if (checklistBtn) {
      checklistBtn.addEventListener('click', (e) => {
        e.preventDefault();
        runFormat('checkbox');
      });
    }

    /**
     * Apply a format via the shared FormatterFormats engine and refresh the
     * toolbar's active-state highlighting. Used by both the Insert Checklist
     * button above and the Ctrl+B/I/U/K keyboard shortcuts below, so neither
     * can drift from what clicking the matching formatter-toolbar button
     * does. applyFormat() sets the field's value through React's native
     * setter and dispatches a real `input` event itself, so the existing
     * `input` listener below (auto-save + preview re-render) fires without
     * this function calling debouncedSave() directly.
     */
    function runFormat(format) {
      if (!window.FormatterFormats) return;
      contentInput.focus();
      window.FormatterFormats.applyFormat(contentInput, format);
      refreshToolbarState();
    }

    // Content input changes (auto-save). The textarea's value IS the stored
    // markdown, so there is nothing to serialize and nothing to normalize.
    // This also catches edits made through the embedded formatter toolbar's
    // own buttons (toolbar.js -> FormatterFormats.applyFormat -> native
    // setter + input event), so there is no separate save path for those.
    contentInput.addEventListener('input', () => {
      debouncedSave('content', contentInput.value);
      // Only the visible surface needs re-rendering — while actively typing
      // (edit mode) the preview is hidden and gets rebuilt fresh next time
      // toggleNotePreview(true) runs.
      if (showingPreview) renderPreviewMarkup();
    });

    // Ctrl/Cmd+B/I/U/K keyboard shortcuts, plus Enter continuing (or exiting)
    // a list line via the shared textarea engine.
    //
    // The shortcuts have to be wired here rather than relying on the Text
    // Formatter's own global handler (formatter.js handleKeydown): that one
    // only fires on fields that pass Detection().isFormatterField(), which
    // the Quick Notes textarea never matches. Routed through the exact same
    // runFormat() path as clicking a formatter-toolbar button — not a
    // second copy of the marker logic — so a shortcut can never drift from
    // what its button does.
    const SHORTCUT_KEY_FORMATS = { b: 'bold', i: 'italic', u: 'underline', k: 'link' };
    contentInput.addEventListener('keydown', (e) => {
      if ((e.ctrlKey || e.metaKey) && !e.altKey) {
        const format = SHORTCUT_KEY_FORMATS[e.key.toLowerCase()];
        if (format) {
          e.preventDefault();
          runFormat(format);
          return;
        }
      }

      if (e.key === 'Enter' && !e.shiftKey && window.FormatterFormats) {
        // Returns true when it continued or exited a list.
        if (window.FormatterFormats.handleEnterKey(contentInput, e)) {
          debouncedSave('content', contentInput.value);
        }
      }
    });

    // Keep the formatter toolbar's active-state highlighting in sync with the caret.
    contentInput.addEventListener('keyup', refreshToolbarState);
    contentInput.addEventListener('click', refreshToolbarState);

    // Update formatting button states on selection change.
    // Re-rendering the editor registers a new handler — remove the previous
    // one first so listeners don't accumulate across note/folder/tab switches.
    if (selectionChangeHandler) {
      document.removeEventListener('selectionchange', selectionChangeHandler);
    }
    selectionChangeHandler = () => {
      if (document.activeElement === contentInput) {
        refreshToolbarState();
      }
    };
    document.addEventListener('selectionchange', selectionChangeHandler);

    // NOTE: no paste handler, deliberately. A textarea already pastes the
    // clipboard's text/plain flavour and nothing else, straight into the native
    // undo stack — which is the whole point of this editor. The contenteditable
    // era intercepted paste to sanitize a text/html flavour into DOM nodes; a
    // textarea holds text, and the preview renderer (JTMarkdown) escapes every
    // character it renders, so there is nothing left to sanitize. Don't re-add
    // one: preventDefault + insertText only forfeits undo.
    //
    // No checkbox/Ctrl+click-link/table-context-menu handlers here either:
    // a <textarea> is a replaced form control with no light-DOM children, so
    // `e.target` for any mouse event inside it is always the textarea itself
    // — `e.target.type === 'checkbox'`, `e.target.tagName === 'A'`, and
    // `e.target.closest('th, td')` can never match. Checkbox ticks and link
    // clicks are handled on the *preview* surface instead (see the preview
    // click handler above) — the raw markdown in the textarea has no
    // checkboxes, links, or tables to click on as elements.

    // Focus handling
    if (currentNote.title === 'Untitled Note') {
      titleInput.focus();
      titleInput.select();
    } else {
      contentInput.focus();
    }
  }

  // ============================================================
  // NOTE: Markdown rendering lives in preview-mode-modules/jt-markdown.js
  // (window.JTMarkdown) — see getMarkdown()/renderPreviewMarkup() above.
  // ============================================================

  // Detect and apply theme
  function detectAndApplyTheme() {
    if (!notesPanel) return;

    // Get current settings
    chrome.storage.sync.get(['jtToolsSettings'], (result) => {
      const settings = result.jtToolsSettings || {};

      // Remove existing theme classes
      notesPanel.classList.remove('dark-theme', 'custom-theme');

      // Is this page dark, by EITHER route? NativeDarkBridge owns that answer:
      // JobTread's own dark mode counts, and the "Kinda Dark" level does not —
      // it is a dimmed LIGHT theme, so a dark notes panel on it is wrong.
      // `settings.darkMode` alone got both of those backwards: it stayed false
      // on JobTread's dark pages (leaving this panel white on a dark app) and
      // true on Kinda Dark (darkening a panel on a light page).
      const bridge = window.NativeDarkBridge;
      const pageIsDark = bridge && typeof bridge.isPageDark === 'function'
        ? bridge.isPageDark()
        : settings.darkMode;
      if (pageIsDark) {
        notesPanel.classList.add('dark-theme');
        return;
      }

      // Check if custom RGB theme is enabled
      if (settings.rgbTheme && settings.themeColors) {
        notesPanel.classList.add('custom-theme');
        const { primary, background, text } = settings.themeColors;

        // Calculate lighter background for inputs
        const lighterBg = adjustColorBrightness(background, 10);
        const borderColor = adjustColorBrightness(background, -20);
        const textSecondary = adjustColorBrightness(text, 30); // Slightly lighter text for secondary
        const hoverBg = adjustColorBrightness(background, -5); // Slightly darker for hover

        // Set CSS variables
        notesPanel.style.setProperty('--jt-notes-bg', background);
        notesPanel.style.setProperty('--jt-notes-text', text);
        notesPanel.style.setProperty('--jt-notes-text-secondary', textSecondary);
        notesPanel.style.setProperty('--jt-notes-primary', primary);
        notesPanel.style.setProperty('--jt-notes-input-bg', lighterBg);
        notesPanel.style.setProperty('--jt-notes-border', borderColor);
        notesPanel.style.setProperty('--jt-notes-hover-bg', hoverBg);
      }
    });
  }

  // Delegate to shared ColorUtils utility
  const adjustColorBrightness = (hex, percent) => ColorUtils.adjustBrightnessPercent(hex, percent);

  // ==========================================================================
  // PAGE CONTENT PUSH - Shift JobTread content when panel is open
  // ==========================================================================

  function getPanelWidth() {
    if (!notesPanel) return 0;
    const isEditorOpen = notesPanel.classList.contains('editor-open');

    // If there's an inline width set (from resizing), use that
    const inlineWidth = parseInt(notesPanel.style.width, 10);
    if (inlineWidth && isEditorOpen) {
      return inlineWidth;
    }

    if (isSidebarCollapsed) {
      // Collapsed sidebar is 48px
      if (isEditorOpen) {
        return MIN_EDITOR_WIDTH + COLLAPSED_SIDEBAR_WIDTH; // Editor + collapsed strip
      }
      return COLLAPSED_SIDEBAR_WIDTH; // Just collapsed strip
    }

    if (!isEditorOpen) {
      return 280; // Sidebar only
    }

    // Editor open with full sidebar - default width
    return 600;
  }

  function pushPageContent(width) {
    // Find JobTread's main content container
    const mainContent = document.querySelector('#root > div > div.grow');
    if (mainContent) {
      mainContent.style.transition = 'margin-right 0.3s cubic-bezier(0.4, 0, 0.2, 1)';
      mainContent.style.marginRight = `${width}px`;
    }
  }

  function unpushPageContent() {
    const mainContent = document.querySelector('#root > div > div.grow');
    if (mainContent) {
      mainContent.style.marginRight = '';
    }
  }

  function updatePagePush() {
    if (!notesPanel) return;
    const isVisible = notesPanel.classList.contains('visible');
    if (isVisible) {
      pushPageContent(getPanelWidth());
    } else {
      unpushPageContent();
    }
  }

  // ==========================================================================
  // SIDEBAR COLLAPSE - Toggle notes list visibility
  // ==========================================================================

  function toggleSidebarCollapse() {
    if (!notesPanel) return;

    isSidebarCollapsed = !isSidebarCollapsed;
    notesPanel.classList.toggle('sidebar-collapsed', isSidebarCollapsed);

    // Clear inline width so CSS can control it when collapsed
    if (isSidebarCollapsed) {
      notesPanel.style.width = '';
    } else {
      // Restore saved width when expanding
      loadSavedWidth();
    }

    // Update page content push width
    updatePagePush();

    // Save preference
    try {
      chrome.storage.sync.set({ quickNotesSidebarCollapsed: isSidebarCollapsed });
    } catch (e) {
      console.warn('QuickNotes: Could not save sidebar collapsed state', e);
    }

    console.log('QuickNotes: Sidebar collapsed:', isSidebarCollapsed);
  }

  async function loadSidebarCollapseState() {
    try {
      const data = await chrome.storage.sync.get('quickNotesSidebarCollapsed');
      isSidebarCollapsed = data.quickNotesSidebarCollapsed || false;
    } catch (e) {
      console.warn('QuickNotes: Could not load sidebar collapsed state', e);
      isSidebarCollapsed = false;
    }
  }

  // Open editor - expands panel to show editor
  function openEditor() {
    notesPanel.classList.add('editor-open');
    // Apply collapsed state if it was set
    if (isSidebarCollapsed) {
      notesPanel.classList.add('sidebar-collapsed');
      // Don't set inline width - let CSS handle collapsed state
      notesPanel.style.width = '';
    } else {
      // Load and apply saved width when opening editor (only when not collapsed)
      loadSavedWidth();
    }
    // Update page push for new width
    updatePagePush();
  }

  // Close editor - collapses back to sidebar only
  function closeEditor() {
    notesPanel.classList.remove('editor-open');
    notesPanel.classList.remove('resizing');
    // Keep sidebar-collapsed state - don't remove it
    // Reset width to let CSS handle it
    notesPanel.style.width = '';
    currentNoteId = null;
    renderNotesList();
    renderNoteEditor();
    // Update page push for sidebar-only width
    updatePagePush();
  }

  // Toggle panel visibility
  function togglePanel() {
    if (!notesPanel) return;

    const isVisible = notesPanel.classList.contains('visible');
    if (isVisible) {
      // Close everything - remove all classes that make it visible
      notesPanel.classList.remove('visible');
      notesPanel.classList.remove('editor-open');
      notesPanel.classList.remove('resizing');
      notesPanel.classList.remove('sidebar-collapsed');
      // Reset width to default (280px from CSS)
      notesPanel.style.width = '';
      currentNoteId = null;
      if (notesButton) {
        notesButton.classList.remove('jt-notes-button-active');
      }
      // Unpush page content
      unpushPageContent();
      // Force hide with explicit check
      setTimeout(() => {
        if (notesPanel && notesPanel.classList.contains('visible')) {
          notesPanel.classList.remove('visible');
        }
      }, 10);
    } else {
      // Open just the sidebar initially (280px default width)
      notesPanel.classList.add('visible');
      // Ensure width is reset to 280px when opening sidebar only
      notesPanel.style.width = '';
      if (notesButton) {
        notesButton.classList.add('jt-notes-button-active');
      }
      renderNotesList();
      renderNoteEditor();
      // Push page content to make room for panel
      updatePagePush();
      // Focus search when opening
      const searchInput = notesPanel.querySelector('.jt-notes-search-input');
      if (searchInput) {
        setTimeout(() => searchInput.focus(), 100);
      }
    }
  }

  // Find the Time Clock button in a container by its distinctive SVG elements
  function findTimeClockButton(container) {
    const buttons = container.querySelectorAll('div[role="button"]');
    for (const btn of buttons) {
      const svg = btn.querySelector('svg');
      if (svg) {
        // Check for clock circle (cx="12" cy="12" r="10")
        const circle = svg.querySelector('circle[cx="12"][cy="12"][r="10"]');
        if (circle) {
          return btn;
        }
        // Also check path for clock hands "M12 6v6l4 2"
        const paths = svg.querySelectorAll('path');
        for (const path of paths) {
          const d = path.getAttribute('d') || '';
          if (d.includes('M12 6v6l4 2')) {
            return btn;
          }
        }
      }
    }
    return null;
  }

  // Create Quick Notes button for the header bar (icon-only style)
  function createQuickNotesHeaderButton(container, beforeElement) {
    // Remove existing button if present
    if (notesButton && notesButton.parentNode) {
      notesButton.remove();
    }

    notesButton = document.createElement('div');
    // Match header icon button styling exactly like JobTread's Time Clock button
    notesButton.className = 'relative cursor-pointer flex items-center hover:bg-gray-100 focus:bg-gray-100 px-1 h-10 rounded-sm group active:bg-gray-200 jt-quick-notes-btn';
    notesButton.setAttribute('role', 'button');
    notesButton.setAttribute('tabindex', '0');
    notesButton.setAttribute('title', 'Quick Notes');

    // Icon-only version (matches header icons exactly - using same classes as Time Clock)
    // Note: SVG must be on single line without whitespace to match JT's native icons
    notesButton.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" class="inline-block overflow-visible h-[1em] w-[1em] align-[-0.125em] text-3xl" viewBox="0 0 24 24"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"></path></svg>`;

    // Add click handler
    notesButton.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      togglePanel();
    });

    // Add keyboard handler for accessibility
    notesButton.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        e.stopPropagation();
        togglePanel();
      }
    });

    // Insert BEFORE the Time Clock button (to the left of it)
    container.insertBefore(notesButton, beforeElement);
  }

  // Check if current page should have the quick notes button
  // Note: Since the icon is now persistent in the header, we show it on all JobTread pages
  function shouldShowButton() {
    // Always show the Quick Notes button in the header
    return true;
  }

  // Find and inject button into action buttons container
  function injectQuickNotesButton() {
    // Check if button already exists anywhere
    if (notesButton && document.body.contains(notesButton)) {
      return true;
    }

    // Priority 1: Try to inject into header bar (left of Time Clock)
    // Header bar is always visible on all pages, no page restrictions needed
    const headerIconBar = document.querySelector('div.shrink-0.flex.items-center.pr-1');
    if (headerIconBar && !headerIconBar.querySelector('.jt-quick-notes-btn')) {
      const timeClockBtn = findTimeClockButton(headerIconBar);
      if (timeClockBtn) {
        createQuickNotesHeaderButton(headerIconBar, timeClockBtn);
        return true;
      } else if (headerIconBar.firstChild) {
        // Fallback: insert as first child of icon bar if Time Clock not found
        createQuickNotesHeaderButton(headerIconBar, headerIconBar.firstChild);
        return true;
      }
    }

    // Header bar not found - don't show Quick Notes button
    return false;
  }


  // Set up observer to watch for action buttons container
  function setupButtonObserver() {
    // Initial injection attempt
    let injected = injectQuickNotesButton();

    // Retry injection every 500ms for up to 5 seconds if not successful
    if (!injected) {
      let attempts = 0;
      const maxAttempts = 10; // 10 * 500ms = 5 seconds
      retryInjectInterval = setInterval(() => {
        attempts++;

        // Stop retrying if the feature was cleaned up mid-retry
        if (!isActive) {
          clearInterval(retryInjectInterval);
          retryInjectInterval = null;
          return;
        }

        injected = injectQuickNotesButton();

        if (injected || attempts >= maxAttempts) {
          clearInterval(retryInjectInterval);
          retryInjectInterval = null;
        }
      }, 500);
    }

    // Periodic check to ensure button stays injected across page navigations
    // Check every 2 seconds if button is still present and action bar exists
    // Store interval ID for cleanup
    periodicCheckInterval = setInterval(() => {
      if (isActive) {
        // Check if we're on a page that should have the button
        if (!shouldShowButton()) {
          // Remove button if it exists but shouldn't be shown on this page
          if (notesButton && document.body.contains(notesButton)) {
            notesButton.remove();
          }
          return;
        }

        const actionBars = document.querySelectorAll('div.absolute.inset-0.flex.justify-end');
        let foundButtonInActionBar = false;

        for (const bar of actionBars) {
          if (bar.offsetParent !== null) {
            const hasButton = bar.querySelector('.jt-quick-notes-btn');
            if (hasButton) {
              foundButtonInActionBar = true;
              break;
            }
          }
        }

        // If we found an action bar but no button, try to inject
        if (!foundButtonInActionBar && actionBars.length > 0) {
          const visibleActionBar = Array.from(actionBars).find(bar => bar.offsetParent !== null);
          if (visibleActionBar) {
            injectQuickNotesButton();
          }
        }
      }
    }, 2000); // Check every 2 seconds

    // Watch for DOM changes to re-inject button if needed
    // Need to watch for:
    // 1. Button being removed (page navigation)
    // 2. Action bar content changing (different page = different buttons)
    // 3. Action bar itself being recreated
    // 4. URL changes (SPA navigation)
    buttonObserver = new MutationObserver((mutations) => {
      // Check if we're on a page that should have the button
      if (!shouldShowButton()) {
        // Remove button if it exists but shouldn't be shown on this page
        if (notesButton && document.body.contains(notesButton)) {
          notesButton.remove();
        }
        return;
      }

      // Check if our button still exists in the DOM
      if (!notesButton || !document.body.contains(notesButton)) {
        injectQuickNotesButton();
        return;
      }

      // Check if action bar was modified (content changed)
      // This handles when the page changes and action bar gets new buttons
      for (const mutation of mutations) {
        if (mutation.type === 'childList') {
          // Check if any added/removed nodes are in an action bar
          const actionBars = document.querySelectorAll('div.absolute.inset-0.flex.justify-end');
          for (const bar of actionBars) {
            // If action bar exists but doesn't have our button, inject it
            if (bar.offsetParent !== null && !bar.querySelector('.jt-quick-notes-btn')) {
              const divButtons = bar.querySelectorAll('div[role="button"]').length;
              const linkButtons = bar.querySelectorAll('a.inline-block.cursor-pointer.shrink-0').length;
              const totalButtons = divButtons + linkButtons;

              if (totalButtons > 0) {
                injectQuickNotesButton();
                return;
              }
            }
          }
        }
      }
    });

    buttonObserver.observe(document.body, {
      childList: true,
      subtree: true
    });
  }

  // Create notes panel
  function createNotesPanel() {
    notesPanel = document.createElement('div');
    notesPanel.className = 'jt-quick-notes-panel';
    notesPanel.innerHTML = `
      <div class="jt-notes-resize-handle" title="Drag to resize"></div>
      <div class="jt-notes-sidebar">
        <div class="jt-notes-sidebar-header">
          <h3 class="jt-notes-sidebar-title">Quick Notes</h3>
          <div class="jt-notes-sidebar-header-buttons">
            <button class="jt-notes-collapse-btn" title="Collapse sidebar">
              <svg xmlns="http://www.w3.org/2000/svg" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2" viewBox="0 0 24 24" width="16" height="16">
                <polyline points="11 17 6 12 11 7"></polyline>
                <polyline points="18 17 13 12 18 7"></polyline>
              </svg>
            </button>
            <button class="jt-notes-sidebar-close-button" title="Close (Esc)">
              <svg xmlns="http://www.w3.org/2000/svg" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2" viewBox="0 0 24 24" width="16" height="16">
                <line x1="18" y1="6" x2="6" y2="18"></line>
                <line x1="6" y1="6" x2="18" y2="18"></line>
              </svg>
            </button>
          </div>
        </div>
        <div class="jt-notes-tabs"></div>
        <div class="jt-notes-search-container">
          <input
            type="text"
            class="jt-notes-search-input"
            placeholder="Search notes..."
          />
          <button class="jt-notes-new-button" title="New note (Alt+N)">
            <svg xmlns="http://www.w3.org/2000/svg" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2" viewBox="0 0 24 24" width="16" height="16">
              <path d="M5 12h14M12 5v14"></path>
            </svg>
            New Note
          </button>
        </div>
        <div class="jt-notes-actions-container">
          <button class="jt-notes-action-button" id="exportNotesBtn" title="Export notes as JSON file for backup">
            <svg xmlns="http://www.w3.org/2000/svg" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2" viewBox="0 0 24 24" width="14" height="14">
              <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path>
              <polyline points="7 10 12 15 17 10"></polyline>
              <line x1="12" y1="15" x2="12" y2="3"></line>
            </svg>
            Export
          </button>
          <button class="jt-notes-action-button" id="importNotesBtn" title="Import notes from a JSON file">
            <svg xmlns="http://www.w3.org/2000/svg" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2" viewBox="0 0 24 24" width="14" height="14">
              <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path>
              <polyline points="17 8 12 3 7 8"></polyline>
              <line x1="12" y1="3" x2="12" y2="15"></line>
            </svg>
            Import
          </button>
        </div>
        <div class="jt-notes-list"></div>
      </div>
      <div class="jt-notes-editor"></div>
    `;

    // Add event handlers
    const sidebarCloseButton = notesPanel.querySelector('.jt-notes-sidebar-close-button');
    sidebarCloseButton.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      togglePanel();
    });

    const collapseBtn = notesPanel.querySelector('.jt-notes-collapse-btn');
    if (collapseBtn) {
      collapseBtn.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        toggleSidebarCollapse();
      });
    }

    const newButton = notesPanel.querySelector('.jt-notes-new-button');
    newButton.addEventListener('click', () => createNote());

    const exportButton = notesPanel.querySelector('#exportNotesBtn');
    exportButton.addEventListener('click', exportNotes);

    const importButton = notesPanel.querySelector('#importNotesBtn');
    importButton.addEventListener('click', importNotes);

    const searchInput = notesPanel.querySelector('.jt-notes-search-input');
    searchInput.addEventListener('input', (e) => {
      searchTerm = e.target.value;
      renderNotesList();
    });

    // Add resize functionality
    setupResizeHandle();

    document.body.appendChild(notesPanel);
  }

  // Setup resize handle functionality
  function setupResizeHandle() {
    const resizeHandle = notesPanel.querySelector('.jt-notes-resize-handle');
    if (!resizeHandle) return;

    let startX = 0;
    let startWidth = 0;

    const handleMouseDown = (e) => {
      // Only allow resizing when editor is open
      if (!notesPanel.classList.contains('editor-open')) {
        return;
      }

      isResizing = true;
      startX = e.clientX;
      startWidth = notesPanel.offsetWidth;

      // Add resizing class for cursor
      document.body.style.cursor = 'ew-resize';
      notesPanel.classList.add('resizing');

      e.preventDefault();
    };

    const handleMouseMove = (e) => {
      if (!isResizing) return;

      // Calculate new width (subtract because we're dragging from the left)
      const deltaX = startX - e.clientX;
      let newWidth = startWidth + deltaX;

      // Apply constraints - use higher minimum when sidebar is collapsed
      const minWidth = isSidebarCollapsed
        ? MIN_EDITOR_WIDTH + COLLAPSED_SIDEBAR_WIDTH
        : MIN_WIDTH;
      newWidth = Math.max(minWidth, Math.min(MAX_WIDTH, newWidth));

      // Also constrain to viewport width
      const maxViewportWidth = window.innerWidth * 0.9;
      newWidth = Math.min(newWidth, maxViewportWidth);

      notesPanel.style.width = `${newWidth}px`;

      // Update page content push in real-time
      updatePagePush();
    };

    const handleMouseUp = () => {
      if (!isResizing) return;

      isResizing = false;
      document.body.style.cursor = '';
      notesPanel.classList.remove('resizing');

      // Save the new width
      saveWidth(notesPanel.offsetWidth);

      // Final update to page push
      updatePagePush();
    };

    // Store handlers for cleanup
    resizeHandlers.mouseMove = handleMouseMove;
    resizeHandlers.mouseUp = handleMouseUp;

    resizeHandle.addEventListener('mousedown', handleMouseDown);
    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);
  }

  // Save panel width to localStorage
  function saveWidth(width) {
    localStorage.setItem(WIDTH_STORAGE_KEY, width.toString());
  }

  // Load saved width from localStorage
  function loadSavedWidth() {
    const savedWidth = localStorage.getItem(WIDTH_STORAGE_KEY);
    if (savedWidth) {
      const width = parseInt(savedWidth, 10);
      if (!isNaN(width) && width >= MIN_WIDTH && width <= MAX_WIDTH) {
        notesPanel.style.width = `${width}px`;
      }
    }
  }

  // Keyboard shortcuts
  let lastKeyTime = 0;
  let lastKey = '';
  const SHORTCUT_TIMEOUT = 500; // milliseconds

  function handleKeyboard(e) {
    // Q + N shortcut (press Q then N within 500ms)
    const currentTime = Date.now();
    const key = e.key.toLowerCase();

    // Don't trigger if user is typing in an input field
    const isInputField = e.target.matches('input, textarea, [contenteditable="true"]');

    if (!isInputField && !e.ctrlKey && !e.metaKey && !e.altKey) {
      if (key === 'q') {
        lastKey = 'q';
        lastKeyTime = currentTime;
      } else if (key === 'n' && lastKey === 'q' && (currentTime - lastKeyTime) < SHORTCUT_TIMEOUT) {
        e.preventDefault();
        togglePanel();
        lastKey = '';
        lastKeyTime = 0;
      }
    }

    // Escape to close editor or panel
    if (e.key === 'Escape' && notesPanel && notesPanel.classList.contains('visible')) {
      e.preventDefault();
      // If editor is open, close it (return to sidebar)
      if (notesPanel.classList.contains('editor-open')) {
        closeEditor();
      } else {
        // If only sidebar is open, close entire panel
        togglePanel();
      }
    }
  }

  // Handle settings changes from other tabs
  function handleSettingsChange(message) {
    if (message.type === 'SETTINGS_CHANGED') {
      // Re-detect and apply theme when settings change
      detectAndApplyTheme();
    }
  }

  // Initialize feature
  async function init() {
    if (isActive) return;

    // Check if extension context is still valid
    if (!chrome.runtime?.id) {
      console.warn('QuickNotes: Extension context invalidated, cannot initialize');
      return;
    }

    // Quick Notes is now available on all JobTread pages
    // The header icon is persistent across all pages

    // Load Quick Notes CSS
    const link = document.createElement('link');
    link.rel = 'stylesheet';
    try {
      link.href = chrome.runtime.getURL('styles/quick-notes.css');
    } catch (e) {
      console.warn('QuickNotes: Extension context invalidated while loading CSS');
      return;
    }
    link.id = 'jt-quick-notes-styles';
    document.head.appendChild(link);

    // The preview pane renders through window.JTMarkdown and needs the
    // jt-md-* rules in preview-mode.css (widened there to also match
    // .jt-notes-preview — see that file). That stylesheet is normally
    // injected by the Preview Mode feature itself, which may not be
    // enabled, so Quick Notes loads its own copy of the same file rather
    // than duplicating those rules.
    const previewStylesLink = document.createElement('link');
    previewStylesLink.rel = 'stylesheet';
    previewStylesLink.href = chrome.runtime.getURL('styles/preview-mode.css');
    previewStylesLink.id = 'jt-quick-notes-preview-mode-styles';
    document.head.appendChild(previewStylesLink);

    // The note body embeds the shared Text Formatter toolbar
    // (window.FormatterToolbar — see renderNoteEditor()), styled by
    // formatter-toolbar.css. That stylesheet is normally injected by the
    // Text Formatter feature's own init(), which may be OFF while Quick
    // Notes is on, so Quick Notes loads its own copy — same pattern as
    // preview-mode.css above.
    const formatterToolbarStylesLink = document.createElement('link');
    formatterToolbarStylesLink.rel = 'stylesheet';
    formatterToolbarStylesLink.href = chrome.runtime.getURL('styles/formatter-toolbar.css');
    formatterToolbarStylesLink.id = 'jt-quick-notes-formatter-toolbar-styles';
    document.head.appendChild(formatterToolbarStylesLink);

    // Load notes from storage
    await loadNotes();

    // Sanitize any invalid folder names (fix for [object Object] bug)
    let needsSave = false;
    notes = notes.map(note => {
      if (!note.folder || typeof note.folder !== 'string' || note.folder.includes('[object')) {
        needsSave = true;
        return { ...note, folder: 'General' };
      }
      return note;
    });
    if (needsSave) {
      await saveNotes();
      console.log('QuickNotes: Fixed invalid folder names');
    }

    // Load folder preferences
    await loadFolderPrefs();

    // Load sidebar collapse state
    await loadSidebarCollapseState();

    // Migrate notes to have folder field if needed
    const storage = getStorage();
    if (storage.hasFolderMigrationRun && storage.setFolderMigrationComplete && storage.migrateNotesToFolders) {
      const migrationDone = await storage.hasFolderMigrationRun();
      if (!migrationDone) {
        notes = storage.migrateNotesToFolders(notes);
        await saveNotes();
        await storage.setFolderMigrationComplete();
        console.log('QuickNotes: Migrated notes to folder structure');
      }
    }

    // Create UI elements
    setupButtonObserver();
    createNotesPanel();

    // Apply theme
    detectAndApplyTheme();

    // Render initial state
    renderTabs();
    renderNotesList();
    renderNoteEditor();

    // Add keyboard listener
    document.addEventListener('keydown', handleKeyboard);

    // Listen for settings changes
    chrome.runtime.onMessage.addListener(handleSettingsChange);

    // Listen for visibility changes to sync when user returns to tab
    document.addEventListener('visibilitychange', handleVisibilityChange);

    isActive = true;
    console.log('QuickNotes: Activated');
  }

  // Handle visibility change for sync
  async function handleVisibilityChange() {
    if (document.visibilityState === 'visible' && isActive) {
      const storage = getStorage();
      if (storage.isSyncAvailable && storage.isSyncAvailable()) {
        console.log('QuickNotes: Tab visible, checking for sync...');
        try {
          // Sync personal notes
          notes = await storage.loadNotesWithSync();

          // Refresh team notes if on team tab
          if (activeTab === 'team' && isTeamNotesAvailable()) {
            teamNotesLoaded = false; // Force refresh
            await loadTeamNotesFromServer();
          }

          renderTabs();
          renderNotesList();
          if (currentNoteId) {
            renderNoteEditor();
          }
        } catch (error) {
          console.warn('QuickNotes: Sync on visibility failed', error);
        }
      }

      // Start polling when tab becomes visible
      if (activeTab === 'team') {
        startTeamNotesPolling();
      }
    } else if (document.visibilityState === 'hidden') {
      // Stop polling when tab is hidden to save resources
      stopTeamNotesPolling();
    }
  }

  // Start polling for team notes updates
  function startTeamNotesPolling() {
    if (teamNotesPollInterval) return; // Already polling
    if (!isTeamNotesAvailable()) return; // Not logged in

    console.log('QuickNotes: Starting team notes polling');
    teamNotesPollInterval = setInterval(async () => {
      if (activeTab !== 'team' || !isTeamNotesAvailable()) {
        stopTeamNotesPolling();
        return;
      }

      try {
        const previousNotes = JSON.stringify(teamNotes.map(n => ({ id: n.id, updatedAt: n.updatedAt })));
        await loadTeamNotesFromServer();
        const currentNotes = JSON.stringify(teamNotes.map(n => ({ id: n.id, updatedAt: n.updatedAt })));

        // Only re-render if something changed
        if (previousNotes !== currentNotes) {
          console.log('QuickNotes: Team notes updated from server');
          renderTabs();
          renderNotesList();
          // Don't re-render editor to avoid interrupting user's editing
        }
      } catch (error) {
        console.warn('QuickNotes: Polling sync failed', error);
      }
    }, POLL_INTERVAL_MS);
  }

  // Stop polling for team notes
  function stopTeamNotesPolling() {
    if (teamNotesPollInterval) {
      console.log('QuickNotes: Stopping team notes polling');
      clearInterval(teamNotesPollInterval);
      teamNotesPollInterval = null;
    }
  }

  // Cleanup feature
  function cleanup() {
    if (!isActive) return;

    // Stop team notes polling
    stopTeamNotesPolling();

    // Drop any queued note save. Neither timer was cleared here before, so a
    // write could fire up to 500ms (1s for team notes) after the panel was
    // gone and `notes` had been reset to [].
    cancelPendingNoteSave();
    if (teamNoteSaveTimeout) {
      clearTimeout(teamNoteSaveTimeout);
      teamNoteSaveTimeout = null;
    }

    // Clear periodic check interval (fix memory leak)
    if (periodicCheckInterval) {
      clearInterval(periodicCheckInterval);
      periodicCheckInterval = null;
    }

    // Clear button injection retry interval (fix memory leak — could keep
    // firing and re-inject the button after the feature was disabled)
    if (retryInjectInterval) {
      clearInterval(retryInjectInterval);
      retryInjectInterval = null;
    }

    // Disconnect observer
    if (buttonObserver) {
      buttonObserver.disconnect();
      buttonObserver = null;
    }

    // Tear down any embedded formatter toolbar left over from an open note.
    // notesPanel.remove() below detaches it from the document either way,
    // but a bare detach without disconnecting its ResizeObserver leaks it —
    // see embeddedFormatterToolbar's own comment.
    destroyEmbeddedFormatterToolbar();

    // Remove UI elements
    if (notesButton) {
      notesButton.remove();
      notesButton = null;
    }
    if (notesPanel) {
      notesPanel.remove();
      notesPanel = null;
    }

    // Remove CSS
    const styles = document.getElementById('jt-quick-notes-styles');
    if (styles) styles.remove();
    const previewStyles = document.getElementById('jt-quick-notes-preview-mode-styles');
    if (previewStyles) previewStyles.remove();
    const formatterToolbarStyles = document.getElementById('jt-quick-notes-formatter-toolbar-styles');
    if (formatterToolbarStyles) formatterToolbarStyles.remove();

    // Remove keyboard listener
    document.removeEventListener('keydown', handleKeyboard);

    // Remove visibility change listener
    document.removeEventListener('visibilitychange', handleVisibilityChange);

    // Remove editor selectionchange listener
    if (selectionChangeHandler) {
      document.removeEventListener('selectionchange', selectionChangeHandler);
      selectionChangeHandler = null;
    }

    // Remove resize event listeners (fix memory leak)
    if (resizeHandlers.mouseMove) {
      document.removeEventListener('mousemove', resizeHandlers.mouseMove);
      resizeHandlers.mouseMove = null;
    }
    if (resizeHandlers.mouseUp) {
      document.removeEventListener('mouseup', resizeHandlers.mouseUp);
      resizeHandlers.mouseUp = null;
    }

    // Remove settings change listener
    chrome.runtime.onMessage.removeListener(handleSettingsChange);

    // Reset state
    notes = [];
    currentNoteId = null;
    searchTerm = '';
    isActive = false;

    console.log('QuickNotes: Deactivated');
  }

  return {
    init,
    cleanup,
    isActive: () => isActive
  };
})();

// Export to window
window.QuickNotesFeature = QuickNotesFeature;
