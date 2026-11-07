/*-------------------------------------------------
 * RunBox — VS Code Extension
 * Copyright (c) 2026 Abdulla Aldosari
 * Licensed under the MIT License.
 * See LICENSE in the project root for details.
 *-------------------------------------------------*/

// lib/handlers.js
// All webview message handler functions.
// Each function receives panel + payload and performs the business logic for one message type.
// Handlers that refresh the webview after saving receive postState as a third argument,
// avoiding circular dependencies — this file never requires extension.js.

const vscode = require("vscode");
const path = require("path");
const {
  fileExists,
  getFirstWorkspaceFolderPath,
  GLOBAL_DATA_FILE,
  GLOBAL_COMMANDS_FILE,
  ensureGlobalCommandsFile,
  normalizeLocalWorkspaceDir,
  readCommandsData,
  writeCommandsData,
  applyCommandsDataOperation,
  setWorkspaceCommandVariables,
  readWorkspaceVariables,
  readGlobalVariables,
  setGlobalCommandVariables,
  readAutoVariablesSettings,
  writeAutoVariablesSettings,
  readGlobalFavorites,
  readWorkspaceFavorites,
  setGlobalFavorite,
  setWorkspaceFavorite,
  getWorkspaceDataFilePath,
  readWorkspaceCommandsSection,
  writeWorkspaceCommandsSection,
  applyWorkspaceCommandsOperation,
  writeDataFile,
} = require("./storage");
const { normalizeCommandsData } = require("./normalize");

const { getOrCreateTerminal } = require("./terminal");
const { resolveAutoVariables } = require("./auto-variables");
const { generateWithAI, explainWithAI, listModelsForProvider, checkProviderConnection, checkProviderRateLimits } = require("./ai/factory");
const { AI_PROVIDERS } = require("./ai/providers-config");
const { resolveAiOutputLanguage } = require("./ai/languages");
const { isValidEntityId } = require("./ids");

/**
 * Validates the ID of an entity the webview is creating (addCategory, addGroup,
 * addCommand via applyOperation). The webview generates these IDs so it can
 * render the entity before the save completes; the extension rejects any ID
 * that does not match the entity ID format (lib/ids.js). Duplicate IDs are
 * rejected by the storage layer against the freshest on-disk data.
 * Moves (handleSaveCommandMove) re-add an existing command and are not checked,
 * so commands created before the current format keep working.
 * @param {{ type: string, category?: object, group?: object, command?: object }} op
 * @throws {Error}
 */
function assertNewEntityId(op) {
  const entityByType = { addCategory: op.category, addGroup: op.group, addCommand: op.command };
  if (!(op.type in entityByType)) {
    return;
  }
  const entity = entityByType[op.type];
  if (!entity || !isValidEntityId(entity.id)) {
    throw new Error(`Invalid ID for the new ${op.type.replace("add", "").toLowerCase()}.`);
  }
}

/**
 * Pending AI generation per webview panel, so a new request or a closed panel
 * cancels the previous one instead of letting it keep consuming quota.
 * @type {WeakMap<import('vscode').WebviewPanel, AbortController>}
 */
const _aiGenerations = new WeakMap();

/**
 * Pending AI explanation per webview panel; a new request or a cancel aborts the previous one.
 * @type {WeakMap<import('vscode').WebviewPanel, AbortController>}
 */
const _aiExplanations = new WeakMap();

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
 * Handles the 'saveWorkspaceCommandsData' message from the webview.
 * Normalizes and persists the "Current Workspace" pseudo-category content
 * (groups + commands) to the workspace-local unified data file, stamping
 * `runBox.workspaceID` automatically (creating it on first write if needed).
 *
 * Payload shape: { groups: object[], commands: object[], activeFsPath: string|null }
 * extension.js injects activeFsPath (from context.workspaceState) before calling this
 * handler — it is never sent directly by the webview.
 *
 * @param {import('vscode').WebviewPanel} panel
 * @param {{ groups: object[], commands: object[], activeFsPath: string|null }} payload
 * @param {function} postState - Callback to refresh webview state
 */
async function handleSaveWorkspaceCommandsData(panel, payload, postState) {
  try {
    const activeFsPath = payload && typeof payload.activeFsPath === "string" && payload.activeFsPath ? payload.activeFsPath : null;

    const wasCreated = await writeWorkspaceCommandsSection({ groups: payload && payload.groups, commands: payload && payload.commands }, activeFsPath);
    if (wasCreated) {
      notifyLocalDataFileCreated();
    }

    await postState(panel);
    await panel.webview.postMessage({
      type: "saveWorkspaceCommandsDataResult",
      payload: { success: true },
    });
  } catch (error) {
    await panel.webview.postMessage({
      type: "saveWorkspaceCommandsDataResult",
      payload: {
        success: false,
        message: error instanceof Error ? error.message : "Unknown error",
      },
    });
  }
}

/**
 * Handles the 'applyOperation' message from the webview.
 * Applies a single surgical mutation (add/rename/delete one category, group, or
 * command, or reorder) instead of overwriting an entire section with a full
 * snapshot from the webview's in-memory state.
 *
 * The mutation is applied to whatever is actually on disk at write time
 * (read-modify-write, serialized per file path), so changes written moments
 * earlier by another VS Code window are preserved rather than being silently
 * erased by this operation.
 *
 * Payload shape: { scope: "global" | "workspace", op: object, activeFsPath: string|null }
 * See applyCommandsDataOperation() / applyWorkspaceCommandsOperation() in
 * lib/storage.js for the supported `op.type` values.
 *
 * @param {import('vscode').WebviewPanel} panel
 * @param {{ scope: "global"|"workspace", op: object, activeFsPath: string|null }} payload
 * @param {function} postState - Callback to refresh webview state
 */
async function handleApplyOperation(panel, payload, postState) {
  try {
    const scope = payload && payload.scope;
    const op = payload && payload.op;

    if (!op || typeof op.type !== "string") {
      throw new Error("A valid operation is required.");
    }

    assertNewEntityId(op);

    let conflict = null;

    if (scope === "workspace") {
      const activeFsPath = payload && typeof payload.activeFsPath === "string" && payload.activeFsPath ? payload.activeFsPath : null;
      const result = await applyWorkspaceCommandsOperation(op, activeFsPath);
      if (result.wasCreated) {
        notifyLocalDataFileCreated();
      }
      conflict = result.conflict;
    } else if (scope === "global") {
      const result = await applyCommandsDataOperation(op);
      conflict = result.conflict;
    } else {
      throw new Error('Operation scope must be "global" or "workspace".');
    }

    // An edit-edit conflict (another window changed this exact command between
    // this window's edit form opening and this save) intentionally does NOT
    // write anything. Do not call postState() here either — that would refresh
    // this window's state.data/state.workspaceCommands mid-edit while the user
    // still has the conflict dialog open with a "keep my changes" choice
    // pending; the webview refreshes explicitly once the user resolves it.
    if (conflict) {
      await panel.webview.postMessage({
        type: "applyOperationResult",
        payload: { success: false, conflict: true, currentCommand: conflict.currentCommand },
      });
      return;
    }

    await postState(panel);
    await panel.webview.postMessage({
      type: "applyOperationResult",
      payload: { success: true },
    });
  } catch (error) {
    await panel.webview.postMessage({
      type: "applyOperationResult",
      payload: {
        success: false,
        message: error instanceof Error ? error.message : "Unknown error",
      },
    });
  }
}

/**
 * Handles the 'clearRecent' message from the webview.
 * Clears the Run/Use history (lastRunAt/runCount) of every command in both the
 * global commands file and the "Current Workspace" section of the
 * workspace-local data file, each via its read-modify-write "clearRecent"
 * operation. The workspace file is only written when it actually holds run
 * history, so clearing never creates that file needlessly.
 * Replies with `applyOperationResult`, like a single surgical operation.
 * @param {import('vscode').WebviewPanel} panel
 * @param {{ activeFsPath?: string|null }} payload
 * @param {function} postState - Callback to refresh webview state
 */
async function handleClearRecent(panel, payload, postState) {
  try {
    const activeFsPath = payload && typeof payload.activeFsPath === "string" && payload.activeFsPath ? payload.activeFsPath : null;
    const clearOp = { type: "clearRecent" };

    await applyCommandsDataOperation(clearOp);

    const workspaceSection = await readWorkspaceCommandsSection(activeFsPath);
    const hasWorkspaceHistory = (workspaceSection.commands || []).some(function (c) {
      return c.lastRunAt || c.runCount;
    });
    if (hasWorkspaceHistory) {
      await applyWorkspaceCommandsOperation(clearOp, activeFsPath);
    }

    await postState(panel);
    await panel.webview.postMessage({
      type: "applyOperationResult",
      payload: { success: true },
    });
  } catch (error) {
    await panel.webview.postMessage({
      type: "applyOperationResult",
      payload: {
        success: false,
        message: error instanceof Error ? error.message : "Unknown error",
      },
    });
  }
}

/**
 * Handles the 'saveCommandMove' message from the webview.
 * Moves a single command between a regular category (global commands.json) and the
 * "Current Workspace" pseudo-category (workspace-local runbox.data.json) using
 * surgical per-item operations against the freshest on-disk copy of each file —
 * never a full-section snapshot overwrite. Deleting from the source and adding
 * to the destination are two separate file writes (they are physically
 * different files), but each individual write is itself race-safe.
 *
 * Payload shape: { command: object, direction: "toWorkspace"|"toGlobal", activeFsPath: string|null }
 * @param {import('vscode').WebviewPanel} panel
 * @param {{ command: object, direction: "toWorkspace"|"toGlobal", activeFsPath: string|null }} payload
 * @param {function} postState - Callback to refresh webview state
 */
async function handleSaveCommandMove(panel, payload, postState) {
  try {
    const activeFsPath = payload && typeof payload.activeFsPath === "string" && payload.activeFsPath ? payload.activeFsPath : null;
    const direction = payload && payload.direction;
    const command = payload && payload.command;

    if (!command || typeof command.id !== "string" || !command.id) {
      throw new Error("A valid command is required to move.");
    }

    if (direction === "toWorkspace") {
      await applyCommandsDataOperation({ type: "deleteCommand", commandId: command.id });
      const workspaceCommand = { ...command };
      delete workspaceCommand.categoryId;
      const { wasCreated } = await applyWorkspaceCommandsOperation({ type: "addCommand", command: workspaceCommand }, activeFsPath);
      if (wasCreated) {
        notifyLocalDataFileCreated();
      }
    } else if (direction === "toGlobal") {
      await applyWorkspaceCommandsOperation({ type: "deleteCommand", commandId: command.id }, activeFsPath);
      await applyCommandsDataOperation({ type: "addCommand", command });
    } else {
      throw new Error('direction must be "toWorkspace" or "toGlobal".');
    }

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
 * Replaces ONE command's Local (workspace) and Global variable values, each in
 * its own file, merged into the freshest on-disk copy so values another VS Code
 * window saved for OTHER commands are never erased.
 *
 * Payload shape: { commandId: string, local: object, global: object, activeFsPath: string|null }
 * The webview sends { commandId, local, global } via buildCommandVariablesPayload()
 * in media/utils.js, where local/global are that command's { [varName]: value } maps
 * (an empty map deletes the command's entry in that scope). extension.js injects
 * activeFsPath (from context.workspaceState) before calling this handler — it is
 * never sent directly by the webview.
 *
 * @param {import('vscode').WebviewPanel} panel
 * @param {{ commandId: string, local: object, global: object, activeFsPath: string|null }} payload
 */
async function handleSaveCommandVariables(panel, payload) {
  try {
    const commandId = payload && typeof payload.commandId === "string" ? payload.commandId : "";
    if (!commandId) {
      throw new Error("A command ID is required to save variables.");
    }
    const activeFsPath = payload && typeof payload.activeFsPath === "string" && payload.activeFsPath ? payload.activeFsPath : null;
    const localVars = payload.local && typeof payload.local === "object" ? payload.local : {};
    const globalVars = payload.global && typeof payload.global === "object" ? payload.global : {};

    const wasCreated = await setWorkspaceCommandVariables(commandId, localVars, activeFsPath);
    if (wasCreated) {
      notifyLocalDataFileCreated();
    }
    await setGlobalCommandVariables(commandId, globalVars);

    // Both sections are read back fresh from disk, so they also include values
    // other windows saved for other commands.
    const commandVariables = await readWorkspaceVariables(activeFsPath);
    const globalCommandVariables = await readGlobalVariables();

    await panel.webview.postMessage({
      type: "saveVariablesResult",
      payload: {
        success: true,
        commandId,
        commandVariables,
        globalCommandVariables,
      },
    });
  } catch (error) {
    await panel.webview.postMessage({
      type: "saveVariablesResult",
      payload: {
        success: false,
        commandId: payload && typeof payload.commandId === "string" ? payload.commandId : "",
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
 * @param {{ action: string, commandId?: string, resolvedCommand: string, shellPath?: string, shellName?: string }} payload
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
    const activeFsPath = payload && typeof payload.activeFsPath === "string" && payload.activeFsPath ? payload.activeFsPath : null;

    if (action === "copy") {
      await vscode.env.clipboard.writeText(resolvedCommand);
    }

    if (action === "run" || action === "use") {
      // Variables are already persisted to disk by handleSaveCommandVariables,
      // which the webview calls whenever the user confirms values in the
      // "Enter Variable Values" modal. If that modal never opened, no variable
      // value could have changed in this session, so no write is needed here
      // either.

      // Apply auto variables to the command using the execution-time folder
      const autoVarsSettings = await readAutoVariablesSettings();
      const workspaceFolder = activeFsPath || getFirstWorkspaceFolderPath();
      const finalCommand = resolveAutoVariables(resolvedCommand, { workspaceFolder }, autoVarsSettings);
      // Pass cwd so the terminal opens in the selected workspace folder
      const terminal = getOrCreateTerminal(shellPath || undefined, shellName || undefined, activeFsPath || undefined);
      terminal.show(false);
      terminal.sendText(finalCommand, action === "run");

      // Update lastRunAt and runCount for run/use actions. The command may live
      // in the global commands file or in the "Current Workspace" section of the
      // workspace-local data file; its owner is looked up first so the workspace
      // data file is never created just to record a run of a global command.
      if (commandId) {
        const recordOp = { type: "recordRun", commandId, ranAt: new Date().toISOString() };
        const globalData = await readCommandsData();
        const hasCommand = function (c) {
          return c.id === commandId;
        };
        if ((globalData.commands || []).some(hasCommand)) {
          await applyCommandsDataOperation(recordOp);
        } else {
          const workspaceSection = await readWorkspaceCommandsSection(activeFsPath);
          if ((workspaceSection.commands || []).some(hasCommand)) {
            await applyWorkspaceCommandsOperation(recordOp, activeFsPath);
          }
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
 * Opens a native "Open File" dialog restricted to selecting a single file, then sends the
 * selected file's full path back to the webview. Used by the "Enter Variable Values" modal
 * (Ctrl/Cmd+Shift+O shortcut) to let the user pick a file path instead of typing it manually.
 *
 * Remembers the folder of the last picked file in `context.workspaceState` (under the
 * "lastPickFileDir" key) and reopens the dialog there on the next use, instead of letting
 * VS Code default to the active editor's folder. `workspaceState` persists across restarts
 * and is scoped to a single VS Code window, so each open window keeps its own independent
 * "last folder" memory.
 * @param {import('vscode').WebviewPanel} panel
 * @param {{ variableName?: string }} payload - `variableName` is echoed back unchanged so the
 *   webview can target the input that triggered the request; this handler does not use it.
 * @param {import('vscode').ExtensionContext} context
 */
async function handlePickFile(panel, payload, context) {
  const variableName = payload && typeof payload.variableName === "string" ? payload.variableName : "";
  try {
    const lastDir = context.workspaceState.get("lastPickFileDir");
    const uris = await vscode.window.showOpenDialog({
      canSelectMany: false,
      canSelectFiles: true,
      canSelectFolders: false,
      openLabel: "Select",
      defaultUri: lastDir ? vscode.Uri.file(lastDir) : undefined,
    });

    if (!uris || uris.length === 0) {
      return;
    }

    await context.workspaceState.update("lastPickFileDir", path.dirname(uris[0].fsPath));

    await panel.webview.postMessage({
      type: "pickFileResult",
      payload: { success: true, variableName, fsPath: uris[0].fsPath },
    });
  } catch (error) {
    await panel.webview.postMessage({
      type: "pickFileResult",
      payload: {
        success: false,
        variableName,
        message: error instanceof Error ? error.message : "Unknown error",
      },
    });
  }
}

/**
 * Shows a one-time informational notice when the workspace-local unified data
 * file is created for the first time. Includes an "Open Settings" action that
 * jumps directly to the localWorkspaceFilesPath setting. Not awaited by callers
 * so it never blocks the save flow or delays the response sent back to the webview.
 */
async function notifyLocalDataFileCreated() {
  const configuredPath = vscode.workspace.getConfiguration("runBox").get("localWorkspaceFilesPath") || "";
  const relativeDir = normalizeLocalWorkspaceDir(configuredPath);

  const choice = await vscode.window.showInformationMessage(
    `This workspace now has its own data file at "${relativeDir}/runbox.data.json". You can change its location in settings anytime.`,
    "Open Settings"
  );

  if (choice === "Open Settings") {
    await vscode.commands.executeCommand("workbench.action.openSettings", "runBox.localWorkspaceFilesPath");
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

    await writeDataFile(GLOBAL_DATA_FILE, {});
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
        detail: "This file is created when you save local variables or favorites for a command in the current workspace.",
        modal: false,
      },
      "Create File"
    );

    if (choice !== "Create File") {
      return;
    }

    await writeDataFile(filePath, {});
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
  const providerName = vscode.workspace.getConfiguration("runBox").get("aiProvider") || "gemini";

  const keyStatus = {};
  for (const p of Object.keys(AI_PROVIDERS)) {
    const key = await context.secrets.get(`${p}_key`);
    keyStatus[p] = Boolean(key && key.trim());
  }

  const modelId = vscode.workspace.getConfiguration("runBox").get("aiModel") || "";

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

    await vscode.workspace.getConfiguration("runBox").update("aiProvider", providerName, vscode.ConfigurationTarget.Global);

    if (modelId) {
      await vscode.workspace.getConfiguration("runBox").update("aiModel", modelId, vscode.ConfigurationTarget.Global);
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
 * VS Code settings. The stored modelId is trusted as-is (it may be a model
 * fetched dynamically from the provider's API and not present in the static
 * `AI_PROVIDERS[...].models` list). Falls back to the provider's
 * defaultModelId only when no modelId has been stored at all.
 * @returns {{ providerName: string, modelId: string, providerCfg: object|undefined }}
 */
function resolveAiProviderAndModel() {
  const providerName = vscode.workspace.getConfiguration("runBox").get("aiProvider") || "gemini";
  const storedModelId = vscode.workspace.getConfiguration("runBox").get("aiModel") || "";

  const providerCfg = AI_PROVIDERS[providerName];
  const modelId = storedModelId || (providerCfg && providerCfg.defaultModelId) || "";

  return { providerName, modelId, providerCfg };
}

/**
 * Runs AI generation and returns results back to the webview.
 * Posts `aiGenerateProgress` during full-mode generation and one final
 * `aiGenerateResult`. A newer request or handleAiCancelGenerate() aborts the
 * pending one; an aborted request posts nothing.
 * @param {import('vscode').WebviewPanel} panel
 * @param {import('vscode').ExtensionContext} context
 * @param {{ mode: 'full'|'single', prompt: string, categoryId?: string, groupId?: string, shellName?: string, shellPath?: string }} payload
 */
async function handleAiGenerate(panel, context, payload) {
  handleAiCancelGenerate(panel);
  const controller = new AbortController();
  _aiGenerations.set(panel, controller);

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

    if (mode === "single" && !categoryId) {
      throw new Error("A target category is required.");
    }

    const language = resolveAiOutputLanguage(vscode.workspace.getConfiguration("runBox").get("aiGenerateLanguage"));

    const result = await generateWithAI({
      providerName,
      modelId: modelId || undefined,
      apiKey: apiKey.trim(),
      prompt,
      mode,
      language,
      categoryId,
      groupId,
      shellName,
      shellPath,
      signal: controller.signal,
      onProgress: function (progress) {
        if (!controller.signal.aborted) {
          panel.webview.postMessage({ type: "aiGenerateProgress", payload: progress }).then(undefined, function () {});
        }
      },
    });

    if (controller.signal.aborted) {
      return;
    }
    await panel.webview.postMessage({
      type: "aiGenerateResult",
      payload: { success: true, result },
    });
  } catch (error) {
    if (controller.signal.aborted) {
      return;
    }
    await panel.webview.postMessage({
      type: "aiGenerateResult",
      payload: { success: false, message: extractAiErrorMessage(error) },
    });
  } finally {
    if (_aiGenerations.get(panel) === controller) {
      _aiGenerations.delete(panel);
    }
  }
}

/**
 * Cancels the panel's in-flight AI generation, if any. Called when the user
 * cancels the loading overlay and when the panel is disposed.
 * @param {import('vscode').WebviewPanel} panel
 */
function handleAiCancelGenerate(panel) {
  const controller = _aiGenerations.get(panel);
  if (controller) {
    controller.abort();
    _aiGenerations.delete(panel);
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
 * Inserts selected AI-generated commands into the "Current Workspace" pseudo-category
 * (the workspace-local unified data file's "workspaceCommands" section). Unlike
 * handleAiInsert, there is no category to merge — only commands (and, for "full" mode,
 * a new group set) are merged into the existing workspace-local groups/commands.
 * @param {import('vscode').WebviewPanel} panel
 * @param {{ mode: 'full'|'single', groups?: object[], commands: object[], activeFsPath?: string|null }} payload
 * @param {function} postState - Callback to refresh webview state
 */
async function handleAiInsertWorkspace(panel, payload, postState) {
  try {
    const selectedCommands = Array.isArray(payload && payload.commands) ? payload.commands : [];

    if (!selectedCommands.length) {
      throw new Error("No commands selected for insertion.");
    }

    const activeFsPath = payload && typeof payload.activeFsPath === "string" && payload.activeFsPath ? payload.activeFsPath : null;

    const section = await readWorkspaceCommandsSection(activeFsPath);

    // Merge new groups (skip duplicates by ID)
    const existingGroupIds = new Set(
      section.groups.map(function (g) {
        return g.id;
      })
    );
    for (const group of (payload && payload.groups) || []) {
      if (!existingGroupIds.has(group.id)) {
        section.groups.push(group);
        existingGroupIds.add(group.id);
      }
    }

    // Merge selected commands (skip duplicates by ID)
    const existingCommandIds = new Set(
      section.commands.map(function (c) {
        return c.id;
      })
    );
    for (const cmd of selectedCommands) {
      if (!existingCommandIds.has(cmd.id)) {
        section.commands.push(cmd);
        existingCommandIds.add(cmd.id);
      }
    }

    await writeWorkspaceCommandsSection({ groups: section.groups, commands: section.commands }, activeFsPath);

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
 * Adds one command to, or removes it from, the global and/or local favorites
 * and posts back the updated lists read fresh from disk.
 * The webview sends only the per-command change (never a whole list), so the
 * storage layer can merge it into the freshest on-disk copy without erasing
 * favorites another VS Code window changed for other commands.
 * @param {import('vscode').WebviewPanel} panel
 * @param {{ commandId: string, global?: boolean, local?: boolean, activeFsPath?: string|null }} payload
 */
async function handleSaveFavorites(panel, payload) {
  try {
    const activeFsPath = payload && typeof payload.activeFsPath === "string" && payload.activeFsPath ? payload.activeFsPath : null;
    const commandId = payload && typeof payload.commandId === "string" ? payload.commandId : "";
    if (!commandId) {
      throw new Error("A command ID is required to save favorites.");
    }
    if (typeof payload.global === "boolean") {
      await setGlobalFavorite(commandId, payload.global);
    }
    if (typeof payload.local === "boolean") {
      const wasCreated = await setWorkspaceFavorite(commandId, payload.local, activeFsPath);
      if (wasCreated) {
        notifyLocalDataFileCreated();
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
  const anthropicMessage = error && error.error && error.error.error && typeof error.error.error.message === "string" ? error.error.error.message.trim() : "";

  if (anthropicMessage) {
    return anthropicMessage;
  }

  // OpenAI: err.error is the inner error object → err.error.message
  const openaiMessage = error && error.error && typeof error.error.message === "string" ? error.error.message.trim() : "";

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
 * Returns a Markdown-formatted string and sends it back as `aiExplainResult`,
 * tagged with the request's `requestId`. A newer request or handleAiCancelExplain()
 * aborts the pending one; an aborted request posts nothing.
 * @param {import('vscode').WebviewPanel} panel
 * @param {import('vscode').ExtensionContext} context
 * @param {{ command: string, requestId?: string, language?: string }} payload
 */
async function handleAiExplain(panel, context, payload) {
  handleAiCancelExplain(panel);
  const controller = new AbortController();
  _aiExplanations.set(panel, controller);
  const requestId = payload && typeof payload.requestId === "string" ? payload.requestId : "";

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

    // A per-request language (chosen in the webview) overrides the setting; both
    // are validated against the closed language list before reaching the prompt.
    const requestedLanguage = payload && typeof payload.language === "string" ? payload.language : undefined;
    const language = resolveAiOutputLanguage(requestedLanguage || vscode.workspace.getConfiguration("runBox").get("aiExplainLanguage"));

    const markdown = await explainWithAI({
      providerName,
      modelId: modelId || undefined,
      apiKey: apiKey.trim(),
      command,
      language,
      signal: controller.signal,
    });

    if (controller.signal.aborted) {
      return;
    }
    await panel.webview.postMessage({
      type: "aiExplainResult",
      payload: { success: true, markdown, requestId },
    });
  } catch (error) {
    if (controller.signal.aborted) {
      return;
    }
    await panel.webview.postMessage({
      type: "aiExplainResult",
      payload: { success: false, message: extractAiErrorMessage(error), requestId },
    });
  } finally {
    if (_aiExplanations.get(panel) === controller) {
      _aiExplanations.delete(panel);
    }
  }
}

/**
 * Cancels the panel's in-flight AI explanation, if any. Called when the user
 * closes the explain modal and when the panel is disposed.
 * @param {import('vscode').WebviewPanel} panel
 */
function handleAiCancelExplain(panel) {
  const controller = _aiExplanations.get(panel);
  if (controller) {
    controller.abort();
    _aiExplanations.delete(panel);
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
  handleSaveWorkspaceCommandsData,
  handleApplyOperation,
  handleClearRecent,
  handleSaveCommandMove,
  handleSaveCommandVariables,
  handlePerformAction,
  handleOpenExternalUrl,
  handlePickFile,
  openGlobalCommandsFile,
  openGlobalDataFile,
  openLocalDataFile,
  handleAiGetSettings,
  handleAiSaveSettings,
  handleAiGenerate,
  handleAiCancelGenerate,
  handleAiCancelExplain,
  handleAiInsert,
  handleAiInsertWorkspace,
  handleSaveAutoVariablesSettings,
  handleSaveFavorites,
  handleAiListModels,
  handleAiRefreshAllModels,
  handleAiDeleteKey,
  handleAiExplain,
  handleAiCheckConnection,
  handleAiCheckRateLimits,
};
