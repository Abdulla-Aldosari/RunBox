/*-------------------------------------------------
 * RunBox — VS Code Extension
 * Copyright (c) 2026 Abdulla Aldosari
 * Licensed under the MIT License.
 * See LICENSE in the project root for details.
 *-------------------------------------------------*/

// testing/variable-shortcuts.test.js
// Unit tests for the Ctrl/Cmd+Shift+O / Ctrl/Cmd+Shift+E variable field shortcuts
// (applyVariableShortcut and the focus-state reporting in media/utils.js). The webview
// script is loaded into a vm sandbox with a minimal fake DOM.
// Run with: node testing/variable-shortcuts.test.js

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

/**
 * Builds a fake text input that records the DOM state the shortcut code touches.
 * @param {string[]} classes
 * @param {string} varName
 * @param {string} value
 */
function fakeInput(classes, varName, value) {
  const classSet = new Set(classes);
  const input = {
    dataset: { variableName: varName },
    value,
    readOnly: false,
    focused: false,
    classList: {
      contains: (c) => classSet.has(c),
      add: (c) => classSet.add(c),
      remove: (c) => classSet.delete(c),
    },
    matches: (selector) => selector.split(",").some((s) => classSet.has(s.trim().replace(/^\./, ""))),
    closest: () => null,
    setAttribute(name, val) {
      if (name === "data-pre-empty-value") input.dataset.preEmptyValue = val;
      if (name === "data-is-empty-value") input.dataset.isEmptyValue = val;
    },
    removeAttribute(name) {
      if (name === "data-pre-empty-value") delete input.dataset.preEmptyValue;
      if (name === "data-is-empty-value") delete input.dataset.isEmptyValue;
    },
    focus() {
      input.focused = true;
    },
  };
  return input;
}

function load(activeElement) {
  const posted = [];
  const sandbox = {
    RUNBOX_EMPTY_VALUE: "__EMPTY_VALUE__",
    document: { activeElement, getElementById: () => null },
    vscode: { postMessage: (m) => posted.push(m) },
    variableInputState: { inputValues: {} },
    commandFormBuffer: {
      remember: {},
      drafts: {},
      scopeDraft(scope) {
        this.drafts[scope] = this.drafts[scope] || {};
        return this.drafts[scope];
      },
    },
    icons: { checkmark: "" },
  };
  vm.createContext(sandbox);
  vm.runInContext(`${source}\nthis.applyVariableShortcut = applyVariableShortcut;\nthis.reportVariableFieldFocus = reportVariableFieldFocus;`, sandbox);
  return { sandbox, posted };
}

console.log("\n── applyVariableShortcut ──");

test("toggleEmpty empties a modal input, then restores the previous text", function () {
  const input = fakeInput(["variable-modal-input"], "branch", "main");
  const { sandbox } = load(input);

  sandbox.applyVariableShortcut("toggleEmpty");
  assert.strictEqual(input.readOnly, true);
  assert.strictEqual(input.value, "[EmptyValue]");
  assert.strictEqual(sandbox.variableInputState.inputValues.branch, "__EMPTY_VALUE__");

  sandbox.applyVariableShortcut("toggleEmpty");
  assert.strictEqual(input.readOnly, false);
  assert.strictEqual(input.value, "main");
  assert.strictEqual(sandbox.variableInputState.inputValues.branch, "main");
});

test("toggleEmpty on a Command form input stores the value in the active scope draft", function () {
  const input = fakeInput(["variable-input"], "port", "8080");
  input.dataset.scope = "local";
  const { sandbox } = load(input);

  sandbox.applyVariableShortcut("toggleEmpty");
  assert.strictEqual(sandbox.commandFormBuffer.drafts.local.port, "__EMPTY_VALUE__");
  assert.deepStrictEqual(Object.keys(sandbox.variableInputState.inputValues), []);
});

test("pickFile posts a pickFile message for a focused modal input", function () {
  const input = fakeInput(["variable-modal-input"], "file", "");
  const { sandbox, posted } = load(input);

  sandbox.applyVariableShortcut("pickFile");
  assert.deepStrictEqual(JSON.parse(JSON.stringify(posted)), [{ type: "pickFile", payload: { variableName: "file" } }]);
});

test("pickFile is ignored for read-only inputs and for Command form inputs", function () {
  const readOnlyInput = fakeInput(["variable-modal-input"], "file", "");
  readOnlyInput.readOnly = true;
  const first = load(readOnlyInput);
  first.sandbox.applyVariableShortcut("pickFile");
  assert.strictEqual(first.posted.length, 0);

  const formInput = fakeInput(["variable-input"], "file", "");
  const second = load(formInput);
  second.sandbox.applyVariableShortcut("pickFile");
  assert.strictEqual(second.posted.length, 0);
});

test("does nothing when no variable field has focus", function () {
  const other = fakeInput(["some-other-input"], "x", "");
  const { sandbox, posted } = load(other);

  sandbox.applyVariableShortcut("toggleEmpty");
  sandbox.applyVariableShortcut("pickFile");
  assert.strictEqual(posted.length, 0);
  assert.strictEqual(other.readOnly, false);
});

test("a focused enum dropdown button targets its custom-value input and reveals it", function () {
  const custom = fakeInput(["variable-modal-input", "variable-modal-custom-input", "hidden"], "env", "dev");
  const button = {
    matches: () => false,
    closest: () => ({ querySelector: () => custom }),
  };
  const { sandbox } = load(button);

  sandbox.applyVariableShortcut("toggleEmpty");
  assert.strictEqual(custom.classList.contains("hidden"), false);
  assert.strictEqual(custom.focused, true);
  assert.strictEqual(custom.readOnly, true);
  assert.strictEqual(sandbox.variableInputState.inputValues.env, "__EMPTY_VALUE__");
});

console.log("\n── reportVariableFieldFocus ──");

function lastReport(posted) {
  return JSON.parse(JSON.stringify(posted[posted.length - 1].payload));
}

test("reports focused + filePickable for an editable modal input", function () {
  const { sandbox, posted } = load(fakeInput(["variable-modal-input"], "file", ""));
  sandbox.reportVariableFieldFocus();
  assert.deepStrictEqual(lastReport(posted), { focused: true, filePickable: true });
  assert.strictEqual(posted[0].type, "variableFieldFocus");
});

test("reports focused but not filePickable for a Command form input and for an empty-valued input", function () {
  const form = load(fakeInput(["variable-input"], "port", ""));
  form.sandbox.reportVariableFieldFocus();
  assert.deepStrictEqual(lastReport(form.posted), { focused: true, filePickable: false });

  const emptied = fakeInput(["variable-modal-input"], "file", "");
  emptied.readOnly = true;
  const second = load(emptied);
  second.sandbox.reportVariableFieldFocus();
  assert.deepStrictEqual(lastReport(second.posted), { focused: true, filePickable: false });
});

test("reports not focused when no variable field has focus, and when forced", function () {
  const other = load(fakeInput(["some-other-input"], "x", ""));
  other.sandbox.reportVariableFieldFocus();
  assert.deepStrictEqual(lastReport(other.posted), { focused: false, filePickable: false });

  const forced = load(fakeInput(["variable-modal-input"], "file", ""));
  forced.sandbox.reportVariableFieldFocus();
  forced.sandbox.reportVariableFieldFocus(true);
  assert.deepStrictEqual(lastReport(forced.posted), { focused: false, filePickable: false });
  assert.strictEqual(forced.posted.length, 2);
});

test("does not repost an unchanged focus state", function () {
  const { sandbox, posted } = load(fakeInput(["variable-modal-input"], "file", ""));
  sandbox.reportVariableFieldFocus();
  sandbox.reportVariableFieldFocus();
  sandbox.reportVariableFieldFocus();
  assert.strictEqual(posted.length, 1);
});
console.log("\n──────────────────────────────");
console.log(`  Total : ${passed + failed}`);
console.log(`  Passed: ${passed}`);
console.log(`  Failed: ${failed}`);

if (failed > 0) {
  process.exit(1);
}
