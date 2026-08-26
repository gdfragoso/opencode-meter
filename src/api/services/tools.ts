import type { Database } from "bun:sqlite";
import type { ToolMetricsRow } from "@/data/domain/event";
import { findToolsOverview, findToolMetrics } from "@/data/repositories/event";

export function getToolsOverview(
  db: Database,
  days: number | null,
  project: string | null = null,
  branch: string | null = null,
  limit = 20
): Array<{ name: string; count: number }> {
  // Repo signature is (db, limit, days, project, branch) — translate, never pass days in the limit position.
  return findToolsOverview(db, limit, days, project, branch);
}

export function getToolMetrics(db: Database, days: number | null, project: string | null = null, branch: string | null = null): ToolMetricsRow[] {
  return findToolMetrics(db, days, project, branch);
}
