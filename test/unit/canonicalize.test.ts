import { test } from "node:test";
import assert from "node:assert/strict";
import {
  canonicalizeUrl,
  classifyCandidate,
  mergeCandidates,
} from "../../dist/canonicalize.js";

function candidate(overrides: Record<string, unknown> = {}) {
  return {
    source: "github",
    id: "acme/widget",
    name: "widget",
    url: "https://github.com/acme/widget",
    description: "A widget",
    kind: "unknown",
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

test("canonicalizeUrl removes tracking, trailing slashes, and GitHub .git", () => {
  assert.equal(
    canonicalizeUrl(" HTTPS://WWW.GitHub.com/acme/widget.git/?utm_source=newsletter&ref=home&keep=yes#readme "),
    "https://github.com/acme/widget?keep=yes",
  );
});

test("canonicalizeUrl removes a terminal .git from GitLab repository URLs", () => {
  assert.equal(
    canonicalizeUrl("https://gitlab.com/acme/widget.git/"),
    "https://gitlab.com/acme/widget",
  );
});

test("canonicalizeUrl safely returns a trimmed invalid URL", () => {
  assert.equal(canonicalizeUrl("  not a url  "), "not a url");
});

test("mergeCandidates joins duplicate candidates and deduplicates evidence", () => {
  const merged = mergeCandidates([
    candidate(),
    candidate({
      source: "npm",
      id: "widget",
      repositoryUrl: "https://github.com/acme/widget/",
      evidence: [
        {
          source: "github",
          sourceId: "acme/widget",
          sourceUrl: "https://github.com/acme/widget",
          destinationUrl: "https://github.com/acme/widget",
          title: "Widget",
          snippet: "duplicate observation",
          query: "widget",
          rank: 2,
        },
        {
          source: "npm",
          sourceId: "widget",
          sourceUrl: "https://npmjs.com/package/widget",
          destinationUrl: "https://github.com/acme/widget",
          title: "widget",
          snippet: "package evidence",
          query: "widget package",
          rank: 1,
        },
      ],
    }),
  ]);

  assert.equal(merged.length, 1);
  assert.equal(merged[0].evidence.length, 2);
});

test("mergeCandidates uses candidate.url when no repository URL is present", () => {
  const merged = mergeCandidates([
    candidate({
      url: "https://example.com/widget",
      evidence: [{
        source: "github",
        sourceId: "acme/widget",
        sourceUrl: "https://github.com/acme/widget",
        destinationUrl: "https://docs.example.com/widget",
        title: "Widget",
        snippet: "first destination",
        query: "widget",
        rank: 1,
      }],
    }),
    candidate({
      source: "web",
      id: "widget-site",
      url: "https://example.com/widget",
      evidence: [{
        source: "web",
        sourceId: "widget-site",
        sourceUrl: "https://search.example.com/widget",
        destinationUrl: "https://www.example.com/pricing",
        title: "Widget site",
        snippet: "second destination",
        query: "widget",
        rank: 1,
      }],
    }),
  ]);

  assert.equal(merged.length, 1);
  assert.equal(merged[0].evidence.length, 2);
});

test("mergeCandidates retains the lowest rank for duplicate evidence", () => {
  const merged = mergeCandidates([
    candidate({
      evidence: [{
        source: "github",
        sourceId: "acme/widget",
        sourceUrl: "https://github.com/acme/widget",
        destinationUrl: "https://github.com/acme/widget",
        title: "Widget",
        snippet: "worse rank first",
        query: "widget",
        rank: 8,
      }],
    }),
    candidate({
      evidence: [{
        source: "github",
        sourceId: "acme/widget",
        sourceUrl: "https://github.com/acme/widget",
        destinationUrl: "https://github.com/acme/widget",
        title: "Widget",
        snippet: "better rank second",
        query: "widget",
        rank: 2,
      }],
    }),
  ]);

  assert.equal(merged[0].evidence.length, 1);
  assert.equal(merged[0].evidence[0].rank, 2);
});

test("mergeCandidates replaces an invalid duplicate rank with a valid rank", () => {
  const merged = mergeCandidates([
    candidate({
      evidence: [{
        source: "github",
        sourceId: "acme/widget",
        sourceUrl: "https://github.com/acme/widget",
        destinationUrl: "https://github.com/acme/widget",
        title: "Widget",
        snippet: "invalid rank first",
        query: "widget",
        rank: 0,
      }],
    }),
    candidate({
      evidence: [{
        source: "github",
        sourceId: "acme/widget",
        sourceUrl: "https://github.com/acme/widget",
        destinationUrl: "https://github.com/acme/widget",
        title: "Widget",
        snippet: "valid rank second",
        query: "widget",
        rank: 1,
      }],
    }),
  ]);

  assert.equal(merged[0].evidence[0].rank, 1);
});

test("classifyCandidate requires explicit commercial evidence", () => {
  assert.equal(classifyCandidate(candidate({ description: "A great business tool" })), "unknown");
  assert.equal(
    classifyCandidate(candidate({ description: "Hosted SaaS with subscription pricing" })),
    "commercial",
  );
  assert.equal(classifyCandidate(candidate({ repositoryUrl: "https://github.com/acme/widget" })), "open_source");
});
