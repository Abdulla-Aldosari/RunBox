/*-------------------------------------------------
 * RunBox — VS Code Extension
 * Copyright (c) 2026 Abdulla Aldosari
 * Licensed under the MIT License.
 * See LICENSE in the project root for details.
 *-------------------------------------------------*/

// testing/table-scroll.test.js
// Unit tests for the table scroll helpers in media/utils.js:
// computeEdgeScrollDelta (drag auto-scroll speed) and captureTableScroll /
// restoreTableScroll (keeping the table scroll position across re-renders).
// The webview script is loaded into a vm sandbox with a minimal fake DOM.
// Run with: node testing/table-scroll.test.js

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
 * Loads media/utils.js into a sandbox whose document returns `dom.scroller`
 * (the current `.table-scroll` element) from querySelector.
 * @param {object} uiState
 */
function load(uiState) {
  const dom = { scroller: null };
  const sandbox = {
    uiState,
    document: {
      querySelector: (selector) => (selector === ".table-scroll" ? dom.scroller : null),
      getElementById: () => null,
    },
  };
  vm.createContext(sandbox);
  vm.runInContext(
    `${source}\nthis.computeEdgeScrollDelta = computeEdgeScrollDelta;\nthis.captureTableScroll = captureTableScroll;\nthis.restoreTableScroll = restoreTableScroll;`,
    sandbox
  );
  return { sandbox, dom };
}

function fakeScroller(top, left) {
  return { dataset: {}, scrollTop: top || 0, scrollLeft: left || 0 };
}

function baseUiState() {
  return { activeTab: "commands", editingCommandId: null, selectedCategoryId: "cat-1", selectedGroupId: "all", favoritesScope: "local" };
}

console.log("\n── computeEdgeScrollDelta ──");

const { sandbox: edgeBox } = load(baseUiState());
const edge = edgeBox.computeEdgeScrollDelta;

test("returns 0 while the pointer is in the middle of the area", function () {
  assert.strictEqual(edge(500, 100, 900, 80, 12), 0);
});

test("scrolls up at full speed at the top edge", function () {
  assert.strictEqual(edge(100, 100, 900, 80, 12), -12);
});

test("scrolls up at half speed halfway into the top zone", function () {
  assert.strictEqual(edge(140, 100, 900, 80, 12), -6);
});

test("scrolls down at half speed halfway into the bottom zone", function () {
  assert.strictEqual(edge(860, 100, 900, 80, 12), 6);
});

test("caps the speed when the pointer is above or below the area", function () {
  assert.strictEqual(edge(20, 100, 900, 80, 12), -12);
  assert.strictEqual(edge(2000, 100, 900, 80, 12), 12);
});

test("shrinks the zone to a third of a short area so zones never overlap", function () {
  // Area of 120px -> zone 40px: the exact middle (y=160) must not scroll.
  assert.strictEqual(edge(160, 100, 220, 80, 12), 0);
  assert.strictEqual(edge(120, 100, 220, 80, 12), -6);
});

test("returns 0 for an empty or inverted area", function () {
  assert.strictEqual(edge(100, 100, 100, 80, 12), 0);
  assert.strictEqual(edge(100, 200, 100, 80, 12), 0);
});

console.log("\n── captureTableScroll / restoreTableScroll ──");

test("capture returns null when no table scroll area is rendered", function () {
  const { sandbox } = load(baseUiState());
  assert.strictEqual(sandbox.captureTableScroll(), null);
});

test("restore stamps the view key and leaves a fresh table at the top", function () {
  const { sandbox, dom } = load(baseUiState());
  dom.scroller = fakeScroller();
  sandbox.restoreTableScroll(null);
  assert.ok(dom.scroller.dataset.viewKey);
  assert.strictEqual(dom.scroller.scrollTop, 0);
});

test("re-rendering the same view restores the vertical and horizontal position", function () {
  const { sandbox, dom } = load(baseUiState());
  dom.scroller = fakeScroller();
  sandbox.restoreTableScroll(null);
  dom.scroller.scrollTop = 640;
  dom.scroller.scrollLeft = 75;
  const snapshot = sandbox.captureTableScroll();
  dom.scroller = fakeScroller(); // DOM rebuilt by render()
  sandbox.restoreTableScroll(snapshot);
  assert.strictEqual(dom.scroller.scrollTop, 640);
  assert.strictEqual(dom.scroller.scrollLeft, 75);
});

for (const [field, value] of [
  ["activeTab", "favorites"],
  ["selectedCategoryId", "cat-2"],
  ["selectedGroupId", "group-9"],
  ["favoritesScope", "global"],
  ["editingCommandId", "cmd-1"],
]) {
  test(`changing ${field} starts the new table at the top`, function () {
    const uiState = baseUiState();
    const { sandbox, dom } = load(uiState);
    dom.scroller = fakeScroller();
    sandbox.restoreTableScroll(null);
    dom.scroller.scrollTop = 640;
    // The key is read from the old element, so changing uiState before the
    // capture (as event handlers do before calling render()) is still detected.
    uiState[field] = value;
    const snapshot = sandbox.captureTableScroll();
    dom.scroller = fakeScroller();
    sandbox.restoreTableScroll(snapshot);
    assert.strictEqual(dom.scroller.scrollTop, 0);
  });
}

console.log("\n──────────────────────────────");
console.log(`  Total : ${passed + failed}`);
console.log(`  Passed: ${passed}`);
console.log(`  Failed: ${failed}`);

if (failed > 0) {
  process.exit(1);
}
