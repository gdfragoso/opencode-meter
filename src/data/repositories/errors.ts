import type { Database } from "bun:sqlite";
import type { DailyErrorCount, ErrorRow } from "@/data/domain/errors";

export function findErrors(
  db: Database,
  days: number | null = null,
  project: string | null = null,
  branch: string | null = null
): ErrorRow[] {
  const cutoff = days !== null ? Date.now() - days * 86400000 : 0;

  return db
    .query<ErrorRow, [number | null, number, string | null, string | null, string | null, string | null, number | null, number, string | null, string | null, string | null, string | null]>(
      `SELECT 'session' AS source, s.id, s.id AS session_id, s.title, s.error_type, s.error_message, s.started_at
       FROM sessions s
       WHERE (s.status = 'error' OR s.error_type IS NOT NULL)
         AND (? IS NULL OR s.started_at >= ?)
         AND (? IS NULL OR s.directory = ?)
         AND (? IS NULL OR s.branch = ?)
       UNION ALL
       SELECT 'event' AS source, 'evt-' || e.id AS id, sess.id AS session_id, sess.title,
              json_extract(e.data, '$.error.name') AS error_type,
              json_extract(e.data, '$.error.message') AS error_message,
              e.ts AS started_at
       FROM events e
       LEFT JOIN sessions sess ON sess.id = e.session_id
       WHERE e.type IN ('message.error', 'session.error')
AND (? IS NULL OR e.ts >= ?)
          AND (e.session_id IN (SELECT id FROM sessions WHERE (? IS NULL OR directory = ?) AND (? IS NULL OR branch = ?)) OR NOT EXISTS (SELECT 1 FROM sessions WHERE id = e.session_id))
        ORDER BY started_at DESC`
    )
    .all(days, cutoff, project, project, branch, branch, days, cutoff, project, project, branch, branch);
}

export function findDailyErrorCounts(
  db: Database,
  days: number | null = null,
  project: string | null = null,
  branch: string | null = null
): DailyErrorCount[] {
  const cutoff = days !== null ? Date.now() - days * 86400000 : 0;

  return db
    .query<DailyErrorCount, [number | null, number, string | null, string | null, string | null, string | null, number | null, number, string | null, string | null, string | null, string | null]>(
      `WITH err AS (
         SELECT s.started_at AS ts FROM sessions s
         WHERE (s.status = 'error' OR s.error_type IS NOT NULL)
           AND (? IS NULL OR s.started_at >= ?)
           AND (? IS NULL OR s.directory = ?)
           AND (? IS NULL OR s.branch = ?)
         UNION ALL
         SELECT e.ts FROM events e
         WHERE e.type IN ('message.error', 'session.error')
AND (? IS NULL OR e.ts >= ?)
            AND (e.session_id IN (SELECT id FROM sessions WHERE (? IS NULL OR directory = ?) AND (? IS NULL OR branch = ?)) OR NOT EXISTS (SELECT 1 FROM sessions WHERE id = e.session_id))
        )
       SELECT date(ts / 1000, 'unixepoch') AS date, COUNT(*) AS count
       FROM err GROUP BY date ORDER BY date ASC`
    )
    .all(days, cutoff, project, project, branch, branch, days, cutoff, project, project, branch, branch);
}
