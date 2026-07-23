import { test } from "node:test";
import assert from "node:assert/strict";
import { GitHubRequestScheduler } from "../../dist/github-scheduler.js";

test("GitHubRequestScheduler serializes concurrent requests", async () => {
  const scheduler = new GitHubRequestScheduler();
  const started: number[] = [];
  let releaseFirst: (() => void) | undefined;
  const firstGate = new Promise<void>((resolve) => {
    releaseFirst = resolve;
  });

  const first = scheduler.schedule(async () => {
    started.push(1);
    await firstGate;
    return new Response("first");
  });
  const second = scheduler.schedule(async () => {
    started.push(2);
    return new Response("second");
  });

  await Promise.resolve();
  assert.deepEqual(started, [1]);
  releaseFirst?.();
  await Promise.all([first, second]);
  assert.deepEqual(started, [1, 2]);
});

test("GitHubRequestScheduler waits for the search reset after budget exhaustion", async () => {
  let now = 1_000;
  const sleeps: number[] = [];
  const scheduler = new GitHubRequestScheduler({
    now: () => now,
    sleep: async (milliseconds) => {
      sleeps.push(milliseconds);
      now += milliseconds;
    },
  });

  await scheduler.schedule(async () =>
    new Response("first", {
      headers: {
        "x-ratelimit-remaining": "0",
        "x-ratelimit-reset": "3",
      },
    }));
  await scheduler.schedule(async () => new Response("second"));

  assert.deepEqual(sleeps, [2_250]);
});

test("GitHubRequestScheduler honors Retry-After and retries a limited response", async () => {
  const sleeps: number[] = [];
  let attempts = 0;
  const scheduler = new GitHubRequestScheduler({
    sleep: async (milliseconds) => {
      sleeps.push(milliseconds);
    },
  });

  const response = await scheduler.schedule(async () => {
    attempts += 1;
    return attempts === 1
      ? new Response("", {
        status: 429,
        headers: { "retry-after": "2" },
      })
      : new Response("ok");
  });

  assert.equal(response.status, 200);
  assert.equal(attempts, 2);
  assert.deepEqual(sleeps, [2_000]);
});

test("GitHubRequestScheduler returns an ordinary forbidden response without retrying", async () => {
  const sleeps: number[] = [];
  let attempts = 0;
  const scheduler = new GitHubRequestScheduler({
    sleep: async (milliseconds) => {
      sleeps.push(milliseconds);
    },
  });

  const response = await scheduler.schedule(async () => {
    attempts += 1;
    return Response.json(
      { message: "Resource not accessible by personal access token" },
      { status: 403 },
    );
  });

  assert.equal(response.status, 403);
  assert.equal(attempts, 1);
  assert.deepEqual(sleeps, []);
});

test("GitHubRequestScheduler recognizes a secondary-limit response body", async () => {
  const sleeps: number[] = [];
  let attempts = 0;
  const scheduler = new GitHubRequestScheduler({
    maxRetries: 1,
    sleep: async (milliseconds) => {
      sleeps.push(milliseconds);
    },
  });

  const response = await scheduler.schedule(async () => {
    attempts += 1;
    return attempts === 1
      ? Response.json(
        { message: "You have exceeded a secondary rate limit." },
        { status: 403 },
      )
      : new Response("ok");
  });

  assert.equal(response.status, 200);
  assert.equal(attempts, 2);
  assert.deepEqual(sleeps, [60_000]);
});

test("GitHubRequestScheduler stops after its bounded retry budget", async () => {
  let attempts = 0;
  const scheduler = new GitHubRequestScheduler({
    maxRetries: 2,
    sleep: async () => undefined,
  });

  const response = await scheduler.schedule(async () => {
    attempts += 1;
    return new Response("", {
      status: 403,
      headers: { "retry-after": "0" },
    });
  });

  assert.equal(response.status, 403);
  assert.equal(attempts, 3);
});
