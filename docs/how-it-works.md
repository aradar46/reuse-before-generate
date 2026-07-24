# How it works

The technical detail behind the one-paragraph summary in the README.

## The pipeline

1. **Plan** (`src/query-plan.ts`) — normalizes category, outcome, synonyms,
   optional must-have constraints, ordered priorities, and an optional artifact type
   (`application`, `service`, `cli`, or `library`) supplied by the calling
   agent. Older clients fall back to conservative artifact inference.
   Ecosystem detection uses only explicit Python, Rust, Ruby, PHP, or JVM
   signals.
2. **Search** (`src/search.ts`) — executes a bounded plan. GitHub requests
   share one rate-aware scheduler and are serialized across tool calls.
   GitHub gets at most four diverse queries (category, synonym, constraint or
   outcome, and `stars:0..3`); GitLab gets category and outcome; Show HN gets
   at most three; and optional Tavily web discovery gets separate
   reusable-project and existing-product queries shaped by artifact type and
   up to three must-have constraints. Application plans that explicitly
   mention Android or iOS add a domain-restricted F-Droid or App Store
   distribution query, for a maximum of four bounded Tavily requests. GitHub
   release metadata is fetched for at most five leading repository candidates.
   npm gets at most two unique
   formulations for library and CLI requests, and is skipped for applications
   and services. npm uses category and synonym formulations, not the free-form
   outcome. An explicit Python plan adds one
   `language:python` GitHub query. Rust, Ruby, PHP, or JVM adds one matching
   registry query. Duplicate or empty formulations can reduce these counts;
   nothing expands them.
3. **Canonicalize and fuse** (`src/canonicalize.ts`, `src/fusion.ts`) —
   removes tracking parameters, fragments, trailing slashes, `.git`, and
   `www.` differences before merging observations. Evidence is deduplicated
   by source, source ID, and query. Rankings are combined with
   reciprocal-rank fusion: `retrieval score = Σ 1 / (60 + rank)`. A
   source/query contributes only its best valid rank.
   GitHub homepage metadata joins official product pages to their repository
   identity. Tavily page content is also inspected for GitHub or GitLab
   source links. Explicit source/repository labels and canonical/official
   context outrank mirrors, build metadata, and site-template links. A project with direct
   market evidence can appear in both pools: reusable code and a product the
   proposal would compete with.
4. **Separate and verify** (`src/verify.ts`) — repository and package
   evidence goes to **Projects you could reuse** and must be unarchived with
   activity in the last year. Existing product evidence—including
   open-source products that also appear in the reuse pool—goes to
   **Products you would compete with** and is not subjected to repository
   maintenance checks it cannot satisfy. These are evidence pools, not a
   semantic verdict that the proposal is duplicated.
5. **Prescore, re-rank, and report** (`src/relevance.ts`, `src/rerank.ts`,
   `src/report.ts`) — applies a deterministic, inspectable ranking correction
   for intent coverage, lane agreement, artifact fit, and common retrieval
   noise. Reuse ranking reserves top-five capacity for semantic fit,
   established authority, and a low-star niche result without treating stars
   as relevance. Repository size distinguishes substantial repositories from
   minimal shells without claiming that size proves implementation quality;
   minimal application, service, and CLI repositories are demoted rather than
   treated as reusable architecture. Article-like web pages move behind
   direct product evidence. The evidence passed to the
   caller is capped at 5 reuse and 5 competition candidates after ranking,
   with at most 2 source-diverse evidence items per candidate. It returns
   repository substance, application distribution evidence, and
   claimed/unknown constraint evidence with the ranking signals. Constraint
   scoring uses those same per-evidence claims rather than a second aggregate
   matcher. The calling agent judges functional overlap,
   reuse readiness, maturity, and confidence separately rather than producing
   a single numeric score. Coverage separately names searched, unavailable,
   and failed sources.

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
pretending to eliminate it.

## Environment variables

No credential is required. The variables improve normal discovery:

| Variable           | Effect                                                                                                                                                                                                               |
| ------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `GITHUB_TOKEN`   | Raises GitHub's search rate limit from 10/min to 30/min. Worth setting.                                                                                                                                              |
| `TAVILY_API_KEY` | Enables two bounded Tavily web searches so reusable projects and competing products outside developer indexes can surface separately, plus up to two application distribution lanes when Android or iOS is explicit. |

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


Running the published `dist/` needs Node 18+. Running the test suite needs
Node 22.6+, which strips TypeScript from `.test.ts` files natively.
