import { describe, it, expect, beforeEach } from "bun:test";
import { Database } from "bun:sqlite";
import { initSchema } from "@/data/db/migrations";
import { insertSessionFiles } from "@/data/repositories/files";
import { createFilesRoute } from "@/api/routes/files";
import type { FileActivityEntry } from "@/collector/file-activity";

function createTestDb(): Database {
  const db = new Database(":memory:");
  initSchema(db);
  return db;
}

describe("GET /api/sessions/:id/files", () => {
  let db: Database;

  beforeEach(() => {
    db = createTestDb();
  });

  it("groups rows for all 4 actions into read/created/modified/deleted with correct counts", async () => {
    const entries: FileActivityEntry[] = [
      { path: "/a/read.ts", action: "read", tool: "read", ts: 1000, additions: 0, deletions: 0 },
      { path: "/a/read.ts", action: "read", tool: "read", ts: 2000, additions: 0, deletions: 0 },
      { path: "/b/created.ts", action: "created", tool: "write", ts: 1500, additions: 10, deletions: 0 },
      { path: "/c/modified.ts", action: "modified", tool: "edit", ts: 1700, additions: 3, deletions: 1 },
      { path: "/d/deleted.ts", action: "deleted", tool: "bash", ts: 1900, additions: 0, deletions: 5 },
    ];
    insertSessionFiles(db, "s1", entries);

    const app = createFilesRoute(() => db);
    const res = await app.request("/api/sessions/s1/files");
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body).toEqual({
      read: [{ path: "/a/read.ts", count: 2, tool: "read", lastTs: 2000, additions: 0, deletions: 0 }],
      created: [{ path: "/b/created.ts", count: 1, tool: "write", lastTs: 1500, additions: 10, deletions: 0 }],
      modified: [{ path: "/c/modified.ts", count: 1, tool: "edit", lastTs: 1700, additions: 3, deletions: 1 }],
      deleted: [{ path: "/d/deleted.ts", count: 1, tool: "bash", lastTs: 1900, additions: 0, deletions: 5 }],
    });
  });

  it("returns 200 with 4 empty arrays for a session with no data", async () => {
    const app = createFilesRoute(() => db);
    const res = await app.request("/api/sessions/s-nodata/files");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      read: [],
      created: [],
      modified: [],
      deleted: [],
    });
  });

  it("does not route an empty :id segment — 404, not 400, not a crash", async () => {
    const app = createFilesRoute(() => db);
    const res = await app.request("/api/sessions//files");
    expect(res.status).toBe(404);
  });

  it("discards unknown actions from the response", async () => {
    insertSessionFiles(db, "s1", [
      { path: "/a/read.ts", action: "read", tool: "read", ts: 1000, additions: 0, deletions: 0 },
    ]);
    db.run(
      "INSERT INTO session_files (session_id, path, action, tool, ts) VALUES ('s1','x.txt','unknown','bash',1)"
    );

    const app = createFilesRoute(() => db);
    const res = await app.request("/api/sessions/s1/files");
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body).toEqual({
      read: [{ path: "/a/read.ts", count: 1, tool: "read", lastTs: 1000, additions: 0, deletions: 0 }],
      created: [],
      modified: [],
      deleted: [],
    });
    expect(body.unknown).toBeUndefined();
  });

  it("excludes rows from other sessions (exact session_id match)", async () => {
    insertSessionFiles(db, "parent", [
      { path: "/p/read.ts", action: "read", tool: "read", ts: 1000, additions: 0, deletions: 0 },
    ]);
    insertSessionFiles(db, "child", [
      { path: "/c/created.ts", action: "created", tool: "write", ts: 2000, additions: 5, deletions: 0 },
    ]);

    const app = createFilesRoute(() => db);
    const res = await app.request("/api/sessions/parent/files");
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body).toEqual({
      read: [{ path: "/p/read.ts", count: 1, tool: "read", lastTs: 1000, additions: 0, deletions: 0 }],
      created: [],
      modified: [],
      deleted: [],
    });
  });
});
