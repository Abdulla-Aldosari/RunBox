/*-------------------------------------------------
 * RunBox — VS Code Extension
 * Copyright (c) 2026 Abdulla Aldosari
 * Licensed under the MIT License.
 * See LICENSE in the project root for details.
 *-------------------------------------------------*/

"use strict";

const os = require("os");
const path = require("path");

/**
 * Auto variables are written as ${@name}. The "@" marker keeps them in a namespace
 * separate from user variables (${name}), so a user can freely name a variable
 * "date" or "workspaceFolder" without it being resolved automatically. In
 * POSIX shells "${@name}" is a "bad substitution" error, so an unresolved token
 * fails loudly instead of silently expanding to a wrong value.
 * The webview recognizes the same syntax (media/utils.js AUTO_VARIABLE_TOKEN_PATTERN).
 */
const AUTO_VARIABLE_TOKEN_PATTERN = /\$\{@([a-zA-Z0-9_]+)\}/g;

const DATE_FORMATS = ["YYYY-MM-DD", "DD/MM/YYYY", "MM/DD/YYYY", "DD-MM-YYYY"];

/**
 * Every supported time format: 24-hour and 12-hour, with and without seconds,
 * joined by each separator ("" = no separator). The 12-hour formats end with
 * the AM/PM marker joined by the same separator (e.g. "10-35-24-AM").
 */
const TIME_FORMATS = ["-", ":", ".", "_", ""].reduce(function (formats, sep) {
  return formats.concat([`HH${sep}mm${sep}ss`, `HH${sep}mm`, `hh${sep}mm${sep}ss${sep}A`, `hh${sep}mm${sep}A`]);
}, []);

/**
 * List of auto variables.
 * To add a new variable: just add a new object here — no changes needed in any other file.
 * `configOptions`/`defaultFormat` are set only for variables with a selectable format.
 */
const AUTO_VARIABLES = [
  {
    name: "workspaceFolder",
    label: "Workspace Folder",
    description: "Full path to the current workspace folder.",
    resolve: function (context) {
      return context.workspaceFolder || "";
    },
  },
  {
    name: "workspaceName",
    label: "Workspace Name",
    description: "Name of the current workspace folder (basename only).",
    resolve: function (context) {
      return context.workspaceFolder ? path.basename(context.workspaceFolder) : "";
    },
  },
  {
    name: "username",
    label: "OS Username",
    description: "Current operating system username.",
    resolve: function () {
      return os.userInfo().username || "";
    },
  },
  {
    name: "date",
    label: "Current Date",
    description: "Today's date formatted as specified.",
    configOptions: DATE_FORMATS,
    defaultFormat: "YYYY-MM-DD",
    resolve: function (context, config, now) {
      return formatDateTimePattern(config.format, now);
    },
  },
  {
    name: "time",
    label: "Current Time",
    description: "The current time formatted as specified (24-hour or 12-hour).",
    configOptions: TIME_FORMATS,
    defaultFormat: "HH-mm-ss",
    resolve: function (context, config, now) {
      return formatDateTimePattern(config.format, now);
    },
  },
];

/**
 * Formats a date/time in a single pass, so a substituted value is never re-read
 * as another token. Tokens: YYYY, MM (month), DD, HH (00-23), hh (01-12),
 * mm (minutes), ss, A (AM/PM).
 * @param {string} format
 * @param {Date} now
 * @returns {string}
 */
function formatDateTimePattern(format, now) {
  const pad = function (value) {
    return String(value).padStart(2, "0");
  };
  const hours = now.getHours();
  const values = {
    YYYY: String(now.getFullYear()),
    MM: pad(now.getMonth() + 1),
    DD: pad(now.getDate()),
    HH: pad(hours),
    hh: pad(hours % 12 === 0 ? 12 : hours % 12),
    mm: pad(now.getMinutes()),
    ss: pad(now.getSeconds()),
    A: hours < 12 ? "AM" : "PM",
  };
  return format.replace(/YYYY|MM|DD|HH|hh|mm|ss|A/g, function (token) {
    return values[token];
  });
}

/**
 * Returns the effective config of a variable. A saved format is used only when
 * it is one of the variable's supported options (the settings file is user-editable).
 * @param {object} varDef
 * @param {object} userSettings - { varName: { config: { format } } }
 * @returns {{ format?: string }}
 */
function getVariableConfig(varDef, userSettings) {
  if (!varDef.configOptions) {
    return {};
  }
  const setting = userSettings && typeof userSettings === "object" ? userSettings[varDef.name] : null;
  const savedFormat = setting && setting.config ? setting.config.format : null;
  return { format: varDef.configOptions.includes(savedFormat) ? savedFormat : varDef.defaultFormat };
}

/**
 * Resolves every known ${@name} token in the template. Unknown tokens are left as-is.
 *
 * @param {string} template        - The command string containing ${@name} tokens
 * @param {object} context         - The context: { workspaceFolder: string|null }
 * @param {object} userSettings    - User settings: { varName: { config } }
 * @param {Date} [now]             - The moment used by date/time variables (defaults to now)
 * @returns {string}               - The string after variable substitution
 */
function resolveAutoVariables(template, context, userSettings, now) {
  if (typeof template !== "string") {
    throw new TypeError(`resolveAutoVariables: expected string, got ${typeof template}`);
  }

  const moment = now instanceof Date ? now : new Date();

  return template.replace(AUTO_VARIABLE_TOKEN_PATTERN, function (token, name) {
    const varDef = AUTO_VARIABLES.find(function (def) {
      return def.name === name;
    });
    return varDef ? varDef.resolve(context || {}, getVariableConfig(varDef, userSettings), moment) : token;
  });
}

/**
 * Builds a preview payload for each variable (with its current resolved value).
 * Sent from extension.js to the webview as part of the state.
 *
 * @param {object} context         - { workspaceFolder: string|null }
 * @param {object} userSettings    - { varName: { config } }
 * @param {Date} [now]             - The moment used by date/time variables (defaults to now)
 * @returns {Array<{name, token, label, description, configurable, config, currentValue, configOptions}>}
 */
function buildAutoVariablesPayload(context, userSettings, now) {
  const moment = now instanceof Date ? now : new Date();

  return AUTO_VARIABLES.map(function (varDef) {
    const config = getVariableConfig(varDef, userSettings);

    return {
      name: varDef.name,
      token: `\${@${varDef.name}}`,
      label: varDef.label,
      description: varDef.description,
      configurable: Boolean(varDef.configOptions),
      config,
      currentValue: varDef.resolve(context || {}, config, moment),
      configOptions: varDef.configOptions || [],
    };
  });
}

module.exports = {
  resolveAutoVariables,
  buildAutoVariablesPayload,
};
