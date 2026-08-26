import { describe, expect, test } from "bun:test";
import { routingLabel } from "./routing";

describe("routingLabel", () => {
  test("returns category when present", () => {
    expect(routingLabel({ category: "visual-engineering", subagent_type: "explore" })).toBe("visual-engineering");
  });

  test("falls back to subagent_type when no category", () => {
    expect(routingLabel({ subagent_type: "explore" })).toBe("explore");
  });

  test("returns null for empty/missing values", () => {
    expect(routingLabel({ category: "", subagent_type: "" })).toBeNull();
    expect(routingLabel({ prompt: "x" })).toBeNull();
    expect(routingLabel({})).toBeNull();
  });

  test("returns null for non-object input", () => {
    expect(routingLabel(null)).toBeNull();
    expect(routingLabel(undefined)).toBeNull();
    expect(routingLabel("task")).toBeNull();
  });
});
