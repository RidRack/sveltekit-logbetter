import { SourceEdits, type SourceMapV3 } from "../shared/edits.js";
import { GLOBAL_KEY, type LogLevel } from "../shared/protocol.js";
import type { ResolvedOptions } from "../options.js";
import { consoleMethod } from "./matchers.js";
import { walk, type AstNode } from "./walker.js";

export interface TransformResult {
  code: string;
  map: SourceMapV3;
}

export interface ParseFn {
  (code: string): AstNode;
}

/**
 * Rewrite `console.X(args)` to:
 *
 *   (globalThis.__logbetter__?.emit("X","<file>",<line>,<col>,[args]),
 *    console.X(args))
 *
 * The comma-expression preserves the original return value. When the runtime
 * isn't installed (production), the optional chain short-circuits and the
 * call falls through to native `console`.
 *
 * `logOnServer:false` rewrites to a guarded form that only emits and does NOT
 * call the original `console.X` on the server (the browser still prints).
 */
export function transformJs(
  code: string,
  id: string,
  parse: ParseFn,
  relPath: string,
  opts: ResolvedOptions,
): TransformResult | null {
  if (!code.includes("console")) return null;

  let ast: AstNode;
  try {
    ast = parse(code);
  } catch {
    return null;
  }

  const edits = new SourceEdits(code, id);
  let edited = false;

  walk(ast, {
    enter(node) {
      const method = consoleMethod(node);
      if (!method) return;
      if (!opts.levels.has(method as LogLevel)) return;
      if (opts.redact && !shouldKeepByRedact(method, relPath, node, opts)) return;

      const start = node.start;
      const end = node.end;
      const loc = node.loc;
      if (start === undefined || end === undefined || !loc) return;

      const args = (node as unknown as { arguments?: AstNode[] }).arguments ?? [];
      const argsSource = renderArgs(code, args);
      const line = loc.start.line;
      const col = loc.start.column;
      const file = JSON.stringify(relPath);
      const lvl = JSON.stringify(method);

      const emitCall =
        `globalThis.${GLOBAL_KEY}?.emit(${lvl},${file},${line},${col},[${argsSource}])`;

      if (opts.logOnServer) {
        // Wrap the original call so it still executes server-side.
        edits.appendLeft(start, `(${emitCall},`);
        edits.appendRight(end, ")");
      } else {
        // Replace server execution with the emit call only — but the original
        // expression text is left untouched in source order, just unreachable
        // (false-guarded) so source maps stay aligned.
        edits.appendLeft(start, `(${emitCall},(typeof window !== "undefined") && `);
        edits.appendRight(end, ")");
      }
      edited = true;
    },
  });

  if (!edited) return null;
  return {
    code: edits.toString(),
    map: edits.generateMap(),
  };
}

function renderArgs(code: string, args: AstNode[]): string {
  if (args.length === 0) return "";
  const first = args[0]!;
  const last = args[args.length - 1]!;
  if (first.start === undefined || last.end === undefined) return "";
  return code.slice(first.start, last.end);
}

function shouldKeepByRedact(
  method: string,
  file: string,
  node: AstNode,
  opts: ResolvedOptions,
): boolean {
  if (!opts.redact || !node.loc) return true;
  return opts.redact({
    level: method as LogLevel,
    file,
    line: node.loc.start.line,
    column: node.loc.start.column,
  });
}
