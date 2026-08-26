import { describe, it, expect, beforeEach } from "bun:test";
import { Database } from "bun:sqlite";
import { initSchema } from "@/data/db/migrations";
import { insertSessionFiles, findFilesBySession } from "@/data/repositories/files";
import type { FileActivityEntry } from "@/collector/file-activity";

function createTestDb(): Database {
  const db = new Database(":memory:");
  initSchema(db);
  return db;
}

describe("session_files schema", () => {
  it("initSchema runs twice without error and creates the 8 session_files columns", () => {
    const db = createTestDb();
    // Second run must be idempotent (CREATE TABLE IF NOT EXISTS + guarded ALTERs)
    expect(() => initSchema(db)).not.toThrow();

    const cols = db
      .query("PRAGMA table_info(session_files)")
      .all() as Array<{ name: string }>;
    expect(cols.map((c) => c.name)).toEqual([
      "id",
      "session_id",
      "path",
      "action",
      "tool",
      "ts",
      "additions",
      "deletions",
    ]);
  });
});

describe("insertSessionFiles", () => {
  let db: Database;

  beforeEach(() => {
    db = createTestDb();
  });

  it("does not throw when entries is empty", () => {
    expect(() => insertSessionFiles(db, "s-empty", [])).not.toThrow();
  });

  it("persists entries with invalid actions without validating them", () => {
    const invalid: FileActivityEntry = {
      path: "weird.txt",
      action: "unknown" as FileActivityEntry["action"],
      tool: "bash",
      ts: 5000,
    };
    insertSessionFiles(db, "s-invalid", [invalid]);

    const rows = db
      .query("SELECT * FROM session_files WHERE session_id = ?")
      .all("s-invalid") as Array<{ action: string }>;
    expect(rows).toHaveLength(1);
    expect(rows[0].action).toBe("unknown");
  });
});

describe("findFilesBySession", () => {
  let db: Database;

  beforeEach(() => {
    db = createTestDb();
  });

  it("aggregates by path+action with counts, lastTs, additions and deletions", () => {
    insertSessionFiles(db, "s1", [
      { path: "/a/read.ts", action: "read", tool: "read", ts: 1000, additions: 0, deletions: 0 },
      { path: "/a/read.ts", action: "read", tool: "read", ts: 2000, additions: 0, deletions: 0 },
      { path: "/b/created.ts", action: "created", tool: "write", ts: 1500, additions: 10, deletions: 0 },
    ]);

    const rows = findFilesBySession(db, "s1");

    expect(rows).toHaveLength(2);

    const read = rows.find((r) => r.path === "/a/read.ts");
    expect(read).toBeDefined();
    expect(read!.action).toBe("read");
    expect(read!.tool).toBe("read");
    expect(read!.count).toBe(2);
    expect(read!.lastTs).toBe(2000);
    expect(read!.additions).toBe(0);

    const created = rows.find((r) => r.path === "/b/created.ts");
    expect(created).toBeDefined();
    expect(created!.action).toBe("created");
    expect(created!.count).toBe(1);
    expect(created!.lastTs).toBe(1500);
    expect(created!.additions).toBe(10);
  });

  it("returns [] for a session with no entries", () => {
    expect(findFilesBySession(db, "s-nonexistent")).toEqual([]);
  });
});
