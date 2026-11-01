/*-------------------------------------------------
 * RunBox — VS Code Extension
 * Copyright (c) 2026 Abdulla Aldosari
 * Licensed under the MIT License.
 * See LICENSE in the project root for details.
 *-------------------------------------------------*/

// testing/run-shell.test.js
// Unit tests for resolveRunShell() in media/utils.js. The webview script is
// loaded into a vm sandbox that provides the `state` global it reads.
// Run with: node testing/run-shell.test.js

"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");

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

const source = fs.readFileSync(path.resolve(__dirname, "..", "media", "utils.js"), "utf8");

function loadResolveRunShell(terminalProfiles) {
  const sandbox = { state: { terminalProfiles } };
  vm.createContext(sandbox);
  vm.runInContext(`${source}\nthis.resolveRunShell = resolveRunShell;`, sandbox);
  // Results are created inside the vm realm; normalise them so that
  // deepStrictEqual does not fail on a different Object.prototype.
  return function (command) {
    return JSON.parse(JSON.stringify(sandbox.resolveRunShell(command)));
  };
}

const PROFILES = {
  defaultProfile: "Git Bash",
  profiles: [
    { name: "Windows PowerShell", shellPath: "C:\\ps.exe", shellType: "powershell" },
    { name: "Git Bash", shellPath: "C:\\bash.exe", shellType: "bash" },
    { name: "Command Prompt", shellPath: "C:\\cmd.exe", shellType: "cmd" },
  ],
};

console.log("\n── resolveRunShell ──");

test("uses the profile matching the command's own targetShell", function () {
  const resolve = loadResolveRunShell(PROFILES);
  assert.deepStrictEqual(resolve({ targetShell: "powershell" }), { shellName: "Windows PowerShell", shellPath: "C:\\ps.exe" });
});

test("empty targetShell (Any) resolves to the VS Code default profile", function () {
  const resolve = loadResolveRunShell(PROFILES);
  assert.deepStrictEqual(resolve({ targetShell: "" }), { shellName: "Git Bash", shellPath: "C:\\bash.exe" });
  assert.deepStrictEqual(resolve({}), { shellName: "Git Bash", shellPath: "C:\\bash.exe" });
});

test("targetShell without a matching profile falls back to the default profile", function () {
  const resolve = loadResolveRunShell(PROFILES);
  assert.deepStrictEqual(resolve({ targetShell: "zsh" }), { shellName: "Git Bash", shellPath: "C:\\bash.exe" });
});

test("result is independent of previously resolved commands", function () {
  const resolve = loadResolveRunShell(PROFILES);
  resolve({ targetShell: "cmd" });
  assert.strictEqual(resolve({ targetShell: "" }).shellName, "Git Bash");
});

test("falls back to the first profile when the default name is unknown", function () {
  const resolve = loadResolveRunShell({ defaultProfile: "Missing", profiles: PROFILES.profiles });
  assert.strictEqual(resolve({}).shellName, "Windows PowerShell");
});

test("returns nulls when no profile is configured", function () {
  const resolve = loadResolveRunShell({ defaultProfile: "", profiles: [] });
  assert.deepStrictEqual(resolve({ targetShell: "bash" }), { shellName: null, shellPath: null });
});

console.log("\n──────────────────────────────");
console.log(`  Total : ${passed + failed}`);
console.log(`  Passed: ${passed}`);
console.log(`  Failed: ${failed}`);

if (failed > 0) {
  process.exit(1);
}
