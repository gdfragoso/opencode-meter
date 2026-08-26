import type { Database } from "bun:sqlite";
import type { ModelAggregateRow } from "@/data/domain/event";
import { findModelsAggregated } from "@/data/repositories/event";

export function getModelStats(
  db: Database,
  days: number | null,
  project: string | null = null,
  branch: string | null = null
): ModelAggregateRow[] {
  return findModelsAggregated(db, days, project, branch);
}
