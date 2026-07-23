import type { Ecosystem, QueryFormulations } from "./candidate.js";

export const ARTIFACT_TYPES = [
  "application",
  "service",
  "cli",
  "library",
] as const;

export type ArtifactType = (typeof ARTIFACT_TYPES)[number];

/** The structured form supplied by new callers. */
export interface QueryInput {
  category: string;
  outcome: string;
  synonyms: string;
  constraints?: string[];
  priorities?: string[];
  artifactType?: ArtifactType;
}

export interface QueryPlan {
  formulations: QueryFormulations;
  constraints: string[];
  priorities: string[];
  artifactType: ArtifactType;
  ecosystem?: Ecosystem;
}

function normalize(value: string): string {
  return value.trim().replace(/\s+/g, " ");
}

function normalizeList(values: readonly string[] | undefined): string[] {
  const seen = new Set<string>();
  const constraints: string[] = [];
  for (const raw of values ?? []) {
    const value = normalize(raw);
    const key = value.toLocaleLowerCase();
    if (!value || seen.has(key)) continue;
    seen.add(key);
    constraints.push(value);
  }
  return constraints;
}

export function inferArtifactType(...texts: readonly string[]): ArtifactType {
  const text = texts.join(" ").toLocaleLowerCase();
  if (/\b(?:library|sdk|package|module|component|plugin|framework)\b/.test(text)) {
    return "library";
  }
  if (/\b(?:command[- ]line|cli|terminal utility|console utility)\b/.test(text)) {
    return "cli";
  }
  if (/\b(?:hosted|service|saas|api service|platform server)\b/.test(text)) {
    return "service";
  }
  return "application";
}

/** Detect only ecosystems that are explicitly signalled by the query text. */
export function detectEcosystem(...texts: readonly string[]): Ecosystem | undefined {
  const text = texts.join(" ").toLowerCase();
  if (/\bpython\b|\bpypi\b/.test(text)) return "python";
  if (/\brust\b|\bcargo\b|\bcrates?(?:\.io)?\b/.test(text)) return "rust";
  if (/\bruby\b|\brubygems?\b/.test(text)) return "ruby";
  if (/\bphp\b|\bcomposer\b|\bpackagist\b/.test(text)) return "php";
  if (/\bjava\b|\bkotlin\b|\bscala\b|\bjvm\b|\bmaven\b|\bgradle\b/.test(text)) return "jvm";
  return undefined;
}

/**
 * Builds a normalized query plan without manufacturing terminology.
 * Structured input replaces legacy search formulations, while ecosystem
 * signals are retained across both the original and structured input.
 */
export function buildQueryPlan(
  description: string,
  keywords: string[],
  queries?: QueryInput,
): QueryPlan {
  const category = normalize(queries?.category ?? keywords.join(" "));
  const outcome = normalize(queries?.outcome ?? description);
  const synonyms = queries === undefined ? undefined : normalize(queries.synonyms);
  const constraints = normalizeList(queries?.constraints);
  const priorities = normalizeList(queries?.priorities);
  const formulations: QueryFormulations = synonyms
    ? { category, outcome, synonyms }
    : { category, outcome };
  const artifactType = queries?.artifactType ?? inferArtifactType(
    description,
    ...keywords,
    category,
    outcome,
    synonyms ?? "",
  );
  const ecosystem = detectEcosystem(
    description,
    ...keywords,
    category,
    outcome,
    synonyms ?? "",
    ...constraints,
    ...priorities,
  );

  return ecosystem
    ? { formulations, constraints, priorities, artifactType, ecosystem }
    : { formulations, constraints, priorities, artifactType };
}
