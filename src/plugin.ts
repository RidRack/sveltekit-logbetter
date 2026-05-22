import { posix, relative, sep } from "node:path";
import type { Plugin, ViteDevServer } from "vite";
import { transformJs } from "./transform/js.js";
import { transformSvelte } from "./transform/svelte.js";
import {
  CHANNEL,
  CONTEXT_KEY,
  GLOBAL_KEY,
  type LogEntry,
  type LogLevel,
} from "./shared/protocol.js";
import { safeStringify } from "./shared/serialize.js";
import { nextId, pushEnd, pushEntry, pushStart, snapshotDrain } from "./server/state.js";
import { requestStorage } from "./server/request-context.js";
import { resolveOptions, type LogbetterOptions } from "./options.js";
import { buildReceiverSource } from "./client/source.js";

const PLUGIN_NAME = "sveltekit-logbetter";
const VIRTUAL_CLIENT = "virtual:sveltekit-logbetter/client";
const RESOLVED_VIRTUAL_CLIENT = "\0" + VIRTUAL_CLIENT;

/**
 * Vite plugin that forwards SvelteKit server `console.X` calls to the
 * browser's DevTools console during `vite dev`.
 *
 * Dev-only by construction:
 *   - `apply: "serve"` means this plugin is never loaded during `vite build`.
 *   - No transformed `console.X` ever reaches the production bundle.
 *   - The runtime emit code is gated on `globalThis.__logbetter__?.emit` —
 *     undefined in production → optional-chain short-circuits to a no-op
 *     even if a stale dev build artefact somehow ran.
 *   - The companion `logbetterHook()` is also a no-op outside dev.
 */
export function sveltekitLogbetter(options: LogbetterOptions = {}): Plugin {
  const opts = resolveOptions(options);
  let projectRoot = process.cwd();

  return {
    name: PLUGIN_NAME,
    apply: "serve",
    enforce: "pre",

    configResolved(config) {
      projectRoot = config.root || process.cwd();
    },

    resolveId(id) {
      if (id === VIRTUAL_CLIENT) return RESOLVED_VIRTUAL_CLIENT;
      return null;
    },

    load(id) {
      if (id !== RESOLVED_VIRTUAL_CLIENT) return null;
      return buildReceiverSource(opts);
    },

    configureServer(s) {
      installRuntime(s, opts);

      const hot = (s as ViteDevServer & { hot?: { on: (c: string, cb: () => void) => void } }).hot;
      hot?.on(CHANNEL.drainRequest, () => {
        const snapshot = snapshotDrain(s);
        const hotSend = (s as ViteDevServer & { hot?: { send: (c: string, p: unknown) => void } }).hot;
        hotSend?.send(CHANNEL.drainResponse, snapshot);
      });
    },

    async transform(code, id) {
      if (!opts.enabled) return null;

      const cleanId = id.split("?")[0]!;

      // Inject the receiver import into SvelteKit's client entry. We try the
      // two known internal paths and fall back to anything matching.
      if (
        /\.svelte-kit\/generated\/(?:client\/app\.js|root\.js|root\.svelte)$/.test(cleanId)
      ) {
        return {
          code: `import ${JSON.stringify(VIRTUAL_CLIENT)};\n${code}`,
          map: null,
        };
      }

      if (!code.includes("console")) return null;

      const rel = toPosix(relative(projectRoot, cleanId));
      if (rel.startsWith("..")) return null;
      if (matchesAny(rel, opts.exclude)) return null;
      if (opts.include.length > 0 && !matchesAny(rel, opts.include)) return null;

      const ext = cleanId.split(".").pop();
      const parseFn = (src: string): never => {
        const ctx = this as unknown as { parse: (s: string) => unknown };
        return ctx.parse(src) as never;
      };

      if (ext === "svelte") {
        const result = await transformSvelte(code, cleanId, parseFn, rel, opts);
        if (!result) return null;
        return { code: result.code, map: result.map as unknown as null };
      }

      if (ext !== "ts" && ext !== "js" && ext !== "mts" && ext !== "mjs") return null;

      const result = transformJs(code, cleanId, parseFn, rel, opts);
      if (!result) return null;
      return { code: result.code, map: result.map as unknown as null };
    },
  };

  function installRuntime(s: ViteDevServer, _opts: typeof opts): void {
    const g = globalThis as Record<string, unknown>;
    g[GLOBAL_KEY] = {
      emit(
        level: LogLevel,
        file: string,
        line: number,
        column: number,
        args: unknown[],
      ): void {
        const ctx = requestStorage.getStore();
        let serialized: string;
        try {
          serialized = safeStringify(args, {
            maxDepth: opts.maxDepth,
            maxChildren: opts.maxChildren,
            maxBytes: opts.maxArgBytes,
          });
        } catch (err) {
          serialized = JSON.stringify([
            ["T", `encode-failed:${(err as Error).message}`],
          ]);
        }
        const entry: LogEntry = {
          id: nextId(s),
          t: level,
          f: file,
          l: line,
          c: column,
          a: serialized,
        };
        if (ctx) entry.r = ctx.id;
        pushEntry(s, entry);
      },
      pushStart(start: { r: string; method: string; url: string; ts: number }): void {
        pushStart(s, { id: nextId(s), ...start });
      },
      pushEnd(end: { r: string; status: number; durationMs: number; errored: boolean }): void {
        pushEnd(s, { id: nextId(s), ...end });
      },
    };
    g[CONTEXT_KEY] = () => requestStorage.getStore();
  }
}

function toPosix(p: string): string {
  return p.split(sep).join(posix.sep);
}

function matchesAny(rel: string, patterns: string[]): boolean {
  for (const pat of patterns) {
    if (matchGlob(pat, rel)) return true;
  }
  return false;
}

/**
 * Minimal glob matcher supporting `*`, `**`, `?`, and brace alternation
 * `{a,b}`. Anchored — pattern must match the full string.
 */
function matchGlob(pattern: string, input: string): boolean {
  const re = globToRegExp(pattern);
  return re.test(input);
}

function globToRegExp(pattern: string): RegExp {
  let re = "^";
  let i = 0;
  while (i < pattern.length) {
    const c = pattern[i]!;
    if (c === "*") {
      if (pattern[i + 1] === "*") {
        re += ".*";
        i += 2;
        if (pattern[i] === "/") i++;
      } else {
        re += "[^/]*";
        i++;
      }
    } else if (c === "?") {
      re += "[^/]";
      i++;
    } else if (c === "{") {
      const end = pattern.indexOf("}", i);
      if (end === -1) {
        re += "\\{";
        i++;
        continue;
      }
      const parts = pattern.slice(i + 1, end).split(",");
      re += "(?:" + parts.map(escapeRegExp).join("|") + ")";
      i = end + 1;
    } else if (/[.+^$()|\\[\]]/.test(c)) {
      re += "\\" + c;
      i++;
    } else {
      re += c;
      i++;
    }
  }
  re += "$";
  return new RegExp(re);
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
