# reuse-before-generate

[![npm](https://img.shields.io/npm/v/reuse-before-generate)](https://www.npmjs.com/package/reuse-before-generate)
[![CI](https://github.com/aradar46/reuse-before-generate/actions/workflows/ci.yml/badge.svg)](https://github.com/aradar46/reuse-before-generate/actions/workflows/ci.yml)
[![license](https://img.shields.io/npm/l/reuse-before-generate)](LICENSE)
[![reuse-before-generate MCP server](https://glama.ai/mcp/servers/aradar46/reuse-before-generate/badges/score.svg)](https://glama.ai/mcp/servers/aradar46/reuse-before-generate)

**Your idea probably already exists. Find out before you build it, not after.**

Here is how it usually goes. You have an idea. You ask a frontier model
what it thinks, and it tells you the space is wide open and people would
love it. So you tell your agent to build it, and it writes thousands of
lines for something that already exists.

That happened to me. I kept hitting the same failing Android CI build,
waiting for a re-run, hitting it again. I thought: someone should be able
to pause the build and get a shell inside it. I asked an AI, it told me
this was a genuinely good idea, and I built
[fermata](https://github.com/aradar46/fermata).

Then I found `action-tmate`. 3,566 stars. Does exactly that. Has for years.

This server is the check I wish I'd run. Ask your agent to build something
and it looks first. The response deliberately has two sections:

- **Projects you could reuse** — maintained open-source repositories and
  packages that may be worth adopting or extending.
- **Products you would compete with** — commercial or product evidence that
  may validate the market, change the positioning, or save a duplicate build.

Those are retrieval pools, not verdicts. The calling agent compares the
actual capabilities and explains whether anything is genuinely equivalent.

> Before building — this already exists:
>
> 1. **action-tmate** (3,566★, updated today) — "Debug your GitHub Actions
>    via SSH by using tmate to get access to the runner system itself."
>
> Actively maintained and widely used. Want to try it, or is there
> something yours would do differently?

Sometimes the answer really is "mine is different, keep going." Sometimes
it saves you a weekend. Either way you find out in ten seconds instead of
after.

Why bother: fewer wasted hours, fewer abandoned projects nobody uses, and
less energy burned generating code that already exists. Jenna Pederson put
the general case well in [*You Can Build It, But Should
You?*](https://dev.to/jennapederson/you-can-build-it-should-you-9e0) — AI
removed the friction that used to force you to ask whether something is
worth building at all.

For the record, this tool did not survive its own test either!
But I had to build it to find out. Hopefully it will prevent me from doing it again.

## What it searches

One bounded plan searches GitHub, npm, GitLab, Show HN and, when the
ecosystem is explicit, crates.io, RubyGems, Packagist, Maven Central, or a
Python-specific repository lane. These sources are keyless. Optional Tavily
search broadens discovery beyond developer indexes so both reusable projects
and existing products can surface.

The agent may supply three optional formulations: a category name, the
outcome the tool should achieve, and alternative terminology. The planner
uses a fixed number of requests; formulations do not create an unbounded
search loop.

Every response includes **Search coverage**, naming both searched and
unavailable sources. An empty result is reported cautiously: it means no
strong candidate was retrieved from the available sources, not that the
idea is unique or safe to build without further research.

## Install

No API key is required. Optional credentials improve coverage and throughput.

```bash
claude mcp add reuse-before-generate -- npx -y reuse-before-generate

```
or install it to user scope so it loads everywhere:
```bash
# claude mcp remove reuse-before-generate
claude mcp add -s user reuse-before-generate -- npx -y reuse-before-generate
```

Then start a **new** session and try it on an idea of your own — the one
you were about to build.

Or add it to `.mcp.json` yourself — this works in Cursor, Claude Desktop,
and any other MCP client:

```json
{
  "mcpServers": {
    "reuse-before-generate": {
      "command": "npx",
      "args": ["-y", "reuse-before-generate"]
    }
  }
}
```

**Optional but recommended:** add a fine-grained GitHub token and a Tavily
key. The GitHub token raises search throughput; Tavily adds web discovery.
Keep secrets in your MCP client's environment configuration, not in prompts.

```json
{
  "mcpServers": {
    "reuse-before-generate": {
      "command": "npx",
      "args": ["-y", "reuse-before-generate"],
      "env": {
        "GITHUB_TOKEN": "github_pat_your_token_here",
        "TAVILY_API_KEY": "tvly_your_key_here"
      }
    }
  }
}
```

### Running from source

```bash
git clone https://github.com/aradar46/reuse-before-generate
cd reuse-before-generate
npm install && npm run build
claude mcp add reuse-before-generate -- node "$PWD/dist/index.js"
```

## Make it automatic

By default your agent only checks when you ask it to. To make it check
every time, paste this into your `CLAUDE.md` (or `.cursorrules`):

```markdown
Before scaffolding a new project or a substantial new module, call
`check_before_building` first. If it finds a maintained alternative that
really does the job, tell me about it and ask whether to extend that
instead of building from scratch.
```

That one paragraph is the whole point of the tool. Without it, the check
only happens when you remember to ask.

## Does it actually work?

It's measured, not vibes. There are live cases with known right answers
— "find `gitleaks` from a description of a secret scanner", that sort of
thing — and separate commercial-product cases. Reuse and competition recall
are scored independently. One deliberately absurd case records how many
candidates retrieval returned; it is not mislabeled as a semantic
false-positive test because the server does not make the final relevance
judgment.

Details, including where it still fails, are in
**[docs/findings.md](docs/findings.md)**.

## Settings

The optional settings are **`GITHUB_TOKEN`** and **`TAVILY_API_KEY`**.
GitHub authentication improves repository-search throughput. Tavily adds one
bounded web query per check; without it, coverage reports web as unavailable
rather than failed. Set either or both in the `env` block shown in
[Install](#install).

It also keeps a local count of its own usage in
`~/.reuse-before-generate/events.jsonl` — a random ID, a timestamp, and how
many results came back. Nothing is sent anywhere. See
[local state](docs/how-it-works.md#local-state) to read or disable it, and
[all environment variables](docs/how-it-works.md#environment-variables) for
the rest.

## Where it still falls short

Honest list, because you'll hit these:

- **Retrieval is lexical.** The three formulations reduce wording
  sensitivity, but a product or project can still use terminology none of
  them covers.
- **Very small or oddly-named repos are hard to find.** GitHub's own search
  buries them. There's a dedicated search lane for this and it helps, but
  doesn't fully solve it.
- **"Maintained" just means "touched in the last year."** It doesn't check
  whether issues get answered or whether the project is actually healthy.
- **Web search is optional.** Without `TAVILY_API_KEY`, coverage reports it
  as unavailable. Upstream errors are reported separately as failures.

All measured and written up in [docs/findings.md](docs/findings.md).

## More

- [How it works](docs/how-it-works.md) — the pipeline, and why the server
  never calls an LLM itself
- [Findings](docs/findings.md) — what's been measured, and what's still broken
- [Contributing](docs/how-it-works.md#development) — tests, local CLI, eval

## License

MIT
