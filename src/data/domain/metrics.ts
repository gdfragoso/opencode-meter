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

/** Per-agent slice of the cost-per-result view. */
export interface AgentCostEfficiency {
  agent: string;
  sessions: number;
  cost: number;
  /** Distinct files this agent wrote, created or deleted. */
  files: number;
  /** Lines added plus lines removed. */
  lines: number;
  /** Null when the agent changed nothing — not zero. */
  costPerFile: number | null;
  costPerSession: number | null;
}

/** Per-tool slice of the cost-per-result view. */
export interface ToolCostEfficiency {
  tool: string;
  calls: number;
  cost: number;
  files: number;
  lines: number;
  costPerCall: number | null;
  costPerFile: number | null;
}

/**
 * What the work cost measured against what it produced, rather than against
 * tokens. Every ratio is null when its denominator is zero, so a window that
 * spent money and changed nothing reads as "no result" instead of "free".
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
  byAgent: AgentCostEfficiency[];
  byTool: ToolCostEfficiency[];
}
