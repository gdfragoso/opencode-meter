import { afterEach, describe, expect, it } from "bun:test";
import { cleanup, render, screen } from "@testing-library/react";
import GanttChart from "./GanttChart";
import type { EventRow } from "@/data/domain/event";

afterEach(cleanup);

let nextId = 1;

function ev(type: string, ts: number, data: Record<string, unknown>): EventRow {
  return { id: nextId++, ts, session_id: "s", type, data: JSON.stringify(data) } as EventRow;
}

function toolPair(callID: string, tool: string, start: number, end: number): EventRow[] {
  return [
    ev("tool.before", start, { callID, tool }),
    ev("tool.after", end, { callID, tool }),
  ];
}

describe("GanttChart", () => {
  it("says so when there are no events at all", () => {
    render(<GanttChart events={null} />);
    expect(screen.getByText("No tool events")).toBeDefined();
  });

  it("says so when the events contain no completed tool call", () => {
    render(<GanttChart events={[ev("tool.before", 100, { callID: "c1", tool: "read" })]} />);
    expect(screen.getByText("No tool events")).toBeDefined();
  });

  it("renders one bar per paired tool call", () => {
    render(
      <GanttChart
        events={[
          ...toolPair("c1", "read", 1_000, 1_400),
          ...toolPair("c2", "bash", 1_500, 3_500),
        ]}
      />
    );

    expect(screen.getAllByText("read").length).toBeGreaterThan(0);
    expect(screen.getAllByText("bash").length).toBeGreaterThan(0);
  });

  it("ignores a tool.after with no matching tool.before", () => {
    render(
      <GanttChart
        events={[
          ...toolPair("c1", "read", 1_000, 1_400),
          ev("tool.after", 2_000, { callID: "orphan", tool: "ghost" }),
        ]}
      />
    );

    expect(screen.queryByText("ghost")).toBeNull();
    expect(screen.getAllByText("read").length).toBeGreaterThan(0);
  });

  it("survives malformed event data instead of throwing", () => {
    const broken = { id: 99, ts: 10, session_id: "s", type: "tool.after", data: "{not json" } as EventRow;
    expect(() =>
      render(<GanttChart events={[...toolPair("c1", "read", 1_000, 1_400), broken]} />)
    ).not.toThrow();
  });

  it("does not divide by zero when every call is instantaneous", () => {
    expect(() => render(<GanttChart events={toolPair("c1", "read", 1_000, 1_000)} />)).not.toThrow();
  });
});
