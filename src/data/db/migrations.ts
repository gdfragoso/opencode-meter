import { Database } from "bun:sqlite";
import { createConsoleLogger, errString, type Logger } from "@/shared/logging";

// PRAGMA table_xinfo, not table_info: it also lists generated columns, which is
// how call_id is declared. Checking beats catching — the old `try { ALTER }
// catch {}` swallowed disk-full and corruption along with "duplicate column".
function columnNames(db: Database, table: string): Set<string> {
  const rows = db.query<{ name: string }, []>(`PRAGMA table_xinfo(${table})`).all();
  return new Set(rows.map((r) => r.name));
}

function addColumn(db: Database, table: string, column: string, declaration: string): void {
  if (columnNames(db, table).has(column)) return;
  db.run(`ALTER TABLE ${table} ADD COLUMN ${declaration}`);
}

// DROP COLUMN needs SQLite >= 3.35. On anything older the column simply stays;
// that is worth a warning, not a failed startup.
function dropColumn(db: Database, table: string, column: string, logger: Logger): void {
  if (!columnNames(db, table).has(column)) return;
  try {
    db.run(`ALTER TABLE ${table} DROP COLUMN ${column}`);
  } catch (err) {
    logger.warn(`Could not drop ${table}.${column}; leaving it in place`, { error: errString(err) });
  }
}

export function initSchema(db: Database, logger: Logger = createConsoleLogger()): void {
  try {
    db.run(`
      CREATE TABLE IF NOT EXISTS sessions (
        id TEXT PRIMARY KEY,
        title TEXT,
        parent_id TEXT,
        agent TEXT,
        model_id TEXT,
        provider_id TEXT,
        started_at INTEGER,
        ended_at INTEGER,
        duration_ms INTEGER,
        status TEXT,
        error_type TEXT,
        error_message TEXT,
        input_tokens INTEGER,
        output_tokens INTEGER,
        reasoning_tokens INTEGER,
        cache_read_tokens INTEGER,
        cache_write_tokens INTEGER,
        total_cost REAL,
        cost_source TEXT,
        cost_breakdown TEXT,
        tools_total INTEGER,
        subagents_total INTEGER,
        messages_total INTEGER,
        files_touched TEXT,
        additions INTEGER,
        deletions INTEGER,
        ttft_ms INTEGER,
        compaction_count INTEGER DEFAULT 0,
        child_session_ids TEXT,
        tool_timings TEXT,
        steps TEXT,
        created_at INTEGER,
        session_type TEXT
      )
    `);

    db.run(`
      CREATE TABLE IF NOT EXISTS events (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        ts INTEGER NOT NULL,
        session_id TEXT NOT NULL,
        type TEXT NOT NULL,
        data TEXT NOT NULL
      )
    `);
    db.run(`CREATE INDEX IF NOT EXISTS idx_events_session_type ON events (session_id, type)`);
    db.run(`CREATE INDEX IF NOT EXISTS idx_events_ts ON events (ts)`);

    // Generated column so tool.before/tool.after self-joins use an index
    // instead of comparing json_extract() per pair. Do NOT add an index on
    // events(type) alone: it disables SQLite's automatic indexing on the
    // window-function self-joins in event.ts and makes them ~100x slower.
    addColumn(db, "events", "call_id", "call_id TEXT GENERATED ALWAYS AS (json_extract(data, '$.callID')) VIRTUAL");
    db.run(`CREATE INDEX IF NOT EXISTS idx_events_session_call ON events (session_id, call_id) WHERE call_id IS NOT NULL`);

    // Columns added to sessions after the first release.
    addColumn(db, "sessions", "title", "title TEXT");
    addColumn(db, "sessions", "session_type", "session_type TEXT");
    addColumn(db, "sessions", "directory", "directory TEXT");
    addColumn(db, "sessions", "branch", "branch TEXT");
    addColumn(db, "sessions", "wall_ms", "wall_ms INTEGER");

    // Cleanup for databases written before the first release. A behaviour-
    // scoring experiment kept prompt text in `sessions.user_messages` and a
    // `behavior_metrics` table; it was cut before v1.0.0, so no published
    // version ever wrote either. Only local databases from a pre-release
    // checkout can still hold them — and holding what someone typed is not a
    // state to leave a database in, so they go on first run.
    dropColumn(db, "sessions", "user_messages", logger);
    db.run(`DROP TABLE IF EXISTS behavior_metrics`);
    db.run(`DROP INDEX IF EXISTS idx_behavior_session_ts`);

    db.run(`CREATE INDEX IF NOT EXISTS idx_sessions_started ON sessions (started_at DESC)`);
    db.run(`CREATE INDEX IF NOT EXISTS idx_sessions_project ON sessions (directory, branch, started_at)`);
    db.run(`CREATE INDEX IF NOT EXISTS idx_sessions_parent ON sessions (parent_id) WHERE parent_id IS NOT NULL`);


    db.run(`
      CREATE TABLE IF NOT EXISTS daily_rollups (
        date TEXT PRIMARY KEY,
        sessions INTEGER DEFAULT 0,
        tokens_in INTEGER DEFAULT 0,
        tokens_out INTEGER DEFAULT 0,
        reasoning_tokens INTEGER DEFAULT 0,
        cache_read INTEGER DEFAULT 0,
        cache_write INTEGER DEFAULT 0,
        total_cost REAL DEFAULT 0,
        tools_total INTEGER DEFAULT 0,
        subagents_total INTEGER DEFAULT 0,
        errors_total INTEGER DEFAULT 0,
        models_used TEXT DEFAULT '[]',
        agents_used TEXT DEFAULT '[]',
        top_tools TEXT DEFAULT '[]',
        avg_ttft_ms INTEGER,
        active_minutes INTEGER DEFAULT 0
      )
    `);

    db.run(`
      CREATE TABLE IF NOT EXISTS session_files (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        session_id TEXT NOT NULL,
        path TEXT NOT NULL,
        action TEXT NOT NULL,
        tool TEXT NOT NULL,
        ts INTEGER NOT NULL,
        additions INTEGER DEFAULT 0,
        deletions INTEGER DEFAULT 0
      )
    `);
    db.run(`CREATE INDEX IF NOT EXISTS idx_session_files_session ON session_files (session_id)`);
    db.run(`CREATE INDEX IF NOT EXISTS idx_session_files_session_action ON session_files (session_id, action)`);
  } catch (err) {
    logger.error("Failed to initialize schema", { error: errString(err) });
    throw err;
  }
}
