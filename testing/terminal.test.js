/*-------------------------------------------------
 * RunBox — VS Code Extension
 * Copyright (c) 2026 Abdulla Aldosari
 * Licensed under the MIT License.
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
const vscodeMock = require("./mocks/vscode.js");
const { fixShellPath, findDuplicateShellProfiles, detectShellType, isShellProcessBusy, classifyTerminalBusy, pickIdleTerminal, initTerminalTracking } = require("../lib/terminal");

// ---------------------------------------------------------------------------
// Simple test runner
// ---------------------------------------------------------------------------

let passed = 0;
let failed = 0;
const pendingAsyncTests = [];

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

// Async tests run in registration order after all sync tests; results are
// printed as they settle and counted before the final summary.
function testAsync(description, fn) {
  pendingAsyncTests.push({ description, fn });
}

// Section header for async tests, printed when the queue reaches it.
function asyncSection(name) {
  pendingAsyncTests.push({ sectionName: name });
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
// isShellProcessBusy
// ---------------------------------------------------------------------------

section("isShellProcessBusy");

// Process trees below mirror what was observed from real shells on Windows.
function proc(pid, ppid, name) {
  return { pid, ppid, name };
}

test("idle pwsh (only conhost below it) is not busy", function () {
  const tree = [proc(10, 1, "pwsh.exe"), proc(11, 10, "conhost.exe")];
  assert.strictEqual(isShellProcessBusy(10, tree, "win32"), false);
});

test("pwsh running a foreground command is busy", function () {
  const tree = [proc(10, 1, "pwsh.exe"), proc(11, 10, "conhost.exe"), proc(12, 10, "node.exe")];
  assert.strictEqual(isShellProcessBusy(10, tree, "win32"), true);
});

test("cmd running a foreground command is busy; idle cmd is not", function () {
  const idle = [proc(10, 1, "cmd.exe"), proc(11, 10, "conhost.exe")];
  const busy = [...idle, proc(12, 10, "node.exe")];
  assert.strictEqual(isShellProcessBusy(10, idle, "win32"), false);
  assert.strictEqual(isShellProcessBusy(10, busy, "win32"), true);
});

test("a command nested several levels deep still counts as busy", function () {
  const tree = [proc(10, 1, "pwsh.exe"), proc(11, 10, "npm.cmd"), proc(12, 11, "node.exe")];
  assert.strictEqual(isShellProcessBusy(10, tree, "win32"), true);
});

test("OpenConsole helper is ignored like conhost", function () {
  const tree = [proc(10, 1, "pwsh.exe"), proc(11, 10, "OpenConsole.exe")];
  assert.strictEqual(isShellProcessBusy(10, tree, "win32"), false);
});

test("unrelated processes elsewhere in the table do not make the shell busy", function () {
  const tree = [proc(10, 1, "pwsh.exe"), proc(20, 1, "node.exe"), proc(21, 20, "node.exe")];
  assert.strictEqual(isShellProcessBusy(10, tree, "win32"), false);
});

test("Windows Git Bash launcher: one bash child is idle", function () {
  const tree = [proc(10, 1, "bash.exe"), proc(11, 10, "conhost.exe"), proc(12, 10, "bash.exe")];
  assert.strictEqual(isShellProcessBusy(10, tree, "win32"), false);
});

test("Windows Git Bash launcher: a running command is busy", function () {
  const tree = [proc(10, 1, "bash.exe"), proc(11, 10, "conhost.exe"), proc(12, 10, "bash.exe"), proc(13, 12, "bash.exe"), proc(14, 13, "node.exe")];
  assert.strictEqual(isShellProcessBusy(10, tree, "win32"), true);
});

test("bash on Linux: a single bash child is a running command, not a launcher", function () {
  const tree = [proc(10, 1, "bash"), proc(11, 10, "bash")];
  assert.strictEqual(isShellProcessBusy(10, tree, "linux"), true);
});

test("wsl returns null because Linux processes are invisible to Windows", function () {
  const tree = [proc(10, 1, "wsl.exe"), proc(11, 10, "wsl.exe")];
  assert.strictEqual(isShellProcessBusy(10, tree, "win32"), null);
});

test("returns null when the shell process is missing from the snapshot", function () {
  assert.strictEqual(isShellProcessBusy(99, [proc(10, 1, "pwsh.exe")], "win32"), null);
});

test("a cyclic parent chain does not loop forever", function () {
  const tree = [proc(10, 11, "pwsh.exe"), proc(11, 10, "node.exe")];
  assert.strictEqual(isShellProcessBusy(10, tree, "linux"), true);
});

// ---------------------------------------------------------------------------
// classifyTerminalBusy
// ---------------------------------------------------------------------------

section("classifyTerminalBusy");

function signals(overrides) {
  return { exited: false, running: false, integrationTrusted: false, processBusy: null, ...overrides };
}

test("an exited terminal is busy", function () {
  assert.strictEqual(classifyTerminalBusy(signals({ exited: true, processBusy: false })), "busy");
});

test("a command reported running by shell integration is busy", function () {
  assert.strictEqual(classifyTerminalBusy(signals({ running: true, integrationTrusted: true })), "busy");
});

test("a trusted shell-integration terminal with no running command is idle", function () {
  assert.strictEqual(classifyTerminalBusy(signals({ integrationTrusted: true })), "idle");
});

test("without trusted integration the process tree decides", function () {
  assert.strictEqual(classifyTerminalBusy(signals({ processBusy: true })), "busy");
  assert.strictEqual(classifyTerminalBusy(signals({ processBusy: false })), "idle");
});

test("no signal at all is unknown", function () {
  assert.strictEqual(classifyTerminalBusy(signals({})), "unknown");
});

// ---------------------------------------------------------------------------
// pickIdleTerminal
// ---------------------------------------------------------------------------

asyncSection("pickIdleTerminal");

function makeTerminal(pid, extra) {
  return { exitStatus: undefined, shellIntegration: undefined, processId: Promise.resolve(pid), ...extra };
}

function noSnapshot() {
  return Promise.resolve(null);
}

function snapshotOf(processes) {
  return function () {
    return Promise.resolve(processes);
  };
}

testAsync("returns undefined when there are no candidates", async function () {
  assert.strictEqual(await pickIdleTerminal([], noSnapshot), undefined);
});

testAsync("skips a busy terminal and returns the idle one (server terminal is not reused)", async function () {
  const serverTerminal = makeTerminal(10);
  const freeTerminal = makeTerminal(20);
  const snapshot = [proc(10, 1, "pwsh.exe"), proc(11, 10, "node.exe"), proc(20, 1, "pwsh.exe"), proc(21, 20, "conhost.exe")];
  const picked = await pickIdleTerminal([serverTerminal, freeTerminal], snapshotOf(snapshot));
  assert.strictEqual(picked, freeTerminal);
});

testAsync("returns undefined when every candidate is busy so a new terminal is created", async function () {
  const snapshot = [proc(10, 1, "pwsh.exe"), proc(11, 10, "node.exe")];
  assert.strictEqual(await pickIdleTerminal([makeTerminal(10)], snapshotOf(snapshot)), undefined);
});

testAsync("a terminal whose state is unknown (no pid) is never reused", async function () {
  assert.strictEqual(await pickIdleTerminal([makeTerminal(undefined)], noSnapshot), undefined);
});

testAsync("a terminal is not reused when the process snapshot is unavailable", async function () {
  assert.strictEqual(await pickIdleTerminal([makeTerminal(10)], noSnapshot), undefined);
});

testAsync("an exited terminal is never reused", async function () {
  const snapshot = [proc(10, 1, "pwsh.exe")];
  const picked = await pickIdleTerminal([makeTerminal(10, { exitStatus: { code: 0 } })], snapshotOf(snapshot));
  assert.strictEqual(picked, undefined);
});

testAsync("the process snapshot is read at most once for many candidates", async function () {
  let reads = 0;
  const snapshot = [proc(10, 1, "pwsh.exe"), proc(11, 10, "node.exe"), proc(20, 1, "pwsh.exe"), proc(21, 20, "node.exe")];
  await pickIdleTerminal([makeTerminal(10), makeTerminal(20)], function () {
    reads++;
    return Promise.resolve(snapshot);
  });
  assert.strictEqual(reads, 1);
});

// ---------------------------------------------------------------------------
// initTerminalTracking (shell integration events)
// ---------------------------------------------------------------------------

asyncSection("initTerminalTracking");

testAsync("shell integration events decide without reading a process snapshot", async function () {
  const handlers = {};
  const noop = { dispose: function () {} };
  vscodeMock.window.onDidStartTerminalShellExecution = function (cb) {
    handlers.start = cb;
    return noop;
  };
  vscodeMock.window.onDidEndTerminalShellExecution = function (cb) {
    handlers.end = cb;
    return noop;
  };
  vscodeMock.window.onDidCloseTerminal = function (cb) {
    handlers.close = cb;
    return noop;
  };

  const subscriptions = [];
  initTerminalTracking({ subscriptions });

  const forbidSnapshot = function () {
    throw new Error("snapshot must not be read when shell integration answers");
  };
  const integration = {};
  const server = makeTerminal(10, { shellIntegration: integration });
  const free = makeTerminal(20, { shellIntegration: integration });

  // `free` completes one command, so shell integration is proven for it.
  handlers.start({ terminal: free });
  handlers.end({ terminal: free });
  // `server` starts a command that does not end.
  handlers.start({ terminal: server });

  assert.strictEqual(await pickIdleTerminal([server, free], forbidSnapshot), free);

  // Once the server command ends, the same terminal is reusable.
  handlers.end({ terminal: server });
  assert.strictEqual(await pickIdleTerminal([server], forbidSnapshot), server);

  // Closing a terminal forgets it: it is no longer trusted as proven idle.
  handlers.close(server);
  assert.strictEqual(await pickIdleTerminal([server], noSnapshot), undefined);

  subscriptions.forEach(function (s) {
    s.dispose();
  });
  delete vscodeMock.window.onDidStartTerminalShellExecution;
  delete vscodeMock.window.onDidEndTerminalShellExecution;
  delete vscodeMock.window.onDidCloseTerminal;
});

testAsync("initTerminalTracking does nothing harmful when the shell integration API is absent", async function () {
  const subscriptions = [];
  initTerminalTracking({ subscriptions });
  assert.strictEqual(subscriptions.length, 1);
  subscriptions[0].dispose();
});

// ---------------------------------------------------------------------------
// Results
// ---------------------------------------------------------------------------

async function runAsyncTestsAndReport() {
  for (const { description, fn, sectionName } of pendingAsyncTests) {
    if (sectionName) {
      section(sectionName);
      continue;
    }
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

  const SEP = "─".repeat(55);

  console.log("\n" + SEP);
  console.log(`  Total : ${passed + failed}`);
  console.log(`  Passed: ${passed}`);
  console.log(`  Failed: ${failed}`);
  console.log(SEP);

  if (failed > 0) {
    process.exit(1);
  }
}

runAsyncTestsAndReport();
