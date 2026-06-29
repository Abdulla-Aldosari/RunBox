/*-------------------------------------------------
 * Terminal Recipes — VS Code Extension
 * Copyright (c) 2026 Abdulla Aldosari
 * Licensed under the Apache License, Version 2.0.
 * See LICENSE in the project root for details.
 *-------------------------------------------------*/

const { CohereClient } = require("cohere-ai");
const { SCHEMA_FULL, SCHEMA_SINGLE } = require("../schemas");
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
   * Returns the raw markdown explanation of a CLI command.
   * @param {string} command
   * @param {string} systemInstruction
   * @returns {Promise<string>}
   */
  async explainCommand(command, systemInstruction) {
    const response = await this.client.chat({
      model: this.modelId,
      preamble: systemInstruction,
      message: command,
    });
    return response.text;
  }

  async generateCommands(prompt, mode, systemInstruction) {
    const schema = mode === "full" ? SCHEMA_FULL : SCHEMA_SINGLE;

    const preamble = `${systemInstruction}

You MUST respond with a valid JSON object that matches this JSON Schema exactly:
${JSON.stringify(schema, null, 2)}

Do NOT include any text, explanation, or markdown before or after the JSON.`;

    const response = await this.client.chat({
      model: this.modelId,
      preamble,
      message: prompt,
      responseFormat: { type: "json_object" },
    });

    const content = response.text;

    const jsonMatch = content.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      throw new Error("Cohere response did not contain valid JSON.");
    }

    return { data: JSON.parse(jsonMatch[0]), schema };
  }
}

module.exports = { CohereProvider };
