# Multi-source project and competitor discovery

Date: 2026-07-23
Status: Approved design

## Purpose

`reuse-before-generate` currently depends heavily on GitHub's index, ranking,
and repository metadata. That works well when a maintainer uses the expected
words, but it misses oddly named repositories, projects described in different
language, and commercial products that solve the same problem without exposing
a public repository.

The new discovery pipeline will remain stateless, require no API keys, and
surface two distinct kinds of result:

1. maintained projects or packages the user could reuse or extend;
2. commercial or hosted products the proposed project would compete with.

The system will not build or maintain a local search index.

## Principles

- Zero configuration is a hard requirement. Optional credentials may continue
  improving an existing source, but no source may require them for baseline use.
- Functional similarity matters more than stars, votes, or download counts.
- Search-engine and marketplace popularity are evidence of maturity, not
  evidence of semantic relevance.
- Every source is independently fallible. A source failure must not fail the
  overall search or be mistaken for a complete search.
- An empty result means "no strong match found in the sources searched," not
  "there is no competition" or "clear to build."
- A new source must demonstrate unique retrieval wins in the evaluation corpus
  to justify its request and maintenance cost.

## Search input

The calling agent already understands the user's idea and remains responsible
for translating it into search language. In addition to the plain-language
description, it supplies three formulations:

- **Category**: the noun phrase a maintainer or product page would use, such as
  `terminal JSON viewer`.
- **Outcome**: the job the user wants done, such as
  `inspect and navigate JSON from command line`.
- **Synonyms**: an alternative vocabulary or interface framing, such as
  `JSON TUI processor`.

The input schema preserves the required `description` and `keywords` fields and
adds an optional object:

```ts
queries?: {
  category: string;
  outcome: string;
  synonyms: string;
}
```

The tool description strongly instructs new callers to provide `queries`. When
it is absent, `keywords.join(" ")` supplies the category formulation and the
original description supplies the outcome formulation; the planner omits the
synonym lane rather than inventing synonyms mechanically. This keeps existing
calls working while giving capable callers a less fragile retrieval interface.

## Architecture

```text
Project idea
    |
    v
Three query formulations
    |
    v
Source-specific request planner
    +-- Reuse: GitHub, npm, GitLab, conditional ecosystem registries
    +-- Competition: Show HN, Product Hunt RSS, best-effort web search
    |
    v
Canonicalization and deduplication
    |
    v
Mechanical rank fusion within separate result pools
    |
    v
Calling agent performs semantic judgment
    |
    v
"Projects you could reuse" and "Products you would compete with"
```

The pipeline remains a collection of small source adapters. Each adapter accepts
the formulations selected for that source and returns either normalized
candidates or an attributable failure. Retrieval, normalization, verification,
fusion, prompt construction, and reporting remain separate units.

## Source-specific request planning

Sending every formulation through every lane would exceed GitHub's anonymous
search budget and add noise. A request planner assigns a bounded subset:

| Source | Role | Query behavior |
|---|---|---|
| GitHub | Open-source repositories | One primary relevance query and one low-star query; run a language lane only when the description implies that ecosystem |
| npm | JavaScript packages | Category plus the strongest alternative formulation |
| GitLab | Public projects missed by GitHub | Category plus outcome, using its unauthenticated project listing search |
| Ecosystem registries | Language- or platform-specific packages | Query only registries implied by the idea, never all registries |
| Show HN | Products explained by makers and commenters | Search category, outcome, and synonyms; prefer Show HN stories and retain story evidence |
| Product Hunt RSS | Recently launched products | Match current feed entries against all formulations |
| DuckDuckGo HTML | Broad web and historical Product Hunt discovery | At most one general query and one site-scoped Product Hunt query |

The initial conditional registry set is crates.io for Rust, RubyGems for Ruby,
Packagist for PHP, and Maven Central for JVM projects. Each has a dedicated
evaluation case. Adding another registry without a corresponding case is out of
scope.

## DuckDuckGo boundary

DuckDuckGo's keyless JSON endpoint is an Instant Answer service, not a full web
search API, so it is not the basis of the web lane. The web lane may parse
DuckDuckGo's non-JavaScript HTML results as an explicitly experimental,
best-effort adapter.

It must:

- use a strict timeout and a small fixed request budget;
- perform no retry storm when blocked;
- extract only the result title, destination URL, and snippet;
- detect challenge pages or incompatible markup and return an attributable
  source failure;
- never determine whether the overall operation succeeds;
- be removable without changing the rest of the pipeline.

Saved HTML fixtures provide deterministic parser coverage. A non-blocking live
smoke check detects availability or markup drift. The lane remains only if live
evaluation demonstrates unique retrieval wins.

## Normalized candidate and evidence

A candidate represents a project or product rather than a source result. It
contains:

- stable internal identity;
- display name and canonical destination URL;
- kind: `open_source`, `commercial`, or `unknown`;
- description assembled from source evidence;
- zero or more repository and package URLs;
- one or more evidence records;
- maintenance data when repository or package activity is available;
- lightweight traction signals when supplied by a source.

Each evidence record contains:

- source and source-specific identifier;
- source result URL;
- destination URL;
- title and snippet;
- query formulation that produced it;
- rank within that retrieval lane;
- source date when available.

Classification must be conservative. A repository or a package linked to a
repository is `open_source`. A candidate is `commercial` only when its evidence
explicitly identifies a paid, hosted, or commercial offering. A product listing
alone is insufficient. Ambiguous cases remain `unknown`; the pipeline must not
invent licensing or pricing information.

## Canonicalization and deduplication

Canonicalization resolves search-engine wrapper URLs and normalizes common
repository, package, and product URL variants. Candidates merge when they share
a canonical destination, repository URL, or package identity. All evidence is
retained after a merge.

Source duplication must not amplify rank. Multiple results from the same source
and query contribute once to the fused candidate, while independent sources or
different useful formulations provide corroboration.

## Verification

Open-source candidates continue through repository/package health verification:
archival state, parseable activity date, and a documented recency window.
Popularity is not a maintenance gate.

Commercial candidates use a different evidence model. A reachable product page
or a dated Product Hunt/Hacker News appearance establishes that a product was
publicly available at that point, but does not prove that the business is
currently healthy. Reports must describe the evidence rather than label the
business "maintained."

Unknown candidates are retained when evidence is strong enough for semantic
review and are labeled honestly.

## Retrieval fusion and semantic ranking

Mechanical ranking uses reciprocal-rank fusion with the fixed score
`sum(1 / (60 + rank))`, calculated within two pools:

- reuse candidates;
- market competitors.

Occurrences across independent sources and useful query formulations improve a
candidate's retrieval score. Only the best rank for each source/query pair
contributes, preventing duplicate rows from amplifying a candidate. Open-source
candidates enter the reuse pool; commercial candidates enter the competition
pool; unknown candidates without a reusable artifact enter the competition pool
until semantic review. Popularity metrics do not enter the functional relevance
score.

The mechanical score only selects and orders candidates for the calling agent.
The agent makes the final judgment using:

- functional overlap;
- intended audience and workflow;
- reuse or extension potential;
- market substitutability;
- specificity and quality of evidence;
- repository/package health or the limits of commercial evidence.

The agent may move an `unknown` candidate into the most appropriate output
section but must preserve the uncertainty label.

## Output

Return at most three strong results in each section:

```text
Projects you could reuse

1. Name — open source
   Why it matches: ...
   Important difference: ...
   Evidence: GitHub + npm

Products you would compete with

1. Name — commercial
   Why users may choose it instead: ...
   Important difference: ...
   Evidence: Product Hunt + Show HN

Search coverage

Searched: GitHub, npm, GitLab, Show HN, Product Hunt feed, web
Unavailable: none
```

Neither section is padded with low-confidence matches. Search coverage always
lists attempted and unavailable sources. When no candidate qualifies, the
result states that no strong match was found in the searched sources and avoids
claiming that the idea has no competitors.

## Failure handling

Every adapter returns a source-attributed result. Timeouts, rate limits,
unexpected response shapes, parsing drift, and unavailable feeds are isolated
and reported. Successful sources continue through the pipeline.

If all sources fail, the tool returns an error rather than an empty competitive
landscape. If at least one source succeeds, the response includes results or an
honest empty result plus a coverage warning.

No query text is added to telemetry. Existing local telemetry privacy
properties remain unchanged.

## Evaluation

The live evaluation corpus expands into:

- reuse cases with known open-source or package answers;
- competition cases with known commercial or hosted answers;
- true-negative cases whose lexical matches should be rejected.

Report:

- recall at 5 and 10 separately for reuse and competition;
- hit rate across category, outcome, and synonym formulations;
- first and corroborating source attribution;
- unique wins contributed by each source;
- false positives on true-negative cases;
- source availability, request count, and latency.

DuckDuckGo availability does not affect the primary quality score. Its parser is
covered by saved fixtures, and its live smoke result is reported separately.

The evaluation runner must derive anonymous request pacing from the planned
request count, as it does today for GitHub, and must refuse to save a baseline
contaminated by unaccounted source failures.

## Rollout

Implementation proceeds in five measurable stages:

1. Add normalized evidence, canonical deduplication, separate result classes,
   source coverage, and rank fusion.
2. Add GitLab and Show HN adapters.
3. Add only the ecosystem registries required by evaluation cases.
4. Add Product Hunt RSS for recent launches.
5. Add DuckDuckGo HTML behind an isolated experimental adapter and retain it
   only if it produces unique wins.

Each stage includes offline unit tests and focused live evaluation before the
next source is added. No local discovery index, crawler, background updater, or
hosted service is part of this design.
