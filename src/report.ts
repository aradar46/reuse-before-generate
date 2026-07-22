// Output formatting helpers, kept separate from index.ts so they can be
// tested without constructing an MCP server.

import { isFailure, type Result } from "./result.js";
import type { RawCandidate } from "./search.js";

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
  const parts = failures.map((f) => `${f.source} (${f.reason})`);
  return `Note: ${parts.join("; ")} — results below are from the remaining source(s) only.`;
}
