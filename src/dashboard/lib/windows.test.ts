import { describe, expect, it } from "bun:test";
import { ghostValues, hasGhost, previousSeries, shiftDate } from "@/dashboard/lib/windows";
import type { DailyRow } from "@/data/domain/daily";

function row(date: string, over: Partial<DailyRow> = {}): DailyRow {
  return {
    date,
    sessions: 0,
    tokens_in: 0,
    tokens_out: 0,
    reasoning_tokens: 0,
    cache_read: 0,
    cache_write: 0,
    total_cost: 0,
    tools_total: 0,
    subagents_total: 0,
    errors_total: 0,
    models_used: "",
    agents_used: "",
    top_tools: "",
    avg_ttft_ms: null,
    active_minutes: 0,
    ...over,
  };
}

describe("shiftDate", () => {
  it("moves back within a month", () => {
    expect(shiftDate("2026-08-20", -7)).toBe("2026-08-13");
  });

  it("moves forward", () => {
    expect(shiftDate("2026-08-20", 7)).toBe("2026-08-27");
  });

  it("crosses a month boundary", () => {
    expect(shiftDate("2026-09-03", -7)).toBe("2026-08-27");
  });

  it("crosses a year boundary", () => {
    expect(shiftDate("2026-01-02", -7)).toBe("2025-12-26");
  });

  it("handles a leap day", () => {
    expect(shiftDate("2028-03-01", -1)).toBe("2028-02-29");
  });

  // The dates come from SQLite as UTC. Doing the arithmetic in local time would
  // land on the wrong day either side of a clock change.
  it("is unaffected by daylight saving", () => {
    expect(shiftDate("2026-03-30", -1)).toBe("2026-03-29");
    expect(shiftDate("2026-11-02", -1)).toBe("2026-11-01");
  });

  it("leaves an unparseable value alone", () => {
    expect(shiftDate("not-a-date", -7)).toBe("not-a-date");
  });
});

describe("previousSeries", () => {
  it("returns one entry per current day", () => {
    const current = [row("2026-08-20"), row("2026-08-21")];

    expect(previousSeries(current, [], 7)).toHaveLength(2);
  });

  it("matches each day to the same day one window earlier", () => {
    const current = [row("2026-08-20", { sessions: 5 })];
    const all = [...current, row("2026-08-13", { sessions: 2 })];

    expect(previousSeries(current, all, 7)[0]!.sessions).toBe(2);
  });

  // Both series only contain days that had activity. Lining them up by position
  // would slide every later point onto the wrong day and invent a trend.
  it("does not shift later days when the earlier window has a quiet day", () => {
    const current = [row("2026-08-20", { sessions: 5 }), row("2026-08-21", { sessions: 6 })];
    const all = [
      ...current,
      // 2026-08-13 is missing entirely — that day had no sessions.
      row("2026-08-14", { sessions: 9 }),
    ];

    const previous = previousSeries(current, all, 7);

    expect(previous[0]).toBeNull();
    expect(previous[1]!.sessions).toBe(9);
  });

  it("is all nulls when there is no earlier data at all", () => {
    const current = [row("2026-08-20"), row("2026-08-21")];

    expect(previousSeries(current, current, 7)).toEqual([null, null]);
  });

  it("is all nulls when the response has not arrived", () => {
    expect(previousSeries([row("2026-08-20")], null, 7)).toEqual([null]);
  });

  // "All time" has no window before it.
  it("is all nulls when the range has no length", () => {
    const current = [row("2026-08-20")];

    expect(previousSeries(current, [...current, row("2026-08-13")], 0)).toEqual([null]);
  });

  it("returns nothing for an empty current window", () => {
    expect(previousSeries([], [row("2026-08-13")], 7)).toEqual([]);
  });
});

describe("ghostValues", () => {
  it("reads the metric off each matched day", () => {
    const previous = [row("a", { total_cost: 1.5 }), row("b", { total_cost: 2.5 })];

    expect(ghostValues(previous, (r) => r.total_cost)).toEqual([1.5, 2.5]);
  });

  // Null has to survive as null: Chart.js draws a gap, and a zero here would
  // draw a plunge on a day that simply has no counterpart.
  it("keeps an unmatched day as a gap, not a zero", () => {
    expect(ghostValues([null, row("b", { sessions: 3 })], (r) => r.sessions)).toEqual([null, 3]);
  });
});

describe("hasGhost", () => {
  it("is false when nothing matched", () => {
    expect(hasGhost([null, null])).toBe(false);
  });

  it("is false for an empty window", () => {
    expect(hasGhost([])).toBe(false);
  });

  it("is true as soon as one day matched", () => {
    expect(hasGhost([null, row("b")])).toBe(true);
  });
});
