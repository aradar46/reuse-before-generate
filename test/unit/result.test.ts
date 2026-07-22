import { test } from "node:test";
import assert from "node:assert/strict";
import { ok, err, isOk } from "../../dist/result.js";

test("ok() wraps a value and is recognized by isOk", () => {
  const r = ok("github", [1, 2]);
  assert.equal(r.ok, true);
  assert.equal(isOk(r), true);
  if (r.ok) {
    assert.equal(r.source, "github");
    assert.deepEqual(r.value, [1, 2]);
  }
});

test("err() carries source and reason and is not ok", () => {
  const r = err("npm", "HTTP 503");
  assert.equal(r.ok, false);
  assert.equal(isOk(r), false);
  if (!r.ok) {
    assert.equal(r.source, "npm");
    assert.equal(r.reason, "HTTP 503");
  }
});
