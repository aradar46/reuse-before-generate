import { test } from "node:test";
import assert from "node:assert/strict";
import { keywordsAsQuery, extractKeywords } from "../../dist/search.js";

test("keywordsAsQuery joins keywords with spaces", () => {
  assert.equal(keywordsAsQuery(["json", "viewer", "terminal"]), "json viewer terminal");
});

test("keywordsAsQuery drops whole words that would exceed the cap", () => {
  const out = keywordsAsQuery(["aaaa", "bbbb", "cccc"], 9);
  assert.equal(out, "aaaa bbbb");
});

test("keywordsAsQuery accepts a query exactly at the cap", () => {
  const out = keywordsAsQuery(["aaaa", "bbbb"], 9);
  assert.equal(out, "aaaa bbbb");
  assert.equal(out.length, 9);
});

test("keywordsAsQuery truncates rather than returning empty when the first word exceeds the cap", () => {
  // Regression: previously returned "", which npm rejects with
  // ERR_TEXT_LENGTH (its minimum text length is 2).
  const out = keywordsAsQuery(["supercalifragilistic"], 8);
  assert.equal(out, "supercal");
  assert.equal(out.length, 8);
});

test("keywordsAsQuery returns empty string for no keywords", () => {
  assert.equal(keywordsAsQuery([]), "");
});

test("extractKeywords keeps first-occurrence order and drops stop words", () => {
  const out = extractKeywords("A command-line tool that formats Python source code", 4);
  assert.deepEqual(out, ["command-line", "formats", "python", "code"]);
});

test("extractKeywords respects the max cap", () => {
  const out = extractKeywords("alpha bravo charlie delta echo foxtrot", 3);
  assert.equal(out.length, 3);
});

test("extractKeywords returns an empty array for an all-stop-word description", () => {
  assert.deepEqual(extractKeywords("the a an and or but for to of in"), []);
});

test("extractKeywords returns an empty array for punctuation-only input", () => {
  assert.deepEqual(extractKeywords("!!! ??? ..."), []);
});
