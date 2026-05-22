# sveltekit-logbetter

```
██╗      ██████╗  ██████╗ ██████╗ ███████╗████████╗████████╗███████╗██████╗
██║     ██╔═══██╗██╔════╝ ██╔══██╗██╔════╝╚══██╔══╝╚══██╔══╝██╔════╝██╔══██╗
██║     ██║   ██║██║  ███╗██████╔╝█████╗     ██║      ██║   █████╗  ██████╔╝
██║     ██║   ██║██║   ██║██╔══██╗██╔══╝     ██║      ██║   ██╔══╝  ██╔══██╗
███████╗╚██████╔╝╚██████╔╝██████╔╝███████╗   ██║      ██║   ███████╗██║  ██║
╚══════╝ ╚═════╝  ╚═════╝ ╚═════╝ ╚══════╝   ╚═╝      ╚═╝   ╚══════╝╚═╝  ╚═╝
```

Forward SvelteKit **server** `console.*` calls to the **browser** console during dev. Clickable source paths. Per-request grouping. Classy palette. **Zero runtime dependencies.** Compiles out of production entirely.

```
▸  GET /products/42      127ms     req#a31
   LOG    src/routes/products/[id]/+page.server.ts:14:3
       Loaded product  ▸ {id: 42, name: "Honda Civic", year: 2019, …}
   WARN   src/server/preload.ts:42:1
       slow upstream  327ms
   ERR    src/server/api/quote.ts:201:9
       Error: rate limit exceeded
         at fetchQuote (src/server/api/quote.ts:201:9)
   ──────────────────────────────────────────────────────
   3 logs · 1 warn · 1 error · 200 · 127ms
```

## Install

```sh
pnpm add -D sveltekit-logbetter
# or
npm install --save-dev sveltekit-logbetter
# or
yarn add -D sveltekit-logbetter
```

For pnpm workspaces:

```sh
pnpm add -D sveltekit-logbetter --filter <your-app>
```

## Setup

**1.** Add the Vite plugin in `vite.config.ts`:

```ts
import { sveltekit } from "@sveltejs/kit/vite";
import { defineConfig } from "vite";

import { sveltekitLogbetter } from "sveltekit-logbetter/vite";

export default defineConfig({
  plugins: [sveltekit(), sveltekitLogbetter()],
});
```

**2.** *(Optional but recommended)* Add the request-grouping `Handle` in `src/hooks.server.ts`:

```ts
import { sequence } from "@sveltejs/kit/hooks";

import { logbetterHook } from "sveltekit-logbetter/hooks";

export const handle = sequence(
  // ...your existing hooks
  logbetterHook(),
  // ...any hooks that should appear inside the request group
);
```

That's it. Start `pnpm dev`, open your app, and watch your server logs land in the browser's DevTools console with file:line links you can click straight to your editor.

## How to use

Three entry points, three escalating levels of integration. Start at level 1 and add what you need.

### Entry points at a glance

| Import from | What it gives you | When |
|---|---|---|
| `sveltekit-logbetter/vite` | The Vite plugin | Always — required setup |
| `sveltekit-logbetter/hooks` | `logbetterHook()` + `wrapHandleError()` | When you want request grouping, response-body forwarding, or uncaught-error forwarding |
| `sveltekit-logbetter/runtime` | `logbetter` + `mirror()` | When you have a structured logger (Winston / Pino / `@your-org/logger`) or want to forward from catch blocks |

### 1. Just the plugin — forward every `console.*` from server code

```ts
// vite.config.ts
import { sveltekit } from "@sveltejs/kit/vite";
import { defineConfig } from "vite";

import { sveltekitLogbetter } from "sveltekit-logbetter/vite";

export default defineConfig({
  plugins: [sveltekit(), sveltekitLogbetter()],
});
```

Now any `console.log/info/warn/error/debug/trace/table/group/...` in `+page.server.ts`, `+server.ts`, `hooks.server.ts`, `+layout.server.ts`, or any imported `.ts` lands in the browser. Each entry has a clickable origin (`src/file.ts:line:col`), values render as interactive widgets, errors keep their full stack and `.cause` chain.

No further setup required. Skip the rest if this is enough.

### 2. + Hook — group logs by request, forward response bodies and uncaught errors

```ts
// src/hooks.server.ts
import { sequence } from "@sveltejs/kit/hooks";

import { logbetterHook } from "sveltekit-logbetter/hooks";

export const handle = sequence(
  // ...any of your existing hooks that should appear OUTSIDE the request group
  logbetterHook(),
  // ...any hooks that should appear INSIDE the request group (auth, canonical-log, etc.)
);
```

Adds:
- A collapsible `console.groupCollapsed` per request with timing + summary footer.
- `console.info` of every JSON response body (≤256 KB, configurable).
- `console.error` of any uncaught error from `resolve()` — **always re-thrown** so SvelteKit's `handleError`, Sentry / Faro / OTel, and your default stderr print all still fire normally.

Tuning:

```ts
logbetterHook({
  logUnhandledErrors: true,     // default — set false if wrapHandleError handles errors
  logResponseBodies: true,      // default
  maxResponseBodyBytes: 262_144 // default 256 KB
});
```

Pair with `wrapHandleError` if you have a custom `handleError`:

```ts
import { wrapHandleError } from "sveltekit-logbetter/hooks";
import { mySentryHandleError } from "$lib/observability";

export const handleError = wrapHandleError(mySentryHandleError);
```

`wrapHandleError` always delegates to the inner handler — browser forwarding is additive, your reporting flow is unchanged.

### 3. + Runtime — bridge a structured logger / forward from catch blocks

Use this when your error or info path is via a structured logger (Winston, Pino, `@your-org/logger`, custom) — those calls don't go through `console.*` and so aren't picked up by the AST transform.

**Mirror a whole logger** (one line, every call hits both your logger AND the browser):

```ts
// src/server/log.ts
import { mirror } from "sveltekit-logbetter/runtime";
import { logger as base } from "@your-org/logger";

export const logger = mirror(base, {
  // Custom methods to wrap in addition to log/info/warn/error/debug/trace.
  methods: ["event", "audit"],
  // Optional: explicitly map each custom method to a browser console level.
  // Without this the heuristic does the sensible thing.
  levelMap: { event: "info", audit: "info" },
});
```

Now `logger.event({...})`, `logger.error("listDriverPayments failed", err)`, etc. all show up in the browser with the same file:line attribution as native `console.*`.

**Forward from a catch block:**

```ts
import { logbetter } from "sveltekit-logbetter/runtime";

try {
  return await listDriverPayments(driverId);
} catch (err) {
  logger.error("listDriverPayments failed", err);    // structured (existing)
  logbetter.error("listDriverPayments failed", err); // browser
  return { items: [] };
}
```

Both `mirror()` and `logbetter` are zero-cost in production — the global runtime isn't installed outside `vite dev`, so every call is a single property-read no-op.

### Recommended full setup (covers everything)

```ts
// vite.config.ts
import { sveltekit } from "@sveltejs/kit/vite";
import { defineConfig } from "vite";

import { sveltekitLogbetter } from "sveltekit-logbetter/vite";

export default defineConfig({
  plugins: [sveltekit(), sveltekitLogbetter()],
});
```

```ts
// src/hooks.server.ts
import { sequence } from "@sveltejs/kit/hooks";

import { logbetterHook, wrapHandleError } from "sveltekit-logbetter/hooks";

export const handle = sequence(
  // ...your existing hooks
  logbetterHook(),
  // ...auth, canonicalLog, etc.
);

export const handleError = wrapHandleError(/* your existing handleError */);
```

```ts
// src/server/log.ts
import { mirror } from "sveltekit-logbetter/runtime";
import { logger as base } from "@your-org/logger"; // or whatever you use

export const logger = mirror(base, { methods: ["event"], levelMap: { event: "info" } });
```

Three files, four imports, zero changes to call sites elsewhere. Dev gets full browser-side visibility. Production is untouched.

## Dev-only by construction

This package is engineered to **never leak server logs into production**:

1. The Vite plugin is registered with `apply: "serve"`. Vite literally does not load it during `vite build`. No transform ever runs against production code.
2. The transformed code calls `globalThis.__logbetter__?.emit(...)` — an optional chain. In production the runtime hook is never installed, so the emit is a one-property-lookup no-op. The original `console.X(...)` call is preserved unchanged inside a comma-expression.
3. The `logbetterHook()` `Handle` checks for the same global. If absent (production), it's a transparent passthrough — one property read per request, no allocation.
4. The receiver code lives in a virtual module that's only resolvable when the plugin is loaded. It cannot end up in a production bundle.
5. Verify yourself: after `pnpm build`, `grep -r "logbetter" build/` should return nothing.

## What you get

- **Every server `console.X` becomes a browser DevTools entry.** `log`, `info`, `warn`, `error`, `debug`, `trace`, `table`, `group`, `groupCollapsed`, `groupEnd`, `dir`, `count`, `assert`, `clear` — all covered.
- **Clickable source paths.** Every entry shows `src/path/to/file.ts:line:col` as a `vscode://` (or Cursor / Webstorm / etc.) URL. Click it, your editor jumps there.
- **Per-request grouping.** With `logbetterHook()` installed, every request gets a collapsible `console.groupCollapsed` containing all its logs plus a timing/summary footer.
- **Interactive object widgets.** Objects, Maps, Sets, Dates, Errors, URLs, BigInts, typed arrays — all revived to native instances on the browser side so DevTools renders them with full expand/inspect.
- **Cycle-safe serialization.** Circular references work. Stack traces preserve `error.cause` chains. JSON-shaped strings auto-prettify into interactive objects (turn off with `prettyJsonStrings: false`).
- **Classy colourful palette.** Tuned for both light and dark DevTools themes; fully overridable per-level.
- **Zero runtime dependencies.** One peer dep tree (`vite`, `@sveltejs/kit`, `svelte`). Nothing else.

## Options

```ts
sveltekitLogbetter({
  enabled: true,             // master switch (besides apply: "serve")
  logOnServer: true,         // also print to the dev-server terminal
  levels: undefined,         // e.g. ["warn", "error"] to limit
  include: undefined,        // glob(s); default: ["**/*.{js,ts,mjs,mts}"]
  exclude: undefined,        // merged with built-in node_modules/.svelte-kit/dist/build excludes
  editor: "vscode",          // "vscode" | "vscode-insiders" | "cursor" | "webstorm" | "idea" | "sublime" | "none" | (file,line,col)=>string
  groupByRequest: true,      // group by request id (needs hooks)
  expandGroupsOnError: true, // auto-expand request groups that contain errors
  prettyJsonStrings: true,   // auto-parse JSON-shaped strings
  maxArgBytes: 100_000,      // per-arg cap (truncation marker if exceeded)
  maxDepth: 12,
  maxChildren: 1000,
  redact: (e) => true,       // return false to drop entries; receives {level,file,line,column}
  colors: {                  // deep-merge palette overrides
    warn: { fg: "#000", bg: "#FFD60A" },
  },
});
```

## Editor links

- **VS Code / Cursor / Insiders**: works out of the box — the URL scheme is registered on install.
- **WebStorm / IntelliJ IDEA**: works once you install the [JetBrains Toolbox](https://www.jetbrains.com/toolbox-app/) and enable URL handlers.
- **Sublime Text**: install the [subl-handler](https://github.com/dhoulb/subl-handler) helper.
- **None of the above**: set `editor: "none"` to hide the link.
- **Custom**: pass a function `(file, line, col) => string` returning whatever URL you want.

## Request grouping

When `logbetterHook()` is in your `sequence(...)`, every server log inside a request gets tagged with that request's id. The browser receiver collapses them under a header like:

```
▸ GET /api/quote   312ms   req#a31
```

Header timing colours band by speed:

| Range | Colour |
|---|---|
| < 100ms | sage green |
| 100–500ms | marigold |
| > 500ms | ruby |

Groups containing any `error`/`assert` entry — or whose request itself threw — **open expanded** so failures aren't hidden. Toggle off with `expandGroupsOnError: false` if you'd rather they always start collapsed. Implementation note: entries are buffered per-request and printed at the response-end signal so the expand decision can be made retroactively; on a long-running request, logs appear when the response ends rather than live.

Each group ends with a one-line summary: `5 logs · 1 warn · 1 error · 200 · 312ms`.

Logs emitted **outside** a request (top-of-module side effects, `init()` hooks) land in a synthetic `▸ unattributed` group.

## Data presentation

Server values arrive in the browser as native objects whenever possible:

| Server value | DevTools render |
|---|---|
| `{ id: 42, name: "x" }` | expandable Object widget |
| `[1, 2, 3]` | Array widget |
| `new Map([["k","v"]])` | `Map(1) {"k" => "v"}` |
| `new Set([1, 2])` | `Set(2) {1, 2}` |
| `new Date()` | formatted date with hover |
| `new Error("nope")` | red, expandable, with source-mapped stack |
| `new URL("https://x")` | URL widget |
| `123n` | `123n` BigInt |
| `new Uint8Array([…])` | typed-array preview (`Uint8Array(8) "01 02 03 …"`) |
| `JSON.stringify(obj)` | auto-prettified back to interactive object (toggle with `prettyJsonStrings`) |
| Promises / Functions / Symbols | `[Promise]` / `[Function: name]` / `Symbol(desc)` placeholders |

Truncation is always visible. If you exceed `maxDepth`, `maxChildren`, or `maxArgBytes`, the relevant arg shows `[truncated: depth]` / `[truncated: breadth]` / `[truncated: size]` — never silent dropping.

## Bridging a structured logger (catches the cases hooks can't see)

A `Handle` can only forward errors that *bubble up past `resolve(event)`*. Anything caught inside a `load()` / action / endpoint and reported via your structured logger (Winston, Pino, `@your-org/logger`, etc.) never reaches our hook — by design. For those, use the `runtime` API:

```ts
// src/server/log.ts
import { mirror } from "sveltekit-logbetter/runtime";
import { logger as baseLogger } from "@your-org/logger";

export const logger = mirror(baseLogger);
```

Every `logger.error(...)`, `logger.warn(...)`, etc. now hits **both** your existing logger *and* the browser console. No changes to call sites. Production: zero overhead (the global isn't installed, so the forward is a property-lookup no-op).

### Custom levels (canonical events, audit, metric, etc.)

If your logger has methods beyond the standard six (`log/info/warn/error/debug/trace`) — for instance `logger.event(...)` for canonical request summaries, or `logger.audit(...)` for compliance — list them and optionally map each to a browser console level:

```ts
export const logger = mirror(baseLogger, {
  methods: ["event", "audit", "metric"],
  levelMap: { event: "info", audit: "info", metric: "debug" },
});
```

Without an explicit `levelMap`, the heuristic is:

- `*error*` / `*fatal*` / `*crit*` → `error`
- `*warn*` → `warn`
- exact `debug` → `debug`
- exact `trace` / `verbose` → `trace`
- anything else → `info`

Non-logger properties on the inner (`label`, `linkId`, `child`, etc.) are preserved unchanged on the wrapped logger.

Inside a catch:

```ts
import { logbetter } from "sveltekit-logbetter/runtime";

try {
  await listDriverPayments(driverId);
} catch (err) {
  logger.error("listDriverPayments failed", err);  // existing structured log
  logbetter.error("listDriverPayments failed", err); // browser visibility
  // ... return fallback / rethrow as you would normally
}
```

Why this exists: errors can be caught and handled before they ever reach SvelteKit's middleware chain. When that happens, the only thing that knows about the error is *your code*. The runtime API gives that code a one-line way to mirror to the browser.

## Coexistence with Sentry / Grafana Faro / OTel / structured loggers

logbetter is **additive**. It never replaces, suppresses, or swallows your existing error and logging flow.

- **Uncaught errors in `+page.server.ts` / `+server.ts`** are forwarded to the browser as `console.error`, then **re-thrown** so SvelteKit's `handleError`, your default stderr print, and any downstream observability (Sentry, Grafana Faro, OpenTelemetry, your structured logger) all still fire normally.
- **`wrapHandleError(inner)`** delegates to the inner handler unconditionally. Browser-side logging is additive; your existing reporter still runs.
- **`logbetterHook()` is dev-only.** In production it's a one-property-lookup passthrough — zero behavioural change.
- **JSON response bodies** are read from a `.clone()` of the response, asynchronously, so the original response stream is returned to the browser without delay.

If you wire both `logbetterHook()` and `wrapHandleError()`, errors get forwarded once via each. To avoid the double, set `logbetterHook({ logUnhandledErrors: false })` and keep the wrapper as the single source of truth.

```ts
// hooks.server.ts — pattern that cooperates with an existing Sentry / Grafana / Faro setup
import { sequence } from "@sveltejs/kit/hooks";
import { logbetterHook, wrapHandleError } from "sveltekit-logbetter/hooks";
import { mySentryHandleError } from "$lib/observability";

export const handle = sequence(
  // ...your existing hooks
  logbetterHook({ logUnhandledErrors: false }),  // body forwarding only
);

export const handleError = wrapHandleError(mySentryHandleError);
```

## HMR safety

This plugin is designed to be transparent to Vite's HMR. Specifically:

- **Module graph is unchanged for your code.** The transform appends emit calls inside a comma-expression; it does not add imports, exports, or top-level statements.
- **Source maps are line-accurate.** Stack traces and HMR error overlays still point at the right original lines.
- **The receiver is a virtual module with no HMR boundary** — `import.meta.hot.on(...)` listeners register once per page and survive HMR updates of other modules.
- **Drain replay is dedupe-safe.** Each forwarded entry carries a monotonic id. After a full-page reload, the server resends its rolling 1000-entry history and the browser receiver skips ids it has already shown. No duplicates, no gaps you'd notice.
- **Per-dev-server isolation.** State is kept in a `WeakMap<ViteDevServer, …>`, so multiple parallel dev servers in the same Node process (monorepos!) don't cross-talk.
- **HTTPS / WSS** — transport rides Vite's existing HMR channel, so `HTTPS=true vite dev` works unchanged.

## Coexisting with structured loggers

If you use a structured logger (`pino`, `winston`, `@your-org/logger`, etc.) that writes JSON to stdout via `console.log`, you probably want to filter those out:

```ts
sveltekitLogbetter({
  exclude: ["**/node_modules/**", "**/server/log.ts"],
  // or
  redact: (e) => !e.file.includes("/server/log"),
});
```

## FAQ

**Does this work in production?**
No, and that's intentional. See "Dev-only by construction" above.

**Does it slow down my dev server?**
Negligibly. The transform runs once per file load (cached by Vite), adds one comma-expression per `console.X`, and the serializer is depth-bounded and byte-capped. The wire protocol batches sends at 8ms intervals.

**Does it work with `.svelte` files?**
Currently it transforms `.js` / `.ts` / `.mjs` / `.mts`. `console.X` calls inside `<script>` blocks of `.svelte` files are passed through unchanged (they already appear in the browser console without help). `.svelte` server-script support is on the roadmap.

**Will it interfere with HTTPS dev?**
No. The transport uses Vite's existing HMR channel, which upgrades to WSS automatically when you run with HTTPS.

**Why not use `magic-string` / `devalue`?**
Because shipping zero runtime dependencies is a feature. The hand-rolled editor (~150 LOC) and serializer (~250 LOC) are append-only and well-tested. Nothing in this package leaks into your `node_modules` graph except devDependencies.

## License

MIT.
