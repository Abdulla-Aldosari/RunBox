/*-------------------------------------------------
 * RunBox — VS Code Extension
 * Copyright (c) 2026 Abdulla Aldosari
 * Licensed under the Apache License, Version 2.0.
 * See LICENSE in the project root for details.
 *-------------------------------------------------*/

// Syntax checker — runs `node --check` on all project JS files.
// Cross-platform (Node.js only, no shell dependencies).

const { execFileSync } = require("child_process");
const fs = require("fs");
const path = require("path");

const EXCLUDE_DIRS = ["node_modules", "dist", ".vsenv", "media/dev", ".temp", ".git"];
const EXCLUDE_FILES = ["commitlint.config.js", "eslint.config.js"];

function collectFiles(dir) {
  const results = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    const rel = path.relative(".", full).replaceAll("\\", "/");
    if (entry.isDirectory()) {
      if (!EXCLUDE_DIRS.some((ex) => rel.startsWith(ex))) {
        results.push(...collectFiles(full));
      }
    } else if (entry.name.endsWith(".js") && !EXCLUDE_FILES.includes(entry.name)) {
      results.push(rel);
    }
  }
  return results;
}

const files = collectFiles(".");

// ---------------------------------------------------------------------------
// Runner
// ---------------------------------------------------------------------------

let passed = 0;
let failed = 0;

console.log("\n── Syntax Check ──\n");

for (const file of files) {
  try {
    execFileSync(process.execPath, ["--check", file], { stdio: "pipe" });
    console.log(`  ✓  ${file}`);
    passed++;
  } catch (err) {
    console.error(`  ✗  ${file}`);
    console.error(`       ${err.stderr.toString().trim()}`);
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
