# Custom Dropdown IDs Reference

All dropdowns use `renderCustomSelect()` + `bindCustomSelect()` from `media/utils.js`.

| Location | `wrapperId` | File |
| - | - | - |
| Commands Tab — category | `custom-category-select` | `media/tabs/commands.js` |
| Commands Tab — column toggle | `col-toggle-wrap` | `media/tabs/commands.js` |
| Run Confirm Modal — shell | `shell-selector-wrap` | `media/modals/run-confirm.js` |
| Command Form (Add + Edit) - category | `command-form-category-wrap` | `media/modals/command-form.js` |
| AI Settings Modal — provider | `ai-provider-select-wrap` | `media/modals/ai-settings.js` |
| AI Settings Modal — model | `ai-model-select-wrap` | `media/modals/ai-settings.js` |
| AI Generate Modal — target shell | `ai-shell-select-wrap` | `media/modals/ai-generate.js` |
| Command Form (Add + Edit) - target shell | `command-form-shell-wrap` | `media/modals/command-form.js` |
| Variable inputs - enum type | `enum-var-wrap-{varName}` | `media/modals/run-confirm.js` (variable input modal), `media/modals/command-form.js` |
| **Header** — workspace folder (multi-root only) | `workspace-folder-select` | `media/render.js` — visible only when `state.workspaceFolders.length > 1`; selecting a folder posts `setActiveWorkspaceFolder` to the extension |

## `renderCustomSelect()` — Option Item Schema

Each element in the `options` array passed to `renderCustomSelect()` supports the following keys:

| Key | Type | Required | Description |
| :-: | :-: | :-: | - |
| `value` | string | ✅ | The value stored and passed to `onChange` |
| `label` | string | ✅ | The display text shown in the button and menu |
| `tooltip` | string | optional | Added as `data-tooltip` on the `.cs-item` element |
| `badge` | string | optional | Raw HTML string (e.g. an SVG icon) injected inside `.cs-item-badge` next to the label |
| `badgePosition` | string | optional | `"start"` = badge appears before the label; omit or `"end"` = badge appears after the label |

The label and badge are always wrapped together inside `<span class="cs-item-label-group">`, keeping them visually grouped and separated from the checkmark which sits at the far right.

**Current usage of `badge`:** The AI Provider dropdown (`ai-provider-select-wrap`) renders a key icon (`icons.key`) for every provider. The icon uses `.key-active` (green) when the provider has a saved API key, and `.key-inactive` (muted) when it does not. `badgePosition` is set to `"start"` so the icon appears to the left of the provider name.
