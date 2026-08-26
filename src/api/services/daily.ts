import type { Database } from "bun:sqlite";
import { findDailyOnTheFly } from "@/data/repositories/daily";
import type { DailyRow } from "@/data/domain/daily";

/**
 * Always computed from the sessions table.
 *
 * The unfiltered case used to read the pre-computed daily_rollups instead,
 * which returned a different shape: models_used, agents_used, top_tools and
 * avg_ttft_ms came back empty from the on-the-fly path. Selecting a project
 * therefore blanked half the dashboard. With the sessions indexes in place the
 * live computation is cheap, and daily_rollups stays as the CLI's summary
 * table rather than a second source of truth.
 */
export function getDailyRollups(
  db: Database,
  days: number,
  project: string | null = null,
  branch: string | null = null
): DailyRow[] {
  return findDailyOnTheFly(db, days, project, branch);
}
