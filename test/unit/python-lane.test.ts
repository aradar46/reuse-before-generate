import { test, afterEach } from "node:test";
import assert from "node:assert/strict";
import { searchPythonResult } from "../../dist/search.js";
import { setFetcher, resetFetcher } from "../../dist/http.js";

afterEach(() => resetFetcher());

const repoBody = {
  items: [
    {
      full_name: "psf/requests",
      html_url: "https://github.com/psf/requests",
      description: "A simple, yet elegant, HTTP library.",
      stargazers_count: 52000,
      pushed_at: "2026-07-01T00:00:00Z",
      archived: false,
    },
  ],
};

test("scopes the query with language:python", async () => {
  let seenUrl = "";
  setFetcher(async (url) => {
    seenUrl = url;
    return new Response(JSON.stringify({ items: [] }), { status: 200 });
  });

  await searchPythonResult("http client", ["http", "client"]);

  const decoded = decodeURIComponent(seenUrl);
  assert.match(decoded, /language:python/);
  assert.match(decoded, /http client/);
});

test("tags candidates as the python source, not github", async () => {
  setFetcher(async () => new Response(JSON.stringify(repoBody), { status: 200 }));

  const r = await searchPythonResult("http client", ["http", "client"]);

  assert.equal(r.ok, true);
  if (r.ok) {
    assert.equal(r.value.length, 1);
    // Tagged "python" so the eval can attribute wins to this lane, even
    // though the URL and stars are GitHub's.
    assert.equal(r.value[0].source, "python");
    assert.equal(r.value[0].id, "psf/requests");
    assert.equal(r.value[0].stars, 52000);
  }
});

test("makes no request when no keyword is usable", async () => {
  let calls = 0;
  setFetcher(async () => {
    calls += 1;
    return new Response(JSON.stringify({ items: [] }), { status: 200 });
  });

  const empty = await searchPythonResult("the a an", []);
  const junk = await searchPythonResult("x", ["", " ", "a"]);

  assert.equal(empty.ok, true);
  assert.equal(junk.ok, true);
  if (empty.ok) assert.deepEqual(empty.value, []);
  if (junk.ok) assert.deepEqual(junk.value, []);
  assert.equal(calls, 0);
});

test("reports an HTTP failure as a source failure rather than throwing", async () => {
  setFetcher(async () => new Response("rate limited", { status: 500 }));

  const r = await searchPythonResult("http client", ["http", "client"]);

  assert.equal(r.ok, false);
  if (!r.ok) {
    assert.equal(r.source, "python");
    assert.match(r.reason, /500/);
  }
});
