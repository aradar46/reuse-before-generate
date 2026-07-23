export interface GitHubSchedulerOptions {
  now?: () => number;
  sleep?: (milliseconds: number) => Promise<void>;
  maxRetries?: number;
}

const RESET_PADDING_MS = 250;
const SECONDARY_LIMIT_BACKOFF_MS = 60_000;

function defaultSleep(milliseconds: number): Promise<void> {
  if (milliseconds <= 0) return Promise.resolve();
  return new Promise((resolve) => {
    setTimeout(resolve, milliseconds);
  });
}

function headerNumber(response: Response, name: string): number | undefined {
  const raw = response.headers.get(name);
  if (raw === null || raw.trim() === "") return undefined;
  const value = Number(raw);
  return Number.isFinite(value) && value >= 0 ? value : undefined;
}

async function isLimited(response: Response): Promise<boolean> {
  if (response.status === 429) return true;
  if (response.status !== 403) return false;
  if (response.headers.has("retry-after")) return true;
  if (headerNumber(response, "x-ratelimit-remaining") === 0) return true;
  try {
    const body = await response.clone().text();
    return /(?:secondary|primary) rate limit|rate limit exceeded/i.test(body);
  } catch {
    return false;
  }
}

/**
 * Serializes GitHub repository searches and follows GitHub's rate headers.
 * One instance is shared by every search lane in a running MCP process.
 */
export class GitHubRequestScheduler {
  private readonly now: () => number;
  private readonly sleep: (milliseconds: number) => Promise<void>;
  private readonly maxRetries: number;
  private tail: Promise<void> = Promise.resolve();
  private nextAllowedAt = 0;

  constructor(options: GitHubSchedulerOptions = {}) {
    this.now = options.now ?? Date.now;
    this.sleep = options.sleep ?? defaultSleep;
    this.maxRetries = options.maxRetries ?? 2;
  }

  schedule(request: () => Promise<Response>): Promise<Response> {
    const scheduled = this.tail.then(async () => {
      const wait = this.nextAllowedAt - this.now();
      if (wait > 0) await this.sleep(wait);
      return this.execute(request);
    });
    this.tail = scheduled.then(
      () => undefined,
      () => undefined,
    );
    return scheduled;
  }

  private async execute(request: () => Promise<Response>): Promise<Response> {
    for (let attempt = 0; ; attempt += 1) {
      const response = await request();
      if (!await isLimited(response) || attempt >= this.maxRetries) {
        this.updateNextAllowedAt(response);
        return response;
      }
      await this.sleep(this.retryDelay(response, attempt));
    }
  }

  private retryDelay(response: Response, attempt: number): number {
    const retryAfter = headerNumber(response, "retry-after");
    if (retryAfter !== undefined) return retryAfter * 1_000;

    const remaining = headerNumber(response, "x-ratelimit-remaining");
    const resetSeconds = headerNumber(response, "x-ratelimit-reset");
    if (remaining === 0 && resetSeconds !== undefined) {
      return Math.max(
        0,
        resetSeconds * 1_000 - this.now() + RESET_PADDING_MS,
      );
    }
    return SECONDARY_LIMIT_BACKOFF_MS * (2 ** attempt);
  }

  private updateNextAllowedAt(response: Response): void {
    const remaining = headerNumber(response, "x-ratelimit-remaining");
    const resetSeconds = headerNumber(response, "x-ratelimit-reset");
    if (remaining === undefined || resetSeconds === undefined) return;

    const now = this.now();
    const resetAt = resetSeconds * 1_000;
    if (remaining === 0) {
      this.nextAllowedAt = Math.max(
        this.nextAllowedAt,
        resetAt + RESET_PADDING_MS,
      );
      return;
    }

    const interval = Math.ceil(
      Math.max(0, resetAt - now) / (remaining + 1),
    );
    this.nextAllowedAt = Math.max(this.nextAllowedAt, now + interval);
  }
}
