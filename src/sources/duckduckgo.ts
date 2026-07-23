import type { RawCandidate } from "../candidate.js";
import { httpGet } from "../http.js";
import { err, ok, type Result } from "../result.js";

const USER_AGENT = "reuse-before-generate-mcp/0.3";
const SEARCH_URL = "https://html.duckduckgo.com/html/";
const TIMEOUT_MS = 4000;

const CHALLENGE_MARKERS = [
  "challenge-form",
  "anomaly-modal",
  "bots use duckduckgo",
  "duckduckgo captcha",
];

function decodeHtml(value: string): string {
  return value
    .replace(/&#x([0-9a-f]+);/gi, (_match, digits: string) =>
      String.fromCodePoint(Number.parseInt(digits, 16)))
    .replace(/&#([0-9]+);/g, (_match, digits: string) =>
      String.fromCodePoint(Number.parseInt(digits, 10)))
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&");
}

function cleanText(value: string): string {
  return decodeHtml(value.replace(/<[^>]*>/g, " "))
    .replace(/\s+/g, " ")
    .trim();
}

function attribute(attributes: string, name: string): string | undefined {
  const match = new RegExp(
    `\\b${name}\\s*=\\s*(["'])([\\s\\S]*?)\\1`,
    "i",
  ).exec(attributes);
  return match?.[2];
}

function hasClass(attributes: string, className: string): boolean {
  const classes = attribute(attributes, "class");
  return classes?.split(/\s+/).includes(className) ?? false;
}

function destinationFromHref(href: string): string | undefined {
  try {
    const resolved = new URL(decodeHtml(href), "https://duckduckgo.com");
    if (
      resolved.hostname.endsWith("duckduckgo.com") &&
      resolved.pathname.startsWith("/l/")
    ) {
      return resolved.searchParams.get("uddg") ?? undefined;
    }
    return resolved.href;
  } catch {
    return undefined;
  }
}

interface ResultAnchor {
  attributes: string;
  titleHtml: string;
  start: number;
  end: number;
}

function resultAnchors(html: string): ResultAnchor[] {
  const anchors: ResultAnchor[] = [];
  const pattern = /<a\b([^>]*)>([\s\S]*?)<\/a>/gi;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(html)) !== null) {
    if (!hasClass(match[1] ?? "", "result__a")) continue;
    anchors.push({
      attributes: match[1] ?? "",
      titleHtml: match[2] ?? "",
      start: match.index,
      end: pattern.lastIndex,
    });
  }
  return anchors;
}

function snippetFrom(segment: string): string {
  const pattern = /<(a|div|span)\b([^>]*)>([\s\S]*?)<\/\1>/gi;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(segment)) !== null) {
    if (hasClass(match[2] ?? "", "result__snippet")) {
      return cleanText(match[3] ?? "");
    }
  }
  return "";
}

export function parseDuckDuckGoHtml(
  html: string,
  query: string,
): Result<RawCandidate[]> {
  const lower = html.toLowerCase();
  if (CHALLENGE_MARKERS.some((marker) => lower.includes(marker))) {
    return err("web", "challenge response");
  }

  const anchors = resultAnchors(html);
  if (anchors.length === 0) {
    const isKnownEmpty =
      lower.includes("no-results") || lower.includes("no results found");
    return isKnownEmpty
      ? ok("web", [])
      : err("web", "unexpected response shape");
  }
  const candidates: RawCandidate[] = [];
  anchors.forEach((anchor, index) => {
    const href = attribute(anchor.attributes, "href");
    const destinationUrl = href ? destinationFromHref(href) : undefined;
    if (!destinationUrl) return;
    const next = anchors[index + 1];
    const segment = html.slice(anchor.end, next?.start);
    const title = cleanText(anchor.titleHtml);
    const snippet = snippetFrom(segment);
    candidates.push({
      source: "web",
      id: destinationUrl,
      name: title,
      url: destinationUrl,
      description: snippet,
      kind: "unknown",
      evidence: [
        {
          source: "web",
          sourceId: destinationUrl,
          sourceUrl: destinationUrl,
          destinationUrl,
          title,
          snippet,
          query,
          rank: index + 1,
        },
      ],
    });
  });
  return ok("web", candidates);
}

async function fetchQuery(query: string): Promise<Result<RawCandidate[]>> {
  const url = `${SEARCH_URL}?q=${encodeURIComponent(query)}`;
  try {
    const response = await httpGet(
      url,
      { "User-Agent": USER_AGENT },
      TIMEOUT_MS,
    );
    if (!response.ok) return err("web", `HTTP ${response.status}`);
    return parseDuckDuckGoHtml(await response.text(), query);
  } catch (error) {
    return err("web", error instanceof Error ? error.message : String(error));
  }
}

export async function searchWebResult(
  category: string,
): Promise<Result<RawCandidate[]>> {
  const productHuntQuery = `site:producthunt.com/products ${category}`;
  const results = await Promise.all([
    fetchQuery(category),
    fetchQuery(productHuntQuery),
  ]);
  const failure = results.find((result) => !result.ok);
  if (failure && !failure.ok) return failure;
  return ok(
    "web",
    results.flatMap((result) => result.ok ? result.value : []),
  );
}
