import type { Hooks } from "@opencode-ai/plugin";
import { existsSync } from "node:fs";
import { createConsoleLogger, errString, type Logger } from "@/shared/logging";
import { classifyFileActivity, normalizePath, type ToolFileContext } from "./file-activity";
import { createSessionState, type SessionData, type SessionState } from "./session-state";
import { extractTaskChildSessionID } from "./task-link";

const MAX_TOOL_ARG_STRING = 500;

// Truncates long string args (e.g. task prompts) to keep the events table lean.
function sanitizeArgs(args: unknown): Record<string, unknown> | null {
  if (!args || typeof args !== "object" || Array.isArray(args)) return null;
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(args)) {
    out[key] =
      typeof value === "string" && value.length > MAX_TOOL_ARG_STRING
        ? `${value.slice(0, MAX_TOOL_ARG_STRING)}...`
        : value;
  }
  return out;
}

export interface HookHandlerOptions {
  onEvent?: (sessionID: string, type: string, data: Record<string, unknown>) => void;
  onSessionCreated?: (data: { sessionID: string; startedAt: number; title?: string; directory?: string; parentID?: string }) => void;
  onSessionActive?: (data: { sessionID: string; title?: string; agent?: string; model?: string; provider?: string }) => void;
  onSessionEnd?: (data: SessionData) => void;
}

export function createHookHandlers(opts: HookHandlerOptions, logger: Logger = createConsoleLogger()) {
  const sessions = new Map<string, SessionState>();
  // Per-instance, not per-module: two collectors in the same process (tests,
  // above all) must not share which writes are in flight.
  const pendingWrites = new Map<string, boolean>();
  const sessionParent = new Map<string, string>();
  const seenMessageIDs = new Map<string, Set<string>>();
  const seenErrorIDs = new Map<string, Set<string>>();
  const toolStartTimes = new Map<string, number>();
  const stepState = new Map<string, { stepNumber: number; start: number }>();

  const emit = (_event: string, data: Record<string, unknown>) => {
    if (opts.onEvent) {
      const sessionID = typeof data.sessionID === "string" ? data.sessionID : "";
      opts.onEvent(sessionID, _event, data);
    }
  };

  const getSession = (sid: string): SessionState => {
    if (!sessions.has(sid)) {
      sessions.set(sid, createSessionState());
    }
    return sessions.get(sid)!;
  };

  // Every map keyed by session id, in one place. session.idle and
  // session.deleted both end up here; before, only the first one did, and a
  // deleted session's state stayed in memory for the life of the process.
  const forgetSession = (sid: string): void => {
    sessions.delete(sid);
    sessionParent.delete(sid);
    seenMessageIDs.delete(sid);
    seenErrorIDs.delete(sid);
    stepState.delete(sid);
    for (const key of toolStartTimes.keys()) {
      if (key.startsWith(sid + ":")) toolStartTimes.delete(key);
    }
    for (const key of pendingWrites.keys()) {
      if (key.startsWith(sid + ":")) pendingWrites.delete(key);
    }
  };

  const endSession = (sid: string, status: "idle" | "error") => {
    const s = sessions.get(sid);
    if (!s) return;
    const cost = s.cost;
    const costSource = "opencode" as const;
    const costBreakdown = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 };
    const diffTotals = { additions: 0, deletions: 0 };
    for (const d of s.diffByFile.values()) {
      diffTotals.additions += d.additions;
      diffTotals.deletions += d.deletions;
    }
    const sessionData: SessionData = {
      sessionID: sid,
      title: s.title ?? null,
      directory: s.directory ?? null,
      branch: s.branch ?? null,
      startedAt: s.started,
      status,
      agent: s.agent ?? null,
      model: s.model ?? null,
      provider: s.provider ?? null,
      durationMs: s.activeFrom === null ? 0 : Date.now() - s.activeFrom,
      toolsUsed: s.tools,
      subagentsUsed: s.subagents,
      messages: s.messages,
      parentID: s.parentID ?? sessionParent.get(sid) ?? null,
      inputTokens: s.inputTokens,
      outputTokens: s.outputTokens,
      reasoningTokens: s.reasoningTokens,
      cacheReadTokens: s.cacheReadTokens,
      cacheWriteTokens: s.cacheWriteTokens,
      cost,
      costSource,
      costBreakdown,
      ttftMs: s.ttftMs,
      steps: s.steps,
      compactionCount: s.compactionCount,
      errorType: s.errorType ?? null,
      errorMessage: s.errorMessage ?? null,
      filesTouched: [...s.diffByFile.keys()],
      fileActivity: s.fileActivity,
      additions: diffTotals.additions,
      deletions: diffTotals.deletions,
      childSessionIDs: s.childSessionIDs,
      toolTimings: s.toolTimings,
      sessionType: s.sessionType,
    };
    // Only a summary: the full sessionData (steps, tool timings, file
    // activity) is already persisted in the sessions columns, and session.idle fires once per assistant turn — writing the
    // whole payload here duplicated the session into the events table on every
    // turn, for a table that has no retention.
    emit("session.ended", {
      sessionID: sid,
      status,
      startedAt: sessionData.startedAt,
      durationMs: sessionData.durationMs,
      sessionType: sessionData.sessionType,
      parentID: sessionData.parentID,
      agent: sessionData.agent,
      model: sessionData.model,
      provider: sessionData.provider,
      messages: sessionData.messages,
      toolsUsed: sessionData.toolsUsed,
      subagentsUsed: sessionData.subagentsUsed,
      inputTokens: sessionData.inputTokens,
      outputTokens: sessionData.outputTokens,
      cost: sessionData.cost,
      errorType: sessionData.errorType,
    });
    if (opts.onSessionEnd) {
      try { opts.onSessionEnd(sessionData); }
      catch (err) { logger.error("onSessionEnd callback threw", { error: errString(err) }); }
    }
    forgetSession(sid);
  };

  const chatMessage: Hooks["chat.message"] = async (input, _output) => {
    try {
      const s = getSession(input.sessionID);
      s.activeFrom ??= Date.now();
      s.title = (input as { title?: string }).title ?? s.title;
      s.agent = input.agent ?? s.agent;
      s.model = input.model?.modelID ?? s.model;
      s.provider = input.model?.providerID ?? s.provider;
      s.messages++;
      // Prompt text is deliberately not read here: a metrics plugin has no
      // business putting what the user types on disk. Only the count moves.
      if (opts.onSessionActive) {
        opts.onSessionActive({
          sessionID: input.sessionID,
          title: s.title,
          agent: s.agent,
          model: s.model,
          provider: s.provider,
        });
      }
    } catch (err) {
      logger.error("chatMessage handler threw", { error: errString(err) });
    }
  };

  const toolBefore: Hooks["tool.execute.before"] = async (input, output) => {
    try {
      const args = (output as { args?: Record<string, unknown> } | undefined)?.args;
      const taskArgs = input.tool === "task" ? sanitizeArgs(args) : null;
      emit("tool.before", {
        sessionID: input.sessionID,
        tool: input.tool,
        callID: input.callID,
        ...(taskArgs ? { args: taskArgs } : {}),
      });
      toolStartTimes.set(`${input.sessionID}:${input.callID}`, Date.now());
      if (input.tool === "task") {
        getSession(input.sessionID).subagents++;
      }
      if (input.tool === "write") {
        const filePath = args?.filePath;
        if (typeof filePath === "string") {
          pendingWrites.set(`${input.sessionID}:${input.callID}`, existsSync(normalizePath(filePath)));
        }
      }
    } catch (err) {
      logger.error("toolBefore handler threw", { error: errString(err) });
    }
  };

  const toolAfter: Hooks["tool.execute.after"] = async (input, output) => {
    try {
      const s = getSession(input.sessionID);
      s.tools++;
      const key = `${input.sessionID}:${input.callID}`;
      const start = toolStartTimes.get(key);
      const durationMs = start ? Date.now() - start : 0;
      toolStartTimes.delete(key);
      s.toolTimings.push({ tool: input.tool, durationMs, status: "completed" });
      const metadata = (output as { metadata?: Record<string, unknown> } | undefined)?.metadata;
      const outputText = (output as { output?: string } | undefined)?.output;
      const taskArgs = input.tool === "task" ? sanitizeArgs(input.args) : null;
      const childSessionID =
        input.tool === "task" ? extractTaskChildSessionID(metadata, outputText) : null;
      emit("tool.after", {
        sessionID: input.sessionID,
        tool: input.tool,
        callID: input.callID,
        agent: s.agent,
        model: s.model,
        durationMs,
        ...(taskArgs ? { args: taskArgs } : {}),
        ...(childSessionID ? { childSessionID } : {}),
      });
      if (input.tool === "task" && Array.isArray(input.args?.load_skills)) {
        emit("skills.loaded", { sessionID: input.sessionID, skills: input.args.load_skills });
      }
      if (input.tool === "skill" && typeof input.args?.name === "string") {
        emit("skills.called", { sessionID: input.sessionID, name: input.args.name });
      }
      const ctx: ToolFileContext = {
        tool: input.tool,
        args: input.args as Record<string, unknown> | undefined,
        output: output as { metadata?: Record<string, unknown> } | undefined,
        existed: pendingWrites.get(key),
      };
      const entries = classifyFileActivity(ctx);
      if (entries.length > 0) s.fileActivity.push(...entries);
      pendingWrites.delete(key);
    } catch (err) {
      logger.error("toolAfter handler threw", { error: errString(err) });
    }
  };

  const handleEvent: Hooks["event"] = async ({ event }) => {
    try {
      switch (event.type) {
        case "session.created": {
          const info = event.properties.info;
          const sid = info.id;
          const s = getSession(sid);
          s.title = info.title ?? s.title;
          s.directory = info.directory ?? s.directory;
          s.started = info.time?.created ?? s.started;
          const parentID = info.parentID ?? null;
          if (parentID) {
            sessionParent.set(sid, parentID);
            s.parentID = parentID;
            getSession(parentID).childSessionIDs.push(sid);
          }
          s.sessionType = parentID ? "subagent" : "main";
          emit("session.created", { sessionID: sid, parentID: info.parentID ?? null });
          emit("session.type", { sessionID: sid, sessionType: s.sessionType });
          if (opts.onSessionCreated) {
            opts.onSessionCreated({
              sessionID: sid,
              startedAt: s.started,
              title: s.title,
              directory: s.directory ?? info.directory ?? undefined,
              parentID: s.parentID ?? info.parentID ?? undefined,
            });
          }
          break;
        }
        case "session.updated": {
          const info = event.properties.info;
          const s = sessions.get(info.id);
          if (s && info.title != null) s.title = info.title;
          emit("session.updated", { sessionID: info.id });
          break;
        }
        case "session.deleted": {
          const sid = event.properties.info.id;
          emit("session.deleted", { sessionID: sid });
          forgetSession(sid);
          break;
        }
        case "session.idle":
          endSession(event.properties.sessionID, "idle");
          break;
        case "session.error": {
          const props = event.properties;
          if (props.sessionID) {
            const s = getSession(props.sessionID);
            const errorName = props.error?.name as string | undefined;
            const errorMessage = (props.error?.data as { message?: string } | undefined)?.message;
            s.errorType = errorName;
            s.errorMessage = errorMessage;
            emit("session.error", {
              sessionID: props.sessionID,
              error: { name: errorName ?? null, message: errorMessage ?? null },
            });
            endSession(props.sessionID, "error");
          }
          break;
        }
        case "session.compacted": {
          const sid = event.properties.sessionID;
          if (sid) getSession(sid).compactionCount++;
          emit("session.compacted", { sessionID: sid });
          break;
        }
        case "session.diff": {
          const props = event.properties;
          const s = props.sessionID ? getSession(props.sessionID) : null;
          if (s) {
            for (const d of props.diff ?? []) {
              // Defensive: a diff entry with no path has nothing to key on.
              if (!d.file) continue;
              // Overwrite instead of accumulate: this event carries the
              // session's diff so far, not the delta since the last one.
              s.diffByFile.set(d.file, { additions: d.additions ?? 0, deletions: d.deletions ?? 0 });
            }
          }
          // FileDiff carries `before` and `after` — the ENTIRE contents of the
          // file on both sides — and this event is re-emitted on every edit.
          // That put whole source files into the events table, over and over.
          // Only the counts are read (deriveSessionDiff), so only those are
          // persisted.
          emit("session.diff", {
            sessionID: props.sessionID,
            diff: (props.diff ?? []).map((d) => ({
              file: d.file,
              additions: d.additions,
              deletions: d.deletions,
            })),
          });
          break;
        }
        case "file.edited":
          emit("file.edited", { file: event.properties.file });
          break;
        case "message.updated": {
          const info = event.properties.info;
          if (info.role !== "assistant") break;
          if (info.error) {
            const seenErrors = seenErrorIDs.get(info.sessionID) ?? new Set<string>();
            if (!seenErrors.has(info.id)) {
              seenErrors.add(info.id);
              seenErrorIDs.set(info.sessionID, seenErrors);
              const error = info.error as { name: string; data?: { message?: string } };
              emit("message.error", {
                sessionID: info.sessionID,
                messageID: info.id,
                error: { name: error.name, message: error.data?.message ?? null },
              });
            }
          }
          if (!info.time?.completed) break;
          const dedup = seenMessageIDs.get(info.sessionID) ?? new Set<string>();
          if (dedup.has(info.id)) break;
          dedup.add(info.id);
          seenMessageIDs.set(info.sessionID, dedup);
          const s = getSession(info.sessionID);
          s.activeFrom ??= Date.now();
          s.model = info.modelID ?? s.model;
          s.provider = info.providerID ?? s.provider;
          s.inputTokens += info.tokens?.input ?? 0;
          s.outputTokens += info.tokens?.output ?? 0;
          s.reasoningTokens += info.tokens?.reasoning ?? 0;
          s.cacheReadTokens += info.tokens?.cache?.read ?? 0;
          s.cacheWriteTokens += info.tokens?.cache?.write ?? 0;
          s.cost += info.cost;
          s.costSource = "opencode";
          emit("message.updated", {
            sessionID: info.sessionID,
            messageID: info.id,
            role: info.role,
            tokens: info.tokens,
            cost: info.cost,
          });
          break;
        }
        case "message.part.updated": {
          const part = event.properties.part;
          const s = getSession(part.sessionID);
          if (part.type === "step-start") {
            const current = stepState.get(part.sessionID) ?? { stepNumber: 0 };
            stepState.set(part.sessionID, { stepNumber: current.stepNumber + 1, start: Date.now() });
            emit("step.start", {
              sessionID: part.sessionID,
              step: current.stepNumber + 1,
            });
          } else if (part.type === "step-finish") {
            const current = stepState.get(part.sessionID);
            const durationMs = current ? Date.now() - current.start : 0;
            s.steps.push({
              stepNumber: current?.stepNumber ?? s.steps.length + 1,
              tokens: {
                input: part.tokens?.input ?? 0,
                output: part.tokens?.output ?? 0,
                reasoning: part.tokens?.reasoning ?? 0,
                cacheRead: part.tokens?.cache?.read ?? 0,
                cacheWrite: part.tokens?.cache?.write ?? 0,
              },
              cost: part.cost,
              finishReason: part.reason,
              durationMs,
            });
            // cost and tokens are what makes a step attributable to the tool
            // calls inside it. They were captured into `s.steps` above but left
            // out of the event, so findToolMetrics — which reads `$.cost` and
            // `$.tokens` off this row — scored every tool at zero. Only the two
            // figures that query consumes are persisted; the rest of the
            // breakdown already lives on the session.
            emit("step.finish", {
              sessionID: part.sessionID,
              step: current?.stepNumber ?? s.steps.length,
              durationMs,
              cost: part.cost,
              tokens: {
                input: part.tokens?.input ?? 0,
                output: part.tokens?.output ?? 0,
              },
            });
          } else if (part.type === "text" && s.ttftMs === null && part.time?.start) {
            s.ttftMs = part.time.start - s.started;
          }
          break;
        }
        case "permission.updated": {
          const props = event.properties as { sessionID?: string; key?: string };
          emit("permission.asked", { sessionID: props.sessionID, key: props.key ?? null });
          break;
        }
        case "permission.replied": {
          const props = event.properties;
          emit("permission.replied", {
            sessionID: props.sessionID,
            key: props.permissionID,
            reply: props.response,
          });
          break;
        }
        case "todo.updated":
          emit("todo.updated", { sessionID: event.properties.sessionID });
          break;
        case "command.executed":
          emit("command.executed", {
            sessionID: event.properties.sessionID,
            command: event.properties.name,
          });
          break;
        case "tui.command.execute":
          emit("tui.command", { command: event.properties.command });
          break;
        case "tui.toast.show":
          emit("tui.toast", { title: event.properties.title });
          break;
        case "lsp.client.diagnostics":
          emit("lsp.diagnostics", { file: event.properties.path });
          break;
      }
    } catch (err) {
      logger.error(`Error handling event "${event.type}"`, { error: errString(err) });
    }
  };

  return { chatMessage, toolBefore, toolAfter, event: handleEvent };
}
