/*-------------------------------------------------
 * Terminal Recipes — VS Code Extension
 * Copyright (c) 2026 Abdulla Aldosari
 * Licensed under the Apache License, Version 2.0.
 * See LICENSE in the project root for details.
 *-------------------------------------------------*/

const OpenAI = require("openai");
const { SCHEMA_FULL, SCHEMA_SINGLE } = require("../schemas");
const { getProviderConfig } = require("../providers-config");

/**
 * AI provider implementation for StepFun.
 * Uses the StepFun OpenAI-compatible endpoint.
 */
class StepFunProvider {
  constructor(apiKey, modelId) {
    this.client = new OpenAI({
      apiKey,
      baseURL: "https://api.stepfun.ai/v1",
    });
    const cfg = getProviderConfig("stepfun");
    this.modelId = modelId || cfg.defaultModelId || cfg.models[0].modelId;
  }

  /**
   * Returns the raw model list from the StepFun API.
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

  async generateCommands(prompt, mode, systemInstruction) {
    const schema = mode === "full" ? SCHEMA_FULL : SCHEMA_SINGLE;

    const enhancedSystem = `${systemInstruction}

You MUST respond with a valid JSON object that matches this JSON Schema exactly:
${JSON.stringify(schema, null, 2)}

Do NOT include any text, explanation, or markdown before or after the JSON.`;

    const response = await this.client.chat.completions.create({
      model: this.modelId,
      messages: [
        { role: "system", content: enhancedSystem },
        { role: "user", content: prompt },
      ],
      response_format: { type: "json_object" },
    });

    const content = response.choices[0].message.content;

    const jsonMatch = content.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      throw new Error("StepFun response did not contain valid JSON.");
    }

    return { data: JSON.parse(jsonMatch[0]), schema };
  }
}

module.exports = { StepFunProvider };
