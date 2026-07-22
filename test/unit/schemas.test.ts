import { test } from "node:test";
import assert from "node:assert/strict";
import { GitHubSearchResponse, NpmSearchResponse, PyPIProjectResponse } from "../../dist/schemas.js";

test("GitHubSearchResponse accepts a well-formed payload", () => {
  const parsed = GitHubSearchResponse.safeParse({
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
  });
  assert.equal(parsed.success, true);
});

test("GitHubSearchResponse accepts a null description", () => {
  const parsed = GitHubSearchResponse.safeParse({
    items: [
      {
        full_name: "a/b",
        html_url: "https://github.com/a/b",
        description: null,
        stargazers_count: 0,
        pushed_at: "2026-07-01T00:00:00Z",
        archived: false,
      },
    ],
  });
  assert.equal(parsed.success, true);
});

test("GitHubSearchResponse rejects a payload missing items", () => {
  const parsed = GitHubSearchResponse.safeParse({ message: "API rate limit exceeded" });
  assert.equal(parsed.success, false);
});

test("NpmSearchResponse accepts a package without a repository link", () => {
  const parsed = NpmSearchResponse.safeParse({
    objects: [
      {
        package: {
          name: "chalk",
          description: "Terminal string styling",
          links: { npm: "https://npmjs.com/package/chalk" },
          date: "2026-01-01T00:00:00Z",
        },
      },
    ],
  });
  assert.equal(parsed.success, true);
});

test("NpmSearchResponse rejects a non-array objects field", () => {
  const parsed = NpmSearchResponse.safeParse({ objects: "nope" });
  assert.equal(parsed.success, false);
});

test("PyPIProjectResponse accepts a project with no upload urls", () => {
  const parsed = PyPIProjectResponse.safeParse({
    info: { name: "black", summary: "code formatter", project_url: "https://pypi.org/project/black/" },
    urls: [],
  });
  assert.equal(parsed.success, true);
});
