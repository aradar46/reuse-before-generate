# Reliable Source Discovery Design

**Date:** 2026-07-23
**Target release:** 0.4.0

## Purpose

Improve normal `reuse-before-generate` retrieval when upstream services rate
limit or block anonymous automation. The MCP should continue to find both:

- maintained open-source projects a user could reuse; and
- existing products with which the proposed project would compete.

This work is about product reliability and result quality. Audit bookkeeping
is deliberately not part of the MCP product.

## Product boundaries

### In scope

- Remove Product Hunt completely.
- Remove the unreliable DuckDuckGo HTML scraper.
- Add optional Tavily web search.
- Make GitHub search globally paced and rate-header-aware within a running
  MCP process.
- Preserve the keyless default while supporting an optional fine-grained
  GitHub token and optional Tavily key.
- Reduce npm noise by sending registry-appropriate formulations rather than
  unrestricted outcome prose.
- Keep reuse and competition results separate.
- Report configured, unavailable, and failed sources honestly.
- Update tests, documentation, evaluation cases, version metadata, and local
  installation instructions.

### Out of scope

- A local discovery index or cache of search results.
- Product Hunt replacement through another launch feed.
- Shipping an audit framework, audit metadata, audit target sets, or audit raw
  transcripts in the MCP.
- Making API credentials mandatory.
- Circumventing upstream challenges or rate limits.
- Promising that an empty result proves an idea is unique.

## Source strategy

### Removed sources

Product Hunt is removed from source types, orchestration, evidence,
reporting, tests, documentation, and evaluation. Its current RSS feed is a
recency feed rather than a historical product-search index, which causes the
same recent launches to recur across unrelated ideas.

DuckDuckGo HTML search is also removed. It is an unofficial scraping path and
currently returns challenge responses from the target environment. A source
that predictably fails should not consume latency or create a false sense of
coverage.

### Retained keyless sources

- GitHub repository search
- GitLab project search
- npm
- Show HN through Algolia
- crates.io
- RubyGems
- Packagist
- Maven Central
- the existing Python-specific GitHub lane

The ecosystem registries remain conditional: only the registry matching an
explicit ecosystem signal is queried.

### Optional Tavily source

When `TAVILY_API_KEY` is configured, one bounded basic Tavily search is run
for the category formulation. It contributes both repository and product
destinations to the existing evidence model. Repository destinations are
classified as reuse candidates; other destinations remain competition
candidates until the calling agent applies semantic judgment.

When Tavily is not configured, no web request is attempted. Coverage says
that optional web search is not configured. This is different from an
attempted source failing.

Tavily failure is isolated and does not turn successful repository or
registry retrieval into a total failure.

## GitHub reliability

### Authentication

`GITHUB_TOKEN` remains optional. A fine-grained personal access token is
supported through the existing environment variable; the local installation
will be configured with the user's token after implementation. The token is
never logged or returned in MCP output.

### Request scheduling

All GitHub repository-search calls pass through one module-level scheduler.
The scheduler:

1. serializes GitHub search requests;
2. prevents the primary and low-star lanes from firing concurrently;
3. reads `X-RateLimit-Remaining` and `X-RateLimit-Reset`;
4. honors `Retry-After`;
5. waits until the reset time when the remaining search budget is exhausted;
6. applies bounded exponential backoff for secondary-limit responses; and
7. returns an attributed GitHub failure after the retry budget is exhausted.

The scheduler covers concurrent MCP tool calls in the same server process.
It does not create a cross-process search cache or discovery index.

Anonymous use stays supported but may be slower because GitHub gives it a
smaller search budget. Authenticated use improves throughput but still obeys
GitHub's search and secondary limits.

## Query and relevance behavior

The structured category, outcome, and synonym formulations remain part of
the public tool contract.

Source routing becomes more deliberate:

- GitHub uses category-oriented repository queries and its low-star lane.
- npm uses category and synonyms, capped at two unique queries. Free-form
  outcome prose is not sent to npm because single outcome words regularly
  retrieve popular but unrelated packages.
- GitLab and Show HN keep their bounded existing formulation plans.
- Tavily receives one category-oriented web query.
- Conditional registries receive the category formulation.

Fusion and final agent-side semantic scoring remain unchanged in principle.
The retrieval layer should gather plausible evidence without pretending that
lexical overlap proves equivalence.

## Coverage and failure semantics

Coverage distinguishes:

- **searched:** the source was attempted successfully, including an empty
  result;
- **unavailable:** the optional source was not configured; and
- **failed:** the source was attempted but returned an HTTP, timeout, rate, or
  response-shape failure.

An empty candidate pool retains the existing cautious wording. A failed
GitHub or registry source makes the search incomplete and is never converted
into a semantic miss.

Tavily remains optional, so its absence or isolated failure does not make all
operational sources failed.

## Components

### Source model and orchestration

Remove `producthunt` and replace `web`'s DuckDuckGo implementation with an
optional Tavily adapter. `searchAllResults` continues to return one attributed
result per source in stable order.

### GitHub scheduler

Add a focused scheduler module owned by GitHub retrieval rather than the
generic HTTP client. This keeps GitHub-specific header and retry semantics
out of unrelated sources.

### Tavily adapter

The adapter validates the response shape, maps ranked results to evidence,
uses the existing URL canonicalization, and never exposes the API key.

### Reporting

Extend coverage data enough to distinguish not-configured from attempted
failure without changing the two user-facing result pools.

## Testing

Offline tests cover:

- Product Hunt is absent from the source union and search plan.
- DuckDuckGo is absent from the search plan and package.
- GitHub requests are serialized across simultaneous searches.
- the scheduler honors reset and retry headers with injected time and sleep
  seams rather than real delays;
- bounded backoff eventually returns an attributed failure;
- Tavily is skipped without a key;
- Tavily maps valid reuse and competition destinations;
- Tavily HTTP, timeout, and schema failures stay isolated;
- npm receives category and synonyms but not outcome prose;
- coverage distinguishes searched, not configured, and failed sources;
- secrets never appear in result text or logs.

The existing full unit suite remains the merge gate. Live source evaluation
is run once after offline verification and is not treated as deterministic.

## One-time re-audit procedure

The re-audit is validation work performed after version 0.4.0 is built and
installed. It is not MCP functionality.

Claude receives a separate audit instruction that requires sequential cases,
predeclared expected targets, raw response preservation, environment and
version recording, separate source-availability and relevance metrics, and
programmatically checked arithmetic.

The audit reports at least:

- source availability by source;
- end-to-end reuse recall at 5 and 10;
- end-to-end competition recall at 5 and 10;
- recall conditional on required-source availability;
- precision at 5 under a fixed semantic rubric; and
- per-case raw evidence and attributed failures.

Infrastructure failures and semantic misses are reported separately. Audit
requirements do not alter normal user prompts or MCP responses.

## Installation after implementation

After tests and live verification:

1. build version 0.4.0 from local `master`;
2. keep the user-scoped MCP registration pointed at the local `dist/index.js`;
3. securely add the user's fine-grained GitHub PAT to `GITHUB_TOKEN` without
   printing it or placing it in shell history;
4. optionally add `TAVILY_API_KEY` the same way;
5. verify MCP health from a directory outside the repository; and
6. start a fresh Claude session before running the external audit.

The currently available `gh` credential is an OAuth token, not the requested
fine-grained PAT, so it will not be substituted automatically.
