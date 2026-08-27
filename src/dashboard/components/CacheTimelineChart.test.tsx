import { afterEach, describe, expect, it } from "bun:test";
import { cleanup, render, screen } from "@testing-library/react";
import CacheTimelineChart, { fmtRate, shortDate } from "./CacheTimelineChart";
import type { CacheTimelineResponse, CacheTimelineSeries } from "@/data/domain/metrics";

afterEach(cleanup);

function series(over: Partial<CacheTimelineSeries> = {}): CacheTimelineSeries {
  return {
    model_id: "sonnet",
    provider_id: "anthropic",
    tokens: 1000,
    overallRate: 0.8,
    rates: [0.8],
    ...over,
  };
}

function response(over: Partial<CacheTimelineResponse> = {}): CacheTimelineResponse {
  return { dates: ["2026-08-20"], series: [series()], omittedModels: 0, ...over };
}

describe("fmtRate", () => {
  it("renders a rate as a percentage", () => {
    expect(fmtRate(0.725)).toBe("72.5%");
  });

  it("renders zero as 0%, not a dash", () => {
    expect(fmtRate(0)).toBe("0.0%");
  });

  // Null means the model read nothing — not that it hit the cache 0% of the time.
  it("dashes a missing rate", () => {
    expect(fmtRate(null)).toBe("—");
    expect(fmtRate(undefined)).toBe("—");
  });
});

describe("shortDate", () => {
  it("shortens an ISO date to month and day", () => {
    expect(shortDate("2026-08-20")).toBe("08/20");
  });

  it("leaves an unexpected format alone", () => {
    expect(shortDate("whenever")).toBe("whenever");
  });
});

describe("CacheTimelineChart", () => {
  it("shows a skeleton while loading", () => {
    const { container } = render(<CacheTimelineChart data={null} loading />);

    expect(container.querySelector(".animate-pulse")).not.toBeNull();
  });

  it("says so when nothing has been cached yet", () => {
    render(<CacheTimelineChart data={null} loading={false} />);

    expect(screen.getByText("No cache activity yet")).toBeDefined();
  });

  it("says so when the window has dates but no model", () => {
    render(<CacheTimelineChart data={response({ series: [] })} loading={false} />);

    expect(screen.getByText("No cache activity yet")).toBeDefined();
  });

  it("lists each model with its rate over the window", () => {
    render(
      <CacheTimelineChart
        data={response({
          series: [series(), series({ model_id: "haiku", overallRate: 0.25, tokens: 500 })],
        })}
        loading={false}
      />
    );

    expect(screen.getByText("sonnet")).toBeDefined();
    expect(screen.getByText("80.0%")).toBeDefined();
    expect(screen.getByText("haiku")).toBeDefined();
    expect(screen.getByText("25.0%")).toBeDefined();
  });

  it("dashes the rate of a model that read nothing", () => {
    render(<CacheTimelineChart data={response({ series: [series({ overallRate: null })] })} loading={false} />);

    expect(screen.getByText("—")).toBeDefined();
  });

  // Silently cutting the chart at six models would present part of the picture
  // as all of it.
  it("admits when models were left out", () => {
    render(<CacheTimelineChart data={response({ omittedModels: 3 })} loading={false} />);

    expect(screen.getByText(/3 quieter models not shown/i)).toBeDefined();
  });

  it("says nothing about omissions when none were made", () => {
    render(<CacheTimelineChart data={response()} loading={false} />);

    expect(screen.queryByText(/not shown/i)).toBeNull();
  });

  it("uses the singular for one omitted model", () => {
    render(<CacheTimelineChart data={response({ omittedModels: 1 })} loading={false} />);

    expect(screen.getByText(/1 quieter model not shown/i)).toBeDefined();
  });
});
