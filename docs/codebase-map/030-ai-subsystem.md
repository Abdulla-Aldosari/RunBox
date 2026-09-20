# AI Subsystem — `lib/ai/`

| File | Purpose |
| - | - |
| `lib/ai/providers-config.js` | **SINGLE SOURCE OF TRUTH** — metadata for all AI providers (name, displayLabel, URL, setup steps, per-provider `models[]` array with `modelId`, `modelLabel`, `free`, `modelIdExcludeKeywords` — substring keywords used to filter out non-chat models (e.g. `"embed"`, `"tts"`), and `modelIdExcludeExact` — specific model IDs to exclude that cannot be caught by keywords (e.g. dot-vs-hyphen aliases). Also defines `hasApiRateLimits: boolean` and `rateLimitsUrl: string` per provider — `hasApiRateLimits` indicates whether the provider exposes rate limit info via response headers; `rateLimitsUrl` is the provider's own account/usage page shown to the user when it does not. Edit this first when adding a new provider. |
| `lib/ai/factory.js` | `generateWithAI(options)` — main entry point for command generation; accepts `shellName?` to inject shell context. `explainWithAI(options)` — entry point for CLI command explanation; calls `provider.explainCommand()` and returns a raw Markdown string (no JSON schema, no ID remapping). `createProvider(name, key, modelId)` — instantiates the correct provider class. `listModelsForProvider(providerName, apiKey)` — calls the provider's `listModels()` then applies a 4-step pipeline: keyword filter, exact-ID exclusion, deduplication, and dated-alias removal. Edit to register new providers. |
| `lib/ai/schemas.js` | JSON schema for the expected AI response structure |
| `lib/ai/systemInstruction.js` | Exports two system prompts: `DEFAULT_SYSTEM_INSTRUCTION` (command generator) and `EXPLAIN_SYSTEM_INSTRUCTION` (CLI command explainer — instructs the AI to return structured Markdown with sections: Core Purpose, Command Breakdown, Practical Examples, Notes & Warnings; enforces a strict allowed-elements list) |
| `lib/ai/debugLogger.js` | Debug logging utility for AI requests/responses |
| `lib/ai/providers/gemini.js` | Google Gemini implementation |
| `lib/ai/providers/openai.js` | OpenAI ChatGPT implementation |
| `lib/ai/providers/anthropic.js` | Anthropic Claude implementation |
| `lib/ai/providers/deepseek.js` | DeepSeek implementation (OpenAI-compatible, `api.deepseek.com/v1`) |
| `lib/ai/providers/groq.js` | Groq implementation (`groq-sdk`) |
| `lib/ai/providers/mistral.js` | Mistral AI implementation (`@mistralai/mistralai`) |
| `lib/ai/providers/cohere.js` | Cohere implementation (`cohere-ai`) |
| `lib/ai/providers/stepfun.js` | StepFun implementation (OpenAI-compatible, `api.stepfun.ai/v1`) |
