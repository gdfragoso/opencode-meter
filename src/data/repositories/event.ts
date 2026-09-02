import type { Database } from "bun:sqlite";
import type {
  EventRow,
  ToolMetricsRow,
  ModelAggregateRow,
} from "@/data/domain/event";
import { routingLabel } from "@/data/domain/routing";

export function insert(
  db: Database,
  sessionID: string,
  type: string,
  data: Record<string, unknown>
): void {
  db.run(
    `INSERT INTO events (ts, session_id, type, data) VALUES (?, ?, ?, ?)`,
    [Date.now(), sessionID, type, JSON.stringify(data)]
  );
}

export interface PrunableEvents {
  rows: number;
  bytes: number;
  oldestTs: number | null;
}

// Only the raw event log is prunable. sessions, session_files and
// daily_rollups hold the aggregates and stay untouched — pruning costs you the
// per-session tool timeline, not the totals.
export function countEventsBefore(db: Database, cutoff: number): PrunableEvents {
  const row = db
    .query<{ rows: number; bytes: number; oldest: number | null }, [number]>(
      `SELECT COUNT(*) AS rows,
              COALESCE(SUM(LENGTH(data)), 0) AS bytes,
              MIN(ts) AS oldest
       FROM events WHERE ts < ?`
    )
    .get(cutoff);
  return { rows: row?.rows ?? 0, bytes: row?.bytes ?? 0, oldestTs: row?.oldest ?? null };
}

export function deleteEventsBefore(db: Database, cutoff: number): number {
  db.run(`DELETE FROM events WHERE ts < ?`, [cutoff]);
  const row = db.query<{ n: number }, []>(`SELECT changes() AS n`).get();
  return row?.n ?? 0;
}

export function findBySession(db: Database, sessionID: string): EventRow[] {
  return db
    .query<EventRow, [string]>(
      "SELECT * FROM events WHERE session_id = ? ORDER BY ts"
    )
    .all(sessionID);
}

// The parent's task tool.before is persisted before the child is created, so it
// is available at child-write time (the parent's tool.after fires too late).
export function findTaskRoutingLabel(
  db: Database,
  parentID: string,
  childStartedAt: number
): string | null {
  const row = db
    .query<{ data: string }, [string, number]>(
      `SELECT data FROM events
       WHERE session_id = ? AND type = 'tool.before'
         AND json_extract(data, '$.tool') = 'task'
         AND ts <= ?
       ORDER BY ts DESC LIMIT 1`
    )
    .get(parentID, childStartedAt);
  if (!row) return null;
  try {
    return routingLabel((JSON.parse(row.data) as { args?: Record<string, unknown> }).args);
  } catch {
    return null;
  }
}

export function findSkillsAggregated(
  db: Database,
  days: number | null = null,
  project: string | null = null,
  branch: string | null = null
): Array<{ name: string; count: number }> {
  const cutoff = days !== null ? Date.now() - days * 86400000 : 0;
  const called = db
    .query<{ name: string; count: number }, [number | null, number, string | null, string | null, string | null, string | null]>(
      `SELECT json_extract(data, '$.name') AS name, COUNT(*) AS count
       FROM events WHERE type = 'skills.called' AND name IS NOT NULL
         AND (? IS NULL OR ts >= ?)
         AND session_id IN (
           SELECT id FROM sessions
           WHERE (? IS NULL OR directory = ?)
             AND (? IS NULL OR branch = ?)
         )
       GROUP BY name`
    )
    .all(days, cutoff, project, project, branch, branch);

  const loaded = db
    .query<{ name: string; count: number }, [number | null, number, string | null, string | null, string | null, string | null]>(
      `SELECT j.value AS name, COUNT(*) AS count
       FROM events, json_each(json_extract(events.data, '$.skills')) j
       WHERE events.type = 'skills.loaded'
         AND (? IS NULL OR events.ts >= ?)
         AND events.session_id IN (
           SELECT id FROM sessions
           WHERE (? IS NULL OR directory = ?)
             AND (? IS NULL OR branch = ?)
         )
       GROUP BY j.value`
    )
    .all(days, cutoff, project, project, branch, branch);

  const agg = new Map<string, number>();
  for (const r of called) agg.set(r.name, (agg.get(r.name) ?? 0) + r.count);
  for (const r of loaded) agg.set(r.name, (agg.get(r.name) ?? 0) + r.count);

  return [...agg.entries()]
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => b.count - a.count);
}

interface ToolCall {
  tool: string;
  duration_ms: number;
}

interface ToolAggregate {
  calls: number;
  total_dur: number;
}

/**
 * Counts calls and durations per tool name.
 *
 * There used to be a sweep here that split each step's cost across the tool
 * calls overlapping it, and the result was shown as `~Tokens` / `~Cost`. It was
 * removed because the model does not survive being stated out loud: a step's
 * cost is the model's tokens for that turn, and dividing it by how long each
 * tool happened to run rewards a `bash` that sleeps and ignores a `read` that
 * returns fifty thousand tokens in twenty milliseconds — close to backwards
 * from what actually drives the bill.
 *
 * `step.finish` still records cost and tokens, so an attribution worth trusting
 * has history to work from whenever one is written.
 */
function aggregateToolCalls(tools: ToolCall[]): Map<string, ToolAggregate> {
  const agg = new Map<string, ToolAggregate>();
  for (const t of tools) {
    let a = agg.get(t.tool);
    if (!a) {
      a = { calls: 0, total_dur: 0 };
      agg.set(t.tool, a);
    }
    a.calls++;
    a.total_dur += t.duration_ms;
  }
  return agg;
}

export interface SessionCounters {
  cost: number;
  costBreakdown: { input: number; output: number; cacheRead: number; cacheWrite: number };
  inputTokens: number;
  outputTokens: number;
  reasoningTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  toolsUsed: number;
  messages: number;
  subagentsUsed: number;
}

export function deriveSessionCounters(db: Database, sessionID: string): SessionCounters {
  const msg = db
    .query<Record<string, number | null>, [string]>(
      `SELECT
         COALESCE(SUM(m.cost), 0) AS cost,
         COALESCE(SUM(m.input), 0) AS input_tokens,
         COALESCE(SUM(m.output), 0) AS output_tokens,
         COALESCE(SUM(m.reasoning), 0) AS reasoning_tokens,
         COALESCE(SUM(m.cache_read), 0) AS cache_read_tokens,
         COALESCE(SUM(m.cache_write), 0) AS cache_write_tokens,
         COUNT(*) AS messages
       FROM (
         SELECT json_extract(e.data, '$.cost') AS cost,
                COALESCE(json_extract(e.data, '$.tokens.input'), 0) AS input,
                COALESCE(json_extract(e.data, '$.tokens.output'), 0) AS output,
                COALESCE(json_extract(e.data, '$.tokens.reasoning'), 0) AS reasoning,
                COALESCE(json_extract(e.data, '$.tokens.cache.read'), 0) AS cache_read,
                COALESCE(json_extract(e.data, '$.tokens.cache.write'), 0) AS cache_write
         FROM events e
         JOIN (
           SELECT MIN(id) AS id
           FROM events
           WHERE type = 'message.updated' AND session_id = ?
             AND json_extract(data, '$.messageID') IS NOT NULL
           GROUP BY json_extract(data, '$.messageID')
         ) d ON e.id = d.id
       ) m`
    )
    .get(sessionID);

  const tools = db
    .query<{ tools: number }, [string]>(
      `SELECT COUNT(*) AS tools FROM events WHERE type = 'tool.after' AND session_id = ?`
    )
    .get(sessionID);

  const subagents = db
    .query<{ subagents: number }, [string]>(
      `SELECT COUNT(*) AS subagents FROM sessions WHERE parent_id = ?`
    )
    .get(sessionID);

  return {
    cost: msg?.cost ?? 0,
    costBreakdown: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    inputTokens: msg?.input_tokens ?? 0,
    outputTokens: msg?.output_tokens ?? 0,
    reasoningTokens: msg?.reasoning_tokens ?? 0,
    cacheReadTokens: msg?.cache_read_tokens ?? 0,
    cacheWriteTokens: msg?.cache_write_tokens ?? 0,
    toolsUsed: tools?.tools ?? 0,
    messages: msg?.messages ?? 0,
    subagentsUsed: subagents?.subagents ?? 0,
  };
}

export interface SessionDiffTotals {
  additions: number;
  deletions: number;
  filesTouched: string[];
}

// session.diff carries the session's snapshot diff, so a file re-appears with
// cumulative counts every time it is edited. Keep only the last row per file
// (highest event id) and sum those — summing every row would inflate the
// totals, and deriving here keeps repeated session-end writes idempotent, the
// same way deriveSessionCounters does for tokens and cost.
export function deriveSessionDiff(db: Database, sessionID: string): SessionDiffTotals {
  const rows = db
    .query<{ file: string; additions: number; deletions: number }, [string]>(
      `SELECT file, additions, deletions FROM (
         SELECT json_extract(j.value, '$.file') AS file,
                COALESCE(json_extract(j.value, '$.additions'), 0) AS additions,
                COALESCE(json_extract(j.value, '$.deletions'), 0) AS deletions,
                ROW_NUMBER() OVER (
                  PARTITION BY json_extract(j.value, '$.file') ORDER BY e.id DESC
                ) AS rn
         FROM events e, json_each(json_extract(e.data, '$.diff')) j
         WHERE e.type = 'session.diff' AND e.session_id = ?
           AND json_extract(j.value, '$.file') IS NOT NULL
       ) WHERE rn = 1`
    )
    .all(sessionID);

  let additions = 0;
  let deletions = 0;
  for (const row of rows) {
    additions += row.additions;
    deletions += row.deletions;
  }
  return { additions, deletions, filesTouched: rows.map((r) => r.file) };
}

export function findToolsBySession(db: Database, sessionID: string): Array<{ name: string; count: number }> {
  const tools = db
    .query<ToolCall, [string]>(
      `SELECT json_extract(b.data, '$.tool') AS tool,
              (a.ts - b.ts) AS duration_ms
       FROM events b
       JOIN events a ON b.session_id = a.session_id AND b.call_id = a.call_id
       WHERE b.session_id = ? AND b.type = 'tool.before' AND a.type = 'tool.after'
         AND b.call_id IS NOT NULL AND a.call_id IS NOT NULL
       ORDER BY b.ts`
    )
    .all(sessionID);

  return [...aggregateToolCalls(tools).entries()]
    .map(([name, a]) => ({ name, count: a.calls }))
    .sort((a, b) => b.count - a.count);
}

export function findToolsOverview(
  db: Database,
  limit: number = 20,
  days: number | null = null,
  project: string | null = null,
  branch: string | null = null
): Array<{ name: string; count: number }> {
  const cutoff = days !== null ? Date.now() - days * 86400000 : 0;
  return db
    .query<{ name: string; count: number }, [number | null, number, string | null, string | null, string | null, string | null, number]>(
      `SELECT json_extract(data, '$.tool') AS name, COUNT(*) AS count
       FROM events WHERE type = 'tool.after'
         AND (? IS NULL OR ts >= ?)
         AND session_id IN (
           SELECT id FROM sessions
           WHERE (? IS NULL OR directory = ?)
             AND (? IS NULL OR branch = ?)
         )
       GROUP BY name ORDER BY count DESC LIMIT ?`
    )
    .all(days, cutoff, project, project, branch, branch, limit);
}

export function findToolMetrics(
  db: Database,
  days: number | null = null,
  project: string | null = null,
  branch: string | null = null
): ToolMetricsRow[] {
  const cutoff = days !== null ? Date.now() - days * 86400000 : null;
  const cutoffVal = cutoff ?? 0;

  const tools = db
    .query<ToolCall, [number | null, number, string | null, string | null, string | null, string | null]>(
      `SELECT json_extract(b.data, '$.tool') AS tool,
              (a.ts - b.ts) AS duration_ms
       FROM events b
       JOIN events a ON b.session_id = a.session_id AND b.call_id = a.call_id
       WHERE b.type = 'tool.before' AND a.type = 'tool.after'
         AND b.call_id IS NOT NULL AND a.call_id IS NOT NULL
         AND (? IS NULL OR a.ts >= ?)
         AND b.session_id IN (
           SELECT id FROM sessions
           WHERE (? IS NULL OR directory = ?)
             AND (? IS NULL OR branch = ?)
         )
       ORDER BY b.ts`
    )
    .all(days, cutoffVal, project, project, branch, branch);

  return [...aggregateToolCalls(tools).entries()]
    .map(([tool, agg]) => ({
      tool,
      calls: agg.calls,
      avg_duration_ms: Math.round(agg.total_dur / agg.calls),
    }))
    .sort((a, b) => b.calls - a.calls || a.tool.localeCompare(b.tool));
}

export function findModelsAggregated(
  db: Database,
  days: number | null = null,
  project: string | null = null,
  branch: string | null = null
): ModelAggregateRow[] {
  const cutoff = days !== null ? Date.now() - days * 86400000 : 0;

  return db
    .query<ModelAggregateRow, [number | null, number, string | null, string | null, string | null, string | null]>(
      `SELECT
        COALESCE(model_id, '') AS model_id,
        COALESCE(provider_id, '') AS provider_id,
        COUNT(*) AS sessions,
        COALESCE(SUM(input_tokens + output_tokens + reasoning_tokens + cache_read_tokens + cache_write_tokens), 0) AS tokens,
        COALESCE(SUM(total_cost), 0) AS cost,
        AVG(CASE WHEN ttft_ms IS NOT NULL THEN ttft_ms END) AS ttft_avg_ms,
        1.0 * COALESCE(SUM(cache_read_tokens), 0) / NULLIF(SUM(cache_read_tokens + input_tokens), 0) AS cache_hit_rate,
        1.0 * COALESCE(SUM(CASE WHEN status = 'error' THEN 1 ELSE 0 END), 0) / NULLIF(COUNT(*), 0) AS error_rate,
        CASE WHEN SUM(duration_ms) > 0 THEN COALESCE(SUM(input_tokens + output_tokens), 0) * 1000.0 / SUM(duration_ms) ELSE 0 END AS tokens_per_sec
      FROM sessions
      WHERE agent IS NOT NULL
        AND model_id IS NOT NULL
        AND (? IS NULL OR started_at >= ?)
        AND (? IS NULL OR directory = ?)
        AND (? IS NULL OR branch = ?)
      GROUP BY model_id, provider_id
      ORDER BY tokens DESC`
    )
    .all(days, cutoff, project, project, branch, branch);
}

/* ── context per turn ─────────────────────────────────────────────────── */

export interface ContextTurnRow {
  id: number;
  /** Null when the turn carried no token accounting at all. */
  input: number | null;
  cache_read: number | null;
}

/**
 * Prompt size per assistant turn, oldest first.
 *
 * Deduplicated the same way deriveSessionCounters does — `MIN(id)` per
 * `messageID` — because `session.idle` fires once per assistant turn, so the
 * same message.updated is written again on every subsequent turn. Without the
 * dedup the curve repeats turns and climbs for a reason that is not context.
 */
export function findContextTurns(db: Database, sessionID: string): ContextTurnRow[] {
  return db
    .query<ContextTurnRow, [string]>(
      // Deliberately NOT coalesced to 0: a turn that reported no tokens is a
      // hole in the series, and drawing it as zero puts a plunge to the axis
      // where the context never moved. Same reason CacheTimelineChart draws
      // gaps rather than zeros.
      `SELECT e.id AS id,
              json_extract(e.data, '$.tokens.input') AS input,
              json_extract(e.data, '$.tokens.cache.read') AS cache_read
         FROM events e
         JOIN (
           SELECT MIN(id) AS id
           FROM events
           WHERE type = 'message.updated' AND session_id = ?
             AND json_extract(data, '$.messageID') IS NOT NULL
           GROUP BY json_extract(data, '$.messageID')
         ) d ON e.id = d.id
        ORDER BY e.id`
    )
    .all(sessionID);
}

/** Event ids of every compaction in the session, oldest first. */
export function findCompactionEventIds(db: Database, sessionID: string): number[] {
  return db
    .query<{ id: number }, [string]>(
      `SELECT id FROM events
        WHERE type = 'session.compacted' AND session_id = ?
        ORDER BY id`
    )
    .all(sessionID)
    .map((r) => r.id);
}
