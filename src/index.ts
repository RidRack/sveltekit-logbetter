export { sveltekitLogbetter, sveltekitLogbetter as default } from "./plugin.js";
export { logbetterHook, wrapHandleError } from "./hooks.js";
export type { LogbetterHookOptions } from "./hooks.js";
export { logbetter, mirror } from "./runtime.js";
export type { Logger, MirrorOptions, BrowserLevel } from "./runtime.js";
export { defaultPalette } from "./options.js";
export type {
  LogbetterOptions,
  Palette,
  LevelStyle,
  EditorScheme,
  EditorResolver,
} from "./options.js";
export type {
  LogEntry,
  LogLevel,
  RequestStart,
  RequestEnd,
  BatchMessage,
} from "./shared/protocol.js";
