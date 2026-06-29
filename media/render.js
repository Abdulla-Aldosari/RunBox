/*-------------------------------------------------
 * Terminal Recipes — VS Code Extension
 * Copyright (c) 2026 Abdulla Aldosari
 * Licensed under the Apache License, Version 2.0.
 * See LICENSE in the project root for details.
 *-------------------------------------------------*/

// media/render.js
// Master render() orchestrator, state hydration, and all event binding entry points.
// Loads after all tab and modal files.

/**
 * Hydrates the global `state` object from the extension payload.
 * Called on every 'state' message from the extension.
 * Also initializes scope drafts/commandRemember for all known command IDs.
 * @param {object} payload - Data payload from the extension
 */
function hydrateState(payload) {
  const prevWorkspaceFolder = state.workspaceFolder;
  state.data = payload && payload.data ? payload.data : state.data;
  state.globalCommandsFile = payload && payload.globalCommandsFile ? payload.globalCommandsFile : "";
  state.workspaceFolder = payload ? payload.workspaceFolder : null;
  state.commandVariables =
    payload && payload.commandVariables ? payload.commandVariables : { version: 2, commands: {} };
  state.globalCommandVariables =
    payload && payload.globalCommandVariables ? payload.globalCommandVariables : { version: 2, commands: {} };
  state.terminalProfiles =
    payload && payload.terminalProfiles ? payload.terminalProfiles : { defaultProfile: "", profiles: [] };
  state.autoVariables = payload && Array.isArray(payload.autoVariables) ? payload.autoVariables : [];
  state.autoVariablesSettings = payload && payload.autoVariablesSettings ? payload.autoVariablesSettings : {};
  state.globalFavorites = payload && Array.isArray(payload.globalFavorites) ? payload.globalFavorites : [];
  state.localFavorites = payload && Array.isArray(payload.localFavorites) ? payload.localFavorites : [];
  state.workspaceFolders = payload && Array.isArray(payload.workspaceFolders) ? payload.workspaceFolders : [];

  // If no workspace, force scope to 'global'
  if (!state.workspaceFolder && uiState.favoritesScope === "local") {
    uiState.favoritesScope = "global";
  }

  // Initialize selected shell from default profile if not already set
  if (runConfirmState.selectedShellName == null) {
    const profiles = state.terminalProfiles.profiles || [];
    const defaultName = state.terminalProfiles.defaultProfile || "";
    const defaultProfileEntry =
      profiles.find(function (p) {
        return p.name === defaultName;
      }) ||
      profiles[0] ||
      null;
    runConfirmState.selectedShellName = defaultProfileEntry ? defaultProfileEntry.name : null;
    runConfirmState.selectedShellPath = defaultProfileEntry ? defaultProfileEntry.shellPath : null;
  }

  const workspaceFolderChanged = state.workspaceFolder !== prevWorkspaceFolder;
  const localCmds = state.commandVariables.commands || {};
  const globalCmds = state.globalCommandVariables.commands || {};
  const allCommandIds = new Set([...Object.keys(localCmds), ...Object.keys(globalCmds)]);

  allCommandIds.forEach(function (commandId) {
    // Initialize local scope draft from workspace variables file
    // Always refresh when workspace folder changes to load the new folder's values
    if (!uiState.commandLocalDrafts[commandId] || workspaceFolderChanged) {
      uiState.commandLocalDrafts[commandId] = Object.assign({}, localCmds[commandId] || {});
    }

    // Initialize global scope draft from global variables file
    if (!uiState.commandGlobalDrafts[commandId]) {
      uiState.commandGlobalDrafts[commandId] = Object.assign({}, globalCmds[commandId] || {});
    }

    // Initialize scope preference (commandRemember)
    // Always refresh when workspace folder changes so local scope prefs reflect new folder's values
    if (!uiState.commandRemember[commandId] || workspaceFolderChanged) {
      const remembered = {};
      const globalVars = globalCmds[commandId] || {};
      const localVars = localCmds[commandId] || {};
      const allVarKeys = new Set([...Object.keys(localVars), ...Object.keys(globalVars)]);
      allVarKeys.forEach(function (key) {
        if (localVars[key]) {
          remembered[key] = "local"; // prefer local if local has a value
        } else if (globalVars[key]) {
          remembered[key] = "global"; // prefer global if only global has a value
        } else {
          remembered[key] = state.workspaceFolder ? "local" : "global";
        }
      });
      uiState.commandRemember[commandId] = remembered;
    }
  });
}

/**
 * Ensures selectedCategoryId and selectedGroupId point to valid existing items.
 * Falls back to the first category / 'all' group if the saved selection is stale.
 */
function ensureSelectionDefaults() {
  const categories = state.data.categories || [];

  if (!categories.length) {
    uiState.selectedCategoryId = "";
    uiState.selectedGroupId = "all";
    return;
  }

  if (
    !categories.some(function (category) {
      return category.id === uiState.selectedCategoryId;
    })
  ) {
    uiState.selectedCategoryId = categories[0].id;
  }

  const groups = getSelectedCategoryGroups();

  if (
    uiState.selectedGroupId !== "all" &&
    !groups.some(function (group) {
      return group.id === uiState.selectedGroupId;
    })
  ) {
    uiState.selectedGroupId = "all";
  }
}

/**
 * Renders the workspace label bar below the header.
 * - Single-root or no workspace: plain read-only text label.
 * - Multi-root workspace: an interactive custom-select dropdown that lets the
 *   user pick the active folder. The current folder is pre-selected.
 * @returns {string} HTML string
 */
function renderWorkspaceLabel() {
  if (state.workspaceFolders.length > 1) {
    const options = state.workspaceFolders.map(function (f) {
      return { value: f.fsPath, label: f.name };
    });
    const currentFsPath =
      state.workspaceFolder || (state.workspaceFolders[0] && state.workspaceFolders[0].fsPath) || "";
    return `
      <div class="workspace-selector-bar">
        <span class="workspace-selector-label">${icons.folder} Workspace folder:</span>
        ${renderCustomSelect(
          "workspace-folder-select",
          "workspace-folder-btn",
          "workspace-folder-menu",
          options,
          currentFsPath,
          "cs-btn-sm"
        )}
      </div>
    `;
  }
  return `<p class="workspace-label">Workspace: <code>${escapeHtml(state.workspaceFolder || "No workspace open")}</code></p>`;
}

/**
 * Full re-render of the app. Rebuilds innerHTML of #app and re-binds all events.
 * Called after any state change. Also handles pending scroll highlights.
 */
function render() {
  ensureSelectionDefaults();

  const app = document.getElementById("app");

  // ─── Dev Tools Overlay (Development Mode Only) ───────────────────────────────
  // When uiState.devToolsOpen is true, delegate rendering entirely to the Dev Tools
  // system (media/dev/index.js) instead of the normal app UI. The typeof guards
  // ensure zero-impact in production where renderDevToolsOverlay is never defined.
  if (uiState.devToolsOpen && typeof renderDevToolsOverlay === "function") {
    app.innerHTML = renderDevToolsOverlay();
    if (typeof bindDevToolsEvents === "function") {
      bindDevToolsEvents();
    }
    return;
  }

  // ─── Normal App UI Rendering ────────────────────────────────────────────────

  const selectedCategory = getSelectedCategory();

  app.innerHTML = `
    <div class="layout">
      <header class="header">
        <h1>Terminal Recipes</h1>
        <div class="header-actions">
          ${typeof renderDevToolsOverlay === "function" ? `<button id="btn-open-dev-tools" class="btn small secondary" data-tooltip="Open Dev Tools">Dev Tools</button>` : ""}
          <button id="btn-open-local-variables-file" class="btn small secondary" ${state.workspaceFolder ? "" : "disabled"} data-tooltip="${state.workspaceFolder ? "Open local variables JSON file" : "No workspace open"}">Open Local Variables JSON</button>
          <button id="btn-open-global-variables-file" class="btn small secondary" data-tooltip="Open global variables JSON file">Open Global Variables JSON</button>
          <button id="btn-open-commands-file" class="btn small secondary" data-tooltip="Open global commands JSON file">Open Global JSON</button>
          <button id="btn-ai-settings" class="btn small secondary ai-settings-btn" data-tooltip="AI Settings">${icons.aiSettings} AI Settings</button>
        </div>
      </header>
      ${renderWorkspaceLabel()}

      <section class="card tabs-section">
        <div class="tabs">
          <button class="tab d-focus ${!uiState.editingCommandId && uiState.activeTab === "recent" ? "active" : ""}" data-tab="recent">${icons.recent} Recent Commands</button>
          <button class="tab d-focus ${!uiState.editingCommandId && uiState.activeTab === "favorites" ? "active" : ""}" data-tab="favorites">${icons.heart} Favorites</button>
          <button class="tab d-focus ${!uiState.editingCommandId && uiState.activeTab === "categories" ? "active" : ""}" data-tab="categories">${icons.group} Categories & Groups</button>
          <button class="tab d-focus ${!uiState.editingCommandId && uiState.activeTab === "commands" ? "active" : ""}" data-tab="commands">${icons.command} Commands</button>
          <button class="tab d-focus tab-push-right ${!uiState.editingCommandId && uiState.activeTab === "variables" ? "active" : ""}" data-tab="variables">${icons.variables} Variables</button>
        </div>
      </section>

      ${
        uiState.editingCommandId
          ? renderEditTab()
          : uiState.activeTab === "recent"
            ? renderRecentCommandsTab()
            : uiState.activeTab === "favorites"
              ? renderFavoritesTab()
              : uiState.activeTab === "categories"
                ? renderCategoriesTab()
                : uiState.activeTab === "commands"
                  ? renderCommandsTab(selectedCategory)
                  : uiState.activeTab === "add"
                    ? renderAddCommandTab(selectedCategory)
                    : uiState.activeTab === "variables"
                      ? renderVariablesTab()
                      : ""
      }
      ${renderVariableInputModal()}
      ${renderRunConfirmModal()}
      ${renderDeleteConfirmModal()}
      ${favoriteModalState.visible ? renderFavoriteModal() : ""}
      ${unfavoriteConfirmState.visible ? renderUnfavoriteConfirmModal() : ""}
      ${aiState.view === "settings" ? renderAiSettingsModal() : ""}
      ${aiState.view === "prompt" ? renderAiPromptModal() : ""}
      ${aiState.view === "loading" ? renderAiLoadingOverlay() : ""}
      ${aiState.view === "results" ? renderAiResultsModal() : ""}
      ${aiProviderSetupModalState.visible ? renderAiProviderSetupModal() : ""}
      ${enumManagerState.visible ? renderEnumManagerModal() : ""}
    </div>
  `;

  paintNotice();
  bindEvents();
  // Auto-resize template textareas and initialize syntax highlight overlay
  document.querySelectorAll(".template-textarea").forEach(function (el) {
    autoResizeTextarea(el);
    updateTemplateHighlight(el);
    el.addEventListener("scroll", function () {
      const h = el.previousElementSibling;
      if (h && h.classList.contains("template-highlight")) {
        h.scrollTop = el.scrollTop;
      }
    });
  });
  bindAiSettingsEvents();
  bindAiGenerateEvents();
  bindCmdTitleLinks();
  if (enumManagerState.visible) {
    bindEnumManagerEvents();
  }

  // Scroll & highlight a pending row (set before render() was called)
  if (uiState.pendingScrollCommandId) {
    const _pendingId = uiState.pendingScrollCommandId;
    uiState.pendingScrollCommandId = null;
    setTimeout(function () {
      scrollToAndHighlight(_pendingId);
    }, 30);
  }
}

// ─── Modal Dismiss Handlers ───────────────────────────────────────────────────

/**
 * Binds click-outside-to-dismiss behaviour for all modal overlays.
 * Each overlay uses data-dismiss-on-outside-click="true|false" to opt in/out.
 * Handlers are defined in modalDismissHandlers keyed by overlay id.
 */
const modalDismissHandlers = {
  "categories-modal-overlay": function () {
    categoriesModalState = { visible: false, mode: null, value: "" };
    render();
  },
  "enum-manager-overlay": function () {
    enumManagerState = {
      visible: false,
      commandId: null,
      varName: "",
      enumValues: [],
      editIndex: null,
      editTitle: "",
      editValue: "",
      editDescription: "",
    };
    render();
  },
  "ai-settings-overlay": function () {
    aiState.view = null;
    aiState.apiKeyInput = "";
    aiState.modelsLoading = false;
    render();
  },
  "ai-prompt-overlay": function () {
    aiState.view = null;
    aiState.error = "";
    aiState.prompt = "";
    render();
  },
  "ai-results-overlay": function () {
    aiState.view = null;
    aiState.result = null;
    aiState.error = "";
    render();
  },
  "run-confirm-overlay": function () {
    runConfirmState = {
      commandId: null,
      resolvedCommand: "",
      selectedShellPath: runConfirmState.selectedShellPath,
      selectedShellName: runConfirmState.selectedShellName,
    };
    render();
  },
  "variable-input-overlay": function () {
    variableInputState = {
      commandId: null,
      action: null,
      missingVariables: [],
      inputValues: {},
      rememberFlags: {},
      localScopeBuffer: {},
      globalScopeBuffer: {},
      sessionScopeBuffer: {},
      returnToRunConfirm: false,
    };
    render();
  },
  "delete-confirm-overlay": function () {
    deleteConfirmState = { type: null, id: null, title: "", template: "" };
    render();
  },
  "ai-loading-overlay": function () {
    // No dismiss action for loading overlay
  },
  "ai-provider-setup-overlay": function () {
    aiProviderSetupModalState = { visible: false, providerName: null };
    render();
  },
};

function bindModalDismiss() {
  // --- Overlays that dismiss on outside click (true) ---
  document.querySelectorAll('.modal-overlay[data-dismiss-on-outside-click="true"]').forEach(function (overlay) {
    const handler = modalDismissHandlers[overlay.id];
    if (handler) {
      overlay.addEventListener("pointerdown", function (e) {
        if (e.target === overlay) {
          handler();
        }
      });
    }
  });

  // --- Overlays that do NOT dismiss (false) — flash the border instead ---
  document.querySelectorAll('.modal-overlay[data-dismiss-on-outside-click="false"]').forEach(function (overlay) {
    overlay.addEventListener("pointerdown", function (e) {
      if (e.target === overlay) {
        const box = overlay.querySelector(".modal-box");
        if (box) {
          box.classList.remove("modal-box-flash");
          void box.offsetWidth; // force reflow to restart animation
          box.classList.add("modal-box-flash");
          box.addEventListener(
            "animationend",
            function () {
              box.classList.remove("modal-box-flash");
            },
            { once: true }
          );
        }
      }
    });
  });
}

// ─── Master Event Binder ──────────────────────────────────────────────────────

function bindEvents() {
  bindTopActions();
  bindTabs();
  bindModalDismiss();

  // If currently editing, only bind edit tab events (regardless of activeTab)
  if (uiState.editingCommandId) {
    bindEditTabEvents();
    bindCommandActionButtons();
    return;
  }

  if (uiState.activeTab === "recent") {
    bindRecentTabEvents();
  }

  if (uiState.activeTab === "categories") {
    bindCategoriesTabEvents();
  }

  if (uiState.activeTab === "commands") {
    bindCommandsTabEvents();
  }

  if (uiState.activeTab === "add") {
    bindAddCommandTabEvents();
  }

  if (uiState.activeTab === "favorites") {
    bindFavoritesTabEvents();
  }

  if (uiState.activeTab === "variables") {
    bindVariablesTabEvents();
  }

  bindCommandActionButtons();
  bindRowSelectionEvents();
}

/**
 * Binds click events on command rows (tr[data-command-id]) in the active tab
 * using capture phase so the row selection fires before any button handlers
 * on nested elements (buttons, links, actions-cell).
 * Clicking a row or any element inside it will select/highlight that row.
 */
function bindRowSelectionEvents() {
  const tab = uiState.activeTab;
  if (tab !== "recent" && tab !== "favorites" && tab !== "commands") {
    return;
  }
  document.querySelectorAll("tr[data-command-id]").forEach(function (row) {
    row.addEventListener(
      "click",
      function () {
        selectCommandRow(row.dataset.commandId);
      },
      true
    );
  });
}

function bindTopActions() {
  const openDevToolsButton = document.getElementById("btn-open-dev-tools");
  if (openDevToolsButton) {
    openDevToolsButton.addEventListener("click", function () {
      uiState.devToolsOpen = true;
      render();
    });
  }

  const openCommandsFileButton = document.getElementById("btn-open-commands-file");
  const openGlobalVariablesFileButton = document.getElementById("btn-open-global-variables-file");
  const openLocalVariablesFileButton = document.getElementById("btn-open-local-variables-file");

  if (openCommandsFileButton) {
    openCommandsFileButton.addEventListener("click", function () {
      vscode.postMessage({ type: "openCommandsFile" });
    });
  }

  if (openGlobalVariablesFileButton) {
    openGlobalVariablesFileButton.addEventListener("click", function () {
      vscode.postMessage({ type: "openGlobalVariablesFile" });
    });
  }

  if (openLocalVariablesFileButton) {
    openLocalVariablesFileButton.addEventListener("click", function () {
      vscode.postMessage({ type: "openLocalVariablesFile" });
    });
  }

  // Workspace folder selector — only present in multi-root workspaces
  if (state.workspaceFolders.length > 1) {
    bindCustomSelect("workspace-folder-select", "workspace-folder-btn", "workspace-folder-menu", function (fsPath) {
      vscode.postMessage({ type: "setActiveWorkspaceFolder", payload: { fsPath } });
    });
  }
}

function bindTabs() {
  document.querySelectorAll(".tab").forEach(function (tabButton) {
    tabButton.addEventListener("click", function () {
      const nextTab = tabButton.dataset.tab;

      // Switching tabs while editing → clear buffer and discard editing state
      if (uiState.editingCommandId && nextTab !== uiState.activeTab) {
        editCommandBuffer.clear();
        uiState.editingCommandId = null;
        uiState.editSourceTab = null;
      }

      // Exit sort mode when switching away from commands tab
      if (uiState.sortingMode && nextTab !== "commands") {
        uiState.sortingMode = false;
      }

      uiState.activeTab = nextTab;
      // Persist only the main saveable tabs (not 'add' which is a transient form state)
      if (PERSISTABLE_TABS.includes(nextTab)) {
        try {
          localStorage.setItem("selectedTab", nextTab);
        } catch {}
      }
      render();
    });
  });
}
