import type { CandidateKind, Evidence, RawCandidate } from "./candidate.js";
import type { Source } from "./result.js";

const TRACKING_PARAMETER = /^(?:utm_.+|ref|referrer)$/i;
const ISO_DATE_PREFIX = /^\d{4}-\d{2}-\d{2}/;
const AUTHORITATIVE_ACTIVITY_SOURCES: ReadonlySet<Source> = new Set([
  "github",
  "npm",
  "python",
  "gitlab",
  "crates",
  "rubygems",
  "packagist",
  "maven",
]);

/** Produces a stable URL key without throwing on malformed upstream data. */
export function canonicalizeUrl(raw: string): string {
  const trimmed = raw.trim();
  try {
    const url = new URL(trimmed);
    url.hostname = url.hostname.toLowerCase().replace(/^www\./, "");
    url.hash = "";
    for (const key of [...url.searchParams.keys()]) {
      if (TRACKING_PARAMETER.test(key)) url.searchParams.delete(key);
    }
    if (url.pathname.length > 1) url.pathname = url.pathname.replace(/\/+$/, "");
    url.pathname = url.pathname.replace(/\.git$/i, "");
    return url.toString().replace(/\/$/, "");
  } catch {
    return trimmed;
  }
}

function kindPrecedence(kind: CandidateKind): number {
  if (kind === "open_source") return 2;
  if (kind === "commercial") return 1;
  return 0;
}

const NON_REPOSITORY_ROOTS = new Set([
  "about",
  "collections",
  "dashboard",
  "explore",
  "features",
  "groups",
  "issues",
  "login",
  "marketplace",
  "orgs",
  "pricing",
  "search",
  "settings",
  "sponsors",
  "topics",
  "users",
]);

/** Recognizes repository destinations without treating every arbitrary URL
 * from discovery sources as open source. */
function recognizedRepositoryUrl(raw: string | undefined): string | undefined {
  if (!raw) return undefined;
  try {
    const url = new URL(raw.trim());
    const host = url.hostname.toLowerCase().replace(/^www\./, "");
    if (host !== "github.com" && host !== "gitlab.com") return undefined;
    const segments = url.pathname.split("/").filter(Boolean);
    if (segments.length < 2 || NON_REPOSITORY_ROOTS.has(segments[0].toLowerCase())) {
      return undefined;
    }
    if (host === "github.com") {
      url.pathname = `/${segments.slice(0, 2).join("/")}`;
    } else {
      const marker = segments.indexOf("-");
      url.pathname = `/${segments.slice(0, marker >= 2 ? marker : segments.length).join("/")}`;
    }
    url.hostname = host;
    url.search = "";
    url.hash = "";
    return canonicalizeUrl(url.toString());
  } catch {
    return undefined;
  }
}

function inferredRepositoryUrl(candidate: RawCandidate): string | undefined {
  if (candidate.repositoryUrl) {
    return recognizedRepositoryUrl(candidate.repositoryUrl)
      ?? canonicalizeUrl(candidate.repositoryUrl);
  }
  return recognizedRepositoryUrl(candidate.url)
    ?? candidate.evidence
      .map((item) => recognizedRepositoryUrl(item.destinationUrl))
      .find((url): url is string => url !== undefined);
}

/**
 * Uses intentionally narrow evidence: a business-like description alone is
 * not enough to label a project commercial.
 */
export function classifyCandidate(candidate: RawCandidate): CandidateKind {
  if (inferredRepositoryUrl(candidate) || candidate.kind === "open_source") return "open_source";
  if (candidate.kind === "commercial") return "commercial";

  const evidence = [
    candidate.description,
    ...candidate.evidence.flatMap((item) => [item.title, item.snippet, item.sourceUrl, item.destinationUrl]),
  ].join(" ");
  return /\b(?:commercial|paid plan|pricing|subscription|hosted\s+saas)\b/i.test(evidence)
    ? "commercial"
    : "unknown";
}

function evidenceKey(evidence: Evidence): string {
  return `${evidence.source}\u0000${evidence.sourceId}\u0000${evidence.query}`;
}

function isValidRank(rank: number): boolean {
  return Number.isFinite(rank) && rank > 0;
}

function dedupeEvidence(evidence: readonly Evidence[]): Evidence[] {
  const best = new Map<string, Evidence>();
  for (const item of evidence) {
    const key = evidenceKey(item);
    const current = best.get(key);
    if (!current) {
      best.set(key, item);
      continue;
    }
    const itemIsValid = isValidRank(item.rank);
    const currentIsValid = isValidRank(current.rank);
    if ((itemIsValid && !currentIsValid) || (itemIsValid && currentIsValid && item.rank < current.rank)) {
      best.set(key, item);
    }
  }
  return [...best.values()];
}

function richerNumber(left: number | undefined, right: number | undefined): number | undefined {
  if (left === undefined) return right;
  if (right === undefined) return left;
  return Math.max(left, right);
}

function validActivityTime(value: string | undefined): number | undefined {
  if (!value || !ISO_DATE_PREFIX.test(value)) return undefined;
  const time = Date.parse(value);
  return Number.isNaN(time) ? undefined : time;
}

function freshestPushedAt(
  current: string | undefined,
  candidate: RawCandidate,
): string | undefined {
  const next = AUTHORITATIVE_ACTIVITY_SOURCES.has(candidate.source)
    ? candidate.pushedAt
    : undefined;
  if (!next) return current;
  if (!current) return next;
  const currentTime = validActivityTime(current);
  const nextTime = validActivityTime(next);
  if (nextTime !== undefined && (currentTime === undefined || nextTime > currentTime)) {
    return next;
  }
  return current;
}

/**
 * Collapses observations of the same repository (or destination where no
 * repository is known), retaining every independently useful evidence item.
 */
export function mergeCandidates(candidates: readonly RawCandidate[]): RawCandidate[] {
  const normalized = candidates.map((candidate): RawCandidate => {
    const repositoryUrl = inferredRepositoryUrl(candidate);
    const classified = classifyCandidate(candidate);
    const prepared = {
      ...candidate,
      kind: classified,
      evidence: dedupeEvidence(candidate.evidence),
      ...(repositoryUrl ? { repositoryUrl } : {}),
    };
    if (!AUTHORITATIVE_ACTIVITY_SOURCES.has(candidate.source)) {
      delete prepared.pushedAt;
    }
    return prepared;
  });

  const parent = normalized.map((_, index) => index);
  const find = (index: number): number => {
    let root = index;
    while (parent[root] !== root) root = parent[root];
    while (parent[index] !== index) {
      const next = parent[index];
      parent[index] = root;
      index = next;
    }
    return root;
  };
  const union = (left: number, right: number): void => {
    const leftRoot = find(left);
    const rightRoot = find(right);
    if (leftRoot === rightRoot) return;
    const stableRoot = Math.min(leftRoot, rightRoot);
    parent[Math.max(leftRoot, rightRoot)] = stableRoot;
  };
  const aliases = new Map<string, number>();
  const addAlias = (set: Set<string>, raw: string | undefined): void => {
    if (!raw) return;
    const canonical = canonicalizeUrl(raw);
    if (canonical) set.add(canonical);
    const repository = recognizedRepositoryUrl(raw);
    if (repository) set.add(repository);
  };

  for (const [index, candidate] of normalized.entries()) {
    const identities = new Set<string>();
    addAlias(identities, candidate.repositoryUrl);
    addAlias(identities, candidate.packageUrl);
    addAlias(identities, candidate.url);
    for (const item of candidate.evidence) addAlias(identities, item.destinationUrl);
    for (const identity of identities) {
      const owner = aliases.get(identity);
      if (owner !== undefined) union(index, owner);
      else aliases.set(identity, index);
    }
  }

  const groups = new Map<number, RawCandidate[]>();
  for (const [index, candidate] of normalized.entries()) {
    const root = find(index);
    const group = groups.get(root);
    if (group) group.push(candidate);
    else groups.set(root, [candidate]);
  }

  return [...groups.values()].map(([first, ...rest]) =>
    rest.reduce((current, candidate) => {
      const currentKind = classifyCandidate(current);
      const candidateKind = classifyCandidate(candidate);
      const kind = kindPrecedence(candidateKind) > kindPrecedence(currentKind)
        ? candidateKind
        : currentKind;
      return {
      ...current,
      kind,
      repositoryUrl: current.repositoryUrl ?? candidate.repositoryUrl,
      packageUrl: current.packageUrl ?? candidate.packageUrl,
      stars: richerNumber(current.stars, candidate.stars),
      traction: current.traction ?? candidate.traction,
      pushedAt: freshestPushedAt(current.pushedAt, candidate),
      archived: current.archived ?? candidate.archived,
      evidence: dedupeEvidence([...current.evidence, ...candidate.evidence]),
      };
    }, first),
  );
}

export const normalizeUrl = canonicalizeUrl;
export const mergeDuplicateCandidates = mergeCandidates;
