import { test } from "node:test";
import assert from "node:assert/strict";
import { buildQueryPlan } from "../../dist/query-plan.js";

test("buildQueryPlan normalizes explicit formulations", () => {
  const plan = buildQueryPlan({
    category: "  dependency   scanner ",
    outcome: "  finds   vulnerable packages ",
    synonyms: ["  supply chain ", "SCA  ", " "],
    queries: ["  software   composition analysis  ", "  package   vulnerability scanner "],
  });

  assert.deepEqual(plan.formulations, [
    "software composition analysis",
    "package vulnerability scanner",
  ]);
  assert.equal(plan.category, "dependency scanner");
  assert.equal(plan.outcome, "finds vulnerable packages");
  assert.deepEqual(plan.synonyms, ["supply chain", "SCA"]);
});

test("buildQueryPlan supplies legacy category and outcome without inventing synonyms", () => {
  const plan = buildQueryPlan({
    description: "  checks   repositories for licenses ",
    keywords: ["license", " compliance ", "scanner"],
  });

  assert.equal(plan.category, "license compliance scanner");
  assert.equal(plan.outcome, "checks repositories for licenses");
  assert.deepEqual(plan.synonyms, []);
  assert.deepEqual(plan.formulations, ["license compliance scanner"]);
});

test("buildQueryPlan detects a Python ecosystem when signals mention Python", () => {
  const plan = buildQueryPlan({
    category: "formatter",
    outcome: "formats Python source code",
    synonyms: [],
  });

  assert.equal(plan.ecosystem, "python");
});

test("buildQueryPlan omits ecosystem for generic queries", () => {
  const plan = buildQueryPlan({
    category: "calendar",
    outcome: "coordinates team meetings",
    synonyms: ["scheduling"],
    queries: ["team calendar"],
  });

  assert.equal(plan.ecosystem, undefined);
});
