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

type ActivityAge =
  | { kind: "known"; days: number }
  | { kind: "missing" }
  | { kind: "unparseable"; raw: string };

function activityAge(iso: string | undefined): ActivityAge {
  if (!iso) return { kind: "missing" };
  const then = new Date(iso).getTime();
  // A missing date and a date we could not parse are different upstream
  // problems: the first is normal for some npm records, the second means
  // the response shape changed or the registry emitted something odd.
  if (Number.isNaN(then)) return { kind: "unparseable", raw: iso };
  return { kind: "known", days: Math.floor((Date.now() - then) / (1000 * 60 * 60 * 24)) };
}

export async function verifyCandidate(
  candidate: RawCandidate,
): Promise<VerifiedCandidate> {
  const age = activityAge(candidate.pushedAt);
  const days = age.kind === "known" ? age.days : null;

  if (candidate.archived) {
    return {
      ...candidate,
      maintained: false,
      maintenanceReason: "repository is archived",
      daysSinceLastActivity: days,
    };
  }

  if (age.kind === "missing") {
    return {
      ...candidate,
      maintained: false,
      maintenanceReason: "no activity date available",
      daysSinceLastActivity: null,
    };
  }

  if (age.kind === "unparseable") {
    return {
      ...candidate,
      maintained: false,
      maintenanceReason: `unparseable activity date: ${age.raw}`,
      daysSinceLastActivity: null,
    };
  }

  if (age.days > MAINTAINED_WINDOW_DAYS) {
    return {
      ...candidate,
      maintained: false,
      maintenanceReason: `no activity in ${age.days} days (> ${MAINTAINED_WINDOW_DAYS}-day window)`,
      daysSinceLastActivity: age.days,
    };
  }

  return {
    ...candidate,
    maintained: true,
    maintenanceReason: `active within the last ${age.days} days`,
    daysSinceLastActivity: age.days,
  };
}

export async function verifyAll(
  candidates: RawCandidate[],
): Promise<VerifiedCandidate[]> {
  return Promise.all(candidates.map(verifyCandidate));
}
