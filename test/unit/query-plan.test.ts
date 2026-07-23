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

test("buildQueryPlan preserves explicit constraints and artifact type", () => {
  const plan = buildQueryPlan(
    "A private mobile cycle tracker",
    ["cycle", "tracker", "mobile"],
    {
      category: "period cycle tracker",
      outcome: "track menstrual cycles",
      synonyms: "fertility calendar",
      constraints: ["privacy", "offline", "Android iOS"],
      artifactType: "application",
    },
  );

  assert.deepEqual(plan.constraints, ["privacy", "offline", "Android iOS"]);
  assert.equal(plan.artifactType, "application");
});

test("buildQueryPlan infers artifact type for older callers", () => {
  assert.equal(
    buildQueryPlan(
      "A command-line utility for searching files",
      ["terminal", "search", "regex"],
    ).artifactType,
    "cli",
  );
  assert.equal(
    buildQueryPlan(
      "A TypeScript library for parsing configuration",
      ["typescript", "parser", "configuration"],
    ).artifactType,
    "library",
  );
  assert.equal(
    buildQueryPlan(
      "A hosted service for collecting application logs",
      ["logs", "observability", "hosted"],
    ).artifactType,
    "service",
  );
  assert.equal(
    buildQueryPlan(
      "Something for organizing personal relationships",
      ["relationships", "organizer", "contacts"],
    ).artifactType,
    "application",
  );
});

test("buildQueryPlan normalizes and deduplicates constraints", () => {
  const plan = buildQueryPlan("A private tracker", ["private", "tracker"], {
    category: "personal tracker",
    outcome: "track private records",
    synonyms: "private journal",
    constraints: [" privacy ", "Offline", "offline", ""],
  });

  assert.deepEqual(plan.constraints, ["privacy", "Offline"]);
});

test("buildQueryPlan preserves ordered priorities and deduplicates them", () => {
  const plan = buildQueryPlan("A mobile tracker", ["mobile", "tracker"], {
    category: "personal tracker",
    outcome: "track private records",
    synonyms: "private journal",
    priorities: [" Android ", "iOS", "android", ""],
  });

  assert.deepEqual(plan.priorities, ["Android", "iOS"]);
});

test("buildQueryPlan preserves caller keyword hints for independent retrieval", () => {
  const plan = buildQueryPlan(
    "Debug a failing workflow interactively",
    [" GitHub Actions ", "tmate", "ACT", "tmate", ""],
    {
      category: "CI workflow debugger",
      outcome: "inspect a running CI job",
      synonyms: "interactive runner shell",
    },
  );

  assert.deepEqual(plan.keywordHints, ["GitHub Actions", "tmate", "ACT"]);
});
