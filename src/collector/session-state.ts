import type { FileActivityEntry } from "@/data/domain/file-activity";

import type { SessionData } from "@/data/domain/collected";
export type { SessionData };

export interface SessionState {
  title?: string;
  directory?: string;
  branch?: string;
  agent?: string;
  model?: string;
  provider?: string;
  started: number;
  // When work actually began, as opposed to when the session row was created.
  // The first turn used to measure from session.created, which includes however
  // long the user took to type — so duration_ms mixed wall clock on turn one
  // with active time on every turn after it.
  activeFrom: number | null;
  tools: number;
  subagents: number;
  messages: number;
  inputTokens: number;
  outputTokens: number;
  reasoningTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  cost: number;
  costSource: "opencode" | "config";
  ttftMs: number | null;
  steps: Array<{
    stepNumber: number;
    tokens: { input: number; output: number; reasoning: number; cacheRead: number; cacheWrite: number };
    cost: number;
    finishReason: string;
    durationMs: number;
  }>;
  compactionCount: number;
  errorType?: string;
  errorMessage?: string;
  // opencode reports a snapshot diff, so the same file arrives again with
  // cumulative counts on every edit. Keyed by path with last value winning;
  // filesTouched and the additions/deletions totals derive from it.
  diffByFile: Map<string, { additions: number; deletions: number }>;
  fileActivity: FileActivityEntry[];
  childSessionIDs: string[];
  parentID?: string;
  toolTimings: Array<{ tool: string; durationMs: number; status: string }>;
  sessionType: string;
}

export interface CollectorOptions {
  onSessionCreated?: (data: { sessionID: string; startedAt: number; title?: string; directory?: string; branch?: string; parentID?: string }) => void;
  onSessionActive?: (data: { sessionID: string; title?: string; agent?: string; model?: string; provider?: string }) => void;
  onSessionEnd?: (data: SessionData) => void;
  onEvent?: (sessionID: string, type: string, data: Record<string, unknown>) => void;
}

export function createSessionState(): SessionState {
  return {
    title: undefined,
    directory: undefined,
    branch: undefined,
    started: Date.now(),
    activeFrom: null,
    tools: 0,
    subagents: 0,
    messages: 0,
    inputTokens: 0,
    outputTokens: 0,
    reasoningTokens: 0,
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
    cost: 0,
    costSource: "opencode",
    ttftMs: null,
    steps: [],
    compactionCount: 0,
    diffByFile: new Map(),
    fileActivity: [],
    childSessionIDs: [],
    toolTimings: [],
    sessionType: "main",
  };
}
