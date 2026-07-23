import { test } from "node:test";
import assert from "node:assert/strict";
import { fuseCandidates } from "../../dist/fusion.js";

function candidate(overrides: Record<string, unknown> = {}) {
  return {
    source: "github",
    id: "acme/widget",
    name: "widget",
    url: "https://github.com/acme/widget",
    description: "A widget",
    kind: "unknown",
    repositoryUrl: "https://github.com/acme/widget",
    evidence: [{
      source: "github",
      sourceId: "acme/widget",
      sourceUrl: "https://github.com/acme/widget",
      destinationUrl: "https://github.com/acme/widget",
      title: "Widget",
      snippet: "A widget",
      query: "widget",
      rank: 1,
    }],
    ...overrides,
  };
}

test("fuseCandidates counts only the best rank for a source and query", () => {
  const [result] = fuseCandidates([
    candidate(),
    candidate({
      id: "acme/widget-copy",
      evidence: [{
        source: "github",
        sourceId: "acme/widget-copy",
        sourceUrl: "https://github.com/acme/widget",
        destinationUrl: "https://github.com/acme/widget",
        title: "Widget copy",
        snippet: "same source and query",
        query: "widget",
        rank: 2,
      }],
    }),
  ]);

  assert.equal(result.retrievalScore, 1 / 61);
});

test("fuseCandidates adds reciprocal-rank evidence from independent sources", () => {
  const [result] = fuseCandidates([
    candidate({
      evidence: [
        {
          source: "github",
          sourceId: "acme/widget",
          sourceUrl: "https://github.com/acme/widget",
          destinationUrl: "https://github.com/acme/widget",
          title: "Widget",
          snippet: "repository",
          query: "widget",
          rank: 1,
        },
        {
          source: "npm",
          sourceId: "widget",
          sourceUrl: "https://npmjs.com/package/widget",
          destinationUrl: "https://github.com/acme/widget",
          title: "widget",
          snippet: "package",
          query: "widget",
          rank: 1,
        },
      ],
    }),
  ]);

  assert.equal(result.retrievalScore, 2 / 61);
});

test("fuseCandidates assigns open source to reuse and others to competition", () => {
  const results = fuseCandidates([
    candidate(),
    candidate({
      id: "hosted-widget",
      url: "https://example.com/widget",
      repositoryUrl: undefined,
      kind: "commercial",
      evidence: [{
        source: "web",
        sourceId: "hosted-widget",
        sourceUrl: "https://example.com/widget",
        destinationUrl: "https://example.com/widget",
        title: "Widget pricing",
        snippet: "subscription pricing",
        query: "widget",
        rank: 1,
      }],
    }),
  ]);

  assert.deepEqual(results.map((result) => result.pool).sort(), ["competition", "reuse"]);
});

test("fuseCandidates derives canonicalUrl from candidate identity, not evidence", () => {
  const [result] = fuseCandidates([
    candidate({
      url: "https://example.com/widget/",
      repositoryUrl: undefined,
      evidence: [{
        source: "github",
        sourceId: "acme/widget",
        sourceUrl: "https://github.com/acme/widget",
        destinationUrl: "https://docs.example.com/widget",
        title: "Widget",
        snippet: "different destination",
        query: "widget",
        rank: 1,
      }],
    }),
  ]);

  assert.equal(result.canonicalUrl, "https://example.com/widget");
});
