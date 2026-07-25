/*-------------------------------------------------
 * RunBox — VS Code Extension
 * Copyright (c) 2026 Abdulla Aldosari
 * Licensed under the Apache License, Version 2.0.
 * See LICENSE in the project root for details.
 *-------------------------------------------------*/

// media/modals/command-form.js
// Single source of truth for the Command form UI (both "add" and "edit" modes).
// Rendered as a full tab: "add" when uiState.activeTab === "add",
// "edit" when uiState.editingCommandId is set.
// Loads after run-confirm.js (renderToggleSwitch3 dependency).

// DOM binding key used in data-command-id for every variable row inside this form.
// It is never used as a storage key — all form data lives in commandFormBuffer.
const COMMAND_FORM_CTX = "__form__";

/**
 * Returns the user-defined variable names of a template
 * (auto-resolved variables are excluded).
 * @param {string} template
 * @returns {string[]}
 */
function getUserVariableNames(template) {
  const autoNames = getEnabledAutoVariableNames();
  return collectVariables([template || ""]).filter(function (name) {
    return !autoNames.includes(name);
  });
}

// Isolated working copy of the whole form state, used by BOTH modes.
// The global sources of truth (state.data.commands, commandLocalDrafts, ...)
// are never touched until the user confirms by submitting the form.
const commandFormBuffer = {
  mode: null, // "add" | "edit" | null
  commandId: null, // null in "add" mode

  // Working fields — command metadata
  categoryId: "",
  title: "",
  template: "",
  description: "",
  groupId: "",
  helpUrl: "",
  targetShell: "",
  variableMeta: "{}", // JSON.stringify of the variableMeta object

  // Working fields — variable scope data
  local: {}, // { [varName]: value }
  global: {}, // { [varName]: value }
  session: {}, // { [varName]: value }
  remember: {}, // { [varName]: "local"|"global"|"off" }

  // Private originals — captured at form-open time for change detection
  _orig: null,
  // Variable names after the last template edit — used to detect renames
  _prevVarNames: [],

  /**
   * Opens the form in "add" mode for a category.
   * @param {object} category - Category the new command belongs to
   * @param {string} [presetGroupId] - Group pre-selected from the active filter
   */
  captureNew(category, presetGroupId) {
    this.mode = "add";
    this.commandId = null;
    this.categoryId = category ? category.id : "";
    this.title = "";
    this.template = "";
    this.description = "";
    this.groupId = presetGroupId || "";
    this.helpUrl = "";
    this.targetShell = "";
    this.variableMeta = "{}";
    this.local = {};
    this.global = {};
    this.session = {};
    this.remember = {};
    this._orig = null;
    this._prevVarNames = [];
  },

  /**
   * Opens the form in "edit" mode for an existing command.
   * @param {object} command
   */
  capture(command) {
    this.mode = "edit";
    this.commandId = command.id;
    this.categoryId = command.categoryId || "";
    this.title = command.title || "";
    this.template = command.command || "";
    this.description = command.description || "";
    this.groupId = command.groupId || "";
    this.helpUrl = command.helpUrl || "";
    this.targetShell = command.targetShell || "";
    this.variableMeta = JSON.stringify(command.variableMeta || {});
    this.local = Object.assign({}, getCommandLocalDraft(command.id));
    this.global = Object.assign({}, getCommandGlobalDraft(command.id));
    this.session = Object.assign({}, getCommandSessionDraft(command.id));
    this.remember = Object.assign({}, getCommandRemember(command.id));
    this._prevVarNames = getUserVariableNames(this.template);

    this._orig = {
      categoryId: this.categoryId,
      title: this.title,
      template: this.template,
      description: this.description,
      groupId: this.groupId,
      helpUrl: this.helpUrl,
      targetShell: this.targetShell,
      variableMeta: this.variableMeta,
      local: Object.assign({}, this.local),
      global: Object.assign({}, this.global),
      session: Object.assign({}, this.session),
      remember: Object.assign({}, this.remember),
    };
  },

  /**
   * True when any field differs from the captured original.
   * Always true in "add" mode (no original to compare against).
   * @returns {boolean}
   */
  hasChanged() {
    const o = this._orig;
    if (!o) {
      return true;
    }
    if (this.categoryId !== o.categoryId) return true;
    if (this.title !== o.title) return true;
    if (this.template !== o.template) return true;
    if (this.description !== o.description) return true;
    if (this.groupId !== o.groupId) return true;
    if ((this.helpUrl || "") !== (o.helpUrl || "")) return true;
    if ((this.targetShell || "") !== (o.targetShell || "")) return true;
    if (this.variableMeta !== o.variableMeta) return true;
    if (JSON.stringify(this.local) !== JSON.stringify(o.local)) return true;
    if (JSON.stringify(this.global) !== JSON.stringify(o.global)) return true;
    if (JSON.stringify(this.session) !== JSON.stringify(o.session)) return true;
    if (JSON.stringify(this.remember) !== JSON.stringify(o.remember)) return true;
    return false;
  },

  clear() {
    this.mode = null;
    this.commandId = null;
    this.categoryId = this.title = this.template = this.description = "";
    this.groupId = this.helpUrl = this.targetShell = "";
    this.variableMeta = "{}";
    this.local = {};
    this.global = {};
    this.session = {};
    this.remember = {};
    this._orig = null;
    this._prevVarNames = [];
  },

  /**
   * Scope source used to paint the scope indicator dots.
   * @returns {{ local: object, global: object }}
   */
  scopeSource() {
    return { local: this.local, global: this.global };
  },

  /**
   * Returns the mutable value map of a scope.
   * @param {string} scope - "local" | "global" | anything else (session)
   * @returns {object}
   */
  scopeDraft(scope) {
    if (scope === "local") {
      return this.local;
    }
    if (scope === "global") {
      return this.global;
    }
    return this.session;
  },

  /** @returns {object} Parsed variableMeta */
  getMeta() {
    return this.variableMeta ? JSON.parse(this.variableMeta) : {};
  },

  /** @param {object} meta */
  setMeta(meta) {
    this.variableMeta = JSON.stringify(meta || {});
  },
};

// ─── Render ───────────────────────────────────────────────────────────────────

/**
 * Renders the Command Variables block of the form.
 * @param {string[]} variables - User-defined variable names in the template
 * @returns {string} HTML string
 */
function renderCommandFormVariables(variables) {
  if (!variables.length) {
    return "";
  }

  const meta = commandFormBuffer.getMeta();
  const scopeSource = commandFormBuffer.scopeSource();

  const rows = variables
    .map(function (name) {
      const pref = commandFormBuffer.remember[name] || "off";
      const rawVal = commandFormBuffer.scopeDraft(pref)[name];
      const value = rawVal !== undefined ? rawVal : "";
      const isEmptyVal = value === RUNBOX_EMPTY_VALUE;
      const displayVal = isEmptyVal ? "[EmptyValue]" : value;
      const varMeta = meta[name];
      const isEnum = !!(varMeta && varMeta.type === "enum");
      const enumCount = isEnum ? varMeta.enumValues.length : 0;

      return `
              <div class="variable-row">
                <label class="variable-name">\${${escapeHtml(name)}}</label>
                <input class="input variable-input" data-command-id="${COMMAND_FORM_CTX}" data-variable-name="${escapeAttr(name)}" data-scope="${escapeAttr(pref)}" value="${escapeAttr(displayVal)}" placeholder="Enter value..."${isEmptyVal ? ' readonly data-is-empty-value="true"' : ""} />
                ${renderToggleSwitch3(COMMAND_FORM_CTX, name, pref, "variable-remember-toggle", scopeSource)}
                <button type="button" class="btn small ${isEnum ? "primary" : "secondary"} btn-open-enum-manager" data-var-name="${escapeAttr(name)}" data-tooltip="Manage Enum values for this variable">${icons.adjustments} ${isEnum ? `Enum (${enumCount})` : "Set Enum"}</button>
              </div>
            `;
    })
    .join("");

  return `
        <div class="full-width mt-5">
          <h3>Command Variables:</h3>
          <div class="variables-list">
            <div class="variable-row">
              <span></span>
              <span></span>
              <span class="muted vars-store-location" data-tooltip="Local = saved per workspace only<br>Global = saved across all workspaces<br>Off = not saved">Variables store location</span>
              <span></span>
            </div>
            ${rows}
            <div class="variable-row">
              <span></span>
              <p class="muted variables-empty-hint"><kbd>Alt+0</kbd> to set focused variable as empty value</p>
              <span></span>
              <span></span>
            </div>
          </div>
        </div>
  `;
}

/**
 * Renders the Command form. Single HTML source for both modes.
 * @param {string} mode - "add" | "edit"
 * @returns {string} HTML string
 */
function renderCommandForm(mode) {
  const isEdit = mode === "edit";
  const command = isEdit ? getEditingCommand() : null;

  if (isEdit) {
    if (!command) {
      return `
      <section class="card">
        <p>Select command edit from Commands tab.</p>
      </section>
    `;
    }
    if (commandFormBuffer.mode !== "edit" || commandFormBuffer.commandId !== command.id) {
      commandFormBuffer.capture(command);
    }
  } else {
    const selectedCategory = getSelectedCategory();
    if (!selectedCategory) {
      return `
      <section class="card">
        <p>Add a category first in Categories &amp; Groups tab.</p>
      </section>
    `;
    }
    if (commandFormBuffer.mode !== "add") {
      commandFormBuffer.captureNew(
        selectedCategory,
        uiState.selectedGroupId && uiState.selectedGroupId !== "all" ? uiState.selectedGroupId : ""
      );
    }
  }

  const allCategories = state.data.categories || [];
  const category =
    allCategories.find(function (cat) {
      return cat.id === commandFormBuffer.categoryId;
    }) || null;
  const groups = category ? category.groups || [] : [];
  const variables = getUserVariableNames(commandFormBuffer.template);
  const isMoved = isEdit && commandFormBuffer.categoryId !== command.categoryId;

  return `
    <section class="card recipe-editor">
      <h2>${isEdit ? "Edit Command" : `Add Command to ( ${escapeHtml(category ? category.title : "")} )`}</h2>
      <form id="form-command-form" class="form-grid add-command-grid">
        <label class="add-command-title">Command Title<input id="command-form-title" class="input" required value="${escapeAttr(commandFormBuffer.title)}" /></label>
        <label class="add-command-template">Command Template (Variables supported)<div class="template-editor-wrap"><div class="template-highlight" aria-hidden="true"></div>
        <textarea id="command-form-template" class="input template-textarea" required placeholder="npm install \${package_name}" rows="1">${escapeHtml(commandFormBuffer.template)}</textarea></div>
        <div class="template-var-legend">

        <span class="legend-item legend-auto hidden" data-tooltip="Reserved variables that are automatically resolved.<br>
        They do not require the user to assign a value."><span class="legend-dot" aria-hidden="true"></span>auto resolved</span>

        <span class="legend-item legend-user hidden" data-tooltip="Variables that are defined by the user.<br>
        Their values must be set by the user."><span class="legend-dot" aria-hidden="true"></span>user defined</span></div>
        </label>
        <label class="full-width">Description<textarea id="command-form-description" class="input" rows="2">${escapeHtml(commandFormBuffer.description)}</textarea></label>
        ${
          isEdit
            ? `<div class="full-width grouped-tags-wrap">
          <span class="groups-label">Category:</span>
          ${renderCustomSelect(
            "command-form-category-wrap",
            "command-form-category-btn",
            "command-form-category-menu",
            allCategories.map(function (cat) {
              return { value: cat.id, label: cat.title };
            }),
            commandFormBuffer.categoryId,
            "cs-btn-sm cs-btn-category", // btnExtraClass
            false, // menuUp
            "cs-wrap-full" // wrapExtraClass
          )}
          ${isMoved ? `<span class="muted move-category-warning">${icons.exclamationTriangle} Moving to new category - (Please select a group from the list below)</span>` : ""}
        </div>`
            : ""
        }
        <div class="full-width grouped-tags-wrap">
          <span class="groups-label">Groups:</span>
          <div class="inline-tags" id="command-form-groups-tags">
            ${groups.length === 0 ? `<span class="muted">No groups in this category.</span>` : ""}
            ${groups
              .map(function (group) {
                return `<button type="button" class="tag d-focus command-form-group-tag ${commandFormBuffer.groupId === group.id ? "active" : ""}" data-group-id="${escapeAttr(group.id)}">${escapeHtml(group.title)}</button>`;
              })
              .join("")}
          </div>
        </div>
        <label class="full-width">Help URL (optional)<input id="command-form-help-url" class="input" placeholder="https://docs.example.com/command" value="${escapeAttr(commandFormBuffer.helpUrl || "")}" /></label>
        <div class="full-width grouped-tags-wrap">
          <span class="groups-label" data-tooltip="Restricts this command to a specific shell.<br>Leave as Any Shell if it works everywhere.">Target Shell:</span>
          ${renderCustomSelect(
            "command-form-shell-wrap",
            "command-form-shell-btn",
            "command-form-shell-menu",
            TARGET_SHELL_OPTIONS,
            commandFormBuffer.targetShell || "",
            "cs-btn-sm", // btnExtraClass
            false // menuUp
          )}
        </div>

        ${renderCommandFormVariables(variables)}
        ${
          isEdit && command.lastRunAt
            ? `
        <div class="full-width mt-5">
          <span class="muted">Last Run: <strong data-tooltip="${escapeAttr(formatDateTime(command.lastRunAt))}">${escapeHtml(timeAgo(command.lastRunAt))}</strong> &nbsp;·&nbsp; ×${command.runCount || 0} runs</span>
        </div>
        `
            : ""
        }
        <div class="row full-width justify-content-flex-end mt-20">
          <button type="submit" class="btn small primary" id="btn-command-form-submit">${isEdit ? "Save Changes" : "Add Command"}</button>
          <button type="button" id="btn-command-form-cancel" class="btn small secondary action">Cancel</button>
        </div>
      </form>
    </section>
  `;
}

// ─── Buffer Mutation Helpers ──────────────────────────────────────────────────

/**
 * Transfers all stored data of a renamed variable (1-to-1 rename only).
 * @param {string} oldName
 * @param {string} newName
 */
function transferVariableData(oldName, newName) {
  ["local", "global", "session", "remember"].forEach(function (key) {
    const map = commandFormBuffer[key];
    if (map[oldName] !== undefined) {
      map[newName] = map[oldName];
      delete map[oldName];
    }
  });

  const meta = commandFormBuffer.getMeta();
  if (meta[oldName] !== undefined) {
    meta[newName] = meta[oldName];
    delete meta[oldName];
    commandFormBuffer.setMeta(meta);
  }
}

/**
 * Removes every buffered key that is no longer present in the template.
 * Last line of defense against stale keys left by deletions or renames
 * that the 1-to-1 auto-transfer could not detect.
 * @param {string[]} finalVarNames - All variable names of the final template
 */
function pruneOrphanVariables(finalVarNames) {
  ["local", "global", "session", "remember"].forEach(function (key) {
    const map = commandFormBuffer[key];
    Object.keys(map).forEach(function (varName) {
      if (!finalVarNames.includes(varName)) {
        delete map[varName];
      }
    });
  });

  const meta = commandFormBuffer.getMeta();
  Object.keys(meta).forEach(function (varName) {
    if (!finalVarNames.includes(varName)) {
      delete meta[varName];
    }
  });
  commandFormBuffer.setMeta(meta);
}

/**
 * Copies the buffered scope data to the global sources of truth.
 * @param {string} commandId
 */
function flushScopeDataToState(commandId) {
  uiState.commandLocalDrafts[commandId] = Object.assign({}, commandFormBuffer.local);
  uiState.commandGlobalDrafts[commandId] = Object.assign({}, commandFormBuffer.global);
  uiState.commandSessionDrafts[commandId] = Object.assign({}, commandFormBuffer.session);
  uiState.commandRemember[commandId] = Object.assign({}, commandFormBuffer.remember);
}

/**
 * Closes the form, clears the buffer and returns to the originating tab.
 * @param {string|null} savedCommandId - Command row to scroll to after render
 */
function closeCommandForm(savedCommandId) {
  const returnTab = commandFormBuffer.mode === "edit" ? uiState.editSourceTab || "commands" : "commands";
  commandFormBuffer.clear();
  uiState.editingCommandId = null;
  uiState.editSourceTab = null;
  uiState.activeTab = returnTab;
  uiState.pendingScrollCommandId = savedCommandId || null;
}

// ─── Events ───────────────────────────────────────────────────────────────────

/**
 * Binds the variable value inputs (typing + Alt+0 empty-value toggle).
 */
function bindCommandFormVariableInputs() {
  document.querySelectorAll('.variable-input[data-command-id="' + COMMAND_FORM_CTX + '"]').forEach(function (input) {
    input.addEventListener("input", function () {
      const variableName = input.dataset.variableName;
      const scope = input.dataset.scope || commandFormBuffer.remember[variableName] || "off";
      commandFormBuffer.scopeDraft(scope)[variableName] = input.value;

      const toggleContainer = document.querySelector(
        '.variable-remember-toggle[data-command-id="' +
          COMMAND_FORM_CTX +
          '"][data-variable-name="' +
          variableName +
          '"]'
      );
      updateScopeIndicatorDots(toggleContainer, variableName, commandFormBuffer.scopeSource());
    });

    input.addEventListener("keydown", function (e) {
      if (!e.altKey || e.key !== "0") {
        return;
      }
      e.preventDefault();

      const variableName = input.dataset.variableName;
      if (!variableName) {
        return;
      }
      const scope = input.dataset.scope || commandFormBuffer.remember[variableName] || "off";
      const scopeDraft = commandFormBuffer.scopeDraft(scope);

      if (input.dataset.isEmptyValue === "true") {
        const saved = input.dataset.preEmptyValue !== undefined ? input.dataset.preEmptyValue : "";
        input.removeAttribute("data-pre-empty-value");
        input.readOnly = false;
        input.removeAttribute("data-is-empty-value");
        input.value = saved;
        scopeDraft[variableName] = saved;
      } else {
        input.setAttribute("data-pre-empty-value", input.value);
        input.readOnly = true;
        input.setAttribute("data-is-empty-value", "true");
        input.value = "[EmptyValue]";
        scopeDraft[variableName] = RUNBOX_EMPTY_VALUE;
      }
    });
  });
}

/**
 * Binds the 3-way scope toggles. Switching a scope swaps the input value
 * in place without a full re-render.
 */
function bindCommandFormScopeToggles() {
  document
    .querySelectorAll('.variable-remember-toggle[data-command-id="' + COMMAND_FORM_CTX + '"]')
    .forEach(function (container) {
      container.querySelectorAll(".toggle-option-3").forEach(function (btn) {
        btn.addEventListener("click", function () {
          if (btn.disabled) {
            return;
          }

          const variableName = container.dataset.variableName;
          const newScope = btn.dataset.value;
          const inputEl = document.querySelector(
            '.variable-input[data-command-id="' + COMMAND_FORM_CTX + '"][data-variable-name="' + variableName + '"]'
          );

          // Step 1: Save the current input value into the currently active scope
          if (inputEl) {
            const currentActiveBtn = container.querySelector(".toggle-option-3.active");
            const currentScope = currentActiveBtn ? currentActiveBtn.dataset.value : "off";
            const currentVal = inputEl.dataset.isEmptyValue === "true" ? RUNBOX_EMPTY_VALUE : inputEl.value;
            commandFormBuffer.scopeDraft(currentScope)[variableName] = currentVal;
          }

          // Step 2: Move the active class
          container.querySelectorAll(".toggle-option-3").forEach(function (b) {
            b.classList.remove("active");
          });
          btn.classList.add("active");

          // Step 3: Update the scope preference
          commandFormBuffer.remember[variableName] = newScope;

          // Step 4: Load the new scope value into the input
          if (inputEl) {
            const newVal = commandFormBuffer.scopeDraft(newScope)[variableName] || "";
            const isEmptyValue = newVal === RUNBOX_EMPTY_VALUE;
            inputEl.value = isEmptyValue ? "[EmptyValue]" : newVal;
            inputEl.readOnly = isEmptyValue;
            if (isEmptyValue) {
              inputEl.setAttribute("data-is-empty-value", "true");
            } else {
              inputEl.removeAttribute("data-is-empty-value");
            }
            inputEl.removeAttribute("data-pre-empty-value");
            inputEl.setAttribute("data-scope", newScope);
          }

          // Step 5: Repaint the scope indicator dots
          updateScopeIndicatorDots(container, variableName, commandFormBuffer.scopeSource());
        });
      });
    });
}

/**
 * Binds the "Set Enum / Enum (n)" buttons. Enum values are always read from
 * and written back to the form buffer.
 */
function bindCommandFormEnumButtons() {
  document.querySelectorAll(".btn-open-enum-manager").forEach(function (btn) {
    btn.addEventListener("click", function () {
      const varName = btn.dataset.varName;
      const meta = commandFormBuffer.getMeta()[varName];
      const currentEnumValues =
        meta && meta.type === "enum" && meta.enumValues
          ? meta.enumValues.map(function (item) {
              return Object.assign({}, item);
            })
          : [];

      enumManagerState = {
        visible: true,
        varName,
        enumValues: currentEnumValues,
        editIndex: null,
        editTitle: "",
        editValue: "",
        editDescription: "",
      };
      render();
    });
  });
}

/**
 * Binds the template textarea: keeps the buffer in sync, auto-transfers data
 * on a 1-to-1 variable rename, then re-renders while preserving the caret.
 */
function bindCommandFormTemplateInput() {
  const templateInput = document.getElementById("command-form-template");
  if (!templateInput) {
    return;
  }

  templateInput.addEventListener("input", function () {
    commandFormBuffer.template = templateInput.value;

    const newVarNames = getUserVariableNames(commandFormBuffer.template);
    const prevVarNames = commandFormBuffer._prevVarNames;
    const orphaned = prevVarNames.filter(function (name) {
      return !newVarNames.includes(name);
    });
    const added = newVarNames.filter(function (name) {
      return !prevVarNames.includes(name);
    });

    if (orphaned.length === 1 && added.length === 1) {
      transferVariableData(orphaned[0], added[0]);
    }

    commandFormBuffer._prevVarNames = newVarNames;

    // Preserve the caret across the re-render triggered by the variables list
    const cursorStart = templateInput.selectionStart;
    const cursorEnd = templateInput.selectionEnd;
    render();
    const restored = document.getElementById("command-form-template");
    if (restored) {
      restored.focus();
      restored.setSelectionRange(cursorStart, cursorEnd);
    }
  });
}

/**
 * Validates the buffer and reports the first problem found.
 * @returns {boolean} True when the buffer is valid
 */
function validateCommandForm() {
  if (commandFormBuffer.title.length < 3) {
    showError("Command Title must be at least 3 characters.");
    return false;
  }
  if (!commandFormBuffer.template) {
    showError("Command Template is required.");
    return false;
  }
  if (!commandFormBuffer.groupId) {
    showError("Please select at least one group from the list below.", icons.exclamationTriangle, "warning");
    return false;
  }
  return true;
}

/**
 * Creates the new command from the buffer and persists it.
 */
function submitAddCommand() {
  const newCommand = {
    id: generateEntityId("cmd"),
    title: commandFormBuffer.title,
    description: commandFormBuffer.description,
    command: commandFormBuffer.template,
    categoryId: commandFormBuffer.categoryId,
    groupId: commandFormBuffer.groupId,
    ...(commandFormBuffer.helpUrl ? { helpUrl: commandFormBuffer.helpUrl } : {}),
    ...(commandFormBuffer.targetShell ? { targetShell: commandFormBuffer.targetShell } : {}),
  };

  const meta = commandFormBuffer.getMeta();
  if (Object.keys(meta).length > 0) {
    newCommand.variableMeta = meta;
  }

  state.data.commands.push(newCommand);
  flushScopeDataToState(newCommand.id);
  closeCommandForm(newCommand.id);
  persistDataThenRender("Command added.");
  persistCommandVariables();
}

/**
 * Applies the buffer to the edited command and persists it.
 * @param {object} command - The command being edited
 */
function submitEditCommand(command) {
  if (!commandFormBuffer.hasChanged()) {
    closeCommandForm(command.id);
    render();
    return;
  }

  command.title = commandFormBuffer.title;
  command.description = commandFormBuffer.description;
  command.command = commandFormBuffer.template;
  command.groupId = commandFormBuffer.groupId;
  command.categoryId = commandFormBuffer.categoryId;

  if (commandFormBuffer.helpUrl) {
    command.helpUrl = commandFormBuffer.helpUrl;
  } else {
    delete command.helpUrl;
  }

  if (commandFormBuffer.targetShell) {
    command.targetShell = commandFormBuffer.targetShell;
  } else {
    delete command.targetShell;
  }

  const meta = commandFormBuffer.getMeta();
  if (Object.keys(meta).length > 0) {
    command.variableMeta = meta;
  } else {
    delete command.variableMeta;
  }

  flushScopeDataToState(command.id);
  closeCommandForm(command.id);
  persistDataThenRender("Command saved.");
  persistCommandVariables();
}

/**
 * Binds every event of the Command form.
 * @param {string} mode - "add" | "edit"
 */
function bindCommandFormEvents(mode) {
  const isEdit = mode === "edit";
  const command = isEdit ? getEditingCommand() : null;
  const form = document.getElementById("form-command-form");

  if (!form || (isEdit && !command)) {
    return;
  }

  if (isEdit && (commandFormBuffer.mode !== "edit" || commandFormBuffer.commandId !== command.id)) {
    commandFormBuffer.capture(command);
  }

  const titleInput = document.getElementById("command-form-title");
  const descriptionInput = document.getElementById("command-form-description");
  const helpUrlInput = document.getElementById("command-form-help-url");

  if (titleInput) {
    titleInput.addEventListener("input", function () {
      commandFormBuffer.title = titleInput.value;
    });
  }

  if (descriptionInput) {
    descriptionInput.addEventListener("input", function () {
      commandFormBuffer.description = descriptionInput.value;
    });
  }

  if (helpUrlInput) {
    helpUrlInput.addEventListener("input", function () {
      commandFormBuffer.helpUrl = helpUrlInput.value;
    });
  }

  bindCommandFormTemplateInput();

  document.querySelectorAll(".command-form-group-tag").forEach(function (tagButton) {
    tagButton.addEventListener("click", function () {
      const groupId = tagButton.dataset.groupId;
      commandFormBuffer.groupId = commandFormBuffer.groupId === groupId ? "" : groupId;
      render();
    });
  });

  if (isEdit) {
    bindCustomSelect(
      "command-form-category-wrap",
      "command-form-category-btn",
      "command-form-category-menu",
      function (newCategoryId) {
        commandFormBuffer.categoryId = newCategoryId;
        // Restore the original group when reverting to the original category,
        // otherwise reset it — a group belongs to a single category
        commandFormBuffer.groupId = newCategoryId === command.categoryId ? command.groupId || "" : "";
        render();
      }
    );
  }

  bindCustomSelect("command-form-shell-wrap", "command-form-shell-btn", "command-form-shell-menu", function (newShell) {
    commandFormBuffer.targetShell = newShell;
    render();
  });

  bindCommandFormVariableInputs();
  bindCommandFormScopeToggles();
  bindCommandFormEnumButtons();

  const cancelButton = document.getElementById("btn-command-form-cancel");
  if (cancelButton) {
    cancelButton.addEventListener("click", function () {
      closeCommandForm(isEdit ? command.id : null);
      render();
    });
  }

  form.addEventListener("submit", function (event) {
    event.preventDefault();

    // Read the text fields from the DOM into the buffer
    commandFormBuffer.title = titleInput ? titleInput.value.trim() : "";
    commandFormBuffer.template = document.getElementById("command-form-template")
      ? document.getElementById("command-form-template").value.trim()
      : "";
    commandFormBuffer.description = descriptionInput ? descriptionInput.value.trim() : "";
    commandFormBuffer.helpUrl = helpUrlInput ? helpUrlInput.value.trim() : "";

    if (!validateCommandForm()) {
      render();
      return;
    }

    pruneOrphanVariables(collectVariables([commandFormBuffer.template]));

    if (isEdit) {
      submitEditCommand(command);
    } else {
      submitAddCommand();
    }
  });
}
