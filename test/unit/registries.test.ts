import { afterEach, test } from "node:test";
import assert from "node:assert/strict";
import { resetFetcher, setFetcher } from "../../dist/http.js";
import { searchRegistryResults } from "../../dist/sources/registries.js";

afterEach(() => resetFetcher());

test("conditional registries make no request without a supported ecosystem", async () => {
  let calls = 0;
  setFetcher(async () => {
    calls += 1;
    return Response.json({});
  });

  assert.deepEqual(await searchRegistryResults(undefined, "query"), []);
  assert.deepEqual(await searchRegistryResults("python", "query"), []);
  assert.equal(calls, 0);
});

test("Rust routes only to crates.io and maps a crate", async () => {
  const urls: string[] = [];
  setFetcher(async (url) => {
    urls.push(url);
    return Response.json({
      crates: [
        {
          id: "serde",
          name: "serde",
          description: null,
          repository: "https://github.com/serde-rs/serde",
          updated_at: "2026-07-01T00:00:00Z",
          downloads: 123,
        },
      ],
    });
  });

  const results = await searchRegistryResults("rust", "serialization", 8);

  assert.deepEqual(urls, [
    "https://crates.io/api/v1/crates?q=serialization&per_page=8",
  ]);
  assert.equal(results.length, 1);
  assert.equal(results[0]?.ok, true);
  if (!results[0]?.ok) return;
  assert.deepEqual(results[0].value[0], {
    source: "crates",
    id: "serde",
    name: "serde",
    url: "https://github.com/serde-rs/serde",
    description: "",
    pushedAt: "2026-07-01T00:00:00Z",
    kind: "open_source",
    repositoryUrl: "https://github.com/serde-rs/serde",
    packageUrl: "https://crates.io/crates/serde",
    traction: "123 downloads",
    evidence: [
      {
        source: "crates",
        sourceId: "serde",
        sourceUrl: "https://crates.io/crates/serde",
        destinationUrl: "https://github.com/serde-rs/serde",
        title: "serde",
        snippet: "",
        query: "serialization",
        rank: 1,
        date: "2026-07-01T00:00:00Z",
      },
    ],
  });
});

test("Ruby routes only to RubyGems and maps a gem", async () => {
  const urls: string[] = [];
  setFetcher(async (url) => {
    urls.push(url);
    return Response.json([
      {
        name: "rubocop",
        info: "Ruby static code analyzer",
        project_uri: "https://rubygems.org/gems/rubocop",
        source_code_uri: "https://github.com/rubocop/rubocop",
        version_created_at: "2026-06-01T00:00:00Z",
        downloads: 456,
      },
    ]);
  });

  const results = await searchRegistryResults("ruby", "code style");

  assert.deepEqual(urls, [
    "https://rubygems.org/api/v1/search.json?query=code%20style",
  ]);
  assert.equal(results[0]?.ok, true);
  if (!results[0]?.ok) return;
  assert.equal(results[0].value[0]?.url, "https://github.com/rubocop/rubocop");
  assert.equal(results[0].value[0]?.packageUrl, "https://rubygems.org/gems/rubocop");
  assert.equal(results[0].value[0]?.traction, "456 downloads");
  assert.equal(results[0].value[0]?.evidence[0]?.query, "code style");
});

test("RubyGems accepts the live search shape without version_created_at", async () => {
  setFetcher(async () =>
    Response.json([
      {
        name: "json",
        info: "JSON implementation for Ruby",
        project_uri: "https://rubygems.org/gems/json",
        source_code_uri: null,
        downloads: 999,
      },
    ]),
  );

  const results = await searchRegistryResults("ruby", "json");

  assert.equal(results[0]?.ok, true);
  if (!results[0]?.ok) return;
  assert.equal(results[0].value[0]?.pushedAt, undefined);
  assert.equal(results[0].value[0]?.evidence[0]?.date, undefined);
});

test("PHP routes only to Packagist, enriches at most five hits, and keeps max valid activity", async () => {
  const urls: string[] = [];
  setFetcher(async (url) => {
    urls.push(url);
    if (url.startsWith("https://packagist.org/search.json")) {
      return Response.json({
        results: Array.from({ length: 7 }, (_, index) => ({
          name: `vendor/pkg-${index + 1}`,
          description: `Package ${index + 1}`,
          url: `https://packagist.org/packages/vendor/pkg-${index + 1}`,
          repository: `https://github.com/vendor/pkg-${index + 1}`,
          downloads: 100 - index,
          favers: 10 - index,
        })),
      });
    }
    if (url.includes("pkg-1.json")) {
      return Response.json({
        package: {
          versions: {
            "1.0.0": { time: "2025-01-01T00:00:00Z" },
            "2.0.0": { time: "2026-03-01T00:00:00Z" },
            broken: { time: "not-a-date" },
          },
        },
      });
    }
    if (url.includes("pkg-2.json")) {
      return new Response("", { status: 503 });
    }
    return Response.json({ package: { versions: {} } });
  });

  const results = await searchRegistryResults("php", "http client", 7);

  assert.equal(results.length, 1);
  assert.equal(results[0]?.ok, true);
  if (!results[0]?.ok) return;
  assert.equal(results[0].value.length, 7);
  assert.equal(results[0].value[0]?.pushedAt, "2026-03-01T00:00:00Z");
  assert.equal(results[0].value[1]?.pushedAt, undefined);
  assert.equal(results[0].value[5]?.pushedAt, undefined);
  assert.equal(
    urls.filter((url) => url.includes("/packages/") && url.endsWith(".json")).length,
    5,
  );
  assert.equal(urls[0], "https://packagist.org/search.json?q=http%20client");
});

test("JVM routes only to Maven Central and maps an artifact", async () => {
  const urls: string[] = [];
  setFetcher(async (url) => {
    urls.push(url);
    return Response.json({
      response: {
        docs: [
          {
            id: "org.example:widget",
            g: "org.example",
            a: "widget",
            latestVersion: "2.1.0",
            timestamp: 1780000000000,
          },
        ],
      },
    });
  });

  const results = await searchRegistryResults("jvm", "json parser", 3);

  assert.deepEqual(urls, [
    "https://search.maven.org/solrsearch/select?q=json%20parser&rows=3&wt=json",
  ]);
  assert.equal(results[0]?.ok, true);
  if (!results[0]?.ok) return;
  const artifactUrl =
    "https://central.sonatype.com/artifact/org.example/widget/2.1.0";
  assert.deepEqual(results[0].value[0], {
    source: "maven",
    id: "org.example:widget",
    name: "org.example:widget",
    url: artifactUrl,
    description: "org.example:widget 2.1.0",
    pushedAt: new Date(1780000000000).toISOString(),
    kind: "open_source",
    packageUrl: artifactUrl,
    evidence: [
      {
        source: "maven",
        sourceId: "org.example:widget",
        sourceUrl: artifactUrl,
        destinationUrl: artifactUrl,
        title: "org.example:widget",
        snippet: "org.example:widget 2.1.0",
        query: "json parser",
        rank: 1,
        date: new Date(1780000000000).toISOString(),
      },
    ],
  });
});

test("malformed registry search responses fail only their attributed source", async (t) => {
  const cases = [
    ["rust", "crates"],
    ["ruby", "rubygems"],
    ["php", "packagist"],
    ["jvm", "maven"],
  ] as const;
  for (const [ecosystem, source] of cases) {
    await t.test(source, async () => {
      setFetcher(async () => Response.json({ nope: true }));
      assert.deepEqual(await searchRegistryResults(ecosystem, "query"), [
        { ok: false, source, reason: "unexpected response shape" },
      ]);
    });
  }
});

test("Maven rejects an out-of-range timestamp without throwing", async () => {
  setFetcher(async () =>
    Response.json({
      response: {
        docs: [
          {
            id: "org.example:bad",
            g: "org.example",
            a: "bad",
            latestVersion: "1.0.0",
            timestamp: 1e100,
          },
        ],
      },
    }),
  );

  assert.deepEqual(await searchRegistryResults("jvm", "bad"), [
    { ok: false, source: "maven", reason: "unexpected response shape" },
  ]);
});

test("each registry attributes malformed Unicode queries instead of throwing", async (t) => {
  const cases = [
    ["rust", "crates"],
    ["ruby", "rubygems"],
    ["php", "packagist"],
    ["jvm", "maven"],
  ] as const;
  for (const [ecosystem, source] of cases) {
    await t.test(source, async () => {
      setFetcher(async () => {
        throw new Error("offline");
      });
      for (const query of ["\ud800", "\udc00"]) {
        assert.deepEqual(await searchRegistryResults(ecosystem, query), [
          { ok: false, source, reason: "offline" },
        ]);
      }
    });
  }
});
