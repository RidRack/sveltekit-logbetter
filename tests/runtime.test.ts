import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { logbetter, mirror } from "../src/runtime.js";
import { GLOBAL_KEY } from "../src/shared/protocol.js";

interface CapturedEmit {
  level: string;
  file: string;
  line: number;
  column: number;
  args: unknown[];
}

function installFakeRuntime() {
  const emits: CapturedEmit[] = [];
  (globalThis as Record<string, unknown>)[GLOBAL_KEY] = {
    emit(level: string, file: string, line: number, column: number, args: unknown[]) {
      emits.push({ level, file, line, column, args });
    },
  };
  return emits;
}

function uninstallRuntime() {
  delete (globalThis as Record<string, unknown>)[GLOBAL_KEY];
}

describe("logbetter runtime API", () => {
  let emits: CapturedEmit[];

  beforeEach(() => {
    emits = installFakeRuntime();
  });
  afterEach(() => {
    uninstallRuntime();
  });

  it("is a no-op when the dev runtime is not installed", () => {
    uninstallRuntime();
    expect(() => {
      logbetter.error("won't crash", new Error("nope"));
      logbetter.log({ data: 1 });
      logbetter.info();
    }).not.toThrow();
  });

  it("forwards every level with the right tag", () => {
    logbetter.log("a");
    logbetter.info("b");
    logbetter.warn("c");
    logbetter.error("d");
    logbetter.debug("e");
    logbetter.trace("f");
    expect(emits.map((e) => e.level)).toEqual([
      "log",
      "info",
      "warn",
      "error",
      "debug",
      "trace",
    ]);
  });

  it("captures arbitrary structured args verbatim", () => {
    const err = new Error("boom");
    logbetter.error("listDriverPayments failed", err, { id: 42, retry: 3 });
    expect(emits).toHaveLength(1);
    expect(emits[0]!.args[0]).toBe("listDriverPayments failed");
    expect(emits[0]!.args[1]).toBe(err);
    expect(emits[0]!.args[2]).toEqual({ id: 42, retry: 3 });
  });

  it("infers a real call site from the V8 stack", () => {
    function myCaller() {
      logbetter.error("hello");
    }
    myCaller();
    expect(emits).toHaveLength(1);
    expect(emits[0]!.file).toMatch(/runtime\.test\.ts$/);
    expect(emits[0]!.line).toBeGreaterThan(0);
    expect(emits[0]!.column).toBeGreaterThan(0);
  });
});

describe("mirror()", () => {
  let emits: CapturedEmit[];

  beforeEach(() => {
    emits = installFakeRuntime();
  });
  afterEach(() => {
    uninstallRuntime();
  });

  it("calls both the inner logger AND forwards to browser", () => {
    const innerCalls: Array<[string, unknown[]]> = [];
    const inner = {
      error: (...args: unknown[]) => innerCalls.push(["error", args]),
      log: (...args: unknown[]) => innerCalls.push(["log", args]),
    };
    const wrapped = mirror(inner);
    wrapped.error("boom", new Error("x"));
    wrapped.log("hi");

    expect(innerCalls).toHaveLength(2);
    expect(innerCalls[0]![0]).toBe("error");
    expect(innerCalls[1]![0]).toBe("log");
    expect(emits.map((e) => e.level)).toEqual(["error", "log"]);
  });

  it("works when the inner logger lacks some methods", () => {
    const inner = {
      error: (..._a: unknown[]) => {},
      // no info / warn / debug / trace
    };
    const wrapped = mirror(inner) as typeof inner & {
      warn: (...a: unknown[]) => void;
      info: (...a: unknown[]) => void;
      trace: (...a: unknown[]) => void;
    };
    expect(() => {
      wrapped.warn("a");
      wrapped.info("b");
      wrapped.trace("c");
    }).not.toThrow();
    expect(emits.map((e) => e.level)).toEqual(["warn", "info", "trace"]);
  });

  it("preserves non-Logger properties on the inner object", () => {
    const inner = { error: () => {}, name: "fleet-web", version: "1.0.0" };
    const wrapped = mirror(inner) as typeof inner & {
      name: string;
      version: string;
    };
    expect(wrapped.name).toBe("fleet-web");
    expect(wrapped.version).toBe("1.0.0");
  });

  it("wraps custom methods declared via options.methods (e.g. event/audit)", () => {
    const calls: Array<[string, unknown[]]> = [];
    const inner = {
      event: (...args: unknown[]) => calls.push(["inner.event", args]),
      audit: (...args: unknown[]) => calls.push(["inner.audit", args]),
    };
    const wrapped = mirror(inner, { methods: ["event", "audit"] }) as typeof inner;
    wrapped.event({ request_id: "abc", event: "CANONICAL" });
    wrapped.audit({ action: "login" });

    expect(calls.map((c) => c[0])).toEqual(["inner.event", "inner.audit"]);
    expect(emits.map((e) => e.level)).toEqual(["info", "info"]);
    expect(emits[0]!.args[0]).toEqual({ request_id: "abc", event: "CANONICAL" });
  });

  it("respects an explicit levelMap for custom methods", () => {
    const inner = {
      audit: (..._args: unknown[]) => {},
      metric: (..._args: unknown[]) => {},
    };
    const wrapped = mirror(inner, {
      methods: ["audit", "metric"],
      levelMap: { audit: "warn", metric: "debug" },
    }) as typeof inner;
    wrapped.audit("a");
    wrapped.metric("b");
    expect(emits.map((e) => e.level)).toEqual(["warn", "debug"]);
  });

  it("heuristically maps fatal/crit method names to error", () => {
    const inner = {
      fatal: (..._a: unknown[]) => {},
      criticalError: (..._a: unknown[]) => {},
    };
    const wrapped = mirror(inner, { methods: ["criticalError"] }) as typeof inner;
    wrapped.fatal("boom");
    wrapped.criticalError("kaboom");
    expect(emits.map((e) => e.level)).toEqual(["error", "error"]);
  });

  it("simulates a structured-logger canonical-event flow end-to-end", () => {
    // Generic structured-logger shape: standard levels plus a custom 'event'
    // method used for canonical per-request summaries.
    const calls: Array<[string, unknown[]]> = [];
    const fakeStructuredLogger = {
      info: (...a: unknown[]) => calls.push(["info", a]),
      warn: (...a: unknown[]) => calls.push(["warn", a]),
      error: (...a: unknown[]) => calls.push(["error", a]),
      debug: (...a: unknown[]) => calls.push(["debug", a]),
      event: (...a: unknown[]) => calls.push(["event", a]),
      label: "web-app",
      linkId: "web-app",
    };
    const logger = mirror(fakeStructuredLogger, {
      methods: ["event"],
      levelMap: { event: "info" },
    });

    // Canonical event with custom level
    logger.event({
      meta: { request_id: "x", path: "/", http_status: 200 },
      level: "event",
      message: "",
    });
    // Structured error — should still forward via mirror's default wrapping
    logger.error("listPayments failed", {
      error: { name: "AuthError", message: "Unauthorized" },
    });

    expect(calls.map((c) => c[0])).toEqual(["event", "error"]);
    expect(emits.map((e) => e.level)).toEqual(["info", "error"]);
    expect(emits[0]!.args[0]).toMatchObject({ level: "event" });
    expect((emits[1]!.args[1] as { error: { name: string } }).error.name).toBe(
      "AuthError",
    );
    // Non-logger properties pass through
    expect((logger as typeof fakeStructuredLogger).linkId).toBe("web-app");
  });
});
