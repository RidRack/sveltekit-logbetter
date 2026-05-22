import type { ResolvedOptions } from "../options.js";
import { CHANNEL } from "../shared/protocol.js";

/**
 * Builds the JS source that gets returned for the virtual client module.
 * Everything in here runs in the browser; it must be self-contained (no
 * package-relative imports), since virtual modules can't resolve relative
 * paths reliably.
 */
export function buildReceiverSource(opts: ResolvedOptions): string {
  const palette = JSON.stringify(opts.palette);
  const groupByRequest = opts.groupByRequest;
  const prettyJsonStrings = opts.prettyJsonStrings;
  const editorScheme = opts.editor.toString();

  return `
const PALETTE = ${palette};
const GROUP_BY_REQUEST = ${JSON.stringify(groupByRequest)};
const EXPAND_ON_ERROR = ${JSON.stringify(opts.expandGroupsOnError)};
const PRETTY_JSON_STRINGS = ${JSON.stringify(prettyJsonStrings)};
const EDITOR = ${JSON.stringify(editorScheme)};
const CHANNEL = ${JSON.stringify(CHANNEL)};

${safeParseInline()}

${editorUrlInline()}

${stylesInline()}

${rendererInline()}

if (import.meta.hot) {
  // Per-request buffers — we hold every log inside a request until its end
  // event arrives so we can choose group() vs groupCollapsed() based on
  // whether any error landed in the request. Once a group is opened
  // (collapsed or expanded) the browser console gives us no way to change
  // its state, so the decision must be made up front.
  const buffers = new Map();
  const seenEntries = new Set();
  const seenStarts = new Set();
  const seenEnds = new Set();
  let unattributedOpen = false;

  function ensureUnattributed() {
    if (!GROUP_BY_REQUEST) return;
    if (unattributedOpen) return;
    console.groupCollapsed("%c▸ unattributed", styleGroup());
    unattributedOpen = true;
  }

  function bufferEntry(entry) {
    const buf = buffers.get(entry.r);
    if (!buf) return false;
    buf.entries.push(entry);
    if (entry.t === "error" || entry.t === "assert") buf.hasError = true;
    if (entry.t === "warn") buf.hasWarn = true;
    return true;
  }

  function flushBuffer(end) {
    const buf = buffers.get(end.r);
    if (!buf) return;
    buffers.delete(end.r);

    if (!GROUP_BY_REQUEST) {
      for (const e of buf.entries) printEntry(e);
      return;
    }

    const expand = EXPAND_ON_ERROR && (buf.hasError || end.errored);
    const groupFn = expand ? console.group : console.groupCollapsed;
    const timing = end.durationMs;
    const timingStyle = timing < 100 ? styleTimingFast()
      : timing < 500 ? styleTimingMid()
      : styleTimingSlow();
    const header = [
      "%c▸ %c" + buf.method + " %c" + buf.url
        + " %c" + Math.round(timing) + "ms"
        + " %c req#" + shortId(end.r)
        + (expand ? " %c⚠" : ""),
      styleGroup(),
      styleMethod(),
      styleUrl(),
      timingStyle,
      styleDim(),
    ];
    if (expand) header.push(styleErrorMarker());

    groupFn.apply(console, header);

    let warns = 0;
    let errors = 0;
    for (const e of buf.entries) {
      printEntry(e);
      if (e.t === "warn") warns++;
      if (e.t === "error" || e.t === "assert") errors++;
    }

    const summary = buf.entries.length + " log" + (buf.entries.length === 1 ? "" : "s")
      + (warns ? " · " + warns + " warn" : "")
      + (errors ? " · " + errors + " error" : "")
      + " · " + end.status + " · " + Math.round(timing) + "ms"
      + (end.errored ? " · threw" : "");
    console.log("%c" + summary, styleSummary());
    console.groupEnd();
  }

  function handleBatch(payload) {
    if (!payload || typeof payload !== "object") return;
    const starts = payload.starts || [];
    const entries = payload.entries || [];
    const ends = payload.ends || [];

    for (const s of starts) {
      if (s.id != null) {
        if (seenStarts.has(s.id)) continue;
        seenStarts.add(s.id);
      }
      if (!s.r) continue;
      if (buffers.has(s.r)) continue;
      buffers.set(s.r, {
        method: s.method,
        url: s.url,
        startTs: s.ts,
        entries: [],
        hasError: false,
        hasWarn: false,
      });
    }

    for (const e of entries) {
      if (e.id != null) {
        if (seenEntries.has(e.id)) continue;
        seenEntries.add(e.id);
      }
      if (!bufferEntry(e)) {
        // No active buffer — print into the unattributed group.
        ensureUnattributed();
        printEntry(e);
      }
    }

    for (const end of ends) {
      if (end.id != null) {
        if (seenEnds.has(end.id)) continue;
        seenEnds.add(end.id);
      }
      flushBuffer(end);
    }
  }

  function printEntry(entry) {
    const level = entry.t;
    const file = entry.f;
    const line = entry.l;
    const col = entry.c;
    const raw = entry.a;
    let args = [];
    try {
      args = safeParse(raw) || [];
    } catch (e) {
      args = ["[logbetter: failed to decode args: " + (e && e.message || e) + "]"];
    }
    if (PRETTY_JSON_STRINGS) args = args.map(maybeJsonify);

    if (level === "clear") {
      console.log("%c↻ %c" + file + ":" + line, styleClear(), styleOrigin());
      console.clear();
      return;
    }
    if (level === "groupEnd") {
      console.groupEnd();
      return;
    }
    if (level === "group" || level === "groupCollapsed") {
      const fn = level === "group" ? console.group : console.groupCollapsed;
      fn.apply(console, [
        "%c" + badge(level) + "%c " + file + ":" + line,
        styleBadge(level),
        styleOrigin(),
        ...args,
      ]);
      return;
    }
    if (level === "table") {
      console.log("%c" + badge("table") + "%c " + file + ":" + line, styleBadge("table"), styleOrigin());
      const target = args[0];
      console.table(target);
      return;
    }
    if (level === "trace") {
      console.trace.apply(console, [
        "%c" + badge("trace") + "%c " + file + ":" + line,
        styleBadge("trace"),
        styleOrigin(),
        ...args,
      ]);
      return;
    }
    if (level === "dir") {
      console.log("%c" + badge("debug") + "%c " + file + ":" + line, styleBadge("debug"), styleOrigin());
      console.dir(args[0]);
      return;
    }

    const fn = console[level] || console.log;
    if (args.length === 0) {
      fn.call(console,
        "%c" + badge(level) + "%c " + file + ":" + line + " %c(no arguments)",
        styleBadge(level), styleOrigin(), styleDim());
    } else {
      fn.apply(console, [
        "%c" + badge(level) + "%c " + file + ":" + line,
        styleBadge(level),
        styleOrigin(),
        ...args,
      ]);
    }
  }

  function maybeJsonify(v) {
    if (typeof v !== "string") return v;
    if (v.length > 1_000_000) return v;
    const t = v.trim();
    if (!(t.startsWith("{") || t.startsWith("["))) return v;
    try {
      const parsed = JSON.parse(t);
      if (parsed && typeof parsed === "object") {
        try {
          Object.defineProperty(parsed, "__raw", { value: v, enumerable: false });
        } catch (_) { /* ignore */ }
        return parsed;
      }
      return v;
    } catch (_) {
      return v;
    }
  }

  function shortId(r) {
    return r ? r.slice(-4) : "?";
  }

  function requestDrain() {
    import.meta.hot.send(CHANNEL.drainRequest);
  }

  import.meta.hot.on(CHANNEL.drainResponse, handleBatch);
  import.meta.hot.on(CHANNEL.batch, handleBatch);
  requestDrain();
}
`;
}

function safeParseInline(): string {
  return `
function safeParse(s) {
  let nodes;
  try { nodes = JSON.parse(s); } catch (_) { return undefined; }
  if (!Array.isArray(nodes)) return undefined;
  const cache = new Map();

  function revive(id) {
    if (cache.has(id)) return cache.get(id);
    const node = nodes[id];
    if (node === null || typeof node !== "object" || !Array.isArray(node)) {
      cache.set(id, node); return node;
    }
    const tag = node[0];
    switch (tag) {
      case "u": cache.set(id, undefined); return undefined;
      case "n": cache.set(id, NaN); return NaN;
      case "i": cache.set(id, Infinity); return Infinity;
      case "I": cache.set(id, -Infinity); return -Infinity;
      case "b": { const v = BigInt(node[1]); cache.set(id, v); return v; }
      case "S": { const v = "Symbol(" + node[1] + ")"; cache.set(id, v); return v; }
      case "f": { const v = "[Function: " + node[1] + "]"; cache.set(id, v); return v; }
      case "P": { cache.set(id, "[Promise]"); return "[Promise]"; }
      case "_": { cache.set(id, undefined); return undefined; }
      case "T": { const v = "[truncated: " + node[1] + "]"; cache.set(id, v); return v; }
      case "d": { const v = new Date(node[1]); cache.set(id, v); return v; }
      case "r": { const v = new RegExp(node[1], node[2]); cache.set(id, v); return v; }
      case "U": { try { const v = new URL(node[1]); cache.set(id, v); return v; } catch (_) { cache.set(id, node[1]); return node[1]; } }
      case "B": { const v = node[1] + "(" + node[2] + ") " + (node[3] || ""); cache.set(id, v); return v; }
      case "e": {
        const err = new Error(node[2]);
        err.name = node[1] || "Error";
        if (node[3]) err.stack = node[3];
        cache.set(id, err);
        if (node[4] !== undefined && node[4] !== null) err.cause = revive(node[4]);
        return err;
      }
      case "a": {
        const arr = [];
        cache.set(id, arr);
        for (const cid of node[1]) arr.push(revive(cid));
        return arr;
      }
      case "o": {
        const obj = {};
        cache.set(id, obj);
        for (const pair of node[1]) obj[pair[0]] = revive(pair[1]);
        const cn = node[2];
        if (cn) {
          try { Object.defineProperty(obj, Symbol.toStringTag, { value: cn, enumerable: false }); } catch (_) {}
        }
        return obj;
      }
      case "m": {
        const map = new Map();
        cache.set(id, map);
        for (const pair of node[1]) map.set(revive(pair[0]), revive(pair[1]));
        return map;
      }
      case "s": {
        const set = new Set();
        cache.set(id, set);
        for (const cid of node[1]) set.add(revive(cid));
        return set;
      }
      default: cache.set(id, node); return node;
    }
  }
  return revive(0);
}
`;
}

function editorUrlInline(): string {
  return `
function editorUrl(file, line, col) {
  switch (EDITOR) {
    case "none": return "";
    case "vscode": return "vscode://file/" + file + ":" + line + ":" + col;
    case "vscode-insiders": return "vscode-insiders://file/" + file + ":" + line + ":" + col;
    case "cursor": return "cursor://file/" + file + ":" + line + ":" + col;
    case "webstorm": return "webstorm://open?file=" + encodeURIComponent(file) + "&line=" + line + "&column=" + col;
    case "idea": return "idea://open?file=" + encodeURIComponent(file) + "&line=" + line + "&column=" + col;
    case "sublime": return "subl://open?url=file://" + encodeURIComponent(file) + "&line=" + line + "&column=" + col;
    default: return "vscode://file/" + file + ":" + line + ":" + col;
  }
}
`;
}

function stylesInline(): string {
  return `
const BADGE_BASE = "padding:1px 7px;border-radius:4px;font:600 11px/1.4 ui-monospace,SFMono-Regular,Menlo,monospace;letter-spacing:0.4px;text-transform:uppercase;box-shadow:inset 0 0 0 1px rgba(255,255,255,0.08);";

function badge(level) {
  switch (level) {
    case "log": return " LOG ";
    case "info": return " INFO ";
    case "warn": return " WARN ";
    case "error": return " ERR ";
    case "debug": return " DBG ";
    case "trace": return " TRC ";
    case "table": return " TBL ";
    case "group": case "groupCollapsed": return " ▸ ";
    case "assert": return " ASRT ";
    default: return " " + level.toUpperCase() + " ";
  }
}

function styleBadge(level) {
  const p = PALETTE[level] || PALETTE.log;
  return BADGE_BASE + "color:" + p.fg + ";background:" + p.bg + ";";
}
function styleOrigin() {
  return "color:" + PALETTE.origin.fg + ";font-style:italic;font-size:11px;";
}
function styleGroup() { return "color:" + PALETTE.group.fg + ";font-weight:600;"; }
function styleGroupHeader() { return "color:" + PALETTE.method.fg + ";font-weight:600;"; }
function styleMethod() { return "color:" + PALETTE.method.fg + ";font-weight:600;"; }
function styleUrl() { return "color:" + PALETTE.url.fg + ";"; }
function styleDim() { return "color:" + PALETTE.summary.fg + ";font-style:italic;"; }
function styleSummary() { return "color:" + PALETTE.summary.fg + ";font-style:italic;font-size:11px;"; }
function styleClear() { return "color:#FF6A3D;font-weight:600;"; }
function styleTimingFast() { return "color:" + PALETTE.timingFast.fg + ";font-weight:600;"; }
function styleTimingMid() { return "color:" + PALETTE.timingMid.fg + ";font-weight:600;"; }
function styleTimingSlow() { return "color:" + PALETTE.timingSlow.fg + ";font-weight:600;"; }
function styleErrorMarker() { return "color:" + PALETTE.error.bg + ";font-weight:700;"; }
`;
}

function rendererInline(): string {
  return `/* renderer helpers (placeholders if needed in future) */`;
}
