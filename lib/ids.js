/*-------------------------------------------------
 * RunBox — VS Code Extension
 * Copyright (c) 2026 Abdulla Aldosari
 * Licensed under the MIT License.
 * See LICENSE in the project root for details.
 *-------------------------------------------------*/

// lib/ids.js
// Entity ID format for categories, groups, and commands.
//
// IDs are 12 lowercase hex characters built from 6 cryptographically random
// bytes. The webview generates IDs for entities the user creates (so it can
// render them before the save round-trip completes) with the same format via
// generateEntityId() in media/utils.js; the two implementations must stay
// identical. The extension is the authority: every add operation is checked
// with isValidEntityId() and rejected when the ID is malformed or already used.
// IDs written before this format existed are never re-validated.

const crypto = require("crypto");

const ENTITY_ID_BYTES = 6;
const ENTITY_ID_PATTERN = /^[0-9a-f]{12}$/;

/**
 * Generates a new entity ID (12 lowercase hex characters).
 * @returns {string}
 */
function generateEntityId() {
  return crypto.randomBytes(ENTITY_ID_BYTES).toString("hex");
}

/**
 * Returns true when `id` matches the entity ID format.
 * @param {*} id
 * @returns {boolean}
 */
function isValidEntityId(id) {
  return typeof id === "string" && ENTITY_ID_PATTERN.test(id);
}

module.exports = { generateEntityId, isValidEntityId, ENTITY_ID_PATTERN };
