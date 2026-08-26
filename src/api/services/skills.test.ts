import { describe, expect, it, beforeEach, afterEach, spyOn } from "bun:test";
import { Database } from "bun:sqlite";
import { initSchema } from "@/data/db/migrations";
import { MS_PER_DAY, NOW, insertSession } from "@/data/repositories/session.test";
import { getSkills } from "@/api/services/skills";
import { insertSkillEvent } from "@/data/repositories/event.test";

describe("skills aggregation", () => {
  let db: Database;
  let nowSpy: ReturnType<typeof spyOn>;

  beforeEach(() => {
    db = new Database(":memory:");
    initSchema(db);
    // Frozen clock: every fixture places sessions relative to NOW, and the
    // day filters compare against Date.now().
    nowSpy = spyOn(Date, "now").mockReturnValue(NOW);
  });

  afterEach(() => {
    nowSpy.mockRestore();
    db.close();
  });

  describe("skills aggregation", () => {
    it("counts all skill events when days is null", () => {
      insertSession(db, "old-session", NOW - 30 * MS_PER_DAY);
      insertSession(db, "recent-session", NOW - 1 * MS_PER_DAY);
      insertSkillEvent(db, "old-session", NOW - 30 * MS_PER_DAY, "skill-a", "skills.called");
      insertSkillEvent(db, "recent-session", NOW - 1 * MS_PER_DAY, "skill-a", "skills.loaded");

      const result = getSkills(db, null);
      expect(result.topSkills.find((s) => s.name === "skill-a")?.count).toBe(2);
    });

    it("counts only skill events within the requested window", () => {
      insertSession(db, "old-session", NOW - 30 * MS_PER_DAY);
      insertSession(db, "recent-session", NOW - 1 * MS_PER_DAY);
      insertSkillEvent(db, "old-session", NOW - 30 * MS_PER_DAY, "skill-a", "skills.called");
      insertSkillEvent(db, "recent-session", NOW - 1 * MS_PER_DAY, "skill-a", "skills.loaded");

      const result = getSkills(db, 7);
      expect(result.topSkills.find((s) => s.name === "skill-a")?.count).toBe(1);
    });
  });
});
