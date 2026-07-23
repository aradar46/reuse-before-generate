import { test } from "node:test";
import assert from "node:assert/strict";
import { ok, err } from "../../dist/result.js";

test("ok() wraps a value and narrows to the success branch", () => {
  const r = ok("github", [1, 2]);
  assert.equal(r.ok, true);
  if (r.ok) {
    assert.equal(r.source, "github");
    assert.deepEqual(r.value, [1, 2]);
  }
});

test("err() carries source and reason and is not ok", () => {
  const r = err("npm", "HTTP 503");
  assert.equal(r.ok, false);
  if (!r.ok) {
    assert.equal(r.source, "npm");
    assert.equal(r.reason, "HTTP 503");
  }
});

test("results support the expanded discovery sources", () => {
  const r = ok("gitlab", "found");
  assert.equal(r.source, "gitlab");
});
