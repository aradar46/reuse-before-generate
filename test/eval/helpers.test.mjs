import { test } from "node:test";
import assert from "node:assert/strict";
import {
  formulationHitRate,
  githubRequestsForPlan,
  rankExpectedTarget,
  summarize,
} from "./helpers.mjs";

const evidence = (source, query) => ({ source, query });

test("rankExpectedTarget matches id, name, or URL only inside the expected pool", () => {
  const candidates = [
    { pool: "reuse", id: "clone/calendly", name: "Calendly clone", url: "https://github.com/clone/calendly" },
    { pool: "competition", id: "calendly", name: "Calendly", url: "https://calendly.com" },
  ];

  const result = rankExpectedTarget(candidates, "competition", ["calendly.com"]);
  assert.equal(result.rank, 1);
  assert.equal(result.poolSize, 1);
  assert.equal(result.winner?.url, "https://calendly.com");
});

test("formulationHitRate measures which planned formulations retrieved the winner", () => {
  const queries = {
    category: "screen recorder",
    outcome: "record polished product demos",
    synonyms: "desktop capture video",
  };
  const winner = {
    evidence: [
      evidence("web", "screen recorder"),
      evidence("web", "record polished product demos software"),
    ],
  };

  assert.equal(formulationHitRate(winner, queries), 2 / 3);
});

test("GitHub pacing follows the actual generic or Python query plan", () => {
  assert.equal(githubRequestsForPlan({ formulations: {}, ecosystem: undefined }), 2);
  assert.equal(githubRequestsForPlan({ formulations: {}, ecosystem: "python" }), 3);
});

test("summary separates reuse and competition recall and attributes failures", () => {
  const summary = summarize([
    {
      id: "reuse-hit",
      expectedPool: "reuse",
      rank: 4,
      evidenceSources: ["crates"],
      sourceFailures: [],
      trueNegative: false,
      retrievalCandidates: 8,
    },
    {
      id: "market-miss",
      expectedPool: "competition",
      rank: null,
      evidenceSources: [],
      sourceFailures: [{ source: "web", reason: "challenge" }],
      trueNegative: false,
      retrievalCandidates: 3,
    },
    {
      id: "negative",
      expectedPool: "reuse",
      rank: null,
      evidenceSources: [],
      sourceFailures: [],
      trueNegative: true,
      retrievalCandidates: 5,
    },
  ], "2026-07-23T00:00:00.000Z");

  assert.deepEqual(summary.reuse, { cases: 1, recallAt5: 1, recallAt10: 1 });
  assert.deepEqual(summary.competition, { cases: 1, recallAt5: 0, recallAt10: 0 });
  assert.deepEqual(summary.uniqueSingleSourceWins, { crates: 1 });
  assert.deepEqual(summary.webAvailability, { attempted: 3, failed: 1 });
  assert.equal(summary.retrievalCandidatesOnTrueNegative, 5);
});
