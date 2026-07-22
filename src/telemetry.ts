// Install/retention instrumentation, "from day one" per the brief.
//
// Note on scope: the brief asked for a hosted-analytics-endpoint approach,
// which implies standing up (and paying for) backend infra — a bigger
// commitment than "smallest possible version" calls for. This module
// compromises: it always logs locally (so retention is inspectable with zero
// infra), and ALSO posts to a hosted endpoint if you configure one via
// REUSE_BEFORE_GENERATE_TELEMETRY_URL. No endpoint is bundled or defaulted —
// wire in your own analytics collector (or a simple serverless function)
// when you're ready to aggregate across installs.
//
// Every event includes an anonymous, locally-generated install ID (a random
// UUID persisted to disk) and nothing else identifying — no file paths, no
// project descriptions, no query content.

import { randomUUID } from "node:crypto";
import { appendFileSync, readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

const STATE_DIR = join(homedir(), ".reuse-before-generate");
const ID_FILE = join(STATE_DIR, "install-id");
const LOG_FILE = join(STATE_DIR, "events.jsonl");

let cachedInstallId: string | null = null;

/** Reads the persisted install id once per process. Previously this hit the
 * filesystem on every single event, which is pure overhead on a path that
 * should cost nothing. */
export function getInstallId(): string {
  if (cachedInstallId !== null) return cachedInstallId;
  try {
    mkdirSync(STATE_DIR, { recursive: true });
    if (existsSync(ID_FILE)) {
      cachedInstallId = readFileSync(ID_FILE, "utf-8").trim();
      return cachedInstallId;
    }
    const id = randomUUID();
    writeFileSync(ID_FILE, id, "utf-8");
    cachedInstallId = id;
    return id;
  } catch {
    // If we cannot persist an id, fall back to a per-process one rather than
    // failing the tool call over telemetry.
    cachedInstallId = "unpersisted-" + randomUUID();
    return cachedInstallId;
  }
}

export type TelemetryEvent =
  | { type: "tool_invoked" }
  | { type: "candidates_found"; count: number; maintainedCount: number }
  | { type: "no_candidates_found" }
  | { type: "error"; stage: string };

export interface EventEnvelope {
  installId: string;
  event: TelemetryEvent;
  timestamp: string;
}

export function buildEnvelope(event: TelemetryEvent): EventEnvelope {
  return {
    installId: getInstallId(),
    event,
    timestamp: new Date().toISOString(),
  };
}

function logLocally(envelope: EventEnvelope): void {
  try {
    mkdirSync(STATE_DIR, { recursive: true });
    appendFileSync(LOG_FILE, JSON.stringify(envelope) + "\n", "utf-8");
  } catch (err) {
    console.error(`[telemetry] local log write failed: ${(err as Error).message}`);
  }
}

async function postToEndpoint(envelope: EventEnvelope): Promise<void> {
  const url = process.env.REUSE_BEFORE_GENERATE_TELEMETRY_URL;
  if (!url) return; // no hosted endpoint configured — local log is the record of truth
  try {
    await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(envelope),
      // Don't let a slow/dead analytics endpoint hold up the tool call.
      signal: AbortSignal.timeout(2000),
    });
  } catch (err) {
    console.error(`[telemetry] endpoint post failed (non-fatal): ${(err as Error).message}`);
  }
}

/** Fire-and-forget. Telemetry must never add latency to a tool call, so this
 * returns void and swallows its own failures rather than returning a promise
 * callers are tempted to await. */
export function track(event: TelemetryEvent): void {
  if (process.env.REUSE_BEFORE_GENERATE_TELEMETRY_DISABLED === "1") return;
  const envelope = buildEnvelope(event);
  logLocally(envelope);
  void postToEndpoint(envelope).catch(() => {
    // postToEndpoint already logs; this catch exists so an unhandled
    // rejection cannot take down the process.
  });
}
