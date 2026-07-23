import { afterEach, test } from "node:test";
import assert from "node:assert/strict";
import { resetFetcher, setFetcher } from "../../dist/http.js";
import { searchProductHuntResult } from "../../dist/sources/product-hunt.js";

afterEach(() => resetFetcher());

const feed = `<?xml version="1.0"?>
<rss version="2.0">
  <channel>
    <title>Product Hunt</title>
    <item>
      <guid>ph-1</guid>
      <title>TermGlass</title>
      <link>https://www.producthunt.com/products/termglass</link>
      <description><![CDATA[A terminal viewer for exploring JSON data.]]></description>
      <pubDate>Wed, 22 Jul 2026 10:00:00 GMT</pubDate>
    </item>
    <item>
      <guid>ph-2</guid>
      <title>Calendar Calm</title>
      <link>https://www.producthunt.com/products/calendar-calm</link>
      <description>Schedule meetings without stress.</description>
      <pubDate>Tue, 21 Jul 2026 10:00:00 GMT</pubDate>
    </item>
    <item>
      <guid>ph-3</guid>
      <title>JSON colors</title>
      <link>https://www.producthunt.com/products/json-colors</link>
      <description>Color palettes for designers.</description>
      <pubDate>Mon, 20 Jul 2026 10:00:00 GMT</pubDate>
    </item>
  </channel>
</rss>`;

test("Product Hunt matches two distinct terms and preserves query and feed rank", async () => {
  let seenUrl = "";
  let seenHeaders: Record<string, string> = {};
  setFetcher(async (url, init) => {
    seenUrl = url;
    seenHeaders = init?.headers as Record<string, string>;
    return new Response(feed);
  });

  const result = await searchProductHuntResult({
    category: "terminal json viewer",
    outcome: "schedule meetings",
    synonyms: "command line data browser",
  });

  assert.equal(seenUrl, "https://www.producthunt.com/feed");
  assert.equal(seenHeaders["User-Agent"], "reuse-before-generate-mcp/0.3");
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.value.length, 2);
  assert.deepEqual(result.value[0], {
    source: "producthunt",
    id: "ph-1",
    name: "TermGlass",
    url: "https://www.producthunt.com/products/termglass",
    description: "A terminal viewer for exploring JSON data.",
    kind: "unknown",
    evidence: [
      {
        source: "producthunt",
        sourceId: "ph-1",
        sourceUrl: "https://www.producthunt.com/products/termglass",
        destinationUrl: "https://www.producthunt.com/products/termglass",
        title: "TermGlass",
        snippet: "A terminal viewer for exploring JSON data.",
        query: "terminal json viewer",
        rank: 1,
        date: "Wed, 22 Jul 2026 10:00:00 GMT",
      },
    ],
  });
  assert.equal(result.value[1]?.id, "ph-2");
  assert.equal(result.value[1]?.evidence[0]?.query, "schedule meetings");
  assert.equal(result.value[1]?.evidence[0]?.rank, 2);
});

test("Product Hunt omits items matching only one distinct query term", async () => {
  setFetcher(async () => new Response(feed));
  const result = await searchProductHuntResult({
    category: "json json a to",
    outcome: "unrelated concepts",
  });
  assert.equal(result.ok, true);
  if (result.ok) assert.deepEqual(result.value, []);
});

test("Product Hunt normalizes a singleton item", async () => {
  setFetcher(async () =>
    new Response(`
      <feed>
        <title>Product Hunt</title>
        <entry>
          <id>only</id><title>Local API monitor</title>
          <link rel="alternate" href="https://www.producthunt.com/products/only"/>
          <content type="html">&lt;p&gt;Monitor an API locally.&lt;/p&gt;</content>
        </entry>
      </feed>
    `),
  );

  const result = await searchProductHuntResult({
    category: "local api monitor",
    outcome: "unrelated words",
  });

  assert.equal(result.ok, true);
  if (result.ok) {
    assert.equal(result.value.length, 1);
    assert.equal(result.value[0]?.evidence[0]?.rank, 1);
  }
});

test("Product Hunt treats a valid empty channel as an empty result", async () => {
  setFetcher(async () =>
    new Response(`<?xml version="1.0"?><rss><channel><title>Product Hunt</title></channel></rss>`),
  );
  assert.deepEqual(
    await searchProductHuntResult({ category: "terminal viewer", outcome: "browse json" }),
    { ok: true, source: "producthunt", value: [] },
  );
});

test("Product Hunt isolates malformed XML, structural drift, and HTTP failures", async (t) => {
  await t.test("malformed XML", async () => {
    setFetcher(async () => new Response("<rss><channel><item></rss>"));
    const result = await searchProductHuntResult({
      category: "terminal viewer",
      outcome: "browse json",
    });
    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.equal(result.source, "producthunt");
      assert.match(result.reason, /^malformed XML/);
    }
  });
  await t.test("structural drift", async () => {
    setFetcher(async () => new Response("<feed><things/></feed>"));
    assert.deepEqual(
      await searchProductHuntResult({
        category: "terminal viewer",
        outcome: "browse json",
      }),
      { ok: false, source: "producthunt", reason: "unexpected response shape" },
    );
  });
  await t.test("HTTP", async () => {
    setFetcher(async () => new Response("", { status: 502 }));
    assert.deepEqual(
      await searchProductHuntResult({
        category: "terminal viewer",
        outcome: "browse json",
      }),
      { ok: false, source: "producthunt", reason: "HTTP 502" },
    );
  });
});
