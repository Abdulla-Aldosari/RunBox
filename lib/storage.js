/*-------------------------------------------------
 * Terminal Recipes — VS Code Extension
 * Copyright (c) 2026 Abdulla Aldosari
 * Licensed under the Apache License, Version 2.0.
 * See LICENSE in the project root for details.
 *-------------------------------------------------*/

// lib/storage.js
// All file system read/write operations and global path constants.
// Single source of truth for data persistence.

const fs = require("fs/promises");
const os = require("os");
const path = require("path");
const vscode = require("vscode");
const { normalizeCommandsData, normalizeCommandVariables, getDefaultCommandsData } = require("./normalize");

const GLOBAL_DIR = path.join(os.homedir(), ".vscode-terminal-recipes");
const GLOBAL_COMMANDS_FILE = path.join(GLOBAL_DIR, "commands.json");
const GLOBAL_VARIABLES_FILE = path.join(GLOBAL_DIR, "variables.json");
const GLOBAL_AUTO_VARIABLES_SETTINGS_FILE = path.join(GLOBAL_DIR, "auto-variables-settings.json");
const GLOBAL_FAVORITES_FILE = path.join(GLOBAL_DIR, "favorites.json");

/**
 * Checks whether a file exists at the given path.
 * @param {string} filePath
 * @returns {Promise<boolean>}
 */
async function fileExists(filePath) {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

/**
 * Returns the file system path of the first open workspace folder,
 * or null if no workspace is currently open.
 * @returns {string|null}
 */
function getFirstWorkspaceFolderPath() {
  const workspaceFolders = vscode.workspace.workspaceFolders;

  if (!workspaceFolders || workspaceFolders.length === 0) {
    return null;
  }

  return workspaceFolders[0].uri.fsPath;
}

/**
 * Returns all open workspace folders as an array of { name, fsPath } objects.
 * Returns an empty array if no workspace is open.
 * @returns {Array<{ name: string, fsPath: string }>}
 */
function getAllWorkspaceFolders() {
  const folders = vscode.workspace.workspaceFolders;
  if (!folders || folders.length === 0) {
    return [];
  }
  return folders.map(function (f) {
    return { name: f.name, fsPath: f.uri.fsPath };
  });
}

/**
 * Resolves the active workspace folder for multi-root workspaces.
 *
 * Resolution strategy depends on the `multiRootFolderResolution` setting:
 *   - "remember"     : savedFsPath → active editor's folder → first folder
 *   - "followEditor" : active editor's folder → savedFsPath → first folder
 *   - "alwaysFirst"  : always returns the first folder
 *
 * In a single-folder workspace, always returns the only folder regardless of
 * the resolution setting or savedFsPath.
 *
 * @param {string|null} savedFsPath - Value previously stored in workspaceState
 * @returns {string|null}
 */
function resolveActiveWorkspaceFolder(savedFsPath) {
  const folders = vscode.workspace.workspaceFolders;
  if (!folders || folders.length === 0) {
    return null;
  }

  // Single-root: always the only folder — no resolution logic needed
  if (folders.length === 1) {
    return folders[0].uri.fsPath;
  }

  const resolution =
    vscode.workspace.getConfiguration("terminalRecipes").get("multiRootFolderResolution") || "remember";

  // Helper: resolve the active text editor's folder (null if not in workspace)
  function getEditorFolder() {
    const editor = vscode.window.activeTextEditor;
    if (!editor) {
      return null;
    }
    const editorFolder = vscode.workspace.getWorkspaceFolder(editor.document.uri);
    return editorFolder ? editorFolder.uri.fsPath : null;
  }

  // Helper: validate that a path still belongs to the current workspace
  function isValidFolder(fsPath) {
    return Boolean(
      fsPath &&
      folders.some(function (f) {
        return f.uri.fsPath === fsPath;
      })
    );
  }

  if (resolution === "alwaysFirst") {
    return folders[0].uri.fsPath;
  }

  if (resolution === "followEditor") {
    // Editor → savedFsPath → first
    return getEditorFolder() || (isValidFolder(savedFsPath) ? savedFsPath : null) || folders[0].uri.fsPath;
  }

  // "remember" (default): savedFsPath → editor → first
  if (isValidFolder(savedFsPath)) {
    return savedFsPath;
  }
  return getEditorFolder() || folders[0].uri.fsPath;
}

/**
 * Returns the absolute path to the workspace-local variables file.
 * By default located at `.vscode/terminal-recipes.variables.json` inside the workspace folder.
 * The subdirectory can be overridden via the `terminalRecipes.localWorkspaceFilesPath` setting.
 * Returns null if no workspace is open.
 * @param {string|null} [fsPath] - Optional explicit workspace folder path override
 * @returns {string|null}
 */
function getWorkspaceVariablesFilePath(fsPath) {
  const workspaceFolder = fsPath || getFirstWorkspaceFolderPath();

  if (!workspaceFolder) {
    return null;
  }

  const configuredPath = vscode.workspace.getConfiguration("terminalRecipes").get("localWorkspaceFilesPath") || "";
  const relativeDir = configuredPath.trim() || ".vscode";

  return path.join(workspaceFolder, relativeDir, "terminal-recipes.variables.json");
}

/**
 * Returns the path to the workspace favorites file.
 * By default located at `.vscode/terminal-recipes.favorites.json` inside the workspace folder.
 * The subdirectory can be overridden via the `terminalRecipes.localWorkspaceFilesPath` setting.
 * @param {string|null} [fsPath] - Optional explicit workspace folder path override
 * @returns {string|null}
 */
function getWorkspaceFavoritesFilePath(fsPath) {
  const workspaceFolder = fsPath || getFirstWorkspaceFolderPath();
  if (!workspaceFolder) {
    return null;
  }

  const configuredPath = vscode.workspace.getConfiguration("terminalRecipes").get("localWorkspaceFilesPath") || "";
  const relativeDir = configuredPath.trim() || ".vscode";

  return path.join(workspaceFolder, relativeDir, "terminal-recipes.favorites.json");
}

/**
 * Ensures the global commands JSON file exists.
 * Creates the parent directory and a default file if they do not exist.
 */
async function ensureGlobalCommandsFile() {
  await fs.mkdir(GLOBAL_DIR, { recursive: true });

  try {
    await fs.access(GLOBAL_COMMANDS_FILE);
  } catch {
    await fs.writeFile(GLOBAL_COMMANDS_FILE, JSON.stringify(getDefaultCommandsData(), null, 2), "utf8");
  }
}

/**
 * Reads and parses the global commands data from disk.
 * Falls back to the default data structure if the file is missing or malformed.
 * @returns {Promise<object>}
 */
async function readGlobalCommandsData() {
  await ensureGlobalCommandsFile();

  const raw = await fs.readFile(GLOBAL_COMMANDS_FILE, "utf8");

  try {
    const parsed = JSON.parse(raw);
    return normalizeCommandsData(parsed);
  } catch {
    const fallback = getDefaultCommandsData();
    await writeGlobalCommandsData(fallback);
    return fallback;
  }
}

/**
 * Serializes and writes the commands data object to the global commands JSON file.
 * @param {object} data - The normalized commands data to persist
 */
async function writeGlobalCommandsData(data) {
  await fs.mkdir(GLOBAL_DIR, { recursive: true });
  await fs.writeFile(GLOBAL_COMMANDS_FILE, JSON.stringify(data, null, 2), "utf8");
}

/**
 * Reads and parses the workspace-local command variables from disk.
 * Returns an empty structure if the file doesn't exist or cannot be parsed.
 * @param {string|null} [fsPath] - Optional explicit workspace folder path override
 * @returns {Promise<{ version: number, commands: object }>}
 */
async function readWorkspaceVariables(fsPath) {
  const workspaceVariablesPath = getWorkspaceVariablesFilePath(fsPath || null);

  if (!workspaceVariablesPath) {
    return {
      version: 2,
      commands: {},
    };
  }

  try {
    const raw = await fs.readFile(workspaceVariablesPath, "utf8");
    const parsed = JSON.parse(raw);
    return normalizeCommandVariables(parsed);
  } catch {
    return {
      version: 2,
      commands: {},
    };
  }
}

/**
 * Normalizes and writes the workspace-local command variables to the local variables file.
 * Does nothing if no workspace folder is currently open.
 * @param {object} input - Raw variables data to persist
 * @param {string|null} [fsPath] - Optional explicit workspace folder path override
 */
async function writeWorkspaceVariables(input, fsPath) {
  const workspaceVariablesPath = getWorkspaceVariablesFilePath(fsPath || null);

  if (!workspaceVariablesPath) {
    return;
  }

  const normalized = normalizeCommandVariables(input);

  await fs.mkdir(path.dirname(workspaceVariablesPath), { recursive: true });
  await fs.writeFile(workspaceVariablesPath, JSON.stringify(normalized, null, 2), "utf8");
}

/**
 * Reads and parses the global command variables from disk.
 * Returns an empty structure if the file doesn't exist or cannot be parsed.
 * @returns {Promise<{ version: number, commands: object }>}
 */
async function readGlobalVariables() {
  try {
    const raw = await fs.readFile(GLOBAL_VARIABLES_FILE, "utf8");
    const parsed = JSON.parse(raw);
    return normalizeCommandVariables(parsed);
  } catch {
    return {
      version: 2,
      commands: {},
    };
  }
}

/**
 * Normalizes and writes the global command variables to the global variables file.
 * @param {object} input - Raw variables data to persist
 */
async function writeGlobalVariables(input) {
  await fs.mkdir(GLOBAL_DIR, { recursive: true });
  const normalized = normalizeCommandVariables(input);
  await fs.writeFile(GLOBAL_VARIABLES_FILE, JSON.stringify(normalized, null, 2), "utf8");
}

/**
 * Reads Auto Variables settings from the file.
 * @returns {Promise<object>} - { varName: { enabled: boolean, config: object } }
 */
async function readAutoVariablesSettings() {
  try {
    const raw = await fs.readFile(GLOBAL_AUTO_VARIABLES_SETTINGS_FILE, "utf8");
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return parsed;
    }
    return {};
  } catch {
    return {};
  }
}

/**
 * Writes Auto Variables settings to the file.
 * @param {object} settings - { varName: { enabled: boolean, config: object } }
 */
async function writeAutoVariablesSettings(settings) {
  await fs.mkdir(GLOBAL_DIR, { recursive: true });
  await fs.writeFile(GLOBAL_AUTO_VARIABLES_SETTINGS_FILE, JSON.stringify(settings, null, 2), "utf8");
}

/**
 * Reads the global favorites file.
 * @returns {Promise<string[]>} Array of command IDs
 */
async function readGlobalFavorites() {
  try {
    const raw = await fs.readFile(GLOBAL_FAVORITES_FILE, "utf8");
    const parsed = JSON.parse(raw);
    if (parsed && Array.isArray(parsed.commandIds)) {
      return parsed.commandIds.filter(function (id) {
        return typeof id === "string";
      });
    }
    return [];
  } catch {
    return [];
  }
}

/**
 * Reads the workspace-local favorites file.
 * @param {string|null} [fsPath] - Optional explicit workspace folder path override
 * @returns {Promise<string[]>} Array of command IDs
 */
async function readWorkspaceFavorites(fsPath) {
  const filePath = getWorkspaceFavoritesFilePath(fsPath || null);
  if (!filePath) {
    return [];
  }
  try {
    const raw = await fs.readFile(filePath, "utf8");
    const parsed = JSON.parse(raw);
    if (parsed && Array.isArray(parsed.commandIds)) {
      return parsed.commandIds.filter(function (id) {
        return typeof id === "string";
      });
    }
    return [];
  } catch {
    return [];
  }
}

/**
 * Writes the global favorites file.
 * @param {string[]} commandIds
 */
async function writeGlobalFavorites(commandIds) {
  await fs.mkdir(GLOBAL_DIR, { recursive: true });
  await fs.writeFile(GLOBAL_FAVORITES_FILE, JSON.stringify({ version: 1, commandIds }, null, 2), "utf8");
}

/**
 * Writes the workspace-local favorites file.
 * @param {string[]} commandIds
 * @param {string|null} [fsPath] - Optional explicit workspace folder path override
 */
async function writeWorkspaceFavorites(commandIds, fsPath) {
  const filePath = getWorkspaceFavoritesFilePath(fsPath || null);
  if (!filePath) {
    return;
  }
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, JSON.stringify({ version: 1, commandIds }, null, 2), "utf8");
}

module.exports = {
  GLOBAL_DIR,
  GLOBAL_COMMANDS_FILE,
  GLOBAL_VARIABLES_FILE,
  GLOBAL_AUTO_VARIABLES_SETTINGS_FILE,
  GLOBAL_FAVORITES_FILE,
  fileExists,
  getFirstWorkspaceFolderPath,
  getAllWorkspaceFolders,
  resolveActiveWorkspaceFolder,
  getWorkspaceVariablesFilePath,
  ensureGlobalCommandsFile,
  readGlobalCommandsData,
  writeGlobalCommandsData,
  readWorkspaceVariables,
  writeWorkspaceVariables,
  readGlobalVariables,
  writeGlobalVariables,
  readAutoVariablesSettings,
  writeAutoVariablesSettings,
  readGlobalFavorites,
  readWorkspaceFavorites,
  writeGlobalFavorites,
  writeWorkspaceFavorites,
};
