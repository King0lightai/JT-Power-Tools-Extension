/**
 * Quick Notes Storage Module
 * Handles all storage operations for quick notes
 *
 * Dependencies: None (uses Chrome Storage API directly)
 */

const QuickNotesStorage = (() => {
  // Storage keys
  const STORAGE_KEY = 'jtToolsQuickNotes';
  const WIDTH_STORAGE_KEY = 'jtToolsQuickNotesWidth';
  const FOLDER_PREFS_KEY = 'jtToolsQuickNotesFolderPrefs';
  const FOLDER_MIGRATION_KEY = 'jtToolsQuickNotesFolderMigration';
  const DELETED_NOTES_KEY = 'jtToolsDeletedNotes';
  const DELETED_TEMPLATES_KEY = 'jtToolsDeletedTemplates';

  // Width constraints
  const MIN_WIDTH = 320;
  const MAX_WIDTH = 1200;

  /**
   * Check if Chrome storage API is available
   * @returns {boolean}
   */
  function isStorageAvailable() {
    return typeof chrome !== 'undefined' && chrome.storage && chrome.storage.sync;
  }

  /**
   * Load notes from Chrome storage
   * @returns {Promise<Array>} Array of note objects
   */
  async function loadNotes() {
    // Fallback to localStorage if Chrome storage not available
    if (!isStorageAvailable()) {
      try {
        const stored = localStorage.getItem(STORAGE_KEY);
        return stored ? JSON.parse(stored) : [];
      } catch (error) {
        console.error('Quick Notes Storage: localStorage fallback error:', error);
        return [];
      }
    }

    return new Promise((resolve) => {
      try {
        chrome.storage.sync.get([STORAGE_KEY], (result) => {
          if (chrome.runtime.lastError) {
            console.error('Quick Notes Storage: Error loading notes:', chrome.runtime.lastError.message);
            resolve([]);
            return;
          }
          resolve(result[STORAGE_KEY] || []);
        });
      } catch (error) {
        console.error('Quick Notes Storage: Unexpected error loading notes:', error);
        resolve([]);
      }
    });
  }

  /**
   * Save notes to Chrome storage
   * @param {Array} notes - Array of note objects to save
   * @returns {Promise<boolean>} Success status
   */
  async function saveNotes(notes) {
    // Fallback to localStorage if Chrome storage not available
    if (!isStorageAvailable()) {
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(notes));
        return true;
      } catch (error) {
        console.error('Quick Notes Storage: localStorage fallback error:', error);
        return false;
      }
    }

    return new Promise((resolve) => {
      try {
        chrome.storage.sync.set({ [STORAGE_KEY]: notes }, () => {
          if (chrome.runtime.lastError) {
            console.error('Quick Notes Storage: Error saving notes:', chrome.runtime.lastError.message);
            resolve(false);
            return;
          }
          resolve(true);
        });
      } catch (error) {
        console.error('Quick Notes Storage: Unexpected error saving notes:', error);
        resolve(false);
      }
    });
  }

  /**
   * Export notes as JSON file
   * @param {Array} notes - Array of notes to export
   * @returns {boolean} Success status
   */
  function exportNotes(notes) {
    if (!notes || notes.length === 0) {
      alert('No notes to export. Create some notes first!');
      return false;
    }

    const exportData = {
      version: '1.0',
      exportedAt: Date.now(),
      exportedAtFormatted: new Date().toLocaleString(),
      notesCount: notes.length,
      notes: notes
    };

    const dataStr = JSON.stringify(exportData, null, 2);
    const dataBlob = new Blob([dataStr], { type: 'application/json' });

    const url = URL.createObjectURL(dataBlob);
    const link = document.createElement('a');
    link.href = url;

    // Create filename with timestamp
    const timestamp = new Date().toISOString().slice(0, 10);
    link.download = `jt-power-tools-notes-${timestamp}.json`;

    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);

    return true;
  }

  /**
   * Import notes from JSON file
   * @param {Array} existingNotes - Current notes array
   * @param {Function} onImport - Callback with imported notes and merge mode
   */
  function importNotes(existingNotes, onImport) {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'application/json,.json';

    input.onchange = async (e) => {
      const file = e.target.files[0];
      if (!file) return;

      try {
        const text = await file.text();
        const importData = JSON.parse(text);

        // Validate import data
        if (!importData.notes || !Array.isArray(importData.notes)) {
          alert('Invalid notes file. Please select a valid JT Power Tools notes export.');
          return;
        }

        // Ask user if they want to merge or replace
        const shouldMerge = confirm(
          `Found ${importData.notes.length} note(s) in file.\n\n` +
          `Click OK to MERGE with existing notes (${existingNotes.length})\n` +
          `Click Cancel to REPLACE all existing notes`
        );

        if (shouldMerge) {
          // Merge: Add imported notes that don't already exist
          const existingIds = new Set(existingNotes.map(n => n.id));
          const newNotes = importData.notes.filter(n => !existingIds.has(n.id));
          const mergedNotes = [...existingNotes, ...newNotes];

          onImport(mergedNotes, 'merge', newNotes.length);
        } else {
          // Replace: Confirm destructive action
          if (confirm('Are you sure? This will DELETE all existing notes and replace them with imported notes.')) {
            onImport(importData.notes, 'replace', importData.notes.length);
          }
        }
      } catch (error) {
        console.error('Quick Notes Storage: Import error:', error);
        alert('Failed to import notes. Please make sure the file is a valid JT Power Tools notes export.');
      }
    };

    input.click();
  }

  /**
   * Save panel width to storage
   * @param {number} width - Width in pixels
   */
  function saveWidth(width) {
    const clampedWidth = Math.max(MIN_WIDTH, Math.min(MAX_WIDTH, width));
    chrome.storage.sync.set({ [WIDTH_STORAGE_KEY]: clampedWidth });
  }

  /**
   * Load saved panel width from storage
   * @returns {Promise<number|null>} Saved width or null
   */
  async function loadWidth() {
    return new Promise((resolve) => {
      chrome.storage.sync.get([WIDTH_STORAGE_KEY], (result) => {
        if (chrome.runtime.lastError) {
          resolve(null);
          return;
        }
        resolve(result[WIDTH_STORAGE_KEY] || null);
      });
    });
  }

  /**
   * Generate unique ID for notes
   * @returns {string} Unique ID
   */
  function generateId() {
    return Date.now().toString(36) + Math.random().toString(36).substr(2);
  }

  // ==========================================================================
  // SYNC-AWARE METHODS
  // ==========================================================================

  // Debounce timeout for sync
  let syncDebounceTimeout = null;
  const SYNC_DEBOUNCE_MS = 3000; // Wait 3 seconds after last change before syncing

  /**
   * Save notes and trigger sync if logged in
   * @param {Array} notes - Array of note objects to save
   * @returns {Promise<boolean>} Success status
   */
  async function saveNotesWithSync(notes) {
    // Always save locally first
    const saved = await saveNotes(notes);

    if (!saved) return false;

    // Trigger debounced sync if user is logged in
    if (window.AccountService && window.AccountService.isLoggedIn()) {
      triggerDebouncedSync(notes);
    }

    return true;
  }

  /**
   * Trigger a debounced sync
   * @param {Array} notes - Current notes to sync
   */
  function triggerDebouncedSync(notes) {
    if (syncDebounceTimeout) {
      clearTimeout(syncDebounceTimeout);
    }

    syncDebounceTimeout = setTimeout(async () => {
      console.log('QuickNotesStorage: Triggering background sync...');
      try {
        const result = await window.AccountService.syncNotes(notes);
        if (result.success) {
          console.log('QuickNotesStorage: Sync complete', result.stats);
        } else {
          console.warn('QuickNotesStorage: Sync failed', result.error);
        }
      } catch (error) {
        console.warn('QuickNotesStorage: Sync error', error);
      }
    }, SYNC_DEBOUNCE_MS);
  }

  /**
   * Load notes with sync (pulls from server first if logged in)
   * @returns {Promise<Array>} Array of note objects
   */
  async function loadNotesWithSync() {
    // Load local notes first
    let localNotes = await loadNotes();

    // If logged in, sync with server
    if (window.AccountService && window.AccountService.isLoggedIn()) {
      try {
        console.log('QuickNotesStorage: Syncing on load...');
        const result = await window.AccountService.syncNotes(localNotes);
        if (result.success && result.notes) {
          // Update local storage with merged notes
          await saveNotes(result.notes);
          localNotes = result.notes;
          console.log('QuickNotesStorage: Loaded and synced notes', result.stats);
        }
      } catch (error) {
        console.warn('QuickNotesStorage: Sync on load failed, using local', error);
      }
    }

    return localNotes;
  }

  /**
   * Force immediate sync
   * @param {Array} notes - Current notes
   * @returns {Promise<{success: boolean, notes?: Array, error?: string}>}
   */
  async function forceSync(notes) {
    if (!window.AccountService || !window.AccountService.isLoggedIn()) {
      return { success: false, error: 'Not logged in' };
    }

    // Clear any pending debounced sync
    if (syncDebounceTimeout) {
      clearTimeout(syncDebounceTimeout);
      syncDebounceTimeout = null;
    }

    console.log('QuickNotesStorage: Force syncing...');
    const result = await window.AccountService.syncNotes(notes);

    if (result.success && result.notes) {
      await saveNotes(result.notes);
    }

    return result;
  }

  /**
   * Check if sync is available (user logged in)
   * @returns {boolean}
   */
  function isSyncAvailable() {
    return window.AccountService && window.AccountService.isLoggedIn();
  }

  // ==========================================================================
  // FOLDER PREFERENCES
  // ==========================================================================

  /**
   * Default folder colors palette
   */
  const FOLDER_COLORS = [
    { name: 'Gray', value: '#6b7280' },
    { name: 'Red', value: '#ef4444' },
    { name: 'Orange', value: '#f97316' },
    { name: 'Amber', value: '#f59e0b' },
    { name: 'Yellow', value: '#eab308' },
    { name: 'Lime', value: '#84cc16' },
    { name: 'Green', value: '#22c55e' },
    { name: 'Emerald', value: '#10b981' },
    { name: 'Teal', value: '#14b8a6' },
    { name: 'Cyan', value: '#06b6d4' },
    { name: 'Sky', value: '#0ea5e9' },
    { name: 'Blue', value: '#3b82f6' },
    { name: 'Indigo', value: '#6366f1' },
    { name: 'Violet', value: '#8b5cf6' },
    { name: 'Purple', value: '#a855f7' },
    { name: 'Fuchsia', value: '#d946ef' },
    { name: 'Pink', value: '#ec4899' },
    { name: 'Rose', value: '#f43f5e' }
  ];

  /**
   * Default folder preferences
   */
  const DEFAULT_FOLDER_PREFS = {
    myNotes: {
      collapsedFolders: [],
      folderColors: {},  // { folderName: '#hexcolor' }
      folderOrder: []    // Ordered folder names (empty = alphabetical)
    },
    teamNotes: {
      collapsedFolders: [],
      folderColors: {},
      folderOrder: []
    }
  };

  /**
   * Load folder preferences from storage
   * @returns {Promise<Object>} Folder preferences
   */
  async function loadFolderPrefs() {
    if (!isStorageAvailable()) {
      try {
        const stored = localStorage.getItem(FOLDER_PREFS_KEY);
        return stored ? JSON.parse(stored) : { ...DEFAULT_FOLDER_PREFS };
      } catch (error) {
        console.error('QuickNotesStorage: localStorage folder prefs error:', error);
        return { ...DEFAULT_FOLDER_PREFS };
      }
    }

    return new Promise((resolve) => {
      try {
        chrome.storage.sync.get([FOLDER_PREFS_KEY], (result) => {
          if (chrome.runtime.lastError) {
            console.error('QuickNotesStorage: Error loading folder prefs:', chrome.runtime.lastError.message);
            resolve({ ...DEFAULT_FOLDER_PREFS });
            return;
          }
          resolve(result[FOLDER_PREFS_KEY] || { ...DEFAULT_FOLDER_PREFS });
        });
      } catch (error) {
        console.error('QuickNotesStorage: Unexpected error loading folder prefs:', error);
        resolve({ ...DEFAULT_FOLDER_PREFS });
      }
    });
  }

  /**
   * Save folder preferences to storage
   * @param {Object} prefs - Folder preferences
   * @returns {Promise<boolean>} Success status
   */
  async function saveFolderPrefs(prefs) {
    if (!isStorageAvailable()) {
      try {
        localStorage.setItem(FOLDER_PREFS_KEY, JSON.stringify(prefs));
        return true;
      } catch (error) {
        console.error('QuickNotesStorage: localStorage folder prefs error:', error);
        return false;
      }
    }

    return new Promise((resolve) => {
      try {
        chrome.storage.sync.set({ [FOLDER_PREFS_KEY]: prefs }, () => {
          if (chrome.runtime.lastError) {
            console.error('QuickNotesStorage: Error saving folder prefs:', chrome.runtime.lastError.message);
            resolve(false);
            return;
          }
          resolve(true);
        });
      } catch (error) {
        console.error('QuickNotesStorage: Unexpected error saving folder prefs:', error);
        resolve(false);
      }
    });
  }

  /**
   * Migrate existing notes to have folder field
   * @param {Array} notes - Notes to migrate
   * @returns {Array} Migrated notes
   */
  function migrateNotesToFolders(notes) {
    return notes.map(note => ({
      ...note,
      folder: note.folder || 'General'
    }));
  }

  /**
   * Check if folder migration has been done
   * @returns {Promise<boolean>}
   */
  async function hasFolderMigrationRun() {
    if (!isStorageAvailable()) {
      return localStorage.getItem(FOLDER_MIGRATION_KEY) === 'true';
    }

    return new Promise((resolve) => {
      chrome.storage.sync.get([FOLDER_MIGRATION_KEY], (result) => {
        resolve(result[FOLDER_MIGRATION_KEY] === true);
      });
    });
  }

  /**
   * Mark folder migration as complete
   * @returns {Promise<void>}
   */
  async function setFolderMigrationComplete() {
    if (!isStorageAvailable()) {
      localStorage.setItem(FOLDER_MIGRATION_KEY, 'true');
      return;
    }

    return new Promise((resolve) => {
      chrome.storage.sync.set({ [FOLDER_MIGRATION_KEY]: true }, () => {
        resolve();
      });
    });
  }

  /**
   * Get unique folders from notes array
   * @param {Array} notes - Notes array
   * @returns {Array<string>} Unique folder names
   */
  function getFoldersFromNotes(notes) {
    const folders = new Set(['General']); // Always include General
    for (const note of notes) {
      if (note.folder) {
        folders.add(note.folder);
      }
    }
    return Array.from(folders);
  }

  /**
   * Track a deleted note ID for sync
   * @param {string} noteId - ID of the deleted note
   * @returns {Promise<boolean>} Success status
   */
  async function trackDeletedNote(noteId) {
    if (!noteId) return false;

    try {
      const stored = await chrome.storage.local.get([DELETED_NOTES_KEY]);
      const deletedNotes = stored[DELETED_NOTES_KEY] || [];

      // Add if not already tracked
      if (!deletedNotes.includes(noteId)) {
        deletedNotes.push(noteId);
        await chrome.storage.local.set({ [DELETED_NOTES_KEY]: deletedNotes });
        console.log('QuickNotesStorage: Tracked deleted note', noteId);
      }

      return true;
    } catch (error) {
      console.error('QuickNotesStorage: Error tracking deleted note', error);
      return false;
    }
  }

  /**
   * Get all tracked deleted note IDs
   * @returns {Promise<Array<string>>} Array of deleted note IDs
   */
  async function getDeletedNoteIds() {
    try {
      const stored = await chrome.storage.local.get([DELETED_NOTES_KEY]);
      return stored[DELETED_NOTES_KEY] || [];
    } catch (error) {
      console.error('QuickNotesStorage: Error getting deleted notes', error);
      return [];
    }
  }

  /**
   * Clear tracked deleted note IDs (after successful sync)
   * @returns {Promise<boolean>} Success status
   */
  async function clearDeletedNotes() {
    try {
      await chrome.storage.local.remove([DELETED_NOTES_KEY]);
      console.log('QuickNotesStorage: Cleared deleted notes tracking');
      return true;
    } catch (error) {
      console.error('QuickNotesStorage: Error clearing deleted notes', error);
      return false;
    }
  }

  /**
   * Track a deleted template ID for sync
   * @param {string} templateId - ID of the deleted template
   * @returns {Promise<boolean>} Success status
   */
  async function trackDeletedTemplate(templateId) {
    if (!templateId) return false;

    try {
      const stored = await chrome.storage.local.get([DELETED_TEMPLATES_KEY]);
      const deletedTemplates = stored[DELETED_TEMPLATES_KEY] || [];

      if (!deletedTemplates.includes(templateId)) {
        deletedTemplates.push(templateId);
        await chrome.storage.local.set({ [DELETED_TEMPLATES_KEY]: deletedTemplates });
        console.log('QuickNotesStorage: Tracked deleted template', templateId);
      }

      return true;
    } catch (error) {
      console.error('QuickNotesStorage: Error tracking deleted template', error);
      return false;
    }
  }

  /**
   * Get all tracked deleted template IDs
   * @returns {Promise<Array<string>>} Array of deleted template IDs
   */
  async function getDeletedTemplateIds() {
    try {
      const stored = await chrome.storage.local.get([DELETED_TEMPLATES_KEY]);
      return stored[DELETED_TEMPLATES_KEY] || [];
    } catch (error) {
      console.error('QuickNotesStorage: Error getting deleted templates', error);
      return [];
    }
  }

  /**
   * Clear tracked deleted template IDs (after successful sync)
   * @returns {Promise<boolean>} Success status
   */
  async function clearDeletedTemplates() {
    try {
      await chrome.storage.local.remove([DELETED_TEMPLATES_KEY]);
      console.log('QuickNotesStorage: Cleared deleted templates tracking');
      return true;
    } catch (error) {
      console.error('QuickNotesStorage: Error clearing deleted templates', error);
      return false;
    }
  }

  // Public API
  return {
    // Constants
    STORAGE_KEY,
    WIDTH_STORAGE_KEY,
    FOLDER_PREFS_KEY,
    MIN_WIDTH,
    MAX_WIDTH,
    FOLDER_COLORS,

    // Methods
    loadNotes,
    saveNotes,
    exportNotes,
    importNotes,
    saveWidth,
    loadWidth,
    generateId,

    // Sync-aware methods
    loadNotesWithSync,
    saveNotesWithSync,
    forceSync,
    isSyncAvailable,

    // Folder methods
    loadFolderPrefs,
    saveFolderPrefs,
    migrateNotesToFolders,
    hasFolderMigrationRun,
    setFolderMigrationComplete,
    getFoldersFromNotes,

    // Deletion tracking methods
    trackDeletedNote,
    getDeletedNoteIds,
    clearDeletedNotes,
    trackDeletedTemplate,
    getDeletedTemplateIds,
    clearDeletedTemplates
  };
})();

// Make available globally
if (typeof window !== 'undefined') {
  window.QuickNotesStorage = QuickNotesStorage;
}
