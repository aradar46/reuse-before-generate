import { test } from "node:test";
import assert from "node:assert/strict";
import { parseArgs } from "../../dist/cli.js";

/** argv as node passes it: [execPath, scriptPath, ...userArgs] */
function argv(...userArgs: string[]): string[] {
  return ["node", "cli.js", ...userArgs];
}

test("parses a description with no keywords", () => {
  const out = parseArgs(argv("a tool that formats python code"));
  assert.equal(out.description, "a tool that formats python code");
  assert.equal(out.keywords, undefined);
});

test("joins an unquoted description spread across argv", () => {
  // A user who forgets the quotes still gets a usable description rather
  // than just the first word.
  const out = parseArgs(argv("a", "tool", "that", "formats"));
  assert.equal(out.description, "a tool that formats");
});

test("parses --keywords as a comma-separated list", () => {
  const out = parseArgs(argv("format python", "--keywords", "black,formatter,style"));
  assert.equal(out.description, "format python");
  assert.deepEqual(out.keywords, ["black", "formatter", "style"]);
});

test("accepts the -k short form and trims whitespace around entries", () => {
  const out = parseArgs(argv("format python", "-k", "black, formatter , style"));
  assert.deepEqual(out.keywords, ["black", "formatter", "style"]);
});

test("treats an empty keyword list as absent rather than as []", () => {
  // [] would mean "no usable keywords" downstream and skip every request;
  // undefined correctly falls back to extractKeywords.
  const out = parseArgs(argv("format python", "--keywords", ""));
  assert.equal(out.keywords, undefined);
});

test("treats a trailing --keywords with no value as absent", () => {
  const out = parseArgs(argv("format python", "--keywords"));
  assert.equal(out.description, "format python");
  assert.equal(out.keywords, undefined);
});

test("returns an empty description when none is given", () => {
  // main() exits 2 on this rather than searching for nothing.
  assert.equal(parseArgs(argv()).description, "");
  assert.equal(parseArgs(argv("--keywords", "a,b")).description, "");
});
