/*-------------------------------------------------
 * Terminal Recipes — VS Code Extension
 * Copyright (c) 2026 Abdulla Aldosari
 * Licensed under the Apache License, Version 2.0.
 * See LICENSE in the project root for details.
 *-------------------------------------------------*/

// media/modals/edit-command.js
// Edit Command form (rendered as a full tab when uiState.editingCommandId is set).
// Loads after run-confirm.js (renderToggleSwitch3 dependency).

// Isolated working copy of the entire edit form state.
// All user edits go here — the global sources of truth (commandLocalDrafts, etc.)
// are never touched until the user explicitly confirms by clicking Save.
const editCommandBuffer = {
  commandId: null,

  // Working fields — command metadata
  title: "",
  template: "",
  description: "",
  groupId: "",
  targetCategoryId: "",
  helpUrl: "",
  targetShell: "",
  variableMeta: "", // JSON.stringify of variableMeta object

  // Working fields — variable scope data
  local: {}, // { [varName]: value }
  global: {}, // { [varName]: value }
  session: {}, // { [varName]: value }
  remember: {}, // { [varName]: "local"|"global"|"off" }

  // Private originals — captured at form-open time for change detection
  _orig: null,
  // Tracks variable names after the last template edit — used to detect renames
  _prevVarNames: [],

  capture(command) {
    this.commandId = command.id;
    this.title = command.title || "";
    this.template = command.command || "";
    this.description = command.description || "";
    this.groupId = command.groupId || "";
    this.targetCategoryId = command.categoryId || "";
    this.helpUrl = command.helpUrl || "";
    this.targetShell = command.targetShell || "";
    this.variableMeta = JSON.stringify(command.variableMeta || {});
    this.local = Object.assign({}, getCommandLocalDraft(command.id));
    this.global = Object.assign({}, getCommandGlobalDraft(command.id));
    this.session = Object.assign({}, getCommandSessionDraft(command.id));
    this.remember = Object.assign({}, getCommandRemember(command.id));

    const autoVarNamesCapture = getEnabledAutoVariableNames();
    this._prevVarNames = collectVariables([this.template]).filter(function (n) {
      return !autoVarNamesCapture.includes(n);
    });

    this._orig = {
      title: this.title,
      template: this.template,
      description: this.description,
      groupId: this.groupId,
      targetCategoryId: this.targetCategoryId,
      helpUrl: this.helpUrl,
      targetShell: this.targetShell,
      variableMeta: this.variableMeta,
      local: Object.assign({}, this.local),
      global: Object.assign({}, this.global),
      session: Object.assign({}, this.session),
      remember: Object.assign({}, this.remember),
    };
  },

  hasChanged() {
    const o = this._orig;
    if (!o) return true;
    if (this.title !== o.title) return true;
    if (this.template !== o.template) return true;
    if (this.description !== o.description) return true;
    if (this.groupId !== o.groupId) return true;
    if (this.targetCategoryId !== o.targetCategoryId) return true;
    if ((this.helpUrl || "") !== (o.helpUrl || "")) return true;
    if ((this.targetShell || "") !== (o.targetShell || "")) return true;
    if (this.variableMeta !== o.variableMeta) return true;
    if (JSON.stringify(this.local) !== JSON.stringify(o.local)) return true;
    if (JSON.stringify(this.global) !== JSON.stringify(o.global)) return true;
    if (JSON.stringify(this.remember) !== JSON.stringify(o.remember)) return true;
    if (JSON.stringify(this.session) !== JSON.stringify(o.session)) return true;
    return false;
  },

  clear() {
    this.commandId = null;
    this.title = this.template = this.description = "";
    this.groupId = this.targetCategoryId = this.helpUrl = this.targetShell = this.variableMeta = "";
    this.local = this.global = this.session = this.remember = {};
    this._orig = null;
    this._prevVarNames = [];
  },
};

function renderEditTab() {
  const command = getEditingCommand();

  if (!command) {
    return `
      <section class="card">
        <p>Select command edit from Commands tab.</p>
      </section>
    `;
  }

  if (editCommandBuffer.commandId !== command.id) {
    editCommandBuffer.capture(command);
  }

  const targetCategoryId = editCommandBuffer.targetCategoryId || command.categoryId;
  const allCategories = state.data.categories || [];
  const targetCategory = allCategories.find(function (cat) {
    return cat.id === targetCategoryId;
  });
  const groups = targetCategory ? targetCategory.groups || [] : [];
  const autoVarNames = getEnabledAutoVariableNames();
  const variables = collectVariables([editCommandBuffer.template || command.command]).filter(function (n) {
    return !autoVarNames.includes(n);
  });
  const commandRemember = editCommandBuffer.remember;
  const isMoved = targetCategoryId !== command.categoryId;
  const bufferVariableMeta = editCommandBuffer.variableMeta ? JSON.parse(editCommandBuffer.variableMeta) : {};

  return `
    <section class="card recipe-editor">
      <h2>Edit Command</h2>
      <form id="form-edit-command" class="form-grid add-command-grid">
        <label class="add-command-title">Command Title<input id="edit-command-title" class="input" required value="${escapeAttr(editCommandBuffer.title)}" /></label>
        <label class="add-command-template">Command Template<div class="template-editor-wrap"><div class="template-highlight" aria-hidden="true"></div>
        <textarea id="edit-command-template" class="input template-textarea" required rows="1">${escapeHtml(editCommandBuffer.template)}</textarea>
        </div><div class="template-var-legend">

        <span class="legend-item legend-auto hidden" data-tooltip="Reserved variables that are automatically resolved.<br>
        They do not require the user to assign a value."><span class="legend-dot" aria-hidden="true"></span>auto resolved</span>

        <span class="legend-item legend-user hidden" data-tooltip="Variables that are defined by the user.<br>
        Their values must be set by the user."><span class="legend-dot" aria-hidden="true"></span>user defined</span>

        </div></label>
        <label class="full-width">Description<textarea id="edit-command-description" class="input" rows="2">${escapeHtml(editCommandBuffer.description)}</textarea></label>
        <div class="full-width grouped-tags-wrap">
          <span class="groups-label">Category:</span>
          ${renderCustomSelect(
            "edit-category-select-wrap",
            "edit-category-select-btn",
            "edit-category-select-menu",
            allCategories.map(function (cat) {
              return { value: cat.id, label: cat.title };
            }),
            targetCategoryId,
            "cs-btn-sm cs-btn-category", // btnExtraClass
            false, // menuUp
            "cs-wrap-full" // wrapExtraClass
          )}
          ${isMoved ? `<span class="muted move-category-warning">${icons.exclamationTriangle} Moving to new category — (Please select a group from the list below)</span>` : ""}
        </div>
        <div class="full-width grouped-tags-wrap">
          <span class="groups-label">Groups:</span>
          <div class="inline-tags" id="edit-command-groups-tags">
            ${groups.length === 0 ? `<span class="muted">No groups in this category.</span>` : ""}
            ${groups
              .map(function (group) {
                return `<button type="button" class="tag d-focus edit-command-group-tag ${editCommandBuffer.groupId === group.id ? "active" : ""}" data-group-id="${escapeAttr(group.id)}">${escapeHtml(group.title)}</button>`;
              })
              .join("")}
          </div>
        </div>
        <label class="full-width">Help URL (optional)<input id="edit-command-help-url" class="input" placeholder="https://docs.example.com/command" value="${escapeAttr(editCommandBuffer.helpUrl || "")}" /></label>
        <div class="full-width grouped-tags-wrap">
          <span class="groups-label" data-tooltip="Restricts this command to a specific shell.<br>Leave as Any Shell if it works everywhere.">Target Shell:</span>
          ${renderCustomSelect(
            "edit-target-shell-wrap",
            "edit-target-shell-btn",
            "edit-target-shell-menu",
            TARGET_SHELL_OPTIONS,
            editCommandBuffer.targetShell || "",
            "cs-btn-sm", // btnExtraClass
            false // menuUp
          )}
        </div>

        ${
          variables.length
            ? `
        <div class="full-width mt-5">
          <h3>Command Variables:</h3>
          <div class="variables-list">
            <div class="variable-row">
              <span></span>
              <span></span>
              <span class="muted vars-store-location" data-tooltip="Local = saved per workspace only<br>Global = saved across all workspaces<br>Off = not saved">Variables store location</span>
              <span></span>
            </div>
            ${variables
              .map(function (name) {
                const pref = commandRemember[name] || (state.workspaceFolder ? "local" : "global");
                let rawVal;
                if (pref === "local") {
                  rawVal = editCommandBuffer.local[name];
                } else if (pref === "global") {
                  rawVal = editCommandBuffer.global[name];
                } else {
                  rawVal = editCommandBuffer.session[name];
                }
                rawVal = rawVal !== undefined ? rawVal : "";
                const isEmptyVal = rawVal === RECIPES_EMPTY_VALUE;
                const displayVal = isEmptyVal ? "[EmptyValue]" : rawVal;
                const meta = bufferVariableMeta[name];
                const isEnum = meta && meta.type === "enum";
                const enumCount = isEnum ? meta.enumValues.length : 0;
                return `
              <div class="variable-row">
                <label class="variable-name">\${${escapeHtml(name)}}</label>
                <input class="input variable-input" data-command-id="${escapeAttr(command.id)}" data-variable-name="${escapeAttr(name)}" data-scope="${escapeAttr(pref)}" value="${escapeAttr(displayVal)}" placeholder="Enter value..."${isEmptyVal ? ' readonly data-is-empty-value="true"' : ""}/>
                ${renderToggleSwitch3(command.id, name, pref, "variable-remember-toggle")}
                <button type="button" class="btn small ${isEnum ? "primary" : "secondary"} btn-open-enum-manager" data-var-name="${escapeAttr(name)}" data-command-id="${escapeAttr(command.id)}" data-tooltip="Manage Enum values">${icons.adjustments} ${isEnum ? `Enum (${enumCount})` : "Set Enum"}</button>
              </div>
            `;
              })
              .join("")}
            <div class="variable-row">
              <span></span>
              <p class="muted variables-empty-hint"><kbd>Alt+0</kbd> to set focused variable as empty value</p>
              <span></span>
              <span></span>
            </div>
          </div>
        </div>
        `
            : ""
        }
        ${
          command.lastRunAt
            ? `
        <div class="full-width mt-5">
          <span class="muted">Last Run: <strong data-tooltip="${escapeAttr(formatDateTime(command.lastRunAt))}">${escapeHtml(timeAgo(command.lastRunAt))}</strong> &nbsp;·&nbsp; ×${command.runCount || 0} runs</span>
        </div>
        `
            : ""
        }
        <div class="row full-width justify-content-flex-end mt-20">
          <button type="submit" class="btn small primary" id="btn-save-edit-command">Save Changes</button>
          <button type="button" id="btn-cancel-edit-command" class="btn small secondary action">Cancel</button>
        </div>
      </form>
    </section>
  `;
}

function bindEditTabEvents() {
  const command = getEditingCommand();
  const form = document.getElementById("form-edit-command");

  if (!command || !form) {
    return;
  }

  if (editCommandBuffer.commandId !== command.id) {
    editCommandBuffer.capture(command);
  }

  form.addEventListener("submit", function (event) {
    event.preventDefault();

    // Read text fields from DOM into buffer
    const titleEl = document.getElementById("edit-command-title");
    const templateEl = document.getElementById("edit-command-template");
    const descriptionEl = document.getElementById("edit-command-description");
    const helpUrlEl = document.getElementById("edit-command-help-url");

    editCommandBuffer.title = titleEl ? titleEl.value.trim() : "";
    editCommandBuffer.template = templateEl ? templateEl.value.trim() : "";
    editCommandBuffer.description = descriptionEl ? descriptionEl.value : "";
    editCommandBuffer.helpUrl = helpUrlEl ? helpUrlEl.value : "";

    if (editCommandBuffer.title.length < 3) {
      showError("Command Title must be at least 3 characters.");
      render();
      return;
    }

    if (!editCommandBuffer.template) {
      showError("Command Template is required.");
      render();
      return;
    }

    if (!editCommandBuffer.groupId) {
      showError("Please select at least one group from the list below.", icons.exclamationTriangle, "warning");
      render();
      return;
    }

    // Skip persist if nothing changed
    // Note: buffer is already up-to-date via live input/toggle events — no DOM read needed here.
    if (!editCommandBuffer.hasChanged()) {
      const returnTab = uiState.editSourceTab || "commands";
      const savedCommandId = command.id;
      editCommandBuffer.clear();
      uiState.editingCommandId = null;
      uiState.editSourceTab = null;
      uiState.activeTab = returnTab;
      uiState.pendingScrollCommandId = savedCommandId;
      render();
      return;
    }

    // Apply buffer to command object
    command.title = editCommandBuffer.title;
    command.description = editCommandBuffer.description;
    command.command = editCommandBuffer.template;
    command.groupId = editCommandBuffer.groupId;

    if (editCommandBuffer.targetCategoryId && editCommandBuffer.targetCategoryId !== command.categoryId) {
      command.categoryId = editCommandBuffer.targetCategoryId;
    }

    if (editCommandBuffer.helpUrl) {
      command.helpUrl = editCommandBuffer.helpUrl;
    } else {
      delete command.helpUrl;
    }

    if (editCommandBuffer.targetShell) {
      command.targetShell = editCommandBuffer.targetShell;
    } else {
      delete command.targetShell;
    }

    // Prune orphaned variable data — remove any variable no longer in the final template.
    // This is the last line of defense against stale keys left by deletions or renames
    // that were not caught by the 1-to-1 auto-transfer logic in the template input handler.
    const finalVarNames = collectVariables([editCommandBuffer.template]);
    Object.keys(editCommandBuffer.local).forEach(function (k) {
      if (!finalVarNames.includes(k)) delete editCommandBuffer.local[k];
    });
    Object.keys(editCommandBuffer.global).forEach(function (k) {
      if (!finalVarNames.includes(k)) delete editCommandBuffer.global[k];
    });
    Object.keys(editCommandBuffer.session).forEach(function (k) {
      if (!finalVarNames.includes(k)) delete editCommandBuffer.session[k];
    });
    Object.keys(editCommandBuffer.remember).forEach(function (k) {
      if (!finalVarNames.includes(k)) delete editCommandBuffer.remember[k];
    });

    // Apply variableMeta from buffer (after pruning orphaned keys)
    const parsedMeta = editCommandBuffer.variableMeta ? JSON.parse(editCommandBuffer.variableMeta) : {};
    Object.keys(parsedMeta).forEach(function (k) {
      if (!finalVarNames.includes(k)) delete parsedMeta[k];
    });
    if (Object.keys(parsedMeta).length > 0) {
      command.variableMeta = parsedMeta;
    } else {
      delete command.variableMeta;
    }

    // Write buffer scope data to uiState sources of truth for persistence
    uiState.commandLocalDrafts[command.id] = Object.assign({}, editCommandBuffer.local);
    uiState.commandGlobalDrafts[command.id] = Object.assign({}, editCommandBuffer.global);
    uiState.commandSessionDrafts[command.id] = Object.assign({}, editCommandBuffer.session);
    uiState.commandRemember[command.id] = Object.assign({}, editCommandBuffer.remember);

    const savedCommandId = command.id;
    const returnTab = uiState.editSourceTab || "commands";
    editCommandBuffer.clear();
    uiState.editingCommandId = null;
    uiState.editSourceTab = null;
    uiState.activeTab = returnTab;
    uiState.pendingScrollCommandId = savedCommandId;
    persistDataThenRender("Command saved.");
    persistCommandVariables();
  });

  const cancelEditButton = document.getElementById("btn-cancel-edit-command");
  if (cancelEditButton) {
    cancelEditButton.addEventListener("click", function () {
      const savedCommandId = command.id;
      const returnTab = uiState.editSourceTab || "commands";
      editCommandBuffer.clear();
      uiState.editingCommandId = null;
      uiState.editSourceTab = null;
      uiState.activeTab = returnTab;
      uiState.pendingScrollCommandId = savedCommandId;
      render();
    });
  }

  const editCommandTitleInput = document.getElementById("edit-command-title");
  const editCommandTemplateInput = document.getElementById("edit-command-template");
  const editCommandDescriptionInput = document.getElementById("edit-command-description");

  if (editCommandTitleInput) {
    editCommandTitleInput.addEventListener("input", function () {
      editCommandBuffer.title = editCommandTitleInput.value;
    });
  }

  if (editCommandTemplateInput) {
    editCommandTemplateInput.addEventListener("input", function () {
      editCommandBuffer.template = editCommandTemplateInput.value;

      // Detect 1-to-1 variable rename and auto-transfer stored values
      const autoVarNamesNow = getEnabledAutoVariableNames();
      const newVarNames = collectVariables([editCommandBuffer.template]).filter(function (n) {
        return !autoVarNamesNow.includes(n);
      });
      const prevVarNames = editCommandBuffer._prevVarNames;
      const orphaned = prevVarNames.filter(function (n) {
        return !newVarNames.includes(n);
      });
      const added = newVarNames.filter(function (n) {
        return !prevVarNames.includes(n);
      });

      if (orphaned.length === 1 && added.length === 1) {
        const oldName = orphaned[0];
        const newName = added[0];

        // Transfer local scope value
        if (editCommandBuffer.local[oldName] !== undefined) {
          editCommandBuffer.local[newName] = editCommandBuffer.local[oldName];
          delete editCommandBuffer.local[oldName];
        }
        // Transfer global scope value
        if (editCommandBuffer.global[oldName] !== undefined) {
          editCommandBuffer.global[newName] = editCommandBuffer.global[oldName];
          delete editCommandBuffer.global[oldName];
        }
        // Transfer session scope value
        if (editCommandBuffer.session[oldName] !== undefined) {
          editCommandBuffer.session[newName] = editCommandBuffer.session[oldName];
          delete editCommandBuffer.session[oldName];
        }
        // Transfer remember preference
        if (editCommandBuffer.remember[oldName] !== undefined) {
          editCommandBuffer.remember[newName] = editCommandBuffer.remember[oldName];
          delete editCommandBuffer.remember[oldName];
        }
        // Transfer variableMeta (enum definitions)
        const meta = editCommandBuffer.variableMeta ? JSON.parse(editCommandBuffer.variableMeta) : {};
        if (meta[oldName] !== undefined) {
          meta[newName] = meta[oldName];
          delete meta[oldName];
          editCommandBuffer.variableMeta = JSON.stringify(meta);
        }
      }

      // Always update _prevVarNames to reflect the current template state
      editCommandBuffer._prevVarNames = newVarNames;

      // Preserve cursor position before re-render (to update variables section)
      const cursorStart = editCommandTemplateInput.selectionStart;
      const cursorEnd = editCommandTemplateInput.selectionEnd;
      render();
      // Restore focus and cursor after re-render
      const restored = document.getElementById("edit-command-template");
      if (restored) {
        restored.focus();
        restored.setSelectionRange(cursorStart, cursorEnd);
      }
    });
  }

  if (editCommandDescriptionInput) {
    editCommandDescriptionInput.addEventListener("input", function () {
      editCommandBuffer.description = editCommandDescriptionInput.value;
    });
  }

  document.querySelectorAll(".edit-command-group-tag").forEach(function (tabButton) {
    tabButton.addEventListener("click", function () {
      const groupId = tabButton.dataset.groupId;
      editCommandBuffer.groupId = editCommandBuffer.groupId === groupId ? "" : groupId;
      render();
    });
  });

  document.querySelectorAll(".variable-input").forEach(function (input) {
    // Write typed value to the buffer based on data-scope attribute
    input.addEventListener("input", function () {
      const variableName = input.dataset.variableName;
      const scope = input.dataset.scope || editCommandBuffer.remember[variableName] || "off";
      const val = input.value;
      if (scope === "local") {
        editCommandBuffer.local[variableName] = val;
      } else if (scope === "global") {
        editCommandBuffer.global[variableName] = val;
      } else {
        editCommandBuffer.session[variableName] = val;
      }
      // Update scope indicator dots
      const toggleContainer = document.querySelector(
        '.variable-remember-toggle[data-command-id="' +
          input.dataset.commandId +
          '"][data-variable-name="' +
          variableName +
          '"]'
      );
      updateScopeIndicatorDots(toggleContainer, input.dataset.commandId, variableName, scope);
    });

    // Alt+0 to toggle empty value — writes to the buffer
    input.addEventListener("keydown", function (e) {
      if (e.altKey && e.key === "0") {
        e.preventDefault();
        const varName = input.dataset.variableName;
        const scope = input.dataset.scope || editCommandBuffer.remember[varName] || "off";
        if (!varName) {
          return;
        }
        if (input.dataset.isEmptyValue === "true") {
          const saved = input.dataset.preEmptyValue !== undefined ? input.dataset.preEmptyValue : "";
          input.removeAttribute("data-pre-empty-value");
          input.readOnly = false;
          input.removeAttribute("data-is-empty-value");
          input.value = saved;
          if (scope === "local") {
            editCommandBuffer.local[varName] = saved;
          } else if (scope === "global") {
            editCommandBuffer.global[varName] = saved;
          } else {
            editCommandBuffer.session[varName] = saved;
          }
        } else {
          input.setAttribute("data-pre-empty-value", input.value);
          input.readOnly = true;
          input.setAttribute("data-is-empty-value", "true");
          input.value = "[EmptyValue]";
          if (scope === "local") {
            editCommandBuffer.local[varName] = RECIPES_EMPTY_VALUE;
          } else if (scope === "global") {
            editCommandBuffer.global[varName] = RECIPES_EMPTY_VALUE;
          } else {
            editCommandBuffer.session[varName] = RECIPES_EMPTY_VALUE;
          }
        }
      }
    });
  });

  // Bind category selector in edit tab (custom select)
  bindCustomSelect(
    "edit-category-select-wrap",
    "edit-category-select-btn",
    "edit-category-select-menu",
    function (newCategoryId) {
      editCommandBuffer.targetCategoryId = newCategoryId;
      // If the user reverts to the original category, restore the original groupId
      if (newCategoryId === command.categoryId) {
        editCommandBuffer.groupId = command.groupId || "";
      } else {
        editCommandBuffer.groupId = ""; // reset group — it belongs to the new category
      }
      render();
    }
  );

  // Bind helpUrl input in edit tab
  const editHelpUrlInput = document.getElementById("edit-command-help-url");
  if (editHelpUrlInput) {
    editHelpUrlInput.addEventListener("input", function () {
      editCommandBuffer.helpUrl = editHelpUrlInput.value;
    });
  }

  // Bind target shell selector in edit tab (custom select)
  bindCustomSelect("edit-target-shell-wrap", "edit-target-shell-btn", "edit-target-shell-menu", function (newShell) {
    editCommandBuffer.targetShell = newShell;
    render();
  });

  // Bind Enum Manager buttons in edit tab
  document.querySelectorAll(".btn-open-enum-manager").forEach(function (btn) {
    btn.addEventListener("click", function () {
      const varName = btn.dataset.varName;
      const commandId = btn.dataset.commandId || null;

      let currentEnumValues = [];
      if (commandId === null || commandId === "") {
        const meta = uiState.newCommandDraft.variableMeta && uiState.newCommandDraft.variableMeta[varName];
        currentEnumValues =
          meta && meta.type === "enum" && meta.enumValues
            ? meta.enumValues.map(function (e) {
                return Object.assign({}, e);
              })
            : [];
      } else {
        const bufMeta = editCommandBuffer.variableMeta ? JSON.parse(editCommandBuffer.variableMeta) : {};
        const meta = bufMeta[varName];
        currentEnumValues =
          meta && meta.type === "enum" && meta.enumValues
            ? meta.enumValues.map(function (e) {
                return Object.assign({}, e);
              })
            : [];
      }

      enumManagerState = {
        visible: true,
        commandId: commandId === "" ? null : commandId,
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

  // Bind toggle switches in edit tab — switches active scope without re-render
  document.querySelectorAll(".variable-remember-toggle").forEach(function (container) {
    container.querySelectorAll(".toggle-option-3").forEach(function (btn) {
      btn.addEventListener("click", function () {
        if (btn.disabled) {
          return;
        }

        const commandId = container.dataset.commandId;
        const variableName = container.dataset.variableName;
        const newScope = btn.dataset.value;

        // Find the corresponding input element
        const inputEl = document.querySelector(
          '.variable-input[data-command-id="' + commandId + '"][data-variable-name="' + variableName + '"]'
        );

        // Step 1: Save current input value to current scope in buffer
        if (inputEl) {
          const currentActiveBtn = container.querySelector(".toggle-option-3.active");
          const currentScope = currentActiveBtn ? currentActiveBtn.dataset.value : "off";
          const currentVal = inputEl.dataset.isEmptyValue === "true" ? RECIPES_EMPTY_VALUE : inputEl.value;
          if (currentScope === "local") {
            editCommandBuffer.local[variableName] = currentVal;
          } else if (currentScope === "global") {
            editCommandBuffer.global[variableName] = currentVal;
          } else {
            editCommandBuffer.session[variableName] = currentVal;
          }
        }

        // Step 2: Update active class
        container.querySelectorAll(".toggle-option-3").forEach(function (b) {
          b.classList.remove("active");
        });
        btn.classList.add("active");

        // Step 3: Update remember preference in buffer
        editCommandBuffer.remember[variableName] = newScope;

        // Step 4: Load new scope's value into the input from buffer
        if (inputEl) {
          let newVal = "";
          if (newScope === "local") {
            newVal = editCommandBuffer.local[variableName] || "";
          } else if (newScope === "global") {
            newVal = editCommandBuffer.global[variableName] || "";
          } else {
            newVal = editCommandBuffer.session[variableName] || "";
          }
          const isEmptyValue = newVal === RECIPES_EMPTY_VALUE;
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

        // Step 5: Update scope indicator dots
        updateScopeIndicatorDots(container, commandId, variableName, newScope);
        // No auto-save here — save happens on form submit
      });
    });
  });
}
