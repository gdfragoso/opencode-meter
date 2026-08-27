import { afterEach, describe, expect, it } from "bun:test";
import { cleanup, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import DelegationTree, { delegatedTotals, flattenTree, nodeLabel } from "./DelegationTree";
import type { SessionTreeNode, SessionTreeResponse } from "@/data/domain/session";

afterEach(cleanup);

function node(id: string, over: Partial<SessionTreeNode> = {}): SessionTreeNode {
  const children = over.children ?? [];
  const own = {
    input_tokens: over.input_tokens ?? 0,
    output_tokens: over.output_tokens ?? 0,
    total_cost: over.total_cost ?? 0,
    tools_total: over.tools_total ?? 0,
    duration_ms: over.duration_ms ?? 0,
  };
  // Mirrors what the service computes, so a fixture cannot drift into a state
  // the API would never produce.
  const subtree = children.reduce(
    (acc, child) => ({
      sessions: acc.sessions + child.subtree.sessions,
      tokens: acc.tokens + child.subtree.tokens,
      cost: acc.cost + child.subtree.cost,
      tools: acc.tools + child.subtree.tools,
      durationMs: acc.durationMs + child.subtree.durationMs,
    }),
    {
      sessions: 1,
      tokens: own.input_tokens + own.output_tokens,
      cost: own.total_cost,
      tools: own.tools_total,
      durationMs: own.duration_ms,
    }
  );

  return {
    id,
    title: null,
    agent: null,
    model_id: null,
    status: null,
    session_type: "main",
    started_at: 1000,
    depth: 0,
    routingLabel: null,
    ...own,
    ...over,
    children,
    subtree: over.subtree ?? subtree,
  };
}

function tree(root: SessionTreeNode | null, over: Partial<SessionTreeResponse> = {}): SessionTreeResponse {
  return { root, ancestorId: root?.id ?? null, truncated: false, ...over };
}

function renderTree(response: SessionTreeResponse | null, currentId = "root", loading = false) {
  return render(
    <MemoryRouter>
      <DelegationTree tree={response} loading={loading} currentId={currentId} />
    </MemoryRouter>
  );
}

describe("flattenTree", () => {
  it("returns nothing for a missing root", () => {
    expect(flattenTree(null)).toEqual([]);
    expect(flattenTree(undefined)).toEqual([]);
  });

  it("gives the root no prefix", () => {
    expect(flattenTree(node("root"))).toEqual([{ node: expect.anything(), prefix: "" }]);
  });

  it("returns rows in depth-first order", () => {
    const root = node("root", {
      children: [node("a", { children: [node("a1")] }), node("b")],
    });

    expect(flattenTree(root).map(r => r.node.id)).toEqual(["root", "a", "a1", "b"]);
  });

  it("closes the last sibling with an elbow and the others with a tee", () => {
    const root = node("root", { children: [node("a"), node("b")] });

    expect(flattenTree(root).map(r => r.prefix)).toEqual(["", "├─ ", "└─ "]);
  });

  // The bar under a non-last sibling is what connects it to the sibling below;
  // getting this wrong is the classic tree-drawing bug.
  it("carries a bar past the descendants of a sibling that is not last", () => {
    const root = node("root", {
      children: [node("a", { children: [node("a1")] }), node("b")],
    });

    expect(flattenTree(root).map(r => r.prefix)).toEqual(["", "├─ ", "│  └─ ", "└─ "]);
  });

  it("leaves a gap under the last sibling instead of a bar", () => {
    const root = node("root", {
      children: [node("a"), node("b", { children: [node("b1")] })],
    });

    expect(flattenTree(root).map(r => r.prefix)).toEqual(["", "├─ ", "└─ ", "   └─ "]);
  });

  it("indents one level per generation", () => {
    const root = node("root", {
      children: [node("a", { children: [node("a1", { children: [node("a2")] })] })],
    });

    expect(flattenTree(root).map(r => r.prefix)).toEqual(["", "└─ ", "   └─ ", "      └─ "]);
  });
});

describe("nodeLabel", () => {
  it("joins the agent and why it was called", () => {
    expect(nodeLabel(node("x", { agent: "reviewer", routingLabel: "refactor" }))).toBe("reviewer · refactor");
  });

  it("shows the agent alone when there is no routing label", () => {
    expect(nodeLabel(node("x", { agent: "reviewer" }))).toBe("reviewer");
  });

  it("falls back to the session type when the agent is unknown", () => {
    expect(nodeLabel(node("x", { agent: null, session_type: "main" }))).toBe("main");
    expect(nodeLabel(node("x", { agent: null, session_type: "subagent" }))).toBe("session");
  });
});

describe("delegatedTotals", () => {
  it("is null without a root", () => {
    expect(delegatedTotals(null)).toBeNull();
  });

  it("is all zeros when the session delegated to no one", () => {
    expect(delegatedTotals(node("root", { total_cost: 3, tools_total: 4 }))).toEqual({
      sessions: 0,
      tokens: 0,
      cost: 0,
      tools: 0,
      durationMs: 0,
    });
  });

  // The point of the row: what delegating cost, with the parent's own spend
  // taken back out of the subtree total.
  it("excludes the root's own numbers from the subtree", () => {
    const root = node("root", {
      input_tokens: 100,
      total_cost: 1,
      tools_total: 5,
      duration_ms: 1000,
      children: [node("a", { input_tokens: 20, total_cost: 0.5, tools_total: 2, duration_ms: 200 })],
    });

    expect(delegatedTotals(root)).toEqual({
      sessions: 1,
      tokens: 20,
      cost: 0.5,
      tools: 2,
      durationMs: 200,
    });
  });
});

describe("DelegationTree", () => {
  it("shows a skeleton while loading", () => {
    const { container } = renderTree(null, "root", true);

    expect(container.querySelector(".animate-pulse")).not.toBeNull();
    expect(screen.queryByText("No delegation")).toBeNull();
  });

  it("says there is no delegation when the session stands alone", () => {
    renderTree(tree(node("root")));

    expect(screen.getByText("No delegation")).toBeDefined();
  });

  it("says there is no delegation when the tree failed to load", () => {
    renderTree(null);

    expect(screen.getByText("No delegation")).toBeDefined();
  });

  it("renders one row per session in the tree", () => {
    renderTree(
      tree(node("root", { agent: "main", children: [node("a", { agent: "reviewer" }), node("b", { agent: "writer" })] }))
    );

    expect(screen.getByText(/main/)).toBeDefined();
    expect(screen.getByText(/reviewer/)).toBeDefined();
    expect(screen.getByText(/writer/)).toBeDefined();
    expect(screen.getByText("(3 sessions)")).toBeDefined();
  });

  it("marks the session being viewed", () => {
    const { container } = renderTree(
      tree(node("root", { agent: "main", children: [node("a", { agent: "reviewer" })] })),
      "a"
    );

    const current = container.querySelectorAll('[aria-current="true"]');
    expect(current).toHaveLength(1);
    expect(current[0]!.textContent).toContain("reviewer");
  });

  it("shows a branch total only for a session that delegated", () => {
    const { container } = renderTree(
      tree(node("root", { total_cost: 1, agent: "main", children: [node("a", { total_cost: 0.5, agent: "reviewer" })] }))
    );

    const cells = [...container.querySelectorAll("tbody tr")].map(
      row => [...row.querySelectorAll("td")].at(-1)!.textContent
    );
    // root branch total, leaf has none, then the Delegated footer.
    expect(cells).toEqual(["$1.50", "—", "$1.50"]);
  });

  it("offers a way up when the session is not the top of its tree", () => {
    renderTree(
      tree(node("child", { agent: "reviewer", children: [node("g", { agent: "writer" })] }), {
        ancestorId: "root",
      })
    );

    expect(screen.getByRole("button", { name: /full tree/i })).toBeDefined();
  });

  it("offers no way up when the session already is the root", () => {
    renderTree(tree(node("root", { agent: "main", children: [node("a", { agent: "reviewer" })] })));

    expect(screen.queryByRole("button", { name: /full tree/i })).toBeNull();
  });

  it("warns when the tree was cut at the depth limit", () => {
    renderTree(
      tree(node("root", { agent: "main", children: [node("a", { agent: "reviewer" })] }), { truncated: true })
    );

    expect(screen.getByText(/(2 sessions, truncated)/)).toBeDefined();
    expect(screen.getByText(/cut at the depth limit/i)).toBeDefined();
  });
});
