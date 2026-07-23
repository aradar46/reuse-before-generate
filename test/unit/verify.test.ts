import { test } from "node:test";
import assert from "node:assert/strict";
import { prepareCandidates, verifyCandidate } from "../../dist/verify.js";

function daysAgo(n: number): string {
  return new Date(Date.now() - n * 24 * 60 * 60 * 1000).toISOString();
}

const base = {
  source: "github" as const,
  id: "a/b",
  name: "a/b",
  url: "https://github.com/a/b",
  description: "x",
};

test("a repo pushed today is maintained", async () => {
  const v = await verifyCandidate({ ...base, pushedAt: daysAgo(0) });
  assert.equal(v.maintained, true);
});

test("a repo pushed 364 days ago is maintained", async () => {
  const v = await verifyCandidate({ ...base, pushedAt: daysAgo(364) });
  assert.equal(v.maintained, true);
  // The day count itself is surfaced to the calling agent as a scoring
  // input, so assert the number, not just the boolean.
  assert.equal(v.daysSinceLastActivity, 364);
});

test("a repo pushed exactly 365 days ago is maintained (boundary is inclusive)", async () => {
  const v = await verifyCandidate({ ...base, pushedAt: daysAgo(365) });
  assert.equal(v.maintained, true);
});

test("a repo pushed 366 days ago is not maintained", async () => {
  const v = await verifyCandidate({ ...base, pushedAt: daysAgo(366) });
  assert.equal(v.maintained, false);
  assert.match(v.maintenanceReason, /no activity in 366 days/);
});

test("an archived repo is not maintained even if pushed today", async () => {
  const v = await verifyCandidate({ ...base, pushedAt: daysAgo(0), archived: true });
  assert.equal(v.maintained, false);
  assert.equal(v.maintenanceReason, "repository is archived");
});

test("a missing date is reported as missing", async () => {
  const v = await verifyCandidate({ ...base, pushedAt: undefined });
  assert.equal(v.maintained, false);
  assert.equal(v.maintenanceReason, "no activity date available");
  assert.equal(v.daysSinceLastActivity, null);
});

test("a malformed date is reported distinctly from a missing one", async () => {
  const v = await verifyCandidate({ ...base, pushedAt: "not-a-date" });
  assert.equal(v.maintained, false);
  assert.equal(v.maintenanceReason, "unparseable activity date: not-a-date");
});

test("a bare numeric date is unparseable, not a very old project", async () => {
  // Regression: `new Date("0")` yields the year 2000 and `new Date("99")`
  // yields 1998 — both valid Dates, so Number.isNaN alone lets them through
  // and reports them as genuinely stale projects ~9700 days old. Every
  // source sends full ISO 8601, so a bare number is bad data.
  for (const raw of ["0", "99", "2024", "0000"]) {
    const v = await verifyCandidate({ ...base, pushedAt: raw });
    assert.equal(v.maintained, false, `${raw} should not be maintained`);
    assert.equal(v.maintenanceReason, `unparseable activity date: ${raw}`);
    assert.equal(v.daysSinceLastActivity, null);
  }
});

test("an empty-string date is reported as missing", async () => {
  const v = await verifyCandidate({ ...base, pushedAt: "" });
  assert.equal(v.maintained, false);
  assert.equal(v.maintenanceReason, "no activity date available");
});

test("an archived repo with a bad date reports both facts", async () => {
  // Archived is the headline reason, but swallowing the date problem would
  // hide shape drift on exactly the candidates most likely to expose it.
  const v = await verifyCandidate({ ...base, pushedAt: "not-a-date", archived: true });
  assert.equal(v.maintained, false);
  assert.match(v.maintenanceReason, /archived/);
  assert.match(v.maintenanceReason, /unparseable activity date: not-a-date/);
});

test("an archived repo with a good date reports only the archive status", async () => {
  const v = await verifyCandidate({ ...base, pushedAt: daysAgo(10), archived: true });
  assert.equal(v.maintenanceReason, "repository is archived");
});

test("a future date is treated as active, not as an error", async () => {
  const v = await verifyCandidate({ ...base, pushedAt: daysAgo(-2) });
  assert.equal(v.maintained, true);
});

function rawCandidate(overrides: Record<string, unknown> = {}) {
  return {
    source: "github",
    id: "acme/widget",
    name: "widget",
    url: "https://github.com/acme/widget",
    description: "A useful widget",
    kind: "open_source",
    repositoryUrl: "https://github.com/acme/widget",
    pushedAt: daysAgo(5),
    evidence: [{
      source: "github",
      sourceId: "acme/widget",
      sourceUrl: "https://github.com/acme/widget",
      destinationUrl: "https://github.com/acme/widget",
      title: "widget",
      snippet: "A useful widget",
      query: "widget",
      rank: 2,
    }],
    ...overrides,
  };
}

test("prepareCandidates drops inactive open-source reuse candidates", async () => {
  const prepared = await prepareCandidates([
    rawCandidate({ pushedAt: daysAgo(500) }),
  ]);

  assert.deepEqual(prepared, []);
});

test("prepareCandidates retains competition with no activity without inventing maintenance", async () => {
  const prepared = await prepareCandidates([
    rawCandidate({
      source: "web",
      id: "hosted-widget",
      url: "https://example.com/widget",
      repositoryUrl: undefined,
      pushedAt: undefined,
      kind: "commercial",
      description: "Hosted widget with subscription pricing",
      evidence: [{
        source: "web",
        sourceId: "hosted-widget",
        sourceUrl: "https://search.example/results/widget",
        destinationUrl: "https://example.com/widget",
        title: "Hosted widget",
        snippet: "Subscription pricing",
        query: "widget",
        rank: 1,
      }],
    }),
  ]);

  assert.equal(prepared.length, 1);
  assert.equal(prepared[0]?.pool, "competition");
  assert.equal("maintained" in prepared[0], false);
  assert.equal("maintenanceReason" in prepared[0], false);
});

test("prepareCandidates preserves ranked fields and retrieval-score ordering", async () => {
  const prepared = await prepareCandidates([
    rawCandidate(),
    rawCandidate({
      source: "web",
      id: "hosted-widget",
      url: "https://example.com/widget",
      repositoryUrl: undefined,
      kind: "commercial",
      evidence: [{
        source: "web",
        sourceId: "hosted-widget",
        sourceUrl: "https://example.com/widget",
        destinationUrl: "https://example.com/widget",
        title: "Hosted widget",
        snippet: "Hosted SaaS pricing",
        query: "widget",
        rank: 1,
      }],
    }),
  ]);

  assert.deepEqual(
    prepared.map((candidate) => candidate.canonicalUrl),
    ["https://example.com/widget", "https://github.com/acme/widget"],
  );
  assert.ok(prepared[0].retrievalScore > prepared[1].retrievalScore);
  assert.equal(prepared[1]?.pool, "reuse");
  assert.equal(prepared[1] && "maintained" in prepared[1], true);
});

test("fresh registry activity wins over an old launch date for the same repository", async () => {
  const repositoryUrl = "https://github.com/acme/widget";
  const currentActivity = daysAgo(2);
  const prepared = await prepareCandidates([
    rawCandidate({
      source: "hackernews",
      id: "launch-1",
      url: repositoryUrl,
      repositoryUrl: undefined,
      pushedAt: daysAgo(800),
      kind: "unknown",
      evidence: [{
        source: "hackernews",
        sourceId: "launch-1",
        sourceUrl: "https://news.ycombinator.com/item?id=1",
        destinationUrl: repositoryUrl,
        title: "Show HN: Widget",
        snippet: "Widget launch",
        query: "widget",
        rank: 1,
        date: daysAgo(800),
      }],
    }),
    rawCandidate({
      source: "crates",
      id: "widget",
      url: repositoryUrl,
      repositoryUrl,
      pushedAt: currentActivity,
      evidence: [{
        source: "crates",
        sourceId: "widget",
        sourceUrl: "https://crates.io/crates/widget",
        destinationUrl: repositoryUrl,
        title: "widget",
        snippet: "Widget crate",
        query: "widget",
        rank: 1,
        date: currentActivity,
      }],
    }),
  ]);

  assert.equal(prepared.length, 1);
  assert.equal(prepared[0]?.pool, "reuse");
  assert.equal(prepared[0]?.pushedAt, currentActivity);
  assert.equal(prepared[0] && "maintained" in prepared[0], true);
});
