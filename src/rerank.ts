// Semantic re-rank: the step that differentiates this tool from the
// bag-of-words competitor (idea-reality-mcp), whose keyword-overlap search
// returned hundreds of thousands of irrelevant "matches" in testing.
//
// This does NOT call an LLM API itself — that would require a separate
// billed Anthropic API key on top of whatever plan is running the calling
// agent. Instead it builds the scoring instructions as plain text and hands
// them back through the MCP tool result; the agent that invoked this tool
// (Claude Code, Claude Desktop, etc.) does the semantic judgment itself as
// part of its own response, using whatever session is already running.

import type { VerifiedCandidate } from "./verify.js";

export function buildRerankPrompt(
  description: string,
  candidates: VerifiedCandidate[],
): string {
  const candidateBlock = candidates
    .map((c, i) => {
      const traction =
        c.source === "github" ? `${c.stars ?? 0} stars` : "n/a";
      return `${i + 1}. id="${c.id}" source=${c.source} name="${c.name}"\n   description: ${c.description || "(no description)"}\n   url: ${c.url}\n   maintenance: ${c.maintenanceReason}\n   traction: ${traction}`;
    })
    .join("\n\n");

  return `Requested project description:\n"""${description}"""\n\nVerified-maintained candidates found via search (GitHub/npm/PyPI):\n\n${candidateBlock}\n\n---\nScore each candidate's semantic relevance to the requested project on your own judgment:\n- 80-100: does essentially the same job — extending it would likely satisfy the need\n- 40-79: adjacent/partial overlap, worth a look but not a drop-in replacement\n- 0-39: superficial or keyword-only match, not a real alternative\n\nRelevance is about function, not popularity — a brand-new 0-star repo that does exactly this job scores just as high as a 10k-star one; note low traction as a caveat in your suggestion (e.g. "early-stage, may be rough around the edges") rather than as a reason to discount or exclude it.\n\nPick at most 3 candidates scoring 40+, ranked highest first. For each, give a one-sentence "extend instead of rebuild" suggestion specific to that candidate. If none score 40+, say so plainly and confirm it's clear to build from scratch.`;
}
