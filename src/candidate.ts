import type { Source } from "./result.js";

export type CandidateKind = "open_source" | "commercial" | "unknown";
export type ResultPool = "reuse" | "competition";
export type Ecosystem = "python" | "rust" | "ruby" | "php" | "jvm";
export type RepositorySubstance =
  | "published_package"
  | "substantial_repository"
  | "minimal_repository"
  | "unknown";

export interface ConstraintEvidence {
  constraint: string;
  status: "claimed" | "unknown";
  sources: Source[];
}

export interface QueryFormulations {
  category: string;
  outcome: string;
  synonyms?: string;
}

export interface Evidence {
  source: Source;
  sourceId: string;
  sourceUrl: string;
  destinationUrl: string;
  title: string;
  snippet: string;
  query: string;
  rank: number;
  date?: string;
}

/** Transport-neutral candidate shape for every retrieval source. */
export interface RawCandidate {
  source: Source;
  id: string;
  name: string;
  url: string;
  description: string;
  stars?: number;
  forks?: number;
  repositorySizeKb?: number;
  pushedAt?: string;
  archived?: boolean;
  kind: CandidateKind;
  evidence: Evidence[];
  repositoryUrl?: string;
  homepageUrl?: string;
  packageUrl?: string;
  topics?: string[];
  traction?: string;
}

export interface RankedCandidate extends RawCandidate {
  canonicalUrl: string;
  pool: ResultPool;
  retrievalScore: number;
  localScore?: number;
  semanticFit?: number;
  authorityScore?: number;
  repositorySubstance?: RepositorySubstance;
  constraintEvidence?: ConstraintEvidence[];
  rankingSignals?: string[];
  rankingPenalties?: string[];
  discoveryTier?:
    | "strong_reuse"
    | "promising_niche"
    | "adjacent_building_block"
    | "commercial_competitor";
}
