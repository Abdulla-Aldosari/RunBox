/*-------------------------------------------------
 * RunBox — VS Code Extension
 * Copyright (c) 2026 Abdulla Aldosari
 * Licensed under the Apache License, Version 2.0.
 * See LICENSE in the project root for details.
 *-------------------------------------------------*/

// media/state.js
// Single source of truth for all mutable UI state and application data.
// Loaded first — all other webview scripts read from and write to these globals.

const vscode = acquireVsCodeApi();

// Special sentinel value stored in commandDraft to represent an explicitly empty variable.
// When a variable holds this value it is passed as "" to the resolved command template.
const RUNBOX_EMPTY_VALUE = "__EMPTY_VALUE__";

// Fixed pseudo-category ID for the "Current Workspace" entry. Never stored inside
// state.data.categories — its content lives in state.workspaceCommands instead.
// Always shown as the first option in both the Categories tab and the Commands
// Browser dropdown, regardless of whether runBox.workspaceID has been created yet.
const CURRENT_WORKSPACE_CATEGORY_ID = "__current_workspace__";

// List of tabs whose selections can be saved in `localStorage`
const PERSISTABLE_TABS = ["recent", "favorites", "categories", "commands", "variables"];

// Options for the manual "Target Shell" selector in Add/Edit Command forms.
// Empty value ("") means "Any Shell" — no restriction, preserves current behavior.
// "powershell" and "pwsh" are distinct: Windows PowerShell 5.1 (built into every
// Windows install, powershell.exe) and PowerShell 7+ (installed separately,
// pwsh.exe) are different, independently installed programs with real syntax
// differences, not just a version number.
const TARGET_SHELL_OPTIONS = [
  { value: "", label: "Any Shell" },
  { value: "powershell", label: "Windows PowerShell" },
  { value: "pwsh", label: "PowerShell" },
  { value: "cmd", label: "Command Prompt" },
  { value: "bash", label: "Bash / Git Bash" },
  { value: "wsl", label: "WSL" },
  { value: "zsh", label: "Zsh" },
  { value: "sh", label: "Sh" },
];

const uiState = {
  activeTab: (function () {
    try {
      const saved = localStorage.getItem("selectedTab");
      return saved && PERSISTABLE_TABS.includes(saved) ? saved : "recent";
    } catch {
      return "recent";
    }
  })(),
  noticeMessage: "",
  noticeIcon: "",
  noticeType: "",
  selectedCategoryId: (function () {
    try {
      return localStorage.getItem("selectedCategoryId") || "";
    } catch {
      return "";
    }
  })(),
  selectedGroupId: (function () {
    try {
      return localStorage.getItem("selectedGroupId") || "all";
    } catch {
      return "all";
    }
  })(),
  devToolsOpen: false,
  sortingMode: false,
  editingCommandId: null,
  editSourceTab: null,
  pendingScrollCommandId: null,
  pendingSaveMessage: null,
  commandLocalDrafts: {}, // { [commandId]: { [varName]: value } } — workspace-local scope
  commandGlobalDrafts: {}, // { [commandId]: { [varName]: value } } — global scope
  commandSessionDrafts: {}, // { [commandId]: { [varName]: value } } — session-only (never written to disk)
  commandRemember: {},

  columnVisibility: (function () {
    try {
      const saved = localStorage.getItem("columnVisibility");
      if (saved) {
        const parsed = JSON.parse(saved);
        return {
          description: parsed.description !== undefined ? parsed.description : true,
          groups: parsed.groups !== undefined ? parsed.groups : true,
        };
      }
    } catch {}
    return { description: true, groups: true };
  })(),
  recentSelectedCommandRowId: "",
  favoritesSelectedCommandRowId: "",
  commandsSelectedCommandRowId: "",
  // 'local' = workspace favorites, 'global' = global favorites
  favoritesScope: (function () {
    try {
      return localStorage.getItem("favoritesScope") || "local";
    } catch {
      return "local";
    }
  })(),
};

let noticeTimer = null;
let runConfirmState = {
  commandId: null,
  resolvedCommand: "",
  selectedShellPath: null,
  selectedShellName: null,
};

let variableInputState = {
  commandId: null,
  action: null,
  missingVariables: [],
  inputValues: {}, // Current displayed value per variable (from active scope)
  rememberFlags: {}, // Active scope preference per variable
  localScopeBuffer: {}, // In-memory buffer for "local" scope values (NOT written to disk until Confirm)
  globalScopeBuffer: {}, // In-memory buffer for "global" scope values (NOT written to disk until Confirm)
  sessionScopeBuffer: {}, // In-memory buffer for "off" scope values
  returnToRunConfirm: false,
};

let deleteConfirmState = {
  type: null,
  id: null,
  title: "",
  template: "",
};

let categoriesModalState = {
  visible: false,
  mode: null, // 'add-category' | 'rename-category' | 'add-group' | 'rename-group'
  value: "",
};

// Enum Manager Modal state
let enumManagerState = {
  visible: false,
  varName: "",
  enumValues: [], // working copy array of {title, value, description}
  editIndex: null, // index of item being edited inline, or null
  editTitle: "",
  editValue: "",
  editDescription: "",
};

// Favorites Unified Modal state
// selectedLocal / selectedGlobal = tag selections (pre-filled based on current state)
let favoriteModalState = {
  visible: false,
  commandId: null,
  selectedLocal: false,
  selectedGlobal: false,
};

// Unfavorite Confirm Modal (normal click on iconHeartMinus in Favorites tab)
let unfavoriteConfirmState = {
  visible: false,
  commandId: null,
  scope: null, // 'local' | 'global'
};

// Edit-Edit Conflict Modal — shown when saving an "Edit Command" form discovers
// that another VS Code window changed this exact command in the meantime
// (detected via a fingerprint mismatch server-side, see lib/storage.js
// computeCommandFingerprint). By the time this modal appears the edit form has
// already closed and the command's optimistic edit is already reflected in
// state.data/state.workspaceCommands (see submitEditCommand); the user chooses
// to overwrite anyway (resubmit pendingCommand as-is) or discard and reload
// the newer version currently on disk (currentCommand).
let editConflictState = {
  visible: false,
  currentCommand: null, // the newer command object currently on disk
  pendingScope: null, // "workspace" | "global" — which section to re-save into on "overwrite anyway"
  pendingCommand: null, // this window's edited command object, ready to resubmit
};

// AI feature state
let aiState = {
  view: null, // null | 'settings' | 'prompt' | 'loading' | 'results'
  mode: null, // 'full' | 'single'
  prompt: "",
  result: null, // AI result object from extension
  categoryId: "", // for single mode: pre-selected category
  groupId: "", // for single mode: pre-selected group
  checkedIds: {}, // { [commandId]: boolean }
  filterGroupId: "all",
  providerName: "gemini", // Initial configuration fallback value, actual providerName will be set from 'extension.js' on aiSettingsResult postMessage
  keyStatus: {},
  settingsProviderName: "gemini", // Initial configuration fallback value
  settingsModelId: "", // Selected model for current settings provider — empty = use provider's default
  apiKeyInput: "",
  error: "",
  // Provider setup metadata received from extension (ai/providers-config.js)
  aiProviderSetup: null,
  // Target shell for AI command generation — controls the syntax/style of generated commands
  shellName: "",
  // Whether the prompt history popover is currently open
  promptHistoryOpen: false,
  // If true: return to 'prompt' view after closing AI settings
  returnToPrompt: false,
  // True while the model list is being fetched from the API
  modelsLoading: false,
};

// AI Provider Setup modal state
let aiProviderSetupModalState = {
  visible: false,
  providerName: null, // 'gemini' | 'openai' | 'anthropic' | ...
};

// AI Explain modal state
let aiExplainState = {
  visible: false,
  loading: false,
  command: "", // raw command text being explained
  markdown: "", // raw Markdown received from AI
  error: "",
};

// AI Check Status modal state (shared by "Check Connection" and "Check Rate Limits")
let aiCheckStatusState = {
  visible: false,
  mode: null, // 'connection' | 'rateLimits'
  loading: false,
  result: null, // raw payload received from the extension (shape depends on mode)
  error: "",
};

const state = {
  data: {
    version: 1,
    categories: [],
    commands: [],
  },
  globalCommandsFile: "",
  workspaceFolder: null,
  commandVariables: {
    commands: {},
  },
  globalCommandVariables: {
    commands: {},
  },

  terminalProfiles: {
    defaultProfile: "",
    profiles: [],
  },
  autoVariables: [],
  autoVariablesSettings: {},
  globalFavorites: [],
  localFavorites: [],
  workspaceFolders: [], // Array<{ name: string, fsPath: string }> — all open workspace folders (multi-root)
  workspaceId: "", // runBox.workspaceID for the active workspace folder; "" if not created yet
  workspaceCommands: {
    // "Current Workspace" pseudo-category content — groups/commands private to this workspace folder
    groups: [],
    commands: [],
  },
};
