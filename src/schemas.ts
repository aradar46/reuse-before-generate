// zod schemas for upstream response bodies. search.ts previously cast
// res.json() straight to a TypeScript interface, which is a compile-time
// fiction: a shape change at GitHub or npm produced a TypeError deep inside
// the tool handler and surfaced as an opaque error string. Parsing here
// turns shape drift into a normal, attributable source failure.
//
// Every schema is deliberately permissive about fields we do not read.

import { z } from "zod";

export const GitHubSearchItem = z.object({
  full_name: z.string(),
  html_url: z.string(),
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
        description: z.string().nullable().optional(),
        links: z.object({
          npm: z.string(),
          repository: z.string().optional(),
        }),
        date: z.string(),
      }),
    }),
  ),
});

export const PyPIProjectResponse = z.object({
  info: z.object({
    name: z.string(),
    summary: z.string().nullable(),
    project_url: z.string(),
  }),
  urls: z.array(z.object({ upload_time_iso_8601: z.string().optional() })),
});

export type GitHubSearchItemT = z.infer<typeof GitHubSearchItem>;
