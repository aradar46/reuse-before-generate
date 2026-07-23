import { test } from "node:test";
import assert from "node:assert/strict";
import { buildQueryPlan } from "../../dist/query-plan.js";

test("buildQueryPlan normalizes explicit positional formulations", () => {
  const plan = buildQueryPlan("legacy description", ["legacy", "keywords"], {
    category: "  dependency   scanner ",
    outcome: "  finds   vulnerable packages ",
    synonyms: "  supply   chain security ",
  });

  assert.deepEqual(plan.formulations, {
    category: "dependency scanner",
    outcome: "finds vulnerable packages",
    synonyms: "supply chain security",
  });
});

test("buildQueryPlan supplies positional legacy category and outcome without synonyms", () => {
  const plan = buildQueryPlan(
    "  checks   repositories for licenses ",
    ["license", " compliance ", "scanner"],
  );

  assert.deepEqual(plan.formulations, {
    category: "license compliance scanner",
    outcome: "checks repositories for licenses",
  });
  assert.equal("synonyms" in plan.formulations, false);
});

test("buildQueryPlan detects a Python ecosystem when signals mention Python", () => {
  const plan = buildQueryPlan("formats Python source code", ["formatter"], {
    category: "formatter",
    outcome: "formats Python source code",
    synonyms: "python formatter",
  });

  assert.equal(plan.ecosystem, "python");
});

test("buildQueryPlan omits ecosystem for generic queries", () => {
  const plan = buildQueryPlan("coordinates team meetings", ["calendar"], {
    category: "calendar",
    outcome: "coordinates team meetings",
    synonyms: "scheduling",
  });

  assert.equal(plan.ecosystem, undefined);
});

test("explicit formulations retain ecosystem signals from the original input", () => {
  const plan = buildQueryPlan("legacy Python wording", ["python", "junk"], {
    category: "team calendar",
    outcome: "coordinate meeting availability",
    synonyms: "group scheduling",
  });

  assert.equal(plan.ecosystem, "python");
});
