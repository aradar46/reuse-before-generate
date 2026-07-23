# Useful Discovery Ranking Design

**Date:** 2026-07-23  
**Target:** reuse-before-generate 0.5.0

## Objective

Improve useful discovery, not merely one benchmark number. The primary
outcome is that a user sees strong reusable alternatives and competing
products near the top. Fixed-target recall remains a regression signal.

The frozen 0.4.0 audit is the baseline:

- reuse recall@5: 25%;
- competition recall@5: 23.53%;
- strict precision@5: 30.65%; and
- top-five noise: 50.25%.

## Intent model

The calling agent may supply:

- core category;
- desired outcome/workflow;
- synonyms;
- constraints such as privacy, offline, self-hosted, or platform; and
- `artifactType`: `application`, `service`, `cli`, or `library`.

The new fields are optional. Older callers use conservative local inference,
with `application` as the final fallback.

## Retrieval

GitHub uses at most four bounded, intent-derived lanes:

1. category;
2. synonyms;
3. the most specific workflow or constraint formulation; and
4. a low-star niche lane.

No target names are manufactured or injected. Each lane retains a small
quota before candidates are merged.

npm remains available, but its ranking influence depends on artifact type.
It is primary for libraries, secondary for CLI tools, and cannot crowd
repository applications or services out of the visible shortlist.

Web discovery uses two focused basic Tavily searches when configured:

- reusable/open-source/self-hosted alternatives; and
- existing software/products.

The two results are merged into one attributed `web` source result. Missing
credentials and upstream failures retain the existing coverage semantics.

## Evidence-aware prescore

The MCP performs deterministic prescoring before the calling agent's final
semantic judgment. The score uses:

- category, outcome, synonym, constraint, and platform coverage;
- agreement across independent lanes and sources;
- repository/application identity;
- artifact-type fit;
- maintenance evidence; and
- small popularity context, never popularity as the primary signal.

It penalizes listicles, generic articles, awesome lists, SDKs, plugins,
templates, wrappers, and components unless the requested artifact type makes
them appropriate.

The score is transparent: returned candidates carry matched signals and
penalties. It is a pruning and ordering mechanism, not a claim of semantic
equivalence.

## Output and pool behavior

The MCP returns a compact shortlist for the calling agent to judge:

1. strong reusable candidates;
2. promising niche reusable projects;
3. adjacent building blocks; and
4. commercial competitors.

Repository-backed web results are resolved and verified before reuse claims.
Informational pages are not themselves treated as products. Hybrid
open-source/commercial identities may contribute evidence to both purposes
without claiming that an unverified website is a maintained repository.

The calling agent remains responsible for final semantic scoring and may
return fewer results rather than padding with weak matches.

## Budgets

- GitHub: no more than four repository-search requests per check.
- Tavily: no more than two basic searches per check.
- Other sources retain their existing bounded plans.
- Shortlist metadata enrichment is bounded and never applied to every raw
  candidate.

## Validation

Offline tests cover intent fallback, lane construction, budgets, npm routing,
prescore explanations, penalties, lane diversity, pool identity, compact
output, and source failure isolation.

The frozen external audit is replayed without changing its cases or expected
targets. Acceptance targets are:

- reuse recall@5 at least 40%;
- competition recall@5 at least 40%;
- strict precision@5 at least 40%;
- top-five noise below 40%;
- no recall@10 regression;
- no hardcoded audit targets; and
- no source-coverage regression.

Additionally report the goal-aligned rate of cases containing at least one
same-job result in reuse, competition, and both pools.

## Non-goals

- No local discovery index.
- No mandatory semantic or embedding API.
- No target-specific rules.
- No claim that lexical prescoring replaces semantic judgment.
- No audit bookkeeping in normal MCP output.
