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
 * Window used when no range is selected. "All time" has no period before it, so
 * the section would otherwise be a box that only tells you to go change a
 * control somewhere else. A named month against the month before it is useful
 * on its own, and the response says it was defaulted so the caller can label it
 * rather than quietly showing a different window from the rest of the page.
 */
export const DEFAULT_COMPARISON_DAYS = 30;

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
 * With no range selected it falls back to DEFAULT_COMPARISON_DAYS and flags
 * `defaulted`. Halving the whole history instead would compare a full period
 * against a partial one, which is why that is not what happens.
 */
export function getPeriodComparison(
  db: Database,
  days: number | null,
  project: string | null = null,
  branch: string | null = null,
  now: number = Date.now()
): PeriodComparisonResponse {
  const defaulted = days === null || days <= 0;
  const span = (defaulted ? DEFAULT_COMPARISON_DAYS : days) * MS_PER_DAY;
  const current = snapshot(db, now - span, now, project, branch);
  const previous = snapshot(db, now - 2 * span, now - span, project, branch);

  return {
    days: defaulted ? DEFAULT_COMPARISON_DAYS : days,
    defaulted,
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
