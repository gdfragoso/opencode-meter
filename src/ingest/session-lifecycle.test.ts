import { describe, expect, mock, test } from "bun:test";
import { Database } from "bun:sqlite";
import { initSchema } from "@/data/db/migrations";
import type { Logger } from "@/shared/logging";
import type { SessionData } from "@/collector/session-state";
import { createSessionLifecycle } from "./session-lifecycle";

describe("createSessionLifecycle", () => {
  test("creates CollectorOptions with 4 callbacks", () => {
    const db = new Database(":memory:");
    initSchema(db);
    const lifecycle = createSessionLifecycle(db);
    expect(lifecycle).toHaveProperty("onSessionCreated");
    expect(lifecycle).toHaveProperty("onSessionActive");
    expect(lifecycle).toHaveProperty("onSessionEnd");
    expect(lifecycle).toHaveProperty("onEvent");
    expect(typeof lifecycle.onSessionCreated).toBe("function");
    expect(typeof lifecycle.onSessionActive).toBe("function");
    expect(typeof lifecycle.onSessionEnd).toBe("function");
    expect(typeof lifecycle.onEvent).toBe("function");
    db.close();
  });

  test("onSessionCreated inserts a session row", () => {
    const db = new Database(":memory:");
    initSchema(db);
    const lifecycle = createSessionLifecycle(db);
    lifecycle.onSessionCreated!({ sessionID: "test-1", startedAt: Date.now(), title: "Test Session" });
    const row = db.query("SELECT id, title, status FROM sessions WHERE id = ?").get("test-1") as any;
    expect(row).toBeTruthy();
    expect(row.id).toBe("test-1");
    expect(row.status).toBe("running");
    db.close();
  });

  test("onSessionActive updates session to running status", () => {
    const db = new Database(":memory:");
    initSchema(db);
    const lifecycle = createSessionLifecycle(db);
    lifecycle.onSessionCreated!({ sessionID: "test-2", startedAt: Date.now() });
    lifecycle.onSessionActive!({ sessionID: "test-2", title: "Active Session", agent: "test-agent" });
    const row = db.query("SELECT id, title, agent, status FROM sessions WHERE id = ?").get("test-2") as any;
    expect(row).toBeTruthy();
    expect(row.status).toBe("running");
    expect(row.agent).toBe("test-agent");
    db.close();
  });

  test("onSessionEnd persists session with counters", () => {
    const db = new Database(":memory:");
    initSchema(db);
    const lifecycle = createSessionLifecycle(db);
    lifecycle.onSessionCreated!({ sessionID: "test-3", startedAt: Date.now() });
    lifecycle.onSessionActive!({ sessionID: "test-3" });
    lifecycle.onSessionEnd!({
      sessionID: "test-3", startedAt: Date.now() - 60000, durationMs: 60000,
      status: "completed", inputTokens: 100, outputTokens: 50,
      cost: 0.01, model: "gpt-4", provider: "openai",
      agent: "test-agent", toolsUsed: 5, messages: 10,
      additions: 20, deletions: 5, fileActivity: [],
      steps: [], toolTimings: [], childSessionIDs: [], filesTouched: [],
      title: "Test", directory: null, branch: null, parentID: null,
      subagentsUsed: 0, cacheReadTokens: 0, cacheWriteTokens: 0,
      reasoningTokens: 0, costSource: "config",
      costBreakdown: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
      errorType: null, errorMessage: null, ttftMs: null,
      compactionCount: 0, sessionType: "main",
    } as any);
    const row = db.query("SELECT id, status, input_tokens, output_tokens, total_cost FROM sessions WHERE id = ?").get("test-3") as any;
    expect(row).toBeTruthy();
    expect(row.status).toBe("completed");
    db.close();
  });

  test("onEvent inserts an event row", () => {
    const db = new Database(":memory:");
    initSchema(db);
    const lifecycle = createSessionLifecycle(db);
    lifecycle.onEvent!("test-4", "tool_execute", { tool: "read" });
    const rows = db.query("SELECT id, session_id, type FROM events WHERE session_id = ?").all("test-4") as any[];
    expect(rows.length).toBeGreaterThan(0);
    expect(rows[0].type).toBe("tool_execute");
    db.close();
  });

  test("onSessionEnd appends routing label to subagent agent from parent task args", () => {
    const db = new Database(":memory:");
    initSchema(db);
    const lifecycle = createSessionLifecycle(db);

    // The parent's task tool.before fires before the child session is created,
    // so it is already persisted when the child ends.
    lifecycle.onEvent!("parent-1", "tool.before", {
      tool: "task",
      args: { category: "visual-engineering", prompt: "..." },
    });
    const childStartedAt = Date.now() + 1000;
    lifecycle.onSessionEnd!({
      sessionID: "child-1",
      startedAt: childStartedAt,
      durationMs: 60000,
      status: "completed",
      agent: "sisyphus-junior",
      parentID: "parent-1",
      model: "gpt-4",
      provider: "openai",
      sessionType: "subagent",
      toolsUsed: 3,
      messages: 5,
      subagentsUsed: 0,
      additions: 0,
      deletions: 0,
      fileActivity: [],
      steps: [],
      toolTimings: [],
      childSessionIDs: [],
      filesTouched: [],
      title: null,
      directory: null,
      branch: null,
      inputTokens: 0,
      outputTokens: 0,
      reasoningTokens: 0,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
      cost: 0,
      costSource: "opencode",
      costBreakdown: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
      errorType: null,
      errorMessage: null,
      ttftMs: null,
      compactionCount: 0,
    } as any);

    const row = db.query("SELECT agent FROM sessions WHERE id = ?").get("child-1") as { agent: string };
    expect(row.agent).toBe("sisyphus-junior - visual-engineering");
    db.close();
  });

  test("onSessionEnd leaves agent unchanged when routing label equals the agent", () => {
    const db = new Database(":memory:");
    initSchema(db);
    const lifecycle = createSessionLifecycle(db);

    // Vanilla opencode routes via subagent_type, which is the agent the child
    // runs as — appending it would produce "explore - explore".
    lifecycle.onEvent!("parent-2", "tool.before", {
      tool: "task",
      args: { subagent_type: "explore", prompt: "..." },
    });
    const childStartedAt = Date.now() + 1000;
    lifecycle.onSessionEnd!({
      sessionID: "child-2",
      startedAt: childStartedAt,
      durationMs: 60000,
      status: "completed",
      agent: "explore",
      parentID: "parent-2",
      model: "gpt-4",
      provider: "openai",
      sessionType: "subagent",
      toolsUsed: 3,
      messages: 5,
      subagentsUsed: 0,
      additions: 0,
      deletions: 0,
      fileActivity: [],
      steps: [],
      toolTimings: [],
      childSessionIDs: [],
      filesTouched: [],
      title: null,
      directory: null,
      branch: null,
      inputTokens: 0,
      outputTokens: 0,
      reasoningTokens: 0,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
      cost: 0,
      costSource: "opencode",
      costBreakdown: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
      errorType: null,
      errorMessage: null,
      ttftMs: null,
      compactionCount: 0,
    } as any);

    const row = db.query("SELECT agent FROM sessions WHERE id = ?").get("child-2") as { agent: string };
    expect(row.agent).toBe("explore");
    db.close();
  });

  test("additions and deletions survive a second session end without inflating", () => {
    // session.idle fires at the end of every assistant turn, so onSessionEnd
    // runs more than once per session, and opencode re-sends the session's
    // whole snapshot diff each time. Deriving the totals from the events makes
    // the write idempotent: summing gave 25 additions where 15 is correct.
    const db = new Database(":memory:");
    initSchema(db);
    const lifecycle = createSessionLifecycle(db);
    const startedAt = Date.now();

    lifecycle.onSessionCreated!({ sessionID: "diff-1", startedAt });

    lifecycle.onEvent!("diff-1", "session.diff", {
      sessionID: "diff-1",
      diff: [{ file: "a.ts", additions: 10, deletions: 2 }],
    });
    lifecycle.onSessionEnd!({
      ...emptySessionData("diff-1", startedAt),
      filesTouched: ["a.ts"],
      additions: 10,
      deletions: 2,
    });

    const afterFirst = db
      .query("SELECT additions, deletions, files_touched FROM sessions WHERE id = ?")
      .get("diff-1") as { additions: number; deletions: number; files_touched: string };
    expect(afterFirst.additions).toBe(10);
    expect(afterFirst.deletions).toBe(2);

    // Second turn: a.ts comes back unchanged, b.ts is new.
    lifecycle.onEvent!("diff-1", "session.diff", {
      sessionID: "diff-1",
      diff: [
        { file: "a.ts", additions: 10, deletions: 2 },
        { file: "b.ts", additions: 5, deletions: 0 },
      ],
    });
    lifecycle.onSessionEnd!({
      ...emptySessionData("diff-1", startedAt),
      filesTouched: ["a.ts", "b.ts"],
      additions: 15,
      deletions: 2,
    });

    const afterSecond = db
      .query("SELECT additions, deletions, files_touched FROM sessions WHERE id = ?")
      .get("diff-1") as { additions: number; deletions: number; files_touched: string };
    expect(afterSecond.additions).toBe(15);
    expect(afterSecond.deletions).toBe(2);
    expect(JSON.parse(afterSecond.files_touched).sort()).toEqual(["a.ts", "b.ts"]);

    db.close();
  });

  test("onSessionCreated logs via injected logger when persistence fails", () => {
    const db = new Database(":memory:");
    initSchema(db);
    db.close();
    const errorSpy = mock((..._args: unknown[]) => {});
    const fakeLogger = { error: errorSpy } as unknown as Logger;
    const lifecycle = createSessionLifecycle(db, fakeLogger);
    lifecycle.onSessionCreated!({ sessionID: "x", startedAt: Date.now() });
    expect(errorSpy).toHaveBeenCalledTimes(1);
    expect(errorSpy.mock.calls[0]?.[0]).toBe("Failed to set session parent");
  });
});

function emptySessionData(sessionID: string, startedAt: number): SessionData {
  return {
    sessionID,
    title: null,
    directory: null,
    branch: null,
    startedAt,
    status: "idle",
    agent: null,
    model: null,
    provider: null,
    durationMs: 0,
    toolsUsed: 0,
    subagentsUsed: 0,
    messages: 0,
    parentID: null,
    inputTokens: 0,
    outputTokens: 0,
    reasoningTokens: 0,
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
    cost: 0,
    costSource: "opencode",
    costBreakdown: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    ttftMs: null,
    steps: null,
    compactionCount: 0,
    errorType: null,
    errorMessage: null,
    filesTouched: [],
    fileActivity: [],
    additions: 0,
    deletions: 0,
    childSessionIDs: [],
    toolTimings: null,
    sessionType: "main",
  };
}
