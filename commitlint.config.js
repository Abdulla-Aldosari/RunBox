// @ts-check
"use strict";

// 1. Defining the Project's Core Scope
const baseScopes = [
  "activate", // extension.js: activate()/deactivate(), webview panel management, command registration
  "ai", // the AI subsystem as a whole (lib/ai/*), when a change spans more than one AI module
  "ai-check-status", // media/modals/ai-check-status.js: AI connection and rate-limit check modal
  "ai-explain", // media/modals/ai-explain.js: AI explain modal
  "ai-factory", // lib/ai/factory.js: createProvider() dispatch for all AI providers
  "ai-generate", // media/modals/ai-generate.js: AI generate prompt, loading overlay, results modal
  "ai-settings", // media/modals/ai-settings.js: AI settings modal, API key storage, model cache
  "anthropic", // lib/ai/providers/anthropic.js
  "auto-variables", // lib/auto-variables.js: auto variable payload resolution
  "categories", // media/tabs/categories.js: Categories & Groups tab
  "changelog", // CHANGELOG.md content
  "cliff", // cliff.toml: git-cliff changelog generation configuration
  "code-of-conduct", // CODE_OF_CONDUCT.md
  "codebase-map", // docs/codebase-map/*: codebase documentation sub-files
  "cohere", // lib/ai/providers/cohere.js
  "command-form", // media/modals/command-form.js: add/edit command form and commandFormBuffer
  "commands", // media/tabs/commands.js: commands table, sorting, and table interactions
  "commitlint", // commitlint.config.js: commit type/scope rules for this project
  "connection-watchdog", // media/connection-watchdog.js: lost-connection detection and recovery
  "contributing", // CONTRIBUTING.md
  "data-safety", // multi-window data safety and conflict resolution documentation
  "deepseek", // lib/ai/providers/deepseek.js
  "deps", // production dependencies in package.json/package-lock.json
  "deps-dev", // dev dependencies in package.json/package-lock.json
  "drag-drop", // drag-to-reorder feature in the commands table
  "edit-command", // editing an existing command, including rename and move flows
  "enum-manager", // media/modals/enum-manager.js: enum value management modal
  "eslint", // eslint.config.js: linting rules and configuration
  "extension", // extension.js: top-level extension wiring beyond activate()/deactivate()
  "faqs", // docs/faqs.md
  "favorites", // media/tabs/favorites.js: favorites tab and favorite toggling
  "gemini", // lib/ai/providers/gemini.js
  "gitignore", // .gitignore
  "globals", // shared webview global state across media/*.js scripts
  "groq", // lib/ai/providers/groq.js
  "handlers", // lib/handlers.js: extension-side handlers for all webview message types
  "help-links", // lib/help-links.js: getHelpLink URL registry
  "highlight", // template syntax highlighting (highlightTemplateHtml/highlightResolvedHtml)
  "husky", // .husky/commit-msg and .husky/pre-commit git hook scripts
  "icon", // media/icon.png and media/icon.svg: extension icon assets
  "icons", // media/icons.js: inline SVG icon constants
  "images", // docs/images/*: screenshots and GIFs used in documentation
  "issue-templates", // .github/ISSUE_TEMPLATE/*.yml
  "license", // LICENSE file
  "logger", // lib/logger.js: extension-side logging
  "main", // media/main.js: webview entry point
  "manage-tab", // the tab-managed UI layout (panel layout and modals)
  "markdown-parser", // media/markdown-parser.js: Markdown to HTML conversion
  "media", // media/* files when a change spans more than one specific media file
  "messages", // media/messages.js: incoming message handling in the webview
  "mistral", // lib/ai/providers/mistral.js
  "modals", // media/modals/* shared modal logic when not confined to one modal file
  "normalize", // lib/normalize.js: data sanitizing and normalizing
  "notice", // the webview notice/toast system (showNotice, paintNotice)
  "openai", // lib/ai/providers/openai.js
  "packaging", // .vscodeignore and package.json marketplace packaging fields
  "pr-template", // .github/PULL_REQUEST_TEMPLATE.md
  "prettier", // .prettierrc and .prettierignore
  "providers-config", // lib/ai/providers-config.js: provider metadata registry
  "readme", // README.md
  "recent", // media/tabs/recent.js: Recent tab
  "release", // version bump, CHANGELOG.md updates, and .vsenv/scripts/release.ps1
  "render", // media/render.js: UI rendering
  "run-confirm", // media/modals/run-confirm.js: run confirmation and variable input modals
  "schemas", // lib/ai/schemas.js: AI response schemas
  "scripts", // .vsenv/scripts/*: personal developer utilities
  "security", // SECURITY.md and security-related workflows
  "settings", // docs/settings.md and extension settings behavior
  "state", // media/state.js: webview state objects and their hydration
  "stepfun", // lib/ai/providers/stepfun.js
  "storage", // lib/storage.js: safe read/write of commands data files
  "styles", // media/styles.css: the single stylesheet
  "system-instruction", // lib/ai/systemInstruction.js
  "terminal", // lib/terminal.js: terminal profile resolution and execution
  "testing", // testing/*: unit tests and the test runner
  "tooltip", // the data-tooltip tooltip system
  "ui", // general visual/UX change that is not confined to a single file
  "ui-state", // uiState transitions and per-workspace UI session state
  "utils", // media/utils.js: pure helpers and the custom select component
  "variables", // media/tabs/variables.js: Variables tab and variable management
  "vscodeignore", // .vscodeignore
  "webview", // webview-level features: communication, CSP, reconnection
  "workflows", // .github/workflows/*.yml: CI pipelines
];

// 2. Append a negative variant of every base scope prefixed with "-" (e.g. "-ui").
// Negative scopes are reserved for small internal feat/fix/perf commits that must be
// excluded from the auto-generated CHANGELOG by git-cliff. The skip rule that performs
// the exclusion lives in "cliff.toml" -> commit_parsers, in the project root.
const allowedScopes = [...baseScopes, ...baseScopes.map((scope) => `-${scope}`)];

// 3. Custom rule: a negative scope (e.g. "-ui") is reserved for small
// internal commits and may only be used with feat, fix, or perf.
/** @type {import('@commitlint/types').Plugin} */
const negativeScopeTypesPlugin = {
  rules: {
    "negative-scope-types": (parsed) => {
      const type = parsed && parsed.type ? parsed.type : "";
      const scope = parsed && parsed.scope ? parsed.scope : "";

      if (scope.startsWith("-") && !["feat", "fix", "perf"].includes(type)) {
        return [false, `negative scope "${scope}" is only allowed with types feat, fix, or perf`];
      }

      return [true];
    },
  },
};

/** @type {import('@commitlint/types').UserConfig} */
module.exports = {
  extends: ["@commitlint/config-conventional"],
  plugins: [negativeScopeTypesPlugin],
  rules: {
    // `2` means "error" (refuse to commit).
    // `never` means the scope is never allowed to be empty (required).
    "scope-empty": [2, "never"],

    // Header (type + scope + subject) must not exceed 72 characters.
    "header-max-length": [2, "always", 72],

    // Each line in the commit body must not exceed 72 characters.
    "body-max-line-length": [2, "always", 72],

    // Allowed commit types (fixed, do not change).
    "type-enum": [
      2,
      "always",
      ["feat", "fix", "perf", "style", "refactor", "docs", "test", "chore", "build", "ci", "revert"],
    ],

    // RunBox project scopes using the dynamically generated list.
    "scope-enum": [2, "always", allowedScopes],

    // Negative scopes are reserved for small internal feat/fix/perf commits.
    "negative-scope-types": [2, "always"],
  },
};
