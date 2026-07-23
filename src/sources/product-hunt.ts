import { XMLParser, XMLValidator } from "fast-xml-parser";
import type { QueryFormulations, RawCandidate } from "../candidate.js";
import { httpGet } from "../http.js";
import { err, ok, type Result } from "../result.js";

const USER_AGENT = "reuse-before-generate-mcp/0.3";
const FEED_URL = "https://www.producthunt.com/feed";

interface FeedItem {
  id: string;
  title: string;
  description: string;
  url: string;
  date?: string;
}

function record(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined;
}

function text(value: unknown): string | undefined {
  if (typeof value === "string") return value;
  if (typeof value === "number") return String(value);
  const object = record(value);
  if (object && typeof object["#text"] === "string") return object["#text"];
  return undefined;
}

function stripMarkup(value: string): string {
  return value.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
}

function atomLink(value: unknown): string | undefined {
  const values = Array.isArray(value) ? value : [value];
  for (const candidate of values) {
    if (typeof candidate === "string") return candidate;
    const object = record(candidate);
    if (object && typeof object["@_href"] === "string") return object["@_href"];
  }
  return undefined;
}

function parseRssItem(value: unknown): FeedItem | undefined {
  const item = record(value);
  if (!item) return undefined;
  const title = text(item.title);
  const description = text(item.description);
  const url = text(item.link);
  if (title === undefined || description === undefined || url === undefined) {
    return undefined;
  }
  const id = text(item.guid) ?? url;
  const date = text(item.pubDate);
  return {
    id,
    title: stripMarkup(title),
    description: stripMarkup(description),
    url,
    ...(date ? { date } : {}),
  };
}

function parseAtomItem(value: unknown): FeedItem | undefined {
  const item = record(value);
  if (!item) return undefined;
  const title = text(item.title);
  const description = text(item.content) ?? text(item.summary);
  const url = atomLink(item.link);
  if (title === undefined || description === undefined || url === undefined) {
    return undefined;
  }
  const id = text(item.id) ?? url;
  const date = text(item.published) ?? text(item.updated);
  return {
    id,
    title: stripMarkup(title),
    description: stripMarkup(description),
    url,
    ...(date ? { date } : {}),
  };
}

function parseFeed(xml: string): Result<FeedItem[]> {
  const validation = XMLValidator.validate(xml);
  if (validation !== true) {
    return err("producthunt", `malformed XML: ${validation.err.msg}`);
  }
  const parsed = new XMLParser({
    ignoreAttributes: false,
    trimValues: true,
  }).parse(xml) as unknown;
  const root = record(parsed);
  const channel = record(record(root?.rss)?.channel);
  const atom = record(root?.feed);
  if (!channel && !atom) return err("producthunt", "unexpected response shape");

  const rawItems = channel ? channel.item : atom?.entry;
  if (rawItems === undefined) {
    const hasFeedMetadata =
      text((channel ?? atom)?.title) !== undefined;
    return hasFeedMetadata
      ? ok("producthunt", [])
      : err("producthunt", "unexpected response shape");
  }
  const values = Array.isArray(rawItems) ? rawItems : [rawItems];
  const items = values.map(channel ? parseRssItem : parseAtomItem);
  if (items.some((item) => item === undefined)) {
    return err("producthunt", "unexpected response shape");
  }
  return ok("producthunt", items as FeedItem[]);
}

function terms(value: string): Set<string> {
  return new Set(
    (value.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? [])
      .filter((term) => term.length > 2),
  );
}

function matchingQuery(
  item: FeedItem,
  formulations: QueryFormulations,
): string | undefined {
  const contentTerms = terms(`${item.title} ${item.description}`);
  for (const query of [
    formulations.category,
    formulations.outcome,
    formulations.synonyms,
  ]) {
    if (!query) continue;
    const queryTerms = terms(query);
    let matches = 0;
    for (const term of queryTerms) {
      if (contentTerms.has(term)) matches += 1;
    }
    if (matches >= 2) return query;
  }
  return undefined;
}

export async function searchProductHuntResult(
  formulations: QueryFormulations,
): Promise<Result<RawCandidate[]>> {
  try {
    const response = await httpGet(FEED_URL, { "User-Agent": USER_AGENT });
    if (!response.ok) return err("producthunt", `HTTP ${response.status}`);
    const feed = parseFeed(await response.text());
    if (!feed.ok) return feed;

    const candidates: RawCandidate[] = [];
    feed.value.forEach((item, index) => {
      const query = matchingQuery(item, formulations);
      if (!query) return;
      candidates.push({
        source: "producthunt",
        id: item.id,
        name: item.title,
        url: item.url,
        description: item.description,
        kind: "unknown",
        evidence: [
          {
            source: "producthunt",
            sourceId: item.id,
            sourceUrl: item.url,
            destinationUrl: item.url,
            title: item.title,
            snippet: item.description,
            query,
            rank: index + 1,
            ...(item.date ? { date: item.date } : {}),
          },
        ],
      });
    });
    return ok("producthunt", candidates);
  } catch (error) {
    return err(
      "producthunt",
      error instanceof Error ? error.message : String(error),
    );
  }
}
