import { parse as acornParse } from "acorn";
import { describe, expect, it } from "vitest";
import { resolveOptions } from "../src/options.js";
import { transformJs } from "../src/transform/js.js";

const parse = (code: string) =>
  acornParse(code, {
    ecmaVersion: "latest",
    sourceType: "module",
    locations: true,
  }) as unknown as Parameters<typeof transformJs>[2] extends infer P
    ? P extends (...a: never[]) => infer R
      ? R
      : never
    : never;

const opts = resolveOptions();

describe("transformJs", () => {
  it("returns null when no console call appears", () => {
    const r = transformJs("const x = 1;", "/p/x.ts", parse, "x.ts", opts);
    expect(r).toBeNull();
  });

  it("rewrites a simple console.log", () => {
    const code = `console.log("hello");`;
    const r = transformJs(code, "/p/x.ts", parse, "src/x.ts", opts);
    expect(r).not.toBeNull();
    expect(r!.code).toContain("__logbetter__");
    expect(r!.code).toContain('"log"');
    expect(r!.code).toContain('"src/x.ts"');
    expect(r!.code).toContain('console.log("hello")');
  });

  it("preserves original call return value via comma-expression", () => {
    const code = `const r = console.log("x");`;
    const r = transformJs(code, "/p/x.ts", parse, "src/x.ts", opts);
    expect(r!.code).toContain("(globalThis.__logbetter__");
    expect(r!.code.endsWith(";")).toBe(true);
  });

  it("rewrites multiple console methods", () => {
    const code = `console.info(1); console.warn(2); console.error(3);`;
    const r = transformJs(code, "/p/x.ts", parse, "src/x.ts", opts);
    expect(r!.code).toContain('"info"');
    expect(r!.code).toContain('"warn"');
    expect(r!.code).toContain('"error"');
  });

  it("does not transform shadowed console (it does anyway - documented)", () => {
    const code = `const console = { log: ()=>{} }; console.log("x");`;
    const r = transformJs(code, "/p/x.ts", parse, "src/x.ts", opts);
    expect(r!.code).toContain("__logbetter__");
  });

  it("skips when no levels match filter", () => {
    const o = resolveOptions({ levels: ["error"] });
    const code = `console.log("x");`;
    const r = transformJs(code, "/p/x.ts", parse, "src/x.ts", o);
    expect(r).toBeNull();
  });

  it("encodes the file path verbatim", () => {
    const code = `console.log("x");`;
    const r = transformJs(code, "/p/foo.ts", parse, "src/lib/foo.ts", opts);
    expect(r!.code).toContain('"src/lib/foo.ts"');
  });
});
