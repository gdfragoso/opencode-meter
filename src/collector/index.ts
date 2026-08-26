import type { Hooks } from "@opencode-ai/plugin";
import type { Logger } from "@/shared/logging";
import { createHookHandlers } from "./hooks";
import type { CollectorOptions } from "./session-state";

export type { CollectorOptions, SessionData, SessionState } from "./session-state";

export interface Collector {
  hooks: Hooks;
}

export function createCollector(opts: CollectorOptions, logger?: Logger): Collector {
  const handlers = createHookHandlers(
    {
      onEvent: opts.onEvent,
      onSessionCreated: opts.onSessionCreated,
      onSessionActive: opts.onSessionActive,
      onSessionEnd: opts.onSessionEnd,
    },
    logger,
  );

  const hooks: Hooks = {
    "chat.message": handlers.chatMessage,
    "tool.execute.before": handlers.toolBefore,
    "tool.execute.after": handlers.toolAfter,
    event: handlers.event,
  };

  return { hooks };
}

export default createCollector;
