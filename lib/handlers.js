/*-------------------------------------------------
 * Terminal Recipes — VS Code Extension
 * Copyright (c) 2026 Abdulla Aldosari
 * Licensed under the Apache License, Version 2.0.
 * See LICENSE in the project root for details.
 *-------------------------------------------------*/

// lib/handlers.js
// All webview message handler functions.
// Each function receives panel + payload and performs the business logic for one message type.
// Handlers that refresh the webview after saving receive postState as a third argument,
// avoiding circular dependencies — this file never requires extension.js.

const vscode = require("vscode");
const {
  fileExists,
  getFirstWorkspaceFolderPath,
  GLOBAL_DIR,
  GLOBAL_VARIABLES_FILE,
  readGlobalCommandsData,
  writeGlobalCommandsData,
  writeWorkspaceVariables,
  readGlobalVariables,
  writeGlobalVariables,
  readAutoVariablesSettings,
  writeAutoVariablesSettings,
  readGlobalFavorites,
  readWorkspaceFavorites,
  writeGlobalFavorites,
  writeWorkspaceFavorites,
  getWorkspaceVariablesFilePath,
} = require("./storage");
const { normalizeCommandVariables, normalizeCommandsData } = require("./normalize");
const { getOrCreateTerminal } = require("./terminal");
const { resolveAutoVariables } = require("./auto-variables");
const { generateWithAI, explainWithAI, listModelsForProvider } = require("./ai/factory");
const { AI_PROVIDERS } = require("./ai/providers-config");
const fs = require("fs/promises");
const path = require("path");

/**
 * Handles the 'saveData' message from the webview.
 * Normalizes and persists the commands data to the global JSON file,
 * then sends back a success/failure result and refreshes the state.
 * @param {import('vscode').WebviewPanel} panel
 * @param {object} payload - Raw commands data received from the webview
 * @param {function} postState - Callback to refresh webview state
 */
async function handleSaveData(panel, payload, postState) {
  try {
    const normalizedData = normalizeCommandsData(payload);
    await writeGlobalCommandsData(normalizedData);
    await postState(panel);
    await panel.webview.postMessage({
      type: "saveResult",
      payload: { success: true },
    });
  } catch (error) {
    await panel.webview.postMessage({
      type: "saveResult",
      payload: {
        success: false,
        message: error instanceof Error ? error.message : "Unknown error",
      },
    });
  }
}

/**
 * Handles the 'saveCommandVariables' message from the webview.
 * Saves local (workspace) and/or global command variables to their respective files.
 *
 * Payload shape: { local: object, global: object, activeFsPath: string|null }
 * The webview sends { local, global } via buildCommandVariablesPayload() in media/utils.js.
 * extension.js injects activeFsPath (from context.workspaceState) before calling this
 * handler — it is never sent directly by the webview.
 *
 * @param {import('vscode').WebviewPanel} panel
 * @param {{ local: object, global: object, activeFsPath: string|null }} payload
 */
async function handleSaveCommandVariables(panel, payload) {
  try {
    // activeFsPath: injected by extension.js (context.workspaceState) — ensures
    // variables are written to the correct workspace folder in multi-root setups.
    // local  = non-empty values from commandLocalDrafts  (written to workspace file).
    // global = non-empty values from commandGlobalDrafts (written to global file).
    const { local: localPayload, global: globalPayload, activeFsPath } = payload;

    const normalizedLocal = normalizeCommandVariables(localPayload);
    await writeWorkspaceVariables(normalizedLocal, activeFsPath || null);

    if (globalPayload) {
      const normalizedGlobal = normalizeCommandVariables(globalPayload);
      await writeGlobalVariables(normalizedGlobal);
    }

    const globalCommandVariables = await readGlobalVariables();

    await panel.webview.postMessage({
      type: "saveVariablesResult",
      payload: {
        success: true,
        commandVariables: normalizedLocal,
        globalCommandVariables,
      },
    });
  } catch (error) {
    await panel.webview.postMessage({
      type: "saveVariablesResult",
      payload: {
        success: false,
        message: error instanceof Error ? error.message : "Unknown error",
      },
    });
  }
}

/**
 * Handles the 'performAction' message from the webview.
 * Supports three actions: 'copy' (copies to clipboard), 'run' (sends to terminal with newline),
 * and 'use' (sends to terminal without newline). Also updates lastRunAt and runCount.
 * @param {import('vscode').WebviewPanel} panel
 * @param {{ action: string, commandId?: string, resolvedCommand: string, commandVariables: object, shellPath?: string, shellName?: string }} payload
 * @param {function} postState - Callback to refresh webview state
 */
async function handlePerformAction(panel, payload, postState) {
  try {
    const action = payload && typeof payload.action === "string" ? payload.action : "";
    const commandId = payload && typeof payload.commandId === "string" ? payload.commandId : null;
    const resolvedCommand = payload && typeof payload.resolvedCommand === "string" ? payload.resolvedCommand : "";
    const commandVariables = payload && typeof payload.commandVariables === "object" ? payload.commandVariables : {};
    const shellPath = payload && typeof payload.shellPath === "string" ? payload.shellPath : null;
    const shellName = payload && typeof payload.shellName === "string" ? payload.shellName : null;

    if (!action || !resolvedCommand) {
      throw new Error("Action and resolved command are required.");
    }

    // activeFsPath: the workspace folder to use for this specific execution.
    // Comes from the run-confirm modal's folder dropdown (defaults to panel's active folder).
    const activeFsPath =
      payload && typeof payload.activeFsPath === "string" && payload.activeFsPath ? payload.activeFsPath : null;

    // commandVariables carries the complete draft state from the webview at the moment the user
    // triggered the action. Normalize both scopes upfront — localVars is also returned in the
    // actionResult payload to refresh the webview state after the action completes.
    const localVars = normalizeCommandVariables(commandVariables.local || {});
    const globalVars = normalizeCommandVariables(commandVariables.global || {});

    if (action === "copy") {
      await vscode.env.clipboard.writeText(resolvedCommand);
    }

    if (action === "run" || action === "use") {
      // Persist variables to disk only for terminal actions.
      // "copy" requires no variable persistence — it only reads the already-resolved command string.
      // This write also acts as a fallback save for sessions where the variables modal was never
      // opened (i.e., no prior saveCommandVariables message was sent by the webview).
      await writeWorkspaceVariables(localVars, activeFsPath);
      await writeGlobalVariables(globalVars);

      // Apply auto variables to the command using the execution-time folder
      const autoVarsSettings = await readAutoVariablesSettings();
      const workspaceFolder = activeFsPath || getFirstWorkspaceFolderPath();
      const finalCommand = resolveAutoVariables(resolvedCommand, { workspaceFolder }, autoVarsSettings);
      // Pass cwd so the terminal opens in the selected workspace folder
      const terminal = getOrCreateTerminal(shellPath || undefined, shellName || undefined, activeFsPath || undefined);
      terminal.show(false);
      terminal.sendText(finalCommand, action === "run");

      // Update lastRunAt and runCount for run/use actions
      if (commandId) {
        const data = await readGlobalCommandsData();
        const cmd = (data.commands || []).find(function (c) {
          return c.id === commandId;
        });
        if (cmd) {
          cmd.lastRunAt = new Date().toISOString();
          cmd.runCount = (cmd.runCount || 0) + 1;
          await writeGlobalCommandsData(data);
        }
      }
    }

    const globalCommandVariables = await readGlobalVariables();

    await panel.webview.postMessage({
      type: "actionResult",
      payload: {
        success: true,
        action,
        commandVariables: localVars,
        globalCommandVariables,
      },
    });

    // Send fresh state so Recent Commands tab reflects updated lastRunAt/runCount
    if (action === "run" || action === "use") {
      await postState(panel);
    }
  } catch (error) {
    await panel.webview.postMessage({
      type: "actionResult",
      payload: {
        success: false,
        message: error instanceof Error ? error.message : "Unknown error",
      },
    });
  }
}

/**
 * Opens an external URL using VS Code's built-in browser.
 * @param {{ url: string }} payload
 */
async function handleOpenExternalUrl(payload) {
  try {
    const url = payload && typeof payload.url === "string" ? payload.url.trim() : "";
    if (!url) {
      return;
    }
    await vscode.env.openExternal(vscode.Uri.parse(url));
  } catch {
    // Silently ignore — URL open failures are not critical
  }
}

/**
 * Opens the global commands JSON file in the VS Code editor.
 * Creates the file first if it does not exist.
 */
async function openGlobalCommandsFile() {
  const { ensureGlobalCommandsFile, GLOBAL_COMMANDS_FILE } = require("./storage");
  await ensureGlobalCommandsFile();
  const document = await vscode.workspace.openTextDocument(GLOBAL_COMMANDS_FILE);
  await vscode.window.showTextDocument(document, { preview: false });
}

/**
 * Opens the global variables JSON file in the VS Code editor.
 * If the file does not exist, prompts the user to create it first.
 */
async function openGlobalVariablesFile() {
  await fs.mkdir(GLOBAL_DIR, { recursive: true });

  const exists = await fileExists(GLOBAL_VARIABLES_FILE);

  if (!exists) {
    const choice = await vscode.window.showInformationMessage(
      "No global variables file found.",
      {
        detail: "This file is created when you save global variables for any command.",
        modal: false,
      },
      "Create File"
    );

    if (choice !== "Create File") {
      return;
    }

    await fs.writeFile(GLOBAL_VARIABLES_FILE, JSON.stringify({ version: 2, commands: {} }, null, 2), "utf8");
  }

  const document = await vscode.workspace.openTextDocument(GLOBAL_VARIABLES_FILE);
  await vscode.window.showTextDocument(document, { preview: false });
}

/**
 * Opens the workspace-local variables JSON file in the VS Code editor.
 * If no workspace is open, shows a warning. If the file doesn't exist,
 * prompts the user to create it.
 * @param {string|null} [activeFsPath] - Active workspace folder path override (multi-root)
 */
async function openLocalVariablesFile(activeFsPath) {
  const workspaceVariablesPath = getWorkspaceVariablesFilePath(activeFsPath || null);

  if (!workspaceVariablesPath) {
    vscode.window.showWarningMessage("No workspace folder is open.");
    return;
  }

  const exists = await fileExists(workspaceVariablesPath);

  if (!exists) {
    const choice = await vscode.window.showInformationMessage(
      "No local variables file found for this workspace.",
      {
        detail: "This file is created when you save local variables for a command in the current workspace.",
        modal: false,
      },
      "Create File"
    );

    if (choice !== "Create File") {
      return;
    }

    await fs.mkdir(path.dirname(workspaceVariablesPath), { recursive: true });
    await fs.writeFile(workspaceVariablesPath, JSON.stringify({ version: 2, commands: {} }, null, 2), "utf8");
  }

  const document = await vscode.workspace.openTextDocument(workspaceVariablesPath);
  await vscode.window.showTextDocument(document, { preview: false });
}

/**
 * Returns current AI provider name, key status, and provider setup info.
 * Sends aiProviderSetup (from providers-config.js) to the webview so the UI
 * can render provider links and help steps dynamically without hardcoding.
 * @param {import('vscode').WebviewPanel} panel
 * @param {import('vscode').ExtensionContext} context
 */
async function handleAiGetSettings(panel, context) {
  const providerName = vscode.workspace.getConfiguration("terminalRecipes").get("aiProvider") || "gemini";

  const keyStatus = {};
  for (const p of Object.keys(AI_PROVIDERS)) {
    const key = await context.secrets.get(`${p}_key`);
    keyStatus[p] = Boolean(key && key.trim());
  }

  const modelId = vscode.workspace.getConfiguration("terminalRecipes").get("aiModel") || "";

  // Build a lean aiProviderSetup object to send to the webview
  // (only the fields needed by the UI — no internal Node.js references)
  const aiProviderSetup = {};
  for (const [key, cfg] of Object.entries(AI_PROVIDERS)) {
    aiProviderSetup[key] = {
      name: cfg.name,
      serviceName: cfg.serviceName,
      providerName: cfg.providerName,
      defaultModelId: cfg.defaultModelId,
      displayLabel: cfg.displayLabel,
      models: cfg.models,
      apiKeyUrl: cfg.apiKeyUrl,
      apiKeyUrlLabel: cfg.apiKeyUrlLabel,
      steps: cfg.steps,
    };
  }

  await panel.webview.postMessage({
    type: "aiSettingsResult",
    payload: { providerName, modelId, keyStatus, aiProviderSetup },
  });
}

/**
 * Saves AI provider selection and API key to VS Code secrets.
 * @param {import('vscode').WebviewPanel} panel
 * @param {import('vscode').ExtensionContext} context
 * @param {{ providerName: string, apiKey: string }} payload
 */
async function handleAiSaveSettings(panel, context, payload) {
  try {
    const providerName = payload && typeof payload.providerName === "string" ? payload.providerName : "";
    const apiKey = payload && typeof payload.apiKey === "string" ? payload.apiKey.trim() : "";
    const modelId = payload && typeof payload.modelId === "string" ? payload.modelId.trim() : "";

    if (!providerName) {
      throw new Error("Provider name is required.");
    }

    await vscode.workspace
      .getConfiguration("terminalRecipes")
      .update("aiProvider", providerName, vscode.ConfigurationTarget.Global);

    if (modelId) {
      await vscode.workspace
        .getConfiguration("terminalRecipes")
        .update("aiModel", modelId, vscode.ConfigurationTarget.Global);
    }

    if (apiKey) {
      await context.secrets.store(`${providerName}_key`, apiKey);
    }

    await panel.webview.postMessage({
      type: "aiSaveSettingsResult",
      payload: { success: true },
    });
  } catch (error) {
    await panel.webview.postMessage({
      type: "aiSaveSettingsResult",
      payload: {
        success: false,
        message: error instanceof Error ? error.message : "Unknown error",
      },
    });
  }
}

/**
 * Runs AI generation and returns results back to the webview.
 * @param {import('vscode').WebviewPanel} panel
 * @param {import('vscode').ExtensionContext} context
 * @param {{ mode: 'full'|'single', prompt: string, categoryId?: string, groupId?: string, shellName?: string, shellPath?: string }} payload
 */
async function handleAiGenerate(panel, context, payload) {
  try {
    const mode = payload && payload.mode === "single" ? "single" : "full";
    const prompt = payload && typeof payload.prompt === "string" ? payload.prompt.trim() : "";
    const categoryId = payload && typeof payload.categoryId === "string" ? payload.categoryId : "";
    const groupId = payload && typeof payload.groupId === "string" ? payload.groupId : "";
    const shellName = payload && typeof payload.shellName === "string" ? payload.shellName.trim() : "";
    const shellPath = payload && typeof payload.shellPath === "string" ? payload.shellPath.trim() : "";

    if (!prompt) {
      throw new Error("Prompt is required.");
    }

    const providerName = vscode.workspace.getConfiguration("terminalRecipes").get("aiProvider") || "gemini";

    const storedModelId = vscode.workspace.getConfiguration("terminalRecipes").get("aiModel") || "";

    // Validate stored modelId against the provider's known model list.
    // If the stored model is no longer valid (e.g. deprecated), fall back to the provider's default.
    const providerCfg = AI_PROVIDERS[providerName];
    const knownModelIds =
      providerCfg && Array.isArray(providerCfg.models)
        ? providerCfg.models.map(function (m) {
            return m.modelId;
          })
        : [];
    const modelId =
      storedModelId && (!knownModelIds.length || knownModelIds.includes(storedModelId))
        ? storedModelId
        : (providerCfg && providerCfg.defaultModelId) || "";

    const apiKey = await context.secrets.get(`${providerName}_key`);
    if (!apiKey || !apiKey.trim()) {
      throw new Error(`No API key found for provider "${providerName}". Please configure it in AI Settings.`);
    }

    const customSystemInstruction =
      vscode.workspace.getConfiguration("terminalRecipes").get("customSystemInstructions") || "";

    const result = await generateWithAI({
      providerName,
      modelId: modelId || undefined,
      apiKey: apiKey.trim(),
      prompt,
      mode,
      customSystemInstruction: customSystemInstruction.trim() || undefined,
      categoryId,
      groupId,
      shellName,
      shellPath,
    });

    await panel.webview.postMessage({
      type: "aiGenerateResult",

      payload: { success: true, mode, result },
    });
  } catch (error) {
    await panel.webview.postMessage({
      type: "aiGenerateResult",
      payload: { success: false, message: classifyAiError(error) },
    });
  }
}

/**
 * Inserts selected AI-generated commands (and optionally a new category) into the data file.
 * @param {import('vscode').WebviewPanel} panel
 * @param {{ mode: 'full'|'single', category?: object, commands: object[] }} payload
 * @param {function} postState - Callback to refresh webview state
 */
async function handleAiInsert(panel, payload, postState) {
  try {
    const mode = payload && payload.mode === "single" ? "single" : "full";
    const selectedCommands = Array.isArray(payload && payload.commands) ? payload.commands : [];

    if (!selectedCommands.length) {
      throw new Error("No commands selected for insertion.");
    }

    const data = await readGlobalCommandsData();

    if (mode === "full" && payload.category) {
      // Add new category (only if it doesn't exist yet)
      const existingCategory = data.categories.find(function (c) {
        return c.id === payload.category.id;
      });

      if (!existingCategory) {
        data.categories.push({
          id: payload.category.id,
          title: payload.category.title,
          groups: payload.category.groups || [],
        });
      } else {
        // Merge new groups into existing category
        const existingGroupIds = new Set(
          existingCategory.groups.map(function (g) {
            return g.id;
          })
        );
        for (const group of payload.category.groups || []) {
          if (!existingGroupIds.has(group.id)) {
            existingCategory.groups.push(group);
          }
        }
      }
    }

    // Add selected commands (skip duplicates by ID)
    const existingCommandIds = new Set(
      data.commands.map(function (c) {
        return c.id;
      })
    );
    for (const cmd of selectedCommands) {
      if (!existingCommandIds.has(cmd.id)) {
        data.commands.push(cmd);
        existingCommandIds.add(cmd.id);
      }
    }

    const normalizedData = normalizeCommandsData(data);
    await writeGlobalCommandsData(normalizedData);

    await panel.webview.postMessage({
      type: "aiInsertResult",
      payload: { success: true, count: selectedCommands.length },
    });

    await postState(panel);
  } catch (error) {
    await panel.webview.postMessage({
      type: "aiInsertResult",
      payload: {
        success: false,
        message: error instanceof Error ? error.message : "Unknown error",
      },
    });
  }
}

/**
 * Saves Auto Variables settings and sends an updated state to the webview.
 * @param {import('vscode').WebviewPanel} panel
 * @param {{ [varName]: { enabled: boolean, config?: object } }} payload
 * @param {function} postState - Callback to refresh webview state
 */
async function handleSaveAutoVariablesSettings(panel, payload, postState) {
  try {
    if (!payload || typeof payload !== "object") {
      throw new Error("Invalid payload.");
    }
    await writeAutoVariablesSettings(payload);
    await postState(panel);
    await panel.webview.postMessage({
      type: "saveAutoVariablesSettingsResult",
      payload: { success: true },
    });
  } catch (error) {
    await panel.webview.postMessage({
      type: "saveAutoVariablesSettingsResult",
      payload: {
        success: false,
        message: error instanceof Error ? error.message : "Unknown error",
      },
    });
  }
}

/**
 * Saves favorites (global and/or local) and posts back the updated lists.
 * @param {import('vscode').WebviewPanel} panel
 * @param {{ global?: string[], local?: string[], activeFsPath?: string|null }} payload
 */
async function handleSaveFavorites(panel, payload) {
  try {
    const activeFsPath =
      payload && typeof payload.activeFsPath === "string" && payload.activeFsPath ? payload.activeFsPath : null;
    if (payload && Array.isArray(payload.global)) {
      await writeGlobalFavorites(payload.global);
    }
    if (payload && Array.isArray(payload.local)) {
      await writeWorkspaceFavorites(payload.local, activeFsPath);
    }
    const globalFavorites = await readGlobalFavorites();
    const localFavorites = await readWorkspaceFavorites(activeFsPath);
    await panel.webview.postMessage({
      type: "saveFavoritesResult",
      payload: { success: true, globalFavorites, localFavorites },
    });
  } catch (error) {
    await panel.webview.postMessage({
      type: "saveFavoritesResult",
      payload: {
        success: false,
        message: error instanceof Error ? error.message : "Unknown error",
      },
    });
  }
}

/**
 * Fetches model lists for ALL providers that have a saved API key.
 * Posts back one `aiListModelsResult` per provider, in parallel.
 * The frontend caches each result individually.
 * @param {import('vscode').WebviewPanel} panel
 * @param {import('vscode').ExtensionContext} context
 */
async function handleAiRefreshAllModels(panel, context) {
  const providerNames = Object.keys(AI_PROVIDERS);
  await Promise.allSettled(
    providerNames.map(async function (providerName) {
      const apiKey = await context.secrets.get(`${providerName}_key`);
      if (!apiKey || !apiKey.trim()) {
        return;
      }
      try {
        const models = await listModelsForProvider(providerName, apiKey.trim());
        await panel.webview.postMessage({
          type: "aiListModelsResult",
          payload: { providerName, success: true, models },
        });
      } catch (error) {
        await panel.webview.postMessage({
          type: "aiListModelsResult",
          payload: {
            providerName,
            success: false,
            models: null,
            message: error instanceof Error ? error.message : "Unknown error",
          },
        });
      }
    })
  );
}

/**
 * Fetches the list of available models for the given provider using its API key.
 * Posts back aiListModelsResult with the models array on success, or success: false on failure.
 * @param {import('vscode').WebviewPanel} panel
 * @param {import('vscode').ExtensionContext} context
 * @param {{ providerName: string }} payload
 */
async function handleAiListModels(panel, context, payload) {
  const providerName = payload && typeof payload.providerName === "string" ? payload.providerName : "";
  if (!providerName) {
    return;
  }

  const apiKey = await context.secrets.get(`${providerName}_key`);
  if (!apiKey || !apiKey.trim()) {
    await panel.webview.postMessage({
      type: "aiListModelsResult",
      payload: { providerName, success: false, models: null },
    });
    return;
  }

  try {
    const models = await listModelsForProvider(providerName, apiKey.trim());
    await panel.webview.postMessage({
      type: "aiListModelsResult",
      payload: { providerName, success: true, models },
    });
  } catch (error) {
    await panel.webview.postMessage({
      type: "aiListModelsResult",
      payload: {
        providerName,
        success: false,
        models: null,
        message: error instanceof Error ? error.message : "Unknown error",
      },
    });
  }
}

/**
 * Extracts the actual error message from an AI provider error.
 *
 * Each SDK stores the error differently — based on their source code:
 *
 * Anthropic SDK (core/error.js):
 *   - err.error = full response body: { type, error: { type, message }, request_id }
 *   - Real message → err.error.error.message
 *
 * OpenAI SDK (core/error.js):
 *   - Extracts the inner error: const error = errorResponse?.['error']
 *   - err.error = inner error object: { message, type, code, param }
 *   - Real message → err.error.message
 *
 * Gemini SDK (GoogleGenerativeAIFetchError):
 *   - No err.error property
 *   - err.message = "[GoogleGenerativeAI Error]: <real message>"
 *   - Real message → strip the "[GoogleGenerativeAI Error]: " prefix
 *
 * @param {Error} error
 * @returns {string} The original provider error message
 */
function classifyAiError(error) {
  // Anthropic: err.error is the full response body → err.error.error.message
  const anthropicMessage =
    error && error.error && error.error.error && typeof error.error.error.message === "string"
      ? error.error.error.message.trim()
      : "";

  if (anthropicMessage) {
    return anthropicMessage;
  }

  // OpenAI: err.error is the inner error object → err.error.message
  const openaiMessage =
    error && error.error && typeof error.error.message === "string" ? error.error.message.trim() : "";

  if (openaiMessage) {
    return openaiMessage;
  }

  // Gemini: err.message prefixed with "[GoogleGenerativeAI Error]: "
  const rawMessage = error && error.message ? error.message : "";
  const geminiMessage = rawMessage
    .replace(/^\[GoogleGenerativeAI Error\]:\s*/i, "")
    .replace(/Error fetching from https?:\/\/[^\s]+:\s*/i, "")
    .trim();

  return geminiMessage || "An unexpected error occurred. Please try again.";
}

/**
 * Deletes the API key for the given provider from VS Code SecretStorage.
 * @param {import('vscode').WebviewPanel} panel
 * @param {import('vscode').ExtensionContext} context
 * @param {{ providerName: string }} payload
 */
async function handleAiDeleteKey(panel, context, payload) {
  try {
    const providerName = payload && typeof payload.providerName === "string" ? payload.providerName.trim() : "";
    if (!providerName) {
      throw new Error("No provider name supplied.");
    }
    await context.secrets.delete(`${providerName}_key`);
    await panel.webview.postMessage({
      type: "aiDeleteKeyResult",
      payload: { success: true },
    });
  } catch (err) {
    await panel.webview.postMessage({
      type: "aiDeleteKeyResult",
      payload: { success: false, error: err.message },
    });
  }
}

/**
 * Explains a CLI command using the configured AI provider.
 * Returns a Markdown-formatted string and sends it back as `aiExplainResult`.
 * @param {import('vscode').WebviewPanel} panel
 * @param {import('vscode').ExtensionContext} context
 * @param {{ command: string }} payload
 */
async function handleAiExplain(panel, context, payload) {
  try {
    const command = payload && typeof payload.command === "string" ? payload.command.trim() : "";

    if (!command) {
      throw new Error("Command is required.");
    }

    const providerName = vscode.workspace.getConfiguration("terminalRecipes").get("aiProvider") || "gemini";

    const storedModelId = vscode.workspace.getConfiguration("terminalRecipes").get("aiModel") || "";

    const providerCfg = AI_PROVIDERS[providerName];
    const knownModelIds =
      providerCfg && Array.isArray(providerCfg.models)
        ? providerCfg.models.map(function (m) {
            return m.modelId;
          })
        : [];
    const modelId =
      storedModelId && (!knownModelIds.length || knownModelIds.includes(storedModelId))
        ? storedModelId
        : (providerCfg && providerCfg.defaultModelId) || "";

    const apiKey = await context.secrets.get(`${providerName}_key`);
    if (!apiKey || !apiKey.trim()) {
      throw new Error(`No API key found for provider "${providerName}". Please configure it in AI Settings.`);
    }

    const markdown = await explainWithAI({
      providerName,
      modelId: modelId || undefined,
      apiKey: apiKey.trim(),
      command,
    });

    await panel.webview.postMessage({
      type: "aiExplainResult",
      payload: { success: true, markdown },
    });
  } catch (error) {
    await panel.webview.postMessage({
      type: "aiExplainResult",
      payload: { success: false, message: classifyAiError(error) },
    });
  }
}

module.exports = {
  handleSaveData,
  handleSaveCommandVariables,
  handlePerformAction,
  handleOpenExternalUrl,
  openGlobalCommandsFile,
  openGlobalVariablesFile,
  openLocalVariablesFile,
  handleAiGetSettings,
  handleAiSaveSettings,
  handleAiGenerate,
  handleAiInsert,
  handleSaveAutoVariablesSettings,
  handleSaveFavorites,
  handleAiListModels,
  handleAiRefreshAllModels,
  handleAiDeleteKey,
  handleAiExplain,
};
