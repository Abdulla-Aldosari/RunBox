/*-------------------------------------------------
 * Terminal Recipes — VS Code Extension
 * Copyright (c) 2026 Abdulla Aldosari
 * Licensed under the Apache License, Version 2.0.
 * See LICENSE in the project root for details.
 *-------------------------------------------------*/

// media/modals/ai-settings.js
// AI Settings modal, AI Provider Setup Help modal, and settings bind events.
// Loads after new-command.js.

// ─── AI Models Cache Helpers ──────────────────────────────────────────────────
// Stores model lists per-provider in localStorage with a 7-day TTL.
// Falls back to providers-config.js static list when cache is absent or expired.

const AI_MODELS_CACHE_KEY = "tr_ai_models_cache";
const AI_MODELS_CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

/**
 * Returns cached models for a provider if the cache entry exists and is fresh.
 * @param {string} providerName
 * @returns {{ modelId: string, modelLabel: string }[]|null}
 */
function getCachedModels(providerName) {
  try {
    const raw = localStorage.getItem(AI_MODELS_CACHE_KEY);
    if (!raw) {
      return null;
    }
    const cache = JSON.parse(raw);
    const entry = cache[providerName];
    if (!entry || !entry.fetchedAt || !Array.isArray(entry.models) || !entry.models.length) {
      return null;
    }
    if (Date.now() - entry.fetchedAt > AI_MODELS_CACHE_TTL_MS) {
      return null; // expired
    }
    return entry.models;
  } catch {
    return null;
  }
}

/**
 * Saves fetched models into the cache with the current timestamp.
 * @param {string} providerName
 * @param {{ modelId: string, modelLabel: string }[]} models
 */
function setModelsCache(providerName, models) {
  try {
    const raw = localStorage.getItem(AI_MODELS_CACHE_KEY);
    const cache = raw ? JSON.parse(raw) : {};
    cache[providerName] = { models, fetchedAt: Date.now() };
    localStorage.setItem(AI_MODELS_CACHE_KEY, JSON.stringify(cache));
  } catch {}
}

/**
 * Removes the cached model list for a provider (e.g. when a new API key is saved).
 * @param {string} providerName
 */
function clearModelsCache(providerName) {
  try {
    const raw = localStorage.getItem(AI_MODELS_CACHE_KEY);
    if (!raw) {
      return;
    }
    const cache = JSON.parse(raw);
    delete cache[providerName];
    localStorage.setItem(AI_MODELS_CACHE_KEY, JSON.stringify(cache));
  } catch {}
}

/**
 * Returns the timestamp (ms) when the provider's model list was last cached, or null.
 * @param {string} providerName
 * @returns {number|null}
 */
function getModelsCacheFetchedAt(providerName) {
  try {
    const raw = localStorage.getItem(AI_MODELS_CACHE_KEY);
    if (!raw) {
      return null;
    }
    const cache = JSON.parse(raw);
    return cache[providerName] ? cache[providerName].fetchedAt : null;
  } catch {
    return null;
  }
}

/**
 * Formats a past timestamp as a human-readable "time ago" string.
 * @param {number} timestamp - ms since epoch
 * @returns {string}
 */
function formatTimeAgo(timestamp) {
  const diffMs = Date.now() - timestamp;
  const diffMins = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMs / 3600000);
  const diffDays = Math.floor(diffMs / 86400000);
  if (diffMins < 1) {
    return "just now";
  }
  if (diffMins < 60) {
    return `${diffMins}m ago`;
  }
  if (diffHours < 24) {
    return `${diffHours}h ago`;
  }
  return `${diffDays}d ago`;
}

// ─────────────────────────────────────────────────────────────────────────────

// Snapshot of provider/model at modal open time — used to detect actual changes when Save is clicked.
let _originalSettingsProvider = "";
let _originalSettingsModelId = "";

/**
 * Returns a display label for the active AI provider + model.
 * Used in the AI prompt modal footer link.
 * @param {string} providerName
 * @returns {string}
 */
function getAiModelLabel(providerName) {
  if (aiState.aiProviderSetup && aiState.aiProviderSetup[providerName]) {
    const cfg = aiState.aiProviderSetup[providerName];
    const modelId = aiState.settingsModelId || cfg.defaultModelId;
    const modelCfg = (cfg.models || []).find(function (m) {
      return m.modelId === modelId;
    });
    const modelLabel = modelCfg ? modelCfg.modelLabel : modelId;
    return `${cfg.serviceName} · ${modelLabel}`;
  }
  // Fallback labels (used before aiProviderSetup is loaded)
  const fallback = {
    gemini: "Gemini · Gemini 2.0 Flash",
    openai: "OpenAI · GPT-4.1 Mini",
    anthropic: "Anthropic · Claude Haiku 4.5",
    deepseek: "DeepSeek · DeepSeek V3 Chat",
    groq: "Groq · Llama 3.3 70B",
    mistral: "Mistral · Mistral Small",
    cohere: "Cohere · Command R7B",
    stepfun: "StepFun · Step 3.5 Flash",
  };
  return fallback[providerName] || providerName;
}

/**
 * Builds the model dropdown options for the given provider.
 * Free models get a "(Free)" suffix in the label.
 * @param {string} providerName
 * @returns {{ value: string, label: string }[]}
 */
function buildModelOptions(providerName) {
  if (!aiState.aiProviderSetup || !aiState.aiProviderSetup[providerName]) {
    return [];
  }
  const models = (aiState.aiProviderSetup[providerName].models || []).slice().sort(function (a, b) {
    return a.modelId.localeCompare(b.modelId);
  });
  return models.map(function (m) {
    return {
      value: m.modelId,
      label: m.free ? m.modelLabel + " (Free)" : m.modelLabel,
    };
  });
}

/**
 * Returns the resolved model ID for the given provider.
 * Falls back to the provider's defaultModelId if settingsModelId is not set
 * or does not belong to the selected provider's model list.
 * @param {string} providerName
 * @returns {string}
 */
function resolveSettingsModelId(providerName) {
  if (!aiState.aiProviderSetup || !aiState.aiProviderSetup[providerName]) {
    return aiState.settingsModelId || "";
  }
  const cfg = aiState.aiProviderSetup[providerName];
  const models = cfg.models || [];
  const savedId = aiState.settingsModelId;
  if (
    savedId &&
    models.some(function (m) {
      return m.modelId === savedId;
    })
  ) {
    return savedId;
  }
  // Verify defaultModelId exists in the current models list (may differ when using cached/dynamic models)
  const defaultId = cfg.defaultModelId;
  if (
    defaultId &&
    models.some(function (m) {
      return m.modelId === defaultId;
    })
  ) {
    return defaultId;
  }
  return models.length > 0 ? models[0].modelId : "";
}

function renderAiSettingsModal() {
  // Build provider dropdown options dynamically from aiProviderSetup if available
  const providers = aiState.aiProviderSetup
    ? Object.values(aiState.aiProviderSetup).map(function (cfg) {
        const hasKey = !!aiState.keyStatus[cfg.name];
        return {
          value: cfg.name,
          label: cfg.displayLabel,
          badge: `<span class="cs-key-badge ${hasKey ? "key-active" : "key-inactive"}">${icons.key}</span>`,
          badgePosition: "end",
        };
      })
    : [
        { value: "gemini", label: "Google Gemini" },
        { value: "openai", label: "OpenAI ChatGPT" },
        { value: "anthropic", label: "Anthropic Claude" },
        { value: "deepseek", label: "DeepSeek" },
        { value: "groq", label: "Groq" },
        { value: "mistral", label: "Mistral AI" },
        { value: "cohere", label: "Cohere" },
        { value: "stepfun", label: "StepFun" },
      ];

  const selectedProvider = aiState.settingsProviderName;
  const hasKey = aiState.keyStatus[selectedProvider];

  // Model dropdown — shows loading spinner while dynamic models are being fetched
  const modelOptions = buildModelOptions(selectedProvider);
  const selectedModelId = resolveSettingsModelId(selectedProvider);
  const fetchedAt = getModelsCacheFetchedAt(selectedProvider);

  // Build the refresh button tooltip
  const refreshTooltip = hasKey
    ? `Fetch latest models from each provider's API (all providers with a saved key).${fetchedAt ? `<br>( Updated ${formatTimeAgo(fetchedAt)} )` : ""}`
    : `No API key saved for this provider — add one to enable fetching models.`;

  // Chevron SVG — used in the loading state button
  const chevronSvg = `<svg width="17" height="17" viewBox="0 0 21 21" class="cs-chevron" aria-hidden="true"><path fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="1" d="m6 9l6 6l6-6"></path></svg>`;

  // Model section — uses renderCustomSelect() when ready; shows a disabled loading button while fetching
  const modelDropdownHtml = `
      <div class="d-grid gap-6 mt-10">
        <span>Model</span>
        ${
          aiState.modelsLoading
            ? `<button class="cs-btn cs-btn-ai-provider" type="button" disabled>
                 <span class="cs-btn-label"><span class="ai-models-loading-spinner"></span> Loading models...</span>
                 ${chevronSvg}
               </button>`
            : modelOptions.length > 0
              ? renderCustomSelect(
                  "ai-model-select-wrap",
                  "ai-model-select-btn",
                  "ai-model-select-menu",
                  modelOptions,
                  selectedModelId,
                  "cs-btn-ai-provider",
                  false,
                  "cs-wrap-full"
                )
              : ""
        }
      </div>`;

  // Resolve provider setup info for links (if available)
  const providerSetup = aiState.aiProviderSetup && aiState.aiProviderSetup[selectedProvider];
  const apiKeyUrl = providerSetup ? providerSetup.apiKeyUrl : null;
  const apiKeyUrlLabel = providerSetup ? providerSetup.apiKeyUrlLabel : null;

  const providerLinksHtml = apiKeyUrl
    ? `
    <div class="ai-provider-links">    
      Don't have an API key?    
      <div class="ai-provider-help-item">
        ${icons.key}
        <a class="ai-provider-link" id="btn-ai-get-api-key" data-url="${escapeAttr(apiKeyUrl)}" href="#" data-tooltip="Open ${escapeAttr(apiKeyUrlLabel || apiKeyUrl)} in browser">
          Get API Key (${escapeHtml(apiKeyUrlLabel || apiKeyUrl)})
        </a>
      </div>
      <div class="ai-provider-help-item">
        ${icons.aiSetupHelp}
        <a class="ai-provider-link ai-provider-link-help" id="btn-ai-show-setup-help" href="#" data-tooltip="Show step-by-step instructions">
          How to get (${escapeHtml(apiKeyUrlLabel || apiKeyUrl)}) API Key?
        </a>
      </div>
    </div>
  `
    : "";

  return `
    <div class="modal-overlay" id="ai-settings-overlay" data-dismiss-on-outside-click="false">
      <div class="modal-box">
        <h3>${icons.aiSettings} AI Settings</h3>
        <div class="d-grid gap-6">
          <span>AI Provider</span>
          ${renderCustomSelect(
            "ai-provider-select-wrap",
            "ai-provider-select-btn",
            "ai-provider-select-menu",
            providers,
            selectedProvider,
            "cs-btn-ai-provider", // btnExtraClass
            false, // menuUp
            "cs-wrap-full"
          )}
        </div>
        ${modelDropdownHtml}
        <div class="ai-provider-api-key-wrapper d-grid gap-6">
          <div class="d-flex gap-6">
            API Key for <strong>${escapeHtml(selectedProvider)}</strong>
            ${
              hasKey
                ? `
            <div class="ai-provider-key-status-item ai-key-ok">
              ${icons.checkboxOk}
              <span class="ai-key-status ai-key-ok">Key saved</span>
            </div>`
                : `
            <div class="ai-provider-key-status-item ai-key-missing">
              ${icons.exclamationTriangle}
              <span class="ai-key-status ai-key-missing">No key saved</span>
            </div>`
            }
          </div>       
          <div class="d-flex gap-6">
             <input id="ai-api-key-input" class="input" type="password" placeholder="${hasKey ? "Enter new key to update..." : "Enter your API key..."}" value="${escapeAttr(aiState.apiKeyInput)}" autocomplete="off" />
             <button class="btn small secondary action" id="btn-ai-settings-save-api-key"${aiState.apiKeyInput.length < 10 ? " disabled" : ""}>${hasKey ? "Update Key" : "Save Key"}</button>
             ${hasKey ? `<button class="btn small danger" id="btn-ai-delete-api-key" data-tooltip="Remove saved API key for ${escapeAttr(selectedProvider)}">Remove Key</button>` : ""}
           </div>
          <div class="ai-SecretStorage-note">
            Using VS Code's native <code>SecretStorage</code>, your API key is securely encrypted and stored within your operating system's native credential manager (e.g., Windows Credential Manager, macOS Keychain, or Linux Secret Service). It is never saved as plain text in your local settings or workspace files.
          </div>
        </div>
        ${providerLinksHtml}
        <div class="row between mt-20">
          <button class="btn small secondary ai-models-refresh-btn" id="btn-ai-refresh-models" type="button"${!hasKey ? " disabled" : ""} data-tooltip="${escapeAttr(refreshTooltip)}">↻ Refresh models</button>
          <div class="row">
            <button class="btn small primary min-w65" id="btn-ai-settings-save">Save</button>
            <button class="btn small secondary action min-w65" id="btn-ai-settings-cancel">Close</button>
          </div>
        </div>
      </div>
    </div>
  `;
}

// ─── AI Settings Bind Function ────────────────────────────────────────────────

function bindAiSettingsEvents() {
  // --- Settings modal events ---
  if (aiState.view === "settings") {
    // Bind AI provider custom select
    bindCustomSelect(
      "ai-provider-select-wrap",
      "ai-provider-select-btn",
      "ai-provider-select-menu",
      function (newProvider) {
        aiState.settingsProviderName = newProvider;
        aiState.settingsModelId = ""; // reset so resolveSettingsModelId picks the new provider's default
        aiState.apiKeyInput = "";
        // Use cache if fresh; otherwise fetch from API
        if (aiState.keyStatus[newProvider]) {
          const cached = getCachedModels(newProvider);
          if (cached && aiState.aiProviderSetup && aiState.aiProviderSetup[newProvider]) {
            aiState.aiProviderSetup[newProvider].models = cached;
            aiState.modelsLoading = false;
          } else {
            aiState.modelsLoading = true;
            vscode.postMessage({ type: "aiListModels", payload: { providerName: newProvider } });
          }
        } else {
          aiState.modelsLoading = false;
        }
        render();
      }
    );

    // Bind model custom select (if rendered)
    bindCustomSelect("ai-model-select-wrap", "ai-model-select-btn", "ai-model-select-menu", function (newModelId) {
      aiState.settingsModelId = newModelId;
    });

    const apiKeyInput = document.getElementById("ai-api-key-input");
    const saveApiKeyBtn = document.getElementById("btn-ai-settings-save-api-key");
    if (apiKeyInput && saveApiKeyBtn) {
      apiKeyInput.addEventListener("input", function () {
        aiState.apiKeyInput = apiKeyInput.value;
        saveApiKeyBtn.disabled = apiKeyInput.value.length < 10;
      });
    }

    // 🔑 "Get API Key" link — opens provider's website in browser
    const getApiKeyLink = document.getElementById("btn-ai-get-api-key");
    if (getApiKeyLink) {
      getApiKeyLink.addEventListener("click", function (e) {
        e.preventDefault();
        const url = getApiKeyLink.dataset.url;
        if (url) {
          vscode.postMessage({ type: "openExternalUrl", payload: { url } });
        }
      });
    }

    // ❓ "How to get API Key?" link — opens the setup help modal
    const showHelpLink = document.getElementById("btn-ai-show-setup-help");
    if (showHelpLink) {
      showHelpLink.addEventListener("click", function (e) {
        e.preventDefault();
        aiProviderSetupModalState = {
          visible: true,
          providerName: aiState.settingsProviderName,
        };
        render();
      });
    }

    // 🔑 "Update KEY / Save Key" button — saves the API key only, keeps the modal open and refreshes models
    if (saveApiKeyBtn) {
      saveApiKeyBtn.addEventListener("click", function () {
        if (!aiState.apiKeyInput) {
          return;
        }
        const resolvedModelId = resolveSettingsModelId(aiState.settingsProviderName);
        clearModelsCache(aiState.settingsProviderName);
        vscode.postMessage({
          type: "aiSaveSettings",
          payload: {
            providerName: aiState.settingsProviderName,
            modelId: resolvedModelId,
            apiKey: aiState.apiKeyInput,
          },
        });
        aiState.apiKeyInput = "";
        // view stays as "settings" — modal remains open
      });
    }

    const saveBtn = document.getElementById("btn-ai-settings-save");
    if (saveBtn) {
      saveBtn.addEventListener("click", function () {
        const resolvedModelId = resolveSettingsModelId(aiState.settingsProviderName);
        // Detect whether anything actually changed
        const providerChanged = aiState.settingsProviderName !== _originalSettingsProvider;
        const modelChanged = resolvedModelId !== _originalSettingsModelId;
        const keyChanged = aiState.apiKeyInput && aiState.apiKeyInput.length > 0;

        if (providerChanged || modelChanged || keyChanged) {
          // Clear model cache if a new API key was entered
          if (aiState.apiKeyInput) {
            clearModelsCache(aiState.settingsProviderName);
          }
          vscode.postMessage({
            type: "aiSaveSettings",
            payload: {
              providerName: aiState.settingsProviderName,
              modelId: resolvedModelId,
              apiKey: aiState.apiKeyInput,
            },
          });
          // Update active providerName + modelId immediately so prompt modal reflects the new selection
          aiState.providerName = aiState.settingsProviderName;
          aiState.settingsModelId = resolvedModelId;
          aiState.view = aiState.returnToPrompt ? "prompt" : null;
          aiState.returnToPrompt = false;
          aiState.apiKeyInput = "";
          // render() will be called by the aiSettingsResult roundtrip that follows aiSaveSettings
        } else {
          // Nothing changed — close the modal immediately with a direct render()
          aiState.view = aiState.returnToPrompt ? "prompt" : null;
          aiState.returnToPrompt = false;
          aiState.apiKeyInput = "";
          render();
        }
      });
    }

    // ↻ "Refresh" button — refreshes all providers that have an API key
    const refreshModelsBtn = document.getElementById("btn-ai-refresh-models");
    if (refreshModelsBtn) {
      refreshModelsBtn.addEventListener("click", function () {
        if (!aiState.keyStatus[aiState.settingsProviderName]) {
          return;
        }
        aiState.modelsLoading = true;
        vscode.postMessage({ type: "aiRefreshAllModels" });
        render();
      });
    }

    // 🗑️ "Remove Key" button — deletes the API key for the selected provider
    const deleteApiKeyBtn = document.getElementById("btn-ai-delete-api-key");
    if (deleteApiKeyBtn) {
      deleteApiKeyBtn.addEventListener("click", function () {
        clearModelsCache(aiState.settingsProviderName);
        vscode.postMessage({ type: "aiDeleteKey", payload: { providerName: aiState.settingsProviderName } });
      });
    }

    const cancelBtn = document.getElementById("btn-ai-settings-cancel");
    if (cancelBtn) {
      cancelBtn.addEventListener("click", function () {
        aiState.view = aiState.returnToPrompt ? "prompt" : null;
        aiState.returnToPrompt = false;
        aiState.apiKeyInput = "";
        render();
      });
    }
  }

  // --- AI Provider Setup Help modal events ---
  if (aiProviderSetupModalState.visible) {
    // 🌐 Open URL link inside setup modal
    const setupOpenUrlLink = document.getElementById("btn-ai-setup-open-url");
    if (setupOpenUrlLink) {
      setupOpenUrlLink.addEventListener("click", function (e) {
        e.preventDefault();
        const url = setupOpenUrlLink.dataset.url;
        if (url) {
          vscode.postMessage({ type: "openExternalUrl", payload: { url } });
        }
      });
    }

    // Close button inside setup modal
    const setupCloseBtn = document.getElementById("btn-ai-setup-close");
    if (setupCloseBtn) {
      setupCloseBtn.addEventListener("click", function () {
        aiProviderSetupModalState = { visible: false, providerName: null };
        render();
      });
    }
  }
}

// ─────────────────────────────────────────────────────────────────────────────

function renderAiProviderSetupModal() {
  const providerName = aiProviderSetupModalState.providerName;
  const setup = aiState.aiProviderSetup && providerName ? aiState.aiProviderSetup[providerName] : null;

  if (!setup) {
    return "";
  }

  const stepsHtml = setup.steps
    .map(function (step, idx) {
      return `<li class="ai-setup-step"><span class="ai-setup-step-num">${idx + 1}</span><span>${step}</span></li>`;
    })
    .join("");

  return `
    <div class="modal-overlay" id="ai-provider-setup-overlay" data-dismiss-on-outside-click="true">
      <div class="modal-box ai-setup-box">
        <h3>${icons.key} How to get API Key for <strong>${escapeHtml(setup.serviceName)}</strong></h3>
        <ol class="ai-setup-steps">
          ${stepsHtml}
        </ol>
        <div class="ai-setup-footer">
          <a class="ai-provider-link" id="btn-ai-setup-open-url" data-url="${escapeAttr(setup.apiKeyUrl)}" href="#" data-tooltip="Open ${escapeAttr(setup.apiKeyUrlLabel)} in browser">
            ${icons.externalLink}  Open ${escapeHtml(setup.apiKeyUrlLabel)}
          </a>
        </div>
        <div class="row justify-content-flex-end">
          <button class="btn small secondary action min-w65" id="btn-ai-setup-close">Close</button>
        </div>
      </div>
    </div>
  `;
}
