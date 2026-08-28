import { afterEach, describe, expect, it } from "bun:test";
import { cleanup, render, screen } from "@testing-library/react";
import { CostPerResultKpis } from "./CostPerResult";
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
