# reuse-before-generate

**Stop your AI agent from rebuilding something that already exists.**

Ask an agent to build a changelog generator and it will happily write one
from scratch — even though `git-cliff` already does it, better, and is
actively maintained.

This is an MCP server. It hands your agent one new ability —
`check_before_building` — which searches GitHub, npm, and Python repos,
throws away everything abandoned, and gives your agent the survivors to
judge.

No API key. No account. One line to install.

```bash
claude mcp add reuse-before-generate -- npx -y reuse-before-generate
```

---

## What you get

Ask your agent to build something. Instead of starting immediately, it
answers like this:

> Before I build this, I checked. 45 results, 32 still maintained. Three
> genuinely do what you described:
>
> 1. **conventional-changelog** (8,486★, updated today) — the ecosystem
>    standard. Extend this: its preset system already handles the custom
>    grouping you wanted.
> 2. **git-cliff** (12,033★, updated today) — a single fast binary, highly
>    configurable via TOML. Better fit if you don't want Node in the loop.
> 3. **changelogen** (1,252★, updated this week) — lighter, closest to the
>    minimal thing you sketched.
>
> Want me to extend one of these, or build fresh anyway?

You still decide. It just makes sure you decide *knowing*.

## Install

```bash
claude mcp add reuse-before-generate -- npx -y reuse-before-generate
```

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

That last row matters most. A tool that finds "matches" for everything is
worse than useless, so one test case describes something deliberately
absurd that no real tool does. It correctly finds nothing.

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
