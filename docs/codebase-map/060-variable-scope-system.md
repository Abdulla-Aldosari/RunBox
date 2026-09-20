# Variable Scope System

Variables support three storage scopes. The `[Local | Off | Global]` toggle on each variable row controls the **active preference** — not where the value is exclusively saved. Each scope stores its value independently.

| Scope | Storage | Behavior |
| - | - | - |
| **Local** | `.vscode/runbox.data.json` (workspace) | Value saved per-workspace; shown when that workspace is open |
| **Global** | `~/.runbox/data.json` | Value shared across all workspaces |
| **Off** | In-memory only (never written to disk) | Value available for current session only; cleared on extension reload |

## Key Design Rules

- Saving Local does **not** delete Global, and vice versa.
- The toggle is a **preference** (which scope to display/use), not an exclusive assignment.
- `getCommandDraft(commandId)` returns the **resolved value** based on the current preference (read-only computed).
- To read/write scope values directly, use the scope-specific draft getters.

## Scope Draft Functions (in `media/utils.js`)

| Function | Description |
| - | - |
| `getCommandLocalDraft(commandId)` | Returns mutable `{ [varName]: value }` for the workspace-local scope |
| `getCommandGlobalDraft(commandId)` | Returns mutable `{ [varName]: value }` for the global scope |
| `getCommandSessionDraft(commandId)` | Returns mutable `{ [varName]: value }` for the session-only scope (Off) |
| `getCommandDraft(commandId)` | **Read-only computed** — resolved value per variable based on `commandRemember` |
| `getCommandRemember(commandId)` | Returns `{ [varName]: "local" \| "global" \| "off" }` — the scope preference map |
| `buildCommandVariablesPayload()` | Returns `{ local, global }` — full payload for persistence (session excluded) |
| `updateScopeIndicatorDots(container, ...)` | Toggles `.has-value` class on scope buttons to show/hide blue indicator dot |

## `uiState` Scope-Related Fields

```js
uiState = {
  // Primary scope stores — each scope is independent
  commandLocalDrafts: {}, // { [commandId]: { [varName]: value } }
  commandGlobalDrafts: {}, // { [commandId]: { [varName]: value } }
  commandSessionDrafts: {}, // { [commandId]: { [varName]: value } } — never persisted

  // Scope preference per variable
  commandRemember: {}, // { [commandId]: { [varName]: "local"|"global"|"off" } }
};
```

## `variableInputState` Buffer Fields

The variable input modal uses **in-memory buffers** so that Cancel never writes to disk:

```js
variableInputState = {
  localScopeBuffer: {}, // Temp buffer for "local" scope edits — written to scope draft only on Confirm
  globalScopeBuffer: {}, // Temp buffer for "global" scope edits
  sessionScopeBuffer: {}, // Temp buffer for "off" scope edits
};
```

## `commandFormBuffer` Scope Fields

The command form (Add and Edit) never mutates `uiState` while it is open. It works on
an isolated buffer declared in `media/modals/command-form.js`:

```js
commandFormBuffer = {
  mode: null, // "add" | "edit" | null
  commandId: null, // null in "add" mode
  local: {}, // { [varName]: value }
  global: {}, // { [varName]: value }
  session: {}, // { [varName]: value }
  remember: {}, // { [varName]: "local"|"global"|"off" }
  variableMeta: "{}", // JSON string, also written by the Enum Manager
};
```

`captureNew(category, presetGroupId)` and `capture(command)` fill the buffer,
`hasChanged()` compares it against the captured original, and `clear()` resets it.
`flushScopeDataToState(commandId)` copies `local` / `global` / `session` / `remember`
into `uiState` on submit. Cancelling simply calls `clear()`, so no snapshot or
restore step is needed.

## Scope Indicator Dot (`.scope-value-dot`)

Each `[Local | Off | Global]` toggle button contains a `<span class="scope-value-dot">` that is **always visible**:

- Default state (dim): that scope has no stored value
- `.has-value` class (bright blue): that scope has a stored value
