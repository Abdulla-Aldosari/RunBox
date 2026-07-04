/*-------------------------------------------------
 * RunBox — VS Code Extension
 * Copyright (c) 2026 Abdulla Aldosari
 * Licensed under the Apache License, Version 2.0.
 * See LICENSE in the project root for details.
 *-------------------------------------------------*/

/**
 * Global logger — centralized output channel for the extension.
 * Call initLogger() once at activation time in "extension.js".
 */

const dash = "─".repeat(60);
const divider = "═".repeat(60);

let _channel = null;

/**
 * Returns true if the `runBox.debugOutput` setting is enabled.
 * Read dynamically on every call so changes take effect without restarting.
 * @returns {boolean}
 */
function isDebugEnabled() {
  return require("vscode").workspace.getConfiguration("runBox").get("debugOutput") === true;
}

/**
 * Initializes the global logger. Must be called once during extension activation.
 * @param {import('vscode').OutputChannel} channel
 */
function initLogger(channel) {
  _channel = channel;
}

/**
 * Serializes an error object into a plain JSON-safe object.
 * @param {unknown} error
 * @returns {object}
 */
function serializeError(error) {
  if (!error) return { summary_message: "Unknown error" };
  const plain = { summary_message: error.message ? error.message : String(error) };
  if (typeof error === "object") {
    for (const key of Object.keys(error)) {
      plain[key] = error[key];
    }
  }
  return plain;
}

/**
 * Logs a complete AI interaction to the VS Code output channel.
 * Does nothing if the channel is not initialized or debugOutput setting is off.
 *
 * @param {{
 *   provider: string,
 *   mode: string,
 *   prompt: string,
 *   systemInstruction: string,
 *   schema?: object,
 *   result?: object,
 *   error?: unknown,
 * }} entry
 */
function logAiInteraction(entry) {
  if (!_channel || !isDebugEnabled()) return;

  // ── Block 1: System Instruction ──────────────────────────────
  if (entry.systemInstruction) {
    _channel.appendLine(["", dash, "📋 system instruction :", divider, entry.systemInstruction, divider].join("\n"));
  }

  // ── Block 2: Schema (optional) ───────────────────────────────
  if (entry.schema !== undefined) {
    _channel.appendLine(["", dash, "📐 schema :", divider, JSON.stringify(entry.schema, null, 2), divider].join("\n"));
  }

  // ── Block 3: AI Request / Response or Error ───────────────────
  const log = {
    ai_request: {
      provider: entry.provider,
      modelId: entry.modelId,
      mode: entry.mode,
      timestamp: new Date().toLocaleString(),
    },
    user_prompt: entry.prompt,
  };

  if (entry.error !== undefined) {
    log.ai_error = serializeError(entry.error);
  } else {
    log.ai_response = entry.result;
  }

  _channel.appendLine(["", dash, "📩 AI Request :", divider, JSON.stringify(log, null, 2), divider].join("\n"));

  _channel.show(true);
}

/**
 * Logs the list of available models for a provider to the VS Code output channel.
 * Does nothing if the channel is not initialized or debugOutput setting is off.
 *
 * @param {{
 *   provider: string,
 *   models: {modelId: string, modelLabel: string}[],
 * }} entry
 */
function logProviderModels(entry) {
  if (!_channel || !isDebugEnabled()) return;

  _channel.appendLine(
    [
      "",
      dash,
      `📋 Available models for provider: ${entry.provider}`,
      divider,
      JSON.stringify(entry.models, null, 2),
      divider,
    ].join("\n")
  );

  _channel.show(true);
}

module.exports = { logAiInteraction, logProviderModels, initLogger };
