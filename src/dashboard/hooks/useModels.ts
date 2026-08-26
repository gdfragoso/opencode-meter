import { useApi } from "@/dashboard/hooks/useApi";
import { useProject, useRefresh, useRange } from "@/dashboard/App";
import type { ModelAggregateRow } from "@/data/domain/event";

interface ModelsResponse {
  models: ModelAggregateRow[];
}

export function useModels() {
  const { days } = useRange();
  const { project, branch } = useProject();
  const { refreshKey } = useRefresh();
  const params = new URLSearchParams();
  if (days > 0) params.set("days", String(days));
  if (project) params.set("project", project);
  if (branch) params.set("branch", branch);
  const query = params.toString();
  const url = query ? `/api/models?${query}` : "/api/models";
  return useApi<ModelsResponse>(url, refreshKey);
}
