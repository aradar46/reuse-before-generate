// Recall fixture test: checks the search+verify pipeline actually surfaces
// known real matches for descriptions that provably have close existing
// alternatives — as opposed to just rejecting noise, which is all the
// ad-hoc self-tests during development confirmed. Run with:
//   node test/fixtures.mjs
// Requires the project to be built first (npm run build).

import { searchAll } from "../dist/search.js";
import { verifyAll } from "../dist/verify.js";

const cases = [
  {
    description:
      "A command-line tool that formats Python source code automatically to a consistent style.",
    expectAnyOf: ["black", "ruff", "psf/black", "astral-sh/ruff", "yapf"],
  },
  {
    description:
      "A command-line tool that generates and updates a changelog file by parsing conventional commit messages from git history, grouping them by type and version tag.",
    expectAnyOf: ["git-cliff", "auto-changelog", "standard-version", "conventional-changelog"],
  },
  {
    description:
      "A tool that detects secrets and API keys accidentally committed to a git repository.",
    expectAnyOf: ["gitleaks", "trufflehog", "detect-secrets", "git-secrets"],
  },
  {
    // Regression guard for a real gap found via a live self-test: this
    // matches a genuine niche tool (ruzmuh/actl, 0 stars, pushed the same
    // week) that the old star-based verify.ts filter silently discarded,
    // and that GitHub's default search ranking buries against high-star
    // noise unless the low-star search lane in searchGitHub() catches it.
    // Note: two OTHER known-real matches for this description
    // (Socialpranker/actdbg, aradar46/fermata) still don't reliably
    // surface — GitHub's search index for very small/oddly-named repos is
    // a harder, only partially-solved problem. This fixture intentionally
    // accepts a partial-recall pass rather than requiring all three.
    description:
      "A debugger for GitHub Actions. Pause a failing workflow at the point of failure, get an interactive shell inside the running runner, inspect state, fix the issue, and re-run just the broken step instead of the whole pipeline.",
    keywords: ["debugger", "actions", "workflow"],
    expectAnyOf: ["actl", "action-tmate", "upterm", "actdbg", "fermata"],
  },
  {
    // Regression guard: verb-based keywords ("pretty-print", "colorize")
    // matching the USER's framing of the problem failed to surface any
    // real match. The dominant real tool describes itself by function
    // ("Terminal JSON viewer & processor"), not by the action the user
    // asked for — "viewer" is the word that actually works.
    description:
      "A command-line tool that pretty-prints and colorizes JSON files for terminal viewing.",
    keywords: ["json", "viewer", "terminal"],
    expectAnyOf: ["fx", "jless", "gron", "jq", "jnv"],
  },
  {
    description:
      "An MCP server that lets an AI coding agent run read-only SQL queries against a Postgres database.",
    keywords: ["postgres", "mcp", "database", "query"],
    expectAnyOf: ["postgres-mcp"],
  },
  {
    // Regression guard: same lesson as the JSON-viewer case from the other
    // direction — "static site"/"alt-text" (the user's framing) never
    // surfaced the dominant tool, which describes itself as validating
    // "rendered HTML files," not static sites or alt text specifically.
    description:
      "A CLI tool for static site generators that checks for dead image links and missing alt text before deploy.",
    keywords: ["html", "proofer", "validate", "link"],
    expectAnyOf: ["html-proofer", "broken-link-checker", "linkinator"],
  },
];

function matches(candidateId, expectAnyOf) {
  const lower = candidateId.toLowerCase();
  return expectAnyOf.some((needle) => lower.includes(needle.toLowerCase()));
}

let failures = 0;

// Stagger cases: GitHub's unauthenticated search endpoint has both a low
// primary limit (10/min) and a separate burst/abuse throttle, both of
// which fire easily when this script's cases run back-to-back.
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

for (const [i, { description, keywords, expectAnyOf }] of cases.entries()) {
  if (i > 0) await sleep(3000);
  const raw = await searchAll(description, keywords);
  const verified = await verifyAll(raw);
  const maintained = verified.filter((c) => c.maintained);
  const found = maintained.filter((c) => matches(c.id, expectAnyOf));

  const label = description.slice(0, 55) + "...";
  if (found.length > 0) {
    console.log(`PASS  ${label}`);
    console.log(`      found: ${found.map((c) => c.id).join(", ")}`);
  } else {
    failures += 1;
    console.log(`FAIL  ${label}`);
    console.log(`      expected one of: ${expectAnyOf.join(", ")}`);
    console.log(`      got ${maintained.length} maintained candidates, none matched:`);
    console.log(`      ${maintained.slice(0, 8).map((c) => c.id).join(", ")}`);
  }
  console.log();
}

if (failures > 0) {
  console.error(`${failures}/${cases.length} recall fixture(s) failed.`);
  process.exit(1);
} else {
  console.log(`All ${cases.length} recall fixtures passed.`);
}
