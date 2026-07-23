# How it works

The technical detail behind the one-paragraph summary in the README.

## The pipeline

1. **Plan** (`src/query-plan.ts`) — normalizes category, outcome, synonyms,
   optional must-have constraints, and an optional artifact type
   (`application`, `service`, `cli`, or `library`) supplied by the calling
   agent. Older clients fall back to conservative artifact inference.
   Ecosystem detection uses only explicit Python, Rust, Ruby, PHP, or JVM
   signals.

2. **Search** (`src/search.ts`) — executes a bounded plan. GitHub requests
   share one rate-aware scheduler and are serialized across tool calls.
   GitHub gets at most four diverse queries (category, synonym, constraint or
   outcome, and `stars:0..3`);
   npm gets at most two unique formulations; GitLab gets category and
   outcome; Show HN gets at most three; and optional Tavily web discovery
   gets separate reusable-project and existing-product queries. npm uses
   category and synonym formulations, not
   the free-form outcome. An explicit Python plan adds one
   `language:python` GitHub query. Rust, Ruby, PHP, or JVM adds one matching
   registry query. Duplicate or empty formulations can reduce these counts;
   nothing expands them.

3. **Canonicalize and fuse** (`src/canonicalize.ts`, `src/fusion.ts`) —
   removes tracking parameters, fragments, trailing slashes, `.git`, and
   `www.` differences before merging observations. Evidence is deduplicated
   by source, source ID, and query. Rankings are combined with
   reciprocal-rank fusion: `retrieval score = Σ 1 / (60 + rank)`. A
   source/query contributes only its best valid rank.

4. **Separate and verify** (`src/verify.ts`) — repository and package
   evidence goes to **Projects you could reuse** and must be unarchived with
   activity in the last year. Commercial and unknown product evidence goes
   to **Products you would compete with** and is not subjected to repository
   maintenance checks it cannot satisfy. These are evidence pools, not a
   semantic verdict that the proposal is duplicated.

5. **Prescore, re-rank, and report** (`src/relevance.ts`, `src/rerank.ts`,
   `src/report.ts`) — applies a deterministic, inspectable ranking correction
   for intent coverage, lane agreement, artifact fit, and common retrieval
   noise. It returns those signals with the evidence; the calling agent still
   judges functional overlap. Coverage separately names searched,
   unavailable, and failed sources.

## Why the server does not call an LLM

An earlier version called the Anthropic API directly to do the semantic
re-ranking. That meant a separate, billed API key was required even if you
were already inside a Claude Pro or Max session — API usage bills
separately from subscriptions.

So the server returns the candidates plus scoring instructions as its tool
output, and whichever agent called the tool does the judging itself, using
the session already running. Zero extra cost, works on any plan.

This is also the tool's actual differentiator. The alternative approach —
decomposing a description into bag-of-words queries — returned 290,351
"competing" repos in testing, topped by one with 383,798 stars. That is
keyword noise, not competitors. Real judgment of functional overlap needs a
model, and the calling agent already is one.

## Why keywords are required and formulations are optional

The MCP tool will not run without 3-6 search terms supplied by the calling
agent. That preserves compatibility and guarantees a usable fallback.
Category, outcome, and synonym formulations are optional, but when present
all three are required together and replace the fallback search wording.

The mechanical fallback extractor is measurably weak on non-literal or
buzzword-heavy descriptions — including this project's own README, which is
full of "MCP", "agent", and "server", terms too generic to distinguish it
from unrelated MCP servers. An agent that already understood what the user
meant produces far better search terms than string-matching can.

The planner never loops until it is satisfied and never calls an LLM
itself. It executes the fixed source budget above, records the query and
rank on every evidence item, and leaves semantic judgment in the existing
agent session.

The field's description also tells the agent to pick the word a *maintainer*
would use for what their tool IS, rather than the word describing the user's
problem. This is not cosmetic. A real "pretty JSON in the terminal" tool
calls itself a "viewer" or "processor", not a "pretty-printer". A real
static-site link checker says it validates "rendered HTML", not "static
site alt-text". Formulations reduce this wording sensitivity without
pretending to eliminate it; see [findings.md](findings.md).

## Running it directly looks like a hang

An MCP server speaks JSON-RPC over stdin and stdout. Run the command in a
terminal by itself and it prints one line, then waits:

```
$ npx -y reuse-before-generate
reuse-before-generate MCP server running on stdio
```

That is correct behaviour, not a crash. It is waiting for a client to send
it a message, and a bare terminal never does — the same way `cat` with no
arguments sits there. Ctrl+C exits.

Your MCP client runs this command for you and speaks the protocol over the
pipe. To confirm the server works without a client, send it one message:

```bash
echo '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"probe","version":"1"}}}' \
  | npx -y reuse-before-generate
```

It replies with its name and version, then exits when stdin closes.

## Local state

Everything the tool remembers lives in `~/.reuse-before-generate/`:

| File | Contents |
|---|---|
| `install-id` | One random UUID, generated on first run. |
| `events.jsonl` | One line per tool call: the install id, the event type, a timestamp, and candidate counts. |
| `energy-saved.json` | A running Wh estimate, only written when the display is enabled. |

Events record **no** descriptions, **no** keywords, **no** file paths, and
**no** query content. Inspect the file yourself — it is plain JSON lines:

```bash
cat ~/.reuse-before-generate/events.jsonl
```

Nothing is transmitted anywhere unless you set
`REUSE_BEFORE_GENERATE_TELEMETRY_URL` to your own collector. No endpoint is
bundled or defaulted. Set `REUSE_BEFORE_GENERATE_TELEMETRY_DISABLED=1` to
turn logging off entirely.

## Environment variables

No credential is required. The first two variables improve normal discovery;
the rest exist for specific situations.

| Variable | Effect |
|---|---|
| `GITHUB_TOKEN` | Raises GitHub's search rate limit from 10/min to 30/min. Worth setting. |
| `TAVILY_API_KEY` | Enables two bounded Tavily web searches so reusable projects and competing products outside developer indexes can surface separately. |
| `REUSE_BEFORE_GENERATE_TELEMETRY_DISABLED=1` | Stops writing the local usage log entirely. |
| `REUSE_BEFORE_GENERATE_TELEMETRY_URL` | POSTs each event to a collector you run. Nothing is bundled or defaulted; without this, nothing leaves the machine. |
| `REUSE_BEFORE_GENERATE_SHOW_ENERGY=1` | Appends an estimated "Wh saved" line to the tool output. Off by default, deliberately: it is an order-of-magnitude guess, and it increments as soon as a maintained candidate is found — before the agent has judged whether that candidate is actually relevant. It is not a measurement. |
| `REUSE_BEFORE_GENERATE_STATE_DIR` | Overrides `~/.reuse-before-generate` as the state location. Used by the test suite so test runs never touch real state. |

## Releasing

Four things carry a version and must move together:

1. `package.json` → `version`
2. `src/index.ts` → the `version` passed to `McpServer`
3. `server.json` → both `version` and `packages[0].version`
4. A git tag `vX.Y.Z` plus a GitHub release

Then:

```bash
npm run build && npm test
npm publish          # prepublishOnly re-runs build + tests
git tag -a vX.Y.Z -m "vX.Y.Z" && git push origin vX.Y.Z
gh release create vX.Y.Z --title "vX.Y.Z" --notes "..."
```

**The README inside a published tarball is frozen at publish time.** A
README fix only reaches the npm package page with a new version, so fix
docs *before* publishing, not after.

`server.json` describes the server for the
[official MCP registry](https://registry.modelcontextprotocol.io). The
`mcpName` field in `package.json` must match its `name` — that is how the
registry verifies the npm package and the registry entry belong to the
same owner.

## Development

```bash
npm test                                              # offline unit tests, ~1s
npm run check -- "<description>" --keywords a,b,c     # drive the pipeline locally
npm run check -- "<description>" --category "..." --outcome "..." --synonyms "..."
npm run check -- "<description>" --category "..." --outcome "..." --synonyms "..." --constraints offline,self-hosted --artifact-type application
npm run eval                                          # scored recall against live APIs
npm run eval -- --diff --save                         # compare and save one clean full run
npm run eval -- --case json-viewer                    # iterate on one case
```

`npm test` is the offline suite that gates every PR.

`npm run check` is the fast loop for search-quality work — per-source
coverage and retrieved candidates separated into reuse and competition
pools, without needing an agent session.

`npm run eval` is a different question: not "is it broken" but "is it any
good". It runs 18 known cases (e.g. "find gitleaks from a description of a
secret scanner") and reports the target rank within its expected pool.
Deliberately **not** part of `npm test`, because it depends on live upstream
ranking that drifts for reasons unrelated to this code. Set `GITHUB_TOKEN`
and optionally `TAVILY_API_KEY` before running it. A required attempted
source failure blocks baseline saving; an optional web failure is recorded
but does not. An unconfigured web source is counted as unavailable, not as
an attempted failure.

Running the published `dist/` needs Node 18+. Running the test suite needs
Node 22.6+, which strips TypeScript from `.test.ts` files natively.
