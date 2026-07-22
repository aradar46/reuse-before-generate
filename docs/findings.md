# Search quality findings

What has actually been measured about this tool's retrieval, and where it
still falls short. Everything here came from running the thing, not from
reasoning about it.

Measure with `npm run eval`. Numbers move between runs because they depend
on live GitHub ranking, so treat differences under ~0.05 as noise unless a
specific case changed rank. `test/eval/baseline.json` holds the committed
scores; `npm run eval -- --diff` compares against them.

## Known gaps

- **PyPI search** is a best-effort name-guess, not real search. There is no
  general PyPI search API post-XML-RPC-retirement, and the web endpoint
  returns HTML regardless of what you ask for:

  ```
  curl -so /dev/null -w '%{content_type}' \
    'https://pypi.org/search/?q=json+viewer&format=json'
  # => text/html; charset=utf-8   (same with Accept: application/json)
  ```

  Re-run that to check whether it is still true. Weakest leg of the three
  sources.

- **"Maintained" heuristic** is recency-only (pushed within the last year),
  not the fuller signal set (issue response time, contributor count,
  StarScout fake-star detection) — a natural v1 upgrade. It deliberately
  does NOT gate on star count: an earlier version required 10+ stars,
  discarding a real, actively-maintained, genuinely on-point 0-star "GitHub
  Actions debugger" repo found during live testing. Star count is surfaced
  to the calling agent as a scoring input instead (see `rerank.ts`), not
  used as a hard filter.

- **GitHub search structurally under-serves near-zero-star repos.** Testing
  showed GitHub's own relevance ranking never surfaces 0-1 star repos in
  the top 100 results, under any query phrasing, once they compete against
  anything with real stars — true even with an exact-name search restricted
  to `stars:0..3`. `searchGitHub()` runs a second, parallel query scoped to
  `stars:0..3` (plain best-match, deliberately WITHOUT the
  `in:name,description,readme` qualifier or `sort=updated`, both tested and
  found to make this lane worse) specifically to catch fresh/tiny repos the
  primary query buries. This closed part of the gap (confirmed live:
  surfaces a real 0-star competitor that was invisible before) but not all
  of it — two other known-real, very small repos with unusual names still
  don't reliably surface. GitHub's index for tiny/oddly-named repos appears
  to be a harder, only partially-solved problem; see the `actions-debugger`
  case in `test/eval/cases.mjs` for the exact scenario and its documented
  partial-recall expectation.

- **Keyword quality is fragile and description-dependent.** A 10-case
  evaluation found the same failure pattern repeatedly: keywords chosen
  from the USER's framing of their problem (e.g. "pretty-print"/"colorize",
  "static site"/"alt-text") often fail to surface the dominant real tool,
  because maintainers describe their project by function/category instead
  (e.g. "Terminal JSON viewer & processor", "Test your rendered HTML
  files"). The fix isn't mechanical — it lives in the `keywords` field's
  tool description, which tells the calling agent to mentally simulate the
  target's own README and pull words from that, not from the user's
  request. A second finding from the same eval: one reasonable keyword swap
  ("capture" vs "chrome") flipped a result from found to missed. Small
  perturbations matter more than expected, and the only guardrail is the
  guidance text. The eval now measures this directly — each case carries
  multiple keyword variants and reports per-variant rank, so fragility
  shows up as a low "variant hit-rate" instead of an anecdote.

- **Energy-savings count fires early.** The Wh counter increments as soon
  as a maintained candidate is found, before the calling agent's relevance
  scoring — the server has no visibility into that later judgment, so the
  count is an upper bound, not a confirmed match. As of 0.2.0 it is hidden
  unless `REUSE_BEFORE_GENERATE_SHOW_ENERGY=1`, because a fabricated
  order-of-magnitude figure printed to three significant figures was the
  weakest claim in the output and invited dismissal of the rest.

- **Retention is unmeasured** until real installs generate events. The
  local JSONL plus optional hosted endpoint is the mechanism, not the data.

## Eval methodology

Scored by **rank of first match**, not pass/fail. Pass/fail cannot tell you
that a change moved the right answer from position 14 to position 3, which
is exactly the signal needed when tuning queries.

Reported per run:

- `recall@5`, `recall@10`, `recall@all` — fraction of cases whose target
  appears at or above that rank
- `MRR` — mean reciprocal rank; rewards ranking the right answer higher,
  not merely finding it
- **variant hit-rate** per case — how many keyword phrasings found the
  target. Low hit-rate with a good best-rank means the case is reachable
  but fragile.
- **false positives on true-negative cases** — the `no-real-competitor`
  case should find nothing. A search that returns plausible-looking matches
  for everything is as broken as one that returns nothing.

True-negative cases are excluded from the recall denominator, so "correctly
found nothing" cannot deflate the score.

### A trap worth knowing

GitHub's search endpoint allows **10 requests/minute unauthenticated**, 30
with a token. Each keyword variant issues 3 GitHub requests (primary lane,
low-star lane, `language:python` lane). Run the eval too fast and GitHub
returns 403 — which scores as a recall MISS, indistinguishable from a
genuine failure to find the target.

This is not hypothetical. Three separate runs of this suite reported
recall@10 of 0.727 and 0.818 with `github:HTTP 403` scattered through
them. The real figure, measured authenticated with zero source failures,
is **1.000**. Every one of those "misses" was throttling.

Two guards now exist:

1. The delay is **derived** from the lane count and rate limit, not
   hardcoded. Adding the `language:python` lane took requests-per-variant
   from 2 to 3, which silently invalidated a hand-tuned 12s delay — the
   exact drift that produced the last set of phantom misses.
2. The runner **refuses to write a baseline** when any variant hit a
   source failure. A contaminated baseline is worse than none, because it
   looks authoritative and poisons every later comparison.

Set `GITHUB_TOKEN` (or `GITHUB_TOKEN=$(gh auth token)`) — it cuts a full
run from ~8 minutes to ~2.5 and avoids throttling entirely.

## Baseline (2026-07-22)

Authenticated run, 12 cases, zero source failures.

| metric | value |
|---|---|
| recall@5 | 0.909 |
| recall@10 | **1.000** |
| MRR | 0.750 |
| false positives on the true-negative case | 0 |

Every case with a real target found it within the top 10; 10 of 11 within
the top 5. The one outside is `actions-debugger` at rank 6 — the case
documented above as only partially solved, now reachable via the low-star
lane.

### What the source attribution showed

The eval records which lane produced each winning candidate. Across 21
variant runs:

- **The PyPI name-guessing lane produced zero winners.** Every hit came via
  `github` or `npm`. Python coverage comes entirely from the
  `language:python` GitHub lane, which took `python-dominant` (find
  `requests` from "http client") from MISS to rank 1. Name-guessing is
  retained only because it is nearly free — two direct-hit lookups — but it
  is not carrying Python discovery.
- **The low-star lane earns its request.** `actions-debugger` and
  `low-star-niche` both resolve through it.

### Both remaining MISSes are the keyword-framing failure, not retrieval

`json-viewer` finds its target at rank 1 with `json,viewer,terminal` and
MISSes entirely with `json,pretty-print,colorize`. `low-star-niche` finds
it with `port,kill,process` and MISSes with `tcp,listening,terminal`. In
both cases the failing variant is the *user's* framing of the problem and
the succeeding one is the *maintainer's* framing of the tool — exactly the
pattern described above. This is now a measured 50% variant hit-rate on
those two cases rather than an anecdote.

The practical implication: recall@10 of 1.0 describes what is reachable
when the calling agent picks good keywords. It is not what a user gets by
accident. The guidance text in the `keywords` field is doing real work.

## Experiments

Query-strategy changes measured against the committed baseline. A null
result is recorded, not discarded — knowing a plausible idea does not help
is worth as much as knowing one does.

Note that recall@10 is already 1.000, so there is no headroom there; MRR
(0.750) is the metric with room to move, and it rewards ranking the right
answer higher rather than merely finding it.

| # | Change | recall@10 | MRR | Kept? |
|---|--------|-----------|-----|-------|
| — | baseline (`test/eval/baseline.json`) | 1.000 | 0.750 | — |
