import { describe, expect, it } from "bun:test";
import { classifyTools, extractServer, isBuiltinTool, type ToolCount } from "./tools";

const tool = (name: string, count: number): ToolCount => ({ name, count });

describe("isBuiltinTool", () => {
  it("knows OpenCode's own tools from everything else", () => {
    expect(isBuiltinTool("read")).toBe(true);
    expect(isBuiltinTool("bash")).toBe(true);
    expect(isBuiltinTool("github_create_issue")).toBe(false);
  });
});

describe("extractServer", () => {
  it("takes the segment before the first separator", () => {
    expect(extractServer("github_create_issue")).toBe("github");
    expect(extractServer("linear.issue.create")).toBe("linear");
    expect(extractServer("sentry-list-errors")).toBe("sentry");
  });

  it("returns the name itself when there is no separator", () => {
    expect(extractServer("mytool")).toBe("mytool");
  });

  it("prefers underscore over the other separators", () => {
    expect(extractServer("a_b-c.d")).toBe("a");
  });
});

describe("classifyTools", () => {
  it("splits built-ins from MCP tools and groups MCP by server", () => {
    const { builtin, mcp } = classifyTools([
      tool("read", 10),
      tool("github_create_issue", 3),
      tool("bash", 7),
      tool("github_list_prs", 9),
      tool("linear_create", 1),
    ]);

    expect(builtin.map((t) => t.name)).toEqual(["read", "bash"]);
    expect(mcp).toHaveLength(2);
    expect(mcp[0]!.server).toBe("github");
    expect(mcp[0]!.total).toBe(12);
    expect(mcp[1]!.server).toBe("linear");
  });

  it("orders servers by total calls and tools by call count", () => {
    const { mcp } = classifyTools([
      tool("small_one", 1),
      tool("big_a", 5),
      tool("big_b", 50),
    ]);

    expect(mcp.map((g) => g.server)).toEqual(["big", "small"]);
    expect(mcp[0]!.tools.map((t) => t.name)).toEqual(["big_b", "big_a"]);
  });

  it("does not reorder the array it was given", () => {
    // The grouped arrays are copies: sorting in place would reorder data the
    // caller still holds, which for hook results is shared state.
    const input = [tool("github_b", 1), tool("github_a", 9)];
    classifyTools(input);
    expect(input.map((t) => t.name)).toEqual(["github_b", "github_a"]);
  });

  it("handles an empty list", () => {
    expect(classifyTools([])).toEqual({ builtin: [], mcp: [] });
  });
});
