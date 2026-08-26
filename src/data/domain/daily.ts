export interface DailyRow {
  date: string;
  sessions: number;
  tokens_in: number;
  tokens_out: number;
  reasoning_tokens: number;
  cache_read: number;
  cache_write: number;
  total_cost: number;
  tools_total: number;
  subagents_total: number;
  errors_total: number;
  models_used: string;
  agents_used: string;
  top_tools: string;
  avg_ttft_ms: number | null;
  active_minutes: number;
}
