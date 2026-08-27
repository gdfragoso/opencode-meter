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
      expect(result.byAgent).toEqual([]);
      expect(result.byTool).toEqual([]);
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

  describe("by agent", () => {
    beforeEach(() => {
      insertSession(db, "s1", { cost: 2, agent: "builder" });
      insertSession(db, "s2", { cost: 4, agent: "builder" });
      insertSession(db, "s3", { cost: 1, agent: "reviewer" });
      insertSessionFiles(db, "s1", [file("/a.ts", "modified", { additions: 5 })]);
      insertSessionFiles(db, "s2", [file("/b.ts", "modified", { additions: 5 })]);
    });

    it("adds up each agent's spend across its sessions", () => {
      const builder = getCostEfficiency(db, null).byAgent.find(a => a.agent === "builder")!;

      expect(builder.sessions).toBe(2);
      expect(builder.cost).toBeCloseTo(6, 5);
    });

    // The bug this guards: grouping over sessions LEFT JOIN session_files
    // repeats a session once per file, multiplying its cost.
    it("does not multiply an agent's cost by how many files it touched", () => {
      insertSessionFiles(db, "s1", [
        file("/c.ts", "modified"),
        file("/d.ts", "modified"),
        file("/e.ts", "modified"),
      ]);

      const builder = getCostEfficiency(db, null).byAgent.find(a => a.agent === "builder")!;
      expect(builder.cost).toBeCloseTo(6, 5);
      expect(builder.files).toBe(5);
    });

    it("keeps an agent that spent money and changed nothing", () => {
      const reviewer = getCostEfficiency(db, null).byAgent.find(a => a.agent === "reviewer")!;

      expect(reviewer.cost).toBeCloseTo(1, 5);
      expect(reviewer.files).toBe(0);
      expect(reviewer.costPerFile).toBeNull();
    });

    it("counts a file touched in two of an agent's sessions once", () => {
      insertSessionFiles(db, "s2", [file("/a.ts", "modified", { additions: 3 })]);

      const builder = getCostEfficiency(db, null).byAgent.find(a => a.agent === "builder")!;
      expect(builder.files).toBe(2);
    });

    it("labels sessions with no agent instead of dropping them", () => {
      insertSession(db, "s4", { cost: 9 });

      expect(getCostEfficiency(db, null).byAgent.map(a => a.agent)).toContain("unknown");
    });

    it("puts the most expensive agent first", () => {
      expect(getCostEfficiency(db, null).byAgent.map(a => a.agent)).toEqual(["builder", "reviewer"]);
    });
  });

  describe("by tool", () => {
    beforeEach(() => {
      insertSession(db, "s1", { cost: 2 });
      // One step's cost, and two tool calls inside it, so findToolMetrics has
      // something to split.
      db.run(`INSERT INTO events (ts, session_id, type, data) VALUES (?, 's1', 'step.start', ?)`, [
        NOW,
        JSON.stringify({ step: 1 }),
      ]);
      db.run(`INSERT INTO events (ts, session_id, type, data) VALUES (?, 's1', 'step.finish', ?)`, [
        NOW + 1000,
        JSON.stringify({ step: 1, cost: 2, tokens: { input: 100, output: 10 } }),
      ]);
      for (const [callID, tool, start, end] of [
        ["c1", "edit", NOW + 100, NOW + 300],
        ["c2", "grep", NOW + 400, NOW + 600],
      ] as const) {
        // call_id is a generated column over data.callID — it is set by
        // writing the JSON, never inserted directly.
        db.run(`INSERT INTO events (ts, session_id, type, data) VALUES (?, 's1', 'tool.before', ?)`, [
          start,
          JSON.stringify({ tool, callID }),
        ]);
        db.run(`INSERT INTO events (ts, session_id, type, data) VALUES (?, 's1', 'tool.after', ?)`, [
          end,
          JSON.stringify({ tool, callID }),
        ]);
      }
      insertSessionFiles(db, "s1", [file("/a.ts", "modified", { tool: "edit", additions: 4, deletions: 1 })]);
    });

    it("reports the files a tool changed next to what it cost", () => {
      const edit = getCostEfficiency(db, null).byTool.find(t => t.tool === "edit")!;

      expect(edit.files).toBe(1);
      expect(edit.lines).toBe(5);
      expect(edit.costPerFile).toBeCloseTo(edit.cost, 5);
    });

    // A search costs money and produces no file; dropping it would hide spend.
    it("keeps a tool that changed no file", () => {
      const grep = getCostEfficiency(db, null).byTool.find(t => t.tool === "grep")!;

      expect(grep.calls).toBe(1);
      expect(grep.files).toBe(0);
      expect(grep.costPerFile).toBeNull();
      expect(grep.costPerCall).toBeCloseTo(grep.cost, 5);
    });

    it("puts the most expensive tool first", () => {
      const tools = getCostEfficiency(db, null).byTool;

      expect(tools.length).toBeGreaterThan(1);
      expect(tools[0]!.cost).toBeGreaterThanOrEqual(tools[1]!.cost);
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

    it("filters the per-agent rows too", () => {
      expect(getCostEfficiency(db, null, "/proj/a", null).byAgent).toHaveLength(1);
    });
  });
});
