import { Database } from "bun:sqlite";
import { mkdirSync } from "fs";
import { homedir } from "os";
import { join } from "path";

const DB_DIR = join(homedir(), ".local", "share", "opencode-meter");
export const DB_PATH = join(DB_DIR, "metrics.db");

let db: Database | null = null;

export function getDb(): Database {
  if (db === null) {
    mkdirSync(DB_DIR, { recursive: true });
    db = new Database(DB_PATH, { create: true });
    db.run("PRAGMA journal_mode=WAL");
    db.run("PRAGMA busy_timeout=5000");
  }
  return db;
}

export function registerCleanup(database: Database): void {
  const close = () => {
    try {
      database.run("PRAGMA wal_checkpoint(TRUNCATE)");
      database.close();
    } catch { /* ignore */ }
  };
  process.on("exit", close);
  process.on("SIGINT", close);
  process.on("SIGTERM", close);
}
