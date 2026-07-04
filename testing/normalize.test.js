/*-------------------------------------------------
 * RunBox — VS Code Extension
 * Copyright (c) 2026 Abdulla Aldosari
 * Licensed under the Apache License, Version 2.0.
 * See LICENSE in the project root for details.
 *-------------------------------------------------*/

// testing/normalize.test.js
// Unit tests for lib/normalize.js — all pure functions, no mocks needed.
// Run with: node testing/normalize.test.js

"use strict";

const assert = require("assert");
const {
  sanitizeId,
  sanitizeTitle,
  getDefaultCommandsData,
  normalizeCommandsData,
  normalizeVariablesSection,
  normalizeFavoritesSection,
  normalizeDataFile,
  normalizeGroups,
  normalizeVariableMeta,
} = require("../lib/normalize");

// ---------------------------------------------------------------------------
// Simple test runner
// ---------------------------------------------------------------------------

let passed = 0;
let failed = 0;

function test(description, fn) {
  try {
    fn();
    console.log(`  ✓  ${description}`);
    passed++;
  } catch (err) {
    console.error(`  ✗  ${description}`);
    console.error(`       ${err.message}`);
    failed++;
  }
}

function section(name) {
  console.log(`\n── ${name} ──`);
}

// ---------------------------------------------------------------------------
// sanitizeId
// ---------------------------------------------------------------------------

section("sanitizeId");

test("trims leading and trailing whitespace", function () {
  assert.strictEqual(sanitizeId("  hello  "), "hello");
});

test("lowercases the string", function () {
  assert.strictEqual(sanitizeId("Hello World"), "hello world");
});

test("trims AND lowercases together", function () {
  assert.strictEqual(sanitizeId("  MY-CATEGORY  "), "my-category");
});

test("returns empty string for a non-string number", function () {
  assert.strictEqual(sanitizeId(42), "");
});

test("returns empty string for null", function () {
  assert.strictEqual(sanitizeId(null), "");
});

test("returns empty string for undefined", function () {
  assert.strictEqual(sanitizeId(undefined), "");
});

test("returns empty string for an object", function () {
  assert.strictEqual(sanitizeId({}), "");
});

test("returns empty string for an array", function () {
  assert.strictEqual(sanitizeId([]), "");
});

test("returns empty string for an already-empty string after trim", function () {
  assert.strictEqual(sanitizeId("   "), "");
});

test("preserves hyphens and underscores", function () {
  assert.strictEqual(sanitizeId("my-cmd_id"), "my-cmd_id");
});

// ---------------------------------------------------------------------------
// sanitizeTitle
// ---------------------------------------------------------------------------

section("sanitizeTitle");

test("trims leading and trailing whitespace", function () {
  assert.strictEqual(sanitizeTitle("  My Title  "), "My Title");
});

test("preserves internal whitespace and mixed case", function () {
  assert.strictEqual(sanitizeTitle("  Git Push Origin  "), "Git Push Origin");
});

test("returns empty string for null", function () {
  assert.strictEqual(sanitizeTitle(null), "");
});

test("returns empty string for undefined", function () {
  assert.strictEqual(sanitizeTitle(undefined), "");
});

test("returns empty string for a number", function () {
  assert.strictEqual(sanitizeTitle(123), "");
});

test("returns empty string for whitespace-only string", function () {
  assert.strictEqual(sanitizeTitle("   "), "");
});

test("does NOT lowercase the string (unlike sanitizeId)", function () {
  assert.strictEqual(sanitizeTitle("UPPERCASE"), "UPPERCASE");
});

// ---------------------------------------------------------------------------
// getDefaultCommandsData
// ---------------------------------------------------------------------------

section("getDefaultCommandsData");

test("returns version 1", function () {
  assert.strictEqual(getDefaultCommandsData().version, 1);
});

test("returns empty categories array", function () {
  const result = getDefaultCommandsData();
  assert.ok(Array.isArray(result.categories));
  assert.strictEqual(result.categories.length, 0);
});

test("returns empty commands array", function () {
  const result = getDefaultCommandsData();
  assert.ok(Array.isArray(result.commands));
  assert.strictEqual(result.commands.length, 0);
});

test("returns a new object each call (not the same reference)", function () {
  const a = getDefaultCommandsData();
  const b = getDefaultCommandsData();
  assert.notStrictEqual(a, b);
  a.categories.push("x");
  assert.strictEqual(b.categories.length, 0);
});

// ---------------------------------------------------------------------------
// normalizeGroups
// ---------------------------------------------------------------------------

section("normalizeGroups");

test("returns empty array for null input", function () {
  assert.deepStrictEqual(normalizeGroups(null), []);
});

test("returns empty array for non-array input", function () {
  assert.deepStrictEqual(normalizeGroups("not-an-array"), []);
  assert.deepStrictEqual(normalizeGroups(42), []);
  assert.deepStrictEqual(normalizeGroups({}), []);
});

test("accepts string items and lowercases their id", function () {
  const result = normalizeGroups(["Backend", "Frontend"]);
  assert.strictEqual(result[0].id, "backend");
  assert.strictEqual(result[0].title, "Backend");
  assert.strictEqual(result[1].id, "frontend");
  assert.strictEqual(result[1].title, "Frontend");
});

test("accepts object items with {id, title}", function () {
  const result = normalizeGroups([{ id: "ops", title: "Operations" }]);
  assert.strictEqual(result[0].id, "ops");
  assert.strictEqual(result[0].title, "Operations");
});

test("removes the reserved 'all' group", function () {
  const result = normalizeGroups(["all", "backend"]);
  assert.strictEqual(result.length, 1);
  assert.strictEqual(result[0].id, "backend");
});

test("deduplicates by id (keeps first occurrence)", function () {
  const result = normalizeGroups(["backend", "Backend"]);
  assert.strictEqual(result.length, 1);
  assert.strictEqual(result[0].id, "backend");
});

test("drops items with empty id or empty title after sanitize", function () {
  const result = normalizeGroups([
    { id: "  ", title: "No ID" },
    { id: "ok", title: "  " },
    { id: "good", title: "Good" },
  ]);
  assert.strictEqual(result.length, 1);
  assert.strictEqual(result[0].id, "good");
});

test("handles mixed string and object items", function () {
  const result = normalizeGroups(["backend", { id: "OPS", title: "Operations" }]);
  assert.strictEqual(result.length, 2);
  assert.strictEqual(result[0].id, "backend");
  assert.strictEqual(result[1].id, "ops");
});

// ---------------------------------------------------------------------------
// normalizeVariableMeta
// ---------------------------------------------------------------------------

section("normalizeVariableMeta");

test("returns empty object for null input", function () {
  assert.deepStrictEqual(normalizeVariableMeta(null), {});
});

test("returns empty object for non-object input", function () {
  assert.deepStrictEqual(normalizeVariableMeta("string"), {});
  assert.deepStrictEqual(normalizeVariableMeta(42), {});
});

test("returns empty object for an array input", function () {
  assert.deepStrictEqual(normalizeVariableMeta([]), {});
});

test("keeps valid enum entry", function () {
  const input = {
    env: {
      type: "enum",
      enumValues: [
        { title: "Dev", value: "development", description: "Development env" },
        { title: "Prod", value: "production", description: "" },
      ],
    },
  };
  const result = normalizeVariableMeta(input);
  assert.ok(result.env);
  assert.strictEqual(result.env.type, "enum");
  assert.strictEqual(result.env.enumValues.length, 2);
});

test("trims whitespace from title and value in enumValues", function () {
  const input = {
    env: {
      type: "enum",
      enumValues: [{ title: "  Dev  ", value: "  dev  ", description: "" }],
    },
  };
  const result = normalizeVariableMeta(input);
  assert.strictEqual(result.env.enumValues[0].title, "Dev");
  assert.strictEqual(result.env.enumValues[0].value, "dev");
});

test("drops entries with type other than 'enum'", function () {
  const input = { myVar: { type: "text" } };
  assert.deepStrictEqual(normalizeVariableMeta(input), {});
});

test("drops entries with empty enumValues array", function () {
  const input = { myVar: { type: "enum", enumValues: [] } };
  assert.deepStrictEqual(normalizeVariableMeta(input), {});
});

test("drops enumValues items missing title", function () {
  const input = {
    env: {
      type: "enum",
      enumValues: [
        { title: "", value: "dev", description: "" },
        { title: "Prod", value: "prod", description: "" },
      ],
    },
  };
  const result = normalizeVariableMeta(input);
  assert.strictEqual(result.env.enumValues.length, 1);
  assert.strictEqual(result.env.enumValues[0].title, "Prod");
});

test("drops enumValues items missing value", function () {
  const input = {
    env: {
      type: "enum",
      enumValues: [
        { title: "Dev", value: "", description: "" },
        { title: "Prod", value: "prod", description: "" },
      ],
    },
  };
  const result = normalizeVariableMeta(input);
  assert.strictEqual(result.env.enumValues.length, 1);
});

test("drops the whole variable if all enumValues are invalid", function () {
  const input = {
    env: {
      type: "enum",
      enumValues: [{ title: "", value: "", description: "" }],
    },
  };
  assert.deepStrictEqual(normalizeVariableMeta(input), {});
});

// ---------------------------------------------------------------------------
// normalizeVariablesSection
// ---------------------------------------------------------------------------

section("normalizeVariablesSection");

test("returns { commands:{} } for null input", function () {
  assert.deepStrictEqual(normalizeVariablesSection(null), { commands: {} });
});

test("returns { commands:{} } for non-object input", function () {
  assert.deepStrictEqual(normalizeVariablesSection("bad"), { commands: {} });
  assert.deepStrictEqual(normalizeVariablesSection(42), { commands: {} });
});

test("normalizes valid data correctly", function () {
  const input = {
    commands: {
      "cmd-1": { branch: "main", env: "dev" },
    },
  };
  const result = normalizeVariablesSection(input);
  assert.deepStrictEqual(result.commands["cmd-1"], { branch: "main", env: "dev" });
});

test("drops non-string variable values", function () {
  const input = {
    commands: {
      "cmd-1": { branch: "main", count: 42, flag: true },
    },
  };
  const result = normalizeVariablesSection(input);
  assert.deepStrictEqual(result.commands["cmd-1"], { branch: "main" });
});

test("drops commands with no valid string variables", function () {
  const input = {
    commands: {
      "cmd-1": { count: 42 },
    },
  };
  const result = normalizeVariablesSection(input);
  assert.deepStrictEqual(result.commands, {});
});

test("handles commands with no variables entry (non-object value)", function () {
  const input = {
    commands: {
      "cmd-1": null,
      "cmd-2": { branch: "main" },
    },
  };
  const result = normalizeVariablesSection(input);
  assert.ok(!result.commands["cmd-1"]);
  assert.ok(result.commands["cmd-2"]);
});

// ---------------------------------------------------------------------------
// normalizeFavoritesSection
// ---------------------------------------------------------------------------

section("normalizeFavoritesSection");

test("returns { commandIds:[] } for null input", function () {
  assert.deepStrictEqual(normalizeFavoritesSection(null), { commandIds: [] });
});

test("returns { commandIds:[] } for non-object input", function () {
  assert.deepStrictEqual(normalizeFavoritesSection("bad"), { commandIds: [] });
  assert.deepStrictEqual(normalizeFavoritesSection(42), { commandIds: [] });
});

test("returns { commandIds:[] } when commandIds is not an array", function () {
  assert.deepStrictEqual(normalizeFavoritesSection({ commandIds: "bad" }), { commandIds: [] });
});

test("keeps valid string commandIds", function () {
  const result = normalizeFavoritesSection({ commandIds: ["cmd-1", "cmd-2"] });
  assert.deepStrictEqual(result.commandIds, ["cmd-1", "cmd-2"]);
});

test("filters out non-string entries", function () {
  const result = normalizeFavoritesSection({ commandIds: ["cmd-1", 42, null, "cmd-2"] });
  assert.deepStrictEqual(result.commandIds, ["cmd-1", "cmd-2"]);
});

// ---------------------------------------------------------------------------
// normalizeDataFile
// ---------------------------------------------------------------------------

section("normalizeDataFile");

test("returns default structure for null input", function () {
  const result = normalizeDataFile(null);
  assert.strictEqual(result.version, 1);
  assert.deepStrictEqual(result.variables, { commands: {} });
  assert.deepStrictEqual(result.favorites, { commandIds: [] });
});

test("returns default structure for non-object input", function () {
  const result = normalizeDataFile("bad");
  assert.deepStrictEqual(result.variables, { commands: {} });
  assert.deepStrictEqual(result.favorites, { commandIds: [] });
});

test("preserves valid variables and favorites sections together", function () {
  const input = {
    variables: { commands: { "cmd-1": { branch: "main" } } },
    favorites: { commandIds: ["cmd-1"] },
  };
  const result = normalizeDataFile(input);
  assert.deepStrictEqual(result.variables.commands["cmd-1"], { branch: "main" });
  assert.deepStrictEqual(result.favorites.commandIds, ["cmd-1"]);
});

test("always returns version: 1 regardless of input version", function () {
  assert.strictEqual(normalizeDataFile({ version: 99 }).version, 1);
  assert.strictEqual(normalizeDataFile(null).version, 1);
});

test("ignores unknown top-level keys not present in DATA_SECTIONS", function () {
  const result = normalizeDataFile({ unknownSection: { foo: "bar" } });
  assert.strictEqual(result.unknownSection, undefined);
});

// ---------------------------------------------------------------------------
// normalizeCommandsData
// ---------------------------------------------------------------------------

section("normalizeCommandsData");

test("returns default structure for null input", function () {
  const result = normalizeCommandsData(null);
  assert.strictEqual(result.version, 1);
  assert.deepStrictEqual(result.categories, []);
  assert.deepStrictEqual(result.commands, []);
});

test("returns default structure for non-object input", function () {
  const result = normalizeCommandsData("bad");
  assert.deepStrictEqual(result.categories, []);
  assert.deepStrictEqual(result.commands, []);
});

test("normalizes a valid category correctly", function () {
  const input = {
    categories: [{ id: "devops", title: "DevOps" }],
    commands: [],
  };
  const result = normalizeCommandsData(input);
  assert.strictEqual(result.categories.length, 1);
  assert.strictEqual(result.categories[0].id, "devops");
  assert.strictEqual(result.categories[0].title, "DevOps");
});

test("sanitizes category id (lowercase + trim)", function () {
  const input = {
    categories: [{ id: "  MY-CAT  ", title: "My Category" }],
    commands: [],
  };
  const result = normalizeCommandsData(input);
  assert.strictEqual(result.categories[0].id, "my-cat");
});

test("drops categories with empty id after sanitize", function () {
  const input = {
    categories: [
      { id: "   ", title: "No ID" },
      { id: "ok", title: "Good" },
    ],
    commands: [],
  };
  const result = normalizeCommandsData(input);
  assert.strictEqual(result.categories.length, 1);
  assert.strictEqual(result.categories[0].id, "ok");
});

test("drops categories with empty title after sanitize", function () {
  const input = {
    categories: [
      { id: "cat1", title: "   " },
      { id: "cat2", title: "Good" },
    ],
    commands: [],
  };
  const result = normalizeCommandsData(input);
  assert.strictEqual(result.categories.length, 1);
});

test("deduplicates categories by id (keeps first)", function () {
  const input = {
    categories: [
      { id: "cat", title: "First" },
      { id: "cat", title: "Second" },
    ],
    commands: [],
  };
  const result = normalizeCommandsData(input);
  assert.strictEqual(result.categories.length, 1);
  assert.strictEqual(result.categories[0].title, "First");
});

test("normalizes a valid command correctly", function () {
  const input = {
    categories: [{ id: "git", title: "Git" }],
    commands: [
      {
        id: "git-push",
        title: "Push",
        description: "Push to remote",
        command: "git push origin {branch}",
        categoryId: "git",
      },
    ],
  };
  const result = normalizeCommandsData(input);
  assert.strictEqual(result.commands.length, 1);
  assert.strictEqual(result.commands[0].id, "git-push");
  assert.strictEqual(result.commands[0].command, "git push origin {branch}");
});

test("drops commands with missing required fields", function () {
  const input = {
    categories: [{ id: "git", title: "Git" }],
    commands: [
      { id: "no-title", command: "git status", categoryId: "git" },
      { id: "no-command", title: "Status", categoryId: "git" },
      { id: "no-cat-id", title: "Push", command: "git push" },
    ],
  };
  const result = normalizeCommandsData(input);
  assert.strictEqual(result.commands.length, 0);
});

test("drops commands referencing a non-existent categoryId", function () {
  const input = {
    categories: [{ id: "git", title: "Git" }],
    commands: [{ id: "cmd1", title: "Push", command: "git push", categoryId: "nonexistent" }],
  };
  const result = normalizeCommandsData(input);
  assert.strictEqual(result.commands.length, 0);
});

test("deduplicates commands by id (keeps first)", function () {
  const input = {
    categories: [{ id: "git", title: "Git" }],
    commands: [
      { id: "cmd", title: "First", command: "git pull", categoryId: "git" },
      { id: "cmd", title: "Second", command: "git push", categoryId: "git" },
    ],
  };
  const result = normalizeCommandsData(input);
  assert.strictEqual(result.commands.length, 1);
  assert.strictEqual(result.commands[0].title, "First");
});

test("drops groupId when the group does not exist in the category", function () {
  const input = {
    categories: [{ id: "git", title: "Git", groups: [{ id: "local", title: "Local" }] }],
    commands: [{ id: "cmd1", title: "Push", command: "git push", categoryId: "git", groupId: "nonexistent" }],
  };
  const result = normalizeCommandsData(input);
  assert.strictEqual(result.commands[0].groupId, "");
});

test("resolves groupId from legacy groupIds[] (first valid entry)", function () {
  const input = {
    categories: [{ id: "git", title: "Git", groups: [{ id: "remote", title: "Remote" }] }],
    commands: [
      {
        id: "cmd1",
        title: "Push",
        command: "git push",
        categoryId: "git",
        groupIds: ["remote"],
      },
    ],
  };
  const result = normalizeCommandsData(input);
  assert.strictEqual(result.commands[0].groupId, "remote");
});

test("preserves lastRunAt and runCount when valid", function () {
  const input = {
    categories: [{ id: "git", title: "Git" }],
    commands: [
      {
        id: "cmd1",
        title: "Push",
        command: "git push",
        categoryId: "git",
        lastRunAt: "2026-01-01T00:00:00.000Z",
        runCount: 5,
      },
    ],
  };
  const result = normalizeCommandsData(input);
  assert.strictEqual(result.commands[0].lastRunAt, "2026-01-01T00:00:00.000Z");
  assert.strictEqual(result.commands[0].runCount, 5);
});

test("omits lastRunAt and runCount when not provided", function () {
  const input = {
    categories: [{ id: "git", title: "Git" }],
    commands: [{ id: "cmd1", title: "Push", command: "git push", categoryId: "git" }],
  };
  const result = normalizeCommandsData(input);
  assert.strictEqual(result.commands[0].lastRunAt, undefined);
  assert.strictEqual(result.commands[0].runCount, undefined);
});

test("preserves helpUrl when it is a non-empty string", function () {
  const input = {
    categories: [{ id: "git", title: "Git" }],
    commands: [{ id: "cmd1", title: "Push", command: "git push", categoryId: "git", helpUrl: "https://git-scm.com" }],
  };
  const result = normalizeCommandsData(input);
  assert.strictEqual(result.commands[0].helpUrl, "https://git-scm.com");
});

test("omits helpUrl when empty", function () {
  const input = {
    categories: [{ id: "git", title: "Git" }],
    commands: [{ id: "cmd1", title: "Push", command: "git push", categoryId: "git", helpUrl: "" }],
  };
  const result = normalizeCommandsData(input);
  assert.strictEqual(result.commands[0].helpUrl, undefined);
});

test("normalizes groups within categories", function () {
  const input = {
    categories: [{ id: "git", title: "Git", groups: ["remote", "local"] }],
    commands: [],
  };
  const result = normalizeCommandsData(input);
  assert.strictEqual(result.categories[0].groups.length, 2);
  assert.strictEqual(result.categories[0].groups[0].id, "remote");
});

test("always returns version: 1", function () {
  assert.strictEqual(normalizeCommandsData({}).version, 1);
  assert.strictEqual(normalizeCommandsData(null).version, 1);
});

// ---------------------------------------------------------------------------
// Results
// ---------------------------------------------------------------------------

const SEP = "─".repeat(55);

console.log("\n" + SEP);
console.log(`  Total : ${passed + failed}`);
console.log(`  Passed: ${passed}`);
console.log(`  Failed: ${failed}`);
console.log(SEP);

if (failed > 0) {
  process.exit(1);
}
