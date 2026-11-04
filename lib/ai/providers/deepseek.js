/*-------------------------------------------------
 * RunBox — VS Code Extension
 * Copyright (c) 2026 Abdulla Aldosari
 * Licensed under the MIT License.
 * See LICENSE in the project root for details.
 *-------------------------------------------------*/

const OpenAI = require("openai");
const { buildSchemaAppendix } = require("../structured-output");
const { getProviderConfig } = require("../providers-config");

/**
 * AI provider implementation for DeepSeek.
 * DeepSeek exposes an OpenAI-compatible API, so we reuse the OpenAI SDK
 * with a custom baseURL. JSON output is requested via `response_format: json_object`.
 */
class DeepSeekProvider {
  constructor(apiKey, modelId) {
    this.client = new OpenAI({
      apiKey,
      baseURL: "https://api.deepseek.com/v1",
    });
    const cfg = getProviderConfig("deepseek");
    this.modelId = modelId || cfg.defaultModelId || cfg.models[0].modelId;
  }

  /**
   * Returns the raw model list from the DeepSeek API.
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
   * @param {string} systemInstruction`r`n   * @param {AbortSignal} [signal]
   * @returns {Promise<string>}
   */
  async explainCommand(command, systemInstruction, signal) {
    const response = await this.client.chat.completions.create(
      {
        model: this.modelId,
        messages: [
          { role: "system", content: systemInstruction },
          { role: "user", content: command },
        ],
      },
      { signal }
    );
    return response.choices[0].message.content;
  }

  /**
   * Sends one JSON request in json_object mode with the schema appended to the system instruction.
   * @param {{ system: string, prompt: string, schema: object, signal?: AbortSignal }} request
   * @returns {Promise<{ text: string, truncated: boolean }>}
   */
  async completeJson(request) {
    const response = await this.client.chat.completions.create(
      {
        model: this.modelId,
        messages: [
          { role: "system", content: `${request.system}${buildSchemaAppendix(request.schema)}` },
          { role: "user", content: request.prompt },
        ],
        response_format: { type: "json_object" },
      },
      { signal: request.signal }
    );

    const choice = response.choices[0];
    return { text: choice.message.content || "", truncated: choice.finish_reason === "length" };
  }
}

module.exports = { DeepSeekProvider };
