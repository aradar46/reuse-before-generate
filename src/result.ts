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

// T is unused in the error branch and is pinned by the caller's return-type
// annotation, not by the arguments. Every call site declares its own
// `Promise<Result<...>>`, so inference works; called somewhere unannotated,
// T would silently widen to unknown. Keep the annotations.
export function err<T>(source: Source, reason: string): Result<T> {
  return { ok: false, source, reason };
}

// No isOk() guard: `r.ok` narrows the union on its own, so a helper would be
// unused indirection. Checks throughout the codebase are plain `if (r.ok)`.
