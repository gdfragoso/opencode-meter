import { describe, it, expect, beforeEach, afterEach, spyOn } from "bun:test";
import { Database } from "bun:sqlite";
import { initSchema } from "@/data/db/migrations";
import { findDailyOnTheFly, upsertRollup } from "@/data/repositories/daily";
import { MS_PER_DAY, NOW, insertSession as insertSessionRow } from "@/data/repositories/session.test";

// Thin wrapper over the shared fixture: these suites group by
// started_at + duration_ms, so a session with a null duration would land on no
// day at all.
function insertSession(
  db: Database,
  id: string,
  startedAt: number,
  opts: Parameters<typeof insertSessionRow>[3] = {}
) {
  insertSessionRow(db, id, startedAt, { durationMs: 1000, ...opts });
}

describe("findDailyOnTheFly", () => {
  let db: Database;
  let nowSpy: ReturnType<typeof spyOn>;

  beforeEach(() => {
    db = new Database(":memory:");
    initSchema(db);
    nowSpy = spyOn(Date, "now").mockReturnValue(NOW);
  });

  afterEach(() => {
    nowSpy.mockRestore();
    db.close();
  });

  it("aggregates sessions for a single date", () => {
    insertSession(db, "s1", NOW, {
      inputTokens: 100,
      outputTokens: 50,
      totalCost: 1.5,
      durationMs: 5000,
      toolsTotal: 3,
    });

    const rows = findDailyOnTheFly(db, 30, null, null);
    expect(rows).toHaveLength(1);
    expect(rows[0].sessions).toBe(1);
    expect(rows[0].tokens_in).toBe(100);
    expect(rows[0].tokens_out).toBe(50);
    expect(rows[0].total_cost).toBeCloseTo(1.5, 5);
    expect(rows[0].tools_total).toBe(3);
    // Used to be "[]": the on-the-fly path returned empty aggregates while the
    // rollup table returned real ones, so the dashboard changed shape when a
    // project filter was applied.
    expect(JSON.parse(rows[0].models_used)).toHaveLength(1);
    expect(JSON.parse(rows[0].agents_used)).toHaveLength(1);
    // No tool.after events were inserted, so this one really is empty.
    expect(rows[0].top_tools).toBe("[]");
    expect(rows[0].avg_ttft_ms).toBeNull();
    expect(rows[0].active_minutes).toBe(0);
  });

  it("groups sessions by date", () => {
    insertSession(db, "s1", NOW, { durationMs: 5000 });
    insertSession(db, "s2", NOW - MS_PER_DAY, { durationMs: 5000 });

    const rows = findDailyOnTheFly(db, 30, null, null);
    expect(rows).toHaveLength(2);
  });

  it("filters by project directory", () => {
    insertSession(db, "s1", NOW, { directory: "/foo", durationMs: 5000, inputTokens: 100 });
    insertSession(db, "s2", NOW, { directory: "/bar", durationMs: 5000, inputTokens: 200 });

    const rows = findDailyOnTheFly(db, 30, "/foo", null);
    expect(rows).toHaveLength(1);
    expect(rows[0].tokens_in).toBe(100);
  });

  it("filters by branch", () => {
    insertSession(db, "s1", NOW, { branch: "main", durationMs: 5000, outputTokens: 10 });
    insertSession(db, "s2", NOW, { branch: "feature", durationMs: 5000, outputTokens: 20 });

    const rows = findDailyOnTheFly(db, 30, null, "main");
    expect(rows).toHaveLength(1);
    expect(rows[0].tokens_out).toBe(10);
  });

  it("filters by both project and branch", () => {
    insertSession(db, "s1", NOW, { directory: "/foo", branch: "main", durationMs: 5000, totalCost: 1 });
    insertSession(db, "s2", NOW, { directory: "/foo", branch: "feature", durationMs: 5000, totalCost: 2 });
    insertSession(db, "s3", NOW, { directory: "/bar", branch: "main", durationMs: 5000, totalCost: 3 });
    insertSession(db, "s4", NOW, { directory: "/bar", branch: "other", durationMs: 5000, totalCost: 4 });

    const rows = findDailyOnTheFly(db, 30, "/foo", "main");
    expect(rows).toHaveLength(1);
    expect(rows[0].sessions).toBe(1);
    expect(rows[0].total_cost).toBeCloseTo(1, 5);
  });

  it("counts errors_total with status='error'", () => {
    insertSession(db, "s1", NOW, { status: "error", durationMs: 5000 });
    insertSession(db, "s2", NOW, { durationMs: 5000 });

    const rows = findDailyOnTheFly(db, 30, null, null);
    expect(rows[0].errors_total).toBe(1);
  });

  it("counts errors_total with error_type IS NOT NULL but status != error", () => {
    insertSession(db, "s1", NOW, { status: "completed", errorType: "APIError", durationMs: 5000 });

    const rows = findDailyOnTheFly(db, 30, null, null);
    expect(rows[0].errors_total).toBe(1);
  });

  it("ignores clean sessions in errors_total", () => {
    insertSession(db, "s1", NOW, { durationMs: 5000 });

    const rows = findDailyOnTheFly(db, 30, null, null);
    expect(rows[0].errors_total).toBe(0);
  });

  it("returns no rows for non-matching project", () => {
    insertSession(db, "s1", NOW, { directory: "/foo", durationMs: 5000 });

    const rows = findDailyOnTheFly(db, 30, "/nonexistent", null);
    expect(rows).toHaveLength(0);
  });

  it("uses date from started_at + duration_ms for date grouping", () => {
    insertSession(db, "s1", NOW - 5000, { durationMs: 5000 }); // started_at + duration = NOW

    const rows = findDailyOnTheFly(db, 30, null, null);
    expect(rows).toHaveLength(1);
  });
});
describe("upsertRollup event window", () => {
  const DATE = "2026-03-04";
  const DAY_START = Date.parse(`${DATE}T00:00:00Z`);
  const DAY_END = DAY_START + MS_PER_DAY;

  function insertToolEvent(db: Database, ts: number, tool: string): void {
    db.run(`INSERT INTO events (ts, session_id, type, data) VALUES (?, 's', 'tool.after', ?)`, [
      ts,
      JSON.stringify({ tool }),
    ]);
  }

  it("counts exactly the UTC day, both edges included and excluded correctly", () => {
    // The window is half-open [00:00:00.000, next 00:00:00.000) so it matches
    // what date(ts / 1000, 'unixepoch') used to select — the point of the
    // rewrite was the query plan, not the result.
    const db = new Database(":memory:");
    initSchema(db);

    insertToolEvent(db, DAY_START - 1, "before-midnight");
    insertToolEvent(db, DAY_START, "first-ms");
    insertToolEvent(db, DAY_START + 12 * 3600_000, "midday");
    insertToolEvent(db, DAY_END - 1, "last-ms");
    insertToolEvent(db, DAY_END, "next-day");

    upsertRollup(db, DATE);

    const row = db
      .query<{ top_tools: string; active_minutes: number }, [string]>(
        "SELECT top_tools, active_minutes FROM daily_rollups WHERE date = ?"
      )
      .get(DATE)!;

    const tools = (JSON.parse(row.top_tools) as Array<{ tool: string }>).map((t) => t.tool).sort();
    expect(tools).toEqual(["first-ms", "last-ms", "midday"]);
    expect(row.active_minutes).toBe(3);

    db.close();
  });
});

describe("upsertRollup errors_total", () => {
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

  describe("daily rollup errors_total", () => {
    const ROLLUP_DATE = "2023-11-14";

    function errorsTotal(target: Database): number {
      const row = target
        .query<{ errors_total: number }, [string]>(
          "SELECT errors_total FROM daily_rollups WHERE date = ?"
        )
        .get(ROLLUP_DATE);
      return row?.errors_total ?? 0;
    }

    it("counts error_type-only sessions (status != error)", () => {
      insertSession(db, "err-typed", NOW, { status: "completed", errorType: "APIError", durationMs: 0 });
      upsertRollup(db, ROLLUP_DATE);

      expect(errorsTotal(db)).toBe(1);
    });

    it("counts status=error sessions", () => {
      insertSession(db, "err-status", NOW, { status: "error", durationMs: 0 });
      upsertRollup(db, ROLLUP_DATE);

      expect(errorsTotal(db)).toBe(1);
    });

    it("ignores clean sessions", () => {
      insertSession(db, "clean", NOW, { durationMs: 0 });
      upsertRollup(db, ROLLUP_DATE);

      expect(errorsTotal(db)).toBe(0);
    });
  });
});
