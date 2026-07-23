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

import type { PreparedCandidate } from "./verify.js";

function traction(candidate: PreparedCandidate): string {
  if (candidate.traction) return candidate.traction;
  if (candidate.stars !== undefined) return `${candidate.stars} stars`;
  return "unknown";
}

function formatCandidate(candidate: PreparedCandidate, index: number): string {
  const health = candidate.pool === "reuse"
    ? candidate.maintenanceReason
    : "discovery evidence is not a maintenance claim";
  const evidence = candidate.evidence
    .map((item) =>
      `      - source=${item.source} rank=${item.rank} query="${item.query}" snippet="${item.snippet}"`)
    .join("\n");
  return [
    `${index + 1}. ${candidate.name} (source=${candidate.source}, id="${candidate.id}")`,
    `   kind: ${candidate.kind}`,
    `   url: ${candidate.url}`,
    `   description: ${candidate.description || "(no description)"}`,
    `   traction: ${traction(candidate)}`,
    `   health/limits: ${health}`,
    "   evidence:",
    evidence || "      - (none)",
  ].join("\n");
}

function formatSection(candidates: PreparedCandidate[]): string {
  return candidates.length > 0
    ? candidates.map(formatCandidate).join("\n\n")
    : "(none retrieved)";
}

export function buildRerankPrompt(
  description: string,
  candidates: PreparedCandidate[],
): string {
  const reuse = candidates.filter((candidate) => candidate.pool === "reuse");
  const competition = candidates.filter(
    (candidate) => candidate.pool === "competition",
  );

  return `Requested project description:\n"""${description}"""\n\nProjects you could reuse\n\n${formatSection(reuse)}\n\nProducts you would compete with\n\n${formatSection(competition)}\n\n---\nUse your own semantic judgment to score relevance. Consider function, audience, workflow fit, reuse potential, market overlap, evidence quality, and project health.\n\nScoring:\n- 80-100: essentially the same job\n- 40-79: adjacent or partial overlap worth examining\n- 0-39: superficial or keyword-only overlap\n\nPopularity is context only, never a substitute for relevance. Preserve unknown kinds and other unknown values as unknown. Select at most 3 candidates scoring 40+ per section, ranked highest first. Do not pad either section with weak matches. For reusable projects, give a specific extension suggestion; for products, explain the market overlap. If a section has no candidate scoring 40+, use exactly: No strong match found in the sources searched.`;
}
