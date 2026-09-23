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

// Fetch a public JSON endpoint. These sources do not require API keys.
async function fetchPublicJson(url, headers = {}) {
  try {
    const res = await fetch(url, {
      headers: {
        "User-Agent": "reuse-before-generate",
        ...headers,
      },
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
}

// Search GitLab's public project directory.
async function searchGitLab(query) {
  const url = new URL("https://gitlab.com/api/v4/projects");
  url.searchParams.set("search", query);
  url.searchParams.set("simple", "true");
  url.searchParams.set("per_page", "3");
  url.searchParams.set("order_by", "star_count");
  url.searchParams.set("sort", "desc");

  const data = await fetchPublicJson(url);
  if (!Array.isArray(data)) return [];

  return data.map((project) => ({
    source: "gitlab",
    name: project.path_with_namespace,
    url: project.web_url,
    stars: project.star_count || 0,
    description: project.description || "",
    updated: project.last_activity_at?.slice(0, 10),
  }));
}

// Search NuGet's public search service.
async function searchNuGet(query) {
  const url = new URL("https://azuresearch-usnc.nuget.org/query");
  url.searchParams.set("q", query);
  url.searchParams.set("take", "3");
  url.searchParams.set("prerelease", "true");

  const data = await fetchPublicJson(url);
  if (!Array.isArray(data?.data)) return [];

  return data.data.map((pkg) => ({
    source: "nuget",
    name: pkg.id,
    version: pkg.version || "latest",
    url: pkg.projectUrl || `https://www.nuget.org/packages/${pkg.id}`,
    description: pkg.summary || pkg.description || "",
    downloads: pkg.totalDownloads || 0,
  }));
}

// Search public Hugging Face models.
async function searchHuggingFace(query) {
  const url = new URL("https://huggingface.co/api/models");
  url.searchParams.set("search", query);
  url.searchParams.set("limit", "3");
  url.searchParams.set("sort", "downloads");
  url.searchParams.set("direction", "-1");

  const data = await fetchPublicJson(url);
  if (!Array.isArray(data)) return [];

  return data.map((model) => ({
    source: "huggingface",
    name: model.id,
    url: `https://huggingface.co/${model.id}`,
    description: model.pipeline_tag ? `Pipeline: ${model.pipeline_tag}` : "",
    downloads: model.downloads || 0,
  }));
}

// Search Docker Hub's public repository index.
async function searchDockerHub(query) {
  const url = new URL("https://hub.docker.com/v2/search/repositories/");
  url.searchParams.set("query", query);
  url.searchParams.set("page_size", "3");

  const data = await fetchPublicJson(url);
  if (!Array.isArray(data?.results)) return [];

  return data.results.map((repo) => ({
    source: "dockerhub",
    name: repo.repo_name,
    url: `https://hub.docker.com/r/${repo.repo_name}`,
    description: repo.short_description || "",
    downloads: repo.pull_count || 0,
  }));
}

// Search Maven Central's public search service.
async function searchMaven(query) {
  const url = new URL("https://search.maven.org/solrsearch/select");
  url.searchParams.set("q", query);
  url.searchParams.set("rows", "3");
  url.searchParams.set("wt", "json");

  const data = await fetchPublicJson(url);
  if (!Array.isArray(data?.response?.docs)) return [];

  return data.response.docs.map((artifact) => ({
    source: "maven",
    name: artifact.id,
    version: artifact.latestVersion || "latest",
    url: `https://central.sonatype.com/artifact/${artifact.id}`,
    description: "",
  }));
}

// Search RubyGems' public search endpoint.
async function searchRubyGems(query) {
  const url = new URL("https://rubygems.org/api/v1/search.json");
  url.searchParams.set("query", query);

  const data = await fetchPublicJson(url);
  if (!Array.isArray(data)) return [];

  return data.slice(0, 3).map((gem) => ({
    source: "rubygems",
    name: gem.name,
    version: gem.version || "latest",
    url: gem.project_uri || `https://rubygems.org/gems/${gem.name}`,
    description: gem.info || "",
    downloads: gem.downloads || 0,
  }));
}

// Search Packagist's public package index.
async function searchPackagist(query) {
  const url = new URL("https://packagist.org/search.json");
  url.searchParams.set("q", query);

  const data = await fetchPublicJson(url);
  if (!Array.isArray(data?.results)) return [];

  return data.results.slice(0, 3).map((pkg) => ({
    source: "packagist",
    name: pkg.name,
    url: pkg.url || `https://packagist.org/packages/${pkg.name}`,
    description: pkg.description || "",
    downloads: pkg.downloads || 0,
  }));
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

  // Run all queries across public sources in parallel
  const searchPromises = queryList.flatMap((q) => [
    searchGitHub(q),
    searchNpm(q),
    searchCrates(q),
    searchGitLab(q),
    searchNuGet(q),
    searchHuggingFace(q),
    searchDockerHub(q),
    searchMaven(q),
    searchRubyGems(q),
    searchPackagist(q),
  ]);

  const rawResults = await Promise.all(searchPromises);

  // Group and deduplicate results
  const repos = new Map();
  const packages = new Map();
  const crates = new Map();
  const gitlab = new Map();
  const nuget = new Map();
  const huggingface = new Map();
  const dockerhub = new Map();
  const maven = new Map();
  const rubygems = new Map();
  const packagist = new Map();

  for (const item of rawResults.flat()) {
    if (!item) continue;

    if (item.source === "gitlab") {
      if (!gitlab.has(item.name)) gitlab.set(item.name, item);
    } else if (item.source === "nuget") {
      if (!nuget.has(item.name)) nuget.set(item.name, item);
    } else if (item.source === "huggingface") {
      if (!huggingface.has(item.name)) huggingface.set(item.name, item);
    } else if (item.source === "dockerhub") {
      if (!dockerhub.has(item.name)) dockerhub.set(item.name, item);
    } else if (item.source === "maven") {
      if (!maven.has(item.name)) maven.set(item.name, item);
    } else if (item.source === "rubygems") {
      if (!rubygems.has(item.name)) rubygems.set(item.name, item);
    } else if (item.source === "packagist") {
      if (!packagist.has(item.name)) packagist.set(item.name, item);
    } else if ("full_name" in item && item.html_url) {
      if (!repos.has(item.full_name)) repos.set(item.full_name, item);
    } else if ("name" in item && "version" in item) {
      if (!packages.has(item.name)) packages.set(item.name, item);
    } else if ("name" in item && "downloads" in item) {
      if (!crates.has(item.name)) crates.set(item.name, item);
    }
  }

  // Sort repositories by popularity descending
  const sortedRepos = Array.from(repos.values()).sort(
    (a, b) => (b.stargazers_count || 0) - (a.stargazers_count || 0)
  );
  const sortedGitlab = Array.from(gitlab.values()).sort(
    (a, b) => (b.stars || 0) - (a.stars || 0)
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

  // 2. GitLab Repositories
  if (sortedGitlab.length > 0) {
    const gitlabLines = sortedGitlab.slice(0, 5).map((project) => {
      const stars = (project.stars || 0).toLocaleString();
      const updated = project.updated ? ` • Updated ${project.updated}` : "";
      const desc = project.description ? `\n  ${project.description}` : "";
      return `- **[${project.name}](${project.url})** (★ ${stars}${updated})${desc}`;
    });
    sections.push(`### 🦊 GitLab Repositories\n${gitlabLines.join("\n")}`);
  }

  // 3. Package Registries and public indexes
  const formatDescription = (description) => {
    const text = String(description || "").replace(/\s+/g, " ").trim();
    return text ? `\n  ${text}` : "";
  };
  const pkgLines = [];

  for (const pkg of Array.from(packages.values()).slice(0, 3)) {
    const url = pkg.links?.npm || `https://www.npmjs.com/package/${pkg.name}`;
    pkgLines.push(
      `- **[npm: ${pkg.name}](${url})** (v${pkg.version || "latest"})${formatDescription(pkg.description)}`
    );
  }
  for (const crate of Array.from(crates.values()).slice(0, 3)) {
    const url = `https://crates.io/crates/${crate.name}`;
    const downloads = (crate.downloads || 0).toLocaleString();
    pkgLines.push(
      `- **[crate: ${crate.name}](${url})** (${downloads} downloads)${formatDescription(crate.description)}`
    );
  }
  for (const pkg of Array.from(nuget.values()).slice(0, 3)) {
    const downloads = (pkg.downloads || 0).toLocaleString();
    pkgLines.push(
      `- **[NuGet: ${pkg.name}](${pkg.url})** (v${pkg.version} • ${downloads} downloads)${formatDescription(pkg.description)}`
    );
  }
  for (const model of Array.from(huggingface.values()).slice(0, 3)) {
    const downloads = (model.downloads || 0).toLocaleString();
    pkgLines.push(
      `- **[Hugging Face: ${model.name}](${model.url})** (${downloads} downloads)${formatDescription(model.description)}`
    );
  }
  for (const image of Array.from(dockerhub.values()).slice(0, 3)) {
    const pulls = (image.downloads || 0).toLocaleString();
    pkgLines.push(
      `- **[Docker Hub: ${image.name}](${image.url})** (${pulls} pulls)${formatDescription(image.description)}`
    );
  }
  for (const artifact of Array.from(maven.values()).slice(0, 3)) {
    pkgLines.push(
      `- **[Maven: ${artifact.name}](${artifact.url})** (v${artifact.version})${formatDescription(artifact.description)}`
    );
  }
  for (const gem of Array.from(rubygems.values()).slice(0, 3)) {
    const downloads = (gem.downloads || 0).toLocaleString();
    pkgLines.push(
      `- **[RubyGems: ${gem.name}](${gem.url})** (v${gem.version} • ${downloads} downloads)${formatDescription(gem.description)}`
    );
  }
  for (const pkg of Array.from(packagist.values()).slice(0, 3)) {
    const downloads = (pkg.downloads || 0).toLocaleString();
    pkgLines.push(
      `- **[Packagist: ${pkg.name}](${pkg.url})** (${downloads} downloads)${formatDescription(pkg.description)}`
    );
  }

  if (pkgLines.length > 0) {
    sections.push(`### 📚 Ecosystem Packages\n${pkgLines.join("\n")}`);
  }

  // 4. High-Priority AI Deep Web Search Directive
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
      "Run before building from scratch. Searches GitHub, GitLab, npm, crates.io, NuGet, Hugging Face, Docker Hub, Maven Central, RubyGems, and Packagist across multiple query angles to find existing codebases, and provides targeted web search queries for finding commercial SaaS competitors.",
    inputSchema: toolSchema,
  },
  {
    name: "reuse_before_generate",
    description:
      "Run before building from scratch. Searches GitHub, GitLab, npm, crates.io, NuGet, Hugging Face, Docker Hub, Maven Central, RubyGems, and Packagist across multiple query angles to find existing codebases, and provides targeted web search queries for finding commercial SaaS competitors.",
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
        serverInfo: { name: "reuse-before-generate", version: "2.1.0" },
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

