import type { Database } from "bun:sqlite";
import type { ProjectRow, ProjectDetail, ProjectBranchSummary } from "@/data/domain/projects";

export function findProjects(
  db: Database,
  days: number | null
): ProjectRow[] {
  const cutoff = days !== null ? Date.now() - days * 86400000 : 0;

  return db
    .query<ProjectRow, [number | null, number, number | null, number, number | null, number]>(
      `SELECT
        COALESCE(NULLIF(directory,''),'unknown') AS directory,
        COALESCE(JSON_GROUP_ARRAY(DISTINCT branch ORDER BY branch) FILTER (WHERE branch IS NOT NULL), '[]') AS branches,
        COUNT(*) AS sessions,
        COALESCE(SUM(input_tokens),0) AS tokens_in,
        COALESCE(SUM(output_tokens),0) AS tokens_out,
        COALESCE(SUM(total_cost),0) AS total_cost,
        COALESCE(SUM(tools_total),0) AS tools_total,
        COALESCE(SUM(subagents_total),0) AS subagents_total,
        MAX(started_at) AS last_active,
        (SELECT model_id FROM sessions s2
          WHERE s2.directory = sessions.directory
            AND (? IS NULL OR s2.started_at >= ?)
          ORDER BY total_cost DESC LIMIT 1) AS top_model,
        (SELECT COUNT(*) FROM sessions s2
          WHERE s2.directory = sessions.directory
            AND (s2.status = 'error' OR s2.error_type IS NOT NULL)
            AND (? IS NULL OR s2.started_at >= ?)) AS error_count,
        COUNT(DISTINCT branch) AS branch_count,
        CASE WHEN COUNT(*) > 0 THEN COALESCE(SUM(total_cost),0) / COUNT(*) ELSE 0 END AS avg_cost_per_session,
        CASE WHEN COALESCE(SUM(total_cost),0) > 0 THEN (COALESCE(SUM(input_tokens),0) + COALESCE(SUM(output_tokens),0)) / COALESCE(SUM(total_cost),0) ELSE 0 END AS tokens_per_dollar
      FROM sessions
      WHERE directory IS NOT NULL
        AND (? IS NULL OR started_at >= ?)
      GROUP BY directory
      ORDER BY total_cost DESC`
    )
    .all(days, cutoff, days, cutoff, days, cutoff);
}

export function findProjectDetail(
  db: Database,
  days: number | null,
  directory: string
): ProjectDetail | null {
  const cutoff = days !== null ? Date.now() - days * 86400000 : 0;

  // 1. Base row
  const rows = db
    .query<ProjectRow, [number | null, number, number | null, number, string, number | null, number]>(
      `SELECT
        COALESCE(NULLIF(directory,''),'unknown') AS directory,
        COALESCE(JSON_GROUP_ARRAY(DISTINCT branch ORDER BY branch) FILTER (WHERE branch IS NOT NULL), '[]') AS branches,
        COUNT(*) AS sessions,
        COALESCE(SUM(input_tokens),0) AS tokens_in,
        COALESCE(SUM(output_tokens),0) AS tokens_out,
        COALESCE(SUM(total_cost),0) AS total_cost,
        COALESCE(SUM(tools_total),0) AS tools_total,
        COALESCE(SUM(subagents_total),0) AS subagents_total,
        MAX(started_at) AS last_active,
        (SELECT model_id FROM sessions s2
          WHERE s2.directory = sessions.directory
            AND (? IS NULL OR s2.started_at >= ?)
          ORDER BY total_cost DESC LIMIT 1) AS top_model,
        (SELECT COUNT(*) FROM sessions s2
          WHERE s2.directory = sessions.directory
            AND (s2.status = 'error' OR s2.error_type IS NOT NULL)
            AND (? IS NULL OR s2.started_at >= ?)) AS error_count,
        COUNT(DISTINCT branch) AS branch_count,
        CASE WHEN COUNT(*) > 0 THEN COALESCE(SUM(total_cost),0) / COUNT(*) ELSE 0 END AS avg_cost_per_session,
        CASE WHEN COALESCE(SUM(total_cost),0) > 0 THEN (COALESCE(SUM(input_tokens),0) + COALESCE(SUM(output_tokens),0)) / COALESCE(SUM(total_cost),0) ELSE 0 END AS tokens_per_dollar
      FROM sessions
      WHERE directory = ?
        AND (? IS NULL OR started_at >= ?)
      GROUP BY directory`
    )
    .all(days, cutoff, days, cutoff, directory, days, cutoff);

  if (rows.length === 0) return null;
  const base = rows[0];

  // 2. Branch summaries
  const branches = db
    .query<ProjectBranchSummary, [string, number | null, number, string, number | null, number]>(
      `SELECT
        branch,
        COUNT(*) AS sessions,
        COALESCE(SUM(total_cost),0) AS total_cost,
        COALESCE(SUM(input_tokens),0) AS tokens_in,
        COALESCE(SUM(output_tokens),0) AS tokens_out,
        MAX(started_at) AS last_active,
        (SELECT model_id FROM sessions s2
          WHERE s2.directory = ? AND (s2.branch = sessions.branch OR (s2.branch IS NULL AND sessions.branch IS NULL))
            AND (? IS NULL OR s2.started_at >= ?)
          ORDER BY total_cost DESC LIMIT 1) AS top_model
      FROM sessions
      WHERE directory = ?
        AND (? IS NULL OR started_at >= ?)
      GROUP BY branch
      ORDER BY total_cost DESC`
    )
    .all(directory, days, cutoff, directory, days, cutoff);

  // 3. Model distribution
  const models = db
    .query<{ model_id: string; sessions: number; cost: number }, [string, number | null, number]>(
      `SELECT
        model_id,
        COUNT(*) AS sessions,
        COALESCE(SUM(total_cost),0) AS cost
      FROM sessions
      WHERE directory = ?
        AND model_id IS NOT NULL
        AND (? IS NULL OR started_at >= ?)
      GROUP BY model_id
      ORDER BY cost DESC`
    )
    .all(directory, days, cutoff);

  return {
    ...base,
    branch_summaries: branches,
    models,
  };
}