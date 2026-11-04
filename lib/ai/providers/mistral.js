/*-------------------------------------------------
 * RunBox — VS Code Extension
 * Copyright (c) 2026 Abdulla Aldosari
 * Licensed under the MIT License.
 * See LICENSE in the project root for details.
 *-------------------------------------------------*/

const { Mistral } = require("@mistralai/mistralai");
const { buildSchemaAppendix } = require("../structured-output");
const { getProviderConfig } = require("../providers-config");

/**
 * AI provider implementation for Mistral AI.
 * Uses Mistral's chat completions API with json_object response format.
 * The JSON schema is embedded in the system instruction.
 * Mistral Small and Codestral are available on the free tier.
 */
class MistralProvider {
  constructor(apiKey, modelId) {
    this.apiKey = apiKey;
    this.client = new Mistral({ apiKey });
    const cfg = getProviderConfig("mistral");
    this.modelId = modelId || cfg.defaultModelId || cfg.models[0].modelId;
  }

  /**
   * Returns the raw model list from the Mistral API.
   * Filtering (keywords, exact IDs, deduplication) is handled centrally in factory.js.
   * @returns {Promise<{modelId: string, modelLabel: string}[]>}
   */
  async listModels() {
    const response = await this.client.models.list();
    return (response.data || []).map(function (m) {
      return { modelId: m.id, modelLabel: m.id };
    });
  }

  /**
   * Performs a single lightweight request to verify API key validity and connectivity.
   * Throws on failure.
   * @returns {Promise<void>}
   */
  async checkConnection() {
    await this.client.models.list();
  }

  /**
   * Sends a minimal chat completion request via a direct fetch call (bypassing the
   * SDK) and reads Mistral's rate limit headers from the raw HTTP response.
   * A direct fetch is used because the Mistral SDK does not expose raw response
   * headers through its chat.complete() method.
   * @returns {Promise<{limitRequestsMinute:number, remainingRequestsMinute:number, limitTokensMinute:number, remainingTokensMinute:number}>}
   */
  async checkRateLimits() {
    const res = await fetch("https://api.mistral.ai/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify({
        model: this.modelId,
        messages: [{ role: "user", content: "Hi" }],
        max_tokens: 1,
      }),
    });

    if (!res.ok) {
      const errBody = await res.text();
      throw new Error(`Mistral API error (${res.status}): ${errBody}`);
    }

    const parseIntHeader = function (name) {
      const raw = res.headers.get(name);
      const n = parseInt(raw, 10);
      return Number.isFinite(n) ? n : null;
    };

    return {
      limitRequestsMinute: parseIntHeader("x-ratelimit-limit-req-minute"),
      remainingRequestsMinute: parseIntHeader("x-ratelimit-remaining-req-minute"),
      limitTokensMinute: parseIntHeader("x-ratelimit-limit-tokens-minute"),
      remainingTokensMinute: parseIntHeader("x-ratelimit-remaining-tokens-minute"),
    };
  }

  /**
   * Returns the raw markdown explanation of a CLI command.
   * @param {string} command
   * @param {string} systemInstruction
   * @returns {Promise<string>}
   */
  async explainCommand(command, systemInstruction) {
    const response = await this.client.chat.complete({
      model: this.modelId,
      messages: [
        { role: "system", content: systemInstruction },
        { role: "user", content: command },
      ],
    });
    return response.choices[0].message.content;
  }

  /**
   * Sends one JSON request in json_object mode with the schema appended to the system instruction.
   * @param {{ system: string, prompt: string, schema: object, signal?: AbortSignal }} request
   * @returns {Promise<{ text: string, truncated: boolean }>}
   */
  async completeJson(request) {
    const response = await this.client.chat.complete(
      {
        model: this.modelId,
        messages: [
          { role: "system", content: `${request.system}${buildSchemaAppendix(request.schema)}` },
          { role: "user", content: request.prompt },
        ],
        responseFormat: { type: "json_object" },
      },
      { signal: request.signal }
    );

    const choice = response.choices[0];
    const content = choice.message ? choice.message.content : "";
    const text = typeof content === "string" ? content : "";
    return { text, truncated: choice.finishReason === "length" || choice.finishReason === "model_length" };
  }
}

module.exports = { MistralProvider };
