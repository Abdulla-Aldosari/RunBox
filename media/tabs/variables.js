/*-------------------------------------------------
 * RunBox — VS Code Extension
 * Copyright (c) 2026 Abdulla Aldosari
 * Licensed under the Apache License, Version 2.0.
 * See LICENSE in the project root for details.
 *-------------------------------------------------*/

// media/tabs/variables.js
// "Variables" tab — auto-variables settings.
// Loads after favorites.js.

// ─── Variables Tab ─────────────────────────────────────────────────────────────

function renderVariablesTab() {
  const autoVars = state.autoVariables || [];

  return `
    <section class="card">
      <h2>Auto Variables</h2>
      <p class="muted">These variables are automatically resolved in your commands — no manual input needed.</p>
      <div class="auto-vars-list">
        ${
          autoVars.length === 0
            ? '<p class="muted">No auto variables defined.</p>'
            : autoVars
                .map(function (varDef) {
                  return `
          <div class="auto-var-row ${varDef.enabled ? "" : "auto-var-disabled"}">
            <div class="auto-var-toggle">
              <label class="toggle-label">
                <input
                  type="checkbox"
                  class="auto-var-checkbox"
                  data-var-name="${escapeAttr(varDef.name)}"
                  ${varDef.enabled ? "checked" : ""}
                />
              </label>
            </div>
            <div class="auto-var-info">
              <div class="auto-var-name">
                <code class="auto-var-name-code" data-copy-value="${escapeAttr("${" + varDef.name + "}")}" data-tooltip="${varDef.enabled ? "Copy variable" : "Variable disabled"}">\${${escapeHtml(varDef.name)}}</code>
                <span>${escapeHtml(varDef.label)}</span>
              </div>
              <div class="auto-var-description">${escapeHtml(varDef.description)}</div>
              ${
                varDef.enabled
                  ? `<div class="auto-var-preview">
                <span>Current value: </span>
                <code class="auto-var-value">${escapeHtml(varDef.currentValue || "—")}</code>
              </div>`
                  : ""
              }
              ${
                varDef.configurable && varDef.enabled
                  ? `<div class="auto-var-config">
                ${renderAutoVarConfig(varDef)}
              </div>`
                  : ""
              }
            </div>
          </div>
        `;
                })
                .join("")
        }
      </div>
    </section>
  `;
}

function renderAutoVarConfig(varDef) {
  if (varDef.name === "date" && varDef.configOptions && varDef.configOptions.length > 0) {
    return renderCustomSelect(
      "auto-var-date-format-wrap",
      "auto-var-date-format-btn",
      "auto-var-date-format-menu",
      varDef.configOptions.map(function (f) {
        return { value: f, label: f };
      }),
      varDef.config && varDef.config.format ? varDef.config.format : "YYYY-MM-DD",
      "cs-btn-sm",
      false,
      ""
    );
  }
  return "";
}

function bindVariablesTabEvents() {
  // Checkbox to enable/disable a variable
  document.querySelectorAll(".auto-var-checkbox").forEach(function (checkbox) {
    checkbox.addEventListener("change", function () {
      const varName = checkbox.dataset.varName;
      const newSettings = JSON.parse(JSON.stringify(state.autoVariablesSettings || {}));
      if (!newSettings[varName]) {
        newSettings[varName] = {};
      }
      newSettings[varName].enabled = checkbox.checked;
      state.autoVariablesSettings = newSettings;
      vscode.postMessage({
        type: "saveAutoVariablesSettings",
        payload: newSettings,
      });
    });
  });

  // Copy variable name when clicking on a code element
  document.querySelectorAll(".auto-var-name-code").forEach(function (el) {
    el.addEventListener("click", function () {
      // prevent copy if the variable is disabled
      if (el.closest(".auto-var-row")?.classList.contains("auto-var-disabled")) {
        return;
      }
      const value = el.dataset.copyValue;
      if (value) {
        navigator.clipboard.writeText(value).then(function () {
          el.classList.remove("auto-var-copy-success");
          void el.offsetWidth; // force reflow to restart animation
          el.classList.add("auto-var-copy-success");
          el.addEventListener(
            "animationend",
            function () {
              el.classList.remove("auto-var-copy-success");
            },
            { once: true }
          );
        });
      }
    });
  });

  // Change the date format
  bindCustomSelect(
    "auto-var-date-format-wrap",
    "auto-var-date-format-btn",
    "auto-var-date-format-menu",
    function (selectedFormat) {
      const newSettings = JSON.parse(JSON.stringify(state.autoVariablesSettings || {}));
      if (!newSettings["date"]) {
        newSettings["date"] = { enabled: true };
      }
      if (!newSettings["date"].config) {
        newSettings["date"].config = {};
      }
      newSettings["date"].config.format = selectedFormat;
      state.autoVariablesSettings = newSettings;
      vscode.postMessage({
        type: "saveAutoVariablesSettings",
        payload: newSettings,
      });
    }
  );
}
