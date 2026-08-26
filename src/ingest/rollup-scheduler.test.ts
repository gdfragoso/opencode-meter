import { describe, expect, mock, test } from "bun:test";
import { Database } from "bun:sqlite";
import { initSchema } from "@/data/db/migrations";
import type { Logger } from "@/shared/logging";
import { createRollupScheduler } from "./rollup-scheduler";

const DATE = "2026-03-04";
const DAY_START = Date.parse(`${DATE}T00:00:00Z`);

function seed(db: Database, sessionID: string, cost: number): void {
  db.run(
    `INSERT INTO sessions (id, started_at, duration_ms, total_cost, status, messages_total)
     VALUES (?, ?, 0, ?, 'idle', 1)`,
    [sessionID, DAY_START + 3_600_000, cost]
  );
}

function rollupOf(db: Database): { sessions: number; total_cost: number } | null {
  return (
    db
      .query<{ sessions: number; total_cost: number }, [string]>(
        "SELECT sessions, total_cost FROM daily_rollups WHERE date = ?"
      )
      .get(DATE) ?? null
  );
}

function newDb(): Database {
  const db = new Database(":memory:");
  initSchema(db);
  return db;
}

describe("createRollupScheduler", () => {
  test("does not write on schedule — the burst is collapsed into one flush", () => {
    const db = newDb();
    seed(db, "a", 1);
    const scheduler = createRollupScheduler(db, undefined, { delayMs: 60_000, registerExitFlush: false });

    scheduler.schedule(DATE);
    seed(db, "b", 2);
    scheduler.schedule(DATE);
    scheduler.schedule(DATE);

    expect(rollupOf(db)).toBeNull();
    expect(scheduler.pending()).toEqual([DATE]);

    scheduler.flush();

    // One write, and it sees both sessions — including the one added after the
    // first schedule() call, which the old inline write would have missed.
    expect(rollupOf(db)).toEqual({ sessions: 2, total_cost: 3 });
    expect(scheduler.pending()).toEqual([]);
    db.close();
  });

  test("writes every dirty day, not just the last one", () => {
    const db = newDb();
    seed(db, "a", 1);
    const scheduler = createRollupScheduler(db, undefined, { delayMs: 60_000, registerExitFlush: false });

    scheduler.schedule(DATE);
    scheduler.schedule("2026-03-05");
    expect(scheduler.pending().sort()).toEqual(["2026-03-04", "2026-03-05"]);

    scheduler.flush();

    const dates = db
      .query<{ date: string }, []>("SELECT date FROM daily_rollups ORDER BY date")
      .all()
      .map((r) => r.date);
    expect(dates).toEqual(["2026-03-04", "2026-03-05"]);
    db.close();
  });

  test("fires on its own once the delay elapses", async () => {
    const db = newDb();
    seed(db, "a", 1);
    const scheduler = createRollupScheduler(db, undefined, { delayMs: 5, registerExitFlush: false });

    scheduler.schedule(DATE);
    expect(rollupOf(db)).toBeNull();

    await new Promise((resolve) => setTimeout(resolve, 40));

    expect(rollupOf(db)?.sessions).toBe(1);
    db.close();
  });

  test("a failing write is logged, not thrown, and does not stick in the queue", () => {
    const db = newDb();
    db.close();
    const error = mock((..._args: unknown[]) => {});
    const logger = { error } as unknown as Logger;
    const scheduler = createRollupScheduler(db, logger, { delayMs: 60_000, registerExitFlush: false });

    scheduler.schedule(DATE);
    expect(() => scheduler.flush()).not.toThrow();

    expect(error).toHaveBeenCalledTimes(1);
    expect(error.mock.calls[0]?.[0]).toBe("Failed to roll up day");
    expect(scheduler.pending()).toEqual([]);
  });

  test("flush with nothing pending is a no-op", () => {
    const db = newDb();
    const scheduler = createRollupScheduler(db, undefined, { delayMs: 60_000, registerExitFlush: false });

    expect(() => scheduler.flush()).not.toThrow();
    expect(rollupOf(db)).toBeNull();
    db.close();
  });
});
