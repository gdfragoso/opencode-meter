import { describe, it, expect, beforeEach, afterEach, spyOn } from "bun:test";
import { Database } from "bun:sqlite";
import { initSchema } from "@/data/db/migrations";
import { MS_PER_DAY, NOW, insertSession } from "@/data/repositories/session.test";

/* ── fixtures ──────────────────────────────────────────────────────────
   Live with the suite that owns the table they write to, so the other suites
   import them from here instead of each keeping a copy of the same INSERT.
   ─────────────────────────────────────────────────────────────────────── */

export function insertToolEvent(db: Database, sessionId: string, ts: number, tool: string) {
  db.run(
    `INSERT INTO events (ts, session_id, type, data) VALUES (?, ?, ?, ?)`,
    [ts, sessionId, "tool.after", JSON.stringify({ tool })]
  );
}

export function insertSkillEvent(
  db: Database,
  sessionId: string,
  ts: number,
  name: string,
  type: "skills.called" | "skills.loaded"
) {
  const data = type === "skills.called" ? { name } : { skills: [name] };
  db.run(
    `INSERT INTO events (ts, session_id, type, data) VALUES (?, ?, ?, ?)`,
    [ts, sessionId, type, JSON.stringify(data)]
  );
}

// Fixtures for the events table, kept with the suite that owns it.
import { countEventsBefore, deleteEventsBefore, deriveSessionDiff, findSkillsAggregated, findToolMetrics, findToolsOverview, insert as insertEvent } from "@/data/repositories/event";

function createTestDb(): Database {
  const db = new Database(":memory:");
  initSchema(db);
  return db;
}

function insertSessionTotals(
  db: Database,
  id: string,
  data: { input_tokens?: number; output_tokens?: number; total_cost?: number }
): void {
  db.run(
    `INSERT INTO sessions (id, input_tokens, output_tokens, total_cost) VALUES (?, ?, ?, ?)`,
    [id, data.input_tokens ?? 0, data.output_tokens ?? 0, data.total_cost ?? 0]
  );
}

export function insertEventRaw(
  db: Database,
  ts: number,
  sessionID: string,
  type: string,
  data: Record<string, unknown>
): void {
  db.run(
    `INSERT INTO events (ts, session_id, type, data) VALUES (?, ?, ?, ?)`,
    [ts, sessionID, type, JSON.stringify(data)]
  );
}

describe("findSkillsAggregated", () => {
  let db: Database;

  beforeEach(() => {
    db = createTestDb();
  });

  it("filters skills by project and branch via session subselect", () => {
    const now = Date.now();

    // Session in /foo on main
    db.run(
      `INSERT INTO sessions (id, input_tokens, output_tokens, total_cost, directory, branch) VALUES (?, 0, 0, 0, ?, ?)`,
      ["session-foo-main", "/foo", "main"]
    );
    // Session in /bar on develop
    db.run(
      `INSERT INTO sessions (id, input_tokens, output_tokens, total_cost, directory, branch) VALUES (?, 0, 0, 0, ?, ?)`,
      ["session-bar-dev", "/bar", "develop"]
    );

    // Session in /foo on main calls skill "reader"
    insertEventRaw(db, now, "session-foo-main", "skills.called", { name: "reader" });
    insertEventRaw(db, now, "session-foo-main", "skills.loaded", { skills: ["writer"] });

    // Session in /bar on develop calls skill "debugger"
    insertEventRaw(db, now, "session-bar-dev", "skills.called", { name: "debugger" });
    insertEventRaw(db, now, "session-bar-dev", "skills.loaded", { skills: ["formatter"] });

    // No filter — all skills returned
    const all = findSkillsAggregated(db);
    expect(all).toHaveLength(4);
    const allNames = all.map((r) => r.name).sort();
    expect(allNames).toEqual(["debugger", "formatter", "reader", "writer"]);

    // Filter by project: only /foo skills returned
    const fooSkills = findSkillsAggregated(db, null, "/foo");
    expect(fooSkills).toHaveLength(2);
    expect(fooSkills.map((r) => r.name).sort()).toEqual(["reader", "writer"]);

    // Filter by project + branch: only /foo + main
    const fooMain = findSkillsAggregated(db, null, "/foo", "main");
    expect(fooMain).toHaveLength(2);
    expect(fooMain.map((r) => r.name).sort()).toEqual(["reader", "writer"]);

    // Filter by project + branch that doesn't match: empty
    const fooDevelop = findSkillsAggregated(db, null, "/foo", "develop");
    expect(fooDevelop).toHaveLength(0);
  });

  it("returns empty array when no skill events exist", () => {
    expect(findSkillsAggregated(db)).toEqual([]);
  });
});

describe("findToolMetrics", () => {
  let db: Database;

  beforeEach(() => {
    db = createTestDb();
  });

  it("aggregates per-tool metrics from tool.before/tool.after pairs and step events", () => {
    const now = Date.now();
    insertSessionTotals(db, "session-1", { input_tokens: 100, output_tokens: 50, total_cost: 0.123 });

    // Step window (1ms) contained in every tool window below → ratio = 1.0
    insertEventRaw(db, now + 50, "session-1", "step.start", { step: 1 });
    insertEventRaw(db, now + 51, "session-1", "step.finish", {
      step: 1,
      tokens: { input: 100, output: 50 },
      cost: 0.123,
    });

    // tool-a call 1: duration 100ms
    insertEventRaw(db, now, "session-1", "tool.before", { tool: "tool-a", callID: "call-a-1" });
    insertEventRaw(db, now + 100, "session-1", "tool.after", { tool: "tool-a", callID: "call-a-1" });

    // tool-a call 2: duration 200ms
    insertEventRaw(db, now, "session-1", "tool.before", { tool: "tool-a", callID: "call-a-2" });
    insertEventRaw(db, now + 200, "session-1", "tool.after", { tool: "tool-a", callID: "call-a-2" });

    // tool-b call: duration 300ms
    insertEventRaw(db, now, "session-1", "tool.before", { tool: "tool-b", callID: "call-b-1" });
    insertEventRaw(db, now + 300, "session-1", "tool.after", { tool: "tool-b", callID: "call-b-1" });

    const rows = findToolMetrics(db);

    expect(rows).toHaveLength(2);
    const toolA = rows.find((r) => r.tool === "tool-a");
    const toolB = rows.find((r) => r.tool === "tool-b");

    expect(toolA).toBeDefined();
    expect(toolA!.calls).toBe(2);
    expect(toolA!.avg_duration_ms).toBeCloseTo(150, 5);
    // 2 calls × 1.0 overlap × 150 step tokens = 300
    expect(toolA!.total_tokens).toBe(300);
    // 2 calls × 1.0 overlap × 0.123 step cost = 0.246
    expect(toolA!.total_cost).toBeCloseTo(0.246, 5);

    expect(toolB).toBeDefined();
    expect(toolB!.calls).toBe(1);
    expect(toolB!.avg_duration_ms).toBeCloseTo(300, 5);
    // 1 call × 1.0 overlap × 150 step tokens = 150
    expect(toolB!.total_tokens).toBe(150);
    // 1 call × 1.0 overlap × 0.123 step cost = 0.123
    expect(toolB!.total_cost).toBeCloseTo(0.123, 5);
  });

  it("distributes step tokens proportionally across multiple tool events in one session", () => {
    const base = 1_000_000;
    insertSessionTotals(db, "session-2", { input_tokens: 10, output_tokens: 5, total_cost: 0.5 });

    // Step covers the full 300ms tool sequence; each tool call takes 1/3
    insertEventRaw(db, base, "session-2", "step.start", { step: 1 });
    insertEventRaw(db, base + 300, "session-2", "step.finish", {
      step: 1,
      tokens: { input: 10, output: 5 },
      cost: 0.5,
    });

    // 3 tool-c calls, each 100ms, non-overlapping, together covering the step
    insertEventRaw(db, base, "session-2", "tool.before", { tool: "tool-c", callID: "call-c-1" });
    insertEventRaw(db, base + 100, "session-2", "tool.after", { tool: "tool-c", callID: "call-c-1" });

    insertEventRaw(db, base + 100, "session-2", "tool.before", { tool: "tool-c", callID: "call-c-2" });
    insertEventRaw(db, base + 200, "session-2", "tool.after", { tool: "tool-c", callID: "call-c-2" });

    insertEventRaw(db, base + 200, "session-2", "tool.before", { tool: "tool-c", callID: "call-c-3" });
    insertEventRaw(db, base + 300, "session-2", "tool.after", { tool: "tool-c", callID: "call-c-3" });

    const rows = findToolMetrics(db);

    expect(rows).toHaveLength(1);
    // Each call overlaps 100/300 of the step: 3 × (1/3 × 15) = 15
    expect(rows[0].total_tokens).toBe(15);
    // Each call: 3 × (1/3 × 0.5) = 0.5
    expect(rows[0].total_cost).toBeCloseTo(0.5, 5);
    expect(rows[0].calls).toBe(3);
  });

  it("filters events by days parameter", () => {
    const now = Date.now();
    const eightDaysAgo = now - 8 * 86400000;
    const fiveDaysAgo = now - 5 * 86400000;

    insertSessionTotals(db, "session-old", { input_tokens: 1000, output_tokens: 500, total_cost: 1.0 });
    insertSessionTotals(db, "session-new", { input_tokens: 100, output_tokens: 50, total_cost: 0.1 });

    // Old session: tool + step (all filtered out by days=7)
    insertEventRaw(db, eightDaysAgo + 50, "session-old", "step.start", { step: 1 });
    insertEventRaw(db, eightDaysAgo + 51, "session-old", "step.finish", {
      step: 1,
      tokens: { input: 1000, output: 500 },
      cost: 1.0,
    });
    insertEventRaw(db, eightDaysAgo, "session-old", "tool.before", {
      tool: "old-tool",
      callID: "old-call",
    });
    insertEventRaw(db, eightDaysAgo + 100, "session-old", "tool.after", {
      tool: "old-tool",
      callID: "old-call",
    });

    // New session: tool + step (within days=7 window)
    insertEventRaw(db, fiveDaysAgo + 50, "session-new", "step.start", { step: 1 });
    insertEventRaw(db, fiveDaysAgo + 51, "session-new", "step.finish", {
      step: 1,
      tokens: { input: 100, output: 50 },
      cost: 0.1,
    });
    insertEventRaw(db, fiveDaysAgo, "session-new", "tool.before", {
      tool: "new-tool",
      callID: "new-call",
    });
    insertEventRaw(db, fiveDaysAgo + 100, "session-new", "tool.after", {
      tool: "new-tool",
      callID: "new-call",
    });

    const rows = findToolMetrics(db, 7);

    expect(rows).toHaveLength(1);
    expect(rows[0].tool).toBe("new-tool");
    expect(rows[0].calls).toBe(1);
    expect(rows[0].total_cost).toBeCloseTo(0.1, 5);
  });

  it("returns empty array when no tool.after events exist", () => {
    expect(findToolMetrics(db)).toEqual([]);
  });

  it("pairs repeated step numbers by occurrence order (multi-agent sessions)", () => {
    const base = 2_000_000;
    insertSessionTotals(db, "session-3", { input_tokens: 100, output_tokens: 50, total_cost: 1.0 });

    // Two agents in the same session both run "step 1" (real opencode data shape).
    // Agent A: step 1 runs [base+100, base+200] with 10 tokens.
    // Agent B: step 1 runs [base+300, base+400] with 20 tokens.
    insertEventRaw(db, base + 100, "session-3", "step.start", { step: 1 });
    insertEventRaw(db, base + 200, "session-3", "step.finish", {
      step: 1,
      tokens: { input: 5, output: 5 },
      cost: 0.1,
    });
    insertEventRaw(db, base + 300, "session-3", "step.start", { step: 1 });
    insertEventRaw(db, base + 400, "session-3", "step.finish", {
      step: 1,
      tokens: { input: 10, output: 10 },
      cost: 0.2,
    });

    // Tool overlaps only agent A's step window [base+100, base+200]
    insertEventRaw(db, base + 150, "session-3", "tool.before", { tool: "tool-x", callID: "call-x-1" });
    insertEventRaw(db, base + 180, "session-3", "tool.after", { tool: "tool-x", callID: "call-x-1" });

    const rows = findToolMetrics(db);
    const toolX = rows.find((r) => r.tool === "tool-x");

    // 30ms overlap of agent A's 100ms step → 10 × 0.3 = 3 tokens.
    // A naive join on (session_id, step) would also fabricate a [100,400]
    // window (agent A start × agent B finish) and inflate this value.
    expect(toolX).toBeDefined();
    expect(toolX!.total_tokens).toBe(3);
    expect(toolX!.total_cost).toBeCloseTo(0.03, 5);
  });

  it("distributes tokens across two consecutive steps via the sliding window", () => {
    const base = 3_000_000;
    insertSessionTotals(db, "session-4", { input_tokens: 100, output_tokens: 50, total_cost: 1.0 });

    // Step 1: [base, base+100] with 10 tokens; step 2: [base+100, base+200] with 20 tokens.
    insertEventRaw(db, base, "session-4", "step.start", { step: 1 });
    insertEventRaw(db, base + 100, "session-4", "step.finish", {
      step: 1,
      tokens: { input: 5, output: 5 },
      cost: 0.1,
    });
    insertEventRaw(db, base + 100, "session-4", "step.start", { step: 2 });
    insertEventRaw(db, base + 200, "session-4", "step.finish", {
      step: 2,
      tokens: { input: 10, output: 10 },
      cost: 0.2,
    });

    // Tool spans both steps: [base+50, base+150] → 50ms of step 1 + 50ms of step 2.
    insertEventRaw(db, base + 50, "session-4", "tool.before", { tool: "tool-y", callID: "call-y-1" });
    insertEventRaw(db, base + 150, "session-4", "tool.after", { tool: "tool-y", callID: "call-y-1" });

    const rows = findToolMetrics(db);
    const toolY = rows.find((r) => r.tool === "tool-y");

    // (0.5 × 10) + (0.5 × 20) = 15 tokens; (0.5 × 0.1) + (0.5 × 0.2) = 0.15
    expect(toolY).toBeDefined();
    expect(toolY!.total_tokens).toBe(15);
    expect(toolY!.total_cost).toBeCloseTo(0.15, 5);
  });


  it("orders results by total_cost descending", () => {
    const now = Date.now();
    insertSessionTotals(db, "session-cheap", { input_tokens: 10, output_tokens: 5, total_cost: 0.01 });
    insertSessionTotals(db, "session-expensive", { input_tokens: 1000, output_tokens: 500, total_cost: 9.99 });

    // Cheap tool + step
    insertEventRaw(db, now + 50, "session-cheap", "step.start", { step: 1 });
    insertEventRaw(db, now + 51, "session-cheap", "step.finish", {
      step: 1,
      tokens: { input: 10, output: 5 },
      cost: 0.01,
    });
    insertEventRaw(db, now, "session-cheap", "tool.before", {
      tool: "cheap-tool",
      callID: "cheap-call",
    });
    insertEventRaw(db, now + 200, "session-cheap", "tool.after", {
      tool: "cheap-tool",
      callID: "cheap-call",
    });

    // Expensive tool + step
    insertEventRaw(db, now + 1050, "session-expensive", "step.start", { step: 1 });
    insertEventRaw(db, now + 1051, "session-expensive", "step.finish", {
      step: 1,
      tokens: { input: 1000, output: 500 },
      cost: 9.99,
    });
    insertEventRaw(db, now + 1000, "session-expensive", "tool.before", {
      tool: "expensive-tool",
      callID: "expensive-call",
    });
    insertEventRaw(db, now + 1200, "session-expensive", "tool.after", {
      tool: "expensive-tool",
      callID: "expensive-call",
    });

    const rows = findToolMetrics(db);

    expect(rows).toHaveLength(2);
    expect(rows[0].tool).toBe("expensive-tool");
    expect(rows[1].tool).toBe("cheap-tool");
  });
});

describe("deriveSessionDiff", () => {
  function diffEvent(db: Database, sessionID: string, diff: unknown): void {
    insertEvent(db, sessionID, "session.diff", { sessionID, diff } as Record<string, unknown>);
  }

  it("keeps only the last row per file instead of summing every emission", () => {
    const db = createTestDb();
    diffEvent(db, "s", [{ file: "a.ts", additions: 10, deletions: 2 }]);
    diffEvent(db, "s", [
      { file: "a.ts", additions: 10, deletions: 2 },
      { file: "b.ts", additions: 5, deletions: 0 },
    ]);

    expect(deriveSessionDiff(db, "s")).toEqual({
      additions: 15,
      deletions: 2,
      filesTouched: expect.arrayContaining(["a.ts", "b.ts"]),
    });
    db.close();
  });

  it("takes the latest count when a file keeps growing", () => {
    const db = createTestDb();
    diffEvent(db, "s", [{ file: "a.ts", additions: 4, deletions: 1 }]);
    diffEvent(db, "s", [{ file: "a.ts", additions: 9, deletions: 3 }]);

    expect(deriveSessionDiff(db, "s")).toEqual({ additions: 9, deletions: 3, filesTouched: ["a.ts"] });
    db.close();
  });

  it("skips entries with no file path", () => {
    const db = createTestDb();
    diffEvent(db, "s", [
      { additions: 7, deletions: 7 },
      { file: "a.ts", additions: 1, deletions: 0 },
    ]);

    expect(deriveSessionDiff(db, "s")).toEqual({ additions: 1, deletions: 0, filesTouched: ["a.ts"] });
    db.close();
  });

  it("returns zeroes for a missing, empty or absent diff", () => {
    const db = createTestDb();
    const empty = { additions: 0, deletions: 0, filesTouched: [] };

    expect(deriveSessionDiff(db, "never-seen")).toEqual(empty);

    diffEvent(db, "s", undefined);
    diffEvent(db, "s", []);
    expect(deriveSessionDiff(db, "s")).toEqual(empty);
    db.close();
  });

  it("does not mix sessions", () => {
    const db = createTestDb();
    diffEvent(db, "s1", [{ file: "a.ts", additions: 1, deletions: 0 }]);
    diffEvent(db, "s2", [{ file: "b.ts", additions: 100, deletions: 50 }]);

    expect(deriveSessionDiff(db, "s1")).toEqual({ additions: 1, deletions: 0, filesTouched: ["a.ts"] });
    db.close();
  });
});

describe("event pruning", () => {
  const DAY = 86_400_000;

  function seedEvent(db: Database, sessionID: string, ts: number, payload: string): void {
    db.run(`INSERT INTO events (ts, session_id, type, data) VALUES (?, ?, 'tool.after', ?)`, [
      ts,
      sessionID,
      JSON.stringify({ tool: payload }),
    ]);
  }

  it("counts only what is older than the cutoff", () => {
    const db = createTestDb();
    const now = Date.now();
    seedEvent(db, "s", now - 10 * DAY, "velho-1");
    seedEvent(db, "s", now - 9 * DAY, "velho-2");
    seedEvent(db, "s", now - 1 * DAY, "novo");

    const cutoff = now - 5 * DAY;
    const { rows, bytes, oldestTs } = countEventsBefore(db, cutoff);

    expect(rows).toBe(2);
    expect(bytes).toBeGreaterThan(0);
    expect(oldestTs).toBe(now - 10 * DAY);
    db.close();
  });

  it("deletes only the old rows and reports how many", () => {
    const db = createTestDb();
    const now = Date.now();
    seedEvent(db, "s", now - 10 * DAY, "velho");
    seedEvent(db, "s", now - 1 * DAY, "novo");

    const deleted = deleteEventsBefore(db, now - 5 * DAY);

    expect(deleted).toBe(1);
    const left = db.query<{ n: number }, []>(`SELECT COUNT(*) AS n FROM events`).get();
    expect(left?.n).toBe(1);
    db.close();
  });

  it("leaves the aggregates alone", () => {
    const db = createTestDb();
    const now = Date.now();
    db.run(`INSERT INTO sessions (id, started_at, total_cost) VALUES ('s', ?, 1.5)`, [now - 10 * DAY]);
    db.run(`INSERT INTO session_files (session_id, path, action, tool, ts) VALUES ('s', 'a.ts', 'modified', 'edit', ?)`, [now - 10 * DAY]);
    db.run(`INSERT INTO daily_rollups (date, sessions) VALUES ('2020-01-01', 3)`);
    seedEvent(db, "s", now - 10 * DAY, "velho");

    deleteEventsBefore(db, now - 5 * DAY);

    expect(db.query<{ n: number }, []>(`SELECT COUNT(*) AS n FROM sessions`).get()?.n).toBe(1);
    expect(db.query<{ n: number }, []>(`SELECT COUNT(*) AS n FROM session_files`).get()?.n).toBe(1);
    expect(db.query<{ n: number }, []>(`SELECT COUNT(*) AS n FROM daily_rollups`).get()?.n).toBe(1);
    expect(db.query<{ n: number }, []>(`SELECT COUNT(*) AS n FROM events`).get()?.n).toBe(0);
    db.close();
  });

  it("reports nothing to do when every event is recent", () => {
    const db = createTestDb();
    seedEvent(db, "s", Date.now(), "novo");

    expect(countEventsBefore(db, Date.now() - 5 * DAY)).toEqual({ rows: 0, bytes: 0, oldestTs: null });
    expect(deleteEventsBefore(db, Date.now() - 5 * DAY)).toBe(0);
    db.close();
  });
});

describe("findToolsOverview and the day window", () => {
  let db: Database;
  let nowSpy: ReturnType<typeof spyOn>;

  beforeEach(() => {
    db = new Database(":memory:");
    initSchema(db);
    // Frozen clock: the fixtures place sessions relative to NOW and the day
    // filters compare against Date.now().
    nowSpy = spyOn(Date, "now").mockReturnValue(NOW);
  });

  afterEach(() => {
    nowSpy.mockRestore();
    db.close();
  });

  describe("event repository findToolsOverview", () => {
    it("counts all tool events when days is null", () => {
      insertSession(db, "old-session", NOW - 30 * MS_PER_DAY);
      insertSession(db, "recent-session", NOW - 1 * MS_PER_DAY);
      insertToolEvent(db, "old-session", NOW - 30 * MS_PER_DAY, "tool-a");
      insertToolEvent(db, "recent-session", NOW - 1 * MS_PER_DAY, "tool-a");

      const rows = findToolsOverview(db, 10, null);
      expect(rows.find((r) => r.name === "tool-a")?.count).toBe(2);
    });

    it("counts only tool events within the requested window", () => {
      insertSession(db, "old-session", NOW - 30 * MS_PER_DAY);
      insertSession(db, "recent-session", NOW - 1 * MS_PER_DAY);
      insertToolEvent(db, "old-session", NOW - 30 * MS_PER_DAY, "tool-a");
      insertToolEvent(db, "recent-session", NOW - 1 * MS_PER_DAY, "tool-a");

      const rows = findToolsOverview(db, 10, 7);
      expect(rows.find((r) => r.name === "tool-a")?.count).toBe(1);
    });
  });
});

describe("findToolMetrics attributes cost to the session that spent it", () => {
  let db: Database;
  const T = 1_700_000_000_000;

  beforeEach(() => {
    db = createTestDb();
  });

  function step(sessionID: string, n: number, start: number, end: number, cost: number, tokens: number) {
    insertEventRaw(db, start, sessionID, "step.start", { step: n });
    insertEventRaw(db, end, sessionID, "step.finish", { step: n, cost, tokens: { input: tokens, output: 0 } });
  }

  function tool(sessionID: string, callID: string, name: string, start: number, end: number) {
    insertEventRaw(db, start, sessionID, "tool.before", { tool: name, callID });
    insertEventRaw(db, end, sessionID, "tool.after", { tool: name, callID });
  }

  /**
   * A parent blocked inside `task` while a subagent works. The two sessions
   * overlap in time completely, which is the normal shape of delegation — and
   * exactly the shape that used to make the numbers wrong.
   */
  function delegation() {
    insertSessionTotals(db, "parent", { total_cost: 10 });
    step("parent", 1, T, T + 10_000, 10, 1000);
    tool("parent", "c1", "task", T + 1_000, T + 9_000);

    insertSessionTotals(db, "child", { total_cost: 7 });
    step("child", 1, T + 2_000, T + 8_000, 7, 700);
    tool("child", "c2", "edit", T + 3_000, T + 7_000);
  }

  // The subagent's step used to be distributed onto the parent's `task` call
  // purely because their timestamps overlapped, on top of the `edit` that
  // actually incurred it. `task` claimed $15 of a $17 total.
  it("does not charge the parent's task call for the subagent's spend", () => {
    delegation();

    const task = findToolMetrics(db).find(r => r.tool === "task")!;

    // 8s of the parent's own 10s step, and nothing from the child.
    expect(task.total_cost).toBeCloseTo(8, 4);
    expect(task.total_tokens).toBe(800);
  });

  it("charges the subagent's tool from the subagent's own step", () => {
    delegation();

    const edit = findToolMetrics(db).find(r => r.tool === "edit")!;

    // 4s of the child's own 6s step.
    expect(edit.total_cost).toBeCloseTo(4.6667, 3);
  });

  // The table is a breakdown of real spend, so it must never claim more than
  // was spent. Time nobody was inside a tool call is simply unattributed.
  it("never attributes more than was actually spent", () => {
    delegation();

    const attributed = findToolMetrics(db).reduce((sum, r) => sum + r.total_cost, 0);

    expect(attributed).toBeLessThanOrEqual(17);
  });

  it("keeps two unrelated concurrent sessions apart", () => {
    insertSessionTotals(db, "a", { total_cost: 4 });
    step("a", 1, T, T + 1_000, 4, 400);
    tool("a", "a1", "read", T, T + 1_000);

    insertSessionTotals(db, "b", { total_cost: 6 });
    step("b", 1, T, T + 1_000, 6, 600);
    tool("b", "b1", "grep", T, T + 1_000);

    const rows = findToolMetrics(db);

    expect(rows.find(r => r.tool === "read")!.total_cost).toBeCloseTo(4, 4);
    expect(rows.find(r => r.tool === "grep")!.total_cost).toBeCloseTo(6, 4);
  });
});
