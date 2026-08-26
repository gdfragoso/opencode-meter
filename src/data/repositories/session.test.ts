import { describe, expect, it, beforeEach, afterEach, spyOn } from "bun:test";
import { Database } from "bun:sqlite";
import { initSchema } from "@/data/db/migrations";
import { findAll, upsert } from "@/data/repositories/session";
import type { SessionData } from "@/data/domain/collected";

/* ── fixtures ──────────────────────────────────────────────────────────
   Live with the suite that owns the table they write to, so the other suites
   import them from here instead of each keeping a copy of the same INSERT.
   ─────────────────────────────────────────────────────────────────────── */

export const NOW = 1700000000000;

export const MS_PER_DAY = 86400000;

export function insertSession(
  db: Database,
  id: string,
  startedAt: number,
  opts: {
    messagesTotal?: number;
    inputTokens?: number;
    outputTokens?: number;
    reasoningTokens?: number;
    cacheReadTokens?: number;
    cacheWriteTokens?: number;
    totalCost?: number;
    toolsTotal?: number;
    agent?: string;
    modelId?: string;
    providerId?: string;
    status?: string;
    errorType?: string;
    durationMs?: number;
    parentId?: string;
    directory?: string;
    branch?: string;
  } = {}
) {
  db.run(
    `INSERT INTO sessions (
      id, started_at, messages_total, status, created_at,
      input_tokens, output_tokens, reasoning_tokens, cache_read_tokens, cache_write_tokens,
      total_cost, tools_total, agent, model_id, provider_id, duration_ms, error_type, parent_id,
      directory, branch
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      id,
      startedAt,
      opts.messagesTotal ?? 1,
      opts.status ?? "completed",
      startedAt,
      opts.inputTokens ?? 0,
      opts.outputTokens ?? 0,
      opts.reasoningTokens ?? 0,
      opts.cacheReadTokens ?? 0,
      opts.cacheWriteTokens ?? 0,
      opts.totalCost ?? 0,
      opts.toolsTotal ?? 0,
      opts.agent ?? null,
      opts.modelId ?? null,
      opts.providerId ?? null,
      opts.durationMs ?? null,
      opts.errorType ?? null,
      opts.parentId ?? null,
      opts.directory ?? null,
      opts.branch ?? null,
    ]
  );
}

export function sessionData(overrides: Partial<SessionData> = {}): SessionData {
  return {
    sessionID: "session-1",
    title: null,
    directory: null,
    branch: null,
    startedAt: NOW,
    status: "completed",
    agent: null,
    model: null,
    provider: null,
    durationMs: 0,
    toolsUsed: 0,
    subagentsUsed: 0,
    messages: 0,
    parentID: null,
    inputTokens: 0,
    outputTokens: 0,
    reasoningTokens: 0,
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
    cost: 0,
    costSource: "opencode",
    costBreakdown: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    ttftMs: null,
    steps: null,
    compactionCount: 0,
    errorType: null,
    errorMessage: null,
    filesTouched: [],
    fileActivity: [],
    additions: 0,
    deletions: 0,
    childSessionIDs: [],
    toolTimings: null,
    sessionType: "main",
    ...overrides,
  };
}

export function sessionTypeOf(db: Database, id: string): string | null {
  const row = db
    .query<{ session_type: string | null }, [string]>(
      "SELECT session_type FROM sessions WHERE id = ?"
    )
    .get(id);
  return row?.session_type ?? null;
}

export interface PersistedCounters {
  input_tokens: number;
  output_tokens: number;
  reasoning_tokens: number;
  cache_read_tokens: number;
  cache_write_tokens: number;
  total_cost: number;
  tools_total: number;
  subagents_total: number;
  messages_total: number;
  session_type: string | null;
}

export function sessionCountersOf(db: Database, id: string): PersistedCounters {
  const row = db
    .query<PersistedCounters, [string]>(
      `SELECT input_tokens, output_tokens, reasoning_tokens, cache_read_tokens,
              cache_write_tokens, total_cost, tools_total, subagents_total,
              messages_total, session_type
       FROM sessions WHERE id = ?`
    )
    .get(id);
  if (!row) throw new Error(`no session row for ${id}`);
  return row;
}

describe("session repository, day filtering and session_type", () => {
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

  describe("session repository findAll", () => {
    it("returns all sessions when days is null", () => {
      insertSession(db, "old", NOW - 30 * MS_PER_DAY);
      insertSession(db, "recent", NOW - 1 * MS_PER_DAY);

      const { rows, total } = findAll(db, 10, 0, null);
      expect(rows.map((r) => r.id).sort()).toEqual(["old", "recent"]);
      expect(total).toBe(2);
    });

    it("returns only sessions within the requested days window", () => {
      insertSession(db, "old", NOW - 30 * MS_PER_DAY);
      insertSession(db, "recent", NOW - 1 * MS_PER_DAY);

      const { rows, total } = findAll(db, 10, 0, 7);
      expect(rows.map((r) => r.id)).toEqual(["recent"]);
      expect(total).toBe(1);
    });

    it("respects limit and offset together with days", () => {
      insertSession(db, "day3", NOW - 3 * MS_PER_DAY);
      insertSession(db, "day2", NOW - 2 * MS_PER_DAY);
      insertSession(db, "day1", NOW - 1 * MS_PER_DAY);

      const { rows, total } = findAll(db, 2, 1, 7);
      expect(rows.map((r) => r.id)).toEqual(["day2", "day3"]);
      expect(total).toBe(3);
    });
  });

  describe("session upsert session_type derivation", () => {
    it("derives session_type='subagent' from parentID even when the passed sessionType says 'main'", () => {
      upsert(
        db,
        sessionData({ sessionID: "child-1", parentID: "root-1", sessionType: "main" })
      );

      expect(sessionTypeOf(db, "child-1")).toBe("subagent");
    });

    it("writes session_type='main' for a root with no previous row", () => {
      upsert(
        db,
        sessionData({ sessionID: "root-1", parentID: null, sessionType: "main" })
      );

      expect(sessionTypeOf(db, "root-1")).toBe("main");
    });
  });
});
