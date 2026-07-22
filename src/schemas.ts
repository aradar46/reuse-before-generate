// zod schemas for upstream response bodies. search.ts previously cast
// res.json() straight to a TypeScript interface, which is a compile-time
// fiction: a shape change at GitHub or npm produced a TypeError deep inside
// the tool handler and surfaced as an opaque error string. Parsing here
// turns shape drift into a normal, attributable source failure.
//
// Every schema is deliberately permissive about fields we do not read.
//
// A schema STRICTER than reality is the dangerous direction: it rejects a
// valid response as "unexpected shape" and silently drops that entire
// source. Every optionality decision below was therefore checked against
// live responses (2026-07-22), not inferred from the old hand-written
// interfaces this file replaces.

import { z } from "zod";

export const GitHubSearchItem = z.object({
  full_name: z.string(),
  html_url: z.string(),
  // Always present, sometimes null: 0 of 200 sampled items omitted the key,
  // 2 were null. Hence nullable but not optional, unlike npm's below.
  description: z.string().nullable(),
  stargazers_count: z.number(),
  pushed_at: z.string(),
  archived: z.boolean(),
});

export const GitHubSearchResponse = z.object({
  items: z.array(GitHubSearchItem),
});

export const NpmSearchResponse = z.object({
  objects: z.array(
    z.object({
      package: z.object({
        name: z.string(),
        // .optional() is load-bearing, not redundant: a package published
        // with no description omits the key ENTIRELY rather than sending
        // null. Rare but real — 3 of 2500 sampled packages, e.g.
        // @vxrn/test-package. Dropping .optional() would reject those
        // responses and take the whole npm source down with them.
        description: z.string().nullable().optional(),
        links: z.object({
          npm: z.string(),
          // Absent for ~39% of packages (984 of 2500) — most have no
          // repository field in their package.json.
          repository: z.string().optional(),
        }),
        date: z.string(),
      }),
    }),
  ),
});

export type GitHubSearchItemT = z.infer<typeof GitHubSearchItem>;
