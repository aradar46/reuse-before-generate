// Sole owner of outbound HTTP. Two reasons this exists:
//
// 1. Testability. search.ts previously called global fetch directly, which
//    made every code path that touches the network untestable offline.
//    setFetcher() is the seam; it is test-only.
// 2. Timeouts. The three search calls previously had none, so a hung
//    upstream hung the whole MCP tool call indefinitely. Routing everything
//    through httpGet gives every request a deadline by construction.

export type Fetcher = (url: string, init?: RequestInit) => Promise<Response>;

const defaultFetcher: Fetcher = (url, init) => fetch(url, init);

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
