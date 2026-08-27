import { describe, it, expect, beforeEach } from "bun:test";
import { Database } from "bun:sqlite";
import { initSchema } from "@/data/db/migrations";
import { getSessionDetail, getSessionTree, listSessions, getSessionTypes } from "@/api/services/sessions";

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
    started_at?: number;
    title?: string;
  } = {}
): void {
  db.run(
    `INSERT INTO sessions (
      id, agent, model_id, input_tokens, output_tokens, tools_total, duration_ms, total_cost, status, parent_id, child_session_ids, directory, branch, messages_total, started_at, title
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
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
      data.started_at ?? null,
      data.title ?? null,
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

describe("getSessionTree", () => {
  let db: Database;

  const T0 = 1_700_000_000_000;

  /** A `task` call on `parentId`, which is where a routing label comes from. */
  function insertTaskCall(target: Database, parentId: string, ts: number, args: Record<string, unknown>): void {
    target.run(`INSERT INTO events (ts, session_id, type, data) VALUES (?, ?, 'tool.before', ?)`, [
      ts,
      parentId,
      JSON.stringify({ tool: "task", args }),
    ]);
  }

  beforeEach(() => {
    db = createTestDb();
  });

  it("returns an empty tree for a session that does not exist", () => {
    const tree = getSessionTree(db, "missing");

    expect(tree.root).toBeNull();
    expect(tree.ancestorId).toBeNull();
    expect(tree.truncated).toBe(false);
  });

  it("returns a lone session as a root with no children", () => {
    insertSession(db, "root", { started_at: T0, title: "Ship it" });

    const tree = getSessionTree(db, "root");

    expect(tree.root!.id).toBe("root");
    expect(tree.root!.title).toBe("Ship it");
    expect(tree.root!.depth).toBe(0);
    expect(tree.root!.children).toEqual([]);
    expect(tree.ancestorId).toBe("root");
  });

  it("nests children under the parent that spawned them", () => {
    insertSession(db, "root", { started_at: T0 });
    insertSession(db, "child", { started_at: T0 + 1, parent_id: "root" });
    insertSession(db, "grandchild", { started_at: T0 + 2, parent_id: "child" });

    const root = getSessionTree(db, "root").root!;

    expect(root.children.map(c => c.id)).toEqual(["child"]);
    expect(root.children[0]!.children.map(c => c.id)).toEqual(["grandchild"]);
    expect(root.children[0]!.children[0]!.depth).toBe(2);
  });

  it("orders siblings by when they started", () => {
    insertSession(db, "root", { started_at: T0 });
    insertSession(db, "late", { started_at: T0 + 900, parent_id: "root" });
    insertSession(db, "early", { started_at: T0 + 100, parent_id: "root" });

    expect(getSessionTree(db, "root").root!.children.map(c => c.id)).toEqual(["early", "late"]);
  });

  // Same union getSessionDetail does, so the tree can never show fewer
  // subagents than the flat list on the same page.
  it("picks up a child that only child_session_ids knows about", () => {
    insertSession(db, "root", { started_at: T0, child_session_ids: JSON.stringify(["orphan"]) });
    insertSession(db, "orphan", { started_at: T0 + 1 });

    expect(getSessionTree(db, "root").root!.children.map(c => c.id)).toEqual(["orphan"]);
  });

  it("lists a child reached by both links only once", () => {
    insertSession(db, "root", { started_at: T0, child_session_ids: JSON.stringify(["child"]) });
    insertSession(db, "child", { started_at: T0 + 1, parent_id: "root" });

    expect(getSessionTree(db, "root").root!.children).toHaveLength(1);
  });

  describe("subtree totals", () => {
    beforeEach(() => {
      insertSession(db, "root", { started_at: T0, input_tokens: 100, output_tokens: 10, total_cost: 1, tools_total: 2, duration_ms: 1000 });
      insertSession(db, "a", { started_at: T0 + 1, parent_id: "root", input_tokens: 50, output_tokens: 5, total_cost: 0.5, tools_total: 3, duration_ms: 500 });
      insertSession(db, "b", { started_at: T0 + 2, parent_id: "a", input_tokens: 20, output_tokens: 2, total_cost: 0.25, tools_total: 1, duration_ms: 250 });
    });

    it("counts the node and everything below it", () => {
      const root = getSessionTree(db, "root").root!;

      expect(root.subtree.sessions).toBe(3);
      expect(root.subtree.tokens).toBe(187);
      expect(root.subtree.cost).toBeCloseTo(1.75, 5);
      expect(root.subtree.tools).toBe(6);
      expect(root.subtree.durationMs).toBe(1750);
    });

    it("leaves each node's own numbers untouched beside the rolled-up ones", () => {
      const root = getSessionTree(db, "root").root!;

      expect(root.total_cost).toBeCloseTo(1, 5);
      expect(root.tools_total).toBe(2);
    });

    it("rolls up per branch, not only at the root", () => {
      const branch = getSessionTree(db, "root").root!.children[0]!;

      expect(branch.subtree.sessions).toBe(2);
      expect(branch.subtree.cost).toBeCloseTo(0.75, 5);
    });
  });

  describe("routing labels", () => {
    it("labels a child with the category of the task call that preceded it", () => {
      insertSession(db, "root", { started_at: T0 });
      insertTaskCall(db, "root", T0 + 10, { category: "refactor" });
      insertSession(db, "child", { started_at: T0 + 20, parent_id: "root" });

      expect(getSessionTree(db, "root").root!.children[0]!.routingLabel).toBe("refactor");
    });

    it("uses the task call closest before the child, not the newest one", () => {
      insertSession(db, "root", { started_at: T0 });
      insertTaskCall(db, "root", T0 + 10, { category: "first" });
      insertSession(db, "child", { started_at: T0 + 20, parent_id: "root" });
      insertTaskCall(db, "root", T0 + 30, { category: "second" });

      expect(getSessionTree(db, "root").root!.children[0]!.routingLabel).toBe("first");
    });

    it("leaves the root unlabelled — nothing delegated to it", () => {
      insertSession(db, "root", { started_at: T0 });
      insertTaskCall(db, "root", T0 - 10, { category: "refactor" });

      expect(getSessionTree(db, "root").root!.routingLabel).toBeNull();
    });

    it("is null when the parent made no task call", () => {
      insertSession(db, "root", { started_at: T0 });
      insertSession(db, "child", { started_at: T0 + 20, parent_id: "root" });

      expect(getSessionTree(db, "root").root!.children[0]!.routingLabel).toBeNull();
    });
  });

  describe("depth cap", () => {
    beforeEach(() => {
      insertSession(db, "d0", { started_at: T0 });
      insertSession(db, "d1", { started_at: T0 + 1, parent_id: "d0" });
      insertSession(db, "d2", { started_at: T0 + 2, parent_id: "d1" });
      insertSession(db, "d3", { started_at: T0 + 3, parent_id: "d2" });
    });

    it("cuts the tree at maxDepth and says so", () => {
      const tree = getSessionTree(db, "d0", 2);

      expect(tree.truncated).toBe(true);
      expect(tree.root!.children[0]!.children[0]!.id).toBe("d2");
      expect(tree.root!.children[0]!.children[0]!.children).toEqual([]);
    });

    it("does not claim truncation when the whole tree fits", () => {
      expect(getSessionTree(db, "d0", 5).truncated).toBe(false);
    });

    // The cut is below the cap, so a subtree total at the cap must not silently
    // include a level the caller cannot see.
    it("counts only the sessions it returns", () => {
      expect(getSessionTree(db, "d0", 2).root!.subtree.sessions).toBe(3);
    });
  });

  describe("opened on a subagent", () => {
    beforeEach(() => {
      insertSession(db, "root", { started_at: T0 });
      insertSession(db, "child", { started_at: T0 + 1, parent_id: "root" });
      insertSession(db, "grandchild", { started_at: T0 + 2, parent_id: "child" });
    });

    it("roots the tree at the session that was asked for", () => {
      const tree = getSessionTree(db, "child");

      expect(tree.root!.id).toBe("child");
      expect(tree.root!.children.map(c => c.id)).toEqual(["grandchild"]);
    });

    it("reports the top of the chain so the caller can climb", () => {
      expect(getSessionTree(db, "child").ancestorId).toBe("root");
    });
  });

  // A corrupt parent_id chain is the one input that could hang the request.
  it("survives a cycle", () => {
    insertSession(db, "a", { started_at: T0, parent_id: "b" });
    insertSession(db, "b", { started_at: T0 + 1, parent_id: "a" });

    const tree = getSessionTree(db, "a");

    expect(tree.root!.id).toBe("a");
    expect(tree.root!.children.map(c => c.id)).toEqual(["b"]);
    expect(tree.root!.children[0]!.children).toEqual([]);
    expect(tree.root!.subtree.sessions).toBe(2);
  });

  it("does not choke on a child_session_ids value that is neither JSON nor a list", () => {
    insertSession(db, "root", { started_at: T0, child_session_ids: '{"not":"an array"}' });

    expect(() => getSessionTree(db, "root")).not.toThrow();
    expect(getSessionTree(db, "root").root!.children).toEqual([]);
  });
});
