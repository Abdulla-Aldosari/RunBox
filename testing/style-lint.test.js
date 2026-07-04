/*-------------------------------------------------
 * RunBox — VS Code Extension
 * Copyright (c) 2026 Abdulla Aldosari
 * Licensed under the Apache License, Version 2.0.
 * See LICENSE in the project root for details.
 *-------------------------------------------------*/

// testing/style-lint.test.js
// Scans every JS file under media/ (excluding media/dev/ and media/icons.js)
// and enforces the no-inline-styles rule:
//
//   ❌  style="..."             — HTML inline style attribute
//   ❌  el.style.<prop> = ...   — JS direct property assignment
//   ❌  .style.setProperty(     — unless the first argument is a string literal
//                                 that starts with "--" (CSS custom property)
//
// Run with: node testing/style-lint.test.js

"use strict";

const fs = require("fs");
const path = require("path");

// ---------------------------------------------------------------------------
// Collect media/ JS files (recursive, skip excluded paths)
// ---------------------------------------------------------------------------

const ROOT = path.resolve(__dirname, "..");
const MEDIA_ROOT = path.join(ROOT, "media");

const EXCLUDED = [path.join(MEDIA_ROOT, "dev"), path.join(MEDIA_ROOT, "icons.js")];

function isExcluded(filePath) {
  return EXCLUDED.some((ex) => filePath === ex || filePath.startsWith(ex + path.sep));
}

function collectJsFiles(dir) {
  const results = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (isExcluded(full)) continue;
    if (entry.isDirectory()) {
      results.push(...collectJsFiles(full));
    } else if (entry.isFile() && entry.name.endsWith(".js")) {
      results.push(full);
    }
  }
  return results;
}

const FILES = collectJsFiles(MEDIA_ROOT);

// ---------------------------------------------------------------------------
// Patterns
// ---------------------------------------------------------------------------

// 1. HTML inline style attribute:  style="..."  or  style='...'
const RE_HTML_STYLE = /style\s*=\s*["']/;

// 2. Direct .style.<property> assignment:  el.style.color = "red"
//    Exclude .style.setProperty — handled separately.
const RE_STYLE_PROP = /\.style\.(?!setProperty\b)[a-zA-Z]+\s*=/;

// 3. .style.setProperty( where first argument is NOT a "--..." string literal.
//    Allowed:   .style.setProperty("--foo", ...)
//    Forbidden: .style.setProperty("color", ...)  |  .style.setProperty(var, ...)
const RE_SET_PROPERTY = /\.style\.setProperty\s*\(/;
const RE_SET_PROPERTY_OK = /\.style\.setProperty\s*\(\s*["']--/;

// ---------------------------------------------------------------------------
// Scanner
// ---------------------------------------------------------------------------

/**
 * @typedef {{ line: number, text: string, reason: string }} Violation
 */

/**
 * Scans source text and returns all violations.
 * @param {string} source
 * @returns {Violation[]}
 */
function scan(source) {
  const violations = [];
  const lines = source.split("\n");

  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i];
    const text = raw.trimEnd();

    if (RE_HTML_STYLE.test(text)) {
      violations.push({ line: i + 1, text, reason: 'HTML inline style attribute (style="...")' });
      continue; // one violation per line is enough
    }

    if (RE_STYLE_PROP.test(text)) {
      violations.push({ line: i + 1, text, reason: "Direct .style.<property> assignment" });
      continue;
    }

    if (RE_SET_PROPERTY.test(text) && !RE_SET_PROPERTY_OK.test(text)) {
      violations.push({
        line: i + 1,
        text,
        reason: '.style.setProperty() — first argument must be a string literal starting with "--"',
      });
    }
  }

  return violations;
}

// ---------------------------------------------------------------------------
// Runner
// ---------------------------------------------------------------------------

let passed = 0;
let failed = 0;

console.log("\n── No-Inline-Styles Lint (media/ JS files) ──\n");

for (const file of FILES) {
  const label = path.relative(ROOT, file).replace(/\\/g, "/");
  const source = fs.readFileSync(file, "utf8");
  const violations = scan(source);

  if (violations.length === 0) {
    console.log(`  ✓  ${label}`);
    passed++;
  } else {
    console.error(`  ✗  ${label}`);
    for (const v of violations) {
      console.error(`       line ${v.line}: ${v.reason}`);
      console.error(`         ${v.text.trim()}`);
    }
    failed++;
  }
}

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
