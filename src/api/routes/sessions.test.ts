import { describe, it, expect, beforeEach } from "bun:test";
import { Database } from "bun:sqlite";
import { initSchema } from "@/data/db/migrations";
import { createSessionsRoute } from "@/api/routes/sessions";

function createTestDb(): Database {
  const db = new Database(":memory:");
  initSchema(db);
  return db;
}

function insertSession(
  db: Database,
  id: string,
  opts: { parentId?: string; startedAt?: number; cost?: number; agent?: string } = {}
): void {
  db.run(
    `INSERT INTO sessions (id, parent_id, started_at, total_cost, agent, messages_total, status)
     VALUES (?, ?, ?, ?, ?, 1, 'completed')`,
    [id, opts.parentId ?? null, opts.startedAt ?? 1000, opts.cost ?? 0, opts.agent ?? null]
  );
}

describe("GET /api/sessions/:id/tree", () => {
  let db: Database;
  let app: ReturnType<typeof createSessionsRoute>;

  beforeEach(() => {
    db = createTestDb();
    app = createSessionsRoute(() => db);
  });

  it("returns the delegation tree for a session", async () => {
    insertSession(db, "root", { startedAt: 1000, cost: 1 });
    insertSession(db, "child", { parentId: "root", startedAt: 2000, cost: 0.5, agent: "reviewer" });

    const res = await app.request("/api/sessions/root/tree");
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.root.id).toBe("root");
    expect(body.root.children.map((c: { id: string }) => c.id)).toEqual(["child"]);
    expect(body.root.subtree.cost).toBeCloseTo(1.5, 5);
    expect(body.ancestorId).toBe("root");
    expect(body.truncated).toBe(false);
  });

  it("404s for a session that does not exist", async () => {
    const res = await app.request("/api/sessions/missing/tree");

    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: "not_found" });
  });

  // /api/sessions/:id and /api/sessions/:id/tree differ by one segment; a
  // greedy pattern on the first would swallow the second.
  it("does not shadow GET /api/sessions/:id", async () => {
    insertSession(db, "root");

    const res = await app.request("/api/sessions/root");
    expect(res.status).toBe(200);
    expect((await res.json()).id).toBe("root");
  });
});
