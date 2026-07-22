# reuse-before-generate

An MCP tool for coding agents: **before scaffolding a new project or module,
check whether it already exists.** Searches GitHub/npm/PyPI, filters to
actually-maintained candidates, and hands the calling agent a scoring prompt
so it re-ranks by real semantic similarity (not keyword overlap) itself —
presenting at most 3 alternatives with a concrete "extend this instead of
rebuilding" suggestion each.

No LLM API key required. The semantic judgment happens in whichever agent
calls the tool, using the session already running.

## Install

```bash
npm install
npm run build
```

Register with an MCP client. For Claude Code:

```bash
claude mcp add reuse-before-generate -- node /absolute/path/to/reuse-before-generate/dist/index.js
```

Or add directly to `.mcp.json`:

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

## Usage

With it registered, ask your agent something like:

> Use check_before_building to check if a CLI tool that generates
> changelogs from conventional commits already exists.

The agent calls the tool, gets back verified-maintained candidates plus
scoring instructions, and scores and presents the top 3 itself — no separate
API key, since it uses the session you are already in.

For it to happen automatically rather than on request, tell your agent via a
rule file (e.g. `CLAUDE.md`) to call `check_before_building` before
scaffolding new projects.

### Why `keywords` is required

`keywords` is a **required** input, not optional: the schema forces the
calling agent to infer 3-6 precise search terms from the description before
it can call the tool at all.

The mechanical fallback extractor in `search.ts` is measurably weak on
non-literal or buzzword-heavy descriptions — including this project's own
README, which is full of "MCP"/"agent"/"server", terms too generic to
distinguish it from unrelated MCP servers. An agent that already understood
the user's intent produces far better keywords than string-matching can, and
making the field required means that inference step cannot be silently
skipped.

The field's own description tells the agent to pick the word a *maintainer*
would use for what the tool IS, rather than the word describing the user's
problem. That distinction is not cosmetic — see
[docs/findings.md](docs/findings.md) for the evaluation that produced it.

## How it works

1. **Search** (`src/search.ts`) — pulls candidates from GitHub repo search
   (two lanes: a primary relevance query plus a `stars:0..3` lane that
   catches tiny/new repos the primary query structurally buries), npm
   registry search, and best-effort PyPI name-guessing.
2. **Verify** (`src/verify.ts`) — filters out archived repos and anything
   with no activity in the last year. Deliberately does **not** filter on
   star count: a brand-new 0-star repo doing exactly the job is precisely
   the duplicate worth catching. Star count is passed to the calling agent
   as a scoring input instead.
3. **Re-rank prompt** (`src/rerank.ts`) — builds scoring instructions (not
   an API call) describing how to score 0-100 relevance and write a
   per-candidate extend-instead-of-rebuild suggestion.
4. **Report** (`src/index.ts`) — returns the candidates and scoring prompt
   as the tool's output, naming any source that failed so partial results
   are never mistaken for complete ones.

## Configuration

All optional.

| Variable | Effect |
|---|---|
| `GITHUB_TOKEN` | Raises the GitHub search rate limit from 10/min to 30/min. Recommended. |
| `REUSE_BEFORE_GENERATE_SHOW_ENERGY=1` | Appends the estimated Wh-saved line to the output. Off by default — it is an order-of-magnitude estimate that increments before relevance is judged. |
| `REUSE_BEFORE_GENERATE_TELEMETRY_URL` | POSTs each event to your own collector. Nothing is bundled or defaulted. |
| `REUSE_BEFORE_GENERATE_TELEMETRY_DISABLED=1` | Disables event logging entirely. |
| `REUSE_BEFORE_GENERATE_STATE_DIR` | Overrides `~/.reuse-before-generate` for local state. Used by the test suite so runs do not touch real state. |

Events carry an anonymous per-install UUID and nothing else identifying — no
descriptions, no file paths, no query content. They are written to
`~/.reuse-before-generate/events.jsonl`, inspectable with zero infra.

## Development

```bash
npm test                                              # offline unit tests
npm run check -- "<description>" --keywords a,b,c     # drive the pipeline locally
npm run eval                                          # scored recall against live APIs
npm run eval -- --diff                                # compare to the committed baseline
npm run eval -- --case json-viewer                    # iterate on one case
```

`npm run check` is the fast loop for search-quality work — it prints
per-source counts, any source failures, and the ranked candidates without
needing an agent session.

`npm run eval` hits live GitHub/npm/PyPI and is deliberately **not** part of
`npm test`: upstream ranking drifts for reasons unrelated to this code, and
a flaky merge gate gets ignored, then disabled, then deleted. It runs
weekly in CI instead.

Running the published `dist/` needs Node 18+. Running the test suite needs
Node 22.6+, which strips TypeScript from `.test.ts` files natively.

## Known gaps

PyPI coverage is name-guessing rather than real search (no such API
exists), the maintained-vs-abandoned check is recency-only, GitHub's index
under-serves very small repos, and keyword choice remains fragile in ways a
single wrong synonym can expose.

All of it is documented with the evidence in
**[docs/findings.md](docs/findings.md)**, along with the eval methodology
and a trap worth knowing about rate limits silently corrupting scores.

## License

MIT
