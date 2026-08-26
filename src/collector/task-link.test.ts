import { describe, expect, test } from "bun:test";
import { extractTaskChildSessionID } from "./task-link";

describe("extractTaskChildSessionID", () => {
  test("reads from metadata (camelCase, uppercase, snake_case)", () => {
    expect(extractTaskChildSessionID({ sessionId: "ses_a" }, undefined)).toBe("ses_a");
    expect(extractTaskChildSessionID({ sessionID: "ses_b" }, undefined)).toBe("ses_b");
    expect(extractTaskChildSessionID({ session_id: "ses_c" }, undefined)).toBe("ses_c");
  });

  test("parses <task_metadata> block from output text", () => {
    const text = [
      "Task completed.",
      "<task_metadata>",
      "session_id: ses_child_1",
      "subagent: sisyphus-junior",
      "category: quick",
      "</task_metadata>",
    ].join("\n");
    expect(extractTaskChildSessionID(undefined, text)).toBe("ses_child_1");
  });

  test("uses the last <task_metadata> block when multiple exist", () => {
    const text =
      "<task_metadata>\nsession_id: ses_first\n</task_metadata>\n---\n" +
      "<task_metadata>\nsession_id: ses_second\n</task_metadata>";
    expect(extractTaskChildSessionID(undefined, text)).toBe("ses_second");
  });

  test("falls back to explicit 'Session ID:' marker", () => {
    const text = "Ran in background.\nSession ID: ses_bg_9";
    expect(extractTaskChildSessionID(undefined, text)).toBe("ses_bg_9");
  });

  test("returns null when nothing is present", () => {
    expect(extractTaskChildSessionID(undefined, undefined)).toBeNull();
    expect(extractTaskChildSessionID({}, "no ids here")).toBeNull();
    expect(extractTaskChildSessionID({ category: "quick" }, "done")).toBeNull();
  });
});
