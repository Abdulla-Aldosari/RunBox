# Button Reference

## Part 1 — Unique ID Buttons

Buttons with a unique `id` attribute. Located via `document.getElementById(id)`.

### Header Actions — `media/render.js`

| Button ID | Purpose |
| - | - |
| `btn-open-local-data-file` | Open workspace-local unified data JSON file in VS Code editor |
| `btn-open-global-data-file` | Open global unified data JSON file in VS Code editor |
| `btn-open-commands-file` | Open global `commands.json` file in VS Code editor |
| `btn-ai-settings` | Open the AI Settings modal |

### Commands Tab — `media/tabs/commands.js`

| Button ID | Purpose |
| - | - |
| `btn-toggle-sort` | Toggle drag-to-reorder sort mode on/off |
| `btn-add-with-ai` | Open the AI Generate modal scoped to the selected group |

### Recent Tab — `media/tabs/recent.js`

| Button ID | Purpose |
| - | - |
| `btn-clear-recent` | Clear all recent command history |

### Favorites Tab — `media/tabs/favorites.js`

| Button ID | Purpose |
| - | - |
| `btn-restore-unfav-confirm` | Re-enable the removal confirmation dialog (shown when skip-confirm is active) |
| `btn-fav-unfavorite-all` | Remove command from all favorites scopes immediately |
| `btn-fav-save` | Confirm and save the selected favorite tag |
| `btn-fav-cancel` | Cancel the favorite tag selection |
| `btn-unfav-confirm-remove` | Confirm removal from favorites |
| `btn-unfav-confirm-cancel` | Cancel the unfavorite confirmation |

### Categories Tab — `media/tabs/categories.js`

| Button ID | Purpose |
| - | - |
| `btn-create-with-ai` | Open the AI Generate modal from the categories panel |
| `btn-open-add-category-modal` | Open the inline modal to add a new category |
| `btn-open-add-group-modal` | Open the inline modal to add a new group (disabled if no category selected) |
| `btn-manage-modal-confirm` | Confirm the add/rename category or group action |
| `btn-manage-modal-cancel` | Cancel the add/rename modal |

### Enum Variable Manager — `media/modals/enum-manager.js`

| Button ID | Purpose |
| - | - |
| `btn-enum-add-confirm` | Add or update an enum option value |
| `btn-enum-edit-cancel` | Cancel editing an existing enum option |
| `btn-enum-manager-close` | Close the enum manager (every change is applied live) |

### Run Confirm Modal — `media/modals/run-confirm.js`

| Button ID | Purpose |
| - | - |
| `btn-confirm-run-variables` | Open the variable input modal before running (shown only when command has variables) |
| `btn-confirm-run-yes` | Confirm and run the command in the terminal |
| `btn-confirm-run-no` | Cancel the run confirmation |
| `btn-variable-input-confirm` | Confirm variable values and proceed |
| `btn-variable-input-cancel` | Cancel variable input and discard buffer |
| `btn-confirm-delete-yes` | Confirm command deletion |
| `btn-confirm-delete-no` | Cancel command deletion |

### AI Generate Modal — `media/modals/ai-generate.js`

| Button ID | Purpose |
| - | - |
| `ai-model-label-link` | Displays the active provider and model name; clicking opens AI Settings and returns to the prompt modal after closing |
| `btn-ai-generate` | Send the prompt to the AI provider and generate commands |
| `btn-ai-prompt-cancel` | Close the AI prompt input without generating |
| `btn-ai-insert` | Insert selected AI-generated commands into the data (disabled when nothing selected) |
| `btn-ai-results-cancel` | Close the AI results view without inserting |

### AI Settings Modal — `media/modals/ai-settings.js`

| Button ID | Purpose |
| - | - |
| `btn-ai-get-api-key` | Open the AI provider's API key page in the browser |
| `btn-ai-show-setup-help` | Open the step-by-step setup help view |
| `btn-ai-settings-save-api-key` | Save the API key only without closing the modal; clears the model cache for the provider then triggers a model list refresh so the user can pick a model before clicking Save |
| `btn-ai-settings-save` | Save the API key to VS Code `SecretStorage` and persist the selected model ID to VS Code settings (`runBox.aiModel`); also clears model cache if a new key was entered |
| `btn-ai-settings-cancel` | Close the AI settings modal |
| `btn-ai-setup-open-url` | Open the provider URL from inside the setup help view |
| `btn-ai-setup-close` | Close the setup help view |
| `btn-ai-refresh-models` | Fetch the latest model list for all providers that have a saved API key (bound in `bindAiSettingsEvents` in `media/modals/ai-settings.js`) |
| `btn-ai-delete-api-key` | Remove the saved API key for the currently selected provider (shown only when a key is already saved) |
| `btn-ai-check-connection` | Verify API key validity and connectivity for the selected provider; opens the AI Check Status modal (loading → result) |
| `btn-ai-check-rate-limits` | Check current rate limit usage for the selected provider; opens the AI Check Status modal. If the provider does not support proactive rate limit checks (`hasApiRateLimits: false`), shows a message and a link to the provider's rate-limit page instead |
| `btn-ai-check-status-close` | Close the AI Check Status modal (in `media/modals/ai-check-status.js`) |

### Command Form (Add + Edit) - `media/modals/command-form.js`

One set of IDs serves both modes; only the visible labels differ.

| Button ID / Class | Purpose | Availability |
| - | - | - |
| `btn-command-form-submit` | Submit the form. Label is "Add Command" in add mode and "Save Changes" in edit mode | Always |
| `btn-command-form-cancel` | Discard the form buffer and return to the originating tab | Always |
| `.btn-open-enum-manager` | Open the Enum values manager for a specific variable (`data-var-name`) | Only when template has variables |
| `.toggle-option-3` | Switch scope preference (`Local` / `Off` / `Global`) for a variable, within a `variable-remember-toggle` container | Only when template has variables |

---

## Part 2 — Row Action Buttons (`actions-cell`)

Buttons rendered per command row by `renderActionsCell()` in `media/utils.js`. They carry no `id` — identified by CSS class + `data-command-id` attribute. Bound in `bindCommandActionButtons()` in `media/tabs/commands.js`.

| CSS Class | Purpose | Availability |
| - | - | - |
| `.btn-run` | Open the run confirmation modal for the command | All tabs |
| `.btn-copy` | Copy the command text to clipboard | All tabs |
| `.btn-use` | Paste the command into the active terminal input (disabled for multi-line commands) | All tabs |
| `.btn-edit` | Open the edit command form | Commands tab only (`showEdit: true`) |
| `.btn-delete-command` | Open the delete confirmation modal for the command | Commands tab only (`showDelete: true`) |
| `.btn-add-favorite` | Add command to favorites; left-click = quick add to current scope, CTRL+click = open manage panel | Commands + Recent tabs (`favoriteStyle: "favorite"`) |
| `.btn-unfavorite` | Remove command from favorites; left-click = confirmation modal, CTRL+click = open manage panel | Favorites tab (`favoriteStyle: "unfavorite"`) |
| `.btn-goto-command` | Navigate to the command in the Commands tab and highlight its row | Recent + Favorites tabs (`showGoto: true`) |
| `.btn-explain` | Open the AI Explain modal for the command; sends the raw command text to `explainWithAI` and displays the Markdown result. Uses `data-command` attribute (raw command template) | Commands tab only (`showEdit: true`) |

> **Binding location:** `.btn-goto-command` is bound in `bindCommandsTabEvents()`. `.btn-add-favorite` is bound in `bindCommandActionButtons()`. `.btn-unfavorite` is bound in `bindFavoritesTabEvents()` in `media/tabs/favorites.js`. All other row action buttons are bound in `bindCommandActionButtons()` in `media/tabs/commands.js`.

---

## Notable CSS Classes Added

| Class | Description |
| - | - |
| `.scope-value-dot` | Always-visible dot on each `[Local/Off/Global]` button; dim by default |
| `.scope-value-dot.has-value` | Bright blue — applied when that scope has a stored value (toggled via JS, no re-render) |
| `.selected-command-row` | Dashed outline highlight applied to the currently selected command row (`<tr>`) |
| `.workspace-selector-bar` | Flex container that wraps the workspace folder label and dropdown in multi-root mode — replaces `.workspace-label` when `state.workspaceFolders.length > 1` |
| `.workspace-selector-label` | Label element inside `.workspace-selector-bar` showing the folder icon and text "Workspace folder:" |
