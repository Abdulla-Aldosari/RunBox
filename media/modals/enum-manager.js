/*-------------------------------------------------
 * Terminal Recipes — VS Code Extension
 * Copyright (c) 2026 Abdulla Aldosari
 * Licensed under the Apache License, Version 2.0.
 * See LICENSE in the project root for details.
 *-------------------------------------------------*/

// media/modals/enum-manager.js
// Enum Manager modal — used by both add-command and edit-command tabs to manage
// enum variable options (title/value/description triplets).
// Loads after new-command.js.

// ─── Enum Manager Modal ────────────────────────────────────────────────────────

/**
 * Renders the Enum Manager modal for a specific variable.
 */
function renderEnumManagerModal() {
  const s = enumManagerState;
  const values = s.enumValues || [];

  const rowsHtml = values
    .map(function (item, idx) {
      return `
      <tr class="enum-row" data-idx="${idx}">
        <td class="enum-cell-title">${escapeHtml(item.title)}</td>
        <td class="enum-cell-value"><code>${escapeHtml(item.value)}</code></td>
        <td class="enum-cell-desc">${escapeHtml(item.description)}</td>
        <td class="enum-cell-actions">
          <div>
            <button type="button" class="btn icon-btn small secondary btn-enum-edit d-focus" data-idx="${idx}" data-tooltip="Edit enum value">${icons.edit}</button>
            <button type="button" class="btn icon-btn small danger btn-enum-delete d-focus" data-idx="${idx}" data-tooltip="Delete enum value">${icons.delete}</button>
          </div>
        </td>
      </tr>
          `;
    })
    .join("");

  const editFormHtml = `
    <div class="enum-add-form">
      <h4>${s.editIndex !== null ? "Edit Enum Value" : "Add Enum Value"}</h4>
      <div class="enum-form-grid">
        <label>Title<input id="enum-input-title" class="input" placeholder="e.g. Silent" value="${escapeAttr(s.editTitle)}" autocomplete="off" /></label>
        <label>Value<input id="enum-input-value" class="input" placeholder="e.g. silent" value="${escapeAttr(s.editValue)}" autocomplete="off" /></label>
        <label class="enum-form-desc">Description<input id="enum-input-desc" class="input" placeholder="What this option does..." value="${escapeAttr(s.editDescription)}" autocomplete="off" /></label>
      </div>
      <div class="row justify-content-flex-end">
        <button type="button" class="btn small primary" id="btn-enum-add-confirm">${s.editIndex !== null ? "Update" : "+ Add"}</button>
        ${s.editIndex !== null ? '<button type="button" class="btn small secondary action" id="btn-enum-edit-cancel">Cancel Edit</button>' : ""}
      </div>
    </div>
  `;

  return `
    <div class="modal-overlay" id="enum-manager-overlay" data-dismiss-on-outside-click="false">
      <div class="modal-box enum-manager-box">
        <div class="row between">
          <h3>Enum Values for <code>\${${escapeHtml(s.varName)}}</code></h3>
          <button class="btn-close d-focus" id="btn-enum-manager-close" type="button" aria-label="Close">${icons.cancel}</button>
        </div>
        ${
          values.length > 0
            ? `
        <div class="table-wrap">
          <div class="enum-table-scroll">
            <table class="enum-table">
              <thead><tr>
                <th>Title</th><th>Value</th><th>Description</th><th></th>
              </tr></thead>
              <tbody>${rowsHtml}</tbody>
            </table>
          </div>
        </div>`
            : `<p class="muted muted-no-margin">No enum values yet. Add one below.</p>`
        }
        ${editFormHtml}
      </div>
    </div>
  `;
}

/**
 * Writes the current enumManagerState.enumValues to the correct target:
 * - newCommandDraft.variableMeta when commandId is null (Add Command context)
 * - editCommandBuffer.variableMeta when commandId is set (Edit Command context)
 * Called after every add, update, or delete action so changes are live.
 */
function flushEnumValuesToTarget() {
  const varName = enumManagerState.varName;
  const commandId = enumManagerState.commandId;
  const enumValues = enumManagerState.enumValues.slice();

  if (commandId === null) {
    // New command context
    if (!uiState.newCommandDraft.variableMeta) {
      uiState.newCommandDraft.variableMeta = {};
    }
    if (enumValues.length > 0) {
      uiState.newCommandDraft.variableMeta[varName] = { type: "enum", enumValues };
    } else {
      delete uiState.newCommandDraft.variableMeta[varName];
    }
  } else {
    // Edit command context — write ONLY to buffer, not to command directly.
    // The main Save Changes button applies buffer.variableMeta to command on confirm.
    const currentMeta = editCommandBuffer.variableMeta ? JSON.parse(editCommandBuffer.variableMeta) : {};
    if (enumValues.length > 0) {
      currentMeta[varName] = { type: "enum", enumValues };
    } else {
      delete currentMeta[varName];
    }
    editCommandBuffer.variableMeta = JSON.stringify(currentMeta);
  }
}

/**
 * Binds events for the Enum Manager modal.
 */
function bindEnumManagerEvents() {
  // --- Add / Update enum value ---
  const confirmBtn = document.getElementById("btn-enum-add-confirm");
  if (confirmBtn) {
    confirmBtn.addEventListener("click", function () {
      const titleInput = document.getElementById("enum-input-title");
      const valueInput = document.getElementById("enum-input-value");
      const descInput = document.getElementById("enum-input-desc");

      const title = titleInput ? titleInput.value.trim() : "";
      const value = valueInput ? valueInput.value.trim() : "";
      const description = descInput ? descInput.value.trim() : "";

      if (!title || !value) {
        showNotice("Title and Value are required.", icons.exclamationTriangle, "warning");
        return;
      }

      if (enumManagerState.editIndex !== null) {
        enumManagerState.enumValues[enumManagerState.editIndex] = { title, value, description };
        enumManagerState.editIndex = null;
        enumManagerState.editTitle = "";
        enumManagerState.editValue = "";
        enumManagerState.editDescription = "";
      } else {
        enumManagerState.enumValues.push({ title, value, description });
        enumManagerState.editTitle = "";
        enumManagerState.editValue = "";
        enumManagerState.editDescription = "";
      }

      // Immediately apply to target — no separate Save step needed
      flushEnumValuesToTarget();
      render();
    });
  }

  // --- Cancel edit ---
  const cancelEditBtn = document.getElementById("btn-enum-edit-cancel");
  if (cancelEditBtn) {
    cancelEditBtn.addEventListener("click", function () {
      enumManagerState.editIndex = null;
      enumManagerState.editTitle = "";
      enumManagerState.editValue = "";
      enumManagerState.editDescription = "";
      render();
    });
  }

  // --- Edit row buttons ---
  document.querySelectorAll(".btn-enum-edit").forEach(function (btn) {
    btn.addEventListener("click", function () {
      const idx = parseInt(btn.dataset.idx, 10);
      const item = enumManagerState.enumValues[idx];
      if (!item) {
        return;
      }
      enumManagerState.editIndex = idx;
      enumManagerState.editTitle = item.title;
      enumManagerState.editValue = item.value;
      enumManagerState.editDescription = item.description;
      render();
    });
  });

  // --- Delete row buttons ---
  document.querySelectorAll(".btn-enum-delete").forEach(function (btn) {
    btn.addEventListener("click", function () {
      const idx = parseInt(btn.dataset.idx, 10);
      enumManagerState.enumValues.splice(idx, 1);
      if (enumManagerState.editIndex === idx) {
        enumManagerState.editIndex = null;
        enumManagerState.editTitle = "";
        enumManagerState.editValue = "";
        enumManagerState.editDescription = "";
      }

      // Immediately apply to target — no separate Save step needed
      flushEnumValuesToTarget();
      render();
    });
  });

  // --- Close button (X) — dismisses the modal, changes already applied live ---
  const closeBtn = document.getElementById("btn-enum-manager-close");
  if (closeBtn) {
    closeBtn.addEventListener("click", function () {
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
    });
  }

  // --- Live input tracking ---
  const titleInput = document.getElementById("enum-input-title");
  const valueInput = document.getElementById("enum-input-value");
  const descInput = document.getElementById("enum-input-desc");

  if (titleInput) {
    titleInput.addEventListener("input", function () {
      enumManagerState.editTitle = titleInput.value;
    });
  }
  if (valueInput) {
    valueInput.addEventListener("input", function () {
      enumManagerState.editValue = valueInput.value;
    });
  }
  if (descInput) {
    descInput.addEventListener("input", function () {
      enumManagerState.editDescription = descInput.value;
    });
  }
}
