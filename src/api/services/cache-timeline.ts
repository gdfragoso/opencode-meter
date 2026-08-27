import type { Database } from "bun:sqlite";
import type { CacheTimelineResponse, CacheTimelineSeries } from "@/data/domain/metrics";
import { findDailyModelCache } from "@/data/repositories/session-aggregates";

/**
 * How many models the chart draws. A line per model past this is unreadable,
 * and the response says how many were left out so the UI can admit it rather
 * than presenting a truncated chart as the whole picture.
 */
export const MAX_CACHE_TIMELINE_SERIES = 6;

/**
 * Share of input that came from cache: `cache_read / (cache_read + input)`.
 *
 * Null when the model read nothing at all that day. A day with no requests is
 * not a day with a 0% hit rate, and charting it as one would draw a cliff where
 * nothing happened.
 */
export function cacheHitRate(cacheRead: number, input: number): number | null {
  const total = cacheRead + input;
  return total > 0 ? cacheRead / total : null;
}

/**
 * Cache hit rate per model, per day.
 *
 * Every series is aligned to the same `dates` array — a model with no activity
 * on a date gets a null at that index rather than being skipped — so the caller
 * can hand `dates` and each series' `rates` straight to a chart without
 * reconciling two different day lists.
 *
 * The dates are the days that actually have data, not every day in the window:
 * the rest of the dashboard's day-series work the same way, and padding a
 * 90-day range mostly with nulls makes the chart harder to read, not more
 * honest.
 */
export function getCacheTimeline(
  db: Database,
  days: number | null,
  project: string | null = null,
  branch: string | null = null,
  maxSeries: number = MAX_CACHE_TIMELINE_SERIES
): CacheTimelineResponse {
  const rows = findDailyModelCache(db, days, project, branch);
  if (rows.length === 0) return { dates: [], series: [], omittedModels: 0 };

  const dates = [...new Set(rows.map((r) => r.date))].sort();
  const dateIndex = new Map(dates.map((date, i) => [date, i]));

  interface Accumulated {
    model_id: string;
    provider_id: string;
    tokens: number;
    cacheRead: number;
    input: number;
    rates: Array<number | null>;
  }

  const byModel = new Map<string, Accumulated>();
  for (const row of rows) {
    let acc = byModel.get(row.model_id);
    if (!acc) {
      acc = {
        model_id: row.model_id,
        provider_id: row.provider_id,
        tokens: 0,
        cacheRead: 0,
        input: 0,
        rates: Array.from({ length: dates.length }, () => null),
      };
      byModel.set(row.model_id, acc);
    }
    acc.tokens += row.tokens;
    acc.cacheRead += row.cacheRead;
    acc.input += row.input;
    acc.rates[dateIndex.get(row.date)!] = cacheHitRate(row.cacheRead, row.input);
  }

  // Busiest first, so the models that matter are the ones that survive the cap.
  const ranked = [...byModel.values()].sort((a, b) => b.tokens - a.tokens || a.model_id.localeCompare(b.model_id));

  const series: CacheTimelineSeries[] = ranked.slice(0, maxSeries).map((m) => ({
    model_id: m.model_id,
    provider_id: m.provider_id,
    tokens: m.tokens,
    overallRate: cacheHitRate(m.cacheRead, m.input),
    rates: m.rates,
  }));

  return { dates, series, omittedModels: Math.max(0, ranked.length - series.length) };
}
