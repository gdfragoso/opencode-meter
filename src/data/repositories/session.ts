import type { Database } from "bun:sqlite";
import type { SessionData } from "@/data/domain/collected";
import type { SessionRow, SubagentRow } from "@/data/domain/session";

export function upsertRunning(
  db: Database,
  data: { sessionID: string; startedAt: number; title?: string; agent?: string; model?: string; provider?: string }
): void {
  db.run(
    `INSERT OR IGNORE INTO sessions (id, title, agent, model_id, provider_id, started_at, status, created_at) VALUES (?, ?, ?, ?, ?, ?, 'running', ?)`,
    [data.sessionID, data.title ?? null, data.agent ?? null, data.model ?? null, data.provider ?? null, data.startedAt, data.startedAt]
  );
  db.run(
    `UPDATE sessions SET
      status = 'running',
      title = COALESCE(?, title),
      agent = ?,
      model_id = ?,
      provider_id = ?,
      started_at = ?
    WHERE id = ?`,
    [data.title ?? null, data.agent ?? null, data.model ?? null, data.provider ?? null, data.startedAt, data.sessionID]
  );
}

export function setParent(
  db: Database,
  data: { sessionID: string; startedAt: number; parentID: string | null; title?: string; directory?: string; branch?: string }
): void {
  const sessionType = data.parentID ? "subagent" : "main";
  db.run(
    `INSERT OR IGNORE INTO sessions (id, parent_id, title, started_at, status, created_at, session_type, directory, branch) VALUES (?, ?, ?, ?, 'running', ?, ?, ?, ?)`,
    [data.sessionID, data.parentID, data.title ?? null, data.startedAt, data.startedAt, sessionType, data.directory ?? null, data.branch ?? null]
  );
  // Update parent_id AND title (session.created has the authoritative title)
  db.run(
    `UPDATE sessions SET parent_id = ?, title = COALESCE(?, title), session_type = ?, directory = COALESCE(?, directory), branch = COALESCE(?, branch) WHERE id = ?`,
    [data.parentID, data.title ?? null, sessionType, data.directory ?? null, data.branch ?? null, data.sessionID]
  );
}

export function upsert(db: Database, session: SessionData): void {
  const endedAt = Date.now();
  const startedAt = session.startedAt;

  const prev = db
    .query<Record<string, unknown>, [string]>(`SELECT * FROM sessions WHERE id = ?`)
    .get(session.sessionID);

  const pv = (key: string): string | number | null => {
    const v = (prev as Record<string, unknown> | undefined)?.[key];
    return v as string | number | null;
  };

  const prevNum = (key: string) => Number(prev?.[key] ?? 0);
  const sum = (key: string, val: number) => prevNum(key) + (val ?? 0);

  const parseArray = (val: unknown): unknown[] => {
    if (Array.isArray(val)) return val;
    if (typeof val === "string") {
      try { const p = JSON.parse(val); return Array.isArray(p) ? p : []; }
      catch { return []; }
    }
    return [];
  };

  const uniqueConcat = (key: string, next: unknown[]) => {
    const existing = parseArray(prev?.[key]);
    const set = new Set([...existing, ...(next ?? [])]);
    return JSON.stringify([...set]);
  };

  const concat = (key: string, next: unknown[]) => {
    const existing = parseArray(prev?.[key]);
    return JSON.stringify([...existing, ...(next ?? [])]);
  };

  // Resolve parent once — parent_id survives via pv("parent_id") fallback while
  // a fresh collector state would otherwise overwrite session_type. Deriving
  // the type from the resolved parent makes the write immune to write ordering.
  const parentId = session.parentID ?? pv("parent_id");

  db.run(
    `INSERT OR REPLACE INTO sessions (
      id, title, parent_id, agent, model_id, provider_id, started_at, ended_at, duration_ms, status,
      error_type, error_message, input_tokens, output_tokens, reasoning_tokens,
      cache_read_tokens, cache_write_tokens, total_cost, cost_source, cost_breakdown,
      tools_total, subagents_total, messages_total, files_touched, additions, deletions,
      ttft_ms, compaction_count, child_session_ids, tool_timings, steps, created_at,
      session_type, directory, branch, wall_ms
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      session.sessionID,
      session.title ?? pv("title"),
      parentId,
      session.agent ?? pv("agent"),
      session.model ?? pv("model_id"),
      session.provider ?? pv("provider_id"),
      pv("started_at") ?? startedAt,
      endedAt,
      sum("duration_ms", session.durationMs),
      session.status,
      session.errorType ?? pv("error_type"),
      session.errorMessage ?? pv("error_message"),
      session.inputTokens,
      session.outputTokens,
      session.reasoningTokens,
      session.cacheReadTokens,
      session.cacheWriteTokens,
      session.cost,
      session.costSource,
      JSON.stringify(session.costBreakdown),
      session.toolsUsed,
      session.subagentsUsed,
      session.messages,
      uniqueConcat("files_touched", session.filesTouched ?? []),
      // Not sum(): additions/deletions are derived from the session.diff
      // events at write time, so the value already covers the whole session.
      session.additions,
      session.deletions,
      session.ttftMs ?? pv("ttft_ms"),
      sum("compaction_count", session.compactionCount),
      uniqueConcat("child_session_ids", session.childSessionIDs ?? []),
      concat("tool_timings", session.toolTimings ?? []),
      concat("steps", session.steps ?? []),
      startedAt,
      parentId ? "subagent" : "main",
      session.directory ?? pv("directory"),
      session.branch ?? pv("branch"),
      // Wall clock, computed rather than accumulated: how long the session
      // lasted end to end. duration_ms is the time actually spent working.
      endedAt - Number(pv("started_at") ?? startedAt),
    ]
  );
}

export function findById(db: Database, id: string): SessionRow | null {
  return db
    .query<SessionRow, [string]>("SELECT * FROM sessions WHERE id = ?")
    .get(id) ?? null;
}

export function findChildrenByParentId(db: Database, parentId: string): SessionRow[] {
  return db
    .query<SessionRow, [string]>(
      "SELECT id, agent, model_id, input_tokens, output_tokens, tools_total, duration_ms, total_cost, status FROM sessions WHERE parent_id = ?"
    )
    .all(parentId);
}

export function findAll(
  db: Database,
  limit: number,
  offset: number,
  days: number | null = null,
  search: string | null = null,
  status: string | null = null,
  rootOnly: boolean = false,
  project: string | null = null,
  branch: string | null = null,
): { rows: SessionRow[]; total: number } {
  const cutoff = days !== null ? Date.now() - days * 86400000 : 0;
  const searchPattern = search ? `%${search}%` : null;

  const conditions: string[] = ["(messages_total > 0 OR status = 'running')"];
  const condParams: (number | string)[] = [];

  if (days !== null) {
    conditions.push("started_at >= ?");
    condParams.push(cutoff);
  }

  if (searchPattern) {
    conditions.push("(title LIKE ? OR agent LIKE ? OR model_id LIKE ? OR provider_id LIKE ? OR id LIKE ?)");
    condParams.push(searchPattern, searchPattern, searchPattern, searchPattern, searchPattern);
  }

  if (status === "error") {
    conditions.push("status = 'error'");
  } else if (status === "ok") {
    conditions.push("(status != 'error' AND status IS NOT NULL)");
  } else if (status === "running") {
    conditions.push("status = 'running'");
  }

  if (rootOnly) {
    conditions.push("parent_id IS NULL");
  }

  if (project !== null) {
    conditions.push("directory = ?");
    condParams.push(project);
  }

  if (branch !== null) {
    conditions.push("branch = ?");
    condParams.push(branch);
  }

  const where = conditions.join(" AND ");

  const countRow = db.prepare(`SELECT COUNT(*) as count FROM sessions WHERE ${where}`).get(...condParams) as { count: number } | undefined;
  const total = countRow?.count ?? 0;

  const rows = db.prepare(`SELECT * FROM sessions WHERE ${where} ORDER BY started_at DESC LIMIT ? OFFSET ?`)
    .all(...condParams, limit, offset) as SessionRow[];

  return { rows, total };
}

export function findSessionTypes(
  db: Database,
  days: number | null,
  project: string | null = null,
  branch: string | null = null,
): {
  main: number;
  subagent: number;
  avgSubagentsPerMain: number;
  subagentShare: Array<{ agent: string; tokens: number; cost: number; pctOfParent: number }>;
} {
  const cutoff = days !== null ? Date.now() - days * 86400000 : 0;
  const timeFilter = days !== null ? "AND started_at >= ?" : "";
  const timeParams: number[] = days !== null ? [cutoff] : [];

  const projectFilter = "AND (? IS NULL OR directory = ?) AND (? IS NULL OR branch = ?)";
  const projectParams: (string | null)[] = [project, project, branch, branch];

  const activeFilter = "(messages_total > 0 OR status = 'running')";

  const mainRow = db
    .prepare(`SELECT COUNT(*) as count FROM sessions WHERE (session_type = 'main' OR parent_id IS NULL) ${timeFilter} ${projectFilter} AND ${activeFilter}`)
    .get(...timeParams, ...projectParams) as { count: number };
  const mainCount = mainRow?.count ?? 0;

  const subagentRow = db
    .prepare(`SELECT COUNT(*) as count FROM sessions WHERE (session_type = 'subagent' OR parent_id IS NOT NULL) ${timeFilter} ${projectFilter} AND ${activeFilter}`)
    .get(...timeParams, ...projectParams) as { count: number };
  const subagentCount = subagentRow?.count ?? 0;

  const avgSubagentsPerMain = mainCount > 0 ? +(subagentCount / mainCount).toFixed(1) : 0;

  const mainTokensRow = db
    .prepare(
      `SELECT COALESCE(SUM(COALESCE(input_tokens, 0) + COALESCE(output_tokens, 0)), 0) as tokens FROM sessions WHERE (session_type = 'main' OR parent_id IS NULL) ${timeFilter} ${projectFilter} AND ${activeFilter}`
    )
    .get(...timeParams, ...projectParams) as { tokens: number };
  const mainTokens = mainTokensRow?.tokens ?? 0;

  const shareRows = db
    .prepare(
      `SELECT COALESCE(agent, 'unknown') as agent, COALESCE(SUM(COALESCE(input_tokens, 0) + COALESCE(output_tokens, 0)), 0) as tokens, COALESCE(SUM(COALESCE(total_cost, 0)), 0) as cost FROM sessions WHERE (session_type = 'subagent' OR parent_id IS NOT NULL) ${timeFilter} ${projectFilter} AND ${activeFilter} GROUP BY agent ORDER BY tokens DESC LIMIT 10`
    )
    .all(...timeParams, ...projectParams) as Array<{ agent: string; tokens: number; cost: number }>;

  const subagentShare = shareRows.map((row) => ({
    agent: row.agent,
    tokens: row.tokens,
    cost: Math.round(row.cost * 100) / 100,
    pctOfParent: mainTokens > 0 ? Math.round((row.tokens / mainTokens) * 100) : 0,
  }));

  return { main: mainCount, subagent: subagentCount, avgSubagentsPerMain, subagentShare };
}


export function findByIds(db: Database, ids: string[]): SubagentRow[] {
  const placeholders = Array.from({ length: ids.length }, () => "?").join(", ");
  return db
    .prepare(
      `SELECT id, agent, model_id, input_tokens, output_tokens, tools_total, duration_ms, total_cost, status FROM sessions WHERE id IN (${placeholders})`
    )
    .all(...ids) as SubagentRow[];
}

