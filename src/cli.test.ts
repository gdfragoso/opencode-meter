import { describe, it, expect, beforeEach } from "bun:test";
import { Database } from "bun:sqlite";
import { initSchema } from "@/data/db/migrations";
import { buildJsonResult, formatBytes } from "@/cli";

function createTestDb(): Database {
  const db = new Database(":memory:");
  initSchema(db);
  return db;
}

function insertSession(
  db: Database,
  id: string,
  data: {
    messages_total?: number;
    status?: string | null;
    input_tokens?: number;
    output_tokens?: number;
    reasoning_tokens?: number;
    cache_read_tokens?: number;
    cache_write_tokens?: number;
    total_cost?: number;
    tools_total?: number;
    subagents_total?: number;
    model_id?: string | null;
    provider_id?: string | null;
    agent?: string | null;
    session_type?: string | null;
    parent_id?: string | null;
    ttft_ms?: number | null;
  } = {}
): void {
  db.run(
    `INSERT INTO sessions (
      id, messages_total, status, input_tokens, output_tokens, reasoning_tokens,
      cache_read_tokens, cache_write_tokens, total_cost, tools_total, subagents_total,
      model_id, provider_id, agent, session_type, parent_id, ttft_ms
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      id,
      data.messages_total ?? 0,
      data.status ?? "completed",
      data.input_tokens ?? 0,
      data.output_tokens ?? 0,
      data.reasoning_tokens ?? 0,
      data.cache_read_tokens ?? 0,
      data.cache_write_tokens ?? 0,
      data.total_cost ?? 0,
      data.tools_total ?? 0,
      data.subagents_total ?? 0,
      data.model_id ?? null,
      data.provider_id ?? null,
      data.agent ?? null,
      data.session_type ?? null,
      data.parent_id ?? null,
      data.ttft_ms ?? null,
    ]
  );
}

describe("buildJsonResult", () => {
  let db: Database;

  beforeEach(() => {
    db = createTestDb();
  });

  it("output keeps the 5 current keys and adds the 3 enrichment keys", () => {
    insertSession(db, "s1");

    const result = buildJsonResult(db);

    expect(Object.keys(result)).toEqual([
      "totalSessions",
      "totalRequests",
      "totalCost",
      "totalTokens",
      "cacheHitRate",
      "totalTools",
      "totalSubagents",
      "totalErrors",
      "byModel",
      "byAgent",
    ]);
  });

  it("totalTokens sums all five token types", () => {
    insertSession(db, "s1", {
      input_tokens: 100,
      output_tokens: 50,
      reasoning_tokens: 10,
      cache_read_tokens: 20,
      cache_write_tokens: 5,
    });

    const result = buildJsonResult(db);

    expect(result.totalTokens).toBe(185);
  });

  it("cacheHitRate uses the front formula", () => {
    insertSession(db, "s1", { input_tokens: 100, cache_read_tokens: 25 });

    const result = buildJsonResult(db);

    // 25 / (25 + 100) = 0.2 — the OLD CLI formula (cache_read / input) would give 0.25.
    expect(result.cacheHitRate).toBeCloseTo(0.2, 5);
  });

  it("totalSessions counts all sessions (no active filter)", () => {
    insertSession(db, "s1", { messages_total: 5, status: "completed" });
    insertSession(db, "s2", { messages_total: 0, status: "completed" });

    const result = buildJsonResult(db);

    expect(result.totalSessions).toBe(2);
  });

  it("totalRequests sums messages_total", () => {
    insertSession(db, "s1", { messages_total: 5, status: "completed" });
    insertSession(db, "s2", { messages_total: 0, status: "completed" });

    const result = buildJsonResult(db);

    expect(result.totalRequests).toBe(5);
  });

  it("totalCost mirrors /api/summary.totalCost exactly (no rounding)", () => {
    insertSession(db, "s1", { total_cost: 12.345 });

    const result = buildJsonResult(db);

    expect(result.totalCost).toBe(12.345);
  });

  it("byModel rows carry the 9 ModelAggregateRow fields and rounded cost", () => {
    insertSession(db, "s1", {
      model_id: "m1",
      provider_id: "p1",
      agent: "a1",
      input_tokens: 100,
      output_tokens: 50,
      total_cost: 1.234,
    });

    const result = buildJsonResult(db);

    expect(result.byModel).toHaveLength(1);
    expect(Object.keys(result.byModel[0])).toEqual([
      "model_id",
      "provider_id",
      "sessions",
      "tokens",
      "cost",
      "ttft_avg_ms",
      "cache_hit_rate",
      "error_rate",
      "tokens_per_sec",
    ]);
    expect(result.byModel[0].cost).toBe(1.23);
  });

  it("byAgent rows carry tools and type", () => {
    insertSession(db, "s1", { agent: "a1" });

    const result = buildJsonResult(db);

    expect(result.byAgent).toHaveLength(1);
    expect(Object.keys(result.byAgent[0])).toEqual([
      "agent",
      "sessions",
      "tools",
      "cost",
      "type",
    ]);
    expect(result.byAgent[0].tools).toBe(0);
    expect(result.byAgent[0].type).toBe("main");
  });
});

describe("formatBytes", () => {
  it("renders sizes the way a human reads them", () => {
    expect(formatBytes(0)).toBe("0 B");
    expect(formatBytes(512)).toBe("512 B");
    expect(formatBytes(2048)).toBe("2.0 KB");
    expect(formatBytes(20 * 1024)).toBe("20 KB");
    expect(formatBytes(5 * 1024 * 1024)).toBe("5.0 MB");
    expect(formatBytes(3 * 1024 * 1024 * 1024)).toBe("3.0 GB");
  });
});
