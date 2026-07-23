import { z } from "zod";
import type { Ecosystem, RawCandidate } from "../candidate.js";
import { encodeUrlComponent, httpGet } from "../http.js";
import { err, ok, type Result, type Source } from "../result.js";

const USER_AGENT = "reuse-before-generate-mcp/0.9";
const HEADERS = { "User-Agent": USER_AGENT };

const CratesSearchResponse = z.object({
  crates: z.array(
    z.object({
      id: z.string(),
      name: z.string(),
      description: z.string().nullable(),
      repository: z.string().nullable().optional(),
      updated_at: z.string(),
      downloads: z.number(),
    }),
  ),
});

const RubyGemsSearchResponse = z.array(
  z.object({
    name: z.string(),
    info: z.string(),
    project_uri: z.string(),
    source_code_uri: z.string().nullable().optional(),
    version_created_at: z.string().optional(),
    downloads: z.number(),
  }),
);

const PackagistSearchResponse = z.object({
  results: z.array(
    z.object({
      name: z.string(),
      description: z.string(),
      url: z.string(),
      repository: z.string(),
      downloads: z.number(),
      favers: z.number(),
    }),
  ),
});

const PackagistDetailResponse = z.object({
  package: z.object({
    versions: z.record(
      z.object({
        time: z.string().optional(),
      }),
    ),
  }),
});

const MavenSearchResponse = z.object({
  response: z.object({
    docs: z.array(
      z.object({
        id: z.string(),
        g: z.string(),
        a: z.string(),
        latestVersion: z.string(),
        timestamp: z.number().refine(
          (timestamp) => !Number.isNaN(new Date(timestamp).getTime()),
        ),
      }),
    ),
  }),
});

function failureReason(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

async function validatedJson<T>(
  source: Source,
  url: string,
  schema: z.ZodType<T>,
): Promise<Result<T>> {
  try {
    const response = await httpGet(url, HEADERS);
    if (!response.ok) return err(source, `HTTP ${response.status}`);
    const parsed = schema.safeParse(await response.json());
    return parsed.success
      ? ok(source, parsed.data)
      : err(source, "unexpected response shape");
  } catch (error) {
    return err(source, failureReason(error));
  }
}

export async function searchCratesResult(
  query: string,
  limit = 10,
): Promise<Result<RawCandidate[]>> {
  const url =
    `https://crates.io/api/v1/crates?q=${encodeUrlComponent(query)}` +
    `&per_page=${limit}`;
  const result = await validatedJson("crates", url, CratesSearchResponse);
  if (!result.ok) return result;
  return ok(
    "crates",
    result.value.crates.map((crate, index) => {
      const packageUrl = `https://crates.io/crates/${encodeUrlComponent(crate.id)}`;
      const destinationUrl = crate.repository || packageUrl;
      const description = crate.description ?? "";
      return {
        source: "crates",
        id: crate.id,
        name: crate.name,
        url: destinationUrl,
        description,
        pushedAt: crate.updated_at,
        kind: "open_source",
        ...(crate.repository ? { repositoryUrl: crate.repository } : {}),
        packageUrl,
        traction: `${crate.downloads} downloads`,
        evidence: [
          {
            source: "crates",
            sourceId: crate.id,
            sourceUrl: packageUrl,
            destinationUrl,
            title: crate.name,
            snippet: description,
            query,
            rank: index + 1,
            date: crate.updated_at,
          },
        ],
      };
    }),
  );
}

export async function searchRubyGemsResult(
  query: string,
  limit = 10,
): Promise<Result<RawCandidate[]>> {
  const url =
    `https://rubygems.org/api/v1/search.json?query=${encodeUrlComponent(query)}`;
  const result = await validatedJson("rubygems", url, RubyGemsSearchResponse);
  if (!result.ok) return result;
  return ok(
    "rubygems",
    result.value.slice(0, limit).map((gem, index) => {
      const destinationUrl = gem.source_code_uri || gem.project_uri;
      return {
        source: "rubygems",
        id: gem.name,
        name: gem.name,
        url: destinationUrl,
        description: gem.info,
        ...(gem.version_created_at
          ? { pushedAt: gem.version_created_at }
          : {}),
        kind: "open_source",
        ...(gem.source_code_uri ? { repositoryUrl: gem.source_code_uri } : {}),
        packageUrl: gem.project_uri,
        traction: `${gem.downloads} downloads`,
        evidence: [
          {
            source: "rubygems",
            sourceId: gem.name,
            sourceUrl: gem.project_uri,
            destinationUrl,
            title: gem.name,
            snippet: gem.info,
            query,
            rank: index + 1,
            ...(gem.version_created_at
              ? { date: gem.version_created_at }
              : {}),
          },
        ],
      };
    }),
  );
}

async function packagistActivity(
  name: string,
): Promise<Result<string | undefined>> {
  const url =
    `https://packagist.org/packages/${encodeUrlComponent(name)}.json`;
  const result = await validatedJson("packagist", url, PackagistDetailResponse);
  if (!result.ok) return result;
  let latest: { value: string; time: number } | undefined;
  for (const version of Object.values(result.value.package.versions)) {
    if (!version.time) continue;
    const time = Date.parse(version.time);
    if (Number.isNaN(time)) continue;
    if (!latest || time > latest.time) latest = { value: version.time, time };
  }
  return ok("packagist", latest?.value);
}

export async function searchPackagistResult(
  query: string,
  limit = 10,
): Promise<Result<RawCandidate[]>> {
  const url = `https://packagist.org/search.json?q=${encodeUrlComponent(query)}`;
  const result = await validatedJson("packagist", url, PackagistSearchResponse);
  if (!result.ok) return result;
  const packages = result.value.results.slice(0, limit);
  const detailResults = await Promise.all(
    packages.slice(0, 5).map((pkg) => packagistActivity(pkg.name)),
  );
  const detailFailure = detailResults.find((detail) => !detail.ok);
  if (detailFailure && !detailFailure.ok) {
    return err("packagist", detailFailure.reason);
  }
  const activities = packages.map((_pkg, index) => {
    const detail = detailResults[index];
    return detail?.ok ? detail.value : undefined;
  });
  return ok(
    "packagist",
    packages.map((pkg, index) => {
      const destinationUrl = pkg.repository || pkg.url;
      return {
        source: "packagist",
        id: pkg.name,
        name: pkg.name,
        url: destinationUrl,
        description: pkg.description,
        ...(activities[index] ? { pushedAt: activities[index] } : {}),
        kind: "open_source",
        repositoryUrl: pkg.repository,
        packageUrl: pkg.url,
        traction: `${pkg.downloads} downloads, ${pkg.favers} favers`,
        evidence: [
          {
            source: "packagist",
            sourceId: pkg.name,
            sourceUrl: pkg.url,
            destinationUrl,
            title: pkg.name,
            snippet: pkg.description,
            query,
            rank: index + 1,
            ...(activities[index] ? { date: activities[index] } : {}),
          },
        ],
      };
    }),
  );
}

export async function searchMavenResult(
  query: string,
  limit = 10,
): Promise<Result<RawCandidate[]>> {
  const url =
    `https://search.maven.org/solrsearch/select?q=${encodeUrlComponent(query)}` +
    `&rows=${limit}&wt=json`;
  const result = await validatedJson("maven", url, MavenSearchResponse);
  if (!result.ok) return result;
  return ok(
    "maven",
    result.value.response.docs.map((doc, index) => {
      const artifactUrl =
        `https://central.sonatype.com/artifact/${encodeUrlComponent(doc.g)}` +
        `/${encodeUrlComponent(doc.a)}/${encodeUrlComponent(doc.latestVersion)}`;
      const pushedAt = new Date(doc.timestamp).toISOString();
      const description = `${doc.id} ${doc.latestVersion}`;
      return {
        source: "maven",
        id: doc.id,
        name: doc.id,
        url: artifactUrl,
        description,
        pushedAt,
        kind: "open_source",
        packageUrl: artifactUrl,
        evidence: [
          {
            source: "maven",
            sourceId: doc.id,
            sourceUrl: artifactUrl,
            destinationUrl: artifactUrl,
            title: doc.id,
            snippet: description,
            query,
            rank: index + 1,
            date: pushedAt,
          },
        ],
      };
    }),
  );
}

export async function searchRegistryResults(
  ecosystem: Ecosystem | undefined,
  query: string,
  limit = 10,
): Promise<Result<RawCandidate[]>[]> {
  switch (ecosystem) {
    case "rust":
      return [await searchCratesResult(query, limit)];
    case "ruby":
      return [await searchRubyGemsResult(query, limit)];
    case "php":
      return [await searchPackagistResult(query, limit)];
    case "jvm":
      return [await searchMavenResult(query, limit)];
    case "python":
    case undefined:
      return [];
  }
}
