import { useApi } from "@/dashboard/hooks/useApi";
import { useProject, useRefresh, useRange } from "@/dashboard/App";

interface ToolCount {
  name: string;
  count: number;
}

export function useToolsOverview() {
  const { days } = useRange();
  const { project, branch } = useProject();
  const { refreshKey } = useRefresh();
  const params = new URLSearchParams();
  if (days > 0) params.set("days", String(days));
  if (project) params.set("project", project);
  if (branch) params.set("branch", branch);
  const query = params.toString();
  const url = query ? `/api/tools/overview?${query}` : "/api/tools/overview";
  return useApi<ToolCount[]>(url, refreshKey);
}
