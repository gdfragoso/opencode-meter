export interface ProjectRow {
  directory: string;
  branches: string;
  sessions: number;
  tokens_in: number;
  tokens_out: number;
  total_cost: number;
  tools_total: number;
  subagents_total: number;
  last_active: number | null;
  top_model: string | null;
  error_count: number;
  branch_count: number;
  avg_cost_per_session: number;
  tokens_per_dollar: number;
}

export interface ProjectBranchSummary {
  branch: string | null;
  sessions: number;
  total_cost: number;
  tokens_in: number;
  tokens_out: number;
  last_active: number | null;
  top_model: string | null;
}

export interface ProjectDetail extends ProjectRow {
  branch_summaries: ProjectBranchSummary[];
  models: Array<{ model_id: string; sessions: number; cost: number }>;
}