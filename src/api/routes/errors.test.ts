import { describe, it, expect, beforeEach, afterEach, spyOn } from "bun:test";
import { Database } from "bun:sqlite";
import { initSchema } from "@/data/db/migrations";
import { createErrorsRoute } from "@/api/routes/errors";
import { getErrors } from "@/api/services/errors";

const NOW = 1700000000000;
const MS_PER_DAY = 86400000;

function insertErrorSession(
  db: Database,
  id: string,
  startedAt: number,
  errorType: string,
  errorMessage: string,
) {
  db.run(
    `INSERT INTO sessions (
      id, started_at, messages_total, status, created_at, error_type, error_message
    ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [id, startedAt, 1, "error", startedAt, errorType, errorMessage]
  );
}

describe("getErrors", () => {
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

  it("returns all error sessions when days is omitted", () => {
    insertErrorSession(db, "err-1", NOW - 1 * MS_PER_DAY, "rate_limit", "Limit hit");
    insertErrorSession(db, "err-2", NOW - 30 * MS_PER_DAY, "timeout", "Timed out");

    const result = getErrors(db);

    expect(result.total).toBe(2);
    expect(result.errors).toHaveLength(2);
    expect(result.byType.rate_limit).toBe(1);
    expect(result.byType.timeout).toBe(1);
    expect(result.daily).toHaveLength(2);
  });

  it("filters by days and aggregates by type", () => {
    insertErrorSession(db, "old", NOW - 30 * MS_PER_DAY, "api_error", "Old error");
    insertErrorSession(db, "recent-1", NOW - 1 * MS_PER_DAY, "rate_limit", "Recent limit");
    insertErrorSession(db, "recent-2", NOW - 1 * MS_PER_DAY, "rate_limit", "Another limit");

    const result = getErrors(db, 7);

    expect(result.total).toBe(2);
    expect(result.byType.rate_limit).toBe(2);
    expect(result.byType.api_error).toBe(0);
    expect(result.daily).toHaveLength(1);
    expect(result.daily[0].count).toBe(2);
  });
});

describe("GET /api/errors", () => {
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

  it("returns error stats as JSON", async () => {
    insertErrorSession(db, "err-1", NOW - 1 * MS_PER_DAY, "context_length", "Too long");
    insertErrorSession(db, "err-2", NOW - 2 * MS_PER_DAY, "timeout", "Timeout");

    const app = createErrorsRoute(() => db);
    const res = await app.request("/api/errors");

    expect(res.status).toBe(200);

    const body = (await res.json()) as {
      total: number;
      byType: Record<string, number>;
      daily: Array<{ date: string; count: number }>;
      errors: Array<{ id: string; error_type: string; session_id: string | null }>;
    };

    expect(body.total).toBe(2);
    expect(body.byType.context_length).toBe(1);
    expect(body.byType.timeout).toBe(1);
    expect(body.daily).toHaveLength(2);
    expect(body.errors[0].id).toBe("err-1");
  });

  it("treats invalid days as no filter", async () => {
    insertErrorSession(db, "err-1", NOW - 1 * MS_PER_DAY, "api_error", "Error");

    const app = createErrorsRoute(() => db);
    const res = await app.request("/api/errors?days=abc");

    expect(res.status).toBe(200);

    const body = (await res.json()) as { total: number };
    expect(body.total).toBe(1);
  });
});

describe("getErrors multi-source", () => {
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

  it("includes idle sessions that carry an error_type", () => {
    insertErrorSession(db, "hidden", NOW - 1 * MS_PER_DAY, "rate_limit", "Idle but errored");
    db.run(`UPDATE sessions SET status = 'idle' WHERE id = 'hidden'`);

    const result = getErrors(db);

    expect(result.errors[0].id).toBe("hidden");
    expect(result.errors[0].source).toBe("session");
    expect(result.total).toBeGreaterThanOrEqual(1);
    expect(result.byType.rate_limit).toBe(1);
  });

  it("includes message.error events as event rows", () => {
    insertErrorSession(db, "sess", NOW - 1 * MS_PER_DAY, "rate_limit", "Rate");
    db.run(
      `INSERT INTO events (ts, session_id, type, data) VALUES (?, ?, ?, ?)`,
      [NOW - 1000, "sess", "message.error", JSON.stringify({
        messageID: "m1",
        error: { name: "APIError", message: "mid" },
      })],
    );

    const result = getErrors(db);

    expect(result.total).toBe(2);

    const eventRow = result.errors.find((r) => r.source === "event");
    expect(eventRow).toBeDefined();
    expect(eventRow?.id).toBe("evt-1");
    expect(eventRow?.error_type).toBe("APIError");
    expect(eventRow?.error_message).toBe("mid");
  });

  it("normalizes OpenCode error names to dashboard buckets", () => {
    insertErrorSession(db, "api", NOW - 1 * MS_PER_DAY, "APIError", "API failure");
    insertErrorSession(db, "ctx", NOW - 1 * MS_PER_DAY, "MessageOutputLengthError", "Too long");

    const result = getErrors(db);

    expect(result.total).toBe(2);
    expect(result.byType.api_error).toBe(1);
    expect(result.byType.context_length).toBe(1);
    expect(result.byType.rate_limit).toBe(0);
    expect(result.byType.timeout).toBe(0);
  });

  it("exposes the session id on session error rows", () => {
    insertErrorSession(db, "err-1", NOW - 1 * MS_PER_DAY, "rate_limit", "Limit hit");

    const result = getErrors(db);

    const sessionRow = result.errors.find((r) => r.source === "session");
    expect(sessionRow?.session_id).toBe("err-1");
  });

  it("exposes the linked session id on event error rows", () => {
    insertErrorSession(db, "sess", NOW - 1 * MS_PER_DAY, "rate_limit", "Rate");
    db.run(
      `INSERT INTO events (ts, session_id, type, data) VALUES (?, ?, ?, ?)`,
      [NOW - 1000, "sess", "message.error", JSON.stringify({
        messageID: "m2",
        error: { name: "APIError", message: "linked" },
      })],
    );

    const result = getErrors(db);

    const eventRow = result.errors.find((r) => r.source === "event");
    expect(eventRow?.session_id).toBe("sess");
  });

  it("returns null session_id for orphaned event error rows", () => {
    db.run(
      `INSERT INTO events (ts, session_id, type, data) VALUES (?, ?, ?, ?)`,
      [NOW - 1000, "ghost", "message.error", JSON.stringify({
        messageID: "m3",
        error: { name: "APIError", message: "orphan" },
      })],
    );

    const result = getErrors(db);

    const eventRow = result.errors.find((r) => r.source === "event");
    expect(eventRow?.session_id).toBeNull();
  });
});

describe("getErrors project/branch", () => {
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

  function insertSession(
    id: string,
    directory: string | null,
    branch: string | null,
    errorType: string,
  ) {
    db.run(
      `INSERT INTO sessions (id, started_at, messages_total, status, created_at, error_type, error_message, directory, branch)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [id, NOW - 1000, 1, "error", NOW - 1000, errorType, "Err", directory, branch],
    );
  }

  function insertEvent(sessionId: string, errorName: string) {
    db.run(
      `INSERT INTO events (ts, session_id, type, data) VALUES (?, ?, ?, ?)`,
      [NOW - 500, sessionId, "message.error", JSON.stringify({
        messageID: "e1",
        error: { name: errorName, message: "fail" },
      })],
    );
  }

  it("filters error sessions by project directory", () => {
    insertSession("s1", "/foo", "main", "rate_limit");
    insertSession("s2", "/bar", "main", "timeout");

    const result = getErrors(db, null, "/foo");

    expect(result.total).toBe(1);
    expect(result.errors[0].id).toBe("s1");
    expect(result.errors[0].error_type).toBe("rate_limit");
    expect(result.daily).toHaveLength(1);
  });

  it("filters by project and branch together", () => {
    insertSession("s1", "/foo", "main", "rate_limit");
    insertSession("s2", "/foo", "dev", "timeout");

    const result = getErrors(db, null, "/foo", "main");

    expect(result.total).toBe(1);
    expect(result.errors[0].id).toBe("s1");
  });

  it("filters event errors by project directory via subselect", () => {
    insertSession("s1", "/foo", null, "rate_limit");
    insertEvent("s1", "APIError");
    insertSession("s2", "/bar", null, "timeout");
    insertEvent("s2", "APIError");

    const result = getErrors(db, null, "/foo");

    expect(result.total).toBe(2); // 1 session + 1 event
    expect(result.errors.filter((r) => r.source === "event")).toHaveLength(1);
    expect(result.errors.filter((r) => r.source === "session")).toHaveLength(1);
  });

  it("returns all errors when project is null", () => {
    insertSession("s1", "/foo", null, "rate_limit");
    insertSession("s2", "/bar", null, "timeout");

    const result = getErrors(db);

    expect(result.total).toBe(2);
  });
});

describe("GET /api/errors project/branch", () => {
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

  it("filters by project query param", async () => {
    db.run(
      `INSERT INTO sessions (id, started_at, messages_total, status, created_at, error_type, error_message, directory)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      ["s1", NOW - 1000, 1, "error", NOW - 1000, "rate_limit", "Limit", "/foo"],
    );
    db.run(
      `INSERT INTO sessions (id, started_at, messages_total, status, created_at, error_type, error_message, directory)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      ["s2", NOW - 1000, 1, "error", NOW - 1000, "timeout", "Timeout", "/bar"],
    );

    const app = createErrorsRoute(() => db);
    const res = await app.request("/api/errors?project=/foo");

    expect(res.status).toBe(200);

    const body = (await res.json()) as {
      total: number;
      byType: Record<string, number>;
      daily: Array<{ date: string; count: number }>;
      errors: Array<{ id: string; error_type: string }>;
    };

    expect(body.total).toBe(1);
    expect(body.errors[0].id).toBe("s1");
    expect(body.byType.rate_limit).toBe(1);
    expect(body.daily).toHaveLength(1);
    expect(body.daily[0].count).toBe(1);
  });

  it("filters by project and branch query params", async () => {
    db.run(
      `INSERT INTO sessions (id, started_at, messages_total, status, created_at, error_type, error_message, directory, branch)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ["s1", NOW - 1000, 1, "error", NOW - 1000, "rate_limit", "Limit", "/foo", "main"],
    );
    db.run(
      `INSERT INTO sessions (id, started_at, messages_total, status, created_at, error_type, error_message, directory, branch)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ["s2", NOW - 1000, 1, "error", NOW - 1000, "timeout", "Timeout", "/foo", "dev"],
    );

    const app = createErrorsRoute(() => db);
    const res = await app.request("/api/errors?project=/foo&branch=main");

    expect(res.status).toBe(200);

    const body = (await res.json()) as { total: number };
    expect(body.total).toBe(1);
  });

  it("ignores missing project/branch params (backward compat)", async () => {
    db.run(
      `INSERT INTO sessions (id, started_at, messages_total, status, created_at, error_type, error_message, directory)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      ["s1", NOW - 1000, 1, "error", NOW - 1000, "rate_limit", "Limit", "/foo"],
    );

    const app = createErrorsRoute(() => db);
    const res = await app.request("/api/errors");

    expect(res.status).toBe(200);

    const body = (await res.json()) as { total: number };
    expect(body.total).toBe(1);
  });
});
