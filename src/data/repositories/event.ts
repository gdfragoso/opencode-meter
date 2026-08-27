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

interface StepWindow {
  session_id: string;
  step_start: number;
  step_end: number;
  tokens: number;
  cost: number;
}

interface ToolCall {
  session_id: string;
  tool: string;
  tool_start: number;
  tool_end: number;
  duration_ms: number;
}

interface ToolAggregate {
  calls: number;
  total_dur: number;
  tokens: number;
  cost: number;
}

/**
 * Splits each step's tokens and cost across the tool calls that ran inside it,
 * in proportion to how much of the step each call overlapped.
 *
 * Grouped by session first, and that grouping is load-bearing rather than
 * tidiness. Steps and tool calls used to be matched on timestamps alone, so a
 * step belonging to a subagent was distributed onto whatever the *parent* was
 * running at that moment — and since the parent is blocked inside its `task`
 * call for exactly as long as the subagent runs, the overlap was always total.
 * The subagent's spend landed on `task` on top of the tools that actually
 * incurred it, and the column summed to more than was ever spent.
 *
 * Known limit, unchanged here: two tool calls running concurrently *within one
 * session* both take a share of the same step, so the step's cost is counted
 * once per overlapping call. Sequential calls — the common case — are exact.
 */
function distributeStepTokens(tools: ToolCall[], steps: StepWindow[]): Map<string, ToolAggregate> {
  const agg = new Map<string, ToolAggregate>();

  const stepsBySession = new Map<string, StepWindow[]>();
  for (const s of steps) {
    const list = stepsBySession.get(s.session_id);
    if (list) list.push(s);
    else stepsBySession.set(s.session_id, [s]);
  }

  const toolsBySession = new Map<string, ToolCall[]>();
  for (const t of tools) {
    const list = toolsBySession.get(t.session_id);
    if (list) list.push(t);
    else toolsBySession.set(t.session_id, [t]);
  }

  for (const [sessionID, sessionTools] of toolsBySession) {
    sweepSession(sessionTools, stepsBySession.get(sessionID) ?? [], agg);
  }

  return agg;
}

/**
 * Splits one session's step cost across its tool calls.
 *
 * Sweeps the timeline instead of visiting each (tool, step) pair. At every
 * instant the step's cost accrues at a constant rate, and that instant's share
 * is divided among the tool calls actually running then — which is the whole
 * point: OpenCode runs tools in parallel, and charging each concurrent call the
 * full slice made a $10 step report $10 to every tool that overlapped it. Two
 * parallel calls turned $10 into $20.
 *
 * Time inside a step with no tool running is left unattributed. That is the
 * model working: it is the assistant thinking, not a tool call, and inventing
 * an owner for it would inflate the column again.
 *
 * O((T + S) log (T + S)) for the sort, then one pass over the boundaries.
 */
function sweepSession(tools: ToolCall[], steps: StepWindow[], agg: Map<string, ToolAggregate>): void {
  // Counts and durations are per call and independent of cost attribution.
  for (const t of tools) {
    let a = agg.get(t.tool);
    if (!a) {
      a = { calls: 0, total_dur: 0, tokens: 0, cost: 0 };
      agg.set(t.tool, a);
    }
    a.calls++;
    a.total_dur += t.duration_ms;
  }

  const spans = tools.filter((t) => t.tool_end > t.tool_start);
  const windows = steps.filter((s) => s.step_end > s.step_start);
  if (spans.length === 0 || windows.length === 0) return;

  interface Boundary {
    ts: number;
    isTool: boolean;
    index: number;
    opening: boolean;
  }

  const boundaries: Boundary[] = [];
  spans.forEach((t, index) => {
    boundaries.push({ ts: t.tool_start, isTool: true, index, opening: true });
    boundaries.push({ ts: t.tool_end, isTool: true, index, opening: false });
  });
  windows.forEach((s, index) => {
    boundaries.push({ ts: s.step_start, isTool: false, index, opening: true });
    boundaries.push({ ts: s.step_end, isTool: false, index, opening: false });
  });

  // Close before open at the same instant: a call ending exactly as another
  // starts was never concurrent with it, and treating them as overlapping would
  // halve both their shares.
  boundaries.sort((a, b) => a.ts - b.ts || Number(a.opening) - Number(b.opening));

  const openTools = new Set<number>();
  const openSteps = new Set<number>();
  let previous = boundaries[0]!.ts;

  for (const boundary of boundaries) {
    const elapsed = boundary.ts - previous;
    if (elapsed > 0) {
      if (openTools.size > 0 && openSteps.size > 0) {
        let cost = 0;
        let tokens = 0;
        for (const index of openSteps) {
          const s = windows[index]!;
          const fraction = elapsed / (s.step_end - s.step_start);
          cost += fraction * s.cost;
          tokens += fraction * s.tokens;
        }
        const share = 1 / openTools.size;
        for (const index of openTools) {
          const a = agg.get(spans[index]!.tool)!;
          a.cost += cost * share;
          a.tokens += tokens * share;
        }
      }
      previous = boundary.ts;
    }

    const open = boundary.isTool ? openTools : openSteps;
    if (boundary.opening) open.add(boundary.index);
    else open.delete(boundary.index);
  }
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

export function findToolsBySession(db: Database, sessionID: string): Array<{ name: string; count: number; estimated_tokens: number; estimated_cost: number }> {
  // 1. Get step windows with tokens/cost. Steps repeat per agent inside a
  //    session (each agent runs step 1, 2, 3…), so joining on (session_id,
  //    step) alone cross-products. Pair the k-th start with the k-th finish
  //    by occurrence order instead.
  const steps = db
    .query<StepWindow, [string, string]>(
      `WITH starts AS (
         SELECT session_id, json_extract(data, '$.step') AS step, ts,
                ROW_NUMBER() OVER (PARTITION BY session_id, json_extract(data, '$.step') ORDER BY ts) AS rn
         FROM events WHERE type = 'step.start' AND session_id = ?
       ),
       finishes AS (
         SELECT session_id, json_extract(data, '$.step') AS step, ts,
                COALESCE(json_extract(data, '$.tokens.input'), 0) + COALESCE(json_extract(data, '$.tokens.output'), 0) AS tokens,
                COALESCE(json_extract(data, '$.cost'), 0) AS cost,
                ROW_NUMBER() OVER (PARTITION BY session_id, json_extract(data, '$.step') ORDER BY ts) AS rn
         FROM events WHERE type = 'step.finish' AND session_id = ?
       )
       SELECT s.session_id, s.ts AS step_start, f.ts AS step_end, f.tokens, f.cost
       FROM starts s
       JOIN finishes f
         ON s.session_id = f.session_id
        AND s.step = f.step
        AND s.rn = f.rn
       ORDER BY s.ts`
    )
    .all(sessionID, sessionID);

  // 2. Get tool calls with duration
  const tools = db
    .query<ToolCall, [string]>(
      `SELECT b.session_id, json_extract(b.data, '$.tool') AS tool,
              b.ts AS tool_start, a.ts AS tool_end,
              (a.ts - b.ts) AS duration_ms
       FROM events b
       JOIN events a ON b.session_id = a.session_id AND b.call_id = a.call_id
       WHERE b.session_id = ? AND b.type = 'tool.before' AND a.type = 'tool.after'
         AND b.call_id IS NOT NULL AND a.call_id IS NOT NULL
       ORDER BY b.ts`
    )
    .all(sessionID);

  // 3. Distribute step tokens to tools proportionally (sweep-line)
  const agg = distributeStepTokens(tools, steps);

  return [...agg.entries()]
    .map(([name, a]) => ({
      name,
      count: a.calls,
      estimated_tokens: Math.round(a.tokens),
      estimated_cost: Math.round(a.cost * 10000) / 10000,
    }))
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

  // Step windows with tokens/cost. Steps repeat per agent inside a session
  // (each agent runs step 1, 2, 3…), so joining on (session_id, step) alone
  // cross-products: one session with 51 subagents produced 51 × 51 = 2.6k
  // pairs per step group and 223k rows globally. Pair the k-th start with
  // the k-th finish by occurrence order instead.
  const steps = db
    .query<StepWindow, [string | null, string | null, string | null, string | null, string | null, string | null, string | null, string | null, number | null, number]>(
      `WITH starts AS (
         SELECT session_id, json_extract(data, '$.step') AS step, ts,
                ROW_NUMBER() OVER (PARTITION BY session_id, json_extract(data, '$.step') ORDER BY ts) AS rn
         FROM events WHERE type = 'step.start'
           AND session_id IN (
             SELECT id FROM sessions
             WHERE (? IS NULL OR directory = ?)
               AND (? IS NULL OR branch = ?)
           )
       ),
       finishes AS (
         SELECT session_id, json_extract(data, '$.step') AS step, ts,
                COALESCE(json_extract(data, '$.tokens.input'), 0) + COALESCE(json_extract(data, '$.tokens.output'), 0) AS tokens,
                COALESCE(json_extract(data, '$.cost'), 0) AS cost,
                ROW_NUMBER() OVER (PARTITION BY session_id, json_extract(data, '$.step') ORDER BY ts) AS rn
         FROM events WHERE type = 'step.finish'
           AND session_id IN (
             SELECT id FROM sessions
             WHERE (? IS NULL OR directory = ?)
               AND (? IS NULL OR branch = ?)
           )
       )
       SELECT s.session_id, s.ts AS step_start, f.ts AS step_end, f.tokens, f.cost
       FROM starts s
       JOIN finishes f
         ON s.session_id = f.session_id
        AND s.step = f.step
        AND s.rn = f.rn
       WHERE (? IS NULL OR f.ts >= ?)
       ORDER BY s.ts`
    )
    .all(project, project, branch, branch, project, project, branch, branch, days, cutoffVal);

  // Tool calls with duration
  const tools = db
    .query<ToolCall, [number | null, number, string | null, string | null, string | null, string | null]>(
      `SELECT b.session_id, json_extract(b.data, '$.tool') AS tool,
              b.ts AS tool_start, a.ts AS tool_end,
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

  // Distribute step tokens to tools proportionally by overlap (sweep-line)
  const toolAgg = distributeStepTokens(tools, steps);

  return [...toolAgg.entries()]
    .map(([tool, agg]) => ({
      tool,
      calls: agg.calls,
      avg_duration_ms: Math.round(agg.total_dur / agg.calls),
      total_tokens: Math.round(agg.tokens),
      total_cost: Math.round(agg.cost * 10000) / 10000,
    }))
    .sort((a, b) => b.calls - a.calls || b.total_cost - a.total_cost);
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
