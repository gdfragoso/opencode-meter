import { describe, it, expect, beforeEach } from "bun:test";
import { Database } from "bun:sqlite";
import { initSchema } from "@/data/db/migrations";
import { createProjectsRoute } from "@/api/routes/projects";

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
    started_at?: number;
    total_cost?: number;
  } = {}
): void {
  db.run(
    `INSERT INTO sessions (id, directory, branch, model_id, provider_id, agent, started_at, input_tokens, output_tokens, total_cost)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      id,
      overrides.directory ?? "/proj-a",
      overrides.branch ?? "main",
      "gpt-4",
      "openai",
      "default",
      overrides.started_at ?? Date.now(),
      100,
      50,
      overrides.total_cost ?? 0.01,
    ]
  );
}

describe("GET /api/projects", () => {
  let db: Database;

  beforeEach(() => {
    db = createTestDb();
  });

  it("returns projects ordered by total_cost DESC", async () => {
    insertSession(db, "s1", { directory: "/proj-a", branch: "main", total_cost: 0.05 });
    insertSession(db, "s2", { directory: "/proj-a", branch: "main", total_cost: 0.10 });
    insertSession(db, "s3", { directory: "/proj-b", branch: "dev", total_cost: 0.20 });

    const app = createProjectsRoute(() => db);
    const res = await app.request("/api/projects");
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body).toHaveLength(2);

    // /proj-b has higher total_cost (0.20) than /proj-a (0.15)
    expect(body[0].directory).toBe("/proj-b");
    expect(body[0].total_cost).toBeCloseTo(0.20);
    expect(body[1].directory).toBe("/proj-a");
    expect(body[1].total_cost).toBeCloseTo(0.15);
  });

  it("returns 200 with ?days=abc (invalid) — no crash, returns all", async () => {
    insertSession(db, "s1", { directory: "/proj-a", branch: "main", total_cost: 0.05 });
    insertSession(db, "s2", { directory: "/proj-b", branch: "dev", total_cost: 0.10 });

    const app = createProjectsRoute(() => db);
    const res = await app.request("/api/projects?days=abc");
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body).toHaveLength(2);
  });

  it("filters by ?days=1 returning only recent sessions", async () => {
    const now = Date.now();
    const old = now - 2 * 86400000; // 2 days ago

    insertSession(db, "s1", { directory: "/proj-a", branch: "main", started_at: now, total_cost: 0.05 });
    insertSession(db, "s2", { directory: "/proj-b", branch: "dev", started_at: old, total_cost: 0.10 });

    const app = createProjectsRoute(() => db);
    const res = await app.request("/api/projects?days=1");
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body).toHaveLength(1);
    expect(body[0].directory).toBe("/proj-a");
  });
});

describe("GET /api/projects/:directory", () => {
  let db: Database;

  beforeEach(() => {
    db = createTestDb();
  });

  it("returns project detail for a valid encoded directory", async () => {
    insertSession(db, "s1", { directory: "/proj-a", branch: "main", total_cost: 0.05 });
    insertSession(db, "s2", { directory: "/proj-a", branch: "dev", total_cost: 0.10 });

    const app = createProjectsRoute(() => db);
    const res = await app.request(`/api/projects/${encodeURIComponent("/proj-a")}`);
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body).not.toBeNull();
    expect(body.directory).toBe("/proj-a");
    expect(body.sessions).toBe(2);
    expect(body.branch_count).toBe(2);
    expect(body.branch_summaries).toHaveLength(2);
    expect(body.models).toHaveLength(1);
    expect(body.models[0].model_id).toBe("gpt-4");
  });

  it("returns null for a non-existent directory", async () => {
    insertSession(db, "s1", { directory: "/proj-a", branch: "main" });

    const app = createProjectsRoute(() => db);
    const res = await app.request(`/api/projects/${encodeURIComponent("/nonexistent")}`);
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body).toBeNull();
  });

  it("respects ?days= filter on the detail endpoint", async () => {
    const now = Date.now();
    const old = now - 2 * 86400000; // 2 days ago

    insertSession(db, "s1", { directory: "/proj-a", branch: "main", started_at: now, total_cost: 0.05 });
    insertSession(db, "s2", { directory: "/proj-a", branch: "dev", started_at: old, total_cost: 0.10 });

    const app = createProjectsRoute(() => db);
    const res = await app.request(`/api/projects/${encodeURIComponent("/proj-a")}?days=1`);
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body).not.toBeNull();
    expect(body.sessions).toBe(1); // only the recent session within 1 day
    expect(body.branch_count).toBe(1);
  });

  it("handles deeply nested directory paths with slashes", async () => {
    insertSession(db, "s1", { directory: "/Users/fragoso/projects/deep", branch: "main" });

    const app = createProjectsRoute(() => db);
    const encoded = encodeURIComponent("/Users/fragoso/projects/deep");
    const res = await app.request(`/api/projects/${encoded}`);
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body).not.toBeNull();
    expect(body.directory).toBe("/Users/fragoso/projects/deep");
  });
});