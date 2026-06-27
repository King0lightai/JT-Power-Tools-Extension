/**
 * Obfuscation
 *
 * Shared XOR + Base64 transform used to keep sensitive values (license data,
 * grant keys) out of plain sight in Chrome storage. This is NOT cryptographic
 * security — it only prevents casual inspection. LicenseService and
 * JobTreadProService each used their own byte-identical copy of this logic,
 * differing only by their obfuscation key; this module is the single home.
 *
 * Each caller passes its own key so stored payloads remain compatible.
 * Callers keep their existing try/catch wrappers (logging + fallback), so
 * these functions stay pure transforms and may throw on malformed input.
 *
 * Must load before its consumers in the manifest content_scripts list.
 */
const Obfuscation = (() => {
  /**
   * XOR + Base64 encode a string.
   * @param {string} text - Plain text to obfuscate
   * @param {string} key - Obfuscation key
   * @returns {string} Base64-encoded obfuscated string
   */
  function obfuscate(text, key) {
    const textBytes = new TextEncoder().encode(text);
    const keyBytes = new TextEncoder().encode(key);
    const obfuscated = new Uint8Array(textBytes.length);
    for (let i = 0; i < textBytes.length; i++) {
      obfuscated[i] = textBytes[i] ^ keyBytes[i % keyBytes.length];
    }
    return btoa(String.fromCharCode(...obfuscated));
  }

  /**
   * Decode a string produced by obfuscate().
   * @param {string} obfuscatedText - Base64-encoded obfuscated string
   * @param {string} key - Obfuscation key
   * @returns {string} Original plain text
   */
  function deobfuscate(obfuscatedText, key) {
    const obfuscated = Uint8Array.from(atob(obfuscatedText), c => c.charCodeAt(0));
    const keyBytes = new TextEncoder().encode(key);
    const original = new Uint8Array(obfuscated.length);
    for (let i = 0; i < obfuscated.length; i++) {
      original[i] = obfuscated[i] ^ keyBytes[i % keyBytes.length];
    }
    return new TextDecoder().decode(original);
  }

  return { obfuscate, deobfuscate };
})();

window.Obfuscation = Obfuscation;
