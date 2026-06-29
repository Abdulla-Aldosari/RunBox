/*-------------------------------------------------
 * Terminal Recipes — VS Code Extension
 * Copyright (c) 2026 Abdulla Aldosari
 * Licensed under the Apache License, Version 2.0.
 * See LICENSE in the project root for details.
 *-------------------------------------------------*/

// media/messages.js
// Handles all messages received from the extension host via window.addEventListener("message", ...).
// Each handler updates uiState/state then calls render().
// Loads after render.js.

/**
 * Central message dispatcher for all messages received from the VS Code extension.
 * Handles: state, saveResult, actionResult, saveVariablesResult, aiSettingsResult,
 * aiSaveSettingsResult, aiGenerateResult, aiInsertResult,
 * saveAutoVariablesSettingsResult, saveFavoritesResult.
 */
window.addEventListener("message", function (event) {
  const message = event.data;

  if (!message || typeof message.type !== "string") {
    return;
  }

  if (message.type === "state") {
    hydrateState(message.payload);
    ensureSelectionDefaults();
    render();
    return;
  }

  if (message.type === "saveResult") {
    const pendingMessage = uiState.pendingSaveMessage;
    uiState.pendingSaveMessage = null;

    if (message.payload && message.payload.success) {
      showNotice(pendingMessage || "Saved successfully.", icons.circleCheck, "success");
    } else {
      showNotice(
        `Save failed: ${message.payload && message.payload.message ? message.payload.message : "Unknown error"}`,
        icons.circleX,
        "error"
      );
      // Rollback optimistic render — reload authoritative state from disk
      vscode.postMessage({ type: "requestState" });
    }
    // Page is already rendered by persistDataThenRender() — just append the notice to document.body (outside #app, survives render)
    paintNotice();
    return;
  }

  if (message.type === "actionResult") {
    if (message.payload && message.payload.success) {
      showNotice(`Action "${message.payload.action}" completed.`, icons.circleCheck, "info");

      if (message.payload.commandVariables && typeof message.payload.commandVariables === "object") {
        state.commandVariables = message.payload.commandVariables;
      }

      if (message.payload.globalCommandVariables && typeof message.payload.globalCommandVariables === "object") {
        state.globalCommandVariables = message.payload.globalCommandVariables;
      }
    } else {
      showNotice(
        `Action failed: ${message.payload && message.payload.message ? message.payload.message : "Unknown error"}`,
        icons.circleX,
        "error"
      );
    }

    render();
    return;
  }

  if (message.type === "saveVariablesResult") {
    if (message.payload && message.payload.success) {
      if (message.payload.commandVariables) {
        state.commandVariables = message.payload.commandVariables;
      }

      if (message.payload.globalCommandVariables) {
        state.globalCommandVariables = message.payload.globalCommandVariables;
      }
    }
    // No render() here to avoid focus loss while editing
  }

  if (message.type === "aiSettingsResult") {
    if (message.payload) {
      const providerName = message.payload.providerName || "gemini";
      aiState.providerName = providerName;
      aiState.settingsProviderName = providerName;
      aiState.keyStatus = message.payload.keyStatus || {};
      // Store provider setup data from providers-config.js (sent by extension)
      if (message.payload.aiProviderSetup && typeof message.payload.aiProviderSetup === "object") {
        aiState.aiProviderSetup = message.payload.aiProviderSetup;
      }
      // Restore saved model selection — fall back to provider's default
      if (typeof message.payload.modelId === "string") {
        aiState.settingsModelId = message.payload.modelId;
      }
      // Capture originals for change detection when Save is clicked
      _originalSettingsProvider = aiState.settingsProviderName;
      _originalSettingsModelId = resolveSettingsModelId(aiState.settingsProviderName);
      // Apply cached model list if fresh; otherwise fetch from API
      if (aiState.keyStatus[providerName]) {
        const cached = getCachedModels(providerName);
        if (cached && aiState.aiProviderSetup && aiState.aiProviderSetup[providerName]) {
          aiState.aiProviderSetup[providerName].models = cached;
          aiState.modelsLoading = false;
        } else {
          aiState.modelsLoading = true;
          vscode.postMessage({ type: "aiListModels", payload: { providerName } });
        }
      } else {
        aiState.modelsLoading = false;
      }
    }
    render();
    return;
  }

  if (message.type === "aiSaveSettingsResult") {
    if (message.payload && message.payload.success) {
      // Re-fetch settings to refresh keyStatus
      vscode.postMessage({ type: "aiGetSettings" });
      showNotice("AI settings saved.", icons.circleCheck, "success");
    } else {
      showNotice(
        `Failed to save settings: ${message.payload && message.payload.message ? message.payload.message : "Unknown error"}`,
        icons.circleX,
        "error"
      );
      render();
    }
    return;
  }

  if (message.type === "aiDeleteKeyResult") {
    if (message.payload && message.payload.success) {
      clearModelsCache(aiState.settingsProviderName);
      vscode.postMessage({ type: "aiGetSettings" });
      showNotice("API key removed.", icons.circleCheck, "success");
    } else {
      showNotice(
        `Failed to remove key: ${message.payload && message.payload.error ? message.payload.error : "Unknown error"}`,
        icons.circleX,
        "error"
      );
    }
    return;
  }

  if (message.type === "aiGenerateResult") {
    if (message.payload && message.payload.success) {
      aiState.result = message.payload.result;
      aiState.mode = message.payload.mode;
      // Initialize all commands as checked
      const cmds = message.payload.mode === "full" ? message.payload.result.commands || [] : [message.payload.result];
      const checked = {};
      cmds.forEach(function (cmd) {
        checked[cmd.id] = true;
      });
      aiState.checkedIds = checked;
      aiState.filterGroupId = "all";
      aiState.error = "";
      aiState.view = "results";
    } else {
      aiState.error = message.payload && message.payload.message ? message.payload.message : "Unknown error";
      aiState.view = "prompt";
    }
    render();
    return;
  }

  if (message.type === "aiInsertResult") {
    if (message.payload && message.payload.success) {
      aiState.view = null;
      aiState.result = null;
      aiState.prompt = "";
      aiState.error = "";
      showNotice(`Inserted ${message.payload.count} command(s) successfully.`, icons.circleCheck, "success");
    } else {
      aiState.error = message.payload && message.payload.message ? message.payload.message : "Unknown error";
      aiState.view = "results";
    }
    render();
    return;
  }

  if (message.type === "saveAutoVariablesSettingsResult") {
    if (message.payload && message.payload.success) {
      showNotice("Auto variables settings saved.", icons.circleCheck, "success");
    } else {
      showNotice(
        "Failed to save: " + (message.payload && message.payload.message ? message.payload.message : "Unknown error"),
        icons.circleX,
        "error"
      );
    }
    // Page is already rendered — just append the notice to document.body (outside #app, survives any future render)
    paintNotice();
    return;
  }

  if (message.type === "aiListModelsResult") {
    const resultProvider = message.payload && message.payload.providerName;
    // Persist to cache and apply to aiState on success
    if (
      message.payload &&
      message.payload.success &&
      Array.isArray(message.payload.models) &&
      message.payload.models.length > 0
    ) {
      setModelsCache(resultProvider, message.payload.models);
      if (aiState.aiProviderSetup && aiState.aiProviderSetup[resultProvider]) {
        aiState.aiProviderSetup[resultProvider].models = message.payload.models;
      }
    } else {
      // Fetch failed or returned empty — cache static models to prevent re-fetching on next open
      const staticModels =
        aiState.aiProviderSetup && aiState.aiProviderSetup[resultProvider]
          ? aiState.aiProviderSetup[resultProvider].models
          : null;
      if (staticModels && staticModels.length > 0) {
        setModelsCache(resultProvider, staticModels);
      }
    }
    // Only clear loading state and re-render for the currently displayed provider
    if (resultProvider === aiState.settingsProviderName) {
      aiState.modelsLoading = false;
      render();
    }
    return;
  }

  if (message.type === "saveFavoritesResult") {
    if (message.payload && message.payload.success) {
      if (Array.isArray(message.payload.globalFavorites)) {
        state.globalFavorites = message.payload.globalFavorites;
      }
      if (Array.isArray(message.payload.localFavorites)) {
        state.localFavorites = message.payload.localFavorites;
      }
    }
    render();
    return;
  }

  if (message.type === "aiExplainResult") {
    handleAiExplainResult(message.payload);
    return;
  }
});
