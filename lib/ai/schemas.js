/*-------------------------------------------------
 * RunBox — VS Code Extension
 * Copyright (c) 2026 Abdulla Aldosari
 * Licensed under the Apache License, Version 2.0.
 * See LICENSE in the project root for details.
 *-------------------------------------------------*/

/**
 * JSON Schemas for AI structured output.
 * Used to enforce exact response format from AI providers.
 *
 * NOTE: Top-level objects do not have `additionalProperties: false` because
 * Gemini does not support it in responseSchema for fixed-key objects.
 * OpenAI injects it selectively via `addAdditionalPropertiesFalse` (see providers/openai.js),
 * which preserves existing `additionalProperties` sub-schemas (e.g. variableMeta dynamic keys).
 */

/**
 * Sub-schema for a single enum option inside variableMeta.
 */
const ENUM_VALUE_ITEM = {
  type: "object",
  properties: {
    title: { type: "string" },
    value: { type: "string" },
    description: { type: "string" },
  },
  required: ["title", "value", "description"],
};

/**
 * Sub-schema for variableMeta — one entry per variable name.
 * Each entry describes the variable type and its enum values (if applicable).
 */
const VARIABLE_META_VALUE = {
  type: "object",
  properties: {
    type: { type: "string" }, // always "enum" for now
    enumValues: { type: "array", items: ENUM_VALUE_ITEM },
  },
  required: ["type", "enumValues"],
};

/**
 * Schema for `full` mode: generates a complete category with groups and commands.
 */
const SCHEMA_FULL = {
  type: "object",
  properties: {
    category: {
      type: "object",
      properties: {
        id: { type: "string" },
        title: { type: "string" },
        groups: {
          type: "array",
          items: {
            type: "object",
            properties: {
              id: { type: "string" },
              title: { type: "string" },
            },
            required: ["id", "title"],
          },
        },
      },
      required: ["id", "title", "groups"],
    },
    commands: {
      type: "array",
      items: {
        type: "object",
        properties: {
          id: { type: "string" },
          title: { type: "string" },
          description: { type: "string" },
          command: { type: "string" },
          categoryId: { type: "string" },
          groupId: { type: "string" },
          helpUrl: { type: "string" },
          variableMeta: {
            type: "object",
            additionalProperties: VARIABLE_META_VALUE,
          },
        },
        required: ["id", "title", "description", "command", "categoryId", "groupId", "helpUrl"],
      },
    },
  },
  required: ["category", "commands"],
};

/**
 * Schema for `single` mode: generates a single command.
 * categoryId and groupIds are NOT included — they are injected locally.
 */
const SCHEMA_SINGLE = {
  type: "object",
  properties: {
    id: { type: "string" },
    title: { type: "string" },
    description: { type: "string" },
    command: { type: "string" },
    helpUrl: { type: "string" },
    variableMeta: {
      type: "object",
      additionalProperties: VARIABLE_META_VALUE,
    },
  },
  required: ["id", "title", "description", "command", "helpUrl"],
};

/**
 * Recursively adds `additionalProperties: false` to every object in the schema.
 * Required by OpenAI when using strict JSON schema mode.
 *
 * If `additionalProperties` is already defined as an object (e.g. a sub-schema
 * for dynamic keys like variableMeta), it is preserved and recursed into rather
 * than overwritten with `false`.
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
    if (result.additionalProperties && typeof result.additionalProperties === "object") {
      // Preserve and recurse into an existing sub-schema (e.g. variableMeta dynamic values)
      result.additionalProperties = addAdditionalPropertiesFalse(result.additionalProperties);
    } else if (!("additionalProperties" in result)) {
      // Only add additionalProperties: false when not already specified
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

/**
 * Gemini-specific sub-schema for a single variableMetaList entry.
 * Uses an explicit `variableName` field instead of a dynamic object key,
 * because Gemini's responseSchema does not support additionalProperties as a sub-schema.
 * The `gemini.js` provider transforms this back to the standard variableMeta format.
 */
const VARIABLE_META_GEMINI_ITEM = {
  type: "object",
  properties: {
    variableName: { type: "string" },
    type: { type: "string" },
    enumValues: { type: "array", items: ENUM_VALUE_ITEM },
  },
  required: ["variableName", "type", "enumValues"],
};

/**
 * Gemini-specific schema for `full` mode.
 * Uses `variableMetaList` (array) instead of `variableMeta` (dynamic object).
 */
const SCHEMA_FULL_GEMINI = {
  type: "object",
  properties: {
    category: {
      type: "object",
      properties: {
        id: { type: "string" },
        title: { type: "string" },
        groups: {
          type: "array",
          items: {
            type: "object",
            properties: {
              id: { type: "string" },
              title: { type: "string" },
            },
            required: ["id", "title"],
          },
        },
      },
      required: ["id", "title", "groups"],
    },
    commands: {
      type: "array",
      items: {
        type: "object",
        properties: {
          id: { type: "string" },
          title: { type: "string" },
          description: { type: "string" },
          command: { type: "string" },
          categoryId: { type: "string" },
          groupId: { type: "string" },
          helpUrl: { type: "string" },
          variableMetaList: {
            type: "array",
            items: VARIABLE_META_GEMINI_ITEM,
          },
        },
        required: ["id", "title", "description", "command", "categoryId", "groupId", "helpUrl", "variableMetaList"],
      },
    },
  },
  required: ["category", "commands"],
};

/**
 * Gemini-specific schema for `single` mode.
 * Uses `variableMetaList` (array) instead of `variableMeta` (dynamic object).
 */
const SCHEMA_SINGLE_GEMINI = {
  type: "object",
  properties: {
    id: { type: "string" },
    title: { type: "string" },
    description: { type: "string" },
    command: { type: "string" },
    helpUrl: { type: "string" },
    variableMetaList: {
      type: "array",
      items: VARIABLE_META_GEMINI_ITEM,
    },
  },
  required: ["id", "title", "description", "command", "helpUrl", "variableMetaList"],
};

module.exports = {
  SCHEMA_FULL,
  SCHEMA_SINGLE,
  SCHEMA_FULL_GEMINI,
  SCHEMA_SINGLE_GEMINI,
  addAdditionalPropertiesFalse,
};
