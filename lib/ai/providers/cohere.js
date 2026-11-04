/*-------------------------------------------------
 * RunBox — VS Code Extension
 * Copyright (c) 2026 Abdulla Aldosari
 * Licensed under the MIT License.
 * See LICENSE in the project root for details.
 *-------------------------------------------------*/

const { CohereClient } = require("cohere-ai");
const { buildSchemaAppendix } = require("../structured-output");
const { getProviderConfig } = require("../providers-config");

/**
 * AI provider implementation for Cohere.
 * Uses Cohere's chat API with response_format json_object.
 * The JSON schema is embedded in the system instruction (preamble).
 * Command R7B is available on the free trial tier.
 */
class CohereProvider {
  constructor(apiKey, modelId) {
    this.client = new CohereClient({ token: apiKey });
    const cfg = getProviderConfig("cohere");
    this.modelId = modelId || cfg.defaultModelId || cfg.models[0].modelId;
  }

  /**
   * Returns the raw model list from the Cohere API.
   * Filtering (keywords, exact IDs, deduplication) is handled centrally in factory.js.
   * @returns {Promise<{modelId: string, modelLabel: string}[]>}
   */
  async listModels() {
    const allItems = [];
    let nextPageToken = undefined;

    while (true) {
      // The actual maximum value for `pageSize` in The Cohere REST API has an actual maximum of 100
      // If the number of models exceeds 100, `nextPageToken` will be used to retrieve the remaining pages sequentially.
      const response = await this.client.models.list({ pageSize: 100, pageToken: nextPageToken });
      const items = response.models || response.data || [];
      allItems.push.apply(allItems, items);
      nextPageToken = response.nextPageToken;
      if (!nextPageToken) {
        break;
      }
    }

    return allItems.map(function (m) {
      return { modelId: m.name || m.id, modelLabel: m.name || m.id };
    });
  }

  /**
   * Performs a single lightweight request (first page of models only) to verify
   * API key validity and connectivity. Throws on failure.
   * @returns {Promise<void>}
   */
  async checkConnection() {
    await this.client.models.list({ pageSize: 1 });
  }

  /**
   * Returns the raw markdown explanation of a CLI command.
   * @param {string} command
   * @param {string} systemInstruction`r`n   * @param {AbortSignal} [signal]
   * @returns {Promise<string>}
   */
  async explainCommand(command, systemInstruction, signal) {
    const response = await this.client.chat(
      {
        model: this.modelId,
        preamble: systemInstruction,
        message: command,
      },
      { abortSignal: signal }
    );
    return response.text;
  }

  /**
   * Sends one JSON request in json_object mode with the schema appended to the preamble.
   * @param {{ system: string, prompt: string, schema: object, signal?: AbortSignal }} request
   * @returns {Promise<{ text: string, truncated: boolean }>}
   */
  async completeJson(request) {
    const response = await this.client.chat(
      {
        model: this.modelId,
        preamble: `${request.system}${buildSchemaAppendix(request.schema)}`,
        message: request.prompt,
        responseFormat: { type: "json_object" },
      },
      { abortSignal: request.signal }
    );

    return { text: response.text || "", truncated: response.finishReason === "MAX_TOKENS" };
  }
}

module.exports = { CohereProvider };
