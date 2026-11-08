/*-------------------------------------------------
 * RunBox — VS Code Extension
 * Copyright (c) 2026 Abdulla Aldosari
 * Licensed under the MIT License.
 * See LICENSE in the project root for details.
 *-------------------------------------------------*/

// testing/name-rules.test.js
// Unit tests for the category/group name format rules in media/name-rules.js.
// Run with: node testing/name-rules.test.js

"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const source = fs.readFileSync(path.resolve(__dirname, "..", "media", "name-rules.js"), "utf8");
const sandbox = {};
vm.createContext(sandbox);
vm.runInContext(`${source}\nthis.NAME_MAX_LENGTH = NAME_MAX_LENGTH;\nthis.normalizeName = normalizeName;\nthis.getNameFormatError = getNameFormatError;`, sandbox);
const { NAME_MAX_LENGTH, normalizeName, getNameFormatError } = sandbox;

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

const validate = (value) => getNameFormatError(normalizeName(value));

section("normalizeName");

test("trims and collapses whitespace", () => {
  assert.strictEqual(normalizeName("  Git   Tools \t "), "Git Tools");
});

section("Accepted names");

["Git", "C++", "Node.js", "CI/CD", "Docker (dev)", "Build & Deploy", "Tools: A_B-C #1", "أدوات النظام", "Linux 2"].forEach((name) => {
  test(`accepts "${name}"`, () => {
    assert.strictEqual(validate(name), "");
  });
});

test("accepts exactly the maximum length", () => {
  assert.strictEqual(validate("a".repeat(NAME_MAX_LENGTH)), "");
});

section("Rejected names");

test("rejects the symbol-only name from the bug report", () => {
  assert.notStrictEqual(validate("!@#$$%$$%^^^^^%&*))+_("), "");
});

test("rejects a name over the maximum length", () => {
  assert.strictEqual(validate("a".repeat(NAME_MAX_LENGTH + 1)), `Use ${NAME_MAX_LENGTH} characters or fewer`);
});

["a$b", "a{b}", "a<b>", "a|b", "a;b", "a'b", 'a"b', "a`b", "a\\b", "a,b", "a=b", "a@b", "a!b"].forEach((name) => {
  test(`rejects disallowed symbol in "${name}"`, () => {
    assert.strictEqual(validate(name), "Use letters, numbers, and - _ . & + # / ( ) : only");
  });
});

test("rejects zero-width and control characters", () => {
  assert.notStrictEqual(validate("a\u200Bb"), "");
  assert.notStrictEqual(validate("a\u0007b"), "");
});

test("rejects an allowed-symbols-only name", () => {
  assert.strictEqual(validate("---"), "Include at least one letter or number");
  assert.strictEqual(validate("( )"), "Include at least one letter or number");
});

test("returns no error for an empty name", () => {
  assert.strictEqual(validate("   "), "");
});

console.log(`\n  Total : ${passed + failed}\n  Passed: ${passed}\n  Failed: ${failed}`);
process.exit(failed > 0 ? 1 : 0);
