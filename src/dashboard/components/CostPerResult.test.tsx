import { afterEach, describe, expect, it } from "bun:test";
import { cleanup, render, screen } from "@testing-library/react";
import { CostPerResultKpis, CostPerAgentResultTable } from "./CostPerResult";
import type { CostEfficiencyResponse } from "@/data/domain/metrics";

afterEach(cleanup);

function response(over: Partial<CostEfficiencyResponse> = {}): CostEfficiencyResponse {
  return {
    totalCost: 0,
    totalSessions: 0,
    files: 0,
    edits: 0,
    additions: 0,
    deletions: 0,
    costPerFile: null,
    costPerEdit: null,
    costPerLine: null,
    costPerSession: null,
    byAgent: [],
    ...over,
  };
}

describe("CostPerResultKpis", () => {
  it("shows a skeleton until the data arrives", () => {
    const { container } = render(<CostPerResultKpis data={null} />);

    expect(container.querySelector(".animate-pulse")).not.toBeNull();
  });

  it("shows the four ratios with their denominators", () => {
    render(
      <CostPerResultKpis
        data={response({
          totalCost: 12,
          totalSessions: 4,
          files: 6,
          edits: 8,
          additions: 100,
          deletions: 20,
          costPerFile: 2,
          costPerEdit: 1.5,
          costPerLine: 0.1,
          costPerSession: 3,
        })}
      />
    );

    expect(screen.getByText("$2.00")).toBeDefined();
    expect(screen.getByText("$1.50")).toBeDefined();
    expect(screen.getByText("$3.00")).toBeDefined();
    expect(screen.getByText("6 files")).toBeDefined();
    expect(screen.getByText("+100 / -20")).toBeDefined();
  });

  // The whole point of returning null instead of 0: a window that spent money
  // and produced nothing must not read as the cheapest one on the page.
  it("shows a dash, not $0.00, when nothing was produced", () => {
    const { container } = render(
      <CostPerResultKpis data={response({ totalCost: 5, files: 0, costPerFile: null })} />
    );

    expect(container.textContent).not.toContain("$0.00");
    expect(container.textContent).toContain("—");
  });

  it("explains the dash rather than leaving it looking like missing data", () => {
    const { container } = render(
      <CostPerResultKpis data={response({ totalCost: 5, costPerFile: null })} />
    );

    const explained = [...container.querySelectorAll("[title]")].map(el => el.getAttribute("title"));
    expect(explained).toContain("No file change in this window");
  });
});

describe("CostPerAgentResultTable", () => {
  const agent = (over: Partial<CostEfficiencyResponse["byAgent"][number]> = {}) => ({
    agent: "builder",
    sessions: 2,
    cost: 6,
    files: 3,
    lines: 40,
    costPerFile: 2,
    costPerSession: 3,
    ...over,
  });

  it("shows a skeleton until the data arrives", () => {
    const { container } = render(<CostPerAgentResultTable data={null} />);

    expect(container.querySelector(".animate-pulse")).not.toBeNull();
  });

  it("says so when no agent has a row", () => {
    render(<CostPerAgentResultTable data={response()} />);

    expect(screen.getByText("No data yet")).toBeDefined();
  });

  it("shows one row per agent", () => {
    render(
      <CostPerAgentResultTable
        data={response({ byAgent: [agent(), agent({ agent: "reviewer", cost: 1 })] })}
      />
    );

    expect(screen.getByText("builder")).toBeDefined();
    expect(screen.getByText("reviewer")).toBeDefined();
  });

  it("dashes the per-file column for an agent that changed nothing", () => {
    const { container } = render(
      <CostPerAgentResultTable
        data={response({ byAgent: [agent({ agent: "reviewer", files: 0, costPerFile: null })] })}
      />
    );

    const cells = [...container.querySelectorAll("tbody td")].map(c => c.textContent);
    expect(cells.at(-1)).toBe("—");
  });
});
