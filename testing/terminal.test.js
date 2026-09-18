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
const { fixShellPath, findDuplicateShellProfiles, detectShellType } = require("../lib/terminal");

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
// findDuplicateShellProfiles
// ---------------------------------------------------------------------------

section("findDuplicateShellProfiles");

test("returns an empty array when there is no duplication", function () {
  const profiles = [
    { name: "PowerShell", shellPath: "C:\\pwsh.exe" },
    { name: "Command Prompt", shellPath: "C:\\cmd.exe" },
  ];
  assert.deepStrictEqual(findDuplicateShellProfiles(profiles), []);
});

test("returns an empty array for an empty profiles list", function () {
  assert.deepStrictEqual(findDuplicateShellProfiles([]), []);
});

test("returns an empty array for null/undefined input", function () {
  assert.deepStrictEqual(findDuplicateShellProfiles(null), []);
  assert.deepStrictEqual(findDuplicateShellProfiles(undefined), []);
});

test("groups two profile names sharing the exact same shellPath", function () {
  const profiles = [
    { name: "PowerShell", shellPath: "C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe" },
    { name: "Windows PowerShell", shellPath: "C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe" },
  ];
  assert.deepStrictEqual(findDuplicateShellProfiles(profiles), [["PowerShell", "Windows PowerShell"]]);
});

test("groups three or more profile names sharing the exact same shellPath", function () {
  const profiles = [
    { name: "A", shellPath: "C:\\shared.exe" },
    { name: "B", shellPath: "C:\\shared.exe" },
    { name: "C", shellPath: "C:\\shared.exe" },
  ];
  assert.deepStrictEqual(findDuplicateShellProfiles(profiles), [["A", "B", "C"]]);
});

test("returns multiple independent duplicate groups", function () {
  const profiles = [
    { name: "PowerShell", shellPath: "C:\\powershell.exe" },
    { name: "Windows PowerShell", shellPath: "C:\\powershell.exe" },
    { name: "CMD 1", shellPath: "C:\\cmd.exe" },
    { name: "CMD 2", shellPath: "C:\\cmd.exe" },
    { name: "Git Bash", shellPath: "C:\\bash.exe" },
  ];
  assert.deepStrictEqual(findDuplicateShellProfiles(profiles), [
    ["PowerShell", "Windows PowerShell"],
    ["CMD 1", "CMD 2"],
  ]);
});

test("ignores profiles with a missing or empty shellPath", function () {
  const profiles = [{ name: "A", shellPath: "" }, { name: "B", shellPath: null }, { name: "C" }];
  assert.deepStrictEqual(findDuplicateShellProfiles(profiles), []);
});

test("ignores null/undefined entries within the profiles array", function () {
  const profiles = [null, undefined, { name: "A", shellPath: "C:\\a.exe" }, { name: "B", shellPath: "C:\\a.exe" }];
  assert.deepStrictEqual(findDuplicateShellProfiles(profiles), [["A", "B"]]);
});

// ---------------------------------------------------------------------------
// detectShellType
// ---------------------------------------------------------------------------

section("detectShellType");

test('classifies "pwsh.exe" as "pwsh" (PowerShell 7+)', function () {
  assert.strictEqual(detectShellType("C:\\Program Files\\PowerShell\\7\\pwsh.exe"), "pwsh");
});

test('classifies a WinGet/MSIX "pwsh.exe" alias path as "pwsh"', function () {
  assert.strictEqual(detectShellType("C:\\Users\\test\\AppData\\Local\\Microsoft\\WindowsApps\\pwsh.exe"), "pwsh");
});

test('classifies "powershell.exe" as "powershell" (Windows PowerShell 5.1)', function () {
  assert.strictEqual(detectShellType("C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe"), "powershell");
});

test('does not classify "pwsh.exe" as "powershell" (distinct from Windows PowerShell)', function () {
  assert.notStrictEqual(detectShellType("C:\\Program Files\\PowerShell\\7\\pwsh.exe"), "powershell");
});

test('classifies "cmd.exe" as "cmd"', function () {
  assert.strictEqual(detectShellType("C:\\Windows\\System32\\cmd.exe"), "cmd");
});

test('classifies a WSL path as "wsl"', function () {
  assert.strictEqual(detectShellType("C:\\Windows\\System32\\wsl.exe"), "wsl");
});

test('classifies a Git Bash path as "bash"', function () {
  assert.strictEqual(detectShellType("C:\\Program Files\\Git\\bin\\bash.exe"), "bash");
});

test('classifies a zsh path as "zsh"', function () {
  assert.strictEqual(detectShellType("/usr/bin/zsh"), "zsh");
});

test('classifies "sh" and "sh.exe" as "sh"', function () {
  assert.strictEqual(detectShellType("/bin/sh"), "sh");
  assert.strictEqual(detectShellType("C:\\sh.exe"), "sh");
});

test("returns null for an unrecognized shell path", function () {
  assert.strictEqual(detectShellType("C:\\Program Files\\SomeOtherShell\\shell.exe"), null);
});

test("returns null for non-string input", function () {
  assert.strictEqual(detectShellType(null), null);
  assert.strictEqual(detectShellType(undefined), null);
  assert.strictEqual(detectShellType(42), null);
});

test("returns null for an empty string", function () {
  assert.strictEqual(detectShellType(""), null);
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
