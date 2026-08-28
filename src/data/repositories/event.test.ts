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
  });

  it("returns empty array when no tool.after events exist", () => {
    expect(findToolMetrics(db)).toEqual([]);
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

