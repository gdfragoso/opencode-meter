import { describe, expect, it, mock } from "bun:test";
import { Database } from "bun:sqlite";
import type { Logger } from "@/shared/logging";
import { initSchema } from "@/data/db/migrations";

function fakeLogger(): Logger & { error: ReturnType<typeof mock> } {
  return {
    log: mock(() => {}),
    debug: mock(() => {}),
    info: mock(() => {}),
    warn: mock(() => {}),
    error: mock(() => {}),
  };
}

describe("initSchema indexes", () => {
  function indexNames(db: Database, table: string): string[] {
    return db
      .query<{ name: string }, []>(`SELECT name FROM sqlite_master WHERE type = 'index' AND tbl_name = '${table}'`)
      .all()
      .map((r) => r.name);
  }

  it("indexes the sessions columns every dashboard query filters on", () => {
    const db = new Database(":memory:");
    initSchema(db);

    const names = indexNames(db, "sessions");
    expect(names).toContain("idx_sessions_started");
    expect(names).toContain("idx_sessions_project");
    expect(names).toContain("idx_sessions_parent");

    db.close();
  });

  it("is idempotent \u2014 a second run over the same database is a no-op", () => {
    const db = new Database(":memory:");
    initSchema(db);
    const before = indexNames(db, "sessions").sort();

    expect(() => initSchema(db)).not.toThrow();
    expect(indexNames(db, "sessions").sort()).toEqual(before);

    db.close();
  });
});

describe("initSchema error-path logging", () => {
  it("logs via injected logger when schema init fails", () => {
    const db = new Database(":memory:");
    db.close();
    const logger = fakeLogger();

    expect(() => initSchema(db, logger)).toThrow();

    expect(logger.error).toHaveBeenCalledTimes(1);
    expect(logger.error.mock.calls[0]?.[0]).toBe("Failed to initialize schema");
  });
});

describe("initSchema clears out the pre-release behaviour experiment", () => {
  function userTables(db: Database): string[] {
    return db
      .query<{ name: string }, []>(
        `SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'`
      )
      .all()
      .map((r) => r.name)
      .sort();
  }

  function columns(db: Database, table: string): string[] {
    return db
      .query<{ name: string }, []>(`PRAGMA table_xinfo(${table})`)
      .all()
      .map((r) => r.name);
  }

  // Only a database from a pre-release checkout can be in this state — the
  // experiment was cut before v1.0.0. It is still the one state where the
  // database holds prompt text, so the drop has to keep working.
  it("removes behavior_metrics and the prompt column from a database that had them", () => {
    const db = new Database(":memory:");

    // A database as it looked before the removal: current schema, plus the two
    // things that used to hold what the user typed.
    initSchema(db);
    db.run(`ALTER TABLE sessions ADD COLUMN user_messages TEXT`);
    db.run(`CREATE TABLE behavior_metrics (id INTEGER PRIMARY KEY, session_id TEXT, ts INTEGER)`);
    db.run(`INSERT INTO sessions (id, user_messages) VALUES ('s', '["texto do usuario"]')`);
    db.run(`INSERT INTO behavior_metrics (session_id, ts) VALUES ('s', 1)`);

    expect(columns(db, "sessions")).toContain("user_messages");
    expect(userTables(db)).toContain("behavior_metrics");

    initSchema(db);

    expect(userTables(db)).not.toContain("behavior_metrics");
    expect(columns(db, "sessions")).not.toContain("user_messages");
    // The session row survives — only the prompt text is gone.
    expect(db.query(`SELECT id FROM sessions WHERE id = 's'`).get()).toEqual({ id: "s" });

    db.close();
  });

  it("creates neither of them on a fresh database", () => {
    const db = new Database(":memory:");
    initSchema(db);

    expect(userTables(db)).toEqual(["daily_rollups", "events", "session_files", "sessions"]);
    expect(columns(db, "sessions")).not.toContain("user_messages");

    db.close();
  });
});
