/*-------------------------------------------------
 * RunBox — VS Code Extension
 * Copyright (c) 2026 Abdulla Aldosari
 * Licensed under the Apache License, Version 2.0.
 * See LICENSE in the project root for details.
 *-------------------------------------------------*/

const OpenAI = require("openai");
const { SCHEMA_FULL, SCHEMA_SINGLE, addAdditionalPropertiesFalse } = require("../schemas");
const { getProviderConfig } = require("../providers-config");

/**
 * AI provider implementation for OpenAI (GPT-4.1).
 * Uses OpenAI's structured JSON output (`json_schema`) for reliable response formatting.
 * OpenAI strict mode requires `additionalProperties: false` on every object schema,
 * which is injected via `addAdditionalPropertiesFalse` before sending.
 */
class OpenAIProvider {
  constructor(apiKey, modelId) {
    this.client = new OpenAI({ apiKey });
    const cfg = getProviderConfig("openai");
    this.modelId = modelId || cfg.defaultModelId || cfg.models[0].modelId;
  }

  /**
   * Returns the raw model list from the OpenAI API.
   * Filtering (keywords, exact IDs, deduplication) is handled centrally in factory.js.
   * @returns {Promise<{modelId: string, modelLabel: string}[]>}
   */
  async listModels() {
    const models = [];
    for await (const model of this.client.models.list()) {
      models.push({ modelId: model.id, modelLabel: model.id });
    }
    return models;
  }

  /**
   * Performs a single lightweight request (first page of models only) to verify
   * API key validity and connectivity. Throws on failure.
   * @returns {Promise<void>}
   */
  async checkConnection() {
    for await (const _model of this.client.models.list()) {
      break;
    }
  }

  /**
   * Returns the raw markdown explanation of a CLI command.
   * @param {string} command
   * @param {string} systemInstruction
   * @returns {Promise<string>}
   */
  async explainCommand(command, systemInstruction) {
    const response = await this.client.chat.completions.create({
      model: this.modelId,
      messages: [
        { role: "system", content: systemInstruction },
        { role: "user", content: command },
      ],
    });
    return response.choices[0].message.content;
  }

  /**
   * Sends a minimal chat completion request and reads OpenAI's rate limit
   * headers from the raw HTTP response (x-ratelimit-*).
   * @returns {Promise<{limitRequests:number, remainingRequests:number, limitTokens:number, remainingTokens:number, resetRequestsSeconds:number|null, resetTokensSeconds:number|null}>}
   */
  async checkRateLimits() {
    const { response } = await this.client.chat.completions
      .create({
        model: this.modelId,
        messages: [{ role: "user", content: "Hi" }],
        max_tokens: 1,
      })
      .withResponse();

    const headers = response.headers;
    const parseIntHeader = function (name) {
      const raw = headers.get(name);
      const n = parseInt(raw, 10);
      return Number.isFinite(n) ? n : null;
    };
    // OpenAI's reset headers are duration strings (e.g. "6m0s"), not seconds — parse them.
    const parseResetHeader = function (name) {
      const raw = headers.get(name);
      if (!raw) return null;
      const match = raw.match(/(?:(\d+)h)?(?:(\d+)m)?(?:([\d.]+)s)?/);
      if (!match) return null;
      const hours = parseFloat(match[1] || "0");
      const minutes = parseFloat(match[2] || "0");
      const seconds = parseFloat(match[3] || "0");
      return Math.round(hours * 3600 + minutes * 60 + seconds);
    };

    return {
      limitRequests: parseIntHeader("x-ratelimit-limit-requests"),
      remainingRequests: parseIntHeader("x-ratelimit-remaining-requests"),
      limitTokens: parseIntHeader("x-ratelimit-limit-tokens"),
      remainingTokens: parseIntHeader("x-ratelimit-remaining-tokens"),
      resetRequestsSeconds: parseResetHeader("x-ratelimit-reset-requests"),
      resetTokensSeconds: parseResetHeader("x-ratelimit-reset-tokens"),
    };
  }

  async generateCommands(prompt, mode, systemInstruction) {
    // OpenAI strict mode requires additionalProperties: false on every object
    const baseSchema = mode === "full" ? SCHEMA_FULL : SCHEMA_SINGLE;
    const schema = addAdditionalPropertiesFalse(baseSchema);
    const schemaName = mode === "full" ? "terminal_commands_full" : "terminal_commands_single";

    const response = await this.client.chat.completions.create({
      model: this.modelId,
      messages: [
        { role: "system", content: systemInstruction },
        { role: "user", content: prompt },
      ],
      response_format: {
        type: "json_schema",
        json_schema: {
          name: schemaName,
          strict: true,
          schema,
        },
      },
    });

    return { data: JSON.parse(response.choices[0].message.content), schema };
  }
}

module.exports = { OpenAIProvider };
