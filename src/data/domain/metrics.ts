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
