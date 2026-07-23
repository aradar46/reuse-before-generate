#!/usr/bin/env node
// reuse-before-generate MCP server.
//
// One tool: check_before_building. Call it before scaffolding a new project
// (or a significant new module). It searches repository, registry, launch,
// and optional web sources; verifies reusable projects; and preserves
// market evidence separately. The calling agent performs the semantic
// re-rank in its own session, with no separate billed LLM API call here.

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { runCheckBeforeBuilding } from "./check.js";
import { ARTIFACT_TYPES } from "./query-plan.js";

const server = new McpServer({
  name: "reuse-before-generate",
  version: "0.7.0",
});

server.registerTool(
  "check_before_building",
  {
    description:
      "Run this BEFORE scaffolding a new project or a substantial new module. " +
      "Searches GitHub, npm, GitLab, Show HN, optional Tavily web search, " +
      "Python repositories when relevant, and one ecosystem registry for Rust, " +
      "Ruby, PHP, or JVM projects. Returns both reusable projects and products " +
      "the proposal would compete with, plus complete retrieval evidence. " +
      "The calling agent (you) remains responsible for semantic relevance " +
      "judgment and must follow the returned scoring instructions. " +
      "REQUIRES you to supply `keywords` yourself (see its field description) " +
      "— do not guess this tool can extract good search terms on its own; " +
      "generic terms like 'mcp'/'agent'/'server' will bury results in noise.",
    inputSchema: z.object({
      description: z
        .string()
        .min(10)
        .describe(
          "Plain-language description of the project/module about to be built — what it does, not how. The more specific, the better the match quality.",
        ),
      keywords: z
        .array(z.string())
        .min(3)
        .max(6)
        .describe(
          "REQUIRED: 3-4 precise search terms YOU infer from the description, using your own understanding of what the user actually means — do this especially when the description is vague, informal, or from a non-native speaker. Pick the concrete domain noun a maintainer would actually put in their README, not a generic category word: e.g. for 'thing that checks my code doesn't have secret keys by mistake' prefer [\"git\", \"secrets\", \"detect\", \"leak\"] over [\"secret\", \"scanner\", \"detect\", \"git\"] — 'scanner' is broad enough to pull in unrelated security-tool listicles, while 'leak'/'secrets' matches how gitleaks/trufflehog actually describe themselves. Avoid generic tooling-ecosystem words (mcp, agent, server, tool, app) unless the description has nothing more specific — they return noise (awesome-lists, unrelated MCP servers) rather than real competitors. Critically, favor the word a maintainer would use to describe WHAT THE TOOL IS over the word describing the USER'S PROBLEM: a real 'pretty JSON in the terminal' tool likely calls itself a 'viewer' or 'processor', not a 'pretty-printer'/'colorizer'; a real static-site link checker likely says it validates 'rendered HTML', not 'static site alt-text'. If your first guess doesn't match, mentally simulate the README of the tool you're picturing and pull words straight from that sentence.",
        ),
      queries: z
        .object({
          category: z.string().min(2),
          outcome: z.string().min(2),
          synonyms: z.string().min(2),
          constraints: z
            .array(z.string().min(2))
            .max(5)
            .optional(),
          artifactType: z.enum(ARTIFACT_TYPES).optional(),
        })
        .optional()
        .describe(
          "Optional high-quality intent inferred semantically by the calling agent: category names what this is, outcome says what it accomplishes, synonyms supplies distinct terminology maintainers or product makers may use, constraints capture must-have properties, and artifactType says whether the desired result is an application, hosted service, CLI, or library. Older callers may omit artifactType and constraints; the server will infer a conservative fallback.",
        ),
    }),
  },
  async (input) => runCheckBeforeBuilding(input),
);

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("reuse-before-generate MCP server running on stdio");
}

main().catch((err) => {
  console.error("Fatal error starting reuse-before-generate server:", err);
  process.exit(1);
});
