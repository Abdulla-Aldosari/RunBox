/*-------------------------------------------------
 * RunBox — VS Code Extension
 * Copyright (c) 2026 Abdulla Aldosari
 * Licensed under the Apache License, Version 2.0.
 * See LICENSE in the project root for details.
 *-------------------------------------------------*/

// testing/help-links.test.js
// Unit tests for lib/help-links.js.
// Run with: node testing/help-links.test.js

"use strict";

const assert = require("assert");
const { getHelpLink } = require("../lib/help-links");

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
// getHelpLink
// ---------------------------------------------------------------------------

section("getHelpLink");

test("returns the URL for a registered key", function () {
  const url = getHelpLink("faqs-duplicate-terminal-profiles");
  assert.strictEqual(
    url,
    "https://github.com/Abdulla-Aldosari/runbox/blob/main/docs/faqs.md#duplicate-terminal-profiles"
  );
});

test("returns null for an unregistered key", function () {
  assert.strictEqual(getHelpLink("does-not-exist"), null);
});

test("returns null for an empty string key", function () {
  assert.strictEqual(getHelpLink(""), null);
});

test("returns null for a null/undefined key", function () {
  assert.strictEqual(getHelpLink(null), null);
  assert.strictEqual(getHelpLink(undefined), null);
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
