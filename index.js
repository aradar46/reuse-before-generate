#!/usr/bin/env node
import readline from "node:readline";

// Clean conversational filler words if user/AI passes raw sentence
function cleanQuery(text) {
  return text
    .replace(/\b(i want to make|i want to build|how to build|build a|build an|create a|create an|a tool that|an app for|an app that|a library for|that does|that do)\b/gi, "")
    .replace(/[^\w\s-]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

// Search GitHub
async function searchGitHub(query) {
  try {
    const headers = {
      "User-Agent": "reuse-before-generate",
      Accept: "application/vnd.github+json",
    };
    const token = process.env.GITHUB_TOKEN?.trim();
    if (token) headers.Authorization = `Bearer ${token}`;

    const url = `https://api.github.com/search/repositories?q=${encodeURIComponent(query)}&sort=stars&order=desc&per_page=5`;
    const res = await fetch(url, { headers, signal: AbortSignal.timeout(6000) });
    if (!res.ok) return [];
    const data = await res.json();
    return data.items || [];
  } catch {
    return [];
  }
}

// Search npm
async function searchNpm(query) {
  try {
    const url = `https://registry.npmjs.org/-/v1/search?text=${encodeURIComponent(query)}&size=3`;
    const res = await fetch(url, { signal: AbortSignal.timeout(5000) });
    if (!res.ok) return [];
    const data = await res.json();
    return (data.objects || []).map((o) => o.package);
  } catch {
    return [];
  }
}

// Search crates.io
async function searchCrates(query) {
  try {
    const headers = { "User-Agent": "reuse-before-generate" };
    const url = `https://crates.io/api/v1/crates?q=${encodeURIComponent(query)}&per_page=3`;
    const res = await fetch(url, { headers, signal: AbortSignal.timeout(5000) });
    if (!res.ok) return [];
    const data = await res.json();
    return data.crates || [];
  } catch {
    return [];
  }
}

// Combined Multi-Query Search & Markdown Formatter
async function handleSearch(args = {}) {
  // Extract all query angles
  let queryList = [];

  if (Array.isArray(args.queries) && args.queries.length > 0) {
    queryList = args.queries.map((q) => String(q).trim()).filter(Boolean);
  } else {
    const raw = (args.query || args.description || "").trim();
    const cleaned = cleanQuery(raw);
    const keywords = Array.isArray(args.keywords)
      ? args.keywords.join(" ")
      : typeof args.keywords === "string"
      ? args.keywords
      : "";

    if (cleaned) queryList.push(cleaned);
    if (keywords) queryList.push(keywords);
    if (cleaned && keywords && cleaned !== keywords) {
      queryList.push(`${cleaned} ${keywords}`);
    }
  }

  // Deduplicate queries
  queryList = [...new Set(queryList)].filter(Boolean);

  if (queryList.length === 0) {
    return "Please provide at least one search query or project description.";
  }

  // Run all queries across GitHub, npm, and crates.io in parallel
  const searchPromises = queryList.flatMap((q) => [
    searchGitHub(q),
    searchNpm(q),
    searchCrates(q),
  ]);

  const rawResults = await Promise.all(searchPromises);

  // Group and deduplicate results
  const repos = new Map();
  const packages = new Map();
  const crates = new Map();

  for (const item of rawResults.flat()) {
    if (!item) continue;
    if ("full_name" in item && item.html_url) {
      if (!repos.has(item.full_name)) repos.set(item.full_name, item);
    } else if ("name" in item && "version" in item) {
      if (!packages.has(item.name)) packages.set(item.name, item);
    } else if ("name" in item && "downloads" in item) {
      if (!crates.has(item.name)) crates.set(item.name, item);
    }
  }

  // Sort GitHub repos by stars descending
  const sortedRepos = Array.from(repos.values()).sort(
    (a, b) => (b.stargazers_count || 0) - (a.stargazers_count || 0)
  );

  const sections = [];

  // 1. GitHub Repositories
  if (sortedRepos.length > 0) {
    const repoLines = sortedRepos.slice(0, 8).map((repo) => {
      const stars = (repo.stargazers_count || 0).toLocaleString();
      const lang = repo.language ? ` • ${repo.language}` : "";
      const updated = repo.updated_at ? ` • Updated ${repo.updated_at.slice(0, 10)}` : "";
      const desc = repo.description ? `\n  ${repo.description}` : "";
      return `- **[${repo.full_name}](${repo.html_url})** (★ ${stars}${lang}${updated})${desc}`;
    });
    sections.push(`### 📦 GitHub Repositories\n${repoLines.join("\n")}`);
  }

  // 2. Package Registries (npm & crates.io)
  const pkgLines = [];
  for (const pkg of packages.values()) {
    const url = pkg.links?.npm || `https://www.npmjs.com/package/${pkg.name}`;
    const desc = pkg.description ? `\n  ${pkg.description}` : "";
    pkgLines.push(`- **[npm: ${pkg.name}](${url})** (v${pkg.version || "latest"})${desc}`);
  }
  for (const crate of crates.values()) {
    const url = `https://crates.io/crates/${crate.name}`;
    const desc = crate.description ? `\n  ${crate.description}` : "";
    const downloads = (crate.downloads || 0).toLocaleString();
    pkgLines.push(`- **[crate: ${crate.name}](${url})** (${downloads} downloads)${desc}`);
  }

  if (pkgLines.length > 0) {
    sections.push(`### 📚 Ecosystem Packages\n${pkgLines.slice(0, 6).join("\n")}`);
  }

  // 3. High-Priority AI Deep Web Search Directive
  const primary = queryList[0];
  const secondary = queryList[1] || primary;

  const webQueries = [
    `best ${primary} open source OR self-hosted`,
    `best ${primary} tools software site:reddit.com OR site:news.ycombinator.com`,
    `awesome ${primary}`,
    secondary !== primary ? `${secondary} alternative tools` : `${primary} CLI tool app`,
  ];

  const webSearchSection =
    `### 🌐 REQUIRED: AI Deep Web Search (Discussions, Niche Tools, Awesome Lists & SaaS)\n` +
    `*AI Agent Instructions: Perform a deep web search now with maximum effort using your built-in search tool to uncover hard-to-surface tools, community recommendations (Reddit / Hacker News), GitLab/Codeberg projects, awesome-lists, and commercial/self-hosted alternatives:*\n` +
    webQueries.map((wq) => `- \`${wq}\``).join("\n");

  sections.push(webSearchSection);

  const mainQuery = queryList.join(", ");
  return (
    `## Existing Alternatives for [${mainQuery}]\n\n` +
    `*Review these existing implementations before writing new code:*\n\n` +
    sections.join("\n\n")
  );
}

// MCP JSON-RPC Server Setup
const toolSchema = {
  type: "object",
  properties: {
    queries: {
      type: "array",
      items: { type: "string" },
      description:
        "RECOMMENDED: 2-4 distinct technical search queries / keywords maintainers would use (e.g. ['gnome speech to text', 'gnome whisper dictation', 'linux offline voice typing']).",
    },
    query: {
      type: "string",
      description: "Search query or project description",
    },
    description: {
      type: "string",
      description: "Description of what you want to build",
    },
    keywords: {
      description: "Optional search keywords",
      oneOf: [
        { type: "array", items: { type: "string" } },
        { type: "string" },
      ],
    },
  },
};

const tools = [
  {
    name: "check_before_building",
    description:
      "Run before building from scratch. Searches GitHub, npm, and crates.io across multiple query angles to find existing codebases, and provides targeted web search queries for finding commercial SaaS competitors.",
    inputSchema: toolSchema,
  },
  {
    name: "reuse_before_generate",
    description:
      "Run before building from scratch. Searches GitHub, npm, and crates.io across multiple query angles to find existing codebases, and provides targeted web search queries for finding commercial SaaS competitors.",
    inputSchema: toolSchema,
  },
];

function sendJson(obj) {
  process.stdout.write(JSON.stringify(obj) + "\n");
}

async function handleMessage(msg) {
  if (!msg || typeof msg !== "object") return;
  const { id, method, params } = msg;

  if (method === "initialize") {
    sendJson({
      jsonrpc: "2.0",
      id,
      result: {
        protocolVersion: "2024-11-05",
        capabilities: { tools: {} },
        serverInfo: { name: "reuse-before-generate", version: "2.0.0" },
      },
    });
    return;
  }

  if (method === "notifications/initialized") {
    return;
  }

  if (method === "ping") {
    sendJson({ jsonrpc: "2.0", id, result: {} });
    return;
  }

  if (method === "tools/list") {
    sendJson({ jsonrpc: "2.0", id, result: { tools } });
    return;
  }

  if (method === "tools/call") {
    const { name, arguments: args = {} } = params || {};
    if (name === "check_before_building" || name === "reuse_before_generate") {
      const text = await handleSearch(args);
      sendJson({
        jsonrpc: "2.0",
        id,
        result: {
          content: [{ type: "text", text }],
        },
      });
      return;
    }
    sendJson({
      jsonrpc: "2.0",
      id,
      error: { code: -32601, message: `Tool not found: ${name}` },
    });
    return;
  }

  if (id !== undefined) {
    sendJson({
      jsonrpc: "2.0",
      id,
      error: { code: -32601, message: `Method not found: ${method}` },
    });
  }
}

// Direct CLI mode if arguments are passed
const cliArgs = process.argv.slice(2).join(" ").trim();
if (cliArgs && cliArgs !== "--help" && cliArgs !== "-h") {
  const result = await handleSearch({ query: cliArgs });
  console.log(result);
  process.exit(0);
} else if (cliArgs === "--help" || cliArgs === "-h") {
  console.log(
    "Usage:\n  node index.js [query]       # Run search directly in terminal\n  node index.js               # Start MCP server over stdio"
  );
  process.exit(0);
}

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
  terminal: false,
});

rl.on("line", (line) => {
  const trimmed = line.trim();
  if (!trimmed) return;
  try {
    const msg = JSON.parse(trimmed);
    handleMessage(msg).catch((err) => {
      process.stderr.write(`Error handling message: ${err.message}\n`);
    });
  } catch (err) {
    process.stderr.write(`Failed to parse JSON-RPC line: ${err.message}\n`);
  }
});

