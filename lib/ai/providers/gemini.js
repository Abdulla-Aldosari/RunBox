/*-------------------------------------------------
 * Terminal Recipes — VS Code Extension
 * Copyright (c) 2026 Abdulla Aldosari
 * Licensed under the Apache License, Version 2.0.
 * See LICENSE in the project root for details.
 *-------------------------------------------------*/

const { GoogleGenerativeAI } = require("@google/generative-ai");
const { SCHEMA_FULL_GEMINI, SCHEMA_SINGLE_GEMINI } = require("../schemas");
const { getProviderConfig } = require("../providers-config");

/**
 * Appended to the system instruction so Gemini knows to use `variableMetaList`
 * (array format) instead of `variableMeta` (dynamic object keys), because
 * Gemini's responseSchema does not support dynamic/additionalProperties keys.
 *
 * The result is transformed back to the standard `variableMeta` object format
 * by `transformGeminiResponse` before being returned to the caller.
 */
const GEMINI_VARIABLE_META_ADDENDUM = `

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
GEMINI FORMAT NOTE — variableMetaList
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
In this response format, instead of a "variableMeta" object with dynamic keys,
you MUST use a "variableMetaList" array. Each item in the array represents one
TYPE B (Enum) variable and must include a "variableName" field with the exact
variable name as it appears in the command string (without the \${} syntax).

Example for the command "npm install --loglevel=\${LogLevel}":
{
  "variableMetaList": [
    {
      "variableName": "LogLevel",
      "type": "enum",
      "enumValues": [
        { "title": "Silent",  "value": "silent",  "description": "Suppresses all output." },
        { "title": "Error",   "value": "error",   "description": "Shows only errors." },
        { "title": "Warn",    "value": "warn",    "description": "Shows warnings and errors." },
        { "title": "Notice",  "value": "notice",  "description": "Default npm log level." },
        { "title": "HTTP",    "value": "http",    "description": "Shows HTTP requests." },
        { "title": "Info",    "value": "info",    "description": "Detailed lifecycle info." },
        { "title": "Verbose", "value": "verbose", "description": "Large amounts of debug data." },
        { "title": "Silly",   "value": "silly",   "description": "Shows absolutely everything." }
      ]
    }
  ]
}

If the command has NO TYPE B (Enum) variables, set "variableMetaList" to [].

⚠️  CRITICAL RULE — COMPLETE ENUM VALUES:
You MUST include EVERY documented valid value in "enumValues".
Do NOT filter or omit values based on the user's request context.
The user needs the FULL list to choose from — not a curated subset.`;

/**
 * Converts Gemini's `variableMetaList` array back to the standard `variableMeta` object.
 * Also works recursively for `full` mode (array of commands).
 *
 * @param {object} raw - Parsed Gemini response
 * @param {'full'|'single'} mode
 * @returns {object} - Normalized result with standard variableMeta
 */
function transformGeminiResponse(raw, mode) {
  function convertList(obj) {
    const list = Array.isArray(obj.variableMetaList) ? obj.variableMetaList : [];
    const variableMeta = {};
    for (const entry of list) {
      if (entry && typeof entry.variableName === "string" && entry.variableName) {
        variableMeta[entry.variableName] = {
          type: entry.type || "enum",
          enumValues: Array.isArray(entry.enumValues) ? entry.enumValues : [],
        };
      }
    }
    const result = { ...obj };
    delete result.variableMetaList;
    result.variableMeta = variableMeta;
    return result;
  }

  if (mode === "full") {
    return {
      category: raw.category,
      commands: (raw.commands || []).map(convertList),
    };
  }

  return convertList(raw);
}

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
    const https = require("https");
    const apiKey = this.apiKey;
    const allModels = [];
    let nextPageToken = null;

    while (true) {
      const result = await new Promise(function (resolve, reject) {
        // The actual maximum value for `pageSize` in The Gemini REST API (the link) has an actual maximum of 100
        // If the number of models exceeds 100, `nextPageToken` will be used to retrieve the remaining pages sequentially.
        let url = "https://generativelanguage.googleapis.com/v1beta/models?pageSize=100&key=" + apiKey;
        if (nextPageToken) {
          url += "&pageToken=" + encodeURIComponent(nextPageToken);
        }
        https
          .get(url, function (res) {
            let data = "";
            res.on("data", function (chunk) {
              data += chunk;
            });
            res.on("end", function () {
              try {
                const parsed = JSON.parse(data);
                if (parsed.error) {
                  reject(new Error(parsed.error.message || "Gemini API error"));
                  return;
                }
                resolve(parsed);
              } catch (e) {
                reject(e);
              }
            });
          })
          .on("error", reject);
      });

      // Only include models that support text generation
      const models = (result.models || [])
        .filter(function (m) {
          return (
            Array.isArray(m.supportedGenerationMethods) && m.supportedGenerationMethods.includes("generateContent")
          );
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
   * Returns the raw markdown explanation of a CLI command.
   * @param {string} command
   * @param {string} systemInstruction
   * @returns {Promise<string>}
   */
  async explainCommand(command, systemInstruction) {
    const model = this.client.getGenerativeModel({
      model: this.modelId,
      systemInstruction,
    });
    const result = await model.generateContent(command);
    return result.response.text();
  }

  async generateCommands(prompt, mode, systemInstruction) {
    const schema = mode === "full" ? SCHEMA_FULL_GEMINI : SCHEMA_SINGLE_GEMINI;
    const enhancedInstruction = systemInstruction + GEMINI_VARIABLE_META_ADDENDUM;

    const model = this.client.getGenerativeModel({
      model: this.modelId,
      systemInstruction: enhancedInstruction,
      generationConfig: {
        responseMimeType: "application/json",
        responseSchema: schema,
      },
    });

    const result = await model.generateContent(prompt);
    const text = result.response.text();
    const parsed = JSON.parse(text);
    return { data: transformGeminiResponse(parsed, mode), schema };
  }
}

module.exports = { GeminiProvider };
