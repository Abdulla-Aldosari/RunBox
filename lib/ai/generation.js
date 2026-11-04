/*-------------------------------------------------
 * RunBox — VS Code Extension
 * Copyright (c) 2026 Abdulla Aldosari
 * Licensed under the MIT License.
 * See LICENSE in the project root for details.
 *-------------------------------------------------*/

// lib/ai/generation.js
// Provider-independent command generation.
//
// Full mode (new category):
//   1. Outline request  -> category name, group names, raw command strings.
//   2. Details requests -> one per group (DETAILS_CONCURRENCY at a time),
//      returning title/description/helpUrl/variables keyed by command index.
//   3. Merge            -> local IDs, category/group references, target shell.
// Single mode (one command into an existing group): one request that returns
// the command and its details; the category and group are never sent to the
// model and are applied locally.
//
// Response validators are pure functions so they can be unit-tested without
// any provider or network access.

const { normalizeVariableMeta } = require("../normalize");
const { generateEntityId } = require("../ids");
const { MAX_GROUPS_PER_CATEGORY, MAX_COMMANDS_PER_GROUP, DETAILS_CONCURRENCY, SCHEMA_OUTLINE, SCHEMA_DETAILS, SCHEMA_SINGLE } = require("./schemas");
const { buildOutlineInstruction, buildDetailsInstruction, buildSingleInstruction, buildShellContext } = require("./systemInstruction");
const { AiInvalidResponseError, AiRejectedRequestError, requestJson } = require("./structured-output");

/** Same placeholder syntax the webview recognizes (media/utils.js collectVariables). */
const PLACEHOLDER_PATTERN = /\$\{([a-zA-Z0-9_]+)\}/g;

/**
 * Returns the trimmed command when it is a non-empty single line, otherwise "".
 * @param {*} value
 * @returns {string}
 */
function normalizeCommandString(value) {
  if (typeof value !== "string") return "";
  const command = value.trim();
  return command && !/[\r\n]/.test(command) ? command : "";
}

/**
 * Returns the URL when it is an absolute http(s) URL, otherwise "".
 * @param {*} value
 * @returns {string}
 */
function normalizeHelpUrl(value) {
  if (typeof value !== "string" || !value.trim()) return "";
  try {
    const url = new URL(value.trim());
    return url.protocol === "https:" || url.protocol === "http:" ? url.href : "";
  } catch {
    return "";
  }
}

/**
 * Converts the model's `variables` array into RunBox's `variableMeta` object.
 * Entries whose placeholder does not appear in the command are dropped.
 * @param {*} variables
 * @param {string} command
 * @returns {object} variableMeta (possibly empty)
 */
function toVariableMeta(variables, command) {
  if (!Array.isArray(variables)) return {};

  const placeholders = new Set(
    Array.from(command.matchAll(PLACEHOLDER_PATTERN), function (m) {
      return m[1];
    })
  );

  const meta = {};
  for (const entry of variables) {
    if (!entry || typeof entry.name !== "string") continue;
    const name = entry.name.trim().replace(/^\$\{/, "").replace(/\}$/, "");
    if (!placeholders.has(name) || meta[name]) continue;
    meta[name] = { type: "enum", enumValues: Array.isArray(entry.values) ? entry.values : [] };
  }
  return normalizeVariableMeta(meta);
}

/**
 * Validates the documentation fields shared by details items and single mode.
 * @param {object} item
 * @param {string} command
 * @returns {{ title: string, description: string, helpUrl: string, variableMeta: object }}
 * @throws {AiInvalidResponseError}
 */
function normalizeDetails(item, command) {
  const title = item && typeof item.title === "string" ? item.title.trim() : "";
  if (!title) {
    throw new AiInvalidResponseError("The AI response contained a command without a title.");
  }
  return {
    title,
    description: typeof item.description === "string" ? item.description.trim() : "",
    helpUrl: normalizeHelpUrl(item.helpUrl),
    variableMeta: toVariableMeta(item.variables, command),
  };
}

/**
 * Validates an outline response and enforces the hard limits.
 * Invalid commands and duplicates are removed first, then groups beyond
 * MAX_GROUPS_PER_CATEGORY and commands beyond MAX_COMMANDS_PER_GROUP are dropped.
 *
 * @param {object} data
 * @returns {{ categoryName: string, groups: { name: string, commands: string[] }[], dropped: { invalid: number, duplicates: number, overLimit: number } }}
 * @throws {AiRejectedRequestError|AiInvalidResponseError}
 */
function validateOutline(data) {
  if (data.valid === false) {
    throw new AiRejectedRequestError();
  }

  const categoryName = typeof data.categoryName === "string" ? data.categoryName.trim() : "";
  if (!categoryName || !Array.isArray(data.groups)) {
    throw new AiInvalidResponseError("The AI response is missing the category name or groups.");
  }

  const dropped = { invalid: 0, duplicates: 0, overLimit: 0 };
  const seen = new Set();
  const groups = [];

  for (const group of data.groups) {
    const name = group && typeof group.name === "string" ? group.name.trim() : "";
    const rawCommands = group && Array.isArray(group.commands) ? group.commands : [];
    const commands = [];

    for (const raw of rawCommands) {
      const command = normalizeCommandString(raw);
      if (!command) {
        dropped.invalid++;
      } else if (seen.has(command)) {
        dropped.duplicates++;
      } else {
        seen.add(command);
        commands.push(command);
      }
    }

    if (!name) {
      dropped.invalid += commands.length;
      continue;
    }
    if (commands.length === 0) {
      continue;
    }

    dropped.overLimit += Math.max(0, commands.length - MAX_COMMANDS_PER_GROUP);
    groups.push({ name, commands: commands.slice(0, MAX_COMMANDS_PER_GROUP) });
  }

  for (const extra of groups.slice(MAX_GROUPS_PER_CATEGORY)) {
    dropped.overLimit += extra.commands.length;
  }

  const kept = groups.slice(0, MAX_GROUPS_PER_CATEGORY);
  if (kept.length === 0) {
    throw new AiInvalidResponseError("The AI response did not contain any usable commands.");
  }

  return { categoryName, groups: kept, dropped };
}

/**
 * Validates a details response against the commands that were sent.
 * Every index 0..commands.length-1 must appear exactly once; nothing else is allowed.
 *
 * @param {object} data
 * @param {string[]} commands - The exact commands sent in the request, in order
 * @returns {{ title: string, description: string, helpUrl: string, variableMeta: object }[]} one entry per command, in order
 * @throws {AiInvalidResponseError}
 */
function validateDetails(data, commands) {
  const items = Array.isArray(data.items) ? data.items : null;
  if (!items || items.length !== commands.length) {
    throw new AiInvalidResponseError(`The AI response returned ${items ? items.length : 0} items for ${commands.length} commands.`);
  }

  const byIndex = new Array(commands.length);
  for (const item of items) {
    const index = item ? item.index : undefined;
    if (!Number.isInteger(index) || index < 0 || index >= commands.length || byIndex[index]) {
      throw new AiInvalidResponseError("The AI response contained a missing, duplicate, or out-of-range command index.");
    }
    byIndex[index] = normalizeDetails(item, commands[index]);
  }
  return byIndex;
}

/**
 * Validates a single-mode response.
 * @param {object} data
 * @returns {{ command: string, title: string, description: string, helpUrl: string, variableMeta: object }}
 * @throws {AiRejectedRequestError|AiInvalidResponseError}
 */
function validateSingle(data) {
  if (data.valid === false) {
    throw new AiRejectedRequestError();
  }
  const command = normalizeCommandString(data.command);
  if (!command) {
    throw new AiInvalidResponseError("The AI response did not contain a single-line command.");
  }
  return { command, ...normalizeDetails(data, command) };
}

/**
 * Builds a RunBox command object from generated parts.
 * @param {string} command
 * @param {{ title: string, description: string, helpUrl: string, variableMeta: object }} details
 * @param {{ categoryId?: string, groupId: string, targetShell?: string|null }} placement
 * @returns {object}
 */
function buildCommand(command, details, placement) {
  return {
    id: generateEntityId(),
    title: details.title,
    description: details.description,
    command,
    ...(placement.categoryId ? { categoryId: placement.categoryId } : {}),
    groupId: placement.groupId || "",
    ...(details.helpUrl ? { helpUrl: details.helpUrl } : {}),
    ...(Object.keys(details.variableMeta).length > 0 ? { variableMeta: details.variableMeta } : {}),
    ...(placement.targetShell ? { targetShell: placement.targetShell } : {}),
  };
}

/**
 * Runs `worker` over `items` with at most `limit` calls in flight.
 * Never rejects: returns one `{ ok, value | error }` entry per item, in order.
 * @template I, R
 * @param {I[]} items
 * @param {number} limit
 * @param {(item: I, index: number) => Promise<R>} worker
 * @returns {Promise<({ ok: true, value: R } | { ok: false, error: Error })[]>}
 */
async function mapWithConcurrency(items, limit, worker) {
  const results = new Array(items.length);
  let next = 0;

  async function run() {
    while (next < items.length) {
      const index = next++;
      try {
        results[index] = { ok: true, value: await worker(items[index], index) };
      } catch (error) {
        results[index] = { ok: false, error };
      }
    }
  }

  const runners = [];
  for (let i = 0; i < Math.min(limit, items.length); i++) {
    runners.push(run());
  }
  await Promise.all(runners);
  return results;
}

/**
 * Builds the user message for one details request.
 * @param {string} categoryName
 * @param {{ name: string, commands: string[] }} group
 * @returns {string}
 */
function buildDetailsPrompt(categoryName, group) {
  const lines = group.commands.map(function (command, index) {
    return `${index}. ${command}`;
  });
  return `Category: ${categoryName}
Group: ${group.name}
Commands:
${lines.join("\n")}`;
}

/**
 * Builds the user-facing warnings for a full-mode result.
 * @param {{ invalid: number, duplicates: number, overLimit: number }} dropped
 * @param {{ name: string, error: Error }[]} failedGroups
 * @returns {string[]}
 */
function buildFullWarnings(dropped, failedGroups) {
  const warnings = [];
  if (dropped.overLimit > 0) {
    warnings.push(`${dropped.overLimit} command(s) were removed to stay within the limit of ${MAX_GROUPS_PER_CATEGORY} groups and ${MAX_COMMANDS_PER_GROUP} commands per group.`);
  }
  if (dropped.invalid + dropped.duplicates > 0) {
    warnings.push(`${dropped.invalid + dropped.duplicates} duplicate or invalid command(s) were removed.`);
  }
  for (const failed of failedGroups) {
    warnings.push(`Group "${failed.name}" was skipped: ${failed.error.message}`);
  }
  return warnings;
}

/**
 * Adapts the generic `log` callback to requestJson's per-attempt hook.
 * @param {((entry: object) => void)|undefined} log
 * @param {string} stage
 * @param {{ system: string, prompt: string, schema: object }} request
 * @returns {((attempt: { attempt: number, text?: string, error?: Error }) => void)|undefined}
 */
function createAttemptLogger(log, stage, request) {
  if (!log) return undefined;
  return function (attempt) {
    log({ stage, attempt: attempt.attempt, systemInstruction: request.system, prompt: request.prompt, schema: request.schema, text: attempt.text, error: attempt.error });
  };
}

/**
 * Generates a new category with its groups and commands (two-stage flow).
 *
 * @param {{
 *   provider: { completeJson: Function },
 *   prompt: string,
 *   language: string,
 *   shellName?: string,
 *   targetShell?: string|null,
 *   signal?: AbortSignal,
 *   onProgress?: (progress: { stage: 'outline'|'details', done?: number, total?: number }) => void,
 *   log?: (entry: object) => void,
 * }} options
 * @returns {Promise<{ category: { id: string, title: string, groups: { id: string, title: string }[] }, commands: object[], warnings: string[] }>}
 */
async function generateFullCategory(options) {
  const { provider, prompt, language, shellName, targetShell, signal, onProgress, log } = options;
  const shellContext = shellName ? buildShellContext(shellName) : "";
  const notify = onProgress || function () {};

  notify({ stage: "outline" });
  const outlineRequest = { system: `${buildOutlineInstruction()}${shellContext}`, prompt, schema: SCHEMA_OUTLINE, schemaName: "runbox_outline", signal };
  const outline = await requestJson(provider, outlineRequest, validateOutline, createAttemptLogger(log, "full:outline", outlineRequest));

  const total = outline.groups.length;
  let done = 0;
  notify({ stage: "details", done, total });

  const detailsSystem = `${buildDetailsInstruction(language)}${shellContext}`;
  const settled = await mapWithConcurrency(outline.groups, DETAILS_CONCURRENCY, async function (group) {
    if (signal && signal.aborted) {
      throw new Error("Generation was cancelled.");
    }
    const request = { system: detailsSystem, prompt: buildDetailsPrompt(outline.categoryName, group), schema: SCHEMA_DETAILS, schemaName: "runbox_details", signal };
    const validate = function (data) {
      return validateDetails(data, group.commands);
    };
    const details = await requestJson(provider, request, validate, createAttemptLogger(log, "full:details", request));
    done++;
    notify({ stage: "details", done, total });
    return details;
  });

  if (signal && signal.aborted) {
    throw new Error("Generation was cancelled.");
  }

  const failedGroups = [];
  settled.forEach(function (entry, index) {
    if (!entry.ok) failedGroups.push({ name: outline.groups[index].name, error: entry.error });
  });
  if (failedGroups.length === total) {
    throw failedGroups[0].error;
  }

  const categoryId = generateEntityId();
  const groups = [];
  const commands = [];
  settled.forEach(function (entry, index) {
    if (!entry.ok) return;
    const group = { id: generateEntityId(), title: outline.groups[index].name };
    groups.push(group);
    outline.groups[index].commands.forEach(function (command, commandIndex) {
      commands.push(buildCommand(command, entry.value[commandIndex], { categoryId, groupId: group.id, targetShell }));
    });
  });

  return {
    category: { id: categoryId, title: outline.categoryName, groups },
    commands,
    warnings: buildFullWarnings(outline.dropped, failedGroups),
  };
}

/**
 * Generates one command for an existing group. The category and group are
 * never sent to the model; they are applied to the result locally.
 *
 * @param {{
 *   provider: { completeJson: Function },
 *   prompt: string,
 *   language: string,
 *   categoryId: string,
 *   groupId: string,
 *   shellName?: string,
 *   targetShell?: string|null,
 *   signal?: AbortSignal,
 *   log?: (entry: object) => void,
 * }} options
 * @returns {Promise<object>} the command object
 */
async function generateSingleCommand(options) {
  const { provider, prompt, language, categoryId, groupId, shellName, targetShell, signal, log } = options;
  const shellContext = shellName ? buildShellContext(shellName) : "";
  const request = { system: `${buildSingleInstruction(language)}${shellContext}`, prompt, schema: SCHEMA_SINGLE, schemaName: "runbox_single", signal };
  const result = await requestJson(provider, request, validateSingle, createAttemptLogger(log, "single", request));
  return buildCommand(result.command, result, { categoryId, groupId, targetShell });
}

module.exports = {
  generateFullCategory,
  generateSingleCommand,
  validateOutline,
  validateDetails,
  validateSingle,
  toVariableMeta,
  normalizeHelpUrl,
  mapWithConcurrency,
};
