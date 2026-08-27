export interface SessionRow {
  id: string;
  title: string | null;
  session_type: string | null;
  parent_id: string | null;
  agent: string | null;
  model_id: string | null;
  provider_id: string | null;
  started_at: number | null;
  ended_at: number | null;
  duration_ms: number | null;
  wall_ms: number | null;
  status: string | null;
  error_type: string | null;
  error_message: string | null;
  input_tokens: number | null;
  output_tokens: number | null;
  reasoning_tokens: number | null;
  cache_read_tokens: number | null;
  cache_write_tokens: number | null;
  total_cost: number | null;
  cost_source: string | null;
  cost_breakdown: string | null;
  tools_total: number | null;
  subagents_total: number | null;
  messages_total: number | null;
  files_touched: string | null;
  additions: number | null;
  deletions: number | null;
  ttft_ms: number | null;
  compaction_count: number;
  child_session_ids: string | null;
  tool_timings: string | null;
  steps: string | null;
  created_at: number | null;
  directory: string | null;
  branch: string | null;
}

export type SubagentRow = Pick<
  SessionRow,
  | "id"
  | "agent"
  | "model_id"
  | "input_tokens"
  | "output_tokens"
  | "tools_total"
  | "duration_ms"
  | "total_cost"
  | "status"
>;

/** One session in a delegation tree, flat, as the recursive walk returns it. */
export type SessionTreeRow = Pick<
  SessionRow,
  | "id"
  | "title"
  | "agent"
  | "model_id"
  | "status"
  | "session_type"
  | "parent_id"
  | "started_at"
  | "duration_ms"
  | "input_tokens"
  | "output_tokens"
  | "total_cost"
  | "tools_total"
  | "child_session_ids"
> & { depth: number };

/** Totals for a node plus every descendant below it. */
export interface SessionSubtreeTotals {
  sessions: number;
  tokens: number;
  cost: number;
  tools: number;
  durationMs: number;
}

export interface SessionTreeNode {
  id: string;
  title: string | null;
  agent: string | null;
  model_id: string | null;
  status: string | null;
  session_type: string | null;
  started_at: number | null;
  duration_ms: number | null;
  input_tokens: number | null;
  output_tokens: number | null;
  total_cost: number | null;
  tools_total: number | null;
  depth: number;
  /**
   * Why the parent delegated here: the `category` / `subagent_type` argument of
   * the `task` call that spawned this session. Null for the root and for
   * harnesses that do not pass one.
   */
  routingLabel: string | null;
  subtree: SessionSubtreeTotals;
  children: SessionTreeNode[];
}

export interface SessionTreeResponse {
  root: SessionTreeNode | null;
  /**
   * Top-most ancestor of the requested session. Differs from `root.id` when the
   * user opened a subagent, so the UI can offer to climb to the whole tree.
   */
  ancestorId: string | null;
  /** True when the depth cap cut the walk short. */
  truncated: boolean;
}

export interface SessionFileInfo {
  path: string;
  count: number;
  tool: string;
  lastTs: number;
  additions: number;
  deletions: number;
}

export interface SessionFilesResponse {
  read: SessionFileInfo[];
  created: SessionFileInfo[];
  modified: SessionFileInfo[];
  deleted: SessionFileInfo[];
}
