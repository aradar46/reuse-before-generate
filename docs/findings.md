# Search quality findings

This document records measured live retrieval quality and benchmark evaluation metrics across versions.

## Current Baseline (v0.10.0 — July 24, 2026)

Evaluated across the 20-case official benchmark with **GitHub API authentication** (`GITHUB_TOKEN`) and **Tavily Web Search** (`TAVILY_API_KEY`).

### Benchmark Metric Matrix

| Metric | v0.5.0 Baseline | v0.10.0 (GitHub Auth Only) | v0.10.0 (GitHub + Tavily Web) | Improvement vs v0.5.0 |
| :--- | :---: | :---: | :---: | :---: |
| **Reuse Recall @ 5** | 40.00% (8/20) | 50.00% (10/20) | **90.00% (18/20)** | **+50.00%** |
| **Reuse Recall @ 10** | 40.00% (8/20) | 50.00% (10/20) | **90.00% (18/20)** | **+50.00%** |
| **Competition Recall @ 5** | 23.53% (4/17) | 11.76% (2/17) | **41.18% (7/17)** | **+17.65%** |
| **Competition Recall @ 10** | 29.41% (5/17) | 11.76% (2/17) | **41.18% (7/17)** | **+11.77%** |
| **Combined Strict Precision @ 5** | 61.50% | 100.00% | **98.44%** | **+36.94%** |
| **Avg Query Latency** | ~7.6s / call | ~2.2s / call | **~5.4s / call** | **~1.4x Faster** |

*Full audit reports and candidate snapshots can be inspected in [`audit/0.10.0-external-2026-07-24-tavily/`](../audit/0.10.0-external-2026-07-24-tavily/)*.

---

## Core Findings

1. **High Open-Source Reuse Recall (90.00%)**:
   - 18 out of 20 expected open-source benchmark targets (including `Gitleaks`, `TruffleHog`, `action-tmate`, `Cap`, `Logseq`, `Cap`, `Cal.com`, `Excalidraw`, `Wallos`, `Sentry`) were retrieved in top-5 candidate slots.

2. **Web Discovery for Commercial Competitors (41.18%)**:
   - Commercial SaaS products without public GitHub codebases (e.g. `Calendly`, `Screen Studio`, `Datadog`, `Retool`) are discovered via Tavily web search and grouped into `Products you would compete with`. Without Tavily, product recall drops to 11.76%.

3. **High Strict Precision (98.44%)**:
   - Prescoring, deduplication, and repository substance checks (`substantial_repository`) filter out listicles, shallow forks, and unmaintained npm packages.

---

## Known Limitations

- **Formulation Sensitivity**: Keyword and formulation generation depends on the calling agent providing clear intent terms.
- **Small or Niche Repositories**: GitHub search occasionally buries very new or low-star repositories (under 5 stars).
- **Maintenance Heuristic**: Repositories active within the last year are considered active; deep contributor/issue health analysis is left to the calling agent.
- **Optional Web Key**: Web product discovery relies on `TAVILY_API_KEY`. Without it, web search is reported as unavailable.

---

## Historical Baselines

### Baseline (2026-07-23)
Prior baseline recorded during earlier v0.4/v0.5 testing before Tavily web integration and intent prescoring improvements. Retained in repository history for audit comparison.

