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
