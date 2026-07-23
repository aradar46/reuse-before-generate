import type { RawCandidate } from "../candidate.js";
import { httpGet } from "../http.js";
import { err, ok, type Result } from "../result.js";
import { HackerNewsSearchResponse, type HackerNewsSearchHitT } from "../schemas.js";

const USER_AGENT = "reuse-before-generate-mcp/0.3";
const API_URL = "https://hn.algolia.com/api/v1/search";

function itemUrl(id: string): string {
  return `https://news.ycombinator.com/item?id=${encodeURIComponent(id)}`;
}

function toCandidate(hit: HackerNewsSearchHitT, query: string, rank: number): RawCandidate {
  const sourceUrl = itemUrl(hit.objectID);
  const destinationUrl = hit.url || sourceUrl;
  const title = hit.title ?? "Show HN";
  const description = hit.story_text ?? "";
  return {
    source: "hackernews",
    id: hit.objectID,
    name: title,
    url: destinationUrl,
    description,
    pushedAt: hit.created_at,
    kind: "unknown",
    ...(hit.points == null ? {} : { traction: `${hit.points} points` }),
    evidence: [
      {
        source: "hackernews",
        sourceId: hit.objectID,
        sourceUrl,
        destinationUrl,
        title,
        snippet: description,
        query,
        rank,
        date: hit.created_at,
      },
    ],
  };
}

export async function searchShowHnResult(
  query: string,
  limit = 10,
): Promise<Result<RawCandidate[]>> {
  const url =
    `${API_URL}?query=${encodeURIComponent(query)}` +
    `&tags=show_hn&hitsPerPage=${limit}`;
  try {
    const response = await httpGet(url, { "User-Agent": USER_AGENT });
    if (!response.ok) return err("hackernews", `HTTP ${response.status}`);
    const parsed = HackerNewsSearchResponse.safeParse(await response.json());
    if (!parsed.success) return err("hackernews", "unexpected response shape");
    return ok(
      "hackernews",
      parsed.data.hits.map((hit, index) => toCandidate(hit, query, index + 1)),
    );
  } catch (error) {
    return err("hackernews", error instanceof Error ? error.message : String(error));
  }
}
