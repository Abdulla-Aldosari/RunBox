/*-------------------------------------------------
 * RunBox — VS Code Extension
 * Copyright (c) 2026 Abdulla Aldosari
 * Licensed under the Apache License, Version 2.0.
 * See LICENSE in the project root for details.
 *-------------------------------------------------*/

// media/utils.js
// Pure utility functions and the custom select component system.
// All functions are either stateless or read minimally from uiState/state.
// Loads after icons.js.

// ─── HTML Helpers ─────────────────────────────────────────────────────────────

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function escapeAttr(value) {
  return escapeHtml(value).replace(/`/g, "&#96;");
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// ─── Keyboard Helpers ─────────────────────────────────────────────────────────

// Returns true when the Alt modifier is active, covering both the left Alt key
// (always reported via e.altKey) and the right Alt key. On many non-US keyboard
// layouts the right Alt key acts as AltGr: browsers may not set e.altKey for it,
// instead exposing it only through the AltGraph modifier state. Checking both
// keeps Alt-based shortcuts working regardless of the active keyboard layout or
// which physical Alt key (left/right) the user presses.
function isAltPressed(e) {
  return Boolean(e.altKey || (typeof e.getModifierState === "function" && e.getModifierState("AltGraph")));
}

// ─── Time Helpers ─────────────────────────────────────────────────────────────

function timeAgo(isoString) {
  if (!isoString) {
    return "–";
  }
  const diff = Date.now() - new Date(isoString).getTime();
  const seconds = Math.floor(diff / 1000);
  if (seconds < 60) {
    return "just now";
  }
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) {
    return `${minutes} minute${minutes !== 1 ? "s" : ""} ago`;
  }
  const hours = Math.floor(minutes / 60);
  if (hours < 24) {
    return `${hours} hour${hours !== 1 ? "s" : ""} ago`;
  }
  const days = Math.floor(hours / 24);
  if (days < 30) {
    return `${days} day${days !== 1 ? "s" : ""} ago`;
  }
  const months = Math.floor(days / 30);
  if (months < 12) {
    return `${months} month${months !== 1 ? "s" : ""} ago`;
  }
  return `${Math.floor(months / 12)} year${Math.floor(months / 12) !== 1 ? "s" : ""} ago`;
}

function formatDateTime(isoString) {
  if (!isoString) {
    return "";
  }
  try {
    return new Date(isoString).toLocaleString();
  } catch {
    return isoString;
  }
}

// ─── ID / Entity Helpers ──────────────────────────────────────────────────────

function generateEntityId(prefix) {
  const random = Math.random().toString(36).slice(2, 8);
  return `${prefix}-${Date.now().toString(36)}-${random}`;
}

// When multiple configured terminal profiles share the same shellType (e.g. a
// "PowerShell" profile and a "Windows PowerShell" profile that both resolve to
// the same powershell.exe, which is exactly what VS Code's own "Select Default
// Profile" flow produces when PowerShell 7+ is not installed), picking "the
// first one found" is arbitrary and can pre-select a profile whose display
// name does not match what the user actually chose as Target Shell. This map
// gives the profile named after VS Code's own naming convention for each
// PowerShell variant priority over any other same-shellType profile, without
// changing behavior for any other shell type or for setups with no ambiguity.
const PREFERRED_PROFILE_NAME_BY_SHELL_TYPE = {
  powershell: "Windows PowerShell",
  pwsh: "PowerShell",
};

/**
 * Finds the configured terminal profile whose detected shellType matches the
 * given targetShell (e.g. "bash", "powershell"). Returns null if targetShell
 * is empty or no matching profile is configured.
 *
 * When more than one configured profile shares the same shellType, the one
 * named after VS Code's own naming convention for that shell (see
 * PREFERRED_PROFILE_NAME_BY_SHELL_TYPE) is preferred; otherwise the first
 * matching profile is returned, preserving prior behavior.
 * @param {string} targetShell
 * @returns {{name: string, shellPath: string, shellType: string}|null}
 */
function findMatchingShellProfile(targetShell) {
  if (!targetShell) {
    return null;
  }
  const profiles = (state.terminalProfiles && state.terminalProfiles.profiles) || [];
  const candidates = profiles.filter(function (p) {
    return p.shellType === targetShell;
  });

  if (candidates.length === 0) {
    return null;
  }

  const preferredName = PREFERRED_PROFILE_NAME_BY_SHELL_TYPE[targetShell];
  if (preferredName) {
    const preferred = candidates.find(function (p) {
      return p.name === preferredName;
    });
    if (preferred) {
      return preferred;
    }
  }

  return candidates[0];
}

/**
 * Describes how a Target Shell selection resolves against the terminal
 * profiles actually configured on this machine, for the transparency
 * indicator shown below the "Target Shell" field in the Command form.
 * A profile's display name never guarantees which real executable it points
 * to (see findMatchingShellProfile), so this surfaces the outcome directly
 * instead of leaving the user to guess.
 * @param {string} targetShell
 * @returns {{status: "matched"|"unmatched", profile: {name: string, shellPath: string, shellType: string}|null, duplicates: Array<{name: string, shellPath: string, shellType: string}>}|null}
 *   null when targetShell is empty ("Any Shell" — nothing to describe).
 */
function describeShellSelection(targetShell) {
  if (!targetShell) {
    return null;
  }

  const profile = findMatchingShellProfile(targetShell);
  const profiles = (state.terminalProfiles && state.terminalProfiles.profiles) || [];
  const allMatches = profiles.filter(function (p) {
    return p.shellType === targetShell;
  });
  const duplicates = profile
    ? allMatches.filter(function (p) {
        return p.name !== profile.name;
      })
    : [];

  return {
    status: profile ? "matched" : "unmatched",
    profile,
    duplicates,
  };
}

// ─── Variable Collection & Resolution ─────────────────────────────────────────

/**
 * Collects all ${varName} placeholder names from an array of command templates.
 * @param {string[]} commandTemplates
 * @returns {string[]}
 */
function collectVariables(commandTemplates) {
  const names = new Set();
  const regex = /\$\{([a-zA-Z0-9_]+)\}/g;

  commandTemplates.forEach(function (template) {
    if (typeof template !== "string") {
      return;
    }

    let match = regex.exec(template);

    while (match) {
      names.add(match[1]);
      match = regex.exec(template);
    }

    regex.lastIndex = 0;
  });

  return Array.from(names.values());
}

/**
 * Returns a list of currently enabled auto variable names.
 * Used to exclude these variables from input prompts.
 * @returns {string[]}
 */
function getEnabledAutoVariableNames() {
  return (state.autoVariables || [])
    .filter(function (v) {
      return v.enabled;
    })
    .map(function (v) {
      return v.name;
    });
}

function getMissingVariables(command) {
  const names = collectVariables([command.command]);
  const draft = getCommandDraft(command.id);
  const autoVarNames = getEnabledAutoVariableNames();

  return names.filter(function (name) {
    if (autoVarNames.includes(name)) {
      return false;
    }
    // RUNBOX_EMPTY_VALUE is an explicit empty value — it is NOT missing
    if (draft[name] === RUNBOX_EMPTY_VALUE) {
      return false;
    }
    return !draft[name];
  });
}

/**
 * Resolves a command template by substituting all ${varName} tokens
 * with values from the command draft and auto variables.
 * @param {object} command - the command object with .command template
 * @returns {string}
 */
function resolveCommandTemplate(command) {
  const names = collectVariables([command.command]);
  let resolved = command.command;
  const draft = getCommandDraft(command.id);
  const autoVarNames = getEnabledAutoVariableNames();

  names.forEach(function (name) {
    // Auto variables: use currentValue from state.autoVariables for preview
    if (autoVarNames.includes(name)) {
      const autoVarDef = (state.autoVariables || []).find(function (v) {
        return v.name === name;
      });
      const value = autoVarDef ? autoVarDef.currentValue || "" : "";
      resolved = resolved.replace(new RegExp("\\$\\{" + escapeRegExp(name) + "\\}", "g"), value);
      return;
    }
    // Regular variables: from user draft
    // RUNBOX_EMPTY_VALUE means the user explicitly wants an empty string
    const rawVal = draft[name];
    const value = rawVal === RUNBOX_EMPTY_VALUE ? "" : rawVal || "";
    if (value === "") {
      // Remove " ${name} " (space on both sides) → single space to avoid extra gaps.
      // Then remove any remaining bare placeholder (no surrounding spaces).
      resolved = resolved
        .replace(new RegExp(" \\$\\{" + escapeRegExp(name) + "\\} ", "g"), " ")
        .replace(new RegExp("\\$\\{" + escapeRegExp(name) + "\\}", "g"), "");
    } else {
      resolved = resolved.replace(new RegExp("\\$\\{" + escapeRegExp(name) + "\\}", "g"), value);
    }
  });

  return resolved;
}

function resolveGroupTitle(groupId, groups) {
  if (!groupId) {
    return "-";
  }

  const group = groups.find(function (item) {
    return item.id === groupId;
  });

  return group ? group.title : groupId;
}

// ─── Command Draft / Remember ─────────────────────────────────────────────────

/**
 * Returns (and lazily initializes) the workspace-local scope draft for a command.
 * This is the source-of-truth for the "Local" scope — independent from global scope.
 * @param {string} commandId
 * @returns {object} mutable draft object { [varName]: value }
 */
function getCommandLocalDraft(commandId) {
  if (!uiState.commandLocalDrafts[commandId]) {
    const localVars =
      (state.commandVariables && state.commandVariables.commands && state.commandVariables.commands[commandId]) || {};
    uiState.commandLocalDrafts[commandId] = Object.assign({}, localVars);
  }
  return uiState.commandLocalDrafts[commandId];
}

/**
 * Returns (and lazily initializes) the global scope draft for a command.
 * This is the source-of-truth for the "Global" scope — independent from local scope.
 * @param {string} commandId
 * @returns {object} mutable draft object { [varName]: value }
 */
function getCommandGlobalDraft(commandId) {
  if (!uiState.commandGlobalDrafts[commandId]) {
    const globalVars =
      (state.globalCommandVariables &&
        state.globalCommandVariables.commands &&
        state.globalCommandVariables.commands[commandId]) ||
      {};
    uiState.commandGlobalDrafts[commandId] = Object.assign({}, globalVars);
  }
  return uiState.commandGlobalDrafts[commandId];
}

/**
 * Returns (and lazily initializes) the session-only draft for a command.
 * Session values are NEVER written to disk. They survive only within the current webview session.
 * Used when the scope toggle is set to "Off".
 * @param {string} commandId
 * @returns {object} mutable draft object { [varName]: value }
 */
function getCommandSessionDraft(commandId) {
  if (!uiState.commandSessionDrafts[commandId]) {
    uiState.commandSessionDrafts[commandId] = {};
  }
  return uiState.commandSessionDrafts[commandId];
}

/**
 * Returns a computed "resolved" draft object for a command.
 * Each variable's value is taken from the scope indicated by commandRemember[commandId][varName]:
 *   "local"  → exact local value (no fallback — empty if local has no value)
 *   "global" → exact global value (no fallback — empty if global has no value)
 *   "off"    → session value (or "" if none)
 * This is read-only (computed) — mutating the returned object has no effect on stored drafts.
 * To update values, use getCommandLocalDraft / getCommandGlobalDraft / getCommandSessionDraft.
 * @param {string} commandId
 * @returns {object} resolved values { [varName]: value }
 */
function getCommandDraft(commandId) {
  var localDraft = getCommandLocalDraft(commandId);
  var globalDraft = getCommandGlobalDraft(commandId);
  var sessionDraft = getCommandSessionDraft(commandId);
  var remember = getCommandRemember(commandId);

  var allKeys = {};
  Object.keys(localDraft).forEach(function (k) {
    allKeys[k] = true;
  });
  Object.keys(globalDraft).forEach(function (k) {
    allKeys[k] = true;
  });
  Object.keys(sessionDraft).forEach(function (k) {
    allKeys[k] = true;
  });

  var resolved = {};
  Object.keys(allKeys).forEach(function (key) {
    var pref = remember[key] || "off";
    if (pref === "local") {
      var lv = localDraft[key];
      resolved[key] = lv !== undefined && lv !== "" ? lv : "";
    } else if (pref === "global") {
      var gv = globalDraft[key];
      resolved[key] = gv !== undefined && gv !== "" ? gv : "";
    } else {
      // off
      resolved[key] = sessionDraft[key] || "";
    }
  });

  return resolved;
}

/**
 * Returns (and lazily initializes) the scope preference map for a command.
 * Keys are variable names; values are "local" | "global" | "off".
 * Initialization logic: prefer "local" if local has a value, otherwise "global"
 * if global has a value, otherwise "off" (no scope is active by default).
 * @param {string} commandId
 * @returns {object} mutable remember map { [varName]: "local"|"global"|"off" }
 */
function getCommandRemember(commandId) {
  if (!uiState.commandRemember[commandId]) {
    var remembered = {};
    var globalVars =
      (state.globalCommandVariables &&
        state.globalCommandVariables.commands &&
        state.globalCommandVariables.commands[commandId]) ||
      {};
    var localVars =
      (state.commandVariables && state.commandVariables.commands && state.commandVariables.commands[commandId]) || {};

    var allKeys = {};
    Object.keys(globalVars).forEach(function (k) {
      allKeys[k] = true;
    });
    Object.keys(localVars).forEach(function (k) {
      allKeys[k] = true;
    });

    Object.keys(allKeys).forEach(function (key) {
      if (localVars[key]) {
        remembered[key] = "local";
      } else if (globalVars[key]) {
        remembered[key] = "global";
      } else {
        // Default: no scope is active until the user explicitly opts in
        remembered[key] = "off";
      }
    });

    uiState.commandRemember[commandId] = remembered;
  }

  return uiState.commandRemember[commandId];
}

/**
 * Builds the complete variables payload for persistence.
 * LOCAL file  = all non-empty values in commandLocalDrafts  (independent of scope preference).
 * GLOBAL file = all non-empty values in commandGlobalDrafts (independent of scope preference).
 * Session drafts are NEVER included — they are in-memory only.
 * Saving one scope never affects the other scope.
 * @returns {{ local: object, global: object }}
 */
function buildCommandVariablesPayload() {
  var local = { commands: {} };
  var global = { commands: {} };

  var allCommandIds = {};
  Object.keys(uiState.commandLocalDrafts).forEach(function (id) {
    allCommandIds[id] = true;
  });
  Object.keys(uiState.commandGlobalDrafts).forEach(function (id) {
    allCommandIds[id] = true;
  });

  Object.keys(allCommandIds).forEach(function (commandId) {
    var localDraft = uiState.commandLocalDrafts[commandId] || {};
    var globalDraft = uiState.commandGlobalDrafts[commandId] || {};
    var localVars = {};
    var globalVars = {};

    Object.keys(localDraft).forEach(function (varName) {
      if (varName === "workspaceFolder") {
        return;
      }
      var val = localDraft[varName];
      if (val !== undefined && val !== null && val !== "") {
        localVars[varName] = val;
      }
    });

    Object.keys(globalDraft).forEach(function (varName) {
      if (varName === "workspaceFolder") {
        return;
      }
      var val = globalDraft[varName];
      if (val !== undefined && val !== null && val !== "") {
        globalVars[varName] = val;
      }
    });

    if (Object.keys(localVars).length > 0) {
      local.commands[commandId] = localVars;
    }
    if (Object.keys(globalVars).length > 0) {
      global.commands[commandId] = globalVars;
    }
  });

  return { local, global };
}

/**
 * Updates the scope indicator dots on toggle buttons for a specific variable.
 * The dot is always present in the DOM (rendered by renderToggleSwitch3).
 * This function only toggles the 'has-value' CSS class:
 *   - has-value  → bright color (scope has a stored value)
 *   - no class   → dim color   (scope has no stored value)
 * @param {Element} container - The .toggle-switch-3 container element
 * @param {string} variableName
 * @param {{ local: object, global: object }} scopeSource - Value maps to read from.
 *   Pass the command form buffer while a form is open, or the persisted scope drafts otherwise.
 */
function updateScopeIndicatorDots(container, variableName, scopeSource) {
  if (!container) {
    return;
  }
  var localMap = (scopeSource && scopeSource.local) || {};
  var globalMap = (scopeSource && scopeSource.global) || {};

  container.querySelectorAll(".toggle-option-3").forEach(function (scopeBtn) {
    var scopeVal = scopeBtn.dataset.value;
    var dot = scopeBtn.querySelector(".scope-value-dot");
    var hasScopeValue = false;

    if (scopeVal === "local") {
      var lv = localMap[variableName];
      hasScopeValue = lv !== undefined && lv !== "";
    } else if (scopeVal === "global") {
      var gv = globalMap[variableName];
      hasScopeValue = gv !== undefined && gv !== "";
    }
    // "off" scope never has a value indicator (session values are ephemeral)

    if (dot) {
      dot.classList.toggle("has-value", hasScopeValue);
    }
  });
}

// ─── Category / Group / Command Selection Helpers ─────────────────────────────

/**
 * Persists the selected category ID to localStorage and updates uiState.
 * @param {string} categoryId
 */
function setSelectedCategory(categoryId) {
  uiState.selectedCategoryId = categoryId;
  try {
    localStorage.setItem("selectedCategoryId", categoryId);
  } catch {}
}

/**
 * Returns true if the given category ID refers to the "Current Workspace" pseudo-category.
 * @param {string} categoryId
 * @returns {boolean}
 */
function isCurrentWorkspaceCategory(categoryId) {
  return categoryId === CURRENT_WORKSPACE_CATEGORY_ID;
}

/**
 * Finds a command by ID across both command sources: the regular categorized
 * commands (state.data.commands) and the "Current Workspace" pseudo-category
 * commands (state.workspaceCommands.commands). Action buttons (run/use/copy/
 * edit/favorite/explain) are bound generically regardless of which tab/category
 * is active, so callers must always be able to resolve either kind of command.
 * @param {string} commandId
 * @returns {object|null}
 */
function findCommandById(commandId) {
  return (
    (state.data.commands || []).find(function (c) {
      return c.id === commandId;
    }) ||
    (state.workspaceCommands.commands || []).find(function (c) {
      return c.id === commandId;
    }) ||
    null
  );
}

/**
 * Produces a stable, order-independent string fingerprint of a command object's
 * content. Mirrors lib/normalize.js computeCommandFingerprint() exactly — both
 * sides must compute the identical fingerprint for the same logical content so
 * the extension can detect whether another VS Code window changed this exact
 * command between this form opening and this save.
 * @param {object} command
 * @returns {string}
 */
function computeCommandFingerprint(command) {
  if (!command || typeof command !== "object") {
    return "";
  }

  const sortedKeys = Object.keys(command).sort();
  const stable = {};
  sortedKeys.forEach(function (key) {
    stable[key] = command[key];
  });

  return JSON.stringify(stable);
}

/**
 * Returns true if the given command ID belongs to the "Current Workspace" pseudo-category
 * (i.e. it lives in state.workspaceCommands.commands rather than state.data.commands).
 * @param {string} commandId
 * @returns {boolean}
 */
function isWorkspaceCommand(commandId) {
  return (state.workspaceCommands.commands || []).some(function (c) {
    return c.id === commandId;
  });
}

/**
 * Returns the currently selected category object, or null if none matches.
 * When the "Current Workspace" pseudo-category is selected, returns a synthetic
 * category object backed by state.workspaceCommands.groups (only when a workspace
 * folder is open — otherwise null, since the option cannot be selected at all then).
 * @returns {object|null}
 */
function getSelectedCategory() {
  if (isCurrentWorkspaceCategory(uiState.selectedCategoryId)) {
    return state.workspaceFolder
      ? {
          id: CURRENT_WORKSPACE_CATEGORY_ID,
          title: "Current Workspace",
          groups: state.workspaceCommands.groups || [],
          isCurrentWorkspace: true,
        }
      : null;
  }

  return (
    (state.data.categories || []).find(function (category) {
      return category.id === uiState.selectedCategoryId;
    }) || null
  );
}

/**
 * Returns the groups array of the currently selected category.
 * @returns {Array}
 */
function getSelectedCategoryGroups() {
  const category = getSelectedCategory();
  return category ? category.groups || [] : [];
}

/**
 * Returns commands visible under the current category + group filter.
 * @returns {Array}
 */
function getVisibleCommands() {
  const source = isCurrentWorkspaceCategory(uiState.selectedCategoryId)
    ? state.workspaceCommands.commands || []
    : (state.data.commands || []).filter(function (command) {
        return command.categoryId === uiState.selectedCategoryId;
      });

  return source.filter(function (command) {
    if (uiState.selectedGroupId === "all") {
      return true;
    }

    return command.groupId === uiState.selectedGroupId;
  });
}

/**
 * Returns the command object currently being edited, or null.
 * Looks in both state.data.commands and state.workspaceCommands.commands,
 * since a command being edited may belong to the "Current Workspace" pseudo-category.
 * @returns {object|null}
 */
function getEditingCommand() {
  if (!uiState.editingCommandId) {
    return null;
  }

  return (
    (state.data.commands || []).concat(state.workspaceCommands.commands || []).find(function (command) {
      return command.id === uiState.editingCommandId;
    }) || null
  );
}

// ─── Template Syntax Highlighting ─────────────────────────────────────────────

/**
 * Returns HTML string with ${varName} tokens wrapped in colored spans.
 * .var-auto for reserved/auto-resolved variables, .var-user for user-defined.
 * @param {string} text - raw template text
 * @returns {string} HTML string safe for innerHTML
 */
function highlightTemplateHtml(text) {
  var autoVarNames = getEnabledAutoVariableNames();
  return escapeHtml(text).replace(/\$\{([a-zA-Z0-9_]+)\}/g, function (match, name) {
    var cls = autoVarNames.includes(name) ? "var-auto" : "var-user";
    return '<span class="' + cls + '">' + match + "</span>";
  });
}

/**
 * Returns HTML string of a resolved command where each substituted variable value
 * is wrapped in a colored span reflecting its origin:
 * .var-auto (green) for auto-resolved variables, .var-user (blue) for user-defined.
 * @param {object} command - the command object with .command template
 * @returns {string} HTML string safe for innerHTML
 */
function highlightResolvedHtml(command) {
  var names = collectVariables([command.command]);
  var draft = getCommandDraft(command.id);
  var autoVarNames = getEnabledAutoVariableNames();
  var result = escapeHtml(command.command);

  names.forEach(function (name) {
    var value;
    var cls = autoVarNames.includes(name) ? "var-auto" : "var-user";

    if (autoVarNames.includes(name)) {
      // Auto variables: read resolved value from state.autoVariables (sent by the extension)
      var autoVarDef = (state.autoVariables || []).find(function (v) {
        return v.name === name;
      });
      value = autoVarDef ? autoVarDef.currentValue || "" : "";
    } else {
      // Regular variables: read from the user's command draft
      var rawVal = draft[name];
      value = rawVal === RUNBOX_EMPTY_VALUE ? "" : rawVal || "";
    }

    if (value === "") {
      // Remove " ${name} " (space on both sides) → single space to avoid extra gaps.
      // Then remove any remaining bare placeholder (no surrounding spaces).
      result = result
        .replace(new RegExp(" \\$\\{" + escapeRegExp(name) + "\\} ", "g"), " ")
        .replace(new RegExp("\\$\\{" + escapeRegExp(name) + "\\}", "g"), "");
    } else {
      result = result.replace(
        new RegExp("\\$\\{" + escapeRegExp(name) + "\\}", "g"),
        '<span class="' + cls + '">' + escapeHtml(value) + "</span>"
      );
    }
  });

  return result;
}

/**
 * Auto-resizes a textarea to fit its content.
 * Expands up to MAX_LINES lines, then shows vertical scrollbar.
 * @param {HTMLTextAreaElement} el
 */
function autoResizeTextarea(el) {
  if (!el) {
    return;
  }
  var MAX_LINES = 5;
  // Reset height to auto so we can measure the true content height
  el.classList.remove("ta-overflow");
  el.style.setProperty("--tr-textarea-h", "auto");
  void el.offsetHeight; // Force synchronous reflow before reading scrollHeight
  var computed = getComputedStyle(el);
  var lineHeight = parseFloat(computed.lineHeight);
  if (!lineHeight || isNaN(lineHeight)) {
    lineHeight = parseFloat(computed.fontSize) * 1.5;
  }
  var paddingTop = parseFloat(computed.paddingTop) || 0;
  var paddingBottom = parseFloat(computed.paddingBottom) || 0;
  var maxHeight = lineHeight * MAX_LINES + paddingTop + paddingBottom;
  var newHeight = Math.min(el.scrollHeight, maxHeight);
  el.style.setProperty("--tr-textarea-h", newHeight + "px");
  if (el.scrollHeight > maxHeight) {
    el.classList.add("ta-overflow");
  }
  // Sync highlight div height to match the textarea
  var highlightEl = el.previousElementSibling;
  if (highlightEl && highlightEl.classList.contains("template-highlight")) {
    highlightEl.style.setProperty("--tr-highlight-h", newHeight + "px");
  }
}

/**
 * Updates the syntax highlight overlay div for a template textarea.
 * Wraps ${varName} tokens in colored spans: .var-auto (reserved) or .var-user (user-defined).
 * @param {HTMLTextAreaElement} textarea
 */
function updateTemplateHighlight(textarea) {
  var highlightDiv = textarea.previousElementSibling;
  if (!highlightDiv || !highlightDiv.classList.contains("template-highlight")) {
    return;
  }
  var autoVarNames = getEnabledAutoVariableNames();
  var allVarNames = collectVariables([textarea.value]);
  var hasAuto = allVarNames.some(function (n) {
    return autoVarNames.includes(n);
  });
  var hasUser = allVarNames.some(function (n) {
    return !autoVarNames.includes(n);
  });
  var html = escapeHtml(textarea.value).replace(/\$\{([a-zA-Z0-9_]+)\}/g, function (match, name) {
    var cls = autoVarNames.includes(name) ? "var-auto" : "var-user";
    return '<span class="' + cls + '">' + match + "</span>";
  });
  // Trailing \n prevents the last line from collapsing in height
  highlightDiv.innerHTML = html + "\n";
  // Keep scroll in sync
  highlightDiv.scrollTop = textarea.scrollTop;
  // Update legend visibility
  var legend = textarea.parentElement && textarea.parentElement.nextElementSibling;
  if (legend && legend.classList.contains("template-var-legend")) {
    var autoItem = legend.querySelector(".legend-auto");
    var userItem = legend.querySelector(".legend-user");
    if (autoItem) {
      autoItem.classList.toggle("hidden", !hasAuto);
    }
    if (userItem) {
      userItem.classList.toggle("hidden", !hasUser);
    }
  }
}

// ─── Notice / Alert ───────────────────────────────────────────────────────────

function showNotice(message, icon, type) {
  uiState.noticeMessage = message;
  uiState.noticeIcon = icon !== undefined ? icon : icons.circleExclamation;
  uiState.noticeType = type || "info";

  if (noticeTimer) {
    clearTimeout(noticeTimer);
  }

  noticeTimer = setTimeout(function () {
    uiState.noticeMessage = "";
    uiState.noticeIcon = "";
    uiState.noticeType = "";
    var noticeEl = document.querySelector(".notice");
    if (noticeEl) {
      noticeEl.remove();
    }
    noticeTimer = null;
  }, 3000);
}

function showError(message, icon, type) {
  uiState.noticeMessage = message;
  uiState.noticeIcon = icon !== undefined ? icon : icons.circleX;
  uiState.noticeType = type || "error";

  if (noticeTimer) {
    clearTimeout(noticeTimer);
  }

  noticeTimer = setTimeout(function () {
    uiState.noticeMessage = "";
    uiState.noticeIcon = "";
    uiState.noticeType = "";
    // Remove the notice element directly — no full re-render needed
    var noticeEl = document.querySelector(".notice");
    if (noticeEl) {
      noticeEl.remove();
    }
    noticeTimer = null;
  }, 4000);
}

/**
 * Appends a transient notice element to document.body (outside #app),
 * so it survives full re-renders of the app shell via render().
 * Unlike render(), which rebuilds #app.innerHTML, this function attaches
 * the notice to document.body — it is never wiped by a render cycle.
 * Call this after showNotice() / showError() instead of render() when
 * only a transient notice needs updating.
 */
function paintNotice() {
  // Remove any existing notice
  var existing = document.querySelector(".notice");
  if (existing) {
    existing.remove();
  }
  if (!uiState.noticeMessage) {
    return;
  }
  var el = document.createElement("div");
  el.className = "notice" + (uiState.noticeType ? " notice-" + uiState.noticeType : "");
  el.innerHTML = `
    <div class="notice-icon">${uiState.noticeIcon}</div>
    <div class="notice-message">${uiState.noticeMessage}</div>
    <button class="notice-close d-focus" aria-label="Dismiss">${icons.cancel}</button>
  `;
  el.querySelector(".notice-close").addEventListener("click", function () {
    if (noticeTimer) {
      clearTimeout(noticeTimer);
      noticeTimer = null;
    }
    uiState.noticeMessage = "";
    uiState.noticeIcon = "";
    uiState.noticeType = "";
    el.remove();
  });
  document.body.appendChild(el);
}

// ─── Scroll / DOM Helpers ─────────────────────────────────────────────────────

/**
 * Selects a command row in the active tab: adds the visual highlight class,
 * updates the tab-specific selectedCommandRowId in uiState, and removes the
 * selection from any previously selected row.
 * @param {string} commandId
 */
function selectCommandRow(commandId) {
  if (!commandId) {
    return;
  }
  var tab = uiState.activeTab;
  // Determine which property to use based on active tab
  var stateKey;
  if (tab === "recent") {
    stateKey = "recentSelectedCommandRowId";
  } else if (tab === "favorites") {
    stateKey = "favoritesSelectedCommandRowId";
  } else if (tab === "commands") {
    stateKey = "commandsSelectedCommandRowId";
  } else {
    return; // Not a table tab
  }

  // Remove the class from the previously selected row in this tab
  var prevId = uiState[stateKey];
  if (prevId) {
    var prevRow = document.querySelector('tr[data-command-id="' + prevId + '"]');
    if (prevRow) {
      prevRow.classList.remove("selected-command-row");
    }
  }

  // Add the class to the new row
  var row = document.querySelector('tr[data-command-id="' + commandId + '"]');
  if (!row) {
    return;
  }
  row.classList.add("selected-command-row");
  uiState[stateKey] = commandId;
}

/**
 * Scrolls to a row with the given commandId, selects it via selectCommandRow(),
 * and ensures it's centered in view.
 * Works for both the commands table and the recent commands table.
 * The selection appears only after the smooth scroll animation completes,
 * so the user sees the row selected clearly once it's centered in view.
 * @param {string} commandId
 */
function scrollToAndHighlight(commandId) {
  if (!commandId) {
    return;
  }
  // Target the <tr> directly — all relevant tables set data-command-id on the row
  var row = document.querySelector('tr[data-command-id="' + commandId + '"]');
  if (!row) {
    return;
  }
  row.scrollIntoView({ behavior: "smooth", block: "center" });
  // Wait for smooth scroll (~400ms) before selecting and adding the highlight, so it appears
  // only when the row is centered in view rather than flashing mid-scroll
  setTimeout(function () {
    selectCommandRow(commandId);
    row.classList.add("row-highlight");
  }, 400);

  // Wait for (2400ms) then remove the highlight class, so the row doesn't stay highlighted permanently after selection
  setTimeout(function () {
    row.classList.remove("row-highlight");
  }, 2400);
}

/**
 * Binds click events on cmd-title-link elements (help links in tables).
 */
function bindCmdTitleLinks() {
  document.querySelectorAll(".cmd-title-link").forEach(function (link) {
    link.addEventListener("click", function (e) {
      e.preventDefault();
      const url = link.dataset.url;
      if (url) {
        vscode.postMessage({ type: "openExternalUrl", payload: { url } });
      }
    });
  });
}

// ─── Favorites Helpers ────────────────────────────────────────────────────────

/**
 * Returns true if commandId is in either local or global favorites.
 */
function isInFavorites(commandId) {
  return state.globalFavorites.includes(commandId) || state.localFavorites.includes(commandId);
}

/**
 * Returns the scope of the favorite: 'none' | 'local' | 'global' | 'both'
 */
function getFavoriteScope(commandId) {
  const inLocal = state.localFavorites.includes(commandId);
  const inGlobal = state.globalFavorites.includes(commandId);
  if (inLocal && inGlobal) {
    return "both";
  }
  if (inLocal) {
    return "local";
  }
  if (inGlobal) {
    return "global";
  }
  return "none";
}

/**
 * Saves favorites to the extension.
 */
function persistFavorites(payload) {
  vscode.postMessage({ type: "saveFavorites", payload });
}

// ─── Persist Helpers ──────────────────────────────────────────────────────────

function persistDataThenRender(successMessage) {
  uiState.pendingSaveMessage = successMessage;
  render();
  vscode.postMessage({ type: "saveData", payload: state.data });
}

/**
 * Persists the "Current Workspace" pseudo-category content (groups + commands)
 * to the workspace-local unified data file. Mirrors persistDataThenRender(), but
 * targets state.workspaceCommands instead of state.data.
 *
 * WARNING: this replaces the ENTIRE section with the current in-memory
 * state.workspaceCommands snapshot. Any group/command added by another VS Code
 * window since this window last read the file is silently lost. Prefer
 * persistWorkspaceOperation() for any single add/rename/delete/reorder action.
 * @param {string} [successMessage]
 */
function persistWorkspaceCommandsThenRender(successMessage) {
  if (successMessage) {
    uiState.pendingSaveMessage = successMessage;
  }
  render();
  vscode.postMessage({ type: "saveWorkspaceCommandsData", payload: state.workspaceCommands });
}

/**
 * Persists a single surgical operation against the "Current Workspace" section
 * (add/rename/delete one group or command, or reorder). The extension applies
 * `op` to the freshest on-disk copy of the section (read-modify-write), so any
 * change written moments earlier by another VS Code window is preserved
 * instead of being erased by a stale in-memory snapshot from this window.
 *
 * Unlike persistWorkspaceCommandsThenRender(), this does NOT optimistically
 * render local state.workspaceCommands mutations before the round trip —
 * render() runs first to reflect any state already mutated by the caller for
 * immediate UI feedback, and the authoritative state is refreshed by the
 * subsequent "state" message the extension sends back after applying the
 * operation.
 * @param {object} op - See applyWorkspaceCommandsOperation() in lib/storage.js for shapes
 * @param {string} [successMessage]
 */
function persistWorkspaceOperation(op, successMessage) {
  if (successMessage) {
    uiState.pendingSaveMessage = successMessage;
  }
  render();
  vscode.postMessage({ type: "applyOperation", payload: { scope: "workspace", op } });
}

/**
 * Persists a single surgical operation against the global commands data
 * (categories, groups, commands) shared across ALL VS Code windows on this
 * machine. See applyCommandsDataOperation() in lib/storage.js for op shapes.
 * Mirrors persistWorkspaceOperation() but with scope: "global".
 * @param {object} op
 * @param {string} [successMessage]
 */
function persistGlobalOperation(op, successMessage) {
  if (successMessage) {
    uiState.pendingSaveMessage = successMessage;
  }
  render();
  vscode.postMessage({ type: "applyOperation", payload: { scope: "global", op } });
}

/**
 * Persists a single command move between a regular category (global commands.json)
 * and the "Current Workspace" pseudo-category (workspace-local runbox.data.json),
 * via a single "saveCommandMove" message handled by one extension-side handler.
 *
 * The extension applies this as two surgical operations (delete from the source
 * file, add to the destination file) against the freshest on-disk copy of each —
 * never a full-section snapshot overwrite — so concurrent changes from another
 * window to either file are preserved. See lib/handlers.js handleSaveCommandMove.
 * @param {object} command - The full command object being moved
 * @param {"toWorkspace"|"toGlobal"} direction
 * @param {string} [successMessage]
 */
function persistCommandMoveThenRender(command, direction, successMessage) {
  if (successMessage) {
    uiState.pendingSaveMessage = successMessage;
  }
  render();
  vscode.postMessage({
    type: "saveCommandMove",
    payload: { command, direction },
  });
}

function persistCommandVariables() {
  const payload = buildCommandVariablesPayload();
  vscode.postMessage({ type: "saveCommandVariables", payload });
}

// ─── Actions Cell Renderer ────────────────────────────────────────────────────

/**
 * Renders the `<div class="actions-cell">` HTML for a command row.
 *
 * @param {object} command  - the command object
 * @param {object} options
 * @param {boolean} options.showDelete    - show the Delete button (Commands tab only)
 * @param {boolean} options.showEdit      - show the Edit button (Commands tab only)
 * @param {boolean} options.showGoto      - show the "Go to command" button (Recent + Favorites)
 * @param {'favorite'|'unfavorite'|false} options.favoriteStyle
 *   'favorite'   → btn-add-favorite with detailed keyboard-shortcut tooltip
 *   'unfavorite' → btn-unfavorite (Favorites tab)
 *   false        → no favorite button
 * @returns {string} HTML string
 */
function renderActionsCell(command, options) {
  var showDelete = !!options.showDelete;
  var showEdit = !!options.showEdit;
  var showGoto = !!options.showGoto;
  var favoriteStyle = options.favoriteStyle;

  // ── Use button ──────────────────────────────────────────────────────────────
  var _useVars = collectVariables([command.command]).filter(function (n) {
    return n !== "workspaceFolder";
  });
  var _useMissing = getMissingVariables(command);
  var _useCtrlHint = _useVars.length > 0 && _useMissing.length === 0;
  var _useTitle = _useCtrlHint
    ? "Insert into terminal (without running)<br>Press CTRL key to edit the variables"
    : "Insert into terminal (without running)";

  var useBtn = command.command.includes("\n")
    ? `<button class="btn icon-btn secondary d-focus" disabled data-tooltip="Use is not available for multi-line commands">${icons.use}</button>`
    : `<button class="btn icon-btn secondary btn-use action d-focus" data-command-id="${escapeAttr(command.id)}" data-tooltip="${escapeAttr(_useTitle)}">${icons.use}</button>`;

  // ── Edit button ─────────────────────────────────────────────────────────────
  var editBtn = showEdit
    ? `<button class="btn icon-btn secondary btn-edit action d-focus" data-command-id="${escapeAttr(command.id)}" data-tooltip="Edit command">${icons.edit}</button>`
    : "";

  // ── Explain button (Commands tab only) ─────────────────────────────────────
  var explainBtn = showEdit
    ? `<button class="btn icon-btn secondary btn-explain d-focus" data-command-id="${escapeAttr(command.id)}" data-command="${escapeAttr(command.command)}" data-tooltip="Explain command with AI">${icons.explain}</button>`
    : "";

  // ── Delete button ───────────────────────────────────────────────────────────
  var deleteBtn = showDelete
    ? `<button class="btn icon-btn danger btn-delete-command d-focus" data-command-id="${escapeAttr(command.id)}" data-tooltip="Delete command">${icons.delete}</button>`
    : "";

  // ── Favorite / Unfavorite button ────────────────────────────────────────────
  var favBtn = "";
  if (favoriteStyle === "favorite") {
    var _fs = getFavoriteScope(command.id);
    var _cls =
      _fs === "none"
        ? "secondary"
        : _fs === "local"
          ? "fav-state-local"
          : _fs === "global"
            ? "fav-state-global"
            : "fav-state-both";
    var _icon = _fs === "none" ? icons.heartPlus : icons.heartActive;
    // "Current Workspace" commands never leave this workspace folder, so all Global
    // shortcuts are meaningless for them and are omitted from the tooltip entirely.
    var _isWsCmd = isWorkspaceCommand(command.id);
    var _tip =
      _fs === "none"
        ? _isWsCmd
          ? 'Shift+Click: Add Local  •  Shift+Right-Click: Remove Local<br><span class="muted-tip">(Click to manage)</span>'
          : 'Ctrl+Click: Add Global  •  Ctrl+Right-Click: Remove Global<br>Shift+Click: Add Local  •  Shift+Right-Click: Remove Local<br>Ctrl+Shift+Click: Add Both  •  Ctrl+Shift+Right-Click: Remove Both<br><span class="muted-tip">(Click to manage)</span>'
        : _fs === "local"
          ? "In Local Favorites<br>(click to manage)"
          : _fs === "global"
            ? "In Global Favorites<br>(click to manage)"
            : "In Local &amp; Global Favorites<br>(click to manage)";
    favBtn = `<button class="btn icon-btn ${_cls} btn-add-favorite d-focus" data-command-id="${escapeAttr(command.id)}" data-tooltip="${escapeAttr(_tip)}" data-tooltip-pos="left">${_icon}</button>`;
  } else if (favoriteStyle === "unfavorite") {
    var _scope = uiState.favoritesScope;
    var _scopeLabel = _scope === "local" ? "Local Workspace" : "Global";
    favBtn = `<button class="btn icon-btn secondary btn-unfavorite d-focus" data-command-id="${escapeAttr(command.id)}" data-tooltip="Remove from ${escapeAttr(_scopeLabel)} favorites<br>CTRL+click to open manage panel">${icons.heartMinus}</button>`;
  }

  // ── Goto button ─────────────────────────────────────────────────────────────
  var gotoBtn = showGoto
    ? `<button class="btn icon-btn secondary btn-goto-command d-focus" data-command-id="${escapeAttr(command.id)}" data-tooltip="Go to command in Commands tab">${icons.externalLink}</button>`
    : "";

  return `<div class="actions-cell">
      <button class="btn icon-btn success btn-run d-focus" data-command-id="${escapeAttr(command.id)}" data-tooltip="Run command">${icons.run}</button>
      ${useBtn}
      <button class="btn icon-btn secondary btn-copy action d-focus" data-command-id="${escapeAttr(command.id)}" data-tooltip="Copy to clipboard">${icons.copy}</button>
      ${editBtn}
      ${explainBtn}
      ${deleteBtn}
      ${favBtn}
      ${gotoBtn}
    </div>`;
}

// ─── Custom Select Component ──────────────────────────────────────────────────

/**
 * Renders a custom dropdown HTML string.
 * @param {string} wrapperId      - unique id for the .cs-wrap div
 * @param {string} btnId          - unique id for the toggle button
 * @param {string} menuId         - unique id for the dropdown menu div
 * @param {Array<{value:string,label:string}>} options - the menu items
 * @param {string} selectedValue  - the currently selected value
 * @param {string} [btnExtraClass]  - extra CSS classes for the button
 * @param {boolean} [menuUp]        - true = menu opens upward
 * @param {string} [wrapExtraClass] - extra CSS classes for the .cs-wrap wrapper
 *   Use 'cs-wrap-full' to make the dropdown stretch to 100% width.
 * @returns {string} HTML string
 */
function renderCustomSelect(wrapperId, btnId, menuId, options, selectedValue, btnExtraClass, menuUp, wrapExtraClass) {
  const selectedOption = options.find(function (o) {
    return o.value === selectedValue;
  });
  const selectedLabel = selectedOption ? selectedOption.label : options.length ? options[0].label : "—";

  const items = options
    .map(function (opt) {
      const isSelected = opt.value === selectedValue;
      const badgeHtml = opt.badge ? `<span class="cs-item-badge">${opt.badge}</span>` : "";
      const isStart = opt.badgePosition === "start";
      const itemClass = opt.itemClass ? ` ${opt.itemClass}` : "";
      return `
      <div class="cs-item${itemClass}" role="menuitem" tabindex="-1" data-value="${escapeAttr(opt.value)}"${opt.tooltip ? ` data-tooltip="${escapeAttr(opt.tooltip)}"` : ""}${opt.tooltipFooter ? ` data-tooltip-footer="${escapeAttr(opt.tooltipFooter)}"` : ""}>
        <span class="cs-item-label-group">
          ${isStart ? badgeHtml : ""}
          <span class="cs-item-label">${escapeHtml(opt.label)}</span>
          ${!isStart ? badgeHtml : ""}
        </span>
        ${isSelected ? icons.checkmark : ""}
      </div>
    `;
    })
    .join("");

  const menuClass = `cs-menu${menuUp ? " cs-menu-up" : ""}`;
  const wrapClass = `cs-wrap${wrapExtraClass ? " " + wrapExtraClass : ""}`;
  const selectedItemClass = selectedOption && selectedOption.itemClass ? ` ${selectedOption.itemClass}` : "";

  return `
    <div class="${wrapClass}" id="${escapeAttr(wrapperId)}">
      <button class="cs-btn${btnExtraClass ? " " + btnExtraClass : ""}${selectedItemClass}" type="button" aria-haspopup="menu" aria-expanded="false" id="${escapeAttr(btnId)}">
        <span class="cs-btn-label">${escapeHtml(selectedLabel)}</span>
        ${icons.chevron}
      </button>
      <div class="${menuClass}" role="menu" id="${escapeAttr(menuId)}" hidden>
        <div class="cs-menu-items-wrapper">
          ${items}      
        </div>
      </div>
    </div>
  `;
}

/**
 * Generic custom dropdown event binder.
 * @param {string} wrapperId - id of the .cs-wrap element
 * @param {string} btnId     - id of the toggle button
 * @param {string} menuId    - id of the .cs-menu element
 * @param {function(string):void} onChange - callback receiving the selected value
 */
function bindCustomSelect(wrapperId, btnId, menuId, onChange) {
  const wrap = document.getElementById(wrapperId);
  const btn = document.getElementById(btnId);
  const menu = document.getElementById(menuId);

  if (!btn || !menu) {
    return;
  }

  function closeMenu() {
    if (!menu.hidden) {
      menu.hidden = true;
      btn.setAttribute("aria-expanded", "false");
    }
    document.removeEventListener("pointerdown", onPointerDown, true);
    window.removeEventListener("blur", onWindowBlur);
  }

  function onPointerDown(e) {
    if (wrap && !wrap.contains(e.target)) {
      closeMenu();
    }
  }

  function onWindowBlur() {
    closeMenu();
  }

  btn.addEventListener("click", function (e) {
    e.stopPropagation();
    if (!menu.hidden) {
      closeMenu();
    } else {
      menu.hidden = false;
      btn.setAttribute("aria-expanded", "true");
      // Highlight the currently selected item when the menu opens
      menu.querySelectorAll(".cs-item").forEach(function (el) {
        el.removeAttribute("data-highlighted");
      });
      var checkEl = menu.querySelector(".cs-check");
      if (checkEl) {
        var highlightedItem = checkEl.closest(".cs-item");
        highlightedItem.setAttribute("data-highlighted", "");
        // Scroll the selected item to the center of the visible menu area
        var itemsWrapper = menu.querySelector(".cs-menu-items-wrapper");
        if (itemsWrapper) {
          itemsWrapper.scrollTop =
            highlightedItem.offsetTop - itemsWrapper.clientHeight / 2 + highlightedItem.offsetHeight / 2;
        }
      }
      document.addEventListener("pointerdown", onPointerDown, true);
      window.addEventListener("blur", onWindowBlur);
    }
  });

  menu.querySelectorAll(".cs-item").forEach(function (item) {
    item.addEventListener("click", function () {
      // Update button label to reflect the newly selected item
      var labelEl = btn.querySelector(".cs-btn-label");
      var itemLabelEl = item.querySelector(".cs-item-label");
      if (labelEl && itemLabelEl) {
        labelEl.textContent = itemLabelEl.textContent;
      }
      // Move the checkmark to the newly selected item
      menu.querySelectorAll(".cs-check").forEach(function (el) {
        el.remove();
      });
      item.insertAdjacentHTML("beforeend", icons.checkmark);
      onChange(item.dataset.value);
      closeMenu();
    });
    item.addEventListener("mouseenter", function () {
      menu.querySelectorAll(".cs-item").forEach(function (el) {
        el.removeAttribute("data-highlighted");
      });
      item.setAttribute("data-highlighted", "");
    });
    item.addEventListener("mouseleave", function () {
      item.removeAttribute("data-highlighted");
    });
  });
}
