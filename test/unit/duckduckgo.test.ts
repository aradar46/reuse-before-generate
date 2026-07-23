import { afterEach, test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { resetFetcher, setFetcher } from "../../dist/http.js";
import {
  parseDuckDuckGoHtml,
  searchWebResult,
} from "../../dist/sources/duckduckgo.js";

afterEach(() => resetFetcher());

const fixtures = new URL("../fixtures/duckduckgo/", import.meta.url);

async function fixture(name: string): Promise<string> {
  return readFile(fileURLToPath(new URL(name, fixtures)), "utf8");
}

test("DuckDuckGo extracts two ranked results and decodes basic HTML", async () => {
  const parsed = parseDuckDuckGoHtml(
    await fixture("results.html"),
    "terminal json viewer",
  );

  assert.equal(parsed.ok, true);
  if (!parsed.ok) return;
  assert.equal(parsed.value.length, 2);
  assert.deepEqual(parsed.value[0], {
    source: "web",
    id: "https://example.com/json?view=tree",
    name: "JSON & Tree Viewer",
    url: "https://example.com/json?view=tree",
    description: "Explore <JSON> in your terminal.",
    kind: "unknown",
    evidence: [
      {
        source: "web",
        sourceId: "https://example.com/json?view=tree",
        sourceUrl: "https://example.com/json?view=tree",
        destinationUrl: "https://example.com/json?view=tree",
        title: "JSON & Tree Viewer",
        snippet: "Explore <JSON> in your terminal.",
        query: "terminal json viewer",
        rank: 1,
      },
    ],
  });
  assert.equal(parsed.value[1]?.name, "Second tool 'launch'");
  assert.equal(parsed.value[1]?.description, 'A fast "local" browser.');
  assert.equal(parsed.value[1]?.evidence[0]?.rank, 2);
});

test("DuckDuckGo resolves uddg-wrapped destinations", async () => {
  const parsed = parseDuckDuckGoHtml(await fixture("results.html"), "query");
  assert.equal(parsed.ok, true);
  if (parsed.ok) {
    assert.equal(parsed.value[0]?.url, "https://example.com/json?view=tree");
  }
});

test("DuckDuckGo recognizes challenge pages", async () => {
  assert.deepEqual(
    parseDuckDuckGoHtml(await fixture("challenge.html"), "query"),
    { ok: false, source: "web", reason: "challenge response" },
  );
});

test("DuckDuckGo distinguishes known no-results pages from markup drift", () => {
  assert.deepEqual(
    parseDuckDuckGoHtml(
      '<html><div class="no-results">No results found for query</div></html>',
      "query",
    ),
    { ok: true, source: "web", value: [] },
  );
  assert.deepEqual(
    parseDuckDuckGoHtml("<html><main>upstream changed</main></html>", "query"),
    { ok: false, source: "web", reason: "unexpected response shape" },
  );
});

test("DuckDuckGo fails the whole page when a recognized result loses href", async () => {
  assert.deepEqual(
    parseDuckDuckGoHtml(await fixture("changed-href.html"), "query"),
    { ok: false, source: "web", reason: "unexpected response shape" },
  );
});

test("DuckDuckGo fails the whole page when a recognized result loses its snippet", async () => {
  assert.deepEqual(
    parseDuckDuckGoHtml(await fixture("missing-snippet.html"), "query"),
    { ok: false, source: "web", reason: "unexpected response shape" },
  );
});

test("DuckDuckGo fails instead of returning a partial page when a result anchor changes", async () => {
  assert.deepEqual(
    parseDuckDuckGoHtml(await fixture("changed-result-anchor.html"), "query"),
    { ok: false, source: "web", reason: "unexpected response shape" },
  );
});

test("web search sends exactly the category and Product Hunt queries", async () => {
  const urls: string[] = [];
  const hadSignals: boolean[] = [];
  setFetcher(async (url, init) => {
    urls.push(url);
    hadSignals.push(init?.signal instanceof AbortSignal);
    return new Response(
      '<!doctype html><html><div class="no-results">No results found</div></html>',
    );
  });

  const result = await searchWebResult("terminal json viewer");

  assert.deepEqual(urls.sort(), [
    "https://html.duckduckgo.com/html/?q=site%3Aproducthunt.com%2Fproducts%20terminal%20json%20viewer",
    "https://html.duckduckgo.com/html/?q=terminal%20json%20viewer",
  ]);
  assert.deepEqual(hadSignals, [true, true]);
  assert.deepEqual(result, { ok: true, source: "web", value: [] });
});

test("web search fails as a unit when either request fails or challenges", async (t) => {
  await t.test("HTTP failure", async () => {
    let calls = 0;
    setFetcher(async () => {
      calls += 1;
      return calls === 1
        ? new Response("", { status: 503 })
        : new Response("<html></html>");
    });
    assert.deepEqual(await searchWebResult("query"), {
      ok: false,
      source: "web",
      reason: "HTTP 503",
    });
    assert.equal(calls, 2);
  });
  await t.test("challenge", async () => {
    const challenge = await fixture("challenge.html");
    let calls = 0;
    setFetcher(async () => {
      calls += 1;
      return new Response(calls === 1 ? challenge : "<html></html>");
    });
    assert.deepEqual(await searchWebResult("query"), {
      ok: false,
      source: "web",
      reason: "challenge response",
    });
    assert.equal(calls, 2);
  });
});
