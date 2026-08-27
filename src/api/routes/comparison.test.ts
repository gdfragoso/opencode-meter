import { describe, it, expect, beforeEach, afterEach, spyOn } from "bun:test";
import { Database } from "bun:sqlite";
import { initSchema } from "@/data/db/migrations";
import { createComparisonRoute } from "@/api/routes/comparison";

const NOW = 1_700_000_000_000;
const MS_PER_DAY = 86_400_000;

describe("GET /api/period-comparison", () => {
  let db: Database;
  let app: ReturnType<typeof createComparisonRoute>;
  let nowSpy: ReturnType<typeof spyOn>;

  beforeEach(() => {
    db = new Database(":memory:");
    initSchema(db);
    app = createComparisonRoute(() => db);
    nowSpy = spyOn(Date, "now").mockReturnValue(NOW);
  });

  afterEach(() => {
    nowSpy.mockRestore();
    db.close();
  });

  function session(id: string, startedAt: number, cost: number) {
    db.run(
      `INSERT INTO sessions (id, started_at, total_cost, messages_total, status)
       VALUES (?, ?, ?, 1, 'completed')`,
      [id, startedAt, cost]
    );
  }

  it("compares the last N days against the N before them", async () => {
    session("now", NOW - MS_PER_DAY, 8);
    session("prev", NOW - 9 * MS_PER_DAY, 4);

    const res = await app.request("/api/period-comparison?days=7");
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.days).toBe(7);
    expect(body.current.cost).toBeCloseTo(8, 5);
    expect(body.previous.cost).toBeCloseTo(4, 5);
    expect(body.deltas.cost.pct).toBeCloseTo(100, 5);
  });

  it("picks its own window when no range is given, and says it did", async () => {
    session("s1", NOW - MS_PER_DAY, 1);

    const body = await (await app.request("/api/period-comparison")).json();

    expect(body.defaulted).toBe(true);
    expect(body.days).toBe(30);
    expect(body.previous).not.toBeNull();
    expect(body.deltas).not.toBeNull();
  });

  it("applies ?project= to both windows", async () => {
    db.run(
      `INSERT INTO sessions (id, started_at, total_cost, directory, messages_total, status)
       VALUES ('a', ?, 2, '/proj/a', 1, 'completed'), ('b', ?, 50, '/proj/b', 1, 'completed')`,
      [NOW - MS_PER_DAY, NOW - MS_PER_DAY]
    );

    const body = await (await app.request("/api/period-comparison?days=7&project=%2Fproj%2Fa")).json();

    expect(body.current.cost).toBeCloseTo(2, 5);
  });
});
