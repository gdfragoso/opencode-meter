import type { Database } from "bun:sqlite";
import type {
  PeriodComparisonResponse,
  PeriodDelta,
  PeriodSnapshot,
} from "@/data/domain/metrics";
import { findPeriodTotals } from "@/data/repositories/session-aggregates";
import { findFileChangeTotalsInRange } from "@/data/repositories/files";

const MS_PER_DAY = 86_400_000;

/**
 * Change between two values.
 *
 * `pct` is null when the earlier value is zero: going from nothing to something
 * has no percentage, and the usual dodges — reporting 0%, or 100%, or infinity —
 * each say something false. The absolute change is always available, so the UI
 * has something honest to show either way.
 */
export function delta(current: number, previous: number): PeriodDelta {
  return {
    current,
    previous,
    absolute: current - previous,
    pct: previous === 0 ? null : ((current - previous) / previous) * 100,
  };
}

function snapshot(
  db: Database,
  from: number,
  to: number,
  project: string | null,
  branch: string | null
): PeriodSnapshot {
  const totals = findPeriodTotals(db, from, to, project, branch);
  const changes = findFileChangeTotalsInRange(db, from, to, project, branch);
  return {
    ...totals,
    files: changes.files,
    lines: changes.additions + changes.deletions,
  };
}

/**
 * This window against the one immediately before it, same length.
 *
 * Both windows end where the next begins — `[now - 2d, now - d)` and
 * `[now - d, now)` — so a session on the boundary lands in exactly one of them.
 *
 * With no range selected there is nothing to compare against: an "all time"
 * window has no earlier window, and inventing one by halving the history would
 * compare a full period against a partial one. `previous` and `deltas` come back
 * null and the UI says why.
 */
export function getPeriodComparison(
  db: Database,
  days: number | null,
  project: string | null = null,
  branch: string | null = null,
  now: number = Date.now()
): PeriodComparisonResponse {
  if (days === null || days <= 0) {
    return {
      days: null,
      current: snapshot(db, 0, now, project, branch),
      previous: null,
      deltas: null,
    };
  }

  const span = days * MS_PER_DAY;
  const current = snapshot(db, now - span, now, project, branch);
  const previous = snapshot(db, now - 2 * span, now - span, project, branch);

  return {
    days,
    current,
    previous,
    deltas: {
      sessions: delta(current.sessions, previous.sessions),
      userSessions: delta(current.userSessions, previous.userSessions),
      cost: delta(current.cost, previous.cost),
      tokens: delta(current.tokens, previous.tokens),
      tools: delta(current.tools, previous.tools),
      errors: delta(current.errors, previous.errors),
      files: delta(current.files, previous.files),
      lines: delta(current.lines, previous.lines),
      activeDays: delta(current.activeDays, previous.activeDays),
    },
  };
}
