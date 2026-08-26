import { describe, expect, it, beforeEach, afterEach, spyOn, mock } from "bun:test";
import { Database } from "bun:sqlite";
import { initSchema } from "@/data/db/migrations";
import { MS_PER_DAY, NOW, insertSession } from "@/data/repositories/session.test";
import { insertSkillEvent, insertToolEvent } from "@/data/repositories/event.test";

describe("API routes ?days=N parsing", () => {
  let db: Database;
  let nowSpy: ReturnType<typeof spyOn>;

  beforeEach(async () => {
    db = new Database(":memory:");
    initSchema(db);
    nowSpy = spyOn(Date, "now").mockReturnValue(NOW);
    mock.module("@/data/db/connection", () => ({
      getDb: () => db,
      DB_PATH: ":memory:",
    }));
  });

  afterEach(() => {
    nowSpy.mockRestore();
    db.close();
  });

  it("GET /api/sessions?days=7 filters by recent window", async () => {
    insertSession(db, "old", NOW - 30 * MS_PER_DAY);
    insertSession(db, "recent", NOW - 1 * MS_PER_DAY);

    const { default: route } = await import("@/api/routes/sessions");
    const res = await route.fetch(new Request("http://localhost/api/sessions?days=7"));
    expect(res.status).toBe(200);
    const json = (await res.json()) as { sessions: Array<{ id: string }>; total: number };
    expect(json.sessions.map((s) => s.id)).toEqual(["recent"]);
    expect(json.total).toBe(1);
  });

  it("GET /api/sessions?days=abc treats invalid value as no filter", async () => {
    insertSession(db, "old", NOW - 30 * MS_PER_DAY);
    insertSession(db, "recent", NOW - 1 * MS_PER_DAY);

    const { default: route } = await import("@/api/routes/sessions");
    const res = await route.fetch(new Request("http://localhost/api/sessions?days=abc&limit=100"));
    expect(res.status).toBe(200);
    const json = (await res.json()) as { sessions: Array<{ id: string }>; total: number };
    expect(json.sessions.map((s) => s.id).sort()).toEqual(["old", "recent"]);
    expect(json.total).toBe(2);
  });

  it("GET /api/sessions?days=400 clamps to no filter", async () => {
    insertSession(db, "old", NOW - 30 * MS_PER_DAY);

    const { default: route } = await import("@/api/routes/sessions");
    const res = await route.fetch(new Request("http://localhost/api/sessions?days=400"));
    expect(res.status).toBe(200);
    const json = (await res.json()) as { sessions: Array<{ id: string }>; total: number };
    expect(json.sessions.map((s) => s.id)).toEqual(["old"]);
    expect(json.total).toBe(1);
  });

  it("GET /api/summary?days=7 aggregates only recent sessions", async () => {
    insertSession(db, "old", NOW - 30 * MS_PER_DAY, {
      inputTokens: 100,
      outputTokens: 50,
    });
    insertSession(db, "recent", NOW - 1 * MS_PER_DAY, {
      inputTokens: 10,
      outputTokens: 5,
    });

    const { default: route } = await import("@/api/routes/summary");
    const res = await route.fetch(new Request("http://localhost/api/summary?days=7"));
    expect(res.status).toBe(200);
    const json = (await res.json()) as { totalSessions: number; totalTokens: number };
    expect(json.totalSessions).toBe(1);
    expect(json.totalTokens).toBe(15);
  });

  it("GET /api/summary?project=/foo filters by project directory", async () => {
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
    });

    const { default: route } = await import("@/api/routes/summary");
    const res = await route.fetch(new Request("http://localhost/api/summary?project=/foo"));
    expect(res.status).toBe(200);
    const json = (await res.json()) as {
      totalSessions: number;
      totalTokens: number;
      totalCost: number;
      topModels: Array<{ model_id: string }>;
      topAgents: Array<{ agent: string }>;
    };
    expect(json.totalSessions).toBe(1);
    expect(json.totalTokens).toBe(100);
    expect(json.totalCost).toBeCloseTo(1, 5);
    expect(json.topModels).toHaveLength(1);
    expect(json.topModels[0].model_id).toBe("model-x");
    expect(json.topAgents).toHaveLength(1);
    expect(json.topAgents[0].agent).toBe("agent-a");
  });

  it("GET /api/summary?branch=main filters by branch", async () => {
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
    });

    const { default: route } = await import("@/api/routes/summary");
    const res = await route.fetch(new Request("http://localhost/api/summary?branch=main"));
    expect(res.status).toBe(200);
    const json = (await res.json()) as { totalSessions: number; totalTokens: number };
    expect(json.totalSessions).toBe(1);
    expect(json.totalTokens).toBe(100);
  });

  it("GET /api/summary?project=/foo&branch=main filters by both", async () => {
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
    });
    insertSession(db, "wrong-branch", NOW - 1 * MS_PER_DAY, {
      directory: "/foo",
      branch: "feature/x",
    });

    const { default: route } = await import("@/api/routes/summary");
    const res = await route.fetch(
      new Request("http://localhost/api/summary?project=/foo&branch=main")
    );
    expect(res.status).toBe(200);
    const json = (await res.json()) as { totalSessions: number };
    expect(json.totalSessions).toBe(1);
  });

  it("GET /api/summary without project/branch returns all sessions", async () => {
    insertSession(db, "s1", NOW - 1 * MS_PER_DAY, {
      directory: "/foo",
      branch: "main",
    });
    insertSession(db, "s2", NOW - 1 * MS_PER_DAY, {
      directory: "/bar",
      branch: "feature/x",
    });

    const { default: route } = await import("@/api/routes/summary");
    const res = await route.fetch(new Request("http://localhost/api/summary"));
    expect(res.status).toBe(200);
    const json = (await res.json()) as { totalSessions: number };
    expect(json.totalSessions).toBe(2);
  });

  it("GET /api/skills?days=7 filters skill events", async () => {
    insertSession(db, "old-session", NOW - 30 * MS_PER_DAY);
    insertSession(db, "recent-session", NOW - 1 * MS_PER_DAY);
    insertSkillEvent(db, "old-session", NOW - 30 * MS_PER_DAY, "skill-a", "skills.called");
    insertSkillEvent(db, "recent-session", NOW - 1 * MS_PER_DAY, "skill-a", "skills.loaded");

    const { default: route } = await import("@/api/routes/skills");
    const res = await route.fetch(new Request("http://localhost/api/skills?days=7"));
    expect(res.status).toBe(200);
    const json = (await res.json()) as { topSkills: Array<{ name: string; count: number }> };
    expect(json.topSkills.find((s) => s.name === "skill-a")?.count).toBe(1);
  });

  it("GET /api/tools/overview?days=7 filters tool events", async () => {
    insertSession(db, "old-session", NOW - 30 * MS_PER_DAY);
    insertSession(db, "recent-session", NOW - 1 * MS_PER_DAY);
    insertToolEvent(db, "old-session", NOW - 30 * MS_PER_DAY, "tool-a");
    insertToolEvent(db, "recent-session", NOW - 1 * MS_PER_DAY, "tool-a");

    const { default: route } = await import("@/api/routes/tools");
    const res = await route.fetch(new Request("http://localhost/api/tools/overview?days=7"));
    expect(res.status).toBe(200);
    const json = (await res.json()) as Array<{ name: string; count: number }>;
    expect(json.find((t) => t.name === "tool-a")?.count).toBe(1);
  });
});
