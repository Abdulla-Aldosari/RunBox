/*-------------------------------------------------
 * Terminal Recipes — VS Code Extension
 * Copyright (c) 2026 Abdulla Aldosari
 * Licensed under the Apache License, Version 2.0.
 * See LICENSE in the project root for details.
 *-------------------------------------------------*/

/**
 * AI Providers Configuration — Single Source of Truth
 *
 * This file defines all metadata for supported AI providers.
 * When adding a new provider:
 *   1. Add an entry here.
 *   2. Create its class file in ai/providers/<name>.js
 *   3. Add a case in ai/factory.js → createProvider()
 *   4. Update package.json → terminalRecipes.aiProvider enum (for VS Code Settings UI only)
 *
 * @typedef {{
 *   modelId: string,
 *   modelLabel: string,
 *   free: boolean,
 * }} ModelConfig
 *
 * @typedef {{
 *   name: string,
 *   serviceName: string,
 *   providerName: string,
 *   defaultModelId: string,
 *   displayLabel: string,
 *   models: ModelConfig[],
 *   apiKeyUrl: string,
 *   apiKeyUrlLabel: string,
 *   steps: string[],
 *   hasApiRateLimits: boolean,
 *   rateLimitsUrl: string,
 * }} ProviderConfig
 */

/** @type {Record<string, ProviderConfig>} */
const AI_PROVIDERS = {
  gemini: {
    name: "gemini",
    serviceName: "Google Gemini",
    providerName: "Google",
    defaultModelId: "gemini-3.5-flash",
    displayLabel: "Google Gemini",
    modelIdExcludeKeywords: [
      "tts",
      "image",
      "lyria",
      "robotics",
      "embedding",
      "aqa",
      "computer-use",
      "live",
      "translate",
      "research",
      "veo",
      "antigravity",
      "nano-banana",
    ],
    models: [
      { modelId: "gemini-3.5-flash", modelLabel: "Gemini 3.5 Flash", free: true },
      { modelId: "gemini-3.1-flash-lite", modelLabel: "Gemini 3.1 Flash-Lite", free: true },
      { modelId: "gemini-2.5-flash", modelLabel: "Gemini 2.5 Flash", free: true },
      { modelId: "gemini-2.5-flash-lite", modelLabel: "Gemini 2.5 Flash-Lite", free: true },
      { modelId: "gemini-2.5-pro", modelLabel: "Gemini 2.5 Pro", free: false },
    ],
    apiKeyUrl: "https://aistudio.google.com/api-keys",
    apiKeyUrlLabel: "Google AI Studio",
    steps: [
      "Go to Google AI Studio: <code>https://aistudio.google.com/</code>",
      "Sign in with your Google account.",
      "Click <code>Get API key</code> in the left sidebar.",
      "Click <code>Create API key</code>.",
      "Name your key and choose an imported project (or create a new one).",
      "Copy the generated API key.",
      "Paste it in the API Key field and click Save.",
    ],
    hasApiRateLimits: false,
    rateLimitsUrl: "https://aistudio.google.com/usage",
  },

  openai: {
    name: "openai",
    serviceName: "OpenAI ChatGPT",
    providerName: "OpenAI",
    defaultModelId: "gpt-4.1-mini",
    displayLabel: "OpenAI ChatGPT",
    modelIdExcludeKeywords: [
      "whisper",
      "tts",
      "dall-e",
      "image",
      "embedding",
      "moderation",
      "transcribe",
      "audio",
      "realtime",
      "sora",
      "instruct",
      "search",
      "codex",
      "davinci",
      "babbage",
    ],
    modelIdExcludeExact: [
      "chat-latest", // generic alias with no version info — not useful for model selection
    ],
    models: [
      { modelId: "gpt-4.1-nano", modelLabel: "GPT-4.1 Nano", free: false },
      { modelId: "gpt-4.1-mini", modelLabel: "GPT-4.1 Mini", free: false },
      { modelId: "gpt-4.1", modelLabel: "GPT-4.1", free: false },
      { modelId: "gpt-4o-mini", modelLabel: "GPT-4o Mini", free: false },
      { modelId: "gpt-4o", modelLabel: "GPT-4o", free: false },
    ],
    apiKeyUrl: "https://platform.openai.com/api-keys",
    apiKeyUrlLabel: "OpenAI Platform",
    steps: [
      "Go to OpenAI Platform: <code>https://platform.openai.com/</code>",
      "Sign in or create an OpenAI account.",
      "Navigate to <code>API keys</code> in the left sidebar (or go to platform.openai.com/api-keys).",
      "Click <code>Create new secret key</code> and give it a name.",
      "Copy the key <code>immediately</code> — it will only be shown once.",
      "Paste it in the API Key field and click Save.",
    ],
    hasApiRateLimits: true,
    rateLimitsUrl: "https://platform.openai.com/settings/organization/limits",
  },

  anthropic: {
    name: "anthropic",
    serviceName: "Anthropic Claude",
    providerName: "Anthropic",
    defaultModelId: "claude-haiku-4-5-20251001",
    displayLabel: "Anthropic Claude",
    modelIdExcludeKeywords: [],
    models: [
      { modelId: "claude-haiku-4-5-20251001", modelLabel: "Claude Haiku 4.5", free: false },
      { modelId: "claude-sonnet-4-5-20250929", modelLabel: "Claude Sonnet 4.5", free: false },
      { modelId: "claude-sonnet-4-6", modelLabel: "Claude Sonnet 4.6", free: false },
      { modelId: "claude-opus-4-5-20251101", modelLabel: "Claude Opus 4.5", free: false },
    ],
    apiKeyUrl: "https://platform.claude.com/settings/workspaces/default/keys",
    apiKeyUrlLabel: "Claude Console",
    steps: [
      "Go to Claude Console: <code>https://platform.claude.com</code>",
      "Sign in or create an Claude account.",
      'Click <code>API Keys</code> in the left sidebar under the "Manage" category.',
      "Click <code>Create Key</code> and give it a descriptive name.",
      "Copy the generated API key.",
      "Paste it in the API Key field and click Save.",
    ],
    hasApiRateLimits: true,
    rateLimitsUrl: "https://platform.claude.com/settings/limits",
  },

  deepseek: {
    name: "deepseek",
    serviceName: "DeepSeek",
    providerName: "DeepSeek",
    defaultModelId: "deepseek-v4-flash",
    displayLabel: "DeepSeek",
    modelIdExcludeKeywords: [],
    models: [
      { modelId: "deepseek-v4-flash", modelLabel: "DeepSeek V4 Flash", free: true },
      { modelId: "deepseek-v4-pro", modelLabel: "DeepSeek V4 Pro", free: false },
    ],
    apiKeyUrl: "https://platform.deepseek.com/api_keys",
    apiKeyUrlLabel: "DeepSeek Platform",
    steps: [
      "Go to DeepSeek Platform: <code>https://platform.deepseek.com/</code>",
      "Sign in or create a DeepSeek account.",
      "Navigate to <code>API Keys</code> in the left sidebar.",
      "Click <code>Create new API key</code> and give it a name.",
      "Copy the key — it will only be shown once.",
      "Paste it in the API Key field and click Save.",
    ],
    hasApiRateLimits: false,
    rateLimitsUrl: "https://platform.deepseek.com/usage",
  },

  groq: {
    name: "groq",
    serviceName: "Groq",
    providerName: "Groq",
    defaultModelId: "llama-3.3-70b-versatile",
    displayLabel: "Groq",
    modelIdExcludeKeywords: ["whisper", "orpheus", "prompt-guard", "safeguard"],
    models: [
      { modelId: "llama-3.3-70b-versatile", modelLabel: "Llama 3.3 70B Versatile", free: true },
      { modelId: "llama-3.1-8b-instant", modelLabel: "Llama 3.1 8B Instant", free: true },
      { modelId: "meta-llama/llama-4-scout-17b-16e-instruct", modelLabel: "Llama 4 Scout 17B", free: true },
      { modelId: "qwen/qwen3-32b", modelLabel: "Qwen3 32B", free: true },
    ],
    apiKeyUrl: "https://console.groq.com/keys",
    apiKeyUrlLabel: "Groq Console",
    steps: [
      "Go to Groq Console: <code>https://console.groq.com/</code>",
      "Sign in or create a Groq account (free).",
      "Navigate to <code>API Keys</code> in the left sidebar.",
      "Click <code>Create API Key</code> and give it a name.",
      "Copy the generated API key.",
      "Paste it in the API Key field and click Save.",
    ],
    hasApiRateLimits: true,
    rateLimitsUrl: "https://console.groq.com/settings/limits",
  },

  mistral: {
    name: "mistral",
    serviceName: "Mistral AI",
    providerName: "Mistral",
    defaultModelId: "mistral-small-latest",
    displayLabel: "Mistral AI",
    modelIdExcludeKeywords: ["voxtral", "embed", "moderation", "ocr", "fim"],
    modelIdExcludeExact: [
      "mistral-medium-3.5", // dot-variant alias of mistral-medium-3-5
      "mistral-medium-3", // older version, superseded by mistral-medium-3-5
      "mistral-code-latest", // alias of codestral-latest
      "mistral-medium", // bare alias, less explicit than mistral-medium-latest
    ],
    models: [
      { modelId: "mistral-small-latest", modelLabel: "Mistral Small (Latest)", free: true },
      { modelId: "mistral-vibe-cli-fast", modelLabel: "Mistral Vibe CLI Fast", free: true },
      { modelId: "codestral-latest", modelLabel: "Codestral (Latest)", free: true },
      { modelId: "mistral-medium-latest", modelLabel: "Mistral Medium (Latest)", free: false },
      { modelId: "mistral-large-latest", modelLabel: "Mistral Large (Latest)", free: false },
    ],
    apiKeyUrl: "https://console.mistral.ai/api-keys/",
    apiKeyUrlLabel: "Mistral Console",
    steps: [
      "Go to Mistral Console: <code>https://console.mistral.ai/</code>",
      "Sign in or create a Mistral account.",
      "Navigate to <code>API Keys</code> in the left sidebar.",
      "Click <code>Create new key</code> and give it a name.",
      "Select <code>Default Workspace</code>.",
      "Select <code>Connector access scope</code> shared — anyone in the same Workspace.",
      "Click <code>Create new key</code> and copy the generated API key.",
      "Paste it in the API Key field and click Save.",
    ],
    hasApiRateLimits: true,
    rateLimitsUrl: "https://console.mistral.ai/usage",
  },

  cohere: {
    name: "cohere",
    serviceName: "Cohere",
    providerName: "Cohere",
    defaultModelId: "command-r7b-12-2024",
    displayLabel: "Cohere",
    modelIdExcludeKeywords: ["embed", "rerank", "transcribe", "vision", "translate"],
    models: [
      { modelId: "command-r7b-12-2024", modelLabel: "Command R7B (Dec 2024)", free: true },
      { modelId: "command-r-08-2024", modelLabel: "Command R (Aug 2024)", free: false },
      { modelId: "command-r-plus-08-2024", modelLabel: "Command R+ (Aug 2024)", free: false },
      { modelId: "command-a-03-2025", modelLabel: "Command A (Mar 2025)", free: false },
    ],
    apiKeyUrl: "https://dashboard.cohere.com/api-keys",
    apiKeyUrlLabel: "Cohere Dashboard",
    steps: [
      "Go to Cohere Dashboard: <code>https://dashboard.cohere.com/</code>",
      "Sign in or create a Cohere account (free trial available).",
      "Navigate to <code>API Keys</code> in the left sidebar.",
      "Click <code>New Trial Key</code> or <code>New Production Key</code>.",
      "Copy the generated API key.",
      "Paste it in the API Key field and click Save.",
    ],
    hasApiRateLimits: false,
    rateLimitsUrl: "https://dashboard.cohere.com/billing",
  },

  stepfun: {
    name: "stepfun",
    serviceName: "StepFun",
    providerName: "StepFun",
    defaultModelId: "step-3.5-flash",
    displayLabel: "StepFun",
    modelIdExcludeKeywords: ["tts", "audio", "asr", "image"],
    models: [
      { modelId: "step-3.5-flash", modelLabel: "Step 3.5 Flash", free: true },
      { modelId: "step-3.7-flash", modelLabel: "Step 3.7 Flash", free: false },
    ],
    apiKeyUrl: "https://platform.stepfun.ai/interface-key",
    apiKeyUrlLabel: "StepFun Platform",
    steps: [
      "Go to StepFun Platform: <code>https://platform.stepfun.ai/account-info</code>",
      "Sign in or create a StepFun account.",
      "Navigate to <code>API Keys</code> in the left sidebar.",
      "Click <code>Create API Key</code> and give the key a name.",
      "Copy the generated API key.",
      "Paste it in the API Key field and click Save.",
    ],
    hasApiRateLimits: false,
    rateLimitsUrl: "https://platform.stepfun.ai/account-info",
  },
};

/**
 * Returns an ordered array of provider configs for use in UI dropdowns.
 * @returns {ProviderConfig[]}
 */
function getProvidersArray() {
  return Object.values(AI_PROVIDERS);
}

/**
 * Returns the config for a specific provider, or null if not found.
 * @param {string} providerName
 * @returns {ProviderConfig|null}
 */
function getProviderConfig(providerName) {
  return AI_PROVIDERS[providerName] || null;
}

/**
 * Returns the model config for a specific provider + modelId, or null if not found.
 * Falls back to the default model if modelId is not provided or not found.
 * @param {string} providerName
 * @param {string} [modelId]
 * @returns {ModelConfig|null}
 */
function getModelConfig(providerName, modelId) {
  const provider = AI_PROVIDERS[providerName];
  if (!provider) return null;
  if (modelId) {
    const found = provider.models.find(function (m) {
      return m.modelId === modelId;
    });
    if (found) return found;
  }
  return (
    provider.models.find(function (m) {
      return m.modelId === provider.defaultModelId;
    }) ||
    provider.models[0] ||
    null
  );
}

module.exports = { AI_PROVIDERS, getProvidersArray, getProviderConfig, getModelConfig };
