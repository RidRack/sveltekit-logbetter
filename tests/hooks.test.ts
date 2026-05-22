import type { Handle } from "@sveltejs/kit";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { logbetterHook, wrapHandleError } from "../src/hooks.js";
import { GLOBAL_KEY } from "../src/shared/protocol.js";

interface EmittedEntry {
  level: string;
  file: string;
  args: unknown[];
}

function installFakeRuntime() {
  const emits: EmittedEntry[] = [];
  const starts: unknown[] = [];
  const ends: unknown[] = [];
  (globalThis as Record<string, unknown>)[GLOBAL_KEY] = {
    emit(level: string, file: string, _l: number, _c: number, args: unknown[]) {
      emits.push({ level, file, args });
    },
    pushStart(s: unknown) {
      starts.push(s);
    },
    pushEnd(e: unknown) {
      ends.push(e);
    },
  };
  return { emits, starts, ends };
}

function uninstallRuntime() {
  delete (globalThis as Record<string, unknown>)[GLOBAL_KEY];
}

function fakeEvent(opts: { method?: string; url?: string; routeId?: string } = {}) {
  return {
    request: { method: opts.method ?? "GET" },
    url: new URL((opts.url ?? "/") + "", "http://localhost"),
    route: { id: opts.routeId ?? null },
  } as unknown as Parameters<Handle>[0]["event"];
}

describe("logbetterHook", () => {
  let runtime: ReturnType<typeof installFakeRuntime>;

  beforeEach(() => {
    runtime = installFakeRuntime();
  });
  afterEach(() => {
    uninstallRuntime();
  });

  it("is a passthrough when no runtime is installed", async () => {
    uninstallRuntime();
    const hook = logbetterHook();
    const res = new Response("ok");
    const out = await hook({
      event: fakeEvent(),
      resolve: async () => res,
    } as unknown as Parameters<Handle>[0]);
    expect(out).toBe(res);
  });

  it("pushes start and end on success", async () => {
    const hook = logbetterHook({ logResponseBodies: false });
    const res = new Response("ok", { status: 200 });
    await hook({
      event: fakeEvent({ method: "POST", url: "/x" }),
      resolve: async () => res,
    } as unknown as Parameters<Handle>[0]);
    expect(runtime.starts).toHaveLength(1);
    expect(runtime.ends).toHaveLength(1);
    expect((runtime.ends[0] as { errored: boolean }).errored).toBe(false);
  });

  it("does not swallow errors — Grafana/Sentry/Faro/handleError all still fire", async () => {
    // Simulate a downstream handler (e.g. SvelteKit's handleError → Sentry).
    const hook = logbetterHook({ logResponseBodies: false });
    const boom = new Error("kaboom");
    let downstreamCaughtBy: unknown = null;
    try {
      await hook({
        event: fakeEvent(),
        resolve: async () => {
          throw boom;
        },
      } as unknown as Parameters<Handle>[0]);
    } catch (e) {
      downstreamCaughtBy = e;
    }
    expect(downstreamCaughtBy).toBe(boom);
    expect(runtime.emits).toHaveLength(1);
  });

  it("forwards uncaught errors as console.error", async () => {
    const hook = logbetterHook({ logResponseBodies: false });
    const boom = new Error("kaboom");
    await expect(
      hook({
        event: fakeEvent({ routeId: "/(app)/products/[id]" }),
        resolve: async () => {
          throw boom;
        },
      } as unknown as Parameters<Handle>[0]),
    ).rejects.toBe(boom);

    expect(runtime.emits).toHaveLength(1);
    expect(runtime.emits[0]!.level).toBe("error");
    expect(runtime.emits[0]!.file).toBe("/(app)/products/[id]");
    expect(runtime.emits[0]!.args[1]).toBe(boom);
    expect((runtime.ends[0] as { errored: boolean }).errored).toBe(true);
  });

  it("can be configured to skip uncaught-error forwarding", async () => {
    const hook = logbetterHook({ logUnhandledErrors: false, logResponseBodies: false });
    const boom = new Error("kaboom");
    await expect(
      hook({
        event: fakeEvent(),
        resolve: async () => {
          throw boom;
        },
      } as unknown as Parameters<Handle>[0]),
    ).rejects.toBe(boom);
    expect(runtime.emits).toHaveLength(0);
  });

  it("forwards JSON response bodies as console.info", async () => {
    const hook = logbetterHook();
    const body = JSON.stringify({ id: 42, name: "x" });
    const res = new Response(body, {
      status: 200,
      headers: { "content-type": "application/json" },
    });
    await hook({
      event: fakeEvent({ url: "/api/x" }),
      resolve: async () => res,
    } as unknown as Parameters<Handle>[0]);

    // body tap is async — give the microtask queue a tick or two
    await new Promise((r) => setTimeout(r, 5));

    const infoEmits = runtime.emits.filter((e) => e.level === "info");
    expect(infoEmits.length).toBeGreaterThan(0);
    const args = infoEmits[0]!.args as [string, { id: number; name: string }];
    expect(args[0]).toMatch(/← 200 GET \/api\/x/);
    expect(args[1]).toEqual({ id: 42, name: "x" });
  });

  it("skips body forwarding for non-JSON content types", async () => {
    const hook = logbetterHook();
    const res = new Response("<html></html>", {
      status: 200,
      headers: { "content-type": "text/html" },
    });
    await hook({
      event: fakeEvent(),
      resolve: async () => res,
    } as unknown as Parameters<Handle>[0]);
    await new Promise((r) => setTimeout(r, 5));
    const infoEmits = runtime.emits.filter((e) => e.level === "info");
    expect(infoEmits).toHaveLength(0);
  });

  it("skips body forwarding when Content-Length exceeds the cap", async () => {
    const hook = logbetterHook({ maxResponseBodyBytes: 10 });
    const body = JSON.stringify({ data: "this is more than ten bytes" });
    const res = new Response(body, {
      status: 200,
      headers: {
        "content-type": "application/json",
        "content-length": String(body.length),
      },
    });
    await hook({
      event: fakeEvent(),
      resolve: async () => res,
    } as unknown as Parameters<Handle>[0]);
    await new Promise((r) => setTimeout(r, 5));
    const infoEmits = runtime.emits.filter((e) => e.level === "info");
    expect(infoEmits).toHaveLength(0);
  });

  it("recognises sveltekit data responses", async () => {
    const hook = logbetterHook();
    const res = new Response("[1,null,{}]", {
      status: 200,
      headers: { "content-type": "application/x-sveltekit-data" },
    });
    await hook({
      event: fakeEvent({ url: "/__data.json" }),
      resolve: async () => res,
    } as unknown as Parameters<Handle>[0]);
    await new Promise((r) => setTimeout(r, 5));
    const infoEmits = runtime.emits.filter((e) => e.level === "info");
    expect(infoEmits.length).toBeGreaterThan(0);
  });
});

describe("wrapHandleError", () => {
  let runtime: ReturnType<typeof installFakeRuntime>;
  beforeEach(() => {
    runtime = installFakeRuntime();
  });
  afterEach(() => {
    uninstallRuntime();
  });

  it("propagates inner's return value (e.g. App.Error for Sentry/Grafana)", () => {
    const handler = wrapHandleError(() => ({ message: "from-inner" }) as never);
    const out = handler({
      error: new Error("nope"),
      event: fakeEvent(),
      status: 500,
      message: "x",
    } as never) as { message: string };
    expect(out.message).toBe("from-inner");
  });

  it("does not swallow throws from inner", () => {
    const handler = wrapHandleError(() => {
      throw new Error("inner-threw");
    });
    expect(() =>
      handler({
        error: new Error("orig"),
        event: fakeEvent(),
        status: 500,
        message: "x",
      } as never),
    ).toThrow("inner-threw");
  });

  it("forwards errors to console.error and calls inner", () => {
    let innerCalled = false;
    const inner = () => {
      innerCalled = true;
      return undefined;
    };
    const handler = wrapHandleError(inner);
    handler({
      error: new Error("nope"),
      event: fakeEvent({ routeId: "/foo" }),
      status: 500,
      message: "Internal Error",
    } as never);
    expect(innerCalled).toBe(true);
    expect(runtime.emits).toHaveLength(1);
    expect(runtime.emits[0]!.level).toBe("error");
  });

  it("works without an inner handler", () => {
    const handler = wrapHandleError();
    expect(() =>
      handler({
        error: new Error("nope"),
        event: fakeEvent(),
        status: 500,
        message: "x",
      } as never),
    ).not.toThrow();
  });
});
