import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { Database } from "bun:sqlite";
import { initSchema } from "@/data/db/migrations";
import { insertSessionFiles } from "@/data/repositories/files";
import { delta, getPeriodComparison } from "@/api/services/comparison";

const NOW = 1_700_000_000_000;
const MS_PER_DAY = 86_400_000;

function insertSession(
  db: Database,
  id: string,
  startedAt: number,
  opts: {
    cost?: number;
    inputTokens?: number;
    tools?: number;
    status?: string;
    directory?: string;
    branch?: string;
  } = {}
): void {
  db.run(
    `INSERT INTO sessions (
       id, started_at, total_cost, input_tokens, output_tokens, reasoning_tokens,
       cache_read_tokens, cache_write_tokens, tools_total, status, directory, branch,
       messages_total, created_at
     ) VALUES (?, ?, ?, ?, 0, 0, 0, 0, ?, ?, ?, ?, 1, ?)`,
    [
      id,
      startedAt,
      opts.cost ?? 0,
      opts.inputTokens ?? 0,
      opts.tools ?? 0,
      opts.status ?? "completed",
      opts.directory ?? null,
      opts.branch ?? null,
      startedAt,
    ]
  );
}

describe("delta", () => {
  it("reports the absolute change", () => {
    expect(delta(12, 10).absolute).toBe(2);
  });

  it("reports the percentage change", () => {
    expect(delta(12, 10).pct).toBeCloseTo(20, 5);
  });

  it("reports a fall as a negative percentage", () => {
    expect(delta(5, 10).pct).toBeCloseTo(-50, 5);
  });

  // 0% would say nothing changed, 100% would say it doubled, Infinity is not a
  // number anyone wants to read. None of them is true, so there is no percentage.
  it("has no percentage when the earlier value was zero", () => {
    const d = delta(7, 0);

    expect(d.pct).toBeNull();
    expect(d.absolute).toBe(7);
  });

  it("reports 0% when nothing changed", () => {
    expect(delta(10, 10).pct).toBe(0);
  });

  it("has no percentage when both sides are zero", () => {
    expect(delta(0, 0).pct).toBeNull();
  });
});

describe("getPeriodComparison", () => {
  let db: Database;

  beforeEach(() => {
    db = new Database(":memory:");
    initSchema(db);
  });

  afterEach(() => {
    db.close();
  });

  const compare = (days: number | null, project: string | null = null, branch: string | null = null) =>
    getPeriodComparison(db, days, project, branch, NOW);

  describe("window boundaries", () => {
    it("splits the last 2N days into two windows of N", () => {
      const result = compare(7);

      expect(result.current.from).toBe(NOW - 7 * MS_PER_DAY);
      expect(result.current.to).toBe(NOW);
      expect(result.previous!.from).toBe(NOW - 14 * MS_PER_DAY);
      expect(result.previous!.to).toBe(NOW - 7 * MS_PER_DAY);
    });

    // The windows meet at one instant. Counting a session there in both would
    // inflate the older window and understate the change.
    it("puts a session exactly on the boundary in the newer window only", () => {
      insertSession(db, "edge", NOW - 7 * MS_PER_DAY, { cost: 1 });

      const result = compare(7);

      expect(result.current.sessions).toBe(1);
      expect(result.previous!.sessions).toBe(0);
    });

    it("leaves out anything older than both windows", () => {
      insertSession(db, "ancient", NOW - 30 * MS_PER_DAY, { cost: 100 });

      const result = compare(7);

      expect(result.current.cost).toBe(0);
      expect(result.previous!.cost).toBe(0);
    });
  });

  describe("with data in both windows", () => {
    beforeEach(() => {
      insertSession(db, "now-1", NOW - 1 * MS_PER_DAY, { cost: 6, inputTokens: 300, tools: 9 });
      insertSession(db, "now-2", NOW - 2 * MS_PER_DAY, { cost: 2, inputTokens: 100, tools: 1, status: "error" });
      insertSession(db, "prev-1", NOW - 9 * MS_PER_DAY, { cost: 4, inputTokens: 200, tools: 5 });
      insertSessionFiles(db, "now-1", [
        { path: "/a.ts", action: "modified", tool: "edit", ts: NOW, additions: 10, deletions: 2 },
        { path: "/b.ts", action: "created", tool: "write", ts: NOW, additions: 5, deletions: 0 },
      ]);
      insertSessionFiles(db, "prev-1", [
        { path: "/a.ts", action: "modified", tool: "edit", ts: NOW, additions: 3, deletions: 1 },
      ]);
    });

    it("totals each window separately", () => {
      const result = compare(7);

      expect(result.current.sessions).toBe(2);
      expect(result.current.cost).toBeCloseTo(8, 5);
      expect(result.previous!.sessions).toBe(1);
      expect(result.previous!.cost).toBeCloseTo(4, 5);
    });

    it("carries both sides of every delta so the UI need not recompute", () => {
      const cost = compare(7).deltas!.cost;

      expect(cost.current).toBeCloseTo(8, 5);
      expect(cost.previous).toBeCloseTo(4, 5);
      expect(cost.absolute).toBeCloseTo(4, 5);
      expect(cost.pct).toBeCloseTo(100, 5);
    });

    it("counts files changed in each window, not files read", () => {
      insertSessionFiles(db, "now-1", [
        { path: "/looked-at.ts", action: "read", tool: "read", ts: NOW, additions: 0, deletions: 0 },
      ]);

      const result = compare(7);

      expect(result.current.files).toBe(2);
      expect(result.previous!.files).toBe(1);
    });

    it("counts lines added and removed together", () => {
      expect(compare(7).current.lines).toBe(17);
    });

    it("counts errors", () => {
      expect(compare(7).deltas!.errors.current).toBe(1);
    });

    it("counts the days something actually happened on", () => {
      expect(compare(7).current.activeDays).toBe(2);
    });
  });

  describe("with an empty earlier window", () => {
    beforeEach(() => {
      insertSession(db, "now-1", NOW - 1 * MS_PER_DAY, { cost: 5 });
    });

    it("still reports the earlier window rather than omitting it", () => {
      expect(compare(7).previous).not.toBeNull();
      expect(compare(7).previous!.sessions).toBe(0);
    });

    it("gives the absolute change but no percentage", () => {
      const cost = compare(7).deltas!.cost;

      expect(cost.absolute).toBeCloseTo(5, 5);
      expect(cost.pct).toBeNull();
    });
  });

  describe("with no range selected", () => {
    beforeEach(() => {
      insertSession(db, "s1", NOW - 100 * MS_PER_DAY, { cost: 1 });
      insertSession(db, "s2", NOW - 1 * MS_PER_DAY, { cost: 2 });
    });

    // Halving the history to manufacture a comparison would put a full period
    // against a partial one; better to say there is nothing to compare.
    it("reports the whole history and no comparison", () => {
      const result = compare(null);

      expect(result.days).toBeNull();
      expect(result.current.sessions).toBe(2);
      expect(result.previous).toBeNull();
      expect(result.deltas).toBeNull();
    });

    it("treats a zero-day range the same way", () => {
      expect(compare(0).previous).toBeNull();
    });
  });

  describe("project and branch filters", () => {
    beforeEach(() => {
      insertSession(db, "a-now", NOW - 1 * MS_PER_DAY, { cost: 2, directory: "/proj/a", branch: "main" });
      insertSession(db, "a-prev", NOW - 9 * MS_PER_DAY, { cost: 1, directory: "/proj/a", branch: "main" });
      insertSession(db, "b-now", NOW - 1 * MS_PER_DAY, { cost: 50, directory: "/proj/b", branch: "dev" });
    });

    it("applies the project filter to both windows", () => {
      const result = compare(7, "/proj/a");

      expect(result.current.cost).toBeCloseTo(2, 5);
      expect(result.previous!.cost).toBeCloseTo(1, 5);
    });

    it("applies the branch filter to both windows", () => {
      const result = compare(7, null, "dev");

      expect(result.current.cost).toBeCloseTo(50, 5);
      expect(result.previous!.cost).toBe(0);
    });
  });
});
