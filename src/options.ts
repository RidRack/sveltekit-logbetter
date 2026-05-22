import type { LogLevel } from "./shared/protocol.js";

export type EditorScheme =
  | "vscode"
  | "vscode-insiders"
  | "cursor"
  | "webstorm"
  | "idea"
  | "sublime"
  | "none";

export type EditorResolver = (file: string, line: number, column: number) => string;

export interface LevelStyle {
  fg: string;
  bg: string;
}

export interface Palette {
  log: LevelStyle;
  info: LevelStyle;
  warn: LevelStyle;
  error: LevelStyle;
  debug: LevelStyle;
  trace: LevelStyle;
  table: LevelStyle;
  group: LevelStyle;
  origin: { fg: string };
  method: { fg: string };
  url: { fg: string };
  timingFast: { fg: string };
  timingMid: { fg: string };
  timingSlow: { fg: string };
  truncated: { fg: string };
  summary: { fg: string };
}

export const defaultPalette: Palette = {
  log: { fg: "#FFFFFF", bg: "#4F86F7" },
  info: { fg: "#FFFFFF", bg: "#06B6D4" },
  debug: { fg: "#FFFFFF", bg: "#8B96A8" },
  trace: { fg: "#E5E7EB", bg: "#4B5563" },
  warn: { fg: "#1F2937", bg: "#E8A33D" },
  error: { fg: "#FFFFFF", bg: "#E5484D" },
  table: { fg: "#FFFFFF", bg: "#10B981" },
  group: { fg: "#9B7FE8", bg: "transparent" },
  origin: { fg: "#B8C0D0" },
  method: { fg: "#9B7FE8" },
  url: { fg: "#E5E7EB" },
  timingFast: { fg: "#86A789" },
  timingMid: { fg: "#E8A33D" },
  timingSlow: { fg: "#E5484D" },
  truncated: { fg: "#E5484D" },
  summary: { fg: "#8B96A8" },
};

export interface LogbetterOptions {
  /**
   * Master enable switch. Defaults to `true`. The plugin is *also* gated by
   * `apply: "serve"` (it never loads in `vite build`); set this to `false` if
   * you want to disable forwarding during dev while keeping the plugin in
   * your config.
   */
  enabled?: boolean;
  /**
   * Whether to also print logs in the server terminal. Default: `true`.
   * Set `false` to suppress server stdout (browser-only).
   */
  logOnServer?: boolean;
  /**
   * Which `console.X` levels to forward. Default: all.
   */
  levels?: LogLevel[];
  /**
   * Glob patterns to include (resolved against the file id). Default: all
   * project source. If set, replaces the default include list.
   */
  include?: string | string[];
  /**
   * Glob patterns to exclude. Merged with the built-in defaults
   * (`node_modules`, `.svelte-kit`, `dist`, `build`).
   */
  exclude?: string | string[];
  /**
   * Editor URL scheme used for clickable origin links.
   * Default: `"vscode"`. Pass a function for full control.
   */
  editor?: EditorScheme | EditorResolver;
  /**
   * Whether to group browser-side logs by HTTP request. Default: `true`.
   * Requires `logbetterHook()` to be installed in `hooks.server.ts`.
   */
  groupByRequest?: boolean;
  /**
   * Expand the request group automatically if it contains any
   * `error`/`assert` entry (or the request itself threw). Default: `true`.
   * Set `false` to always collapse — entries are still visible after one
   * click. Implementation note: groups are buffered until the request
   * finishes so the expand decision can be made after the fact; on a long
   * request, individual logs appear when the response ends, not live.
   */
  expandGroupsOnError?: boolean;
  /**
   * Try to parse string args that look like JSON and render them as objects.
   * Default: `true`.
   */
  prettyJsonStrings?: boolean;
  /**
   * Per-arg byte cap. Default: 100 KB. Larger args get a truncated marker.
   */
  maxArgBytes?: number;
  /**
   * Maximum nesting depth for serializer. Default: 12.
   */
  maxDepth?: number;
  /**
   * Maximum children per container. Default: 1000.
   */
  maxChildren?: number;
  /**
   * Hook to transform or drop log entries server-side before transport.
   * Return `null` to drop. Runs after serialization metadata is computed,
   * before the value is sent over the wire.
   */
  redact?: (entry: { level: LogLevel; file: string; line: number; column: number }) => boolean;
  /**
   * Override any subset of the colour palette.
   */
  colors?: Partial<Palette>;
}

export interface ResolvedOptions {
  enabled: boolean;
  logOnServer: boolean;
  levels: Set<LogLevel>;
  include: string[];
  exclude: string[];
  editor: EditorResolver;
  groupByRequest: boolean;
  expandGroupsOnError: boolean;
  prettyJsonStrings: boolean;
  maxArgBytes: number;
  maxDepth: number;
  maxChildren: number;
  redact?: LogbetterOptions["redact"];
  palette: Palette;
}

const ALL_LEVELS: LogLevel[] = [
  "log",
  "info",
  "warn",
  "error",
  "debug",
  "trace",
  "table",
  "group",
  "groupCollapsed",
  "groupEnd",
  "dir",
  "count",
  "assert",
  "clear",
];

const DEFAULT_EXCLUDE = [
  "**/node_modules/**",
  "**/.svelte-kit/**",
  "**/dist/**",
  "**/build/**",
];

export function resolveOptions(opts: LogbetterOptions = {}): ResolvedOptions {
  const editor = resolveEditor(opts.editor ?? "vscode");
  const exclude = mergeArray(DEFAULT_EXCLUDE, opts.exclude);
  const include = toArray(opts.include) ?? ["**/*.{js,ts,mjs,mts,svelte}"];
  const palette: Palette = deepMergePalette(defaultPalette, opts.colors);

  return {
    enabled: opts.enabled ?? true,
    logOnServer: opts.logOnServer ?? true,
    levels: new Set(opts.levels ?? ALL_LEVELS),
    include,
    exclude,
    editor,
    groupByRequest: opts.groupByRequest ?? true,
    expandGroupsOnError: opts.expandGroupsOnError ?? true,
    prettyJsonStrings: opts.prettyJsonStrings ?? true,
    maxArgBytes: opts.maxArgBytes ?? 100_000,
    maxDepth: opts.maxDepth ?? 12,
    maxChildren: opts.maxChildren ?? 1000,
    redact: opts.redact,
    palette,
  };
}

function toArray(v: string | string[] | undefined): string[] | undefined {
  if (v === undefined) return undefined;
  return Array.isArray(v) ? v : [v];
}

function mergeArray(base: string[], extra: string | string[] | undefined): string[] {
  if (!extra) return base.slice();
  const e = Array.isArray(extra) ? extra : [extra];
  return [...base, ...e];
}

function resolveEditor(scheme: EditorScheme | EditorResolver): EditorResolver {
  if (typeof scheme === "function") return scheme;
  switch (scheme) {
    case "none":
      return () => "";
    case "vscode":
      return (file, line, col) => `vscode://file/${file}:${line}:${col}`;
    case "vscode-insiders":
      return (file, line, col) => `vscode-insiders://file/${file}:${line}:${col}`;
    case "cursor":
      return (file, line, col) => `cursor://file/${file}:${line}:${col}`;
    case "webstorm":
      return (file, line, col) =>
        `webstorm://open?file=${encodeURIComponent(file)}&line=${line}&column=${col}`;
    case "idea":
      return (file, line, col) =>
        `idea://open?file=${encodeURIComponent(file)}&line=${line}&column=${col}`;
    case "sublime":
      return (file, line, col) =>
        `subl://open?url=file://${encodeURIComponent(file)}&line=${line}&column=${col}`;
    default:
      return (file, line, col) => `vscode://file/${file}:${line}:${col}`;
  }
}

function deepMergePalette(base: Palette, override?: Partial<Palette>): Palette {
  if (!override) return base;
  const out = { ...base } as Palette;
  for (const k of Object.keys(override) as (keyof Palette)[]) {
    const ov = override[k];
    if (ov) {
      (out as Record<keyof Palette, unknown>)[k] = { ...base[k], ...ov };
    }
  }
  return out;
}
