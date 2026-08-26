import type { FileActivityEntry } from "@/data/domain/file-activity";

export interface SessionData {
  sessionID: string;
  title: string | null;
  directory: string | null;
  branch: string | null;
  startedAt: number;
  status: string;
  agent: string | null;
  model: string | null;
  provider: string | null;
  durationMs: number;
  toolsUsed: number;
  subagentsUsed: number;
  messages: number;
  parentID: string | null;
  inputTokens: number;
  outputTokens: number;
  reasoningTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  cost: number;
  costSource: string;
  costBreakdown: { input: number; output: number; cacheRead: number; cacheWrite: number };
  ttftMs: number | null;
  steps: Array<unknown> | null;
  compactionCount: number;
  errorType: string | null;
  errorMessage: string | null;
  filesTouched: string[];
  fileActivity: FileActivityEntry[];
  additions: number;
  deletions: number;
  childSessionIDs: string[];
  toolTimings: Array<unknown> | null;
  sessionType: string;
}
