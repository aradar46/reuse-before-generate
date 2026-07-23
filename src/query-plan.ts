import type { Ecosystem, QueryFormulations } from "./candidate.js";

/** The structured form supplied by new callers. */
export interface QueryInput {
  category: string;
  outcome: string;
  synonyms: string[];
  /** Directly supplied searches take precedence over generated ones. */
  queries?: string[];
  /** Accepted as a descriptive alias for callers that already use the name. */
  formulations?: string[];
}

/** Compatibility shape for the existing description-and-keywords entry point. */
export interface LegacyQueryInput {
  description: string;
  keywords: string[];
  category?: never;
  outcome?: never;
  synonyms?: never;
  queries?: string[];
  formulations?: string[];
}

export interface QueryPlan {
  category: string;
  outcome: string;
  synonyms: string[];
  formulations: QueryFormulations;
  ecosystem?: Ecosystem;
}

function normalize(value: string): string {
  return value.trim().replace(/\s+/g, " ");
}

function normalizeAll(values: readonly string[] | undefined): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const value of values ?? []) {
    const normalized = normalize(value);
    if (normalized && !seen.has(normalized)) {
      seen.add(normalized);
      out.push(normalized);
    }
  }
  return out;
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
 * Builds a normalized query plan without manufacturing terminology. Existing
 * keyword callers receive a conservative compatibility plan; structured
 * callers may override all generated queries with explicit formulations.
 */
export function buildQueryPlan(input: QueryInput | LegacyQueryInput): QueryPlan {
  const isLegacy = "description" in input;
  const category = normalize(isLegacy ? input.keywords.join(" ") : input.category);
  const outcome = normalize(isLegacy ? input.description : input.outcome);
  const synonyms = isLegacy ? [] : normalizeAll(input.synonyms);
  const explicit = normalizeAll(input.queries ?? input.formulations);
  const formulations = explicit.length > 0 ? explicit : category ? [category] : [];
  const ecosystem = detectEcosystem(category, outcome, ...synonyms, ...formulations);

  return ecosystem
    ? { category, outcome, synonyms, formulations, ecosystem }
    : { category, outcome, synonyms, formulations };
}

export const createQueryPlan = buildQueryPlan;
export const planQueries = buildQueryPlan;
