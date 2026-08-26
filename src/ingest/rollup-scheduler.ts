import type { Database } from "bun:sqlite";
import { upsertRollup } from "@/data/repositories/daily";
import { createConsoleLogger, errString, type Logger } from "@/shared/logging";

export const DEFAULT_ROLLUP_DELAY_MS = 5_000;

export interface RollupScheduler {
  /** Mark a day as dirty. The write happens once the burst settles. */
  schedule(date: string): void;
  /** Write every pending day now. Called on process exit. */
  flush(): void;
  pending(): string[];
}

export interface RollupSchedulerOptions {
  delayMs?: number;
  /** Tests turn this off so each scheduler does not leak a process listener. */
  registerExitFlush?: boolean;
}

/**
 * daily_rollups is derived, so it does not have to be correct between two
 * assistant turns — only by the time something reads it. session.idle fires at
 * the end of every turn, which had upsertRollup running its five aggregate
 * queries inside OpenCode's process on each one. Collapsing a burst of turns
 * into a single write per day takes that off the hot path.
 */
export function createRollupScheduler(
  db: Database,
  logger: Logger = createConsoleLogger(),
  options: RollupSchedulerOptions = {}
): RollupScheduler {
  const delayMs = options.delayMs ?? DEFAULT_ROLLUP_DELAY_MS;
  const dirtyDates = new Set<string>();
  let timer: ReturnType<typeof setTimeout> | null = null;

  const flush = (): void => {
    if (timer !== null) {
      clearTimeout(timer);
      timer = null;
    }
    if (dirtyDates.size === 0) return;
    const dates = [...dirtyDates];
    dirtyDates.clear();
    for (const date of dates) {
      try {
        upsertRollup(db, date);
      } catch (err) {
        logger.error("Failed to roll up day", { date, error: errString(err) });
      }
    }
  };

  const schedule = (date: string): void => {
    dirtyDates.add(date);
    if (timer !== null) return;
    timer = setTimeout(flush, delayMs);
    // A derived table is never a reason to keep the process alive.
    (timer as unknown as { unref?: () => void }).unref?.();
  };

  if (options.registerExitFlush !== false) {
    process.once("exit", flush);
  }

  return { schedule, flush, pending: () => [...dirtyDates] };
}
