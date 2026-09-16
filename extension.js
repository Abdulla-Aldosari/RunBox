/*-------------------------------------------------
 * RunBox — VS Code Extension
 * Copyright (c) 2026 Abdulla Aldosari
 * Licensed under the Apache License, Version 2.0.
 * See LICENSE in the project root for details.
 *-------------------------------------------------*/

const vscode = require("vscode");
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const {
  readCommandsData,
  readWorkspaceVariables,
  readGlobalVariables,

  readAutoVariablesSettings,
  readGlobalFavorites,
  readWorkspaceFavorites,
  getAllWorkspaceFolders,
  resolveActiveWorkspaceFolder,
  GLOBAL_COMMANDS_FILE,
  GLOBAL_DIR,
  readWorkspaceId,
  readWorkspaceCommandsSection,
} = require("./lib/storage");
const { getTerminalProfiles } = require("./lib/terminal");
const { buildAutoVariablesPayload } = require("./lib/auto-variables");
const H = require("./lib/handlers");
const { initLogger } = require("./lib/logger");

/**
 * Called by VS Code when the extension is activated.
 * Registers the 'runBox.openPanel' command and creates the webview panel
 * along with all message handlers for communication between the extension and the UI.
 * Also creates the status bar item that opens the panel on click.
 * @param {import('vscode').ExtensionContext} context
 */
function activate(context) {
  /** @type {import('vscode').WebviewPanel | null} Active webview panel; null when not open. */
  let panel = null;

  // Output channel used by the logger to write structured JSON logs visible in the Output panel.
  const loggerOutputChannel = vscode.window.createOutputChannel("RunBox", "json");
  context.subscriptions.push(loggerOutputChannel);
  initLogger(loggerOutputChannel);

  // ─── postState ────────────────────────────────────────────────────────────────
  /**
   * Collects all extension state (commands, variables, terminal profiles, favorites,
   * auto-variables) and sends it to the webview as a single "state" message.
   * Defined as a closure inside activate() so it can access `context.workspaceState`
   * for multi-root folder persistence. All handlers receive and call postState(panel).
   * @param {import('vscode').WebviewPanel} targetPanel
   */
  async function collectAndPostState(targetPanel) {
    const savedFsPath = context.workspaceState.get("activeWorkspaceFolder") || null;
    const workspaceFolder = resolveActiveWorkspaceFolder(savedFsPath);
    const workspaceFolders = getAllWorkspaceFolders();

    // Sync workspaceState: if the resolved folder differs from what was saved
    // (e.g. saved folder was removed from workspace), update to the resolved value.
    if (workspaceFolder !== savedFsPath) {
      await context.workspaceState.update("activeWorkspaceFolder", workspaceFolder);
    }

    const data = await readCommandsData();
    const commandVariables = await readWorkspaceVariables(workspaceFolder);
    const globalCommandVariables = await readGlobalVariables();

    const terminalProfiles = getTerminalProfiles();
    const autoVariablesSettings = await readAutoVariablesSettings();
    const autoVariables = buildAutoVariablesPayload({ workspaceFolder }, autoVariablesSettings);
    const globalFavorites = await readGlobalFavorites();
    const localFavorites = await readWorkspaceFavorites(workspaceFolder);
    const workspaceId = readWorkspaceId(workspaceFolder);
    const workspaceCommands = await readWorkspaceCommandsSection(workspaceFolder);

    await targetPanel.webview.postMessage({
      type: "state",
      payload: {
        data,
        globalCommandsFile: GLOBAL_COMMANDS_FILE,
        workspaceFolder,
        workspaceFolders,
        commandVariables,
        globalCommandVariables,
        terminalProfiles,
        autoVariables,
        autoVariablesSettings,
        globalFavorites,
        localFavorites,
        workspaceId,
        workspaceCommands,
      },
    });
  }

  // postState() can be triggered from multiple independent, unordered sources in
  // quick succession for the same logical change: the message handler's own
  // explicit call after it finishes writing, PLUS one or more file-watcher
  // callbacks fired by each individual atomic write (rename) that handler
  // performed internally (e.g. handleSaveCommandMove writes two separate files).
  // Because each of these calls independently does its own async disk reads
  // before posting to the webview, running them concurrently is a genuine race:
  // whichever happens to finish its reads LAST "wins" and becomes the state the
  // webview displays — even if it started before a call that reflects more
  // complete/newer data. This serializes+coalesces all postState() calls into a
  // single in-flight collectAndPostState() at a time, with at most one more
  // pending re-run queued up (never a growing backlog), so state is always
  // read fresh once whatever triggered the call has actually settled, and two
  // calls can never interleave their disk reads.
  let postStateInFlight = null;
  let postStateRerunQueued = false;

  async function postState(targetPanel) {
    if (postStateInFlight) {
      postStateRerunQueued = true;
      return postStateInFlight;
    }

    postStateInFlight = (async function run() {
      try {
        await collectAndPostState(targetPanel);
      } finally {
        if (postStateRerunQueued) {
          postStateRerunQueued = false;
          await collectAndPostState(targetPanel);
        }
        postStateInFlight = null;
      }
    })();

    return postStateInFlight;
  }
  // ─────────────────────────────────────────────────────────────────────────────

  // ─── Cross-Window File Watchers ────────────────────────────────────────────────
  // Watches the shared JSON files this extension persists to disk so that changes
  // written by ANOTHER VS Code window (a different project also running RunBox, or
  // this same file edited/reverted externally) are reflected in this window's panel
  // automatically, instead of this window silently working on stale in-memory data
  // until its own next save overwrites the other window's changes.
  //
  // Safe to call postState() unconditionally on every change event: state.data /
  // state.workspaceCommands are read-only mirrors of disk content, while any
  // in-progress "Add/Edit Command" form edit lives in the isolated
  // commandFormBuffer working copy (media/modals/command-form.js) that is never
  // overwritten by hydrateState() — so an external change never discards unsaved
  // keystrokes in an open edit form.
  // IMPORTANT: a plain absolute path string as globPattern falls back to Node's
  // raw fs.watch on that single path since it lives outside any workspace
  // folder, which tracks the file by its original inode. atomicWriteFile()
  // (lib/storage.js) replaces the file via a temp-file + rename on every
  // write, giving it a brand new inode each time — after the very first write,
  // a plain-path watcher silently stops firing for all subsequent changes.
  // Wrapping the path in a RelativePattern (rooted at its containing
  // directory) forces VS Code to use its directory-level watch service
  // instead, which survives rename-based atomic writes indefinitely.
  const globalCommandsWatcher = vscode.workspace.createFileSystemWatcher(
    new vscode.RelativePattern(vscode.Uri.file(GLOBAL_DIR), "commands.json")
  );
  const refreshOnExternalChange = function () {
    if (panel) {
      postState(panel);
    }
  };
  globalCommandsWatcher.onDidChange(refreshOnExternalChange);
  globalCommandsWatcher.onDidCreate(refreshOnExternalChange);
  globalCommandsWatcher.onDidDelete(refreshOnExternalChange);
  context.subscriptions.push(globalCommandsWatcher);

  // Workspace-local runbox.data.json lives under each workspace folder's
  // .vscode/ (or the configured runBox.localWorkspaceFilesPath). Re-created
  // whenever the workspace folder set changes, since the watched path pattern
  // depends on the folder list.
  /** @type {import('vscode').FileSystemWatcher[]} */
  let workspaceDataWatchers = [];

  function rebuildWorkspaceDataWatcher() {
    workspaceDataWatchers.forEach(function (watcher) {
      watcher.dispose();
    });
    workspaceDataWatchers = [];

    if (!vscode.workspace.workspaceFolders || vscode.workspace.workspaceFolders.length === 0) {
      return;
    }
    // A single glob pattern can't span multiple workspace-folder roots at once —
    // createFileSystemWatcher accepts one RelativePattern base per call — so a
    // dedicated watcher is created per open folder in a multi-root workspace.
    workspaceDataWatchers = vscode.workspace.workspaceFolders.map(function (folder) {
      const configuredPath =
        vscode.workspace.getConfiguration("runBox", folder.uri).get("localWorkspaceFilesPath") || "";
      const relativeDir = configuredPath.trim() || ".vscode";
      const watcher = vscode.workspace.createFileSystemWatcher(
        new vscode.RelativePattern(folder, `${relativeDir}/runbox.data.json`)
      );
      watcher.onDidChange(refreshOnExternalChange);
      watcher.onDidCreate(refreshOnExternalChange);
      watcher.onDidDelete(refreshOnExternalChange);
      return watcher;
    });
  }

  rebuildWorkspaceDataWatcher();
  context.subscriptions.push(
    vscode.workspace.onDidChangeWorkspaceFolders(rebuildWorkspaceDataWatcher),
    new vscode.Disposable(function () {
      workspaceDataWatchers.forEach(function (watcher) {
        watcher.dispose();
      });
    })
  );
  // ─────────────────────────────────────────────────────────────────────────────

  // Registers the primary command that opens (or focuses) the RunBox panel.
  const openPanelCommand = vscode.commands.registerCommand("runBox.openPanel", async function () {
    // If the panel already exists, bring it to focus and refresh its state instead
    // of creating a duplicate panel.
    if (panel) {
      panel.reveal(vscode.ViewColumn.One);
      await postState(panel);
      return;
    }

    panel = vscode.window.createWebviewPanel("runBoxPanel", "RunBox", vscode.ViewColumn.One, {
      enableScripts: true,
      retainContextWhenHidden: true,
    });

    panel.iconPath = vscode.Uri.joinPath(context.extensionUri, "media", "icon.png");

    // isDev is true only when running in Development mode AND the dev tools entry point
    // exists on disk. Both conditions must be met to avoid injecting dev scripts in CI
    // or in packaged builds where the media/dev/ folder is excluded via .vscodeignore.
    const isDevelopmentMode = context.extensionMode === vscode.ExtensionMode.Development;
    const hasDevTools = fs.existsSync(path.join(context.extensionPath, "media", "dev", "index.js"));
    const isDev = isDevelopmentMode && hasDevTools;

    // ─── Dev Tools Modules (Developer Only) ──────────────────────────────────────
    // This section is exclusively for development and testing purposes.
    // It dynamically loads developer UI panels (tools) from media/dev/modules/.
    // Each tool file self-registers into window.devToolsModules[] and appears
    // automatically as a tab inside the Dev Tools overlay — no manual changes needed here.
    // These files are never shipped in production (.vscodeignore excludes media/dev/**).
    let devModuleFiles = [];
    if (isDev) {
      const modulesDir = path.join(context.extensionPath, "media", "dev", "modules");
      if (fs.existsSync(modulesDir)) {
        devModuleFiles = fs
          .readdirSync(modulesDir)
          .filter(function (f) {
            return f.endsWith(".js");
          })
          .sort()
          .map(function (f) {
            return ["media", "dev", "modules", f];
          });
      }
    }
    // ─────────────────────────────────────────────────────────────────────────────

    panel.webview.html = getWebviewHtml(panel.webview, context.extensionUri, isDev, devModuleFiles);

    panel.webview.onDidReceiveMessage(
      async function (message) {
        // Guard: ignore malformed messages that lack a string type.
        if (!message || typeof message.type !== "string") {
          return;
        }

        // Both "ready" (initial DOM load) and "requestState" (explicit refresh request)
        // trigger the same full state push to the webview.
        if (message.type === "ready" || message.type === "requestState") {
          await postState(panel);
          return;
        }

        // Persists the full commands JSON to the global commands file.
        if (message.type === "saveData") {
          await H.handleSaveCommandsData(panel, message.payload, postState);
          return;
        }

        // Persists the "Current Workspace" pseudo-category groups/commands to the
        // active folder's .vscode/ directory (runbox.data.json → workspaceCommands).
        if (message.type === "saveWorkspaceCommandsData") {
          // Inject activeFsPath so workspace commands are written to the correct .vscode/ folder.
          const activeFsPath = context.workspaceState.get("activeWorkspaceFolder") || null;
          await H.handleSaveWorkspaceCommandsData(
            panel,
            Object.assign({}, message.payload, { activeFsPath }),
            postState
          );
          return;
        }

        // Applies a single surgical operation (add/rename/delete one category, group,
        // or command, or reorder) to either the global commands.json or the
        // workspace-local "Current Workspace" section, read-modify-write against
        // the freshest on-disk copy — safe against multi-window data loss, unlike
        // saveData/saveWorkspaceCommandsData which replace an entire section.
        if (message.type === "applyOperation") {
          const activeFsPath = context.workspaceState.get("activeWorkspaceFolder") || null;
          await H.handleApplyOperation(panel, Object.assign({}, message.payload, { activeFsPath }), postState);
          return;
        }

        // Moves a single command between a regular category (global commands.json)
        // and the "Current Workspace" pseudo-category (workspace-local
        // runbox.data.json) via two surgical per-file operations, read-modify-write
        // against the freshest on-disk copy of each file — safe against multi-window
        // data loss on both sides of the move.
        if (message.type === "saveCommandMove") {
          const activeFsPath = context.workspaceState.get("activeWorkspaceFolder") || null;
          await H.handleSaveCommandMove(panel, Object.assign({}, message.payload, { activeFsPath }), postState);
          return;
        }

        // Saves workspace-scoped command variables to the active folder's .vscode/ directory.
        if (message.type === "saveCommandVariables") {
          // Inject activeFsPath so variables are written to the correct .vscode/ folder.
          const activeFsPath = context.workspaceState.get("activeWorkspaceFolder") || null;
          await H.handleSaveCommandVariables(panel, Object.assign({}, message.payload, { activeFsPath }));
          return;
        }

        // Runs a command in the terminal using the folder and profile from the payload.
        if (message.type === "performAction") {
          // activeFsPath comes from the run-confirm folder dropdown in the webview payload.
          await H.handlePerformAction(panel, message.payload, postState);
          return;
        }

        // Opens the global commands JSON file in the VS Code editor.
        if (message.type === "openCommandsFile") {
          await H.openGlobalCommandsFile();
          return;
        }

        // Opens the global unified data file in the VS Code editor.
        if (message.type === "openGlobalDataFile") {
          await H.openGlobalDataFile();
          return;
        }

        // Opens the local unified data file for the currently active workspace folder.
        if (message.type === "openLocalDataFile") {
          const activeFsPath = context.workspaceState.get("activeWorkspaceFolder") || null;
          await H.openLocalDataFile(activeFsPath);
          return;
        }

        // Opens an external URL in the user's default browser.
        if (message.type === "openExternalUrl") {
          await H.handleOpenExternalUrl(message.payload);
          return;
        }

        // Opens a native "Open File" dialog restricted to a single file selection and
        // sends the selected file's full path back to the webview. Remembers the last
        // picked folder per VS Code window via context.workspaceState.
        if (message.type === "pickFile") {
          await H.handlePickFile(panel, message.payload, context);
          return;
        }

        // Reads AI provider settings from secretStorage and sends them to the webview.
        if (message.type === "aiGetSettings") {
          await H.handleAiGetSettings(panel, context);
          return;
        }

        // Persists AI provider settings (API keys, selected model, etc.) to secretStorage.
        if (message.type === "aiSaveSettings") {
          await H.handleAiSaveSettings(panel, context, message.payload);
          return;
        }

        // Sends the user's prompt to the configured AI provider and streams the result back.
        if (message.type === "aiGenerate") {
          await H.handleAiGenerate(panel, context, message.payload);
          return;
        }

        // Inserts AI-generated commands into the commands data and refreshes the panel state.
        if (message.type === "aiInsert") {
          await H.handleAiInsert(panel, message.payload, postState);
          return;
        }

        // Inserts AI-generated commands into the "Current Workspace" pseudo-category.
        if (message.type === "aiInsertWorkspace") {
          const activeFsPath = context.workspaceState.get("activeWorkspaceFolder") || null;
          await H.handleAiInsertWorkspace(panel, Object.assign({}, message.payload, { activeFsPath }), postState);
          return;
        }

        // Persists auto-variables settings and refreshes the panel state.
        if (message.type === "saveAutoVariablesSettings") {
          await H.handleSaveAutoVariablesSettings(panel, message.payload, postState);
          return;
        }

        // Saves favorites for the active workspace folder to its .vscode/ directory.
        if (message.type === "saveFavorites") {
          // Inject activeFsPath so favorites are written to the correct .vscode/ folder.
          const activeFsPath = context.workspaceState.get("activeWorkspaceFolder") || null;
          await H.handleSaveFavorites(panel, Object.assign({}, message.payload, { activeFsPath }));
          return;
        }

        // Fetches the available models list for a specific AI provider.
        if (message.type === "aiListModels") {
          await H.handleAiListModels(panel, context, message.payload);
          return;
        }

        // Re-fetches the models list for all configured AI providers at once.
        if (message.type === "aiRefreshAllModels") {
          await H.handleAiRefreshAllModels(panel, context);
          return;
        }

        // Removes the stored API key for the specified AI provider from secretStorage.
        if (message.type === "aiDeleteKey") {
          await H.handleAiDeleteKey(panel, context, message.payload);
          return;
        }

        // Sends a command to the AI provider for explanation and streams the result back.
        if (message.type === "aiExplain") {
          await H.handleAiExplain(panel, context, message.payload);
          return;
        }

        // Verifies API key validity and connectivity for the given AI provider.
        if (message.type === "aiCheckConnection") {
          await H.handleAiCheckConnection(panel, context, message.payload);
          return;
        }

        // Retrieves rate limit information for the given AI provider, if supported.
        if (message.type === "aiCheckRateLimits") {
          await H.handleAiCheckRateLimits(panel, context, message.payload);
          return;
        }

        // User selected a different folder from the header dropdown.
        // Persist the choice in workspaceState and refresh the panel state.
        if (message.type === "setActiveWorkspaceFolder") {
          // fsPath is validated before persisting; an empty/invalid value is silently ignored
          // to avoid overwriting a valid saved folder with a bad payload.
          const fsPath = message.payload && typeof message.payload.fsPath === "string" ? message.payload.fsPath : null;
          if (fsPath) {
            await context.workspaceState.update("activeWorkspaceFolder", fsPath);
          }
          await postState(panel);
          return;
        }
      },
      null,
      context.subscriptions
    );

    // Reset the panel reference when the user closes it, allowing a new one to be created
    // on the next command invocation.
    panel.onDidDispose(function () {
      panel = null;
    });

    await postState(panel);
  });

  context.subscriptions.push(openPanelCommand);

  // Status bar item shown on the right side of the VS Code status bar.
  // Clicking it triggers runBox.openPanel to open or focus the panel.
  const statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
  statusBarItem.text = "$(terminal) RunBox";
  statusBarItem.tooltip = "Open RunBox";
  statusBarItem.command = "runBox.openPanel";
  statusBarItem.show();
  context.subscriptions.push(statusBarItem);
}

/**
 * Called by VS Code when the extension is deactivated.
 * No cleanup is required since VS Code handles subscription disposal automatically.
 */
function deactivate() {}

/**
 * Generates the full HTML content for the extension's webview panel.
 * Injects a CSP nonce for script security and loads all media scripts in dependency order.
 * @param {import('vscode').Webview} webview
 * @param {import('vscode').Uri} extensionUri
 * @param {boolean} [isDev=false] - Whether to inject dev tools scripts
 * @param {string[][]} [devModuleFiles=[]] - Path segments for each module file in media/dev/modules/
 * @returns {string} The HTML string to set on webview.html
 */
function getWebviewHtml(webview, extensionUri, isDev = false, devModuleFiles = []) {
  const styleUri = webview.asWebviewUri(vscode.Uri.joinPath(extensionUri, "media", "styles.css"));

  // 1. Foundation
  const stateUri = webview.asWebviewUri(vscode.Uri.joinPath(extensionUri, "media", "state.js"));
  const iconsUri = webview.asWebviewUri(vscode.Uri.joinPath(extensionUri, "media", "icons.js"));
  const utilsUri = webview.asWebviewUri(vscode.Uri.joinPath(extensionUri, "media", "utils.js"));

  // 1b. Markdown parser (utility — must load before ai-explain.js)
  const markdownParserUri = webview.asWebviewUri(vscode.Uri.joinPath(extensionUri, "media", "markdown-parser.js"));

  // 2. Modals
  const modalsRunConfirmUri = webview.asWebviewUri(
    vscode.Uri.joinPath(extensionUri, "media", "modals", "run-confirm.js")
  );
  const modalsCommandFormUri = webview.asWebviewUri(
    vscode.Uri.joinPath(extensionUri, "media", "modals", "command-form.js")
  );
  const modalsAiSettingsUri = webview.asWebviewUri(
    vscode.Uri.joinPath(extensionUri, "media", "modals", "ai-settings.js")
  );
  const modalsAiGenerateUri = webview.asWebviewUri(
    vscode.Uri.joinPath(extensionUri, "media", "modals", "ai-generate.js")
  );
  const modalsAiExplainUri = webview.asWebviewUri(
    vscode.Uri.joinPath(extensionUri, "media", "modals", "ai-explain.js")
  );
  const modalsAiCheckStatusUri = webview.asWebviewUri(
    vscode.Uri.joinPath(extensionUri, "media", "modals", "ai-check-status.js")
  );
  const modalsEnumManagerUri = webview.asWebviewUri(
    vscode.Uri.joinPath(extensionUri, "media", "modals", "enum-manager.js")
  );

  // 3. Tabs
  const tabsRecentUri = webview.asWebviewUri(vscode.Uri.joinPath(extensionUri, "media", "tabs", "recent.js"));
  const tabsCommandsUri = webview.asWebviewUri(vscode.Uri.joinPath(extensionUri, "media", "tabs", "commands.js"));
  const tabsFavoritesUri = webview.asWebviewUri(vscode.Uri.joinPath(extensionUri, "media", "tabs", "favorites.js"));
  const tabsVariablesUri = webview.asWebviewUri(vscode.Uri.joinPath(extensionUri, "media", "tabs", "variables.js"));
  const tabsCategoriesUri = webview.asWebviewUri(vscode.Uri.joinPath(extensionUri, "media", "tabs", "categories.js"));

  // 4. Render orchestrator
  const renderUri = webview.asWebviewUri(vscode.Uri.joinPath(extensionUri, "media", "render.js"));

  // 5. Message handler
  const messagesUri = webview.asWebviewUri(vscode.Uri.joinPath(extensionUri, "media", "messages.js"));

  // 6. Entry point
  const mainUri = webview.asWebviewUri(vscode.Uri.joinPath(extensionUri, "media", "main.js"));

  // A per-load random nonce required by the Content-Security-Policy to whitelist
  // only the scripts injected by this function, blocking any injected third-party scripts.
  const nonce = crypto.randomBytes(16).toString("base64");

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${webview.cspSource}; script-src 'nonce-${nonce}';">
  <link rel="stylesheet" href="${styleUri}">
  ${isDev ? `<link rel="stylesheet" href="${webview.asWebviewUri(vscode.Uri.joinPath(extensionUri, "media", "dev", "dev-styles.css"))}">` : ""}
  <title>RunBox</title>
</head>
<body>
  <div id="app"></div>

  <!-- 1. Foundation: state must be first, icons and utils follow -->
  <script nonce="${nonce}" src="${stateUri}"></script>
  <script nonce="${nonce}" src="${iconsUri}"></script>
  <script nonce="${nonce}" src="${utilsUri}"></script>
  <script nonce="${nonce}" src="${markdownParserUri}"></script>

  <!-- 2. Modals (must exist before tab renderers that reference renderCommandCard, etc.) -->
  <script nonce="${nonce}" src="${modalsRunConfirmUri}"></script>
  <script nonce="${nonce}" src="${modalsCommandFormUri}"></script>
  <script nonce="${nonce}" src="${modalsAiSettingsUri}"></script>
  <script nonce="${nonce}" src="${modalsAiGenerateUri}"></script>
  <script nonce="${nonce}" src="${modalsAiExplainUri}"></script>
  <script nonce="${nonce}" src="${modalsAiCheckStatusUri}"></script>
  <script nonce="${nonce}" src="${modalsEnumManagerUri}"></script>


  <!-- 3. Tabs -->
  <script nonce="${nonce}" src="${tabsRecentUri}"></script>
  <script nonce="${nonce}" src="${tabsCommandsUri}"></script>
  <script nonce="${nonce}" src="${tabsFavoritesUri}"></script>
  <script nonce="${nonce}" src="${tabsVariablesUri}"></script>
  <script nonce="${nonce}" src="${tabsCategoriesUri}"></script>

  <!-- 4. Render orchestrator (calls tab/modal renderers — must come after them) -->
  <script nonce="${nonce}" src="${renderUri}"></script>

  <!-- 5. Message handler (calls render() — must come after render.js) -->
  <script nonce="${nonce}" src="${messagesUri}"></script>

  <!-- 6. Entry point: DOMContentLoaded + postMessage senders + tooltip IIFE -->
  <script nonce="${nonce}" src="${mainUri}"></script>

  ${
    isDev
      ? `<!-- 7. Dev Tools (development mode only — zero impact if folder is missing) -->
  ${devModuleFiles
    .map(function (segs) {
      return `<script nonce="${nonce}" src="${webview.asWebviewUri(vscode.Uri.joinPath(extensionUri, ...segs))}"></script>`;
    })
    .join("\n  ")}
  <script nonce="${nonce}" src="${webview.asWebviewUri(vscode.Uri.joinPath(extensionUri, "media", "dev", "index.js"))}"></script>`
      : ""
  }
</body>
</html>`;
}

module.exports = {
  activate,
  deactivate,
};
