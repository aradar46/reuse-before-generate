import { afterEach, test } from "node:test";
import assert from "node:assert/strict";
import { resetFetcher, setFetcher } from "../../dist/http.js";
import { searchTavilyResult } from "../../dist/sources/tavily.js";

const originalKey = process.env.TAVILY_API_KEY;

afterEach(() => {
  resetFetcher();
  if (originalKey === undefined) {
    delete process.env.TAVILY_API_KEY;
  } else {
    process.env.TAVILY_API_KEY = originalKey;
  }
});

test("Tavily is unavailable without attempting a request when no key is configured", async () => {
  delete process.env.TAVILY_API_KEY;
  let requested = false;
  setFetcher(async () => {
    requested = true;
    return Response.json({});
  });

  const result = await searchTavilyResult("appointment scheduling software");

  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.equal(result.attempted, false);
    assert.equal(result.reason, "TAVILY_API_KEY not configured");
  }
  assert.equal(requested, false);
});

test("Tavily makes one basic bounded search and maps repository and product evidence", async () => {
  process.env.TAVILY_API_KEY = "tvly-test-secret";
  let seenHeaders: Record<string, string> = {};
  let seenBody: Record<string, unknown> = {};
  setFetcher(async (url, init) => {
    if (String(url) === "https://api.github.com/repos/calcom/cal.com") {
      return Response.json({
        pushed_at: "2026-07-22T12:00:00Z",
        archived: false,
        stargazers_count: 42_000,
      });
    }
    seenHeaders = init?.headers as Record<string, string>;
    seenBody = JSON.parse(String(init?.body)) as Record<string, unknown>;
    return Response.json({
      query: "appointment scheduling software",
      results: [
        {
          title: "cal.com/cal.com",
          url: "https://github.com/calcom/cal.com",
          content: "Open-source scheduling infrastructure.",
          score: 0.91,
        },
        {
          title: "Calendly",
          url: "https://calendly.com",
          content: "Scheduling automation platform.",
          score: 0.86,
        },
      ],
      response_time: 0.42,
    });
  });

  const result = await searchTavilyResult("appointment scheduling software");

  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(seenHeaders.Authorization, "Bearer tvly-test-secret");
  assert.deepEqual(seenBody, {
    query: "appointment scheduling software",
    search_depth: "basic",
    max_results: 10,
    include_answer: false,
    include_raw_content: false,
  });
  assert.equal(result.value.length, 2);
  assert.equal(result.value[0]?.kind, "open_source");
  assert.equal(result.value[0]?.repositoryUrl, "https://github.com/calcom/cal.com");
  assert.equal(result.value[0]?.pushedAt, "2026-07-22T12:00:00Z");
  assert.equal(result.value[0]?.archived, false);
  assert.equal(result.value[0]?.stars, 42_000);
  assert.equal(result.value[1]?.kind, "unknown");
  assert.equal(result.value[1]?.url, "https://calendly.com");
  assert.deepEqual(
    result.value.map((candidate) => [
      candidate.evidence[0]?.query,
      candidate.evidence[0]?.rank,
    ]),
    [
      ["appointment scheduling software", 1],
      ["appointment scheduling software", 2],
    ],
  );
  assert.doesNotMatch(JSON.stringify(result.value), /tvly-test-secret/);
});

test("Tavily isolates HTTP and response-shape failures", async (context) => {
  process.env.TAVILY_API_KEY = "tvly-test-secret";

  await context.test("HTTP failure", async () => {
    process.env.TAVILY_API_KEY = "tvly-test-secret";
    setFetcher(async () => new Response("", { status: 429 }));
    const result = await searchTavilyResult("calendar booking");
    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.notEqual(result.attempted, false);
      assert.equal(result.reason, "HTTP 429");
    }
  });

  await context.test("malformed response", async () => {
    process.env.TAVILY_API_KEY = "tvly-test-secret";
    setFetcher(async () => Response.json({ results: [{ title: "missing URL" }] }));
    const result = await searchTavilyResult("calendar booking");
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.reason, "unexpected response shape");
  });
});

test("Tavily preserves nested GitLab namespaces when fetching repository activity", async () => {
  process.env.TAVILY_API_KEY = "tvly-test-secret";
  const requested: string[] = [];
  setFetcher(async (url) => {
    requested.push(String(url));
    if (String(url) === "https://api.tavily.com/search") {
      return Response.json({
        results: [{
          title: "Nested project",
          url: "https://gitlab.com/acme/platform/widget/-/issues",
          content: "Open-source widget.",
          score: 0.8,
        }],
      });
    }
    return Response.json({
      last_activity_at: "2026-07-22T12:00:00Z",
      archived: false,
      star_count: 12,
    });
  });

  const result = await searchTavilyResult("widget");

  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.ok(requested.includes(
    "https://gitlab.com/api/v4/projects/acme%2Fplatform%2Fwidget",
  ));
  assert.equal(
    result.value[0]?.repositoryUrl,
    "https://gitlab.com/acme/platform/widget",
  );
  assert.equal(result.value[0]?.pushedAt, "2026-07-22T12:00:00Z");
});
