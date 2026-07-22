# reuse-before-generate Solidification Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Harden the v0 MCP server into a tested, measurable, publishable tool — without changing its core design (the calling agent performs semantic re-ranking, not the server).

**Architecture:** Introduce a single injectable HTTP seam (`src/http.ts`) that all network calls route through, which simultaneously enables offline unit testing and adds the currently-missing request timeouts. Validate all upstream JSON with zod and return Result objects instead of throwing, so one failing source degrades gracefully instead of killing the call. Add a local CLI so search quality can be iterated without an agent session, then replace pass/fail recall fixtures with scored metrics (rank, recall@k, MRR) to make query experiments empirical.

**Tech Stack:** TypeScript 5.7 (ES2022, NodeNext), Node 25 (built-in `node:test` runner — no new test dependency), zod 3.25 (already a dependency), `@modelcontextprotocol/sdk` 1.29.

**Verified facts this plan relies on:**
- Node 25.2.1 is installed; `node --test` works natively and strips TypeScript, so
  `.test.ts` files run directly.
- **The test script must use a glob, not a bare directory.** `node --test test/unit/`
  fails on Node 25 with `MODULE_NOT_FOUND` (it tries to resolve the directory as a
  module). The working form is `node --test test/unit/*.test.ts`. Verified 2026-07-22.
  Every task in this plan that shows `npm test` assumes the glob form.
- PyPI still has **no** JSON search API — `https://pypi.org/search/?q=...&format=json` returns `text/html`. Name-guessing plus a GitHub `language:python` lane is the correct approach (Task 16).
- A GitHub query with `language:python` returns few enough results that 0-star repos surface naturally (verified: 12 total results, three of them 0-4 stars).
- `node --test test/` currently picks up `test/fixtures.mjs` and fails on live network — unit tests therefore go in `test/unit/`, and the runner must be pointed at that directory specifically.

---

## File Structure

**Created:**
- `src/http.ts` — the injectable fetch seam + timeout policy. Sole owner of outbound HTTP.
- `src/result.ts` — the `Result` type and its constructors. No logic, just the shape.
- `src/schemas.ts` — zod schemas for GitHub/npm/PyPI response bodies.
- `src/cli.ts` — local command-line entry point for iterating on search quality.
- `test/unit/*.test.ts` — offline unit tests (`node --test`).
- `test/eval/run.mjs` — scored recall eval (live network, never part of `npm test`).
- `test/eval/cases.mjs` — the fixture corpus, extracted from `test/fixtures.mjs`.
- `test/eval/baseline.json` — committed scores to diff against.
- `LICENSE` — MIT.
- `docs/findings.md` — the search-quality analysis moved out of README.
- `.github/workflows/ci.yml` — build + unit tests on push/PR; eval on schedule/dispatch.

**Modified:**
- `src/search.ts` — route through `http.ts`, validate with `schemas.ts`, return `Result`.
- `src/verify.ts` — fix malformed-date reporting.
- `src/index.ts` — handle partial source failure, drop energy line from default output, stop awaiting telemetry.
- `src/energy.ts` — gate display behind env var.
- `src/telemetry.ts` — cache install ID.
- `package.json` — test/eval/check scripts, packaging metadata.
- `README.md` — install-first restructure.

**Deleted:**
- `test/fixtures.mjs` — replaced by `test/eval/`.

---

## Task 1: Result type

**Files:**
- Create: `src/result.ts`
- Test: `test/unit/result.test.ts`

- [ ] **Step 1: Write the failing test**

Create `test/unit/result.test.ts`:

```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { ok, err } from "../../dist/result.js";

test("ok() wraps a value and narrows to the success branch", () => {
  const r = ok("github", [1, 2]);
  assert.equal(r.ok, true);
  if (r.ok) {
    assert.equal(r.source, "github");
    assert.deepEqual(r.value, [1, 2]);
  }
});

test("err() carries source and reason and is not ok", () => {
  const r = err("npm", "HTTP 503");
  assert.equal(r.ok, false);
  if (!r.ok) {
    assert.equal(r.source, "npm");
    assert.equal(r.reason, "HTTP 503");
  }
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm run build && node --test test/unit/result.test.ts`
Expected: FAIL — cannot find module `../../dist/result.js`.

- [ ] **Step 3: Write the implementation**

Create `src/result.ts`:

```ts
// Result type for source-level operations. Per project convention we prefer
// returning failures over throwing them: one dead upstream (npm 503, GitHub
// rate limit) must degrade that source only, never the whole tool call.

export type Source = "github" | "npm" | "pypi";

export type Result<T> =
  | { ok: true; source: Source; value: T }
  | { ok: false; source: Source; reason: string };

export function ok<T>(source: Source, value: T): Result<T> {
  return { ok: true, source, value };
}

// T is unused in the error branch and is pinned by the caller's return-type
// annotation, not by the arguments. Every call site declares its own
// `Promise<Result<...>>`, so inference works; called somewhere unannotated,
// T would silently widen to unknown. Keep the annotations.
export function err<T>(source: Source, reason: string): Result<T> {
  return { ok: false, source, reason };
}

// No isOk() guard: `r.ok` narrows the union on its own, so a helper would be
// unused indirection. Checks throughout the codebase are plain `if (r.ok)`.
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm run build && node --test test/unit/result.test.ts`
Expected: PASS — 2 tests.

- [ ] **Step 5: Add the test script and commit**

In `package.json`, add to `"scripts"`:

```json
"test": "npm run build && node --test test/unit/*.test.ts"
```

The glob is required: a bare `test/unit/` directory argument fails on Node 25 with
`MODULE_NOT_FOUND`.

```bash
git add src/result.ts test/unit/result.test.ts package.json
git commit -m "Add Result type for source-level failures"
```

---

## Task 2: HTTP seam with timeouts

**Files:**
- Create: `src/http.ts`
- Test: `test/unit/http.test.ts`

- [ ] **Step 1: Write the failing test**

Create `test/unit/http.test.ts`:

```ts
import { test, afterEach } from "node:test";
import assert from "node:assert/strict";
import { httpGet, setFetcher, resetFetcher } from "../../dist/http.js";

afterEach(() => resetFetcher());

test("httpGet routes through the injected fetcher", async () => {
  let seenUrl = "";
  setFetcher(async (url) => {
    seenUrl = url;
    return new Response("{}", { status: 200 });
  });

  const res = await httpGet("https://example.test/a", { "User-Agent": "x" });

  assert.equal(seenUrl, "https://example.test/a");
  assert.equal(res.status, 200);
});

test("httpGet passes headers through", async () => {
  let seenHeaders: Record<string, string> = {};
  setFetcher(async (_url, init) => {
    seenHeaders = (init?.headers ?? {}) as Record<string, string>;
    return new Response("{}", { status: 200 });
  });

  await httpGet("https://example.test/a", { Authorization: "Bearer t" });

  assert.equal(seenHeaders.Authorization, "Bearer t");
});

test("httpGet attaches an abort signal so requests cannot hang forever", async () => {
  let hadSignal = false;
  setFetcher(async (_url, init) => {
    hadSignal = init?.signal instanceof AbortSignal;
    return new Response("{}", { status: 200 });
  });

  await httpGet("https://example.test/a", {});

  assert.equal(hadSignal, true);
});

test("resetFetcher restores the default fetcher", async () => {
  setFetcher(async () => new Response("stub", { status: 418 }));
  resetFetcher();
  // After reset the stub must no longer be in effect. We assert indirectly:
  // the module-level fetcher is not the stub, so calling it would hit the
  // network. Rather than make a real request, re-inject and confirm the
  // injection point still works.
  let called = false;
  setFetcher(async () => {
    called = true;
    return new Response("{}", { status: 200 });
  });
  await httpGet("https://example.test/a", {});
  assert.equal(called, true);
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm run build && node --test test/unit/http.test.ts`
Expected: FAIL — cannot find module `../../dist/http.js`.

- [ ] **Step 3: Write the implementation**

Create `src/http.ts`:

```ts
// Sole owner of outbound HTTP. Two reasons this exists:
//
// 1. Testability. search.ts previously called global fetch directly, which
//    made every code path that touches the network untestable offline.
//    setFetcher() is the seam; it is test-only.
// 2. Timeouts. The three search calls previously had none, so a hung
//    upstream hung the whole MCP tool call indefinitely. Routing everything
//    through httpGet gives every request a deadline by construction.

export type Fetcher = (url: string, init?: RequestInit) => Promise<Response>;

const defaultFetcher: Fetcher = (url, init) => fetch(url, init);

let current: Fetcher = defaultFetcher;

/** Test-only. Replaces the fetcher used by every httpGet call. */
export function setFetcher(f: Fetcher): void {
  current = f;
}

/** Test-only. Restores the real network fetcher. */
export function resetFetcher(): void {
  current = defaultFetcher;
}

export const DEFAULT_TIMEOUT_MS = 8000;

export function httpGet(
  url: string,
  headers: Record<string, string>,
  timeoutMs: number = DEFAULT_TIMEOUT_MS,
): Promise<Response> {
  return current(url, {
    headers,
    signal: AbortSignal.timeout(timeoutMs),
  });
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm run build && node --test test/unit/http.test.ts`
Expected: PASS — 4 tests.

- [ ] **Step 5: Commit**

```bash
git add src/http.ts test/unit/http.test.ts
git commit -m "Add injectable HTTP seam with request timeouts"
```

---

## Task 3: Response schemas

**Files:**
- Create: `src/schemas.ts`
- Test: `test/unit/schemas.test.ts`

- [ ] **Step 1: Write the failing test**

Create `test/unit/schemas.test.ts`:

```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { GitHubSearchResponse, NpmSearchResponse, PyPIProjectResponse } from "../../dist/schemas.js";

test("GitHubSearchResponse accepts a well-formed payload", () => {
  const parsed = GitHubSearchResponse.safeParse({
    items: [
      {
        full_name: "psf/black",
        html_url: "https://github.com/psf/black",
        description: "The uncompromising Python code formatter",
        stargazers_count: 39000,
        pushed_at: "2026-07-01T00:00:00Z",
        archived: false,
      },
    ],
  });
  assert.equal(parsed.success, true);
});

test("GitHubSearchResponse accepts a null description", () => {
  const parsed = GitHubSearchResponse.safeParse({
    items: [
      {
        full_name: "a/b",
        html_url: "https://github.com/a/b",
        description: null,
        stargazers_count: 0,
        pushed_at: "2026-07-01T00:00:00Z",
        archived: false,
      },
    ],
  });
  assert.equal(parsed.success, true);
});

test("GitHubSearchResponse rejects a payload missing items", () => {
  const parsed = GitHubSearchResponse.safeParse({ message: "API rate limit exceeded" });
  assert.equal(parsed.success, false);
});

test("NpmSearchResponse accepts a package without a repository link", () => {
  const parsed = NpmSearchResponse.safeParse({
    objects: [
      {
        package: {
          name: "chalk",
          description: "Terminal string styling",
          links: { npm: "https://npmjs.com/package/chalk" },
          date: "2026-01-01T00:00:00Z",
        },
      },
    ],
  });
  assert.equal(parsed.success, true);
});

test("NpmSearchResponse rejects a non-array objects field", () => {
  const parsed = NpmSearchResponse.safeParse({ objects: "nope" });
  assert.equal(parsed.success, false);
});

test("PyPIProjectResponse accepts a project with no upload urls", () => {
  const parsed = PyPIProjectResponse.safeParse({
    info: { name: "black", summary: "code formatter", project_url: "https://pypi.org/project/black/" },
    urls: [],
  });
  assert.equal(parsed.success, true);
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm run build && node --test test/unit/schemas.test.ts`
Expected: FAIL — cannot find module `../../dist/schemas.js`.

- [ ] **Step 3: Write the implementation**

Create `src/schemas.ts`:

```ts
// zod schemas for upstream response bodies. search.ts previously cast
// res.json() straight to a TypeScript interface, which is a compile-time
// fiction: a shape change at GitHub or npm produced a TypeError deep inside
// the tool handler and surfaced as an opaque error string. Parsing here
// turns shape drift into a normal, attributable source failure.
//
// Every schema is deliberately permissive about fields we do not read.

import { z } from "zod";

export const GitHubSearchItem = z.object({
  full_name: z.string(),
  html_url: z.string(),
  description: z.string().nullable(),
  stargazers_count: z.number(),
  pushed_at: z.string(),
  archived: z.boolean(),
});

export const GitHubSearchResponse = z.object({
  items: z.array(GitHubSearchItem),
});

export const NpmSearchResponse = z.object({
  objects: z.array(
    z.object({
      package: z.object({
        name: z.string(),
        description: z.string().nullable().optional(),
        links: z.object({
          npm: z.string(),
          repository: z.string().optional(),
        }),
        date: z.string(),
      }),
    }),
  ),
});

export const PyPIProjectResponse = z.object({
  info: z.object({
    name: z.string(),
    summary: z.string().nullable(),
    project_url: z.string(),
  }),
  urls: z.array(z.object({ upload_time_iso_8601: z.string().optional() })),
});

export type GitHubSearchItemT = z.infer<typeof GitHubSearchItem>;
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm run build && node --test test/unit/schemas.test.ts`
Expected: PASS — 6 tests.

- [ ] **Step 5: Commit**

```bash
git add src/schemas.ts test/unit/schemas.test.ts
git commit -m "Add zod schemas for upstream search responses"
```

---

## Task 4: Fix keywordsAsQuery boundary bugs

**Files:**
- Modify: `src/search.ts:83-91`
- Test: `test/unit/keywords.test.ts`

**Context:** `keywordsAsQuery` returns `""` when the first keyword alone exceeds `maxChars`. That empty string becomes `text=` in the npm request, and npm rejects text shorter than 2 characters with `ERR_TEXT_LENGTH` — a 400 that currently reads as a generic source failure. The fix is to truncate the first keyword rather than emit nothing.

- [ ] **Step 1: Write the failing test**

Create `test/unit/keywords.test.ts`:

```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { keywordsAsQuery, extractKeywords } from "../../dist/search.js";

test("keywordsAsQuery joins keywords with spaces", () => {
  assert.equal(keywordsAsQuery(["json", "viewer", "terminal"]), "json viewer terminal");
});

test("keywordsAsQuery drops whole words that would exceed the cap", () => {
  const out = keywordsAsQuery(["aaaa", "bbbb", "cccc"], 9);
  assert.equal(out, "aaaa bbbb");
});

test("keywordsAsQuery accepts a query exactly at the cap", () => {
  const out = keywordsAsQuery(["aaaa", "bbbb"], 9);
  assert.equal(out, "aaaa bbbb");
  assert.equal(out.length, 9);
});

test("keywordsAsQuery truncates rather than returning empty when the first word exceeds the cap", () => {
  // Regression: previously returned "", which npm rejects with
  // ERR_TEXT_LENGTH (its minimum text length is 2).
  const out = keywordsAsQuery(["supercalifragilistic"], 8);
  assert.equal(out, "supercal");
  assert.equal(out.length, 8);
});

test("keywordsAsQuery returns empty string for no keywords", () => {
  assert.equal(keywordsAsQuery([]), "");
});

test("extractKeywords keeps first-occurrence order and drops stop words", () => {
  const out = extractKeywords("A command-line tool that formats Python source code", 4);
  assert.deepEqual(out, ["command-line", "formats", "python", "code"]);
});

test("extractKeywords respects the max cap", () => {
  const out = extractKeywords("alpha bravo charlie delta echo foxtrot", 3);
  assert.equal(out.length, 3);
});

test("extractKeywords returns an empty array for an all-stop-word description", () => {
  assert.deepEqual(extractKeywords("the a an and or but for to of in"), []);
});

test("extractKeywords returns an empty array for punctuation-only input", () => {
  assert.deepEqual(extractKeywords("!!! ??? ..."), []);
});
```

- [ ] **Step 2: Run the tests to verify the boundary case fails**

Run: `npm run build && node --test test/unit/keywords.test.ts`
Expected: FAIL on "truncates rather than returning empty" — got `""`, expected `"supercal"`. The other tests pass.

Note: if "extractKeywords keeps first-occurrence order" also fails, record the actual output and update the assertion to match — the stop-word list is intentionally tuned and that test documents current behavior rather than driving a change.

- [ ] **Step 3: Fix the implementation**

Replace `keywordsAsQuery` in `src/search.ts` (currently lines 83-91):

```ts
export function keywordsAsQuery(keywords: string[], maxChars = 64): string {
  let out = "";
  for (const kw of keywords) {
    const next = out ? `${out} ${kw}` : kw;
    if (next.length > maxChars) break;
    out = next;
  }
  // A single keyword longer than the cap would otherwise leave `out` empty,
  // which npm rejects outright (ERR_TEXT_LENGTH: text must be 2-64 chars).
  // A truncated query is a worse query but still a valid one; an empty query
  // is a guaranteed 400.
  if (out === "" && keywords.length > 0) {
    return keywords[0].slice(0, maxChars);
  }
  return out;
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm run build && node --test test/unit/keywords.test.ts`
Expected: PASS — 9 tests.

- [ ] **Step 5: Commit**

```bash
git add src/search.ts test/unit/keywords.test.ts
git commit -m "Fix keywordsAsQuery returning empty query for overlong first keyword"
```

---

## Task 5: Guard against empty search queries

**Files:**
- Modify: `src/search.ts` (`searchGitHub`, `searchNpm`)
- Test: `test/unit/search-guards.test.ts`

**Context:** `extractKeywords` can return `[]` (proven by Task 4's test), which produces the bare GitHub query `" in:name,description,readme"` and an empty npm `text=`. Both are wasted calls at best. This task adds the guard; Task 7 converts these functions to `Result`, so the guard returns a plain empty array for now and is revisited there.

- [ ] **Step 1: Write the failing test**

Create `test/unit/search-guards.test.ts`:

```ts
import { test, afterEach } from "node:test";
import assert from "node:assert/strict";
import { searchGitHub, searchNpm } from "../../dist/search.js";
import { setFetcher, resetFetcher } from "../../dist/http.js";

afterEach(() => resetFetcher());

test("searchGitHub makes no request when keywords are empty", async () => {
  let calls = 0;
  setFetcher(async () => {
    calls += 1;
    return new Response(JSON.stringify({ items: [] }), { status: 200 });
  });

  const out = await searchGitHub("the a an and or", []);

  assert.equal(calls, 0);
  assert.deepEqual(out, []);
});

test("searchNpm makes no request when keywords are empty", async () => {
  let calls = 0;
  setFetcher(async () => {
    calls += 1;
    return new Response(JSON.stringify({ objects: [] }), { status: 200 });
  });

  const out = await searchNpm("the a an and or", []);

  assert.equal(calls, 0);
  assert.deepEqual(out, []);
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm run build && node --test test/unit/search-guards.test.ts`
Expected: FAIL — `calls` is 2 for GitHub (primary + low-star lanes) and 1 for npm.

- [ ] **Step 3: Add the guards**

In `src/search.ts`, at the top of `searchGitHub`, immediately after the `keywords` const is computed:

```ts
export async function searchGitHub(
  description: string,
  overrideKeywords?: string[],
  limit = 15,
): Promise<RawCandidate[]> {
  const keywordList = overrideKeywords ?? extractKeywords(description, 4);
  // An all-stop-word description yields no keywords, which would send the
  // bare query " in:name,description,readme" — a request guaranteed to
  // return noise, against a rate limit of 10/min unauthenticated.
  if (keywordList.length === 0) return [];
  const keywords = keywordList.join(" ");
  // ... rest of the existing function body unchanged
```

In `src/search.ts`, at the top of `searchNpm`:

```ts
export async function searchNpm(
  description: string,
  overrideKeywords?: string[],
  limit = 10,
): Promise<RawCandidate[]> {
  const keywords = keywordsAsQuery(overrideKeywords ?? extractKeywords(description, 4));
  // npm rejects text outside 2-64 chars (ERR_TEXT_LENGTH); skip the round
  // trip rather than spend it on a guaranteed 400.
  if (keywords.length < 2) return [];
  // ... rest of the existing function body unchanged
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm run build && node --test test/unit/search-guards.test.ts`
Expected: PASS — 2 tests.

- [ ] **Step 5: Commit**

```bash
git add src/search.ts test/unit/search-guards.test.ts
git commit -m "Skip search requests when keyword extraction yields nothing"
```

---

## Task 6: Verify boundary and malformed-date handling

**Files:**
- Modify: `src/verify.ts:27-32`, `src/verify.ts:48-55`
- Test: `test/unit/verify.test.ts`

**Context:** `daysSince` returns `null` both for a genuinely absent date and for an unparseable one, and both are reported as "no activity date available". Those are different upstream problems and should read differently.

- [ ] **Step 1: Write the failing test**

Create `test/unit/verify.test.ts`:

```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { verifyCandidate } from "../../dist/verify.js";

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

test("a future date is treated as active, not as an error", async () => {
  const v = await verifyCandidate({ ...base, pushedAt: daysAgo(-2) });
  assert.equal(v.maintained, true);
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm run build && node --test test/unit/verify.test.ts`
Expected: FAIL on "a malformed date is reported distinctly" — got "no activity date available".

- [ ] **Step 3: Fix the implementation**

In `src/verify.ts`, replace `daysSince` and the null branch of `verifyCandidate`:

```ts
type ActivityAge =
  | { kind: "known"; days: number }
  | { kind: "missing" }
  | { kind: "unparseable"; raw: string };

function activityAge(iso: string | undefined): ActivityAge {
  if (!iso) return { kind: "missing" };
  const then = new Date(iso).getTime();
  // A missing date and a date we could not parse are different upstream
  // problems: the first is normal for some npm records, the second means
  // the response shape changed or the registry emitted something odd.
  if (Number.isNaN(then)) return { kind: "unparseable", raw: iso };
  return { kind: "known", days: Math.floor((Date.now() - then) / (1000 * 60 * 60 * 24)) };
}
```

Then rewrite `verifyCandidate` to use it:

```ts
export async function verifyCandidate(
  candidate: RawCandidate,
): Promise<VerifiedCandidate> {
  const age = activityAge(candidate.pushedAt);
  const days = age.kind === "known" ? age.days : null;

  if (candidate.archived) {
    return {
      ...candidate,
      maintained: false,
      maintenanceReason: "repository is archived",
      daysSinceLastActivity: days,
    };
  }

  if (age.kind === "missing") {
    return {
      ...candidate,
      maintained: false,
      maintenanceReason: "no activity date available",
      daysSinceLastActivity: null,
    };
  }

  if (age.kind === "unparseable") {
    return {
      ...candidate,
      maintained: false,
      maintenanceReason: `unparseable activity date: ${age.raw}`,
      daysSinceLastActivity: null,
    };
  }

  if (age.days > MAINTAINED_WINDOW_DAYS) {
    return {
      ...candidate,
      maintained: false,
      maintenanceReason: `no activity in ${age.days} days (> ${MAINTAINED_WINDOW_DAYS}-day window)`,
      daysSinceLastActivity: age.days,
    };
  }

  return {
    ...candidate,
    maintained: true,
    maintenanceReason: `active within the last ${age.days} days`,
    daysSinceLastActivity: age.days,
  };
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm run build && node --test test/unit/verify.test.ts`
Expected: PASS — 8 tests.

- [ ] **Step 5: Commit**

```bash
git add src/verify.ts test/unit/verify.test.ts
git commit -m "Distinguish unparseable activity dates from missing ones"
```

---

## Task 7: Route search through the HTTP seam and validate responses

**Files:**
- Modify: `src/search.ts` (all three source functions + `searchAll`)
- Test: `test/unit/search-pipeline.test.ts`

**Context:** This is the largest task. It replaces every direct `fetch` in `search.ts` with `httpGet`, parses each response with the Task 3 schemas, and changes each source function to return `Result<RawCandidate[]>`. `searchAll` returns all three Results rather than a flat array.

**Carried over from Task 5 — must be done as part of this task:**

1. `test/unit/search-guards.test.ts` stubs `globalThis.fetch`. Once search.ts
   routes through `http.ts`, that stub intercepts nothing and those five tests
   pass **vacuously** (0 calls always, guard firing or not). Convert them to
   `setFetcher`/`resetFetcher`, then verify they still fail when the guard is
   removed — a test that cannot fail is worse than no test.
2. `searchPyPI` builds name guesses via `keywords.join("-")` without filtering
   per-entry content, so `["", ""]` requests `pypi.org/pypi/-/json`. Apply
   `meaningfulKeywords()` (exported from search.ts) there too, as the other
   two lanes already do.

- [ ] **Step 1: Write the failing test**

Create `test/unit/search-pipeline.test.ts`:

```ts
import { test, afterEach } from "node:test";
import assert from "node:assert/strict";
import { searchAllResults } from "../../dist/search.js";
import { setFetcher, resetFetcher } from "../../dist/http.js";

afterEach(() => resetFetcher());

const githubBody = {
  items: [
    {
      full_name: "psf/black",
      html_url: "https://github.com/psf/black",
      description: "The uncompromising Python code formatter",
      stargazers_count: 39000,
      pushed_at: "2026-07-01T00:00:00Z",
      archived: false,
    },
  ],
};

const npmBody = {
  objects: [
    {
      package: {
        name: "prettier",
        description: "Opinionated code formatter",
        links: { npm: "https://npmjs.com/package/prettier" },
        date: "2026-06-01T00:00:00Z",
      },
    },
  ],
};

function routeFetcher(handlers: { github?: () => Response; npm?: () => Response; pypi?: () => Response }) {
  return async (url: string) => {
    if (url.includes("api.github.com")) {
      return handlers.github?.() ?? new Response(JSON.stringify({ items: [] }), { status: 200 });
    }
    if (url.includes("registry.npmjs.org")) {
      return handlers.npm?.() ?? new Response(JSON.stringify({ objects: [] }), { status: 200 });
    }
    return handlers.pypi?.() ?? new Response("{}", { status: 404 });
  };
}

test("searchAllResults returns ok results with candidates from each source", async () => {
  setFetcher(
    routeFetcher({
      github: () => new Response(JSON.stringify(githubBody), { status: 200 }),
      npm: () => new Response(JSON.stringify(npmBody), { status: 200 }),
    }),
  );

  const results = await searchAllResults("python formatter", ["python", "formatter", "code"]);
  const github = results.find((r) => r.source === "github");
  const npm = results.find((r) => r.source === "npm");

  assert.equal(github?.ok, true);
  assert.equal(npm?.ok, true);
  if (github?.ok) assert.equal(github.value[0].id, "psf/black");
  if (npm?.ok) assert.equal(npm.value[0].id, "prettier");
});

test("an HTTP error on one source does not fail the others", async () => {
  setFetcher(
    routeFetcher({
      github: () => new Response("rate limited", { status: 403 }),
      npm: () => new Response(JSON.stringify(npmBody), { status: 200 }),
    }),
  );

  const results = await searchAllResults("python formatter", ["python", "formatter", "code"]);
  const github = results.find((r) => r.source === "github");
  const npm = results.find((r) => r.source === "npm");

  assert.equal(github?.ok, false);
  if (github && !github.ok) assert.match(github.reason, /403/);
  assert.equal(npm?.ok, true);
});

test("a malformed response shape is reported as a source failure, not a crash", async () => {
  setFetcher(
    routeFetcher({
      github: () => new Response(JSON.stringify({ message: "shape changed" }), { status: 200 }),
      npm: () => new Response(JSON.stringify(npmBody), { status: 200 }),
    }),
  );

  const results = await searchAllResults("python formatter", ["python", "formatter", "code"]);
  const github = results.find((r) => r.source === "github");

  assert.equal(github?.ok, false);
  if (github && !github.ok) assert.match(github.reason, /unexpected response shape/i);
});

test("a thrown network error is reported as a source failure", async () => {
  setFetcher(
    routeFetcher({
      github: () => {
        throw new Error("ECONNRESET");
      },
      npm: () => new Response(JSON.stringify(npmBody), { status: 200 }),
    }),
  );

  const results = await searchAllResults("python formatter", ["python", "formatter", "code"]);
  const github = results.find((r) => r.source === "github");

  assert.equal(github?.ok, false);
  if (github && !github.ok) assert.match(github.reason, /ECONNRESET/);
});

test("github primary and low-star lanes are deduplicated by full_name", async () => {
  setFetcher(
    routeFetcher({
      github: () => new Response(JSON.stringify(githubBody), { status: 200 }),
    }),
  );

  const results = await searchAllResults("python formatter", ["python", "formatter", "code"]);
  const github = results.find((r) => r.source === "github");

  // Both lanes return the same single item; it must appear once.
  if (github?.ok) assert.equal(github.value.length, 1);
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm run build && node --test test/unit/search-pipeline.test.ts`
Expected: FAIL — `searchAllResults` is not exported from `dist/search.js`.

- [ ] **Step 3: Rewrite the network layer of `src/search.ts`**

Replace the imports at the top of `src/search.ts`:

```ts
import { httpGet } from "./http.js";
import { GitHubSearchResponse, NpmSearchResponse, PyPIProjectResponse, type GitHubSearchItemT } from "./schemas.js";
import { ok, err, type Result } from "./result.js";
```

Delete the local `GitHubSearchItem` interface (lines 93-100) — `schemas.ts` owns that shape now.

Replace `fetchGitHubSearch`:

```ts
async function fetchGitHubSearch(
  query: string,
  per_page: number,
  extraParams = "",
): Promise<GitHubSearchItemT[]> {
  const q = encodeURIComponent(query);
  const url = `${GITHUB_API}/search/repositories?q=${q}&per_page=${per_page}${extraParams}`;
  // GitHub's unauthenticated search endpoint has a tight primary limit
  // (10/min) plus a separate secondary "abuse detection" throttle on rapid
  // bursts — both surface as 403. One retry after a short backoff (honoring
  // Retry-After when present) covers the common transient case without
  // adding real latency to the normal path.
  let res = await httpGet(url, githubHeaders());
  if (res.status === 403 || res.status === 429) {
    const retryAfterHeader = res.headers.get("retry-after");
    const waitMs = retryAfterHeader ? Number(retryAfterHeader) * 1000 : 2000;
    await new Promise((r) => setTimeout(r, waitMs));
    res = await httpGet(url, githubHeaders());
  }
  if (!res.ok) {
    throw new Error(`GitHub search failed: HTTP ${res.status}`);
  }
  const parsed = GitHubSearchResponse.safeParse(await res.json());
  if (!parsed.success) {
    throw new Error("GitHub search returned an unexpected response shape");
  }
  return parsed.data.items;
}
```

Replace `searchGitHub` (keeping its existing explanatory comments about the two lanes verbatim):

```ts
export async function searchGitHubResult(
  description: string,
  overrideKeywords?: string[],
  limit = 15,
): Promise<Result<RawCandidate[]>> {
  const keywordList = overrideKeywords ?? extractKeywords(description, 4);
  if (keywordList.length === 0) return ok("github", []);
  const keywords = keywordList.join(" ");

  const baseQuery = `${keywords} in:name,description,readme`;
  const lowStarQuery = `${keywords} stars:0..3`;

  try {
    const [primary, lowStar] = await Promise.all([
      fetchGitHubSearch(baseQuery, limit),
      fetchGitHubSearch(lowStarQuery, Math.min(limit, 10)),
    ]);
    const seen = new Set<string>();
    const merged: RawCandidate[] = [];
    for (const item of [...primary, ...lowStar]) {
      if (seen.has(item.full_name)) continue;
      seen.add(item.full_name);
      merged.push(toCandidate(item));
    }
    return ok("github", merged);
  } catch (e) {
    return err("github", (e as Error).message);
  }
}

/** Back-compat wrapper: returns candidates or [] on failure. */
export async function searchGitHub(
  description: string,
  overrideKeywords?: string[],
  limit = 15,
): Promise<RawCandidate[]> {
  const r = await searchGitHubResult(description, overrideKeywords, limit);
  return r.ok ? r.value : [];
}
```

Replace `searchNpm`:

```ts
export async function searchNpmResult(
  description: string,
  overrideKeywords?: string[],
  limit = 10,
): Promise<Result<RawCandidate[]>> {
  const keywords = keywordsAsQuery(overrideKeywords ?? extractKeywords(description, 4));
  if (keywords.length < 2) return ok("npm", []);

  const url = `https://registry.npmjs.org/-/v1/search?text=${encodeURIComponent(keywords)}&size=${limit}`;
  try {
    const res = await httpGet(url, { "User-Agent": USER_AGENT });
    if (!res.ok) return err("npm", `npm search failed: HTTP ${res.status}`);

    const parsed = NpmSearchResponse.safeParse(await res.json());
    if (!parsed.success) {
      return err("npm", "npm search returned an unexpected response shape");
    }
    return ok(
      "npm",
      parsed.data.objects.map((obj) => ({
        source: "npm" as const,
        id: obj.package.name,
        name: obj.package.name,
        url: obj.package.links.repository ?? obj.package.links.npm,
        description: obj.package.description ?? "",
        pushedAt: obj.package.date,
      })),
    );
  } catch (e) {
    return err("npm", (e as Error).message);
  }
}

/** Back-compat wrapper: returns candidates or [] on failure. */
export async function searchNpm(
  description: string,
  overrideKeywords?: string[],
  limit = 10,
): Promise<RawCandidate[]> {
  const r = await searchNpmResult(description, overrideKeywords, limit);
  return r.ok ? r.value : [];
}
```

Replace `searchPyPI`:

```ts
export async function searchPyPIResult(
  description: string,
  overrideKeywords?: string[],
  limit = 10,
): Promise<Result<RawCandidate[]>> {
  // PyPI has no general JSON search API (the XML-RPC one was retired, and
  // https://pypi.org/search/?q=...&format=json still returns HTML — verified
  // 2026-07-22). Direct name guesses are cheap and catch exact hits; broader
  // Python coverage comes from the GitHub language:python lane instead.
  const keywords = overrideKeywords ?? extractKeywords(description, 4);
  if (keywords.length === 0) return ok("pypi", []);

  const guesses = [...new Set([keywords.join("-"), keywords.slice(0, 2).join("-")])];
  const results: RawCandidate[] = [];
  for (const guess of guesses) {
    try {
      const res = await httpGet(`https://pypi.org/pypi/${guess}/json`, { "User-Agent": USER_AGENT });
      if (!res.ok) continue;
      const parsed = PyPIProjectResponse.safeParse(await res.json());
      if (!parsed.success) continue;
      results.push({
        source: "pypi",
        id: parsed.data.info.name,
        name: parsed.data.info.name,
        url: parsed.data.info.project_url,
        description: parsed.data.info.summary ?? "",
        pushedAt: parsed.data.urls[0]?.upload_time_iso_8601,
      });
    } catch {
      // Guess-based lookup is best-effort; a miss is the normal case.
    }
  }
  return ok("pypi", results.slice(0, limit));
}

/** Back-compat wrapper: returns candidates or [] on failure. */
export async function searchPyPI(
  description: string,
  overrideKeywords?: string[],
  limit = 10,
): Promise<RawCandidate[]> {
  const r = await searchPyPIResult(description, overrideKeywords, limit);
  return r.ok ? r.value : [];
}
```

Replace `searchAll` and add `searchAllResults`:

```ts
/** Returns one Result per source, so the caller can report partial failure
 * honestly ("npm search failed") instead of silently returning fewer
 * candidates with no explanation. */
export async function searchAllResults(
  description: string,
  keywords?: string[],
): Promise<Result<RawCandidate[]>[]> {
  return Promise.all([
    searchGitHubResult(description, keywords),
    searchNpmResult(description, keywords),
    searchPyPIResult(description, keywords),
  ]);
}

/** Flattened view for callers that do not care which source failed. */
export async function searchAll(
  description: string,
  keywords?: string[],
): Promise<RawCandidate[]> {
  const results = await searchAllResults(description, keywords);
  return results.flatMap((r) => (r.ok ? r.value : []));
}
```

- [ ] **Step 4: Run the full unit suite to verify it passes**

Run: `npm test`
Expected: PASS — all tests across every `test/unit/*.test.ts` file, including the earlier tasks' tests.

- [ ] **Step 5: Commit**

```bash
git add src/search.ts test/unit/search-pipeline.test.ts
git commit -m "Route search through HTTP seam, validate responses, return Results"
```

---

## Task 8: Report partial source failures in the tool output

**Files:**
- Modify: `src/index.ts:55-122`
- Test: `test/unit/report.test.ts`

**Context:** The handler currently wraps everything in one `try/catch`, so a partial failure is invisible. This extracts the report-building into a pure, testable function.

- [ ] **Step 1: Write the failing test**

Create `test/unit/report.test.ts`:

```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { formatSourceFailures } from "../../dist/report.js";

test("returns an empty string when every source succeeded", () => {
  const out = formatSourceFailures([
    { ok: true, source: "github", value: [] },
    { ok: true, source: "npm", value: [] },
  ]);
  assert.equal(out, "");
});

test("names a single failing source and its reason", () => {
  const out = formatSourceFailures([
    { ok: true, source: "github", value: [] },
    { ok: false, source: "npm", reason: "npm search failed: HTTP 503" },
  ]);
  assert.match(out, /npm/);
  assert.match(out, /503/);
});

test("names every failing source when more than one fails", () => {
  const out = formatSourceFailures([
    { ok: false, source: "github", reason: "HTTP 403" },
    { ok: false, source: "npm", reason: "HTTP 503" },
  ]);
  assert.match(out, /github/);
  assert.match(out, /npm/);
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm run build && node --test test/unit/report.test.ts`
Expected: FAIL — cannot find module `../../dist/report.js`.

- [ ] **Step 3: Write the implementation**

Create `src/report.ts`:

```ts
// Output formatting helpers, kept separate from index.ts so they can be
// tested without constructing an MCP server.

import type { Result } from "./result.js";
import type { RawCandidate } from "./search.js";

/** Renders a one-line caveat naming any source that failed. Silent partial
 * degradation is the failure mode most corrosive to trust in a tool whose
 * whole claim is "I checked properly" — if a source was down, say so. */
export function formatSourceFailures(results: Result<RawCandidate[]>[]): string {
  const failures = results.filter((r) => !r.ok) as Array<{
    ok: false;
    source: string;
    reason: string;
  }>;
  if (failures.length === 0) return "";
  const parts = failures.map((f) => `${f.source} (${f.reason})`);
  return `Note: ${parts.join("; ")} — results below are from the remaining source(s) only.`;
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm run build && node --test test/unit/report.test.ts`
Expected: PASS — 3 tests.

- [ ] **Step 5: Wire it into the handler**

In `src/index.ts`, change the import line for search:

```ts
import { searchAllResults } from "./search.js";
import { formatSourceFailures } from "./report.js";
```

Replace the body of the handler's `try` block, from `const raw = await searchAll(...)` down to the final `return`:

```ts
      const results = await searchAllResults(description, keywords);
      const raw = results.flatMap((r) => (r.ok ? r.value : []));
      const failureNote = formatSourceFailures(results);
      const suffix = failureNote ? `\n\n${failureNote}` : "";

      if (raw.length === 0) {
        track({ type: "no_candidates_found" });
        return {
          content: [
            {
              type: "text",
              text:
                "No candidates found on GitHub, npm, or PyPI for this description. Nothing to reuse — clear to build." +
                suffix,
            },
          ],
        };
      }

      const verified = await verifyAll(raw);
      const maintained = verified.filter((c) => c.maintained);

      if (maintained.length === 0) {
        track({ type: "candidates_found", count: raw.length, maintainedCount: 0 });
        return {
          content: [
            {
              type: "text",
              text:
                `Found ${raw.length} superficially similar result(s), but none are actively maintained (all abandoned, archived, or too low-traction to trust). Not recommending any as alternatives — clear to build, but consider why prior attempts stalled.` +
                suffix,
            },
          ],
        };
      }

      track({
        type: "candidates_found",
        count: raw.length,
        maintainedCount: maintained.length,
      });

      const prompt = buildRerankPrompt(description, maintained);
      const energyLine = maybeEnergyLine();

      return {
        content: [{ type: "text", text: `${prompt}${energyLine}${suffix}` }],
      };
```

Note: `track(...)` is now called without `await` (Task 10) and `maybeEnergyLine()` is introduced in Task 9. Implement Tasks 9 and 10 before running the build, or temporarily keep `await track(...)` and the existing energy call and revisit.

- [ ] **Step 6: Commit**

```bash
git add src/report.ts src/index.ts test/unit/report.test.ts
git commit -m "Report partial source failures instead of degrading silently"
```

---

## Task 9: Gate the energy counter behind an env var

**Files:**
- Modify: `src/energy.ts`
- Test: `test/unit/energy.test.ts`

**Context:** The Wh figure is a fabricated estimate that increments before the calling agent judges relevance. It stays available but is off by default.

- [ ] **Step 1: Write the failing test**

Create `test/unit/energy.test.ts`:

```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { maybeEnergyLine, formatEnergyLine } from "../../dist/energy.js";

test("maybeEnergyLine returns an empty string when the env var is unset", () => {
  delete process.env.REUSE_BEFORE_GENERATE_SHOW_ENERGY;
  assert.equal(maybeEnergyLine(), "");
});

test("maybeEnergyLine returns a line when the env var is set to 1", () => {
  process.env.REUSE_BEFORE_GENERATE_SHOW_ENERGY = "1";
  const out = maybeEnergyLine();
  delete process.env.REUSE_BEFORE_GENERATE_SHOW_ENERGY;
  assert.match(out, /Wh/);
  assert.match(out, /Estimate only/);
});

test("formatEnergyLine pluralizes correctly for one check", () => {
  const out = formatEnergyLine({ totalWhSaved: 250, rebuildsAvoided: 1, thisEventWh: 250 });
  assert.match(out, /1 check\b/);
  assert.doesNotMatch(out, /1 checks/);
});

test("formatEnergyLine pluralizes correctly for multiple checks", () => {
  const out = formatEnergyLine({ totalWhSaved: 500, rebuildsAvoided: 2, thisEventWh: 250 });
  assert.match(out, /2 checks/);
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm run build && node --test test/unit/energy.test.ts`
Expected: FAIL — `maybeEnergyLine` is not exported.

- [ ] **Step 3: Add the gate**

Append to `src/energy.ts`:

```ts
/** Returns the energy line only when explicitly enabled.
 *
 * Off by default: the per-rebuild Wh figure is an order-of-magnitude
 * estimate presented as a specific number, and it increments as soon as a
 * maintained candidate is found — before the calling agent has judged
 * whether that candidate is actually relevant. Shipping it in the default
 * output invites a reader to dismiss the whole result on the weakest claim
 * in it. The tally still accrues locally; only the display is gated. */
export function maybeEnergyLine(): string {
  if (process.env.REUSE_BEFORE_GENERATE_SHOW_ENERGY !== "1") return "";
  const stats = recordPotentialSavings();
  return `\n\n---\n${formatEnergyLine(stats)}`;
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm run build && node --test test/unit/energy.test.ts`
Expected: PASS — 4 tests.

- [ ] **Step 5: Remove the unconditional call from the handler**

In `src/index.ts`, replace the energy import:

```ts
import { maybeEnergyLine } from "./energy.js";
```

Confirm no `recordPotentialSavings` or `formatEnergyLine` call remains in `src/index.ts` — Task 8's handler body already uses `maybeEnergyLine()`.

- [ ] **Step 6: Commit**

```bash
git add src/energy.ts src/index.ts test/unit/energy.test.ts
git commit -m "Gate energy estimate behind REUSE_BEFORE_GENERATE_SHOW_ENERGY"
```

---

## Task 10: Keep telemetry off the hot path

**Files:**
- Modify: `src/telemetry.ts:25-39`, `src/telemetry.ts:78-87`
- Test: `test/unit/telemetry.test.ts`

- [ ] **Step 1: Write the failing test**

Create `test/unit/telemetry.test.ts`:

```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { getInstallId, buildEnvelope } from "../../dist/telemetry.js";

test("getInstallId returns the same id across calls (cached, not re-read)", () => {
  const a = getInstallId();
  const b = getInstallId();
  assert.equal(a, b);
  assert.ok(a.length > 0);
});

test("buildEnvelope carries the event, an install id, and an ISO timestamp", () => {
  const env = buildEnvelope({ type: "tool_invoked" });
  assert.equal(env.event.type, "tool_invoked");
  assert.ok(env.installId.length > 0);
  assert.ok(!Number.isNaN(Date.parse(env.timestamp)));
});

test("buildEnvelope carries no query content for a candidates_found event", () => {
  const env = buildEnvelope({ type: "candidates_found", count: 5, maintainedCount: 2 });
  const serialized = JSON.stringify(env);
  assert.doesNotMatch(serialized, /description|keyword|query/i);
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm run build && node --test test/unit/telemetry.test.ts`
Expected: FAIL — `getInstallId` and `buildEnvelope` are not exported.

- [ ] **Step 3: Cache the id and export the envelope builder**

In `src/telemetry.ts`, replace `getInstallId` with a cached, exported version:

```ts
let cachedInstallId: string | null = null;

/** Reads the persisted install id once per process. Previously this hit the
 * filesystem on every single event, which is pure overhead on a path that
 * should cost nothing. */
export function getInstallId(): string {
  if (cachedInstallId !== null) return cachedInstallId;
  try {
    mkdirSync(STATE_DIR, { recursive: true });
    if (existsSync(ID_FILE)) {
      cachedInstallId = readFileSync(ID_FILE, "utf-8").trim();
      return cachedInstallId;
    }
    const id = randomUUID();
    writeFileSync(ID_FILE, id, "utf-8");
    cachedInstallId = id;
    return id;
  } catch {
    // If we cannot persist an id, fall back to a per-process one rather than
    // failing the tool call over telemetry.
    cachedInstallId = "unpersisted-" + randomUUID();
    return cachedInstallId;
  }
}

export function buildEnvelope(event: TelemetryEvent): EventEnvelope {
  return {
    installId: getInstallId(),
    event,
    timestamp: new Date().toISOString(),
  };
}
```

Export the envelope interface so the test can reference the shape:

```ts
export interface EventEnvelope {
  installId: string;
  event: TelemetryEvent;
  timestamp: string;
}
```

Replace `track` so callers need not await it:

```ts
/** Fire-and-forget. Telemetry must never add latency to a tool call, so this
 * returns void and swallows its own failures rather than returning a promise
 * callers are tempted to await. */
export function track(event: TelemetryEvent): void {
  if (process.env.REUSE_BEFORE_GENERATE_TELEMETRY_DISABLED === "1") return;
  const envelope = buildEnvelope(event);
  logLocally(envelope);
  void postToEndpoint(envelope).catch(() => {
    // postToEndpoint already logs; this catch exists so an unhandled
    // rejection cannot take down the process.
  });
}
```

- [ ] **Step 4: Run the full suite to verify it passes**

Run: `npm test`
Expected: PASS — all unit tests. `src/index.ts` must now call `track(...)` without `await`; if the build errors on an unused `await`, remove the `await` keywords as described in Task 8.

- [ ] **Step 5: Commit**

```bash
git add src/telemetry.ts src/index.ts test/unit/telemetry.test.ts
git commit -m "Cache install id and make telemetry fire-and-forget"
```

---

## Task 11: Local CLI

**Files:**
- Create: `src/cli.ts`
- Modify: `package.json` (scripts)

**Context:** The highest-leverage item in the plan. Without this, iterating on search quality requires an agent session per attempt.

- [ ] **Step 1: Write the CLI**

Create `src/cli.ts`:

```ts
#!/usr/bin/env node
// Local driver for the search pipeline. Exists so search quality can be
// iterated directly ("does this keyword set surface the tool I know is out
// there?") without registering the MCP server and spending an agent turn on
// every attempt.
//
// Usage:
//   npm run check -- "a tool that formats python code" --keywords black,formatter,style

import { searchAllResults } from "./search.js";
import { verifyAll } from "./verify.js";

function parseArgs(argv: string[]): { description: string; keywords?: string[] } {
  const args = argv.slice(2);
  const kwIndex = args.findIndex((a) => a === "--keywords" || a === "-k");
  if (kwIndex === -1) {
    return { description: args.join(" ").trim() };
  }
  const description = args.slice(0, kwIndex).join(" ").trim();
  const keywords = (args[kwIndex + 1] ?? "")
    .split(",")
    .map((k) => k.trim())
    .filter(Boolean);
  return { description, keywords: keywords.length > 0 ? keywords : undefined };
}

async function main(): Promise<void> {
  const { description, keywords } = parseArgs(process.argv);

  if (!description) {
    console.error('Usage: npm run check -- "<description>" [--keywords a,b,c]');
    process.exit(2);
  }

  console.log(`description: ${description}`);
  console.log(`keywords:    ${keywords ? keywords.join(", ") : "(auto-extracted)"}\n`);

  const results = await searchAllResults(description, keywords);

  for (const r of results) {
    if (r.ok) {
      console.log(`  ${r.source}: ${r.value.length} candidate(s)`);
    } else {
      console.log(`  ${r.source}: FAILED — ${r.reason}`);
    }
  }
  console.log();

  const raw = results.flatMap((r) => (r.ok ? r.value : []));
  const verified = await verifyAll(raw);
  const maintained = verified.filter((c) => c.maintained);

  console.log(`${raw.length} raw, ${maintained.length} maintained\n`);

  maintained.forEach((c, i) => {
    const stars = c.source === "github" ? `${c.stars ?? 0}*` : "-";
    const rank = String(i + 1).padStart(2, " ");
    console.log(`${rank}. [${c.source}] ${c.id}  ${stars}`);
    console.log(`    ${c.description.slice(0, 100)}`);
    console.log(`    ${c.maintenanceReason}`);
  });

  if (maintained.length === 0) {
    console.log("(no maintained candidates)");
  }
}

main().catch((err) => {
  console.error("cli failed:", (err as Error).message);
  process.exit(1);
});
```

- [ ] **Step 2: Add the script**

In `package.json`, add to `"scripts"`:

```json
"check": "npm run build && node dist/cli.js"
```

- [ ] **Step 3: Run it against a description with a known real match**

Run: `npm run check -- "a command-line tool that formats python source code" --keywords black,formatter,python`
Expected: prints per-source counts, then a ranked list of maintained candidates including `psf/black` or `astral-sh/ruff`.

- [ ] **Step 4: Run it with a deliberately broken source to confirm partial failure is visible**

Run: `GITHUB_TOKEN=invalid npm run check -- "a command-line tool that formats python source code" --keywords black,formatter,python`
Expected: the `github` line reports FAILED with an HTTP status, `npm` still reports its count, and the process exits 0 rather than crashing.

- [ ] **Step 5: Commit**

```bash
git add src/cli.ts package.json
git commit -m "Add local CLI for iterating on search quality"
```

---

## Task 12: Extract eval cases

**Files:**
- Create: `test/eval/cases.mjs`
- Delete: `test/fixtures.mjs`

**Context:** The seven existing cases are kept verbatim, including their comments — they encode real findings. Structure changes: each case gains an `id` and an optional `variants` array for Task 14's sensitivity harness.

- [ ] **Step 1: Create the cases module**

Create `test/eval/cases.mjs` containing all seven existing cases from `test/fixtures.mjs` with their original comments preserved, restructured as below. Copy the `description`, `keywords`, and `expectAnyOf` values from `test/fixtures.mjs` exactly — do not paraphrase them.

```js
// Recall corpus. Each case is a description with at least one known-real
// existing tool that a good search ought to surface.
//
// `variants` holds alternative keyword sets for the same description. The
// README records that swapping one reasonable synonym ("capture" vs
// "chrome") flipped a result from found to missed; variants turn that
// anecdote into a measured number rather than a remembered anecdote.

export const cases = [
  {
    id: "python-formatter",
    description:
      "A command-line tool that formats Python source code automatically to a consistent style.",
    expectAnyOf: ["black", "ruff", "psf/black", "astral-sh/ruff", "yapf"],
    variants: [
      ["python", "formatter", "code"],
      ["python", "format", "style"],
    ],
  },
  {
    id: "changelog-generator",
    description:
      "A command-line tool that generates and updates a changelog file by parsing conventional commit messages from git history, grouping them by type and version tag.",
    expectAnyOf: ["git-cliff", "auto-changelog", "standard-version", "conventional-changelog"],
    variants: [
      ["changelog", "conventional", "commits"],
      ["changelog", "generator", "git"],
    ],
  },
  {
    id: "secret-scanner",
    description:
      "A tool that detects secrets and API keys accidentally committed to a git repository.",
    expectAnyOf: ["gitleaks", "trufflehog", "detect-secrets", "git-secrets"],
    variants: [
      ["git", "secrets", "detect", "leak"],
      ["secret", "scanner", "detect", "git"],
    ],
  },
  {
    id: "actions-debugger",
    // Regression guard for a real gap found via a live self-test: this
    // matches a genuine niche tool (ruzmuh/actl, 0 stars, pushed the same
    // week) that the old star-based verify.ts filter silently discarded,
    // and that GitHub's default search ranking buries against high-star
    // noise unless the low-star search lane in searchGitHub() catches it.
    // Note: two OTHER known-real matches for this description
    // (Socialpranker/actdbg, aradar46/fermata) still don't reliably
    // surface — GitHub's search index for very small/oddly-named repos is
    // a harder, only partially-solved problem. This case intentionally
    // accepts partial recall rather than requiring all three.
    description:
      "A debugger for GitHub Actions. Pause a failing workflow at the point of failure, get an interactive shell inside the running runner, inspect state, fix the issue, and re-run just the broken step instead of the whole pipeline.",
    expectAnyOf: ["actl", "action-tmate", "upterm", "actdbg", "fermata"],
    variants: [["debugger", "actions", "workflow"]],
  },
  {
    id: "json-viewer",
    // Regression guard: verb-based keywords ("pretty-print", "colorize")
    // matching the USER's framing of the problem failed to surface any
    // real match. The dominant real tool describes itself by function
    // ("Terminal JSON viewer & processor"), not by the action the user
    // asked for — "viewer" is the word that actually works.
    description:
      "A command-line tool that pretty-prints and colorizes JSON files for terminal viewing.",
    expectAnyOf: ["fx", "jless", "gron", "jq", "jnv"],
    variants: [
      ["json", "viewer", "terminal"],
      ["json", "pretty-print", "colorize"],
    ],
  },
  {
    id: "postgres-mcp",
    description:
      "An MCP server that lets an AI coding agent run read-only SQL queries against a Postgres database.",
    expectAnyOf: ["postgres-mcp"],
    variants: [["postgres", "mcp", "database", "query"]],
  },
  {
    id: "html-proofer",
    // Regression guard: same lesson as the JSON-viewer case from the other
    // direction — "static site"/"alt-text" (the user's framing) never
    // surfaced the dominant tool, which describes itself as validating
    // "rendered HTML files," not static sites or alt text specifically.
    description:
      "A CLI tool for static site generators that checks for dead image links and missing alt text before deploy.",
    expectAnyOf: ["html-proofer", "broken-link-checker", "linkinator"],
    variants: [
      ["html", "proofer", "validate", "link"],
      ["static", "site", "alt-text", "links"],
    ],
  },
];
```

- [ ] **Step 2: Delete the old fixture file**

```bash
git rm test/fixtures.mjs
```

- [ ] **Step 3: Verify the module loads**

Run: `node -e "import('./test/eval/cases.mjs').then(m => console.log(m.cases.length + ' cases, ids: ' + m.cases.map(c => c.id).join(', ')))"`
Expected: `7 cases, ids: python-formatter, changelog-generator, secret-scanner, actions-debugger, json-viewer, postgres-mcp, html-proofer`

- [ ] **Step 4: Commit**

```bash
git add test/eval/cases.mjs
git commit -m "Extract eval cases into their own module"
```

---

## Task 13: Scored eval runner

**Files:**
- Create: `test/eval/run.mjs`
- Modify: `package.json` (scripts)

**Context:** Replaces pass/fail with rank-based scoring. Pass/fail cannot tell you that a change moved the right answer from rank 14 to rank 3, which is the only signal that matters when tuning queries.

- [ ] **Step 1: Write the runner**

Create `test/eval/run.mjs`:

```js
// Scored recall eval. Hits live GitHub/npm/PyPI — deliberately NOT part of
// `npm test`, because upstream ranking drifts independently of this
// codebase and a flaky signal that blocks merges gets ignored, then
// disabled, then deleted.
//
// Run with: npm run eval
// Compare against the committed baseline: npm run eval -- --diff

import { searchAllResults } from "../../dist/search.js";
import { verifyAll } from "../../dist/verify.js";
import { cases } from "./cases.mjs";
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const BASELINE = join(HERE, "baseline.json");

// GitHub's unauthenticated search endpoint has both a low primary limit
// (10/min) and a separate burst throttle. Each case issues 2 GitHub
// requests, so cases must be spaced.
const SLEEP_MS = Number(process.env.EVAL_SLEEP_MS ?? 4000);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function matches(candidateId, expectAnyOf) {
  const lower = candidateId.toLowerCase();
  return expectAnyOf.some((needle) => lower.includes(needle.toLowerCase()));
}

/** Rank of the first matching candidate (1-based), or null for a miss. */
function rankOfFirstMatch(candidates, expectAnyOf) {
  const idx = candidates.findIndex((c) => matches(c.id, expectAnyOf));
  return idx === -1 ? null : idx + 1;
}

async function runVariant(description, keywords) {
  const results = await searchAllResults(description, keywords);
  const failures = results.filter((r) => !r.ok).map((r) => `${r.source}:${r.reason}`);
  const raw = results.flatMap((r) => (r.ok ? r.value : []));
  const verified = await verifyAll(raw);
  const maintained = verified.filter((c) => c.maintained);
  return { maintained, failures };
}

async function main() {
  const wantDiff = process.argv.includes("--diff");
  const rows = [];

  for (const [i, c] of cases.entries()) {
    const variants = c.variants ?? [undefined];
    const variantRanks = [];

    for (const [vi, keywords] of variants.entries()) {
      if (i > 0 || vi > 0) await sleep(SLEEP_MS);
      const { maintained, failures } = await runVariant(c.description, keywords);
      const rank = rankOfFirstMatch(maintained, c.expectAnyOf);
      variantRanks.push({
        keywords: keywords ? keywords.join(",") : "(auto)",
        rank,
        pool: maintained.length,
        failures,
      });
    }

    // The headline rank for a case is its best variant: the tool description
    // instructs the calling agent to pick good keywords, so the best
    // achievable result is the honest measure of whether the target is
    // reachable at all. Variant spread is reported separately as fragility.
    const ranked = variantRanks.filter((v) => v.rank !== null).map((v) => v.rank);
    const best = ranked.length > 0 ? Math.min(...ranked) : null;
    const hitRate = variantRanks.length > 0 ? ranked.length / variantRanks.length : 0;

    rows.push({ id: c.id, best, hitRate, variants: variantRanks });
  }

  const found = rows.filter((r) => r.best !== null);
  const recallAt = (k) => rows.filter((r) => r.best !== null && r.best <= k).length / rows.length;
  const mrr = rows.reduce((acc, r) => acc + (r.best ? 1 / r.best : 0), 0) / rows.length;

  const summary = {
    generatedAt: new Date().toISOString(),
    cases: rows.length,
    recallAt5: Number(recallAt(5).toFixed(3)),
    recallAt10: Number(recallAt(10).toFixed(3)),
    recallAtAll: Number((found.length / rows.length).toFixed(3)),
    mrr: Number(mrr.toFixed(3)),
    perCase: Object.fromEntries(rows.map((r) => [r.id, r.best])),
  };

  console.log("\n=== per case ===");
  for (const r of rows) {
    const label = r.best === null ? "MISS" : `rank ${r.best}`;
    console.log(`${r.id.padEnd(22)} ${label.padEnd(10)} variant hit-rate ${(r.hitRate * 100).toFixed(0)}%`);
    for (const v of r.variants) {
      const vr = v.rank === null ? "MISS" : `#${v.rank}`;
      console.log(`    ${vr.padEnd(6)} pool=${String(v.pool).padEnd(4)} kw=${v.keywords}`);
      if (v.failures.length > 0) console.log(`           source failures: ${v.failures.join("; ")}`);
    }
  }

  console.log("\n=== summary ===");
  console.log(`recall@5    ${summary.recallAt5}`);
  console.log(`recall@10   ${summary.recallAt10}`);
  console.log(`recall@all  ${summary.recallAtAll}`);
  console.log(`MRR         ${summary.mrr}`);

  if (wantDiff && existsSync(BASELINE)) {
    const prev = JSON.parse(readFileSync(BASELINE, "utf-8"));
    console.log("\n=== diff vs baseline ===");
    for (const k of ["recallAt5", "recallAt10", "recallAtAll", "mrr"]) {
      const delta = summary[k] - prev[k];
      const sign = delta > 0 ? "+" : "";
      console.log(`${k.padEnd(12)} ${prev[k]} -> ${summary[k]} (${sign}${delta.toFixed(3)})`);
    }
    for (const r of rows) {
      const before = prev.perCase?.[r.id] ?? null;
      if (before !== r.best) {
        console.log(`  ${r.id}: ${before ?? "MISS"} -> ${r.best ?? "MISS"}`);
      }
    }
  }

  if (process.argv.includes("--save")) {
    writeFileSync(BASELINE, JSON.stringify(summary, null, 2) + "\n", "utf-8");
    console.log(`\nbaseline written to ${BASELINE}`);
  }
}

main().catch((err) => {
  console.error("eval failed:", err);
  process.exit(1);
});
```

- [ ] **Step 2: Add the script**

In `package.json`, add to `"scripts"`:

```json
"eval": "npm run build && node test/eval/run.mjs"
```

- [ ] **Step 3: Run the eval and record the baseline**

Run: `npm run eval -- --save`
Expected: per-case ranks, a summary block, and `baseline written to .../baseline.json`. Some cases may MISS — that is the current true state and is exactly what the baseline is for. Do not tune anything yet.

- [ ] **Step 4: Confirm the diff path works**

Run: `npm run eval -- --diff`
Expected: a `diff vs baseline` block. Numbers may move slightly between runs because upstream ranking is not deterministic; that variance is itself useful to observe.

- [ ] **Step 5: Commit**

```bash
git add test/eval/run.mjs test/eval/baseline.json package.json
git commit -m "Add scored recall eval with rank, recall@k, and MRR"
```

---

## Task 14: Expand the eval corpus

**Files:**
- Modify: `test/eval/cases.mjs`

**Context:** Seven cases means one flip moves recall by 14 points. Adding five brings it to twelve, where a single case is ~8 points.

- [ ] **Step 1: Append the new cases**

Add these to the `cases` array in `test/eval/cases.mjs`:

```js
  {
    id: "no-real-competitor",
    // True-negative guard: this describes something deliberately absurd and
    // specific enough that no real tool should match. The entire
    // "clear to build" path is otherwise untested — a search that returns
    // plausible-looking matches for everything is as broken as one that
    // returns nothing, and only this kind of case can catch it.
    description:
      "A command-line tool that converts recipes for Hungarian pastry into MIDI files whose note durations encode the baking times.",
    expectAnyOf: [],
    expectNoMatch: true,
    variants: [["recipe", "midi", "baking"]],
  },
  {
    id: "vague-phrasing",
    // Non-native / roundabout phrasing. The tool's premise is that the
    // calling agent supplies good keywords even when the user's own words
    // are imprecise, so the corpus needs at least one case where they are.
    description:
      "the thing that check my code is clean automatic before i push, catch mistake early",
    expectAnyOf: ["husky", "pre-commit", "lint-staged", "lefthook"],
    variants: [
      ["git", "hooks", "pre-commit"],
      ["lint", "staged", "commit"],
    ],
  },
  {
    id: "npm-dominant",
    // The dominant answer here is an npm package rather than a GitHub repo,
    // exercising the npm lane as the primary source rather than a supplement.
    description:
      "A JavaScript library for parsing command-line arguments into an options object, with support for aliases and defaults.",
    expectAnyOf: ["yargs", "commander", "minimist", "meow", "arg"],
    variants: [
      ["cli", "arguments", "parser"],
      ["command-line", "options", "parse"],
    ],
  },
  {
    id: "python-dominant",
    // Python-dominant target. PyPI name-guessing alone is unlikely to reach
    // it, so this case measures whether the GitHub language:python lane
    // (Task 16) actually earns its request.
    description:
      "A Python library for making HTTP requests with a simple API, handling sessions, redirects and JSON decoding.",
    expectAnyOf: ["requests", "httpx", "aiohttp", "urllib3"],
    variants: [
      ["python", "http", "requests"],
      ["http", "client", "session"],
    ],
  },
  {
    id: "low-star-niche",
    // Second low-star regression guard alongside actions-debugger. Niche
    // enough that the winners have modest star counts, so it detects any
    // change that quietly reintroduces popularity bias into the funnel.
    description:
      "A terminal tool that shows which process is listening on a given TCP port and lets you kill it interactively.",
    expectAnyOf: ["killport", "fkill", "port-killer", "lsof"],
    variants: [
      ["port", "kill", "process"],
      ["tcp", "listening", "terminal"],
    ],
  },
```

- [ ] **Step 2: Handle the true-negative case in the runner**

In `test/eval/run.mjs`, inside the per-case loop, replace the `rows.push(...)` line with:

```js
    if (c.expectNoMatch) {
      // Inverted scoring: for a true-negative case, a MISS is the correct
      // outcome. Recorded separately so it cannot inflate or deflate recall,
      // which only means something for cases that have a real target.
      const falsePositives = variantRanks.filter((v) => v.rank !== null).length;
      rows.push({ id: c.id, best: null, hitRate: 0, variants: variantRanks, trueNegative: true, falsePositives });
      continue;
    }

    rows.push({ id: c.id, best, hitRate, variants: variantRanks });
```

Then exclude true-negative cases from the recall math, replacing the three summary lines:

```js
  const scored = rows.filter((r) => !r.trueNegative);
  const found = scored.filter((r) => r.best !== null);
  const recallAt = (k) => scored.filter((r) => r.best !== null && r.best <= k).length / scored.length;
  const mrr = scored.reduce((acc, r) => acc + (r.best ? 1 / r.best : 0), 0) / scored.length;
```

And update the summary object's `cases` field plus add the true-negative tally:

```js
    cases: scored.length,
    trueNegativeFalsePositives: rows
      .filter((r) => r.trueNegative)
      .reduce((acc, r) => acc + r.falsePositives, 0),
```

Add a line to the printed summary:

```js
  console.log(`false positives on true-negative cases: ${summary.trueNegativeFalsePositives}`);
```

- [ ] **Step 3: Run the expanded eval**

Run: `npm run eval`
Expected: 12 rows printed (11 scored plus the true-negative case), with a `false positives on true-negative cases` count. This run takes roughly 2-3 minutes because of the rate-limit spacing.

- [ ] **Step 4: Re-baseline**

Run: `npm run eval -- --save`
Expected: baseline.json rewritten with 11 scored cases.

- [ ] **Step 5: Commit**

```bash
git add test/eval/cases.mjs test/eval/run.mjs test/eval/baseline.json
git commit -m "Expand eval corpus to 12 cases including a true-negative guard"
```

---

## Task 15: Measured query experiments

**Files:**
- Modify: `src/search.ts` (one experiment at a time)
- Create: `docs/findings.md`

**Context:** With Task 13's scoring in place these become empirical. Each experiment is a one-line change, measured, then kept or reverted. A null result is a real finding.

- [ ] **Step 1: Create the findings document with the current baseline**

Create `docs/findings.md`:

```markdown
# Search quality findings

Measured with `npm run eval`. Numbers come from live GitHub/npm/PyPI, so
they move a little between runs; treat differences under ~0.05 as noise
unless a specific case changed rank.

## Baseline

Recorded at the start of the query-experiment work. See
`test/eval/baseline.json` for the machine-readable version.

## Experiments

| # | Change | recall@10 | MRR | Kept? |
|---|--------|-----------|-----|-------|
```

Fill the baseline numbers in from the current `test/eval/baseline.json`.

- [ ] **Step 2: Experiment A — drop the `in:` qualifier from the primary lane**

In `src/search.ts`, in `searchGitHubResult`, change:

```ts
  const baseQuery = `${keywords} in:name,description,readme`;
```

to:

```ts
  const baseQuery = keywords;
```

Run: `npm run eval -- --diff`
Record recall@10 and MRR in the findings table. **Keep only if recall@10 improves by more than 0.05**; otherwise revert with `git checkout src/search.ts`.

- [ ] **Step 3: Experiment B — widen the low-star lane**

In `src/search.ts`, change:

```ts
  const lowStarQuery = `${keywords} stars:0..3`;
```

to:

```ts
  const lowStarQuery = `${keywords} stars:0..10`;
```

Run: `npm run eval -- --diff`
Record the numbers. Pay particular attention to the `actions-debugger` and `low-star-niche` cases — this experiment targets them specifically. Keep or revert on the same rule.

- [ ] **Step 4: Experiment C — narrower paired queries**

In `src/search.ts`, in `searchGitHubResult`, replace the two-lane `Promise.all` with a three-lane version that adds a query using only the first two keywords:

```ts
    const narrowQuery = keywordList.slice(0, 2).join(" ");
    const [primary, lowStar, narrow] = await Promise.all([
      fetchGitHubSearch(baseQuery, limit),
      fetchGitHubSearch(lowStarQuery, Math.min(limit, 10)),
      fetchGitHubSearch(narrowQuery, Math.min(limit, 10)),
    ]);
```

and include `...narrow` in the merge loop's array.

Run: `npm run eval -- --diff`
Note this adds a third GitHub request per call, tripling rate-limit pressure. **Keep only if recall@10 improves by more than 0.10** — the higher bar reflects the extra request cost.

- [ ] **Step 5: Re-baseline with whichever experiments were kept, and commit**

Run: `npm run eval -- --save`

```bash
git add src/search.ts docs/findings.md test/eval/baseline.json
git commit -m "Run measured query experiments and record findings"
```

---

## Task 16: GitHub language:python lane for PyPI coverage

**Files:**
- Modify: `src/search.ts` (`searchPyPIResult`)
- Test: `test/unit/pypi-lane.test.ts`

**Context:** Verified 2026-07-22: PyPI has no JSON search API (`?format=json` returns `text/html`). A GitHub query with `language:python` was verified to return a small enough result set that 0-star repos surface naturally — 12 total results for one test query, three of them under 5 stars. That is a better Python lane than name-guessing alone, and it needs no HTML scraping.

- [ ] **Step 1: Write the failing test**

Create `test/unit/pypi-lane.test.ts`:

```ts
import { test, afterEach } from "node:test";
import assert from "node:assert/strict";
import { searchPythonRepos } from "../../dist/search.js";
import { setFetcher, resetFetcher } from "../../dist/http.js";

afterEach(() => resetFetcher());

test("searchPythonRepos issues a language:python scoped query", async () => {
  let seenUrl = "";
  setFetcher(async (url) => {
    seenUrl = url;
    return new Response(JSON.stringify({ items: [] }), { status: 200 });
  });

  await searchPythonRepos(["http", "client"]);

  assert.match(decodeURIComponent(seenUrl), /language:python/);
  assert.match(decodeURIComponent(seenUrl), /http client/);
});

test("searchPythonRepos returns candidates tagged as github source", async () => {
  setFetcher(async () =>
    new Response(
      JSON.stringify({
        items: [
          {
            full_name: "psf/requests",
            html_url: "https://github.com/psf/requests",
            description: "A simple HTTP library",
            stargazers_count: 52000,
            pushed_at: "2026-07-01T00:00:00Z",
            archived: false,
          },
        ],
      }),
      { status: 200 },
    ),
  );

  const out = await searchPythonRepos(["http", "client"]);

  assert.equal(out.length, 1);
  assert.equal(out[0].source, "github");
  assert.equal(out[0].id, "psf/requests");
});

test("searchPythonRepos returns an empty array when keywords are empty", async () => {
  let calls = 0;
  setFetcher(async () => {
    calls += 1;
    return new Response(JSON.stringify({ items: [] }), { status: 200 });
  });

  const out = await searchPythonRepos([]);

  assert.equal(calls, 0);
  assert.deepEqual(out, []);
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm run build && node --test test/unit/pypi-lane.test.ts`
Expected: FAIL — `searchPythonRepos` is not exported.

- [ ] **Step 3: Implement the lane**

Add to `src/search.ts`:

```ts
/** Python discovery via GitHub rather than PyPI.
 *
 * PyPI has no general search API — the XML-RPC one was retired and
 * https://pypi.org/search/?q=...&format=json still returns HTML (verified
 * 2026-07-22), so the only "search" available there is guessing package
 * names. Nearly every Python tool worth surfacing has a GitHub repository,
 * and `language:python` narrows the result pool enough that small repos
 * surface on their own merits instead of being buried by unrelated
 * high-star noise. Cheaper and more robust than scraping HTML. */
export async function searchPythonRepos(
  keywords: string[],
  limit = 10,
): Promise<RawCandidate[]> {
  if (keywords.length === 0) return [];
  try {
    const items = await fetchGitHubSearch(`${keywords.join(" ")} language:python`, limit);
    return items.map(toCandidate);
  } catch (e) {
    console.error(`[search] python lane failed: ${(e as Error).message}`);
    return [];
  }
}
```

Then extend `searchPyPIResult` to merge both, replacing its final `return`:

```ts
  const pythonRepos = await searchPythonRepos(keywords);
  const seen = new Set(results.map((r) => r.id));
  for (const repo of pythonRepos) {
    if (seen.has(repo.id)) continue;
    seen.add(repo.id);
    results.push(repo);
  }
  return ok("pypi", results.slice(0, limit));
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm test`
Expected: PASS — all unit tests including the three new ones.

- [ ] **Step 5: Measure the effect on the corpus**

Run: `npm run eval -- --diff`
Expected: the `python-dominant` case should improve. If recall@10 does not improve at all, record that in `docs/findings.md` and revert — a lane that costs a GitHub request per call must earn it.

- [ ] **Step 6: Re-baseline and commit**

Run: `npm run eval -- --save`

```bash
git add src/search.ts test/unit/pypi-lane.test.ts test/eval/baseline.json docs/findings.md
git commit -m "Add GitHub language:python lane for Python package discovery"
```

---

## Task 17: License

**Files:**
- Create: `LICENSE`
- Modify: `package.json`

- [ ] **Step 1: Write the license**

Create `LICENSE` with the standard MIT license text, `Copyright (c) 2026 Mr. A`.

- [ ] **Step 2: Declare it in package.json**

Add to `package.json`:

```json
"license": "MIT"
```

- [ ] **Step 3: Verify npm recognizes it**

Run: `npm pkg get license`
Expected: `"MIT"`

- [ ] **Step 4: Commit**

```bash
git add LICENSE package.json
git commit -m "Add MIT license"
```

---

## Task 18: Packaging metadata

**Files:**
- Modify: `package.json`

- [ ] **Step 1: Add the metadata**

Add to `package.json`, replacing `<owner>` with the actual GitHub owner once the repo has a remote:

```json
"keywords": ["mcp", "model-context-protocol", "code-reuse", "search", "github", "npm", "pypi"],
"repository": { "type": "git", "url": "git+https://github.com/<owner>/reuse-before-generate.git" },
"bugs": { "url": "https://github.com/<owner>/reuse-before-generate/issues" },
"homepage": "https://github.com/<owner>/reuse-before-generate#readme"
```

Add to `"scripts"`:

```json
"prepublishOnly": "npm run build && npm test"
```

- [ ] **Step 2: Verify the published payload**

Run: `npm pack --dry-run`
Expected: the file list contains `dist/`, `README.md`, and `LICENSE`, and does **not** contain `src/`, `test/`, or `docs/`. If `LICENSE` is missing, add it to the `"files"` array.

- [ ] **Step 3: Verify the binary resolves**

Run: `node dist/index.js < /dev/null`
Expected: prints `reuse-before-generate MCP server running on stdio` to stderr, then exits when stdin closes.

- [ ] **Step 4: Commit**

```bash
git add package.json
git commit -m "Add npm packaging metadata and prepublish checks"
```

---

## Task 19: CI

**Files:**
- Create: `.github/workflows/ci.yml`

**Context:** Unit tests gate merges. The eval does not — it depends on GitHub's ranking, which drifts independently of this codebase, and a flaky merge gate gets ignored then disabled then deleted.

- [ ] **Step 1: Write the workflow**

Create `.github/workflows/ci.yml`:

```yaml
name: CI

on:
  push:
    branches: [master]
  pull_request:
  schedule:
    # Weekly recall check. Upstream ranking drifts on its own, so this
    # surfaces regressions that no code change caused.
    - cron: "0 6 * * 1"
  workflow_dispatch:

jobs:
  test:
    name: Build and unit tests
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: "22"
          cache: npm
      - run: npm ci
      - run: npm run build
      - run: npm test

  eval:
    name: Recall eval (live network)
    # Never on pull_request: this hits live GitHub search, whose ranking
    # changes for reasons unrelated to this repository.
    if: github.event_name == 'schedule' || github.event_name == 'workflow_dispatch'
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: "22"
          cache: npm
      - run: npm ci
      - run: npm run build
      - run: node test/eval/run.mjs --diff
        env:
          # Raises the search rate limit from 10/min to 30/min.
          GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
```

- [ ] **Step 2: Verify the workflow parses**

Run: `node -e "const fs=require('fs');const s=fs.readFileSync('.github/workflows/ci.yml','utf8');if(!s.includes('npm test'))throw new Error('missing test step');console.log('workflow file present, '+s.split('\n').length+' lines')"`
Expected: prints the line count without error.

- [ ] **Step 3: Confirm the pinned Node version runs the suite**

The workflow pins Node 22 while local development is on Node 25. Confirm the suite passes on the CI version before relying on it — `node --test` and `AbortSignal.timeout` are both available in Node 22, but verify rather than assume.

Run: `npm test`
Expected: PASS locally. If a CI run later fails on Node 22 specifically, raise the pin to 24.

- [ ] **Step 4: Commit**

```bash
git add .github/workflows/ci.yml
git commit -m "Add CI: unit tests on push/PR, recall eval weekly"
```

---

## Task 20: README restructure

**Files:**
- Modify: `README.md`
- Modify: `docs/findings.md`

**Context:** The current README is excellent engineering notes and a poor install page. The analysis is valuable; it just is not what a reader needs in the first thirty seconds.

- [ ] **Step 1: Move the analysis into findings**

Move the entire "Known v0 gaps" section from `README.md` into `docs/findings.md` under a new heading `## Known gaps`, preserving every word. Do not summarize it — the detail is the value.

While moving, correct one item that Task 9 changed: the "Energy-savings count fires early" entry now needs a note that the display is off by default behind `REUSE_BEFORE_GENERATE_SHOW_ENERGY=1`.

Also correct the stale claim in the README's "How it works" step 2, which still says verify filters "anything with under 10 stars" — the star gate was already removed.

- [ ] **Step 2: Restructure the README**

Reorder `README.md` to this section order, keeping the existing prose for each part:

1. Title and the one-paragraph description (existing, unchanged).
2. `## Install` — the `npm install && npm run build` block plus the MCP client registration block, moved up from the current "Setup" section.
3. `## Usage` — the "Testing it right now" content plus the `keywords` explanation.
4. `## How it works` — the existing four-step list, with the star-filter claim corrected.
5. `## Why` — the existing rationale, moved below the practical sections.
6. `## Configuration` — `GITHUB_TOKEN`, `REUSE_BEFORE_GENERATE_SHOW_ENERGY`, `REUSE_BEFORE_GENERATE_TELEMETRY_URL`, `REUSE_BEFORE_GENERATE_TELEMETRY_DISABLED`, each with one line of explanation.
7. `## Development` — `npm test`, `npm run check -- "<description>" --keywords a,b,c`, `npm run eval`.
8. `## Known gaps` — one paragraph plus a link to `docs/findings.md`.

- [ ] **Step 3: Verify every documented command actually works**

Run each command the README now claims, in order:

```bash
npm test
npm run check -- "a tool that formats python code" --keywords black,formatter,python
```

Expected: both succeed. Any command that does not work as documented is a README bug — fix the README or the code before committing.

- [ ] **Step 4: Commit**

```bash
git add README.md docs/findings.md
git commit -m "Restructure README install-first, move analysis to docs/findings.md"
```

---

## Task 21: Version bump and final verification

**Files:**
- Modify: `package.json`, `src/index.ts:22`

- [ ] **Step 1: Bump the version**

In `package.json` set `"version": "0.2.0"`, and in `src/index.ts` update the server constructor's `version: "0.2.0"` to match. The default tool output changed (the energy line is gone), which is a user-visible behavior change.

- [ ] **Step 2: Run the whole verification sequence**

```bash
npm run build
npm test
npm pack --dry-run
```

Expected: build clean, all unit tests pass, pack payload contains `dist/`, `README.md`, `LICENSE` and nothing from `src/`, `test/`, or `docs/`.

- [ ] **Step 3: Confirm the server starts and the tool is registered**

Run: `node dist/index.js < /dev/null`
Expected: `reuse-before-generate MCP server running on stdio` on stderr.

- [ ] **Step 4: Run the eval one final time to record the shipped state**

Run: `npm run eval -- --save`
Expected: a baseline reflecting all kept experiments. Record the final numbers in `docs/findings.md`.

- [ ] **Step 5: Commit**

```bash
git add package.json src/index.ts test/eval/baseline.json docs/findings.md
git commit -m "Bump to 0.2.0"
```

---

## Self-Review Notes

**Spec coverage.** Every spec item maps to a task: A1→2, A2→3, A3→1+7, A4→4,5,6,9,10, A5→11, A6→9, A7→10, B1→13, B2→14, B3→12+13 (variants), B4→16, B5→15, C1→17, C2→18, C3→19, C4→20, C5→21.

**Type consistency.** `Result<T>`/`ok`/`err`/`isOk` from Task 1 are used identically in Tasks 7, 8, 11, 13. `searchAllResults` returns `Result<RawCandidate[]>[]` everywhere it appears. `RawCandidate` and `VerifiedCandidate` keep their existing shapes throughout; `verifyCandidate` still returns `daysSinceLastActivity: number | null` after Task 6's refactor.

**Known ordering constraint.** Task 8 edits `src/index.ts` in a way that depends on `maybeEnergyLine` (Task 9) and the void-returning `track` (Task 10). The task notes this explicitly. Execute 8, 9, 10 as a group before running a full build.

**Deliberate omission.** The spec's testing section mentions HTTP cassettes for pipeline tests. Tasks 7 and 16 achieve the same coverage with inline stub responses via `setFetcher`, which is less machinery for the same guarantee. Cassettes are worth adding only if the stub bodies start duplicating across many tests.
