import type { EventSessionCreated, EventSessionIdle } from "@opencode-ai/sdk";
import { afterAll, describe, expect, test, vi } from "bun:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Logger } from "@/shared/logging";
import { createHookHandlers } from "./hooks";
import type { SessionData } from "./session-state";

interface TestSessionCreated {
  properties: { info: { id: string; title?: string; time?: { created: number }; parentID?: string } };
}

interface TestSessionIdle {
  type: "session.idle";
  properties: { sessionID: string };
}

function sessionCreatedEvent(info: { id: string; title?: string; parentID?: string; created?: number }): TestSessionCreated {
  return {
    properties: {
      info: {
        id: info.id,
        title: info.title,
        parentID: info.parentID,
        time: { created: info.created ?? Date.now() },
      },
    },
  };
}

function sessionIdleEvent(sessionID: string): TestSessionIdle {
  return {
    type: "session.idle",
    properties: { sessionID },
  };
}

function chatMessageInput(input: {
  sessionID: string;
  role?: string;
  parts?: Array<{ type: string; text: string }>;
  text?: string;
  content?: string;
}) {
  return {
    sessionID: input.sessionID,
    agent: "test-agent",
    role: input.role ?? "user",
    parts: input.parts,
    text: input.text,
    content: input.content,
  };
}

describe("session_type attribution", () => {
  test("session.created with no parentID sets session_type to main", async () => {
    const ended: SessionData[] = [];
    const handlers = createHookHandlers({
      onSessionEnd: (data) => ended.push(data),
    });

    await handlers.event({ event: { type: "session.created", ...sessionCreatedEvent({ id: "sess-main" }) } as EventSessionCreated });
    await handlers.event({ event: sessionIdleEvent("sess-main") as EventSessionIdle });

    expect(ended.length).toBe(1);
    expect(ended[0].sessionType).toBe("main");
  });

  test("session.created with parentID sets session_type to subagent", async () => {
    const ended: SessionData[] = [];
    const handlers = createHookHandlers({
      onSessionEnd: (data) => ended.push(data),
    });

    await handlers.event({ event: { type: "session.created", ...sessionCreatedEvent({ id: "sess-sub", parentID: "parent-1" }) } as EventSessionCreated });
    await handlers.event({ event: sessionIdleEvent("sess-sub") as EventSessionIdle });

    expect(ended.length).toBe(1);
    expect(ended[0].sessionType).toBe("subagent");
  });
});

describe("error capture", () => {
  test("message.updated with assistant error emits exactly one message.error per id, even without time.completed", async () => {
    const events: Array<{ type: string; data: Record<string, unknown> }> = [];
    const ended: SessionData[] = [];
    const handlers = createHookHandlers({
      onEvent: (sid, type, data) => events.push({ type, data }),
      onSessionEnd: (d) => ended.push(d),
    });

    await handlers.event({
      event: {
        type: "message.updated",
        properties: {
          info: {
            id: "m1",
            sessionID: "s1",
            role: "assistant",
            error: { name: "APIError", data: { message: "boom" } },
          },
        },
      },
    } as unknown as Parameters<typeof handlers.event>[0]);
    // Second update with the same id must be deduped
    await handlers.event({
      event: {
        type: "message.updated",
        properties: {
          info: {
            id: "m1",
            sessionID: "s1",
            role: "assistant",
            error: { name: "APIError", data: { message: "boom" } },
          },
        },
      },
    } as unknown as Parameters<typeof handlers.event>[0]);
    // Different id is independent
    await handlers.event({
      event: {
        type: "message.updated",
        properties: {
          info: {
            id: "m2",
            sessionID: "s1",
            role: "assistant",
            error: { name: "APIError", data: { message: "boom" } },
          },
        },
      },
    } as unknown as Parameters<typeof handlers.event>[0]);

    const msgErrors = events.filter((e) => e.type === "message.error");
    expect(msgErrors.length).toBe(2);
    const m1 = msgErrors.find((e) => e.data.messageID === "m1");
    expect(m1).toBeDefined();
    expect(m1!.data.error).toEqual({ name: "APIError", message: "boom" });
    expect(m1!.data.sessionID).toBe("s1");
    expect(ended.length).toBe(0);
  });

  test("error-capture failure paths: user role is skipped, session.error emits and ends session", async () => {
    const events: Array<{ type: string; data: Record<string, unknown> }> = [];
    const ended: SessionData[] = [];
    const handlers = createHookHandlers({
      onEvent: (sid, type, data) => events.push({ type, data }),
      onSessionEnd: (d) => ended.push(d),
    });

    // (a) role=user + error → no message.error
    await handlers.event({
      event: {
        type: "message.updated",
        properties: {
          info: {
            id: "mu1",
            sessionID: "s1",
            role: "user",
            error: { name: "APIError", data: { message: "boom" } },
          },
        },
      },
    } as unknown as Parameters<typeof handlers.event>[0]);
    expect(events.some((e) => e.type === "message.error")).toBe(false);

    // (b) session.error → emits session.error event AND ends session with status="error"
    await handlers.event({
      event: {
        type: "session.error",
        properties: {
          sessionID: "s2",
          error: { name: "MessageAbortedError", data: { message: "aborted" } },
        },
      },
    } as unknown as Parameters<typeof handlers.event>[0]);

    const sessErr = events.find((e) => e.type === "session.error");
    expect(sessErr).toBeDefined();
    expect(sessErr!.data).toEqual({
      sessionID: "s2",
      error: { name: "MessageAbortedError", message: "aborted" },
    });
    expect(ended.length).toBe(1);
    expect(ended[0].status).toBe("error");
  });
});

describe("file activity tracking", () => {
  const tempDirs: string[] = [];

  function tempDir(): string {
    const dir = mkdtempSync(join(tmpdir(), "om-file-activity-"));
    tempDirs.push(dir);
    return dir;
  }

  afterAll(() => {
    for (const dir of tempDirs) {
      Bun.spawnSync(["rm", "-rf", dir]);
    }
  });

  test("write to a nonexistent file is classified as created", async () => {
    const dir = tempDir();
    const filePath = join(dir, "new.txt");
    const ended: SessionData[] = [];
    const handlers = createHookHandlers({ onSessionEnd: (d) => ended.push(d) });

    await handlers.event({
      event: { type: "session.created", ...sessionCreatedEvent({ id: "sess-write-create" }) } as EventSessionCreated,
    });
    await handlers.toolBefore(
      { tool: "write", sessionID: "sess-write-create", callID: "c1" } as Parameters<typeof handlers.toolBefore>[0],
      { args: { filePath } } as Parameters<typeof handlers.toolBefore>[1]
    );
    await handlers.toolAfter(
      { tool: "write", sessionID: "sess-write-create", callID: "c1", args: { filePath } } as Parameters<typeof handlers.toolAfter>[0],
      {} as Parameters<typeof handlers.toolAfter>[1]
    );
    await handlers.event({ event: sessionIdleEvent("sess-write-create") as EventSessionIdle });

    expect(ended.length).toBe(1);
    expect(ended[0].fileActivity.length).toBe(1);
    expect(ended[0].fileActivity[0].action).toBe("created");
    expect(ended[0].fileActivity[0].path).toBe(filePath);
    expect(ended[0].fileActivity[0].tool).toBe("write");
  });

  test("write to an existing file is classified as modified", async () => {
    const dir = tempDir();
    const filePath = join(dir, "existing.txt");
    await Bun.write(filePath, "hello");
    const ended: SessionData[] = [];
    const handlers = createHookHandlers({ onSessionEnd: (d) => ended.push(d) });

    await handlers.event({
      event: { type: "session.created", ...sessionCreatedEvent({ id: "sess-write-modify" }) } as EventSessionCreated,
    });
    await handlers.toolBefore(
      { tool: "write", sessionID: "sess-write-modify", callID: "c1" } as Parameters<typeof handlers.toolBefore>[0],
      { args: { filePath } } as Parameters<typeof handlers.toolBefore>[1]
    );
    await handlers.toolAfter(
      { tool: "write", sessionID: "sess-write-modify", callID: "c1", args: { filePath } } as Parameters<typeof handlers.toolAfter>[0],
      {} as Parameters<typeof handlers.toolAfter>[1]
    );
    await handlers.event({ event: sessionIdleEvent("sess-write-modify") as EventSessionIdle });

    expect(ended.length).toBe(1);
    expect(ended[0].fileActivity.length).toBe(1);
    expect(ended[0].fileActivity[0].action).toBe("modified");
  });

  test("edit classifies filePath as modified", async () => {
    const dir = tempDir();
    const filePath = join(dir, "edited.txt");
    const ended: SessionData[] = [];
    const handlers = createHookHandlers({ onSessionEnd: (d) => ended.push(d) });

    await handlers.event({
      event: { type: "session.created", ...sessionCreatedEvent({ id: "sess-edit" }) } as EventSessionCreated,
    });
    await handlers.toolAfter(
      { tool: "edit", sessionID: "sess-edit", callID: "c1", args: { filePath } } as Parameters<typeof handlers.toolAfter>[0],
      {} as Parameters<typeof handlers.toolAfter>[1]
    );
    await handlers.event({ event: sessionIdleEvent("sess-edit") as EventSessionIdle });

    expect(ended[0].fileActivity.length).toBe(1);
    expect(ended[0].fileActivity[0].action).toBe("modified");
    expect(ended[0].fileActivity[0].tool).toBe("edit");
  });

  test("apply_patch delete is classified as deleted", async () => {
    const dir = tempDir();
    const filePath = join(dir, "gone.txt");
    const ended: SessionData[] = [];
    const handlers = createHookHandlers({ onSessionEnd: (d) => ended.push(d) });

    await handlers.event({
      event: { type: "session.created", ...sessionCreatedEvent({ id: "sess-patch" }) } as EventSessionCreated,
    });
    await handlers.toolAfter(
      { tool: "apply_patch", sessionID: "sess-patch", callID: "c1", args: {} } as Parameters<typeof handlers.toolAfter>[0],
      {
        metadata: { files: [{ filePath, type: "delete" }] },
      } as Parameters<typeof handlers.toolAfter>[1]
    );
    await handlers.event({ event: sessionIdleEvent("sess-patch") as EventSessionIdle });

    expect(ended[0].fileActivity.length).toBe(1);
    expect(ended[0].fileActivity[0].action).toBe("deleted");
    expect(ended[0].fileActivity[0].tool).toBe("apply_patch");
  });

  test("bash rm -rf is classified as deleted", async () => {
    const ended: SessionData[] = [];
    const handlers = createHookHandlers({ onSessionEnd: (d) => ended.push(d) });

    await handlers.event({
      event: { type: "session.created", ...sessionCreatedEvent({ id: "sess-bash" }) } as EventSessionCreated,
    });
    await handlers.toolAfter(
      { tool: "bash", sessionID: "sess-bash", callID: "c1", args: { command: "rm -rf x.txt" } } as Parameters<typeof handlers.toolAfter>[0],
      {} as Parameters<typeof handlers.toolAfter>[1]
    );
    await handlers.event({ event: sessionIdleEvent("sess-bash") as EventSessionIdle });

    expect(ended[0].fileActivity.length).toBe(1);
    expect(ended[0].fileActivity[0].action).toBe("deleted");
    expect(ended[0].fileActivity[0].tool).toBe("bash");
  });

  test("task without filePath produces no file activity but still emits tool.after", async () => {
    const events: Array<{ type: string }> = [];
    const ended: SessionData[] = [];
    const handlers = createHookHandlers({
      onEvent: (_sid, type) => events.push({ type }),
      onSessionEnd: (d) => ended.push(d),
    });

    await handlers.event({
      event: { type: "session.created", ...sessionCreatedEvent({ id: "sess-task" }) } as EventSessionCreated,
    });
    await handlers.toolBefore(
      { tool: "task", sessionID: "sess-task", callID: "c1" } as Parameters<typeof handlers.toolBefore>[0],
      {} as Parameters<typeof handlers.toolBefore>[1]
    );
    await handlers.toolAfter(
      { tool: "task", sessionID: "sess-task", callID: "c1", args: {} } as Parameters<typeof handlers.toolAfter>[0],
      {} as Parameters<typeof handlers.toolAfter>[1]
    );
    await handlers.event({ event: sessionIdleEvent("sess-task") as EventSessionIdle });

    expect(ended[0].fileActivity).toEqual([]);
    expect(events.some((e) => e.type === "tool.after")).toBe(true);
    expect(ended[0].subagentsUsed).toBe(1);
  });

  test("toolAfter with undefined output does not throw and produces no entries", async () => {
    const ended: SessionData[] = [];
    const handlers = createHookHandlers({ onSessionEnd: (d) => ended.push(d) });

    await handlers.event({
      event: { type: "session.created", ...sessionCreatedEvent({ id: "sess-null-output" }) } as EventSessionCreated,
    });
    await handlers.toolAfter(
      { tool: "bash", sessionID: "sess-null-output", callID: "c1", args: {} } as Parameters<typeof handlers.toolAfter>[0],
      undefined as unknown as Parameters<typeof handlers.toolAfter>[1]
    );
    await handlers.event({ event: sessionIdleEvent("sess-null-output") as EventSessionIdle });

    expect(ended.length).toBe(1);
    expect(ended[0].fileActivity).toEqual([]);
  });

  test("write without toolBefore snapshot falls back to modified", async () => {
    const dir = tempDir();
    const filePath = join(dir, "no-snapshot.txt");
    const ended: SessionData[] = [];
    const handlers = createHookHandlers({ onSessionEnd: (d) => ended.push(d) });

    await handlers.event({
      event: { type: "session.created", ...sessionCreatedEvent({ id: "sess-no-snapshot" }) } as EventSessionCreated,
    });
    await handlers.toolAfter(
      { tool: "write", sessionID: "sess-no-snapshot", callID: "c1", args: { filePath } } as Parameters<typeof handlers.toolAfter>[0],
      {} as Parameters<typeof handlers.toolAfter>[1]
    );
    await handlers.event({ event: sessionIdleEvent("sess-no-snapshot") as EventSessionIdle });

    expect(ended.length).toBe(1);
    expect(ended[0].fileActivity.length).toBe(1);
    expect(ended[0].fileActivity[0].action).toBe("modified");
  });
});

describe("hook error logging", () => {
  test("onSessionEnd callback failure is logged via injected logger", async () => {
    const error = vi.fn();
    const fakeLogger = { error } as unknown as Logger;
    const handlers = createHookHandlers(
      {
        onSessionEnd: () => {
          throw new Error("cb");
        },
      },
      fakeLogger,
    );

    await handlers.event({ event: { type: "session.created", ...sessionCreatedEvent({ id: "s1" }) } as EventSessionCreated });
    await handlers.event({ event: sessionIdleEvent("s1") as EventSessionIdle });

    expect(error.mock.calls.length).toBe(1);
    expect(error.mock.calls[0][0]).toBe("onSessionEnd callback threw");
  });
});

describe("task delegation capture", () => {
  test("tool.before for task persists capped args", async () => {
    const events: Array<{ type: string; data: Record<string, unknown> }> = [];
    const handlers = createHookHandlers({
      onEvent: (_sid, type, data) => events.push({ type, data }),
    });

    await handlers.toolBefore(
      { tool: "task", sessionID: "sess-parent", callID: "c1" } as Parameters<typeof handlers.toolBefore>[0],
      {
        args: {
          category: "visual-engineering",
          load_skills: ["frontend"],
          prompt: "x".repeat(1000),
        },
      } as Parameters<typeof handlers.toolBefore>[1]
    );

    const before = events.find((e) => e.type === "tool.before");
    expect(before).toBeDefined();
    const args = before!.data.args as Record<string, unknown>;
    expect(args.category).toBe("visual-engineering");
    expect(args.load_skills).toEqual(["frontend"]);
    expect((args.prompt as string).length).toBeLessThan(1000);
  });

  test("tool.after for task persists childSessionID from metadata", async () => {
    const events: Array<{ type: string; data: Record<string, unknown> }> = [];
    const handlers = createHookHandlers({
      onEvent: (_sid, type, data) => events.push({ type, data }),
    });

    await handlers.toolAfter(
      { tool: "task", sessionID: "sess-parent", callID: "c1", args: { category: "deep" } } as Parameters<typeof handlers.toolAfter>[0],
      { metadata: { sessionId: "child-1" } } as Parameters<typeof handlers.toolAfter>[1]
    );

    const after = events.find((e) => e.type === "tool.after");
    expect(after).toBeDefined();
    expect(after!.data.childSessionID).toBe("child-1");
    expect((after!.data.args as Record<string, unknown>).category).toBe("deep");
  });

  test("non-task tools do not carry args or childSessionID", async () => {
    const events: Array<{ type: string; data: Record<string, unknown> }> = [];
    const handlers = createHookHandlers({
      onEvent: (_sid, type, data) => events.push({ type, data }),
    });

    await handlers.toolBefore(
      { tool: "read", sessionID: "s", callID: "c" } as Parameters<typeof handlers.toolBefore>[0],
      { args: { filePath: "/x" } } as Parameters<typeof handlers.toolBefore>[1]
    );
    await handlers.toolAfter(
      { tool: "read", sessionID: "s", callID: "c", args: { filePath: "/x" } } as Parameters<typeof handlers.toolAfter>[0],
      {} as Parameters<typeof handlers.toolAfter>[1]
    );

    const before = events.find((e) => e.type === "tool.before");
    const after = events.find((e) => e.type === "tool.after");
    expect(before!.data.args).toBeUndefined();
    expect(after!.data.args).toBeUndefined();
    expect(after!.data.childSessionID).toBeUndefined();
  });
});

describe("session.diff accounting", () => {
  interface TestSessionDiff {
    type: "session.diff";
    properties: { sessionID: string; diff: Array<{ file?: string; additions: number; deletions: number }> };
  }

  function diffEvent(sessionID: string, diff: TestSessionDiff["properties"]["diff"]): TestSessionDiff {
    return { type: "session.diff", properties: { sessionID, diff } };
  }

  async function endWithDiffs(diffs: TestSessionDiff["properties"]["diff"][]): Promise<SessionData> {
    const ended: SessionData[] = [];
    const handlers = createHookHandlers({ onSessionEnd: (data) => ended.push(data) });

    await handlers.event({
      event: { type: "session.created", ...sessionCreatedEvent({ id: "s" }) },
    } as unknown as Parameters<typeof handlers.event>[0]);

    for (const diff of diffs) {
      await handlers.event({
        event: diffEvent("s", diff),
      } as unknown as Parameters<typeof handlers.event>[0]);
    }

    await handlers.event({
      event: sessionIdleEvent("s"),
    } as unknown as Parameters<typeof handlers.event>[0]);

    return ended[0]!;
  }

  test("a re-emitted snapshot does not inflate additions and deletions", async () => {
    // opencode reports the session's diff so far, so a.ts comes back with the
    // same cumulative counts once b.ts is edited. Summing every row would give
    // 10 + (10 + 5) = 25 additions instead of 15.
    const data = await endWithDiffs([
      [{ file: "a.ts", additions: 10, deletions: 2 }],
      [
        { file: "a.ts", additions: 10, deletions: 2 },
        { file: "b.ts", additions: 5, deletions: 0 },
      ],
    ]);

    expect(data.additions).toBe(15);
    expect(data.deletions).toBe(2);
    expect(data.filesTouched.sort()).toEqual(["a.ts", "b.ts"]);
  });

  test("a growing count for the same file replaces the previous one", async () => {
    const data = await endWithDiffs([
      [{ file: "a.ts", additions: 4, deletions: 1 }],
      [{ file: "a.ts", additions: 9, deletions: 3 }],
    ]);

    expect(data.additions).toBe(9);
    expect(data.deletions).toBe(3);
    expect(data.filesTouched).toEqual(["a.ts"]);
  });

  test("a diff entry without a path is skipped, not counted as undefined", async () => {
    // SnapshotFileDiff.file is optional in the SDK; the old code pushed
    // undefined into filesTouched, which serialised as null.
    const data = await endWithDiffs([
      [
        { additions: 7, deletions: 7 },
        { file: "a.ts", additions: 1, deletions: 0 },
      ],
    ]);

    expect(data.filesTouched).toEqual(["a.ts"]);
    expect(data.additions).toBe(1);
    expect(data.deletions).toBe(0);
  });
});

describe("session.ended payload", () => {
  test("carries a summary, not the whole session", async () => {
    // session.idle fires once per assistant turn, and the events table has no
    // retention — writing the full sessionData here duplicated every prompt,
    // step and tool timing into events on each turn.
    const events: Array<{ type: string; data: Record<string, unknown> }> = [];
    const handlers = createHookHandlers({
      onEvent: (_sid, type, data) => events.push({ type, data }),
    });

    await handlers.event({
      event: { type: "session.created", ...sessionCreatedEvent({ id: "s" }) },
    } as unknown as Parameters<typeof handlers.event>[0]);
    await handlers.chatMessage(
      chatMessageInput({ sessionID: "s", role: "user", text: "segredo do usuario" }) as Parameters<typeof handlers.chatMessage>[0],
      { parts: [{ type: "text", text: "segredo do usuario" }] } as Parameters<typeof handlers.chatMessage>[1]
    );
    await handlers.event({
      event: sessionIdleEvent("s"),
    } as unknown as Parameters<typeof handlers.event>[0]);

    const ended = events.find((e) => e.type === "session.ended");
    expect(ended).toBeDefined();

    for (const heavy of ["steps", "toolTimings", "fileActivity", "filesTouched"]) {
      expect(ended!.data).not.toHaveProperty(heavy);
    }
    expect(JSON.stringify(ended!.data)).not.toContain("segredo do usuario");

    // The summary still answers "what happened in this session".
    expect(ended!.data.sessionID).toBe("s");
    expect(ended!.data.status).toBe("idle");
    expect(ended!.data.messages).toBe(1);
  });
});

describe("message.updated accounting", () => {
  function assistantMessage(input: {
    sessionID: string;
    id: string;
    completed?: boolean;
    tokens?: { input?: number; output?: number; reasoning?: number; cache?: { read?: number; write?: number } };
    cost?: number;
    modelID?: string;
    providerID?: string;
    role?: string;
    error?: { name: string; data?: { message?: string } };
  }) {
    return {
      type: "message.updated",
      properties: {
        info: {
          id: input.id,
          sessionID: input.sessionID,
          role: input.role ?? "assistant",
          modelID: input.modelID,
          providerID: input.providerID,
          time: input.completed === false ? {} : { completed: Date.now() },
          tokens: input.tokens,
          cost: input.cost ?? 0,
          error: input.error,
        },
      },
    };
  }

  async function run(
    messages: Array<ReturnType<typeof assistantMessage>>
  ): Promise<{ ended: SessionData; events: Array<{ type: string; data: Record<string, unknown> }> }> {
    const ended: SessionData[] = [];
    const events: Array<{ type: string; data: Record<string, unknown> }> = [];
    const handlers = createHookHandlers({
      onSessionEnd: (data) => ended.push(data),
      onEvent: (_sid, type, data) => events.push({ type, data }),
    });

    await handlers.event({
      event: { type: "session.created", ...sessionCreatedEvent({ id: "s" }) },
    } as unknown as Parameters<typeof handlers.event>[0]);
    for (const m of messages) {
      await handlers.event({ event: m } as unknown as Parameters<typeof handlers.event>[0]);
    }
    await handlers.event({
      event: sessionIdleEvent("s"),
    } as unknown as Parameters<typeof handlers.event>[0]);

    return { ended: ended[0]!, events };
  }

  test("accumulates tokens and cost across completed assistant messages", async () => {
    const { ended } = await run([
      assistantMessage({
        sessionID: "s",
        id: "m1",
        modelID: "opus",
        providerID: "anthropic",
        tokens: { input: 100, output: 10, reasoning: 5, cache: { read: 40, write: 2 } },
        cost: 0.5,
      }),
      assistantMessage({
        sessionID: "s",
        id: "m2",
        tokens: { input: 200, output: 20, reasoning: 1, cache: { read: 10, write: 3 } },
        cost: 0.25,
      }),
    ]);

    expect(ended.inputTokens).toBe(300);
    expect(ended.outputTokens).toBe(30);
    expect(ended.reasoningTokens).toBe(6);
    expect(ended.cacheReadTokens).toBe(50);
    expect(ended.cacheWriteTokens).toBe(5);
    expect(ended.cost).toBeCloseTo(0.75, 5);
    expect(ended.model).toBe("opus");
    expect(ended.provider).toBe("anthropic");
    expect(ended.costSource).toBe("opencode");
  });

  test("the same messageID arriving twice is counted once", async () => {
    const message = assistantMessage({ sessionID: "s", id: "m1", tokens: { input: 100 }, cost: 0.5 });
    const { ended, events } = await run([message, message, message]);

    expect(ended.inputTokens).toBe(100);
    expect(ended.cost).toBeCloseTo(0.5, 5);
    expect(events.filter((e) => e.type === "message.updated")).toHaveLength(1);
  });

  test("ignores non-assistant roles and messages that have not completed", async () => {
    const { ended, events } = await run([
      assistantMessage({ sessionID: "s", id: "u1", role: "user", tokens: { input: 999 }, cost: 9 }),
      assistantMessage({ sessionID: "s", id: "m1", completed: false, tokens: { input: 500 }, cost: 5 }),
    ]);

    expect(ended.inputTokens).toBe(0);
    expect(ended.cost).toBe(0);
    expect(events.filter((e) => e.type === "message.updated")).toHaveLength(0);
  });

  test("emits message.error once per failing message, even before it completes", async () => {
    const failing = assistantMessage({
      sessionID: "s",
      id: "m1",
      completed: false,
      error: { name: "ProviderAuthError", data: { message: "no key" } },
    });
    const { events } = await run([failing, failing]);

    const errors = events.filter((e) => e.type === "message.error");
    expect(errors).toHaveLength(1);
    expect(errors[0]!.data.error).toEqual({ name: "ProviderAuthError", message: "no key" });
  });
});

describe("message.part.updated", () => {
  function partEvent(part: Record<string, unknown>) {
    return { type: "message.part.updated", properties: { part: { sessionID: "s", ...part } } };
  }

  async function run(parts: Array<Record<string, unknown>>, startedAt: number): Promise<SessionData> {
    const ended: SessionData[] = [];
    const handlers = createHookHandlers({ onSessionEnd: (data) => ended.push(data) });

    await handlers.event({
      event: { type: "session.created", ...sessionCreatedEvent({ id: "s", created: startedAt }) },
    } as unknown as Parameters<typeof handlers.event>[0]);
    for (const part of parts) {
      await handlers.event({ event: partEvent(part) } as unknown as Parameters<typeof handlers.event>[0]);
    }
    await handlers.event({
      event: sessionIdleEvent("s"),
    } as unknown as Parameters<typeof handlers.event>[0]);

    return ended[0]!;
  }

  test("pairs step-start with step-finish and numbers the steps in order", async () => {
    const data = await run(
      [
        { type: "step-start" },
        { type: "step-finish", reason: "tool-calls", cost: 0.1, tokens: { input: 10, output: 2, cache: { read: 1 } } },
        { type: "step-start" },
        { type: "step-finish", reason: "stop", cost: 0.2, tokens: { input: 20, output: 4 } },
      ],
      Date.now()
    );

    expect(data.steps).toHaveLength(2);
    const [first, second] = data.steps as Array<{
      stepNumber: number;
      finishReason: string;
      cost: number;
      tokens: { input: number; output: number; reasoning: number; cacheRead: number; cacheWrite: number };
    }>;
    expect(first.stepNumber).toBe(1);
    expect(first.finishReason).toBe("tool-calls");
    expect(first.tokens).toEqual({ input: 10, output: 2, reasoning: 0, cacheRead: 1, cacheWrite: 0 });
    expect(second.stepNumber).toBe(2);
    expect(second.finishReason).toBe("stop");
    expect(second.cost).toBeCloseTo(0.2, 5);
  });

  test("time to first token comes from the first text part only", async () => {
    const startedAt = Date.now() - 10_000;
    const data = await run(
      [
        { type: "text", time: { start: startedAt + 1_500 } },
        { type: "text", time: { start: startedAt + 9_000 } },
      ],
      startedAt
    );

    expect(data.ttftMs).toBe(1_500);
  });

  test("a text part with no start time leaves ttft unset", async () => {
    const data = await run([{ type: "text" }], Date.now());
    expect(data.ttftMs).toBeNull();
  });
});

describe("pass-through events", () => {
  async function emitted(event: Record<string, unknown>): Promise<Array<{ type: string; data: Record<string, unknown> }>> {
    const events: Array<{ type: string; data: Record<string, unknown> }> = [];
    const handlers = createHookHandlers({ onEvent: (_sid, type, data) => events.push({ type, data }) });
    await handlers.event({ event } as unknown as Parameters<typeof handlers.event>[0]);
    return events;
  }

  test("permission.updated becomes permission.asked", async () => {
    const events = await emitted({ type: "permission.updated", properties: { sessionID: "s", key: "bash" } });
    expect(events).toEqual([{ type: "permission.asked", data: { sessionID: "s", key: "bash" } }]);
  });

  test("permission.replied carries the reply", async () => {
    const events = await emitted({
      type: "permission.replied",
      properties: { sessionID: "s", permissionID: "p1", response: "always" },
    });
    expect(events).toEqual([
      { type: "permission.replied", data: { sessionID: "s", key: "p1", reply: "always" } },
    ]);
  });

  test("command.executed carries the command name", async () => {
    const events = await emitted({ type: "command.executed", properties: { sessionID: "s", name: "/compact" } });
    expect(events).toEqual([{ type: "command.executed", data: { sessionID: "s", command: "/compact" } }]);
  });

  test("todo, tui and lsp events are forwarded", async () => {
    expect(await emitted({ type: "todo.updated", properties: { sessionID: "s" } })).toEqual([
      { type: "todo.updated", data: { sessionID: "s" } },
    ]);
    expect(await emitted({ type: "tui.command.execute", properties: { command: "quit" } })).toEqual([
      { type: "tui.command", data: { command: "quit" } },
    ]);
    expect(await emitted({ type: "tui.toast.show", properties: { title: "done" } })).toEqual([
      { type: "tui.toast", data: { title: "done" } },
    ]);
    expect(await emitted({ type: "lsp.client.diagnostics", properties: { path: "/a.ts" } })).toEqual([
      { type: "lsp.diagnostics", data: { file: "/a.ts" } },
    ]);
    expect(await emitted({ type: "file.edited", properties: { file: "/a.ts" } })).toEqual([
      { type: "file.edited", data: { file: "/a.ts" } },
    ]);
  });

  test("session.updated refreshes the title", async () => {
    const ended: SessionData[] = [];
    const handlers = createHookHandlers({ onSessionEnd: (data) => ended.push(data) });

    await handlers.event({
      event: { type: "session.created", ...sessionCreatedEvent({ id: "s", title: "old" }) },
    } as unknown as Parameters<typeof handlers.event>[0]);
    await handlers.event({
      event: { type: "session.updated", properties: { info: { id: "s", title: "new" } } },
    } as unknown as Parameters<typeof handlers.event>[0]);
    await handlers.event({
      event: sessionIdleEvent("s"),
    } as unknown as Parameters<typeof handlers.event>[0]);

    expect(ended[0]!.title).toBe("new");
  });

  test("session.deleted forgets the session, so a later idle persists nothing", async () => {
    // The state used to stay in memory for the life of the process, and a
    // stray session.idle afterwards would write a session the user deleted.
    const ended: SessionData[] = [];
    const events: Array<{ type: string; data: Record<string, unknown> }> = [];
    const handlers = createHookHandlers({
      onSessionEnd: (data) => ended.push(data),
      onEvent: (_sid, type, data) => events.push({ type, data }),
    });

    await handlers.event({
      event: { type: "session.created", ...sessionCreatedEvent({ id: "s" }) },
    } as unknown as Parameters<typeof handlers.event>[0]);
    await handlers.event({
      event: { type: "session.deleted", properties: { info: { id: "s" } } },
    } as unknown as Parameters<typeof handlers.event>[0]);
    await handlers.event({
      event: sessionIdleEvent("s"),
    } as unknown as Parameters<typeof handlers.event>[0]);

    expect(events.some((e) => e.type === "session.deleted" && e.data.sessionID === "s")).toBe(true);
    expect(ended).toHaveLength(0);
  });

  test("session.compacted increments the compaction count", async () => {
    const ended: SessionData[] = [];
    const handlers = createHookHandlers({ onSessionEnd: (data) => ended.push(data) });

    await handlers.event({
      event: { type: "session.created", ...sessionCreatedEvent({ id: "s" }) },
    } as unknown as Parameters<typeof handlers.event>[0]);
    for (let i = 0; i < 3; i++) {
      await handlers.event({
        event: { type: "session.compacted", properties: { sessionID: "s" } },
      } as unknown as Parameters<typeof handlers.event>[0]);
    }
    await handlers.event({
      event: sessionIdleEvent("s"),
    } as unknown as Parameters<typeof handlers.event>[0]);

    expect(ended[0]!.compactionCount).toBe(3);
  });
});

describe("session.diff event payload", () => {
  test("keeps the counts and drops the file contents", async () => {
    // FileDiff carries `before` and `after` — the whole file on both sides —
    // and the event is re-emitted on every edit, so this used to write entire
    // source files into the events table over and over.
    const events: Array<{ type: string; data: Record<string, unknown> }> = [];
    const handlers = createHookHandlers({
      onEvent: (_sid, type, data) => events.push({ type, data }),
    });

    await handlers.event({
      event: { type: "session.created", ...sessionCreatedEvent({ id: "s" }) },
    } as unknown as Parameters<typeof handlers.event>[0]);
    await handlers.event({
      event: {
        type: "session.diff",
        properties: {
          sessionID: "s",
          diff: [
            {
              file: "a.ts",
              before: "SEGREDO ANTES DA EDICAO",
              after: "SEGREDO DEPOIS DA EDICAO",
              additions: 3,
              deletions: 1,
            },
          ],
        },
      },
    } as unknown as Parameters<typeof handlers.event>[0]);

    const diffEvent = events.find((e) => e.type === "session.diff");
    expect(diffEvent).toBeDefined();
    expect(diffEvent!.data.diff).toEqual([{ file: "a.ts", additions: 3, deletions: 1 }]);

    const serialised = JSON.stringify(diffEvent!.data);
    expect(serialised).not.toContain("SEGREDO");
    expect(serialised).not.toContain("before");
    expect(serialised).not.toContain("after");
  });

  test("a user prompt never reaches the collected session data", async () => {
    const ended: SessionData[] = [];
    const events: Array<{ type: string; data: Record<string, unknown> }> = [];
    const handlers = createHookHandlers({
      onSessionEnd: (data) => ended.push(data),
      onEvent: (_sid, type, data) => events.push({ type, data }),
    });

    await handlers.event({
      event: { type: "session.created", ...sessionCreatedEvent({ id: "s" }) },
    } as unknown as Parameters<typeof handlers.event>[0]);
    await handlers.chatMessage(
      chatMessageInput({ sessionID: "s", role: "user", text: "MINHA SENHA E HUNTER2" }) as Parameters<typeof handlers.chatMessage>[0],
      { parts: [{ type: "text", text: "MINHA SENHA E HUNTER2" }] } as Parameters<typeof handlers.chatMessage>[1]
    );
    await handlers.event({
      event: sessionIdleEvent("s"),
    } as unknown as Parameters<typeof handlers.event>[0]);

    // The message still counts; its text is simply never kept.
    expect(ended[0]!.messages).toBe(1);
    expect(JSON.stringify(ended[0])).not.toContain("HUNTER2");
    expect(JSON.stringify(events)).not.toContain("HUNTER2");
  });
});

describe("duration accounting", () => {
  test("measures from the first activity, not from session.created", async () => {
    // session.created carries the time the row was created — which for the
    // first turn included however long the user spent typing. duration_ms is
    // active time; wall clock is wall_ms, computed at write time.
    const ended: SessionData[] = [];
    const handlers = createHookHandlers({ onSessionEnd: (data) => ended.push(data) });

    const createdLongAgo = Date.now() - 3_600_000;
    await handlers.event({
      event: { type: "session.created", ...sessionCreatedEvent({ id: "s", created: createdLongAgo }) },
    } as unknown as Parameters<typeof handlers.event>[0]);

    await handlers.chatMessage(
      chatMessageInput({ sessionID: "s", role: "user", text: "oi" }) as Parameters<typeof handlers.chatMessage>[0],
      {} as Parameters<typeof handlers.chatMessage>[1]
    );
    await handlers.event({
      event: sessionIdleEvent("s"),
    } as unknown as Parameters<typeof handlers.event>[0]);

    // Seconds of work, not the hour the session row had been sitting there.
    expect(ended[0]!.durationMs).toBeLessThan(60_000);
    expect(ended[0]!.startedAt).toBe(createdLongAgo);
  });

  test("a session that never did anything reports zero, not an hour", async () => {
    const ended: SessionData[] = [];
    const handlers = createHookHandlers({ onSessionEnd: (data) => ended.push(data) });

    await handlers.event({
      event: { type: "session.created", ...sessionCreatedEvent({ id: "s", created: Date.now() - 3_600_000 }) },
    } as unknown as Parameters<typeof handlers.event>[0]);
    await handlers.event({
      event: sessionIdleEvent("s"),
    } as unknown as Parameters<typeof handlers.event>[0]);

    expect(ended[0]!.durationMs).toBe(0);
  });
});
