import type { Ecosystem, QueryFormulations } from "./candidate.js";

/** The structured form supplied by new callers. */
export interface QueryInput {
  category: string;
  outcome: string;
  synonyms: string;
}

export interface QueryPlan {
  formulations: QueryFormulations;
  ecosystem?: Ecosystem;
}

function normalize(value: string): string {
  return value.trim().replace(/\s+/g, " ");
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
 * Builds a normalized query plan without manufacturing terminology. The
 * optional structured input replaces the legacy description-and-keywords
 * formulation in full.
 */
export function buildQueryPlan(
  description: string,
  keywords: string[],
  queries?: QueryInput,
): QueryPlan {
  const category = normalize(queries?.category ?? keywords.join(" "));
  const outcome = normalize(queries?.outcome ?? description);
  const synonyms = queries === undefined ? undefined : normalize(queries.synonyms);
  const formulations: QueryFormulations = synonyms
    ? { category, outcome, synonyms }
    : { category, outcome };
  const ecosystem = detectEcosystem(description, ...keywords, category, outcome, synonyms ?? "");

  return ecosystem
    ? { formulations, ecosystem }
    : { formulations };
}
