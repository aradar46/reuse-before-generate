import type { RawCandidate } from "../candidate.js";
import { encodeUrlComponent, httpGet } from "../http.js";
import { err, ok, type Result } from "../result.js";
import { GitLabSearchResponse, type GitLabSearchItemT } from "../schemas.js";

const USER_AGENT = "reuse-before-generate-mcp/0.7";
const API_URL = "https://gitlab.com/api/v4/projects";

function toCandidate(item: GitLabSearchItemT, query: string, rank: number): RawCandidate {
  const id = String(item.id);
  const description = item.description ?? "";
  return {
    source: "gitlab",
    id,
    name: item.name_with_namespace,
    url: item.web_url,
    description,
    stars: item.star_count,
    pushedAt: item.last_activity_at,
    // The request filters archived=false, so this is an upstream-enforced
    // invariant rather than a value invented from the list response.
    archived: false,
    kind: "open_source",
    repositoryUrl: item.web_url,
    evidence: [
      {
        source: "gitlab",
        sourceId: id,
        sourceUrl: item.web_url,
        destinationUrl: item.web_url,
        title: item.name_with_namespace,
        snippet: description,
        query,
        rank,
        date: item.last_activity_at,
      },
    ],
  };
}

export async function searchGitLabResult(
  query: string,
  limit = 10,
): Promise<Result<RawCandidate[]>> {
  try {
    const url =
      `${API_URL}?search=${encodeUrlComponent(query)}` +
      `&archived=false&per_page=${limit}&order_by=last_activity_at`;
    const response = await httpGet(url, { "User-Agent": USER_AGENT });
    if (!response.ok) return err("gitlab", `HTTP ${response.status}`);
    const parsed = GitLabSearchResponse.safeParse(await response.json());
    if (!parsed.success) return err("gitlab", "unexpected response shape");
    return ok(
      "gitlab",
      parsed.data.map((item, index) => toCandidate(item, query, index + 1)),
    );
  } catch (error) {
    return err("gitlab", error instanceof Error ? error.message : String(error));
  }
}
