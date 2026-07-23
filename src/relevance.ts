import type { RankedCandidate } from "./candidate.js";
import type { QueryPlan } from "./query-plan.js";

const STOP_WORDS = new Set([
  "a", "an", "and", "as", "at", "be", "by", "for", "from", "in", "into",
  "is", "it", "of", "on", "or", "that", "the", "to", "with",
  "app", "application", "build", "building", "product", "project", "software",
  "tool", "using",
]);

const COMPONENT_PATTERN =
  /\b(?:adapter|client|component|connector|extension|integration|middleware|plugin|sdk|template|theme|widget|wrapper)\b/i;
const INFORMATIONAL_PATTERN =
  /\b(?:best \d+|comparison|guide|how to|reddit|top \d+|what is|youtube)\b/i;
const AWESOME_PATTERN = /\bawesome[- ]|\/awesome[-/]/i;

function tokens(value: string): string[] {
  return value
    .toLocaleLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .split(/\s+/)
    .filter((token) => token.length > 1 && !STOP_WORDS.has(token));
}

function coverage(needle: string, haystack: Set<string>): number {
  const wanted = [...new Set(tokens(needle))];
  if (wanted.length === 0) return 0;
  return wanted.filter((token) => haystack.has(token)).length / wanted.length;
}

function bounded(value: number, minimum: number, maximum: number): number {
  return Math.max(minimum, Math.min(maximum, value));
}

function candidateText(candidate: RankedCandidate): string {
  return [
    candidate.name,
    candidate.description,
    candidate.url,
    ...candidate.evidence.flatMap((item) => [item.title, item.snippet]),
  ].join(" ");
}

function evidenceSources(candidate: RankedCandidate): Set<string> {
  return new Set(candidate.evidence.map((item) => item.source));
}

function tier(
  candidate: RankedCandidate,
  score: number,
  penalties: readonly string[],
): NonNullable<RankedCandidate["discoveryTier"]> {
  if (candidate.pool === "competition") return "commercial_competitor";
  if (
    penalties.some((penalty) =>
      penalty.includes("component or integration")
      || penalty.includes("informational page")
      || penalty.includes("curated list"))
    || score < 0.3
  ) {
    return "adjacent_building_block";
  }
  if ((candidate.stars ?? Number.POSITIVE_INFINITY) <= 3) {
    return "promising_niche";
  }
  return "strong_reuse";
}

/**
 * A transparent prescore, not a semantic verdict. It corrects predictable
 * retrieval bias (especially package-registry duplication), rewards intent
 * and constraint coverage, then leaves final same-job judgment to the caller.
 */
export function rankCandidates<T extends RankedCandidate>(
  candidates: readonly T[],
  plan: QueryPlan,
): T[] {
  return candidates
    .map((candidate) => {
      const text = candidateText(candidate);
      const haystack = new Set(tokens(text));
      const signals: string[] = [];
      const penalties: string[] = [];
      const sources = evidenceSources(candidate);
      const uniqueQueries = new Set(
        candidate.evidence.map((item) => item.query.toLocaleLowerCase()),
      ).size;

      const categoryCoverage = coverage(plan.formulations.category, haystack);
      const outcomeCoverage = coverage(plan.formulations.outcome, haystack);
      const synonymCoverage = plan.formulations.synonyms
        ? coverage(plan.formulations.synonyms, haystack)
        : 0;
      if (categoryCoverage >= 0.5) {
        signals.push(`category coverage: ${Math.round(categoryCoverage * 100)}%`);
      }
      if (Math.max(outcomeCoverage, synonymCoverage) >= 0.4) {
        signals.push(
          `workflow coverage: ${Math.round(Math.max(outcomeCoverage, synonymCoverage) * 100)}%`,
        );
      }

      let constraintMatches = 0;
      for (const constraint of plan.constraints) {
        if (coverage(constraint, haystack) === 1) {
          constraintMatches += 1;
          signals.push(`constraint: ${constraint.toLocaleLowerCase()}`);
        }
      }
      const constraintCoverage = plan.constraints.length === 0
        ? 0
        : constraintMatches / plan.constraints.length;

      const repositoryEvidence = [...sources].some((source) =>
        source === "github" || source === "gitlab" || source === "python");
      const packageOnly = sources.size === 1 && sources.has("npm");
      if (repositoryEvidence) signals.push("repository evidence");
      if (uniqueQueries > 1) signals.push(`${uniqueQueries} query lanes agree`);
      if (sources.size > 1) signals.push(`${sources.size} sources agree`);

      let penalty = 0;
      if (
        packageOnly
        && (plan.artifactType === "application" || plan.artifactType === "service")
      ) {
        penalty += 0.5;
        penalties.push("package-only evidence for an application or service");
      } else if (packageOnly && plan.artifactType === "cli") {
        penalty += 0.22;
        penalties.push("package-only evidence for a CLI");
      }
      if (plan.artifactType !== "library" && COMPONENT_PATTERN.test(text)) {
        penalty += 0.22;
        penalties.push("component or integration shape");
      }
      if (INFORMATIONAL_PATTERN.test(text)) {
        penalty += 0.4;
        penalties.push("informational page rather than a project or product");
      }
      if (AWESOME_PATTERN.test(text)) {
        penalty += 0.45;
        penalties.push("curated list rather than an implementation");
      }

      const retrieval = bounded(candidate.retrievalScore * 6, 0, 0.2);
      const laneAgreement = bounded((uniqueQueries - 1) * 0.04, 0, 0.08);
      const sourceAgreement = bounded((sources.size - 1) * 0.06, 0, 0.06);
      const repositoryFit =
        plan.artifactType !== "library" && repositoryEvidence ? 0.1 : 0;
      const popularityContext = candidate.stars === undefined
        ? 0
        : bounded(Math.log10(candidate.stars + 1) * 0.01, 0, 0.04);
      const score = bounded(
        retrieval
          + categoryCoverage * 0.34
          + Math.max(outcomeCoverage, synonymCoverage) * 0.22
          + constraintCoverage * 0.3
          + laneAgreement
          + sourceAgreement
          + repositoryFit
          + popularityContext
          - penalty,
        -1,
        1,
      );

      return {
        ...candidate,
        localScore: Number(score.toFixed(4)),
        rankingSignals: signals,
        rankingPenalties: penalties,
        discoveryTier: tier(candidate, score, penalties),
      };
    })
    .sort((left, right) =>
      (right.localScore ?? 0) - (left.localScore ?? 0)
      || right.retrievalScore - left.retrievalScore);
}
