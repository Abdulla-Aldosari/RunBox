/*-------------------------------------------------
 * RunBox — VS Code Extension
 * Copyright (c) 2026 Abdulla Aldosari
 * Licensed under the Apache License, Version 2.0.
 * See LICENSE in the project root for details.
 *-------------------------------------------------*/

"use strict";

const os = require("os");
const path = require("path");

/**
 * List of auto variables.
 * To add a new variable: just add a new object here — no changes needed in any other file.
 */
const AUTO_VARIABLES = [
  {
    name: "workspaceFolder",
    label: "Workspace Folder",
    description: "Full path to the current workspace folder.",
    previewExample: "/home/user/my-project",
    defaultEnabled: true,
    configurable: false,
    config: null,
    resolve: function (context) {
      return context.workspaceFolder || "";
    },
  },
  {
    name: "workspaceName",
    label: "Workspace Name",
    description: "Name of the current workspace folder (basename only).",
    previewExample: "my-project",
    defaultEnabled: true,
    configurable: false,
    config: null,
    resolve: function (context) {
      return context.workspaceFolder ? path.basename(context.workspaceFolder) : "";
    },
  },
  {
    name: "username",
    label: "OS Username",
    description: "Current operating system username.",
    previewExample: "john",
    defaultEnabled: true,
    configurable: false,
    config: null,
    resolve: function () {
      return os.userInfo().username || "";
    },
  },
  {
    name: "date",
    label: "Current Date",
    description: "Today's date formatted as specified.",
    previewExample: "2026-05-26",
    defaultEnabled: false,
    configurable: true,
    config: {
      format: "YYYY-MM-DD",
    },
    resolve: function (context, userConfig) {
      return formatDate(userConfig && userConfig.format ? userConfig.format : "YYYY-MM-DD");
    },
  },
];

/**
 * Formats the current date according to the specified format.
 * Supported formats: YYYY-MM-DD | DD/MM/YYYY | MM/DD/YYYY | DD-MM-YYYY
 */
function formatDate(format) {
  const now = new Date();
  const yyyy = now.getFullYear().toString();
  const mm = String(now.getMonth() + 1).padStart(2, "0");
  const dd = String(now.getDate()).padStart(2, "0");

  return format.replace("YYYY", yyyy).replace("MM", mm).replace("DD", dd);
}

/**
 * Resolves all enabled auto variables in the template string.
 *
 * @param {string} template        - The command string containing ${varName} placeholders
 * @param {object} context         - The context: { workspaceFolder: string|null }
 * @param {object} userSettings    - User settings: { varName: { enabled, config } }
 * @returns {string}               - The string after variable substitution
 */
function resolveAutoVariables(template, context, userSettings) {
  if (typeof template !== "string") {
    throw new TypeError(`resolveAutoVariables: expected string, got ${typeof template}`);
  }

  let resolved = template;

  AUTO_VARIABLES.forEach(function (varDef) {
    const setting = userSettings && userSettings[varDef.name];
    const isEnabled = setting !== undefined ? Boolean(setting.enabled) : varDef.defaultEnabled;

    if (!isEnabled) {
      return;
    }

    const userConfig = setting && setting.config ? setting.config : varDef.config || {};
    const value = varDef.resolve(context || {}, userConfig);

    resolved = resolved.replace(new RegExp("\\$\\{" + varDef.name + "\\}", "g"), value);
  });

  return resolved;
}
/**
 * Builds a preview payload for each variable (with its current resolved value).
 * Sent from extension.js to the webview as part of the state.
 *
 * @param {object} context         - { workspaceFolder: string|null }
 * @param {object} userSettings    - { varName: { enabled, config } }
 * @returns {Array<{name, label, description, enabled, configurable, config, currentValue, configOptions}>}
 */
function buildAutoVariablesPayload(context, userSettings) {
  return AUTO_VARIABLES.map(function (varDef) {
    const setting = userSettings && userSettings[varDef.name];
    const isEnabled = setting !== undefined ? Boolean(setting.enabled) : varDef.defaultEnabled;
    const userConfig = setting && setting.config ? setting.config : varDef.config || {};
    const currentValue = isEnabled ? varDef.resolve(context || {}, userConfig) : varDef.previewExample;

    return {
      name: varDef.name,
      label: varDef.label,
      description: varDef.description,
      enabled: isEnabled,
      configurable: varDef.configurable,
      config: userConfig,
      currentValue: currentValue,
      configOptions: varDef.name === "date" ? ["YYYY-MM-DD", "DD/MM/YYYY", "MM/DD/YYYY", "DD-MM-YYYY"] : [],
    };
  });
}

module.exports = {
  resolveAutoVariables,
  buildAutoVariablesPayload,
};
