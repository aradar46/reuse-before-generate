// Retrieval layer: pulls candidate matches from GitHub, npm, and PyPI for a
// free-text project description. Kept deliberately dumb (lexical queries) —
// semantic filtering happens later in rerank.ts.

export interface RawCandidate {
  source: "github" | "npm" | "pypi";
  id: string; // repo full_name, npm package name, or pypi package name
  name: string;
  url: string;
  description: string;
  stars?: number;
  pushedAt?: string; // ISO date of last commit/publish
  archived?: boolean;
}

const USER_AGENT = "reuse-before-generate-mcp/0.1";
const GITHUB_API = "https://api.github.com";

function githubHeaders(): Record<string, string> {
  const headers: Record<string, string> = {
    Accept: "application/vnd.github+json",
    "User-Agent": USER_AGENT,
  };
  const token = process.env.GITHUB_TOKEN;
  if (token) headers.Authorization = `Bearer ${token}`;
  return headers;
}

/** Turn a free-text project description into a handful of short keyword
 * queries. This is intentionally simple — a real semantic pass happens
 * downstream via the LLM re-rank, so this only needs to get plausible
 * candidates into the funnel, not perfect ones.
 *
 * Keeps first-occurrence order (the concrete subject of a sentence tends to
 * come early — "a CLI tool that generates changelogs..." vs. filler later
 * on) rather than sorting by word length: length alone over-favors abstract
 * gerunds/adjectives ("rebuilding", "actually-maintained") over concrete
 * nouns that actually match real project names/descriptions. Also excludes
 * terms so generic in the current tooling ecosystem that they add search
 * volume without adding discriminating power (e.g. "agent", "MCP"). */
export function extractKeywords(description: string, max = 4): string[] {
  const stop = new Set([
    "the", "a", "an", "and", "or", "but", "for", "to", "of", "in", "on",
    "with", "that", "this", "it", "is", "are", "be", "as", "at", "by",
    "from", "into", "using", "use", "which", "will", "can", "project",
    "tool", "app", "application", "build", "building", "want", "like",
    "so", "that's", "i'm", "i", "my",
    // generic tech/agent-tooling buzzwords: true almost everywhere, so they
    // dilute the query rather than target it
    "agent", "agents", "coding", "mcp", "server", "github", "npm",
    "pypi", "existing", "already", "before", "new", "module", "check",
    "checks", "checking", "search", "searches", "searching", "similarity",
    "semantic", "real", "actual",
    // generic verb/adverb filler: rarely how a project describes itself,
    // and each one included pushes a genuinely distinctive noun out of the
    // truncated query (evidence: dropping these was necessary to surface
    // psf/black and astral-sh/ruff for a Python-formatter query)
    "automatically", "consistent", "generates", "updates", "creates",
    "creating", "generating", "updating", "handles", "handling", "does",
    "job", "style", "source",
  ]);
  const words = description
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, " ")
    .split(/\s+/)
    .filter((w) => w.length > 2 && !stop.has(w));
  // de-dupe, keep first-occurrence order
  const seen = new Set<string>();
  const uniq: string[] = [];
  for (const w of words) {
    if (!seen.has(w)) {
      seen.add(w);
      uniq.push(w);
    }
  }
  return uniq.slice(0, max);
}

/** npm's search API rejects `text` over 64 chars (ERR_TEXT_LENGTH); GitHub
 * has no such hard cap but a shorter query is also a tighter query there.
 * Joins keywords space-separated, dropping trailing words that would push
 * past the limit rather than truncating mid-word. */
export function keywordsAsQuery(keywords: string[], maxChars = 64): string {
  let out = "";
  for (const kw of keywords) {
    const next = out ? `${out} ${kw}` : kw;
    if (next.length > maxChars) break;
    out = next;
  }
  // A single keyword longer than the cap would otherwise leave `out` empty,
  // which npm rejects outright (ERR_TEXT_LENGTH: text must be 2-64 chars).
  // A truncated query is a worse query but still a valid one; an empty query
  // is a guaranteed 400.
  if (out === "" && keywords.length > 0) {
    return keywords[0].slice(0, maxChars);
  }
  return out;
}

interface GitHubSearchItem {
  full_name: string;
  html_url: string;
  description: string | null;
  stargazers_count: number;
  pushed_at: string;
  archived: boolean;
}

async function fetchGitHubSearch(
  query: string,
  per_page: number,
  extraParams = "",
): Promise<GitHubSearchItem[]> {
  const q = encodeURIComponent(query);
  const url = `${GITHUB_API}/search/repositories?q=${q}&per_page=${per_page}${extraParams}`;
  // GitHub's unauthenticated search endpoint has a tight primary limit
  // (10/min) plus a separate secondary "abuse detection" throttle on rapid
  // bursts — both surface as 403. One retry after a short backoff (honoring
  // Retry-After when present) covers the common transient case without
  // adding real latency to the normal path.
  let res = await fetch(url, { headers: githubHeaders() });
  if (res.status === 403 || res.status === 429) {
    const retryAfterHeader = res.headers.get("retry-after");
    const waitMs = retryAfterHeader ? Number(retryAfterHeader) * 1000 : 2000;
    await new Promise((r) => setTimeout(r, waitMs));
    res = await fetch(url, { headers: githubHeaders() });
  }
  if (!res.ok) {
    console.error(`[search] GitHub search failed: HTTP ${res.status}`);
    return [];
  }
  const data = (await res.json()) as { items: GitHubSearchItem[] };
  return data.items;
}

function toCandidate(item: GitHubSearchItem): RawCandidate {
  return {
    source: "github",
    id: item.full_name,
    name: item.full_name,
    url: item.html_url,
    description: item.description ?? "",
    stars: item.stargazers_count,
    pushedAt: item.pushed_at,
    archived: item.archived,
  };
}

export async function searchGitHub(
  description: string,
  overrideKeywords?: string[],
  limit = 15,
): Promise<RawCandidate[]> {
  const keywords = (overrideKeywords ?? extractKeywords(description, 4)).join(" ");
  // Default (best-match) sort, not sort=stars: sorting by stars biases
  // toward giant awesome-lists/mega-repos that merely mention the keywords
  // in a README, which is exactly the keyword-noise failure mode this tool
  // exists to avoid. Best-match relevance is a better funnel for the
  // semantic re-rank step downstream.
  const baseQuery = `${keywords} in:name,description,readme`;

  // Second pass scoped to near-zero-star repos: GitHub's relevance ranking
  // effectively never surfaces 0-1 star repos when they compete against
  // anything with real stars, REGARDLESS of keyword precision — confirmed
  // by testing against three known, on-point, actively-maintained 0-star
  // "GitHub Actions debugger" repos that a query never returned even in the
  // top 100 results under several phrasings. A brand-new zero-star repo
  // that does exactly the job asked about is exactly the kind of early
  // duplicate this tool exists to catch, so it needs its own search lane
  // rather than relying on the general query to eventually surface it.
  //
  // Deliberately WITHOUT `in:name,description,readme` and WITHOUT
  // `sort=updated` here, unlike the primary query above — both were tested
  // and found to actively hurt this lane specifically: `in:...readme`
  // turns "best match" into "any 0-3 star repo that mentions these words
  // anywhere," and sort=updated discards relevance ranking entirely, so
  // together they return arbitrary recently-touched noise instead of the
  // actual on-point repo. Plain best-match plus the stars filter alone is
  // what surfaced the real target in testing.
  const lowStarQuery = `${keywords} stars:0..3`;

  try {
    const [primary, lowStar] = await Promise.all([
      fetchGitHubSearch(baseQuery, limit),
      fetchGitHubSearch(lowStarQuery, Math.min(limit, 10)),
    ]);
    const seen = new Set<string>();
    const merged: RawCandidate[] = [];
    for (const item of [...primary, ...lowStar]) {
      if (seen.has(item.full_name)) continue;
      seen.add(item.full_name);
      merged.push(toCandidate(item));
    }
    return merged;
  } catch (err) {
    console.error(`[search] GitHub search error: ${(err as Error).message}`);
    return [];
  }
}

export async function searchNpm(
  description: string,
  overrideKeywords?: string[],
  limit = 10,
): Promise<RawCandidate[]> {
  // npm's search API 400s if `text` is outside 2-64 chars (ERR_TEXT_LENGTH);
  // keywordsAsQuery keeps whole words under that cap instead of truncating
  // mid-word or letting the request fail outright.
  const keywords = keywordsAsQuery(overrideKeywords ?? extractKeywords(description, 4));
  const url = `https://registry.npmjs.org/-/v1/search?text=${encodeURIComponent(keywords)}&size=${limit}`;
  try {
    const res = await fetch(url, { headers: { "User-Agent": USER_AGENT } });
    if (!res.ok) {
      console.error(`[search] npm search failed: HTTP ${res.status}`);
      return [];
    }
    const data = (await res.json()) as {
      objects: Array<{
        package: {
          name: string;
          description: string | null;
          links: { npm: string; repository?: string };
          date: string;
        };
      }>;
    };
    return data.objects.map((obj) => ({
      source: "npm" as const,
      id: obj.package.name,
      name: obj.package.name,
      url: obj.package.links.repository ?? obj.package.links.npm,
      description: obj.package.description ?? "",
      pushedAt: obj.package.date,
    }));
  } catch (err) {
    console.error(`[search] npm search error: ${(err as Error).message}`);
    return [];
  }
}

export async function searchPyPI(
  description: string,
  overrideKeywords?: string[],
  limit = 10,
): Promise<RawCandidate[]> {
  // PyPI has no official JSON search API (the old one was retired); we use
  // the public search-index mirror at pypi.org's simple search HTML is
  // unreliable to parse, so we fall back to a best-effort approach: query
  // the "similar packages" style endpoint isn't available either, so we
  // just skip live search and rely on GitHub/npm for v0. If PYPI_XMLRPC_OK
  // is unset, this returns [] rather than scraping HTML.
  const keywords = overrideKeywords ?? extractKeywords(description, 4);
  if (keywords.length === 0) return [];
  // Best-effort: hit the pypi.org JSON API for the single most likely
  // package name guesses (kebab-case joins of top keywords). This won't
  // discover unrelated names but catches direct hits cheaply and safely.
  const guesses = [keywords.join("-"), keywords.slice(0, 2).join("-")];
  const results: RawCandidate[] = [];
  for (const guess of new Set(guesses)) {
    try {
      const res = await fetch(`https://pypi.org/pypi/${guess}/json`, {
        headers: { "User-Agent": USER_AGENT },
      });
      if (!res.ok) continue;
      const data = (await res.json()) as {
        info: { name: string; summary: string | null; project_url: string };
        urls: Array<{ upload_time_iso_8601?: string }>;
      };
      results.push({
        source: "pypi",
        id: data.info.name,
        name: data.info.name,
        url: data.info.project_url,
        description: data.info.summary ?? "",
        pushedAt: data.urls[0]?.upload_time_iso_8601,
      });
    } catch {
      // ignore — guess-based lookup is best-effort
    }
  }
  return results.slice(0, limit);
}

/** `keywords`, when provided, comes from the calling agent's own read of the
 * user's description — including cases where the user's phrasing is vague,
 * non-native, or roundabout ("the thing that check my code is clean
 * automatic"). An agent that already understood the intent ("a linter")
 * produces far better search terms than this file's mechanical stop-word
 * extractor ever can; extractKeywords remains only as the fallback when no
 * agent-provided keywords are given. */
export async function searchAll(
  description: string,
  keywords?: string[],
): Promise<RawCandidate[]> {
  const [gh, npm, pypi] = await Promise.all([
    searchGitHub(description, keywords),
    searchNpm(description, keywords),
    searchPyPI(description, keywords),
  ]);
  return [...gh, ...npm, ...pypi];
}
