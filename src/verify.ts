// "Verified-maintained" gate: cheap heuristics to filter out dead/abandoned
// candidates before they're shown as alternatives. Deliberately conservative
// — false negatives (hiding a maintained project) are cheaper than false
// positives (recommending a dead one) for this tool's purpose.
//
// Note: this checks RECENCY, not popularity. An earlier version also
// required >=10 stars, on the theory that near-zero-star repos are noise.
// That's wrong: a brand-new repo pushed hours ago with 0 stars is exactly
// the kind of early duplicate this tool exists to catch — arguably more
// actionable than a popular one, since nobody else has piled effort into
// it yet. (Found via a real test: three small, genuinely on-point, 0-star
// GitHub Actions debugger repos — all pushed within the same week — were
// being silently dropped by the star filter.) Star count belongs in the
// re-rank/scoring step as a "how established is this" signal, not in the
// binary maintained/abandoned gate.

import type { RawCandidate } from "./search.js";

export interface VerifiedCandidate extends RawCandidate {
  maintained: boolean;
  maintenanceReason: string;
  daysSinceLastActivity: number | null;
}

const MAINTAINED_WINDOW_DAYS = 365; // pushed/published within the last year

function daysSince(iso: string | undefined): number | null {
  if (!iso) return null;
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return null;
  return Math.floor((Date.now() - then) / (1000 * 60 * 60 * 24));
}

export async function verifyCandidate(
  candidate: RawCandidate,
): Promise<VerifiedCandidate> {
  const days = daysSince(candidate.pushedAt);

  if (candidate.archived) {
    return {
      ...candidate,
      maintained: false,
      maintenanceReason: "repository is archived",
      daysSinceLastActivity: days,
    };
  }

  if (days === null) {
    return {
      ...candidate,
      maintained: false,
      maintenanceReason: "no activity date available",
      daysSinceLastActivity: null,
    };
  }

  if (days > MAINTAINED_WINDOW_DAYS) {
    return {
      ...candidate,
      maintained: false,
      maintenanceReason: `no activity in ${days} days (> ${MAINTAINED_WINDOW_DAYS}-day window)`,
      daysSinceLastActivity: days,
    };
  }

  return {
    ...candidate,
    maintained: true,
    maintenanceReason: `active within the last ${days} days`,
    daysSinceLastActivity: days,
  };
}

export async function verifyAll(
  candidates: RawCandidate[],
): Promise<VerifiedCandidate[]> {
  return Promise.all(candidates.map(verifyCandidate));
}
