# Search quality findings

This document records measured live retrieval, not semantic product claims.
Run `npm run eval -- --diff`; a clean full run may update the baseline with
`npm run eval -- --diff --save`.

## Previous baseline (2026-07-23)

This baseline predates the v0.4 retrieval changes and is retained only as
historical evidence. It must not be used to judge the current Tavily-backed
pipeline; a new sequential external audit should replace it.

The committed baseline is one authenticated run of 18 planned searches:
15 reuse cases, two competition cases, and one deliberately absurd
true-negative. All required attempted sources completed. Experimental web
search was attempted for all 18 cases and failed with a challenge response
in nine; those failures are preserved per case and did not block the save.

| pool | recall@5 | recall@10 |
|---|---:|---:|
| reusable projects (15 cases) | 0.733 | 0.800 |
| competing products (2 cases) | 0.500 | 0.500 |

The true-negative returned four retrieval candidates. That is not reported
as four semantic false positives: the retrieval layer intentionally returns
plausible evidence, while the calling agent decides whether it actually
overlaps the proposal.

Per-case ranks, evidence sources, formulation hit rates, failures, and pool
sizes are in `test/eval/baseline.json`.

## What source attribution showed

A "unique single-source win" means the matched target's fused evidence came
from exactly one source in this run. The counts were:

| source | unique wins |
|---|---:|
| GitHub | 4 |
| npm | 2 |
| Hacker News | 1 |
| web | 1 |

Web's unique win was Screen Studio, found in the competition pool at rank
14. It therefore contributed evidence no other source supplied in this run,
despite succeeding on only nine of 18 attempts. The ecosystem registries had
no unique target win in this baseline.

The registry cases were mixed: ripgrep ranked 4, RuboCop 10, Monolog 1, and
picocli was missed. Their winning target evidence was attributed to GitHub
or fused GitHub/web evidence, not uniquely to the registry. The registry
lanes may still broaden the candidate set, but this run does not demonstrate
a unique target contribution from them.

## Known limitations

- **Formulation coverage remains fragile.** Winner formulation hit rate was
  usually one of three, occasionally two of three, and never three of three.
  Structured queries make this visible; they do not solve vocabulary gaps.
- **Small, oddly named projects remain hard to retrieve.** The
  `actions-debugger` and `low-star-niche` targets were missed in this run
  even though GitHub has a dedicated `stars:0..3` query.
- **JVM registry discovery needs work.** The picocli target missed while
  unrelated CLI packages occupied the reuse pool.
- **Competition evidence is sparse.** Calendly ranked 1, but Screen Studio
  ranked 14. Two cases are enough to exercise the pool, not enough to claim
  broad commercial-market coverage.
- **Web availability affects recall.** v0.4 uses the optional Tavily API
  instead of scraping a search-results page. Without a key it is explicitly
  unavailable; upstream failures remain visible in coverage.
- **Maintenance is a recency heuristic.** Reuse candidates are accepted
  when unarchived and active within a year. Issue responsiveness,
  contributor health, security posture, and project governance are not
  evaluated.

## Evaluation method

Each case executes one bounded query plan containing category, outcome, and
synonym formulations. The runner calls the same `prepareCandidates`
pipeline as the product, then finds a known target by ID, name, or URL only
within the expected reuse or competition pool.

Reuse and competition recall@5/@10 are separate. The runner also records:

- evidence sources on the winning candidate;
- the fraction of the three planned formulations represented in its
  evidence queries;
- unique single-source wins;
- attempted and failed web availability;
- retrieval candidate count on the true-negative; and
- per-source failures without collapsing them into misses.

GitHub pacing follows the current plan: four GitHub requests for a generic
case and five for an explicit Python case. It uses the authenticated
30/minute or anonymous 10/minute rate with 25% headroom. A required
attempted-source failure blocks baseline saving; experimental web failure
does not. Single-case and mid-run-dist-change saves are refused.
