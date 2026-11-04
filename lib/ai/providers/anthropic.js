/*-------------------------------------------------
 * RunBox — VS Code Extension
 * Copyright (c) 2026 Abdulla Aldosari
 * Licensed under the MIT License.
 * See LICENSE in the project root for details.
 *-------------------------------------------------*/

const Anthropic = require("@anthropic-ai/sdk");
const { buildSchemaAppendix } = require("../structured-output");
const { getProviderConfig } = require("../providers-config");

/**
 * Output-token limit for JSON requests. The Anthropic API requires max_tokens
 * on every request (other providers fall back to their own default limit).
 * 8192 fits the largest response the two-stage flow produces (one group of at
 * most MAX_COMMANDS_PER_GROUP commands) and stays within the SDK's
 * non-streaming limits: the 10-minute expected-time check (about 21k tokens)
 * and the 8192-token cap it enforces for older Opus 4 models.
 */
const JSON_MAX_OUTPUT_TOKENS = 8192;

/**
 * AI provider implementation for Anthropic Claude.
 * The JSON schema is appended to the system instruction; parsing, truncation
 * handling, and validation happen in lib/ai/structured-output.js.
 */
class AnthropicProvider {
  constructor(apiKey, modelId) {
    this.client = new Anthropic({ apiKey });
    const cfg = getProviderConfig("anthropic");
    this.modelId = modelId || cfg.defaultModelId || cfg.models[0].modelId;
  }

  /**
   * Returns the raw model list from the Anthropic API.
   * Filtering (keywords, exact IDs, deduplication) is handled centrally in factory.js.
   * @returns {Promise<{modelId: string, modelLabel: string}[]>}
   */
  async listModels() {
    const models = [];
    for await (const model of this.client.models.list()) {
      models.push({
        modelId: model.id,
        modelLabel: model.display_name || model.id,
      });
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
   * @param {string} systemInstruction`r`n   * @param {AbortSignal} [signal]
   * @returns {Promise<string>}
   */
  async explainCommand(command, systemInstruction, signal) {
    const response = await this.client.messages.create(
      {
        model: this.modelId,
        max_tokens: 4096,
        system: systemInstruction,
        messages: [{ role: "user", content: command }],
      },
      { signal }
    );
    return response.content[0].text;
  }

  /**
   * Sends a minimal message request and reads Anthropic's rate limit headers
   * from the raw HTTP response (anthropic-ratelimit-*).
   * @returns {Promise<{limitRequests:number, remainingRequests:number, resetRequests:string|null, limitTokens:number, remainingTokens:number, resetTokens:string|null}>}
   */
  async checkRateLimits() {
    const { response } = await this.client.messages
      .create({
        model: this.modelId,
        max_tokens: 1,
        messages: [{ role: "user", content: "Hi" }],
      })
      .withResponse();

    const headers = response.headers;
    const parseIntHeader = function (name) {
      const raw = headers.get(name);
      const n = parseInt(raw, 10);
      return Number.isFinite(n) ? n : null;
    };

    return {
      limitRequests: parseIntHeader("anthropic-ratelimit-requests-limit"),
      remainingRequests: parseIntHeader("anthropic-ratelimit-requests-remaining"),
      resetRequests: headers.get("anthropic-ratelimit-requests-reset"),
      limitTokens: parseIntHeader("anthropic-ratelimit-tokens-limit"),
      remainingTokens: parseIntHeader("anthropic-ratelimit-tokens-remaining"),
      resetTokens: headers.get("anthropic-ratelimit-tokens-reset"),
    };
  }

  /**
   * Sends one JSON request. The schema is appended to the system instruction
   * because structured output is not used for this provider.
   * @param {{ system: string, prompt: string, schema: object, signal?: AbortSignal }} request
   * @returns {Promise<{ text: string, truncated: boolean }>}
   */
  async completeJson(request) {
    const response = await this.client.messages.create(
      {
        model: this.modelId,
        max_tokens: JSON_MAX_OUTPUT_TOKENS,
        system: `${request.system}${buildSchemaAppendix(request.schema)}`,
        messages: [{ role: "user", content: request.prompt }],
      },
      { signal: request.signal }
    );

    const text = response.content
      .filter(function (block) {
        return block.type === "text";
      })
      .map(function (block) {
        return block.text;
      })
      .join("");

    return { text, truncated: response.stop_reason === "max_tokens" };
  }
}

module.exports = { AnthropicProvider };
