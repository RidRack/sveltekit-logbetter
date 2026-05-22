import type { ViteDevServer } from "vite";
import type { BatchMessage, LogEntry, RequestEnd, RequestStart } from "../shared/protocol.js";
import { CHANNEL } from "../shared/protocol.js";

/**
 * Per-dev-server state. Held in a WeakMap so multiple Vite dev servers in the
 * same Node process (e.g. monorepo with parallel apps) cannot cross-talk.
 *
 * The buffer is a rolling window of the most recent entries, sized to keep
 * memory bounded but generous enough that a full-page reload (which triggers
 * a fresh drain request) replays everything a user would reasonably want to
 * see. The receiver dedupes by `id`, so live entries and drained entries
 * overlapping is harmless.
 */
const BUFFER_LIMIT = 1000;
const states = new WeakMap<ViteDevServer, ServerState>();

interface ServerState {
  counter: number;
  ring: BatchMessage;
  pendingBatch: BatchMessage;
  flushTimer: NodeJS.Timeout | null;
}

export function getState(server: ViteDevServer): ServerState {
  let s = states.get(server);
  if (!s) {
    s = {
      counter: 0,
      ring: { entries: [], starts: [], ends: [] },
      pendingBatch: { entries: [], starts: [], ends: [] },
      flushTimer: null,
    };
    states.set(server, s);
  }
  return s;
}

export function nextId(server: ViteDevServer): number {
  return ++getState(server).counter;
}

export function pushEntry(server: ViteDevServer, entry: LogEntry): void {
  const s = getState(server);
  s.ring.entries.push(entry);
  if (s.ring.entries.length > BUFFER_LIMIT) s.ring.entries.shift();
  s.pendingBatch.entries.push(entry);
  scheduleFlush(server, s);
}

export function pushStart(server: ViteDevServer, start: RequestStart): void {
  const s = getState(server);
  s.ring.starts.push(start);
  if (s.ring.starts.length > BUFFER_LIMIT) s.ring.starts.shift();
  s.pendingBatch.starts.push(start);
  scheduleFlush(server, s);
}

export function pushEnd(server: ViteDevServer, end: RequestEnd): void {
  const s = getState(server);
  s.ring.ends.push(end);
  if (s.ring.ends.length > BUFFER_LIMIT) s.ring.ends.shift();
  s.pendingBatch.ends.push(end);
  scheduleFlush(server, s);
}

export function snapshotDrain(server: ViteDevServer): BatchMessage {
  const s = getState(server);
  return {
    entries: s.ring.entries.slice(),
    starts: s.ring.starts.slice(),
    ends: s.ring.ends.slice(),
  };
}

function scheduleFlush(server: ViteDevServer, s: ServerState): void {
  if (s.flushTimer) return;
  s.flushTimer = setTimeout(() => {
    s.flushTimer = null;
    const payload = s.pendingBatch;
    if (
      payload.entries.length === 0 &&
      payload.starts.length === 0 &&
      payload.ends.length === 0
    ) {
      return;
    }
    s.pendingBatch = { entries: [], starts: [], ends: [] };
    const hot = (server as ViteDevServer & { hot?: { send: (c: string, p: unknown) => void } })
      .hot;
    hot?.send(CHANNEL.batch, payload);
  }, 8);
}
