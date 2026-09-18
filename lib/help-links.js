/*-------------------------------------------------
 * RunBox — VS Code Extension
 * Copyright (c) 2026 Abdulla Aldosari
 * Licensed under the Apache License, Version 2.0.
 * See LICENSE in the project root for details.
 *-------------------------------------------------*/

// lib/help-links.js
// Centralized registry of external help/documentation links used across the
// extension (notifications, buttons, etc.), keyed by a stable identifier.
// Keeping every link in one place makes them easy to find, update, or
// replace later without having to search through call sites.

/**
 * Maps a stable link key to its current URL.
 * @type {Record<string, string>}
 */
const HELP_LINKS = {
  "faqs-duplicate-terminal-profiles":
    "https://github.com/Abdulla-Aldosari/runbox/blob/main/docs/faqs.md#duplicate-terminal-profiles",
};

/**
 * Returns the URL registered under the given key.
 * @param {string} key - One of the keys defined in HELP_LINKS
 * @returns {string|null} The URL, or null if the key is not registered
 */
function getHelpLink(key) {
  return HELP_LINKS[key] || null;
}

module.exports = {
  getHelpLink,
};
