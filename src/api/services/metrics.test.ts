import { describe, expect, it, beforeEach, afterEach, spyOn } from "bun:test";
import { Database } from "bun:sqlite";
import { initSchema } from "@/data/db/migrations";
import { MS_PER_DAY, NOW, insertSession } from "@/data/repositories/session.test";
import { getSummary } from "@/api/services/metrics";

describe("metrics service getSummary", () => {
  let db: Database;
  let nowSpy: ReturnType<typeof spyOn>;

  beforeEach(() => {
    db = new Database(":memory:");
    initSchema(db);
    // Frozen clock: every fixture places sessions relative to NOW, and the
    // day filters compare against Date.now().
    nowSpy = spyOn(Date, "now").mockReturnValue(NOW);
  });

  afterEach(() => {
    nowSpy.mockRestore();
    db.close();
  });

  describe("metrics service getSummary", () => {
    it("aggregates all sessions when days is null", () => {
      insertSession(db, "old", NOW - 30 * MS_PER_DAY, {
        inputTokens: 100,
        outputTokens: 50,
        totalCost: 1.5,
      });
      insertSession(db, "recent", NOW - 1 * MS_PER_DAY, {
        inputTokens: 10,
        outputTokens: 5,
        totalCost: 0.5,
      });

      const summary = getSummary(db, null);
      expect(summary.totalSessions).toBe(2);
      expect(summary.totalTokens).toBe(165);
      expect(summary.totalCost).toBeCloseTo(2, 5);
    });

    it("aggregates only sessions within the requested window", () => {
      insertSession(db, "old", NOW - 30 * MS_PER_DAY, {
        inputTokens: 100,
        outputTokens: 50,
        totalCost: 1.5,
        agent: "agent-a",
      });
      insertSession(db, "recent", NOW - 1 * MS_PER_DAY, {
        inputTokens: 10,
        outputTokens: 5,
        totalCost: 0.5,
        agent: "agent-a",
        modelId: "model-x",
        providerId: "provider-y",
      });

      const summary = getSummary(db, 7);
      expect(summary.totalSessions).toBe(1);
      expect(summary.totalTokens).toBe(15);
      expect(summary.totalCost).toBeCloseTo(0.5, 5);
      expect(summary.topAgents).toHaveLength(1);
      expect(summary.topAgents[0].agent).toBe("agent-a");
      expect(summary.topModels).toHaveLength(1);
      expect(summary.topModels[0].model_id).toBe("model-x");
    });

    it("counts sessions with error_type IS NOT NULL even when status is not 'error'", () => {
      insertSession(db, "err-idle", NOW - 1 * MS_PER_DAY);
      db.run(
        "UPDATE sessions SET status = 'idle', error_type = ? WHERE id = ?",
        ["APIError", "err-idle"]
      );
      insertSession(db, "clean", NOW - 1 * MS_PER_DAY);

      const summary = getSummary(db, null);
      expect(summary.totalErrors).toBe(1);
    });

    it("separates user-opened sessions from subagent rows when days is null", () => {
      insertSession(db, "main-1", NOW - 30 * MS_PER_DAY);
      insertSession(db, "main-2", NOW - 1 * MS_PER_DAY);
      insertSession(db, "child-1", NOW - 1 * MS_PER_DAY, { parentId: "main-1" });

      const summary = getSummary(db, null);
      expect(summary.totalSessions).toBe(3);
      expect(summary.totalUserSessions).toBe(2);
    });

    it("counts only in-window user sessions when the window excludes a main and its child", () => {
      insertSession(db, "main-1", NOW - 30 * MS_PER_DAY);
      insertSession(db, "child-1", NOW - 1 * MS_PER_DAY, { parentId: "main-1" });
      insertSession(db, "main-2", NOW - 1 * MS_PER_DAY);

      const summary = getSummary(db, 7);
      expect(summary.totalSessions).toBe(2);
      expect(summary.totalUserSessions).toBe(1);
    });

    it("excludes a mislabeled child (parent_id set + session_type='main') from totalUserSessions", () => {
      insertSession(db, "root-1", NOW - 1 * MS_PER_DAY);
      insertSession(db, "root-2", NOW - 1 * MS_PER_DAY);
      insertSession(db, "child-1", NOW - 1 * MS_PER_DAY, { parentId: "root-1" });
      db.run("UPDATE sessions SET session_type = 'main' WHERE id = 'child-1'");

      const summary = getSummary(db, null);
      expect(summary.totalSessions).toBe(3);
      expect(summary.totalUserSessions).toBe(2);
    });

    it("filters totals by project directory", () => {
      insertSession(db, "proj-a", NOW - 1 * MS_PER_DAY, {
        inputTokens: 100,
        totalCost: 1,
        directory: "/foo",
        agent: "agent-a",
        modelId: "model-x",
        providerId: "provider-y",
      });
      insertSession(db, "proj-b", NOW - 1 * MS_PER_DAY, {
        inputTokens: 200,
        totalCost: 2,
        directory: "/bar",
        agent: "agent-b",
        modelId: "model-y",
        providerId: "provider-z",
      });

      const summary = getSummary(db, null, "/foo", null);
      expect(summary.totalSessions).toBe(1);
      expect(summary.totalTokens).toBe(100);
      expect(summary.totalCost).toBeCloseTo(1, 5);
      expect(summary.topModels).toHaveLength(1);
      expect(summary.topModels[0].model_id).toBe("model-x");
      expect(summary.topAgents).toHaveLength(1);
      expect(summary.topAgents[0].agent).toBe("agent-a");
    });

    it("filters totals by branch", () => {
      insertSession(db, "main-branch", NOW - 1 * MS_PER_DAY, {
        inputTokens: 100,
        totalCost: 1,
        branch: "main",
        agent: "agent-a",
        modelId: "model-x",
        providerId: "provider-y",
      });
      insertSession(db, "feat-branch", NOW - 1 * MS_PER_DAY, {
        inputTokens: 200,
        totalCost: 2,
        branch: "feature/x",
        agent: "agent-b",
        modelId: "model-y",
        providerId: "provider-z",
      });

      const summary = getSummary(db, null, null, "main");
      expect(summary.totalSessions).toBe(1);
      expect(summary.totalTokens).toBe(100);
      expect(summary.totalCost).toBeCloseTo(1, 5);
      expect(summary.topModels).toHaveLength(1);
      expect(summary.topModels[0].model_id).toBe("model-x");
      expect(summary.topAgents).toHaveLength(1);
      expect(summary.topAgents[0].agent).toBe("agent-a");
    });

    it("filters totals by both project and branch", () => {
      insertSession(db, "match", NOW - 1 * MS_PER_DAY, {
        inputTokens: 100,
        totalCost: 1,
        directory: "/foo",
        branch: "main",
        agent: "agent-a",
        modelId: "model-x",
        providerId: "provider-y",
      });
      insertSession(db, "wrong-dir", NOW - 1 * MS_PER_DAY, {
        directory: "/bar",
        branch: "main",
        agent: "agent-b",
      });
      insertSession(db, "wrong-branch", NOW - 1 * MS_PER_DAY, {
        directory: "/foo",
        branch: "feature/x",
        agent: "agent-c",
      });

      const summary = getSummary(db, null, "/foo", "main");
      expect(summary.totalSessions).toBe(1);
      expect(summary.totalTokens).toBe(100);
      expect(summary.topModels).toHaveLength(1);
      expect(summary.topAgents).toHaveLength(1);
      expect(summary.topAgents[0].agent).toBe("agent-a");
    });

    it("returns all sessions when project and branch are null", () => {
      insertSession(db, "s1", NOW - 1 * MS_PER_DAY, {
        directory: "/foo",
        branch: "main",
      });
      insertSession(db, "s2", NOW - 1 * MS_PER_DAY, {
        directory: "/bar",
        branch: "feature/x",
      });

      const summary = getSummary(db, null, null, null);
      expect(summary.totalSessions).toBe(2);
    });
  });
});
