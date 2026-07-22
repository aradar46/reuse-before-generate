import { test } from "node:test";
import assert from "node:assert/strict";
import { formatSourceFailures } from "../../dist/report.js";

test("returns an empty string when every source succeeded", () => {
  const out = formatSourceFailures([
    { ok: true, source: "github", value: [] },
    { ok: true, source: "npm", value: [] },
  ]);
  assert.equal(out, "");
});

test("names a single failing source and its reason", () => {
  const out = formatSourceFailures([
    { ok: true, source: "github", value: [] },
    { ok: false, source: "npm", reason: "npm search failed: HTTP 503" },
  ]);
  assert.match(out, /npm/);
  assert.match(out, /503/);
});

test("does not repeat the source name inside its own reason", () => {
  // The formatter prepends the source, so a reason carrying its own name
  // renders as "npm (npm search failed: HTTP 503)". Reasons stay bare.
  const out = formatSourceFailures([
    { ok: false, source: "npm", reason: "HTTP 503" },
    { ok: false, source: "pypi", reason: "HTTP 500" },
  ]);
  assert.equal(
    out,
    "Note: npm (HTTP 503); pypi (HTTP 500) — results below are from the remaining source(s) only.",
  );
  assert.doesNotMatch(out, /npm \(npm/);
});

test("names every failing source when more than one fails", () => {
  const out = formatSourceFailures([
    { ok: false, source: "github", reason: "HTTP 403" },
    { ok: false, source: "npm", reason: "HTTP 503" },
  ]);
  assert.match(out, /github/);
  assert.match(out, /npm/);
});
