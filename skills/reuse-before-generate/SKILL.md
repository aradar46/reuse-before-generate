---
name: reuse-before-generate
description: Check for existing open-source repositories, packages, models, container images, and SaaS competitors before building from scratch. Trigger on /reuse-before-generate or whenever checking existing alternatives.
---

# Reuse Before Generate

Intercept new project scaffolding to discover existing open-source codebases, ecosystem packages, and commercial alternatives.

## Workflow

1. **Generate 2–4 Technical Query Angles**:
   Convert the user's request into precise technical keywords maintainers use (e.g. `["gnome speech to text", "gnome whisper dictation", "linux offline voice typing"]`).

2. **Query Code Registries**:
   Call the `check_before_building` MCP tool from `reuse-before-generate`:
   ```json
   {
     "queries": ["query 1", "query 2", "query 3"]
   }
   ```
   - **If MCP tool (`check_before_building`) is available:**
     Call `check_before_building` with the generated queries:
     ```json
     {
       "queries": ["query 1", "query 2", "query 3"]
     }
     ```
   - **If MCP is NOT installed:**
     1. Prompt the user briefly with how to install it and refresh:
        > 💡 *`reuse-before-generate` MCP is not installed. To add it, put this in your MCP configuration and restart your session:*
        > ```json
        > "reuse-before-generate": {
        >   "command": "npx",
        >   "args": ["-y", "reuse-before-generate@latest"]
        > }
        > ```
     2. In the meantime, run CLI fallback (`npx -y reuse-before-generate "..."`) or targeted web searches (`site:github.com ...`) to continue answering.

3. **Execute Deep Web Search**:
   Use built-in web search to check for:
   - Commercial SaaS products and hosted services
   - Reddit / Hacker News discussions and comparisons
   - Self-hosted / indie tools and awesome-lists

4. **Present Findings & Recommendation**:
   - Table of top open-source projects (GitHub, GitLab, crates, npm, etc.)
   - Table of commercial / SaaS alternatives
   - Clear recommendation: whether to reuse, extend, or build from scratch.

