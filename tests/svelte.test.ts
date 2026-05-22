import { parse as acornParse } from "acorn";
import { describe, expect, it } from "vitest";
import { resolveOptions } from "../src/options.js";
import { transformSvelte } from "../src/transform/svelte.js";

const parse = (code: string) =>
  acornParse(code, {
    ecmaVersion: "latest",
    sourceType: "module",
    locations: true,
  }) as never;

const opts = resolveOptions();

describe("transformSvelte", () => {
  it("returns null when no console call", async () => {
    const src = `<script lang="ts">
let n = 1;
</script>
<p>hi</p>`;
    const r = await transformSvelte(src, "/p/x.svelte", parse, "x.svelte", opts);
    expect(r).toBeNull();
  });

  it("rewrites console.log inside the instance script", async () => {
    const src = `<script lang="ts">
console.log("hello");
let n = 1;
</script>
<p>{n}</p>`;
    const r = await transformSvelte(src, "/p/x.svelte", parse, "src/x.svelte", opts);
    expect(r).not.toBeNull();
    expect(r!.code).toContain("__logbetter__");
    expect(r!.code).toContain('"log"');
    expect(r!.code).toContain('"src/x.svelte"');
    expect(r!.code).toContain('console.log("hello")');
  });

  it("rewrites console.log inside a module script", async () => {
    const src = `<script context="module" lang="ts">
console.warn("module");
</script>
<script lang="ts">let n = 1;</script>`;
    const r = await transformSvelte(src, "/p/x.svelte", parse, "src/x.svelte", opts);
    expect(r).not.toBeNull();
    expect(r!.code).toContain('"warn"');
    expect(r!.code).toContain('console.warn("module")');
  });

  it("leaves markup alone", async () => {
    const src = `<script lang="ts">
console.log("a");
</script>
<p>{ "console.log" }</p>`;
    const r = await transformSvelte(src, "/p/x.svelte", parse, "src/x.svelte", opts);
    expect(r!.code).toContain("console.log");
    expect(r!.code).toContain('{ "console.log" }');
  });

  it("reports the outer .svelte line number, not the inner script line", async () => {
    const src = `<div>line1</div>
<div>line2</div>
<script lang="ts">
console.log("x");
</script>`;
    const r = await transformSvelte(src, "/p/x.svelte", parse, "src/x.svelte", opts);
    expect(r).not.toBeNull();
    expect(r!.code).toMatch(/emit\("log","src\/x\.svelte",4,/);
  });
});
