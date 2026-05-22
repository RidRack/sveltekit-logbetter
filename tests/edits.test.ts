import { decode } from "@jridgewell/sourcemap-codec";
import { describe, expect, it } from "vitest";
import { SourceEdits } from "../src/shared/edits.js";

describe("SourceEdits", () => {
  it("returns identical text when no edits", () => {
    const s = new SourceEdits("const a = 1;\nconst b = 2;\n", "x.ts");
    expect(s.toString()).toBe("const a = 1;\nconst b = 2;\n");
    expect(s.hasEdits()).toBe(false);
  });

  it("appends right after a position", () => {
    const code = "const a = 1;";
    const s = new SourceEdits(code, "x.ts");
    s.appendRight(code.length, "/*x*/");
    expect(s.toString()).toBe("const a = 1;/*x*/");
  });

  it("appends left before a position", () => {
    const code = "console.log(1);";
    const s = new SourceEdits(code, "x.ts");
    s.appendLeft(0, "/*pre*/");
    expect(s.toString()).toBe("/*pre*/console.log(1);");
  });

  it("orders left then right at same position", () => {
    const code = "ab";
    const s = new SourceEdits(code, "x.ts");
    s.appendRight(1, "R");
    s.appendLeft(1, "L");
    expect(s.toString()).toBe("aLRb");
  });

  it("multiple inserts at different positions stay in source order", () => {
    const code = "abcde";
    const s = new SourceEdits(code, "x.ts");
    s.appendRight(1, "1");
    s.appendRight(3, "3");
    expect(s.toString()).toBe("a1bc3de");
  });

  it("generates a v3 sourcemap decodable by sourcemap-codec", () => {
    const code = "line0\nline1\nline2\n";
    const s = new SourceEdits(code, "demo.ts");
    s.appendRight(6, "/*hello*/");
    const map = s.generateMap();
    expect(map.version).toBe(3);
    expect(map.sources).toEqual(["demo.ts"]);
    expect(map.sourcesContent).toEqual([code]);
    const decoded = decode(map.mappings);
    expect(decoded.length).toBeGreaterThan(0);
  });

  it("source map points each output line back to its original line", () => {
    const code = "AAA\nBBB\nCCC\n";
    const s = new SourceEdits(code, "demo.ts");
    s.appendRight(4, "/* injected */\n");
    const map = s.generateMap();
    const decoded = decode(map.mappings);
    expect(decoded[0]).toEqual([[0, 0, 0, 0]]);
    const last = decoded[decoded.length - 2];
    expect(last && last.length).toBeGreaterThan(0);
  });

  it("output line containing original source maps back to its source line", () => {
    const code = "alpha\nbeta\ngamma\n";
    const s = new SourceEdits(code, "demo.ts");
    s.appendRight(6, ";X();");
    const map = s.generateMap();
    const decoded = decode(map.mappings);
    // line 0: pure original, segment at col 0
    expect(decoded[0]?.[0]).toEqual([0, 0, 0, 0]);
    // line 1: 5 chars of inserted ";X();" then source resumes at "beta"
    expect(decoded[1]?.[0]).toEqual([5, 0, 1, 0]);
    // line 2: source-only "gamma"
    expect(decoded[2]?.[0]).toEqual([0, 0, 2, 0]);
  });

  it("inserted newline does not shift original-line mapping", () => {
    const code = "X\nY\nZ\n";
    const s = new SourceEdits(code, "demo.ts");
    s.appendRight(2, "\nINJ\n");
    const map = s.generateMap();
    const decoded = decode(map.mappings);
    const sourceLines = decoded
      .map((seg) => (seg[0] ? seg[0][2] : null))
      .filter((v) => v !== null);
    expect(sourceLines).toContain(0);
    expect(sourceLines).toContain(1);
    expect(sourceLines).toContain(2);
  });
});
