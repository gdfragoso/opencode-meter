import { describe, it, expect, beforeEach } from "bun:test";
import { Database } from "bun:sqlite";
import { initSchema } from "@/data/db/migrations";
import { createToolMetricsRoute } from "@/api/routes/tool-metrics";

function createTestDb(): Database {
  const db = new Database(":memory:");
  initSchema(db);
  return db;
}

function insertEventRaw(
  db: Database,
  ts: number,
  sessionID: string,
  type: string,
  data: Record<string, unknown>
): void {
  db.run(
    `INSERT INTO events (ts, session_id, type, data) VALUES (?, ?, ?, ?)`,
    [ts, sessionID, type, JSON.stringify(data)]
  );
}

describe("GET /api/tool-metrics", () => {
  let db: Database;

  beforeEach(() => {
    db = createTestDb();
  });

  it("returns aggregated tool metrics with total_cost > 0 and avg_duration_ms > 0", async () => {
    const now = Date.now();
    db.run(
      `INSERT INTO sessions (id, input_tokens, output_tokens, total_cost) VALUES (?, ?, ?, ?)`,
      ["session-1", 100, 50, 0.42]
    );

    // Step window (1ms) contained in the tool window → full overlap
    insertEventRaw(db, now + 150, "session-1", "step.start", { step: 1 });
    insertEventRaw(db, now + 151, "session-1", "step.finish", {
      step: 1,
      tokens: { input: 100, output: 50 },
      cost: 0.42,
    });

    insertEventRaw(db, now, "session-1", "tool.before", { tool: "test-tool", callID: "test-call" });
    insertEventRaw(db, now + 250, "session-1", "tool.after", { tool: "test-tool", callID: "test-call" });

    const app = createToolMetricsRoute(() => db);
    const res = await app.request("/api/tool-metrics");
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body).toHaveLength(1);
    expect(body[0].tool).toBe("test-tool");
    expect(body[0].calls).toBe(1);
    expect(body[0].avg_duration_ms).toBeGreaterThan(0);
    expect(body[0].total_tokens).toBe(150);
    expect(body[0].total_cost).toBeGreaterThan(0);
    expect(body[0].total_cost).toBeCloseTo(0.42, 5);
  });

  it("filters by ?days=7 returning only recent tools", async () => {
    const now = Date.now();
    const eightDaysAgo = now - 8 * 86400000;
    const fiveDaysAgo = now - 5 * 86400000;

    db.run(
      `INSERT INTO sessions (id, input_tokens, output_tokens, total_cost) VALUES (?, ?, ?, ?)`,
      ["old-session", 1000, 500, 5.0]
    );
    db.run(
      `INSERT INTO sessions (id, input_tokens, output_tokens, total_cost) VALUES (?, ?, ?, ?)`,
      ["new-session", 100, 50, 0.5]
    );

    // Old session: tool + step (filtered out by days=7)
    insertEventRaw(db, eightDaysAgo + 50, "old-session", "step.start", { step: 1 });
    insertEventRaw(db, eightDaysAgo + 51, "old-session", "step.finish", {
      step: 1,
      tokens: { input: 1000, output: 500 },
      cost: 5.0,
    });
    insertEventRaw(db, eightDaysAgo, "old-session", "tool.before", {
      tool: "old-tool",
      callID: "old-call",
    });
    insertEventRaw(db, eightDaysAgo + 100, "old-session", "tool.after", {
      tool: "old-tool",
      callID: "old-call",
    });

    // New session: tool + step (within days=7 window)
    insertEventRaw(db, fiveDaysAgo + 50, "new-session", "step.start", { step: 1 });
    insertEventRaw(db, fiveDaysAgo + 51, "new-session", "step.finish", {
      step: 1,
      tokens: { input: 100, output: 50 },
      cost: 0.5,
    });
    insertEventRaw(db, fiveDaysAgo, "new-session", "tool.before", {
      tool: "new-tool",
      callID: "new-call",
    });
    insertEventRaw(db, fiveDaysAgo + 100, "new-session", "tool.after", {
      tool: "new-tool",
      callID: "new-call",
    });

    const app = createToolMetricsRoute(() => db);
    const res = await app.request("/api/tool-metrics?days=7");
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body).toHaveLength(1);
    expect(body[0].tool).toBe("new-tool");
  });

  it("returns all tools when days is omitted", async () => {
    const now = Date.now();
    db.run(
      `INSERT INTO sessions (id, input_tokens, output_tokens, total_cost) VALUES (?, ?, ?, ?)`,
      ["session-a", 10, 5, 0.1]
    );
    db.run(
      `INSERT INTO sessions (id, input_tokens, output_tokens, total_cost) VALUES (?, ?, ?, ?)`,
      ["session-b", 20, 10, 0.2]
    );

    // Session A: step + tool
    insertEventRaw(db, now + 50, "session-a", "step.start", { step: 1 });
    insertEventRaw(db, now + 51, "session-a", "step.finish", {
      step: 1,
      tokens: { input: 10, output: 5 },
      cost: 0.1,
    });
    insertEventRaw(db, now, "session-a", "tool.before", { tool: "alpha", callID: "alpha-call" });
    insertEventRaw(db, now + 10, "session-a", "tool.after", { tool: "alpha", callID: "alpha-call" });

    // Session B: step + tool
    insertEventRaw(db, now + 1050, "session-b", "step.start", { step: 1 });
    insertEventRaw(db, now + 1051, "session-b", "step.finish", {
      step: 1,
      tokens: { input: 20, output: 10 },
      cost: 0.2,
    });
    insertEventRaw(db, now + 1000, "session-b", "tool.before", { tool: "beta", callID: "beta-call" });
    insertEventRaw(db, now + 1020, "session-b", "tool.after", { tool: "beta", callID: "beta-call" });

    const app = createToolMetricsRoute(() => db);
    const res = await app.request("/api/tool-metrics");
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body).toHaveLength(2);
  });

  it("filters by ?project= reducing tool metrics", async () => {
    const now = Date.now();

    db.run(
      `INSERT INTO sessions (id, directory, branch, input_tokens, output_tokens, total_cost) VALUES (?, ?, ?, ?, ?, ?)`,
      ["proj-ses", "/foo", "main", 100, 50, 0.42]
    );
    db.run(
      `INSERT INTO sessions (id, directory, branch, input_tokens, output_tokens, total_cost) VALUES (?, ?, ?, ?, ?, ?)`,
      ["other-ses", "/bar", "main", 200, 100, 0.84]
    );

    // Project session: tool + step
    insertEventRaw(db, now + 50, "proj-ses", "step.start", { step: 1 });
    insertEventRaw(db, now + 51, "proj-ses", "step.finish", {
      step: 1,
      tokens: { input: 100, output: 50 },
      cost: 0.42,
    });
    insertEventRaw(db, now, "proj-ses", "tool.before", { tool: "proj-tool", callID: "proj-call" });
    insertEventRaw(db, now + 100, "proj-ses", "tool.after", { tool: "proj-tool", callID: "proj-call" });

    // Other session: tool + step
    insertEventRaw(db, now + 2050, "other-ses", "step.start", { step: 1 });
    insertEventRaw(db, now + 2051, "other-ses", "step.finish", {
      step: 1,
      tokens: { input: 200, output: 100 },
      cost: 0.84,
    });
    insertEventRaw(db, now + 2000, "other-ses", "tool.before", { tool: "other-tool", callID: "other-call" });
    insertEventRaw(db, now + 2100, "other-ses", "tool.after", { tool: "other-tool", callID: "other-call" });

    const app = createToolMetricsRoute(() => db);

    // With project filter — only proj-ses matches
    const res = await app.request("/api/tool-metrics?project=/foo");
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toHaveLength(1);
    expect(body[0].tool).toBe("proj-tool");

    // Without project filter — both match
    const resAll = await app.request("/api/tool-metrics");
    expect(resAll.status).toBe(200);
    const bodyAll = await resAll.json();
    expect(bodyAll).toHaveLength(2);
  });

  it("filters by ?branch= reducing tool metrics", async () => {
    const now = Date.now();

    db.run(
      `INSERT INTO sessions (id, directory, branch, input_tokens, output_tokens, total_cost) VALUES (?, ?, ?, ?, ?, ?)`,
      ["branch-main", "/proj", "main", 100, 50, 0.42]
    );
    db.run(
      `INSERT INTO sessions (id, directory, branch, input_tokens, output_tokens, total_cost) VALUES (?, ?, ?, ?, ?, ?)`,
      ["branch-feat", "/proj", "feature-x", 100, 50, 0.42]
    );

    // main branch session
    insertEventRaw(db, now + 50, "branch-main", "step.start", { step: 1 });
    insertEventRaw(db, now + 51, "branch-main", "step.finish", {
      step: 1,
      tokens: { input: 100, output: 50 },
      cost: 0.42,
    });
    insertEventRaw(db, now, "branch-main", "tool.before", { tool: "main-tool", callID: "main-call" });
    insertEventRaw(db, now + 100, "branch-main", "tool.after", { tool: "main-tool", callID: "main-call" });

    // feature-x branch session
    insertEventRaw(db, now + 2050, "branch-feat", "step.start", { step: 1 });
    insertEventRaw(db, now + 2051, "branch-feat", "step.finish", {
      step: 1,
      tokens: { input: 100, output: 50 },
      cost: 0.42,
    });
    insertEventRaw(db, now + 2000, "branch-feat", "tool.before", { tool: "feat-tool", callID: "feat-call" });
    insertEventRaw(db, now + 2100, "branch-feat", "tool.after", { tool: "feat-tool", callID: "feat-call" });

    const app = createToolMetricsRoute(() => db);

    // Filter by branch=main — only main-tool
    const res = await app.request("/api/tool-metrics?branch=main");
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toHaveLength(1);
    expect(body[0].tool).toBe("main-tool");
  });

  it("filters by ?project= and ?branch= combined", async () => {
    const now = Date.now();

    db.run(
      `INSERT INTO sessions (id, directory, branch, input_tokens, output_tokens, total_cost) VALUES (?, ?, ?, ?, ?, ?)`,
      ["match", "/foo", "main", 100, 50, 0.42]
    );
    db.run(
      `INSERT INTO sessions (id, directory, branch, input_tokens, output_tokens, total_cost) VALUES (?, ?, ?, ?, ?, ?)`,
      ["wrong-proj", "/bar", "main", 100, 50, 0.42]
    );
    db.run(
      `INSERT INTO sessions (id, directory, branch, input_tokens, output_tokens, total_cost) VALUES (?, ?, ?, ?, ?, ?)`,
      ["wrong-branch", "/foo", "dev", 100, 50, 0.42]
    );

    for (const sid of ["match", "wrong-proj", "wrong-branch"]) {
      insertEventRaw(db, now + 50, sid, "step.start", { step: 1 });
      insertEventRaw(db, now + 51, sid, "step.finish", {
        step: 1,
        tokens: { input: 100, output: 50 },
        cost: 0.42,
      });
      insertEventRaw(db, now, sid, "tool.before", { tool: sid, callID: sid + "-call" });
      insertEventRaw(db, now + 100, sid, "tool.after", { tool: sid, callID: sid + "-call" });
    }

    const app = createToolMetricsRoute(() => db);
    const res = await app.request("/api/tool-metrics?project=/foo&branch=main");
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toHaveLength(1);
    expect(body[0].tool).toBe("match");
  });
});
