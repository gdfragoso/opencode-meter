import { useApi } from "@/dashboard/hooks/useApi";
import { useProject, useRefresh, useRange } from "@/dashboard/App";
import type { CacheTimelineResponse } from "@/data/domain/metrics";

export function useCacheTimeline() {
  const { days } = useRange();
  const { project, branch } = useProject();
  const { refreshKey } = useRefresh();
  const params = new URLSearchParams();
  if (days > 0) params.set("days", String(days));
  if (project) params.set("project", project);
  if (branch) params.set("branch", branch);
  const query = params.toString();
  const url = query ? `/api/models/cache-timeline?${query}` : "/api/models/cache-timeline";
  return useApi<CacheTimelineResponse>(url, refreshKey);
}
