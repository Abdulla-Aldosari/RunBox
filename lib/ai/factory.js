/*-------------------------------------------------
 * Terminal Recipes — VS Code Extension
 * Copyright (c) 2026 Abdulla Aldosari
 * Licensed under the Apache License, Version 2.0.
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
const { DEFAULT_SYSTEM_INSTRUCTION, EXPLAIN_SYSTEM_INSTRUCTION } = require("./systemInstruction");
const { logAiInteraction, logProviderModels } = require("../logger");
const { getProviderConfig } = require("./providers-config");
const { detectShellType } = require("../terminal");
const crypto = require("crypto");

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
 * Generates a safe local ID (lowercase letters, numbers, hyphens).
 * @returns {string}
 */
function generateLocalId() {
  return crypto.randomBytes(6).toString("hex");
}

/**
 * Remaps all AI-generated IDs to safe local IDs, maintaining internal references.
 * This ensures no ID conflicts with existing data.
 *
 * @param {object} aiResult - Raw AI response for `full` mode
 * @param {string|null} [targetShell] - Detected shell type to tag each command with
 * @returns {object} - Normalized result with remapped IDs
 */
function remapFullModeIds(aiResult, targetShell) {
  const idMap = {};

  // --- Remap category ID ---
  const newCategoryId = generateLocalId();
  idMap[aiResult.category.id] = newCategoryId;

  // --- Remap group IDs ---
  const remappedGroups = (aiResult.category.groups || []).map(function (group) {
    const newGroupId = generateLocalId();
    idMap[group.id] = newGroupId;
    return { id: newGroupId, title: group.title };
  });

  const remappedCategory = {
    id: newCategoryId,
    title: aiResult.category.title,
    groups: remappedGroups,
  };

  // --- Remap command IDs and references ---
  const remappedCommands = (aiResult.commands || []).map(function (cmd) {
    const newCmdId = generateLocalId();
    const mappedCategoryId = idMap[cmd.categoryId] || newCategoryId;
    const rawGroupId = cmd.groupId || "";
    const mappedGroupId = idMap[rawGroupId] || rawGroupId || "";

    return {
      id: newCmdId,
      title: cmd.title,
      description: cmd.description,
      command: cmd.command,
      categoryId: mappedCategoryId,
      groupId: mappedGroupId,
      ...(cmd.helpUrl ? { helpUrl: cmd.helpUrl } : {}),
      ...(cmd.variableMeta && Object.keys(cmd.variableMeta).length > 0 ? { variableMeta: cmd.variableMeta } : {}),
      ...(targetShell ? { targetShell } : {}),
    };
  });

  return {
    category: remappedCategory,
    commands: remappedCommands,
  };
}

/**
 * Normalizes a `single` mode AI result by replacing the AI-generated ID
 * and injecting the known categoryId and groupIds.
 *
 * @param {object} aiResult - Raw AI response for `single` mode
 * @param {string} categoryId
 * @param {string} groupId
 * @param {string|null} [targetShell] - Detected shell type to tag the command with
 * @returns {object}
 */
function remapSingleModeResult(aiResult, categoryId, groupId, targetShell) {
  return {
    id: generateLocalId(),
    title: aiResult.title,
    description: aiResult.description,
    command: aiResult.command,
    categoryId,
    groupId: groupId || "",
    ...(aiResult.helpUrl ? { helpUrl: aiResult.helpUrl } : {}),
    ...(aiResult.variableMeta && Object.keys(aiResult.variableMeta).length > 0
      ? { variableMeta: aiResult.variableMeta }
      : {}),
    ...(targetShell ? { targetShell } : {}),
  };
}

/**
 * Builds a shell-environment section to append to the system instruction.
 * Tells the AI which shell's syntax to use when generating commands.
 * @param {string} shellName - Display name of the terminal profile (e.g. "PowerShell", "Git Bash")
 * @returns {string}
 */
function buildShellContext(shellName) {
  return `

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
SHELL ENVIRONMENT
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
The user's target shell is: ${shellName}

You MUST generate commands that are valid and executable in this specific shell.
Do NOT mix shell syntaxes. Use only the native built-in commands for the target shell.

Shell syntax reference:
- PowerShell → use Get-ChildItem, Remove-Item, Copy-Item, Write-Host, etc.
- Command Prompt (CMD) → use dir, del, copy, echo, etc.
- Git Bash / Bash / Zsh / WSL → use find, rm, ls, grep, cp, mv, etc.
- Any other Unix-like shell → use standard POSIX/Linux commands.`;
}

/**
 * Main entry point: runs AI generation with proper provider, schema, and ID remapping.
 *
 * @param {{
 *   providerName: ProviderName,
 *   modelId?: string,
 *   apiKey: string,
 *   prompt: string,
 *   mode: 'full'|'single',
 *   customSystemInstruction?: string,
 *   categoryId?: string,
 *   groupId?: string,
 *   shellName?: string,
 *   shellPath?: string,
 * }} options
 * @returns {Promise<object>}
 */
async function generateWithAI(options) {
  const {
    providerName,
    modelId,
    apiKey,
    prompt,
    mode,
    customSystemInstruction,
    categoryId,
    groupId,
    shellName,
    shellPath,
  } = options;

  let systemInstruction = customSystemInstruction || DEFAULT_SYSTEM_INSTRUCTION;

  // Append shell context so the AI generates shell-appropriate commands
  if (shellName) {
    systemInstruction += buildShellContext(shellName);
  }

  // Classify the selected terminal's shell path so generated commands can be
  // tagged with the shell they were written for (used later to auto-select
  // a matching terminal profile at run time).
  const targetShell = detectShellType(shellPath);

  const provider = createProvider(providerName, apiKey, modelId);

  let finalResult;
  let schema;
  try {
    const { data: aiResult, schema: providerSchema } = await provider.generateCommands(prompt, mode, systemInstruction);
    schema = providerSchema;
    finalResult =
      mode === "full"
        ? remapFullModeIds(aiResult, targetShell)
        : remapSingleModeResult(aiResult, categoryId, groupId, targetShell);
  } catch (err) {
    logAiInteraction({ provider: providerName, modelId, mode, prompt, systemInstruction, error: err });
    throw err;
  }

  logAiInteraction({ provider: providerName, modelId, mode, prompt, systemInstruction, schema, result: finalResult });
  return finalResult;
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
 * Returns a raw Markdown string — no JSON schema, no ID remapping.
 *
 * @param {{
 *   providerName: ProviderName,
 *   modelId?: string,
 *   apiKey: string,
 *   command: string,
 * }} options
 * @returns {Promise<string>} Markdown-formatted explanation
 */
async function explainWithAI(options) {
  const { providerName, modelId, apiKey, command } = options;
  const provider = createProvider(providerName, apiKey, modelId);
  try {
    const markdown = await provider.explainCommand(command, EXPLAIN_SYSTEM_INSTRUCTION);
    return markdown;
  } catch (err) {
    logAiInteraction({
      provider: providerName,
      modelId,
      mode: "explain",
      prompt: command,
      systemInstruction: EXPLAIN_SYSTEM_INSTRUCTION,
      error: err,
    });
    throw err;
  }
}

module.exports = { generateWithAI, explainWithAI, listModelsForProvider };
