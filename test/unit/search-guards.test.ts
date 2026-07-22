import { test } from "node:test";
import assert from "node:assert/strict";
import { searchGitHub, searchNpm } from "../../dist/search.js";

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
