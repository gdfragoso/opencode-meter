export interface EventRow {
  id: number;
  ts: number;
  session_id: string;
  type: string;
  data: string;
}

export interface ToolMetricsRow {
  tool: string;
  calls: number;
  avg_duration_ms: number;
  total_tokens: number;
  total_cost: number;
}

export type ToolMetricsResponse = ToolMetricsRow[];

export interface ModelAggregateRow {
  model_id: string;
  provider_id: string;
  sessions: number;
  tokens: number;
  cost: number;
  ttft_avg_ms: number | null;
  cache_hit_rate: number | null;
  error_rate: number | null;
  tokens_per_sec: number | null;
}
