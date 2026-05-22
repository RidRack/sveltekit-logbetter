import { describe, expect, it } from "vitest";
import { nextId, pushEntry, snapshotDrain } from "../src/server/state.js";

function fakeServer() {
  return { hot: { send: () => {} } } as unknown as Parameters<typeof pushEntry>[0];
}

function makeEntry(id: number): Parameters<typeof pushEntry>[1] {
  return { id, t: "log", f: "x.ts", l: 1, c: 0, a: "[null]" };
}

describe("server state (HMR safety)", () => {
  it("assigns monotonic ids", () => {
    const s = fakeServer();
    const a = nextId(s);
    const b = nextId(s);
    const c = nextId(s);
    expect(b).toBe(a + 1);
    expect(c).toBe(b + 1);
  });

  it("snapshotDrain returns a copy that does not mutate state", () => {
    const s = fakeServer();
    pushEntry(s, makeEntry(1));
    pushEntry(s, makeEntry(2));
    const snap1 = snapshotDrain(s);
    expect(snap1.entries).toHaveLength(2);
    snap1.entries.push(makeEntry(99));
    const snap2 = snapshotDrain(s);
    expect(snap2.entries).toHaveLength(2);
  });

  it("ring buffer stays bounded under heavy load", () => {
    const s = fakeServer();
    for (let i = 0; i < 5000; i++) pushEntry(s, makeEntry(i));
    const snap = snapshotDrain(s);
    expect(snap.entries.length).toBeLessThanOrEqual(1000);
  });

  it("separate servers do not cross-talk via state", () => {
    const s1 = fakeServer();
    const s2 = fakeServer();
    pushEntry(s1, makeEntry(1));
    expect(snapshotDrain(s1).entries).toHaveLength(1);
    expect(snapshotDrain(s2).entries).toHaveLength(0);
  });
});
