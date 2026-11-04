/*-------------------------------------------------
 * RunBox — VS Code Extension
 * Copyright (c) 2026 Abdulla Aldosari
 * Licensed under the MIT License.
 * See LICENSE in the project root for details.
 *-------------------------------------------------*/

// lib/ai/languages.js
// Closed list of languages accepted by the `runBox.aiOutputLanguage` setting.
// The value is inserted into AI system instructions, so only these exact
// strings are ever used; anything else falls back to DEFAULT_AI_OUTPUT_LANGUAGE.
// The `enum` of `runBox.aiOutputLanguage` in package.json must list exactly
// these values in the same order (checked by testing/ai-generation.test.js).

const AI_OUTPUT_LANGUAGES = ["English", "Arabic", "Chinese", "Spanish", "French", "German", "Japanese", "Korean", "Portuguese", "Russian", "Turkish", "Hindi"];

const DEFAULT_AI_OUTPUT_LANGUAGE = "English";

/**
 * Returns `value` when it is a supported language, otherwise the default.
 * @param {*} value
 * @returns {string}
 */
function resolveAiOutputLanguage(value) {
  return AI_OUTPUT_LANGUAGES.includes(value) ? value : DEFAULT_AI_OUTPUT_LANGUAGE;
}

module.exports = { AI_OUTPUT_LANGUAGES, DEFAULT_AI_OUTPUT_LANGUAGE, resolveAiOutputLanguage };
