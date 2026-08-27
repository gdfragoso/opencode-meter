import { describe, it, expect, beforeEach, afterEach, spyOn } from "bun:test";
import { Database } from "bun:sqlite";
import { initSchema } from "@/data/db/migrations";
import { createCacheTimelineRoute } from "@/api/routes/cache-timeline";

const NOW = Date.UTC(2026, 7, 20, 12, 0, 0);
const MS_PER_DAY = 86_400_000;

describe("GET /api/models/cache-timeline", () => {
  let db: Database;
  let app: ReturnType<typeof createCacheTimelineRoute>;
  let nowSpy: ReturnType<typeof spyOn>;

  beforeEach(() => {
    db = new Database(":memory:");
    initSchema(db);
    app = createCacheTimelineRoute(() => db);
    nowSpy = spyOn(Date, "now").mockReturnValue(NOW);
  });

  afterEach(() => {
    nowSpy.mockRestore();
    db.close();
  });

  function session(id: string, startedAt: number, model: string, cacheRead: number, input: number) {
    db.run(
      `INSERT INTO sessions (id, started_at, model_id, provider_id, cache_read_tokens, input_tokens, messages_total, status)
       VALUES (?, ?, ?, 'anthropic', ?, ?, 1, 'completed')`,
      [id, startedAt, model, cacheRead, input]
    );
  }

  it("returns a series per model aligned to shared dates", async () => {
    session("a", NOW - 2 * MS_PER_DAY, "sonnet", 90, 10);
    session("b", NOW - MS_PER_DAY, "haiku", 20, 80);

    const res = await app.request("/api/models/cache-timeline");
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.dates).toHaveLength(2);
    expect(body.series).toHaveLength(2);
    for (const s of body.series) {
      expect(s.rates).toHaveLength(2);
    }
  });

  it("returns empty structures for an empty database", async () => {
    const body = await (await app.request("/api/models/cache-timeline")).json();

    expect(body).toEqual({ dates: [], series: [], omittedModels: 0 });
  });

  it("honours ?days=", async () => {
    session("old", NOW - 40 * MS_PER_DAY, "ancient", 1, 1);
    session("new", NOW - MS_PER_DAY, "sonnet", 1, 1);

    const body = await (await app.request("/api/models/cache-timeline?days=7")).json();

    expect(body.series.map((s: { model_id: string }) => s.model_id)).toEqual(["sonnet"]);
  });
});
