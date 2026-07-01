/*-------------------------------------------------
 * Terminal Recipes — VS Code Extension
 * Copyright (c) 2026 Abdulla Aldosari
 * Licensed under the Apache License, Version 2.0.
 * See LICENSE in the project root for details.
 *-------------------------------------------------*/

// media/modals/run-confirm.js
// Run Confirmation modal (shell picker + variable entry) and Delete Confirm modal.
// All functions rely on globals from state.js, icons.js, and utils.js.

function renderToggleSwitch3(commandId, varName, currentValue, extraClass) {
  const noWorkspace = !state.workspaceFolder;

  // Check which scopes have stored values — used for the indicator dot
  const localDraft = getCommandLocalDraft(commandId);
  const globalDraft = getCommandGlobalDraft(commandId);
  const hasLocal = localDraft[varName] !== undefined && localDraft[varName] !== "";
  const hasGlobal = globalDraft[varName] !== undefined && globalDraft[varName] !== "";

  const opts = [
    { value: "local", label: "Local", disabled: noWorkspace, hasValue: hasLocal },
    { value: "off", label: "Off", disabled: false, hasValue: false },
    { value: "global", label: "Global", disabled: false, hasValue: hasGlobal },
  ];

  return `
    <div class="toggle-switch-3 ${escapeAttr(extraClass)}" data-command-id="${escapeAttr(commandId)}" data-variable-name="${escapeAttr(varName)}"
         data-tooltip-pos="top"
         data-tooltip="Active scope for this variable<br><strong>Local</strong> = use &amp; edit the workspace-local value<br><strong>Global</strong> = use &amp; edit the global value<br><strong>Off</strong> = session-only value (not saved to disk)">
      ${opts
        .map(function (opt) {
          return `<button type="button" class="toggle-option-3 d-focus ${currentValue === opt.value ? "active" : ""}" data-value="${opt.value}" ${opt.disabled ? "disabled" : ""}>${opt.label}<span class="scope-value-dot${opt.hasValue ? " has-value" : ""}"></span></button>`;
        })
        .join("")}
    </div>
  `;
}

function renderShellSelector() {
  const profiles = (state.terminalProfiles && state.terminalProfiles.profiles) || [];
  if (!profiles.length) {
    return "";
  }

  const selectedShellName = runConfirmState.selectedShellName;
  const options = profiles.map(function (profile) {
    return { value: profile.name, label: profile.name };
  });

  return renderCustomSelect(
    "shell-selector-wrap",
    "shell-selector-btn",
    "shell-selector-menu",
    options,
    selectedShellName,
    "cs-btn-sm", // btnExtraClass
    true // menuUp
  );
}

function renderRunConfirmModal() {
  // Hide run confirm modal while variable input modal is open (returning to run confirm)
  if (!runConfirmState.commandId || (variableInputState.commandId && variableInputState.returnToRunConfirm)) {
    return "";
  }

  const command = (state.data.commands || []).find(function (item) {
    return item.id === runConfirmState.commandId;
  });

  const hasVariables = command
    ? collectVariables([command.command]).some(function (name) {
        return !getEnabledAutoVariableNames().includes(name);
      })
    : false;

  const previewHtml = command ? highlightResolvedHtml(command) : escapeHtml(runConfirmState.resolvedCommand);

  return `
    <div class="modal-overlay" id="run-confirm-overlay" data-dismiss-on-outside-click="false">
      <div class="modal-box">
        <h3>Do you want to run this command?</h3>
        <pre class="modal-command-preview">${previewHtml}</pre>
        <span class="muted run-cmd-warning">${icons.exclamationTriangle} This command will be executed immediately</span>
        <div class="row justify-content-flex-end f-nowrap">
        ${hasVariables ? `<button class="btn small secondary min-w65" id="btn-confirm-run-variables">Edit Variables</button>` : ""}
          ${renderShellSelector()}
          <button class="btn small success min-w65" id="btn-confirm-run-yes">Run</button>
          <button class="btn small secondary action min-w65" id="btn-confirm-run-no">Cancel</button>
        </div>
      </div>
    </div>
  `;
}

function renderVariableInputModal() {
  if (!variableInputState.commandId) {
    return "";
  }

  const vars = variableInputState.missingVariables;
  // Get the command to check variableMeta
  const cmdForMeta = (state.data.commands || []).find(function (c) {
    return c.id === variableInputState.commandId;
  });

  return `
    <div class="modal-overlay" id="variable-input-overlay" data-dismiss-on-outside-click="false">
      <div class="modal-box">
        <h3>Enter Variable Values</h3>
        <div class="variables-list">
          <div class="variable-row">
            <span></span>
            <span></span>
            <span class="muted vars-store-location" data-tooltip="Active scope for each variable<br><strong>Local</strong> = use workspace-local value<br><strong>Global</strong> = use global value<br><strong>Off</strong> = session-only value (not saved)">Variables store location</span>
          </div>
          ${vars
            .map(function (name) {
              const rememberValue =
                variableInputState.rememberFlags[name] !== undefined
                  ? variableInputState.rememberFlags[name]
                  : getCommandRemember(variableInputState.commandId)[name] ||
                    (state.workspaceFolder ? "local" : "global");
              // Show the value for the currently selected scope
              const currentValue =
                variableInputState.inputValues[name] !== undefined ? variableInputState.inputValues[name] : "";
              // Check if this variable has Enum metadata
              const enumMeta = cmdForMeta && cmdForMeta.variableMeta && cmdForMeta.variableMeta[name];
              const isEnum =
                enumMeta && enumMeta.type === "enum" && enumMeta.enumValues && enumMeta.enumValues.length > 0;
              // Check if current value is one of the enum values
              const isCustomValue =
                isEnum &&
                !enumMeta.enumValues.some(function (ev) {
                  return ev.value === currentValue;
                });

              if (isEnum) {
                const isEnumEmptyValue = currentValue === RECIPES_EMPTY_VALUE;
                const enumOptions = enumMeta.enumValues
                  .map(function (ev) {
                    var label;
                    if (String(ev.title).toLowerCase() === String(ev.value).toLowerCase()) {
                      label = ev.title;
                    } else {
                      label = ev.title + " (" + ev.value + ")";
                    }
                    return {
                      value: ev.value,
                      label: label,
                      tooltip: ev.description
                        ? escapeHtml(ev.description)
                        : ev.value
                          ? escapeHtml(ev.value)
                          : undefined,
                      tooltipFooter: ev.description && ev.value ? escapeHtml(ev.value) : undefined,
                    };
                  })
                  .concat([{ value: "__custom__", label: "✏️ Custom value..." }]);
                const enumSelectedVal = isCustomValue ? "__custom__" : currentValue;
                return `
              <div class="variable-row variable-row-enum">
                <label class="variable-name">\${${escapeHtml(name)}}</label>
                <div class="enum-input-wrap" data-variable-name="${escapeAttr(name)}">
                  ${renderCustomSelect(
                    "enum-var-wrap-" + escapeAttr(name),
                    "enum-var-btn-" + escapeAttr(name),
                    "enum-var-menu-" + escapeAttr(name),
                    enumOptions,
                    enumSelectedVal,
                    "cs-btn-sm cs-btn-enum-var", // btnExtraClass
                    false, // menuUp
                    "cs-wrap-full" //
                  )}
                  <input
                    class="input variable-modal-input variable-modal-custom-input${isCustomValue ? "" : " hidden"}"
                    data-variable-name="${escapeAttr(name)}"
                    value="${isEnumEmptyValue ? "[EmptyValue]" : escapeAttr(currentValue)}"
                    placeholder="Enter custom value..."
                    ${isEnumEmptyValue ? 'readonly data-is-empty-value="true"' : ""}
                  />
                </div>
                ${renderToggleSwitch3(variableInputState.commandId, name, rememberValue, "variable-modal-remember-toggle")}
              </div>
            `;
              }

              const isEmptyValue = currentValue === RECIPES_EMPTY_VALUE;
              return `
              <div class="variable-row">
                <label class="variable-name">\${${escapeHtml(name)}}</label>
                <input
                  class="input variable-modal-input"
                  data-variable-name="${escapeAttr(name)}"
                  value="${isEmptyValue ? "[EmptyValue]" : escapeAttr(currentValue)}"
                  placeholder="Enter value..."
                  ${isEmptyValue ? 'readonly data-is-empty-value="true"' : ""}
                />
                ${renderToggleSwitch3(variableInputState.commandId, name, rememberValue, "variable-modal-remember-toggle")}
              </div>
            `;
            })
            .join("")}
          <div class="variable-row">
            <span></span>
            <p class="muted variables-empty-hint"><kbd>Alt+0</kbd> to set focused variable as empty value</p>
            <span></span>
          </div>
        </div>
        <div class="row justify-content-flex-end mt-20">
        <span class="muted mr-auto">Enter the values before using them</span>
          <button class="btn small primary min-w65" id="btn-variable-input-confirm">Confirm</button>
          <button class="btn small secondary action min-w65" id="btn-variable-input-cancel">Cancel</button>
        </div>
      </div>
    </div>
  `;
}

function renderDeleteConfirmModal() {
  if (!deleteConfirmState.type) {
    return "";
  }

  var heading = "";
  var detailHtml = "";
  var confirmLabel = "Delete";
  var confirmClass = "btn small danger min-w65";

  if (deleteConfirmState.type === "clearRecent") {
    heading = "Clear Recent History?";
    confirmLabel = "Clear";
    detailHtml = `<p class="modal-description">${escapeHtml(deleteConfirmState.title || "This action cannot be undone.")}</p>`;
  } else if (deleteConfirmState.type === "command") {
    heading = `Do you want to delete this command?`;
    detailHtml = `
      <p class="delete-confirm-command-name">${escapeHtml(deleteConfirmState.title)}</p>
      <pre class="modal-command-preview">${highlightTemplateHtml(deleteConfirmState.template)}</pre>
    `;
  } else {
    heading = `Do you want to delete this ${escapeHtml(deleteConfirmState.type)}?`;
    detailHtml = `<p class="modal-description">${escapeHtml(deleteConfirmState.title || "This action cannot be undone.")}</p>`;
  }

  return `
    <div class="modal-overlay" id="delete-confirm-overlay" data-dismiss-on-outside-click="false">
      <div class="modal-box">
        <h3>${heading}</h3>
        ${detailHtml}
        <div class="row justify-content-flex-end">
          <button class="${confirmClass}" id="btn-confirm-delete-yes">${confirmLabel}</button>
          <button class="btn small secondary action min-w65" id="btn-confirm-delete-no">Cancel</button>
        </div>
      </div>
    </div>
  `;
}
