/**
 * Zero-dependency safe serializer / deserializer for log payloads.
 *
 * Wire format: a flat JSON array of nodes. Index 0 is the root. Each value in
 * the graph is referred to by its node index. Cycles are handled by id reuse,
 * not by a dedicated ref tag.
 *
 * Tagged tuples (first element identifies the kind):
 *   ["u"]                          undefined
 *   ["n"]                          NaN
 *   ["i"] / ["I"]                  +Infinity / -Infinity
 *   ["b", "<bigint>"]              BigInt
 *   ["S", "desc"]                  Symbol description (revives to placeholder string)
 *   ["f", "name"]                  Function (revives to placeholder string)
 *   ["P"]                          Promise (revives to placeholder string)
 *   ["d", iso]                     Date
 *   ["r", source, flags]           RegExp
 *   ["U", href]                    URL
 *   ["B", ctorName, byteLength, hex64]   Typed array preview
 *   ["e", name, message, stack?, causeId?]
 *   ["a", [...ids]]                Array (ids reference other nodes)
 *   ["o", [[key, id], ...], className?]   Plain or class object
 *   ["m", [[kid, vid], ...]]       Map
 *   ["s", [...ids]]                Set
 *   ["T", "reason"]                Truncated (depth / breadth / size)
 *   ["_"]                          Sparse array hole
 *
 * Primitives (string, number, boolean, null) are stored inline as themselves.
 */

export interface SerializeOptions {
  maxDepth?: number;
  maxChildren?: number;
  maxBytes?: number;
}

const DEFAULTS = {
  maxDepth: 12,
  maxChildren: 1000,
  maxBytes: 100_000,
} as const;

export function safeStringify(root: unknown, opts: SerializeOptions = {}): string {
  const maxDepth = opts.maxDepth ?? DEFAULTS.maxDepth;
  const maxChildren = opts.maxChildren ?? DEFAULTS.maxChildren;
  const maxBytes = opts.maxBytes ?? DEFAULTS.maxBytes;

  const nodes: unknown[] = [];
  const refs = new Map<object, number>();

  function intern(value: unknown, depth: number): number {
    if (value === null) {
      nodes.push(null);
      return nodes.length - 1;
    }
    const t = typeof value;
    if (t === "string" || t === "boolean") {
      nodes.push(value);
      return nodes.length - 1;
    }
    if (t === "number") {
      if (Number.isNaN(value)) {
        nodes.push(["n"]);
      } else if (value === Infinity) {
        nodes.push(["i"]);
      } else if (value === -Infinity) {
        nodes.push(["I"]);
      } else {
        nodes.push(value);
      }
      return nodes.length - 1;
    }
    if (t === "undefined") {
      nodes.push(["u"]);
      return nodes.length - 1;
    }
    if (t === "bigint") {
      nodes.push(["b", String(value)]);
      return nodes.length - 1;
    }
    if (t === "symbol") {
      nodes.push(["S", (value as symbol).description ?? ""]);
      return nodes.length - 1;
    }
    if (t === "function") {
      nodes.push(["f", (value as { name?: string }).name || "anonymous"]);
      return nodes.length - 1;
    }

    const obj = value as object;
    const existing = refs.get(obj);
    if (existing !== undefined) return existing;

    if (depth > maxDepth) {
      nodes.push(["T", "depth"]);
      return nodes.length - 1;
    }

    const id = nodes.length;
    nodes.push(null);
    refs.set(obj, id);

    if (obj instanceof Date) {
      nodes[id] = ["d", obj.toISOString()];
      return id;
    }
    if (obj instanceof RegExp) {
      nodes[id] = ["r", obj.source, obj.flags];
      return id;
    }
    if (obj instanceof URL) {
      nodes[id] = ["U", obj.href];
      return id;
    }
    if (obj instanceof Error) {
      const e = obj as Error & { cause?: unknown };
      const node: unknown[] = ["e", e.name, e.message];
      if (e.stack) node.push(e.stack);
      else node.push(null);
      if (e.cause !== undefined) node.push(intern(e.cause, depth + 1));
      nodes[id] = node;
      return id;
    }
    if (obj instanceof Map) {
      const entries: [number, number][] = [];
      let i = 0;
      for (const [k, v] of obj) {
        if (i >= maxChildren) {
          entries.push([intern("…", depth + 1), intern(["T", "breadth"], depth + 1)]);
          break;
        }
        entries.push([intern(k, depth + 1), intern(v, depth + 1)]);
        i++;
      }
      nodes[id] = ["m", entries];
      return id;
    }
    if (obj instanceof Set) {
      const items: number[] = [];
      let i = 0;
      for (const v of obj) {
        if (i >= maxChildren) {
          items.push(intern(["T", "breadth"], depth + 1));
          break;
        }
        items.push(intern(v, depth + 1));
        i++;
      }
      nodes[id] = ["s", items];
      return id;
    }
    if (Array.isArray(obj)) {
      const items: number[] = [];
      const len = Math.min(obj.length, maxChildren);
      for (let i = 0; i < len; i++) {
        if (i in obj) items.push(intern(obj[i], depth + 1));
        else items.push(intern(["_"], depth + 1));
      }
      if (obj.length > maxChildren) {
        items.push(intern(["T", "breadth"], depth + 1));
      }
      nodes[id] = ["a", items];
      return id;
    }
    if (ArrayBuffer.isView(obj) && !(obj instanceof DataView)) {
      const view = obj as Uint8Array;
      const ctor = obj.constructor.name;
      const previewLen = Math.min(64, view.byteLength);
      const buf = new Uint8Array(
        view.buffer,
        view.byteOffset,
        previewLen,
      );
      let hex = "";
      for (let i = 0; i < buf.length; i++) {
        hex += (buf[i] ?? 0).toString(16).padStart(2, "0");
      }
      nodes[id] = ["B", ctor, view.byteLength, hex];
      return id;
    }
    if (typeof (obj as { then?: unknown }).then === "function") {
      nodes[id] = ["P"];
      return id;
    }

    const ctorName = obj.constructor?.name;
    const className = ctorName && ctorName !== "Object" ? ctorName : undefined;
    const entries: [string, number][] = [];
    const keys = Object.keys(obj);
    const len = Math.min(keys.length, maxChildren);
    for (let i = 0; i < len; i++) {
      const key = keys[i]!;
      entries.push([key, intern((obj as Record<string, unknown>)[key], depth + 1)]);
    }
    if (keys.length > maxChildren) {
      entries.push(["…", intern(["T", "breadth"], depth + 1)]);
    }
    nodes[id] = className ? ["o", entries, className] : ["o", entries];
    return id;
  }

  try {
    intern(root, 0);
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    return JSON.stringify([["T", `encode-failed: ${reason}`]]);
  }

  const json = JSON.stringify(nodes);
  if (json.length > maxBytes) {
    return JSON.stringify([["T", `size:${json.length}`]]);
  }
  return json;
}

export function safeParse<T = unknown>(s: string): T {
  let nodes: unknown[];
  try {
    nodes = JSON.parse(s) as unknown[];
  } catch {
    return undefined as T;
  }
  const cache = new Map<number, unknown>();

  function revive(id: number): unknown {
    if (cache.has(id)) return cache.get(id);
    const node = nodes[id];
    if (node === null || typeof node !== "object" || !Array.isArray(node)) {
      cache.set(id, node);
      return node;
    }
    const tag = node[0];
    switch (tag) {
      case "u":
        cache.set(id, undefined);
        return undefined;
      case "n":
        cache.set(id, NaN);
        return NaN;
      case "i":
        cache.set(id, Infinity);
        return Infinity;
      case "I":
        cache.set(id, -Infinity);
        return -Infinity;
      case "b": {
        const v = BigInt(node[1] as string);
        cache.set(id, v);
        return v;
      }
      case "S": {
        const v = `Symbol(${node[1] as string})`;
        cache.set(id, v);
        return v;
      }
      case "f": {
        const v = `[Function: ${node[1] as string}]`;
        cache.set(id, v);
        return v;
      }
      case "P":
        cache.set(id, "[Promise]");
        return "[Promise]";
      case "_":
        cache.set(id, undefined);
        return undefined;
      case "T": {
        const v = `[truncated: ${node[1] as string}]`;
        cache.set(id, v);
        return v;
      }
      case "d": {
        const v = new Date(node[1] as string);
        cache.set(id, v);
        return v;
      }
      case "r": {
        const v = new RegExp(node[1] as string, node[2] as string);
        cache.set(id, v);
        return v;
      }
      case "U": {
        try {
          const v = new URL(node[1] as string);
          cache.set(id, v);
          return v;
        } catch {
          cache.set(id, node[1]);
          return node[1];
        }
      }
      case "B": {
        const v = `${node[1] as string}(${node[2] as number}) ${node[3] as string}`;
        cache.set(id, v);
        return v;
      }
      case "e": {
        const err = new Error(node[2] as string);
        err.name = (node[1] as string) ?? "Error";
        if (node[3]) err.stack = node[3] as string;
        cache.set(id, err);
        if (node[4] !== undefined && node[4] !== null) {
          (err as Error & { cause?: unknown }).cause = revive(node[4] as number);
        }
        return err;
      }
      case "a": {
        const arr: unknown[] = [];
        cache.set(id, arr);
        const ids = node[1] as number[];
        for (const childId of ids) arr.push(revive(childId));
        return arr;
      }
      case "o": {
        const obj: Record<string, unknown> = {};
        cache.set(id, obj);
        const entries = node[1] as [string, number][];
        for (const [k, cid] of entries) obj[k] = revive(cid);
        const className = node[2] as string | undefined;
        if (className) {
          Object.defineProperty(obj, Symbol.toStringTag, {
            value: className,
            enumerable: false,
          });
        }
        return obj;
      }
      case "m": {
        const map = new Map<unknown, unknown>();
        cache.set(id, map);
        const entries = node[1] as [number, number][];
        for (const [k, v] of entries) map.set(revive(k), revive(v));
        return map;
      }
      case "s": {
        const set = new Set<unknown>();
        cache.set(id, set);
        const ids = node[1] as number[];
        for (const cid of ids) set.add(revive(cid));
        return set;
      }
      default:
        cache.set(id, node);
        return node;
    }
  }

  return revive(0) as T;
}
