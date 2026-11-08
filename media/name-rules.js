/*-------------------------------------------------
 * RunBox — VS Code Extension
 * Copyright (c) 2026 Abdulla Aldosari
 * Licensed under the MIT License.
 * See LICENSE in the project root for details.
 *-------------------------------------------------*/

// media/name-rules.js
// Format rules for category and group names typed by the user.
// A name has at most NAME_MAX_LENGTH characters and uses only letters (any
// language), numbers, spaces, and the symbols - _ . & + # / ( ) :
// It must contain at least one letter or number.

const NAME_MAX_LENGTH = 40;
const NAME_ALLOWED_PATTERN = /^[\p{L}\p{N} \-_.&+#/():]+$/u;
const NAME_LETTER_OR_NUMBER_PATTERN = /[\p{L}\p{N}]/u;

/**
 * Trims a name and collapses every run of whitespace into one space.
 * @param {string} value
 * @returns {string}
 */
function normalizeName(value) {
  return String(value).replace(/\s+/g, " ").trim();
}

/**
 * Returns the first format problem of a normalized name, or "" when the name
 * is valid. An empty name returns "" because "Name is required" is reported
 * separately.
 * @param {string} name Normalized name (see normalizeName)
 * @returns {string}
 */
function getNameFormatError(name) {
  if (!name) {
    return "";
  }
  if (name.length > NAME_MAX_LENGTH) {
    return `Use ${NAME_MAX_LENGTH} characters or fewer`;
  }
  if (!NAME_ALLOWED_PATTERN.test(name)) {
    return "Use letters, numbers, and - _ . & + # / ( ) : only";
  }
  if (!NAME_LETTER_OR_NUMBER_PATTERN.test(name)) {
    return "Include at least one letter or number";
  }
  return "";
}
