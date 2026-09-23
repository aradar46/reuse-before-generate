#!/usr/bin/env node
import readline from "node:readline";

// Clean conversational filler words if user/AI passes raw sentence
function cleanQuery(text) {
  return text
    .replace(
      /\b(i want to make|i want to build|how to build|build a|build an|create a|create an|a tool that|an app for|an app that|a library for|that does|that do)\b/gi,
      ""
    )
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

// Search Maven Central via Sonatype search API.
async function searchMaven(query) {
  const url = new URL("https://search.maven.org/solrsearch/select");
  url.searchParams.set("q", query);
  url.searchParams.set("rows", "3");
  url.searchParams.set("wt", "json");

  const data = await fetchPublicJson(url);
  if (!Array.isArray(data?.response?.docs)) return [];

  return data.response.docs.map((doc) => ({
    source: "maven",
    name: `${doc.g}:${doc.a}`,
    version: doc.latestVersion || "latest",
    url: `https://central.sonatype.com/artifact/${encodeURIComponent(doc.g)}/${encodeURIComponent(doc.a)}`,
    description: "",
  }));
}

// Search RubyGems.
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

// Search Packagist for PHP packages.
async function searchPackagist(query) {
  const url = new URL("https://packagist.org/search.json");
  url.searchParams.set("q", query);
  url.searchParams.set("per_page", "3");

  const data = await fetchPublicJson(url);
  if (!Array.isArray(data?.results)) return [];

  return data.results.map((pkg) => ({
    source: "packagist",
    name: pkg.name,
    url: pkg.url || `https://packagist.org/packages/${pkg.name}`,
    description: pkg.description || "",
    downloads: pkg.downloads || 0,
  }));
}

// Search Flathub for Linux desktop applications.
async function searchFlathub(query) {
  try {
    const res = await fetch("https://flathub.org/api/v2/search", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "User-Agent": "reuse-before-generate",
      },
      body: JSON.stringify({ query }),
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) return [];
    const data = await res.json();
    if (!Array.isArray(data?.hits)) return [];
    return data.hits.slice(0, 3).map((h) => ({
      source: "flathub",
      name: h.name,
      appId: h.app_id,
      url: `https://flathub.org/apps/${h.app_id}`,
      description: h.summary || "",
    }));
  } catch {
    return [];
  }
}

// Search F-Droid for open-source Android apps.
async function searchFDroid(query) {
  try {
    const url = `https://search.f-droid.org/?q=${encodeURIComponent(query)}&lang=en`;
    const res = await fetch(url, {
      headers: { "User-Agent": "reuse-before-generate" },
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) return [];
    const html = await res.text();
    const regex =
      /<a class="package-header" href="(https:\/\/f-droid\.org\/en\/packages\/[^"]+)">[\s\S]*?<h4 class="package-name">\s*([^<]+?)\s*<\/h4>[\s\S]*?<span class="package-summary">([^<]*?)<\/span>/g;
    const results = [];
    let match;
    while ((match = regex.exec(html)) !== null && results.length < 3) {
      results.push({
        source: "fdroid",
        name: match[2].trim(),
        url: match[1],
        description: match[3].trim(),
      });
    }
    return results;
  } catch {
    return [];
  }
}

// Search Arch User Repository (AUR) for Linux tools & scripts.
async function searchAUR(query) {
  const url = `https://aur.archlinux.org/rpc/v5/search/${encodeURIComponent(query)}`;
  const data = await fetchPublicJson(url);
  if (!Array.isArray(data?.results)) return [];
  return data.results.slice(0, 3).map((pkg) => ({
    source: "aur",
    name: pkg.Name,
    url: `https://aur.archlinux.org/packages/${encodeURIComponent(pkg.Name)}`,
    version: pkg.Version || "",
    votes: pkg.NumVotes || 0,
    description: pkg.Description || "",
  }));
}

// Search GNOME Shell Extensions.
async function searchGNOMEExtensions(query) {
  const url = `https://extensions.gnome.org/extension-query/?search=${encodeURIComponent(query)}`;
  const data = await fetchPublicJson(url);
  if (!Array.isArray(data?.extensions)) return [];
  return data.extensions.slice(0, 3).map((ext) => ({
    source: "gnome",
    name: ext.name,
    url: ext.link
      ? `https://extensions.gnome.org${ext.link}`
      : `https://extensions.gnome.org/extension/${ext.pk}/`,
    downloads: ext.downloads || 0,
    description: ext.description || "",
  }));
}

// Search Conda & Bioconda via Anaconda.org.
async function searchConda(query) {
  const url = `https://api.anaconda.org/search?name=${encodeURIComponent(query)}`;
  const data = await fetchPublicJson(url);
  if (!Array.isArray(data)) return [];
  return data.slice(0, 3).map((pkg) => ({
    source: "conda",
    name: pkg.name,
    channel: pkg.owner || "conda-forge",
    url: `https://anaconda.org/${pkg.owner || "conda-forge"}/${pkg.name}`,
    version: pkg.latest_version || "latest",
    description: pkg.summary || "",
  }));
}

// Search R Packages (CRAN & Bioconductor via r-universe).
async function searchRPackages(query) {
  const url = `https://r-universe.dev/api/search?q=${encodeURIComponent(query)}`;
  const data = await fetchPublicJson(url);
  if (!Array.isArray(data?.results)) return [];
  return data.results.slice(0, 3).map((pkg) => ({
    source: "r",
    name: pkg.Package,
    registry: pkg._user === "bioc" ? "Bioconductor" : "CRAN",
    url: `https://${pkg._user || "cran"}.r-universe.dev/${pkg.Package}`,
    usedby: pkg._usedby || 0,
    description: pkg.Title || pkg.Description || "",
  }));
}

// Search Homebrew Formulae.
let brewCache = null;
async function searchHomebrew(query) {
  try {
    if (!brewCache) {
      brewCache = fetch("https://formulae.brew.sh/api/formula.json", {
        headers: { "User-Agent": "reuse-before-generate" },
        signal: AbortSignal.timeout(6000),
      })
        .then((r) => (r.ok ? r.json() : []))
        .catch(() => []);
    }
    const formulae = await brewCache;
    if (!Array.isArray(formulae)) return [];
    const qLower = query.toLowerCase();
    const qWords = qLower.split(/\s+/).filter(Boolean);

    return formulae
      .filter((f) => {
        const name = (f.name || "").toLowerCase();
        const desc = (f.desc || "").toLowerCase();
        return qWords.every((w) => name.includes(w) || desc.includes(w));
      })
      .slice(0, 3)
      .map((f) => ({
        source: "brew",
        name: f.name,
        url: f.homepage || `https://formulae.brew.sh/formula/${f.name}`,
        formulaUrl: `https://formulae.brew.sh/formula/${f.name}`,
        version: f.versions?.stable || "",
        description: f.desc || "",
      }));
  } catch {
    return [];
  }
}

// Search PyPI (Python Package Index).
async function searchPyPI(query) {
  try {
    const cleaned = query.toLowerCase().replace(/[^a-z0-9_-]/g, " ").trim();
    const words = cleaned.split(/\s+/).filter(Boolean);
    if (words.length === 0) return [];

    const candidates = new Set([
      words.join("-"),
      words.join("_"),
      words.join(""),
      `python-${words.join("-")}`,
      `${words.join("-")}-cli`,
      ...words,
    ]);

    const lookups = Array.from(candidates).slice(0, 5).map(async (name) => {
      try {
        const res = await fetch(`https://pypi.org/pypi/${encodeURIComponent(name)}/json`, {
          headers: { "User-Agent": "reuse-before-generate" },
          signal: AbortSignal.timeout(4000),
        });
        if (!res.ok) return null;
        const data = await res.json();
        return {
          source: "pypi",
          name: data.info?.name || name,
          version: data.info?.version || "latest",
          url: data.info?.project_url || data.info?.package_url || `https://pypi.org/project/${data.info?.name || name}/`,
          description: data.info?.summary || "",
        };
      } catch {
        return null;
      }
    });

    const results = await Promise.all(lookups);
    return results.filter(Boolean).slice(0, 3);
  } catch {
    return [];
  }
}

// Search Show HN launches via Algolia search API.
async function searchHackerNews(query) {
  const url = new URL("https://hn.algolia.com/api/v1/search");
  url.searchParams.set("tags", "show_hn");
  url.searchParams.set("hitsPerPage", "3");
  url.searchParams.set("query", query);

  const data = await fetchPublicJson(url);
  if (!Array.isArray(data?.hits)) return [];

  return data.hits.map((hit) => ({
    source: "hackernews",
    name: hit.title.replace(/^Show HN:\s*/i, ""),
    url: hit.url || `https://news.ycombinator.com/item?id=${hit.objectID}`,
    hnUrl: `https://news.ycombinator.com/item?id=${hit.objectID}`,
    points: hit.points || 0,
    comments: hit.num_comments || 0,
    description: "",
  }));
}

// Combined Multi-Query Search & Markdown Formatter
async function handleSearch(args = {}) {
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

  queryList = [...new Set(queryList)].filter(Boolean);

  if (queryList.length === 0) {
    return "Please provide at least one search query or project description.";
  }

  // Run all queries across all public sources in parallel
  const searchPromises = queryList.flatMap((q) => [
    searchGitHub(q),
    searchGitLab(q),
    searchNpm(q),
    searchPyPI(q),
    searchCrates(q),
    searchHomebrew(q),
    searchFlathub(q),
    searchFDroid(q),
    searchGNOMEExtensions(q),
    searchAUR(q),
    searchConda(q),
    searchRPackages(q),
    searchNuGet(q),
    searchHuggingFace(q),
    searchDockerHub(q),
    searchMaven(q),
    searchRubyGems(q),
    searchPackagist(q),
    searchHackerNews(q),
  ]);

  const rawResults = await Promise.all(searchPromises);

  // Group and deduplicate results
  const repos = new Map();
  const packages = new Map();
  const pypi = new Map();
  const crates = new Map();
  const brew = new Map();
  const gitlab = new Map();
  const nuget = new Map();
  const huggingface = new Map();
  const dockerhub = new Map();
  const maven = new Map();
  const rubygems = new Map();
  const packagist = new Map();
  const flathub = new Map();
  const fdroid = new Map();
  const aur = new Map();
  const gnome = new Map();
  const conda = new Map();
  const rpackages = new Map();
  const hackernews = new Map();

  for (const item of rawResults.flat()) {
    if (!item) continue;

    if (item.source === "gitlab") {
      if (!gitlab.has(item.name)) gitlab.set(item.name, item);
    } else if (item.source === "hackernews") {
      if (!hackernews.has(item.hnUrl)) hackernews.set(item.hnUrl, item);
    } else if (item.source === "brew") {
      if (!brew.has(item.name)) brew.set(item.name, item);
    } else if (item.source === "pypi") {
      if (!pypi.has(item.name)) pypi.set(item.name, item);
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
    } else if (item.source === "flathub") {
      if (!flathub.has(item.appId)) flathub.set(item.appId, item);
    } else if (item.source === "fdroid") {
      if (!fdroid.has(item.name)) fdroid.set(item.name, item);
    } else if (item.source === "aur") {
      if (!aur.has(item.name)) aur.set(item.name, item);
    } else if (item.source === "gnome") {
      if (!gnome.has(item.name)) gnome.set(item.name, item);
    } else if (item.source === "conda") {
      if (!conda.has(`${item.channel}/${item.name}`))
        conda.set(`${item.channel}/${item.name}`, item);
    } else if (item.source === "r") {
      if (!rpackages.has(item.name)) rpackages.set(item.name, item);
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
  const sortedHN = Array.from(hackernews.values()).sort(
    (a, b) => (b.points || 0) - (a.points || 0)
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

  // 3. Show HN Launches & Discussions
  if (sortedHN.length > 0) {
    const hnLines = sortedHN.slice(0, 4).map((hit) => {
      const points = `${(hit.points || 0).toLocaleString()} pts`;
      const comments = `${(hit.comments || 0).toLocaleString()} comments`;
      const disc = hit.url !== hit.hnUrl ? ` • [Discussion](${hit.hnUrl})` : "";
      return `- **[Show HN: ${hit.name}](${hit.url})** (${points} • ${comments}${disc})`;
    });
    sections.push(`### 🚀 Show HN Launches\n${hnLines.join("\n")}`);
  }

  // 4. Desktop Apps, Extensions & Linux Packages (Flathub, GNOME, AUR, Homebrew)
  // 4. Desktop & Mobile Apps, Extensions & CLI Utilities (Flathub, F-Droid, GNOME, AUR, Homebrew)
  const formatDescription = (description) => {
    const text = String(description || "").replace(/\s+/g, " ").trim();
    return text ? `\n  ${text}` : "";
  };

  const desktopLines = [];
  for (const app of Array.from(flathub.values()).slice(0, 3)) {
    desktopLines.push(
      `- **[Flathub: ${app.name}](${app.url})** (${app.appId})${formatDescription(app.description)}`
    );
  }
  for (const app of Array.from(fdroid.values()).slice(0, 3)) {
    desktopLines.push(
      `- **[F-Droid: ${app.name}](${app.url})**${formatDescription(app.description)}`
    );
  }
  for (const ext of Array.from(gnome.values()).slice(0, 3)) {
    const downloads = (ext.downloads || 0).toLocaleString();
    desktopLines.push(
      `- **[GNOME Extension: ${ext.name}](${ext.url})** (${downloads} downloads)${formatDescription(ext.description)}`
    );
  }
  for (const f of Array.from(brew.values()).slice(0, 3)) {
    const ver = f.version ? `v${f.version}` : "";
    desktopLines.push(
      `- **[Homebrew: ${f.name}](${f.formulaUrl})** (${ver})${formatDescription(f.description)}`
    );
  }
  for (const pkg of Array.from(aur.values()).slice(0, 3)) {
    desktopLines.push(
      `- **[AUR: ${pkg.name}](${pkg.url})** (v${pkg.version} • ${pkg.votes} votes)${formatDescription(pkg.description)}`
    );
  }

  if (desktopLines.length > 0) {
    sections.push(`### 🖥️ Desktop Apps, Extensions & CLI Utilities\n${desktopLines.join("\n")}`);
    sections.push(`### 🖥️ Desktop & Mobile Apps, Extensions & CLI Utilities\n${desktopLines.join("\n")}`);
  }

  // 5. Package Registries and public indexes
  const pkgLines = [];

  for (const pkg of Array.from(pypi.values()).slice(0, 3)) {
    pkgLines.push(
      `- **[PyPI: ${pkg.name}](${pkg.url})** (v${pkg.version || "latest"})${formatDescription(pkg.description)}`
    );
  }
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
  for (const pkg of Array.from(conda.values()).slice(0, 3)) {
    pkgLines.push(
      `- **[Conda (${pkg.channel}): ${pkg.name}](${pkg.url})** (v${pkg.version})${formatDescription(pkg.description)}`
    );
  }
  for (const pkg of Array.from(rpackages.values()).slice(0, 3)) {
    pkgLines.push(
      `- **[R (${pkg.registry}): ${pkg.name}](${pkg.url})**${formatDescription(pkg.description)}`
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

  // 6. High-Priority AI Deep Web Search Directive
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
      "Run before building from scratch. Searches GitHub, GitLab, Show HN, Flathub, F-Droid, GNOME Extensions, Homebrew, AUR, PyPI, Conda/Bioconda, CRAN/Bioconductor, npm, crates.io, NuGet, Hugging Face, Docker Hub, Maven Central, RubyGems, and Packagist across multiple query angles to find existing codebases, and provides targeted web search queries for finding commercial SaaS competitors.",
    inputSchema: toolSchema,
  },
  {
    name: "reuse_before_generate",
    description:
      "Run before building from scratch. Searches GitHub, GitLab, Show HN, Flathub, F-Droid, GNOME Extensions, Homebrew, AUR, PyPI, Conda/Bioconda, CRAN/Bioconductor, npm, crates.io, NuGet, Hugging Face, Docker Hub, Maven Central, RubyGems, and Packagist across multiple query angles to find existing codebases, and provides targeted web search queries for finding commercial SaaS competitors.",
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
