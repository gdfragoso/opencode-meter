import { afterEach, describe, expect, it } from "bun:test";
import { cleanup, render, screen } from "@testing-library/react";
import PeriodComparison, { deltaTone, formatDelta, formatRange } from "./PeriodComparison";
import { fmtNum, fmtUSD } from "@/dashboard/lib/format";
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
    current: snapshot(T - 7 * DAY, T),
    previous: snapshot(T - 14 * DAY, T - 7 * DAY),
    deltas: deltas(),
    ...over,
  };
}

describe("formatDelta", () => {
  it("shows a rise as a positive percentage", () => {
    expect(formatDelta(d(12, 10), fmtNum)).toBe("+20.0%");
  });

  it("shows a fall as a negative percentage", () => {
    expect(formatDelta(d(5, 10), fmtNum)).toBe("−50.0%");
  });

  it("says nothing changed rather than showing 0%", () => {
    expect(formatDelta(d(0, 0), fmtNum)).toBe("no change");
  });

  // A percentage from zero does not exist, so the absolute change stands in —
  // formatted the same way as the metric it belongs to.
  it("falls back to the absolute change when the earlier window was empty", () => {
    expect(formatDelta(d(3.5, 0), fmtUSD)).toBe("+$3.50");
  });

  it("keeps the sign outside the formatted value when falling from zero", () => {
    expect(formatDelta(d(0, 0), fmtUSD)).toBe("no change");
  });
});

describe("deltaTone", () => {
  it("is muted when nothing changed", () => {
    expect(deltaTone(d(5, 5), "neutral")).toContain("cyan/30");
  });

  // More sessions or more spend is not a problem; only errors are.
  it("does not paint a rise red for a neutral metric", () => {
    expect(deltaTone(d(100, 1), "neutral")).not.toContain("danger");
  });

  it("paints rising errors red", () => {
    expect(deltaTone(d(3, 1), "down-good")).toContain("danger");
  });

  it("does not paint falling errors red", () => {
    expect(deltaTone(d(1, 3), "down-good")).not.toContain("danger");
  });
});

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

  // "All time" has no earlier window; saying what to do beats an empty box.
  it("asks for a range when there is nothing to compare against", () => {
    render(
      <PeriodComparison
        data={response({ days: null, previous: null, deltas: null })}
        loading={false}
      />
    );

    expect(screen.getByText(/pick a range/i)).toBeDefined();
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
