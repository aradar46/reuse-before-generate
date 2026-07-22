import { test } from "node:test";
import assert from "node:assert/strict";
import { getInstallId, buildEnvelope } from "../../dist/telemetry.js";

test("getInstallId returns the same id across calls (cached, not re-read)", () => {
  const a = getInstallId();
  const b = getInstallId();
  assert.equal(a, b);
  assert.ok(a.length > 0);
});

test("buildEnvelope carries the event, an install id, and an ISO timestamp", () => {
  const env = buildEnvelope({ type: "tool_invoked" });
  assert.equal(env.event.type, "tool_invoked");
  assert.ok(env.installId.length > 0);
  assert.ok(!Number.isNaN(Date.parse(env.timestamp)));
});

test("buildEnvelope carries no query content for a candidates_found event", () => {
  const env = buildEnvelope({ type: "candidates_found", count: 5, maintainedCount: 2 });
  const serialized = JSON.stringify(env);
  assert.doesNotMatch(serialized, /description|keyword|query/i);
});
