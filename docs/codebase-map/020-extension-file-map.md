# Extension Side — File Map

## `extension.js`

**Entry point.** Panel creation, status bar item, `onDidReceiveMessage` routing dispatch table, `postState()`, `getWebviewHtml()`. Does **not** contain any business logic — delegates everything to `lib/`.

**`postState(panel)`** is defined as a closure inside `activate()` so it has access to `context` (the `ExtensionContext`). On every call it: reads `context.workspaceState.get("activeWorkspaceFolder")`, resolves the active workspace folder via `resolveActiveWorkspaceFolder()`, syncs `workspaceState` if the resolved value differs from what was stored (e.g. the saved folder was removed from the workspace), and sends `workspaceFolders: Array<{ name, fsPath }>` alongside the resolved `workspaceFolder` in the state payload to the webview.

**Per-workspace UI selection preferences (`uiPreferences`):** the last-used active tab, selected category/group (Commands tab), selected group (Categories & Groups tab), and favorites scope are stored in `context.workspaceState.get("uiPreferences")`, an object keyed by preference name, merged over `UI_PREFERENCE_DEFAULTS` (`extension.js`) before being sent as `payload.uiPreferences` on every `postState()`. This is scoped per-workspace (unlike the webview's `localStorage`, which is shared globally across every VS Code window on the machine) so that closing the panel on one project and reopening it on an unrelated project never leaks the other project's last tab/category/group selection. When no folder is open (empty window), `context.workspaceState` has no stable per-project identity, so reads simply fall back to `UI_PREFERENCE_DEFAULTS` each time, which is expected. The webview applies `payload.uiPreferences` to `uiState` only once, on the very first `"state"` message after `"ready"` (guarded by `uiPreferencesHydrated`, `media/state.js`); every later `"state"` message leaves the user's current in-session selections untouched. Each selection change is sent immediately to the extension via a `saveUiPreference` message (`saveUiPreference(key, value)`, `media/utils.js`), which writes only that one key into `context.workspaceState` without triggering a full `postState()` refresh.

**`setupPanel(targetPanel)`** wires up a brand-new webview panel (sets `iconPath`, computes `isDev`/`devModuleFiles`, sets `webview.html`, attaches the `onDidReceiveMessage` dispatch table, registers `onDidDispose`, and calls `postState(targetPanel)`). It is only ever called once, by the `runBox.openPanel` command, right after `createWebviewPanel()`. `targetPanel.onDidDispose` only nulls the outer `panel` variable when `panel === targetPanel`, so a stale dispose from a superseded panel can never null out a newer, still-open one.

**`ping` / `pong` heartbeat:** the very first branch of the dispatch table replies to `{ type: "ping" }` with `{ type: "pong" }` immediately, with no dependency on any business state or file I/O. It backs the independent connection-watchdog heartbeat in `media/connection-watchdog.js`, which detects a silently dropped connection and is deliberately never coupled to business message replies (see `docs/codebase-map/080-message-flow.md`).

**No `registerWebviewPanelSerializer` (intentional):** `runBox.openPanel` does not register a panel-revival serializer for `"runBoxPanel"`. VS Code's own webview-revival mechanism was tested and found unreliable across extension host restarts and window reloads on both VS Code 1.138.0 stable and 1.139.0-insider: a revived panel repeatedly got stuck as a permanently blank screen with an endless loading indicator instead of restoring correctly (tracked upstream at [microsoft/vscode#225410](https://github.com/microsoft/vscode/issues/225410), fixed by the still-unmerged [microsoft/vscode#226069](https://github.com/microsoft/vscode/pull/226069)). Without a serializer, VS Code does not persist the panel across a reload at all — the panel simply closes instead of coming back as an unrecoverable orphaned blank screen, and the user reopens it via the command/status bar/keybinding, which always creates a clean new panel through `setupPanel`. The `ping`/`pong` heartbeat above still covers the case where the panel's DOM survives a host restart while the extension side does not: it detects the dead connection and tells the user to close and reopen the panel, which is guaranteed to work since it always creates a brand-new panel.

**Re-asserting `targetPanel.webview.options` inside `setupPanel`:** kept as a cheap safety net even though there is currently no panel-revival path — `setupPanel` re-sets `targetPanel.webview.options = { enableScripts: true }` as its very first statement, before setting `webview.html`. This is a no-op today since it is already the same value set at creation time in `runBox.openPanel`, but protects against a silent regression (every `<script>` tag in the injected HTML being blocked) if a revival path is ever reintroduced, since a revived panel would not retain the original `enableScripts` option.

**`safePostMessage(targetPanel, message)`:** wraps every `targetPanel.webview.postMessage(...)` call made by `extension.js` itself (`collectAndPostState`'s `"state"` message, and the `ping` → `pong` heartbeat reply) in a `try/catch` that silently swallows the "Webview is disposed" error VS Code throws when the panel was closed while the call was still in flight (e.g. `collectAndPostState` was awaiting disk reads, or a `ping` arrived just as the panel was disposed). Without this, that error propagates as an unhandled rejection; enough of them in quick succession make VS Code judge the extension host unstable and force-restart it, killing every other open panel/session in the same window, not just the disposed one. `lib/handlers.js` has its own large set of `panel.webview.postMessage` calls after async I/O that are not yet wrapped this way — out of scope for this fix, tracked separately.

**Multi-root message handling in the dispatch table:**

- `setActiveWorkspaceFolder` — stores the user-selected folder path in `context.workspaceState` and calls `postState()` to refresh the webview.
- `saveCommandVariables`, `saveFavorites`, `openLocalDataFile` — before delegating to `lib/handlers.js`, the dispatch table reads `context.workspaceState.get("activeWorkspaceFolder")` and injects it as `activeFsPath` in the payload so handlers write to the correct `.vscode/` folder.

- `performAction` — `activeFsPath` comes from the webview payload directly (set by the run-confirm folder dropdown, not injected by the dispatch table).

**VS Code setting:** `runBox.multiRootFolderResolution` controls how the active folder is resolved when the panel opens in a multi-root workspace. Values: `"remember"` (default — persists the user's last selection in `workspaceState`), `"followEditor"` (uses the active text editor's folder, falls back to `workspaceState`), `"alwaysFirst"` (always uses `workspaceFolders[0]`). Has no effect in single-folder workspaces.

## `lib/normalize.js`

**Pure data normalization.** No file I/O, no VS Code API.

| Export | Description |
| - | - |
| `sanitizeId(value)` | Trims and lowercases a string; returns `""` for non-strings |
| `sanitizeTitle(value)` | Trims whitespace from display title |
| `getDefaultCommandsData()` | Returns `{ version:1, categories:[], commands:[] }` |
| `normalizeCommandsData(input)` | Validates/normalizes raw commands JSON; deduplicates IDs |
| `normalizeVariablesSection(input)` | Normalizes the "variables" section to `{ commands:{} }` |
| `normalizeFavoritesSection(input)` | Normalizes the "favorites" section to `{ commandIds:[] }` |
| `normalizeDataFile(input)` | Normalizes the full unified data file via `DATA_SECTIONS` |
| `normalizeGroups(input)` | Normalizes groups array (string and object items) |
| `normalizeVariableMeta(input)` | Validates and normalizes `variableMeta` for enum variables |
| `normalizeWorkspaceCommandsSection(input)` | Normalizes the "workspaceCommands" section — `{ workspaceId, groups, commands }` — the private "Current Workspace" pseudo-category content. Commands here have no `categoryId` field (implicitly belong to the single pseudo-category) and are validated similarly to `normalizeCommandsData`, minus the category check. |

`DATA_SECTIONS` is a registry object mapping each section name (`variables`, `favorites`, `workspaceCommands`) to its `{ default, normalize }` pair. `normalizeDataFile` walks this registry — it contains no section-specific validation logic itself. Adding a new section in the future requires only one new entry here plus a matching `readXxx`/`writeXxx` pair in `lib/storage.js`.

**Dependencies:** None.

---

## `lib/storage.js`

**All file I/O and path constants.** Single source of truth for data persistence.

| Export | Type | Description |
| - | :---: | - |
| `GLOBAL_DIR` | const | `~/.runbox/` |
| `GLOBAL_COMMANDS_FILE` | const | Path to `commands.json` |
| `GLOBAL_DATA_FILE` | const | Path to the unified `data.json` (holds both `variables` and `favorites` sections) |
| `GLOBAL_AUTO_VARIABLES_SETTINGS_FILE` | const | Path to `auto-variables-settings.json` |
| `fileExists(filePath)` | fn | Promise-based file existence check |
| `getFirstWorkspaceFolderPath()` | fn | Returns `fsPath` of the first open workspace folder, or `null`. Used as a fallback by all workspace-local functions. |
| `getAllWorkspaceFolders()` | fn | Returns all open workspace folders as `Array<{ name: string, fsPath: string }>`. Returns `[]` when no workspace is open. Used by `postState()` to send the full folder list to the webview. |
| `resolveActiveWorkspaceFolder(savedFsPath)` | fn | Resolves the workspace folder to use as the active one, taking into account the `runBox.multiRootFolderResolution` setting. **In single-folder workspaces always returns the only folder, ignoring all other logic.** In multi-root: `"remember"` → saved → editor → first; `"followEditor"` → editor → saved → first; `"alwaysFirst"` → always first. `savedFsPath` is the value previously stored in `context.workspaceState`. |
| `getWorkspaceDataFilePath(fsPath?)` | fn | Returns the `.vscode/runbox.data.json` path inside `fsPath` (or inside the first workspace folder if `fsPath` is omitted/null). Returns `null` if no workspace is open. |
| `ensureGlobalCommandsFile()` | fn | Creates global dir + default commands file if missing |
| `readCommandsData()` | fn | Reads + parses `commands.json`; falls back to default |
| `writeCommandsData(data)` | fn | Serializes commands data to the commands JSON file |
| `readDataFile(filePath)` | fn | Reads and normalizes the unified data file at `filePath`. The only function that reads the unified data file from disk. Returns normalized defaults on missing/invalid path or file. |
| `writeDataFile(filePath, data)` | fn | Normalizes and writes the unified data file to `filePath`. The only function that writes the unified data file to disk. Returns `wasCreated: boolean`. |
| `readWorkspaceVariables(fsPath?)` | fn | Reads the "variables" section of the workspace-local unified data file (or first folder if fsPath omitted) |
| `writeWorkspaceVariables(data, fsPath?)` | fn | Writes the "variables" section of the workspace-local unified data file via read-modify-write, preserving "favorites". Returns `wasCreated: boolean`. |
| `readGlobalVariables()` | fn | Reads the "variables" section of the global unified data file |
| `writeGlobalVariables(input)` | fn | Writes the "variables" section of the global unified data file via read-modify-write, preserving "favorites". Returns `wasCreated: boolean`. |
| `readAutoVariablesSettings()` | fn | Reads auto-variables settings; returns defaults on error |
| `writeAutoVariablesSettings(settings)` | fn | Writes auto-variables settings to disk |
| `readGlobalFavorites()` | fn | Reads the "favorites" section of the global unified data file; returns `[]` on error |
| `readWorkspaceFavorites(fsPath?)` | fn | Reads the "favorites" section of the workspace-local unified data file (or first folder if fsPath omitted); returns `[]` on error |
| `writeGlobalFavorites(commandIds)` | fn | Writes the "favorites" section of the global unified data file via read-modify-write, preserving "variables". Returns `wasCreated: boolean`. |
| `writeWorkspaceFavorites(commandIds, fsPath?)` | fn | Writes the "favorites" section of the workspace-local unified data file via read-modify-write, preserving "variables". Returns `wasCreated: boolean`. |
| `readWorkspaceId(fsPath)` | fn | Reads the `runBox.workspaceID` setting for the given folder without creating one. Returns `""` if unset or if `fsPath` is `null`. |
| `ensureWorkspaceId(fsPath)` | fn | Returns the existing `runBox.workspaceID`, or generates one via `crypto.randomUUID()` and persists it with `vscode.ConfigurationTarget.WorkspaceFolder` if none exists yet. Called only at the moment of an actual "Current Workspace" write (add group/command) — never merely on panel open. |
| `readWorkspaceCommandsSection(fsPath?)` | fn | Reads the "workspaceCommands" section of the workspace-local unified data file. Defensively returns an empty section (no groups/commands) if `runBox.workspaceID` is unset or does not match the `workspaceId` stamped inside the file — without deleting anything from disk. |
| `writeWorkspaceCommandsSection(input, fsPath?)` | fn | **Full-section overwrite.** Writes the "workspaceCommands" section via read-modify-write, preserving "variables"/"favorites". Only appropriate for bulk replacements (e.g. AI bulk insert); any single add/rename/delete/reorder must use `applyWorkspaceCommandsOperation` instead. |
| `applyWorkspaceCommandsOperation(op, fsPath?)` | fn | Applies a single surgical mutation to the "workspaceCommands" section (`addGroup`, `renameGroup`, `deleteGroup`, `addCommand`, `updateCommand`, `deleteCommand`, `reorderCommands`). Reads the freshest on-disk copy immediately before mutating, so a change written moments earlier by another VS Code window is preserved instead of being erased. |
| `applyCommandsDataOperation(op)` | fn | Same surgical-mutation model, but against the global `commands.json` (`addCategory`, `renameCategory`, `deleteCategory`, `addGroup`, `renameGroup`, `deleteGroup`, `addCommand`, `updateCommand`, `deleteCommand`, `reorderCommands`, `clearRecent`). `commands.json` is shared across **every** VS Code window regardless of project, so this is the primary defense against cross-project data loss for regular categories. |

**Dependencies:** `fs/promises`, `os`, `path`, `crypto`, `vscode`, `lib/normalize.js`.

### Write Safety: Serialization, Atomicity, Concurrency

All persisted JSON writes funnel through:

- **`enqueueWrite(filePath, fn)`** — a per-file-path `Promise` queue so two writes to the same file from this extension host never run concurrently (VS Code's `onDidReceiveMessage` does not serialize async handlers).
- **`atomicWriteFile(filePath, content)`** — writes to a temp sibling file then `fs.rename()`s it into place; `rename` is atomic at the OS level, so the target is always either fully old or fully new content, never a corrupted partial write.
- **`backupFile(filePath)`** — copies the current valid content to a `.bak` sibling before overwriting. `readDataFile`/`readCommandsData` recover from `.bak` (and warn the user) if the main file is ever found corrupted.
- **`readModifyWriteDataFile(filePath, mutateFn)`** — the transaction behind `applyWorkspaceCommandsOperation`/`applyCommandsDataOperation`: reads the freshest on-disk copy, mutates in place, writes back, all serialized as one unit via `enqueueWrite`.

This closes two failure modes: (1) corrupted JSON from overlapping writes to the same file, and (2) cross-window data loss, where a second VS Code window saving its own stale in-memory snapshot would silently erase changes another window wrote moments earlier. (2) is solved by the webview sending only the operation itself (`{ type, ... }` via the `applyOperation` message) rather than a full section snapshot, applied against a fresh disk read taken at write time.

### Cross-Window Live Refresh (File Watchers)

`extension.js` watches `GLOBAL_COMMANDS_FILE` (wrapped in a `RelativePattern` rooted at `GLOBAL_DIR` — a plain absolute path outside any workspace folder would fall back to Node's raw `fs.watch` tracking the file by inode, which silently stops firing after the first `atomicWriteFile` rename replaces that inode) and each open workspace folder's `runbox.data.json` (rebuilt on `onDidChangeWorkspaceFolders`) via `vscode.workspace.createFileSystemWatcher`. Any change/create/delete calls `postState(panel)` to refresh the open panel with the latest disk content. This is safe because `state.data`/`state.workspaceCommands` are pure disk mirrors, while an in-progress "Add/Edit Command" form edit lives in the separate `commandFormBuffer` working copy that `hydrateState()` never touches — so external changes never discard unsaved keystrokes in an open edit form.

`postState()` itself is serialized+coalesced (not called directly — see the `postStateInFlight`/`postStateRerunQueued` closure in `extension.js`): a single logical change (e.g. `handleSaveCommandMove` writing two separate files) can trigger `postState()` from multiple independent sources in quick succession — the handler's own explicit call plus one file-watcher callback per file it wrote. Since each call independently re-reads disk before posting to the webview, running them concurrently would be a race where whichever finishes last "wins" regardless of which reflects the most complete data. At most one `collectAndPostState()` runs at a time, with at most one pending re-run queued (never a growing backlog).

### Edit-Edit Conflict Detection

`updateCommand` operations may include an `expectedFingerprint` (computed via `computeCommandFingerprint()` — implemented identically in `lib/normalize.js` and `media/utils.js` — from the command object exactly as it was when the "Edit Command" form opened). `applyWorkspaceCommandsOperation`/`applyCommandsDataOperation` compare this against the fingerprint of the freshest on-disk copy of that same command before writing; a mismatch means another VS Code window saved a change to this exact command in between, so the write is aborted (no data is overwritten) and a `{ conflict: { currentCommand } }` result is returned instead. `handleApplyOperation` (`lib/handlers.js`) forwards this as `applyOperationResult` with `conflict: true` and deliberately does **not** call `postState()` in this case, since the user still has a pending choice to make. The webview shows `editConflictState`'s modal (`renderEditConflictModal()`/`bindEditConflictModalEvents()`, `media/modals/command-form.js`) with two options: "Overwrite anyway" (resubmits `editConflictState.pendingCommand` without a fingerprint, forcing the write) or "Discard my changes" (sends `requestState` to reload the authoritative disk content). This only applies to `updateCommand` — add/delete/reorder operations have no equivalent "same item, conflicting content" scenario and cannot be resolved by any automatic merge.

---

## `lib/terminal.js`

**Terminal shell resolution and lifecycle management.**

| Export | Description |
| - | - |
| `fixShellPath(rawPath)` | Replaces `\Sysnative\` with `\System32\` on Windows |
| `resolveSourceProfilePath(source)` | Resolves shell path from a VS Code profile source name |
| `getTerminalProfiles()` | Reads terminal profiles from VS Code settings. Each returned profile includes a `shellType` field (see `detectShellType` below), used to match profiles against a command's `targetShell`. |
| `getOrCreateTerminal(shellPath, shellName, cwd?)` | Returns the active terminal or creates a new one. When `cwd` is provided, always creates a new terminal that opens at the specified directory — reusing an existing terminal would ignore the `cwd`. Used by `handlePerformAction` to open the terminal in the workspace folder selected in the run-confirm modal. |
| `detectShellType(shellPath)` | Classifies a shell executable path into a standardized identifier: `"pwsh"` (PowerShell 7+), `"powershell"` (Windows PowerShell 5.1), `"cmd"`, `"bash"`, `"wsl"`, `"zsh"`, `"sh"`, or `null` if unrecognized. See "Target Shell System" below. |

**Dependencies:** `vscode`, `fs` (sync `accessSync` only).

---

## `lib/handlers.js`

**All webview message handler functions.** Each handler receives `panel` + `payload` (+ `postState` when a re-render is needed after saving).

`handleSaveCommandVariables` accepts `{ local, global }` payload format — saves local and global variable scopes independently to their respective files without one overwriting the other.

**Multi-root `activeFsPath` convention:** handlers that write to `.vscode/` files (`handleSaveCommandVariables`, `handlePerformAction`, `handleSaveFavorites`, `openLocalDataFile`) read `payload.activeFsPath` (or accept it as a parameter) to determine which workspace folder's `.vscode/` directory to target. When `activeFsPath` is absent or `null`, they fall back to `getFirstWorkspaceFolderPath()`. This value is injected by the dispatch table in `extension.js` for panel-level actions, and comes from the webview payload directly for run-confirm execution actions.

| Export | Message Type | Description |
| - | - | - |
| `handleSaveCommandsData(panel, payload, postState)` | `saveData` | Normalizes and saves commands; posts `saveResult` |
| `handleSaveCommandVariables(panel, payload)` | `saveCommandVariables` | Saves local/global variables independently; reads `payload.activeFsPath` to write to the correct workspace folder; posts `saveVariablesResult` |
| `handlePerformAction(panel, payload, postState)` | `performAction` | Runs copy/run/use action; reads `payload.activeFsPath` to resolve `${workspaceFolder}`, write local variables, and open the terminal with `cwd`; updates stats; posts `actionResult` |
| `handleOpenExternalUrl(payload)` | `openExternalUrl` | Opens URL via `vscode.env.openExternal` |
| `handlePickFile(panel, payload, context)` | `pickFile` | Shows a native single-file `showOpenDialog`, defaulting to the folder of the last file picked in this VS Code window (`context.workspaceState.get("lastPickFileDir")`); saves the picked file's folder back to `workspaceState` for next time; posts `pickFileResult` with the selected `fsPath` (or nothing if cancelled) |
| `openGlobalCommandsFile()` | `openCommandsFile` | Ensures + opens `commands.json` in VS Code editor |
| `openGlobalDataFile()` | `openGlobalDataFile` | Opens global unified data file (prompts to create if missing) |
| `openLocalDataFile(activeFsPath?)` | `openLocalDataFile` | Opens workspace unified data file for the given folder (or first folder if omitted); prompts to create if missing |
| `handleAiGetSettings(panel, context)` | `aiGetSettings` | Reads AI secrets + provider config; posts `aiSettingsResult` |
| `handleAiSaveSettings(panel, context, payload)` | `aiSaveSettings` | Saves API key to `SecretStorage`; posts `aiSaveSettingsResult` |
| `handleAiGenerate(panel, context, payload)` | `aiGenerate` | Reads `shellName` from payload; passes it to `generateWithAI` to inject shell context; posts `aiGenerateResult` |
| `handleAiInsert(panel, payload, postState)` | `aiInsert` | Merges AI-generated commands; posts `aiInsertResult` |
| `handleSaveWorkspaceCommandsData(panel, payload, postState)` | `saveWorkspaceCommandsData` | **Full-section overwrite** of the "Current Workspace" pseudo-category via `writeWorkspaceCommandsSection`; posts `saveWorkspaceCommandsDataResult`. Only used for bulk replacements — single add/rename/delete/reorder actions use `applyOperation` instead (see below). |
| `handleApplyOperation(panel, payload, postState)` | `applyOperation` | Applies one surgical mutation (`op.type`: add/rename/delete one category, group, or command, or reorder) to either `commands.json` (`scope: "global"`) or the workspace-local "Current Workspace" section (`scope: "workspace"`), via `applyCommandsDataOperation`/`applyWorkspaceCommandsOperation` (`lib/storage.js`) — read-modify-write against the freshest on-disk copy, safe against multi-window data loss. For `updateCommand` with an `expectedFingerprint` that no longer matches the on-disk command (another window edited it in the meantime), aborts without writing and posts `applyOperationResult` with `{ conflict: true, currentCommand }` instead of calling `postState`. Otherwise posts `{ success: true/false }`. |
| `handleSaveCommandMove(panel, payload, postState)` | `saveCommandMove` | Moves a single command between a regular category (`commands.json`) and "Current Workspace" (`runbox.data.json`) as two surgical operations (delete from source, add to destination) via `applyCommandsDataOperation`/`applyWorkspaceCommandsOperation` — never a full-file snapshot overwrite of either file; posts `saveResult`. |
| `handleAiInsertWorkspace(panel, payload, postState)` | `aiInsertWorkspace` | Merges AI-generated commands (and, for `full` mode, groups) into `workspaceCommands` instead of a regular category; posts `aiInsertResult` |
| `handleSaveAutoVariablesSettings(panel, payload, postState)` | `saveAutoVariablesSettings` | Saves auto-variables settings; posts result |
| `handleSaveFavorites(panel, payload)` | `saveFavorites` | Saves global/workspace favorites; posts `saveFavoritesResult` |
| `handleAiListModels(panel, context, payload)` | `aiListModels` | Fetches model list for one provider using its saved API key; posts `aiListModelsResult` |
| `handleAiRefreshAllModels(panel, context)` | `aiRefreshAllModels` | Fetches model lists for **all** providers that have a saved key in parallel (`Promise.allSettled`); posts one `aiListModelsResult` per provider |
| `handleAiExplain(panel, context, payload)` | `aiExplain` | Calls `explainWithAI` with the provider/model from settings; posts `aiExplainResult` with a raw Markdown string |
| `handleAiCheckConnection(panel, context, payload)` | `aiCheckConnection` | Wraps `checkProviderConnection` in a `vscode.window.withProgress` notification; posts `aiCheckConnectionResult` with `{ success, providerName, serviceName, modelId, responseTimeMs }` or `{ success:false, message }` |
| `handleAiCheckRateLimits(panel, context, payload)` | `aiCheckRateLimits` | If the provider's `hasApiRateLimits` is `false`, responds immediately with `{ supported:false, serviceName, rateLimitsUrl }` — no network call, no progress notification. Otherwise wraps `checkProviderRateLimits` in `vscode.window.withProgress`; posts `aiCheckRateLimitsResult` with `{ supported:true, serviceName, modelId, limits }` |

**Local data file creation notice:** `writeWorkspaceVariables` and `writeWorkspaceFavorites` (in `lib/storage.js`) return `wasCreated: boolean`. When `handleSaveCommandVariables` or `handleSaveFavorites` receive `wasCreated === true` from a workspace-local write, they call the private helper `notifyLocalDataFileCreated(activeFsPath)`, which shows a one-time `vscode.window.showInformationMessage` with the text `Created file "<dir>/runbox.data.json". You can change this location anytime in workspace settings.` and an "Open Settings" action that jumps to `runBox.localWorkspaceFilesPath`. This call is not awaited by its callers so it never delays the response sent back to the webview. It never fires for the global data file. `handlePerformAction` never triggers this notice because it no longer writes variables to disk (see its own doc entry below).

**Dependencies:** `lib/storage.js`, `lib/normalize.js`, `lib/terminal.js`, `lib/auto-variables.js`, `lib/ai/factory.js`, `lib/ai/providers-config.js`, `vscode`.

## "Current Workspace" Pseudo-Category

A fixed, non-deletable entry — `CURRENT_WORKSPACE_CATEGORY_ID = "__current_workspace__"` (defined in `media/state.js`) — that always appears first in both the Categories panel and the Commands Browser dropdown whenever a workspace folder is open, regardless of whether any real category exists. It holds commands and groups private to this one workspace folder; they are never written to the shared global `commands.json` and never appear in any other project.

- **Storage:** lives in the `workspaceCommands` section of the workspace-local `runbox.data.json` (`{ workspaceId, groups, commands }`). Commands in this section have no `categoryId` field.
- **Linking ID:** `runBox.workspaceID` (a `resource`-scoped VS Code setting, so each folder in a multi-root workspace gets an independent value) is generated via `crypto.randomUUID()` only at the moment of the _first write_ (adding a group or a command) — never merely by opening the panel. `readWorkspaceCommandsSection()` defensively returns an empty section if the setting is unset or does not match the `workspaceId` stamped inside the file.
- **Webview access:** `state.workspaceId` and `state.workspaceCommands` (hydrated in `hydrateState()`, `media/render.js`). `getSelectedCategory()` (`media/utils.js`) returns a synthetic category object (`{ id: CURRENT_WORKSPACE_CATEGORY_ID, title: "Current Workspace", groups, isCurrentWorkspace: true }`) when this pseudo-category is selected, so `getSelectedCategoryGroups()`/`getVisibleCommands()` resolve generically without special-casing at every call site.
- **Helpers (`media/utils.js`):** `isCurrentWorkspaceCategory(categoryId)`, `isWorkspaceCommand(commandId)`, `findCommandById(commandId)` (searches both `state.data.commands` and `state.workspaceCommands.commands` — used by every action button binding since a command being acted on may belong to either source), `persistWorkspaceCommandsThenRender(successMessage?)` (mirrors `persistDataThenRender`, posts `saveWorkspaceCommandsData`).
- **Add/Edit Command form:** `commandFormBuffer.categoryId` can hold `CURRENT_WORKSPACE_CATEGORY_ID`. `submitEditCommand()` supports **moving** a command between "Current Workspace" and a regular category — it removes the command from its old array and pushes it into the new one, then persists the move as a single `saveCommandMove` message (payload `{ command, direction: "toWorkspace"|"toGlobal" }`) via `persistCommandMoveThenRender(command, direction, successMessage?)` (`media/utils.js`), handled by `handleSaveCommandMove` (`lib/handlers.js`). The extension applies the move as two surgical operations — delete from the source file, add to the destination file — each via `applyCommandsDataOperation()`/`applyWorkspaceCommandsOperation()` (`lib/storage.js`), which read-modify-write against the freshest on-disk copy of each file rather than overwriting either file with a full in-memory snapshot. Moving a command out of a regular category into "Current Workspace" also strips it from Global favorites (see below) via a separate, unrelated `saveFavorites` message — that one is safe to send independently since it does not touch the same two files.
- **Favorites restriction:** commands under "Current Workspace" can only ever be **Local Workspace** favorites — the Global option/shortcuts (`Ctrl+Click`, `Ctrl+Right-Click`, `Ctrl+Shift+*`) are hidden or ignored for them in `renderActionsCell()`, the Manage Favorites modal (`renderFavoriteModal()`), and the click/contextmenu handlers in `media/tabs/commands.js`.
- **Variable scope restriction:** `renderToggleSwitch3()` (`media/modals/run-confirm.js`) disables (greys out, does not hide) the "Global" scope button when its `isWorkspaceCmd` parameter is `true`, since a Global value would be written to a file no other project can ever read back for that command.
- **AI Generate/Insert:** works identically to regular categories. `aiState.categoryId` may hold `CURRENT_WORKSPACE_CATEGORY_ID`; the Insert button (`media/modals/ai-generate.js`) routes to the `aiInsertWorkspace` message instead of `aiInsert` when detected, handled by `handleAiInsertWorkspace` (`lib/handlers.js`).

---

## `lib/auto-variables.js`

**Auto-variable resolution** (`$date`, `$user`, `$workspaceFolder`, etc.).

| Export | Description |
| - | - |
| `resolveAutoVariables(settings, context)` | Resolves all auto-variable values for the current context |
| `buildAutoVariablesPayload(settings, context)` | Builds the payload sent to the webview |

**Dependencies:** `os`, `path` (Node.js built-ins).
