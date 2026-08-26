import { describe, expect, it } from "bun:test";
import plugin from "../../../plugin";

// Canonical distribution/plugin identity contract (todo 1 of the
// opencode-meter rename). The npm package, bin and plugin id are all
// "opencode-meter". Lives in src/data/domain because identity is a contract
// shared by the write and read sides. It reads the id straight off the
// plugin's exported default module at runtime — no mock that mirrors the
// implementation — so a regression back to "opencode-metrics" fails here.
describe("package identity: opencode-meter", () => {
  it("exposes the canonical plugin id", () => {
    expect(plugin.id).toBe("opencode-meter");
  });
});
