# reuse-before-generate

[![npm](https://img.shields.io/npm/v/reuse-before-generate)](https://www.npmjs.com/package/reuse-before-generate)
[![CI](https://github.com/aradar46/reuse-before-generate/actions/workflows/ci.yml/badge.svg)](https://github.com/aradar46/reuse-before-generate/actions/workflows/ci.yml)
[![license](https://img.shields.io/npm/l/reuse-before-generate)](LICENSE)

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
and it looks first:

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

## Install

No API key. No account. Nothing to configure.

```bash
claude mcp add reuse-before-generate -- npx -y reuse-before-generate
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

**Optional but recommended:** add a GitHub token. Without one, GitHub limits
you to 10 searches a minute; with one, 30.

```json
{
  "mcpServers": {
    "reuse-before-generate": {
      "command": "npx",
      "args": ["-y", "reuse-before-generate"],
      "env": { "GITHUB_TOKEN": "ghp_your_token_here" }
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

It's measured, not vibes. There are 12 test cases with known right answers
— "find `gitleaks` from a description of a secret scanner", that sort of
thing — and the search is scored on what position the right answer comes
back at.

Current scores:

| | |
|---|---|
| Found the right tool in the top 10 | **11 of 11** |
| Found it in the top 5 | 10 of 11 |
| Made something up when nothing existed | never |

The last row matters most. A tool that reports matches for everything is
useless, so one test case describes something no real tool does. It
correctly returns nothing.

Details, including where it still fails, are in
**[docs/findings.md](docs/findings.md)**.

## Settings

There's one setting worth knowing about: **`GITHUB_TOKEN`**. Without it
GitHub allows 10 searches a minute, with it 30. Set it in the `env` block
shown in [Install](#install).

It also keeps a local count of its own usage in
`~/.reuse-before-generate/events.jsonl` — a random ID, a timestamp, and how
many results came back. Nothing is sent anywhere. See
[local state](docs/how-it-works.md#local-state) to read or disable it, and
[all environment variables](docs/how-it-works.md#environment-variables) for
the rest.

## Where it still falls short

Honest list, because you'll hit these:

- **Bad search terms miss real tools.** If you describe a JSON viewer as a
  "pretty-printer", it may find nothing — real ones call themselves
  "viewers". The agent is told to think about how a maintainer would
  describe their own tool, but it doesn't always get it right.
- **Very small or oddly-named repos are hard to find.** GitHub's own search
  buries them. There's a dedicated search lane for this and it helps, but
  doesn't fully solve it.
- **"Maintained" just means "touched in the last year."** It doesn't check
  whether issues get answered or whether the project is actually healthy.

All measured and written up in [docs/findings.md](docs/findings.md).

## More

- [How it works](docs/how-it-works.md) — the pipeline, and why the server
  never calls an LLM itself
- [Findings](docs/findings.md) — what's been measured, and what's still broken
- [Contributing](docs/how-it-works.md#development) — tests, local CLI, eval

## License

MIT
