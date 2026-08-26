import { describe, it, expect, beforeEach } from "bun:test";
import { Database } from "bun:sqlite";
import { initSchema } from "@/data/db/migrations";
import { getSessionDetail, listSessions, getSessionTypes } from "@/api/services/sessions";

function createTestDb(): Database {
  const db = new Database(":memory:");
  initSchema(db);
  return db;
}

function insertSession(
  db: Database,
  id: string,
  data: {
    agent?: string | null;
    model_id?: string | null;
    input_tokens?: number;
    output_tokens?: number;
    tools_total?: number;
    duration_ms?: number;
    total_cost?: number;
    status?: string | null;
    parent_id?: string | null;
    child_session_ids?: string | null;
    directory?: string | null;
    branch?: string | null;
    messages_total?: number;
  } = {}
): void {
  db.run(
    `INSERT INTO sessions (
      id, agent, model_id, input_tokens, output_tokens, tools_total, duration_ms, total_cost, status, parent_id, child_session_ids, directory, branch, messages_total
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      id,
      data.agent ?? null,
      data.model_id ?? null,
      data.input_tokens ?? 0,
      data.output_tokens ?? 0,
      data.tools_total ?? 0,
      data.duration_ms ?? 0,
      data.total_cost ?? 0,
      data.status ?? "completed",
      data.parent_id ?? null,
      data.child_session_ids ?? null,
      data.directory ?? null,
      data.branch ?? null,
      data.messages_total ?? 1, // default to 1 so active-filter passes
    ]
  );
}

describe("getSessionDetail", () => {
  let db: Database;

  beforeEach(() => {
    db = createTestDb();
  });

  it("returns subagents listed in child_session_ids JSON array", () => {
    insertSession(db, "parent", { child_session_ids: JSON.stringify(["child-a", "child-b"]) });
    insertSession(db, "child-a", { agent: "agent-a", model_id: "model-a", total_cost: 0.5 });
    insertSession(db, "child-b", { agent: "agent-b", model_id: "model-b", total_cost: 1.5 });

    const detail = getSessionDetail(db, "parent");
    expect(detail).not.toBeNull();
    expect(detail!.subagents.map(s => s.id).sort()).toEqual(["child-a", "child-b"]);
    const childA = detail!.subagents.find(s => s.id === "child-a");
    expect(childA?.agent).toBe("agent-a");
    expect(childA?.model_id).toBe("model-a");
    expect(childA?.total_cost).toBeCloseTo(0.5, 5);
  });

  it("merges subagents found via parent_id that are not in child_session_ids", () => {
    insertSession(db, "parent", { child_session_ids: JSON.stringify(["tracked"]) });
    insertSession(db, "tracked", { agent: "agent-tracked" });
    insertSession(db, "untracked", { agent: "agent-untracked", parent_id: "parent" });

    const detail = getSessionDetail(db, "parent");
    expect(detail).not.toBeNull();
    expect(detail!.subagents.map(s => s.id).sort()).toEqual(["tracked", "untracked"]);
  });

  it("does not duplicate a child present in both child_session_ids and parent_id", () => {
    insertSession(db, "parent", { child_session_ids: JSON.stringify(["child"]) });
    insertSession(db, "child", { agent: "agent-child", parent_id: "parent" });

    const detail = getSessionDetail(db, "parent");
    expect(detail).not.toBeNull();
    expect(detail!.subagents).toHaveLength(1);
    expect(detail!.subagents[0].id).toBe("child");
  });

  it("handles an empty child_session_ids array without throwing and returns parent_id children", () => {
    insertSession(db, "parent", { child_session_ids: "[]" });
    insertSession(db, "child", { agent: "agent-child", parent_id: "parent" });

    const detail = getSessionDetail(db, "parent");
    expect(detail).not.toBeNull();
    expect(detail!.subagents.map(s => s.id)).toEqual(["child"]);
  });

  it("falls back to comma-split when child_session_ids is invalid JSON", () => {
    insertSession(db, "parent", { child_session_ids: "child-a,child-b" });
    insertSession(db, "child-a", { agent: "agent-a" });
    insertSession(db, "child-b", { agent: "agent-b" });

    const detail = getSessionDetail(db, "parent");
    expect(detail).not.toBeNull();
    expect(detail!.subagents.map(s => s.id).sort()).toEqual(["child-a", "child-b"]);
  });

  it("returns null when the session does not exist", () => {
    expect(getSessionDetail(db, "missing")).toBeNull();
  });
});

describe("listSessions with project/branch filtering", () => {
  let db: Database;

  beforeEach(() => {
    db = createTestDb();
    insertSession(db, "s1", { directory: "/proj/a", branch: "main", status: "completed" });
    insertSession(db, "s2", { directory: "/proj/a", branch: "dev", status: "completed" });
    insertSession(db, "s3", { directory: "/proj/b", branch: "main", status: "completed" });
    insertSession(db, "s4", { directory: null, branch: null, status: "completed" });
  });

  it("returns all sessions when project and branch are null", () => {
    const { rows, total } = listSessions(db, { limit: 50, offset: 0, days: null, search: null, status: null, rootOnly: false, project: null, branch: null });
    expect(total).toBe(4);
    expect(rows.map(r => r.id).sort()).toEqual(["s1", "s2", "s3", "s4"]);
  });

  it("filters by project (directory)", () => {
    const { rows, total } = listSessions(db, { limit: 50, offset: 0, days: null, search: null, status: null, rootOnly: false, project: "/proj/a", branch: null });
    expect(total).toBe(2);
    expect(rows.map(r => r.id).sort()).toEqual(["s1", "s2"]);
  });

  it("filters by branch", () => {
    const { rows, total } = listSessions(db, { limit: 50, offset: 0, days: null, search: null, status: null, rootOnly: false, project: null, branch: "main" });
    expect(total).toBe(2);
    expect(rows.map(r => r.id).sort()).toEqual(["s1", "s3"]);
  });

  it("filters by both project and branch", () => {
    const { rows, total } = listSessions(db, { limit: 50, offset: 0, days: null, search: null, status: null, rootOnly: false, project: "/proj/a", branch: "main" });
    expect(total).toBe(1);
    expect(rows[0].id).toBe("s1");
  });

  it("returns empty when project matches no sessions", () => {
    const { rows, total } = listSessions(db, { limit: 50, offset: 0, days: null, search: null, status: null, rootOnly: false, project: "/nonexistent", branch: null });
    expect(total).toBe(0);
    expect(rows).toEqual([]);
  });
});

describe("getSessionTypes with project/branch filtering", () => {
  let db: Database;

  beforeEach(() => {
    db = createTestDb();
    insertSession(db, "m1", { directory: "/proj/a", branch: "main", parent_id: null, status: "completed" });
    insertSession(db, "c1", { directory: "/proj/a", branch: "main", parent_id: "m1", status: "completed" });
    insertSession(db, "m2", { directory: "/proj/b", branch: "main", parent_id: null, status: "completed" });
    insertSession(db, "c2", { directory: "/proj/b", branch: "main", parent_id: "m2", status: "completed" });
  });

  it("returns all types when project/branch are null", () => {
    const result = getSessionTypes(db, null, null, null);
    expect(result.main).toBe(2);
    expect(result.subagent).toBe(2);
  });

  it("filters types by project", () => {
    const result = getSessionTypes(db, null, "/proj/a", null);
    expect(result.main).toBe(1);
    expect(result.subagent).toBe(1);
  });

  it("filters types by branch", () => {
    const result = getSessionTypes(db, null, null, "main");
    expect(result.main).toBe(2);
    expect(result.subagent).toBe(2);
  });
});
