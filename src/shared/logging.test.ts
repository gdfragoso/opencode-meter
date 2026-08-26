import { describe, expect, it, mock, spyOn } from "bun:test";
import type { PluginInput } from "@opencode-ai/plugin";
import { createAppLogger, createConsoleLogger, errString } from "@/shared/logging";

type Client = PluginInput["client"];

function stubClient(app: unknown): Client {
  return { app } as unknown as Client;
}

/** Drain the microtask queue so promise rejections surface as unhandled if uncaught. */
function flushMicrotasks(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

describe("createAppLogger", () => {
  it("sends the exact log body to client.app.log once", async () => {
    const appLog = mock(() => Promise.resolve(true));
    const logger = createAppLogger(stubClient({ log: appLog }));

    logger.error("boom", { error: "x" });
    await flushMicrotasks();

    expect(appLog).toHaveBeenCalledTimes(1);
    expect(appLog).toHaveBeenCalledWith({
      body: {
        service: "opencode-meter",
        level: "error",
        message: "boom",
        extra: { error: "x" },
      },
    });
  });

  it("swallows a rejected app.log promise without throwing or leaking the rejection", async () => {
    const appLog = mock(() => Promise.reject(new Error("log failed")));
    const logger = createAppLogger(stubClient({ log: appLog }));

    expect(() => logger.error("boom")).not.toThrow();
    await flushMicrotasks();

    expect(appLog).toHaveBeenCalledTimes(1);
  });

  it("swallows a synchronous throw when client.app is missing", () => {
    const logger = createAppLogger(stubClient({}));

    expect(() => logger.error("boom")).not.toThrow();
  });
});

describe("createConsoleLogger", () => {
  it("maps error to console.error with the [opencode-meter] prefix", () => {
    const consoleError = spyOn(console, "error");
    try {
      createConsoleLogger().error("msg");

      expect(consoleError).toHaveBeenCalledTimes(1);
      expect(consoleError).toHaveBeenCalledWith("[opencode-meter] msg");
    } finally {
      consoleError.mockRestore();
    }
  });
});

describe("errString", () => {
  it("returns err.message for Error instances and String(err) otherwise", () => {
    expect(errString(new Error("e"))).toBe("e");
    expect(errString("raw")).toBe("raw");
  });
});
