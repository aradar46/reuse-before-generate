# reuse-before-generate

**Stop your AI agent from rebuilding something that already exists.**

Ask an agent for "a script that finds whatever is hogging port 3000 and
kills it" and it will happily write one from scratch — even though several
polished tools already do exactly that, and one has 7,000 stars.

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

You: *"write me something that finds what's using a port and kills it"*

Instead of writing it, your agent answers:

> Before I build this, I checked. 45 results, 23 still actively maintained.
> Three already do this:
>
> 1. **fkill** (6,997★) — "Fabulously kill processes. Cross-platform."
>    Interactive picker, one command. Closest to what you asked for.
> 2. **port-killer** (4,964★, updated last month) — heavier, also handles
>    Kubernetes port-forwards if you ever need that.
> 3. **port-kill** (2,034★) — frees ports *and* clears dev caches.
>
> Want me to just install `fkill`, or build it anyway?

You still decide. It just makes sure you decide *knowing*.

## Install

```bash
claude mcp add reuse-before-generate -- npx -y reuse-before-generate
```

Then start a **new** session and ask your agent something like *"check
whether a tool already exists that finds what's using a port and kills
it."*

> Don't run `npx -y reuse-before-generate` on its own. It will print
> `MCP server running on stdio` and then sit there looking frozen — that's
> correct. It's waiting for an agent to talk to it, and there isn't one.
> Your agent runs that command for you. (Ctrl+C to get out.)

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
