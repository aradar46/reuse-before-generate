# reuse-before-generate

An MCP tool for coding agents: **before scaffolding a new project or module,
check whether it already exists.** Searches GitHub/npm/PyPI, filters to
actually-maintained candidates, and hands the calling agent a scoring prompt
so it re-ranks by real semantic similarity (not keyword overlap) itself —
presenting at most 3 alternatives with a concrete "extend this instead of
rebuilding" suggestion each.

This is the v0 ship of "candidate 6" from the reuse-before-generate
validation report, with the Wh-saved counter (candidate 10) folded in as a
display feature.

## Why

The direct competitor (`idea-reality-mcp`) decomposes descriptions into
bag-of-words GitHub queries; in testing this returned 290,351 "competing"
repos with a top hit of 383,798 stars — keyword noise, not competitors. This
tool's differentiator is the semantic re-rank step: real judgment of
functional overlap, not string overlap.

That re-rank step deliberately does **not** call an LLM API from inside the
server. An earlier version did (via `@anthropic-ai/sdk`), which meant a
separate billed Anthropic API key was required even if you were already
running the tool from inside a Claude session (e.g. Claude Pro/Max via
Claude Code) — API usage is billed separately from Pro/Max subscriptions.
Instead, the server returns the verified candidates plus scoring
instructions as tool output, and whichever agent called the tool performs
the semantic judgment itself, using the session already running. Zero extra
API cost, works on any plan.

## How it works

1. **Search** (`src/search.ts`) — pulls candidates from GitHub repo search,
   npm registry search, and best-effort PyPI name-guessing (PyPI has no
   general search API; this is the weakest leg and a known v0 gap).
2. **Verify** (`src/verify.ts`) — filters out archived repos, anything with
   no activity in the last year, and (for GitHub) anything with under 10
   stars, as a maintained-vs-abandoned heuristic.
3. **Re-rank prompt** (`src/rerank.ts`) — builds scoring instructions (not an
   API call) describing how to score 0-100 relevance and write a
   per-candidate extend-instead-of-rebuild suggestion. The calling agent
   does the actual scoring when it reads the tool result.
4. **Report** (`src/index.ts`) — returns the verified candidates + scoring
   prompt + the Wh-saved display line as the tool's output text.

## Setup

```bash
npm install
npm run build
```

No LLM API key required — the semantic judgment happens in whichever agent
calls this tool, not inside the server.

Optional: `GITHUB_TOKEN` raises the GitHub search rate limit from 10/min
(unauthenticated) to 30/min.

### Register with an MCP client (e.g. Claude Code)

Add to your MCP client config — for Claude Code, either run:

```bash
claude mcp add reuse-before-generate -- node /absolute/path/to/reuse-before-generate/dist/index.js
```

or add directly to `.mcp.json`:

```json
{
  "mcpServers": {
    "reuse-before-generate": {
      "command": "node",
      "args": ["/absolute/path/to/reuse-before-generate/dist/index.js"]
    }
  }
}
```

### Testing it right now

With it registered, just ask Claude Code (in this or a new session) something
like:

> Use check_before_building to check if a CLI tool that generates
> changelogs from conventional commits already exists.

Claude Code will call the tool, get back the verified-maintained candidates
and scoring instructions, and score/present the top 3 itself in its reply —
no separate API key needed since it's using the Pro/Max session you're
already in.

`keywords` is a **required** input, not optional: the tool schema forces
the calling agent to infer 3-6 precise search terms from the description
before it can call the tool at all. This exists because the mechanical
fallback extractor in `search.ts` is measurably weak on non-literal or
buzzword-heavy descriptions (e.g. this tool's own README, which is full of
"MCP"/"agent"/"server" — terms too generic to distinguish it from unrelated
MCP servers). An agent that already understood the user's intent produces
much better keywords than string-matching ever can; making the field
required means that inference step can't be silently skipped.

Then tell your agent (via a rule/instruction file, e.g. CLAUDE.md) to call
`check_before_building` before scaffolding new projects, so it happens
automatically rather than only on request.

## Instrumentation

Per the brief, installs/retention are instrumented from day one — with one
adjustment: the brief's "hosted analytics endpoint" implies standing up (and
paying for) backend infra, which cuts against "smallest possible version."
This ships a compromise instead:

- Every tool call always logs a local event
  (`~/.reuse-before-generate/events.jsonl`) — inspectable with zero infra,
  zero cost, zero setup.
- If you set `REUSE_BEFORE_GENERATE_TELEMETRY_URL`, the same event is also
  POSTed there — wire in a real collector when you're ready to aggregate
  across installs. No endpoint is bundled or defaulted.
- Set `REUSE_BEFORE_GENERATE_TELEMETRY_DISABLED=1` to turn it off entirely.

Events carry an anonymous per-install UUID and nothing else identifying — no
project descriptions, no file paths, no query content.

## Known v0 gaps

- **PyPI search** is a best-effort name-guess, not real search (no general
  PyPI search API exists post-XML-RPC retirement). Weakest leg of the three
  sources.
- **"Maintained" heuristic** is recency-only (pushed within the last year),
  not the fuller signal set (issue response time, contributor count,
  StarScout fake-star detection from candidate 4) — a natural v1 upgrade.
  It deliberately does NOT gate on star count anymore: an earlier version
  required 10+ stars, discarding a real, actively-maintained, genuinely
  on-point 0-star "GitHub Actions debugger" repo found during live testing.
  Star count is now surfaced to the calling agent as a scoring input
  instead (see `rerank.ts`), not used as a hard filter.
- **GitHub search structurally under-serves near-zero-star repos**: testing
  showed GitHub's own relevance ranking never surfaces 0-1 star repos in
  the top 100 results, under any query phrasing, once they're competing
  against anything with real stars — this is true even with an exact-name
  search restricted to `stars:0..3`. `searchGitHub()` now runs a second,
  parallel query scoped to `stars:0..3` (plain best-match, deliberately
  WITHOUT the `in:name,description,readme` qualifier or `sort=updated`,
  both of which were tested and found to make this lane worse) specifically
  to catch fresh/tiny repos the primary query buries. This closed part of
  the gap (confirmed live: surfaces a real 0-star competitor that was
  invisible before) but not all of it — two other known-real, very small
  repos with unusual names still don't reliably surface. GitHub's search
  index for tiny/oddly-named repos appears to be a harder, only
  partially-solved problem; see the regression fixture in
  `test/fixtures.mjs` for the exact case and its documented partial-recall
  expectation.
- **Keyword quality is genuinely fragile and description-dependent.** A
  10-case evaluation (see `test/fixtures.mjs`, cases 4-7) found the same
  failure pattern repeatedly: keywords chosen from the USER's framing of
  their problem (e.g. "pretty-print"/"colorize", "static site"/"alt-text")
  often fail to surface the dominant real tool, because maintainers
  describe their own project by function/category instead (e.g. "Terminal
  JSON viewer & processor", "Test your rendered HTML files"). The fix
  isn't mechanical — it's in the `keywords` field's tool description, which
  now tells the calling agent to mentally simulate the target's own README
  and pull words from that, not from the user's request. A second,
  separate finding from the same eval: for at least one case, one
  reasonable keyword swap (e.g. "capture" vs "chrome") flipped a result
  from found to missed — small perturbations in keyword choice can matter
  more than expected, and there's no guardrail against picking the
  slightly-wrong synonym other than the guidance text itself.
- **Energy-savings count fires early**: the Wh-saved counter increments as
  soon as any maintained candidate is found, before the calling agent's own
  relevance scoring happens — the server has no visibility into that later
  judgment, so the count is an upper-bound estimate, not a confirmed match.
- **Retention is unmeasured** until real installs generate events — the
  local JSONL + optional hosted endpoint above is the mechanism, not the
  data itself.


