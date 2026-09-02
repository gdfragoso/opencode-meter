import { afterEach, describe, expect, it } from "bun:test";
import { cleanup, render, screen } from "@testing-library/react";
import ContextChart, { fmtCacheRate, compactionMarks } from "./ContextChart";
import type { SessionContextResponse, SessionContextTurn } from "@/data/domain/session";

afterEach(cleanup);

function turn(input: number, cacheRead: number, id = 1): SessionContextTurn {
  const context = input + cacheRead;
  return {
    id,
    input,
    cacheRead,
    context,
    cacheRate: context > 0 ? cacheRead / context : null,
  };
}

function response(over: Partial<SessionContextResponse> = {}): SessionContextResponse {
  return { turns: [], compactedBefore: [], peakContext: 0, ...over };
}

describe("fmtCacheRate", () => {
  it("renders a percentage", () => {
    expect(fmtCacheRate(0.725)).toBe("72.5%");
  });

  // Null means the turn carried no prompt. Showing 0% would claim the cache
  // missed on a request that was never made.
  it("renders a dash for null rather than 0%", () => {
    expect(fmtCacheRate(null)).toBe("—");
  });
});

describe("compactionMarks", () => {
  it("draws nothing when the session never compacted", () => {
    let strokes = 0;
    const chart = {
      ctx: {
        save() {}, restore() {}, beginPath() {}, moveTo() {}, lineTo() {},
        stroke() { strokes++; }, setLineDash() {},
      },
      chartArea: { left: 0, right: 100, top: 0, bottom: 50 },
      scales: { x: { getPixelForValue: (v: number) => v * 10 } },
    };

    compactionMarks([]).afterDatasetsDraw!(chart as never, {} as never, {} as never, {} as never);

    expect(strokes).toBe(0);
  });

  it("draws one rule per compaction, at the turn's position", () => {
    const drawnAt: number[] = [];
    const chart = {
      ctx: {
        save() {}, restore() {}, beginPath() {}, lineTo() {},
        moveTo(x: number) { drawnAt.push(x); },
        stroke() {}, setLineDash() {},
      },
      chartArea: { left: 0, right: 100, top: 0, bottom: 50 },
      scales: { x: { getPixelForValue: (v: number) => v * 10 } },
    };

    compactionMarks([2, 5]).afterDatasetsDraw!(chart as never, {} as never, {} as never, {} as never);

    expect(drawnAt).toEqual([20, 50]);
  });
});

describe("ContextChart", () => {
  it("shows a skeleton while loading", () => {
    const { container } = render(<ContextChart data={null} loading={true} />);

    expect(container.querySelector(".animate-pulse")).not.toBeNull();
  });

  it("shows an empty state when nothing was recorded", () => {
    render(<ContextChart data={response()} loading={false} />);

    expect(screen.getByText("No context recorded")).toBeDefined();
  });

  it("reports the peak as the full prompt, not the uncached part", () => {
    const { container } = render(
      <ContextChart
        data={response({ turns: [turn(577, 126_000)], peakContext: 126_577 })}
        loading={false}
      />
    );

    // 126,577 abbreviated. What must NOT appear is 577 — the uncached part on
    // its own, which is what charting `input` alone would have reported.
    expect(container.textContent).toContain("126.6K");
    expect(container.textContent).not.toContain("577");
  });

  it("rates the cached share across every turn together", () => {
    const { container } = render(
      <ContextChart
        data={response({ turns: [turn(100, 900, 1), turn(100, 900, 2)], peakContext: 1000 })}
        loading={false}
      />
    );

    expect(container.textContent).toContain("90.0%");
  });

  // The common case: 50 real sessions, zero compactions. The chart has to be
  // useful with no marks at all.
  it("renders without the compaction note when there were none", () => {
    const { container } = render(
      <ContextChart data={response({ turns: [turn(10, 90)], peakContext: 100 })} loading={false} />
    );

    expect(container.textContent).not.toContain("Dashed rules");
  });

  it("explains the rules when a compaction happened", () => {
    const { container } = render(
      <ContextChart
        data={response({ turns: [turn(10, 90, 1), turn(20, 80, 2)], compactedBefore: [1], peakContext: 100 })}
        loading={false}
      />
    );

    expect(container.textContent).toContain("Dashed rules");
  });
});
