# How it works

The technical detail behind the one-paragraph summary in the README.

## The pipeline

1. **Search** (`src/search.ts`) — three lanes run in parallel:
   - GitHub repo search, itself two queries: a primary relevance query, plus
     a second scoped to `stars:0..3`. The second exists because GitHub's
     ranking structurally buries near-zero-star repos once they compete
     against anything popular — and a brand-new repo doing exactly your job
     is the most useful duplicate to catch.
   - npm registry search.
   - A Python lane: GitHub scoped to `language:python`. The language filter
     shrinks the result pool enough that small repos rank on merit.

2. **Verify** (`src/verify.ts`) — drops archived repos and anything with no
   activity in the last year. It deliberately does **not** filter on star
   count. An earlier version required 10+ stars and was silently discarding
   real, actively-maintained 0-star matches. Star count is passed to the
   agent as a scoring signal instead of used as a gate.

3. **Re-rank prompt** (`src/rerank.ts`) — builds scoring instructions as
   plain text. Not an API call.

4. **Report** (`src/index.ts`) — returns candidates plus those instructions,
   naming any source that failed so partial results are never mistaken for
   complete ones.

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

## Why `keywords` is a required input

The tool will not run without 3-6 search terms supplied by the calling
agent. That is deliberate.

The mechanical fallback extractor is measurably weak on non-literal or
buzzword-heavy descriptions — including this project's own README, which is
full of "MCP", "agent", and "server", terms too generic to distinguish it
from unrelated MCP servers. An agent that already understood what the user
meant produces far better search terms than string-matching can.

Making the field required means that inference step cannot be silently
skipped.

The field's description also tells the agent to pick the word a *maintainer*
would use for what their tool IS, rather than the word describing the user's
problem. This is not cosmetic. A real "pretty JSON in the terminal" tool
calls itself a "viewer" or "processor", not a "pretty-printer". A real
static-site link checker says it validates "rendered HTML", not "static
site alt-text". Searching with the user's words instead of the maintainer's
is the single most common way this tool misses something real — see
[findings.md](findings.md) for the measurements.

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

## Development

```bash
npm test                                              # offline unit tests, ~1s
npm run check -- "<description>" --keywords a,b,c     # drive the pipeline locally
npm run eval                                          # scored recall against live APIs
npm run eval -- --diff                                # compare to the committed baseline
npm run eval -- --case json-viewer                    # iterate on one case
```

`npm test` is 71 offline checks that the code does what it claims. It runs
in about a second and gates every PR.

`npm run check` is the fast loop for search-quality work — per-source
counts, any failures, and the ranked candidates, without needing an agent
session.

`npm run eval` is a different question: not "is it broken" but "is it any
good". It runs 12 known cases (e.g. "find gitleaks from a description of a
secret scanner") and reports the rank the right answer came back at.
Deliberately **not** part of `npm test`, because it depends on live GitHub
ranking that drifts for reasons unrelated to this code. It runs weekly in
CI instead. Set `GITHUB_TOKEN` before running it — unauthenticated runs get
rate-limited, and a 403 scores identically to a genuine miss.

Running the published `dist/` needs Node 18+. Running the test suite needs
Node 22.6+, which strips TypeScript from `.test.ts` files natively.
