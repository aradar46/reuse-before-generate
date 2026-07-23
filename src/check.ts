import type { QueryInput } from "./query-plan.js";
import type { RawCandidate } from "./candidate.js";
import type { Result } from "./result.js";
import type { PreparedCandidate } from "./verify.js";
import type { TelemetryEvent } from "./telemetry.js";
import { searchAllResults } from "./search.js";
import { prepareCandidates } from "./verify.js";
import { buildRerankPrompt } from "./rerank.js";
import { formatCoverage } from "./report.js";
import { maybeEnergyLine } from "./energy.js";
import { track } from "./telemetry.js";

export interface CheckInput {
  description: string;
  keywords: string[];
  queries?: QueryInput;
}

export interface CheckDependencies {
  search: (
    description: string,
    keywords?: string[],
    queries?: QueryInput,
  ) => Promise<Result<RawCandidate[]>[]>;
  prepare: (raw: readonly RawCandidate[]) => Promise<PreparedCandidate[]>;
  energy: () => string;
  track: (event: TelemetryEvent) => void;
}

export interface CheckResponse {
  [key: string]: unknown;
  content: Array<{ type: "text"; text: string }>;
  isError?: boolean;
}

const defaultDependencies: CheckDependencies = {
  search: searchAllResults,
  prepare: prepareCandidates,
  energy: maybeEnergyLine,
  track,
};

const NO_STRONG_MATCH = "No strong match found in the sources searched.";

export async function runCheckBeforeBuilding(
  input: CheckInput,
  dependencies: CheckDependencies = defaultDependencies,
): Promise<CheckResponse> {
  dependencies.track({ type: "tool_invoked" });
  try {
    const results = await dependencies.search(
      input.description,
      input.keywords,
      input.queries,
    );
    const coverage = formatCoverage(results);
    if (coverage.allFailed) {
      dependencies.track({ type: "error", stage: "search" });
      return {
        content: [{
          type: "text",
          text: `All discovery sources were unavailable.\n\n${coverage.text}`,
        }],
        isError: true,
      };
    }

    const raw = results.flatMap((result) => result.ok ? result.value : []);
    if (raw.length === 0) {
      dependencies.track({ type: "no_candidates_found" });
      return {
        content: [{
          type: "text",
          text:
            `${NO_STRONG_MATCH} Empty retrieval does not prove that no reusable project or competing product exists.\n\n${coverage.text}`,
        }],
      };
    }

    const prepared = await dependencies.prepare(raw);
    const maintainedCount = prepared.filter(
      (candidate) => candidate.pool === "reuse",
    ).length;
    dependencies.track({
      type: "candidates_found",
      count: raw.length,
      maintainedCount,
    });
    if (prepared.length === 0) {
      return {
        content: [{
          type: "text",
          text:
            `${NO_STRONG_MATCH} Retrieved open-source candidates were inactive and filtered; this does not prove that no alternative exists.\n\n${coverage.text}`,
        }],
      };
    }

    const prompt = buildRerankPrompt(input.description, prepared);
    return {
      content: [{
        type: "text",
        text: `${prompt}${dependencies.energy()}\n\n${coverage.text}`,
      }],
    };
  } catch (error) {
    dependencies.track({ type: "error", stage: "check_before_building" });
    const message = error instanceof Error ? error.message : String(error);
    return {
      content: [{
        type: "text",
        text: `check_before_building failed: ${message}`,
      }],
      isError: true,
    };
  }
}
