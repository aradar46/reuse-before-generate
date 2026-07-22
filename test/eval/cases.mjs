// Recall corpus. Each case is a description with at least one known-real
// existing tool that a good search ought to surface.
//
// `variants` holds alternative keyword sets for the same description. The
// README records that swapping one reasonable synonym ("capture" vs
// "chrome") flipped a result from found to missed; variants turn that
// anecdote into a measured number rather than a remembered anecdote.
//
// `expectNoMatch: true` marks a true-negative case: the correct outcome is
// finding nothing. Scored separately so it cannot move recall.

export const cases = [
  {
    id: "python-formatter",
    description:
      "A command-line tool that formats Python source code automatically to a consistent style.",
    expectAnyOf: ["black", "ruff", "psf/black", "astral-sh/ruff", "yapf"],
    variants: [
      ["python", "formatter", "code"],
      ["python", "format", "style"],
    ],
  },
  {
    id: "changelog-generator",
    description:
      "A command-line tool that generates and updates a changelog file by parsing conventional commit messages from git history, grouping them by type and version tag.",
    expectAnyOf: ["git-cliff", "auto-changelog", "standard-version", "conventional-changelog"],
    variants: [
      ["changelog", "conventional", "commits"],
      ["changelog", "generator", "git"],
    ],
  },
  {
    id: "secret-scanner",
    description:
      "A tool that detects secrets and API keys accidentally committed to a git repository.",
    expectAnyOf: ["gitleaks", "trufflehog", "detect-secrets", "git-secrets"],
    variants: [
      ["git", "secrets", "detect", "leak"],
      ["secret", "scanner", "detect", "git"],
    ],
  },
  {
    id: "actions-debugger",
    // Regression guard for a real gap found via a live self-test: this
    // matches a genuine niche tool (ruzmuh/actl, 0 stars, pushed the same
    // week) that the old star-based verify.ts filter silently discarded,
    // and that GitHub's default search ranking buries against high-star
    // noise unless the low-star search lane in searchGitHub() catches it.
    // Note: two OTHER known-real matches for this description
    // (Socialpranker/actdbg, aradar46/fermata) still don't reliably
    // surface — GitHub's search index for very small/oddly-named repos is
    // a harder, only partially-solved problem. This case intentionally
    // accepts partial recall rather than requiring all three.
    description:
      "A debugger for GitHub Actions. Pause a failing workflow at the point of failure, get an interactive shell inside the running runner, inspect state, fix the issue, and re-run just the broken step instead of the whole pipeline.",
    expectAnyOf: ["actl", "action-tmate", "upterm", "actdbg", "fermata"],
    variants: [["debugger", "actions", "workflow"]],
  },
  {
    id: "json-viewer",
    // Regression guard: verb-based keywords ("pretty-print", "colorize")
    // matching the USER's framing of the problem failed to surface any
    // real match. The dominant real tool describes itself by function
    // ("Terminal JSON viewer & processor"), not by the action the user
    // asked for — "viewer" is the word that actually works.
    description:
      "A command-line tool that pretty-prints and colorizes JSON files for terminal viewing.",
    expectAnyOf: ["fx", "jless", "gron", "jq", "jnv"],
    variants: [
      ["json", "viewer", "terminal"],
      ["json", "pretty-print", "colorize"],
    ],
  },
  {
    id: "postgres-mcp",
    description:
      "An MCP server that lets an AI coding agent run read-only SQL queries against a Postgres database.",
    expectAnyOf: ["postgres-mcp"],
    variants: [["postgres", "mcp", "database", "query"]],
  },
  {
    id: "html-proofer",
    // Regression guard: same lesson as the JSON-viewer case from the other
    // direction — "static site"/"alt-text" (the user's framing) never
    // surfaced the dominant tool, which describes itself as validating
    // "rendered HTML files," not static sites or alt text specifically.
    description:
      "A CLI tool for static site generators that checks for dead image links and missing alt text before deploy.",
    expectAnyOf: ["html-proofer", "broken-link-checker", "linkinator"],
    variants: [
      ["html", "proofer", "validate", "link"],
      ["static", "site", "alt-text", "links"],
    ],
  },
  {
    id: "no-real-competitor",
    // True-negative guard: deliberately absurd and specific enough that no
    // real tool should match. The entire "clear to build" path is otherwise
    // untested — a search returning plausible-looking matches for
    // everything is as broken as one returning nothing, and only this kind
    // of case catches it.
    description:
      "A command-line tool that converts recipes for Hungarian pastry into MIDI files whose note durations encode the baking times.",
    expectAnyOf: [],
    expectNoMatch: true,
    variants: [["recipe", "midi", "baking"]],
  },
  {
    id: "vague-phrasing",
    // Non-native / roundabout phrasing. The tool's premise is that the
    // calling agent supplies good keywords even when the user's own words
    // are imprecise, so the corpus needs at least one case where they are.
    description:
      "the thing that check my code is clean automatic before i push, catch mistake early",
    expectAnyOf: ["husky", "pre-commit", "lint-staged", "lefthook"],
    variants: [
      ["git", "hooks", "pre-commit"],
      ["lint", "staged", "commit"],
    ],
  },
  {
    id: "npm-dominant",
    // The dominant answer is an npm package rather than a GitHub repo,
    // exercising the npm lane as the primary source rather than a
    // supplement.
    description:
      "A JavaScript library for parsing command-line arguments into an options object, with support for aliases and defaults.",
    expectAnyOf: ["yargs", "commander", "minimist", "meow", "arg"],
    variants: [
      ["cli", "arguments", "parser"],
      ["command-line", "options", "parse"],
    ],
  },
  {
    id: "python-dominant",
    // Python-dominant target. PyPI name-guessing alone is unlikely to reach
    // it, so this case measures whether the GitHub language:python lane
    // (Task 16) actually earns its request.
    description:
      "A Python library for making HTTP requests with a simple API, handling sessions, redirects and JSON decoding.",
    expectAnyOf: ["requests", "httpx", "aiohttp", "urllib3"],
    variants: [
      ["python", "http", "requests"],
      ["http", "client", "session"],
    ],
  },
  {
    id: "low-star-niche",
    // Second low-star regression guard alongside actions-debugger. Niche
    // enough that the winners have modest star counts, so it detects any
    // change that quietly reintroduces popularity bias into the funnel.
    description:
      "A terminal tool that shows which process is listening on a given TCP port and lets you kill it interactively.",
    expectAnyOf: ["killport", "fkill", "port-killer", "lsof"],
    variants: [
      ["port", "kill", "process"],
      ["tcp", "listening", "terminal"],
    ],
  },
];
