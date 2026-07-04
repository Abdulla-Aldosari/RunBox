/*-------------------------------------------------
 * RunBox — VS Code Extension
 * Copyright (c) 2026 Abdulla Aldosari
 * Licensed under the Apache License, Version 2.0.
 * See LICENSE in the project root for details.
 *-------------------------------------------------*/

// testing/run-tests.js
// Runs all test files sequentially, streams their output, then prints a
// unified summary table at the end.
// Run with: node testing/run-tests.js

"use strict";

const { spawnSync } = require("child_process");
const path = require("path");

// ---------------------------------------------------------------------------
// Test definitions
// ---------------------------------------------------------------------------

const TESTS = [
  { label: "Syntax", header: "Syntax test :", file: "testing/check-syntax.js" },
  { label: "Function", header: "Normalize test :", file: "testing/normalize.test.js" },
  { label: "FixShellPath", header: "Terminal test :", file: "testing/terminal.test.js" },
  { label: "Exports", header: "Exports test :", file: "testing/exports.test.js" },
  { label: "Inline-Styles", header: "Inline Styles test :", file: "testing/style-lint.test.js" },
];

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const SEP = "─".repeat(55);

/**
 * Extracts Total/Passed/Failed from a test file's stdout.
 * Matches lines like:
 *   Total : 44
 *   Passed: 44
 *   Failed: 0
 * @param {string} output
 * @returns {{ total: number, passed: number, failed: number }}
 */
function parseResults(output) {
  const num = (label) => {
    const m = output.match(new RegExp(`${label}\\s*:\\s*(\\d+)`));
    return m ? parseInt(m[1], 10) : 0;
  };
  return {
    total: num("Total"),
    passed: num("Passed"),
    failed: num("Failed"),
  };
}

// ---------------------------------------------------------------------------
// Runner
// ---------------------------------------------------------------------------

const results = [];
let anyFailed = false;

for (const { label, header, file } of TESTS) {
  console.log("\n\n\n" + SEP);
  console.log("# " + header);
  console.log(SEP);

  const result = spawnSync(process.execPath, [path.resolve(__dirname, "..", file)], {
    stdio: "inherit",
    encoding: "utf8",
  });

  const output = (result.stdout || "") + (result.stderr || "");
  const stats = parseResults(output);

  // spawnSync with stdio:"inherit" streams directly, output is empty — re-run
  // with pipe just for parsing if needed.
  if (stats.total === 0) {
    const parsed = spawnSync(process.execPath, [path.resolve(__dirname, "..", file)], {
      encoding: "utf8",
    });
    const combinedOutput = (parsed.stdout || "") + (parsed.stderr || "");
    const reparsed = parseResults(combinedOutput);
    results.push({ label, ...reparsed, exitCode: result.status });
  } else {
    results.push({ label, ...stats, exitCode: result.status });
  }

  if (result.status !== 0) anyFailed = true;
}

// ---------------------------------------------------------------------------
// Final summary table
// ---------------------------------------------------------------------------

console.log("\n" + SEP);
console.log("# Final Result :");
console.log(SEP);

const LABEL_WIDTH = Math.max(...results.map((r) => r.label.length));

for (const { label, total, passed, failed } of results) {
  const paddedLabel = label.padEnd(LABEL_WIDTH);
  console.log(`  ${paddedLabel}  ( Total: ${total} / Passed: ${passed} / Failed: ${failed} )`);
}

console.log(SEP);

if (anyFailed) {
  process.exit(1);
}
