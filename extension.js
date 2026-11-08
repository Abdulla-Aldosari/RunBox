/*-------------------------------------------------
 * RunBox — VS Code Extension
 * Copyright (c) 2026 Abdulla Aldosari
 * Licensed under the MIT License.
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
  GLOBAL_DATA_FILE,
  GLOBAL_AUTO_VARIABLES_SETTINGS_FILE,
  GLOBAL_DIR,
  readWorkspaceId,
  readWorkspaceCommandsSection,
  normalizeLocalWorkspaceDir,
} = require("./lib/storage");
const { getTerminalProfiles, findDuplicateShellProfiles } = require("./lib/terminal");
const { getHelpLink } = require("./lib/help-links");
const { buildAutoVariablesPayload } = require("./lib/auto-variables");
const H = require("./lib/handlers");
const { initLogger } = require("./lib/logger");
const { AI_OUTPUT_LANGUAGES, resolveAiOutputLanguage } = require("./lib/ai/languages");

// Default values for per-workspace UI selection preferences (active tab, selected
// category/group in the Commands tab, selected group in the Categories & Groups
// tab, favorites scope). Mirrors the fallback defaults previously hardcoded in
// media/state.js when reading from localStorage.
const UI_PREFERENCE_DEFAULTS = {
  selectedTab: "recent",
  selectedCategoryId: "",
  selectedGroupId: "all",
  categoriesSelectedGroupId: "all",
  favoritesScope: "local",
};

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

  // Ensures the duplicate shell profile check (see below) runs at most once per
  // VS Code session, even if the user closes and reopens the RunBox panel
  // multiple times without restarting/reloading the window.
  let hasCheckedDuplicateShellProfilesThisSession = false;

  // Output channel used by the logger to write structured JSON logs visible in the Output panel.
  const loggerOutputChannel = vscode.window.createOutputChannel("RunBox", "json");
  context.subscriptions.push(loggerOutputChannel);
  initLogger(loggerOutputChannel);

  // ─── postState ────────────────────────────────────────────────────────────────
  /**
   * Posts a message to a webview panel, silently swallowing the "Webview is
   * disposed" error VS Code throws when the panel was closed while this call's
   * caller was still awaiting async work (e.g. disk reads in collectAndPostState,
   * or the connection-watchdog heartbeat racing a panel close). There is nothing
   * useful to do in that case: the panel is gone and nothing is listening, so
   * letting the error propagate unhandled would otherwise destabilize the entire
   * extension host (VS Code force-restarts it after enough unhandled rejections),
   * taking down every other open panel/session, not just this one.
   * @param {import('vscode').WebviewPanel} targetPanel
   * @param {object} message
   */
  async function safePostMessage(targetPanel, message) {
    try {
      await targetPanel.webview.postMessage(message);
    } catch {
      // Panel was disposed mid-flight; nothing to recover, safe to ignore.
    }
  }

  /**
   * Mirrors the webview's variable-field focus state into the context keys that gate the
   * Ctrl/Cmd+Shift+O and Ctrl/Cmd+Shift+E keybindings in package.json, so those keys only
   * override VS Code's own shortcuts while a variable field actually has focus.
   * @param {boolean} focused - a variable text field (or its enum dropdown) has focus
   * @param {boolean} filePickable - the focused field can receive a picked file path
   */
  function setVariableFieldContext(focused, filePickable) {
    vscode.commands.executeCommand("setContext", "runBox.variableFieldFocused", focused);
    vscode.commands.executeCommand("setContext", "runBox.variableFilePickable", filePickable);
  }

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

    // Last-used UI selections (active tab, selected category/group, favorites scope)
    // are scoped per-workspace via context.workspaceState instead of the webview's
    // localStorage, which is shared globally across every VS Code window on the
    // machine. Without this, closing the panel on one project's "Commands" tab and
    // later opening it on an unrelated project would incorrectly show the other
    // project's last tab/category/group. When no folder is open at all (empty
    // window), VS Code has no stable identity to key workspaceState by, so this
    // simply falls back to UI_PREFERENCE_DEFAULTS on every read in that case,
    // which is safe and expected since there is no real "workspace" to remember state for.
    const uiPreferences = Object.assign({}, UI_PREFERENCE_DEFAULTS, context.workspaceState.get("uiPreferences") || {});

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

    await safePostMessage(targetPanel, {
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
        uiPreferences,
        aiOutputLanguages: AI_OUTPUT_LANGUAGES,
        aiExplainLanguage: resolveAiOutputLanguage(vscode.workspace.getConfiguration("runBox").get("aiExplainLanguage")),
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
  const refreshOnExternalChange = function () {
    if (panel) {
      postState(panel);
    }
  };
  // Every shared global file the panel state is built from: commands, the
  // unified data file (Global variables + Global favorites), and the Auto
  // Variables settings. One watcher per file, each rooted at GLOBAL_DIR.
  [GLOBAL_COMMANDS_FILE, GLOBAL_DATA_FILE, GLOBAL_AUTO_VARIABLES_SETTINGS_FILE].forEach(function (filePath) {
    const watcher = vscode.workspace.createFileSystemWatcher(new vscode.RelativePattern(vscode.Uri.file(GLOBAL_DIR), path.basename(filePath)));
    watcher.onDidChange(refreshOnExternalChange);
    watcher.onDidCreate(refreshOnExternalChange);
    watcher.onDidDelete(refreshOnExternalChange);
    context.subscriptions.push(watcher);
  });

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
      const configuredPath = vscode.workspace.getConfiguration("runBox", folder.uri).get("localWorkspaceFilesPath") || "";
      const relativeDir = normalizeLocalWorkspaceDir(configuredPath);
      const watcher = vscode.workspace.createFileSystemWatcher(new vscode.RelativePattern(folder, `${relativeDir}/runbox.data.json`));
      watcher.onDidChange(refreshOnExternalChange);
      watcher.onDidCreate(refreshOnExternalChange);
      watcher.onDidDelete(refreshOnExternalChange);
      return watcher;
    });
  }

  rebuildWorkspaceDataWatcher();
  context.subscriptions.push(
    vscode.workspace.onDidChangeWorkspaceFolders(rebuildWorkspaceDataWatcher),
    // Keeps the default explanation language shown in the webview in sync with the setting.
    vscode.workspace.onDidChangeConfiguration(function (event) {
      if (panel && event.affectsConfiguration("runBox.aiExplainLanguage")) {
        postState(panel);
      }
    }),
    new vscode.Disposable(function () {
      workspaceDataWatchers.forEach(function (watcher) {
        watcher.dispose();
      });
    })
  );
  // ─────────────────────────────────────────────────────────────────────────────

  // ─── Duplicate Shell Profile Notice ────────────────────────────────────────────
  // VS Code allows multiple terminal profile entries (terminal.integrated.profiles.*)
  // to resolve to the exact same shell executable path (e.g. a custom "PowerShell"
  // profile pointing at the same powershell.exe as the built-in "Windows PowerShell"
  // profile). When that happens, picking between them in RunBox's run confirmation
  // dialog has no real effect, which is confusing. This only detects and informs the
  // user — it never changes any profile or restricts any selection.
  //
  // The dismissal is remembered per exact set of duplicate groups (a "fingerprint"),
  // not as a single global flag: if the user dismisses today's duplication and later
  // a different duplication appears (e.g. after editing settings), a fresh notice is
  // shown for that new situation instead of staying silent forever.
  //
  // Intentionally NOT run here at activation time: onStartupFinished activates every
  // RunBox install on every VS Code window startup, regardless of whether the user
  // ever opens the RunBox panel. Showing a warning at that point would surprise users
  // who have no intention of using RunBox in that session. Instead, checkDuplicateShellProfiles()
  // is called from openPanelCommand below, only once the user actually opens the panel.
  const DUPLICATE_SHELL_DISMISSED_KEY = "runBox.dismissedDuplicateShellFingerprint";

  function buildDuplicateShellFingerprint(duplicateGroups) {
    return JSON.stringify(
      duplicateGroups
        .map(function (names) {
          return names.slice().sort();
        })
        .sort(function (a, b) {
          return a.join(",").localeCompare(b.join(","));
        })
    );
  }

  function checkDuplicateShellProfiles() {
    const { profiles } = getTerminalProfiles();
    const duplicateGroups = findDuplicateShellProfiles(profiles);

    if (duplicateGroups.length === 0) {
      return;
    }

    const fingerprint = buildDuplicateShellFingerprint(duplicateGroups);
    const dismissedFingerprint = context.globalState.get(DUPLICATE_SHELL_DISMISSED_KEY) || "";

    if (fingerprint === dismissedFingerprint) {
      return;
    }

    const groupsText = duplicateGroups
      .map(function (names) {
        const namesText = names
          .map(function (n) {
            return `"${n}"`;
          })
          .join(" and ");
        const sharedPath = profiles.find(function (p) {
          return p.name === names[0];
        }).shellPath;
        return `${namesText}. Both point to the path: "${sharedPath}"`;
      })
      .join("; ");

    vscode.window
      .showWarningMessage(
        `RunBox detected terminal profiles that run the exact same shell: ${groupsText}. ` + `Selecting either option in the Run confirmation dialog uses the same shell.`,
        "Learn More",
        "Open Settings",
        "Don't Show Again"
      )
      .then(function (choice) {
        if (choice === "Learn More") {
          const url = getHelpLink("faqs-duplicate-terminal-profiles");
          if (url) {
            vscode.env.openExternal(vscode.Uri.parse(url));
          }
        } else if (choice === "Open Settings") {
          vscode.commands.executeCommand("workbench.action.openSettings", "terminal.integrated.profiles");
        } else if (choice === "Don't Show Again") {
          context.globalState.update(DUPLICATE_SHELL_DISMISSED_KEY, fingerprint);
        }
      });
  }
  // ─────────────────────────────────────────────────────────────────────────────

  // ─── Panel Setup ────────────────────────────────────────────────────────────────
  /**
   * Wires up a webview panel (HTML content, message dispatch table, dispose handler)
   * and pushes the initial state. Only called by runBox.openPanel, right after
   * createWebviewPanel(), for a brand-new panel -- there is no panel-revival path
   * (see the comment above runBox.openPanel's command registration for why).
   * Kept as its own function purely for readability.
   * @param {import('vscode').WebviewPanel} targetPanel
   */
  async function setupPanel(targetPanel) {
    // Re-asserts the same options already passed to createWebviewPanel() below. A
    // harmless no-op today, kept only as a cheap safety net: if this project ever
    // adds a panel-revival path back, a revived panel would come back with scripts
    // disabled by default, silently blocking every <script> tag in the HTML below.
    targetPanel.webview.options = { enableScripts: true };

    targetPanel.iconPath = vscode.Uri.joinPath(context.extensionUri, "media", "icon.png");

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

    targetPanel.webview.html = getWebviewHtml(targetPanel.webview, context.extensionUri, isDev, devModuleFiles);

    targetPanel.webview.onDidReceiveMessage(
      async function (message) {
        // Guard: ignore malformed messages that lack a string type.
        if (!message || typeof message.type !== "string") {
          return;
        }

        // Dedicated connection-watchdog heartbeat (media/connection-watchdog.js).
        // Dependency-free and independent of business message traffic, so it
        // always replies immediately regardless of any other in-flight work.
        // Uses targetPanel (not the outer panel) and safePostMessage since this
        // handler is bound to targetPanel specifically -- it must reply on the
        // panel that sent the ping, and must never throw if that exact panel was
        // disposed between receiving the ping and this reply going out.
        if (message.type === "ping") {
          await safePostMessage(targetPanel, { type: "pong" });
          return;
        }

        // Variable-field focus report from the webview (media/main.js). Only the panel
        // currently tracked in `panel` may drive the context keys, and the payload is
        // coerced to strict booleans so a malformed message can never leave a key stuck.
        if (message.type === "variableFieldFocus") {
          if (panel === targetPanel) {
            const state = message.payload || {};
            setVariableFieldContext(state.focused === true, state.filePickable === true);
          }
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
          await H.handleSaveWorkspaceCommandsData(panel, Object.assign({}, message.payload, { activeFsPath }), postState);
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

        // Clears the Run/Use history of every command in both the global
        // commands.json and the workspace-local "Current Workspace" section.
        if (message.type === "clearRecent") {
          const activeFsPath = context.workspaceState.get("activeWorkspaceFolder") || null;
          await H.handleClearRecent(panel, { activeFsPath }, postState);
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
          // panelFsPath (the panel's active folder) resolves ${@workspaceFolder}/${@workspaceName}
          // for actions sent without activeFsPath (Use, Copy).
          const panelFsPath = resolveActiveWorkspaceFolder(context.workspaceState.get("activeWorkspaceFolder") || null);
          await H.handlePerformAction(panel, Object.assign({}, message.payload, { panelFsPath }), postState);
          return;
        }

        // Replies with auto variable values computed now, for the Run Confirm modal.
        if (message.type === "requestAutoVariables") {
          const workspaceFolder = resolveActiveWorkspaceFolder(context.workspaceState.get("activeWorkspaceFolder") || null);
          await H.handleRequestAutoVariables(panel, Object.assign({}, message.payload, { workspaceFolder }));
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

        // Sends the user's prompt to the configured AI provider; posts progress and the final result.
        if (message.type === "aiGenerate") {
          await H.handleAiGenerate(panel, context, message.payload);
          return;
        }

        // Aborts the in-flight AI generation (user cancelled the loading overlay).
        if (message.type === "aiCancelGenerate") {
          H.handleAiCancelGenerate(panel);
          return;
        }

        // Aborts the in-flight AI explanation (user closed the explain modal).
        if (message.type === "aiCancelExplain") {
          H.handleAiCancelExplain(panel);
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

        // Persists a single UI selection preference (active tab, selected
        // category/group, favorites scope) scoped to the active workspace via
        // context.workspaceState. Intentionally does NOT call postState(), since
        // the webview already updated its own uiState optimistically before
        // sending this message, so a full state refresh here would be redundant.
        if (message.type === "saveUiPreference") {
          const key = message.payload && typeof message.payload.key === "string" ? message.payload.key : null;
          if (key && Object.prototype.hasOwnProperty.call(UI_PREFERENCE_DEFAULTS, key)) {
            const current = context.workspaceState.get("uiPreferences") || {};
            await context.workspaceState.update("uiPreferences", Object.assign({}, current, { [key]: message.payload.value }));
          }
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
    // on the next command invocation. Only clears the outer `panel` variable when this
    // dispose event belongs to the panel currently tracked there, so a stale dispose
    // from a superseded panel can never null out a newer, still-open one.
    targetPanel.onDidDispose(function () {
      // Stop any AI generation still running for this panel so it does not keep consuming quota.
      H.handleAiCancelGenerate(targetPanel);
      H.handleAiCancelExplain(targetPanel);
      if (panel === targetPanel) {
        setVariableFieldContext(false, false);
        panel = null;
      }
    });

    await postState(targetPanel);
  }
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

    // Runs once per session, only now that the user has actually opened the panel
    // (see the comment above checkDuplicateShellProfiles's definition for why).
    if (!hasCheckedDuplicateShellProfilesThisSession) {
      hasCheckedDuplicateShellProfilesThisSession = true;
      checkDuplicateShellProfiles();
    }

    panel = vscode.window.createWebviewPanel("runBoxPanel", "RunBox", vscode.ViewColumn.One, {
      enableScripts: true,
      retainContextWhenHidden: true,
    });

    await setupPanel(panel);
  });

  context.subscriptions.push(openPanelCommand);

  // Keyboard shortcuts for the variable fields (Ctrl/Cmd+Shift+O picks a file,
  // Ctrl/Cmd+Shift+E toggles the empty value). The keybindings are declared in
  // package.json and only apply while a variable field has focus: the webview reports
  // its focus state ("variableFieldFocus" message) and setVariableFieldContext()
  // mirrors it into the runBox.variableFieldFocused / runBox.variableFilePickable
  // context keys. The extension only relays the shortcut; the webview acts on
  // whichever variable field currently has focus.
  [
    { commandId: "runBox.variable.pickFile", action: "pickFile" },
    { commandId: "runBox.variable.toggleEmpty", action: "toggleEmpty" },
  ].forEach(function (shortcut) {
    context.subscriptions.push(
      vscode.commands.registerCommand(shortcut.commandId, function () {
        if (panel) {
          panel.webview.postMessage({ type: "variableShortcut", payload: { action: shortcut.action } });
        }
      })
    );
  });

  // Intentionally does NOT register a vscode.window.registerWebviewPanelSerializer
  // for "runBoxPanel". VS Code's own webview-revival mechanism is currently unreliable
  // across extension host restarts / window reloads (confirmed against VS Code 1.138.0
  // stable and 1.139.0-insider): a revived panel frequently gets stuck as a permanently
  // blank screen with an endless loading indicator instead of restoring correctly. See
  // https://github.com/microsoft/vscode/issues/225410 (extension host restarts/crashes
  // are not handled for webviews, no extension-facing API exists to detect it) and
  // https://github.com/microsoft/vscode/pull/226069 (the fix for this, still open/
  // unmerged as of VS Code 1.139.0-insider). Without a serializer, VS Code does not
  // persist the panel across a reload at all, so it simply closes instead of coming
  // back as an unrecoverable orphaned blank screen -- the user just reopens it via the
  // command/status bar/keybinding, which always creates a clean new panel. The
  // connection-watchdog heartbeat (media/connection-watchdog.js, "ping"/"pong" above)
  // still covers the case where the panel's DOM survives a host restart while the
  // extension side does not (e.g. certain host crash-recovery paths): it detects the
  // dead connection and tells the user to close and reopen the panel, which is
  // guaranteed to work since it always creates a brand-new panel via runBox.openPanel.

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
  const nameRulesUri = webview.asWebviewUri(vscode.Uri.joinPath(extensionUri, "media", "name-rules.js"));

  // 1a. Connection watchdog (independent heartbeat — only depends on icons and vscode,
  // both already defined earlier)
  const connectionWatchdogUri = webview.asWebviewUri(vscode.Uri.joinPath(extensionUri, "media", "connection-watchdog.js"));

  // 1b. Markdown parser (utility — must load before ai-explain.js)
  const markdownParserUri = webview.asWebviewUri(vscode.Uri.joinPath(extensionUri, "media", "markdown-parser.js"));

  // 2. Modals
  const modalsRunConfirmUri = webview.asWebviewUri(vscode.Uri.joinPath(extensionUri, "media", "modals", "run-confirm.js"));
  const modalsCommandFormUri = webview.asWebviewUri(vscode.Uri.joinPath(extensionUri, "media", "modals", "command-form.js"));
  const modalsAiSettingsUri = webview.asWebviewUri(vscode.Uri.joinPath(extensionUri, "media", "modals", "ai-settings.js"));
  const modalsAiGenerateUri = webview.asWebviewUri(vscode.Uri.joinPath(extensionUri, "media", "modals", "ai-generate.js"));
  const modalsAiExplainUri = webview.asWebviewUri(vscode.Uri.joinPath(extensionUri, "media", "modals", "ai-explain.js"));
  const modalsAiCheckStatusUri = webview.asWebviewUri(vscode.Uri.joinPath(extensionUri, "media", "modals", "ai-check-status.js"));
  const modalsEnumManagerUri = webview.asWebviewUri(vscode.Uri.joinPath(extensionUri, "media", "modals", "enum-manager.js"));

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
  <script nonce="${nonce}" src="${nameRulesUri}"></script>
  <script nonce="${nonce}" src="${connectionWatchdogUri}"></script>
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
