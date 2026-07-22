#!/usr/bin/env node
// reuse-before-generate MCP server.
//
// One tool: check_before_building. Call it before scaffolding a new project
// (or a significant new module). It searches GitHub/npm/PyPI and verifies
// which hits are actually maintained, then hands the calling agent a
// scoring prompt so IT performs the semantic re-rank using its own running
// session — no separate billed LLM API call from this server. This keeps
// the tool usable on any plan (Claude Pro, Max, API) with zero extra cost.

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { searchAllResults } from "./search.js";
import { verifyAll } from "./verify.js";
import { buildRerankPrompt } from "./rerank.js";
import { formatSourceFailures } from "./report.js";
import { maybeEnergyLine } from "./energy.js";
import { track } from "./telemetry.js";

const server = new McpServer({
  name: "reuse-before-generate",
  version: "0.2.0",
});

server.registerTool(
  "check_before_building",
  {
    description:
      "Run this BEFORE scaffolding a new project or a substantial new module. " +
      "Searches GitHub, npm, and PyPI for existing projects that already do " +
      "what's being proposed and filters out abandoned/unmaintained results. " +
      "Returns verified-maintained candidates plus scoring instructions — " +
      "the calling agent (you) must then judge semantic relevance itself and " +
      "present at most 3 real alternatives with a concrete 'extend this " +
      "instead of rebuilding' suggestion for each, per the returned instructions. " +
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
    }),
  },
  async ({ description, keywords }) => {
    track({ type: "tool_invoked" });

    try {
      const results = await searchAllResults(description, keywords);
      const raw = results.flatMap((r) => (r.ok ? r.value : []));
      const failureNote = formatSourceFailures(results);
      const suffix = failureNote ? `\n\n${failureNote}` : "";

      if (raw.length === 0) {
        track({ type: "no_candidates_found" });
        return {
          content: [
            {
              type: "text",
              text:
                "No candidates found on GitHub, npm, or PyPI for this description. Nothing to reuse — clear to build." +
                suffix,
            },
          ],
        };
      }

      const verified = await verifyAll(raw);
      const maintained = verified.filter((c) => c.maintained);

      if (maintained.length === 0) {
        track({ type: "candidates_found", count: raw.length, maintainedCount: 0 });
        return {
          content: [
            {
              type: "text",
              text:
                `Found ${raw.length} superficially similar result(s), but none are actively maintained (all abandoned, archived, or too low-traction to trust). Not recommending any as alternatives — clear to build, but consider why prior attempts stalled.` +
                suffix,
            },
          ],
        };
      }

      track({
        type: "candidates_found",
        count: raw.length,
        maintainedCount: maintained.length,
      });

      const prompt = buildRerankPrompt(description, maintained);
      const energyLine = maybeEnergyLine();

      return {
        content: [{ type: "text", text: `${prompt}${energyLine}${suffix}` }],
      };
    } catch (err) {
      track({ type: "error", stage: "check_before_building" });
      const message = (err as Error).message;
      return {
        content: [
          {
            type: "text",
            text: `check_before_building failed: ${message}`,
          },
        ],
        isError: true,
      };
    }
  },
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
