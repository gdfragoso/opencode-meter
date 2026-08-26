import { describe, expect, it } from "bun:test";
import { homedir } from "os";
import { join } from "path";

// days.test.ts and plugin-wiring.test.ts call mock.module("@/data/db/connection")
// and the mock replaces the module for every later import in the same-process
// run — including via absolute path, because bun retroactively patches the
// cached module once the alias import is mocked. Read the real exported
// constant in a fresh subprocess instead: clean module cache, no mocks, and
// importing connection.ts has no side effects (getDb() is lazy; nothing on
// disk is touched). This asserts the actual constant, not a mock mirror.
const repoRoot = join(import.meta.dir, "..", "..", "..");
const connectionModule = join(repoRoot, "src", "data", "db", "connection.ts");

function realDbPath(): string {
  const out = Bun.spawnSync({
    cmd: ["bun", "-e", `import { DB_PATH } from ${JSON.stringify(connectionModule)}; console.log(DB_PATH)`],
    cwd: repoRoot,
    stdout: "pipe",
    stderr: "pipe",
  });
  if (out.exitCode !== 0) {
    throw new Error(`failed to read DB_PATH in subprocess: ${out.stderr.toString()}`);
  }
  return out.stdout.toString().trim();
}

describe("connection DB_PATH contract", () => {
  it("resolves to the XDG data directory for opencode-meter", () => {
    // Recomputed independently from primitives — not a copy of the module's
    // internal DB_DIR, so a regression in the path construction fails here.
    const expected = join(homedir(), ".local", "share", "opencode-meter", "metrics.db");
    expect(realDbPath()).toBe(expected);
  });

  it("does not resolve into the old .opencode-metrics directory", () => {
    expect(realDbPath()).not.toContain(".opencode-metrics");
  });
});
