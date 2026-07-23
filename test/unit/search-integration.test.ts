import { afterEach, test } from "node:test";
import assert from "node:assert/strict";
import { resetFetcher, setFetcher } from "../../dist/http.js";
import {
  searchAllResults,
  searchGitHubResult,
  searchNpmResult,
  searchPythonResult,
} from "../../dist/search.js";

afterEach(() => resetFetcher());

const emptyProductHuntFeed =
  "<?xml version=\"1.0\"?><rss><channel><title>Product Hunt</title></channel></rss>";
const emptyWebPage =
  "<!doctype html><html><div class=\"no-results\">No results found</div></html>";

function emptyDiscoveryResponse(url: string): Response {
  const parsed = new URL(url);
  if (parsed.hostname === "api.github.com") return Response.json({ items: [] });
  if (parsed.hostname === "registry.npmjs.org") return Response.json({ objects: [] });
  if (parsed.hostname === "gitlab.com") return Response.json([]);
  if (parsed.hostname === "hn.algolia.com") return Response.json({ hits: [] });
  if (parsed.hostname === "www.producthunt.com") return new Response(emptyProductHuntFeed);
  if (parsed.hostname === "html.duckduckgo.com") return new Response(emptyWebPage);
  if (parsed.hostname === "crates.io") return Response.json({ crates: [] });
  throw new Error(`unexpected request: ${url}`);
}

function decodedQuery(url: string): string {
  const parsed = new URL(url);
  return decodeURIComponent(
    parsed.searchParams.get("q")
      ?? parsed.searchParams.get("text")
      ?? parsed.searchParams.get("search")
      ?? parsed.searchParams.get("query")
      ?? "",
  );
}

test("generic discovery uses explicit formulations, stable source order, and bounded attempts", async () => {
  const urls: string[] = [];
  setFetcher(async (url) => {
    urls.push(url);
    return emptyDiscoveryResponse(url);
  });

  const results = await searchAllResults(
    "legacy description",
    ["", " ", "a"],
    {
      category: "terminal json viewer",
      outcome: "browse JSON in terminal",
      synonyms: "command line data browser",
    },
  );

  assert.deepEqual(results.map((result) => result.source), [
    "github",
    "npm",
    "gitlab",
    "hackernews",
    "producthunt",
    "web",
  ]);

  const hostCounts = new Map<string, number>();
  for (const url of urls) {
    const host = new URL(url).hostname;
    hostCounts.set(host, (hostCounts.get(host) ?? 0) + 1);
  }
  assert.deepEqual(Object.fromEntries(hostCounts), {
    "api.github.com": 2,
    "registry.npmjs.org": 2,
    "gitlab.com": 2,
    "hn.algolia.com": 3,
    "www.producthunt.com": 1,
    "html.duckduckgo.com": 2,
  });

  const queryValues = urls.map(decodedQuery);
  assert.equal(queryValues.some((query) => query.includes("legacy")), false);
  assert.equal(queryValues.some((query) => query.includes("terminal json viewer")), true);
  assert.equal(queryValues.some((query) => query.includes("browse JSON in terminal")), true);
  assert.equal(queryValues.some((query) => query.includes("command line data browser")), true);
});

test("Python adds only its one separate GitHub lane", async () => {
  const urls: string[] = [];
  setFetcher(async (url) => {
    urls.push(url);
    return emptyDiscoveryResponse(url);
  });

  const results = await searchAllResults(
    "format Python source",
    ["formatter", "python", "code"],
    {
      category: "python formatter",
      outcome: "format Python source",
      synonyms: "python code style",
    },
  );

  assert.deepEqual(results.map((result) => result.source), [
    "github",
    "npm",
    "gitlab",
    "hackernews",
    "producthunt",
    "web",
    "python",
  ]);
  assert.equal(
    urls.filter((url) => new URL(url).hostname === "api.github.com").length,
    3,
  );
  assert.equal(
    urls.some((url) => /crates|rubygems|packagist|maven/.test(url)),
    false,
  );
});

test("Rust adds crates only and never fans out to every registry", async () => {
  const urls: string[] = [];
  setFetcher(async (url) => {
    urls.push(url);
    return emptyDiscoveryResponse(url);
  });

  const results = await searchAllResults(
    "audit Rust dependencies",
    ["rust", "dependency", "audit"],
    {
      category: "rust dependency auditor",
      outcome: "find vulnerable Rust crates",
      synonyms: "cargo security scanner",
    },
  );

  assert.equal(results.at(-1)?.source, "crates");
  assert.equal(urls.filter((url) => url.includes("crates.io")).length, 1);
  assert.equal(
    urls.some((url) => /rubygems|packagist|maven/.test(url)),
    false,
  );
});

test("same-source npm attempts merge evidence and tolerate one failed formulation", async () => {
  let npmCalls = 0;
  setFetcher(async (url) => {
    if (new URL(url).hostname !== "registry.npmjs.org") {
      return emptyDiscoveryResponse(url);
    }
    npmCalls += 1;
    if (npmCalls === 1) return new Response("", { status: 503 });
    return Response.json({
      objects: [
        {
          package: {
            name: "termglass",
            description: "Browse JSON in a terminal",
            links: {
              npm: "https://npmjs.com/package/termglass",
              repository: "https://github.com/acme/termglass",
            },
            date: "2026-07-20T00:00:00Z",
          },
        },
      ],
    });
  });

  const results = await searchAllResults(
    "browse JSON",
    ["legacy", "terms", "only"],
    {
      category: "terminal json viewer",
      outcome: "browse JSON in terminal",
      synonyms: "command line data browser",
    },
  );
  const npm = results.find((result) => result.source === "npm");

  assert.equal(npm?.ok, true);
  if (!npm?.ok) return;
  assert.equal(npm.value[0]?.repositoryUrl, "https://github.com/acme/termglass");
  assert.equal(npm.value[0]?.packageUrl, "https://npmjs.com/package/termglass");
  assert.equal(npm.value[0]?.kind, "open_source");
  assert.equal(npm.value[0]?.evidence[0]?.query, "browse JSON in terminal");
  assert.equal(npm.value[0]?.evidence[0]?.rank, 1);
});

test("GitHub, npm, and Python mappings include actual ranked evidence and URLs", async () => {
  setFetcher(async (url) => {
    const parsed = new URL(url);
    if (parsed.hostname === "registry.npmjs.org") {
      return Response.json({
        objects: [{
          package: {
            name: "termglass",
            description: "Terminal JSON viewer",
            links: { npm: "https://npmjs.com/package/termglass" },
            date: "2026-07-20T00:00:00Z",
          },
        }],
      });
    }
    return Response.json({
      items: [{
        full_name: "acme/termglass",
        html_url: "https://github.com/acme/termglass",
        description: "Terminal JSON viewer",
        stargazers_count: 7,
        pushed_at: "2026-07-20T00:00:00Z",
        archived: false,
      }],
    });
  });

  const github = await searchGitHubResult("unused", ["terminal", "viewer"]);
  const npm = await searchNpmResult("unused", ["terminal", "viewer"]);
  const python = await searchPythonResult("unused", ["terminal", "viewer"]);

  assert.equal(github.ok, true);
  assert.equal(npm.ok, true);
  assert.equal(python.ok, true);
  if (!github.ok || !npm.ok || !python.ok) return;
  assert.equal(github.value[0]?.kind, "open_source");
  assert.equal(github.value[0]?.repositoryUrl, "https://github.com/acme/termglass");
  assert.deepEqual(
    github.value[0]?.evidence.map((evidence) => [evidence.query, evidence.rank]),
    [
      ["terminal viewer in:name,description,readme", 1],
      ["terminal viewer stars:0..3", 1],
    ],
  );
  assert.equal(npm.value[0]?.packageUrl, "https://npmjs.com/package/termglass");
  assert.equal(npm.value[0]?.url, "https://npmjs.com/package/termglass");
  assert.equal(npm.value[0]?.evidence[0]?.query, "terminal viewer");
  assert.equal(python.value[0]?.repositoryUrl, "https://github.com/acme/termglass");
  assert.equal(python.value[0]?.evidence[0]?.query, "terminal viewer language:python");
});
