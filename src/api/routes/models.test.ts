import { describe, it, expect, beforeEach } from "bun:test";
import { Database } from "bun:sqlite";
import { initSchema } from "@/data/db/migrations";
import { createModelsRoute } from "@/api/routes/models";

function createTestDb(): Database {
  const db = new Database(":memory:");
  initSchema(db);
  return db;
}

function insertSession(
  db: Database,
  id: string,
  overrides: {
    directory?: string;
    branch?: string;
    model_id?: string;
    provider_id?: string;
    agent?: string;
    started_at?: number;
    input_tokens?: number;
    output_tokens?: number;
    total_cost?: number;
  } = {}
): void {
  db.run(
    `INSERT INTO sessions (id, directory, branch, model_id, provider_id, agent, started_at, input_tokens, output_tokens, total_cost)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      id,
      overrides.directory ?? "/default/project",
      overrides.branch ?? "main",
      overrides.model_id ?? "gpt-4",
      overrides.provider_id ?? "openai",
      overrides.agent ?? "default",
      overrides.started_at ?? Date.now(),
      overrides.input_tokens ?? 100,
      overrides.output_tokens ?? 50,
      overrides.total_cost ?? 0.01,
    ]
  );
}

describe("GET /api/models", () => {
  let db: Database;

  beforeEach(() => {
    db = createTestDb();
  });

  it("returns all models grouped by model_id/provider_id", async () => {
    insertSession(db, "s1", { directory: "/proj-a", branch: "main", model_id: "gpt-4", provider_id: "openai" });
    insertSession(db, "s2", { directory: "/proj-a", branch: "main", model_id: "gpt-4", provider_id: "openai" });
    insertSession(db, "s3", { directory: "/proj-b", branch: "dev", model_id: "claude-3", provider_id: "anthropic" });

    const app = createModelsRoute(() => db);
    const res = await app.request("/api/models");
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.models).toHaveLength(2);

    const gpt4 = body.models.find((m: { model_id: string }) => m.model_id === "gpt-4");
    expect(gpt4).toBeDefined();
    expect(gpt4.sessions).toBe(2);

    const claude = body.models.find((m: { model_id: string }) => m.model_id === "claude-3");
    expect(claude).toBeDefined();
    expect(claude.sessions).toBe(1);
  });

  it("filters by ?project returning only sessions with that directory", async () => {
    insertSession(db, "s1", { directory: "/proj-a", branch: "main", model_id: "gpt-4", provider_id: "openai" });
    insertSession(db, "s2", { directory: "/proj-b", branch: "main", model_id: "claude-3", provider_id: "anthropic" });

    const app = createModelsRoute(() => db);
    const res = await app.request("/api/models?project=/proj-a");
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.models).toHaveLength(1);
    expect(body.models[0].model_id).toBe("gpt-4");
  });

  it("filters by ?branch returning only sessions with that branch", async () => {
    insertSession(db, "s1", { directory: "/proj-a", branch: "main", model_id: "gpt-4", provider_id: "openai" });
    insertSession(db, "s2", { directory: "/proj-a", branch: "dev", model_id: "claude-3", provider_id: "anthropic" });

    const app = createModelsRoute(() => db);
    const res = await app.request("/api/models?branch=dev");
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.models).toHaveLength(1);
    expect(body.models[0].model_id).toBe("claude-3");
  });

  it("filters by both ?project and ?branch together", async () => {
    insertSession(db, "s1", { directory: "/proj-a", branch: "main", model_id: "gpt-4", provider_id: "openai" });
    insertSession(db, "s2", { directory: "/proj-a", branch: "dev", model_id: "gpt-4", provider_id: "openai" });
    insertSession(db, "s3", { directory: "/proj-b", branch: "main", model_id: "claude-3", provider_id: "anthropic" });

    const app = createModelsRoute(() => db);
    const res = await app.request("/api/models?project=/proj-a&branch=main");
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.models).toHaveLength(1);
    expect(body.models[0].model_id).toBe("gpt-4");
    expect(body.models[0].sessions).toBe(1);
  });

  it("returns all models when project and branch are omitted (no regression)", async () => {
    insertSession(db, "s1", { directory: "/proj-a", branch: "main", model_id: "gpt-4", provider_id: "openai" });
    insertSession(db, "s2", { directory: "/proj-b", branch: "dev", model_id: "claude-3", provider_id: "anthropic" });

    const app = createModelsRoute(() => db);
    const res = await app.request("/api/models");
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.models).toHaveLength(2);
  });
});