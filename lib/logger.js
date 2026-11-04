/*-------------------------------------------------
 * RunBox — VS Code Extension
 * Copyright (c) 2026 Abdulla Aldosari
 * Licensed under the MIT License.
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
 * Formats a raw model response for display in the output channel.
 * Pretty-prints it when it parses as JSON; otherwise returns it verbatim
 * (covers truncated/invalid responses, which are not valid JSON).
 * @param {unknown} text
 * @returns {string}
 */
function formatResponseText(text) {
  if (typeof text !== "string") return JSON.stringify(text, null, 2);
  try {
    return JSON.stringify(JSON.parse(text), null, 2);
  } catch {
    return text;
  }
}

/**
 * Logs a complete AI interaction to the VS Code output channel.
 * Does nothing if the channel is not initialized or debugOutput setting is off.
 * Response and error are independent: both are written whenever present, so a
 * truncated or invalid response still shows the raw model output alongside
 * the error. Never throws: logging failures must not break AI generation.
 *
 * @param {{
 *   provider: string,
 *   mode: string,
 *   prompt: string,
 *   systemInstruction: string,
 *   schema?: object,
 *   result?: string,
 *   error?: unknown,
 * }} entry
 */
function logAiInteraction(entry) {
  if (!_channel || !isDebugEnabled()) return;

  try {
    // ── Block 1: System Instruction ──────────────────────────────
    if (entry.systemInstruction) {
      _channel.appendLine(["", dash, "📋 system instruction :", divider, entry.systemInstruction, divider].join("\n"));
    }

    // ── Block 2: Schema (optional) ───────────────────────────────
    if (entry.schema !== undefined) {
      _channel.appendLine(["", dash, "📐 schema :", divider, JSON.stringify(entry.schema, null, 2), divider].join("\n"));
    }

    // ── Block 3: AI Request info ──────────────────────────────────
    const request = {
      ai_request: {
        provider: entry.provider,
        modelId: entry.modelId,
        mode: entry.mode,
        timestamp: new Date().toLocaleString(),
      },
      user_prompt: entry.prompt,
    };
    _channel.appendLine(["", dash, "📩 AI Request :", divider, JSON.stringify(request, null, 2), divider].join("\n"));

    // ── Block 4: Raw model response (always shown when present, even on error) ──
    if (entry.result !== undefined) {
      _channel.appendLine(["", dash, "📨 AI Response :", divider, formatResponseText(entry.result), divider].join("\n"));
    }

    // ── Block 5: Error (shown alongside the response above when both exist) ──
    if (entry.error !== undefined) {
      _channel.appendLine(["", dash, "⚠️ AI Error :", divider, JSON.stringify(serializeError(entry.error), null, 2), divider].join("\n"));
    }

    _channel.show(true);
  } catch (err) {
    try {
      _channel.appendLine(`\n${dash}\nFailed to write AI debug log: ${err && err.message ? err.message : String(err)}\n${dash}`);
    } catch {
      // Output channel itself is unavailable; nothing more we can do.
    }
  }
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

  _channel.appendLine(["", dash, `📋 Available models for provider: ${entry.provider}`, divider, JSON.stringify(entry.models, null, 2), divider].join("\n"));

  _channel.show(true);
}

module.exports = { logAiInteraction, logProviderModels, initLogger };
