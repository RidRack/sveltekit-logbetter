import { GLOBAL_KEY, type LogLevel } from "./shared/protocol.js";

/**
 * Public runtime API for forwarding arbitrary values to the browser console
 * from anywhere in your server code — even from places the AST transform
 * doesn't touch (node_modules, structured loggers, transports, catch blocks
 * that don't call `console.X`).
 *
 * Use this when: *   - You have a structured logger (Winston / Pino / custom) and want errors
 *     it captures to ALSO appear in DevTools.
 *   - You catch an exception in user code (load, action, endpoint) and want
 *     it visible in the browser even though you didn't re-throw.
 *   - You want to mirror anything to the browser without going through
 *     `console.*`.
 *
 * Example wiring with a structured logger:
 *
 *   import { logbetter } from "sveltekit-logbetter/runtime";
 *
 *   logger.on("logged", (entry) => {
 *     if (entry.level === "error") {
 *       logbetter.error(entry.message, entry.meta);
 *     }
 *   });
 *
 * Or directly in a catch block:
 *
 *   try {
 *     await listDriverPayments(id);
 *   } catch (err) {
 *     logger.error("listDriverPayments failed", err);  // existing flow
 *     logbetter.error("listDriverPayments failed", err); // browser visibility
 *   }
 *
 * Production behaviour: the global runtime is never installed outside
 * `vite dev`, so every call is a single property-read no-op. Safe to leave
 * in shipped code.
 */
export const logbetter: Logger = {
  log: (...args) => emit("log", args),
  info: (...args) => emit("info", args),
  warn: (...args) => emit("warn", args),
  error: (...args) => emit("error", args),
  debug: (...args) => emit("debug", args),
  trace: (...args) => emit("trace", args),
};

export interface Logger {
  log: (...args: unknown[]) => void;
  info: (...args: unknown[]) => void;
  warn: (...args: unknown[]) => void;
  error: (...args: unknown[]) => void;
  debug: (...args: unknown[]) => void;
  trace: (...args: unknown[]) => void;
}

interface Runtime {
  emit?: (
    level: LogLevel,
    file: string,
    line: number,
    column: number,
    args: unknown[],
  ) => void;
}

function emit(level: LogLevel, args: unknown[]): void {
  const runtime = (globalThis as Record<string, unknown>)[GLOBAL_KEY] as Runtime | undefined;
  if (!runtime?.emit) return;
  const site = callSite();
  runtime.emit(level, site.file, site.line, site.column, args);
}

interface CallSite {
  file: string;
  line: number;
  column: number;
}

/**
 * Walk the stack to find the first frame that's outside this package. Works
 * on V8 (Node, Bun, Deno). Falls back to a sentinel on engines that produce
 * unrecognised stack formats.
 */
const OWN_FRAME = /[\\/](?:src|dist)[\\/]runtime\.(?:t|j|m)s/;

function callSite(): CallSite {
  const stack = new Error().stack;
  if (!stack) return { file: "(unknown)", line: 0, column: 0 };
  const lines = stack.split("\n");
  for (const raw of lines) {
    const line = raw.trim();
    if (!line.startsWith("at ")) continue;
    if (line.includes("node:")) continue;
    if (OWN_FRAME.test(line)) continue;
    const m =
      line.match(/\((.+):(\d+):(\d+)\)\s*$/) ??
      line.match(/at\s+(.+):(\d+):(\d+)\s*$/);
    if (m) {
      return {
        file: stripFileUrl(m[1]!),
        line: Number(m[2]),
        column: Number(m[3]),
      };
    }
  }
  return { file: "(unknown)", line: 0, column: 0 };
}

function stripFileUrl(s: string): string {
  if (s.startsWith("file://")) {
    try {
      return new URL(s).pathname;
    } catch {
      return s.slice("file://".length);
    }
  }
  return s;
}

export type BrowserLevel = keyof Logger;

export interface MirrorOptions {
  /**
   * Extra logger method names to wrap, in addition to the defaults
   * (`log`, `info`, `warn`, `warning`, `error`, `debug`, `trace`,
   * `fatal`, `verbose`, `notice`).
   *
   * Use this when your structured logger exposes domain-specific methods
   * like `event`, `audit`, `metric`, `canonical`.
   */
  methods?: string[];
  /**
   * Map a custom method name to the browser console level used when
   * forwarding. Unmapped names use a heuristic: any name containing
   * `error`/`fatal`/`crit` → `error`, `warn` → `warn`,
   * exactly `debug` → `debug`, `trace`/`verbose` → `trace`, otherwise `info`.
   */
  levelMap?: Record<string, BrowserLevel>;
}

const DEFAULT_METHODS = [
  "log",
  "info",
  "warn",
  "warning",
  "error",
  "debug",
  "trace",
  "fatal",
  "verbose",
  "notice",
] as const;

/**
 * Mirror a structured logger's calls into the browser. Returns a new object
 * with wrapped methods that call the inner logger AND forward to the
 * browser. Non-logger properties (`name`, `linkId`, `child`, etc.) pass
 * through unchanged.
 *
 *   import { mirror } from "sveltekit-logbetter/runtime";
 *   import { logger as base } from "$lib/server/log";
 *
 *   // common shape
 *   export const logger = mirror(base);
 *
 *   // when your logger has custom levels (e.g. canonical events)
 *   export const logger = mirror(base, {
 *     methods: ["event", "audit"],
 *     levelMap: { event: "info", audit: "info" },
 *   });
 */
export function mirror<T>(inner: T, options: MirrorOptions = {}): T {
  const allMethods = new Set<string>([
    ...DEFAULT_METHODS,
    ...(options.methods ?? []),
  ]);
  const out: Record<string, (...args: unknown[]) => void> = {};

  for (const name of allMethods) {
    const innerFn = (inner as Record<string, unknown>)[name];
    const browserLevel = options.levelMap?.[name] ?? defaultLevelMap(name);
    out[name] = (...args: unknown[]) => {
      if (typeof innerFn === "function") {
        (innerFn as (...a: unknown[]) => void).call(inner, ...args);
      }
      logbetter[browserLevel](...args);
    };
  }

  return Object.assign({}, inner, out) as T;
}

function defaultLevelMap(name: string): BrowserLevel {
  const lower = name.toLowerCase();
  switch (lower) {
    case "log":
      return "log";
    case "info":
    case "notice":
      return "info";
    case "warn":
    case "warning":
      return "warn";
    case "error":
    case "fatal":
      return "error";
    case "debug":
      return "debug";
    case "trace":
    case "verbose":
      return "trace";
    default:
      if (lower.includes("error") || lower.includes("fatal") || lower.includes("crit")) {
        return "error";
      }
      if (lower.includes("warn")) return "warn";
      return "info";
  }
}
