/**
 * Structured, non-destructive logging.
 *
 * An earlier version rewrote every occurrence of the word "error" inside log
 * lines to "err-info", which destroyed stack traces and made production
 * debugging impossible. Messages are now emitted verbatim, and the level filter
 * is applied at the call site instead of being baked into the text.
 */

const originalLog = console.log.bind(console);
const originalWarn = console.warn.bind(console);
const originalError = console.error.bind(console);

const LOG_LEVEL = (process.env.LOG_LEVEL || "info").toLowerCase();
const LEVELS: Record<string, number> = { debug: 10, info: 20, warn: 30, error: 40, silent: 100 };

function emit(level: "debug" | "info" | "warn" | "error", args: any[]) {
  if ((LEVELS[level] ?? 20) < (LEVELS[LOG_LEVEL] ?? 20)) return;
  const sink =
    level === "error" ? originalError : level === "warn" ? originalWarn : originalLog;
  sink.call(
    console,
    `[${new Date().toISOString()}] [${level.toUpperCase()}]`,
    ...args
  );
}

export const logger = {
  debug: (...args: any[]) => emit("debug", args),
  info: (...args: any[]) => emit("info", args),
  warn: (...args: any[]) => emit("warn", args),
  error: (...args: any[]) => emit("error", args),
};
