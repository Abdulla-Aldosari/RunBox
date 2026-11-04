/*-------------------------------------------------
 * RunBox — VS Code Extension
 * Copyright (c) 2026 Abdulla Aldosari
 * Licensed under the MIT License.
 * See LICENSE in the project root for details.
 *-------------------------------------------------*/

/**
 * JSON Schemas and hard limits for AI structured output.
 *
 * Generation runs in two stages so that no single response can grow large
 * enough to be truncated by a model's output-token limit:
 *
 *   1. Outline  — category name, group names, and raw command strings only.
 *   2. Details  — one request per group: title, description, help URL, and
 *                 enum variables for each command, keyed by its index.
 *
 * The single-command flow uses one request whose schema combines the outline
 * fields for one command with the same details item used by stage 2.
 *
 * Every schema uses only fixed-key objects and arrays (no dynamic keys), so the
 * same schema is accepted by every provider, including Gemini's responseSchema.
 * Top-level objects do not set `additionalProperties: false` because Gemini
 * rejects it; OpenAI adds it via `addAdditionalPropertiesFalse()` for strict mode.
 */

/**
 * Hard limits enforced in code after every outline response (excess entries
 * are dropped). They are also stated in the outline instruction so the model
 * normally stays within them. Never raise them without re-checking that a
 * full details response for MAX_COMMANDS_PER_GROUP commands still fits in the
 * smallest provider `maxOutputTokens` value in providers-config.js.
 */
const MAX_GROUPS_PER_CATEGORY = 12;
const MAX_COMMANDS_PER_GROUP = 15;

/**
 * Number of stage-2 (details) requests sent at the same time.
 * Kept low to stay under the per-minute request limits of free tiers.
 */
const DETAILS_CONCURRENCY = 3;

/** One selectable value of an enum variable. */
const ENUM_VALUE_ITEM = {
  type: "object",
  properties: {
    title: { type: "string" },
    value: { type: "string" },
    description: { type: "string" },
  },
  required: ["title", "value", "description"],
};

/** One enum variable of a command. Free-input variables are never listed. */
const VARIABLE_ITEM = {
  type: "object",
  properties: {
    name: { type: "string" },
    values: { type: "array", items: ENUM_VALUE_ITEM },
  },
  required: ["name", "values"],
};

/** Documentation fields for one command. Shared by stage 2 and single mode. */
const COMMAND_DETAILS_PROPERTIES = {
  title: { type: "string" },
  description: { type: "string" },
  helpUrl: { type: "string" },
  variables: { type: "array", items: VARIABLE_ITEM },
};

const COMMAND_DETAILS_REQUIRED = ["title", "description", "helpUrl", "variables"];

/** Stage 1 (full mode): category outline with raw command strings. */
const SCHEMA_OUTLINE = {
  type: "object",
  properties: {
    valid: { type: "boolean" },
    categoryName: { type: "string" },
    groups: {
      type: "array",
      items: {
        type: "object",
        properties: {
          name: { type: "string" },
          commands: { type: "array", items: { type: "string" } },
        },
        required: ["name", "commands"],
      },
    },
  },
  required: ["valid", "categoryName", "groups"],
};

/** Stage 2 (full mode): details for a numbered list of commands. */
const SCHEMA_DETAILS = {
  type: "object",
  properties: {
    items: {
      type: "array",
      items: {
        type: "object",
        properties: {
          index: { type: "integer" },
          ...COMMAND_DETAILS_PROPERTIES,
        },
        required: ["index", ...COMMAND_DETAILS_REQUIRED],
      },
    },
  },
  required: ["items"],
};

/** Single mode: one command with its details, in one request. */
const SCHEMA_SINGLE = {
  type: "object",
  properties: {
    valid: { type: "boolean" },
    command: { type: "string" },
    ...COMMAND_DETAILS_PROPERTIES,
  },
  required: ["valid", "command", ...COMMAND_DETAILS_REQUIRED],
};

/**
 * Recursively adds `additionalProperties: false` to every object in the schema.
 * Required by OpenAI when using strict JSON schema mode.
 *
 * @param {object} schema
 * @returns {object} new schema with additionalProperties added
 */
function addAdditionalPropertiesFalse(schema) {
  if (!schema || typeof schema !== "object") {
    return schema;
  }

  const result = { ...schema };

  if (result.type === "object") {
    if (!("additionalProperties" in result)) {
      result.additionalProperties = false;
    }

    if (result.properties) {
      const newProps = {};
      for (const [key, val] of Object.entries(result.properties)) {
        newProps[key] = addAdditionalPropertiesFalse(val);
      }
      result.properties = newProps;
    }
  }

  if (result.type === "array" && result.items) {
    result.items = addAdditionalPropertiesFalse(result.items);
  }

  return result;
}

module.exports = {
  MAX_GROUPS_PER_CATEGORY,
  MAX_COMMANDS_PER_GROUP,
  DETAILS_CONCURRENCY,
  SCHEMA_OUTLINE,
  SCHEMA_DETAILS,
  SCHEMA_SINGLE,
  addAdditionalPropertiesFalse,
};
