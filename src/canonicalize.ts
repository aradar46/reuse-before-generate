import type { CandidateKind, Evidence, RawCandidate } from "./candidate.js";

const TRACKING_PARAMETER = /^(?:utm_.+|ref|referrer)$/i;

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
    if (url.hostname === "github.com") {
      url.pathname = url.pathname.replace(/\.git$/i, "");
    }
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

/**
 * Uses intentionally narrow evidence: a business-like description alone is
 * not enough to label a project commercial.
 */
export function classifyCandidate(candidate: RawCandidate): CandidateKind {
  if (candidate.repositoryUrl || candidate.kind === "open_source") return "open_source";
  if (candidate.kind === "commercial") return "commercial";

  const evidence = [
    candidate.description,
    ...candidate.evidence.flatMap((item) => [item.title, item.snippet, item.sourceUrl, item.destinationUrl]),
  ].join(" ");
  return /\b(?:commercial|paid plan|pricing|subscription|hosted\s+saas)\b/i.test(evidence)
    ? "commercial"
    : "unknown";
}

function candidateUrl(candidate: RawCandidate): string {
  return candidate.repositoryUrl
    ?? candidate.evidence[0]?.destinationUrl
    ?? candidate.url;
}

function evidenceKey(evidence: Evidence): string {
  return `${evidence.source}\u0000${evidence.sourceId}\u0000${evidence.query}`;
}

function dedupeEvidence(evidence: readonly Evidence[]): Evidence[] {
  const seen = new Set<string>();
  return evidence.filter((item) => {
    const key = evidenceKey(item);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function richerNumber(left: number | undefined, right: number | undefined): number | undefined {
  if (left === undefined) return right;
  if (right === undefined) return left;
  return Math.max(left, right);
}

/**
 * Collapses observations of the same repository (or destination where no
 * repository is known), retaining every independently useful evidence item.
 */
export function mergeCandidates(candidates: readonly RawCandidate[]): RawCandidate[] {
  const merged = new Map<string, RawCandidate>();
  for (const candidate of candidates) {
    const key = canonicalizeUrl(candidateUrl(candidate));
    const current = merged.get(key);
    const classified = classifyCandidate(candidate);
    if (!current) {
      merged.set(key, {
        ...candidate,
        kind: classified,
        evidence: dedupeEvidence(candidate.evidence),
      });
      continue;
    }

    const currentKind = classifyCandidate(current);
    const kind = kindPrecedence(classified) > kindPrecedence(currentKind) ? classified : currentKind;
    merged.set(key, {
      ...current,
      kind,
      repositoryUrl: current.repositoryUrl ?? candidate.repositoryUrl,
      packageUrl: current.packageUrl ?? candidate.packageUrl,
      stars: richerNumber(current.stars, candidate.stars),
      traction: richerNumber(current.traction, candidate.traction),
      pushedAt: current.pushedAt ?? candidate.pushedAt,
      archived: current.archived ?? candidate.archived,
      evidence: dedupeEvidence([...current.evidence, ...candidate.evidence]),
    });
  }
  return [...merged.values()];
}

export const normalizeUrl = canonicalizeUrl;
export const mergeDuplicateCandidates = mergeCandidates;
