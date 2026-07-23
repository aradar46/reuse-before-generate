import type { Evidence, RankedCandidate } from "./candidate.js";
import { canonicalizeUrl, mergeCandidates } from "./canonicalize.js";
import type { RawCandidate } from "./candidate.js";

export const RRF_K = 60;

function candidateUrl(candidate: RawCandidate): string {
  return candidate.repositoryUrl
    ?? candidate.url;
}

function rrfScore(evidence: readonly Evidence[]): number {
  const bestRanks = new Map<string, number>();
  for (const item of evidence) {
    if (!Number.isFinite(item.rank) || item.rank < 0) continue;
    const key = `${item.source}\u0000${item.query}`;
    const previous = bestRanks.get(key);
    if (previous === undefined || item.rank < previous) bestRanks.set(key, item.rank);
  }
  let score = 0;
  for (const rank of bestRanks.values()) score += 1 / (RRF_K + rank);
  return score;
}

/** Merges duplicate observations, scores independent retrieval evidence, and pools results. */
export function fuseCandidates(candidates: readonly RawCandidate[]): RankedCandidate[] {
  return mergeCandidates(candidates)
    .map((candidate) => {
      const canonicalUrl = canonicalizeUrl(candidateUrl(candidate));
      return {
        ...candidate,
        canonicalUrl,
        pool: candidate.kind === "open_source" ? "reuse" : "competition",
        retrievalScore: rrfScore(candidate.evidence),
      } satisfies RankedCandidate;
    })
    .sort((left, right) =>
      right.retrievalScore - left.retrievalScore
      || (left.canonicalUrl < right.canonicalUrl ? -1 : left.canonicalUrl > right.canonicalUrl ? 1 : 0),
    );
}

export const fuse = fuseCandidates;
