#!/usr/bin/env bun

import type { Database } from "bun:sqlite";
import { statSync } from "node:fs";
import { getDb, DB_PATH } from "@/data/db/connection";
import { initSchema } from "@/data/db/migrations";
import type { CliJsonResult } from "@/data/domain/cli";
import type { ModelAggregateRow } from "@/data/domain/event";
import { getSummary, getTotalRequests, getCacheHitRate } from "@/api/services/metrics";
import { getModelStats } from "@/api/services/models";
import { countEventsBefore, deleteEventsBefore } from "@/data/repositories/event";

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const units = ["KB", "MB", "GB"];
  let value = bytes / 1024;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit++;
  }
  return `${value.toFixed(value < 10 ? 1 : 0)} ${units[unit]}`;
}

function dbSizeBytes(): number {
  try {
    return statSync(DB_PATH).size;
  } catch {
    return 0;
  }
}

function argValue(args: string[], name: string): string | undefined {
  const index = args.indexOf(name);
  return index === -1 ? undefined : args[index + 1];
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

export function buildJsonResult(db: Database): CliJsonResult {
  const summary = getSummary(db, null);
  return {
    totalSessions: summary.totalSessions,
    totalRequests: getTotalRequests(db),
    totalCost: summary.totalCost,
    totalTokens: summary.totalTokens,
    cacheHitRate: round2(getCacheHitRate(db)),
    totalTools: summary.totalTools,
    totalSubagents: summary.totalSubagents,
    totalErrors: summary.totalErrors,
    byModel: getModelStats(db, null).map((m) => ({ ...m, cost: round2(m.cost) })),
    byAgent: summary.topAgents,
  };
}

function renderSummaryTable(rows: ModelAggregateRow[]): string {
  const headers = ["Model", "Sessions", "Cost", "Tokens"];
  const aligns: Array<"left" | "right"> = ["left", "right", "right", "right"];
  const cells = rows.map((r) => [
    r.model_id,
    r.sessions.toLocaleString(),
    `$${r.cost.toFixed(2)}`,
    r.tokens.toLocaleString(),
  ]);

  const widths = headers.map((h, i) =>
    Math.max(h.length, ...cells.map((row) => row[i].length)),
  );

  const top = "\u250c" + widths.map((w) => "\u2500".repeat(w + 2)).join("\u252c") + "\u2510";
  const mid = "\u251c" + widths.map((w) => "\u2500".repeat(w + 2)).join("\u253c") + "\u2524";
  const bottom = "\u2514" + widths.map((w) => "\u2500".repeat(w + 2)).join("\u2534") + "\u2518";

  const renderRow = (row: string[]) =>
    "\u2502 " +
    row
      .map((cell, i) =>
        aligns[i] === "right" ? cell.padStart(widths[i]) : cell.padEnd(widths[i]),
      )
      .join(" \u2502 ") +
    " \u2502";

  const lines: string[] = [top, renderRow(headers), mid];
  for (const row of cells) {
    lines.push(renderRow(row));
  }
  lines.push(bottom);

  return lines.join("\n");
}

function printHelp(): void {
  process.stdout.write(
    `opencode-meter CLI

Usage:
  opencode-meter --json     Output metrics as JSON
  opencode-meter --summary  Output per-model metrics table
  opencode-meter --serve [--port N]
                              Start dashboard HTTP server (persistent).
                              Port: --port, else $OPENCODE_METER_PORT, else 9393.
  opencode-meter --prune --days N [--dry-run]
                              Delete raw events older than N days, then VACUUM.
                              Session totals, file activity and daily rollups
                              are kept; the per-session tool timeline is not.
  opencode-meter            Show this help message
`,
  );
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const mode = args.includes("--json")
    ? "json"
    : args.includes("--summary")
      ? "summary"
      : args.includes("--serve")
        ? "serve"
        : args.includes("--prune")
          ? "prune"
          : "help";

  if (mode === "help") {
    printHelp();
    return;
  }

  if (mode === "prune") {
    const days = Number.parseInt(argValue(args, "--days") ?? "", 10);
    if (!Number.isInteger(days) || days <= 0) {
      console.error("[opencode-meter] --prune requires --days N (a positive integer)");
      process.exit(1);
    }

    const db = getDb();
    initSchema(db);
    const cutoff = Date.now() - days * 86_400_000;
    const { rows, bytes, oldestTs } = countEventsBefore(db, cutoff);
    const sizeBefore = dbSizeBytes();

    if (rows === 0) {
      process.stdout.write(
        `Nothing to prune: no events older than ${days} days. Database is ${formatBytes(sizeBefore)}.\n`
      );
      return;
    }

    const oldest = oldestTs === null ? "unknown" : new Date(oldestTs).toISOString().slice(0, 10);
    if (args.includes("--dry-run")) {
      process.stdout.write(
        `Would delete ${rows.toLocaleString()} events (${formatBytes(bytes)} of event data), ` +
          `oldest from ${oldest}.\n` +
          `Session totals, file activity and daily rollups are untouched; ` +
          `those sessions lose their per-event tool timeline.\n` +
          `Database is currently ${formatBytes(sizeBefore)}. Re-run without --dry-run to apply.\n`
      );
      return;
    }

    const deleted = deleteEventsBefore(db, cutoff);

    // VACUUM needs an exclusive lock. With OpenCode running it can fail with
    // SQLITE_BUSY — the rows are already gone either way, so say what actually
    // happened instead of pretending the space came back.
    let reclaimed = true;
    try {
      db.run("VACUUM");
    } catch {
      reclaimed = false;
    }

    const sizeAfter = dbSizeBytes();
    process.stdout.write(`Deleted ${deleted.toLocaleString()} events older than ${days} days (from ${oldest}).\n`);
    if (reclaimed) {
      process.stdout.write(`Database: ${formatBytes(sizeBefore)} -> ${formatBytes(sizeAfter)}.\n`);
    } else {
      process.stdout.write(
        `Rows are gone, but VACUUM could not run — the database is locked, most likely by a running OpenCode. ` +
          `The space is reclaimed the next time you prune with OpenCode closed. Database is ${formatBytes(sizeAfter)}.\n`
      );
    }
    return;
  }

  if (mode === "serve") {
    const { createApp, resolvePort } = await import("@/api/app");
    const { checkExistingServer } = await import("@/api/port-conflict");
    const { getDb: getServeDb } = await import("@/data/db/connection");
    const { initSchema: initServeSchema } = await import("@/data/db/migrations");
    const { registerCleanup } = await import("@/data/db/connection");

    const portArg = argValue(args, "--port");
    const port = portArg ? Number.parseInt(portArg, 10) : resolvePort();
    if (!Number.isInteger(port) || port <= 0 || port >= 65_536) {
      console.error(`[opencode-meter] --port must be a number between 1 and 65535, got "${portArg}"`);
      process.exit(1);
    }

    // The check existed and was tested but nothing ever called it, so a second
    // --serve died on a raw EADDRINUSE stack.
    if (await checkExistingServer(port)) {
      console.error(
        `[opencode-meter] A dashboard is already serving on port ${port}: http://127.0.0.1:${port}\n` +
          `Use --port to run a second one, or stop the other process.`
      );
      process.exit(1);
    }

    const db = getServeDb();
    initServeSchema(db);
    registerCleanup(db);

    const app = createApp();
    const server = Bun.serve({ port, hostname: "127.0.0.1", fetch: app.fetch });
    console.log(`[opencode-meter] Dashboard: http://127.0.0.1:${port}`);

    const shutdown = async (signal: string) => {
      console.log(`[opencode-meter] ${signal} received, shutting down...`);
      await server.stop();
      try {
        db.run("PRAGMA wal_checkpoint(TRUNCATE)");
        db.close();
      } catch { /* ignore */ }
      process.exit(0);
    };
    process.on("SIGTERM", () => void shutdown("SIGTERM"));
    process.on("SIGINT", () => void shutdown("SIGINT"));

    await new Promise(() => {});
  }

  const db = getDb();
  initSchema(db);

  if (mode === "json") {
    const result = buildJsonResult(db);
    process.stdout.write(JSON.stringify(result, null, 2) + "\n");
    return;
  }

  // mode === "summary"
  const rows = getModelStats(db, null);

  if (rows.length === 0) {
    process.stdout.write("No model data yet.\n");
    return;
  }

  process.stdout.write(renderSummaryTable(rows) + "\n");
  process.stdout.write(`\nDatabase: ${formatBytes(dbSizeBytes())} at ${DB_PATH}\n`);
}

main().catch((err) => {
  console.error("[opencode-meter] CLI error:", err);
  process.exit(1);
});
