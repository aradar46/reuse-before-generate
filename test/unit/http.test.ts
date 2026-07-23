import { test, afterEach } from "node:test";
import assert from "node:assert/strict";
import {
  encodeUrlComponent,
  httpGet,
  httpPostJson,
  setFetcher,
  resetFetcher,
} from "../../dist/http.js";

afterEach(() => resetFetcher());

test("httpGet routes through the injected fetcher", async () => {
  let seenUrl = "";
  setFetcher(async (url) => {
    seenUrl = url;
    return new Response("{}", { status: 200 });
  });

  const res = await httpGet("https://example.test/a", { "User-Agent": "x" });

  assert.equal(seenUrl, "https://example.test/a");
  assert.equal(res.status, 200);
});

test("httpGet passes headers through", async () => {
  let seenHeaders: Record<string, string> = {};
  setFetcher(async (_url, init) => {
    seenHeaders = (init?.headers ?? {}) as Record<string, string>;
    return new Response("{}", { status: 200 });
  });

  await httpGet("https://example.test/a", { Authorization: "Bearer t" });

  assert.equal(seenHeaders.Authorization, "Bearer t");
});

test("httpGet attaches an abort signal so requests cannot hang forever", async () => {
  let hadSignal = false;
  setFetcher(async (_url, init) => {
    hadSignal = init?.signal instanceof AbortSignal;
    return new Response("{}", { status: 200 });
  });

  await httpGet("https://example.test/a", {});

  assert.equal(hadSignal, true);
});

test("httpPostJson sends bounded JSON through the injected fetcher", async () => {
  let seenInit: RequestInit | undefined;
  setFetcher(async (_url, init) => {
    seenInit = init;
    return Response.json({ ok: true });
  });

  await httpPostJson(
    "https://example.test/search",
    { Authorization: "Bearer secret" },
    { query: "calendar booking", max_results: 10 },
  );

  assert.equal(seenInit?.method, "POST");
  assert.equal(
    (seenInit?.headers as Record<string, string>)["Content-Type"],
    "application/json",
  );
  assert.deepEqual(JSON.parse(String(seenInit?.body)), {
    query: "calendar booking",
    max_results: 10,
  });
  assert.equal(seenInit?.signal instanceof AbortSignal, true);
});

test("setFetcher still works after resetFetcher", async () => {
  setFetcher(async () => new Response("stub", { status: 418 }));
  resetFetcher();
  // Deliberately does NOT assert the default fetcher is the real `fetch` —
  // that would mean making a network call in a unit test. This checks only
  // that the injection point survives a reset, which is what the other
  // tests depend on via afterEach.
  let called = false;
  setFetcher(async () => {
    called = true;
    return new Response("{}", { status: 200 });
  });
  await httpGet("https://example.test/a", {});
  assert.equal(called, true);
});

test("shared URL encoding replaces lone surrogates but preserves valid emoji pairs", () => {
  assert.equal(encodeUrlComponent("\ud800x\udc00"), "%EF%BF%BDx%EF%BF%BD");
  assert.equal(encodeUrlComponent("a😀b"), "a%F0%9F%98%80b");
});
