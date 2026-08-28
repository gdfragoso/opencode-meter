import { describe, it, expect, beforeEach, afterEach, spyOn } from "bun:test";
import { Database } from "bun:sqlite";
import { initSchema } from "@/data/db/migrations";
import { insertSessionFiles } from "@/data/repositories/files";
import { createCostRoute } from "@/api/routes/cost";

const NOW = 1_700_000_000_000;
const MS_PER_DAY = 86_400_000;

describe("GET /api/cost-efficiency", () => {
  let db: Database;
  let app: ReturnType<typeof createCostRoute>;
  let nowSpy: ReturnType<typeof spyOn>;

  beforeEach(() => {
    db = new Database(":memory:");
    initSchema(db);
    app = createCostRoute(() => db);
    nowSpy = spyOn(Date, "now").mockReturnValue(NOW);
  });

  afterEach(() => {
    nowSpy.mockRestore();
    db.close();
  });

  function session(id: string, startedAt: number, cost: number, directory?: string) {
    db.run(
      `INSERT INTO sessions (id, started_at, total_cost, agent, directory, messages_total, status)
       VALUES (?, ?, ?, 'builder', ?, 1, 'completed')`,
      [id, startedAt, cost, directory ?? null]
    );
    insertSessionFiles(db, id, [
      { path: `/${id}.ts`, action: "modified", tool: "edit", ts: startedAt, additions: 5, deletions: 1 },
    ]);
  }

  it("returns the ratios for the whole history by default", async () => {
    session("s1", NOW, 4);

    const res = await app.request("/api/cost-efficiency");
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.totalCost).toBeCloseTo(4, 5);
    expect(body.files).toBe(1);
    expect(body.costPerFile).toBeCloseTo(4, 5);
  });

  it("honours ?days=", async () => {
    session("old", NOW - 30 * MS_PER_DAY, 100);
    session("recent", NOW - MS_PER_DAY, 2);

    const body = await (await app.request("/api/cost-efficiency?days=7")).json();

    expect(body.totalCost).toBeCloseTo(2, 5);
    expect(body.files).toBe(1);
  });

  it("honours ?project=", async () => {
    session("a", NOW, 2, "/proj/a");
    session("b", NOW, 8, "/proj/b");

    const body = await (await app.request("/api/cost-efficiency?project=%2Fproj%2Fa")).json();

    expect(body.totalCost).toBeCloseTo(2, 5);
  });

  it("returns nulls rather than zeros for an empty database", async () => {
    const body = await (await app.request("/api/cost-efficiency")).json();

    expect(body.totalCost).toBe(0);
    expect(body.costPerFile).toBeNull();
    expect(body.costPerEdit).toBeNull();
  });
});
