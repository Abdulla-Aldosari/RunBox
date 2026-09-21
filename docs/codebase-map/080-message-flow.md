# Message Flow — Webview ↔ Extension

## Webview → Extension (`vscode.postMessage`)

All `vscode.postMessage` calls are inlined at their call sites in tabs, modals, and `media/render.js`. There are no named sender functions.

| `message.type` | Call site | Handler (in `lib/handlers.js`) |
| - | - | - |
| `ping` | `media/connection-watchdog.js` (heartbeat interval) | first branch of the dispatch table in `extension.js` — replies with `pong` immediately, independent of any business state or file I/O |
| `ready` | `media/main.js` (startup) | `postState(panel)` in `extension.js` |
| `requestState` | `media/messages.js` (on `aiSaveSettingsResult`) | `postState(panel)` in `extension.js` |
| `saveData` | `media/utils.js` (`persistDataThenRender`) | `handleSaveCommandsData` |
| `saveWorkspaceCommandsData` | `media/utils.js` (`persistWorkspaceCommandsThenRender`) | `handleSaveWorkspaceCommandsData` |
| `applyOperation` | `media/utils.js` (`persistWorkspaceOperation`/`persistGlobalOperation`) | `handleApplyOperation` |
| `saveCommandMove` | `media/utils.js` (`persistCommandMoveThenRender`) | `handleSaveCommandMove` |
| `saveCommandVariables` | `media/utils.js` (`persistCommandVariables`) | `handleSaveCommandVariables` |
| `performAction` | `media/tabs/commands.js` (`performCommandAction`) | `handlePerformAction` |
| `openCommandsFile` | `media/render.js` (`bindTopActions`) | `openGlobalCommandsFile` |
| `openGlobalDataFile` | `media/render.js` (`bindTopActions`) | `openGlobalDataFile` |
| `openLocalDataFile` | `media/render.js` (`bindTopActions`) | `openLocalDataFile` |
| `openExternalUrl` | `media/utils.js` (`bindCmdTitleLinks`), various | `handleOpenExternalUrl` |
| `pickFile` | `media/tabs/commands.js` (Alt+O on variable modal text inputs) | `handlePickFile` |
| `aiGetSettings` | `media/modals/ai-settings.js` (`bindAiSettingsEvents`) | `handleAiGetSettings` |
| `aiSaveSettings` | `media/modals/ai-settings.js` (`bindAiSettingsEvents`) | `handleAiSaveSettings` |
| `aiGenerate` | `media/modals/ai-generate.js` (`bindAiGenerateEvents`) | `handleAiGenerate` |
| `aiInsert` | `media/modals/ai-generate.js` (`bindAiGenerateEvents`) | `handleAiInsert` |
| `saveAutoVariablesSettings` | `media/tabs/variables.js` | `handleSaveAutoVariablesSettings` |
| `saveFavorites` | `media/utils.js` (`persistFavorites`), `media/tabs/favorites.js` | `handleSaveFavorites` |
| `aiListModels` | `media/modals/ai-settings.js`, `media/messages.js` | `handleAiListModels` |
| `aiRefreshAllModels` | `media/modals/ai-settings.js` (`bindAiSettingsEvents`) | `handleAiRefreshAllModels` |
| `setActiveWorkspaceFolder` | `media/render.js` (`bindTopActions`) | dispatch table in `extension.js` — persists `fsPath` in `context.workspaceState` and calls `postState()` |
| `saveUiPreference` | `media/utils.js` (`saveUiPreference`) | dispatch table in `extension.js`, persists one key of `uiPreferences` in `context.workspaceState`, does not call `postState()` |
| `aiExplain` | `media/modals/ai-explain.js` (`openAiExplainModal`) | `handleAiExplain` |
| `aiCheckConnection` | `media/modals/ai-check-status.js` (`openAiCheckConnectionModal`) | `handleAiCheckConnection` |
| `aiCheckRateLimits` | `media/modals/ai-check-status.js` (`openAiCheckRateLimitsModal`) | `handleAiCheckRateLimits` |

**`saveCommandVariables` payload format:** `{ local: { commands:{} }, global: { commands:{} } }` — both scopes sent together; each written independently to its section of the unified data file.

**`performAction` payload format (multi-root addition):** includes `activeFsPath?: string` — the workspace folder path selected in the run-confirm modal. Used by `handlePerformAction` to resolve `${workspaceFolder}`, write local variables, and open the terminal with `cwd`. Absent or `null` in single-root workspaces or when `alwaysFirst` is used.

## Extension → Webview (`panel.webview.postMessage`)

| `message.type` | Handled by (in `media/messages.js`) | Effect |
| - | - | - |
| `pong` | inline `window.addEventListener("message", ...)` in `media/connection-watchdog.js` (not `media/messages.js`) | Clears the pong-wait timer; if `connectionLost` was `true`, resets it to `false` and calls `render()` so the "Service connection lost" modal disappears |
| `state` | `handleState` | Updates `state` + calls `render()`. Payload includes `workspaceFolder` (the resolved active folder) and `workspaceFolders: Array<{ name, fsPath }>` (all open folders — empty array in single-root or no-workspace mode). |
| `saveResult` | `handleSaveResult` | Shows success/error notice |
| `saveWorkspaceCommandsDataResult` | inline in message dispatcher | Shows success/error notice for a full "Current Workspace" section overwrite; on failure, requests a fresh `state` to roll back the optimistic render |
| `applyOperationResult` | inline in message dispatcher | On success: shows success notice (authoritative state already refreshed by the extension's own `postState()` call before this message). On `conflict: true`: calls `handleEditConflict(currentCommand)` to open the edit-edit conflict modal instead of a generic failure notice. On any other failure: shows error notice and requests a fresh `state` to roll back the optimistic render. |
| `saveVariablesResult` | `handleSaveVariablesResult` | Shows result + updates local/global vars |
| `actionResult` | `handleActionResult` | Shows notice for copy/run/use |
| `aiSettingsResult` | `handleAiSettingsResult` | Populates `aiState` + re-renders |
| `aiSaveSettingsResult` | `handleAiSaveSettingsResult` | Shows save confirmation |
| `aiGenerateResult` | `handleAiGenerateResult` | Updates `aiState.results` + calls `render()` |
| `aiInsertResult` | `handleAiInsertResult` | Shows insert confirmation notice |
| `saveFavoritesResult` | `handleSaveFavoritesResult` | Shows favorites save result |
| `saveAutoVariablesSettingsResult` | `handleSaveAutoVariablesSettingsResult` | Shows auto-vars save result |
| `aiListModelsResult` | inline in message dispatcher | On success: saves fetched models to localStorage cache and applies them to `aiState.aiProviderSetup[provider].models`. On failure or empty result: caches the static models from config to prevent re-fetching on next open. Re-renders only if result is for the currently displayed provider. |
| `aiDeleteKeyResult` | inline in message dispatcher | On success: clears the model cache for the provider and re-fetches settings via `aiGetSettings`. Shows a confirmation notice. |
| `aiExplainResult` | `handleAiExplainResult` (in `media/modals/ai-explain.js`) | Sets `aiExplainState.loading = false`; populates `markdown` or `error`; repaints the explain modal content without calling `render()` |
| `pickFileResult` | inline in message dispatcher | On success: writes the selected `fsPath` into the matching `.variable-modal-input[data-variable-name]` and updates `variableInputState.inputValues`. No `render()` call, to avoid focus loss while editing. |
