import type { Database } from "bun:sqlite";
import type { SummaryResponse } from "@/data/domain/metrics";
import { findSummaryAggregates, findTopModels, findTopAgents, findTotalRequests, findCacheHitRate } from "@/data/repositories/session-aggregates";

export function getSummary(
  db: Database,
  days: number | null = null,
  project: string | null = null,
  branch: string | null = null
): SummaryResponse {
  const summary = findSummaryAggregates(db, days, project, branch);
  const topModels = findTopModels(db, days, project, branch);
  const topAgents = findTopAgents(db, days, project, branch);

  return {
    totalSessions: summary?.totalSessions ?? 0,
    totalUserSessions: summary?.totalUserSessions ?? 0,
    totalTokens: summary?.totalTokens ?? 0,
    totalCost: summary?.totalCost ?? 0,
    totalTools: summary?.totalTools ?? 0,
    totalSubagents: summary?.totalSubagents ?? 0,
    totalErrors: summary?.totalErrors ?? 0,
    topModels,
    topAgents,
  };
}

export function getTotalRequests(db: Database): number {
  return findTotalRequests(db);
}

export function getCacheHitRate(db: Database): number {
  return findCacheHitRate(db);
}
