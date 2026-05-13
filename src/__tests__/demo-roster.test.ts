import test from "node:test";
import assert from "node:assert/strict";

import {
  buildDemoNameMap,
  clearActiveDemoIds,
  DEMO_NAMES,
  demoNameFor,
  setActiveDemoIds
} from "../lib/demo-roster";

const repoIds = (count: number, prefix = "repo"): string[] =>
  Array.from({ length: count }, (_, i) => `${prefix}-${i.toString().padStart(2, "0")}`);

test("buildDemoNameMap gives every id in a small set a unique name", () => {
  const ids = repoIds(8);
  const map = buildDemoNameMap(ids);
  assert.equal(map.size, ids.length);
  const names = new Set(map.values());
  assert.equal(names.size, ids.length, "all names should be unique");
});

test("buildDemoNameMap is stable across reorderings of the same id set", () => {
  const ids = repoIds(8);
  const map1 = buildDemoNameMap(ids);
  const map2 = buildDemoNameMap([...ids].reverse());
  for (const id of ids) {
    assert.equal(map1.get(id), map2.get(id), `mapping for ${id} drifted`);
  }
});

test("buildDemoNameMap deduplicates the input id set", () => {
  const map = buildDemoNameMap(["a", "a", "b"]);
  assert.equal(map.size, 2);
  assert.notEqual(map.get("a"), map.get("b"));
});

test("buildDemoNameMap cycles with -2, -3 suffixes past the roster size", () => {
  const ids = repoIds(DEMO_NAMES.length + 3);
  const map = buildDemoNameMap(ids);
  const names = [...map.values()];
  assert.equal(new Set(names).size, names.length, "all names still unique");
  const cycled = names.filter((n) => /-2$/.test(n));
  assert.ok(cycled.length >= 3, "expected at least 3 names with the -2 suffix");
});

test("buildDemoNameMap covers the exact roster size with no suffixes", () => {
  const ids = repoIds(DEMO_NAMES.length);
  const map = buildDemoNameMap(ids);
  for (const name of map.values()) {
    assert.ok(!/-\d+$/.test(name), `${name} should not carry a cycle suffix`);
  }
});

test("demoNameFor returns the active-set assignment when one is registered", () => {
  const ids = repoIds(8);
  setActiveDemoIds(ids);
  try {
    const expected = buildDemoNameMap(ids);
    for (const id of ids) {
      assert.equal(demoNameFor(id), expected.get(id));
    }
  } finally {
    clearActiveDemoIds();
  }
});

test("demoNameFor with an active set gives every visible id a unique name", () => {
  // This is the regression for #7: the previous hash-modulo picker
  // collided on small id sets (~80% collision probability for 8 draws
  // into 16 buckets). With the active-set registration, eight ids must
  // produce eight distinct names.
  const ids = repoIds(8);
  setActiveDemoIds(ids);
  try {
    const names = new Set(ids.map((id) => demoNameFor(id)));
    assert.equal(names.size, ids.length);
  } finally {
    clearActiveDemoIds();
  }
});

test("clearActiveDemoIds falls back to hash-modulo (stable per id)", () => {
  setActiveDemoIds(repoIds(4));
  const before = demoNameFor("not-in-the-active-set");
  clearActiveDemoIds();
  const after = demoNameFor("not-in-the-active-set");
  assert.equal(before, after, "fallback should be stable for the same id");
  assert.ok(DEMO_NAMES.includes(after));
});

test("setActiveDemoIds with the same fingerprint skips rebuilding", () => {
  setActiveDemoIds(["a", "b", "c"]);
  const first = demoNameFor("a");
  // Different order but same set — should yield the same name for "a".
  setActiveDemoIds(["c", "b", "a"]);
  const second = demoNameFor("a");
  assert.equal(first, second);
  clearActiveDemoIds();
});
