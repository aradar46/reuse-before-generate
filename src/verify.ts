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

// Every source sends a full ISO 8601 timestamp (GitHub `pushed_at`, npm
// `date`, PyPI `upload_time_iso_8601`), so anything that is not at least
// YYYY-MM-DD is bad data, not an unusual date format. Requiring that shape
// matters because `new Date()` is far more permissive than it looks: "0"
// parses as the year 2000 and "99" as 1998, both perfectly valid Dates. Left
// to Number.isNaN alone, that garbage would be reported as a genuinely
// stale project ~9700 days old rather than as the upstream problem it is.
const ISO_DATE_PREFIX = /^\d{4}-\d{2}-\d{2}/;

function activityAge(iso: string | undefined): ActivityAge {
  if (!iso) return { kind: "missing" };
  // A missing date and a date we could not parse are different upstream
  // problems: the first is normal for some npm records, the second means
  // the response shape changed or the registry emitted something odd.
  if (!ISO_DATE_PREFIX.test(iso)) return { kind: "unparseable", raw: iso };
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return { kind: "unparseable", raw: iso };
  return { kind: "known", days: Math.floor((Date.now() - then) / (1000 * 60 * 60 * 24)) };
}

export async function verifyCandidate(
  candidate: RawCandidate,
): Promise<VerifiedCandidate> {
  const age = activityAge(candidate.pushedAt);
  const days = age.kind === "known" ? age.days : null;

  if (candidate.archived) {
    // Archived wins as the headline reason — it is the decisive, actionable
    // fact — but a bad date is still appended rather than swallowed.
    // Otherwise shape drift stays invisible for exactly the candidates most
    // likely to expose it.
    const dateNote =
      age.kind === "unparseable" ? ` (also: unparseable activity date: ${age.raw})` : "";
    return {
      ...candidate,
      maintained: false,
      maintenanceReason: `repository is archived${dateNote}`,
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
