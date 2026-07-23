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
  rank = 1,
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
      rank,
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

test("ranking signals use the same per-evidence constraint claims shown to callers", async () => {
  const plan = buildQueryPlan("Private local application", [], {
    category: "private journal",
    outcome: "record personal notes",
    synonyms: "diary",
    constraints: ["offline", "local-only data"],
    artifactType: "application",
  });
  const raw = candidate(
    "github",
    "quiet-journal",
    "An offline private journal with local-only data",
    ["private journal"],
  );
  raw.evidence = raw.evidence.map((item) => ({
    ...item,
    snippet: "A private journal for recording personal notes",
  }));

  const [prepared] = await prepareCandidates([raw], plan);

  assert.deepEqual(prepared?.constraintEvidence, [
    { constraint: "offline", status: "unknown", sources: [] },
    { constraint: "local-only data", status: "unknown", sources: [] },
  ]);
  assert.equal(
    prepared?.rankingSignals?.some((signal) => signal.startsWith("constraint:")),
    false,
  );
});

test("application distribution evidence is exposed as a maturity signal", async () => {
  const plan = buildQueryPlan("Install a private journal", [], {
    category: "private journal",
    outcome: "record personal notes",
    synonyms: "diary",
    artifactType: "application",
  });
  const raw = candidate(
    "github",
    "quiet-journal",
    "A private journal for personal notes",
    ["private journal"],
  );
  raw.homepageUrl = "https://f-droid.org/packages/org.example.quietjournal";
  raw.evidence.push({
    source: "web",
    sourceId: raw.homepageUrl,
    sourceUrl: raw.homepageUrl,
    destinationUrl: raw.homepageUrl,
    title: "Quiet Journal",
    snippet: "Install Quiet Journal",
    query: "private journal Android F-Droid app",
    rank: 1,
  });

  const [prepared] = await prepareCandidates([raw], plan);

  assert.ok(prepared?.rankingSignals?.includes(
    "application distribution evidence",
  ));
});

test("competition uses a neutral existing-product tier", async () => {
  const plan = buildQueryPlan("Install a private journal", [], {
    category: "private journal",
    outcome: "record personal notes",
    synonyms: "diary",
    artifactType: "application",
  });
  const raw: RawCandidate = {
    source: "web",
    id: "quiet-journal",
    name: "Quiet Journal",
    url: "https://quiet.example",
    description: "A private journal application",
    kind: "unknown",
    evidence: [{
      source: "web",
      sourceId: "quiet-journal",
      sourceUrl: "https://quiet.example",
      destinationUrl: "https://quiet.example",
      title: "Quiet Journal",
      snippet: "A private journal application",
      query: "private journal official app",
      rank: 1,
    }],
  };

  const [prepared] = await prepareCandidates([raw], plan);

  assert.equal(prepared?.discoveryTier, "existing_product");
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

test("word normalization recognizes plural and inflected README language", async () => {
  const plan = buildQueryPlan("Scan Git repositories", [], {
    category: "repository secret detection",
    outcome: "find leaked credentials in Git history",
    synonyms: "Git secret scanner",
    artifactType: "cli",
  });
  const [gitleaks] = await prepareCandidates([
    candidate(
      "github",
      "gitleaks",
      "Find secrets and leaked credentials in Git repositories",
      ["repository secret detection"],
      28_000,
      14,
    ),
  ], plan);

  assert.ok(gitleaks?.rankingSignals?.includes(
    "normalized category coverage: 67%",
  ));
  assert.ok((gitleaks?.semanticFit ?? 0) > 0.5);
});

test("top five reserves authority and niche without promoting irrelevant popularity", async () => {
  const plan = buildQueryPlan("Scan Git repositories", [], {
    category: "repository secret detection",
    outcome: "find leaked credentials in Git history",
    synonyms: "Git secret scanner",
    artifactType: "cli",
  });
  const raw = Array.from({ length: 5 }, (_, index) =>
    candidate(
      "github",
      `niche-${index + 1}`,
      "Repository secret detection that finds leaked credentials in Git history",
      ["repository secret detection"],
      index,
    ));
  raw.push(candidate(
    "github",
    "gitleaks",
    "Find secrets and leaked credentials in Git repositories",
    ["repository secret detection"],
    28_000,
    14,
  ));
  raw.push(candidate(
    "github",
    "popular-video-downloader",
    "Popular command-line video downloader",
    ["repository secret detection"],
    200_000,
    2,
  ));

  const prepared = await prepareCandidates(raw, plan);
  const topFive = prepared.slice(0, 5).map((item) => item.name);

  assert.ok(topFive.includes("gitleaks"));
  assert.equal(topFive.includes("popular-video-downloader"), false);
  assert.ok(topFive.some((name) => name.startsWith("niche-")));
  assert.ok(prepared.find((item) => item.name === "gitleaks")
    ?.rankingSignals?.includes("authority slot"));
});

test("reviews and best-of pages receive an informational penalty", async () => {
  const plan = buildQueryPlan("Personal CRM", [], {
    category: "personal CRM",
    outcome: "manage relationships",
    synonyms: "contact organizer",
    artifactType: "application",
  });
  const [review] = await prepareCandidates([{
    source: "web",
    id: "https://example.com/blog/best-personal-crm",
    name: "A Review of the Best Personal CRM Tools",
    url: "https://example.com/blog/best-personal-crm",
    description: "Reviews and alternatives for personal CRM products",
    kind: "unknown",
    evidence: [{
      source: "web",
      sourceId: "review",
      sourceUrl: "https://example.com/blog/best-personal-crm",
      destinationUrl: "https://example.com/blog/best-personal-crm",
      title: "A Review of the Best Personal CRM Tools",
      snippet: "Reviews and alternatives",
      query: "personal CRM software product",
      rank: 1,
    }],
  }], plan);

  assert.ok(review?.rankingPenalties?.some((item) =>
    item.includes("informational page")));
  assert.ok((review?.localScore ?? 0) < 0);
});

test("application ranking demotes a minimal repository shell and exposes evidence confidence", async () => {
  const plan = buildQueryPlan("Build a private period tracker", [], {
    category: "private period tracker",
    outcome: "track menstrual cycles without cloud storage",
    synonyms: "menstrual cycle tracker",
    constraints: ["offline", "Android"],
    artifactType: "application",
  });
  const [implemented, shell] = await prepareCandidates([
    candidate(
      "github",
      "implemented-cycle",
      "Offline Android private period tracker",
      ["private period tracker offline Android"],
      0,
    ),
    candidate(
      "github",
      "readme-promise",
      "Offline Android private period tracker",
      ["private period tracker offline Android"],
      1,
    ),
  ].map((item, index) => ({
    ...item,
    repositorySizeKb: index === 0 ? 2_850 : 14,
    forks: 0,
  })), plan);

  assert.equal(implemented?.name, "implemented-cycle");
  assert.equal(implemented?.repositorySubstance, "substantial_repository");
  assert.equal(shell?.repositorySubstance, "minimal_repository");
  assert.ok(shell?.rankingPenalties?.includes(
    "minimal repository footprint for an application",
  ));
  assert.deepEqual(implemented?.constraintEvidence, [
    { constraint: "offline", status: "claimed", sources: ["github"] },
    { constraint: "Android", status: "claimed", sources: ["github"] },
  ]);
});
