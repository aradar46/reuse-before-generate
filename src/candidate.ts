import type { Source } from "./result.js";

export type CandidateKind = "open_source" | "commercial" | "unknown";
export type ResultPool = "reuse" | "competition";
export type Ecosystem = "python" | "rust" | "ruby" | "php" | "jvm";

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
  pushedAt?: string;
  archived?: boolean;
  kind: CandidateKind;
  evidence: Evidence[];
  repositoryUrl?: string;
  packageUrl?: string;
  traction?: string;
}

export interface RankedCandidate extends RawCandidate {
  canonicalUrl: string;
  pool: ResultPool;
  retrievalScore: number;
  localScore?: number;
  rankingSignals?: string[];
  rankingPenalties?: string[];
  discoveryTier?:
    | "strong_reuse"
    | "promising_niche"
    | "adjacent_building_block"
    | "commercial_competitor";
}
