function normalized(value) {
  return String(value ?? "").trim().replace(/\s+/g, " ").toLowerCase();
}

function matches(candidate, targets) {
  const searchable = normalized([candidate.id, candidate.name, candidate.url].join(" "));
  return targets.some((target) => searchable.includes(normalized(target)));
}

export function rankExpectedTarget(candidates, expectedPool, targets) {
  const pool = candidates.filter((candidate) => candidate.pool === expectedPool);
  const index = pool.findIndex((candidate) => matches(candidate, targets));
  return {
    rank: index === -1 ? null : index + 1,
    poolSize: pool.length,
    winner: index === -1 ? null : pool[index],
  };
}

export function formulationHitRate(winner, queries) {
  if (!winner) return 0;
  const formulations = [queries.category, queries.outcome, queries.synonyms]
    .map(normalized)
    .filter(Boolean);
  if (formulations.length === 0) return 0;
  const evidenceQueries = winner.evidence.map((item) => normalized(item.query));
  const hits = formulations.filter((formulation) =>
    evidenceQueries.some((query) => query.includes(formulation)));
  return hits.length / formulations.length;
}

export function githubRequestsForPlan(plan) {
  return plan.ecosystem === "python" ? 3 : 2;
}

function poolSummary(rows, expectedPool) {
  const scored = rows.filter(
    (row) => !row.trueNegative && row.expectedPool === expectedPool,
  );
  const recallAt = (limit) => scored.length === 0
    ? 0
    : scored.filter((row) => row.rank !== null && row.rank <= limit).length
      / scored.length;
  return {
    cases: scored.length,
    recallAt5: Number(recallAt(5).toFixed(3)),
    recallAt10: Number(recallAt(10).toFixed(3)),
  };
}

export function summarize(rows, generatedAt = new Date().toISOString()) {
  const uniqueSingleSourceWins = {};
  for (const row of rows) {
    if (row.rank === null || row.evidenceSources.length !== 1) continue;
    const source = row.evidenceSources[0];
    uniqueSingleSourceWins[source] = (uniqueSingleSourceWins[source] ?? 0) + 1;
  }

  return {
    generatedAt,
    reuse: poolSummary(rows, "reuse"),
    competition: poolSummary(rows, "competition"),
    uniqueSingleSourceWins,
    webAvailability: {
      attempted: rows.filter((row) => row.webAttempted !== false).length,
      failed: rows.filter((row) =>
        row.sourceFailures.some((failure) => failure.source === "web")).length,
    },
    retrievalCandidatesOnTrueNegative: rows
      .filter((row) => row.trueNegative)
      .reduce((total, row) => total + row.retrievalCandidates, 0),
    perCase: Object.fromEntries(rows.map((row) => [
      row.id,
      {
        expectedPool: row.expectedPool,
        rank: row.rank,
        poolSize: row.poolSize,
        evidenceSources: row.evidenceSources,
        formulationHitRate: row.formulationHitRate,
        sourceFailures: row.sourceFailures,
        retrievalCandidates: row.retrievalCandidates,
        trueNegative: row.trueNegative,
      },
    ])),
  };
}
