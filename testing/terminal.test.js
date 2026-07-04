/*-------------------------------------------------
 * RunBox — VS Code Extension
 * Copyright (c) 2026 Abdulla Aldosari
 * Licensed under the Apache License, Version 2.0.
 * See LICENSE in the project root for details.
 *-------------------------------------------------*/

// testing/terminal.test.js
// Unit tests for the pure functions in lib/terminal.js.
// Only fixShellPath is testable without a VS Code runtime.
// Run with: node testing/terminal.test.js

"use strict";

// Inject vscode mock before requiring lib/terminal.js (which requires "vscode")
const Module = require("module");
const originalResolveFilename = Module._resolveFilename;
Module._resolveFilename = function (request, ...args) {
  if (request === "vscode") {
    return require.resolve("./mocks/vscode.js");
  }
  return originalResolveFilename.call(this, request, ...args);
};

const assert = require("assert");
const { fixShellPath } = require("../lib/terminal");

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
// fixShellPath
// ---------------------------------------------------------------------------

section("fixShellPath");

test("replaces \\Sysnative\\ with \\System32\\ (exact casing)", function () {
  assert.strictEqual(fixShellPath("C:\\Windows\\Sysnative\\cmd.exe"), "C:\\Windows\\System32\\cmd.exe");
});

test("replaces \\sysnative\\ with \\System32\\ (all lowercase — case-insensitive)", function () {
  assert.strictEqual(fixShellPath("C:\\Windows\\sysnative\\cmd.exe"), "C:\\Windows\\System32\\cmd.exe");
});

test("replaces \\SYSNATIVE\\ with \\System32\\ (all uppercase — case-insensitive)", function () {
  assert.strictEqual(fixShellPath("C:\\Windows\\SYSNATIVE\\cmd.exe"), "C:\\Windows\\System32\\cmd.exe");
});

test("does not alter a path that already contains System32", function () {
  const path = "C:\\Windows\\System32\\cmd.exe";
  assert.strictEqual(fixShellPath(path), path);
});

test("does not alter an unrelated path", function () {
  const path = "C:\\Program Files\\Git\\bin\\bash.exe";
  assert.strictEqual(fixShellPath(path), path);
});

test("returns null as-is (non-string input)", function () {
  assert.strictEqual(fixShellPath(null), null);
});

test("returns undefined as-is (non-string input)", function () {
  assert.strictEqual(fixShellPath(undefined), undefined);
});

test("returns a number as-is (non-string input)", function () {
  assert.strictEqual(fixShellPath(42), 42);
});

test("returns an empty string unchanged", function () {
  assert.strictEqual(fixShellPath(""), "");
});

test("handles a path where Sysnative appears in a non-separator context (no replacement)", function () {
  // "Sysnative" without surrounding backslashes should NOT be replaced
  const path = "C:\\MySysnativeFolder\\cmd.exe";
  assert.strictEqual(fixShellPath(path), path);
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
