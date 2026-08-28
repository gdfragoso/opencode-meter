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

describe("checkExistingServer", () => {
  // The probe must hit a route that exists. Every response carries
  // `x-opencode-meter`, including the SPA fallback for paths that do not — so a
  // probe of a made-up path passes just as readily and proves nothing about the
  // endpoint it names.
  it("probes a path the server actually routes", async () => {
    const { createApp } = await import("@/api/app");
    const app = createApp();

    const res = await app.request("http://127.0.0.1/health");

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
    expect(res.headers.get("x-opencode-meter")).toBe("1");
  });

  it("stamps the header on unrouted paths too, which is why the path matters", async () => {
    const { createApp } = await import("@/api/app");
    const app = createApp();

    const res = await app.request("http://127.0.0.1/api/not-a-route");

    expect(res.headers.get("x-opencode-meter")).toBe("1");
  });
});
