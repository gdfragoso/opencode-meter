import { describe, expect, it } from "bun:test";
import { DEFAULT_PORT, resolvePort } from "@/api/app";

describe("resolvePort", () => {
  it("falls back to 9393 when nothing is set", () => {
    expect(resolvePort({})).toBe(DEFAULT_PORT);
    expect(resolvePort({ OPENCODE_METER_PORT: "" })).toBe(DEFAULT_PORT);
  });

  it("takes a valid port from the environment", () => {
    expect(resolvePort({ OPENCODE_METER_PORT: "8080" })).toBe(8080);
  });

  it("ignores anything that is not a usable port", () => {
    for (const value of ["abc", "0", "-1", "65536", "99999"]) {
      expect(resolvePort({ OPENCODE_METER_PORT: value })).toBe(DEFAULT_PORT);
    }
  });
});
