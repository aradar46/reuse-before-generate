import { test } from "node:test";
import assert from "node:assert/strict";
import { maybeEnergyLine, formatEnergyLine } from "../../dist/energy.js";

test("maybeEnergyLine returns an empty string when the env var is unset", () => {
  delete process.env.REUSE_BEFORE_GENERATE_SHOW_ENERGY;
  assert.equal(maybeEnergyLine(), "");
});

test("maybeEnergyLine returns a line when the env var is set to 1", () => {
  process.env.REUSE_BEFORE_GENERATE_SHOW_ENERGY = "1";
  const out = maybeEnergyLine();
  delete process.env.REUSE_BEFORE_GENERATE_SHOW_ENERGY;
  assert.match(out, /Wh/);
  assert.match(out, /Estimate only/);
});

test("formatEnergyLine pluralizes correctly for one check", () => {
  const out = formatEnergyLine({ totalWhSaved: 250, rebuildsAvoided: 1, thisEventWh: 250 });
  assert.match(out, /1 check\b/);
  assert.doesNotMatch(out, /1 checks/);
});

test("formatEnergyLine pluralizes correctly for multiple checks", () => {
  const out = formatEnergyLine({ totalWhSaved: 500, rebuildsAvoided: 2, thisEventWh: 250 });
  assert.match(out, /2 checks/);
});
