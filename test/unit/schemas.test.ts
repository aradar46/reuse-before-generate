import { test } from "node:test";
import assert from "node:assert/strict";
import {
  GitHubSearchResponse,
  GitLabSearchResponse,
  HackerNewsSearchResponse,
  NpmSearchResponse,
} from "../../dist/schemas.js";

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

test("NpmSearchResponse accepts a package that omits description entirely", () => {
  // Regression guard. npm omits the key rather than sending null when a
  // package has no description — verified against live data 2026-07-22,
  // 3 of 2500 sampled packages (e.g. @vxrn/test-package). If someone
  // "tidies" the schema by dropping .optional(), this fails instead of
  // silently rejecting real npm responses and dropping the whole source.
  const parsed = NpmSearchResponse.safeParse({
    objects: [
      {
        package: {
          name: "@vxrn/test-package",
          links: { npm: "https://npmjs.com/package/@vxrn/test-package" },
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

test("GitLabSearchResponse accepts nullable project descriptions", () => {
  assert.equal(
    GitLabSearchResponse.safeParse([
      {
        id: 1,
        name_with_namespace: "group/project",
        web_url: "https://gitlab.com/group/project",
        description: null,
        star_count: 2,
        last_activity_at: "2026-07-20T00:00:00Z",
        archived: false,
      },
    ]).success,
    true,
  );
});

test("GitLabSearchResponse requires real archive state", () => {
  const parsed = GitLabSearchResponse.safeParse([
    {
      id: 1,
      name_with_namespace: "group/project",
      web_url: "https://gitlab.com/group/project",
      description: "Project",
      star_count: 2,
      last_activity_at: "2026-07-20T00:00:00Z",
    },
  ]);
  assert.equal(parsed.success, false);
});

test("HackerNewsSearchResponse accepts optional nullable launch fields", () => {
  assert.equal(
    HackerNewsSearchResponse.safeParse({
      hits: [
        {
          objectID: "1",
          title: null,
          created_at: "2026-07-20T00:00:00Z",
          url: null,
          story_text: null,
          points: null,
        },
      ],
    }).success,
    true,
  );
});
