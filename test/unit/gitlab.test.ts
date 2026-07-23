import { afterEach, test } from "node:test";
import assert from "node:assert/strict";
import { resetFetcher, setFetcher } from "../../dist/http.js";
import { searchGitLabResult } from "../../dist/sources/gitlab.js";

afterEach(() => resetFetcher());

test("GitLab maps projects and attaches ranked query evidence", async () => {
  setFetcher(async () =>
    Response.json([
      {
        id: 42,
        name_with_namespace: "group/project",
        web_url: "https://gitlab.com/group/project",
        description: null,
        star_count: 17,
        last_activity_at: "2026-07-20T10:00:00Z",
      },
    ]),
  );

  const result = await searchGitLabResult("terminal json viewer", 7);

  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.deepEqual(result.value, [
    {
      source: "gitlab",
      id: "42",
      name: "group/project",
      url: "https://gitlab.com/group/project",
      description: "",
      stars: 17,
      pushedAt: "2026-07-20T10:00:00Z",
      archived: false,
      kind: "open_source",
      repositoryUrl: "https://gitlab.com/group/project",
      evidence: [
        {
          source: "gitlab",
          sourceId: "42",
          sourceUrl: "https://gitlab.com/group/project",
          destinationUrl: "https://gitlab.com/group/project",
          title: "group/project",
          snippet: "",
          query: "terminal json viewer",
          rank: 1,
          date: "2026-07-20T10:00:00Z",
        },
      ],
    },
  ]);
});

test("GitLab sends the documented URL and user agent", async () => {
  let seenUrl = "";
  let seenHeaders: Record<string, string> = {};
  setFetcher(async (url, init) => {
    seenUrl = url;
    seenHeaders = init?.headers as Record<string, string>;
    return Response.json([]);
  });

  await searchGitLabResult("a/b & c", 9);

  assert.equal(
    seenUrl,
    "https://gitlab.com/api/v4/projects?search=a%2Fb%20%26%20c&archived=false&per_page=9&order_by=last_activity_at",
  );
  assert.equal(seenHeaders["User-Agent"], "reuse-before-generate-mcp/0.3");
});

test("GitLab treats filtered projects as unarchived when the list response omits archived", async () => {
  setFetcher(async () =>
    Response.json([
      {
        id: 7,
        name_with_namespace: "group/simple",
        web_url: "https://gitlab.com/group/simple",
        description: "A simple response",
        star_count: 3,
        last_activity_at: "2026-07-22T00:00:00Z",
      },
    ]),
  );

  const result = await searchGitLabResult("simple");

  assert.equal(result.ok, true);
  if (result.ok) assert.equal(result.value[0]?.archived, false);
});

test("GitLab isolates HTTP failures", async () => {
  setFetcher(async () => new Response("", { status: 503 }));
  assert.deepEqual(await searchGitLabResult("query"), {
    ok: false,
    source: "gitlab",
    reason: "HTTP 503",
  });
});

test("GitLab isolates malformed response shapes", async () => {
  setFetcher(async () => Response.json({ projects: [] }));
  assert.deepEqual(await searchGitLabResult("query"), {
    ok: false,
    source: "gitlab",
    reason: "unexpected response shape",
  });
});

test("GitLab isolates thrown network failures", async () => {
  setFetcher(async () => {
    throw new Error("socket closed");
  });
  assert.deepEqual(await searchGitLabResult("query"), {
    ok: false,
    source: "gitlab",
    reason: "socket closed",
  });
});

test("GitLab attributes lone surrogate queries instead of throwing", async () => {
  setFetcher(async () => {
    throw new Error("offline");
  });
  for (const query of ["\ud800", "\udc00"]) {
    assert.deepEqual(await searchGitLabResult(query), {
      ok: false,
      source: "gitlab",
      reason: "offline",
    });
  }
});
