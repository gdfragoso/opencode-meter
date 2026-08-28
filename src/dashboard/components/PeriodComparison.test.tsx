import { afterEach, describe, expect, it } from "bun:test";
import { cleanup, render, screen } from "@testing-library/react";
import PeriodComparison, { formatRange } from "./PeriodComparison";
import type {
  PeriodComparisonResponse,
  PeriodDelta,
  PeriodDeltas,
  PeriodSnapshot,
} from "@/data/domain/metrics";

afterEach(cleanup);

const DAY = 86_400_000;
const T = 1_700_000_000_000;

function d(current: number, previous: number): PeriodDelta {
  return {
    current,
    previous,
    absolute: current - previous,
    pct: previous === 0 ? null : ((current - previous) / previous) * 100,
  };
}

function snapshot(from: number, to: number, over: Partial<PeriodSnapshot> = {}): PeriodSnapshot {
  return {
    from,
    to,
    sessions: 0,
    userSessions: 0,
    tokens: 0,
    cost: 0,
    tools: 0,
    errors: 0,
    activeDays: 0,
    files: 0,
    lines: 0,
    ...over,
  };
}

function deltas(over: Partial<PeriodDeltas> = {}): PeriodDeltas {
  const zero = d(0, 0);
  return {
    sessions: zero,
    userSessions: zero,
    cost: zero,
    tokens: zero,
    tools: zero,
    errors: zero,
    files: zero,
    lines: zero,
    activeDays: zero,
    ...over,
  };
}

function response(over: Partial<PeriodComparisonResponse> = {}): PeriodComparisonResponse {
  return {
    days: 7,
    defaulted: false,
    current: snapshot(T - 7 * DAY, T),
    previous: snapshot(T - 14 * DAY, T - 7 * DAY),
    deltas: deltas(),
    ...over,
  };
}

describe("formatRange", () => {
  // The range is half-open, so rendering `to` directly would show a 7-day
  // window as spanning 8 dates.
  it("ends on the last day the window actually covers", () => {
    const label = formatRange(Date.UTC(2026, 7, 10), Date.UTC(2026, 7, 17));

    expect(label).not.toContain("17");
    expect(label).toContain("16");
  });
});

describe("PeriodComparison", () => {
  it("shows a skeleton while loading", () => {
    const { container } = render(<PeriodComparison data={null} loading />);

    expect(container.querySelector(".animate-pulse")).not.toBeNull();
  });

  it("says so when the request produced nothing", () => {
    render(<PeriodComparison data={null} loading={false} />);

    expect(screen.getByText("No data yet")).toBeDefined();
  });

  // With no range chosen the service picks the window itself, so the section
  // still shows numbers — but the charts below are on a different range, and a
  // reader who does not notice would compare two unrelated things.
  it("says so when it chose the window itself", () => {
    render(
      <PeriodComparison data={response({ days: 30, defaulted: true })} loading={false} />
    );

    expect(screen.getByText(/range is set to all/i)).toBeDefined();
    expect(screen.getByText("Cost")).toBeDefined();
  });

  it("stays quiet when the window came from the range the user picked", () => {
    render(<PeriodComparison data={response()} loading={false} />);

    expect(screen.queryByText(/range is set to all/i)).toBeNull();
  });

  it("shows a card for every metric", () => {
    render(<PeriodComparison data={response()} loading={false} />);

    for (const label of ["Cost", "Sessions", "Files Changed", "Lines Changed", "Tokens", "Tool Calls", "Errors", "Active Days"]) {
      expect(screen.getByText(label)).toBeDefined();
    }
  });

  it("shows the current value, the change and what it was before", () => {
    render(
      <PeriodComparison
        data={response({ deltas: deltas({ cost: d(8, 4) }) })}
        loading={false}
      />
    );

    expect(screen.getByText("$8.00")).toBeDefined();
    expect(screen.getByText(/\+100\.0%/)).toBeDefined();
    expect(screen.getByText("was $4.00")).toBeDefined();
  });

  it("names both windows in the header", () => {
    const { container } = render(<PeriodComparison data={response()} loading={false} />);

    expect(container.textContent).toContain(" vs ");
  });
});
