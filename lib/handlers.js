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
  GLOBAL_DATA_FILE,
  GLOBAL_COMMANDS_FILE,
  ensureGlobalCommandsFile,
  readCommandsData,
  writeCommandsData,
  writeWorkspaceVariables,
  readGlobalVariables,
  writeGlobalVariables,
  readAutoVariablesSettings,
  writeAutoVariablesSettings,
  readGlobalFavorites,
  readWorkspaceFavorites,
  writeGlobalFavorites,
  writeWorkspaceFavorites,
  getWorkspaceDataFilePath,
  normalizeDataFile,
} = require("./storage");
const { normalizeVariablesSection, normalizeCommandsData } = require("./normalize");

const { getOrCreateTerminal } = require("./terminal");
const { resolveAutoVariables } = require("./auto-variables");
const {
  generateWithAI,
  explainWithAI,
  listModelsForProvider,
  checkProviderConnection,
  checkProviderRateLimits,
} = require("./ai/factory");
const { AI_PROVIDERS } = require("./ai/providers-config");

const fs = require("fs/promises");
const path = require("path");

/**
 * Handles the 'saveData' message from the webview.
 * Normalizes and persists the commands data to the commands JSON file,
 * then sends back a success/failure result and refreshes the state.
 * @param {import('vscode').WebviewPanel} panel
 * @param {object} payload - Raw commands data received from the webview
 * @param {function} postState - Callback to refresh webview state
 */
async function handleSaveCommandsData(panel, payload, postState) {
  try {
    const normalizedData = normalizeCommandsData(payload);
    await writeCommandsData(normalizedData);
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

    const normalizedLocal = normalizeVariablesSection(localPayload);
    const wasCreated = await writeWorkspaceVariables(normalizedLocal, activeFsPath || null);
    if (wasCreated) {
      notifyLocalDataFileCreated(activeFsPath || null);
    }

    if (globalPayload) {
      const normalizedGlobal = normalizeVariablesSection(globalPayload);
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
    const shellPath = payload && typeof payload.shellPath === "string" ? payload.shellPath : null;
    const shellName = payload && typeof payload.shellName === "string" ? payload.shellName : null;

    if (!action || !resolvedCommand) {
      throw new Error("Action and resolved command are required.");
    }

    // activeFsPath: the workspace folder to use for this specific execution.
    // Comes from the run-confirm modal's folder dropdown (defaults to panel's active folder).
    const activeFsPath =
      payload && typeof payload.activeFsPath === "string" && payload.activeFsPath ? payload.activeFsPath : null;

    if (action === "copy") {
      await vscode.env.clipboard.writeText(resolvedCommand);
    }

    if (action === "run" || action === "use") {
      // Variables are already persisted to disk by handleSaveCommandVariables,
      // which the webview calls whenever the user confirms values in the
      // "Enter Variable Values" modal. If that modal never opened, no variable
      // value could have changed in this session, so no write is needed here
      // either — commandVariables always mirrors what is already on disk.

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
        const data = await readCommandsData();
        const cmd = (data.commands || []).find(function (c) {
          return c.id === commandId;
        });
        if (cmd) {
          cmd.lastRunAt = new Date().toISOString();
          cmd.runCount = (cmd.runCount || 0) + 1;
          await writeCommandsData(data);
        }
      }
    }

    await panel.webview.postMessage({
      type: "actionResult",
      payload: {
        success: true,
        action,
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
 * Shows a one-time informational notice when the workspace-local unified data
 * file is created for the first time. Includes an "Open Settings" action that
 * jumps directly to the localWorkspaceFilesPath setting. Not awaited by callers
 * so it never blocks the save flow or delays the response sent back to the webview.
 * @param {string|null} activeFsPath
 */
async function notifyLocalDataFileCreated(activeFsPath) {
  const configuredPath = vscode.workspace.getConfiguration("terminalRecipes").get("localWorkspaceFilesPath") || "";
  const relativeDir = configuredPath.trim() || ".vscode";

  const choice = await vscode.window.showInformationMessage(
    `This workspace now has its own data file at "${relativeDir}/terminal-recipes.data.json". You can change its location in settings anytime.`,
    "Open Settings"
  );

  if (choice === "Open Settings") {
    await vscode.commands.executeCommand("workbench.action.openSettings", "terminalRecipes.localWorkspaceFilesPath");
  }
}

/**
 * Opens the global commands JSON file in the VS Code editor.
 * Creates the file first if it does not exist.
 */
async function openGlobalCommandsFile() {
  await ensureGlobalCommandsFile();
  const document = await vscode.workspace.openTextDocument(GLOBAL_COMMANDS_FILE);
  await vscode.window.showTextDocument(document, { preview: false });
}

/**
 * Opens the global unified data file in the VS Code editor.
 * If the file does not exist, prompts the user to create it first.
 */
async function openGlobalDataFile() {
  await fs.mkdir(GLOBAL_DIR, { recursive: true });

  const exists = await fileExists(GLOBAL_DATA_FILE);

  if (!exists) {
    const choice = await vscode.window.showInformationMessage(
      "No global data file found.",
      {
        detail: "This file is created when you save global variables or favorites for any command.",
        modal: false,
      },
      "Create File"
    );

    if (choice !== "Create File") {
      return;
    }

    await fs.writeFile(GLOBAL_DATA_FILE, JSON.stringify(normalizeDataFile({}), null, 2), "utf8");
  }

  const document = await vscode.workspace.openTextDocument(GLOBAL_DATA_FILE);
  await vscode.window.showTextDocument(document, { preview: false });
}

/**
 * Opens the workspace-local unified data file in the VS Code editor.
 * If no workspace is open, shows a warning. If the file doesn't exist,
 * prompts the user to create it.
 * @param {string|null} [activeFsPath] - Active workspace folder path override (multi-root)
 */
async function openLocalDataFile(activeFsPath) {
  const filePath = getWorkspaceDataFilePath(activeFsPath || null);

  if (!filePath) {
    vscode.window.showWarningMessage("No workspace folder is open.");
    return;
  }

  const exists = await fileExists(filePath);

  if (!exists) {
    const choice = await vscode.window.showInformationMessage(
      "No local data file found for this workspace.",
      {
        detail:
          "This file is created when you save local variables or favorites for a command in the current workspace.",
        modal: false,
      },
      "Create File"
    );

    if (choice !== "Create File") {
      return;
    }

    await fs.mkdir(path.dirname(filePath), { recursive: true });
    await fs.writeFile(filePath, JSON.stringify(normalizeDataFile({}), null, 2), "utf8");
  }

  const document = await vscode.workspace.openTextDocument(filePath);
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
 * Resolves the AI provider name and model ID to use for a request, based on
 * VS Code settings. If the stored modelId is no longer valid for the current
 * provider (e.g. deprecated model), falls back to the provider's defaultModelId.
 * @returns {{ providerName: string, modelId: string, providerCfg: object|undefined }}
 */
function resolveAiProviderAndModel() {
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

  return { providerName, modelId, providerCfg };
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

    const { providerName, modelId } = resolveAiProviderAndModel();

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
      payload: { success: false, message: extractAiErrorMessage(error) },
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

    const data = await readCommandsData();

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
    await writeCommandsData(normalizedData);

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
      const wasCreated = await writeWorkspaceFavorites(payload.local, activeFsPath);
      if (wasCreated) {
        notifyLocalDataFileCreated(activeFsPath);
      }
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
function extractAiErrorMessage(error) {
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

    const { providerName, modelId } = resolveAiProviderAndModel();

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
      payload: { success: false, message: extractAiErrorMessage(error) },
    });
  }
}

/**
 * Verifies API key validity and connectivity for the given provider.
 * Shows a VS Code progress notification (indeterminate bar) while the check
 * is running, then posts back `aiCheckConnectionResult` with the outcome.
 * @param {import('vscode').WebviewPanel} panel
 * @param {import('vscode').ExtensionContext} context
 * @param {{ providerName: string, modelId?: string }} payload
 */
async function handleAiCheckConnection(panel, context, payload) {
  const providerName = payload && typeof payload.providerName === "string" ? payload.providerName : "";
  const modelId = payload && typeof payload.modelId === "string" ? payload.modelId : "";
  const cfg = AI_PROVIDERS[providerName];

  if (!providerName) {
    return;
  }

  const apiKey = await context.secrets.get(`${providerName}_key`);
  if (!apiKey || !apiKey.trim()) {
    await panel.webview.postMessage({
      type: "aiCheckConnectionResult",
      payload: { success: false, providerName, message: "No API key found for this provider." },
    });
    return;
  }

  await vscode.window.withProgress(
    {
      location: vscode.ProgressLocation.Notification,
      title: `Checking connection to ${(cfg && cfg.serviceName) || providerName}…`,
      cancellable: false,
    },
    async function () {
      try {
        const result = await checkProviderConnection(providerName, apiKey.trim(), modelId || undefined);
        await panel.webview.postMessage({
          type: "aiCheckConnectionResult",
          payload: { success: true, ...result },
        });
      } catch (error) {
        await panel.webview.postMessage({
          type: "aiCheckConnectionResult",
          payload: { success: false, providerName, message: extractAiErrorMessage(error) },
        });
      }
    }
  );
}

/**
 * Retrieves rate limit information for the given provider, if supported.
 * If the provider does not support proactive rate limit checks (`hasApiRateLimits: false`
 * in providers-config.js), responds immediately without showing a progress notification
 * or making any network request — the webview shows a link to the provider's own
 * rate-limit page instead.
 * @param {import('vscode').WebviewPanel} panel
 * @param {import('vscode').ExtensionContext} context
 * @param {{ providerName: string, modelId?: string }} payload
 */
async function handleAiCheckRateLimits(panel, context, payload) {
  const providerName = payload && typeof payload.providerName === "string" ? payload.providerName : "";
  const modelId = payload && typeof payload.modelId === "string" ? payload.modelId : "";
  const cfg = AI_PROVIDERS[providerName];

  if (!providerName) {
    return;
  }

  // Provider does not support proactive rate limit checks — respond immediately, no network call.
  if (!cfg || !cfg.hasApiRateLimits) {
    await panel.webview.postMessage({
      type: "aiCheckRateLimitsResult",
      payload: {
        success: true,
        supported: false,
        providerName,
        serviceName: (cfg && cfg.serviceName) || providerName,
        rateLimitsUrl: (cfg && cfg.rateLimitsUrl) || "",
      },
    });
    return;
  }

  const apiKey = await context.secrets.get(`${providerName}_key`);
  if (!apiKey || !apiKey.trim()) {
    await panel.webview.postMessage({
      type: "aiCheckRateLimitsResult",
      payload: { success: false, providerName, message: "No API key found for this provider." },
    });
    return;
  }

  await vscode.window.withProgress(
    {
      location: vscode.ProgressLocation.Notification,
      title: `Checking rate limits for ${cfg.serviceName}…`,
      cancellable: false,
    },
    async function () {
      try {
        const result = await checkProviderRateLimits(providerName, apiKey.trim(), modelId || undefined);
        await panel.webview.postMessage({
          type: "aiCheckRateLimitsResult",
          payload: { success: true, ...result },
        });
      } catch (error) {
        await panel.webview.postMessage({
          type: "aiCheckRateLimitsResult",
          payload: { success: false, providerName, message: extractAiErrorMessage(error) },
        });
      }
    }
  );
}

module.exports = {
  handleSaveCommandsData,
  handleSaveCommandVariables,
  handlePerformAction,
  handleOpenExternalUrl,
  openGlobalCommandsFile,
  openGlobalDataFile,
  openLocalDataFile,
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
  handleAiCheckConnection,
  handleAiCheckRateLimits,
};
