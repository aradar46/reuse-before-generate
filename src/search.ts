// Retrieval layer: pulls candidate matches from GitHub, npm, and PyPI for a
// free-text project description. Kept deliberately dumb (lexical queries) —
// semantic filtering happens later in rerank.ts.

import { httpGet } from "./http.js";
import { GitHubSearchResponse, NpmSearchResponse, PyPIProjectResponse, type GitHubSearchItemT } from "./schemas.js";
import { ok, err, type Result } from "./result.js";

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

const USER_AGENT = "reuse-before-generate-mcp/0.2";
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

/** npm's documented floor for the `text` parameter. */
const MIN_QUERY_CHARS = 2;

/** Truncates to at most `maxChars` UTF-16 units without splitting a
 * surrogate pair. A raw `.slice()` can cut an astral character (emoji, most
 * CJK extension blocks) in half, leaving a lone surrogate that makes
 * `encodeURIComponent` throw "URI malformed" — an uncaught crash rather than
 * the handled 400 it replaced. Dropping the partial character costs one
 * glyph off an already-degraded query and keeps the string encodable. */
function truncateToChars(input: string, maxChars: number): string {
  if (input.length <= maxChars) return input;
  const cut = input.slice(0, maxChars);
  const last = cut.charCodeAt(cut.length - 1);
  // A high surrogate (D800-DBFF) at the end means its pair was cut off.
  const endsMidPair = last >= 0xd800 && last <= 0xdbff;
  return endsMidPair ? cut.slice(0, -1) : cut;
}

/** Trims and drops entries too short to carry meaning. The agent-supplied
 * `keywords` array is schema-checked for length (3-6 entries) but not for
 * per-entry content, so blanks and single characters are reachable from a
 * real tool call. Both search lanes need this, not just npm: a query built
 * from `["", " ", "a"]` is "   a", which returns pure noise while still
 * costing a request against GitHub's 10/min unauthenticated limit. */
export function meaningfulKeywords(keywords: string[]): string[] {
  return keywords
    .map((kw) => kw.trim())
    .filter((kw) => kw.length >= MIN_QUERY_CHARS);
}

/** npm's search API rejects `text` outside 2-64 chars (ERR_TEXT_LENGTH);
 * GitHub has no such hard cap but a shorter query is also a tighter query
 * there. Joins keywords space-separated, dropping trailing words that would
 * push past the limit rather than truncating mid-word. The one exception is
 * a first keyword that alone exceeds the cap: see the fallback below.
 *
 * Returns "" when nothing usable survives. Callers must treat that as "skip
 * the request" rather than sending it — see the guard in searchNpm. */
export function keywordsAsQuery(keywords: string[], maxChars = 64): string {
  // Blanks left in contribute nothing but still consume separator
  // characters, producing queries like "    json"; single chars are below
  // npm's floor of 2, so a query that reduces to one is rejected just as an
  // empty one is.
  const usable = meaningfulKeywords(keywords);

  let out = "";
  for (const kw of usable) {
    const next = out ? `${out} ${kw}` : kw;
    if (next.length > maxChars) break;
    out = next;
  }
  // A single keyword longer than the cap would otherwise leave `out` empty,
  // which npm rejects outright. A truncated query is a worse query but still
  // a valid one; an empty query is a guaranteed 400.
  if (out === "" && usable.length > 0) {
    return truncateToChars(usable[0], maxChars);
  }
  return out;
}

async function fetchGitHubSearch(
  query: string,
  per_page: number,
  extraParams = "",
): Promise<GitHubSearchItemT[]> {
  const q = encodeURIComponent(query);
  const url = `${GITHUB_API}/search/repositories?q=${q}&per_page=${per_page}${extraParams}`;
  // GitHub's unauthenticated search endpoint has a tight primary limit
  // (10/min) plus a separate secondary "abuse detection" throttle on rapid
  // bursts — both surface as 403. One retry after a short backoff (honoring
  // Retry-After when present) covers the common transient case without
  // adding real latency to the normal path.
  let res = await httpGet(url, githubHeaders());
  if (res.status === 403 || res.status === 429) {
    const retryAfterHeader = res.headers.get("retry-after");
    const waitMs = retryAfterHeader ? Number(retryAfterHeader) * 1000 : 2000;
    await new Promise((r) => setTimeout(r, waitMs));
    res = await httpGet(url, githubHeaders());
  }
  if (!res.ok) {
    throw new Error(`HTTP ${res.status}`);
  }
  const parsed = GitHubSearchResponse.safeParse(await res.json());
  if (!parsed.success) {
    throw new Error("unexpected response shape");
  }
  return parsed.data.items;
}

function toCandidate(item: GitHubSearchItemT): RawCandidate {
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

export async function searchGitHubResult(
  description: string,
  overrideKeywords?: string[],
  limit = 15,
): Promise<Result<RawCandidate[]>> {
  // Filter before the emptiness check, not after: an all-stop-word
  // description yields no keywords at all, but an agent-supplied array like
  // ["", " ", "a"] is non-empty while still joining to the junk query
  // "   a". Both would spend a request against GitHub's 10/min
  // unauthenticated limit and return nothing but noise.
  const keywordList = meaningfulKeywords(
    overrideKeywords ?? extractKeywords(description, 4),
  );
  if (keywordList.length === 0) return ok("github", []);
  const keywords = keywordList.join(" ");
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
    return ok("github", merged);
  } catch (e) {
    return err("github", (e as Error).message);
  }
}

/** Back-compat wrapper: returns candidates or [] on failure. */
export async function searchGitHub(
  description: string,
  overrideKeywords?: string[],
  limit = 15,
): Promise<RawCandidate[]> {
  const r = await searchGitHubResult(description, overrideKeywords, limit);
  return r.ok ? r.value : [];
}

export async function searchNpmResult(
  description: string,
  overrideKeywords?: string[],
  limit = 10,
): Promise<Result<RawCandidate[]>> {
  const keywords = keywordsAsQuery(overrideKeywords ?? extractKeywords(description, 4));
  // npm rejects text outside 2-64 chars (ERR_TEXT_LENGTH); skip the round
  // trip rather than spend it on a guaranteed 400. keywordsAsQuery returns
  // "" when nothing usable survives its filtering.
  if (keywords.length === 0) return ok("npm", []);
  const url = `https://registry.npmjs.org/-/v1/search?text=${encodeURIComponent(keywords)}&size=${limit}`;
  try {
    const res = await httpGet(url, { "User-Agent": USER_AGENT });
    if (!res.ok) {
      return err("npm", `HTTP ${res.status}`);
    }
    const parsed = NpmSearchResponse.safeParse(await res.json());
    if (!parsed.success) {
      return err("npm", "unexpected response shape");
    }
    const candidates = parsed.data.objects.map((obj) => ({
      source: "npm" as const,
      id: obj.package.name,
      name: obj.package.name,
      url: obj.package.links.repository ?? obj.package.links.npm,
      description: obj.package.description ?? "",
      pushedAt: obj.package.date,
    }));
    return ok("npm", candidates);
  } catch (e) {
    return err("npm", (e as Error).message);
  }
}

/** Back-compat wrapper: returns candidates or [] on failure. */
export async function searchNpm(
  description: string,
  overrideKeywords?: string[],
  limit = 10,
): Promise<RawCandidate[]> {
  const r = await searchNpmResult(description, overrideKeywords, limit);
  return r.ok ? r.value : [];
}

/** Python discovery via GitHub rather than PyPI.
 *
 * Since PyPI offers no real search (see searchPyPIResult), name-guessing
 * only finds packages named after their own keywords — it cannot find
 * `requests` from "http client". Nearly every Python tool worth surfacing
 * has a GitHub repo, and `language:python` shrinks the result pool enough
 * that small repos rank on their own merits instead of being buried by
 * unrelated high-star noise: a live check of "json viewer terminal
 * language:python" returned 12 total results, three of them under 5 stars.
 *
 * Tagged source "github" because that is where the candidate actually
 * lives — the URL and star count are GitHub's. */
export async function searchPythonRepos(
  keywords: string[],
  limit = 10,
): Promise<RawCandidate[]> {
  const usable = meaningfulKeywords(keywords);
  if (usable.length === 0) return [];
  try {
    const items = await fetchGitHubSearch(`${usable.join(" ")} language:python`, limit);
    return items.map(toCandidate);
  } catch (e) {
    // Best-effort supplement: a failure here should not sink the PyPI
    // lane's own direct-hit guesses.
    console.error(`[search] python lane failed: ${(e as Error).message}`);
    return [];
  }
}

export async function searchPyPIResult(
  description: string,
  overrideKeywords?: string[],
  limit = 10,
): Promise<Result<RawCandidate[]>> {
  // PyPI has no general search API — the XML-RPC one was retired, and the
  // web search endpoint returns HTML regardless of what you ask for:
  //
  //   curl -so /dev/null -w '%{content_type}' \
  //     'https://pypi.org/search/?q=json+viewer&format=json'
  //   # => text/html; charset=utf-8   (same with Accept: application/json)
  //
  // Re-run that to check whether this is still true. Until it changes, the
  // only option is guessing package names against the per-project JSON
  // endpoint (kebab-case joins of the top keywords). That misses anything
  // not named after its own keywords, but catches direct hits cheaply.
  // Broader Python coverage comes from the GitHub language:python lane.
  const keywords = meaningfulKeywords(overrideKeywords ?? extractKeywords(description, 4));
  if (keywords.length === 0) return ok("pypi", []);
  const guesses = [keywords.join("-"), keywords.slice(0, 2).join("-")];
  const results: RawCandidate[] = [];
  for (const guess of new Set(guesses)) {
    try {
      const res = await httpGet(`https://pypi.org/pypi/${guess}/json`, {
        "User-Agent": USER_AGENT,
      });
      if (!res.ok) continue;
      const parsed = PyPIProjectResponse.safeParse(await res.json());
      if (!parsed.success) continue;
      const data = parsed.data;
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

  // Merge the GitHub-side Python lane. Deduped by id so a project found
  // both ways (PyPI name guess and GitHub repo) is not listed twice.
  const seen = new Set(results.map((r) => r.id.toLowerCase()));
  for (const repo of await searchPythonRepos(keywords)) {
    if (seen.has(repo.id.toLowerCase())) continue;
    seen.add(repo.id.toLowerCase());
    results.push(repo);
  }

  return ok("pypi", results.slice(0, limit));
}

/** Back-compat wrapper: returns candidates or [] on failure. */
export async function searchPyPI(
  description: string,
  overrideKeywords?: string[],
  limit = 10,
): Promise<RawCandidate[]> {
  const r = await searchPyPIResult(description, overrideKeywords, limit);
  return r.ok ? r.value : [];
}

/** `keywords`, when provided, comes from the calling agent's own read of the
 * user's description — including cases where the user's phrasing is vague,
 * non-native, or roundabout ("the thing that check my code is clean
 * automatic"). An agent that already understood the intent ("a linter")
 * produces far better search terms than this file's mechanical stop-word
 * extractor ever can; extractKeywords remains only as the fallback when no
 * agent-provided keywords are given. */
/** Returns one Result per source, so the caller can report partial failure
 * honestly ("npm search failed") instead of silently returning fewer
 * candidates with no explanation. */
export async function searchAllResults(
  description: string,
  keywords?: string[],
): Promise<Result<RawCandidate[]>[]> {
  return Promise.all([
    searchGitHubResult(description, keywords),
    searchNpmResult(description, keywords),
    searchPyPIResult(description, keywords),
  ]);
}

/** Flattened view for callers that do not care which source failed. */
export async function searchAll(
  description: string,
  keywords?: string[],
): Promise<RawCandidate[]> {
  const results = await searchAllResults(description, keywords);
  return results.flatMap((r) => (r.ok ? r.value : []));
}
