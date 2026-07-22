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

test("keywordsAsQuery skips empty entries rather than emitting an empty query", () => {
  // The fallback must not assume keywords[0] is usable: an empty or
  // whitespace-only first entry would otherwise produce the empty `text=`
  // that npm rejects with ERR_TEXT_LENGTH, which is the exact bug the
  // fallback exists to prevent.
  assert.equal(keywordsAsQuery(["", "viewer"]), "viewer");
  assert.equal(keywordsAsQuery(["   ", "json"]), "json");
});

test("keywordsAsQuery output is always URL-encodable", () => {
  // Regression: truncating with a raw .slice() can cut an astral character
  // (emoji, CJK extensions) mid-surrogate-pair, leaving a lone surrogate
  // that makes encodeURIComponent throw "URI malformed". That turned a
  // handled 400 into an uncaught crash. The 'a' prefix forces an odd offset
  // so the 64-char cut lands inside a pair.
  const q = keywordsAsQuery(["a" + "\u{1F389}".repeat(40)]);
  assert.doesNotThrow(() => encodeURIComponent(q));
  assert.ok(q.length <= 64);

  const odd = keywordsAsQuery(["\u{1F389}".repeat(40)], 63);
  assert.doesNotThrow(() => encodeURIComponent(odd));
});

test("keywordsAsQuery drops keywords below npm's 2-char floor", () => {
  // npm rejects `text` outside 2-64 chars, so a query that reduces to a
  // single character is rejected exactly like an empty one. The tool schema
  // constrains the keywords array's length but not each entry's content, so
  // a 1-char keyword is reachable from a real call.
  assert.equal(keywordsAsQuery(["a"]), "");
  assert.equal(keywordsAsQuery(["a", "json"]), "json");
});

test("keywordsAsQuery returns empty string when every keyword is blank", () => {
  // Nothing usable to send. Callers must treat an empty query as "skip the
  // request" — Task 5 adds that guard in searchNpm.
  assert.equal(keywordsAsQuery(["", "   "]), "");
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
