import type { DailyRow } from "@/data/domain/daily";

const MS_PER_DAY = 86_400_000;

/**
 * Moves a `YYYY-MM-DD` date by whole days, staying in that format.
 *
 * Arithmetic in UTC on purpose: the dates come out of SQLite as
 * `date(started_at/1000,'unixepoch')`, which is UTC, and parsing them as local
 * time would shift a day either side of a DST change.
 */
export function shiftDate(date: string, deltaDays: number): string {
  const [y, m, d] = date.split("-").map(Number);
  if (!y || !m || !d) return date;
  return new Date(Date.UTC(y, m - 1, d) + deltaDays * MS_PER_DAY).toISOString().slice(0, 10);
}

/**
 * For each day of the current window, the same weekday-offset day of the window
 * before it — `days` earlier, matched by date rather than by position.
 *
 * Position would be wrong: both series only contain days that had activity, so
 * a quiet Sunday in one window and not the other would slide every later point
 * onto the wrong day and invent a trend. Matching by date keeps each ghost
 * point under the day it is actually being compared with, and yields null where
 * the earlier window has nothing — a gap in the line, not a drop to zero.
 */
export function previousSeries(
  current: DailyRow[],
  all: DailyRow[] | null,
  days: number
): Array<DailyRow | null> {
  if (!all || days <= 0) return current.map(() => null);
  const byDate = new Map(all.map((row) => [row.date, row]));
  return current.map((row) => byDate.get(shiftDate(row.date, -days)) ?? null);
}

/** Reads one metric off an aligned ghost series, keeping the nulls as gaps. */
export function ghostValues(
  previous: Array<DailyRow | null>,
  pick: (row: DailyRow) => number
): Array<number | null> {
  return previous.map((row) => (row ? pick(row) : null));
}

/** True when any ghost point exists — otherwise there is no line worth drawing. */
export function hasGhost(previous: Array<DailyRow | null>): boolean {
  return previous.some((row) => row !== null);
}
