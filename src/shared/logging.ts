import type { PluginInput } from "@opencode-ai/plugin";

export type LogLevel = "debug" | "info" | "warn" | "error";

export interface Logger {
  log(level: LogLevel, message: string, extra?: Record<string, unknown>): void;
  debug(message: string, extra?: Record<string, unknown>): void;
  info(message: string, extra?: Record<string, unknown>): void;
  warn(message: string, extra?: Record<string, unknown>): void;
  error(message: string, extra?: Record<string, unknown>): void;
}

type Client = PluginInput["client"];

const SERVICE = "opencode-meter";
const CONSOLE_PREFIX = "[opencode-meter]";

/**
 * Logger backed by OpenCode's app.log endpoint. Logging can never break the
 * hook pipeline: both async rejections and synchronous throws are swallowed.
 */
export function createAppLogger(client: Client): Logger {
  const send = (
    level: LogLevel,
    message: string,
    extra?: Record<string, unknown>,
  ): void => {
    try {
      void client.app
        .log({ body: { service: SERVICE, level, message, extra } })
        .catch(() => {});
    } catch {
      /* swallow synchronous throws (missing client.app, non-function log) */
    }
  };

  return {
    log: send,
    debug: (message, extra) => send("debug", message, extra),
    info: (message, extra) => send("info", message, extra),
    warn: (message, extra) => send("warn", message, extra),
    error: (message, extra) => send("error", message, extra),
  };
}

/** Logger that writes to the console with the [opencode-meter] prefix. */
export function createConsoleLogger(): Logger {
  const send = (
    level: LogLevel,
    message: string,
    extra?: Record<string, unknown>,
  ): void => {
    const line = `${CONSOLE_PREFIX} ${message}`;
    const args: unknown[] = extra !== undefined ? [line, extra] : [line];
    switch (level) {
      case "debug":
        console.debug(...args);
        break;
      case "info":
        console.info(...args);
        break;
      case "warn":
        console.warn(...args);
        break;
      case "error":
        console.error(...args);
        break;
    }
  };

  return {
    log: send,
    debug: (message, extra) => send("debug", message, extra),
    info: (message, extra) => send("info", message, extra),
    warn: (message, extra) => send("warn", message, extra),
    error: (message, extra) => send("error", message, extra),
  };
}

/** Stable string form of an unknown error. */
export function errString(err: unknown): string {
  if (err instanceof Error) return err.message;
  return String(err);
}
