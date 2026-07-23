import test from "node:test";
import assert from "node:assert/strict";
import type { RawCandidate } from "../../dist/candidate.js";
import { buildQueryPlan } from "../../dist/query-plan.js";
import { prepareCandidates } from "../../dist/verify.js";

const ACTIVE = "2026-07-22T12:00:00Z";

function candidate(
  source: RawCandidate["source"],
  name: string,
  description: string,
  queries: string[],
  stars = 0,
): RawCandidate {
  const url = source === "npm"
    ? `https://www.npmjs.com/package/${name}`
    : `https://github.com/acme/${name}`;
  return {
    source,
    id: name,
    name,
    url,
    description,
    stars,
    pushedAt: ACTIVE,
    archived: false,
    kind: "open_source",
    ...(source === "npm" ? { packageUrl: url } : { repositoryUrl: url }),
    evidence: queries.map((query) => ({
      source,
      sourceId: name,
      sourceUrl: url,
      destinationUrl: url,
      title: name,
      snippet: description,
      query,
      rank: 1,
      date: ACTIVE,
    })),
  };
}

test("application intent ranks a same-job repository above repeated npm package noise", async () => {
  const plan = buildQueryPlan("Keep in touch with people", [], {
    category: "personal relationship manager",
    outcome: "remember conversations and follow up with contacts",
    synonyms: "personal CRM contact organizer",
    constraints: ["self hosted"],
    artifactType: "application",
  });
  const prepared = await prepareCandidates([
    candidate(
      "npm",
      "personal-crm-react-widget",
      "React component for contact cards",
      ["personal relationship manager", "personal CRM contact organizer"],
    ),
    candidate(
      "github",
      "monica",
      "Personal relationship manager that stores conversations and reminders",
      ["personal relationship manager"],
    ),
  ], plan);

  assert.equal(prepared[0]?.name, "monica");
  const npm = prepared.find((item) => item.source === "npm");
  assert.ok(npm?.rankingPenalties?.some((item) =>
    item.includes("package-only evidence")));
  assert.ok((prepared[0]?.localScore ?? 0) > (npm?.localScore ?? 0));
});

test("library intent preserves exact npm packages as reusable results", async () => {
  const plan = buildQueryPlan("Need an auth middleware package", [], {
    category: "authentication middleware",
    outcome: "validate bearer tokens in requests",
    synonyms: "JWT request middleware",
    artifactType: "library",
  });
  const prepared = await prepareCandidates([
    candidate(
      "github",
      "auth-dashboard",
      "A dashboard application for authentication metrics",
      ["authentication middleware"],
    ),
    candidate(
      "npm",
      "jwt-request-middleware",
      "Authentication middleware library that validates bearer tokens",
      ["authentication middleware", "JWT request middleware"],
    ),
  ], plan);

  assert.equal(prepared[0]?.name, "jwt-request-middleware");
  assert.equal(
    prepared[0]?.rankingPenalties?.some((item) =>
      item.includes("package-only evidence")),
    false,
  );
});

test("constraint coverage can lift a fitting niche project above a popular generic one", async () => {
  const plan = buildQueryPlan("Browse JSON locally", [], {
    category: "terminal JSON viewer",
    outcome: "browse JSON from the command line",
    synonyms: "command line data browser",
    constraints: ["offline", "keyboard driven"],
    artifactType: "cli",
  });
  const prepared = await prepareCandidates([
    candidate(
      "github",
      "popular-json-viewer",
      "A web JSON viewer and formatter",
      ["terminal JSON viewer"],
      50_000,
    ),
    candidate(
      "github",
      "termglass",
      "Offline keyboard driven terminal JSON viewer",
      ["terminal JSON viewer offline keyboard driven"],
      2,
    ),
  ], plan);

  assert.equal(prepared[0]?.name, "termglass");
  assert.ok(prepared[0]?.rankingSignals?.includes("constraint: offline"));
  assert.ok(prepared[0]?.rankingSignals?.includes("constraint: keyboard driven"));
});

test("informational pages and component-shaped results expose transparent penalties", async () => {
  const plan = buildQueryPlan("Personal CRM", [], {
    category: "personal CRM",
    outcome: "manage relationships",
    synonyms: "contact organizer",
    artifactType: "application",
  });
  const prepared = await prepareCandidates([
    candidate(
      "npm",
      "crm-plugin",
      "Plugin and SDK for embedding a contact card component",
      ["personal CRM"],
    ),
  ], plan);

  assert.ok(prepared[0]?.rankingPenalties?.some((item) =>
    item.includes("component or integration")));
});
