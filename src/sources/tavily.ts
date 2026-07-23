import { z } from "zod";
import type { RawCandidate } from "../candidate.js";
import { mergeCandidates } from "../canonicalize.js";
import { httpGet, httpPostJson } from "../http.js";
import type { QueryPlan } from "../query-plan.js";
import { err, ok, unavailable, type Result } from "../result.js";

const SEARCH_URL = "https://api.tavily.com/search";
const TIMEOUT_MS = 8_000;
const USER_AGENT = "reuse-before-generate-mcp/0.9";

const TavilySearchResponse = z.object({
  results: z.array(z.object({
    title: z.string(),
    url: z.string(),
    content: z.string(),
    score: z.number(),
    raw_content: z.string().nullable().optional(),
  })),
});

interface RepositoryReference {
  url: string;
  apiUrl: string;
  provider: "github" | "gitlab";
}

interface RepositoryMetadata {
  pushedAt?: string;
  archived?: boolean;
  stars?: number;
  forks?: number;
  repositorySizeKb?: number;
}

function repositoryReference(value: string): RepositoryReference | undefined {
  try {
    const url = new URL(value);
    const hostname = url.hostname.toLowerCase().replace(/^www\./, "");
    const pathParts = url.pathname.split("/").filter(Boolean);
    if (pathParts.length < 2) return undefined;
    if (hostname === "github.com") {
      const repositoryPath = `${pathParts[0]}/${pathParts[1]}`;
      return {
        url: `https://github.com/${repositoryPath}`,
        apiUrl: `https://api.github.com/repos/${repositoryPath}`,
        provider: "github",
      };
    }
    if (hostname === "gitlab.com") {
      const separator = pathParts.indexOf("-");
      const projectParts = separator === -1
        ? pathParts
        : pathParts.slice(0, separator);
      if (projectParts.length < 2) return undefined;
      const repositoryPath = projectParts.join("/");
      return {
        url: `https://gitlab.com/${repositoryPath}`,
        apiUrl: `https://gitlab.com/api/v4/projects/${encodeURIComponent(repositoryPath)}`,
        provider: "gitlab",
      };
    }
    return undefined;
  } catch {
    return undefined;
  }
}

const GitHubRepositoryResponse = z.object({
  pushed_at: z.string().nullable(),
  archived: z.boolean(),
  stargazers_count: z.number(),
  size: z.number().optional(),
  forks_count: z.number().optional(),
});

const GitLabRepositoryResponse = z.object({
  last_activity_at: z.string().nullable(),
  archived: z.boolean(),
  star_count: z.number(),
  forks_count: z.number().optional(),
});

async function repositoryMetadata(
  reference: RepositoryReference,
): Promise<RepositoryMetadata> {
  try {
    const headers: Record<string, string> = { "User-Agent": USER_AGENT };
    if (reference.provider === "github") {
      headers.Accept = "application/vnd.github+json";
      const token = process.env.GITHUB_TOKEN?.trim();
      if (token) headers.Authorization = `Bearer ${token}`;
    }
    const response = await httpGet(reference.apiUrl, headers, TIMEOUT_MS);
    if (!response.ok) return {};
    const json: unknown = await response.json();
    if (reference.provider === "github") {
      const parsed = GitHubRepositoryResponse.safeParse(json);
      return parsed.success
        ? {
          ...(parsed.data.pushed_at ? { pushedAt: parsed.data.pushed_at } : {}),
          archived: parsed.data.archived,
          stars: parsed.data.stargazers_count,
          ...(parsed.data.forks_count !== undefined
            ? { forks: parsed.data.forks_count }
            : {}),
          ...(parsed.data.size !== undefined
            ? { repositorySizeKb: parsed.data.size }
            : {}),
        }
        : {};
    }
    const parsed = GitLabRepositoryResponse.safeParse(json);
    return parsed.success
      ? {
        ...(parsed.data.last_activity_at
          ? { pushedAt: parsed.data.last_activity_at }
          : {}),
        archived: parsed.data.archived,
        stars: parsed.data.star_count,
        ...(parsed.data.forks_count !== undefined
          ? { forks: parsed.data.forks_count }
          : {}),
      }
      : {};
  } catch {
    return {};
  }
}

export async function searchTavilyResult(
  query: string,
  limit = 10,
  options: {
    includeRawContent?: boolean;
    includeDomains?: string[];
  } = {},
): Promise<Result<RawCandidate[]>> {
  const token = process.env.TAVILY_API_KEY?.trim();
  if (!token) {
    return unavailable("web", "TAVILY_API_KEY not configured");
  }

  try {
    const response = await httpPostJson(
      SEARCH_URL,
      { Authorization: `Bearer ${token}` },
      {
        query,
        search_depth: "basic",
        max_results: limit,
        include_answer: false,
        include_raw_content: options.includeRawContent === true,
        ...(options.includeDomains && options.includeDomains.length > 0
          ? { include_domains: options.includeDomains }
          : {}),
      },
      TIMEOUT_MS,
    );
    if (!response.ok) return err("web", `HTTP ${response.status}`);

    const parsed = TavilySearchResponse.safeParse(await response.json());
    if (!parsed.success) return err("web", "unexpected response shape");

    const candidates = await Promise.all(
      parsed.data.results.map(async (item, index) => {
        const directRepo = repositoryReference(item.url);
        const linkedRepo = options.includeRawContent
          ? repositoryReferenceFromContent(
            item.raw_content,
            `${item.title} ${item.url}`,
          )
          : undefined;
        const repo = directRepo ?? linkedRepo;
        const metadata = repo ? await repositoryMetadata(repo) : {};
        return {
          source: "web" as const,
          id: item.url,
          name: item.title,
          url: item.url,
          description: item.content,
          kind: repo ? "open_source" as const : "unknown" as const,
          ...(repo ? { repositoryUrl: repo.url } : {}),
          ...(repo && !directRepo ? { homepageUrl: item.url } : {}),
          ...metadata,
          traction: `web relevance ${item.score.toFixed(3)}`,
          evidence: [
            {
              source: "web" as const,
              sourceId: item.url,
              sourceUrl: item.url,
              destinationUrl: item.url,
              title: item.title,
              snippet: item.content,
              query,
              rank: index + 1,
            },
          ],
        };
      }),
    );
    return ok("web", candidates);
  } catch (error) {
    return err(
      "web",
      error instanceof Error ? error.message : String(error),
    );
  }
}

function repositoryReferenceFromContent(
  content: string | null | undefined,
  productIdentity: string,
): RepositoryReference | undefined {
  if (!content) return undefined;
  const matches = [...content.matchAll(
    /https?:\/\/(?:www\.)?(?:github\.com|gitlab\.com)\/[^\s)\]>"']+/gi,
  )];
  const references = new Map<
    string,
    { reference: RepositoryReference; contextScore: number }
  >();
  for (const match of matches) {
    const reference = repositoryReference(match[0]);
    if (!reference) continue;
    const index = match.index ?? 0;
    const context = content.slice(
      Math.max(0, index - 100),
      Math.min(content.length, index + match[0].length + 60),
    );
    const before = content.slice(Math.max(0, index - 50), index);
    let contextScore = 0;
    if (/(?:source(?:\s+code)?|repository|repo)\s*[:=\]()>-]*\s*$/i.test(before)) {
      contextScore += 6;
    }
    if (/\b(?:canonical|official)\b/i.test(context)) contextScore += 3;
    if (/\bmirror\b/i.test(context)) contextScore -= 5;
    if (/\b(?:build metadata|fdroiddata|site template|theme)\b/i.test(context)) {
      contextScore -= 4;
    }
    const current = references.get(reference.url);
    if (!current || contextScore > current.contextScore) {
      references.set(reference.url, { reference, contextScore });
    }
  }
  if (references.size === 1) return [...references.values()][0]?.reference;
  const productTokens = identityTokens(productIdentity);
  const ranked = [...references.values()]
    .map(({ reference, contextScore }) => ({
      reference,
      contextScore,
      overlap: [...identityTokens(reference.url)]
        .filter((token) => productTokens.has(token)).length,
    }))
    .sort((left, right) =>
      (right.contextScore + right.overlap)
      - (left.contextScore + left.overlap));
  return ((ranked[0]?.contextScore ?? 0) > 0 || (ranked[0]?.overlap ?? 0) > 0)
    ? ranked[0]?.reference
    : undefined;
}

function identityTokens(value: string): Set<string> {
  const ignored = new Set([
    "app",
    "application",
    "github",
    "gitlab",
    "official",
    "source",
    "software",
    "template",
    "website",
  ]);
  return new Set(value
    .toLocaleLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .split(/\s+/)
    .filter((token) => token.length >= 3 && !ignored.has(token)));
}

function compactConstraints(plan: QueryPlan): string {
  return plan.constraints.slice(0, 3).join(" ");
}

interface DiscoveryQuery {
  query: string;
  includeRawContent: boolean;
  includeDomains?: string[];
}

function applicationDistributionQueries(plan: QueryPlan): DiscoveryQuery[] {
  if (plan.artifactType !== "application") return [];
  const text = [
    plan.formulations.category,
    plan.formulations.outcome,
    plan.formulations.synonyms ?? "",
    ...plan.constraints,
    ...(plan.priorities ?? []),
  ].join(" ").toLocaleLowerCase();
  const queries: DiscoveryQuery[] = [];
  if (/\b(?:android|f-droid|google play)\b/.test(text)) {
    queries.push({
      query: `${plan.formulations.category} Android F-Droid app`,
      includeRawContent: true,
      includeDomains: ["f-droid.org"],
    });
  }
  if (/\b(?:ios|iphone|ipad|app store)\b/.test(text)) {
    queries.push({
      query: `${plan.formulations.synonyms ?? plan.formulations.category} iOS App Store app`,
      includeRawContent: true,
      includeDomains: ["apps.apple.com"],
    });
  }
  return queries;
}

function discoveryQueries(plan: QueryPlan): {
  reuse: string;
  product: string;
} {
  const category = plan.formulations.category;
  const productName = plan.formulations.synonyms?.trim() || category;
  const constraints = compactConstraints(plan);
  const qualified = (value: string, suffix: string): string =>
    [value, constraints, suffix].filter(Boolean).join(" ");
  switch (plan.artifactType) {
    case "application":
      return {
        reuse: qualified(category, "open source app"),
        product: qualified(productName, "official app"),
      };
    case "service":
      return {
        reuse: qualified(category, "open source self-hosted"),
        product: qualified(productName, "official hosted software pricing"),
      };
    case "cli":
      return {
        reuse: qualified(category, "open source command line"),
        product: qualified(productName, "official CLI software"),
      };
    case "library":
      return {
        reuse: qualified(category, "open source library"),
        product: qualified(productName, "official developer library"),
      };
  }
}

/**
 * Keeps reusable implementations and existing products in separate recall
 * lanes. Product-oriented pages otherwise crowd repositories out of a single
 * broad web query, while an open-source-only query hides useful competition.
 */
export async function searchTavilyDiscoveryResult(
  plan: QueryPlan,
): Promise<Result<RawCandidate[]>> {
  if (!process.env.TAVILY_API_KEY?.trim()) {
    return unavailable("web", "TAVILY_API_KEY not configured");
  }

  const { reuse: reuseQuery, product: productQuery } = discoveryQueries(plan);
  const queries: DiscoveryQuery[] = [
    { query: reuseQuery, includeRawContent: true },
    { query: productQuery, includeRawContent: true },
    ...applicationDistributionQueries(plan),
  ];
  const uniqueQueries = [...new Map(
    queries.map((query) => [query.query.toLocaleLowerCase(), query]),
  ).values()];
  const results = await Promise.all(uniqueQueries.map((query) =>
    searchTavilyResult(
      query.query,
      5,
      {
        includeRawContent: query.includeRawContent,
        ...(query.includeDomains
          ? { includeDomains: query.includeDomains }
          : {}),
      },
    )));
  const successes = results.filter((result) => result.ok);
  if (successes.length > 0) {
    return ok(
      "web",
      mergeCandidates(successes.flatMap((result) => result.value)),
    );
  }
  const reasons = [...new Set(
    results.flatMap((result) => result.ok ? [] : [result.reason]),
  )];
  return err("web", reasons.join("; "));
}
