# reuse-before-generate

[![npm](https://img.shields.io/npm/v/reuse-before-generate)](https://www.npmjs.com/package/reuse-before-generate)
[![license](https://img.shields.io/npm/l/reuse-before-generate)](LICENSE)
[![reuse-before-generate MCP server](https://glama.ai/mcp/servers/aradar46/reuse-before-generate/badges/score.svg)](https://glama.ai/mcp/servers/aradar46/reuse-before-generate)

### *Your idea probably already exists. Find out before you build it, not after.*

When you ask an AI coding assistant to build an app or module, it overenthusiastically starts scaffolding thousands of lines of code from scratch—even when battle-tested open-source libraries or maintained tools already exist.

`reuse-before-generate` is a zero-dependency MCP server (and CLI tool) that intercepts the AI workflow before code generation begins. It searches public code and package indexes across multiple angles, formats results as structured Markdown, and directs the AI to search the web for existing SaaS products and community discussions.

### Sources checked

The server checks these sources in parallel:

| Source | What it searches |
| --- | --- |
| GitHub | Public repositories |
| GitLab | Public projects |
| npm | JavaScript packages |
| crates.io | Rust crates |
| NuGet | .NET packages |
| Hugging Face | Public models |
| Docker Hub | Public container images |
| Maven Central | Java artifacts |
| RubyGems | Ruby gems |
| Packagist | PHP packages |

All added sources use public endpoints and do not require API keys. They are queried on a best-effort basis: if one source is unavailable or rate-limited, results from the other sources are still returned. A GitHub token is optional and only raises GitHub's search rate limit.

---

## Quick Start & Installation

No API keys required to start.

### 1. Claude Code CLI

```bash
claude mcp add -s user reuse-before-generate -- npx -y reuse-before-generate
```

---

### 2. Cursor, Claude Desktop, Antigravity, Windsurf, or VS Code

Add this to your `mcpServers` configuration (e.g. `~/.claude/mcp.json`, `~/.gemini/antigravity-ide/mcp_config.json`, or Cursor settings):

```json
{
  "mcpServers": {
    "reuse-before-generate": {
      "command": "npx",
      "args": ["-y", "reuse-before-generate@latest"]
    }
  }
}
```

#### Optional: Higher GitHub API Limits

You can optionally pass a GitHub token to raise GitHub's rate limits:

```json
{
  "mcpServers": {
    "reuse-before-generate": {
      "command": "npx",
      "args": ["-y", "reuse-before-generate@latest"],
      "env": {
        "GITHUB_TOKEN": "ghp_your_token_here"
      }
    }
  }
}
```

---

### 3. Run Directly in Terminal (CLI Mode)

You can run searches directly from your shell without an MCP client:

```bash
npx reuse-before-generate "terminal markdown viewer"
# or if cloned locally:
node index.js "gnome speech to text offline"
```

---

### 4. Slash Command / Agent Skill

In supported AI coding assistants (Antigravity, Claude Code), you can invoke it directly via slash command:

```text
/reuse-before-generate <project description or keywords>
```

---

## 🤖 Make It Automatic for AI Agents

To ensure your AI assistant checks for existing solutions **before writing code**, add this instruction to your `CLAUDE.md`, `.cursorrules`, `GEMINI.md`, or `AGENTS.md`:

```markdown
Before scaffolding a new project or substantial new module from scratch:
1. Call `check_before_building` (or `reuse_before_generate`) from the `reuse-before-generate` MCP server.
2. Follow up with web search for existing commercial products or self-hosted tools as directed by the tool.
3. Present existing alternatives in a concise table and ask the user whether to reuse or extend an existing project instead of building from scratch.
```


---

## 🤖 AI Disclosure

For details on how AI is used in this project, see [What I delegate to AI and what I don't](https://aradar.top/posts/what-i-delegate-to-ai-and-what-i-dont/).

---

## License

[MIT](LICENSE)
