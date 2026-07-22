# reuse-before-generate: solidification design

Date: 2026-07-22
Status: approved, pending implementation plan

## Goal

Take the v0 MCP server from "works, lightly validated by hand" to
"trustworthy, measurable, publishable." Three tracks, executed in order:

- **A — engineering robustness.** Tests, error handling, timeouts, response
  validation, a local CLI.
- **B — result quality.** Replace pass/fail recall fixtures with scored
  metrics, then use that loop to run measured query experiments.
- **C — shippability.** License, npm packaging, CI, README restructure.

A is sequenced first because it unblocks B: query strategy cannot be tuned
without a fast, deterministic, scored eval loop, and neither exists today.

## Current state

Five source modules (`search`, `verify`, `rerank`, `energy`, `telemetry`)
plus the MCP entry point in `index.ts`. One test file
(`test/fixtures.mjs`) that hits live GitHub/npm on every run, sleeps 3s
between cases, and reports pass/fail. No `npm test` script, no CI, no
license.

The architecture is sound. The core design decision — the server returns
scoring instructions rather than calling an LLM API, so the calling agent
performs the semantic re-rank using its existing session — is correct and
is not revisited here.

## Track A — engineering robustness

### A1. Testability seam: inject the fetcher

Every testability problem traces to `search.ts` calling global `fetch`
directly. A single module-level indirection fixes it:

```ts
// src/http.ts
export type Fetcher = (url: string, init?: RequestInit) => Promise<Response>;

let current: Fetcher = (url, init) => fetch(url, init);

export function setFetcher(f: Fetcher): void { current = f; }
export function resetFetcher(): void { current = (url, init) => fetch(url, init); }

export function httpGet(
  url: string,
  headers: Record<string, string>,
  timeoutMs = 8000,
): Promise<Response> {
  return current(url, { headers, signal: AbortSignal.timeout(timeoutMs) });
}
```

Deliberately the smallest seam that works: no DI container, no constructor
threading. `setFetcher`/`resetFetcher` are test-only.

This also closes the missing-timeout gap. Today `telemetry.ts` sets a 2s
abort signal but the three search calls have none, so a hung upstream hangs
the tool call indefinitely. Routing all of them through `httpGet` gives
every request a default timeout in the same change.

### A2. Validate network responses with zod

`search.ts` currently casts `res.json()` straight to a typed interface. A
shape change at npm or PyPI throws inside the tool handler and surfaces as
a generic error string.

Define zod schemas for the three response shapes and `safeParse` them. On
parse failure: log to stderr, return an error Result for that source. One
malformed upstream must not kill the whole call. This extends the existing
per-source `catch` philosophy to cover shape drift, not only transport
errors. zod is already a dependency.

### A3. Result type instead of throwing

Project convention favors Result/Either over exceptions.

Each source returns:

```ts
type SourceResult =
  | { ok: true; source: Source; candidates: RawCandidate[] }
  | { ok: false; source: Source; reason: string };
```

`searchAll` returns all three, and the tool handler reports partial success
honestly: "GitHub returned 12 candidates; npm search failed (HTTP 503)."

Today a partial failure is invisible — the user gets fewer results with no
indication why. Silent degradation is the failure mode most corrosive to
trust in a tool whose entire value is "did you check properly?"

### A4. Unit tests with `node:test`

Node 25 is in use, so the built-in test runner needs no new dependency.
Offline, millisecond-scale coverage of the pure functions:

- `extractKeywords` — stop-word filtering, first-occurrence ordering, the
  `max` cap, empty and punctuation-only input.
- `keywordsAsQuery` — the 64-char npm boundary, exactly-at-limit, and the
  first-word-longer-than-limit case.
- `verifyCandidate` — archived, missing date, malformed date, and the
  365-day boundary at 364/365/366.
- `energy` state math and the telemetry envelope shape.

Add `"test": "node --test test/unit/"` to package.json.

Three of these edge cases are believed to be live bugs, not merely
untested paths:

1. `keywordsAsQuery` returns `""` when the first keyword alone exceeds 64
   chars, sending an empty `text=` to npm, which 400s (npm's floor is 2
   chars).
2. `extractKeywords` can return `[]` for an all-stop-word description,
   producing a bare `in:name,description,readme` GitHub query.
3. `daysSince` returns `null` for a malformed date, reported as "no
   activity date available" — indistinguishable from genuinely absent data.

Each gets a test asserting the corrected behavior.

### A5. Local CLI

```bash
npm run check -- "a tool that formats python code" --keywords black,formatter,style
```

A thin `src/cli.ts` calling the same `searchAll` → `verifyAll` path,
printing a table of candidates with source, stars, maintenance status, and
rank. `process.argv` parsing only, no framework, roughly 40 lines.

This is the highest-leverage item in track A. It is what makes track B
possible at all: today, iterating on search quality requires spawning an
agent session per attempt.

### A6. Demote the energy counter

`formatEnergyLine` is removed from the default tool output. The module and
its local tally are kept, surfaced only when
`REUSE_BEFORE_GENERATE_SHOW_ENERGY=1` is set.

Rationale: the figure is fabricated (250 Wh, presented to three significant
figures), increments before the calling agent's relevance judgment happens,
and writes to disk on every call. It is the one element of the output a
skeptical reader would point at to dismiss the tool. Demoting rather than
deleting keeps the experiment available and the decision cheap to reverse.

### A7. Telemetry off the hot path

Cache `getInstallId()` in a module-level variable — it currently re-reads
from disk on every event. Stop `await`-ing `track()` in the tool handler;
fire and let it settle. Telemetry must never add latency to a tool call.

## Track B — result quality

### B1. Scored eval, not pass/fail

The central change. A fixture currently passes if the expected repo appears
anywhere in the maintained set, which cannot distinguish rank 14 from rank
3 — the exact signal needed when tuning queries.

Per-case output: rank of first match (or `MISS`). Suite aggregates:
recall@5, recall@10, recall@all, mean reciprocal rank, and per-source
attribution (primary GitHub lane, low-star GitHub lane, npm, or PyPI).

Per-source attribution answers a question currently unanswerable: is the
low-star lane earning its extra API call?

Baselines are committed as JSON. `npm run eval` prints a diff against the
last recorded run — "recall@10: 0.71 → 0.86 (+0.15)" rather than "6/7
passed".

### B2. Expand fixtures to ~15 cases

Seven cases is too few for a percentage to carry meaning; one case flipping
moves recall by 14 points.

The existing seven are kept verbatim — they encode real findings,
particularly cases 4-7. Added coverage:

- A description with no real competitor, exercising the true-negative path,
  which is entirely untested today.
- A vague or non-native phrasing.
- An npm-dominant target.
- A PyPI-dominant target.
- Two further low-star regression guards.

### B3. Keyword sensitivity harness

The README records that swapping "capture" for "chrome" flipped a result
from found to missed, with no guardrail against it.

Each fixture may carry multiple keyword variants; the eval reports rank per
variant. A strategy whose results swing across reasonable synonyms is
fragile in a way a single-variant eval hides entirely. This converts a
recorded anecdote into a tracked metric.

### B4. PyPI coverage

The current name-guessing lane is best-effort and known-weak.

Planned approach: most Python tools worth finding have GitHub repositories,
and the GitHub lane already searches those. Add `language:python` as an
optional GitHub sub-query rather than building a fragile PyPI HTML scraper,
retaining name-guessing as a cheap direct-hit bonus.

This is a judgment call from the current constraints, not a verified fact
about today's PyPI APIs. Current PyPI documentation will be checked before
implementation, and this section revised if a real search API is available.

### B5. Measured query experiments

With B1 in place these become empirical rather than speculative. Each is a
one-line change measured against the committed baseline:

- Drop `in:name,description,readme` from the primary lane.
- Split keywords into two narrower queries instead of one broad AND.
- Widen the low-star lane to `stars:0..10`.
- Add a `sort=updated` recency lane.

Whichever measurably win are kept. A null result is a real finding and is
recorded in `docs/findings.md` rather than discarded.

## Track C — shippability

- **C1. License.** MIT. Currently absent, which leaves the project legally
  unusable by anyone else.
- **C2. npm packaging.** Add `repository`, `bugs`, `homepage`, `keywords`;
  add `prepublishOnly` running build and tests; verify the `npm pack`
  payload. `bin` already points at `dist/index.js`, so
  `npx reuse-before-generate` works once published.
- **C3. CI.** GitHub Actions running build and unit tests on push and PR.
  The live eval runs on manual dispatch and a weekly schedule only, never
  blocking a PR — it depends on GitHub's ranking, which drifts
  independently of this codebase. Weekly runs surface that drift without
  causing flaky PRs.
- **C4. README restructure.** Install and usage move to the top. The
  failure analysis moves to `docs/findings.md`, still linked. That analysis
  is valuable, but it is not what a reader needs in the first thirty
  seconds.
- **C5. Version.** 0.2.0 at release, since default tool output changes
  (energy line removed).

## Testing strategy

Three tiers, deliberately separated:

1. **Unit** (`npm test`) — offline, milliseconds, runs on every commit and
   in CI. Pure functions only.
2. **Pipeline** (`npm test`) — offline, using `setFetcher` with recorded
   fixture responses. Covers search → verify → rerank wiring, partial
   source failure, and malformed response handling. Cassettes are checked
   in and refreshed deliberately via a documented command.
3. **Live eval** (`npm run eval`) — hits real GitHub/npm/PyPI, produces
   scored recall metrics, never part of `npm test`, never blocks a PR.

Tiers 1 and 2 gate merges. Tier 3 measures quality.

## Sequencing

A1-A3 → A4-A5 → A6-A7 → B1-B3 → B4-B5 → C.

B4 and B5 carry genuine uncertainty; every other item is mechanical.

## Out of scope

- Replacing the calling-agent re-rank with a server-side LLM call. The
  zero-extra-cost property is a core differentiator.
- A hosted telemetry collector. The local JSONL plus optional endpoint
  stays as-is.
- Sources beyond GitHub, npm, and PyPI.
