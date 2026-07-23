// Output formatting helpers, kept separate from index.ts so they can be
// tested without constructing an MCP server.

import { isFailure, type Result } from "./result.js";
import type { RawCandidate } from "./candidate.js";

export interface Coverage {
  text: string;
  allFailed: boolean;
}

function bareReason(source: string, reason: string): string {
  return reason.replace(
    new RegExp(
      `^${source}(?:(?:\\s+search)?\\s+failed\\s*:?\\s*|\\s*:\\s*)`,
      "i",
    ),
    "",
  );
}

/** Summarizes every attempted source without turning partial failure into silence. */
export function formatCoverage(
  results: Result<RawCandidate[]>[],
): Coverage {
  const successful = [...new Set(
    results.flatMap((result) => result.ok ? [result.source] : []),
  )];
  const failures = results.filter(isFailure);
  const lines = [
    "Search coverage:",
    `Searched: ${successful.length > 0 ? successful.join(", ") : "none"}`,
    `Unavailable: ${failures.length > 0
      ? failures
        .map((failure) =>
          `${failure.source} (${bareReason(failure.source, failure.reason)})`)
        .join("; ")
      : "none"}`,
  ];
  return {
    text: lines.join("\n"),
    allFailed: !successful.some((source) => source !== "web"),
  };
}

/** Renders a one-line caveat naming any source that failed. Silent partial
 * degradation is the failure mode most corrosive to trust in a tool whose
 * whole claim is "I checked properly" — if a source was down, say so.
 *
 * Failure reasons must NOT repeat their own source name: this prepends it,
 * so a reason of "npm search failed: HTTP 503" renders as the stuttering
 * "npm (npm search failed: HTTP 503)". Keep reasons bare ("HTTP 503"). */
export function formatSourceFailures(results: Result<RawCandidate[]>[]): string {
  const failures = results.filter(isFailure);
  if (failures.length === 0) return "";
  const parts = failures.map(
    (failure) =>
      `${failure.source} (${bareReason(failure.source, failure.reason)})`,
  );
  return `Note: ${parts.join("; ")} — results below are from the remaining source(s) only.`;
}
