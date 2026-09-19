/*-------------------------------------------------
 * RunBox — VS Code Extension
 * Copyright (c) 2026 Abdulla Aldosari
 * Licensed under the Apache License, Version 2.0.
 * See LICENSE in the project root for details.
 *-------------------------------------------------*/

// testing/storage.test.js
// Unit tests for the pure functions in lib/storage.js.
// Only normalizeLocalWorkspaceDir is testable without a VS Code runtime.
// Run with: node testing/storage.test.js

"use strict";

// Inject vscode mock before requiring lib/storage.js (which requires "vscode")
const Module = require("module");
const originalResolveFilename = Module._resolveFilename;
Module._resolveFilename = function (request, ...args) {
  if (request === "vscode") {
    return require.resolve("./mocks/vscode.js");
  }
  return originalResolveFilename.call(this, request, ...args);
};

const assert = require("assert");
const { normalizeLocalWorkspaceDir } = require("../lib/storage");

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
// normalizeLocalWorkspaceDir
// ---------------------------------------------------------------------------

section("normalizeLocalWorkspaceDir");

test("returns '.vscode' for an empty string", function () {
  assert.strictEqual(normalizeLocalWorkspaceDir(""), ".vscode");
});

test("returns '.vscode' for null", function () {
  assert.strictEqual(normalizeLocalWorkspaceDir(null), ".vscode");
});

test("returns '.vscode' for undefined", function () {
  assert.strictEqual(normalizeLocalWorkspaceDir(undefined), ".vscode");
});

test("returns '.vscode' for a whitespace-only string", function () {
  assert.strictEqual(normalizeLocalWorkspaceDir("   "), ".vscode");
});

test("trims leading and trailing whitespace", function () {
  assert.strictEqual(normalizeLocalWorkspaceDir("  .temp  "), ".temp");
});

test("converts backslashes to forward slashes (Windows-style input)", function () {
  assert.strictEqual(normalizeLocalWorkspaceDir(".vsenv\\runbox"), ".vsenv/runbox");
});

test("converts multiple backslashes to forward slashes", function () {
  assert.strictEqual(normalizeLocalWorkspaceDir("a\\b\\c"), "a/b/c");
});

test("leaves forward slashes unchanged", function () {
  assert.strictEqual(normalizeLocalWorkspaceDir(".temp/runbox"), ".temp/runbox");
});

test("leaves a value with no separators unchanged", function () {
  assert.strictEqual(normalizeLocalWorkspaceDir(".temp"), ".temp");
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
