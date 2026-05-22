import { describe, expect, it } from "vitest";
import { safeParse, safeStringify } from "../src/shared/serialize.js";

function roundtrip<T>(v: T): unknown {
  return safeParse(safeStringify(v));
}

describe("safeStringify / safeParse", () => {
  it("primitives round-trip", () => {
    expect(roundtrip("hello")).toBe("hello");
    expect(roundtrip(42)).toBe(42);
    expect(roundtrip(true)).toBe(true);
    expect(roundtrip(null)).toBe(null);
    expect(roundtrip(undefined)).toBe(undefined);
  });

  it("special numbers", () => {
    expect(roundtrip(NaN)).toBeNaN();
    expect(roundtrip(Infinity)).toBe(Infinity);
    expect(roundtrip(-Infinity)).toBe(-Infinity);
  });

  it("BigInt round-trips", () => {
    expect(roundtrip(123n)).toBe(123n);
    expect(roundtrip(999999999999999999n)).toBe(999999999999999999n);
  });

  it("Date round-trips to a Date", () => {
    const d = new Date("2026-05-22T10:00:00.000Z");
    const r = roundtrip(d) as Date;
    expect(r).toBeInstanceOf(Date);
    expect(r.toISOString()).toBe(d.toISOString());
  });

  it("RegExp round-trips with flags", () => {
    const re = /foo.*bar/gi;
    const r = roundtrip(re) as RegExp;
    expect(r).toBeInstanceOf(RegExp);
    expect(r.source).toBe(re.source);
    expect(r.flags).toBe(re.flags);
  });

  it("URL round-trips", () => {
    const u = new URL("https://example.com/path?q=1");
    const r = roundtrip(u) as URL;
    expect(r).toBeInstanceOf(URL);
    expect(r.href).toBe(u.href);
  });

  it("plain object round-trips", () => {
    const o = { a: 1, b: "two", c: [3, 4, 5], d: { nested: true } };
    expect(roundtrip(o)).toEqual(o);
  });

  it("class instance keeps constructor name via toStringTag", () => {
    class Foo {
      x = 1;
    }
    const r = roundtrip(new Foo()) as Record<string, unknown>;
    expect(r.x).toBe(1);
    expect(Object.prototype.toString.call(r)).toBe("[object Foo]");
  });

  it("Map round-trips", () => {
    const m = new Map<string, number>([
      ["a", 1],
      ["b", 2],
    ]);
    const r = roundtrip(m) as Map<string, number>;
    expect(r).toBeInstanceOf(Map);
    expect(r.get("a")).toBe(1);
    expect(r.get("b")).toBe(2);
  });

  it("Set round-trips", () => {
    const s = new Set([1, 2, 3]);
    const r = roundtrip(s) as Set<number>;
    expect(r).toBeInstanceOf(Set);
    expect([...r]).toEqual([1, 2, 3]);
  });

  it("Error round-trips with stack", () => {
    const e = new Error("nope");
    const r = roundtrip(e) as Error;
    expect(r).toBeInstanceOf(Error);
    expect(r.message).toBe("nope");
    expect(typeof r.stack).toBe("string");
  });

  it("Error.cause chain round-trips", () => {
    const inner = new Error("inner");
    const outer = new Error("outer", { cause: inner });
    const r = roundtrip(outer) as Error & { cause: Error };
    expect(r.message).toBe("outer");
    expect(r.cause).toBeInstanceOf(Error);
    expect(r.cause.message).toBe("inner");
  });

  it("handles circular references", () => {
    const a: { name: string; b?: unknown } = { name: "a" };
    const b: { name: string; a: unknown } = { name: "b", a };
    a.b = b;
    const r = roundtrip(a) as { name: string; b: { name: string; a: unknown } };
    expect(r.name).toBe("a");
    expect(r.b.name).toBe("b");
    expect(r.b.a).toBe(r);
  });

  it("truncates by depth", () => {
    let v: { next?: unknown } = {};
    let head = v;
    for (let i = 0; i < 30; i++) {
      head.next = {};
      head = head.next as { next?: unknown };
    }
    const json = safeStringify(v, { maxDepth: 3 });
    expect(json).toContain("depth");
  });

  it("functions become placeholder strings", () => {
    function namedFn() {}
    expect(roundtrip(namedFn)).toBe("[Function: namedFn]");
  });

  it("symbols become placeholder strings", () => {
    expect(roundtrip(Symbol("x"))).toBe("Symbol(x)");
  });

  it("promises become placeholder strings", () => {
    expect(roundtrip(Promise.resolve(1))).toBe("[Promise]");
  });
});
