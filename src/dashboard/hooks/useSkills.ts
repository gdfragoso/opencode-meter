import { useApi } from "@/dashboard/hooks/useApi";
import { useProject, useRefresh, useRange } from "@/dashboard/App";

export interface SkillsResponse {
  count: number;
  topSkills: { name: string; count: number }[];
}

export function useSkills() {
  const { days } = useRange();
  const { project, branch } = useProject();
  const { refreshKey } = useRefresh();
  const params = new URLSearchParams();
  if (days > 0) params.set("days", String(days));
  if (project) params.set("project", project);
  if (branch) params.set("branch", branch);
  const query = params.toString();
  const url = query ? `/api/skills?${query}` : "/api/skills";
  return useApi<SkillsResponse>(url, refreshKey);
}
