import type {
  ConstraintEvidence,
  RankedCandidate,
  RepositorySubstance,
} from "./candidate.js";
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
  /\b(?:alternatives?|best(?:\s+\d+)?|comparison|definition|dictionary|encyclopedia|guide|how to|introduction|overview|quora|reddit|reviews?|solving|stackexchange|top(?:\s+\d+)?|tried(?:\s+\d+)?|tutorial|what is|which .+ choose|wiktionary|wikipedia|youtube)\b/i;
const AWESOME_PATTERN = /\bawesome[- ]|\/awesome[-/]/i;
const INFORMATIONAL_PATH_PATTERN =
  /\/(?:article|articles|blog|blogs|categor(?:y|ies)|docs?|documentation|forums?|guides?|help|learn|marketplace|posts?|pulse|questions?|reviews?|support)(?:[/?#]|$)/i;
const APPLICATION_DISTRIBUTION_HOSTS = new Set([
  "apps.apple.com",
  "apps.microsoft.com",
  "f-droid.org",
  "flathub.org",
  "play.google.com",
  "snapcraft.io",
]);
const INFORMATIONAL_HOSTS = new Set([
  "dev.to",
  "dictionary.com",
  "en.wiktionary.org",
  "facebook.com",
  "instagram.com",
  "medium.com",
  "merriam-webster.com",
  "twitter.com",
  "wikipedia.org",
  "x.com",
]);

interface EvidenceConcept {
  constraint: RegExp;
  evidence: RegExp;
}

const EVIDENCE_CONCEPTS: EvidenceConcept[] = [
  {
    constraint: /\b(?:offline|without internet|no internet)\b/i,
    evidence: /\b(?:offline|without internet|no internet|does not require (?:an )?internet connection)\b/i,
  },
  {
    constraint: /\b(?:no account|account[- ]free|without (?:an )?account|no (?:sign[ -]?up|login|registration))\b/i,
    evidence: /\b(?:no account|account[- ]free|without (?:an )?account|no (?:sign[ -]?up|login|registration)|does not require (?:an )?account)\b/i,
  },
  {
    constraint: /\b(?:local[- ]only|local[- ]first|on[- ]device|no cloud|without (?:an? )?(?:\w+\s){0,2}cloud)\b/i,
    evidence: /\b(?:local[- ]only|local[- ]first|on[- ]device|no cloud|stored? (?:only )?(?:locally|on (?:your|the) (?:device|phone))|stays? on (?:your|the) (?:device|phone)|remains? on (?:your|the) (?:device|phone))\b/i,
  },
  {
    constraint: /\b(?:android|f[- ]?droid|google play)\b/i,
    evidence: /\b(?:android|f[- ]?droid|google play)\b/i,
  },
  {
    constraint: /\b(?:ios|iphone|ipad|app store)\b/i,
    evidence: /\b(?:ios|iphone|ipad|app store|apps\.apple\.com)\b/i,
  },
  {
    constraint: /\b(?:open source|foss|free software)\b/i,
    evidence: /\b(?:open source|foss|free software|source code (?:is )?available)\b/i,
  },
  {
    constraint: /\b(?:no tracking|without tracking|tracker[- ]free)\b/i,
    evidence: /\b(?:no tracking|without tracking|tracker[- ]free|no analytics)\b/i,
  },
  {
    constraint: /\b(?:encrypt(?:ed|ion)?|sqlcipher|aes)\b/i,
    evidence: /\b(?:encrypt(?:ed|ion)?|sqlcipher|aes(?:-\d+)?)\b/i,
  },
];

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

function hasApplicationDistributionEvidence(
  candidate: RankedCandidate,
): boolean {
  const urls = [
    candidate.url,
    candidate.homepageUrl,
    ...candidate.evidence.flatMap((item) => [
      item.sourceUrl,
      item.destinationUrl,
    ]),
  ];
  return urls.some((raw) => {
    if (!raw) return false;
    try {
      const host = new URL(raw).hostname.toLocaleLowerCase()
        .replace(/^www\./, "");
      return APPLICATION_DISTRIBUTION_HOSTS.has(host);
    } catch {
      return false;
    }
  });
}

function repositorySubstance(
  candidate: RankedCandidate,
): RepositorySubstance {
  if (candidate.packageUrl && !candidate.repositoryUrl) {
    return "published_package";
  }
  if (candidate.repositorySizeKb === undefined) return "unknown";
  return candidate.repositorySizeKb <= 32
    ? "minimal_repository"
    : "substantial_repository";
}

function constraintsFor(
  candidate: RankedCandidate,
  constraints: readonly string[],
): ConstraintEvidence[] {
  return constraints.map((constraint) => {
    const sources = [...new Set(candidate.evidence
      .filter((item) => {
        const evidence = [
          item.title,
          item.snippet,
          item.sourceUrl,
          item.destinationUrl,
        ].join(" ");
        const concept = EVIDENCE_CONCEPTS.find((entry) =>
          entry.constraint.test(constraint));
        return (concept?.evidence.test(evidence) ?? false)
          || coverage(
            constraint,
            new Set(tokens(evidence, true, true)),
            true,
          ) === 1;
      })
      .map((item) => item.source))];
    return sources.length > 0
      ? { constraint, status: "claimed" as const, sources }
      : { constraint, status: "unknown" as const, sources: [] };
  });
}

function tier(
  candidate: RankedCandidate,
  score: number,
  penalties: readonly string[],
  allConstraintsUnknown: boolean,
): NonNullable<RankedCandidate["discoveryTier"]> {
  if (candidate.pool === "competition") return "existing_product";
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
  if (allConstraintsUnknown) return "adjacent_building_block";
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
      const substance = repositorySubstance(candidate);
      const constraintEvidence = constraintsFor(candidate, plan.constraints);
      const allConstraintsUnknown =
        constraintEvidence.length > 0
        && constraintEvidence.every((item) => item.status === "unknown");
      const priorities = plan.priorities ?? [];
      const priorityEvidence = constraintsFor(candidate, priorities);
      const distributionEvidence =
        plan.artifactType === "application"
        && hasApplicationDistributionEvidence(candidate);
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
      for (const evidence of constraintEvidence) {
        if (evidence.status === "claimed") {
          constraintMatches += 1;
          signals.push(`constraint: ${evidence.constraint.toLocaleLowerCase()}`);
        }
      }
      const constraintCoverage = plan.constraints.length === 0
        ? 0
        : constraintMatches / plan.constraints.length;
      let priorityBoost = 0;
      for (const [index, evidence] of priorityEvidence.entries()) {
        if (evidence.status !== "claimed") continue;
        priorityBoost += 0.16 / (2 ** index);
        signals.push(
          `priority ${index + 1}: ${evidence.constraint.toLocaleLowerCase()}`,
        );
      }
      priorityBoost = bounded(priorityBoost, 0, 0.22);

      const repositoryEvidence = [...sources].some((source) =>
        source === "github" || source === "gitlab" || source === "python");
      const packageOnly = sources.size === 1 && sources.has("npm");
      if (repositoryEvidence) signals.push("repository evidence");
      if (distributionEvidence) {
        signals.push("application distribution evidence");
      }
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
      const componentIdentity = [
        candidate.name,
        candidate.url,
      ].join(" ");
      if (
        plan.artifactType !== "library"
        && COMPONENT_PATTERN.test(componentIdentity)
      ) {
        penalty += 0.22;
        penalties.push("component or integration shape");
      }
      const informationalIdentity = [
        candidate.name,
        candidate.url,
        ...candidate.evidence.map((item) => item.title),
      ].join(" ");
      if (
        (!repositoryEvidence || candidate.pool === "competition")
        && (
          INFORMATIONAL_PATTERN.test(informationalIdentity)
          || INFORMATIONAL_PATH_PATTERN.test(candidate.url)
          || (() => {
            try {
              const candidateUrl = new URL(candidate.url);
              const host = candidateUrl.hostname
                .toLocaleLowerCase()
                .replace(/^www\./, "");
              const pathParts = candidateUrl.pathname.split("/").filter(Boolean);
              return INFORMATIONAL_HOSTS.has(host)
                || host.endsWith(".wikipedia.org")
                || host.endsWith(".wiktionary.org")
                || host.startsWith("wiki.")
                || host.startsWith("blog.")
                || host.endsWith(".blog")
                || host === "news.ycombinator.com"
                || /^(?:docs?|forums?|help|support)\./.test(host)
                || (host === "github.com" && pathParts.length < 2);
            } catch {
              return false;
            }
          })()
        )
      ) {
        penalty += 0.65;
        penalties.push("informational page rather than a project or product");
      }
      if (AWESOME_PATTERN.test(text)) {
        penalty += 0.45;
        penalties.push("curated list rather than an implementation");
      }
      if (
        substance === "minimal_repository"
        && plan.artifactType !== "library"
      ) {
        penalty += 0.55;
        penalties.push(
          `minimal repository footprint for an ${plan.artifactType}`,
        );
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
          + priorityBoost
          + laneAgreement
          + sourceAgreement
          + repositoryFit
          + (distributionEvidence ? 0.12 : 0)
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
        repositorySubstance: substance,
        constraintEvidence,
        priorityEvidence,
        rankingSignals: signals,
        rankingPenalties: penalties,
        discoveryTier: tier(
          candidate,
          score,
          penalties,
          allConstraintsUnknown,
        ),
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
    && (candidate.semanticFit ?? 0) >= 0.5
    && (candidate.rankingPenalties?.length ?? 0) === 0);
  const authority = [...eligible]
    .sort((left, right) =>
      (right.authorityScore ?? 0) - (left.authorityScore ?? 0)
      || (right.localScore ?? 0) - (left.localScore ?? 0))
    .find((candidate) => !selectedUrls.has(candidate.canonicalUrl));
  if (authority) {
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
