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
import { searchAllResults } from "./search.js";
import { verifyAll } from "./verify.js";

interface Args {
  description: string;
  keywords?: string[];
}

export function parseArgs(argv: string[]): Args {
  const args = argv.slice(2);
  const kwIndex = args.findIndex((a) => a === "--keywords" || a === "-k");
  if (kwIndex === -1) {
    return { description: args.join(" ").trim() };
  }
  const description = args.slice(0, kwIndex).join(" ").trim();
  const keywords = (args[kwIndex + 1] ?? "")
    .split(",")
    .map((k) => k.trim())
    .filter(Boolean);
  return { description, keywords: keywords.length > 0 ? keywords : undefined };
}

async function main(): Promise<void> {
  const { description, keywords } = parseArgs(process.argv);

  if (!description) {
    console.error('Usage: npm run check -- "<description>" [--keywords a,b,c]');
    process.exit(2);
  }

  console.log(`description: ${description}`);
  console.log(`keywords:    ${keywords ? keywords.join(", ") : "(auto-extracted)"}\n`);

  const results = await searchAllResults(description, keywords);

  for (const r of results) {
    if (r.ok) {
      console.log(`  ${r.source.padEnd(7)} ${r.value.length} candidate(s)`);
    } else {
      console.log(`  ${r.source.padEnd(7)} FAILED — ${r.reason}`);
    }
  }
  console.log();

  const raw = results.flatMap((r) => (r.ok ? r.value : []));
  const verified = await verifyAll(raw);
  const maintained = verified.filter((c) => c.maintained);
  const dropped = verified.length - maintained.length;

  console.log(`${raw.length} raw, ${maintained.length} maintained (${dropped} filtered out)\n`);

  maintained.forEach((c, i) => {
    const traction = c.source === "github" ? `${c.stars ?? 0}*` : "-";
    const rank = String(i + 1).padStart(2, " ");
    console.log(`${rank}. [${c.source}] ${c.id}  ${traction}`);
    if (c.description) console.log(`    ${c.description.slice(0, 100)}`);
    console.log(`    ${c.maintenanceReason}`);
    console.log(`    ${c.url}`);
  });

  if (maintained.length === 0) {
    console.log("(no maintained candidates)");
  }
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
