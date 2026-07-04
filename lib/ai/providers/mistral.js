/*-------------------------------------------------
 * Terminal Recipes — VS Code Extension
 * Copyright (c) 2026 Abdulla Aldosari
 * Licensed under the Apache License, Version 2.0.
 * See LICENSE in the project root for details.
 *-------------------------------------------------*/

const { Mistral } = require("@mistralai/mistralai");
const { SCHEMA_FULL, SCHEMA_SINGLE } = require("../schemas");
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

  async generateCommands(prompt, mode, systemInstruction) {
    const schema = mode === "full" ? SCHEMA_FULL : SCHEMA_SINGLE;

    const enhancedSystem = `${systemInstruction}

You MUST respond with a valid JSON object that matches this JSON Schema exactly:
${JSON.stringify(schema, null, 2)}

Do NOT include any text, explanation, or markdown before or after the JSON.`;

    const response = await this.client.chat.complete({
      model: this.modelId,
      messages: [
        { role: "system", content: enhancedSystem },
        { role: "user", content: prompt },
      ],
      responseFormat: { type: "json_object" },
    });

    const content = response.choices[0].message.content;

    const jsonMatch = content.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      throw new Error("Mistral response did not contain valid JSON.");
    }

    return { data: JSON.parse(jsonMatch[0]), schema };
  }
}

module.exports = { MistralProvider };
