import { useApi } from "@/dashboard/hooks/useApi";
import { useProject, useRefresh, useRange } from "@/dashboard/App";
import type { ToolMetricsRow } from "@/data/domain/event";

export function useToolMetrics() {
  const { days } = useRange();
  const { project, branch } = useProject();
  const { refreshKey, refresh } = useRefresh();
  const params = new URLSearchParams();
  if (days > 0) params.set("days", String(days));
  if (project) params.set("project", project);
  if (branch) params.set("branch", branch);
  const query = params.toString();
  const url = query ? `/api/tools?${query}` : "/api/tools";
  const { data, loading, error } = useApi<ToolMetricsRow[]>(url, refreshKey);
  return { data: data ?? [], loading, error, refresh };
}
