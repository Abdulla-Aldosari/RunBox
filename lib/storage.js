/*-------------------------------------------------
 * RunBox — VS Code Extension
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
const crypto = require("crypto");
const vscode = require("vscode");
const {
  normalizeCommandsData,
  normalizeDataFile,
  normalizeVariablesSection,
  normalizeFavoritesSection,
  normalizeWorkspaceCommandsSection,
  getDefaultCommandsData,
} = require("./normalize");

const GLOBAL_DIR = path.join(os.homedir(), ".runbox");
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

// ─── Write Serialization + Atomic Write ────────────────────────────────────────
// Every write to a persisted JSON file in this extension funnels through
// enqueueWrite() + atomicWriteFile() so that:
//   1. Two writes targeting the SAME path from the same extension host process
//      (e.g. two webview messages handled back-to-back without awaiting each
//      other) are always serialized instead of racing on the same fs handle.
//   2. Each individual write is atomic: the target file is either fully the
//      old content or fully the new content, never a partially-written mix
//      (which is what produces invalid/corrupted JSON on disk).

/** @type {Map<string, Promise<any>>} Tracks the last pending write per absolute file path. */
const _writeQueues = new Map();

/**
 * Runs `fn` only after any previously enqueued write for the same `filePath`
 * has settled (resolved or rejected), guaranteeing writes to one file never
 * overlap within this process. Different file paths run independently.
 * @param {string} filePath
 * @param {() => Promise<any>} fn
 * @returns {Promise<any>}
 */
function enqueueWrite(filePath, fn) {
  const previous = _writeQueues.get(filePath) || Promise.resolve();
  const next = previous.catch(() => {}).then(fn);
  _writeQueues.set(
    filePath,
    next.catch(() => {})
  );
  return next;
}

/**
 * Writes `content` to `filePath` atomically: the content is first written to a
 * temporary sibling file (same directory, so it shares the same filesystem
 * volume as the target), then moved into place via `fs.rename`, which is an
 * atomic operation at the OS level. This guarantees the target file is never
 * observed in a partially-written state, even if the process crashes or is
 * interrupted mid-write.
 * @param {string} filePath
 * @param {string} content
 */
async function atomicWriteFile(filePath, content) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });

  const tempPath = path.join(path.dirname(filePath), `.${path.basename(filePath)}.tmp-${crypto.randomUUID()}`);

  try {
    await fs.writeFile(tempPath, content, "utf8");
    await fs.rename(tempPath, filePath);
  } catch (error) {
    await fs.unlink(tempPath).catch(() => {});
    throw error;
  }
}

/**
 * Copies the current content of `filePath` to a `.bak` sibling file, used as a
 * recovery source if the main file is ever found corrupted on a later read.
 * Silently does nothing if `filePath` does not exist yet or cannot be read.
 * @param {string} filePath
 */
async function backupFile(filePath) {
  try {
    const content = await fs.readFile(filePath, "utf8");
    // Validate the current file is well-formed JSON before backing it up —
    // never let a backup itself preserve corrupted content.
    JSON.parse(content);
    await atomicWriteFile(`${filePath}.bak`, content);
  } catch {
    // No existing file, unreadable, or already corrupted — nothing safe to back up.
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

  const resolution = vscode.workspace.getConfiguration("runBox").get("multiRootFolderResolution") || "remember";

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
 * By default located at `.vscode/runbox.data.json` inside the workspace folder.
 * The subdirectory can be overridden via the `runBox.localWorkspaceFilesPath` setting.
 * Returns null if no workspace is open.
 * @param {string|null} [fsPath] - Optional explicit workspace folder path override
 * @returns {string|null}
 */
function getWorkspaceDataFilePath(fsPath) {
  const workspaceFolder = fsPath || getFirstWorkspaceFolderPath();

  if (!workspaceFolder) {
    return null;
  }

  const configuredPath = vscode.workspace.getConfiguration("runBox").get("localWorkspaceFilesPath") || "";
  const relativeDir = configuredPath.trim() || ".vscode";

  return path.join(workspaceFolder, relativeDir, "runbox.data.json");
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
 * Returns a fully normalized default structure if the path is null or the
 * file does not exist. If the file exists but fails to parse (corrupted),
 * attempts to recover from the `.bak` sibling written by the last successful
 * write before falling back to a normalized default structure. This is the
 * ONLY function that reads the unified data file from disk.
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
  } catch (error) {
    // Distinguish "file does not exist yet" (expected, no recovery needed)
    // from "file exists but is corrupted" (attempt .bak recovery).
    if (error && error.code === "ENOENT") {
      return normalizeDataFile({});
    }

    try {
      const backupRaw = await fs.readFile(`${filePath}.bak`, "utf8");
      const recovered = normalizeDataFile(JSON.parse(backupRaw));
      // Restore the main file from the backup so subsequent reads don't keep
      // hitting the corrupted content, and surface the recovery to the user.
      await atomicWriteFile(filePath, JSON.stringify(recovered, null, 2));
      try {
        vscode.window.showWarningMessage(
          `RunBox: "${path.basename(filePath)}" was found corrupted and has been restored from its last automatic backup.`
        );
      } catch {
        // Non-critical — never let the notification itself break recovery.
      }
      return recovered;
    } catch {
      return normalizeDataFile({});
    }
  }
}

/**
 * Normalizes and writes the unified data file to disk. This is the ONLY function
 * that writes the unified data file to disk — every section-specific write function
 * (writeWorkspaceVariables, writeGlobalVariables, writeWorkspaceFavorites,
 * writeGlobalFavorites) must funnel through this function.
 *
 * Writes are serialized per file path (enqueueWrite) and performed atomically
 * (atomicWriteFile via temp file + rename), with a `.bak` snapshot of the
 * pre-write content kept for corruption recovery in readDataFile().
 * @param {string} filePath
 * @param {object} data - Raw or partially-normalized data; will be fully normalized here
 * @returns {Promise<boolean>} wasCreated - true if the file did not exist before this call
 */
async function writeDataFile(filePath, data) {
  return enqueueWrite(filePath, async function () {
    const wasCreated = !(await fileExists(filePath));
    if (!wasCreated) {
      await backupFile(filePath);
    }
    await atomicWriteFile(filePath, JSON.stringify(normalizeDataFile(data), null, 2));
    return wasCreated;
  });
}

/**
 * Reads and parses the commands data from disk.
 * Falls back to a `.bak` recovery, then to the default data structure, if the
 * file is missing or malformed.
 * @returns {Promise<object>}
 */
async function readCommandsData() {
  await ensureGlobalCommandsFile();

  try {
    const raw = await fs.readFile(GLOBAL_COMMANDS_FILE, "utf8");
    return normalizeCommandsData(JSON.parse(raw));
  } catch {
    try {
      const backupRaw = await fs.readFile(`${GLOBAL_COMMANDS_FILE}.bak`, "utf8");
      const recovered = normalizeCommandsData(JSON.parse(backupRaw));
      await writeCommandsData(recovered);
      try {
        vscode.window.showWarningMessage(
          'RunBox: "commands.json" was found corrupted and has been restored from its last automatic backup.'
        );
      } catch {
        // Non-critical — never let the notification itself break recovery.
      }
      return recovered;
    } catch {
      const fallback = getDefaultCommandsData();
      await writeCommandsData(fallback);
      return fallback;
    }
  }
}

/**
 * Serializes and writes the commands data object to the commands JSON file.
 * Serialized per-path and written atomically (temp file + rename), with a
 * `.bak` snapshot of the pre-write content kept for corruption recovery in
 * readCommandsData().
 * @param {object} data - The normalized commands data to persist
 */
async function writeCommandsData(data) {
  return enqueueWrite(GLOBAL_COMMANDS_FILE, async function () {
    if (await fileExists(GLOBAL_COMMANDS_FILE)) {
      await backupFile(GLOBAL_COMMANDS_FILE);
    }
    await atomicWriteFile(GLOBAL_COMMANDS_FILE, JSON.stringify(data, null, 2));
  });
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
 * Serialized per-path and written atomically (temp file + rename).
 * @param {object} settings - { varName: { enabled: boolean, config: object } }
 */
async function writeAutoVariablesSettings(settings) {
  return enqueueWrite(GLOBAL_AUTO_VARIABLES_SETTINGS_FILE, async function () {
    await atomicWriteFile(GLOBAL_AUTO_VARIABLES_SETTINGS_FILE, JSON.stringify(settings, null, 2));
  });
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

/**
 * Reads the `runBox.workspaceID` setting for the given workspace folder, without
 * creating one if it does not exist yet. Used by postState() so the "Current Workspace"
 * pseudo-category can be shown as empty until the user's first write interaction.
 * @param {string|null} fsPath - Workspace folder path; null returns "" (no workspace open)
 * @returns {string} the stored workspace ID, or "" if none is set
 */
function readWorkspaceId(fsPath) {
  if (!fsPath) {
    return "";
  }
  const value = vscode.workspace.getConfiguration("runBox", vscode.Uri.file(fsPath)).get("workspaceID");
  return typeof value === "string" ? value.trim() : "";
}

/**
 * Returns the `runBox.workspaceID` for the given workspace folder, generating and
 * persisting a new one (via WorkspaceFolder-scoped settings) if it does not exist yet.
 * Called only at the moment of an actual write interaction with "Current Workspace"
 * (adding a group or a command) — never as a side effect of merely opening the panel.
 * @param {string|null} fsPath
 * @returns {Promise<string>} the workspace ID (existing or newly created); "" if fsPath is null
 */
async function ensureWorkspaceId(fsPath) {
  if (!fsPath) {
    return "";
  }

  const existing = readWorkspaceId(fsPath);
  if (existing) {
    return existing;
  }

  const newId = crypto.randomUUID();
  await vscode.workspace
    .getConfiguration("runBox", vscode.Uri.file(fsPath))
    .update("workspaceID", newId, vscode.ConfigurationTarget.WorkspaceFolder);
  return newId;
}

/**
 * Reads the "workspaceCommands" section of the workspace-local unified data file.
 * Defensively returns an empty section (no groups/commands) if `runBox.workspaceID`
 * is not set, or if it does not match the `workspaceId` stamped inside the data file
 * (e.g. the file was copied by mistake from a different project) — without deleting
 * anything from disk.
 * @param {string|null} [fsPath] - Optional explicit workspace folder path override
 * @returns {Promise<{ workspaceId: string, groups: object[], commands: object[] }>}
 */
async function readWorkspaceCommandsSection(fsPath) {
  const resolvedFsPath = fsPath || getFirstWorkspaceFolderPath();
  const currentWorkspaceId = readWorkspaceId(resolvedFsPath);

  if (!currentWorkspaceId) {
    return { workspaceId: "", groups: [], commands: [] };
  }

  const filePath = getWorkspaceDataFilePath(fsPath || null);
  const data = await readDataFile(filePath);

  if (data.workspaceCommands.workspaceId !== currentWorkspaceId) {
    return { workspaceId: "", groups: [], commands: [] };
  }

  return data.workspaceCommands;
}

/**
 * Writes the "workspaceCommands" section of the workspace-local unified data file,
 * preserving the existing "variables" and "favorites" sections (read-modify-write).
 * Ensures `runBox.workspaceID` exists (creating it on first write) and stamps it
 * into the section before persisting. Does nothing and returns false if no
 * workspace folder is open.
 * @param {{ groups: object[], commands: object[] }} input - Raw section data (workspaceId is stamped automatically)
 * @param {string|null} [fsPath] - Optional explicit workspace folder path override
 * @returns {Promise<boolean>} wasCreated - true if the local data file was created by this call
 */
async function writeWorkspaceCommandsSection(input, fsPath) {
  const resolvedFsPath = fsPath || getFirstWorkspaceFolderPath();
  const filePath = getWorkspaceDataFilePath(fsPath || null);
  if (!filePath || !resolvedFsPath) {
    return false;
  }

  const workspaceId = await ensureWorkspaceId(resolvedFsPath);
  const normalized = normalizeWorkspaceCommandsSection({ ...input, workspaceId });

  const data = await readDataFile(filePath);
  data.workspaceCommands = normalized;
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
  readWorkspaceId,
  ensureWorkspaceId,
  readWorkspaceCommandsSection,
  writeWorkspaceCommandsSection,
};
