import { describe, it, expect, beforeEach, afterEach, spyOn } from "bun:test";
import { Database } from "bun:sqlite";
import { initSchema } from "@/data/db/migrations";
import { insertSessionFiles } from "@/data/repositories/files";
import { getCostEfficiency } from "@/api/services/cost";
import type { FileActivityEntry } from "@/data/domain/file-activity";

const NOW = 1_700_000_000_000;
const MS_PER_DAY = 86_400_000;

function insertSession(
  db: Database,
  id: string,
  opts: { startedAt?: number; cost?: number; agent?: string; directory?: string; branch?: string } = {}
): void {
  db.run(
    `INSERT INTO sessions (id, started_at, total_cost, agent, directory, branch, messages_total, status, created_at)
     VALUES (?, ?, ?, ?, ?, ?, 1, 'completed', ?)`,
    [
      id,
      opts.startedAt ?? NOW,
      opts.cost ?? 0,
      opts.agent ?? null,
      opts.directory ?? null,
      opts.branch ?? null,
      opts.startedAt ?? NOW,
    ]
  );
}

function file(
  path: string,
  action: FileActivityEntry["action"],
  opts: { tool?: string; additions?: number; deletions?: number; ts?: number } = {}
): FileActivityEntry {
  return {
    path,
    action,
    tool: opts.tool ?? "edit",
    ts: opts.ts ?? NOW,
    additions: opts.additions ?? 0,
    deletions: opts.deletions ?? 0,
  };
}

describe("getCostEfficiency", () => {
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

  describe("with nothing recorded", () => {
    it("reports zeros and no ratios rather than dividing by nothing", () => {
      const result = getCostEfficiency(db, null);

      expect(result.totalCost).toBe(0);
      expect(result.files).toBe(0);
      expect(result.costPerFile).toBeNull();
      expect(result.costPerEdit).toBeNull();
      expect(result.costPerLine).toBeNull();
    });
  });

  describe("overall ratios", () => {
    beforeEach(() => {
      insertSession(db, "s1", { cost: 3 });
      insertSessionFiles(db, "s1", [
        file("/a.ts", "modified", { additions: 10, deletions: 2 }),
        file("/b.ts", "created", { additions: 20, deletions: 0 }),
      ]);
    });

    it("divides the window's cost by the files it changed", () => {
      expect(getCostEfficiency(db, null).costPerFile).toBeCloseTo(1.5, 5);
    });

    it("divides by lines added and removed together", () => {
      // 3 / (10 + 2 + 20)
      expect(getCostEfficiency(db, null).costPerLine).toBeCloseTo(3 / 32, 6);
    });

    it("counts a file edited twice once as a file and twice as an edit", () => {
      insertSessionFiles(db, "s1", [file("/a.ts", "modified", { additions: 5 })]);

      const result = getCostEfficiency(db, null);
      expect(result.files).toBe(2);
      expect(result.edits).toBe(3);
    });

    // Reading a file is not a result; counting it would make a session that
    // only explored look productive.
    it("ignores files that were only read", () => {
      insertSessionFiles(db, "s1", [file("/c.ts", "read", { tool: "read" })]);

      expect(getCostEfficiency(db, null).files).toBe(2);
    });

    it("counts a deleted file as a change", () => {
      insertSessionFiles(db, "s1", [file("/gone.ts", "deleted", { tool: "bash", deletions: 40 })]);

      expect(getCostEfficiency(db, null).files).toBe(3);
    });

    it("reports no cost per file when money was spent and nothing changed", () => {
      const empty = new Database(":memory:");
      initSchema(empty);
      insertSession(empty, "s1", { cost: 5 });

      const result = getCostEfficiency(empty, null);
      expect(result.totalCost).toBe(5);
      expect(result.costPerFile).toBeNull();
      empty.close();
    });
  });

  describe("windowing", () => {
    beforeEach(() => {
      insertSession(db, "old", { startedAt: NOW - 30 * MS_PER_DAY, cost: 100 });
      insertSessionFiles(db, "old", [file("/old.ts", "modified", { additions: 1 })]);
      insertSession(db, "recent", { startedAt: NOW - 1 * MS_PER_DAY, cost: 2 });
      insertSessionFiles(db, "recent", [file("/new.ts", "modified", { additions: 1 })]);
    });

    it("counts everything when days is null", () => {
      const all = getCostEfficiency(db, null);

      expect(all.totalCost).toBeCloseTo(102, 5);
      expect(all.files).toBe(2);
    });

    // The numerator and the denominator have to come from the same sessions,
    // or the ratio is a comparison between two different weeks.
    it("drops a session's cost and its files together", () => {
      const week = getCostEfficiency(db, 7);

      expect(week.totalCost).toBeCloseTo(2, 5);
      expect(week.files).toBe(1);
      expect(week.costPerFile).toBeCloseTo(2, 5);
    });
  });

  describe("project and branch filters", () => {
    beforeEach(() => {
      insertSession(db, "a", { cost: 2, directory: "/proj/a", branch: "main" });
      insertSessionFiles(db, "a", [file("/a.ts", "modified")]);
      insertSession(db, "b", { cost: 8, directory: "/proj/b", branch: "dev" });
      insertSessionFiles(db, "b", [file("/b1.ts", "modified"), file("/b2.ts", "modified")]);
    });

    it("filters by project", () => {
      const result = getCostEfficiency(db, null, "/proj/a", null);

      expect(result.totalCost).toBeCloseTo(2, 5);
      expect(result.files).toBe(1);
    });

    it("filters by branch", () => {
      const result = getCostEfficiency(db, null, null, "dev");

      expect(result.totalCost).toBeCloseTo(8, 5);
      expect(result.files).toBe(2);
    });
  });
});
