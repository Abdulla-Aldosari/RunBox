/*-------------------------------------------------
 * RunBox — VS Code Extension
 * Copyright (c) 2026 Abdulla Aldosari
 * Licensed under the MIT License.
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
      <p class="muted">These variables are automatically resolved in your commands — no manual input needed. They use the <code>\${@name}</code> syntax, so <code>\${name}</code> always stays a regular variable you fill in.</p>
      <div class="auto-vars-list">
        ${
          autoVars.length === 0
            ? '<p class="muted">No auto variables defined.</p>'
            : autoVars
                .map(function (varDef) {
                  return `
          <div class="auto-var-row">
            <div class="auto-var-info">
              <div class="auto-var-name">
                <code class="auto-var-name-code" data-copy-value="${escapeAttr(varDef.token)}" data-tooltip="Copy variable">${escapeHtml(varDef.token)}</code>
                <span>${escapeHtml(varDef.label)}</span>
              </div>
              <div class="auto-var-description">${escapeHtml(varDef.description)}</div>
              <div class="auto-var-preview">
                <span>Current value: </span>
                <code class="auto-var-value">${escapeHtml(varDef.currentValue || "—")}</code>
              </div>
              ${
                varDef.configurable
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

/**
 * Renders the format dropdown of a configurable auto variable.
 * Dropdown IDs: auto-var-{name}-format-wrap / -btn / -menu.
 * @param {object} varDef - an entry of state.autoVariables
 * @returns {string}
 */
function renderAutoVarConfig(varDef) {
  if (!varDef.configOptions || varDef.configOptions.length === 0) {
    return "";
  }
  const prefix = `auto-var-${varDef.name}-format`;
  return renderCustomSelect(
    `${prefix}-wrap`,
    `${prefix}-btn`,
    `${prefix}-menu`,
    varDef.configOptions.map(function (f) {
      return { value: f, label: f };
    }),
    varDef.config && varDef.config.format ? varDef.config.format : varDef.configOptions[0],
    "cs-btn-sm",
    false,
    ""
  );
}

function bindVariablesTabEvents() {
  // Copy variable token when clicking on a code element
  document.querySelectorAll(".auto-var-name-code").forEach(function (el) {
    el.addEventListener("click", function () {
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

  // Change the format of each configurable variable
  (state.autoVariables || []).forEach(function (varDef) {
    if (!varDef.configurable) {
      return;
    }
    const prefix = `auto-var-${varDef.name}-format`;
    bindCustomSelect(`${prefix}-wrap`, `${prefix}-btn`, `${prefix}-menu`, function (selectedFormat) {
      const newSettings = JSON.parse(JSON.stringify(state.autoVariablesSettings || {}));
      if (!newSettings[varDef.name] || typeof newSettings[varDef.name] !== "object") {
        newSettings[varDef.name] = {};
      }
      newSettings[varDef.name].config = { format: selectedFormat };
      state.autoVariablesSettings = newSettings;
      vscode.postMessage({
        type: "saveAutoVariablesSettings",
        payload: newSettings,
      });
    });
  });
}
