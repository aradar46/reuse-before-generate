// Retrieval layer: pulls candidate matches for a free-text project
// description from repository, package-registry, launch, and optional web
// sources. Kept deliberately dumb (lexical queries) — semantic filtering
// happens later in rerank.ts.

import { httpGet } from "./http.js";
import { GitHubSearchResponse, NpmSearchResponse, type GitHubSearchItemT } from "./schemas.js";
import { ok, err, type Result, type Source } from "./result.js";
import {
  buildQueryPlan,
  type QueryInput,
  type QueryPlan,
} from "./query-plan.js";
import { mergeCandidates } from "./canonicalize.js";
import type { RawCandidate } from "./candidate.js";
import { searchGitLabResult } from "./sources/gitlab.js";
import { searchShowHnResult } from "./sources/hacker-news.js";
import { searchRegistryResults } from "./sources/registries.js";
import { GitHubRequestScheduler } from "./github-scheduler.js";
import { searchTavilyDiscoveryResult } from "./sources/tavily.js";

export type { RawCandidate } from "./candidate.js";

const USER_AGENT = "reuse-before-generate-mcp/0.5";
const GITHUB_API = "https://api.github.com";
const githubScheduler = new GitHubRequestScheduler();

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
  const res = await githubScheduler.schedule(() => httpGet(url, githubHeaders()));
  if (!res.ok) {
    throw new Error(`HTTP ${res.status}`);
  }
  const parsed = GitHubSearchResponse.safeParse(await res.json());
  if (!parsed.success) {
    throw new Error("unexpected response shape");
  }
  return parsed.data.items;
}

function toGitHubCandidate(
  item: GitHubSearchItemT,
  source: "github" | "python",
  query: string,
  rank: number,
): RawCandidate {
  const description = item.description ?? "";
  return {
    source,
    id: item.full_name,
    name: item.full_name,
    url: item.html_url,
    description,
    stars: item.stargazers_count,
    pushedAt: item.pushed_at,
    archived: item.archived,
    kind: "open_source",
    repositoryUrl: item.html_url,
    evidence: [
      {
        source,
        sourceId: item.full_name,
        sourceUrl: item.html_url,
        destinationUrl: item.html_url,
        title: item.full_name,
        snippet: description,
        query,
        rank,
        date: item.pushed_at,
      },
    ],
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
    return ok(
      "github",
      mergeCandidates([
        ...primary.map((item, index) =>
          toGitHubCandidate(item, "github", baseQuery, index + 1)),
        ...lowStar.map((item, index) =>
          toGitHubCandidate(item, "github", lowStarQuery, index + 1)),
      ]),
    );
  } catch (e) {
    return err("github", (e as Error).message);
  }
}

/**
 * Runs a small, diverse set of repository lanes from the caller-understood
 * intent. Each lane gets its own evidence identity, so later ranking can
 * reward agreement without pretending the formulations are equivalent.
 */
export async function searchGitHubPlanResult(
  plan: QueryPlan,
  limit = 15,
): Promise<Result<RawCandidate[]>> {
  const { category, outcome, synonyms } = plan.formulations;
  const constraintQuery = plan.constraints.length > 0
    ? `${category} ${plan.constraints.slice(0, 2).join(" ")}`
    : `${outcome} in:name,description,readme`;
  const queries = uniqueQueries(
    `${category} in:name,description,readme`,
    synonyms ? `${synonyms} in:name,description,readme` : undefined,
    constraintQuery,
    `${category} stars:0..3`,
  ).slice(0, 4);

  const results = await Promise.all(queries.map(async (
    query,
    lane,
  ): Promise<Result<RawCandidate[]>> => {
    try {
      const items = await fetchGitHubSearch(
        query,
        query.includes("stars:0..3") ? Math.min(limit, 10) : limit,
      );
      return ok(
        "github" as const,
        items.map((item, index) =>
          toGitHubCandidate(item, "github", query, index + 1)),
      );
    } catch (error) {
      return err(
        "github" as const,
        `lane ${lane + 1}: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }));
  const successes = results.filter((result) => result.ok);
  if (successes.length > 0) {
    return ok(
      "github",
      mergeCandidates(successes.flatMap((result) => result.value)),
    );
  }
  return err(
    "github",
    [...new Set(results.flatMap((result) => result.ok ? [] : [result.reason]))]
      .join("; "),
  );
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
    const candidates = parsed.data.objects.map((obj, index) => {
      const packageUrl = obj.package.links.npm;
      const repositoryUrl = obj.package.links.repository;
      const destinationUrl = repositoryUrl ?? packageUrl;
      const description = obj.package.description ?? "";
      return {
        source: "npm" as const,
        id: obj.package.name,
        name: obj.package.name,
        url: destinationUrl,
        description,
        pushedAt: obj.package.date,
        kind: "open_source" as const,
        ...(repositoryUrl ? { repositoryUrl } : {}),
        packageUrl,
        evidence: [
          {
            source: "npm" as const,
            sourceId: obj.package.name,
            sourceUrl: packageUrl,
            destinationUrl,
            title: obj.package.name,
            snippet: description,
            query: keywords,
            rank: index + 1,
            date: obj.package.date,
          },
        ],
      };
    });
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

/** Python discovery, via GitHub's `language:python` filter.
 *
 * The language filter shrinks the result pool enough that small repos rank
 * on their own merits instead of being buried by unrelated high-star noise
 * — a live check of "json viewer terminal language:python" returned 12
 * total results, three of them under 5 stars.
 *
 * Candidates keep source "python" rather than "github" so the eval can
 * attribute wins to this lane specifically; the URL and star count are
 * GitHub's either way. */
export async function searchPythonResult(
  description: string,
  overrideKeywords?: string[],
  limit = 10,
): Promise<Result<RawCandidate[]>> {
  const keywords = meaningfulKeywords(overrideKeywords ?? extractKeywords(description, 4));
  if (keywords.length === 0) return ok("python", []);
  const query = `${keywords.join(" ")} language:python`;
  try {
    const items = await fetchGitHubSearch(query, limit);
    return ok(
      "python",
      items.map((item, index) =>
        toGitHubCandidate(item, "python", query, index + 1)),
    );
  } catch (e) {
    return err("python", (e as Error).message);
  }
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
function uniqueQueries(...queries: Array<string | undefined>): string[] {
  const seen = new Set<string>();
  const unique: string[] = [];
  for (const query of queries) {
    if (!query || query.length < MIN_QUERY_CHARS) continue;
    const key = query.toLocaleLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push(query);
  }
  return unique;
}

/**
 * Runs multiple formulations against one source while exposing one source
 * result. Any successful formulation keeps the source available; only an
 * across-the-board failure marks it unavailable.
 */
export async function combineSourceQueries(
  source: Source,
  queries: readonly string[],
  search: (query: string) => Promise<Result<RawCandidate[]>>,
): Promise<Result<RawCandidate[]>> {
  if (queries.length === 0) return ok(source, []);
  const results = await Promise.all(queries.map(search));
  const successes = results.filter((result) => result.ok);
  if (successes.length > 0) {
    return ok(
      source,
      mergeCandidates(successes.flatMap((result) => result.value)),
    );
  }
  const reasons = [...new Set(
    results.flatMap((result) => result.ok ? [] : [result.reason]),
  )];
  return err(source, reasons.join("; "));
}

export async function searchAllResults(
  description: string,
  keywords?: string[],
  queries?: QueryInput,
): Promise<Result<RawCandidate[]>[]> {
  const fallbackKeywords = keywords ?? extractKeywords(description, 4);
  const plan = buildQueryPlan(description, fallbackKeywords, queries);
  const { category, outcome, synonyms } = plan.formulations;
  const npmQueries = uniqueQueries(category, synonyms).slice(0, 2);
  const gitLabQueries = uniqueQueries(category, outcome);
  const showHnQueries = uniqueQueries(category, outcome, synonyms);

  const generic = Promise.all([
    searchGitHubPlanResult(plan),
    combineSourceQueries(
      "npm",
      npmQueries,
      (query) => searchNpmResult(description, [query]),
    ),
    combineSourceQueries("gitlab", gitLabQueries, searchGitLabResult),
    combineSourceQueries("hackernews", showHnQueries, searchShowHnResult),
    searchTavilyDiscoveryResult(category, synonyms),
  ]);
  const python = plan.ecosystem === "python"
    ? searchPythonResult(description, [category])
    : undefined;
  const registry = searchRegistryResults(plan.ecosystem, category);

  const results = await generic;
  if (python) results.push(await python);
  results.push(...await registry);
  return results;
}

/** Flattened view for callers that do not care which source failed. */
export async function searchAll(
  description: string,
  keywords?: string[],
  queries?: QueryInput,
): Promise<RawCandidate[]> {
  const results = await searchAllResults(description, keywords, queries);
  return results.flatMap((r) => (r.ok ? r.value : []));
}
