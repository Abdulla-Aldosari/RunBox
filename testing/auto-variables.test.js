/*-------------------------------------------------
 * RunBox — VS Code Extension
 * Copyright (c) 2026 Abdulla Aldosari
 * Licensed under the MIT License.
 * See LICENSE in the project root for details.
 *-------------------------------------------------*/

// testing/auto-variables.test.js
// Unit tests for the ${@name} auto variables: resolution and formatting in
// lib/auto-variables.js, and the webview-side substitution/highlighting helpers
// in media/utils.js (loaded into a vm sandbox).
// Run with: node testing/auto-variables.test.js

"use strict";

const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const vm = require("vm");

const { resolveAutoVariables, buildAutoVariablesPayload } = require("../lib/auto-variables");

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

const FOLDER = path.join(os.tmpdir(), "my-project");
const CONTEXT = { workspaceFolder: FOLDER };
// Local time: 2026-03-07 22:45:09
const EVENING = new Date(2026, 2, 7, 22, 45, 9);

function timeWith(format, now) {
  return resolveAutoVariables("${@time}", CONTEXT, { time: { config: { format } } }, now);
}

// ---------------------------------------------------------------------------
// lib/auto-variables.js
// ---------------------------------------------------------------------------

section("resolveAutoVariables: token namespace");

test("resolves ${@name} tokens", function () {
  const out = resolveAutoVariables("cd ${@workspaceFolder} && echo ${@workspaceName} ${@username}", CONTEXT, {}, EVENING);
  assert.strictEqual(out, `cd ${FOLDER} && echo my-project ${os.userInfo().username}`);
});

test("leaves user variables with the same names untouched", function () {
  const template = "echo ${date} ${time} ${workspaceFolder} ${workspaceName} ${username}";
  assert.strictEqual(resolveAutoVariables(template, CONTEXT, {}, EVENING), template);
});

test("leaves unknown ${@name} tokens untouched", function () {
  assert.strictEqual(resolveAutoVariables("echo ${@unknown}", CONTEXT, {}, EVENING), "echo ${@unknown}");
});

test("ignores the legacy enabled:false setting (auto variables are always on)", function () {
  const out = resolveAutoVariables("${@date}", CONTEXT, { date: { enabled: false, config: { format: "YYYY-MM-DD" } } }, EVENING);
  assert.strictEqual(out, "2026-03-07");
});

test("a substituted value containing $ patterns is inserted literally", function () {
  const out = resolveAutoVariables("cd ${@workspaceFolder}", { workspaceFolder: "/a/$&$1" }, {}, EVENING);
  assert.strictEqual(out, "cd /a/$&$1");
});

test("throws TypeError for a non-string template", function () {
  assert.throws(function () {
    resolveAutoVariables(null, CONTEXT, {});
  }, TypeError);
});

section("date formats");

test("defaults to YYYY-MM-DD", function () {
  assert.strictEqual(resolveAutoVariables("${@date}", CONTEXT, {}, EVENING), "2026-03-07");
});

test("applies every supported format", function () {
  const expected = { "YYYY-MM-DD": "2026-03-07", "DD/MM/YYYY": "07/03/2026", "MM/DD/YYYY": "03/07/2026", "DD-MM-YYYY": "07-03-2026" };
  Object.keys(expected).forEach(function (format) {
    assert.strictEqual(resolveAutoVariables("${@date}", CONTEXT, { date: { config: { format } } }, EVENING), expected[format]);
  });
});

test("falls back to the default for an unsupported saved format", function () {
  assert.strictEqual(resolveAutoVariables("${@date}", CONTEXT, { date: { config: { format: "YYYY" } } }, EVENING), "2026-03-07");
});

section("time formats");

test("defaults to HH-mm-ss (24-hour)", function () {
  assert.strictEqual(resolveAutoVariables("${@time}", CONTEXT, {}, EVENING), "22-45-09");
});

test("24-hour and 12-hour with separators", function () {
  assert.strictEqual(timeWith("HH-mm-ss", EVENING), "22-45-09");
  assert.strictEqual(timeWith("hh-mm-ss-A", EVENING), "10-45-09-PM");
  assert.strictEqual(timeWith("HH:mm", EVENING), "22:45");
  assert.strictEqual(timeWith("hh.mm.A", EVENING), "10.45.PM");
  assert.strictEqual(timeWith("hh_mm_ss_A", EVENING), "10_45_09_PM");
});

test("formats without separators", function () {
  assert.strictEqual(timeWith("HHmmss", EVENING), "224509");
  assert.strictEqual(timeWith("HHmm", EVENING), "2245");
  assert.strictEqual(timeWith("hhmmssA", EVENING), "104509PM");
  assert.strictEqual(timeWith("hhmmA", EVENING), "1045PM");
});

test("midnight and noon in 12-hour format", function () {
  assert.strictEqual(timeWith("hh-mm-ss-A", new Date(2026, 0, 1, 0, 5, 0)), "12-05-00-AM");
  assert.strictEqual(timeWith("hh-mm-ss-A", new Date(2026, 0, 1, 12, 0, 0)), "12-00-00-PM");
  assert.strictEqual(timeWith("HH-mm-ss", new Date(2026, 0, 1, 0, 5, 0)), "00-05-00");
});

section("buildAutoVariablesPayload");

test("lists every variable with its token, value, and format options", function () {
  const payload = buildAutoVariablesPayload(CONTEXT, {}, EVENING);
  const byName = Object.fromEntries(payload.map((v) => [v.name, v]));
  assert.deepStrictEqual(Object.keys(byName), ["workspaceFolder", "workspaceName", "username", "date", "time"]);
  assert.strictEqual(byName.time.token, "${@time}");
  assert.strictEqual(byName.time.currentValue, "22-45-09");
  assert.strictEqual(byName.time.configurable, true);
  assert.ok(byName.time.configOptions.includes("hh-mm-ss-A"));
  assert.ok(byName.time.configOptions.includes("HHmmss"));
  assert.strictEqual(byName.workspaceName.configurable, false);
  assert.deepStrictEqual(byName.workspaceName.configOptions, []);
  payload.forEach(function (v) {
    assert.strictEqual("enabled" in v, false, `${v.name} should not expose "enabled"`);
  });
});

test("every time format resolves to a value without leftover tokens", function () {
  const time = buildAutoVariablesPayload(CONTEXT, {}, EVENING).find((v) => v.name === "time");
  time.configOptions.forEach(function (format) {
    assert.match(timeWith(format, EVENING), /^[0-9:._\-APM]+$/, format);
  });
});

// ---------------------------------------------------------------------------
// media/utils.js (webview)
// ---------------------------------------------------------------------------

const utilsSource = fs.readFileSync(path.resolve(__dirname, "..", "media", "utils.js"), "utf8");

function loadUtils() {
  const posted = [];
  const sandbox = {
    RUNBOX_EMPTY_VALUE: "__EMPTY_VALUE__",
    document: { activeElement: null, getElementById: () => null },
    vscode: { postMessage: (m) => posted.push(m) },
    crypto: { getRandomValues: (arr) => arr.fill(7) },
    state: { autoVariables: buildAutoVariablesPayload(CONTEXT, {}, EVENING) },
    uiState: { commandLocalDrafts: {}, commandGlobalDrafts: {}, commandSessionDrafts: {}, commandRemember: {} },
    runConfirmState: { commandId: "c1" },
    icons: {},
  };
  vm.createContext(sandbox);
  vm.runInContext(
    `${utilsSource}
this.resolveCommandTemplate = resolveCommandTemplate;
this.highlightTemplateHtml = highlightTemplateHtml;
this.highlightResolvedHtml = highlightResolvedHtml;
this.getMissingVariables = getMissingVariables;
this.hasAutoVariables = hasAutoVariables;
this.requestRunConfirmAutoValues = requestRunConfirmAutoValues;
this.insertTextAtCursor = insertTextAtCursor;`,
    sandbox
  );
  return { sandbox, posted };
}

/**
 * Minimal textarea stand-in for insertTextAtCursor: tracks value/selection and
 * lets the test choose whether the native "insertText" edit is available.
 */
function makeFakeTextarea(value, start, end, nativeInsert) {
  const events = [];
  const area = {
    value,
    selectionStart: start,
    selectionEnd: end,
    focused: false,
    focus() {
      this.focused = true;
    },
    setSelectionRange(s, e) {
      this.selectionStart = s;
      this.selectionEnd = e;
    },
    setRangeText(text, s, e) {
      this.value = this.value.slice(0, s) + text + this.value.slice(e);
      this.selectionStart = this.selectionEnd = s + text.length;
    },
    dispatchEvent(event) {
      events.push(event.type);
    },
  };
  area.events = events;
  area.nativeInsert = function (text) {
    if (!nativeInsert) {
      return false;
    }
    area.setRangeText(text, area.selectionStart, area.selectionEnd);
    return true;
  };
  return area;
}

function insertWith(area, text, caretKnown) {
  const { sandbox } = loadUtils();
  sandbox.document.execCommand = function (_command, _showUi, value) {
    return area.nativeInsert(value);
  };
  sandbox.Event = function (type) {
    this.type = type;
  };
  sandbox.insertTextAtCursor(area, text, caretKnown);
}

section("media/utils.js");

test("resolveCommandTemplate keeps ${@name} tokens for the extension by default", function () {
  const { sandbox } = loadUtils();
  sandbox.uiState.commandSessionDrafts.c1 = { name: "x" };
  const out = sandbox.resolveCommandTemplate({ id: "c1", command: "echo ${name} ${@time}" });
  assert.strictEqual(out, "echo x ${@time}");
});

test("resolveCommandTemplate substitutes given auto values after user variables", function () {
  const { sandbox } = loadUtils();
  sandbox.uiState.commandSessionDrafts.c1 = { name: "${@time}" };
  const out = sandbox.resolveCommandTemplate({ id: "c1", command: "echo ${name} ${@time} ${@unknown}" }, { time: "10-00-00" });
  assert.strictEqual(out, "echo 10-00-00 10-00-00 ${@unknown}");
});

test("${date} is a regular user variable that must be filled in", function () {
  const { sandbox } = loadUtils();
  const missing = sandbox.getMissingVariables({ id: "c1", command: "echo ${date} ${@date}" });
  assert.deepStrictEqual(Array.from(missing), ["date"]);
});

test("highlightTemplateHtml marks ${@name} as auto and ${name} as user", function () {
  const { sandbox } = loadUtils();
  const html = sandbox.highlightTemplateHtml("a ${@date} ${date} ${@unknown}");
  assert.strictEqual(html, 'a <span class="var-auto">${@date}</span> <span class="var-user">${date}</span> ${@unknown}');
});

test("highlightResolvedHtml escapes auto values and uses the given values", function () {
  const { sandbox } = loadUtils();
  const html = sandbox.highlightResolvedHtml({ id: "c1", command: "cd ${@workspaceName}" }, { workspaceName: "<b>" });
  assert.strictEqual(html, 'cd <span class="var-auto">&lt;b&gt;</span>');
});

test("hasAutoVariables detects tokens and is safe to call repeatedly", function () {
  const { sandbox } = loadUtils();
  assert.strictEqual(sandbox.hasAutoVariables("x ${@time}"), true);
  assert.strictEqual(sandbox.hasAutoVariables("x ${@time}"), true);
  assert.strictEqual(sandbox.hasAutoVariables("x ${time}"), false);
});

test("requestRunConfirmAutoValues posts a request and clears pending values", function () {
  const { sandbox, posted } = loadUtils();
  sandbox.runConfirmState.autoValues = { time: "old" };
  sandbox.requestRunConfirmAutoValues();
  assert.strictEqual(sandbox.runConfirmState.autoValues, null);
  assert.strictEqual(posted.length, 1);
  assert.strictEqual(posted[0].type, "requestAutoVariables");
  assert.strictEqual(posted[0].payload.requestId, sandbox.runConfirmState.autoRequestId);
});

section("insertTextAtCursor (Insert variable picker)");

test("inserts the token at the caret in the middle of the text", function () {
  const area = makeFakeTextarea("echo  done", 5, 5, true);
  insertWith(area, "${@date}", true);
  assert.strictEqual(area.value, "echo ${@date} done");
  assert.strictEqual(area.selectionStart, 13);
  assert.strictEqual(area.focused, true);
});

test("replaces the current selection with the token", function () {
  const area = makeFakeTextarea("echo XXX", 5, 8, true);
  insertWith(area, "${@time}", true);
  assert.strictEqual(area.value, "echo ${@time}");
});

test("appends at the end when the caret was never placed", function () {
  const area = makeFakeTextarea("cd ", 0, 0, true);
  insertWith(area, "${@workspaceFolder}", false);
  assert.strictEqual(area.value, "cd ${@workspaceFolder}");
});

test("falls back to setRangeText and fires an input event without native edit support", function () {
  const area = makeFakeTextarea("ab", 1, 1, false);
  insertWith(area, "${@username}", true);
  assert.strictEqual(area.value, "a${@username}b");
  assert.deepStrictEqual(area.events, ["input"]);
});

test("ignores empty or non-string text", function () {
  const area = makeFakeTextarea("ab", 1, 1, true);
  insertWith(area, "", true);
  insertWith(area, null, true);
  assert.strictEqual(area.value, "ab");
});

console.log("\n──────────────────────────────");
console.log(`  Total : ${passed + failed}`);
console.log(`  Passed: ${passed}`);
console.log(`  Failed: ${failed}`);

if (failed > 0) {
  process.exit(1);
}
