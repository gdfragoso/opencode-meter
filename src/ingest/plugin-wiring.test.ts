import { describe, expect, it, beforeEach, afterEach, spyOn, mock } from "bun:test";
import { Database } from "bun:sqlite";
import { initSchema } from "@/data/db/migrations";
import { NOW, insertSession, sessionCountersOf, sessionData } from "@/data/repositories/session.test";
import { insertEventRaw } from "@/data/repositories/event.test";
import { upsert } from "@/data/repositories/session";

// The only genuinely cross-layer suite: it loads plugin.ts and drives
// collector -> ingest -> data end to end, which is why it lives with the write
// side rather than next to any one module.

describe("plugin wiring: event-derived counters", () => {
  let db: Database;
  let nowSpy: ReturnType<typeof spyOn>;

  beforeEach(() => {
    db = new Database(":memory:");
    initSchema(db);
    // Frozen clock: every fixture places sessions relative to NOW, and the
    // day filters compare against Date.now().
    nowSpy = spyOn(Date, "now").mockReturnValue(NOW);
  });

  afterEach(() => {
    nowSpy.mockRestore();
    db.close();
  });

  describe("event-derived idempotent counters", () => {
    it("does not double counter columns when a session is upserted twice with identical data", () => {
      const data = sessionData({
        sessionID: "idem-1",
        inputTokens: 100,
        outputTokens: 50,
        reasoningTokens: 10,
        cacheReadTokens: 20,
        cacheWriteTokens: 5,
        cost: 1.25,
        toolsUsed: 4,
        subagentsUsed: 2,
        messages: 7,
      });

      upsert(db, data);
      upsert(db, data);
      const c = sessionCountersOf(db, "idem-1");
      expect(c.total_cost).toBeCloseTo(1.25, 5);
      expect(c.input_tokens).toBe(100);
      expect(c.output_tokens).toBe(50);
      expect(c.reasoning_tokens).toBe(10);
      expect(c.cache_read_tokens).toBe(20);
      expect(c.cache_write_tokens).toBe(5);
      expect(c.tools_total).toBe(4);
      expect(c.subagents_total).toBe(2);
      expect(c.messages_total).toBe(7);
    });

    it("deriveSessionCounters derives cost/tokens/tools/messages from events and subagents from child rows", async () => {
      insertEventRaw(db, NOW, "deriv-1", "message.updated", {
        messageID: "m1",
        role: "assistant",
        tokens: { input: 100, output: 50, reasoning: 10, cache: { read: 20, write: 5 } },
        cost: 0.5,
      });
      insertEventRaw(db, NOW, "deriv-1", "message.updated", {
        messageID: "m2",
        role: "assistant",
        tokens: { input: 200, output: 100, reasoning: 20, cache: { read: 40, write: 10 } },
        cost: 1.0,
      });
      // Duplicate messageID must be deduped (first row wins)
      insertEventRaw(db, NOW, "deriv-1", "message.updated", {
        messageID: "m1",
        role: "assistant",
        tokens: { input: 999, output: 999, reasoning: 999, cache: { read: 999, write: 999 } },
        cost: 99,
      });
      insertEventRaw(db, NOW, "deriv-1", "tool.after", { tool: "a" });
      insertEventRaw(db, NOW, "deriv-1", "tool.after", { tool: "b" });
      insertEventRaw(db, NOW, "deriv-1", "tool.after", { tool: "a" });
      insertSession(db, "deriv-child-1", NOW, { parentId: "deriv-1" });
      insertSession(db, "deriv-child-2", NOW, { parentId: "deriv-1" });
      // Unrelated session events must be ignored
      insertEventRaw(db, NOW, "other-session", "message.updated", {
        messageID: "x1",
        role: "assistant",
        tokens: { input: 5 },
        cost: 5,
      });
      insertEventRaw(db, NOW, "other-session", "tool.after", { tool: "z" });

      const { deriveSessionCounters } = await import("@/data/repositories/event");
      const c = deriveSessionCounters(db, "deriv-1");

      expect(c.cost).toBeCloseTo(1.5, 5);
      expect(c.costBreakdown).toEqual({ input: 0, output: 0, cacheRead: 0, cacheWrite: 0 });
      expect(c.inputTokens).toBe(300);
      expect(c.outputTokens).toBe(150);
      expect(c.reasoningTokens).toBe(30);
      expect(c.cacheReadTokens).toBe(60);
      expect(c.cacheWriteTokens).toBe(15);
      expect(c.toolsUsed).toBe(3);
      expect(c.messages).toBe(2);
      expect(c.subagentsUsed).toBe(2);
    });

    it("persists event-derived counters through the wired onSessionEnd handler when sessionData differs", async () => {
      mock.module("@/data/db/connection", () => ({
        getDb: () => db,
        registerCleanup: () => {},
        // The mock replaces the module for every later import in the run, so it
        // has to carry the whole shape — cli.ts reads DB_PATH from here.
        DB_PATH: ":memory:",
      }));

      const { default: plugin } = await import("@/../plugin");
      const hooks = await plugin.server({} as Parameters<typeof plugin.server>[0]);
      const emitEvent = hooks.event!;

      // Session created as a child of wire-root; collector state accumulates no
      // counters because the events below are written straight to the DB.
      await emitEvent({
        event: {
          type: "session.created",
          properties: { info: { id: "wire-1", parentID: "wire-root", time: { created: NOW } } },
        },
      } as unknown as Parameters<typeof emitEvent>[0]);

      insertEventRaw(db, NOW, "wire-1", "message.updated", {
        messageID: "w1",
        role: "assistant",
        tokens: { input: 200, output: 100, reasoning: 20, cache: { read: 40, write: 10 } },
        cost: 1.0,
      });
      insertEventRaw(db, NOW, "wire-1", "message.updated", {
        messageID: "w2",
        role: "assistant",
        tokens: { input: 100, output: 50, reasoning: 10, cache: { read: 20, write: 5 } },
        cost: 0.5,
      });
      insertEventRaw(db, NOW, "wire-1", "tool.after", { tool: "a" });
      insertEventRaw(db, NOW, "wire-1", "tool.after", { tool: "b" });
      insertEventRaw(db, NOW, "wire-1", "tool.after", { tool: "c" });
      // Child session rows make the derived subagents count observable.
      insertSession(db, "wire-1-child-1", NOW, { parentId: "wire-1" });
      insertSession(db, "wire-1-child-2", NOW, { parentId: "wire-1" });

      await emitEvent({
        event: { type: "session.idle", properties: { sessionID: "wire-1" } },
      } as unknown as Parameters<typeof emitEvent>[0]);

      const c = sessionCountersOf(db, "wire-1");
      expect(c.total_cost).toBeCloseTo(1.5, 5);
      expect(c.input_tokens).toBe(300);
      expect(c.output_tokens).toBe(150);
      expect(c.reasoning_tokens).toBe(30);
      expect(c.cache_read_tokens).toBe(60);
      expect(c.cache_write_tokens).toBe(15);
      expect(c.tools_total).toBe(3);
      expect(c.messages_total).toBe(2);
      expect(c.subagents_total).toBe(2);
      expect(c.session_type).toBe("subagent");
    });
  });
});

describe("plugin wiring: a step's cost reaches the per-tool breakdown", () => {
  let db: Database;
  let clockSpy: ReturnType<typeof spyOn>;

  beforeEach(() => {
    db = new Database(":memory:");
    initSchema(db);
    db.run(`INSERT INTO sessions (id, started_at, messages_total, status) VALUES ('s', ?, 1, 'completed')`, [NOW]);
    // A clock that advances on every read. Without it the whole exchange lands
    // in one millisecond, every span has zero duration, and nothing is
    // attributable to anything — which is true of the code and useless as a
    // test of it.
    let tick = NOW;
    clockSpy = spyOn(Date, "now").mockImplementation(() => (tick += 10));
  });

  afterEach(() => {
    clockSpy.mockRestore();
    db.close();
  });

  /** Drives the collector the way OpenCode does, into a real database. */
  async function record() {
    const { createHookHandlers } = await import("@/collector/hooks");
    const { insert } = await import("@/data/repositories/event");

    const handlers = createHookHandlers({
      onEvent: (sessionID, type, data) => insert(db, sessionID, type, data),
    });
    const ev = (e: unknown) => handlers.event({ event: e } as never);
    const part = (p: Record<string, unknown>) =>
      ev({ type: "message.part.updated", properties: { part: { sessionID: "s", ...p } } });

    await ev({ type: "session.created", properties: { info: { id: "s", time: { created: Date.now() } } } });
    await part({ type: "step-start" });
    await handlers.toolBefore?.({ tool: "read", sessionID: "s", callID: "c1" } as never, { args: {} } as never);
    await handlers.toolAfter?.({ tool: "read", sessionID: "s", callID: "c1" } as never, { title: "", output: "", metadata: {} } as never);
    await part({ type: "step-finish", reason: "stop", cost: 0.42, tokens: { input: 1000, output: 100 } });
  }

  // The whole ~Tokens / ~Cost column in Top Tools rests on these two keys being
  // present on the stored event. They were not: the collector captured cost and
  // tokens onto the session's `steps` and emitted an event without them, so
  // findToolMetrics scored every tool at zero and always had.
  it("writes cost and tokens onto the stored step.finish event", async () => {
    await record();

    const row = db.query<{ data: string }, []>(`SELECT data FROM events WHERE type = 'step.finish'`).get();
    const data = JSON.parse(row!.data) as { cost?: number; tokens?: { input: number; output: number } };

    expect(data.cost).toBeCloseTo(0.42, 5);
    expect(data.tokens).toEqual({ input: 1000, output: 100 });
  });

  it("gives the tool a non-zero cost once the event carries one", async () => {
    const { findToolMetrics } = await import("@/data/repositories/event");
    await record();

    const read = findToolMetrics(db, null).find((r) => r.tool === "read")!;

    expect(read.total_cost).toBeGreaterThan(0);
    expect(read.total_tokens).toBeGreaterThan(0);
  });
});
