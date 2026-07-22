// Wh-saved counter (candidate 10, folded in as a display feature per the
// validation report: it rides along on candidate 6's adoption motive rather
// than standing alone). Estimates the energy a prevented rebuild avoids, and
// keeps a running local tally across calls so the number grows visibly.
//
// The per-avoided-project estimate is a deliberately rough order-of-magnitude
// figure, not a measured value: it approximates the reasoning-heavy agent
// scaffolding session (design discussion, multiple generate/critique passes,
// boilerplate generation) that a "just extend X" decision skips entirely.
// Source for the reasoning-vs-standard-query energy gap: arXiv 2510.24509.

import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

const STATE_DIR = join(homedir(), ".reuse-before-generate");
const STATE_FILE = join(STATE_DIR, "energy-saved.json");

// Rough estimate: a full "build it myself" agent session (~15-30 reasoning
// calls at up to ~33 Wh each for planning/scaffolding/debugging, per
// arXiv 2510.24509) vs. the ~1-2 calls this tool itself costs to check first.
// We use a conservative midpoint, not the ceiling.
const ESTIMATED_WH_PER_AVOIDED_REBUILD = 250;

interface EnergyState {
  totalWhSaved: number;
  rebuildsAvoided: number;
}

function loadState(): EnergyState {
  try {
    if (existsSync(STATE_FILE)) {
      const raw = readFileSync(STATE_FILE, "utf-8");
      return JSON.parse(raw) as EnergyState;
    }
  } catch (err) {
    console.error(`[energy] failed to read state: ${(err as Error).message}`);
  }
  return { totalWhSaved: 0, rebuildsAvoided: 0 };
}

function saveState(state: EnergyState): void {
  try {
    mkdirSync(STATE_DIR, { recursive: true });
    writeFileSync(STATE_FILE, JSON.stringify(state, null, 2), "utf-8");
  } catch (err) {
    console.error(`[energy] failed to write state: ${(err as Error).message}`);
  }
}

/** Record that a maintained alternative was found (a rebuild was potentially
 * avoided) and return the updated running total for display. This is an
 * optimistic estimate — it counts "at least one maintained candidate was
 * surfaced," not a confirmed behavior change or even a confirmed semantic
 * match, since the relevance judgment happens downstream in the calling
 * agent, after this count is already recorded. */
export function recordPotentialSavings(): { totalWhSaved: number; rebuildsAvoided: number; thisEventWh: number } {
  const state = loadState();
  state.totalWhSaved += ESTIMATED_WH_PER_AVOIDED_REBUILD;
  state.rebuildsAvoided += 1;
  saveState(state);
  return {
    totalWhSaved: state.totalWhSaved,
    rebuildsAvoided: state.rebuildsAvoided,
    thisEventWh: ESTIMATED_WH_PER_AVOIDED_REBUILD,
  };
}

export function formatEnergyLine(stats: { totalWhSaved: number; rebuildsAvoided: number; thisEventWh: number }): string {
  return `~${stats.thisEventWh} Wh potentially saved this check (est.) · lifetime: ~${stats.totalWhSaved} Wh across ${stats.rebuildsAvoided} check${stats.rebuildsAvoided === 1 ? "" : "s"} that surfaced a maintained alternative. Estimate only — not a measured value.`;
}
