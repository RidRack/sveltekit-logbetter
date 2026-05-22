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
});
