import test from "node:test";
import assert from "node:assert/strict";

import {
  buildReadyFocusList,
  clampReadyFocusIndex,
  focusedGardenIndex,
  followVisibleItemAfterUnhide,
  resolveReadyPagination
} from "../lib/ready-shell-state";

test("resolveReadyPagination paginates garden view and clamps stale page index", () => {
  const state = resolveReadyPagination({
    items: ["a", "b", "c", "d", "e"],
    isGardenView: true,
    paginate: true,
    capacity: 2,
    pageIndex: 9
  });

  assert.equal(state.pageCount, 3);
  assert.equal(state.safePageIndex, 2);
  assert.deepEqual(state.pageItems, ["e"]);
});

test("resolveReadyPagination leaves shelf and unpaginated garden on one page", () => {
  assert.deepEqual(
    resolveReadyPagination({
      items: ["a", "b", "c"],
      isGardenView: false,
      paginate: true,
      capacity: 1,
      pageIndex: 0
    }).pageItems,
    ["a", "b", "c"]
  );
  assert.deepEqual(
    resolveReadyPagination({
      items: ["a", "b", "c"],
      isGardenView: true,
      paginate: false,
      capacity: 1,
      pageIndex: 0
    }).pageItems,
    ["a", "b", "c"]
  );
});

test("ready focus helpers keep home and hidden rows out of garden focus", () => {
  const focusList = buildReadyFocusList(["visible"], ["hidden"]);
  assert.deepEqual(focusList, ["visible", "hidden"]);
  assert.equal(clampReadyFocusIndex(4, focusList.length), 1);
  assert.equal(clampReadyFocusIndex(-2, focusList.length), 0);
  assert.equal(focusedGardenIndex({ homeSelected: true, focusIndex: 0, visibleCount: 1 }), -1);
  assert.equal(focusedGardenIndex({ homeSelected: false, focusIndex: 1, visibleCount: 1 }), -1);
  assert.equal(focusedGardenIndex({ homeSelected: false, focusIndex: 0, visibleCount: 1 }), 0);
});

test("followVisibleItemAfterUnhide returns page and focus within that page", () => {
  assert.deepEqual(followVisibleItemAfterUnhide({ globalIndex: 7, capacity: 3 }), {
    pageIndex: 2,
    focusIndex: 1
  });
  assert.equal(followVisibleItemAfterUnhide({ globalIndex: -1, capacity: 3 }), null);
  assert.equal(followVisibleItemAfterUnhide({ globalIndex: 2, capacity: 0 }), null);
});
