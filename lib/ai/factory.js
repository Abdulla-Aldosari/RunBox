/*-------------------------------------------------
 * RunBox — VS Code Extension
 * Copyright (c) 2026 Abdulla Aldosari
 * Licensed under the MIT License.
 * See LICENSE in the project root for details.
 *-------------------------------------------------*/

const { GeminiProvider } = require("./providers/gemini");
const { OpenAIProvider } = require("./providers/openai");
const { AnthropicProvider } = require("./providers/anthropic");
const { DeepSeekProvider } = require("./providers/deepseek");
const { GroqProvider } = require("./providers/groq");
const { MistralProvider } = require("./providers/mistral");
const { CohereProvider } = require("./providers/cohere");
const { StepFunProvider } = require("./providers/stepfun");
const { buildExplainInstruction, INVALID_COMMAND_CODE } = require("./systemInstruction");
const { generateFullCategory, generateSingleCommand } = require("./generation");
const { logAiInteraction, logProviderModels } = require("../logger");
const { getProviderConfig } = require("./providers-config");
const { detectShellType } = require("../terminal");

/** @typedef {'gemini'|'openai'|'anthropic'|'deepseek'|'groq'|'mistral'|'cohere'|'stepfun'} ProviderName */

/**
 * Creates an AI provider instance based on the provider name and optional model ID.
 * @param {ProviderName} providerName
 * @param {string} apiKey
 * @param {string} [modelId]
 * @returns {GeminiProvider|OpenAIProvider|AnthropicProvider|DeepSeekProvider|GroqProvider|MistralProvider|CohereProvider|StepFunProvider}
 */
function createProvider(providerName, apiKey, modelId) {
  switch (providerName) {
    case "gemini":
      return new GeminiProvider(apiKey, modelId);
    case "openai":
      return new OpenAIProvider(apiKey, modelId);
    case "anthropic":
      return new AnthropicProvider(apiKey, modelId);
    case "deepseek":
      return new DeepSeekProvider(apiKey, modelId);
    case "groq":
      return new GroqProvider(apiKey, modelId);
    case "mistral":
      return new MistralProvider(apiKey, modelId);
    case "cohere":
      return new CohereProvider(apiKey, modelId);
    case "stepfun":
      return new StepFunProvider(apiKey, modelId);
    default:
      throw new Error(`Unknown AI provider: "${providerName}"`);
  }
}

/**
 * Builds the per-attempt debug logger for one generation request.
 * Each attempt (including the single retry) is written to the RunBox output channel.
 * @param {ProviderName} providerName
 * @param {string} modelId
 * @param {string} userPrompt
 * @returns {(entry: { stage: string, attempt: number, systemInstruction: string, prompt: string, schema: object, text?: string, error?: Error }) => void}
 */
function createGenerationLogger(providerName, modelId, userPrompt) {
  return function (entry) {
    logAiInteraction({
      provider: providerName,
      modelId,
      mode: `${entry.stage} (attempt ${entry.attempt})`,
      prompt: entry.prompt || userPrompt,
      systemInstruction: entry.systemInstruction,
      schema: entry.schema,
      ...(entry.text !== undefined ? { result: entry.text } : {}),
      ...(entry.error ? { error: entry.error } : {}),
    });
  };
}

/**
 * Main entry point for command generation.
 *
 * - `full`:   new category with groups and commands (outline + per-group details).
 * - `single`: one command for an existing group; categoryId/groupId are applied
 *             locally and never sent to the model.
 *
 * @param {{
 *   providerName: ProviderName,
 *   modelId?: string,
 *   apiKey: string,
 *   prompt: string,
 *   mode: 'full'|'single',
 *   language: string,
 *   categoryId?: string,
 *   groupId?: string,
 *   shellName?: string,
 *   shellPath?: string,
 *   signal?: AbortSignal,
 *   onProgress?: (progress: { stage: 'outline'|'groups'|'details' }) => void,
 * }} options
 * @returns {Promise<{ mode: 'full', category: object, commands: object[], warnings: string[] } | { mode: 'single', command: object }>}
 */
async function generateWithAI(options) {
  const { providerName, modelId, apiKey, prompt, mode, language, categoryId, groupId, shellName, shellPath, signal, onProgress } = options;

  const provider = createProvider(providerName, apiKey, modelId);
  // Tags each generated command with the shell it was written for (used at run
  // time to auto-select a matching terminal profile).
  const targetShell = detectShellType(shellPath);
  const log = createGenerationLogger(providerName, provider.modelId, prompt);

  if (mode === "single") {
    const command = await generateSingleCommand({ provider, prompt, language, categoryId, groupId, shellName, targetShell, signal, log });
    return { mode, command };
  }

  const result = await generateFullCategory({ provider, prompt, language, shellName, targetShell, signal, onProgress, log });
  return { mode: "full", ...result };
}

/**
 * Lists available models for a given provider using the provider's API.
 *
 * Calls the provider to retrieve its raw model list, then applies centralized
 * filtering rules: exclude models by configured keywords, remove exact
 * exclusions, deduplicate IDs, and drop dated/versioned variants when a
 * cleaner alias exists. The final list is logged and returned in a format
 * suitable for UI selection (`{modelId, modelLabel}`).
 *
 * @param {ProviderName} providerName
 * @param {string} apiKey
 * @returns {Promise<{modelId: string, modelLabel: string}[]>}
 */
async function listModelsForProvider(providerName, apiKey) {
  const provider = createProvider(providerName, apiKey);
  const raw = await provider.listModels();
  const cfg = getProviderConfig(providerName);
  const excludeKeywords = (cfg && cfg.modelIdExcludeKeywords) || [];
  const excludeExact = new Set((cfg && cfg.modelIdExcludeExact) || []);

  // Step 0: remove models whose ID contains any excluded keyword.
  // All keyword rules live in providers-config.js (modelIdExcludeKeywords) and are
  // applied here centrally, so provider files only need to return the raw API response.
  let models =
    excludeKeywords.length > 0
      ? raw.filter(function (m) {
          const id = m.modelId.toLowerCase();
          return !excludeKeywords.some(function (kw) {
            return id.includes(kw);
          });
        })
      : raw.slice();

  // Step 1: remove exact duplicate IDs
  const seen = new Set();
  models = models.filter(function (m) {
    if (seen.has(m.modelId)) return false;
    seen.add(m.modelId);
    return true;
  });

  // Step 2: remove specific model IDs listed in modelIdExcludeExact.
  // Used for aliases that share the same name pattern (e.g. "mistral-medium-3.5"
  // vs "mistral-medium-3-5") and cannot be caught by keyword or date-suffix rules.
  if (excludeExact.size > 0) {
    models = models.filter(function (m) {
      return !excludeExact.has(m.modelId);
    });
  }

  // Step 3: remove versioned/dated models when a clean alias already exists.
  // Keeps "gpt-4o"            and removes "gpt-4o-2024-11-20".
  // Keeps "open-mistral-nemo" and removes "open-mistral-nemo-2407".
  // Keeps "codestral-latest"  and removes "codestral-2508".
  // Pattern: strip a trailing -YYYY-MM-DD or -YYMM/-YYYYMM suffix to get a base name,
  // then check if either the base itself OR base + "-latest" exists in the list.
  // The "-latest" check handles providers like Mistral that use "-latest" aliases
  // instead of bare names (e.g. "codestral-latest" covers "codestral-2508").
  const modelIds = new Set(
    models.map(function (m) {
      return m.modelId;
    })
  );
  models = models.filter(function (m) {
    const base = m.modelId
      .replace(/-\d{4}-\d{2}-\d{2}$/, "") // strip -YYYY-MM-DD    (e.g. gpt-4o-2024-11-20)
      .replace(/-\d{4}$/, "") // strip -YYMM/-YYYYMM  (e.g. mistral-medium-2505)
      .replace(/-\d{1,3}$/, ""); // strip -001/-1/-12     (e.g. gemini-2.0-flash-001)
    if (base !== m.modelId && (modelIds.has(base) || modelIds.has(base + "-latest"))) return false;
    return true;
  });

  logProviderModels({ provider: providerName, models });

  return models;
}

/**
 * Explains a CLI command using the configured AI provider.
 * Returns a raw Markdown string written in `language`. When the model replies
 * with INVALID_COMMAND_CODE, a fixed English error is thrown instead.
 *
 * @param {{
 *   providerName: ProviderName,
 *   modelId?: string,
 *   apiKey: string,
 *   command: string,
 *   language: string,
 *   signal?: AbortSignal,
 * }} options
 * @returns {Promise<string>} Markdown-formatted explanation
 */
async function explainWithAI(options) {
  const { providerName, modelId, apiKey, command, language, signal } = options;
  const provider = createProvider(providerName, apiKey, modelId);
  const systemInstruction = buildExplainInstruction(language);
  let markdown;
  try {
    markdown = await provider.explainCommand(command, systemInstruction, signal);
  } catch (err) {
    logAiInteraction({
      provider: providerName,
      modelId: provider.modelId,
      mode: "explain",
      prompt: command,
      systemInstruction,
      error: err,
    });
    throw err;
  }

  if (typeof markdown === "string" && markdown.trim() === INVALID_COMMAND_CODE) {
    const err = new Error("The provided input does not appear to be a valid CLI command.");
    logAiInteraction({
      provider: providerName,
      modelId: provider.modelId,
      mode: "explain",
      prompt: command,
      systemInstruction,
      result: markdown,
      error: err,
    });
    throw err;
  }

  logAiInteraction({
    provider: providerName,
    modelId: provider.modelId,
    mode: "explain",
    prompt: command,
    systemInstruction,
    result: markdown,
  });
  return markdown;
}

/**
 * Verifies API key validity and connectivity for a given provider by performing
 * a lightweight request and measuring the round-trip time.
 *
 * @param {ProviderName} providerName
 * @param {string} apiKey
 * @param {string} [modelId]
 * @returns {Promise<{ providerName: string, serviceName: string, modelId: string, responseTimeMs: number }>}
 */
async function checkProviderConnection(providerName, apiKey, modelId) {
  const cfg = getProviderConfig(providerName);
  const provider = createProvider(providerName, apiKey, modelId);

  const start = Date.now();
  await provider.checkConnection();
  const responseTimeMs = Date.now() - start;

  return {
    providerName,
    serviceName: (cfg && cfg.serviceName) || providerName,
    modelId: provider.modelId,
    responseTimeMs,
  };
}

/**
 * Retrieves rate limit information for a given provider, if supported.
 *
 * Providers without a way to check rate limits proactively (per `hasApiRateLimits`
 * in providers-config.js) return `{ supported: false }` immediately without any
 * network request — the caller should direct the user to `rateLimitsUrl` instead.
 *
 * @param {ProviderName} providerName
 * @param {string} apiKey
 * @param {string} [modelId]
 * @returns {Promise<{ supported: false, providerName: string, serviceName: string, rateLimitsUrl: string } | { supported: true, providerName: string, serviceName: string, modelId: string, limits: object }>}
 */
async function checkProviderRateLimits(providerName, apiKey, modelId) {
  const cfg = getProviderConfig(providerName);

  if (!cfg || !cfg.hasApiRateLimits) {
    return {
      supported: false,
      providerName,
      serviceName: (cfg && cfg.serviceName) || providerName,
      rateLimitsUrl: (cfg && cfg.rateLimitsUrl) || "",
    };
  }

  const provider = createProvider(providerName, apiKey, modelId);
  const limits = await provider.checkRateLimits();

  return {
    supported: true,
    providerName,
    serviceName: cfg.serviceName,
    modelId: provider.modelId,
    limits,
  };
}

module.exports = {
  generateWithAI,
  explainWithAI,
  listModelsForProvider,
  checkProviderConnection,
  checkProviderRateLimits,
};
