import type { Database } from "bun:sqlite";
import { findSkillsAggregated } from "@/data/repositories/event";

export function getSkills(
  db: Database,
  days: number | null = null,
  project: string | null = null,
  branch: string | null = null
): {
  count: number;
  topSkills: { name: string; count: number }[];
} {
  const aggregated = findSkillsAggregated(db, days, project, branch);
  return {
    count: aggregated.length,
    topSkills: aggregated.slice(0, 20),
  };
}
