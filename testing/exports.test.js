/*-------------------------------------------------
 * Terminal Recipes — VS Code Extension
 * Copyright (c) 2026 Abdulla Aldosari
 * Licensed under the Apache License, Version 2.0.
 * See LICENSE in the project root for details.
 *-------------------------------------------------*/

// testing/exports.test.js
// Verifies that every lib/ module exports the exact set of functions and constants
// defined in refactor_plan.md.  Uses a vscode mock so modules can be required
// outside the VS Code runtime.
// Run with: node testing/exports.test.js

"use strict";

// ---------------------------------------------------------------------------
// Inject vscode mock before any lib/ require
// ---------------------------------------------------------------------------

const Module = require("module");
const originalResolveFilename = Module._resolveFilename;
Module._resolveFilename = function (request, ...args) {
  if (request === "vscode") {
    return require.resolve("./mocks/vscode.js");
  }
  return originalResolveFilename.call(this, request, ...args);
};

const assert = require("assert");

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

/**
 * Asserts that a module exports a named function.
 * @param {object} mod - The required module
 * @param {string} name - Export name
 */
function expectFn(mod, name) {
  test(`exports "${name}" as a function`, function () {
    assert.strictEqual(typeof mod[name], "function", `"${name}" should be a function but got ${typeof mod[name]}`);
  });
}

/**
 * Asserts that a module exports a named constant (non-undefined, non-function).
 * @param {object} mod - The required module
 * @param {string} name - Export name
 */
function expectConst(mod, name) {
  test(`exports "${name}" as a constant (string or object, not undefined)`, function () {
    assert.notStrictEqual(mod[name], undefined, `"${name}" should be exported but is undefined`);
    assert.notStrictEqual(typeof mod[name], "function", `"${name}" should be a constant, not a function`);
  });
}

// ---------------------------------------------------------------------------
// lib/normalize.js
// ---------------------------------------------------------------------------

section("lib/normalize.js");

const normalize = require("../lib/normalize");

expectFn(normalize, "sanitizeId");
expectFn(normalize, "sanitizeTitle");
expectFn(normalize, "getDefaultCommandsData");
expectFn(normalize, "normalizeCommandsData");
expectFn(normalize, "normalizeVariablesSection");
expectFn(normalize, "normalizeFavoritesSection");
expectFn(normalize, "normalizeDataFile");
expectFn(normalize, "normalizeGroups");
expectFn(normalize, "normalizeVariableMeta");
expectConst(normalize, "VALID_TARGET_SHELLS");
expectConst(normalize, "DATA_SECTIONS");

test("has exactly 11 exports", function () {
  const keys = Object.keys(normalize);
  assert.strictEqual(keys.length, 11, `Expected 11 exports, got ${keys.length}: ${keys.join(", ")}`);
});

// ---------------------------------------------------------------------------
// lib/terminal.js
// ---------------------------------------------------------------------------

section("lib/terminal.js");

const terminal = require("../lib/terminal");

expectFn(terminal, "fixShellPath");
expectFn(terminal, "resolveSourceProfilePath");
expectFn(terminal, "getTerminalProfiles");
expectFn(terminal, "getOrCreateTerminal");
expectFn(terminal, "detectShellType");

test("has exactly 5 exports", function () {
  const keys = Object.keys(terminal);
  assert.strictEqual(keys.length, 5, `Expected 5 exports, got ${keys.length}: ${keys.join(", ")}`);
});

// ---------------------------------------------------------------------------
// lib/storage.js
// ---------------------------------------------------------------------------

section("lib/storage.js");

const storage = require("../lib/storage");

// Constants
expectConst(storage, "GLOBAL_DIR");
expectConst(storage, "GLOBAL_COMMANDS_FILE");
expectConst(storage, "GLOBAL_DATA_FILE");
expectConst(storage, "GLOBAL_AUTO_VARIABLES_SETTINGS_FILE");

// Functions
expectFn(storage, "fileExists");
expectFn(storage, "getFirstWorkspaceFolderPath");
expectFn(storage, "getAllWorkspaceFolders");
expectFn(storage, "resolveActiveWorkspaceFolder");
expectFn(storage, "getWorkspaceDataFilePath");
expectFn(storage, "ensureGlobalCommandsFile");
expectFn(storage, "readCommandsData");
expectFn(storage, "writeCommandsData");
expectFn(storage, "readDataFile");

expectFn(storage, "writeDataFile");
expectFn(storage, "readWorkspaceVariables");
expectFn(storage, "writeWorkspaceVariables");
expectFn(storage, "readGlobalVariables");
expectFn(storage, "writeGlobalVariables");
expectFn(storage, "readAutoVariablesSettings");
expectFn(storage, "writeAutoVariablesSettings");
expectFn(storage, "readGlobalFavorites");
expectFn(storage, "readWorkspaceFavorites");
expectFn(storage, "writeGlobalFavorites");
expectFn(storage, "writeWorkspaceFavorites");

test("has exactly 24 exports (4 constants + 20 functions)", function () {
  const keys = Object.keys(storage);
  assert.strictEqual(keys.length, 24, `Expected 24 exports, got ${keys.length}: ${keys.join(", ")}`);
});

// Spot-check path constant values
test("GLOBAL_DIR contains '.vscode-terminal-recipes'", function () {
  assert.ok(storage.GLOBAL_DIR.includes(".vscode-terminal-recipes"), `GLOBAL_DIR = "${storage.GLOBAL_DIR}"`);
});

test("GLOBAL_COMMANDS_FILE ends with 'commands.json'", function () {
  assert.ok(
    storage.GLOBAL_COMMANDS_FILE.endsWith("commands.json"),
    `GLOBAL_COMMANDS_FILE = "${storage.GLOBAL_COMMANDS_FILE}"`
  );
});

test("GLOBAL_DATA_FILE ends with 'data.json'", function () {
  assert.ok(storage.GLOBAL_DATA_FILE.endsWith("data.json"), `GLOBAL_DATA_FILE = "${storage.GLOBAL_DATA_FILE}"`);
});

// ---------------------------------------------------------------------------
// lib/handlers.js
// ---------------------------------------------------------------------------

section("lib/handlers.js");

const handlers = require("../lib/handlers");

expectFn(handlers, "handleSaveCommandsData");
expectFn(handlers, "handleSaveCommandVariables");

expectFn(handlers, "handlePerformAction");
expectFn(handlers, "handleOpenExternalUrl");
expectFn(handlers, "openGlobalCommandsFile");
expectFn(handlers, "openGlobalDataFile");
expectFn(handlers, "openLocalDataFile");

expectFn(handlers, "handleAiGetSettings");
expectFn(handlers, "handleAiSaveSettings");
expectFn(handlers, "handleAiGenerate");
expectFn(handlers, "handleAiInsert");
expectFn(handlers, "handleSaveAutoVariablesSettings");
expectFn(handlers, "handleSaveFavorites");
expectFn(handlers, "handleAiListModels");
expectFn(handlers, "handleAiRefreshAllModels");
expectFn(handlers, "handleAiDeleteKey");
expectFn(handlers, "handleAiExplain");

test("has exactly 17 exports", function () {
  const keys = Object.keys(handlers);
  assert.strictEqual(keys.length, 17, `Expected 17 exports, got ${keys.length}: ${keys.join(", ")}`);
});

// ---------------------------------------------------------------------------
// lib/auto-variables.js
// ---------------------------------------------------------------------------

section("lib/auto-variables.js");

const autoVars = require("../lib/auto-variables");

expectFn(autoVars, "resolveAutoVariables");
expectFn(autoVars, "buildAutoVariablesPayload");

test("has exactly 2 exports", function () {
  const keys = Object.keys(autoVars);
  assert.strictEqual(keys.length, 2, `Expected 2 exports, got ${keys.length}: ${keys.join(", ")}`);
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
