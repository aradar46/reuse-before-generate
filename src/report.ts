// Output formatting helpers, kept separate from index.ts so they can be
// tested without constructing an MCP server.

import type { Result } from "./result.js";
import type { RawCandidate } from "./search.js";

/** Renders a one-line caveat naming any source that failed. Silent partial
 * degradation is the failure mode most corrosive to trust in a tool whose
 * whole claim is "I checked properly" — if a source was down, say so. */
export function formatSourceFailures(results: Result<RawCandidate[]>[]): string {
  const failures = results.filter((r) => !r.ok) as Array<{
    ok: false;
    source: string;
    reason: string;
  }>;
  if (failures.length === 0) return "";
  const parts = failures.map((f) => `${f.source} (${f.reason})`);
  return `Note: ${parts.join("; ")} — results below are from the remaining source(s) only.`;
}
