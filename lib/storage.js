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
const {
  normalizeCommandsData,
  normalizeDataFile,
  normalizeVariablesSection,
  normalizeFavoritesSection,
  getDefaultCommandsData,
} = require("./normalize");

const GLOBAL_DIR = path.join(os.homedir(), ".vscode-terminal-recipes");
const GLOBAL_COMMANDS_FILE = path.join(GLOBAL_DIR, "commands.json");
const GLOBAL_DATA_FILE = path.join(GLOBAL_DIR, "data.json");
const GLOBAL_AUTO_VARIABLES_SETTINGS_FILE = path.join(GLOBAL_DIR, "auto-variables-settings.json");

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
 * Returns the absolute path to the workspace-local unified data file.
 * By default located at `.vscode/terminal-recipes.data.json` inside the workspace folder.
 * The subdirectory can be overridden via the `terminalRecipes.localWorkspaceFilesPath` setting.
 * Returns null if no workspace is open.
 * @param {string|null} [fsPath] - Optional explicit workspace folder path override
 * @returns {string|null}
 */
function getWorkspaceDataFilePath(fsPath) {
  const workspaceFolder = fsPath || getFirstWorkspaceFolderPath();

  if (!workspaceFolder) {
    return null;
  }

  const configuredPath = vscode.workspace.getConfiguration("terminalRecipes").get("localWorkspaceFilesPath") || "";
  const relativeDir = configuredPath.trim() || ".vscode";

  return path.join(workspaceFolder, relativeDir, "terminal-recipes.data.json");
}

/**
 * Returns the absolute path to the global unified data file.
 * Internal helper only (not exported) — kept for symmetry with getWorkspaceDataFilePath
 * so read/write functions read consistently regardless of scope.
 * @returns {string}
 */
function getGlobalDataFilePath() {
  return GLOBAL_DATA_FILE;
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
 * Reads and normalizes the unified data file at the given path.
 * Returns a fully normalized default structure if the path is null, the file
 * does not exist, or the file cannot be parsed. This is the ONLY function that
 * reads the unified data file from disk.
 * @param {string|null} filePath
 * @returns {Promise<{ version: number, variables: object, favorites: object }>}
 */
async function readDataFile(filePath) {
  if (!filePath) {
    return normalizeDataFile({});
  }

  try {
    const raw = await fs.readFile(filePath, "utf8");
    return normalizeDataFile(JSON.parse(raw));
  } catch {
    return normalizeDataFile({});
  }
}

/**
 * Normalizes and writes the unified data file to disk. This is the ONLY function
 * that writes the unified data file to disk — every section-specific write function
 * (writeWorkspaceVariables, writeGlobalVariables, writeWorkspaceFavorites,
 * writeGlobalFavorites) must funnel through this function.
 * @param {string} filePath
 * @param {object} data - Raw or partially-normalized data; will be fully normalized here
 * @returns {Promise<boolean>} wasCreated - true if the file did not exist before this call
 */
async function writeDataFile(filePath, data) {
  const wasCreated = !(await fileExists(filePath));
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, JSON.stringify(normalizeDataFile(data), null, 2), "utf8");
  return wasCreated;
}

/**
 * Reads and parses the commands data from disk.
 * Falls back to the default data structure if the file is missing or malformed.
 * @returns {Promise<object>}
 */
async function readCommandsData() {
  await ensureGlobalCommandsFile();

  const raw = await fs.readFile(GLOBAL_COMMANDS_FILE, "utf8");

  try {
    const parsed = JSON.parse(raw);
    return normalizeCommandsData(parsed);
  } catch {
    const fallback = getDefaultCommandsData();
    await writeCommandsData(fallback);
    return fallback;
  }
}

/**
 * Serializes and writes the commands data object to the commands JSON file.
 * @param {object} data - The normalized commands data to persist
 */
async function writeCommandsData(data) {
  await fs.mkdir(GLOBAL_DIR, { recursive: true });
  await fs.writeFile(GLOBAL_COMMANDS_FILE, JSON.stringify(data, null, 2), "utf8");
}

/**
 * Reads the "variables" section of the workspace-local unified data file.
 * @param {string|null} [fsPath] - Optional explicit workspace folder path override
 * @returns {Promise<{ commands: object }>}
 */
async function readWorkspaceVariables(fsPath) {
  const filePath = getWorkspaceDataFilePath(fsPath || null);
  const data = await readDataFile(filePath);
  return data.variables;
}

/**
 * Writes the "variables" section of the workspace-local unified data file,
 * preserving the existing "favorites" section (read-modify-write).
 * Does nothing and returns false if no workspace folder is open, or if the
 * incoming data is empty and no file exists yet on disk (avoids creating an
 * empty file as a side effect of a save that only touched the other scope).
 * @param {object} input - Raw variables section data to persist
 * @param {string|null} [fsPath] - Optional explicit workspace folder path override
 * @returns {Promise<boolean>} wasCreated - true if the local data file was created by this call
 */
async function writeWorkspaceVariables(input, fsPath) {
  const filePath = getWorkspaceDataFilePath(fsPath || null);
  if (!filePath) {
    return false;
  }

  const normalized = normalizeVariablesSection(input);
  if (Object.keys(normalized.commands).length === 0 && !(await fileExists(filePath))) {
    return false;
  }

  const data = await readDataFile(filePath);
  data.variables = normalized;
  return writeDataFile(filePath, data);
}

/**
 * Reads the "variables" section of the global unified data file.
 * @returns {Promise<{ commands: object }>}
 */
async function readGlobalVariables() {
  const data = await readDataFile(getGlobalDataFilePath());
  return data.variables;
}

/**
 * Writes the "variables" section of the global unified data file,
 * preserving the existing "favorites" section (read-modify-write).
 * Does nothing extra when the incoming data is empty and no file exists yet
 * on disk (avoids creating an empty file as a side effect of a save that
 * only touched the workspace-local scope).
 * @param {object} input - Raw variables section data to persist
 * @returns {Promise<boolean>} wasCreated - true if the global data file was created by this call
 */
async function writeGlobalVariables(input) {
  const filePath = getGlobalDataFilePath();

  const normalized = normalizeVariablesSection(input);
  if (Object.keys(normalized.commands).length === 0 && !(await fileExists(filePath))) {
    return false;
  }

  const data = await readDataFile(filePath);
  data.variables = normalized;
  return writeDataFile(filePath, data);
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
 * Reads the "favorites" section of the global unified data file.
 * @returns {Promise<string[]>} Array of command IDs
 */
async function readGlobalFavorites() {
  const data = await readDataFile(getGlobalDataFilePath());
  return data.favorites.commandIds;
}

/**
 * Reads the "favorites" section of the workspace-local unified data file.
 * @param {string|null} [fsPath] - Optional explicit workspace folder path override
 * @returns {Promise<string[]>} Array of command IDs
 */
async function readWorkspaceFavorites(fsPath) {
  const filePath = getWorkspaceDataFilePath(fsPath || null);
  const data = await readDataFile(filePath);
  return data.favorites.commandIds;
}

/**
 * Writes the "favorites" section of the global unified data file,
 * preserving the existing "variables" section (read-modify-write).
 * Does nothing extra when the incoming data is empty and no file exists yet
 * on disk (avoids creating an empty file as a side effect of a save that
 * only touched the workspace-local scope).
 * @param {string[]} commandIds
 * @returns {Promise<boolean>} wasCreated - true if the global data file was created by this call
 */
async function writeGlobalFavorites(commandIds) {
  const filePath = getGlobalDataFilePath();

  const normalized = normalizeFavoritesSection({ commandIds });
  if (normalized.commandIds.length === 0 && !(await fileExists(filePath))) {
    return false;
  }

  const data = await readDataFile(filePath);
  data.favorites = normalized;
  return writeDataFile(filePath, data);
}

/**
 * Writes the "favorites" section of the workspace-local unified data file,
 * preserving the existing "variables" section (read-modify-write).
 * Does nothing and returns false if no workspace folder is open, or if the
 * incoming data is empty and no file exists yet on disk (avoids creating an
 * empty file as a side effect of a save that only touched the other scope).
 * @param {string[]} commandIds
 * @param {string|null} [fsPath] - Optional explicit workspace folder path override
 * @returns {Promise<boolean>} wasCreated - true if the local data file was created by this call
 */
async function writeWorkspaceFavorites(commandIds, fsPath) {
  const filePath = getWorkspaceDataFilePath(fsPath || null);
  if (!filePath) {
    return false;
  }

  const normalized = normalizeFavoritesSection({ commandIds });
  if (normalized.commandIds.length === 0 && !(await fileExists(filePath))) {
    return false;
  }

  const data = await readDataFile(filePath);
  data.favorites = normalized;
  return writeDataFile(filePath, data);
}

module.exports = {
  GLOBAL_DIR,
  GLOBAL_COMMANDS_FILE,
  GLOBAL_DATA_FILE,
  GLOBAL_AUTO_VARIABLES_SETTINGS_FILE,
  fileExists,
  getFirstWorkspaceFolderPath,
  getAllWorkspaceFolders,
  resolveActiveWorkspaceFolder,
  getWorkspaceDataFilePath,
  ensureGlobalCommandsFile,
  readCommandsData,
  writeCommandsData,
  readDataFile,
  writeDataFile,
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
