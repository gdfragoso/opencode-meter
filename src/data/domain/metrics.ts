export interface SummaryResponse {
  totalSessions: number;
  totalUserSessions: number;
  totalTokens: number;
  totalCost: number;
  totalTools: number;
  totalSubagents: number;
  totalErrors: number;
  topModels: Array<{
    model_id: string;
    provider_id: string;
    sessions: number;
    tokens: number;
    cost: number;
    ttft_avg: number | null;
    cache_hit_rate: number | null;
  }>;
  topAgents: Array<{
    agent: string;
    sessions: number;
    tools: number;
    type: string;
    cost: number;
  }>;
}

/**
 * What the work cost measured against what it produced, rather than against
 * tokens. Every ratio is null when its denominator is zero, so a window that
 * spent money and changed nothing reads as "no result" instead of "free".
 *
 * Deliberately whole-window only. Splitting these by agent put the cost on the
 * session that spent it and the files on whichever session did the editing —
 * which, under delegation, are different sessions. An orchestrator that pays to
 * direct the work scored no files, and the subagent it paid for looked cheap.
 * Here numerator and denominator cover the same set of sessions, so there is no
 * owner to get wrong.
 */
export interface CostEfficiencyResponse {
  totalCost: number;
  totalSessions: number;
  files: number;
  edits: number;
  additions: number;
  deletions: number;
  costPerFile: number | null;
  costPerEdit: number | null;
  costPerLine: number | null;
  costPerSession: number | null;
}

/** One window's totals, as the period comparison reports them. */
export interface PeriodSnapshot {
  /** Inclusive start, epoch ms. */
  from: number;
  /** Exclusive end, epoch ms. */
  to: number;
  sessions: number;
  /** Sessions you started, excluding those opened by subagents. */
  userSessions: number;
  tokens: number;
  cost: number;
  tools: number;
  errors: number;
  activeDays: number;
  /** Distinct files written, created or deleted in the window. */
  files: number;
  /** Lines added plus lines removed. */
  lines: number;
}

export interface PeriodDelta {
  current: number;
  previous: number;
  absolute: number;
  /** Null when the earlier value was zero — a change from nothing has no percentage. */
  pct: number | null;
}

export type PeriodDeltaKey =
  | "sessions"
  | "userSessions"
  | "cost"
  | "tokens"
  | "tools"
  | "errors"
  | "files"
  | "lines"
  | "activeDays";

export type PeriodDeltas = Record<PeriodDeltaKey, PeriodDelta>;

export interface PeriodComparisonResponse {
  /** Length of each window in days. Always set — see `defaulted`. */
  days: number;
  /**
   * True when no range was selected and a default window was used. The two
   * windows are then narrower than whatever the rest of the page is showing, so
   * anything rendering this has to say so — and anything pairing these deltas
   * with an all-time figure must not use them at all.
   */
  defaulted: boolean;
  current: PeriodSnapshot;
  previous: PeriodSnapshot;
  deltas: PeriodDeltas;
}

/** One model's cache hit rate across a series of days. */
export interface CacheTimelineSeries {
  model_id: string;
  provider_id: string;
  /** Total tokens over the window — what the series is ranked by. */
  tokens: number;
  /** Hit rate over the whole window; null when the model read nothing. */
  overallRate: number | null;
  /**
   * One entry per date in `CacheTimelineResponse.dates`, same order. Null means
   * the model was not used that day — not that its hit rate was zero.
   */
  rates: Array<number | null>;
}

export interface CacheTimelineResponse {
  /** Days that have data, ascending, as `YYYY-MM-DD`. */
  dates: string[];
  series: CacheTimelineSeries[];
  /** Models left out to keep the chart readable. Never silently dropped. */
  omittedModels: number;
}
