import { describe, expect, it } from "bun:test";
import { fmtDur, fmtNum, fmtTime, fmtUSD } from "./format";

const DASH = "—";

describe("fmtNum", () => {
  it("abbreviates at thousands and millions", () => {
    expect(fmtNum(999)).toBe("999");
    expect(fmtNum(1_500)).toBe("1.5K");
    expect(fmtNum(2_400_000)).toBe("2.4M");
  });

  it("rounds below a thousand instead of showing decimals", () => {
    expect(fmtNum(12.7)).toBe("13");
  });

  it("shows a dash for nothing, not zero", () => {
    expect(fmtNum(null)).toBe(DASH);
    expect(fmtNum(undefined)).toBe(DASH);
    expect(fmtNum(Number.NaN)).toBe(DASH);
    expect(fmtNum(0)).toBe("0");
  });
});

describe("fmtUSD", () => {
  it("keeps sub-cent costs visible instead of rounding them to zero", () => {
    // A single cheap call costs fractions of a cent; $0.00 would read as free.
    expect(fmtUSD(0.00004)).toBe("$0.00004");
    expect(fmtUSD(0)).toBe("$0.00");
    expect(fmtUSD(12.345)).toBe("$12.35");
  });

  it("shows a dash for nothing", () => {
    expect(fmtUSD(null)).toBe(DASH);
    expect(fmtUSD(Number.NaN)).toBe(DASH);
  });
});

describe("fmtDur", () => {
  it("switches unit as the duration grows", () => {
    expect(fmtDur(250)).toBe("250ms");
    expect(fmtDur(1_500)).toBe("1.5s");
    expect(fmtDur(90_000)).toBe("1m 30s");
    expect(fmtDur(3_930_000)).toBe("1h 5m");
  });

  it("shows a dash for nothing", () => {
    expect(fmtDur(null)).toBe(DASH);
    expect(fmtDur(Number.NaN)).toBe(DASH);
  });
});

describe("fmtTime", () => {
  it("shows a dash for nothing", () => {
    expect(fmtTime(null)).toBe(DASH);
    expect(fmtTime(Number.NaN)).toBe(DASH);
  });

  it("renders a real timestamp", () => {
    expect(fmtTime(Date.UTC(2026, 0, 15, 12, 0, 0))).toContain("2026");
  });
});
