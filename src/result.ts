// Result type for source-level operations. Per project convention we prefer
// returning failures over throwing them: one dead upstream (npm 503, GitHub
// rate limit) must degrade that source only, never the whole tool call.

export type Source = "github" | "npm" | "pypi";

export type Result<T> =
  | { ok: true; source: Source; value: T }
  | { ok: false; source: Source; reason: string };

export function ok<T>(source: Source, value: T): Result<T> {
  return { ok: true, source, value };
}

export function err<T>(source: Source, reason: string): Result<T> {
  return { ok: false, source, reason };
}

export function isOk<T>(r: Result<T>): r is { ok: true; source: Source; value: T } {
  return r.ok;
}
