// Live retrieval evaluation. This is intentionally separate from `npm test`:
// upstream indexes drift, and source availability must be reported rather
// than converted into deterministic test failures.
//
//   npm run eval -- --diff
//   npm run eval -- --diff --save
//   npm run eval -- --case rust-ripgrep

import { searchAllResults } from "../../dist/search.js";
import { prepareCandidates } from "../../dist/verify.js";
import { buildQueryPlan } from "../../dist/query-plan.js";
import { cases } from "./cases.mjs";
import {
  formulationHitRate,
  githubRequestsForPlan,
  rankExpectedTarget,
  summarize,
} from "./helpers.mjs";
import { readFileSync, writeFileSync, existsSync, statSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const BASELINE = join(HERE, "baseline.json");
const DIST_SEARCH = join(HERE, "..", "..", "dist", "search.js");
const GITHUB_LIMIT_PER_MINUTE = process.env.GITHUB_TOKEN ? 30 : 10;
const HEADROOM = 1.25;
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function distStamp() {
  try {
    return statSync(DIST_SEARCH).mtimeMs;
  } catch {
    return null;
  }
}

function planFor(testCase) {
  return buildQueryPlan(testCase.description, testCase.keywords, testCase.queries);
}

function delayAfterPlan(plan) {
  if (process.env.EVAL_SLEEP_MS !== undefined) {
    return Number(process.env.EVAL_SLEEP_MS);
  }
  const requests = githubRequestsForPlan(plan);
  return Math.ceil((60_000 * requests / GITHUB_LIMIT_PER_MINUTE) * HEADROOM);
}

async function runCase(testCase) {
  const results = await searchAllResults(
    testCase.description,
    testCase.keywords,
    testCase.queries,
  );
  const sourceFailures = results
    .filter((result) => !result.ok && result.attempted !== false)
    .map((result) => ({
      source: result.source,
      reason: result.reason,
      required: result.source !== "web",
    }));
  const raw = results.flatMap((result) => result.ok ? result.value : []);
  const candidates = await prepareCandidates(raw);
  const matched = rankExpectedTarget(
    candidates,
    testCase.expectedPool,
    testCase.expectAnyOf,
  );
  const evidenceSources = matched.winner
    ? [...new Set(matched.winner.evidence.map((item) => item.source))]
    : [];
  return {
    id: testCase.id,
    expectedPool: testCase.expectedPool,
    rank: testCase.expectNoMatch ? null : matched.rank,
    poolSize: matched.poolSize,
    evidenceSources,
    formulationHitRate: formulationHitRate(matched.winner, testCase.queries),
    sourceFailures,
    webAttempted: results.some(
      (result) => result.source === "web"
        && (result.ok || result.attempted !== false),
    ),
    retrievalCandidates: candidates.length,
    trueNegative: testCase.expectNoMatch === true,
    topHits: candidates
      .filter((candidate) => candidate.pool === testCase.expectedPool)
      .slice(0, 3)
      .map((candidate) => candidate.id),
  };
}

function printSummary(summary) {
  console.log("\n=== summary ===");
  console.log(`reuse cases            ${summary.reuse.cases}`);
  console.log(`reuse recall@5         ${summary.reuse.recallAt5}`);
  console.log(`reuse recall@10        ${summary.reuse.recallAt10}`);
  console.log(`competition cases      ${summary.competition.cases}`);
  console.log(`competition recall@5   ${summary.competition.recallAt5}`);
  console.log(`competition recall@10  ${summary.competition.recallAt10}`);
  const unique = Object.entries(summary.uniqueSingleSourceWins)
    .map(([source, wins]) => `${source}:${wins}`)
    .join(", ");
  console.log(`unique single-source wins  ${unique || "none"}`);
  console.log(
    `web availability       ${summary.webAvailability.attempted} attempted, ${summary.webAvailability.failed} failed`,
  );
  console.log(
    `retrieval candidates on true-negative  ${summary.retrievalCandidatesOnTrueNegative}`,
  );
}

function metricAt(summary, pool, metric) {
  const value = summary?.[pool]?.[metric];
  return typeof value === "number" ? value : null;
}

function printDiff(summary) {
  if (!existsSync(BASELINE)) {
    console.log("\n(no baseline yet; --save can create one)");
    return;
  }
  const previous = JSON.parse(readFileSync(BASELINE, "utf-8"));
  console.log("\n=== diff vs baseline ===");
  console.log(`baseline from ${previous.generatedAt}`);
  for (const pool of ["reuse", "competition"]) {
    for (const metric of ["recallAt5", "recallAt10"]) {
      const before = metricAt(previous, pool, metric);
      const after = metricAt(summary, pool, metric);
      if (before === null || after === null) {
        console.log(`${pool}.${metric.padEnd(10)} schema changed`);
        continue;
      }
      const delta = after - before;
      const sign = delta > 0 ? "+" : "";
      console.log(
        `${pool}.${metric.padEnd(10)} ${before} -> ${after} (${sign}${delta.toFixed(3)})`,
      );
    }
  }
  let moved = 0;
  for (const [id, current] of Object.entries(summary.perCase)) {
    const prior = previous.perCase?.[id];
    const before = typeof prior === "number" || prior === null
      ? prior
      : prior?.rank;
    if (before === undefined || before === current.rank) continue;
    moved += 1;
    console.log(`  ${id}: ${before ?? "MISS"} -> ${current.rank ?? "MISS"}`);
  }
  if (moved === 0) console.log("  (no comparable per-case rank changes)");
}

async function main() {
  const argv = process.argv.slice(2);
  const wantDiff = argv.includes("--diff");
  const wantSave = argv.includes("--save");
  const caseFlag = argv.indexOf("--case");
  const onlyCase = caseFlag === -1 ? null : argv[caseFlag + 1];
  const selected = onlyCase ? cases.filter((testCase) => testCase.id === onlyCase) : cases;

  if (selected.length === 0) {
    console.error(`no case with id "${onlyCase}". Known ids:`);
    for (const testCase of cases) console.error(`  ${testCase.id}`);
    process.exit(2);
  }

  const startStamp = distStamp();
  const rows = [];
  let priorPlan;
  let githubRequestBudget = 0;

  for (const testCase of selected) {
    if (priorPlan) await sleep(delayAfterPlan(priorPlan));
    if (distStamp() !== startStamp) {
      console.error(
        "\ndist/ changed mid-run. Results span builds and cannot be compared; aborting.",
      );
      process.exit(3);
    }
    const plan = planFor(testCase);
    githubRequestBudget += githubRequestsForPlan(plan);
    const row = await runCase(testCase);
    rows.push(row);
    priorPlan = plan;

    const label = row.trueNegative
      ? `${row.retrievalCandidates} retrieval candidate(s), not semantically judged`
      : row.rank === null
        ? "MISS"
        : `rank ${row.rank}`;
    console.log(`${row.id.padEnd(24)} ${label} in ${row.expectedPool} pool (${row.poolSize})`);
    if (row.rank !== null) {
      console.log(
        `  evidence=${row.evidenceSources.join(",") || "none"} formulation hit-rate=${(row.formulationHitRate * 100).toFixed(0)}%`,
      );
    } else if (!row.trueNegative && row.topHits.length > 0) {
      console.log(`  got instead: ${row.topHits.join(", ")}`);
    }
    for (const failure of row.sourceFailures) {
      console.log(
        `  source failure: ${failure.source} (${failure.required ? "required" : "experimental"}) ${failure.reason}`,
      );
    }
  }

  const summary = summarize(rows);
  printSummary(summary);
  if (wantDiff) printDiff(summary);

  const requiredFailures = rows.flatMap((row) =>
    row.sourceFailures.filter((failure) => failure.required));
  const webFailures = rows.flatMap((row) =>
    row.sourceFailures.filter((failure) => !failure.required));
  if (requiredFailures.length > 0) {
    console.log(
      `\nWARNING: ${requiredFailures.length} required attempted source failure(s); recall is unreliable.`,
    );
  }
  if (webFailures.length > 0) {
    console.log(
      `\nNOTE: ${webFailures.length} experimental web failure(s); recorded but not baseline-blocking.`,
    );
  }

  if (wantSave) {
    if (onlyCase) {
      console.error("\nrefusing to --save a single-case run.");
      process.exit(2);
    }
    if (requiredFailures.length > 0 && !argv.includes("--force")) {
      console.error(
        `\nrefusing to --save: ${requiredFailures.length} required attempted source failure(s).`,
      );
      process.exit(2);
    }
    if (distStamp() !== startStamp) {
      console.error("\nrefusing to --save: dist/ changed during the run.");
      process.exit(3);
    }
    writeFileSync(BASELINE, `${JSON.stringify(summary, null, 2)}\n`, "utf-8");
    console.log(`\nbaseline written to ${BASELINE}`);
  }

  console.log(
    `\n(${selected.length} planned searches; ${githubRequestBudget} GitHub requests; token ${process.env.GITHUB_TOKEN ? "set" : "unset"})`,
  );
}

main().catch((error) => {
  console.error("eval failed:", error);
  process.exit(1);
});
