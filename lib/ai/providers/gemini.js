/*-------------------------------------------------
 * RunBox — VS Code Extension
 * Copyright (c) 2026 Abdulla Aldosari
 * Licensed under the MIT License.
 * See LICENSE in the project root for details.
 *-------------------------------------------------*/

const { GoogleGenerativeAI } = require("@google/generative-ai");
const { getProviderConfig } = require("../providers-config");

/**
 * AI provider implementation for Google Gemini.
 * Uses native structured output (responseSchema). Parsing, truncation handling,
 * and validation happen in lib/ai/structured-output.js.
 */
class GeminiProvider {
  constructor(apiKey, modelId) {
    this.apiKey = apiKey;
    this.client = new GoogleGenerativeAI(apiKey);
    const cfg = getProviderConfig("gemini");
    this.modelId = modelId || cfg.defaultModelId || cfg.models[0].modelId;
  }

  /**
   * Returns the raw list of Gemini models that support generateContent.
   * Filtering (keywords, exact IDs, deduplication) is handled centrally in factory.js.
   * @returns {Promise<{modelId: string, modelLabel: string}[]>}
   */
  async listModels() {
    const apiKey = this.apiKey;
    const allModels = [];
    let nextPageToken = null;

    while (true) {
      // The actual maximum value for `pageSize` in The Gemini REST API (the link) has an actual maximum of 100
      // If the number of models exceeds 100, `nextPageToken` will be used to retrieve the remaining pages sequentially.
      let url = "https://generativelanguage.googleapis.com/v1beta/models?pageSize=100&key=" + apiKey;
      if (nextPageToken) {
        url += "&pageToken=" + encodeURIComponent(nextPageToken);
      }
      const response = await fetch(url);
      const result = await response.json();
      if (result.error) {
        throw new Error(result.error.message || "Gemini API error");
      }

      // Only include models that support text generation
      const models = (result.models || [])
        .filter(function (m) {
          return Array.isArray(m.supportedGenerationMethods) && m.supportedGenerationMethods.includes("generateContent");
        })
        .map(function (m) {
          return {
            modelId: m.name.replace("models/", ""),
            modelLabel: m.displayName || m.name.replace("models/", ""),
          };
        });

      allModels.push.apply(allModels, models);
      nextPageToken = result.nextPageToken || null;

      if (!nextPageToken) {
        break;
      }
    }

    return allModels;
  }

  /**
   * Performs a single lightweight request to verify API key validity and connectivity.
   * Fetches only the first page of models (no pagination loop) — minimal cost.
   * Throws on failure.
   * @returns {Promise<void>}
   */
  async checkConnection() {
    const apiKey = this.apiKey;
    const url = "https://generativelanguage.googleapis.com/v1beta/models?pageSize=1&key=" + apiKey;
    const response = await fetch(url);
    const result = await response.json();
    if (result.error) {
      throw new Error(result.error.message || "Gemini API error");
    }
  }

  /**
   * Returns the raw markdown explanation of a CLI command.
   * @param {string} command
   * @param {string} systemInstruction`r`n   * @param {AbortSignal} [signal]
   * @returns {Promise<string>}
   */
  async explainCommand(command, systemInstruction, signal) {
    const model = this.client.getGenerativeModel({
      model: this.modelId,
      systemInstruction,
    });

    const result = await model.generateContent(command, { signal });
    return result.response.text();
  }

  /**
   * Sends one JSON request using Gemini's native responseSchema.
   * @param {{ system: string, prompt: string, schema: object, signal?: AbortSignal }} request
   * @returns {Promise<{ text: string, truncated: boolean }>}
   */
  async completeJson(request) {
    const model = this.client.getGenerativeModel({
      model: this.modelId,
      systemInstruction: request.system,
      generationConfig: {
        responseMimeType: "application/json",
        responseSchema: request.schema,
      },
    });

    const result = await model.generateContent(request.prompt, { signal: request.signal });
    const candidate = result.response.candidates && result.response.candidates[0];
    return { text: result.response.text(), truncated: Boolean(candidate && candidate.finishReason === "MAX_TOKENS") };
  }
}

module.exports = { GeminiProvider };
