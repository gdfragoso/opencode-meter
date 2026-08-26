import { describe, it, expect, beforeEach } from "bun:test";
import { Database } from "bun:sqlite";
import { initSchema } from "@/data/db/migrations";
import { findProjects, findProjectDetail } from "@/data/repositories/projects";

function createTestDb(): Database {
  const db = new Database(":memory:");
  initSchema(db);
  return db;
}

describe("findProjects", () => {
  let db: Database;

  beforeEach(() => {
    db = createTestDb();
  });

  it("returns rows grouped by directory with aggregated branches and enriched fields", () => {
    const now = Date.now();

    db.run(
      `INSERT INTO sessions (id, directory, branch, total_cost, started_at, input_tokens, output_tokens, tools_total, subagents_total, model_id, status)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ["ses-1", "/project-a", "main", 0.1, now - 1000, 100, 50, 2, 1, "gpt-4", "completed"]
    );
    db.run(
      `INSERT INTO sessions (id, directory, branch, total_cost, started_at, input_tokens, output_tokens, tools_total, subagents_total, model_id, status)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ["ses-2", "/project-a", "dev", 0.5, now - 2000, 200, 100, 5, 2, "claude-3", "completed"]
    );
    db.run(
      `INSERT INTO sessions (id, directory, branch, total_cost, started_at, input_tokens, output_tokens, tools_total, subagents_total, model_id, status)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ["ses-3", "/project-b", "main", 0.2, now - 3000, 50, 25, 1, 0, "gpt-4", "error"]
    );

    const rows = findProjects(db, null);

    // 3 sessions across 2 directories → 2 rows
    expect(rows).toHaveLength(2);

    // Row 1: /project-a highest total_cost → comes first
    expect(rows[0].directory).toBe("/project-a");
    // Branches come back sorted, not in insertion order: the aggregate has an
    // explicit ORDER BY so the list does not shift when the query plan changes.
    expect(rows[0].branches).toBe('["dev","main"]');
    expect(rows[0].total_cost).toBeCloseTo(0.6, 5);
    expect(rows[0].sessions).toBe(2);
    expect(rows[0].tokens_in).toBe(300);
    expect(rows[0].tokens_out).toBe(150);
    expect(rows[0].tools_total).toBe(7);
    expect(rows[0].subagents_total).toBe(3);
    expect(rows[0].top_model).toBe("claude-3");
    // Enriched fields
    expect(rows[0].error_count).toBe(0); // no error sessions for project-a
    expect(rows[0].branch_count).toBe(2);
    expect(rows[0].avg_cost_per_session).toBeCloseTo(0.3, 5);
    expect(rows[0].tokens_per_dollar).toBeCloseTo(750, 1);

    // Row 2: /project-b
    expect(rows[1].directory).toBe("/project-b");
    expect(rows[1].branches).toBe('["main"]');
    expect(rows[1].total_cost).toBeCloseTo(0.2, 5);
    expect(rows[1].sessions).toBe(1);
    expect(rows[1].tokens_in).toBe(50);
    expect(rows[1].tokens_out).toBe(25);
    expect(rows[1].tools_total).toBe(1);
    expect(rows[1].subagents_total).toBe(0);
    expect(rows[1].top_model).toBe("gpt-4");
    // Enriched fields
    expect(rows[1].error_count).toBe(1); // ses-3 has status='error'
    expect(rows[1].branch_count).toBe(1);
    expect(rows[1].avg_cost_per_session).toBeCloseTo(0.2, 5);
    expect(rows[1].tokens_per_dollar).toBeCloseTo(375, 1);
  });

  it("returns empty array when all sessions are older than the days filter", () => {
    const now = Date.now();
    // Insert sessions with started_at 3 days ago (well outside 1-day window)
    const oldTs = now - 3 * 86400000;

    db.run(
      `INSERT INTO sessions (id, directory, branch, total_cost, started_at, input_tokens, output_tokens, tools_total, subagents_total, model_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ["ses-old", "/project-a", "main", 0.1, oldTs, 100, 50, 2, 1, "gpt-4"]
    );

    const rows = findProjects(db, 1);

    expect(rows).toHaveLength(0);
  });
});

describe("findProjectDetail", () => {
  let db: Database;

  beforeEach(() => {
    db = createTestDb();
  });

  it("returns enriched detail for a single project with branch summaries and models", () => {
    const now = Date.now();

    db.run(
      `INSERT INTO sessions (id, directory, branch, total_cost, started_at, input_tokens, output_tokens, tools_total, subagents_total, model_id, status)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ["ses-1", "/project-a", "main", 0.1, now - 1000, 100, 50, 2, 1, "gpt-4", "completed"]
    );
    db.run(
      `INSERT INTO sessions (id, directory, branch, total_cost, started_at, input_tokens, output_tokens, tools_total, subagents_total, model_id, status)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ["ses-2", "/project-a", "dev", 0.5, now - 2000, 200, 100, 5, 2, "claude-3", "completed"]
    );
    db.run(
      `INSERT INTO sessions (id, directory, branch, total_cost, started_at, input_tokens, output_tokens, tools_total, subagents_total, model_id, status)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ["ses-3", "/project-b", "main", 0.2, now - 3000, 50, 25, 1, 0, "gpt-4", "completed"]
    );

    const detail = findProjectDetail(db, null, "/project-a");

    expect(detail).not.toBeNull();
    if (!detail) return;

    // Base fields
    expect(detail.directory).toBe("/project-a");
    expect(detail.total_cost).toBeCloseTo(0.6, 5);
    expect(detail.sessions).toBe(2);
    expect(detail.tokens_in).toBe(300);
    expect(detail.tokens_out).toBe(150);
    expect(detail.tools_total).toBe(7);
    expect(detail.subagents_total).toBe(3);
    expect(detail.error_count).toBe(0);
    expect(detail.branch_count).toBe(2);
    expect(detail.avg_cost_per_session).toBeCloseTo(0.3, 5);

    // Branch summaries
    expect(detail.branch_summaries).toHaveLength(2);
    // dev has higher cost (0.5) so comes first
    expect(detail.branch_summaries[0].branch).toBe("dev");
    expect(detail.branch_summaries[0].total_cost).toBeCloseTo(0.5, 5);
    expect(detail.branch_summaries[0].sessions).toBe(1);
    expect(detail.branch_summaries[0].tokens_in).toBe(200);
    expect(detail.branch_summaries[0].tokens_out).toBe(100);
    expect(detail.branch_summaries[0].top_model).toBe("claude-3");

    expect(detail.branch_summaries[1].branch).toBe("main");
    expect(detail.branch_summaries[1].total_cost).toBeCloseTo(0.1, 5);
    expect(detail.branch_summaries[1].sessions).toBe(1);
    expect(detail.branch_summaries[1].top_model).toBe("gpt-4");

    // Model distribution
    expect(detail.models).toHaveLength(2);
    // claude-3 has higher cost (0.5) so comes first
    expect(detail.models[0].model_id).toBe("claude-3");
    expect(detail.models[0].sessions).toBe(1);
    expect(detail.models[0].cost).toBeCloseTo(0.5, 5);
    expect(detail.models[1].model_id).toBe("gpt-4");
    expect(detail.models[1].sessions).toBe(1);
    expect(detail.models[1].cost).toBeCloseTo(0.1, 5);
  });

  it("returns null for unknown directory", () => {
    const detail = findProjectDetail(db, null, "/nonexistent");
    expect(detail).toBeNull();
  });
});