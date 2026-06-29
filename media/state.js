/*-------------------------------------------------
 * Terminal Recipes — VS Code Extension
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
const RECIPES_EMPTY_VALUE = "__EMPTY_VALUE__";

// List of tabs whose selections can be saved in `localStorage`
const PERSISTABLE_TABS = ["recent", "favorites", "categories", "commands", "variables"];

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
  newCommandDraft: {
    visible: false,
    title: "",
    template: "",
    description: "",
    groupId: "",
    helpUrl: "",
    variableMeta: {},
  },
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
  commandId: null, // null = new command context, string = editing existing command
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

const state = {
  data: {
    version: 1,
    categories: [],
    commands: [],
  },
  globalCommandsFile: "",
  workspaceFolder: null,
  commandVariables: {
    version: 2,
    commands: {},
  },
  globalCommandVariables: {
    version: 2,
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
};
