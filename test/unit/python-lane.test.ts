import { test, afterEach } from "node:test";
import assert from "node:assert/strict";
import { searchPythonRepos, searchPyPIResult } from "../../dist/search.js";
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

test("searchPythonRepos scopes the query with language:python", async () => {
  let seenUrl = "";
  setFetcher(async (url) => {
    seenUrl = url;
    return new Response(JSON.stringify({ items: [] }), { status: 200 });
  });

  await searchPythonRepos(["http", "client"]);

  const decoded = decodeURIComponent(seenUrl);
  assert.match(decoded, /language:python/);
  assert.match(decoded, /http client/);
});

test("searchPythonRepos returns candidates tagged as their real source", async () => {
  setFetcher(async () => new Response(JSON.stringify(repoBody), { status: 200 }));

  const out = await searchPythonRepos(["http", "client"]);

  assert.equal(out.length, 1);
  // Tagged github, not pypi: the URL and stars are GitHub's.
  assert.equal(out[0].source, "github");
  assert.equal(out[0].id, "psf/requests");
  assert.equal(out[0].stars, 52000);
});

test("searchPythonRepos makes no request when no keyword is usable", async () => {
  let calls = 0;
  setFetcher(async () => {
    calls += 1;
    return new Response(JSON.stringify({ items: [] }), { status: 200 });
  });

  assert.deepEqual(await searchPythonRepos([]), []);
  assert.deepEqual(await searchPythonRepos(["", " ", "a"]), []);
  assert.equal(calls, 0);
});

test("a failing python lane does not sink the PyPI result", async () => {
  // The lane is a supplement. If GitHub is rate-limited, the direct-hit
  // name guesses must still come back rather than the whole source failing.
  setFetcher(async (url) => {
    if (url.includes("api.github.com")) return new Response("nope", { status: 500 });
    return new Response(
      JSON.stringify({
        info: { name: "requests", summary: "HTTP for Humans", project_url: "https://pypi.org/project/requests/" },
        urls: [{ upload_time_iso_8601: "2026-06-01T00:00:00Z" }],
      }),
      { status: 200 },
    );
  });

  const r = await searchPyPIResult("http client", ["requests"]);

  assert.equal(r.ok, true);
  if (r.ok) {
    assert.ok(r.value.length >= 1);
    assert.equal(r.value[0].id, "requests");
  }
});

test("searchPyPIResult does not list a project twice when both lanes find it", async () => {
  setFetcher(async (url) => {
    if (url.includes("api.github.com")) {
      return new Response(
        JSON.stringify({
          items: [
            {
              full_name: "requests",
              html_url: "https://github.com/psf/requests",
              description: "dup",
              stargazers_count: 1,
              pushed_at: "2026-07-01T00:00:00Z",
              archived: false,
            },
          ],
        }),
        { status: 200 },
      );
    }
    return new Response(
      JSON.stringify({
        info: { name: "requests", summary: "HTTP for Humans", project_url: "https://pypi.org/project/requests/" },
        urls: [{ upload_time_iso_8601: "2026-06-01T00:00:00Z" }],
      }),
      { status: 200 },
    );
  });

  const r = await searchPyPIResult("http client", ["requests"]);

  assert.equal(r.ok, true);
  if (r.ok) {
    const ids = r.value.map((c) => c.id.toLowerCase());
    assert.equal(new Set(ids).size, ids.length, `duplicate ids: ${ids.join(", ")}`);
  }
});
