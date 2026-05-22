import type { Handle, HandleServerError } from "@sveltejs/kit";
import { GLOBAL_KEY, type LogLevel } from "./shared/protocol.js";
import { nextRequestId, requestStorage } from "./server/request-context.js";

export interface LogbetterHookOptions {
  /**
   * Catch errors thrown past `resolve(event)` and forward them as
   * `console.error` entries. Default: `true`.
   */
  logUnhandledErrors?: boolean;
  /**
   * Forward the response body of JSON-shaped responses as a
   * `console.info` entry. Covers SvelteKit data responses (`__data.json`)
   * and `+server.ts` endpoint output. Default: `true`.
   */
  logResponseBodies?: boolean;
  /**
   * Skip response-body forwarding when Content-Length exceeds this byte
   * threshold. Default: `262_144` (256 KB).
   */
  maxResponseBodyBytes?: number;
}

/**
 * SvelteKit `Handle` that tags every server log inside a request with a
 * request id, emits request start/end events, **forwards uncaught errors**
 * as `console.error`, and forwards JSON response bodies as `console.info`.
 *
 * Production-safe: outside `vite dev` the runtime hook (`globalThis.__logbetter__`)
 * is never installed, so this Handle is a transparent passthrough. The cost
 * in production is one `globalThis` property read per request.
 *
 * Wire it into your sequence:
 *
 *   import { sequence } from "@sveltejs/kit/hooks";
 *   import { logbetterHook } from "sveltekit-logbetter/hooks";
 *
 *   export const handle = sequence(
 *     ...,
 *     logbetterHook(),
 *     ...,
 *   );
 */
export function logbetterHook(options: LogbetterHookOptions = {}): Handle {
  const logErrors = options.logUnhandledErrors ?? true;
  const logBodies = options.logResponseBodies ?? true;
  const maxBytes = options.maxResponseBodyBytes ?? 262_144;

  return async ({ event, resolve }) => {
    const runtime = getRuntime();
    if (!runtime) {
      return resolve(event);
    }

    const id = nextRequestId();
    const ctx = {
      id,
      method: event.request.method,
      url: event.url.pathname + event.url.search,
      start: nowMs(),
    };
    const routeFile = event.route.id ?? ctx.url;

    runtime.pushStart?.({ r: id, method: ctx.method, url: ctx.url, ts: Date.now() });

    return await requestStorage.run(ctx, async () => {
      let status = 200;
      let errored = false;
      try {
        const res = await resolve(event);
        status = res.status;

        if (logBodies && shouldLogBody(res, maxBytes)) {
          tapResponseBody(res, runtime, routeFile, status, ctx.method, ctx.url);
        }

        return res;
      } catch (e) {
        errored = true;
        if (logErrors) {
          runtime.emit?.(
            "error",
            routeFile,
            0,
            0,
            [`uncaught while handling ${ctx.method} ${ctx.url}`, e],
          );
        }
        // Re-throw is non-negotiable: SvelteKit's `handleError`, the default
        // stderr print, and downstream observability (Sentry / Grafana Faro /
        // OTel / structured loggers wired into `handleError`) all rely on the
        // error propagating up. Our browser forward is additive, never a
        // replacement for the normal flow.
        throw e;
      } finally {
        runtime.pushEnd?.({
          r: id,
          status,
          durationMs: nowMs() - ctx.start,
          errored,
        });
      }
    });
  };
}

/**
 * Optional wrapper for `handleError`. Forwards SvelteKit's handle-error
 * hook entries to the browser. Drop this in if you don't want the
 * Handle-level catch in `logbetterHook()` (e.g. you're using
 * `handleError` for your own error tracking and want a single source of
 * truth).
 *
 *   export const handleError = wrapHandleError(myHandleError);
 */
export function wrapHandleError(inner?: HandleServerError): HandleServerError {
  return (input) => {
    const runtime = getRuntime();
    if (runtime) {
      const routeFile = input.event.route.id ?? input.event.url.pathname;
      runtime.emit?.(
        "error",
        routeFile,
        0,
        0,
        [`handleError: ${input.status} ${input.message}`, input.error],
      );
    }
    // Always delegate to the inner handler — that's where Sentry / Grafana
    // Faro / OTel / your structured logger is wired. We forward to the
    // browser additively; we never replace the existing handler.
    return inner?.(input);
  };
}

function shouldLogBody(res: Response, maxBytes: number): boolean {
  const ct = res.headers.get("content-type") ?? "";
  if (
    !ct.includes("application/json") &&
    !ct.includes("application/x-sveltekit-data")
  ) {
    return false;
  }
  const len = res.headers.get("content-length");
  if (len !== null) {
    const n = Number(len);
    if (Number.isFinite(n) && n > maxBytes) return false;
  }
  if (!res.body) return false;
  return true;
}

function tapResponseBody(
  res: Response,
  runtime: LogbetterRuntime,
  file: string,
  status: number,
  method: string,
  url: string,
): void {
  let clone: Response;
  try {
    clone = res.clone();
  } catch {
    return;
  }
  void (async () => {
    try {
      const text = await clone.text();
      if (!text) return;
      let payload: unknown = text;
      try {
        payload = JSON.parse(text);
      } catch {
        /* leave as text */
      }
      runtime.emit?.(
        "info",
        file,
        0,
        0,
        [`← ${status} ${method} ${url}`, payload],
      );
    } catch {
      /* swallow — dev-only convenience */
    }
  })();
}

function getRuntime(): LogbetterRuntime | undefined {
  return (globalThis as Record<string, unknown>)[GLOBAL_KEY] as
    | LogbetterRuntime
    | undefined;
}

interface LogbetterRuntime {
  emit?: (
    level: LogLevel,
    file: string,
    line: number,
    column: number,
    args: unknown[],
  ) => void;
  pushStart?: (s: { r: string; method: string; url: string; ts: number }) => void;
  pushEnd?: (e: { r: string; status: number; durationMs: number; errored: boolean }) => void;
}

function nowMs(): number {
  if (typeof performance !== "undefined" && typeof performance.now === "function") {
    return performance.now();
  }
  return Date.now();
}
