import type { ResolvedOptions } from "../options.js";
import { SourceEdits, type SourceMapV3 } from "../shared/edits.js";
import { GLOBAL_KEY, type LogLevel } from "../shared/protocol.js";
import { consoleMethod } from "./matchers.js";
import type { ParseFn } from "./js.js";
import { walk, type AstNode } from "./walker.js";

interface SvelteScriptNode {
  content?: { start?: number; end?: number };
}

interface SvelteRoot {
  module?: SvelteScriptNode;
  instance?: SvelteScriptNode;
}

interface SvelteCompiler {
  parse: (source: string, opts?: { modern?: boolean }) => SvelteRoot;
}

let cachedCompiler: SvelteCompiler | null | undefined;

async function loadCompiler(): Promise<SvelteCompiler | null> {
  if (cachedCompiler !== undefined) return cachedCompiler;
  try {
    const mod = (await import("svelte/compiler")) as unknown as SvelteCompiler;
    cachedCompiler = mod;
  } catch {
    cachedCompiler = null;
  }
  return cachedCompiler;
}

/**
 * Transform `.svelte` files by extracting script-block byte ranges and
 * running the JS transform on each range, with offsets adjusted to the parent
 * `.svelte` source. Markup expressions are left alone.
 *
 * No-op (returns null) if `svelte/compiler` is not installed.
 */
export async function transformSvelte(
  code: string,
  id: string,
  parse: ParseFn,
  relPath: string,
  opts: ResolvedOptions,
): Promise<{ code: string; map: SourceMapV3 } | null> {
  if (!code.includes("console")) return null;

  const compiler = await loadCompiler();
  if (!compiler) return null;

  let ast: SvelteRoot;
  try {
    ast = compiler.parse(code, { modern: true });
  } catch {
    return null;
  }

  const scripts: SvelteScriptNode[] = [];
  if (ast.module) scripts.push(ast.module);
  if (ast.instance) scripts.push(ast.instance);
  if (scripts.length === 0) return null;

  const edits = new SourceEdits(code, id);
  let edited = false;

  for (const script of scripts) {
    const content = script.content;
    if (!content || content.start === undefined || content.end === undefined) continue;
    const innerStart = content.start;
    const innerCode = code.slice(content.start, content.end);

    let innerAst: AstNode;
    try {
      innerAst = parse(innerCode);
    } catch {
      continue;
    }

    walk(innerAst, {
      enter(node) {
        const method = consoleMethod(node);
        if (!method) return;
        if (!opts.levels.has(method as LogLevel)) return;
        if (node.start === undefined || node.end === undefined) return;

        const outerStart = node.start + innerStart;
        const outerEnd = node.end + innerStart;
        const args = (node as unknown as { arguments?: AstNode[] }).arguments ?? [];
        const argsSource = renderArgsOuter(code, args, innerStart);
        const line = lineFromOffset(code, outerStart);
        const col = colFromOffset(code, outerStart);
        const file = JSON.stringify(relPath);
        const lvl = JSON.stringify(method);
        const emitCall = `globalThis.${GLOBAL_KEY}?.emit(${lvl},${file},${line},${col},[${argsSource}])`;

        if (opts.logOnServer) {
          edits.appendLeft(outerStart, `(${emitCall},`);
          edits.appendRight(outerEnd, ")");
        } else {
          edits.appendLeft(outerStart, `(${emitCall},(typeof window !== "undefined") && `);
          edits.appendRight(outerEnd, ")");
        }
        edited = true;
      },
    });
  }

  if (!edited) return null;
  return { code: edits.toString(), map: edits.generateMap() };
}

function renderArgsOuter(code: string, args: AstNode[], innerStart: number): string {
  if (args.length === 0) return "";
  const first = args[0]!;
  const last = args[args.length - 1]!;
  if (first.start === undefined || last.end === undefined) return "";
  return code.slice(first.start + innerStart, last.end + innerStart);
}

function lineFromOffset(code: string, offset: number): number {
  let line = 1;
  for (let i = 0; i < offset && i < code.length; i++) {
    if (code.charCodeAt(i) === 10) line++;
  }
  return line;
}

function colFromOffset(code: string, offset: number): number {
  let col = 0;
  for (let i = 0; i < offset && i < code.length; i++) {
    if (code.charCodeAt(i) === 10) col = 0;
    else col++;
  }
  return col;
}
