import { test } from "node:test";
import assert from "node:assert/strict";
import { searchGitHub, searchNpm } from "../../dist/search.js";

// NOTE for Task 7: these tests stub `globalThis.fetch` because search.ts
// still calls fetch directly. Once search.ts routes through src/http.ts,
// this stub stops intercepting anything and the tests would pass VACUOUSLY
// — 0 calls always, whether or not the guard fires. Convert to
// setFetcher()/resetFetcher() as part of that rewiring.

/** Stubs global fetch, counting calls, and always restores it. */
async function countingFetch(fn: () => Promise<unknown>): Promise<number> {
  const original = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async () => {
    calls += 1;
    return new Response(JSON.stringify({ items: [], objects: [] }), { status: 200 });
  };
  try {
    await fn();
  } finally {
    globalThis.fetch = original;
  }
  return calls;
}

test("searchGitHub makes no request when keywords are empty", async () => {
  let out: unknown[] = [];
  const calls = await countingFetch(async () => {
    out = await searchGitHub("the a an and or", []);
  });
  assert.equal(calls, 0);
  assert.deepEqual(out, []);
});

test("searchNpm makes no request when keywords are empty", async () => {
  let out: unknown[] = [];
  const calls = await countingFetch(async () => {
    out = await searchNpm("the a an and or", []);
  });
  assert.equal(calls, 0);
  assert.deepEqual(out, []);
});

test("searchGitHub makes no request when keywords are non-empty but all junk", async () => {
  // Regression: guarding on array length alone let ["", " ", "a"] through —
  // non-empty, but joining to the query "   a", which spends two requests
  // (primary + low-star lane) on pure noise. The agent-supplied keywords
  // array is schema-checked for length, not content, so this is reachable.
  let out: unknown[] = [];
  const calls = await countingFetch(async () => {
    out = await searchGitHub("x", ["", " ", "a"]);
  });
  assert.equal(calls, 0);
  assert.deepEqual(out, []);
});

test("searchGitHub still searches when only some keywords are junk", async () => {
  // The filter must drop junk entries, not abandon the whole search when
  // one is present.
  const calls = await countingFetch(async () => {
    await searchGitHub("x", ["", "json", "viewer"]);
  });
  assert.equal(calls, 2);
});

test("searchGitHub makes no request when the description yields no keywords", async () => {
  // No override keywords supplied, so it falls back to extractKeywords,
  // which returns [] for an all-stop-word description.
  let out: unknown[] = [];
  const calls = await countingFetch(async () => {
    out = await searchGitHub("the a an and or but for to of in");
  });
  assert.equal(calls, 0);
  assert.deepEqual(out, []);
});
