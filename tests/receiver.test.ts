import { parse as acornParse } from "acorn";
import { describe, expect, it } from "vitest";
import { buildReceiverSource } from "../src/client/source.js";
import { resolveOptions } from "../src/options.js";

describe("client receiver source", () => {
  it("emits syntactically valid JS for default options", () => {
    const src = buildReceiverSource(resolveOptions());
    expect(() =>
      acornParse(src, { ecmaVersion: "latest", sourceType: "module" }),
    ).not.toThrow();
  });

  it("embeds the chosen editor scheme literally", () => {
    const src = buildReceiverSource(resolveOptions({ editor: "cursor" }));
    expect(src).toContain('cursor://file/" + file + ":"');
  });

  it("embeds full palette as a JSON literal", () => {
    const src = buildReceiverSource(resolveOptions());
    expect(src).toContain('"log":{"fg":"#FFFFFF","bg":"#4F86F7"}');
  });

  it("includes dedupe sets for HMR-safe drain", () => {
    const src = buildReceiverSource(resolveOptions());
    expect(src).toContain("seenEntries");
    expect(src).toContain("seenStarts");
    expect(src).toContain("seenEnds");
  });

  it("includes the safeParse inlined revivers", () => {
    const src = buildReceiverSource(resolveOptions());
    expect(src).toContain('"d"'); // Date tag
    expect(src).toContain('"m"'); // Map tag
    expect(src).toContain('"e"'); // Error tag
    expect(src).toContain('"o"'); // Object tag
  });

  it("references the HMR channels by their protocol names", () => {
    const src = buildReceiverSource(resolveOptions());
    expect(src).toContain("logbetter:batch");
    expect(src).toContain("logbetter:drain");
    expect(src).toContain("logbetter:drain-ack");
  });

  it("defaults expandGroupsOnError to true and embeds the flag", () => {
    const src = buildReceiverSource(resolveOptions());
    expect(src).toContain("EXPAND_ON_ERROR = true");
  });

  it("emits EXPAND_ON_ERROR=false when the option is off", () => {
    const src = buildReceiverSource(resolveOptions({ expandGroupsOnError: false }));
    expect(src).toContain("EXPAND_ON_ERROR = false");
  });

  it("buffers per-request and chooses group vs groupCollapsed at flush time", () => {
    const src = buildReceiverSource(resolveOptions());
    expect(src).toContain("buffers");
    expect(src).toContain("flushBuffer");
    expect(src).toContain("EXPAND_ON_ERROR && (buf.hasError || end.errored)");
    expect(src).toContain("expand ? console.group : console.groupCollapsed");
  });

  it("tallies severity per request and per nested group", () => {
    const src = buildReceiverSource(resolveOptions());
    expect(src).toContain("tallySeverity");
    expect(src).toContain("styleWarnMarker");
    expect(src).toContain("styleInfoMarker");
  });
});

type Call = { fn: string; args: unknown[] };

/**
 * Executes the generated receiver source against a mock console and a mock
 * import.meta.hot, returning the recorded console calls plus a dispatch
 * function to feed it batches.
 */
function runReceiver(opts = resolveOptions()) {
  const src = buildReceiverSource(opts);
  const calls: Call[] = [];
  const record = (fn: string) => (...args: unknown[]) => {
    calls.push({ fn, args });
  };
  const mockConsole: Record<string, unknown> = {};
  for (const fn of [
    "log", "info", "warn", "error", "debug", "trace", "table", "dir",
    "group", "groupCollapsed", "groupEnd", "clear", "assert", "count",
  ]) {
    mockConsole[fn] = record(fn);
  }
  const handlers = new Map<string, (payload: unknown) => void>();
  const hot = {
    on: (ev: string, fn: (payload: unknown) => void) => handlers.set(ev, fn),
    send: () => {},
  };
  const body = src.replaceAll("import.meta.hot", "__hot__");
  // eslint-disable-next-line no-new-func
  new Function("__hot__", "console", body)(hot, mockConsole);
  const dispatch = (payload: unknown) => handlers.get("logbetter:batch")!(payload);
  return { calls, dispatch };
}

const NO_ARGS = JSON.stringify([["a", []]]);

describe("client receiver behavior", () => {
  it("always marks the request group header with contained severities", () => {
    const { calls, dispatch } = runReceiver(
      resolveOptions({ expandGroupsOnError: false }),
    );
    dispatch({
      starts: [{ id: 1, r: "req_0001", method: "GET", url: "/x", ts: 0 }],
      entries: [
        { id: 2, r: "req_0001", t: "error", f: "a.ts", l: 1, c: 1, a: NO_ARGS },
        { id: 3, r: "req_0001", t: "warn", f: "a.ts", l: 2, c: 1, a: NO_ARGS },
        { id: 4, r: "req_0001", t: "info", f: "a.ts", l: 3, c: 1, a: NO_ARGS },
      ],
      ends: [{ id: 5, r: "req_0001", status: 500, durationMs: 12, errored: false }],
    });
    const header = calls.find((c) => c.fn === "groupCollapsed");
    expect(header).toBeDefined();
    const fmt = header!.args[0] as string;
    expect(fmt).toContain("✖");
    expect(fmt).toContain("⚠");
    expect(fmt).toContain("ℹ");
  });

  it("marks errors hidden inside nested subgroups on both headers", () => {
    const { calls, dispatch } = runReceiver();
    dispatch({
      starts: [{ id: 1, r: "req_0002", method: "GET", url: "/y", ts: 0 }],
      entries: [
        { id: 2, r: "req_0002", t: "groupCollapsed", f: "a.ts", l: 1, c: 1, a: NO_ARGS },
        { id: 3, r: "req_0002", t: "error", f: "a.ts", l: 2, c: 1, a: NO_ARGS },
        { id: 4, r: "req_0002", t: "error", f: "a.ts", l: 3, c: 1, a: NO_ARGS },
        { id: 5, r: "req_0002", t: "groupEnd", f: "a.ts", l: 4, c: 1, a: NO_ARGS },
      ],
      ends: [{ id: 6, r: "req_0002", status: 500, durationMs: 12, errored: false }],
    });
    const groups = calls.filter((c) => c.fn === "group");
    // Request header expands (expandGroupsOnError default) and carries ✖2;
    // the nested subgroup also expands and carries its own ✖2.
    expect(groups).toHaveLength(2);
    expect(groups[0]!.args[0]).toContain("✖2");
    expect(groups[1]!.args[0]).toContain("✖2");
  });

  it("keeps clean requests unmarked", () => {
    const { calls, dispatch } = runReceiver();
    dispatch({
      starts: [{ id: 1, r: "req_0003", method: "GET", url: "/z", ts: 0 }],
      entries: [
        { id: 2, r: "req_0003", t: "log", f: "a.ts", l: 1, c: 1, a: NO_ARGS },
      ],
      ends: [{ id: 3, r: "req_0003", status: 200, durationMs: 5, errored: false }],
    });
    const header = calls.find((c) => c.fn === "groupCollapsed");
    const fmt = header!.args[0] as string;
    expect(fmt).not.toContain("✖");
    expect(fmt).not.toContain("⚠");
    expect(fmt).not.toContain("ℹ");
  });

  it("marks a request that threw without logging an error", () => {
    const { calls, dispatch } = runReceiver(
      resolveOptions({ expandGroupsOnError: false }),
    );
    dispatch({
      starts: [{ id: 1, r: "req_0004", method: "GET", url: "/boom", ts: 0 }],
      entries: [],
      ends: [{ id: 2, r: "req_0004", status: 500, durationMs: 3, errored: true }],
    });
    const header = calls.find((c) => c.fn === "groupCollapsed");
    expect(header!.args[0]).toContain("✖");
  });

  it("closes the unattributed group before opening a request group", () => {
    const { calls, dispatch } = runReceiver();
    dispatch({
      starts: [{ id: 1, r: "req_0005", method: "GET", url: "/w", ts: 0 }],
      entries: [
        // No request id — lands in the unattributed group.
        { id: 2, t: "log", f: "a.ts", l: 1, c: 1, a: NO_ARGS },
        { id: 3, r: "req_0005", t: "log", f: "a.ts", l: 2, c: 1, a: NO_ARGS },
      ],
      ends: [{ id: 4, r: "req_0005", status: 200, durationMs: 5, errored: false }],
    });
    const names = calls.map((c) => c.fn);
    const unattributed = names.indexOf("groupCollapsed"); // "▸ unattributed"
    const closed = names.indexOf("groupEnd");
    const requestGroup = names.indexOf("groupCollapsed", unattributed + 1);
    expect(unattributed).toBeGreaterThanOrEqual(0);
    expect(closed).toBeGreaterThan(unattributed);
    expect(requestGroup).toBeGreaterThan(closed);
  });
});
