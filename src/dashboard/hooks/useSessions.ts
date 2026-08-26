import { useApi } from "@/dashboard/hooks/useApi";
import { useProject, useRefresh, useRange } from "@/dashboard/App";
import type { SessionRow } from "@/data/domain/session";

export interface UseSessionsOptions {
  limit?: number;
  offset?: number;
  search?: string;
  status?: string;
  rootOnly?: boolean;
}

export interface UseSessionsResult {
  sessions: SessionRow[];
  total: number;
  loading: boolean;
  error: string | null;
}

export function useSessions(opts?: UseSessionsOptions): UseSessionsResult {
  const { days } = useRange();
  const { project, branch } = useProject();
  const { refreshKey } = useRefresh();
  const params = new URLSearchParams();
  if (opts?.limit != null) params.set("limit", String(opts.limit));
  if (opts?.offset != null) params.set("offset", String(opts.offset));
  if (days > 0) params.set("days", String(days));
  if (opts?.search) params.set("search", opts.search);
  if (opts?.status && opts.status !== "all") params.set("status", opts.status);
  if (opts?.rootOnly) params.set("parent", "null");
  if (project) params.set("project", project);
  if (branch) params.set("branch", branch);
  const query = params.toString();
  const path = query ? `/api/sessions?${query}` : "/api/sessions";
  const { data, loading, error } = useApi<{ sessions: SessionRow[]; total: number }>(path, refreshKey);
  return { sessions: data?.sessions ?? [], total: data?.total ?? 0, loading, error };
}
