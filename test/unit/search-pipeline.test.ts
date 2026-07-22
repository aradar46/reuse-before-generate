import { test, afterEach } from "node:test";
import assert from "node:assert/strict";
import { searchAllResults } from "../../dist/search.js";
import { setFetcher, resetFetcher } from "../../dist/http.js";

afterEach(() => resetFetcher());

const githubBody = {
  items: [
    {
      full_name: "psf/black",
      html_url: "https://github.com/psf/black",
      description: "The uncompromising Python code formatter",
      stargazers_count: 39000,
      pushed_at: "2026-07-01T00:00:00Z",
      archived: false,
    },
  ],
};

const npmBody = {
  objects: [
    {
      package: {
        name: "prettier",
        description: "Opinionated code formatter",
        links: { npm: "https://npmjs.com/package/prettier" },
        date: "2026-06-01T00:00:00Z",
      },
    },
  ],
};

function routeFetcher(handlers: { github?: () => Response; npm?: () => Response; pypi?: () => Response }) {
  return async (url: string) => {
    if (url.includes("api.github.com")) {
      return handlers.github?.() ?? new Response(JSON.stringify({ items: [] }), { status: 200 });
    }
    if (url.includes("registry.npmjs.org")) {
      return handlers.npm?.() ?? new Response(JSON.stringify({ objects: [] }), { status: 200 });
    }
    return handlers.pypi?.() ?? new Response("{}", { status: 404 });
  };
}

test("searchAllResults returns ok results with candidates from each source", async () => {
  setFetcher(
    routeFetcher({
      github: () => new Response(JSON.stringify(githubBody), { status: 200 }),
      npm: () => new Response(JSON.stringify(npmBody), { status: 200 }),
    }),
  );

  const results = await searchAllResults("python formatter", ["python", "formatter", "code"]);
  const github = results.find((r) => r.source === "github");
  const npm = results.find((r) => r.source === "npm");

  assert.equal(github?.ok, true);
  assert.equal(npm?.ok, true);
  if (github?.ok) assert.equal(github.value[0].id, "psf/black");
  if (npm?.ok) assert.equal(npm.value[0].id, "prettier");
});

test("an HTTP error on one source does not fail the others", async () => {
  // 500, not 403: this test is about partial-failure isolation, and 403
  // additionally triggers the 2s retry backoff, which has nothing to do
  // with what is being asserted here. Retry has its own test below.
  setFetcher(
    routeFetcher({
      github: () => new Response("server error", { status: 500 }),
      npm: () => new Response(JSON.stringify(npmBody), { status: 200 }),
    }),
  );

  const results = await searchAllResults("python formatter", ["python", "formatter", "code"]);
  const github = results.find((r) => r.source === "github");
  const npm = results.find((r) => r.source === "npm");

  assert.equal(github?.ok, false);
  if (github && !github.ok) assert.match(github.reason, /500/);
  assert.equal(npm?.ok, true);
});

test("a 403 is retried once and succeeds on the second attempt", async () => {
  // The retry exists because GitHub's unauthenticated search has both a
  // 10/min primary limit and a separate burst throttle, and both surface as
  // 403. Untested, a regression here (reusing the stale response,
  // misparsing Retry-After, dropping the second call) would be silent.
  // Retry-After: 0 keeps the backoff instant without touching the logic.
  let githubCalls = 0;
  setFetcher(
    routeFetcher({
      github: () => {
        githubCalls += 1;
        if (githubCalls <= 2) {
          // Both lanes get one 403 first, then succeed.
          return new Response("rate limited", {
            status: 403,
            headers: { "retry-after": "0" },
          });
        }
        return new Response(JSON.stringify(githubBody), { status: 200 });
      },
    }),
  );

  const results = await searchAllResults("python formatter", ["python", "formatter", "code"]);
  const github = results.find((r) => r.source === "github");

  assert.equal(github?.ok, true);
  if (github?.ok) assert.equal(github.value[0].id, "psf/black");
  // Two lanes, each retried once: 2 failed + 2 successful attempts.
  assert.equal(githubCalls, 4);
});

test("a 403 that persists through the retry is reported as a failure", async () => {
  setFetcher(
    routeFetcher({
      github: () =>
        new Response("rate limited", {
          status: 403,
          headers: { "retry-after": "0" },
        }),
    }),
  );

  const results = await searchAllResults("python formatter", ["python", "formatter", "code"]);
  const github = results.find((r) => r.source === "github");

  assert.equal(github?.ok, false);
  if (github && !github.ok) assert.match(github.reason, /403/);
});

test("a malformed response shape is reported as a source failure, not a crash", async () => {
  setFetcher(
    routeFetcher({
      github: () => new Response(JSON.stringify({ message: "shape changed" }), { status: 200 }),
      npm: () => new Response(JSON.stringify(npmBody), { status: 200 }),
    }),
  );

  const results = await searchAllResults("python formatter", ["python", "formatter", "code"]);
  const github = results.find((r) => r.source === "github");

  assert.equal(github?.ok, false);
  if (github && !github.ok) assert.match(github.reason, /unexpected response shape/i);
});

test("a thrown network error is reported as a source failure", async () => {
  setFetcher(
    routeFetcher({
      github: () => {
        throw new Error("ECONNRESET");
      },
      npm: () => new Response(JSON.stringify(npmBody), { status: 200 }),
    }),
  );

  const results = await searchAllResults("python formatter", ["python", "formatter", "code"]);
  const github = results.find((r) => r.source === "github");

  assert.equal(github?.ok, false);
  if (github && !github.ok) assert.match(github.reason, /ECONNRESET/);
});

test("github primary and low-star lanes are deduplicated by full_name", async () => {
  setFetcher(
    routeFetcher({
      github: () => new Response(JSON.stringify(githubBody), { status: 200 }),
    }),
  );

  const results = await searchAllResults("python formatter", ["python", "formatter", "code"]);
  const github = results.find((r) => r.source === "github");

  // Both lanes return the same single item; it must appear once.
  if (github?.ok) assert.equal(github.value.length, 1);
});
