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
  computeCommandFingerprint,
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
  return enqueueWrite(filePath, () => _writeDataFileRaw(filePath, data));
}

/**
 * Unqueued write primitive shared by writeDataFile() and readModifyWriteDataFile().
 * Never call directly outside an already-enqueued task — calling it standalone
 * would bypass write serialization for filePath.
 * @param {string} filePath
 * @param {object} data
 * @returns {Promise<boolean>} wasCreated
 */
async function _writeDataFileRaw(filePath, data) {
  const wasCreated = !(await fileExists(filePath));
  if (!wasCreated) {
    await backupFile(filePath);
  }
  await atomicWriteFile(filePath, JSON.stringify(normalizeDataFile(data), null, 2));
  return wasCreated;
}

/**
 * Reads the freshest on-disk copy of the unified data file, applies `mutateFn`
 * to it in place, and writes the result back — with the entire read-modify-write
 * cycle serialized as one transaction per file path via enqueueWrite.
 *
 * This is the primitive that makes per-item operations (add/update/delete/reorder
 * one group or command) safe against the "last full snapshot wins" data-loss
 * pattern: instead of overwriting the whole section with whatever an old
 * in-memory webview state happened to hold, the mutation is applied to
 * whatever is actually on disk at the moment the transaction runs — including
 * changes written moments earlier by another window on the same machine.
 *
 * `mutateFn` may return a truthy "conflict" object (e.g. `{ conflict: true, ... }`)
 * to abort the write entirely — used by edit-edit conflict detection, where the
 * fresh on-disk copy no longer matches what the caller expected to be editing.
 * When that happens, no write occurs and the returned `conflict` field carries
 * whatever `mutateFn` returned.
 * @param {string} filePath
 * @param {(data: object) => (object|void)} mutateFn - mutates the read data object in place; may return a conflict marker
 * @returns {Promise<{ wasCreated: boolean, data: object, conflict: object|null }>}
 */
async function readModifyWriteDataFile(filePath, mutateFn) {
  return enqueueWrite(filePath, async function () {
    const data = await readDataFile(filePath);
    const conflict = mutateFn(data);
    if (conflict) {
      return { wasCreated: false, data: normalizeDataFile(data), conflict };
    }
    const wasCreated = await _writeDataFileRaw(filePath, data);
    return { wasCreated, data: normalizeDataFile(data), conflict: null };
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
 * Applies a single surgical mutation to the global commands data (categories,
 * groups, commands), reading the freshest on-disk copy immediately before
 * mutating so that any change written moments earlier by another VS Code
 * window (commands.json is shared across ALL windows on this machine,
 * regardless of project) is preserved rather than overwritten by a stale
 * in-memory snapshot from the webview that requested this operation.
 *
 * Supported `op.type` values:
 *   - "addCategory"    { category }
 *   - "renameCategory" { categoryId, title }
 *   - "deleteCategory" { categoryId }
 *   - "addGroup"       { categoryId, group: {id, title} }
 *   - "renameGroup"    { categoryId, groupId, title }
 *   - "deleteGroup"    { categoryId, groupId }
 *   - "addCommand"     { command }
 *   - "updateCommand"  { command, expectedFingerprint? } — replaces the command with
 *       the same id. When `expectedFingerprint` is provided (computed via
 *       computeCommandFingerprint() on the command as it was when the edit
 *       form opened), the current on-disk command's fingerprint is compared
 *       first — if it differs (another VS Code window edited this exact
 *       command in the meantime), the write is aborted and a conflict is
 *       returned instead of silently overwriting that other window's change.
 *   - "deleteCommand"  { commandId }
 *   - "reorderCommands" { orderedIds: string[] }  — same semantics as
 *       applyWorkspaceCommandsOperation's "reorderCommands"
 *   - "clearRecent"    {}                          — clears lastRunAt/runCount on every command
 *
 * @param {{ type: string, [key: string]: any }} op
 * @returns {Promise<{ data: object, conflict: { currentCommand: object }|null }>}
 */
async function applyCommandsDataOperation(op) {
  await ensureGlobalCommandsFile();

  return enqueueWrite(GLOBAL_COMMANDS_FILE, async function () {
    let data;
    try {
      const raw = await fs.readFile(GLOBAL_COMMANDS_FILE, "utf8");
      data = normalizeCommandsData(JSON.parse(raw));
    } catch {
      data = getDefaultCommandsData();
    }

    let conflict = null;

    switch (op.type) {
      case "addCategory": {
        if (op.category) {
          data.categories.push(op.category);
        }
        break;
      }
      case "renameCategory": {
        const category = data.categories.find(function (c) {
          return c.id === op.categoryId;
        });
        if (category) {
          category.title = op.title;
        }
        break;
      }
      case "deleteCategory": {
        data.categories = data.categories.filter(function (c) {
          return c.id !== op.categoryId;
        });
        data.commands = data.commands.filter(function (c) {
          return c.categoryId !== op.categoryId;
        });
        break;
      }
      case "addGroup": {
        const category = data.categories.find(function (c) {
          return c.id === op.categoryId;
        });
        if (category && op.group) {
          category.groups = Array.isArray(category.groups) ? category.groups : [];
          category.groups.push(op.group);
        }
        break;
      }
      case "renameGroup": {
        const category = data.categories.find(function (c) {
          return c.id === op.categoryId;
        });
        const group =
          category &&
          (category.groups || []).find(function (g) {
            return g.id === op.groupId;
          });
        if (group) {
          group.title = op.title;
        }
        break;
      }
      case "deleteGroup": {
        const category = data.categories.find(function (c) {
          return c.id === op.categoryId;
        });
        if (category) {
          category.groups = (category.groups || []).filter(function (g) {
            return g.id !== op.groupId;
          });
          data.commands.forEach(function (c) {
            if (c.categoryId === op.categoryId && c.groupId === op.groupId) {
              c.groupId = "";
            }
          });
        }
        break;
      }
      case "addCommand": {
        if (op.command) {
          data.commands.push(op.command);
        }
        break;
      }
      case "updateCommand": {
        const index = data.commands.findIndex(function (c) {
          return c.id === op.command.id;
        });
        if (index !== -1) {
          if (op.expectedFingerprint && computeCommandFingerprint(data.commands[index]) !== op.expectedFingerprint) {
            conflict = { currentCommand: data.commands[index] };
            break;
          }
          data.commands[index] = op.command;
        }
        break;
      }
      case "deleteCommand": {
        data.commands = data.commands.filter(function (c) {
          return c.id !== op.commandId;
        });
        break;
      }
      case "reorderCommands": {
        const orderedIds = Array.isArray(op.orderedIds) ? op.orderedIds : [];
        const visibleIdSet = new Set(orderedIds);
        const visibleIndices = [];
        data.commands.forEach(function (c, i) {
          if (visibleIdSet.has(c.id)) {
            visibleIndices.push(i);
          }
        });
        const cmdMap = {};
        data.commands.forEach(function (c) {
          cmdMap[c.id] = c;
        });
        orderedIds.forEach(function (id, idx) {
          if (idx < visibleIndices.length && cmdMap[id]) {
            data.commands[visibleIndices[idx]] = cmdMap[id];
          }
        });
        break;
      }
      case "clearRecent": {
        data.commands.forEach(function (c) {
          delete c.lastRunAt;
          delete c.runCount;
        });
        break;
      }
      default:
        break;
    }

    const normalized = normalizeCommandsData(data);

    if (conflict) {
      return { data: normalized, conflict };
    }

    if (await fileExists(GLOBAL_COMMANDS_FILE)) {
      await backupFile(GLOBAL_COMMANDS_FILE);
    }
    await atomicWriteFile(GLOBAL_COMMANDS_FILE, JSON.stringify(normalized, null, 2));
    return { data: normalized, conflict: null };
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
 *
 * WARNING: this replaces the ENTIRE "commands" map with `input`. The webview
 * only ever sends variable drafts for commands it has loaded into memory
 * since the panel was last hydrated — any per-command variable values another
 * VS Code window wrote in the meantime for a DIFFERENT command are silently
 * lost. Prefer mergeWorkspaceVariables() for the normal single-save flow
 * (handleSaveCommandVariables); this full-replace form is kept only for
 * scenarios that legitimately need to overwrite the whole section at once.
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
 * Merges per-command variable values into the "variables" section of the
 * workspace-local unified data file, reading the freshest on-disk copy
 * immediately before merging so that variable values another VS Code window
 * wrote moments earlier — for a DIFFERENT command than the one being saved
 * here — are preserved instead of being erased by a stale in-memory snapshot.
 * Only the commands present as keys in `input.commands` are overwritten (each
 * one entirely, since a command's variables are always saved as a whole from
 * the webview's per-command draft); every other command's entry on disk is
 * left untouched. Does nothing and returns false if no workspace folder is
 * open.
 * @param {object} input - Raw variables section data; only its command keys are merged in
 * @param {string|null} [fsPath] - Optional explicit workspace folder path override
 * @returns {Promise<boolean>} wasCreated - true if the local data file was created by this call
 */
async function mergeWorkspaceVariables(input, fsPath) {
  const filePath = getWorkspaceDataFilePath(fsPath || null);
  if (!filePath) {
    return false;
  }

  const normalizedInput = normalizeVariablesSection(input);
  const { wasCreated } = await readModifyWriteDataFile(filePath, function (data) {
    const existing = data.variables && typeof data.variables === "object" ? data.variables.commands || {} : {};
    const merged = Object.assign({}, existing);

    for (const [commandId, vars] of Object.entries(normalizedInput.commands)) {
      if (Object.keys(vars).length === 0) {
        delete merged[commandId];
      } else {
        merged[commandId] = vars;
      }
    }

    data.variables = normalizeVariablesSection({ commands: merged });
  });

  return wasCreated;
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
 *
 * WARNING: this replaces the ENTIRE "commands" map with `input`, exactly like
 * writeWorkspaceVariables(). Prefer mergeGlobalVariables() for the normal
 * single-save flow (handleSaveCommandVariables).
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
 * Merges per-command variable values into the "variables" section of the
 * global unified data file. Mirrors mergeWorkspaceVariables() — reads the
 * freshest on-disk copy immediately before merging, so values another VS Code
 * window wrote moments earlier for a different command are preserved.
 * @param {object} input - Raw variables section data; only its command keys are merged in
 * @returns {Promise<boolean>} wasCreated - true if the global data file was created by this call
 */
async function mergeGlobalVariables(input) {
  const filePath = getGlobalDataFilePath();
  const normalizedInput = normalizeVariablesSection(input);

  const { wasCreated } = await readModifyWriteDataFile(filePath, function (data) {
    const existing = data.variables && typeof data.variables === "object" ? data.variables.commands || {} : {};
    const merged = Object.assign({}, existing);

    for (const [commandId, vars] of Object.entries(normalizedInput.commands)) {
      if (Object.keys(vars).length === 0) {
        delete merged[commandId];
      } else {
        merged[commandId] = vars;
      }
    }

    data.variables = normalizeVariablesSection({ commands: merged });
  });

  return wasCreated;
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
 *
 * WARNING: this replaces the ENTIRE section with `input` — any group/command
 * added or removed by another window between this window's last read and this
 * write is silently lost. Prefer applyWorkspaceCommandsOperation() for any
 * single-item mutation (add/rename/delete one group or command, reorder).
 * This full-replace form only remains appropriate for bulk operations that
 * legitimately need to replace the whole section at once (e.g. AI bulk insert
 * building an entirely new set in one step from an empty/known baseline).
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

/**
 * Applies a single surgical mutation to the "workspaceCommands" section, reading
 * the freshest on-disk copy immediately before mutating so that any change
 * written moments earlier by another window (add/delete/edit) is preserved
 * rather than being overwritten by a stale in-memory snapshot from the webview
 * that requested this operation.
 *
 * Supported `op.type` values:
 *   - "addGroup"      { group: {id, title} }
 *   - "renameGroup"   { groupId, title }
 *   - "deleteGroup"   { groupId }
 *   - "addCommand"    { command }
 *   - "updateCommand" { command, expectedFingerprint? } — replaces the command with
 *       the same id. When `expectedFingerprint` is provided (computed via
 *       computeCommandFingerprint() on the command as it was when the edit form
 *       opened), the current on-disk command's fingerprint is compared first —
 *       if it differs (another window edited this exact command in the
 *       meantime), the write is aborted and a conflict is returned instead of
 *       silently overwriting that other window's change.
 *   - "deleteCommand" { commandId }
 *   - "reorderCommands" { orderedIds: string[] } — new order for exactly the given
 *       (already-visible/filtered) command ids; any id no longer present on disk
 *       (deleted by another window) is silently skipped; commands not mentioned
 *       in orderedIds (added by another window, not visible in this window's
 *       current filter) keep their existing position untouched.
 *
 * @param {{ type: string, [key: string]: any }} op
 * @param {string|null} [fsPath] - Optional explicit workspace folder path override
 * @returns {Promise<{ wasCreated: boolean, workspaceCommands: object, conflict: { currentCommand: object }|null }>}
 */
async function applyWorkspaceCommandsOperation(op, fsPath) {
  const resolvedFsPath = fsPath || getFirstWorkspaceFolderPath();
  const filePath = getWorkspaceDataFilePath(fsPath || null);
  if (!filePath || !resolvedFsPath) {
    return { wasCreated: false, workspaceCommands: { workspaceId: "", groups: [], commands: [] }, conflict: null };
  }

  const workspaceId = await ensureWorkspaceId(resolvedFsPath);

  const { wasCreated, data, conflict } = await readModifyWriteDataFile(filePath, function (data) {
    const section = data.workspaceCommands || { workspaceId: "", groups: [], commands: [] };
    section.workspaceId = workspaceId;
    section.groups = Array.isArray(section.groups) ? section.groups : [];
    section.commands = Array.isArray(section.commands) ? section.commands : [];

    switch (op.type) {
      case "addGroup": {
        if (op.group) {
          section.groups.push(op.group);
        }
        break;
      }
      case "renameGroup": {
        const group = section.groups.find(function (g) {
          return g.id === op.groupId;
        });
        if (group) {
          group.title = op.title;
        }
        break;
      }
      case "deleteGroup": {
        section.groups = section.groups.filter(function (g) {
          return g.id !== op.groupId;
        });
        section.commands.forEach(function (c) {
          if (c.groupId === op.groupId) {
            c.groupId = "";
          }
        });
        break;
      }
      case "addCommand": {
        if (op.command) {
          section.commands.push(op.command);
        }
        break;
      }
      case "updateCommand": {
        const index = section.commands.findIndex(function (c) {
          return c.id === op.command.id;
        });
        if (index !== -1) {
          if (op.expectedFingerprint && computeCommandFingerprint(section.commands[index]) !== op.expectedFingerprint) {
            return { currentCommand: section.commands[index] };
          }
          section.commands[index] = op.command;
        }
        break;
      }
      case "deleteCommand": {
        section.commands = section.commands.filter(function (c) {
          return c.id !== op.commandId;
        });
        break;
      }
      case "reorderCommands": {
        const orderedIds = Array.isArray(op.orderedIds) ? op.orderedIds : [];
        const visibleIdSet = new Set(orderedIds);
        const visibleIndices = [];
        section.commands.forEach(function (c, i) {
          if (visibleIdSet.has(c.id)) {
            visibleIndices.push(i);
          }
        });
        const cmdMap = {};
        section.commands.forEach(function (c) {
          cmdMap[c.id] = c;
        });
        orderedIds.forEach(function (id, idx) {
          if (idx < visibleIndices.length && cmdMap[id]) {
            section.commands[visibleIndices[idx]] = cmdMap[id];
          }
        });
        break;
      }
      default:
        break;
    }

    data.workspaceCommands = normalizeWorkspaceCommandsSection(section);
    return undefined;
  });

  return { wasCreated, workspaceCommands: data.workspaceCommands, conflict: conflict || null };
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
  applyCommandsDataOperation,
  readDataFile,
  writeDataFile,
  readWorkspaceVariables,
  writeWorkspaceVariables,
  mergeWorkspaceVariables,
  readGlobalVariables,
  writeGlobalVariables,
  mergeGlobalVariables,
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
  applyWorkspaceCommandsOperation,
};
