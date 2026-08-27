import { describe, expect, it } from "bun:test";
import { deltaArrow, deltaTone, formatDelta } from "@/dashboard/lib/delta";
import { fmtNum, fmtUSD } from "@/dashboard/lib/format";
import type { PeriodDelta } from "@/data/domain/metrics";

function d(current: number, previous: number): PeriodDelta {
  return {
    current,
    previous,
    absolute: current - previous,
    pct: previous === 0 ? null : ((current - previous) / previous) * 100,
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

  it("says nothing changed when both sides are zero", () => {
    expect(formatDelta(d(0, 0), fmtUSD)).toBe("no change");
  });

  it("reports 0% when the value held steady at a non-zero number", () => {
    expect(formatDelta(d(10, 10), fmtNum)).toBe("no change");
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

  it("does not paint a fall red for a neutral metric", () => {
    expect(deltaTone(d(1, 100), "neutral")).not.toContain("danger");
  });

  it("paints rising errors red", () => {
    expect(deltaTone(d(3, 1), "down-good")).toContain("danger");
  });

  it("does not paint falling errors red", () => {
    expect(deltaTone(d(1, 3), "down-good")).not.toContain("danger");
  });
});

describe("deltaArrow", () => {
  it("points up on a rise", () => {
    expect(deltaArrow(d(2, 1))).toBe("↑");
  });

  it("points down on a fall", () => {
    expect(deltaArrow(d(1, 2))).toBe("↓");
  });

  it("points sideways when nothing moved", () => {
    expect(deltaArrow(d(1, 1))).toBe("→");
  });
});
