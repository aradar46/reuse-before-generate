// Scored recall eval. Hits live GitHub and npm — deliberately NOT part of
// `npm test`, because upstream ranking drifts independently of this
// codebase and a flaky signal that blocks merges gets ignored, then
// disabled, then deleted.
//
//   npm run eval               score the corpus, print per-case ranks
//   npm run eval -- --diff     also diff against the committed baseline
//   npm run eval -- --save     rewrite the baseline
//   npm run eval -- --case id  run a single case (fast iteration)
//
// A full unauthenticated run takes ~4-5 minutes because of rate-limit
// spacing. Do NOT `npm run build` while one is in flight: the run imports
// from dist/, and tsc rewriting those files mid-run kills it silently.
// Set GITHUB_TOKEN to cut the wait roughly in half.
//
// Why rank and not pass/fail: pass/fail cannot tell you that a change moved
// the right answer from position 14 to position 3, which is exactly the
// signal needed when tuning queries.

import { searchAllResults } from "../../dist/search.js";
import { verifyAll } from "../../dist/verify.js";
import { cases } from "./cases.mjs";
import { readFileSync, writeFileSync, existsSync, statSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const BASELINE = join(HERE, "baseline.json");
const DIST_SEARCH = join(HERE, "..", "..", "dist", "search.js");

/** Rebuilding dist/ mid-run kills the process silently — Node has already
 * loaded these modules, and tsc rewriting them produces a confusing partial
 * failure minutes in. Catch it and say so plainly instead. */
function distStamp() {
  try {
    return statSync(DIST_SEARCH).mtimeMs;
  } catch {
    return null;
  }
}

// GitHub's search endpoint allows 10 requests/min unauthenticated, 30/min
// with a token (verified against /rate_limit). Going over does not error
// loudly — it silently turns real hits into MISSes via 403, which is
// indistinguishable from a genuine recall failure in the scores.
//
// Derived rather than hardcoded, because the per-variant request count is
// exactly the kind of thing that drifts: adding the language:python lane
// took it from 2 to 3, which silently invalidated a hand-tuned 12s delay
// and produced 5 phantom misses before anyone noticed.
const GITHUB_REQUESTS_PER_VARIANT = 3; // primary + low-star + language:python
const GITHUB_LIMIT_PER_MIN = process.env.GITHUB_TOKEN ? 30 : 10;
// 25% headroom: the limit is a sliding window, not a clean per-minute reset.
const DEFAULT_SLEEP_MS = Math.ceil(
  (60_000 / (GITHUB_LIMIT_PER_MIN / GITHUB_REQUESTS_PER_VARIANT)) * 1.25,
);
const SLEEP_MS = Number(process.env.EVAL_SLEEP_MS ?? DEFAULT_SLEEP_MS);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function matches(candidateId, expectAnyOf) {
  const lower = candidateId.toLowerCase();
  return expectAnyOf.some((needle) => lower.includes(needle.toLowerCase()));
}

/** Rank of the first matching candidate (1-based), or null for a miss. */
function rankOfFirstMatch(candidates, expectAnyOf) {
  const idx = candidates.findIndex((c) => matches(c.id, expectAnyOf));
  return idx === -1 ? null : idx + 1;
}

async function runVariant(description, keywords) {
  const results = await searchAllResults(description, keywords);
  const failures = results.filter((r) => !r.ok).map((r) => `${r.source}:${r.reason}`);
  const raw = results.flatMap((r) => (r.ok ? r.value : []));
  const verified = await verifyAll(raw);
  const maintained = verified.filter((c) => c.maintained);
  return { maintained, failures };
}

/** Which source produced the winning candidate. Answers "is this lane
 * earning its extra request?" for the two speculative ones — GitHub's
 * low-star lane and the language:python lane both cost a request per call
 * and exist on the theory that they surface things the primary query
 * buries. If neither ever produces a winner, both should go. */
function creditSource(maintained, rank) {
  if (rank === null) return null;
  return maintained[rank - 1]?.source ?? null;
}

function summarize(rows) {
  // True-negative cases are excluded from recall: "found nothing" is the
  // right answer there, so counting them would silently deflate the metric.
  const scored = rows.filter((r) => !r.trueNegative);
  const found = scored.filter((r) => r.best !== null);
  const recallAt = (k) =>
    scored.length === 0
      ? 0
      : scored.filter((r) => r.best !== null && r.best <= k).length / scored.length;
  const mrr =
    scored.length === 0
      ? 0
      : scored.reduce((acc, r) => acc + (r.best ? 1 / r.best : 0), 0) / scored.length;

  return {
    generatedAt: new Date().toISOString(),
    cases: scored.length,
    recallAt5: Number(recallAt(5).toFixed(3)),
    recallAt10: Number(recallAt(10).toFixed(3)),
    recallAtAll: Number((found.length / (scored.length || 1)).toFixed(3)),
    mrr: Number(mrr.toFixed(3)),
    falsePositivesOnTrueNegatives: rows
      .filter((r) => r.trueNegative)
      .reduce((acc, r) => acc + r.falsePositives, 0),
    perCase: Object.fromEntries(rows.map((r) => [r.id, r.best])),
  };
}

async function main() {
  const argv = process.argv.slice(2);
  const wantDiff = argv.includes("--diff");
  const wantSave = argv.includes("--save");
  const caseFlag = argv.indexOf("--case");
  const onlyCase = caseFlag === -1 ? null : argv[caseFlag + 1];

  const selected = onlyCase ? cases.filter((c) => c.id === onlyCase) : cases;
  if (selected.length === 0) {
    console.error(`no case with id "${onlyCase}". Known ids:`);
    for (const c of cases) console.error(`  ${c.id}`);
    process.exit(2);
  }

  const rows = [];
  let requestBudget = 0;
  const startStamp = distStamp();

  for (const [i, c] of selected.entries()) {
    const variants = c.variants ?? [undefined];
    const variantRanks = [];

    for (const [vi, keywords] of variants.entries()) {
      if (i > 0 || vi > 0) await sleep(SLEEP_MS);
      if (distStamp() !== startStamp) {
        console.error(
          "\ndist/ changed mid-run (something rebuilt it). Scores so far are" +
            "\nmixed across two builds and cannot be compared. Aborting.",
        );
        process.exit(3);
      }
      requestBudget += 1;
      const { maintained, failures } = await runVariant(c.description, keywords);
      const rank = rankOfFirstMatch(maintained, c.expectAnyOf);
      variantRanks.push({
        keywords: keywords ? keywords.join(",") : "(auto)",
        rank,
        pool: maintained.length,
        failures,
        source: creditSource(maintained, rank),
        topHits: maintained.slice(0, 3).map((m) => m.id),
      });
    }

    if (c.expectNoMatch) {
      const falsePositives = variantRanks.filter((v) => v.rank !== null).length;
      rows.push({
        id: c.id,
        best: null,
        hitRate: 0,
        variants: variantRanks,
        trueNegative: true,
        falsePositives,
      });
      continue;
    }

    // The headline rank for a case is its BEST variant: the tool
    // instructs the calling agent to pick good keywords, so the best
    // achievable result measures whether the target is reachable at all.
    // Variant spread is reported separately, as fragility.
    const hits = variantRanks.filter((v) => v.rank !== null).map((v) => v.rank);
    const best = hits.length > 0 ? Math.min(...hits) : null;
    const hitRate = variantRanks.length > 0 ? hits.length / variantRanks.length : 0;

    rows.push({ id: c.id, best, hitRate, variants: variantRanks });
  }

  console.log("\n=== per case ===");
  for (const r of rows) {
    const label = r.trueNegative
      ? r.falsePositives > 0
        ? `FALSE POSITIVE x${r.falsePositives}`
        : "correctly empty"
      : r.best === null
        ? "MISS"
        : `rank ${r.best}`;
    const spread = r.trueNegative ? "" : `  variant hit-rate ${(r.hitRate * 100).toFixed(0)}%`;
    console.log(`${r.id.padEnd(22)} ${label.padEnd(18)}${spread}`);
    for (const v of r.variants) {
      const vr = v.rank === null ? "MISS" : `#${v.rank}`;
      const via = v.source ? ` via=${v.source}` : "";
      console.log(`    ${vr.padEnd(6)} pool=${String(v.pool).padEnd(4)}${via} kw=${v.keywords}`);
      if (v.rank === null && v.topHits.length > 0) {
        console.log(`           got instead: ${v.topHits.join(", ")}`);
      }
      if (v.failures.length > 0) {
        console.log(`           source failures: ${v.failures.join("; ")}`);
      }
    }
  }

  const summary = summarize(rows);

  console.log("\n=== summary ===");
  console.log(`cases scored  ${summary.cases}`);
  console.log(`recall@5      ${summary.recallAt5}`);
  console.log(`recall@10     ${summary.recallAt10}`);
  console.log(`recall@all    ${summary.recallAtAll}`);
  console.log(`MRR           ${summary.mrr}`);
  console.log(`false positives on true-negative cases: ${summary.falsePositivesOnTrueNegatives}`);

  if (wantDiff) {
    if (!existsSync(BASELINE)) {
      console.log("\n(no baseline yet — run with --save to create one)");
    } else {
      const prev = JSON.parse(readFileSync(BASELINE, "utf-8"));
      console.log("\n=== diff vs baseline ===");
      console.log(`baseline from ${prev.generatedAt}`);
      for (const k of ["recallAt5", "recallAt10", "recallAtAll", "mrr"]) {
        const delta = summary[k] - prev[k];
        const sign = delta > 0 ? "+" : "";
        const flag = Math.abs(delta) < 0.001 ? "" : delta > 0 ? "  BETTER" : "  WORSE";
        console.log(`${k.padEnd(12)} ${prev[k]} -> ${summary[k]} (${sign}${delta.toFixed(3)})${flag}`);
      }
      let moved = 0;
      for (const r of rows) {
        const before = prev.perCase?.[r.id];
        if (before === undefined) continue;
        if (before !== r.best) {
          moved += 1;
          console.log(`  ${r.id}: ${before ?? "MISS"} -> ${r.best ?? "MISS"}`);
        }
      }
      if (moved === 0) console.log("  (no per-case rank changes)");
    }
  }

  // A rate-limited run scores real hits as MISSes, and a baseline built
  // from one makes every later comparison meaningless — worse than having
  // no baseline, because it looks authoritative. Count them and refuse.
  const failedVariants = rows.reduce(
    (acc, r) => acc + r.variants.filter((v) => v.failures.length > 0).length,
    0,
  );
  if (failedVariants > 0) {
    console.log(
      `\nWARNING: ${failedVariants} of ${requestBudget} variant runs had a source failure.` +
        `\nScores below are UNRELIABLE — a 403 looks exactly like a recall miss.` +
        `\nRe-run with GITHUB_TOKEN set, or raise EVAL_SLEEP_MS.`,
    );
  }

  if (wantSave) {
    if (onlyCase) {
      console.error("\nrefusing to --save a single-case run: it would drop every other case from the baseline.");
      process.exit(2);
    }
    if (failedVariants > 0 && !argv.includes("--force")) {
      console.error(
        `\nrefusing to --save: ${failedVariants} variant run(s) hit a source failure, so these` +
          `\nscores understate real recall. Re-run cleanly, or pass --force if you really mean it.`,
      );
      process.exit(2);
    }
    writeFileSync(BASELINE, JSON.stringify(summary, null, 2) + "\n", "utf-8");
    console.log(`\nbaseline written to ${BASELINE}`);
  }

  console.log(`\n(${requestBudget} variant runs; GITHUB_TOKEN ${process.env.GITHUB_TOKEN ? "set" : "unset"}, sleeping ${SLEEP_MS}ms between)`);
}

main().catch((err) => {
  console.error("eval failed:", err);
  process.exit(1);
});
