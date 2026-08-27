import type { Database } from "bun:sqlite";
import type { CostEfficiencyResponse } from "@/data/domain/metrics";
import {
  findFileChangeTotals,
  findFileChangesByAgent,
  findFileChangesByTool,
} from "@/data/repositories/files";
import { findToolMetrics } from "@/data/repositories/event";
import { findSummaryAggregates } from "@/data/repositories/session-aggregates";

/**
 * Division that refuses to invent a number.
 *
 * Returns null rather than 0 when there is nothing to divide by: a window where
 * money was spent and no file changed is not "$0.00 per file", and rendering it
 * as one would make the worst case look like the best.
 */
function per(cost: number, count: number): number | null {
  return count > 0 ? cost / count : null;
}

/**
 * Cost measured against what came out of it, rather than against tokens.
 *
 * Every figure covers the same window, and the window is a set of sessions
 * (`started_at`), because the numerator is `sessions.total_cost`. The total here
 * is computed the same way `/api/summary` computes it — findSummaryAggregates — so the two agree.
 */
export function getCostEfficiency(
  db: Database,
  days: number | null,
  project: string | null = null,
  branch: string | null = null
): CostEfficiencyResponse {
  const summary = findSummaryAggregates(db, days, project, branch);
  const totalCost = summary?.totalCost ?? 0;
  const totalSessions = summary?.totalSessions ?? 0;

  const totals = findFileChangeTotals(db, days, project, branch);
  const lines = totals.additions + totals.deletions;

  const byAgent = findFileChangesByAgent(db, days, project, branch).map((a) => ({
    agent: a.agent,
    sessions: a.sessions,
    cost: a.cost,
    files: a.files,
    lines: a.additions + a.deletions,
    costPerFile: per(a.cost, a.files),
    costPerSession: per(a.cost, a.sessions),
  }));

  // Cost per tool comes from findToolMetrics, which splits each step's cost
  // across the tool calls that overlap it; the file counts come from
  // session_files. Two different attributions, joined on the tool name — a tool
  // that never touches a file (a search, say) keeps its cost and reports no
  // files rather than being dropped.
  const filesByTool = new Map(findFileChangesByTool(db, days, project, branch).map((t) => [t.tool, t]));
  const byTool = findToolMetrics(db, days, project, branch).map((t) => {
    const changes = filesByTool.get(t.tool);
    const files = changes?.files ?? 0;
    return {
      tool: t.tool,
      calls: t.calls,
      cost: t.total_cost,
      files,
      lines: (changes?.additions ?? 0) + (changes?.deletions ?? 0),
      costPerCall: per(t.total_cost, t.calls),
      costPerFile: per(t.total_cost, files),
    };
  });
  byTool.sort((a, b) => b.cost - a.cost || a.tool.localeCompare(b.tool));

  return {
    totalCost,
    totalSessions,
    files: totals.files,
    edits: totals.edits,
    additions: totals.additions,
    deletions: totals.deletions,
    costPerFile: per(totalCost, totals.files),
    costPerEdit: per(totalCost, totals.edits),
    costPerLine: per(totalCost, lines),
    costPerSession: per(totalCost, totalSessions),
    byAgent,
    byTool,
  };
}
