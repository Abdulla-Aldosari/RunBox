# Project Codebase Map

**RunBox** is a VS Code extension that provides a webview panel for managing and running terminal commands with support for variables, favorites, and AI-generated commands.

This file is a short index. Each entry below points to a sub-file under `docs/codebase-map/` that contains the full details for that area. Read only the sub-file(s) relevant to your task.

## Sections

- **Project Overview** — execution contexts and module systems (`extension.js` + `lib/`, `media/`).
  → `docs/codebase-map/010-overview.md`

- **Extension Side — File Map** — `extension.js`, `lib/normalize.js`, `lib/storage.js`, `lib/terminal.js`, `lib/handlers.js`, the "Current Workspace" pseudo-category, and `lib/auto-variables.js`.
  → `docs/codebase-map/020-extension-file-map.md`

- **AI Subsystem (`lib/ai/`)** — `providers-config.js`, `factory.js`, `schemas.js`, `systemInstruction.js`, `debugLogger.js`, and all `providers/*.js`.
  → `docs/codebase-map/030-ai-subsystem.md`

- **Extension Side — Dependency Graph** — require/module dependency tree of the Node.js side.
  → `docs/codebase-map/040-dependency-graph.md`

- **Webview Side — File Map** — ordered `<script>` load list for all `media/*.js` files and their key globals.
  → `docs/codebase-map/050-webview-file-map.md`

- **Variable Scope System** — Local/Global/Off scopes, scope draft functions, `uiState`, `variableInputState`, and `commandFormBuffer` scope fields.
  → `docs/codebase-map/060-variable-scope-system.md`

- **Target Shell System** — `targetShell` data model, shell type detection, profile matching, and the transparency indicator.
  → `docs/codebase-map/070-target-shell-system.md`

- **Message Flow (Webview ↔ Extension)** — all `vscode.postMessage` and `panel.webview.postMessage` message types and their handlers.
  → `docs/codebase-map/080-message-flow.md`

- **Custom Dropdown IDs Reference** — every `renderCustomSelect()` dropdown `wrapperId` and the option item schema.
  → `docs/codebase-map/090-custom-dropdown-ids.md`

- **Tooltip System** — `data-tooltip` attributes, CSS classes, and usage examples.
  → `docs/codebase-map/100-tooltip-system.md`

- **Styling** — the single `media/styles.css` convention and the no-inline-styles rule.
  → `docs/codebase-map/110-styling.md`

- **Button Reference** — unique-ID buttons, row action buttons, and notable CSS classes.
  → `docs/codebase-map/120-button-reference.md`
