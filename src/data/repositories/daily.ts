import type { Database } from "bun:sqlite";
import type { DailyRow } from "@/data/domain/daily";

interface DailyBaseRow {
  date: string;
  sessions: number;
  tokens_in: number;
  tokens_out: number;
  reasoning_tokens: number;
  cache_read: number;
  cache_write: number;
  total_cost: number;
  tools_total: number;
  subagents_total: number;
  errors_total: number;
  avg_ttft_ms: number | null;
}

// The session's day is the day it finished on, matching upsertRollup.
const DAY_EXPR = "date(COALESCE(started_at + duration_ms, started_at) / 1000, 'unixepoch')";
const SESSION_FILTER =
  "(? IS NULL OR directory = ?) AND (? IS NULL OR branch = ?) AND started_at >= ?";

/**
 * Daily rows computed from the sessions table.
 *
 * This is the only path now. It used to run only when a project or branch
 * filter was set, with the unfiltered case reading daily_rollups instead — and
 * the two disagreed: this one returned '[]' and NULL for models_used,
 * agents_used, top_tools and avg_ttft_ms, so picking a project made half the
 * dashboard's data disappear. It fills all of them now.
 *
 * Five queries regardless of how many days are asked for; nothing per-day.
 */
export function findDailyOnTheFly(
  db: Database,
  days: number,
  project: string | null,
  branch: string | null
): DailyRow[] {
  const since = Date.now() - days * 86_400_000;
  const filter: [string | null, string | null, string | null, string | null, number] = [
    project,
    project,
    branch,
    branch,
    since,
  ];

  const base = db
    .query<DailyBaseRow, typeof filter>(
      `SELECT ${DAY_EXPR} AS date,
        COUNT(*) AS sessions,
        COALESCE(SUM(input_tokens), 0) AS tokens_in,
        COALESCE(SUM(output_tokens), 0) AS tokens_out,
        COALESCE(SUM(reasoning_tokens), 0) AS reasoning_tokens,
        COALESCE(SUM(cache_read_tokens), 0) AS cache_read,
        COALESCE(SUM(cache_write_tokens), 0) AS cache_write,
        COALESCE(SUM(total_cost), 0) AS total_cost,
        COALESCE(SUM(tools_total), 0) AS tools_total,
        COALESCE(SUM(subagents_total), 0) AS subagents_total,
        COUNT(CASE WHEN status = 'error' OR error_type IS NOT NULL THEN 1 END) AS errors_total,
        AVG(ttft_ms) AS avg_ttft_ms
      FROM sessions
      WHERE ${SESSION_FILTER}
      GROUP BY date ORDER BY date ASC`
    )
    .all(...filter);

  if (base.length === 0) return [];

  const modelRows = db
    .query<{ date: string; model_id: string | null; provider_id: string | null; sessions: number; tokens: number; cost: number }, typeof filter>(
      `SELECT ${DAY_EXPR} AS date, model_id, provider_id,
        COUNT(*) AS sessions,
        COALESCE(SUM(input_tokens + output_tokens + reasoning_tokens + cache_read_tokens + cache_write_tokens), 0) AS tokens,
        COALESCE(SUM(total_cost), 0) AS cost
      FROM sessions WHERE ${SESSION_FILTER}
      GROUP BY date, model_id, provider_id`
    )
    .all(...filter);

  const agentRows = db
    .query<{ date: string; agent: string | null; sessions: number; tools: number }, typeof filter>(
      `SELECT ${DAY_EXPR} AS date, agent,
        COUNT(*) AS sessions,
        COALESCE(SUM(tools_total), 0) AS tools
      FROM sessions WHERE ${SESSION_FILTER}
      GROUP BY date, agent`
    )
    .all(...filter);

  const toolRows = db
    .query<{ date: string; tool: string; count: number }, [number, string | null, string | null, string | null, string | null, number]>(
      `SELECT date(e.ts / 1000, 'unixepoch') AS date,
        json_extract(e.data, '$.tool') AS tool,
        COUNT(*) AS count
      FROM events e
      WHERE e.type = 'tool.after' AND e.ts >= ?
        AND tool IS NOT NULL
        AND e.session_id IN (SELECT id FROM sessions WHERE ${SESSION_FILTER})
      GROUP BY date, tool ORDER BY count DESC`
    )
    .all(since, ...filter);

  const minuteRows = db
    .query<{ date: string; minutes: number }, [number, string | null, string | null, string | null, string | null, number]>(
      `SELECT date(e.ts / 1000, 'unixepoch') AS date,
        COUNT(DISTINCT strftime('%Y-%m-%d %H:%M', e.ts / 1000, 'unixepoch')) AS minutes
      FROM events e
      WHERE e.ts >= ?
        AND e.session_id IN (SELECT id FROM sessions WHERE ${SESSION_FILTER})
      GROUP BY date`
    )
    .all(since, ...filter);

  const groupByDate = <T extends { date: string }>(rows: T[]): Map<string, Omit<T, "date">[]> => {
    const grouped = new Map<string, Omit<T, "date">[]>();
    for (const { date, ...rest } of rows) {
      const bucket = grouped.get(date);
      if (bucket) bucket.push(rest);
      else grouped.set(date, [rest]);
    }
    return grouped;
  };

  const models = groupByDate(modelRows);
  const agents = groupByDate(agentRows);
  const tools = groupByDate(toolRows);
  const minutes = new Map(minuteRows.map((r) => [r.date, r.minutes]));

  return base.map((row) => ({
    ...row,
    avg_ttft_ms: row.avg_ttft_ms === null ? null : Math.round(row.avg_ttft_ms),
    models_used: JSON.stringify(models.get(row.date) ?? []),
    agents_used: JSON.stringify(agents.get(row.date) ?? []),
    top_tools: JSON.stringify((tools.get(row.date) ?? []).slice(0, 5)),
    active_minutes: minutes.get(row.date) ?? 0,
  }));
}

export function findRecentRollups(db: Database, days: number): DailyRow[] {
  return db.query<DailyRow, [string]>(`
    SELECT * FROM daily_rollups WHERE date >= date('now', ?) ORDER BY date ASC
  `).all(`-${days} days`);
}

export function upsertRollup(db: Database, date: string): void {
  // date(ts / 1000, 'unixepoch') is not sargable, so filtering events by it
  // meant a full scan of the whole events table. The equivalent half-open
  // epoch range uses idx_events_ts instead.
  const dayStart = Date.parse(`${date}T00:00:00Z`);
  const dayEnd = dayStart + 86_400_000;

  const sessionAgg = db.query<{ sessions: number; tokens_in: number; tokens_out: number; reasoning_tokens: number; cache_read: number; cache_write: number; total_cost: number; tools_total: number; subagents_total: number; errors_total: number; avg_ttft_ms: number | null }, [string]>(`
    SELECT
      COUNT(*) AS sessions,
      COALESCE(SUM(input_tokens), 0) AS tokens_in,
      COALESCE(SUM(output_tokens), 0) AS tokens_out,
      COALESCE(SUM(reasoning_tokens), 0) AS reasoning_tokens,
      COALESCE(SUM(cache_read_tokens), 0) AS cache_read,
      COALESCE(SUM(cache_write_tokens), 0) AS cache_write,
      COALESCE(SUM(total_cost), 0) AS total_cost,
      COALESCE(SUM(tools_total), 0) AS tools_total,
      COALESCE(SUM(subagents_total), 0) AS subagents_total,
      COALESCE(SUM(CASE WHEN status = 'error' OR error_type IS NOT NULL THEN 1 ELSE 0 END), 0) AS errors_total,
      AVG(ttft_ms) AS avg_ttft_ms
    FROM sessions
    WHERE date((started_at + duration_ms) / 1000, 'unixepoch') = ?
  `).get(date);

  const modelRows = db.query<{ model_id: string | null; provider_id: string | null; sessions: number; tokens: number; cost: number }, [string]>(`
    SELECT
      model_id,
      provider_id,
      COUNT(*) AS sessions,
      COALESCE(SUM(input_tokens + output_tokens + reasoning_tokens + cache_read_tokens + cache_write_tokens), 0) AS tokens,
      COALESCE(SUM(total_cost), 0) AS cost
    FROM sessions
    WHERE date((started_at + duration_ms) / 1000, 'unixepoch') = ?
    GROUP BY model_id, provider_id
  `).all(date);

  const agentRows = db.query<{ agent: string | null; sessions: number; tools: number }, [string]>(`
    SELECT
      agent,
      COUNT(*) AS sessions,
      COALESCE(SUM(tools_total), 0) AS tools
    FROM sessions
    WHERE date((started_at + duration_ms) / 1000, 'unixepoch') = ?
    GROUP BY agent
  `).all(date);

  const toolRows = db.query<{ tool: string; count: number }, [number, number]>(`
    SELECT
      json_extract(data, '$.tool') AS tool,
      COUNT(*) AS count
    FROM events
    WHERE type = 'tool.after'
      AND ts >= ? AND ts < ?
      AND tool IS NOT NULL
    GROUP BY tool
    ORDER BY count DESC
    LIMIT 5
  `).all(dayStart, dayEnd);

  const activeMinutes = db.query<{ minutes: number }, [number, number]>(`
    SELECT COUNT(DISTINCT strftime('%Y-%m-%d %H:%M', ts / 1000, 'unixepoch')) AS minutes
    FROM events
    WHERE ts >= ? AND ts < ?
  `).get(dayStart, dayEnd)?.minutes ?? 0;

  db.run(
    `INSERT OR REPLACE INTO daily_rollups (
      date, sessions, tokens_in, tokens_out, reasoning_tokens, cache_read, cache_write,
      total_cost, tools_total, subagents_total, errors_total, models_used, agents_used,
      top_tools, avg_ttft_ms, active_minutes
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      date,
      sessionAgg?.sessions ?? 0,
      sessionAgg?.tokens_in ?? 0,
      sessionAgg?.tokens_out ?? 0,
      sessionAgg?.reasoning_tokens ?? 0,
      sessionAgg?.cache_read ?? 0,
      sessionAgg?.cache_write ?? 0,
      sessionAgg?.total_cost ?? 0,
      sessionAgg?.tools_total ?? 0,
      sessionAgg?.subagents_total ?? 0,
      sessionAgg?.errors_total ?? 0,
      JSON.stringify(modelRows),
      JSON.stringify(agentRows),
      JSON.stringify(toolRows),
      sessionAgg?.avg_ttft_ms == null ? null : Math.round(sessionAgg.avg_ttft_ms),
      activeMinutes,
    ]
  );
}
