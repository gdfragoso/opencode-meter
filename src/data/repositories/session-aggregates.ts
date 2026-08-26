import type { Database } from "bun:sqlite";

export function findSummaryAggregates(
  db: Database,
  days: number | null,
  project: string | null = null,
  branch: string | null = null
): {
  totalSessions: number;
  totalUserSessions: number;
  totalTokens: number;
  totalCost: number;
  totalTools: number;
  totalSubagents: number;
  totalErrors: number;
} | null {
  const cutoff = days !== null ? Date.now() - days * 86400000 : 0;

  return db
    .query<
      {
        totalSessions: number;
        totalUserSessions: number;
        totalTokens: number;
        totalCost: number;
        totalTools: number;
        totalSubagents: number;
        totalErrors: number;
      },
      [number | null, number, string | null, string | null, string | null, string | null]
    >(
      `SELECT
        COUNT(*) AS totalSessions,
        COUNT(CASE WHEN parent_id IS NULL THEN 1 END) AS totalUserSessions,
        COALESCE(SUM(input_tokens + output_tokens + reasoning_tokens + cache_read_tokens + cache_write_tokens), 0) AS totalTokens,
        COALESCE(SUM(total_cost), 0) AS totalCost,
        COALESCE(SUM(tools_total), 0) AS totalTools,
        COALESCE(SUM(subagents_total), 0) AS totalSubagents,
        COALESCE(SUM(CASE WHEN status = 'error' OR error_type IS NOT NULL THEN 1 ELSE 0 END), 0) AS totalErrors
      FROM sessions
      WHERE (? IS NULL OR started_at >= ?)
        AND (? IS NULL OR directory = ?)
        AND (? IS NULL OR branch = ?)`
    )
    .get(days, cutoff, project, project, branch, branch);
}

export function findTopModels(
  db: Database,
  days: number | null,
  project: string | null = null,
  branch: string | null = null
): Array<{
  model_id: string;
  provider_id: string;
  sessions: number;
  tokens: number;
  cost: number;
  ttft_avg: number | null;
  cache_hit_rate: number | null;
}> {
  const cutoff = days !== null ? Date.now() - days * 86400000 : 0;

  return db
    .query<
      {
        model_id: string;
        provider_id: string;
        sessions: number;
        tokens: number;
        cost: number;
        ttft_avg: number | null;
        cache_hit_rate: number | null;
      },
      [number | null, number, string | null, string | null, string | null, string | null]
    >(
      `SELECT
        COALESCE(model_id, '') AS model_id,
        COALESCE(provider_id, '') AS provider_id,
        COUNT(*) AS sessions,
        COALESCE(SUM(input_tokens + output_tokens + reasoning_tokens + cache_read_tokens + cache_write_tokens), 0) AS tokens,
        COALESCE(SUM(total_cost), 0) AS cost,
        AVG(CASE WHEN ttft_ms IS NOT NULL THEN ttft_ms END) AS ttft_avg,
        1.0 * COALESCE(SUM(cache_read_tokens), 0) / NULLIF(SUM(cache_read_tokens + input_tokens), 0) AS cache_hit_rate
      FROM sessions
      WHERE agent IS NOT NULL
        AND (? IS NULL OR started_at >= ?)
        AND (? IS NULL OR directory = ?)
        AND (? IS NULL OR branch = ?)
      GROUP BY model_id, provider_id
      ORDER BY cost DESC
      LIMIT 50`
    )
    .all(days, cutoff, project, project, branch, branch);
}

export function findTopAgents(
  db: Database,
  days: number | null,
  project: string | null = null,
  branch: string | null = null
): Array<{
  agent: string;
  sessions: number;
  tools: number;
  type: string;
  cost: number;
}> {
  const cutoff = days !== null ? Date.now() - days * 86400000 : 0;

  return db
    .query<
      {
        agent: string;
        sessions: number;
        tools: number;
        type: string;
        cost: number;
      },
      [number | null, number, string | null, string | null, string | null, string | null]
    >(
      `SELECT
        COALESCE(agent, '') AS agent,
        COUNT(*) AS sessions,
        COALESCE(SUM(tools_total), 0) AS tools,
        COALESCE(SUM(total_cost), 0) AS cost,
        CASE
          WHEN SUM(CASE WHEN session_type = 'main' OR parent_id IS NULL THEN 1 ELSE 0 END) > 0
           AND SUM(CASE WHEN session_type = 'subagent' OR parent_id IS NOT NULL THEN 1 ELSE 0 END) > 0 THEN 'both'
          WHEN SUM(CASE WHEN session_type = 'main' OR parent_id IS NULL THEN 1 ELSE 0 END) > 0 THEN 'main'
          ELSE 'sub'
        END AS type
      FROM sessions
      WHERE agent IS NOT NULL
        AND (? IS NULL OR started_at >= ?)
        AND (? IS NULL OR directory = ?)
        AND (? IS NULL OR branch = ?)
      GROUP BY agent
      ORDER BY sessions DESC
      LIMIT 10`
    )
    .all(days, cutoff, project, project, branch, branch);
}

export function findTotalRequests(db: Database): number {
  return db
    .query<{ total: number | null }, []>(
      `SELECT COALESCE(SUM(messages_total), 0) as total FROM sessions`
    )
    .get()?.total ?? 0;
}

export function findCacheHitRate(db: Database): number {
  return db
    .query<{ rate: number | null }, []>(
      `SELECT CAST(SUM(cache_read_tokens) AS REAL) / NULLIF(SUM(cache_read_tokens + input_tokens), 0) as rate FROM sessions`
    )
    .get()?.rate ?? 0;
}
