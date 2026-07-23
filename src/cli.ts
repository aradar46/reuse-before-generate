#!/usr/bin/env node
// Local driver for the search pipeline. Exists so search quality can be
// iterated directly ("does this keyword set surface the tool I know is out
// there?") without registering the MCP server and spending an agent turn on
// every attempt.
//
// Usage:
//   npm run check -- "a tool that formats python code" --keywords black,formatter,style
//   npm run check -- "a tool that formats python code"        (auto-extract)

import { argv as processArgv } from "node:process";
import { fileURLToPath } from "node:url";
import {
  ARTIFACT_TYPES,
  buildQueryPlan,
  type ArtifactType,
  type QueryInput,
} from "./query-plan.js";
import { searchAllResults } from "./search.js";
import { prepareCandidates, type PreparedCandidate } from "./verify.js";
import { formatCoverage } from "./report.js";

interface Args {
  description: string;
  keywords?: string[];
  queries?: QueryInput;
}

export function parseArgs(argv: string[]): Args {
  const args = argv.slice(2);
  const description: string[] = [];
  const values = new Map<string, string>();
  const flags = new Map([
    ["--keywords", "keywords"],
    ["-k", "keywords"],
    ["--category", "category"],
    ["--outcome", "outcome"],
    ["--synonyms", "synonyms"],
    ["--constraints", "constraints"],
    ["--artifact-type", "artifactType"],
  ]);

  for (let index = 0; index < args.length; index += 1) {
    const key = flags.get(args[index]);
    if (!key) {
      description.push(args[index]);
      continue;
    }
    const value = args[index + 1];
    if (value !== undefined && !flags.has(value)) {
      values.set(key, value.trim());
      index += 1;
    }
  }

  const keywords = (values.get("keywords") ?? "")
    .split(",")
    .map((k) => k.trim())
    .filter(Boolean);
  const category = values.get("category") ?? "";
  const outcome = values.get("outcome") ?? "";
  const synonyms = values.get("synonyms") ?? "";
  const constraints = (values.get("constraints") ?? "")
    .split(",")
    .map((constraint) => constraint.trim())
    .filter(Boolean);
  const rawArtifactType = values.get("artifactType");
  const artifactType = ARTIFACT_TYPES.find((value) =>
    value === rawArtifactType) as ArtifactType | undefined;
  const queries = category && outcome && synonyms
    ? {
      category,
      outcome,
      synonyms,
      ...(constraints.length > 0 ? { constraints } : {}),
      ...(artifactType ? { artifactType } : {}),
    }
    : undefined;

  return {
    description: description.join(" ").trim(),
    keywords: keywords.length > 0 ? keywords : undefined,
    queries,
  };
}

function printCandidates(candidates: readonly PreparedCandidate[]): void {
  for (const [index, candidate] of candidates.entries()) {
    const sources = [...new Set(candidate.evidence.map((item) => item.source))];
    console.log(`${index + 1}. ${candidate.name || candidate.id}`);
    if (candidate.description) console.log(`   ${candidate.description.slice(0, 160)}`);
    console.log(`   retrieved via ${sources.join(", ")} · score ${candidate.retrievalScore.toFixed(4)}`);
    console.log(`   ${candidate.url}`);
  }
  if (candidates.length === 0) {
    console.log("(no candidates retrieved for this section; this does not prove none exist)");
  }
}

async function main(): Promise<void> {
  const { description, keywords, queries } = parseArgs(process.argv);

  if (!description) {
    console.error(
      'Usage: npm run check -- "<description>" [--keywords a,b,c] [--category "..."] [--outcome "..."] [--synonyms "..."] [--constraints a,b] [--artifact-type application|service|cli|library]',
    );
    process.exit(2);
  }

  console.log(`description: ${description}`);
  console.log(`keywords:    ${keywords ? keywords.join(", ") : "(auto-extracted)"}\n`);

  const results = await searchAllResults(description, keywords, queries);

  const raw = results.flatMap((r) => (r.ok ? r.value : []));
  const plan = buildQueryPlan(
    description,
    keywords ?? [],
    queries,
  );
  const candidates = await prepareCandidates(raw, plan);
  const reuse = candidates.filter((candidate) => candidate.pool === "reuse");
  const competition = candidates.filter((candidate) => candidate.pool === "competition");
  const coverage = formatCoverage(results);

  console.log("Projects you could reuse");
  printCandidates(reuse);
  console.log("\nProducts you would compete with");
  printCandidates(competition);
  console.log(`\n${coverage.text}`);
}

// Only run when invoked as a program. Importing this module (as the unit
// test does, to exercise parseArgs) must not execute a search against the
// importer's own argv.
const invokedDirectly =
  processArgv[1] !== undefined &&
  fileURLToPath(import.meta.url) === processArgv[1];

if (invokedDirectly) {
  main().catch((err) => {
    console.error("cli failed:", (err as Error).message);
    process.exit(1);
  });
}
