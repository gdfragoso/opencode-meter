import { describe, it, expect, beforeEach, afterEach, spyOn } from "bun:test";
import { Database } from "bun:sqlite";
import { initSchema } from "@/data/db/migrations";
import { cacheHitRate, getCacheTimeline } from "@/api/services/cache-timeline";

const NOW = Date.UTC(2026, 7, 20, 12, 0, 0);
const MS_PER_DAY = 86_400_000;

function insertSession(
  db: Database,
  id: string,
  startedAt: number,
  opts: {
    model?: string;
    provider?: string;
    cacheRead?: number;
    input?: number;
    output?: number;
    directory?: string;
    branch?: string;
  } = {}
): void {
  db.run(
    `INSERT INTO sessions (
       id, started_at, model_id, provider_id, cache_read_tokens, input_tokens,
       output_tokens, reasoning_tokens, cache_write_tokens, directory, branch,
       messages_total, status, created_at
     ) VALUES (?, ?, ?, ?, ?, ?, ?, 0, 0, ?, ?, 1, 'completed', ?)`,
    [
      id,
      startedAt,
      opts.model ?? "sonnet",
      opts.provider ?? "anthropic",
      opts.cacheRead ?? 0,
      opts.input ?? 0,
      opts.output ?? 0,
      opts.directory ?? null,
      opts.branch ?? null,
      startedAt,
    ]
  );
}

describe("cacheHitRate", () => {
  it("is the share of input that came from cache", () => {
    expect(cacheHitRate(75, 25)).toBeCloseTo(0.75, 6);
  });

  it("is 0 when nothing was cached but something was read", () => {
    expect(cacheHitRate(0, 100)).toBe(0);
  });

  it("is 1 when everything came from cache", () => {
    expect(cacheHitRate(100, 0)).toBe(1);
  });

  // A day with no requests is not a day with a 0% hit rate; charted as one it
  // would draw a cliff where nothing happened.
  it("has no value when the model read nothing at all", () => {
    expect(cacheHitRate(0, 0)).toBeNull();
  });
});

describe("getCacheTimeline", () => {
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

  it("returns nothing for an empty database", () => {
    expect(getCacheTimeline(db, null)).toEqual({ dates: [], series: [], omittedModels: 0 });
  });

  it("groups a model's sessions into one point per day", () => {
    insertSession(db, "a", NOW - 2 * MS_PER_DAY, { cacheRead: 30, input: 10 });
    insertSession(db, "b", NOW - 2 * MS_PER_DAY, { cacheRead: 10, input: 30 });
    insertSession(db, "c", NOW - MS_PER_DAY, { cacheRead: 50, input: 50 });

    const result = getCacheTimeline(db, null);

    expect(result.dates).toHaveLength(2);
    expect(result.series).toHaveLength(1);
    // Two sessions on day one: 40 cached of 80 read, not the mean of 75% and 25%.
    expect(result.series[0]!.rates[0]).toBeCloseTo(0.5, 6);
    expect(result.series[0]!.rates[1]).toBeCloseTo(0.5, 6);
  });

  it("puts the days in order", () => {
    insertSession(db, "late", NOW - MS_PER_DAY, { input: 1 });
    insertSession(db, "early", NOW - 5 * MS_PER_DAY, { input: 1 });

    expect(getCacheTimeline(db, null).dates).toEqual([...getCacheTimeline(db, null).dates].sort());
  });

  describe("alignment across models", () => {
    beforeEach(() => {
      insertSession(db, "s-day1", NOW - 2 * MS_PER_DAY, { model: "sonnet", cacheRead: 90, input: 10 });
      insertSession(db, "s-day2", NOW - MS_PER_DAY, { model: "sonnet", cacheRead: 50, input: 50 });
      insertSession(db, "h-day2", NOW - MS_PER_DAY, { model: "haiku", cacheRead: 20, input: 80 });
    });

    it("gives every series one entry per date", () => {
      const result = getCacheTimeline(db, null);

      expect(result.dates).toHaveLength(2);
      for (const s of result.series) {
        expect(s.rates).toHaveLength(2);
      }
    });

    // The gap has to be a null at the right index, not a missing element —
    // otherwise the second model's points slide onto the wrong dates.
    it("leaves a gap where a model was not used, at the right index", () => {
      const haiku = getCacheTimeline(db, null).series.find(s => s.model_id === "haiku")!;

      expect(haiku.rates[0]).toBeNull();
      expect(haiku.rates[1]).toBeCloseTo(0.2, 6);
    });
  });

  describe("ranking and the series cap", () => {
    beforeEach(() => {
      for (const [model, tokens] of [["big", 1000], ["mid", 100], ["small", 10]] as const) {
        insertSession(db, `${model}-s`, NOW - MS_PER_DAY, { model, input: tokens });
      }
    });

    it("puts the busiest model first", () => {
      expect(getCacheTimeline(db, null).series.map(s => s.model_id)).toEqual(["big", "mid", "small"]);
    });

    it("keeps the busiest models when it has to cut", () => {
      expect(getCacheTimeline(db, null, null, null, 2).series.map(s => s.model_id)).toEqual(["big", "mid"]);
    });

    // A truncated chart presented as the whole picture is the failure mode;
    // the count is what lets the UI say otherwise.
    it("reports how many models it left out", () => {
      expect(getCacheTimeline(db, null, null, null, 2).omittedModels).toBe(1);
    });

    it("reports none omitted when they all fit", () => {
      expect(getCacheTimeline(db, null).omittedModels).toBe(0);
    });
  });

  describe("the whole-window rate", () => {
    it("weights by tokens rather than averaging the daily rates", () => {
      insertSession(db, "quiet", NOW - 2 * MS_PER_DAY, { cacheRead: 1, input: 0 });
      insertSession(db, "busy", NOW - MS_PER_DAY, { cacheRead: 0, input: 999 });

      const rate = getCacheTimeline(db, null).series[0]!.overallRate!;

      // Averaging the two days would give 50%; weighted, the busy day dominates.
      expect(rate).toBeCloseTo(1 / 1000, 6);
    });

    it("is null for a model that read nothing", () => {
      insertSession(db, "s", NOW - MS_PER_DAY, { cacheRead: 0, input: 0, output: 5 });

      expect(getCacheTimeline(db, null).series[0]!.overallRate).toBeNull();
    });
  });

  describe("filters", () => {
    beforeEach(() => {
      insertSession(db, "old", NOW - 30 * MS_PER_DAY, { model: "ancient", input: 1 });
      insertSession(db, "a", NOW - MS_PER_DAY, { model: "sonnet", input: 1, directory: "/proj/a", branch: "main" });
      insertSession(db, "b", NOW - MS_PER_DAY, { model: "haiku", input: 1, directory: "/proj/b", branch: "dev" });
    });

    it("honours days", () => {
      expect(getCacheTimeline(db, 7).series.map(s => s.model_id)).not.toContain("ancient");
    });

    it("honours project", () => {
      expect(getCacheTimeline(db, null, "/proj/a").series.map(s => s.model_id)).toEqual(["sonnet"]);
    });

    it("honours branch", () => {
      expect(getCacheTimeline(db, null, null, "dev").series.map(s => s.model_id)).toEqual(["haiku"]);
    });
  });

  it("skips sessions with no model rather than bucketing them together", () => {
    db.run(
      `INSERT INTO sessions (id, started_at, model_id, input_tokens, messages_total, status)
       VALUES ('nomodel', ?, NULL, 100, 1, 'completed')`,
      [NOW - MS_PER_DAY]
    );

    expect(getCacheTimeline(db, null).series).toEqual([]);
  });
});
