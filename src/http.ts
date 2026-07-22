// Owner of outbound HTTP for the *search* path. Two reasons this exists:
//
// 1. Testability. search.ts previously called global fetch directly, which
//    made every code path that touches the network untestable offline.
//    setFetcher() is the seam; it is test-only.
// 2. Timeouts. The three search calls previously had none, so a hung
//    upstream hung the whole MCP tool call indefinitely. Routing everything
//    through httpGet gives every request a deadline by construction.
//    Verified end-to-end against a hung server: a 500ms timeout rejects at
//    ~503ms with a real TimeoutError, and the timers are unref'd, so they
//    neither hold the process open nor accumulate (measured flat across
//    250k calls).
//
// GET only, deliberately. telemetry.ts POSTs with a body and its own 2s
// deadline and keeps its own fetch call; generalizing this to cover one
// caller with different needs would buy nothing today.

export type Fetcher = (url: string, init?: RequestInit) => Promise<Response>;

const defaultFetcher: Fetcher = (url, init) => fetch(url, init);

// Module-global, mutated only by setFetcher in tests. Safe because
// `node --test` runs one process per test file (verified on Node 25.2.1) and
// tests within a file run sequentially, so a stub cannot leak across files.
// A runner that shares a worker between files would break that assumption.
let current: Fetcher = defaultFetcher;

/** Test-only. Replaces the fetcher used by every httpGet call. */
export function setFetcher(f: Fetcher): void {
  current = f;
}

/** Test-only. Restores the real network fetcher. */
export function resetFetcher(): void {
  current = defaultFetcher;
}

export const DEFAULT_TIMEOUT_MS = 8000;

export function httpGet(
  url: string,
  headers: Record<string, string>,
  timeoutMs: number = DEFAULT_TIMEOUT_MS,
): Promise<Response> {
  return current(url, {
    headers,
    signal: AbortSignal.timeout(timeoutMs),
  });
}
