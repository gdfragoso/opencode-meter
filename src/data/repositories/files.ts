import type { Database } from "bun:sqlite";
import type { FileActivityEntry } from "@/data/domain/file-activity";

export interface SessionFileAggregate {
  path: string;
  action: string;
  tool: string;
  count: number;
  lastTs: number;
  additions: number;
  deletions: number;
}

export function insertSessionFiles(
  db: Database,
  sessionID: string,
  entries: FileActivityEntry[]
): void {
  const stmt = db.prepare(
    `INSERT INTO session_files (session_id, path, action, tool, ts, additions, deletions)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  );
  for (const e of entries) {
    stmt.run(sessionID, e.path, e.action, e.tool, e.ts, e.additions ?? 0, e.deletions ?? 0);
  }
}

export function findFilesBySession(
  db: Database,
  sessionID: string
): SessionFileAggregate[] {
  return db
    .query<SessionFileAggregate, [string]>(
      `SELECT path, action, MAX(tool) AS tool, COUNT(*) AS count, MAX(ts) AS lastTs,
              COALESCE(SUM(additions),0) AS additions, COALESCE(SUM(deletions),0) AS deletions
       FROM session_files
       WHERE session_id = ?
       GROUP BY path, action
       ORDER BY lastTs DESC`
    )
    .all(sessionID);
}

/* ── cost per result ─────────────────────────────────────────────────────
   The denominators behind "what did a change actually cost". Every query here
   windows on `sessions.started_at`, not on `session_files.ts`, for two reasons:
   the cost these are divided by comes from `sessions.total_cost` and has to be
   measured over the same set of rows, and `started_at` is indexed while
   `session_files.ts` is not.

   `action <> 'read'` is what makes these *results* rather than activity: a file
   the agent only looked at is not something it produced.
   ─────────────────────────────────────────────────────────────────────── */

/** Sessions whose files count, expressed as a WHERE fragment over alias `s`. */
const SESSION_WINDOW = `
  (? IS NULL OR s.directory = ?)
  AND (? IS NULL OR s.branch = ?)
  AND (? IS NULL OR s.started_at >= ?)`;

type WindowParams = [string | null, string | null, string | null, string | null, number | null, number];

function windowParams(days: number | null, project: string | null, branch: string | null): WindowParams {
  return [project, project, branch, branch, days, days === null ? 0 : Date.now() - days * 86400000];
}

export interface FileChangeTotals {
  /** Distinct paths written, created or deleted. */
  files: number;
  /** Individual write operations — a file edited twice counts twice. */
  edits: number;
  additions: number;
  deletions: number;
}

const NO_CHANGES: FileChangeTotals = { files: 0, edits: 0, additions: 0, deletions: 0 };

const CHANGE_TOTALS_SELECT = `
  SELECT COUNT(DISTINCT f.path) AS files,
         COUNT(*) AS edits,
         COALESCE(SUM(f.additions), 0) AS additions,
         COALESCE(SUM(f.deletions), 0) AS deletions
    FROM session_files f
    JOIN sessions s ON s.id = f.session_id
   WHERE f.action <> 'read'`;

export function findFileChangeTotals(
  db: Database,
  days: number | null = null,
  project: string | null = null,
  branch: string | null = null
): FileChangeTotals {
  return (
    db
      .query<FileChangeTotals, WindowParams>(`${CHANGE_TOTALS_SELECT} AND ${SESSION_WINDOW}`)
      .get(...windowParams(days, project, branch)) ?? NO_CHANGES
  );
}

/**
 * The same totals over an explicit half-open range `[from, to)`, for comparing
 * one window against the one before it. Closed at the start and open at the end
 * so two adjacent windows can share a boundary without double-counting it.
 */
export function findFileChangeTotalsInRange(
  db: Database,
  from: number,
  to: number,
  project: string | null = null,
  branch: string | null = null
): FileChangeTotals {
  return (
    db
      .query<FileChangeTotals, [number, number, string | null, string | null, string | null, string | null]>(
        `${CHANGE_TOTALS_SELECT}
           AND s.started_at >= ? AND s.started_at < ?
           AND (? IS NULL OR s.directory = ?)
           AND (? IS NULL OR s.branch = ?)`
      )
      .get(from, to, project, project, branch, branch) ?? NO_CHANGES
  );
}

export interface AgentFileChanges {
  agent: string;
  sessions: number;
  cost: number;
  files: number;
  additions: number;
  deletions: number;
}

/**
 * Per agent: what it spent, and what it changed.
 *
 * Spend and changes are aggregated separately and then joined, rather than
 * grouped over one `sessions LEFT JOIN session_files`. That join repeats a
 * session once per file it touched, so summing `total_cost` across it would
 * multiply an agent's cost by how many files it happened to edit.
 *
 * The join back is LEFT, so an agent that spent money and changed nothing still
 * has a row — that is precisely the row worth looking at.
 */
export function findFileChangesByAgent(
  db: Database,
  days: number | null = null,
  project: string | null = null,
  branch: string | null = null
): AgentFileChanges[] {
  return db
    .query<AgentFileChanges, WindowParams>(
      `WITH win AS (
         SELECT s.id AS id,
                COALESCE(s.agent, 'unknown') AS agent,
                COALESCE(s.total_cost, 0) AS cost
           FROM sessions s
          WHERE ${SESSION_WINDOW}
       ),
       spend AS (
         SELECT agent, COUNT(*) AS sessions, SUM(cost) AS cost
           FROM win GROUP BY agent
       ),
       changes AS (
         SELECT w.agent AS agent,
                COUNT(DISTINCT f.path) AS files,
                COALESCE(SUM(f.additions), 0) AS additions,
                COALESCE(SUM(f.deletions), 0) AS deletions
           FROM win w
           JOIN session_files f ON f.session_id = w.id AND f.action <> 'read'
          GROUP BY w.agent
       )
       SELECT spend.agent AS agent,
              spend.sessions AS sessions,
              spend.cost AS cost,
              COALESCE(changes.files, 0) AS files,
              COALESCE(changes.additions, 0) AS additions,
              COALESCE(changes.deletions, 0) AS deletions
         FROM spend
         LEFT JOIN changes ON changes.agent = spend.agent
        ORDER BY cost DESC, agent`
    )
    .all(...windowParams(days, project, branch));
}

export interface ToolFileChanges {
  tool: string;
  files: number;
  edits: number;
  additions: number;
  deletions: number;
}

/** Per tool: how much of the change it is responsible for. */
export function findFileChangesByTool(
  db: Database,
  days: number | null = null,
  project: string | null = null,
  branch: string | null = null
): ToolFileChanges[] {
  return db
    .query<ToolFileChanges, WindowParams>(
      `SELECT COALESCE(f.tool, 'unknown') AS tool,
              COUNT(DISTINCT f.path) AS files,
              COUNT(*) AS edits,
              COALESCE(SUM(f.additions), 0) AS additions,
              COALESCE(SUM(f.deletions), 0) AS deletions
         FROM session_files f
         JOIN sessions s ON s.id = f.session_id
        WHERE f.action <> 'read' AND ${SESSION_WINDOW}
        GROUP BY tool
        ORDER BY edits DESC, tool`
    )
    .all(...windowParams(days, project, branch));
}
