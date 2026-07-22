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
with a token. Each keyword variant issues 2 GitHub requests. Run the eval
too fast and GitHub returns 403 — which scores as a recall MISS,
indistinguishable from a genuine failure to find the target. An early run
of this suite produced recall@10 = 0.727 with most cases showing
`github:HTTP 403`; those numbers were meaningless.

The runner now spaces variants 12s apart unauthenticated (4.5s with a
token) and **refuses to write a baseline** when any variant hit a source
failure. Set `GITHUB_TOKEN` for faster, more reliable runs.

## Experiments

Query-strategy changes measured against the committed baseline. A null
result is recorded, not discarded — knowing a plausible idea does not help
is worth as much as knowing one does.

| # | Change | recall@10 | MRR | Kept? |
|---|--------|-----------|-----|-------|
| — | baseline | see `test/eval/baseline.json` | | — |
