import { afterEach, test } from "node:test";
import assert from "node:assert/strict";
import { resetFetcher, setFetcher } from "../../dist/http.js";
import { searchShowHnResult } from "../../dist/sources/hacker-news.js";

afterEach(() => resetFetcher());

test("Show HN maps destination and maker-page evidence", async () => {
  setFetcher(async () =>
    Response.json({
      hits: [
        {
          objectID: "123",
          title: "Show HN: Neat tool",
          url: "https://neat.example",
          story_text: "A useful tool.",
          created_at: "2026-07-20T10:00:00Z",
          points: 81,
        },
      ],
    }),
  );

  const result = await searchShowHnResult("useful tool", 4);

  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.deepEqual(result.value, [
    {
      source: "hackernews",
      id: "123",
      name: "Show HN: Neat tool",
      url: "https://neat.example",
      description: "A useful tool.",
      kind: "unknown",
      traction: "81 points",
      evidence: [
        {
          source: "hackernews",
          sourceId: "123",
          sourceUrl: "https://news.ycombinator.com/item?id=123",
          destinationUrl: "https://neat.example",
          title: "Show HN: Neat tool",
          snippet: "A useful tool.",
          query: "useful tool",
          rank: 1,
          date: "2026-07-20T10:00:00Z",
        },
      ],
    },
  ]);
});

test("Show HN falls back to its item page when a hit has no URL", async () => {
  let seenUrl = "";
  setFetcher(async (url) => {
    seenUrl = url;
    return Response.json({
      hits: [
        {
          objectID: "456",
          title: "Show HN: Text-only launch",
          story_text: null,
          created_at: "2026-07-21T00:00:00Z",
          points: null,
        },
      ],
    });
  });

  const result = await searchShowHnResult("text launch", 6);

  assert.equal(
    seenUrl,
    "https://hn.algolia.com/api/v1/search?query=text%20launch&tags=show_hn&hitsPerPage=6",
  );
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.value[0]?.url, "https://news.ycombinator.com/item?id=456");
  assert.equal(result.value[0]?.traction, undefined);
  assert.equal(
    result.value[0]?.evidence[0]?.sourceUrl,
    "https://news.ycombinator.com/item?id=456",
  );
});

test("Show HN isolates malformed responses", async () => {
  setFetcher(async () => Response.json({ results: [] }));
  assert.deepEqual(await searchShowHnResult("query"), {
    ok: false,
    source: "hackernews",
    reason: "unexpected response shape",
  });
});

test("Show HN isolates HTTP and thrown network failures", async (t) => {
  await t.test("HTTP", async () => {
    setFetcher(async () => new Response("", { status: 429 }));
    assert.deepEqual(await searchShowHnResult("query"), {
      ok: false,
      source: "hackernews",
      reason: "HTTP 429",
    });
  });
  await t.test("network", async () => {
    setFetcher(async () => {
      throw new Error("offline");
    });
    assert.deepEqual(await searchShowHnResult("query"), {
      ok: false,
      source: "hackernews",
      reason: "offline",
    });
  });
});

test("Show HN attributes lone surrogate queries instead of throwing", async () => {
  setFetcher(async () => {
    throw new Error("offline");
  });
  for (const query of ["\ud800", "\udc00"]) {
    assert.deepEqual(await searchShowHnResult(query), {
      ok: false,
      source: "hackernews",
      reason: "offline",
    });
  }
});
