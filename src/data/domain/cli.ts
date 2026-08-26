import type { ModelAggregateRow } from "@/data/domain/event";

export interface AgentAggregate {
  agent: string;
  sessions: number;
  tools: number;
  type: string;
  cost: number;
}

export interface CliJsonResult {
  totalSessions: number;
  totalRequests: number;
  totalCost: number;
  totalTokens: number;
  cacheHitRate: number;
  totalTools: number;
  totalSubagents: number;
  totalErrors: number;
  byModel: ModelAggregateRow[];
  byAgent: AgentAggregate[];
}
