// Device-local settings overlay
//
// darkMode and darkModeLevel are display preferences — an office monitor and
// a field laptop legitimately want different answers — so they live in
// chrome.storage.local (per-device) instead of syncing with the rest of
// jtToolsSettings. Readers overlay these values onto the merged synced blob;
// every existing writer keeps writing the blob untouched. The blob's own
// darkMode/darkModeLevel copies become legacy seed material: the first read
// on a device copies them into local, once, so the user's prior choice
// carries over instead of resetting.

const JTDeviceSettings = (() => {
  const DEVICE_KEY = 'jtToolsDeviceSettings';
  const SETTINGS_KEY = 'jtToolsSettings';
  const LEVELS = ['soft', 'dark', 'double'];

  function storageAvailable() {
    return typeof chrome !== 'undefined' && chrome.storage &&
           chrome.storage.local && chrome.storage.sync;
  }

  // Keep only valid device fields; junk values fall away so the overlay
  // never overrides the synced defaults with garbage.
  function sanitize(raw) {
    const out = {};
    if (raw && typeof raw === 'object') {
      if (typeof raw.darkMode === 'boolean') out.darkMode = raw.darkMode;
      if (LEVELS.includes(raw.darkModeLevel)) out.darkModeLevel = raw.darkModeLevel;
    }
    return out;
  }

  function localGetRaw() {
    return new Promise(resolve => {
      chrome.storage.local.get([DEVICE_KEY], result => {
        if (chrome.runtime.lastError) {
          console.warn('JTDeviceSettings: local read failed:', chrome.runtime.lastError.message);
          return resolve(undefined);
        }
        resolve(result ? result[DEVICE_KEY] : undefined);
      });
    });
  }

  function localSet(value) {
    return new Promise(resolve => {
      chrome.storage.local.set({ [DEVICE_KEY]: value }, () => {
        if (chrome.runtime.lastError) {
          console.warn('JTDeviceSettings: local write failed:', chrome.runtime.lastError.message);
        }
        resolve();
      });
    });
  }

  function syncGetBlob() {
    return new Promise(resolve => {
      chrome.storage.sync.get([SETTINGS_KEY], result => {
        if (chrome.runtime.lastError) return resolve({});
        resolve((result && result[SETTINGS_KEY]) || {});
      });
    });
  }

  /**
   * This device's dark mode values. First call on a device seeds local from
   * the synced blob's legacy copies (then never re-reads them). May return a
   * partial object — absent fields mean "use the synced/default value".
   */
  async function get() {
    if (!storageAvailable()) return {};
    const stored = await localGetRaw();
    if (stored !== undefined && stored !== null) return sanitize(stored);
    const seeded = sanitize(await syncGetBlob());
    await localSet(seeded);
    return seeded;
  }

  /** Merge a patch ({ darkMode?, darkModeLevel? }) into this device's values. */
  async function set(patch) {
    if (!storageAvailable()) return;
    const current = await get();
    await localSet({ ...current, ...sanitize(patch) });
  }

  /** A merged settings object with this device's dark mode values applied. */
  async function overlay(settings) {
    const device = await get();
    return { ...settings, ...device };
  }

  return { get, set, overlay };
})();

// Export for use in content scripts and popup
if (typeof window !== 'undefined') {
  window.JTDeviceSettings = JTDeviceSettings;
}

// Export for tests
if (typeof module !== 'undefined' && module.exports) {
  module.exports = JTDeviceSettings;
}
