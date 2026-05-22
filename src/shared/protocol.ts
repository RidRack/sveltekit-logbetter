/**
 * Wire protocol between the Vite plugin (server) and the receiver (browser).
 * All types here are shared by both sides; do not import server- or
 * browser-only APIs from this module.
 */

export type LogLevel =
  | "log"
  | "info"
  | "warn"
  | "error"
  | "debug"
  | "trace"
  | "table"
  | "group"
  | "groupCollapsed"
  | "groupEnd"
  | "dir"
  | "count"
  | "assert"
  | "clear";

export interface LogEntry {
  /** Monotonic id, used by the receiver to dedupe drain-vs-live overlap. */
  id: number;
  /** Log method name. */
  t: LogLevel;
  /** Relative file path from project root. */
  f: string;
  /** 1-indexed line number of the original call. */
  l: number;
  /** 1-indexed column of the original call. */
  c: number;
  /** Wire-serialized args (output of safeStringify). */
  a: string;
  /** Optional request id, attached by hooks. */
  r?: string;
}

export interface RequestStart {
  id: number;
  r: string;
  method: string;
  url: string;
  ts: number;
}

export interface RequestEnd {
  id: number;
  r: string;
  status: number;
  durationMs: number;
  errored: boolean;
}

export interface BatchMessage {
  entries: LogEntry[];
  starts: RequestStart[];
  ends: RequestEnd[];
}

export const CHANNEL = {
  batch: "logbetter:batch",
  drainRequest: "logbetter:drain",
  drainResponse: "logbetter:drain-ack",
} as const;

export const GLOBAL_KEY = "__logbetter__" as const;
export const CONTEXT_KEY = "__logbetter_context__" as const;
