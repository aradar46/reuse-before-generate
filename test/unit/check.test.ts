import { test } from "node:test";
import assert from "node:assert/strict";
import { runCheckBeforeBuilding } from "../../dist/check.js";

const queries = {
  category: "terminal json viewer",
  outcome: "browse JSON in a terminal",
  synonyms: "command line data browser",
};

test("all failed sources return an error with honest coverage", async () => {
  const events: unknown[] = [];
  const response = await runCheckBeforeBuilding(
    { description: "browse JSON in a terminal", keywords: ["json", "terminal", "viewer"], queries },
    {
      search: async () => [
        { ok: false, source: "github", reason: "HTTP 403" },
        { ok: false, source: "npm", reason: "HTTP 503" },
      ],
      prepare: async () => {
        throw new Error("must not prepare");
      },
      energy: () => "",
      track: (event) => events.push(event),
    },
  );

  assert.equal(response.isError, true);
  assert.match(
    response.content[0].text,
    /No required discovery source completed successfully/,
  );
  assert.match(response.content[0].text, /Searched: none/);
  assert.match(response.content[0].text, /Failed: github \(HTTP 403\); npm \(HTTP 503\)/);
  assert.deepEqual(events, [
    { type: "tool_invoked" },
    { type: "error", stage: "search" },
  ]);
});

test("empty retrieval gives the exact honest negative caveat and coverage", async () => {
  const response = await runCheckBeforeBuilding(
    { description: "browse JSON in a terminal", keywords: ["json", "terminal", "viewer"], queries },
    {
      search: async () => [
        { ok: true, source: "github", value: [] },
        { ok: false, source: "web", reason: "challenge response" },
      ],
      prepare: async () => [],
      energy: () => "",
      track: () => {},
    },
  );

  assert.equal(response.isError, undefined);
  assert.match(response.content[0].text, /No strong match found in the sources searched\./);
  assert.match(response.content[0].text, /does not prove/i);
  assert.match(response.content[0].text, /Searched: github/);
  assert.match(response.content[0].text, /Failed: web/);
  assert.doesNotMatch(response.content[0].text, /clear to build/i);
});

test("an empty prepared set gives the same cautious conclusion", async () => {
  const response = await runCheckBeforeBuilding(
    { description: "browse JSON in a terminal", keywords: ["json", "terminal", "viewer"], queries },
    {
      search: async () => [{
        ok: true,
        source: "github",
        value: [{ id: "inactive" }],
      }],
      prepare: async () => [],
      energy: () => "",
      track: () => {},
    },
  );

  assert.match(response.content[0].text, /No strong match found in the sources searched\./);
  assert.match(response.content[0].text, /inactive/i);
  assert.doesNotMatch(response.content[0].text, /clear to build/i);
});

test("pipeline passes formulations, counts only prepared reuse, and appends coverage", async () => {
  let seenQueries: unknown;
  const events: unknown[] = [];
  const prepared = [
    {
      source: "github",
      id: "acme/widget",
      name: "Widget",
      url: "https://github.com/acme/widget",
      description: "Widget workflows",
      kind: "open_source",
      evidence: [],
      canonicalUrl: "https://github.com/acme/widget",
      pool: "reuse",
      retrievalScore: 1,
      maintained: true,
      maintenanceReason: "active",
      daysSinceLastActivity: 1,
    },
    {
      source: "web",
      id: "hosted",
      name: "Hosted",
      url: "https://hosted.example",
      description: "Hosted widget",
      kind: "commercial",
      evidence: [],
      canonicalUrl: "https://hosted.example",
      pool: "competition",
      retrievalScore: 0.5,
    },
  ];
  const response = await runCheckBeforeBuilding(
    { description: "browse JSON in a terminal", keywords: ["json", "terminal", "viewer"], queries },
    {
      search: async (_description, _keywords, passedQueries) => {
        seenQueries = passedQueries;
        return [{ ok: true, source: "github", value: [{ id: "raw" }] }];
      },
      prepare: async () => prepared,
      energy: () => "\nEnergy note",
      track: (event) => events.push(event),
    },
  );

  assert.deepEqual(seenQueries, queries);
  assert.match(response.content[0].text, /Projects you could reuse/);
  assert.match(response.content[0].text, /Products you would compete with/);
  assert.match(response.content[0].text, /Energy note/);
  assert.match(response.content[0].text, /Search coverage:/);
  assert.deepEqual(events.at(-1), {
    type: "candidates_found",
    count: 1,
    maintainedCount: 1,
  });
  assert.doesNotMatch(JSON.stringify(events), /terminal json|browse JSON/i);
});
