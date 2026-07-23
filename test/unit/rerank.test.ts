import { test } from "node:test";
import assert from "node:assert/strict";
import { buildRerankPrompt } from "../../dist/rerank.js";

const reuse = {
  source: "github",
  id: "acme/widget",
  name: "Widget",
  url: "https://github.com/acme/widget",
  description: "Automates widget workflows",
  stars: 17,
  pushedAt: "2026-07-20T00:00:00Z",
  kind: "open_source",
  repositoryUrl: "https://github.com/acme/widget",
  evidence: [
    {
      source: "github",
      sourceId: "acme/widget",
      sourceUrl: "https://github.com/acme/widget",
      destinationUrl: "https://github.com/acme/widget",
      title: "Widget",
      snippet: "First evidence snippet",
      query: "widget automation",
      rank: 1,
    },
    {
      source: "npm",
      sourceId: "widget",
      sourceUrl: "https://npmjs.com/package/widget",
      destinationUrl: "https://github.com/acme/widget",
      title: "widget",
      snippet: "Second evidence snippet",
      query: "widget workflow",
      rank: 3,
    },
  ],
  canonicalUrl: "https://github.com/acme/widget",
  pool: "reuse",
  retrievalScore: 0.03,
  maintained: true,
  maintenanceReason: "active within the last 3 days",
  daysSinceLastActivity: 3,
};

const competition = {
  source: "producthunt",
  id: "hosted-widget",
  name: "Hosted Widget",
  url: "https://hosted.example/widget",
  description: "Hosted widget automation",
  kind: "unknown",
  traction: "52 points",
  evidence: [{
    source: "producthunt",
    sourceId: "hosted-widget",
    sourceUrl: "https://producthunt.com/products/widget",
    destinationUrl: "https://hosted.example/widget",
    title: "Hosted Widget",
    snippet: "Launch evidence snippet",
    query: "widget automation",
    rank: 2,
  }],
  canonicalUrl: "https://hosted.example/widget",
  pool: "competition",
  retrievalScore: 0.02,
};

test("rerank prompt groups reuse and competition and renders every evidence item", () => {
  const prompt = buildRerankPrompt("automate widgets", [competition, reuse]);

  assert.match(prompt, /Projects you could reuse/);
  assert.match(prompt, /Products you would compete with/);
  assert.ok(
    prompt.indexOf("Projects you could reuse")
      < prompt.indexOf("Products you would compete with"),
  );
  assert.match(prompt, /kind: open_source/);
  assert.match(prompt, /kind: unknown/);
  assert.match(prompt, /traction: 17 stars/);
  assert.match(prompt, /health\/limits: active within the last 3 days/);
  assert.match(prompt, /source=github rank=1 query="widget automation".*First evidence snippet/s);
  assert.match(prompt, /source=npm rank=3 query="widget workflow".*Second evidence snippet/s);
  assert.match(prompt, /source=producthunt rank=2.*Launch evidence snippet/s);
});

test("rerank prompt makes maintenance claims only for verified reuse", () => {
  const prompt = buildRerankPrompt("automate widgets", [competition, reuse]);
  const competitionBlock = prompt.slice(prompt.indexOf("Products you would compete with"));

  assert.match(competitionBlock, /evidence is not a maintenance claim/i);
  assert.doesNotMatch(competitionBlock, /active within the last 3 days/);
});

test("rerank instructions require honest scoring and exact negative wording", () => {
  const prompt = buildRerankPrompt("automate widgets", [competition, reuse]);

  for (const dimension of [
    "function",
    "audience",
    "workflow",
    "reuse",
    "market",
    "evidence",
    "health",
  ]) {
    assert.match(prompt, new RegExp(dimension, "i"));
  }
  assert.match(prompt, /at most 3.*40\+.*per section/i);
  assert.match(prompt, /popularity.*context only/i);
  assert.match(prompt, /preserve.*unknown/i);
  assert.match(prompt, /do not pad/i);
  assert.match(prompt, /No strong match found in the sources searched\./);
  assert.doesNotMatch(prompt, /clear to build/i);
  assert.doesNotMatch(prompt, /no competitors?/i);
});
