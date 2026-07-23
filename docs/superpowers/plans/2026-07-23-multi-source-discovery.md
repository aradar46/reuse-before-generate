# Multi-source Discovery Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Expand zero-key discovery beyond GitHub so the tool separately surfaces maintained reusable software and commercial or hosted competitors.

**Architecture:** Keep source adapters independent and normalize every hit into a shared candidate/evidence model. A bounded query planner controls requests, canonicalization merges identities, reciprocal-rank fusion selects candidates, and the calling agent remains responsible for semantic judgment.

**Tech Stack:** TypeScript 5.7, Node.js 18+, MCP SDK, Zod, Node test runner, `fast-xml-parser`, public HTTP APIs and feeds.

---

## File structure

**Create**

- `src/candidate.ts` — normalized candidates, evidence, result pools, and shared source-facing types.
- `src/query-plan.ts` — query fallback, normalization, ecosystem detection, and bounded per-source plans.
- `src/canonicalize.ts` — URL identity normalization and evidence-preserving deduplication.
- `src/fusion.ts` — fixed-formula reciprocal-rank fusion and pool assignment.
- `src/sources/gitlab.ts` — unauthenticated GitLab public-project adapter.
- `src/sources/hacker-news.ts` — Show HN Algolia adapter.
- `src/sources/registries.ts` — conditional crates.io, RubyGems, Packagist, and Maven Central adapters.
- `src/sources/product-hunt.ts` — Product Hunt RSS adapter.
- `src/sources/duckduckgo.ts` — isolated DuckDuckGo HTML parser and best-effort adapter.
- `test/fixtures/duckduckgo/results.html` — deterministic result-page fixture.
- `test/fixtures/duckduckgo/challenge.html` — deterministic blocked-page fixture.
- Focused unit tests matching each module above.

**Modify**

- `src/result.ts` — expand the source identifier union.
- `src/search.ts` — retain GitHub/npm compatibility exports and orchestrate all adapters.
- `src/schemas.ts` — add upstream response schemas.
- `src/verify.ts` — verify only reusable artifacts and preserve retrieval metadata.
- `src/rerank.ts` — emit separate reuse and competition instructions with evidence.
- `src/report.ts` — format complete coverage, partial failure, and all-failed states.
- `src/index.ts` — accept optional query formulations and drive the new pipeline.
- `src/cli.ts` — accept formulations and display both result pools.
- `test/eval/cases.mjs` and `test/eval/run.mjs` — score both result classes and source contribution.
- `README.md`, `docs/how-it-works.md`, and `docs/findings.md` — document behavior, limitations, and measured results.
- `package.json`, `package-lock.json`, and `server.json` — add the RSS parser and align the feature release version.

### Task 1: Shared candidate model and bounded query plan

**Files:**

- Create: `src/candidate.ts`
- Create: `src/query-plan.ts`
- Create: `test/unit/query-plan.test.ts`
- Modify: `src/result.ts`

- [ ] **Step 1: Write the failing query-plan tests**

```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { buildQueryPlan } from "../../dist/query-plan.js";

test("explicit formulations are normalized without inventing terms", () => {
  const plan = buildQueryPlan(
    "inspect JSON in a terminal",
    ["json", "viewer", "terminal"],
    {
      category: " terminal JSON viewer ",
      outcome: " inspect and navigate JSON ",
      synonyms: " JSON TUI processor ",
    },
  );
  assert.deepEqual(plan.formulations, {
    category: "terminal JSON viewer",
    outcome: "inspect and navigate JSON",
    synonyms: "JSON TUI processor",
  });
});

test("legacy input falls back to keywords and description", () => {
  const plan = buildQueryPlan(
    "inspect JSON in a terminal",
    ["json", "viewer", "terminal"],
  );
  assert.deepEqual(plan.formulations, {
    category: "json viewer terminal",
    outcome: "inspect JSON in a terminal",
  });
});

test("python is conditional rather than an always-on lane", () => {
  assert.equal(buildQueryPlan("format Python code", ["python", "formatter"]).ecosystem, "python");
  assert.equal(buildQueryPlan("terminal JSON viewer", ["json", "viewer"]).ecosystem, undefined);
});
```

- [ ] **Step 2: Run the new test and verify the module is missing**

Run: `npm run build && node --test test/unit/query-plan.test.ts`

Expected: FAIL because `dist/query-plan.js` does not exist.

- [ ] **Step 3: Add the normalized types and query planner**

```ts
// src/candidate.ts
import type { Source } from "./result.js";

export type CandidateKind = "open_source" | "commercial" | "unknown";
export type ResultPool = "reuse" | "competition";
export type Ecosystem = "python" | "rust" | "ruby" | "php" | "jvm";

export interface QueryFormulations {
  category: string;
  outcome: string;
  synonyms?: string;
}

export interface Evidence {
  source: Source;
  sourceId: string;
  sourceUrl: string;
  destinationUrl: string;
  title: string;
  snippet: string;
  query: string;
  rank: number;
  date?: string;
}

export interface RawCandidate {
  source: Source;
  id: string;
  name: string;
  url: string;
  description: string;
  kind: CandidateKind;
  evidence: Evidence[];
  repositoryUrl?: string;
  packageUrl?: string;
  stars?: number;
  traction?: string;
  pushedAt?: string;
  archived?: boolean;
}

export interface RankedCandidate extends RawCandidate {
  canonicalUrl: string;
  pool: ResultPool;
  retrievalScore: number;
}
```

```ts
// src/query-plan.ts
import type { Ecosystem, QueryFormulations } from "./candidate.js";

export interface QueryInput {
  category: string;
  outcome: string;
  synonyms: string;
}

export interface QueryPlan {
  formulations: QueryFormulations;
  ecosystem?: Ecosystem;
}

function clean(value: string): string {
  return value.trim().replace(/\s+/g, " ");
}

function detectEcosystem(text: string): Ecosystem | undefined {
  if (/\bpython|pypi\b/i.test(text)) return "python";
  if (/\brust|cargo|crate\b/i.test(text)) return "rust";
  if (/\bruby|gem\b/i.test(text)) return "ruby";
  if (/\bphp|composer|packagist\b/i.test(text)) return "php";
  if (/\bjava|kotlin|scala|jvm|maven\b/i.test(text)) return "jvm";
  return undefined;
}

export function buildQueryPlan(
  description: string,
  keywords: string[],
  queries?: QueryInput,
): QueryPlan {
  const category = clean(queries?.category ?? keywords.join(" "));
  const outcome = clean(queries?.outcome ?? description);
  const synonyms = clean(queries?.synonyms ?? "");
  const formulations: QueryFormulations = {
    category,
    outcome,
    ...(synonyms && synonyms !== category && synonyms !== outcome ? { synonyms } : {}),
  };
  return {
    formulations,
    ecosystem: detectEcosystem(
      [description, keywords.join(" "), category, outcome, synonyms].join(" "),
    ),
  };
}
```

Expand `Source` in `src/result.ts`:

```ts
export type Source =
  | "github"
  | "npm"
  | "python"
  | "gitlab"
  | "hackernews"
  | "crates"
  | "rubygems"
  | "packagist"
  | "maven"
  | "producthunt"
  | "web";
```

- [ ] **Step 4: Build and run the focused tests**

Run: `npm run build && node --test test/unit/query-plan.test.ts test/unit/result.test.ts`

Expected: all tests PASS.

- [ ] **Step 5: Commit**

```bash
git add src/candidate.ts src/query-plan.ts src/result.ts test/unit/query-plan.test.ts
git commit -m "Add multi-source candidate and query models"
```

### Task 2: Canonical deduplication and reciprocal-rank fusion

**Files:**

- Create: `src/canonicalize.ts`
- Create: `src/fusion.ts`
- Create: `test/unit/canonicalize.test.ts`
- Create: `test/unit/fusion.test.ts`

- [ ] **Step 1: Write failing identity and fusion tests**

```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { canonicalizeUrl, classifyCandidate, mergeCandidates } from "../../dist/canonicalize.js";
import type { RawCandidate } from "../../dist/candidate.js";

const base: RawCandidate = {
  source: "github",
  id: "owner/repo",
  name: "owner/repo",
  url: "https://github.com/owner/repo/",
  repositoryUrl: "https://github.com/owner/repo.git",
  description: "A useful project",
  kind: "open_source",
  evidence: [{
    source: "github",
    sourceId: "owner/repo",
    sourceUrl: "https://github.com/owner/repo",
    destinationUrl: "https://github.com/owner/repo",
    title: "owner/repo",
    snippet: "A useful project",
    query: "useful project",
    rank: 1,
  }],
};

test("canonicalizeUrl removes tracking, fragments, trailing slash and .git", () => {
  assert.equal(
    canonicalizeUrl("https://GitHub.com/owner/repo.git/?utm_source=x#readme"),
    "https://github.com/owner/repo",
  );
});

test("mergeCandidates keeps independent evidence once", () => {
  const merged = mergeCandidates([
    base,
    {
      ...base,
      source: "hackernews",
      url: "https://github.com/owner/repo",
      evidence: [{
        ...base.evidence[0],
        source: "hackernews",
        sourceId: "42",
        sourceUrl: "https://news.ycombinator.com/item?id=42",
        rank: 3,
      }],
    },
  ]);
  assert.equal(merged.length, 1);
  assert.equal(merged[0].evidence.length, 2);
});

test("classification requires explicit commercial evidence", () => {
  const [commercial] = mergeCandidates([{
    ...base,
    source: "hackernews",
    repositoryUrl: undefined,
    kind: "unknown",
    url: "https://hosted.test",
    evidence: [{
      ...base.evidence[0],
      source: "hackernews",
      destinationUrl: "https://hosted.test",
      snippet: "A hosted SaaS with paid plans",
    }],
  }]);
  assert.equal(classifyCandidate(commercial), "commercial");
  assert.equal(classifyCandidate({ ...commercial, kind: "unknown", evidence: [] }), "unknown");
});
```

```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { fuseCandidates } from "../../dist/fusion.js";
import type { RawCandidate } from "../../dist/candidate.js";

test("RRF counts the best occurrence for each source/query pair", () => {
  const candidate: RawCandidate = {
    source: "github",
    id: "a/b",
    name: "a/b",
    url: "https://github.com/a/b",
    description: "x",
    kind: "open_source",
    evidence: [
      { source: "github", sourceId: "a/b", sourceUrl: "https://github.com/a/b", destinationUrl: "https://github.com/a/b", title: "a/b", snippet: "x", query: "viewer", rank: 1 },
      { source: "github", sourceId: "a/b", sourceUrl: "https://github.com/a/b", destinationUrl: "https://github.com/a/b", title: "a/b", snippet: "x", query: "viewer", rank: 8 },
      { source: "hackernews", sourceId: "1", sourceUrl: "https://news.ycombinator.com/item?id=1", destinationUrl: "https://github.com/a/b", title: "a/b", snippet: "x", query: "processor", rank: 2 },
    ],
  };
  const [ranked] = fuseCandidates([candidate]);
  assert.equal(ranked.pool, "reuse");
  assert.equal(ranked.retrievalScore, 1 / 61 + 1 / 62);
});
```

- [ ] **Step 2: Run tests and verify missing exports**

Run: `npm run build && node --test test/unit/canonicalize.test.ts test/unit/fusion.test.ts`

Expected: FAIL because both modules are missing.

- [ ] **Step 3: Implement deterministic identity, merge, and fusion**

```ts
// src/canonicalize.ts
import type { Evidence, RawCandidate } from "./candidate.js";

export function canonicalizeUrl(raw: string): string {
  try {
    const url = new URL(raw);
    url.hostname = url.hostname.toLowerCase().replace(/^www\./, "");
    url.hash = "";
    for (const key of [...url.searchParams.keys()]) {
      if (/^(utm_|ref$|referrer$)/i.test(key)) url.searchParams.delete(key);
    }
    url.pathname = url.pathname.replace(/\.git\/?$/, "").replace(/\/+$/, "");
    return url.toString().replace(/\/$/, "");
  } catch {
    return raw.trim().replace(/\/+$/, "");
  }
}

function identity(candidate: RawCandidate): string {
  return canonicalizeUrl(candidate.repositoryUrl ?? candidate.url);
}

function evidenceKey(e: Evidence): string {
  return `${e.source}\0${e.sourceId}\0${e.query}`;
}

export function mergeCandidates(candidates: RawCandidate[]): RawCandidate[] {
  const merged = new Map<string, RawCandidate>();
  for (const candidate of candidates) {
    const key = identity(candidate);
    const previous = merged.get(key);
    if (!previous) {
      merged.set(key, { ...candidate, evidence: [...candidate.evidence] });
      continue;
    }
    const evidence = new Map(previous.evidence.map((item) => [evidenceKey(item), item]));
    for (const item of candidate.evidence) evidence.set(evidenceKey(item), item);
    merged.set(key, {
      ...previous,
      kind:
        previous.kind === "open_source" || candidate.kind === "open_source"
          ? "open_source"
          : previous.kind === "commercial" || candidate.kind === "commercial"
            ? "commercial"
            : "unknown",
      repositoryUrl: previous.repositoryUrl ?? candidate.repositoryUrl,
      packageUrl: previous.packageUrl ?? candidate.packageUrl,
      evidence: [...evidence.values()],
    });
  }
  return [...merged.values()];
}

export function classifyCandidate(candidate: RawCandidate): RawCandidate["kind"] {
  if (candidate.repositoryUrl || candidate.kind === "open_source") return "open_source";
  const explicit = candidate.evidence
    .map((item) => `${item.title} ${item.snippet}`)
    .join(" ");
  return /\b(commercial|paid plans?|pricing|subscription|hosted SaaS)\b/i.test(explicit)
    ? "commercial"
    : candidate.kind;
}
```

```ts
// src/fusion.ts
import type { RankedCandidate, RawCandidate } from "./candidate.js";
import { canonicalizeUrl, classifyCandidate, mergeCandidates } from "./canonicalize.js";

const RRF_K = 60;

export function fuseCandidates(candidates: RawCandidate[]): RankedCandidate[] {
  return mergeCandidates(candidates)
    .map((candidate) => {
      const kind = classifyCandidate(candidate);
      const best = new Map<string, number>();
      for (const item of candidate.evidence) {
        const key = `${item.source}\0${item.query}`;
        best.set(key, Math.min(best.get(key) ?? Number.POSITIVE_INFINITY, item.rank));
      }
      const retrievalScore = [...best.values()]
        .reduce((sum, rank) => sum + 1 / (RRF_K + rank), 0);
      return {
        ...candidate,
        kind,
        canonicalUrl: canonicalizeUrl(candidate.repositoryUrl ?? candidate.url),
        pool: kind === "open_source" ? "reuse" as const : "competition" as const,
        retrievalScore,
      };
    })
    .sort((a, b) =>
      b.retrievalScore - a.retrievalScore ||
      a.canonicalUrl.localeCompare(b.canonicalUrl),
    );
}
```

- [ ] **Step 4: Run focused tests**

Run: `npm run build && node --test test/unit/canonicalize.test.ts test/unit/fusion.test.ts`

Expected: all tests PASS.

- [ ] **Step 5: Commit**

```bash
git add src/canonicalize.ts src/fusion.ts test/unit/canonicalize.test.ts test/unit/fusion.test.ts
git commit -m "Add evidence deduplication and rank fusion"
```

### Task 3: GitLab public-project adapter

**Files:**

- Create: `src/sources/gitlab.ts`
- Create: `test/unit/gitlab-source.test.ts`
- Modify: `src/schemas.ts`

- [ ] **Step 1: Write adapter tests for success and malformed input**

```ts
import { test, afterEach } from "node:test";
import assert from "node:assert/strict";
import { searchGitLabResult } from "../../dist/sources/gitlab.js";
import { setFetcher, resetFetcher } from "../../dist/http.js";

afterEach(resetFetcher);

test("GitLab maps public projects to open-source candidates", async () => {
  setFetcher(async () => new Response(JSON.stringify([{
    id: 7,
    name_with_namespace: "group / project",
    web_url: "https://gitlab.com/group/project",
    description: "Terminal JSON viewer",
    star_count: 2,
    last_activity_at: "2026-07-01T00:00:00Z",
    archived: false,
  }]), { status: 200 }));
  const result = await searchGitLabResult("terminal JSON viewer", 10);
  assert.equal(result.ok, true);
  if (result.ok) {
    assert.equal(result.value[0].kind, "open_source");
    assert.equal(result.value[0].evidence[0].query, "terminal JSON viewer");
  }
});

test("GitLab reports shape drift as its own failure", async () => {
  setFetcher(async () => new Response(JSON.stringify({ error: "changed" }), { status: 200 }));
  const result = await searchGitLabResult("viewer", 10);
  assert.equal(result.ok, false);
  if (!result.ok) assert.match(result.reason, /unexpected response shape/);
});
```

- [ ] **Step 2: Run the test and verify failure**

Run: `npm run build && node --test test/unit/gitlab-source.test.ts`

Expected: FAIL because `searchGitLabResult` is missing.

- [ ] **Step 3: Add schema and adapter**

Add to `src/schemas.ts`:

```ts
export const GitLabProjectsResponse = z.array(z.object({
  id: z.number(),
  name_with_namespace: z.string(),
  web_url: z.string(),
  description: z.string().nullable(),
  star_count: z.number(),
  last_activity_at: z.string(),
  archived: z.boolean(),
}));
```

```ts
// src/sources/gitlab.ts
import { httpGet } from "../http.js";
import { GitLabProjectsResponse } from "../schemas.js";
import { ok, err, type Result } from "../result.js";
import type { RawCandidate } from "../candidate.js";

export async function searchGitLabResult(
  query: string,
  limit = 10,
): Promise<Result<RawCandidate[]>> {
  try {
    const url = `https://gitlab.com/api/v4/projects?search=${encodeURIComponent(query)}&simple=true&per_page=${limit}&order_by=last_activity_at`;
    const response = await httpGet(url, { "User-Agent": "reuse-before-generate-mcp/0.3" });
    if (!response.ok) return err("gitlab", `HTTP ${response.status}`);
    const parsed = GitLabProjectsResponse.safeParse(await response.json());
    if (!parsed.success) return err("gitlab", "unexpected response shape");
    return ok("gitlab", parsed.data.map((item, index) => ({
      source: "gitlab" as const,
      id: String(item.id),
      name: item.name_with_namespace,
      url: item.web_url,
      repositoryUrl: item.web_url,
      description: item.description ?? "",
      kind: "open_source" as const,
      stars: item.star_count,
      pushedAt: item.last_activity_at,
      archived: item.archived,
      evidence: [{
        source: "gitlab" as const,
        sourceId: String(item.id),
        sourceUrl: item.web_url,
        destinationUrl: item.web_url,
        title: item.name_with_namespace,
        snippet: item.description ?? "",
        query,
        rank: index + 1,
      }],
    })));
  } catch (error) {
    return err("gitlab", (error as Error).message);
  }
}
```

- [ ] **Step 4: Run focused tests**

Run: `npm run build && node --test test/unit/gitlab-source.test.ts test/unit/schemas.test.ts`

Expected: all tests PASS.

- [ ] **Step 5: Commit**

```bash
git add src/sources/gitlab.ts src/schemas.ts test/unit/gitlab-source.test.ts
git commit -m "Add keyless GitLab project discovery"
```

### Task 4: Show HN adapter

**Files:**

- Create: `src/sources/hacker-news.ts`
- Create: `test/unit/hacker-news-source.test.ts`
- Modify: `src/schemas.ts`

- [ ] **Step 1: Write the failing Show HN mapping test**

```ts
import { test, afterEach } from "node:test";
import assert from "node:assert/strict";
import { searchShowHNResult } from "../../dist/sources/hacker-news.js";
import { setFetcher, resetFetcher } from "../../dist/http.js";

afterEach(resetFetcher);

test("Show HN keeps both maker evidence and destination", async () => {
  setFetcher(async () => new Response(JSON.stringify({ hits: [{
    objectID: "42",
    title: "Show HN: Jless, a command-line JSON viewer",
    url: "https://jless.io",
    story_text: "Navigate JSON without leaving the terminal",
    created_at: "2026-06-01T00:00:00Z",
    points: 80,
  }] }), { status: 200 }));
  const result = await searchShowHNResult("terminal JSON viewer", 10);
  assert.equal(result.ok, true);
  if (result.ok) {
    assert.equal(result.value[0].url, "https://jless.io");
    assert.equal(result.value[0].kind, "unknown");
    assert.equal(result.value[0].evidence[0].sourceUrl, "https://news.ycombinator.com/item?id=42");
  }
});
```

- [ ] **Step 2: Run and verify failure**

Run: `npm run build && node --test test/unit/hacker-news-source.test.ts`

Expected: FAIL because the adapter is missing.

- [ ] **Step 3: Add the response schema and adapter**

Add to `src/schemas.ts`:

```ts
export const HackerNewsSearchResponse = z.object({
  hits: z.array(z.object({
    objectID: z.string(),
    title: z.string().nullable(),
    url: z.string().nullable().optional(),
    story_text: z.string().nullable().optional(),
    created_at: z.string(),
    points: z.number().nullable().optional(),
  })),
});
```

```ts
// src/sources/hacker-news.ts
import { httpGet } from "../http.js";
import { HackerNewsSearchResponse } from "../schemas.js";
import { ok, err, type Result } from "../result.js";
import type { RawCandidate } from "../candidate.js";

export async function searchShowHNResult(
  query: string,
  limit = 10,
): Promise<Result<RawCandidate[]>> {
  try {
    const url = `https://hn.algolia.com/api/v1/search?query=${encodeURIComponent(query)}&tags=show_hn&hitsPerPage=${limit}`;
    const response = await httpGet(url, { "User-Agent": "reuse-before-generate-mcp/0.3" });
    if (!response.ok) return err("hackernews", `HTTP ${response.status}`);
    const parsed = HackerNewsSearchResponse.safeParse(await response.json());
    if (!parsed.success) return err("hackernews", "unexpected response shape");
    return ok("hackernews", parsed.data.hits.map((hit, index) => {
      const sourceUrl = `https://news.ycombinator.com/item?id=${hit.objectID}`;
      const destinationUrl = hit.url ?? sourceUrl;
      return {
        source: "hackernews" as const,
        id: hit.objectID,
        name: (hit.title ?? "Show HN").replace(/^Show HN:\s*/i, ""),
        url: destinationUrl,
        description: hit.story_text ?? "",
        kind: "unknown" as const,
        traction: hit.points == null ? undefined : `${hit.points} HN points`,
        evidence: [{
          source: "hackernews" as const,
          sourceId: hit.objectID,
          sourceUrl,
          destinationUrl,
          title: hit.title ?? "Show HN",
          snippet: hit.story_text ?? "",
          query,
          rank: index + 1,
          date: hit.created_at,
        }],
      };
    }));
  } catch (error) {
    return err("hackernews", (error as Error).message);
  }
}
```

- [ ] **Step 4: Run focused tests**

Run: `npm run build && node --test test/unit/hacker-news-source.test.ts test/unit/schemas.test.ts`

Expected: all tests PASS.

- [ ] **Step 5: Commit**

```bash
git add src/sources/hacker-news.ts src/schemas.ts test/unit/hacker-news-source.test.ts
git commit -m "Add Show HN product discovery"
```

### Task 5: Conditional ecosystem registry adapters

**Files:**

- Create: `src/sources/registries.ts`
- Create: `test/unit/registry-sources.test.ts`
- Modify: `src/schemas.ts`

- [ ] **Step 1: Write routing and mapping tests**

```ts
import { test, afterEach } from "node:test";
import assert from "node:assert/strict";
import { searchRegistryResults } from "../../dist/sources/registries.js";
import { setFetcher, resetFetcher } from "../../dist/http.js";

afterEach(resetFetcher);

test("no ecosystem produces no registry request", async () => {
  let calls = 0;
  setFetcher(async () => {
    calls += 1;
    return new Response("{}", { status: 200 });
  });
  assert.deepEqual(await searchRegistryResults(undefined, "viewer"), []);
  assert.equal(calls, 0);
});

test("Ruby routes only to RubyGems and maps package evidence", async () => {
  let seen = "";
  setFetcher(async (url) => {
    seen = url;
    return new Response(JSON.stringify([{
      name: "rubocop",
      info: "A Ruby static code analyzer",
      project_uri: "https://rubygems.org/gems/rubocop",
      source_code_uri: "https://github.com/rubocop/rubocop",
      version_created_at: "2026-07-01T00:00:00Z",
      downloads: 100,
    }]), { status: 200 });
  });
  const [result] = await searchRegistryResults("ruby", "static analyzer");
  assert.match(seen, /rubygems\.org/);
  assert.equal(result.source, "rubygems");
  if (result.ok) assert.equal(result.value[0].repositoryUrl, "https://github.com/rubocop/rubocop");
});
```

- [ ] **Step 2: Run and verify failure**

Run: `npm run build && node --test test/unit/registry-sources.test.ts`

Expected: FAIL because the registry router is missing.

- [ ] **Step 3: Implement one bounded adapter per selected ecosystem**

Define permissive Zod schemas in `src/schemas.ts` for:

```ts
export const CratesSearchResponse = z.object({
  crates: z.array(z.object({
    id: z.string(),
    name: z.string(),
    description: z.string().nullable(),
    repository: z.string().nullable().optional(),
    updated_at: z.string(),
    downloads: z.number(),
  })),
});

export const RubyGemsSearchResponse = z.array(z.object({
  name: z.string(),
  info: z.string().nullable().optional(),
  project_uri: z.string(),
  source_code_uri: z.string().nullable().optional(),
  version_created_at: z.string(),
  downloads: z.number(),
}));

export const PackagistSearchResponse = z.object({
  results: z.array(z.object({
    name: z.string(),
    description: z.string().nullable(),
    url: z.string(),
    repository: z.string().nullable().optional(),
    downloads: z.number(),
    favers: z.number(),
  })),
});

export const PackagistPackageResponse = z.object({
  package: z.object({
    versions: z.record(z.object({
      time: z.string().optional(),
    }).passthrough()),
  }),
});

export const MavenSearchResponse = z.object({
  response: z.object({
    docs: z.array(z.object({
      id: z.string(),
      g: z.string(),
      a: z.string(),
      latestVersion: z.string(),
      timestamp: z.number(),
    })),
  }),
});
```

```ts
// src/sources/registries.ts
import type { Ecosystem, RawCandidate } from "../candidate.js";
import { httpGet } from "../http.js";
import { err, ok, type Result, type Source } from "../result.js";
import {
  CratesSearchResponse,
  MavenSearchResponse,
  PackagistPackageResponse,
  PackagistSearchResponse,
  RubyGemsSearchResponse,
} from "../schemas.js";

type RegistrySource = Extract<Source, "crates" | "rubygems" | "packagist" | "maven">;

const registryFor = {
  rust: ["crates", "https://crates.io/api/v1/crates?q="],
  ruby: ["rubygems", "https://rubygems.org/api/v1/search.json?query="],
  php: ["packagist", "https://packagist.org/search.json?per_page=10&q="],
  jvm: ["maven", "https://search.maven.org/solrsearch/select?rows=10&wt=json&q="],
} as const;

function evidence(
  source: RegistrySource,
  id: string,
  sourceUrl: string,
  destinationUrl: string,
  title: string,
  snippet: string,
  query: string,
  rank: number,
) {
  return [{
    source,
    sourceId: id,
    sourceUrl,
    destinationUrl,
    title,
    snippet,
    query,
    rank,
  }];
}

async function packagistActivity(name: string): Promise<string | undefined> {
  const response = await httpGet(
    `https://packagist.org/packages/${encodeURIComponent(name)}.json`,
    { "User-Agent": "reuse-before-generate-mcp/0.3" },
  );
  if (!response.ok) return undefined;
  const parsed = PackagistPackageResponse.safeParse(await response.json());
  if (!parsed.success) return undefined;
  return Object.values(parsed.data.package.versions)
    .map((version) => version.time)
    .filter((time): time is string => Boolean(time))
    .sort()
    .at(-1);
}

async function searchOneRegistry(
  source: RegistrySource,
  url: string,
  query: string,
): Promise<Result<RawCandidate[]>> {
  try {
    const response = await httpGet(url, { "User-Agent": "reuse-before-generate-mcp/0.3" });
    if (!response.ok) return err(source, `HTTP ${response.status}`);
    const body: unknown = await response.json();

    if (source === "crates") {
      const parsed = CratesSearchResponse.safeParse(body);
      if (!parsed.success) return err(source, "unexpected response shape");
      return ok(source, parsed.data.crates.map((item, index) => {
        const packageUrl = `https://crates.io/crates/${item.id}`;
        return {
          source, id: item.id, name: item.name, url: item.repository ?? packageUrl,
          repositoryUrl: item.repository ?? undefined, packageUrl,
          description: item.description ?? "", kind: "open_source" as const,
          pushedAt: item.updated_at, traction: `${item.downloads} downloads`,
          evidence: evidence(source, item.id, packageUrl, item.repository ?? packageUrl, item.name, item.description ?? "", query, index + 1),
        };
      }));
    }

    if (source === "rubygems") {
      const parsed = RubyGemsSearchResponse.safeParse(body);
      if (!parsed.success) return err(source, "unexpected response shape");
      return ok(source, parsed.data.map((item, index) => ({
        source, id: item.name, name: item.name, url: item.source_code_uri ?? item.project_uri,
        repositoryUrl: item.source_code_uri ?? undefined, packageUrl: item.project_uri,
        description: item.info ?? "", kind: "open_source" as const,
        pushedAt: item.version_created_at, traction: `${item.downloads} downloads`,
        evidence: evidence(source, item.name, item.project_uri, item.source_code_uri ?? item.project_uri, item.name, item.info ?? "", query, index + 1),
      })));
    }

    if (source === "packagist") {
      const parsed = PackagistSearchResponse.safeParse(body);
      if (!parsed.success) return err(source, "unexpected response shape");
      const top = parsed.data.results.slice(0, 5);
      const dates = await Promise.all(top.map((item) => packagistActivity(item.name)));
      return ok(source, top.map((item, index) => ({
        source, id: item.name, name: item.name, url: item.repository ?? item.url,
        repositoryUrl: item.repository ?? undefined, packageUrl: item.url,
        description: item.description ?? "", kind: "open_source" as const,
        pushedAt: dates[index], traction: `${item.downloads} downloads; ${item.favers} favorites`,
        evidence: evidence(source, item.name, item.url, item.repository ?? item.url, item.name, item.description ?? "", query, index + 1),
      })));
    }

    const parsed = MavenSearchResponse.safeParse(body);
    if (!parsed.success) return err(source, "unexpected response shape");
    return ok(source, parsed.data.response.docs.map((item, index) => {
      const packageUrl = `https://central.sonatype.com/artifact/${item.g}/${item.a}/${item.latestVersion}`;
      return {
        source, id: item.id, name: `${item.g}:${item.a}`, url: packageUrl,
        packageUrl, description: `${item.g}:${item.a} ${item.latestVersion}`,
        kind: "open_source" as const, pushedAt: new Date(item.timestamp).toISOString(),
        evidence: evidence(source, item.id, packageUrl, packageUrl, `${item.g}:${item.a}`, `${item.g}:${item.a} ${item.latestVersion}`, query, index + 1),
      };
    }));
  } catch (error) {
    return err(source, (error as Error).message);
  }
}

export async function searchRegistryResults(
  ecosystem: Ecosystem | undefined,
  query: string,
): Promise<Result<RawCandidate[]>[]> {
  if (!ecosystem || ecosystem === "python") return [];
  const [source, baseUrl] = registryFor[ecosystem];
  return [await searchOneRegistry(source, `${baseUrl}${encodeURIComponent(query)}`, query)];
}
```

- [ ] **Step 4: Run focused and full source tests**

Run: `npm run build && node --test test/unit/registry-sources.test.ts test/unit/schemas.test.ts test/unit/search-pipeline.test.ts`

Expected: all tests PASS.

- [ ] **Step 5: Commit**

```bash
git add src/sources/registries.ts src/schemas.ts test/unit/registry-sources.test.ts
git commit -m "Add conditional keyless registry search"
```

### Task 6: Product Hunt recent-launch feed

**Files:**

- Modify: `package.json`
- Modify: `package-lock.json`
- Create: `src/sources/product-hunt.ts`
- Create: `test/unit/product-hunt-source.test.ts`

- [ ] **Step 1: Install the XML parser**

Run: `npm install fast-xml-parser@5`

Expected: `fast-xml-parser` is added to runtime dependencies and the lockfile updates.

- [ ] **Step 2: Write the failing RSS mapping test**

```ts
import { test, afterEach } from "node:test";
import assert from "node:assert/strict";
import { searchProductHuntFeedResult } from "../../dist/sources/product-hunt.js";
import { setFetcher, resetFetcher } from "../../dist/http.js";

afterEach(resetFetcher);

test("Product Hunt feed matches query words and preserves launch evidence", async () => {
  const xml = `<?xml version="1.0"?><rss><channel><item>
    <guid>ph-1</guid><title>JSON Lens</title>
    <link>https://www.producthunt.com/products/json-lens</link>
    <description>Navigate and inspect JSON in your terminal</description>
    <pubDate>Wed, 22 Jul 2026 08:00:00 GMT</pubDate>
  </item></channel></rss>`;
  setFetcher(async () => new Response(xml, { status: 200 }));
  const result = await searchProductHuntFeedResult(["terminal JSON viewer", "inspect JSON"]);
  assert.equal(result.ok, true);
  if (result.ok) {
    assert.equal(result.value.length, 1);
    assert.equal(result.value[0].kind, "unknown");
    assert.equal(result.value[0].evidence[0].source, "producthunt");
  }
});
```

- [ ] **Step 3: Run and verify failure**

Run: `npm run build && node --test test/unit/product-hunt-source.test.ts`

Expected: FAIL because the adapter is missing.

- [ ] **Step 4: Implement feed parsing and conservative matching**

```ts
// src/sources/product-hunt.ts
import { XMLParser } from "fast-xml-parser";
import { httpGet } from "../http.js";
import { ok, err, type Result } from "../result.js";
import type { RawCandidate } from "../candidate.js";

const FEED_URL = "https://www.producthunt.com/feed";
const parser = new XMLParser({ ignoreAttributes: false, trimValues: true });

function terms(query: string): string[] {
  return query.toLowerCase().split(/\W+/).filter((term) => term.length > 2);
}

export async function searchProductHuntFeedResult(
  queries: string[],
): Promise<Result<RawCandidate[]>> {
  try {
    const response = await httpGet(FEED_URL, { "User-Agent": "reuse-before-generate-mcp/0.3" });
    if (!response.ok) return err("producthunt", `HTTP ${response.status}`);
    const parsed = parser.parse(await response.text());
    const rawItems = parsed?.rss?.channel?.item;
    const items = Array.isArray(rawItems) ? rawItems : rawItems ? [rawItems] : [];
    const candidates = items.flatMap((item: Record<string, unknown>, index: number) => {
      const title = String(item.title ?? "");
      const snippet = String(item.description ?? "");
      const haystack = `${title} ${snippet}`.toLowerCase();
      const query = queries.find((value) => terms(value).filter((term) => haystack.includes(term)).length >= 2);
      if (!query) return [];
      const destinationUrl = String(item.link ?? "");
      if (!destinationUrl) return [];
      return [{
        source: "producthunt" as const,
        id: String(item.guid ?? destinationUrl),
        name: title,
        url: destinationUrl,
        description: snippet,
        kind: "unknown" as const,
        evidence: [{
          source: "producthunt" as const,
          sourceId: String(item.guid ?? destinationUrl),
          sourceUrl: destinationUrl,
          destinationUrl,
          title,
          snippet,
          query,
          rank: index + 1,
          date: item.pubDate ? String(item.pubDate) : undefined,
        }],
      }];
    });
    return ok("producthunt", candidates);
  } catch (error) {
    return err("producthunt", (error as Error).message);
  }
}
```

- [ ] **Step 5: Run tests and commit**

Run: `npm run build && node --test test/unit/product-hunt-source.test.ts`

Expected: PASS.

```bash
git add package.json package-lock.json src/sources/product-hunt.ts test/unit/product-hunt-source.test.ts
git commit -m "Add recent Product Hunt discovery"
```

### Task 7: Experimental DuckDuckGo HTML lane

**Files:**

- Create: `src/sources/duckduckgo.ts`
- Create: `test/unit/duckduckgo-source.test.ts`
- Create: `test/fixtures/duckduckgo/results.html`
- Create: `test/fixtures/duckduckgo/challenge.html`

- [ ] **Step 1: Add fixtures and failing parser tests**

Create `test/fixtures/duckduckgo/results.html`:

```html
<!doctype html>
<html><body>
<div class="result results_links results_links_deep web-result">
  <div class="links_main links_deep result__body">
    <h2 class="result__title"><a class="result__a" href="//duckduckgo.com/l/?uddg=https%3A%2F%2Fjless.io">Jless JSON Viewer</a></h2>
    <a class="result__snippet">Navigate and inspect JSON in the terminal.</a>
  </div>
</div>
<div class="result results_links results_links_deep web-result">
  <div class="links_main links_deep result__body">
    <h2 class="result__title"><a class="result__a" href="//duckduckgo.com/l/?uddg=https%3A%2F%2Ffx.wtf">Fx JSON Tool</a></h2>
    <a class="result__snippet">Terminal JSON viewer and processor.</a>
  </div>
</div>
</body></html>
```

Create `test/fixtures/duckduckgo/challenge.html`:

```html
<!doctype html>
<html><body><form id="challenge-form">Bots use DuckDuckGo too</form></body></html>
```

```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { parseDuckDuckGoHtml } from "../../dist/sources/duckduckgo.js";

test("parser extracts destination, title and snippet from saved HTML", () => {
  const html = readFileSync("test/fixtures/duckduckgo/results.html", "utf8");
  const results = parseDuckDuckGoHtml(html, "terminal JSON viewer");
  assert.equal(results.length, 2);
  assert.match(results[0].url, /^https:/);
  assert.ok(results[0].evidence[0].snippet.length > 0);
});

test("parser identifies the saved challenge page", () => {
  const html = readFileSync("test/fixtures/duckduckgo/challenge.html", "utf8");
  assert.throws(() => parseDuckDuckGoHtml(html, "viewer"), /challenge page/);
});
```

- [ ] **Step 2: Run and verify failure**

Run: `npm run build && node --test test/unit/duckduckgo-source.test.ts`

Expected: FAIL because the parser is missing.

- [ ] **Step 3: Implement a narrow parser and two-request adapter**

```ts
// src/sources/duckduckgo.ts
import { httpGet } from "../http.js";
import { ok, err, type Result } from "../result.js";
import type { RawCandidate } from "../candidate.js";

function decode(value: string): string {
  return value
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, "\"")
    .replace(/&#x27;|&#39;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">");
}

function text(value: string): string {
  return decode(value.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim());
}

function destination(href: string): string {
  const url = new URL(decode(href), "https://html.duckduckgo.com");
  return url.searchParams.get("uddg") ?? url.toString();
}

export function parseDuckDuckGoHtml(html: string, query: string): RawCandidate[] {
  if (/anomaly-modal|challenge-form|bots use DuckDuckGo/i.test(html)) {
    throw new Error("challenge page returned");
  }
  const blocks = html.match(/<div[^>]+class="[^"]*\bresult\b[^"]*"[\s\S]*?<\/div>\s*<\/div>/gi) ?? [];
  return blocks.flatMap((block, index) => {
    const link = block.match(/<a[^>]+class="[^"]*result__a[^"]*"[^>]+href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/i);
    if (!link) return [];
    const snippet = block.match(/class="[^"]*result__snippet[^"]*"[^>]*>([\s\S]*?)<\/(?:a|div)>/i);
    const url = destination(link[1]);
    return [{
      source: "web" as const,
      id: url,
      name: text(link[2]),
      url,
      description: snippet ? text(snippet[1]) : "",
      kind: "unknown" as const,
      evidence: [{
        source: "web" as const,
        sourceId: url,
        sourceUrl: url,
        destinationUrl: url,
        title: text(link[2]),
        snippet: snippet ? text(snippet[1]) : "",
        query,
        rank: index + 1,
      }],
    }];
  });
}

export async function searchWebResult(
  category: string,
): Promise<Result<RawCandidate[]>> {
  const queries = [category, `site:producthunt.com/products ${category}`];
  try {
    const pages = await Promise.all(queries.map(async (query) => {
      const url = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`;
      const response = await httpGet(url, { "User-Agent": "reuse-before-generate-mcp/0.3" }, 4000);
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      return parseDuckDuckGoHtml(await response.text(), query);
    }));
    return ok("web", pages.flat());
  } catch (error) {
    return err("web", (error as Error).message);
  }
}
```

- [ ] **Step 4: Run fixture tests**

Run: `npm run build && node --test test/unit/duckduckgo-source.test.ts`

Expected: all tests PASS.

- [ ] **Step 5: Commit**

```bash
git add src/sources/duckduckgo.ts test/unit/duckduckgo-source.test.ts test/fixtures/duckduckgo
git commit -m "Add isolated best-effort web discovery"
```

### Task 8: Multi-source orchestration

**Files:**

- Modify: `src/search.ts`
- Modify: `test/unit/search-pipeline.test.ts`
- Modify: `test/unit/search-guards.test.ts`

- [ ] **Step 1: Add a failing orchestration test**

```ts
test("searchAllResults plans sources without multiplying GitHub requests", async () => {
  const seen: string[] = [];
  setFetcher(async (url) => {
    seen.push(url);
    if (url.includes("api.github.com")) return new Response(JSON.stringify({ items: [] }), { status: 200 });
    if (url.includes("registry.npmjs.org")) return new Response(JSON.stringify({ objects: [] }), { status: 200 });
    if (url.includes("gitlab.com")) return new Response("[]", { status: 200 });
    if (url.includes("hn.algolia.com")) return new Response(JSON.stringify({ hits: [] }), { status: 200 });
    if (url.includes("producthunt.com/feed")) return new Response("<rss><channel></channel></rss>", { status: 200 });
    if (url.includes("duckduckgo.com")) return new Response("<html></html>", { status: 200 });
    throw new Error(`unexpected URL ${url}`);
  });

  const results = await searchAllResults(
    "terminal JSON viewer",
    ["json", "viewer", "terminal"],
    {
      category: "terminal JSON viewer",
      outcome: "inspect JSON in a terminal",
      synonyms: "JSON TUI processor",
    },
  );
  assert.deepEqual(
    results.map((result) => result.source),
    ["github", "npm", "gitlab", "hackernews", "producthunt", "web"],
  );
  assert.equal(seen.filter((url) => url.includes("api.github.com")).length, 2);
});
```

- [ ] **Step 2: Run and verify signature/source failure**

Run: `npm run build && node --test test/unit/search-pipeline.test.ts`

Expected: FAIL because `searchAllResults` does not accept formulations or call the new sources.

- [ ] **Step 3: Adapt existing GitHub/npm candidates and orchestrate**

In `src/search.ts`:

Replace the local `RawCandidate` declaration with:

```ts
import type { QueryInput } from "./query-plan.js";
import type { RawCandidate } from "./candidate.js";
import type { Source } from "./result.js";
export type { RawCandidate } from "./candidate.js";
```

Change the existing search user agent to
`reuse-before-generate-mcp/0.3`; Task 11 aligns all published version fields to
`0.3.0`.

Replace `toCandidate` with:

```ts
function toCandidate(
  item: GitHubSearchItemT,
  query: string,
  rank: number,
  source: "github" | "python" = "github",
): RawCandidate {
  return {
    source,
    id: item.full_name,
    name: item.full_name,
    url: item.html_url,
    repositoryUrl: item.html_url,
    description: item.description ?? "",
    kind: "open_source",
    stars: item.stargazers_count,
    pushedAt: item.pushed_at,
    archived: item.archived,
    evidence: [{
      source,
      sourceId: item.full_name,
      sourceUrl: item.html_url,
      destinationUrl: item.html_url,
      title: item.full_name,
      snippet: item.description ?? "",
      query,
      rank,
    }],
  };
}
```

Pass each concrete query and one-based response index into `toCandidate`.
Update npm's mapping to this complete shape:

```ts
const candidates = parsed.data.objects.map((obj, index) => {
  const packageUrl = obj.package.links.npm;
  const repositoryUrl = obj.package.links.repository;
  return {
    source: "npm" as const,
    id: obj.package.name,
    name: obj.package.name,
    url: repositoryUrl ?? packageUrl,
    repositoryUrl,
    packageUrl,
    description: obj.package.description ?? "",
    kind: "open_source" as const,
    pushedAt: obj.package.date,
    evidence: [{
      source: "npm" as const,
      sourceId: obj.package.name,
      sourceUrl: packageUrl,
      destinationUrl: repositoryUrl ?? packageUrl,
      title: obj.package.name,
      snippet: obj.package.description ?? "",
      query: keywords,
      rank: index + 1,
    }],
  };
});
```

Add a same-source combiner:

```ts
async function combineQueries(
  source: Source,
  queries: string[],
  search: (query: string) => Promise<Result<RawCandidate[]>>,
): Promise<Result<RawCandidate[]>> {
  const unique = [...new Set(queries.filter(Boolean))];
  const results = await Promise.all(unique.map(search));
  const successes = results.filter(
    (result): result is Extract<Result<RawCandidate[]>, { ok: true }> => result.ok,
  );
  if (successes.length > 0) {
    return ok(source, successes.flatMap((result) => result.value));
  }
  const reasons = results
    .filter((result): result is Extract<Result<RawCandidate[]>, { ok: false }> => !result.ok)
    .map((result) => result.reason);
  return err(source, reasons.join("; ") || "no usable query");
}
```

Import the new adapters and define:

```ts
const searchGitLabQueries = (queries: string[]) =>
  combineQueries("gitlab", queries, (query) => searchGitLabResult(query));

const searchShowHNQueries = (queries: string[]) =>
  combineQueries("hackernews", queries, (query) => searchShowHNResult(query));
```

The final orchestration signature is:

```ts
export async function searchAllResults(
  description: string,
  keywords?: string[],
  queries?: QueryInput,
): Promise<Result<RawCandidate[]>[]> {
  const usable = meaningfulKeywords(keywords ?? extractKeywords(description, 4));
  const plan = buildQueryPlan(description, usable, queries);
  const formulations = [
    plan.formulations.category,
    plan.formulations.outcome,
    plan.formulations.synonyms,
  ].filter((query): query is string => Boolean(query));

  const conditional = await searchRegistryResults(
    plan.ecosystem,
    plan.formulations.category,
  );
  return Promise.all([
    searchGitHubResult(description, usable),
    searchNpmResult(description, plan.formulations.category.split(" ")),
    searchGitLabQueries(formulations.slice(0, 2)),
    searchShowHNQueries(formulations),
    searchProductHuntFeedResult(formulations),
    searchWebResult(plan.formulations.category),
    ...(plan.ecosystem === "python" ? [searchPythonResult(description, usable)] : []),
    ...conditional,
  ]);
}
```

Update the compatibility wrapper without changing its two-argument callers:

```ts
export async function searchAll(
  description: string,
  keywords?: string[],
  queries?: QueryInput,
): Promise<RawCandidate[]> {
  const results = await searchAllResults(description, keywords, queries);
  return results.flatMap((result) => result.ok ? result.value : []);
}
```

Do not add retries beyond GitHub's existing retry.

- [ ] **Step 4: Run all offline tests**

Run: `npm test`

Expected: all tests PASS, including the GitHub two-request guard and existing compatibility calls.

- [ ] **Step 5: Commit**

```bash
git add src/search.ts test/unit/search-pipeline.test.ts test/unit/search-guards.test.ts
git commit -m "Orchestrate bounded multi-source discovery"
```

### Task 9: Verification, coverage, semantic prompt, and MCP output

**Files:**

- Modify: `src/verify.ts`
- Modify: `src/report.ts`
- Modify: `src/rerank.ts`
- Modify: `src/index.ts`
- Modify: `test/unit/verify.test.ts`
- Modify: `test/unit/report.test.ts`
- Create: `test/unit/rerank.test.ts`

- [ ] **Step 1: Write failing coverage and prompt tests**

```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { formatCoverage } from "../../dist/report.js";

test("coverage distinguishes searched, unavailable, and all-failed", () => {
  const coverage = formatCoverage([
    { ok: true, source: "github", value: [] },
    { ok: false, source: "web", reason: "challenge page returned" },
  ]);
  assert.match(coverage, /Searched: github/);
  assert.match(coverage, /Unavailable: web \(challenge page returned\)/);
  assert.equal(coverage.allFailed, false);
});
```

```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { buildRerankPrompt } from "../../dist/rerank.js";

test("prompt separates reusable projects and competitors", () => {
  const prompt = buildRerankPrompt("JSON viewer", [
    {
      source: "github", id: "a/b", name: "a/b", url: "https://github.com/a/b",
      canonicalUrl: "https://github.com/a/b", description: "viewer",
      kind: "open_source", pool: "reuse", retrievalScore: 1 / 61,
      evidence: [{ source: "github", sourceId: "a/b", sourceUrl: "https://github.com/a/b", destinationUrl: "https://github.com/a/b", title: "a/b", snippet: "viewer", query: "JSON viewer", rank: 1 }],
      maintained: true, maintenanceReason: "active within the last 1 days", daysSinceLastActivity: 1,
    },
    {
      source: "hackernews", id: "42", name: "Hosted Lens", url: "https://lens.test",
      canonicalUrl: "https://lens.test", description: "hosted viewer",
      kind: "unknown", pool: "competition", retrievalScore: 1 / 62,
      evidence: [{ source: "hackernews", sourceId: "42", sourceUrl: "https://news.ycombinator.com/item?id=42", destinationUrl: "https://lens.test", title: "Hosted Lens", snippet: "hosted viewer", query: "JSON viewer", rank: 2 }],
    },
  ]);
  assert.match(prompt, /Projects you could reuse/);
  assert.match(prompt, /Products you would compete with/);
  assert.match(prompt, /unknown/);
});
```

- [ ] **Step 2: Run and verify failures**

Run: `npm run build && node --test test/unit/report.test.ts test/unit/rerank.test.ts`

Expected: FAIL because the new coverage and prompt shapes are absent.

- [ ] **Step 3: Implement candidate preparation and honest coverage**

Add `prepareCandidates` to `src/verify.ts`:

```ts
import { fuseCandidates } from "./fusion.js";
import type { RankedCandidate } from "./candidate.js";

export interface Verification {
  maintained: boolean;
  maintenanceReason: string;
  daysSinceLastActivity: number | null;
}

export type VerifiedCandidate<T extends RawCandidate = RawCandidate> =
  T & Verification;

export type PreparedCandidate = VerifiedCandidate<RankedCandidate> | RankedCandidate;

export async function prepareCandidates(
  candidates: RawCandidate[],
): Promise<PreparedCandidate[]> {
  const ranked = fuseCandidates(candidates);
  const reusable = ranked.filter((candidate) => candidate.pool === "reuse");
  const competitors = ranked.filter((candidate) => candidate.pool === "competition");
  const verified = await Promise.all(reusable.map(verifyCandidate));
  return [
    ...verified.filter((candidate) => candidate.maintained),
    ...competitors,
  ].sort((a, b) => b.retrievalScore - a.retrievalScore);
}
```

Change the existing `verifyCandidate` declaration to the generic signature below
without changing its tested activity branches:

```ts
export async function verifyCandidate<T extends RawCandidate>(
  candidate: T,
): Promise<VerifiedCandidate<T>>
```

Each return branch already spreads `candidate`, so the generic preserves
`RankedCandidate` fields. Update `verifyAll` to:

```ts
export async function verifyAll<T extends RawCandidate>(
  candidates: T[],
): Promise<VerifiedCandidate<T>[]> {
  return Promise.all(candidates.map(verifyCandidate));
}
```

Replace `formatSourceFailures` with a compatibility wrapper around:

```ts
export function formatCoverage(results: Result<RawCandidate[]>[]): {
  text: string;
  allFailed: boolean;
} {
  const succeeded = results.filter((result) => result.ok).map((result) => result.source);
  const failed = results.filter(isFailure);
  const searched = `Searched: ${succeeded.join(", ") || "none"}`;
  const unavailable = failed.length === 0
    ? "Unavailable: none"
    : `Unavailable: ${failed.map((item) => `${item.source} (${item.reason})`).join("; ")}`;
  return { text: `${searched}\n${unavailable}`, allFailed: succeeded.length === 0 };
}

export function formatSourceFailures(results: Result<RawCandidate[]>[]): string {
  const failed = results.filter(isFailure);
  if (failed.length === 0) return "";
  return `Note: ${failed.map((item) => `${item.source} (${item.reason})`).join("; ")} — results below are from the remaining source(s) only.`;
}
```

Replace `src/rerank.ts` with:

```ts
import type { PreparedCandidate } from "./verify.js";

function renderCandidate(candidate: PreparedCandidate, index: number): string {
  const health = "maintenanceReason" in candidate
    ? candidate.maintenanceReason
    : "commercial/unknown candidate; public evidence is not a maintenance claim";
  const evidence = candidate.evidence
    .map((item) => `${item.source} rank ${item.rank} for "${item.query}": ${item.snippet || item.title}`)
    .join("\n      ");
  return `${index + 1}. ${candidate.name} [${candidate.kind}]
   url: ${candidate.url}
   description: ${candidate.description || "(no description)"}
   health: ${health}
   traction: ${candidate.traction ?? (candidate.stars == null ? "n/a" : `${candidate.stars} stars`)}
   evidence:
      ${evidence}`;
}

export function buildRerankPrompt(
  description: string,
  candidates: PreparedCandidate[],
): string {
  const reuse = candidates.filter((candidate) => candidate.pool === "reuse");
  const competition = candidates.filter((candidate) => candidate.pool === "competition");
  const render = (items: PreparedCandidate[]) =>
    items.length === 0 ? "(none retrieved)" : items.map(renderCandidate).join("\n\n");

  return `Requested project description:
"""${description}"""

Projects you could reuse:

${render(reuse)}

Products you would compete with:

${render(competition)}

---
Judge functional overlap, audience/workflow, reuse potential, market substitutability,
evidence quality, and health. Popularity is context, not relevance.

Return at most 3 candidates scoring 40+ in each section. For each, state why it
matches, the important difference, and the evidence sources. Preserve
"unknown" labels. Do not pad either section with weak matches.

If neither section has a candidate scoring 40+, say "No strong match found in
the sources searched." Do not claim that no competitor exists or that the idea
is clear to build.`;
}
```

- [ ] **Step 4: Wire the MCP schema and all-failed behavior**

Add to the tool input schema in `src/index.ts`:

```ts
queries: z.object({
  category: z.string().min(2),
  outcome: z.string().min(2),
  synonyms: z.string().min(2),
}).optional().describe(
  "Recommended: three distinct search formulations: maintainer category, user outcome, and alternative vocabulary.",
),
```

Replace the registered handler body with:

```ts
async ({ description, keywords, queries }) => {
  track({ type: "tool_invoked" });
  try {
    const results = await searchAllResults(description, keywords, queries);
    const coverage = formatCoverage(results);
    if (coverage.allFailed) {
      track({ type: "error", stage: "all_sources" });
      return {
        content: [{ type: "text", text: `All discovery sources failed.\n\n${coverage.text}` }],
        isError: true,
      };
    }

    const raw = results.flatMap((result) => result.ok ? result.value : []);
    if (raw.length === 0) {
      track({ type: "no_candidates_found" });
      return {
        content: [{
          type: "text",
          text: `No strong match found in the sources searched. This does not prove that no competitor exists.\n\n${coverage.text}`,
        }],
      };
    }

    const prepared = await prepareCandidates(raw);
    if (prepared.length === 0) {
      track({ type: "candidates_found", count: raw.length, maintainedCount: 0 });
      return {
        content: [{
          type: "text",
          text: `No strong match found in the sources searched. Retrieved reusable projects were inactive, and no market candidates remained. This does not prove that no competitor exists.\n\n${coverage.text}`,
        }],
      };
    }

    const maintainedCount = prepared.filter((candidate) =>
      candidate.pool === "reuse",
    ).length;
    track({ type: "candidates_found", count: raw.length, maintainedCount });
    const prompt = buildRerankPrompt(description, prepared);
    return {
      content: [{
        type: "text",
        text: `${prompt}${maybeEnergyLine()}\n\nSearch coverage\n${coverage.text}`,
      }],
    };
  } catch (error) {
    track({ type: "error", stage: "check_before_building" });
    return {
      content: [{
        type: "text",
        text: `check_before_building failed: ${(error as Error).message}`,
      }],
      isError: true,
    };
  }
}
```

- [ ] **Step 5: Run the full suite and commit**

Run: `npm test`

Expected: all tests PASS.

```bash
git add src/verify.ts src/report.ts src/rerank.ts src/index.ts test/unit/verify.test.ts test/unit/report.test.ts test/unit/rerank.test.ts
git commit -m "Report reuse and competition with honest coverage"
```

### Task 10: CLI and evaluation corpus

**Files:**

- Modify: `src/cli.ts`
- Modify: `test/unit/cli.test.ts`
- Modify: `test/eval/cases.mjs`
- Modify: `test/eval/run.mjs`
- Modify: `test/eval/baseline.json`

- [ ] **Step 1: Add failing CLI formulation tests**

```ts
test("parses all three query formulations", () => {
  const out = parseArgs(argv(
    "inspect JSON",
    "--keywords", "json,viewer,terminal",
    "--category", "terminal JSON viewer",
    "--outcome", "inspect JSON in terminal",
    "--synonyms", "JSON TUI processor",
  ));
  assert.deepEqual(out.queries, {
    category: "terminal JSON viewer",
    outcome: "inspect JSON in terminal",
    synonyms: "JSON TUI processor",
  });
});

test("omits a partial formulation object", () => {
  const out = parseArgs(argv("inspect JSON", "--category", "JSON viewer"));
  assert.equal(out.queries, undefined);
});
```

- [ ] **Step 2: Run and verify CLI failure**

Run: `npm run build && node --test test/unit/cli.test.ts`

Expected: FAIL because `queries` and flags are not parsed.

- [ ] **Step 3: Implement CLI flags and pool output**

Replace `Args` and `parseArgs` with:

```ts
interface Args {
  description: string;
  keywords?: string[];
  queries?: QueryInput;
}

const VALUE_FLAGS = new Set([
  "--keywords", "-k", "--category", "--outcome", "--synonyms",
]);

export function parseArgs(argv: string[]): Args {
  const args = argv.slice(2);
  const firstFlag = args.findIndex((arg) => VALUE_FLAGS.has(arg));
  const description = args
    .slice(0, firstFlag === -1 ? args.length : firstFlag)
    .join(" ")
    .trim();
  const value = (...names: string[]): string => {
    const index = args.findIndex((arg) => names.includes(arg));
    return index === -1 ? "" : (args[index + 1] ?? "").trim();
  };
  const keywords = value("--keywords", "-k")
    .split(",")
    .map((keyword) => keyword.trim())
    .filter(Boolean);
  const category = value("--category");
  const outcome = value("--outcome");
  const synonyms = value("--synonyms");
  const queries = category && outcome && synonyms
    ? { category, outcome, synonyms }
    : undefined;
  return {
    description,
    keywords: keywords.length > 0 ? keywords : undefined,
    queries,
  };
}
```

Import `prepareCandidates`, `formatCoverage`, and `QueryInput`. In `main`, pass
the parsed `queries`, replace the raw/maintained block with:

```ts
const results = await searchAllResults(description, keywords, queries);
const raw = results.flatMap((result) => result.ok ? result.value : []);
const candidates = await prepareCandidates(raw);
const coverage = formatCoverage(results);

for (const pool of ["reuse", "competition"] as const) {
  console.log(pool === "reuse"
    ? "\nProjects you could reuse"
    : "\nProducts you would compete with");
  const items = candidates.filter((candidate) => candidate.pool === pool);
  if (items.length === 0) console.log("  (none retrieved)");
  for (const [index, candidate] of items.entries()) {
    console.log(`  ${index + 1}. [${candidate.kind}] ${candidate.name}`);
    console.log(`     ${candidate.description.slice(0, 120)}`);
    console.log(`     ${candidate.url}`);
  }
}
console.log(`\nSearch coverage\n${coverage.text}`);
```

Use this exact usage text:

```ts
console.error(
  'Usage: npm run check -- "<description>" --keywords a,b,c ' +
  '[--category "noun phrase" --outcome "user job" --synonyms "alternative phrase"]',
);
```

- [ ] **Step 4: Expand the live evaluation**

Add `expectedPool` and `queries` to every existing case. For the JSON viewer
case the complete fields are:

```js
{
  expectedPool: "reuse",
  queries: {
    category: "terminal JSON viewer",
    outcome: "inspect JSON in a terminal",
    synonyms: "JSON TUI processor",
  },
}
```

Use these exact values for the remaining existing cases:

| Case | Pool | Category | Outcome | Synonyms |
|---|---|---|---|---|
| `python-formatter` | reuse | `Python code formatter` | `format Python source automatically` | `Python code style tool` |
| `changelog-generator` | reuse | `conventional commit changelog generator` | `generate changelog from git history` | `release notes CLI` |
| `secret-scanner` | reuse | `git secret detector` | `find credentials committed to git` | `repository leak scanner` |
| `actions-debugger` | reuse | `GitHub Actions debugger` | `open a shell in a failed workflow` | `interactive CI runner debugging` |
| `postgres-mcp` | reuse | `Postgres MCP server` | `let an AI agent run read-only SQL` | `database query MCP` |
| `html-proofer` | reuse | `rendered HTML validator` | `check generated sites for broken links` | `HTML link proofer CLI` |
| `vague-phrasing` | reuse | `git pre-commit hooks` | `check code before pushing` | `staged file linter` |
| `npm-dominant` | reuse | `JavaScript CLI argument parser` | `parse command line options with aliases` | `Node options parser` |
| `python-dominant` | reuse | `Python HTTP client` | `make HTTP requests with sessions` | `Python requests library` |
| `low-star-niche` | reuse | `process port killer` | `find and kill a process listening on a port` | `interactive port CLI` |
| `no-real-competitor` | competition | `pastry recipe MIDI converter` | `encode baking times as MIDI notes` | `Hungarian pastry music CLI` |

Append these exact cases:

```js
{
  id: "rust-registry",
  description: "A fast Rust command-line tool for recursively searching text with regular expressions.",
  keywords: ["rust", "recursive", "text", "search"],
  queries: { category: "Rust recursive text search", outcome: "search files with regular expressions", synonyms: "Rust grep CLI" },
  expectedPool: "reuse",
  expectAnyOf: ["ripgrep"],
},
{
  id: "ruby-registry",
  description: "A Ruby static code analyzer and formatter enforcing a configurable style guide.",
  keywords: ["ruby", "static", "analyzer", "formatter"],
  queries: { category: "Ruby static code analyzer", outcome: "enforce Ruby code style", synonyms: "Ruby linter formatter" },
  expectedPool: "reuse",
  expectAnyOf: ["rubocop"],
},
{
  id: "php-registry",
  description: "A PHP logging library that sends records to files, sockets, databases, and web services.",
  keywords: ["php", "logging", "library"],
  queries: { category: "PHP logging library", outcome: "send PHP logs to multiple handlers", synonyms: "PHP logger handlers" },
  expectedPool: "reuse",
  expectAnyOf: ["monolog/monolog", "monolog"],
},
{
  id: "jvm-registry",
  description: "A JVM library for building command-line applications with subcommands, typed options, and generated help.",
  keywords: ["jvm", "command-line", "options"],
  queries: { category: "JVM command line parser", outcome: "build Java CLI with subcommands", synonyms: "Java CLI options library" },
  expectedPool: "reuse",
  expectAnyOf: ["info.picocli:picocli", "picocli"],
},
{
  id: "commercial-scheduling",
  description: "A hosted page where other people can book an available meeting slot on my calendar.",
  keywords: ["meeting", "scheduling", "booking"],
  queries: { category: "meeting scheduling service", outcome: "let people book calendar availability", synonyms: "appointment booking link" },
  expectedPool: "competition",
  expectAnyOf: ["calendly"],
},
{
  id: "commercial-screen-recorder",
  description: "A desktop screen recorder that automatically adds polished zooms and cursor effects for product demos.",
  keywords: ["screen", "recorder", "zoom", "demo"],
  queries: { category: "product demo screen recorder", outcome: "record polished demos with automatic zoom", synonyms: "cinematic screen recording app" },
  expectedPool: "competition",
  expectAnyOf: ["screen studio", "screenstudio"],
},
```

Import `prepareCandidates` and `buildQueryPlan` in `run.mjs`. Replace
`runVariant` and `creditSource` with:

```js
async function runVariant(c) {
  const results = await searchAllResults(c.description, c.keywords, c.queries);
  const failures = results
    .filter((result) => !result.ok)
    .map((result) => ({ source: result.source, reason: result.reason }));
  const raw = results.flatMap((result) => result.ok ? result.value : []);
  const candidates = await prepareCandidates(raw);
  return { candidates, failures };
}

function rankOfFirstMatch(candidates, expectedPool, expectAnyOf) {
  const pool = candidates.filter((candidate) => candidate.pool === expectedPool);
  const index = pool.findIndex((candidate) => matches(candidate.id, expectAnyOf) || matches(candidate.name, expectAnyOf));
  return {
    rank: index === -1 ? null : index + 1,
    winner: index === -1 ? null : pool[index],
    poolSize: pool.length,
  };
}

function evidenceSources(candidate) {
  return candidate ? [...new Set(candidate.evidence.map((item) => item.source))] : [];
}
```

Replace the nested legacy `variants` loop with one planned search per case:

```js
for (const c of selected) {
  if (rows.length > 0) await sleep(sleepMs);
  requestBudget += 1;
  if (distStamp() !== startStamp) {
    console.error("dist/ changed mid-run; aborting mixed-build evaluation.");
    process.exit(3);
  }
  const { candidates, failures } = await runVariant(c);
  const { rank, winner, poolSize } = rankOfFirstMatch(
    candidates,
    c.expectedPool,
    c.expectAnyOf,
  );
  const formulations = Object.values(c.queries);
  const hitQueries = winner
    ? new Set(winner.evidence.map((item) => item.query))
    : new Set();
  const variant = {
    rank,
    pool: poolSize,
    failures,
    sources: evidenceSources(winner),
    hitRate: formulations.filter((query) => hitQueries.has(query)).length / formulations.length,
  };
  rows.push({
    id: c.id,
    expectedPool: c.expectedPool,
    best: c.expectNoMatch ? null : rank,
    hitRate: c.expectNoMatch ? 0 : variant.hitRate,
    variants: [variant],
    trueNegative: Boolean(c.expectNoMatch),
    falsePositives: c.expectNoMatch && candidates.length > 0 ? candidates.length : 0,
  });
}
```

In `summarize`, replace the single recall fields with:

```js
const byPool = (pool) => scored.filter((row) => row.expectedPool === pool);
const recallAt = (rows, k) =>
  rows.length === 0 ? 0 : rows.filter((row) => row.best !== null && row.best <= k).length / rows.length;
const reuse = byPool("reuse");
const competition = byPool("competition");
return {
  generatedAt: new Date().toISOString(),
  reuse: { cases: reuse.length, recallAt5: Number(recallAt(reuse, 5).toFixed(3)), recallAt10: Number(recallAt(reuse, 10).toFixed(3)) },
  competition: { cases: competition.length, recallAt5: Number(recallAt(competition, 5).toFixed(3)), recallAt10: Number(recallAt(competition, 10).toFixed(3)) },
  uniqueWins: Object.fromEntries(
    [...new Set(rows.flatMap((row) => row.variants.flatMap((variant) => variant.sources)))]
      .map((source) => [source, rows.filter((row) => row.variants.some((variant) => variant.sources.length === 1 && variant.sources[0] === source)).length]),
  ),
  webAvailability: {
    attempted: rows.reduce((count, row) => count + row.variants.length, 0),
    failed: rows.reduce((count, row) => count + row.variants.filter((variant) => variant.failures.some((failure) => failure.source === "web")).length, 0),
  },
  falsePositivesOnTrueNegatives: rows.filter((row) => row.trueNegative).reduce((count, row) => count + row.falsePositives, 0),
  perCase: Object.fromEntries(rows.map((row) => [row.id, row.best])),
};
```

After case selection, calculate pacing from actual plans:

```js
const maxGithubRequests = Math.max(...selected.map((c) => {
  const plan = buildQueryPlan(c.description, c.keywords, c.queries);
  return plan.ecosystem === "python" ? 3 : 2;
}));
const defaultSleepMs = Math.ceil(
  (60_000 / (GITHUB_LIMIT_PER_MIN / maxGithubRequests)) * 1.25,
);
const sleepMs = Number(process.env.EVAL_SLEEP_MS ?? defaultSleepMs);
```

Delete `GITHUB_REQUESTS_PER_VARIANT`, `DEFAULT_SLEEP_MS`, and `SLEEP_MS`. Keep
`GITHUB_LIMIT_PER_MIN`. Increment `requestBudget` once inside the replacement
case loop and use `sleepMs` in the final run summary.

Replace the old per-variant console fields with:

```js
for (const row of rows) {
  const label = row.trueNegative
    ? `${row.falsePositives} retrieval candidate(s)`
    : row.best === null ? "MISS" : `rank ${row.best}`;
  const variant = row.variants[0];
  console.log(
    `${row.id.padEnd(26)} ${label.padEnd(24)} ` +
    `pool=${row.expectedPool} query-hit=${(row.hitRate * 100).toFixed(0)}% ` +
    `sources=${variant.sources.join(",") || "none"}`,
  );
  if (variant.failures.length > 0) {
    console.log(`    failures: ${variant.failures.map((failure) => `${failure.source}:${failure.reason}`).join("; ")}`);
  }
}
console.log("\n=== summary ===");
console.log(`reuse       recall@5=${summary.reuse.recallAt5} recall@10=${summary.reuse.recallAt10}`);
console.log(`competition recall@5=${summary.competition.recallAt5} recall@10=${summary.competition.recallAt10}`);
console.log(`unique wins ${JSON.stringify(summary.uniqueWins)}`);
console.log(`web         ${summary.webAvailability.failed}/${summary.webAvailability.attempted} failed`);
```

For `--diff`, compare the four explicit fields
`reuse.recallAt5`, `reuse.recallAt10`, `competition.recallAt5`, and
`competition.recallAt10`, then retain the existing per-case movement loop.

Replace the contaminated-baseline count with:

```js
const requiredFailures = rows.reduce(
  (count, row) => count + row.variants.reduce(
    (inner, variant) =>
      inner + variant.failures.filter((failure) => failure.source !== "web").length,
    0,
  ),
  0,
);
```

Use `requiredFailures` for the warning and `--save` refusal. Product Hunt,
registries, GitLab, HN, GitHub, and npm are required only when the request
planner attempted them; the experimental `web` source is the sole exclusion.

- [ ] **Step 5: Verify offline behavior, run a clean live baseline, and commit**

Run: `npm test`

Expected: all offline tests PASS.

Run: `GITHUB_TOKEN="$(gh auth token)" npm run eval -- --diff`

Expected: zero required-source failures; per-pool metrics, source contribution,
and web availability are printed.

Run after inspecting the diff: `GITHUB_TOKEN="$(gh auth token)" npm run eval -- --save`

Expected: `test/eval/baseline.json` records the new schema and clean scores.

```bash
git add src/cli.ts test/unit/cli.test.ts test/eval/cases.mjs test/eval/run.mjs test/eval/baseline.json
git commit -m "Evaluate reuse and competitor discovery"
```

### Task 11: Documentation and final verification

**Files:**

- Modify: `README.md`
- Modify: `docs/how-it-works.md`
- Modify: `docs/findings.md`
- Modify: `package.json`
- Modify: `package-lock.json`
- Modify: `server.json`
- Modify: `src/index.ts`

- [ ] **Step 1: Update user-facing claims**

Document:

- both output sections;
- the stable keyless sources and conditional registries;
- Product Hunt RSS as recent-only;
- DuckDuckGo HTML as experimental and removable;
- optional `queries`;
- honest empty-result wording;
- source coverage and privacy behavior.

Remove claims that the tool searches only GitHub/npm/Python and every statement
that equates an empty retrieval result with being "clear to build."

- [ ] **Step 2: Update technical documentation**

In `docs/how-it-works.md`, document the exact request planner, the
`sum(1 / (60 + rank))` fusion formula, canonicalization, evidence deduplication,
separate verification rules, and all-failed semantics.

In `docs/findings.md`, replace the baseline section with the clean Task 10
results and list unique contribution counts by source. If DuckDuckGo has no
unique win, document its removal and delete its adapter/tests/fixtures in the
same commit.

- [ ] **Step 3: Run formatting and repository checks**

Set the release version to `0.3.0` in `package.json`, the root package entries
in `package-lock.json`, the MCP server constructor in `src/index.ts`, and both
version fields in `server.json`.

Run: `npm run build`

Expected: TypeScript exits 0.

Run: `npm test`

Expected: all offline tests PASS.

Run: `git diff --check`

Expected: no output.

- [ ] **Step 4: Inspect the package contents**

Run: `npm pack --dry-run`

Expected: the package contains `dist`, `README.md`, and `LICENSE`; no test
fixtures, local state, or design documents are published.

- [ ] **Step 5: Commit**

```bash
git add README.md docs/how-it-works.md docs/findings.md package.json package-lock.json server.json src/index.ts
git commit -m "Document multi-source discovery"
```

- [ ] **Step 6: Final clean-state verification**

Run: `git status --short`

Expected: only the pre-existing untracked `check-before-building-template.md`
is listed.

Run: `git log --oneline -12`

Expected: the implementation commits appear in task order after design commit
`dae8b41`.
