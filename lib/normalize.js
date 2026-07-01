/*-------------------------------------------------
 * Terminal Recipes — VS Code Extension
 * Copyright (c) 2026 Abdulla Aldosari
 * Licensed under the Apache License, Version 2.0.
 * See LICENSE in the project root for details.
 *-------------------------------------------------*/

// lib/normalize.js
// Pure data normalization and sanitization. No file I/O, no VS Code API, no side effects.

/**
 * Sanitizes a string value to be used as an ID: trims whitespace and lowercases it.
 * Returns an empty string if the value is not a string.
 * @param {*} value
 * @returns {string}
 */
function sanitizeId(value) {
  if (typeof value !== "string") {
    return "";
  }

  return value.trim().toLowerCase();
}

/**
 * Sanitizes a string value to be used as a display title: trims surrounding whitespace.
 * Returns an empty string if the value is not a string.
 * @param {*} value
 * @returns {string}
 */
function sanitizeTitle(value) {
  if (typeof value !== "string") {
    return "";
  }

  return value.trim();
}

/**
 * Valid shell type identifiers a command's `targetShell` field may hold.
 * Must stay in sync with the classification logic in lib/terminal.js (detectShellType).
 */
const VALID_TARGET_SHELLS = new Set(["powershell", "cmd", "bash", "wsl", "zsh", "sh"]);

/**
 * Returns the default commands data structure used when no file exists yet.
 * Starts with an empty slate so users can build their own categories and commands.
 * @returns {{ version: number, categories: object[], commands: object[] }}
 */
function getDefaultCommandsData() {
  return {
    version: 1,
    categories: [],
    commands: [],
  };
}

/**
 * Validates and normalizes the raw commands data object from the JSON file.
 * Filters out invalid categories and commands, deduplicates IDs,
 * and resolves groupId from both the new and legacy formats.
 * @param {*} input
 * @returns {{ version: number, categories: object[], commands: object[] }}
 */
function normalizeCommandsData(input) {
  const source = input && typeof input === "object" ? input : {};
  const rawCategories = Array.isArray(source.categories) ? source.categories : [];
  const rawCommands = Array.isArray(source.commands) ? source.commands : [];

  const categories = [];
  const categoryIds = new Set();

  for (const rawCategory of rawCategories) {
    if (!rawCategory || typeof rawCategory !== "object") {
      continue;
    }

    const id = sanitizeId(rawCategory.id);
    const title = sanitizeTitle(rawCategory.title);

    if (!id || !title || categoryIds.has(id)) {
      continue;
    }

    const groups = normalizeGroups(rawCategory.groups);

    categories.push({ id, title, groups });
    categoryIds.add(id);
  }

  const commands = [];
  const commandIds = new Set();

  for (const rawCommand of rawCommands) {
    if (!rawCommand || typeof rawCommand !== "object") {
      continue;
    }

    const id = sanitizeId(rawCommand.id);
    const title = sanitizeTitle(rawCommand.title);
    const description = typeof rawCommand.description === "string" ? rawCommand.description.trim() : "";
    const command = typeof rawCommand.command === "string" ? rawCommand.command.trim() : "";
    const categoryId = sanitizeId(rawCommand.categoryId);

    if (!id || !title || !command || !categoryId || commandIds.has(id) || !categoryIds.has(categoryId)) {
      continue;
    }

    const category = categories.find(function (item) {
      return item.id === categoryId;
    });

    const allowedGroups = new Set(
      (category && category.groups ? category.groups : []).map(function (group) {
        return group.id;
      })
    );

    // Support groupId (new) and groupIds[] (legacy migration — take first valid)
    let groupId = "";
    if (typeof rawCommand.groupId === "string") {
      const s = sanitizeId(rawCommand.groupId);
      groupId = allowedGroups.has(s) ? s : "";
    } else if (Array.isArray(rawCommand.groupIds) && rawCommand.groupIds.length > 0) {
      const s = sanitizeId(rawCommand.groupIds[0]);
      groupId = allowedGroups.has(s) ? s : "";
    }

    const lastRunAt = typeof rawCommand.lastRunAt === "string" ? rawCommand.lastRunAt : null;
    const runCount = typeof rawCommand.runCount === "number" && rawCommand.runCount > 0 ? rawCommand.runCount : 0;
    const helpUrl = typeof rawCommand.helpUrl === "string" ? rawCommand.helpUrl.trim() : "";
    const variableMeta = normalizeVariableMeta(rawCommand.variableMeta);
    const targetShell =
      typeof rawCommand.targetShell === "string" && VALID_TARGET_SHELLS.has(rawCommand.targetShell.trim())
        ? rawCommand.targetShell.trim()
        : "";

    commands.push({
      id,
      title,
      description,
      command,
      categoryId,
      groupId,
      ...(lastRunAt ? { lastRunAt } : {}),
      ...(runCount ? { runCount } : {}),
      ...(helpUrl ? { helpUrl } : {}),
      ...(Object.keys(variableMeta).length > 0 ? { variableMeta } : {}),
      ...(targetShell ? { targetShell } : {}),
    });

    commandIds.add(id);
  }

  return {
    version: 1,
    categories,
    commands,
  };
}

/**
 * Normalizes a command variables object to the standard v2 format.
 * Strips any non-string keys or values and returns a clean { version, commands } object.
 * @param {*} input
 * @returns {{ version: number, commands: object }}
 */
function normalizeCommandVariables(input) {
  const output = {
    version: 2,
    commands: {},
  };

  if (!input || typeof input !== "object") {
    return output;
  }

  const rawCommands = input.commands && typeof input.commands === "object" ? input.commands : {};

  for (const [commandId, variables] of Object.entries(rawCommands)) {
    if (typeof commandId !== "string" || !variables || typeof variables !== "object") {
      continue;
    }

    const normalizedVariables = {};

    for (const [key, value] of Object.entries(variables)) {
      if (typeof key === "string" && typeof value === "string") {
        normalizedVariables[key] = value;
      }
    }

    if (Object.keys(normalizedVariables).length > 0) {
      output.commands[commandId] = normalizedVariables;
    }
  }

  return output;
}

/**
 * Normalizes a groups array for a category.
 * Accepts both string items and {id, title} objects, deduplicates by ID,
 * and removes the reserved 'all' group.
 * @param {*} input
 * @returns {Array<{id: string, title: string}>}
 */
function normalizeGroups(input) {
  const groups = [];
  const seen = new Set();
  const source = Array.isArray(input) ? input : [];

  for (const item of source) {
    let id = "";
    let title = "";

    if (typeof item === "string") {
      id = sanitizeId(item);
      title = sanitizeTitle(item);
    }

    if (item && typeof item === "object") {
      id = sanitizeId(item.id);
      title = sanitizeTitle(item.title);
    }

    if (!id || !title || seen.has(id) || id === "all") {
      continue;
    }

    groups.push({ id, title });
    seen.add(id);
  }

  return groups;
}

/**
 * Normalizes and validates variableMeta for a command.
 * Returns a clean object with only valid enum entries.
 * @param {*} input
 * @returns {object}
 */
function normalizeVariableMeta(input) {
  const output = {};

  if (!input || typeof input !== "object" || Array.isArray(input)) {
    return output;
  }

  for (const [varName, meta] of Object.entries(input)) {
    if (typeof varName !== "string" || !meta || typeof meta !== "object") {
      continue;
    }

    if (meta.type !== "enum") {
      continue;
    }

    if (!Array.isArray(meta.enumValues) || meta.enumValues.length === 0) {
      continue;
    }

    const validEnumValues = meta.enumValues
      .filter(function (item) {
        return (
          item &&
          typeof item === "object" &&
          typeof item.title === "string" &&
          item.title.trim() &&
          typeof item.value === "string" &&
          item.value.trim() &&
          typeof item.description === "string"
        );
      })
      .map(function (item) {
        return {
          title: item.title.trim(),
          value: item.value.trim(),
          description: item.description.trim(),
        };
      });

    if (validEnumValues.length > 0) {
      output[varName] = {
        type: "enum",
        enumValues: validEnumValues,
      };
    }
  }

  return output;
}

module.exports = {
  sanitizeId,
  sanitizeTitle,
  getDefaultCommandsData,
  normalizeCommandsData,
  normalizeCommandVariables,
  normalizeGroups,
  normalizeVariableMeta,
  VALID_TARGET_SHELLS,
};
