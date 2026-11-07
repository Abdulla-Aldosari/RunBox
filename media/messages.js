/*-------------------------------------------------
 * RunBox — VS Code Extension
 * Copyright (c) 2026 Abdulla Aldosari
 * Licensed under the MIT License.
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
/**
 * Opens the edit-edit conflict modal after the extension reports that another
 * VS Code window changed this exact command between this form opening and
 * this save. editConflictState.pendingScope/pendingCommand were already set by
 * submitEditCommand() (media/modals/command-form.js) right before the save
 * attempt; this only needs to record the newer on-disk version and reveal the
 * modal.
 * @param {object} currentCommand - the newer command object currently on disk
 */
function handleEditConflict(currentCommand) {
  editConflictState.visible = true;
  editConflictState.currentCommand = currentCommand || null;
  render();
}

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
      showNotice(`Save failed: ${message.payload && message.payload.message ? message.payload.message : "Unknown error"}`, icons.circleX, "error");
      // Rollback optimistic render — reload authoritative state from disk
      vscode.postMessage({ type: "requestState" });
    }
    // Page is already rendered by persistDataThenRender() — just append the notice to document.body (outside #app, survives render)
    paintNotice();
    return;
  }

  if (message.type === "applyOperationResult") {
    const pendingMessage = uiState.pendingSaveMessage;
    uiState.pendingSaveMessage = null;

    if (message.payload && message.payload.success) {
      showNotice(pendingMessage || "Saved successfully.", icons.circleCheck, "success");
    } else if (message.payload && message.payload.conflict) {
      // Edit-edit conflict: another VS Code window changed this exact command
      // between this form opening and this save. The extension did NOT write
      // anything and did NOT refresh state — show the conflict modal instead
      // of the generic failure path so the user can choose to overwrite or
      // discard, rather than silently losing one side or the other.
      handleEditConflict(message.payload.currentCommand);
    } else {
      showNotice(`Save failed: ${message.payload && message.payload.message ? message.payload.message : "Unknown error"}`, icons.circleX, "error");
      // Rollback optimistic render — reload authoritative state from disk
      vscode.postMessage({ type: "requestState" });
    }
    paintNotice();
    return;
  }

  if (message.type === "saveWorkspaceCommandsDataResult") {
    const pendingMessage = uiState.pendingSaveMessage;
    uiState.pendingSaveMessage = null;

    if (message.payload && message.payload.success) {
      showNotice(pendingMessage || "Saved successfully.", icons.circleCheck, "success");
    } else {
      showNotice(`Save failed: ${message.payload && message.payload.message ? message.payload.message : "Unknown error"}`, icons.circleX, "error");
      vscode.postMessage({ type: "requestState" });
    }
    paintNotice();
    return;
  }

  // Fresh auto variable values for the open Run Confirm modal. Ignored when the
  // modal was closed or reopened since the request (requestId mismatch).
  if (message.type === "autoVariablesResult") {
    const payload = message.payload || {};
    if (runConfirmState.commandId && payload.requestId && payload.requestId === runConfirmState.autoRequestId) {
      runConfirmState.autoValues = mapAutoVariableValues(payload.autoVariables);
      render();
    }
    return;
  }

  if (message.type === "actionResult") {
    if (message.payload && message.payload.success) {
      showNotice(`Action "${message.payload.action}" completed.`, icons.circleCheck, "info");
    } else {
      showNotice(`Action failed: ${message.payload && message.payload.message ? message.payload.message : "Unknown error"}`, icons.circleX, "error");
    }

    render();
    return;
  }

  if (message.type === "saveVariablesResult") {
    const savedCommandId = message.payload && typeof message.payload.commandId === "string" ? message.payload.commandId : "";
    if (savedCommandId && uiState.pendingVariableSaves[savedCommandId]) {
      uiState.pendingVariableSaves[savedCommandId] -= 1;
      if (uiState.pendingVariableSaves[savedCommandId] <= 0) {
        delete uiState.pendingVariableSaves[savedCommandId];
      }
    }
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
        if (cached && aiState.aiProviderSetup && !["__proto__", "constructor", "prototype"].includes(providerName) && aiState.aiProviderSetup[providerName]) {
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
      showNotice(`Failed to save settings: ${message.payload && message.payload.message ? message.payload.message : "Unknown error"}`, icons.circleX, "error");
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
      showNotice(`Failed to remove key: ${message.payload && message.payload.error ? message.payload.error : "Unknown error"}`, icons.circleX, "error");
    }
    return;
  }

  if (message.type === "aiGenerateProgress") {
    // Ignore late progress after the user cancelled or the result already arrived
    if (aiState.view !== "loading") {
      return;
    }
    aiState.progress = mergeAiProgress(aiState.progress, message.payload);
    updateAiLoadingView();
    return;
  }

  if (message.type === "aiGenerateResult") {
    // Ignore a result that arrives after the user cancelled the loading overlay
    if (aiState.view !== "loading") {
      return;
    }
    const payload = message.payload;
    if (payload && payload.success) {
      // Let the group list finish with a short closing flash; skip it if the user cancelled meanwhile
      playAiLoadingFinale(function () {
        if (aiState.view === "loading") {
          applyAiGenerateResult(payload);
        }
      });
    } else {
      applyAiGenerateResult(payload);
    }
    return;
  }

  if (message.type === "aiInsertResult") {
    if (message.payload && message.payload.success) {
      aiState.view = null;
      aiState.result = null;
      aiState.warnings = [];
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
      showNotice("Failed to save: " + (message.payload && message.payload.message ? message.payload.message : "Unknown error"), icons.circleX, "error");
    }
    // Page is already rendered — just append the notice to document.body (outside #app, survives any future render)
    paintNotice();
    return;
  }

  if (message.type === "aiListModelsResult") {
    const resultProvider = message.payload && message.payload.providerName;
    // Persist to cache and apply to aiState on success
    if (message.payload && message.payload.success && Array.isArray(message.payload.models) && message.payload.models.length > 0) {
      setModelsCache(resultProvider, message.payload.models);
      if (aiState.aiProviderSetup && !["__proto__", "constructor", "prototype"].includes(resultProvider) && aiState.aiProviderSetup[resultProvider]) {
        aiState.aiProviderSetup[resultProvider].models = message.payload.models;
      }
    } else {
      // Fetch failed or returned empty — cache static models to prevent re-fetching on next open
      const staticModels = aiState.aiProviderSetup && aiState.aiProviderSetup[resultProvider] ? aiState.aiProviderSetup[resultProvider].models : null;
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

  if (message.type === "aiCheckConnectionResult") {
    handleAiCheckConnectionResult(message.payload);
    return;
  }

  if (message.type === "aiCheckRateLimitsResult") {
    handleAiCheckRateLimitsResult(message.payload);
    return;
  }

  if (message.type === "pickFileResult") {
    if (!message.payload || !message.payload.success || !message.payload.fsPath) {
      return;
    }
    const varName = message.payload.variableName;
    if (!varName) {
      return;
    }
    const input = document.querySelector('.variable-modal-input[data-variable-name="' + varName + '"]');
    if (!input || input.classList.contains("hidden") || input.readOnly) {
      return;
    }
    input.value = message.payload.fsPath;
    variableInputState.inputValues[varName] = message.payload.fsPath;
    // No render() here to avoid focus loss while editing
    return;
  }

  if (message.type === "variableShortcut") {
    applyVariableShortcut(message.payload && message.payload.action);
    return;
  }
});
