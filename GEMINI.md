# GEMINI.md — Project Context & Agent Guidelines for `reuse-before-generate`

This file provides workspace context, architecture rules, and current audit state for AI assistants (Gemini / Antigravity) working in this repository.

---

## 1. Project Mission & Core Philosophy

**`reuse-before-generate`** is an MCP server tool (`check_before_building`) built to prevent AI coding agents from blindly scaffolding new projects or substantial modules from scratch when maintained open-source projects or competing products already exist.

- **Key Insight**: AI pair-programmers often validate redundant user ideas ("Great idea! Let me build a pet health app from scratch!"). This tool intercepts the workflow before code generation begins, searching GitHub, npm, crates.io, GitLab, Show HN, and Tavily web search.
- **Output Structure**: Deliberately separates returned evidence into two distinct sections:
  1. `Projects you could reuse` (open-source repositories, packages, building blocks)
  2. `Products you would compete with` (commercial product homepages & SaaS evidence)
- **Lean Discovery Architecture**: Telemetry, energy tracking, and persistent install ID tracking have been completely stripped from the codebase to keep the server lean, fast, and 100% focused on pure candidate discovery.

---

## 2. Git & Repository Management Rules

> [!IMPORTANT]
> **Private Default Remote**: Future updates must NOT be pushed to the public repository by default.
> All development commits MUST be pushed to the private repository (`origin`).

- **Default Remote (`origin`)**: `https://github.com/aradar46/reuse-before-generate-private.git` (Private Repository)
  - All development, commits, and new versions beyond the v0.10.0 public baseline are strictly private and MUST be pushed to `origin`.
- **Public Baseline Remote (`public`)**: `https://github.com/aradar46/reuse-before-generate.git` (Public Repository)
  - Contains open-source v0.10.0 baseline (git release v0.2.3 tag). Do NOT push to `public` without explicit user instructions.

---

## 3. Installed MCP Configuration

Registered in Antigravity IDE configuration at `/home/adr/.gemini/antigravity-ide/mcp_config.json`:

```json
{
  "mcpServers": {
    "reuse-before-generate": {
      "command": "node",
      "args": [
        "/home/adr/Syncthing/Projects/Personal/reuse-before-generate/dist/index.js"
      ],
      "env": {}
    }
  }
}
```

### Environment Variables & Credentials

- `GITHUB_TOKEN`: Obtained via `gh auth token` CLI for authenticated rate limits (30 req/min).
- `TAVILY_API_KEY`: Configured (`tvly-dev-...`) for Tavily web search to discover commercial SaaS products.

---

## 4. Audit & Benchmark Performance (v0.10.0)

### 20-Case Official Benchmark ([audit/0.10.0-external-2026-07-24-tavily/](file:///home/adr/Syncthing/Projects/Personal/reuse-before-generate/audit/0.10.0-external-2026-07-24-tavily/))

- **Reuse Recall @ 5**: **90.00%** (18/20 expected open-source targets found in top 5).
- **Competition Recall @ 5**: **41.18%** (7/17 commercial product targets found).
- **Combined Strict Precision @ 5**: **98.44%** (Zero noise / listicle candidates in top 5).
- **Average Retrieval Latency**: **~5.4s / call** with web search active.

### Realistic User Idea Audit ([audit/isolated-audit/](file:///home/adr/Syncthing/Projects/Personal/reuse-before-generate/audit/isolated-audit/))

Validated across 5 user scenarios:

1. *Pet Health Tracker*: Identified `knokvik/PetTrove` & `cocohub-main`.
2. *Period Tracker App*: Identified `J-shw/Menstrudel` (97★) & `ovumcy/ovumcy-web` (79★).
3. *Expense Tracker CLI*: Identified plain-text accounting modules.
4. *Bookmark Service*: Identified self-hosted bookmark archivers.
5. *Markdown PKM Engine*: Identified Markdown backlink indexers.

---

## 5. Development Workflow for AI Agents

1. **Build Step**: Always run `npm run build` after editing TypeScript source files in `src/`.
2. **Testing**: Run unit and eval tests via `npm test`.
3. **Commit & Push**: Push changes to `origin` (`git push -u origin HEAD`).
4. **Update Context**: Keep `GEMINI.md` updated whenever new benchmarks, features, or configurations are added.
