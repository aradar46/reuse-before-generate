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
  /\b(?:alternatives?|best(?:\s+\d+)?|comparison|guide|how to|quora|reddit|reviews?|stackexchange|top(?:\s+\d+)?|what is|youtube)\b/i;
const AWESOME_PATTERN = /\bawesome[- ]|\/awesome[-/]/i;
const INFORMATIONAL_PATH_PATTERN =
  /\/(?:article|articles|blog|blogs|guide|guides|post|posts|questions?|reviews?)(?:\/|$)/i;

function normalizedToken(token: string): string {
  if (token.length > 5 && token.endsWith("ies")) {
    return `${token.slice(0, -3)}y`;
  }
  if (token.length > 5 && token.endsWith("ing")) {
    const stem = token.slice(0, -3).replace(/([b-df-hj-np-tv-z])\1$/, "$1");
    return stem;
  }
  if (token.length > 4 && token.endsWith("ied")) {
    return `${token.slice(0, -3)}y`;
  }
  if (token.length > 4 && token.endsWith("ed")) {
    return token.slice(0, -2).replace(/([b-df-hj-np-tv-z])\1$/, "$1");
  }
  if (token.length > 4 && token.endsWith("ly")) return token.slice(0, -2);
  if (token.length > 4 && /(?:ches|shes|xes|zes|sses)$/.test(token)) {
    return token.slice(0, -2);
  }
  if (token.length > 3 && token.endsWith("s") && !token.endsWith("ss")) {
    return token.slice(0, -1);
  }
  return token;
}

function exactTokens(value: string): string[] {
  return value
    .toLocaleLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .split(/\s+/)
    .filter((token) => token.length > 1 && !STOP_WORDS.has(token));
}

function tokens(
  value: string,
  normalize = false,
  includeCompounds = false,
): string[] {
  const exact = exactTokens(value);
  const result = normalize ? exact.map(normalizedToken) : exact;
  if (!includeCompounds) return result;
  return [
    ...result,
    ...result.slice(0, -1).map((token, index) => `${token}${result[index + 1]}`),
  ];
}

function coverage(
  needle: string,
  haystack: Set<string>,
  normalize = false,
): number {
  const wanted = [...new Set(tokens(needle, normalize))];
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
    candidate.homepageUrl ?? "",
    ...(candidate.topics ?? []),
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
  const ranked = candidates
    .map((candidate) => {
      const text = candidateText(candidate);
      const haystack = new Set(tokens(text));
      const normalizedHaystack = new Set(tokens(text, true, true));
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
      const normalizedCategoryCoverage = coverage(
        plan.formulations.category,
        normalizedHaystack,
        true,
      );
      const normalizedOutcomeCoverage = coverage(
        plan.formulations.outcome,
        normalizedHaystack,
        true,
      );
      const normalizedSynonymCoverage = plan.formulations.synonyms
        ? coverage(plan.formulations.synonyms, normalizedHaystack, true)
        : 0;
      if (categoryCoverage >= 0.5) {
        signals.push(`category coverage: ${Math.round(categoryCoverage * 100)}%`);
      } else if (normalizedCategoryCoverage >= 0.5) {
        signals.push(
          `normalized category coverage: ${Math.round(normalizedCategoryCoverage * 100)}%`,
        );
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
      const informationalIdentity = [
        candidate.name,
        candidate.url,
        ...candidate.evidence.map((item) => item.title),
      ].join(" ");
      if (
        !repositoryEvidence
        && (
          INFORMATIONAL_PATTERN.test(informationalIdentity)
          || INFORMATIONAL_PATH_PATTERN.test(candidate.url)
        )
      ) {
        penalty += 0.65;
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
      const workflowCoverage = Math.max(outcomeCoverage, synonymCoverage);
      const normalizedWorkflowCoverage = Math.max(
        normalizedOutcomeCoverage,
        normalizedSynonymCoverage,
      );
      const semanticFit =
        normalizedCategoryCoverage * 0.55
        + normalizedWorkflowCoverage * 0.45;
      const authorityScore = candidate.stars === undefined
        ? 0
        : bounded(Math.log10(candidate.stars + 1) / 5, 0, 1);
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
        semanticFit: Number(semanticFit.toFixed(4)),
        authorityScore: Number(authorityScore.toFixed(4)),
        rankingSignals: signals,
        rankingPenalties: penalties,
        discoveryTier: tier(candidate, score, penalties),
      };
    })
    .sort((left, right) =>
      (right.localScore ?? 0) - (left.localScore ?? 0)
      || right.retrievalScore - left.retrievalScore);

  const reuse = ranked.filter((candidate) => candidate.pool === "reuse");
  const competition = ranked.filter(
    (candidate) => candidate.pool === "competition",
  );
  return [
    ...diversifyReuse(reuse, plan),
    ...competition,
  ];
}

function diversifyReuse<T extends RankedCandidate>(
  candidates: readonly T[],
  plan: QueryPlan,
): T[] {
  if (candidates.length <= 5 || plan.artifactType === "library") {
    return [...candidates];
  }
  const selected: T[] = candidates.slice(0, 3);
  const selectedUrls = new Set(selected.map((candidate) => candidate.canonicalUrl));
  const eligible = candidates.slice(0, 25).filter((candidate) =>
    (candidate.stars ?? 0) >= 1_000
    && (
      (candidate.semanticFit ?? 0) >= 0.35
      || (candidate.localScore ?? 0) >= 0.45
    )
    && (candidate.rankingPenalties?.length ?? 0) === 0);
  const authority = [...eligible].sort((left, right) =>
    (right.authorityScore ?? 0) - (left.authorityScore ?? 0)
    || (right.localScore ?? 0) - (left.localScore ?? 0))[0];
  if (authority && !selectedUrls.has(authority.canonicalUrl)) {
    selected.push({
      ...authority,
      rankingSignals: [...(authority.rankingSignals ?? []), "authority slot"],
    });
    selectedUrls.add(authority.canonicalUrl);
  }

  const niche = candidates.slice(0, 25).find((candidate) =>
    candidate.discoveryTier === "promising_niche"
    && (candidate.localScore ?? 0) >= 0.45
    && !selectedUrls.has(candidate.canonicalUrl));
  if (niche) {
    selected.push({
      ...niche,
      rankingSignals: [...(niche.rankingSignals ?? []), "niche slot"],
    });
    selectedUrls.add(niche.canonicalUrl);
  }
  for (const candidate of candidates) {
    if (selected.length >= 5) break;
    if (selectedUrls.has(candidate.canonicalUrl)) continue;
    selected.push(candidate);
    selectedUrls.add(candidate.canonicalUrl);
  }
  return [
    ...selected,
    ...candidates.filter((candidate) =>
      !selectedUrls.has(candidate.canonicalUrl)),
  ];
}
