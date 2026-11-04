/*-------------------------------------------------
 * RunBox — VS Code Extension
 * Copyright (c) 2026 Abdulla Aldosari
 * Licensed under the MIT License.
 * See LICENSE in the project root for details.
 *-------------------------------------------------*/

// testing/storage.test.js
// Unit tests for lib/storage.js that run without a VS Code runtime:
// normalizeLocalWorkspaceDir, plus the cross-window favorites merge, exercised
// against a temporary workspace folder (never the real ~/.runbox directory).
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
const fs = require("fs");
const os = require("os");
const path = require("path");
const {
  normalizeLocalWorkspaceDir,
  setWorkspaceFavorite,
  readWorkspaceFavorites,
  setWorkspaceCommandVariables,
  readWorkspaceVariables,
  getWorkspaceDataFilePath,
} = require("../lib/storage");

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
// Favorites merge (cross-window safety)
// ---------------------------------------------------------------------------

async function asyncTest(description, fn) {
  try {
    await fn();
    console.log(`  ✓  ${description}`);
    passed++;
  } catch (err) {
    console.error(`  ✗  ${description}`);
    console.error(`       ${err.message}`);
    failed++;
  }
}

async function runFavoritesTests() {
  section("setWorkspaceFavorite (merge into freshest on-disk copy)");

  const workspaceDir = fs.mkdtempSync(path.join(os.tmpdir(), "runbox-fav-test-"));
  try {
    await asyncTest("removing from a missing file is a no-op and creates nothing", async function () {
      const wasCreated = await setWorkspaceFavorite("cmd-a", false, workspaceDir);
      assert.strictEqual(wasCreated, false);
      assert.strictEqual(fs.existsSync(getWorkspaceDataFilePath(workspaceDir)), false);
    });

    await asyncTest("adding to a missing file creates it and reports wasCreated", async function () {
      const wasCreated = await setWorkspaceFavorite("cmd-a", true, workspaceDir);
      assert.strictEqual(wasCreated, true);
      assert.deepStrictEqual(await readWorkspaceFavorites(workspaceDir), ["cmd-a"]);
    });

    await asyncTest("keeps a favorite another window wrote after this window last read the file", async function () {
      // Simulates window B adding "cmd-b" directly on disk while window A
      // still holds the stale list ["cmd-a"] in memory.
      const filePath = getWorkspaceDataFilePath(workspaceDir);
      const onDisk = JSON.parse(fs.readFileSync(filePath, "utf8"));
      onDisk.favorites.commandIds.push("cmd-b");
      fs.writeFileSync(filePath, JSON.stringify(onDisk, null, 2), "utf8");

      // Window A now adds "cmd-c": only the change is sent, never its stale list.
      await setWorkspaceFavorite("cmd-c", true, workspaceDir);
      assert.deepStrictEqual(await readWorkspaceFavorites(workspaceDir), ["cmd-a", "cmd-b", "cmd-c"]);
    });

    await asyncTest("adding an existing favorite does not duplicate or reorder it", async function () {
      await setWorkspaceFavorite("cmd-a", true, workspaceDir);
      assert.deepStrictEqual(await readWorkspaceFavorites(workspaceDir), ["cmd-a", "cmd-b", "cmd-c"]);
    });

    await asyncTest("removing one favorite leaves all others untouched", async function () {
      await setWorkspaceFavorite("cmd-b", false, workspaceDir);
      assert.deepStrictEqual(await readWorkspaceFavorites(workspaceDir), ["cmd-a", "cmd-c"]);
    });

    await asyncTest("preserves the other sections of the data file", async function () {
      const filePath = getWorkspaceDataFilePath(workspaceDir);
      const onDisk = JSON.parse(fs.readFileSync(filePath, "utf8"));
      onDisk.variables = { commands: { "cmd-a": { host: "example.local" } } };
      fs.writeFileSync(filePath, JSON.stringify(onDisk, null, 2), "utf8");

      await setWorkspaceFavorite("cmd-d", true, workspaceDir);
      const after = JSON.parse(fs.readFileSync(filePath, "utf8"));
      assert.deepStrictEqual(after.variables.commands["cmd-a"], { host: "example.local" });
      assert.deepStrictEqual(after.favorites.commandIds, ["cmd-a", "cmd-c", "cmd-d"]);
    });

    await asyncTest("concurrent changes from the same process are all applied", async function () {
      await Promise.all([setWorkspaceFavorite("cmd-e", true, workspaceDir), setWorkspaceFavorite("cmd-f", true, workspaceDir), setWorkspaceFavorite("cmd-a", false, workspaceDir)]);
      assert.deepStrictEqual(await readWorkspaceFavorites(workspaceDir), ["cmd-c", "cmd-d", "cmd-e", "cmd-f"]);
    });

    await asyncTest("returns false when no workspace folder is available", async function () {
      assert.strictEqual(await setWorkspaceFavorite("cmd-a", true, null), false);
    });
  } finally {
    fs.rmSync(workspaceDir, { recursive: true, force: true });
  }
}

async function runCommandVariablesTests() {
  section("setWorkspaceCommandVariables (one command, merged into freshest on-disk copy)");

  const workspaceDir = fs.mkdtempSync(path.join(os.tmpdir(), "runbox-vars-test-"));
  try {
    await asyncTest("clearing a command in a missing file is a no-op and creates nothing", async function () {
      const wasCreated = await setWorkspaceCommandVariables("cmd-x", {}, workspaceDir);
      assert.strictEqual(wasCreated, false);
      assert.strictEqual(fs.existsSync(getWorkspaceDataFilePath(workspaceDir)), false);
    });

    await asyncTest("saving to a missing file creates it and reports wasCreated", async function () {
      const wasCreated = await setWorkspaceCommandVariables("cmd-x", { host: "old" }, workspaceDir);
      assert.strictEqual(wasCreated, true);
      assert.deepStrictEqual((await readWorkspaceVariables(workspaceDir)).commands, { "cmd-x": { host: "old" } });
    });

    await asyncTest("saving one command never reverts a newer value another window saved for another command", async function () {
      // Window B saves a new value for cmd-x directly on disk while window A
      // still holds the old one in memory.
      const filePath = getWorkspaceDataFilePath(workspaceDir);
      const onDisk = JSON.parse(fs.readFileSync(filePath, "utf8"));
      onDisk.variables.commands["cmd-x"] = { host: "new" };
      fs.writeFileSync(filePath, JSON.stringify(onDisk, null, 2), "utf8");

      // Window A now saves cmd-y only: its stale cmd-x value is never sent.
      await setWorkspaceCommandVariables("cmd-y", { port: "22" }, workspaceDir);
      assert.deepStrictEqual((await readWorkspaceVariables(workspaceDir)).commands, { "cmd-x": { host: "new" }, "cmd-y": { port: "22" } });
    });

    await asyncTest("replaces all values of the saved command (a removed variable is dropped)", async function () {
      await setWorkspaceCommandVariables("cmd-y", { user: "root" }, workspaceDir);
      assert.deepStrictEqual((await readWorkspaceVariables(workspaceDir)).commands["cmd-y"], { user: "root" });
    });

    await asyncTest("an empty map deletes only that command's entry", async function () {
      await setWorkspaceCommandVariables("cmd-y", {}, workspaceDir);
      assert.deepStrictEqual((await readWorkspaceVariables(workspaceDir)).commands, { "cmd-x": { host: "new" } });
    });

    await asyncTest("drops non-string values and preserves the favorites section", async function () {
      await setWorkspaceFavorite("cmd-x", true, workspaceDir);
      await setWorkspaceCommandVariables("cmd-z", { ok: "1", bad: 5 }, workspaceDir);
      const after = JSON.parse(fs.readFileSync(getWorkspaceDataFilePath(workspaceDir), "utf8"));
      assert.deepStrictEqual(after.variables.commands["cmd-z"], { ok: "1" });
      assert.deepStrictEqual(after.favorites.commandIds, ["cmd-x"]);
    });

    await asyncTest("returns false when no workspace folder is available", async function () {
      assert.strictEqual(await setWorkspaceCommandVariables("cmd-x", { a: "b" }, null), false);
    });
  } finally {
    fs.rmSync(workspaceDir, { recursive: true, force: true });
  }
}

// ---------------------------------------------------------------------------
// Results
// ---------------------------------------------------------------------------

runFavoritesTests()
  .then(runCommandVariablesTests)
  .then(function () {
    const SEP = "─".repeat(55);

    console.log("\n" + SEP);
    console.log(`  Total : ${passed + failed}`);
    console.log(`  Passed: ${passed}`);
    console.log(`  Failed: ${failed}`);
    console.log(SEP);

    if (failed > 0) {
      process.exit(1);
    }
  });
