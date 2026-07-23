import { z } from "zod";
import type { RawCandidate } from "../candidate.js";
import { httpGet, httpPostJson } from "../http.js";
import { err, ok, unavailable, type Result } from "../result.js";

const SEARCH_URL = "https://api.tavily.com/search";
const TIMEOUT_MS = 8_000;
const USER_AGENT = "reuse-before-generate-mcp/0.4";

const TavilySearchResponse = z.object({
  results: z.array(z.object({
    title: z.string(),
    url: z.string(),
    content: z.string(),
    score: z.number(),
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
}

function repositoryReference(value: string): RepositoryReference | undefined {
  try {
    const url = new URL(value);
    const hostname = url.hostname.toLowerCase().replace(/^www\./, "");
    const pathParts = url.pathname.split("/").filter(Boolean);
    if (pathParts.length < 2) return undefined;
    const repositoryPath = `${pathParts[0]}/${pathParts[1]}`;
    if (hostname === "github.com") {
      return {
        url: value,
        apiUrl: `https://api.github.com/repos/${repositoryPath}`,
        provider: "github",
      };
    }
    if (hostname === "gitlab.com") {
      return {
        url: value,
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
});

const GitLabRepositoryResponse = z.object({
  last_activity_at: z.string().nullable(),
  archived: z.boolean(),
  star_count: z.number(),
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
      }
      : {};
  } catch {
    return {};
  }
}

export async function searchTavilyResult(
  query: string,
  limit = 10,
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
        include_raw_content: false,
      },
      TIMEOUT_MS,
    );
    if (!response.ok) return err("web", `HTTP ${response.status}`);

    const parsed = TavilySearchResponse.safeParse(await response.json());
    if (!parsed.success) return err("web", "unexpected response shape");

    const candidates = await Promise.all(
      parsed.data.results.map(async (item, index) => {
        const repo = repositoryReference(item.url);
        const metadata = repo ? await repositoryMetadata(repo) : {};
        return {
          source: "web" as const,
          id: item.url,
          name: item.title,
          url: item.url,
          description: item.content,
          kind: repo ? "open_source" as const : "unknown" as const,
          ...(repo ? { repositoryUrl: repo.url } : {}),
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
